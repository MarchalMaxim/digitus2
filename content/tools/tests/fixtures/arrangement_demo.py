"""A four-bar demo arrangement and its reference: test data for tests/test_arrangements.py.

It has the shape of a collection module under tools/arrangements/ (PIECES and REFERENCES), so the
framework's own tests can run before any collection exists:
arrangements.load(extra_modules=[this module]). META holds the catalog fields that arrange.build()
needs. The piece is never part of the library and the tune is made up for the tests, so the
reference URL points nowhere real.

Shape on purpose: C major, right hand single notes from B3 to G4 with one tie across the last bar
line, left hand single notes from C3 to G3 and one open fifth, consonant on every strong beat.
License: MIT.
"""
from __future__ import annotations

SLUG = "demo-four-bars"

PIECES: dict[str, dict] = {
    SLUG: dict(
        key="C", time="4/4", dynamic="mf",
        rh="""c'4( d' e' f' | g'2 e' | f'4 d' b c'~ | c'1) |""",
        lh="""c2 e | c c | d g | <c g>1 |""",
    ),
}

REFERENCES: dict[str, dict] = {
    SLUG: dict(
        url="https://example.org/digitus2/demo-four-bars", retrieved="2026-10-14", compare="exact",
        description="Made up for the tests, C major", note="",
        melody=[60, 62, 64, 65, 67, 64, 65, 62, 59, 60],
    ),
}

META: dict[str, dict] = {
    SLUG: dict(slug=SLUG, source="own", level=1, title="Demo in Four Bars", composer="Traditional",
               composerDates=None, tempoBpm=96, arranger="digitus2 project"),
}
