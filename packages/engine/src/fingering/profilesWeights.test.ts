import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateTextbook,
  normalizeTextbookEntries,
  scoreFromTextbookEntry,
} from '../eval/textbook.js';
import { parseMusicXml } from '../io/musicxml/read.js';
import { parsePig } from '../io/pig/read.js';
import { dot, pathFeatures } from '../learn/features.js';
import { lintFingering, positionChanges, wideStretches } from '../lint/index.js';
import type { LintReport, LintRuleId } from '../lint/index.js';
import type { Assignment, Finger, Hand, Score } from '../score/types.js';
import profilesJson from './params/profiles-weights.json' with { type: 'json' };
import { loadWeightSet } from './params/weightSets.js';
import { isPenaltyRule, makeContext, RULE_IDS } from './rules.js';
import type { RuleId } from './rules.js';
import { buildHandSequence, isCrossing, isThumbCrossing } from './sequence.js';
import type { SeqNote } from './sequence.js';
import {
  applyLevel,
  LEVEL_LINT_RULES,
  LEVEL_PROFILES,
  solveFingering,
  solveHand,
  validateLevelProfiles,
} from './solve.js';
import type { HandConstraints, Level, LevelLintCosts, SolveOptions, SolveResult } from './solve.js';
import { HAND_PROFILES } from './spans.js';
import type { HandProfileId } from './spans.js';

const repo = new URL('../../../../', import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, repo)));
const manifest = JSON.parse(read('content/manifest.json').toString('utf8')) as Array<{
  slug: string;
  level: number;
  files: { score: string };
}>;
/** The library pieces of level 1 to 3, parsed once. */
const LIBRARY = manifest
  .filter((p) => p.level <= 3)
  .map((p) => ({
    slug: p.slug,
    level: p.level,
    score: parseMusicXml(read(`content/${p.files.score}`)).score,
  }));
const PROFILES = ['medium', 'large'] as const;
/**
 * Timeout of the tests that solve the library (22 pieces, two levels, two hands) or the textbook
 * oracle (up to 336 entries, two levels, two hands): whichever runs first pays for the solves.
 */
const HEAVY = 60_000;

/** learned-open fingerings of a library piece, solved once per level and hand profile. */
const solved = new Map<string, Assignment>();
function solve(slug: string, score: Score, level: Level, profile: HandProfileId): Assignment {
  const key = `${slug} ${level} ${profile}`;
  let a = solved.get(key);
  if (!a) {
    a = solveFingering(score, { weightSet: 'learned-open', level, profile }).assignment;
    solved.set(key, a);
  }
  return a;
}
/** lint --beginner of the learned-open fingering of a library piece at a level, once each. */
const linted = new Map<string, LintReport>();
function lint(slug: string, score: Score, level: Level, profile: HandProfileId): LintReport {
  const key = `${slug} ${level} ${profile}`;
  let r = linted.get(key);
  if (!r) {
    r = lintFingering(score, solve(slug, score, level, profile), { profile, beginner: true });
    linted.set(key, r);
  }
  return r;
}
const count = (r: LintReport, ...rules: LintRuleId[]) =>
  rules.reduce((s, id) => s + (r.counts[id] ?? 0), 0);

const open = () => loadWeightSet('learned-open').weights;
/** The entries of a textbook oracle file (`benchmarks/textbook/<file>.json`). */
const textbook = (file: 'scales' | 'arpeggios' | 'chromatic') =>
  normalizeTextbookEntries(
    JSON.parse(read(`benchmarks/textbook/${file}.json`).toString('utf8')) as unknown,
  ).entries;

/** A right-hand melody in PIG text: [pitch, onset, offset] per note, unfingered or `fingers`. */
const pigText = (notes: Array<[string, number, number]>, fingers?: number[]) =>
  '//Version: PianoFingering_v170101\n' +
  notes
    .map(([p, on, off], i) => `${i}\t${on}\t${off}\t${p}\t80\t80\t0\t${fingers?.[i] ?? 0}`)
    .join('\n') +
  '\n';
