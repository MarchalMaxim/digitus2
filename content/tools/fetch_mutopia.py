"""Download Mutopia Project sources for the digitus2 built-in library.

For every Mutopia piece of the merged catalog (``tools/catalog.json``, then the
``tools/catalog.d/*.json`` fragments) and, with ``--candidates``, every
directory of a candidates file, this fetches from the Mutopia website mirror of
the "ftp" tree:

  * the LilyPond source (``<name>.ly``, or ``<name>-lys.zip`` for multi-file
    pieces, which is unpacked safely),
  * the MIDI rendering LilyPond produced when the piece was published
    (``<name>.mid`` or ``<name>-mids.zip``) -- used by ``validate.py`` as an
    independent cross-check of the converted notes,
  * the RDF metadata (license, Mutopia id, LilyPond version),
  * the A4 PDF engraving (reference only, for eyeballing).

Everything lands in ``content/_raw/mutopia/<ftp path>/`` (gitignored), and
``content/_raw/mutopia/fetch_log.json`` records each file's URL, SHA-256 and
size and each directory's retrieval time (rewritten after every directory).
Downloads are *untrusted data*: this script only writes bytes to disk and
never executes or imports anything it downloads.

With ``--candidates PATH`` (``content/tools/candidates.json``, L1 plan Task 3)
the script then writes back into that file, under ``jsonio.update_json``, what
the fetch found for each candidate: the RDF licence, lyFile, maintainer and
LilyPond version, the published MIDI files, the A4 PDF's page count, the
SHA-256 of the main source and whether it is byte-identical to the pinned
mirror (``research/data/mutopia_src/ftp``). A candidate whose RDF licence is
not public domain, CC BY or CC BY-SA is marked ``"excluded"``; one whose RDF
licence differs from its ``expectedLicense`` is reported.

Usage (from the repository root):
    content/.venv/Scripts/python -I content/tools/fetch_mutopia.py [--force] [FTPDIR ...]
    content/.venv/Scripts/python -I content/tools/fetch_mutopia.py --candidates content/tools/candidates.json
    content/.venv/Scripts/python -I content/tools/fetch_mutopia.py --candidates content/tools/candidates.json --only-candidates
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import html.parser
import io
import json
import pathlib
import re
import sys
import time
import urllib.request
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # isolated mode (-I) does not put the script's directory on sys.path

import build  # noqa: E402  (standard library only)
import jsonio  # noqa: E402

CONTENT = HERE.parent
RAW = CONTENT / "_raw" / "mutopia"
MIRROR = CONTENT.parent / "research" / "data" / "mutopia_src" / "ftp"
BASE = "https://www.mutopiaproject.org/ftp/"
UA = "digitus2-content-fetch/1.0 (+https://github.com/; open-source piano fingering app)"
WANTED_SUFFIXES = (".ly", ".mid", ".rdf", "-lys.zip", "-mids.zip", "-a4.pdf")
# keys write_back() owns in a candidate (removed before each write-back, so a re-run is exact)
FACT_KEYS = ("rdfLicense", "lyFile", "lyFiles", "maintainer", "lilypondVersion", "midiFiles", "pdfPages",
             "mainSha256", "mirrorMatch", "excluded")


class _Links(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for k, v in attrs:
                if k == "href" and v and not v.startswith(("?", "/")) and "/" not in v.rstrip("/"):
                    self.links.append(v)


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as exc:  # pragma: no cover - network
            if attempt == 3:
                raise
            print(f"   retry {url}: {exc}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def _safe_extract(zdata: bytes, dest: pathlib.Path) -> list[str]:
    """Extract a zip without allowing path traversal (zip-slip)."""
    out = []
    dest = dest.resolve()
    with zipfile.ZipFile(io.BytesIO(zdata)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            target = (dest / info.filename).resolve()
            if dest not in target.parents:
                raise ValueError(f"unsafe path in zip: {info.filename!r}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(info))
            out.append(str(target.relative_to(dest)).replace("\\", "/"))
    return out


def fetch_piece(ftp_dir: str, force: bool) -> dict:
    dest = RAW / ftp_dir
    dest.mkdir(parents=True, exist_ok=True)
    index_url = BASE + ftp_dir + "/"
    parser = _Links()
    parser.feed(_get(index_url).decode("utf-8", "replace"))
    files = sorted({l for l in parser.links if l.endswith(WANTED_SUFFIXES)})
    record = {"ftpDir": ftp_dir, "indexUrl": index_url, "files": []}
    for name in files:
        target = dest / name
        url = index_url + name
        if target.exists() and not force:
            data = target.read_bytes()
        else:
            data = _get(url)
            target.write_bytes(data)
        entry = {"name": name, "url": url, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        if name.endswith(".zip"):
            entry["extracted"] = _safe_extract(data, dest / name[:-4])
        record["files"].append(entry)
        print(f"   {name:40s} {len(data):>8d} bytes")
    return record


def load_candidates(path: pathlib.Path) -> list[dict]:
    """The candidate rows of a candidates file ({"candidates": [...]})."""
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))["candidates"]


def merge_dirs(catalog_dirs: list[str], rows: list[dict]) -> list[str]:
    """The catalog's directories, then every candidate ftpDir not already listed, in file order."""
    dirs = list(catalog_dirs)
    for r in rows:
        if r["ftpDir"] not in dirs:
            dirs.append(r["ftpDir"])
    return dirs


