import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(resolve('apps/web/package.json'));
const { default: createModule } = await import(pathToFileURL(require.resolve('verovio/wasm')).href);
const { VerovioToolkit } = await import(pathToFileURL(require.resolve('verovio/esm')).href);
const { chromium } = require('@playwright/test');
const toolkit = new VerovioToolkit(await createModule());
toolkit.setOptions({
  scale: 50,
  pageWidth: 2100,
  pageHeight: 2970,
  header: 'none',
  footer: 'none',
  breaks: 'auto',
  svgViewBox: true,
});
if (!toolkit.loadData(await readFile(process.argv[2], 'utf8'))) throw Error('render load failed');
const svg = toolkit.renderToSVG(1);
await writeFile(process.argv[2] + '.svg', svg);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  await page.setContent('<html><body style="margin:0;background:white">' + svg + '</body></html>');
  await page
    .locator('svg')
    .first()
    .screenshot({ path: process.argv[2] + '.png' });
} finally {
  await browser.close();
}
console.log('pages', toolkit.getPageCount());
