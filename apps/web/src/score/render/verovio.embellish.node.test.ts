// @vitest-environment node
import { readFileSync } from 'node:fs';
import { guardEmbellishment, injectFingerings, RECOMMENDED_WEIGHT_SET } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { injectNoteIds } from './injectIds.js';
import { verovioOptions } from './options.js';

const xml = readFileSync(
  new URL('../../../../../content/scores/twinkle-twinkle-little-star.musicxml', import.meta.url),
  'utf8',
);

describe('verovio render contract, embellished', () => {
  it('keeps the ids of the original and the added notes, and tags every digit', async () => {
    const { offered } = guardEmbellishment(xml, { weightSet: RECOMMENDED_WEIGHT_SET });
    if (!offered) throw new Error('Twinkle was not offered');
    const { score, assignments } = offered;
    expect(score.notes).toHaveLength(70);
    const { default: createVerovioModule } = await import('verovio/wasm');
    const { VerovioToolkit } = await import('verovio/esm');
    const tk = new VerovioToolkit(await createVerovioModule());
    const fingered = injectNoteIds(injectFingerings(offered.xml, score, assignments.medium), score);
    tk.setOptions(verovioOptions(900));
    expect(tk.loadData(fingered)).toBeTruthy();
    const svg = Array.from({ length: tk.getPageCount() }, (_, i) => tk.renderToSVG(i + 1)).join('');
    const noteIds = new Set(
      [...svg.matchAll(/<g\b[^>]*>/g)]
        .map((m) => m[0])
        .filter((g) => /\bclass="note"/.test(g))
        .map((g) => /\bid="([^"]+)"/.exec(g)?.[1]),
    );
    for (const n of score.notes) expect(noteIds.has(n.id), n.id).toBe(true);
    const fings = svg.match(/<g\b[^>]*class="fing"[^>]*>[\s\S]*?<\/text>/g) ?? [];
    expect(fings).toHaveLength(70);
    const ids = new Set(score.notes.map((n) => n.id));
    const tagged = new Set<string>();
    for (const g of fings) {
      const id = /data-startid="#([^"]+)"/.exec(g)?.[1] ?? '';
      expect(ids.has(id), id).toBe(true);
      expect(/>\s*(\d)\s*</.exec(g)?.[1], id).toBe(String(assignments.medium[id]?.finger));
      tagged.add(id);
    }
    expect(tagged.size).toBe(70);
    tk.destroy();
  });
});
