import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  pieceKey,
  SETTINGS_STORAGE_KEY,
  TEMPO_PIECES_MAX,
  tempoFactorOf,
  useAppStore,
  type PieceSource,
} from './store.js';

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
    libraryScrollY: 0,
  });
});

describe('store', () => {
  it('starts on the library with default settings', () => {
    expect(useAppStore.getState().view).toEqual({ name: 'library' });
    // The defaults are a promise to a first-time visitor, so they are spelled out here, not read back from the source.
    expect(useAppStore.getState().settings).toEqual({
      handSize: 'medium',
      tempoByPiece: {},
      hands: 'both',
      metronome: false,
      countIn: true,
      showEditorial: false,
      lastPlayed: null,
      legendSeen: false,
      favourites: [],
    });
  });
  it('opens a library piece, the about page, and goes back', () => {
    useAppStore.getState().openPiece({ kind: 'library', slug: 'ode-to-joy' });
    expect(useAppStore.getState().view).toEqual({
      name: 'score',
      source: { kind: 'library', slug: 'ode-to-joy' },
    });
    useAppStore.getState().openAbout();
    expect(useAppStore.getState().view.name).toBe('about');
    useAppStore.getState().openLibrary();
    expect(useAppStore.getState().view.name).toBe('library');
  });
  it('persists settings to localStorage and clamps the tempo factor', () => {
    // The tempo factor is the open piece's own (polish plan Task 6).
    useAppStore.getState().setSettings({ handSize: 'small' });
    useAppStore.getState().openPiece({ kind: 'library', slug: 'ode-to-joy' });
    useAppStore.getState().setTempoFactor(9);
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(stored.state.settings.handSize).toBe('small');
    expect(tempoFactorOf(useAppStore.getState())).toBe(1.5);
    expect(stored.state.settings.tempoByPiece).toEqual({ 'piece:ode-to-joy': 1.5 });
    expect(stored.state).not.toHaveProperty('view');
  });
  it('merges a partial stored settings object with the defaults', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { settings: { handSize: 'child', bogus: 1 } }, version: 0 }),
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, handSize: 'child' });
  });
  it('clears a notice', () => {
    useAppStore.getState().setNotice('hello');
    expect(useAppStore.getState().notice).toBe('hello');
    useAppStore.getState().setNotice(null);
    expect(useAppStore.getState().notice).toBeNull();
  });
  it('keeps the library scroll position for the way back, without persisting it', () => {
    expect(useAppStore.getState().libraryScrollY).toBe(0);
    useAppStore.getState().setLibraryScrollY(1852);
    expect(useAppStore.getState().libraryScrollY).toBe(1852);
    useAppStore.getState().setSettings({ metronome: true });
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(stored.state).toEqual({ settings: { ...DEFAULT_SETTINGS, metronome: true } });
  });
});

