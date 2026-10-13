"""LilyPond (Mutopia) -> MusicXML 4.0 converter for the digitus2 content pipeline.

Why not python-ly's ``ly musicxml``?  It re-implements LilyPond's semantics in
Python and, on the Mutopia files we need, produces wrong meters, lost voices
and missing measures.  Instead we let LilyPond 2.24 itself interpret the
source and only *observe* the result:

  1. copy the source (and sibling include files) into ``content/_build/<slug>/src``,
  2. apply optional per-piece text patches (``catalog.json``),
  3. upgrade the syntax with LilyPond's ``convert-ly``,
  4. compile with ``tools/lilypond/xmldump.ily`` included, which writes
     LilyPond's interpretation (notes, rests, ties, beams, slurs, tuplets,
     articulations, fingerings, dynamics, clefs, keys, time signatures, bar
     lines, volta brackets, ...) as JSON lines.  LilyPond also writes its MIDI
     and PDF, which ``validate.py`` uses as an independent cross-check,
  5. build a partwise MusicXML 4.0 document (one part, two staves) from the dump.

Run ``python -I ly2musicxml.py --help`` for a stand-alone CLI.
License: MIT.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from fractions import Fraction as F
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
CONTENT = HERE.parent
XMLDUMP = HERE / "lilypond" / "xmldump.ily"

STEP_NAMES = "CDEFGAB"
STEP_SEMIS = [0, 2, 4, 5, 7, 9, 11]
TYPE_NAMES = {-2: "long", -1: "breve", 0: "whole", 1: "half", 2: "quarter", 3: "eighth",
              4: "16th", 5: "32nd", 6: "64th", 7: "128th", 8: "256th"}
ACC_NAMES = {F(0): "natural", F(1, 2): "sharp", F(-1, 2): "flat", F(1): "double-sharp",
             F(-1): "flat-flat", F(1, 4): "quarter-sharp", F(-1, 4): "quarter-flat",
             F(3, 4): "three-quarters-sharp", F(-3, 4): "three-quarters-flat"}
DYNAMICS = {"p", "pp", "ppp", "pppp", "ppppp", "pppppp", "f", "ff", "fff", "ffff", "fffff",
            "ffffff", "mp", "mf", "sf", "sfp", "sfpp", "fp", "rf", "rfz", "sfz", "sffz", "fz",
            "n", "pf", "sfzp"}
# Text scripts that are really fingerings (e.g. finger substitutions written as "5 - 4")
FINGER_TEXT = re.compile(r"^\s*[1-5](\s*[-–]\s*[1-5])*\s*$")
# Text scripts that start with a dynamic mark, e.g. "p leggieremente"
DYN_WORDS = re.compile(r"^(pp|p|mp|mf|f|ff|sfz|sf|fp)\s+(\S.*)$")


def finger_text(t: str) -> str:
    return re.sub(r"\s+", "", t).replace("–", "-")
# LilyPond articulation-type -> (MusicXML container, element, attributes)
ARTICULATIONS = {
    "staccato": ("articulations", "staccato", {}),
    "staccatissimo": ("articulations", "staccatissimo", {}),
    "tenuto": ("articulations", "tenuto", {}),
    "accent": ("articulations", "accent", {}),
    "marcato": ("articulations", "strong-accent", {"type": "up"}),
    "portato": ("articulations", "detached-legato", {}),
    "espressivo": ("articulations", "soft-accent", {}),
    "fermata": ("notations", "fermata", {"type": "upright"}),
    "shortfermata": ("notations", "fermata", {"type": "upright"}),
    "longfermata": ("notations", "fermata", {"type": "upright"}),
    "verylongfermata": ("notations", "fermata", {"type": "upright"}),
    "trill": ("ornaments", "trill-mark", {}),
    "prall": ("ornaments", "inverted-mordent", {}),
    "mordent": ("ornaments", "mordent", {}),
    "prallprall": ("ornaments", "inverted-mordent", {"long": "yes"}),
    "prallmordent": ("ornaments", "mordent", {"long": "yes"}),
    "upprall": ("ornaments", "inverted-mordent", {"long": "yes"}),
    "downprall": ("ornaments", "inverted-mordent", {"long": "yes"}),
    "turn": ("ornaments", "turn", {}),
    "reverseturn": ("ornaments", "inverted-turn", {}),
    "upbow": ("technical", "up-bow", {}),
    "downbow": ("technical", "down-bow", {}),
}


class ConversionError(RuntimeError):
    pass


# ----------------------------------------------------------------------------
# Running LilyPond
# ----------------------------------------------------------------------------

def lilypond_bin() -> Path:
    import lilypond  # PyPI wheel "lilypond" (official binaries)

    exe = Path(lilypond.executable())
    return exe.parent


def _lily_cmd(name: str) -> list[str]:
    bindir = lilypond_bin()
    if name == "lilypond":
        for cand in (bindir / "lilypond.exe", bindir / "lilypond"):
            if cand.exists():
                return [str(cand)]
    else:
        script = bindir / f"{name}.py"
        if script.exists():
            py = bindir / "python.exe"
            return [str(py if py.exists() else sys.executable), str(script)]
        if (bindir / name).exists():
            return [str(bindir / name)]
    raise ConversionError(f"cannot find LilyPond tool {name!r} in {bindir}")


def _midi_order(stem: str):
    """LilyPond names the MIDI of the n-th score <stem>.mid, <stem>-1.mid, <stem>-2.mid ..."""
    def key(p: Path):
        if p.stem == stem:
            return (0, p.name)
        rest = p.stem[len(stem) + 1:] if p.stem.startswith(stem + "-") else ""
        return (int(rest) if rest.isdigit() else 999, p.name)
    return key


def apply_patches(src_dir: Path, patches: list[dict], stage: str) -> None:
    for p in patches:
        if p.get("stage", "post") != stage:
            continue
        path = src_dir / p["file"]
        text = path.read_text(encoding="utf-8")
        new, n = re.subn(p["find"], p["replace"], text, flags=re.M | re.S if p.get("dotall") else re.M)
        want = p.get("count")
        if n == 0 or (want is not None and n != want):
            raise ConversionError(f"patch {p['find']!r} on {p['file']} matched {n} times (want {want})")
        path.write_text(new, encoding="utf-8")


def compile_lilypond(source_files: list[Path], main: str, build_dir: Path,
                     patches: list[dict] | None = None, quiet: bool = True) -> dict:
    """Copy, patch, convert-ly and compile a LilyPond source with the dump engraver.

    Returns paths of the dump, the MIDI files and the PDF produced in build_dir.
    """
    patches = patches or []
    src_dir = build_dir / "src"
    out_dir = build_dir / "out"
    if build_dir.exists():
        shutil.rmtree(build_dir)
    src_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)
    for f in source_files:
        shutil.copy2(f, src_dir / f.name)
    apply_patches(src_dir, patches, "pre")
    main_text = (src_dir / main).read_text(encoding="utf-8", errors="replace")
    mv = re.search(r'\\version\s+"([0-9.]+)"', main_text)
    main_version = mv.group(1) if mv else None
    for f in sorted(src_dir.iterdir()):
        if f.suffix not in (".ly", ".ily"):
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        args = ["-e"]
        if "\\version" not in text:
            if not main_version:
                continue
            args += ["-f", main_version]  # include file without a version statement: assume the main file's
        r = subprocess.run(_lily_cmd("convert-ly") + args + [str(f)],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        (build_dir / f"convert-ly-{f.name}.log").write_text(r.stdout + r.stderr, encoding="utf-8")
        if r.returncode != 0:
            raise ConversionError(f"convert-ly failed on {f.name}:\n{r.stderr[-2000:]}")
    for bak in src_dir.glob("*~"):
        bak.unlink()
    apply_patches(src_dir, patches, "post")
    wrapper = src_dir / "__digitus2_wrapper.ly"
    wrapper.write_text(
        '\\version "2.24.0"\n'
        f'\\include "{XMLDUMP.as_posix()}"\n'
        f'\\include "{(src_dir / main).as_posix()}"\n',
        encoding="utf-8",
    )
    dump = build_dir / "dump.jsonl"
    env = dict(os.environ, XMLDUMP_OUT=str(dump))
    stem = Path(main).stem
    r = subprocess.run(
        _lily_cmd("lilypond") + ["-dno-point-and-click", "-ddelete-intermediate-files",
                                 "-o", str(out_dir / stem), str(wrapper)],
        cwd=src_dir, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    log = r.stdout + r.stderr
    (build_dir / "lilypond.log").write_text(log, encoding="utf-8")
    if r.returncode != 0 or not dump.exists():
        raise ConversionError(f"lilypond failed for {main} (see {build_dir / 'lilypond.log'}):\n{log[-3000:]}")
    warnings = [l for l in log.splitlines() if "warning:" in l or "error:" in l]
    if not quiet:
        for w in warnings:
            print("   lilypond:", w)
    return {
        "dump": dump,
        "midi": sorted(list(out_dir.glob("*.mid")) + list(out_dir.glob("*.midi")), key=_midi_order(stem)),
        "pdf": sorted(out_dir.glob("*.pdf")),
        "warnings": warnings,
    }


# ----------------------------------------------------------------------------
# Dump model
# ----------------------------------------------------------------------------

def fr(x) -> F | None:
    if x is None:
        return None
    return F(str(x))


@dataclass
class Ev:
    """A note head or a rest as engraved by LilyPond."""

    id: int
    kind: str  # "note" | "rest"
    voice: int
    staff: int | None
    m: F
    g: F
    log: int
    dots: int
    scale: F
    step: int | None = None
    alt: F | None = None
    oct: int | None = None
    fingers: list = field(default_factory=list)
    acc: list | None = None
    beam: int | None = None
    beaming: list | None = None
    stemdir: int | None = None
    slash: bool = False
    hidden: bool = False
    restpitch: list | None = None
    measure_rest: bool = False
    # filled in by the converter
    xvoice: int = 0
    xstaff: int = 0
    tie_start: bool = False
    tie_stop: bool = False
    tie_to: int | None = None
    tie_from: int | None = None

    @property
    def grace(self) -> bool:
        return self.g != 0

    @property
    def notated(self) -> F:
        base = F(1, 2 ** self.log) if self.log >= 0 else F(2 ** (-self.log))
        return base * (2 - F(1, 2 ** self.dots)) * self.scale

    @property
    def dur(self) -> F:
        return F(0) if self.grace else self.notated

    @property
    def midi(self) -> int:
        return 12 * (self.oct + 5) + STEP_SEMIS[self.step] + int(round(self.alt * 2))


@dataclass
class Chord:
    evs: list  # Ev, sorted low -> high
    voice: int
    staff: int
    m: F
    g: F
    dur: F
    arts: list = field(default_factory=list)  # (container, element, attrs)
    extra_fingers: list = field(default_factory=list)  # fingerings from separate fingering events
    arpeggiate: bool = False
    beams: list = field(default_factory=list)  # (number, value)
    slur_marks: list = field(default_factory=list)  # (type, number, placement, note_index)
    tuplet_marks: list = field(default_factory=list)  # dicts
    xvoice: int = 0
    measure: int = 0

    @property
    def is_rest(self) -> bool:
        return self.evs[0].kind == "rest"

    @property
    def grace(self) -> bool:
        return self.g != 0

    @property
    def end(self) -> F:
        return self.m + self.dur


class Dump:
    def __init__(self, path: Path, score: int = 1):
        self.records = []
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    self.records.append(json.loads(line))
        scores = sorted({r.get("score") for r in self.records if r.get("t") == "score"})
        if score not in scores:
            raise ConversionError(f"score {score} not in dump (have {scores})")
        self.recs = [r for r in self.records if r.get("score") == score]
        self.by_type: dict[str, list] = {}
        for r in self.recs:
            self.by_type.setdefault(r["t"], []).append(r)

    def get(self, t: str) -> list:
        return self.by_type.get(t, [])


# ----------------------------------------------------------------------------
# Conversion
# ----------------------------------------------------------------------------

@dataclass
class Options:
    title: str = ""
    composer: str = ""
    arranger: str | None = None
    rights: str = ""
    source_url: str = ""
    encoding_date: str | None = None
    include_fingering: bool = False
    bar_from: int | None = None
    bar_to: int | None = None
    staff_order: list | None = None  # Staff context ids, top to bottom
    midi_tempo: float | None = None  # quarter notes per minute, from the source's \midi block
    drop_text: list = field(default_factory=list)  # regexes of text scripts to drop
    text_replace: dict = field(default_factory=dict)  # exact text -> replacement (typo fixes)
    first_key_mode: str | None = None  # override the mode of the opening key signature
    final_barline: bool = True


def _lcm(a: int, b: int) -> int:
    return a * b // math.gcd(a, b)


class Converter:
    def __init__(self, dump: Dump, opts: Options):
        self.d = dump
        self.o = opts
        self.warnings: list[str] = []

    def warn(self, msg: str) -> None:
        if msg not in self.warnings:
            self.warnings.append(msg)

    # -- loading -------------------------------------------------------------
    def load(self) -> None:
        d = self.d
        self.ctx = {r["serial"]: r for r in d.get("ctx")}
        evs: list[Ev] = []
        for r in d.get("note"):
            evs.append(Ev(id=r["id"], kind="note", voice=r["voice"], staff=r["staff"], m=fr(r["m"]),
                          g=fr(r["g"]), log=r["log"], dots=r["dots"], scale=fr(r["scale"]), step=r["step"],
                          alt=fr(r["alt"]), oct=r["oct"],
                          fingers=(r.get("fingers") or [])
                          + [finger_text(t) for t in (r.get("texts") or []) if FINGER_TEXT.match(t)],
                          acc=r.get("acc"),
                          beam=r.get("beam"), beaming=r.get("beaming"), stemdir=r.get("stemdir"),
                          slash=bool(r.get("slash")), hidden=bool(r.get("hidden"))))
        for r in d.get("rest"):
            evs.append(Ev(id=r["id"], kind="rest", voice=r["voice"], staff=r["staff"], m=fr(r["m"]),
                          g=fr(r["g"]), log=r["log"], dots=r["dots"], scale=fr(r["scale"]),
                          restpitch=r.get("pitch"), hidden=bool(r.get("hidden"))))
        self.evs = evs
        self.by_id = {e.id: e for e in evs}
        if not evs:
            raise ConversionError("no notes in dump")
        # staves
        staff_serials = []
        for r in d.get("clef"):
            if r["staff"] not in staff_serials:
                staff_serials.append(r["staff"])
        used = {e.staff for e in evs}
        staff_serials = [s for s in staff_serials if s in used]
        for s in sorted(used):
            if s is not None and s not in staff_serials:
                staff_serials.append(s)
        if self.o.staff_order:
            ids = {s: self.ctx[s]["id"] for s in staff_serials}
            staff_serials = sorted(staff_serials, key=lambda s: self.o.staff_order.index(ids[s]))
        if len(staff_serials) != 2:
            raise ConversionError(f"expected 2 staves with music, found {len(staff_serials)}: "
                                  f"{[self.ctx[s]['id'] for s in staff_serials]}")
        self.staff_no = {s: i + 1 for i, s in enumerate(staff_serials)}
        for e in evs:
            e.xstaff = self.staff_no[e.staff]
        # sanity: upper staff should be higher on average
        avg = {}
        for n in (1, 2):
            ps = [e.midi for e in evs if e.kind == "note" and e.xstaff == n]
            avg[n] = sum(ps) / len(ps) if ps else 0
        if avg[1] < avg[2]:
            self.warn(f"staff 1 is lower than staff 2 on average ({avg[1]:.1f} < {avg[2]:.1f})")

    # -- measures --------------------------------------------------------------
    def build_measures(self) -> None:
        recs = sorted(self.d.get("measure"), key=lambda r: (fr(r["m"]), fr(r["g"])))
        end = max(e.m + e.dur for e in self.evs)
        for r in self.d.get("mmrest"):
            end = max(end, fr(r["m"]) + fr(r["len"]))
        self.piece_end = end
        rec_by_m: dict[F, dict] = {}
        for r in recs:
            m = fr(r["m"])
            if m < end and m not in rec_by_m:
                rec_by_m[m] = r
        if F(0) not in rec_by_m:
            raise ConversionError("first measure record missing")
        # A repeat sign or double bar in the middle of a LilyPond measure (pickup-style
        # repeats) splits the measure in two, as notation programs do in MusicXML.
        splits = {fr(r["m"]) for r in self.d.get("barline") if r["glyph"] not in ("", "|")}
        splits = {x for x in splits if 0 < x < end and x not in rec_by_m}
        all_starts = sorted(set(rec_by_m) | splits)
        measures = []
        for i, m in enumerate(all_starts):
            nxt = all_starts[i + 1] if i + 1 < len(all_starts) else end
            r = rec_by_m.get(m)
            if r is None:
                base = measures[-1]
                ts, nominal, mpos, split = base["ts"], base["nominal"], None, True
            else:
                ts = tuple(r["ts"]) if r.get("ts") else None
                nominal = fr(r["len"])
                mpos = fr(r["mpos"]) if r.get("mpos") is not None else F(0)
                split = False
            measures.append({"index": i, "start": m, "end": nxt, "len": nxt - m, "nominal": nominal,
                             "ts": ts, "mpos": mpos, "split": split, "bar": r["bar"] if r else None})
        # Numbering (MusicXML convention): a leading partial measure is "0" (implicit);
        # the second part of a split bar is "<n>a" (implicit); everything else is numbered
        # consecutively (LilyPond 2.24 restarts bar numbers in alternatives, MusicXML does not).
        first = measures[0]
        pickup = (first["mpos"] or 0) != 0 or (first["len"] < first["nominal"] and len(measures) > 1)
        n = 0
        for i, ms in enumerate(measures):
            if i == 0 and pickup:
                ms["number"], ms["num"], ms["implicit"] = "0", 0, True
            elif ms["split"]:
                prev = measures[i - 1]
                ms["number"], ms["num"], ms["implicit"] = prev["number"] + "a", prev["num"], True
            else:
                n += 1
                ms["number"], ms["num"], ms["implicit"] = str(n), n, False
        lily = [ms["bar"] for ms in measures if not ms["split"] and not (ms is first and pickup)]
        if lily and lily != list(range(lily[0], lily[0] + len(lily))):
            self.warn("LilyPond bar numbers are not consecutive (alternatives/partial bars); "
                      "MusicXML measures are numbered consecutively")
        self.measures = measures
        self.measure_starts = [ms["start"] for ms in measures]

    def measure_of(self, m: F, g: F = F(0)) -> int:
        # grace notes at a measure start belong to that measure
        lo, hi = 0, len(self.measure_starts) - 1
        idx = 0
        while lo <= hi:
            mid = (lo + hi) // 2
            if self.measure_starts[mid] <= m:
                idx = mid
                lo = mid + 1
            else:
                hi = mid - 1
        return idx

    # -- chords & voices -------------------------------------------------------
    def build_chords(self) -> None:
        groups: dict[tuple, list[Ev]] = {}
        for e in self.evs:
            key = (e.voice, e.m, e.g, e.kind, e.notated, e.xstaff)
            groups.setdefault(key, []).append(e)
        chords = []
        for (voice, m, g, kind, notated, xstaff), evs in groups.items():
            if kind == "rest" and len(evs) > 1:
                for e in evs:
                    chords.append(Chord(evs=[e], voice=voice, staff=xstaff, m=m, g=g, dur=e.dur))
                continue
            evs.sort(key=lambda e: (e.midi if e.kind == "note" else 0))
            chords.append(Chord(evs=evs, voice=voice, staff=xstaff, m=m, g=g, dur=evs[0].dur))
        # multi-measure rests -> one whole-measure rest per measure
        for r in self.d.get("mmrest"):
            m0 = fr(r["m"])
            m1 = m0 + fr(r["len"])
            staff = self.staff_no.get(r["staff"], 1)
            for ms in self.measures:
                if ms["start"] >= m0 and ms["start"] < m1:
                    e = Ev(id=-len(chords) - 1, kind="rest", voice=r["voice"], staff=r["staff"], m=ms["start"],
                           g=F(0), log=0, dots=0, scale=ms["len"], measure_rest=True)
                    e.xstaff = staff
                    chords.append(Chord(evs=[e], voice=r["voice"], staff=staff, m=ms["start"], g=F(0), dur=ms["len"]))
        chords.sort(key=lambda c: (c.m, c.g, c.staff, c.voice))
        self.chords = chords
        self.chord_of_ev = {}
        for c in chords:
            c.measure = self.measure_of(c.m, c.g)
            for e in c.evs:
                self.chord_of_ev[e.id] = c
            ms = self.measures[c.measure]
            if not c.grace and c.end > ms["end"]:
                raise ConversionError(f"{'rest' if c.is_rest else 'note'} at {c.m} crosses the bar line at {ms['end']}")

    def assign_voices(self) -> None:
        """Pack LilyPond voices into MusicXML voices (1-4 staff 1, 5-8 staff 2)."""
        by_voice: dict[int, list[Chord]] = {}
        for c in self.chords:
            by_voice.setdefault(c.voice, []).append(c)
        # home staff of each LilyPond voice
        home = {}
        for v, cs in by_voice.items():
            cnt = {}
            for c in cs:
                cnt[c.staff] = cnt.get(c.staff, 0) + len(c.evs)
            home[v] = max(sorted(cnt), key=lambda s: cnt[s])
        # split each voice into non-overlapping lanes
        lanes = []  # (home staff, first moment, voice serial, [chords])
        for v, cs in by_voice.items():
            cs.sort(key=lambda c: (c.m, c.g))
            vlanes: list[list[Chord]] = []
            for c in cs:
                placed = False
                for lane in vlanes:
                    last = lane[-1]
                    if c.grace:
                        ok = (c.m, c.g) > (last.m, last.g) and (last.grace or c.m >= last.end)
                    else:
                        ok = c.m >= (last.end if not last.grace else last.m)
                    if ok:
                        lane.append(c)
                        placed = True
                        break
                if not placed:
                    vlanes.append([c])
            if len(vlanes) > 1:
                self.warn(f"LilyPond voice {v} has overlapping notes; split into {len(vlanes)} MusicXML voices")
            for lane in vlanes:
                lanes.append((home[v], lane[0].m, v, lane))

        def stem_rank(lane):
            # \voiceOne / \stemUp voices first, neutral next, \voiceTwo / \stemDown last
            dirs = [c.evs[0].stemdir for c in lane if not c.is_rest and c.evs[0].stemdir in (1, -1)]
            if not dirs:
                return 1
            s = sum(dirs) / len(dirs)
            return 0 if s > 0.5 else (2 if s < -0.5 else 1)

        lanes.sort(key=lambda t: (t[0], stem_rank(t[3]), t[1], t[2]))
        slots: dict[int, list[list[tuple]]] = {1: [], 2: []}  # staff -> list of interval lists

        def overlaps(intervals, lane):
            for c in lane:
                a, b = (c.m, c.end) if not c.grace else (c.m, c.m)
                for (x, y, gx) in intervals:
                    if c.grace or gx:
                        if a == x and (c.grace and gx):
                            return True
                        continue
                    if a < y and x < b:
                        return True
            return False

        for staff, _, v, lane in lanes:
            sl = slots[staff]
            for i, intervals in enumerate(sl):
                if not overlaps(intervals, lane):
                    break
            else:
                sl.append([])
                i = len(sl) - 1
            sl[i].extend((c.m, c.end, c.grace) for c in lane)
            xv = (0 if staff == 1 else 4) + i + 1
            if i >= 4:
                raise ConversionError(f"more than 4 voices needed on staff {staff}")
            for c in lane:
                c.xvoice = xv
                for e in c.evs:
                    e.xvoice = xv

    # -- spanners and marks ----------------------------------------------------
    def apply_ties(self) -> None:
        for r in self.d.get("repeattie"):  # \repeatTie: tie into a 2nd ending
            e = self.by_id.get(r.get("head"))
            if e is not None and e.kind == "note":
                e.tie_stop = True
        for r in self.d.get("tie"):
            if not r["from"] and not r["to"] and not r.get("lname") and not r.get("rname"):
                continue  # a Tie grob LilyPond never attached to notes (unterminated tie)
            a = [i for i in r["from"] if i in self.by_id]
            b = [i for i in r["to"] if i in self.by_id]
            if not a or not b:
                self.warn(f"tie with unknown bound skipped ({r.get('lname')} -> {r.get('rname')} at {r.get('m1')})")
                continue
            ea, eb = self.by_id[a[0]], self.by_id[b[0]]
            if ea.kind != "note" or eb.kind != "note":
                continue
            if ea.midi != eb.midi:
                self.warn(f"tie between different pitches at {ea.m} skipped")
                continue
            ea.tie_start = True
            eb.tie_stop = True
            ea.tie_to = eb.id
            eb.tie_from = ea.id

    def merge_hidden_duplicates(self) -> None:
        """A hidden note that doubles a visible note (same pitch and moment) is a LilyPond
        kludge for a cross-voice tie: drop it and move its tie to the visible note."""
        for e in list(self.evs):
            if not (e.hidden and e.kind == "note"):
                continue
            twins = [v for v in self.evs if v is not e and not v.hidden and v.kind == "note"
                     and v.midi == e.midi and v.m == e.m and v.g == e.g]
            if not twins:
                continue
            v = twins[0]
            if e.tie_start and e.tie_to is not None:
                v.tie_start, v.tie_to = True, e.tie_to
                self.by_id[e.tie_to].tie_from = v.id
            if e.tie_stop and e.tie_from is not None and not v.tie_stop:
                v.tie_stop, v.tie_from = True, e.tie_from
                self.by_id[e.tie_from].tie_to = v.id
            c = self.chord_of_ev.pop(e.id)
            c.evs.remove(e)
            if not c.evs:
                self.chords.remove(c)
            self.evs.remove(e)
            del self.by_id[e.id]
            self.warn(f"hidden note at {e.m} merged into the visible note of the same pitch (cross-voice tie)")
        for e in self.evs:
            if e.hidden:
                self.warn(f"hidden {e.kind} at {e.m} kept as print-object=no")

    def propagate_volta_ties(self) -> None:
        """A tie into the 1st ending also applies to the same note at the start of later
        endings (LilyPond's \\unfoldRepeats MIDI plays it tied); mark those notes tie-stop."""
        def nums(s):
            return {int(x) for x in re.findall(r"\d+", s)}

        firsts = sorted(i for i, e in self.endings_start.items() if 1 in nums(e["number"]))
        for i, e in sorted(self.endings_start.items()):
            if 1 in nums(e["number"]):
                continue
            prev = [f for f in firsts if f < i]
            if not prev:
                continue
            i1 = prev[-1]
            s1, sk = self.measures[i1]["start"], self.measures[i]["start"]
            tied_in = [n for c in self.chords if c.measure == i1 and c.m == s1 and not c.grace
                       for n in c.evs if n.kind == "note" and n.tie_stop and n.tie_from is not None
                       and self.chord_of_ev[n.tie_from].measure < i1]
            for n1 in tied_in:
                for c in self.chords:
                    if c.measure == i and c.m == sk and not c.grace:
                        for nk in c.evs:
                            if nk.kind == "note" and nk.midi == n1.midi and not nk.tie_stop and nk.voice == n1.voice:
                                nk.tie_stop = True
                                self.warn(f"tie into ending at measure {self.measures[i]['number']} added "
                                          f"(as in the 1st ending)")

    def _chord_at(self, voice: int, m: F, g: F) -> Chord | None:
        for c in self.chords:
            if c.voice == voice and c.m == m and c.g == g:
                return c
        return None

    def _chord_for_ids(self, ids: list, voice: int | None, m, g) -> Chord | None:
        for i in ids or []:
            if i in self.chord_of_ev:
                return self.chord_of_ev[i]
        if m is not None and voice is not None:
            return self._chord_at(voice, fr(m), fr(g))
        return None

    def apply_slurs(self) -> None:
        self.slurs = []
        for r in self.d.get("slur"):
            a = self._chord_for_ids(r.get("from"), r.get("voice"), r.get("m1"), r.get("g1"))
            b = self._chord_for_ids(r.get("to"), r.get("voice"), r.get("m2"), r.get("g2"))
            if a is None or b is None or a is b:
                self.warn(f"slur at {r.get('m1')} could not be attached")
                continue
            # MusicXML readers cannot hang a slur on a rest: move it to the nearest note
            if a.is_rest:
                a = self._neighbour_note(a, +1)
                self.warn(f"slur starting on a rest at {r.get('m1')} moved to the next note")
            if b is not None and b.is_rest:
                b = self._neighbour_note(b, -1)
                self.warn(f"slur ending on a rest at {r.get('m2')} moved to the previous note")
            if a is None or b is None or (b.m, b.g) <= (a.m, a.g):
                continue
            placement = {1: "above", -1: "below"}.get(r.get("dir") or 0)
            self.slurs.append((a, b, placement, r["kind"]))

    def _neighbour_note(self, c: Chord, step: int) -> Chord | None:
        same = sorted((x for x in self.chords if x.voice == c.voice and not x.is_rest), key=lambda x: (x.m, x.g))
        if step > 0:
            nxt = [x for x in same if (x.m, x.g) > (c.m, c.g)]
            return nxt[0] if nxt else None
        prv = [x for x in same if (x.m, x.g) < (c.m, c.g)]
        return prv[-1] if prv else None

    def apply_tuplets(self) -> None:
        self.tuplets = []
        for r in self.d.get("tuplet"):
            a = self._chord_for_ids(r.get("first"), None, None, None)
            b = self._chord_for_ids(r.get("last"), None, None, None)
            if a is None or b is None:
                self.warn("tuplet bracket without notes skipped")
                continue
            vis = r.get("bracketvis")
            if not r.get("bracketstencil", True):
                bracket = "no"
            elif vis in ("#t", "True", "true"):
                bracket = "yes"
            elif vis in ("#f", "False", "false"):
                bracket = "no"
            else:  # if-no-beam
                bracket = "no" if (a.evs[0].beam is not None and a.evs[0].beam == b.evs[0].beam) else "yes"
            show = "actual" if r.get("numbervisible") else "none"
            self.tuplets.append((a, b, bracket, show))

    def apply_marks(self) -> None:
        for r in self.d.get("art"):
            c = self._chord_at(r["voice"], fr(r["m"]), fr(r["g"]))
            if c is None:
                self.warn(f"articulation {r['type']} at {r['m']} has no note")
                continue
            spec = ARTICULATIONS.get(r["type"])
            if spec is None:
                self.warn(f"articulation {r['type']!r} not exported")
                continue
            container, elem, attrs = spec
            attrs = dict(attrs)
            if container == "articulations" and r.get("dir") in (1, -1):
                attrs["placement"] = "above" if r["dir"] == 1 else "below"
            if elem == "fermata" and r.get("dir") == -1:
                attrs["type"] = "inverted"
            if (container, elem, attrs) not in c.arts:
                c.arts.append((container, elem, attrs))
        # finger substitutions written as text scripts ("5 - 4") are fingerings, not words
        for r in self.d.get("text"):
            t = (r.get("text") or "").strip()
            if t and FINGER_TEXT.match(t):
                c = self._chord_at(r["voice"], fr(r["m"]), fr(r["g"]))
                if c is not None and not c.is_rest:
                    c.extra_fingers.append((finger_text(t), r.get("dir") or 0))
        # LilyPond's resolved placement (above/below) of every Fingering grob
        placed: dict[tuple, list[int]] = {}
        for r in self.d.get("fingdir"):
            key = (r["voice"], fr(r["m"]), fr(r["g"]), r.get("digit") if r.get("digit") is not None else r.get("text"))
            placed.setdefault(key, []).append(r.get("dir") or 0)
        for r in self.d.get("fing"):
            c = self._chord_at(r["voice"], fr(r["m"]), fr(r["g"]))
            if c is None or c.is_rest:
                self.warn(f"fingering at {r['m']} has no note")
                continue
            val = r.get("digit") if r.get("digit") is not None else r.get("text")
            d = r.get("dir") or 0
            if not d:
                lst = placed.get((r["voice"], fr(r["m"]), fr(r["g"]), val))
                d = lst.pop(0) if lst else 0
            c.extra_fingers.append((val, d))
        for r in self.d.get("arpeggio"):
            c = self._chord_at(r["voice"], fr(r["m"]), fr(r["g"]))
            if c is not None:
                c.arpeggiate = True
        for r in self.d.get("trillspan"):
            if r.get("spandir") == -1:
                c = self._chord_at(r["voice"], fr(r["m"]), fr(r["g"]))
                if c is not None:
                    c.arts.append(("ornaments", "trill-mark", {}))

    def apply_beams(self) -> None:
        groups: dict[int, list[Chord]] = {}
        for c in self.chords:
            if c.is_rest:
                continue
            b = c.evs[0].beam
            if b is not None:
                if c not in groups.setdefault(b, []):
                    groups[b].append(c)
        for b, cs in groups.items():
            cs.sort(key=lambda c: (c.m, c.g))
            if len(cs) < 2:
                continue

            def sides(c):
                bm = c.evs[0].beaming
                if not bm:
                    return set(), set()
                left = {abs(x) + 1 for x in (bm[0] or []) if isinstance(x, int)}
                right = {abs(x) + 1 for x in (bm[1] or []) if isinstance(x, int)}
                return left, right

            sd = [sides(c) for c in cs]
            if not any(l or r for l, r in sd):  # no beaming info: derive from durations
                counts = [max(0, c.evs[0].log - 2) for c in cs]
                sd = []
                for i, n in enumerate(counts):
                    left = set(range(1, min(n, counts[i - 1]) + 1)) if i > 0 else set()
                    right = set(range(1, min(n, counts[i + 1]) + 1)) if i + 1 < len(cs) else set()
                    if n > len(left | right):
                        extra = set(range(len(left | right) + 1, n + 1))
                        (right if i == 0 or (i + 1 < len(cs) and i > 0 and counts[i + 1] >= counts[i - 1]) else left).update(extra)
                    sd.append((left, right))
            for i, c in enumerate(cs):
                left, right = sd[i]
                levels = sorted(left | right)
                if not levels:
                    levels = [1]
                vals = []
                for lv in levels:
                    conn_l = i > 0 and lv in left and lv in sd[i - 1][1]
                    conn_r = i + 1 < len(cs) and lv in right and lv in sd[i + 1][0]
                    if conn_l and conn_r:
                        v = "continue"
                    elif conn_r:
                        v = "begin"
                    elif conn_l:
                        v = "end"
                    elif lv in right:
                        v = "forward hook"
                    else:
                        v = "backward hook"
                    vals.append((lv, v))
                # level 1 must be continuous inside a beam group
                if i == 0:
                    vals = [(1, "begin")] + [x for x in vals if x[0] != 1]
                elif i == len(cs) - 1:
                    vals = [(1, "end")] + [x for x in vals if x[0] != 1]
                else:
                    vals = [(1, "continue")] + [x for x in vals if x[0] != 1]
                c.beams = sorted(vals)

    # -- directions --------------------------------------------------------------
    def collect_directions(self) -> None:
        """Directions are (m, g, staff, voice, element-builder, sort-key)."""
        dirs = []

        def staff_of(r):
            s = r.get("staff")
            return self.staff_no.get(s, 1) if s is not None else 1

        for r in self.d.get("dyn"):
            text = (r.get("text") or "").strip()
            if not text:
                continue
            placement = "above" if r.get("dir") == 1 else "below"
            dirs.append(dict(m=fr(r["m"]), g=fr(r["g"]), staff=staff_of(r), voice=r["voice"],
                             kind="dyn", text=text, placement=placement))
        # hairpins: pair START/STOP per LilyPond context, stop at next dynamic
        hp_events = []
        for r in self.d.get("hairpin"):
            hp_events.append((fr(r["m"]), fr(r["g"]), 1, r))
        for r in self.d.get("dyn"):
            hp_events.append((fr(r["m"]), fr(r["g"]), 0, r))
        hp_events.sort(key=lambda t: (t[0], t[1], t[2]))
        open_hp: dict[int, dict] = {}
        for m, g, isspan, r in hp_events:
            v = r["voice"]
            if not isspan:  # absolute dynamic closes an open hairpin
                if v in open_hp:
                    dirs.append(dict(m=m, g=g, staff=open_hp[v]["staff"], voice=v, kind="wedge-stop",
                                     ref=open_hp.pop(v)))
                continue
            sd = r.get("spandir")
            if sd == 1:  # STOP
                if v in open_hp:
                    dirs.append(dict(m=m, g=g, staff=open_hp[v]["staff"], voice=v, kind="wedge-stop",
                                     ref=open_hp.pop(v)))
                continue
            if sd == -1:
                if v in open_hp:
                    dirs.append(dict(m=m, g=g, staff=open_hp[v]["staff"], voice=v, kind="wedge-stop",
                                     ref=open_hp.pop(v)))
                kind = r.get("kind")
                if r.get("spantype") == "text":
                    text = r.get("spantext") or ("cresc." if kind == "cresc" else "dim.")
                    dirs.append(dict(m=m, g=g, staff=staff_of(r), voice=v, kind="words", text=text,
                                     placement="below", italic=True))
                    continue
                hp = dict(m=m, g=g, staff=staff_of(r), voice=v, kind="wedge-start",
                          wtype="crescendo" if kind == "cresc" else "diminuendo")
                dirs.append(hp)
                open_hp[v] = hp
        for v, hp in open_hp.items():
            last = max((c.end for c in self.chords if c.voice == v), default=self.piece_end)
            dirs.append(dict(m=last, g=F(0), staff=hp["staff"], voice=v, kind="wedge-stop", ref=hp))
            self.warn(f"hairpin starting at {hp['m']} never closed; closed at {last}")
        for r in self.d.get("text"):
            text = (r.get("text") or "").strip()
            text = self.o.text_replace.get(text, text)
            if not text or FINGER_TEXT.match(text) or any(re.search(p, text) for p in self.o.drop_text):
                continue
            placement = "below" if r.get("dir") == -1 else "above"
            base = dict(m=fr(r["m"]), g=fr(r["g"]), staff=staff_of(r), voice=r["voice"])
            if text in DYNAMICS:  # a dynamic typeset as plain text
                dirs.append(dict(base, kind="dyn", text=text, placement=placement))
                continue
            md = DYN_WORDS.match(text)
            if md:  # e.g. "p leggieremente": dynamic + expression text
                dirs.append(dict(base, kind="dyn", text=md.group(1), placement=placement))
                text = md.group(2)
            # short capitalised words are tempo indications (bold); expression text is italic
            tempo_like = text[:1].isupper() and len(text.split()) <= 3
            dirs.append(dict(base, kind="words", text=text, placement=placement,
                             italic=not tempo_like, bold=tempo_like))
        pedal_seen = set()
        for r in self.d.get("pedal"):
            key = (r["m"], r["g"], r.get("spandir"))
            if key in pedal_seen:
                continue
            pedal_seen.add(key)
            dirs.append(dict(m=fr(r["m"]), g=fr(r["g"]), staff=staff_of(r), voice=r["voice"], kind="pedal",
                             ptype="start" if r.get("spandir") == -1 else "stop"))
        seen_tempo = set()
        marks = {(fr(r["m"]), fr(r["g"])): r for r in self.d.get("tempomark")}
        for r in self.d.get("tempo"):
            key = (r["m"], r["g"])
            if key in seen_tempo:
                continue
            seen_tempo.add(key)
            mk = marks.get((fr(r["m"]), fr(r["g"])), {})
            dirs.append(dict(m=fr(r["m"]), g=fr(r["g"]), staff=1, voice=None, kind="tempo", text=r.get("text"),
                             unit=r.get("unit"), count=r.get("count"),
                             hidden=bool(mk.get("transparent") or mk.get("nostencil")),
                             hidenote=bool(mk.get("hidenote"))))
        for r in self.d.get("ottava"):
            octs = r.get("octaves") or 0
            if not octs or r.get("m1") is None:
                continue
            staff = self.staff_no.get(r["staff"], 1)
            size = 8 if abs(octs) == 1 else 15
            m1, g1 = fr(r["m1"]), fr(r["g1"])
            dirs.append(dict(m=m1, g=g1, staff=staff, voice=None, kind="octave-shift",
                             otype="down" if octs > 0 else "up", size=size))
            m2 = fr(r["m2"]) if r.get("m2") is not None else self.piece_end
            ends = [c.end for c in self.chords if c.staff == staff and c.m == m2 and not c.grace]
            stop_at = max(ends) if ends else m2
            dirs.append(dict(m=stop_at, g=F(0), staff=staff, voice=None, kind="octave-shift", otype="stop",
                             size=size, late=True))
        self.directions = dirs

    def collect_attributes(self) -> None:
        # clefs per staff
        self.clefs = []
        last = {}
        for r in sorted(self.d.get("clef"), key=lambda r: (fr(r["m"]), fr(r["g"]))):
            s = self.staff_no.get(r["staff"])
            if s is None:
                continue
            val = (r["glyph"], r["pos"], r["transp"])
            if last.get(s) == val:
                continue
            last[s] = val
            self.clefs.append(dict(m=fr(r["m"]), g=fr(r["g"]), staff=s, glyph=r["glyph"], pos=r["pos"],
                                   transp=r["transp"]))
        # keys
        self.keys = []
        seen = {}
        for r in sorted(self.d.get("key"), key=lambda r: (fr(r["m"]), fr(r["g"]))):
            s = self.staff_no.get(r["staff"])
            if s is None:
                continue
            alist = [(a[0], fr(a[1])) for a in r.get("alist") or []]
            fifths = sum(1 for _, a in alist if a == F(1, 2)) - sum(1 for _, a in alist if a == F(-1, 2))
            mode = None
            if r.get("tonic"):
                tstep, talt = r["tonic"][0], fr(r["tonic"][1])
                third = (tstep + 2) % 7
                talt3 = dict(alist).get(third, F(0))
                semis = (STEP_SEMIS[third] + int(talt3 * 2) - STEP_SEMIS[tstep] - int(talt * 2)) % 12
                mode = {4: "major", 3: "minor"}.get(semis)
            key = (fr(r["m"]), s)
            val = (fifths, mode)
            if seen.get(key) == val:
                continue
            seen[key] = val
            self.keys.append(dict(m=fr(r["m"]), g=fr(r["g"]), staff=s, fifths=fifths, mode=mode))
        if not self.keys:
            self.keys = [dict(m=F(0), g=F(0), staff=s, fifths=0, mode="major") for s in (1, 2)]
        # time signature style per moment
        self.ts_style = {}
        for r in self.d.get("timesig"):
            self.ts_style[fr(r["m"])] = r.get("style")

    def collect_barlines(self) -> None:
        self.left_bar: dict[int, dict] = {}
        self.right_bar: dict[int, dict] = {}
        glyphs = {}
        for r in self.d.get("barline"):
            m = fr(r["m"])
            glyphs.setdefault(m, r["glyph"])
        idx_by_start = {ms["start"]: i for i, ms in enumerate(self.measures)}
        idx_by_end = {ms["end"]: i for i, ms in enumerate(self.measures)}
        for m, gl in sorted(glyphs.items()):
            gl = gl.split("-")[0] if "-" in gl and not gl.startswith("-") else gl
            end_rep = gl.startswith(":")
            start_rep = gl.endswith(":")
            left_i = idx_by_start.get(m)
            right_i = idx_by_end.get(m)
            if end_rep and right_i is not None:
                self.right_bar[right_i] = {"style": "light-heavy", "repeat": "backward"}
            if start_rep and left_i is not None:
                self.left_bar[left_i] = {"style": "heavy-light", "repeat": "forward"}
            if not end_rep and not start_rep and right_i is not None:
                style = {"|.": "light-heavy", "||": "light-light", ".": "heavy", ".|": "heavy-light",
                         "|.|": "light-heavy", "..": "heavy-heavy", "!": "dashed", ";": "dotted",
                         "'": "tick", "": None}.get(gl, None)
                if style is None and gl not in ("",):
                    self.warn(f"bar line glyph {gl!r} at {m} exported as regular")
                if style:
                    self.right_bar[right_i] = {"style": style}
        # volta brackets
        self.endings_start: dict[int, dict] = {}
        self.endings_stop: dict[int, dict] = {}
        for r in sorted(self.d.get("volta"), key=lambda r: fr(r["m1"]) if r.get("m1") is not None else F(0)):
            if r.get("m1") is None or r.get("m2") is None:
                continue
            m1, m2 = fr(r["m1"]), fr(r["m2"])
            i1 = self.measure_of(m1)
            i2 = idx_by_end.get(m2)
            if i2 is None:
                i2 = self.measure_of(m2 - F(1, 1024))
            text = (r.get("text") or "").strip()
            nums = re.findall(r"\d+", text)
            number = ", ".join(nums) if nums else "1"
            closed = i2 in self.right_bar and self.right_bar[i2].get("repeat") == "backward"
            self.endings_start[i1] = {"number": number, "text": text}
            self.endings_stop[i2] = {"number": number, "type": "stop" if closed else "discontinue"}

    # -- excerpt -----------------------------------------------------------------
    def select_measures(self) -> list[int]:
        idxs = list(range(len(self.measures)))
        if self.o.bar_from is not None or self.o.bar_to is not None:
            lo = self.o.bar_from if self.o.bar_from is not None else -10**9
            hi = self.o.bar_to if self.o.bar_to is not None else 10**9
            idxs = [i for i in idxs if lo <= self.measures[i]["num"] <= hi]
            if not idxs:
                raise ConversionError("excerpt selects no measures")
        return idxs

    # -- XML writing ---------------------------------------------------------------
    def compute_divisions(self, sel: set) -> int:
        div = 1
        vals = []
        for c in self.chords:
            if c.measure in sel:
                vals.append(c.m - self.measures[c.measure]["start"])
                if not c.grace:
                    vals.append(c.dur)
        for i in sel:
            vals.append(self.measures[i]["len"])
        for d in self.directions:
            mi = self.measure_of(d["m"], d["g"])
            if mi in sel:
                vals.append(d["m"] - self.measures[mi]["start"])
        for v in vals:
            q = F(v) * 4
            div = _lcm(div, q.denominator)
        return div

    def dur_div(self, x: F) -> int:
        q = x * 4 * self.div
        if q.denominator != 1:
            raise ConversionError(f"duration {x} not representable with divisions {self.div}")
        return int(q)

    def build(self) -> ET.Element:
        self.load()
        self.build_measures()
        self.build_chords()
        self.assign_voices()
        self.apply_ties()
        self.merge_hidden_duplicates()
        self.apply_slurs()
        self.apply_tuplets()
        self.apply_marks()
        self.apply_beams()
        self.collect_directions()
        self.collect_attributes()
        self.collect_barlines()
        self.propagate_volta_ties()
        sel_list = self.select_measures()
        sel = set(sel_list)
        self.div = self.compute_divisions(sel)
        self._prepare_spanner_marks(sel)
        root = ET.Element("score-partwise", version="4.0")
        work = ET.SubElement(root, "work")
        ET.SubElement(work, "work-title").text = self.o.title
        ident = ET.SubElement(root, "identification")
        if self.o.composer:
            ET.SubElement(ident, "creator", type="composer").text = self.o.composer
        if self.o.arranger:
            ET.SubElement(ident, "creator", type="arranger").text = self.o.arranger
        if self.o.rights:
            ET.SubElement(ident, "rights").text = self.o.rights
        enc = ET.SubElement(ident, "encoding")
        ET.SubElement(enc, "software").text = "digitus2 ly2musicxml (LilyPond 2.24 + xmldump.ily)"
        if self.o.encoding_date:
            ET.SubElement(enc, "encoding-date").text = self.o.encoding_date
        for el, val in (("accidental", "yes"), ("beam", "yes"), ("stem", "yes")):
            ET.SubElement(enc, "supports", element=el, type=val)
        if self.o.source_url:
            ET.SubElement(ident, "source").text = self.o.source_url
        pl = ET.SubElement(root, "part-list")
        sp = ET.SubElement(pl, "score-part", id="P1")
        ET.SubElement(sp, "part-name").text = "Piano"
        ET.SubElement(sp, "part-abbreviation").text = "Pno."
        si = ET.SubElement(sp, "score-instrument", id="P1-I1")
        ET.SubElement(si, "instrument-name").text = "Piano"
        mi = ET.SubElement(sp, "midi-instrument", id="P1-I1")
        ET.SubElement(mi, "midi-channel").text = "1"
        ET.SubElement(mi, "midi-program").text = "1"
        part = ET.SubElement(root, "part", id="P1")
        prev_ts = None
        prev_keys = {}
        for n, i in enumerate(sel_list):
            prev_ts, prev_keys = self.write_measure(part, i, first=(n == 0), last=(n == len(sel_list) - 1),
                                                    prev_ts=prev_ts, prev_keys=prev_keys, sel=sel)
        return root

    def _prepare_spanner_marks(self, sel: set) -> None:
        # slurs: drop those crossing the excerpt boundary; number them
        # Slur numbers pair starts and stops in *document* order: within a measure the
        # voices are written one after another (voice 1 first), so position = (measure,
        # voice, time).  A number is reused only after its previous stop has been written.
        def doc_pos(c: Chord):
            return (c.measure, c.xvoice, c.m, c.g)

        events = []
        for a, b, placement, kind in self.slurs:
            if a.measure not in sel or b.measure not in sel:
                continue
            if (b.m, b.g) <= (a.m, a.g):
                continue
            events.append((doc_pos(a), a, b, placement))
        events.sort(key=lambda t: t[0])
        stop_at: dict[int, tuple] = {}  # number -> document position of its pending stop
        for (pos, a, b, placement) in events:
            num = next(i for i in range(1, 17) if i not in stop_at or stop_at[i] < pos)
            a.slur_marks.append(("start", num, placement))
            b.slur_marks.append(("stop", num, None))
            stop_at[num] = doc_pos(b)
        for a, b, bracket, show in self.tuplets:
            if a.measure not in sel or b.measure not in sel:
                continue
            a.tuplet_marks.append({"type": "start", "bracket": bracket, "show-number": show})
            b.tuplet_marks.append({"type": "stop"})
        # ties crossing the excerpt boundary
        for e in self.evs:
            if e.tie_start and e.tie_to is not None:
                c2 = self.chord_of_ev.get(e.tie_to)
                if c2 is None or c2.measure not in sel:
                    e.tie_start = False
            if e.tie_stop and e.tie_from is not None:
                c1 = self.chord_of_ev.get(e.tie_from)
                if c1 is None or c1.measure not in sel:
                    e.tie_stop = False
        # a hairpin that starts inside a volta ending and is not closed there leads back
        # to the repeat: close it at the end of that ending instead of running on
        ranges = []
        stops = sorted(self.endings_stop)
        for i1 in sorted(self.endings_start):
            i2 = next((s for s in stops if s >= i1), None)
            if i2 is not None:
                ranges.append((i1, i2))
        # wedges crossing the boundary
        lo, hi = min(sel), max(sel)
        kept = []
        for d in self.directions:
            mi = self.measure_of(d["m"], d["g"])
            if d["kind"] == "wedge-stop":
                ref_mi = self.measure_of(d["ref"]["m"], d["ref"]["g"])
                for i1, i2 in ranges:
                    if i1 <= ref_mi <= i2 < mi:
                        d = dict(d, m=self.measures[i2]["end"], g=F(0), at_end=True)
                        mi = i2
                        self.warn(f"hairpin from inside the ending at measure {self.measures[i1]['number']} "
                                  f"closed at the end of that ending")
                        break
            if d["kind"] == "wedge-stop" and mi > hi:
                ref_mi = self.measure_of(d["ref"]["m"], d["ref"]["g"])
                if lo <= ref_mi <= hi:
                    d = dict(d, m=self.measures[hi]["end"], g=F(0))
                    mi = hi
                    d["at_end"] = True
            if d["kind"] == "wedge-stop" and self.measure_of(d["ref"]["m"], d["ref"]["g"]) < lo:
                continue
            if d["kind"] == "octave-shift" and d.get("otype") == "stop" and mi > hi:
                d = dict(d, m=self.measures[hi]["end"], g=F(0), at_end=True)
                mi = hi
            d["measure"] = mi
            kept.append(d)
        self.directions = kept

    # attributes helpers
    def _clef_el(self, parent, c):
        el = ET.SubElement(parent, "clef", number=str(c["staff"]))
        glyph = c["glyph"].replace("clefs.", "").split("_")[0]
        sign = {"G": "G", "F": "F", "C": "C", "percussion": "percussion"}.get(glyph, "G")
        ET.SubElement(el, "sign").text = sign
        line = int(c["pos"] / 2 + 3) if c["pos"] is not None else (2 if sign == "G" else 4)
        if sign != "percussion":
            ET.SubElement(el, "line").text = str(line)
        if c["transp"]:
            ET.SubElement(el, "clef-octave-change").text = str(int(round(c["transp"] / 7)))
        return el

    def _key_els(self, parent, keys: dict):
        vals = {s: (k["fifths"], k["mode"]) for s, k in keys.items()}
        if self.o.first_key_mode and all(k["m"] == 0 for k in keys.values()):
            # the source declares only the signature (e.g. \key e \major for C# minor)
            vals = {s: (f, self.o.first_key_mode) for s, (f, _) in vals.items()}
        if len(set(vals.values())) == 1:
            fifths, mode = next(iter(vals.values()))
            k = ET.SubElement(parent, "key")
            ET.SubElement(k, "fifths").text = str(fifths)
            if mode:
                ET.SubElement(k, "mode").text = mode
        else:
            for s in sorted(vals):
                fifths, mode = vals[s]
                k = ET.SubElement(parent, "key", number=str(s))
                ET.SubElement(k, "fifths").text = str(fifths)
                if mode:
                    ET.SubElement(k, "mode").text = mode

    def _time_el(self, parent, ts, style):
        attrs = {}
        if style in (None, "C", "default"):
            if ts == (4, 4):
                attrs["symbol"] = "common"
            elif ts == (2, 2):
                attrs["symbol"] = "cut"
        elif style in ("single-digit", "single-number"):
            attrs["symbol"] = "single-number"
        t = ET.SubElement(parent, "time", **attrs)
        ET.SubElement(t, "beats").text = str(ts[0])
        ET.SubElement(t, "beat-type").text = str(ts[1])

    def write_measure(self, part, i, first, last, prev_ts, prev_keys, sel):
        ms = self.measures[i]
        attrs = {"number": str(ms["number"])}
        if ms["implicit"]:
            attrs["implicit"] = "yes"
        meas = ET.SubElement(part, "measure", **attrs)
        start = ms["start"]
        # left barline (repeat start / ending start)
        lb = self.left_bar.get(i)
        es = self.endings_start.get(i)
        if lb or es:
            bl = ET.SubElement(meas, "barline", location="left")
            if lb:
                ET.SubElement(bl, "bar-style").text = lb["style"]
            if es:
                e = ET.SubElement(bl, "ending", number=es["number"], type="start")
                e.text = es["text"] or es["number"] + "."
            if lb and lb.get("repeat"):
                ET.SubElement(bl, "repeat", direction="forward")
        # attributes at measure start
        at = ET.Element("attributes")
        if first:
            ET.SubElement(at, "divisions").text = str(self.div)
        keys_now = {}
        for s in (1, 2):
            cands = [k for k in self.keys if k["staff"] == s and k["m"] <= start]
            if cands:
                keys_now[s] = cands[-1]
        key_changed = first or any(prev_keys.get(s) is not keys_now.get(s) for s in (1, 2))
        if key_changed and keys_now:
            self._key_els(at, keys_now)
        ts = ms["ts"]
        if ts and (first or ts != prev_ts):
            self._time_el(at, ts, self.ts_style.get(start))
        if first:
            ET.SubElement(at, "staves").text = "2"
            for s in (1, 2):
                cands = [c for c in self.clefs if c["staff"] == s and c["m"] <= start]
                if cands:
                    self._clef_el(at, cands[-1])
        else:
            for c in self.clefs:
                if c["m"] == start and c["g"] == 0 and self.measure_of(c["m"]) == i and c["m"] != 0:
                    self._clef_el(at, c)
        if len(at):
            meas.append(at)
        # tempo from the MIDI block if the score has no metronome mark at the start
        if first and self.o.midi_tempo and not any(
                d["kind"] == "tempo" and d.get("count") and d["measure"] == i for d in self.directions):
            ET.SubElement(meas, "sound", tempo=_fmt_num(self.o.midi_tempo))
        # mid-measure clef changes become floating attributes
        floating = [d for d in self.directions if d["measure"] == i]
        for c in self.clefs:
            if self.measure_of(c["m"], c["g"]) == i and (c["m"] != start or c["g"] != 0) and c["m"] != 0:
                floating.append(dict(m=c["m"], g=c["g"], staff=c["staff"], voice=None, kind="clef", clef=c,
                                     measure=i))
        chords = [c for c in self.chords if c.measure == i]
        voices = sorted({c.xvoice for c in chords})
        pos = F(0)
        claimed = set()
        for vn, xv in enumerate(voices):
            vcs = sorted([c for c in chords if c.xvoice == xv], key=lambda c: (c.m, c.g))
            if vn > 0 and pos > 0:
                bk = ET.SubElement(meas, "backup")
                ET.SubElement(bk, "duration").text = str(self.dur_div(pos))
                pos = F(0)
            for c in vcs:
                off = c.m - start
                if off > pos:
                    fw = ET.SubElement(meas, "forward")
                    ET.SubElement(fw, "duration").text = str(self.dur_div(off - pos))
                    ET.SubElement(fw, "voice").text = str(xv)
                    ET.SubElement(fw, "staff").text = str(c.staff)
                    pos = off
                # directions attached at exactly this (m, g)
                for k, d in enumerate(floating):
                    if id(d) in claimed or d.get("late") or d.get("at_end"):
                        continue
                    if d["m"] == c.m and d["g"] == c.g and (d["staff"] == c.staff or d["kind"] == "tempo"):
                        self._write_direction(meas, d, xv)
                        claimed.add(id(d))
                self._write_chord(meas, c, xv)
                pos += c.dur
        # directions with no note of their staff at that moment (e.g. a hairpin ending under a
        # held note): position them with <backup>/<forward> after the voices
        rest = [d for d in floating if id(d) not in claimed]
        rest.sort(key=lambda d: (d["m"], d["g"]))
        for d in rest:
            off = d["m"] - start
            if d.get("at_end"):
                off = ms["len"]
            if off < pos:
                bk = ET.SubElement(meas, "backup")
                ET.SubElement(bk, "duration").text = str(self.dur_div(pos - off))
            elif off > pos:
                fw = ET.SubElement(meas, "forward")
                ET.SubElement(fw, "duration").text = str(self.dur_div(off - pos))
            pos = off
            self._write_direction(meas, d, None)
        # right barline
        rb = self.right_bar.get(i)
        ee = self.endings_stop.get(i)
        if last and self.o.final_barline and not (rb and rb.get("repeat")):
            rb = {"style": "light-heavy"}
        if rb or ee:
            bl = ET.SubElement(meas, "barline", location="right")
            if rb:
                ET.SubElement(bl, "bar-style").text = rb["style"]
            if ee:
                ET.SubElement(bl, "ending", number=ee["number"], type=ee["type"])
            if rb and rb.get("repeat"):
                ET.SubElement(bl, "repeat", direction="backward")
        return ts or prev_ts, keys_now

    def _write_direction(self, meas, d, voice):
        kind = d["kind"]
        if kind == "clef":
            at = ET.SubElement(meas, "attributes")
            self._clef_el(at, d["clef"])
            return
        attrs = {}
        if kind in ("dyn", "words", "pedal", "wedge-start", "wedge-stop"):
            attrs["placement"] = d.get("placement") or ("below" if kind != "words" else "above")
        if kind == "tempo":
            attrs["placement"] = "above"
        el = ET.SubElement(meas, "direction", **attrs)
        if kind == "dyn":
            dt = ET.SubElement(el, "direction-type")
            dy = ET.SubElement(dt, "dynamics")
            txt = d["text"]
            if txt in DYNAMICS:
                ET.SubElement(dy, txt)
            else:
                ET.SubElement(dy, "other-dynamics").text = txt
        elif kind == "words":
            dt = ET.SubElement(el, "direction-type")
            w = ET.SubElement(dt, "words")
            if d.get("italic"):
                w.set("font-style", "italic")
            if d.get("bold"):
                w.set("font-weight", "bold")
            w.text = d["text"]
        elif kind == "wedge-start":
            dt = ET.SubElement(el, "direction-type")
            num = d.setdefault("number", self._wedge_number(d))
            ET.SubElement(dt, "wedge", type=d["wtype"], number=str(num))
        elif kind == "wedge-stop":
            dt = ET.SubElement(el, "direction-type")
            num = d["ref"].get("number", 1)
            ET.SubElement(dt, "wedge", type="stop", number=str(num))
            self._open_wedges.discard(num)
        elif kind == "pedal":
            dt = ET.SubElement(el, "direction-type")
            ET.SubElement(dt, "pedal", type=d["ptype"], line="no", sign="yes")
        elif kind == "octave-shift":
            dt = ET.SubElement(el, "direction-type")
            ET.SubElement(dt, "octave-shift", type=d["otype"], size=str(d["size"]))
        elif kind == "tempo":
            text = d.get("text")
            hidden = d.get("hidden")  # the engraving hides this mark: keep only the playback tempo
            if text and not hidden:
                dt = ET.SubElement(el, "direction-type")
                w = ET.SubElement(dt, "words", **{"font-weight": "bold"})
                w.text = text
            qpm = None
            if d.get("unit") and d.get("count"):
                log, dots = d["unit"]
                cnt = d["count"]
                if isinstance(cnt, list):
                    per = f"{cnt[0]}-{cnt[1]}"
                    cval = (cnt[0] + cnt[1]) / 2
                else:
                    per = str(cnt)
                    cval = cnt
                if not hidden and not d.get("hidenote"):
                    dt = ET.SubElement(el, "direction-type")
                    mt = ET.SubElement(dt, "metronome", parentheses="no")
                    ET.SubElement(mt, "beat-unit").text = TYPE_NAMES[log]
                    for _ in range(dots):
                        ET.SubElement(mt, "beat-unit-dot")
                    ET.SubElement(mt, "per-minute").text = per
                unit_len = F(1, 2 ** log) * (2 - F(1, 2 ** dots))
                qpm = float(cval * unit_len * 4)
            if not len(el):
                meas.remove(el)
                if qpm:
                    ET.SubElement(meas, "sound", tempo=_fmt_num(qpm))
                return
            ET.SubElement(el, "staff").text = "1"
            if qpm:
                ET.SubElement(el, "sound", tempo=_fmt_num(qpm))
            return
        if voice is not None and kind not in ("tempo",):
            ET.SubElement(el, "voice").text = str(voice)
        ET.SubElement(el, "staff").text = str(d["staff"])

    _open_wedges: set = set()

    def _wedge_number(self, d) -> int:
        n = 1
        while n in self._open_wedges:
            n += 1
        self._open_wedges.add(n)
        return n

    def _write_chord(self, meas, c: Chord, xv: int):
        for k, e in enumerate(c.evs):
            attrs = {}
            if e.hidden:
                attrs["print-object"] = "no"
            n = ET.SubElement(meas, "note", **attrs)
            if c.grace:
                ga = {"slash": "yes"} if e.slash else {}
                ET.SubElement(n, "grace", **ga)
            if k > 0:
                ET.SubElement(n, "chord")
            if e.kind == "note":
                p = ET.SubElement(n, "pitch")
                ET.SubElement(p, "step").text = STEP_NAMES[e.step]
                if e.alt:
                    ET.SubElement(p, "alter").text = _fmt_num(float(e.alt * 2))
                ET.SubElement(p, "octave").text = str(e.oct + 4)
            else:
                ra = {"measure": "yes"} if e.measure_rest else {}
                r = ET.SubElement(n, "rest", **ra)
                if e.restpitch:
                    ET.SubElement(r, "display-step").text = STEP_NAMES[e.restpitch[0]]
                    ET.SubElement(r, "display-octave").text = str(e.restpitch[2] + 4)
            if not c.grace:
                ET.SubElement(n, "duration").text = str(self.dur_div(c.dur))
            if e.tie_stop:
                ET.SubElement(n, "tie", type="stop")
            if e.tie_start:
                ET.SubElement(n, "tie", type="start")
            ET.SubElement(n, "voice").text = str(xv)
            if not e.measure_rest:
                ET.SubElement(n, "type").text = TYPE_NAMES[e.log]
                for _ in range(e.dots):
                    ET.SubElement(n, "dot")
            if e.kind == "note" and e.acc:
                _, name, paren = e.acc
                a = ET.SubElement(n, "accidental")
                if name == "AccidentalCautionary" or paren:
                    a.set("cautionary", "yes")
                    a.set("parentheses", "yes")
                # the Accidental grob always displays the note's own alteration
                a.text = ACC_NAMES.get(e.alt, "natural")
            if e.scale != 1 and not e.measure_rest:
                tm = ET.SubElement(n, "time-modification")
                ET.SubElement(tm, "actual-notes").text = str(e.scale.denominator)
                ET.SubElement(tm, "normal-notes").text = str(e.scale.numerator)
            if e.kind == "note" and e.stemdir in (1, -1):
                ET.SubElement(n, "stem").text = "up" if e.stemdir == 1 else "down"
            ET.SubElement(n, "staff").text = str(e.xstaff)
            if k == 0:
                for num, val in c.beams:
                    ET.SubElement(n, "beam", number=str(num)).text = val
            self._write_notations(n, c, e, k)

    @staticmethod
    def _chord_extra_fingers(c: Chord) -> dict[int, list]:
        """Assign fingerings written after a note or chord to chord notes (index 0 = lowest).

        LilyPond stacks them outward from the chord in the order written, above or below it.
        One per note: first written = lowest note.  Fewer than the notes: they belong to the
        top notes when placed above the chord, to the bottom notes when placed below.
        """
        extra = c.extra_fingers
        n = len(c.evs)
        if not extra:
            return {}
        if n == 1:
            return {0: [f for f, _ in extra]}
        out: dict[int, list] = {}
        if len(extra) >= n:
            for i, (f, _) in enumerate(extra):
                out.setdefault(min(i, n - 1), []).append(f)
            return out
        up = sum(1 for _, d in extra if d > 0) >= sum(1 for _, d in extra if d < 0)
        targets = list(range(n - len(extra), n)) if up else list(range(len(extra)))
        for i, (f, _) in enumerate(extra):
            out.setdefault(targets[i], []).append(f)
        return out

    def _write_notations(self, n, c: Chord, e: Ev, k: int):
        items = []
        if e.tie_stop:
            items.append(("tied", {"type": "stop"}, None))
        if e.tie_start:
            items.append(("tied", {"type": "start"}, None))
        if k == 0:
            for typ, num, placement in sorted(c.slur_marks, key=lambda t: t[0] != "stop"):
                at = {"type": typ, "number": str(num)}
                if placement:
                    at["placement"] = placement
                items.append(("slur", at, None))
            for t in c.tuplet_marks:
                items.append(("tuplet", {kk: vv for kk, vv in t.items()}, None))
        fingers = []
        if self.o.include_fingering and e.kind == "note":
            fingers = list(e.fingers) + self._chord_extra_fingers(c).get(k, [])
        arts = c.arts if k == 0 else []
        if not (items or fingers or arts or c.arpeggiate):
            return
        no = ET.SubElement(n, "notations")
        for name, at, _ in items:
            ET.SubElement(no, name, **at)
        groups = {}
        for container, elem, at in arts:
            groups.setdefault(container, []).append((elem, at))
        for elem, at in groups.get("notations", []):
            ET.SubElement(no, elem, **at)
        if "ornaments" in groups:
            orn = ET.SubElement(no, "ornaments")
            for elem, at in groups["ornaments"]:
                ET.SubElement(orn, elem, **at)
        if "technical" in groups or fingers:
            tech = ET.SubElement(no, "technical")
            for elem, at in groups.get("technical", []):
                ET.SubElement(tech, elem, **at)
            for f in fingers:
                parts = re.split(r"\s*[-–]\s*", str(f)) if isinstance(f, str) else [str(f)]
                for j, ptxt in enumerate(parts):
                    fa = {"substitution": "yes"} if j > 0 else {}
                    ET.SubElement(tech, "fingering", **fa).text = ptxt
        if "articulations" in groups:
            ar = ET.SubElement(no, "articulations")
            for elem, at in groups["articulations"]:
                ET.SubElement(ar, elem, **at)
        if c.arpeggiate:
            ET.SubElement(no, "arpeggiate")


def _fmt_num(x: float) -> str:
    if float(x).is_integer():
        return str(int(x))
    return f"{x:.4f}".rstrip("0").rstrip(".")


DOCTYPE = ('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
           '"http://www.musicxml.org/dtds/partwise.dtd">')


def to_bytes(root: ET.Element) -> bytes:
    ET.indent(root, space="  ")
    body = ET.tostring(root, encoding="unicode")
    return ('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + DOCTYPE + "\n" + body + "\n").encode("utf-8")


def convert_dump(dump_path: Path, score: int, opts: Options) -> tuple[bytes, list[str]]:
    conv = Converter(Dump(dump_path, score), opts)
    conv._open_wedges = set()
    root = conv.build()
    return to_bytes(root), conv.warnings


def midi_tempo_from_ly(text: str) -> float | None:
    """Quarter notes per minute from a \\midi block (old or new syntax)."""
    m = re.search(r"\\midi\s*\{(.*?)\n\s*\}", text, re.S)
    block = m.group(1) if m else ""
    t = re.search(r"\\tempo\s+(\d+)(\.?)\s*=\s*(\d+)", block)
    if t:
        unit = F(1, int(t.group(1))) * (F(3, 2) if t.group(2) else 1)
        return float(int(t.group(3)) * unit * 4)
    t = re.search(r"tempoWholesPerMinute\s*=\s*#\(ly:make-moment\s+(\d+)\s*/?\s*(\d+)?", block)
    if t:
        wpm = F(int(t.group(1)), int(t.group(2) or 1))
        return float(wpm * 4)
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ly", type=Path, help="main LilyPond file")
    ap.add_argument("--extra", type=Path, nargs="*", default=[], help="additional include files")
    ap.add_argument("--build", type=Path, required=True, help="build directory (will be wiped)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--fingered", type=Path)
    ap.add_argument("--score", type=int, default=1)
    ap.add_argument("--from", dest="bar_from", type=int)
    ap.add_argument("--to", dest="bar_to", type=int)
    ap.add_argument("--title", default="")
    ap.add_argument("--composer", default="")
    a = ap.parse_args(argv)
    res = compile_lilypond([a.ly] + a.extra, a.ly.name, a.build, quiet=False)
    opts = Options(title=a.title, composer=a.composer, bar_from=a.bar_from, bar_to=a.bar_to,
                   midi_tempo=midi_tempo_from_ly(a.ly.read_text(encoding="utf-8", errors="replace")))
    data, warns = convert_dump(res["dump"], a.score, opts)
    a.out.write_bytes(data)
    if a.fingered:
        opts.include_fingering = True
        data, _ = convert_dump(res["dump"], a.score, opts)
        a.fingered.write_bytes(data)
    for w in warns:
        print("warning:", w)
    print(f"wrote {a.out} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
