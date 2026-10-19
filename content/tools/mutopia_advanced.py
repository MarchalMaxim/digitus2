"""The rule that releases held bulk Mutopia editions at level 6 under the relaxed gates.

The owner's decision (2026-10-19): Mutopia bulk editions that are concert-level (grade 6) and held only
for the span or lint gate may ship at grade 6 under the same relaxed gates and ceiling as the archive
(pdmx_advanced.py), with their flags recorded in `relaxedGates` and in their notes. Until then a Mutopia
piece was never shipped with a flag.

The archive's level-6 rule cannot place these editions: it needs the frozen heuristic's proposal of 4 or
5, and the heuristic, calibrated on the core 30, proposes 3 for much of the Baroque repertoire the bulk
lane already ships at 6 (the Art of Fugue, the Goldberg Variations). The lane's own placement is "a
conservative level 6 for a mature complete original" (content/tools/README.md, Mutopia expansions).
This rule states that placement for the held editions. A held edition ships at level 6 when all of
these hold:

1. It is concert repertoire: an original keyboard work, or a movement of one, from one of CONCERT's
   categories (CATEGORIES). Each of the 66 editions held only for the span or lint gate is placed by
   hand in CONCERT or in KEPT, with its category; tests/test_mutopia_advanced.py checks the partition.
   KEPT is everything else: chorale harmonisations, Satie (the owner's example of a non-advanced
   edition), teaching and children's collections, folk-dance settings, light contemporary originals,
   and reductions of operatic or orchestral music.
2. It is a whole piece, as in the archive rule: at least pdmx_advanced.MIN_SECONDS of music at its
   tempo (the gate's level features) and pdmx_advanced.MIN_NOTES notes.
3. It fails only the span check or the lint law gate, within the archive's ceiling
   (pdmx_advanced.within_ceiling), and passes every other gate. Both MIDI cross-checks (LilyPond 2.24
   and the published Mutopia MIDI) stay mandatory and exact.

The categories and the placement of each edition were fixed before any edition was rebuilt, so they do
not depend on the yield. gates.py checks conditions 1 to 3 for every Mutopia piece with `relaxedGates`.
"""

from __future__ import annotations

import pdmx_advanced

CATEGORIES = {
    # concert repertoire (condition 1)
    "prelude-fugue": "a prelude or fugue of the Baroque or Classical keyboard repertoire",
    "variations": "a variation of a concert variation set",
    "sonata-suite": "a movement of a sonata, suite or partita",
    "concert-piece": "a Romantic or later concert piece (prelude, intermezzo, waltz, consolation)",
    "rag": "a classic rag",
    # kept held
    "chorale": "a chorale harmonisation",
    "satie": "Satie: slow, sparse pieces whose flags come from the spacing, not from difficulty",
    "teaching": "a teaching or children's collection, or a sonatina",
    "folk-dance": "a folk-dance setting",
    "light-original": "a light contemporary original",
    "reduction": "a piano reduction of operatic or orchestral music",
}

