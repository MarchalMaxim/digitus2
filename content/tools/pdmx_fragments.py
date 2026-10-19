"""Turn the PDMX gate results into catalog fragments: content/tools/catalog.d/pdmx-library.json and its siblings.

Every candidate that passed `pdmx_gate.py` becomes a piece (source 'pdmx'): its slug, title and
composer come from the archive's metadata (cleaned), its level is the frozen heuristic's proposal,
its tempo is the file's own <sound tempo> or 100 quarter notes per minute, and its notes say how
it was screened. Candidates that failed are kept in `rejected` with their first reason, as every
fragment does. A title or composer with a replacement character (a broken encoding in the
archive's metadata) is rejected rather than shipped with a wrong name.

The licence comes from PDMX.csv (`license`: publicdomain or cc-zero). Only the two values the
archive uses are accepted.

Two lanes. The classical lane (candidates.json: genres classical, folk, religious or unlabelled) gives
`pdmx-library.json` (capped) and `pdmx-advanced.json` (level 6 by the rule in pdmx_advanced.py). The songs
lane gives `pdmx-songs.json` (capped on its own, so it never takes a place from the classical lane) and
`pdmx-songs-advanced.json` (level 6 by the same rule): every candidate in candidates-other.json
(pdmx_songs.py), and any candidate of candidates.json whose genre tags are outside the classical lane (a
reinstated pop or soundtrack score). Both lanes take the level-6 rule and its relaxed gates
(pdmx_advanced.usable); a level-6 song keeps its Songs or Modern collection, so it shows on that shelf.

The caps hold levels 1 to 4 only: a piece at level 5 or 6 (the app's Challenging) ships whenever it passes,
because the library is short of hard pieces (the owner, 2026-10-19: "add as many advanced scores as possible").
Within a cap, a piece the fragments already ship keeps its place (its link keeps working), and the best-rated
new candidates take the places left, so a larger pool never pushes a shipped piece out.

Candidates in `pdmx-excluded.json` (build failures, duplicates from dedupe.py, out of scope) are skipped.

    content/.venv/Scripts/python.exe -I content/tools/pdmx_fragments.py
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pdmx_advanced  # noqa: E402
import pdmx_repair  # noqa: E402
import pdmx_select  # noqa: E402

CONTENT = HERE.parent
RAW = CONTENT / "_raw" / "pdmx"
FRAGMENT = HERE / "catalog.d" / "pdmx-library.json"
ADVANCED_FRAGMENT = HERE / "catalog.d" / "pdmx-advanced.json"
SONGS_FRAGMENT = HERE / "catalog.d" / "pdmx-songs.json"
SONGS_ADVANCED_FRAGMENT = HERE / "catalog.d" / "pdmx-songs-advanced.json"
EXCLUDED = HERE / "pdmx-excluded.json"  # committed: build failures and duplicates (see _comment)
PDMX_CSV = CONTENT.parent / "research" / "data" / "_downloads" / "pdmx" / "PDMX.csv"
TASK = 300  # the fragment's task number (catalog.d files carry the plan task that owns them)
ADVANCED_TASK = 301
SONGS_TASK = 302
SONGS_ADVANCED_TASK = 303
LIMIT = 1300  # the library ships this many passing candidates at levels 1 to 4 that build; the rest stay recorded
SONGS_LIMIT = 1000  # the songs lane's own cap (by rating), so it never takes a place from the classical lane
UNCAPPED_LEVEL = 5  # from this level up (the app's Challenging) every passing piece ships: the caps hold levels 1 to 4
CLASSICAL_LANE_TAGS = {"classical", "folk", "religiousmusic", "NA"}
JAZZ_TAGS = {"jazz", "blues"}

TRADITIONAL_NAMED = re.compile(r"^(trad\.?|traditional|tradicional|anon\.?|anonymous|anonimo|anónimo)$", re.I)
ANONYMOUS = re.compile(r"^(anon\.?|anonymous|anonimo|anónimo)$", re.I)
PAREN_YEARS = re.compile(r"\s*\(\s*(?:c\.|ca\.)?\s*\d{3,4}\s*(?:[-–—]\s*)?\d{0,4}\s*\)")
# Broken text in the archive's metadata: the replacement character, or UTF-8 read as Latin-1 or cp1252
# (a Cyrillic title that reads as "Ð..." and "Ã..."). A title or composer like that is not shipped.
BROKEN_TEXT = re.compile(
    "�|[ÂÃÐÑ][\u0080-¿Œ-žƒˆ˜–-›€™]"
)
COLLECTION_BY_GENRE = {"folk": "pdmx-folk", "classical": "pdmx-classical", "religiousmusic": "pdmx-classical"}


def ascii_slug(text: str, limit: int = 40) -> str:
    folded = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return folded[:limit].strip("-") or "untitled"


def clean_title(title: str) -> str:
    return re.sub(r"\s+", " ", title or "").strip()


def clean_composer(name: str) -> str:
    name = re.sub(r"\s+", " ", name or "").strip()
    if TRADITIONAL_NAMED.match(name):
        return "Anonymous" if ANONYMOUS.match(name) else "Traditional"
    if not pdmx_select.composer_ok(name):
        return "Unknown"
    return PAREN_YEARS.sub("", name).strip()


def collection_for(genres: str) -> str:
    tokens = [t for t in (genres or "").split("-") if t]
    if tokens and all(t == "folk" for t in tokens):
        return COLLECTION_BY_GENRE["folk"]
    return COLLECTION_BY_GENRE["classical"]


def song_collection(genres: str) -> str:
    """The songs lane's collection: jazz and blues go to the Modern genre, everything else to Songs."""
    tokens = {t for t in (genres or "").split("-") if t}
    return "pdmx-modern" if tokens & JAZZ_TAGS else "pdmx-songs"


