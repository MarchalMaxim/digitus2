import { describe, expect, it } from 'vitest';
import { score as en } from './en/score.js';
import { score as es } from './es/score.js';
import { score as fr } from './fr/score.js';
import { score as nl } from './nl/score.js';
import { score as pt } from './pt/score.js';

// The status line the first time the timing rings appear (issue 192): what a ring before and
// after a note means, in all five languages. French carries a typographic apostrophe and a
// no-break space before the semicolon, as the other French prose does.
describe('the explanation of the timing rings (issue 192)', () => {
  it.each([
    ['en', en, 'A ring before a note means it came early; after it, late.'],
    ['es', es, 'Un círculo antes de una nota significa que llegó antes de tiempo; después, tarde.'],
    [
      'fr',
      fr,
      'Un cercle avant une note signifie qu’elle a été jouée trop tôt\u00a0; après, trop tard.',
    ],
    ['nl', nl, 'Een cirkel vóór een noot betekent dat die te vroeg kwam; erna, te laat.'],
    [
      'pt',
      pt,
      'Um círculo antes de uma nota significa que ela veio cedo demais; depois, tarde demais.',
    ],
  ] as const)('says it in %s', (_lang, messages, text) => {
    expect(messages.view.timingExplain).toBe(text);
  });
});
