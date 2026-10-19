// `digitus2 embellish`: the light embellishment of one file (issue #67), and the library gate that
// `pnpm verify` runs as the step `embellish`. The gate runs the app's guard on every piece at the
// chosen levels, then verifies each offered piece again on its own: the independent check with every
// strong position kept, a fresh beginner lint at every hand size against the plain score solved
// afresh, and the level heuristic at most one level up.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { checkEmbellishment } from '../src/embellish/check.js';
import { embellishMusicXml } from '../src/embellish/embellish.js';
import type { InsertedNote } from '../src/embellish/embellish.js';
import {
  EMBELLISH_MIN_FIGURES,
  GUARD_PROFILES,
  guardEmbellishment,
  guardErrors,
} from '../src/embellish/guard.js';
import type { GuardRefusal } from '../src/embellish/guard.js';
import { levelFeatures, levelScore, proposeLevel, round3 } from '../src/embellish/level.js';
import { RECOMMENDED_WEIGHT_SET } from '../src/fingering/params/weightSets.js';
import { solveFingering } from '../src/fingering/solve.js';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { lintFingering } from '../src/lint/index.js';
import type { Score } from '../src/score/types.js';
import { ENGINE_VERSION } from '../src/version.js';
import { readLibraryScore } from './libraryScore.js';

export interface EmbellishFileOptions {
  file: string;
  out?: string;
  inserted?: string;
  /** Run the app's guard (`guardEmbellishment`) and write what the app would offer. */
  guard?: boolean;
}

/**
 * The light embellishment of one MusicXML file (gzip, .mxl or plain). With `out` the XML is written
 * there, with `inserted` the inserted-note records as JSON. A refusal writes nothing.
 */
export function embellishFile(o: EmbellishFileOptions): {
  xml: string | null;
  inserted: InsertedNote[];
  refusal: string | null;
} {
  const plain = readLibraryScore(o.file);
  let xml: string;
  let inserted: InsertedNote[];
  if (o.guard) {
    const g = guardEmbellishment(plain);
    if (g.offered === null) return { xml: null, inserted: [], refusal: g.reason };
    ({ xml, inserted } = g.offered);
  } else {
    const r = embellishMusicXml(plain);
    if (r.refusal !== null) return { xml: null, inserted: [], refusal: r.refusal };
    ({ xml, inserted } = r);
  }
  if (o.out) writeFileSync(o.out, xml);
  if (o.inserted) writeFileSync(o.inserted, JSON.stringify(inserted, null, 2) + '\n');
  return { xml, inserted, refusal: null };
}

export interface EmbellishGateOptions {
  library: string;
  /** Manifest levels to gate; default 1 and 2. */
  levels?: number[];
  floor?: string;
  out?: string;
}

export interface EmbellishRow {
  slug: string;
  offered: boolean;
  /** Figures offered; null when the piece is not offered. */
  figures: number | null;
  droppedBars: number[];
  /** Why the piece is not offered; null when it is. */
  reason: string | null;
  /** Who refused the piece (the guard's `kind`); null when it is offered. */
  kind: GuardRefusal | null;
  /** The level heuristic's proposal (`level.ts`) for the plain score. */
  plainLevel: number;
  /** The proposal for the embellished score; null when the piece is not offered. */
  level: number | null;
}

export interface EmbellishScorecard {
  version: 1;
  engineVersion: string;
  manifest: string;
  levels: number[];
  pieces: number;
  /** Refused by the embellisher (or unreadable). */
  refused: number;
  /** Fewer than three figures on the first pass. */
  tooFew: number;
  /** Refused by the guard: the check, lint errors, or too few figures after the retry. */
  guardRefused: number;
  offered: number;
  /** Figures (notes added) over the offered pieces, and of them each rule. */
  figures: number;
  passing: number;
  neighbour: number;
  /** Offered pieces that passed only after the retry dropped the figures of some bars. */
  retried: number;
  /** Embellished level minus plain level over the offered pieces, by difference ("-1", "0", "+1"). */
  levelChange: Record<string, number>;
  seconds: number;
  rows: EmbellishRow[];
}

interface ManifestEntry {
  slug: string;
  level: number;
  tempoBpm: number;
  files: { score: string };
}

const proposal = (score: Score, tempoBpm: number) =>
  proposeLevel(round3(levelScore(levelFeatures(score, tempoBpm))));

const signed = (d: number) => (d > 0 ? `+${d}` : String(d));

/** The floor breach `runEmbellishGate` reports; every other failure is a gate failure. */
const FLOOR_BREACH = /^offered \d+ < \d+$|^floor file /;
export const isFloorBreach = (failure: string) => FLOOR_BREACH.test(failure);

/**
 * The library gate: the guard on every manifest piece at `levels`, each offered piece verified
 * again independently. A failure is `<slug>: <what>` for an offered piece that fails its
 * verification, or `offered N < M` when fewer pieces are offered than `embellish.offeredMin` in
 * the floor file. A named floor file that is missing throws.
 */
