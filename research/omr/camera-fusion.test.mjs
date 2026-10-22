// node --test research/omr/camera-fusion.test.mjs: the camera model's geometry, which every
// matrix and corner the benchmark hands the reconstruction rests on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { SEVERITIES, fourPoint, makeCamera, planViews, project, rng } from './camera-fusion.mjs';

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