CONCERT = {
    "bulk-bachjs-bwv1006a-bwv-1006a-4-bwv-1006a-4-ly": "sonata-suite",
    "bulk-bachjs-bwv1006a-bwv-1006a-5-bwv-1006a-5-ly": "sonata-suite",
    "bulk-bachjs-bwv847-fuga2-fuga2-ly": "prelude-fugue",
    "bulk-bachjs-bwv856-bwv856-fugue11-bwv856-fugue11-ly": "prelude-fugue",
    "bulk-bachjs-bwv861-bwv861-fuga16-bwv861-fuga16-ly": "prelude-fugue",
    "bulk-bachjs-bwv862-bach-fugue17-bach-fugue17-ly": "prelude-fugue",
    "bulk-bachjs-bwv865-bwv865-praeludium20-bwv865-praeludium20-ly": "prelude-fugue",
    "bulk-bachjs-bwv870-wtk2fuga1-wtk2fuga1-ly": "prelude-fugue",
    "bulk-bachjs-bwv870-wtk2prelude1-wtk2prelude1-ly": "prelude-fugue",
    "bulk-bachjs-bwv871-wtk2-fugue2-wtk2-fugue2-ly": "prelude-fugue",
    "bulk-bachjs-bwv952-fugue-c-major-fugue-c-major-ly": "prelude-fugue",
    "bulk-bachjs-bwv988-bwv-988-v01-bwv-988-v01-ly": "variations",
    "bulk-bachjs-bwv988-bwv-988-v04-bwv-988-v04-ly": "variations",
    "bulk-bachjs-bwv988-bwv-988-v06-bwv-988-v06-ly": "variations",
    "bulk-bachjs-bwv988-bwv-988-v12-bwv-988-v12-ly": "variations",
    "bulk-bachjs-bwv988-bwv-988-v15-bwv-988-v15-ly": "variations",
    "bulk-bachjs-bwv988-bwv-988-v21-bwv-988-v21-ly": "variations",
    "bulk-bachjs-bwv988-bwv-988-v22-bwv-988-v22-ly": "variations",
    "bulk-bachjs-bwv988-bwv-988-v24-bwv-988-v24-ly": "variations",
    "bulk-bachjs-bwv988-bwv-988-v30-bwv-988-v30-ly": "variations",
    "bulk-beethovenlv-o10-lvb-sonate-10no2-3-lvb-sonate-10no2-3-ly": "sonata-suite",
    "bulk-beethovenlv-o2-lvb-sonate-02no1-3-lvb-sonate-02no1-3-ly": "sonata-suite",
    "bulk-brahmsj-o118-intermezzo-intermezzo-ly": "concert-piece",
    "bulk-brahmsj-o39-waltz-op39-15-waltz-op39-15-ly": "concert-piece",
    "bulk-chopinff-o28-chop-28-11-chop-28-11-ly": "concert-piece",
    "bulk-chopinff-o28-chop-28-12-chop-28-12-ly": "concert-piece",
    "bulk-chopinff-o28-chop-28-14-chop-28-14-ly": "concert-piece",
    "bulk-chopinff-o28-chop-28-19-chop-28-19-ly": "concert-piece",
    "bulk-chopinff-o28-chop-28-20-chop-28-20-ly": "concert-piece",
    "bulk-chopinff-o28-chop-28-22-chop-28-22-ly": "concert-piece",
    "bulk-haydnfj-hob-xvi-27-hob-xvi-27-ii-menuet-trio-hob-xvi-27-ii-menuet-trio-ly": "sonata-suite",
    "bulk-haydnfj-hob-xvi-27-hob-xvi-27-iii-presto-hob-xvi-27-iii-presto-ly": "sonata-suite",
    "bulk-lisztf-s-172-liszt-consolation-no1-liszt-consolation-no1-ly": "concert-piece",
    "bulk-lisztf-s-172-liszt-consolation-no4-liszt-consolation-no4-ly": "concert-piece",
    "bulk-mozartwa-anh41-k375g-k375g-lys-k375g-ly": "prelude-fugue",
    "bulk-mozartwa-kv153-k153-k153-ly": "prelude-fugue",
    "bulk-mozartwa-kv154-k154-k154-ly": "prelude-fugue",
    "bulk-mozartwa-kv331-kv331-1-5-var4-kv331-1-5-var4-ly": "variations",
    "bulk-rachmaninoffs-o23-rach-prelude23-10-rach-prelude23-10-ly": "concert-piece",
    "bulk-scarlattid-ds-sonate-c-ds-sonate-c-ly": "sonata-suite",
    "bulk-scriabina-o16-scriabine-op16-no5-scriabine-op16-no5-ly": "concert-piece",
    "bulk-turpint-turpin-turpin-ly": "rag",
}

