"""The new own arrangements of the library, one module per collection (L1 plan, Task 5).

arrange.py keeps the ten arrangements of the first library in CORE_PIECES and merges these
modules into its PIECES; build.py builds them like any other own piece. A collection module
(children.py, christmas.py, hymns.py, folk.py, songs.py) defines two dicts keyed by slug:

    PIECES      the arrangement, in arrange.py's note language: key, time, optional pickup and
                dynamic, rh and lh, and optionally allowedClashes, {(bar, beat): reason}, for a
                dissonance on a strong beat that is meant (tests/test_arrangements.py)
    REFERENCES  the published melody the arrangement must reproduce note for note:
                dict(url="https://...", retrieved="YYYY-MM-DD", compare="exact" | "intervals",
                     description="which version: source, key, verse",
                     note="omitted or altered bars, or an empty string",
                     melody=[MIDI numbers of the sung melody, tied notes once])

A reference may come before its piece (the references are typed first); a piece without a
reference, a slug defined twice, or a slug of a core arrangement is a ValueError. The melody check
reads the built MusicXML: the top line of staff 1 (top_line) must equal the reference, or its
intervals must when compare is "intervals" (a transposed reference), and the spec's own top line
(spec_top_line). gates.py records the same comparison (melody_check) in verification.json.

Module template: copy this header comment into every collection module.

    # Arrangement rules (L1 plan, Task 5; checked by tests/test_arrangements.py):
    # Level 1: right hand in one five-finger position with at most one extension (the Twinkle A),
    #   single notes, range at most 10 semitones; left hand whole, half or quarter notes, single
    #   notes or open fifths in one position (range at most 7 semitones, at most 2 keys at once);
    #   keys C, G or F major or A or D minor (at most one sharp or flat), no note outside the key's
    #   scale; 2/4, 3/4, 4/4 or 6/8; tempo at most 120 quarters per minute; at most 32 bars.
    # Level 2: the right hand may move positions (range at most 19 semitones); left hand simple
    #   triads within a fifth, broken fifths, or a waltz bass at moderate tempo (at most 3 keys at
    #   once, spanning at most 9 semitones); keys with up to two sharps or flats.
    # Both levels: no triplets, repeats, grace notes or voices (the spec language does not have
    #   them); write repeats out. No minor or major second, tritone, or minor or major seventh between
    #   the left hand and the melody on a strong beat (beat 1; beats 1 and 3 in 4/4; both beats in
    #   6/8) unless allowedClashes gives the reason.

License: MIT.
"""
from __future__ import annotations

import importlib
import importlib.util
from pathlib import Path
from types import ModuleType

MODULES = ("children", "christmas", "hymns", "folk", "songs")
COMPARE = ("exact", "intervals")


def modules(extra_modules=()) -> list[ModuleType]:
    """The collection modules that exist, in MODULES order, then `extra_modules` (module objects
    or importable names; the tests pass a fixture module)."""
    found = []
    for name in MODULES:
        full = f"{__name__}.{name}"
        if importlib.util.find_spec(full) is None:
            continue
        try:
            found.append(importlib.import_module(full))
        except Exception as exc:  # noqa: BLE001 - name the module that breaks every own build
            raise ImportError(f"arrangements/{name}.py cannot be imported: {type(exc).__name__}: {exc}") from exc
    for mod in extra_modules:
        found.append(importlib.import_module(mod) if isinstance(mod, str) else mod)
    return found


def _table(mod: ModuleType, name: str) -> dict:
    table = getattr(mod, name, {})
    if not isinstance(table, dict):
        raise ValueError(f"{mod.__name__}: {name} must be a dict keyed by slug")
    return table


