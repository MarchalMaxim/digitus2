/** The app shell's texts in English, the source every other language must match (messages.ts). */
export const app = {
  /** main.tsx, when the library list cannot be fetched and nothing else can render. */
  listFailed: 'digitus2 could not load its piece list. Check the connection and reload the page.',
  /** Shown while the scan screen's code is fetched (App.tsx). */
  openingScan: 'Opening scan...',
  /**
   * The notice after a reload on a score that was opened from a file or a scan. "My scores" is the
   * name of the reader's own collection in the library.
   */
  fileNotRestorable: 'Open it from My scores, or choose the file again.',
  /** The name of the light and dark switch, pressed while the page is dark. */
  darkTheme: 'Dark theme',
  /**
   * The score cannot load because the background worker that reads and fingers it stopped.
   * `detail` is the browser's own explanation, in English; it may be empty.
   */
  engineFailed: (detail: string) =>
    detail ? `the engine worker failed: ${detail}` : 'the engine worker failed',
};
