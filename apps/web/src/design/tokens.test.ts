// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The two themes' tokens (tokens.css): the dark set is written twice (for the system's
// preference and for the switch's choice), and every pair the app draws text or keys with keeps
// its contrast in both themes (WCAG 2.1: 4.5:1 for text, 3:1 for graphics).

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

type Tokens = Record<string, string>;

function declarations(block: string): Tokens {
  const out: Tokens = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+|color-scheme)\s*:\s*([^;]+);/g)) {
    out[m[1]!] = m[2]!.trim();
  }
  return out;
}

/** The body of the first rule whose selector is exactly `selector`. */
function rule(selector: string): Tokens {
  const at = css.indexOf(`${selector} {`);
  expect(at, `tokens.css has a rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return declarations(css.slice(open + 1, css.indexOf('}', open)));
}

const light = rule(':root');
const darkBySystem = rule(":root:not([data-theme='light'])");
const darkByChoice = rule(":root[data-theme='dark']");
const dark: Tokens = { ...light, ...darkByChoice };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** [foreground, background, minimum ratio, what it is] */
const PAIRS: [string, string, number, string][] = [
  ['--ink', '--paper', 7, 'text'],
  ['--score-ink', '--paper', 7, 'the engraving and its finger numbers'],
  ['--gray-3', '--paper', 4.5, 'secondary text'],
  ['--on-accent', '--accent', 4.5, 'the primary button’s label'],
  ['--accent', '--paper', 3, 'the red cursor and frame'],
  ['--key-digit', '--key-white', 4.5, 'a finger number on a white key'],
  ['--key-digit', '--key-down', 4.5, 'a finger number on a pressed key'],
  ['--key-black', '--key-white', 3, 'a black key beside a white one'],
  ['--key-white', '--key-down', 1.5, 'a pressed key beside a white one'],
];

describe('tokens.css', () => {
  it('writes the same dark set for the system’s preference and for the switch', () => {
    expect(Object.keys(darkByChoice).length).toBeGreaterThan(5);
    expect(darkBySystem).toEqual(darkByChoice);
  });

  it('says which color scheme each theme is, for the browser’s own controls and scrollbars', () => {
    expect(light['color-scheme']).toBe('light');
    expect(dark['color-scheme']).toBe('dark');
  });

  it('keeps the one red the same in both themes', () => {
    expect(dark['--accent']).toBe(light['--accent']);
  });

  it('keeps a real keyboard: white keys lighter than black keys in both themes', () => {
    for (const t of [light, dark]) {
      expect(luminance(t['--key-white']!)).toBeGreaterThan(luminance(t['--key-black']!));
    }
  });

  for (const [name, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const [fg, bg, min, what] of PAIRS) {
      it(`${name}: ${what} (${fg} on ${bg}) at least ${min}:1`, () => {
        expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it('leaves print to the light tokens: the dark sets apply on screens only', () => {
    expect(css).toMatch(/@media screen and \(prefers-color-scheme: dark\)\s*{\s*:root:not/);
    expect(css).toMatch(/@media screen\s*{\s*:root\[data-theme='dark'\]/);
  });
});
