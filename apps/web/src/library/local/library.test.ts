import { beforeEach, expect, it, vi } from 'vitest';
import { en } from '../../i18n/en/index.js';
import type { Phrase } from '../../i18n/messages.js';
import type { LocalScoreRecord } from './records.js';

/** The notice as the reader sees it: a Phrase is written in English here. */
const noticeText = (notice: string | Phrase | null) =>
  typeof notice === 'function' ? notice(en) : notice;

const fixture = vi.hoisted(() => ({
  rows: [] as unknown[],
  disk: new Map<string, LocalScoreRecord>(),
  gate: undefined as Promise<void> | undefined,
  readGate: undefined as Promise<void> | undefined,
  readError: undefined as Error | undefined,
  writeError: undefined as Error | undefined,
  completed: 0,
  started: 0,
}));
vi.mock('./database.js', () => ({
  LocalScoreDatabase: class {
    async read() {
      await fixture.readGate;
      if (fixture.readError) throw fixture.readError;
      return fixture.rows;
    }
    async write(record: LocalScoreRecord | string) {
      fixture.started++;
      await fixture.gate;
      if (fixture.writeError) throw fixture.writeError;
      if (typeof record === 'string') fixture.disk.delete(record);
      else fixture.disk.set(record.id, record);
      fixture.completed++;
    }
  },
}));
beforeEach(() => {
  vi.resetModules();
  fixture.rows = [];
  fixture.disk.clear();
  fixture.gate = undefined;
  fixture.readGate = undefined;
  fixture.readError = undefined;
  fixture.writeError = undefined;
  fixture.started = 0;
  fixture.completed = 0;
});

async function setup() {
  let resolve!: (value: ArrayBuffer) => void;
  let reject!: (reason: Error) => void;
  const blob = new Blob(['slow score']);
  Object.defineProperty(blob, 'arrayBuffer', {
    value: () =>
      new Promise<ArrayBuffer>((done, fail) => {
        resolve = done;
        reject = fail;
      }),
  });
  fixture.rows = [
    { version: 1, id: 'slow', updatedAt: 1, kind: 'file', name: 'slow.musicxml', blob },
  ];
  const library = await import('./library.js');
  const { useAppStore } = await import('../../app/store.js');
  library.installLocalLibrary();
  await vi.waitFor(async () => {
    const { useLocalLibrary } = await import('./state.js');
    expect(useLocalLibrary.getState().items).toHaveLength(1);
  });
  return {
    library,
    store: useAppStore,
    resolve: () => resolve(new TextEncoder().encode('slow score').buffer),
    reject: () => reject(new Error('File read failed')),
  };
}

it('a delayed saved-file read cannot replace newer navigation', async () => {
  const { library, store, resolve } = await setup();
  const opening = library.openLocalScore('slow');
  store.getState().openPiece({ kind: 'library', slug: 'ode-to-joy' });
  resolve();
  await opening;
  expect(store.getState().view).toEqual({
    name: 'score',
    source: { kind: 'library', slug: 'ode-to-joy' },
  });
});

it('only the latest saved-file selection may finish opening', async () => {
  const { library, store, resolve } = await setup();
  const first = library.openLocalScore('slow');
  // Even a subsequent selection that cannot open cancels the previous selection's intent.
  await library.openLocalScore('missing');
  resolve();
  await first;
  expect(store.getState().view.name).toBe('library');
});

it('a rejected read of a removed score cannot show a stale error', async () => {
  const { library, store, reject } = await setup();
  const opening = library.openLocalScore('slow');
  library.removeLocalScore('slow');
  reject();
  await opening;
  expect(store.getState().notice).toBeNull();
});

it('a pending save cannot resurrect an item removed before the write completes', async () => {
  const { library, store } = await setup();
  let release!: () => void;
  fixture.gate = new Promise<void>((done) => {
    release = done;
  });
  store.getState().openScan({ id: 'draft', file: new File(['pixels'], 'piano.png') });
  await vi.waitFor(() => expect(fixture.started).toBe(1));
  library.removeLocalScore('scan:draft');
  release();
  await vi.waitFor(() => expect(fixture.completed).toBe(2));
  expect(fixture.disk.has('scan:draft')).toBe(false);
  // Revisiting still-live provenance after removing it does not silently save it again.
  const session = store.getState().view;
  store.getState().openLibrary();
  store.setState({ view: session });
  await Promise.resolve();
  expect(fixture.started).toBe(2);
});