export function runEmbellishGate(o: EmbellishGateOptions): {
  scorecard: EmbellishScorecard;
  failures: string[];
} {
  if (o.floor && !existsSync(o.floor)) throw new Error(`floor file not found: ${o.floor}`);
  const t0 = performance.now();
  const levels = o.levels ?? [1, 2];
  const entries = (JSON.parse(readFileSync(o.library, 'utf8')) as ManifestEntry[]).filter((e) =>
    levels.includes(e.level),
  );
  const failures: string[] = [];
  const rows: EmbellishRow[] = [];
  const card = {
    refused: 0,
    tooFew: 0,
    guardRefused: 0,
    offered: 0,
    figures: 0,
    passing: 0,
    neighbour: 0,
    retried: 0,
  };
  const levelChange: Record<string, number> = { '-1': 0, '0': 0, '+1': 0 };
  for (const e of entries) {
    const plainXml = readLibraryScore(resolve(dirname(o.library), e.files.score));
    const plain = parseMusicXml(plainXml).score;
    const plainLevel = proposal(plain, e.tempoBpm);
    const g = guardEmbellishment(plainXml);
    if (g.offered === null) {
      if (g.kind === 'few-figures') card.tooFew++;
      else if (g.kind === 'guard') card.guardRefused++;
      else card.refused++;
      rows.push({
        slug: e.slug,
        offered: false,
        figures: null,
        droppedBars: [],
        reason: g.reason,
        kind: g.kind,
        plainLevel,
        level: null,
      });
      continue;
    }
    const emb = g.offered;
    const fail = (what: string) => failures.push(`${e.slug}: ${what}`);
    card.offered++;
    card.figures += emb.figures;
    for (const i of emb.inserted) {
      if (i.rule === 'passing') card.passing++;
      else card.neighbour++;
    }
    if (emb.droppedBars.length) card.retried++;

    const c = checkEmbellishment(plainXml, emb.xml, emb.inserted, emb.melodyVoice);
    if (!c.ok) fail(`check: ${c.problems.join('; ')}`);
    if (c.strongKept < c.strongTotal)
      fail(`strong positions kept ${c.strongKept} of ${c.strongTotal}`);
    if (emb.figures !== emb.inserted.length || emb.figures < EMBELLISH_MIN_FIGURES)
      fail(`${emb.figures} figures offered`);
    for (const profile of GUARD_PROFILES) {
      const assignment = emb.assignments[profile];
      if (!assignment) {
        fail(`no ${profile} assignment`);
        continue;
      }
      const errs = guardErrors(lintFingering(emb.score, assignment, { profile, beginner: true }));
      const plainAssignment = solveFingering(plain, {
        profile,
        weightSet: RECOMMENDED_WEIGHT_SET,
      }).assignment;
      const plainBeginner = guardErrors(
        lintFingering(plain, plainAssignment, { profile, beginner: true }),
      ).beginner.length;
      if (errs.law.length)
        fail(`${errs.law.length} law error${errs.law.length === 1 ? '' : 's'} at ${profile}`);
      if (errs.beginner.length > plainBeginner)
        fail(`${errs.beginner.length} beginner errors at ${profile} > ${plainBeginner} plain`);
    }
    const level = proposal(emb.score, e.tempoBpm);
    if (level > plainLevel + 1) fail(`level ${level} > ${plainLevel} + 1`);
    const d = signed(level - plainLevel);
    levelChange[d] = (levelChange[d] ?? 0) + 1;
    rows.push({
      slug: e.slug,
      offered: true,
      figures: emb.figures,
      droppedBars: emb.droppedBars,
      reason: null,
      kind: null,
      plainLevel,
      level,
    });
  }

  if (o.floor) {
    const floor = JSON.parse(readFileSync(o.floor, 'utf8')) as {
      embellish?: { offeredMin?: number | null; levels?: number[] };
    };
    const min = floor.embellish?.offeredMin;
    const floorLevels = floor.embellish?.levels;
    if (typeof min !== 'number')
      failures.push(`floor file ${o.floor} sets no embellish.offeredMin`);
    else if (floorLevels && floorLevels.join(',') !== levels.join(','))
      failures.push(
        `floor file levels ${floorLevels.join(',')} differ from the run's ${levels.join(',')}`,
      );
    else if (card.offered < min) failures.push(`offered ${card.offered} < ${min}`);
  }

  const scorecard: EmbellishScorecard = {
    version: 1,
    engineVersion: ENGINE_VERSION,
    manifest: o.library,
    levels,
    pieces: entries.length,
    ...card,
    levelChange,
    seconds: Math.round((performance.now() - t0) / 100) / 10,
    rows,
  };
  if (o.out) {
    mkdirSync(dirname(o.out), { recursive: true });
    writeFileSync(o.out, JSON.stringify(scorecard, null, 2) + '\n');
  }
  return { scorecard, failures };
}

export function formatEmbellishScorecard(s: EmbellishScorecard): string {
  // '0' is an integer key, so JavaScript lists it before '-1'; sort by the difference.
  const change = Object.entries(s.levelChange)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([d, n]) => `${d} ${n}`)
    .join(', ');
  const lines = [
    `embellish light, levels ${s.levels.join(', ')}, engine ${s.engineVersion}: offered ${s.offered} of ${s.pieces} in ${s.seconds} s`,
    `  refused ${s.refused}, fewer than three figures ${s.tooFew}, guard refused ${s.guardRefused}`,
    `  ${s.figures} notes added (${s.passing} passing, ${s.neighbour} neighbour), ${s.retried} offered after the retry`,
    `  level change: ${change}`,
  ];
  for (const r of s.rows)
    if (r.kind === 'guard') lines.push(`  guard refused ${r.slug}: ${r.reason}`);
  return lines.join('\n');
}