// Polish plan Task 6, review S8: a tempo set for one hard piece persisted and carried to every
// other piece, so a beginner who slowed one piece found every piece slow. Each piece now keeps
// its own tempo factor, and a piece never slowed or sped up plays at 100 %.
describe('the tempo factor, per piece', () => {
  const S = () => useAppStore.getState();
  const twinkle: PieceSource = { kind: 'library', slug: 'twinkle-twinkle-little-star' };
  const ode: PieceSource = { kind: 'library', slug: 'ode-to-joy' };
  const enc = (s: string) => new TextEncoder().encode(s);
  const stored = () =>
    JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).state.settings.tempoByPiece as Record<
      string,
      number
    >;

  it('keys a library piece by its slug and a dropped file by its name and content', () => {
    expect(pieceKey(twinkle)).toBe('piece:twinkle-twinkle-little-star');
    const a = pieceKey({ kind: 'file', name: 'etude.musicxml', bytes: enc('<a/>') });
    const b = pieceKey({ kind: 'file', name: 'etude.musicxml', bytes: enc('<b/>') });
    expect(a.startsWith('file:etude.musicxml:4:')).toBe(true);
    expect(a).not.toBe(b);
    expect(pieceKey({ kind: 'file', name: 'etude.musicxml', bytes: enc('<a/>') })).toBe(a);
  });

  it('opens every piece at 100 % until its own tempo changes, and keeps each piece its own', () => {
    expect(tempoFactorOf(S())).toBe(1);
    S().openPiece(twinkle);
    expect(tempoFactorOf(S())).toBe(1);
    S().setTempoFactor(0.7);
    expect(tempoFactorOf(S())).toBe(0.7);
    // A different piece opens at 100 %, whatever the piece before it was set to.
    S().openPiece(ode);
    expect(tempoFactorOf(S())).toBe(1);
    S().setTempoFactor(1.25);
    S().openLibrary();
    expect(tempoFactorOf(S())).toBe(1);
    S().openPiece(twinkle);
    expect(tempoFactorOf(S())).toBe(0.7);
    S().openPiece(ode);
    expect(tempoFactorOf(S())).toBe(1.25);
    expect(stored()).toEqual({
      'piece:twinkle-twinkle-little-star': 0.7,
      'piece:ode-to-joy': 1.25,
    });
  });

  it('forgets a piece set back to 100 %, and ignores a change with no piece open', () => {
    S().openPiece(twinkle);
    S().setTempoFactor(0.5);
    S().setTempoFactor(1);
    expect(tempoFactorOf(S())).toBe(1);
    expect(S().settings.tempoByPiece).toEqual({});
    S().openLibrary();
    S().setTempoFactor(0.6);
    expect(S().settings.tempoByPiece).toEqual({});
    S().openPiece(twinkle);
    expect(tempoFactorOf(S())).toBe(1);
  });

  it('clamps to 50 to 150 % and ignores a value that is not a number', () => {
    S().openPiece(twinkle);
    S().setTempoFactor(0.1);
    expect(tempoFactorOf(S())).toBe(0.5);
    S().setTempoFactor(Number.NaN);
    expect(tempoFactorOf(S())).toBe(0.5);
  });

  it('keeps a dropped file apart from another file of the same name', () => {
    const first: PieceSource = { kind: 'file', name: 'song.musicxml', bytes: enc('<one/>') };
    const second: PieceSource = { kind: 'file', name: 'song.musicxml', bytes: enc('<two/>') };
    S().openPiece(first);
    S().setTempoFactor(0.8);
    S().openPiece(second);
    expect(tempoFactorOf(S())).toBe(1);
    S().openPiece({ kind: 'file', name: 'song.musicxml', bytes: enc('<one/>') });
    expect(tempoFactorOf(S())).toBe(0.8);
  });

  it(`keeps the tempos of the ${TEMPO_PIECES_MAX} pieces changed last`, () => {
    for (let i = 0; i <= TEMPO_PIECES_MAX; i++) {
      S().openPiece({ kind: 'library', slug: `piece-${i}` });
      S().setTempoFactor(0.75);
    }
    const keys = Object.keys(S().settings.tempoByPiece);
    expect(keys).toHaveLength(TEMPO_PIECES_MAX);
    expect(keys).not.toContain('piece:piece-0');
    expect(keys.at(-1)).toBe(`piece:piece-${TEMPO_PIECES_MAX}`);
    // Changing an older piece again makes it the newest.
    S().openPiece({ kind: 'library', slug: 'piece-1' });
    S().setTempoFactor(0.6);
    expect(Object.keys(S().settings.tempoByPiece).at(-1)).toBe('piece:piece-1');
    expect(Object.keys(stored())).toHaveLength(TEMPO_PIECES_MAX);
  });

  it('drops the global tempo an older version stored, and every invalid entry', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        state: {
          settings: {
            tempoFactor: 1.5,
            tempoByPiece: {
              'piece:ode-to-joy': 0.7,
              'piece:too-fast': 9,
              'piece:not-a-number': 'slow',
              'piece:written-tempo': 1,
            },
          },
        },
        version: 1,
      }),
    );
    await useAppStore.persist.rehydrate();
    expect(S().settings).toEqual({
      ...DEFAULT_SETTINGS,
      tempoByPiece: { 'piece:ode-to-joy': 0.7 },
    });
    expect(S().settings).not.toHaveProperty('tempoFactor');
    S().openPiece(twinkle);
    expect(tempoFactorOf(S())).toBe(1);
    S().openPiece(ode);
    expect(tempoFactorOf(S())).toBe(0.7);
  });
});

