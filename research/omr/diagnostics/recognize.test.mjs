import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Fault, main, measure, parseArgs, planCases, recognizeAll, Usage } from './recognize.mjs';

const XML = (bars, notes = 2) =>
  `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from(
    { length: bars },
    (_, i) =>
      `<measure number="${i + 1}">${'<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>'.repeat(notes)}<note><rest/><duration>1</duration></note></measure>`,
  ).join('')}</part></score-partwise>`;

/** The answer of the live service for a page it read, and the record its Keeper keeps beside it. */
const READY = (bars = 3) => ({
  status: 200,
  body: {
    state: 'ready',
    needsReview: true,
    recognizer: 'HOMR/test',
    capabilities: { originalImageInput: true },
    warnings: [{ code: 'recognition-experimental', message: 'Photo recognition is experimental.' }],
  },
  xml: XML(bars),
  record: Buffer.from(
    JSON.stringify(
      {
        recognizer: 'HOMR/test',
        capabilities: { originalImageInput: true },
        warnings: [
          { code: 'recognition-experimental', message: 'Photo recognition is experimental.' },
        ],
        pianoCueAudit: { removed: [] },
      },
      null,
      2,
    ),
  ),
});
const FAILED = {
  status: 422,
  body: { state: 'failed', failure: { code: 'recognition-failed', message: 'It stopped.' } },
};

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'd2-rr-'));
  const cases = join(root, 'cases');
  const out = join(root, 'out');
  mkdirSync(cases);
  return { root, cases, out, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** A case folder as the gate reads it: photos, their old recognitions, and an old scan.json. */
function writeCase(cases, name, pages, ext = 'jpg') {
  const dir = join(cases, name);
  mkdirSync(dir, { recursive: true });
  for (let n = 1; n <= pages; n++) {
    writeFileSync(join(dir, `page-${n}.${ext}`), `photo ${name} ${n}`);
    writeFileSync(join(dir, `page-${n}-recognized.musicxml`), XML(1));
  }
  writeFileSync(join(dir, 'scan.json'), JSON.stringify({ recognizer: 'old', pages: [] }));
  writeFileSync(join(dir, 'review.png'), 'old screenshot');
  return dir;
}

/** A committed photo set: two photos, the second taken upside down. */
function writePhotos(root) {
  const dir = join(root, 'photos');
  mkdirSync(dir);
  writeFileSync(join(dir, 'first.jpeg'), 'first photo');
  writeFileSync(join(dir, 'second.jpeg'), 'second photo');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      photos: [
        { id: 'first', file: 'first.jpeg', bars: 12, staves: 2, fifths: 0, time: '4/4' },
        {
          id: 'second',
          file: 'second.jpeg',
          bars: 24,
          staves: 2,
          fifths: 1,
          time: null,
          rotate: 180,
          cutOff: true,
        },
      ],
    }),
  );
  return dir;
}

/** A fake recogniser: the answers by call, and what it was given. */
function fake(answers = []) {
  const calls = [];
  return {
    calls,
    recognizePage: (input, work) => {
      calls.push({ input, work, bytes: readFileSync(input, 'utf8') });
      return answers[calls.length - 1] ?? READY(calls.length);
    },
  };
}

const quiet = () => {};

