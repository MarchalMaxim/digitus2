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
    openPiece: (title: string, composer: string | null) =>
      composer === null ? `Open ${title}` : `Open ${title} by ${composer}`,
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
  /** Playing along on the reader's own piano over Web MIDI (issue 182): the line under the end line. */
  piano: {
    /** The button while nothing is connected; the press is the reader's consent to the browser's prompt. */
    start: 'Play along on your piano',
    /** The line while the browser's permission prompt is open. */
    asking: 'Allow the browser to use your piano.',
    /** Access is granted but the browser has not answered yet: Windows looking for a Bluetooth piano that is off. */
    searching: 'Looking for your piano. Make sure it is turned on.',
    /** The line once a piano is connected; `name` is the first input's name, or `yourPiano`. */
    connected: (name: string) => `${name} is connected. Open a piece and play the red note.`,
    /** The name used when the connected input has none. */
    yourPiano: 'Your piano',
    /** Access was granted but no piano is connected. */
    none: 'No piano found. Connect it with a USB cable, or pair it over Bluetooth and turn it on.',
    /** Windows Chromium only; `flag` is the address of the browser's flag page, which stays in English. */
    bluetoothFlag: (flag: string) =>
      `On Windows, a Bluetooth piano also needs ${flag} set to Enabled.`,
    /** The browser blocked MIDI for this site. */
    denied:
      'The browser blocked MIDI for this site. Allow it in the site settings, then press again.',
    /** The button while a piano is connected or sought: it turns playing along off. */
    turnOff: 'Turn off',
  },
  /** The shelf of the pieces marked with the score page's heart, above the levels. */
  favourites: {
    heading: 'Favourites',
    /** The gray line under the shelf's name, as under the style shelves'. */
    line: 'The pieces you marked with the heart, newest first.',
    /** The button under the shelf that shows the rest: "All 12 favourites" (always six or more). */
    all: (n: number) => `All ${formatNumber('en', n)} favourites`,
    /** The accessible name of a row's filled heart, which takes the piece off the shelf. */
    remove: (title: string, composer: string | null) =>
      composer === null
        ? `Remove ${title} from Favourites`
        : `Remove ${title} by ${composer} from Favourites`,
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
    removed: (name: string) => `Removed ${name}.`,
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
  /** The shared library of readers' scores (issue 132). */
  shared: {
    /** The My scores row's buttons; `name` is the score's name in the row. */
    share: 'Share',
    shareLabel: (name: string) => `Share ${name}`,
    withdraw: 'Withdraw',
    withdrawLabel: (name: string) => `Withdraw ${name} from review`,
    /** The gray line under a shared score's name in My scores. */
    detail: { waiting: 'Waiting for review', shared: 'Shared', notShared: 'Not shared' },
    sent: 'Sent for review. It appears under Shared by readers once the owner has read it.',
    unavailable: 'Sharing is not available right now. Try again later.',
    tooLarge: 'This score is too large to share.',
    withdrawFailed: 'This score could not be withdrawn. Try again.',
    sheetHeading: 'Share with other readers',
    title: 'Title',
    composer: 'Composer',
    titleMissing: 'Give the score a title.',
    rule: 'Share only music that is out of copyright or that you wrote. The owner reads each score before anyone else can find it.',
    free: 'This music is free to share',
    tick: 'Tick the box to share this score.',
    cancel: 'Cancel',
    shelf: 'Shared by readers',
    more: 'More shared scores',
    open: (title: string) => `Open shared ${title}`,
    byReader: 'Shared by a reader',
    report: 'Report',
    notLoaded: 'This shared score could not be loaded.',
    reportHeading: 'Report this score',
    reasons: {
      copyright: 'It is under copyright',
      abuse: 'It is offensive or spam',
      broken: 'It does not play right',
    },
    chooseReason: 'Choose a reason.',
    reply: 'How can the owner reply to you?',
    replyNeeded: 'Say how the owner can reply to you.',
    note: 'Anything else (optional)',
    send: 'Send report',
    sentHeading: 'Report sent',
    sentLine: 'The owner reads every report and removes a score that should not be here.',
    backToScore: 'Back to the score',
    failed: 'The report could not be sent.',
    askRemoval: 'Ask for removal on GitHub',
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
