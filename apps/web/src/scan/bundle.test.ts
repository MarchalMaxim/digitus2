import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  bundleScan,
  COMBINED_ENTRY,
  CORRECTED_ENTRY,
  makeScanArchive,
  pagesOf,
  readPageBytes,
  SUMMARY_ENTRY,
} from './bundle.js';
import type { ReviewFacts } from './facts.js';
import type { ScanSession } from './model.js';

const BUILD = { commit: 'c581d66', date: '2026-10-22T09:30:00.000Z' };
const AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
const JPEG = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9]);
const PDF = new TextEncoder().encode('%PDF-1.7 body');
/** What the review said about the scan below (issue 233). */
const REVIEW: ReviewFacts = {
  verdict: '2 pages · 12 bars · both hands · 1 place to check',
  usable: true,
  technical: [],
  places: [
    {
      text: 'Bar 3, right hand: the tie on A4 does not reach the next A4. It is played as two notes.',
      bar: '3',
    },
  ],
  corrections: 1,
  pages: ['0123456789abcdef0123456789abcdef', 'fedcba9876543210fedcba9876543210'],
};

const file = (bytes: Uint8Array, name: string, type: string) =>
  new File([new Uint8Array(bytes)], name, { type });

/** A camera scan of two pages that were recognised and combined. */
function twoPages(): ScanSession {
  const first = file(JPEG, 'photo 20.28.01.jpg', 'image/jpeg');
  const second = file(PNG, 'photo 20.28.40.png', 'image/png');
  return {
    id: 'scan-1',
    file: first,
    pages: [
      {
        id: 'p1',
        file: first,
        xml: '<score-partwise>one</score-partwise>',
        recognizer: 'homr',
        warnings: ['grand-staff'],
      },
      { id: 'p2', file: second, xml: '<score-partwise>two</score-partwise>', recognizer: 'homr' },
    ],
    xml: '<score-partwise>combined</score-partwise>',
    recognizedAt: '2026-10-22T20:30:00.000Z',
    recognizer: 'homr',
    warnings: ['grand-staff'],
    corrections: [{ kind: 'remove', note: 3 }],
  };
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

describe('bundleScan', () => {
  it('holds each page as the scanner received it, each recognition, the combined file and the summary', async () => {
    const session = twoPages();
    const zip = bundleScan({
      session,
      pageBytes: await readPageBytes(session),
      correctedXml: '<score-partwise>corrected</score-partwise>',
      warnings: ['grand-staff', 'from the importer'],
      build: BUILD,
      userAgent: AGENT,
    });
    const entries = unzip(zip);
    expect(Object.keys(entries).sort()).toEqual([
      'combined-recognized.musicxml',
      'corrected.musicxml',
      'page-1-recognized.musicxml',
      'page-1.jpg',
      'page-2-recognized.musicxml',
      'page-2.png',
      'scan.json',
    ]);
    // The images are byte for byte what the scanner got.
    expect(entries['page-1.jpg']).toEqual(JPEG);
    expect(entries['page-2.png']).toEqual(PNG);
    expect(strFromU8(entries['page-1-recognized.musicxml']!)).toBe(
      '<score-partwise>one</score-partwise>',
    );
    expect(strFromU8(entries['page-2-recognized.musicxml']!)).toBe(
      '<score-partwise>two</score-partwise>',
    );
    expect(strFromU8(entries[COMBINED_ENTRY]!)).toBe('<score-partwise>combined</score-partwise>');
    expect(strFromU8(entries[CORRECTED_ENTRY]!)).toBe('<score-partwise>corrected</score-partwise>');
  });

  it('says in scan.json what the scan did, what ran it and which pages it read', async () => {
    const session = twoPages();
    const entries = unzip(
      bundleScan({
        session,
        pageBytes: await readPageBytes(session),
        correctedXml: '<c/>',
        warnings: ['grand-staff', 'from the importer'],
        review: REVIEW,
        build: BUILD,
        userAgent: AGENT,
      }),
    );
    expect(JSON.parse(strFromU8(entries[SUMMARY_ENTRY]!))).toEqual({
      build: BUILD,
      userAgent: AGENT,
      recognizer: 'homr',
      recognizedAt: '2026-10-22T20:30:00.000Z',
      warnings: ['grand-staff', 'from the importer'],
      corrections: [{ kind: 'remove', note: 3 }],
      // What the review told the reader, in English: the archive is a validation case as it is.
      review: REVIEW,
      combined: 'combined-recognized.musicxml',
      corrected: 'corrected.musicxml',
      pages: [
        {
          entry: 'page-1.jpg',
          name: 'photo 20.28.01.jpg',
          type: 'image/jpeg',
          size: JPEG.length,
          recognized: 'page-1-recognized.musicxml',
          recognizer: 'homr',
          warnings: ['grand-staff'],
          error: null,
        },
        {
          entry: 'page-2.png',
          name: 'photo 20.28.40.png',
          type: 'image/png',
          size: PNG.length,
          recognized: 'page-2-recognized.musicxml',
          recognizer: 'homr',
          warnings: [],
          error: null,
        },
      ],
    });
  });

  it('leaves out what does not exist: the corrected copy, a page without recognition, the combined file', async () => {
    const failed = file(PNG, 'second.png', 'image/png');
    const session: ScanSession = {
      id: 'scan-2',
      file: failed,
      pages: [
        { id: 'p1', file: file(JPEG, 'first.jpg', 'image/jpeg'), xml: '<a/>' },
        { id: 'p2', file: failed, error: 'The scanner is busy.' },
      ],
    };
    const entries = unzip(
      bundleScan({
        session,
        pageBytes: await readPageBytes(session),
        warnings: [],
        build: BUILD,
        userAgent: AGENT,
      }),
    );
    expect(Object.keys(entries).sort()).toEqual([
      'page-1-recognized.musicxml',
      'page-1.jpg',
      'page-2.png',
      'scan.json',
    ]);
    const summary = JSON.parse(strFromU8(entries[SUMMARY_ENTRY]!)) as {
      combined: unknown;
      corrected: unknown;
      corrections: unknown;
      recognizer: unknown;
      review: unknown;
      pages: { recognized: unknown; error: unknown }[];
    };
    expect(summary.combined).toBeNull();
    expect(summary.corrected).toBeNull();
    expect(summary.corrections).toEqual([]);
    expect(summary.recognizer).toBeNull();
    expect(summary.review).toBeNull();
    expect(summary.pages.map((p) => [p.recognized, p.error])).toEqual([
      ['page-1-recognized.musicxml', null],
      [null, 'The scanner is busy.'],
    ]);
  });

  it('treats a session of one file as one page, whatever the type of the file', async () => {
    const pdf = file(PDF, 'sonata.pdf', 'application/pdf');
    const session: ScanSession = { id: 'scan-3', file: pdf, xml: '<score-partwise/>' };
    expect(pagesOf(session)).toHaveLength(1);
    const entries = unzip(
      bundleScan({
        session,
        pageBytes: await readPageBytes(session),
        warnings: [],
        build: BUILD,
        userAgent: AGENT,
      }),
    );
    expect(Object.keys(entries).sort()).toEqual([
      'combined-recognized.musicxml',
      'page-1-recognized.musicxml',
      'page-1.pdf',
      'scan.json',
    ]);
    expect(entries['page-1.pdf']).toEqual(PDF);
  });

  it('names a page by its name when the browser reports no type, and falls back to bin', async () => {
    const session: ScanSession = {
      id: 'scan-4',
      file: file(JPEG, 'IMG_0042.JPEG', ''),
      pages: [
        { id: 'p1', file: file(JPEG, 'IMG_0042.JPEG', '') },
        { id: 'p2', file: file(PNG, 'image', '') },
      ],
    };
    const entries = unzip(
      bundleScan({
        session,
        pageBytes: await readPageBytes(session),
        warnings: [],
        build: BUILD,
        userAgent: AGENT,
      }),
    );
    expect(Object.keys(entries).sort()).toEqual(['page-1.jpeg', 'page-2.bin', 'scan.json']);
  });

  it('refuses a page whose bytes were not read, rather than leaving it out silently', () => {
    expect(() =>
      bundleScan({
        session: twoPages(),
        pageBytes: [JPEG],
        warnings: [],
        build: BUILD,
        userAgent: AGENT,
      }),
    ).toThrow('page 2');
  });
});

describe('makeScanArchive', () => {
  it('makes a ZIP file named after the first page, holding the same entries', async () => {
    const session = twoPages();
    const archive = await makeScanArchive(session, {
      correctedXml: undefined,
      warnings: ['grand-staff'],
      build: BUILD,
      userAgent: AGENT,
    });
    expect(archive.name).toBe('photo 20.28.01-scan.zip');
    expect(archive.type).toBe('application/zip');
    const entries = unzip(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      'combined-recognized.musicxml',
      'page-1-recognized.musicxml',
      'page-1.jpg',
      'page-2-recognized.musicxml',
      'page-2.png',
      'scan.json',
    ]);
    expect(entries['page-1.jpg']).toEqual(JPEG);
  });
});
