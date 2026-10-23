import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, groupOf } from './blur-sweep.mjs';

/** One scorecard row: `value` is the measure (null when the tracer finds no staff), `read` whether
 * homr read the bars and the staves right, `lost` whether it lost a staff. */
function row(page, variant, value, { read = false, lost = false, kind = 'truth', staves = 8, sharp = 5000 } = {}) {
  return {
    page,
    kind,
    variant,
    read,
    stavesRight: !lost,
    measure: value === null ? { value: null, sharp } : { value, staves, sharp },
  };
}
const photo = { kind: 'photo' };

test('groupOf: motion across the lines, along them, and Gaussian blur', () => {
  assert.equal(groupOf('g1.5'), 'gauss');
  assert.equal(groupOf('gd25'), 'gauss');
  assert.equal(groupOf('mv6'), 'vertical');
  assert.equal(groupOf('mh9'), 'horizontal');
});

test('calibrate: a feasible set gives the floor with the best agreement, rounded up to a milli', () => {
  const rows = [
    row('P1', 'g0', 0.2, { read: true, ...photo }),
    row('P2', 'g0', 0.28, { read: true, ...photo }),
    row('T', 'g0', 0.14, { read: true }),
    row('P1', 'g1', 0.3, { read: true, ...photo }),
    row('P1', 'g2', 0.5, { ...photo }),
    row('P1', 'g3', 0.62, { lost: true, ...photo }),
    row('T', 'g1', 0.26, { read: true }),
    row('T', 'g2', 0.4504, { read: true }),
    row('T', 'g3', 0.7, { lost: true }),
  ];
  const c = calibrate(rows);
  assert.equal(c.feasible, true);
  assert.equal(c.photos, 2);
  assert.equal(c.measured, 9);
  assert.equal(c.lowest, 0.28);
  assert.equal(c.highest, 0.62);
  // 0.4504 keeps every right-read variant and rejects every other: agreement 9 of 9.
  assert.equal(c.floor, 0.451);
  assert.equal(c.agreement, 1);
  assert.equal(c.photoRejected, 0);
  assert.equal(c.stavesFalsePass, 0);
  assert.equal(c.rightRejected, 0);
  assert.equal(c.rightTotal, 6);
  assert.equal(c.lostStaves, 2);
  assert.equal(c.lostStavesRejected, 2);
});

test('calibrate: infeasible when a photo as taken is softer than the lowest variant that loses its staves', () => {
  const rows = [
    row('P1', 'g0', 0.4, { read: true, ...photo }),
    row('P1', 'g1', 0.6, { ...photo }),
    row('P1', 'g2', 0.35, { lost: true, ...photo }),
  ];
  const c = calibrate(rows);
  assert.equal(c.feasible, false);
  assert.equal(c.lowest, 0.4);
  assert.equal(c.highest, 0.35);
  assert.equal(c.floor, undefined);
});

test('calibrate: a tie in agreement goes to the larger floor', () => {
  const rows = [
    row('P1', 'g0', 0.2, { read: true, ...photo }),
    row('P1', 'g1', 0.3, { ...photo }),
    row('P1', 'g2', 0.3504, { read: true, ...photo }),
    row('P1', 'g3', 0.9, { lost: true, ...photo }),
  ];
  const c = calibrate(rows);
  // Floors 0.2 and 0.3504 both agree on 3 of 4 variants; 0.3 on 2.
  assert.equal(c.feasible, true);
  assert.equal(c.agreement, 0.75);
  assert.equal(c.floor, 0.351);
});

test('calibrate: blur along the lines does not decide the floor and is reported apart', () => {
  const rows = [
    row('P1', 'g0', 0.2, { read: true, ...photo }),
    row('P1', 'g1', 0.4, { lost: true, ...photo }),
    // A horizontal-motion variant that loses its staves below the photo: it would make the set infeasible.
    row('P1', 'mh9', 0.1, { lost: true, ...photo }),
    row('P1', 'mh3', 0.19, { read: true, ...photo }),
  ];
  const c = calibrate(rows);
  assert.equal(c.feasible, true);
  assert.equal(c.eligible, 2);
  assert.equal(c.measured, 2);
  assert.equal(c.highest, 0.4);
  assert.equal(c.horizontalLost, 1);
  assert.equal(c.horizontalFalsePass, 1);
});

