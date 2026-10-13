// @vitest-environment node
import { readFileSync } from 'node:fs';
import { injectFingerings, parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { injectNoteIds } from './injectIds.js';
import { verovioOptions } from './options.js';

const xml = readFileSync(
  new URL('../../../fixtures/short-piano.musicxml', import.meta.url),
  'utf8',
);

describe('verovio render contract', () => {
  it('keeps our note ids and tags every fingering digit with its note', async () => {
    const { default: createVerovioModule } = await import('verovio/wasm');
    const { VerovioToolkit } = await import('verovio/esm');
    const tk = new VerovioToolkit(await createVerovioModule());
    const { score, editorial } = parseMusicXml(xml);
    const fingered = injectNoteIds(injectFingerings(xml, score, editorial), score);
    tk.setOptions(verovioOptions(900));
    // Verovio 6.3 returns 1 or 0 here (its cwrap is typed "number"), not a boolean.
    expect(tk.loadData(fingered)).toBeTruthy();
    const svg = Array.from({ length: tk.getPageCount() }, (_, i) => tk.renderToSVG(i + 1)).join('');
    for (const n of score.notes)
      expect(svg).toMatch(
        new RegExp(
          `<g[^>]*\\bid="${n.id}"[^>]*class="note"|<g[^>]*class="note"[^>]*\\bid="${n.id}"`,
        ),
      );
    const digits =
      svg.match(/class="fing"[^>]*data-startid="#n\d+"|data-startid="#n\d+"[^>]*class="fing"/g) ??
      [];
    expect(digits).toHaveLength(67);
    // Every digit sits under the engine id of the note it fingers (the fixture's own note ids
    // must not leak through), so the cursor and the digit patching address the right note.
    const fings = svg.match(/<g\b[^>]*class="fing"[^>]*>[\s\S]*?<\/text>/g) ?? [];
    expect(fings).toHaveLength(67);
    for (const g of fings) {
      const id = /data-startid="#([^"]+)"/.exec(g)?.[1] ?? '';
      const digit = />\s*(\d)\s*</.exec(g)?.[1];
      expect(digit, id).toBe(String(editorial[id]?.finger));
    }
    tk.destroy();
  }, 30_000);
});
