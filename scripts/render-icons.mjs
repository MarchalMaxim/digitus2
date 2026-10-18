#!/usr/bin/env node
// Renders apps/web/public/icon.svg to the PNG icons the web app manifest and iOS need. Run it from
// the repository root after changing the SVG, and commit the PNGs: node scripts/render-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const svg = readFileSync(new URL('../apps/web/public/icon.svg', import.meta.url), 'utf8');
const out = new URL('../apps/web/public/icons/', import.meta.url);
const SIZES = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 };

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, size] of Object.entries(SIZES)) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    writeFileSync(new URL(name, out), await page.screenshot({ type: 'png' }));
    await page.close();
    process.stdout.write(`${name} ${size} x ${size}\n`);
  }
} finally {
  await browser.close();
}
