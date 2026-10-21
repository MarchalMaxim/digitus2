/** Private-photo acceptance: node scripts/check-score-camera-photos.mjs MANIFEST [OUT].
 * Manifest and generated pixels belong under ignored build/. Never commit photographs.
 * All coordinates are in decoded input pixels; staff anchors select a TOP staff line.
 * This is a geometry/ink-retention probe, not an optical music recognition score.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from '../node_modules/typescript/lib/typescript.js';
import { chromium } from '../apps/web/node_modules/@playwright/test/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const quantile = (a, q) =>
  [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))];
const gray = (f, x, y) => {
  const i = (Math.round(y) * f.width + Math.round(x)) * 4;
  return f.data[i] * 0.299 + f.data[i + 1] * 0.587 + f.data[i + 2] * 0.114;
};
const interp = (points, x) => {
  let i = 0;
  while (i < points.length - 2 && x > points[i + 1][0]) i++;
  const [a, b] = [points[i], points[i + 1]];
  return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
};

/** Independent per-column dark-line trace. Manual anchors constrain identity only.
 * Stems/noteheads are rejected when ink extends vertically beyond a thin line.
 * Median bins suppress intersections; fitted linear slope is removed, never curvature.
 */
export function measureLine(frame, annotation) {
  const { anchors, spacing } = annotation;
  const radius = annotation.radius ?? Math.max(2, spacing * 0.35);
  const points = [];
  let excluded = 0;
  for (let x = Math.ceil(anchors[0][0]) + 3; x < anchors.at(-1)[0] - 3; x += 2) {
    const expected = interp(anchors, x);
    let best = -Infinity,
      bestY = expected;
    for (let y = Math.ceil(expected - radius); y <= expected + radius; y++) {
      if (y < 4 || y >= frame.height - 4 || x < 3 || x >= frame.width - 3) continue;
      let score = 0;
      for (let dx = -2; dx <= 2; dx++) {
        score +=
          (gray(frame, x + dx, y - 3) + gray(frame, x + dx, y + 3)) / 2 - gray(frame, x + dx, y);
      }
      if (score > best) {
        best = score;
        bestY = y;
      }
    }
    const center = gray(frame, x, bestY);
    const outside = (gray(frame, x, bestY - 3) + gray(frame, x, bestY + 3)) / 2;
    if (best < 35 || outside - center < 15 || center > outside * 0.85) {
      excluded++;
      continue;
    }
    // Reject thick vertical ink at intersections, using a local paper-adaptive threshold.
    const threshold = outside - Math.max(18, (outside - center) * 0.38);
    let extent = 1;
    for (const sign of [-1, 1])
      for (let d = 1; d <= 5; d++) {
        if (gray(frame, x, bestY + sign * d) >= threshold) break;
        extent++;
      }
    if (extent > 4) {
      excluded++;
      continue;
    }
    const weights = [-1, 0, 1].map((d) => Math.max(0, outside - gray(frame, x, bestY + d)));
    const total = weights.reduce((a, b) => a + b, 0);
    const y = bestY + (weights[2] - weights[0]) / Math.max(1, total);
    points.push([x, y]);
  }
  const bins = [];
  for (let left = anchors[0][0]; left < anchors.at(-1)[0]; left += 20) {
    const group = points.filter(([x]) => x >= left && x < left + 20);
    if (group.length >= 3)
      bins.push([
        quantile(
          group.map((p) => p[0]),
          0.5,
        ),
        quantile(
          group.map((p) => p[1]),
          0.5,
        ),
      ]);
  }
  if (bins.length < 8) return { status: 'unmeasurable', samples: points.length, excluded, bins };
  const mx = bins.reduce((s, p) => s + p[0], 0) / bins.length;
  const my = bins.reduce((s, p) => s + p[1], 0) / bins.length;
  const slope =
    bins.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) /
    bins.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const residuals = bins.map(([x, y]) => y - my - slope * (x - mx));
  return {
    status: 'measured',
    samples: points.length,
    excluded,
    coverage: points.length / (points.length + excluded),
    rmsPx: Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length),
    peakToPeakPx: Math.max(...residuals) - Math.min(...residuals),
    robustPeakToPeakPx: quantile(residuals, 0.95) - quantile(residuals, 0.05),
    rmsInStaffSpaces:
      Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length) / spacing,
    fittedSlope: slope,
    fittedTiltDegrees: (Math.atan(slope) * 180) / Math.PI,
    fittedEndToEndRisePx: slope * (bins.at(-1)[0] - bins[0][0]),
    leftEndpointY: quantile(
      bins.slice(0, 3).map((p) => p[1]),
      0.5,
    ),
    rightEndpointY: quantile(
      bins.slice(-3).map((p) => p[1]),
      0.5,
    ),
    endpointRisePx:
      quantile(
        bins.slice(-3).map((p) => p[1]),
        0.5,
      ) -
      quantile(
        bins.slice(0, 3).map((p) => p[1]),
        0.5,
      ),
    absoluteVerticalRangePx:
      Math.max(...bins.map((p) => p[1])) - Math.min(...bins.map((p) => p[1])),
    bins,
    residuals,
  };
}

