// The scan validation gate's report (issue 233, docs/scanning.md "Validation cases").
//
//   node research/omr/diagnostics/report.mjs                  print report.md of the last run
//   node research/omr/diagnostics/report.mjs --diff           the last run against the one before
//   node research/omr/diagnostics/report.mjs --diff <a> <b>   two report.json files, a before b
//   node research/omr/diagnostics/report.mjs --against <before> [<after>]
//        every case of two runs side by side, better, worse or the same; exit 1 when one is worse.
//        Each side is a case store (its report.json, and recognition-failed.json in its cases), or
//        its report.json; <after> defaults to DIGITUS2_SCAN_CASES. Two other report files compare
//        as they are, but not against a store, which is read with its refusals. With
//        recognize.mjs, this gates a scanner change: the gate runs on both stores, then the new
//        one is read against the old. A store whose re-recognition stopped, or whose report is
//        older than its recognitions, is refused.
//
// apps/web/e2e/scan-cases.spec.ts writes report.json and report.md into DIGITUS2_SCAN_CASES and
// keeps the run before as report-previous.json.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The cases whose outcome changed between two reports, by case name: a case only one report has
 * is listed with `null` on the other side.
 * @returns {{ case: string, before: string | null, after: string | null, why: string }[]}
 */
export function diffReports(before, after) {
  const outcomes = (report) =>
    new Map((report?.cases ?? []).map((c) => [String(c.case), { outcome: c.outcome, why: c.why }]));
  const a = outcomes(before);
  const b = outcomes(after);
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  return names
    .filter((name) => a.get(name)?.outcome !== b.get(name)?.outcome)
    .map((name) => ({
      case: name,
      before: a.get(name)?.outcome ?? null,
      after: b.get(name)?.outcome ?? null,
      why: b.get(name)?.why ?? '',
    }));
}

/** The diff as lines: `case: explained -> usable`, or a line saying nothing changed. */
export function formatDiff(changes) {
  if (!changes.length) return 'No case changed outcome.';
  return changes
    .map(
      (c) =>
        `${c.case}: ${c.before ?? 'absent'} -> ${c.after ?? 'absent'}${c.why ? ` (${c.why})` : ''}`,
    )
    .join('\n');
}

function readReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * How good an outcome is, for --against: a usable case beats an explained one, which beats a
 * failed replay; a case whose recognition the service refused (recognize.mjs wrote
 * recognition-failed.json) ranks below them all, since the gate cannot replay it yet.
 */
const RANK = { usable: 3, explained: 2, failed: 1, unrecognized: 0 };

const IMAGE = /^page-1\.(jpe?g|png)$/i;

/** A JSON file, or undefined when there is none. */
function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
}

/**
 * A run to compare: a case store, read through its report.json, in which a case folder holding
 * recognition-failed.json is `unrecognized` whatever the gate made of its other pages. A report.json
 * named directly is read as its store; any other report file is read as it is (`store` false).
 * A store recognize.mjs wrote (rerecognition.json) is refused when that run stopped, or when its
 * report is older than its recognitions; when the gate had no case to replay (every page 1
 * refused) and so wrote no report, each of its cases is `unrecognized`.
 * @returns {{ store: boolean, cases: { case: string, outcome: string, fingerings: number }[] }}
 */
export function readRun(path) {
  const isFolder = statSync(path).isDirectory();
  const store = isFolder || basename(path) === 'report.json';
  const folder = isFolder ? path : dirname(path);
  const reportPath = isFolder ? join(path, 'report.json') : path;
  const cases = new Map();
  const unrecognized = (name) =>
    cases.set(name, { case: name, outcome: 'unrecognized', fingerings: 0 });
  const recognized = store ? readJson(join(folder, 'rerecognition.json')) : undefined;
  if (recognized?.aborted)
    throw new Error(
      `The re-recognition into ${folder} stopped (${recognized.aborted}): run recognize.mjs again.`,
    );
  const names = store
    ? readdirSync(folder).filter((name) => {
        try {
          return statSync(join(folder, name)).isDirectory() && !name.startsWith('.');
        } catch {
          return false;
        }
      })
    : [];
  if (!existsSync(reportPath)) {
    const replayable = names.some(
      (name) =>
        readdirSync(join(folder, name)).some((file) => IMAGE.test(file)) &&
        existsSync(join(folder, name, 'page-1-recognized.musicxml')),
    );
    if (!recognized || replayable)
      throw new Error(`No report at ${reportPath}: run the gate on it first.`);
    for (const c of recognized.cases ?? []) unrecognized(String(c.case));
  } else {
    const report = readReport(reportPath);
    const recognizedAt = Date.parse(recognized?.finishedAt ?? recognized?.ranAt);
    if (recognized && !(Date.parse(report.ranAt) >= recognizedAt))
      throw new Error(
        `The report at ${reportPath} is older than the recognitions beside it: run the gate on ${folder} again.`,
      );
    for (const c of report.cases ?? [])
      cases.set(String(c.case), {
        case: String(c.case),
        outcome: String(c.outcome),
        fingerings: Number(c.fingerings) || 0,
      });
  }
  for (const name of names)
    if (existsSync(join(folder, name, 'recognition-failed.json'))) unrecognized(name);
  return { store, cases: [...cases.values()] };
}

