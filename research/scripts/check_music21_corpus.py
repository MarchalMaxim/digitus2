#!/usr/bin/env python
"""Survey the music21 corpus for piano fingering annotations.

    research/.venv/Scripts/python.exe -I research/scripts/check_music21_corpus.py

1. raw scan of every corpus file for fingering encodings: MusicXML ``<fingering>`` (also inside
   .mxl), Humdrum ``**fing`` spines, ABC ``!1!``..``!5!`` decorations, MEI ``<fing``;
2. files with hits are parsed with music21 and the ``articulations.Fingering`` objects on notes
   are counted (per part).
Writes research/data/reports/music21_corpus_fingering.json.
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

RESEARCH = Path(__file__).resolve().parents[1]
DATA = RESEARCH / "data"


def main() -> int:
    import music21
    from music21 import articulations, corpus

    root = Path(corpus.getCorePaths()[0]).parents[0]
    for p in Path(music21.__file__).parent.joinpath("corpus").rglob("*"):
        root = Path(music21.__file__).parent / "corpus"
        break
    files = [p for p in root.rglob("*") if p.is_file()]
    ext = Counter(p.suffix.lower() for p in files)
    hits = []
    for p in files:
        suf = p.suffix.lower()
        try:
            if suf == ".mxl":
                with zipfile.ZipFile(p) as z:
                    txt = "".join(z.read(n).decode("utf-8", "replace") for n in z.namelist()
                                  if n.endswith((".xml", ".musicxml")) and not n.startswith("META-INF"))
            elif suf in (".xml", ".musicxml", ".krn", ".abc", ".mei", ".txt", ".md"):
                txt = p.read_text(encoding="utf-8", errors="replace")
            else:
                continue
        except (zipfile.BadZipFile, OSError):
            continue
        n = 0
        kind = ""
        if suf in (".xml", ".musicxml", ".mxl"):
            n = len(re.findall(r"<fingering\b", txt))
            kind = "musicxml <fingering>"
        elif suf == ".krn":
            n = txt.count("**fing")
            kind = "humdrum **fing"
        elif suf == ".abc":
            n = len(re.findall(r"![1-5]!", txt))
            kind = "abc !n!"
        elif suf == ".mei":
            n = len(re.findall(r"<fing\b", txt))
            kind = "mei <fing>"
        if n:
            hits.append({"file": p.relative_to(root).as_posix(), "kind": kind, "raw_count": n})
    # parse the hits with music21
    for h in hits:
        try:
            s = music21.converter.parse(root / h["file"])
            parts = []
            for part in s.parts if hasattr(s, "parts") and s.parts else [s]:
                notes = list(part.recurse().notes)
                nf = sum(1 for nt in notes for a in nt.articulations if isinstance(a, articulations.Fingering))
                parts.append({"part": str(part.partName or part.id), "notes": len(notes), "fingerings": nf})
            h["parsed_parts"] = parts
            h["title"] = (s.metadata.title if s.metadata else None)
            h["composer"] = (s.metadata.composer if s.metadata else None)
        except Exception as e:  # noqa: BLE001
            h["parse_error"] = f"{type(e).__name__}: {e}"
    out = {"music21_version": music21.__version__, "corpus_root": str(root), "n_files": len(files),
           "extensions": dict(ext.most_common()), "files_with_fingering": hits}
    dst = DATA / "reports" / "music21_corpus_fingering.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"music21 {music21.__version__}: {len(files)} corpus files; {len(hits)} with fingering encodings")
    for h in hits:
        print(" ", h["file"], h["kind"], h["raw_count"], h.get("parsed_parts", h.get("parse_error")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
