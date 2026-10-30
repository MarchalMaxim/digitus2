import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { build, formatBuildDay } from '../app/build.js';
import { useAppStore } from '../app/store.js';
import { en } from '../i18n/en/index.js';
import { messages as fr } from '../i18n/fr/index.js';
import { chooseLocale, resetLocaleForTests } from '../i18n/i18n.js';
import { PhraseError } from '../i18n/PhraseError.js';
import { GRAND_STAFF_WARNING } from './client.js';
import type { ScanSession } from './model.js';
import { BUSY_RETRY_MS, BUSY_WAIT_MS } from './client.js';
import { ScanView } from './ScanView.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const { load, renderNotation } = vi.hoisted(() => ({ load: vi.fn(), renderNotation: vi.fn() }));

// DOM tests have no browser workers; pixel/upload behavior is covered by Playwright.
vi.mock('../engine/client.js', () => ({
  SCAN_LOAD: { preserveNotation: true, tolerateScanTies: true },
  createEngineClient: () => ({
    load,
    dispose: () => {},
  }),
}));
vi.mock('../score/render/renderer.js', () => ({
  NO_MUSIC: 'the score has no music to draw',
  createRenderer: () => ({
    render: renderNotation,
    dispose: () => {},
  }),
}));
// pdf.js does not run under jsdom; a PDF page's preview is covered by Playwright.
vi.mock('./PdfPreview.js', () => ({ PdfPreview: () => null }));
beforeEach(() => {
  load.mockReset().mockResolvedValue({ warnings: [], score: { notes: [{}] }, tieRepairs: [] });
  renderNotation.mockReset().mockResolvedValue({ pages: ['<svg/>'] });
});
afterEach(() => {
  cleanup();
  resetLocaleForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reopens complete individual recognition in page review when combining failed', () => {
  const file = new File(['source'], 'source.png', { type: 'image/png' });
  render(
    <ScanView
      session={{
        id: 'saved',
        file,
        pages: [
          { id: 'first', file, xml: '<score-partwise/>' },
          { id: 'second', file, xml: '<score-partwise/>' },
        ],
      }}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Select page 1: source.png' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.queryByRole('button', { name: 'Scan this score' })).toBeNull();
  // The join is read again from the saved pages: the verdict names the page it refused and
  // what it found there, and the action on that page carries the red (issue 230).
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Page 1 could not be combined with the other pages: its part list is incomplete. Photograph it again, flat and with the whole page in view.',
  );
  expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Replace page 1 with a new photo' })).toHaveClass(
    'is-red',
  );
  expect(screen.getByRole('button', { name: 'Scan again' })).not.toHaveClass('is-red');
});

it('offers correction in a refusal only where the notes can be corrected', async () => {
  load.mockRejectedValue(new Error('Unsupported notation.'));
  const file = new File(['source'], 'source.png', { type: 'image/png' });
  const pages = [
    { id: 'first', file, xml: '<score-partwise/>' },
    { id: 'second', file, xml: '<score-partwise/>' },
  ];
  const { unmount } = render(<ScanView session={{ id: 'apart', file, pages }} />);
  // Not combined: nothing here can be corrected.
  expect(await screen.findByText(/do not fit together. Download the raw file/)).toBeVisible();
  unmount();
  render(<ScanView session={{ id: 'joined', file, pages, xml: '<score-partwise/>' }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Select page 1: source.png' }));
  expect(
    await screen.findByText(/do not fit together. Correct the notes in the combined score/),
  ).toBeVisible();
});

it('waits for valid import and displayed notation before enabling use', async () => {
  let finishImport!: (result: unknown) => void;
  let finishRender!: (result: unknown) => void;
  load.mockReturnValue(
    new Promise((resolve) => {
      finishImport = resolve;
    }),
  );
  renderNotation.mockReturnValue(
    new Promise((resolve) => {
      finishRender = resolve;
    }),
  );
  render(
    <ScanView
      session={{
        id: 'saved',
        file: new File(['source'], 'source.png', { type: 'image/png' }),
        xml: '<score-partwise/>',
      }}
    />,
  );
  const use = screen.getByRole('button', { name: 'Use for fingerings' });
  expect(use).toBeDisabled();
  finishImport({ warnings: [], score: { notes: [{}] }, tieRepairs: [] });
  await vi.waitFor(() => expect(use).toBeDisabled());
  finishRender({ pages: ['<svg/>'] });
  await vi.waitFor(() => expect(use).toBeEnabled());
});

it('uses valid restored recognition without a mandatory comparison checkbox', async () => {
  const session = {
    id: 'saved',
    file: new File(['source'], 'source.png', { type: 'image/png' }),
    xml: '<score-partwise/>',
  };
  const openPiece = vi.spyOn(useAppStore.getState(), 'openPiece').mockImplementation(() => {});
  render(<ScanView session={session} />);
  const use = screen.getByRole('button', { name: 'Use for fingerings' });
  await vi.waitFor(() => expect(use).toBeEnabled());
  expect(screen.queryByRole('checkbox')).toBeNull();
  await userEvent.click(use);
  expect(openPiece).toHaveBeenCalledWith({
    kind: 'file',
    name: 'source.musicxml',
    bytes: new TextEncoder().encode(session.xml),
    scan: session,
  });
});

it.each(['import', 'render', 'empty'] as const)(
  'keeps %s failures blocked without a checkbox',
  async (failure) => {
    if (failure === 'import') load.mockRejectedValue(new Error('Unsupported notation'));
    if (failure === 'render') renderNotation.mockRejectedValue(new Error('Cannot render notation'));
    if (failure === 'empty')
      load.mockResolvedValue({ warnings: [], score: { notes: [] }, tieRepairs: [] });
    render(
      <ScanView
        session={{
          id: 'saved',
          file: new File(['source'], 'source.png', { type: 'image/png' }),
          xml: '<score-partwise/>',
        }}
      />,
    );
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).toBeNull();
  },
);

it('speaks French, including a restored error and the page navigation', async () => {
  await act(async () => {
    await chooseLocale('fr');
  });
  const file = new File(['source'], 'source.png', { type: 'image/png' });
  render(
    <ScanView
      session={{
        id: 'saved',
        file,
        pages: [
          { id: 'first', file, xml: '<score-partwise/>' },
          { id: 'second', file, xml: '<score-partwise/>' },
        ],
      }}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Vérifiez la reconnaissance' })).toBeVisible();
  // The join is read again from the saved pages and names the page it refused (issue 230).
  expect(screen.getByRole('alert')).toHaveTextContent(
    'La page 1 n’a pas pu être combinée avec les autres pages',
  );
  // Image pages are chosen by their thumbnails; the pager is only for a PDF's pages.
  expect(screen.getByRole('button', { name: 'Sélectionner la page 2 : source.png' })).toBeVisible();
  expect(screen.getByText('Reconnaissance de la page 1')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Utiliser pour le doigté' })).toBeDisabled();
});

it('shows the file name, with no page-view toggle, for a single-page session', async () => {
  render(
    <ScanView
      session={{
        id: 'saved',
        file: new File(['source'], 'source.png', { type: 'image/png' }),
        xml: '<score-partwise/>',
      }}
    />,
  );
  await vi.waitFor(() => expect(renderNotation).toHaveBeenCalled());
  expect(screen.getByText('source.png')).toBeVisible();
  expect(screen.queryByText(/page image/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Page recognition' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Combined score' })).toBeNull();
  expect(document.querySelector('.scan-verdict')).toHaveTextContent(/^1 page/);
});

it('a thumbnail is the view switch', async () => {
  const file = new File(['source'], 'source.png', { type: 'image/png' });
  render(
    <ScanView
      session={{
        id: 'saved',
        file,
        pages: [
          // Each page differs from the whole, as real pages do: a view switch renders afresh.
          { id: 'first', file, xml: '<score-partwise><part/></score-partwise>' },
          { id: 'second', file, xml: '<score-partwise><part-list/></score-partwise>' },
        ],
        xml: '<score-partwise/>',
      }}
    />,
  );
  const first = screen.getByRole('button', { name: 'Select page 1: source.png' });
  const second = screen.getByRole('button', { name: 'Select page 2: source.png' });
  const use = screen.getByRole('button', { name: 'Use for fingerings' });
  expect(first).toHaveAttribute('aria-pressed', 'false');
  expect(second).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText(/All pages in reading order/)).toBeVisible();
  await vi.waitFor(() => expect(use).toBeEnabled());
  await userEvent.click(second);
  expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(
    screen.getByText('Recognition of page 2. Select it again for the whole score.'),
  ).toBeVisible();
  await vi.waitFor(() => expect(use).toBeEnabled());
  await userEvent.click(second);
  expect(screen.getByText(/All pages in reading order/)).toBeVisible();
  expect(second).toHaveAttribute('aria-pressed', 'false');
});

it('switching between two pages with the same recognition keeps the sheet and Use', async () => {
  const file = new File(['source'], 'source.png', { type: 'image/png' });
  const same = '<score-partwise><part/></score-partwise>';
  render(
    <ScanView
      session={{
        id: 'saved',
        file,
        pages: [
          { id: 'first', file, xml: same },
          { id: 'second', file, xml: same },
        ],
        xml: '<score-partwise/>',
      }}
    />,
  );
  const use = screen.getByRole('button', { name: 'Use for fingerings' });
  await userEvent.click(screen.getByRole('button', { name: 'Select page 1: source.png' }));
  await vi.waitFor(() => expect(use).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Select page 2: source.png' }));
  expect(screen.getByText(/Recognition of page 2/)).toBeVisible();
  await vi.waitFor(() => expect(use).toBeEnabled());
  expect(document.querySelector('.scan-review svg')).not.toBeNull();
});

it('a page read as one staff puts the red on Scan again', async () => {
  const file = new File(['source'], 'source.png', { type: 'image/png' });
  render(
    <ScanView
      session={{
        id: 'saved',
        file,
        pages: [{ id: 'p', file, xml: '<score-partwise/>', warnings: [GRAND_STAFF_WARNING] }],
        xml: '<score-partwise/>',
        warnings: [GRAND_STAFF_WARNING],
      }}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Page 1 was read as one staff: the hands are mixed. Replace that photo and scan again.',
  );
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Scan again' })).toHaveClass('is-red'),
  );
  expect(screen.getByRole('button', { name: 'Use for fingerings' })).not.toHaveClass('is-red');
});

/** A scan service stub: `recognize` answers each POST; the health and DELETE answers are fixed. */
function stubService(options: {
  health?: () => Promise<Response>;
  recognize?: (init: RequestInit) => Promise<Response>;
}) {
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/health'))
      return (
        options.health?.() ??
        Promise.resolve(
          new Response(JSON.stringify({ protocol: 'digitus2-scan-v2', recognizer: 'Test' })),
        )
      );
    if (url.endsWith('/v1/recognize') && init?.method === 'POST')
      return (
        options.recognize?.(init) ??
        Promise.resolve(
          new Response(
            JSON.stringify({ state: 'ready', xml: scanXml, recognizer: 'Test', warnings: [] }),
          ),
        )
      );
    if (init?.method === 'DELETE')
      return Promise.resolve(new Response(JSON.stringify({ state: 'cancelled' })));
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
  vi.stubGlobal('fetch', fetcher);
  const calls = (method: string) =>
    fetcher.mock.calls.filter(([, init]) => init?.method === method);
  const job = () =>
    (calls('POST')[0]?.[1]?.headers as Record<string, string> | undefined)?.['X-Digitus2-Job'];
  return { fetcher, calls, job };
}
/** A recognition that never answers until the request is aborted. */
const pending = (init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError'));
    });
  });
