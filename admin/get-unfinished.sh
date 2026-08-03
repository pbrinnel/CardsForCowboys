#!/bin/bash
# Lists games that were STARTED but never COMPLETED, within the last N days.
#
# How "unfinished" is determined:
#   Every started game writes a `liveSummary/{code}` node. Only a game that runs
#   all the way to the Showdown writes a `gameHistory` entry (from finalizeGame).
#   So: in liveSummary but NOT in gameHistory  ==>  unfinished.
#
#   Do NOT use liveSummary's own `status` field for this. `status:'finished'` is
#   also written by the onDisconnect handler when a tab closes mid-game, so an
#   abandoned game looks "finished" there. gameHistory is the only true signal.
#
# Usage: bash admin/get-unfinished.sh [--days N] [--mode ai|mp]   (default: 7 days)
# Requires: firebase CLI logged in, python3

set -euo pipefail

PROJECT="cards-for-cowboys"
DAYS=7
MODE=""

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --days) DAYS="$2"; shift ;;
    --mode) MODE="$2"; shift ;;
    -h|--help)
      echo "Usage: bash admin/get-unfinished.sh [--days N] [--mode ai|mp]"
      echo "  --days N      how many days back to look (default 7)"
      echo "  --mode ai|mp  only show solo-vs-AI games, or multiplayer games"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

TMPDIR_CFC=$(mktemp -d)
trap 'rm -rf "$TMPDIR_CFC"' EXIT

echo "=== Cards For Cowboys — Unfinished Games (last ${DAYS}d) ==="
echo ""

fetch() { # fetch <path> <outfile>
  local out
  out=$(firebase database:get "$1" --project "$PROJECT" 2>&1) || {
    echo "Firebase error fetching $1:"; echo "$out"; exit 1; }
  if echo "$out" | grep -q "Error\|not logged\|permission denied"; then
    echo "Firebase error fetching $1:"; echo "$out"; exit 1
  fi
  printf '%s' "$out" > "$2"
}

fetch /liveSummary "$TMPDIR_CFC/live.json"
fetch /gameHistory "$TMPDIR_CFC/hist.json"

python3 - "$TMPDIR_CFC/live.json" "$TMPDIR_CFC/hist.json" admin/archive/livesummary.json "$DAYS" "$MODE" <<'PYEOF'
import json, os, sys, time
from datetime import datetime, timezone

live_path, hist_path, archive_path = sys.argv[1], sys.argv[2], sys.argv[3]
days, mode_filter = int(sys.argv[4]), sys.argv[5]

def load(path):
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        txt = f.read().strip()
    if not txt or txt == "null":
        return {}
    return json.loads(txt) or {}

hist = load(hist_path)

# cleanup-games.sh archives records here before removing them from Firebase, so the
# two together are the full started-game log. Live wins on conflict (fresher).
archive = load(archive_path)
live = load(live_path)
games = dict(archive)
games.update(live)

if not games:
    print("No games recorded (liveSummary and archive are both empty).")
    sys.exit(0)

now_ms = time.time() * 1000
cutoff = now_ms - days * 86400000

# Codes that reached the Showdown. gameCode was added to gameHistory in July 2026;
# older entries lack it and can't be matched (counted below as a caveat).
completed = {v["gameCode"] for v in hist.values() if v.get("gameCode")}
codeless_in_window = sum(
    1 for v in hist.values()
    if not v.get("gameCode") and v.get("ts", 0) >= cutoff
)

started, unfinished, orphans = [], [], 0
for code, v in games.items():
    ts = v.get("ts", 0)
    if not ts:
        # A node holding only {status:'finished'} — an onDisconnect tombstone that
        # landed after cleanup-games.sh removed the real node. Not a real game.
        # Only count the ones still in Firebase: archived ones are already cleared,
        # so counting those too would overstate what a cleanup run has left to do.
        if code in live:
            orphans += 1
        continue
    if ts < cutoff:
        continue
    if mode_filter and v.get("mode") != mode_filter:
        continue
    started.append(code)
    if code not in completed:
        unfinished.append((ts, code, v))

unfinished.sort(reverse=True)

n_started, n_unf = len(started), len(unfinished)
n_done = n_started - n_unf
rate = (100.0 * n_done / n_started) if n_started else 0.0
scope = f" [{mode_filter} only]" if mode_filter else ""
print(f"{n_started} game(s) started{scope}, {n_done} completed, {n_unf} unfinished "
      f"({rate:.0f}% completion)")

if n_unf:
    # How far did the abandoned games get? r1 = bounced before really playing.
    order = ["round 1 (bounced)", "rounds 2-4 (early)", "round 5+ (deep)"]
    buckets = dict.fromkeys(order, 0)
    for _, _, v in unfinished:
        r = v.get("round", 1) or 1
        key = order[0] if r <= 1 else (order[1] if r <= 4 else order[2])
        buckets[key] += 1
    print("  drop-off: " + ", ".join(f"{k} {buckets[k]}" for k in order if buckets[k]))

print()

if not unfinished:
    print("No unfinished games in this window.")
else:
    print(f"{'DATE':<12} {'CODE':<8} {'MODE':<5} {'P':<3} {'GOT TO':<12} PLAYERS")
    print("─" * 92)
    for ts, code, v in unfinished:
        d = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%m-%d %H:%M")
        got = f"r{v.get('round','?')} {v.get('phase','?')}"
        players = ", ".join(p.get("name", "?") for p in v.get("players", []))
        if len(players) > 46:
            players = players[:43] + "..."
        stale = "  <- still 'active'" if v.get("status") == "active" else ""
        print(f"{d:<12} {code:<8} {str(v.get('mode','?')):<5} {str(v.get('numPlayers','?')):<3} "
              f"{got:<12} {players}{stale}")

# --- Caveats, only printed when they can actually bite ---
notes = []
if archive:
    notes.append(f"merged {len(live)} live + {len(archive)} archived record(s) from "
                 f"{archive_path}.")
elif days > 14:
    notes.append(f"no archive at {archive_path}, and cleanup-games.sh removes liveSummary "
                 f"records at 14 days — so a {days}-day window may undercount older games.")
if codeless_in_window:
    notes.append(f"{codeless_in_window} gameHistory entr(y/ies) in this window predate the "
                 "gameCode field and cannot be matched — they may show as unfinished.")
if orphans:
    notes.append(f"{orphans} liveSummary node(s) hold only a status tombstone (no ts/players) "
                 "and were skipped. Run cleanup-games.sh to clear them.")
if notes:
    print()
    print("Notes:")
    for n in notes:
        print(f"  - {n}")
PYEOF
