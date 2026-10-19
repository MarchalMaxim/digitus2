import { plural } from '../format.js';

/** The scan texts in English, the source every other language must match (messages.ts). */
export const scan = {
  view: {
    back: 'Back to library',
    experimental: 'Experimental scan',
    titleStart: 'From paper to piano',
    titleReview: 'Review the recognition',
    /** Shown instead of a file name when several page photos are scanned as one score. */
    pageImages: (n: number) => plural('en', n, { one: '# page image', other: '# page images' }),
    advice:
      'Original PDFs and flat, high-resolution scans work best. Book photos can fail, even when well lit. Results open beside the original for review.',
    /** The "PC worker" is a small program the reader runs on their own computer to recognise scores. */
    workerNeeded: 'Scanning needs the PC worker running on this computer.',
    connect: 'Connect to this PC',
    connecting: 'Connecting…',
    cancelScan: 'Cancel scan',
    cancelling: 'Cancelling…',
    retryFailed: 'Retry failed pages',
    scanScore: 'Scan this score',
    scanning: 'Recognizing on this PC… Usually a few seconds; longer pages can take a few minutes.',
    scanningPage: (page: number, total: number) =>
      `Page ${page} of ${total} · Recognizing on this PC… Usually a few seconds; longer pages can take a few minutes.`,
    connected: 'PC connected.',
    textModelMissing:
      'English text recognition is not configured. Musical text may be missing. See setup below.',
    original: 'Original',
    openPdf: 'Open original PDF',
    openImage: 'Open original image',
    preparingPdf: 'Preparing original PDF…',
    originalAlt: 'Original printed score',
  },
  setup: {
    summary: 'Set up the PC worker',
    install:
      'On the PC running this browser, open the digitus2 project folder. Install the photo and PDF recognizers once, then start the worker when you need it.',
    keepOpen:
      'Keep that terminal open. Allow the browser’s local connection after pressing Connect. To stop processing, close the worker.',
    help: 'Setup and troubleshooting',
  },
  review: {
    caveat:
      'Recognition may contain errors in notes, rhythms, ties or hands. Text and tempo may be incomplete. No fingerings have been added yet.',
    recognized: 'Recognized notation',
    /** Completes "Score of …" in the name of the notation (ScoreSheet). */
    sheetLabel: 'raw scan recognition',
    viewLabel: 'Recognition view',
    pageRecognition: 'Page recognition',
    combinedScore: 'Combined score',
    pageShown: (page: number) => `Recognition of page ${page}`,
    allPages: 'All pages in reading order',
    preparing: 'Preparing recognized notation…',
    /** `error` is the reason, already written as a sentence. */
    problem: (error: string) =>
      `${error} Correct the notes here, download the raw file for a notation editor, or try another image.`,
    /** The same, in page review, when the combined score can be corrected. */
    problemInCombined: (error: string) =>
      `${error} Correct the notes in the combined score, download the raw file for a notation editor, or try another image.`,
    /** The same, when the recognition cannot be corrected here. */
    problemReadOnly: (error: string) =>
      `${error} Download the raw file for a notation editor, or try another image.`,
    detailsSummary: 'Recognition details',
    /** The disclosure holding the MusicXML downloads. */
    filesSummary: 'Files for a notation editor',
    /** Under Recognition details: the importer's or renderer's own message. */
    technical: (reason: string) => `Technical reason: ${reason}`,
    retained:
      'Find retained originals and recognition in My scores. Keep your own original files; browser storage can be cleared. Recognition is not certified accurate; playback tempo may use an app default.',
    beamGrouping: 'Beam grouping is inferred and may differ from the original.',
    /** Shown when several scanned pages are joined into one score. */
    graphicSpanWarning:
      'Slurs and other notation spans are kept within each scanned page. Compare continuations at page edges; missing endpoints have not been repaired.',
    /** The worker found a piano page read as one staff: shown above the comparison. */
    grandStaffWarning:
      'The staves were not paired into a grand staff, so both hands are read as one. Use for fingerings would give wrong hands: try a flatter, evenly lit photo or the original PDF.',
    unknownWarning: 'The recognizer reported an unknown warning. Check the original carefully.',
    downloadPagesSummary: 'Download individual page files',
    downloadPage: (page: number) => `Download page ${page} MusicXML`,
    downloadCombined: 'Download combined MusicXML',
    downloadRaw: 'Download raw MusicXML',
    useForFingerings: 'Use for fingerings',
    scanAgain: 'Scan again',
  },
  /** Correcting the recognised notation, note by note, inside the review. */
  edit: {
    hint: 'Select a note to correct it.',
    /** The sheet's description for keyboard and screen-reader users. */
    keys: 'Enter selects the first note. Left and Right select the previous or next note, Up and Down change its pitch (with Shift, an octave), Escape closes the editor.',
    /** "C4", "B♭3": a pitch with its octave, in the names this language uses. */
    pitch: (step: string, alter: number, octave: number) =>
      `${step}${alter > 0 ? '♯︎'.repeat(alter) : '♭︎'.repeat(-alter)}${octave}`,
    bar: (bar: string) => `Bar ${bar}`,
    rightHand: 'right hand',
    leftHand: 'left hand',
    staff: (staff: number) => `staff ${staff}`,
    lengths: {
      whole: 'whole',
      half: 'half',
      quarter: 'quarter',
      eighth: 'eighth',
      '16th': '16th',
      '32nd': '32nd',
    } as Record<string, string>,
    /** `length` is one of the lengths above. */
    noteLength: (length: string, dotted: boolean) => `${dotted ? 'dotted ' : ''}${length} note`,
    restLength: (length: string, dotted: boolean) => `${dotted ? 'dotted ' : ''}${length} rest`,
    tied: 'tied',
    /** Joins the parts of a note's description: "Bar 11 · right hand · A4 quarter note". */
    describe: (parts: string[]) => parts.join(' · '),
    panelLabel: 'Correct the selected note',
    pitchLabel: 'Pitch',
    lower: 'Lower',
    lowerLabel: 'Lower by one step',
    higher: 'Higher',
    higherLabel: 'Higher by one step',
    flat: 'Flat',
    natural: 'Natural',
    sharp: 'Sharp',
    lengthLabel: 'Length',
    /** Button labels for the note lengths, short enough for a phone. */
    lengthButtons: {
      whole: 'Whole',
      half: 'Half',
      quarter: 'Quarter',
      eighth: 'Eighth',
      '16th': '16th',
      '32nd': '32nd',
    } as Record<string, string>,
    dotted: 'Dotted',
    tieNext: 'Tied to next',
    tiePrevious: 'Tied from previous',
    toLeftHand: 'To left hand',
    toRightHand: 'To right hand',
    remove: 'Remove',
    /** A rest the recognition put where the page has a note. */
    makeNote: 'Make it a note',
    previous: 'Previous note',
    next: 'Next note',
    done: 'Done',
    /** One hand's length in a bar, as in "right hand 3 beats". */
    handBeats: (hand: string, beats: number) =>
      `${hand} ${plural('en', beats, { one: '# beat', other: '# beats' })}`,
    /** "Bar 11: right hand 3 beats, left hand 3 beats, in 3/4." */
    timing: (bar: string, hands: string[], meter?: string) =>
      `${bar}: ${hands.join(', ')}${meter ? `, in ${meter}` : ''}.`,
    corrections: (n: number) => plural('en', n, { one: '# correction', other: '# corrections' }),
    undo: 'Undo',
    reset: 'Reset to recognition',
    resetDone: 'All corrections removed. Undo brings them back.',
    /** Read out after Undo; `what` is the correction taken back, or empty. */
    undone: (what: string) => (what ? `Undone: ${what}.` : 'Undone.'),
    listSummary: 'Review corrections',
    /** The corrections as listed; `where` is "Bar 11, right hand". */
    changed: {
      pitch: (where: string, from: string, to: string) => `${where}: ${from} → ${to}`,
      duration: (where: string, pitch: string, from: string, to: string) =>
        `${where}: ${pitch} ${from} → ${to}`,
      tie: (where: string, pitch: string) => `${where}: ${pitch} tied to the next ${pitch}`,
      untie: (where: string, pitch: string) => `${where}: tie on ${pitch} removed`,
      hand: (where: string, pitch: string, hand: string) =>
        `${where}: ${pitch} moved to the ${hand}`,
      removed: (where: string, pitch: string) => `${where}: ${pitch} removed`,
      /** `bar` is the bar's printed number; `from` is absent when no meter was recognised. */
      meter: (bar: string, from: string | undefined, to: string) =>
        `From bar ${bar}: time signature ${from ? `${from} → ` : ''}${to}`,
    },
    /** Offered on a place to check when the hands agree but overrun the time signature. */
    setMeter: (meter: string, bar: string) => `Set ${meter} time from bar ${bar}`,
    stale: (kept: number) =>
      `Some saved corrections no longer apply to this recognition. The first ${kept} are kept.`,
    problemsSummary: (n: number) =>
      plural('en', n, { one: '# place to check', other: '# places to check' }),
    problems: {
      tieGap: (where: string, pitch: string, gap: string) =>
        `${where}: the tied ${pitch} ends ${gap} before the next ${pitch} begins. Check the note lengths.`,
      tieEarly: (where: string, pitch: string, gap: string) =>
        `${where}: the tied ${pitch} runs ${gap} into the next ${pitch}. Check the note lengths.`,
      tieUnmatched: (where: string, pitch: string) =>
        `${where}: a tie on ${pitch} has no matching note.`,
      /** `timing` is the sentence from `timing` above. */
      barTiming: (timing: string) => `The hands disagree. ${timing}`,
      /** The hands agree, but the bar runs past the time signature. */
      barLong: (timing: string) => `The bar is longer than its time signature. ${timing}`,
    },
    /** A gap as a length: "a quarter note", "2 beats". */
    gap: (beats: number) => plural('en', beats, { one: '# beat', other: '# beats' }),
    downloadCorrected: 'Download corrected MusicXML',
    correctedSheetLabel: 'corrected scan recognition',
    refused: {
      missing: 'This note is no longer in the score.',
      rest: 'A rest has no pitch to change.',
      range: 'That pitch is outside the piano’s range.',
      grace: 'A grace note takes no time, so its length cannot be changed here.',
      tuplet:
        'The length of a note in a triplet or other tuplet cannot be changed here. Use a notation editor.',
      unwritable: 'This length cannot be written in this score.',
      otherHand:
        'This change would move notes in the other hand or voice, so it was not made. Check the bar in a notation editor.',
      noTieTarget: (pitch: { step: string; alter: number; octave: number }) =>
        `No ${scan.edit.pitch(pitch.step, pitch.alter, pitch.octave)} starts where this note ends, so it cannot be tied. Correct the lengths first.`,
      noTieSource: (pitch: { step: string; alter: number; octave: number }) =>
        `No ${scan.edit.pitch(pitch.step, pitch.alter, pitch.octave)} ends where this note starts, so it cannot be tied.`,
      tieTaken: 'The next note is already tied from another note.',
      tiedRemove: 'Remove this note’s tie before removing the note.',
      chordLengths: 'The chord’s notes have different lengths. Change the length first.',
      oneStaff: 'This score has a single staff.',
      meter: 'That time signature cannot be written here.',
      noBar: 'This bar is no longer in the score.',
      sameMeter: (meter: string) => `The bar is already in ${meter}.`,
    },
  },
  /** On a phone or tablet, which cannot reach the PC worker. */
  phone: {
    takePhoto: 'Take a photo',
    takeAnother: 'Take another photo',
    explain:
      'Recognition runs on a PC, and a phone cannot reach it. Send these photos to your PC, then open them there to scan.',
    share: 'Send photos to your PC',
    save: 'Save photos',
    shareTitle: 'Score photos',
    shared: 'Photos handed over. Open them on your PC with “Open your own score”.',
    saved:
      'Photos saved to this device. Move them to your PC, then open them with “Open your own score”.',
  },
  errors: {
    notCombinedSaved:
      'The pages were recognized, but their notation could not be combined. Individual page files are available below.',
    somePagesFailed: 'Some pages need another scan. Recognized pages are kept.',
    recognitionFailed: 'Recognition failed.',
    notationNotShown:
      'Notation could not be displayed. The technical reason is under Recognition details.',
    noNotes: 'No playable notes were recognized.',
    notUsable:
      'This recognition cannot be used for fingerings yet: some of its notes do not fit together.',
    offline: 'Could not reach the scanner. Check your connection and try again.',
    cancelFailed: 'Could not confirm cancellation. Close the worker terminal to stop processing.',
    timedOut: 'Recognition timed out. Try a smaller, clearer page.',
    notRecognized:
      'The PC could not recognize a complete score from this page. Try the original PDF or a flatter, higher-resolution image.',
  },
  pager: {
    previous: 'Previous',
    next: 'Next',
    previousLabel: 'Previous original page',
    nextLabel: 'Next original page',
    pageOf: (page: number, total: number) => `Page ${page} of ${total}`,
    navLabel: 'Original page navigation',
  },
  preview: {
    unavailable: (reason: string) => `Preview unavailable: ${reason}`,
    openToCompare: 'Open the original PDF above to compare all pages.',
    canvasMissing: 'Canvas is not available.',
    pageLabel: (page: number) => `Original PDF, page ${page}`,
  },
  pages: {
    arrange: 'Arrange pages in reading order. Drag a thumbnail or select a page to move it.',
    /** On a touch screen, where pages cannot be dragged. */
    arrangeTouch: 'Arrange pages in reading order: select a page, then move it with the arrows.',
    originalCount: (n: number) =>
      plural('en', n, {
        one: '# original page, in reading order.',
        other: '# original pages, in reading order.',
      }),
    listLabel: 'Score pages',
    select: (page: number, name: string) => `Select page ${page}: ${name}`,
    needsRetry: 'Needs retry',
    recognized: 'Recognized',
    ready: 'Ready to scan',
    rotate: 'Rotate 90° clockwise',
    cancelRotation: 'Cancel rotation',
    rotating: 'Rotating image…',
    moveEarlier: 'Move earlier',
    moveEarlierLabel: (page: number) => `Move page ${page} earlier`,
    moveLater: 'Move later',
    moveLaterLabel: (page: number) => `Move page ${page} later`,
    remove: 'Remove page',
    removeLabel: (page: number) => `Remove page ${page}`,
    addImages: 'Add page images',
    finishFirst: 'Finish this scan before adding more pages.',
    pageError: (page: number, error: string) => `Page ${page}: ${error}`,
    altPage: (page: number) => `Original printed score, page ${page}`,
    alt: 'Original printed score',
    rotated: (degrees: number) => `Rotated ${degrees}° clockwise for scanning. Original file kept.`,
  },
  files: {
    pageLimit: 'Choose up to 20 page images at a time.',
    imagesOrOneFile: 'Choose page images together, or open one PDF, MusicXML or MIDI file.',
    fileTypes: 'Choose a PNG, JPEG or PDF up to 10 MB.',
    contentMismatch: 'The file contents do not match its PNG, JPEG or PDF extension.',
  },
  rotation: {
    unreadable: 'This image could not be rotated. Try another PNG or JPEG.',
    tooLargeChoose:
      'This image is too large to rotate here (maximum 16 megapixels). Choose a smaller image. Your current image is unchanged.',
    tooLarge:
      'This image is too large to rotate here (maximum 16 megapixels). Your current image is unchanged.',
    originalTooBig: 'Choose an image up to 10 MB to rotate.',
    browserCannot: 'This browser could not rotate the image. Your current image is unchanged.',
    failed: 'This image could not be rotated. Your current image is unchanged.',
    resultTooBig:
      'The rotated image exceeds 10 MB. Choose a smaller image. Your current image is unchanged.',
  },
  client: {
    busy: 'The scanner is busy with another score. Try again in a minute.',
    limited: 'You have scanned a lot in the past hour. Try again later.',
    serviceStatus: (status: number) =>
      `The scanner could not answer (error ${status}). Try again later.`,
    outdated: 'Reload the page to scan: the scanner has been updated.',
    noResult: 'The scanner returned no score.',
    invalidJob: 'Invalid scan job.',
  },
  join: {
    /** `reason` is a short explanation from the list below. */
    refused: (reason: string) =>
      `These pages cannot be combined safely: ${reason}. Download each page for correction in a notation editor.`,
    reasons: {
      noPages: 'no recognized pages',
      entities: 'XML entities are unsupported',
      notPartwise: 'expected partwise MusicXML',
      repeats: 'repeat or jump navigation needs manual review',
      transposition: 'transposition or special staff/measure attributes need manual review',
      partLayout: 'incomplete part layout',
      partOrder: 'part order differs from the part list',
      measureCounts: 'parts have unequal measure counts',
      startingSetup: (page: number) =>
        `page ${page} needs explicit starting divisions, key, time and clefs`,
      staffLayout: 'incomplete starting staff layout',
      staffChange: 'staff layout changes inside a page',
      instrumentUndeclared: 'instrument reference has no declaration',
      partCounts: 'part counts differ',
      layoutsDiffer: 'part or staff layouts differ',
      instrumentsDiffer: 'instrument layouts differ',
      duplicateIds: 'duplicate XML IDs inside one page',
      unresolvedId: 'unresolved XML ID reference',
      spanNumber: 'invalid graphic span number',
      spanOverflow: 'more than 16 page-specific numbers for one notation span type',
    },
  },
};
