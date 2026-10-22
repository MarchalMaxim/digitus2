// `pnpm verify --changed` (issue 148): which verify steps a diff selects. No side effects on import,
// so scripts/verify-graph.test.mjs can test it; scripts/verify.mjs does the running.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Fast and cheap: they run for every change (hygiene and design take under a second). */
export const ALWAYS = ['hygiene', 'design', 'typecheck', 'lint', 'format'];

const CAMERA_SPECS = [
  'scan-camera.spec.ts',
  'scan-camera-real.spec.ts',
  'scan-camera-real-device.spec.ts',
  'scan-grand-staff.spec.ts',
];
const SCAN_SPECS = [
  'scan.spec.ts',
  'scan-edit.spec.ts',
  'scan-phone.spec.ts',
  'scan-rotation.spec.ts',
  'scan-grand-staff.spec.ts',
  'scan-camera.spec.ts',
];
const SCORE_SPECS = [
  'score.spec.ts',
  'playback.spec.ts',
  'seek.spec.ts',
  'keyboard.spec.ts',
  'keyboard-view.spec.ts',
  'hand-letters.spec.ts',
  'hand-switch.spec.ts',
  'burst.spec.ts',
  'red.spec.ts',
  'export.spec.ts',
  'ornaments.spec.ts',
  'embellish.spec.ts',
  'midi.spec.ts',
  'memory.spec.ts',
  'states.spec.ts',
  'import-lifetime.spec.ts',
  'scan-grand-staff.spec.ts',
];
/** What a web source change needs: its unit tests, a build, the bundle size, and some specs. */
const web = (specs) => ({ gates: ['unit', 'build', 'bundle', 'e2e'], specs });
const SCAN_GATES = ['unit', 'build', 'bundle', 'e2e', 'e2e:loop'];
const BENCH_GATES = ['benchmark', 'benchmark:mutopia', 'hands', 'embellish'];

/**
 * The map from a changed path to the steps that cover it. The first matching rule wins; `gates`
 * is a list of steps or 'all' (a shared path), `specs` the Playwright specs of the rule ('self':
 * the changed spec file; 'all': every spec), `unit: 'full'` the whole test suite (the web-only
 * `vitest related` cannot see a test that reads the path). A path no rule matches selects every
 * step. Every step a rule names must be a verify step: planChanged throws on any other name.
 * @type {{ test: RegExp[], gates: string[] | 'all', specs?: string[] | 'all' | 'self', unit?: 'full' }[]}
 */
