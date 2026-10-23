// The performance order against the library's own unfolding. content/tools/validate.py stores,
// per piece, the unfolded quarters (xmlcheck.unfold_order) in content/verification.json. Quarters
// do not depend on the tempo, which is where the archive pieces' stored durations part from the
// scores (the catalogue tempo stands in for a missing <sound tempo>). The reference knows no D.C.,
// so the order is taken with `jumps: false`. The archive (PDMX, gzipped) is part of the check.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readLibraryScore } from '../../cli/libraryScore.js';
import { parseMusicXml } from '../io/musicxml/read.js';
import { performanceOrder } from './form.js';
import type { MeasureInfo } from './types.js';

const repo = new URL('../../../../', import.meta.url);
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, repo)), 'utf8');

interface Entry {
  slug: string;
  files: { score: string };
}
interface Piece {
  slug: string;
  measures: MeasureInfo[];
  divisions: number;
}

const manifest = JSON.parse(read('content/manifest.json')) as Entry[];
const verification = JSON.parse(read('content/verification.json')) as Record<
  string,
  { stats?: { unfoldedQuarters?: number } }
>;

/** The pieces with a repeat sign or a volta ending, parsed once for the tests below. */
const pieces: Piece[] = [];
/** The pieces with a D.C., D.S., Fine or To Coda, by slug. */
const jumpPieces = new Map<string, Piece>();

const REPEATS = /direction="backward"|<ending\b/;
const JUMPS = /dacapo|dalsegno|D\.\s?C\.|D\.\s?S\.|Da Capo|Dal Segno|tocoda|fine=|>Fine/i;

beforeAll(async () => {
  let n = 0;
  for (const p of manifest) {
    // Hand the thread back now and then: a worker blocked for a minute loses its link to vitest.
    if (++n % 100 === 0) await new Promise((resolve) => setImmediate(resolve));
    const text = readLibraryScore(fileURLToPath(new URL(`content/${p.files.score}`, repo)));
    const repeats = REPEATS.test(text);
    const jumps = JUMPS.test(text);
    if (!repeats && !jumps) continue;
    const { score } = parseMusicXml(text);
    const piece = { slug: p.slug, measures: score.measures, divisions: score.divisions };
    if (repeats) pieces.push(piece);
    if (jumps) jumpPieces.set(p.slug, piece);
  }
}, 240_000);

const quarters = (piece: Piece, order: number[]): number =>
  order.reduce((sum, i) => sum + piece.measures[i]!.lengthTicks, 0) / piece.divisions;

/**
 * Where this order and the reference unfolding part, by cause. In each case the order here
 * follows the signs bar by bar, and the reference is the one that stops short, returns to the
 * wrong place or drops a bar. The Python reference stays as it is: its figures feed
 * verification.json and the stored durations.
 *
 * - MISSES_A_PASS: the reference leaves out a pass of a repeat whose first ending spans several
 *   bars or whose volta bars stand alone, or does not return at the sign that closes the ending.
 * - BRACKET_EARLY: the first ending's bracket closes before the backward repeat (MuseScore leaves
 *   the sign a few bars on); the reference repeats the last bar alone and loses the section.
 * - OTHER_SECTION: the reference returns to an earlier forward repeat than the nearest one.
 * - ENDING_2_LOST: the reference drops a second ending that follows a backward repeat with no
 *   first ending.
 * - ENDING_ON_REPEAT_BAR: a second ending on a bar that also opens a forward repeat; the reference
 *   skips it.
 * - MANY_ENDINGS: three or more endings, or an ending list such as [1, 3] with a repeat count;
 *   the two readings differ in the number of passes.
 * - MALFORMED: the volta brackets contradict the repeat signs (see BARS_NEVER_HEARD).
 */
const MISSES_A_PASS = 'misses a pass';
const BRACKET_EARLY = 'bracket closes early';
const OTHER_SECTION = 'other section';
const ENDING_2_LOST = 'ending 2 lost';
const ENDING_ON_REPEAT_BAR = 'ending on a repeat bar';
const MANY_ENDINGS = 'many endings';
const MALFORMED = 'malformed';