describe('what the library remembers (UI batch, spec section 16)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      view: { name: 'library' },
      settings: { ...DEFAULT_SETTINGS },
      libraryLevel: null,
      libraryQuery: '',
      libraryShelf: null,
      librarySection: null,
      libraryPages: 1,
      libraryLength: 'any',
    });
  });
  it('loads older settings with lastPlayed at its default, keeps a valid one, and drops an invalid one', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { settings: { handSize: 'small' } }, version: 1 }),
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().settings).toMatchObject({ handSize: 'small', lastPlayed: null });
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { settings: { lastPlayed: 'amazing-grace' } }, version: 1 }),
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().settings.lastPlayed).toBe('amazing-grace');
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { settings: { lastPlayed: 5 } }, version: 1 }),
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().settings.lastPlayed).toBeNull();
  });
  it('keeps the chosen level for the visit only', () => {
    useAppStore.getState().setLibraryLevel('medium');
    expect(useAppStore.getState().libraryLevel).toBe('medium');
    expect(
      JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{"state":{}}').state.libraryLevel,
    ).toBeUndefined();
  });
  it('keeps the search text for the visit only', () => {
    expect(useAppStore.getState().libraryQuery).toBe('');
    useAppStore.getState().setLibraryQuery('bach');
    expect(useAppStore.getState().libraryQuery).toBe('bach');
    expect(
      JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{"state":{}}').state.libraryQuery,
    ).toBeUndefined();
  });
});

describe('the library shelves (shelves spec 3, 4.2, 4.3)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      view: { name: 'library' },
      settings: { ...DEFAULT_SETTINGS },
      libraryLevel: null,
      libraryQuery: '',
      libraryShelf: null,
      librarySection: null,
      libraryPages: 1,
      libraryLength: 'any',
    });
  });
  it('starts with no shelf open, one page and any length', () => {
    expect(useAppStore.getState()).toMatchObject({
      libraryShelf: null,
      librarySection: null,
      libraryPages: 1,
      libraryLength: 'any',
    });
  });
  it('keeps the open shelf and the pages shown for the visit, across a score and back, and never writes them', () => {
    const S = () => useAppStore.getState();
    S().setLibraryShelf('baroque');
    S().setLibraryPages(3);
    S().openPiece({ kind: 'library', slug: 'ode-to-joy' });
    S().openLibrary();
    expect(S()).toMatchObject({ libraryShelf: 'baroque', libraryPages: 3 });
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{"state":{}}').state;
    for (const key of ['libraryShelf', 'libraryPages', 'librarySection', 'libraryLength'])
      expect(saved[key], key).toBeUndefined();
  });
  it('starts again at the first page when the list changes: shelf, section, level, length, search', () => {
    const S = () => useAppStore.getState();
    for (const change of [
      () => S().setLibraryShelf('songs'),
      () => S().setLibrarySection('medium'),
      () => S().setLibraryLevel('challenging'),
      () => S().setLibraryLength('short'),
      () => S().setLibraryQuery('bach'),
    ]) {
      S().setLibraryPages(4);
      change();
      expect(S().libraryPages).toBe(1);
    }
    expect(S()).toMatchObject({
      libraryShelf: 'songs',
      libraryLength: 'short',
      libraryQuery: 'bach',
    });
  });
  it('closes the open search section when the search text changes, and keeps the shelf', () => {
    const S = () => useAppStore.getState();
    S().setLibraryShelf('jazz');
    S().setLibrarySection('easy');
    S().setLibraryQuery('x');
    expect(S()).toMatchObject({ librarySection: null, libraryShelf: 'jazz' });
  });
  it('never shows fewer than one page', () => {
    useAppStore.getState().setLibraryPages(0);
    expect(useAppStore.getState().libraryPages).toBe(1);
    useAppStore.getState().setLibraryPages(2.9);
    expect(useAppStore.getState().libraryPages).toBe(2);
  });
  it('reads a level saved by a build with six level pills as its level', async () => {
    const stored = (libraryLevel: unknown) =>
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({ state: { settings: { handSize: 'small' }, libraryLevel }, version: 1 }),
      );
    for (const [grade, tier] of [
      [1, 'easy'],
      [2, 'easy'],
      [3, 'medium'],
      [4, 'harder'],
      [5, 'challenging'],
      [6, 'challenging'],
    ] as const) {
      useAppStore.setState({ libraryLevel: null });
      stored(grade);
      await useAppStore.persist.rehydrate();
      expect(useAppStore.getState().libraryLevel, `grade ${grade}`).toBe(tier);
      expect(useAppStore.getState().settings.handSize).toBe('small');
    }
    for (const junk of [7, 'hard', null]) {
      useAppStore.setState({ libraryLevel: null });
      stored(junk);
      await useAppStore.persist.rehydrate();
      expect(useAppStore.getState().libraryLevel, String(junk)).toBeNull();
    }
  });
});

