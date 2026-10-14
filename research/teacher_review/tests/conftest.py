import sys
from fractions import Fraction
from pathlib import Path

import pytest

RESEARCH = Path(__file__).resolve().parents[2]
# This checkout's research/ goes first, always: research/.venv may be a junction to the main
# checkout's venv, whose digitus2_research.pth puts the MAIN checkout's research/ on sys.path, so
# in a git worktree "teacher_review" could otherwise resolve to the other checkout's harness.
while str(RESEARCH) in sys.path:
    sys.path.remove(str(RESEARCH))
sys.path.insert(0, str(RESEARCH))

import teacher_review  # noqa: E402

if Path(teacher_review.__file__).resolve().parent != RESEARCH / "teacher_review":
    raise RuntimeError(f"teacher_review imported from {teacher_review.__file__}, not from this checkout "
                       f"({RESEARCH / 'teacher_review'}); run pytest from this checkout's root")

from teacher_review.model import Event, Passage, number_events  # noqa: E402


def make_passage(rh: list[tuple[float, float, list[int], list[int]]], lh=None, meter=(4, 4), tempo=120,
                 target=("R",), pid="t-0001", composer="Test", style="exercise") -> Passage:
    """Build a passage from (onset_q, dur_q, pitches, fingers) tuples; onsets in quarters from
    bar 1. Pitches empty = rest."""
    p = Passage(passage_id=pid, composer=composer, style=style, meter=meter, tempo_qpm=tempo, bar_first=1,
                bar_last=1, target_hands=list(target))
    p.notes_meta["bar1_q"] = 0
    qsec = 60.0 / tempo
    for hand, rows in (("R", rh), ("L", lh or [])):
        if not rows:
            continue
        evs = [Event(hand, Fraction(o).limit_denominator(48), float(o) * qsec, Fraction(d).limit_denominator(48),
                     list(pi), list(fi)) for o, d, pi, fi in rows]
        p.events[hand] = number_events(evs, hand)
    last = max(float(e.onset_q) for evs in p.events.values() for e in evs)
    p.bar_last = int(last // float(p.bar_q)) + 1
    return p


@pytest.fixture
def scale_passage() -> Passage:
    # RH C major scale up and down over two bars, standard fingering, LH context without fingers
    ups = [60, 62, 64, 65, 67, 69, 71, 72]
    fingers = [1, 2, 3, 1, 2, 3, 4, 5]
    rh = [(i * 0.5, 0.5, [pch], [f]) for i, (pch, f) in enumerate(zip(ups, fingers))]
    rh += [(4 + i * 0.5, 0.5, [pch], [f]) for i, (pch, f) in enumerate(zip(reversed(ups), reversed(fingers)))]
    lh = [(0, 2, [48, 52, 55], [0, 0, 0]), (2, 2, [48, 52, 55], [0, 0, 0]), (4, 4, [43, 47, 50], [0, 0, 0])]
    return make_passage(rh, lh)
