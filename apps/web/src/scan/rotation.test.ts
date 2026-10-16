import { expect, it } from 'vitest';
import { rotateScanPage } from './rotation.js';

it('restores the unchanged original and clears recognition on the fourth turn', async () => {
  const originalFile = new File(['original bytes including metadata'], 'original.jpg', {
    type: 'image/jpeg',
  });
  const result = await rotateScanPage(
    {
      id: 'page',
      file: new File(['rotated pixels'], 'rotated.png'),
      originalFile,
      quarterTurns: 3,
      xml: '<old/>',
      error: 'old failure',
      warnings: ['old warning'],
      recognizer: 'old',
    },
    new AbortController().signal,
  );
  expect(result.file).toBe(originalFile);
  expect(await result.file.text()).toBe('original bytes including metadata');
  expect(result.originalFile).toBeUndefined();
  expect(result.quarterTurns).toBeUndefined();
  expect(result.xml).toBeUndefined();
  expect(result.error).toBeUndefined();
  expect(result.warnings).toBeUndefined();
  expect(result.recognizer).toBeUndefined();
});

it('rejects oversized decoded dimensions before allocating bitmap memory', async () => {
  const bytes = new Uint8Array(24);
  bytes[0] = 137;
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 8000);
  view.setUint32(20, 6000);
  const file = new File([bytes], 'large.png', { type: 'image/png' });
  await expect(rotateScanPage({ id: 'page', file }, new AbortController().signal)).rejects.toThrow(
    /too large/,
  );
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
});

it('rejects a cancelled operation even when no decoding would be needed', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    rotateScanPage(
      { id: 'page', file: new File(['x'], 'x.png'), quarterTurns: 3 },
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
