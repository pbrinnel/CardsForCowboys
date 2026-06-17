#!/usr/bin/env python3
"""Compare sim card tierlists to real human game data.

Pulls together:
  1. Sim tierlist JSON  (from gen-sim-tierlist.js)
  2. Firebase gameHistory dump  (all games, including gameCode + winner info)
  3. Firebase decisionLog dump  (human buy/burn decisions, keyed by game code)

Outputs a ranked comparison table showing which cards are over- or under-valued
by real players relative to what the sim says winners should be buying.

Usage:
  # Generate sim tierlist
  node admin/gen-sim-tierlist.js > sim/results/sim-tierlist.json

  # Pull Firebase data
  firebase database:get /gameHistory --project cards-for-cowboys > /tmp/gameHistory.json
  firebase database:get /decisionLog --project cards-for-cowboys > /tmp/decisionLog.json

  # Compare
  python3 admin/compare-tierlists.py \\
      sim/results/sim-tierlist.json \\
      /tmp/gameHistory.json \\
      /tmp/decisionLog.json

Options:
  --min-buys N    Minimum human buy count to include card in table (default: 3)
  --act N         Filter to a specific act (1, 2, or 3)
  --sort field    Sort by: sim_lift (default), human_lift, divergence, card_id, act
  --no-color      Disable ANSI color output
"""

import sys, json, math, os
from collections import defaultdict

# ── ANSI colors ───────────────────────────────────────────────────────────────
USE_COLOR = True

def bold(s):    return f'\033[1m{s}\033[0m'    if USE_COLOR else s
def green(s):   return f'\033[32m{s}\033[0m'   if USE_COLOR else s
def red(s):     return f'\033[31m{s}\033[0m'   if USE_COLOR else s
def yellow(s):  return f'\033[33m{s}\033[0m'   if USE_COLOR else s
def dim(s):     return f'\033[2m{s}\033[0m'    if USE_COLOR else s
def cyan(s):    return f'\033[36m{s}\033[0m'   if USE_COLOR else s

# ── Card label helpers ────────────────────────────────────────────────────────
SUIT = {1: 'River', 2: 'Cactus', 3: 'Snake'}

def card_label(c):
    suit = SUIT.get(c.get('cacti'), '?')
    cows = c.get('cows', 0)
    dlrs = c.get('dollars', 0)
    bndts = c.get('bandits', 0)
    sp   = c.get('special') or ''
    parts = []
    if cows:   parts.append(f'{cows:+}cow')
    if dlrs:   parts.append(f'{dlrs:+}$')
    if bndts:  parts.append(f'{bndts:+}ban')
    if sp:     parts.append(f'[{sp}]')
    stats = ' '.join(parts) or 'utility'
    return f"{c['id']}  A{c['act']} {suit} ${c.get('cost',0)}  {stats}"

def lift_bar(lift, width=12):
    """ASCII bar centered on 1.0."""
    if lift is None:
        return dim('─' * width + '  n/a')
    center = width // 2
    pos = int(round((lift - 1.0) * center))  # each step = 1/center above baseline
    pos = max(-center, min(center, pos))
    bar = [' '] * width
    bar[center] = '│'
    if pos > 0:
        for i in range(center + 1, center + pos + 1):
            if i < width: bar[i] = '█'
    elif pos < 0:
        for i in range(center + pos, center):
            if i >= 0: bar[i] = '█'
    s = ''.join(bar)
    color = green if lift > 1.05 else (red if lift < 0.95 else yellow)
    return color(s) + f'  {lift:.2f}x'

def divergence_label(sim_lift, human_lift):
    """Describe the gap between sim and human valuation."""
    if sim_lift is None or human_lift is None:
        return dim('—')
    delta = human_lift - sim_lift
    if abs(delta) < 0.15:
        return dim('aligned')
    if delta > 0:
        return green(f'humans +{delta:.2f} above sim')
    return red(f'humans {delta:.2f} below sim')

# ── Load helpers ──────────────────────────────────────────────────────────────
def load_json(path):
    with open(path) as f:
        return json.load(f) or {}

# ── Parse args ────────────────────────────────────────────────────────────────
def parse_args():
    global USE_COLOR
    args = sys.argv[1:]
    opts = {
        'sim_path': None,
        'history_path': None,
        'dlog_path': None,
        'min_buys': 3,
        'act': None,
        'sort': 'sim_lift',
    }
    positional = []
    i = 0
    while i < len(args):
        if args[i] == '--min-buys' and i + 1 < len(args):
            opts['min_buys'] = int(args[i + 1]); i += 2
        elif args[i] == '--act' and i + 1 < len(args):
            opts['act'] = int(args[i + 1]); i += 2
        elif args[i] == '--sort' and i + 1 < len(args):
            opts['sort'] = args[i + 1]; i += 2
        elif args[i] == '--no-color':
            USE_COLOR = False; i += 1
        else:
            positional.append(args[i]); i += 1

    if len(positional) < 3:
        print(__doc__)
        sys.exit(1)
    opts['sim_path']     = positional[0]
    opts['history_path'] = positional[1]
    opts['dlog_path']    = positional[2]
    return opts

