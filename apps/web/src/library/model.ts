/**
 * What the library page shows, as a pure function of the manifest and the reader's choices
 * (spec sections 5 and 6). The React views only render it.
 */
import {
  GENRE_MIN,
  GENRES_ABOVE,
  OTHER_BELOW,
  showsHeadings,
  showsPills,
  showsSearch,
} from './disclosure.js';
import { GENRES, type GenreId, type Level } from './levels.js';
import { searchPieces, words } from './search.js';

/** The fields of a manifest entry the library page reads. */
export interface LibraryEntry {
  slug: string;
  title: string;
  composer: string;
  level: Level;
  collection: string;
  collectionId: string;
  genre: GenreId;
  approxDurationSec: number;
}

export interface Row {
  slug: string;
  /** The title shown: shortened under its own collection heading (`shortTitle`). */
  title: string;
  /** The gray second line, or null when it would say nothing the page does not. */
  composerLine: string | null;
  /** The accessible name: `Open {full title} by {full composer}`. */
  label: string;
  duration: string;
}

/** A collection heading with its rows, "Other pieces", or a flat list (`heading` null). */
export interface Group {
  key: string;
  heading: string | null;
  rows: Row[];
}

/** One level of an all-levels list or of search results. */
export interface Section {
  level: Level;
  count: number;
  groups: Group[];
}

export type LibraryLayout =
  | { kind: 'all'; sections: Section[] }
  | { kind: 'level'; levels: Level[]; level: Level; count: number; groups: Group[] }
  | { kind: 'search'; query: string; count: number; sections: Section[] };

export const OTHER_PIECES = 'Other pieces';

/** 29 -> '0:29', 132.3 -> '2:12' (whole seconds, truncated). */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function countText(n: number): string {
  return n === 1 ? '1 piece' : `${n} pieces`;
}

/** The composer up to the first " (": "Lowell Mason (tune Antioch)" -> "Lowell Mason". */
export function composerShort(composer: string): string {
  const i = composer.indexOf(' (');
  return (i < 0 ? composer : composer.slice(0, i)).trim();
}

/** "Traditional", "Traditional (…)" and "Anonymous": no name worth a line of its own. */
export function isUnnamed(composer: string): boolean {
  return /^(Traditional|Anonymous)\b/.test(composer);
}

/**
 * Under its own collection heading, a title ending in a parenthesis whose first comma-separated
 * part is made of words the heading already holds loses that part: "Melody (Album for the Young,
 * No. 1)" under "Schumann, Album for the Young, Op. 68" -> "Melody (No. 1)".
 */
export function shortTitle(title: string, heading: string): string {
  const m = /^(.*) \(([^()]*)\)$/.exec(title);
  if (!m) return title;
  const base = m[1]!;
  const parts = m[2]!.split(',').map((s) => s.trim());
  const first = words(parts[0]!);
  const said = new Set(words(heading));
  if (first.length === 0 || !first.every((w) => said.has(w))) return title;
  const rest = parts.slice(1).join(', ');
  return rest === '' ? base : `${base} (${rest})`;
}

/** "Für Elise (Bagatelle in A minor)" -> "Für Elise": for the Continue button. */
export function dropTrailingParenthesis(title: string): string {
  return title.replace(/\s*\([^()]*\)$/, '');
}

export function levelsIn(pieces: readonly LibraryEntry[]): Level[] {
  return [...new Set(pieces.map((p) => p.level))].sort((a, b) => a - b);
}

interface Draft {
  piece: LibraryEntry;
  title: string;
  /** Under a heading that names the group's one composer. */
  composerSaid: boolean;
}

interface DraftGroup {
  key: string;
  heading: string | null;
  drafts: Draft[];
}

function lastNameWord(composer: string): string | undefined {
  return words(composerShort(composer)).at(-1);
}

/** One list section's groups, in manifest order (spec 6.2). */
function draftGroups(pieces: readonly LibraryEntry[]): DraftGroup[] {
  const flat = (): DraftGroup[] => [
    {
      key: 'flat',
      heading: null,
      drafts: pieces.map((p) => ({ piece: p, title: p.title, composerSaid: false })),
    },
  ];
  if (!showsHeadings(pieces.length)) return flat();
  const byCollection = new Map<string, LibraryEntry[]>();
  for (const p of pieces) {
    const members = byCollection.get(p.collectionId);
    if (members) members.push(p);
    else byCollection.set(p.collectionId, [p]);
  }
  const groups: DraftGroup[] = [];
  const other: LibraryEntry[] = [];
  for (const [id, members] of byCollection) {
    if (members.length < OTHER_BELOW) {
      other.push(...members);
      continue;
    }
    const heading = members[0]!.collection;
    const composers = new Set(members.map((p) => composerShort(p.composer)));
    const only = composers.size === 1 ? members[0]!.composer : null;
    const last = only === null || isUnnamed(only) ? undefined : lastNameWord(only);
    const composerSaid = last !== undefined && words(heading).includes(last);
    groups.push({
      key: id,
      heading,
      drafts: members.map((p) => ({ piece: p, title: shortTitle(p.title, heading), composerSaid })),
    });
  }
  if (groups.length === 0) return flat();
  if (other.length > 0) {
    groups.push({
      key: 'other',
      heading: OTHER_PIECES,
      drafts: other.map((p) => ({ piece: p, title: p.title, composerSaid: false })),
    });
  }
  return groups;
}