test('the arguments: the toolchain and the output store are required, the cases default to the variable', () => {
  const env = { DIGITUS2_SCAN_CASES: 'C:/cases' };
  const args = parseArgs(['--homr', 'C:/tc', '--out', 'C:/out', 'case-a', 'case-b'], env);
  assert.equal(args.homr, resolve('C:/tc'));
  assert.equal(args.out, resolve('C:/out'));
  assert.equal(args.cases, resolve('C:/cases'));
  assert.deepEqual(args.names, ['case-a', 'case-b']);
  assert.equal(args.prepare, undefined);
  assert.equal(args.photos, undefined);
  const more = parseArgs(
    ['--homr', 'tc', '--out', 'out', '--cases', 'other', '--prepare', 'p.py', '--photos', 'ph'],
    env,
  );
  assert.equal(more.cases, resolve('other'));
  assert.equal(more.prepare, resolve('p.py'));
  assert.equal(more.photos, resolve('ph'));
  assert.throws(() => parseArgs(['--out', 'out'], env), Usage);
  assert.throws(() => parseArgs(['--homr', 'tc'], env), Usage);
  assert.throws(() => parseArgs(['--homr', 'tc', '--out', 'out'], {}), Usage);
  assert.throws(() => parseArgs(['--homr', 'tc', '--out', 'out', '--bogus'], env), Usage);
  assert.throws(() => parseArgs(['--homr', 'tc', '--out', 'C:/cases'], env), /same folder/);
  // The photos alone need no case store, and ask for the photos only even with the variable set.
  assert.equal(parseArgs(['--homr', 'tc', '--out', 'out', '--photos', 'ph'], {}).cases, undefined);
  assert.equal(parseArgs(['--homr', 'tc', '--out', 'out', '--photos', 'ph'], env).cases, undefined);
  assert.equal(
    parseArgs(['--homr', 'tc', '--out', 'out', '--photos', 'ph', '--cases', 'other'], env).cases,
    resolve('other'),
  );
  // recognize.py takes a whole number of threads.
  assert.equal(parseArgs(['--homr', 'tc', '--out', 'out', '--threads', '4'], env).threads, 4);
  assert.throws(() => parseArgs(['--homr', 'tc', '--out', 'out', '--threads', '2.5'], env), Usage);
  assert.throws(() => parseArgs(['--homr', 'tc', '--out', 'out', '--threads', '0'], env), Usage);
});

test('the plan refuses two cases of one name, and a plan without cases', () => {
  const s = scratch();
  try {
    const photos = writePhotos(s.root);
    // A store an earlier --photos run wrote holds photo-first too.
    writeCase(s.cases, 'photo-first', 1);
    assert.throws(() => planCases({ cases: s.cases, photos, names: [] }), /photo-first/);
    const empty = join(s.root, 'empty');
    mkdirSync(empty);
    assert.throws(() => planCases({ cases: empty, names: [] }), Usage);
  } finally {
    s.done();
  }
});

test('the plan: every case of the store with its pages in order, and the photo cases', () => {
  const s = scratch();
  try {
    writeCase(s.cases, 'case-b', 3);
    writeCase(s.cases, 'case-a', 1, 'png');
    mkdirSync(join(s.cases, 'not-a-case'));
    writeFileSync(join(s.cases, 'report.json'), '{}');
    const photos = writePhotos(s.root);
    const plan = planCases({ cases: s.cases, photos, names: [] });
    assert.deepEqual(
      plan.map((c) => [c.name, c.pages.length]),
      [
        ['case-a', 1],
        ['case-b', 3],
        ['photo-first', 1],
        ['photo-second', 1],
      ],
    );
    assert.deepEqual(
      plan[1].pages.map((p) => [p.n, p.source.endsWith(`page-${p.n}.jpg`), p.ext]),
      [
        [1, true, 'jpg'],
        [2, true, 'jpg'],
        [3, true, 'jpg'],
      ],
    );
    assert.equal(plan[0].pages[0].ext, 'png');
    assert.deepEqual(plan[2].expect, {
      photo: 'first',
      bars: 12,
      staves: 2,
      fifths: 0,
      time: '4/4',
    });
    assert.equal(plan[2].pages[0].rotate, undefined);
    assert.equal(plan[3].pages[0].rotate, 180);
    assert.equal(plan[3].pages[0].ext, 'png');
    assert.deepEqual(plan[3].expect, {
      photo: 'second',
      bars: 24,
      staves: 2,
      fifths: 1,
      time: null,
      rotate: 180,
      cutOff: true,
    });
    // Names choose cases from either source; a name that matches none is refused.
    assert.deepEqual(
      planCases({ cases: s.cases, photos, names: ['photo-second', 'case-a'] }).map((c) => c.name),
      ['case-a', 'photo-second'],
    );
    assert.throws(() => planCases({ cases: s.cases, photos, names: ['nowhere'] }), /nowhere/);
  } finally {
    s.done();
  }
});

