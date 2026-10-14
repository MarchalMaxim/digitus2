import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { parseMusicXml } from '../io/musicxml/read.js';
import { isPenaltyRule, makeContext, PARNCUTT_WEIGHTS, RULE_IDS } from '../fingering/rules.js';
import { HAND_PROFILES } from '../fingering/spans.js';
import { buildHandSequence } from '../fingering/sequence.js';
import { solveHand } from '../fingering/solve.js';
import { detectRuns, matchTemplates, TEXTBOOK_TEMPLATES } from '../fingering/templates.js';
import type { HandSequence } from '../fingering/sequence.js';
import type { Finger, Score } from '../score/types.js';
import { toHandExamples } from './data.js';
import type { HandExample } from './data.js';
import { dot, pathFeatures, subtract } from './features.js';
import { evaluateExamples, train } from './perceptron.js';

const H = '//Version: PianoFingering_v170101\n';
const melody = (pitches: string[], fingers: number[], ch = 0) =>
  H +
  pitches
    .map(
      (p, i) =>
        `${i}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t${ch}\t${ch ? -fingers[i]! : fingers[i]}`,
    )
    .join('\n') +
  '\n';

function example(text: string, extra: string[] = []) {
  const a = parsePig(text);
  const annotations = [a.assignment, ...extra.map((t) => parsePig(t).assignment)];
  return toHandExamples({ corpus: 'pig', id: 't', score: a.score, annotations })[0]!;
}

const SCALE = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const templatesOf = (seq: HandSequence) =>
  matchTemplates(seq, detectRuns(seq), TEXTBOOK_TEMPLATES[seq.hand]);

