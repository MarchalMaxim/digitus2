export { ENGINE_VERSION } from './version.js';
export * from './score/types.js';
export * from './score/pitch.js';
export * from './score/build.js';
export { parsePig, parseFingerField, PIG_HEADER, PIG_DIVISIONS, PIG_QPM } from './io/pig/read.js';
export type { ParsedPig } from './io/pig/read.js';
export { writePig } from './io/pig/write.js';
export { parseMusicXml } from './io/musicxml/read.js';
export type { ParsedMusicXml } from './io/musicxml/read.js';
export { unpackMusicXml } from './io/musicxml/unpack.js';
export { injectFingerings } from './io/musicxml/write.js';
// The xmldom helpers in io/musicxml/dom.ts (parseXml, serializeXml, childElements, ...) stay
// internal so the public API does not grow around one XML library; timewiseToPartwise takes and
// returns an @xmldom/xmldom Document for callers that already hold one.
export { timewiseToPartwise } from './io/musicxml/timewise.js';
export { matchRate, pigMetrics } from './eval/metrics.js';
export type { FingerSeq, PigMetrics } from './eval/metrics.js';
export { alignScores, fingerSeq, metricsForScores } from './eval/align.js';
export { solveFingering, solveHand } from './fingering/solve.js';
export type {
  SolveOptions,
  SolveResult,
  HandSolution,
  NoteExplanation,
  ExplainedTerm,
  HandConstraints,
} from './fingering/solve.js';
export { buildHandSequence, GRACE_IOI_SEC } from './fingering/sequence.js';
export type { HandSequence, SeqNote } from './fingering/sequence.js';
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
export { lintFingering, LINT_RULES } from './lint/index.js';
export type { LintReport, LintOptions, LintIssue, LintRuleId, LintSeverity } from './lint/index.js';
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
