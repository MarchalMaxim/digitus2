import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareRuns,
  diffReports,
  formatBars,
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
    // Every page 1 refused and no report: the gate replays a refusal, so it has not run.
    const page1 = { pages: [{ page: 1, status: 422, answer: {} }] };
    const refused = store('refused', {
      'rerecognition.json': { ...recognized, cases: [{ case: 'case-a' }, { case: 'case-b' }] },
      'case-a/page-1.jpg': 'photo',
      'case-a/recognition-failed.json': page1,
      'case-b/page-1.jpg': 'photo',
      'case-b/recognition-failed.json': page1,
    });
    assert.throws(() => readRun(refused), /run the gate/);
    // No case the gate could replay (no page 1 answered at all): each case is unrecognized.
    const unanswered = store('unanswered', {
      'rerecognition.json': { ...recognized, cases: [{ case: 'case-a' }] },
      'case-a/page-1.jpg': 'photo',
      'case-a/recognition-failed.json': { pages: [] },
    });
    assert.deepEqual(readRun(unanswered).cases, [
      { case: 'case-a', outcome: 'unrecognized', fingerings: 0, refusedPages: [] },
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

// The rows the gate writes since the comparison reads more than the outcome (issue 233): what each
// page was read as, the case's truth, how many pages agree with it, and whether a retake is asked.
const read = (bars, { staves = 2, fifths = 1, time = '3/4' } = {}) => ({
  bars,
  staves,
  fifths,
  time,
  parts: 1,
  joins: false,
});
const refusedPage = (status = 422) => ({
  bars: null,
  staves: null,
  fifths: null,
  time: null,
  parts: null,
  joins: false,
  refused: { status },
});
const truth = (...bars) => ({
  pages: bars.map((b) => ({ bars: b, staves: 2, fifths: 1, time: '3/4' })),
});
/**
 * The agreement as the gate counts it (cases.ts agreementOf): a fact the truth leaves out agrees
 * on every page; otherwise a page read (not refused) with that fact, staves only for one part or a
 * pair the app joins.
 */
function agreeOf(pages, expect) {
  if (!expect) return null;
  const count = (key) =>
    expect.pages.filter((want, i) => {
      const page = pages[i] && !pages[i].refused ? pages[i] : undefined;
      if (want[key] == null) return true;
      if (!page) return false;
      if (key === 'staves')
        return page.parts === 1 ? page.staves === want.staves : want.staves === 2 && page.joins;
      return page[key] === want[key];
    }).length;
  return {
    bars: count('bars'),
    staves: count('staves'),
    fifths: count('fifths'),
    time: count('time'),
    of: expect.pages.length,
  };
}
const row = (
  name,
  outcome,
  { pages = [read(24)], expect = truth(24), retake = false, fingerings = 0 } = {},
) => ({
  case: name,
  outcome,
  why: '',
  fingerings,
  pages,
  expect,
  agree: agreeOf(pages, expect),
  retake,
  refusedPages: pages.flatMap((p, i) => (p.refused ? [i + 1] : [])),
});

test('--against judges what was read: bars, key, staves and time against the truth, and a retake asked', () => {
  const before = {
    cases: [
      row('case-bars', 'usable'),
      row('case-key', 'usable'),
      row('case-retake', 'usable'),
      row('case-retake-refused', 'explained'),
      row('case-short', 'explained', { pages: [read(9)] }),
      row('case-short-unread', 'unrecognized', { pages: [refusedPage()] }),
      row('case-whole', 'explained', { pages: [read(9)] }),
      row('case-mixed', 'usable', { pages: [read(9)] }),
      row('case-fixed', 'usable', { pages: [read(9)] }),
      row('case-retake-gone', 'usable', { retake: true }),
      row('case-time', 'usable', { pages: [read(19), read(24)], expect: truth(19, 24) }),
      row('case-page', 'usable', { pages: [read(19), read(24)], expect: truth(19, 24) }),
      row('case-all', 'usable', { fingerings: 200 }),
      row('case-swap', 'usable', { pages: [read(19), read(24)], expect: truth(19, 24) }),
      row('case-no-truth', 'usable', { pages: [read(30)], expect: null }),
      { case: 'case-old', outcome: 'usable', why: '', pages: 1, fingerings: 50 },
    ],
  };
  const after = {
    cases: [
      row('case-bars', 'usable', { pages: [read(9)] }),
      row('case-key', 'usable', { pages: [read(24, { fifths: 0 })] }),
      row('case-retake', 'usable', { retake: true }),
      row('case-retake-refused', 'explained', { retake: true }),
      // A refusal that turns into a short usable score is no gain: the reader plays 9 bars of 24.
      row('case-short', 'usable', { pages: [read(9)] }),
      row('case-short-unread', 'usable', { pages: [read(9)] }),
      row('case-whole', 'usable'),
      row('case-mixed', 'usable', { pages: [read(24, { fifths: 0 })] }),
      row('case-fixed', 'usable'),
      row('case-retake-gone', 'usable'),
      row('case-time', 'usable', {
        pages: [read(19), read(24, { time: '4/4' })],
        expect: truth(19, 24),
      }),
      row('case-page', 'usable', {
        pages: [read(19), refusedPage()],
        expect: truth(19, 24),
        retake: true,
      }),
      row('case-all', 'usable', {
        pages: [read(9, { fifths: 0 })],
        retake: true,
        fingerings: 80,
      }),
      // The same bars in all, each page read with the other's count.
      row('case-swap', 'usable', { pages: [read(24), read(19)], expect: truth(19, 24) }),
      row('case-no-truth', 'usable', { pages: [read(12)], expect: null }),
      // An old row before: only the outcome compares, so the retake is not judged.
      row('case-old', 'usable', { retake: true }),
    ],
  };
  const rows = compareRuns(before, after);
  const by = Object.fromEntries(rows.map((r) => [r.case, r]));
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.case, r.change])), {
    'case-all': 'worse',
    'case-bars': 'worse',
    'case-fixed': 'better',
    'case-key': 'worse',
    'case-mixed': 'worse',
    // Without a truth, a usable case that reads fewer bars is worse.
    'case-no-truth': 'worse',
    'case-old': 'same',
    'case-page': 'worse',
    'case-retake': 'worse',
    'case-retake-gone': 'better',
    'case-retake-refused': 'same',
    'case-short': 'worse',
    'case-short-unread': 'worse',
    'case-swap': 'worse',
    'case-time': 'worse',
    'case-whole': 'better',
  });
  assert.equal(by['case-all'].moved, 'bars 24/24 -> 9/24, key lost, retake asked');
  assert.equal(by['case-bars'].moved, 'bars 24/24 -> 9/24');
  assert.equal(by['case-key'].moved, 'key lost');
  assert.equal(by['case-retake'].moved, 'retake asked');
  assert.equal(by['case-retake-refused'].moved, 'retake asked');
  assert.equal(by['case-short'].moved, 'explained -> usable, accepted short');
  assert.equal(
    by['case-short-unread'].moved,
    'unrecognized -> usable, bars 0/24 -> 9/24, staves found, key found, time found, page 1 read, accepted short',
  );
  assert.equal(by['case-whole'].moved, 'explained -> usable, bars 9/24 -> 24/24');
  assert.equal(by['case-mixed'].moved, 'bars 9/24 -> 24/24, key lost');
  assert.equal(by['case-fixed'].moved, 'bars 9/24 -> 24/24');
  assert.equal(by['case-retake-gone'].moved, 'retake dropped');
  assert.equal(by['case-time'].moved, 'time lost (2/2 -> 1/2)');
  assert.equal(
    by['case-page'].moved,
    'bars 43/43 -> 19/43 (2/2 -> 1/2), staves lost (2/2 -> 1/2), key lost (2/2 -> 1/2), time lost (2/2 -> 1/2), page 2 refused, retake asked',
  );
  assert.equal(by['case-swap'].moved, 'bars 43/43 -> 43/43 (2/2 -> 0/2)');
  assert.equal(by['case-no-truth'].moved, 'bars 30 -> 12');
  assert.equal(by['case-old'].moved, '');
  const text = formatComparison(rows);
  assert.match(
    text,
    /^\| Case \| Before \| Fingerings \| After \| Fingerings \| Change \| Moved \|\n\| --- \| --- \| ---: \| --- \| ---: \| --- \| --- \|/,
  );
  assert.match(
    text,
    /\| case-all \| usable \| 200 \| usable \| 80 \| worse \| bars 24\/24 -> 9\/24, key lost, retake asked \|/,
  );
  assert.match(text, /\| case-old \| usable \| 50 \| usable \| 0 \| same \| {2}\|/);
});

