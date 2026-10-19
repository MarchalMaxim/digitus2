"""Titles and composers of PDMX pieces that arrived damaged, and the check that they stay repaired.

The PDMX metadata of some MuseScore scores holds text that is no longer what the uploader typed: a
title such as "Đếm sao" reads "Äáºm sao", "周杰伦" reads "åæä¼", "🎹" reads "ð¹". The damage follows one
rule, found by comparing the metadata with the text inside the scores themselves:

  * ASCII is untouched;
  * a letter or digit that cp1252 can encode (é, ö, Š, ...) is untouched, and so are the plain Greek
    letters; a symbol that cp1252 can encode (·, °, «) is dropped;
  * every other character is written as its UTF-8 bytes read as Latin-1, and only the bytes that
    are letters or digits survive: the lead byte (Ä, á, å, Ø) and a few continuation bytes (º, ¼, ²),
    never the control codes or punctuation among them.

The loss cannot be undone from the damaged text alone, but a candidate can be tested: `damage(candidate)`
must give back the damaged text exactly. The candidates are the score's own title, creator and
credit words (`xml_texts`), which the damage never reached, `repaired` applies them, and
tests/test_titles.py keeps the catalog free of what they would still repair.
"""
from __future__ import annotations

import gzip
import html
import re
from pathlib import Path

GREEK = frozenset("ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρςστυφχψω")


def _cp1252(c: str) -> bool:
    try:
        c.encode("cp1252")
        return True
    except UnicodeEncodeError:
        return False


def damage(text: str) -> str:
    """The text as the PDMX metadata holds it when the text is damaged as described above."""
    out: list[str] = []
    for c in text:
        if c.isascii() or c in GREEK:
            out.append(c)
        elif _cp1252(c):
            if c.isalnum():
                out.append(c)
        else:
            out.extend(ch for ch in map(chr, c.encode("utf-8")) if ch.isalnum())
    return "".join(out)


# What a letter damaged to its lead byte leaves behind: a lead letter of Latin-1 followed by something
# that is not part of a word, as in "Äáºm" or "ÃÏ". The titles of the library hold none.
RESIDUE = re.compile("[ÃÂÄÅÆÐÑØÙÎÏÕ×Ç][^a-zA-Z ]|[À-ÿ][\u0080-¿]|[¡-¿][À-ÿ]|[ÃÂÄÅÆÐÑØÙÎÏ]$")


def leaves_trace(text: str) -> bool:
    """Whether damaging `text` leaves a trace of it in the damaged text (a stripped lead letter such
    as Ä or á), not only a gap where a symbol was dropped."""
    return any(damage(c) not in ("", c) for c in text)


_TAGS = ("work-title", "movement-title", "creator", "credit-words")
_SPLIT = re.compile(r"\s+[-–—_|]\s+|[/()\[\]:,;<>「」（）]|\s{2,}")


def xml_texts(path: Path | str) -> list[str]:
    """The title, creator and credit texts at the head of a score (MusicXML, plain or gzip), in
    document order without repeats."""
    data = Path(path).read_bytes()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    head = data.decode("utf-8", "replace")[:400_000]
    seen: set[str] = set()
    out: list[str] = []
    for tag in _TAGS:
        for m in re.finditer(rf"<{tag}\b[^>]*>([^<]*)</{tag}>", head):
            text = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()
            if text and text not in seen:
                seen.add(text)
                out.append(text)
    return out


def _units(texts: list[str]) -> list[str]:
    """The pieces of the score's texts a damaged field may hold, longest first: each text, each part
    between separators, each word, in the case it has and in lower, upper and title case (a title
    in capitals in the score may be lower-case in the metadata)."""
    pieces: set[str] = set()
    for text in texts:
        for part in [text, *(s.strip() for s in _SPLIT.split(text))]:
            pieces.add(part)
            pieces.update(part.split())
    as_written = set(pieces)
    pieces |= {v for p in pieces for v in (p.lower(), p.upper(), p.title(), p.capitalize())}
    # Đ and đ, Ấ and ấ damage alike, so a field cannot say which case the score has: the text as the
    # score writes it comes before its case variants, and the order is the same on every run.
    return sorted((p for p in pieces if p.strip() and leaves_trace(p) and damage(p) != p),
                  key=lambda p: (-len(p), p not in as_written, p))


def repaired(field: str, texts: list[str]) -> str:
    """`field` with every stretch that is the damaged form of a text of the score put back."""
    for text in texts:  # the whole text: also gives back the symbols the damage dropped
        if text != field and damage(text) == field:
            return text
    for unit in _units(texts):
        damaged = damage(unit)
        if damaged and damaged in field:
            field = field.replace(damaged, unit)
    return field
