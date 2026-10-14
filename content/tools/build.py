"""Build the digitus2 built-in library from tools/catalog.json and the tools/catalog.d/ fragments.

    python -I content/tools/build.py                 # convert + arrange + validate + manifest
    python -I content/tools/build.py --only SLUG ... # rebuild some pieces (manifest keeps the rest)
    python -I content/tools/build.py --png           # also write PNG previews (needs resvg-py)
    python -I content/tools/build.py --manifest-only # re-render every manifest entry; converts nothing
    python -I content/tools/build.py --only SLUG ... --out-dir DIR
                                                     # write those scores into DIR and print the MIDI
                                                     # checks; no validation, manifest or verification

Mutopia pieces must have been downloaded first (tools/fetch_mutopia.py).
The catalog is catalog.json's pieces, then the pieces of every catalog.d/*.json fragment in file-name
order (one fragment per implementer, L1 plan decision 3). Several builds may run at once: scores are
replaced atomically, and the merge into manifest.json and verification.json happens under
jsonio.library_lock(), keeping every entry and top-level key (such as spanFlags) this run did not
build. Both files are ordered by (level, collection display order, position in the merged catalog).
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

import jsonio  # noqa: E402
import ly2musicxml as L  # noqa: E402
import xmlcheck as xc  # noqa: E402

CONTENT = HERE.parent
CATALOG = HERE / "catalog.json"
FRAGMENTS = HERE / "catalog.d"
RAW = CONTENT / "_raw" / "mutopia"
SCORES = CONTENT / "scores"
BUILD = CONTENT / "_build"
PREVIEW = CONTENT / "_preview"
MANIFEST = CONTENT / "manifest.json"
VERIFICATION = CONTENT / "verification.json"
MUTOPIA_FTP = "https://www.mutopiaproject.org/ftp/"
MUTOPIA_PIECE = "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id={id}"

_CC_BY_25 = ("CC-BY-2.5", "https://creativecommons.org/licenses/by/2.5/")
_CC_BY_40 = ("CC-BY-4.0", "https://creativecommons.org/licenses/by/4.0/")
_CC_BY_SA_40 = ("CC-BY-SA-4.0", "https://creativecommons.org/licenses/by-sa/4.0/")
# RDF licence text -> (SPDX-like id, licence URL). Only public domain, CC BY and CC BY-SA belong here:
# license_id() refuses every other text, so a non-free engraving can never be built by accident.
LICENSES = {
    "Public Domain": ("Public Domain", "https://creativecommons.org/publicdomain/mark/1.0/"),
    "Creative Commons Attribution-ShareAlike 3.0": ("CC-BY-SA-3.0", "https://creativecommons.org/licenses/by-sa/3.0/"),
    "Creative Commons Attribution-ShareAlike 2.5": ("CC-BY-SA-2.5", "https://creativecommons.org/licenses/by-sa/2.5/"),
    "Creative Commons Attribution-ShareAlike 4.0": _CC_BY_SA_40,
    "Creative Commons Attribution-ShareAlike 4.0 International": _CC_BY_SA_40,
    "Creative Commons Attribution 2.5": _CC_BY_25,
    "Creative Commons Attribution 3.0": ("CC-BY-3.0", "https://creativecommons.org/licenses/by/3.0/"),
    "Creative Commons Attribution 4.0": _CC_BY_40,
    "Creative Commons Attribution 4.0 International": _CC_BY_40,
}


def license_id(text: str) -> tuple[str, str]:
    """(SPDX-like id, licence URL) of an RDF licence text; SystemExit for any other licence."""
    key = " ".join((text or "").split())
    if key not in LICENSES:
        raise SystemExit(f"unknown licence {text!r}: only public domain, CC BY and CC BY-SA engravings "
                         f"are built (add the exact text to build.LICENSES if it is one of those)")
    return LICENSES[key]


def is_cc_by(spdx: str) -> bool:
    """CC BY (attribution, no share-alike), as opposed to CC BY-SA."""
    return spdx.startswith("CC-BY-") and not spdx.startswith("CC-BY-SA-")


def _read_catalog_file(path: Path) -> dict:
    # A fragment being saved by another implementer can be caught half-written: retry briefly.
    for attempt in range(5):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            if attempt == 4:
                raise SystemExit(f"{path.name}: invalid JSON: {exc}") from exc
            time.sleep(0.5)
    raise AssertionError("unreachable")


def load_fragments() -> list[dict]:
    """The pieces of every catalog.d/*.json fragment, in file-name order."""
    pieces: list[dict] = []
    for path in sorted(FRAGMENTS.glob("*.json")):
        pieces += _read_catalog_file(path).get("pieces", [])
    return pieces


def load_collections() -> list[dict]:
    """[{id, title, kind}] in display order (catalog.json's collections table)."""
    return _read_catalog_file(CATALOG)["collections"]


def collection_titles() -> dict[str, str]:
    return {c["id"]: c["title"] for c in load_collections()}


def load_genres() -> list[dict]:
    """[{id, title}] in display order (catalog.json's genres table)."""
    return _read_catalog_file(CATALOG)["genres"]


def collection_genres() -> dict[str, str]:
    """collection id -> genre id; refuses a collection without a known genre."""
    known = {g["id"] for g in load_genres()}
    out: dict[str, str] = {}
    bad = []
    for c in load_collections():
        if c.get("genre") in known:
            out[c["id"]] = c["genre"]
        else:
            bad.append(f"{c['id']} ({c.get('genre')!r})")
    if bad:
        raise SystemExit(f"collection(s) without a known genre: {', '.join(bad)}")
    return out


def piece_genre(piece: dict, genres: dict[str, str]) -> str:
    """The piece's own genre when the catalog sets one, else its collection's."""
    return piece.get("genre") or genres[piece["collection"]]


def load_catalog() -> list[dict]:
    """catalog.json's pieces, then the fragments' pieces; unique slugs and known collection ids."""
    pieces = _read_catalog_file(CATALOG)["pieces"] + load_fragments()
    known = {c["id"] for c in load_collections()}
    genre_ids = {g["id"] for g in load_genres()}
    seen: set[str] = set()
    dupes, unknown, bad_genre = [], [], []
    for p in pieces:
        if p["slug"] in seen:
            dupes.append(p["slug"])
        seen.add(p["slug"])
        if p.get("collection") not in known:
            unknown.append(f"{p['slug']} ({p.get('collection')!r})")
        if "genre" in p and p["genre"] not in genre_ids:
            bad_genre.append(f"{p['slug']} ({p['genre']!r})")
    if dupes:
        raise SystemExit(f"duplicate slug(s) in the catalog: {', '.join(dupes)}")
    if unknown:
        raise SystemExit(f"unknown collection id(s): {', '.join(unknown)}")
    if bad_genre:
        raise SystemExit(f"unknown genre(s): {', '.join(bad_genre)}")
    return pieces


def catalog_indexes(catalog: list[dict]) -> tuple[dict[str, int], dict[str, int]]:
    """(slug -> position in the merged catalog, collection id -> display order)."""
    return ({p["slug"]: i for i, p in enumerate(catalog)},
            {c["id"]: i for i, c in enumerate(load_collections())})


def sort_key(piece_or_entry: dict, catalog_index: dict, collection_index: dict) -> tuple:
    """(level, collection display order, position in the merged catalog) of a catalog piece (whose
    `collection` is the id) or a manifest entry (whose `collectionId` is the id)."""
    item = piece_or_entry
    cid = item["collectionId"] if "collectionId" in item else item.get("collection")
    return (item["level"], collection_index.get(cid, len(collection_index)),
            catalog_index.get(item["slug"], len(catalog_index)))


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
    spdx, lic_url = license_id(rdf["licence"])
    rec = log.get(piece["ftpDir"], {})
    # the catalog pins the date (it becomes <encoding-date>): a re-fetch must not move a byte
    retrieved = piece.get("retrievedAt") or rec.get("retrievedAt", "")[:10] or None
    return {
        "name": "The Mutopia Project",
        "url": MUTOPIA_PIECE.format(id=rdf["num"]) if rdf["num"] else MUTOPIA_FTP + piece["ftpDir"] + "/",
        "files": MUTOPIA_FTP + piece["ftpDir"] + "/",
        "license": spdx,
        "licenseUrl": lic_url,
        "retrievedAt": retrieved,
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
    attribution = " (attribution required)" if is_cc_by(src["license"]) else ""
    return (f"Composition in the public domain. Engraving (c) {who}, licensed {src['license']}{attribution} "
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


def build_mutopia(piece: dict, log: dict, out_dir: Path = SCORES) -> dict:
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
    out = out_dir / f"{slug}.musicxml"
    jsonio.write_atomic(out, data)
    fingered = out_dir / f"{slug}.fingered.musicxml"
    opts.include_fingering = True
    fdata, _ = L.convert_dump(res["dump"], score, opts)
    # a handful of stray digits is not an "editor's fingering": require at least 5
    has_fing = fdata.count(b"<fingering") >= conv.get("minFingerings", 5)
    if has_fing:
        jsonio.write_atomic(fingered, fdata)
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


def build_own(piece: dict, out_dir: Path = SCORES) -> dict:
    import arrange

    slug = piece["slug"]
    data = arrange.build(slug, piece)
    out = out_dir / f"{slug}.musicxml"
    jsonio.write_atomic(out, data)
    f = out_dir / f"{slug}.fingered.musicxml"
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


def manifest_entry(piece: dict, built: dict, stats: dict, collections: dict[str, str] | None = None,
                   genres: dict[str, str] | None = None) -> dict:
    """The manifest entry of a piece. `built` needs `source` and `hasEditorialFingering`;
    `collections` maps collection id -> title and `genres` collection id -> genre id (both read
    from catalog.json when omitted)."""
    titles = collections if collections is not None else collection_titles()
    kinds = genres if genres is not None else collection_genres()
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
        "collection": titles[piece["collection"]],
        "collectionId": piece["collection"],
        "genre": piece_genre(piece, kinds),
        "benchmarkSet": piece.get("benchmarkSet"),
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


def is_piece_record(value) -> bool:
    """A per-piece verification record (as opposed to a top-level key such as spanFlags)."""
    return isinstance(value, dict) and "ok" in value


def ordered_verification(verification: dict, manifest: list[dict], catalog: list[dict],
                         catalog_index: dict, collection_index: dict) -> dict:
    """Piece records in manifest order (a failed piece, which has no entry, by its catalog piece),
    then every other top-level key in its existing order. Records of slugs no longer in the
    catalog are dropped."""
    pieces = {p["slug"]: p for p in catalog}
    entries = {e["slug"]: e for e in manifest}

    def key(slug: str) -> tuple:
        return sort_key(entries.get(slug) or pieces[slug], catalog_index, collection_index)

    records = sorted((k for k in verification if k in catalog_index), key=key)
    others = [k for k, v in verification.items() if k not in catalog_index and not is_piece_record(v)]
    return {k: verification[k] for k in records + others}


def merge_results(results: dict[str, tuple[dict | None, dict]]) -> list[dict]:
    """Merge this run's pieces into manifest.json and verification.json under the library lock.

    `results` maps slug -> (manifest entry, or None when the build failed; verification record).
    Every other entry and top-level key is kept; slugs no longer in the catalog are removed."""
    with jsonio.library_lock():
        catalog = load_catalog()  # re-read: other implementers may have added fragments meanwhile
        catalog_index, collection_index = catalog_indexes(catalog)
        by_slug = {e["slug"]: e for e in jsonio.read_json(MANIFEST, list)}
        verification = jsonio.read_json(VERIFICATION, dict)
        for slug, (entry, record) in results.items():
            if entry is None:
                by_slug.pop(slug, None)
            else:
                by_slug[slug] = entry
            verification[slug] = record
        manifest = sorted((e for s, e in by_slug.items() if s in catalog_index),
                          key=lambda e: sort_key(e, catalog_index, collection_index))
        jsonio.write_json(MANIFEST, manifest)
        jsonio.write_json(VERIFICATION, ordered_verification(verification, manifest, catalog, catalog_index,
                                                             collection_index))
    return manifest


def manifest_only() -> int:
    """Re-render every manifest entry from its catalog piece, its existing entry (source,
    hasEditorialFingering) and verification[slug]["stats"]; nothing is converted. The verification
    records are reordered with the manifest (a level change moves a piece) and their content is left
    as it is; records of slugs no longer in the catalog are dropped, as in merge_results."""
    with jsonio.library_lock():
        catalog = load_catalog()
        catalog_index, collection_index = catalog_indexes(catalog)
        titles = collection_titles()
        genres = collection_genres()
        old = {e["slug"]: e for e in jsonio.read_json(MANIFEST, list)}
        verification = jsonio.read_json(VERIFICATION, dict)
        missing = [p["slug"] for p in catalog
                   if p["slug"] not in old or "stats" not in (verification.get(p["slug"]) or {})]
        if missing:
            raise SystemExit(f"build it first: no manifest entry or verification stats for {', '.join(missing)}")
        manifest = [manifest_entry(p, {"source": old[p["slug"]]["source"],
                                       "hasEditorialFingering": old[p["slug"]]["hasEditorialFingering"]},
                                   verification[p["slug"]]["stats"], titles, genres=genres)
                    for p in catalog]
        manifest.sort(key=lambda e: sort_key(e, catalog_index, collection_index))
        jsonio.write_json(MANIFEST, manifest)
        jsonio.write_json(VERIFICATION, ordered_verification(verification, manifest, catalog, catalog_index,
                                                             collection_index))
    print(f"manifest: {len(manifest)} pieces")
    return 0


def main(argv=None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*", default=[])
    ap.add_argument("--png", action="store_true", help="also write PNG previews")
    ap.add_argument("--no-validate", action="store_true")
    ap.add_argument("--manifest-only", action="store_true",
                    help="re-render every manifest entry from the catalog, the existing entry and the "
                         "verification stats; converts nothing")
    ap.add_argument("--out-dir", type=Path, metavar="DIR",
                    help="write the scores (and fingered copies) into DIR, print the MIDI checks, and skip "
                         "validation and every write to manifest.json and verification.json")
    a = ap.parse_args(argv)
    if a.manifest_only:
        if a.only or a.out_dir or a.png or a.no_validate:
            ap.error("--manifest-only takes no other option")
        return manifest_only()

    catalog = load_catalog()
    unknown = sorted(set(a.only) - {p["slug"] for p in catalog})
    if unknown:
        ap.error(f"not in the catalog: {', '.join(unknown)}")
    selected = [p for p in catalog if not a.only or p["slug"] in a.only]
    out_dir = a.out_dir.resolve() if a.out_dir else SCORES
    out_dir.mkdir(parents=True, exist_ok=True)
    titles = collection_titles()
    genres = collection_genres()
    log = fetch_log()
    import validate

    results: dict[str, tuple[dict | None, dict]] = {}
    failures = 0
    for piece in selected:
        slug = piece["slug"]
        print(f"== {slug}")
        try:
            built = build_mutopia(piece, log, out_dir) if piece["source"] == "mutopia" else build_own(piece, out_dir)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"   BUILD FAILED: {type(exc).__name__}: {exc}")
            results[slug] = (None, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})
            continue
        for w in built["warnings"]:
            print("   conversion:", w)
        for name, chk in built["midiChecks"].items():
            print(f"   {name}: {'EXACT' if chk['exact'] else 'DIFF'} {chk['mode']} matched {chk['matched']}"
                  f"/{chk['xml']} (only xml {chk['only_xml_count']}, only midi {chk['only_midi_count']})")
        if a.out_dir:
            continue
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
        results[slug] = (manifest_entry(piece, built, stats, titles, genres=genres), {
            "ok": all(r["ok"] for r in vres.values()) if vres else None,
            "conversionWarnings": built["warnings"],
            "midiChecks": built["midiChecks"],
            "validation": {f: {"ok": r["ok"], "errors": r["errors"], "warnings": r["warnings"]}
                           for f, r in vres.items()},
            "stats": stats,
        })
    if a.out_dir:
        print(f"wrote {len(selected) - failures} piece(s) to {out_dir}; failures: {failures}")
        return 1 if failures else 0
    manifest = merge_results(results)
    print(f"manifest: {len(manifest)} pieces; failures: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