def in_songs_lane(cand: dict, from_other_file: bool) -> bool:
    """True for a song (candidates-other.json) and for a candidate whose genre tags leave the classical lane."""
    if from_other_file:
        return True
    tokens = {t for t in (cand.get("genres") or "").split("-") if t} or {"NA"}
    return not tokens <= CLASSICAL_LANE_TAGS


def licence_map(paths: set[str]) -> dict[str, str]:
    """PDMX `mxl` path -> the licence field, for the candidates only."""
    csv.field_size_limit(10**9)
    out: dict[str, str] = {}
    with PDMX_CSV.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["mxl"] in paths:
                out[row["mxl"]] = row["license"]
    return out


def measured_gate(gate: dict, slug: str, verification: dict) -> dict:
    """A repaired piece's gate record with the engine's own counts on the score the library ships (issue #80). A
    repair changes a few notes, so the counts recorded for the refused original no longer describe the shipped score.
    Other pieces keep their records; a repaired piece with no measurement yet keeps its own until gates.py measures it."""
    if gate["sha256"] not in pdmx_repair.pinned_repairs():
        return gate
    profiles = ((verification.get(slug) or {}).get("lint") or {}).get("profiles")
    if not profiles:
        return gate
    measured = dict(gate)
    measured["spanFlags"] = sum(1 for flag in verification.get("spanFlags") or [] if flag.get("piece") == slug)
    measured["lint"] = {p: {"notes": profiles[p]["notes"], "errors": profiles[p]["errors"],
                            "warnings": profiles[p]["warnings"]} for p in ("medium", "large")}
    return measured