describe('train', () => {
  const profile = HAND_PROFILES.large;

  it('one update lowers the cost of the target relative to the decoded path', () => {
    // An "expert" who insists on 1 2 3 4 5 1 2 3 for the C major scale (a non-standard fingering)
    const ex = example(melody(SCALE, [1, 2, 3, 4, 5, 1, 2, 3]));
    const before = makeContext(profile, PARNCUTT_WEIGHTS);
    const gold = ex.golds[0]!.map((f) => f as 1 | 2 | 3 | 4 | 5);
    const decoded0 = solveHand(ex.seq, before).fingers;
    const gap0 =
      dot(before.weights, pathFeatures(ex.seq, before, gold)) -
      dot(before.weights, pathFeatures(ex.seq, before, decoded0));
    const r = train([ex], {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 1,
      C: 0.5,
      rho: 1,
      seed: 1,
      projectPenalties: true,
    });
    const after = makeContext(profile, r.weights);
    const gap1 =
      dot(after.weights, pathFeatures(ex.seq, after, gold)) -
      dot(after.weights, pathFeatures(ex.seq, after, decoded0));
    expect(gap1).toBeLessThan(gap0);
    expect(r.epochs[0]!.updates).toBeGreaterThanOrEqual(1);
  });

  it('training on a toy corpus reaches 100 percent and is deterministic', () => {
    const exs = [
      example(melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5])),
      example(melody(['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'], [5, 4, 3, 2, 1, 3, 2, 1])),
      example(
        melody(['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4'], [5, 4, 3, 2, 1, 3, 2, 1], 1),
      ),
      example(melody(['C4', 'E4', 'G4', 'C5'], [1, 2, 3, 5])),
    ];
    const a = train(exs, {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 5,
      C: 0.05,
      rho: 1,
      seed: 7,
      projectPenalties: true,
    });
    const b = train(exs, {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 5,
      C: 0.05,
      rho: 1,
      seed: 7,
      projectPenalties: true,
    });
    expect(a.weights).toEqual(b.weights);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Plan correction 6: `soft` is the plan's noteAccuracy (a match with any annotation).
    const ev = evaluateExamples(exs, a.weights, profile);
    expect(ev.soft).toBe(1);
    expect(ev.gen).toBe(1);
    for (const id of Object.keys(a.weights))
      if (['stretch', 'beyondPractical', 'hop'].includes(id))
        expect(a.weights[id as keyof typeof a.weights]).toBeGreaterThanOrEqual(0);
  });

  it('unfingered notes contribute nothing to the loss or the augmentation', () => {
    const full = example(melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5]));
    // toHandExamples drops an annotation that fingers nothing, so the fully unfingered example of
    // the plan is built by hand: the scale with every gold 0.
    const piece = parsePig(melody(SCALE, [0, 0, 0, 0, 0, 0, 0, 0]));
    expect(
      toHandExamples({
        corpus: 'pig',
        id: 'p',
        score: piece.score,
        annotations: [piece.assignment],
      }),
    ).toEqual([]);
    const partial: HandExample = { ...full, id: 'pig:p:R', golds: [full.golds[0]!.map(() => 0)] };
    const r = train([partial], {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 3,
      C: 0.5,
      rho: 1,
      seed: 1,
      projectPenalties: true,
    });
    expect(r.weights).toEqual(PARNCUTT_WEIGHTS); // nothing to learn from
    expect(r.epochs.every((e) => e.updates === 0)).toBe(true);
    const half = example(melody(SCALE, [1, 2, 3, 0, 0, 0, 0, 0]));
    const r2 = train([half], {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 1,
      C: 0.5,
      rho: 1,
      seed: 1,
      projectPenalties: true,
    });
    expect(evaluateExamples([full], r2.weights, profile).notes).toBe(8);
    // The standard fingering starts 1 2 3: with the five unfingered notes out of the Hamming loss
    // and the augmentation there is no margin violation, so nothing moves.
    expect(r2.epochs.every((e) => e.updates === 0)).toBe(true);
    expect(r2.weights).toEqual(PARNCUTT_WEIGHTS);
    expect(r2.epochs[0]!.hammingRate).toBe(0);
    // A partial gold that contradicts the decode does update, and its Hamming rate counts the three
    // fingered notes only.
    const odd = example(melody(SCALE, [2, 3, 4, 0, 0, 0, 0, 0]));
    const r3 = train([odd], {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 1,
      C: 0.5,
      rho: 1,
      seed: 1,
      projectPenalties: true,
    });
    expect(r3.epochs[0]!.updates).toBe(1);
    expect(r3.epochs[0]!.hammingRate).toBeGreaterThan(0);
    expect(r3.epochs[0]!.hammingRate).toBeLessThanOrEqual(1);
    expect(evaluateExamples([odd], r3.weights, profile).notes).toBe(3);
  });

  it('with several annotators the closest one is the target', () => {
    const standard = melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5]);
    const odd = melody(SCALE, [2, 3, 4, 1, 2, 3, 4, 5]);
    const ex = example(standard, [odd]);
    const r = train([ex], {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 2,
      C: 0.5,
      rho: 1,
      seed: 1,
      projectPenalties: true,
    });
    // Plan correction 5: no `updates === 0` assertion (the Hamming margin can still update).
    expect(evaluateExamples([ex], r.weights, profile).soft).toBe(1);
  });

  it('the latent target follows the decode, not the order of the annotations', () => {
    // The odd annotation comes first: a first-annotator target would train toward 2 3 4 on the
    // first three notes, the latent target keeps the standard fingering the decode agrees with.
    const standard = melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5]);
    const odd = melody(SCALE, [2, 3, 4, 1, 2, 3, 4, 5]);
    const ex = example(odd, [standard]);
    const r = train([ex], {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 3,
      C: 0.5,
      rho: 1,
      seed: 1,
      projectPenalties: true,
    });
    const ctx = makeContext(profile, r.weights);
    expect(solveHand(ex.seq, ctx, undefined, templatesOf(ex.seq)).fingers).toEqual([
      1, 2, 3, 1, 2, 3, 4, 5,
    ]);
    // Without the Hamming margin the closest annotation is the decode itself: no update at all,
    // where a first-annotator target (2 3 4 ...) would update in the first epoch.
    const r0 = train([ex], { ...{ profile, init: PARNCUTT_WEIGHTS }, epochs: 2, rho: 0, seed: 1 });
    expect(r0.epochs.map((e) => e.updates)).toEqual([0, 0]);
    expect(r0.weights).toEqual(PARNCUTT_WEIGHTS);
    const oddOnly = train([example(odd)], {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 1,
      rho: 0,
      seed: 1,
    });
    expect(oddOnly.epochs[0]!.updates).toBe(1);
  });

  it('returns the running average of the weights over every step', () => {
    // One example, two epochs: the averaged weights after epoch 2 are the mean of the weights after
    // step 1 (epoch 1's average) and after step 2 (one step from there), not the last weights.
    const ex = example(melody(SCALE, [1, 2, 3, 4, 5, 1, 2, 3]));
    const opts = { profile, C: 0.5, rho: 1, seed: 1 };
    const r = train([ex], { ...opts, init: PARNCUTT_WEIGHTS, epochs: 2 });
    expect(r.epochs.map((e) => e.updates)).toEqual([1, 1]);
    const w1 = r.epochs[0]!.averagedWeights;
    const w2 = train([ex], { ...opts, init: w1, epochs: 1 }).weights;
    expect(RULE_IDS.some((id) => Math.abs(w2[id] - w1[id]) > 1e-3)).toBe(true);
    for (const id of RULE_IDS)
      expect(r.epochs[1]!.averagedWeights[id]).toBeCloseTo((w1[id] + w2[id]) / 2, 5);
  });

  it('picks the best validation epoch', () => {
    const exs = [example(melody(['C4', 'D4', 'E4', 'F4', 'G4'], [1, 2, 3, 4, 5]))];
    const seen: number[] = [];
    const r = train(exs, {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 3,
      C: 0.05,
      rho: 1,
      seed: 1,
      projectPenalties: true,
      validation: exs,
      onEpoch: (e) => seen.push(e.epoch),
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(r.bestEpoch).toBeGreaterThanOrEqual(1);
    expect(r.epochs[r.bestEpoch - 1]!.validationAccuracy).toBe(
      Math.max(...r.epochs.map((e) => e.validationAccuracy!)),
    );
    expect(r.weights).toEqual(r.epochs[r.bestEpoch - 1]!.averagedWeights);
    // Ties go to the earliest epoch.
    const scores = r.epochs.map((e) => e.validationAccuracy!);
    expect(r.bestEpoch).toBe(scores.indexOf(Math.max(...scores)) + 1);
  });

  it('the PA-I step: uncapped it meets the margin exactly, capped it moves by C', () => {
    const ex = example(melody(SCALE, [1, 2, 3, 4, 5, 1, 2, 3]));
    const ctx0 = makeContext(profile, PARNCUTT_WEIGHTS);
    const tm = templatesOf(ex.seq);
    const gold = ex.golds[0]!.map((f) => f as Finger);
    // The most violating path under the initial weights, as the trainer decodes it.
    const yHat = solveHand(
      ex.seq,
      ctx0,
      {
        pinned: new Map(),
        forbidden: new Map(),
        soft: false,
        unaryExtra: (i, f) => (f !== gold[i] ? -1 : 0),
      },
      tm,
    ).fingers;
    const hamming = yHat.filter((f, i) => f !== gold[i]).length;
    const d = subtract(pathFeatures(ex.seq, ctx0, gold, tm), pathFeatures(ex.seq, ctx0, yHat, tm));
    expect(dot(ctx0.weights, d) + hamming).toBeGreaterThan(0);
    const base = { profile, init: PARNCUTT_WEIGHTS, epochs: 1, rho: 1, seed: 1 };
    const free = train([ex], { ...base, C: 1e6, projectPenalties: false });
    expect(dot(free.weights, d) + hamming).toBeCloseTo(0, 2);
    const capped = train([ex], { ...base, C: 1e-3, projectPenalties: false });
    for (const id of RULE_IDS)
      expect(capped.weights[id]).toBeCloseTo(PARNCUTT_WEIGHTS[id] - 1e-3 * d[id], 5);
  });

  it('validation, not the training score or the last epoch, decides the epoch', () => {
    // Trained on the odd expert with a large step, validated on the standard fingering of the same
    // scale: the averaged weights swing between the two, so the scores differ from epoch to epoch.
    const train1 = [example(melody(SCALE, [1, 2, 3, 4, 5, 1, 2, 3]))];
    const valid = [example(melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5]))];
    const r = train(train1, {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 6,
      C: 0.5,
      rho: 1,
      seed: 1,
      validation: valid,
    });
    const scores = r.epochs.map((e) => e.validationAccuracy!);
    const trainScores = r.epochs.map((e) => e.trainAccuracy);
    expect(new Set(scores).size).toBeGreaterThan(1);
    expect(r.bestEpoch).toBe(scores.indexOf(Math.max(...scores)) + 1);
    expect(r.bestEpoch).toBeLessThan(6);
    expect(trainScores[r.bestEpoch - 1]).toBeLessThan(Math.max(...trainScores));
  });

  it('without validation the last epoch wins, and the result lists every rule id', () => {
    const exs = [example(melody(SCALE, [1, 2, 3, 4, 5, 1, 2, 3]))];
    const r = train(exs, { profile, init: PARNCUTT_WEIGHTS, seed: 3 });
    expect(r.epochs).toHaveLength(12); // default epochs
    expect(r.bestEpoch).toBe(12);
    expect(r.epochs.every((e) => e.validationAccuracy === null)).toBe(true);
    expect(r.features).toEqual([...RULE_IDS]);
    expect(Object.keys(r.weights)).toEqual([...RULE_IDS]);
    expect(r.weights).toEqual(r.epochs[11]!.averagedWeights);
    for (const id of RULE_IDS) {
      expect(Number.isFinite(r.weights[id])).toBe(true);
      expect(Math.round(r.weights[id] * 1e6) / 1e6).toBe(r.weights[id]); // 6 decimals
      if (isPenaltyRule(id)) expect(r.weights[id]).toBeGreaterThanOrEqual(0);
    }
  });

  it('frozen ids keep their initial weight while the others learn', () => {
    const exs = [example(melody(SCALE, [1, 2, 3, 4, 5, 1, 2, 3]))];
    const opts = { profile, init: PARNCUTT_WEIGHTS, epochs: 2, C: 0.5, rho: 1, seed: 1 };
    const free = train(exs, opts);
    expect(free.weights.template).not.toBe(PARNCUTT_WEIGHTS.template);
    const frozen = train(exs, { ...opts, frozen: ['template'] });
    expect(frozen.weights.template).toBe(PARNCUTT_WEIGHTS.template);
    expect(frozen.epochs[0]!.updates).toBeGreaterThanOrEqual(1);
    expect(RULE_IDS.some((id) => frozen.weights[id] !== PARNCUTT_WEIGHTS[id])).toBe(true);
  });

  it('a malformed example is skipped and counted, never thrown', () => {
    const good = example(melody(SCALE, [1, 2, 3, 4, 5, 1, 2, 3]));
    const bad: HandExample = { ...good, id: 'pig:bad:R', golds: [[1, 2]] };
    const nanWeight: HandExample = { ...good, id: 'pig:nan:R', weight: Number.NaN };
    const r = train([bad, nanWeight, good], {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs: 2,
      C: 0.5,
      rho: 1,
      seed: 1,
      validation: [bad, good],
    });
    expect(r.epochs.map((e) => e.skipped)).toEqual([2, 2]);
    expect(r.epochs[0]!.updates).toBeGreaterThanOrEqual(1);
    expect(r.epochs[0]!.validationAccuracy).not.toBeNull();
    expect(() => evaluateExamples([bad], PARNCUTT_WEIGHTS, profile)).toThrow();
  });

  it('decodes with the solver and its templates: its own decode is a fixed point', () => {
    // Golds = the decode solveFingering's templates give: with rho 0 the trainer's most violating
    // path is that decode, the target equals it, and nothing moves. A trainer that decoded without
    // the template matches, or counted Φ differently from the solver, would update here.
    const pig = parsePig(
      readFileSync(
        fileURLToPath(new URL('../../fixtures/pig-sample.txt', import.meta.url)),
        'utf8',
      ),
    ).score;
    const xml = parseMusicXml(
      readFileSync(
        fileURLToPath(new URL('../../fixtures/two-staff.musicxml', import.meta.url)),
        'utf8',
      ),
    ).score;
    // F major and the chromatic scale: the rules alone finger them otherwise than the textbook.
    const fMajor = parsePig(
      melody(['F4', 'G4', 'A4', 'Bb4', 'C5', 'D5', 'E5', 'F5'], [1, 2, 3, 4, 1, 2, 3, 4]),
    ).score;
    const chromatic = parsePig(
      melody(
        ['C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4', 'C5'],
        [1, 3, 1, 3, 1, 2, 3, 1, 3, 1, 3, 1, 2],
      ),
    ).score;
    const ctx = makeContext(profile, PARNCUTT_WEIGHTS);
    const own = (score: Score): HandExample[] =>
      (['R', 'L'] as const).flatMap((hand) => {
        const seq = buildHandSequence(score, hand);
        if (seq.notes.length === 0) return [];
        const fingers = solveHand(seq, ctx, undefined, templatesOf(seq)).fingers;
        return [{ id: `own:${hand}`, seq, golds: [fingers], weight: 1 }];
      });
    const scales = [...own(fMajor), ...own(chromatic)];
    const exs = [...own(pig), ...own(xml), ...scales];
    expect(exs.length).toBeGreaterThanOrEqual(6);
    // The templates matter on the scales: without them the decode differs.
    for (const s of scales) expect(solveHand(s.seq, ctx).fingers).not.toEqual(s.golds[0]);
    const r = train(exs, { profile, init: PARNCUTT_WEIGHTS, epochs: 2, C: 0.5, rho: 0, seed: 1 });
    expect(r.epochs.map((e) => e.updates)).toEqual([0, 0]);
    expect(r.epochs.map((e) => e.skipped)).toEqual([0, 0]);
    expect(r.weights).toEqual(PARNCUTT_WEIGHTS);
    const ev = evaluateExamples(exs, PARNCUTT_WEIGHTS, profile);
    expect(ev.gen).toBe(1);
    expect(ev.notes).toBe(exs.reduce((s, e) => s + e.seq.notes.length, 0));
  });
});

