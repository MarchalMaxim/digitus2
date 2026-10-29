import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Build } from '../app/build.js';
import type { ReviewFacts } from './facts.js';
import type { ScanPage, ScanSession } from './model.js';

/**
 * "Download everything" (issue 156): one ZIP holding what a scan did, so the owner can hand a
 * phone's evidence over in one tap and look at it on a PC. The page images are exactly as the
 * scanner received them, each page's recognition and the combined file are the scanner's raw
 * answers, and scan.json says the rest: recognizer, time, warnings, corrections, what the review
 * told the reader (issue 233), the build of the app and the browser it ran in. An archive is a
 * validation case as it is (docs/scanning.md).
 */

/** The ZIP's entries; the page files and each page's recognition are numbered from 1. */
export const COMBINED_ENTRY = 'combined-recognized.musicxml';
export const CORRECTED_ENTRY = 'corrected.musicxml';
export const SUMMARY_ENTRY = 'scan.json';
export const pageEntry = (index: number, file: Pick<File, 'name' | 'type'>) =>
  `page-${index + 1}.${pageExtension(file)}`;
export const recognizedEntry = (index: number) => `page-${index + 1}-recognized.musicxml`;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
  'audio/wav': 'wav',
};

/** A page file's extension: by its type, else the one its name has, else `bin`. */
function pageExtension(file: Pick<File, 'name' | 'type'>): string {
  const named = /\.([A-Za-z0-9]{1,5})$/.exec(file.name)?.[1]?.toLowerCase();
  return EXTENSIONS[file.type] ?? named ?? 'bin';
}

/** The pages of a session: a session of one file (a PDF, a restored scan) has no list of pages. */
export function pagesOf(session: ScanSession): ScanPage[] {
  return session.pages ?? [{ id: session.id, file: session.file, xml: session.xml }];
}

export interface ScanBundle {
  session: ScanSession;
  /** The bytes of each page's file, in page order (readPageBytes). */
  pageBytes: readonly Uint8Array[];
  /** The reader's corrected copy of the combined recognition, when there are corrections. */
  correctedXml?: string | undefined;
  /** Every warning the review shows: the scanner's and the importer's. */
  warnings: readonly string[];
  /** What the review told the reader, in English (facts.ts); absent before it was read. */
  review?: ReviewFacts | undefined;
  build: Build;
  userAgent: string;
}

/** The ZIP of a scan. Pure: the caller reads the page files (readPageBytes) and the browser. */
export function bundleScan(input: ScanBundle): Uint8Array {
  const { session, pageBytes, correctedXml, warnings, review, build, userAgent } = input;
  const pages = pagesOf(session);
  const entries: Zippable = {};
  const summaries = pages.map((page, index) => {
    const bytes = pageBytes[index];
    if (!bytes) throw new Error(`The bytes of page ${index + 1} were not read.`);
    // The images are compressed already: stored, they cost no time on a phone.
    entries[pageEntry(index, page.file)] = [bytes, { level: 0 }];
    if (page.xml) entries[recognizedEntry(index)] = strToU8(page.xml);
    return {
      entry: pageEntry(index, page.file),
      name: page.file.name,
      type: page.file.type,
      size: bytes.length,
      recognized: page.xml ? recognizedEntry(index) : null,
      recognizer: page.recognizer ?? null,
      warnings: page.warnings ?? [],
      error: page.error ?? null,
    };
  });
  if (session.xml) entries[COMBINED_ENTRY] = strToU8(session.xml);
  if (correctedXml) entries[CORRECTED_ENTRY] = strToU8(correctedXml);
  entries[SUMMARY_ENTRY] = strToU8(
    JSON.stringify(
      {
        build,
        userAgent,
        recognizer: session.recognizer ?? null,
        recognizedAt: session.recognizedAt ?? null,
        warnings,
        corrections: session.corrections ?? [],
        review: review ?? null,
        combined: session.xml ? COMBINED_ENTRY : null,
        corrected: correctedXml ? CORRECTED_ENTRY : null,
        pages: summaries,
      },
      null,
      2,
    ),
  );
  return zipSync(entries);
}

/** The bytes of every page's file, in page order. */
export function readPageBytes(session: ScanSession): Promise<Uint8Array[]> {
  return Promise.all(
    pagesOf(session).map(async (page) => new Uint8Array(await page.file.arrayBuffer())),
  );
}

/** The archive named after the scan: `photo 20.28.01-scan.zip`. */
export async function makeScanArchive(
  session: ScanSession,
  rest: Omit<ScanBundle, 'session' | 'pageBytes'>,
): Promise<File> {
  const pageBytes = await readPageBytes(session);
  const zip = bundleScan({ session, pageBytes, ...rest });
  const base = session.file.name.replace(/\.[^.]+$/, '') || 'scan';
  return new File([new Uint8Array(zip)], `${base}-scan.zip`, { type: 'application/zip' });
}
