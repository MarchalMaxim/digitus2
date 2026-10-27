import { describe, expect, it, vi } from 'vitest';
import type { EngineClient } from '../../engine/client.js';
import type { LocalScoreRecord } from '../local/records.js';
import { candidate, shareableOf } from './eligibility.js';

const XML =
  '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name/></score-part></part-list>' +
  '<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>' +
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';

const engine = (notes: number, xml = XML) => ({
  load: vi.fn(async () => ({
    score: { notes: new Array(notes).fill(0) },
    editorial: {},
    warnings: [],
    xml,
    midiInfo: null,
  })),
});
const asEngine = (e: ReturnType<typeof engine>) => e as unknown as Pick<EngineClient, 'load'>;

const file = (name: string): LocalScoreRecord => ({
  version: 1,
  id: 'file:1',
  updatedAt: 1,
  kind: 'file',
  name,
  blob: new Blob(['x']),
});
const scan = (xml?: string): LocalScoreRecord => ({
  version: 1,
  id: 'scan:1',
  updatedAt: 1,
  kind: 'scan',
  session: {
    id: '1',
    file: { blob: new Blob(['x']), name: 'p.png', type: 'image/png', lastModified: 0 },
    xml,
  },
});

describe('which rows can be shared', () => {
  it('a recognised scan and a MusicXML file are candidates; a MIDI file and an unread scan are not', () => {
    expect(candidate(scan(XML))).toBe(true);
    expect(candidate(scan())).toBe(false);
    expect(candidate(file('a.mxl'))).toBe(true);
    expect(candidate(file('a.musicxml'))).toBe(true);
    expect(candidate(file('a.xml'))).toBe(true);
    expect(candidate(file('a.mid'))).toBe(false);
    expect(candidate(file('a.midi'))).toBe(false);
  });

  it('a MIDI file is refused without the engine being asked', async () => {
    const e = engine(5);
    expect(await shareableOf(file('a.mid'), asEngine(e))).toBeNull();
    expect(e.load).not.toHaveBeenCalled();
  });

  it('a file the strict import refuses, or that holds no notes, is refused', async () => {
    const refusing = { load: vi.fn().mockRejectedValue(new Error('not MusicXML')) };
    expect(await shareableOf(file('a.xml'), asEngine(refusing as never))).toBeNull();
    expect(await shareableOf(file('a.xml'), asEngine(engine(0)))).toBeNull();
  });

  it('a file passes with the text the engine read (an .mxl is unpacked)', async () => {
    expect(await shareableOf(file('a.mxl'), asEngine(engine(3, 'unpacked')))).toEqual({
      xml: 'unpacked',
      kind: 'file',
    });
  });

  it('a scan is read as a scan is, and passes with notes', async () => {
    const e = engine(4);
    expect(await shareableOf(scan(XML), asEngine(e))).toEqual({ xml: XML, kind: 'scan' });
    expect(e.load).toHaveBeenCalledWith(expect.any(String), 'scan.musicxml', {
      preserveNotation: true,
    });
    expect(await shareableOf(scan(XML), asEngine(engine(0)))).toBeNull();
  });
});
