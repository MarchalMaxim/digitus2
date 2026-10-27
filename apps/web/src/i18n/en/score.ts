import { formatNumber, plural } from '../format.js';

const notes = (n: number) => plural('en', n, { one: '# note', other: '# notes' });

/** The score view's texts in English, the source every other language must match (messages.ts). */
export const score = {
  /**
   * One line under the score's header and in the side panel. "Upper staff" is the top line of
   * the printed music (right hand), "lower staff" the bottom one (left hand).
   */
  fingerLegend:
    'Finger numbers: 1 is the thumb and 5 the little finger, in both hands. The upper staff is the right hand, the lower staff the left.',
  /** The seven natural notes from C to B: the names a reader of that language knows. */
  noteLetters: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  header: {
    back: 'Back to the library',
    /** The heart beside a library piece's title, pressed while the piece is a favourite. */
    favourite: 'Favourite',
  },
  sheet: {
    /** Name of the rendered sheet music for screen readers; `title` is the piece's title. */
    label: (title: string) => `Score of ${title}`,
  },
  keyboard: {
    /** Name of the on-screen piano keyboard for screen readers. */
    label: 'Keyboard',
    /** The single letter above a key that says which hand plays it (left, right). */
    hands: { L: 'L', R: 'R' },
  },
  view: {
    /** The status line while the score is busy. */
    status: {
      loading: 'Loading the score…',
      fingering: 'Fingering…',
      rendering: 'Preparing the score…',
    },
    /** The status line while the first Play fetches the piano's sounds. */
    loadingPiano: 'Loading the piano…',
    /** The line above the music while it shows the fingering written by the editor. */
    editorialShown: "Showing the editor's fingering",
    /** The status line when the chosen hand has no notes in this piece. */
    noNotesLeft: 'This piece has no notes for the left hand.',
    noNotesRight: 'This piece has no notes for the right hand.',
    noNotes: 'This piece has no notes to play.',
    /** The status line while the red waits for the reader's piano (issue 182); `count` is the notes of the step. */
    playAlongHint: (count: number): string =>
      count > 1 ? 'Play the red notes on your piano.' : 'Play the red note on your piano.',
    /** The status line the first time the timing rings appear in a score view (issue 192): what a ring before and after a note means. */
    timingExplain: 'A ring before a note means it came early; after it, late.',
    /** The button that opens and closes the practice settings (speed, loop, hands). */
    practice: 'Practice',
    /** The button back to the scan that produced this score. */
    scanSource: 'Scan source and recognition',
    /** The error when a dropped file could not be read; `name` is the file or piece name. */
    couldNotOpenFile: (name: string) =>
      `Could not open ${name}. This file could not be read as sheet music. digitus2 opens MusicXML and MIDI files (.musicxml, .xml, .mxl, .mid or .midi).`,
    /** The error when a library piece failed to load or lay out. */
    couldNotOpenPiece: (name: string) =>
      `Could not open ${name}. Something went wrong while preparing this piece. Please try again.`,
    /** The technical reason under the error; `error` is already a sentence fragment. */
    details: (error: string) => `Details: ${error}`,
  },
  side: {
    /** Name of the side panel for screen readers, and its hidden heading. */
    label: 'Piece and fingering',
    facts: {
      level: 'Level',
      /** The musical key of the piece: C major, A minor. */
      key: 'Key',
      /** The time signature of the piece: 4/4, 3/4. */
      time: 'Time',
      length: 'Length',
      /** The number of bars (measures) in the piece. */
      bars: 'Bars',
    },
    /**
     * A musical key: `tonic` is the note's name in this language, `accidental` is '' (natural),
     * '#' (sharp) or 'b' (flat).
     */
    keyName: (tonic: string, accidental: '' | '#' | 'b', mode: 'major' | 'minor') =>
      `${tonic}${accidental} ${mode}`,
    handSize: {
      label: 'Hand size',
      large: 'Large',
      medium: 'Medium',
      small: 'Small',
      child: 'Child',
      help: 'Hand size changes the stretches the fingering allows. Choose child or small for small hands.',
    },
    showEditorial: "Show the editor's fingering",
    exportButton: 'Export MusicXML',
    print: 'Print',
    /** The notice when saving the file failed; `reason` is the error's own message. */
    exportFailed: (reason: string) => `Could not export the score: ${reason}`,
    printPrepareFirst:
      'Cancel this dialog and use the Print button in the score. It prepares the music for paper.',
    printFailed: (reason: string) => `Could not print the score: ${reason}`,
    printHeadingTooLong: 'The title and credits are too long to fit on a printed page.',
    /** The closed disclosure with technical facts. */
    details: 'Details',
    /** Time the fingering took and time the layout took, in milliseconds. */
    timings: (solveMs: number, renderMs: number) =>
      `Fingered in ${solveMs} ms · laid out in ${renderMs} ms`,
  },
  midi: {
    /** Name of the section about a MIDI file that was imported. */
    label: 'MIDI import',
    /** The select that picks the key where the left hand ends and the right hand begins. */
    splitLabel: 'Hand split',
    automatic: 'Automatic',
    splitHelp: 'Keys from the chosen note upward go to the right hand.',
    /**
     * How the import rounded note starts and lengths to a rhythmic grid. Each is a noun phrase
     * that completes the sentence of `importLine`.
     */
    grids: {
      sixteenth: 'a 16th-note grid',
      sixteenthTriplets: 'a 16th-note grid with triplets',
      thirtySecond: 'a 32nd-note grid',
      thirtySecondTriplets: 'a 32nd-note grid with triplets',
    },
    /** `grid` is one of the `grids` phrases; `movedPercent` the share of notes moved a lot. */
    importLine: (grid: string, movedPercent: number) =>
      `Imported from MIDI: notes quantized to ${grid}; ${formatNumber('en', movedPercent)} % moved more than a 64th note`,
    handCounts: (right: number, left: number) =>
      `Right hand: ${notes(right)} · left hand: ${notes(left)}`,
  },
  doc: {
    /** An error shown under "Details"; `status` is the HTTP status code. */
    fetchFailed: (status: number) => `the score file could not be fetched (HTTP ${status})`,
    noPiece: (slug: string) => `there is no piece called "${slug}"`,
    layoutFailed: 'the score could not be laid out, please try again',
  },
};
