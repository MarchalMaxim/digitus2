// Loads every listening file in Verovio, the app's renderer (the verovio package of apps/web), and checks:
//   - the file loads, has at least one page, and page 1 renders to SVG with no error in Verovio's log;
//   - the light and playful versions have exactly as many more notes than the plain one (counted in
//     Verovio's MEI) as the piece's .inserted.json records;
//   - the beam count is the same as the plain version's (Verovio adds no beams to the new eighths).
//
//   pnpm install --frozen-lockfile        # once: installs apps/web's verovio
//   node research/embellish/render_check.mjs [research/embellish/listening]
//
// Exits 1 when any check fails. License: MIT.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const dist = join(root, 'apps', 'web', 'node_modules', 'verovio', 'dist');
const { default: createVerovioModule } = await import(pathToFileURL(join(dist, 'verovio-module.mjs')).href);
const { VerovioToolkit } = await import(pathToFileURL(join(dist, 'verovio.mjs')).href);

const dir = resolve(process.argv[2] ?? join(here, 'listening'));
const module = await createVerovioModule();
const tk = new VerovioToolkit(module);
tk.setOptions({ adjustPageHeight: true, breaks: 'none' });
console.log(`verovio ${tk.getVersion()}, ${dir}`);

const count = (text, tag) => (text.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
function render(file) {
  const ok = tk.loadData(readFileSync(file, 'utf8'));
  const pages = ok ? tk.getPageCount() : 0;
  const svg = pages ? tk.renderToSVG(1) : '';
  const mei = ok ? tk.getMEI({}) : '';
  const errors = tk
    .getLog()
    .split('\n')
    .filter((l) => /error/i.test(l));
  return { ok: ok && pages > 0 && svg.length > 0 && errors.length === 0, pages, notes: count(mei, 'note'), beams: count(mei, 'beam'), errors };
}

let failures = 0;
const stems = readdirSync(dir)
  .filter((f) => f.endsWith('.inserted.json'))
  .map((f) => f.slice(0, -'.inserted.json'.length))
  .sort();
for (const stem of stems) {
  const record = JSON.parse(readFileSync(join(dir, `${stem}.inserted.json`), 'utf8'));
  const plain = render(join(dir, `${stem}-plain.musicxml`));
  const cells = [`plain ${plain.notes} notes ${plain.beams} beams`];
  if (!plain.ok) failures++;
  for (const density of ['light', 'playful']) {
    const r = render(join(dir, `${stem}-${density}.musicxml`));
    const added = record.inserted[density].length;
    const good = r.ok && r.notes - plain.notes === added && r.beams === plain.beams;
    if (!good) failures++;
    cells.push(`${density} +${r.notes - plain.notes} (recorded ${added}) ${r.beams} beams${good ? '' : ' FAIL'}${r.errors.length ? ` ${r.errors[0]}` : ''}`);
  }
  console.log(`${stem.padEnd(48)} ${cells.join(' | ')}`);
}
console.log(failures ? `${failures} check(s) failed` : `all ${stems.length * 3} files load, render and match their records`);
process.exit(failures ? 1 : 0);
