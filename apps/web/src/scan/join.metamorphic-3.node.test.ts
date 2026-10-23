// @vitest-environment node
import { defineOracle } from './join.metamorphic.js';

// Issue 159: the third share of the metamorphic layout oracle (join.metamorphic.ts).
defineOracle(7, 10, [
  'schumann-op68-no1-melody, all split',
  'schumann-op68-no1-melody, page 1 alone',
  'schumann-op68-no1-melody, page 2 alone',
]);
