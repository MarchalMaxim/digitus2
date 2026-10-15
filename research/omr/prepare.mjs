/** Reproducible synthetic OMR scans. Run with Node; no service or new dependencies. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_SLUGS = Object.freeze([
  'twinkle-twinkle-little-star',
  'bach-minuet-g-major-bwv-anh-114',
  'chopin-prelude-op28-no7',
]);
export const RENDER_OPTIONS = Object.freeze({
  scale: 60,
  pageWidth: 2100,
  pageHeight: 2970,
  adjustPageHeight: false,
  breaks: 'auto',
  header: 'none',
  footer: 'none',
  svgViewBox: true,
  svgRemoveXlink: true,
  xmlIdSeed: 1,
});
export const CONFIG = Object.freeze({
  page: { widthMm: 210, heightMm: 297, widthPx: 1260, heightPx: 1782 },
  renderedInputTransform:
    'Remove MusicXML fingering elements; reference MusicXML stays byte-for-byte original.',
  variants: {
    clean: { background: 'white' },
    skew: { degrees: 1.5, fitRotatedPage: true, background: 'white' },
    shadow: { edgeOpacity: 0.32, fadeAcrossWidth: 0.65 },
    lowContrast: { black: 89, white: 242 },
  },
  scope: 'Synthetic stress fixtures, not real camera photographs or recognition-quality evidence.',
  pdfMetadataDate: "D:20000101000000+00'00'",
  svgOverflowPaddingPx: 12,
  svgAspectRatio:
    'Preserve the original page ratio while expanding padded ink bounds symmetrically.',
});
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Fit every ink mark while retaining the page ratio used by PNG and PDF rendering. */
export function expandPageViewBox(page, ink, padding = CONFIG.svgOverflowPaddingPx) {
  for (const box of [page, ink]) {
    if (
      !box ||
      !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(box[key])) ||
      box.width <= 0 ||
      box.height <= 0
    ) {
      throw new Error('Page and ink bounds need finite coordinates and positive dimensions.');
    }
  }
  if (!Number.isFinite(padding) || padding < 0)
    throw new Error('Padding must be finite and nonnegative.');
  const left = Math.min(page.x, ink.x - padding);
  const top = Math.min(page.y, ink.y - padding);
  const right = Math.max(page.x + page.width, ink.x + ink.width + padding);
  const bottom = Math.max(page.y + page.height, ink.y + ink.height + padding);
  const width = right - left;
  const height = bottom - top;
  const scale = Math.max(width / page.width, height / page.height);
  const fittedWidth = page.width * scale;
  const fittedHeight = page.height * scale;
  const result = {
    x: left + (width - fittedWidth) / 2,
    y: top + (height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
  if (!Object.values(result).every(Number.isFinite) || result.width <= 0 || result.height <= 0) {
    throw new Error('Page geometry exceeds finite numeric bounds.');
  }
  return result;
}

export function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--out', '--slugs'].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    const key = flag.slice(2);
    if (Object.hasOwn(result, key)) throw new Error(`Duplicate argument: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    result[key] = key === 'slugs' ? value.split(',') : value;
  }
  return result;
}

export function safeRelativePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.includes(':') ||
    value.startsWith('/') ||
    value
      .split('/')
      .some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part.endsWith('.'))
  ) {
    throw new Error(`Unsafe relative path: ${String(value)}`);
  }
  return value;
}

export function selectPieces(manifest, slugs = DEFAULT_SLUGS) {
  if (!Array.isArray(manifest) || !Array.isArray(slugs) || slugs.length === 0) {
    throw new Error('Select at least one score from the content manifest.');
  }
  const seen = new Set();
  return slugs.map((slug) => {
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`Invalid score slug: ${String(slug)}`);
    }
    if (seen.has(slug)) throw new Error(`Duplicate score slug: ${slug}`);
    seen.add(slug);
    const matches = manifest.filter((entry) => entry.slug === slug);
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous score slug: ${slug}`);
    const piece = matches[0];
    safeRelativePath(piece.files?.score);
    if (!piece.source?.license || !piece.source?.licenseUrl) {
      throw new Error(`Missing source license metadata: ${slug}`);
    }
    return piece;
  });
}

