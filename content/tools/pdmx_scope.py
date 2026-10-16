"""Keep modern popular music out of the archive pieces.

MuseScore's genre tags are the uploader's: a pop song can carry "classical" or "folk". The library's
scope (user, 2026-10-14) is classical and traditional music, so the archive candidates are reviewed by
title and composer before they ship.

    pdmx_scope.py export            writes content/_build/scope/items.txt, one candidate per line
                                    (number, title, composer, level), best rated first, and index.json
    pdmx_scope.py apply VOTES.json  reads the reviewers' votes and writes `outOfScope` into
                                    content/tools/pdmx-excluded.json

VOTES.json is a list with one entry per reviewer: {"reviewer": name, "flagged": [{"id": n, "reason": text}]}.
A candidate is out of scope when any reviewer flags it (AGREE = 1). The first plan wanted two of three;
on the first run 12 of the 59 flagged candidates had a single flag, and reading them showed 11 right
(Katyusha, a TV-series Bella Ciao, a jazz Fantasie Impromptu, a meme piece, a joke) and one unclear, so
the cheaper mistake is to drop a piece. `pdmx_fragments.py` skips every `outOfScope` candidate.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
CONTENT = HERE.parent
RAW = CONTENT / "_raw" / "pdmx"
OUT = CONTENT / "_build" / "scope"
EXCLUDED = HERE / "pdmx-excluded.json"
REVIEW_LIMIT = 2000  # ordinary candidates in rating order; the advanced candidates are all included
AGREE = 1

import pdmx_advanced  # noqa: E402
import pdmx_fragments as fr  # noqa: E402
import pdmx_select  # noqa: E402


def review_set() -> list[dict]:
    """The candidates the fragment generator would consider, in its order."""
    gates = [json.loads(line) for line in (RAW / "gate.jsonl").open(encoding="utf-8")]
    candidates = {c["sha256"]: c for c in json.loads((RAW / "candidates.json").read_text(encoding="utf-8"))}
    gates = [g for g in gates if g["sha256"] in candidates and g["ok"]]
    gates.sort(key=lambda g: (-int(candidates[g["sha256"]].get("n_ratings") or 0),
                              -float(candidates[g["sha256"]].get("rating") or 0), g["sha256"]))
    excluded = json.loads(EXCLUDED.read_text(encoding="utf-8"))
    verification = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
    skip = set(excluded["buildFailed"]) | {s for s, r in verification.items()
                                           if s.startswith("pdmx-") and isinstance(r, dict) and r.get("ok") is False}
    skip |= set(excluded.get("duplicates", {}))
    items, ordinary = [], 0
    for g in gates:
        cand = candidates[g["sha256"]]
        title = fr.clean_title(cand.get("title"))
        slug = f"pdmx-{fr.ascii_slug(title)}-{g['sha256'][:8]}"
        if slug in skip or g["sha256"] in skip or fr.REPLACEMENT in title or not pdmx_select.grand_staff(cand):
            continue
        advanced = bool(pdmx_advanced.advanced(g["level"], cand["notes"]))
        if not advanced:
            if ordinary >= REVIEW_LIMIT:
                continue
            ordinary += 1
        items.append({"sha256": g["sha256"], "slug": slug, "title": title,
                      "composer": fr.clean_composer(cand.get("composer")), "level": g["level"]["level"]})
    return items


def export() -> None:
    items = review_set()
    OUT.mkdir(parents=True, exist_ok=True)
    lines = [f"{n}\t{i['title']}\t{i['composer']}\tlevel {i['level']}" for n, i in enumerate(items, 1)]
    (OUT / "items.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT / "index.json").write_text(json.dumps({str(n): i["sha256"] for n, i in enumerate(items, 1)}), encoding="utf-8")
    (OUT / "titles.json").write_text(json.dumps({str(n): [i["title"], i["composer"]] for n, i in enumerate(items, 1)},
                                                ensure_ascii=False), encoding="utf-8")
    print(f"{len(items)} candidates to review -> {OUT / 'items.txt'}")


def apply(votes_path: Path) -> None:
    votes = json.loads(votes_path.read_text(encoding="utf-8"))
    index = json.loads((OUT / "index.json").read_text(encoding="utf-8"))
    titles = json.loads((OUT / "titles.json").read_text(encoding="utf-8"))
    tally: dict[str, list[str]] = {}
    for vote in votes:
        for flag in vote["flagged"]:
            tally.setdefault(str(flag["id"]), []).append(f"{vote['reviewer']}: {flag['reason']}")
    out_of_scope = {index[n]: "; ".join(reasons) for n, reasons in tally.items() if n in index and len(reasons) >= AGREE}
    single = {n: r for n, r in tally.items() if len(r) < AGREE}
    doc = json.loads(EXCLUDED.read_text(encoding="utf-8"))
    doc["outOfScope"] = dict(sorted(out_of_scope.items()))
    EXCLUDED.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"flagged by {AGREE} or more reviewers (removed): {len(out_of_scope)}; flagged by one (kept): {len(single)}")
    counts = Counter(len(r) for r in tally.values())
    print(f"votes per flagged candidate: {dict(sorted(counts.items()))}")
    for n, reasons in list(tally.items())[:0]:
        print(titles[n], reasons)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("export")
    p = sub.add_parser("apply")
    p.add_argument("votes", type=Path)
    a = ap.parse_args(argv)
    export() if a.cmd == "export" else apply(a.votes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
