import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareRuns,
  diffReports,
  formatComparison,
  formatDiff,
  main,
  readRun,
} from './report.mjs';

const report = (cases) => ({
  ranAt: '2026-10-28T23:00:00Z',
  cases: cases.map(([name, outcome, why = '']) => ({ case: name, outcome, why })),
});

test('the diff lists the cases whose outcome changed, and those only one run has', () => {
  const before = report([
    ['case-x', 'explained'],
    ['case-y', 'failed'],
    ['gone', 'usable'],
    ['same', 'usable'],
  ]);
  const after = report([
    ['case-x', 'usable', 'Use for fingerings drew fingerings'],
    ['case-y', 'explained', 'refused; named in the alert; fix: select'],
    ['new', 'failed', 'the review did not settle in 90 s'],
    ['same', 'usable'],
  ]);
  const changes = diffReports(before, after);
  assert.deepEqual(
    changes.map((c) => [c.case, c.before, c.after]),
    [
      ['case-x', 'explained', 'usable'],
      ['case-y', 'failed', 'explained'],
      ['gone', 'usable', null],
      ['new', null, 'failed'],
    ],
  );
  assert.equal(
    formatDiff(changes).split('\n')[0],
    'case-x: explained -> usable (Use for fingerings drew fingerings)',
  );
  assert.match(formatDiff(changes), /gone: usable -> absent/);
});

test('the same outcomes are no change', () => {
  const run = report([['case-x', 'usable']]);
  assert.deepEqual(diffReports(run, run), []);
  assert.equal(formatDiff([]), 'No case changed outcome.');
});

/** Runs `body` with DIGITUS2_SCAN_CASES set to `store`, or unset, and puts it back after. */
function withStore(store, body) {
  const kept = process.env.DIGITUS2_SCAN_CASES;
  if (store === undefined) delete process.env.DIGITUS2_SCAN_CASES;
  else process.env.DIGITUS2_SCAN_CASES = store;
  try {
    return body();
  } finally {
    if (kept === undefined) delete process.env.DIGITUS2_SCAN_CASES;
    else process.env.DIGITUS2_SCAN_CASES = kept;
  }
}

const run = (cases) => ({
  ranAt: '2026-10-29T10:00:00Z',
  cases: cases.map(([name, outcome, fingerings = 0]) => ({
    case: name,
    outcome,
    why: '',
    fingerings,
  })),
});

test('--against: one row per case, better, worse, same or new, by outcome', () => {
  const before = run([
    ['case-a', 'explained'],
    ['case-b', 'usable', 40],
    ['case-c', 'failed'],
    ['case-d', 'usable', 12],
    ['case-e', 'explained'],
  ]);
  const after = run([
    ['case-a', 'usable', 55],
    ['case-b', 'explained'],
    ['case-c', 'failed'],
    ['case-d', 'usable', 30],
    ['case-f', 'usable', 9],
  ]);
  const rows = compareRuns(before, after);
  assert.deepEqual(
    rows.map((r) => [r.case, r.before?.outcome ?? null, r.after?.outcome ?? null, r.change]),
    [
      ['case-a', 'explained', 'usable', 'better'],
      ['case-b', 'usable', 'explained', 'worse'],
      ['case-c', 'failed', 'failed', 'same'],
      ['case-d', 'usable', 'usable', 'same'],
      // A case the new run lost is worse: a scanner change must not hide its own cases.
      ['case-e', 'explained', null, 'worse'],
      ['case-f', null, 'usable', 'new'],
    ],
  );
  assert.equal(rows[3].after.fingerings, 30);
  const text = formatComparison(rows);
  assert.match(text, /^\| Case \| Before \| Fingerings \| After \| Fingerings \| Change \|/);
  assert.match(text, /\| case-b \| usable \| 40 \| explained \| 0 \| worse \|/);
  assert.match(text, /\| case-e \| explained \| 0 \| absent \| {2}\| worse \|/);
  assert.match(text, /6 cases: 1 better, 2 worse, 2 same, 1 new\.$/);
});

