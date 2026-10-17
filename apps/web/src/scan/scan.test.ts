import { describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/en/index.js';
import { PhraseError } from '../i18n/PhraseError.js';
import { createScanClient } from './client.js';
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
  it('does not contact the worker before an explicit connect', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ protocol: 'digitus2-scan-v1' })));
    const client = createScanClient(fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    await client.connect();
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8996/v1/health',
      expect.objectContaining({
        mode: 'cors',
        credentials: 'omit',
        targetAddressSpace: 'loopback',
      }),
    );
  });
  it('passes original upload and cancels the actual job with an authenticated mutation', async () => {
    const id = 'a'.repeat(32);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify({ id })));
    const client = createScanClient(fetcher);
    const file = new File(['%PDF-1.7'], 'score.pdf', { type: 'application/pdf' });
    expect(await client.start(file)).toBe(id);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(file);
    await client.cancel(id);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'DELETE',
      headers: { 'X-Digitus2-Client': '1' },
    });
    await expect(client.status('../result')).rejects.toThrow('Invalid');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('refuses incompatible worker and surfaces busy state', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('', { status: 429 }));
    const client = createScanClient(fetcher);
    await expect(client.connect()).rejects.toThrow('Update');
    await expect(client.start(new File(['x'], 'x.png'))).rejects.toThrow('already scanning');
  });
  it('normalizes actual structured worker warnings into safe review text', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocol: 'digitus2-scan-v1',
          warnings: [
            { code: 'ocr-language-not-configured', message: 'English OCR is not configured.' },
          ],
        }),
      ),
    );
    expect((await createScanClient(fetcher).connect()).warnings).toEqual([
      'English OCR is not configured.',
    ]);
  });
  it('throws errors that can be written in another language', async () => {
    const error = await validateScan(new File(['fake'], 'score.png')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PhraseError);
    expect((error as PhraseError).message).toBe(en.scan.files.contentMismatch);
  });
});
