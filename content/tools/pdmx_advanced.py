"""The rule that places a MuseScore archive piece at level 6 (Advanced).

The level heuristic (level.py) has four cut points, so it never proposes level 6; the 50 Advanced
pieces of the curated library were placed by hand. The user asked for many more (2026-10-16) and chose
"override by rule": a stated rule, applied to every gated archive piece, with the reason written into
the catalog. The rule is fixed here before the yield is known and is not tuned to reach a count.

A piece is advanced when all three hold:

1. Its heuristic proposal is 5, or it is 4 with a score in the upper half of that band
   (SCORE_FLOOR = 10.9, the midpoint of the 9.11 to 12.68 band).
2. It is a whole piece, not a fragment: at least MIN_SECONDS of music and MIN_NOTES notes at its tempo.
3. It makes both technical demands that the key signature cannot fake: sustained fast notes (nps at
   least 6) and a stretch wider than an octave (span at least 12 semitones). Dense chords are reported
   in the reason when present but do not qualify a piece.

Revision (2026-10-16, after the first measurement): condition 3 first read "at least one of speed,
stretch and chord density". Of the 42 pieces it chose, five lacked either speed or stretch:
Gymnopedie 1 (stretch only), Gnossienne 3 (chords only), a Chopin etude and a Ravel concerto
movement (stretch and chords, not fast), and a pop song (speed and chords). Condition 3 now needs
speed and stretch together. Every threshold is unchanged, and the change can only remove pieces: it
was made for precision, not to reach a count.

Every library gate still applies (XSD, span check, zero lint law errors at the medium and the large
profile): the rule only chooses the level of a piece that already passed them. A placement from
proposal 5 is within one of the proposal; from proposal 4 it needs a `levelOverride`.

Relaxed gates (user decision, 2026-10-16: "relax the span and lint gates for level 6 only"). Advanced
pieces are the ones that stretch past a hand or make the engine break a fingering law, so the span
check and the lint law gate refuse most of them: 195 candidates meet the rule above and fail only
those two gates. A piece that meets the rule, passes every other gate (XSD, notes on both staves, the
validator) and fails only the span check or the lint law gate ships at level 6 with its flags
recorded in the catalog (`relaxedGates`) and in its notes, within a ceiling: a total waiver would
ship pieces where every note breaks a law (the worst candidate: 1,028 law errors per 1,000 notes). The
ceiling is RELAXED_LINT_PER_1000 law errors per 1,000 notes at each profile (ten times the engine's
measured rate on real pieces, the benchmark floor of 3.92) and RELAXED_SPANS_PER_1000 unplayable
slices per 1,000 notes. Set both to None to lift it.
"""

from __future__ import annotations

RELAXED_LINT_PER_1000 = 40.0
RELAXED_SPANS_PER_1000 = 20.0
SCORE_FLOOR = 10.9
MIN_SECONDS = 60.0
MIN_NOTES = 300
NPS_MIN = 6.0
SPAN_MIN = 12
CHORD_MIN = 0.5


def advanced(level: dict, notes: int) -> list[str]:
    """The technical demands that qualify a piece, or [] when it is not advanced.

    `level` is the gate's level record {features, score, level}; `notes` the piece's note count."""
    proposal, score, f = level["level"], level["score"], level["features"]
    if not (proposal >= 5 or (proposal == 4 and score >= SCORE_FLOOR)):
        return []
    if f["seconds"] < MIN_SECONDS or notes < MIN_NOTES:
        return []
    if f["nps"] < NPS_MIN or f["span"] < SPAN_MIN:
        return []
    demands = [f"sustained fast notes ({f['nps']:.1f} a second)", f"a stretch of {int(f['span'])} semitones"]
    if f["chord"] >= CHORD_MIN:
        demands.append(f"dense chords ({100 * f['chord']:.0f} percent of onsets)")
    return demands


def override_reason(level: dict, demands: list[str]) -> str:
    """The levelNote text of a piece placed at 6."""
    proposal, score = level["level"], level["score"]
    return (f"Advanced by the archive rule (pdmx_advanced.py): the heuristic proposes {proposal} "
            f"(score {score}), the upper end of its range for a whole piece, and the piece shows "
            f"{', '.join(demands)}. No syllabus placement is claimed.")


def _only_span_or_lint(gate: dict) -> bool:
    """The gate refused the piece for the span check or the lint law gate and nothing else."""
    reasons = gate.get("reasons") or []
    return bool(reasons) and all("lint law error" in r or "slice(s) no hand can strike" in r for r in reasons)


def relaxed_facts(gate: dict) -> dict:
    """What the relaxed gates let through, as the catalog records it: slices and law errors."""
    lint = gate["lint"]
    return {"spans": gate.get("spanFlags", 0),
            "lint": {"medium": lint["medium"]["errors"], "large": lint["large"]["errors"]}}


def relaxed(gate: dict, notes: int) -> bool:
    """True when the piece meets the advanced rule, fails only the span or lint gate, and is within the ceiling."""
    if gate.get("ok") or not gate.get("level") or not gate.get("lint") or not _only_span_or_lint(gate):
        return False
    if not advanced(gate["level"], notes):
        return False
    facts = relaxed_facts(gate)
    if RELAXED_LINT_PER_1000 is not None:
        if max(facts["lint"].values()) * 1000 / notes > RELAXED_LINT_PER_1000:
            return False
    if RELAXED_SPANS_PER_1000 is not None and facts["spans"] * 1000 / notes > RELAXED_SPANS_PER_1000:
        return False
    return True


def usable(gate: dict, notes: int) -> bool:
    """A candidate that can ship: it passed every gate, or it is a relaxed advanced piece."""
    return bool(gate.get("ok")) or relaxed(gate, notes)
