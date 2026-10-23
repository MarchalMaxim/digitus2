#!/usr/bin/env node
// Camera multi-view fusion benchmark (issue 143): does the phone camera's new fusion give pages that
// recognise better than the best single photograph, the old fusion (commit bad8bcd) and Google
// PhotoScan's documented composition? Measured with homr against the library's MusicXML.
//
//   node research/omr/camera-fusion.mjs                      everything, cached, scorecard at the end
//   node research/omr/camera-fusion.mjs --pieces a,b         library slugs (one-page pieces)
//   node research/omr/camera-fusion.mjs --severities harsh   moderate and/or harsh
//   node research/omr/camera-fusion.mjs --parallel 2         recognize.py processes side by side
//   node research/omr/camera-fusion.mjs --no-recognize       build captures and pages only
//   node research/omr/camera-fusion.mjs --crops-only         pages (stale ones only) and crops, no OMR
//   node research/omr/camera-fusion.mjs --new-ref a33fe41    take the new camera code from a commit
//                                                             instead of the working tree (scorecard
//                                                             latest-new-<ref>.json; a33fe41 is the
//                                                             fusion before the misregistration fix)
//   node research/omr/camera-fusion.mjs --registration       check view registration against the
//                                                             camera model's exact mapping
//                                                             (registration.json), no recognition
//
// Prerequisites: `pnpm --filter @digitus2/engine build` (scoring uses packages/engine/dist), the
// web app's Playwright Chromium (rasterising and JPEG coding, as the app's browser does) and a
// prepared homr toolchain whose patches match research/omr/prototypes (DIGITUS2_OMR_HOMR, default
// C:/Users/maxim/omr/homr2). Audiveris is not needed: recognize.py is called with placeholder
// --bundle/--text-models, which only an "audiveris" job would read.
//
// Pipeline, per piece (page 1, rendered by prepare.mjs; its MusicXML is the truth) and severity:
//  1. Synthetic phone captures (camera model below): five 1920x2560 photographs of the page lying
//     on a darker table, as the guided camera takes them: a near-frontal reference, then one view
//     centred on each of the four targets at 25 %/75 % of the page. Pinhole optics with tilt, roll
//     and a curved sheet (true parallax), defocus growing from the frame centre, motion blur in
//     view 2, a hand shadow in view 3, a focus miss in view 4, a torch glare hotspot at the
//     specular point under each camera (saturated core, so it moves with the phone), exposure
//     differences, vignetting, signal-dependent sensor noise and a JPEG round trip at quality 0.9
//     in Chromium. Each view gets the tracker's matrix (the true plane homography refitted from
//     corner correspondences moved by ~1 px) and the reference gets page corners moved by up to
//     3 px. Seeded and deterministic.
//  2. Pages: apps/web/src/scan/camera/reconstruction.ts transpiled as is (new), the same files at
//     bad8bcd (old), and the new reconstruction with `fuseViews` swapped for the PhotoScan soft
//     minimum in camera-fusion-softmin.mjs (two softness values). The single-photo conditions run
//     the new reconstruction on one capture (rectification and staff flattening, no fusion). Every
//     page is encoded as JPEG 0.94, as GuidedCamera's pageFile sends it.
//  3. homr (research/omr/acceptance/recognize.py), cached by the hash of the input and of the
//     acceptance pipeline; scored note by note with the engine's evaluateOmr as acceptance.mjs does.
//  4. Real PhotoScan reference line: the three PhotoScan photographs of Bach's Invention No. 13 in
//     research/omr/photos, scored per page against the library MusicXML cut to that page's bars.
//
// Outputs (git-ignored) under research/omr/results/camera-fusion/: captures/, pages/, crops/,
// cache/, and the scorecard latest.json.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipelineHash } from './acceptance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const OUT = join(REPO, 'research/omr/results/camera-fusion');
const CAMERA = join(REPO, 'apps/web/src/scan/camera');
export const OLD_COMMIT = 'bad8bcd';
export const VERSION = 'camera-fusion-v2';

// The one-page corpus pieces whose music reaches furthest down the page (most of the corpus fills
// only its upper half, where a centred torch glare would fall on blank paper).
export const DEFAULT_PIECES = [
  'chopin-waltz-op69-no2',
  'schumann-op68-no10-the-happy-farmer',
  'schumann-op68-no1-melody',
  'bach-minuet-g-major-bwv-anh-114',
  'bach-minuet-a-minor-bwv-anh-120',
  'tchaikovsky-op39-no1-morning-prayer',
  'burgmuller-op100-no5-innocence',
  'kuhlau-sonatina-op20-no1-mvt2',
];
const INVENTION = 'bach-invention-no13-bwv-784';
export const SOFTNESS = [6, 20];

/** Degradation per severity. Angles in degrees, lengths in frame pixels unless named. */
const MODERATE = {
    refTilt: 2, viewTilt: [3, 6], roll: 2, zoom: [0.98, 1.06], curvatureMm: 3,
    light: 235, gradient: 0.08, vignette: 0.18,
    psfBase: 0.7, psfEdge: 0.9, focusMiss: 0.5, motionPx: 4,
    glarePeak: 190, glareSigma: 75, haloPeak: 25, haloSigma: 280,
    shadow: 0.35, exposure: 0.12, noise: 2.5, jpeg: 0.9, cornerJitter: 3, matrixJitter: 1,
  };
export const SEVERITIES = {
  moderate: MODERATE,
  harsh: {
    refTilt: 5, viewTilt: [7, 11], roll: 4, zoom: [0.95, 1.12], curvatureMm: 7,
    light: 225, gradient: 0.15, vignette: 0.3,
    psfBase: 1.0, psfEdge: 1.8, focusMiss: 1.0, motionPx: 9,
    glarePeak: 280, glareSigma: 110, haloPeak: 40, haloSigma: 380,
    shadow: 0.55, exposure: 0.25, noise: 5, jpeg: 0.9, cornerJitter: 3, matrixJitter: 1,
  },
  // The moderate captures (same seed, so the same cameras, noise and jitter) with one view's image
  // displaced locally: a Gaussian bump of amplitude 3 px and sigma 40 px (about one staff high) at
  // page (0.55, 0.30), which neither the tracker's matrix nor the page geometry knows about. It is
  // narrower than the local registration's grid (65 analysis px, ~140 frame px), so the
  // registration cannot follow it and keeps a residual misregistration of 1-3 px there at full
  // confidence (registrationCheck reports it as shiftRegion). The failure mode found in review;
  // compare with moderate.
  misregistered: { ...MODERATE, seedAs: 'moderate', localShift: { view: 3, amplitude: 3, sigma: 40, page: [0.55, 0.3], direction: [0.6, 0.8] } },
};
const FRAME = { width: 1920, height: 2560, focal: 1478 };
const PAGE_MM = { width: 210, height: 297 };
const TEXTURE_SCALE = 12; // texture pixels per millimetre (2x the fixture render)
const TARGETS = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]];

const sha = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- small linear algebra
const mul3 = (a, b) => {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const inv3 = (m) => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
};
export const project = (h, x, y) => {
  const d = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
};
function squareToQuad(p) {
  const [a, b, c, d] = p;
  const dx = a.x - b.x + c.x - d.x, dy = a.y - b.y + c.y - d.y;
  const bx = b.x - c.x, by = b.y - c.y, ex = d.x - c.x, ey = d.y - c.y;
  const det = bx * ey - ex * by;
  const g = Math.abs(dx) + Math.abs(dy) < 1e-12 ? 0 : (dx * ey - ex * dy) / det;
  const h = Math.abs(dx) + Math.abs(dy) < 1e-12 ? 0 : (bx * dy - dx * by) / det;
  return [b.x - a.x + g * b.x, d.x - a.x + h * d.x, a.x, b.y - a.y + g * b.y, d.y - a.y + h * d.y, a.y, g, h, 1];
}
/** The homography taking four points to four points. */
export function fourPoint(src, dst) {
  const h = mul3(squareToQuad(dst), inv3(squareToQuad(src)));
  return h.map((v) => v / h[8]);
}
const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------------------------------------------------------------- seeded randomness
export function rng(seed) {
  let s = parseInt(sha(String(seed)).slice(0, 8), 16) >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  next.gauss = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    const u = Math.max(1e-12, next()), v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  return next;
}

