import { FILE_NOT_RESTORABLE_NOTICE } from '../../app/routes.js';
import { useAppStore, type View } from '../../app/store.js';
import type { ScanSession } from '../../scan/model.js';
import type { Shareable } from '../shared/eligibility.js';
import { LocalScoreDatabase } from './database.js';
import { restoreSession, storeSession, type LocalScoreRecord } from './records.js';
import { useLocalLibrary, type LocalScoreSummary } from './state.js';

const records = new Map<string, LocalScoreRecord>();
const saved = new Set<string>();
const removed = new Set<string>();
const snapshots = new Map<string, object>();
const fileIds = new WeakMap<Uint8Array, string>();
let database: LocalScoreDatabase | undefined;
let queue = Promise.resolve();
/** The first read of the stored scores; an address that names one waits for it (`openLocalAt`). */
let ready: Promise<void> = Promise.resolve();
let failed = false;
let installed = false;
let openRequest = 0;
// Sharing (issue 132). What the shared library said about a record's upload this visit, and what
// the engine made of a record's source (null: it cannot be shared); both are read when My scores
// is opened, never at page load.
const remote = new Map<string, 'waiting' | 'shared' | 'none'>();
const verdicts = new WeakMap<object, Shareable | null>();
const statusChecked = new Set<string>();
let checking = Promise.resolve();
const sourceOf = (record: LocalScoreRecord): object =>
  record.kind === 'file' ? record.blob : record.session;

function sharingOf(record: LocalScoreRecord): LocalScoreSummary['sharing'] {
  const state = remote.get(record.id);
  if (record.shared) return state === 'waiting' || state === 'shared' ? state : undefined;
  if (!verdicts.get(sourceOf(record))) return undefined;
  return state === 'none' ? 'again' : 'can';
}

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
        detail:
          record.kind === 'file'
            ? 'file'
            : !record.session.xml
              ? 'draft'
              : record.session.corrections?.length
                ? 'corrected'
                : 'recognition',
        saved: saved.has(record.id),
        ...(sharingOf(record) ? { sharing: sharingOf(record) } : {}),
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
    // A score opened with a record id of its own (a file chosen or dropped, or reopened by its
    // address) is saved under it, so the address '#/mine/<id>' finds it after a reload.
    let id = source.localId ? `file:${source.localId}` : fileIds.get(source.bytes);
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
  // A corrected scan stays the upload it was shared as.
  const shared = records.get(record.id)?.shared;
  if (shared) record = { ...record, shared };
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
    ready = database
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
    queue = ready;
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
      // The saved file is read before the score view can start: the loader shows meanwhile.
      useAppStore.getState().setOpening('chosen');
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      if (!current() || records.get(id) !== record || removed.has(id)) return;
      fileIds.set(bytes, id);
      snapshots.set(id, bytes);
      useAppStore.getState().openPiece({
        kind: 'file',
        name: record.name,
        bytes,
        localId: id.slice('file:'.length),
      });
    }
  } catch {
    if (!current() || records.get(id) !== record || removed.has(id)) return;
    useAppStore.getState().setNotice((t) => t.library.myScores.openFailed);
  } finally {
    // A read that ended without a score (a failure, or a newer request) takes the loader away.
    if (request === openRequest && useAppStore.getState().opening === 'chosen')
      useAppStore.getState().setOpening(null);
  }
}

/** How long an address waits for My scores to be read before it gives up (issue 242). */
const READ_TIMEOUT_MS = 8000;

/**
 * From an address ('#/mine/<id>' or '#/scan/<id>', after a reload or followed): reopens the saved
 * score (`as` 'score': a file, or the score of a scan) or the scan under review (`as` 'review')
 * once My scores has been read, unless the address has changed meanwhile (issue 242). A score that
 * is not there, cannot be read, or whose read does not finish puts the library on screen with the
 * notice that it is opened from My scores, and the address back to the library's. Nothing is
 * written: the record stays as it was.
 */
