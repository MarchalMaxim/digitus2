import type { ScanSession } from '../scan/model.js';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { Level } from '../library/levels.js';

export type HandSize = 'large' | 'medium' | 'small' | 'child';
export type HandsMode = 'both' | 'R' | 'L';
export interface Settings {
  handSize: HandSize;
  /**
   * Each piece's own tempo factor (0.5 .. 1.5; 1 is the written tempo), by `pieceKey`. A piece
   * opens at the tempo it was last set to, and a piece never set at 100 %: one factor for every
   * piece made every piece slow once a hard one was slowed (polish plan Task 6, review S8). Only
   * factors other than 1 are kept, for the TEMPO_PIECES_MAX pieces changed last, oldest first.
   * (The M5 per-piece store is not here yet, so this small map lives with the settings.)
   */
  tempoByPiece: Record<string, number>;
  hands: HandsMode;
  metronome: boolean;
  countIn: boolean;
  showEditorial: boolean;
  /** The slug of the library piece played last (set on every Play of a library piece, Task 4), or null. */
  lastPlayed: string | null;
  /** True once the reader has pressed Play in any piece: the finger legend then lives in the side panel only. */
  legendSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  handSize: 'medium',
  tempoByPiece: {},
  hands: 'both',
  metronome: false,
  countIn: true,
  showEditorial: false,
  lastPlayed: null,
  legendSeen: false,
};

export type PieceSource =
  | { kind: 'library'; slug: string }
  | { kind: 'file'; name: string; bytes: Uint8Array; scan?: ScanSession };
export type View =
  | { name: 'library' }
  | { name: 'about' }
  | { name: 'scan'; session: ScanSession }
  | { name: 'score'; source: PieceSource };

export interface AppState {
  view: View;
  settings: Settings;
  notice: string | null;
  /**
   * How far the library was scrolled (`window.scrollY`) when the reader last left it, by opening
   * a piece, a file or the about page, or through the history; the library comes back there
   * (App.tsx). Not persisted.
   */
  libraryScrollY: number;
  /** The level pill chosen in this visit; null until the reader chooses one. Not persisted. */
  libraryLevel: Level | null;
  /** The library's search text in this visit; not persisted. */
  libraryQuery: string;
  /** The dock's Practice panel is open; lasts for the visit, every page load starts closed. */
  practiceOpen: boolean;
  openLibrary(): void;
  openAbout(): void;
  openPiece(source: PieceSource): void;
  openScan(session: ScanSession): void;
  setSettings(patch: Partial<Settings>): void;
  /**
   * Sets the open piece's own tempo factor, clamped to TEMPO_FACTOR_MIN..MAX; a value that is
   * not a number, or no piece open, changes nothing. Read it back with `tempoFactorOf`.
   */
  setTempoFactor(factor: number): void;
  setNotice(message: string | null): void;
  setLibraryScrollY(y: number): void;
  setLibraryLevel(level: Level): void;
  setLibraryQuery(query: string): void;
  /** Called on Play: the legend has been seen, and a library piece becomes the one to continue. */
  markPlayed(): void;
  setPracticeOpen(open: boolean): void;
}

export const SETTINGS_STORAGE_KEY = 'digitus2.settings.v1';

export const TEMPO_FACTOR_MIN = 0.5;
export const TEMPO_FACTOR_MAX = 1.5;
/** How many pieces keep a tempo of their own (`Settings.tempoByPiece`): the ones changed last. */
export const TEMPO_PIECES_MAX = 50;

const HAND_SIZES: readonly HandSize[] = ['large', 'medium', 'small', 'child'];
const HANDS_MODES: readonly HandsMode[] = ['both', 'R', 'L'];

const fileIds = new WeakMap<Uint8Array, string>();

/**
 * A dropped file's identity: its length and an FNV-1a hash of its bytes, computed once per bytes
 * object. A caller that hands over equal bytes in a new array does not reopen the piece; a
 * different file under the same name does. The app keys its score view on it too (through
 * `pieceKey`), so a new file also starts with fresh playback and loop inputs.
 */
export function fileIdentity(bytes: Uint8Array): string {
  let id = fileIds.get(bytes);
  if (id === undefined) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193);
    }
    id = `${bytes.length}:${(h >>> 0).toString(36)}`;
    fileIds.set(bytes, id);
  }
  return id;
}

/**
 * A piece's identity: `piece:<slug>` for a library piece, `file:<name>:<fileIdentity>` for a
 * dropped file (two files of the same name are two pieces). The key of its own settings (its
 * tempo) and of its score view (App.tsx).
 */
export function pieceKey(source: PieceSource): string {
  return source.kind === 'library'
    ? `piece:${source.slug}`
    : `file:${source.name}:${fileIdentity(source.bytes)}`;
}

/**
 * The open piece's tempo factor: its own, else 1 (the written tempo); 1 while no piece is open.
 * A store selector: `useAppStore(tempoFactorOf)`.
 */
export function tempoFactorOf(state: Pick<AppState, 'view' | 'settings'>): number {
  if (state.view.name !== 'score') return 1;
  return state.settings.tempoByPiece[pieceKey(state.view.source)] ?? 1;
}

function isTempoFactor(value: unknown): value is number {
  return typeof value === 'number' && value >= TEMPO_FACTOR_MIN && value <= TEMPO_FACTOR_MAX;
}

