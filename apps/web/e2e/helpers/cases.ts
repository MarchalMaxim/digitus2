import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The scan validation cases (issue 233, docs/scanning.md "Validation cases"): one folder per scan,
 * holding `page-N.jpg` (or `.png`) and `page-N-recognized.musicxml` for N = 1..k, and optionally
 * the `scan.json` of the app's "Download everything" archive. A page the scanner refused has no
 * MusicXML: `recognition-failed.json` keeps the service's answer for it. `expect.json` holds what
 * the pages show (bars, staves, key, time). The cases live in the folder that DIGITUS2_SCAN_CASES
 * names, outside the repository: the photos are the owner's.
 */

/** The service's answer to a page it refused, as `recognition-failed.json` keeps it. */
export interface CaseRefusal {
  /** 422 (not recognised) or 504 (timed out), as the scan service answers. */
  status: number;
  /** The body the service answered with, `{ state, failure: { code, message } }`. */
  answer: unknown;
}

export interface CasePage {
  /** The file name the reader's photo had (scan.json), else `page-N.jpg`. */
  name: string;
  mimeType: string;
  buffer: Buffer;
  /** What the scanner read on this page; none when it refused the page. */
  xml?: string;
  /** The scanner's refusal of this page, answered again as it was. */
  refused?: CaseRefusal;
  /**
   * What the scanner answered beside the notation: the recognizer and the warnings, as scan.json
   * kept them, else the page's `page-N-recognition.json` as the scan service kept it, whole. The
   * warnings stay as written (strings in scan.json, `{ code, message }` from the service), so the
   * app maps them as it maps the live service's.
   */
  answer: { recognizer?: string; warnings: unknown[] } & Record<string, unknown>;
}

export interface ScanCase {
  name: string;
  dir: string;
  pages: CasePage[];
  /** What the pages show, from `expect.json`, or null without one. */
  expect: CaseExpect | null;
  /** Why `expect.json` is there but cannot be read: the case cannot be measured against it. */
  expectProblem?: string;
}

/** What one page shows, read off the page itself. */
export interface ExpectedPage {
  bars: number | null;
  staves: number | null;
  fifths: number | null;
  /** "3/4"; null where the page prints no time signature. */
  time: string | null;
  /** Whether the photo cuts part of the page off, so fewer bars are expected to be read. */
  cutOff?: boolean;
}

/** `expect.json`, one page or several, as one shape. */
export interface CaseExpect {
  pages: ExpectedPage[];
}

const IMAGE = /^page-(\d+)\.(jpe?g|png)$/i;
const TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

/** The page image of page `n` in a case folder, or undefined. */
function pageImage(dir: string, n: number): string | undefined {
  return readdirSync(dir).find((file) => Number(IMAGE.exec(file)?.[1]) === n);
}

/** The pages `recognition-failed.json` records as refused, by page number. */
function refusals(dir: string): Map<number, CaseRefusal> {
  const refused = new Map<number, CaseRefusal>();
  const pages = readObject(join(dir, 'recognition-failed.json'))?.pages;
  for (const entry of Array.isArray(pages) ? (pages as unknown[]) : []) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { page, status, answer } = entry as Record<string, unknown>;
    if (Number.isInteger(page) && Number.isInteger(status))
      refused.set(page as number, { status: status as number, answer: answer ?? {} });
  }
  return refused;
}

/** Whether page `n` has what the replay answers with: its recognition, or its refusal. */
function answered(dir: string, n: number, refused: Map<number, CaseRefusal>): boolean {
  return existsSync(join(dir, `page-${n}-recognized.musicxml`)) || refused.has(n);
}

/** Whether a folder is a case: page 1 has its photo and its recognition or its refusal. */
export function isCase(dir: string): boolean {
  try {
    return (
      statSync(dir).isDirectory() &&
      pageImage(dir, 1) !== undefined &&
      answered(dir, 1, refusals(dir))
    );
  } catch {
    return false;
  }
}

