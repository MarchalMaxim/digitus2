import { describe, expect, it } from 'vitest';
import { countEditorDigits, readManifest } from '../../cli/libraryPieces.js';

// `editorDigits` in content/manifest.json is the engine's own count of the digits the source
// edition prints, for every entry with an editorial fingering (54 at the time of writing). The app
// reads the field; this keeps it equal to the count the reduction's gate uses. Rewrite it with
// `pnpm --filter @digitus2/engine run editor-digits`.
describe('the editor digits in the library manifest', () => {
  it('equal the engine count for every piece with an editorial fingering', () => {
    const entries = readManifest();
    const editorial = entries.filter((e) => e.hasEditorialFingering);
    expect(editorial.length).toBeGreaterThan(0);
    const absent = editorial.filter((e) => e.editorDigits === undefined).map((e) => e.slug);
    expect(
      absent,
      'editorDigits is missing in content/manifest.json: run pnpm --filter @digitus2/engine run editor-digits',
    ).toEqual([]);
    const off: string[] = [];
    const unmatched: string[] = [];
    for (const e of editorial) {
      const c = countEditorDigits(e)!;
      if (c.digits !== e.editorDigits)
        off.push(`${e.slug}: manifest ${e.editorDigits}, count ${c.digits}`);
      if (c.unmatched > 0) unmatched.push(`${e.slug}: ${c.unmatched}`);
    }
    expect(off).toEqual([]);
    expect(unmatched).toEqual([]);
    expect(entries.filter((e) => !e.hasEditorialFingering && e.editorDigits !== undefined)).toEqual(
      [],
    );
  });
});
