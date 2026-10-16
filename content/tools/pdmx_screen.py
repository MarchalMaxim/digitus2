"""Screen the PDMX public-domain MuseScore archive for solo piano scores.

PDMX (Long et al., 2024; Zenodo 10.5281/zenodo.15571083) holds about 254,000 MusicXML
scores taken from MuseScore. Only the licence metadata and the archive are used here:
the scores are never edited by hand. The pipeline is:

1. Metadata (PDMX.csv): keep rows that are public domain or CC0 with no licence conflict
   (the column `license_conflict` marks the 31,221 rows where MuseScore's website and the
   file's own copyright data disagree), that are not drafts or vocal scores, that have at
   most two tracks, whose genres are classical, folk or unlabelled, and that have 30 to
   6,000 notes.
2. Archive (mxl.tar.gz): stream the members that match, read each .mxl container once,
   and parse its MusicXML. A score is a solo piano score when exactly one part sounds, it
   has one or two staves, its instrument is a piano (General MIDI 1 to 6, or the part
   name says piano) and it has no percussion.
3. Output: `content/_raw/pdmx/screen.jsonl`, one record per candidate with the reason for
   every rejection, and the facts the later selection needs. The accepted files are not
   copied: about 150,000 of them would fill gigabytes. `pdmx_select.py` streams the archive
   again for the few hundred it chooses. Everything lives in the ignored `content/_raw/`.

Run with the content interpreter from the repository root:

    content/.venv/Scripts/python.exe -I content/tools/pdmx_screen.py \
        --csv research/data/_downloads/pdmx/PDMX.csv \
        --archive research/data/_downloads/pdmx/mxl.tar.gz

`--limit N` screens only the first N matching members (a quick check).
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import sys
import tarfile
import zipfile
from multiprocessing import Pool
from pathlib import Path

from lxml import etree

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
RAW = REPO / "content" / "_raw" / "pdmx"

ALLOWED_LICENSES = ("publicdomain", "cc-zero")
ALLOWED_GENRE_TOKENS = {"classical", "folk", "NA", "religiousmusic"}
PIANO_PROGRAMS = {"1", "2", "3", "4", "5", "6"}  # General MIDI 1-based: grand, bright, electric grand, honky-tonk, EP1, EP2
PIANO_NAME_WORDS = ("piano", "klavier", "pianoforte", "pianofort")
MIN_NOTES, MAX_NOTES = 30, 6000
MAX_TRACKS = 2
SCREEN_FIELDS = ("path", "sha256", "bytes", "title", "composer", "genres", "rating", "n_ratings",
                 "n_notes_meta", "complexity")


def metadata_candidates(csv_path: Path) -> dict[str, dict]:
    """Basename of each candidate's .mxl -> the PDMX metadata we keep for the record."""
    csv.field_size_limit(10**9)
    out: dict[str, dict] = {}
    with csv_path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["subset:no_license_conflict"] != "True":
                continue
            if row["license"] not in ALLOWED_LICENSES:
                continue
            if row["is_draft"] == "True" or row["has_lyrics"] == "True":
                continue
            try:
                tracks = int(row["n_tracks"])
                notes = int(row["n_notes"] or 0)
            except ValueError:
                continue
            if tracks > MAX_TRACKS or not MIN_NOTES <= notes <= MAX_NOTES:
                continue
            tokens = set(row["genres"].split("-")) if row["genres"] else {"NA"}
            if not tokens <= ALLOWED_GENRE_TOKENS:
                continue
            base = os.path.basename(row["mxl"])
            out[base] = {
                "path": row["mxl"],
                "title": row["title"],
                "composer": row["composer_name"],
                "genres": row["genres"],
                "rating": row["rating"],
                "n_ratings": row["n_ratings"],
                "n_notes_meta": notes,
                "complexity": row["complexity"],
                "license": row["license"],
            }
    return out