export async function assertOutputAbsent(out) {
  try {
    await lstat(out);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Output already exists; choose a new --out directory: ${out}`);
}

/** Same-length metadata replacement preserves the PDF's byte offsets and stream data. */
export function normalizePdfMetadata(bytes) {
  const original = bytes.toString('latin1');
  const normalized = original.replace(
    /\/(CreationDate|ModDate) \(D:\d{14}\+00'00'\)/g,
    (_match, key) => `/${key} (${CONFIG.pdfMetadataDate})`,
  );
  return Buffer.from(normalized, 'latin1');
}

export function validateManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.renderer?.name !== 'Verovio' ||
    !manifest.renderer.version ||
    !manifest.renderer.options ||
    !manifest.config ||
    !Array.isArray(manifest.pieces) ||
    manifest.pieces.length === 0
  ) {
    throw new Error('Invalid fixture manifest header.');
  }
  const ids = new Set();
  const paths = new Set();
  const claimPath = (value) => {
    safeRelativePath(value);
    if (paths.has(value)) throw new Error(`Duplicate fixture path: ${value}`);
    paths.add(value);
  };
  for (const piece of manifest.pieces) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(piece.id ?? '') ||
      ids.has(piece.id) ||
      !piece.title ||
      !/^[a-f0-9]{64}$/.test(piece.sha256 ?? '') ||
      !piece.source?.license ||
      !piece.source?.licenseUrl ||
      !Array.isArray(piece.pages) ||
      piece.pages.length === 0
    ) {
      throw new Error('Invalid fixture piece.');
    }
    ids.add(piece.id);
    claimPath(piece.reference);
    if (piece.pdf !== undefined) claimPath(piece.pdf);
    piece.pages.forEach((page, i) => {
      if (page.page !== i + 1) throw new Error('Fixture pages must be contiguous and one-based.');
      claimPath(page.svg);
      for (const variant of Object.keys(CONFIG.variants)) claimPath(page.images?.[variant]);
    });
  }
  return manifest;
}

// Runs in Chromium. Image decoding, rasterization, and degradation use only browser APIs.
async function rasterize({ svg, width, height, variants }) {
  const image = new Image();
  image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  await image.decode();
  const results = {};
  for (const variant of Object.keys(variants)) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    if (variant === 'skew') {
      const radians = (variants.skew.degrees * Math.PI) / 180;
      const fit = Math.min(
        width / (width * Math.cos(radians) + height * Math.sin(radians)),
        height / (height * Math.cos(radians) + width * Math.sin(radians)),
      );
      ctx.translate(width / 2, height / 2);
      ctx.rotate(radians);
      ctx.scale(fit, fit);
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
    } else {
      ctx.drawImage(image, 0, 0, width, height);
      if (variant === 'shadow') {
        const gradient = ctx.createLinearGradient(0, 0, width * variants.shadow.fadeAcrossWidth, 0);
        gradient.addColorStop(0, `rgba(0,0,0,${variants.shadow.edgeOpacity})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
      if (variant === 'lowContrast') {
        const pixels = ctx.getImageData(0, 0, width, height);
        const { black, white } = variants.lowContrast;
        for (let i = 0; i < pixels.data.length; i += 4) {
          for (let channel = 0; channel < 3; channel++) {
            pixels.data[i + channel] = Math.round(
              black + (pixels.data[i + channel] * (white - black)) / 255,
            );
          }
        }
        ctx.putImageData(pixels, 0, 0);
      }
    }
    results[variant] = canvas.toDataURL('image/png').split(',')[1];
  }
  return results;
}

