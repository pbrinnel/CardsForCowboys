#!/bin/bash
# ARCHIVES then removes old/finished game nodes from Firebase.
#
# Nothing is lost. Every run archives before it deletes:
#   admin/archive/livesummary.json   slim per-game records, CUMULATIVE + COMMITTED.
#                                    This is the permanent started-game log that
#                                    get-unfinished.sh reads alongside the live node.
#   admin/firebase-backups/*.json    full games/ + liveGames/ card state, timestamped,
#                                    gitignored (large). The restore path if needed.
#
# Keeps in Firebase: gameHistory (the permanent completed-game record) and traj.
# Removes from Firebase: games/, liveGames/, liveSummary/ nodes whose last ts is
# older than --days.
#
# NOTE: do NOT treat liveSummary `status:'finished'` as "this game completed" — the
# onDisconnect handler writes it too, so an abandoned game reads finished. That is
# exactly why liveSummary is archived rather than dropped: for ~92% of these games it
# is the ONLY record they were ever started. See CLAUDE.md "Admin Scripts".
#
# Usage: bash admin/cleanup-games.sh [--days N]   (default: 14)
# Requires: firebase CLI logged in, python3

set -euo pipefail

PROJECT="cards-for-cowboys"
DAYS=14

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --days) DAYS="$2"; shift ;;
    -h|--help)
      echo "Usage: bash admin/cleanup-games.sh [--days N]   (default: 14)"
      echo "Archives to admin/archive/livesummary.json + admin/firebase-backups/,"
      echo "then removes the archived nodes from Firebase."
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

ARCHIVE_DIR="admin/archive"
ARCHIVE_FILE="$ARCHIVE_DIR/livesummary.json"
BACKUP_DIR="admin/firebase-backups"
STAMP=$(date +%Y%m%d-%H%M%S)
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

CUTOFF_MS=$(( ($(date +%s) - DAYS * 86400) * 1000 ))
CUTOFF_DATE=$(python3 -c "from datetime import datetime,timezone; print(datetime.fromtimestamp($CUTOFF_MS/1000, tz=timezone.utc).strftime('%Y-%m-%d'))")

echo "=== Cards For Cowboys — Game Archive + Cleanup ==="
echo "Archiving, then removing from Firebase: anything last active before $CUTOFF_DATE (>${DAYS}d ago)"
echo ""

# --- Fetch liveSummary (status + ts for every game code) ---
echo "Fetching game index from liveSummary..."
SUMMARY=$(firebase database:get /liveSummary --project "$PROJECT" 2>&1)

if echo "$SUMMARY" | grep -q "Error\|not logged\|permission"; then
  echo "Firebase error:"
  echo "$SUMMARY"
  exit 1
fi

if [ "$SUMMARY" = "null" ] || [ -z "$SUMMARY" ]; then
  echo "liveSummary is empty — nothing to clean up."
  exit 0
fi

printf '%s' "$SUMMARY" > "$TMPD/live.json"

