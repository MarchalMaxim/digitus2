import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alignNotes,
  auroc,
  confidences,
  jointOf,
  MIN_NOTES,
  midiOf,
  pageDoubtOf,
  pitchAlternatives,
  quartersOf,
  withinPageAuroc,
} from './confidence.mjs';

const conf = (rhythm, pitch, lift = '_ 1') =>
  `<!-- conf: rhythm ${rhythm}; pitch ${pitch}; lift ${lift} -->`;

test("homr's accidental head is the sounding alteration: '_' is natural whatever the key", () => {
  assert.equal(midiOf('F4', '_'), 65);
  assert.equal(midiOf('F4', '#'), 66);
  assert.equal(midiOf('B3', 'b'), 58);
  assert.equal(midiOf('C4', 'N'), 60);
  assert.equal(midiOf('_', '_'), null);
});

test('pitch alternatives leave out the reading itself and rank by joint probability', () => {
  const c = confidences(`<note>${conf('note_4 0.9', 'F4 0.7 G4 0.2 E4 0.1', '_ 0.6 # 0.4')}</note>`)[0];
  const alts = pitchAlternatives(c);
  // F4 natural is the reading; E4 sharp sounds as it does, so it is no alternative.
  assert.deepEqual(alts.map(([m]) => m), [66, 67, 68, 64]);
  assert.equal(alts[0][0], 66);
  assert.ok(Math.abs(alts[0][1] - 0.28) < 1e-9);
});

test('rhythm tokens are lengths in quarters, kern style', () => {
  assert.equal(quartersOf('note_4'), 1);
  assert.equal(quartersOf('note_8.'), 0.75);
  assert.equal(quartersOf('note_12'), 1 / 3);
  assert.equal(quartersOf('note_8G'), null);
  assert.equal(quartersOf('barline'), null);
});

test('alignment pairs a note pushed later by an earlier misread length with its own true note', () => {
  const length = (n) => n.len;
  // Truth: C D E quarters. Recognised: C as a half (misread), then D and E a beat late.
  const ref = [{ midi: 60, len: 1 }, { midi: 62, len: 1 }, { midi: 64, len: 1 }];
  const rec = [{ midi: 60, len: 2 }, { midi: 62, len: 1 }, { midi: 64, len: 1 }];
  const pairs = alignNotes(rec, ref, length);
  assert.deepEqual(pairs.map(([r, t]) => [r.midi, t?.midi]), [[60, 60], [62, 62], [64, 64]]);
  // An extra note stays unpaired; a substitution pairs with the true note it replaced.
  const extra = alignNotes([{ midi: 60, len: 1 }, { midi: 61, len: 1 }, { midi: 62, len: 1 }], ref.slice(0, 2), length);
  assert.deepEqual(extra.map(([r, t]) => [r.midi, t?.midi ?? null]), [[60, 60], [61, null], [62, 62]]);
  const sub = alignNotes([{ midi: 60, len: 1 }, { midi: 63, len: 1 }, { midi: 64, len: 1 }], ref, length);
  assert.deepEqual(sub.map(([r, t]) => [r.midi, t?.midi]), [[60, 60], [63, 62], [64, 64]]);
});

test("a page's doubt counts sounding notes only, as the review does, and needs MIN_NOTES of them", () => {
  const note = (p, extra = '') =>
    `<note>${extra}<pitch><step>C</step><octave>4</octave></pitch>${conf(`note_4 ${p}`, 'C4 1')}</note>`;
  const notes = Array.from({ length: MIN_NOTES }, () => note(0.9)).join('');
  assert.ok(Math.abs(pageDoubtOf(notes) - 0.1) < 1e-9);
  const ignored = `<note><rest/>${conf('rest_4 0.1', '_ 1')}</note><note><grace/>${conf('note_8 0.1', 'C4 1')}</note>${note(0.1, '<tie type="stop"/>')}`;
  assert.ok(Math.abs(pageDoubtOf(notes + ignored) - 0.1) < 1e-9);
  assert.equal(pageDoubtOf(note(0.9).repeat(MIN_NOTES - 1)), null);
  assert.equal(jointOf({ rhythm: [['note_4', 0.5]], pitch: [['C4', 0.5]] }), 0.25);
});

test('AUROC within pages centres each page on its median and skips pages without both kinds', () => {
  assert.equal(auroc([{ score: 2, positive: true }, { score: 1, positive: false }]), 1);
  assert.equal(auroc([{ score: 1, positive: true }, { score: 1, positive: false }]), 0.5);
  // Page a is all high, page b all low; within each page the wrong notes score higher.
  const rows = [
    ...[10, 10.1, 10.9, 11].map((s, i) => ({ page: 'a', s, wrong: i >= 2 })),
    ...[0, 0.1, 0.9, 1].map((s, i) => ({ page: 'b', s, wrong: i >= 2 })),
    { page: 'c', s: 5, wrong: true },
  ];
  const r = withinPageAuroc(rows, (x) => x.s, (x) => x.wrong, (x) => x.page);
  assert.equal(r.pages, 2);
  assert.equal(r.auroc, 1);
});