const scanXml = '<score-partwise><part-list/></score-partwise>';
const freshSession = () => ({
  id: 'fresh',
  file: new File([png], 'photo.png', { type: 'image/png' }),
});

it('warms the scanner up on arrival, scans one image and arrives at the review', async () => {
  const service = stubService({});
  render(<ScanView session={freshSession()} />);
  // The warm-up is a health request on arrival; nothing is sent before the button is pressed.
  await vi.waitFor(() =>
    expect(service.fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/health$/),
      expect.anything(),
    ),
  );
  expect(service.calls('POST')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  const post = service.calls('POST');
  expect(post).toHaveLength(1);
  expect(post[0]![0]).toMatch(/\/v1\/recognize$/);
  const headers = post[0]![1]!.headers as Record<string, string>;
  expect(headers['X-Digitus2-Job']).toMatch(/^[a-f0-9]{32}$/);
  expect(headers['X-Digitus2-Client']).toBe('1');
  await vi.waitFor(() =>
    expect(load).toHaveBeenCalledWith(scanXml, 'scan.musicxml', expect.anything()),
  );
});

it('shows nothing when the warm-up fails, and the scan still works', async () => {
  const service = stubService({ health: () => Promise.reject(new TypeError('Failed to fetch')) });
  render(<ScanView session={freshSession()} />);
  await vi.waitFor(() => expect(service.fetcher).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('heading', { name: 'Review the recognition' })).toBeVisible();
});

it("keeps a PDF page's empty warnings empty, whatever the health answer warns of", async () => {
  const photoWarning = 'Photo recognition is experimental.';
  const service = stubService({
    health: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            protocol: 'digitus2-scan-v2',
            recognizer: 'Test',
            warnings: [photoWarning],
          }),
        ),
      ),
  });
  render(
    <ScanView
      session={{
        id: 'pdf',
        file: new File(['%PDF-1.7'], 'score.pdf', { type: 'application/pdf' }),
      }}
    />,
  );
  // The warm-up has answered before the scan starts.
  await vi.waitFor(() => expect(service.fetcher).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  expect(screen.queryByText(photoWarning)).toBeNull();
  const view = useAppStore.getState().view;
  expect(view.name === 'scan' && view.session.warnings).toEqual([]);
  expect(view.name === 'scan' && view.session.pages?.[0]?.warnings).toEqual([]);
});

/** The service's answer while another reader's page is being recognised. */
const busyAnswer = () =>
  Promise.resolve(new Response(JSON.stringify({ error: 'busy' }), { status: 429 }));
const ready = () =>
  new Response(JSON.stringify({ state: 'ready', xml: scanXml, recognizer: 'Test', warnings: [] }));
const jobOf = (init: RequestInit | undefined) =>
  (init?.headers as Record<string, string>)['X-Digitus2-Job'];
/** Fake timers that still let real time pass, so the view's own waits and React settle. */
function fakeClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const photoPage = (name: string) => new File([png], name, { type: 'image/png' });
const batchOf = (...names: string[]): ScanSession => ({
  id: 'batch',
  file: photoPage(names[0]!),
  pages: names.map((name) => ({ id: name, file: photoPage(name) })),
});
const valueOf = (bar: HTMLElement) => Number(bar.getAttribute('aria-valuenow'));