# --- Identify candidates ---
TO_DELETE=$(echo "$SUMMARY" | python3 -c "
import json, sys, time
from datetime import datetime, timezone

data = json.load(sys.stdin)
cutoff = $CUTOFF_MS
results = []

for code, val in data.items():
    ts    = val.get('ts', 0)
    status = val.get('status', 'unknown')
    players = [p.get('name', '?') for p in val.get('players', [])]
    mode  = val.get('mode', '?')
    age_days = (time.time() * 1000 - ts) / 86400000
    dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime('%Y-%m-%d') if ts else '?'

    if ts >= cutoff:
        continue  # too recent — keep regardless of status

    if status == 'finished':
        reason = f'finished ({age_days:.0f}d ago)'
    else:
        reason = f'abandoned ({age_days:.0f}d old, status: {status})'

    results.append({
        'code': code, 'status': status, 'ts': ts,
        'mode': mode, 'players': players, 'reason': reason, 'date': dt
    })

results.sort(key=lambda x: x['ts'])
print(json.dumps(results))
")

COUNT=$(echo "$TO_DELETE" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")

if [ "$COUNT" = "0" ]; then
  echo "Nothing to clean up — all games are active and within the ${DAYS}-day window."
  exit 0
fi

echo "Found $COUNT game(s) to delete:"
echo ""
echo "$TO_DELETE" | python3 -c "
import json, sys
for e in json.load(sys.stdin):
    players = ', '.join(e['players'])
    print(f\"  [{e['mode']}] {e['code']}  {e['date']}  [{players}]  → {e['reason']}\")
"
echo ""
echo "These will be ARCHIVED to $ARCHIVE_FILE (committed) and $BACKUP_DIR/ (local),"
echo "then removed from Firebase. gameHistory and traj are untouched."
read -p "Archive and remove these $COUNT game(s)? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# --- Archive: full card state (fat, gitignored) ---
echo ""
mkdir -p "$BACKUP_DIR" "$ARCHIVE_DIR"
echo "Backing up full game state..."
for NODE in games liveGames; do
  OUT="$BACKUP_DIR/${NODE}-${STAMP}.json"
  # A failed fetch must abort BEFORE anything is deleted — otherwise card state
  # would be removed from Firebase with no local copy.
  if ! firebase database:get "/$NODE" --project "$PROJECT" > "$OUT" 2>"$TMPD/err.txt"; then
    echo "  ERROR backing up /$NODE:"
    sed 's/^/    /' "$TMPD/err.txt"
    echo "  Aborting. Nothing was deleted."
    exit 1
  fi
  if [ ! -s "$OUT" ] || [ "$(head -c 4 "$OUT")" = "null" ]; then
    rm -f "$OUT"
    printf "  %-10s -> empty, nothing to back up\n" "$NODE"
  else
    printf "  %-10s -> %s (%s)\n" "$NODE" "$OUT" "$(du -h "$OUT" | cut -f1)"
  fi
done

# --- Archive: slim per-game records (committed, cumulative) ---
echo "$TO_DELETE" > "$TMPD/todelete.json"
python3 - "$TMPD/live.json" "$TMPD/todelete.json" "$ARCHIVE_FILE" <<'PYEOF'
import json, os, sys

live_path, del_path, archive_path = sys.argv[1], sys.argv[2], sys.argv[3]

with open(live_path) as f:
    live = json.load(f) or {}
with open(del_path) as f:
    codes = [e["code"] for e in json.load(f)]

archive = {}
if os.path.exists(archive_path):
    with open(archive_path) as f:
        txt = f.read().strip()
    if txt:
        archive = json.loads(txt) or {}

before = len(archive)
for code in codes:
    rec = live.get(code)
    if rec is None:
        continue
    # A tombstone ({status} only, no ts) carries no information worth keeping, and
    # must not overwrite a real archived record for the same code.
    if not rec.get("ts") and code in archive:
        continue
    archive[code] = rec

with open(archive_path, "w") as f:
    json.dump(archive, f, indent=1, sort_keys=True)
    f.write("\n")

added = len(archive) - before
print(f"  livesummary -> {archive_path} ({added} new, {len(archive)} total records)")
PYEOF

# --- Remove from Firebase ---
echo ""
echo "Removing from Firebase..."
DELETED=0
ERRORS=0

while IFS= read -r CODE; do
  printf "  %-8s ... " "$CODE"
  OK=true
  # Both removes run regardless — one will be a no-op (wrong collection), errors suppressed
  firebase database:remove /games/$CODE      --project "$PROJECT" -f 2>/dev/null || true
  firebase database:remove /liveGames/$CODE  --project "$PROJECT" -f 2>/dev/null || true
  firebase database:remove /liveSummary/$CODE --project "$PROJECT" -f 2>/dev/null || OK=false
  if $OK; then
    echo "deleted"
    DELETED=$((DELETED + 1))
  else
    echo "ERROR (liveSummary delete failed)"
    ERRORS=$((ERRORS + 1))
  fi
done < <(echo "$TO_DELETE" | python3 -c "import json,sys; [print(e['code']) for e in json.load(sys.stdin)]")

echo ""
echo "Done. $DELETED removed from Firebase, $ERRORS errors."
echo "gameHistory and traj are untouched."
echo ""
echo "Commit the archive so the started-game log is durable:"
echo "  git add $ARCHIVE_FILE && git commit -m 'admin: archive $DELETED game records'"
