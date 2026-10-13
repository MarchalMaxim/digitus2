import type { Score } from '@digitus2/engine';

const ID_ATTR = /\sid\s*=\s*("[^"]*"|'[^']*')/g;

/**
 * Writes `id="<note.id>"` on the `<note>` element that starts each sounding note
 * (`sourceIndices[0]`, its document-order index among all `<note>` elements), so Verovio's
 * `g.note` ids equal the engine's note ids. Any id a `<note>` already carries is removed first:
 * an exporter's own ids would otherwise point the cursor and the digit patching at the wrong
 * note, or collide with an engine id on another note. Rewriting is idempotent.
 */
export function injectNoteIds(xml: string, score: Score): string {
  const byIndex = new Map<number, string>();
  for (const n of score.notes) {
    const first = n.sourceIndices[0];
    if (first !== undefined) byIndex.set(first, n.id);
  }
  let i = -1;
  return xml.replace(
    /<note(\s[^>]*)?(\/?)>/g,
    (_m: string, attrs: string | undefined, slash: string) => {
      const id = byIndex.get(++i);
      const rest = (attrs ?? '').replace(ID_ATTR, '');
      return id === undefined ? `<note${rest}${slash}>` : `<note id="${id}"${rest}${slash}>`;
    },
  );
}
