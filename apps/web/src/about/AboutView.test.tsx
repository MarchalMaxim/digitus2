import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ManifestModule from '../library/manifest.js';
import {
  isShareAlike,
  licenseLabel,
  pieceBySlug,
  pieces,
  requiresCredit,
  type LibraryPiece,
} from '../library/manifest.js';
import { AboutView, countWord } from './AboutView.js';

// Testing Library only cleans up automatically when vitest globals are on; they are off here.
afterEach(cleanup);

const PREFIX = 'The pieces use public-domain or Creative Commons editions.';

/** The sentence above the table, as the plan words it for a given library. */
function expectedCredit(library: readonly LibraryPiece[]): string {
  const sa = library.filter(isShareAlike).length;
  const by = library.filter((p) => requiresCredit(p) && !isShareAlike(p)).length;
  return by === 0
    ? `${PREFIX} ${countWord(sa)} engravings are shared under CC BY-SA and are credited here and on their score pages.`
    : `${PREFIX} ${countWord(sa)} engravings are shared under CC BY-SA and ${countWord(by).toLowerCase()} under CC BY; all are credited here and on their score pages.`;
}

function creditParagraph(): HTMLElement {
  return screen.getByText(/^The pieces use public-domain or Creative Commons editions\./);
}

describe('AboutView', () => {
  it('credits Verovio, smplr and the samples, and lists every piece with its licence', () => {
    render(<AboutView />);
    expect(screen.getByRole('link', { name: /Verovio/ })).toHaveAttribute(
      'href',
      'https://github.com/rism-digital/verovio',
    );
    expect(screen.getByText(/LGPL-3\.0-or-later/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /smplr/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'midi-file' })).toHaveAttribute(
      'href',
      'https://github.com/carter-thaxton/midi-file',
    );
    expect(screen.getAllByRole('row')).toHaveLength(pieces.length + 1);
    // One licence link per Creative Commons piece, labelled by its licence.
    const creativeCommons = pieces.filter((p) => p.source.license.startsWith('CC-'));
    const labels = new Set(creativeCommons.map((p) => licenseLabel(p.source.license)));
    let links = 0;
    for (const label of labels) links += screen.getAllByRole('link', { name: label }).length;
    expect(links).toBe(creativeCommons.length);
    for (const p of pieces.filter((p) => p.source.typesetter))
      expect(screen.getAllByText(new RegExp(p.source.typesetter!)).length).toBeGreaterThan(0);
  });
  it('states how many engravings are shared under CC BY-SA and CC BY', () => {
    render(<AboutView />);
    expect(creditParagraph().textContent).toBe(expectedCredit(pieces));
  });
  it('names the CC BY engravings in that sentence once the library has one', async () => {
    // The mock adds one more CC BY engraving to the library (which has the Swedish polska), so the
    // plural CC BY form and one licence link per CC BY piece are pinned whatever the library holds.
    const k2 = pieceBySlug('mozart-minuet-f-major-k2')!;
    const ccBy: LibraryPiece = {
      ...k2,
      slug: 'cc-by-engraving',
      source: {
        ...k2.source,
        license: 'CC-BY-2.5',
        licenseUrl: 'https://creativecommons.org/licenses/by/2.5/',
      },
    };
    const library = [...pieces, ccBy];
    vi.resetModules();
    vi.doMock('../library/manifest.js', async (importOriginal) => ({
      ...(await importOriginal<typeof ManifestModule>()),
      pieces: library,
    }));
    try {
      const { AboutView: WithCcBy } = await import('./AboutView.js');
      render(<WithCcBy />);
      expect(creditParagraph().textContent).toBe(expectedCredit(library));
      expect(creditParagraph().textContent).toContain(' under CC BY; all are credited here');
      const links = screen.getAllByRole('link', { name: 'CC BY 2.5' });
      expect(links).toHaveLength(library.filter((p) => p.source.license === 'CC-BY-2.5').length);
      for (const l of links)
        expect(l).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/2.5/');
    } finally {
      vi.doUnmock('../library/manifest.js');
      vi.resetModules();
    }
  });
  it('has exactly one red element, the back button', () => {
    const { container } = render(<AboutView />);
    const red = container.querySelectorAll('.is-red');
    expect(red).toHaveLength(1);
    expect(red[0]).toHaveTextContent('Back to the library');
  });
});
