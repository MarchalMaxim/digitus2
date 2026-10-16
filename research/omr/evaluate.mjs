#!/usr/bin/env node
// Compare whole-score OMR exports to the pinned MusicXML in a prepared fixture corpus.
// This measures recognition output; it does not run a recognizer or certify shipping quality.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const METRICS = ['pitch', 'onsetPitch', 'duration', 'staff', 'voice', 'fullNote'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function containedPath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path))
    throw new Error('reference must be a relative file path');
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
    throw new Error(`reference escapes the corpus: ${path}`);
  return absolute;
}

export function validateCorpus(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.pieces) || !manifest.pieces.length)
    throw new Error('expected a schemaVersion 1 corpus with at least one piece');
  const ids = new Set();
  for (const piece of manifest.pieces) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(piece?.id ?? ''))
      throw new Error('invalid corpus piece id');
    if (ids.has(piece.id)) throw new Error(`duplicate piece: ${piece.id}`);
    ids.add(piece.id);
    if (!/^[a-f0-9]{64}$/.test(piece.sha256 ?? ''))
      throw new Error(`missing SHA-256 for ${piece.id}`);
    if (typeof piece.reference !== 'string' || !piece.reference)
      throw new Error(`missing reference for ${piece.id}`);
  }
  return manifest;
}

function rates(matched, reference, recognized) {
  return {
    matched,
    reference,
    recognized,
    precision: recognized ? matched / recognized : reference ? 0 : 1,
    recall: reference ? matched / reference : recognized ? 0 : 1,
    f1: reference + recognized ? (2 * matched) / (reference + recognized) : 1,
  };
}

export function summarize(pieces) {
  const metrics = Object.fromEntries(
    METRICS.map((name) => {
      const rows = pieces.map((p) => p.evaluation.metrics[name]);
      const total = (key) => rows.reduce((sum, r) => sum + r[key], 0);
      return [
        name,
        {
          ...rates(total('matched'), total('reference'), total('recognized')),
          macroF1: rows.reduce((sum, r) => sum + r.f1, 0) / rows.length,
        },
      ];
    }),
  );
  return {
    pieces: pieces.length,
    parsed: pieces.filter((p) => p.status === 'parsed').length,
    failed: pieces.filter((p) => p.status !== 'parsed').length,
    missingBars: pieces.reduce((sum, p) => sum + p.evaluation.missingBars, 0),
    extraBars: pieces.reduce((sum, p) => sum + p.evaluation.extraBars, 0),
    barTimingMismatches: pieces.reduce((sum, p) => sum + p.evaluation.barTimingMismatches, 0),
    metrics,
  };
}

export async function evaluateCorpus({ manifestPath, recognizedDir, candidate, out, engine }) {
  if (typeof candidate !== 'string' || !candidate.trim())
    throw new Error('--candidate is required');
  if (!manifestPath || !recognizedDir) throw new Error('--manifest and --recognized are required');
  const E =
    engine ??
    (await import(pathToFileURL(resolve(REPO, 'packages/engine/dist/src/index.js')).href));
  const manifestFile = resolve(manifestPath);
  const manifestBytes = readFileSync(manifestFile);
  const corpus = validateCorpus(JSON.parse(manifestBytes.toString('utf8')));
  const base = dirname(manifestFile);

  // Validate all ground truth before evaluating any candidate. A damaged reference is a broken
  // experiment, not a recognition failure; do not silently drop it from the denominator.
  const references = corpus.pieces.map((piece) => {
    const bytes = readFileSync(containedPath(base, piece.reference));
    if (hash(bytes) !== piece.sha256) throw new Error(`reference hash mismatch: ${piece.id}`);
    const parsed = E.parseMusicXml(new Uint8Array(bytes), { preserveNotation: true });
    if (!parsed.score.notes.length) throw new Error(`empty reference score: ${piece.id}`);
    return { piece, parsed };
  });

  const pieces = references.map(({ piece, parsed }) => {
    const files = ['musicxml', 'mxl', 'xml']
      .map((ext) => resolve(recognizedDir, `${piece.id}.${ext}`))
      .filter(existsSync);
    const result = {
      id: piece.id,
      referenceSha256: piece.sha256,
      referenceWarnings: parsed.warnings,
      recognizedSha256: null,
      recognizedFile: null,
      status: 'missing',
      error: null,
      warnings: [],
      evaluation: null,
    };
    let score = { ...parsed.score, notes: [], measures: [] };
    if (files.length > 1) {
      result.status = 'invalid';
      result.error = 'ambiguous output: more than one .musicxml/.mxl/.xml file for this piece';
    } else if (files.length === 1) {
      result.recognizedFile = relative(resolve(recognizedDir), files[0]).replaceAll('\\', '/');
      try {
        const bytes = readFileSync(files[0]);
        result.recognizedSha256 = hash(bytes);
        const recognized = E.parseMusicXml(new Uint8Array(bytes), { preserveNotation: true });
        // Validate recognized score inside the catch: unsupported/invalid parses are failures,
        // retained in the scorecard with zero matches, never skipped.
        E.evaluateOmr(parsed.score, recognized.score);
        score = recognized.score;
        result.warnings = recognized.warnings;
        result.status = 'parsed';
      } catch (error) {
        result.status = 'invalid';
        result.error = error.message;
      }
    } else result.error = 'no whole-score MusicXML export found';
    result.evaluation = E.evaluateOmr(parsed.score, score);
    return result;
  });

  const report = {
    schemaVersion: 1,
    candidate: candidate.trim(),
    corpusSha256: hash(manifestBytes),
    method: 'ordinal-bar-exact-projections-v1',
    rates: '0..1; micro counts plus macro F1 over every requested piece, including failures',
    recognitionExecuted: false,
    summary: summarize(pieces),
    pieces,
  };
  if (out) {
    const target = resolve(out);
    // Scorecards are append-only by filename; never replace a fixture or earlier result.
    if (existsSync(target)) throw new Error(`output already exists: ${target}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  }
  return report;
}

export async function main(args) {
  try {
    const { values } = parseArgs({
      args,
      options: {
        manifest: { type: 'string' },
        recognized: { type: 'string' },
        candidate: { type: 'string' },
        out: { type: 'string' },
        help: { type: 'boolean' },
      },
    });
    if (values.help) {
      console.log(
        'node research/omr/evaluate.mjs --manifest corpus/manifest.json --recognized exports --candidate NAME --out result.json',
      );
      return 0;
    }
    if (!values.out) throw new Error('--out is required');
    const report = await evaluateCorpus({
      manifestPath: values.manifest,
      recognizedDir: values.recognized,
      candidate: values.candidate,
      out: values.out,
    });
    console.log(JSON.stringify(report.summary, null, 2));
    return report.summary.failed ? 1 : 0;
  } catch (error) {
    console.error(`OMR evaluation: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await main(process.argv.slice(2));