def pdf_pages(data: bytes) -> int | None:
    """Number of page objects (/Type /Page, not the /Pages tree nodes) in a PDF; None if it has none
    in plain text (a PDF that keeps its objects in compressed object streams)."""
    n = len(re.findall(rb"/Type\s*/Page(?![A-Za-z])", data))
    return n or None


def midi_files(record: dict) -> list[str]:
    """The published MIDI files of a fetched directory, relative to it: '<name>.mid', and
    '<name>-mids/<file>' for the files extracted from '<name>-mids.zip'."""
    out = []
    for f in record.get("files", []):
        if f["name"].endswith(".mid"):
            out.append(f["name"])
        elif f["name"].endswith("-mids.zip"):
            out += [f"{f['name'][:-4]}/{x}" for x in f.get("extracted", []) if x.lower().endswith(".mid")]
    return sorted(out)


def _find(base: pathlib.Path, name: str) -> pathlib.Path | None:
    if (base / name).is_file():
        return base / name
    hits = sorted(p for p in base.rglob(name) if p.is_file()) if base.is_dir() else []
    return hits[0] if hits else None


def _mirror_copy(mirror: pathlib.Path, ftp_dir: str, rel: str) -> pathlib.Path | None:
    """The mirror's copy of a fetched file (`rel` is relative to ftpDir), or None. A -lys.zip whose
    entries sit in their own '<name>-lys/' folder extracts to '<name>-lys/<name>-lys/...', while the
    mirror keeps '<name>-lys/...'."""
    parts = rel.split("/")
    tries = [parts] + ([parts[1:]] if len(parts) > 2 and parts[0] == parts[1] else [])
    for t in tries:
        p = mirror.joinpath(ftp_dir, *t)
        if p.is_file():
            return p
    return None


def _mirror_match(ftp_dir: str, raw_file: pathlib.Path, mirror: pathlib.Path | None,
                  record: dict) -> bool | None:
    """Fetched main source byte-identical to the mirror's copy; None when there is nothing to
    compare with (no mirror, or no copy of that file in it). A -lys.zip is compared file by file
    with the mirror's '<name>-lys/' folder: False if any file with a mirror copy differs."""
    if mirror is None or not mirror.is_dir():
        return None
    base = RAW / ftp_dir
    rel = raw_file.relative_to(base).as_posix()
    if rel.endswith("-lys.zip"):
        stem = rel[:-4]
        extracted = next((f.get("extracted", []) for f in record.get("files", []) if f["name"] == rel), [])
        pairs = [(base / stem / x, _mirror_copy(mirror, ftp_dir, f"{stem}/{x}")) for x in extracted]
        pairs = [(a, b) for a, b in pairs if b is not None]
        if not pairs:
            return None
        return all(a.read_bytes() == b.read_bytes() for a, b in pairs)
    m = _mirror_copy(mirror, ftp_dir, rel)
    if m is None:
        return None
    return m.read_bytes() == raw_file.read_bytes()


