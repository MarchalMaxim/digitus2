#!/usr/bin/env node
// engine_dump.mjs: per-note engine output for the weekly teacher review (verification spec 3.12).
// Uses only the built engine's public API (packages/engine/dist/src/index.js) and node: built-ins.
//
//   node research/teacher_review/engine_dump.mjs --out <file.json> [--manifest content/manifest.json]
//        [--slugs a,b] [--tritone] [--pig-dir research/data/pig --pig-pieces 001,002]
//        [--profile medium] [--weight-set <id>]
//
// Paths are relative to the current directory (the repository root). Deterministic for the same
// engine build and inputs.
// A null gap means that no complete path gives that finger (the engine's +Infinity).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import { parseArgs } from 'node:util';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(REPO, 'packages', 'engine', 'dist', 'src', 'index.js');

function fail(message) {
  process.stderr.write(`engine_dump: ${message}\n`);
  process.exit(2);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      out: { type: 'string' },
      manifest: { type: 'string' },
      slugs: { type: 'string' },
      tritone: { type: 'boolean' },
      'pig-dir': { type: 'string' },
      'pig-pieces': { type: 'string' },
      profile: { type: 'string', default: 'medium' },
      'weight-set': { type: 'string' },
    },
  }));
} catch (err) {
  fail(err.message);
}
if (!values.out) fail('--out is required');
if (!values.manifest && !values['pig-pieces'])
  fail('nothing to dump: give --manifest and/or --pig-pieces');
if (!existsSync(DIST)) fail(`no engine build at ${DIST}; run pnpm --filter @digitus2/engine build`);
const E = await import(pathToFileURL(DIST).href);
if (!Object.hasOwn(E.HAND_PROFILES, values.profile)) fail(`unknown profile ${values.profile}`);

// Weight sets arrive with M3 (RECOMMENDED_WEIGHT_SET, WEIGHT_SETS, SolveOptions.weightSet). Before
// that the solver uses its literature defaults (PARNCUTT_WEIGHTS) and the dump says so.
const hasWeightSets = typeof E.RECOMMENDED_WEIGHT_SET === 'string';
let weightSet = null;
if (values['weight-set']) {
  if (!hasWeightSets)
    fail('this engine build has no weight sets (M3 not merged); omit --weight-set');
  if (E.WEIGHT_SETS && !Object.hasOwn(E.WEIGHT_SETS, values['weight-set']))
    fail(`unknown weight set ${values['weight-set']}`);
  weightSet = values['weight-set'];
} else if (hasWeightSets) weightSet = E.RECOMMENDED_WEIGHT_SET;
const solveOpts = { profile: values.profile, ...(weightSet ? { weightSet } : {}) };

function sigAt(score, tick) {
  let sig = { beats: 4, beatType: 4 };
  for (const t of [...score.timeSignatures].sort((a, b) => a.tick - b.tick))
    if (t.tick <= tick) sig = t;
  return sig;
}

function measureAt(measures, tick) {
  let k = -1;
  for (let i = 0; i < measures.length; i++) {
    if (measures[i].startTick <= tick) k = i;
    else break;
  }
  return k;
}

function lintByNote(score, assignment) {
  const report = E.lintFingering(score, assignment, { profile: values.profile });
  const out = new Map();
  for (const issue of report.issues)
    for (const id of issue.noteIds) {
      const list = out.get(id) ?? [];
      const tag = `${issue.rule}:${issue.severity}`;
      if (!list.includes(tag)) list.push(tag);
      out.set(id, list);
    }
  for (const list of out.values()) list.sort();
  return out;
}

// A rest is a silence of at least an eighth in one hand: no note of the hand sounds (the union of
// every earlier note, not only the previous one). Grace notes have no length and are ignored.
function restsOf(score, measures) {
  const out = [];
  for (const hand of ['R', 'L']) {
    let until = null;
    for (const n of score.notes) {
      if (n.hand !== hand || n.isGrace) continue;
      if (until !== null && n.onsetTick - until >= score.divisions / 2) {
        const mi = measureAt(measures, until);
        const m = mi >= 0 ? measures[mi] : null;
        out.push({
          hand,
          startTick: until,
          endTick: n.onsetTick,
          measureIndex: mi,
          measure: m ? m.number : null,
          beatQ: m ? (until - m.startTick) / score.divisions : null,
          durQ: (n.onsetTick - until) / score.divisions,
        });
      }
      until = until === null ? n.offsetTick : Math.max(until, n.offsetTick);
    }
  }
  return out;
}

