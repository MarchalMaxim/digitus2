// The verify scheduler (issue 134), with fake steps: run with `node --test scripts/*.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGraph } from './verify-graph.mjs';

/** A starter whose steps finish when the test says so, recording what ran at the same time. */
function fakeStarter(outcomes = {}) {
  const running = new Set();
  const overlaps = [];
  const started = [];
  const start = (step, plan) => {
    started.push(step.name);
    for (const other of running) overlaps.push([other, step.name].sort().join('+'));
    running.add(step.name);
    return new Promise((resolve) =>
      setTimeout(() => {
        running.delete(step.name);
        resolve({ ok: outcomes[step.name] !== 'fail', plan });
      }, 5),
    );
  };
  return { start, overlaps, started };
}

const step = (name, extra = {}) => ({ name, prepare: () => ({ cmd: name, args: [] }), ...extra });

test('independent steps run at the same time', async () => {
  const s = fakeStarter();
  await runGraph([step('lint'), step('typecheck')], { start: s.start });
  assert.deepEqual(s.overlaps, ['lint+typecheck']);
});

test('a step waits for its dependencies', async () => {
  const s = fakeStarter();
  const results = await runGraph([step('benchmark', { deps: ['build'] }), step('build')], {
    start: s.start,
  });
  assert.deepEqual(s.started, ['build', 'benchmark']);
  assert.deepEqual(
    results.map((r) => r.name),
    ['benchmark', 'build'],
  );
});

test('preconditions are checked only once the dependencies are done', async () => {
  // A fresh checkout has no build output: checked up front, the benchmark would be skipped.
  let built = false;
  const s = fakeStarter();
  const build = { name: 'build', prepare: () => ({ cmd: 'build', args: [] }) };
  const start = (st, plan) => {
    if (st.name === 'build') built = true;
    return s.start(st, plan);
  };
  const bench = step('benchmark', {
    deps: ['build'],
    prepare: () => (built ? { cmd: 'bench', args: [] } : { skip: 'engine not built' }),
  });
  const results = await runGraph([build, bench], { start });
  assert.equal(results.find((r) => r.name === 'benchmark').status, 'PASS');
});

test('heavy steps never overlap', async () => {
  const s = fakeStarter();
  await runGraph(
    [
      step('unit', { heavy: true }),
      step('e2e', { heavy: true }),
      step('lint'),
      step('acceptance', { heavy: true }),
    ],
    { start: s.start },
  );
  for (const pair of s.overlaps)
    assert.ok(!['acceptance+e2e', 'e2e+unit', 'acceptance+unit'].includes(pair), pair);
  assert.ok(s.overlaps.includes('lint+unit'));
});

test('a failed dependency leaves its dependants visibly not run', async () => {
  const s = fakeStarter({ build: 'fail' });
  const results = await runGraph([step('build'), step('hands', { deps: ['build'] })], {
    start: s.start,
  });
  assert.deepEqual(
    results.map((r) => [r.name, r.status, r.detail]),
    [
      ['build', 'FAIL', results[0].detail],
      ['hands', 'SKIP', 'not run: build failed'],
    ],
  );
  assert.deepEqual(s.started, ['build']);
});

test('only the selected steps run, and a dependency that is not selected is not waited for', async () => {
  const s = fakeStarter();
  const results = await runGraph([step('build'), step('omr', { deps: ['build'] })], {
    start: s.start,
    only: new Set(['omr']),
  });
  assert.deepEqual(s.started, ['omr']);
  assert.deepEqual(
    results.map((r) => r.name),
    ['omr'],
  );
});

test('a step that skips itself is reported as skipped', async () => {
  const s = fakeStarter();
  const results = await runGraph([step('e2e', { prepare: () => ({ skip: 'no config' }) })], {
    start: s.start,
  });
  assert.deepEqual(results, [{ name: 'e2e', status: 'SKIP', detail: 'no config' }]);
});

test('serial runs one step at a time in the listed order', async () => {
  const s = fakeStarter();
  await runGraph([step('lint'), step('typecheck'), step('build')], {
    start: s.start,
    serial: true,
  });
  assert.deepEqual(s.overlaps, []);
  assert.deepEqual(s.started, ['lint', 'typecheck', 'build']);
});

test('the results keep the listed order, not the finishing order', async () => {
  const start = (st) =>
    new Promise((resolve) => setTimeout(() => resolve({ ok: true }), st.name === 'slow' ? 20 : 1));
  const results = await runGraph([step('slow'), step('fast')], { start });
  assert.deepEqual(
    results.map((r) => r.name),
    ['slow', 'fast'],
  );
});

test('a dependency listed later that skips itself does not stall the run', async () => {
  const s = fakeStarter();
  const results = await runGraph(
    [
      step('hands', { deps: ['build'] }),
      step('build', { prepare: () => ({ skip: 'nothing to build' }) }),
    ],
    { start: s.start },
  );
  assert.deepEqual(
    results.map((r) => [r.name, r.status]),
    [
      ['hands', 'SKIP'],
      ['build', 'SKIP'],
    ],
  );
});

test('serial mode runs a dependency listed after its dependant first, and does not stall', async () => {
  const s = fakeStarter();
  const results = await runGraph([step('hands', { deps: ['build'] }), step('build')], {
    start: s.start,
    serial: true,
  });
  assert.deepEqual(s.started, ['build', 'hands']);
  assert.deepEqual(
    results.map((r) => r.status),
    ['PASS', 'PASS'],
  );
});

test('a step whose precondition check throws fails, and the run still ends with a summary', async () => {
  const s = fakeStarter();
  const results = await runGraph(
    [
      step('build'),
      step('hands', {
        deps: ['build'],
        prepare: () => {
          throw new Error('bad floor.json');
        },
      }),
    ],
    { start: s.start },
  );
  assert.deepEqual(
    results.map((r) => [r.name, r.status]),
    [
      ['build', 'PASS'],
      ['hands', 'FAIL'],
    ],
  );
  assert.match(results[1].detail, /bad floor\.json/);
});

test('a step that cannot be started fails without stopping the others', async () => {
  const start = (st) =>
    st.name === 'lint' ? Promise.reject(new Error('spawn failed')) : Promise.resolve({ ok: true });
  const results = await runGraph([step('lint'), step('typecheck')], { start });
  assert.deepEqual(
    results.map((r) => [r.name, r.status]),
    [
      ['lint', 'FAIL'],
      ['typecheck', 'PASS'],
    ],
  );
  assert.match(results[0].detail, /spawn failed/);
});
