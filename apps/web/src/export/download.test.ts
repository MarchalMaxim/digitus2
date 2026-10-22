import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadText, exportFilename, shareOrDownload } from './download.js';

afterEach(() => {
  vi.restoreAllMocks();
  // The share sheet is stubbed on the navigator itself; happy-dom's navigator has none.
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
});

/** Gives the navigator a share sheet that accepts files or not (and a `share` that may fail). */
function stubShare(canShare: boolean, share: () => Promise<void> = () => Promise.resolve()) {
  const stubbed = { canShare: vi.fn(() => canShare), share: vi.fn(share) };
  Object.defineProperty(navigator, 'canShare', { value: stubbed.canShare, configurable: true });
  Object.defineProperty(navigator, 'share', { value: stubbed.share, configurable: true });
  return stubbed;
}

/** Spies on the object-URL download and the anchor click, and returns the anchors' names. */
function spyDownload() {
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return names;
}

describe('shareOrDownload', () => {
  const zip = () => new File([new Uint8Array([80, 75])], 'scan.zip', { type: 'application/zip' });

  it('shares the file where the browser can share it, and downloads nothing', async () => {
    const downloads = spyDownload();
    const sheet = stubShare(true);
    const file = zip();
    await shareOrDownload(file, 'scan');
    expect(sheet.canShare).toHaveBeenCalledWith({ files: [file] });
    expect(sheet.share).toHaveBeenCalledWith({ files: [file], title: 'scan' });
    expect(downloads).toEqual([]);
  });

  it('downloads the file where the browser cannot share files', async () => {
    const downloads = spyDownload();
    const sheet = stubShare(false);
    await shareOrDownload(zip(), 'scan');
    expect(sheet.share).not.toHaveBeenCalled();
    expect(downloads).toEqual(['scan.zip']);
  });

  it('downloads the file where there is no share sheet at all', async () => {
    const downloads = spyDownload();
    await shareOrDownload(zip(), 'scan');
    expect(downloads).toEqual(['scan.zip']);
  });

  it('does nothing more when the share sheet is closed', async () => {
    const downloads = spyDownload();
    stubShare(true, () => Promise.reject(new DOMException('closed', 'AbortError')));
    await expect(shareOrDownload(zip(), 'scan')).resolves.toBeUndefined();
    expect(downloads).toEqual([]);
  });

  it('downloads the file when the share fails otherwise, so it is not lost', async () => {
    const downloads = spyDownload();
    stubShare(true, () => Promise.reject(new DOMException('no gesture', 'NotAllowedError')));
    await shareOrDownload(zip(), 'scan');
    expect(downloads).toEqual(['scan.zip']);
  });

  it('downloads the file when canShare throws', async () => {
    const downloads = spyDownload();
    stubShare(true);
    Object.defineProperty(navigator, 'canShare', {
      value: () => {
        throw new TypeError('bad data');
      },
      configurable: true,
    });
    await shareOrDownload(zip(), 'scan');
    expect(downloads).toEqual(['scan.zip']);
  });
});

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
