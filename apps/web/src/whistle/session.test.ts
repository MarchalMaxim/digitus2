import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { build } from '../app/build.js';
import { isLocalScoreRecord, restoreSession, storeSession } from '../library/local/records.js';
import { bundleScan, pageEntry, readPageBytes } from '../scan/bundle.js';
import { recordingName, whistleSession, WHISTLE_RECOGNIZER } from './session.js';
import { transcribe } from './transcribe.js';
import { decodeWav } from './wav.js';
import { ODE_TO_JOY, perform, synthesize } from './testing/synth.js';

function recording() {
  const { tones } = perform(ODE_TO_JOY);
  const heard = transcribe(synthesize(tones, { sampleRate: 48000 }), 48000);
  if (!heard) throw new Error('nothing heard');
  return heard;
}

describe('a recording as a scanning session', () => {
  it('names the file after the time of the recording, as the camera names a photo', () => {
    expect(recordingName(new Date(2026, 9, 29, 9, 5, 3))).toBe('Whistled tune 09.05.03.wav');
  });

  it('is a WAV file read as notes, already recognised', async () => {
    const heard = recording();
    const session = whistleSession(heard, new Date(2026, 9, 29, 14, 5, 31));
    expect(session.file.name).toBe('Whistled tune 14.05.31.wav');
    expect(session.file.type).toBe('audio/wav');
    expect(session.xml).toBe(heard.xml);
    expect(session.recognizer).toBe(WHISTLE_RECOGNIZER);
    expect(session.pages).toBeUndefined();
    const { sampleRate, samples } = decodeWav(new Uint8Array(await session.file.arrayBuffer()));
    expect(sampleRate).toBe(16000);
    expect(samples.length).toBeGreaterThan(16000 * 7);
  });

  it('is kept in My scores and comes back from it with its recording', async () => {
    const session = whistleSession(recording());
    const stored = storeSession({ ...session, corrections: [{ kind: 'remove', note: 3 }] });
    expect(
      isLocalScoreRecord({
        version: 1,
        id: `scan:${session.id}`,
        updatedAt: 1,
        kind: 'scan',
        session: stored,
      }),
    ).toBe(true);
    const back = restoreSession(stored);
    expect(back.file.name).toBe(session.file.name);
    expect(back.file.type).toBe('audio/wav');
    expect(back.file.size).toBe(session.file.size);
    expect(back.xml).toBe(session.xml);
    expect(back.corrections).toEqual([{ kind: 'remove', note: 3 }]);
  });

  it('goes into Download everything with its recording and its notes', async () => {
    const session = whistleSession(recording());
    const zip = unzipSync(
      bundleScan({
        session,
        pageBytes: await readPageBytes(session),
        warnings: [],
        build,
        userAgent: 'test',
      }),
    );
    expect(Object.keys(zip).sort()).toEqual(
      [
        pageEntry(0, session.file),
        'page-1-recognized.musicxml',
        'combined-recognized.musicxml',
        'scan.json',
      ].sort(),
    );
    expect(pageEntry(0, session.file)).toBe('page-1.wav');
    expect(JSON.parse(new TextDecoder().decode(zip['scan.json']!)).recognizer).toBe(
      WHISTLE_RECOGNIZER,
    );
  });
});
