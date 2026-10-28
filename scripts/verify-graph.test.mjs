// The verify scheduler (issue 134), with fake steps: run with `node --test scripts/*.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGraph } from './verify-graph.mjs';
import { RULES, goldMissing, parseChanged, planChanged } from './verify-changed.mjs';

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

// verify --changed (issue 148): which steps a diff selects. The pure planning lives in
// scripts/verify-changed.mjs so these tests can import it.
const GATES = [
  'hygiene',
  'design',
  'typecheck',
  'lint',
  'format',
  'unit',
  'build',
  'omr',
  'omr:service',
  'library:rules',
  'omr:acceptance',
  'bundle',
  'e2e',
  'e2e:loop',
  'benchmark',
  'benchmark:mutopia',
  'hands',
  'embellish',
];
const DEPS = {
  omr: ['build'],
  'omr:acceptance': ['build'],
  bundle: ['build'],
  e2e: ['build'],
  'e2e:loop': ['build'],
  benchmark: ['build'],
  'benchmark:mutopia': ['build'],
  hands: ['build'],
  embellish: ['build'],
};
const ALWAYS = ['hygiene', 'design', 'typecheck', 'lint', 'format'];
const ran = (p) => p.run.map((r) => r.gate);
const plan = (files, exists = () => true) =>
  planChanged(files, { gates: GATES, deps: DEPS, exists });
const whyOf = (p, gate) => p.run.find((r) => r.gate === gate).why;

test('a docs-only change runs only the always gates', () => {
  const p = plan(['docs/verification-loop.md']);
  assert.deepEqual(ran(p), ALWAYS);
  assert.equal(p.skip.length, 13);
  assert.equal(p.skip.find((s) => s.gate === 'e2e').why, 'no changed path maps to it');
});

test('a camera change runs its units, its specs and the loop', () => {
  const file = 'apps/web/src/scan/camera/GuidedCamera.tsx';
  const p = plan([file]);
  assert.deepEqual(ran(p), [...ALWAYS, 'unit', 'build', 'bundle', 'e2e', 'e2e:loop']);
  assert.deepEqual(p.specs, [
    'scan-camera.spec.ts',
    'scan-camera-real.spec.ts',
    'scan-camera-real-device.spec.ts',
    'scan-grand-staff.spec.ts',
  ]);
  assert.deepEqual(p.unit, { web: ['src/scan/camera/GuidedCamera.tsx'], scripts: false });
  assert.equal(whyOf(p, 'e2e'), file);
  // The path itself is the reason, not the later "needed by" of the dependency closure.
  assert.equal(whyOf(p, 'build'), file);
});

test('a shared path runs every gate', () => {
  const p = plan(['apps/web/src/design/tokens.css']);
  assert.deepEqual(ran(p), GATES);
  assert.equal(p.specs, null);
  assert.equal(p.unit, null);
  assert.equal(whyOf(p, 'embellish'), 'shared: apps/web/src/design/tokens.css');
  assert.deepEqual(ran(plan(['packages/engine/src/fingering/solve.ts'])), GATES);
  assert.deepEqual(ran(plan(['apps/web/src/i18n/i18n.ts'])), GATES);
});

test('a path in no rule runs every gate', () => {
  const p = plan(['tools/new/thing.txt']);
  assert.deepEqual(ran(p), GATES);
  assert.equal(whyOf(p, 'e2e'), 'not in the map: tools/new/thing.txt');
});

test('a gate pulls in the build it needs', () => {
  const p = plan(['research/data/splits/pig.json']);
  assert.deepEqual(ran(p), [
    ...ALWAYS,
    'build',
    'benchmark',
    'benchmark:mutopia',
    'hands',
    'embellish',
  ]);
  assert.equal(whyOf(p, 'build'), 'needed by benchmark');
});

test('the benchmark files also run the whole unit suite, which reads them', () => {
  // packages/engine's textbook, profilesWeights and templates tests read benchmarks/.
  for (const file of ['benchmarks/floor.json', 'benchmarks/textbook/scales.json']) {
    const p = plan([file]);
    assert.ok(ran(p).includes('unit'), file);
    assert.equal(p.unit, null, file);
    for (const gate of ['benchmark', 'benchmark:mutopia', 'hands', 'embellish'])
      assert.ok(ran(p).includes(gate), `${file} ${gate}`);
  }
});

