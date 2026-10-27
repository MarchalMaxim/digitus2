import type { Correction } from '../../scan/corrections.js';
import type { PendingRetake, ScanPage, ScanSession } from '../../scan/model.js';

interface StoredFile {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
}
interface StoredPage {
  id: string;
  file: StoredFile;
  originalFile?: StoredFile | undefined;
  quarterTurns?: 0 | 1 | 2 | 3 | undefined;
  xml?: string | undefined;
  warnings?: string[] | undefined;
  recognizer?: string | undefined;
}
interface StoredSession {
  id: string;
  file: StoredFile;
  pages?: StoredPage[] | undefined;
  xml?: string | undefined;
  recognizedAt?: string | undefined;
  recognizer?: string | undefined;
  warnings?: string[] | undefined;
  /** The reader's corrections of `xml`; the raw `xml` itself is kept unchanged. */
  corrections?: Correction[] | undefined;
  /** A page photographed again, not recognised yet: what its corrections are carried from. */
  retake?: PendingRetake | undefined;
}
export type LocalScoreRecord = {
  version: 1;
  id: string;
  updatedAt: number;
} & ({ kind: 'scan'; session: StoredSession } | { kind: 'file'; name: string; blob: Blob });

const storeFile = (file: File): StoredFile => ({
  blob: file,
  name: file.name,
  type: file.type,
  lastModified: file.lastModified,
});
const restoreFile = (file: StoredFile): File =>
  new File([file.blob], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });

/** Explicit fields exclude connection credentials, active job IDs and transient errors. */
export function storeSession(session: ScanSession): StoredSession {
  return {
    id: session.id,
    file: storeFile(session.file),
    xml: session.xml,
    recognizedAt: session.recognizedAt,
    recognizer: session.recognizer,
    warnings: session.warnings,
    corrections: session.corrections?.map((c) => ({ ...c })),
    retake: session.retake && {
      xml: session.retake.xml,
      corrections: session.retake.corrections.map((c) => ({ ...c })),
      pages: [...session.retake.pages],
    },
    pages: session.pages?.map((page) => ({
      id: page.id,
      file: storeFile(page.file),
      originalFile: page.originalFile ? storeFile(page.originalFile) : undefined,
      quarterTurns: page.quarterTurns,
      xml: page.xml,
      warnings: page.warnings,
      recognizer: page.recognizer,
    })),
  };
}
export function restoreSession(session: StoredSession): ScanSession {
  return {
    id: session.id,
    xml: session.xml,
    recognizedAt: session.recognizedAt,
    recognizer: session.recognizer,
    warnings: session.warnings,
    corrections: session.corrections,
    retake: session.retake,
    file: restoreFile(session.file),
    pages: session.pages?.map((page): ScanPage => ({
      id: page.id,
      xml: page.xml,
      warnings: page.warnings,
      recognizer: page.recognizer,
      quarterTurns: page.quarterTurns,
      file: restoreFile(page.file),
      originalFile: page.originalFile ? restoreFile(page.originalFile) : undefined,
    })),
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const optionalText = (value: unknown) => value === undefined || text(value);
const warnings = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.every(text));
const identity = (value: unknown) => text(value) && value.length > 0 && value.length < 2048;
function validFile(value: unknown): value is StoredFile {
  return (
    object(value) &&
    value.blob instanceof Blob &&
    value.blob.size > 0 &&
    identity(value.name) &&
    text(value.type) &&
    typeof value.lastModified === 'number' &&
    Number.isFinite(value.lastModified)
  );
}
function notation(value: Record<string, unknown>): boolean {
  return optionalText(value.xml) && optionalText(value.recognizer) && warnings(value.warnings);
}
function validPage(value: unknown): value is StoredPage {
  return (
    object(value) &&
    identity(value.id) &&
    validFile(value.file) &&
    (value.originalFile === undefined || validFile(value.originalFile)) &&
    (value.quarterTurns === undefined || [0, 1, 2, 3].includes(value.quarterTurns as number)) &&
    notation(value)
  );
}
const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const TYPES = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'];
const int = (value: unknown, min: number, max: number) =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
/** One correction exactly as the editor writes it (corrections.ts); anything else is refused. */
function validCorrection(value: unknown): value is Correction {
  if (!object(value)) return false;
  const keys = Object.keys(value).sort().join(',');
  if (value.kind === 'meter')
    return (
      keys === 'bar,beatType,beats,kind' &&
      int(value.bar, 0, 1_000_000) &&
      int(value.beats, 1, 32) &&
      [1, 2, 4, 8, 16, 32].includes(value.beatType as number)
    );
  if (!int(value.note, 0, 1_000_000)) return false;
  switch (value.kind) {
    case 'pitch':
      return (
        keys === 'alter,kind,note,octave,step' &&
        STEP_NAMES.includes(value.step as string) &&
        int(value.alter, -2, 2) &&
        int(value.octave, 0, 9)
      );
    case 'duration':
      return (
        keys === 'dots,kind,note,type' &&
        TYPES.includes(value.type as string) &&
        int(value.dots, 0, 1)
      );
    case 'tie':
      return (
        (keys === 'kind,note,tied' || keys === 'kind,note,side,tied') &&
        typeof value.tied === 'boolean' &&
        (value.side === undefined || value.side === 'next' || value.side === 'previous')
      );
    case 'hand':
      return keys === 'kind,note,staff' && int(value.staff, 1, 64);
    case 'remove':
      return keys === 'kind,note';
    default:
      return false;
  }
}
const validCorrections = (value: unknown) =>
  Array.isArray(value) && value.length <= 10_000 && value.every(validCorrection);
/** A pending retake names pages of the session and holds the recognition it was made from. */
function validRetake(value: unknown, pageCount: number): value is PendingRetake {
  return (
    object(value) &&
    Object.keys(value).sort().join(',') === 'corrections,pages,xml' &&
    text(value.xml) &&
    value.xml.length > 0 &&
    validCorrections(value.corrections) &&
    Array.isArray(value.pages) &&
    value.pages.length > 0 &&
    value.pages.length <= 20 &&
    value.pages.every((page) => int(page, 0, pageCount - 1)) &&
    new Set(value.pages).size === value.pages.length
  );
}
function validSession(value: unknown): value is StoredSession {
  return (
    object(value) &&
    identity(value.id) &&
    validFile(value.file) &&
    notation(value) &&
    (value.corrections === undefined || validCorrections(value.corrections)) &&
    optionalText(value.recognizedAt) &&
    (value.pages === undefined ||
      (Array.isArray(value.pages) &&
        value.pages.length > 0 &&
        value.pages.length <= 20 &&
        value.pages.every(validPage) &&
        new Set(value.pages.map((page) => page.id)).size === value.pages.length)) &&
    (value.retake === undefined ||
      (Array.isArray(value.pages) && validRetake(value.retake, value.pages.length)))
  );
}
/** Unsupported versions or malformed rows cannot enter app state. */
export function isLocalScoreRecord(value: unknown): value is LocalScoreRecord {
  return (
    object(value) &&
    value.version === 1 &&
    identity(value.id) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    ((value.kind === 'file' &&
      identity(value.name) &&
      value.blob instanceof Blob &&
      value.blob.size > 0) ||
      (value.kind === 'scan' && validSession(value.session)))
  );
}