describe('evaluateExamples', () => {
  const profile = HAND_PROFILES.large;
  it('gen averages over the annotators, soft takes any, unfingered notes are masked', () => {
    const standard = melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5]);
    const odd = melody(SCALE, [2, 3, 4, 1, 2, 3, 4, 5]);
    const ctx = makeContext(profile, PARNCUTT_WEIGHTS);
    const ex = example(standard, [odd]);
    // The rules decode the scale with the standard fingering.
    expect(solveHand(ex.seq, ctx, undefined, templatesOf(ex.seq)).fingers).toEqual([
      1, 2, 3, 1, 2, 3, 4, 5,
    ]);
    const two = evaluateExamples([ex], PARNCUTT_WEIGHTS, profile);
    expect(two.notes).toBe(8);
    expect(two.soft).toBe(1);
    expect(two.gen).toBeCloseTo((5 + 3 * 0.5) / 8, 12);
    const oddOnly = evaluateExamples([example(odd)], PARNCUTT_WEIGHTS, profile);
    expect(oddOnly.gen).toBeCloseTo(5 / 8, 12);
    expect(oddOnly.soft).toBeCloseTo(5 / 8, 12);
    const half = evaluateExamples(
      [example(melody(SCALE, [2, 3, 4, 0, 0, 0, 0, 0]))],
      PARNCUTT_WEIGHTS,
      profile,
    );
    expect(half).toEqual({ gen: 0, soft: 0, notes: 3 });
    // Pooled over examples, weighted by notes.
    const both = evaluateExamples([ex, example(odd)], PARNCUTT_WEIGHTS, profile);
    expect(both.notes).toBe(16);
    expect(both.gen).toBeCloseTo((6.5 + 5) / 16, 12);
    expect(evaluateExamples([], PARNCUTT_WEIGHTS, profile)).toEqual({ gen: 0, soft: 0, notes: 0 });
  });
});

