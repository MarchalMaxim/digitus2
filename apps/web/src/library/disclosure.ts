/**
 * When the library shows each of its controls (shelves spec, sections 2 to 4). A threshold is
 * crossed only by a new build of the library or by the reader's own choice, never while the
 * reader looks.
 */
/** Level pills and shelves replace the all-levels list when the library holds more than this many pieces. */
export const PILLS_ABOVE = 40;
/** The search field stands in the start row from this many pieces. */
export const SEARCH_FROM = 100;
/** A list section of more than this many pieces groups its rows under collection headings. */
export const HEADINGS_ABOVE = 12;
/** With headings, collections with fewer pieces than this in the section join "Other pieces". */
export const OTHER_BELOW = 3;
/** A shelf on the arrival page shows this many sample rows at most (the rule of 7). */
export const SAMPLES = 5;
/** An opened shelf or search section arrives in pages of this many rows. */
export const PAGE_SIZE = 40;
/** A search section shows this many rows before `All {n} in {Level}`. */
export const SECTION_ROWS = 7;
/** The length pills appear when the list in view holds more than this many pieces. */
export const LENGTH_ABOVE = 40;

export const showsPills = (libraryCount: number): boolean => libraryCount > PILLS_ABOVE;
export const showsSearch = (libraryCount: number): boolean => libraryCount >= SEARCH_FROM;
export const showsHeadings = (inSection: number): boolean => inSection > HEADINGS_ABOVE;
export const showsLengths = (inList: number): boolean => inList > LENGTH_ABOVE;
