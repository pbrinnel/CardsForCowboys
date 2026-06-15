#!/bin/bash
# Cleans up old/finished game nodes from Firebase.
#
# Keeps:   gameHistory (forever — it's the permanent record)
# Deletes: games/, liveGames/, and liveSummary/ nodes that are either:
#            - status: finished (already captured in gameHistory)
#            - last ts older than --days (abandoned/stale)
#
# Usage: bash admin/cleanup-games.sh [--days N]   (default: 14)
# Requires: firebase CLI logged in, python3

set -euo pipefail

PROJECT="cards-for-cowboys"
DAYS=14

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --days) DAYS="$2"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

CUTOFF_MS=$(( ($(date +%s) - DAYS * 86400) * 1000 ))
CUTOFF_DATE=$(python3 -c "from datetime import datetime,timezone; print(datetime.fromtimestamp($CUTOFF_MS/1000, tz=timezone.utc).strftime('%Y-%m-%d'))")

echo "=== Cards For Cowboys — Game Cleanup ==="
echo "Deleting: finished games + anything last active before $CUTOFF_DATE (>${DAYS}d ago)"
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
read -p "Delete these $COUNT game(s) from games/, liveGames/, and liveSummary/? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# --- Delete ---
echo ""
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
echo "Done. $DELETED deleted, $ERRORS errors."
echo "gameHistory is untouched."
