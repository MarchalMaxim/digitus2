"""Post-build gates of the built-in library (L1 plan, Task 7). Run after build.py.

    python -I content/tools/gates.py --only SLUG ...   # gate these pieces
    python -I content/tools/gates.py --new             # every piece outside the core30 benchmark set
    python -I content/tools/gates.py --all             # every manifest piece
    ... --no-lint                                      # skip the engine lint (the other gates still run)

Every check that build.py and validate.py do not already make:
  1. spans: check_spans.main([]) on the whole library, under the library lock: spanFlags in
     verification.json. A new piece must have no slice one hand cannot play.
  2. level: level.proposal() of each selected piece at its catalogue tempo. The final level
     (catalog `level`) must be within one of the proposal, or the catalog piece gives a
     `levelOverride` reason.
  3. melody, new own arrangements only: the top line of staff 1 of the built score against the
     reference in tools/arrangements/ (arrangements.melody_check, the rule of
     tests/test_arrangements.py). It must be exact.
  4. lint (unless --no-lint): lint_gate.gate(), the engine's own fingering at the medium and large
     profiles through packages/engine/dist/cli/main.js. A new piece must have zero law errors at
     both.
The results of 2 to 4 go into verification.json per piece (levelProposal, melody, lint) in one
jsonio.update_json() call; nothing time-dependent is written (hashes, not dates). The verdict of a
piece also requires what tests/test_gates.py asserts from the build: validation OK, XSD-valid,
rendered by verovio, every pitch on the piano, the LilyPond 2.24 MIDI check exact for an
engraving, every file at most 700 KB, and for a CC BY or CC BY-SA engraving the typesetter,
Mutopia id, licence and licence URL in the manifest and in the <rights> element of every file
(the score and its .fingered copy).

The table lists slug, level, proposal, MIDI or melody check, span-flagged slices, law errors at
medium and large, score bytes and the verdict. Core-30 pieces are reported (their failures as
"exempt") and never fail the run: their facts are pinned (L1 plan, Review Focus 1). The exit code
is 1 when a selected piece outside core30 fails a gate, else 0.
License: MIT.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import build  # noqa: E402
import check_spans  # noqa: E402
import jsonio  # noqa: E402
import level  # noqa: E402
import lint_gate  # noqa: E402
import mutopia_advanced  # noqa: E402
import pdmx_advanced  # noqa: E402

CONTENT = HERE.parent
MANIFEST = CONTENT / "manifest.json"
VERIFICATION = CONTENT / "verification.json"
CORE = "core30"
MAX_NEW_BYTES = 700_000
PIANO = (21, 108)
CREDIT_KEYS = ("typesetter", "mutopiaId", "license", "licenseUrl")  # in the <rights> of a CC engraving


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def is_core(entry: dict) -> bool:
    return entry.get("benchmarkSet") == CORE


def rights_of(path: Path) -> str | None:
    """The text of the file's single <identification><rights> element, or None when there is not
    exactly one. Parsed with lxml without DTD, entities or network, like validate.py."""
    from lxml import etree  # noqa: PLC0415 - only CC engravings need it

    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    found = etree.parse(str(path), parser).findall("identification/rights")
    return (found[0].text or "") if len(found) == 1 else None


def needs_melody(entry: dict, piece: dict) -> bool:
    """A new own arrangement: its melody is checked against its reference (the ten core
    arrangements have their reference melodies in tests/test_arrange.py instead)."""
    return piece.get("source") == "own" and not is_core(entry)


def select(manifest: list[dict], only: list[str] | None = None, new: bool = False) -> list[dict]:
    """The manifest entries to gate, in manifest order: `only` these slugs, the `new` pieces (no
    benchmark set), or all."""
    if only:
        known = {e["slug"] for e in manifest}
        unknown = [s for s in only if s not in known]
        if unknown:
            raise SystemExit(f"not in the manifest (build it first): {', '.join(unknown)}")
        wanted = set(only)
        return [e for e in manifest if e["slug"] in wanted]
    if new:
        return [e for e in manifest if e.get("benchmarkSet") is None]
    return list(manifest)


def piece_problems(entry: dict, record: dict, piece: dict, flagged: set[str], lint: bool = True,
                   content: Path = CONTENT) -> list[str]:
    """Every gate the piece fails, as sentences; [] when it passes them all.

    `entry` is the manifest entry, `record` its verification record (with levelProposal, melody and
    lint as gates.py writes them), `piece` its catalog piece, `flagged` the slugs with span flags.
    `lint=False` skips the lint gate (--no-lint). The same rules as tests/test_gates.py."""
    out: list[str] = []
    slug = entry["slug"]
    failed = [name for name, r in (record.get("validation") or {}).items() if not r.get("ok")]
    if record.get("ok") is not True or failed:
        out.append("validation failed" + (f": {', '.join(failed)}" if failed else "")
                   + (f" ({record['error']})" if record.get("error") else ""))
    st = record.get("stats") or {}
    if st.get("xsdValid") is not True:
        out.append("not valid against the MusicXML 4.0 XSD")
    if (st.get("verovioPages") or 0) < 1:
        out.append("verovio renders no page")
    pr = st.get("pitchRange")
    if not pr or pr[0] < PIANO[0] or pr[1] > PIANO[1]:
        out.append(f"pitch range {pr} is not on the piano ({PIANO[0]} to {PIANO[1]})")
    if piece.get("source") == "own":
        mel = record.get("melody")
        if mel is None:
            if needs_melody(entry, piece):
                out.append("no melody check: the piece needs a reference in tools/arrangements/")
        elif mel.get("exact") is not True:
            out.append(f"melody differs from the reference ({mel.get('compare')}): first difference "
                       f"{mel.get('firstDifference')}")
    elif piece.get("source") == "pdmx":
        # a MuseScore archive score (2026-10-16) has no Mutopia engraving to cross-check against
        # LilyPond: its MusicXML is the source, and the span, lint and XSD gates stand for it
        pass
    else:
        chk = (record.get("midiChecks") or {}).get("lilypond224Midi")
        if not chk:
            out.append("no LilyPond 2.24 MIDI check")
        elif chk.get("exact") is not True:
            out.append(f"LilyPond 2.24 MIDI check not exact (only in the MusicXML {chk.get('only_xml_count')}, "
                       f"only in the MIDI {chk.get('only_midi_count')})")
    # level 6 only: a piece admitted with its span and lint flags recorded, within the archive's ceiling
    # (pdmx_advanced.py); a Mutopia piece also keeps both MIDI checks and the Mutopia rule (mutopia_advanced.py)
    relaxed = piece.get("relaxedGates")
    if relaxed and entry["level"] != 6:
        out.append("relaxedGates is allowed for level 6 only")
    if relaxed:
        if (slug in flagged) != (relaxed["spans"] > 0):
            out.append(f"span flags differ from the catalog's relaxedGates ({relaxed['spans']} recorded)")
        notes = st.get("notes") or 0
        if not notes or not pdmx_advanced.within_ceiling(relaxed, notes):
            out.append(f"relaxedGates beyond the ceiling ({relaxed['spans']} slices, lint {relaxed['lint']} in "
                       f"{notes} notes; at most {pdmx_advanced.RELAXED_SPANS_PER_1000:g} and "
                       f"{pdmx_advanced.RELAXED_LINT_PER_1000:g} per 1,000)")
        if pdmx_advanced.relaxed_sentence(relaxed) not in (piece.get("notes") or ""):
            out.append("the notes do not state the relaxedGates flags")
        if piece.get("source") == "mutopia":
            published = (record.get("midiChecks") or {}).get("mutopiaMidi")
            if not published or published.get("exact") is not True:
                out.append("a relaxed Mutopia piece needs an exact published Mutopia MIDI check")
            seconds = ((record.get("levelProposal") or {}).get("features") or {}).get("seconds")
            out += mutopia_advanced.problems(slug, relaxed, notes, seconds)
    elif slug in flagged:
        out.append("span flags: a slice one hand cannot play (spanFlags in verification.json)")
    score = content / entry["files"]["score"]
    if lint:
        rec = record.get("lint")
        if not rec:
            out.append("no lint record")
        else:
            for profile in lint_gate.PROFILES:
                r = (rec.get("profiles") or {}).get(profile)
                if r is None:
                    out.append(f"no lint at the {profile} profile")
                elif relaxed:
                    if r.get("errors") != relaxed["lint"][profile]:
                        out.append(f"{r.get('errors')} lint law error(s) at the {profile} profile, the catalog's "
                                   f"relaxedGates records {relaxed['lint'][profile]}")
                elif r.get("errors"):
                    out.append(f"{r['errors']} lint law error(s) at the {profile} profile "
                               f"(rule counts, every severity: {r.get('counts')})")
            if rec.get("scoreSha256") != sha256(score):
                out.append("stale lint record: the score changed since it was linted; run gates.py again")
    for f in filter(None, entry["files"].values()):
        size = (content / f).stat().st_size
        if size > MAX_NEW_BYTES:
            out.append(f"{f}: {size} bytes > {MAX_NEW_BYTES}")
    proposal = (record.get("levelProposal") or {}).get("level")
    if proposal is None:
        out.append("no level proposal")
    elif abs(proposal - entry["level"]) > 1 and not piece.get("levelOverride"):
        out.append(f"level {entry['level']} is {abs(proposal - entry['level'])} from the heuristic's proposal "
                   f"{proposal}: the catalog piece needs a levelOverride reason")
    src = entry.get("source") or {}
    if str(src.get("license", "")).startswith("CC-BY"):
        missing = [k for k in ("typesetter", "mutopiaId", "licenseUrl") if not src.get(k)]
        if missing:
            out.append(f"credit incomplete in the manifest: no {', '.join(missing)}")
        for f in filter(None, entry["files"].values()):
            rights = rights_of(content / f)
            if rights is None:
                out.append(f"credit missing: {f} has no single <rights> element")
                continue
            absent = [k for k in CREDIT_KEYS if src.get(k) and src[k] not in rights]
            if absent:
                out.append(f"credit missing from the <rights> of {f}: {', '.join(absent)}")
    return out


def melody_record(slug: str, score: Path) -> dict | None:
    """arrangements.melody_check of a new own arrangement, or None when it has no reference."""
    import arrangements  # noqa: PLC0415 - only own pieces need it (it imports every collection module)

    try:
        return arrangements.melody_check(slug, score)
    except KeyError:
        return None


def check_cell(entry: dict, piece: dict, record: dict) -> str:
    if piece.get("source") == "own":
        mel = record.get("melody")
        return "-" if mel is None else "melody " + ("EXACT" if mel.get("exact") else "DIFF")
    chk = (record.get("midiChecks") or {}).get("lilypond224Midi")
    return "midi none" if not chk else "midi " + ("EXACT" if chk.get("exact") else "DIFF")


def errors_cell(record: dict, profile: str, lint: bool) -> str:
    r = ((record.get("lint") or {}).get("profiles") or {}).get(profile)
    return "-" if not lint or r is None else str(r.get("errors"))


def main(argv=None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--only", nargs="+", metavar="SLUG", help="gate these pieces")
    mode.add_argument("--new", action="store_true", help="gate every piece outside the core30 benchmark set")
    mode.add_argument("--all", action="store_true", help="gate every manifest piece")
    mode.add_argument("--pending", action="store_true",
                      help="gate the pieces outside core30 that have no lint record yet (a new batch)")
    ap.add_argument("--no-lint", action="store_true", help="skip the engine lint gate")
    a = ap.parse_args(argv)
    lint = not a.no_lint
    if lint:
        lint_gate.require_cli()  # fail before the span check, not after it
        if lint_gate.dist_is_older_than_src():
            print("warning: an engine source is newer than packages/engine/dist: the lint gate runs the built "
                  "engine, so rebuild it (pnpm --filter @digitus2/engine build) unless another task owns the build",
                  file=sys.stderr)

    selection = select(jsonio.read_json(MANIFEST, list), a.only, a.new)  # unknown slugs fail before any work
    if a.pending:
        recorded = jsonio.read_json(VERIFICATION, dict)
        selection = [e for e in selection if e.get("benchmarkSet") is None
                     and not (recorded.get(e["slug"]) or {}).get("lint")]

    print("== 1. span check (whole library)")
    check_spans.main([])

    if not selection:
        print("no pieces selected")
        return 0
    catalog = {p["slug"]: p for p in build.load_catalog()}
    stray = [e["slug"] for e in selection if e["slug"] not in catalog]
    if stray:
        raise SystemExit(f"in the manifest but not in the catalog (rebuild the manifest): {', '.join(stray)}")
    current = jsonio.read_json(VERIFICATION, dict)
    unbuilt = [e["slug"] for e in selection if not build.is_piece_record(current.get(e["slug"]))]
    if unbuilt:
        raise SystemExit(f"no verification record (build it first): {', '.join(unbuilt)}")
    slugs = [e["slug"] for e in selection]
    scores = {e["slug"]: CONTENT / e["files"]["score"] for e in selection}
    shas = {s: sha256(p) for s, p in scores.items()}

    print(f"== 2. level proposals ({len(slugs)} piece(s))")
    proposals = {e["slug"]: level.proposal(scores[e["slug"]], e["tempoBpm"]) for e in selection}
    melody_slugs = [e["slug"] for e in selection if needs_melody(e, catalog[e["slug"]])]
    print(f"== 3. melody check ({len(melody_slugs)} new own arrangement(s))")
    melodies = {s: melody_record(s, scores[s]) for s in melody_slugs}
    lints: dict[str, dict] = {}
    if lint:
        print(f"== 4. engine lint at {' and '.join(lint_gate.PROFILES)} ({len(slugs)} piece(s))")
        lints = lint_gate.gate(slugs)
    else:
        print("== 4. engine lint skipped (--no-lint)")

    snapshot: dict = {}

    def put(verification: dict) -> dict:
        missing = [s for s in slugs if not build.is_piece_record(verification.get(s))]
        if missing:
            raise SystemExit(f"no verification record (build it first): {', '.join(missing)}")
        changed = [s for s in slugs if sha256(scores[s]) != shas[s]]
        if changed:
            raise SystemExit(f"rebuilt while being gated, nothing written; run gates.py again: {', '.join(changed)}")
        for s in slugs:
            record = verification[s]
            record["levelProposal"] = proposals[s]
            if s in melodies:
                if melodies[s] is None:
                    record.pop("melody", None)
                else:
                    record["melody"] = melodies[s]
            if lint:
                record["lint"] = lints[s]
            snapshot[s] = copy.deepcopy(record)
        snapshot["spanFlags"] = copy.deepcopy(verification.get("spanFlags") or [])
        return verification

    jsonio.update_json(VERIFICATION, put)

    flags = Counter(f["piece"] for f in snapshot["spanFlags"])
    head = (f"{'slug':44} {'lvl':>3} {'prop':>4}  {'check':12} {'spans':>5} {'medium':>6} {'large':>6} "
            f"{'bytes':>8}  verdict")
    print(head)
    print("-" * len(head))
    failed_new, exempt = [], []
    for e in selection:
        s, piece, record = e["slug"], catalog[e["slug"]], snapshot[e["slug"]]
        problems = piece_problems(e, record, piece, set(flags), lint=lint)
        if is_core(e):
            verdict = "core30" + (" (exempt)" if problems else "")
            if problems:
                exempt.append((s, problems))
        else:
            verdict = "FAIL" if problems else "OK"
            if problems:
                failed_new.append((s, problems))
        print(f"{s[:44]:44} {e['level']:>3} {record['levelProposal']['level']:>4}  {check_cell(e, piece, record):12} "
              f"{flags.get(s, 0):>5} {errors_cell(record, 'medium', lint):>6} {errors_cell(record, 'large', lint):>6} "
              f"{scores[s].stat().st_size:>8}  {verdict}")
    for title, rows in (("FAILED (new pieces)", failed_new), ("exempt (core30, reported only)", exempt)):
        if rows:
            print(f"\n{title}:")
            for s, problems in rows:
                for p in problems:
                    print(f"  {s}: {p}")
    core = sum(1 for e in selection if is_core(e))
    new = len(selection) - core
    print(f"\n{len(selection)} piece(s) gated: {new} new ({new - len(failed_new)} OK, {len(failed_new)} failed), "
          f"{core} core30 ({len(exempt)} with exempt failures); wrote levelProposal"
          + (", melody" if melody_slugs else "") + (", lint" if lint else "")
          + f" to {VERIFICATION.relative_to(CONTENT.parent).as_posix()}")
    return 1 if failed_new else 0


if __name__ == "__main__":
    raise SystemExit(main())