test('--against: a case the second run lost is worse and says so, a new case is new', () => {
  const rows = compareRuns(
    { cases: [row('case-x', 'usable')] },
    { cases: [row('case-y', 'usable')] },
  );
  assert.deepEqual(
    rows.map((r) => [r.case, r.change, r.moved]),
    [
      ['case-x', 'worse', 'absent'],
      ['case-y', 'new', ''],
    ],
  );
});

test('--against keeps the outcome the gate gave a case with a refused page', () => {
  const root = mkdtempSync(join(tmpdir(), 'd2-report-'));
  try {
    const before = join(root, 'before');
    const after = join(root, 'after');
    for (const dir of [before, after]) mkdirSync(dir);
    writeFileSync(
      join(before, 'report.json'),
      JSON.stringify({ ...run([]), cases: [row('case-x', 'usable')] }),
    );
    // The gate replayed the case with its page 1 refused: its row says so, and holds.
    const replayed = row('case-x', 'explained', { pages: [refusedPage(504)], retake: true });
    writeFileSync(join(after, 'report.json'), JSON.stringify({ ...run([]), cases: [replayed] }));
    mkdirSync(join(after, 'case-x'));
    writeFileSync(
      join(after, 'case-x', 'recognition-failed.json'),
      JSON.stringify({ pages: [{ page: 1, status: 504, answer: {} }] }),
    );
    const runAfter = readRun(after);
    assert.equal(runAfter.cases[0].outcome, 'explained');
    assert.deepEqual(runAfter.cases[0].refusedPages, [1]);
    assert.deepEqual(runAfter.cases[0].pages, replayed.pages);
    assert.deepEqual(runAfter.cases[0].expect, replayed.expect);
    assert.deepEqual(runAfter.cases[0].agree, replayed.agree);
    assert.equal(runAfter.cases[0].retake, true);
    const [compared] = compareRuns(readRun(before), runAfter);
    assert.equal(compared.change, 'worse');
    assert.equal(
      compared.moved,
      'usable -> explained, bars 24/24 -> 0/24, staves lost, key lost, time lost, page 1 refused, retake asked',
    );
    // An old row of the same case is the scanner's refusal: unrecognized, with its refused pages.
    writeFileSync(join(after, 'report.json'), JSON.stringify(run([['case-x', 'failed']])));
    assert.deepEqual(readRun(after).cases, [
      { case: 'case-x', outcome: 'unrecognized', fingerings: 0, refusedPages: [1] },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the bars of a case, page by page, against the truth where it is known', () => {
  assert.equal(formatBars(row('case-x', 'usable', { pages: [read(9)] })), '9/24');
  assert.equal(
    formatBars(
      row('case-x', 'usable', {
        pages: [read(19), refusedPage(), read(20)],
        expect: truth(19, 24, 24),
      }),
    ),
    '19/19, refused/24, 20/24',
  );
  assert.equal(formatBars(row('case-x', 'usable', { pages: [read(30)], expect: null })), '30');
  // An old row knows no bars.
  assert.equal(formatBars({ case: 'case-x', outcome: 'usable', pages: 2 }), null);
});

test('the printed report is report.md as the gate wrote it; the diff shows the bars read against the truth', () => {
  const root = mkdtempSync(join(tmpdir(), 'd2-report-'));
  const log = console.log;
  const write = process.stdout.write;
  const out = [];
  console.log = (line) => out.push(String(line));
  process.stdout.write = (chunk) => (out.push(String(chunk)), true);
  try {
    writeFileSync(join(root, 'report.md'), '# Scan validation cases\n\n| Case |\n');
    writeFileSync(
      join(root, 'report.json'),
      JSON.stringify({
        ranAt: '2026-10-29T12:00:00Z',
        cases: [
          { ...row('case-x', 'usable', { pages: [read(9)] }), why: 'drew fingerings' },
          row('case-y', 'usable', { pages: [read(12)], expect: null }),
        ],
      }),
    );
    writeFileSync(
      join(root, 'report-previous.json'),
      JSON.stringify({
        ranAt: '2026-10-29T11:00:00Z',
        cases: [
          row('case-x', 'explained'),
          row('case-y', 'usable', { pages: [read(12)], expect: null }),
        ],
      }),
    );
    withStore(root, () => {
      assert.equal(main([]), 0);
      assert.equal(main(['--diff']), 0);
    });
    // report.md carries the bars itself: printed once, as written.
    assert.equal(out.slice(0, -1).join(''), '# Scan validation cases\n\n| Case |\n');
    assert.equal(out.at(-1), 'case-x: explained -> usable, bars 24/24 -> 9/24 (drew fingerings)');
  } finally {
    console.log = log;
    process.stdout.write = write;
    rmSync(root, { recursive: true, force: true });
  }
});

test('--against judges the bars by their distance from the truth, page by page', () => {
  const cut = (bars) => ({ pages: [{ bars, staves: 2, fifths: 1, time: '3/4', cutOff: true }] });
  const before = {
    cases: [
      row('case-near', 'usable', { pages: [read(23)] }),
      row('case-far', 'usable', { pages: [read(26)], expect: truth(15), retake: true }),
      row('case-closer', 'usable', { pages: [read(28)] }),
      row('case-pages', 'usable', { pages: [read(19), read(23)], expect: truth(19, 24) }),
      row('case-fewer', 'usable', { pages: [read(63)], expect: null }),
      row('case-more', 'usable', { pages: [read(45)], expect: null }),
      row('case-cut', 'failed', { pages: [refusedPage()], expect: cut(11) }),
      row('case-cut-lost', 'usable', { pages: [read(9)], expect: cut(11) }),
      row('case-cut-over', 'usable', { pages: [read(20)], expect: cut(24) }),
      row('case-cut-under', 'usable', { pages: [read(28)], expect: cut(24) }),
      row('case-extra', 'explained', { pages: [refusedPage()] }),
      row('case-unchecked', 'explained', { pages: [refusedPage()], expect: null }),
      row('case-half', 'explained', {
        pages: [read(19), refusedPage()],
        expect: {
          pages: [truth(19).pages[0], { bars: null, staves: null, fifths: null, time: null }],
        },
      }),
    ],
  };
  const after = {
    cases: [
      // Never exactly right, and far less so now: worse, though no page agreed on either side.
      row('case-near', 'usable', { pages: [read(9)] }),
      // A scan that stops asking for a retake while reading worse is no gain.
      row('case-far', 'usable', { pages: [read(3)], expect: truth(15) }),
      row('case-closer', 'usable', { pages: [read(25)] }),
      // The totals stay 42/43; page 1 moved away from its truth.
      row('case-pages', 'usable', { pages: [read(18), read(24)], expect: truth(19, 24) }),
      row('case-fewer', 'usable', { pages: [read(45)], expect: null }),
      row('case-more', 'usable', { pages: [read(63)], expect: null }),
      // A cut-off page shows fewer bars than its page holds: 9 of 11 is no short acceptance.
      row('case-cut', 'usable', { pages: [read(9)], expect: cut(11) }),
      row('case-cut-lost', 'usable', { pages: [read(3)], expect: cut(11) }),
      // Over the whole page's bars is wrong on a cut-off photo, under them is what it shows.
      row('case-cut-over', 'usable', { pages: [read(28)], expect: cut(24) }),
      row('case-cut-under', 'usable', { pages: [read(20)], expect: cut(24) }),
      row('case-extra', 'usable', { pages: [read(26)] }),
      // Usable now, with nothing to check it against: not counted better.
      row('case-unchecked', 'usable', { pages: [read(3)], expect: null }),
      row('case-half', 'usable', {
        pages: [read(19), read(3)],
        expect: {
          pages: [truth(19).pages[0], { bars: null, staves: null, fifths: null, time: null }],
        },
      }),
    ],
  };
  const rows = compareRuns(before, after);
  const by = Object.fromEntries(rows.map((r) => [r.case, [r.change, r.moved]]));
  assert.deepEqual(by, {
    'case-near': ['worse', 'bars 23/24 -> 9/24'],
    'case-far': ['worse', 'bars 26/15 -> 3/15, retake dropped'],
    'case-closer': ['better', 'bars 28/24 -> 25/24'],
    'case-pages': ['worse', 'bars 19/19, 23/24 -> 18/19, 24/24'],
    'case-fewer': ['worse', 'bars 63 -> 45'],
    'case-more': ['same', 'bars 45 -> 63'],
    'case-cut': [
      'better',
      'failed -> usable, bars 0/11 -> 9/11, staves found, key found, time found, page 1 read',
    ],
    'case-cut-lost': ['worse', 'bars 9/11 -> 3/11'],
    'case-cut-over': ['worse', 'bars 20/24 -> 28/24'],
    // Fewer bars on a cut-off photo may be what it shows, or bars lost: no gain either way.
    'case-cut-under': ['same', 'bars 28/24 -> 20/24'],
    'case-extra': [
      'worse',
      'explained -> usable, bars 0/24 -> 26/24, staves found, key found, time found, page 1 read, accepted with extra bars',
    ],
    'case-unchecked': ['same', 'explained -> usable, bars 0 -> 3, page 1 read, usable unchecked'],
    'case-half': ['same', 'explained -> usable, page 2 read, usable unchecked'],
  });
});

test('--against: on a cut-off page the retake is the right answer, and its bars never call it better', () => {
  const page = (bars, cutOff) => ({
    bars,
    staves: 2,
    fifths: 1,
    time: '3/4',
    ...(cutOff && { cutOff }),
  });
  const cut = (...pages) => ({ pages });
  const before = {
    cases: [
      row('case-dropped', 'usable', {
        pages: [read(28)],
        expect: cut(page(24, true)),
        retake: true,
      }),
      row('case-asked', 'usable', { pages: [read(20)], expect: cut(page(24, true)) }),
      row('case-asked-refused', 'explained', {
        pages: [refusedPage()],
        expect: cut(page(24, true)),
      }),
      row('case-mixed', 'usable', {
        pages: [read(17), read(28)],
        expect: cut(page(19), page(24, true)),
      }),
    ],
  };
  const after = {
    cases: [
      // The measured case: closer to the page's bars, but the photo is still cut off.
      row('case-dropped', 'usable', { pages: [read(20)], expect: cut(page(24, true)) }),
      row('case-asked', 'usable', { pages: [read(20)], expect: cut(page(24, true)), retake: true }),
      row('case-asked-refused', 'explained', {
        pages: [refusedPage()],
        expect: cut(page(24, true)),
        retake: true,
      }),
      // Page 1 comes closer to its truth; page 2, cut off, reads fewer and is not counted.
      row('case-mixed', 'usable', {
        pages: [read(19), read(20)],
        expect: cut(page(19), page(24, true)),
      }),
    ],
  };
  const by = Object.fromEntries(
    compareRuns(before, after).map((r) => [r.case, [r.change, r.moved]]),
  );
  assert.deepEqual(by, {
    'case-dropped': ['worse', 'bars 28/24 -> 20/24, retake dropped on a cut-off page'],
    'case-asked': ['better', 'retake asked on a cut-off page'],
    'case-asked-refused': ['better', 'retake asked on a cut-off page'],
    'case-mixed': ['better', 'bars 45/43 -> 39/43 (0/2 -> 1/2)'],
  });
});

test('--against: a cut-off page that loses its bars is worse, and a retake is judged by its page', () => {
  const page = (bars, cutOff) => ({
    bars,
    staves: 2,
    fifths: 1,
    time: '3/4',
    ...(cutOff && { cutOff }),
  });
  const cut = (...pages) => ({ pages });
  const before = {
    cases: [
      row('case-collapse', 'usable', { pages: [read(28)], expect: cut(page(24, true)) }),
      row('case-empty', 'usable', { pages: [read(25)], expect: cut(page(24, true)) }),
      row('case-lost-asked', 'usable', { pages: [read(25)], expect: cut(page(24, true)) }),
      // The retake named page 1, which is not cut off; page 2 is.
      row('case-other-page', 'usable', {
        pages: [read(12), read(20)],
        expect: cut(page(19), page(24, true)),
        retake: true,
      }),
      row('case-other-asked', 'usable', {
        pages: [read(19), read(20)],
        expect: cut(page(19), page(24, true)),
      }),
    ],
  };
  const after = {
    cases: [
      // Over the page's bars before, almost none now: bars lost, not what the photo shows.
      row('case-collapse', 'usable', { pages: [read(3)], expect: cut(page(24, true)) }),
      row('case-empty', 'usable', { pages: [read(0)], expect: cut(page(24, true)) }),
      row('case-lost-asked', 'usable', {
        pages: [read(3)],
        expect: cut(page(24, true)),
        retake: true,
      }),
      row('case-other-page', 'usable', {
        pages: [read(19), read(20)],
        expect: cut(page(19), page(24, true)),
      }),
      // The retake may name page 1, which reads right: asking it of a usable case is no gain.
      row('case-other-asked', 'usable', {
        pages: [read(19), read(20)],
        expect: cut(page(19), page(24, true)),
        retake: true,
      }),
    ],
  };
  const by = Object.fromEntries(
    compareRuns(before, after).map((r) => [r.case, [r.change, r.moved]]),
  );
  assert.deepEqual(by, {
    'case-collapse': ['worse', 'bars 28/24 -> 3/24'],
    'case-empty': ['worse', 'bars 25/24 -> 0/24'],
    'case-lost-asked': ['worse', 'bars 25/24 -> 3/24, retake asked on a cut-off page'],
    'case-other-page': ['better', 'bars 32/43 -> 39/43 (0/2 -> 1/2), retake dropped'],
    'case-other-asked': ['worse', 'retake asked'],
  });
});

test('--against reads one truth for both runs: a truth one side lacks is taken from the other', () => {
  const rows = compareRuns(
    { cases: [row('case-x', 'explained', { pages: [refusedPage()], expect: null })] },
    { cases: [row('case-x', 'usable', { pages: [read(20)] })] },
  );
  assert.deepEqual(
    rows.map((r) => [r.change, r.moved]),
    [
      [
        'worse',
        'explained -> usable, bars 0/24 -> 20/24, page 1 read, truth after only, accepted short',
      ],
    ],
  );
  const changed = compareRuns(
    { cases: [row('case-x', 'usable', { pages: [read(20)], expect: truth(20) })] },
    { cases: [row('case-x', 'usable', { pages: [read(20)], expect: truth(24) })] },
  );
  assert.deepEqual(
    changed.map((r) => [r.change, r.moved]),
    [['same', 'truth changed']],
  );
});

test('--against refuses to compare rows of an older gate with rows that carry the pages', () => {
  const root = mkdtempSync(join(tmpdir(), 'd2-report-'));
  const error = console.error;
  const log = console.log;
  const errors = [];
  console.error = (line) => errors.push(line);
  console.log = () => {};
  try {
    const older = join(root, 'older');
    const newer = join(root, 'newer');
    for (const dir of [older, newer]) mkdirSync(dir);
    writeFileSync(join(older, 'report.json'), JSON.stringify(run([['case-x', 'failed']])));
    writeFileSync(
      join(newer, 'report.json'),
      JSON.stringify({ ...run([]), cases: [row('case-x', 'failed', { pages: [refusedPage()] })] }),
    );
    assert.equal(main(['--against', older, newer]), 2);
    assert.match(errors.at(-1), /older gate/);
    assert.ok(errors.at(-1).includes(`run the gate on ${older} again`));
    assert.equal(main(['--against', newer, older]), 2);
    assert.equal(main(['--against', newer, newer]), 0);
  } finally {
    console.error = error;
    console.log = log;
    rmSync(root, { recursive: true, force: true });
  }
});