/** Notes of `ioi` seconds each, legato (each key released as the next one starts). */
const legato = (pitches: string[], ioi: number) =>
  pitches.map((p, i): [string, number, number] => [p, i * ioi, (i + 1) * ioi]);
/** Twinkle bars 3-4, F F E E D D C, and the fingering the UI review crossed out: one L15. */
const TWINKLE_BARS_3_4 = legato(['F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4'], 0.5);
const TWINKLE_CROSSED: Finger[] = [2, 2, 1, 1, 2, 2, 1];

describe('beginner level', () => {
  it('multiplies only the listed penalty rules', () => {
    const w = applyLevel(loadWeightSet('learned-open').weights, 'beginner');
    expect(w.handPositionShift).toBeCloseTo(
      loadWeightSet('learned-open').weights.handPositionShift * 1.5,
      9,
    );
    expect(w['tr:13:up']).toBe(loadWeightSet('learned-open').weights['tr:13:up']);
    expect(applyLevel(loadWeightSet('learned-open').weights, 'expert')).toEqual(
      loadWeightSet('learned-open').weights,
    );
  });
  it(
    'on the level 1 to 3 library pieces the beginner level has no more position changes than expert on the medium hand, fewer in total on the large hand, and changes no stretch wider than an octave',
    () => {
      // Position changes (`positionChanges`: the implied five-finger anchor moves a white key or
      // more) piece by piece on the app's hand (medium), and over the pieces on the large hand,
      // where three pieces get one more each (profiles-weights.json note).
      // Stretches (`wideStretches`): the level changes none, on either hand. The plan's "0 wide
      // stretches for beginner" is not met. No piece holds keys more than an octave apart on the
      // medium hand at either level, a property of the scores (the held pairs do not depend on
      // the fingering), and the five legato reaches of 13 and 14 semitones the expert fingering
      // makes on the medium hand stay at the beginner level; they are pinned below by piece and
      // bar index (the stretch multiplier prices a reach within the practical span too little to
      // turn it into a hand shift).
      expect(LIBRARY.length).toBe(22);
      let expertLarge = 0;
      let beginnerLarge = 0;
      const moreOnLarge = new Map<string, number>();
      const reaches: string[] = [];
      for (const { slug, score } of LIBRARY) {
        const expert = solve(slug, score, 'expert', 'medium');
        const beginner = solve(slug, score, 'beginner', 'medium');
        expect(positionChanges(score, beginner), slug).toBeLessThanOrEqual(
          positionChanges(score, expert),
        );
        const e = positionChanges(score, solve(slug, score, 'expert', 'large'));
        const b = positionChanges(score, solve(slug, score, 'beginner', 'large'));
        expertLarge += e;
        beginnerLarge += b;
        if (b > e) moreOnLarge.set(slug, b - e);
        for (const profile of PROFILES) {
          const wide = (level: Level) =>
            wideStretches(score, solve(slug, score, level, profile), { profile });
          expect(wide('beginner'), `${slug} ${profile}`).toEqual(wide('expert'));
        }
        const where = (id: string) => {
          const n = score.notes.find((x) => x.id === id)!;
          return `${n.measureIndex}:${n.midi}`;
        };
        for (const s of wideStretches(score, beginner, { profile: 'medium' }))
          reaches.push(
            `${slug} ${s.kind} ${s.hand} ${s.noteIds.map(where).join('-')} ${s.semitones}`,
          );
      }
      expect(beginnerLarge).toBeLessThan(expertLarge);
      const allowed: Record<string, number> = {
        'burgmuller-op100-no1-la-candeur': 1,
        'burgmuller-op100-no3-pastorale': 1,
        'burgmuller-op100-no5-innocence': 1,
      };
      for (const [slug, more] of moreOnLarge)
        expect(more, slug).toBeLessThanOrEqual(allowed[slug] ?? 0);
      expect(reaches.sort()).toEqual([
        'bach-minuet-g-minor-bwv-anh-115 reach R 7:69-8:82 13',
        'bach-prelude-c-major-bwv-846 reach L 19:55-20:41 14',
        'bach-prelude-c-major-bwv-846 reach L 30:50-31:36 14',
        'schumann-op68-no1-melody reach R 17:67-18:81 14',
        'schumann-op68-no1-melody reach R 9:67-10:81 14',
      ]);
    },
    HEAVY,
  );
  it(
    'the beginner level loses no one- or two-octave scale and no chromatic scale that is exact at the expert level',
    () => {
      // The plan's gate reads "still scores 100 on one- and two-octave scales". learned-open itself
      // fingers 280 of these 288 scales exactly at the expert level (8 endings of F harmonic minor
      // RH and F# melodic minor LH), so "100" reads: every scale exact at the expert level stays
      // exact at the beginner level, on both hands' profiles. The chromatic scales (48, two
      // octaves) are held to the same: their crossings are no crossings inside one position
      // (`pairWindows`).
      const scales = textbook('scales').filter(
        (e) => e.family === 'scale' && (e.octaves ?? 0) <= 2,
      );
      expect(scales).toHaveLength(288);
      const chromatic = textbook('chromatic');
      expect(chromatic).toHaveLength(48);
      const entries = [...scales, ...chromatic];
      for (const profile of ['large', 'medium'] as const) {
        const expert = evaluateTextbook(entries, { weightSet: 'learned-open', profile });
        const beginner = evaluateTextbook(entries, {
          weightSet: 'learned-open',
          profile,
          level: 'beginner',
        });
        const failed = new Set(expert.failures.map((f) => f.id));
        expect(
          beginner.failures.filter((f) => !failed.has(f.id)).map((f) => f.id),
          profile,
        ).toEqual([]);
        expect(beginner.exactRate).toBeGreaterThanOrEqual(expert.exactRate);
      }
    },
    HEAVY,
  );
  it(
    'the beginner level loses only the recorded arpeggios and no three-octave scale',
    () => {
      // The two-octave arpeggios and the three-octave scales are no part of the plan's gate. Their
      // known losses (profiles-weights.json note): the handPositionShift and stretch multipliers
      // together, not the lint costs, start Bb major and minor LH down on 2 instead of 3 and
      // change Eb dominant seventh LH (large hand) at one end. Any other loss fails here.
      const recorded = {
        medium: ['arpeggio.major.Bb.lh.desc.2oct', 'arpeggio.minor.Bb.lh.desc.2oct'],
        large: [
          'arpeggio.major.Bb.lh.desc.2oct',
          'arpeggio.minor.Bb.lh.desc.2oct',
          'arpeggio.dominant7.Eb.lh.asc.2oct',
          'arpeggio.dominant7.Eb.lh.desc.2oct',
        ],
      };
      const entries = [
        ...textbook('arpeggios'),
        ...textbook('scales').filter((e) => (e.octaves ?? 0) === 3),
      ];
      expect(entries).toHaveLength(192 + 144);
      for (const profile of ['large', 'medium'] as const) {
        const expert = evaluateTextbook(entries, { weightSet: 'learned-open', profile });
        const beginner = evaluateTextbook(entries, {
          weightSet: 'learned-open',
          profile,
          level: 'beginner',
        });
        const failed = new Set(expert.failures.map((f) => f.id));
        const allowed = new Set(recorded[profile]);
        const lost = beginner.failures.filter((f) => !failed.has(f.id)).map((f) => f.id);
        expect(
          lost.filter((id) => !allowed.has(id)),
          profile,
        ).toEqual([]);
      }
    },
    HEAVY,
  );
});

