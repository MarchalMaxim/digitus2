// Re-recognition of the scan validation cases (issue 233, docs/scanning.md "Validation cases"):
// every case's photos read again by the scanner as it is now, into a parallel case store, so a
// change to the scanner (a photo preparation step, a new homr) is measured on every case before it
// ships.
//
//   node research/omr/diagnostics/recognize.mjs --homr <toolchain> --out <store>
//        [--prepare <file.py>] [--photos <dir with manifest.json>] [--cases <store>]
//        [--timeout <s>] [--threads <n>] [case names...]
//
// --cases (default DIGITUS2_SCAN_CASES, unless --photos is given alone) is read only. Each case
// lands in --out under its own name: its photos byte for byte, and for each page
// page-N-recognized.musicxml and page-N-recognition.json as the service's Keeper keeps them, so the
// gate replays the new answers. scan.json is not copied, and one left in --out is removed: the gate
// prefers it to the records and it carries the old recognizer's answers. --photos adds a one-page
// case photo-<id> for each photo of a committed photo set, turned upright when the manifest says
// so, with expect.json holding the facts read off the page. --prepare names a Python module whose
// clean_file(path) rewrites a photo in place: it runs on a copy of each photo before recognition,
// in the toolchain's interpreter; the case keeps the photo the app uploads.
//
// --out holds one run: a folder holding cases this run does not recognise is refused, and the
// gate's reports in it, which describe the recognitions replaced, are removed. recognize.py reads
// each page through the scan service's own code, one page at a time, in a short temporary folder.
// A refused page is a measurement; a fault of the toolchain or of this computer stops the run.
//
// Exit 0 when the run completed, 2 for a wrong command line (or no case to recognise), 3 when the
// run stopped; rerecognition.json then says so, and report.mjs --against refuses the store.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = import.meta.dirname;
const IMAGE = /^page-(\d+)\.(jpe?g|png)$/i;
/**
 * What a run writes into a case folder, and what a kept scan holds about its old answers (scan.json,
 * the page ids, the device's reviews): removed from the folder before writing again.
 */
const WRITTEN =
  /^(page-\d+\.(jpe?g|png)|page-\d+-recognized\.musicxml|page-\d+-recognition\.json|page-\d+-id\.json|review-\d+\.json|scan\.json|recognition-failed\.json|expect\.json|review\.png|score\.png)$/i;
/** The gate's reports in a store, of the recognitions a run replaces. */
const REPORTS = ['report.json', 'report.md', 'report-previous.json'];
/** The manifest's facts a photo case keeps in expect.json. */
const FACTS = ['bars', 'staves', 'fifths', 'time', 'rotate', 'cutOff'];

/** A wrong command line: the message says what is needed. */
export class Usage extends Error {}

/** The run stopped on the toolchain or this computer, not on the scanner. */
export class Fault extends Error {}

const USAGE =
  'usage: node research/omr/diagnostics/recognize.mjs --homr <toolchain> --out <store> [--prepare <file.py>] [--photos <dir>] [--cases <store>] [--timeout <s>] [--threads <n>] [case names...]';

/** The command line, paths resolved; the case store defaults to DIGITUS2_SCAN_CASES. */
export function parseArgs(argv, env = process.env) {
  const options = { names: [] };
  const flags = {
    '--homr': 'homr',
    '--out': 'out',
    '--prepare': 'prepare',
    '--photos': 'photos',
    '--cases': 'cases',
    '--timeout': 'timeout',
    '--threads': 'threads',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = flags[arg];
      if (!key) throw new Usage(`Unknown option ${arg}.\n${USAGE}`);
      const value = argv[++i];
      if (value === undefined) throw new Usage(`${arg} needs a value.\n${USAGE}`);
      options[key] = value;
    } else options.names.push(arg);
  }
  if (!options.homr) throw new Usage(`Name the homr toolchain with --homr.\n${USAGE}`);
  if (!options.out) throw new Usage(`Name the output case store with --out.\n${USAGE}`);
  // --photos alone asks for the photos only.
  if (!options.photos) options.cases ??= env.DIGITUS2_SCAN_CASES || undefined;
  if (!options.cases && !options.photos)
    throw new Usage(`Name the cases with --cases or DIGITUS2_SCAN_CASES, or --photos.\n${USAGE}`);
  for (const key of ['homr', 'out', 'prepare', 'photos', 'cases'])
    if (options[key] !== undefined) options[key] = resolve(options[key]);
  for (const key of ['timeout', 'threads'])
    if (options[key] !== undefined) {
      const number = Number(options[key]);
      if (!(number > 0)) throw new Usage(`--${key} must be a positive number.`);
      if (key === 'threads' && !Number.isInteger(number))
        throw new Usage('--threads must be a whole number.');
      options[key] = number;
    }
  if (options.cases && same(options.cases, options.out))
    throw new Usage('--out is the same folder as the cases: write the new recognitions elsewhere.');
  return options;
}

