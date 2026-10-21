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
});
