# Textbook fingering oracle

These are generated patterns whose fingering is what piano method books print: scales, arpeggios and
chromatic scales in every key, both hands, both directions. Use them to test the digitus2 engine without
ambiguity. Every entry cites its sources. Where books disagree, the most common fingering is `fingers`
and the others are in `alternatives`. The conventions, the per-key tables, every source URL and the list of
disputed cases are in [`docs/research/textbook-oracle.md`](../../docs/research/textbook-oracle.md).

## Files

| File | Contents | Entries |
|---|---|---|
| `scales.json` | 12 major, 12 harmonic minor and 12 melodic minor scales; RH and LH; ascending and descending; 1, 2 and 3 octaves | 432 (144 per mode) |
| `arpeggios.json` | Root-position major and minor triads; dominant sevenths (named by key, chord on the dominant); diminished sevenths (named by starting note); all 12 of each; RH and LH; ascending and descending; 2 octaves | 192 (48 per mode) |
| `chromatic.json` | Chromatic scale from each of the 12 pitch classes; RH and LH; ascending and descending; 2 octaves | 48 |
| `generate.py` | Builds the three JSON files from the cited tables, rewrites the tables in the research doc, then runs `check.py` | |
| `check.py` | Quality gates (see below); exits with code 1 on any failure | |

Total: 672 entries.

## Schema

Each JSON file is `{ "schemaVersion": 1, "oracle", "description", "generatedBy", "conventions", "count",
"sourcesUsed": [{name, url}], "entries": [...] }`. Every entry has the same fields:

```json
{
  "id": "scale.major.Bb.rh.asc.1oct",
  "family": "scale",
  "key": "Bb",
  "mode": "major",
  "chord": null,
  "hand": "rh",
  "direction": "ascending",
  "octaves": 1,
  "startMidi": 58,
  "midi": [58, 60, 62, 63, 65, 67, 69, 70],
  "fingers": [2, 1, 2, 3, 1, 2, 3, 4],
  "source": {"name": "pianoscales.org, Piano Major Scales ...", "url": "https://www.pianoscales.org/major.html"},
  "sources": [{"name": "...", "url": "..."}],
  "alternatives": [{"fingers": [4, 1, 2, 3, 1, 2, 3, 4], "source": {"name": "...", "url": "..."}, "sources": [...]}],
  "confidence": "majority",
  "note": "One-octave charts mostly start on 2 ..."
}
```

| Field | Meaning |
|---|---|
| `id` | `family.mode.key.hand.asc or desc.<n>oct`, unique across all files |
| `family` | `scale`, `arpeggio` or `chromatic` |
| `key` | Tonic or root, spelled `C G D A E B F# Db Ab Eb Bb F` (majors), `A E B F# C# G# Eb Bb F C G D` (minors) or `C C# D Eb E F F# G Ab A Bb B` (diminished sevenths, chromatic). For `dominant7` it is the key; the chord is on its dominant. |
| `mode` | Scales: `major`, `harmonic_minor`, `melodic_minor`. Arpeggios: `major`, `minor`, `dominant7`, `diminished7`. Chromatic: `chromatic`. |
| `chord` | Arpeggio chord symbol (`Ab`, `C#m`, `Bb7`, `C#dim7`); `null` otherwise |
| `hand` | `rh` or `lh` |
| `direction` | `ascending` or `descending` |
| `octaves` | Range of the pattern in octaves |
| `startMidi` | Always `midi[0]`, so it is the top note for descending entries |
| `midi` | MIDI note numbers in playing order (middle C = 60) |
| `fingers` | Same length as `midi`; 1 = thumb to 5 = little finger, positive for both hands |
| `source` | First (main) citation for `fingers`, as `{name, url}` |
| `sources` | Every source that prints `fingers` (the first is `source`) |
| `alternatives` | Other fingerings printed by at least one cited source. A scorer should accept them. |
| `confidence` | `agreed`: all consulted sources agree, no alternatives. `majority`: sources disagree and `fingers` has more support. `tie`: equal support, broken by the rule in `note`. `rule`: derived from a documented fingering rule, not a per-key printed table (black-root seventh chords only). |
| `note` | Free text explaining a dispute or a convention; `null` when there is nothing to add |