const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/** The photos of a case folder, page 1 up to the first page without one. */
function casePages(dir) {
  const files = readdirSync(dir);
  const pages = [];
  for (let n = 1; ; n++) {
    const file = files.find((f) => Number(IMAGE.exec(f)?.[1]) === n);
    if (!file) return pages;
    const ext = IMAGE.exec(file)[2].toLowerCase();
    pages.push({ n, source: join(dir, file), ext: ext === 'jpeg' ? 'jpg' : ext });
  }
}

const isDir = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The cases to recognise, by name: each case folder of `cases` with its photos in page order, and
 * a one-page case photo-<id> for each photo of `photos`' manifest. `names` keeps those only.
 */
export function planCases({ cases, photos, names = [] }) {
  const plan = [];
  if (cases) {
    if (!isDir(cases)) throw new Usage(`No case store at ${cases}.`);
    for (const name of readdirSync(cases).sort()) {
      const dir = join(cases, name);
      if (name.startsWith('.') || !isDir(dir)) continue;
      const pages = casePages(dir);
      if (pages.length) plan.push({ name, pages });
    }
  }
  if (photos) {
    const manifest = JSON.parse(readFileSync(join(photos, 'manifest.json'), 'utf8'));
    for (const photo of manifest.photos ?? []) {
      const rotate = photo.rotate ? Number(photo.rotate) : undefined;
      const expect = { photo: photo.id };
      for (const key of FACTS) if (photo[key] !== undefined) expect[key] = photo[key];
      const ext = rotate ? 'png' : /\.png$/i.test(photo.file) ? 'png' : 'jpg';
      plan.push({
        name: `photo-${photo.id}`,
        expect,
        pages: [{ n: 1, source: join(photos, photo.file), ext, ...(rotate && { rotate }) }],
      });
    }
  }
  const twice = [...new Set(plan.map((c) => c.name).filter((n, i, all) => all.indexOf(n) !== i))];
  if (twice.length)
    throw new Usage(
      `Two cases are named ${twice.join(', ')}: a case of the store and a photo, or a photo listed twice. Name the store with --cases or the photos with --photos, not both.`,
    );
  const missing = names.filter((name) => !plan.some((c) => c.name === name));
  if (missing.length) throw new Usage(`No case named ${missing.join(', ')}.`);
  const chosen = names.length ? plan.filter((c) => names.includes(c.name)) : plan;
  if (!chosen.length)
    throw new Usage(`No case to recognise in ${[cases, photos].filter(Boolean).join(' or ')}.`);
  return chosen;
}

/** The case folders a store holds: a folder with a page-1 photo, or one whose recognition failed. */
function storeCases(store) {
  if (!isDir(store)) return [];
  return readdirSync(store).filter((name) => {
    const dir = join(store, name);
    if (name.startsWith('.') || !isDir(dir)) return false;
    return casePages(dir).length > 0 || existsSync(join(dir, 'recognition-failed.json'));
  });
}

/** Parts, the bars of the longest part, and the notes that sound (rests left out). */
export function measure(xml) {
  const parts = [...xml.matchAll(/<part\s[^>]*>([\s\S]*?)<\/part>/g)].map((m) => m[1]);
  const bars = Math.max(0, ...parts.map((p) => (p.match(/<measure\b/g) ?? []).length));
  const notes = [...xml.matchAll(/<note\b[\s\S]*?<\/note>/g)].filter(
    (m) => !/<rest\b/.test(m[0]),
  ).length;
  return { parts: parts.length, bars, notes };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** Empties what a run before left in a case folder; files of other kinds stay. */
function clearCase(dir) {
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(dir)) if (WRITTEN.test(file)) unlinkSync(join(dir, file));
}

/**
 * Recognises every planned case into `out`. `deps.recognizePage(photo, work)` answers one page
 * as the service would ({ status, body, xml?, record?, diagnostic?, environment? });
 * `deps.turn(from, to, degrees)` writes a turned PNG; `deps.prepare(file, path)` cleans a photo in
 * place. Scratch goes in a fresh folder under `deps.scratch` (the system's temporary folder), as
 * the service's root is short: homr's working paths pass Windows' 260 characters under a deep
 * --out. Returns the counts. Throws Fault when a page met a fault of the toolchain or of this
 * computer, after writing rerecognition.json with the cases done and `aborted`.
 */
