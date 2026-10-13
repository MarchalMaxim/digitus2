// THROWAWAY spike: MusicXML reader cost in Node (engine tests / CLI / worker-like env, no DOMParser).
//   ./node_modules/.bin/tsx scripts/parse-bench-node.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fromTxml, fromRgrove, fromFastXmlParser, fromXmldom } from '../src/model/xml';
import { buildScore } from '../src/model/musicxml';
import { mxlToXml } from '../src/model/mxl';

const fx = (f: string) => new URL('../fixtures/' + f, import.meta.url);
const long = readFileSync(fx('long-120.musicxml'), 'utf8');
const longMxl = new Uint8Array(readFileSync(fx('long-120.mxl')));
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const out: Record<string, unknown> = { node: process.version, fixture: 'long-120.musicxml (400 KB, 1473 notes)' };
for (const [name, parse] of Object.entries({ txml: fromTxml, '@rgrove/parse-xml': fromRgrove, 'fast-xml-parser': fromFastXmlParser, '@xmldom/xmldom': fromXmldom })) {
  const parseMs: number[] = [], totalMs: number[] = [];
  for (let i = 0; i < 12; i++) {
    const t0 = performance.now(); const tree = parse(long); const t1 = performance.now(); buildScore(tree); const t2 = performance.now();
    parseMs.push(t1 - t0); totalMs.push(t2 - t0);
  }
  out[name] = { parseToTreeMedianMs: +med(parseMs.slice(2)).toFixed(1), parsePlusBuildMedianMs: +med(totalMs.slice(2)).toFixed(1), firstRunMs: +totalMs[0].toFixed(1) };
}
const unz: number[] = [];
for (let i = 0; i < 12; i++) { const t0 = performance.now(); mxlToXml(longMxl); unz.push(performance.now() - t0); }
out['fflate .mxl unzip'] = { medianMs: +med(unz.slice(2)).toFixed(2) };
console.log(JSON.stringify(out, null, 1));
writeFileSync(new URL('../results/parse-bench-node.json', import.meta.url), JSON.stringify(out, null, 1));
