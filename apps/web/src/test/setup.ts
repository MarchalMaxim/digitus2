import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { vi } from 'vitest';

// A wait for something the page does later (waitFor, findBy…, vi.waitFor) ends as soon as it is
// true, so its limit only says when to give up: 2 minutes, not the libraries' 1 s, which a loaded CI
// runner can spend before a promise settles and a render commits. A test never asserts on what an
// effect or a promise will set without waiting for it.
export const WAIT_MS = 120_000;
configure({ asyncUtilTimeout: WAIT_MS });
const waitFor = vi.waitFor.bind(vi);
vi.waitFor = ((callback, options) =>
  waitFor(
    callback,
    typeof options === 'number' ? options : { timeout: WAIT_MS, ...options },
  )) as typeof vi.waitFor;

// The library list and the pieces' details are fetched in the app; the tests read the same files
// directly.
import indexJson from '../../../../content/library-index.json';
import manifestJson from '../../../../content/manifest.json';
import {
  decodeLibraryIndex,
  setLibraryIndex,
  setPieceDetails,
  type LibraryPiece,
} from '../library/manifest.js';

setLibraryIndex(decodeLibraryIndex(indexJson));
setPieceDetails(manifestJson as LibraryPiece[]);
