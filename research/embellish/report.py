"""Markdown tables from the scoring run (`research/data/embellish/results.json`).

    research/.venv/Scripts/python.exe -I research/embellish/report.py [--results PATH] [--out PATH]

Prints the summary tables, and with --out writes them plus the per-piece table to a file. The
numbers in docs/research/embellishment-spike.md come from this script. License: MIT.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "data" / "embellish"
RULES = ("passing", "neighbour-repeated", "anticipation", "neighbour-long")
DENS = ("light", "playful")


def signed(x: float) -> str:
    """A change with its sign: +0.02, -0.01."""
    return f"{x:+.2f}"


def pct(a: int, b: int) -> str:
    return f"{100 * a / b:.0f}%" if b else "n/a"


def refusal_kind(r: str) -> str:
    if r.startswith("no voice owns"):
        return "two right-hand voices share the top line"
    if r.startswith("the melody voice plays chords"):
        return "the melody voice plays chords"
    if "staff" in r:
        return "not two staves"
    if "parts" in r:
        return "not one piano part"
    if r.startswith("own check failed"):
        return "the own check failed"
    return r


def load(path: Path) -> dict[str, dict[str, dict]]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    by: dict[str, dict[str, dict]] = defaultdict(dict)
    for r in rows:
        by[r["slug"]][r["density"]] = r
    return by


def rh_notes(row: dict) -> int | None:
    return row.get("lint", {}).get("notes")


def tables(by: dict[str, dict[str, dict]]) -> tuple[str, str]:
    lines: list[str] = []
    n = len(by)
    lv = Counter(p["none"]["level"] for p in by.values())
    refused = {s: p["light"]["refusal"] for s, p in by.items() if p["light"]["refusal"]}
    plain_law = sum(1 for p in by.values() if p["none"].get("lint", {}).get("law_errors", 0) > 0)
    plain_beg = sum(1 for p in by.values() if p["none"].get("lint", {}).get("beginner_errors", 0) > 0)
    lines.append(f"Pieces: {n} (level 1: {lv[1]}, level 2: {lv[2]}). Refused: {len(refused)}. "
                 f"Plain scores with a law error under the beginner solve: {plain_law}; with a beginner error "
                 f"(L06, L10): {plain_beg}.\n")
    # summary per density
    head = ("| Measure | light | playful |\n|---|---:|---:|")
    rows = []

    def per(fn):
        return [fn(d) for d in DENS]

    def emb(d):
        return [p for p in by.values() if not p[d]["refusal"] and p[d]["inserted"] > 0]

    def none_added(d):
        return [p for p in by.values() if not p[d]["refusal"] and p[d]["inserted"] == 0]

    rows.append(("Pieces embellished (at least one note added)", per(lambda d: f"{len(emb(d))} of {n}")))
    rows.append(("Pieces accepted with nothing to add", per(lambda d: str(len(none_added(d))))))
    rows.append(("Pieces refused", per(lambda d: str(sum(1 for p in by.values() if p[d]["refusal"])))))
    rows.append(("Notes added, total", per(lambda d: str(sum(p[d]["inserted"] for p in emb(d))))))
    rows.append(("Figures per embellished piece, median",
                 per(lambda d: f"{statistics.median([p[d]['figures'] for p in emb(d)]):.0f}" if emb(d) else "n/a")))
    rows.append(("Notes added as a share of the piece's notes, median",
                 per(lambda d: f"{statistics.median([p[d]['inserted'] / p['none']['lint']['notes'] for p in emb(d)]) * 100:.1f}%"
                     if emb(d) else "n/a")))
    rows.append(("Own check passes (untouched notes, strong positions)",
                 per(lambda d: f"{sum(1 for p in emb(d) if p[d]['check']['ok'])} of {len(emb(d))}")))
    rows.append(("Melody pitches on strong positions kept",
                 per(lambda d: f"{sum(p[d]['check']['strong_kept'] for p in emb(d))} of "
                               f"{sum(p[d]['check']['strong_total'] for p in emb(d))}")))
    rows.append(("Engine reads the file (`inspect`)",
                 per(lambda d: f"{sum(1 for p in emb(d) if p[d].get('inspect_ok'))} of {len(emb(d))}")))
    rows.append(("Zero law errors (L01-L05)",
                 per(lambda d: f"{sum(1 for p in emb(d) if p[d]['lint']['law_errors'] == 0)} of {len(emb(d))} "
                               f"({pct(sum(1 for p in emb(d) if p[d]['lint']['law_errors'] == 0), len(emb(d)))})")))
    rows.append(("More law errors than the plain score",
                 per(lambda d: str(sum(1 for p in emb(d) if p[d]['lint']['law_errors'] > p['none']['lint']['law_errors'])))))
    rows.append(("Zero beginner errors (L06, L10)",
                 per(lambda d: f"{sum(1 for p in emb(d) if p[d]['lint']['beginner_errors'] == 0)} of {len(emb(d))}")))
    rows.append(("More beginner errors than the plain score",
                 per(lambda d: str(sum(1 for p in emb(d)
                                       if p[d]['lint']['beginner_errors'] > p['none']['lint']['beginner_errors'])))))
    rows.append(("Warnings per 1,000 notes, plain to embellished (embellished pieces)",
                 per(lambda d: f"{_rate(emb(d), 'none'):.0f} to {_rate(emb(d), d):.0f}")))

    def lvl(d, k):
        return sum(1 for p in emb(d) if p[d]["level_heuristic"]["proposal"] - p["none"]["level_heuristic"]["proposal"] == k)
    rows.append(("Level proposal unchanged", per(lambda d: f"{lvl(d, 0)} ({pct(lvl(d, 0), len(emb(d)))})")))
    rows.append(("Level proposal one up", per(lambda d: f"{lvl(d, 1)} ({pct(lvl(d, 1), len(emb(d)))})")))
    rows.append(("Level proposal two or more up",
                 per(lambda d: str(sum(1 for p in emb(d) if p[d]["level_heuristic"]["proposal"]
                                       - p["none"]["level_heuristic"]["proposal"] >= 2)))))
    rows.append(("Level score change, median",
                 per(lambda d: signed(statistics.median([p[d]['level_heuristic']['score'] - p['none']['level_heuristic']['score']
                                                         for p in emb(d)])) if emb(d) else "n/a")))
    lines.append("### Summary per density\n")
    lines.append(head)
    for label, vals in rows:
        lines.append(f"| {label} | " + " | ".join(vals) + " |")
    lines.append("")
    # inserted notes per rule
    lines.append("### Figures per rule\n")
    lines.append("| Rule | light | playful | candidates found (all densities see the same) |\n|---|---:|---:|---:|")
    cand = Counter()
    for p in by.values():
        cand.update(p["playful"].get("candidates", {}))
    for rule in RULES:
        vals = [str(sum(p[d]["by_rule"].get(rule, 0) for p in by.values())) for d in DENS]
        lines.append(f"| {rule} | " + " | ".join(vals) + f" | {cand[rule]} |")
    lines.append("")
    # skipped
    lines.append("### Notes the rules looked at and left alone (playful, all pieces)\n")
    lines.append("| Reason | Count |\n|---|---:|")
    sk = Counter()
    for p in by.values():
        sk.update(p["playful"].get("skipped", {}))
    for reason, c in sk.most_common():
        lines.append(f"| {reason} | {c} |")
    lines.append("")
    # refusals
    lines.append("### Refusals\n")
    lines.append("| Reason | Level 1 | Level 2 |\n|---|---:|---:|")
    rk = Counter((refusal_kind(r), by[s]["none"]["level"]) for s, r in refused.items())
    for kind in sorted({k for k, _ in rk}):
        lines.append(f"| {kind} | {rk[(kind, 1)]} | {rk[(kind, 2)]} |")
    lines.append("")
    # level transitions
    lines.append("### Level proposal before and after (embellished pieces)\n")
    lines.append("| Catalogue level | Proposal of the plain score | light: proposals after | playful: proposals after |\n|---|---|---|---|")
    groups = defaultdict(lambda: {d: Counter() for d in DENS})
    for p in by.values():
        key = (p["none"]["level"], p["none"]["level_heuristic"]["proposal"])
        for d in DENS:
            if not p[d]["refusal"] and p[d]["inserted"] > 0:
                groups[key][d][p[d]["level_heuristic"]["proposal"]] += 1
    for (cat, before), g in sorted(groups.items()):
        cells = [", ".join(f"{k}: {v}" for k, v in sorted(g[d].items())) or "-" for d in DENS]
        lines.append(f"| {cat} | {before} | " + " | ".join(cells) + " |")
    lines.append("")
    # lint rules added
    lines.append("### Lint counts, summed over the embellished pieces (plain / light / playful, same pieces)\n")
    both = [p for p in by.values() if all(not p[d]["refusal"] and p[d]["inserted"] > 0 for d in DENS)]
    lines.append(f"{len(both)} pieces embellished at both densities.\n")
    lines.append("| Rule | plain | light | playful |\n|---|---:|---:|---:|")
    rules = sorted({k for p in both for d in ("none",) + DENS for k in p[d]["lint"]["counts"]})
    for r in rules:
        vals = [str(sum(p[d]["lint"]["counts"].get(r, 0) for p in both)) for d in ("none",) + DENS]
        lines.append(f"| {r} | " + " | ".join(vals) + " |")
    lines.append(f"| notes | " + " | ".join(str(sum(p[d]["lint"]["notes"] for p in both)) for d in ("none",) + DENS) + " |")
    lines.append("")
    summary = "\n".join(lines)
    # per piece
    pp = ["| Piece | Cat. | Proposal plain / light / playful | Added light / playful | Law errors plain / light / playful "
          "| Beginner errors plain / light / playful | Strong kept | Note |",
          "|---|---:|---|---|---|---|---|---|"]
    for slug in sorted(by, key=lambda s: (by[s]["none"]["level"], s)):
        p = by[slug]
        prop = [str(p["none"]["level_heuristic"]["proposal"])]
        law = [str(p["none"]["lint"]["law_errors"])]
        beg = [str(p["none"]["lint"]["beginner_errors"])]
        add, kept, note = [], [], ""
        for d in DENS:
            r = p[d]
            if r["refusal"]:
                note = "refused: " + refusal_kind(r["refusal"])
                prop.append("-"), law.append("-"), beg.append("-"), add.append("-")
                continue
            add.append(str(r["inserted"]))
            if r["inserted"]:
                prop.append(str(r["level_heuristic"]["proposal"]))
                law.append(str(r["lint"]["law_errors"]))
                beg.append(str(r["lint"]["beginner_errors"]))
                kept.append(f"{r['check']['strong_kept']}/{r['check']['strong_total']}")
            else:
                prop.append("="), law.append("="), beg.append("=")
        pp.append(f"| {slug} | {p['none']['level']} | {' / '.join(prop)} | {' / '.join(add)} | {' / '.join(law)} | "
                  f"{' / '.join(beg)} | {', '.join(dict.fromkeys(kept)) or '-'} | {note} |")
    return summary, "\n".join(pp)


def _rate(pieces: list[dict], d: str) -> float:
    w = sum(p[d]["lint"]["warnings"] for p in pieces)
    notes = sum(p[d]["lint"]["notes"] for p in pieces)
    return 1000 * w / notes if notes else 0.0


def main(argv=None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", type=Path, default=OUT / "results.json")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args(argv)
    summary, per_piece = tables(load(a.results))
    print(summary)
    if a.out:
        a.out.write_text(summary + "\n\n### Per piece\n\n" + per_piece + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
