import { readFileSync } from 'node:fs';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { parsePig } from '../src/io/pig/read.js';
import type { Score } from '../src/score/types.js';

export function loadScore(file: string): Score {
  if (/\.txt$/i.test(file)) return parsePig(readFileSync(file, 'utf8'), { source: file }).score;
  return parseMusicXml(readFileSync(file), { source: file }).score;
}

export function describeScore(score: Score): string {
  const right = score.notes.filter((n) => n.hand === 'R').length;
  const left = score.notes.length - right;
  const end = score.notes.reduce((m, n) => Math.max(m, n.offsetSec), 0);
  const lines = [
    `title:     ${score.meta.title ?? '-'}`,
    `composer:  ${score.meta.composer ?? '-'}`,
    `notes:     ${score.notes.length} (right ${right}, left ${left})`,
    `measures:  ${score.measures.length}`,
    `duration:  ${end.toFixed(1)} s`,
    `tempo:     ${score.tempoMap.map((t) => `${t.qpm} qpm @${t.tick}`).join(', ')}`,
    'first notes:',
  ];
  for (const n of score.notes.slice(0, 5)) {
    lines.push(
      `  ${n.id.padEnd(6)} ${n.hand} midi ${n.midi} tick ${n.onsetTick}-${n.offsetTick} (${n.onsetSec.toFixed(3)} s)`,
    );
  }
  return lines.join('\n');
}
