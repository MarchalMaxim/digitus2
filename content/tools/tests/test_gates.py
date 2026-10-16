"""Every new library piece passes every gate (L1 plan, Review Focus 3 to 5)."""
from __future__ import annotations

import copy
import hashlib
from collections import Counter
import itertools
import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
import build  # noqa: E402

MANIFEST = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
VER = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
CAT = {p["slug"]: p for p in build.load_catalog()}
NEW = [e for e in MANIFEST if e["benchmarkSet"] is None]
MAX_NEW_BYTES = 700_000


@pytest.mark.parametrize("entry", NEW, ids=lambda e: e["slug"])
def test_new_piece_passes_every_gate(entry):
    slug, v, cat = entry["slug"], VER[entry["slug"]], CAT[entry["slug"]]
    assert v["ok"] is True and all(r["ok"] for r in v["validation"].values())
    st = v["stats"]
    assert st["xsdValid"] is True and st.get("verovioPages", 0) >= 1
    assert 21 <= st["pitchRange"][0] and st["pitchRange"][1] <= 108
    if cat["source"] == "own":
        assert v["melody"]["exact"] is True, v["melody"]
    elif cat["source"] == "pdmx":
        pass  # a MuseScore archive score has no Mutopia engraving to cross-check with LilyPond (gates.py)
    else:
        assert v["midiChecks"]["lilypond224Midi"]["exact"] is True
    relaxed = cat.get("relaxedGates")  # level 6 only (pdmx_advanced.py): the flags are recorded, not zero
    assert relaxed is None or entry["level"] == 6
    for profile in ("medium", "large"):
        want = relaxed["lint"][profile] if relaxed else 0
        assert v["lint"]["profiles"][profile]["errors"] == want, (profile, v["lint"]["profiles"][profile]["counts"])
    score = CONTENT / entry["files"]["score"]
    assert v["lint"]["scoreSha256"] == hashlib.sha256(score.read_bytes()).hexdigest(), "stale lint: run gates.py"
    for f in filter(None, entry["files"].values()):
        assert (CONTENT / f).stat().st_size <= MAX_NEW_BYTES, f
    proposal = v["levelProposal"]["level"]
    assert abs(proposal - entry["level"]) <= 1 or cat.get("levelOverride"), (proposal, entry["level"])
    if entry["source"]["license"].startswith("CC-BY"):
        src = entry["source"]
        assert src["typesetter"] and src["mutopiaId"] and src["licenseUrl"]
        assert_credited_in_rights(entry)


def rights_element(path: Path) -> str:
    """The text of the file's <identification><rights>, parsed independently of gates.py."""
    from lxml import etree  # noqa: PLC0415

    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    found = etree.parse(str(path), parser).findall("identification/rights")
    assert len(found) == 1, (path.name, len(found))
    return found[0].text or ""


def assert_credited_in_rights(entry: dict) -> None:
    """Typesetter, Mutopia id, licence and licence URL in the <rights> of the score and of its
    .fingered copy; a CC BY (not share-alike) engraving also says that attribution is required."""
    src = entry["source"]
    for f in filter(None, entry["files"].values()):
        rights = rights_element(CONTENT / f)
        for k in ("typesetter", "mutopiaId", "license", "licenseUrl"):
            assert src[k] and src[k] in rights, (f, k, rights)
        assert ("attribution required" in rights) == (not src["license"].startswith("CC-BY-SA")), (f, rights)


# Added after the L1 milestone review: the credit is read from <rights>, not the whole file, and the
# core CC BY-SA engravings are held to the same rule as the new ones (Review Focus 5).
@pytest.mark.parametrize("entry", [e for e in MANIFEST if e["source"]["license"].startswith("CC-BY")],
                         ids=lambda e: e["slug"])
def test_every_cc_engraving_is_credited_in_rights(entry):
    assert_credited_in_rights(entry)


def test_span_flags_only_on_core30_and_the_relaxed_level_6_pieces():
    core = {e["slug"] for e in MANIFEST if e["benchmarkSet"] == "core30"}
    relaxed = {s: p["relaxedGates"]["spans"] for s, p in CAT.items() if p.get("relaxedGates")}
    flags = Counter(f["piece"] for f in VER["spanFlags"])
    assert set(flags) <= core | set(relaxed)
    for slug, spans in relaxed.items():  # what the catalog recorded is what the span check finds
        assert flags.get(slug, 0) == spans, slug


# ---------------------------------------------------------------------------
# gates.py's own verdict (piece_problems) and selection, on copies of core pieces in a scratch
# content directory: the same rules as test_new_piece_passes_every_gate, so a piece gates.py
# passes is a piece this file passes.
# ---------------------------------------------------------------------------
import gates  # noqa: E402

OWN = next(e for e in MANIFEST if e["slug"] == "twinkle-twinkle-little-star")
CREDITED = next(e for e in MANIFEST if e["source"]["license"].startswith("CC-BY") and e["slug"] in CAT
                and CAT[e["slug"]]["source"] == "mutopia")