/** Turns drafts into rows; a title shown twice anywhere in view keeps its composer on both rows. */
function finish(sections: DraftGroup[][]): Group[][] {
  const seen = new Map<string, number>();
  for (const groups of sections)
    for (const g of groups)
      for (const d of g.drafts) seen.set(d.title, (seen.get(d.title) ?? 0) + 1);
  return sections.map((groups) =>
    groups.map((g) => ({
      key: g.key,
      heading: g.heading,
      rows: g.drafts.map(({ piece, title, composerSaid }) => ({
        slug: piece.slug,
        title,
        composerLine:
          (seen.get(title) ?? 0) > 1
            ? composerShort(piece.composer)
            : isUnnamed(piece.composer) || composerSaid
              ? null
              : composerShort(piece.composer),
        label: `Open ${piece.title} by ${piece.composer}`,
        duration: formatDuration(piece.approxDurationSec),
      })),
    })),
  );
}

function sectionsOf(pieces: readonly LibraryEntry[]): Section[] {
  const levels = levelsIn(pieces);
  const members = levels.map((l) => pieces.filter((p) => p.level === l));
  const groups = finish(members.map(draftGroups));
  return levels.map((level, i) => ({ level, count: members[i]!.length, groups: groups[i]! }));
}

/** The page's list for the library, the chosen level and the search text (spec 6.2). */
export function libraryLayout(
  pieces: readonly LibraryEntry[],
  { level, query }: { level: Level | null; query: string },
): LibraryLayout {
  const q = query.trim();
  if (q !== '' && showsSearch(pieces.length)) {
    const found = searchPieces(pieces, q);
    return { kind: 'search', query: q, count: found.length, sections: sectionsOf(found) };
  }
  if (!showsPills(pieces.length)) return { kind: 'all', sections: sectionsOf(pieces) };
  const levels = levelsIn(pieces);
  const chosen = level !== null && levels.includes(level) ? level : levels[0]!;
  const inLevel = pieces.filter((p) => p.level === chosen);
  return {
    kind: 'level',
    levels,
    level: chosen,
    count: inLevel.length,
    groups: finish([draftGroups(inLevel)])[0]!,
  };
}

export interface StartTarget {
  piece: LibraryEntry;
  /** True when the piece is the reader's last one played (Continue), false for the first piece. */
  continuing: boolean;
}

/** The red button's piece: the last one played while it is in the library, else the first piece of the lowest level. */
export function startTarget(
  pieces: readonly LibraryEntry[],
  lastPlayed: string | null,
): StartTarget {
  const last = lastPlayed === null ? undefined : pieces.find((p) => p.slug === lastPlayed);
  if (last) return { piece: last, continuing: true };
  const lowest = levelsIn(pieces)[0];
  return { piece: pieces.find((p) => p.level === lowest)!, continuing: false };
}

export function startLabel(target: StartTarget): string {
  return target.continuing
    ? `Continue with ${dropTrailingParenthesis(target.piece.title)}`
    : `Start with ${target.piece.title}`;
}

/** The level the pills open on: chosen in this visit, else the last piece's, else the lowest. */
export function arrivalLevel(
  pieces: readonly LibraryEntry[],
  chosen: Level | null,
  lastPlayed: string | null,
): Level {
  const levels = levelsIn(pieces);
  if (chosen !== null && levels.includes(chosen)) return chosen;
  const last = lastPlayed === null ? undefined : pieces.find((p) => p.slug === lastPlayed);
  return last ? last.level : levels[0]!;
}

/** The genre pills of a level (spec 6.1): none unless it is long and two genres hold enough of it. */
export function genrePills(levelPieces: readonly LibraryEntry[]): GenreId[] {
  if (levelPieces.length <= GENRES_ABOVE) return [];
  const counts = new Map<GenreId, number>();
  for (const p of levelPieces) counts.set(p.genre, (counts.get(p.genre) ?? 0) + 1);
  const ids = GENRES.map((g) => g.id).filter((id) => (counts.get(id) ?? 0) >= GENRE_MIN);
  return ids.length >= 2 ? ids : [];
}
