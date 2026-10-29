// The scan validation gate's report (issue 233, docs/scanning.md "Validation cases").
//
//   node research/omr/diagnostics/report.mjs                  print report.md of the last run
//   node research/omr/diagnostics/report.mjs --diff           the last run against the one before
//   node research/omr/diagnostics/report.mjs --diff <a> <b>   two report.json files, a before b
//   node research/omr/diagnostics/report.mjs --against <before> [<after>]
//        every case of two runs side by side, better, worse or the same, with what moved (the
//        outcome, the bars against expect.json, the key, staves and time, a retake asked, a refusal
//        accepted short or with extra bars); exit 1 when one is worse.
//        Each side is a case store (its report.json, and recognition-failed.json in its cases), or
//        its report.json; <after> defaults to DIGITUS2_SCAN_CASES. Two other report files compare
//        as they are, but not against a store, which is read with its refusals. With
//        recognize.mjs, this gates a scanner change: the gate runs on both stores, then the new
//        one is read against the old. A store whose re-recognition stopped, or whose report is
//        older than its recognitions, is refused, and so are two runs of which one was written by
//        an older gate.
//
// apps/web/e2e/scan-cases.spec.ts writes report.json and report.md into DIGITUS2_SCAN_CASES and
// keeps the run before as report-previous.json.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A row of report.json, as the gate writes it, carries beside its outcome what each page was read
// as (`pages`: bars, staves, fifths, time, parts, or `refused`), the case's truth normalised from
// expect.json (`expect.pages`), how many pages agree with it (`agree`, with `of` pages), whether a
// page is to be photographed again (`retake`) and the pages the scanner refused (`refusedPages`).
// Rows of an older gate have none of these, and `pages` is their page count: they compare on the
// outcome alone.

/** What each page was read as, or null for a row of an older gate. */
const readPages = (row) => (Array.isArray(row?.pages) ? row.pages : null);

/** The bars a page was read as: 0 for a page refused, absent or read without bars. */
const barsRead = (page) => (page && !page.refused && typeof page.bars === 'number' ? page.bars : 0);

/** The bars the truth gives page `i`, or undefined where it does not say. */
const wantedBars = (expect, i) => {
  const bars = expect?.pages?.[i]?.bars;
  return typeof bars === 'number' ? bars : undefined;
};

/** The pages to look at: those read, and those the truth lists. */
const pageCount = (pages, expect) => Math.max(pages.length, expect?.pages?.length ?? 0);

/** `19/19, refused/24, 20/24`, or `30` without a truth. */
function barsText(pages, expect) {
  return Array.from({ length: pageCount(pages, expect) }, (_, i) => {
    const page = pages[i];
    const read = !page ? 'absent' : page.refused ? 'refused' : (page.bars ?? '?');
    const want = wantedBars(expect, i);
    return want === undefined ? String(read) : `${read}/${want}`;
  }).join(', ');
}

/**
 * The bars of a case page by page, each against its truth where it is known: `19/19, refused/24`,
 * or `30` without a truth. Null for a row of an older gate.
 */
export function formatBars(row) {
  const pages = readPages(row);
  return pages ? barsText(pages, row.expect) : null;
}

/**
 * The bars of a whole case: read over expected, summed over the pages whose bars the truth gives
 * (a refused page reads 0), or the bars read without a truth.
 */
function totalBars(pages, expect) {
  let read = 0;
  let want = 0;
  let known = false;
  for (let i = 0; i < pageCount(pages, expect); i++) {
    const expected = wantedBars(expect, i);
    if (expected === undefined) continue;
    known = true;
    want += expected;
    read += barsRead(pages[i]);
  }
  if (known) return `${read}/${want}`;
  return String(pages.reduce((sum, page) => sum + barsRead(page), 0));
}

/**
 * The cases whose outcome changed between two reports, by case name: a case only one report has
 * is listed with `null` on the other side. `bars` is the bars read against the truth where the
 * rows know them: `24/24 -> 9/24`, or the second run's alone.
 * @returns {{ case: string, before: string | null, after: string | null, why: string, bars: string | null }[]}
 */
export function diffReports(before, after) {
  const rows = (report) => new Map((report?.cases ?? []).map((c) => [String(c.case), c]));
  const a = rows(before);
  const b = rows(after);
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  return names
    .filter((name) => a.get(name)?.outcome !== b.get(name)?.outcome)
    .map((name) => {
      const was = formatBars(a.get(name));
      const is = formatBars(b.get(name));
      return {
        case: name,
        before: a.get(name)?.outcome ?? null,
        after: b.get(name)?.outcome ?? null,
        why: b.get(name)?.why ?? '',
        bars: was !== null && is !== null && was !== is ? `${was} -> ${is}` : (is ?? was),
      };
    });
}

