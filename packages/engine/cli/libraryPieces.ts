import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readLibraryScore } from './libraryScore.js';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import type { Score } from '../src/score/types.js';
import { editorDigits } from '../src/readability/editorDigits.js';
import type { EditorDigits } from '../src/readability/editorDigits.js';

/**
 * The library pieces the readability tests and the `editorDigits` script read: the manifest's
 * entries, the plain score of an entry and the edition's file of one with an editorial fingering.
 * Node only (the tests and the CLI); the app never imports this.
 */
export interface LibraryEntry {
  slug: string;
  level: number;
  benchmarkSet?: string | null;
  hasEditorialFingering: boolean;
  editorDigits?: number;
  files: { score: string; fingered: string | null };
}

export const REPO = new URL('../../../', import.meta.url);
export const MANIFEST_PATH = fileURLToPath(new URL('content/manifest.json', REPO));

const contentPath = (rel: string): string => fileURLToPath(new URL(`content/${rel}`, REPO));

export function readManifest(): LibraryEntry[] {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as LibraryEntry[];
}

export function readPlainScore(entry: LibraryEntry): Score {
  return parseMusicXml(readLibraryScore(contentPath(entry.files.score))).score;
}

/** The edition's MusicXML text, or null for an entry without one. */
export function readFingeredXml(entry: LibraryEntry): string | null {
  return entry.files.fingered === null ? null : readLibraryScore(contentPath(entry.files.fingered));
}

/** The digits the edition prints on an entry's plain score (`editorDigits`); null without an edition. */
export function countEditorDigits(entry: LibraryEntry): EditorDigits | null {
  const xml = readFingeredXml(entry);
  return xml === null ? null : editorDigits(readPlainScore(entry), xml);
}