it('queued scan edits retain the newest notation instead of an older snapshot', async () => {
  const { store } = await setup();
  let release!: () => void;
  fixture.gate = new Promise<void>((done) => {
    release = done;
  });
  const file = new File(['pixels'], 'piano.png');
  store.getState().openScan({ id: 'draft', file });
  await vi.waitFor(() => expect(fixture.started).toBe(1));
  store.getState().openScan({ id: 'draft', file, xml: '<older/>' });
  store.getState().openScan({ id: 'draft', file, xml: '<newest/>' });
  release();
  await vi.waitFor(() => expect(fixture.completed).toBe(2));
  const record = fixture.disk.get('scan:draft');
  expect(record?.kind === 'scan' && record.session.xml).toBe('<newest/>');
});

it('quota failure retains the current scan and reports that it is not saved', async () => {
  const { store } = await setup();
  fixture.writeError = new DOMException('Full', 'QuotaExceededError');
  const session = { id: 'draft', file: new File(['pixels'], 'piano.png') };
  store.getState().openScan(session);
  await vi.waitFor(() =>
    expect(noticeText(store.getState().notice)).toContain('could not be saved'),
  );
  expect(store.getState().view).toEqual({ name: 'scan', session });
  const { useLocalLibrary } = await import('./state.js');
  expect(useLocalLibrary.getState().items.find((item) => item.id === 'scan:draft')?.saved).toBe(
    false,
  );
  expect(fixture.disk.has('scan:draft')).toBe(false);
});

it('a failed initial read keeps a newly uploaded draft usable and explains the fallback', async () => {
  fixture.readError = new DOMException('Blocked', 'SecurityError');
  const library = await import('./library.js');
  const { useAppStore: store } = await import('../../app/store.js');
  library.installLocalLibrary();
  const session = { id: 'draft', file: new File(['pixels'], 'piano.png') };
  store.getState().openScan(session);
  await vi.waitFor(() =>
    expect(noticeText(store.getState().notice)).toContain('could not be saved'),
  );
  expect(store.getState().view).toEqual({ name: 'scan', session });
  const { useLocalLibrary } = await import('./state.js');
  expect(useLocalLibrary.getState().items[0]?.name).toBe('piano.png');
});

it('hydration cannot restore a draft removed while the initial read was pending', async () => {
  let release!: () => void;
  fixture.readGate = new Promise<void>((done) => {
    release = done;
  });
  const session = { id: 'draft', file: new File(['pixels'], 'piano.png') };
  const { storeSession } = await import('./records.js');
  fixture.rows = [
    { version: 1, id: 'scan:draft', updatedAt: 1, kind: 'scan', session: storeSession(session) },
  ];
  const library = await import('./library.js');
  const { useAppStore: store } = await import('../../app/store.js');
  const { useLocalLibrary } = await import('./state.js');
  library.installLocalLibrary();
  store.getState().openScan({ ...session, xml: '<new/>' });
  library.removeLocalScore('scan:draft');
  release();
  await vi.waitFor(() => expect(fixture.completed).toBe(1));
  expect(useLocalLibrary.getState().items).toEqual([]);
  expect(fixture.disk.has('scan:draft')).toBe(false);
});

it.each([
  ['oldest first', [1, 5, 3]],
  ['newest first', [5, 3, 1]],
])('lists saved items newest first, whichever way the disk returns them (%s)', async (_, times) => {
  fixture.rows = times.map((updatedAt) => ({
    version: 1,
    id: `at-${updatedAt}`,
    updatedAt,
    kind: 'file',
    name: `at-${updatedAt}.musicxml`,
    blob: new Blob(['score']),
  }));
  const library = await import('./library.js');
  const { useLocalLibrary } = await import('./state.js');
  library.installLocalLibrary();
  await vi.waitFor(() => expect(useLocalLibrary.getState().items).toHaveLength(3));
  expect(useLocalLibrary.getState().items.map((item) => item.id)).toEqual(['at-5', 'at-3', 'at-1']);
});

const UUID = '0b6f1c64-8a52-4d3e-9a7b-3f2c1d4e5a60';

