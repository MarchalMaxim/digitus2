/**
 * What the review told the reader about one scan (issue 233): the facts a validation case keeps,
 * in the scan archive's scan.json (bundle.ts) and in a case kept by the scan service for an
 * opted-in device (diagnostics.ts). Texts are in English whatever the language on screen, so cases
 * compare across devices.
 */
export interface ReviewFacts {
  /** The verdict line under the title. */
  verdict: string;
  /** Whether Use for fingerings was available when the facts were taken. */
  usable: boolean;
  /** The alert under the buttons, when one was shown. */
  alert?: string | undefined;
  /** Every "Technical reason" line under Recognition details. */
  technical: string[];
  /** The places to check, in order: their text and the printed bar number they point at. */
  places: { text: string; bar?: string | undefined }[];
  /** The page (1-based) the verdict names, when it names one. */
  page?: number | undefined;
  /** How many corrections the reader had made. */
  corrections: number;
  /**
   * The scan's pages in the order on screen, each as `scanIdOf` its id: the scan service names each
   * kept photo with the same id, so a retaken, removed or reordered page is told from an added one.
   */
  pages: string[];
}
