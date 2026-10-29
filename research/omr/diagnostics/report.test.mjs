import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffReports, formatDiff } from './report.mjs';

const report = (cases) => ({
  ranAt: '2026-10-28T23:00:00Z',
  cases: cases.map(([name, outcome, why = '']) => ({ case: name, outcome, why })),
});

test('the diff lists the cases whose outcome changed, and those only one run has', () => {
  const before = report([
    ['boellmann', 'explained'],
    ['paper-roses', 'failed'],
    ['gone', 'usable'],
    ['same', 'usable'],
  ]);
  const after = report([
    ['boellmann', 'usable', 'Use for fingerings drew fingerings'],
    ['paper-roses', 'explained', 'refused; named in the alert; fix: select'],
    ['new', 'failed', 'the review did not settle in 90 s'],
    ['same', 'usable'],
  ]);
  const changes = diffReports(before, after);
  assert.deepEqual(
    changes.map((c) => [c.case, c.before, c.after]),
    [
      ['boellmann', 'explained', 'usable'],
      ['gone', 'usable', null],
      ['new', null, 'failed'],
      ['paper-roses', 'failed', 'explained'],
    ],
  );
  assert.equal(
    formatDiff(changes).split('\n')[0],
    'boellmann: explained -> usable (Use for fingerings drew fingerings)',
  );
  assert.match(formatDiff(changes), /gone: usable -> absent/);
});

test('the same outcomes are no change', () => {
  const run = report([['boellmann', 'usable']]);
  assert.deepEqual(diffReports(run, run), []);
  assert.equal(formatDiff([]), 'No case changed outcome.');
});