/** The case folders in `root`, by name; none when `root` is unset or is not a folder. */
export function caseFolders(root: string | undefined): string[] {
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root)
    .filter((name) => !name.startsWith('.') && isCase(join(root, name)))
    .sort();
}

interface Summary {
  recognizer?: unknown;
  pages?: { name?: unknown; type?: unknown; recognizer?: unknown; warnings?: unknown }[];
}

/** A JSON object from a case folder, or undefined when it is missing or is not an object. */
function readObject(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A count or a key from `expect.json`, or null. */
const numberOr = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * `expect.json` as one shape: a photo's `{ photo, bars, staves, fifths, time, cutOff? }` is one
 * page, `{ pages: [...] }` several; a missing fact is null, and an entry that is no page is a page
 * of which nothing is known, so the pages after it keep their places. Null without a usable file.
 */
export function normalizeExpect(value: unknown): CaseExpect | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const listed = Array.isArray(record.pages) ? (record.pages as unknown[]) : [record];
  const pages = listed.map((entry): ExpectedPage => {
    const page =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    return {
      bars: numberOr(page.bars),
      staves: numberOr(page.staves),
      fifths: numberOr(page.fifths),
      time: typeof page.time === 'string' && page.time ? page.time : null,
      ...(page.cutOff === true && { cutOff: true }),
    };
  });
  return pages.length ? { pages } : null;
}

/**
 * A case's `expect.json`: none without the file; a problem when the file is there but is not JSON
 * or holds no page, so the case is not silently measured against nothing.
 */
function readExpect(dir: string): { expect: CaseExpect | null; expectProblem?: string } {
  const path = join(dir, 'expect.json');
  if (!existsSync(path)) return { expect: null };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      expect: null,
      expectProblem: `expect.json is not JSON (${String(error).split('\n')[0]})`,
    };
  }
  const expect = normalizeExpect(value);
  return expect ? { expect } : { expect: null, expectProblem: 'expect.json holds no page' };
}

/**
 * A case folder's pages, in page order: from page 1 up to the first page that is missing. A page
 * is there when it has its photo and either its recognition or a refusal in
 * `recognition-failed.json`.
 */
export function readCase(root: string, name: string): ScanCase {
  const dir = join(root, name);
  // Without scan.json (a scan the service kept), the photos keep their case names.
  const summary: Summary = readObject(join(dir, 'scan.json')) ?? {};
  const refused = refusals(dir);
  const pages: CasePage[] = [];
  for (let n = 1; ; n++) {
    const image = pageImage(dir, n);
    const recognized = join(dir, `page-${n}-recognized.musicxml`);
    if (!image || !answered(dir, n, refused)) break;
    const kept = Array.isArray(summary.pages) ? summary.pages[n - 1] : undefined;
    const extension = IMAGE.exec(image)![2]!.toLowerCase();
    const recognizer = [kept?.recognizer, summary.recognizer].find(
      (r): r is string => typeof r === 'string' && r !== '',
    );
    const record = kept ? undefined : readObject(join(dir, `page-${n}-recognition.json`));
    const page: CasePage = {
      name: typeof kept?.name === 'string' && kept.name ? kept.name : image,
      mimeType: typeof kept?.type === 'string' && kept.type ? kept.type : TYPES[extension]!,
      buffer: readFileSync(join(dir, image)),
      answer: record
        ? { ...record, warnings: Array.isArray(record.warnings) ? record.warnings : [] }
        : {
            ...(recognizer && { recognizer }),
            warnings: Array.isArray(kept?.warnings) ? kept.warnings : [],
          },
    };
    // A page with its recognition is answered with it, as the service answered it then.
    if (existsSync(recognized)) page.xml = readFileSync(recognized, 'utf8');
    else page.refused = refused.get(n)!;
    pages.push(page);
  }
  return { name, dir, pages, ...readExpect(dir) };
}