KEPT = {
    "bulk-bachjs-bwv259-bwv-259-bwv-259-ly": "chorale",
    "bulk-bachjs-bwv269-bwv-269-bwv-269-ly": "chorale",
    "bulk-bachjs-bwv347-bwv347-bwv347-ly": "chorale",
    "bulk-satiee-croquis-danse-danse-lys-danse-ly": "satie",
    "bulk-satiee-croquis-tyrolienne-tyrolienne-ly": "satie",
    "bulk-satiee-gnossienne-no-1-no-1-ly": "satie",
    "bulk-satiee-gnossienne-no-3-no-3-ly": "satie",
    "bulk-satiee-gymnopedie-2-gymnopedie-2-ly": "satie",
    "bulk-satiee-gymnopedie-3-gymnopedie-3-ly": "satie",
    "bulk-satiee-trois-valses-ses-jambes-ses-jambes-ly": "satie",
    "bulk-bendaja-benda-sonateg3-benda-sonateg3-ly": "teaching",
    "bulk-fischerjkf-fischer-eratopraeludium-fischer-eratopraeludium-ly": "teaching",
    "bulk-handelgf-hwv585-sonatina-in-b-flat-major-sonatina-in-b-flat-major-ly": "teaching",
    "bulk-schumannr-o15-schumannop15no03-schumannop15no03-ly": "teaching",
    "bulk-schumannr-o15-schumannop15no04-schumannop15no04-ly": "teaching",
    "bulk-traditional-traditioner-af-swenska-folk-dansar-3-15-traditioner-af-swenska-folk-dansar-3-15-ly": "folk-dance",
    "bulk-ilievgk-a-childs-wish-a-childs-wish-ly": "light-original",
    "bulk-kumarr-flat-flat-ly": "light-original",
    "bulk-kumarr-jeanne-jeanne-ly": "light-original",
    "bulk-kumarr-unfixed-unfixed-ly": "light-original",
    "bulk-kumarr-valse-valse-ly": "light-original",
    "bulk-spagnoletti-ladorset-ladorset-ly": "light-original",
    "bulk-bizetg-actii-actii-ly": "reduction",
    "bulk-verdig-traviata-preludio-traviata-preludio-ly": "reduction",
}

CONCERT_CATEGORIES = ("prelude-fugue", "variations", "sonata-suite", "concert-piece", "rag")


def whole_piece(seconds: float, notes: int) -> bool:
    """Condition 2: the archive rule's test for a whole piece rather than a fragment."""
    return seconds >= pdmx_advanced.MIN_SECONDS and notes >= pdmx_advanced.MIN_NOTES


def problems(slug: str, relaxed: dict, notes: int, seconds: float | None) -> list[str]:
    """Why a Mutopia piece with `relaxedGates` breaks this rule ([] when it keeps it). `notes` is the
    score's pitched-note count (the validator's stats), `seconds` the gate's level features."""
    out = []
    if slug not in CONCERT:
        out.append("relaxedGates on a Mutopia piece outside the concert list (mutopia_advanced.CONCERT)")
    if seconds is None or not whole_piece(seconds, notes):
        out.append(f"not a whole piece by the archive rule ({seconds} s, {notes} notes; at least "
                   f"{pdmx_advanced.MIN_SECONDS:.0f} s and {pdmx_advanced.MIN_NOTES} notes)")
    return out


def level_note(slug: str, proposal: int, seconds: float, notes: int) -> str:
    """The levelNote of an edition this rule places at 6."""
    return (f"Advanced by the Mutopia rule (mutopia_advanced.py): {CATEGORIES[CONCERT[slug]]}, a whole piece "
            f"({seconds:.0f} seconds, {notes} notes), released at level 6 under the relaxed gates. Frozen "
            f"heuristic proposes {proposal}. No syllabus placement is claimed.")


LEVEL_OVERRIDE = ("The core-30 heuristic has no level 6 and underrates this repertoire; the placement follows "
                  "the stated Mutopia rule (mutopia_advanced.py). No external syllabus claim is made.")