test('scripts the web unit tests import run the whole unit suite', () => {
  const colors = plan(['scripts/check-colors.mjs']);
  assert.deepEqual(ran(colors), [...ALWAYS, 'unit']);
  assert.equal(colors.unit, null);
  for (const file of ['scripts/piano-samples.lock.json', 'scripts/piano-samples-lib.mjs']) {
    const p = plan([file]);
    assert.deepEqual(ran(p), [...ALWAYS, 'unit', 'build', 'bundle', 'e2e'], file);
    assert.equal(p.unit, null, file);
    assert.deepEqual(p.specs, ['pwa.spec.ts'], file);
  }
  // The other scripts still select nothing beyond the always steps.
  assert.deepEqual(ran(plan(['scripts/e2e-webkit.mjs'])), ALWAYS);
});

test('the photos and results the specs read select those specs', () => {
  const photos = plan(['research/omr/photos/manifest.json']);
  for (const gate of ['omr', 'omr:acceptance', 'e2e', 'e2e:loop', 'build'])
    assert.ok(ran(photos).includes(gate), gate);
  assert.deepEqual(photos.specs, [
    'scan-camera.spec.ts',
    'scan-camera-real.spec.ts',
    'scan-camera-real-device.spec.ts',
    'scan-grand-staff.spec.ts',
  ]);
  const results = plan(['research/omr/results/multi-image/review-without-checkbox.png']);
  assert.deepEqual(ran(results), [...ALWAYS, 'build', 'e2e']);
  assert.deepEqual(results.specs, ['scan.spec.ts']);
});

test('a deleted spec selects nothing', () => {
  const gone = 'apps/web/e2e/gone.spec.ts';
  const exists = (path) => path !== gone && path !== 'apps/web/e2e/scan-camera-loop.spec.ts';
  assert.deepEqual(ran(plan([gone], exists)), ALWAYS);
  assert.deepEqual(ran(plan(['apps/web/e2e/scan-camera-loop.spec.ts'], exists)), ALWAYS);
  // Beside a spec that is still there, only the surviving one runs.
  const p = plan([gone, 'apps/web/e2e/about.spec.ts'], exists);
  assert.deepEqual(p.specs, ['about.spec.ts']);
});

test('every step a rule names is a verify step, and a rule that names another throws', () => {
  for (const rule of RULES)
    for (const g of rule.gates === 'all' ? [] : rule.gates)
      assert.ok(GATES.includes(g), `${rule.test[0]} names ${g}`);
  const bad = { gates: GATES.filter((g) => g !== 'e2e:loop'), deps: DEPS, exists: () => true };
  assert.throws(() => planChanged(['docs/a.md'], bad), /e2e:loop/);
});

test('the step list in these tests is the one scripts/verify.mjs runs', () => {
  const source = readFileSync(new URL('./verify.mjs', import.meta.url), 'utf8');
  const names = [...source.matchAll(/^\s*(?:\{ )?name: '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(names)].sort(), [...GATES].sort());
});

test('a spec file runs that spec alone', () => {
  const p = plan(['apps/web/e2e/about.spec.ts', 'apps/web/src/about/AboutView.tsx']);
  assert.deepEqual(p.specs, ['about.spec.ts', 'smoke.spec.ts']);
  for (const gate of ['unit', 'e2e', 'build']) assert.ok(ran(p).includes(gate), gate);
  const loop = plan(['apps/web/e2e/scan-camera-loop.spec.ts']);
  assert.ok(ran(loop).includes('e2e:loop'));
  assert.ok(ran(loop).includes('build'));
  assert.ok(!ran(loop).includes('e2e'));
});

test('research and service code map to their gates', () => {
  assert.deepEqual(ran(plan(['research/omr/service/app.py'])), [
    ...ALWAYS,
    'build',
    'omr:service',
    'omr:acceptance',
  ]);
});

test('the library store maps to its rules gate', () => {
  assert.deepEqual(ran(plan(['library-store/firestore.rules'])), [...ALWAYS, 'library:rules']);
});

test('more paths for one gate are counted', () => {
  const p = plan(['apps/web/src/score/a.ts', 'apps/web/src/score/b.ts']);
  assert.equal(whyOf(p, 'unit'), 'apps/web/src/score/a.ts (+1 more)');
});

test('parseChanged merges, dedups and uses forward slashes', () => {
  assert.deepEqual(parseChanged('a.ts\nsrc\\b.ts\n\n', 'src/b.ts\nc.md\n'), [
    'a.ts',
    'src/b.ts',
    'c.md',
  ]);
});

test('goldMissing looks for FingeringFiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gold-'));
  assert.equal(goldMissing(dir), true);
  mkdirSync(join(dir, 'FingeringFiles'));
  assert.equal(goldMissing(dir), false);
});
