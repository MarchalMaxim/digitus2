"""Balliauw, Herremans, Palhazi Cuervo & Sörensen (2017) variable neighbourhood search for
polyphonic piano fingering (C++, https://bitbucket.org/mballiauw/piano-fingering-vns,
no license file, last commit 2014-11-06; linked from dorienherremans.com).

The program reads MusicXML through a very specific importer: one "Piano" part, note start
times are *re-computed* from the durations of all preceding <note>s in the measure, assuming
right-hand voices 1..R and left-hand voices 5..4+L each fill the whole measure in order
(MuseScore's export layout); <tie>s are not understood.  ``pig_to_vns_musicxml`` therefore
writes such a file from the PIG notes:
  * time axis = rank of the distinct onset/offset times (divisions = 1): the program allocates
    one "slice" per division, so an absolute time grid makes it extremely slow; ranks keep the
    order and the overlaps of notes; a single measure holds the whole piece (no ties needed);
  * per hand, notes with identical (onset, offset) form a chord; chords are packed greedily
    into the fewest voices such that a voice never overlaps itself (max 4 voices per hand;
    if a 5th would be needed, the earliest-ending sounding note is shortened);
  * every voice is padded with rests to fill the measure, voices are separated by <backup>.
The program's stdout lists "ID, Pitch, Start, Duration, Hand, Voice, Fingering" with IDs in
document order of the non-rest notes, which we map back to the PIG notes.

Patch (patches/balliauw_vns.patch): ``-seed N`` makes the random perturbations reproducible
(upstream seeds from gettimeofday).  Build: see README (g++ -O2 -static *.cpp).

    python run_balliauw_vns.py --pieces test --timeout 900
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "mballiauw__piano-fingering-vns"
_STEPS = [("C", 0), ("C", 1), ("D", 0), ("D", 1), ("E", 0), ("F", 0), ("F", 1), ("G", 0), ("G", 1),
          ("A", 0), ("A", 1), ("B", 0)]


def _pitch_xml(midi: int) -> str:
    step, alter = _STEPS[midi % 12]
    octave = midi // 12 - 1
    return (f"<pitch><step>{step}</step>" + (f"<alter>{alter}</alter>" if alter else "")
            + f"<octave>{octave}</octave></pitch>")


def pig_to_vns_musicxml(notes, time_axis: str = "events") -> tuple[str, list[int]]:
    """Return (musicxml, order) where order[k] = PIG index of the k-th non-rest <note>.

    The program allocates one "slice" per division, so an absolute time grid makes it very
    slow.  time_axis="events" (default): ranks of all distinct onset *and* offset times (exact
    order and overlaps); time_axis="onsets": rank of the distinct onsets, a note lasts until
    the first onset at or after its offset (half the slices, but not faster in practice).
    """
    import bisect
    onsets = sorted({n.onset for n in notes})
    if time_axis == "events":
        times = sorted({n.onset for n in notes} | {n.offset for n in notes})
        to_rank = lambda t: times.index(t)  # noqa: E731
        off_rank = lambda n: times.index(n.offset)  # noqa: E731
        measure_len = len(times) + 1
    else:
        pos = {t: i for i, t in enumerate(onsets)}
        to_rank = lambda t: pos[t]  # noqa: E731
        off_rank = lambda n: bisect.bisect_left(onsets, n.offset - 1e-9)  # noqa: E731
        measure_len = len(onsets) + 1
    beats = measure_len  # divisions = 1 per quarter -> divisions per measure = beats
    voices_xml: list[str] = []
    order: list[int] = []
    for channel, staff, first_voice in ((0, 1, 1), (1, 2, 5)):
        sel = [n for n in notes if n.channel == channel]
        chords: dict[tuple[int, int], list] = {}
        for n in sel:
            on = to_rank(n.onset)
            off = max(off_rank(n), on + 1)
            chords.setdefault((on, off), []).append(n)
        voices: list[list[tuple[int, int, list]]] = []
        for (on, off), members in sorted(chords.items()):
            members.sort(key=lambda n: n.pitch)
            placed = False
            for v in voices:
                if v[-1][1] <= on:
                    v.append((on, off, members))
                    placed = True
                    break
            if not placed:
                if len(voices) < 4:
                    voices.append([(on, off, members)])
                else:  # shorten the voice that frees earliest
                    v = min(voices, key=lambda v: v[-1][1])
                    pon, poff, pm = v[-1]
                    v[-1] = (pon, max(on, pon + 1), pm)
                    v.append((on, off, members))
        if not voices:
            voices = [[]]
        for vi, v in enumerate(voices):
            vnum = first_voice + vi
            parts = []
            t = 0
            for on, off, members in v:
                if on > t:
                    parts.append(f"<note><rest/><duration>{on - t}</duration><voice>{vnum}</voice>"
                                 f"<staff>{staff}</staff></note>")
                dur = off - on
                for k, n in enumerate(members):
                    parts.append("<note>" + ("<chord/>" if k else "") + _pitch_xml(n.pitch)
                                 + f"<duration>{dur}</duration><voice>{vnum}</voice>"
                                 f"<staff>{staff}</staff></note>")
                    order.append(n.idx)
                t = off
            if t < measure_len:
                parts.append(f"<note><rest/><duration>{measure_len - t}</duration><voice>{vnum}</voice>"
                             f"<staff>{staff}</staff></note>")
            voices_xml.append("".join(parts))
    body = f"<backup><duration>{measure_len}</duration></backup>".join(voices_xml)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<score-partwise version="3.0"><part-list><score-part id="P1"><part-name>Piano</part-name>'
           '</score-part></part-list><part id="P1"><measure number="1"><attributes>'
           '<divisions>1</divisions><key><fifths>0</fifths></key>'
           f'<time><beats>{beats}</beats><beat-type>4</beat-type></time><staves>2</staves>'
           '<clef number="1"><sign>G</sign><line>2</line></clef>'
           '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
           + body + "</measure></part></score-partwise>\n")
    return xml, order


def main() -> None:
    ap = base_arg_parser(__doc__, "balliauw_vns")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--exe", default=None, help="default: <repo>/bin/apf.exe")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--timeout", type=float, default=1800.0, help="seconds per piece")
    ap.add_argument("--time-axis", default="events", choices=["events", "onsets"])
    args = ap.parse_args()
    exe = Path(args.exe) if args.exe else Path(args.repo) / "bin" / "apf.exe"
    if not exe.is_file():
        raise SystemExit(f"{exe} missing; build it first (see README)")

    def predict(notes, inp):
        work = Path(tempfile.mkdtemp(prefix="vns_"))
        xml, order = pig_to_vns_musicxml(notes, args.time_axis)
        (work / "in.xml").write_text(xml, encoding="utf-8")
        res = subprocess.run([str(exe), "-bestand", "in.xml", "-seed", str(args.seed)], cwd=str(work),
                             capture_output=True, text=True, timeout=args.timeout)
        lines = res.stdout.splitlines()
        try:
            start = next(i for i, l in enumerate(lines) if l.startswith("ID, Pitch")) + 1
        except StopIteration:
            raise RuntimeError("no note index in VNS output: " + escape(res.stdout[-500:] + res.stderr[-500:]))
        fing = {}
        for l in lines[start:]:
            cols = [c.strip() for c in l.split(",")]
            if len(cols) != 7 or not cols[0].isdigit():
                break
            fing[int(cols[0])] = (cols[4], int(cols[6]))
        if len(fing) != len(order):
            raise RuntimeError(f"VNS returned {len(fing)} notes, expected {len(order)}")
        out = [None] * len(notes)
        for k, idx in enumerate(order):
            hand, f = fing[k + 1]
            if not 1 <= f <= 5:
                raise RuntimeError(f"invalid finger {f}")
            out[idx] = f if notes[idx].channel == 0 else -f
        return out

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "exe": str(exe), "seed": args.seed, "timeout_s": args.timeout,
                     "conversion": f"PIG -> MusicXML, time axis = {args.time_axis} ranks, single measure"},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