async function saved(hash = `#/mine/${UUID}`) {
  fixture.rows = [
    {
      version: 1,
      id: `file:${UUID}`,
      updatedAt: 1,
      kind: 'file',
      name: 'mine.musicxml',
      blob: new Blob(['my score']),
    },
  ];
  location.hash = hash;
  const library = await import('./library.js');
  const { useAppStore } = await import('../../app/store.js');
  useAppStore.setState({ view: { name: 'library' }, notice: null });
  useAppStore.getState().setOpening('address');
  return { library, store: useAppStore, hash };
}

it('an address reopens the saved score with its name, bytes and record id, and writes nothing', async () => {
  const { library, store, hash } = await saved();
  await library.openLocalAt(store, UUID, hash);
  const view = store.getState().view;
  expect(view).toMatchObject({
    name: 'score',
    source: { kind: 'file', name: 'mine.musicxml', localId: UUID },
  });
  const source = (view as { source: { bytes: Uint8Array } }).source;
  expect(new TextDecoder().decode(source.bytes)).toBe('my score');
  expect(store.getState().opening).toBeNull();
  await Promise.resolve();
  expect(fixture.started).toBe(0);
});

it('an address that names no saved score gives the library, the notice and the library address', async () => {
  const { library, store } = await saved();
  const other = '#/mine/11111111-2222-4333-8444-555555555555';
  location.hash = other;
  await library.openLocalAt(store, '11111111-2222-4333-8444-555555555555', other);
  expect(store.getState().view).toEqual({ name: 'library' });
  expect(noticeText(store.getState().notice)).toBe(
    'Open it from My scores, or choose the file again.',
  );
  expect(store.getState().opening).toBeNull();
  expect(location.hash).toBe('#/');
});

it('an address that changed meanwhile is left alone', async () => {
  const { library, store, hash } = await saved();
  location.hash = '#/about';
  await library.openLocalAt(store, UUID, hash);
  expect(store.getState().view).toEqual({ name: 'library' });
  expect(store.getState().notice).toBeNull();
});

it('an address put back to the library by #keep-scans during the restore ends the loader', async () => {
  const { library, store, hash } = await saved();
  // The switch is applied without the hash handler: the address is the library's again.
  location.hash = '#/';
  await library.openLocalAt(store, UUID, hash);
  expect(store.getState().view).toEqual({ name: 'library' });
  expect(store.getState().opening).toBeNull();
});

it('an address that names another saved score keeps the loader for its own restore', async () => {
  const { library, store, hash } = await saved();
  location.hash = '#/mine/11111111-2222-4333-8444-555555555555';
  await library.openLocalAt(store, UUID, hash);
  expect(store.getState().opening).toBe('address');
});

it('waits for the stored scores to be read before it looks', async () => {
  let release!: () => void;
  fixture.readGate = new Promise<void>((done) => {
    release = done;
  });
  const { library, store, hash } = await saved();
  const reopening = library.openLocalAt(store, UUID, hash);
  await Promise.resolve();
  expect(store.getState().view).toEqual({ name: 'library' });
  release();
  await reopening;
  expect(store.getState().view.name).toBe('score');
});

it('a score opened with a record id is saved under it', async () => {
  const { library, store } = await setup();
  library.installLocalLibrary();
  store.getState().openPiece({
    kind: 'file',
    name: 'new.musicxml',
    bytes: new TextEncoder().encode('new'),
    localId: UUID,
  });
  await vi.waitFor(() => expect(fixture.disk.has(`file:${UUID}`)).toBe(true));
  expect(fixture.disk.get(`file:${UUID}`)).toMatchObject({ kind: 'file', name: 'new.musicxml' });
});

async function savedScan(
  xml: string | null = '<score-partwise version="3.1"><part-list/></score-partwise>',
) {
  const { storeSession } = await import('./records.js');
  const session = {
    id: UUID,
    file: new File(['png'], 'page.png', { type: 'image/png' }),
    xml: xml ?? undefined,
  };
  fixture.rows = [
    { version: 1, id: `scan:${UUID}`, updatedAt: 1, kind: 'scan', session: storeSession(session) },
  ];
  const library = await import('./library.js');
  const { useAppStore } = await import('../../app/store.js');
  useAppStore.setState({ view: { name: 'library' }, notice: null });
  return { library, store: useAppStore };
}