/**
 * The tempo map with `key` set to `factor` as its newest entry (or removed, at 1), keeping the
 * TEMPO_PIECES_MAX newest entries. Keys are prefixed (`piece:`, `file:`), never integer-like, so
 * the object keeps the order the entries were set in.
 */
function withTempo(
  tempos: Record<string, number>,
  key: string,
  factor: number,
): Record<string, number> {
  const entries = Object.entries(tempos).filter(([k]) => k !== key);
  if (factor !== 1) entries.push([key, factor]);
  return Object.fromEntries(entries.slice(-TEMPO_PIECES_MAX));
}

/** A stored tempo map's valid entries (factors in range, other than 1), the newest kept. */
function pickTempos(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] => isTempoFactor(entry[1]) && entry[1] !== 1,
  );
  return Object.fromEntries(entries.slice(-TEMPO_PIECES_MAX));
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * Keeps only the known settings fields that carry a valid value, so settings written by an older
 * (or newer) version of the app can never put the store in an invalid state. The one tempo
 * factor for every piece that M4 stored (`tempoFactor`) is dropped on purpose: it is what slowed
 * every piece, so every piece starts at 100 % again.
 */
function pickSettings(value: unknown): Partial<Settings> {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (isOneOf(HAND_SIZES, raw.handSize)) out.handSize = raw.handSize;
  if (isOneOf(HANDS_MODES, raw.hands)) out.hands = raw.hands;
  const tempos = pickTempos(raw.tempoByPiece);
  if (tempos) out.tempoByPiece = tempos;
  if (typeof raw.metronome === 'boolean') out.metronome = raw.metronome;
  if (typeof raw.countIn === 'boolean') out.countIn = raw.countIn;
  if (typeof raw.showEditorial === 'boolean') out.showEditorial = raw.showEditorial;
  if (typeof raw.lastPlayed === 'string' || raw.lastPlayed === null)
    out.lastPlayed = raw.lastPlayed;
  if (typeof raw.legendSeen === 'boolean') out.legendSeen = raw.legendSeen;
  return out;
}

function memoryStorage(): StateStorage {
  const items = new Map<string, string>();
  return {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value);
    },
    removeItem: (name) => {
      items.delete(name);
    },
  };
}

/**
 * localStorage when it works, an in-memory map when it does not (blocked site data, private
 * windows, quota errors). Persistence must never throw into the UI.
 */
function safeStorage(): StateStorage {
  const fallback = memoryStorage();
  let local: Storage | null = null;
  try {
    local = globalThis.localStorage ?? null;
  } catch {
    local = null;
  }
  if (!local) return fallback;
  const store = local;
  return {
    getItem: (name) => {
      try {
        return store.getItem(name);
      } catch {
        return fallback.getItem(name);
      }
    },
    setItem: (name, value) => {
      try {
        store.setItem(name, value);
      } catch {
        void fallback.setItem(name, value);
      }
    },
    removeItem: (name) => {
      try {
        store.removeItem(name);
      } catch {
        void fallback.removeItem(name);
      }
    },
  };
}

type PersistedState = { settings: Settings };

export const useAppStore = create<AppState>()(
  persist<AppState, [], [], PersistedState>(
    (set) => ({
      view: { name: 'library' },
      settings: { ...DEFAULT_SETTINGS },
      notice: null,
      libraryScrollY: 0,
      libraryLevel: null,
      libraryQuery: '',
      practiceOpen: false,
      openLibrary: () => set({ view: { name: 'library' } }),
      openAbout: () => set({ view: { name: 'about' } }),
      openScan: (session) => set({ view: { name: 'scan', session } }),
      openPiece: (source) => set({ view: { name: 'score', source } }),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setTempoFactor: (factor) =>
        set((s) => {
          if (s.view.name !== 'score' || !Number.isFinite(factor)) return {};
          const clamped = Math.min(TEMPO_FACTOR_MAX, Math.max(TEMPO_FACTOR_MIN, factor));
          const tempoByPiece = withTempo(s.settings.tempoByPiece, pieceKey(s.view.source), clamped);
          return { settings: { ...s.settings, tempoByPiece } };
        }),
      setNotice: (message) => set({ notice: message }),
      setLibraryScrollY: (y) => set({ libraryScrollY: y }),
      setLibraryLevel: (level) => set({ libraryLevel: level }),
      setLibraryQuery: (query) => set({ libraryQuery: query }),
      markPlayed: () =>
        set((s) => {
          if (s.view.name !== 'score') return {};
          const source = s.view.source;
          const lastPlayed = source.kind === 'library' ? source.slug : s.settings.lastPlayed;
          return { settings: { ...s.settings, legendSeen: true, lastPlayed } };
        }),
      setPracticeOpen: (open) => set({ practiceOpen: open }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(safeStorage),
      partialize: (s) => ({ settings: s.settings }),
      version: 1,
      // Older payloads go through merge, which validates every field; no reshaping is needed yet.
      migrate: (persisted) => persisted as PersistedState,
      merge: (persisted, current) => {
        const stored =
          typeof persisted === 'object' && persisted !== null
            ? (persisted as { settings?: unknown }).settings
            : undefined;
        return { ...current, settings: { ...DEFAULT_SETTINGS, ...pickSettings(stored) } };
      },
    },
  ),
);
