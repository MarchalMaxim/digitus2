# Garbled titles in the MuseScore archive pieces (2026-10-18)

The library listed titles such as `Chanson bretonne` by "Aven entrain - Ráº't hÃ¡ng hái" and `3 Daqat - 3 ØÙØ¯Ø©`. This repairs 85 titles and composers of 74 pieces and keeps them repaired.

## Cause

The PDMX metadata (`content/_raw/pdmx/candidates*.json`, the `title` and `composer` fields) holds text that no longer matches what the uploader typed. The scores inside the dataset are fine: `<work-title>`, `<creator>` and `<credit-words>` of the MusicXML hold the original text. Comparing the two gives one rule (`content/tools/titles.py`, `damage`):

| Character                                                                 | What the metadata holds                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| ASCII                                                                     | itself                                                                                            |
| a letter or digit cp1252 can encode (é, ö, Š) and the plain Greek letters | itself                                                                                            |
| a symbol cp1252 can encode (·, °, «)                                      | nothing                                                                                           |
| anything else (Đ, ế, 周, 🎹, ж)                                           | its UTF-8 bytes read as Latin-1, keeping only the bytes that are letters or digits: Ä, á, º, å, Ø |

So `Đếm sao` became `Äáºm sao`. The lost bytes cannot be recovered from the damaged text, but a candidate can be tested: damaging it again must give back the damaged text exactly.

## What was done

| Source of the new text                                                                                                                                     | Fields | Check                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------------------- |
| The score's own title, creator or credit text                                                                                                              |     56 | damaged text matches exactly                                                    |
| Written by hand from the piece's name (Vietnamese, Turkish, Greek, Japanese, Korean, Chinese titles whose file has no title, or a differently written one) |     21 | damaged text matches exactly                                                    |
| The same, with the keyboard emoji left off both ends of two titles                                                                                         |      2 | exact apart from the emoji: a coloured glyph has no place in the one-red design |
| Only what is certain; the rest is marked below                                                                                                             |      6 | not exact, see the table                                                        |

Slugs are unchanged (links and saved scores keep working); `content/manifest.json` and `content/library-index.json` were regenerated with `python content/tools/build.py --manifest-only`, which changed only these fields.

| Piece                                             | New title                                                       | What could not be recovered                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdmx-majeed-nushi-mansour-0ee21914`              | Untitled - Majeed Nushi Mansour                                 | the Arabic title: not in the score, not in the dataset (its path is an IPFS id, with no MuseScore score id to look up); searching the uploader's name found nothing |
| `pdmx-wesley-ayyad-1d06c25f`                      | Untitled - Wesley Ayyad                                         | the same                                                                                                                                                            |
| `pdmx-fawwaz-omeish-309da5c9`                     | Untitled - Fawwaz Omeish                                        | the same                                                                                                                                                            |
| `pdmx-kite-c38e7468`                              | 嵐 - カイト（Kite 風箏）                                        | four characters after the closing bracket                                                                                                                           |
| `pdmx-lily-jiji-kiki-s-delivery-service-e3fb8a96` | Lily & Jiji/リリーとジジ - Kiki's Delivery Service/魔女の宅急便 | two kana after ジジ                                                                                                                                                 |
| `pdmx-merry-christmas-mr-lawrence-f8a0f1ec`       | Merry Christmas Mr. Lawrence (戦場のメリークリスマス)           | the one mark that joined the two names                                                                                                                              |

If someone knows the three Arabic titles, each is a one-line edit in `content/tools/catalog.d/pdmx-library.json` and `pdmx-songs.json`, then `build.py --manifest-only`.

## Staying repaired

`content/tools/tests/test_titles.py` fails when a title or composer of an archive piece is the damaged form of text in its own score, or shows what the damage leaves behind (a lead letter such as Ä or Ø followed by something that is not part of a word). Before the repair 3 of its 5 tests failed.

The generators (`pdmx_songs.py`, `pdmx_select.py`) still read the damaged metadata. They were run once and the fragments edited since, so they are not changed here: repairing in `clean_title` would change the slug of any regenerated piece, because slugs are made from the title.

A letter's case is not always in the damaged text (`Đ` and `đ` both leave `Ä`), so `repaired` prefers the text as the score writes it.