/** The diff as lines: `case: explained -> usable, bars 9/24`, or a line saying nothing changed. */
export function formatDiff(changes) {
  if (!changes.length) return 'No case changed outcome.';
  return changes
    .map(
      (c) =>
        `${c.case}: ${c.before ?? 'absent'} -> ${c.after ?? 'absent'}${c.bars ? `, bars ${c.bars}` : ''}${c.why ? ` (${c.why})` : ''}`,
    )
    .join('\n');
}

function readReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * How good an outcome is, for --against: a usable case beats an explained one, which beats a
 * failed replay; a case whose recognition the service refused (recognize.mjs wrote
 * recognition-failed.json) ranks below them all when the gate's row does not list its refused
 * pages, since that gate could not replay it. A row that lists them keeps the gate's outcome.
 */
const RANK = { usable: 3, explained: 2, failed: 1, unrecognized: 0 };

const IMAGE = /^page-1\.(jpe?g|png)$/i;

/** A JSON file, or undefined when there is none. */
function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
}

/** Whether the gate can replay a case folder: page 1 has its photo and its recognition or refusal. */
function replayable(dir) {
  if (!readdirSync(dir).some((file) => IMAGE.test(file))) return false;
  if (existsSync(join(dir, 'page-1-recognized.musicxml'))) return true;
  const failed = readJson(join(dir, 'recognition-failed.json'));
  return (failed?.pages ?? []).some((p) => Number(p?.page) === 1);
}

/**
 * A run to compare: a case store, read through its report.json, in which a case folder holding
 * recognition-failed.json is `unrecognized` when the gate's row does not list its refused pages.
 * A report.json named directly is read as its store; any other report file is read as it is
 * (`store` false). A store recognize.mjs wrote (rerecognition.json) is refused when that run
 * stopped, when its report is older than its recognitions, or when it has no report while the gate
 * could replay a case of it; when no case could be replayed, each is `unrecognized`. `gate` says
 * which gate wrote the rows: 'pages' (the rows carry what each page was read as), 'count' (an
 * older gate) or null without rows.
 * @returns {{ store: boolean, gate: 'pages' | 'count' | null, cases: { case: string, outcome: string, fingerings: number }[] }}
 */
export function readRun(path) {
  const isFolder = statSync(path).isDirectory();
  const store = isFolder || basename(path) === 'report.json';
  const folder = isFolder ? path : dirname(path);
  const reportPath = isFolder ? join(path, 'report.json') : path;
  const cases = new Map();
  let gate = null;
  const unrecognized = (name, refusedPages) =>
    cases.set(name, {
      case: name,
      outcome: 'unrecognized',
      fingerings: 0,
      ...(refusedPages && { refusedPages }),
    });
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
    if (!recognized || names.some((name) => replayable(join(folder, name))))
      throw new Error(`No report at ${reportPath}: run the gate on it first.`);
    for (const c of recognized.cases ?? []) unrecognized(String(c.case));
  } else {
    const report = readReport(reportPath);
    const recognizedAt = Date.parse(recognized?.finishedAt ?? recognized?.ranAt);
    if (recognized && !(Date.parse(report.ranAt) >= recognizedAt))
      throw new Error(
        `The report at ${reportPath} is older than the recognitions beside it: run the gate on ${folder} again.`,
      );
    const rows = report.cases ?? [];
    if (rows.length) gate = rows.some((c) => Array.isArray(c.pages)) ? 'pages' : 'count';
    for (const c of rows) {
      const row = {
        case: String(c.case),
        outcome: String(c.outcome),
        fingerings: Number(c.fingerings) || 0,
      };
      if (Array.isArray(c.pages)) row.pages = c.pages;
      if (c.expect !== undefined) row.expect = c.expect;
      if (c.agree !== undefined) row.agree = c.agree;
      if (typeof c.retake === 'boolean') row.retake = c.retake;
      if (Array.isArray(c.refusedPages)) row.refusedPages = c.refusedPages;
      cases.set(row.case, row);
    }
  }
  // A gate that lists a case's refused pages replayed the case with them; an older gate never saw
  // the case, or only its pages before the refusal.
  for (const name of names) {
    const failed = readJson(join(folder, name, 'recognition-failed.json'));
    if (failed && !cases.get(name)?.refusedPages)
      unrecognized(
        name,
        (failed.pages ?? []).map((p) => Number(p.page)).filter((n) => n > 0),
      );
  }
  return { store, gate, cases: [...cases.values()] };
}

/** The facts of a page that agree with the truth, as the gate counts them, and their names. */
const FACTS = [
  ['staves', 'staves'],
  ['fifths', 'key'],
  ['time', 'time'],
];

