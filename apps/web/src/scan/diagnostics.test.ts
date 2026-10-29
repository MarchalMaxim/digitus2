import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScanClient } from './client.js';
import {
  KEEP_SCANS_STORAGE_KEY,
  keepHeader,
  keepScans,
  keepScansFromHash,
  reportCase,
  scanIdOf,
  setKeepScans,
} from './diagnostics.js';
import type { ReviewFacts } from './facts.js';

const SESSION = '01234567-89ab-cdef-0123-456789ABCDEF';
const SCAN = '0123456789abcdef0123456789abcdef';
const FACTS: ReviewFacts = {
  verdict: 'Ready to use for fingerings.',
  usable: true,
  technical: [],
  places: [{ text: 'Check this bar.', bar: '4' }],
  corrections: 0,
  pages: [SCAN],
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem(KEEP_SCANS_STORAGE_KEY);
});

describe('keeping scans as validation cases', () => {
  it('is off until the device opts in, and the opt-in is kept', () => {
    expect(keepScans()).toBe(false);
    setKeepScans(true);
    expect(keepScans()).toBe(true);
    expect(localStorage.getItem(KEEP_SCANS_STORAGE_KEY)).toBe('1');
    setKeepScans(false);
    expect(keepScans()).toBe(false);
    expect(localStorage.getItem(KEEP_SCANS_STORAGE_KEY)).toBeNull();
  });
  it('switches on its two addresses only', () => {
    expect(keepScansFromHash('#keep-scans')).toBe(true);
    expect(keepScans()).toBe(true);
    expect(keepScansFromHash('#/scan')).toBe(false);
    expect(keepScansFromHash('#keep-scans-other')).toBe(false);
    expect(keepScans()).toBe(true);
    expect(keepScansFromHash('#keep-scans-off')).toBe(true);
    expect(keepScans()).toBe(false);
  });
  it('reads as off where site data is blocked', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(() => setKeepScans(true)).not.toThrow();
    expect(keepScans()).toBe(false);
    expect(keepHeader(SCAN)).toEqual({});
  });
  it('names a scan by its session id as 32 lowercase hex', () => {
    expect(scanIdOf(SESSION)).toBe(SCAN);
  });
  it('sends the keep header only on an opted-in device and for a valid scan id', () => {
    expect(keepHeader(SCAN)).toEqual({});
    setKeepScans(true);
    expect(keepHeader(SCAN)).toEqual({ 'X-Digitus2-Keep': SCAN });
    expect(keepHeader('not-a-scan')).toEqual({});
    expect(keepHeader(SESSION)).toEqual({});
  });
  it('names the page beside the scan only when the scan is named', () => {
    const page = 'f'.repeat(32);
    expect(keepHeader(SCAN, page)).toEqual({});
    setKeepScans(true);
    expect(keepHeader(SCAN, page)).toEqual({ 'X-Digitus2-Keep': SCAN, 'X-Digitus2-Page': page });
    expect(keepHeader(SCAN, 'not-a-page')).toEqual({ 'X-Digitus2-Keep': SCAN });
    expect(keepHeader('not-a-scan', page)).toEqual({});
  });
});

describe('the recognise request', () => {
  const json = () =>
    new Response(JSON.stringify({ state: 'ready', xml: '<score-partwise/>' }), { status: 200 });
  const page = () => new File([new Uint8Array([0x89, 0x50])], 'p.png', { type: 'image/png' });
  const job = 'a'.repeat(32);
  const headersOf = async (scan?: string, id?: string) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json());
    await createScanClient(fetcher, 'https://scan.test').recognize(
      page(),
      job,
      undefined,
      scan,
      id,
    );
    return fetcher.mock.calls[0]![1]!.headers as Record<string, string>;
  };
  it('names the scan on an opted-in device', async () => {
    setKeepScans(true);
    expect((await headersOf(SCAN))['X-Digitus2-Keep']).toBe(SCAN);
    expect(await headersOf(SCAN)).not.toHaveProperty('X-Digitus2-Page');
  });
  it('names the page beside its scan', async () => {
    setKeepScans(true);
    const id = 'e'.repeat(32);
    expect(await headersOf(SCAN, id)).toMatchObject({
      'X-Digitus2-Keep': SCAN,
      'X-Digitus2-Page': id,
    });
  });
  it('carries no keep header otherwise', async () => {
    expect(await headersOf(SCAN)).not.toHaveProperty('X-Digitus2-Keep');
    setKeepScans(true);
    expect(await headersOf()).not.toHaveProperty('X-Digitus2-Keep');
  });
});