def piece_for(gate: dict, cand: dict, licence: str, demands: list[str] | None = None,
              relaxed_gates: dict | None = None) -> dict:
    sha = gate["sha256"]
    title = clean_title(cand.get("title"))
    composer = clean_composer(cand.get("composer"))
    slug = f"pdmx-{ascii_slug(title)}-{sha[:8]}"
    level = gate["level"]["level"]
    score = gate["level"]["score"]
    tempo = round(float(gate["tempo"]))
    if gate.get("tempoFromFile"):
        tempo_source = "The MuseScore file's own tempo mark (<sound tempo>)."
    else:
        tempo_source = ("editorial: the file gives no tempo, so 100 quarter notes per minute is a "
                        "playback default.")
    declared = "public domain" if licence == "publicdomain" else "CC0"
    fingerings = cand.get("fingerings") or 0
    piece = {
        "slug": slug,
        "source": "pdmx",
        "level": 6 if demands else level,
        "collection": "pdmx-advanced" if demands else collection_for(cand.get("genres")),
        "title": title,
        "composer": composer,
        "composerDates": None,
        "catalogue": None,
        "year": None,
        "tempoBpm": tempo,
        "tempoSource": tempo_source,
        "levelNote": (f"No syllabus placement is claimed. The frozen level heuristic proposes {level} "
                      f"(score {score})."),
        "notes": (f"Solo piano score from the PDMX archive of MuseScore files. The uploader declared it "
                  f"{declared}, and PDMX found no licence conflict. Screened automatically: one sounding "
                  f"part, one or two staves, MusicXML {cand.get('version')} schema valid, no slice that one "
                  f"hand cannot strike, and zero lint law errors at the medium and large profiles. Not "
                  f"reviewed by eye. Source fingerings: {fingerings}"
                  f"{' (removed from the stored file: the app fingers every score itself)' if fingerings else ''}."),
        "pdmx": {"sha256": sha, "path": cand["path"], "license": licence, "rating": cand.get("rating"),
                 "nRatings": cand.get("n_ratings"), "fingerings": fingerings, "version": cand.get("version")},
    }
    if relaxed_gates:
        # the span and lint gates are relaxed for level 6 (pdmx_advanced.py): the flags are recorded, not hidden
        piece["relaxedGates"] = relaxed_gates
        piece["notes"] = piece["notes"].replace(
            "no slice that one hand cannot strike, and zero lint law errors at the medium and large profiles.",
            f"and, because the span and lint gates are relaxed for level 6, "
            f"{pdmx_advanced.relaxed_sentence(relaxed_gates)}: the digits there are advice.")
    repair = pdmx_repair.pinned_repairs().get(sha)
    if repair:
        piece["notes"] += (f" The archive file was repaired for the library: {repair['reason']} Each change is at "
                           "most 1/32 of a quarter; no pitch, voice or staff changed, and the repaired score passes "
                           "the validator (content/tools/pdmx_repair.py).")
    if demands:
        piece["levelNote"] = pdmx_advanced.override_reason(gate["level"], demands)
        if level < 5:  # two levels above the proposal: the catalog wants the reason as an override
            piece["levelOverride"] = (f"The heuristic proposes {level}, which has no level 6; the archive's advanced "
                                      f"rule places it at 6. {'; '.join(demands)}.")
    return piece


def shipped_names() -> dict[str, tuple[str, str]]:
    """slug -> (title, composer) of every piece the archive fragments ship now.

    The catalog is the authority for a shipped piece's name: titles and composers were repaired in the
    fragments by hand (titles.py, docs/reviews/library-titles-2026-10-18.md), and a rerun of this script
    must not put the archive's damaged text back."""
    out: dict[str, tuple[str, str]] = {}
    for path in (FRAGMENT, ADVANCED_FRAGMENT, SONGS_FRAGMENT, SONGS_ADVANCED_FRAGMENT):
        if path.exists():
            for p in json.loads(path.read_text(encoding="utf-8")).get("pieces", []):
                out[p["slug"]] = (p["title"], p["composer"])
    return out


def repaired_names(piece: dict) -> tuple[str, str] | None:
    """The title and composer of a new piece with the damaged stretches put back from its own score's text
    (titles.repaired), or None when damage is left that the score cannot repair (titles.RESIDUE)."""
    import titles

    fields = [piece["title"], piece["composer"]]
    if not all(f.isascii() for f in fields):
        sha = piece["pdmx"]["sha256"]
        plain = CONTENT / "_build" / "pdmx" / sha / f"{sha}.musicxml"
        texts = titles.xml_texts(plain) if plain.exists() else []
        fields = [titles.repaired(f, texts) if not f.isascii() else f for f in fields]
    if any(titles.RESIDUE.search(f) for f in fields):
        return None
    return fields[0], fields[1]