/** What a recognition says about its page, as `report.json` keeps it per page. */
export interface PageReading {
  /** Measures of the first part. */
  bars: number | null;
  /** `<staves>` of the first part, else the number of parts. */
  staves: number | null;
  /** The parts the page was read as; null for a page the scanner refused. */
  parts: number | null;
  /**
   * Whether the page was read as two parts of one staff each with as many measures: the pair the
   * app joins into one grand staff (join.ts). Only then do two parts read the page's two staves.
   */
  joins: boolean;
  /**
   * The key's `<fifths>` in the first part's opening `<attributes>`: those of its first measure,
   * which homr writes as two elements (divisions and staves, then clefs, key and time).
   */
  fifths: number | null;
  /** "beats/beat-type" of the same opening `<attributes>`. */
  time: string | null;
  /** Set when the scanner refused the page: it has no recognition. */
  refused?: { status: number };
}

const integerIn = (pattern: RegExp, text: string | undefined) => {
  const match = text === undefined ? null : pattern.exec(text);
  return match ? Number(match[1]) : null;
};

/** The bars, staves, key and time a MusicXML recognition reads, from its text. */
export function readingOf(xml: string): PageReading {
  // `<part id=…>` and not `<part-list>` or `<part-name>`; the first part is the main one.
  const parts = [...xml.matchAll(/<part\s[^>]*>([\s\S]*?)<\/part>/g)].map((m) => m[1]!);
  const first = parts[0];
  // `<measure …>` and not `<measure-style>` or `<measure-numbering>`.
  const measures = (part: string) => (part.match(/<measure[\s>/]/g) ?? []).length;
  const stavesOf = (part: string | undefined) => integerIn(/<staves>\s*(\d+)\s*<\/staves>/, part);
  const bars = first === undefined ? null : measures(first);
  const staves = stavesOf(first) ?? (parts.length || null);
  const joins =
    parts.length === 2 &&
    parts.every((part) => (stavesOf(part) ?? 1) === 1) &&
    measures(parts[0]!) > 0 &&
    measures(parts[0]!) === measures(parts[1]!);
  const opening = /<measure(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/measure>)/.exec(first ?? '')?.[1];
  const attributes = [...(opening ?? '').matchAll(/<attributes\b[^>]*>([\s\S]*?)<\/attributes>/g)]
    .map((m) => m[1]!)
    .join('');
  const fifths = integerIn(/<fifths>\s*(-?\d+)\s*<\/fifths>/, attributes);
  const beats = /<beats>\s*([^<\s]+)\s*<\/beats>/.exec(attributes ?? '')?.[1];
  const beatType = /<beat-type>\s*([^<\s]+)\s*<\/beat-type>/.exec(attributes ?? '')?.[1];
  return {
    bars,
    staves,
    fifths,
    time: beats && beatType ? `${beats}/${beatType}` : null,
    parts: parts.length,
    joins,
  };
}

/** Each page of a case as the replay answers it: what its recognition reads, or its refusal. */
export function readingsOf(scan: ScanCase): PageReading[] {
  return scan.pages.map((page) =>
    page.xml !== undefined
      ? readingOf(page.xml)
      : {
          bars: null,
          staves: null,
          fifths: null,
          time: null,
          parts: null,
          joins: false,
          refused: { status: page.refused!.status },
        },
  );
}

/**
 * How many pages read each fact as the page shows it, of the pages `expect.json` lists. A fact
 * the truth leaves out (null) agrees on every page, read or refused: an unknown never counts
 * against a run. For time, null is a page that prints no time signature.
 */
export interface CaseAgreement {
  bars: number;
  staves: number;
  fifths: number;
  time: number;
  of: number;
}

/**
 * Whether a reading has the page's staves: one part with them (as acceptance.mjs counts staves),
 * or for a page of two staves the pair of one-staff parts the app joins into a grand staff. Piano
 * and Voice, or two grand-staff halves, read two staves in the first part but not the page's.
 */
function hasStaves(read: PageReading, staves: number): boolean {
  if (read.parts === 1) return read.staves === staves;
  return staves === 2 && read.joins;
}