// ---------------------------------------------------------------- the camera model
/** A pinhole camera looking at `target` (mm on the page plane z=0; the camera is at z<0). */
export function makeCamera({ target, distance, tilt, azimuth, roll }) {
  const t = (tilt * Math.PI) / 180, a = (azimuth * Math.PI) / 180, r = (roll * Math.PI) / 180;
  const C = [target[0] + distance * Math.sin(t) * Math.cos(a), target[1] + distance * Math.sin(t) * Math.sin(a), -distance * Math.cos(t)];
  const z = norm([target[0] - C[0], target[1] - C[1], -C[2]]);
  let x = norm(cross([0, 1, 0], z));
  let y = cross(z, x);
  // Roll about the optical axis.
  [x, y] = [x.map((v, i) => Math.cos(r) * v + Math.sin(r) * y[i]), y.map((v, i) => -Math.sin(r) * x[i] + Math.cos(r) * v)];
  const f = FRAME.focal, cx = (FRAME.width - 1) / 2, cy = (FRAME.height - 1) / 2;
  const R = [...x, ...y, ...z];
  const t3 = [0, 1, 2].map((i) => -(R[i * 3] * C[0] + R[i * 3 + 1] * C[1] + R[i * 3 + 2] * C[2]));
  // Page mm (u, v, 0) -> frame pixels.
  const plane = mul3([f, 0, cx, 0, f, cy, 0, 0, 1], [R[0], R[1], t3[0], R[3], R[4], t3[1], R[6], R[7], t3[2]]);
  return { R, C, f, cx, cy, plane: plane.map((v) => v / plane[8]) };
}
const height = (u, v, amplitude) => {
  const s = (2 * u) / PAGE_MM.width - 1;
  return amplitude * Math.max(0, 1 - s * s) * (0.75 + 0.25 * Math.sin((Math.PI * v) / PAGE_MM.height));
};

function gaussianBlur(src, width, h, sigma) {
  if (sigma <= 0.05) return Float32Array.from(src);
  const r = Math.ceil(3 * sigma), k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const o = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += k[i + r] * src[o + Math.min(width - 1, Math.max(0, x + i))];
      tmp[o + x] = acc;
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * width + x];
      out[y * width + x] = acc;
    }
  return out;
}
/** Where and how far a local shift moves the image (frame pixels). */
export function localShiftAt(view, shift) {
  const c = project(view.camera.plane, shift.page[0] * PAGE_MM.width, shift.page[1] * PAGE_MM.height);
  const n = Math.hypot(...shift.direction);
  return { cx: c.x, cy: c.y, sigma: shift.sigma, dx: (shift.amplitude * shift.direction[0]) / n, dy: (shift.amplitude * shift.direction[1]) / n };
}
const bump = (s, x, y) => Math.exp(-((x - s.cx) ** 2 + (y - s.cy) ** 2) / (2 * s.sigma ** 2));
/** Moves image content near (cx, cy) by up to (dx, dy): out(p) = in(p - d(p)), bilinear. */
export function shiftLocally(rgba, s) {
  const { width: W, height: H } = FRAME, out = Uint8ClampedArray.from(rgba), r = 4 * s.sigma;
  for (let y = Math.max(0, Math.floor(s.cy - r)); y < Math.min(H, s.cy + r); y++)
    for (let x = Math.max(0, Math.floor(s.cx - r)); x < Math.min(W, s.cx + r); x++) {
      const b = bump(s, x, y), sx = Math.max(0, Math.min(W - 1.001, x - s.dx * b)), sy = Math.max(0, Math.min(H - 1.001, y - s.dy * b));
      const ix = sx | 0, iy = sy | 0, tx = sx - ix, ty = sy - iy;
      for (let c = 0; c < 3; c++) {
        const at = (px, py) => rgba[(py * W + px) * 4 + c];
        out[(y * W + x) * 4 + c] = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
      }
    }
  return out;
}
/** One photograph rectified by the homography of its page corners; off-frame paper is white. */
function rectifyPartial(frame, corners, width, h) {
  const H = squareToQuad(corners);
  const data = new Uint8ClampedArray(width * h * 4);
  const lum = (x, y) => {
    const i = (y * frame.width + x) * 4;
    return frame.data[i] * 0.299 + frame.data[i + 1] * 0.587 + frame.data[i + 2] * 0.114;
  };
  let inside = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < width; x++) {
      const p = project(H, x / (width - 1), y / (h - 1));
      let v = 255;
      if (p.x >= 0 && p.y >= 0 && p.x < frame.width - 1 && p.y < frame.height - 1) {
        const ix = p.x | 0, iy = p.y | 0, tx = p.x - ix, ty = p.y - iy;
        v = (lum(ix, iy) * (1 - tx) + lum(ix + 1, iy) * tx) * (1 - ty) + (lum(ix, iy + 1) * (1 - tx) + lum(ix + 1, iy + 1) * tx) * ty;
        inside++;
      }
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { frame: { width, height: h, data }, contributions: { reference: width * h, views: [], darkSamples: [], coverage: inside / (width * h) } };
}
const bilinear = (img, width, h, x, y) => {
  x = Math.max(0, Math.min(width - 1.001, x));
  y = Math.max(0, Math.min(h - 1.001, y));
  const ix = x | 0, iy = y | 0, tx = x - ix, ty = y - iy, i = iy * width + ix;
  return (img[i] * (1 - tx) + img[i + 1] * tx) * (1 - ty) + (img[i + width] * (1 - tx) + img[i + width + 1] * tx) * ty;
};

/** Plans the five views of one page: cameras, glare, shadow and blur per view. */
export function planViews(seed, sev) {
  const random = rng(seed);
  const d0 = (FRAME.focal * PAGE_MM.height) / (0.8 * FRAME.height);
  const views = [];
  for (let i = 0; i < 5; i++) {
    const target = i === 0 ? [PAGE_MM.width / 2, PAGE_MM.height / 2] : [TARGETS[i - 1][0] * PAGE_MM.width, TARGETS[i - 1][1] * PAGE_MM.height];
    const camera = makeCamera({
      target,
      distance: i === 0 ? d0 : d0 / random.range(...sev.zoom),
      tilt: i === 0 ? sev.refTilt : random.range(...sev.viewTilt),
      azimuth: random.range(0, 360),
      roll: random.range(-sev.roll, sev.roll),
    });
    views.push({
      index: i,
      target,
      camera,
      gain: i === 0 ? 1 : 1 + random.range(-sev.exposure, sev.exposure),
      gradient: [random.gauss() * sev.gradient, random.gauss() * sev.gradient],
      motion: i === 2 ? { length: sev.motionPx, angle: random.range(0, Math.PI) } : null,
      // The hand's shadow reaches in from the bottom of the frame, over the page's middle third.
      shadow: i === 1 ? { cx: FRAME.width * random.range(0.45, 0.65), cy: FRAME.height * random.range(0.98, 1.05), rx: FRAME.width * 0.5, ry: FRAME.height * 0.35, soft: 140, strength: sev.shadow } : null,
      focus: sev.psfBase + (i === 4 ? sev.focusMiss : 0),
      glare: project(camera.plane, camera.C[0], camera.C[1]),
      seed: `${seed}:${i}`,
    });
  }
  return views;
}

