/**
 * Where a recognised note's head lies on the page photo (issue 226). homr's imgpos is the centre of
 * mass of its transformer's attention, not a detected notehead: only a third of the points are
 * within half a staff space of the head. The note itself is read correctly, so the head is looked
 * for on the photo: at the height its pitch and clef print it on the staff, along that row, at
 * the head nearest homr's point. The staff is the tracer's (camera/staffGeometry.ts) where it
 * traced one near the point; a soft photo's tracer misses staves, and the lines are then read
 * from the photo around the note. Pure arrays in, a point out; the review draws its frames
 * there (docs/scanning.md), and research/omr/imgpos.mjs measures it against Verovio's drawing.
 */
import type { StaffGeometry } from './camera/staffGeometry.js';
import { STEPS, type ScanNote } from './notes.js';

/** One traced staff, in the pixels of the analysis copy: its middle line and spacing at each x. */
export interface HeadStaff {
  xs: readonly number[];
  centers: readonly number[];
  spacings: readonly number[];
}

/** The page photo as the review analyses it: a grayscale copy and the staves traced on it. */
export interface HeadPage {
  width: number;
  height: number;
  /** Luminance, 0 black to 255 white, row by row. */
  lum: Uint8Array;
  /** The copy's pixels per pixel of the photo as uploaded, which is what imgpos is in. */
  scale: number;
  /** The page's staff space in the copy's pixels. */
  space: number;
  /** The staves the tracer found, which may be few. */
  staves: readonly HeadStaff[];
}

export type HeadNote = Partial<Pick<ScanNote, 'imgpos' | 'step'>> &
  Pick<ScanNote, 'octave' | 'rest' | 'clef'>;

// Notehead shape, in staff spaces: an ellipse tilted up to the right, as engraved.
const HEAD_HALF_WIDTH = 0.62;
const HEAD_HALF_HEIGHT = 0.46;
const HEAD_TILT = (-20 * Math.PI) / 180;
/** The ring around a filled head that must be paper: this much wider and taller than the head. */
const RING_WIDTH = 1.5;
const RING_HEIGHT = 1.9;
/** A hollow head is an outline: the band between this share of the ellipse and all of it; its middle must be paper. */
const OUTLINE_INNER = 0.7;
const HOLLOW_CORE = 0.45;

/** The lines are read in columns this many spaces either side of the note, narrower if a tilted photo smears them. */
const LINE_HALF_WIDTHS = [12, 6, 3];
/** ... and in rows this many spaces above and below it. */
const LINE_HALF_HEIGHT = 10;
/** A line is a peak of the ink profile at least this share of the strongest peak; a beam can outweigh faint lines, so lower shares are tried next. */
const LINE_PEAK_SHARES = [0.4, 0.25, 0.15];
/** The slopes (rows per column, up to 3.5 degrees either way) the lines are looked for along, and how many of them, sharpest first, are tried. */
const LINE_SLOPES = Array.from({ length: 13 }, (_, i) => (i - 6) / 100);
const LINE_SLOPES_TRIED = 3;
/** Consecutive lines lie a staff space apart, give or take this share. */
const LINE_GAP_TOLERANCE = 0.25;

/** The rows searched lie this far (in spaces) above and below the pitch's row: a head is 0.9 high. */
const ROW_BAND = 0.3;
/** The search reaches this far (in spaces) either side of homr's point; it is good to about one. */
const REACH = 2;
/** The darkest share of a page's pixels is its ink, and paper is what the given share lies below. */
const INK_SHARE = 0.01;
const PAPER_SHARE = 0.6;
/** A page with less contrast than this (an empty or blank photo) is left as it is. */
const MIN_CONTRAST = 32;
/** A column holds a head when its best score is at least this: ink in the head, paper around it. */
const MIN_SCORE = 0.25;
/** Among the heads found, those at least this share as strong as the strongest compete for nearness. */
const PEAK_SHARE = 0.5;
/** A point farther than this many spaces from the pitch's row on every staff belongs to no staff. */
const MAX_ROW_DISTANCE = 2.5;
/** The pitch's own row first, then rows one and two steps (half spaces) away: a safety net for a misread pitch. */
const ROW_STEPS = [0, 1, 2];

/** Pixel offsets (dx, dy pairs) of the kernel's regions for a staff space `s`. */
interface Kernel {
  inside: Int16Array;
  ring: Int16Array;
  edge: Int16Array;
  core: Int16Array;
}

