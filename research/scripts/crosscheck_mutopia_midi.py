#!/usr/bin/env python
"""Independent check of the LilyPond interpreter: compare every converted Mutopia part with the
MIDI file that LilyPond itself rendered for the piece (shipped by the Mutopia Project).

    research/.venv/Scripts/python.exe -I research/scripts/crosscheck_mutopia_midi.py [--offline]

For each part (manifest row) and each hand we take our note sequence (sorted by onset, then
pitch) and search all tracks of all MIDI files of that piece (and their merge) for the best in-order match
of pitches (exact longest common subsequence, bit-parallel). Because Mutopia MIDI files
often unfold repeats, our written-order sequence is expected to be a *subsequence* of the
MIDI track, so we report recall = matched / our notes (1.0 = every note we extracted appears,
in order, with the same pitch in LilyPond's own rendering).

Downloads (cached, gitignored): research/data/mutopia_midi/<id>/ (piece-info page + .mid / -mids.zip)
Writes:  research/data/reports/mutopia_midi_crosscheck.json and adds columns ``midi_recall_rh``,
``midi_recall_lh``, ``midi_status`` to research/data/mutopia_fingering/manifest.{csv,json};
parts whose recall is < 0.95 in either hand are demoted to status "suspect".
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

RESEARCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RESEARCH))

from fingering_eval.pig_io import read_pig  # noqa: E402

DATA = RESEARCH / "data"
OUT = DATA / "mutopia_fingering"
CACHE = DATA / "mutopia_midi"
UA = "digitus2-research/1.0 (non-commercial research; polite crawler)"
RECALL_OK = 0.95


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def midi_files_for(mid: str, offline: bool) -> dict[str, bytes]:
    """{name: midi bytes} for a Mutopia piece id (cached)."""
    d = CACHE / mid
    d.mkdir(parents=True, exist_ok=True)
    page = d / "piece-info.html"
    if not page.exists():
        if offline:
            return {}
        page.write_bytes(http_get(f"https://www.mutopiaproject.org/cgibin/piece-info.cgi?id={mid}"))
        time.sleep(0.4)
    html = page.read_text(encoding="utf-8", errors="replace")
    links = sorted(set(re.findall(r'href="(https?://www\.mutopiaproject\.org/ftp/[^"]+?(?:\.mid|-mids\.zip))"', html)))
    out: dict[str, bytes] = {}
    for url in links:
        local = d / url.rsplit("/", 1)[-1]
        if not local.exists():
            if offline:
                continue
            local.write_bytes(http_get(url))
            time.sleep(0.4)
        if local.suffix == ".zip":
            with zipfile.ZipFile(local) as z:
                for info in z.infolist():
                    if info.filename.lower().endswith((".mid", ".midi")) and not info.is_dir():
                        out[info.filename.rsplit("/", 1)[-1]] = z.read(info)
        else:
            out[local.name] = local.read_bytes()
    return out


def midi_tracks(data: bytes) -> list[list[int]]:
    """Pitch sequences (sorted by onset, then pitch) of every track with notes, plus the merge
    of all tracks of the file (some MIDI scores combine staves differently from the layout)."""
    import mido

    mf = mido.MidiFile(file=io.BytesIO(data))
    tracks = []
    merged = []
    for tr in mf.tracks:
        t = 0
        notes = []
        for msg in tr:
            t += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                notes.append((t, msg.note))
        if notes:
            tracks.append([p for _, p in sorted(notes)])
            merged += notes
    if len(tracks) > 1:
        tracks.append([p for _, p in sorted(merged)])
    return tracks


def lcs_length(a: list[int], b: list[int]) -> int:
    """Exact longest-common-subsequence length, bit-parallel (Allison & Dix 1986; Hyyrö 2004)."""
    if not a or not b:
        return 0
    masks: dict[int, int] = {}
    for j, x in enumerate(b):
        masks[x] = masks.get(x, 0) | (1 << j)
    full = (1 << len(b)) - 1
    v = full
    for x in a:
        u = v & masks.get(x, 0)
        v = ((v + u) | (v - u)) & full
    return len(b) - bin(v).count("1")


def recall(ours: list[int], theirs: list[int]) -> float:
    if not ours:
        return float("nan")
    return lcs_length(ours, theirs) / len(ours)


def website_version_recalls(mid: str, tracks: list[list[int]], offline: bool) -> list[float]:
    """Download the website's own LilyPond source of piece ``mid`` (cached under
    mutopia_midi/<id>/site/), convert it and return the per-part/hand MIDI recalls."""
    from fingering_eval import mutopia as MU

    d = CACHE / mid
    html = (d / "piece-info.html").read_text(encoding="utf-8", errors="replace")
    links = sorted(set(re.findall(r'href="(https?://www\.mutopiaproject\.org/ftp/[^"]+?(?:\.ly|-lys\.zip))"', html)))
    site = d / "site"
    site.mkdir(exist_ok=True)
    for url in links:
        local = site / url.rsplit("/", 1)[-1]
        if not local.exists():
            if offline:
                continue
            local.write_bytes(http_get(url))
            time.sleep(0.4)
        if local.suffix == ".zip":
            with zipfile.ZipFile(local) as z:
                for info in z.infolist():
                    name = info.filename.replace("\\", "/")
                    if info.is_dir() or name.startswith("/") or ".." in name.split("/"):
                        continue
                    target = site / "x" / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(z.read(info))
    out = []
    for main in MU.find_main_files(site):
        conv = MU.convert_file(main, search_dirs=[main.parent, main.parent.parent])
        for part in conv.parts:
            for ch in (0, 1):
                ours = [n.pitch for n in sorted((n for n in part.notes if n.channel == ch),
                                                key=lambda n: (n.onset, n.pitch))]
                if ours and tracks:
                    out.append(round(max(recall(ours, t) for t in tracks), 4))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="use cached files only")
    args = ap.parse_args(argv)
    rows = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    cache: dict[str, list[list[int]]] = {}
    results = []
    for r in rows:
        mid = r.get("mutopia_id")
        res = {"piece_id": r["piece_id"], "mutopia_id": mid}
        if not mid:
            res["midi_status"] = "no mutopia id"
            results.append(res)
            continue
        if mid not in cache:
            try:
                files = midi_files_for(mid, args.offline)
                cache[mid] = [t for b in files.values() for t in midi_tracks(b)]
            except Exception as e:  # noqa: BLE001
                cache[mid] = []
                res["error"] = f"{type(e).__name__}: {e}"
        tracks = cache[mid]
        if not tracks:
            res["midi_status"] = "no midi"
            results.append(res)
            continue
        pig = read_pig(OUT / "FingeringFiles" / f"{r['piece_id']}-0_fingering.txt")
        for ch, name in ((0, "rh"), (1, "lh")):
            ours = [n.pitch for n in sorted((n for n in pig.notes if n.channel == ch),
                                            key=lambda n: (n.onset, n.pitch))]
            if not ours:
                res[f"midi_recall_{name}"] = None
                continue
            best = max((recall(ours, t) for t in tracks), default=0.0)
            res[f"midi_recall_{name}"] = round(best, 4)
        vals = [v for k, v in res.items() if k.startswith("midi_recall_") and v is not None]
        res["midi_status"] = "ok" if vals and min(vals) >= RECALL_OK else "mismatch"
        results.append(res)
        print(f"{r['piece_id']:22s} {res.get('midi_recall_rh')} {res.get('midi_recall_lh')} {res['midi_status']}",
              flush=True)

    # Mismatches: is the website MIDI simply older than the GitHub source? Convert the *website*
    # source of the piece (which the website MIDI was rendered from) and compare again.
    site_ok: dict[str, list] = {}
    for mid in sorted({x["mutopia_id"] for x in results if x.get("midi_status") == "mismatch"}):
        try:
            site_ok[mid] = website_version_recalls(mid, cache[mid], args.offline)
        except Exception as e:  # noqa: BLE001
            site_ok[mid] = [f"error: {type(e).__name__}: {e}"]
        print(f"website-version check {mid}: {site_ok[mid]}", flush=True)
    for x in results:
        if x.get("midi_status") == "mismatch":
            recs = [v for v in site_ok.get(x["mutopia_id"], []) if isinstance(v, (int, float))]
            if recs and min(recs) >= RECALL_OK:
                x["midi_status"] = "version_skew"
    by_id = {x["piece_id"]: x for x in results}
    for r in rows:
        x = by_id.get(r["piece_id"], {})
        r["midi_recall_rh"] = x.get("midi_recall_rh")
        r["midi_recall_lh"] = x.get("midi_recall_lh")
        r["midi_status"] = x.get("midi_status", "")
        if r["midi_status"] == "version_skew":
            r["issues"] = (r["issues"] + "; " if r["issues"] else "") + \
                ("website MIDI predates the GitHub source (the website source reproduces it); MIDI check "
                 "not applicable")
        # final status: LilyPond's own rendering is the strongest evidence. A part whose notes are
        # all found (in order, per hand) in the MIDI is "ok" unless its bar checks show more than
        # a couple of timing breaks; a MIDI mismatch is always "suspect"; without MIDI the
        # build's internal checks decide.
        breaks_ok = (not r["bar_checks"]) or r["bar_check_breaks"] <= max(2, int(0.05 * r["bar_checks"]))
        if r["midi_status"] in ("ok", "version_skew"):
            r["status"] = "ok" if breaks_ok else "suspect"
        elif r["midi_status"] == "mismatch":
            r["status"] = "suspect"
            r["issues"] = (r["issues"] + "; " if r["issues"] else "") + \
                f"MIDI recall {r['midi_recall_rh']}/{r['midi_recall_lh']} < {RECALL_OK}"
    (OUT / "manifest.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    with open(OUT / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    summ = {
        "parts": len(results),
        "with_midi": sum(1 for x in results if x.get("midi_status") in ("ok", "mismatch")),
        "midi_ok": sum(1 for x in results if x.get("midi_status") == "ok"),
        "midi_mismatch": sum(1 for x in results if x.get("midi_status") == "mismatch"),
        "midi_version_skew": sum(1 for x in results if x.get("midi_status") == "version_skew"),
        "website_version_checks": site_ok,
        "no_midi": sum(1 for x in results if x.get("midi_status") in ("no midi", "no mutopia id")),
        "recall_threshold": RECALL_OK,
        "parts_ok_after_midi_check": sum(1 for r in rows if r["status"] == "ok"),
        "fingered_notes_ok_after_midi_check": sum(r["n_fingered"] for r in rows if r["status"] == "ok"),
        "results": results,
    }
    dst = DATA / "reports" / "mutopia_midi_crosscheck.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(summ, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in summ.items() if k != "results"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
