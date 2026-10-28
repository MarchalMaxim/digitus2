// The store's security rules, exercised through Firestore's REST API exactly as the app calls it
// (no SDK), against the emulator. Run by `node library-store/run-rules-tests.mjs`, which starts the
// emulator; FIRESTORE_EMULATOR_HOST names it. Requests without a token are a reader's; requests with
// "Bearer owner" are the emulator's admin, standing in for the owner's console.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, beforeEach, test } from 'node:test';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set; run run-rules-tests.mjs');
const project = 'digitus2-library';
const root = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const LINK = 'https://marchalmaxim.github.io/digitus2/#/shared/';

const hex = () => randomBytes(16).toString('hex');
const str = (value) => ({ stringValue: value });

function request(method, url, body, owner = false) {
  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(owner ? { Authorization: 'Bearer owner' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The app's create: one write that must not overwrite, `created` set to the request time. */
function create(collection, id, fields, { serverTime = true } = {}) {
  const name = `projects/${project}/databases/(default)/documents/${collection}/${id}`;
  return request('POST', `${root}:commit`, {
    writes: [
      {
        update: { name, fields },
        currentDocument: { exists: false },
        ...(serverTime
          ? { updateTransforms: [{ fieldPath: 'created', setToServerValue: 'REQUEST_TIME' }] }
          : {}),
      },
    ],
  });
}

function upload(id, overrides = {}) {
  return {
    title: str('Minuet in G'),
    composer: str('Christian Petzold'),
    score: str('q1ZKzs8rSc0rUbJSSs7PS8tMzyjRT0nNS8nMS1eyMjS0tFAKz8nPS8/MS1eyNjI'),
    kind: str('file'),
    app: str('0.1.0'),
    status: str('waiting'),
    link: str(LINK + id),
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    score: str(hex()),
    reason: str('broken'),
    note: str(''),
    reply: str(''),
    ...overrides,
  };
}

const setStatus = (id, status) =>
  request(
    'PATCH',
    `${root}/shared/${id}?updateMask.fieldPaths=status`,
    { fields: { status: str(status) } },
    true,
  );

const listShared = (status = 'shared', limit = 5) =>
  request('POST', `${root}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: 'shared' }],
      where: {
        fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: str(status) },
      },
      orderBy: [{ field: { fieldPath: 'created' }, direction: 'DESCENDING' }],
      limit,
      select: { fields: [{ fieldPath: 'title' }, { fieldPath: 'composer' }] },
    },
  });

beforeEach(async () => {
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.equal(response.status, 200);
});
after(() => {});

test('a well-formed upload is accepted, waiting, and readable by its id', async () => {
  const id = hex();
  assert.equal((await create('shared', id, upload(id))).status, 200);
  const got = await request('GET', `${root}/shared/${id}`);
  assert.equal(got.status, 200);
  const doc = await got.json();
  assert.equal(doc.fields.status.stringValue, 'waiting');
  assert.ok(doc.fields.created.timestampValue);
});

test('every malformed upload is refused', async () => {
  const id = hex();
  const cases = {
    'an extra field': upload(id, { name: str('IMG_2041.jpg') }),
    'a missing field': (() => {
      const { app, ...rest } = upload(id);
      void app;
      return rest;
    })(),
    'an empty title': upload(id, { title: str('') }),
    'a title over 120': upload(id, { title: str('x'.repeat(121)) }),
    'a composer over 120': upload(id, { composer: str('x'.repeat(121)) }),
    'a score over 100,000': upload(id, { score: str('x'.repeat(100_001)) }),
    'an empty score': upload(id, { score: str('') }),
    'an unknown kind': upload(id, { kind: str('midi') }),
    'a number for a string': upload(id, { title: { integerValue: '3' } }),
    'status already shared': upload(id, { status: str('shared') }),
    'a link to another id': upload(id, { link: str(LINK + hex()) }),
    'a link elsewhere': upload(id, { link: str(`https://example.com/#/shared/${id}`) }),
  };
  for (const [name, fields] of Object.entries(cases))
    assert.equal((await create('shared', id, fields)).status, 403, name);
  assert.equal(
    (await create('shared', id, upload(id), { serverTime: false })).status,
    403,
    'no created time',
  );
  const clientTime = { ...upload(id), created: { timestampValue: '2026-01-01T00:00:00Z' } };
  assert.equal(
    (await create('shared', id, clientTime, { serverTime: false })).status,
    403,
    'a time the client chose',
  );
  for (const bad of ['ABCDEF0123456789abcdef0123456789', 'abc', `${id}0`]) {
    const fields = upload(bad);
    assert.equal((await create('shared', bad, fields)).status, 403, `id ${bad}`);
  }
});

test('an upload cannot overwrite another', async () => {
  const id = hex();
  assert.equal((await create('shared', id, upload(id))).status, 200);
  const again = await create('shared', id, upload(id, { title: str('Other') }));
  assert.notEqual(again.status, 200);
});

test('nobody but the owner changes an upload', async () => {
  const id = hex();
  await create('shared', id, upload(id));
  const patch = await request('PATCH', `${root}/shared/${id}?updateMask.fieldPaths=status`, {
    fields: { status: str('shared') },
  });
  assert.equal(patch.status, 403);
  assert.equal((await setStatus(id, 'shared')).status, 200);
});

test('the uploader withdraws while it waits, not once it is shared', async () => {
  const waiting = hex();
  await create('shared', waiting, upload(waiting));
  assert.equal((await request('DELETE', `${root}/shared/${waiting}`)).status, 200);
  assert.equal((await request('GET', `${root}/shared/${waiting}`)).status, 404);

  const shared = hex();
  await create('shared', shared, upload(shared));
  await setStatus(shared, 'shared');
  assert.equal((await request('DELETE', `${root}/shared/${shared}`)).status, 403);
});

test('the shelf lists only shared uploads, newest first, and nothing else lists', async () => {
  const ids = [hex(), hex(), hex()];
  for (const [i, id] of ids.entries()) {
    await create('shared', id, upload(id, { title: str(`Piece ${i}`) }));
    if (i < 2) await setStatus(id, 'shared');
  }
  const shelf = await listShared();
  assert.equal(shelf.status, 200);
  const titles = (await shelf.json())
    .filter((row) => row.document)
    .map((row) => row.document.fields.title.stringValue);
  assert.deepEqual(titles, ['Piece 1', 'Piece 0']);

  assert.equal((await listShared('waiting')).status, 403, 'the waiting queue');
  assert.equal((await listShared('shared', 51)).status, 403, 'over 50 at once');
  assert.equal((await request('GET', `${root}/shared`)).status, 403, 'an unfiltered list');
});

test('anyone can report; a copyright report needs a way to reply; nobody reads reports', async () => {
  assert.equal((await create('reports', hex(), report())).status, 200);
  const copyright = { reason: str('copyright') };
  assert.equal((await create('reports', hex(), report(copyright))).status, 403);
  assert.equal(
    (await create('reports', hex(), report({ ...copyright, reply: str('me@example.org') }))).status,
    200,
  );
  for (const [name, fields] of Object.entries({
    'an unknown reason': report({ reason: str('other') }),
    'a note over 1,000': report({ note: str('x'.repeat(1001)) }),
    'a reply over 200': report({ reply: str('x'.repeat(201)) }),
    'a score that is not an id': report({ score: str('../shared/x') }),
    'an extra field': report({ ip: str('1.2.3.4') }),
  }))
    assert.equal((await create('reports', hex(), fields)).status, 403, name);

  const id = hex();
  await create('reports', id, report());
  assert.equal((await request('GET', `${root}/reports/${id}`)).status, 403);
  assert.equal((await request('DELETE', `${root}/reports/${id}`)).status, 403);
});