// Additional tests (beyond the plan's Step 1).

describe('beginner level: lint L15 and the lint costs (plan addition 14)', () => {
  it(
    'brings the L15 crossings of the level 1 and 2 library pieces to 0, on both hand profiles',
    () => {
      for (const profile of PROFILES) {
        let expertL15 = 0;
        for (const { slug, level, score } of LIBRARY) {
          if (level > 2) continue;
          expertL15 += count(lint(slug, score, 'expert', profile), 'L15');
          expect(count(lint(slug, score, 'beginner', profile), 'L15'), `${slug} ${profile}`).toBe(
            0,
          );
        }
        // Not vacuous: the expert level crosses inside a position on these pieces.
        expect(expertL15, profile).toBeGreaterThan(0);
      }
    },
    HEAVY,
  );
  it(
    'on every level 1 to 3 library piece the beginner level has no more lint --beginner errors and fast hops than expert, and none on level 1 and 2',
    () => {
      // The errors of lint --beginner: the laws L01..L05, and L06 (a crossing of two fingers
      // without the thumb) and L10, which are errors for beginners; L11 is a fast hop. A level
      // that removes L15 by moving the crossing to two other fingers or by a hop fails here (a
      // cost on thumb crossings alone did: Pachelbel's D5 5 after E5 2, a 3 over 4 in each
      // minuet, La Candeur's B4 1 C5 1). On the level 1 and 2 pieces, `digitus2 lint --beginner`
      // exits 0 at the beginner level.
      for (const profile of PROFILES) {
        let expertErrors = 0;
        for (const { slug, level, score } of LIBRARY) {
          const expert = lint(slug, score, 'expert', profile);
          const beginner = lint(slug, score, 'beginner', profile);
          const at = `${slug} ${profile}`;
          expect(beginner.errors, at).toBeLessThanOrEqual(expert.errors);
          expect(count(beginner, 'L11'), at).toBeLessThanOrEqual(count(expert, 'L11'));
          if (level > 2) continue;
          expertErrors += expert.errors;
          expect(beginner.errors, at).toBe(0);
          expect(count(beginner, 'L11'), at).toBe(0);
        }
        // Not vacuous: the expert level has non-thumb crossings on these pieces.
        expect(expertErrors, profile).toBeGreaterThan(0);
      }
    },
    HEAVY,
  );
  it(
    'puts a thumb or a fifth on a black key more often only on the recorded pieces, and no more fifths in total',
    () => {
      // The level trades thumbs on black keys (L08) for the crossings and hops it removes
      // (profiles-weights.json note): a thumbOnBlack multiplier or a cost on L08 brings L15
      // crossings back on Pachelbel's Canon, so the trade is kept and pinned here piece by piece
      // (L08 + L09 at most the recorded number above the expert's). fiveOnBlack 3 keeps the fifths
      // (L09) at the expert's count on the level 1 and 2 pieces and below it on level 1 to 3.
      const recorded: Record<(typeof PROFILES)[number], Record<string, number>> = {
        medium: {
          'pachelbel-canon-in-d': 1,
          'bach-minuet-g-major-bwv-anh-114': 2,
          'bach-minuet-g-minor-bwv-anh-115': 1,
          'burgmuller-op100-no1-la-candeur': 3,
          'burgmuller-op100-no3-pastorale': 2,
          'clementi-sonatina-op36-no1-mvt1': 1,
        },
        large: {
          'pachelbel-canon-in-d': 1,
          'bach-minuet-g-major-bwv-anh-114': 2,
          'bach-minuet-g-minor-bwv-anh-115': 2,
          'burgmuller-op100-no3-pastorale': 2,
          'clementi-sonatina-op36-no1-mvt1': 1,
        },
      };
      for (const profile of PROFILES) {
        const fifths = { expert: 0, beginner: 0, expert12: 0, beginner12: 0 };
        for (const { slug, level, score } of LIBRARY) {
          const expert = lint(slug, score, 'expert', profile);
          const beginner = lint(slug, score, 'beginner', profile);
          const more = count(beginner, 'L08', 'L09') - count(expert, 'L08', 'L09');
          expect(more, `${slug} ${profile}`).toBeLessThanOrEqual(recorded[profile][slug] ?? 0);
          fifths.expert += count(expert, 'L09');
          fifths.beginner += count(beginner, 'L09');
          if (level > 2) continue;
          fifths.expert12 += count(expert, 'L09');
          fifths.beginner12 += count(beginner, 'L09');
        }
        expect(fifths.beginner, profile).toBeLessThanOrEqual(fifths.expert);
        expect(fifths.beginner12, profile).toBeLessThanOrEqual(fifths.expert12);
      }
    },
    HEAVY,
  );
  it(
    'charges each pair the cost of the rule lint --beginner flags it with, on the expert fingerings of the library',
    () => {
      // Every note pinned to the expert's finger, the beginner level's decode explains on each
      // note the cost of the pair that ends there (`levelCost`). Summed over a piece, it is the
      // cost of each rule times the pairs lint --beginner flags with it: L15, L11, and L06 except
      // after a rest (the hand is lifted, so the level does not charge a crossing there).
      const costs = LEVEL_PROFILES.beginner.lintCosts!;
      let charged = 0;
      for (const { slug, score } of LIBRARY) {
        const expert = solve(slug, score, 'expert', 'medium');
        const pins: Assignment = {};
        for (const [id, a] of Object.entries(expert))
          pins[id] = { finger: a.finger, source: 'user', pinned: true };
        const r = solveFingering(score, {
          weightSet: 'learned-open',
          profile: 'medium',
          level: 'beginner',
          pins,
        });
        for (const [id, a] of Object.entries(r.assignment))
          expect(a.finger, `${slug} ${id}`).toBe(expert[id]!.finger);
        const explained = Object.values(r.explanations).reduce((s, e) => s + (e.levelCost ?? 0), 0);
        const seqNote = new Map<string, SeqNote>();
        for (const hand of ['R', 'L'] as Hand[])
          for (const n of buildHandSequence(score, hand).notes) seqNote.set(n.noteId, n);
        let expected = 0;
        for (const issue of lint(slug, score, 'expert', 'medium').issues) {
          if (issue.rule === 'L15' || issue.rule === 'L11') expected += costs[issue.rule] ?? 0;
          if (issue.rule === 'L06' && !seqNote.get(issue.noteIds[1]!)!.restBefore)
            expected += costs.L06 ?? 0;
        }
        expect(explained, slug).toBeCloseTo(expected, 9);
        charged += explained;
      }
      // Not vacuous: the expert fingerings have pairs the beginner level charges.
      expect(charged).toBeGreaterThan(0);
    },
    HEAVY,
  );
  it(
    'lint --beginner reports no L15 on the textbook fingerings and shows every crossing as L24',
    () => {
      // A scale, an arpeggio or a chromatic run carries the hand beyond one five-finger position,
      // so its thumb crossings are no L15 (the chromatic scale spans few white keys but more than
      // five keys); a beginner is still shown each of them (L24, info).
      for (const file of ['scales', 'arpeggios', 'chromatic'] as const) {
        let crossings = 0;
        const counts = { L15: 0, L24: 0 };
        for (const e of textbook(file)) {
          const score = scoreFromTextbookEntry(e);
          const sign = e.hand === 'L' ? -1 : 1;
          for (const fingers of [e.fingers, ...(e.alternatives ?? []).map((a) => a.fingers)]) {
            const assignment: Assignment = {};
            fingers.forEach(
              (f, i) => (assignment[`t${i}`] = { finger: f as Finger, source: 'user' }),
            );
            const r = lintFingering(score, assignment, { beginner: true });
            counts.L15 += r.counts.L15 ?? 0;
            counts.L24 += r.counts.L24 ?? 0;
            for (let i = 1; i < fingers.length; i++) {
              const step = (e.midi[i]! - e.midi[i - 1]!) * sign;
              if (isThumbCrossing(fingers[i - 1] as Finger, fingers[i] as Finger, step))
                crossings++;
            }
          }
        }
        expect(crossings, file).toBeGreaterThan(0);
        expect(counts, file).toEqual({ L15: 0, L24: crossings });
      }
    },
    HEAVY,
  );
  it('a crossing the decode cannot avoid pays the cost on top of the weighted terms', () => {
    // Twinkle bars 3-4 with every finger pinned to the review's 2 2 1 1 2 2 1: one crossing.
    const seq = buildHandSequence(parsePig(pigText(TWINKLE_BARS_3_4)).score, 'R');
    const ctx = makeContext(HAND_PROFILES.large, applyLevel(open(), 'beginner'));
    const pinned = new Map(TWINKLE_CROSSED.map((f, i) => [i, f]));
    const base = { pinned, forbidden: new Map<number, Set<Finger>>(), soft: false };
    const plain = solveHand(seq, ctx, base);
    const costly = solveHand(seq, ctx, { ...base, lintCosts: { L15: 20 } });
    expect(costly.fingers).toEqual(TWINKLE_CROSSED);
    expect(plain.cost).toBeCloseTo(dot(ctx.weights, pathFeatures(seq, ctx, TWINKLE_CROSSED)), 9);
    expect(costly.cost).toBeCloseTo(plain.cost + 20, 9);
    // Free, the decode leaves the crossing out.
    const free = solveHand(seq, ctx, {
      pinned: new Map(),
      forbidden: new Map(),
      soft: false,
      lintCosts: { L15: 20 },
    });
    expect(free.fingers).not.toEqual(TWINKLE_CROSSED);
  });
  it('charges L15, L06 and L11 where lint --beginner flags them, and nothing else', () => {
    // The cost a pinned fingering pays on top of its weighted terms, with each rule at its own
    // cost so that the sum tells which rules fired.
    expect(LEVEL_LINT_RULES).toEqual(['L06', 'L11', 'L15']);
    // isCrossing: the later finger on the far side of the earlier one (mirrored interval).
    expect([isCrossing(3, 2, 2), isCrossing(2, 3, -2), isCrossing(3, 1, 2)]).toEqual([
      true,
      true,
      true,
    ]);
    expect([isCrossing(2, 3, 2), isCrossing(2, 2, 2), isCrossing(3, 2, 0)]).toEqual([
      false,
      false,
      false,
    ]);
    const ctx = makeContext(HAND_PROFILES.large, open());
    const extra = (notes: Array<[string, number, number]>, fingers: Finger[]) => {
      const seq = buildHandSequence(parsePig(pigText(notes)).score, 'R');
      const cost = (lintCosts?: LevelLintCosts) => {
        const c: HandConstraints = {
          pinned: new Map(fingers.map((f, i) => [i, f])),
          forbidden: new Map(),
          soft: false,
        };
        if (lintCosts) c.lintCosts = lintCosts;
        const r = solveHand(seq, ctx, c);
        expect(r.fingers).toEqual(fingers);
        return r.cost;
      };
      // No rule, or every rule at 0, charges nothing.
      expect(cost({})).toBe(cost());
      expect(cost({ L06: 0, L11: 0, L15: 0 })).toBe(cost());
      return Math.round((cost({ L06: 100, L11: 10, L15: 1 }) - cost()) * 1e9) / 1e9;
    };
    // L15: a thumb crossing inside one five-finger position.
    expect(extra(TWINKLE_BARS_3_4, TWINKLE_CROSSED)).toBe(1);
    // L06: 2 after 3 on the step up from D4 to E4, a crossing without the thumb; not after a rest.
    const cde = legato(['C4', 'D4', 'E4', 'D4'], 0.5);
    expect(extra(cde, [1, 3, 2, 1])).toBe(100);
    const rested: Array<[string, number, number]> = [
      ['C4', 0, 0.5],
      ['D4', 0.5, 0.75],
      ['E4', 2, 2.5],
      ['D4', 2.5, 3],
    ];
    expect(extra(rested, [1, 3, 2, 1])).toBe(0);
    // L11: the same finger on another key less than 0.25 s later, no rest between; not when
    // slower, not on a repeated key, not after a rest.
    expect(extra(legato(['C4', 'D4', 'E4'], 0.2), [1, 2, 2])).toBe(10);
    expect(extra(legato(['C4', 'D4', 'E4'], 0.3), [1, 2, 2])).toBe(0);
    expect(extra(legato(['C4', 'D4', 'D4'], 0.2), [1, 2, 2])).toBe(0);
    const hopAfterRest: Array<[string, number, number]> = [
      ['C4', 0, 0.2],
      ['D4', 0.2, 0.3],
      ['E4', 0.4, 0.6],
    ];
    expect(extra(hopAfterRest, [1, 2, 2])).toBe(0);
    // A thumb crossing that carries the hand beyond one position (a C major scale) is no L15.
    const scale = legato(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], 0.25);
    expect(extra(scale, [1, 2, 3, 1, 2, 3, 4, 5])).toBe(0);
  });
  it('the explanation shows the level cost of a crossing inside a position apart from the rule terms', () => {
    // The same bars pinned through solveFingering: the level charges E4 1 to D4 2 (note 4).
    const { score, assignment: pins } = parsePig(pigText(TWINKLE_BARS_3_4, TWINKLE_CROSSED));
    const opts: SolveOptions = {
      weightSet: 'learned-open',
      pins,
      respectEditorial: true,
      hands: ['R'],
    };
    const cost = LEVEL_PROFILES.beginner.lintCosts?.L15 ?? 0;
    expect(cost).toBeGreaterThan(0);
    const sum = (r: SolveResult) => Object.values(r.explanations).reduce((s, e) => s + e.total, 0);
    const beginner = solveFingering(score, { ...opts, level: 'beginner' });
    expect(score.notes.map((n) => beginner.assignment[n.id]!.finger)).toEqual(TWINKLE_CROSSED);
    const charged = Object.entries(beginner.explanations)
      .filter(([, e]) => e.levelCost !== undefined)
      .map(([id, e]) => [id, e.levelCost]);
    expect(charged).toEqual([['4', cost]]);
    for (const e of Object.values(beginner.explanations))
      expect(e.total).toBeCloseTo(
        e.terms.reduce((s, t) => s + t.weighted, 0),
        12,
      );
    // The decoded cost is the explained terms plus the level's cost; the expert level has none.
    expect(beginner.hands[0]!.cost).toBeCloseTo(sum(beginner) + cost, 9);
    const expert = solveFingering(score, opts);
    expect(Object.values(expert.explanations).some((e) => 'levelCost' in e)).toBe(false);
    expect(expert.hands[0]!.cost).toBeCloseTo(sum(expert), 9);
  });
});