test('calibrate: a variant without a measure is not judged, and the camera falls back to the live measure', () => {
  const rows = [
    row('P1', 'g0', 0.2, { read: true, ...photo }),
    row('P1', 'g1', 0.4, { lost: true, ...photo }),
    // No staff is traced; the live 360 px measure (80 or more is trackable) passes it.
    row('P1', 'g2', null, { lost: true, sharp: 500, ...photo }),
    row('P1', 'g3', null, { lost: true, sharp: 10, ...photo }),
    // A page homr misreads unblurred takes no part.
    row('Q', 'g0', 0.3),
    row('Q', 'g1', 0.1, { lost: true }),
  ];
  const c = calibrate(rows);
  assert.equal(c.feasible, true);
  assert.equal(c.eligible, 4);
  assert.equal(c.measured, 2);
  assert.equal(c.unjudged, 2);
  assert.equal(c.highest, 0.4);
  assert.equal(c.lostStaves, 3);
  assert.equal(c.lostStavesRejected, 1);
  assert.equal(c.lostStavesUnjudged, 2);
  // Combined: the staff measure where there is one, else the live measure.
  assert.equal(c.gates.combined.lostStavesPassed, 1);
  assert.equal(c.gates.live.lostStavesPassed, 2);
  // Strict: no traced staff counts as blurry.
  assert.equal(c.gates.strict.lostStavesPassed, 0);
  assert.equal(c.gates.strict.lostStavesRejected, 3);
});

test('calibrate: rounding up never reaches the lowest variant that loses its staves', () => {
  const rows = [
    row('P1', 'g0', 0.2, { read: true, ...photo }),
    row('P1', 'g1', 0.4504, { read: true, ...photo }),
    row('P1', 'g2', 0.4507, { lost: true, ...photo }),
  ];
  const c = calibrate(rows);
  assert.equal(c.feasible, true);
  // ceil to the milli is 0.451, above 0.4507: the floor stays at the measured value.
  assert.equal(c.floor, 0.4504);
  assert.equal(c.stavesFalsePass, 0);
});

test('calibrate: a minimum coverage leaves variants with a partial trace unjudged', () => {
  const rows = [
    row('P1', 'g0', 0.25, { read: true, ...photo, staves: 11 }),
    row('P1', 'g1', 0.4, { read: true, ...photo, staves: 9 }),
    // The tracer found 2 of the page's 11 staves: its low measure is the sharpest parts of the page.
    row('P1', 'g2', 0.48, { lost: true, ...photo, staves: 2 }),
    row('P1', 'g3', 0.62, { lost: true, ...photo, staves: 9 }),
  ];
  const all = calibrate(rows);
  assert.equal(all.feasible, true);
  assert.equal(all.highest, 0.48);
  assert.equal(all.floor, 0.4);
  const covered = calibrate(rows, { minCoverage: 0.5 });
  assert.equal(covered.feasible, true);
  assert.equal(covered.measured, 3);
  assert.equal(covered.highest, 0.62);
  assert.equal(covered.lostStavesUnjudged, 1);
  assert.equal(covered.floor, 0.4);
});

test('calibrate: every measurable photo as taken bounds the floor, whether or not homr reads it', () => {
  const rows = [
    row('P1', 'g0', 0.2, { read: true, ...photo }),
    row('P1', 'g1', 0.5, { lost: true, ...photo }),
    // A photo homr misreads as taken, so its blur variants take no part, but it must still pass the gate.
    row('P2', 'g0', 0.3, { ...photo }),
  ];
  const c = calibrate(rows);
  assert.equal(c.photos, 2);
  assert.equal(c.lowest, 0.3);
  assert.equal(c.feasible, false);
});
