import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ManifestModule from '../library/manifest.js';
import {
  isShareAlike,
  licenseLabel,
  loadPieceDetails,
  requiresCredit,
  type LibraryPiece,
} from '../library/manifest.js';
import { AboutView, countWord, isArchivePiece } from './AboutView.js';

// Testing Library only cleans up automatically when vitest globals are on; they are off here.
afterEach(cleanup);

const PREFIX = 'The pieces use public-domain or Creative Commons editions.';

/** Every piece's full entry, in manifest order. */
async function everyPiece(): Promise<LibraryPiece[]> {
  return [...(await loadPieceDetails()).values()];
}

/** The pieces the table lists: the archive pieces are counted in a sentence instead. */
async function curatedPieces(): Promise<LibraryPiece[]> {
  return (await everyPiece()).filter((p) => !isArchivePiece(p));
}

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
  it('credits Verovio, smplr and the samples, and lists every curated piece with its licence', async () => {
    const curated = await curatedPieces();
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
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(curated.length + 1));
    // One licence link per Creative Commons piece, labelled by its licence.
    const creativeCommons = curated.filter((p) => p.source.license.startsWith('CC-'));
    const labels = new Set(creativeCommons.map((p) => licenseLabel(p.source.license)));
    let links = 0;
    for (const label of labels) links += screen.getAllByRole('link', { name: label }).length;
    expect(links).toBe(creativeCommons.length);
    for (const p of curated.filter((p) => p.source.typesetter))
      expect(screen.getAllByText(new RegExp(p.source.typesetter!)).length).toBeGreaterThan(0);
  });
  it('states how many engravings are shared under CC BY-SA and CC BY', async () => {
    const curated = await curatedPieces();
    render(<AboutView />);
    await waitFor(() => expect(creditParagraph().textContent).toBe(expectedCredit(curated)));
  });
  it('counts the archive pieces in one sentence, with their licence rule', async () => {
    const archive = (await everyPiece()).filter(isArchivePiece).length;
    render(<AboutView />);
    if (archive === 0) return;
    expect(
      await screen.findByText(
        new RegExp(`${archive.toLocaleString('en-US')} more scores come from`),
      ),
    ).toHaveTextContent('public domain or CC0 as its uploader declared it');
  });
  it('names the CC BY engravings in that sentence once the library has one', async () => {
    // The mock adds one more CC BY engraving to the library (which has the Swedish polska), so the
    // plural CC BY form and one licence link per CC BY piece are pinned whatever the library holds.
    const details = await loadPieceDetails();
    const k2 = details.get('mozart-minuet-f-major-k2')!;
    const ccBy: LibraryPiece = {
      ...k2,
      slug: 'cc-by-engraving',
      source: {
        ...k2.source,
        license: 'CC-BY-2.5',
        licenseUrl: 'https://creativecommons.org/licenses/by/2.5/',
      },
    };
    const library = [...details.values(), ccBy];
    const curated = library.filter((p) => !isArchivePiece(p));
    vi.resetModules();
    vi.doMock('../library/manifest.js', async (importOriginal) => ({
      ...(await importOriginal<typeof ManifestModule>()),
      loadPieceDetails: async () => new Map(library.map((p) => [p.slug, p])),
    }));
    try {
      const { AboutView: WithCcBy } = await import('./AboutView.js');
      render(<WithCcBy />);
      await waitFor(() => expect(creditParagraph().textContent).toBe(expectedCredit(curated)));
      expect(creditParagraph().textContent).toContain(' under CC BY; all are credited here');
      const links = screen.getAllByRole('link', { name: 'CC BY 2.5' });
      expect(links).toHaveLength(curated.filter((p) => p.source.license === 'CC-BY-2.5').length);
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