/** The pieces where the order differs from the reference: slug to [its unfolded quarters, cause]. */
const DIFFERS_FROM_REFERENCE: Record<string, [number, string]> = {
  'pdmx-joyeux-anniversaire-9037c755': [51, MISSES_A_PASS],
  'pdmx-white-christmas-irving-berlin-443eb670': [148, ENDING_2_LOST],
  'pdmx-1950-effce95e': [236, MALFORMED],
  'pdmx-brindis-0ee41eef': [100, BRACKET_EARLY],
  'pdmx-clock-rug-stretch-04e61b01': [68, MALFORMED],
  'pdmx-constance-piano-th-me-760ecaf4': [308, OTHER_SECTION],
  'pdmx-ellie-goulding-s-love-me-like-you-do-cov-ce7027a9': [392, BRACKET_EARLY],
  'pdmx-hanno-ucciso-l-uomo-ragno-d3004bdf': [224, ENDING_ON_REPEAT_BAR],
  'pdmx-hit-the-road-jack-a2e3d31c': [232, OTHER_SECTION],
  'pdmx-lady-gaga-brown-eyes-piano-only-26aec15a': [242, BRACKET_EARLY],
  'pdmx-pillowtalk-e2d4fda2': [388, MISSES_A_PASS],
  'pdmx-radioactive-3fe05876': [408, MISSES_A_PASS],
  'pdmx-raggs-requiem-a153116e': [255, MISSES_A_PASS],
  'pdmx-richard-marx-right-here-waiting-a5379f44': [400, BRACKET_EARLY],
  'pdmx-super-mario-land-2-six-golden-coins-over-ce0d4239': [144, MISSES_A_PASS],
  'pdmx-u-n-owen-was-her-1st-anniversary-remix-baded787': [344, MANY_ENDINGS],
  'pdmx-arctic-monkeys-four-out-of-five-f90108aa': [696, MISSES_A_PASS],
  'pdmx-beethoven-virus-ost-passion-876f1d94': [260.5, BRACKET_EARLY],
  'pdmx-its-me-21a11e42': [444, OTHER_SECTION],
  'pdmx-minecraft-calm-46236956': [464, MISSES_A_PASS],
  'pdmx-someone-you-loved-lewis-capaldi-999aa6c3': [232, OTHER_SECTION],
  'pdmx-westerland-3151a9ca': [700, BRACKET_EARLY],
  'pdmx-s-kkj-rven-polkka-piano-v2020-7df7cd12': [192.5, OTHER_SECTION],
  'pdmx-10-etudes-and-preludes-76d890a4': [572, OTHER_SECTION],
  'pdmx-concert-study-no-1-4fef3cef': [944, OTHER_SECTION],
  'pdmx-dreemurr-family-medley-f1526f02': [634, MISSES_A_PASS],
  'pdmx-elo-mr-blue-sky-hard-piano-85e83782': [656, MISSES_A_PASS],
  'pdmx-jellyfish-a24f2c4a': [416, MANY_ENDINGS],
  'pdmx-joseph-c-northup-the-cannon-ball-1905-62b31c50': [232, BRACKET_EARLY],
  'pdmx-shots-over-langrenus-48b0cbb3': [156, MISSES_A_PASS],
  'pdmx-the-garden-walk-c76384b9': [272, MISSES_A_PASS],
  'pdmx-the-vulture-rag-e536e2da': [592, MISSES_A_PASS],
  'pdmx-triangulum-da21187a': [704, MANY_ENDINGS],
};

/**
 * Pieces with a bar (0-based index) that no pass reaches even with the jumps left out, because the
 * source's volta brackets contradict its repeat signs, or because only a jump reaches it. A change
 * that loses more bars, or fewer, fails the test.
 */
const BARS_NEVER_HEARD: Record<string, number[]> = {
  // A volta 1 and a volta 2 with no repeat sign: nothing returns to the first ending.
  'pdmx-tsugaru-jongara-bushi-63012656': [108],
  'pdmx-sailing-song-0a75f264': [39],
  // Ending 3 comes after the D.C.: only the jump reaches it.
  'pdmx-jean-philippe-rameau-les-niais-de-sologn-86a7f80a': [25],
  // The volta brackets come after the backward repeat they belong to.
  'pdmx-brisas-del-pamplonita-lt-2b6ce6f5': [64],
  // Ending 2 on a bar with a backward repeat and no ending 1 to return from.
  'pdmx-1950-effce95e': [29],
  'pdmx-serge-gainsbourg-la-chanson-de-pr-vert-36ecb33d': [32],
  // Ending 3 on a bar that opens a forward repeat, after a repeat of two passes.
  'pdmx-abba-lay-all-your-love-on-me-7d1ee1e3': [57],
  // Ending 1 after a plain backward repeat that has already made its two passes.
  'pdmx-clock-rug-stretch-04e61b01': [4, 5, 6, 7, 8],
  // Endings 2 and 4 on bars that no pass of the repeat before them reaches.
  'pdmx-the-prelude-final-fantasy-a160472c': [25, 26],
  // Ending 1 after a run of ending 2 bars that already closed the repeat.
  'pdmx-pianoflage-roy-bargy-1922-b06a1f51': [89],
};

