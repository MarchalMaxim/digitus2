/**
 * What the library page shows, as a pure function of the manifest and the reader's choices
 * (shelves spec, sections 4 and 5; UI batch spec, sections 5 and 6). The React views only render it.
 */
import type { Messages } from '../i18n/messages.js';
import {
  OTHER_BELOW,
  PAGE_SIZE,
  SAMPLES,
  SECTION_ROWS,
  showsHeadings,
  showsLengths,
  showsPills,
  showsSearch,
} from './disclosure.js';
import {
  LENGTHS,
  SHELVES,
  TIERS,
  shelfOfGenre,
  tierOf,
  type GenreId,
  type Grade,
  type Length,
  type LengthId,
  type ShelfId,
  type Tier,
} from './levels.js';
import { foldText, searchPieces, words } from './search.js';

/** The fields of a manifest entry the library page reads. */
export interface LibraryEntry {
  slug: string;
  title: string;
  composer: string;
  /** The manifest's grade, 1 to 6; the page shows its tier (`tierOf`). */
  level: Grade;
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

/** The one text button under a list: `All 312 in Medium` opens a search section, `Show 40 more` pages it. */
export interface ListAction {
  kind: 'open' | 'more';
  label: string;
}

/** One tier of the small library's list or of search results. */
export interface Section {
  tier: Tier;
  count: number;
  groups: Group[];
  /** Rows shown, across the groups. */
  shown: number;
  /** A search section opened to pages of 40. */
  open: boolean;
  action: ListAction | null;
}

/** One shelf on the arrival page: its name, count, line and a few sample rows. */
export interface ShelfSummary {
  id: ShelfId;
  name: string;
  line: string;
  count: number;
  rows: Row[];
  /** `All 145 songs`, or null when the rows are the whole shelf. */
  all: string | null;
}

/** The pills above a long list: only the lengths the list holds, `Any length` first. */
export type LengthOptions = readonly Length[];

export type LibraryLayout =
  /** A library of 40 pieces or fewer: every tier, each flat. */
  | { kind: 'all'; sections: Section[] }
  /** The arrival page: the chosen tier's shelves with sample rows. */
  | { kind: 'shelves'; tiers: Tier[]; tier: Tier; count: number; shelves: ShelfSummary[] }
  /** One shelf opened in place, in pages of 40. */
  | {
      kind: 'shelf';
      tiers: Tier[];
      tier: Tier;
      shelf: ShelfId;
      name: string;
      count: number;
      groups: Group[];
      shown: number;
      more: string | null;
      /** The length pills, or null; `length` is the choice in effect (always 'any' without pills). */
      lengths: LengthOptions | null;
      length: LengthId;
    }
  | {
      kind: 'search';
      query: string;
      count: number;
      sections: Section[];
      lengths: LengthOptions | null;
      length: LengthId;
    };

/** What the reader has chosen, as the store holds it (visit state), and the day for the samples. */
export interface LibraryChoices {
  tier: Tier | null;
  query: string;
  /** The open shelf, when no search is typed. */
  shelf?: ShelfId | null;
  /** The open search section, when a search is typed. */
  section?: Tier | null;
  /** Pages of 40 shown of the open shelf or section, 1 or more. */
  pages?: number;
  length?: LengthId;
  /** The local date `YYYY-MM-DD`: the samples change once a day (`localDateKey`). */
  date: string;
  lastPlayed?: string | null;
}

/** 29 -> '0:29', 132.3 -> '2:12' (whole seconds, truncated). */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** The local date as `YYYY-MM-DD`: the day the samples are drawn for. */
export function localDateKey(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A credit that starts right after a lowercase letter: the MuseScore archive joins a score's credit
 * lines with nothing between them ("Johann Sebastian Bachattributed to Christian Petzold"). Only
 * these words count, so names written in camel case ("ConcernedApe") stay whole.
 */
const GLUED_CREDIT =
  /(?<=\p{Ll})(?=(?:attributed|arranged) (?:to|by)\b|(?:Arr|Arrang|Trans)\.|(?:Arr|Arranged|Arrangement|Transcribed|Transcripted|Bearbeitung|Edited|Simplified|Rewritten)\b)/gu;

/** The composer as the archive meant it: a comma before a glued credit, a space before a glued "(". */
export function composerText(composer: string): string {
  return composer.replace(GLUED_CREDIT, ', ').replace(/(?<=\p{L})\(/gu, ' (');
}

/** The composer up to the first " (": "Lowell Mason (tune Antioch)" -> "Lowell Mason". */
export function composerShort(composer: string): string {
  const text = composerText(composer);
  const i = text.indexOf(' (');
  return (i < 0 ? text : text.slice(0, i)).trim();
}

/** "Unknown", "Traditional", "Traditional (…)" and "Anonymous": no name worth a line of its own. */
export function isUnnamed(composer: string): boolean {
  return /^(Unknown|Traditional|Anonymous)\b/.test(composer);
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

/** The tiers that hold at least one piece, easiest first. */
export function tiersIn(pieces: readonly LibraryEntry[]): Tier[] {
  const present = new Set(pieces.map((p) => tierOf(p.level)));
  return TIERS.filter((t) => present.has(t));
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

const plain = (piece: LibraryEntry): Draft => ({ piece, title: piece.title, composerSaid: false });

/** One list's groups, in manifest order (UI batch spec 6.2). */
function draftGroups(pieces: readonly LibraryEntry[], t: Messages): DraftGroup[] {
  const flat = (): DraftGroup[] => [{ key: 'flat', heading: null, drafts: pieces.map(plain) }];
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
    groups.push({ key: 'other', heading: t.library.list.otherPieces, drafts: other.map(plain) });
  }
  return groups;
}

/** The first `n` rows of the groups, a group left empty dropped: a page of a long list. */
function firstRows(groups: DraftGroup[], n: number): DraftGroup[] {
  const out: DraftGroup[] = [];
  let left = n;
  for (const g of groups) {
    if (left <= 0) break;
    const drafts = g.drafts.slice(0, left);
    left -= drafts.length;
    out.push({ ...g, drafts });
  }
  return out;
}

/**
 * Turns drafts into rows; a title shown twice anywhere in view keeps its composer on both rows.
 * `counted` is what "in view" means when it is more than what is drawn: an opened list counts
 * its unshown pages too, so a row does not gain a composer line when the next page arrives.
 */
function finish(
  sections: DraftGroup[][],
  t: Messages,
  counted: DraftGroup[][] = sections,
): Group[][] {
  const seen = new Map<string, number>();
  for (const groups of counted)
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
        label: t.library.list.openPiece(piece.title, composerText(piece.composer)),
        duration: formatDuration(piece.approxDurationSec),
      })),
    })),
  );
}

