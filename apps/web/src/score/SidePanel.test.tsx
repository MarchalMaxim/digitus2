import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore, type PieceSource } from '../app/store.js';
import { loadPiece } from '../library/manifest.js';
import { SidePanel } from './SidePanel.js';
import { services } from './useScoreDocument.js';
import type { ScoreDocument } from './useScoreDocument.js';
import * as rendererModule from './render/renderer.js';

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
    printed: null,
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
    embellish: 'none',
    embellished: false,
    shownVersion: 'plain',
    plain: null,
    setEmbellished: () => {},
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

  // The one-red rule (docs/app.md): the panel never draws the red element.
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

// Export hands the fingering on screen to the engine worker and saves the text it returns.
describe('exporting the fingering', () => {
  const score = { notes: [], measures: [] } as never;
  const complete = { xml: '<score-partwise/>', score, assignment: {} };
  const exportButton = () => screen.getByRole('button', { name: 'Export MusicXML' });

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['the source text', { xml: null }],
    ['the score', { score: null }],
    ['the fingering', { assignment: null }],
    ['all three', { xml: null, score: null, assignment: null }],
  ] as const)('is unavailable without %s', (_name, missing) => {
    renderPanel(readyDoc({ ...complete, ...missing }));
    expect(exportButton()).toBeDisabled();
  });

  it('is available once the score, its text and its fingering are all there', () => {
    renderPanel(readyDoc(complete));
    expect(exportButton()).toBeEnabled();
  });

  it('ignores a second click while the first export is still running', async () => {
    let finish: (xml: string) => void = () => undefined;
    const fingeredXml = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    vi.spyOn(services, 'engine', 'get').mockReturnValue({ fingeredXml } as never);
    renderPanel(readyDoc(complete));
    await userEvent.click(exportButton());
    expect(exportButton()).toBeDisabled();
    await userEvent.click(exportButton());
    expect(fingeredXml).toHaveBeenCalledTimes(1);
    finish('<fingered/>');
    await vi.waitFor(() => expect(exportButton()).toBeEnabled());
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  // "Add notes between" (issue #67): the export is the plain score with the plain fingering,
  // whichever version is on screen.
  it('export writes the plain document while notes are added', async () => {
    const fingeredXml = vi.fn<
      (xml: string, score: unknown, assignment: unknown) => Promise<string>
    >(() => Promise.resolve('<fingered/>'));
    vi.spyOn(services, 'engine', 'get').mockReturnValue({ fingeredXml } as never);
    const plainScore = { notes: [], measures: [] } as never;
    const plainAssignment = { n0: { finger: 1 } } as never;
    const doc = readyDoc({
      ...complete,
      // The embellished version is on screen: its own score and fingering.
      score: { notes: [], measures: [] } as never,
      assignment: { n0: { finger: 2 }, n1: { finger: 3 } } as never,
      embellish: 'offered',
      embellished: true,
      shownVersion: 'embellished',
      plain: { score: plainScore, assignment: plainAssignment },
    });
    renderPanel(doc);
    expect(exportButton()).toBeEnabled();
    await userEvent.click(exportButton());
    expect(fingeredXml).toHaveBeenCalledTimes(1);
    expect(fingeredXml).toHaveBeenCalledWith(doc.xml, plainScore, plainAssignment);
    expect(fingeredXml.mock.calls[0]![1]).not.toBe(doc.score);
    expect(fingeredXml.mock.calls[0]![2]).not.toBe(doc.assignment);
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  });

  it('is unavailable while the plain fingering is missing, whatever is on screen', () => {
    const plainScore = { notes: [], measures: [] } as never;
    renderPanel(
      readyDoc({
        ...complete,
        embellish: 'offered',
        embellished: true,
        shownVersion: 'embellished',
        plain: { score: plainScore, assignment: null },
      }),
    );
    expect(exportButton()).toBeDisabled();
  });
});

describe('paper preparation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does no paper work until Print, reports failure, and retries on the next click', async () => {
    const engrave = vi
      .fn()
      .mockRejectedValueOnce(new Error('printer layout'))
      .mockResolvedValue({ pages: ['<svg/>'], ms: 1 });
    vi.spyOn(rendererModule, 'createRenderer').mockReturnValue({
      render: engrave,
      dispose: vi.fn(),
      warmUp: vi.fn(),
    });
    vi.spyOn(services, 'engine', 'get').mockReturnValue({
      fingeredXml: vi.fn().mockResolvedValue('<score-partwise/>'),
    } as never);
    window.print = vi.fn(() => window.dispatchEvent(new Event('afterprint')));
    renderPanel(
      readyDoc({
        xml: '<score-partwise/>',
        score: { notes: [], measures: [] } as never,
        assignment: {},
      }),
    );
    const print = screen.getByRole('button', { name: /^Print$/ });
    expect(print).toBeEnabled();
    await Promise.resolve();
    expect(engrave).not.toHaveBeenCalled();
    await userEvent.click(print);
    await vi.waitFor(() => expect(useAppStore.getState().notice).not.toBeNull());
    expect(print).toBeEnabled();
    await userEvent.click(print);
    await vi.waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  });

  it('disposes pending preparation and discards its late answer when the score is left', async () => {
    let finish: (value: { pages: string[]; ms: number }) => void = () => undefined;
    const engrave = vi.fn(
      () =>
        new Promise<{ pages: string[]; ms: number }>((resolve) => {
          finish = resolve;
        }),
    );
    const dispose = vi.fn();
    vi.spyOn(rendererModule, 'createRenderer').mockReturnValue({
      render: engrave,
      dispose,
      warmUp: vi.fn(),
    });
    vi.spyOn(services, 'engine', 'get').mockReturnValue({
      fingeredXml: vi.fn().mockResolvedValue('<score-partwise/>'),
    } as never);
    const view = renderPanel(
      readyDoc({
        xml: '<score-partwise/>',
        score: { notes: [], measures: [] } as never,
        assignment: {},
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: /^Print$/ }));
    await vi.waitFor(() => expect(engrave).toHaveBeenCalledOnce());
    view.unmount();
    expect(dispose).toHaveBeenCalled();
    finish({ pages: ['<svg/>'], ms: 1 });
    await Promise.resolve();
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.querySelector('.print-score')).toBeNull();
  });
});

