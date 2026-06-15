#!/bin/bash
cd "$(dirname "$0")/.."
bash admin/cleanup-games.sh
echo ""
read -p "Press Enter to close..."
