/**
 * Search over titles, composers, collections and shelf names (spec section 6.3; shelves spec
 * 4.4): "baroque" or "jazz" finds every piece on that shelf.
 */
import { shelfById, shelfOfGenre, type GenreId } from './levels.js';

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

/** Each piece's words, computed once per piece object. */
const haystacks = new WeakMap<object, string[]>();

/** The shelf name's words without the joining "and": "Folk and carols" -> folk, carols. */
function shelfWords(genre: GenreId | undefined): string[] {
  return genre === undefined
    ? []
    : words(shelfById(shelfOfGenre(genre)).name).filter((w) => w !== 'and');
}

function haystackOf(piece: Searchable): string[] {
  let h = haystacks.get(piece);
  if (h === undefined) {
    h = [
      ...words(`${piece.title} ${piece.composer} ${piece.collection}`),
      ...shelfWords(piece.genre),
    ];
    haystacks.set(piece, h);
  }
  return h;
}

/** Every query word starts some word of the piece's title, composer or collection. */
export function matchesQuery(piece: Searchable, query: string): boolean {
  const terms = words(query);
  if (terms.length === 0) return false;
  const haystack = haystackOf(piece);
  return terms.every((t) => haystack.some((w) => w.startsWith(t)));
}

/** The matching pieces, in the order given (manifest order). */
export function searchPieces<T extends Searchable>(pieces: readonly T[], query: string): T[] {
  return pieces.filter((p) => matchesQuery(p, query));
}