describe('hold tolerance in training (M3 Task 7, H1)', () => {
  const profile = HAND_PROFILES.large;
  // An expert who keeps finger 2 for C4 and D4 although C4 sounds 30 ms into D4 (a legato overlap).
  const text =
    H +
    [
      '0\t0\t0.53\tC4\t80\t80\t0\t2',
      '1\t0.5\t1\tD4\t80\t80\t0\t2',
      '2\t1\t1.5\tE4\t80\t80\t0\t3',
    ].join('\n') +
    '\n';
  it('a target is infeasible under the 1 ms tolerance and feasible under 50 ms', () => {
    const ex = example(text);
    const opts = { profile, init: PARNCUTT_WEIGHTS, epochs: 1, seed: 1 };
    expect(train([ex], opts).epochs[0]!.infeasibleTargets).toBe(1);
    expect(train([ex], { ...opts, holdEpsSec: 0.05 }).epochs[0]!.infeasibleTargets).toBe(0);
  });
  it('evaluateExamples decodes with the tolerance it is given', () => {
    const ex = example(text);
    // A weight set that rewards finger 2 hopping up: under 50 ms the decode keeps 2 on C4 and D4
    // (and E4); under 1 ms the held-note law forbids 2 2 on the overlapping pair.
    const w = { ...PARNCUTT_WEIGHTS, 'tr:22:up': -50 };
    expect(evaluateExamples([ex], w, profile, { holdEpsSec: 0.05 }).gen).toBeGreaterThan(
      evaluateExamples([ex], w, profile).gen,
    );
  });
});
