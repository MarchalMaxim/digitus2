import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  importOtherHand,
  loadOtherHand,
  otherHandLoaded,
  resetOtherHandForTests,
} from './otherHandLoad.js';

// The other hand's code (issues 184 and 231) is one lazy chunk, fetched when the reader's switch is
// on: the library page's first load must never hold it (the 150 KB budget, check-bundle-size.mjs).

beforeEach(() => resetOtherHandForTests());
afterEach(() => resetOtherHandForTests());

describe('the loader', () => {
  it('has nothing until it is asked, then the Accompanist and the choice of the notes', async () => {
    expect(otherHandLoaded()).toBeNull();
    const code = await loadOtherHand();
    expect(typeof code.Accompanist).toBe('function');
    expect(typeof code.accompanimentNotes).toBe('function');
    expect(typeof code.accompanimentStretches).toBe('function');
    expect(typeof code.playEventsFor).toBe('function'); // the transport's note list
    expect(otherHandLoaded()).toBe(code);
  });

  it('fetches the chunk once', async () => {
    const chunk = vi.fn(importOtherHand);
    resetOtherHandForTests(chunk);
    const [a, b] = await Promise.all([loadOtherHand(), loadOtherHand()]);
    expect(a).toBe(b);
    expect(await loadOtherHand()).toBe(a);
    expect(chunk).toHaveBeenCalledTimes(1);
  });

  it('is asked again after a failed fetch, and holds nothing meanwhile', async () => {
    const chunk = vi.fn(importOtherHand).mockRejectedValueOnce(new Error('offline') as never);
    resetOtherHandForTests(chunk);
    await expect(loadOtherHand()).rejects.toThrow('offline');
    expect(otherHandLoaded()).toBeNull();
    const code = await loadOtherHand();
    expect(otherHandLoaded()).toBe(code);
    expect(chunk).toHaveBeenCalledTimes(2);
  });
});

describe('the lazy chunk', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = join(here, '..');

  /** Every source file of the app but the tests. */
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  /**
   * The modules a file imports or re-exports statically (not `import()`), as written. A type-only
   * import is erased by the build, so it holds nothing in a chunk.
   */
  function staticImports(source: string): string[] {
    const found: string[] = [];
    const from = /^\s*(?:import|export)\s+(?!type\s)[^;'"]*?from\s*['"]([^'"]+)['"]/gm;
    for (const m of source.matchAll(from)) found.push(m[1]!);
    for (const m of source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) found.push(m[1]!);
    return found;
  }

  it('is reached through import() alone: the loader names it and nothing else does', () => {
    const loader = readFileSync(join(here, 'otherHandLoad.ts'), 'utf8');
    expect(loader).toMatch(/import\(\s*['"]\.\/otherHand\.js['"]\s*\)/);
    expect(staticImports(loader)).toEqual([]);
  });

  it("is held by no static import of the app: the Accompanist, the notes, the transport's note list", () => {
    // Who may import each statically: the chunk's own entry gathers the first two, and the
    // note list stays with the transport (itself a lazy chunk), which hands it to the walk.
    const holders: Record<string, string[]> = {
      [join(src, 'audio', 'accompanist')]: [join(src, 'score', 'otherHand.ts')],
      [join(src, 'score', 'accompaniment')]: [join(src, 'score', 'otherHand.ts')],
      [join(src, 'audio', 'events')]: [join(src, 'audio', 'transport.ts')],
      [join(src, 'score', 'otherHand')]: [],
    };
    const offenders: string[] = [];
    for (const file of sources(src)) {
      for (const spec of staticImports(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(file), spec).replace(/\.js$/, '');
        if (holders[target] && !holders[target].includes(file)) {
          offenders.push(`${relative(src, file)} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('knows a static import when it sees one', () => {
    expect(
      staticImports(`import { a } from '../audio/accompanist.js';
export * from './otherHand.js';`),
    ).toEqual(['../audio/accompanist.js', './otherHand.js']);
    expect(staticImports(`import './accompaniment.js';`)).toEqual(['./accompaniment.js']);
    expect(
      staticImports(`import {
  a,
  b,
} from './accompaniment.js';`),
    ).toEqual(['./accompaniment.js']);
    expect(staticImports(`const m = await import('./otherHand.js');`)).toEqual([]);
    expect(staticImports(`import type * as X from './otherHand.js';`)).toEqual([]);
    expect(staticImports(`import type { A } from '../audio/accompanist.js';`)).toEqual([]);
  });
});
