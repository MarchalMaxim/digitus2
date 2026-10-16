import { describe, expect, it } from 'vitest';
import { isLocalScoreRecord, restoreSession, storeSession } from './records.js';

const original = new File(['original pixels'], 'piano.jpg', {
  type: 'image/jpeg',
  lastModified: 123,
});
const effective = new File(['rotated pixels'], 'piano-rotated.png', { type: 'image/png' });
const session = {
  id: 'scan-one',
  file: effective,
  xml: '<score-partwise/>',
  recognizedAt: '2026-10-16T00:00:00Z',
  recognizer: 'recognizer',
  warnings: ['Check ties.'],
  pages: [
    {
      id: 'page-one',
      file: effective,
      originalFile: original,
      quarterTurns: 1 as const,
      xml: '<page/>',
      recognizer: 'recognizer',
      warnings: ['Check ties.'],
      error: 'old failure',
    },
  ],
};

describe('local score records', () => {
  it('round trips source metadata, orientation, order and raw recognition without active job state', () => {
    const stored = storeSession({
      ...session,
      jobId: 'private-job',
      token: 'private-token',
    } as typeof session);
    const restored = restoreSession(stored);
    expect(restored.file.name).toBe('piano-rotated.png');
    expect(restored.file.size).toBe(14);
    expect(restored.pages?.[0]?.originalFile?.name).toBe('piano.jpg');
    expect(restored.pages?.[0]?.originalFile?.size).toBe(15);
    expect(restored.pages?.[0]?.originalFile?.lastModified).toBe(123);
    expect(restored.pages?.[0]?.quarterTurns).toBe(1);
    expect(restored.pages?.[0]?.xml).toBe('<page/>');
    expect(restored.xml).toBe('<score-partwise/>');
    expect(stored).not.toHaveProperty('jobId');
    expect(stored).not.toHaveProperty('token');
    expect(restored.pages?.[0]).not.toHaveProperty('error');
  });
  it('accepts valid scan and direct file rows', () => {
    expect(
      isLocalScoreRecord({
        version: 1,
        id: 'one',
        updatedAt: 10,
        kind: 'scan',
        session: storeSession(session),
      }),
    ).toBe(true);
    expect(
      isLocalScoreRecord({
        version: 1,
        id: 'two',
        updatedAt: 20,
        kind: 'file',
        name: 'piano.mid',
        blob: new Blob(['midi']),
      }),
    ).toBe(true);
  });
  it('rejects unsupported versions, missing blobs, empty page sets and invalid orientation', () => {
    const record = {
      version: 1,
      id: 'one',
      updatedAt: 10,
      kind: 'scan',
      session: storeSession(session),
    };
    expect(isLocalScoreRecord({ ...record, version: 2 })).toBe(false);
    expect(
      isLocalScoreRecord({ ...record, session: { ...record.session, file: { name: 'gone.jpg' } } }),
    ).toBe(false);
    expect(isLocalScoreRecord({ ...record, session: { ...record.session, pages: [] } })).toBe(
      false,
    );
    expect(
      isLocalScoreRecord({
        ...record,
        session: { ...record.session, pages: [{ ...record.session.pages![0], quarterTurns: 5 }] },
      }),
    ).toBe(false);
    expect(isLocalScoreRecord({ ...record, updatedAt: NaN })).toBe(false);
  });
});