describe('the first Play (UI batch, spec sections 12 and 16)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ view: { name: 'library' }, settings: { ...DEFAULT_SETTINGS } });
  });
  it('remembers the library piece played last and that the legend was seen', () => {
    useAppStore.getState().openPiece({ kind: 'library', slug: 'beethoven-fur-elise-woo-59' });
    useAppStore.getState().markPlayed();
    expect(useAppStore.getState().settings).toMatchObject({
      lastPlayed: 'beethoven-fur-elise-woo-59',
      legendSeen: true,
    });
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).state.settings.lastPlayed).toBe(
      'beethoven-fur-elise-woo-59',
    );
  });
  it('never remembers a dropped file, but still counts its Play for the legend', () => {
    useAppStore
      .getState()
      .openPiece({ kind: 'file', name: 'x.musicxml', bytes: new Uint8Array([1]) });
    useAppStore.getState().markPlayed();
    expect(useAppStore.getState().settings).toMatchObject({ lastPlayed: null, legendSeen: true });
  });
  it('does nothing outside the score view', () => {
    useAppStore.getState().markPlayed();
    expect(useAppStore.getState().settings).toMatchObject({ lastPlayed: null, legendSeen: false });
  });
  it('loads legendSeen from older settings at its default and drops an invalid value', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { settings: { handSize: 'small', legendSeen: 'yes' } }, version: 1 }),
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().settings).toMatchObject({ handSize: 'small', legendSeen: false });
  });
  it('keeps Practice open for the visit only', () => {
    useAppStore.setState({ practiceOpen: false });
    expect(useAppStore.getState().practiceOpen).toBe(false);
    useAppStore.getState().setPracticeOpen(true);
    expect(useAppStore.getState().practiceOpen).toBe(true);
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{"state":{}}').state;
    expect(stored.practiceOpen).toBeUndefined();
    expect(stored.settings?.practiceOpen).toBeUndefined();
  });
});

describe('favourites (issue #78)', () => {
  const S = () => useAppStore.getState();
  const stored = () =>
    JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{"state":{}}').state.settings;
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS }, libraryFavouritesOpen: false });
  });
  it('adds a piece as the newest favourite and takes it out again, in localStorage', () => {
    S().toggleFavourite('ode-to-joy');
    S().toggleFavourite('amazing-grace');
    expect(S().settings.favourites).toEqual(['amazing-grace', 'ode-to-joy']);
    expect(stored().favourites).toEqual(['amazing-grace', 'ode-to-joy']);
    S().toggleFavourite('ode-to-joy');
    expect(S().settings.favourites).toEqual(['amazing-grace']);
    expect(stored().favourites).toEqual(['amazing-grace']);
  });
  it('loads older settings with no favourites, keeps unique slugs and drops anything else', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { settings: { handSize: 'small' } }, version: 2 }),
    );
    await useAppStore.persist.rehydrate();
    expect(S().settings).toMatchObject({ handSize: 'small', favourites: [] });
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        state: { settings: { favourites: ['minuet', 5, 'minuet', '', null, 'ode-to-joy'] } },
        version: 2,
      }),
    );
    await useAppStore.persist.rehydrate();
    expect(S().settings.favourites).toEqual(['minuet', 'ode-to-joy']);
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { settings: { favourites: 'minuet' } }, version: 2 }),
    );
    await useAppStore.persist.rehydrate();
    expect(S().settings.favourites).toEqual([]);
  });
  it('keeps the favourites shelf shown in full for the visit only', () => {
    expect(S().libraryFavouritesOpen).toBe(false);
    S().setLibraryFavouritesOpen(true);
    S().openPiece({ kind: 'library', slug: 'ode-to-joy' });
    S().openLibrary();
    expect(S().libraryFavouritesOpen).toBe(true);
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{"state":{}}').state;
    expect(saved.libraryFavouritesOpen).toBeUndefined();
  });
});

describe('the default settings', () => {
  it('start a beginner with a medium hand, both hands, a count-in and nothing else on', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      handSize: 'medium',
      tempoByPiece: {},
      hands: 'both',
      metronome: false,
      countIn: true,
      showEditorial: false,
      lastPlayed: null,
      legendSeen: false,
      favourites: [],
    });
  });
});