function kernelFor(s: number): Kernel {
  const a = HEAD_HALF_WIDTH * s;
  const b = HEAD_HALF_HEIGHT * s;
  const cos = Math.cos(HEAD_TILT);
  const sin = Math.sin(HEAD_TILT);
  /** How far out of the ellipse (1 is its outline) an offset lies, with the axes scaled. */
  const radius = (dx: number, dy: number, scaleA = 1, scaleB = 1) =>
    Math.hypot((dx * cos + dy * sin) / a / scaleA, (-dx * sin + dy * cos) / b / scaleB);
  const reach = Math.ceil(a * RING_WIDTH + 1);
  const inside: number[] = [];
  const ring: number[] = [];
  const edge: number[] = [];
  const core: number[] = [];
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const head = radius(dx, dy);
      if (head <= 1) {
        inside.push(dx, dy);
        if (head >= OUTLINE_INNER) edge.push(dx, dy);
        if (head <= HOLLOW_CORE) core.push(dx, dy);
      } else if (radius(dx, dy, RING_WIDTH, RING_HEIGHT) <= 1) ring.push(dx, dy);
    }
  // A tiny staff space leaves a region empty: the head's centre stands in.
  const some = (offsets: number[]) => Int16Array.from(offsets.length ? offsets : [0, 0]);
  return { inside: some(inside), ring: some(ring), edge: some(edge), core: some(core) };
}

/**
 * What a page keeps between notes: its head kernel, the score of every pixel looked at, and each
 * note's answer, so the review placing every note again after a correction does no new search.
 */
interface Scored {
  kernel: Kernel;
  scores: Float32Array;
  placed: Map<string, { x: number; y: number } | undefined>;
}
const scored = new WeakMap<HeadPage, Scored>();

function scoredOf(page: HeadPage): Scored {
  let known = scored.get(page);
  if (!known) {
    known = {
      kernel: kernelFor(page.space),
      scores: new Float32Array(page.width * page.height).fill(NaN),
      placed: new Map(),
    };
    scored.set(page, known);
  }
  return known;
}

/**
 * How much a notehead is centred on (x, y): the better of a filled head (ink inside, paper in the
 * ring around it) and a hollow one (ink on the outline, paper in its middle and around it).
 */
function headScore(page: HeadPage, state: Scored, x: number, y: number): number {
  const cached = state.scores[y * page.width + x]!;
  if (!Number.isNaN(cached)) return cached;
  const { width, height, lum } = page;
  const mean = (offsets: Int16Array): number => {
    let sum = 0;
    for (let i = 0; i < offsets.length; i += 2) {
      const px = x + offsets[i]!;
      const py = y + offsets[i + 1]!;
      if (px >= 0 && px < width && py >= 0 && py < height) sum += 255 - lum[py * width + px]!;
    }
    return sum / 255 / (offsets.length / 2);
  };
  const { kernel } = state;
  const ring = mean(kernel.ring);
  const filled = mean(kernel.inside) - ring;
  const hollow = mean(kernel.edge) - 0.5 * mean(kernel.core) - 0.5 * ring;
  const score = Math.max(filled, hollow);
  state.scores[y * width + x] = score;
  return score;
}

/** The staff's middle line and spacing at `x`, between the columns the tracer sampled. */
function staffAt(staff: HeadStaff, x: number): { centre: number; space: number } {
  const { xs, centers, spacings } = staff;
  const last = xs.length - 1;
  let i = 0;
  while (i < last - 1 && xs[i + 1]! < x) i++;
  const t = last === 0 ? 0 : Math.min(1, Math.max(0, (x - xs[i]!) / (xs[i + 1]! - xs[i]!)));
  const mix = (v: readonly number[]) => v[i]! * (1 - t) + v[Math.min(last, i + 1)]! * t;
  return { centre: mix(centers), space: mix(spacings) };
}

/** The five-line group of `peaks` (row indices) whose centre is nearest `at`, with its spacing, if any. */
function fiveLines(
  peaks: readonly number[],
  space: number,
  at: number,
): { centre: number; space: number } | undefined {
  let best: { centre: number; space: number } | undefined;
  for (let i = 0; i < peaks.length; i++) {
    const group = [peaks[i]!];
    for (const next of peaks.slice(i + 1)) {
      const gap = next - group[group.length - 1]!;
      if (Math.abs(gap - space) <= LINE_GAP_TOLERANCE * space) group.push(next);
      else if (gap > (1 + LINE_GAP_TOLERANCE) * space) break;
      if (group.length === 5) break;
    }
    if (group.length < 5) continue;
    const centre = (group[0]! + group[4]!) / 2;
    if (!best || Math.abs(centre - at) < Math.abs(best.centre - at))
      best = { centre, space: (group[4]! - group[0]!) / 4 };
  }
  return best;
}

