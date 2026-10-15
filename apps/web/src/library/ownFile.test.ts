import { describe, expect, it, vi } from 'vitest';
import {
  acceptScoreFile,
  carriesFiles,
  isScoreFileName,
  NOT_A_SCORE_REFUSAL,
  SCORE_ACCEPT,
} from './ownFile.js';

describe('own files (spec 3, 7.6)', () => {
  it('takes MusicXML and MIDI by extension, in any case', () => {
    expect(['a.musicxml', 'b.XML', 'c.mxl', 'd.MID', 'e.midi'].map(isScoreFileName)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(['notes.txt', 'song', 'x.pdf'].map(isScoreFileName)).toEqual([false, false, false]);
    expect(SCORE_ACCEPT).toBe('.musicxml,.xml,.mxl,.mid,.midi,.png,.jpg,.jpeg,.pdf');
  });
  it('hands a score over as bytes, refuses anything else with the notice', async () => {
    const onFile = vi.fn();
    const onRefuse = vi.fn();
    acceptScoreFile(new File(['<score-partwise/>'], 'song.musicxml'), onFile, onRefuse);
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    expect(new TextDecoder().decode(onFile.mock.calls[0]![1] as Uint8Array)).toBe(
      '<score-partwise/>',
    );
    acceptScoreFile(new File(['x'], 'notes.txt'), onFile, onRefuse);
    expect(onRefuse).toHaveBeenCalledWith(NOT_A_SCORE_REFUSAL);
  });
  it('refuses a file that cannot be read', async () => {
    const onRefuse = vi.fn();
    const broken = new File(['x'], 'a.musicxml');
    vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(new Error('gone'));
    acceptScoreFile(broken, vi.fn(), onRefuse);
    await vi.waitFor(() => expect(onRefuse).toHaveBeenCalledWith(NOT_A_SCORE_REFUSAL));
  });
  it('tells a drag of files from a drag of text', () => {
    expect(carriesFiles({ types: ['Files'] } as unknown as DataTransfer)).toBe(true);
    expect(carriesFiles({ types: ['text/plain', 'text/html'] } as unknown as DataTransfer)).toBe(
      false,
    );
    expect(carriesFiles(null)).toBe(false);
  });
});