describe('the performance order on the library', () => {
  it('is as long as the reference unfolding for every piece with a repeat sign', () => {
    let checked = 0;
    const off: Record<string, [number, string]> = {};
    for (const p of pieces) {
      const reference = verification[p.slug]?.stats?.unfoldedQuarters;
      if (reference === undefined) continue;
      const own = quarters(p, performanceOrder(p.measures, { jumps: false }));
      checked++;
      if (own !== reference)
        off[p.slug] = [own, DIFFERS_FROM_REFERENCE[p.slug]?.[1] ?? 'unexplained'];
    }
    expect(checked).toBeGreaterThan(100);
    // A piece that differs is listed with its figure and cause; a listed piece that has come to
    // agree with the reference is a stale entry and fails here too.
    expect(off).toEqual(DIFFERS_FROM_REFERENCE);
  }, 240_000);

  it('plays every bar of every piece at least once, jumps left out', () => {
    const lost: Record<string, number[]> = {};
    for (const p of pieces) {
      const heard = new Set(performanceOrder(p.measures, { jumps: false }));
      const missing = p.measures.map((m) => m.index).filter((i) => !heard.has(i));
      if (missing.length > 0) lost[p.slug] = missing;
    }
    expect(lost).toEqual(BARS_NEVER_HEARD);
  }, 240_000);

  it('plays all ten passes of a Hanon exercise, and its last bar', () => {
    // 30 bars, a backward repeat of ten on bar 29: 29 bars ten times, then bar 30.
    const hanon = pieces.find(
      (p) => p.slug === 'pdmx-10-minutos-de-piano-hanon-1-g-tutorial-4db2f2cd',
    )!;
    const order = performanceOrder(hanon.measures);
    expect(hanon.measures).toHaveLength(30);
    expect(order).toHaveLength(29 * 10 + 1);
    expect(order.at(-1)).toBe(29);
  });
});

describe('the jump marks on the library', () => {
  /** [bars without the jumps, bars with them, bar indices no pass reaches]. */
  const EFFECTS: Record<string, [number, number, number[]]> = {
    'pdmx-radetzky-march-for-easy-piano-7a3d4e20': [88, 176, []],
    'pdmx-in-the-mood-3875c123': [68, 92, []],
    // Two D.C. marks: bars 61 to 75 (0-based) are never heard.
    'pdmx-minuet-water-music-hwv-350-0169961e': [
      120,
      133,
      [61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75],
    ],
    // The D.S. lands on a Fine and a coda inside a first ending.
    'pdmx-tico-tico-no-fuba-ad193630': [101, 117, [54]],
    // The remaining pieces whose jumps leave bars out of the performance.
    'pdmx-clocks-coldplay-398d135d': [40, 37, [18]],
    'pdmx-dung-xa-em-dem-nay-223e70ba': [49, 56, [37, 38]],
    'pdmx-despacito-piano-ca51c54b': [143, 167, [131, 132]],
    'pdmx-teenagers-my-chemical-romance-e94bb2db': [66, 66, [56]],
    'pdmx-carioca-1913-09a8e443': [139, 137, [51, 68]],
    'pdmx-hanky-panky-3ddba92d': [184, 243, [113]],
    'pdmx-the-primal-scene-of-japan-the-girl-watch-4bd5aa5c': [130, 199, [116]],
  };

  it('change the order where a D.C., D.S. or Fine acts; the listed pieces leave bars out', () => {
    const got: Record<string, [number, number, number[]]> = {};
    for (const slug of Object.keys(EFFECTS)) {
      const p = jumpPieces.get(slug)!;
      const plain = performanceOrder(p.measures, { jumps: false });
      const jumped = performanceOrder(p.measures);
      const heard = new Set(jumped);
      got[slug] = [
        plain.length,
        jumped.length,
        p.measures.map((m) => m.index).filter((i) => !heard.has(i)),
      ];
    }
    expect(got).toEqual(EFFECTS);
  });
});
