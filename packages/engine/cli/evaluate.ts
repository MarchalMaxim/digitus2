import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { metricsForScores } from '../src/eval/align.js';
import type { PigMetrics } from '../src/eval/metrics.js';
import { parsePig } from '../src/io/pig/read.js';

export interface EvalReport {
  pieces: Array<{ id: string; predFile: string; goldFiles: string[]; metrics: PigMetrics }>;
  skipped: string[];
  mean: { gen: number; high: number; soft: number; rec: number };
  noteWeighted: { gen: number; high: number; soft: number; rec: number };
}

const GOLD_NAME = /^(\d+)-(\d+)_fingering\.txt$/;
const KEYS = ['gen', 'high', 'soft', 'rec'] as const;

function listFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => join(path, f))
    .sort();
}

function pieceId(file: string): string | undefined {
  const m = /^(\d+)/.exec(basename(file));
  return m ? String(Number(m[1])) : undefined;
}

export function evaluateDirs(predPath: string, goldPath: string): EvalReport {
  const goldDir = existsSync(join(goldPath, 'FingeringFiles'))
    ? join(goldPath, 'FingeringFiles')
    : goldPath;
  const goldFiles = listFiles(goldDir);
  const goldByPiece = new Map<string, string[]>();
  for (const f of goldFiles) {
    const m = GOLD_NAME.exec(basename(f));
    if (!m) continue;
    const id = String(Number(m[1]));
    if (!goldByPiece.has(id)) goldByPiece.set(id, []);
    goldByPiece.get(id)!.push(f);
  }
  const report: EvalReport = { pieces: [], skipped: [], mean: zero(), noteWeighted: zero() };
  let totalNotes = 0;
  for (const predFile of listFiles(predPath)) {
    const id = pieceId(predFile);
    const golds = id !== undefined ? goldByPiece.get(id) : undefined;
    if (id === undefined || !golds || golds.length === 0) {
      report.skipped.push(basename(predFile));
      continue;
    }
    const pred = parsePig(readFileSync(predFile, 'utf8'));
    const metrics = metricsForScores(
      pred,
      golds.map((g) => parsePig(readFileSync(g, 'utf8'))),
    );
    report.pieces.push({ id, predFile, goldFiles: golds, metrics });
    for (const k of KEYS) {
      report.mean[k] += metrics[k];
      report.noteWeighted[k] += metrics[k] * metrics.notes;
    }
    totalNotes += metrics.notes;
  }
  const count = report.pieces.length;
  for (const k of KEYS) {
    report.mean[k] = count ? report.mean[k] / count : 0;
    report.noteWeighted[k] = totalNotes ? report.noteWeighted[k] / totalNotes : 0;
  }
  return report;
}

function zero() {
  return { gen: 0, high: 0, soft: 0, rec: 0 };
}

export function formatReport(r: EvalReport): string {
  const pct = (x: number) => (100 * x).toFixed(2).padStart(6);
  const lines = ['piece    gen    high   soft   rec    notes'];
  for (const p of r.pieces) {
    const m = p.metrics;
    lines.push(
      `${p.id.padEnd(6)} ${pct(m.gen)} ${pct(m.high)} ${pct(m.soft)} ${pct(m.rec)} ${String(m.notes).padStart(6)}`,
    );
  }
  lines.push(
    `mean   ${pct(r.mean.gen)} ${pct(r.mean.high)} ${pct(r.mean.soft)} ${pct(r.mean.rec)}`,
  );
  const w = r.noteWeighted;
  lines.push(`notes  ${pct(w.gen)} ${pct(w.high)} ${pct(w.soft)} ${pct(w.rec)}`);
  if (r.skipped.length) lines.push(`skipped (no gold): ${r.skipped.join(', ')}`);
  return lines.join('\n');
}
