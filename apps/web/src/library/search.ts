/**
 * Search over titles, composers, collections and shelf names (spec section 6.3; shelves spec
 * 4.4): "baroque" or "jazz" finds every piece on that shelf.
 */
import { shelfById, shelfOfGenre, type GenreId, type ShelfId } from './levels.js';

export interface Searchable {
  title: string;
  composer: string;
  collection: string;
  /** The catalog genre; its shelf's name joins the words searched. */
  genre?: GenreId;
}

/** Lower case, accents removed: "Für Élise" -> "fur elise". */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The folded words of a text, punctuation as separators. */
export function words(s: string): string[] {
  return foldText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '');
}

/** Each piece's own words (title, composer, collection), computed once per piece object. */
const haystacks = new WeakMap<object, string[]>();

/** The joining words of shelf names ("Folk and carols", "Folk en kerstliederen"): never searched. */
const JOINING_WORDS = new Set(['and', 'en', 'et', 'y', 'e']);

/** The words of a shelf name without its joining word: "Folk and carols" -> folk, carols. */
const shelfNames = new Map<string, string[]>();
function shelfWords(name: string): string[] {
  let found = shelfNames.get(name);
  if (found === undefined) {
    found = words(name).filter((w) => !JOINING_WORDS.has(w));
    shelfNames.set(name, found);
  }
  return found;
}

/** Names a shelf in the language on screen; the English name always searches too. */
export type ShelfNamer = (shelf: ShelfId) => string;

function haystackOf(piece: Searchable): string[] {
  let h = haystacks.get(piece);
  if (h === undefined) {
    h = words(`${piece.title} ${piece.composer} ${piece.collection}`);
    haystacks.set(piece, h);
  }
  return h;
}

function shelfHaystackOf(genre: GenreId | undefined, nameOf?: ShelfNamer): string[] {
  if (genre === undefined) return [];
  const shelf = shelfOfGenre(genre);
  const english = shelfWords(shelfById(shelf).name);
  const local = nameOf ? shelfWords(nameOf(shelf)) : [];
  return local.length > 0 ? [...english, ...local] : english;
}

/**
 * Every query word starts some word of the piece's title, composer or collection, or of its
 * shelf's name (in English, and in the language `shelfName` writes).
 */
export function matchesQuery(piece: Searchable, query: string, shelfName?: ShelfNamer): boolean {
  const terms = words(query);
  if (terms.length === 0) return false;
  const own = haystackOf(piece);
  const shelf = shelfHaystackOf(piece.genre, shelfName);
  return terms.every((t) => own.some((w) => w.startsWith(t)) || shelf.some((w) => w.startsWith(t)));
}

/** The matching pieces, in the order given (manifest order). */
export function searchPieces<T extends Searchable>(
  pieces: readonly T[],
  query: string,
  shelfName?: ShelfNamer,
): T[] {
  return pieces.filter((p) => matchesQuery(p, query, shelfName));
}
