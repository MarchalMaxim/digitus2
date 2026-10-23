import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  parseMusicXml,
  RECOMMENDED_WEIGHT_SET,
  type Score,
  solveFingering,
} from '@digitus2/engine';
import { Window } from 'happy-dom';
import type { VerovioToolkit } from 'verovio/esm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verovioOptions } from '../score/render/options.js';
import { joinScanPages, stavesWerePaired } from './join.js';

// The join reads and writes XML through the browser's parser; in Node happy-dom supplies it.
const dom = new Window();
Object.assign(globalThis, { DOMParser: dom.DOMParser, XMLSerializer: dom.XMLSerializer });

/**
 * Issue 159: a page the recogniser reads as a treble part and a bass part must join to the same
 * score as the same page read as one piano part, whichever pages of the scan are split. The
 * library's piano pieces are cut into two to four pseudo-pages, a page is optionally rewritten the
 * way homr writes a split page, and every pattern runs through the join, the strict import, the
 * solver and Verovio. The relations (layout normalisation changes no note); the reference is the
 * join of the same pages unpaired, and each is an equality:
 *   1. the same staves, notes and rests in every measure, the same number of systems and braces,
 *      and the same totals of clefs, key signatures and time signatures drawn;
 *   2. the same notes (pitch, onset, duration, hand);
 *   3. the same finger on every note.
 * The rule covers a scan in which an unpaired page shows the piano, or a split page opens with a
 * G clef over an F clef; a scan outside it stays two parts, and that is asserted too. The pieces
 * are written without part abbreviations, as homr writes them: the join's piano part has none, so
 * a reference that kept "Pno." would break its lines earlier than the joined file.
 */

// ---------------------------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------------------------

// Vitest runs from apps/web.
const content = join(process.cwd(), '../../content');
interface Entry {
  slug: string;
  benchmarkSet?: string | null;
  files: { score: string };
}
const manifest = JSON.parse(readFileSync(join(content, 'manifest.json'), 'utf8')) as Entry[];
// A missing field means core30; later pieces carry null.
const core30 = manifest.filter(
  (entry) => (entry.benchmarkSet === undefined ? 'core30' : entry.benchmarkSet) === 'core30',
);
const library = (slug: string) => {
  const entry = manifest.find((e) => e.slug === slug);
  if (!entry) throw new Error(`no piece ${slug} in the library`);
  const bytes = readFileSync(join(content, entry.files.score));
  return (bytes[0] === 0x1f ? gunzipSync(bytes) : bytes)
    .toString('utf8')
    .replace(/^<\?xml[^>]*\?>/, '<?xml version="1.0" encoding="utf-8"?>')
    .replace(/<!DOCTYPE[^>]*>/, '');
};

/** Core pieces for two hands, chosen for what they exercise; each is cut in 2 to 4 pages. */
const PIECES = [
  'twinkle-twinkle-little-star', // the plain case
  'scarborough-fair', // chords
  'mozart-minuet-f-major-k2', // triplets
  'bach-invention-no1-bwv-772', // two voices in a hand, ties across bars
  'burgmuller-op100-no1-la-candeur', // chords, ties, repeats and endings in the source
  'chopin-waltz-op69-no2', // chords, ties
  'chopin-prelude-op28-no7', // forward, ties, a grace note
  'bach-prelude-c-major-bwv-846', // a clef change, many ties
  'satie-gymnopedie-no1', // chords in both hands, ties
  'schumann-op68-no1-melody', // forward, chords
];

// ---------------------------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------------------------

/** A piece or a page the split rewriter cannot express, with the reason. */
class Skip extends Error {}
const skip = (reason: string): never => {
  throw new Skip(reason);
};
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml');
const serialize = (doc: Document | Element) => new XMLSerializer().serializeToString(doc);
const kids = (el: Element, tag?: string) =>
  Array.from(el.children).filter((child) => !tag || child.tagName === tag);
