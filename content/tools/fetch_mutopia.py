"""Download Mutopia Project sources for the digitus2 built-in library.

For every piece listed in ``tools/catalog.json`` (source == "mutopia") this
fetches, from the Mutopia website mirror of the "ftp" tree:

  * the LilyPond source (``<name>.ly``, or ``<name>-lys.zip`` for multi-file
    pieces, which is unpacked safely),
  * the MIDI rendering LilyPond produced when the piece was published
    (``<name>.mid`` or ``<name>-mids.zip``) -- used by ``validate.py`` as an
    independent cross-check of the converted notes,
  * the RDF metadata (license, Mutopia id, LilyPond version),
  * the A4 PDF engraving (reference only, for eyeballing).

Everything lands in ``content/_raw/mutopia/<ftp path>/`` (gitignored).
Downloads are *untrusted data*: this script only writes bytes to disk and
never executes or imports anything it downloads.

Usage (from the repository root):
    content/.venv/Scripts/python -I content/tools/fetch_mutopia.py [--force]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import html.parser
import io
import json
import pathlib
import sys
import time
import urllib.request
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
CONTENT = HERE.parent
RAW = CONTENT / "_raw" / "mutopia"
BASE = "https://www.mutopiaproject.org/ftp/"
UA = "digitus2-content-fetch/1.0 (+https://github.com/; open-source piano fingering app)"
WANTED_SUFFIXES = (".ly", ".mid", ".rdf", "-lys.zip", "-mids.zip", "-a4.pdf")


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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    ap.add_argument("only", nargs="*", help="limit to these ftp dirs")
    args = ap.parse_args()
    catalog = json.loads((HERE / "catalog.json").read_text(encoding="utf-8"))["pieces"]
    dirs = []
    for s in catalog:
        if s.get("source") == "mutopia" and s["ftpDir"] not in dirs:
            dirs.append(s["ftpDir"])
    if args.only:
        dirs = [d for d in dirs if d in args.only]
    log_path = RAW / "fetch_log.json"
    log = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else {}
    for d in dirs:
        print(f"== {d}")
        rec = fetch_piece(d, args.force)
        prev = log.get(d)
        if prev and [f["sha256"] for f in prev["files"]] == [f["sha256"] for f in rec["files"]]:
            rec["retrievedAt"] = prev["retrievedAt"]
        else:
            rec["retrievedAt"] = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        log[d] = rec
        time.sleep(0.5)  # be polite to a volunteer-run server
    RAW.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(log, indent=2, sort_keys=True), encoding="utf-8")
    print(f"wrote {log_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
