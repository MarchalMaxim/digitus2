#!/usr/bin/env python
"""The study's reduction as an oracle for the engine's (issue 94).

    research/.venv-readability/Scripts/python.exe -X utf8 -I research/readability/oracle_rh.py PIG_DIR [OUT.json]

PIG_DIR holds one PIG export of the engine's fingering per piece, ``<slug>.txt``, written by the
engine's CLI for the editorial core30 pieces that have no grace notes (the study's reader slices
graces differently):

    pnpm --filter @digitus2/engine exec tsx cli/main.ts finger content/scores/<slug>.musicxml \
        --format pig --profile medium --out PIG_DIR/<slug>.txt

For each file the right hand is read into the study's player model and reduced with
:func:`readability.reduce.minimal_sufficient` without repeat memory (R5 is a deliberate divergence
of the engine), and the fingers and the printed note ids are written to the fixture
``research/readability/fixtures/reduction_oracle_rh.json``. The engine's test
(``packages/engine/src/readability/reduce.oracle.test.ts``) feeds the fingers to its own
unbudgeted pass and compares the printed sets note for note. The left hand is not compared:
the study adds the lowest wrong note of a chord, which is the thumb side only in the right hand.

Note numbering follows the study's ``corpus.events``: onset, then pitch.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
if str(RESEARCH) not in sys.path:      # -I isolates sys.path
    sys.path.insert(0, str(RESEARCH))

from fingering_eval.pig_io import parse_finger, read_pig  # noqa: E402
from readability.corpus import RH, NoteRec  # noqa: E402
from readability.player_model import HandReader  # noqa: E402
from readability.reduce import minimal_sufficient  # noqa: E402

DEFAULT_OUT = HERE / "fixtures" / "reduction_oracle_rh.json"


def right_hand(path: Path) -> tuple[list[NoteRec], dict[int, str]]:
    pf = read_pig(path)
    rows = [n for n in pf.notes if n.channel == 0]
    rows.sort(key=lambda n: (n.onset, n.pitch))
    notes, ids = [], {}
    for i, n in enumerate(rows):
        finger = abs(parse_finger(n.finger).press)
        notes.append(NoteRec(idx=i, onset=n.onset, offset=n.offset, pitch=n.pitch, hand=RH, finger=finger,
                             finger_raw=n.finger))
        ids[i] = n.id
    return notes, ids


def main(argv: list[str]) -> int:
    if not 2 <= len(argv) <= 3:
        print(__doc__)
        return 2
    pig_dir = Path(argv[1])
    out = Path(argv[2]) if len(argv) == 3 else DEFAULT_OUT
    result: dict[str, dict] = {}
    for path in sorted(pig_dir.glob("*.txt")):
        notes, ids = right_hand(path)
        kept, _ = minimal_sufficient(HandReader(notes), "rules")
        result[path.stem] = {
            "fingers": [[ids[n.idx], n.finger] for n in notes],
            "printed": [ids[i] for i in sorted(kept)],
        }
        print(f"{path.stem}: {len(notes)} right-hand notes, {len(kept)} printed")
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(result, f, indent=1, sort_keys=True)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