function measureStaff(frame, annotation) {
  const measured = measureLine(frame, annotation);
  const fiveLines = Array.from({ length: 5 }, (_, line) => ({
    line,
    ...measureLine(frame, {
      ...annotation,
      anchors: annotation.anchors.map(([x, y]) => [x, y + line * annotation.spacing]),
    }),
  }));
  const allFiveFound = fiveLines.every((l) => l.status === 'measured' && l.coverage > 0.35);
  const ordered = fiveLines.every(
    (l, i) =>
      !i ||
      quantile(
        l.bins.map((p) => p[1]),
        0.5,
      ) >
        quantile(
          fiveLines[i - 1].bins.map((p) => p[1]),
          0.5,
        ),
  );
  return { ...measured, allFiveFound, ordered, fiveLines };
}

function snapManualAnchors(frame, annotation) {
  const anchors = annotation.anchors.map(([x, initialY]) => {
    let best = { score: -Infinity, y: initialY, spacing: annotation.spacing };
    const row = (y) => {
      let sum = 0,
        count = 0;
      for (let dx = -14; dx <= 14; dx += 2) {
        if (x + dx < 0 || x + dx >= frame.width || y < 1 || y >= frame.height - 1) continue;
        sum += gray(frame, x + dx, y);
        count++;
      }
      return sum / Math.max(1, count);
    };
    const snapRadius = annotation.snapRadius ?? 4;
    for (let spacing = annotation.spacing - 1; spacing <= annotation.spacing + 1; spacing += 0.5)
      for (let y = initialY - snapRadius; y <= initialY + snapRadius; y += 0.5) {
        let score = 0;
        for (let line = 0; line < 5; line++)
          score +=
            (row(y + (line - 0.5) * spacing) + row(y + (line + 0.5) * spacing)) / 2 -
            Math.min(row(y + line * spacing - 0.5), row(y + line * spacing + 0.5));
        // A shifted four-line overlap loses its missing line and gains an external ruling penalty.
        const external = (line) =>
          Math.max(
            0,
            (row(y + (line - 0.5) * spacing) + row(y + (line + 0.5) * spacing)) / 2 -
              row(y + line * spacing),
          );
        score -= 2 * (external(-1) + external(5));
        score -= Math.abs(y - initialY) * 0.5;
        if (score > best.score) best = { score, y, spacing };
      }
    return [x, best.y];
  });
  return { ...annotation, manualInitialAnchors: annotation.anchors, anchors };
}

/** Local geometry-tolerant patch comparison, independent of production maps.
 * The template comes from a separate corner homography. Search is translation
 * and vertical scale only, so this reports visual ink evidence, not note labels.
 */
