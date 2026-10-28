import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReport,
  createShared,
  deleteShared,
  getShared,
  ID_PATTERN,
  listShared,
  newId,
  StoreError,
  type SharedFields,
} from './store.js';

const BASE =
  'https://firestore.googleapis.com/v1/projects/digitus2-library/databases/(default)/documents';
const fields: SharedFields = {
  title: 'T',
  composer: 'C',
  score: 'abc',
  kind: 'scan',
  app: 'dev',
  status: 'waiting',
  link: 'https://marchalmaxim.github.io/digitus2/#/shared/' + 'b'.repeat(32),
};

function answer(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const call = (mock: ReturnType<typeof answer>) => {
  const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit | undefined];
  return {
    url,
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(init.body as string) : null,
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('ids', () => {
  it('are 32 lowercase hex characters, new each time', () => {
    const a = newId();
    expect(a).toMatch(ID_PATTERN);
    expect(newId()).not.toBe(a);
  });
});

describe('request shapes', () => {
  it('creates a shared score with one commit that must not exist yet and a server time', async () => {
    const mock = answer(200);
    await createShared('b'.repeat(32), fields);
    expect(mock).toHaveBeenCalledOnce();
    const { url, method, body } = call(mock);
    expect(url).toBe(`${BASE}:commit`);
    expect(method).toBe('POST');
    expect(body.writes).toHaveLength(1);
    const [write] = body.writes;
    expect(write.currentDocument).toEqual({ exists: false });
    expect(write.updateTransforms).toEqual([
      { fieldPath: 'created', setToServerValue: 'REQUEST_TIME' },
    ]);
    expect(write.update.name).toBe(
      `projects/digitus2-library/databases/(default)/documents/shared/${'b'.repeat(32)}`,
    );
    expect(write.update.fields.title).toEqual({ stringValue: 'T' });
    expect(write.update.fields.created).toBeUndefined();
    expect(Object.keys(write.update.fields).sort()).toEqual(Object.keys(fields).sort());
  });

  it('sends a report as a create in the reports collection', async () => {
    const mock = answer(200);
    await createReport({ score: 'b'.repeat(32), reason: 'copyright', note: '', reply: 'me@x.y' });
    const { body } = call(mock);
    expect(body.writes[0].update.name).toMatch(/\/documents\/reports\/[0-9a-f]{32}$/);
    expect(body.writes[0].update.fields.reason).toEqual({ stringValue: 'copyright' });
  });

  it('reads one score by id, and answers null for a missing one', async () => {
    let mock = answer(200, {
      fields: {
        title: { stringValue: 'T' },
        composer: { stringValue: 'C' },
        score: { stringValue: 'abc' },
        kind: { stringValue: 'scan' },
        status: { stringValue: 'shared' },
      },
    });
    expect(await getShared('b'.repeat(32))).toEqual({
      id: 'b'.repeat(32),
      title: 'T',
      composer: 'C',
      score: 'abc',
      kind: 'scan',
      status: 'shared',
    });
    expect(call(mock)).toMatchObject({ url: `${BASE}/shared/${'b'.repeat(32)}`, method: 'GET' });
    mock = answer(404);
    expect(await getShared('c'.repeat(32))).toBeNull();
    answer(503);
    await expect(getShared('c'.repeat(32))).rejects.toBeInstanceOf(StoreError);
  });

  it('deletes by name; a missing document counts as gone', async () => {
    let mock = answer(200);
    await deleteShared('b'.repeat(32));
    expect(call(mock)).toMatchObject({ url: `${BASE}/shared/${'b'.repeat(32)}`, method: 'DELETE' });
    answer(404);
    await deleteShared('b'.repeat(32));
    answer(403);
    await expect(deleteShared('b'.repeat(32))).rejects.toMatchObject({ status: 403 });
    mock = answer(200);
  });

  it('lists the newest shared scores, with a cursor for the next page', async () => {
    const mock = answer(200, [
      {
        document: {
          name: `projects/p/databases/(default)/documents/shared/${'d'.repeat(32)}`,
          fields: {
            title: { stringValue: 'New' },
            composer: { stringValue: '' },
            created: { timestampValue: '2026-10-27T10:00:00Z' },
          },
        },
      },
      { readTime: '2026-10-27T10:00:01Z' },
    ]);
    const rows = await listShared(20, '2026-10-27T11:00:00Z');
    expect(rows).toEqual([
      { id: 'd'.repeat(32), title: 'New', composer: '', created: '2026-10-27T10:00:00Z' },
    ]);
    const { url, body } = call(mock);
    expect(url).toBe(`${BASE}:runQuery`);
    const q = body.structuredQuery;
    expect(q.from).toEqual([{ collectionId: 'shared' }]);
    expect(q.where.fieldFilter).toEqual({
      field: { fieldPath: 'status' },
      op: 'EQUAL',
      value: { stringValue: 'shared' },
    });
    expect(q.orderBy).toEqual([{ field: { fieldPath: 'created' }, direction: 'DESCENDING' }]);
    expect(q.limit).toBe(20);
    expect(q.select.fields.map((f: { fieldPath: string }) => f.fieldPath)).toEqual([
      'title',
      'composer',
      'created',
    ]);
    expect(q.startAt).toEqual({
      values: [{ timestampValue: '2026-10-27T11:00:00Z' }],
      before: false,
    });
  });

  it('reports an unreachable store as status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await expect(createShared('b'.repeat(32), fields)).rejects.toMatchObject({ status: 0 });
  });
});
