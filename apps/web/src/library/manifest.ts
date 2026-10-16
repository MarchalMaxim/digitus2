import indexUrl from '../../../../content/library-index.json?url';
import manifestUrl from '../../../../content/manifest.json?url';
import type { GenreId, Grade } from './levels.js';
import type { LibraryEntry } from './model.js';

export type { GenreId, Grade } from './levels.js';
export { formatDuration } from './model.js';
export type { LibraryEntry } from './model.js';

export interface PieceSourceInfo {
  name: string;
  url: string;
  license: string;
  licenseUrl: string;
  retrievedAt: string | null;
  files?: string;
  mutopiaId?: string;
  typesetter?: string;
  edition?: string;
  lilypondVersion?: string;
}
export interface LibraryPiece {
  slug: string;
  title: string;
  composer: string;
  composerDates: string | null;
  catalogue: string | null;
  year: string | null;
  /** The grade, 1 to 6; the page shows its tier (levels.ts `tierOf`). */
  level: Grade;
  /** The collection's title, e.g. "Children's songs" (catalog.json `collections`). */
  collection: string;
  /** A stable kebab-case id for the collection, e.g. "children-songs". */
  collectionId: string;
  /** The genre id (catalog.json `genres`): the collection's, or the piece's own override. */
  genre: GenreId;
  /** "core30" for the 30 pieces of the first library (the engine's benchmark set); null otherwise. */
  benchmarkSet: string | null;
  measures: number;
  approxDurationSec: number;
  timeSignature: string;
  key: string;
  tempoBpm: number;
  source: PieceSourceInfo;
  arranger: string | null;
  hasEditorialFingering: boolean;
  excerpt: string | null;
  notes: string;
  files: { score: string; fingered: string | null };
}

/**
 * content/library-index.json as written by content/tools/build.py (library_index): the eight fields
 * the list reads, in a compact columnar form. Each collection's id, title and genre are stored once;
 * `pieces` holds one parallel column per field, in manifest order.
 */
export interface LibraryIndexFile {
  v: number;
  /** [id, title, genre] per collection. */
  collections: ReadonlyArray<readonly string[]>;
  pieces: {
    /** An archive piece's slug is stored as "-" + its 8 hash characters (see slugOf); any other whole. */
    slug: readonly string[];
    title: readonly string[];
    composer: readonly string[];
    level: readonly number[];
    /** Index into `collections`. */
    collection: readonly number[];
    /** Whole seconds. */
    duration: readonly number[];
  };
  /** Piece index -> genre, for the pieces whose genre differs from their collection's. */
  genres: Readonly<Record<string, string>>;
}

/** The slug build.py's pdmx_fragments.ascii_slug makes of a title (at most 40 characters). */
function asciiSlug(title: string): string {
  const folded = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return folded.slice(0, 40).replace(/-+$/, '') || 'untitled';
}

/** A piece's slug: "-0f933bca" is an archive piece, "pdmx-" + the slug of its title + "-0f933bca". */
function slugOf(stored: string, title: string): string {
  return stored.startsWith('-') ? `pdmx-${asciiSlug(title)}${stored}` : stored;
}

/** The library list's entries (the eight LibraryEntry fields, in manifest order) from the index file. */
export function decodeLibraryIndex(file: LibraryIndexFile): LibraryEntry[] {
  if (file.v !== 2) throw new Error(`unknown library list version ${String(file.v)}`);
  const { slug, title, composer, level, collection, duration } = file.pieces;
  return slug.map((stored, i) => {
    const [collectionId, collectionTitle, collectionGenre] = file.collections[collection[i]!]!;
    return {
      slug: slugOf(stored, title[i]!),
      title: title[i]!,
      composer: composer[i]!,
      level: level[i]! as Grade,
      collection: collectionTitle!,
      collectionId: collectionId!,
      genre: (file.genres[i] ?? collectionGenre!) as GenreId,
      approxDurationSec: duration[i]!,
    };
  });
}

/**
 * The library list: content/library-index.json, the eight fields the list reads, in manifest order.
 * It is fetched once before the app renders (main.tsx), not bundled: the 2,700-piece index is about
 * 80 KB gzip, over the start-up bundle budget. The full entries load on demand (loadPieceDetails).
 */
let index: readonly LibraryEntry[] | null = null;
let indexBySlug = new Map<string, LibraryEntry>();

/** Sets the library list (the tests inject theirs; loadLibraryIndex fetches it). */
export function setLibraryIndex(entries: readonly LibraryEntry[]): void {
  index = entries;
  indexBySlug = new Map(entries.map((p) => [p.slug, p]));
}

/** Fetches the library list once; the app waits for it before it renders. */
export async function loadLibraryIndex(): Promise<void> {
  if (index) return;
  const response = await fetch(indexUrl);
  if (!response.ok)
    throw new Error(`the library list could not be loaded (HTTP ${response.status})`);
  setLibraryIndex(decodeLibraryIndex((await response.json()) as LibraryIndexFile));
}