it('coalesces repeated print shortcuts while the requested paper is preparing', async () => {
  const engrave = vi.fn(() => new Promise<{ pages: string[]; ms: number }>(() => {}));
  vi.spyOn(rendererModule, 'createRenderer').mockReturnValue({
    render: engrave,
    dispose: vi.fn(),
    warmUp: vi.fn(),
  });
  vi.spyOn(services, 'engine', 'get').mockReturnValue({
    fingeredXml: vi.fn().mockResolvedValue('<score-partwise/>'),
  } as never);
  const view = renderPanel(
    readyDoc({
      xml: '<score-partwise/>',
      score: { notes: [], measures: [] } as never,
      assignment: {},
    }),
  );
  const first = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true });
  document.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(engrave).toHaveBeenCalledOnce());
  const again = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true });
  document.dispatchEvent(again);
  expect(again.defaultPrevented).toBe(true);
  view.unmount();
  vi.restoreAllMocks();
});

it('reuses printed pages until a new assignment invalidates them', async () => {
  const engrave = vi.fn().mockResolvedValue({ pages: ['<svg/>'], ms: 1 });
  vi.spyOn(rendererModule, 'createRenderer').mockReturnValue({
    render: engrave,
    dispose: vi.fn(),
    warmUp: vi.fn(),
  });
  vi.spyOn(services, 'engine', 'get').mockReturnValue({
    fingeredXml: vi.fn().mockResolvedValue('<score-partwise/>'),
  } as never);
  window.print = vi.fn();
  const doc = readyDoc({
    xml: '<score-partwise/>',
    score: { notes: [], measures: [] } as never,
    assignment: {},
  });
  const view = renderPanel(doc);
  const print = screen.getByRole('button', { name: /^Print$/ });
  await userEvent.click(print);
  await vi.waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(print).toBeEnabled());
  await userEvent.click(print);
  await vi.waitFor(() => expect(window.print).toHaveBeenCalledTimes(2));
  expect(engrave).toHaveBeenCalledOnce();
  view.rerender(
    <SidePanel
      doc={{ ...doc, assignment: {} }}
      source={source}
      piece={melody}
      setSplitMidi={vi.fn()}
    />,
  );
  await vi.waitFor(() => expect(print).toBeEnabled());
  await userEvent.click(print);
  await vi.waitFor(() => expect(window.print).toHaveBeenCalledTimes(3));
  expect(engrave).toHaveBeenCalledTimes(2);
  view.unmount();
  vi.restoreAllMocks();
});

it('cancels pending paper work when a native print snapshot takes ownership', async () => {
  let finish!: (result: { pages: string[]; ms: number }) => void;
  const engrave = vi.fn(
    () =>
      new Promise<{ pages: string[]; ms: number }>((resolve) => {
        finish = resolve;
      }),
  );
  const dispose = vi.fn();
  vi.spyOn(rendererModule, 'createRenderer').mockReturnValue({
    render: engrave,
    dispose,
    warmUp: vi.fn(),
  });
  vi.spyOn(services, 'engine', 'get').mockReturnValue({
    fingeredXml: vi.fn().mockResolvedValue('<score-partwise/>'),
  } as never);
  window.print = vi.fn();
  const view = renderPanel(
    readyDoc({
      xml: '<score-partwise/>',
      score: { notes: [], measures: [] } as never,
      assignment: {},
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Print$/ }));
  await vi.waitFor(() => expect(engrave).toHaveBeenCalledOnce());
  window.dispatchEvent(new Event('beforeprint'));
  expect(document.querySelectorAll('.print-score')).toHaveLength(1);
  expect(dispose).toHaveBeenCalled();
  finish({ pages: ['<svg/>'], ms: 1 });
  await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Print$/ })).toBeEnabled());
  expect(window.print).not.toHaveBeenCalled();
  expect(document.querySelectorAll('.print-score')).toHaveLength(1);
  window.dispatchEvent(new Event('afterprint'));
  view.unmount();
  vi.restoreAllMocks();
});

it('does not start an app print while a native print snapshot is active', async () => {
  const engrave = vi.fn().mockResolvedValue({ pages: ['<svg/>'], ms: 1 });
  vi.spyOn(rendererModule, 'createRenderer').mockReturnValue({
    render: engrave,
    dispose: vi.fn(),
    warmUp: vi.fn(),
  });
  vi.spyOn(services, 'engine', 'get').mockReturnValue({
    fingeredXml: vi.fn().mockResolvedValue('<score-partwise/>'),
  } as never);
  window.print = vi.fn();
  const view = renderPanel(
    readyDoc({
      xml: '<score-partwise/>',
      score: { notes: [], measures: [] } as never,
      assignment: {},
    }),
  );
  window.dispatchEvent(new Event('beforeprint'));
  await userEvent.click(screen.getByRole('button', { name: /^Print$/ }));
  expect(engrave).not.toHaveBeenCalled();
  expect(window.print).not.toHaveBeenCalled();
  expect(document.querySelectorAll('.print-score')).toHaveLength(1);
  window.dispatchEvent(new Event('afterprint'));
  view.unmount();
  vi.restoreAllMocks();
});
