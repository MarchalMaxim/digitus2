"""The songs lane: MuseScore archive scores outside classical, folk and religious music.

The user (2026-10-16): "find more songs, not necessarily classical or folk". The copyright reading is the
broad one the user chose the same day: the uploader's public-domain or CC0 declaration with no licence
conflict (PDMX's `license_conflict`), and no check of the author's date. So a pop, rock, soundtrack or
jazz score is in scope when its uploader declared it free. Modern arrangements that the declaration does
not cover are a known risk on a public repository; the README says so.

Two pools feed the lane. Both are solo piano scores on two staves with notes on both (pdmx_select.grand_staff):

- pool A: the genres outside classical, folk and religious (`screen-other.jsonl`, from pdmx_screen.py --other);
- pool B: unlabelled scores whose composer is not on the classical list (`screen.jsonl`, the rows
  pdmx_select leaves out for that reason).

A score is dropped when it duplicates a classical candidate or an earlier song (the same normalised title
and composer, or the same MusicXML). The rest are read by reviewers in two lenses, junk and content
safety, in batches of titles (`items.txt`). Any flag removes a song (AGREE = 1, as in pdmx_scope.py). The
review is removal only: no reviewer decides that a song is in scope, because the scope is the broad reading.

    pdmx_songs.py items                  writes content/_build/songs/items.txt and index.json
    pdmx_songs.py apply FLAGS            writes the review's flags into outOfScope (pdmx-excluded.json)
    pdmx_songs.py reinstate              lifts the exclusions made for genre, date or copyright reasons
    pdmx_songs.py candidates --archive   writes content/_raw/pdmx/candidates-other.json and copies the
                                         unflagged songs into content/_raw/pdmx/selected/

FLAGS is a list of {"n": item number, "lens": "junk" or "safety", "reason": text}.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
CONTENT = HERE.parent
RAW = CONTENT / "_raw" / "pdmx"
BUILD = CONTENT / "_build" / "songs"
EXCLUDED = HERE / "pdmx-excluded.json"
CANDIDATES = RAW / "candidates.json"
CANDIDATES_OTHER = RAW / "candidates-other.json"
SONG_FIELDS = ("sha256", "xmlSha256", "path", "title", "composer", "genres", "rating", "n_ratings", "notes",
               "fingerings", "version", "parts")

import pdmx_fragments as fr  # noqa: E402  (clean_title, clean_composer, BROKEN_TEXT)
import pdmx_select as sel  # noqa: E402

# The exclusions that stay after the reinstatement: content, not genre, date or copyright. An amateur fan
# arrangement is kept out too: it is not a finished piece for the library.
CONTENT_REASON = re.compile(r"nazi|hitler|wehrmacht|horst|pinochet|propaganda|joke|meme|amateur|soviet anthem"
                            r"|review (junk|safety):", re.I)


def _read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.open(encoding="utf-8")]


def _key(record: dict) -> tuple[str, str]:
    return (sel.normalise(record.get("title")), sel.normalise(record.get("composer")))


def pool(classical: list[dict]) -> list[dict]:
    """The song candidates: both pools, minus the classical lane and minus each other's duplicates.

    Deterministic: the same screen files give the same list, so the review's numbers map back to sha256s."""
    taken = {_key(r) for r in classical}
    taken_xml = {r["xmlSha256"] for r in classical}
    unlabelled = [r for r in _read(RAW / "screen.jsonl") if not sel.is_eligible(r)]
    other = _read(RAW / "screen-other.jsonl")
    rows = [r for r in unlabelled + other
            if r.get("accepted") and sel.grand_staff(r) and sel.MIN_NOTES <= (r.get("notes") or 0) <= sel.MAX_NOTES]
    rows.sort(key=sel.rating_key)  # the most rated copy of a song stays
    kept: list[dict] = []
    for record in rows:
        title = fr.clean_title(record.get("title"))
        composer = record.get("composer") or ""
        if not title or fr.BROKEN_TEXT.search(title) or fr.BROKEN_TEXT.search(composer):
            continue
        key = _key(record)
        if key in taken or record["xmlSha256"] in taken_xml:
            continue
        taken.add(key)
        taken_xml.add(record["xmlSha256"])
        kept.append(record)
    return sorted(kept, key=lambda r: r["sha256"])


