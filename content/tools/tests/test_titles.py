"""The garbled titles of the MuseScore archive pieces (found 2026-10-18): the rule that damaged them, and
the check that no title or composer in the catalog is still the damaged form of text its own score holds."""

from __future__ import annotations

import re
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
sys.path.insert(0, str(TOOLS))

import build  # noqa: E402
import titles  # noqa: E402


def test_the_damage_keeps_a_letter_that_cp1252_holds_and_strips_the_rest_to_its_lead_byte():
    assert titles.damage("Đếm sao - Piano") == "Äáºm sao - Piano"
    assert titles.damage("Rất hăng hái") == "Ráºt hÄng hái"
    assert titles.damage("Dvořák") == "DvoÅák"
    assert titles.damage("Jáchym Špaček") == "Jáchym ŠpaÄek"  # Š is in cp1252, č is not
    assert titles.damage("Bartók Béla") == "Bartók Béla"


def test_the_damage_drops_symbols_and_the_bytes_that_are_not_letters():
    assert titles.damage("n°20") == "n20"  # ° is in cp1252 but is not a letter or a digit
    assert titles.damage("周杰伦") == "åæä¼"
    assert titles.damage("🎹") == "ð¹"
    assert titles.damage("ローリンガール") == "ãã¼ãªã³ãã¼ã"
    assert titles.damage("Θούριος") == "ΘοÏριος"  # plain Greek letters stay, the accented one does not


def test_a_repair_is_the_text_of_the_score_that_damages_into_the_field():
    texts = ["Đếm sao", "VĂN CHUNG", "Béla Bartók"]
    assert titles.repaired("VÄN CHUNG", texts) == "VĂN CHUNG"
    assert titles.repaired("Äáºm sao - Piano", texts) == "Đếm sao - Piano"
    # Đ and đ damage alike: the text as the score writes it wins over its other cases
    assert titles.damage("Đ") == titles.damage("đ")
    assert titles.repaired("Äi", ["đi"]) == "đi"
    assert titles.repaired("Äi", ["Đi"]) == "Đi"
    assert titles.repaired("Bartók Béla", texts) == "Bartók Béla"
    # dropped symbols come back when the whole text of the score is the damaged field
    assert titles.repaired("Nocturne n20", ["Nocturne n°20"]) == "Nocturne n°20"
    # a part of a field with no trace of damage in it is left alone, a dropped symbol or not
    assert titles.repaired("Der Gott der Eisen wachsen ließ", ["Der Gott, der Eisen wachsen ließ"]) == (
        "Der Gott der Eisen wachsen ließ")
    assert titles.repaired("In der Halle des Bergkönigs - Grieg", ["In° der Halle des Bergkön°igs"]) == (
        "In der Halle des Bergkönigs - Grieg")


# What a letter damaged to its lead byte leaves behind: a lead letter of Latin-1 followed by something
# that is not part of a word, as in "Äáºm" or "ÃÏ". The titles of the library hold none.
RESIDUE = re.compile("[ÃÂÄÅÆÐÑØÙÎÏÕ×Ç][^a-zA-Z ]|[À-ÿ][\u0080-¿]|[¡-¿][À-ÿ]|[ÃÂÄÅÆÐÑØÙÎÏ]$")


def archive_pieces():
    return [p for p in build.load_catalog() if p["source"] == "pdmx"]


def test_no_title_or_composer_is_the_damaged_form_of_text_in_its_own_score():
    left = []
    for piece in archive_pieces():
        fields = {f: piece[f] for f in ("title", "composer") if not piece[f].isascii()}
        if not fields:
            continue
        texts = titles.xml_texts(CONTENT / "scores" / f"{piece['slug']}.musicxml.gz")
        left += [f"{piece['slug']} {f}: {v!r} is {titles.repaired(v, texts)!r}"
                 for f, v in fields.items() if titles.repaired(v, texts) != v]
    assert not left, "\n".join(left)


def test_no_title_or_composer_of_the_archive_shows_what_the_damage_leaves_behind():
    left = [f"{p['slug']} {f}: {p[f]!r}" for p in archive_pieces() for f in ("title", "composer")
            if RESIDUE.search(p[f])]
    assert not left, "\n".join(left)