describe('reportCase', () => {
  it('does nothing unless the device opted in', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await reportCase('1'.repeat(32), FACTS, fetcher, 'https://scan.test');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('posts each change, a value it returns to included', async () => {
    setKeepScans(true);
    const scan = '6'.repeat(32);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const changed = { ...FACTS, usable: false, corrections: 1 };
    await reportCase(scan, FACTS, fetcher);
    await reportCase(scan, changed, fetcher);
    await reportCase(scan, FACTS, fetcher);
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init!.body as string))).toEqual([
      FACTS,
      changed,
      FACTS,
    ]);
  });
  it('sends the reports of one scan in order, each after the one before', async () => {
    setKeepScans(true);
    const scan = '7'.repeat(32);
    let answer!: (response: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockResolvedValue(new Response(null, { status: 204 }));
    const first = reportCase(scan, FACTS, fetcher);
    await Promise.resolve();
    const second = reportCase(scan, { ...FACTS, corrections: 1 }, fetcher);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    answer(new Response(null, { status: 204 }));
    await first;
    await second;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toMatchObject({ corrections: 1 });
  });
  it('sends only the last of the values reported while one was under way', async () => {
    setKeepScans(true);
    const scan = '9'.repeat(32);
    let answer!: (response: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockResolvedValue(new Response(null, { status: 204 }));
    const first = reportCase(scan, FACTS, fetcher);
    await Promise.resolve();
    const rest = [1, 2, 3].map((corrections) =>
      reportCase(scan, { ...FACTS, corrections }, fetcher),
    );
    answer(new Response(null, { status: 204 }));
    await Promise.all([first, ...rest]);
    expect(
      fetcher.mock.calls.map(([, init]) => JSON.parse(init!.body as string).corrections),
    ).toEqual([0, 3]);
  });
  it('sends a value the service did not take again', async () => {
    setKeepScans(true);
    const scan = '8'.repeat(32);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response(null, { status: 204 }));
    await reportCase(scan, FACTS, fetcher);
    await reportCase(scan, FACTS, fetcher);
    await reportCase(scan, FACTS, fetcher);
    await reportCase(scan, FACTS, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not post an unchanged value again', async () => {
    setKeepScans(true);
    const scan = '2'.repeat(32);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await reportCase(scan, FACTS, fetcher, 'https://scan.test/');
    await reportCase(scan, { ...FACTS }, fetcher, 'https://scan.test/');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://scan.test/v1/cases/${scan}`);
    expect(init).toMatchObject({
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Digitus2-Client': '1' },
    });
    expect(JSON.parse(init!.body as string)).toEqual(FACTS);
    await reportCase(scan, { ...FACTS, corrections: 1 }, fetcher, 'https://scan.test');
    await reportCase('3'.repeat(32), FACTS, fetcher, 'https://scan.test');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('never throws, whatever the service answers', async () => {
    setKeepScans(true);
    const failed = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(reportCase('4'.repeat(32), FACTS, failed)).resolves.toBeUndefined();
    const refused = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(reportCase('5'.repeat(32), FACTS, refused)).resolves.toBeUndefined();
    const invalid = vi.fn<typeof fetch>();
    await reportCase(SESSION, FACTS, invalid);
    expect(invalid).not.toHaveBeenCalled();
  });
});
