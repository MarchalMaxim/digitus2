// THROWAWAY spike: download the 30-file Salamander Grand Piano subset (every minor third, A0..C8)
// that the Tone.js examples use, so Tone.Sampler can be measured with SELF-HOSTED samples.
// Samples: Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0. Output is gitignored.
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples', 'salamander');
mkdirSync(outDir, { recursive: true });
const BASE = 'https://tonejs.github.io/audio/salamander/';
const names = ['A0'];
for (let o = 1; o <= 7; o++) names.push(`C${o}`, `Ds${o}`, `Fs${o}`, `A${o}`);
names.push('C8');
let total = 0;
for (const n of names) {
  const file = join(outDir, n + '.mp3');
  if (!existsSync(file)) {
    const res = await fetch(BASE + n + '.mp3');
    if (!res.ok) throw new Error(`${n}: HTTP ${res.status}`);
    writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
  }
  total += statSync(file).size;
}
console.log(`${names.length} files, ${(total / 1024 / 1024).toFixed(2)} MiB in ${outDir}`);
