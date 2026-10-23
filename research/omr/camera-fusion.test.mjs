// node --test research/omr/camera-fusion.test.mjs: the camera model's geometry, which every
// matrix and corner the benchmark hands the reconstruction rests on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SEVERITIES, fourPoint, makeCamera, planViews, project, rng, sliceScore } from './camera-fusion.mjs';

test('fourPoint maps the four points and is projective', () => {
  const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
  const dst = [{ x: 3, y: 4 }, { x: 15, y: 2 }, { x: 18, y: 25 }, { x: 1, y: 22 }];
  const h = fourPoint(src, dst);
  for (let i = 0; i < 4; i++) {
    const p = project(h, src[i].x, src[i].y);
    assert.ok(Math.hypot(p.x - dst[i].x, p.y - dst[i].y) < 1e-9);
  }
});

test('a camera centres its target and sees the page plane as its homography says', () => {
  const cam = makeCamera({ target: [52.5, 74.25], distance: 200, tilt: 8, azimuth: 40, roll: 3 });
  const c = project(cam.plane, 52.5, 74.25);
  assert.ok(Math.abs(c.x - cam.cx) < 1e-6 && Math.abs(c.y - cam.cy) < 1e-6);
  // A ray through a pixel meets the plane z=0 at the point the plane homography sends there.
  const p = project(cam.plane, 150, 250);
  const { R, C, f, cx, cy } = cam;
  const dc = [(p.x - cx) / f, (p.y - cy) / f, 1];
  const dw = [0, 1, 2].map((j) => R[j] * dc[0] + R[3 + j] * dc[1] + R[6 + j] * dc[2]);
  const s = -C[2] / dw[2];
  assert.ok(Math.abs(C[0] + s * dw[0] - 150) < 1e-6 && Math.abs(C[1] + s * dw[1] - 250) < 1e-6);
  // Page x to the right and page y down in the image, as a phone held upright sees it.
  const right = project(cam.plane, 60, 74.25), down = project(cam.plane, 52.5, 80);
  assert.ok(right.x > c.x && down.y > c.y);
});

test('view plans are deterministic per seed and differ between seeds', () => {
  const a = planViews('x', SEVERITIES.harsh), b = planViews('x', SEVERITIES.harsh), c = planViews('y', SEVERITIES.harsh);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a[1].camera.plane, c[1].camera.plane);
  assert.equal(rng('s')(), rng('s')());
});

// A page of a longer piece is scored against its own bars of the reference. Cutting those bars out
// must keep the piece's bar timing: the cut starts at tick 0, as a recognised page does, and every
// bar keeps its length and its notes' onsets within the bar (issue 163).
const E = await import(pathToFileURL(resolve(import.meta.dirname, '../../packages/engine/dist/src/index.js')).href);

const piece = (bars, first = 0) => {
  const bar = (i) =>
    `<measure number="${i + 1}">${i === first ? '<attributes><divisions>2</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' : ''}` +
    `<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type></note>` +
    `<note><pitch><step>${'DEFGAB'[i % 6]}</step><octave>5</octave></pitch><duration>4</duration><type>half</type></note></measure>`;
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">${Array.from({ length: bars - first }, (_, i) => bar(first + i)).join('')}</part></score-partwise>`;
};
const barLocal = (score) =>
  score.measures.map((m) => ({
    length: m.lengthTicks,
    onsets: score.notes.filter((n) => n.measureIndex === m.index).map((n) => [n.onsetTick - m.startTick, n.offsetTick - n.onsetTick, n.midi]),
  }));

test('a sliced score keeps the bar timing of the original and starts at tick zero', () => {
  const whole = E.parseMusicXml(piece(8), { preserveNotation: true }).score;
  const slice = sliceScore(whole, 3, 6);
  assert.equal(slice.measures.length, 3);
  assert.equal(slice.measures[0].startTick, 0);
  // Each bar starts where the previous one ends, as in the original.
  for (let i = 1; i < 3; i++) assert.equal(slice.measures[i].startTick, slice.measures[i - 1].startTick + slice.measures[i - 1].lengthTicks);
  assert.deepEqual(barLocal(slice), barLocal(whole).slice(3, 6));
  // The bar starts relative to the first kept bar equal the original's.
  assert.deepEqual(
    slice.measures.map((m) => m.startTick),
    whole.measures.slice(3, 6).map((m) => m.startTick - whole.measures[3].startTick),
  );
  // The original is untouched.
  assert.ok(whole.measures[3].startTick > 0);
});

test('a recognition of a page equals its slice of the reference bar for bar, on every page', () => {
  const whole = E.parseMusicXml(piece(8), { preserveNotation: true }).score;
  for (const [from, to] of [[0, 3], [3, 6], [6, 8]]) {
    // The page as a recogniser writes it: its own bars from tick zero.
    const page = E.parseMusicXml(piece(to, from), { preserveNotation: true }).score;
    const result = E.evaluateOmr(sliceScore(whole, from, to), page);
    assert.equal(result.barTimingMismatches, 0, `bars ${from + 1} to ${to}`);
    assert.equal(result.metrics.fullNote.f1, 1);
  }
});
