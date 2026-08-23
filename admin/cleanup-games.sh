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
# Removes from Firebase: liveSummary/ nodes whose last ts is older than --days, and
# the games/ + liveGames/ card state for the ones that never finished.
#
# A game that actually COMPLETED keeps its games/ or liveGames/ node forever, so the
# Review link on history.html stays alive. gameHistory is never purged, so that row
# (and its Review button) is permanent — deleting the card state under it turned the
# link into spectate.html hanging on "Waiting for game to start…" for good, which
# reads as a broken site rather than an expired link.
#
# Retaining them is close to free, and NOT for the reason cleanup exists. The cost
# driver is liveSummary: history.html onValue's that WHOLE collection, so every
# visitor downloads every record — which is why it is still pruned for everything,
# completed or not. games/ is only ever read one code at a time by spectate. At ~11 KB
# per completed game and a ~4% completion rate, the retained set is a few hundred KB.
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

# --- Fetch gameHistory: the ONLY reliable "this game completed" signal ---
# NOT liveSummary's own status — onDisconnect writes 'finished' when a tab closes
# mid-game, so an abandoned game reads finished there (see the note above).
# A failed fetch ABORTS: without this index every completed game looks unfinished
# and we would delete exactly the card state the Review links depend on.
echo "Fetching completed-game index from gameHistory..."
HISTORY=$(firebase database:get /gameHistory --project "$PROJECT" 2>&1)

if echo "$HISTORY" | grep -q "Error\|not logged\|permission"; then
  echo "Firebase error fetching gameHistory:"
  echo "$HISTORY"
  echo "Aborting. Nothing was deleted."
  exit 1
fi

printf '%s' "$HISTORY" > "$TMPD/hist.json"

# --- Identify candidates ---
TO_DELETE=$(echo "$SUMMARY" | python3 -c "
import json, sys, time
from datetime import datetime, timezone

data = json.load(sys.stdin)
cutoff = $CUTOFF_MS
results = []

# Codes that reached the Showdown — their card state is retained. gameCode was added
# to gameHistory in July 2026; older entries lack it and cannot be matched, so a
# pre-July-2026 completed game is indistinguishable from an abandoned one here. The
# count is surfaced as a caveat below rather than silently ignored.
with open('$TMPD/hist.json') as f:
    _txt = f.read().strip()
hist = (json.loads(_txt) or {}) if _txt and _txt != 'null' else {}
completed = {v['gameCode'] for v in hist.values() if v.get('gameCode')}
codeless = sum(1 for v in hist.values() if not v.get('gameCode'))

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
        'code': code, 'status': status, 'ts': ts, 'completed': code in completed,
        'mode': mode, 'players': players, 'reason': reason, 'date': dt
    })

results.sort(key=lambda x: x['ts'])
print(json.dumps({'games': results, 'codeless': codeless}))
")

echo "$TO_DELETE" > "$TMPD/found.json"
TO_DELETE=$(python3 -c "import json;print(json.dumps(json.load(open('$TMPD/found.json'))['games']))")
CODELESS=$(python3 -c "import json;print(json.load(open('$TMPD/found.json'))['codeless'])")

