import '@testing-library/jest-dom/vitest';

// The library list and the pieces' details are fetched in the app; the tests read the same files
// directly.
import indexJson from '../../../../content/library-index.json';
import manifestJson from '../../../../content/manifest.json';
import {
  setLibraryIndex,
  setPieceDetails,
  type LibraryEntry,
  type LibraryPiece,
} from '../library/manifest.js';

setLibraryIndex(indexJson as LibraryEntry[]);
setPieceDetails(manifestJson as LibraryPiece[]);