/**
 * The pages whose reading equals what `expect` says, fact by fact, page by page in order. A page
 * the case lacks or the scanner refused agrees only on the facts the truth leaves out.
 */
export function agreementOf(
  readings: readonly PageReading[],
  expect: CaseExpect | null,
): CaseAgreement | null {
  if (!expect) return null;
  const agree: CaseAgreement = { bars: 0, staves: 0, fifths: 0, time: 0, of: expect.pages.length };
  expect.pages.forEach((wanted, index) => {
    const found = readings[index];
    const read = found && !found.refused ? found : undefined;
    if (wanted.bars === null || read?.bars === wanted.bars) agree.bars++;
    if (wanted.staves === null || (read && hasStaves(read, wanted.staves))) agree.staves++;
    if (wanted.fifths === null || read?.fifths === wanted.fifths) agree.fifths++;
    if (wanted.time === null || read?.time === wanted.time) agree.time++;
  });
  return agree;
}

/** The numbers of the pages the scanner refused, from 1. */
export function refusedPagesOf(scan: ScanCase): number[] {
  return scan.pages.flatMap((page, index) => (page.refused ? [index + 1] : []));
}

/** What a row says of the case's pages: their readings, what they show, and how far they agree. */
export function caseFacts(
  scan: ScanCase,
): Pick<CaseResult, 'pages' | 'expect' | 'agree' | 'refusedPages'> {
  const pages = readingsOf(scan);
  return {
    pages,
    expect: scan.expect,
    agree: agreementOf(pages, scan.expect),
    refusedPages: refusedPagesOf(scan),
  };
}

/** A place to check, as the list shows it. */
export interface CasePlace {
  /** What the place says, "Bar 7: …". */
  text: string;
  /** Whether its note can be selected. */
  select: boolean;
  /** Whether a correction is offered beside it (remove a mark, set the meter). */
  offer: boolean;
}

/** What the review showed for one case, read off the screen once it settled. */
export interface CaseScreen {
  /** Whether the review settled (the notation drawn or an alert, and nothing still checking). */
  settled: boolean;
  verdict: string;
  /** Whether the verdict is said as an alert: it stops the reader (pages that did not join). */
  blocking: boolean;
  /** The alerts other than the verdict line. */
  alerts: string[];
  /**
   * The line under the photo of a page the scanner did not read, "Page 2: …": a scan with such a
   * page stays on its start screen, with "Needs retry" under that page.
   */
  pageErrors: string[];
  /** The "Technical reason" lines under Recognition details. */
  technical: string[];
  places: CasePlace[];
  /** Whether Use for fingerings could be pressed. */
  usable: boolean;
  /** Whether a page can be photographed again ("Replace page 2 with a new photo"). */
  retake: boolean;
  /** Whether Fix all is on screen. */
  fixAll: boolean;
  /** Whether "Show bar N" under the alert selects the first note of the bar the import refused. */
  showBar: boolean;
}

/**
 * A fix the refusal leads to: the photo of the page it names to take again, a correction offered
 * at the bar it names, Fix all beside such a correction, or the note at that bar.
 */
export type Fix = 'retake' | 'offer' | 'fix-all' | 'select';

export type Outcome = 'usable' | 'explained' | 'failed';

/** "Page 2", "pages 2 and 3", "Bar 12", "Bars 3–5": a refusal names where the problem is. */
const NAMES = /\b(?:pages?|bars?) \d+/i;
/** The bars a text names, "Bar 12" or "Bars 3–5", by their printed numbers. */
const BARS = /\bbars? (\d+)(?:\s*[–-]\s*(\d+))?/gi;

function barsOf(text: string): Set<string> {
  const bars = new Set<string>();
  for (const [, from, to] of text.matchAll(BARS)) {
    bars.add(from!);
    for (let bar = Number(from) + 1; to && bar <= Number(to); bar++) bars.add(String(bar));
  }
  return bars;
}

