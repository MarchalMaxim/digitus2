import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type HandSize = 'large' | 'medium' | 'small' | 'child';
export type HandsMode = 'both' | 'R' | 'L';
export interface Settings {
  handSize: HandSize;
  tempoFactor: number; // 0.5 .. 1.5
  hands: HandsMode;
  metronome: boolean;
  countIn: boolean;
  showEditorial: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  handSize: 'medium',
  tempoFactor: 1,
  hands: 'both',
  metronome: false,
  countIn: true,
  showEditorial: false,
};

export type PieceSource =
  { kind: 'library'; slug: string } | { kind: 'file'; name: string; bytes: Uint8Array };
export type View = { name: 'library' } | { name: 'about' } | { name: 'score'; source: PieceSource };

export interface AppState {
  view: View;
  settings: Settings;
  notice: string | null;
  openLibrary(): void;
  openAbout(): void;
  openPiece(source: PieceSource): void;
  setSettings(patch: Partial<Settings>): void;
  setNotice(message: string | null): void;
}

export const SETTINGS_STORAGE_KEY = 'digitus2.settings.v1';

export const TEMPO_FACTOR_MIN = 0.5;
export const TEMPO_FACTOR_MAX = 1.5;

const HAND_SIZES: readonly HandSize[] = ['large', 'medium', 'small', 'child'];
const HANDS_MODES: readonly HandsMode[] = ['both', 'R', 'L'];

function clampTempoFactor(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.tempoFactor;
  return Math.min(TEMPO_FACTOR_MAX, Math.max(TEMPO_FACTOR_MIN, value));
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * Keeps only the known settings fields that carry a valid value, so settings written by an older
 * (or newer) version of the app can never put the store in an invalid state.
 */
function pickSettings(value: unknown): Partial<Settings> {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (isOneOf(HAND_SIZES, raw.handSize)) out.handSize = raw.handSize;
  if (isOneOf(HANDS_MODES, raw.hands)) out.hands = raw.hands;
  if (
    typeof raw.tempoFactor === 'number' &&
    raw.tempoFactor >= TEMPO_FACTOR_MIN &&
    raw.tempoFactor <= TEMPO_FACTOR_MAX
  ) {
    out.tempoFactor = raw.tempoFactor;
  }
  if (typeof raw.metronome === 'boolean') out.metronome = raw.metronome;
  if (typeof raw.countIn === 'boolean') out.countIn = raw.countIn;
  if (typeof raw.showEditorial === 'boolean') out.showEditorial = raw.showEditorial;
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
      openLibrary: () => set({ view: { name: 'library' } }),
      openAbout: () => set({ view: { name: 'about' } }),
      openPiece: (source) => set({ view: { name: 'score', source } }),
      setSettings: (patch) =>
        set((s) => {
          const next: Settings = { ...s.settings, ...patch };
          next.tempoFactor = clampTempoFactor(next.tempoFactor);
          return { settings: next };
        }),
      setNotice: (message) => set({ notice: message }),
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
