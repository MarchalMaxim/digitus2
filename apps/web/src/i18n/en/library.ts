import { formatNumber, plural } from '../format.js';

const pieces = (n: number) => plural('en', n, { one: '# piece', other: '# pieces' });

/** The library's texts in English, the source every other language must match (messages.ts). */
export const library = {
  /** The four levels (library/levels.ts Tier): pill, search heading, announcement, side panel. */
  tiers: { easy: 'Easy', medium: 'Medium', harder: 'Harder', challenging: 'Challenging' },
  /** A number of pieces: the count beside a shelf, in a heading, in an announcement. */
  pieces,
  welcome: {
    tagline: 'Finger numbers for piano. Pick a piece, press play, and follow the red note.',
    /** The red button when the reader has not played anything yet. `title` is the piece's title. */
    startWith: (title: string) => `Start with ${title}`,
    /** The red button that returns to the last piece played. */
    continueWith: (title: string) => `Continue with ${title}`,
  },
  /** The two groups of pills above a list. */
  pills: {
    /** Hidden label of the group of four level pills (Easy, Medium, Harder, Challenging). */
    level: 'Level',
    /** Hidden label of the group of length pills (how long a piece plays). */
    length: 'Length',
    lengths: {
      any: 'Any length',
      short: 'Under 1 min',
      medium: '1 to 3 min',
      long: 'Over 3 min',
    },
  },
  /**
   * The six shelves. `all` is the button under a shelf that opens it, with the number of pieces
   * it holds (always six or more): "All 41 songs".
   */
  shelves: {
    songs: {
      name: 'Songs',
      line: "Well-known tunes from children's songs to film and games.",
      all: (n: number) => `All ${formatNumber('en', n)} songs`,
    },
    classical: {
      name: 'Classical',
      line: 'Mozart, Clementi, Czerny and the studies pianists grow up on.',
      all: (n: number) => `All ${formatNumber('en', n)} classical pieces`,
    },
    folk: {
      name: 'Folk and carols',
      line: 'Folk tunes, dances, carols and hymns.',
      all: (n: number) => `All ${formatNumber('en', n)} folk tunes and carols`,
    },
    baroque: {
      name: 'Baroque',
      line: 'Bach, Handel, Scarlatti and others, 1600 to 1750.',
      all: (n: number) => `All ${formatNumber('en', n)} baroque pieces`,
    },
    romantic: {
      name: 'Romantic',
      line: 'Schumann, Chopin, Tchaikovsky and others, 1820 to 1900.',
      all: (n: number) => `All ${formatNumber('en', n)} romantic pieces`,
    },
    jazz: {
      name: 'Jazz, ragtime and modern',
      line: "Joplin's rags and music written since 1900.",
      all: (n: number) => `All ${formatNumber('en', n)} jazz, ragtime and modern pieces`,
    },
  },
  list: {
    /** Back from an opened shelf to the shelves. */
    allStyles: 'All styles',
    /** The heading over the pieces of small collections. */
    otherPieces: 'Other pieces',
    /** The button that adds the next page of rows. */
    showMore: (n: number) => `Show ${formatNumber('en', n)} more`,
    /** The same button when the next page is the last one. */
    showLast: (n: number) => `Show the last ${formatNumber('en', n)}`,
    /** Search results: opens a level's results in full. `level` is the level's name. */
    allInLevel: (n: number, level: string) => `All ${formatNumber('en', n)} in ${level}`,
    /** The accessible name of a piece's row; its visible text is the title, composer and length. */
    openPiece: (title: string, composer: string) => `Open ${title} by ${composer}`,
  },
  search: {
    label: 'Search the library',
    placeholder: 'Search pieces and composers',
    /** The text button that empties the search field. */
    clear: 'Clear',
    clearLabel: 'Clear the search',
    noMatch: (query: string) => `No piece matches “${query}”.`,
    noMatchHint: 'Search looks in titles, composers and collections.',
  },
  /** What the polite live region says after the list changes. */
  announce: {
    /** A level or a shelf and how many pieces it holds: "Medium: 1,415 pieces". */
    counted: (name: string, n: number) => `${name}: ${pieces(n)}`,
    showing: (shown: number, total: number) =>
      `Showing ${formatNumber('en', shown)} of ${formatNumber('en', total)}`,
    showingIn: (shown: number, total: number, level: string) =>
      `Showing ${formatNumber('en', shown)} of ${formatNumber('en', total)} in ${level}`,
  },
  aboutAndLicences: 'About and licences',
  ownFile: {
    open: 'Open your own score',
    dropTitle: 'Drop to open this file',
    dropHint: 'MusicXML, MIDI, photo or PDF',
    notScore:
      'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).',
    oneAtATime: 'Open one MusicXML or MIDI file at a time.',
    cannotReadFiles: 'Could not read these files.',
    cannotReadFile: 'Could not read this file.',
  },
  /** The shelf of the pieces marked with the score page's heart, above the levels. */
  favourites: {
    heading: 'Favourites',
    /** The gray line under the shelf's name, as under the style shelves'. */
    line: 'The pieces you marked with the heart, newest first.',
    /** The button under the shelf that shows the rest: "All 12 favourites" (always six or more). */
    all: (n: number) => `All ${formatNumber('en', n)} favourites`,
    /** The accessible name of a row's filled heart, which takes the piece off the shelf. */
    remove: (title: string, composer: string) => `Remove ${title} by ${composer} from Favourites`,
  },
  myScores: {
    heading: 'My scores',
    saved: 'Saved',
    thisVisitOnly: 'Available for this visit only',
    saving: 'Saving…',
    /** The row's accessible name; `name` is the file's name. */
    open: (name: string) => `Open saved ${name}`,
    removeLabel: (name: string) => `Remove saved ${name}`,
    remove: 'Remove',
    /** The gray line under a score's name, by what was saved. */
    detail: {
      file: 'Score file',
      recognition: 'Recognition saved',
      corrected: 'Corrected recognition',
      draft: 'Scan draft',
    },
    removeFailed: 'This score could not be removed. Try again.',
    removedNotErased:
      'This score was removed for this visit, but browser storage could not be updated. It may reappear after a reload.',
    saveFailed: 'Your score could not be saved. Keep your original files.',
    openFailed: 'This saved score could not be opened. Choose your original file again.',
  },
  /**
   * The credit line under a library piece's title on the score screen. `by` is the typesetter's
   * name and `licence` a licence such as "CC BY 2.5" (not translated).
   */
  credit: {
    arrangement: 'digitus2 arrangement, CC0 (public domain)',
    unnamedTypesetter: 'an unnamed typesetter',
    engraving: (by: string, licence: string) =>
      `Engraving by ${by} for the Mutopia Project, ${licence}`,
    engravingPublicDomain: (by: string) =>
      `Engraving by ${by} for the Mutopia Project, public domain`,
  },
  /** Shown when a piece's details cannot be fetched (a network failure). */
  loadFailed: 'Could not load the piece details. Check the connection and try again.',
};