/**
 * What says Use for fingerings is refused: the verdict when it is said as an alert, and the alerts
 * under it. The verdict's counts ("2 pages · 41 bars") and the places to check do not say it.
 */
function refusalOf(screen: CaseScreen): { verdict?: string; alerts: string[] } {
  return {
    ...(screen.blocking && screen.verdict && { verdict: screen.verdict }),
    alerts: screen.alerts,
  };
}

/**
 * Where the refusal names the page or the bar: its verdict, its alert, the line under a page the
 * scanner did not read, or the button that photographs the page again (which names it, or in a
 * scan of one page is about "it"). A place to check alone never names a refusal, and a technical
 * line never does.
 */
export function namedAt(screen: CaseScreen, pages: number): string | undefined {
  const names = (text: string) => NAMES.test(text) || (pages === 1 && /\bthe page\b/i.test(text));
  const { verdict, alerts } = refusalOf(screen);
  if (verdict && names(verdict)) return 'verdict';
  if (alerts.some(names)) return 'alert';
  if (screen.pageErrors.some(names)) return 'page line';
  if (screen.retake) return 'retake button';
  return undefined;
}

/** A sentence that asks for a page to be photographed again, in the review's own words. */
const RETAKE_ASKED =
  /\b(?:photograph (?:it|them) again|replace (?:that|those) photos?|replace the page)\b/i;

/**
 * Whether the review asks for a page to be photographed again: a retake button is on screen, or
 * the verdict or an alert says to.
 */
export function retakeAsked(screen: Pick<CaseScreen, 'retake' | 'verdict' | 'alerts'>): boolean {
  return screen.retake || [screen.verdict, ...screen.alerts].some((t) => RETAKE_ASKED.test(t));
}

/**
 * The fixes the refusal leads to: the retake, and at every bar the refusal names, its places' notes
 * and offers (Fix all counts beside one of those offers). A place at another bar is not a fix
 * of this refusal.
 */
export function fixesOf(screen: CaseScreen): Fix[] {
  const { verdict, alerts } = refusalOf(screen);
  const named = barsOf([verdict ?? '', ...alerts].join(' '));
  const places = screen.places.filter((place) => [...barsOf(place.text)].some((b) => named.has(b)));
  const fixes: Fix[] = [];
  if (screen.retake) fixes.push('retake');
  if (places.some((place) => place.offer)) {
    fixes.push('offer');
    if (screen.fixAll) fixes.push('fix-all');
  }
  if (screen.showBar || places.some((place) => place.select)) fixes.push('select');
  return fixes;
}

/**
 * The case's outcome: usable when Use for fingerings opens a score with fingerings; explained when
 * Use is refused and the refusal itself names the page or bar and leads to a fix there; else
 * failed. A page the scanner refused is judged the same way, by what the app shows for it; the
 * reason starts with that refusal.
 */
export function decide(
  screen: CaseScreen,
  fingerings: number,
  pages: number,
  refused: readonly PageReading[] = [],
  expectProblem?: string,
): { outcome: Outcome; why: string; fixes: Fix[] } {
  const judged = judge(screen, fingerings, pages);
  // A truth that cannot be read fails the case: its bars, staves, key and time go unmeasured.
  const decided = expectProblem
    ? { ...judged, outcome: 'failed' as const, why: `${expectProblem}; ${judged.why}` }
    : judged;
  const scanner = refused.flatMap((reading, index) =>
    reading.refused ? [`page ${index + 1} (${reading.refused.status})`] : [],
  );
  if (!scanner.length) return decided;
  return { ...decided, why: `the scanner refused ${scanner.join(', ')}; ${decided.why}` };
}

