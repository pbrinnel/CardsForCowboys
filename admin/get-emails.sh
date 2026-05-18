#!/bin/bash
# Fetches email signups from Firebase and prints them.
# Requires: firebase CLI logged in, jq installed.
# Usage: bash admin/get-emails.sh

PROJECT="cards-for-cowboys"

RAW=$(firebase database:get /emailSignups --project "$PROJECT" 2>&1)

if echo "$RAW" | grep -q "Error\|not logged\|permission"; then
  echo "Firebase error:"
  echo "$RAW"
  exit 1
fi

if [ "$RAW" = "null" ] || [ -z "$RAW" ]; then
  echo "No email signups found."
  exit 0
fi

COUNT=$(echo "$RAW" | jq 'keys | length')
echo "=== Email Signups ($COUNT total) ==="
echo ""
echo "$RAW" | jq -r 'to_entries | sort_by(.value.ts) | .[] | "\(.value.email)  (\((.value.ts/1000) | todate))"'
