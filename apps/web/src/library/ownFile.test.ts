import { describe, expect, it, vi } from 'vitest';
import {
  acceptScoreFile,
  acceptScoreFiles,
  carriesFiles,
  isScoreFileName,
  NOT_A_SCORE_REFUSAL,
  SCORE_ACCEPT,
} from './ownFile.js';

describe('own files (spec 3, 7.6)', () => {
  it('accepts image batches in selection order and rejects mixed batches atomically', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const photos = [new File([png], 'second.png'), new File([png], 'first.png')];
    const scans: File[][] = [];
    const refused: unknown[] = [];
    acceptScoreFiles(
      photos,
      () => {},
      (m) => refused.push(m),
      (files) => scans.push(files),
    );
    await vi.waitFor(() => expect(scans).toHaveLength(1));
    expect(scans[0]!.map((f) => f.name)).toEqual(['second.png', 'first.png']);
    acceptScoreFiles(
      [...photos, new File(['%PDF-1.7'], 'x.pdf')],
      () => {},
      (m) => refused.push(m),
      (files) => scans.push(files),
    );
    await vi.waitFor(() => expect(refused).toHaveLength(1));
    expect(scans).toHaveLength(1);
    acceptScoreFiles(
      [...photos, new File(['fake'], 'bad.png')],
      () => {},
      (m) => refused.push(m),
      (files) => scans.push(files),
    );
    await vi.waitFor(() => expect(refused).toHaveLength(2));
    expect(scans).toHaveLength(1);
  });
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
