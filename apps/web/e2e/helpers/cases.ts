import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The scan validation cases (issue 233, docs/scanning.md "Validation cases"): one folder per scan,
 * holding `page-N.jpg` (or `.png`) and `page-N-recognized.musicxml` for N = 1..k, and optionally
 * the `scan.json` of the app's "Download everything" archive. They live in the folder that
 * DIGITUS2_SCAN_CASES names, outside the repository: the photos are the owner's.
 */

export interface CasePage {
  /** The file name the reader's photo had (scan.json), else `page-N.jpg`. */
  name: string;
  mimeType: string;
  buffer: Buffer;
  /** What the scanner read on this page. */
  xml: string;
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
}

const IMAGE = /^page-(\d+)\.(jpe?g|png)$/i;
const TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

/** The page image of page `n` in a case folder, or undefined. */
function pageImage(dir: string, n: number): string | undefined {
  return readdirSync(dir).find((file) => Number(IMAGE.exec(file)?.[1]) === n);
}

/** Whether a folder is a case: page 1 has its photo and its recognition. */
export function isCase(dir: string): boolean {
  try {
    return (
      statSync(dir).isDirectory() &&
      pageImage(dir, 1) !== undefined &&
      existsSync(join(dir, 'page-1-recognized.musicxml'))
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

/** A case folder's pages, in page order: from page 1 up to the first page that is missing. */
export function readCase(root: string, name: string): ScanCase {
  const dir = join(root, name);
  // Without scan.json (a scan the service kept), the photos keep their case names.
  const summary: Summary = readObject(join(dir, 'scan.json')) ?? {};
  const pages: CasePage[] = [];
  for (let n = 1; ; n++) {
    const image = pageImage(dir, n);
    const recognized = join(dir, `page-${n}-recognized.musicxml`);
    if (!image || !existsSync(recognized)) break;
    const kept = Array.isArray(summary.pages) ? summary.pages[n - 1] : undefined;
    const extension = IMAGE.exec(image)![2]!.toLowerCase();
    const recognizer = [kept?.recognizer, summary.recognizer].find(
      (r): r is string => typeof r === 'string' && r !== '',
    );
    const record = kept ? undefined : readObject(join(dir, `page-${n}-recognition.json`));
    pages.push({
      name: typeof kept?.name === 'string' && kept.name ? kept.name : image,
      mimeType: typeof kept?.type === 'string' && kept.type ? kept.type : TYPES[extension]!,
      buffer: readFileSync(join(dir, image)),
      xml: readFileSync(recognized, 'utf8'),
      answer: record
        ? { ...record, warnings: Array.isArray(record.warnings) ? record.warnings : [] }
        : {
            ...(recognizer && { recognizer }),
            warnings: Array.isArray(kept?.warnings) ? kept.warnings : [],
          },
    });
  }
  return { name, dir, pages };
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
 * Where the refusal names the page or the bar: its verdict, its alert, or the button that
 * photographs the page again (which names it, or in a scan of one page is about "it"). A place to
 * check alone never names a refusal, and a technical line never does.
 */
export function namedAt(screen: CaseScreen, pages: number): string | undefined {
  const names = (text: string) => NAMES.test(text) || (pages === 1 && /\bthe page\b/i.test(text));
  const { verdict, alerts } = refusalOf(screen);
  if (verdict && names(verdict)) return 'verdict';
  if (alerts.some(names)) return 'alert';
  if (screen.retake) return 'retake button';
  return undefined;
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
 * failed.
 */
export function decide(
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

export interface CaseResult {
  case: string;
  pages: number;
  outcome: Outcome;
  why: string;
  verdict: string;
  alerts: string[];
  technical: string[];
  places: number;
  fixes: Fix[];
  fingerings: number;
  seconds: number;
}

export interface CasesReport {
  /** When the run ended, ISO. */
  ranAt: string;
  cases: CaseResult[];
}

const ORDER: Record<Outcome, number> = { explained: 0, failed: 1, usable: 2 };
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || ' ';

/** report.md: the explained cases first (the work list), then the failed, then the usable. */
export function reportMarkdown(report: CasesReport): string {
  const count = (o: Outcome) => report.cases.filter((c) => c.outcome === o).length;
  const rows = [...report.cases]
    .sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome] || a.case.localeCompare(b.case))
    .map(
      (c) =>
        `| ${cell(c.case)} | ${c.outcome} | ${cell(c.why)} | ${cell(c.verdict)} | ${cell(c.alerts.join(' / '))} | ${c.places} | ${c.fingerings} | ${c.seconds.toFixed(1)} |`,
    );
  return [
    '# Scan validation cases',
    '',
    `Run ${report.ranAt}: ${report.cases.length} cases, ${count('usable')} usable, ${count('explained')} explained, ${count('failed')} failed.`,
    '',
    '| Case | Outcome | Why | Verdict | Alert | Places | Fingerings | Seconds |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: |',
    ...rows,
    '',
  ].join('\n');
}
