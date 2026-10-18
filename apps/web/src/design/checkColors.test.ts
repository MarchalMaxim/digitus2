// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { findForbiddenColors } from '../../../../scripts/check-colors.mjs';

const tokens = {
  path: 'apps/web/src/design/tokens.css',
  text: ':root { --ink: #000000; --paper: #ffffff; --gray-1: #f2f2f2; --accent: #e3000f; }',
};

describe('check-colors', () => {
  it('accepts the token file with black, white, grays and the one accent', () => {
    expect(findForbiddenColors([tokens])).toEqual([]);
  });
  it('rejects a second chromatic color in the token file', () => {
    const bad = { ...tokens, text: tokens.text + ' :root { --blue: #0000ff; }' };
    expect(findForbiddenColors([bad]).map((p) => p.reason)).toEqual([
      'second chromatic color #0000ff',
    ]);
  });
  it('rejects hex, rgb(), hsl() and named colors outside the token file', () => {
    const css = {
      path: 'apps/web/src/x.css',
      text: '.a { color: #333; } .b { background: rgb(1,2,3); } .c { border-color: red; }',
    };
    const ts = { path: 'apps/web/src/y.tsx', text: 'const s = { color: "hsl(0 0% 50%)" };' };
    expect(findForbiddenColors([css, ts]).map((p) => p.reason)).toEqual([
      'color literal #333',
      'color literal rgb(',
      'named color red',
      'color literal hsl(',
    ]);
  });
  it('rejects var(--accent) outside the token file so the only way to be red is .is-red', () => {
    const css = { path: 'apps/web/src/x.css', text: '.cursor { fill: var(--accent); }' };
    expect(findForbiddenColors([css]).map((p) => p.reason)).toEqual([
      'var(--accent) outside tokens.css',
    ]);
  });
  it('ignores ids and hashes that look like hex but are not colors', () => {
    const ts = {
      path: 'apps/web/src/z.ts',
      text: 'document.querySelector(`g.fing[data-startid="#n10"]`); location.hash = "#/piece/abc"; const c = "#e3e3e3e3e3";',
    };
    expect(findForbiddenColors([ts]).map((p) => p.reason)).toEqual(['color literal #e3e3e3e3']);
  });
  it('accepts three- and four-digit grays in the token file', () => {
    const short = { ...tokens, text: ':root { --ink-2: #333; --gray-2: #3333; }' };
    expect(findForbiddenColors([short])).toEqual([]);
  });
  it('reports the line a problem is on, counting from 1', () => {
    const css = {
      path: 'apps/web/src/x.css',
      text: ['.a { color: #000000; }', '.b { margin: 0; }', '.c { fill: rgb(1,2,3); }'].join('\n'),
    };
    const second = {
      ...tokens,
      text: [':root {', '  --ink: #000000;', '  --blue: #0000ff;', '}'].join('\n'),
    };
    expect(findForbiddenColors([css]).map((p) => p.line)).toEqual([1, 3]);
    expect(findForbiddenColors([second]).map((p) => p.line)).toEqual([3]);
  });
});