def _case(tmp_path: Path, entry: dict):
    """(entry as a new piece, a passing verification record, catalog piece, scratch content dir)."""
    content = tmp_path / "content"
    (content / "scores").mkdir(parents=True)
    for f in filter(None, entry["files"].values()):
        (content / f).write_bytes((CONTENT / f).read_bytes())
    score = content / entry["files"]["score"]
    record = copy.deepcopy(VER[entry["slug"]])
    record["levelProposal"] = {"features": {}, "score": 1.0, "level": entry["level"]}
    if CAT[entry["slug"]]["source"] == "own":
        record["melody"] = {"exact": True, "notes": 42, "compare": "exact", "reference": "https://example.org",
                            "firstDifference": None}
    record["lint"] = {"profiles": {p: {"notes": 64, "errors": 0, "warnings": 3, "counts": {"L07": 3}}
                                   for p in ("medium", "large")},
                      "scoreSha256": hashlib.sha256(score.read_bytes()).hexdigest(),
                      "engineSrcSha256": "0" * 64, "cli": "packages/engine/dist/cli/main.js"}
    return {**entry, "benchmarkSet": None}, record, dict(CAT[entry["slug"]]), content


def _problems(case, flagged=(), lint=True) -> list[str]:
    entry, record, piece, content = case
    return gates.piece_problems(entry, record, piece, set(flagged), lint=lint, content=content)


@pytest.mark.parametrize("which", [OWN, CREDITED], ids=["own", "credited-engraving"])
def test_verdict_passes_a_piece_that_keeps_every_gate(tmp_path, which):
    assert _problems(_case(tmp_path, which)) == []


def test_verdict_names_each_failed_gate(tmp_path):
    runs = itertools.count()

    def broken(change) -> list[str]:
        case = _case(tmp_path / str(next(runs)), OWN)
        change(*case)
        return _problems(case)

    assert any("validation" in p for p in broken(lambda e, r, c, d: r.update(ok=False)))
    assert any("XSD" in p for p in broken(lambda e, r, c, d: r["stats"].update(xsdValid=False)))
    assert any("verovio" in p for p in broken(lambda e, r, c, d: r["stats"].pop("verovioPages")))
    assert any("piano" in p for p in broken(lambda e, r, c, d: r["stats"].update(pitchRange=[20, 70])))
    assert any("melody" in p for p in broken(lambda e, r, c, d: r["melody"].update(
        exact=False, firstDifference={"index": 3, "got": 62, "expected": 64})))
    assert any("melody" in p for p in broken(lambda e, r, c, d: r.pop("melody")))
    assert any("large" in p for p in broken(lambda e, r, c, d: r["lint"]["profiles"]["large"].update(
        errors=2, counts={"L05": 2})))
    assert any("medium" in p for p in broken(lambda e, r, c, d: r["lint"]["profiles"]["medium"].update(errors=1)))
    assert any("stale" in p for p in broken(lambda e, r, c, d: r["lint"].update(scoreSha256="0" * 64)))
    assert any("lint" in p for p in broken(lambda e, r, c, d: r.pop("lint")))
    assert any("level" in p for p in broken(lambda e, r, c, d: r["levelProposal"].update(level=3)))
    assert any("level" in p for p in broken(lambda e, r, c, d: r.pop("levelProposal")))


def test_verdict_accepts_a_level_override(tmp_path):
    entry, record, piece, content = _case(tmp_path, OWN)
    record["levelProposal"]["level"] = entry["level"] + 2
    assert any("level" in p for p in gates.piece_problems(entry, record, piece, set(), content=content))
    piece["levelOverride"] = "held left-hand chords: the heuristic overrates them"
    assert gates.piece_problems(entry, record, piece, set(), content=content) == []


def test_verdict_span_flags_fail_a_piece(tmp_path):
    assert any("span" in p for p in _problems(_case(tmp_path, OWN), flagged={OWN["slug"]}))


def test_verdict_without_lint_skips_only_the_lint_gate(tmp_path):
    entry, record, piece, content = case = _case(tmp_path, OWN)
    record.pop("lint")
    assert _problems(case, lint=False) == []
    record["melody"]["exact"] = False
    assert any("melody" in p for p in _problems(case, lint=False))


def test_verdict_size_limit(tmp_path, monkeypatch):
    case = _case(tmp_path, OWN)
    monkeypatch.setattr(gates, "MAX_NEW_BYTES", 1000)
    assert any("bytes" in p for p in _problems(case))


def test_verdict_engraving_checks(tmp_path):
    case = _case(tmp_path / "midi", CREDITED)
    case[1]["midiChecks"]["lilypond224Midi"]["exact"] = False
    assert any("MIDI" in p for p in _problems(case))
    case = _case(tmp_path / "credit", CREDITED)
    score = case[3] / CREDITED["files"]["score"]
    text = score.read_text(encoding="utf-8").replace(CREDITED["source"]["typesetter"], "someone")
    score.write_bytes(text.encode("utf-8"))
    case[1]["lint"]["scoreSha256"] = hashlib.sha256(score.read_bytes()).hexdigest()
    assert any("credit" in p for p in _problems(case))
    case = _case(tmp_path / "url", CREDITED)
    case[0]["source"] = {**CREDITED["source"], "licenseUrl": None}
    assert any("credit" in p for p in _problems(case))


def test_selection():
    core = [e for e in MANIFEST if e["benchmarkSet"] == "core30"]
    assert gates.select(core, new=True) == []
    assert gates.select(core) == core
    picked = gates.select(core, only=[core[3]["slug"], core[0]["slug"]])
    assert [e["slug"] for e in picked] == [core[0]["slug"], core[3]["slug"]], "manifest order"
    with pytest.raises(SystemExit, match="not in the manifest"):
        gates.select(core, only=["no-such-piece"])


def test_cli_needs_a_selection():
    with pytest.raises(SystemExit) as exc:
        gates.main([])
    assert exc.value.code == 2
