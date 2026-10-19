// The embellisher's public surface (issue #67): light diminution of a library melody.
export { embellishMusicXml } from './embellish.js';
export type {
  EmbellishOptions,
  EmbellishResult,
  EmbellishRule,
  InsertedNote,
} from './embellish.js';
export { checkEmbellishment } from './check.js';
export type { EmbellishCheck } from './check.js';
export { LEVEL_CUTS, levelFeatures, levelScore, proposeLevel, round3 } from './level.js';
export type { LevelFeatures } from './level.js';
export { EMBELLISH_MIN_FIGURES, GUARD_PROFILES, guardEmbellishment, guardErrors } from './guard.js';
export type { Embellishment, GuardOptions, GuardOutcome } from './guard.js';
