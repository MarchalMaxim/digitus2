/**
 * When the library shows each of its controls (spec section 6.1). A threshold is crossed only by
 * a new build of the library or by the reader's own choice, never while the reader looks.
 */
/** Level pills replace the all-levels list when the library holds more than this many pieces. */
export const PILLS_ABOVE = 40;
/** The search field stands in the start row from this many pieces. */
export const SEARCH_FROM = 100;
/** A list section of more than this many pieces groups its rows under collection headings. */
export const HEADINGS_ABOVE = 12;
/** With headings, collections with fewer pieces than this in the section join "Other pieces". */
export const OTHER_BELOW = 3;
/** The genre row appears when the chosen level holds more than this many pieces (L2). */
export const GENRES_ABOVE = 60;
/** A genre gets a pill in a level only with at least this many pieces there. */
export const GENRE_MIN = 3;
/** Collections fold to one line each while the list in view holds more than this (L2). */
export const FOLD_ABOVE = 60;

export const showsPills = (libraryCount: number): boolean => libraryCount > PILLS_ABOVE;
export const showsSearch = (libraryCount: number): boolean => libraryCount >= SEARCH_FROM;
export const showsHeadings = (inSection: number): boolean => inSection > HEADINGS_ABOVE;
export const folds = (inView: number): boolean => inView > FOLD_ABOVE;
