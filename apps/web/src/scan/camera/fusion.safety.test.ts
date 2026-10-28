import { describe, expect, it } from 'vitest';
import { fuseViews } from './fusion';

/**
 * The fusion's first guarantee (issue 143): no photograph may add, double, move or erase a
 * musical mark. These cases come from an adversarial review: a view misregistered by a few
 * pixels in one part of the page (the tracker unaware), glare in most of the photographs, a
 * noisy photograph, a hair in one photograph, and a shaded second photograph.
 */

function lcg(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
/** Unit-variance noise. */
function gauss(random: () => number) {
  return (random() + random() + random() + random() + random() + random() - 3) * Math.SQRT2;
}
async function fuse(
  width: number,
  height: number,
  images: Float64Array[],
  weight: (view: number, x: number, y: number) => number = () => 1,
  bandRows?: number,
): Promise<Float64Array> {
  const out = new Float64Array(width * height);
  await fuseViews(
    width,
    height,
    images.length,
    (y, values, weights) =>
      images.forEach((image, v) => {
        values[v]!.set(image.subarray(y * width, (y + 1) * width));
        for (let x = 0; x < width; x++) weights[v]![x] = weight(v, x, y);
      }),
    (y, fused) => out.set(fused, y * width),
    undefined,
    bandRows,
  );
  return out;
}
function deviation(image: Float64Array, width: number, inside: (x: number, y: number) => boolean) {
  let sum = 0,
    squares = 0,
    n = 0;
  for (let i = 0; i < image.length; i++)
    if (inside(i % width, Math.floor(i / width))) {
      sum += image[i]!;
      squares += image[i]! ** 2;
      n++;
    }
  return Math.sqrt(squares / n - (sum / n) ** 2);
}

describe('a view misregistered in one quadrant (issue 143)', () => {
  const W = 256,
    H = 256,
    PAPER = 240,
    lines: number[] = [];
  for (const top of [20, 84, 148, 200])
    for (let k = 0; k < 5; k++) if (top + k * 8 < H - 8) lines.push(top + k * 8 + 0.5);
  /** One-pixel staff lines across the page; stems only in the right half. */
  const truth = (px: number, py: number) => {
    for (const line of lines) if (Math.abs(py - line) < 0.5 && px > 6 && px < W - 6) return 60;
    for (let sx = 140; sx < W - 10; sx += 24)
      if (Math.abs(px - (sx + 0.5)) < 0.5 && ((py > 140 && py < 182) || (py > 196 && py < 236)))
        return 60;
    return PAPER;
  };
  const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  /** The lower right quadrant, with a 16-pixel ramp. */
  const quadrant = (x: number, y: number) =>
    smooth((x - W / 2 + 8) / 16) * smooth((y - H / 2 + 8) / 16);
  /** A photograph: the page displaced down by shift * quadrant, area-sampled, blurred, noisy. */
  function photograph(shift: number, sigma: number, seed: number): Float64Array {
    const sharp = new Float64Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = shift * quadrant(x, y);
        let s = 0;
        for (let j = 0; j < 8; j++)
          for (let i = 0; i < 8; i++) s += truth(x + (i + 0.5) / 8, y + d + (j + 0.5) / 8);
        sharp[y * W + x] = s / 64;
      }
    const r = Math.ceil(sigma * 3),
      kernel = Array.from({ length: 2 * r + 1 }, (_, i) =>
        Math.exp(-((i - r) ** 2) / (2 * sigma ** 2)),
      ),
      total = kernel.reduce((a, b) => a + b, 0);
    const pass = (src: Float64Array, dx: number, dy: number) => {
      const out = new Float64Array(src.length);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let sum = 0;
          for (let i = -r; i <= r; i++)
            sum +=
              src[
                Math.max(0, Math.min(H - 1, y + i * dy)) * W +
                  Math.max(0, Math.min(W - 1, x + i * dx))
              ]! * kernel[i + r]!;
          out[y * W + x] = sum / total;
        }
      return out;
    };
    const out = pass(pass(sharp, 1, 0), 0, 1),
      random = lcg(seed);
    for (let i = 0; i < out.length; i++)
      out[i] = Math.max(0, Math.min(255, Math.round(out[i]! + 5 * gauss(random))));
    return out;
  }
  /** Staff lines in the shifted quadrant, stems excluded: columns whose line reads as two
   * separate ink runs within four rows, and the line's mean darkest value. */
  function lineScore(image: Float64Array) {
    let columns = 0,
      doubled = 0,
      darkest = 0,
      ghosts = 0;
    for (let x = 150; x < 250; x++) {
      if ((x - 140) % 24 <= 2 || (x - 140) % 24 >= 22) continue;
      for (const line of lines.filter((l) => l > 140 && l < 250)) {
        const c = Math.floor(line);
        let runs = 0,
          inRun = false,
          min = 255;
        for (let y = c - 4; y <= c + 4; y++) {
          const v = image[y * W + x]!,
            ink = v < 190;
          if (ink && !inRun) runs++;
          inRun = ink;
          min = Math.min(min, v);
          if (v < 150 && Math.abs(y - c) >= 2) ghosts++;
        }
        columns++;
        if (runs > 1) doubled++;
        darkest += min;
      }
    }
    return { doubled: doubled / columns, darkest: darkest / columns, ghosts };
  }

  for (const count of [2, 3, 5])
    for (const shift of [2, 3])
      it(`draws each line once with ${count} views, one shifted ${shift} px`, async () => {
        const reference = photograph(0, 0.6, 1),
          views = [reference, photograph(shift, 0.6, 2)];
        for (let v = 2; v < count; v++) views.push(photograph(0, 0.6, v + 1));
        const out = await fuse(W, H, views, (v) => (v === 0 ? 1 : 0.9));
        const alone = lineScore(reference),
          fused = lineScore(out);
        // The unguarded fusion doubled 94 to 100 % of these columns.
        expect(fused.doubled).toBeLessThanOrEqual(0.01);
        expect(fused.ghosts).toBe(0);
        // The true line keeps its darkness (the unguarded fusion drew both lines lighter).
        expect(fused.darkest).toBeLessThan(alone.darkest + 4);
        // Away from the shifted quadrant the other photographs still count: less noise than
        // the reference alone on its paper.
        const paper = (x: number, y: number) =>
          x > 20 && x < 110 && y > 40 && y < 120 && lines.every((l) => Math.abs(y - l) > 3);
        expect(deviation(out, W, paper)).toBeLessThan(deviation(reference, W, paper) * 0.9);
      });

  it('leaves no ghost of a view misregistered by ten pixels at high confidence', async () => {
    // The benchmark found the local registration itself 10 to 11 pixels off in one view at
    // confidence 0.81 to 0.89: stems and noteheads were drawn twice.
    for (const count of [2, 3, 5])
      for (const shift of [10, 11]) {
        const reference = photograph(0, 0.6, 1),
          views = [reference, photograph(shift, 0.6, 2)];
        for (let v = 2; v < count; v++) views.push(photograph(0, 0.6, v + 1));
        const out = await fuse(W, H, views, (v) => (v === 0 ? 1 : 0.9));
        expect(lineScore(out).ghosts).toBe(0);
        // No faint copy either: paper two pixels or more from any mark stays within 25 levels.
        let worst = 0;
        for (let y = 140; y < 250; y++)
          for (let x = 140; x < 250; x++) {
            let near = false;
            for (let dy = -2; dy <= 2 && !near; dy++)
              for (let dx = -2; dx <= 2 && !near; dx++)
                if (truth(x + dx + 0.5, y + dy + 0.5) < 200) near = true;
            if (!near) worst = Math.max(worst, PAPER - out[y * W + x]!);
          }
        // The unguarded fusion left copies 106 to 172 levels deep.
        expect(worst).toBeLessThan(25);
      }
  });

  it('does not let a sharper misregistered view move the line', async () => {
    for (const count of [2, 5]) {
      const views = [photograph(0, 1, 1), photograph(3, 0.3, 2)];
      for (let v = 2; v < count; v++) views.push(photograph(0, 1, v + 1));
      const fused = lineScore(await fuse(W, H, views, (v) => (v === 0 ? 1 : 0.9)));
      expect(fused.doubled).toBeLessThanOrEqual(0.01);
      // The shifted view alone puts every line two to three pixels off: 800 such pixels.
      expect(fused.ghosts).toBe(0);
    }
  });
});