/**
 * How much each row stands out from its surroundings in the columns x0 to x1, the rows read along
 * `slope` (rows per column) from the row at column `ax`: a thin dark line the slope follows is a
 * sharp peak, and a shadow is no peak at all (a Gaussian a half space wide is taken off).
 */
function lineDetail(
  page: HeadPage,
  [x0, x1]: [number, number],
  [y0, y1]: [number, number],
  ax: number,
  slope: number,
): Float32Array {
  const profile = new Float32Array(y1 - y0);
  for (let y = y0; y < y1; y++) {
    let sum = 0;
    for (let x = x0; x < x1; x++) {
      const row = Math.round(y + slope * (x - ax));
      if (row >= 0 && row < page.height) sum += 255 - page.lum[row * page.width + x]!;
    }
    profile[y - y0] = sum / 255 / (x1 - x0);
  }
  const sigma = Math.max(1, page.space / 2);
  const reach = Math.ceil(3 * sigma);
  return profile.map((value, i) => {
    let sum = 0;
    let weight = 0;
    for (let k = Math.max(0, i - reach); k <= Math.min(profile.length - 1, i + reach); k++) {
      const w = Math.exp(-((k - i) ** 2) / (2 * sigma * sigma));
      sum += w * profile[k]!;
      weight += w;
    }
    return Math.max(0, value - sum / weight);
  });
}

/**
 * The staff whose five lines are nearest `ay` in the columns around `ax`, read from the photo; the
 * middle line's row at `ax`. A photo's staves tilt and bend, so the rows are read along the slope
 * that makes the lines sharpest, and the best few slopes are tried.
 */
function staffNear(
  page: HeadPage,
  ax: number,
  ay: number,
): { centre: number; space: number } | undefined {
  const s = page.space;
  for (const half of LINE_HALF_WIDTHS) {
    const columns: [number, number] = [
      Math.max(0, Math.round(ax - half * s)),
      Math.min(page.width, Math.round(ax + half * s)),
    ];
    const rows: [number, number] = [
      Math.round(ay - LINE_HALF_HEIGHT * s),
      Math.round(ay + LINE_HALF_HEIGHT * s),
    ];
    if (columns[1] <= columns[0] || rows[1] - rows[0] < 3) continue;
    const reads = LINE_SLOPES.map((slope) => {
      const detail = lineDetail(page, columns, rows, ax, slope);
      return { detail, energy: detail.reduce((sum, v) => sum + v * v, 0) };
    })
      .sort((a, b) => b.energy - a.energy)
      .slice(0, LINE_SLOPES_TRIED);
    for (const { detail } of reads) {
      const strongest = Math.max(...detail);
      for (const share of LINE_PEAK_SHARES) {
        const peaks: number[] = [];
        for (let i = 1; i < detail.length - 1; i++)
          if (
            detail[i]! >= detail[i - 1]! &&
            detail[i]! > detail[i + 1]! &&
            detail[i]! > share * strongest
          )
            peaks.push(i);
        const found = fiveLines(peaks, s, ay - rows[0]);
        if (found) return { centre: rows[0] + found.centre, space: found.space };
      }
    }
  }
  return undefined;
}

/** The head along `rows` (analysis pixel heights) nearest `ax`, or undefined when none is there. */
function headAlong(
  page: HeadPage,
  state: Scored,
  ax: number,
  rows: number[],
  space: number,
): { x: number; y: number } | undefined {
  const reach = Math.round(REACH * space);
  const band = Math.max(1, Math.round(ROW_BAND * space));
  const x0 = Math.max(0, Math.round(ax) - reach);
  const x1 = Math.min(page.width - 1, Math.round(ax) + reach);
  if (x1 < x0) return undefined;
  const best = new Float32Array(x1 - x0 + 1).fill(-Infinity);
  const bestY = new Int32Array(best.length);
  for (const row of rows)
    for (
      let y = Math.max(0, Math.round(row) - band);
      y <= Math.min(page.height - 1, Math.round(row) + band);
      y++
    )
      for (let x = x0; x <= x1; x++) {
        const score = headScore(page, state, x, y);
        if (score > best[x - x0]!) {
          best[x - x0] = score;
          bestY[x - x0] = y;
        }
      }
  const top = Math.max(...best);
  if (top < MIN_SCORE) return undefined;
  // The local maxima of the columns, the strong ones competing on nearness; a plateau or a lone
  // column with no maximum of its own falls back to every column that holds a head.
  const strong = (i: number) => best[i]! >= MIN_SCORE;
  const peak = (i: number) =>
    best[i]! >= (best[i - 1] ?? Infinity) && best[i]! >= (best[i + 1] ?? Infinity);
  let columns = [...best.keys()].filter(
    (i) => strong(i) && peak(i) && best[i]! >= PEAK_SHARE * top,
  );
  if (!columns.length) columns = [...best.keys()].filter(strong);
  let pick = columns[0]!;
  for (const i of columns) if (Math.abs(x0 + i - ax) < Math.abs(x0 + pick - ax)) pick = i;
  return { x: x0 + pick, y: bestY[pick]! };
}

