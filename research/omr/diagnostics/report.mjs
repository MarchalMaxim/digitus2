// The scan validation gate's report (issue 233, docs/scanning.md "Validation cases").
//
//   node research/omr/diagnostics/report.mjs                  print report.md of the last run
//   node research/omr/diagnostics/report.mjs --diff           the last run against the one before
//   node research/omr/diagnostics/report.mjs --diff <a> <b>   two report.json files, a before b
//
// apps/web/e2e/scan-cases.spec.ts writes report.json and report.md into DIGITUS2_SCAN_CASES and
// keeps the run before as report-previous.json.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
    .map((c) => `${c.case}: ${c.before ?? 'absent'} -> ${c.after ?? 'absent'}${c.why ? ` (${c.why})` : ''}`)
    .join('\n');
}

function readReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function main(args = process.argv.slice(2)) {
  const store = process.env.DIGITUS2_SCAN_CASES;
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
