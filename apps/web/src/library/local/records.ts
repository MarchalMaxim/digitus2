import type { ScanPage, ScanSession } from '../../scan/model.js';

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
function validSession(value: unknown): value is StoredSession {
  return (
    object(value) &&
    identity(value.id) &&
    validFile(value.file) &&
    notation(value) &&
    optionalText(value.recognizedAt) &&
    (value.pages === undefined ||
      (Array.isArray(value.pages) &&
        value.pages.length > 0 &&
        value.pages.length <= 20 &&
        value.pages.every(validPage) &&
        new Set(value.pages.map((page) => page.id)).size === value.pages.length))
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
