import { useAppStore, type View } from '../../app/store.js';
import { LocalScoreDatabase } from './database.js';
import { restoreSession, storeSession, type LocalScoreRecord } from './records.js';
import { useLocalLibrary } from './state.js';

const records = new Map<string, LocalScoreRecord>();
const saved = new Set<string>();
const removed = new Set<string>();
const snapshots = new Map<string, object>();
const fileIds = new WeakMap<Uint8Array, string>();
let database: LocalScoreDatabase | undefined;
let queue = Promise.resolve();
let failed = false;
let installed = false;
let openRequest = 0;

function publish() {
  useLocalLibrary.setState({
    failed,
    items: [...records.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((record) => ({
        id: record.id,
        name:
          record.kind === 'file'
            ? record.name
            : (record.session.pages?.[0]?.originalFile?.name ?? record.session.file.name),
        detail: record.kind === 'file' ? 'file' : record.session.xml ? 'recognition' : 'draft',
        saved: saved.has(record.id),
      })),
  });
}
function storageFailed(removing = false) {
  failed = true;
  publish();
  if (removing || records.size)
    useAppStore
      .getState()
      .setNotice(
        removing
          ? (t) => t.library.myScores.removedNotErased
          : (t) => t.library.myScores.saveFailed,
      );
}
function write(record: LocalScoreRecord | string) {
  // One FIFO covers puts and deletes; an older put can never finish after a newer delete.
  queue = queue.then(async () => {
    if (typeof record !== 'string' && (removed.has(record.id) || records.get(record.id) !== record))
      return;
    try {
      await database!.write(record);
      if (typeof record !== 'string' && records.get(record.id) === record) saved.add(record.id);
      publish();
    } catch {
      storageFailed(typeof record === 'string');
    }
  });
}
function capture(view: View) {
  const session =
    view.name === 'scan'
      ? view.session
      : view.name === 'score' && view.source.kind === 'file'
        ? view.source.scan
        : undefined;
  let record: LocalScoreRecord;
  let snapshot: object;
  if (session) {
    const id = `scan:${session.id}`;
    if (removed.has(id) || snapshots.get(id) === session) return;
    snapshot = session;
    record = {
      version: 1,
      id,
      updatedAt: Date.now(),
      kind: 'scan',
      session: storeSession(session),
    };
  } else if (view.name === 'score' && view.source.kind === 'file') {
    const source = view.source;
    let id = fileIds.get(source.bytes);
    if (!id) {
      id = `file:${crypto.randomUUID()}`;
      fileIds.set(source.bytes, id);
    }
    if (removed.has(id) || snapshots.get(id) === source.bytes) return;
    snapshot = source.bytes;
    record = {
      version: 1,
      id,
      updatedAt: Date.now(),
      kind: 'file',
      name: source.name,
      blob: new Blob([new Uint8Array(source.bytes)]),
    };
  } else return;
  snapshots.set(record.id, snapshot);
  records.set(record.id, record);
  saved.delete(record.id);
  publish();
  if (failed) storageFailed();
  else write(record);
}

/** Installed once after App mounts; only changed views can schedule persistence. */
export function installLocalLibrary() {
  if (installed) return;
  installed = true;
  try {
    database = new LocalScoreDatabase();
    queue = database
      .read()
      .then((rows) => {
        for (const row of rows)
          if (!records.has(row.id) && !removed.has(row.id)) {
            records.set(row.id, row);
            saved.add(row.id);
          }
        publish();
      })
      .catch(() => storageFailed());
  } catch {
    storageFailed();
  }
  useAppStore.subscribe((state, previous) => {
    if (state.view !== previous.view) capture(state.view);
  });
  capture(useAppStore.getState().view);
}

export async function openLocalScore(id: string, expectedView = useAppStore.getState().view) {
  if (useAppStore.getState().view !== expectedView) return;
  const request = ++openRequest;
  const current = () => request === openRequest && useAppStore.getState().view === expectedView;
  const record = records.get(id);
  if (!record) return;
  try {
    useAppStore.getState().setNotice(null);
    if (record.kind === 'scan') {
      const session = restoreSession(record.session);
      snapshots.set(id, session);
      useAppStore.getState().openScan(session);
    } else {
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      if (!current() || records.get(id) !== record || removed.has(id)) return;
      fileIds.set(bytes, id);
      snapshots.set(id, bytes);
      useAppStore.getState().openPiece({ kind: 'file', name: record.name, bytes });
    }
  } catch {
    if (!current() || records.get(id) !== record || removed.has(id)) return;
    useAppStore.getState().setNotice((t) => t.library.myScores.openFailed);
  }
}
export function removeLocalScore(id: string) {
  removed.add(id);
  records.delete(id);
  saved.delete(id);
  snapshots.delete(id);
  publish();
  write(id);
}
