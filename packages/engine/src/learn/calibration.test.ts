import { describe, expect, it } from 'vitest';
import { solveFingering } from '../fingering/solve.js';
import { parsePig } from '../io/pig/read.js';
import {
  calibrate,
  confidenceOf,
  confidenceSample,
  confidenceSamples,
  expectedCalibrationError,
  fitTemperature,
  negativeLogLikelihood,
  PENALTY_MARGIN,
} from './calibration.js';
import type { ConfidenceSample } from './calibration.js';
import { annotationOn } from './data.js';
import { Lcg } from './lcg.js';

describe('calibration', () => {
  it('confidenceOf is a softmax over negative margins and sums to 1', () => {
    const m = [0, 1, 2, Infinity, 3];
    const p = [0, 1, 2, 3, 4].map((f) => confidenceOf(m, f, 1));
    expect(p[3]).toBe(0);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(p[0]).toBeGreaterThan(p[1]!);
    expect(confidenceOf(m, 0, 1000)).toBeCloseTo(0.25, 3); // very hot: uniform over the 4 finite fingers
  });
  it('fitTemperature recovers the temperature that generated the data', () => {
    const rng = new Lcg(5);
    const T = 2.5;
    const samples: ConfidenceSample[] = [];
    for (let i = 0; i < 3000; i++) {
      const margins = [0, 1, 2, 3, 4].map(() => rng.next() * 6);
      const min = Math.min(...margins);
      const m = margins.map((v) => v - min);
      const p = m.map((_, f) => confidenceOf(m, f, T));
      let u = rng.next(),
        chosen = 0;
      for (let f = 0; f < 5; f++) {
        u -= p[f]!;
        if (u <= 0) {
          chosen = f;
          break;
        }
      }
      samples.push({
        margins: m,
        chosen: m.indexOf(0),
        correct: [0, 1, 2, 3, 4].map((f) => f === chosen),
      });
    }
    expect(fitTemperature(samples)).toBeCloseTo(T, 0);
  });
  it('expectedCalibrationError is 0 for perfectly calibrated buckets and large for overconfidence', () => {
    const conf = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9];
    expect(
      expectedCalibrationError(conf, [true, true, true, true, true, true, true, true, true, false])
        .ece,
    ).toBeCloseTo(0, 9);
    expect(
      expectedCalibrationError(
        conf,
        conf.map(() => false),
      ).ece,
    ).toBeCloseTo(0.9, 9);
  });
});

