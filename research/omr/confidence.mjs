#!/usr/bin/env node
// Does homr know when it is wrong (issue 130)? homr writes, per note, the three most probable
// tokens of its rhythm, pitch and accidental heads with their probabilities (`<!-- conf: ... -->`,
// research/omr/prototypes/homr-photo/patch_confidence.py). This measures, against exact truth,
// whether a low probability picks out the wrong notes, whether the right reading is among the
// alternatives when a note was misread, and whether a page's confidence says it cannot be read.
//
//   node research/omr/confidence.mjs                   recognise what is missing, then score
//   node research/omr/confidence.mjs --parallel 2      recognize.py processes side by side
//   node research/omr/confidence.mjs --no-recognize    score the cached recognitions only
//   node research/omr/confidence.mjs --variants g0,g2  only these blur variants
//
// Pages and variants are blur-sweep.mjs's (run it, or `--no-recognize --no-measure`, first so the
// variant images exist): the 8 one-page truth pieces of camera-fusion.mjs, rendered clean, and the
// 14 phone photos of research/omr/photos, each blurred. Note-level truth: the truth pieces' library
// MusicXML, and for the three PhotoScan photos of Bach's Invention 13 each photo's own bars of the
// library piece. The other photos have only the manifest facts and count for the page verdict.
// Recognition is local homr through acceptance/recognize.py (the shipped adapter), cached under
// research/omr/results/confidence/cache by the input's hash and the acceptance pipeline's.
//
// Notes are paired with the truth as evaluateOmr pairs them (imgpos.mjs, pairNotes): bar by
// ordinal, then bar-local onset and MIDI pitch. Only pages whose bar count is the truth's give note
// labels, so a missed bar does not mislabel every note after it.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipelineHash } from './acceptance.mjs';
import { DEFAULT_PIECES, fixtures, sliceScore } from './camera-fusion.mjs';
import { photoFacts } from './diagnose.mjs';
import { pairNotes } from './imgpos.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const OUT = join(REPO, 'research/omr/results/confidence');
const VARIANTS_DIR = join(REPO, 'research/omr/results/blur-sweep/variants');
const INVENTION = 'bach-invention-no13-bwv-784';
const INVENTION_PHOTOS = ['bach-invention13-page1-photoscan', 'bach-invention13-page2-photoscan', 'bach-invention13-page3-photoscan'];
const log = (...a) => console.error(...a);

/**
 * The decision, fixed before any number was seen. Marks ship when a note's uncertainty separates
 * misread notes from right ones; suggestions ship for a head when the right reading is among the
 * top three alternatives for half of that head's substitutions; the page verdict uses homr's
 * confidence when it separates pages that cannot be read from pages that can.
 */
export const GATES = { marksAuroc: 0.8, suggestionsTop3: 0.5, pageAuroc: 0.85 };

/** Every `<note>`'s confidence in document order: `{rhythm, pitch, lift}` lists of [token, p], or null. */
export function confidences(xml) {
  const out = [];
  for (const match of xml.matchAll(/<note(?:\s[^>]*)?>([\s\S]*?)<\/note>/g)) {
    const found = /<!--\s*conf:([\s\S]*?)-->/.exec(match[1]);
    out.push(found ? parseConfidence(found[1]) : null);
  }
  return out;
}

export function parseConfidence(text) {
  const heads = {};
  for (const part of text.split(';')) {
    const words = part.trim().split(/\s+/);
    if (!words[0]) continue;
    const list = [];
    for (let i = 1; i + 1 < words.length; i += 2) list.push([words[i], Number(words[i + 1])]);
    heads[words[0]] = list;
  }
  return heads;
}

/** A note's probability as read: the product of its chosen rhythm, pitch and accidental tokens. */
export const jointOf = (c) => (c.rhythm?.[0]?.[1] ?? 1) * (c.pitch?.[0]?.[1] ?? 1) * (c.lift?.[0]?.[1] ?? 1);

/** A rhythm token's length in quarters (Humdrum kern: 4 a quarter, 12 an eighth triplet), or null. */
export function quartersOf(token) {
  const m = /^(?:note|rest)_(\d+)(\.*)/.exec(token);
  if (!m || /G$/.test(token)) return null;
  const base = 4 / Number(m[1]);
  return m[2].length === 1 ? base * 1.5 : m[2].length === 2 ? base * 1.75 : base;
}

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = 'FCGDAEB';
const LIFT = { '#': 1, '##': 2, b: -1, bb: -2, N: 0 };
/** The MIDI number of a pitch token with an accidental token, under a key of `fifths`. */
export function midiOf(pitch, lift, fifths) {
  const m = /^([A-G])(\d)$/.exec(pitch);
  if (!m) return null;
  const letter = m[1];
  const key = fifths > 0 ? (SHARPS.slice(0, fifths).includes(letter) ? 1 : 0) : fifths < 0 ? (SHARPS.slice(7 + fifths).includes(letter) ? -1 : 0) : 0;
  const alter = lift in LIFT ? LIFT[lift] : key;
  return 12 * (Number(m[2]) + 1) + STEP[letter] + alter;
}

