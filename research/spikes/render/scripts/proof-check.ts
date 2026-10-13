// THROWAWAY: checks that the ~50-line proof (src/model/proof.ts) agrees with the full spike reader.
//   ./node_modules/.bin/tsx scripts/proof-check.ts
import { readFileSync } from 'node:fs';
import { unpack, readNotes } from '../src/model/proof';
import { fromXmldom } from '../src/model/xml';
import { buildScore } from '../src/model/musicxml';
for (const f of ['short-piano.mxl', 'short-piano.musicxml', 'long-120.musicxml']) {
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/' + f, import.meta.url)));
  const t0 = performance.now();
  const notes = readNotes(unpack(bytes));
  const ms = performance.now() - t0;
  const full = buildScore(fromXmldom(unpack(bytes))).notes; // playable notes, ties merged
  const key = (n: { midi: number; onsetQ: number }) => n.midi + '@' + n.onsetQ.toFixed(4);
  const fullByKey = new Map(full.map((n) => [key(n), n]));
  let same = 0;
  for (const n of notes) { const o = fullByKey.get(key(n)); if (o && Math.abs(o.durationQ - n.durQ) < 1e-6 && o.hand === n.hand && (o.fingering ?? '') === (n.finger ?? '') && (n.grace || Math.abs(o.onsetSec - n.onsetSec) < 1e-6)) same++; }
  const m2 = notes.find((n) => n.hand === 'R' && n.onsetQ >= 4 && !n.grace)!;
  console.log(f.padEnd(22), `${notes.length} notes (full reader ${full.length}), identical ${same}, ${ms.toFixed(1)} ms; first RH note of bar 2: midi ${m2.midi} at ${m2.onsetSec.toFixed(3)} s finger ${m2.finger}; LH notes ${notes.filter((n) => n.hand === 'L').length}`);
}