/**
 * One row per case in either run, by name: its outcome and fingerings before and after, and the
 * change: better or worse by outcome, same, or new for a case only the second run has. A case
 * the second run lost is worse.
 */
export function compareRuns(before, after) {
  const byName = (run) => new Map((run?.cases ?? []).map((c) => [String(c.case), c]));
  const a = byName(before);
  const b = byName(after);
  return [...new Set([...a.keys(), ...b.keys()])].sort().map((name) => {
    const was = a.get(name);
    const is = b.get(name);
    const rank = (c) => RANK[c.outcome] ?? -1;
    const change = !was
      ? 'new'
      : !is || rank(is) < rank(was)
        ? 'worse'
        : rank(is) > rank(was)
          ? 'better'
          : 'same';
    const side = (c) => c && { outcome: c.outcome, fingerings: Number(c.fingerings) || 0 };
    return { case: name, before: side(was), after: side(is), change };
  });
}

/** The comparison as a Markdown table and a count of each change. */
export function formatComparison(rows) {
  const cell = (side) => (side ? `${side.outcome} | ${side.fingerings}` : 'absent | ');
  const count = (change) => rows.filter((r) => r.change === change).length;
  return [
    '| Case | Before | Fingerings | After | Fingerings | Change |',
    '| --- | --- | ---: | --- | ---: | --- |',
    ...rows.map((r) => `| ${r.case} | ${cell(r.before)} | ${cell(r.after)} | ${r.change} |`),
    '',
    `${rows.length} cases: ${count('better')} better, ${count('worse')} worse, ${count('same')} same, ${count('new')} new.`,
  ].join('\n');
}

export function main(args = process.argv.slice(2)) {
  const store = process.env.DIGITUS2_SCAN_CASES;
  if (args[0] === '--against') {
    const [before, after = store] = args.slice(1);
    if (!before || !after) {
      console.error('Name the run to compare against, and the new run or DIGITUS2_SCAN_CASES.');
      return 2;
    }
    let rows;
    try {
      for (const path of [before, after])
        if (!existsSync(path)) throw new Error(`Nothing at ${path}.`);
      const runs = [readRun(before), readRun(after)];
      if (runs[0].store !== runs[1].store)
        throw new Error(
          `Compare two case stores (or their report.json), or two other report files: ${runs[0].store ? after : before} is read without the refused pages a store adds.`,
        );
      rows = compareRuns(...runs);
    } catch (error) {
      console.error(error.message);
      return 2;
    }
    console.log(formatComparison(rows));
    return rows.some((r) => r.change === 'worse') ? 1 : 0;
  }
  if (args[0] === '--diff') {
    let [a, b] = args.slice(1);
    if (!a || !b) {
      if (!store) {
        console.error('Name two report.json files, or set DIGITUS2_SCAN_CASES.');
        return 2;
      }
      a = join(store, 'report-previous.json');
      b = join(store, 'report.json');
    }
    for (const path of [a, b])
      if (!existsSync(path)) {
        console.error(`No report at ${path}.`);
        return 2;
      }
    console.log(formatDiff(diffReports(readReport(a), readReport(b))));
    return 0;
  }
  if (!store) {
    console.error('Set DIGITUS2_SCAN_CASES to the folder of the scan cases (docs/scanning.md).');
    return 2;
  }
  const path = join(store, 'report.md');
  if (!existsSync(path)) {
    console.error(`No report at ${path}: run pnpm verify scan:cases first.`);
    return 2;
  }
  process.stdout.write(readFileSync(path, 'utf8'));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main();