export async function openLocalAt(
  store: typeof useAppStore,
  uuid: string,
  hash: string,
  as: 'score' | 'review' = 'score',
): Promise<void> {
  installLocalLibrary();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    ready,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, READ_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  const gone = () => {
    const { view } = store.getState();
    return (
      location.hash !== hash ||
      (as === 'review'
        ? view.name === 'scan' && view.session.id === uuid
        : view.name === 'score' &&
          view.source.kind === 'file' &&
          (view.source.localId === uuid || view.source.scan?.id === uuid))
    );
  };
  if (gone()) return;
  const fileId = `file:${uuid}`;
  const scanId = `scan:${uuid}`;
  const record =
    as === 'review' ? records.get(scanId) : (records.get(fileId) ?? records.get(scanId));
  const still = () => !!record && records.get(record.id) === record && !removed.has(record.id);
  if (record?.kind === 'file' && still()) {
    let bytes: Uint8Array | null = null;
    try {
      bytes = new Uint8Array(await record.blob.arrayBuffer());
    } catch {
      bytes = null;
    }
    if (gone()) return;
    if (bytes && still()) {
      fileIds.set(bytes, fileId);
      snapshots.set(fileId, bytes);
      store.setState({
        notice: null,
        view: { name: 'score', source: { kind: 'file', name: record.name, bytes, localId: uuid } },
      });
      return;
    }
  } else if (record?.kind === 'scan' && still()) {
    let session: ScanSession | null = null;
    try {
      session = restoreSession(record.session);
    } catch {
      session = null;
    }
    if (session && as === 'review') {
      snapshots.set(scanId, session);
      store.setState({ notice: null, view: { name: 'scan', session } });
      return;
    }
    if (session?.xml) {
      // The score the scan's "Use" opened: the recognition with its corrections applied.
      let xml = session.xml;
      try {
        const { applyCorrections } = await import('../../scan/corrections.js');
        xml = applyCorrections(session.xml, session.corrections ?? []).xml;
      } catch {
        xml = session.xml;
      }
      if (gone()) return;
      if (still()) {
        snapshots.set(scanId, session);
        store.setState({
          notice: null,
          view: {
            name: 'score',
            source: {
              kind: 'file',
              name: session.file.name.replace(/\.[^.]+$/, '') + '.musicxml',
              bytes: new TextEncoder().encode(xml),
              scan: session,
            },
          },
        });
        return;
      }
    }
  }
  history.replaceState(history.state, '', '#/');
  store.setState({
    notice: FILE_NOT_RESTORABLE_NOTICE,
    opening: null,
    view: { name: 'library' },
  });
}

export function removeLocalScore(id: string) {
  removed.add(id);
  records.delete(id);
  saved.delete(id);
  snapshots.delete(id);
  publish();
  write(id);
}

function replace(record: LocalScoreRecord, next: LocalScoreRecord) {
  records.set(record.id, next);
  write(next);
  publish();
}
function withoutShared(record: LocalScoreRecord): LocalScoreRecord {
  const next = { ...record };
  delete next.shared;
  return next;
}

/**
 * On the first opening of My scores in a visit: asks the shared library once what became of each
 * upload, and has the engine read each candidate row once, so Share shows only where it can work.
 * A store that cannot be reached says nothing and is asked again at the next opening.
 */
export function checkSharing(): Promise<void> {
  checking = checking.then(async () => {
    const [{ getShared }, { shareableOf }, { services }] = await Promise.all([
      import('../shared/store.js'),
      import('../shared/eligibility.js'),
      import('../../score/useScoreDocument.js'),
    ]);
    for (const record of [...records.values()]) {
      if (records.get(record.id) !== record) continue;
      if (record.shared && !statusChecked.has(record.id)) {
        statusChecked.add(record.id);
        try {
          const found = await getShared(record.shared.id);
          if (records.get(record.id) !== record) continue;
          if (found) remote.set(record.id, found.status === 'shared' ? 'shared' : 'waiting');
          else {
            remote.set(record.id, 'none');
            replace(record, withoutShared(record));
          }
        } catch {
          statusChecked.delete(record.id);
        }
        publish();
      }
      const current = records.get(record.id);
      if (current && !current.shared && !verdicts.has(sourceOf(current))) {
        verdicts.set(sourceOf(current), await shareableOf(current, services.engine));
        publish();
      }
    }
  });
  return checking;
}

/** What the share sheet starts from: the title and composer the MusicXML names. */
export async function shareDraft(id: string): Promise<{ title: string; composer: string } | null> {
  const record = records.get(id);
  const verdict = record && verdicts.get(sourceOf(record));
  if (!verdict) return null;
  return (await import('../shared/payload.js')).prefill(verdict.xml);
}

/** Uploads the score for review; the row then reads Waiting. Throws `ScoreTooLarge` or `StoreError`. */
export async function shareLocalScore(id: string, title: string, composer: string): Promise<void> {
  const record = records.get(id);
  const verdict = record && verdicts.get(sourceOf(record));
  if (!record || !verdict) throw new Error('this score cannot be shared');
  const [{ buildShare }, { createShared, deleteShared, newId }] = await Promise.all([
    import('../shared/payload.js'),
    import('../shared/store.js'),
  ]);
  const shareId = newId();
  const fields = await buildShare(shareId, {
    title,
    composer,
    xml: verdict.xml,
    kind: verdict.kind,
  });
  await createShared(shareId, fields);
  const current = records.get(id);
  if (!current) {
    // Removed from My scores while it was being sent: nothing could withdraw it later.
    void deleteShared(shareId).catch(() => {});
    return;
  }
  statusChecked.add(id);
  remote.set(id, 'waiting');
  replace(current, { ...current, shared: { id: shareId } });
}

/** Takes the waiting upload back; the row returns to its plain state. Throws `StoreError`. */
export async function withdrawLocalScore(id: string): Promise<void> {
  const record = records.get(id);
  if (!record?.shared) return;
  const { deleteShared } = await import('../shared/store.js');
  await deleteShared(record.shared.id);
  const current = records.get(id);
  remote.delete(id);
  statusChecked.delete(id);
  if (current) replace(current, withoutShared(current));
}
