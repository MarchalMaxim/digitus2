import { describe, expect, it } from 'vitest';
import { buildShare, pack, prefill, ScoreTooLarge, unpack } from './payload.js';

const xml = (head: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">${head}<part-list/></score-partwise>`;

describe('the packed score', () => {
  it('round-trips through deflate-raw and base64', async () => {
    const text = xml('<work><work-title>Étude</work-title></work>') + '♯'.repeat(500);
    const packed = await pack(text);
    expect(packed).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(packed.length).toBeLessThan(text.length);
    expect(await unpack(packed)).toBe(text);
  });
});

describe('the share sheet prefill', () => {
  it('takes work-title, else movement-title, and the typed composer', () => {
    expect(
      prefill(
        xml(
          '<work><work-title>Prelude</work-title></work><movement-title>First</movement-title>' +
            '<identification><creator type="lyricist">L</creator><creator type="composer"> J. S.  Bach </creator></identification>',
        ),
      ),
    ).toEqual({ title: 'Prelude', composer: 'J. S. Bach' });
    expect(prefill(xml('<movement-title>Only movement</movement-title>'))).toEqual({
      title: 'Only movement',
      composer: '',
    });
  });

  it('is empty when the MusicXML names nothing, whatever the file was called', () => {
    expect(prefill(xml(''))).toEqual({ title: '', composer: '' });
    expect(prefill('not xml at all')).toEqual({ title: '', composer: '' });
  });
});

describe('the upload', () => {
  const id = 'a'.repeat(32);

  it('holds the typed fields, the packed score and the link; no file name, no record id', async () => {
    const fields = await buildShare(id, {
      title: ' My piece ',
      composer: ' Me ',
      xml: xml('<work><work-title>secret-file-name</work-title></work>'),
      kind: 'file',
    });
    expect(Object.keys(fields).sort()).toEqual(
      ['app', 'composer', 'kind', 'link', 'score', 'status', 'title'].sort(),
    );
    expect(fields).toMatchObject({
      title: 'My piece',
      composer: 'Me',
      kind: 'file',
      status: 'waiting',
      link: `https://marchalmaxim.github.io/digitus2/#/shared/${id}`,
    });
    expect(fields.app.length).toBeLessThanOrEqual(40);
    const wire = JSON.stringify(fields);
    expect(wire).not.toMatch(/scan:|file:|\.musicxml|\.mxl/);
  });

  it('refuses a score whose packed text passes 100,000 characters', async () => {
    const noise = Array.from({ length: 140_000 }, () => Math.random().toString(36)[2]).join('');
    await expect(
      buildShare(id, { title: 't', composer: '', xml: noise, kind: 'file' }),
    ).rejects.toBeInstanceOf(ScoreTooLarge);
  });
});