test('a case is written as the gate reads a kept scan: the photos byte for byte, the recognition and its record, no scan.json', () => {
  const s = scratch();
  try {
    writeCase(s.cases, 'case-a', 2);
    const recogniser = fake();
    const lines = [];
    const summary = recognizeAll(
      { cases: s.cases, out: s.out, names: [] },
      { recognizePage: recogniser.recognizePage, log: (line) => lines.push(line) },
    );
    const dir = join(s.out, 'case-a');
    assert.deepEqual(readdirSync(dir).sort(), [
      'page-1-recognition.json',
      'page-1-recognized.musicxml',
      'page-1.jpg',
      'page-2-recognition.json',
      'page-2-recognized.musicxml',
      'page-2.jpg',
    ]);
    assert.equal(readFileSync(join(dir, 'page-2.jpg'), 'utf8'), 'photo case-a 2');
    assert.equal(readFileSync(join(dir, 'page-2-recognized.musicxml'), 'utf8'), XML(2));
    // The Keeper's record whole, as pull.mjs copies it: readCase spreads it into the mocked answer.
    const record = JSON.parse(readFileSync(join(dir, 'page-1-recognition.json'), 'utf8'));
    assert.equal(record.recognizer, 'HOMR/test');
    assert.deepEqual(record.warnings, [
      { code: 'recognition-experimental', message: 'Photo recognition is experimental.' },
    ]);
    assert.deepEqual(record.pianoCueAudit, { removed: [] });
    assert.match(lines[0], /^case-a page 1\/2: 1 part, 1 bar, 2 notes, \d+\.\d s$/);
    assert.match(lines[1], /^case-a page 2\/2: 1 part, 2 bars, 4 notes, \d+\.\d s$/);
    assert.equal(summary.pages, 2);
    assert.equal(summary.failed, 0);
    assert.match(lines.at(-1), /^1 case, 2 pages: 2 read, 0 failed/);
    // The run's own record sits beside the cases, where the gate does not look.
    const run = JSON.parse(readFileSync(join(s.out, 'rerecognition.json'), 'utf8'));
    assert.equal(run.cases[0].case, 'case-a');
    assert.equal(run.cases[0].pages[1].bars, 2);
    assert.equal(existsSync(join(s.out, '.work')), false);
  } finally {
    s.done();
  }
});

test('without a record from the recogniser, the answer itself is the record', () => {
  const s = scratch();
  try {
    writeCase(s.cases, 'case-a', 1);
    const answer = { ...READY(1), record: undefined };
    recognizeAll(
      { cases: s.cases, out: s.out, names: [] },
      { recognizePage: fake([answer]).recognizePage, log: quiet },
    );
    const record = JSON.parse(
      readFileSync(join(s.out, 'case-a', 'page-1-recognition.json'), 'utf8'),
    );
    assert.deepEqual(record, {
      needsReview: true,
      recognizer: 'HOMR/test',
      capabilities: { originalImageInput: true },
      warnings: [
        { code: 'recognition-experimental', message: 'Photo recognition is experimental.' },
      ],
    });
  } finally {
    s.done();
  }
});

test('a case written again loses what the run before left in it', () => {
  const s = scratch();
  try {
    writeCase(s.cases, 'case-a', 1);
    const dir = join(s.out, 'case-a');
    mkdirSync(dir, { recursive: true });
    // An --out copied from a store: its scan.json would make the gate replay the old answers.
    for (const file of [
      'review.png',
      'score.png',
      'recognition-failed.json',
      'page-2.jpg',
      'scan.json',
      'page-1-id.json',
      'review-1.json',
    ])
      writeFileSync(join(dir, file), 'stale');
    writeFileSync(join(dir, 'notes.txt'), 'kept');
    // The gate's reports on the recognitions this run replaces.
    for (const file of ['report.json', 'report.md', 'report-previous.json'])
      writeFileSync(join(s.out, file), 'stale');
    recognizeAll(
      { cases: s.cases, out: s.out, names: [] },
      { recognizePage: fake().recognizePage, log: quiet },
    );
    assert.deepEqual(readdirSync(dir).sort(), [
      'notes.txt',
      'page-1-recognition.json',
      'page-1-recognized.musicxml',
      'page-1.jpg',
    ]);
    assert.deepEqual(readdirSync(s.out).sort(), ['case-a', 'rerecognition.json']);
  } finally {
    s.done();
  }
});