describe('level profiles', () => {
  it(
    'the expert level is the default and changes nothing',
    () => {
      for (const { slug, score } of LIBRARY.slice(0, 6)) {
        const plain = solveFingering(score, { weightSet: 'learned-open' });
        const expert = solveFingering(score, { weightSet: 'learned-open', level: 'expert' });
        expect(expert, slug).toEqual(plain);
      }
      expect(LEVEL_PROFILES.expert.multipliers).toEqual({});
      expect(LEVEL_PROFILES.expert.lintCosts).toBeUndefined();
      // The decode the expert level runs (no lint costs) is the decode with every cost at 0: on
      // a hand that crosses inside a position (Pachelbel's Canon, right hand), free and with the
      // expert's fingering pinned, the same fingers, cost and marginals.
      const canon = LIBRARY.find((p) => p.slug === 'pachelbel-canon-in-d')!;
      const seq = buildHandSequence(canon.score, 'R');
      const ctx = makeContext(HAND_PROFILES.medium, open());
      const expert = solve(canon.slug, canon.score, 'expert', 'medium');
      const fingers = seq.notes.map((n) => expert[n.noteId]!.finger);
      for (const pinned of [new Map<number, Finger>(), new Map(fingers.map((f, i) => [i, f]))]) {
        const decode = (lintCosts?: LevelLintCosts) => {
          const c: HandConstraints = { pinned, forbidden: new Map(), soft: false };
          if (lintCosts) c.lintCosts = lintCosts;
          return solveHand(seq, ctx, c);
        };
        const none = decode();
        expect(decode({})).toEqual(none);
        expect(decode({ L06: 0, L11: 0, L15: 0 })).toEqual(none);
        // Not vacuous: the beginner level's costs change this decode.
        expect(decode(LEVEL_PROFILES.beginner.lintCosts)).not.toEqual(none);
      }
    },
    HEAVY,
  );
  it('scales positive weights only, every listed id is a penalty or count rule, never an indicator', () => {
    const m = LEVEL_PROFILES.beginner.multipliers;
    expect(Object.keys(m).length).toBeGreaterThan(0);
    for (const set of ['learned-open', 'parncutt'] as const) {
      const w = loadWeightSet(set).weights;
      const b = applyLevel(w, 'beginner');
      for (const id of RULE_IDS) {
        const k = m[id];
        if (k === undefined || w[id] <= 0) expect(b[id], `${set} ${id}`).toBe(w[id]);
        else expect(b[id], `${set} ${id}`).toBeCloseTo(w[id] * k, 12);
      }
    }
    // learned-open learned a negative positionChangeCount: the level does not enlarge that reward.
    expect(open().positionChangeCount).toBeLessThan(0);
    expect(applyLevel(open(), 'beginner').positionChangeCount).toBe(open().positionChangeCount);
    for (const id of Object.keys(m)) {
      expect(id, id).not.toMatch(/:/);
      expect(['template', 'latticeStep', 'levelChange', 'repeatFast']).not.toContain(id);
    }
    expect(Object.keys(m).filter((id) => isPenaltyRule(id))).toEqual(
      expect.arrayContaining(['handPositionShift', 'stretch', 'beyondPractical']),
    );
    // applyLevel returns a new object and leaves the set's weights alone.
    expect(applyLevel(open(), 'beginner')).not.toBe(open());
    expect(open().handPositionShift).toBe(loadWeightSet('learned-open').weights.handPositionShift);
  });
  it('validateLevelProfiles accepts the shipped file and rejects a bad one', () => {
    expect(validateLevelProfiles(profilesJson)).toEqual(LEVEL_PROFILES);
    expect(LEVEL_PROFILES.beginner.lintCosts).toEqual({ L06: 30, L11: 30, L15: 30 });
    const file = (beginner: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      schema: 'digitus2.level-profiles/1',
      beginner,
      expert: { multipliers: {} },
      ...extra,
    });
    const ok = { multipliers: { hop: 2, thumbPassing: 1.5 }, lintCosts: { L15: 3, L06: 0 } };
    expect(validateLevelProfiles(file(ok)).beginner).toEqual(ok);
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ multipliers: { 'tr:13:up': 2 } }, /tr:13:up is not a penalty or count rule/],
      [{ multipliers: { template: 2 } }, /template is not a penalty or count rule/],
      [{ multipliers: { latticeStep: 2 } }, /latticeStep is not a penalty or count rule/],
      [{ multipliers: { repeatedNoteFingerChange: 2 } }, /repeatedNoteFingerChange/],
      [{ multipliers: { nope: 2 } }, /unknown rule id nope/],
      [{ multipliers: { hop: 0 } }, /multiplier of hop/],
      [{ multipliers: { hop: '2' } }, /multiplier of hop/],
      [{ multipliers: { hop: 2 }, lintCosts: { L15: -1 } }, /cost of L15 must be a number >= 0/],
      [{ multipliers: { hop: 2 }, lintCosts: { L15: '30' } }, /cost of L15/],
      [{ multipliers: { hop: 2 }, lintCosts: { L08: 30 } }, /L08 is not one of L06, L11, L15/],
      [{ multipliers: { hop: 2 }, lintCosts: [30] }, /lintCosts must be an object/],
      // A misspelt or retired key would silently drop a cost.
      [{ multipliers: { hop: 2 }, lintCost: { L15: 30 } }, /unknown key lintCost/],
      [{ multipliers: { hop: 2 }, crossingInPosition: 20 }, /unknown key crossingInPosition/],
      [{ multipliers: { hop: 2 }, rationale: 3 }, /rationale must be a string/],
      [{}, /beginner needs a multipliers object/],
    ];
    for (const [beginner, message] of bad)
      expect(() => validateLevelProfiles(file(beginner))).toThrow(message);
    expect(() => validateLevelProfiles({ ...file(ok), schema: 'x' })).toThrow(/schema/);
    expect(() => validateLevelProfiles(file(ok, { novice: { multipliers: {} } }))).toThrow(
      /unknown key novice/,
    );
    expect(() =>
      validateLevelProfiles({ schema: 'digitus2.level-profiles/1', beginner: ok }),
    ).toThrow(/expert needs a multipliers object/);
    expect(() => applyLevel(open(), 'novice' as Level)).toThrow(/unknown level novice/);
    const ids: readonly string[] = RULE_IDS;
    for (const id of Object.keys(LEVEL_PROFILES.beginner.multipliers))
      expect(ids).toContain(id as RuleId);
  });
});
