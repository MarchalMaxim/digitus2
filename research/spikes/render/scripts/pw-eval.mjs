// THROWAWAY dev helper: open a spike page headless, wait for window.__bench, print logs/results.
//   node scripts/pw-eval.mjs "http://localhost:4316/osmd.html?fx=short" ["js expression to evaluate after load"] [screenshot.png]
import { chromium } from 'playwright';
const [url, expr, shot] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { const t = m.text(); if (!t.startsWith('[vite]')) console.log('[console.' + m.type() + ']', t.length > 3000 ? t.slice(0, 3000) + '...' : t); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__bench && window.__bench.status !== 'running', null, { timeout: Number(process.env.PW_TIMEOUT ?? 110000) });
const bench = await page.evaluate(() => window.__bench);
if (bench.status === 'error') console.log('BENCH ERROR', bench.error);
if (process.env.PW_RESULTS) console.log('RESULTS', JSON.stringify(bench.results, null, 1));
if (expr) console.log('EVAL', JSON.stringify(await page.evaluate(expr), null, 1));
if (shot) await page.screenshot({ path: shot, fullPage: false });
await browser.close();
