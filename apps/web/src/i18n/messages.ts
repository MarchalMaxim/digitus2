import type { en } from './en/index.js';

/**
 * Every text the app shows, by view: English is the source, and each other language is typed
 * against it, so a missing or extra key fails the typecheck. A text is a string, or a function
 * of its values when it holds any (a count, a name); a function writes its own plurals and
 * numbers with format.ts.
 */
export type Messages = typeof en;

/** A text chosen outside a component (a notice, an error), written when it is shown. */
export type Phrase = (t: Messages) => string;