function dumpScore(score, head) {
  let result;
  try {
    result = E.solveFingering(score, solveOpts);
  } catch (err) {
    fail(`solve failed for ${head.id}: ${err.message}`);
  }
  const lint = lintByNote(score, result.assignment);
  const library = head.source === 'library';
  const measures = library
    ? score.measures.map((m) => {
        const s = sigAt(score, m.startTick);
        return {
          index: m.index,
          number: m.number,
          startTick: m.startTick,
          lengthTicks: m.lengthTicks,
          beats: s.beats,
          beatType: s.beatType,
        };
      })
    : [];
  const notes = score.notes.map((n, index) => {
    const a = result.assignment[n.id];
    const ex = result.explanations[n.id];
    const m = library ? score.measures[n.measureIndex] : undefined;
    return {
      index,
      id: n.id,
      hand: n.hand,
      staff: n.staff,
      voice: n.voice,
      midi: n.midi,
      pitch: E.formatPigPitch(n.spelling),
      onsetTick: n.onsetTick,
      offsetTick: n.offsetTick,
      onsetSec: n.onsetSec,
      offsetSec: n.offsetSec,
      measureIndex: m ? n.measureIndex : null,
      measure: m ? m.number : null,
      beatQ: m ? (n.onsetTick - m.startTick) / score.divisions : null,
      durQ: (n.offsetTick - n.onsetTick) / score.divisions,
      isGrace: n.isGrace,
      chordId: n.chordId,
      tied: n.sourceIndices.length > 1,
      sourceIndex: n.sourceIndices[0] ?? index,
      finger: a ? a.finger : null,
      confidence: a && typeof a.confidence === 'number' ? a.confidence : null,
      gaps: ex && ex.gaps ? ex.gaps.map((g) => (Number.isFinite(g) ? g : null)) : null,
      lint: lint.get(n.id) ?? [],
    };
  });
  return {
    ...head,
    divisions: score.divisions,
    tempoMap: score.tempoMap,
    measures,
    notes,
    rests: library ? restsOf(score, measures) : [],
    solve: result.hands.map((h) => ({
      hand: h.hand,
      relaxed: h.relaxed,
      iterations: h.iterations,
      infeasibleSlices: h.infeasibleSlices.length,
    })),
  };
}

const pieces = [];
if (values.manifest) {
  const manifestPath = resolve(values.manifest);
  if (!existsSync(manifestPath)) fail(`no manifest at ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const want = values.slugs ? values.slugs.split(',') : null;
  if (want)
    for (const s of want) if (!manifest.some((e) => e.slug === s)) fail(`unknown slug ${s}`);
  for (const entry of manifest) {
    if (want && !want.includes(entry.slug)) continue;
    const file = join(dirname(manifestPath), entry.files.score);
    const { score } = E.parseMusicXml(readFileSync(file), { source: entry.slug });
    const base = {
      source: 'library',
      slug: entry.slug,
      title: entry.title,
      composer: entry.composer,
      level: entry.level,
      file: relative(process.cwd(), file).split('\\').join('/'),
    };
    pieces.push(dumpScore(score, { id: entry.slug, ...base, transpose: 0 }));
    if (values.tritone) {
      const midis = score.notes.map((n) => n.midi);
      const t = Math.max(...midis) + 6 <= E.PIANO_MAX ? 6 : -6;
      if (Math.min(...midis) + t < E.PIANO_MIN) {
        process.stderr.write(
          `engine_dump: ${entry.slug} cannot move a tritone inside the piano range; no copy\n`,
        );
        continue;
      }
      pieces.push(
        dumpScore(E.transposeScore(score, t), {
          id: `${entry.slug}@tritone`,
          ...base,
          transpose: t,
        }),
      );
    }
  }
}
if (values['pig-pieces']) {
  const root = resolve(values['pig-dir'] ?? 'research/data/pig');
  const dir = existsSync(join(root, 'FingeringFiles')) ? join(root, 'FingeringFiles') : root;
  const names = existsSync(dir) ? readdirSync(dir) : [];
  for (const id of values['pig-pieces'].split(',')) {
    // Bench's rule (cli/bench.ts scorePiece): the files <id>-<k>_fingering.txt in name order; the
    // first one is the score. Piece ids are digits, so the pattern needs no escaping.
    if (!/^[0-9]+$/.test(id)) fail(`bad PIG piece id ${JSON.stringify(id)}`);
    const files = names.filter((f) => new RegExp(`^${id}-\\d+_fingering\\.txt$`).test(f)).sort();
    if (files.length === 0) fail(`no PIG file for piece ${id} in ${dir}`);
    const { score } = E.parsePig(readFileSync(join(dir, files[0]), 'utf8'), { source: files[0] });
    pieces.push(
      dumpScore(score, { id: `pig:${id}`, source: 'pig', pigId: id, file: files[0], transpose: 0 }),
    );
  }
}

const dump = {
  version: 1,
  engineVersion: E.ENGINE_VERSION,
  profile: values.profile,
  weightSet: weightSet ?? 'parncutt-defaults',
  weightsHash: createHash('sha256')
    .update(JSON.stringify(E.PARNCUTT_WEIGHTS))
    .digest('hex')
    .slice(0, 16),
  lintRules: E.LINT_RULES,
  pieces,
};
mkdirSync(dirname(resolve(values.out)), { recursive: true });
writeFileSync(values.out, JSON.stringify(dump) + '\n');
process.stdout.write(
  `engine_dump: ${pieces.length} pieces, ${pieces.reduce((s, p) => s + p.notes.length, 0)} notes -> ${values.out}\n`,
);
