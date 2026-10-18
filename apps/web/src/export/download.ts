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