const textOf = (el: Element, tag: string) => kids(el, tag)[0]?.textContent?.trim();
const make = (doc: Document, tag: string, text?: string) => {
  const el = doc.createElementNS(doc.documentElement.namespaceURI, tag);
  if (text !== undefined) el.textContent = text;
  return el;
};
/** An element from its XML, in `doc`. */
const fragment = (doc: Document, xml: string) => doc.importNode(parse(xml).documentElement, true);
const NOT_CONTENT = ['note', 'backup', 'forward'];

/**
 * What homr never writes, taken out of the piece before it is cut: directions, sounds, harmonies,
 * barlines (and with them repeats and endings, which the join refuses), beams, slurs, lyrics and
 * part abbreviations.
 * Both versions of every page lack them, so the relations compare the same notation.
 */
function homrLike(xml: string): Document {
  const doc = parse(xml);
  if (doc.querySelector('transpose, staff-details, measure-style, part-group'))
    skip('transposition or staff details');
  for (const tag of [
    'direction',
    'sound',
    'harmony',
    'print',
    'barline',
    'figured-bass',
    'part-abbreviation',
  ])
    doc.querySelectorAll(tag).forEach((el) => el.remove());
  doc.querySelectorAll('lyric, beam, notations > slur').forEach((el) => el.remove());
  const parts = kids(doc.documentElement, 'part');
  if (parts.length !== 1) skip(`${parts.length} parts`);
  const first = kids(parts[0]!, 'measure')[0]!;
  if (first.querySelector('attributes > staves')?.textContent?.trim() !== '2')
    skip('not a two-staff part');
  for (const attributes of Array.from(doc.querySelectorAll('attributes')))
    for (const child of kids(attributes)) {
      if (!['divisions', 'key', 'time', 'staves', 'clef'].includes(child.tagName))
        skip(`<${child.tagName}> in the attributes`);
    }
  return doc;
}

// ---------------------------------------------------------------------------------------------
// Cutting a piece into pages
// ---------------------------------------------------------------------------------------------

/** The opening attributes a measure carries: those before its first note, backup or forward. */
function opening(measure: Element): Element[] {
  const found: Element[] = [];
  for (const el of kids(measure)) {
    if (NOT_CONTENT.includes(el.tagName)) break;
    if (el.tagName === 'attributes') found.push(el);
  }
  return found;
}

/** The bars after which no tie is open: a page may end there without cutting a tie in two. */
function tieFreeBars(measures: Element[]): number[] {
  const open = new Set<string>();
  const free: number[] = [];
  measures.forEach((measure, index) => {
    for (const note of kids(measure, 'note')) {
      const pitch = kids(note, 'pitch')[0];
      if (!pitch) continue;
      const key = `${textOf(note, 'staff')} ${textOf(pitch, 'step')}${textOf(pitch, 'alter')} ${textOf(pitch, 'octave')}`;
      for (const tie of kids(note, 'tie')) {
        if (tie.getAttribute('type') === 'start') open.add(key);
        else open.delete(key);
      }
    }
    if (!open.size && index < measures.length - 1) free.push(index + 1);
  });
  return free;
}

/**
 * Up to `count` pages of whole measures, each a valid partwise document: the signatures in force
 * where the page starts are copied into its first measure, ahead of that measure's own attributes.
 * A page ends where no tie is open (a tie cut in two cannot be imported strictly), as near the
 * even split as the piece allows, so a piece with few such places comes out in fewer pages.
 */
