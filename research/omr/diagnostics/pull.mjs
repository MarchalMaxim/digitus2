// Copies the scans the scan service kept for an opted-in device (issue 233) into the validation
// cases (docs/scanning.md "Validation cases"), one case folder per kept scan:
//
//   node research/omr/diagnostics/pull.mjs
//
// It reads gs://digitus2-scan-cases/cases/ of the project digitus2-scan with the owner's own
// gcloud login, and only reads: it creates no bucket, grant or setting. Without gcloud, or while the
// bucket does not exist, it says so and copies nothing. The objects are untrusted data: only page
// photos, recognitions and JSON with plain names are copied, under names this script writes.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUCKET = 'digitus2-scan-cases';
export const PROJECT = 'digitus2-scan';
const PREFIX = `gs://${BUCKET}/cases/`;
/** Which cases were pulled, and how many objects each had then: in the store, beside them. */
const STATE = '.pulled.json';

/** The objects of `gcloud storage ls --long --recursive`: size, creation time and URL. */
export function parseListing(text) {
  const objects = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d{4}-\d{2}-\d{2}T\S+)\s+(gs:\/\/\S+)\s*$/.exec(line);
    if (match) objects.push({ size: Number(match[1]), created: match[2], url: match[3] });
  }
  return objects;
}

/**
 * The kept scans: the objects under `cases/`, by the scan that holds them (`<scan id>` or
 * `<date>/<scan id>`). The service keeps each stretch in which it remembered a scan in a folder of
 * its own under the scan's (`<date>/<scan id>/<visit>`, the visit a time in milliseconds), so the
 * visits of one scan are one case: each object carries its visit (0 without one). A scan is a case
 * when it holds a page photo.
 */
export function groupCases(objects, prefix = PREFIX) {
  const cases = new Map();
  for (const object of objects) {
    if (!object.url.startsWith(prefix)) continue;
    const path = object.url.slice(prefix.length);
    const cut = path.lastIndexOf('/');
    if (cut <= 0) continue;
    let key = path.slice(0, cut);
    let visit = 0;
    const visited = /^(.+)\/(\d{10,})$/.exec(key);
    if (visited) {
      key = visited[1];
      visit = Number(visited[2]);
    }
    const list = cases.get(key) ?? [];
    list.push({ ...object, name: path.slice(cut + 1), visit });
    cases.set(key, list);
  }
  for (const [key, list] of cases) if (!list.some((o) => PHOTO.test(o.name))) cases.delete(key);
  return cases;
}

// What the Keeper writes for each page it receives, numbered in the order the pages arrive within a
// visit (a page sent again is a new number): its photo, its recognition, the recognizer's record
// and the page's own id. And each review the device reported, `review-<k>.json`.
const PHOTO = /^page-(\d+)\.(jpe?g|png)$/i;
const RECOGNITION = /^page-(\d+)-recognized\.musicxml$/i;
const RECORD = /^page-(\d+)-recognition\.json$/i;
const ID = /^page-(\d+)-id\.json$/i;
const REVIEW = /^review-(\d+)\.json$/;
const SCAN_ID = /^[0-9a-f]{32}$/;

