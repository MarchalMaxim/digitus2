import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import type { Note, Score } from '../score/types.js';
import { evaluateOmr } from './omr.js';

const note = (overrides: Partial<Note> = {}): Note => ({
  id: 'n',
  onsetTick: 0,
  offsetTick: 4,
  onsetSec: 0,
  offsetSec: 1,
  midi: 60,
  spelling: { step: 'C', alter: 0, octave: 4 },
  hand: 'R',
  staff: 1,
  voice: 1,
  measureIndex: 0,
  isGrace: false,
  chordId: 'c',
  sourceIndices: [],
  ...overrides,
});
const score = (notes: Note[] = [note()], overrides: Partial<Score> = {}): Score => ({
  meta: {},
  divisions: 4,
  tempoMap: [],
  timeSignatures: [],
  keySignatures: [],
  measures: [{ index: 0, startTick: 0, lengthTicks: 16, number: '1' }],
  notes,
  ...overrides,
});

describe('evaluateOmr', () => {
  it('reports exact counts and unit precision, recall and F1 for a perfect score', () => {
    const reference = score([note(), note({ midi: 64 })]);
    const result = evaluateOmr(reference, reference);
    expect(result).toMatchObject({
      referenceNotes: 2,
      recognizedNotes: 2,
      referenceBars: 1,
      recognizedBars: 1,
      missingBars: 0,
      extraBars: 0,
      barTimingMismatches: 0,
    });
    for (const metric of Object.values(result.metrics)) {
      expect(metric).toEqual({
        matched: 2,
        reference: 2,
        recognized: 2,
        precision: 1,
        recall: 1,
        f1: 1,
      });
    }
    expect(result.bars[0]?.metrics).toEqual(result.metrics);
  });

  it('normalizes divisions exactly and ignores IDs, chord order and voice labels', () => {
    const reference = score([
      note({ midi: 60 }),
      note({ midi: 64 }),
      note({ midi: 55, voice: 2, offsetTick: 8 }),
    ]);
    const recognized = score(
      [...reference.notes].reverse().map((n) => ({
        ...n,
        id: 'other',
        chordId: 'different',
        sourceIndices: [900],
        voice: n.voice + 70,
        onsetTick: n.onsetTick * 3,
        offsetTick: n.offsetTick * 3,
      })),
      {
        divisions: 12,
        measures: [{ index: 0, startTick: 0, lengthTicks: 48, number: 'unrelated' }],
      },
    );
    expect(evaluateOmr(reference, recognized).metrics.fullNote.f1).toBe(1);
    expect(evaluateOmr(reference, recognized).barTimingMismatches).toBe(0);
  });

  it('compares rational thirds without floating point rounding', () => {
    const reference = score([note({ onsetTick: 1, offsetTick: 2 })], { divisions: 3 });
    const recognized = score([note({ onsetTick: 7, offsetTick: 14 })], { divisions: 21 });
    expect(evaluateOmr(reference, recognized).metrics.fullNote.matched).toBe(1);
  });

  it('counts duplicate notes as a multiset and penalizes insertions', () => {
    const result = evaluateOmr(score(), score([note(), note(), note({ midi: 64 })]));
    expect(result.metrics.pitch).toEqual({
      matched: 1,
      reference: 1,
      recognized: 3,
      precision: 1 / 3,
      recall: 1,
      f1: 0.5,
    });
  });

  it('penalizes deletions with recall and keeps precision independent', () => {
    const result = evaluateOmr(score([note(), note({ midi: 64 })]), score());
    expect(result.metrics.pitch).toEqual({
      matched: 1,
      reference: 2,
      recognized: 1,
      precision: 1,
      recall: 0.5,
      f1: 2 / 3,
    });
  });

  it('penalizes a substituted pitch in both precision and recall', () => {
    const result = evaluateOmr(
      score([note(), note({ midi: 64 })]),
      score([note(), note({ midi: 65 })]),
    );
    expect(result.metrics.pitch.f1).toBe(0.5);
    expect(result.metrics.onsetPitch.matched).toBe(1);
  });

  it('scores each projection independently when the right pitches occur at wrong times', () => {
    const result = evaluateOmr(
      score([note(), note({ midi: 64, onsetTick: 4, offsetTick: 8 })]),
      score([note({ midi: 64 }), note({ onsetTick: 4, offsetTick: 8 })]),
    );
    expect(result.metrics.pitch.f1).toBe(1);
    expect(result.metrics.onsetPitch.f1).toBe(0);
  });

  it('distinguishes duration errors from pitch, onset and staff errors', () => {
    const result = evaluateOmr(score(), score([note({ offsetTick: 8 })]));
    expect(result.metrics.pitch.f1).toBe(1);
    expect(result.metrics.onsetPitch.f1).toBe(1);
    expect(result.metrics.staff.f1).toBe(1);
    expect(result.metrics.voice.f1).toBe(1);
    expect(result.metrics.duration.f1).toBe(0);
    expect(result.metrics.fullNote.f1).toBe(0);
  });

  it('detects a staff swap without penalizing pitch or duration', () => {
    const result = evaluateOmr(score(), score([note({ staff: 2 })]));
    expect(result.metrics.duration.f1).toBe(1);
    expect(result.metrics.staff.f1).toBe(0);
    expect(result.metrics.voice.f1).toBe(0);
    expect(result.metrics.fullNote.f1).toBe(0);
  });

  it.each(['merge', 'split'])('detects a voice %s while ignoring literal labels', (change) => {
    const separate = score([note({ voice: 1 }), note({ midi: 64, voice: 2 })]);
    const together = score([note({ voice: 93 }), note({ midi: 64, voice: 93 })]);
    const result =
      change === 'merge' ? evaluateOmr(separate, together) : evaluateOmr(together, separate);
    expect(result.metrics.staff.f1).toBe(1);
    expect(result.metrics.voice.f1).toBe(0);
    expect(result.metrics.fullNote.f1).toBe(0);
  });

  it('canonicalizes several voices and chords separately on each staff', () => {
    const reference = score([
      note(),
      note({ midi: 64 }),
      note({ midi: 55, voice: 2 }),
      note({ midi: 48, staff: 2 }),
      note({ midi: 43, staff: 2, voice: 2 }),
    ]);
    const recognized = score(
      [...reference.notes]
        .reverse()
        .map((n) => ({ ...n, voice: n.staff === 1 ? 100 - n.voice : n.voice + 900 })),
    );
    expect(evaluateOmr(reference, recognized).metrics.voice.f1).toBe(1);
  });

  it('includes grace status only in full-note equality', () => {
    const result = evaluateOmr(score(), score([note({ isGrace: true })]));
    expect(result.metrics.duration.f1).toBe(1);
    expect(result.metrics.voice.f1).toBe(1);
    expect(result.metrics.fullNote.f1).toBe(0);
  });

  it('keeps later bar onsets local when earlier bar lengths are corrupted', () => {
    const reference = score([note(), note({ measureIndex: 1, onsetTick: 16, offsetTick: 20 })], {
      measures: [
        { index: 0, startTick: 0, lengthTicks: 16, number: '1' },
        { index: 1, startTick: 16, lengthTicks: 16, number: '2' },
      ],
    });
    const recognized = score(
      [note({ offsetTick: 8 }), note({ measureIndex: 8, onsetTick: 20, offsetTick: 24 })],
      {
        measures: [
          { index: 2, startTick: 0, lengthTicks: 20, number: 'x' },
          { index: 8, startTick: 20, lengthTicks: 16, number: 'y' },
        ],
      },
    );
    recognized.notes[0]!.measureIndex = 2;
    const result = evaluateOmr(reference, recognized);
    expect(result.metrics.onsetPitch.f1).toBe(1);
    expect(result.metrics.duration.matched).toBe(1);
    expect(result.barTimingMismatches).toBe(2);
    expect(result.bars[0]?.timing.lengthMatches).toBe(false);
    expect(result.bars[1]?.timing.startMatches).toBe(false);
  });

  it('reports empty extra or missing bars despite perfect note-only metrics', () => {
    const oneBar = score([]);
    const twoBars = score([], {
      measures: [...oneBar.measures, { index: 1, startTick: 16, lengthTicks: 16, number: '2' }],
    });
    expect(evaluateOmr(oneBar, twoBars)).toMatchObject({
      extraBars: 1,
      missingBars: 0,
      barTimingMismatches: 1,
    });
    expect(evaluateOmr(twoBars, oneBar)).toMatchObject({
      missingBars: 1,
      extraBars: 0,
      barTimingMismatches: 1,
    });
    expect(evaluateOmr(oneBar, twoBars).bars[1]?.timing.referenceLength).toBeNull();
  });

  it('does not match notes across ordinal bar boundaries', () => {
    const measures = [
      { index: 0, startTick: 0, lengthTicks: 16, number: '1' },
      { index: 1, startTick: 16, lengthTicks: 16, number: '2' },
    ];
    const result = evaluateOmr(
      score([note()], { measures }),
      score([note({ measureIndex: 1, onsetTick: 16, offsetTick: 20 })], { measures }),
    );
    expect(result.metrics.pitch.f1).toBe(0);
  });

  it('uses zero rates against nonempty unmatched input and unit rates for two empty inputs', () => {
    for (const result of [
      evaluateOmr(score(), score([], { measures: [] })),
      evaluateOmr(score([], { measures: [] }), score()),
    ]) {
      expect(result.metrics.fullNote).toMatchObject({ matched: 0, precision: 0, recall: 0, f1: 0 });
    }
    expect(
      evaluateOmr(score([], { measures: [] }), score([], { measures: [] })).metrics.pitch,
    ).toEqual({ matched: 0, reference: 0, recognized: 0, precision: 1, recall: 1, f1: 1 });
  });

  it('compares sounding tied notes produced by the MusicXML parser', () => {
    const xml = (divisions: number, duration: number, voice: number) => `
      <score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name>
      </score-part></part-list><part id="P1"><measure number="1"><attributes>
      <divisions>${divisions}</divisions><time><beats>1</beats><beat-type>4</beat-type></time>
      </attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration>
      <tie type="start"/><voice>${voice}</voice><type>quarter</type></note></measure>
      <measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch>
      <duration>${duration}</duration><tie type="stop"/><voice>${voice}</voice>
      <type>quarter</type></note></measure></part></score-partwise>`;
    const reference = parseMusicXml(xml(4, 4, 1)).score;
    const recognized = parseMusicXml(xml(12, 12, 99)).score;
    expect(reference.notes).toHaveLength(1);
    expect(evaluateOmr(reference, recognized).metrics.fullNote.f1).toBe(1);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid divisions %s',
    (divisions) => {
      expect(() => evaluateOmr(score(), score([], { divisions }))).toThrow(/divisions/);
    },
  );

  it.each([NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid tick values %s',
    (tick) => {
      expect(() => evaluateOmr(score(), score([note({ onsetTick: tick })]))).toThrow(/onsetTick/);
      expect(() => evaluateOmr(score(), score([note({ offsetTick: tick })]))).toThrow(/offsetTick/);
      expect(() =>
        evaluateOmr(
          score(),
          score([], { measures: [{ index: 0, startTick: tick, lengthTicks: 16, number: '1' }] }),
        ),
      ).toThrow(/startTick/);
    },
  );

  it('rejects backwards notes, missing measure references and duplicate measure indices', () => {
    expect(() => evaluateOmr(score([note({ offsetTick: -1 })]), score())).toThrow();
    expect(() => evaluateOmr(score([note({ measureIndex: 9 })]), score())).toThrow(/measureIndex/);
    expect(() =>
      evaluateOmr(score([], { measures: [...score().measures, ...score().measures] }), score()),
    ).toThrow(/index/);
  });
});
