"""Plain MusicXML for the tools that read a score by path.

Scores from the PDMX archive are stored as `scores/<slug>.musicxml.gz` (see `build.build_pdmx`),
but the engine CLI, `xmlcheck` and the level features read plain files. `plain_path` returns
the path itself for a plain file, and for a .gz file a plain copy in `content/_build/plain/`
named after the score (`<slug>.musicxml`). The copy is rewritten only when its bytes change.
"""

from __future__ import annotations

import gzip
from pathlib import Path

import jsonio

CONTENT = Path(__file__).resolve().parent.parent
PLAIN = CONTENT / "_build" / "plain"


def plain_path(path: Path | str) -> Path:
    path = Path(path)
    if path.suffix != ".gz":
        return path
    data = gzip.decompress(path.read_bytes())
    PLAIN.mkdir(parents=True, exist_ok=True)
    target = PLAIN / path.name.removesuffix(".gz")
    if not target.exists() or target.read_bytes() != data:
        jsonio.write_atomic(target, data)
    return target
