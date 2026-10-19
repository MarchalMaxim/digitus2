// No imports: the e2e specs import this file under Node, where import.meta.env is undefined.

/** A reserved name that never resolves: scanning reports the scanner unreachable. */
export const PLACEHOLDER_SCAN_SERVICE = 'https://scan.digitus2.invalid';
/** The hosted scan service the published app talks to. */
export const DEPLOYED_SCAN_SERVICE = 'https://digitus2-scan-1043309540544.europe-west4.run.app';
/** The scan service origin; a build or a dev server can name another with VITE_SCAN_SERVICE. */
export const SCAN_SERVICE: string =
  (import.meta.env?.VITE_SCAN_SERVICE as string | undefined) || DEPLOYED_SCAN_SERVICE;
