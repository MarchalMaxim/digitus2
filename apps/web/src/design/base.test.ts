import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/design/base.css'), 'utf8');

describe('base.css', () => {
  it('reserves the scrollbar gutter on screens wider than a phone, so a page that starts or stops scrolling does not move sideways (issue #107)', () => {
    expect(css).toMatch(
      /@media screen and \(min-width: 480px\)\s*\{\s*html\s*\{\s*scrollbar-gutter:\s*stable;\s*\}\s*\}/,
    );
  });

  it('draws the switch over its input (issue 254): the native look is gone, the note moves on the tokens, and forced colours draw it in system colours', () => {
    expect(css).not.toMatch(/input\[role='switch'\]/);
    const note = /\n\.switch-note\s*\{([^}]*)\}/.exec(css)![1];
    expect(note).toMatch(/transform var\(--dur-spring\) var\(--ease-spring\)/);
    expect(note).not.toMatch(/\d+m?s\b/);
    const forced = [...css.matchAll(/@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/g)]
      .map((m) => m[1])
      .join('\n');
    expect(forced).toMatch(/\.switch-track\s*\{[^}]*stroke:\s*ButtonText/);
    expect(forced).toMatch(/\.switch-note\s*\{[^}]*fill:\s*ButtonText/);
  });
});
