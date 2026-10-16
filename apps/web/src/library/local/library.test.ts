import { beforeEach, expect, it, vi } from 'vitest';
import type { LocalScoreRecord } from './records.js';

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
  await vi.waitFor(() => expect(store.getState().notice).toContain('could not be saved'));
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
  await vi.waitFor(() => expect(store.getState().notice).toContain('could not be saved'));
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
