#!/bin/bash
cd "$(dirname "$0")/.."

PROJECT="cards-for-cowboys"

RAW=$(firebase database:get /emailSignups --project "$PROJECT" 2>&1)

if echo "$RAW" | grep -q "Error\|not logged\|permission"; then
  echo "Firebase error:"
  echo "$RAW"
  read -p "Press Enter to close..."
  exit 1
fi

if [ "$RAW" = "null" ] || [ -z "$RAW" ]; then
  echo "No email signups found."
  read -p "Press Enter to close..."
  exit 0
fi

COUNT=$(echo "$RAW" | jq 'keys | length')
echo "=== Email Signups ($COUNT total) ==="
echo ""
echo "$RAW" | jq -r 'to_entries | sort_by(.value.ts) | .[] | "\(.value.email)  (\((.value.ts/1000) | todate))"'
echo ""
read -p "Press Enter to close..."