def candidate_facts(cand: dict, record: dict, mirror: pathlib.Path | None) -> tuple[dict, list[str]]:
    """(facts to write into the candidate, report lines) for a fetched candidate."""
    ftp = cand["ftpDir"]
    rdf = build.rdf_info(ftp)
    facts: dict = {"rdfLicense": rdf["licence"], "lyFile": rdf["lyFile"]}
    report = []
    main = _find(RAW / ftp, rdf["lyFile"]) if rdf["lyFile"] else None
    if main is not None and main.name.endswith("-lys.zip"):
        facts["lyFiles"] = next((f.get("extracted", []) for f in record.get("files", [])
                                 if f["name"] == main.name), [])
    facts["maintainer"] = rdf["maintainer"]
    facts["lilypondVersion"] = rdf["lilypondVersion"]
    facts["midiFiles"] = midi_files(record)
    pdfs = [RAW / ftp / f["name"] for f in record.get("files", []) if f["name"].endswith("-a4.pdf")]
    pages = [pdf_pages(p.read_bytes()) for p in pdfs if p.is_file()]
    facts["pdfPages"] = sum(pages) if pages and None not in pages else None
    if main is None:
        report.append(f"{cand['slug']}: RDF lyFile {rdf['lyFile']!r} not found under {ftp}")
        facts["mainSha256"] = None
        facts["mirrorMatch"] = None
    else:
        facts["mainSha256"] = hashlib.sha256(main.read_bytes()).hexdigest()
        facts["mirrorMatch"] = _mirror_match(ftp, main, mirror, record)
    try:
        got = build.license_id(rdf["licence"])[0]
    except SystemExit:
        facts["excluded"] = (f"RDF licence {rdf['licence']!r} is not public domain, CC BY or CC BY-SA "
                             f"(L1 plan, Global Constraints)")
        report.append(f"{cand['slug']}: EXCLUDED, {facts['excluded']}")
    else:
        try:
            expected = build.license_id(cand.get("expectedLicense", ""))[0]
        except SystemExit:
            expected = cand.get("expectedLicense")
        if got != expected:
            report.append(f"{cand['slug']}: licence differs from the plan: RDF {got} ({rdf['licence']!r}), "
                          f"expected {expected}")
    return facts, report


def write_back(path: pathlib.Path, log: dict, mirror: pathlib.Path | None = MIRROR) -> list[str]:
    """Write the fetched facts into every candidate of `path` (under the library lock); return the
    report lines (licence surprises, exclusions, candidates not fetched, mirror mismatches)."""
    report: list[str] = []

    def fill(doc: dict) -> dict:
        for cand in doc["candidates"]:
            rec = log.get(cand["ftpDir"])
            try:
                if rec is None:
                    raise SystemExit("not in the fetch log")
                facts, lines = candidate_facts(cand, rec, mirror)
            except SystemExit as exc:
                report.append(f"{cand['slug']}: not fetched ({cand['ftpDir']}): {exc}")
                continue
            for k in FACT_KEYS:
                cand.pop(k, None)
            cand.update(facts)
            report.extend(lines)
            if facts["mirrorMatch"] is False:
                report.append(f"{cand['slug']}: fetched {facts['lyFile']} differs from the mirror's copy")
        return doc

    jsonio.update_json(pathlib.Path(path), fill)
    return report


def _write_log(log_path: pathlib.Path, log: dict) -> None:
    jsonio.write_atomic(log_path, json.dumps(log, indent=2, sort_keys=True).encode("utf-8"))


def main(argv=None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    ap.add_argument("--candidates", type=pathlib.Path, metavar="PATH",
                    help="also fetch every ftpDir of this candidates file (after the catalog's), then write "
                         "the fetched facts back into it")
    ap.add_argument("--only-candidates", action="store_true",
                    help="with --candidates: fetch only the candidates' directories")
    ap.add_argument("only", nargs="*", help="limit to these ftp dirs")
    args = ap.parse_args(argv)
    if args.only_candidates and not args.candidates:
        ap.error("--only-candidates needs --candidates PATH")
    catalog_dirs: list[str] = []
    if not args.only_candidates:
        for s in build.load_catalog():
            if s.get("source") == "mutopia" and s["ftpDir"] not in catalog_dirs:
                catalog_dirs.append(s["ftpDir"])
    rows = load_candidates(args.candidates) if args.candidates else []
    dirs = merge_dirs(catalog_dirs, rows)
    if args.only:
        dirs = [d for d in dirs if d in args.only]
    log_path = RAW / "fetch_log.json"
    log = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else {}
    failed = []
    for i, d in enumerate(dirs, 1):
        print(f"== [{i}/{len(dirs)}] {d}")
        try:
            rec = fetch_piece(d, args.force)
        except Exception as exc:  # noqa: BLE001 - network or server error: report, go on with the rest
            print(f"   FETCH FAILED: {type(exc).__name__}: {exc}")
            failed.append(d)
            continue
        prev = log.get(d)
        if prev and [f["sha256"] for f in prev["files"]] == [f["sha256"] for f in rec["files"]]:
            rec["retrievedAt"] = prev["retrievedAt"]
        else:
            rec["retrievedAt"] = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        log[d] = rec
        RAW.mkdir(parents=True, exist_ok=True)
        _write_log(log_path, log)  # after every directory: an interrupted run keeps what it fetched
        time.sleep(0.5)  # be polite to a volunteer-run server
    RAW.mkdir(parents=True, exist_ok=True)
    _write_log(log_path, log)
    print(f"wrote {log_path} ({len(dirs) - len(failed)}/{len(dirs)} directories fetched)")
    if args.candidates:
        report = write_back(args.candidates, log)
        print(f"wrote the fetched facts into {args.candidates}")
        for line in report:
            print("   " + line)
    if failed:
        print("failed: " + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
