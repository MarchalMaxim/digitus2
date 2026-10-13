// THROWAWAY spike: measurement helpers shared by all pages.
import shortUrl from '../../fixtures/short-piano.musicxml?url';
import longUrl from '../../fixtures/long-120.musicxml?url';
import shortMxlUrl from '../../fixtures/short-piano.mxl?url';
import longMxlUrl from '../../fixtures/long-120.mxl?url';
import midiUrl from '../../fixtures/tempo-map.mid?url';

export const FIXTURES = { short: shortUrl, long: longUrl, shortMxl: shortMxlUrl, longMxl: longMxlUrl, midi: midiUrl } as const;
export type FixtureName = 'short' | 'long';

export const params = new URLSearchParams(location.search);
export const now = () => performance.now();
/** resolves after the next frame has been produced (style+layout+paint of pending DOM changes) */
export const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url: string) { return (await fetch(url)).text(); }

export function median(xs: number[]) { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export const r1 = (x: number) => Math.round(x * 10) / 10;
export const stats = (xs: number[]) => ({ first: r1(xs[0]), median: r1(median(xs.slice(1).length ? xs.slice(1) : xs)), min: r1(Math.min(...xs)), max: r1(Math.max(...xs)), n: xs.length });

export function log(...a: unknown[]) {
  console.log(...a);
  const el = document.getElementById('log');
  if (el) el.textContent += a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
}

declare global { interface Window { __bench?: { status: 'running' | 'done' | 'error'; results?: unknown; error?: string } } }
export async function runBench(fn: () => Promise<unknown>) {
  window.__bench = { status: 'running' };
  try {
    const results = await fn();
    window.__bench = { status: 'done', results };
    log('DONE', results);
  } catch (e) {
    const msg = e instanceof Error ? e.stack ?? e.message : String(e);
    window.__bench = { status: 'error', error: msg };
    log('ERROR', msg);
  }
}

/** red-highlight check: returns the computed fill/stroke/color of the first painted descendant */
export function computedPaint(el: Element | null) {
  if (!el) return null;
  const painted = el.matches('path,use,text,rect,ellipse,polygon') ? el : el.querySelector('path,use,text,rect,ellipse,polygon');
  if (!painted) return null;
  const cs = getComputedStyle(painted);
  return { tag: painted.tagName, fill: cs.fill, stroke: cs.stroke, color: cs.color };
}