export const RULES = [
  // Nothing to run beyond the always steps.
  {
    test: [
      /\.md$/,
      /^docs\//,
      /^\.github\//,
      /^(LICENSE|\.gitattributes|\.prettierrc|\.prettierignore)$/,
    ],
    gates: [],
  },
  // Shared: the engine, the app shell, the design system, i18n, the test setup, the configs, the library.
  {
    test: [
      /^packages\/engine\//,
      /^apps\/web\/src\/(app|design|i18n|engine|test)\//,
      /^apps\/web\/src\/[^/]+$/,
      /^apps\/web\/(index\.html|package\.json|vite\.config\.ts|tsconfig\.json|playwright\.config\.ts)$/,
      /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|eslint\.config\.js)$/,
      /^content\//,
    ],
    gates: 'all',
  },
  { test: [/^apps\/web\/e2e\/scan-camera-loop\.spec\.ts$/], gates: ['e2e:loop'] },
  { test: [/^apps\/web\/e2e\/[^/]+\.spec\.ts$/], gates: ['e2e'], specs: 'self' },
  { test: [/^apps\/web\/(e2e|fixtures)\//], gates: ['unit', 'e2e'], specs: 'all' },
  { test: [/^apps\/web\/src\/scan\/camera\//], gates: SCAN_GATES, specs: CAMERA_SPECS },
  { test: [/^apps\/web\/src\/scan\//], gates: SCAN_GATES, specs: SCAN_SPECS },
  { test: [/^apps\/web\/src\/score\//], ...web(SCORE_SPECS) },
  {
    test: [/^apps\/web\/src\/audio\//],
    ...web([
      'playback.spec.ts',
      'seek.spec.ts',
      'keyboard.spec.ts',
      'memory.spec.ts',
      'ornaments.spec.ts',
      'pwa.spec.ts',
    ]),
  },
  {
    test: [/^apps\/web\/src\/library\//],
    ...web([
      'library.spec.ts',
      'local-library.spec.ts',
      'smoke.spec.ts',
      'states.spec.ts',
      'import-lifetime.spec.ts',
      'midi.spec.ts',
      'pwa.spec.ts',
    ]),
  },
  { test: [/^apps\/web\/src\/about\//], ...web(['about.spec.ts', 'smoke.spec.ts']) },
  { test: [/^apps\/web\/src\/export\//], ...web(['export.spec.ts']) },
  { test: [/^apps\/web\/src\/sw\//], ...web(['pwa.spec.ts']) },
  {
    test: [/^apps\/web\/public\//],
    gates: ['build', 'bundle', 'e2e'],
    specs: ['pwa.spec.ts', 'smoke.spec.ts'],
  },
  { test: [/^research\/omr\/(service|prototypes)\//], gates: ['omr:service', 'omr:acceptance'] },
  // The photos the camera specs film and the acceptance floors count.
  {
    test: [/^research\/omr\/photos\//],
    gates: ['omr', 'omr:acceptance', 'e2e', 'e2e:loop'],
    specs: CAMERA_SPECS,
  },
  { test: [/^research\/omr\/results\/multi-image\//], gates: ['e2e'], specs: ['scan.spec.ts'] },
  { test: [/^research\/omr\//], gates: ['omr', 'omr:acceptance'] },
  { test: [/^research\/data\/splits\//], gates: BENCH_GATES },
  // The engine unit tests read benchmarks/floor.json and benchmarks/textbook.
  { test: [/^benchmarks\//], gates: ['unit', ...BENCH_GATES], unit: 'full' },
  { test: [/^research\//, /^content\/tools\//], gates: [] },
  { test: [/^scripts\/verify/], gates: ['unit'] },
  { test: [/^scripts\/check-bundle-size/], gates: ['bundle'] },
  // Web unit tests import these; the piano sample lock also decides the service worker and the build.
  { test: [/^scripts\/check-colors/], gates: ['unit'], unit: 'full' },
  {
    test: [/^scripts\/piano-samples/],
    gates: ['unit', 'build', 'bundle', 'e2e'],
    specs: ['pwa.spec.ts'],
    unit: 'full',
  },
  { test: [/^scripts\//], gates: [] },
];

const WEB = 'apps/web/';

/**
 * Plans a run for the changed files.
 * @param {string[]} files forward-slash paths relative to the repository root
 * @param {{ gates: string[], deps: Record<string, string[]>, exists?: (path: string) => boolean }} graph
 *   the steps in run order and their dependencies; `exists` tells a deleted spec from a changed one
 * @returns {{
 *   run: { gate: string, why: string }[],
 *   skip: { gate: string, why: string }[],
 *   specs: string[] | null,
 *   unit: { web: string[], scripts: boolean } | null,
 * }} `specs` null runs every spec; `unit` null runs the full test suite
 */
export function planChanged(files, { gates, deps, exists = existsSync }) {
  // A rule that names a step verify does not have (a typo, a renamed step) would drop that step
  // from every plan without a word.
  for (const rule of RULES)
    for (const g of rule.gates === 'all' ? [] : rule.gates)
      if (!gates.includes(g))
        throw new Error(`verify --changed: a rule names "${g}", which is not a verify step`);
  /** @type {Map<string, { kind: 'path' | 'shared' | 'map', path: string }[]>} */
  const triggers = new Map();
  const trigger = (gate, kind, path) => {
    if (!triggers.has(gate)) triggers.set(gate, []);
    triggers.get(gate).push({ kind, path });
  };
  let allSpecs = false;
  let unitFull = false;
  /** @type {string[]} */
  const specs = [];
  const unitWeb = [];
  let unitScripts = false;
  for (const file of files) {
    // A deleted spec has nothing to run (Playwright fails on a filter that matches no file).
    if (/\.spec\.ts$/.test(file) && !exists(file)) continue;
    const rule = RULES.find((r) => r.test.some((t) => t.test(file)));
    if (!rule || rule.gates === 'all') {
      const kind = rule ? 'shared' : 'map';
      for (const g of gates) trigger(g, kind, file);
      allSpecs = true;
      unitFull = true;
      continue;
    }
    for (const g of rule.gates) {
      trigger(g, 'path', file);
      if (g === 'unit') {
        if (rule.specs === 'all' || rule.unit === 'full') unitFull = true;
        else if (file.startsWith(WEB)) unitWeb.push(file.slice(WEB.length));
        else if (file.startsWith('scripts/')) unitScripts = true;
      }
    }
    if (rule.specs === 'all') allSpecs = true;
    else if (rule.specs === 'self') specs.push(file.slice(file.lastIndexOf('/') + 1));
    else if (rule.specs) specs.push(...rule.specs);
  }

  const reason = (gate) => {
    const list = triggers.get(gate);
    const first = list[0];
    const more = list.filter((t) => t.kind === first.kind).length - 1;
    const text =
      first.kind === 'shared'
        ? `shared: ${first.path}`
        : first.kind === 'map'
          ? `not in the map: ${first.path}`
          : first.path;
    return more > 0 ? `${text} (+${more} more)` : text;
  };

  const why = new Map();
  for (const g of gates) {
    if (ALWAYS.includes(g)) why.set(g, 'always');
    else if (triggers.has(g)) why.set(g, reason(g));
  }
  // A selected step waits for the steps it needs, so those run too.
  for (let grew = true; grew;) {
    grew = false;
    for (const g of gates) {
      if (why.has(g)) continue;
      const dependant = gates.find((d) => why.has(d) && (deps[d] ?? []).includes(g));
      if (dependant) {
        why.set(g, `needed by ${dependant}`);
        grew = true;
      }
    }
  }

  return {
    run: gates.filter((g) => why.has(g)).map((gate) => ({ gate, why: why.get(gate) })),
    skip: gates
      .filter((g) => !why.has(g))
      .map((gate) => ({ gate, why: 'no changed path maps to it' })),
    specs: allSpecs ? null : [...new Set(specs)],
    unit: unitFull ? null : { web: [...new Set(unitWeb)], scripts: unitScripts },
  };
}

/** The paths of a `git diff --name-only` and a `git ls-files --others` output, merged and deduplicated. */
export function parseChanged(diffOut, untrackedOut) {
  const paths = `${diffOut}\n${untrackedOut}`
    .split('\n')
    .map((l) => l.trim().replaceAll('\\', '/'))
    .filter(Boolean);
  return [...new Set(paths)];
}

/** True when a gold directory lacks its `FingeringFiles/` folder (tracked manifests alone are no data). */
export function goldMissing(dir, exists = existsSync) {
  return !exists(join(dir, 'FingeringFiles'));
}

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });

/**
 * The files changed since the branch left origin/main (committed and uncommitted), untracked files
 * included. The diff is against the merge-base, not origin/main's tip, because main moves fast.
 * Nothing is fetched.
 * @returns {{ base: string, files: string[] } | { error: string }}
 */
export function changedFiles() {
  let base = git('merge-base', 'HEAD', 'origin/main');
  if (base.status !== 0) base = git('merge-base', 'HEAD', 'main');
  if (base.status !== 0) return { error: 'no merge-base with origin/main or main' };
  const sha = base.stdout.trim();
  const diff = git('diff', '--name-only', '--no-renames', sha);
  const untracked = git('ls-files', '--others', '--exclude-standard');
  if (diff.status !== 0 || untracked.status !== 0)
    return { error: `git failed: ${(diff.stderr || untracked.stderr).trim()}` };
  return { base: sha, files: parseChanged(diff.stdout, untracked.stdout) };
}