Range convention: the lowest note is the tonic or root nearest middle C for RH (C4 = 60 for C; ties at
F-sharp go down to F#3 = 54), and exactly one octave lower for LH. Descending entries cover the same range
from the top. A melodic-minor descending entry uses the natural-minor notes and fingering; every other
descending entry is the exact reverse of its ascending entry.

## Counts

| Family | Mode | Entries | agreed | majority | tie | rule |
|---|---|---|---|---|---|---|
| scale | major | 144 | 96 | 36 | 12 | 0 |
| scale | harmonic_minor | 144 | 96 | 42 | 6 | 0 |
| scale | melodic_minor | 144 | 126 | 15 | 3 | 0 |
| arpeggio | major | 48 | 32 | 8 | 8 | 0 |
| arpeggio | minor | 48 | 36 | 6 | 6 | 0 |
| arpeggio | dominant7 | 48 | 28 | 0 | 0 | 20 |
| arpeggio | diminished7 | 48 | 28 | 0 | 0 | 20 |
| chromatic | chromatic | 48 | 48 | 0 | 0 | 0 |
| **all** | | **672** | **490** | **107** | **35** | **40** |

146 entries carry at least one alternative (114 scales, 32 arpeggios).

Each scale has 12 keys × 2 hands × 2 directions × 3 lengths = 144 entries per mode. Each arpeggio mode has
12 × 2 × 2 = 48.

## Regenerate and check

```
python benchmarks/textbook/generate.py   # rebuild JSON + doc tables, then run the gates
python benchmarks/textbook/check.py      # gates only
```

Python 3.11, standard library only. Both scripts exit with code 1 if any gate fails.

## Quality gates (`check.py`)

`check.py` re-derives pitch content from **key signatures** (letters plus sharps and flats), independently of
`generate.py`, which works from interval patterns. Then it checks:

1. **Schema.** All fields are present, `startMidi == midi[0]`, and every source has a name and a URL.
2. **Monotone.** `midi` strictly rises (ascending) or falls (descending).
3. **Span.** The range is exactly `12 × octaves` semitones, and the first and last notes are the tonic or root.
4. **Pitch content.** The notes are exactly every key in the range whose pitch class belongs to the scale or
   chord: major, harmonic minor or melodic minor ascending from the key signature, the natural minor for
   melodic descending, triads as degrees 1-3-5, V7 as degrees 5-7-2-4 of the key, and vii°7 of the harmonic
   minor for diminished sevenths.
5. **Anchor.** The RH starts at the tonic nearest middle C, the LH exactly an octave lower.
6. **Fingering.**
   - `fingers` has the same length as `midi`, values 1 to 5, and no finger repeats on consecutive notes.
   - No thumb on a black key, except the arpeggios of F-sharp major and E-flat minor, which have no white key.
   - Scales use adjacent fingers for adjacent steps, except at a thumb crossing (thumb under 2, 3 or 4; or 2,
     3 or 4 over the thumb).
   - Arpeggios move outward through the hand except at thumb crossings.
   - Chromatic scales put 3 on black keys and pair E-F and B-C as RH 1-2 and LH 2-1.
   - The interior notes repeat the octave pattern.
7. **Alternatives.** Each one passes gate 6 and differs from the primary and from the other alternatives.
8. **Reverse.** A descending entry is the exact reverse of its ascending entry (notes, fingers,
   alternatives), except melodic minor. The script lists the melodic pairs whose fingering differs:
   C-sharp RH, F-sharp RH, G-sharp LH.
9. **Octave consistency.** The 1-, 2- and 3-octave versions of a scale use the same pattern.
10. **Hand pairing.** Every pattern exists in both hands, with LH one octave below RH.
11. **Source fidelity.** `check.py` holds 338 literal transcriptions of the cited tables (one digit per
    note, typed independently of the generator's cycle tables): pianoscales.org, MasterPiano,
    piano-keyboard-guide, oktav, Musicnotes, Hoffman, Beauchamp, Commonwealth University, Escadon and Kelley.
    Each one must appear in its entry, as `fingers` or as an alternative, and that fingering must cite the
    transcribed source.

A mutation test was run on purpose: wrong pitches, a thumb on a black key, repeated fingers, a broken
reverse, a wrong anchor and similar errors were injected. All 25 kinds of corruption were caught, and so
were a wrong transcription and a wrong attribution in the source-fidelity gate.
