import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framing, imagePositions, insideShare, pairNotes, quantile, summarise } from './imgpos.mjs';

test('each note takes the position in its own comment, null without one', () => {
  const xml = `<score-partwise><part><measure>
    <note><!-- imgpos: 190, 56 --><pitch><step>C</step></pitch></note>
    <note id="s1"><pitch><step>D</step></pitch></note>
    <note><!-- imgpos: 12.5, -3 --></note>
  </measure></part></score-partwise>`;
  assert.deepEqual(imagePositions(xml), [{ x: 190, y: 56 }, null, { x: 12.5, y: -3 }]);
});

test('quantiles take the nearest rank and summaries round and count the shares', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(quantile(sorted, 0.5), 5);
  assert.equal(quantile(sorted, 0.9), 9);
  assert.equal(quantile([], 0.5), null);
  const s = summarise([0.4, 0.6, 0.9, 1.2, 2.6]);
  assert.equal(s.notes, 5);
  assert.equal(s.median, 0.9);
  assert.equal(s.p90, 2.6);
  assert.equal(s.within[1], 0.6);
  assert.equal(s.within[0.5], 0.2);
  assert.equal(s.within[3], 1);
});

test('a note is inside a crop of half height H when |dy| <= H and |dx| <= 2H', () => {
  const dx = [0.2, 2.0, 2.1, 0.5];
  const dy = [0.1, 0.9, 0.2, 1.6];
  assert.equal(insideShare(dx, dy, 1), 0.5);
  assert.equal(insideShare(dx, dy, 1.5), 0.75);
  assert.equal(insideShare([], [], 1), null);
});

const score = (notes) => ({
  divisions: 4,
  measures: [{ index: 0, startTick: 0 }],
  notes: notes.map((n, i) => ({ measureIndex: 0, staff: 1, isGrace: false, sourceIndices: [i], ...n })),
});

test('notes pair by onset in the bar and pitch; a wrong pitch does not pair; graces are skipped', () => {
  const reference = score([
    { onsetTick: 0, midi: 60 },
    { onsetTick: 4, midi: 62 },
    { onsetTick: 4, midi: 55, isGrace: true },
  ]);
  const recognized = score([
    { onsetTick: 4, midi: 62 },
    { onsetTick: 0, midi: 61 },
    { onsetTick: 4, midi: 55, isGrace: true },
  ]);
  const pairs = pairNotes(reference, recognized);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0][0].midi, 62);
  assert.equal(pairs[0][1].sourceIndices[0], 1);
});

test('framing counts the notes within half a space of the head in both axes, and those that end farther away', () => {
  // Four notes: near the head, 0.6 off in one axis (unchanged), far and moved onto the head, near and moved away.
  const before = { dx: [0.4, 0.6, 0.9, 0.1], dy: [0.4, 0, 0.9, 0.1] };
  const after = { dx: [0.1, 0.6, 0.1, 0.8], dy: [0.1, 0, 0.1, 0.8] };
  const f = framing(after.dx, after.dy, before.dx, before.dy);
  assert.deepEqual(f.framed, { 0.5: 0.5, 0.75: 0.75 });
  assert.deepEqual(f.framedBefore, { 0.5: 0.5, 0.75: 0.75 });
  assert.equal(f.worse, 0.25);
});
