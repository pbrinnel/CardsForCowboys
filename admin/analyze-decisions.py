#!/usr/bin/env python3
"""Analyze decisionLog telemetry for one game: human play vs the hard-AI (outlaw)
counterfactual, decomposed into draw-phase and buy-phase divergence.

Usage:
  firebase database:get /decisionLog/CODE --project cards-for-cowboys > log.json
  python3 admin/analyze-decisions.py log.json [WinnerName]

Reads the raw decisionLog JSON (a dict of push-key -> record). Optionally pass the
winner's name to label the per-player summaries.
"""
import sys, json
from collections import defaultdict, Counter

def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else float('nan')

def main():
    path = sys.argv[1]
    winner = sys.argv[2] if len(sys.argv) > 2 else None
    with open(path) as f:
        data = json.load(f) or {}
    rows = list(data.values())
    rows.sort(key=lambda r: r.get('ts', 0))

    by_player = defaultdict(list)
    for r in rows:
        by_player[r.get('player', '?')].append(r)

    print(f"\n=== Decision telemetry — {len(rows)} records, {len(by_player)} players ===")
    if winner:
        print(f"    Winner: {winner}")

    for player, prs in sorted(by_player.items(), key=lambda kv: kv[0] != winner):
        tag = "  [WINNER]" if player == winner else ""
        draws = [r for r in prs if r.get('kind') == 'draw']
        buys  = [r for r in prs if r.get('kind') == 'buy']
        print(f"\n--- {player}{tag}  ({len(draws)} draw decisions, {len(buys)} buy decisions) ---")

        # ---------- DRAW DECOMPOSITION ----------
        if draws:
            agree = sum(1 for r in draws if r.get('humanDrew') == r.get('aiWouldDraw'))
            more_aggressive = [r for r in draws if r.get('humanDrew') and not r.get('aiWouldDraw')]
            more_conserv    = [r for r in draws if not r.get('humanDrew') and r.get('aiWouldDraw')]
            stops = [r for r in draws if not r.get('humanDrew')]
            print(f"  DRAW: agreement with outlaw {agree}/{len(draws)} ({100*agree/len(draws):.0f}%)")
            print(f"        human MORE aggressive than outlaw (drew, AI would stop): {len(more_aggressive)}")
            print(f"        human MORE cautious  than outlaw (stopped, AI would draw): {len(more_conserv)}")
            if stops:
                print(f"        when human STOPPED (n={len(stops)}): "
                      f"avg bandits={mean([r.get('bandits') for r in stops]):.2f}, "
                      f"avg bustProb={mean([r.get('bustProb') for r in stops]):.3f}, "
                      f"avg deckLeft={mean([r.get('deckRemaining') for r in stops]):.1f}")
            risky = [r for r in draws if r.get('humanDrew') and r.get('bandits', 0) >= 2]
            print(f"        aggressive draws taken at 2 bandits: {len(risky)} "
                  f"(avg bustProb at those draws={mean([r.get('bustProb') for r in risky]):.3f})")

        # ---------- BUY DECOMPOSITION ----------
        if buys:
            ranked = [r for r in buys if r.get('humanPickRank') is not None]
            bought = [r for r in buys if r.get('humanAction') == 'buy']
            burned = [r for r in buys if r.get('humanAction') == 'burn']
            matched = sum(1 for r in ranked if r.get('humanPickRank') == 1)
            dist = Counter(r.get('humanPickRank') for r in ranked)
            # action divergence
            bought_ai_burn = sum(1 for r in bought if r.get('aiAction') == 'burn')
            burned_ai_buy  = sum(1 for r in burned if r.get('aiAction') == 'buy')
            print(f"  BUY: {len(bought)} buys, {len(burned)} burns")
            if ranked:
                print(f"       picked outlaw's #1 card: {matched}/{len(ranked)} ({100*matched/len(ranked):.0f}%), "
                      f"mean pick rank={mean([r.get('humanPickRank') for r in ranked]):.2f}")
                print(f"       pick-rank distribution: " +
                      ", ".join(f"#{k}:{dist[k]}" for k in sorted(dist)))
            print(f"       bought a card outlaw would've burned: {bought_ai_burn}")
            print(f"       burned a card outlaw would've bought: {burned_ai_buy}")
    print()

if __name__ == '__main__':
    main()