/** The JSON object of a small kept file, or undefined. */
function readJson(read, url) {
  try {
    const value = JSON.parse(read(url) ?? '');
    return typeof value === 'object' && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What one kept scan becomes, or why it cannot become a case it can be trusted to be. `read` gives
 * the text of a small kept object (a page's id, a review), or undefined.
 *
 * The Keeper numbers pages as they arrive, not by their place in the scan. When the latest review
 * lists the scan's pages (`pages`, their ids in the order on screen) and the Keeper kept each
 * page's id, each page is the last photo kept with its id: a page photographed again, removed or
 * moved in the review is told from one added. Otherwise the photos say it: a photo sent again is
 * the same bytes (Retry failed pages, Scan again), so a photo of a size already seen takes the
 * place of that page and a new photo starts the next page; a new photo after the first review is a
 * page photographed again or added there, which cannot be told apart, and the scan is not made a
 * case. Neither is a scan whose page has no recognition in its last attempt, since the case could
 * not replay it.
 * @returns {{ files: { url: string, name: string }[], pages: number, problem?: string }}
 */
export function planCase(objects, read = () => undefined) {
  const arrivals = new Map();
  const reviews = [];
  for (const object of objects) {
    for (const [pattern, kind] of [
      [PHOTO, 'photo'],
      [RECOGNITION, 'recognition'],
      [RECORD, 'record'],
      [ID, 'id'],
    ]) {
      const match = pattern.exec(object.name);
      if (!match) continue;
      const at = `${object.visit ?? 0}:${match[1]}`;
      const arrival = arrivals.get(at) ?? { visit: object.visit ?? 0, number: Number(match[1]) };
      arrival[kind] = object;
      arrivals.set(at, arrival);
    }
    const review = REVIEW.exec(object.name);
    if (review) reviews.push({ object, visit: object.visit ?? 0, k: Number(review[1]) });
  }
  const order = (a, b) => a.visit - b.visit || a.number - b.number;
  const taken = [...arrivals.values()].filter((arrival) => arrival.photo).sort(order);
  reviews.sort((a, b) => a.visit - b.visit || a.k - b.k);
  const latest = reviews.at(-1);
  const listed = latest && readJson(read, latest.object.url)?.pages;
  let pages = [];
  if (Array.isArray(listed) && listed.length && listed.every((id) => SCAN_ID.test(id))) {
    for (const arrival of taken) {
      const id = arrival.id && readJson(read, arrival.id.url)?.page;
      if (typeof id === 'string') arrival.page = id;
    }
    for (const [index, id] of listed.entries()) {
      const last = taken.filter((arrival) => arrival.page === id).at(-1);
      if (!last)
        return { files: [], pages: listed.length, problem: `page ${index + 1} was not kept` };
      pages.push(last);
    }
  } else {
    const reviewed = reviews.map((r) => r.object.created).sort()[0];
    for (const arrival of taken) {
      const again = pages.findIndex((page) => page.photo.size === arrival.photo.size);
      if (again >= 0) pages[again] = arrival;
      else if (reviewed && arrival.photo.created > reviewed)
        return {
          files: [],
          pages: pages.length,
          problem: `photo ${arrival.number} is new since the review (a page taken again or added), and which page it is is not known`,
        };
      else pages.push(arrival);
    }
  }
  const files = [];
  for (const [index, page] of pages.entries()) {
    const n = index + 1;
    if (!page.recognition)
      return { files: [], pages: pages.length, problem: `page ${n} has no recognition` };
    const ext = PHOTO.exec(page.photo.name)[2].toLowerCase().replace('jpeg', 'jpg');
    files.push({ url: page.photo.url, name: `page-${n}.${ext}` });
    files.push({ url: page.recognition.url, name: `page-${n}-recognized.musicxml` });
    if (page.record) files.push({ url: page.record.url, name: `page-${n}-recognition.json` });
  }
  // Numbered again across the visits, in the order they were reported: the highest is the latest.
  for (const [index, review] of reviews.entries())
    files.push({ url: review.object.url, name: `review-${index + 1}.json` });
  return { files, pages: pages.length };
}

/** A kept scan's folder name: `kept-<date>-<first 8 of its id>`. */
export function caseFolder(key, objects) {
  const date =
    /(?:^|\/)(\d{4}-\d{2}-\d{2})(?:\/|$)/.exec(key)?.[1] ??
    objects.map((o) => o.created.slice(0, 10)).sort()[0];
  const id = (key.split('/').pop() ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'scan';
  return `kept-${date}-${id}`;
}

/** gcloud is gcloud.cmd on Windows, which only a shell starts; every argument is quoted for it. */
function gcloud(args) {
  const shell = process.platform === 'win32';
  const quoted = shell ? args.map((a) => `"${a}"`) : args;
  return spawnSync('gcloud', [...quoted, '--project', PROJECT], { encoding: 'utf8', shell });
}

function readState(store) {
  try {
    return JSON.parse(readFileSync(join(store, STATE), 'utf8'));
  } catch {
    return {};
  }
}

export function main() {
  const store = process.env.DIGITUS2_SCAN_CASES;
  if (!store) {
    console.error('Set DIGITUS2_SCAN_CASES to the folder of the scan cases (docs/scanning.md).');
    return 2;
  }
  const version = spawnSync('gcloud', ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  if (version.status !== 0) {
    console.log('gcloud is not installed here: nothing pulled (docs/scan-service.md).');
    return 0;
  }
  const listing = gcloud(['storage', 'ls', '--long', '--recursive', PREFIX]);
  if (listing.status !== 0) {
    const said = `${listing.stderr}${listing.stdout}`.trim();
    if (/not found|404|matched no objects|One or more URLs matched no objects/i.test(said)) {
      console.log(`No kept scans: ${PREFIX} is not there yet. Nothing pulled.`);
      return 0;
    }
    console.error(`gcloud could not list ${PREFIX}:\n${said}`);
    return 1;
  }
  mkdirSync(store, { recursive: true });
  const state = readState(store);
  const cases = groupCases(parseListing(listing.stdout));
  let pulled = 0;
  for (const [key, objects] of cases) {
    const before = state[key];
    if (before && before.objects === objects.length) continue;
    const plan = planCase(objects, (url) => {
      const cat = gcloud(['storage', 'cat', url]);
      return cat.status === 0 ? cat.stdout : undefined;
    });
    if (plan.problem) {
      console.log(`skipped   ${key}: ${plan.problem}`);
      continue;
    }
    const name = before?.folder ?? caseFolder(key, objects);
    const partial = join(store, `.pull-${process.pid}-${name}`);
    rmSync(partial, { recursive: true, force: true });
    mkdirSync(partial, { recursive: true });
    let failed = '';
    for (const file of plan.files) {
      const copy = gcloud(['storage', 'cp', file.url, join(partial, file.name)]);
      if (copy.status !== 0) {
        failed = `${file.url}: ${copy.stderr.trim()}`;
        break;
      }
    }
    if (failed) {
      rmSync(partial, { recursive: true, force: true });
      console.error(`failed    ${key}: ${failed}`);
      continue;
    }
    // A scan pulled before and kept again since (scanned again) replaces its folder.
    rmSync(join(store, name), { recursive: true, force: true });
    renameSync(partial, join(store, name));
    state[key] = { objects: objects.length, folder: name };
    writeFileSync(join(store, STATE), JSON.stringify(state, null, 2) + '\n');
    console.log(`pulled    ${key} -> ${join(store, name)} (${plan.pages} pages)`);
    pulled++;
  }
  console.log(pulled ? `${pulled} kept scans pulled.` : 'No new kept scans.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main();
