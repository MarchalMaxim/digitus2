"""Choose the solo piano scores from the PDMX screen and copy them out of the archive.

Input: `content/_raw/pdmx/screen.jsonl` (from `pdmx_screen.py`). The choice keeps the library's
scope: a classical, folk or religious genre tag (MuseScore's own tags; unlabelled scores are
left out because nothing says what they are), a named composer or a traditional or anonymous
attribution, and 40 to 2,500 notes. An unnamed composer is kept (the library shows it as
unknown): the licence rule is the uploader's declaration, not the author's date. Duplicates go too: one score per normalised title and
composer (the most rated), and one per identical MusicXML.

Output: `content/_raw/pdmx/candidates.json` (the kept facts, sorted by sha256) and
`content/_raw/pdmx/selected/<sha256>.mxl`, byte for byte as published, copied in a second
pass over the archive. Gitignored; `pdmx_gate.py` reads them next.

    content/.venv/Scripts/python.exe -I content/tools/pdmx_select.py \
        --archive research/data/_downloads/pdmx/mxl.tar.gz
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
REPO = HERE.parent.parent
RAW = REPO / "content" / "_raw" / "pdmx"

GENRE_TOKENS = {"classical", "folk", "religiousmusic"}
MIN_NOTES, MAX_NOTES = 40, 2500
PLACEHOLDER_WORDS = ("urheber", "unbekannt", "unknown", "unattributed", "composer", "various")
TRADITIONAL = re.compile(r"^(trad\.?|traditional|tradicional|tradicional\.?|anon\.?|anonymous|anonimo|anónimo)$", re.I)


def normalise(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def composer_ok(name: str | None) -> bool:
    """A named composer, or a traditional or anonymous attribution (traditional tunes are public domain)."""
    name = (name or "").strip()
    if not name or name.upper() == "NA":
        return False
    if TRADITIONAL.match(name):
        return True
    low = name.lower()
    if any(word in low for word in PLACEHOLDER_WORDS) or len(name) > 60:
        return False
    return bool(re.search(r"[a-z]{2}", low))


def is_eligible(record: dict) -> bool:
    if not record.get("accepted"):
        return False
    tokens = set((record.get("genres") or "").split("-"))
    if not tokens or not tokens <= GENRE_TOKENS:
        return False
    return MIN_NOTES <= (record.get("notes") or 0) <= MAX_NOTES


def grand_staff(record: dict) -> bool:
    """The library's rule (validate.py): exactly one sounding part with two staves. The app takes the
    hand from the staff, so a single-staff piano score would be fingered as one hand."""
    sounding = [part for part in record.get("parts") or [] if part.get("pitched", 0) > 0]
    return len(sounding) == 1 and sounding[0].get("staves") == 2


def rating_key(record: dict) -> tuple:
    try:
        votes = int(record.get("n_ratings") or 0)
    except ValueError:
        votes = 0
    try:
        stars = float(record.get("rating") or 0)
    except ValueError:
        stars = 0.0
    return (-votes, -stars, record["sha256"])


def choose(records: list[dict]) -> list[dict]:
    kept = [r for r in records if is_eligible(r) and grand_staff(r)]
    by_work: dict[tuple, dict] = {}
    for record in kept:
        key = (normalise(record.get("title")), normalise(record.get("composer")))
        best = by_work.get(key)
        if best is None or rating_key(record) < rating_key(best):
            by_work[key] = record
    unique_work = list(by_work.values())
    seen_xml: set[str] = set()
    chosen: list[dict] = []
    for record in sorted(unique_work, key=lambda r: r["sha256"]):
        if record["xmlSha256"] in seen_xml:
            continue
        seen_xml.add(record["xmlSha256"])
        chosen.append(record)
    return sorted(chosen, key=lambda r: r["sha256"])


def copy_selected(archive: Path, chosen: list[dict], dest: Path) -> int:
    """Stream the archive once and copy each chosen .mxl, keyed by its basename."""
    dest.mkdir(parents=True, exist_ok=True)
    wanted = {os.path.basename(r["path"]): r for r in chosen}
    copied = 0
    with tarfile.open(archive, "r|gz") as tar:
        for member in tar:
            if not member.isfile():
                continue
            record = wanted.pop(os.path.basename(member.name), None)
            if record is None:
                continue
            handle = tar.extractfile(member)
            if handle is None:
                continue
            target = dest / f"{record['sha256']}.mxl"
            data = handle.read()
            if target.exists() and target.stat().st_size == len(data):
                copied += 1
                continue
            target.write_bytes(data)
            copied += 1
            if not wanted:
                break
    return copied


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--screen", type=Path, default=RAW / "screen.jsonl")
    ap.add_argument("--archive", type=Path, required=True)
    a = ap.parse_args(argv)
    records = [json.loads(line) for line in a.screen.open(encoding="utf-8")]
    chosen = choose(records)
    keep = [{k: r.get(k) for k in ("sha256", "xmlSha256", "path", "title", "composer", "genres", "rating",
                                   "n_ratings", "notes", "fingerings", "version", "parts")} for r in chosen]
    (RAW / "candidates.json").write_text(json.dumps(keep, ensure_ascii=False, indent=1), encoding="utf-8")
    copied = copy_selected(a.archive, chosen, RAW / "selected")
    print(f"screened {len(records)}; eligible {sum(is_eligible(r) for r in records)}; "
          f"candidates {len(chosen)}; copied {copied}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