test('an --out holding cases this run does not recognise is refused untouched', () => {
  const s = scratch();
  try {
    writeCase(s.cases, 'case-a', 1);
    writeCase(s.cases, 'case-b', 1);
    // An earlier run into the same store, of every case.
    recognizeAll(
      { cases: s.cases, out: s.out, names: [] },
      { recognizePage: fake().recognizePage, log: quiet },
    );
    const before = readFileSync(join(s.out, 'case-a', 'page-1-recognized.musicxml'), 'utf8');
    assert.throws(
      () =>
        recognizeAll(
          { cases: s.cases, out: s.out, names: ['case-a'] },
          { recognizePage: fake([READY(7)]).recognizePage, log: quiet },
        ),
      (error) => error instanceof Usage && /case-b/.test(error.message),
    );
    assert.equal(readFileSync(join(s.out, 'case-a', 'page-1-recognized.musicxml'), 'utf8'), before);
  } finally {
    s.done();
  }
});

test('the run works outside --out, records its environment and when it finished', () => {
  const s = scratch();
  try {
    writeCase(s.cases, 'case-a', 1);
    const recogniser = fake([
      { ...READY(1), environment: { platform: 'test', python: '3.11.9', threads: 4 } },
    ]);
    let clock = Date.parse('2026-10-29T10:00:00Z');
    recognizeAll(
      { cases: s.cases, out: s.out, names: [] },
      { recognizePage: recogniser.recognizePage, log: quiet, now: () => (clock += 1000) },
    );
    assert.ok(!resolve(recogniser.calls[0].work).startsWith(resolve(s.out)), 'scratch is short');
    assert.equal(existsSync(recogniser.calls[0].work), false, 'scratch is removed');
    const run = JSON.parse(readFileSync(join(s.out, 'rerecognition.json'), 'utf8'));
    assert.deepEqual(run.environment, { platform: 'test', python: '3.11.9', threads: 4 });
    assert.ok(Date.parse(run.finishedAt) > Date.parse(run.ranAt));
    assert.equal(run.aborted, undefined);
  } finally {
    s.done();
  }
});

test('--prepare cleans a copy of the photo; the case keeps the original', () => {
  const s = scratch();
  try {
    writeCase(s.cases, 'case-a', 1);
    const recogniser = fake();
    const prepared = [];
    recognizeAll(
      { cases: s.cases, out: s.out, names: [], prepare: 'C:/clean.py' },
      {
        recognizePage: recogniser.recognizePage,
        prepare: (file, path) => {
          prepared.push({ file, path });
          writeFileSync(path, 'cleaned ' + readFileSync(path, 'utf8'));
          return { cleaning: 'v1' };
        },
        log: quiet,
      },
    );
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].file, 'C:/clean.py');
    assert.ok(prepared[0].path.endsWith('.jpg'), 'the copy keeps the extension');
    assert.ok(!prepared[0].path.startsWith(join(s.out, 'case-a')), 'never the stored photo');
    assert.equal(recogniser.calls[0].input, prepared[0].path);
    assert.equal(recogniser.calls[0].bytes, 'cleaned photo case-a 1');
    assert.equal(readFileSync(join(s.out, 'case-a', 'page-1.jpg'), 'utf8'), 'photo case-a 1');
    assert.equal(readFileSync(join(s.cases, 'case-a', 'page-1.jpg'), 'utf8'), 'photo case-a 1');
    const run = JSON.parse(readFileSync(join(s.out, 'rerecognition.json'), 'utf8'));
    assert.deepEqual(run.cases[0].pages[0].prepared, { cleaning: 'v1' });
  } finally {
    s.done();
  }
});

