#!/usr/bin/env python
"""Editorial (Mutopia) vs performed (PIG) fingering on the same notes.

Four pieces exist in both corpora: Mozart K545/i (PIG 017, 6 pianists), Chopin Nocturne
Op. 9/2 (PIG 023, 5 pianists), Chopin Waltz Op. 69/2 (PIG 077, 2 pianists) and
Rachmaninoff Prelude Op. 23/9 (PIG 110, 1 pianist). PIG covers an excerpt, Mutopia the whole
piece; notes are aligned per hand by an exact longest-common-subsequence alignment of the
pitch sequences (ordered by onset, then pitch). On every aligned note that carries an
editorial fingering we compare the key-press finger with each PIG pianist and report:

* agreement with each pianist, their mean (= M_gen with Mutopia as the "estimate"),
* soft agreement (matches at least one pianist, = M_soft),
* the pianists' own pairwise agreement on the *same* notes, for reference.

    research/.venv/Scripts/python.exe -I research/scripts/compare_mutopia_pig_overlap.py
Writes research/data/reports/mutopia_vs_pig_overlap.json.
"""
from __future__ import annotations

import json
import sys
from itertools import combinations
from pathlib import Path
from statistics import mean

RESEARCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RESEARCH))

from fingering_eval.datasets import DATA, load_pig  # noqa: E402
from fingering_eval.pig_io import parse_finger, read_pig  # noqa: E402

PAIRS = [("017", "MP0998_s00_p0", "Mozart K545 i"), ("023", "MP1590_s00_p0", "Chopin Nocturne Op.9/2"),
         ("077", "MP0511_s00_p0", "Chopin Waltz Op.69/2"), ("110", "MP2052_s00_p0", "Rachmaninoff Op.23/9")]


def lcs_align(a: list[int], b: list[int]) -> list[tuple[int, int]]:
    """Index pairs of an LCS alignment of sequences a and b (dynamic programming)."""
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        ai, row, nxt = a[i], dp[i], dp[i + 1]
        for j in range(m - 1, -1, -1):
            row[j] = nxt[j + 1] + 1 if ai == b[j] else (nxt[j] if nxt[j] >= row[j + 1] else row[j + 1])
    out, i, j = [], 0, 0
    while i < n and j < m:
        if a[i] == b[j]:
            out.append((i, j))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return out


def press(f: str) -> int:
    return parse_finger(f).press


def main() -> int:
    pig = load_pig(DATA / "pig")
    report = {}
    for pid, mpid, name in PAIRS:
        mpath = DATA / "mutopia_fingering" / "FingeringFiles" / f"{mpid}-0_fingering.txt"
        if pid not in pig or not mpath.exists():
            continue
        mut = read_pig(mpath).notes
        anns = {k: v.notes for k, v in sorted(pig[pid].items())}
        ref = next(iter(anns.values()))
        rows = []   # (mutopia finger, {ann: finger})
        aligned = 0
        for ch in (0, 1):
            p_idx = sorted((i for i, n in enumerate(ref) if n.channel == ch), key=lambda i: (ref[i].onset, ref[i].pitch))
            m_idx = sorted((i for i, n in enumerate(mut) if n.channel == ch), key=lambda i: (mut[i].onset, mut[i].pitch))
            pairs = lcs_align([ref[i].pitch for i in p_idx], [mut[j].pitch for j in m_idx])
            aligned += len(pairs)
            for a, b in pairs:
                mf = mut[m_idx[b]].finger
                if mf == "0":
                    continue
                rows.append((press(mf), {k: press(v[p_idx[a]].finger) for k, v in anns.items()}))
        n = len(rows)
        if not n:
            continue
        per_ann = {k: sum(r[1][k] == r[0] for r in rows) / n for k in anns}
        soft = sum(any(f == r[0] for f in r[1].values()) for r in rows) / n
        unsigned = mean(sum(abs(r[1][k]) == abs(r[0]) for r in rows) / n for k in anns)
        pairwise = [sum(r[1][a] == r[1][b] for r in rows) / n for a, b in combinations(anns, 2)]
        report[pid] = {
            "piece": name, "mutopia_part": mpid, "pig_notes": len(ref), "aligned_notes": aligned,
            "aligned_fraction_of_pig": round(aligned / len(ref), 4), "compared_fingered_notes": n,
            "pianists": len(anns),
            "mutopia_vs_each_pianist": {k: round(v, 4) for k, v in per_ann.items()},
            "mutopia_vs_pianists_mean (M_gen)": round(mean(per_ann.values()), 4),
            "mutopia_matches_any_pianist (M_soft)": round(soft, 4),
            "mutopia_vs_pianists_mean_ignoring_hand": round(unsigned, 4),
            "pianist_pairwise_mean_same_notes": round(mean(pairwise), 4) if pairwise else None,
        }
        print(json.dumps(report[pid]))
    allrows = [r for r in report.values()]
    if allrows:
        tot = sum(r["compared_fingered_notes"] for r in allrows)
        report["_overall_note_weighted"] = {
            "compared_fingered_notes": tot,
            "M_gen": round(sum(r["mutopia_vs_pianists_mean (M_gen)"] * r["compared_fingered_notes"] for r in allrows) / tot, 4),
            "M_soft": round(sum(r["mutopia_matches_any_pianist (M_soft)"] * r["compared_fingered_notes"] for r in allrows) / tot, 4),
        }
        print(report["_overall_note_weighted"])
    dst = DATA / "reports" / "mutopia_vs_pig_overlap.json"
    dst.write_text(json.dumps(report, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