export function recognizeAll(options, deps) {
  const { out, prepare } = options;
  const log = deps.log ?? console.log;
  const now = deps.now ?? Date.now;
  const plan = planCases(options);
  const others = storeCases(out).filter((name) => !plan.some((c) => c.name === name));
  if (others.length)
    throw new Usage(
      `${out} holds cases this run does not recognise (${others.slice(0, 5).join(', ')}${others.length > 5 ? ', ...' : ''}): write into an empty folder, so the store holds one run.`,
    );
  mkdirSync(out, { recursive: true });
  for (const file of REPORTS) rmSync(join(out, file), { force: true });
  const work = mkdtempSync(join(deps.scratch ?? tmpdir(), 'd2rr-'));
  const run = { ranAt: new Date(now()).toISOString(), prepare: prepare ?? null, cases: [] };
  let pages = 0;
  let failed = 0;
  const unreplayable = [];
  let current;
  try {
    for (const scan of plan) {
      const dir = join(out, scan.name);
      current = dir;
      clearCase(dir);
      if (scan.expect)
        writeFileSync(join(dir, 'expect.json'), JSON.stringify(scan.expect, null, 2) + '\n');
      const kept = { case: scan.name, pages: [] };
      const failures = [];
      for (const page of scan.pages) {
        // The photo the app uploads: the case's as it is, a photo turned as Rotate turns it.
        const stored = join(dir, `page-${page.n}.${page.ext}`);
        if (page.rotate) deps.turn(page.source, stored, page.rotate);
        else copyFileSync(page.source, stored);
        let input = stored;
        let prepared;
        if (prepare) {
          input = join(work, `prepared.${page.ext}`);
          copyFileSync(stored, input);
          prepared = deps.prepare(prepare, input) ?? null;
        }
        const pageWork = join(work, 'page');
        rmSync(pageWork, { recursive: true, force: true });
        mkdirSync(pageWork);
        const started = now();
        const answer = deps.recognizePage(input, pageWork);
        const took = now() - started;
        const label = `${scan.name} page ${page.n}/${scan.pages.length}`;
        const diagnostic = answer.diagnostic;
        if (diagnostic?.environment)
          throw new Fault(
            `${label}: the toolchain or this computer failed, not the scanner: ${diagnostic.cause}${diagnostic.log ? `\n${diagnostic.log}` : ''}`,
          );
        run.environment ??= answer.environment;
        pages++;
        const entry = { page: page.n, status: answer.status, seconds: took / 1000 };
        if (prepared !== undefined) entry.prepared = prepared;
        if (
          answer.status === 200 &&
          answer.body?.state === 'ready' &&
          typeof answer.xml === 'string'
        ) {
          writeFileSync(join(dir, `page-${page.n}-recognized.musicxml`), answer.xml);
          const metadata = { ...answer.body };
          delete metadata.state;
          writeFileSync(
            join(dir, `page-${page.n}-recognition.json`),
            answer.record ?? JSON.stringify(metadata, null, 2),
          );
          const counts = measure(answer.xml);
          Object.assign(entry, counts, {
            warnings: (answer.body.warnings ?? []).map((w) => w?.code ?? w),
          });
          const expected =
            scan.expect?.bars !== undefined ? ` (expected ${plural(scan.expect.bars, 'bar')})` : '';
          log(
            `${label}: ${plural(counts.parts, 'part')}, ${plural(counts.bars, 'bar')}, ${plural(counts.notes, 'note')}${expected}, ${seconds(took)}`,
          );
        } else {
          failed++;
          failures.push({ page: page.n, status: answer.status, answer: answer.body });
          const code =
            answer.body?.failure?.code ?? answer.body?.error ?? answer.body?.state ?? 'no answer';
          entry.failure = code;
          // What raised the refusal, which the answer does not say: beside the cases, not in them.
          if (diagnostic?.cause) entry.cause = diagnostic.cause;
          log(
            `${label}: refused ${answer.status} ${code}${entry.cause ? ` (${entry.cause})` : ''}, ${seconds(took)}`,
          );
        }
        kept.pages.push(entry);
      }
      if (failures.length) {
        writeFileSync(
          join(dir, 'recognition-failed.json'),
          JSON.stringify({ pages: failures }, null, 2) + '\n',
        );
        unreplayable.push(scan.name);
      }
      run.cases.push(kept);
      current = undefined;
    }
  } catch (error) {
    // The case the run stopped in keeps nothing the gate would replay.
    if (current) {
      clearCase(current);
      if (!readdirSync(current).length) rmSync(current, { recursive: true, force: true });
    }
    run.aborted = String(error?.message ?? error).split('\n')[0];
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
    run.finishedAt = new Date(now()).toISOString();
    writeFileSync(join(out, 'rerecognition.json'), JSON.stringify(run, null, 2) + '\n');
  }
  log(
    `${plural(plan.length, 'case')}, ${plural(pages, 'page')}: ${pages - failed} read, ${failed} failed. Cases in ${out}.`,
  );
  if (unreplayable.length)
    log(
      `The gate cannot replay a refused page yet; recognition-failed.json holds the service's answer in ${unreplayable.join(', ')}.`,
    );
  return { cases: plan.length, pages, failed };
}

