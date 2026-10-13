#!/usr/bin/env python
"""Build PIG-format fingering files from Mutopia LilyPond sources (editorial fingerings).

    research/.venv/Scripts/python.exe -I research/scripts/download_datasets.py mutopia_src
    research/.venv/Scripts/python.exe -I research/scripts/build_mutopia_fingering.py [--limit N] [--only SUBSTR]

Inputs : research/data/mutopia_src/ftp/<Composer>/<Opus>/<Piece>/...  (keyboard pieces only)
Outputs: research/data/mutopia_fingering/
           FingeringFiles/<piece_id>-0_fingering.txt   one file per two-hand part with >= 1 fingered note
                                                       (annotation id 0 = the edition's fingering; "0" in the
                                                       finger column = no fingering printed for that note)
           manifest.csv / manifest.json                one row per written part (committed)
           failures.csv                                files/parts that could not be converted (committed)
           summary.json                                totals (committed)

Piece ids: ``MP<mutopia id>_s<score>_p<part>``; the Mutopia id comes from the ``footer``
("Mutopia-YYYY/MM/DD-<id>") and links to https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=<id>.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

RESEARCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RESEARCH))

from fingering_eval import mutopia as MU  # noqa: E402
from fingering_eval import validate as V  # noqa: E402
from fingering_eval.pig_io import write_pig  # noqa: E402

DATA = RESEARCH / "data"
SRC = DATA / "mutopia_src" / "ftp"
OUT = DATA / "mutopia_fingering"

FINGER_RX = re.compile(r"(?:[-_^]\s*[1-5](?![0-9]))|\\finger")


def piece_units() -> list[tuple[str, Path, list[Path]]]:
    """(unit id, search dir, files) for every piece directory Composer/Opus/Piece and for every
    loose .ly file directly inside a Composer/Opus directory."""
    units = []
    for opus in sorted(p for p in SRC.glob("*/*") if p.is_dir()):
        for f in sorted(opus.glob("*.ly")):
            units.append((f.relative_to(SRC).as_posix(), opus, [f]))
        for d in sorted(p for p in opus.iterdir() if p.is_dir()):
            files = sorted(x for x in d.rglob("*") if x.suffix in (".ly", ".ily", ".lyi") and x.is_file())
            units.append((d.relative_to(SRC).as_posix(), d, files))
    return units


def count_fingering_tokens(files: list[Path]) -> int:
    """Fingering marks in the source according to python-ly's lexer (+ \\finger commands)."""
    import ly.document
    import ly.lex.lilypond as LP

    n = 0
    for f in files:
        raw = f.read_bytes()
        try:
            txt = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            txt = raw.decode("cp1252", errors="replace")
        doc = ly.document.Document(txt)
        for block in doc:
            for t in doc.tokens(block):
                if isinstance(t, LP.Fingering) or (str(t) == chr(92) + "finger"):
                    n += 1
    return n


def mutopia_id(header: dict) -> str | None:
    m = re.search(r"Mutopia-\d{4}/\d{2}/\d{2}-(\d+)", header.get("footer", "") or "")
    return m.group(1) if m else None


_UNIT_RX = {
    "license": re.compile(r'(?:\blicense|mutopiacopyright|\bcopyright)\s*=\s*"([^"]{3,120})"'),
    "footer": re.compile(r'footer\s*=\s*"(Mutopia-[^"]+)"'),
    "mutopiainstrument": re.compile(r'mutopiainstrument\s*=\s*"([^"]+)"'),
}


def unit_level_header(files: list[Path]) -> dict:
    """First licence / footer / instrument string found in any file of the piece directory."""
    out: dict = {}
    for f in files:
        txt = f.read_text(encoding="utf-8", errors="replace")
        txt = re.sub(r"%[^\n]*", "", txt)
        for key, rx in _UNIT_RX.items():
            if key not in out:
                m = rx.search(txt)
                if m:
                    out[key] = m.group(1).strip()
    return out


def license_of(header: dict) -> str:
    """Mutopia licence string from the header (``license``, older files: ``copyright`` or
    ``mutopiacopyright``). Scheme/markup expressions (formatted footers) are not licences."""
    for key in ("license", "mutopiacopyright", "copyright"):
        v = (header.get(key) or "").strip()
        if v and not v.startswith("(") and "markup" not in v and len(v) < 120:
            return v
    return ""