def record_failures(log: Path) -> int:
    """Add the pieces a `build.py --source pdmx` log reports as refused to pdmx-excluded.json.

    Returns how many were new. A piece the validator refuses is refused every time, so the next
    fragment run skips it and takes the next candidate in rating order."""
    excluded = json.loads(EXCLUDED.read_text(encoding="utf-8"))
    known = excluded["buildFailed"]
    added = 0
    for block in re.split(r"^== ", log.read_text(encoding="utf-8", errors="replace"), flags=re.M)[1:]:
        slug = block.split("\n", 1)[0].strip()
        if "BUILD FAILED" in block:
            error = block.split("BUILD FAILED:", 1)[1].strip()[:200]
        elif re.search(r"validate \S+\.musicxml: FAIL", block):
            errors = re.findall(r"error: (.*)", block)
            error = errors[0] if errors else "failed validation"
        else:
            continue
        if slug not in known:
            known[slug] = error
            added += 1
    excluded["buildFailed"] = dict(sorted(known.items()))
    EXCLUDED.write_text(json.dumps(excluded, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return added


def _recheck_one(job: tuple[str, str, str, int]) -> tuple[str, str | None]:
    """(slug, None when the build's own check passes now, else its first error)."""
    import tempfile

    import build  # the build's own strip and check, so this cannot disagree with it

    slug, sha, licence, tempo = job
    piece = {"slug": slug, "pdmx": {"sha256": sha, "license": licence, "fingerings": 0}, "tempoBpm": tempo}
    try:
        with tempfile.TemporaryDirectory() as tmp:
            entry = build.build_pdmx(piece, Path(tmp))
    except Exception as exc:  # noqa: BLE001 - a piece the build cannot even open stays refused
        return slug, f"{type(exc).__name__}: {str(exc)[:160]}"
    if entry["files"]:
        return slug, None
    errors = entry["checks"]["errors"]
    return slug, errors[0] if errors else "failed validation"


def recheck_failures(workers: int = 6) -> tuple[int, int]:
    """Run every recorded build failure through the build's check again; drop those that pass now.

    The record keeps a refusal forever (a validator refuses the same file every time), so when the build
    or the validator changes, the record must be re-judged by the same code, not by matching its reasons.
    Returns (released, still refused). A failure whose candidate is no longer in the pool stays recorded."""
    from multiprocessing import Pool

    excluded = json.loads(EXCLUDED.read_text(encoding="utf-8"))
    known = excluded["buildFailed"]
    entries, _ = load_pool()
    wanted = []
    for gate, cand, _songs in entries:
        slug = f"pdmx-{ascii_slug(clean_title(cand.get('title')))}-{gate['sha256'][:8]}"
        if slug in known:
            wanted.append((slug, gate, cand))
    licences = licence_map({cand["path"] for _, _, cand in wanted})
    jobs = [(slug, gate["sha256"], licences.get(cand["path"]), round(float(gate["tempo"])))
            for slug, gate, cand in wanted if licences.get(cand["path"]) in ("publicdomain", "cc-zero")]
    released = 0
    with Pool(workers) as pool:
        for n, (slug, error) in enumerate(pool.imap_unordered(_recheck_one, jobs, chunksize=1), 1):
            if error is None:
                del known[slug]
                released += 1
            else:
                known[slug] = error[:200]
            if n % 50 == 0:
                print(f"  rechecked {n}/{len(jobs)}, released {released}", flush=True)
    excluded["buildFailed"] = dict(sorted(known.items()))
    EXCLUDED.write_text(json.dumps(excluded, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return released, len(known)


def load_pool() -> tuple[list[tuple[dict, dict, bool]], dict[str, dict]]:
    """Every gated candidate as (gate, candidate, songs lane), most rated first, and the candidate records."""
    candidates = {c["sha256"]: c for c in json.loads((RAW / "candidates.json").read_text(encoding="utf-8"))}
    other: dict[str, dict] = {}
    if (RAW / "candidates-other.json").exists():
        other = {c["sha256"]: c for c in json.loads((RAW / "candidates-other.json").read_text(encoding="utf-8"))}
    entries: list[tuple[dict, dict, bool]] = []
    for gate in (json.loads(line) for line in (RAW / "gate.jsonl").open(encoding="utf-8")):
        if gate["sha256"] in candidates:  # a superseded representative of a title is skipped
            cand = candidates[gate["sha256"]]
            entries.append((gate, cand, in_songs_lane(cand, False)))
    if (RAW / "gate-other.jsonl").exists():
        for gate in (json.loads(line) for line in (RAW / "gate-other.jsonl").open(encoding="utf-8")):
            if gate["sha256"] in other:
                entries.append((gate, other[gate["sha256"]], True))
    # the same order the gate ran in: the most rated candidates first
    entries.sort(key=lambda e: (-int(e[1].get("n_ratings") or 0), -float(e[1].get("rating") or 0), e[0]["sha256"]))
    return entries, {**candidates, **other}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--record-failures", type=Path, metavar="LOG",
                    help="first add the pieces refused in this build.py log to pdmx-excluded.json")
    ap.add_argument("--recheck-failures", action="store_true",
                    help="first re-run every recorded build failure through the build's check and release those that pass")
    ap.add_argument("--limit", type=int, default=LIMIT,
                    help="ship at most this many ordinary passing candidates, best rated first (default %(default)s)")
    ap.add_argument("--songs-limit", type=int, default=SONGS_LIMIT,
                    help="ship at most this many songs, best rated first (default %(default)s)")
    a = ap.parse_args(argv)
    if a.record_failures:
        print(f"recorded {record_failures(a.record_failures)} new build failures")
    if a.recheck_failures:
        released, still = recheck_failures()
        print(f"rechecked the build failures: {released} released, {still} still refused")
    entries, candidates = load_pool()
    licences = licence_map({c["path"] for c in candidates.values()})
    # Candidates that must not ship. A build failure (verification.json ok false, or pdmx-excluded.json)
    # is kept in `rejected` with the first error, and the cap counts only the others: merge_results drops
    # the record of a piece that has left the catalog, so verification.json alone would forget it and the
    # cap would admit it again. A duplicate (dedupe.py) is dropped for the copy that stays.
    verification = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
    build_failed = {slug: rec for slug, rec in verification.items()
                    if slug.startswith("pdmx-") and isinstance(rec, dict) and rec.get("ok") is False}
    excluded = json.loads(EXCLUDED.read_text(encoding="utf-8"))
    for slug, error in excluded["buildFailed"].items():
        build_failed.setdefault(slug, {"validation": {"": {"errors": [error]}}})
    duplicates = excluded.get("duplicates", {})
    out_of_scope = excluded.get("outOfScope", {})  # pdmx_scope.py and pdmx_songs.py: the review's exclusions
    names_now = shipped_names()  # read before any fragment is written
    caps = {"classical": a.limit, "songs": a.songs_limit}
    eligible: list[tuple[str, dict, bool, bool]] = []  # (lane, piece, advanced, within a cap), in rating order
    pieces: dict[str, list[dict]] = {"classical": [], "songs": []}
    rejected: dict[str, list[dict]] = {"classical": [], "songs": []}  # only what the build refused
    advanced: dict[str, list[dict]] = {"classical": [], "songs": []}
    not_shipped = {lane: {"gates": 0, "duplicates": 0, "out of scope": 0, "beyond the cap": 0}
                   for lane in ("classical", "songs")}
    seen_slugs: set[str] = set()
    for gate, cand, songs in entries:
        lane = "songs" if songs else "classical"
        counts = not_shipped[lane]
        title = clean_title(cand.get("title"))
        slug = f"pdmx-{ascii_slug(title)}-{gate['sha256'][:8]}"  # the slug it would have had
        if slug in build_failed:
            first = (build_failed[slug].get("validation") or {})
            errors = [e for v in first.values() for e in (v.get("errors") or [])]
            rejected[lane].append({"slug": slug, "sha256": gate["sha256"], "title": title,
                                   "reason": "failed the library's validation: " + (errors[0] if errors else "see verification")})
            continue
        gate = measured_gate(gate, slug, verification)
        req = pdmx_advanced.requested(cand.get("composer"))  # the owner's scoped relaxation (issue #80)
        # A candidate that passed every gate, or a level-6 piece that passes the relaxed gates (pdmx_advanced.usable).
        if not pdmx_advanced.usable(gate, cand["notes"], requested=req):
            counts["gates"] += 1
            continue
        if BROKEN_TEXT.search(title) or BROKEN_TEXT.search(cand.get("composer") or ""):
            rejected[lane].append({"slug": slug, "sha256": gate["sha256"], "title": title,
                                   "reason": "the archive's title or composer is broken text (replacement characters or mis-decoded)"})
            continue
        if not pdmx_select.grand_staff(cand):
            rejected[lane].append({"slug": slug, "sha256": gate["sha256"], "title": title,
                                   "reason": "one staff: the library needs a grand staff (two staves)"})
            continue
        if gate["sha256"] in duplicates or slug in duplicates:
            counts["duplicates"] += 1
            continue
        if gate["sha256"] in out_of_scope:
            counts["out of scope"] += 1
            continue
        licence = licences.get(cand["path"])
        if licence not in ("publicdomain", "cc-zero"):
            rejected[lane].append({"slug": slug, "sha256": gate["sha256"], "title": title, "reason": f"licence {licence!r}"})
            continue
        demands = pdmx_advanced.advanced(gate["level"], cand["notes"], requested=req)
        relaxed_gates = None if gate["ok"] else pdmx_advanced.relaxed_facts(gate)
        piece = piece_for(gate, cand, licence, demands, relaxed_gates)
        if songs:
            piece["collection"] = song_collection(cand.get("genres"))
        if piece["slug"] in seen_slugs:  # the sha prefix makes this practically impossible; keep it honest
            raise SystemExit(f"duplicate slug {piece['slug']}")
        seen_slugs.add(piece["slug"])
        eligible.append((lane, piece, bool(demands), not demands and gate["level"]["level"] < UNCAPPED_LEVEL))
    # The caps hold levels 1 to 4. A piece the fragments ship now keeps its place, so its link and the reader's
    # settings for it keep working; the places left go to the best-rated new candidates (the order of `entries`).
    free = {lane: caps[lane] - sum(1 for e_lane, piece, _, in_cap in eligible
                                   if e_lane == lane and in_cap and piece["slug"] in names_now) for lane in caps}
    for lane, piece, is_advanced, in_cap in eligible:
        new = piece["slug"] not in names_now
        if in_cap and new and free[lane] <= 0:
            not_shipped[lane]["beyond the cap"] += 1
            continue
        names = names_now.get(piece["slug"]) or repaired_names(piece)
        if names is None:
            rejected[lane].append({"slug": piece["slug"], "sha256": piece["pdmx"]["sha256"], "title": piece["title"],
                                   "reason": "the archive's title or composer is damaged text that its own score cannot repair"})
            continue
        piece["title"], piece["composer"] = names
        free[lane] -= in_cap and new
        (advanced[lane] if is_advanced else pieces[lane]).append(piece)
    for lane in pieces:
        pieces[lane].sort(key=lambda p: (p["level"], p["collection"], p["slug"]))
        advanced[lane].sort(key=lambda p: p["slug"])
    notes_gates = ("one staff, a lint law error, an unplayable slice or an XSD error")
    classical_not = not_shipped["classical"]
    write_fragment(FRAGMENT, TASK, pieces["classical"], rejected["classical"], (
        "MuseScore archive pieces (PDMX, Long et al. 2025, https://zenodo.org/records/15571083): public domain "
        "or CC0 as declared by the uploader, with no licence conflict. Chosen and gated by "
        "content/tools/pdmx_select.py, pdmx_gate.py and pdmx_fragments.py; the notes say what was checked. No "
        "individual engraving review: the gates are the review. Not shipped: "
        f"{classical_not['gates']} failed a gate ({notes_gates}), {classical_not['duplicates']} duplicates of "
        f"another piece (dedupe.py), {classical_not['out of scope']} out of scope (pdmx_scope.py), "
        f"{classical_not['beyond the cap']} passed but ranked beyond the cap of "
        f"{a.limit} pieces at levels 1 to 4 (by rating; level 5 is not capped). Their reasons are in "
        "content/_raw/pdmx/gate.jsonl, which is not committed; `rejected` lists only the candidates the build refused."))
    advanced_rule = (
        "placed at level 6 (Advanced) by the rule in content/tools/pdmx_advanced.py, which the frozen heuristic "
        "cannot do (it has no level 6). The rule's thresholds were fixed before the yield was known. A piece passed "
        "every gate, or it passed every gate but the span check and the lint law gate, which are relaxed for level 6 "
        "within a ceiling: its flags are recorded in `relaxedGates` and in its notes. Pieces are not capped.")
    write_fragment(ADVANCED_FRAGMENT, ADVANCED_TASK, advanced["classical"], [], (
        "MuseScore archive pieces of the classical lane (pdmx-library.json) " + advanced_rule))
    songs_not = not_shipped["songs"]
    songs_scope = (
        "solo piano scores outside classical, folk and religious music (pop, rock, soundtrack, jazz, and unlabelled "
        "scores by composers outside the classical list) that the uploader declared public domain or CC0 with no "
        "licence conflict. The user's broad copyright reading (2026-10-16): no check of the author's date, so a "
        "modern arrangement that the declaration does not cover is a risk the repository carries. Chosen by "
        "content/tools/pdmx_songs.py; two removal-only lenses (junk, content safety) took out the flagged ones. "
        "Not reviewed by eye.")
    write_fragment(SONGS_FRAGMENT, SONGS_TASK, pieces["songs"], rejected["songs"], (
        "MuseScore archive songs (PDMX): " + songs_scope + " Every gate passed, and the frozen heuristic places each "
        f"song. Capped at {a.songs_limit} pieces at levels 1 to 4 by rating (level 5 is not capped; level 6 is "
        f"pdmx-songs-advanced.json). Not shipped: {songs_not['gates']} failed a gate, {songs_not['duplicates']} "
        f"duplicates (dedupe.py), {songs_not['out of scope']} out of scope, {songs_not['beyond the cap']} beyond the cap."))
    write_fragment(SONGS_ADVANCED_FRAGMENT, SONGS_ADVANCED_TASK, advanced["songs"], [], (
        "MuseScore archive songs of the songs lane (pdmx-songs.json): " + songs_scope + " Each was " + advanced_rule +
        " A song keeps its Songs or Modern collection, so it shows on that shelf at the Challenging level."))
    levels = {lvl: sum(1 for p in pieces["classical"] if p["level"] == lvl) for lvl in range(1, 7)}
    songs_levels = {lvl: sum(1 for p in pieces["songs"] if p["level"] == lvl) for lvl in range(1, 7)}
    relaxed = {lane: sum(1 for p in advanced[lane] if p.get("relaxedGates")) for lane in advanced}
    print(f"classical {len(pieces['classical'])}, advanced {len(advanced['classical'])}, songs {len(pieces['songs'])}, "
          f"advanced songs {len(advanced['songs'])} (relaxed gates {relaxed}); not shipped {not_shipped}; "
          f"levels {levels}; song levels {songs_levels}")
    return 0


def write_fragment(path: Path, task: int, pieces: list[dict], rejected: list[dict], comment: str) -> None:
    fragment = {"task": task, "_comment": comment, "pieces": pieces, "rejected": rejected}
    path.write_text(json.dumps(fragment, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
