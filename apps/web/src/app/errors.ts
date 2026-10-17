import { messages } from '../i18n/i18n.js';
import type { Messages } from '../i18n/messages.js';
import { PhraseError } from '../i18n/PhraseError.js';

/**
 * The message of anything thrown, for the reader: a PhraseError written in the language on screen
 * (or `t`), an Error's message, else the value as text.
 */
export function messageOf(e: unknown, t: Messages = messages()): string {
  if (e instanceof PhraseError) return e.phrase(t);
  return e instanceof Error ? e.message : String(e);
}
