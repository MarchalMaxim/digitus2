import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore, type PieceSource } from '../app/store.js';
import { loadPiece } from '../library/manifest.js';
import { SidePanel } from './SidePanel.js';
import type { ScoreDocument } from './useScoreDocument.js';

beforeEach(() =>
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
    libraryScrollY: 0,
  }),
);
// Testing Library only cleans up automatically when vitest globals are on; they are off here.
afterEach(cleanup);

const LEGEND =
  'Finger numbers: 1 is the thumb and 5 the little finger, in both hands. The upper staff is the right hand, the lower staff the left.';
const TIMING = 'Fingered in 6 ms · laid out in 63 ms';
const WARNING = 'note 95: duplicate of note 91 (same hand, onset and pitch), dropped';

const MELODY = 'schumann-op68-no1-melody';
/** The full entry of the melody piece (its source and file paths), loaded once for the module. */
const melody = (await loadPiece(MELODY))!;
const source: PieceSource = { kind: 'library', slug: MELODY };

/** A ready document as the panel sees it: the timings and one reader warning. */
function readyDoc(over: Partial<ScoreDocument> = {}): ScoreDocument {
  return {
    status: 'ready',
    error: null,
    score: null,
    xml: null,
    assignment: null,
    editorial: null,
    pages: [],
    solveMs: 6.2,
    renderMs: 63.4,
    title: 'Melody',
    composer: 'Robert Schumann',
    warnings: [WARNING],
    digitChanges: null,
    midiInfo: null,
    splitMidi: null,
    ...over,
  };
}

function renderPanel(doc: ScoreDocument, legendAbove = false, piece = melody) {
  return render(
    <SidePanel
      doc={doc}
      source={source}
      piece={piece}
      setSplitMidi={vi.fn()}
      legendAbove={legendAbove}
    />,
  );
}

// Polish plan Task 5 (review S4 and S7): the panel says what the numbers mean, and the developer
// text (the solve and layout timings, the reader's warnings) waits behind a closed "Details".
describe('SidePanel', () => {
  it('explains the finger numbers with the same line as the score header', () => {
    renderPanel(readyDoc());
    const legend = screen.getByText(LEGEND);
    expect(legend.tagName).toBe('P');
    expect(legend).toBeVisible();
    expect(legend).toHaveClass('finger-legend');
    expect(legend).not.toHaveClass('wide-only');
  });

  // UI batch review: the legend shows once. While the header has it too (before the first Play),
  // the panel's copy is the one beside the score from 900 px only (`wide-only`, base.css), where
  // the header's is hidden; below 900 px the header's copy is the one.
  it('keeps its legend to wide screens while the header shows one', () => {
    renderPanel(readyDoc(), true);
    expect(screen.getByText(LEGEND)).toHaveClass('finger-legend', 'wide-only');
  });

  it('keeps the timings and the reader warnings behind a closed Details toggle', async () => {
    renderPanel(readyDoc());
    const summary = screen.getByText('Details', { exact: true });
    expect(summary.tagName).toBe('SUMMARY');
    const details = summary.closest('details')!;
    expect(details).not.toHaveAttribute('open');
    const timing = screen.getByText(TIMING);
    const warning = screen.getByText(WARNING);
    expect(details).toContainElement(timing);
    expect(details).toContainElement(warning);
    expect(timing).not.toBeVisible();
    expect(warning).not.toBeVisible();
    // Nothing else in the panel is hidden by it: the hand size, the toggle, export and print.
    expect(details).not.toContainElement(screen.getByLabelText('Hand size'));
    expect(screen.getByLabelText('Hand size')).toBeVisible();
    expect(screen.getByLabelText("Show the editor's fingering")).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export MusicXML' })).toBeVisible();

    await userEvent.click(summary);
    expect(details).toHaveAttribute('open');
    expect(timing).toBeVisible();
    expect(warning).toBeVisible();

    await userEvent.click(summary);
    expect(details).not.toHaveAttribute('open');
    expect(timing).not.toBeVisible();
  });

  it('shows no Details toggle while there is nothing to put behind it', () => {
    renderPanel(readyDoc({ status: 'loading', solveMs: null, renderMs: null, warnings: [] }));
    expect(screen.queryByText('Details', { exact: true })).toBeNull();
    expect(screen.getByText(LEGEND)).toBeVisible();
  });

  it('has no red element', () => {
    const { container } = renderPanel(readyDoc());
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });
});

// Polish plan Task 6, review S9: Large, Medium, Small and Child had no word on what they change,
// and a beginner may read "Child" as an easier mode.
describe('the hand size', () => {
  const HELP =
    'Hand size changes the stretches the fingering allows. Choose child or small for small hands.';

  it('says what it changes, in a line under the select that describes it', async () => {
    const { container } = renderPanel(readyDoc());
    const select = screen.getByLabelText('Hand size');
    const help = screen.getByText(HELP, { exact: true });
    expect(help.tagName).toBe('P');
    expect(help).toBeVisible();
    expect(select).toHaveAccessibleDescription(HELP);
    // Right after the select, not behind the Details disclosure.
    expect(select.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(help.closest('details')).toBeNull();
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
    // The select still works.
    await userEvent.selectOptions(select, 'child');
    expect(useAppStore.getState().settings.handSize).toBe('child');
    expect(select).toHaveAccessibleDescription(HELP);
  });
});

// UI batch, spec section 12: one level name everywhere, with no number before it. Shelves spec
// section 3: the name is the tier the manifest's grade maps to.
describe('the level', () => {
  it('reads the level name alone', () => {
    renderPanel(readyDoc()); // Melody, a grade-2 piece
    expect(screen.getByText('Level').nextElementSibling).toHaveTextContent(/^Easy$/);
  });
  it.each([
    [1, 'Easy'],
    [3, 'Medium'],
    [2, 'Easy'],
    [4, 'Harder'],
    [5, 'Challenging'],
    [6, 'Challenging'],
  ] as const)('shows grade %i as %s', (level, name) => {
    renderPanel(readyDoc(), false, { ...melody, level });
    expect(screen.getByText('Level').nextElementSibling).toHaveTextContent(`${name}`);
  });
});