/** Pitch readings other than the chosen one, most probable first: [midi, p] from the top 3 x 3. */
export function pitchAlternatives(c, fifths) {
  const chosen = midiOf(c.pitch?.[0]?.[0], c.lift?.[0]?.[0], fifths);
  const seen = new Map();
  for (const [p, pp] of c.pitch ?? [])
    for (const [l, pl] of c.lift ?? []) {
      const midi = midiOf(p, l, fifths);
      if (midi === null || midi === chosen) continue;
      seen.set(midi, Math.max(seen.get(midi) ?? 0, pp * pl));
    }
  return [...seen].sort((a, b) => b[1] - a[1]);
}

/** Rhythm readings other than the chosen one that are notes of a length: [quarters, p]. */
export function rhythmAlternatives(c) {
  const chosen = quartersOf(c.rhythm?.[0]?.[0] ?? '');
  return (c.rhythm ?? [])
    .slice(1)
    .filter(([t]) => t.startsWith('note_'))
    .map(([t, p]) => [quartersOf(t), p])
    .filter(([q]) => q !== null && q !== chosen);
}

/** Area under the ROC curve of `score` for `positive` (Mann-Whitney, ties count half). */
export function auroc(items) {
  const pos = items.filter((i) => i.positive).map((i) => i.score);
  const neg = items.filter((i) => !i.positive).map((i) => i.score);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/** The key signature in force at each `<note>`, in document order. */
function fifthsPerNote(xml) {
  const out = [];
  let fifths = 0;
  for (const m of xml.matchAll(/<fifths>(-?\d+)<\/fifths>|<note(?:\s[^>]*)?>/g)) {
    if (m[1] !== undefined) fifths = Number(m[1]);
    else out.push(fifths);
  }
  return out;
}

const sha = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};

async function recognize(jobs, homr, parallel) {
  const pending = jobs.filter((j) => !existsSync(j.output) && !existsSync(j.output + '.failed.json'));
  log(`recognition: ${jobs.length} jobs, ${pending.length} to run on ${parallel} process(es)`);
  const chunks = Array.from({ length: parallel }, (_, i) => pending.filter((_, k) => k % parallel === i)).filter((c) => c.length);
  await Promise.all(
    chunks.map(
      (chunk, i) =>
        new Promise((done, fail) => {
          const file = join(OUT, `jobs-${i}.json`);
          writeFileSync(file, JSON.stringify(chunk.map(({ id, input, output }) => ({ id, recognizer: 'homr', input, output })), null, 1));
          const child = spawn(process.env.DIGITUS2_OMR_PYTHON || 'python', ['-I', join(HERE, 'acceptance/recognize.py'), file, '--bundle', 'unused', '--text-models', 'unused', '--homr-toolchain', homr], { stdio: ['ignore', 'pipe', 'inherit'] });
          child.stdout.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((line) => log(`  [homr ${i}] ${line}`)));
          child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`recognize.py exited with ${code}`))));
        }),
    ),
  );
}

