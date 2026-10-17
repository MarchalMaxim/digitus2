import { en } from './en/index.js';
import type { Phrase } from './messages.js';

/**
 * An error the reader is shown: its message is the English text (for logs and tests), and the
 * page writes `phrase` in the language on screen (messageOf in app/errors.ts).
 */
export class PhraseError extends Error {
  constructor(readonly phrase: Phrase) {
    super(phrase(en));
  }
}
