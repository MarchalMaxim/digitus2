import '@testing-library/jest-dom/vitest';

// The library list is fetched in the app (main.tsx); the tests read the same file directly.
import indexJson from '../../../../content/library-index.json';
import { setLibraryIndex, type LibraryEntry } from '../library/manifest.js';

setLibraryIndex(indexJson as LibraryEntry[]);
