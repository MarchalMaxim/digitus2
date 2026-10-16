"""Turn the PDMX gate results into a catalog fragment: content/tools/catalog.d/pdmx-library.json.

Every candidate that passed `pdmx_gate.py` becomes a piece (source 'pdmx'): its slug, title and
composer come from the archive's metadata (cleaned), its level is the frozen heuristic's proposal,
its tempo is the file's own <sound tempo> or 100 quarter notes per minute, and its notes say how
it was screened. Candidates that failed are kept in `rejected` with their first reason, as every
fragment does. A title or composer with a replacement character (a broken encoding in the
archive's metadata) is rejected rather than shipped with a wrong name.

The licence comes from PDMX.csv (`license`: publicdomain or cc-zero). Only the two values the
archive uses are accepted.

    content/.venv/Scripts/python.exe -I content/tools/pdmx_fragments.py
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE))
import pdmx_select  # noqa: E402

CONTENT = HERE.parent
RAW = CONTENT / "_raw" / "pdmx"
FRAGMENT = HERE / "catalog.d" / "pdmx-library.json"
EXCLUDED = HERE / "pdmx-excluded.json"  # committed: build failures and duplicates (see _comment)
PDMX_CSV = CONTENT.parent / "research" / "data" / "_downloads" / "pdmx" / "PDMX.csv"
TASK = 300  # the fragment's task number (catalog.d files carry the plan task that owns them)
LIMIT = 1300  # the library ships this many passing candidates that build; the rest stay recorded in `rejected`

TRADITIONAL_NAMED = re.compile(r"^(trad\.?|traditional|tradicional|anon\.?|anonymous|anonimo|anónimo)$", re.I)
ANONYMOUS = re.compile(r"^(anon\.?|anonymous|anonimo|anónimo)$", re.I)
PAREN_YEARS = re.compile(r"\s*\(\s*\d{3,4}\s*[-–]\s*\d{0,4}\s*\)")
REPLACEMENT = "�"
COLLECTION_BY_GENRE = {"folk": "pdmx-folk", "classical": "pdmx-classical", "religiousmusic": "pdmx-classical"}


def ascii_slug(text: str, limit: int = 40) -> str:
    folded = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return folded[:limit].strip("-") or "untitled"


def clean_title(title: str) -> str:
    return re.sub(r"\s+", " ", title or "").strip()


def clean_composer(name: str) -> str:
    name = re.sub(r"\s+", " ", name or "").strip()
    if TRADITIONAL_NAMED.match(name):
        return "Anonymous" if ANONYMOUS.match(name) else "Traditional"
    if not pdmx_select.composer_ok(name):
        return "Unknown"
    return PAREN_YEARS.sub("", name).strip()


def collection_for(genres: str) -> str:
    tokens = [t for t in (genres or "").split("-") if t]
    if tokens and all(t == "folk" for t in tokens):
        return COLLECTION_BY_GENRE["folk"]
    return COLLECTION_BY_GENRE["classical"]


def licence_map(paths: set[str]) -> dict[str, str]:
    """PDMX `mxl` path -> the licence field, for the candidates only."""
    csv.field_size_limit(10**9)
    out: dict[str, str] = {}
    with PDMX_CSV.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["mxl"] in paths:
                out[row["mxl"]] = row["license"]
    return out


def piece_for(gate: dict, cand: dict, licence: str) -> dict:
    sha = gate["sha256"]
    title = clean_title(cand.get("title"))
    composer = clean_composer(cand.get("composer"))
    slug = f"pdmx-{ascii_slug(title)}-{sha[:8]}"
    level = gate["level"]["level"]
    score = gate["level"]["score"]
    tempo = round(float(gate["tempo"]))
    if gate.get("tempoFromFile"):
        tempo_source = "The MuseScore file's own tempo mark (<sound tempo>)."
    else:
        tempo_source = ("editorial: the file gives no tempo, so 100 quarter notes per minute is a "
                        "playback default.")
    declared = "public domain" if licence == "publicdomain" else "CC0"
    fingerings = cand.get("fingerings") or 0
    return {
        "slug": slug,
        "source": "pdmx",
        "level": level,
        "collection": collection_for(cand.get("genres")),
        "title": title,
        "composer": composer,
        "composerDates": None,
        "catalogue": None,
        "year": None,
        "tempoBpm": tempo,
        "tempoSource": tempo_source,
        "levelNote": (f"No syllabus placement is claimed. The frozen level heuristic proposes {level} "
                      f"(score {score})."),
        "notes": (f"Solo piano score from the PDMX archive of MuseScore files. The uploader declared it "
                  f"{declared}, and PDMX found no licence conflict. Screened automatically: one sounding "
                  f"part, one or two staves, MusicXML {cand.get('version')} schema valid, no slice that one "
                  f"hand cannot strike, and zero lint law errors at the medium and large profiles. Not "
                  f"reviewed by eye. Source fingerings: {fingerings}."),
        "pdmx": {"sha256": sha, "path": cand["path"], "license": licence, "rating": cand.get("rating"),
                 "nRatings": cand.get("n_ratings"), "fingerings": fingerings, "version": cand.get("version")},
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=LIMIT,
                    help="ship at most this many passing candidates, best rated first (default %(default)s)")
    a = ap.parse_args(argv)
    gates = [json.loads(line) for line in (RAW / "gate.jsonl").open(encoding="utf-8")]
    candidates = {c["sha256"]: c for c in json.loads((RAW / "candidates.json").read_text(encoding="utf-8"))}
    licences = licence_map({c["path"] for c in candidates.values()})
    # the same order the gate ran in: the most rated candidates first
    gates.sort(key=lambda g: (-int(candidates[g["sha256"]].get("n_ratings") or 0),
                              -float(candidates[g["sha256"]].get("rating") or 0), g["sha256"]))
    # a candidate whose build failed the library's validation (verification.json, ok false) is not
    # shipped: it is kept in `rejected` with the first error, and the cap counts only the others
    verification = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
    build_failed = {slug: rec for slug, rec in verification.items()
                    if slug.startswith("pdmx-") and isinstance(rec, dict) and rec.get("ok") is False}
    # and every failure a build has ever reported: merge_results drops the record of a piece that has
    # left the catalog, so verification.json alone forgets it and the cap would admit it again
    excluded = json.loads(EXCLUDED.read_text(encoding="utf-8"))
    for slug, error in excluded["buildFailed"].items():
        build_failed.setdefault(slug, {"validation": {"": {"errors": [error]}}})
    pieces: list[dict] = []
    rejected: list[dict] = []  # only the candidates the build refused; the rest are counted in _comment
    not_shipped = {"gates": 0, "one staff": 0, "licence": 0, "beyond the cap": 0, "replacement character": 0}
    seen_slugs: set[str] = set()
    for gate in gates:
        cand = candidates[gate["sha256"]]
        title = clean_title(cand.get("title"))
        slug = f"pdmx-{ascii_slug(title)}-{gate['sha256'][:8]}"  # the slug it would have had
        if slug in build_failed:
            first = (build_failed[slug].get("validation") or {})
            errors = [e for v in first.values() for e in (v.get("errors") or [])]
            rejected.append({"slug": slug, "sha256": gate["sha256"], "title": title,
                             "reason": "failed the library's validation: " + (errors[0] if errors else "see verification")})
            continue
        if gate["ok"] and (REPLACEMENT in title or REPLACEMENT in (cand.get("composer") or "")):
            rejected.append({"slug": slug, "sha256": gate["sha256"], "title": title,
                             "reason": "the archive's title or composer has a replacement character"})
            continue
        if gate["ok"] and not pdmx_select.grand_staff(cand):
            not_shipped["one staff"] += 1
            continue
        if not gate["ok"]:
            not_shipped["gates"] += 1
            continue
        licence = licences.get(cand["path"])
        if licence not in ("publicdomain", "cc-zero"):
            rejected.append({"slug": slug, "sha256": gate["sha256"], "title": title, "reason": f"licence {licence!r}"})
            continue
        if len(pieces) >= a.limit:
            not_shipped["beyond the cap"] += 1
            continue
        piece = piece_for(gate, cand, licence)
        if piece["slug"] in seen_slugs:  # the sha prefix makes this practically impossible; keep it honest
            raise SystemExit(f"duplicate slug {piece['slug']}")
        seen_slugs.add(piece["slug"])
        pieces.append(piece)
    pieces.sort(key=lambda p: (p["level"], p["collection"], p["slug"]))
    fragment = {
        "task": TASK,
        "_comment": ("MuseScore archive pieces (PDMX, Long et al. 2025, https://zenodo.org/records/15571083): "
                     "public domain or CC0 as declared by the uploader, with no licence conflict. Chosen and "
                     "gated by content/tools/pdmx_select.py, pdmx_gate.py and pdmx_fragments.py; the notes say "
                     "what was checked. No individual engraving review: the gates are the review. Not shipped: "
                     f"{not_shipped['gates']} failed a gate (one staff, a lint law error or an unplayable slice, "
                     f"or XSD), {not_shipped['beyond the cap']} passed but ranked beyond the cap of {a.limit} "
                     f"(by rating), {not_shipped['one staff']} one-staff. Their reasons are in "
                     "content/_raw/pdmx/gate.jsonl, which is not committed; `rejected` lists only the "
                     "candidates the build refused."),
        "pieces": pieces,
        "rejected": rejected,
    }
    FRAGMENT.write_text(json.dumps(fragment, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"pieces {len(pieces)}; rejected {len(rejected)}; not shipped {not_shipped}; levels "
          f"{ {lvl: sum(1 for p in pieces if p['level'] == lvl) for lvl in range(1, 7)} }")
    return 0


if __name__ == "__main__":
    sys.exit(main())