function matchPatch(source, output, corners, patch) {
  const inv = inverse(squareToQuad(corners)),
    quad = squareToQuad(corners);
  const [u, v] = project(inv, patch.x, patch.y),
    cx = u * (output.width - 1),
    cy = v * (output.height - 1);
  const [ur, vr] = project(inv, patch.x + patch.width / 2, patch.y + patch.height / 2);
  const halfW = Math.max(8, Math.abs(ur - u) * (output.width - 1)),
    halfH = Math.max(8, Math.abs(vr - v) * (output.height - 1));
  const template = [],
    coordinates = [];
  for (let iy = -15; iy <= 15; iy++)
    for (let ix = -15; ix <= 15; ix++) {
      const dx = (ix * halfW) / 15,
        dy = (iy * halfH) / 15;
      const [sx, sy] = project(
        quad,
        (cx + dx) / (output.width - 1),
        (cy + dy) / (output.height - 1),
      );
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
      template.push(gray(source, sx, sy));
      coordinates.push([dx, dy]);
    }
  const tm = template.reduce((s, v) => s + v, 0) / template.length,
    tv = template.reduce((s, v) => s + (v - tm) ** 2, 0);
  let best = { ncc: -1 };
  const score = (dx, dy, scale) => {
    const values = [];
    for (const [x, y] of coordinates) {
      const ox = cx + dx + x,
        oy = cy + dy + y * scale;
      if (ox < 1 || oy < 1 || ox >= output.width - 1 || oy >= output.height - 1) return;
      values.push(gray(output, ox, oy));
    }
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    let cov = 0,
      variance = 0;
    for (let i = 0; i < values.length; i++) {
      cov += (template[i] - tm) * (values[i] - mean);
      variance += (values[i] - mean) ** 2;
    }
    const ncc = cov / Math.sqrt(tv * variance);
    if (ncc > best.ncc) best = { ncc, dx, dy, scale, values };
  };
  for (const scale of [0.85, 1, 1.15])
    for (let dy = -100; dy <= 100; dy += 4)
      for (let dx = -12; dx <= 12; dx += 4) score(dx, dy, scale);
  if (!best.values)
    return {
      id: patch.id,
      annotation: patch,
      status: 'unmatched',
      reason: 'No complete patch candidate inside output image',
      ncc: null,
      withinImage: false,
    };
  const coarse = { ...best };
  for (let dy = coarse.dy - 3; dy <= coarse.dy + 3; dy++)
    for (let dx = coarse.dx - 3; dx <= coarse.dx + 3; dx++)
      for (const scale of [coarse.scale - 0.05, coarse.scale, coarse.scale + 0.05])
        score(dx, dy, scale);
  const sourcePaper = quantile(template, 0.85),
    sourceDark = quantile(template, 0.15),
    destPaper = quantile(best.values ?? [], 0.85),
    destDark = quantile(best.values ?? [], 0.15);
  let dark = 0,
    retained = 0;
  for (let i = 0; i < template.length; i++)
    if (template[i] < sourceDark + (sourcePaper - sourceDark) * 0.25) {
      dark++;
      if (best.values[i] < destDark + (destPaper - destDark) * 0.45) retained++;
    }
  const { values, ...match } = best;
  return {
    id: patch.id,
    annotation: patch,
    independentExpectedCenter: [cx, cy],
    ...match,
    sourceInkSamples: dark,
    matchedInkRetention: retained / Math.max(1, dark),
    withinImage:
      cx + best.dx - halfW > 0 &&
      cx + best.dx + halfW < output.width &&
      cy + best.dy - halfH * best.scale > 0 &&
      cy + best.dy + halfH * best.scale < output.height,
  };
}