test('--against reads a store: a case whose recognition failed ranks below a failed replay', () => {
  const root = mkdtempSync(join(tmpdir(), 'd2-report-'));
  try {
    const before = join(root, 'before');
    const after = join(root, 'after');
    for (const dir of [before, after]) mkdirSync(dir);
    writeFileSync(
      join(before, 'report.json'),
      JSON.stringify(
        run([
          ['case-a', 'failed'],
          ['case-b', 'failed'],
        ]),
      ),
    );
    // case-a's page 1 was refused: the gate never saw the case. case-b replayed in part.
    writeFileSync(join(after, 'report.json'), JSON.stringify(run([['case-b', 'usable', 8]])));
    for (const name of ['case-a', 'case-b']) {
      mkdirSync(join(after, name));
      writeFileSync(join(after, name, 'recognition-failed.json'), JSON.stringify({ pages: [] }));
    }
    const rows = compareRuns(readRun(before), readRun(after));
    assert.deepEqual(
      rows.map((r) => [r.case, r.after.outcome, r.change]),
      [
        ['case-a', 'unrecognized', 'worse'],
        ['case-b', 'unrecognized', 'worse'],
      ],
    );
    // A report.json named directly is read as its store, with the same refusals.
    assert.deepEqual(readRun(join(after, 'report.json')), readRun(after));

    const lines = [];
    const log = console.log;
    console.log = (line) => lines.push(line);
    try {
      withStore(after, () => {
        assert.equal(main(['--against', before]), 1);
        assert.equal(main(['--against', before, before]), 0);
        assert.equal(main(['--against', join(root, 'nowhere')]), 2);
      });
    } finally {
      console.log = log;
    }
    assert.match(lines[0], /\| case-a \| failed \| 0 \| unrecognized \| 0 \| worse \|/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--against reads only a store whose report describes its recognitions', () => {
  const root = mkdtempSync(join(tmpdir(), 'd2-report-'));
  const error = console.error;
  const log = console.log;
  const errors = [];
  console.error = (line) => errors.push(line);
  console.log = () => {};
  try {
    const store = (name, files) => {
      const dir = join(root, name);
      mkdirSync(dir);
      for (const [file, value] of Object.entries(files)) {
        mkdirSync(join(dir, file, '..'), { recursive: true });
        writeFileSync(join(dir, file), typeof value === 'string' ? value : JSON.stringify(value));
      }
      return dir;
    };
    const recognized = {
      ranAt: '2026-10-29T11:00:00Z',
      finishedAt: '2026-10-29T11:30:00Z',
      cases: [{ case: 'case-a', pages: [] }],
    };
    // The gate ran after the recognitions: read as it is.
    const fresh = store('fresh', {
      'rerecognition.json': recognized,
      'report.json': { ...run([['case-a', 'usable', 3]]), ranAt: '2026-10-29T12:00:00Z' },
    });
    assert.equal(readRun(fresh).cases[0].outcome, 'usable');
    // The report is of the recognitions before: the gate has not run on these.
    const stale = store('stale', {
      'rerecognition.json': recognized,
      'report.json': { ...run([['case-a', 'usable', 3]]), ranAt: '2026-10-29T10:00:00Z' },
    });
    assert.throws(() => readRun(stale), /older than the recognitions/);
    // A re-recognition that stopped is no run to compare.
    const aborted = store('aborted', {
      'rerecognition.json': { ...recognized, aborted: 'recognize.py (exit 1)' },
      'report.json': { ...run([['case-a', 'usable', 3]]), ranAt: '2026-10-29T12:00:00Z' },
    });
    assert.throws(() => readRun(aborted), /stopped/);
    // Every page 1 refused: the gate had nothing to replay and wrote no report.
    const refused = store('refused', {
      'rerecognition.json': { ...recognized, cases: [{ case: 'case-a' }, { case: 'case-b' }] },
      'case-a/page-1.jpg': 'photo',
      'case-a/recognition-failed.json': { pages: [] },
      'case-b/page-1.jpg': 'photo',
      'case-b/recognition-failed.json': { pages: [] },
    });
    assert.deepEqual(readRun(refused).cases, [
      { case: 'case-a', outcome: 'unrecognized', fingerings: 0 },
      { case: 'case-b', outcome: 'unrecognized', fingerings: 0 },
    ]);
    // A case the gate could replay, and no report: the gate has not run.
    const unrun = store('unrun', {
      'rerecognition.json': recognized,
      'case-a/page-1.jpg': 'photo',
      'case-a/page-1-recognized.musicxml': '<score-partwise/>',
    });
    assert.throws(() => readRun(unrun), /run the gate/);
    // A store against a report kept elsewhere: the two would not be read alike.
    const previous = join(fresh, 'report-previous.json');
    writeFileSync(previous, JSON.stringify(run([['case-a', 'usable', 3]])));
    assert.equal(main(['--against', previous, fresh]), 2);
    assert.match(errors.at(-1), /store/);
    // Two report files outside any store are read as they are.
    const loose = join(root, 'loose.json');
    writeFileSync(loose, JSON.stringify(run([['case-a', 'explained']])));
    assert.equal(main(['--against', loose, previous]), 0);
    // The second run defaults to the variable; without it, the command is wrong.
    withStore(undefined, () => assert.equal(main(['--against', fresh]), 2));
  } finally {
    console.error = error;
    console.log = log;
    rmSync(root, { recursive: true, force: true });
  }
});