export async function prepareFixtures({ out, slugs = DEFAULT_SLUGS, repoRoot = REPO_ROOT } = {}) {
  repoRoot = path.resolve(repoRoot);
  out = path.resolve(out ?? path.join(repoRoot, 'research/omr/results/fixtures'));
  await assertOutputAbsent(out);
  const contentRoot = path.join(repoRoot, 'content');
  const contentManifest = JSON.parse(
    await readFile(path.join(contentRoot, 'manifest.json'), 'utf8'),
  );
  const selected = selectPieces(contentManifest, slugs);
  const inputs = await Promise.all(
    selected.map(async (piece) => {
      const filename = path.join(contentRoot, piece.files.score);
      return { piece, bytes: await readFile(filename) };
    }),
  );
  const appRequire = createRequire(path.join(repoRoot, 'apps/web/package.json'));
  const [{ default: createVerovioModule }, { VerovioToolkit }, playwright] = await Promise.all([
    import(pathToFileURL(appRequire.resolve('verovio/wasm')).href),
    import(pathToFileURL(appRequire.resolve('verovio/esm')).href),
    import(pathToFileURL(appRequire.resolve('@playwright/test')).href),
  ]);
  const { chromium } = playwright.default ?? playwright;
  const module = await createVerovioModule();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await mkdir(path.dirname(out), { recursive: true });
    // Atomic claim: a concurrent run cannot overwrite an existing fixture set.
    await mkdir(out);
    const manifest = {
      schemaVersion: 1,
      renderer: { name: 'Verovio', version: '', options: RENDER_OPTIONS },
      config: { ...CONFIG, rasterizer: { name: 'Chromium', version: browser.version() } },
      pieces: [],
    };
    for (const { piece, bytes } of inputs) {
      const pieceDir = path.join(out, piece.slug);
      await mkdir(pieceDir);
      const reference = `${piece.slug}/reference.musicxml`;
      await writeFile(path.join(out, reference), bytes, { flag: 'wx' });
      const renderXml = await page.evaluate((xml) => {
        const document = new DOMParser().parseFromString(xml, 'application/xml');
        if (document.getElementsByTagName('parsererror').length)
          throw new Error('Invalid MusicXML');
        for (const element of [...document.getElementsByTagNameNS('*', 'fingering')])
          element.remove();
        return new XMLSerializer().serializeToString(document);
      }, bytes.toString('utf8'));
      const toolkit = new VerovioToolkit(module);
      let svgs;
      try {
        toolkit.setOptions(RENDER_OPTIONS);
        manifest.renderer.version = toolkit.getVersion();
        if (!toolkit.loadData(renderXml)) throw new Error(`Verovio failed to load ${piece.slug}`);
        const count = toolkit.getPageCount();
        if (!Number.isInteger(count) || count < 1) throw new Error(`No pages for ${piece.slug}`);
        svgs = Array.from({ length: count }, (_, i) => toolkit.renderToSVG(i + 1));
      } finally {
        toolkit.destroy();
      }
      const result = {
        id: piece.slug,
        title: piece.title,
        reference,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        source: piece.source,
        pdf: `${piece.slug}/clean.pdf`,
        pages: [],
      };
      for (const [index, rawSvg] of svgs.entries()) {
        // Verovio marks SVG overflow visible; raster images and PDF pages clip at the
        // viewBox. Include any grace notes/slurs extending beyond that box in the scan.
        const measured = await page.evaluate(async (rawSvg) => {
          const holder = document.createElement('div');
          holder.innerHTML = rawSvg;
          document.body.appendChild(holder);
          try {
            await document.fonts.ready;
            const root = holder.querySelector('svg');
            const view = root.viewBox.baseVal;
            const ink = root.getBBox();
            const plain = (box) => ({ x: box.x, y: box.y, width: box.width, height: box.height });
            return { page: plain(view), ink: plain(ink) };
          } finally {
            holder.remove();
          }
        }, rawSvg);
        const fitted = expandPageViewBox(measured.page, measured.ink);
        const svg = rawSvg.replace(
          /\bviewBox="[^"]*"/,
          `viewBox="${fitted.x} ${fitted.y} ${fitted.width} ${fitted.height}"`,
        );
        svgs[index] = svg;
        const stem = `${piece.slug}/page-${String(index + 1).padStart(3, '0')}`;
        await writeFile(path.join(out, `${stem}.svg`), svg, { flag: 'wx' });
        const images = await page.evaluate(rasterize, {
          svg,
          width: CONFIG.page.widthPx,
          height: CONFIG.page.heightPx,
          variants: CONFIG.variants,
        });
        const imagePaths = {};
        for (const [variant, base64] of Object.entries(images)) {
          imagePaths[variant] = `${stem}-${variant}.png`;
          await writeFile(path.join(out, imagePaths[variant]), Buffer.from(base64, 'base64'), {
            flag: 'wx',
          });
        }
        result.pages.push({ page: index + 1, svg: `${stem}.svg`, images: imagePaths });
      }
      await page.setContent(
        `<html><head><style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:white}.sheet{width:210mm;height:297mm;break-after:page;overflow:hidden}.sheet:last-child{break-after:auto}.sheet>svg{width:100%;height:100%;display:block}</style></head><body>${svgs.map((svg) => `<div class="sheet">${svg}</div>`).join('')}</body></html>`,
      );
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      await writeFile(path.join(out, result.pdf), normalizePdfMetadata(pdf), { flag: 'wx' });
      manifest.pieces.push(result);
    }
    validateManifest(manifest);
    await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
    });
    return manifest;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareFixtures(parseArgs(process.argv.slice(2)))
    .then((manifest) => {
      console.log(
        `Prepared ${manifest.pieces.length} scores, ${manifest.pieces.reduce((sum, piece) => sum + piece.pages.length, 0)} pages.`,
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