test('the photo cases: one page each, turned when the manifest says so, with expect.json', () => {
  const s = scratch();
  try {
    const photos = writePhotos(s.root);
    const turned = [];
    const recogniser = fake();
    const lines = [];
    recognizeAll(
      { photos, out: s.out, names: [] },
      {
        recognizePage: recogniser.recognizePage,
        turn: (from, to, degrees) => {
          turned.push({ from, degrees });
          writeFileSync(to, 'turned ' + readFileSync(from, 'utf8'));
        },
        log: (line) => lines.push(line),
      },
    );
    assert.deepEqual(readdirSync(join(s.out, 'photo-first')).sort(), [
      'expect.json',
      'page-1-recognition.json',
      'page-1-recognized.musicxml',
      'page-1.jpg',
    ]);
    assert.equal(readFileSync(join(s.out, 'photo-first', 'page-1.jpg'), 'utf8'), 'first photo');
    assert.deepEqual(turned, [{ from: join(photos, 'second.jpeg'), degrees: 180 }]);
    assert.equal(
      readFileSync(join(s.out, 'photo-second', 'page-1.png'), 'utf8'),
      'turned second photo',
    );
    assert.equal(recogniser.calls[1].bytes, 'turned second photo');
    assert.deepEqual(JSON.parse(readFileSync(join(s.out, 'photo-second', 'expect.json'), 'utf8')), {
      photo: 'second',
      bars: 24,
      staves: 2,
      fifths: 1,
      time: null,
      rotate: 180,
      cutOff: true,
    });
    // The line says what the page should hold.
    assert.match(lines[0], /^photo-first page 1\/1: 1 part, 1 bar, 2 notes \(expected 12 bars\)/);
  } finally {
    s.done();
  }
});

test('a page the service refuses is recorded as the service answered, and the run says the gate cannot replay it', () => {
  const s = scratch();
  try {
    writeCase(s.cases, 'case-a', 3);
    const timedOut = {
      status: 504,
      body: { state: 'timed_out', failure: { code: 'recognition-timeout', message: 'Too long.' } },
    };
    const lines = [];
    const summary = recognizeAll(
      { cases: s.cases, out: s.out, names: [] },
      {
        recognizePage: fake([READY(1), FAILED, timedOut]).recognizePage,
        log: (l) => lines.push(l),
      },
    );
    const dir = join(s.out, 'case-a');
    assert.equal(existsSync(join(dir, 'page-2-recognized.musicxml')), false);
    assert.equal(existsSync(join(dir, 'page-3-recognition.json')), false);
    assert.ok(existsSync(join(dir, 'page-3.jpg')), 'every photo is kept');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'recognition-failed.json'), 'utf8')), {
      pages: [
        { page: 2, status: 422, answer: FAILED.body },
        { page: 3, status: 504, answer: timedOut.body },
      ],
    });
    assert.match(lines[1], /^case-a page 2\/3: refused 422 recognition-failed, \d+\.\d s$/);
    assert.match(lines[2], /^case-a page 3\/3: refused 504 recognition-timeout, \d+\.\d s$/);
    assert.equal(summary.failed, 2);
    assert.ok(lines.some((l) => /recognition-failed\.json/.test(l) && /case-a/.test(l)));
  } finally {
    s.done();
  }
});

