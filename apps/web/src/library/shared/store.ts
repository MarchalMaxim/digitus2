// No imports: the e2e specs import this file under Node, where import.meta.env is undefined.

/** The shared library's store: Firestore over plain REST, in a Google Cloud project of its own. */
export const DEFAULT_LIBRARY_STORE =
  'https://firestore.googleapis.com/v1/projects/digitus2-library/databases/(default)/documents';
/** The store's address; a build or a dev server can name another (the emulator) with VITE_LIBRARY_STORE. */
export const LIBRARY_STORE: string =
  (import.meta.env?.VITE_LIBRARY_STORE as string | undefined) || DEFAULT_LIBRARY_STORE;

/** Where a shared score opens, so the owner can follow the link from the console. */
export const SHARED_LINK_BASE = 'https://marchalmaxim.github.io/digitus2/#/shared/';
/** Where a reader asks for a removal when a report cannot be sent. */
export const REMOVAL_REQUEST_URL =
  'https://github.com/MarchalMaxim/digitus2/issues/new?template=remove-a-score.yml';

export const ID_PATTERN = /^[0-9a-f]{32}$/;
const REQUEST_TIMEOUT_MS = 20_000;

/** The store refused or could not be reached; `status` is the HTTP status, 0 for no answer. */
export class StoreError extends Error {
  constructor(readonly status: number) {
    super(status ? `the shared library answered ${status}` : 'the shared library is unreachable');
    this.name = 'StoreError';
  }
}

/** 128 random bits as 32 lowercase hex characters: the id of a shared score or a report. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SharedFields {
  title: string;
  composer: string;
  /** The MusicXML text, deflated (raw) and in base64. */
  score: string;
  kind: 'scan' | 'file';
  app: string;
  status: 'waiting';
  link: string;
}
export interface SharedScore {
  id: string;
  title: string;
  composer: string;
  score: string;
  kind: 'scan' | 'file';
  status: string;
}
export interface SharedSummary {
  id: string;
  title: string;
  composer: string;
  /** The server's timestamp (RFC 3339), the cursor of the next page. */
  created: string;
}
export interface ReportFields {
  score: string;
  reason: 'copyright' | 'abuse' | 'broken';
  note: string;
  reply: string;
}

interface Value {
  stringValue?: string;
  timestampValue?: string;
}
type Fields = Record<string, Value | undefined>;
interface Doc {
  name?: string;
  fields?: Fields;
}

const stringValues = (fields: object): Record<string, Value> =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: String(v) }]));
const text = (fields: Fields | undefined, key: string) => fields?.[key]?.stringValue ?? '';
const idOf = (doc: Doc) => (doc.name ?? '').split('/').pop() ?? '';

/** `projects/…/documents`: the resource path the commit's document names carry. */
function resourceRoot(): string {
  return new URL(LIBRARY_STORE).pathname.replace(/^\/v1\//, '');
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      ...(typeof AbortSignal.timeout === 'function'
        ? { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
        : {}),
    });
  } catch {
    throw new StoreError(0);
  }
  return response;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** One document, created only when its id is free, with the server's clock for `created`. */
async function create(collection: string, id: string, fields: object): Promise<void> {
  const response = await request(
    `${LIBRARY_STORE}:commit`,
    json({
      writes: [
        {
          update: { name: `${resourceRoot()}/${collection}/${id}`, fields: stringValues(fields) },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'created', setToServerValue: 'REQUEST_TIME' }],
        },
      ],
    }),
  );
  if (!response.ok) throw new StoreError(response.status);
}

export function createShared(id: string, fields: SharedFields): Promise<void> {
  return create('shared', id, fields);
}

export function createReport(fields: ReportFields): Promise<void> {
  return create('reports', newId(), fields);
}

/** The shared score with this id, or null when there is none. */
export async function getShared(id: string): Promise<SharedScore | null> {
  const response = await request(`${LIBRARY_STORE}/shared/${id}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new StoreError(response.status);
  const doc = (await response.json()) as Doc;
  const kind = text(doc.fields, 'kind');
  return {
    id,
    title: text(doc.fields, 'title'),
    composer: text(doc.fields, 'composer'),
    score: text(doc.fields, 'score'),
    kind: kind === 'scan' ? 'scan' : 'file',
    status: text(doc.fields, 'status'),
  };
}

/** Takes a waiting upload back. A score the owner already shared is refused by the store. */
export async function deleteShared(id: string): Promise<void> {
  const response = await request(`${LIBRARY_STORE}/shared/${id}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new StoreError(response.status);
}

/** The newest shared scores, `limit` of them, after the `created` cursor of the page before. */
export async function listShared(limit: number, after?: string): Promise<SharedSummary[]> {
  const response = await request(
    `${LIBRARY_STORE}:runQuery`,
    json({
      structuredQuery: {
        from: [{ collectionId: 'shared' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'EQUAL',
            value: { stringValue: 'shared' },
          },
        },
        orderBy: [{ field: { fieldPath: 'created' }, direction: 'DESCENDING' }],
        limit,
        select: {
          fields: [{ fieldPath: 'title' }, { fieldPath: 'composer' }, { fieldPath: 'created' }],
        },
        ...(after ? { startAt: { values: [{ timestampValue: after }], before: false } } : {}),
      },
    }),
  );
  if (!response.ok) throw new StoreError(response.status);
  const rows = (await response.json()) as Array<{ document?: Doc }>;
  return rows.flatMap(({ document }) =>
    document
      ? [
          {
            id: idOf(document),
            title: text(document.fields, 'title'),
            composer: text(document.fields, 'composer'),
            created: document.fields?.created?.timestampValue ?? '',
          },
        ]
      : [],
  );
}
