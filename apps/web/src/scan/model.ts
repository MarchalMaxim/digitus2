import { PhraseError } from '../i18n/PhraseError.js';

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
  if (files.some((file) => !scanMime(file.name)?.startsWith('image/')))
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
export async function validateScan(file: File): Promise<File> {
  const type = scanMime(file.name);
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
  return new File([file], file.name, { type, lastModified: file.lastModified });
}
