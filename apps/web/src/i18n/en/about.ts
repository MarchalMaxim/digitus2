import { formatNumber, plural } from '../format.js';

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** 5 -> 'Five'; numbers past nine stay digits. */
const count = (n: number) => NUMBER_WORDS[n] ?? formatNumber('en', n);

/**
 * The about texts in English, the source every other language must match (messages.ts). A word in
 * [square brackets] is a link: keep the brackets around the words that should be the link.
 */
export const about = {
  back: 'Back to the library',
  title: 'About digitus2',
  what: {
    heading: 'What this is',
    body: 'digitus2 writes finger numbers on piano music for beginning and intermediate players.',
  },
  how: {
    heading: 'How the fingerings are chosen',
    /** `version` is the engine's version number. */
    body: (version: string) =>
      'The engine scores every possible fingering with ergonomic rules from the piano-fingering ' +
      'literature (finger spans, thumb crossings, weak fingers, black keys, hand position ' +
      'changes) and picks the cheapest one for the whole piece with an exact search. Your hand ' +
      `size changes the spans it allows. The engine version is ${version}.`,
  },
  who: {
    heading: 'Who made it',
    body:
      'Created by Claude, Anthropic’s AI model, in an autonomous multi-day build directed by ' +
      'Maxim Marchal. To our knowledge, nothing like this exists yet: a fingering engine ' +
      'verified against expert annotations. The code, the research notes and the verification ' +
      'results are in the [repository].',
  },
  licences: {
    heading: 'Licences',
    digitus2: '[digitus2] is free software under the MIT licence.',
    verovio: 'Music engraving by [Verovio], LGPL-3.0-or-later, used as an unmodified library.',
    pdfjs: 'PDF previews use [PDF.js] ([Apache-2.0]).',
    midiFile: 'MIDI files are read with [midi-file] (MIT).',
    piano: 'Piano sound: [smplr] (MIT) playing the [Splendid Grand Piano] samples (public domain).',
  },
  pieces: {
    heading: 'The built-in pieces',
    intro: 'The pieces use public-domain or Creative Commons editions.',
    /** A number written as a word up to nine, capitalised, as the start of a sentence. */
    count,
    /**
     * The sentence above the table. `shareAlike` engravings are CC BY-SA, `attribution` are CC BY
     * (often none, then the sentence leaves CC BY out). All are credited on the page.
     */
    credit: (shareAlike: number, attribution: number) => {
      const credited = 'credited here and on their score pages.';
      if (shareAlike === 1 && attribution === 0)
        return 'One engraving is shared under CC BY-SA and is credited here and on its score page.';
      const start = `${count(shareAlike)} engravings are shared under CC BY-SA and`;
      return attribution === 0
        ? `${start} are ${credited}`
        : `${start} ${count(attribution).toLowerCase()} under CC BY; all are ${credited}`;
    },
    columns: { piece: 'Piece', composer: 'Composer', engraving: 'Engraving', licence: 'Licence' },
    /** The engraving of a piece arranged for the app itself. */
    arrangement: 'digitus2 arrangement',
    unnamedTypesetter: 'Unnamed typesetter',
    /** The MuseScore archive pieces, counted instead of listed. `n` is at least one. */
    archive: (n: number) =>
      plural('en', n, { one: '# more score comes', other: '# more scores come' }) +
      ' from the MuseScore archive (the PDMX dataset). Each is public domain or CC0 as its ' +
      'uploader declared it, and each names its source and licence on its score page.',
  },
};
