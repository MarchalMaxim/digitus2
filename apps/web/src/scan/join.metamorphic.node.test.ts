// @vitest-environment node
import { defineOracle, defineOwnerPages } from './join.metamorphic.js';

// Issue 159: the first share of the metamorphic layout oracle (join.metamorphic.ts).
defineOracle(0, 4, ['bach-invention-no1-bwv-772, page 2 alone']);
defineOwnerPages();
