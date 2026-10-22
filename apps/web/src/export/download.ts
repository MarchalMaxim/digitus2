/**
 * Saving text to a file in the browser: no server, no network. The fingered MusicXML is built in
 * the engine worker; this only hands it to the browser's download.
 */
import type { PieceSource } from '../app/store.js';

/** The MusicXML media type (uncompressed, partwise or timewise). */
export const MUSICXML_MIME = 'application/vnd.recordare.musicxml+xml';

/** Starts a download of `text` named `filename`: a Blob behind an <a download>, then revoked. */
export function downloadText(filename: string, text: string, mime = MUSICXML_MIME): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

/** Starts a download of `blob` named `filename`, through a short-lived object URL. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.click();
  } finally {
    // The click has handed the Blob to the browser's download; the URL is no longer needed.
    URL.revokeObjectURL(url);
  }
}

/**
 * Hands `file` to the person: through the share sheet where the browser can share this file (a
 * phone, so it goes to WhatsApp or AirDrop), else as a download. Closing the share sheet is not
 * an error and does nothing more. A share that fails otherwise (the tap's permission lapsed while
 * the file was made, a target that refused it) downloads the file instead, so it is never lost.
 */
export async function shareOrDownload(file: File, title: string): Promise<void> {
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === 'AbortError') return;
    }
  }
  downloadBlob(file.name, file);
}

/** Whether the browser has a share sheet that takes this file; `canShare` throws on a bad share. */
function canShareFile(file: File): boolean {
  try {
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

/**
 * The exported file's name. A library piece: '<slug>.fingered.musicxml'. A dropped file: its
 * name without the extension and without any folder, then '.fingered.musicxml'
 * ('My Song.mxl' -> 'My Song.fingered.musicxml').
 */
export function exportFilename(source: PieceSource): string {
  if (source.kind === 'library') return `${source.slug}.fingered.musicxml`;
  const base = source.name
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .trim();
  return `${base || 'score'}.fingered.musicxml`;
}