describe('fusion weights (issue 143)', () => {
  it('keeps the ink of the one clean view under glare in most photographs', async () => {
    const W = 120,
      H = 120;
    for (const [count, glared] of [
      [3, [0, 1]],
      [3, [1, 2]],
      [5, [0, 1, 2]],
      [5, [1, 2, 3]],
    ] as [number, number[]][]) {
      const views = Array.from({ length: count }, (_, v) => {
        const random = lcg(500 + v);
        return Float64Array.from({ length: W * H }, (_, i) => {
          const y = Math.floor(i / W),
            x = i % W;
          let t = (y - 20) % 8 === 0 && y < 100 ? 60 : 230;
          if (glared.includes(v)) t += 240 * Math.exp(-((x - 60) ** 2 + (y - 60) ** 2) / 1250);
          return Math.max(0, Math.min(255, Math.round(t + 3 * gauss(random))));
        });
      });
      // As the camera weighs a clipped highlight: it only bounds the true value from below.
      const saturation = (raw: number) => (raw < 250 ? 1 : Math.max(0.05, (255 - raw) / 5));
      const out = await fuse(W, H, views, (v, x, y) => saturation(views[v]![y * W + x]!));
      let ink = 0,
        n = 0;
      for (let y = 45; y < 76; y++)
        for (let x = 45; x < 76; x++)
          if ((y - 20) % 8 === 0) {
            n++;
            if (out[y * W + x]! < 150) ink++;
          }
      // An unweighted median let the clipped majority erase every one of these (0 of 93).
      expect(ink / n).toBeGreaterThan(0.95);
    }
  });

  it('is never noisier on plain paper than the best photograph', async () => {
    const W = 200,
      H = 200,
      inner = (x: number, y: number) => x > 10 && y > 10 && x < W - 10 && y < H - 10;
    for (const sigmas of [
      [3, 4, 5, 6, 8],
      [3, 8],
      [6, 3, 3, 3, 3],
      [3, 3, 3, 3, 3],
    ]) {
      const views = sigmas.map((sigma, v) => {
        const random = lcg(100 + v);
        return Float64Array.from({ length: W * H }, () => 240 + sigma * gauss(random));
      });
      const out = await fuse(W, H, views);
      const best = Math.min(...views.map((view) => deviation(view, W, inner)));
      // The energy-weighted detail once followed the noisiest photograph (6.25 for 3 to 8).
      expect(deviation(out, W, inner)).toBeLessThan(best);
    }
  });

  it('does not paint a hair or a scratch that one photograph alone shows', async () => {
    const W = 120,
      H = 80;
    for (const count of [2, 3, 5])
      for (const contrast of [60, 100, 150, 200]) {
        const views = Array.from({ length: count }, (_, v) => {
          const random = lcg(300 + v);
          return Float64Array.from({ length: W * H }, (_, i) => {
            const y = Math.floor(i / W),
              x = i % W,
              mark = v === 1 && y === 40 && x > 20 && x < 100 ? contrast : 0;
            return Math.max(0, Math.min(255, Math.round(240 - mark + 4 * gauss(random))));
          });
        });
        const out = await fuse(W, H, views);
        let mark = 0,
          paper = 0;
        for (let x = 30; x < 90; x++) {
          mark += out[40 * W + x]! / 60;
          paper += out[30 * W + x]! / 60;
        }
        // With two photographs an even split goes to the darker one, so the hair's base (its
        // local mean, a fifth of its depth) remains; never its detail. The unguarded fusion
        // painted up to 201 of 200 levels.
        expect(paper - mark).toBeLessThan(count === 2 ? 30 : 8);
      }
  });

  it('keeps the reference marks where a shaded second photograph cannot be verified', async () => {
    // The owner's page-25 pair: the second photograph is darker over part of the page, so its
    // base wins the two-view vote; where its detail is not verified the reference's must stay,
    // or stems and staff lines vanish.
    const W = 160,
      H = 120,
      line = (y: number) => y % 12 === 0 && y > 10 && y < 110;
    const reference = Float64Array.from({ length: W * H }, (_, i) =>
      line(Math.floor(i / W)) ? 60 : 200,
    );
    const random = lcg(9);
    const shaded = Float64Array.from({ length: W * H }, (_, i) => {
      const y = Math.floor(i / W);
      // Shaded by 40 levels and misregistered by three rows.
      return Math.round(0.8 * (line(y - 3) ? 60 : 200) + 2 * gauss(random));
    });
    const out = await fuse(W, H, [reference, shaded]);
    let kept = 0,
      n = 0;
    for (let y = 24; y < 100; y++)
      if (line(y))
        for (let x = 20; x < 140; x++) {
          n++;
          if (out[y * W + x]! < out[(y + 6) * W + x]! - 60) kept++;
        }
    expect(kept / n).toBeGreaterThan(0.95);
  });

  it('never erases a barline the reference shows', async () => {
    // Harsh benchmark: a sharp view slightly off and a view where the pixel is paper erased a
    // bass-staff barline the reference alone read correctly.
    const W = 96,
      H = 96,
      bar = (x: number, offset: number) => Math.abs(x - 48 - offset) < 0.5;
    const render = (offset: number, contrast: number, seed: number) => {
      const random = lcg(seed);
      return Float64Array.from({ length: W * H }, (_, i) => {
        const x = i % W;
        return Math.round(230 - (bar(x, offset) ? contrast : 0) + 2 * gauss(random));
      });
    };
    const reference = render(0, 150, 1);
    const views = [
      reference,
      render(1, 200, 2),
      render(-1, 200, 3),
      render(0, 0, 4),
      render(1, 200, 5),
    ];
    const out = await fuse(W, H, views);
    for (let y = 20; y < 76; y++) expect(out[y * W + 48]!).toBeLessThan(230 - 75);
  });

  it('keeps the paper smooth where a darker view passes and fails the check by turns', async () => {
    // Harsh benchmark: blocks of different paper brightness with hard edges, the size of the
    // registration grid, where the views taking part changed from cell to cell.
    const W = 192,
      H = 96,
      random = lcg(11);
    const line = (y: number) => y % 12 === 6;
    const reference = Float64Array.from({ length: W * H }, (_, i) =>
      Math.round((line(Math.floor(i / W)) ? 80 : 220) + 2 * gauss(random)),
    );
    // A second photograph 15 levels darker, misregistered by three rows in alternate blocks.
    const shaded = Float64Array.from({ length: W * H }, (_, i) => {
      const x = i % W,
        y = Math.floor(i / W),
        off = Math.floor(x / 48) % 2 ? 3 : 0;
      return Math.round((line(y - off) ? 80 : 220) - 15 + 2 * gauss(random));
    });
    const out = await fuse(W, H, [reference, shaded]);
    // Mean paper per column, between the lines.
    const paper = Array.from({ length: W }, (_, x) => {
      let sum = 0,
        n = 0;
      for (let y = 10; y < H - 10; y++)
        if ([0, 1, 11].includes(y % 12)) {
          sum += out[y * W + x]!;
          n++;
        }
      return sum / n;
    });
    // The blocks where the darker view passes and where it fails sit at one paper level (the
    // patchwork differed by the darker view's whole offset); only the photograph's own fold at
    // each block edge leaves a narrow seam.
    const mean = (odd: number) => {
      let sum = 0,
        n = 0;
      for (let x = 8; x < W - 8; x++)
        if (Math.floor(x / 48) % 2 === odd && x % 48 > 8 && x % 48 < 40) {
          sum += paper[x]!;
          n++;
        }
      return sum / n;
    };
    expect(Math.abs(mean(0) - mean(1))).toBeLessThan(1.5);
    const sorted = paper.slice(8, W - 8).sort((p, q) => p - q),
      median = sorted[sorted.length >> 1]!;
    for (let x = 8; x < W - 8; x++) expect(Math.abs(paper[x]! - median)).toBeLessThan(8);
  });

  it('stays finite on degenerate pages', async () => {
    const cases: [
      number,
      number,
      number,
      (v: number) => number,
      (v: number, i: number) => number,
    ][] = [
      [30, 30, 5, () => 0.05 * 0.35, () => 255],
      [30, 30, 3, () => 0, () => 200],
      [30, 30, 5, (v) => (v === 0 ? 1 : 0), (v, i) => (i % 13) * 10 + v],
      [30, 30, 5, () => 1, () => 240],
      [1, 1, 5, () => 1, (v) => 100 + v],
      [2, 1, 2, () => 1, (v, i) => 100 + v * 50 + i],
      [1, 50, 3, () => 1, (v, i) => (i % 3) * 80 + v],
      [30, 30, 5, () => 1, (v, i) => (i % 2 ? -500 : 900) + v],
      [30, 30, 3, (v) => (v === 2 ? NaN : 1), () => 128],
      // Identical noise-free views: every correlation of their fine bands is exactly flat.
      [40, 40, 2, () => 1, (_, i) => (Math.floor(i / 40) % 12 === 0 ? 60 : 200)],
    ];
    for (const [width, height, count, weight, value] of cases) {
      const views = Array.from({ length: count }, (_, v) =>
        Float64Array.from({ length: width * height }, (_, i) => value(v, i)),
      );
      const out = await fuse(width, height, views, (v) => weight(v));
      expect(out.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('gives the same page whatever the height of the streamed bands', async () => {
    const W = 53,
      H = 150,
      random = lcg(5);
    const views = Array.from({ length: 4 }, (_, v) =>
      Float64Array.from({ length: W * H }, (_, i) => {
        const y = Math.floor(i / W),
          x = i % W;
        return Math.max(
          0,
          Math.min(
            255,
            200 - (y % 7 === 0 ? 120 : 0) + 20 * Math.sin(x / 3 + v) + 8 * gauss(random),
          ),
        );
      }),
    );
    const weight = (v: number, x: number, y: number) =>
      v > 0 && (x * 7 + y * 3 + v) % 11 === 0 ? 0 : 0.6 + ((x + y + v) % 5) / 12;
    const reference = await fuse(W, H, views, weight, 64);
    for (const band of [16, 32, 48, 128, 160])
      expect(await fuse(W, H, views, weight, band)).toEqual(reference);
  });
});