# ── Build winner lookup: gameCode → set of winner names ──────────────────────
def build_winner_lookup(history_data):
    """Returns dict: gameCode -> {'winners': set(name), 'players': set(name)}"""
    lookup = {}
    entries = list(history_data.values()) if isinstance(history_data, dict) else history_data
    for entry in entries:
        code = entry.get('gameCode')
        if not code:
            continue
        players_list = entry.get('players', [])
        winners = {p['name'] for p in players_list if p.get('isWinner')}
        players = {p['name'] for p in players_list}
        if code not in lookup:
            lookup[code] = {'winners': set(), 'players': set()}
        lookup[code]['winners'].update(winners)
        lookup[code]['players'].update(players)
    return lookup

# ── Build human card stats from decisionLog ───────────────────────────────────
def build_human_stats(dlog_data, winner_lookup):
    """
    Returns dict: cardId -> {'buyCount': int, 'winnerBuyCount': int,
                              'burnCount': int, 'winnerBurnCount': int}
    Only counts buy actions (not burns) for the tierlist; burn data kept for context.
    """
    stats = defaultdict(lambda: {'buyCount': 0, 'winnerBuyCount': 0,
                                 'burnCount': 0, 'winnerBurnCount': 0,
                                 'missingWinnerInfo': 0})

    # dlog_data shape: { code: { pushKey: record } }  OR  flat list
    if isinstance(dlog_data, dict):
        code_entries = dlog_data.items()
    else:
        # Shouldn't happen from a normal Firebase dump, but handle gracefully
        print('[WARN] Unexpected decisionLog shape; skipping.', file=sys.stderr)
        return stats

    for code, records in code_entries:
        game_info = winner_lookup.get(code)
        if game_info is None:
            # Game exists in decisionLog but not gameHistory (test game or incomplete)
            for rec in (records.values() if isinstance(records, dict) else []):
                card_id = rec.get('humanCardId')
                if rec.get('kind') == 'buy' and card_id:
                    stats[card_id]['missingWinnerInfo'] += 1
            continue

        winners = game_info['winners']
        for rec in (records.values() if isinstance(records, dict) else []):
            if rec.get('kind') != 'buy':
                continue
            card_id = rec.get('humanCardId')
            player  = rec.get('player', '')
            action  = rec.get('humanAction', '')
            if not card_id:
                continue
            is_winner = player in winners
            if action == 'buy':
                stats[card_id]['buyCount'] += 1
                if is_winner:
                    stats[card_id]['winnerBuyCount'] += 1
            elif action == 'burn':
                stats[card_id]['burnCount'] += 1
                if is_winner:
                    stats[card_id]['winnerBurnCount'] += 1

    return stats

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    opts = parse_args()

    print(f'\nLoading sim tierlist: {opts["sim_path"]}')
    sim_data = load_json(opts['sim_path'])
    meta      = sim_data.get('meta', {})
    sim_cards = sim_data.get('cards', [])

    print(f'Loading gameHistory:  {opts["history_path"]}')
    history_data = load_json(opts['history_path'])

    print(f'Loading decisionLog:  {opts["dlog_path"]}')
    dlog_data = load_json(opts['dlog_path'])

    print('Processing...\n')

    winner_lookup = build_winner_lookup(history_data)
    human_stats   = build_human_stats(dlog_data, winner_lookup)

    # ── Human baseline: total winner buys / total buys across all cards ──────
    total_human_buys   = sum(s['buyCount']      for s in human_stats.values())
    total_winner_buys  = sum(s['winnerBuyCount'] for s in human_stats.values())
    human_baseline     = total_winner_buys / max(1, total_human_buys)

    # ── Merge sim + human ────────────────────────────────────────────────────
    rows = []
    for sc in sim_cards:
        cid = sc['id']
        if opts['act'] and sc.get('act') != opts['act']:
            continue

        hs = human_stats.get(cid, {})
        h_buy    = hs.get('buyCount', 0)
        h_wbuy   = hs.get('winnerBuyCount', 0)
        h_burn   = hs.get('burnCount', 0)
        missing  = hs.get('missingWinnerInfo', 0)

        h_winner_rate = (h_wbuy / h_buy) if h_buy > 0 else None
        h_lift = (h_winner_rate / human_baseline) if (h_winner_rate is not None and human_baseline > 0) else None

        rows.append({
            **sc,
            'h_buy':        h_buy,
            'h_wbuy':       h_wbuy,
            'h_burn':       h_burn,
            'h_missing':    missing,
            'h_winner_rate': h_winner_rate,
            'h_lift':       h_lift,
            'divergence':   (h_lift - sc['winnerLift'])
                            if (h_lift is not None and sc['winnerLift'] is not None)
                            else None,
        })

    # ── Sort ─────────────────────────────────────────────────────────────────
    sort_key = opts['sort']
    def sort_fn(r):
        if sort_key == 'human_lift':
            v = r['h_lift'];       return (0, -v) if v is not None else (1, 0)
        if sort_key == 'divergence':
            v = r['divergence'];   return (0, -abs(v)) if v is not None else (1, 0)
        if sort_key == 'card_id':
            return (0, r['id'])
        if sort_key == 'act':
            return (r['act'], -(r['winnerLift'] or 0))
        # default: sim_lift
        v = r['winnerLift'];       return (0, -v) if v is not None else (1, 0)
    rows.sort(key=sort_fn)

    # ── Print summary ─────────────────────────────────────────────────────────
    n_games     = meta.get('totalGames', '?')
    sim_players = meta.get('playerCounts', '?')
    sim_gen     = meta.get('generated', '?')[:16]

    print(bold('═' * 100))
    print(bold('  Cards For Cowboys — Sim vs Human Card Tierlist Comparison'))
    print(bold('═' * 100))
    print(f'  Sim: {n_games} games, player counts {sim_players}  (generated {sim_gen})')
    print(f'  Human data: {len(winner_lookup)} games with winner info, '
          f'{total_human_buys} buy decisions ({total_winner_buys} from winners)')
    print(f'  Human baseline (winner share of buys): {human_baseline:.3f}')
    print(f'  Sorted by: {sort_key}')
    if opts['act']:
        print(f'  Filtered to: Act {opts["act"]}')
    if opts['min_buys'] > 0:
        print(f'  Min human buys to show lift: {opts["min_buys"]}')
    print()

    # ── Table header ─────────────────────────────────────────────────────────
    COL1 = 52
    print(f'  {"Card":<{COL1}}  {"Sim lift":^16}  {"Human lift":^16}  {"Divergence"}')
    print(f'  {"":─<{COL1}}  {"":─<16}  {"":─<16}  {"":─<30}')

    # ── Table rows ───────────────────────────────────────────────────────────
    prev_act = None
    show_act_headers = (sort_key == 'act')
    for r in rows:
        if show_act_headers and r['act'] != prev_act:
            prev_act = r['act']
            act_num = r['act']
            print(f'\n  {bold(f"── Act {act_num} ─────────────────────────────────────────────────────────────────────────────────────────")}')

        label   = card_label(r)
        s_lift  = r['winnerLift']
        h_lift  = r['h_lift'] if r['h_buy'] >= opts['min_buys'] else None
        h_count = r['h_buy']

        sim_col   = lift_bar(s_lift)
        human_col = lift_bar(h_lift)
        if h_lift is None and h_count > 0:
            human_col = dim(f'{"─" * 12}  {h_count} buy{"s" if h_count != 1 else ""} (too few)')
        elif h_lift is None:
            human_col = dim(f'{"─" * 12}  no human data')
        else:
            human_col = lift_bar(h_lift) + dim(f'  n={h_count}')

        div = divergence_label(s_lift, r['h_lift'] if r['h_buy'] >= opts['min_buys'] else None)

        print(f'  {label:<{COL1}}  {sim_col}  {human_col}  {div}')

        # Warn if card has missing winner info (game in dlog but not history)
        if r['h_missing'] > 0:
            print(dim(f'    ↳ {r["h_missing"]} buy(s) for this card have no winner data (test games?)'))

    print()
    print(bold('═' * 100))

    # ── Top divergences summary ───────────────────────────────────────────────
    strong_divs = [r for r in rows if r['divergence'] is not None and r['h_buy'] >= opts['min_buys']]
    strong_divs.sort(key=lambda r: -abs(r['divergence']))

    if strong_divs:
        print(f'\n  {bold("Top divergences")} (sim vs human, requires ≥{opts["min_buys"]} human buys)')
        print(f'  {"Card":<{COL1}}  sim lift  human lift  delta')
        for r in strong_divs[:10]:
            delta = r['divergence']
            tag = green(f'humans +{delta:+.2f}') if delta > 0 else red(f'humans {delta:+.2f}')
            sl = f'{r["winnerLift"]:.2f}x' if r['winnerLift'] is not None else '  n/a'
            hl = f'{r["h_lift"]:.2f}x'
            print(f'  {card_label(r):<{COL1}}  {sl:>8}  {hl:>10}  {tag}')

    print()

    # ── Cards humans buy most (absolute counts) ───────────────────────────────
    by_buys = sorted([r for r in rows if r['h_buy'] > 0], key=lambda r: -r['h_buy'])
    if by_buys:
        print(f'  {bold("Most purchased by humans")} (top 10 by raw buy count)')
        for r in by_buys[:10]:
            pct = f'{r["h_wbuy"] / r["h_buy"] * 100:.0f}% won' if r['h_buy'] > 0 else ''
            print(f'  {card_label(r):<{COL1}}  {r["h_buy"]:>3} buys  {pct}')

    print()

if __name__ == '__main__':
    main()