/** One photograph as linear RGB floats in 0..255 (before clipping and JPEG). */
export function photograph(texture, view, sev) {
  const { width: W, height: H } = FRAME;
  const { R, C, f, cx, cy } = view.camera;
  const random = rng(view.seed);
  const tw = texture.width, th = texture.height, tex = texture.data;
  const sharp = new Float32Array(W * H);
  const glare = new Float32Array(W * H);
  const rmax = Math.hypot(cx, cy);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dc = [(x - cx) / f, (y - cy) / f, 1];
      const dw = [R[0] * dc[0] + R[3] * dc[1] + R[6] * dc[2], R[1] * dc[0] + R[4] * dc[1] + R[7] * dc[2], R[2] * dc[0] + R[5] * dc[1] + R[8] * dc[2]];
      let h = 0, u = 0, v = 0;
      for (let k = 0; k < 4; k++) {
        const s = (-h - C[2]) / dw[2];
        u = C[0] + s * dw[0];
        v = C[1] + s * dw[1];
        h = u >= 0 && u <= PAGE_MM.width ? height(u, v, sev.curvatureMm) : 0;
      }
      const onPage = u >= 0 && v >= 0 && u <= PAGE_MM.width && v <= PAGE_MM.height;
      const reflectance = onPage
        ? 0.07 + (0.81 * bilinear(tex, tw, th, u * TEXTURE_SCALE, v * TEXTURE_SCALE)) / 255
        : 0.2 + 0.035 * Math.sin(u * 0.9 + 3 * Math.sin(v * 0.05)) + 0.02 * Math.sin(v * 0.31 + u * 0.02);
      const nx = (x - cx) / W, ny = (y - cy) / H, rr = ((x - cx) ** 2 + (y - cy) ** 2) / (rmax * rmax);
      let light = sev.light * view.gain * (1 + view.gradient[0] * nx * 2 + view.gradient[1] * ny * 2) * (1 - sev.vignette * rr);
      if (view.shadow) {
        const s = view.shadow;
        const e = Math.hypot((x - s.cx) / s.rx, (y - s.cy) / s.ry);
        const edge = Math.max(0, Math.min(1, (1 - e) * Math.min(s.rx, s.ry) / s.soft + 0.5));
        light *= 1 - s.strength * edge * edge * (3 - 2 * edge);
      }
      sharp[y * W + x] = light * reflectance;
      if (onPage) {
        const g2 = (x - view.glare.x) ** 2 + (y - view.glare.y) ** 2;
        glare[y * W + x] = view.gain * (sev.glarePeak * Math.exp(-g2 / (2 * sev.glareSigma ** 2)) + sev.haloPeak * Math.exp(-g2 / (2 * sev.haloSigma ** 2)));
      }
    }
  for (let i = 0; i < sharp.length; i++) sharp[i] += glare[i];
  // Defocus: blur levels blended per pixel by the local sigma.
  const levels = [0.5, 1, 1.5, 2.2, 3, 4, 5];
  const maxSigma = view.focus + sev.psfEdge;
  const used = levels.filter((s, i) => i === 0 || levels[i - 1] < maxSigma);
  const blurred = [];
  let previous = sharp, prevSigma = 0;
  for (const s of used) {
    previous = gaussianBlur(previous, W, H, Math.sqrt(s * s - prevSigma * prevSigma));
    prevSigma = s;
    blurred.push(previous);
  }
  let image = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const rr = ((x - cx) ** 2 + (y - cy) ** 2) / (rmax * rmax);
      const sigma = Math.max(used[0], Math.min(used.at(-1), view.focus + sev.psfEdge * rr));
      let k = 0;
      while (k < used.length - 2 && used[k + 1] < sigma) k++;
      const t = used.length === 1 ? 0 : Math.max(0, Math.min(1, (sigma - used[k]) / (used[k + 1] - used[k])));
      const i = y * W + x;
      image[i] = used.length === 1 ? blurred[0][i] : blurred[k][i] * (1 - t) + blurred[k + 1][i] * t;
    }
  if (view.motion) {
    const { length, angle } = view.motion, n = Math.max(2, Math.round(length) + 1);
    const out = new Float32Array(W * H), dx = Math.cos(angle), dy = Math.sin(angle);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let k = 0; k < n; k++) {
          const s = (k / (n - 1) - 0.5) * length;
          acc += bilinear(image, W, H, x + dx * s, y + dy * s);
        }
        out[y * W + x] = acc / n;
      }
    image = out;
  }
  // Sensor: signal-dependent noise, clipping, a warm cast, 8 bits.
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = image[i], sigma = Math.sqrt(sev.noise ** 2 + (sev.noise ** 2 * Math.max(0, v)) / 200);
    const lum = v + sigma * random.gauss();
    rgba[i * 4] = Math.min(255, lum * 1.03) + random.gauss() * 0.8;
    rgba[i * 4 + 1] = lum + random.gauss() * 0.8;
    rgba[i * 4 + 2] = lum * 0.92 + random.gauss() * 0.8;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