def items() -> int:
    """Write the review list: one line per song, `n<TAB>title<TAB>composer<TAB>genre tags<TAB>notes<TAB>ratings`."""
    songs = pool(json.loads(CANDIDATES.read_text(encoding="utf-8")))
    BUILD.mkdir(parents=True, exist_ok=True)
    lines, index = [], {}
    for n, record in enumerate(songs, 1):
        title = fr.clean_title(record.get("title"))
        composer = fr.clean_composer(record.get("composer"))
        lines.append(f"{n}\t{title}\t{composer}\t{record.get('genres') or 'NA'}\t{record.get('notes')}\t"
                     f"{record.get('n_ratings') or 0}")
        index[str(n)] = record["sha256"]
    (BUILD / "items.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (BUILD / "index.json").write_text(json.dumps(index), encoding="utf-8")
    print(f"{len(songs)} songs to review -> {BUILD / 'items.txt'}")
    return len(songs)


def apply(flags_path: Path, index_path: Path = BUILD / "index.json") -> None:
    """Any flag removes a song (AGREE = 1). The flags are numbered as the last `items` run numbered them, or as
    `index_path` maps another review list's numbers to sha256s."""
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    index = json.loads(index_path.read_text(encoding="utf-8"))
    reasons: dict[str, list[str]] = {}
    for flag in flags:
        sha = index.get(str(flag["n"]))
        if sha is not None:
            reasons.setdefault(sha, []).append(f"review {flag['lens']}: {flag['reason']}")
    doc = json.loads(EXCLUDED.read_text(encoding="utf-8"))
    merged = {**doc.get("outOfScope", {}), **{sha: "; ".join(r) for sha, r in reasons.items()}}
    doc["outOfScope"] = dict(sorted(merged.items()))
    EXCLUDED.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"songs removed by the review: {len(reasons)} of {len(index)} reviewed")


def reinstate() -> None:
    """Lift the exclusions made before the songs lane for genre, date or copyright reasons (the 2026-10-16
    broad reading). The content exclusions stay (CONTENT_REASON). Running it twice changes nothing."""
    doc = json.loads(EXCLUDED.read_text(encoding="utf-8"))
    before = doc.get("outOfScope", {})
    kept = {sha: reason for sha, reason in before.items() if CONTENT_REASON.search(reason)}
    doc["outOfScope"] = kept
    EXCLUDED.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"outOfScope: kept {len(kept)} content exclusions, reinstated {len(before) - len(kept)}")


def candidates(archive: Path) -> int:
    """The songs that no reviewer flagged, as candidates-other.json, and their MusicXML copied out of the archive."""
    excluded = json.loads(EXCLUDED.read_text(encoding="utf-8")).get("outOfScope", {})
    songs = [r for r in pool(json.loads(CANDIDATES.read_text(encoding="utf-8"))) if r["sha256"] not in excluded]
    CANDIDATES_OTHER.write_text(
        json.dumps([{k: r.get(k) for k in SONG_FIELDS} for r in songs], ensure_ascii=False, indent=1),
        encoding="utf-8")
    copied = sel.copy_selected(archive, songs, RAW / "selected")
    print(f"songs: {len(songs)} candidates -> {CANDIDATES_OTHER}; copied {copied}")
    return len(songs)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("items")
    p = sub.add_parser("apply")
    p.add_argument("flags", type=Path)
    p.add_argument("--index", type=Path, default=BUILD / "index.json",
                   help="number -> sha256 of the review list the flags refer to (default: the last `items` run)")
    sub.add_parser("reinstate")
    c = sub.add_parser("candidates")
    c.add_argument("--archive", type=Path, required=True)
    a = ap.parse_args(argv)
    if a.cmd == "items":
        items()
    elif a.cmd == "apply":
        apply(a.flags, a.index)
    elif a.cmd == "reinstate":
        reinstate()
    else:
        candidates(a.archive)
    return 0


if __name__ == "__main__":
    sys.exit(main())
