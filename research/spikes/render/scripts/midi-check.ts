// THROWAWAY: checks src/snippets/midi-notes.ts against the generated tempo-map fixture (expected bar 5 = 10 s, bar 7 = 18 s, last RH = 21.5 s).
import { readFileSync } from 'node:fs';
import { midiToNotes } from '../src/snippets/midi-notes';
const { ppq, tempos, notes } = midiToNotes(new Uint8Array(readFileSync(new URL('../fixtures/tempo-map.mid', import.meta.url))));
const rh = notes.filter((n) => n.channel === 0);
console.log({ ppq, tempos: tempos.length, notes: notes.length, bar5: rh[16].onsetSec, bar7: rh[24].onsetSec, lastRh: rh.at(-1)!.onsetSec });
