import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
const req = createRequire(resolve('apps/web/package.json'));
const { default: createModule } = await import(pathToFileURL(req.resolve('verovio/wasm')));
const { VerovioToolkit } = await import(pathToFileURL(req.resolve('verovio/esm')));
const module = await createModule();
const toolkit = new VerovioToolkit(module);
const out = resolve('research/omr/results/photo-recovery/accidental-render-control');
await mkdir(out, { recursive: true });
const xml = (accidental) =>
  `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration><type>whole</type>${accidental ? '<accidental>sharp</accidental>' : ''}</note></measure></part></score-partwise>`;
const result = {};
for (const [name, marked] of [
  ['alter-only', false],
  ['explicit-display', true],
]) {
  toolkit.setOptions({ pageWidth: 1000, pageHeight: 600, scale: 60 });
  if (!toolkit.loadData(xml(marked))) throw Error('render load failed');
  const svg = toolkit.renderToSVG(1);
  await writeFile(resolve(out, `${name}.svg`), svg);
  result[name] = {
    accidentalGlyphs: (svg.match(/class="accid"/g) || []).length,
    sharpGlyphs: (svg.match(/#E262-/g) || []).length,
  };
}
await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(result);
if (result['alter-only'].sharpGlyphs !== 0 || result['explicit-display'].sharpGlyphs !== 1)
  throw Error('display hypothesis failed');