it('stops a batch at a busy answer it has waited out, and keeps the remaining pages', async () => {
  const user = fakeClock();
  try {
    let answered = 0;
    const service = stubService({
      recognize: () => {
        answered += 1;
        return answered === 1 ? Promise.resolve(ready()) : busyAnswer();
      },
    });
    render(<ScanView session={batchOf('one.png', 'two.png', 'three.png')} />);
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    // The second page waits for the scanner, then gives up.
    expect(await screen.findByText(en.scan.view.waiting)).toBeVisible();
    await advance(BUSY_WAIT_MS + BUSY_RETRY_MS);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The scanner is busy with another score. Try again in a minute.',
    );
    // The third page is not sent: it would only meet the same answer.
    const jobs = new Set(service.calls('POST').map(([, init]) => jobOf(init)));
    expect(jobs.size).toBe(2);
    const view = useAppStore.getState().view;
    const pages = view.name === 'scan' ? view.session.pages : undefined;
    expect(pages?.map((page) => !!page.xml)).toEqual([true, false, false]);
    expect(pages?.slice(1).map((page) => page.error)).toEqual([
      'The scanner is busy with another score. Try again in a minute.',
      'The scanner is busy with another score. Try again in a minute.',
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it('cancels the running job with a DELETE and returns to Scan this score', async () => {
  const service = stubService({ recognize: pending });
  render(<ScanView session={freshSession()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  await vi.waitFor(() => expect(service.calls('POST')).toHaveLength(1));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel scan' }));
  expect(await screen.findByRole('button', { name: 'Scan this score' })).toBeEnabled();
  const job = service.job();
  expect(job).toMatch(/^[a-f0-9]{32}$/);
  expect(service.calls('DELETE').map(([url]) => url)).toEqual([
    expect.stringMatching(new RegExp(`/v1/jobs/${job}$`)),
  ]);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Review the recognition' })).toBeNull();
});

it('shows the bar while a page is recognised, and no bar before or after', async () => {
  const user = fakeClock();
  try {
    let finish!: (response: Response) => void;
    stubService({ recognize: () => new Promise((resolve) => (finish = resolve)) });
    render(<ScanView session={freshSession()} />);
    // The warm-up has answered by the time the button is pressed.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    const bar = await screen.findByRole('progressbar', { name: en.scan.view.progress });
    expect(screen.getByText(en.scan.view.secondsLeft(35))).toBeVisible();
    const start = valueOf(bar);
    await advance(10_000);
    expect(valueOf(bar)).toBeGreaterThan(start);
    expect(screen.getByText(en.scan.view.secondsLeft(25))).toBeVisible();
    await advance(30_000);
    expect(screen.getByText(en.scan.view.overdue)).toBeVisible();
    expect(valueOf(bar)).toBeLessThan(100);
    // The answer fills the bar before the review opens.
    act(() => finish(ready()));
    await vi.waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '100'));
    expect(await screen.findByRole('heading', { name: 'Review the recognition' })).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('allows six more seconds while the warm-up has not answered, and not once it has', async () => {
  const user = fakeClock();
  try {
    // A PDF page is expected to take 25 s: 31 s, said as 35, while the warm-up is out.
    let answerHealth!: (response: Response) => void;
    stubService({
      health: () => new Promise((resolve) => (answerHealth = resolve)),
      recognize: pending,
    });
    const pdf = new File(['%PDF-1.7'], 'score.pdf', { type: 'application/pdf' });
    render(<ScanView session={{ id: 'pdf', file: pdf }} />);
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    expect(await screen.findByText(en.scan.view.secondsLeft(35))).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel scan' }));
    await screen.findByRole('button', { name: 'Scan this score' });
    answerHealth(new Response(JSON.stringify({ protocol: 'digitus2-scan-v2' })));
    await act(async () => {
      await Promise.resolve();
    });
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    expect(await screen.findByText(en.scan.view.secondsLeft(25))).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

it('runs one bar across the batch, forward only, full only at the last answer', async () => {
  const user = fakeClock();
  try {
    const finish: Array<(response: Response) => void> = [];
    const service = stubService({
      recognize: () => new Promise((resolve) => finish.push(resolve)),
    });
    render(<ScanView session={batchOf('one.png', 'two.png', 'three.png')} />);
    await act(async () => {
      await Promise.resolve();
    });
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    const bar = await screen.findByRole('progressbar');
    // Three photos at 35 s each.
    expect(screen.getByText(en.scan.view.secondsLeft(105))).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(en.scan.view.scanningPage(1, 3));
    const values = [valueOf(bar)];
    const note = () => values.push(valueOf(bar));
    await advance(20_000);
    note();
    // The first answer starts the next page's stretch from where the bar stands: the same bar.
    act(() => finish[0]!(ready()));
    await vi.waitFor(() => expect(service.calls('POST')).toHaveLength(2));
    await vi.waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(en.scan.view.scanningPage(2, 3)),
    );
    expect(screen.getByRole('progressbar')).toBe(bar);
    expect(valueOf(bar)).toBeGreaterThanOrEqual(values.at(-1)!);
    // Two photos are left: the line counts them.
    expect(screen.getByText(en.scan.view.secondsLeft(70))).toBeVisible();
    await advance(75_000);
    note();
    expect(screen.getByText(en.scan.view.overdue)).toBeVisible();
    act(() => finish[1]!(ready()));
    await vi.waitFor(() => expect(service.calls('POST')).toHaveLength(3));
    expect(screen.getByRole('progressbar')).toBe(bar);
    expect(valueOf(bar)).toBeGreaterThanOrEqual(values.at(-1)!);
    expect(screen.getByText(en.scan.view.secondsLeft(35))).toBeVisible();
    await advance(10_000);
    note();
    // Forward only, and never full before the last answer.
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(Math.max(...values)).toBeLessThan(100);
    act(() => finish[2]!(ready()));
    await vi.waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '100'));
    expect(await screen.findByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

it('counts only the pages a retry sends', async () => {
  const user = fakeClock();
  try {
    stubService({ recognize: pending });
    const session = batchOf('one.png', 'two.png', 'three.png');
    session.pages![0]!.xml = scanXml;
    session.pages![1]!.error = 'Page too blurry.';
    session.pages![2]!.error = 'Page too blurry.';
    render(<ScanView session={session} />);
    await act(async () => {
      await Promise.resolve();
    });
    await user.click(screen.getByRole('button', { name: 'Retry failed pages' }));
    await screen.findByRole('progressbar');
    expect(screen.getByText(en.scan.view.secondsLeft(70))).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(en.scan.view.scanningPage(2, 3));
  } finally {
    vi.useRealTimers();
  }
});

it('waits while the scanner is busy, offers the same job again, then shows the bar', async () => {
  const user = fakeClock();
  try {
    let finish!: (response: Response) => void;
    const service = stubService({
      recognize: () =>
        service.calls('POST').length === 1
          ? busyAnswer()
          : new Promise((resolve) => (finish = resolve)),
    });
    render(<ScanView session={freshSession()} />);
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    expect(await screen.findByText(en.scan.view.waiting)).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel scan' })).toBeEnabled();
    await advance(BUSY_RETRY_MS);
    await vi.waitFor(() => expect(service.calls('POST')).toHaveLength(2));
    const [first, second] = service.calls('POST');
    expect(jobOf(second![1])).toBe(jobOf(first![1]));
    // The retry is not answered busy at once: the scanner has taken it, and the bar appears.
    await advance(2_500);
    expect(screen.queryByText(en.scan.view.waiting)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(en.scan.view.scanning);
    expect(screen.getByRole('progressbar')).toBeVisible();
    act(() => finish(ready()));
    expect(await screen.findByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

it('keeps the bar where it stood when a later page has to wait for the scanner', async () => {
  const user = fakeClock();
  try {
    let finish!: (response: Response) => void;
    const service = stubService({
      recognize: () => {
        const offers = service.calls('POST').length;
        if (offers === 1) return Promise.resolve(ready());
        return offers === 2 ? busyAnswer() : new Promise((resolve) => (finish = resolve));
      },
    });
    render(<ScanView session={batchOf('one.png', 'two.png')} />);
    await act(async () => {
      await Promise.resolve();
    });
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    expect(await screen.findByText(en.scan.view.waiting)).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
    // The wait does not eat into the bar: the second page's stretch starts when it is taken.
    await advance(BUSY_RETRY_MS);
    await vi.waitFor(() => expect(service.calls('POST')).toHaveLength(3));
    await advance(2_500);
    const bar = await screen.findByRole('progressbar');
    expect(screen.getByText(en.scan.view.secondsLeft(35))).toBeVisible();
    // About 2.5 s into the stretch is 13 percent; had the 5 s of waiting counted, 34.
    expect(valueOf(bar)).toBeLessThan(20);
    act(() => finish(ready()));
    expect(await screen.findByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

it('cancels while waiting for the scanner, and nothing is left to delete or offer', async () => {
  const user = fakeClock();
  try {
    const service = stubService({ recognize: busyAnswer });
    render(<ScanView session={freshSession()} />);
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    expect(await screen.findByText(en.scan.view.waiting)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(await screen.findByRole('button', { name: 'Scan this score' })).toBeEnabled();
    expect(screen.queryByText(en.scan.view.waiting)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // The scanner never took the job, so there is nothing for a DELETE to stop.
    expect(service.calls('DELETE')).toHaveLength(0);
    await advance(BUSY_RETRY_MS * 3);
    expect(service.calls('POST')).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it('cancels the job the scanner took after a wait with a DELETE', async () => {
  const user = fakeClock();
  try {
    const service = stubService({
      recognize: (init) => (service.calls('POST').length === 1 ? busyAnswer() : pending(init)),
    });
    render(<ScanView session={freshSession()} />);
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    expect(await screen.findByText(en.scan.view.waiting)).toBeVisible();
    await advance(BUSY_RETRY_MS);
    await vi.waitFor(() => expect(service.calls('POST')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(await screen.findByRole('button', { name: 'Scan this score' })).toBeEnabled();
    expect(service.calls('DELETE').map(([url]) => url)).toEqual([
      expect.stringMatching(new RegExp(`/v1/jobs/${service.job()}$`)),
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it('reports the busy scanner after waiting the longest it waits', async () => {
  const user = fakeClock();
  try {
    const service = stubService({ recognize: busyAnswer });
    render(<ScanView session={freshSession()} />);
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    expect(await screen.findByText(en.scan.view.waiting)).toBeVisible();
    await advance(BUSY_WAIT_MS + BUSY_RETRY_MS);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.scan.client.busy);
    expect(screen.getByRole('button', { name: 'Scan this score' })).toBeEnabled();
    expect(screen.queryByText(en.scan.view.waiting)).toBeNull();
    const offers = service.calls('POST').length;
    expect(offers).toBeGreaterThan(BUSY_WAIT_MS / BUSY_RETRY_MS / 2);
    expect(offers).toBeLessThanOrEqual(BUSY_WAIT_MS / BUSY_RETRY_MS + 1);
    await advance(BUSY_RETRY_MS * 3);
    expect(service.calls('POST')).toHaveLength(offers);
  } finally {
    vi.useRealTimers();
  }
});

it('waits as long as a busy answer asks to', async () => {
  const user = fakeClock();
  try {
    const service = stubService({
      recognize: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'busy' }), {
            status: 429,
            headers: { 'Retry-After': '30' },
          }),
        ),
    });
    render(<ScanView session={freshSession()} />);
    await user.click(screen.getByRole('button', { name: 'Scan this score' }));
    expect(await screen.findByText(en.scan.view.waiting)).toBeVisible();
    await advance(25_000);
    expect(service.calls('POST')).toHaveLength(1);
    await advance(6_000);
    await vi.waitFor(() => expect(service.calls('POST')).toHaveLength(2));
  } finally {
    vi.useRealTimers();
  }
});

it('does not wait out the hourly limit', async () => {
  stubService({
    recognize: () =>
      Promise.resolve(new Response(JSON.stringify({ error: 'rate-limited' }), { status: 429 })),
  });
  render(<ScanView session={freshSession()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.scan.client.limited);
  expect(screen.queryByText(en.scan.view.waiting)).toBeNull();
});

it('sends the DELETE when the view unmounts mid-scan', async () => {
  const service = stubService({ recognize: pending });
  const { unmount } = render(<ScanView session={freshSession()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  await vi.waitFor(() => expect(service.calls('POST')).toHaveLength(1));
  const signal = service.calls('POST')[0]![1]!.signal!;
  unmount();
  await vi.waitFor(() => expect(service.calls('DELETE')).toHaveLength(1));
  expect(service.calls('DELETE')[0]![0]).toMatch(new RegExp(`/v1/jobs/${service.job()}$`));
  expect(signal.aborted).toBe(true);
});

it('offers the same single button on a touch-only device', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(any-pointer: coarse)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  stubService({});
  render(<ScanView session={freshSession()} />);
  expect(screen.getByRole('button', { name: 'Scan this score' })).toBeVisible();
  expect(screen.queryByText(/Send photos/)).toBeNull();
  expect(screen.queryByText(/Save photos/)).toBeNull();
  expect(screen.getByText(/Google Cloud \(Netherlands\)/)).toHaveClass('small', 'muted');
  expect(screen.getByRole('link', { name: 'How scanning works' })).toHaveAttribute(
    'href',
    'https://github.com/MarchalMaxim/digitus2/blob/main/docs/scanning.md',
  );
  // The camera entry stays on a touch-only device.
  expect(screen.getByText('Photograph another page')).toBeVisible();
  await act(async () => {
    await Promise.resolve();
  });
});

it('renders the recognition at the width of its column, rounded to a step of 80 pixels', async () => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 1000,
  });
  try {
    render(
      <ScanView
        session={{
          id: 'saved',
          file: new File(['source'], 'source.png', { type: 'image/png' }),
          xml: '<score-partwise/>',
        }}
      />,
    );
    await vi.waitFor(() =>
      expect(renderNotation).toHaveBeenLastCalledWith(expect.objectContaining({ widthPx: 1040 })),
    );
  } finally {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  }
});

/** A scan of two pages, recognised and combined, as the review opens it. */
function reviewed(): ScanSession {
  const first = new File([png], 'source.png', { type: 'image/png' });
  const second = new File([new Uint8Array([...png, 1])], 'second.png', { type: 'image/png' });
  return {
    id: 'saved',
    file: first,
    pages: [
      { id: 'first', file: first, xml: '<score-partwise/>' },
      { id: 'second', file: second, xml: '<score-partwise/>' },
    ],
    xml: '<score-partwise/>',
    recognizedAt: '2026-10-22T20:30:00.000Z',
    recognizer: 'homr',
  };
}

/** The phone's share sheet, as the browser exposes it; removed again by `withoutShare`. */
function stubShare(canShare: boolean, share: () => Promise<void> = () => Promise.resolve()) {
  const sheet = {
    canShare: vi.fn((_data?: ShareData) => canShare),
    share: vi.fn((_data?: ShareData) => share()),
  };
  Object.defineProperty(navigator, 'canShare', { value: sheet.canShare, configurable: true });
  Object.defineProperty(navigator, 'share', { value: sheet.share, configurable: true });
  return sheet;
}

function withoutShare() {
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
}

/** The downloads the page starts: the files handed to an object URL, and the anchors' names. */
function spyDownloads() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    blobs.push(blob as Blob);
    return 'blob:x';
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (this.download) names.push(this.download);
  });
  return {
    blobs,
    names,
    restore: () => {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    },
  };
}

const REVIEW_ENTRIES = [
  'combined-recognized.musicxml',
  'page-1-recognized.musicxml',
  'page-1.png',
  'page-2-recognized.musicxml',
  'page-2.png',
  'scan.json',
];

it('shares everything the scan did as one ZIP where the phone can share files', async () => {
  const downloads = spyDownloads();
  const sheet = stubShare(true);
  try {
    render(<ScanView session={reviewed()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Download everything' }));
    await vi.waitFor(() => expect(sheet.share).toHaveBeenCalledTimes(1));
    const data = sheet.share.mock.calls[0]![0]!;
    expect(data.title).toBe('source');
    expect(data.files).toHaveLength(1);
    const archive = data.files![0]!;
    expect(archive.name).toBe('source-scan.zip');
    expect(archive.type).toBe('application/zip');
    expect(sheet.canShare).toHaveBeenCalledWith({ files: [archive] });
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(REVIEW_ENTRIES);
    expect(entries['page-1.png']).toEqual(png);
    expect(downloads.names).toEqual([]);
  } finally {
    withoutShare();
    downloads.restore();
  }
});

it('downloads the same ZIP where the browser cannot share files', async () => {
  const downloads = spyDownloads();
  const sheet = stubShare(false);
  try {
    render(<ScanView session={reviewed()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Download everything' }));
    await vi.waitFor(() => expect(downloads.names).toEqual(['source-scan.zip']));
    expect(sheet.share).not.toHaveBeenCalled();
    const archive = downloads.blobs.find((b) => (b as File).name === 'source-scan.zip')!;
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(REVIEW_ENTRIES);
  } finally {
    withoutShare();
    downloads.restore();
  }
});

it('says nothing when the share sheet is closed', async () => {
  const downloads = spyDownloads();
  const sheet = stubShare(true, () => Promise.reject(new DOMException('closed', 'AbortError')));
  try {
    render(<ScanView session={reviewed()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Download everything' }));
    await vi.waitFor(() => expect(sheet.share).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(downloads.names).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download everything' })).toBeEnabled();
  } finally {
    withoutShare();
    downloads.restore();
  }
});

it('names the build under Recognition details, the day in the language of the reader', async () => {
  render(<ScanView session={reviewed()} />);
  expect(screen.queryByText(en.scan.review.pairedStavesNote)).toBeNull();
  expect(
    screen.getByText(en.about.build(build.commit, formatBuildDay('en', build))),
  ).toBeInTheDocument();
  cleanup();
  await act(async () => {
    await chooseLocale('fr');
  });
  render(<ScanView session={reviewed()} />);
  expect(
    screen.getByText(fr.about.build(build.commit, formatBuildDay('fr', build))),
  ).toBeInTheDocument();
});

it('pairs a single page read as a treble part and a bass part, and says so under Recognition details', async () => {
  // Issue 159: the owner's last page as homr wrote it, two parts named Voice.
  // Vitest runs from apps/web.
  // Vitest runs from apps/web; jsdom's parser wants the declaration in double quotes.
  const page = readFileSync(join(process.cwd(), 'fixtures/scan/owner-page-3.musicxml'), 'utf8')
    .replace(/^<\?xml[^>]*\?>/, '<?xml version="1.0" encoding="utf-8"?>')
    .trim();
  stubService({
    recognize: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ state: 'ready', xml: page, recognizer: 'Test', warnings: [] }),
        ),
      ),
  });
  render(<ScanView session={freshSession()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  expect(screen.getByText(en.scan.review.pairedStavesNote)).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(load).toHaveBeenCalledWith(
      expect.stringContaining('<staves>2</staves>'),
      'scan.musicxml',
      expect.anything(),
    ),
  );
});

/** One bar of five quarter notes in 4/4, a place to check, each note read at (40, 30) of the photo. */
function overlongBar(position: string): string {
  const note = `<note>${position}<pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`;
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${note.repeat(5)}</measure></part></score-partwise>`;
}

/** A photo's decoding is a browser's work: a bitmap and a 2D context that draws nothing. */
function stubPhotos() {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 200, height: 100, close: () => {} })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      fillRect: () => {},
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
    } as unknown as CanvasRenderingContext2D;
  });
}

it('shows the photo at a place to check and at the selected note, where homr placed it', async () => {
  stubPhotos();
  const file = new File([png], 'page.png', { type: 'image/png' });
  render(
    <ScanView
      session={{
        id: 'crops',
        file,
        xml: overlongBar('<!-- imgpos: 40, 30 -->'),
        recognizer: 'homr',
      }}
    />,
  );
  const crop = await screen.findByRole('img', { name: 'Bar 1 in the photo' });
  expect(crop).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Correct the selected note' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /Bar 1/ }));
  const panel = await screen.findByRole('region', { name: 'Correct the selected note' });
  expect(within(panel).getByRole('img', { name: 'Bar 1 in the photo' })).toBeVisible();
  expect(screen.getAllByRole('img', { name: 'Bar 1 in the photo' })).toHaveLength(2);
});

it('shows no photo for a PDF page or a recognition without positions', async () => {
  stubPhotos();
  const image = new File([png], 'page.png', { type: 'image/png' });
  const pdf = new File(['%PDF-1.7'], 'page.pdf', { type: 'application/pdf' });
  const { unmount } = render(
    <ScanView session={{ id: 'pdf', file: pdf, xml: overlongBar('<!-- imgpos: 40, 30 -->') }} />,
  );
  await screen.findByRole('button', { name: /Bar 1/ });
  await act(() => new Promise((done) => setTimeout(done, 30)));
  expect(screen.queryByRole('img', { name: /in the photo/ })).toBeNull();
  unmount();
  render(<ScanView session={{ id: 'none', file: image, xml: overlongBar('') }} />);
  await screen.findByRole('button', { name: /Bar 1/ });
  await act(() => new Promise((done) => setTimeout(done, 30)));
  expect(screen.queryByRole('img', { name: /in the photo/ })).toBeNull();
});

it("offers homr's other readings of the selected note's pitch, and one tap corrects it (issue 130)", async () => {
  const file = new File([png], 'page.png', { type: 'image/png' });
  const conf =
    '<!-- conf: rhythm note_4 0.9 note_8 0.01; pitch C4 0.7 D4 0.29 B3 0.001; lift _ 1 # 1e-06 -->';
  render(
    <ScanView session={{ id: 'suggest', file, xml: overlongBar(conf), recognizer: 'homr' }} />,
  );
  await userEvent.click(await screen.findByRole('button', { name: /Bar 1/ }));
  const panel = await screen.findByRole('region', { name: 'Correct the selected note' });
  const offered = within(panel).getByRole('group', { name: 'Also read as' });
  // B3 is under the floor; C4 is the reading itself.
  expect(
    within(offered)
      .getAllByRole('button')
      .map((b) => b.textContent),
  ).toEqual(['D4']);
  await userEvent.click(within(offered).getByRole('button', { name: 'D4' }));
  expect(await screen.findByText('1 correction')).toBeInTheDocument();
});

/**
 * A page in 3/4 whose tied notes end a beat before their continuation, as homr reads a missing
 * dot (issue 233): `ties` such ties, the first from bar 1's A4, the next from bar 2's B4.
 */
function lateTies(ties: number): string {
  const n = (step: string, tie?: 'start' | 'stop') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>${tie ? `<tie type="${tie}"/>` : ''}<type>quarter</type>${tie ? `<notations><tied type="${tie}"/></notations>` : ''}</note>`;
  const rest = '<note><rest/><duration>1</duration><type>quarter</type></note>';
  const steps = ['A', 'B', 'C'];
  const bars = [`${n('C')}${n('D')}${n('A', 'start')}`];
  for (let i = 1; i <= ties; i++)
    bars.push(`${rest}${n(steps[i - 1]!, 'stop')}${i < ties ? n(steps[i]!, 'start') : n('E')}`);
  const start =
    '<attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>';
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${bars
    .map((bar, i) => `<measure number="${i + 1}">${i === 0 ? start : ''}${bar}</measure>`)
    .join('')}</part></score-partwise>`;
}

it('uses a recognition whose only problem is a tie played as two notes, and lists the place with its fix (issue 233)', async () => {
  // The import plays the late tie as two notes, as the engine's scan import does.
  load.mockImplementation((xml: string) =>
    Promise.resolve({
      warnings: [],
      score: { notes: [{}] },
      tieRepairs: xml.includes('<tie type="start"/>')
        ? [{ note: 2, part: 0, measure: 0, reason: 'gap' }]
        : [],
    }),
  );
  const file = new File([png], 'page.png', { type: 'image/png' });
  render(<ScanView session={{ id: 'late-tie', file, xml: lateTies(1) }} />);
  const use = screen.getByRole('button', { name: 'Use for fingerings' });
  await vi.waitFor(() => expect(use).toBeEnabled());
  expect(load).toHaveBeenCalledWith(expect.any(String), 'scan.musicxml', {
    preserveNotation: true,
    tolerateScanTies: true,
  });
  // Usable: the red stays on Use, and the place waits under its count with its fix.
  expect(use).toHaveClass('is-red');
  expect(screen.getByText('1 place to check')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  const place = screen.getByRole('button', {
    name: /the tied A4 ends 1 beat before the next A4 begins/,
  });
  expect(place).not.toHaveClass('is-red');
  // A half note would run past the bar: only the removal is offered, and Fix all needs two.
  expect(screen.getByRole('button', { name: 'Remove the tie' })).not.toHaveClass('is-red');
  expect(screen.queryByRole('button', { name: /^Make the/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Fix all/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Remove the tie' }));
  expect(await screen.findByText('1 correction')).toBeInTheDocument();
  await vi.waitFor(() => expect(screen.queryByText('1 place to check')).toBeNull());
  await vi.waitFor(() => expect(use).toBeEnabled());
});

/** One bar of 4/4 whose C4 and D4 are each tied to the next, as written: no place to check. */
function twoTies(): string {
  const n = (step: string, tie?: 'start' | 'stop') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>${tie ? `<tie type="${tie}"/>` : ''}<type>quarter</type>${tie ? `<notations><tied type="${tie}"/></notations>` : ''}</note>`;
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${n('C', 'start')}${n('C', 'stop')}${n('D', 'start')}${n('D', 'stop')}</measure></part></score-partwise>`;
}

it('keeps the places list open across a fix while the import checks it again (issue 233)', async () => {
  // Two ties only the import repairs: the review itself names neither place.
  const xml = twoTies();
  const tied = (step: string, x: string) =>
    new RegExp(`<step>${step}</step>(?:(?!</note>).)*<tie type="start"/>`).test(x);
  load.mockImplementation((x: string) =>
    Promise.resolve({
      warnings: [],
      score: { notes: [{}] },
      tieRepairs: [
        ...(tied('C', x) ? [{ note: 0, part: 0, measure: 0, reason: 'unmatchedStart' }] : []),
        ...(tied('D', x) ? [{ note: 2, part: 0, measure: 0, reason: 'unmatchedStart' }] : []),
      ],
    }),
  );
  const file = new File([png], 'page.png', { type: 'image/png' });
  const { container } = render(<ScanView session={{ id: 'kept-open', file, xml }} />);
  expect(await screen.findByText('2 places to check')).toBeInTheDocument();
  // The reader opens the list (usable, so it starts folded).
  const list = container.querySelector<HTMLDetailsElement>('details.scan-problems')!;
  expect(list.open).toBe(false);
  act(() => {
    list.open = true;
    list.dispatchEvent(new Event('toggle'));
  });
  await userEvent.click(screen.getAllByRole('button', { name: 'Remove the tie' })[0]!);
  expect(await screen.findByText('1 place to check')).toBeInTheDocument();
  expect(container.querySelector<HTMLDetailsElement>('details.scan-problems')!.open).toBe(true);
});

it('makes every tie the import played as separate notes a place to check (issue 233)', async () => {
  // A repair no place names yet: the C4 the import read as a tie that leads nowhere.
  load.mockResolvedValue({
    warnings: [],
    score: { notes: [{}] },
    tieRepairs: [
      { note: 2, part: 0, measure: 0, reason: 'gap' },
      { note: 0, part: 0, measure: 0, reason: 'unmatchedStart' },
    ],
  });
  const file = new File([png], 'page.png', { type: 'image/png' });
  render(<ScanView session={{ id: 'repaired', file, xml: lateTies(1) }} />);
  expect(await screen.findByText('2 places to check')).toBeInTheDocument();
  expect(
    screen.getByRole('button', {
      name: /the tie on C4 leads to no next C4\. It is played without the tie\.$/,
    }),
  ).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled(),
  );
});

it('fixes every place the file decides as one step, which one Undo takes back (issue 233)', async () => {
  const file = new File([png], 'page.png', { type: 'image/png' });
  const { container } = render(<ScanView session={{ id: 'fix-all', file, xml: lateTies(2) }} />);
  expect(await screen.findByText('2 places to check')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Fix all 2' }));
  expect(await screen.findByText('2 corrections')).toBeInTheDocument();
  expect(screen.queryByText(/places? to check/)).toBeNull();
  expect(screen.queryByRole('button', { name: /^Fix all/ })).toBeNull();
  // Each fix is listed under Review corrections.
  expect(
    [...container.querySelectorAll('.scan-corrections ol li')].map((li) => li.textContent),
  ).toEqual(['Bar 1, staff 1: tie on A4 removed', 'Bar 2, staff 1: tie on B4 removed']);
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(await screen.findByText('2 places to check')).toBeInTheDocument();
  expect(screen.queryByText(/^\d+ corrections?$/)).toBeNull();
});

it('says the notation could not be drawn, and offers Scan again and the files (issue 233)', async () => {
  renderNotation.mockRejectedValue(new Error('the score could not be laid out'));
  const file = new File([png], 'page.png', { type: 'image/png' });
  const { container } = render(<ScanView session={{ id: 'undrawn', file, xml: lateTies(1) }} />);
  const alert = await screen.findByText(
    'The recognized notation could not be drawn. Scan again, or download the files for a notation editor below.',
  );
  expect(alert).toHaveAttribute('role', 'alert');
  // Nothing drawn, nothing to correct on: the red is on Scan again, not on a place.
  expect(screen.getByRole('button', { name: 'Scan again' })).toHaveClass('is-red');
  expect(container.querySelectorAll('.is-red')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
  expect(container.querySelector('details.scan-files')).toHaveAttribute('open');
  // The renderer's own words stay under Recognition details, as a supplement.
  expect(screen.getByText('Technical reason: the score could not be laid out')).toBeInTheDocument();
});

it('names the page that holds no music to draw (issue 233)', async () => {
  renderNotation.mockRejectedValue(new Error('the score has no music to draw'));
  render(<ScanView session={reviewed()} />);
  // In the whole score, the scan; on a page shown alone, that page.
  expect(await screen.findByText(/^No music was read from this scan\. Scan again/)).toHaveAttribute(
    'role',
    'alert',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Select page 2: second.png' }));
  expect(await screen.findByText(/^Page 2: no music was read\. Scan again/)).toHaveAttribute(
    'role',
    'alert',
  );
});

it('draws the notation once more after the renderer died (issue 233)', async () => {
  // A stable column: the one render the review starts is the one that meets the dead worker.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 640,
  });
  let dead = true;
  renderNotation.mockImplementation(() => {
    if (!dead) return Promise.resolve({ pages: ['<svg/>'] });
    dead = false;
    return Promise.reject(new Error('the score renderer failed: out of memory'));
  });
  try {
    const file = new File([png], 'page.png', { type: 'image/png' });
    render(<ScanView session={{ id: 'revived', file, xml: '<score-partwise/>' }} />);
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled(),
    );
    expect(renderNotation).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  }
});

it('names the bar an import refusal names, in the reader’s words (issue 233)', async () => {
  load.mockRejectedValue(
    new Error(
      'cannot preserve notation: note 3: invalid or missing duration (part 1, bar 12); note 9: no pitch (part 1, bar 14)',
    ),
  );
  const file = new File([png], 'page.png', { type: 'image/png' });
  render(<ScanView session={{ id: 'bar-12', file, xml: '<score-partwise/>' }} />);
  expect(
    await screen.findByText(
      /^Bar 12 could not be read as written, so this recognition cannot be used for fingerings yet\. Correct the notes here/,
    ),
  ).toHaveAttribute('role', 'alert');
  expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
});

it('leads from the bar an import refusal names to that bar’s first note (issue 233)', async () => {
  load.mockRejectedValue(
    new Error('cannot preserve notation: note 2: invalid or missing duration (part 1, bar 1)'),
  );
  const file = new File([png], 'page.png', { type: 'image/png' });
  const { container } = render(<ScanView session={{ id: 'bar-1', file, xml: twoTies() }} />);
  const show = await screen.findByRole('button', { name: 'Show bar 1' });
  // Nothing else to correct: the way to the bar carries the one red.
  await vi.waitFor(() => expect(show).toHaveClass('is-red'));
  expect(container.querySelectorAll('.is-red')).toHaveLength(1);
  await userEvent.click(show);
  // The bar's first note is in hand: the red is the note's now, on the sheet.
  expect(show).not.toHaveClass('is-red');
  expect(screen.getByRole('button', { name: 'Use for fingerings' })).not.toHaveClass('is-red');
  expect(screen.getByRole('button', { name: 'Scan again' })).not.toHaveClass('is-red');
});

it('reads the notes again in a fresh engine after its worker stopped (issue 233)', async () => {
  const stopped = new PhraseError((t) => t.app.engineFailed('out of memory'));
  load.mockRejectedValueOnce(stopped);
  const file = new File([png], 'page.png', { type: 'image/png' });
  render(<ScanView session={{ id: 'engine-revived', file, xml: lateTies(1) }} />);
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled(),
  );
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not blame the notes when the engine stops twice (issue 233)', async () => {
  load.mockRejectedValue(new PhraseError((t) => t.app.engineFailed('out of memory')));
  const file = new File([png], 'page.png', { type: 'image/png' });
  render(<ScanView session={{ id: 'engine-stopped', file, xml: lateTies(1) }} />);
  expect(
    await screen.findByText(
      'The notes could not be checked for fingerings in this tab. Reload the page and open this scan from My scores.',
    ),
  ).toHaveAttribute('role', 'alert');
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/do not fit together|Correct the notes/)).toBeNull();
  expect(
    screen.getByText('Technical reason: the engine worker failed: out of memory'),
  ).toBeInTheDocument();
});

it('draws the notation once more after the renderer’s module aborted (issue 233)', async () => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 640,
  });
  // The worker answers with the trap's own words, and the renderer retires it.
  renderNotation.mockRejectedValueOnce(new Error('unreachable'));
  try {
    const file = new File([png], 'page.png', { type: 'image/png' });
    render(<ScanView session={{ id: 'aborted', file, xml: '<score-partwise/>' }} />);
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled(),
    );
    expect(renderNotation).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  }
});

it('names the page whose notation keeps the whole score from being drawn, with its new photo as the fix (issue 233)', async () => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 640,
  });
  // Page 2 cannot be drawn alone, and so neither can the whole score.
  renderNotation.mockImplementation(({ xml }: { xml: string }) =>
    xml.includes('<!--one-->')
      ? Promise.resolve({ pages: ['<svg/>'] })
      : Promise.reject(new Error('the score could not be laid out')),
  );
  const session = reviewed();
  session.pages = session.pages!.map((page, i) => ({
    ...page,
    xml: `<score-partwise><!--${i ? 'two' : 'one'}--></score-partwise>`,
  }));
  try {
    const { container } = render(<ScanView session={session} />);
    expect(
      await screen.findByText(/^Page 2: the recognized notation could not be drawn\. Scan again/),
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: /^Replace page 2/ })).toHaveClass('is-red');
    expect(container.querySelectorAll('.is-red')).toHaveLength(1);
  } finally {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  }
});

it('says what the whole score showed while a page is shown alone (issue 233)', async () => {
  const downloads = spyDownloads();
  stubShare(false);
  try {
    render(<ScanView session={reviewed()} />);
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled(),
    );
    // Page 2 alone holds no music to draw; the whole score, which Use opens, is usable.
    renderNotation.mockRejectedValue(new Error('the score has no music to draw'));
    await userEvent.click(screen.getByRole('button', { name: 'Select page 2: second.png' }));
    expect(await screen.findAllByText(/^Page 2: no music was read\./)).not.toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: en.scan.review.downloadAll }));
    await vi.waitFor(() => expect(downloads.names).toEqual(['source-scan.zip']));
    const archive = downloads.blobs.find((b) => (b as File).name === 'source-scan.zip')!;
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const summary = JSON.parse(new TextDecoder().decode(entries['scan.json'])) as {
      review: unknown;
    };
    expect(summary.review).toEqual({
      verdict: en.scan.verdict.pages(2),
      usable: true,
      technical: [],
      places: [],
      corrections: 0,
      pages: ['first', 'second'],
    });
  } finally {
    withoutShare();
    downloads.restore();
  }
});

it('says under Recognition details that this device keeps its scans, and reports what the review said (issue 233)', async () => {
  const sent = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal('fetch', sent);
  // The same id both times, one a case could be kept under: only the opt-in tells them apart.
  const id = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
  const { unmount } = render(<ScanView session={{ ...reviewed(), id }} />);
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled(),
  );
  // Not opted in: no line, nothing sent.
  expect(screen.queryByText(/kept to improve recognition/)).toBeNull();
  expect(sent).not.toHaveBeenCalled();
  unmount();
  localStorage.setItem('digitus2.keepScans', '1');
  try {
    render(<ScanView session={{ ...reviewed(), id }} />);
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled(),
    );
    expect(
      screen.getByText('Scans from this device are kept to improve recognition.'),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());
    const [url, init] = sent.mock.calls.at(-1)!;
    expect(url).toMatch(/\/v1\/cases\/0a1b2c3d4e5f4a6b8c7d8e9f0a1b2c3d$/);
    expect(JSON.parse(init!.body as string)).toMatchObject({
      usable: true,
      technical: [],
      places: [],
      corrections: 0,
      pages: ['first', 'second'],
    });
  } finally {
    localStorage.removeItem('digitus2.keepScans');
  }
});

it('writes what the review said into scan.json, in English whatever the language on screen (issue 233)', async () => {
  await act(async () => {
    await chooseLocale('fr');
  });
  const downloads = spyDownloads();
  stubShare(false);
  try {
    render(<ScanView session={reviewed()} />);
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: fr.scan.review.useForFingerings })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: fr.scan.review.downloadAll }));
    await vi.waitFor(() => expect(downloads.names).toEqual(['source-scan.zip']));
    const archive = downloads.blobs.find((b) => (b as File).name === 'source-scan.zip')!;
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const summary = JSON.parse(new TextDecoder().decode(entries['scan.json'])) as {
      review: unknown;
    };
    expect(summary.review).toEqual({
      verdict: en.scan.verdict.pages(2),
      usable: true,
      technical: [],
      places: [],
      corrections: 0,
      pages: ['first', 'second'],
    });
  } finally {
    withoutShare();
    downloads.restore();
  }
});

/** The scanner's refusal of a photo: a 422 with its sentence, or without one. */
const refusedAnswer = (message?: string) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        state: 'failed',
        failure: message ? { code: 'not-recognized', message } : { code: 'not-recognized' },
      }),
      { status: 422 },
    ),
  );

it('offers a new photo for the page the scanner refused, with the red, and scans it at once (issue 233)', async () => {
  const replacement = new File([png, 'new'], 'again.png', { type: 'image/png' });
  const service = stubService({
    recognize: (init) =>
      (init.body as File).name === 'two.png'
        ? refusedAnswer('Page too blurry.')
        : Promise.resolve(ready()),
  });
  const { container } = render(<ScanView session={batchOf('one.png', 'two.png', 'three.png')} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/^Page 2: Page too blurry\.$/);
  // Said once: the line under the thumbnails does not repeat the alert.
  expect(screen.getAllByText(/Page too blurry\./)).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Replace page 2 with a new photo' })).toHaveClass(
    'is-red',
  );
  expect(screen.getByRole('button', { name: 'Retry failed pages' })).not.toHaveClass('is-red');
  expect(container.querySelectorAll('.is-red')).toHaveLength(1);
  expect(service.calls('POST')).toHaveLength(3);
  await userEvent.upload(screen.getByLabelText('Replace page 2 with a new photo'), replacement);
  expect(await screen.findByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  // Only the new photo is sent; the other pages keep their recognition and their places.
  const posts = service.calls('POST');
  expect(posts).toHaveLength(4);
  expect((posts[3]![1]!.body as File).name).toBe('again.png');
  const view = useAppStore.getState().view;
  const pages = view.name === 'scan' ? view.session.pages : undefined;
  expect(pages?.map((page) => page.file.name)).toEqual(['one.png', 'again.png', 'three.png']);
  expect(pages?.every((page) => !!page.xml)).toBe(true);
});

it('offers a new photo for a one-photo scan the scanner refused, in its own sentence (issue 233)', async () => {
  stubService({ recognize: () => refusedAnswer() });
  const { container } = render(<ScanView session={freshSession()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.scan.errors.notRecognized);
  expect(screen.getByRole('button', { name: 'Replace it with a new photo' })).toHaveClass('is-red');
  expect(screen.getByRole('button', { name: 'Scan this score' })).not.toHaveClass('is-red');
  expect(container.querySelectorAll('.is-red')).toHaveLength(1);
});

it('says a refusal in the language on screen when it changes (issue 233)', async () => {
  stubService({ recognize: () => refusedAnswer() });
  render(<ScanView session={batchOf('one.png', 'two.png')} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  // Page 2 was refused too: the first is named, and the others are said.
  expect(await screen.findByRole('alert')).toHaveTextContent(
    `${en.scan.pages.pageError(1, en.scan.errors.notRecognized)} ${en.scan.errors.somePagesFailed}`,
  );
  await act(async () => {
    await chooseLocale('fr');
  });
  // Read as written: the French colon follows a no-break space.
  expect(screen.getByRole('alert').textContent).toBe(
    `${fr.scan.pages.pageError(1, fr.scan.errors.notRecognized)} ${fr.scan.errors.somePagesFailed}`,
  );
  expect(screen.getByRole('button', { name: fr.scan.pages.retake(1) })).toHaveClass('is-red');
});

it('offers no new photo when the scanner was out of reach, limited or refused a PDF (issue 233)', async () => {
  stubService({ recognize: () => Promise.reject(new TypeError('Failed to fetch')) });
  const { unmount } = render(<ScanView session={freshSession()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /new photo/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Scan this score' })).toHaveClass('is-red');
  unmount();

  let answered = 0;
  stubService({
    recognize: () =>
      ++answered === 1
        ? refusedAnswer('Page too blurry.')
        : Promise.resolve(new Response(JSON.stringify({ error: 'rate-limited' }), { status: 429 })),
  });
  const second = render(<ScanView session={batchOf('one.png', 'two.png')} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.scan.client.limited);
  expect(screen.queryByRole('button', { name: /new photo/ })).toBeNull();
  second.unmount();

  stubService({ recognize: () => refusedAnswer('Page too blurry.') });
  render(
    <ScanView
      session={{
        id: 'pdf',
        file: new File(['%PDF-1.7'], 'score.pdf', { type: 'application/pdf' }),
      }}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Page too blurry.');
  expect(screen.queryByRole('button', { name: /new photo|again/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Scan this score' })).toHaveClass('is-red');
});

it('opens the camera for the refused page on a touch-only device (issue 233)', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(any-pointer: coarse)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  stubService({
    recognize: (init) =>
      (init.body as File).name === 'two.png'
        ? refusedAnswer('Page too blurry.')
        : Promise.resolve(ready()),
  });
  const { container } = render(<ScanView session={batchOf('one.png', 'two.png')} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/^Page 2: Page too blurry\.$/);
  expect(screen.getByRole('button', { name: 'Photograph page 2 again' })).toHaveClass('is-red');
  expect(screen.getByRole('button', { name: 'Retry failed pages' })).not.toHaveClass('is-red');
  expect(container.querySelectorAll('.is-red')).toHaveLength(1);
});

/** The scanner refuses page 2 of three: the start screen names it and offers its new photo. */
async function refusePage2(recognize?: (init: RequestInit) => Promise<Response>) {
  const service = stubService({
    recognize:
      recognize ??
      ((init) =>
        (init.body as File).name === 'one.png' || (init.body as File).name === 'three.png'
          ? Promise.resolve(ready())
          : refusedAnswer('Page too blurry.')),
  });
  const view = render(<ScanView session={batchOf('one.png', 'two.png', 'three.png')} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  await screen.findByRole('button', { name: 'Replace page 2 with a new photo' });
  return { service, ...view };
}

it('keeps the new photo offered when the photo chosen for it is not one the scanner takes (issue 233)', async () => {
  const { container } = await refusePage2();
  await userEvent.upload(
    screen.getByLabelText('Replace page 2 with a new photo'),
    new File(['not a png'], 'bad.png', { type: 'image/png' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(en.scan.files.contentMismatch);
  expect(screen.getByRole('button', { name: 'Replace page 2 with a new photo' })).toHaveClass(
    'is-red',
  );
  expect(screen.getByRole('button', { name: 'Retry failed pages' })).not.toHaveClass('is-red');
  expect(container.querySelectorAll('.is-red')).toHaveLength(1);
});

it('does not start a second scan for a new photo chosen while a retry already runs (issue 233)', async () => {
  const { service } = await refusePage2();
  // The photo is checked asynchronously; the retry is pressed before that check answers.
  fireEvent.change(screen.getByLabelText('Replace page 2 with a new photo'), {
    target: { files: [new File([png, 'new'], 'again.png', { type: 'image/png' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry failed pages' }));
  await vi.waitFor(() => expect(service.calls('POST')).toHaveLength(4));
  expect(await screen.findByRole('alert')).toHaveTextContent(/^Page 2: Page too blurry\.$/);
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  const sent = service.calls('POST').map(([, init]) => (init!.body as File).name);
  expect(sent).toEqual(['one.png', 'two.png', 'three.png', 'two.png']);
  const view = useAppStore.getState().view;
  expect(
    view.name === 'scan' ? view.session.pages?.map((page) => page.file.name) : undefined,
  ).toEqual(['one.png', 'two.png', 'three.png']);
});

it('keeps the focus on the scan’s controls while a new photo of a refused page is scanned (issue 233)', async () => {
  let answer!: (response: Response) => void;
  await refusePage2((init) => {
    const name = (init.body as File).name;
    if (name === 'again.png')
      return new Promise((resolve) => {
        answer = resolve;
      });
    return name === 'two.png' ? refusedAnswer('Page too blurry.') : Promise.resolve(ready());
  });
  await userEvent.upload(
    screen.getByLabelText('Replace page 2 with a new photo'),
    new File([png, 'new'], 'again.png', { type: 'image/png' }),
  );
  const cancel = await screen.findByRole('button', { name: 'Cancel scan' });
  await vi.waitFor(() => expect(document.activeElement).toBe(cancel));
  answer(
    new Response(
      JSON.stringify({ state: 'failed', failure: { code: 'x', message: 'Still blurry.' } }),
      { status: 422 },
    ),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(/^Page 2: Still blurry\.$/);
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Retry failed pages' }));
});

it('offers a new photo for a page the scanner timed out on, with or without its sentence (issue 233)', async () => {
  const sentence = 'Recognition timed out before a complete score was produced.';
  stubService({
    recognize: () =>
      Promise.resolve(
        new Response(JSON.stringify({ state: 'timed_out', failure: { message: sentence } }), {
          status: 504,
        }),
      ),
  });
  const { unmount } = render(<ScanView session={freshSession()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(sentence);
  expect(screen.getByRole('button', { name: 'Replace it with a new photo' })).toHaveClass('is-red');
  unmount();

  stubService({
    recognize: () =>
      Promise.resolve(new Response(JSON.stringify({ state: 'timed_out' }), { status: 504 })),
  });
  render(<ScanView session={freshSession()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.scan.errors.timedOut);
  expect(screen.getByRole('button', { name: 'Replace it with a new photo' })).toHaveClass('is-red');
});

it('says the other failed pages too when one page was refused and another not answered (issue 233)', async () => {
  const { container } = await refusePage2((init) => {
    const name = (init.body as File).name;
    if (name === 'three.png') return Promise.reject(new TypeError('Failed to fetch'));
    return name === 'two.png' ? refusedAnswer('Page too blurry.') : Promise.resolve(ready());
  });
  expect(screen.getByRole('alert').textContent).toBe(
    `Page 2: Page too blurry. ${en.scan.errors.somePagesFailed}`,
  );
  expect(screen.getByRole('button', { name: 'Replace page 2 with a new photo' })).toHaveClass(
    'is-red',
  );
  expect(container.querySelectorAll('.is-red')).toHaveLength(1);
});

it('takes the new photo away with the refusal when the pages are moved or removed (issue 233)', async () => {
  const first = await refusePage2();
  await userEvent.click(screen.getByRole('button', { name: 'Move page 2 later' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: /new photo/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry failed pages' })).toHaveClass('is-red');
  first.unmount();

  await refusePage2();
  await userEvent.click(screen.getByRole('button', { name: 'Remove page 2' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: /new photo/ })).toBeNull();
});