def xml_from_mxl(data: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        root_name = None
        if "META-INF/container.xml" in names:
            container = etree.fromstring(archive.read("META-INF/container.xml"))
            for rootfile in container.iter():
                if rootfile.tag.endswith("rootfile") and rootfile.get("full-path"):
                    root_name = rootfile.get("full-path")
                    break
        if root_name is None or root_name not in names:
            xml_names = [n for n in names if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF")]
            if not xml_names:
                raise ValueError("no MusicXML root file in the container")
            root_name = xml_names[0]
        return archive.read(root_name)


def screen_xml(xml: bytes) -> dict:
    """Facts about one MusicXML document, read without changing it."""
    root = etree.fromstring(xml, parser=etree.XMLParser(huge_tree=True, recover=False))
    facts = {"root": etree.QName(root).localname, "version": root.get("version")}
    part_list = {}
    for score_part in root.iter("{*}score-part", "score-part"):
        pid = score_part.get("id")
        name_el = score_part.find("{*}part-name")
        program = score_part.find(".//{*}midi-instrument/{*}midi-program")
        part_list[pid] = {
            "name": (name_el.text or "").strip() if name_el is not None else "",
            "program": program.text.strip() if program is not None and program.text else None,
        }
    parts = []
    for part in root.iter("{*}part"):
        pid = part.get("id")
        notes = part.findall(".//{*}note")
        pitched = [n for n in notes if n.find("{*}pitch") is not None]
        unpitched = [n for n in notes if n.find("{*}unpitched") is not None]
        if not pitched and not unpitched:
            continue
        midis = []
        for n in pitched:
            step = n.findtext("{*}pitch/{*}step")
            octave = n.findtext("{*}pitch/{*}octave")
            alter = n.findtext("{*}pitch/{*}alter")
            if step is None or octave is None:
                continue
            base = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}.get(step, 0)
            midis.append((int(octave) + 1) * 12 + base + int(float(alter or 0)))
        staves = max((int(s.text) for s in part.iter("{*}staves") if s.text), default=1)
        info = part_list.get(pid, {"name": "", "program": None})
        parts.append({
            "id": pid,
            "name": info["name"],
            "program": info["program"],
            "staves": staves,
            "pitched": len(pitched),
            "unpitched": len(unpitched),
            "fingerings": len(part.findall(".//{*}fingering")),
            "lyrics": len(part.findall(".//{*}lyric")),
            "midiMin": min(midis) if midis else None,
            "midiMax": max(midis) if midis else None,
        })
    facts["parts"] = parts
    facts["notes"] = sum(p["pitched"] for p in parts)
    facts["fingerings"] = sum(p["fingerings"] for p in parts)
    return facts


def is_piano_part(part: dict) -> bool:
    name = part["name"].lower()
    if part["program"] in PIANO_PROGRAMS:
        return True
    return any(word in name for word in PIANO_NAME_WORDS) and part["program"] not in (None, "")


def judge(facts: dict) -> tuple[bool, str]:
    if facts["root"] != "score-partwise":
        return False, "not score-partwise"
    sounding = [p for p in facts["parts"] if p["pitched"] > 0]
    if len(sounding) != 1:
        return False, f"{len(sounding)} sounding parts"
    part = sounding[0]
    if part["unpitched"] > 0:
        return False, "percussion notes"
    if part["staves"] not in (1, 2):
        return False, f"{part['staves']} staves"
    if not is_piano_part(part):
        return False, f"not a piano (program {part['program']}, name {part['name'][:30]!r})"
    if not MIN_NOTES <= part["pitched"] <= MAX_NOTES:
        return False, f"{part['pitched']} notes"
    if part["lyrics"] > 0:
        return False, "lyrics"
    return True, "piano solo"


def _screen_member(task: tuple[str, bytes, dict]) -> dict:
    base, data, meta = task
    record = {"basename": base, **{k: meta.get(k) for k in SCREEN_FIELDS if k in meta}}
    record["bytes"] = len(data)
    try:
        xml = xml_from_mxl(data)
        facts = screen_xml(xml)
    except Exception as exc:  # noqa: BLE001 - every failure is a recorded rejection
        record.update({"accepted": False, "reason": f"unreadable: {type(exc).__name__}: {exc}"[:200]})
        return record
    ok, reason = judge(facts)
    digest = hashlib.sha256(data).hexdigest()
    record.update({
        "sha256": digest,
        "xmlSha256": hashlib.sha256(xml).hexdigest(),
        "version": facts["version"],
        "root": facts["root"],
        "notes": facts["notes"],
        "fingerings": facts["fingerings"],
        "parts": facts["parts"],
        "accepted": ok,
        "reason": reason,
    })
    return record


def stream_members(archive: Path, wanted: dict[str, dict], limit: int | None):
    """Yield (basename, bytes, metadata) for each wanted member, reading the archive once."""
    seen = 0
    with tarfile.open(archive, "r|gz") as tar:
        for member in tar:
            if not member.isfile():
                continue
            base = os.path.basename(member.name)
            meta = wanted.get(base)
            if meta is None:
                continue
            handle = tar.extractfile(member)
            if handle is None:
                continue
            yield base, handle.read(), meta
            seen += 1
            if limit is not None and seen >= limit:
                return


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", type=Path, required=True)
    ap.add_argument("--archive", type=Path, required=True)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    a = ap.parse_args(argv)
    (RAW / "piano").mkdir(parents=True, exist_ok=True)
    wanted = metadata_candidates(a.csv)
    print(f"metadata candidates: {len(wanted)}", flush=True)
    kept = rejected = 0
    with (RAW / "screen.jsonl").open("w", encoding="utf-8") as out, Pool(a.workers) as pool:
        records = pool.imap(_screen_member, stream_members(a.archive, wanted, a.limit), chunksize=16)
        for n, record in enumerate(records, 1):
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            if record["accepted"]:
                kept += 1
            else:
                rejected += 1
            if n % 5000 == 0:
                print(f"  screened {n}: {kept} piano, {rejected} other", flush=True)
    print(f"done: {kept} accepted, {rejected} rejected", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
