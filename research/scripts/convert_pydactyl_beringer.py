#!/usr/bin/env python
"""Convert D. Randolph's abcD transcriptions of Beringer & Dunhill (1900) scales, arpeggios and
broken chords (pydactyl repository, MIT) into PIG-format fingering files.

    research/.venv/Scripts/python.exe -I research/scripts/download_datasets.py pydactyl
    research/.venv/Scripts/python.exe -I research/scripts/convert_pydactyl_beringer.py

Input : research/data/pydactyl/data/corpora/beringer2/{scales,arpeggios,broken_chords}/*.abcd
Output: research/data/beringer_fingering/FingeringFiles/<exercise>-<n>_fingering.txt
        (n = abcD fingering number: 1 = Beringer's complete fingering, 2+ = the alternatives he
        prints; "x@x" placeholders are skipped), manifest.csv, summary.json

abcD format (pydactyl/dcorpus/DAnnotation.py grammar): ``% abcD fingering N: <upper>@<lower>``,
one symbol per note in score order; ``&`` separates lines, digits 1-5 = striking finger,
``a-b`` = substitution, ``x`` = unknown, ``<``/``>`` = left/right hand override, ``(...)`` =
ornament fingers, ``/`` = alternative, ``p f _ ^`` = pedal marks, ``, ; .`` = phrase marks.

The music is a small ABC subset (two voices, L:1/16, K: key, inline [K: clef=... octave=N]);
this script contains a minimal ABC reader for exactly that subset and refuses anything else.
For broken chords the score also carries fingering annotations ``"^$<staff><finger>"``; they
are cross-checked against the abcD line.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from fractions import Fraction
from pathlib import Path

RESEARCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RESEARCH))

from fingering_eval import validate as V  # noqa: E402
from fingering_eval.pig_io import make_note, write_pig  # noqa: E402

DATA = RESEARCH / "data"
SRC = DATA / "pydactyl" / "data" / "corpora" / "beringer2"
OUT = DATA / "beringer_fingering"

LETTER = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARP_ORDER = "FCGDAEB"
FLAT_ORDER = "BEADGCF"
MAJOR_SHARPS = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7,
                "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6, "Cb": -7}
MODE_OFFSET = {"maj": 0, "major": 0, "ion": 0, "": 0, "min": -3, "m": -3, "minor": -3, "aeo": -3, "dor": -2,
               "phr": -4, "lyd": 1, "mix": -1, "loc": -5}


def key_accidentals(k: str) -> dict[str, int]:
    m = re.match(r"\s*([A-G])([#b]?)\s*([A-Za-z]*)", k)
    if not m:
        return {}
    tonic = m.group(1) + m.group(2)
    mode = m.group(3).lower()[:3] if m.group(3) else ""
    if mode in ("cle",):  # "clef=..." directly after the tonic
        mode = ""
    # find the major key with the same signature
    order = ["C", "G", "D", "A", "E", "B", "F#", "C#", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"]
    fifths_of = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7, "F": -1, "Bb": -2, "Eb": -3,
                 "Ab": -4, "Db": -5, "Gb": -6, "Cb": -7, "G#": 8, "D#": 9, "A#": 10, "Fb": -8}
    if tonic not in fifths_of:
        return {}
    n = fifths_of[tonic] + MODE_OFFSET.get(mode, 0)
    acc = {}
    if n > 0:
        for l in SHARP_ORDER[:n]:
            acc[l] = 1
    elif n < 0:
        for l in FLAT_ORDER[:-n]:
            acc[l] = -1
    _ = order
    return acc


NOTE_RX = re.compile(r"(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)(\d*)(/*)(\d*)")


def parse_abc_voices(text: str) -> tuple[dict, dict]:
    """Return ({voice: [note dicts]}, {voice: [annotation fingers]}) for the two-voice subset."""
    key = {}
    unit = Fraction(1, 8)
    voices: dict[str, list] = {}
    annots: dict[str, list] = {}
    voice_octave: dict[str, int] = {}
    cur = None
    in_body = False
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line or line.startswith("%"):
            continue
        m = re.match(r"^([A-Za-z]):(.*)$", line)
        if m and not line.startswith("|"):
            f, val = m.group(1), m.group(2).strip()
            if f == "K":
                key = key_accidentals(val)
                in_body = True
            elif f == "L":
                unit = Fraction(val.replace(" ", ""))
            elif f == "V":
                parts = val.split()
                cur = parts[0]
                oc = re.search(r"octave=(-?\d+)", val)
                if oc:
                    voice_octave[cur] = int(oc.group(1))
                voices.setdefault(cur, [])
                annots.setdefault(cur, [])
            continue
        if not in_body or cur is None:
            continue
        i = 0
        bar_acc: dict[tuple, int] = {}
        t = voices[cur][-1]["end"] if voices[cur] else Fraction(0)
        pending_ann = []
        while i < len(line):
            c = line[i]
            if c == '"':
                j = line.index('"', i + 1)
                ann = line[i + 1:j]
                am = re.match(r"^[\^_]?\$(\d)(\d)$", ann)
                if am:
                    pending_ann.append(int(am.group(2)))
                i = j + 1
                continue
            if c == "[" and re.match(r"\[[A-Za-z]:", line[i:]):
                j = line.index("]", i)
                field = line[i + 1:j]
                if field.startswith("K:"):
                    oc = re.search(r"octave=(-?\d+)", field)
                    if oc:
                        voice_octave[cur] = int(oc.group(1))
                    kk = field[2:].strip()
                    if kk and not kk.startswith("clef"):
                        key = key_accidentals(kk)
                i = j + 1
                continue
            if c in "|:[]" or c.isspace() or c in "()-`":
                if c == "|":
                    bar_acc = {}
                if c == "[" and i + 1 < len(line) and line[i + 1].isdigit():
                    i += 2
                    continue
                if c == "[":
                    raise ValueError(f"chords not supported: {line[i:i + 12]!r}")
                i += 1
                continue
            if c in "!+":
                j = line.index(c, i + 1)
                i = j + 1
                continue
            if c in "zx":
                m2 = re.match(r"[zx](\d*)(/*)(\d*)", line[i:])
                num = int(m2.group(1)) if m2.group(1) else 1
                den = (2 ** len(m2.group(2)) if not m2.group(3) else int(m2.group(3))) if m2.group(2) else 1
                t += unit * Fraction(num, den)
                i += m2.end()
                continue
            nm = NOTE_RX.match(line, i)
            if nm:
                acc, letter, octs, num, slashes, den = nm.groups()
                base = 60 + LETTER[letter.upper()] + (12 if letter.islower() else 0)
                base += 12 * octs.count("'") - 12 * octs.count(",")
                k_ = (letter.upper(), base)
                if acc:
                    a = {"^": 1, "^^": 2, "_": -1, "__": -2, "=": 0}[acc]
                    bar_acc[k_] = a
                else:
                    a = bar_acc.get(k_, key.get(letter.upper(), 0))
                pitch = base + a + 12 * voice_octave.get(cur, 0)
                n = int(num) if num else 1
                d = (2 ** len(slashes) if not den else int(den)) if slashes else 1
                dur = unit * Fraction(n, d)
                voices[cur].append({"onset": t, "end": t + dur, "pitch": pitch})
                annots[cur].append(pending_ann[-1] if pending_ann else None)
                pending_ann = []
                t += dur
                i = nm.end()
                continue
            raise ValueError(f"unsupported ABC token {line[i:i + 12]!r}")
    return voices, annots


SYMBOL_RX = re.compile(r"\((?P<orn>[^)]*)\)|(?P<soft>[pf])?(?P<hand>[<>])?(?P<strike>[1-5x])"
                       r"(?:-(?P<rhand>[<>])?(?P<release>[1-5]))?(?P<damper>[_^])?")


def parse_abcd_staff(s: str) -> list[str | None]:
    """abcD staff string -> list of PIG-style finger strings (None = unknown), one per note."""
    out: list[str | None] = []
    i = 0
    s = s.replace("&", "")
    while i < len(s):
        c = s[i]
        if c in ",;.":
            i += 1
            continue
        if c == "/":
            # alternative fingering for the previous note: skip the next symbol
            m = SYMBOL_RX.match(s, i + 1)
            i = m.end() if m else i + 1
            continue
        m = SYMBOL_RX.match(s, i)
        if not m:
            raise ValueError(f"bad abcD symbol at {s[i:i + 10]!r}")
        if m.group("orn") is not None:
            digits = re.findall(r"[1-5]", m.group("orn"))
            out.append(digits[0] if digits else None)
        elif m.group("strike") == "x":
            out.append(None)
        else:
            f = m.group("strike")
            if m.group("release"):
                f += "_" + m.group("release")
            hand = m.group("hand")
            out.append(("<" if hand == "<" else ">" if hand == ">" else "") + f)
        i = m.end()
    return out


def main() -> int:
    files = sorted(SRC.glob("*/*.abcd"))
    if not files:
        print(f"no .abcd files under {SRC}; run download_datasets.py pydactyl", file=sys.stderr)
        return 1
    fing_dir = OUT / "FingeringFiles"
    fing_dir.mkdir(parents=True, exist_ok=True)
    for old in fing_dir.glob("*_fingering.txt"):
        old.unlink()
    rows, problems = [], []
    for f in files:
        text = f.read_text(encoding="utf-8", errors="replace")
        name = f"{f.parent.name}_{f.stem}"
        try:
            voices, annots = parse_abc_voices(text)
        except ValueError as e:
            problems.append({"file": f.name, "problem": f"abc: {e}"})
            continue
        vids = sorted(voices)
        if len(vids) != 2:
            problems.append({"file": f.name, "problem": f"expected 2 voices, got {vids}"})
            continue
        fings = re.findall(r"^\\?% abcD fingering (\d+):\s*(\S+)", text, flags=re.M)
        for num, fs in fings:
            if "@" not in fs:
                problems.append({"file": f.name, "problem": f"fingering {num} without '@'"})
                continue
            upper, lower = fs.split("@", 1)
            if set(upper.replace("&", "")) <= {"x"} and set(lower.replace("&", "")) <= {"x"}:
                continue
            try:
                fu, fl = parse_abcd_staff(upper), parse_abcd_staff(lower)
            except ValueError as e:
                problems.append({"file": f.name, "problem": f"fingering {num}: {e}"})
                continue
            nu, nl = len(voices[vids[0]]), len(voices[vids[1]])
            if len(fu) != nu or len(fl) != nl:
                problems.append({"file": f.name, "problem": f"fingering {num}: {len(fu)}/{len(fl)} symbols for "
                                                            f"{nu}/{nl} notes"})
                continue
            notes = []
            ann_check = [0, 0]
            for ch, (vid, flist) in enumerate(((vids[0], fu), (vids[1], fl))):
                for k, (nd, fsym) in enumerate(zip(voices[vid], flist)):
                    finger = "0"
                    hand_ch = ch
                    if fsym:
                        if fsym[0] in "<>":
                            hand_ch = 1 if fsym[0] == "<" else 0
                            fsym = fsym[1:]
                        finger = fsym if hand_ch == 0 else "_".join(f"-{x}" for x in fsym.split("_"))
                    a = annots[vid][k]
                    if a is not None and fsym:
                        ann_check[0] += 1
                        ann_check[1] += int(int(fsym.split("_")[0]) == a)
                    notes.append((float(nd["onset"]) * 2.4, float(nd["end"]) * 2.4, nd["pitch"], hand_ch, finger))
            notes.sort(key=lambda x: (x[0], x[3], x[2]))
            pig_notes = [make_note(i, on, off, p, ch, fg) for i, (on, off, p, ch, fg) in enumerate(notes)]
            pid = re.sub(r"[^A-Za-z0-9]+", "", name.title())
            write_pig(fing_dir / f"{pid}-{num}_fingering.txt", pig_notes,
                      ["//Version: PianoFingering_v170101",
                       f"//Source: pydactyl data/corpora/beringer2/{f.parent.name}/{f.name} (abcD fingering {num})",
                       "//Authority: Beringer and Dunhill (1900); transcribed by David Randolph",
                       "//License: fingerings public domain (1900); transcription from MIT-licensed pydactyl"])
            an = V.validate_notes(pig_notes, pid, num, "beringer")
            rows.append({"piece_id": pid, "annotation": num, "source": f"{f.parent.name}/{f.name}",
                         "n_notes": len(pig_notes), "n_fingered": sum(1 for n in pig_notes if n.finger != "0"),
                         "score_annotation_checks": ann_check[0], "score_annotation_agree": ann_check[1],
                         "validator_errors": sum(1 for a in an if a.severity == "error"),
                         "validator_warnings": sum(1 for a in an if a.severity == "warning")})
    with open(OUT / "manifest.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    summary = {"abcd_files": len(files), "fingering_files_written": len(rows),
               "exercises": len({r["piece_id"] for r in rows}),
               "notes": sum(r["n_notes"] for r in rows), "fingered_notes": sum(r["n_fingered"] for r in rows),
               "score_annotation_cross_check": [sum(r["score_annotation_checks"] for r in rows),
                                                sum(r["score_annotation_agree"] for r in rows)],
               "validator_errors": sum(r["validator_errors"] for r in rows), "problems": problems}
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "problems"}, indent=1))
    print(f"{len(problems)} problems; e.g. {problems[:5]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