/**
 * The centre of the note's head on the page photo, in the pixels of the photo as uploaded (what
 * imgpos is in), or undefined when it cannot be found: a rest, a note without a position, no staff
 * near the point, no head along the row. The caller keeps homr's point then.
 */
export function placeHead(page: HeadPage, note: HeadNote): { x: number; y: number } | undefined {
  const { imgpos, step } = note;
  if (!imgpos || note.rest || !step) return undefined;
  const d = STEPS.indexOf(step) + 7 * note.octave;
  const state = scoredOf(page);
  const key = `${imgpos.x},${imgpos.y},${d},${note.clef}`;
  if (state.placed.has(key)) return state.placed.get(key);
  const head = searchHead(page, state, imgpos, d, note.clef);
  state.placed.set(key, head);
  return head;
}

function searchHead(
  page: HeadPage,
  state: Scored,
  imgpos: { x: number; y: number },
  d: number,
  clef: number,
): { x: number; y: number } | undefined {
  // Pixel indices of the analysis copy, whose centres lie half a pixel inside its continuous frame.
  const ax = imgpos.x * page.scale - 0.5;
  const ay = imgpos.y * page.scale - 0.5;
  // The row of the pitch on a staff, whose middle line is `centre`: two spaces below it is the bottom line.
  const rowOn = ({ centre, space }: { centre: number; space: number }) => ({
    row: centre + 2 * space - ((d - clef) * space) / 2,
    space,
  });
  // The traced staff whose row for this pitch is nearest the point: it settles which staff of a grand staff.
  let found: { row: number; space: number } | undefined;
  for (const staff of page.staves) {
    const on = rowOn(staffAt(staff, ax));
    if (!found || Math.abs(on.row - ay) < Math.abs(found.row - ay)) found = on;
  }
  // Where the tracer found no staff near the point, the lines are read from the photo here.
  if (!found || Math.abs(found.row - ay) > MAX_ROW_DISTANCE * found.space) {
    const local = staffNear(page, ax, ay);
    found = local && rowOn(local);
  }
  if (!found || Math.abs(found.row - ay) > MAX_ROW_DISTANCE * found.space) return undefined;
  for (const away of ROW_STEPS) {
    const rows = away
      ? [found.row - (away * found.space) / 2, found.row + (away * found.space) / 2]
      : [found.row];
    const head = headAlong(page, state, ax, rows, found.space);
    if (head) return { x: (head.x + 0.5) / page.scale, y: (head.y + 0.5) / page.scale };
  }
  return undefined;
}

/**
 * The page as the review analyses it, from the analysis copy's pixels (RGBA) and the staves the
 * tracer found on it; undefined when it found none.
 */
export function headPageFrom(
  frame: { width: number; height: number; data: ArrayLike<number> },
  geometry: StaffGeometry | null,
  scale: number,
): HeadPage | undefined {
  if (!geometry?.staves.length) return undefined;
  const spacings = geometry.staves
    .flatMap((staff) => [...staff.sourceSpacings])
    .sort((a, b) => a - b);
  const { width, height, data } = frame;
  const lum = new Uint8Array(width * height);
  const counts = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = Math.round(data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114);
    counts[lum[i]!]!++;
  }
  // A photo's paper is grey and its ink is not black: stretched so that the paper reads white and
  // the darkest ink black, a head on a dim photo scores as one on a printed page does.
  const level = (share: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) if ((seen += counts[v]!) >= share * lum.length) return v;
    return 255;
  };
  const ink = level(INK_SHARE);
  const paper = level(PAPER_SHARE);
  if (paper - ink >= MIN_CONTRAST)
    for (let i = 0; i < lum.length; i++)
      lum[i] = Math.max(0, Math.min(255, Math.round(((lum[i]! - ink) * 255) / (paper - ink))));
  return {
    width,
    height,
    lum,
    scale,
    space: spacings[Math.floor(spacings.length / 2)]!,
    staves: geometry.staves.map((staff) => ({
      xs: geometry.xs,
      centers: staff.sourceCenters,
      spacings: staff.sourceSpacings,
    })),
  };
}
