import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { benchmarkEntries } from '../../library/benchmarkSet.js';
import type { Note } from '../../score/types.js';
import { parseMusicXml } from '../musicxml/read.js';
import { scoreToMusicXml } from './engrave.js';

const repo = new URL('../../../../../', import.meta.url);
// The engraver supports the rhythms of the first 30 pieces, so the round trip runs on the core
// benchmark set (L1 plan, decision 12).
const manifest = benchmarkEntries(
  JSON.parse(readFileSync(fileURLToPath(new URL('content/manifest.json', repo)), 'utf8')) as Array<{
    slug: string;
    benchmarkSet?: string | null;
    files: { score: string };
  }>,
);
const noteKey = (n: Note) => `${n.onsetTick}:${n.offsetTick}:${n.midi}:${n.hand}`;

describe('engraving round trip on the built-in library', () => {
  it.each(manifest.map((p) => [p.slug, p.files.score] as const))(
    '%s: MusicXML -> Score -> MusicXML -> Score keeps every note',
    (_slug, file) => {
      const first = parseMusicXml(
        readFileSync(fileURLToPath(new URL(`content/${file}`, repo))),
      ).score;
      const { score: second, warnings } = parseMusicXml(scoreToMusicXml(first));
      expect(second.notes.map(noteKey).sort()).toEqual(first.notes.map(noteKey).sort());
      expect(second.divisions).toBe(first.divisions);
      expect(second.measures.map((m) => [m.startTick, m.lengthTicks])).toEqual(
        first.measures.map((m) => [m.startTick, m.lengthTicks]),
      );
      expect(second.tempoMap.map((t) => [t.tick, t.qpm])).toEqual(
        first.tempoMap.map((t) => [t.tick, Number(t.qpm.toFixed(4))]),
      );
      expect(warnings.filter((w) => /tie/.test(w))).toEqual([]);
    },
    20_000,
  );
});