/** The interpreter of a prepared homr toolchain, as homr.py's venv_python finds it. */
export function venvPython(toolchain, platform = process.platform) {
  return join(toolchain, platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python');
}

/** The Python that runs recognize.py: DIGITUS2_PYTHON, else python on Windows, python3 elsewhere. */
const systemPython = () =>
  process.env.DIGITUS2_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

function check(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `${what} (exit ${result.status}): ${(result.stderr ?? '').trim().split('\n').slice(-5).join('\n')}`,
    );
  return result;
}

/** The real dependencies: recognize.py for each page, Pillow and the module in the toolchain. */
export function liveDeps({ homr, timeout = 180, threads }) {
  const python = venvPython(homr);
  return {
    recognizePage(photo, work) {
      const args = [
        '-I',
        join(HERE, 'recognize.py'),
        '--homr',
        homr,
        '--photo',
        photo,
        '--out',
        work,
      ];
      args.push('--root', join(work, 'svc'), '--timeout', String(timeout));
      if (threads) args.push('--threads', String(threads));
      check(
        spawnSync(systemPython(), args, {
          encoding: 'utf8',
          timeout: (timeout + 300) * 1000,
          maxBuffer: 64 * 1024 * 1024,
        }),
        'recognize.py',
      );
      const answer = JSON.parse(readFileSync(join(work, 'answer.json'), 'utf8'));
      const xml = join(work, 'recognized.musicxml');
      const record = join(work, 'recognition.json');
      return {
        ...answer,
        ...(existsSync(xml) && { xml: readFileSync(xml, 'utf8') }),
        ...(existsSync(record) && { record: readFileSync(record) }),
      };
    },
    // As acceptance.mjs turns an upside-down photo: Pillow, exact at 180 degrees, saved as PNG.
    turn(from, to, degrees) {
      check(
        spawnSync(
          python,
          [
            '-I',
            '-c',
            'import sys;from PIL import Image;Image.open(sys.argv[1]).rotate(int(sys.argv[3]),expand=True).save(sys.argv[2],"PNG")',
            from,
            to,
            String(-degrees),
          ],
          { encoding: 'utf8' },
        ),
        `turning ${from}`,
      );
    },
    // The module is loaded by its path, in the toolchain's interpreter (OpenCV, NumPy, Pillow).
    prepare(file, path) {
      const result = check(
        spawnSync(
          python,
          [
            '-I',
            '-c',
            'import sys,json,importlib.util as u;s=u.spec_from_file_location("prepare",sys.argv[1]);m=u.module_from_spec(s);s.loader.exec_module(m);r=m.clean_file(sys.argv[2]);print(json.dumps(r if isinstance(r,dict) else None))',
            file,
            path,
          ],
          { encoding: 'utf8', timeout: 300_000 },
        ),
        `preparing with ${file}`,
      );
      return JSON.parse(result.stdout.trim().split('\n').at(-1) || 'null');
    },
  };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (!existsSync(venvPython(options.homr)))
      throw new Usage(
        `No prepared homr toolchain at ${options.homr} (no ${venvPython(options.homr)}).`,
      );
    if (options.prepare && !existsSync(options.prepare))
      throw new Usage(`No module at ${options.prepare}.`);
    recognizeAll(options, liveDeps(options));
    return 0;
  } catch (error) {
    if (error instanceof Usage) {
      console.error(error.message);
      return 2;
    }
    console.error(error instanceof Fault ? error.message : String(error?.stack ?? error));
    console.error('The run stopped; rerecognition.json in --out says where.');
    return 3;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main();
