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
  it('accepts every quarter turn from 0 to 3', () => {
    for (const quarterTurns of [0, 1, 2, 3]) {
      const stored = storeSession({
        ...session,
        pages: [{ ...session.pages[0]!, quarterTurns: quarterTurns as 1 }],
      });
      expect(
        isLocalScoreRecord({ version: 1, id: 'one', updatedAt: 10, kind: 'scan', session: stored }),
        String(quarterTurns),
      ).toBe(true);
    }
  });
  it('keeps an id or file name under 2048 characters, and rejects one that long', () => {
    const file = (name: string) => ({
      version: 1,
      id: 'one',
      updatedAt: 10,
      kind: 'file',
      name,
      blob: new Blob(['midi']),
    });
    expect(isLocalScoreRecord(file('n'.repeat(2047)))).toBe(true);
    expect(isLocalScoreRecord(file('n'.repeat(2048)))).toBe(false);
    expect(isLocalScoreRecord({ ...file('a'), id: 'i'.repeat(2047) })).toBe(true);
    expect(isLocalScoreRecord({ ...file('a'), id: 'i'.repeat(2048) })).toBe(false);
    expect(isLocalScoreRecord({ ...file('a'), id: '' })).toBe(false);
  });
  it('rejects a stored image whose type or modified time is not usable', () => {
    const record = {
      version: 1,
      id: 'one',
      updatedAt: 10,
      kind: 'scan',
      session: storeSession(session),
    };
    const withFile = (patch: object) => ({
      ...record,
      session: { ...record.session, file: { ...record.session.file, ...patch } },
    });
    expect(isLocalScoreRecord(withFile({}))).toBe(true);
    expect(isLocalScoreRecord(withFile({ lastModified: NaN }))).toBe(false);
    expect(isLocalScoreRecord(withFile({ lastModified: Infinity }))).toBe(false);
    expect(isLocalScoreRecord(withFile({ lastModified: '123' }))).toBe(false);
    expect(isLocalScoreRecord(withFile({ type: 5 }))).toBe(false);
  });
});

describe('saved corrections', () => {
  const corrected = {
    ...session,
    corrections: [
      { kind: 'pitch' as const, note: 3, step: 'B' as const, alter: -1, octave: 4 },
      { kind: 'duration' as const, note: 4, type: 'quarter' as const, dots: 1 as const },
      { kind: 'tie' as const, note: 5, tied: false, side: 'previous' as const },
      { kind: 'hand' as const, note: 6, staff: 2 },
      { kind: 'remove' as const, note: 7 },
      { kind: 'meter' as const, bar: 0, beats: 9, beatType: 8 },
    ],
  };
  const row = (value: unknown) => ({
    version: 1,
    id: 'scan:x',
    updatedAt: 1,
    kind: 'scan',
    session: value,
  });
  it('keeps the raw recognition and the list of corrections side by side', () => {
    const stored = storeSession(corrected);
    expect(stored.xml).toBe('<score-partwise/>');
    expect(restoreSession(stored).corrections).toEqual(corrected.corrections);
    expect(isLocalScoreRecord(row(stored))).toBe(true);
  });
  it.each([
    ['an unknown kind', { kind: 'transpose', note: 1 }],
    ['a pitch out of range', { kind: 'pitch', note: 1, step: 'H', alter: 0, octave: 4 }],
    ['an extra field', { kind: 'remove', note: 1, xml: '<evil/>' }],
    ['a negative note', { kind: 'remove', note: -1 }],
    ['a length the editor never writes', { kind: 'duration', note: 1, type: 'breve', dots: 0 }],
    ['a beat type that is not a note value', { kind: 'meter', bar: 0, beats: 9, beatType: 3 }],
    ['a meter with a note', { kind: 'meter', bar: 0, beats: 9, beatType: 8, note: 1 }],
  ])('refuses a row with %s', (_label, correction) => {
    expect(isLocalScoreRecord(row({ ...storeSession(session), corrections: [correction] }))).toBe(
      false,
    );
  });
});
