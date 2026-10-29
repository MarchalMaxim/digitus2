export { ENGINE_VERSION } from './version.js';
export * from './score/types.js';
export * from './score/pitch.js';
export * from './score/build.js';
export { ornamentAttacks } from './score/ornaments.js';
export type { OrnamentAttack } from './score/ornaments.js';
export { parsePig, parseFingerField, PIG_HEADER, PIG_DIVISIONS, PIG_QPM } from './io/pig/read.js';
export type { ParsedPig } from './io/pig/read.js';
export { writePig } from './io/pig/write.js';
export { parseMusicXml } from './io/musicxml/read.js';
export type { ParsedMusicXml, TieRepair } from './io/musicxml/read.js';
export { unpackMusicXml } from './io/musicxml/unpack.js';
export { injectFingerings } from './io/musicxml/write.js';
// The xmldom helpers in io/musicxml/dom.ts (parseXml, serializeXml, childElements, ...) stay
// internal so the public API does not grow around one XML library; timewiseToPartwise takes and
// returns an @xmldom/xmldom Document for callers that already hold one.
export { timewiseToPartwise } from './io/musicxml/timewise.js';
export { matchRate, pigMetrics } from './eval/metrics.js';
export type { FingerSeq, PigMetrics } from './eval/metrics.js';
export { alignScores, fingerSeq, metricsForScores } from './eval/align.js';
export {
  applyLevel,
  LEVEL_LINT_RULES,
  LEVEL_PROFILES,
  LEVEL_PROFILES_SCHEMA,
  LEVELS,
  solveFingering,
  solveHand,
  validateLevelProfiles,
} from './fingering/solve.js';
export type {
  SolveOptions,
  SolveResult,
  HandSolution,
  NoteExplanation,
  ExplainedTerm,
  HandConstraints,
  Level,
  LevelLintCosts,
  LevelLintRule,
  LevelProfile,
} from './fingering/solve.js';
export {
  loadWeightSet,
  RECOMMENDED_WEIGHT_SET,
  validateWeightSet,
  WEIGHT_SET_SCHEMA,
  WEIGHT_SETS,
} from './fingering/params/weightSets.js';
export type {
  WeightSetCorpus,
  WeightSetFile,
  WeightSetId,
  WeightSetProvenance,
  WeightSetValidation,
} from './fingering/params/weightSets.js';
export {
  buildHandSequence,
  FIVE_FINGER_KEYS,
  FIVE_FINGER_SPAN,
  GRACE_IOI_SEC,
  isThumbCrossing,
  pairWindows,
  POSITION_WINDOW,
} from './fingering/sequence.js';
export type { HandSequence, SeqNote } from './fingering/sequence.js';
export { dot, featureIds, pathFeatures } from './learn/features.js';
export type { FeatureVector } from './learn/features.js';
export { Lcg } from './learn/lcg.js';
export { evaluateExamples, train } from './learn/perceptron.js';
export type {
  EpochInfo,
  ExampleEvaluation,
  TrainOptions,
  TrainResult,
} from './learn/perceptron.js';
export {
  calibrate,
  confidenceOf,
  confidenceSample,
  confidenceSamples,
  expectedCalibrationError,
  fitTemperature,
  negativeLogLikelihood,
  PENALTY_MARGIN,
  targetOf,
} from './learn/calibration.js';
export type {
  CalibrationBucket,
  CalibrationReport,
  ConfidenceSample,
  LikelihoodOptions,
} from './learn/calibration.js';
export {
  HAND_PROFILES,
  PARNCUTT_TABLES,
  resolveProfile,
  scaleTables,
  span,
} from './fingering/spans.js';
export type {
  HandProfile,
  HandProfileId,
  SpanKind,
  SpanMatrix,
  SpanTables,
} from './fingering/spans.js';
export {
  PARNCUTT_WEIGHTS,
  makeContext,
  pairTerms,
  tripleTerms,
  unaryTerms,
  weightedSum,
} from './fingering/rules.js';
export type { RuleContext, RuleId, RuleWeights, Term, NoteView } from './fingering/rules.js';
export { decode } from './fingering/viterbi.js';
export type { DecodeProblem, DecodeResult } from './fingering/viterbi.js';
export { isBlack, MIRROR_SUM, mirrorPitch, whiteColumn, x14 } from './fingering/geometry.js';
export {
  detectRuns,
  matchTemplates,
  templateFingerAt,
  TEXTBOOK_TEMPLATES,
} from './fingering/templates.js';
export type { Run, TemplateMatch } from './fingering/templates.js';
export { lintFingering, LINT_RULES, positionChanges, wideStretches } from './lint/index.js';
export type {
  LintReport,
  LintOptions,
  LintIssue,
  LintRuleId,
  LintSeverity,
  WideStretch,
} from './lint/index.js';
export {
  evaluateTextbook,
  normalizeTextbookEntries,
  scoreFromTextbookEntry,
} from './eval/textbook.js';
export type { TextbookEntry, TextbookReport, TextbookFamilyStats } from './eval/textbook.js';
export {
  runMetamorphic,
  transposeScore,
  mirrorScore,
  duplicateScore,
  perturbLastNote,
} from './eval/metamorphic.js';
export type { MetamorphicCheck, MetamorphicId, MetamorphicReport } from './eval/metamorphic.js';
export { hardErrors } from './eval/hardErrors.js';
export * from './io/midi/index.js';
export { evaluateHands, scoreToMidiData } from './eval/hands.js';
export type { HandEval } from './eval/hands.js';
export { evaluateOmr } from './eval/omr.js';
export type { OmrMetric, OmrMetrics, OmrBarEvaluation, OmrEvaluation } from './eval/omr.js';
export * from './embellish/index.js';
export {
  buildHandModel,
  handSign,
  inferFingering,
  INITIAL_PLAYER_STATE,
  nearest,
  readEvent,
  readEvents,
  readHand,
  steps,
} from './readability/player.js';
export type {
  EventReading,
  HandModel,
  HandReading,
  InferResult,
  Pitched,
  PlayerState,
  ReaderRule,
  ReadContext,
  Seen,
} from './readability/player.js';
export {
  DEFAULT_CONFIDENCE_FLOOR,
  DENSITY_TARGET,
  digitBudget,
  greedyReduction,
  reduceFingering,
} from './readability/reduce.js';
export type { PrintReason, ReduceOptions, ReduceResult } from './readability/reduce.js';
export { editorDigits } from './readability/editorDigits.js';
export type { EditorDigits } from './readability/editorDigits.js';