function judge(
  screen: CaseScreen,
  fingerings: number,
  pages: number,
): { outcome: Outcome; why: string; fixes: Fix[] } {
  if (!screen.settled)
    return { outcome: 'failed', why: 'the review did not settle in 90 s', fixes: [] };
  if (screen.usable)
    return fingerings > 0
      ? { outcome: 'usable', why: 'Use for fingerings drew fingerings', fixes: [] }
      : { outcome: 'failed', why: 'Use for fingerings drew no fingerings', fixes: [] };
  const { verdict, alerts } = refusalOf(screen);
  if (!verdict && !alerts.length)
    return { outcome: 'failed', why: 'refused; nothing on screen says why', fixes: [] };
  const at = namedAt(screen, pages);
  if (!at)
    return {
      outcome: 'failed',
      why: screen.technical.length
        ? 'refused; only a Technical reason says where'
        : 'refused; no page or bar is named',
      fixes: [],
    };
  const fixes = fixesOf(screen);
  if (!fixes.length)
    return { outcome: 'failed', why: `refused; named in the ${at}, no fix there`, fixes };
  return {
    outcome: 'explained',
    why: `refused; named in the ${at}; fix: ${fixes.join(', ')}`,
    fixes,
  };
}

/** One row of report.json: what the review showed, and what the pages read against what they show. */
export interface CaseResult {
  case: string;
  /** Per page, in order: what the recognition the case replays reads, or the scanner's refusal. */
  pages: PageReading[];
  outcome: Outcome;
  why: string;
  verdict: string;
  alerts: string[];
  technical: string[];
  places: number;
  fixes: Fix[];
  fingerings: number;
  seconds: number;
  /** `expect.json`, normalised to pages; null without one. */
  expect: CaseExpect | null;
  /** How many pages read each fact as expected; null without `expect.json`. */
  agree: CaseAgreement | null;
  /** Whether the review asks for a page to be photographed again (`retakeAsked`). */
  retake: boolean;
  /** The pages the scanner refused, from 1. */
  refusedPages: number[];
}

export interface CasesReport {
  /** When the run ended, ISO. */
  ranAt: string;
  cases: CaseResult[];
}

const ORDER: Record<Outcome, number> = { explained: 0, failed: 1, usable: 2 };
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || ' ';

/**
 * The bars each page read, against what the page shows where `expect.json` gives its bars, in the
 * notation of report.mjs: "19/19, refused/24, 20/24"; "absent" for a page the case lacks, "?" for
 * bars not read; "19, 24" without a truth.
 */
export function barsCell(row: Pick<CaseResult, 'pages' | 'expect'>): string {
  const count = Math.max(row.pages.length, row.expect?.pages.length ?? 0);
  return Array.from({ length: count }, (_, index) => {
    const read = row.pages[index];
    const shown = !read ? 'absent' : read.refused ? 'refused' : String(read.bars ?? '?');
    const wanted = row.expect?.pages[index]?.bars;
    return typeof wanted === 'number' ? `${shown}/${wanted}` : shown;
  }).join(', ');
}

/** report.md: the explained cases first (the work list), then the failed, then the usable. */
export function reportMarkdown(report: CasesReport): string {
  const count = (o: Outcome) => report.cases.filter((c) => c.outcome === o).length;
  const rows = [...report.cases]
    .sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome] || a.case.localeCompare(b.case))
    .map(
      (c) =>
        `| ${cell(c.case)} | ${c.outcome} | ${cell(barsCell(c))} | ${c.retake ? 'retake' : ' '} | ${cell(c.why)} | ${cell(c.verdict)} | ${cell(c.alerts.join(' / '))} | ${c.places} | ${c.fingerings} | ${c.seconds.toFixed(1)} |`,
    );
  return [
    '# Scan validation cases',
    '',
    `Run ${report.ranAt}: ${report.cases.length} cases, ${count('usable')} usable, ${count('explained')} explained, ${count('failed')} failed.`,
    '',
    'Bars: per page, the bars read over the bars the page shows (`expect.json`); refused: the scanner refused the page; absent: the case has no such page. Retake: the review asks for a page to be photographed again.',
    '',
    '| Case | Outcome | Bars | Retake | Why | Verdict | Alert | Places | Fingerings | Seconds |',
    '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |',
    ...rows,
    '',
  ].join('\n');
}
