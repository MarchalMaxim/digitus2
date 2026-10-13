// THROWAWAY: verifies the doc snippets in Node: setFingering() + Verovio (WASM runs in Node too) + our reader.
//   ./node_modules/.bin/tsx scripts/snippet-check.ts
import { readFileSync } from 'node:fs';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { setFingering } from '../src/snippets/fingering-xml';
import { fromTxml } from '../src/model/xml';
import { buildScore } from '../src/model/musicxml';

const xml = readFileSync(new URL('../fixtures/short-piano.musicxml', import.meta.url), 'utf8');
let edited = setFingering(xml, 'n10', '2');            // change an existing digit (was 4)
edited = setFingering(edited, 'n15', '5', 'below');     // add a digit to a note that had none (tie continuation)
const model = buildScore(fromTxml(edited));
console.log('reader: n10 =', model.allNotes.find((n) => n.id === 'n10')?.fingering, ', n15 =', model.allNotes.find((n) => n.id === 'n15')?.fingering);
const t0 = performance.now();
const tk = new VerovioToolkit(await createVerovioModule());
const t1 = performance.now();
tk.setOptions({ svgAdditionalAttribute: ['fing@startid'], breaks: 'auto', pageWidth: 3000, adjustPageHeight: true });
for (const [label, data] of [['original', xml], ['edited', edited]] as const) {
  const t2 = performance.now();
  tk.loadData(data);
  const svg = tk.renderToSVG(1);
  const ms = performance.now() - t2;
  const fings = (svg.match(/class="fing"/g) ?? []).length;
  const n10 = /data-startid="#n10"[\s\S]*?<tspan font-size="\d+px">(\d)</.exec(svg)?.[1];
  console.log(`verovio ${label}: ${fings} fingering groups, n10 digit ${n10}, n15 has digit: ${svg.includes('data-startid="#n15"')}, ${ms.toFixed(0)} ms (node, wasm init ${(t1 - t0).toFixed(0)} ms)`);
}
