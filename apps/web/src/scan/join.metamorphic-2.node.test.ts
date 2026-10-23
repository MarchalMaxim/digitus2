// @vitest-environment node
import { defineOracle } from './join.metamorphic.js';

// Issue 159: the second share of the metamorphic layout oracle (join.metamorphic.ts).
defineOracle(4, 7, ['burgmuller-op100-no1-la-candeur, page 3 alone']);