COUNT=$(echo "$TO_DELETE" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
KEEPING=$(echo "$TO_DELETE" | python3 -c "import json,sys; print(sum(1 for e in json.load(sys.stdin) if e['completed']))")

if [ "$COUNT" = "0" ]; then
  echo "Nothing to clean up — all games are active and within the ${DAYS}-day window."
  exit 0
fi

echo "Found $COUNT stale record(s):"
echo ""
echo "$TO_DELETE" | python3 -c "
import json, sys
for e in json.load(sys.stdin):
    players = ', '.join(e['players'])
    kept = '  [KEEP card state — completed]' if e['completed'] else ''
    print(f\"  [{e['mode']}] {e['code']}  {e['date']}  [{players}]  → {e['reason']}{kept}\")
"
echo ""
echo "These will be ARCHIVED to $ARCHIVE_FILE (committed) and $BACKUP_DIR/ (local)."
echo "Then, from Firebase:"
echo "  liveSummary       all $COUNT removed (this is the node history.html reads in full)"
echo "  games/liveGames   $((COUNT - KEEPING)) removed; $KEEPING kept so completed games stay reviewable"
echo "gameHistory and traj are untouched."
if [ "$CODELESS" != "0" ]; then
  echo ""
  echo "Note: $CODELESS gameHistory entr(y/ies) predate the gameCode field (July 2026) and"
  echo "      cannot be matched. If any of the above is one of those, it will be treated as"
  echo "      unfinished and its card state removed."
fi
read -p "Archive and remove these $COUNT record(s)? [y/N] " CONFIRM
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
# ONE multi-path update per collection ({"CODE":null,...}) rather than one CLI call
# per code per collection. RTDB treats a null value as "delete this key", so this is
# the same operation batched. The old per-code loop spawned a node process each time:
# 194 games meant ~580 invocations and ~15 minutes. This is 3 calls and ~10 seconds.
echo ""
echo "Removing from Firebase..."

# TWO payloads: liveSummary loses every stale record, while games/liveGames keep the
# ones that completed (see the header — that is what keeps their Review links alive).
python3 - "$TMPD/todelete.json" "$TMPD/nulls-summary.json" "$TMPD/nulls-state.json" <<'PYEOF'
import json, sys

with open(sys.argv[1]) as f:
    entries = json.load(f)

def emit(path, codes):
    payload = {c: None for c in codes}
    # Guard: this file is fed to `database:update`, which WRITES whatever it contains.
    # Every value must be null, or a bug here would overwrite live game data instead of
    # deleting it. Refuse to emit anything else.
    assert all(v is None for v in payload.values()), "payload must be deletions only"
    with open(path, "w") as f:
        json.dump(payload, f)
    return len(payload)

n_summary = emit(sys.argv[2], [e["code"] for e in entries])
n_state   = emit(sys.argv[3], [e["code"] for e in entries if not e["completed"]])
print(f"  liveSummary      {n_summary} key(s) -> null")
print(f"  games/liveGames  {n_state} key(s) -> null ({n_summary - n_state} completed, kept)")
PYEOF

ERRORS=0

# An empty payload is a legitimate outcome (every stale game completed), and
# `database:update` with {} is a pointless call — skip it rather than risk the CLI
# treating an empty write as an error.
apply_nulls() { # apply_nulls <node> <payload-file>
  local node="$1" payload="$2" n
  n=$(python3 -c "import json;print(len(json.load(open('$payload'))))")
  printf "  %-12s ... " "$node"
  if [ "$n" = "0" ]; then
    echo "nothing to remove"
    return 0
  fi
  if firebase database:update "/$node" "$payload" --project "$PROJECT" -f \
       >/dev/null 2>"$TMPD/err.txt"; then
    echo "ok"
  else
    echo "ERROR"
    sed 's/^/    /' "$TMPD/err.txt"
    ERRORS=$((ERRORS + 1))
  fi
  return 0
}

apply_nulls games       "$TMPD/nulls-state.json"
apply_nulls liveGames   "$TMPD/nulls-state.json"
apply_nulls liveSummary "$TMPD/nulls-summary.json"

if [ "$ERRORS" -eq 0 ]; then
  DELETED=$COUNT
else
  DELETED=0
  echo ""
  echo "One or more collections failed. The archive is already written, so nothing is"
  echo "lost — re-run to retry the removal."
fi

echo ""
echo "Done. $DELETED record(s) cleared from Firebase, $ERRORS errors."
if [ "$KEEPING" != "0" ] && [ "$ERRORS" -eq 0 ]; then
  echo "$KEEPING completed game(s) kept their card state — Review links still work."
fi
echo "gameHistory and traj are untouched."
echo ""
echo "Commit the archive so the started-game log is durable:"
echo "  git add $ARCHIVE_FILE && git commit -m 'admin: archive $DELETED game records'"
