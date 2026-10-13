"""Featurise every corpus once (full family list) into research/learn/cache.

    research/.venv/Scripts/python.exe -I -m learn.experiments.build_cache [corpus ...]
"""
from __future__ import annotations

import sys

from ._common import log, lower_priority

ALL = ["pig-validation", "pig-train", "textbook", "beringer", "mutopia-test", "mutopia-train"]


def main() -> int:
    lower_priority()
    from learn.corpus import load_corpus_with_features

    names = sys.argv[1:] or ALL
    for name in names:
        pieces = load_corpus_with_features(name, log)
        hands = sum(len(p.examples()) for p in pieces)
        fingered = sum(ex.fingered() for p in pieces for ex in p.examples())
        log(f"{name}: {hands} hand examples, {fingered} fingered notes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
