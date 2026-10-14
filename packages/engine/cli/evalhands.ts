import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { evaluateHands } from '../src/eval/hands.js';
import { HAND_MOTION, loadHandMotion } from '../src/io/midi/motion.js';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { parsePig } from '../src/io/pig/read.js';
import { benchmarkEntries, CORE_BENCHMARK_SET } from '../src/library/benchmarkSet.js';
import type { Score } from '../src/score/types.js';
import { ENGINE_VERSION } from '../src/version.js';

export interface EvalHandsOptions {
  gold?: string;
  split?: string;
  splitName?: string;
  subset?: 'test' | 'train';
  library?: string;
  /** Benchmark set of the library manifest, default core30; 'all' scores every piece. */
  librarySet?: string;
  params?: string;
  out?: string;
  label?: string;
  floor?: string;
}
export interface HandPieceResult {
  id: string;
  notes: number;
  accuracy: number;
  ms: number;
}
export interface HandSetResult {
  macro: number;
  noteWeighted: number;
  pieces: HandPieceResult[];
  skipped: Array<{ id: string; reason: string }>;
}
export interface HandsScorecard {
  version: 1;
  engineVersion: string;
  gitSha: string;
  label: string;
  timestamp: string;
  params: { file: string; sha256: string };
  handSeparation: { accuracy: number | null };
  pig: (HandSetResult & { split: string; splitName: string; subset: string }) | null;
  library: (HandSetResult & { manifest: string; set: string }) | null;
}

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scoreSet(
  items: Array<{ id: string; load: () => Score | string }>,
  params = HAND_MOTION,
): HandSetResult {
  const pieces: HandPieceResult[] = [];
  const skipped: HandSetResult['skipped'] = [];
  for (const item of items) {
    try {
      const loaded = item.load();
      if (typeof loaded === 'string') {
        skipped.push({ id: item.id, reason: loaded });
        continue;
      }
      const t0 = performance.now();
      const r = evaluateHands(loaded, { params });
      pieces.push({
        id: item.id,
        notes: r.notes,
        accuracy: r.accuracy,
        ms: performance.now() - t0,
      });
    } catch (e) {
      skipped.push({ id: item.id, reason: message(e) });
    }
  }
  const notes = pieces.reduce((s, p) => s + p.notes, 0);
  return {
    macro: pieces.length ? pieces.reduce((s, p) => s + p.accuracy, 0) / pieces.length : 0,
    noteWeighted: notes ? pieces.reduce((s, p) => s + p.accuracy * p.notes, 0) / notes : 0,
    pieces,
    skipped,
  };
}

export function runEvalHands(o: EvalHandsOptions): {
  scorecard: HandsScorecard;
  floorBreaches: string[];
} {
  const paramsText = o.params ? readFileSync(o.params, 'utf8') : JSON.stringify(HAND_MOTION);
  const params = o.params ? loadHandMotion(JSON.parse(paramsText)) : HAND_MOTION;
  let pig: HandsScorecard['pig'] = null;
  if (o.gold && o.split) {
    const json = JSON.parse(readFileSync(o.split, 'utf8')) as {
      default_split?: string;
      splits: Record<string, Record<string, { pieces: string[] }>>;
    };
    const subset = o.subset ?? 'test';
    const splitName = o.splitName ?? json.default_split ?? Object.keys(json.splits)[0]!;
    const ids = json.splits[splitName]?.[subset]?.pieces;
    if (!ids) throw new Error(`split ${splitName}/${subset} not found in ${o.split}`);
    const dir = existsSync(join(o.gold, 'FingeringFiles'))
      ? join(o.gold, 'FingeringFiles')
      : o.gold;
    const files = readdirSync(dir);
    const set = scoreSet(
      ids.map((id) => ({
        id,
        load: () => {
          const first = files
            .filter((f) => new RegExp(`^${escapeRegExp(id)}-\\d+_fingering\\.txt$`).test(f))
            .sort()[0];
          return first ? parsePig(readFileSync(join(dir, first), 'utf8')).score : 'no gold file';
        },
      })),
      params,
    );
    pig = { ...set, split: o.split, splitName, subset };
  }
  let library: HandsScorecard['library'] = null;
  if (o.library) {
    const manifestPath = o.library;
    const entries = JSON.parse(readFileSync(manifestPath, 'utf8')) as Array<{
      slug: string;
      benchmarkSet?: string | null;
      files: { score: string };
    }>;
    const librarySet = o.librarySet ?? CORE_BENCHMARK_SET;
    const set = scoreSet(
      benchmarkEntries(entries, librarySet).map((e) => ({
        id: e.slug,
        load: () =>
          parseMusicXml(readFileSync(resolve(dirname(manifestPath), e.files.score))).score,
      })),
      params,
    );
    library = { ...set, manifest: manifestPath, set: librarySet };
  }
  const scorecard: HandsScorecard = {
    version: 1,
    engineVersion: ENGINE_VERSION,
    gitSha: gitSha(),
    label: o.label ?? 'evalhands',
    timestamp: new Date().toISOString(),
    params: {
      file: o.params ?? 'packages/engine/src/io/midi/params/hand-motion.json',
      sha256: createHash('sha256').update(paramsText).digest('hex').slice(0, 16),
    },
    handSeparation: { accuracy: pig ? pig.macro : null },
    pig,
    library,
  };
  if (o.out) {
    mkdirSync(dirname(o.out), { recursive: true });
    writeFileSync(o.out, JSON.stringify(scorecard, null, 2) + '\n');
  }
  const floorBreaches: string[] = [];
  if (o.floor && existsSync(o.floor)) {
    const floor = JSON.parse(readFileSync(o.floor, 'utf8')) as {
      hands?: { accuracyMin?: number | null };
    };
    const min = floor.hands?.accuracyMin;
    if (typeof min === 'number') {
      if (!pig || pig.pieces.length === 0)
        floorBreaches.push('no PIG pieces were scored against the hand floor');
      else if (pig.macro < min - 0.005)
        floorBreaches.push(`hand accuracy ${pig.macro.toFixed(2)} below floor ${min.toFixed(2)}`);
    }
  }
  return { scorecard, floorBreaches };
}

export function formatHandsScorecard(card: HandsScorecard): string {
  const lines = [
    `evalhands ${card.label} @ ${card.gitSha.slice(0, 7)} engine ${card.engineVersion} params ${card.params.sha256}`,
  ];
  const describe = (name: string, set: HandSetResult) => {
    const count = `${set.pieces.length} piece${set.pieces.length === 1 ? '' : 's'}`;
    lines.push(
      `${name}: ${count}, ${set.skipped.length} skipped, macro ${set.macro.toFixed(2)} %, note-weighted ${set.noteWeighted.toFixed(2)} %`,
    );
    const worst = [...set.pieces].sort((a, b) => a.accuracy - b.accuracy).slice(0, 3);
    if (worst.length)
      lines.push(`  weakest: ${worst.map((p) => `${p.id} ${p.accuracy.toFixed(1)}`).join(', ')}`);
    for (const s of set.skipped) lines.push(`  skipped ${s.id}: ${s.reason}`);
  };
  if (card.pig) describe(`pig ${card.pig.splitName}/${card.pig.subset}`, card.pig);
  if (card.library) describe('library', card.library);
  return lines.join('\n');
}
