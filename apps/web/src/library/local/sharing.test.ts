import { beforeEach, expect, it, vi } from 'vitest';
import type { LocalScoreRecord } from './records.js';

const XML =
  '<?xml version="1.0"?><score-partwise><work><work-title>Étude</work-title></work>' +
  '<identification><creator type="composer">Czerny</creator></identification></score-partwise>';
const SHARED_ID = 'a'.repeat(32);

const fixture = vi.hoisted(() => ({
  rows: [] as unknown[],
  disk: new Map<string, LocalScoreRecord>(),
  notes: 3,
  remote: null as { status: string } | null,
  created: [] as Array<{ id: string; fields: Record<string, unknown> }>,
  deleted: [] as string[],
  loads: 0,
}));
vi.mock('./database.js', () => ({
  LocalScoreDatabase: class {
    async read() {
      return fixture.rows;
    }
    async write(record: LocalScoreRecord | string) {
      if (typeof record === 'string') fixture.disk.delete(record);
      else fixture.disk.set(record.id, record);
    }
  },
}));
vi.mock('../../score/useScoreDocument.js', () => ({
  services: {
    engine: {
      load: async () => {
        fixture.loads++;
        return { score: { notes: new Array(fixture.notes).fill(0) }, xml: XML };
      },
    },
  },
}));
vi.mock('../shared/store.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  newId: () => SHARED_ID,
  createShared: async (id: string, fields: Record<string, unknown>) => {
    fixture.created.push({ id, fields });
  },
  getShared: async () => fixture.remote,
  deleteShared: async (id: string) => {
    fixture.deleted.push(id);
  },
}));

const fileRow = (name: string, shared?: { id: string }): LocalScoreRecord => ({
  version: 1,
  id: `file:${name}`,
  updatedAt: 1,
  kind: 'file',
  name,
  blob: new Blob([XML]),
  ...(shared ? { shared } : {}),
});

beforeEach(() => {
  vi.resetModules();
  fixture.rows = [];
  fixture.disk.clear();
  fixture.notes = 3;
  fixture.remote = null;
  fixture.created = [];
  fixture.deleted = [];
  fixture.loads = 0;
});

async function setup(rows: LocalScoreRecord[]) {
  fixture.rows = rows;
  const library = await import('./library.js');
  const { useLocalLibrary } = await import('./state.js');
  library.installLocalLibrary();
  await vi.waitFor(() => expect(useLocalLibrary.getState().items).toHaveLength(rows.length));
  const sharing = () => useLocalLibrary.getState().items.map((item) => item.sharing);
  return { library, sharing };
}

it('offers Share on a MusicXML file only after the strict import has read it, never on MIDI', async () => {
  const { library, sharing } = await setup([fileRow('a.musicxml'), fileRow('b.mid')]);
  expect(sharing()).toEqual([undefined, undefined]);
  await library.checkSharing();
  expect(sharing().sort()).toEqual(['can', undefined]);
  expect(fixture.loads).toBe(1);
});

it('offers nothing when the importer finds no notes', async () => {
  fixture.notes = 0;
  const { library, sharing } = await setup([fileRow('a.xml')]);
  await library.checkSharing();
  expect(sharing()).toEqual([undefined]);
});

it('starts the sheet from the title and composer the MusicXML names', async () => {
  const { library } = await setup([fileRow('whatever-name.musicxml')]);
  await library.checkSharing();
  expect(await library.shareDraft('file:whatever-name.musicxml')).toEqual({
    title: 'Étude',
    composer: 'Czerny',
  });
});

it('Share sends one create with no file name, then the row waits; Withdraw deletes and restores it', async () => {
  const { library, sharing } = await setup([fileRow('secret-name.musicxml')]);
  await library.checkSharing();
  await library.shareLocalScore('file:secret-name.musicxml', ' Étude ', 'Czerny');
  expect(fixture.created).toHaveLength(1);
  expect(fixture.created[0]!.id).toBe(SHARED_ID);
  expect(JSON.stringify(fixture.created[0]!.fields)).not.toMatch(/secret-name|file:/);
  expect(fixture.created[0]!.fields).toMatchObject({
    title: 'Étude',
    status: 'waiting',
    kind: 'file',
  });
  expect(sharing()).toEqual(['waiting']);
  await vi.waitFor(() =>
    expect(fixture.disk.get('file:secret-name.musicxml')?.shared).toEqual({ id: SHARED_ID }),
  );
  await library.withdrawLocalScore('file:secret-name.musicxml');
  expect(fixture.deleted).toEqual([SHARED_ID]);
  expect(sharing()).toEqual(['can']);
  await vi.waitFor(() =>
    expect(fixture.disk.get('file:secret-name.musicxml')?.shared).toBeUndefined(),
  );
});

it('on a later visit the first opening asks once: waiting, shared, or not found', async () => {
  fixture.remote = { status: 'waiting' };
  let run = await setup([fileRow('a.musicxml', { id: SHARED_ID })]);
  expect(run.sharing()).toEqual([undefined]);
  await run.library.checkSharing();
  expect(run.sharing()).toEqual(['waiting']);

  vi.resetModules();
  fixture.remote = { status: 'shared' };
  run = await setup([fileRow('a.musicxml', { id: SHARED_ID })]);
  await run.library.checkSharing();
  expect(run.sharing()).toEqual(['shared']);

  vi.resetModules();
  fixture.remote = null;
  fixture.disk.clear();
  run = await setup([fileRow('a.musicxml', { id: SHARED_ID })]);
  await run.library.checkSharing();
  expect(run.sharing()).toEqual(['again']);
  await vi.waitFor(() => expect(fixture.disk.has('file:a.musicxml')).toBe(true));
  expect(fixture.disk.get('file:a.musicxml')?.shared).toBeUndefined();
});