/**
 * How the bars moved, page by page against one truth: 'worse' when a page's distance from its
 * truth grew (a page refused or absent reads 0), or, on a page without a truth, when a case usable
 * on both sides reads fewer bars there; 'better' when a page came closer and none moved away;
 * null otherwise. A cut-off page only ever moves away: when it reads more bars over its whole
 * page's, or fewer under them than it read right before (its bars up to the page's, less those it
 * read over). So 28/24 -> 20/24 stays (the 4 over may have stood for 4 under), while 28/24 -> 3/24
 * and 9/11 -> 3/11 are bars lost. Fewer bars on it may be what the photo shows, so they never call
 * a case better.
 */
function barsMove(was, is, truth, bothUsable) {
  let away = false;
  let closer = false;
  for (let i = 0; i < Math.max(pageCount(was, truth), is.length); i++) {
    const before = barsRead(was[i]);
    const after = barsRead(is[i]);
    const want = wantedBars(truth, i);
    if (want === undefined) {
      if (bothUsable && after < before) away = true;
      continue;
    }
    if (truth.pages[i].cutOff) {
      // A cut-off photo shows fewer bars than its page holds: bars over the page's are wrong, and
      // bars under it are lost only beyond what was read over before.
      const excess = (read) => Math.max(0, read - want);
      const under = (read) => Math.min(read, want);
      if (excess(after) > excess(before) || under(after) < under(before) - excess(before))
        away = true;
      continue;
    }
    const d = Math.abs(after - want) - Math.abs(before - want);
    if (d > 0) away = true;
    else if (d < 0) closer = true;
  }
  return away ? 'worse' : closer ? 'better' : null;
}

/**
 * What a case refused before reads now that it is usable, against the truth: short (a page under
 * its bars; a cut-off page only when it reads none, since the photo shows fewer), extra (a page
 * over its bars), or unchecked (a page without a truth).
 */
function acceptance(pages, truth) {
  const found = { short: false, extra: false, unchecked: false };
  for (let i = 0; i < pageCount(pages, truth); i++) {
    const want = wantedBars(truth, i);
    if (want === undefined) {
      found.unchecked = true;
      continue;
    }
    const read = barsRead(pages[i]);
    if (read > want) found.extra = true;
    else if (truth.pages[i].cutOff === true ? read === 0 : read < want) found.short = true;
  }
  return found;
}

/**
 * How a case moved between two runs, and whether that is worse, better or the same. Both runs
 * are read against one truth (the photos are the same): the second run's expect.json, else the
 * first's. Worse: the outcome drops; a page's bars move away from its truth (or, without a truth,
 * a case usable on both sides reads fewer bars); a count of pages agreeing on staves, key or time
 * drops (both rows with the same truth); a retake is asked of a case usable on both sides, or, when
 * every page of the case is cut off in the truth, a retake is dropped, whatever the outcome (that
 * photo is to be taken again; the row does not name the retake's page); or a case refused before (explained, failed or unrecognized) is usable with a page
 * short of its bars ("accepted short") or over them ("accepted with extra bars"). Better: the
 * reverse, with nothing worse, except that the bars of a cut-off page never count better; but a
 * case refused before and usable now with a page no truth checks is at most the same ("usable
 * unchecked"). Each rule judges only rows that carry its fields, so a row of an older gate compares
 * on its outcome.
 */
