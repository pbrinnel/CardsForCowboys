#!/bin/bash
cd "$(dirname "$0")/.."
read -p "How many days back? [7] " DAYS
DAYS=${DAYS:-7}
bash admin/get-unfinished.sh --days "$DAYS"
echo ""
read -p "Press Enter to close..."
