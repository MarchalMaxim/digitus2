import type { ReviewFacts } from './facts.js';
import { SCAN_SERVICE } from './service.js';

/**
 * A device's opt-in to keeping its scans as validation cases (issue 233). Opening the app at
 * `#keep-scans` turns it on for this browser, `#keep-scans-off` turns it off (routes.ts). While it is
 * on, every page this device scans carries the scan's id, and the scan service keeps the page, its
 * recognition and what the review said about it, when the service has a bucket to keep them in
 * (docs/scan-service.md). Nothing else in the app changes.
 */
export const KEEP_SCANS_STORAGE_KEY = 'digitus2.keepScans';
/** The address that turns keeping on, and the one that turns it off. */
export const KEEP_SCANS_HASH = '#keep-scans';
export const KEEP_SCANS_OFF_HASH = '#keep-scans-off';
/** The request header naming the scan a page belongs to. */
export const KEEP_HEADER = 'X-Digitus2-Keep';
/** The request header naming the page itself, so a case can tell a retaken page apart. */
export const PAGE_HEADER = 'X-Digitus2-Page';

const SCAN_ID = /^[a-f0-9]{32}$/;

/** True when this device opted in; false where site data is blocked. */
export function keepScans(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEEP_SCANS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setKeepScans(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEEP_SCANS_STORAGE_KEY, '1');
    else localStorage.removeItem(KEEP_SCANS_STORAGE_KEY);
  } catch {
    // Blocked site data, a private window: nothing to keep the choice in.
  }
}

/** Turns keeping on or off when `hash` is one of its addresses; true when it was. */
export function keepScansFromHash(hash: string): boolean {
  if (hash !== KEEP_SCANS_HASH && hash !== KEEP_SCANS_OFF_HASH) return false;
  setKeepScans(hash === KEEP_SCANS_HASH);
  return true;
}

/** The scan id the service knows a scan by: its session id (a UUID) as 32 lowercase hex. */
export function scanIdOf(sessionId: string): string {
  return sessionId.replace(/-/g, '').toLowerCase();
}

/**
 * The headers a recognise request carries: none unless this device opted in; the page's own id
 * (`scanIdOf` it) with the scan's, when given.
 */
export function keepHeader(scanId: string, pageId?: string): Record<string, string> {
  if (!keepScans() || !SCAN_ID.test(scanId)) return {};
  return pageId && SCAN_ID.test(pageId)
    ? { [KEEP_HEADER]: scanId, [PAGE_HEADER]: pageId }
    : { [KEEP_HEADER]: scanId };
}

/** Per scan, the last facts the service took, so an unchanged value is not sent again. */
const reported = new Map<string, string>();
/** Per scan, the report under way: each waits for the one before, so they arrive in order. */
const reporting = new Map<string, Promise<void>>();
/** Per scan, the newest facts reported; a report overtaken while it waited is not sent. */
const newest = new Map<string, string>();

/**
 * Sends what the review told the reader about a scan to the scan service, which keeps it with the
 * scan's pages, each change in the order it happened, so the latest the service keeps is the
 * reader's last. Fire-and-forget: it never throws, never waits on the reader, and does nothing
 * unless this device opted in.
 */
export function reportCase(
  scanId: string,
  facts: ReviewFacts,
  fetcher: typeof fetch = fetch,
  base: string = SCAN_SERVICE,
): Promise<void> {
  try {
    if (!keepScans() || !SCAN_ID.test(scanId)) return Promise.resolve();
    const body = JSON.stringify(facts);
    newest.set(scanId, body);
    const send = async () => {
      // Compared when its turn comes, so a value the facts return to is sent again, and a burst of
      // corrections sends its last value only.
      if (newest.get(scanId) !== body || reported.get(scanId) === body) return;
      try {
        const response = await fetcher(base.replace(/\/+$/, '') + '/v1/cases/' + scanId, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json', 'X-Digitus2-Client': '1' },
          body,
        });
        // A value the service did not take is sent again the next time it is reported.
        if (response.ok) reported.set(scanId, body);
      } catch {
        // A case that is not kept changes nothing for the reader.
      }
    };
    const next = (reporting.get(scanId) ?? Promise.resolve()).then(send);
    reporting.set(scanId, next);
    return next;
  } catch {
    return Promise.resolve();
  }
}