const rowCount = (groups: readonly { rows: readonly unknown[] }[]): number =>
  groups.reduce((n, g) => n + g.rows.length, 0);

/** `Show 40 more`, or `Show the last 17` when the next page is the final one. */
export function moreLabel(remaining: number, t: Messages): string {
  return remaining > PAGE_SIZE
    ? t.library.list.showMore(PAGE_SIZE)
    : t.library.list.showLast(remaining);
}

/** The pages asked for as a row count (at least one page). */
const pageRows = (pages: number | undefined): number =>
  Math.max(1, Math.floor(pages ?? 1)) * PAGE_SIZE;

// -- samples (shelves spec 4.1) -------------------------------------------------------------

/** FNV-1a of the text: the seed of the day's shuffle. */
function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32): the same seed always draws the same sequence. */
function randomFrom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const random = randomFrom(seedOf(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The composer's name for the one-per-composer rule; null for "Unknown", Traditional and Anonymous. */
function namedComposer(composer: string): string | null {
  const name = composerShort(composer);
  return name === '' || name === 'Unknown' || isUnnamed(composer) ? null : foldText(name);
}

/** Curated collections (hand-picked, ids not starting `pdmx-`) against the MuseScore archive's. */
const isCurated = (p: LibraryEntry): boolean => !p.collectionId.startsWith('pdmx-');

/**
 * The shelf's sample rows (spec 4.1): at most 5 pieces drawn by a shuffle seeded with `seed`,
 * no composer twice (unnamed ones never count), at most 2 per collection, hand-picked
 * collections first for the first two picks; any gap is filled from the shuffle. Shown
 * shortest first, after `first` (the last piece played) when the shelf holds it.
 */
export function sampleShelf(
  members: readonly LibraryEntry[],
  seed: string,
  first: LibraryEntry | null = null,
): LibraryEntry[] {
  const order = shuffled(
    members.filter((p) => p !== first),
    seed,
  );
  const taken: LibraryEntry[] = [];
  const composers = new Set<string>();
  const perCollection = new Map<string, number>();
  const take = (p: LibraryEntry) => {
    taken.push(p);
    const name = namedComposer(p.composer);
    if (name !== null) composers.add(name);
    perCollection.set(p.collectionId, (perCollection.get(p.collectionId) ?? 0) + 1);
  };
  const fits = (p: LibraryEntry) => {
    const name = namedComposer(p.composer);
    return (name === null || !composers.has(name)) && (perCollection.get(p.collectionId) ?? 0) < 2;
  };
  if (first) take(first);
  const curatedFirst = [...order.filter(isCurated), ...order.filter((p) => !isCurated(p))];
  for (const p of curatedFirst) {
    if (taken.length >= 2) break;
    if (fits(p)) take(p);
  }
  for (const p of order) {
    if (taken.length >= SAMPLES) break;
    if (!taken.includes(p) && fits(p)) take(p);
  }
  for (const p of order) {
    if (taken.length >= SAMPLES) break;
    if (!taken.includes(p)) take(p);
  }
  const rest = taken.slice(first ? 1 : 0).sort((a, b) => a.approxDurationSec - b.approxDurationSec);
  return first ? [first, ...rest] : rest;
}

// -- lengths (shelves spec 4.3) -------------------------------------------------------------

const inLength = (p: LibraryEntry, length: Length): boolean =>
  p.approxDurationSec >= length.from && p.approxDurationSec < length.to;

/**
 * The length pills of a list and the choice in effect: none unless the list holds more than 40
 * pieces and at least one length besides `Any length` holds a piece. A chosen length the list
 * does not hold falls back to `Any length`.
 */
function lengthPills(
  list: readonly LibraryEntry[],
  wanted: LengthId,
): { lengths: LengthOptions | null; length: LengthId } {
  if (!showsLengths(list.length)) return { lengths: null, length: 'any' };
  const options = LENGTHS.filter((l) => l.id === 'any' || list.some((p) => inLength(p, l)));
  if (options.length < 2) return { lengths: null, length: 'any' };
  return { lengths: options, length: options.some((l) => l.id === wanted) ? wanted : 'any' };
}

function withLength(list: readonly LibraryEntry[], id: LengthId): readonly LibraryEntry[] {
  if (id === 'any') return list;
  const length = LENGTHS.find((l) => l.id === id)!;
  return list.filter((p) => inLength(p, length));
}

// -- layouts --------------------------------------------------------------------------------

/** The small library's list, or search results: a section per tier, each in full. */
function sectionsOf(pieces: readonly LibraryEntry[], t: Messages): Section[] {
  const tiers = tiersIn(pieces);
  const members = tiers.map((t) => pieces.filter((p) => tierOf(p.level) === t));
  const groups = finish(
    members.map((m) => draftGroups(m, t)),
    t,
  );
  return tiers.map((tier, i) => ({
    tier,
    count: members[i]!.length,
    groups: groups[i]!,
    shown: members[i]!.length,
    open: false,
    action: null,
  }));
}

/**
 * Search results as a section per tier: the first 7 rows and `All {n} in {Tier}`, or, for the
 * opened section, collection groups in pages of 40.
 */
function searchSections(
  found: readonly LibraryEntry[],
  open: Tier | null,
  pages: number | undefined,
  t: Messages,
): Section[] {
  const tiers = tiersIn(found);
  const members = tiers.map((t) => found.filter((p) => tierOf(p.level) === t));
  const full = members.map((m, i) => (tiers[i] === open ? draftGroups(m, t) : null));
  const visible = members.map((m, i) =>
    full[i] ? firstRows(full[i]!, pageRows(pages)) : draftGroups(m.slice(0, SECTION_ROWS), t),
  );
  const groups = finish(
    visible,
    t,
    visible.map((v, i) => full[i] ?? v),
  );
  return tiers.map((tier, i) => {
    const count = members[i]!.length;
    const shown = rowCount(groups[i]!);
    const isOpen = full[i] !== null;
    const action: ListAction | null = isOpen
      ? count > shown
        ? { kind: 'more', label: moreLabel(count - shown, t) }
        : null
      : count > SECTION_ROWS
        ? { kind: 'open', label: t.library.list.allInLevel(count, t.library.tiers[tier]) }
        : null;
    return { tier, count, groups: groups[i]!, shown, open: isOpen, action };
  });
}

/** True when the tier holds a piece of the shelf: whether an open shelf stays open on a tier change. */
export function shelfHasPieces(
  pieces: readonly LibraryEntry[],
  tier: Tier,
  shelf: ShelfId,
): boolean {
  return pieces.some((p) => tierOf(p.level) === tier && shelfOfGenre(p.genre) === shelf);
}

/** The arrival page's shelves of a tier, in the display order, the empty ones left out. */
function shelvesOf(
  inTier: readonly LibraryEntry[],
  tier: Tier,
  date: string,
  lastPlayed: string | null,
  t: Messages,
): ShelfSummary[] {
  const byShelf = new Map<ShelfId, LibraryEntry[]>();
  for (const p of inTier) {
    const id = shelfOfGenre(p.genre);
    const members = byShelf.get(id);
    if (members) members.push(p);
    else byShelf.set(id, [p]);
  }
  const shelves = SHELVES.filter((s) => byShelf.has(s.id)).map((s) => {
    const members = byShelf.get(s.id)!;
    const last = lastPlayed === null ? undefined : members.find((p) => p.slug === lastPlayed);
    return {
      shelf: s,
      members,
      samples: sampleShelf(members, `${date}|${tier}|${s.id}`, last ?? null),
    };
  });
  const rows = finish(
    shelves.map((s) => [{ key: 'flat', heading: null, drafts: s.samples.map(plain) }]),
    t,
  );
  return shelves.map(({ shelf, members }, i) => ({
    id: shelf.id,
    name: t.library.shelves[shelf.id].name,
    line: t.library.shelves[shelf.id].line,
    count: members.length,
    rows: rows[i]![0]!.rows,
    all: members.length > SAMPLES ? t.library.shelves[shelf.id].all(members.length) : null,
  }));
}

/** The page's list for the library and the reader's choices (shelves spec 4; UI batch spec 6.2). */
export function libraryLayout(
  pieces: readonly LibraryEntry[],
  choices: LibraryChoices,
  t: Messages,
): LibraryLayout {
  const { tier, shelf, section, pages, date } = choices;
  const query = choices.query.trim();
  const wanted = choices.length ?? 'any';
  if (query !== '' && showsSearch(pieces.length)) {
    const found = searchPieces(pieces, query, (id) => t.library.shelves[id].name);
    const { lengths, length } = lengthPills(found, wanted);
    const listed = withLength(found, length);
    return {
      kind: 'search',
      query,
      count: listed.length,
      sections: searchSections(listed, section ?? null, pages, t),
      lengths,
      length,
    };
  }
  if (!showsPills(pieces.length)) return { kind: 'all', sections: sectionsOf(pieces, t) };
  const tiers = tiersIn(pieces);
  const chosen = tier !== null && tiers.includes(tier) ? tier : tiers[0]!;
  const inTier = pieces.filter((p) => tierOf(p.level) === chosen);
  if (shelf && shelfHasPieces(inTier, chosen, shelf)) {
    const members = inTier.filter((p) => shelfOfGenre(p.genre) === shelf);
    const { lengths, length } = lengthPills(members, wanted);
    const listed = withLength(members, length);
    const full = draftGroups(listed, t);
    const visible = firstRows(full, pageRows(pages));
    const groups = finish([visible], t, [full])[0]!;
    const shown = rowCount(groups);
    return {
      kind: 'shelf',
      tiers,
      tier: chosen,
      shelf,
      name: t.library.shelves[shelf].name,
      count: listed.length,
      groups,
      shown,
      more: listed.length > shown ? moreLabel(listed.length - shown, t) : null,
      lengths,
      length,
    };
  }
  return {
    kind: 'shelves',
    tiers,
    tier: chosen,
    count: inTier.length,
    shelves: shelvesOf(inTier, chosen, date, choices.lastPlayed ?? null, t),
  };
}

/** What the polite live region says about a layout: the count in view, never on arrival (the view). */
export function announcementFor(layout: LibraryLayout, t: Messages): string {
  const say = t.library;
  switch (layout.kind) {
    case 'all':
      return '';
    case 'shelves':
      return say.announce.counted(say.tiers[layout.tier], layout.count);
    case 'shelf':
      return layout.shown > PAGE_SIZE
        ? say.announce.showing(layout.shown, layout.count)
        : say.announce.counted(layout.name, layout.count);
    case 'search': {
      if (layout.count === 0) return say.search.noMatch(layout.query);
      const open = layout.sections.find((s) => s.open && s.shown > PAGE_SIZE);
      return open
        ? say.announce.showingIn(open.shown, open.count, say.tiers[open.tier])
        : say.pieces(layout.count);
    }
  }
}

export interface StartTarget {
  piece: LibraryEntry;
  /** True when the piece is the reader's last one played (Continue), false for the first piece. */
  continuing: boolean;
}

/** The red button's piece: the last one played while it is in the library, else the first piece of the lowest grade. */
export function startTarget(
  pieces: readonly LibraryEntry[],
  lastPlayed: string | null,
): StartTarget {
  const last = lastPlayed === null ? undefined : pieces.find((p) => p.slug === lastPlayed);
  if (last) return { piece: last, continuing: true };
  const lowest = pieces.reduce((n, p) => Math.min(n, p.level), 6);
  return { piece: pieces.find((p) => p.level === lowest)!, continuing: false };
}

export function startLabel(target: StartTarget, t: Messages): string {
  return target.continuing
    ? t.library.welcome.continueWith(dropTrailingParenthesis(target.piece.title))
    : t.library.welcome.startWith(target.piece.title);
}

/** The tier the pills open on: chosen in this visit, else the last piece's, else the easiest. */
export function arrivalLevel(
  pieces: readonly LibraryEntry[],
  chosen: Tier | null,
  lastPlayed: string | null,
): Tier {
  const tiers = tiersIn(pieces);
  if (chosen !== null && tiers.includes(chosen)) return chosen;
  const last = lastPlayed === null ? undefined : pieces.find((p) => p.slug === lastPlayed);
  return last ? tierOf(last.level) : tiers[0]!;
}