/** The library's pieces in manifest order. Only after loadLibraryIndex has resolved. */
export function libraryPieces(): readonly LibraryEntry[] {
  if (!index) throw new Error('the library list has not loaded yet (loadLibraryIndex)');
  return index;
}

let details: Promise<Map<string, LibraryPiece>> | null = null;

/** Sets every piece's full entry (the tests inject theirs; loadPieceDetails fetches it). */
export function setPieceDetails(entries: readonly LibraryPiece[]): void {
  details = Promise.resolve(new Map(entries.map((p) => [p.slug, p])));
}

/**
 * Every piece's full entry (content/manifest.json), fetched once on first use. Fetched as JSON,
 * not imported as a module: a 3 MB JSON module keeps its source text and the string it parses
 * alive for the page's lifetime (about 12 MB of heap); a fetched file keeps only the entries.
 * A failed fetch is forgotten, so the next use tries again.
 */
export function loadPieceDetails(): Promise<Map<string, LibraryPiece>> {
  if (details) return details;
  const loading = fetch(manifestUrl).then(async (response) => {
    if (!response.ok)
      throw new Error(`the library details could not be loaded (HTTP ${response.status})`);
    const entries = (await response.json()) as LibraryPiece[];
    return new Map(entries.map((p) => [p.slug, p]));
  });
  loading.catch(() => {
    if (details === loading) details = null;
  });
  return (details = loading);
}

/** A piece's library entry by slug: the URL and the list need no more than this. */
export function pieceBySlug(slug: string): LibraryEntry | undefined {
  return indexBySlug.get(slug);
}

/** A piece's full entry (sources, notes, file paths), loaded on demand. */
export async function loadPiece(slug: string): Promise<LibraryPiece | undefined> {
  return (await loadPieceDetails()).get(slug);
}

/**
 * Resolves a manifest path such as 'scores/x.musicxml' (or 'scores/x.musicxml.gz', a PDMX piece) to
 * its asset URL (lazy, per file). A .gz file holds gzip bytes: see readScoreFile.
 */
export async function scoreUrl(relativePath: string): Promise<string> {
  const { scoreFiles } = await import('./scoreFiles.js');
  const loader = scoreFiles[`../../../../content/${relativePath}`];
  if (!loader) throw new Error(`no score file ${relativePath}`);
  return loader();
}

/**
 * The bytes of a score file. A PDMX piece is stored as gzip (`.musicxml.gz`), but a server may send
 * such a file with `Content-Encoding: gzip` (the Vite servers do), and then the browser has already
 * decompressed it. So the bytes decide, not the extension: bytes that start with the gzip signature
 * are decompressed with the browser's gzip stream, anything else is returned as it is.
 * `fetchBytes` fetches the asset URL (the tests inject their own).
 */
export async function readScoreFile(
  relativePath: string,
  fetchBytes: (url: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const bytes = await fetchBytes(await scoreUrl(relativePath));
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function isShareAlike(p: LibraryPiece): boolean {
  return p.source.license.startsWith('CC-BY-SA');
}

/** CC BY and CC BY-SA engravings: their licences require the typesetter and licence credited. */
export function requiresCredit(p: LibraryPiece): boolean {
  return p.source.license.startsWith('CC-BY');
}

/** 'CC-BY-SA-2.5' -> 'CC BY-SA 2.5', 'CC0-1.0' -> 'CC0 1.0'. */
export function licenseLabel(id: string): string {
  return id.replace(/^CC-/, 'CC ').replace(/-(\d)/, ' $1');
}

function isOwnArrangement(p: LibraryPiece): boolean {
  return p.source.name.startsWith('digitus2');
}

function isMutopia(p: LibraryPiece): boolean {
  return p.source.name === 'The Mutopia Project' || p.source.mutopiaId !== undefined;
}

export function attribution(p: LibraryPiece): { text: string; url: string | null } {
  if (isOwnArrangement(p)) {
    return { text: 'digitus2 arrangement, CC0 (public domain)', url: p.source.licenseUrl };
  }
  if (isMutopia(p)) {
    const by = p.source.typesetter ?? 'an unnamed typesetter';
    if (requiresCredit(p)) {
      return {
        text: `Engraving by ${by} for the Mutopia Project, ${licenseLabel(p.source.license)}`,
        url: p.source.licenseUrl,
      };
    }
    return { text: `Engraving by ${by} for the Mutopia Project, public domain`, url: p.source.url };
  }
  // No library piece takes this branch today; it keeps a future source credited rather than blank.
  return { text: `${p.source.name}, ${licenseLabel(p.source.license)}`, url: p.source.url };
}