function squareToQuad(p) {
  const [a, b, c, d] = p;
  const dx = a.x - b.x + c.x - d.x,
    dy = a.y - b.y + c.y - d.y;
  let g = 0,
    h = 0;
  if (Math.abs(dx) + Math.abs(dy) > 1e-8) {
    const bx = b.x - c.x,
      by = b.y - c.y,
      ex = d.x - c.x,
      ey = d.y - c.y,
      det = bx * ey - ex * by;
    g = (dx * ey - ex * dy) / det;
    h = (bx * dy - dx * by) / det;
  }
  return [
    b.x - a.x + g * b.x,
    d.x - a.x + h * d.x,
    a.x,
    b.y - a.y + g * b.y,
    d.y - a.y + h * d.y,
    a.y,
    g,
    h,
    1,
  ];
}
function inverse(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const r = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const det = a * r[0] + b * r[3] + c * r[6];
  return r.map((v) => v / det);
}
const project = (m, x, y) => [
  (m[0] * x + m[1] * y + m[2]) / (m[6] * x + m[7] * y + m[8]),
  (m[3] * x + m[4] * y + m[5]) / (m[6] * x + m[7] * y + m[8]),
];
function outputAnnotation(a, corners, frame) {
  const inv = inverse(squareToQuad(corners));
  const anchors = a.anchors.map(([x, y]) => {
    const [u, v] = project(inv, x, y);
    return [u * (frame.width - 1), v * (frame.height - 1)];
  });
  const midpoint = a.anchors[Math.floor(a.anchors.length / 2)];
  const p = project(inv, ...midpoint),
    q = project(inv, midpoint[0], midpoint[1] + a.spacing);
  return { ...a, anchors, spacing: Math.abs(q[1] - p[1]) * (frame.height - 1) };
}
async function encode(page, frame, filename) {
  const png = await page.evaluate(
    ({ width, height, base64 }) => {
      const b = atob(base64),
        a = new Uint8ClampedArray(b.length);
      for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      c.getContext('2d').putImageData(new ImageData(a, width, height), 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    },
    {
      width: frame.width,
      height: frame.height,
      base64: Buffer.from(frame.data).toString('base64'),
    },
  );
  await fs.writeFile(filename, Buffer.from(png, 'base64'));
}

async function main() {
  if (!process.argv[2])
    throw new Error(
      'Usage: node scripts/check-score-camera-photos.mjs manifest.json [output-directory]',
    );
  const manifestPath = path.resolve(process.argv[2]),
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const out = path.resolve(process.argv[3] ?? path.join(root, 'build/curved-photo-acceptance'));
  await fs.mkdir(path.join(out, 'modules'), { recursive: true });
  // Rebuild every local dependency. No implementation changes or private exports.
  const sourceDir = path.join(root, 'apps/web/src/scan/camera');
  const productionSources = {};
  for (const name of await fs.readdir(sourceDir)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const source = await fs.readFile(path.join(sourceDir, name), 'utf8');
    productionSources[name] = createHash('sha256').update(source).digest('hex');
    const js = ts
      .transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      })
      .outputText.replace(/(['"])\.\/([^'"\n]+)\.js\1/g, "'./$2.mjs'");
    await fs.writeFile(path.join(out, 'modules', name.replace(/\.ts$/, '.mjs')), js);
  }
  const vision = await import(pathToFileURL(path.join(out, 'modules/vision.mjs')).href);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const report = {
    schema: 1,
    productionSources,
    harnessSha256: createHash('sha256')
      .update(await fs.readFile(fileURLToPath(import.meta.url)))
      .digest('hex'),
    runtime: { node: process.versions.node, typescript: ts.version, chromium: browser.version() },
    method:
      'Actual unique JPEG inputs; Chromium Image.decode + Canvas 2D tracking downsample; unmodified production TS transpiled to ESM. Independent manual-line pixel traces reject thick intersections and remove affine slope only. No OMR or musical-accuracy claim.',
    annotations: manifest,
    inputs: [],
    registrations: [],
    cases: [],
  };
  const save = () => fs.writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  const inputs = new Map();
  try {
    for (const input of manifest.inputs) {
      const bytes = await fs.readFile(path.resolve(path.dirname(manifestPath), input.file));
      const decoded = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${base64}`;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = image.naturalWidth;
        c.height = image.naturalHeight;
        c.getContext('2d').drawImage(image, 0, 0);
        const t = document.createElement('canvas'),
          factor = Math.min(1, 360 / Math.max(c.width, c.height));
        t.width = Math.round(c.width * factor);
        t.height = Math.round(c.height * factor);
        t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        const read = (c) => {
          const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let b = '';
          for (let i = 0; i < a.length; i += 32768)
            b += String.fromCharCode(...a.subarray(i, i + 32768));
          return { width: c.width, height: c.height, base64: btoa(b) };
        };
        return { full: read(c), tracking: read(t) };
      }, bytes.toString('base64'));
      const frame = (f) => ({
        width: f.width,
        height: f.height,
        data: new Uint8ClampedArray(Buffer.from(f.base64, 'base64')),
      });
      const item = { ...input, full: frame(decoded.full), tracking: frame(decoded.tracking) };
      inputs.set(input.id, item);
      await fs.writeFile(path.join(out, `${input.id}-original.jpg`), bytes);
      report.inputs.push({
        id: input.id,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        width: item.full.width,
        height: item.full.height,
        tracking: [item.tracking.width, item.tracking.height],
        corners: input.corners,
        sharpness: vision.sharpness(item.tracking),
        lines: input.staff.map((a) => ({ id: a.id, annotation: a, ...measureStaff(item.full, a) })),
      });
      await save();
    }
    for (const a of inputs.values())
      for (const b of inputs.values()) {
        if (a === b) continue;
        const start = performance.now();
        try {
          report.registrations.push({
            reference: a.id,
            current: b.id,
            samePage: a.page === b.page,
            result: vision.registerFrame(a.tracking, b.tracking),
            elapsedMs: performance.now() - start,
          });
        } catch (error) {
          report.registrations.push({
            reference: a.id,
            current: b.id,
            error: { name: error.name, message: error.message, stack: error.stack },
            elapsedMs: performance.now() - start,
          });
        }
        await save();
      }
    for (const test of manifest.cases) {
      const record = {
        id: test.id,
        label:
          test.inputs.length === 1
            ? 'Genuine single view'
            : `Genuine ${test.inputs.length}-view reconstruction`,
        inputs: test.inputs,
      };
      report.cases.push(record);
      const start = performance.now();
      try {
        const selected = test.inputs.map((id) => inputs.get(id));
        if (
          new Set(selected.map((i) => report.inputs.find((r) => r.id === i.id).sha256)).size !==
          selected.length
        )
          throw new Error('Repeated photograph disallowed');
        const reference = selected[0],
          captures = selected.map((item, index) => {
            if (!index) return { frame: item.full, matrix: identity };
            const registration = report.registrations.find(
              (r) => r.reference === reference.id && r.current === item.id,
            )?.result;
            if (!registration)
              throw new Error(`Tracking registration rejected ${reference.id} -> ${item.id}`);
            const m = registration.matrix,
              sx = reference.full.width / reference.tracking.width,
              sy = reference.full.height / reference.tracking.height;
            return {
              frame: item.full,
              matrix: [
                m[0],
                (m[1] * sx) / sy,
                m[2] * sx,
                (m[3] * sy) / sx,
                m[4],
                m[5] * sy,
                m[6] / sx,
                m[7] / sy,
                m[8],
              ],
            };
          });
        if (!vision.reconstructPage)
          throw new Error('Production reconstructPage export unavailable');
        const result = await vision.reconstructPage(captures, reference.corners);
        record.elapsedMs = performance.now() - start;
        record.status = 'resolved';
        record.width = result.frame.width;
        record.height = result.frame.height;
        record.geometry = result.geometry;
        record.productionDiagnostics = {
          staff: result.staff,
          alignments: result.alignments,
          contributions: result.contributions,
        };
        record.output = `${test.id}-output.png`;
        await encode(page, result.frame, path.join(out, record.output));
        if (reference.expectedStaffGroups !== undefined) {
          record.productionStaffCountCheck = {
            expected: reference.expectedStaffGroups,
            detected: result.staff?.staves.length ?? 0,
            method:
              'Ancillary production diagnostic gate; independent pixel traces remain separate.',
          };
          if (record.productionStaffCountCheck.detected !== reference.expectedStaffGroups)
            throw new Error(
              `Production staff-group count ${record.productionStaffCountCheck.detected}; expected ${reference.expectedStaffGroups}`,
            );
        }
        // Manual final-image seeds can be supplied in the manifest after blind first run.
        record.lines = reference.staff.map((a) => {
          let annotation =
            test.outputStaff?.find((s) => s.id === a.id) ??
            outputAnnotation(a, reference.corners, result.frame);
          if (test.outputStaff) annotation = snapManualAnchors(result.frame, annotation);
          return {
            id: a.id,
            seedMethod: test.outputStaff
              ? 'manual final-image seed + independent local five-ruling pixel snap'
              : 'independent corner homography prediction (provisional: nonlinear warps may invalidate)',
            annotation,
            ...measureStaff(result.frame, annotation),
          };
        });
        record.staffOrder = record.lines.every(
          (line, index) =>
            !index ||
            quantile(
              line.bins.map((p) => p[1]),
              0.5,
            ) >
              quantile(
                record.lines[index - 1].bins.map((p) => p[1]),
                0.5,
              ),
        );
        record.staffCount = {
          annotated: reference.staff.length,
          found: record.lines.filter((l) => l.allFiveFound && l.ordered).length,
          scope:
            'All manually enumerated main staves; ossia and footnote fragments excluded from this main-staff count and retained visually.',
        };
        record.patchPreservation = {
          method:
            'Independent homography template; local translation/vertical-scale normalized pixel correlation. No note or fingering recognition.',
          patches: (reference.patches ?? []).map((p) =>
            matchPatch(reference.full, result.frame, reference.corners, p),
          ),
        };
      } catch (error) {
        record.status = 'rejected';
        record.error = { name: error.name, message: error.message, stack: error.stack };
        record.elapsedMs = performance.now() - start;
      }
      console.log(
        JSON.stringify({
          id: record.id,
          status: record.status,
          error: record.error?.message,
          elapsedMs: record.elapsedMs,
        }),
      );
      await save();
    }
    for (const record of report.cases.filter((c) => c.status === 'resolved')) {
      const pictures = [];
      for (const id of record.inputs) {
        const bytes = await fs.readFile(path.join(out, `${id}-original.jpg`));
        pictures.push({
          label: `Original photograph ${id}`,
          url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        });
      }
      const bytes = await fs.readFile(path.join(out, record.output));
      pictures.push({
        label: `${record.inputs.length} actual view${record.inputs.length === 1 ? '' : 's'}: production output`,
        url: `data:image/png;base64,${bytes.toString('base64')}`,
      });
      const png = await page.evaluate(
        async ({ pictures, label }) => {
          const scale = 0.5,
            gap = 18,
            header = 115;
          const decoded = await Promise.all(
            pictures.map(async (picture) => {
              const image = new Image();
              image.src = picture.url;
              await image.decode();
              return {
                ...picture,
                image,
                width: Math.round(image.width * scale),
                height: Math.round(image.height * scale),
              };
            }),
          );
          const canvas = document.createElement('canvas');
          canvas.width = decoded.reduce((sum, p) => sum + p.width, 0) + gap * (decoded.length + 1);
          canvas.height = Math.max(...decoded.map((p) => p.height)) + header + gap;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#111';
          ctx.font = 'bold 22px sans-serif';
          ctx.fillText(label, gap, 30);
          ctx.font = '16px sans-serif';
          ctx.fillText(
            '0.5 display pixels per image pixel. Full images; no added contrast or cleanup.',
            gap,
            57,
          );
          ctx.fillText(
            decoded.length > 2
              ? 'Two independently taken photographs; this does not establish four-capture device performance.'
              : 'One actual photograph; this is a single-view reconstruction.',
            gap,
            80,
          );
          let x = gap;
          for (const p of decoded) {
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(p.label, x, 105);
            ctx.drawImage(p.image, x, header, p.width, p.height);
            x += p.width + gap;
          }
          return canvas.toDataURL('image/png').split(',')[1];
        },
        { pictures, label: `${record.id} — ${record.label}` },
      );
      record.comparison = `${record.id}-comparison.png`;
      await fs.writeFile(path.join(out, record.comparison), Buffer.from(png, 'base64'));
    }
    report.productionSourcesAtEnd = {};
    for (const name of Object.keys(productionSources))
      report.productionSourcesAtEnd[name] = createHash('sha256')
        .update(await fs.readFile(path.join(sourceDir, name)))
        .digest('hex');
    report.sourceFreezeVerified = Object.entries(productionSources).every(
      ([name, hash]) => report.productionSourcesAtEnd[name] === hash,
    );
    await save();
    const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    const cards = report.cases
      .map((c) => {
        const ref = inputs.get(c.inputs[0]);
        const width = Math.round(ref.full.width * 0.45);
        return `<section><h2>${escape(c.id)} — ${escape(c.label)}</h2><p>${escape(c.status)}; ${Math.round(c.elapsedMs)} ms</p><div class="pair"><figure><figcaption>Original, same display pixels per source pixel</figcaption><img width="${width}" src="${ref.id}-original.jpg"></figure>${c.output ? `<figure><figcaption>Production output (0.45 display pixels/output pixel)</figcaption><img width="${Math.round(c.width * 0.45)}" src="${c.output}"></figure>` : `<pre>${escape(c.error?.message)}</pre>`}</div></section>`;
      })
      .join('');
    await fs.writeFile(
      path.join(out, 'comparison.html'),
      `<!doctype html><meta charset="utf-8"><title>Actual-photo acceptance</title><style>body{font:15px system-ui;margin:24px;background:#eee;color:#111}.pair{display:flex;align-items:flex-start;gap:16px}figure{margin:0}figcaption{margin:8px 0}img{display:block}section{border-top:1px solid;margin-top:32px}pre{white-space:pre-wrap}</style><h1>Actual-photo reconstruction acceptance</h1><p>Unique real inputs. Before/after at a common pixel scale, no cropping or contrast changes in this comparison. Geometry and pixel traces are not a claim of musical accuracy. Full coordinates, hashes, errors and diagnostics: <a href="results.json">results.json</a>.</p>${cards}`,
    );
  } finally {
    await browser.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