test('a refusal keeps its cause beside the cases; a fault of the toolchain stops the run instead of counting as a refusal', () => {
  const s = scratch();
  try {
    writeCase(s.cases, 'case-a', 1);
    writeCase(s.cases, 'case-b', 2);
    writeCase(s.cases, 'case-c', 1);
    const noMusic = {
      ...FAILED,
      diagnostic: {
        cause: 'ValueError: HOMR result contains no pitched music',
        environment: false,
      },
    };
    const tooLong = {
      ...FAILED,
      diagnostic: {
        cause: 'FileNotFoundError: [WinError 206] The filename or extension is too long',
        environment: true,
      },
    };
    assert.throws(
      () =>
        recognizeAll(
          { cases: s.cases, out: s.out, names: [] },
          { recognizePage: fake([noMusic, READY(2), tooLong]).recognizePage, log: quiet },
        ),
      (error) =>
        error instanceof Fault && /case-b page 2/.test(error.message) && /206/.test(error.message),
    );
    // case-a's refusal is a measurement: the service's answer in the case, its cause beside it.
    const failedA = JSON.parse(
      readFileSync(join(s.out, 'case-a', 'recognition-failed.json'), 'utf8'),
    );
    assert.deepEqual(failedA, { pages: [{ page: 1, status: 422, answer: FAILED.body }] });
    // case-b stopped on the toolchain: no refusal recorded, and no part of it left for the gate.
    assert.equal(existsSync(join(s.out, 'case-b', 'recognition-failed.json')), false);
    assert.equal(existsSync(join(s.out, 'case-b', 'page-1-recognized.musicxml')), false);
    assert.equal(existsSync(join(s.out, 'case-c')), false);
    const run = JSON.parse(readFileSync(join(s.out, 'rerecognition.json'), 'utf8'));
    assert.match(run.aborted, /206/);
    assert.deepEqual(
      run.cases.map((c) => c.case),
      ['case-a'],
    );
    assert.equal(run.cases[0].pages[0].cause, noMusic.diagnostic.cause);
  } finally {
    s.done();
  }
});

test('the command line: 2 for a wrong command or an empty plan, 3 when the run stops', () => {
  const s = scratch();
  const error = console.error;
  console.error = quiet;
  try {
    const toolchain = join(s.root, 'homr');
    assert.equal(main(['--homr', toolchain, '--out', s.out, '--cases', s.cases]), 2);
    mkdirSync(join(toolchain, 'venv', 'Scripts'), { recursive: true });
    mkdirSync(join(toolchain, 'venv', 'bin'), { recursive: true });
    writeFileSync(join(toolchain, 'venv', 'Scripts', 'python.exe'), '');
    writeFileSync(join(toolchain, 'venv', 'bin', 'python'), '');
    // No case in the store.
    assert.equal(main(['--homr', toolchain, '--out', s.out, '--cases', s.cases]), 2);
    writeCase(s.cases, 'case-a', 1);
    // The stand-in interpreter cannot run recognize.py: the run stops.
    const python = process.env.DIGITUS2_PYTHON;
    process.env.DIGITUS2_PYTHON = join(s.root, 'no-python-here');
    try {
      assert.equal(main(['--homr', toolchain, '--out', s.out, '--cases', s.cases]), 3);
    } finally {
      if (python === undefined) delete process.env.DIGITUS2_PYTHON;
      else process.env.DIGITUS2_PYTHON = python;
    }
    assert.ok(JSON.parse(readFileSync(join(s.out, 'rerecognition.json'), 'utf8')).aborted);
  } finally {
    console.error = error;
    s.done();
  }
});

test('a recogniser that breaks stops the run with its message', () => {
  const s = scratch();
  try {
    writeCase(s.cases, 'case-a', 1);
    assert.throws(
      () =>
        recognizeAll(
          { cases: s.cases, out: s.out, names: [] },
          {
            recognizePage: () => {
              throw new Error('HOMR source differs from prepared pins');
            },
            log: quiet,
          },
        ),
      /prepared pins/,
    );
  } finally {
    s.done();
  }
});

test('measure counts the parts, the bars of the longest part and the sounding notes', () => {
  assert.deepEqual(measure(XML(4, 3)), { parts: 1, bars: 4, notes: 12 });
  const two = XML(2).replace(
    '</score-partwise>',
    '<part id="P2"><measure number="1"/></part></score-partwise>',
  );
  assert.deepEqual(measure(two), { parts: 2, bars: 2, notes: 4 });
});

// The Python side drives the scan service's own Service with a stand-in recogniser, so the answer
// and the record are the live service's code path. CI runs these tests with Node only: without a
// Python 3.10 or later the check is skipped.
function findPython() {
  for (const command of [process.env.DIGITUS2_PYTHON, 'python', 'python3'].filter(Boolean)) {
    const r = spawnSync(
      command,
      ['-I', '-c', 'import sys;print(sys.version_info[:2] >= (3, 10))'],
      {
        encoding: 'utf8',
      },
    );
    if (r.status === 0 && r.stdout.trim() === 'True') return command;
  }
  return undefined;
}
const PYTHON = findPython();
const HERE = import.meta.dirname;