describe('calibration details', () => {
  it('confidenceOf matches the solver formula for margins that do not start at 0, and is 0 off the finite set', () => {
    const m = [3, 4, Infinity, 5, 3.5];
    const z = [3, 4, 5, 3.5].reduce((s, x) => s + Math.exp(-(x - 3) / 2), 0);
    expect(confidenceOf(m, 0, 2)).toBeCloseTo(1 / z, 12);
    expect(confidenceOf(m, 2, 2)).toBe(0);
    expect(confidenceOf([Infinity, Infinity, Infinity, Infinity, Infinity], 0, 2)).toBe(0);
    // Huge margins do not underflow the finger that has the smallest one.
    expect(confidenceOf([0, 5000, 5000, 5000, 5000], 0, 0.2)).toBe(1);
    expect(() => confidenceOf(m, 0, 0)).toThrow(/temperature/);
  });
  it('negativeLogLikelihood is the cross-entropy against the annotators’ shares and skips samples with none', () => {
    // Per annotator (M3 Task 9): two annotators, one on finger 2 and one on finger 4, each carry
    // half of the note; without `target` the correct fingers share it evenly.
    const a: ConfidenceSample = {
      margins: [0, 1, Infinity, 2, 3],
      chosen: 0,
      correct: [false, true, false, true, false],
    };
    const none: ConfidenceSample = {
      margins: [0, 1, Infinity, 2, 3],
      chosen: 0,
      correct: [false, false, true, false, false], // the only correct finger is impossible
    };
    const p = (f: number) => confidenceOf(a.margins, f, 1.5);
    const expected = -(0.5 * Math.log(p(1)) + 0.5 * Math.log(p(3)));
    expect(negativeLogLikelihood([a], 1.5)).toBeCloseTo(expected, 12);
    expect(negativeLogLikelihood([{ ...a, target: [0, 0.5, 0, 0.5, 0] }], 1.5)).toBeCloseTo(
      expected,
      12,
    );
    expect(negativeLogLikelihood([a, none], 1.5)).toBeCloseTo(expected, 12);
    expect(negativeLogLikelihood([none], 1.5)).toBe(0);
    // Three annotators on finger 2, one on finger 4.
    const skewed: ConfidenceSample = { ...a, target: [0, 0.75, 0, 0.25, 0] };
    expect(negativeLogLikelihood([skewed], 1.5)).toBeCloseTo(
      -(0.75 * Math.log(p(1)) + 0.25 * Math.log(p(3))),
      12,
    );
    // Stays finite where the plain softmax underflows to 0 (exp(-1000) is 0 in doubles).
    const far: ConfidenceSample = {
      margins: [0, 200, 200, 200, 200],
      chosen: 0,
      correct: [false, true, false, false, false],
    };
    const nll = negativeLogLikelihood([far], 0.2);
    expect(Number.isFinite(nll)).toBe(true);
    expect(nll).toBeCloseTo(200 / 0.2 + Math.log(1 + 4 * Math.exp(-200 / 0.2)), 6);
  });
  it('a correct finger priced at a hard-rule penalty does not count, so such notes cannot drag the fit to the bound', () => {
    // The solver's penalties are 1000 per broken hard rule; an expert finger that breaks one has a
    // margin of about 1000 and a probability below e^-25 at every temperature in range.
    const penalty: ConfidenceSample = {
      margins: [0, 2, 1000, 4, 6],
      chosen: 0,
      correct: [false, false, true, false, false],
    };
    expect(PENALTY_MARGIN).toBe(500);
    expect(negativeLogLikelihood([penalty], 2)).toBe(0);
    expect(negativeLogLikelihood([penalty], 2, { penaltyMargin: Infinity })).toBeGreaterThan(499);
    // The generator of the recovery test, plus 5 percent of notes whose expert finger is penalised.
    const rng = new Lcg(11);
    const T = 2.5;
    const samples: ConfidenceSample[] = [];
    for (let i = 0; i < 3000; i++) {
      const raw = [0, 1, 2, 3, 4].map(() => rng.next() * 6);
      const min = Math.min(...raw);
      const m = raw.map((v) => v - min);
      let u = rng.next(),
        pick = 0;
      for (let f = 0; f < 5; f++) {
        u -= confidenceOf(m, f, T);
        if (u <= 0) {
          pick = f;
          break;
        }
      }
      if (i % 20 === 0) {
        const bad = (m.indexOf(0) + 1) % 5;
        m[bad] = 1000;
        pick = bad;
      }
      samples.push({ margins: m, chosen: m.indexOf(0), correct: m.map((_, f) => f === pick) });
    }
    expect(fitTemperature(samples)).toBeCloseTo(T, 0);
    expect(fitTemperature(samples, { penaltyMargin: Infinity })).toBeGreaterThan(19.99);
  });
  it('fitTemperature stays inside its bounds and is deterministic', () => {
    // Always right with margins of 1: the colder the better, so the fit runs to the lower bound.
    const sure: ConfidenceSample[] = Array.from({ length: 20 }, () => ({
      margins: [0, 1, 1, 1, 1],
      chosen: 0,
      correct: [true, false, false, false, false],
    }));
    const t = fitTemperature(sure);
    expect(t).toBeGreaterThanOrEqual(0.2);
    expect(t).toBeLessThan(0.2001);
    expect(fitTemperature(sure)).toBe(t);
    // Never right: the hotter the better, up to the upper bound.
    const wrong = sure.map((s) => ({ ...s, correct: [false, true, false, false, false] }));
    expect(fitTemperature(wrong)).toBeGreaterThan(19.99);
    expect(fitTemperature(wrong, { hi: 5 })).toBeLessThanOrEqual(5);
    expect(() => fitTemperature(sure, { lo: 3, hi: 2 })).toThrow();
  });
  it('expectedCalibrationError bins by confidence, weights the gaps by count, and validates its input', () => {
    const r = expectedCalibrationError([0.05, 0.15, 0.95, 1], [false, true, true, true], 10);
    expect(r.buckets).toHaveLength(10);
    expect(r.buckets[0]).toEqual({ lo: 0, hi: 0.1, count: 1, confidence: 0.05, accuracy: 0 });
    expect(r.buckets[1]!.accuracy).toBe(1);
    expect(r.buckets[9]!.count).toBe(2); // 1.0 falls in the last bucket
    expect(r.buckets[5]).toEqual({ lo: 0.5, hi: 0.6, count: 0, confidence: 0, accuracy: 0 });
    // (0.05 + 0.85 + 0.05 + 0) / 4
    expect(r.ece).toBeCloseTo((0.05 + 0.85 + 0.05) / 4, 12);
    expect(expectedCalibrationError([], []).ece).toBe(0);
    expect(() => expectedCalibrationError([0.5], [])).toThrow(/length/);
    expect(() => expectedCalibrationError([0.5], [true], 0)).toThrow(/bins/);
  });
  it('confidenceSample masks a note any annotation leaves unfingered and marks every annotator finger correct', () => {
    const gaps = [0, 1.5, Infinity, 2, 4];
    expect(confidenceSample(gaps, 1, [1, 2])).toEqual({
      margins: gaps,
      chosen: 0,
      correct: [true, true, false, false, false],
      target: [0.5, 0.5, 0, 0, 0],
    });
    expect(confidenceSample(gaps, 1, [4])!.correct).toEqual([false, false, false, true, false]);
    expect(confidenceSample(gaps, 1, [4])!.target).toEqual([0, 0, 0, 1, 0]);
    expect(confidenceSample(gaps, 1, [1, 1, 2, 1, 5])!.target).toEqual([0.6, 0.2, 0, 0, 0.2]);
    expect(confidenceSample(gaps, 1, [1, 0])).toBeUndefined(); // finger 0 = unfingered
    expect(confidenceSample(gaps, 1, [1, undefined])).toBeUndefined();
    expect(confidenceSample(gaps, 1, [])).toBeUndefined();
    expect(confidenceSample(undefined, 1, [1])).toBeUndefined();
    expect(confidenceSample(gaps, undefined, [1])).toBeUndefined();
  });
  it('confidenceSamples solves each piece and keeps the notes every annotation fingers', () => {
    const H = '//Version: PianoFingering_v170101\n';
    const scale = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
    const pig = (fingers: number[]) =>
      H +
      scale
        .map((p, i) => `${i}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t0\t${fingers[i]}`)
        .join('\n') +
      '\n';
    const fa = [1, 2, 3, 1, 2, 3, 4, 5];
    const fb = [1, 2, 3, 4, 1, 2, 3, 0]; // the last note unfingered in the second annotation
    const a = parsePig(pig(fa));
    const b = parsePig(pig(fb));
    const piece = { score: a.score, annotations: [a.assignment, annotationOn(a.score, b)] };
    const samples = confidenceSamples([piece], { profile: 'large' });
    expect(samples).toHaveLength(7);
    const solved = solveFingering(a.score, { profile: 'large' });
    a.score.notes.slice(0, 7).forEach((n, i) => {
      const s = samples[i]!;
      expect(s.margins).toEqual(solved.explanations[n.id]!.gaps);
      expect(s.chosen).toBe(solved.assignment[n.id]!.finger - 1);
      const right = s.correct.flatMap((c, f) => (c ? [f + 1] : []));
      expect(right).toEqual([...new Set([fa[i]!, fb[i]!])].sort((x, y) => x - y));
      // Each of the two annotations carries half of the note.
      expect(s.target).toEqual([1, 2, 3, 4, 5].map((f) => (+(fa[i] === f) + +(fb[i] === f)) / 2));
      // The solver's own confidence is confidenceOf at the set's temperature (2 for parncutt).
      expect(confidenceOf(s.margins, s.chosen, 2)).toBeCloseTo(
        solved.assignment[n.id]!.confidence,
        12,
      );
    });
  });
  it('calibrate reports the ECE of the chosen fingers at a temperature', () => {
    const samples: ConfidenceSample[] = [
      { margins: [0, 1, 1, 1, 1], chosen: 0, correct: [true, false, false, false, false] },
      { margins: [0, 1, 1, 1, 1], chosen: 0, correct: [false, true, false, false, false] },
      { margins: [1, 0, Infinity, 3, 3], chosen: 1, correct: [false, true, false, false, false] },
    ];
    const r = calibrate(samples, 2);
    const conf = samples.map((s) => confidenceOf(s.margins, s.chosen, 2));
    const direct = expectedCalibrationError(
      conf,
      samples.map((s) => s.correct[s.chosen]!),
    );
    expect(r.temperature).toBe(2);
    expect(r.samples).toBe(3);
    expect(r.ece).toBeCloseTo(direct.ece, 12);
    expect(r.buckets).toEqual(direct.buckets);
    expect(r.nll).toBeCloseTo(negativeLogLikelihood(samples, 2), 12);
  });
});