function parseArgs(args) {
  const o = { parallel: 1, recognize: true, variants: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--parallel') o.parallel = Math.max(1, Number(args[++i]));
    else if (a === '--no-recognize') o.recognize = false;
    else if (a === '--variants') o.variants = new Set(args[++i].split(','));
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** A page's variant images on disk: the page itself as g0, the blurred PNGs blur-sweep.mjs made. */
function variantFiles(pageId, original, only) {
  const files = { g0: original };
  const dir = join(VARIANTS_DIR, pageId);
  if (existsSync(dir))
    for (const name of readdirSync(dir)) {
      const id = name.split('-')[0];
      if (name.endsWith('.png')) files[id] = join(dir, name);
    }
  return Object.fromEntries(Object.entries(files).filter(([id]) => !only || only.has(id)));
}

/** Note-level rows of one recognition against its truth, and the page's own figures. */
function scoreNotes(E, ref, xml) {
  const rec = E.parseMusicXml(xml, { preserveNotation: true }).score;
  const conf = confidences(xml);
  const fifths = fifthsPerNote(xml);
  const ev = E.evaluateOmr(ref, rec);
  const barsRight = ev.recognizedBars === ev.referenceBars;
  const page = { barsRight, pitchF1: ev.metrics.pitch.f1, fullNoteF1: ev.metrics.fullNote.f1, notes: [] };
  const all = rec.notes.filter((n) => !n.isGrace).map((n) => ({ n, c: conf[n.sourceIndices?.[0]] })).filter((x) => x.c);
  page.uncertainty = all.length ? all.reduce((a, x) => a + (1 - jointOf(x.c)), 0) / all.length : null;
  page.notesWithConfidence = all.length;
  if (!barsRight) return page;
  const pairs = new Map(pairNotes(ref, rec).map(([r, t]) => [r, t]));
  const div = (score) => score.divisions;
  const q = (ticks, score) => ticks / div(score);
  const barOf = (score) => new Map(score.measures.map((m, i) => [m.index, i]));
  const refBar = barOf(ref);
  const recBar = barOf(rec);
  const used = new Set(pairs.values());
  for (const { n, c } of all) {
    const truth = pairs.get(n);
    const row = { joint: jointOf(c), rhythm: c.rhythm?.[0]?.[1] ?? 1, pitch: c.pitch?.[0]?.[1] ?? 1, lift: c.lift?.[0]?.[1] ?? 1, pitchRight: !!truth };
    const local = (note, score, bars) => q(note.onsetTick - score.measures[bars.get(note.measureIndex)].startTick, score);
    if (truth) {
      const length = q(truth.offsetTick - truth.onsetTick, ref);
      row.lengthRight = Math.abs(q(n.offsetTick - n.onsetTick, rec) - length) < 1e-6;
      if (!row.lengthRight) {
        const alts = rhythmAlternatives(c);
        row.lengthTruthRank = alts.findIndex(([qq]) => Math.abs(qq - length) < 1e-6);
      }
    } else {
      // A substitution: an unpaired truth note in the same bar at the same onset, on the same staff first.
      const bar = recBar.get(n.measureIndex);
      const at = local(n, rec, recBar);
      const candidates = ref.notes.filter((t) => !t.isGrace && !used.has(t) && refBar.get(t.measureIndex) === bar && Math.abs(local(t, ref, refBar) - at) < 1e-6);
      const t = candidates.find((x) => x.staff === n.staff) ?? candidates[0];
      if (t) {
        used.add(t);
        const alts = pitchAlternatives(c, fifths[n.sourceIndices[0]] ?? 0);
        row.substitution = true;
        row.pitchTruthRank = alts.findIndex(([midi]) => midi === t.midi);
        row.semitones = n.midi - t.midi;
      }
    }
    page.notes.push(row);
  }
  return page;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const homr = resolve(process.env.DIGITUS2_OMR_HOMR || 'C:/Users/maxim/omr/homr');
  const pipeline = pipelineHash();
  mkdirSync(join(OUT, 'cache'), { recursive: true });
  const fx = await fixtures(DEFAULT_PIECES);
  const byId = new Map(fx.manifest.pieces.map((p) => [p.id, p]));
  const manifest = JSON.parse(readFileSync(join(HERE, 'photos/manifest.json'), 'utf8'));
  const pages = [
    ...DEFAULT_PIECES.map((id) => ({ id, kind: 'truth', piece: byId.get(id), file: join(fx.dir, byId.get(id).pages[0].images.clean) })),
    ...manifest.photos.map((photo) => ({ id: photo.id, kind: 'photo', photo, file: join(HERE, 'photos', photo.file) })),
  ];
  const keyOf = (input) => join(OUT, 'cache', `${sha(readFileSync(input), `homr:${pipeline}`).slice(0, 24)}.musicxml`);
  const jobs = pages.flatMap((page) =>
    Object.entries(variantFiles(page.id, page.file, opts.variants)).map(([variant, input]) => ({ id: `${page.id}:${variant}`, page, variant, input, output: keyOf(input) })),
  );
  if (opts.recognize) await recognize([...new Map(jobs.map((j) => [j.output, j])).values()], homr, opts.parallel);

  const E = await import(pathToFileURL(join(REPO, 'packages/engine/dist/src/index.js')).href);
  const refs = new Map();
  const refOf = (id) => {
    if (!refs.has(id)) refs.set(id, E.parseMusicXml(readFileSync(join(fx.dir, byId.get(id).reference), 'utf8'), { preserveNotation: true }).score);
    return refs.get(id);
  };
  // Each invention photo against its own bars of the library piece, in manifest order.
  const invention = {};
  let from = 0;
  for (const id of INVENTION_PHOTOS) {
    const bars = manifest.photos.find((p) => p.id === id).bars;
    invention[id] = [from, from + bars];
    from += bars;
  }
  const pageRows = [];
  const noteRows = [];
  for (const job of jobs) {
    const { page, variant } = job;
    if (!existsSync(job.output)) {
      pageRows.push({ page: page.id, variant, kind: page.kind, status: existsSync(job.output + '.failed.json') ? 'failed' : 'missing', read: false });
      continue;
    }
    const xml = readFileSync(job.output, 'utf8');
    const facts = photoFacts(E, xml);
    let row = { page: page.id, variant, kind: page.kind, status: facts.imports ? 'parsed' : 'invalid' };
    let ref = null;
    if (page.kind === 'truth') ref = refOf(page.id);
    else if (invention[page.id]) ref = sliceScore(refOf(INVENTION), ...invention[page.id]);
    try {
      if (ref) {
        const scored = scoreNotes(E, ref, xml);
        for (const n of scored.notes) noteRows.push({ page: page.id, variant, ...n });
        const { notes: _, ...rest } = scored;
        row = { ...row, ...rest, truth: true };
      } else {
        const conf = confidences(xml).filter(Boolean);
        row.uncertainty = conf.length ? conf.reduce((a, c) => a + (1 - jointOf(c)), 0) / conf.length : null;
        row.notesWithConfidence = conf.length;
      }
    } catch (error) {
      row.status = 'invalid';
      row.error = String(error.message ?? error);
    }
    const expect = page.kind === 'truth' ? null : page.photo;
    row.barsRight = expect ? facts.bars === expect.bars : row.barsRight;
    row.stavesRight = expect ? facts.staves === expect.staves : facts.staves === 2;
    // A page that cannot be read: its bars or staves are wrong, or under 90% of its pitches are right.
    row.read = row.status === 'parsed' && row.barsRight && row.stavesRight && (row.pitchF1 === undefined || row.pitchF1 >= 0.9);
    pageRows.push(row);
  }

  // Notes: does uncertainty pick out the misread ones?
  const wrong = (n) => !n.pitchRight || n.lengthRight === false;
  const marks = {
    notes: noteRows.length,
    wrong: noteRows.filter(wrong).length,
    auroc: {
      joint: auroc(noteRows.map((n) => ({ score: 1 - n.joint, positive: wrong(n) }))),
      pitch: auroc(noteRows.map((n) => ({ score: 1 - n.pitch, positive: wrong(n) }))),
      rhythm: auroc(noteRows.map((n) => ({ score: 1 - n.rhythm, positive: wrong(n) }))),
      lift: auroc(noteRows.map((n) => ({ score: 1 - n.lift, positive: wrong(n) }))),
    },
    thresholds: [0.3, 0.5, 0.6, 0.7, 0.8, 0.85].map((t) => {
      const marked = noteRows.filter((n) => n.joint < t);
      return { joint: t, marked: marked.length, wrongMarked: marked.filter(wrong).length, rightMarked: marked.filter((n) => !wrong(n)).length };
    }),
  };
  const subs = noteRows.filter((n) => n.substitution);
  const lengths = noteRows.filter((n) => n.lengthRight === false);
  const share = (rows, k) => (rows.length ? rows.filter((r) => r[k] >= 0 && r[k] < 3).length / rows.length : null);
  const suggestions = {
    errors: marks.wrong,
    pitchSubstitutions: subs.length,
    pitchTop1: subs.length ? subs.filter((r) => r.pitchTruthRank === 0).length / subs.length : null,
    pitchTop3: share(subs, 'pitchTruthRank'),
    lengthErrors: lengths.length,
    lengthTop1: lengths.length ? lengths.filter((r) => r.lengthTruthRank === 0).length / lengths.length : null,
    lengthTop3: share(lengths, 'lengthTruthRank'),
    otherErrors: noteRows.filter((n) => !n.pitchRight && !n.substitution).length,
  };
  const judged = pageRows.filter((r) => r.uncertainty != null);
  const page = {
    pages: judged.length,
    unreadable: judged.filter((r) => !r.read).length,
    auroc: auroc(judged.map((r) => ({ score: r.uncertainty, positive: !r.read }))),
    rows: judged.map(({ page, variant, read, uncertainty, pitchF1 }) => ({ page, variant, read, uncertainty, pitchF1 })),
  };
  const decision = {
    marks: (marks.auroc.joint ?? 0) >= GATES.marksAuroc,
    pitchSuggestions: (suggestions.pitchTop3 ?? 0) >= GATES.suggestionsTop3,
    lengthSuggestions: (suggestions.lengthTop3 ?? 0) >= GATES.suggestionsTop3,
    pageVerdict: (page.auroc ?? 0) >= GATES.pageAuroc,
  };
  const card = { schemaVersion: 1, generated: new Date().toISOString(), pipeline, homr, gates: GATES, decision, marks, suggestions, page, pageRows, noteRows };
  writeFileSync(join(OUT, 'latest.json'), JSON.stringify(card, null, 1));
  console.log(JSON.stringify({ decision, marks: { ...marks }, suggestions, page: { pages: page.pages, unreadable: page.unreadable, auroc: page.auroc } }, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => {
    console.error(error);
    process.exit(1);
  });
}
