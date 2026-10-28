// @vitest-environment node
import { readFileSync } from 'node:fs';
import { injectFingerings, parseMusicXml } from '@digitus2/engine';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { injectNoteIds } from './injectIds.js';
import { verovioOptions } from './options.js';
import { mutedElements } from './dom.js';
import { buildPageIndex, quietPlaces } from './pageIndex.js';

const xml = readFileSync(
  new URL('../../../fixtures/short-piano.musicxml', import.meta.url),
  'utf8',
);

/** The index the markup gives against the DOM the same markup builds: the oracle. */
describe('page index against Verovio pages as DOM', () => {
  it('finds the bars, the page of each note and the notes of each staff', async () => {
    const { default: createVerovioModule } = await import('verovio/wasm');
    const { VerovioToolkit } = await import('verovio/esm');
    const tk = new VerovioToolkit(await createVerovioModule());
    const { score, editorial } = parseMusicXml(xml);
    tk.setOptions({ ...verovioOptions(360), adjustPageHeight: false, pageHeight: 600 });
    expect(tk.loadData(injectNoteIds(injectFingerings(xml, score, editorial), score))).toBeTruthy();
    const count = tk.getPageCount();
    expect(count).toBeGreaterThanOrEqual(2);
    const pages = Array.from({ length: count }, (_, i) => tk.renderToSVG(i + 1));
    tk.destroy();

    const index = buildPageIndex(pages);
    expect(index.bars).toHaveLength(count);
    const staffNotes: string[][] = [];
    let first = 0;
    const seen = new Set<string>();
    pages.forEach((markup, i) => {
      expect(index.open[i]! + index.inner[i]! + '</svg>').toBe(markup);
      const document = new Window().document;
      // happy-dom drops what follows a <style> block of Verovio's; the markup has no other use for it.
      document.body.innerHTML = markup.replace(/<style[\s\S]*?<\/style>/, '');
      const measures = document.querySelectorAll('g.measure');
      expect(index.bars[i], `bars of page ${i}`).toBe(measures.length);
      expect(index.firstBar[i], `first bar of page ${i}`).toBe(first);
      first += measures.length;
      for (const note of document.querySelectorAll('g.note')) {
        expect(note.id).not.toBe('');
        expect(index.pageOfNote.get(note.id), note.id).toBe(i);
        seen.add(note.id);
      }
      for (const staff of document.querySelectorAll('g.measure > g.staff')) {
        let place = 0;
        for (let s = staff.previousElementSibling; s; s = s.previousElementSibling) {
          if (s.classList.contains('staff')) place++;
        }
        const ids = [...staff.querySelectorAll('g.note')].map((n) => n.id);
        (staffNotes[place] ??= []).push(...ids);
      }
    });
    expect(index.pageOfNote.size).toBe(seen.size);
    expect(seen.size).toBeGreaterThan(20);
    expect(index.staffNotes).toEqual(staffNotes);
    expect(staffNotes.length).toBeGreaterThanOrEqual(2);
  });

  // The whole-staff rule across pages: what a hand switch dims on each page built alone, with the
  // staff places the markup of every page says are quiet, is what it dims with every page in the DOM.
  it('dims page by page what it dims with every page in the DOM', async () => {
    const { default: createVerovioModule } = await import('verovio/wasm');
    const { VerovioToolkit } = await import('verovio/esm');
    const tk = new VerovioToolkit(await createVerovioModule());
    const { score, editorial } = parseMusicXml(xml);
    tk.setOptions({ ...verovioOptions(360), adjustPageHeight: false, pageHeight: 600 });
    expect(tk.loadData(injectNoteIds(injectFingerings(xml, score, editorial), score))).toBeTruthy();
    const pages = Array.from({ length: tk.getPageCount() }, (_, i) =>
      tk.renderToSVG(i + 1).replace(/<style[\s\S]*?<\/style>/, ''),
    );
    tk.destroy();
    expect(pages.length).toBeGreaterThanOrEqual(2);

    const all = new Window().document.body as unknown as Element;
    all.innerHTML = pages.join('');
    const index = buildPageIndex(pages);
    const key = (el: Element) =>
      `${el.getAttribute('class')}#${el.id}${el.getAttribute('data-startid') ?? ''}`;
    const fromHand = (hand: string) =>
      new Set(score.notes.filter((n) => n.hand === hand).map((n) => n.id));
    // The notes of a staff place: all of them dims the staff whole; those of its first page alone
    // do not, though that page, seen alone, has every note at the place dimmed (the hand-written
    // case in dom.test.ts shows the rests that tell them apart).
    const place = (at: number) => new Set(index.staffNotes[at]!);
    const firstPageOfPlace = (at: number) =>
      new Set(index.staffNotes[at]!.filter((id) => index.pageOfNote.get(id) === 0));
    const selections = new Map([
      ['left hand', fromHand('L')],
      ['right hand', fromHand('R')],
      ['top staff', place(0)],
      ['bottom staff', place(1)],
      ['top staff, first page only', firstPageOfPlace(0)],
      ['bottom staff, first page only', firstPageOfPlace(1)],
    ]);
    let wholeStaffSeen = false;
    for (const [name, ids] of selections) {
      expect(ids.size, name).toBeGreaterThan(0);
      const quiet = quietPlaces(index, ids);
      wholeStaffSeen ||= quiet.size > 0;
      const whole = mutedElements(all, ids).map(key).sort();
      const perPage = [...all.children]
        .flatMap((page) => mutedElements(page, ids, quiet))
        .map(key)
        .sort();
      expect(whole.length, name).toBeGreaterThan(0);
      expect(perPage, name).toEqual(whole);
    }
    expect(wholeStaffSeen).toBe(true);
  });
});