/** Runs recognize.py's `recognize_page` on a photo with a stand-in for homr. */
function pythonPage(work, photo, behaviour) {
  const script = `
import sys, json, threading
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import recognize
from recognition_errors import RecognitionError
from worker import PhotoPdfRecognizer

class Photo:
    name = "HOMR/stand-in"
    capabilities = {"originalImageInput": True}
    warnings = [{"code": "recognition-experimental", "message": "Experimental."}]
    def __call__(self, source, destination, cancelled):
        behaviour = sys.argv[4]
        if behaviour == "refuse":
            raise RecognitionError("multiple-scores-detected", "Several scores.")
        if behaviour == "slow":
            raise TimeoutError()
        if behaviour == "no-music":
            raise ValueError("HOMR result contains no pitched music")
        if behaviour == "too-long":
            raise FileNotFoundError(2, "The filename or extension is too long")
        if behaviour == "dll":
            (destination / "execution.log").write_text("ImportError: DLL load failed while importing onnxruntime_pybind11_state", encoding="utf-8")
            raise RecognitionError("recognition-failed", "The recognizer stopped.")
        if behaviour == "child-path":
            (destination / "execution.log").write_text("An error occurred while processing x.jpeg: [Errno 2] No such file or directory: 'x_piano-cues.json'", encoding="utf-8")
            raise RecognitionError("recognition-failed", "The recognizer stopped.")
        if behaviour == "child-bug":
            (destination / "execution.log").write_text("An error occurred while processing x.jpeg: list index out of range", encoding="utf-8")
            raise RecognitionError("recognition-failed", "The recognizer stopped.")
        (destination / "recognition.json").write_text(json.dumps({"recognizer": self.name,
            "capabilities": self.capabilities, "warnings": self.warnings + [{"code": "extra", "message": "Read."}],
            "pianoCueAudit": {"removed": []}}, indent=2), encoding="utf-8")
        out = destination / "result.musicxml"
        out.write_bytes(b'\\xef\\xbb\\xbf<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>')
        return out

recognizer = PhotoPdfRecognizer(recognize.NoPdf(), Photo())
recognize.recognize_page(recognizer, Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[3]) / "svc",
                         environment={"threads": 4})
`;
  const out = join(work, behaviour);
  mkdirSync(out, { recursive: true });
  const r = spawnSync(PYTHON, ['-I', '-c', script, HERE, photo, out, behaviour], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '', 'nothing on stdout: the service log goes to stderr');
  return out;
}

