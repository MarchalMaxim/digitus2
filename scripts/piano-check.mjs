// The real-piano check (issue 252), outside CI: does Chrome actually hear the piano, with no hands
// on the keys? A Chrome of its own (the WinRT MIDI backend on, as the Bluetooth flag sets it)
// sends the piano a MIDI Identity Request (F0 7E 7F 06 01 F7) every 2 s; a reply on the piano's
// input proves that input receives. Most digital pianos answer it (the owner's Roland GO:PIANO in
// about 25 ms); one that never answers cannot be judged this way, and the check says so.
//
//   node scripts/piano-check.mjs            probes three times: "hears" or "deaf"
//   node scripts/piano-check.mjs --cycle    the reproduction: turn the piano off and on while it
//                                           runs (7 minutes at most). It waits for the piano to
//                                           stop answering, for Windows' Bluetooth link to come
//                                           back, then probes this same browser (deaf, on Windows
//                                           Chrome), a new requestMIDIAccess in the same page
//                                           (still deaf), and a new browser process (hears).
//
// Windows only for --cycle (the link is read from Windows' Bluetooth device). The browser's own
// probe page holds MIDI the whole time, as the app does.
import { execFileSync } from 'node:child_process';
import { chromium } from '../apps/web/node_modules/@playwright/test/index.mjs';

const cycle = process.argv.includes('--cycle');
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><title>piano check</title><script>
let access = null;
let replies = 0;
async function open() {
  access = await navigator.requestMIDIAccess({ sysex: true });
  for (const i of access.inputs.values())
    i.onmidimessage = (e) => { if (e.data[0] === 0xf0) replies++; };
  return {
    inputs: [...access.inputs.values()].map((i) => i.name),
    outputs: [...access.outputs.values()].map((o) => o.name),
  };
}
async function probe() {
  const before = replies;
  for (const o of access.outputs.values()) o.send([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
  await new Promise((r) => setTimeout(r, 600));
  return replies > before;
}
window.check = { open, probe };
</script>`;

/** A browser of its own on a page that holds MIDI. */
async function launch() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--enable-features=MidiManagerWinrt'],
  });
  const context = await browser.newContext();
  await context.grantPermissions(['midi', 'midi-sysex']);
  await context.route('https://piano.check/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: PAGE }),
  );
  const page = await context.newPage();
  await page.goto('https://piano.check/');
  const ports = await page.evaluate(() => window.check.open());
  const probe = () => page.evaluate(() => window.check.probe());
  const probes = async (n = 3) => {
    let heard = 0;
    for (let i = 0; i < n; i++) if (await probe()) heard++;
    return heard > 0 ? 'hears' : 'deaf';
  };
  return { browser, page, ports, probe, probes };
}

/** Whether Windows has the Bluetooth link to the piano up, by the device's friendly name. */
function linkUp(portName) {
  const name = portName.replace(/\s*\(bluetooth\s+midi\s+in\)\s*$/i, '').replace(/'/g, "''");
  const script = `$d = Get-PnpDevice -Class Bluetooth | Where-Object { $_.FriendlyName -eq '${name}' } | Select-Object -First 1; if ($d) { (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15').Data } else { 'none' }`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  }).trim();
  return out === 'True';
}

const first = await launch();
log('inputs', JSON.stringify(first.ports.inputs), 'outputs', JSON.stringify(first.ports.outputs));
if (first.ports.inputs.length === 0 || first.ports.outputs.length === 0) {
  log('no piano input and output: nothing to check');
  await first.browser.close();
  process.exit(1);
}
const now = await first.probes();
log('this browser', now);
if (!cycle) {
  if (now === 'deaf')
    log('deaf, or a piano that does not answer an identity request: play a key to tell them apart');
  await first.browser.close();
  process.exit(now === 'hears' ? 0 : 1);
}

const port = first.ports.inputs[0];
log('turn the piano off, count to five, and turn it on again');
let off = false;
let backAt = 0;
while (Date.now() - t0 < 7 * 60 * 1000) {
  const alive = await first.probe();
  if (!alive && !off) {
    off = true;
    log('the piano stopped answering');
  }
  if (off && alive) {
    log('this browser hears it again by itself');
    break;
  }
  if (off && backAt === 0 && linkUp(port)) {
    backAt = Date.now();
    log("Windows' Bluetooth link is back; 10 s more");
  }
  if (backAt > 0 && Date.now() - backAt > 10_000) {
    log('this browser, 10 s after the link came back:', await first.probes());
    await first.page.evaluate(() => window.check.open());
    log('a new requestMIDIAccess in the same page:', await first.probes());
    const fresh = await launch();
    log('a new browser process:', await fresh.probes());
    log('this browser after that:', await first.probes());
    await fresh.browser.close();
    break;
  }
  await sleep(1000);
}
await first.browser.close();
