import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { build, formatBuildDay } from '../app/build.js';
import { useAppStore } from '../app/store.js';
import { en } from '../i18n/en/index.js';
import { messages as fr } from '../i18n/fr/index.js';
import { chooseLocale, resetLocaleForTests } from '../i18n/i18n.js';
import type { ScanSession } from './model.js';
import { ScanView } from './ScanView.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const { load, renderNotation } = vi.hoisted(() => ({ load: vi.fn(), renderNotation: vi.fn() }));

// DOM tests have no browser workers; pixel/upload behavior is covered by Playwright.
vi.mock('../engine/client.js', () => ({
  createEngineClient: () => ({
    load,
    dispose: () => {},
  }),
}));
vi.mock('../score/render/renderer.js', () => ({
  createRenderer: () => ({
    render: renderNotation,
    dispose: () => {},
  }),
}));
// pdf.js does not run under jsdom; a PDF page's preview is covered by Playwright.
vi.mock('./PdfPreview.js', () => ({ PdfPreview: () => null }));
beforeEach(() => {
  load.mockReset().mockResolvedValue({ warnings: [], score: { notes: [{}] } });
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
  expect(screen.getByRole('button', { name: 'Page recognition' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Combined score' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Scan this score' })).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('their notation could not be combined');
  expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
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
  await userEvent.click(screen.getByRole('button', { name: 'Page recognition' }));
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
  finishImport({ warnings: [], score: { notes: [{}] } });
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
    if (failure === 'empty') load.mockResolvedValue({ warnings: [], score: { notes: [] } });
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
  expect(screen.getByRole('button', { name: 'Reconnaissance par page' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('leur notation n’a pas pu être combinée');
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

it('stops a batch at a busy answer and keeps the remaining pages for a retry', async () => {
  let answered = 0;
  const service = stubService({
    recognize: () => {
      answered += 1;
      return Promise.resolve(
        answered === 2
          ? new Response(JSON.stringify({ error: 'busy' }), { status: 429 })
          : new Response(
              JSON.stringify({ state: 'ready', xml: scanXml, recognizer: 'Test', warnings: [] }),
            ),
      );
    },
  });
  const file = (name: string) => new File([png], name, { type: 'image/png' });
  render(
    <ScanView
      session={{
        id: 'batch',
        file: file('one.png'),
        pages: [
          { id: 'one', file: file('one.png') },
          { id: 'two', file: file('two.png') },
          { id: 'three', file: file('three.png') },
        ],
      }}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Scan this score' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The scanner is busy with another score. Try again in a minute.',
  );
  // The third page is not sent: it would only meet the same answer.
  expect(service.calls('POST')).toHaveLength(2);
  const view = useAppStore.getState().view;
  const pages = view.name === 'scan' ? view.session.pages : undefined;
  expect(pages?.map((page) => !!page.xml)).toEqual([true, false, false]);
  expect(pages?.slice(1).map((page) => page.error)).toEqual([
    'The scanner is busy with another score. Try again in a minute.',
    'The scanner is busy with another score. Try again in a minute.',
  ]);
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