test(
  'recognize.py answers through the service: the answer, the notation and the Keeper record',
  {
    skip: !PYTHON && 'no Python 3.10 or later',
  },
  () => {
    const work = mkdtempSync(join(tmpdir(), 'd2-rr-py-'));
    try {
      const photo = join(work, 'page.jpg');
      writeFileSync(photo, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
      const ready = pythonPage(work, photo, 'ready');
      const answer = JSON.parse(readFileSync(join(ready, 'answer.json'), 'utf8'));
      assert.equal(answer.status, 200);
      // The live answer: needsReview, the recogniser's name and capabilities, its record's warnings.
      assert.deepEqual(answer.body, {
        state: 'ready',
        needsReview: true,
        recognizer: 'HOMR/stand-in',
        capabilities: { originalImageInput: true },
        warnings: [
          { code: 'recognition-experimental', message: 'Experimental.' },
          { code: 'extra', message: 'Read.' },
        ],
      });
      // The notation as the app receives it: decoded, without the byte order mark.
      assert.equal(
        readFileSync(join(ready, 'recognized.musicxml'), 'utf8'),
        '<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>',
      );
      const record = JSON.parse(readFileSync(join(ready, 'recognition.json'), 'utf8'));
      assert.deepEqual(record.pianoCueAudit, { removed: [] });
      // The service's temporary folders are gone.
      assert.deepEqual(readdirSync(join(ready, 'svc')), []);

      const refused = JSON.parse(
        readFileSync(join(pythonPage(work, photo, 'refuse'), 'answer.json'), 'utf8'),
      );
      assert.equal(refused.status, 422);
      assert.deepEqual(refused.body, {
        state: 'failed',
        failure: { code: 'multiple-scores-detected', message: 'Several scores.' },
      });
      const slow = JSON.parse(
        readFileSync(join(pythonPage(work, photo, 'slow'), 'answer.json'), 'utf8'),
      );
      assert.equal(slow.status, 504);
      assert.equal(slow.body.failure.code, 'recognition-timeout');
      assert.equal(slow.diagnostic, undefined);
      assert.deepEqual(answer.environment, { threads: 4 });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  },
);

test(
  'recognize.py tells a fault of the toolchain or this computer from the scanner refusing the page',
  { skip: !PYTHON && 'no Python 3.10 or later' },
  () => {
    const work = mkdtempSync(join(tmpdir(), 'd2-rr-py-'));
    try {
      const photo = join(work, 'page.jpg');
      writeFileSync(photo, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
      const read = (behaviour) =>
        JSON.parse(readFileSync(join(pythonPage(work, photo, behaviour), 'answer.json'), 'utf8'));
      // The scanner's refusals: the live service answers them 422, and they are measurements.
      const refused = read('refuse');
      assert.deepEqual(refused.diagnostic, {
        cause: 'RecognitionError: Several scores.',
        environment: false,
      });
      const noMusic = read('no-music');
      assert.equal(noMusic.status, 422);
      assert.equal(noMusic.body.failure.code, 'recognition-failed');
      assert.deepEqual(noMusic.diagnostic, {
        cause: 'ValueError: HOMR result contains no pitched music',
        environment: false,
      });
      // The same 422 from this computer: a path too long, a library that does not load.
      const tooLong = read('too-long');
      assert.equal(tooLong.status, 422);
      assert.equal(tooLong.diagnostic.environment, true);
      assert.match(tooLong.diagnostic.cause, /^FileNotFoundError: .*too long/);
      const dll = read('dll');
      assert.equal(dll.diagnostic.environment, true);
      assert.match(dll.diagnostic.log, /DLL load failed/);
      // homr's child stopping on a file it could not write (a path too long) is this computer;
      // stopping on its own error is the scanner, and a measurement.
      assert.equal(read('child-path').diagnostic.environment, true);
      const bug = read('child-bug');
      assert.equal(bug.diagnostic.environment, false);
      assert.match(bug.diagnostic.log, /index out of range/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  },
);

test(
  "recognize.py: the handler's refusals of an upload, and the live thread budget",
  { skip: !PYTHON && 'no Python 3.10 or later' },
  () => {
    const work = mkdtempSync(join(tmpdir(), 'd2-rr-py-'));
    try {
      const notImage = join(work, 'page.jpg');
      writeFileSync(notImage, 'not a photo');
      assert.deepEqual(
        JSON.parse(readFileSync(join(pythonPage(work, notImage, 'ready'), 'answer.json'), 'utf8')),
        { status: 415, body: { error: 'unsupported-input' }, environment: { threads: 4 } },
      );
      const big = join(work, 'big.jpg');
      const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
      bytes.set([0xff, 0xd8, 0xff, 0xe0]);
      writeFileSync(big, bytes);
      const tooLarge = JSON.parse(
        readFileSync(join(pythonPage(work, big, 'ready'), 'answer.json'), 'utf8'),
      );
      assert.deepEqual(tooLarge.body, { error: 'upload-too-large' });
      assert.equal(tooLarge.status, 413);
      // --threads, else DIGITUS2_OMR_THREADS, else the 4 deploy.ps1 gives the service.
      const r = spawnSync(
        PYTHON,
        [
          '-I',
          '-c',
          'import sys;sys.path.insert(0,sys.argv[1]);import recognize as r;print(r.thread_budget(None,{}),r.thread_budget(None,{"DIGITUS2_OMR_THREADS":"2"}),r.thread_budget(6,{"DIGITUS2_OMR_THREADS":"2"}),r.thread_budget(None,{"DIGITUS2_OMR_THREADS":"x"}))',
          HERE,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), '4 2 6 4');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  },
);
