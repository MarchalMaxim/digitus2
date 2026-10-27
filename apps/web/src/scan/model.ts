import { PhraseError } from '../i18n/PhraseError.js';
import type { Correction } from './corrections.js';

/** Source provenance, also retained by the browser's local score library. */
export interface ScanSession {
  id: string;
  localId?: string | undefined;
  file: File;
  pages?: ScanPage[] | undefined;
  xml?: string | undefined;
  recognizedAt?: string | undefined;
  recognizer?: string | undefined;
  warnings?: string[] | undefined;
  /**
   * The reader's corrections of the combined recognition `xml`, in the order they were made. The
   * raw `xml` itself never changes; the corrected copy is `xml` with these replayed (corrections.ts).
   */
  corrections?: Correction[] | undefined;
  /**
   * Pages photographed again whose recognition is not stored yet (issue 130): the combined
   * recognition and corrections they replace, kept with the session so a Back, a reload, a cancel or
   * a refused scan does not lose the reader's corrections on the other pages (retake.ts).
   */
  retake?: PendingRetake | undefined;
}
export interface PendingRetake {
  /** The raw combined recognition the corrections were made on. */
  xml: string;
  corrections: Correction[];
  /** The pages replaced since, 0-based; their corrections are dropped. */
  pages: number[];
}
export interface ScanPage {
  id: string;
  /** Effective bytes shown in source comparison and sent to the recognizer. */
  file: File;
  /** Unchanged source retained while a nonzero rotation is applied. */
  originalFile?: File | undefined;
  /** Clockwise turns from the browser's EXIF-oriented original. Absent means zero. */
  quarterTurns?: 0 | 1 | 2 | 3 | undefined;
  xml?: string | undefined;
  error?: string | undefined;
  warnings?: string[] | undefined;
  recognizer?: string | undefined;
}
export const SCAN_PAGE_LIMIT = 20;
export async function validateScanImages(files: readonly File[]): Promise<File[]> {
  if (!files.length || files.length > SCAN_PAGE_LIMIT)
    throw new PhraseError((t) => t.scan.files.pageLimit);
  if (files.some((file) => !scanType(file)?.startsWith('image/')))
    throw new PhraseError((t) => t.scan.files.imagesOrOneFile);
  return Promise.all(files.map(validateScan));
}
export const SCAN_LIMIT = 10 * 1024 * 1024;
export function scanMime(name: string): string | null {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  return (
    (
      {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.pdf': 'application/pdf',
      } as Record<string, string>
    )[extension] ?? null
  );
}
const SCAN_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'application/pdf': '.pdf',
};
/**
 * The scan type of a file: by its extension, or, for a name without one of ours (a phone camera
 * can hand over "image" or a numbered name), by the type the browser reports.
 */
export function scanType(file: Pick<File, 'name' | 'type'>): string | null {
  return scanMime(file.name) ?? (file.type in SCAN_TYPES ? file.type : null);
}
export async function validateScan(file: File): Promise<File> {
  const type = scanType(file);
  if (!type || file.size === 0 || file.size > SCAN_LIMIT)
    throw new PhraseError((t) => t.scan.files.fileTypes);
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const valid =
    type === 'application/pdf'
      ? new TextDecoder().decode(bytes).startsWith('%PDF-')
      : type === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.join(',') === '137,80,78,71,13,10,26,10';
  if (!valid) throw new PhraseError((t) => t.scan.files.contentMismatch);
  // A camera file named without our extension gets one, so its name and type agree in downloads.
  const name = scanMime(file.name)
    ? file.name
    : file.name.replace(/\.[^.]*$/, '') + SCAN_TYPES[type];
  return new File([file], name, { type, lastModified: file.lastModified });
}
