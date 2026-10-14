import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadText, exportFilename } from './download.js';

afterEach(() => vi.restoreAllMocks());

describe('download', () => {
  it('creates an object URL, clicks an anchor with the filename, and revokes the URL', () => {
    const createObjectURL = vi.fn<typeof URL.createObjectURL>(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadText('a.fingered.musicxml', '<score-partwise/>');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('application/vnd.recordare.musicxml+xml');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });
  it('names the file after the piece', () => {
    expect(exportFilename({ kind: 'library', slug: 'ode-to-joy' })).toBe(
      'ode-to-joy.fingered.musicxml',
    );
    expect(exportFilename({ kind: 'file', name: 'My Song.mxl', bytes: new Uint8Array() })).toBe(
      'My Song.fingered.musicxml',
    );
    expect(exportFilename({ kind: 'file', name: 'twinkle.mid', bytes: new Uint8Array() })).toBe(
      'twinkle.fingered.musicxml',
    );
  });
});
