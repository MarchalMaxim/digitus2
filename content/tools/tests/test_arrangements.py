"""The new own arrangements (L1 plan, Task 5; Review Focus 3).

Every new arrangement cites a dated reference, plays the reference's melody note for note (read
from the built MusicXML, not from the spec), keeps the rules of its level, has no unplanned clash
on a strong beat, and builds deterministically.

The per-piece tests are parametrized over the new own arrangements: every slug of
arrangements.load()[0] (the collection modules under tools/arrangements/) together with every own
piece of the merged catalog that is not one of the ten core arrangements. A catalog entry without a
PIECES entry, or the other way round, therefore fails here instead of being skipped.

The framework tests at the end run the same checks on tests/fixtures/arrangement_demo.py, a
four-bar piece that is never part of the library, so they run before any collection exists, and
on variants of it built to break one rule at a time.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from datetime import date
from fractions import Fraction as F
from pathlib import Path
from types import ModuleType

import pytest

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
SCORES = CONTENT / "scores"
sys.path.insert(0, str(TOOLS))
import arrange  # noqa: E402
import arrangements  # noqa: E402
import build  # noqa: E402
import xmlcheck as xc  # noqa: E402

PIECES, REFERENCES = arrangements.load()
CATALOG = {p["slug"]: p for p in build.load_catalog()}
VERIFICATION = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
CORE = set(arrange.CORE_PIECES)
NEW_OWN = sorted((set(PIECES) | {s for s, p in CATALOG.items() if p["source"] == "own"}) - CORE)
LEVEL_ONE = [s for s in NEW_OWN if CATALOG.get(s, {}).get("level") == 1]
LEVEL_TWO = [s for s in NEW_OWN if CATALOG.get(s, {}).get("level") == 2]
FIRST_OF_EACH_MODULE = [next(iter(m.PIECES)) for m in arrangements.modules() if getattr(m, "PIECES", None)]

# ---------------------------------------------------------------------------
# The checks (shared by the per-piece tests and the framework tests)
# ---------------------------------------------------------------------------
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Interval classes (semitones mod 12) flagged on a strong beat: minor and major second, tritone,
# minor and major seventh (and their compounds).
DISSONANT = {1, 2, 6, 10, 11}
LEVEL_RULES = {
    1: dict(rh_single=True, rh_range=10, lh_range=7, lh_keys=2, lh_span=None, fifths=1, diatonic=True,
            times={"2/4", "3/4", "4/4", "6/8"}, tempo=120, bars=32, proposal=2),
    2: dict(rh_single=False, rh_range=19, lh_range=None, lh_keys=3, lh_span=9, fifths=2, diatonic=False,
            times=None, tempo=None, bars=None, proposal=3),
}


def pname(midi: int) -> str:
    return f"{NAMES[midi % 12]}{midi // 12 - 1}"


def where(n) -> str:
    return f"bar {n.number} quarter {n.rel}"


def hand(xs, right: bool) -> list:
    """Pitched notes of one hand, grace notes left out (staff 1 is the right hand)."""
    return [n for n in xs.notes if n.pitch is not None and not n.grace and (n.staff == "1") == right]


def slices(notes: list) -> list[tuple[str, list[int]]]:
    """What a hand strikes together: the distinct pitches per onset, tie continuations left out
    (they are held, not struck), as in check_spans.py. [(position, pitches lowest first)]."""
    by_onset: dict = {}
    for n in notes:
        if not n.tie_stop:
            by_onset.setdefault(n.onset, (where(n), set()))[1].add(n.pitch)
    return [(w, sorted(ps)) for _, (w, ps) in sorted(by_onset.items())]


def level_problems(path: Path, level: int, tempo, proposal) -> list[str]:
    """Every way the built score breaks the rules of `level` (LEVEL_RULES); [] when it keeps them."""
    rule = LEVEL_RULES[level]
    xs = xc.parse_musicxml(path)
    rh, lh = hand(xs, True), hand(xs, False)
    out = []
    if rule["rh_single"]:
        chords = [w for w, ps in slices(rh) if len(ps) > 1]
        if chords:
            out.append(f"right hand plays {len(chords)} chord(s), the first at {chords[0]}")
    for name, notes, limit in (("right", rh, rule["rh_range"]), ("left", lh, rule["lh_range"])):
        if limit is not None and notes:
            span = max(n.pitch for n in notes) - min(n.pitch for n in notes)
            if span > limit:
                out.append(f"{name} hand range {span} semitones > {limit}")
    for w, ps in slices(lh):
        if len(ps) > rule["lh_keys"]:
            out.append(f"left hand strikes {len(ps)} keys at {w} > {rule['lh_keys']}")
        if rule["lh_span"] is not None and ps[-1] - ps[0] > rule["lh_span"]:
            out.append(f"left hand slice span {ps[-1] - ps[0]} at {w} > {rule['lh_span']}")
    fifths = int(xs.keys[0][1]) if xs.keys else 0
    if abs(fifths) > rule["fifths"]:
        out.append(f"key signature of {fifths} fifths: |fifths| > {rule['fifths']}")
    if rule["diatonic"]:
        # the key signature's major scale; a minor key's natural minor has the same pitch classes
        scale = {(7 * fifths + d) % 12 for d in (0, 2, 4, 5, 7, 9, 11)}
        outside = [n for n in rh + lh if n.pitch % 12 not in scale]
        if outside:
            out.append(f"{len(outside)} note(s) outside the key's scale, the first {pname(outside[0].pitch)} "
                       f"at {where(outside[0])}")
    if rule["times"] is not None:
        bad = sorted({f"{b}/{t}" for _, (b, t) in xs.times} - rule["times"])
        if bad:
            out.append(f"time signature {', '.join(bad)} not one of {sorted(rule['times'])}")
    if rule["tempo"] is not None and (tempo is None or tempo > rule["tempo"]):
        out.append(f"tempoBpm {tempo} > {rule['tempo']}")
    if rule["bars"] is not None:
        bars = sum(1 for m in xs.measures if not m.implicit)
        if bars > rule["bars"]:
            out.append(f"{bars} bars > {rule['bars']}")
    if proposal is None:
        out.append("no levelProposal in verification.json: run gates.py --only <slug>")
    elif proposal > rule["proposal"]:
        out.append(f"levelProposal {proposal} > {rule['proposal']}")
    return out


def strong_beats(beats: int, beat_type: int) -> list[tuple[int, F]]:
    """(beat number, offset in quarters) of a bar's strong beats: beat 1 in 2/4 and 3/4, beats 1 and
    3 in 4/4, both dotted-quarter beats in 6/8 (beat 1 in any other metre)."""
    if beat_type == 8 and beats % 3 == 0:
        unit, count = F(3, 2), beats // 3
        strong = [1, 2] if count == 2 else [1, 3] if count == 4 else [1]
    else:
        unit = F(4, beat_type)
        strong = [1, 3] if beats == 4 else [1]
    return [(k, (k - 1) * unit) for k in strong]


def strong_beat_clashes(path: Path, allowed: dict) -> list[str]:
    """Every left-hand key sounding on a strong beat at a dissonant interval class from the right
    hand's top note, unless `allowed` (the spec's allowedClashes, {(bar, beat): reason}) lists it
    with a reason. Held and tied notes count: they sound. A pickup bar has no strong beat."""
    xs = xc.parse_musicxml(path)
    rh, lh = hand(xs, True), hand(xs, False)
    reasoned = {k for k, why in allowed.items() if isinstance(why, str) and why.strip()}
    out = [f"allowedClashes {k}: give a reason" for k in allowed if k not in reasoned]
    beats, beat_type = xs.times[0][1]
    for m in xs.measures:
        if m.implicit:
            continue
        for beat, off in strong_beats(beats, beat_type):
            if off >= m.length:
                continue
            t = m.start + off
            top = [n.pitch for n in rh if n.onset <= t < n.onset + n.dur]
            if not top:
                continue
            for low in sorted({n.pitch for n in lh if n.onset <= t < n.onset + n.dur}):
                ic = (max(top) - low) % 12
                if ic in DISSONANT and (int(m.number), beat) not in reasoned:
                    out.append(f"bar {m.number} beat {beat}: {pname(max(top))} against {pname(low)} "
                               f"(interval class {ic})")
    return out


def reference_problems(ref: dict) -> list[str]:
    """What a reference lacks: an https URL, a retrieval date, the version used, at least 8 MIDI
    numbers of melody and a comparison mode."""
    out = []
    if not str(ref.get("url", "")).startswith("https://"):
        out.append(f"url {ref.get('url')!r} does not start with https://")
    try:
        ok = bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", ref.get("retrieved", ""))) and bool(
            date.fromisoformat(ref["retrieved"]))
    except (TypeError, ValueError):
        ok = False
    if not ok:
        out.append(f"retrieved {ref.get('retrieved')!r} is not a YYYY-MM-DD date")
    if not (isinstance(ref.get("description"), str) and ref["description"].strip()):
        out.append("description (which version: key, verse) is missing")
    if not isinstance(ref.get("note"), str):
        out.append("note (omitted or altered bars, or empty) is missing")
    mel = ref.get("melody")
    if not (isinstance(mel, list) and len(mel) >= 8
            and all(isinstance(m, int) and not isinstance(m, bool) and 21 <= m <= 108 for m in mel)):
        out.append("melody is not a list of at least 8 piano MIDI numbers")
    if ref.get("compare") not in ("exact", "intervals"):
        out.append(f"compare {ref.get('compare')!r} is not 'exact' or 'intervals'")
    return out


def _score(slug: str) -> Path:
    path = SCORES / f"{slug}.musicxml"
    assert path.exists(), f"{slug}: no score; run build.py --only {slug}"
    return path


def _proposal(slug: str):
    return ((VERIFICATION.get(slug) or {}).get("levelProposal") or {}).get("level")


# ---------------------------------------------------------------------------
# Per piece: every new own arrangement
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("slug", NEW_OWN)
def test_every_arrangement_has_a_catalog_entry_and_a_spec(slug):
    assert slug in CATALOG, f"{slug}: no catalog entry (catalog.d/<collection>.json)"
    piece = CATALOG[slug]
    assert piece["source"] == "own" and piece.get("arranger") == "digitus2 project", piece
    assert piece["level"] in (1, 2), "the L1 arrangements are level 1 or 2"
    assert slug in PIECES, f"{slug}: no PIECES entry in arrangements/<collection>.py"


@pytest.mark.parametrize("slug", NEW_OWN)
def test_every_reference_cites_a_dated_source(slug):
    assert slug in REFERENCES, f"{slug}: no REFERENCES entry in arrangements/<collection>.py"
    assert reference_problems(arrangements.reference(slug)) == []


@pytest.mark.parametrize("slug", NEW_OWN)
def test_built_melody_equals_the_reference(slug):
    assert slug in PIECES, f"{slug}: no PIECES entry"
    got = arrangements.top_line(_score(slug))
    assert got == arrangements.spec_top_line(PIECES[slug]), "the score is stale: build.py --only " + slug
    result = arrangements.compare_melody(got, arrangements.reference(slug))
    assert result["exact"], result


@pytest.mark.parametrize("slug", LEVEL_ONE)
def test_level_one_rules(slug):
    assert level_problems(_score(slug), 1, CATALOG[slug].get("tempoBpm"), _proposal(slug)) == []


@pytest.mark.parametrize("slug", LEVEL_TWO)
def test_level_two_rules(slug):
    assert level_problems(_score(slug), 2, CATALOG[slug].get("tempoBpm"), _proposal(slug)) == []


@pytest.mark.parametrize("slug", NEW_OWN)
def test_no_strong_beat_clashes(slug):
    assert slug in PIECES, f"{slug}: no PIECES entry"
    assert strong_beat_clashes(_score(slug), PIECES[slug].get("allowedClashes", {})) == []


@pytest.mark.parametrize("slug", FIRST_OF_EACH_MODULE)
def test_deterministic(slug):
    assert slug in CATALOG, f"{slug}: no catalog entry"
    meta = CATALOG[slug]
    assert arrange.build(slug, meta) == arrange.build(slug, meta)


# ---------------------------------------------------------------------------
# The framework, on the demo fixture and variants of it
# ---------------------------------------------------------------------------
def _demo_module() -> ModuleType:
    path = TOOLS / "tests" / "fixtures" / "arrangement_demo.py"
    spec = importlib.util.spec_from_file_location("arrangement_demo", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


DEMO = _demo_module()
SLUG = DEMO.SLUG
DEMO_MELODY = [60, 62, 64, 65, 67, 64, 65, 62, 59, 60]  # typed from the demo's right hand, tie held


def _build(directory: Path, slug: str, spec: dict, meta: dict) -> Path:
    with pytest.MonkeyPatch.context() as mp:
        mp.setitem(arrange.PIECES, slug, spec)
        data = arrange.build(slug, {**meta, "slug": slug})
    path = directory / f"{slug}.musicxml"
    path.write_bytes(data)
    return path


def _variant(directory: Path, tempo=None, **spec_changes) -> Path:
    meta = {**DEMO.META[SLUG], **({"tempoBpm": tempo} if tempo is not None else {})}
    return _build(directory, "demo-variant", {**DEMO.PIECES[SLUG], **spec_changes}, meta)


def _module(name: str, pieces=None, references=None) -> ModuleType:
    mod = ModuleType(name)
    if pieces is not None:
        mod.PIECES = pieces
    if references is not None:
        mod.REFERENCES = references
    return mod


@pytest.fixture(scope="module")
def demo_score(tmp_path_factory) -> Path:
    return _build(tmp_path_factory.mktemp("demo"), SLUG, DEMO.PIECES[SLUG], DEMO.META[SLUG])


def test_arrange_pieces_are_the_core_ten_then_the_collections():
    assert len(arrange.CORE_PIECES) == 10 and "twinkle-twinkle-little-star" in arrange.CORE_PIECES
    assert arrange.PIECES == {**arrange.CORE_PIECES, **PIECES}
    assert list(arrange.PIECES)[:10] == list(arrange.CORE_PIECES)


def test_load_merges_an_extra_module():
    pieces, refs = arrangements.load(extra_modules=[DEMO])
    assert set(pieces) - set(PIECES) == {SLUG} and pieces[SLUG] is DEMO.PIECES[SLUG]
    assert refs[SLUG] is DEMO.REFERENCES[SLUG]
    assert arrangements.reference(SLUG, extra_modules=[DEMO])["melody"] == DEMO_MELODY
    assert DEMO in arrangements.modules(extra_modules=[DEMO])


def test_load_takes_an_extra_module_by_name(monkeypatch):
    monkeypatch.setitem(sys.modules, "arrangement_demo", DEMO)
    assert SLUG in arrangements.load(extra_modules=["arrangement_demo"])[0]


def test_reference_of_an_unknown_slug_raises():
    with pytest.raises(KeyError, match="no reference"):
        arrangements.reference("no-such-tune")


def test_load_rejects_a_duplicate_slug():
    a = _module("a", {"tune": {}}, {"tune": {}})
    b = _module("b", {"tune": {}}, {})
    with pytest.raises(ValueError, match="duplicate slug 'tune'"):
        arrangements.load(extra_modules=[a, b])


def test_load_rejects_a_duplicate_reference():
    a = _module("a", {}, {"tune": {}})
    b = _module("b", {}, {"tune": {}})
    with pytest.raises(ValueError, match="duplicate reference 'tune'"):
        arrangements.load(extra_modules=[a, b])


def test_load_rejects_a_piece_without_a_reference():
    with pytest.raises(ValueError, match="'tune' has no reference"):
        arrangements.load(extra_modules=[_module("a", {"tune": {}}, {})])


def test_load_rejects_a_core_slug():
    with pytest.raises(ValueError, match="collides with a core arrangement"):
        arrangements.load(extra_modules=[_module("a", {"amazing-grace": {}}, {"amazing-grace": {}})])


def test_load_accepts_a_reference_before_its_piece():
    # Wave C types the references first (L1 plan, Tasks 8 to 12, step 1)
    pieces, refs = arrangements.load(extra_modules=[_module("a", None, {"tune": DEMO.REFERENCES[SLUG]})])
    assert "tune" in refs and "tune" not in pieces


def test_load_rejects_tables_that_are_not_dicts():
    with pytest.raises(ValueError, match="PIECES must be a dict"):
        arrangements.load(extra_modules=[_module("a", [("tune", {})], {})])


def test_reference_checks():
    assert reference_problems(DEMO.REFERENCES[SLUG]) == []
    bad = dict(url="http://example.org", retrieved="14.10.2026", melody=[60] * 7, compare="pitch")
    problems = reference_problems(bad)
    assert len(problems) == 6, problems
    assert reference_problems({**DEMO.REFERENCES[SLUG], "retrieved": "2026-02-30"})  # no such day
    assert reference_problems({**DEMO.REFERENCES[SLUG], "melody": [60] * 7 + [200]})


def test_top_line_of_the_demo(demo_score):
    assert arrangements.top_line(demo_score) == DEMO_MELODY
    assert arrangements.spec_top_line(DEMO.PIECES[SLUG]) == DEMO_MELODY
    r = arrangements.melody_check(SLUG, demo_score, extra_modules=[DEMO])
    assert r == {"exact": True, "notes": 10, "compare": "exact", "reference": DEMO.REFERENCES[SLUG]["url"],
                 "firstDifference": None}


def test_top_line_takes_the_highest_note_and_skips_held_notes(tmp_path):
    # a chord gives its top note; a tied chord is one onset; a rest is skipped
    path = _variant(tmp_path, rh="c'4 d' <e' g'>2~ | <e' g'>4 f' e' r | <c' e'>2 d'4 b | c'1 |")
    assert arrangements.top_line(path) == [60, 62, 67, 65, 64, 64, 62, 59, 60]
    assert arrangements.spec_top_line({"rh": "c'4 d' <e' g'>2~ | <e' g'>4 f' e' r | <c' e'>2 d'4 b | c'1 |"}) \
        == [60, 62, 67, 65, 64, 64, 62, 59, 60]


def test_compare_melody():
    ref = {"compare": "exact", "melody": [60, 62, 64], "url": "https://x"}
    assert arrangements.compare_melody([60, 62, 64], ref)["exact"] is True
    r = arrangements.compare_melody([60, 62, 65], ref)
    assert r["exact"] is False and r["firstDifference"] == {"index": 2, "got": 65, "expected": 64}
    r = arrangements.compare_melody([60, 62], ref)
    assert r["firstDifference"] == {"index": 2, "got": None, "expected": 64}
    transposed = {**ref, "compare": "intervals", "melody": [67, 69, 71]}
    assert arrangements.compare_melody([60, 62, 64], transposed)["exact"] is True
    r = arrangements.compare_melody([60, 62, 63], transposed)
    assert r["exact"] is False and r["firstDifference"] == {"index": 1, "got": 1, "expected": 2}
    assert arrangements.compare_melody([60, 62, 64], {**ref, "compare": "exact", "melody": [67, 69, 71]})[
        "exact"] is False


def test_demo_keeps_the_level_rules(demo_score):
    assert level_problems(demo_score, 1, 96, 1) == []
    assert level_problems(demo_score, 2, 96, 1) == []
    assert level_problems(demo_score, 1, 96, None) == [
        "no levelProposal in verification.json: run gates.py --only <slug>"]


def test_level_rules_flag_hands_scale_tempo_and_proposal(tmp_path):
    path = _variant(tmp_path, tempo=130, rh="c'4 d' e' fis' | <g' c''>2 e' | f'4 d' b c'~ | c'1 |",
                    lh="c2 e | <c e g>2 c | <d a d'>2 g | <c g>1 |")
    one = level_problems(path, 1, 130, 3)
    expected = ["right hand plays 1 chord(s), the first at bar 2 quarter 0", "right hand range 13 semitones > 10",
                "left hand range 14 semitones > 7", "left hand strikes 3 keys at bar 2 quarter 0 > 2",
                "left hand strikes 3 keys at bar 3 quarter 0 > 2",
                "1 note(s) outside the key's scale, the first F#4 at bar 1 quarter 3", "tempoBpm 130 > 120",
                "levelProposal 3 > 2"]
    assert one == expected
    assert level_problems(path, 2, 130, 4) == ["left hand slice span 12 at bar 3 quarter 0 > 9",
                                               "levelProposal 4 > 3"]
    assert level_problems(path, 2, 130, 3) == ["left hand slice span 12 at bar 3 quarter 0 > 9"]


def test_level_rules_flag_key_metre_and_length(tmp_path):
    rh = "e'4 fis' gis' a' | b'2 gis' | a'4 fis' dis' e'~ | e'1 | " * 9
    lh = "e2 gis | e e | fis b | <e b>1 | " * 9
    path = _variant(tmp_path, key="E", time="2/2", rh=rh, lh=lh)
    assert level_problems(path, 1, 96, 1) == [
        "key signature of 4 fifths: |fifths| > 1", "time signature 2/2 not one of ['2/4', '3/4', '4/4', '6/8']",
        "36 bars > 32"]
    assert level_problems(path, 2, 96, 1) == ["key signature of 4 fifths: |fifths| > 2"]


def test_strong_beats():
    assert strong_beats(2, 4) == [(1, 0)]
    assert strong_beats(3, 4) == [(1, 0)]
    assert strong_beats(4, 4) == [(1, 0), (3, 2)]
    assert strong_beats(6, 8) == [(1, 0), (2, F(3, 2))]


def test_demo_has_no_strong_beat_clashes(demo_score):
    assert strong_beat_clashes(demo_score, {}) == []


def test_clashes_are_flagged_unless_allowed(tmp_path):
    # bar 2 beat 3: E4 over D3 (a ninth); bar 4: the tied C4 still sounds over D3 (a seventh)
    path = _variant(tmp_path, lh="c2 e | c d | d g | d1 |")
    assert strong_beat_clashes(path, {}) == ["bar 2 beat 3: E4 against D3 (interval class 2)",
                                             "bar 4 beat 1: C4 against D3 (interval class 10)",
                                             "bar 4 beat 3: C4 against D3 (interval class 10)"]
    allowed = {(2, 3): "passing tone", (4, 1): "suspension", (4, 3): "suspension"}
    assert strong_beat_clashes(path, allowed) == []
    assert strong_beat_clashes(path, {**allowed, (2, 3): " "}) == [
        "allowedClashes (2, 3): give a reason", "bar 2 beat 3: E4 against D3 (interval class 2)"]


def test_clashes_skip_the_pickup_and_read_six_eight(tmp_path):
    # 6/8 with a pickup: the pickup's B3 over C3 (interval class 11) is not on a strong beat; beat 2
    # of bar 1, the second dotted-quarter beat, has E4 over F3 (interval class 11)
    path = _variant(tmp_path, time="6/8", pickup="1/8", rh="b8 | c'4. e'4. | c'2. |",
                    lh="c8 | c4. f4. | c2. |")
    assert strong_beat_clashes(path, {}) == ["bar 1 beat 2: E4 against F3 (interval class 11)"]


def test_demo_build_is_deterministic(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    a = _build(tmp_path / "a", SLUG, DEMO.PIECES[SLUG], DEMO.META[SLUG]).read_bytes()
    b = _build(tmp_path / "b", SLUG, DEMO.PIECES[SLUG], DEMO.META[SLUG]).read_bytes()
    assert a == b and b"<staves>2</staves>" in a