def load(extra_modules=(), core: dict | None = None) -> tuple[dict[str, dict], dict[str, dict]]:
    """(PIECES, REFERENCES) of every collection module present (and `extra_modules`).

    ValueError on a slug defined by two modules, a piece without a reference, or a slug of a
    core arrangement (`core`, arrange.CORE_PIECES by default)."""
    if core is None:
        import arrange  # arrange.py passes core= itself, so the two never import each other in a loop

        core = arrange.CORE_PIECES
    pieces: dict[str, dict] = {}
    refs: dict[str, dict] = {}
    piece_of: dict[str, str] = {}
    ref_of: dict[str, str] = {}
    for mod in modules(extra_modules):
        name = mod.__name__
        mod_pieces, mod_refs = _table(mod, "PIECES"), _table(mod, "REFERENCES")
        for slug in mod_refs:
            if slug in refs:
                raise ValueError(f"duplicate reference {slug!r} in {ref_of[slug]} and {name}")
            refs[slug], ref_of[slug] = mod_refs[slug], name
        for slug in mod_pieces:
            if slug in core:
                raise ValueError(f"{name}: {slug!r} collides with a core arrangement (arrange.CORE_PIECES)")
            if slug in pieces:
                raise ValueError(f"duplicate slug {slug!r} in {piece_of[slug]} and {name}")
            if slug not in mod_refs:
                raise ValueError(f"{name}: {slug!r} has no reference in its REFERENCES")
            pieces[slug], piece_of[slug] = mod_pieces[slug], name
    return pieces, refs


def reference(slug: str, extra_modules=()) -> dict:
    """The reference of `slug`: {melody, compare, url, retrieved, description, note}."""
    refs = load(extra_modules)[1]
    if slug not in refs:
        raise KeyError(f"no reference for {slug!r} in tools/arrangements/")
    return refs[slug]


def top_line(score: Path) -> list[int]:
    """The melody as built: the notes of staff 1 that are not grace notes or tie continuations,
    the highest pitch per onset, onsets in order (MIDI numbers)."""
    import xmlcheck as xc

    tops: dict = {}
    for n in xc.parse_musicxml(Path(score)).notes:
        if n.staff == "1" and n.pitch is not None and not n.grace and not n.tie_stop:
            tops[n.onset] = max(tops.get(n.onset, n.pitch), n.pitch)
    return [tops[t] for t in sorted(tops)]


def spec_top_line(spec: dict) -> list[int]:
    """The same line read from a spec's right hand: the top note of every note or chord that is not
    the continuation of a tie (a tie carries over rests, as in arrange.build_score)."""
    import arrange
    from music21 import pitch

    out: list[int] = []
    held = False
    for bar in arrange.parse(spec["rh"]):
        for e in bar:
            if e["pitches"] is None:
                continue
            if not held:
                out.append(max(pitch.Pitch(p).midi for p in e["pitches"]))
            held = e["tie"]
    return out


def compare_melody(got: list[int], ref: dict) -> dict:
    """Compare a top line with a reference: note for note ("exact") or interval for interval
    ("intervals"). firstDifference is {index, got, expected} of the first differing note (or
    interval), with None past the end of the shorter sequence."""
    mode = ref["compare"]
    if mode not in COMPARE:
        raise ValueError(f"compare must be one of {COMPARE}, not {mode!r}")
    a, b = list(got), list(ref["melody"])
    if mode == "intervals":
        a, b = [y - x for x, y in zip(a, a[1:])], [y - x for x, y in zip(b, b[1:])]
    first = None
    for i in range(max(len(a), len(b))):
        x = a[i] if i < len(a) else None
        y = b[i] if i < len(b) else None
        if x != y:
            first = {"index": i, "got": x, "expected": y}
            break
    return {"exact": first is None, "notes": len(got), "compare": mode, "reference": ref.get("url"),
            "firstDifference": first}


def melody_check(slug: str, score: Path, extra_modules=()) -> dict:
    """{exact, notes, compare, reference (URL), firstDifference} of a built score against the
    reference of its slug: the record gates.py writes to verification[slug]["melody"]."""
    return compare_melody(top_line(score), reference(slug, extra_modules))