describe('calibration per annotator (soft labels, M3 Task 9)', () => {
  const gaps = [0, 0.8, 1.6, Infinity, 3];
  it('expectedCalibrationError takes a share of correctness in [0, 1] as well as a boolean', () => {
    // Two notes at confidence 0.6 whose chosen fingers 2 of 4 and 7 of 10 annotators use.
    const r = expectedCalibrationError([0.6, 0.6], [0.5, 0.7]);
    expect(r.buckets[6]!.count).toBe(2);
    expect(r.buckets[6]!.accuracy).toBeCloseTo(0.6, 12);
    expect(r.ece).toBeCloseTo(0, 12);
    expect(expectedCalibrationError([0.6], [true]).ece).toBeCloseTo(0.4, 12);
    expect(() => expectedCalibrationError([0.6], [1.5])).toThrow(/correct/);
  });
  it('a bucket’s accuracy is the mean share of annotators who use the chosen finger', () => {
    // The engine's finger 1 is what 2 of 5 annotators write: 0.4 of a hit, not 1 (any annotator).
    const s = confidenceSample(gaps, 1, [1, 2, 1, 2, 2])!;
    expect(s.target).toEqual([0.4, 0.6, 0, 0, 0]);
    const r = calibrate([s], 2);
    const conf = confidenceOf(gaps, 0, 2);
    const bucket = r.buckets.find((b) => b.count === 1)!;
    expect(bucket.accuracy).toBeCloseTo(0.4, 12);
    expect(r.ece).toBeCloseTo(Math.abs(0.4 - conf), 12);
  });
  it('on one annotator it equals the any-annotator definition', () => {
    const right = confidenceSample(gaps, 1, [1])!;
    const wrong = confidenceSample(gaps, 1, [3])!;
    const r = calibrate([right, wrong], 1.5);
    const conf = confidenceOf(gaps, 0, 1.5);
    expect(r.ece).toBeCloseTo(Math.abs(0.5 - conf), 12); // one hit, one miss, same confidence
    expect(r.nll).toBeCloseTo(
      -Math.log(confidenceOf(gaps, 0, 1.5)) - Math.log(confidenceOf(gaps, 2, 1.5)),
      12,
    );
  });
  it('does not depend on how many annotators a piece has, only on their shares', () => {
    const few = [confidenceSample(gaps, 1, [1, 2])!, confidenceSample(gaps, 2, [2, 3])!];
    const many = [
      confidenceSample(gaps, 1, [1, 2, 1, 2, 2, 1])!,
      confidenceSample(gaps, 2, [3, 2, 2, 3, 3, 2])!,
    ];
    expect(many.map((s) => s.target)).toEqual(few.map((s) => s.target));
    expect(calibrate(many, 2)).toEqual(calibrate(few, 2));
    expect(fitTemperature(many)).toBe(fitTemperature(few));
  });
  it('an annotator whose finger the solver prices at a hard-rule penalty is left out of the likelihood, the others keep their share', () => {
    const m = [0, 2, 1000, 4, 6];
    const s = confidenceSample(m, 1, [1, 3])!; // the second annotator's finger 3 breaks a law
    expect(negativeLogLikelihood([s], 2)).toBeCloseTo(-0.5 * Math.log(confidenceOf(m, 0, 2)), 12);
    expect(negativeLogLikelihood([s], 2, { penaltyMargin: Infinity })).toBeGreaterThan(249);
  });
  it('is exported from the package entry with the sample builders', async () => {
    const index = await import('../index.js');
    expect(index.confidenceSamples).toBe(confidenceSamples);
    expect(index.confidenceSample).toBe(confidenceSample);
  });
});
