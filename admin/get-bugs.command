#!/bin/bash
cd "$(dirname "$0")/.."

PROJECT="cards-for-cowboys"

RAW=$(firebase database:get /bugReports --project "$PROJECT" 2>&1)

if echo "$RAW" | grep -q "Error\|not logged\|permission"; then
  echo "Firebase error:"
  echo "$RAW"
  read -p "Press Enter to close..."
  exit 1
fi

if [ "$RAW" = "null" ] || [ -z "$RAW" ]; then
  echo "No bug reports found."
  read -p "Press Enter to close..."
  exit 0
fi

COUNT=$(echo "$RAW" | jq 'keys | length')
echo "=== Bug Reports ($COUNT total, newest first) ==="
echo ""
echo "$RAW" | jq -r '
  to_entries
  | sort_by(.value.ts) | reverse
  | .[]
  | "──────────────────────────────────────────────\n"
    + "Date:      \((.value.ts/1000) | todate)\n"
    + "Game code: \(.value.gameCode // "(none)")\n"
    + (if .value.context then "Context:   \(.value.context | fromjson | "mode=\(.mode) act=\(.act) round=\(.round) phase=\(.phase) players=\(.numPlayers)")\n" else "" end)
    + "Message:   \(.value.message)\n"
    + (if .value.ua then "Browser:   \(.value.ua)\n" else "" end)
'
echo ""
read -p "Press Enter to close..."