it('a scan address reopens the scan under review, and writes nothing', async () => {
  const { library, store } = await savedScan();
  const hash = `#/scan/${UUID}`;
  location.hash = hash;
  await library.openLocalAt(store, UUID, hash, 'review');
  expect(store.getState().view).toMatchObject({ name: 'scan', session: { id: UUID } });
  await Promise.resolve();
  expect(fixture.started).toBe(0);
});

it('the address of a scan-derived score reopens its score with the scan as its source', async () => {
  const { library, store } = await savedScan();
  const hash = `#/mine/${UUID}`;
  location.hash = hash;
  await library.openLocalAt(store, UUID, hash);
  const view = store.getState().view;
  expect(view).toMatchObject({
    name: 'score',
    source: { kind: 'file', name: 'page.musicxml', scan: { id: UUID } },
  });
  const source = (view as { source: { bytes: Uint8Array } }).source;
  expect(new TextDecoder().decode(source.bytes)).toContain('score-partwise');
  await Promise.resolve();
  expect(fixture.started).toBe(0);
});

it('a scan with no recognition has no score to reopen: the notice and the library', async () => {
  const { library, store } = await savedScan(null);
  const hash = `#/mine/${UUID}`;
  location.hash = hash;
  await library.openLocalAt(store, UUID, hash);
  expect(store.getState().view).toEqual({ name: 'library' });
  expect(noticeText(store.getState().notice)).toBe(
    'Open it from My scores, or choose the file again.',
  );
});

it('an address gives up on a read of My scores that never finishes', async () => {
  vi.useFakeTimers();
  try {
    fixture.readGate = new Promise<void>(() => undefined);
    const { library, store, hash } = await saved();
    const reopening = library.openLocalAt(store, UUID, hash);
    await vi.advanceTimersByTimeAsync(8000);
    await reopening;
    expect(store.getState().view).toEqual({ name: 'library' });
    expect(noticeText(store.getState().notice)).toBe(
      'Open it from My scores, or choose the file again.',
    );
    expect(store.getState().opening).toBeNull();
    expect(location.hash).toBe('#/');
  } finally {
    vi.useRealTimers();
  }
});

it('a saved file shows the loader while it is read, and a failed read takes it away', async () => {
  const { library, store, reject } = await setup();
  const opening = library.openLocalScore('slow');
  expect(store.getState().opening).toBe('chosen');
  reject();
  await opening;
  expect(store.getState().opening).toBeNull();
  expect(noticeText(store.getState().notice)).not.toBeNull();
});

it('a saved file whose read never finishes gives the library back with the notice', async () => {
  const { library, store } = await setup();
  vi.useFakeTimers();
  try {
    const opening = library.openLocalScore('slow');
    expect(store.getState().opening).toBe('chosen');
    await vi.advanceTimersByTimeAsync(8000);
    await opening;
    expect(store.getState().opening).toBeNull();
    expect(store.getState().view).toEqual({ name: 'library' });
    expect(noticeText(store.getState().notice)).not.toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('an address whose saved file never finishes reading gives the library back with the notice', async () => {
  const blob = new Blob(['my score']);
  Object.defineProperty(blob, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(() => {}) });
  fixture.rows = [
    { version: 1, id: `file:${UUID}`, updatedAt: 1, kind: 'file', name: 'mine.musicxml', blob },
  ];
  const hash = `#/mine/${UUID}`;
  location.hash = hash;
  const library = await import('./library.js');
  const { useAppStore } = await import('../../app/store.js');
  useAppStore.setState({ view: { name: 'library' }, notice: null });
  useAppStore.getState().setOpening('address');
  vi.useFakeTimers();
  try {
    const reopening = library.openLocalAt(useAppStore, UUID, hash);
    await vi.advanceTimersByTimeAsync(8000);
    await reopening;
    expect(useAppStore.getState().view).toEqual({ name: 'library' });
    expect(noticeText(useAppStore.getState().notice)).toBe(
      'Open it from My scores, or choose the file again.',
    );
    expect(useAppStore.getState().opening).toBeNull();
    expect(location.hash).toBe('#/');
  } finally {
    vi.useRealTimers();
  }
});
