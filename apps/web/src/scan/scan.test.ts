import { describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/en/index.js';
import { PhraseError } from '../i18n/PhraseError.js';
import {
  BUSY_RETRY_MS,
  BusyError,
  createScanClient,
  GRAND_STAFF_WARNING,
  newJobId,
  PARTLY_READ_WARNING,
  PROTOCOL,
  UNKNOWN_WARNING,
} from './client.js';
import { SCAN_LIMIT, validateScan } from './model.js';

describe('experimental scan boundary', () => {
  it('validates signatures and keeps original PDF bytes and normalized MIME', async () => {
    const file = new File(['%PDF-1.7\noriginal vector bytes'], 'score.PDF');
    const accepted = await validateScan(file);
    expect(accepted.type).toBe('application/pdf');
    expect(await accepted.text()).toBe(await file.text());
    await expect(validateScan(new File(['fake'], 'score.png'))).rejects.toThrow('contents');
    await expect(validateScan(new File([''], 'score.pdf'))).rejects.toThrow('10 MB');
    await expect(
      validateScan(new File([new Uint8Array(SCAN_LIMIT + 1)], 'score.pdf')),
    ).rejects.toThrow('10 MB');
  });
  const job = 'a'.repeat(32);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const page = () => new File(['%PDF-1.7'], 'score.pdf', { type: 'application/pdf' });
  /** The error a promise rejects with, to compare its class and text. */
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      (e: unknown) => e,
    );
  /** A fetch that answers only by rejecting with the abort reason of its signal. */
  const hanging = () =>
    vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        ),
    );
  it('posts the original bytes with the job id and returns the recognition', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        state: 'ready',
        recognizer: 'Test',
        capabilities: { textModelConfigured: true },
        warnings: [{ code: 'recognition-grand-staff-unpaired', message: 'English text' }],
        xml: '<score-partwise/>',
      }),
    );
    const file = page();
    expect(await createScanClient(fetcher, 'https://scan.test').recognize(file, job)).toEqual({
      xml: '<score-partwise/>',
      recognizer: 'Test',
      capabilities: { textModelConfigured: true },
      warnings: [GRAND_STAFF_WARNING],
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://scan.test/v1/recognize');
    expect(init).toMatchObject({
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Digitus2-Client': '1',
        'X-Digitus2-Job': job,
      },
    });
    expect(init?.body).toBe(file);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const empty = vi.fn<typeof fetch>().mockResolvedValue(json({ state: 'ready' }));
    await expect(createScanClient(empty).recognize(file, job)).rejects.toThrow(
      en.scan.client.noResult,
    );
  });
  it('cancels with a keepalive DELETE and tolerates a failed answer', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: job, state: 'cancelling' }))
      .mockResolvedValueOnce(json({ error: 'not found' }, 404));
    const client = createScanClient(fetcher, 'https://scan.test');
    await client.cancel(job);
    await client.cancel(job);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://scan.test/v1/jobs/' + job);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
      keepalive: true,
      headers: { 'X-Digitus2-Client': '1' },
    });
    const refused = await failure(client.cancel('../result'));
    expect(refused).toBeInstanceOf(PhraseError);
    expect((refused as Error).message).toBe(en.scan.client.invalidJob);
    await expect(client.recognize(page(), 'A'.repeat(32))).rejects.toThrow(
      en.scan.client.invalidJob,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('maps busy, limited, failure, timeout and other statuses to phrases', async () => {
    const answer = async (response: Response | Error) => {
      const fetcher = vi.fn<typeof fetch>();
      if (response instanceof Error) fetcher.mockRejectedValue(response);
      else fetcher.mockResolvedValue(response);
      return failure(createScanClient(fetcher).recognize(page(), job));
    };
    const phrase = async (response: Response | Error, text: string) => {
      const error = await answer(response);
      expect(error).toBeInstanceOf(PhraseError);
      expect((error as Error).message).toBe(text);
    };
    // Only the service's own busy answer is busy: a bare 429 or a 503 is a failure to answer.
    await phrase(
      new Response('<html>Too many</html>', { status: 429 }),
      en.scan.client.serviceStatus(429),
    );
    await phrase(json({ error: 'busy' }, 429), en.scan.client.busy);
    await phrase(json({ error: 'rate-limited' }, 429), en.scan.client.limited);
    await phrase(new Response('', { status: 503 }), en.scan.client.serviceStatus(503));
    await phrase(json({ error: 'busy' }, 503), en.scan.client.serviceStatus(503));
    const blur = await answer(
      json({ state: 'failed', failure: { code: 'low-resolution', message: 'blur' } }, 422),
    );
    expect(blur).toBeInstanceOf(Error);
    expect(blur).not.toBeInstanceOf(PhraseError);
    expect((blur as Error).message).toBe('blur');
    await phrase(json({ state: 'failed' }, 422), en.scan.errors.notRecognized);
    await phrase(
      json({ state: 'timed_out', failure: { code: 'timeout' } }, 504),
      en.scan.errors.timedOut,
    );
    await phrase(new Response('', { status: 500 }), en.scan.client.serviceStatus(500));
    await phrase(json({ error: 'too large' }, 413), en.scan.client.serviceStatus(413));
  });
  it('tells an offline device to check its connection, and an online one that the scanner did not answer', async () => {
    // Google's own answers (billing disabled, its 429, 503 and 5xx pages) carry no CORS header:
    // the browser reports them as a failed fetch, like a dropped connection.
    const failed = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    const client = createScanClient(failed);
    const failures = async () => [
      await failure(client.recognize(page(), job)),
      await failure(client.health()),
      await failure(client.cancel(job)),
    ];
    try {
      vi.stubGlobal('navigator', { onLine: false });
      for (const error of await failures()) {
        expect(error).toBeInstanceOf(PhraseError);
        expect((error as Error).message).toBe(en.scan.errors.offline);
      }
      vi.stubGlobal('navigator', { onLine: true });
      for (const error of await failures()) {
        expect(error).toBeInstanceOf(PhraseError);
        expect((error as Error).message).toBe(en.scan.client.noAnswer);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('marks only the service’s own busy answer as worth waiting for', async () => {
    const answer = (response: Response) =>
      failure(
        createScanClient(vi.fn<typeof fetch>().mockResolvedValue(response)).recognize(page(), job),
      );
    const busy = await answer(json({ error: 'busy' }, 429));
    expect(busy).toBeInstanceOf(BusyError);
    expect(busy).toBeInstanceOf(PhraseError);
    expect((busy as Error).message).toBe(en.scan.client.busy);
    // A host's own refusal and the hourly limit are not waited out.
    for (const other of [
      new Response('<html>Too many</html>', { status: 429 }),
      new Response('', { status: 503 }),
      json({ error: 'rate-limited' }, 429),
    ])
      expect(await answer(other)).not.toBeInstanceOf(BusyError);
  });
  it('waits what a busy answer asks for, and at least five seconds', async () => {
    const retryAfter = async (header?: string) => {
      const response = json({ error: 'busy' }, 429);
      if (header !== undefined) response.headers.set('Retry-After', header);
      const error = await failure(
        createScanClient(vi.fn<typeof fetch>().mockResolvedValue(response)).recognize(page(), job),
      );
      return (error as BusyError).retryAfterMs;
    };
    expect(BUSY_RETRY_MS).toBe(5_000);
    // A browser reads the header only when the service exposes it; without it, five seconds.
    expect(await retryAfter()).toBe(5_000);
    expect(await retryAfter('30')).toBe(30_000);
    expect(await retryAfter('2')).toBe(5_000);
    expect(await retryAfter('0')).toBe(5_000);
    // A date or text is not a number of seconds.
    expect(await retryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(5_000);
    expect(await retryAfter('soon')).toBe(5_000);
  });
  it('gives up after 200 seconds with the timed-out phrase', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = hanging();
      const pending = failure(createScanClient(fetcher).recognize(page(), job));
      await vi.advanceTimersByTimeAsync(199_999);
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;
      expect(error).toBeInstanceOf(PhraseError);
      expect((error as Error).message).toBe(en.scan.errors.timedOut);
    } finally {
      vi.useRealTimers();
    }
  });
  it('throws an abort on a cancelled job and on a caller abort', async () => {
    const answered = vi.fn<typeof fetch>().mockResolvedValue(json({ state: 'cancelled' }, 409));
    const cancelled = await failure(createScanClient(answered).recognize(page(), job));
    expect(cancelled).toBeInstanceOf(DOMException);
    expect((cancelled as DOMException).name).toBe('AbortError');
    const fetcher = hanging();
    const controller = new AbortController();
    const pending = failure(createScanClient(fetcher).recognize(page(), job, controller.signal));
    controller.abort();
    const aborted = await pending;
    expect(aborted).not.toBeInstanceOf(PhraseError);
    expect((aborted as DOMException).name).toBe('AbortError');
    const early = new AbortController();
    early.abort();
    const before = await failure(createScanClient(fetcher).recognize(page(), job, early.signal));
    expect((before as DOMException).name).toBe('AbortError');
  });
  it('refuses a service of another protocol', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ protocol: 'digitus2-scan-v1' }))
      .mockResolvedValueOnce(json({ protocol: PROTOCOL, recognizer: 'Test', maxUploadBytes: 1 }));
    const client = createScanClient(fetcher, 'https://scan.test');
    expect(fetcher).not.toHaveBeenCalled();
    // The warm-up alone reads the health answer, and shows none of its failures.
    await expect(client.health()).rejects.toThrow('digitus2-scan-v1');
    expect(fetcher).toHaveBeenCalledWith(
      'https://scan.test/v1/health',
      expect.objectContaining({ mode: 'cors', credentials: 'omit' }),
    );
    expect(await client.health()).toMatchObject({ protocol: PROTOCOL, recognizer: 'Test' });
  });
  it('makes 32-hex job ids', () => {
    const ids = new Set(Array.from({ length: 50 }, newJobId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{32}$/);
  });
  it('normalizes actual structured worker warnings into safe review text', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocol: PROTOCOL,
          warnings: [
            { code: 'ocr-language-not-configured', message: 'English OCR is not configured.' },
          ],
        }),
      ),
    );
    expect((await createScanClient(fetcher).health()).warnings).toEqual([
      'English OCR is not configured.',
    ]);
  });
  it('turns warnings that carry no text into the unknown-warning marker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocol: PROTOCOL,
          warnings: [null, 7, {}, { code: 'x' }, { message: 5 }, 'plain text'],
        }),
      ),
    );
    expect((await createScanClient(fetcher).health()).warnings).toEqual([
      UNKNOWN_WARNING,
      UNKNOWN_WARNING,
      UNKNOWN_WARNING,
      UNKNOWN_WARNING,
      UNKNOWN_WARNING,
      'plain text',
    ]);
  });
  it('keeps the unpaired grand staff warning as a marker the review translates and shows', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocol: PROTOCOL,
          warnings: [{ code: 'recognition-grand-staff-unpaired', message: 'English text' }],
        }),
      ),
    );
    expect((await createScanClient(fetcher).health()).warnings).toEqual([GRAND_STAFF_WARNING]);
  });
  it('keeps a partly read line as its marker, whatever the English message', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        state: 'ready',
        recognizer: 'Test',
        warnings: [
          {
            code: 'recognition-system-partly-read',
            message: 'Part of a line of music was not read. Compare with line 1.',
            details: { systems: [1] },
          },
        ],
        xml: '<score-partwise/>',
      }),
    );
    const result = await createScanClient(fetcher, 'https://scan.test').recognize(page(), job);
    expect(result.warnings).toEqual([PARTLY_READ_WARNING]);
  });
  it('takes a file of exactly ten mebibytes and refuses one byte more', async () => {
    const tenMiB = 10 * 1024 * 1024;
    const pdf = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set(new TextEncoder().encode('%PDF-1.7'));
      return new File([bytes], 'score.pdf');
    };
    await expect(validateScan(pdf(tenMiB))).resolves.toBeInstanceOf(File);
    await expect(validateScan(pdf(tenMiB + 1))).rejects.toThrow('10 MB');
  });
  it('throws errors that can be written in another language', async () => {
    const error = await validateScan(new File(['fake'], 'score.png')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PhraseError);
    expect((error as PhraseError).message).toBe(en.scan.files.contentMismatch);
  });
});