def status_of(d: dict) -> tuple[str, list[str]]:
    """'ok' unless the internal consistency checks indicate a timing/parse problem.

    * bar checks: we count *breaks* (independent off-grid events, re-anchored after each); a
      couple are normal (incomplete measures at section ends that LilyPond itself tolerates)
    * the two staves of a part should end at the same time (<= 1 whole note difference)
    """
    issues = []
    ok = True
    if d["bar_checks"]:
        allowed = max(2, int(0.05 * d["bar_checks"]))
        if d["bar_check_breaks"]:
            issues.append(f"{d['bar_check_breaks']} bar-check breaks ({d['bar_check_failures']}/{d['bar_checks']} "
                          f"checks off-grid)")
        if d["bar_check_breaks"] > allowed:
            ok = False
    if d["staff_length_mismatch"] > 1.0:
        issues.append(f"staves differ in length by {d['staff_length_mismatch']:.3f} whole notes")
        ok = False
    elif d["staff_length_mismatch"]:
        issues.append(f"staves differ in length by {d['staff_length_mismatch']:.3f} whole notes (<= 1, tolerated)")
    if d.get("n_parse_warnings"):
        issues.append(f"{d['n_parse_warnings']} parser warnings")
    if d["n_fingered"] < 5:
        issues.append("fewer than 5 fingered notes")
    return ("ok" if ok else "suspect"), issues


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="", help="substring filter on the piece directory")
    ap.add_argument("--all-keyboard", action="store_true", help="convert all keyboard pieces (not only fingered)")
    args = ap.parse_args(argv)

    if not SRC.exists():
        print(f"missing {SRC}; run download_datasets.py mutopia_src first", file=sys.stderr)
        return 1
    fing_dir = OUT / "FingeringFiles"
    fing_dir.mkdir(parents=True, exist_ok=True)
    for old in fing_dir.glob("*_fingering.txt"):
        old.unlink()

    rows, failures = [], []
    seen_parts: dict[str, str] = {}
    totals = Counter()
    t0 = time.time()
    units = [u for u in piece_units() if args.only in u[0]]
    for k, (unit, d, unit_files) in enumerate(units):
        if args.limit and k >= args.limit:
            break
        totals["piece_units"] += 1
        n_src_marks = count_fingering_tokens(unit_files)
        if not args.all_keyboard and n_src_marks == 0:
            continue
        totals["piece_units_with_fingering_marks"] += 1
        totals["source_fingering_marks"] += n_src_marks
        rel_dir = unit
        single_loose_file = len(unit_files) == 1 and unit_files[0].suffix == ".ly" and unit.count("/") <= 2
        mains = unit_files if single_loose_file else MU.find_main_files(d)
        unit_header = unit_level_header(unit_files)
        if not mains:
            failures.append({"piece_dir": rel_dir, "file": "", "stage": "find", "error": "no main .ly file"})
            continue
        for main in mains:
            totals["files"] += 1
            conv = MU.convert_file(main, search_dirs=[d] + [p for p in d.iterdir() if p.is_dir()])
            unit_marks = n_src_marks
            rel = main.relative_to(SRC).as_posix()
            if conv.error:
                failures.append({"piece_dir": rel_dir, "file": rel, "stage": "parse", "error": conv.error})
                totals["files_failed"] += 1
                continue
            if conv.diagnostics.get("score_errors"):
                for e in conv.diagnostics["score_errors"]:
                    failures.append({"piece_dir": rel_dir, "file": rel, "stage": "evaluate", "error": e})
            h = dict(conv.header)
            # movements split into several files sometimes carry the licence / Mutopia id only in
            # a sibling file of the same piece directory: fall back to those
            if not license_of(h) and unit_header.get("license"):
                h["license"] = unit_header["license"]
            if not mutopia_id(h) and unit_header.get("footer"):
                h["footer"] = unit_header["footer"]
            instrument = h.get("mutopiainstrument", "") or unit_header.get("mutopiainstrument", "")
            if instrument and not MU.KEYBOARD_RX.search(instrument):
                failures.append({"piece_dir": rel_dir, "file": rel, "stage": "filter",
                                 "error": f"not a keyboard piece: {instrument}"})
                continue
            mid = mutopia_id(h)
            fingered_parts = [p for p in conv.parts if p.diagnostics["n_fingered"] > 0]
            if not conv.parts:
                failures.append({"piece_dir": rel_dir, "file": rel, "stage": "parts",
                                 "error": f"no two-hand part found ({conv.diagnostics.get('n_layout_scores')} "
                                          f"layout scores)"})
                continue
            if not fingered_parts:
                failures.append({"piece_dir": rel_dir, "file": rel, "stage": "fingering",
                                 "error": "parts found but no fingering could be attached"})
                continue
            totals["files_converted"] += 1
            base = f"MP{int(mid):04d}" if mid else re.sub(r"[^A-Za-z0-9]+", "", rel_dir.split("/")[-1])[:24]
            if len(mains) > 1:
                base += f"f{mains.index(main)}"
            for j, part in enumerate(fingered_parts):
                pid = f"{base}_s{part.score_index:02d}_p{j}"
                digest = hashlib.sha1(repr([(n.pitch, n.finger.lstrip("-")) for n in part.notes])
                                      .encode()).hexdigest()
                if digest in seen_parts:
                    # e.g. A4 and US-letter variants of the same engraving
                    failures.append({"piece_dir": rel_dir, "file": rel, "stage": "duplicate",
                                     "error": f"part {pid} identical to {seen_parts[digest]} (skipped)"})
                    totals["duplicate_parts_skipped"] += 1
                    continue
                seen_parts[digest] = pid
                d_ = dict(part.diagnostics)
                d_["n_parse_warnings"] = conv.diagnostics.get("parser_warnings", 0)
                anomalies = V.validate_notes(part.notes, pid, "0", "mutopia")
                n_err = sum(1 for a in anomalies if a.severity == "error")
                status, issues = status_of(d_)
                if n_err:
                    issues.append(f"{n_err} validator errors")
                header_lines = ["//Version: PianoFingering_v170101",
                                f"//Source: Mutopia {('id ' + mid) if mid else rel_dir} {rel}",
                                f"//License: {license_of(h)}",
                                "//Note: finger 0 = no fingering printed for this note"]
                write_pig(fing_dir / f"{pid}-0_fingering.txt", part.notes, header_lines)
                rows.append({
                    "piece_id": pid, "mutopia_id": mid or "", "composer": h.get("mutopiacomposer", h.get("composer", "")),
                    "title": h.get("mutopiatitle", h.get("title", "")), "opus": h.get("mutopiaopus", h.get("opus", "")),
                    "part": part.label, "instrument": instrument, "license": license_of(h),
                    "source_url": f"https://www.mutopiaproject.org/cgibin/piece-info.cgi?id={mid}" if mid else "",
                    "ly_file": rel, "lilypond_version": conv.diagnostics.get("version", ""),
                    "n_notes": d_["n_notes"], "n_fingered": d_["n_fingered"],
                    "fingered_fraction": d_["fingered_fraction"], "n_fingered_rh": d_["n_fingered_rh"],
                    "n_fingered_lh": d_["n_fingered_lh"], "bar_checks": d_["bar_checks"],
                    "bar_check_failures": d_["bar_check_failures"], "bar_check_breaks": d_["bar_check_breaks"],
                    "staff_length_mismatch": round(d_["staff_length_mismatch"], 4),
                    "validator_errors": n_err,
                    "chord_fingering_mapped": d_.get("chord_post_fingering_mapped", 0),
                    "chord_fingering_dropped": sum(v for k_, v in d_.items() if k_.startswith("chord_post_fingering_")
                                                   and k_ != "chord_post_fingering_mapped"),
                    "finger_text_unparsed": d_.get("finger_text_unparsed", 0),
                    "two_marks_first_kept": d_.get("two_marks_first_kept", 0),
                    "multi_marks_to_voices": d_.get("multi_marks_mapped_to_simultaneous_notes", 0),
                    "source_marks_in_unit": unit_marks,
                    "status": status, "issues": "; ".join(issues),
                })
            for part in conv.parts:
                if part.diagnostics["n_fingered"] == 0:
                    totals["parts_without_fingering"] += 1
        if (k + 1) % 50 == 0:
            print(f"  {k + 1}/{len(units)} units, {len(rows)} parts, {time.time() - t0:.0f}s", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    cols = list(rows[0].keys()) if rows else ["piece_id"]
    with open(OUT / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    (OUT / "manifest.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    with open(OUT / "failures.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["piece_dir", "file", "stage", "error"])
        w.writeheader()
        w.writerows(failures)
    ok = [r for r in rows if r["status"] == "ok"]
    summary = {
        **totals,
        "parts_written": len(rows), "parts_ok": len(ok), "parts_suspect": len(rows) - len(ok),
        "pieces_written": len({r['mutopia_id'] or r['ly_file'] for r in rows}),
        "pieces_ok": len({r['mutopia_id'] or r['ly_file'] for r in ok}),
        "notes_total": sum(r["n_notes"] for r in rows), "notes_fingered": sum(r["n_fingered"] for r in rows),
        "notes_total_ok": sum(r["n_notes"] for r in ok), "notes_fingered_ok": sum(r["n_fingered"] for r in ok),
        "failures_by_stage": dict(Counter(f["stage"] for f in failures)),
        "licenses": dict(Counter(r["license"] for r in rows).most_common()),
        "seconds": round(time.time() - t0, 1),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