function judge(was, is) {
  if (!was) return { change: 'new', moved: [] };
  if (!is) return { change: 'worse', moved: ['absent'] };
  const worse = [];
  const better = [];
  const moved = [];
  const rank = (c) => RANK[c.outcome] ?? -1;
  const bothUsable = was.outcome === 'usable' && is.outcome === 'usable';
  if (was.outcome !== is.outcome) moved.push(`${was.outcome} -> ${is.outcome}`);
  if (rank(is) < rank(was)) worse.push('outcome');
  else if (rank(is) > rank(was)) better.push('outcome');
  const sameTruth = JSON.stringify(was.expect ?? null) === JSON.stringify(is.expect ?? null);
  const truth = is.expect ?? was.expect ?? null;
  const agreeing = sameTruth && was.agree && is.agree;
  const counts = (key) => {
    const of = Math.max(was.agree.of ?? 0, is.agree.of ?? 0);
    return of > 1 ? ` (${was.agree[key]}/${was.agree.of} -> ${is.agree[key]}/${is.agree.of})` : '';
  };
  const wasPages = readPages(was);
  const isPages = readPages(is);
  if (wasPages && isPages) {
    const bars = barsMove(wasPages, isPages, truth, bothUsable);
    if (bars) (bars === 'worse' ? worse : better).push('bars');
    const countMoved = agreeing && was.agree.bars !== is.agree.bars;
    const totalWas = totalBars(wasPages, truth);
    const totalIs = totalBars(isPages, truth);
    if (totalWas !== totalIs || countMoved)
      moved.push(`bars ${totalWas} -> ${totalIs}${countMoved ? counts('bars') : ''}`);
    // The totals hide a move between pages: show them page by page.
    else if (bars) moved.push(`bars ${barsText(wasPages, truth)} -> ${barsText(isPages, truth)}`);
  }
  for (const [key, name] of FACTS)
    if (agreeing && was.agree[key] !== is.agree[key]) {
      const lost = is.agree[key] < was.agree[key];
      (lost ? worse : better).push(key);
      moved.push(`${name} ${lost ? 'lost' : 'found'}${counts(key)}`);
    }
  if (Array.isArray(was.refusedPages) && Array.isArray(is.refusedPages)) {
    for (const page of is.refusedPages)
      if (!was.refusedPages.includes(page)) moved.push(`page ${page} refused`);
    for (const page of was.refusedPages)
      if (!is.refusedPages.includes(page)) moved.push(`page ${page} read`);
  }
  if (wasPages && isPages && !sameTruth)
    moved.push(
      !was.expect ? 'truth after only' : !is.expect ? 'truth before only' : 'truth changed',
    );
  if (
    typeof was.retake === 'boolean' &&
    typeof is.retake === 'boolean' &&
    was.retake !== is.retake
  ) {
    // A photo that does not show the whole page is to be taken again: asking for that is right.
    // The row does not say which page the retake names, so this holds only when every page the
    // case reads is cut off; otherwise the retake may name a page that reads right.
    const listed = truth?.pages ?? [];
    const cutOff =
      listed.length > 0 &&
      listed.every((page) => page?.cutOff === true) &&
      Math.max(wasPages?.length ?? 0, isPages?.length ?? 0) <= listed.length;
    if (cutOff) {
      moved.push(`retake ${is.retake ? 'asked' : 'dropped'} on a cut-off page`);
      (is.retake ? better : worse).push('retake');
    } else {
      moved.push(is.retake ? 'retake asked' : 'retake dropped');
      if (bothUsable) (is.retake ? worse : better).push('retake');
    }
  }
  let unchecked = false;
  if (rank(was) < RANK.usable && is.outcome === 'usable' && isPages) {
    const found = acceptance(isPages, truth);
    for (const [kind, name] of [
      ['short', 'accepted short'],
      ['extra', 'accepted with extra bars'],
    ])
      if (found[kind]) {
        worse.push(name);
        moved.push(name);
      }
    if (found.unchecked && !found.short && !found.extra) {
      unchecked = true;
      moved.push('usable unchecked');
    }
  }
  const change = worse.length ? 'worse' : !unchecked && better.length ? 'better' : 'same';
  return { change, moved };
}

/**
 * One row per case in either run, by name: its outcome and fingerings before and after, the change
 * (better, worse, same, or new for a case only the second run has; a case the second run lost is
 * worse) and what moved: `bars 24/24 -> 9/24, key lost, retake asked`.
 */
export function compareRuns(before, after) {
  const byName = (run) => new Map((run?.cases ?? []).map((c) => [String(c.case), c]));
  const a = byName(before);
  const b = byName(after);
  return [...new Set([...a.keys(), ...b.keys()])].sort().map((name) => {
    const was = a.get(name);
    const is = b.get(name);
    const { change, moved } = judge(was, is);
    const side = (c) => c && { outcome: c.outcome, fingerings: Number(c.fingerings) || 0 };
    return { case: name, before: side(was), after: side(is), change, moved: moved.join(', ') };
  });
}

/** The comparison as a Markdown table and a count of each change. */
export function formatComparison(rows) {
  const cell = (side) => (side ? `${side.outcome} | ${side.fingerings}` : 'absent | ');
  const count = (change) => rows.filter((r) => r.change === change).length;
  return [
    '| Case | Before | Fingerings | After | Fingerings | Change | Moved |',
    '| --- | --- | ---: | --- | ---: | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.case} | ${cell(r.before)} | ${cell(r.after)} | ${r.change} | ${r.moved ?? ''} |`,
    ),
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
      // An older gate's rows carry no pages and rank a refused page below any replay: against
      // rows that do, cases would move that did not.
      if (runs[0].gate && runs[1].gate && runs[0].gate !== runs[1].gate) {
        const older = runs[0].gate === 'count' ? before : after;
        throw new Error(
          `${older} was written by an older gate, whose rows do not say what each page read: run the gate on ${older} again.`,
        );
      }
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
  // report.md carries the bars of each page against the truth itself.
  process.stdout.write(readFileSync(path, 'utf8'));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main();