// ---------------------------------------------------------------- Chromium: raster and JPEG coding
class Codec {
  async start() {
    const appRequire = createRequire(join(REPO, 'apps/web/package.json'));
    const playwright = await import(pathToFileURL(appRequire.resolve('@playwright/test')).href);
    const { chromium } = playwright.default ?? playwright;
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
    await this.page.setContent('<html><body></body></html>');
    await this.page.evaluate(() => {
      window.fromB64 = (s) => {
        const bin = atob(s), out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      };
      window.toB64 = (bytes) => {
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
      };
      window.canvasOf = (rgb, w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(w, h);
        for (let i = 0, j = 0; i < w * h; i++, j += 3) {
          img.data[i * 4] = rgb[j];
          img.data[i * 4 + 1] = rgb[j + 1];
          img.data[i * 4 + 2] = rgb[j + 2];
          img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return c;
      };
      window.blobOf = (canvas, type, quality) => new Promise((done) => canvas.toBlob(done, type, quality));
      window.rgbOf = async (blob) => {
        const bitmap = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bitmap.width;
        c.height = bitmap.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const rgb = new Uint8Array(c.width * c.height * 3);
        for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
          rgb[j] = d[i];
          rgb[j + 1] = d[i + 1];
          rgb[j + 2] = d[i + 2];
        }
        return { width: c.width, height: c.height, rgb: toB64(rgb) };
      };
    });
  }
  async close() {
    await this.browser?.close();
  }
  static rgb(rgba) {
    const rgb = new Uint8Array((rgba.length / 4) * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }
    return Buffer.from(rgb.buffer).toString('base64');
  }
  static rgba(b64, width, h) {
    const rgb = Buffer.from(b64, 'base64'), out = new Uint8ClampedArray(width * h * 4);
    for (let i = 0, j = 0; i < out.length; i += 4, j += 3) {
      out[i] = rgb[j];
      out[i + 1] = rgb[j + 1];
      out[i + 2] = rgb[j + 2];
      out[i + 3] = 255;
    }
    return out;
  }
  /** Encodes RGBA as the browser's JPEG at `quality`. */
  async jpeg(rgba, width, h, quality) {
    const b64 = await this.page.evaluate(
      async ({ rgb, width, h, quality }) => {
        const blob = await blobOf(canvasOf(fromB64(rgb), width, h), 'image/jpeg', quality);
        return toB64(new Uint8Array(await blob.arrayBuffer()));
      },
      { rgb: Codec.rgb(rgba), width, h, quality },
    );
    return Buffer.from(b64, 'base64');
  }
  async decode(bytes, type = 'image/jpeg') {
    const r = await this.page.evaluate(
      async ({ b64, type }) => rgbOf(new Blob([fromB64(b64)], { type })),
      { b64: bytes.toString('base64'), type },
    );
    return { width: r.width, height: r.height, data: Codec.rgba(r.rgb, r.width, r.height) };
  }
  /** An SVG page rasterised on white, as grey levels. */
  async rasterSvg(svg, width, h) {
    const b64 = await this.page.evaluate(
      async ({ svg, width, h }) => {
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = width;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, h);
        ctx.drawImage(image, 0, 0, width, h);
        const d = ctx.getImageData(0, 0, width, h).data, g = new Uint8Array(width * h);
        for (let i = 0; i < g.length; i++) g[i] = Math.round(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
        return toB64(g);
      },
      { svg, width, h },
    );
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  /** A labelled grid of crops: rows of {label, cells: [{file, box: [x0,y0,x1,y1] as page fractions, title}]}. */
  async crops(rows, cell = 420) {
    const payload = rows.map((row) => ({
      label: row.label,
      cells: row.cells.map((c) => ({ title: c.title, box: c.box, b64: readFileSync(c.file).toString('base64'), type: c.file.endsWith('.png') ? 'image/png' : 'image/jpeg' })),
    }));
    const b64 = await this.page.evaluate(
      async ({ payload, cell }) => {
        const cols = Math.max(...payload.map((r) => r.cells.length));
        const c = document.createElement('canvas');
        c.width = cols * (cell + 8) + 8;
        c.height = payload.length * (cell + 40) + 8;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#000';
        ctx.font = '16px sans-serif';
        for (const [r, row] of payload.entries())
          for (const [i, cellData] of row.cells.entries()) {
            const bitmap = await createImageBitmap(new Blob([fromB64(cellData.b64)], { type: cellData.type }));
            const [x0, y0, x1, y1] = cellData.box;
            const sx = x0 * bitmap.width, sy = y0 * bitmap.height, sw = (x1 - x0) * bitmap.width, sh = (y1 - y0) * bitmap.height;
            const scale = Math.min(cell / sw, cell / sh);
            const ox = 8 + i * (cell + 8), oy = 8 + r * (cell + 40) + 24;
            ctx.fillText(`${row.label}: ${cellData.title}`, ox, oy - 6);
            ctx.drawImage(bitmap, sx, sy, sw, sh, ox, oy, sw * scale, sh * scale);
          }
        const blob = await blobOf(c, 'image/png');
        return toB64(new Uint8Array(await blob.arrayBuffer()));
      },
      { payload, cell },
    );
    return Buffer.from(b64, 'base64');
  }
}

// ---------------------------------------------------------------- the camera code, transpiled
async function transpile(source, rewrite) {
  const tsModule = await import(pathToFileURL(join(REPO, 'node_modules/typescript/lib/typescript.js')).href);
  const ts = tsModule.default ?? tsModule;
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [from, to] of Object.entries(rewrite)) js = js.split(`from '${from}'`).join(`from '${to}'`);
  return js;
}
const gitShow = (path, commit = OLD_COMMIT) => {
  const r = spawnSync('git', ['show', `${commit}:${path}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`git show ${commit}:${path} failed: ${r.stderr}`);
  return r.stdout;
};
const MEMO = `import * as real from './localRegistration.js';
export const mapLocalPoint = real.mapLocalPoint;
const cache = new WeakMap();
export const stats = { calls: 0, hits: 0, ms: 0 };
/** Shares one registration per (reference, view, matrix, corners) between the variants. */
export async function alignLocalView(reference, current, matrix, corners, signal) {
  stats.calls++;
  let byCurrent = cache.get(reference);
  if (!byCurrent) cache.set(reference, (byCurrent = new WeakMap()));
  let byKey = byCurrent.get(current);
  if (!byKey) byCurrent.set(current, (byKey = new Map()));
  const key = JSON.stringify([matrix, corners]);
  if (byKey.has(key)) { stats.hits++; return byKey.get(key); }
  const started = performance.now();
  const result = await real.alignLocalView(reference, current, matrix, corners, signal);
  stats.ms += performance.now() - started;
  byKey.set(key, result);
  return result;
}
`;
/** Builds new, old and softmin reconstructions; registration modules are shared when identical. */
export async function buildCamera(newRef = null) {
  const shared = ['localRegistration', 'pageGeometry', 'staffGeometry'];
  const sources = {
    // The new camera code: the working tree, or a commit (--new-ref) to measure a past version.
    new: Object.fromEntries([...shared, 'reconstruction', 'fusion'].map((n) => [n, newRef ? gitShow(`apps/web/src/scan/camera/${n}.ts`, newRef) : readFileSync(join(CAMERA, `${n}.ts`), 'utf8')])),
    old: Object.fromEntries([...shared, 'reconstruction'].map((n) => [n, gitShow(`apps/web/src/scan/camera/${n}.ts`)])),
  };
  const softminFile = join(HERE, 'camera-fusion-softmin.mjs');
  const built = {};
  for (const variant of ['new', 'old']) {
    const src = sources[variant];
    const sharedKey = sha(...shared.map((n) => src[n])).slice(0, 12);
    const sharedDir = join(OUT, 'build', `shared-${sharedKey}`);
    mkdirSync(sharedDir, { recursive: true });
    for (const n of shared) writeFileSync(join(sharedDir, `${n}.js`), await transpile(src[n], { './vision': './vision.js' }));
    writeFileSync(join(sharedDir, 'memo.js'), MEMO);
    const rewrite = {
      './localRegistration.js': `../shared-${sharedKey}/memo.js`,
      './pageGeometry.js': `../shared-${sharedKey}/pageGeometry.js`,
      './staffGeometry.js': `../shared-${sharedKey}/staffGeometry.js`,
    };
    const dir = join(OUT, 'build', variant);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'reconstruction.js'), await transpile(src.reconstruction, rewrite));
    if (variant === 'new') {
      writeFileSync(join(dir, 'fusion.js'), await transpile(src.fusion, {}));
      const soft = join(OUT, 'build', 'softmin');
      mkdirSync(soft, { recursive: true });
      writeFileSync(join(soft, 'reconstruction.js'), await transpile(src.reconstruction, { ...rewrite, './fusion.js': pathToFileURL(softminFile).href }));
    }
    built[variant] = { sharedKey, hash: sha(...Object.values(src)).slice(0, 16) };
  }
  built.softmin = { sharedKey: built.new.sharedKey, hash: sha(built.new.hash, readFileSync(softminFile)).slice(0, 16) };
  built.sharedRegistration = built.new.sharedKey === built.old.sharedKey;
  built.newSource = newRef ? `git:${newRef}` : 'working tree';
  const load = async (variant) => import(pathToFileURL(join(OUT, 'build', variant, 'reconstruction.js')).href + `?v=${built[variant].hash}`);
  const memoOf = async (key) => import(pathToFileURL(join(OUT, 'build', `shared-${key}`, 'memo.js')).href);
  return {
    built,
    reconstruct: { new: (await load('new')).reconstructPage, old: (await load('old')).reconstructPage, softmin: (await load('softmin')).reconstructPage },
    softmin: await import(pathToFileURL(softminFile).href),
    memo: await memoOf(built.new.sharedKey),
  };
}

// ---------------------------------------------------------------- fixtures and captures
async function fixtures(pieces) {
  const wanted = [...pieces, INVENTION];
  const dir = join(OUT, `fixtures-${sha(...wanted).slice(0, 10)}`);
  if (existsSync(join(dir, 'manifest.json'))) {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const have = new Set(m.pieces.map((p) => p.id));
    if (wanted.every((s) => have.has(s))) return { dir, manifest: m };
    throw new Error(`${dir} lacks some pieces; remove it to re-render`);
  }
  const { prepareFixtures } = await import(pathToFileURL(join(HERE, 'prepare.mjs')).href);
  return { dir, manifest: await prepareFixtures({ out: dir, slugs: wanted }) };
}

async function texture(codec, dir, piece) {
  const file = join(OUT, 'textures', `${piece.id}.gray`);
  const width = PAGE_MM.width * TEXTURE_SCALE, h = PAGE_MM.height * TEXTURE_SCALE;
  let raw;
  if (existsSync(file)) raw = new Uint8Array(readFileSync(file));
  else {
    raw = await codec.rasterSvg(readFileSync(join(dir, piece.pages[0].svg), 'utf8'), width, h);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, raw);
  }
  // Light antialiasing for the ~1.7x minification into the frame.
  return { width, height: h, data: gaussianBlur(Float32Array.from(raw), width, h, 0.7) };
}

/** The five captures of one page at one severity, cached as JPEGs plus their geometry. */
async function captures(codec, fx, piece, severity) {
  const sev = SEVERITIES[severity];
  const dir = join(OUT, 'captures', severity, piece.id);
  const metaFile = join(dir, 'meta.json');
  // Any change to the camera model's code or parameters makes new captures.
  const key = sha(VERSION, JSON.stringify(sev), JSON.stringify(FRAME), piece.sha256, planViews.toString(), photograph.toString(), height.toString(), ...(sev.localShift ? [shiftLocally.toString()] : [])).slice(0, 16);
  let meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : null;
  const started = performance.now();
  if (meta?.key !== key) {
    mkdirSync(dir, { recursive: true });
    const tex = await texture(codec, fx.dir, piece);
    const views = planViews(`${VERSION}:${piece.id}:${sev.seedAs ?? severity}`, sev);
    const random = rng(`${VERSION}:${piece.id}:${sev.seedAs ?? severity}:jitter`);
    const pageCorners = [[0, 0], [PAGE_MM.width, 0], [PAGE_MM.width, PAGE_MM.height], [0, PAGE_MM.height]];
    const refPlane = views[0].camera.plane;
    const trueRef = pageCorners.map(([u, v]) => project(refPlane, u, v));
    const jitter = (p, s) => ({ x: p.x + random.range(-s, s), y: p.y + random.range(-s, s) });
    const out = [];
    for (const view of views) {
      let rgba = photograph(tex, view, sev);
      if (sev.localShift?.view === view.index) rgba = shiftLocally(rgba, localShiftAt(view, sev.localShift));
      const bytes = await codec.jpeg(rgba, FRAME.width, FRAME.height, sev.jpeg);
      writeFileSync(join(dir, `view${view.index}.jpg`), bytes);
      const plane = view.camera.plane;
      const trueView = pageCorners.map(([u, v]) => project(plane, u, v));
      const matrix = view.index === 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : fourPoint(trueRef, trueView.map((p) => ({ x: p.x + random.gauss() * sev.matrixJitter, y: p.y + random.gauss() * sev.matrixJitter })));
      const toPage = inv3(plane);
      const shadowPage = view.shadow ? project(toPage, view.shadow.cx, view.shadow.cy - view.shadow.ry * 0.7) : null;
      const glarePage = project(toPage, view.glare.x, view.glare.y);
      out.push({
        index: view.index,
        file: `view${view.index}.jpg`,
        matrix,
        trueMatrix: view.index === 0 ? matrix : mul3(plane, inv3(refPlane)).map((v, _, a) => v / a[8]),
        corners: trueView.map((p) => jitter(p, sev.cornerJitter)),
        glarePage: { u: glarePage.x / PAGE_MM.width, v: glarePage.y / PAGE_MM.height },
        shadowPage: shadowPage && { u: shadowPage.x / PAGE_MM.width, v: shadowPage.y / PAGE_MM.height },
        motion: view.motion,
        focus: view.focus,
        gain: view.gain,
      });
    }
    meta = { key, severity, piece: piece.id, frame: FRAME, views: out, seconds: (performance.now() - started) / 1000 };
    writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  }
  const frames = [];
  for (const v of meta.views) frames.push(await codec.decode(readFileSync(join(dir, v.file))));
  return { dir, meta, frames };
}

// ---------------------------------------------------------------- conditions
export const CONDITIONS = ['clean', 'reference', 'view1', 'view2', 'view3', 'view4', 'old', ...SOFTNESS.map((t) => `softmin-${t}`), 'new'];

/**
 * Every condition's page, each cached under its own stamp (the captures' key and the code that
 * makes that condition), so a change to the new fusion rebuilds only the conditions it reaches.
 */
async function pages(codec, cam, fx, piece, severity, cap) {
  const dir = join(OUT, 'pages', severity, piece.id);
  mkdirSync(dir, { recursive: true });
  const stampFile = join(dir, 'stamp.json');
  const partial = sha(rectifyPartial.toString()).slice(0, 16);
  const want = {
    new: cam.built.new.hash,
    old: cam.built.old.hash,
    ...Object.fromEntries(SOFTNESS.map((t) => [`softmin-${t}`, `${cam.built.softmin.hash}:${t}`])),
    reference: cam.built.new.hash,
    ...Object.fromEntries([1, 2, 3, 4].map((i) => [`view${i}`, `${cam.built.new.hash}:${partial}`])),
  };
  for (const c of Object.keys(want)) want[c] = sha(cap.meta.key, want[c]).slice(0, 16);
  // Pages are named by their stamp, so versions of the code (e.g. before and after a fusion fix)
  // keep their pages side by side and switching back recognises nothing again.
  const files = Object.fromEntries(Object.keys(want).map((c) => [c, join(dir, `${c}-${want[c]}.jpg`)]));
  files.clean = join(fx.dir, piece.pages[0].images.clean);
  const previous = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : null;
  const record = previous?.entries ? previous : { entries: {} };
  const { newSource, ...builtBefore } = cam.built;
  if (previous?.stamp && previous.stamp === sha(cap.meta.key, JSON.stringify(builtBefore)).slice(0, 16)) {
    // Pages from the first layout (one file per condition), made by this very code.
    for (const c of Object.keys(want))
      if (existsSync(join(dir, `${c}.jpg`))) {
        renameSync(join(dir, `${c}.jpg`), files[c]);
        record.entries[`${c}:${want[c]}`] = { timing: previous.timings[c], contributions: previous.contributions[c], ...(c === 'new' && { registration: previous.timings.registration }) };
      }
  }
  const collect = () => {
    const timings = {}, contributions = {};
    for (const c of Object.keys(want)) {
      const e = record.entries[`${c}:${want[c]}`] ?? {};
      timings[c] = e.timing;
      contributions[c] = e.contributions;
      if (c === 'new' && e.registration) timings.registration = e.registration;
    }
    return { files, timings, contributions };
  };
  const stale = Object.keys(want).filter((c) => !existsSync(files[c]) || !record.entries[`${c}:${want[c]}`]);
  if (!stale.length) return collect();
  const frames = cap.frames, views = cap.meta.views;
  const corners0 = views[0].corners;
  const all = frames.map((frame, i) => ({ frame, matrix: views[i].matrix }));
  const run = async (name, fn) => {
    if (!stale.includes(name)) return;
    const memoBefore = cam.memo.stats.ms;
    const started = performance.now();
    const result = await fn();
    // Registration is shared by every fused variant: timed apart (in whichever ran it first).
    const registration = Math.round(cam.memo.stats.ms - memoBefore);
    const entry = { timing: Math.round(performance.now() - started) - registration, contributions: result.contributions, size: { width: result.frame.width, height: result.frame.height }, ...(registration > 0 && { registration }) };
    writeFileSync(files[name], await codec.jpeg(result.frame.data, result.frame.width, result.frame.height, 0.94));
    record.entries[`${name}:${want[name]}`] = entry;
    log(`  ${severity} ${piece.id} ${name}: ${result.frame.width}x${result.frame.height} in ${entry.timing} ms` + (registration > 0 ? ` (+ registration ${registration} ms)` : '') + (result.contributions.views.length ? `, view contributions ${result.contributions.views.map((v) => ((100 * v) / result.contributions.reference).toFixed(0) + '%').join(' ')}` : ''));
  };
  await run('new', () => cam.reconstruct.new(all, corners0));
  await run('old', () => cam.reconstruct.old(all, corners0));
  for (const t of SOFTNESS) {
    cam.softmin.setSoftness(t);
    await run(`softmin-${t}`, () => cam.reconstruct.softmin(all, corners0));
  }
  await run('reference', () => cam.reconstruct.new([{ frame: frames[0], matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] }], corners0));
  // A view centred on a quadrant does not hold the whole page, and reconstructPage refuses its
  // corners ('Invalid page corners'). As a single photograph it is rectified here by its page
  // homography alone (no staff flattening) onto the reference page's grid, the part outside the
  // frame left white: what that one photograph can give.
  const size = record.entries[`reference:${want.reference}`]?.size ?? (await codec.decode(readFileSync(files.reference)));
  for (let i = 1; i < 5; i++) await run(`view${i}`, async () => rectifyPartial(frames[i], views[i].corners, size.width, size.height));
  writeFileSync(stampFile, JSON.stringify(record, null, 1));
  return collect();
}

// ---------------------------------------------------------------- registration against the truth
const pixel = (camera, P) => {
  const { R, C, f, cx, cy } = camera;
  const d = [P[0] - C[0], P[1] - C[1], P[2] - C[2]];
  const X = [0, 1, 2].map((i) => R[i * 3] * d[0] + R[i * 3 + 1] * d[1] + R[i * 3 + 2] * d[2]);
  return { x: (f * X[0]) / X[2] + cx, y: (f * X[1]) / X[2] + cy };
};
/** The page point (mm, with the sheet's height) that a camera sees at frame pixel (x, y). */
function pageAt(camera, x, y, amplitude) {
  const { R, C, f, cx, cy } = camera;
  const dc = [(x - cx) / f, (y - cy) / f, 1];
  const dw = [0, 1, 2].map((j) => R[j] * dc[0] + R[3 + j] * dc[1] + R[6 + j] * dc[2]);
  let h = 0, u = 0, v = 0;
  for (let k = 0; k < 4; k++) {
    const s = (-h - C[2]) / dw[2];
    u = C[0] + s * dw[0];
    v = C[1] + s * dw[1];
    h = u >= 0 && u <= PAGE_MM.width ? height(u, v, amplitude) : 0;
  }
  return [u, v, -h];
}
const stats = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: q(0.5), p90: q(0.9), p99: q(0.99), max: s.at(-1), over2px: a.filter((e) => e > 2).length / a.length, over4px: a.filter((e) => e > 4).length / a.length };
};
function insidePolygon(region, x, y) {
  let result = false;
  for (let i = 0, j = region.length - 1; i < region.length; j = i++) {
    const a = region[i], b = region[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
/** A copy of reconstruction.ts's private mapView (new fusion): mapLocalPoint, extended over
 * supported cells beyond the anchors' reach at a falling confidence. Kept in step by hand. */
function mapViewCopy(mapLocalPoint, alignment, p) {
  const mapped = mapLocalPoint(alignment, p);
  if (mapped) return mapped.confidence < 0.35 ? null : { ...mapped, extended: false };
  const { width, height: h, cols, rows } = alignment;
  if (!(p.x >= 0 && p.y >= 0 && p.x < width && p.y < h) || !insidePolygon(alignment.region, p.x, p.y)) return null;
  const gx = Math.max(0, Math.min(cols - 1.001, (p.x / width) * (cols - 1))), gy = Math.max(0, Math.min(rows - 1.001, (p.y / h) * (rows - 1)));
  const ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy, cell = iy * (cols - 1) + ix;
  if (!alignment.supported[cell]) return null;
  const radius = Math.min(width / (cols - 1), h / (rows - 1)) * 0.72;
  let nearest = Infinity, confidence = 0;
  for (const index of alignment.cellAnchors[cell]) {
    const a = alignment.anchors[index], d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < nearest) {
      nearest = d;
      confidence = a.confidence;
    }
  }
  confidence *= 0.7 * Math.min(1, radius / nearest);
  if (!(confidence >= 0.35)) return null;
  const at = (grid) => {
    const i = iy * cols + ix;
    return (grid[i] * (1 - tx) + grid[i + 1] * tx) * (1 - ty) + (grid[i + cols] * (1 - tx) + grid[i + cols + 1] * tx) * ty;
  };
  const point = project(alignment.matrix, p.x + at(alignment.displacementX), p.y + at(alignment.displacementY));
  if (!(point.x >= 1 && point.y >= 1) || point.x >= alignment.currentWidth - 2 || point.y >= alignment.currentHeight - 2) return null;
  return { point, confidence, extended: true };
}
/**
 * The camera's view registration (alignLocalView, mapLocalPoint) checked against the exact
 * mapping the camera model knows: for a grid of page points (with the sheet's curvature) the true
 * pixel in the reference and in each view. Reports the error of the tracker's matrix alone and of
 * the local registration at the confidences the new (>= 0.35) and old (>= 0.65) fusions admit.
 */
async function registrationCheck(cam, piece, severity, cap) {
  const sev = SEVERITIES[severity];
  const views = planViews(`${VERSION}:${piece.id}:${sev.seedAs ?? severity}`, sev);
  const out = [];
  const shift = sev.localShift, shiftAt = shift && localShiftAt(views[shift.view], shift);
  for (let i = 1; i < 5; i++) {
    const alignment = await cam.memo.alignLocalView(cap.frames[0], cap.frames[i], cap.meta.views[i].matrix, cap.meta.views[0].corners);
    const matrixErr = [], new35 = [], old65 = [], extended = [], worst = [];
    let inFrame = 0, mapped = 0;
    for (let gv = 0.01; gv < 1; gv += 0.02)
      for (let gu = 0.01; gu < 1; gu += 0.02) {
        const u = gu * PAGE_MM.width, v = gv * PAGE_MM.height, P = [u, v, -height(u, v, sev.curvatureMm)];
        const pr = pixel(views[0].camera, P), pv = pixel(views[i].camera, P);
        if (shift?.view === i) {
          const b = bump(shiftAt, pv.x, pv.y);
          pv.x += shiftAt.dx * b;
          pv.y += shiftAt.dy * b;
        }
        if (!(pv.x >= 2 && pv.y >= 2 && pv.x < FRAME.width - 3 && pv.y < FRAME.height - 3)) continue;
        inFrame++;
        const m0 = project(cap.meta.views[i].matrix, pr.x, pr.y);
        matrixErr.push(Math.hypot(m0.x - pv.x, m0.y - pv.y));
        const mv = mapViewCopy(cam.memo.mapLocalPoint, alignment, pr);
        if (mv?.extended) extended.push(Math.hypot(mv.point.x - pv.x, mv.point.y - pv.y));
        if (mv) {
          const e = Math.hypot(mv.point.x - pv.x, mv.point.y - pv.y);
          if (e > 3) worst.push({ u: +gu.toFixed(2), v: +gv.toFixed(2), error: +e.toFixed(1), confidence: +mv.confidence.toFixed(2), extended: mv.extended });
        }
        const m = cam.memo.mapLocalPoint(alignment, pr);
        if (!m) continue;
        mapped++;
        const e = Math.hypot(m.point.x - pv.x, m.point.y - pv.y);
        if (m.confidence >= 0.35) new35.push(e);
        if (m.confidence >= 0.65) old65.push(e);
      }
    let shiftRegion = null;
    if (shift?.view === i) {
      // Dense check around the bump: reference pixels whose page point lands within 2.5 sigma of it.
      const errs = [];
      const c0 = project(views[0].camera.plane, shift.page[0] * PAGE_MM.width, shift.page[1] * PAGE_MM.height);
      for (let y = c0.y - 160; y <= c0.y + 160; y += 4)
        for (let x = c0.x - 160; x <= c0.x + 160; x += 4) {
          const P = pageAt(views[0].camera, x, y, sev.curvatureMm), pv = pixel(views[i].camera, P);
          const b = bump(shiftAt, pv.x, pv.y);
          if (b < 0.2) continue;
          pv.x += shiftAt.dx * b;
          pv.y += shiftAt.dy * b;
          const mv = mapViewCopy(cam.memo.mapLocalPoint, alignment, { x, y });
          if (mv) errs.push(Math.hypot(mv.point.x - pv.x, mv.point.y - pv.y));
        }
      shiftRegion = stats(errs);
    }
    out.push({ view: i, shiftRegion, inFrame, mapped, matrix: stats(matrixErr), local35: stats(new35), local65: stats(old65), extended: stats(extended), worst: worst.sort((a, b) => b.error - a.error).slice(0, 12), supportedCells: alignment.supported ? Array.from(alignment.supported).filter(Boolean).length / alignment.supported.length : null });
  }
  return out;
}

// ---------------------------------------------------------------- recognition and scoring
async function recognize(jobs, homr, parallel) {
  const pending = jobs.filter((j) => !existsSync(j.output) && !existsSync(j.output + '.failed.json'));
  log(`recognition: ${jobs.length} jobs, ${pending.length} to run on ${parallel} process(es)`);
  const seconds = {};
  const chunks = Array.from({ length: parallel }, (_, i) => pending.filter((_, k) => k % parallel === i)).filter((c) => c.length);
  await Promise.all(
    chunks.map(
      (chunk, i) =>
        new Promise((done, fail) => {
          const file = join(OUT, `jobs-${i}.json`);
          writeFileSync(file, JSON.stringify(chunk.map(({ id, input, output }) => ({ id, recognizer: 'homr', input, output })), null, 1));
          const child = spawn(process.env.DIGITUS2_OMR_PYTHON || 'python', ['-I', join(HERE, 'acceptance/recognize.py'), file, '--bundle', 'unused', '--text-models', 'unused', '--homr-toolchain', homr], { stdio: ['ignore', 'pipe', 'inherit'] });
          let buffer = '';
          child.stdout.on('data', (d) => {
            buffer += d;
            let n;
            while ((n = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, n).trim();
              buffer = buffer.slice(n + 1);
              try {
                const m = JSON.parse(line);
                if (m.id) seconds[m.id] = m.seconds;
              } catch {}
              if (line) log(`  [homr ${i}] ${line}`);
            }
          });
          child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`recognize.py exited with ${code}`))));
        }),
    ),
  );
  return seconds;
}

function score(E, refScore, file) {
  const empty = { ...refScore, notes: [], measures: [] };
  let status = 'missing', rec = empty, error = null;
  if (existsSync(file)) {
    try {
      rec = E.parseMusicXml(readFileSync(file, 'utf8'), { preserveNotation: true }).score;
      E.evaluateOmr(refScore, rec);
      status = 'parsed';
    } catch (cause) {
      status = 'invalid';
      error = cause.message;
      rec = empty;
    }
  } else if (existsSync(file + '.failed.json')) {
    status = 'failed';
    error = JSON.parse(readFileSync(file + '.failed.json', 'utf8')).message;
  }
  const ev = E.evaluateOmr(refScore, rec);
  const metrics = Object.fromEntries(['fullNote', 'pitch', 'onsetPitch'].map((k) => [k, { matched: ev.metrics[k].matched, reference: ev.metrics[k].reference, recognized: ev.metrics[k].recognized, f1: ev.metrics[k].f1 }]));
  // Bar-free companion: the longest common subsequence of the pitches in reading order (onset,
  // then pitch). evaluateOmr pairs bars by ordinal, so one lost or added barline zeroes every
  // later bar; this shows how many notes were still read right.
  const order = (sc) => [...sc.notes].sort((a, b) => a.onsetTick - b.onsetTick || a.midi - b.midi).map((n) => n.midi);
  const a = order(refScore), b = order(rec);
  let prev = new Uint16Array(b.length + 1), cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  const lcs = prev[b.length];
  metrics.pitchSequence = { matched: lcs, reference: a.length, recognized: b.length, f1: a.length + b.length ? (2 * lcs) / (a.length + b.length) : 1 };
  return { status, error, metrics, bars: { reference: ev.referenceBars, recognized: ev.recognizedBars, timingMismatches: ev.barTimingMismatches } };
}
/**
 * The reference cut to bars [from, to) (ordinal), for a page of a longer piece. The cut starts at
 * tick 0, as a recognised page does, because evaluateOmr compares the absolute start of each bar:
 * every tick (bars, notes, ornaments, signatures) moves back by the first kept bar's start, so each
 * bar keeps its length and its notes keep their onsets within the bar (issue 163).
 */
export function sliceScore(scoreObj, from, to) {
  const measures = scoreObj.measures.slice(from, to);
  const keep = new Set(measures.map((m) => m.index));
  const shift = measures[0]?.startTick ?? 0;
  const back = (tick) => Math.max(0, tick - shift);
  const note = (n) => ({
    ...n,
    onsetTick: n.onsetTick - shift,
    offsetTick: n.offsetTick - shift,
    ...(n.ornament && { ornament: { ...n.ornament, endTick: n.ornament.endTick - shift } }),
  });
  return {
    ...scoreObj,
    measures: measures.map((m) => ({ ...m, startTick: m.startTick - shift })),
    notes: scoreObj.notes.filter((n) => keep.has(n.measureIndex)).map(note),
    tempoMap: scoreObj.tempoMap?.map((e) => ({ ...e, tick: back(e.tick) })),
    timeSignatures: scoreObj.timeSignatures?.map((e) => ({ ...e, tick: back(e.tick) })),
    keySignatures: scoreObj.keySignatures?.map((e) => ({ ...e, tick: back(e.tick) })),
  };
}
const f1 = (t) => (t.reference + t.recognized ? (2 * t.matched) / (t.reference + t.recognized) : 1);
function micro(rows, metric) {
  const t = { matched: 0, reference: 0, recognized: 0 };
  for (const r of rows) for (const k of Object.keys(t)) t[k] += r.metrics[metric][k];
  return f1(t);
}

// ---------------------------------------------------------------- main
function parseArgs(args) {
  const o = { pieces: DEFAULT_PIECES, severities: Object.keys(SEVERITIES), parallel: 2, recognize: true, cropsOnly: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--pieces') o.pieces = args[++i].split(',');
    else if (a === '--severities') o.severities = args[++i].split(',');
    else if (a === '--parallel') o.parallel = Math.max(1, Number(args[++i]));
    else if (a === '--no-recognize') o.recognize = false;
    else if (a === '--crops-only') o.cropsOnly = true;
    else if (a === '--registration') o.registration = true;
    else if (a === '--new-ref') o.newRef = args[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  for (const s of o.severities) if (!SEVERITIES[s]) throw new Error(`unknown severity ${s}`);
  return o;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const homr = resolve(process.env.DIGITUS2_OMR_HOMR || 'C:/Users/maxim/omr/homr2');
  const pipeline = pipelineHash();
  const started = performance.now();
  mkdirSync(OUT, { recursive: true });
  const fx = await fixtures(opts.pieces);
  const byId = new Map(fx.manifest.pieces.map((p) => [p.id, p]));
  for (const id of opts.pieces) if (byId.get(id)?.pages.length !== 1) throw new Error(`${id}: one-page pieces only (page 1 is scored against the whole piece)`);
  const cam = await buildCamera(opts.newRef ?? null);
  log(`camera builds: ${JSON.stringify(cam.built)}`);
  const codec = new Codec();
  await codec.start();
  const units = [];
  const registration = {};
  try {
    for (const severity of opts.severities)
      for (const id of opts.pieces) {
        const piece = byId.get(id);
        const t0 = performance.now();
        const cap = await captures(codec, fx, piece, severity);
        const t1 = performance.now();
        log(`${severity} ${id}: captures ready (${((t1 - t0) / 1000).toFixed(1)} s${cap.meta.seconds ? `, synthesised in ${cap.meta.seconds.toFixed(1)} s` : ''})`);
        if (opts.registration) {
          const r = await registrationCheck(cam, piece, severity, cap);
          (registration[severity] ??= {})[id] = r;
          for (const v of r) log(`  registration ${severity} ${id} view${v.view}: matrix median ${v.matrix?.median.toFixed(2)} p90 ${v.matrix?.p90.toFixed(2)}; local(>=.35) n=${v.local35?.n} median ${v.local35?.median.toFixed(2)} p90 ${v.local35?.p90.toFixed(2)} max ${v.local35?.max.toFixed(1)} >4px ${(100 * (v.local35?.over4px ?? 0)).toFixed(1)}%; extended n=${v.extended?.n ?? 0} median ${v.extended?.median.toFixed(2)} max ${v.extended?.max.toFixed(1)}; worst ${JSON.stringify(v.worst.slice(0, 4))}` + (v.shiftRegion ? `; SHIFT REGION n=${v.shiftRegion.n} median ${v.shiftRegion.median.toFixed(2)} p90 ${v.shiftRegion.p90.toFixed(2)} max ${v.shiftRegion.max.toFixed(2)}` : ''));
          continue;
        }
        const pg = await pages(codec, cam, fx, piece, severity, cap);
        units.push({ severity, piece, cap, pg });
      }
    if (opts.registration) {
      writeFileSync(join(OUT, 'registration.json'), JSON.stringify(registration, null, 1));
      return 0;
    }
    // Side-by-side crops of the same page regions across conditions.
    const show = ['reference', 'old', `softmin-${SOFTNESS[0]}`, `softmin-${SOFTNESS[1]}`, 'new'];
    mkdirSync(join(OUT, 'crops'), { recursive: true });
    for (const u of units) {
      const box = (c, half = 0.09) => [Math.max(0, c.u - half), Math.max(0, c.v - half * 0.71), Math.min(1, c.u + half), Math.min(1, c.v + half * 0.71)];
      const regions = [
        ['reference glare', u.cap.meta.views[0].glarePage],
        ['view 2 glare', u.cap.meta.views[2].glarePage],
        ['view 1 shadow', u.cap.meta.views[1].shadowPage],
        ['upper staff', { u: 0.5, v: 0.2 }],
      ].filter(([, c]) => c && c.u > 0 && c.u < 1 && c.v > 0 && c.v < 1);
      const png = await codec.crops(regions.map(([label, c]) => ({ label, cells: show.map((name) => ({ title: name, file: u.pg.files[name], box: box(c) })) })));
      writeFileSync(join(OUT, 'crops', `${u.severity}-${u.piece.id}${opts.newRef ? `-new-${opts.newRef}` : ''}.png`), png);
    }
  } finally {
    await codec.close();
  }
  if (opts.cropsOnly || !opts.recognize) return 0;

  // Recognition.
  const cache = join(OUT, 'cache');
  mkdirSync(cache, { recursive: true });
  const keyOf = (input) => join(cache, `${sha(readFileSync(input), `homr:${pipeline}`).slice(0, 24)}.musicxml`);
  const jobs = [];
  for (const u of units) for (const c of CONDITIONS) jobs.push({ id: `${u.severity}:${u.piece.id}:${c}`, unit: u, condition: c, input: u.pg.files[c], output: keyOf(u.pg.files[c]) });
  const manifest = JSON.parse(readFileSync(join(HERE, 'photos/manifest.json'), 'utf8'));
  const photos = manifest.photos.filter((p) => p.id.startsWith('bach-invention13-'));
  const photoJobs = photos.map((p) => ({ id: `photoscan:${p.id}`, photo: p, input: join(HERE, 'photos', p.file), output: keyOf(join(HERE, 'photos', p.file)) }));
  // Clean pages are shared between severities: one job each.
  const unique = [...new Map([...jobs, ...photoJobs].map((j) => [j.output, j])).values()];
  const r0 = performance.now();
  const seconds = await recognize(unique, homr, opts.parallel);
  const recognitionSeconds = (performance.now() - r0) / 1000;

  const E = await import(pathToFileURL(join(REPO, 'packages/engine/dist/src/index.js')).href);
  const refs = new Map();
  const refOf = (piece) => {
    if (!refs.has(piece.id)) refs.set(piece.id, E.parseMusicXml(readFileSync(join(fx.dir, piece.reference), 'utf8'), { preserveNotation: true }).score);
    return refs.get(piece.id);
  };
  const rows = jobs.map((j) => ({ severity: j.unit.severity, piece: j.unit.piece.id, condition: j.condition, ...score(E, refOf(j.unit.piece), j.output), seconds: seconds[j.id] ?? null }));
  // Derived single-photo conditions: the best of the five by full-note F1 (an oracle) and their mean.
  const summary = {};
  for (const severity of opts.severities) {
    const sr = rows.filter((r) => r.severity === severity);
    const s = (summary[severity] = {});
    for (const c of CONDITIONS) {
      const cr = sr.filter((r) => r.condition === c);
      s[c] = { pages: cr.length, parsed: cr.filter((r) => r.status === 'parsed').length, fullNoteF1: micro(cr, 'fullNote'), pitchF1: micro(cr, 'pitch'), onsetPitchF1: micro(cr, 'onsetPitch'), pitchSequenceF1: micro(cr, 'pitchSequence'), barsExact: cr.filter((r) => r.bars.recognized === r.bars.reference).length, meanPageFullNoteF1: cr.reduce((a, r) => a + r.metrics.fullNote.f1, 0) / cr.length };
    }
    const singles = ['reference', 'view1', 'view2', 'view3', 'view4'];
    const best = opts.pieces.map((id) => singles.map((c) => sr.find((r) => r.piece === id && r.condition === c)).reduce((a, b) => (b.metrics.fullNote.f1 > a.metrics.fullNote.f1 ? b : a)));
    s['best-single (oracle)'] = { pages: best.length, picked: best.map((r) => `${r.piece}:${r.condition}`), fullNoteF1: micro(best, 'fullNote'), pitchF1: micro(best, 'pitch'), onsetPitchF1: micro(best, 'onsetPitch'), pitchSequenceF1: micro(best, 'pitchSequence'), barsExact: best.filter((r) => r.bars.recognized === r.bars.reference).length, meanPageFullNoteF1: best.reduce((a, r) => a + r.metrics.fullNote.f1, 0) / best.length };
    const allSingles = sr.filter((r) => singles.includes(r.condition));
    s['single-view mean'] = { pages: allSingles.length, fullNoteF1: micro(allSingles, 'fullNote'), pitchF1: micro(allSingles, 'pitch'), onsetPitchF1: micro(allSingles, 'onsetPitch'), pitchSequenceF1: micro(allSingles, 'pitchSequence'), barsExact: allSingles.filter((r) => r.bars.recognized === r.bars.reference).length, meanPageFullNoteF1: allSingles.reduce((a, r) => a + r.metrics.fullNote.f1, 0) / allSingles.length };
  }
  // Real PhotoScan pages of the invention, each against its own bars of the library piece.
  const inv = byId.get(INVENTION);
  const invRef = refOf(inv);
  const bars = photos.map((p) => p.bars);
  const total = bars.reduce((a, b) => a + b, 0);
  let from = 0;
  const photoRows = photos.map((p, i) => {
    const slice = sliceScore(invRef, from, from + bars[i]);
    const row = { id: p.id, barRange: [from + 1, from + bars[i]], ...score(E, slice, photoJobs[i].output), seconds: seconds[photoJobs[i].id] ?? null };
    from += bars[i];
    return row;
  });
  const photoscan = { referenceBars: invRef.measures.length, manifestBars: total, rows: photoRows, fullNoteF1: micro(photoRows, 'fullNote'), pitchF1: micro(photoRows, 'pitch'), onsetPitchF1: micro(photoRows, 'onsetPitch'), pitchSequenceF1: micro(photoRows, 'pitchSequence') };

  const timing = {};
  for (const u of units) {
    const t = u.pg.timings ?? {};
    for (const [k, v] of Object.entries(t)) ((timing[u.severity] ??= {})[k] ??= []).push(v);
    ((timing[u.severity] ??= {}).synthesisSeconds ??= []).push(u.cap.meta.seconds);
  }
  const card = {
    schemaVersion: 1,
    version: VERSION,
    generated: new Date().toISOString(),
    pipeline,
    homr,
    camera: cam.built,
    oldCommit: OLD_COMMIT,
    softness: SOFTNESS,
    severities: Object.fromEntries(opts.severities.map((s) => [s, SEVERITIES[s]])),
    frame: FRAME,
    pieces: opts.pieces,
    summary,
    rows,
    photoscan,
    contributions: Object.fromEntries(units.map((u) => [`${u.severity}:${u.piece.id}`, u.pg.contributions])),
    timing: { perPageMs: timing, recognitionSeconds, recognitionPerJob: seconds, totalSeconds: (performance.now() - started) / 1000 },
  };
  const cardFile = join(OUT, opts.newRef ? `latest-new-${opts.newRef}.json` : 'latest.json');
  writeFileSync(cardFile, JSON.stringify(card, null, 2));

  const pct = (x) => (100 * x).toFixed(1).padStart(6);
  for (const severity of opts.severities) {
    console.log(`\n${severity}: condition              fullNote  pitch  onset+pitch  mean-page  pitch-seq  bars-exact`);
    for (const [c, s] of Object.entries(summary[severity])) console.log(`  ${c.padEnd(26)} ${pct(s.fullNoteF1)} ${pct(s.pitchF1)} ${pct(s.onsetPitchF1)}      ${pct(s.meanPageFullNoteF1)}     ${pct(s.pitchSequenceF1)}  ${s.barsExact}/${s.pages}`);
    console.log('  per piece (fullNote F1): ' + CONDITIONS.join(' '));
    for (const id of opts.pieces) console.log(`  ${id.padEnd(40)} ${CONDITIONS.map((c) => pct(rows.find((r) => r.severity === severity && r.piece === id && r.condition === c).metrics.fullNote.f1)).join(' ')}`);
  }
  console.log(`\nReal PhotoScan, ${INVENTION} (${photoscan.referenceBars} bars in the library, ${total} in the manifest):`);
  for (const r of photoRows) console.log(`  ${r.id.padEnd(36)} bars ${r.barRange.join('-').padEnd(6)} ${r.status.padEnd(7)} fullNote ${pct(r.metrics.fullNote.f1)} pitch ${pct(r.metrics.pitch.f1)} pitch-seq ${pct(r.metrics.pitchSequence.f1)}`);
  console.log(`  all three: fullNote ${pct(photoscan.fullNoteF1)} pitch ${pct(photoscan.pitchF1)}`);
  console.log(`\nScorecard: ${cardFile} (${card.timing.totalSeconds.toFixed(0)} s)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(error.stack ?? error.message);
      process.exitCode = 2;
    },
  );
