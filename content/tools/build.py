"""Build the digitus2 built-in library from tools/catalog.json.

    python -I content/tools/build.py                 # convert + arrange + validate + manifest
    python -I content/tools/build.py --only SLUG ... # rebuild some pieces (manifest keeps the rest)
    python -I content/tools/build.py --png           # also write PNG previews (needs resvg-py)

Mutopia pieces must have been downloaded first (tools/fetch_mutopia.py).
Outputs:
  content/scores/<slug>.musicxml            stripped of fingerings
  content/scores/<slug>.fingered.musicxml   editor's fingerings kept (only if the source has them)
  content/manifest.json                     library catalogue for the app
  content/verification.json                 validation + MIDI cross-check results
  content/_build/<slug>/                    LilyPond build dir (gitignored)
  content/_preview/<slug>.svg               first page rendered by verovio (gitignored)
License: MIT.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ly2musicxml as L  # noqa: E402
import xmlcheck as xc  # noqa: E402

CONTENT = HERE.parent
RAW = CONTENT / "_raw" / "mutopia"
SCORES = CONTENT / "scores"
BUILD = CONTENT / "_build"
PREVIEW = CONTENT / "_preview"
MUTOPIA_FTP = "https://www.mutopiaproject.org/ftp/"
MUTOPIA_PIECE = "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id={id}"

LICENSES = {
    "Public Domain": ("Public Domain", "https://creativecommons.org/publicdomain/mark/1.0/"),
    "Creative Commons Attribution-ShareAlike 3.0": ("CC-BY-SA-3.0", "https://creativecommons.org/licenses/by-sa/3.0/"),
    "Creative Commons Attribution-ShareAlike 2.5": ("CC-BY-SA-2.5", "https://creativecommons.org/licenses/by-sa/2.5/"),
    "Creative Commons Attribution 3.0": ("CC-BY-3.0", "https://creativecommons.org/licenses/by/3.0/"),
}


def load_catalog() -> list[dict]:
    data = json.loads((HERE / "catalog.json").read_text(encoding="utf-8"))
    return data["pieces"]


def rdf_info(ftp_dir: str) -> dict:
    d = RAW / ftp_dir
    rdfs = sorted(d.glob("*.rdf"))
    if not rdfs:
        raise SystemExit(f"no RDF for {ftp_dir}; run fetch_mutopia.py first")
    root = ET.parse(rdfs[0]).getroot()
    ns = {"mp": "http://www.mutopiaproject.org/piece-data/0.1/"}
    desc = root.find("{http://www.w3.org/1999/02/22-rdf-syntax-ns#}Description")

    def get(tag):
        el = desc.find(f"mp:{tag}", ns)
        return (el.text or "").strip() if el is not None and el.text else ""

    # some RDF files double-escape entities ("&amp;amp;"): unescape what ElementTree leaves behind
    info = {k: html.unescape(get(k)) for k in ("title", "composer", "opus", "licence", "id", "maintainer",
                                               "source", "lilypondVersion", "date", "lyFile", "midFile")}
    m = re.search(r"-(\d+)$", info["id"])
    info["num"] = m.group(1) if m else None
    return info


def fetch_log() -> dict:
    p = RAW / "fetch_log.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def mutopia_source(piece: dict, log: dict) -> dict:
    rdf = rdf_info(piece["ftpDir"])
    spdx, lic_url = LICENSES.get(rdf["licence"], (rdf["licence"], None))
    rec = log.get(piece["ftpDir"], {})
    return {
        "name": "The Mutopia Project",
        "url": MUTOPIA_PIECE.format(id=rdf["num"]) if rdf["num"] else MUTOPIA_FTP + piece["ftpDir"] + "/",
        "files": MUTOPIA_FTP + piece["ftpDir"] + "/",
        "license": spdx,
        "licenseUrl": lic_url,
        "retrievedAt": rec.get("retrievedAt", "")[:10] or None,
        "mutopiaId": rdf["id"],
        "typesetter": rdf["maintainer"],
        "edition": rdf["source"],
        "lilypondVersion": rdf["lilypondVersion"],
    }


def rights_text(piece: dict, src: dict) -> str:
    who = f"{src['typesetter']} for the Mutopia Project ({src['mutopiaId']})"
    if src["license"] == "Public Domain":
        return (f"Composition in the public domain. Engraving by {who}, placed in the public domain. "
                f"MusicXML conversion by the digitus2 project, dedicated to the public domain (CC0 1.0).")
    return (f"Composition in the public domain. Engraving (c) {who}, licensed {src['license']} "
            f"({src['licenseUrl']}). This MusicXML adaptation by the digitus2 project is licensed "
            f"{src['license']} as well.")


def source_files(piece: dict) -> tuple[list[Path], str]:
    d = RAW / piece["ftpDir"]
    if piece.get("subdir"):
        d = d / piece["subdir"]
    main = piece["main"]
    if not (d / main).exists():
        hits = list((RAW / piece["ftpDir"]).rglob(main))
        if not hits:
            raise SystemExit(f"{piece['slug']}: {main} not found under {RAW / piece['ftpDir']}")
        d = hits[0].parent
    files = [d / main] + sorted(p for p in d.iterdir() if p.suffix in (".ly", ".ily") and p.name != main)
    return files, main


def build_mutopia(piece: dict, log: dict) -> dict:
    slug = piece["slug"]
    conv = piece.get("convert", {})
    files, main = source_files(piece)
    src = mutopia_source(piece, log)
    t0 = time.time()
    res = L.compile_lilypond(files, main, BUILD / slug, patches=conv.get("patches"))
    score = conv.get("score", 1)
    opts = L.Options(
        title=piece["title"],
        composer=piece["composer"] + (f" ({piece['composerDates']})" if piece.get("composerDates") else ""),
        rights=rights_text(piece, src),
        source_url=src["url"],
        encoding_date=src["retrievedAt"],
        bar_from=conv.get("barFrom"),
        bar_to=conv.get("barTo"),
        staff_order=conv.get("staffOrder"),
        midi_tempo=piece.get("tempoBpm"),
        drop_text=conv.get("dropText", []),
        text_replace=conv.get("textReplace", {}),
        first_key_mode=(piece["keyName"].split()[-1] if piece.get("keyName") else None),
    )
    data, warns = L.convert_dump(res["dump"], score, opts)
    SCORES.mkdir(parents=True, exist_ok=True)
    out = SCORES / f"{slug}.musicxml"
    out.write_bytes(data)
    fingered = SCORES / f"{slug}.fingered.musicxml"
    opts.include_fingering = True
    fdata, _ = L.convert_dump(res["dump"], score, opts)
    # a handful of stray digits is not an "editor's fingering": require at least 5
    has_fing = fdata.count(b"<fingering") >= conv.get("minFingerings", 5)
    if has_fing:
        fingered.write_bytes(fdata)
    elif fingered.exists():
        fingered.unlink()
    # independent cross-checks against MIDI rendered by LilyPond from the same source
    checks = {}
    mids = res["midi"]
    if mids:
        midi = mids[min(score - 1, len(mids) - 1)]
        checks["lilypond224Midi"] = midi_check(out, midi, excerpt=bool(conv.get("barTo") or conv.get("barFrom")))
    pub = piece.get("publishedMidi")
    if pub and (RAW / piece["ftpDir"] / pub).exists():
        checks["mutopiaMidi"] = midi_check(out, RAW / piece["ftpDir"] / pub,
                                           excerpt=bool(conv.get("barTo") or conv.get("barFrom")))
    return {
        "slug": slug, "source": src, "files": [out.name] + ([fingered.name] if has_fing else []),
        "hasEditorialFingering": has_fing, "fingerings": fdata.count(b"<fingering"),
        "warnings": warns, "lilypondWarnings": len(res["warnings"]), "midiChecks": checks,
        "seconds": round(time.time() - t0, 1),
    }


def midi_check(xml_path: Path, midi_path: Path, excerpt: bool) -> dict:
    xs = xc.parse_musicxml(xml_path)
    if not excerpt:
        r = xc.best_midi_match(xs, midi_path)
    else:
        # excerpt from the start of the piece: compare with the MIDI up to the excerpt's end
        end = sum((m.length for m in xs.measures), F(0))
        mn = [n for n in xc.read_midi(midi_path) if n[0] < end]
        r = xc.compare_notes(xc.written_notes(xs), mn, xc.grace_pitches(xs))
        r["mode"] = "written (excerpt)"
        r["midiFile"] = midi_path.name
        r["exact"] = r["only_xml_count"] + r["only_midi_count"] == 0
    return {k: r[k] for k in ("mode", "midiFile", "exact", "xml", "midi", "matched", "only_xml_count",
                              "only_midi_count", "only_xml", "only_midi", "duration_mismatches")}


def build_own(piece: dict) -> dict:
    import arrange

    slug = piece["slug"]
    data = arrange.build(slug, piece)
    SCORES.mkdir(parents=True, exist_ok=True)
    out = SCORES / f"{slug}.musicxml"
    out.write_bytes(data)
    f = SCORES / f"{slug}.fingered.musicxml"
    if f.exists():
        f.unlink()
    return {
        "slug": slug,
        "source": {
            "name": "digitus2 (own arrangement)",
            "url": "https://github.com/MarchalMaxim/digitus2/blob/main/content/tools/arrange.py",
            "license": "CC0-1.0",
            "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
            "retrievedAt": None,
        },
        "files": [out.name], "hasEditorialFingering": False, "fingerings": 0, "warnings": [],
        "midiChecks": {},
    }


CIRCLE = ["Fb", "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#",
          "D#", "A#", "E#", "B#"]  # index 8 = C (0 fifths)
MODE_OFFSET = {None: 0, "major": 0, "ionian": 0, "lydian": -1, "mixolydian": 1, "dorian": 2, "minor": 3,
               "aeolian": 3, "phrygian": 4, "locrian": 5}


def key_name(fifths: int, mode: str | None) -> str:
    """Key from the key signature and the MusicXML mode, e.g. (0, 'dorian') -> 'D dorian'."""
    tonic = CIRCLE[8 + fifths + MODE_OFFSET.get(mode, 0)]
    return f"{tonic} {mode or 'major'}"


def manifest_entry(piece: dict, built: dict, stats: dict) -> dict:
    key = stats.get("key")
    fifths = int(key[0]) if key and key[0] is not None else 0
    mode = key[1] if key else None
    ts = stats.get("time")
    entry = {
        "slug": piece["slug"],
        "title": piece["title"],
        "composer": piece["composer"],
        "composerDates": piece.get("composerDates"),
        "catalogue": piece.get("catalogue"),
        "year": piece.get("year"),
        "level": piece["level"],
        "measures": stats.get("measures"),
        "approxDurationSec": stats.get("approxDurationSec"),
        "timeSignature": f"{ts[0]}/{ts[1]}" if ts else None,
        # catalogue override where the source declares only the signature (e.g. \key e \major for C# minor)
        "key": piece.get("keyName") or key_name(fifths, mode),
        "tempoBpm": piece.get("tempoBpm"),
        "source": built["source"],
        "arranger": piece.get("arranger"),
        "hasEditorialFingering": built["hasEditorialFingering"],
        "excerpt": piece.get("excerpt"),
        "notes": piece.get("notes"),
        "files": {
            "score": f"scores/{piece['slug']}.musicxml",
            "fingered": f"scores/{piece['slug']}.fingered.musicxml" if built["hasEditorialFingering"] else None,
        },
    }
    return entry


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*", default=[])
    ap.add_argument("--png", action="store_true", help="also write PNG previews")
    ap.add_argument("--no-validate", action="store_true")
    a = ap.parse_args(argv)
    import validate

    catalog = load_catalog()
    log = fetch_log()
    ver_path = CONTENT / "verification.json"
    verification = json.loads(ver_path.read_text(encoding="utf-8")) if ver_path.exists() else {}
    man_path = CONTENT / "manifest.json"
    old_manifest = {e["slug"]: e for e in json.loads(man_path.read_text(encoding="utf-8"))} if man_path.exists() else {}
    manifest = []
    failures = 0
    for piece in catalog:
        slug = piece["slug"]
        if a.only and slug not in a.only:
            if slug in old_manifest:
                manifest.append(old_manifest[slug])
            continue
        print(f"== {slug}")
        try:
            built = build_mutopia(piece, log) if piece["source"] == "mutopia" else build_own(piece)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"   BUILD FAILED: {type(exc).__name__}: {exc}")
            verification[slug] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
            continue
        for w in built["warnings"]:
            print("   conversion:", w)
        for name, chk in built["midiChecks"].items():
            print(f"   {name}: {'EXACT' if chk['exact'] else 'DIFF'} {chk['mode']} matched {chk['matched']}"
                  f"/{chk['xml']} (only xml {chk['only_xml_count']}, only midi {chk['only_midi_count']})")
        vres = {}
        if not a.no_validate:
            for fname in built["files"]:
                r = validate.check_file(SCORES / fname, PREVIEW if not fname.endswith(".fingered.musicxml") else None,
                                        a.png, tempo=piece.get("tempoBpm"))
                vres[fname] = r
                print(f"   validate {fname}: {'OK' if r['ok'] else 'FAIL'}"
                      + "".join(f"\n      error: {e}" for e in r["errors"])
                      + "".join(f"\n      warn: {w}" for w in r["warnings"]))
                if not r["ok"]:
                    failures += 1
        stats = vres.get(f"{slug}.musicxml", {}).get("stats", {})
        manifest.append(manifest_entry(piece, built, stats))
        verification[slug] = {
            "ok": all(r["ok"] for r in vres.values()) if vres else None,
            "conversionWarnings": built["warnings"],
            "midiChecks": built["midiChecks"],
            "validation": {f: {"ok": r["ok"], "errors": r["errors"], "warnings": r["warnings"]}
                           for f, r in vres.items()},
            "stats": stats,
        }
    order = {p["slug"]: i for i, p in enumerate(catalog)}
    manifest.sort(key=lambda e: (e["level"], order.get(e["slug"], 999)))
    man_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    verification = {k: verification[k] for k in sorted(verification, key=lambda s: order.get(s, 999))
                    if k in order}
    ver_path.write_text(json.dumps(verification, indent=2, ensure_ascii=False) + "\n", encoding="utf-8",
                        newline="\n")
    print(f"manifest: {len(manifest)} pieces; failures: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
