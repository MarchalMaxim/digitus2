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
"""

from __future__ import annotations

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
