"""Quality gate for content/scores/*.musicxml.

Checks every file with two independent readers (tools/xmlcheck.py and
music21), renders the first page with verovio, and writes a JSON report.

    python -I validate.py [--scores DIR] [--preview DIR] [--report FILE] [--png] [slug ...]

Exit status is 1 if any file fails.  License: MIT.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import xmlcheck as xc  # noqa: E402

CONTENT = HERE.parent
MAX_BYTES = 1_500_000
PIANO_LOW, PIANO_HIGH = 21, 108
SCHEMA_DIR = CONTENT / "_raw" / "schema"
SCHEMA_BASE = "https://raw.githubusercontent.com/w3c/musicxml/v{version}/schema/"
SCHEMA_VERSIONS = ("3.1", "4.0")  # PDMX scores are 3.1; the library's own engravings are 4.0
_SCHEMAS: dict[str, object] = {}


def _schema_dir(version: str) -> Path:
    # 4.0 keeps the original folder, so an existing download is reused without a fetch
    return SCHEMA_DIR if version == "4.0" else SCHEMA_DIR / f"v{version}"


def load_schema(version: str = "4.0", download: bool = True):
    """MusicXML XSD (W3C) of one version, cached in content/_raw/schema (gitignored)."""
    if version in _SCHEMAS:
        return _SCHEMAS[version] or None
    try:
        from lxml import etree
    except ImportError:
        _SCHEMAS[version] = False
        return None
    folder = _schema_dir(version)
    folder.mkdir(parents=True, exist_ok=True)
    for name in ("musicxml.xsd", "xml.xsd", "xlink.xsd"):
        p = folder / name
        if not p.exists() and download:
            import urllib.request

            with urllib.request.urlopen(SCHEMA_BASE.format(version=version) + name, timeout=60) as r:
                p.write_bytes(r.read())
    main = folder / "musicxml.xsd"
    if not main.exists():
        _SCHEMAS[version] = False
        return None
    text = main.read_text(encoding="utf-8")
    text = text.replace("http://www.musicxml.org/xsd/xml.xsd", "xml.xsd")
    text = text.replace("http://www.musicxml.org/xsd/xlink.xsd", "xlink.xsd")
    doc = etree.fromstring(text.encode("utf-8"), base_url=main.as_uri())
    _SCHEMAS[version] = etree.XMLSchema(doc)
    return _SCHEMAS[version]


def xsd_errors(path: Path) -> list[str] | None:
    """XSD errors of one file against the schema of its own MusicXML version (None when unavailable)."""
    from lxml import etree

    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    doc = etree.parse(str(path), parser)
    version = doc.getroot().get("version") or "4.0"
    if version not in SCHEMA_VERSIONS:
        return [f"no schema for MusicXML version {version!r}"]
    schema = load_schema(version)
    if schema is None:
        return None
    if schema.validate(doc):
        return []
    return [f"line {e.line}: {e.message}" for e in list(schema.error_log)[:10]]


def check_file(path: Path, preview_dir: Path | None, png: bool = False, tempo: float | None = None) -> dict:
    res = {"file": path.name, "errors": [], "warnings": [], "stats": {}}
    err, warn = res["errors"].append, res["warnings"].append
    data = path.read_bytes()
    if len(data) > MAX_BYTES:
        err(f"file is {len(data)} bytes (> {MAX_BYTES})")
    if data[:2] == b"PK":
        err("compressed (.mxl) data; plain .musicxml required")
    try:
        xe = xsd_errors(path)
        if xe is None:
            warn("MusicXML 4.0 schema not available; XSD validation skipped")
        else:
            for e in xe:
                err(f"XSD: {e}")
            res["stats"]["xsdValid"] = not xe
    except Exception as exc:  # noqa: BLE001
        err(f"XSD validation failed: {type(exc).__name__}: {exc}")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        err(f"not UTF-8: {exc}")
        return res
    if not text.startswith("<?xml"):
        err("missing XML declaration")
    if "<score-partwise" not in text[:2000]:
        err("not a partwise score")
    fingered = path.name.endswith(".fingered.musicxml")
    nfing = text.count("<fingering")
    if fingered and nfing == 0:
        err("fingered copy has no <fingering> elements")
    if not fingered and nfing:
        err(f"{nfing} <fingering> elements in a stripped file")

    # --- reader 1: xmlcheck
    try:
        xs = xc.parse_musicxml(path)
    except Exception as exc:  # noqa: BLE001
        err(f"xmlcheck parse failed: {exc}")
        return res
    res["errors"].extend(xs.problems)
    if xs.version not in ("3.1", "4.0"):
        err(f"MusicXML version {xs.version!r} (want 3.1 or 4.0)")
    if xs.parts != 1:
        err(f"{xs.parts} parts (want 1)")
    if xs.staves != 2:
        err(f"{xs.staves} staves (want 2)")
    if not xs.keys:
        err("no key signature")
    if not xs.times:
        err("no time signature")
    if not xs.measures:
        err("no measures")
    nums = [m.number for m in xs.measures]
    if any(not n for n in nums):
        err("measure without a number")
    if len(set(nums)) != len(nums):
        err("measure numbers not unique")
    # numbers are integers, optionally with a letter suffix for the 2nd part of a split bar
    base = []
    for n in nums:
        mm = re.fullmatch(r"(\d+)([a-z]*)", n or "")
        if not mm:
            warn(f"unusual measure number {n!r}")
            continue
        base.append(int(mm.group(1)))
    if base != sorted(base):
        err("measure numbers not increasing")
    for m in xs.measures:
        for v, at in m.voice_overlaps:
            err(f"measure {m.number}: overlapping notes in voice {v} at beat {float(at) + 1:g}")
        if m.length == 0:
            err(f"measure {m.number} is empty")
        if m.nominal is not None:
            for v, e in m.voice_ends.items():
                if e > m.nominal:
                    err(f"measure {m.number}: voice {v} lasts {e} quarters, time signature allows {m.nominal}")
            if m.length != m.nominal and not m.implicit:
                if m.idx == 0 and m.length < m.nominal:
                    pass  # pickup
                elif m.idx == len(xs.measures) - 1 and m.length < m.nominal:
                    pass  # final partial measure
                elif m.length < m.nominal:
                    warn(f"measure {m.number}: {m.length} of {m.nominal} quarters (partial bar, e.g. 1st ending)")
                else:
                    err(f"measure {m.number}: {m.length} quarters > time signature {m.nominal}")
    notes = [n for n in xs.notes if n.pitch is not None]
    if not notes:
        err("no pitched notes")
    for n in xs.notes:
        if not n.has_duration and not n.grace:
            err(f"measure {n.number}: note without duration")
        if n.pitch is not None and not (PIANO_LOW <= n.pitch <= PIANO_HIGH):
            err(f"measure {n.number}: pitch {n.pitch} outside the piano range")
    staff_count = {}
    for n in notes:
        staff_count[n.staff] = staff_count.get(n.staff, 0) + 1
    if len(staff_count) < 2:
        err(f"pitched notes only on staff {list(staff_count)}")
    # average pitch per staff: upper staff should be higher
    avg = {}
    for s in staff_count:
        ps = [n.pitch for n in notes if n.staff == s]
        avg[s] = sum(ps) / len(ps)
    if "1" in avg and "2" in avg and avg["1"] < avg["2"]:
        warn(f"staff 1 is lower on average than staff 2 ({avg['1']:.1f} < {avg['2']:.1f})")
    written_q = sum((m.length for m in xs.measures), F(0))
    order = xc.unfold_order(xs.measures)
    unfolded_q = sum((xs.measures[i].length for i in order), F(0))
    if xs.tempos:
        tempo = xs.tempos[0][2]
    elif tempo:
        warn("no <sound tempo> in the score; duration estimated from the catalogue tempo")
    res["stats"].update({
        # bars as a musician counts them: no pickup, no 2nd part of a split bar (implicit measures)
        "measures": sum(1 for m in xs.measures if not m.implicit),
        "measureElements": len(xs.measures),
        "firstMeasure": xs.measures[0].number if xs.measures else None,
        "lastMeasure": xs.measures[-1].number if xs.measures else None,
        "notes": len(notes),
        "graceNotes": sum(1 for n in notes if n.grace),
        "fingerings": nfing,
        "writtenQuarters": float(written_q),
        "unfoldedQuarters": float(unfolded_q),
        "tempoQpm": tempo,
        "key": xs.keys[0][1:] if xs.keys else None,
        "time": xs.times[0][1] if xs.times else None,
        "bytes": len(data),
        "pitchRange": [min(n.pitch for n in notes), max(n.pitch for n in notes)] if notes else None,
        "staffAvgPitch": {k: round(v, 1) for k, v in avg.items()},
    })
    if tempo:
        res["stats"]["approxDurationSec"] = round(float(unfolded_q) * 60 / tempo)

    # --- reader 2: music21
    try:
        from music21 import converter, harmony
        import music21

        music21.environment.set("warnings", 0)
        sc = converter.parse(str(path), format="musicxml", forceSource=True)
        m21_parts = sc.parts
        m21_measures = len(m21_parts[0].getElementsByClass("Measure")) if m21_parts else 0
        flat = sc.flatten()
        m21_notes = [n for n in flat.notes]
        # music21 lists a <harmony> chord symbol among .notes with a length of 0 by design: not a note
        bad = [n for n in m21_notes if n.duration.quarterLength == 0 and not n.duration.isGrace
               and not isinstance(n, harmony.Harmony)]
        if bad:
            err(f"music21: {len(bad)} notes with zero duration")
        res["stats"]["music21"] = {
            "parts": len(m21_parts),
            "measures": m21_measures,
            "noteOrChord": len(m21_notes),
            "highestTime": float(sc.highestTime),
            "version": music21.__version__,
        }
        if len(m21_parts) not in (1, 2):
            err(f"music21 sees {len(m21_parts)} parts")
        # music21 splits a 2-staff part into 2 PartStaff objects: both must have notes
        for i, p in enumerate(m21_parts):
            if not p.flatten().notes:
                err(f"music21 part {i} has no notes")
        if abs(float(sc.highestTime) - float(written_q)) > 0.01 and len(m21_parts):
            # music21 ignores pickup conventions; accept if measure counts agree
            if m21_measures != len(xs.measures):
                warn(f"music21 highestTime {float(sc.highestTime)} vs written {float(written_q)}; "
                     f"measures {m21_measures} vs {len(xs.measures)}")
    except Exception as exc:  # noqa: BLE001
        err(f"music21 parse failed: {type(exc).__name__}: {str(exc)[:300]}")

    # --- renderer: verovio
    if preview_dir is not None:
        try:
            from render import render, svg_to_png

            svg, pages, log = render(path)
            if "<svg" not in svg[:200]:
                err("verovio produced no SVG")
            if "error" in log.lower():
                warn("verovio log: " + " | ".join(l for l in log.splitlines() if "error" in l.lower())[:300])
            preview_dir.mkdir(parents=True, exist_ok=True)
            stem = path.name[:-len(".musicxml")]
            (preview_dir / f"{stem}.svg").write_text(svg, encoding="utf-8")
            res["stats"]["verovioPages"] = pages
            if png:
                svg_to_png(svg, preview_dir / f"{stem}.png", 1400)
        except Exception as exc:  # noqa: BLE001
            err(f"verovio render failed: {type(exc).__name__}: {str(exc)[:300]}")
    res["ok"] = not res["errors"]
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--scores", type=Path, default=CONTENT / "scores")
    ap.add_argument("--preview", type=Path, default=CONTENT / "_preview")
    ap.add_argument("--no-preview", action="store_true")
    ap.add_argument("--png", action="store_true")
    ap.add_argument("--report", type=Path, default=CONTENT / "_preview" / "validation.json")
    a = ap.parse_args(argv)
    files = sorted(a.scores.glob("*.musicxml"))
    if a.slugs:
        files = [f for f in files if any(f.name.startswith(s) for s in a.slugs)]
    results = []
    for f in files:
        r = check_file(f, None if a.no_preview else a.preview, a.png)
        results.append(r)
        status = "OK  " if r["ok"] else "FAIL"
        print(f"{status} {f.name}: {r['stats'].get('measures')} measures, {r['stats'].get('notes')} notes")
        for e in r["errors"]:
            print("      error:", e)
        for w in r["warnings"]:
            print("      warn: ", w)
    a.report.parent.mkdir(parents=True, exist_ok=True)
    a.report.write_text(json.dumps(results, indent=2), encoding="utf-8")
    nfail = sum(1 for r in results if not r["ok"])
    print(f"{len(results) - nfail}/{len(results)} files OK")
    return 1 if nfail else 0


if __name__ == "__main__":
    raise SystemExit(main())