function cut(doc: Document, count: number): string[] {
  const measures = kids(kids(doc.documentElement, 'part')[0]!, 'measure');
  if (count < 2 || measures.length < 2) skip('fewer than two measures');
  const free = tieFreeBars(measures);
  const starts = [0];
  for (let k = 1; k < count; k++) {
    const ideal = Math.round((k * measures.length) / count);
    const next = free
      .filter((bar) => bar > starts.at(-1)!)
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b)[0];
    if (next !== undefined) starts.push(next);
  }
  if (starts.length < 2) skip('no place to cut that leaves no tie open');
  starts.sort((a, b) => a - b);
  const state = new Map<string, string>();
  const xml = serialize(doc);
  const out: string[] = [];
  starts.forEach((from, page) => {
    const to = starts[page + 1] ?? measures.length;
    // The signatures in force where the page starts.
    measures.slice(0, from).forEach((measure) => {
      for (const attributes of Array.from(measure.querySelectorAll('attributes')))
        for (const child of kids(attributes)) {
          const key =
            child.tagName === 'clef' ? `clef${child.getAttribute('number') ?? '1'}` : child.tagName;
          state.set(key, serialize(child));
        }
    });
    const copy = parse(xml);
    const own = kids(kids(copy.documentElement, 'part')[0]!, 'measure');
    own.forEach((m, i) => {
      if (i < from || i >= to) m.remove();
    });
    if (from > 0) {
      const target = own[from]!;
      const declared = new Set(
        opening(target).flatMap((a) =>
          kids(a).map((c) =>
            c.tagName === 'clef' ? `clef${c.getAttribute('number') ?? '1'}` : c.tagName,
          ),
        ),
      );
      const wanted = ['divisions', 'key', 'time', 'staves', 'clef1', 'clef2'].filter(
        (key) => !declared.has(key),
      );
      const synthetic = make(copy, 'attributes');
      for (const key of wanted) synthetic.appendChild(fragment(copy, state.get(key)!));
      target.insertBefore(synthetic, target.firstChild);
    }
    out.push(serialize(copy));
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rewriting a page the way homr writes a split one
// ---------------------------------------------------------------------------------------------

const VOICE_ENTRY = (id: string, channel: number) =>
  `<score-part id="${id}"><part-name>Voice</part-name><score-instrument id="${id}-I1"><instrument-name>Voice</instrument-name><instrument-sound>voice</instrument-sound></score-instrument><midi-instrument id="${id}-I1"><midi-channel>${channel}</midi-channel><midi-program>54</midi-program><volume>100</volume><pan>0</pan></midi-instrument></score-part>`;

interface Event {
  seq: number;
  part: 0 | 1;
  /** The source voice, or 0 for a clef change that goes with the part's first voice. */
  voice: number;
  start: number;
  duration: number;
  chord: boolean;
  el: Element;
}

/**
 * Two one-staff parts named Voice (ids P1 and P2): divisions and time in the first `<attributes>`,
 * clef and key in a second; the staff-1 notes in P1, the staff-2 notes in P2, each part's voices
 * numbered from 1; backups and forwards computed per part; `<staff>1</staff>` on every note, as
 * homr writes it; chords and ties kept.
 */
function toSplit(xml: string): string {
  const doc = parse(xml);
  const root = doc.documentElement;
  const part = kids(root, 'part')[0]!;
  const measures = kids(part, 'measure');
  const divisionValues = new Set(
    Array.from(doc.querySelectorAll('divisions')).map((d) => d.textContent?.trim()),
  );
  if (divisionValues.size !== 1) skip('divisions change within a page');

  const staffOf = (note: Element) => Number(textOf(note, 'staff') ?? 1);
  const events: Event[][] = [];
  const voices: [Set<number>, Set<number>] = [new Set(), new Set()];
  let seq = 0;
  for (const measure of measures) {
    const here: Event[] = [];
    const staffOfVoice = new Map<number, number>();
    let pos = 0;
    let lastStart = 0;
    let began = false;
    for (const el of kids(measure)) {
      const duration = Number(textOf(el, 'duration') ?? 0);
      if (el.tagName === 'note') {
        began = true;
        const staff = staffOf(el);
        if (staff !== 1 && staff !== 2) skip(`a note on staff ${staff}`);
        const voice = Number(textOf(el, 'voice') ?? 1);
        if ((staffOfVoice.get(voice) ?? staff) !== staff) skip('a voice on both staves');
        staffOfVoice.set(voice, staff);
        const chord = kids(el, 'chord').length > 0;
        const start = chord ? lastStart : pos;
        if (!chord) {
          lastStart = pos;
          pos += duration;
        }
        const index = (staff - 1) as 0 | 1;
        voices[index].add(voice);
        here.push({ seq: seq++, part: index, voice, start, duration, chord, el });
      } else if (el.tagName === 'backup') {
        began = true;
        pos -= duration;
      } else if (el.tagName === 'forward') {
        began = true;
        pos += duration;
      } else if (el.tagName === 'attributes' && began) {
        for (const child of kids(el)) {
          if (child.tagName !== 'clef') skip(`a mid-bar ${child.tagName} change`);
          const index = (Number(child.getAttribute('number') ?? 1) - 1) as 0 | 1;
          here.push({
            seq: seq++,
            part: index,
            voice: 0,
            start: pos,
            duration: 0,
            chord: false,
            el: child,
          });
        }
      } else if (el.tagName !== 'attributes') {
        skip(`<${el.tagName}> in a bar`);
      }
    }
    events.push(here);
  }
  // Each part's voices, numbered from 1 in the order of the source's numbers.
  const renumber = voices.map(
    (set) => new Map([...set].sort((a, b) => a - b).map((voice, i) => [voice, i + 1])),
  );

  const parts = [0, 1].map((index) => {
    const out = make(doc, 'part');
    out.setAttribute('id', `P${index + 1}`);
    return out;
  });
  measures.forEach((measure, m) => {
    const bars = parts.map(() => {
      const bar = make(doc, 'measure');
      for (const name of ['number', 'implicit'])
        if (measure.hasAttribute(name)) bar.setAttribute(name, measure.getAttribute(name)!);
      return bar;
    });
    // The signatures at the start of the bar, for the part that reads them.
    const heads = opening(measure);
    const pick = (tag: string) => heads.flatMap((a) => kids(a, tag));
    const clefs = pick('clef');
    bars.forEach((bar, index) => {
      const copies = (els: Element[]) => els.map((el) => doc.importNode(el, true) as Element);
      const clef = clefs.filter((c) => Number(c.getAttribute('number') ?? 1) === index + 1);
      clef.forEach((c) => c.setAttribute('number', '1'));
      if (m === 0) {
        const one = make(doc, 'attributes');
        copies([...pick('divisions'), ...pick('time')]).forEach((el) => one.appendChild(el));
        const two = make(doc, 'attributes');
        copies([...clef, ...pick('key')]).forEach((el) => two.appendChild(el));
        bar.append(one, two);
      } else if (pick('key').length || pick('time').length || clef.length) {
        const only = make(doc, 'attributes');
        copies([...pick('key'), ...pick('time'), ...clef]).forEach((el) => only.appendChild(el));
        bar.appendChild(only);
      }
      const mine = events[m]!.filter((e) => e.part === index);
      const order = [...renumber[index]!.keys()].sort((a, b) => a - b);
      let cursor = 0;
      order.forEach((voice, v) => {
        const own = mine
          .filter((e) => e.voice === voice || (e.voice === 0 && v === 0))
          .sort((a, b) => a.start - b.start || a.seq - b.seq);
        cursor = 0;
        for (const event of own) {
          if (!event.chord && event.start > cursor) {
            const forward = make(doc, 'forward');
            forward.appendChild(make(doc, 'duration', String(event.start - cursor)));
            bar.appendChild(forward);
            cursor = event.start;
          }
          const el = doc.importNode(event.el, true) as Element;
          if (el.tagName === 'note') {
            // homr writes <staff>1</staff> in both parts, as the page's only staff.
            kids(el, 'staff').forEach((s) => (s.textContent = '1'));
            kids(el, 'voice').forEach((s) => (s.textContent = String(renumber[index]!.get(voice))));
          } else {
            el.setAttribute('number', '1');
            const wrap = make(doc, 'attributes');
            wrap.appendChild(el);
            bar.appendChild(wrap);
            continue;
          }
          bar.appendChild(el);
          if (!event.chord) cursor = event.start + event.duration;
        }
        if (v < order.length - 1 && cursor > 0) {
          const backup = make(doc, 'backup');
          backup.appendChild(make(doc, 'duration', String(cursor)));
          bar.appendChild(backup);
        }
      });
      parts[index]!.appendChild(bar);
    });
  });
  const list = kids(root, 'part-list')[0]!;
  while (list.firstChild) list.removeChild(list.firstChild);
  list.appendChild(fragment(doc, VOICE_ENTRY('P1', 1)));
  list.appendChild(fragment(doc, VOICE_ENTRY('P2', 2)));
  part.remove();
  for (const next of parts) root.appendChild(next);
  return serialize(doc);
}

// ---------------------------------------------------------------------------------------------
// What a join comes to
// ---------------------------------------------------------------------------------------------

/** The sign of the clef a split page's part opens with: the last one before its first note. */
function openingSign(part: Element): string | undefined {
  let sign: string | undefined;
  for (const attributes of opening(kids(part, 'measure')[0]!))
    for (const clef of kids(attributes, 'clef')) sign = textOf(clef, 'sign') ?? sign;
  return sign;
}
/** The signs a split page's two parts open with, upper then lower. */
function openingSigns(split: string): [string | undefined, string | undefined] {
  const [upper, lower] = kids(parse(split).documentElement, 'part');
  return [openingSign(upper!), openingSign(lower!)];
}
/** Whether a split page opens with a G clef over an F clef, the join's sign of a piano. */
function opensGrand(split: string): boolean {
  const [upper, lower] = openingSigns(split);
  return upper === 'G' && lower === 'F';
}

interface Case {
  name: string;
  /** The pages of the scan, as indices into the piece's pages. */
  pages: number[];
  /** Whether each of them is written as a split page. */
  split: boolean[];
  single: boolean;
}
/** The split patterns of a piece: all split, split first, each other page split, each page alone. */
function cases(count: number): Case[] {
  const all = Array.from({ length: count }, (_, i) => i);
  const mask = (split: number[]) => all.map((i) => split.includes(i));
  return [
    { name: 'all split', pages: all, split: mask(all), single: false },
    { name: 'split first', pages: all, split: mask([0]), single: false },
    ...all.slice(1).map((i) => ({
      name: `only page ${i + 1} split`,
      pages: all,
      split: mask([i]),
      single: false,
    })),
    ...all.map((i) => ({ name: `page ${i + 1} alone`, pages: [i], split: [true], single: true })),
  ];
}

interface Layout {
  /** The `g.staff` count, and the notes and rests in each staff, of every measure, in order. */
  staves: number[];
  notes: number[][];
  rests: number[][];
  systems: number;
  braces: number;
  clefs: number;
  keys: number;
  meters: number;
}
/** What Verovio draws for `xml`, over all its pages. */
function draw(tk: VerovioToolkit, xml: string): Layout {
  expect(tk.loadData(xml), 'Verovio loads the joined file').toBeTruthy();
  const layout: Layout = {
    staves: [],
    notes: [],
    rests: [],
    systems: 0,
    braces: 0,
    clefs: 0,
    keys: 0,
    meters: 0,
  };
  const last = (list: number[]) => list.length - 1;
  for (let page = 1; page <= tk.getPageCount(); page++) {
    for (const [, name] of tk
      .renderToSVG(page)
      .matchAll(
        /<g\b[^>]*\bclass="(measure|staff|system|grpSym|note|rest|clef|keySig|meterSig)"/g,
      )) {
      if (name === 'measure') {
        layout.staves.push(0);
        layout.notes.push([]);
        layout.rests.push([]);
      } else if (name === 'staff') {
        layout.staves[last(layout.staves)]!++;
        layout.notes.at(-1)!.push(0);
        layout.rests.at(-1)!.push(0);
      } else if (name === 'note') layout.notes.at(-1)![layout.notes.at(-1)!.length - 1]!++;
      else if (name === 'rest') layout.rests.at(-1)![layout.rests.at(-1)!.length - 1]!++;
      else if (name === 'system') {
        layout.systems++;
      } else if (name === 'grpSym') layout.braces++;
      else if (name === 'clef') layout.clefs++;
      else if (name === 'keySig') layout.keys++;
      else layout.meters++;
    }
  }
  return layout;
}

const noteList = (score: Score) =>
  score.notes.map((n) => `${n.onsetTick}+${n.offsetTick - n.onsetTick} ${n.midi}${n.hand}`).sort();

/** Every note's finger, keyed by what the relation names: onset, pitch and hand. */
function fingers(xml: string) {
  const { score } = parseMusicXml(xml, { preserveNotation: true });
  const { assignment } = solveFingering(score, {
    profile: 'medium',
    weightSet: RECOMMENDED_WEIGHT_SET,
  });
  const byKey = new Map<string, number[]>();
  for (const n of score.notes) {
    const key = `${n.onsetTick} ${n.midi}${n.hand}`;
    byKey.set(key, [...(byKey.get(key) ?? []), assignment[n.id]!.finger].sort());
  }
  return { score, fingers: [...byKey].map(([key, list]) => `${key}=${list.join()}`).sort() };
}

// ---------------------------------------------------------------------------------------------

interface Outside {
  where: string;
  /** The clef signs each split page of the case opens with, upper over lower. */
  signs: string[];
}

/**
 * The oracle for the pieces `from` up to (not including) `to` of PIECES, one file's share. Each
 * file starts its own toolkit, so vitest runs the shares in parallel. `expectedOutside` is the
 * exact list of cases outside the rule, as "slug, case": a new entry is a conscious change.
 */
export function defineOracle(from: number, to: number, expectedOutside: string[]) {
  let tk: VerovioToolkit;
  beforeAll(async () => {
    const { default: createVerovioModule } = await import('verovio/wasm');
    const { VerovioToolkit } = await import('verovio/esm');
    tk = new VerovioToolkit(await createVerovioModule());
    tk.setOptions(verovioOptions(900));
  }, 60_000);
  afterAll(() => tk.destroy());

  const share = PIECES.slice(from, to).map((slug, i) => [slug, 2 + ((from + i) % 3)] as const);
  const report: string[] = [];
  const skipped: string[] = [];
  const outside: Outside[] = [];
  let joins = 0;
  const started = performance.now();

  describe(`issue 159: a split page joins to the score its paired page would (${share.map(([slug]) => slug).join(', ')})`, () => {
    it('takes its pieces from the core 30', () => {
      const core = new Set(core30.map((entry) => entry.slug));
      expect(share.map(([slug]) => slug).filter((slug) => !core.has(slug))).toEqual([]);
    });

    it.each(share)(
      '%s, cut in %i pages',
      async (slug, count) => {
        const t0 = performance.now();
        let pages: string[];
        let splits: string[];
        try {
          pages = cut(homrLike(library(slug)), count);
          splits = pages.map(toSplit);
        } catch (error) {
          if (!(error instanceof Skip)) throw error;
          skipped.push(`${slug}: ${error.message}`);
          return;
        }
        const grand = splits.map(opensGrand);
        /** The join of the unpaired pages: the relations' reference, itself the piece. */
        const references = new Map<string, ReturnType<typeof fingers> & { layout: Layout }>();
        const reference = (indices: number[]) => {
          const key = indices.join();
          if (!references.has(key)) {
            const xml = joinScanPages(indices.map((i) => pages[i]!));
            const layout = draw(tk, xml);
            expect(
              layout.staves.every((n) => n === 2),
              `${slug} ${key}: the reference is a grand staff`,
            ).toBe(true);
            expect(layout.braces, `${slug} ${key}: the reference has a brace per system`).toBe(
              layout.systems,
            );
            references.set(key, { ...fingers(xml), layout });
          }
          return references.get(key)!;
        };
        // The cut and the join lose nothing: the notes are those of the whole piece.
        const base = reference(pages.map((_, i) => i));
        const whole = parseMusicXml(serialize(homrLike(library(slug))), {
          preserveNotation: true,
        });
        expect(noteList(base.score), `${slug}: the pages joined are the piece`).toEqual(
          noteList(whole.score),
        );
        const list = cases(pages.length);
        for (const found of list) {
          const where = `${slug}, ${found.name}`;
          const joined = joinScanPages(
            found.pages.map((page, i) => (found.split[i] ? splits[page]! : pages[page]!)),
          );
          joins++;
          const layout = draw(tk, joined);
          // The rule: a page that shows the piano, or a split page that opens G over F.
          const rule =
            found.split.includes(false) ||
            found.pages.some((page, i) => found.split[i] && grand[page]);
          if (!rule) {
            expect((joined.match(/<part[ >]/g) ?? []).length, `${where}: stays two parts`).toBe(2);
            expect(stavesWerePaired(joined), `${where}: says nothing of pairing`).toBe(false);
            expect(layout.braces, `${where}: draws no brace`).toBe(0);
            outside.push({
              where,
              signs: found.pages.map((page) => openingSigns(splits[page]!).join('/')),
            });
            continue;
          }
          const expected = reference(found.pages);
          expect(layout.staves, `${where}: staves per measure`).toEqual(expected.layout.staves);
          expect(layout.notes, `${where}: notes drawn in each staff of each measure`).toEqual(
            expected.layout.notes,
          );
          expect(layout.rests, `${where}: rests drawn in each staff of each measure`).toEqual(
            expected.layout.rests,
          );
          expect(layout.systems, `${where}: systems`).toBe(expected.layout.systems);
          expect(layout.braces, `${where}: braces`).toBe(expected.layout.braces);
          expect(layout.clefs, `${where}: clefs drawn`).toBe(expected.layout.clefs);
          expect(layout.keys, `${where}: key signatures drawn`).toBe(expected.layout.keys);
          expect(layout.meters, `${where}: time signatures drawn`).toBe(expected.layout.meters);
          const result = fingers(joined);
          expect(noteList(result.score), `${where}: notes`).toEqual(noteList(expected.score));
          expect(result.fingers, `${where}: fingers`).toEqual(expected.fingers);
        }
        report.push(
          `${slug.padEnd(34)} ${String(pages.length).padStart(2)} pages ${String(list.length).padStart(2)} joins ${String(base.score.notes.length).padStart(4)} notes ${String(base.layout.systems).padStart(3)} systems ${Math.round(performance.now() - t0)} ms`,
        );
      },
      180_000,
    );

    it('ran every case, and the cases outside the rule are the ones expected', () => {
      console.log(
        `metamorphic layout oracle: ${report.length} pieces, ${joins} joins, ` +
          `${outside.length} outside the rule, ${skipped.length} skipped, ` +
          `${Math.round(performance.now() - started)} ms in all\n` +
          `${report.join('\n')}\n` +
          `${outside.map((o) => `outside the rule: ${o.where}: opens ${o.signs.join(' ')}`).join('\n')}\n` +
          `${skipped.map((s) => `skipped ${s}`).join('\n')}`,
      );
      expect(skipped, 'pieces the rewriter could not express').toEqual([]);
      expect(report.length).toBe(share.length);
      expect(joins).toBeGreaterThanOrEqual(5 * share.length);
      // Outside the rule only because no page opens with a G clef over an F clef.
      for (const o of outside) {
        for (const pair of o.signs) {
          const [upper, lower] = pair.split('/');
          expect(upper === 'G' && lower === 'F', `${o.where}: opens ${pair}`).toBe(false);
        }
      }
      expect(
        outside.map((o) => o.where),
        'cases outside the rule',
      ).toEqual(expectedOutside);
    });
  });
}

// ---------------------------------------------------------------------------------------------
// The e2e fixtures
// ---------------------------------------------------------------------------------------------

export function defineOwnerPages() {
  describe('issue 159: the owner pages written the way homr writes a split page', () => {
    const folder = new URL('../../fixtures/scan/', import.meta.url);
    const declaration = "<?xml version='1.0' encoding='utf-8'?>";
    it.each([1, 2])('owner page %i is committed in split form', (n) => {
      const doc = parse(
        readFileSync(new URL(`owner-page-${n}.musicxml`, folder), 'utf8')
          .replace(/^<\?xml[^>]*\?>/, '<?xml version="1.0" encoding="utf-8"?>')
          .trim(),
      );
      // Barline-less single-part pages only: what the rewriter cannot express is taken out first.
      doc.querySelectorAll('print, part-symbol').forEach((el) => el.remove());
      const body = toSplit(serialize(doc)).replace(/^<\?xml[^>]*\?>/, '');
      const expected = `${declaration}\n${body}\n`;
      const target = new URL(`owner-page-${n}-split.musicxml`, folder);
      if (process.env.WRITE_SPLIT_FIXTURES) {
        writeFileSync(target, expected);
        return;
      }
      expect(readFileSync(target, 'utf8').replace(/\r\n/g, '\n')).toBe(expected);
    });
  });
}
