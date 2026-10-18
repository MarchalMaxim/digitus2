import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { normalizeVoices } from './normalizeVoices.js';
import { verovioOptions } from './options.js';

function note(
  id: string,
  step: string,
  octave: number,
  duration: number,
  voice: string,
  staff: string,
  extra = '',
) {
  return `<note id="${id}">${extra}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${duration === 2 ? 'quarter' : 'eighth'}</type><staff>${staff}</staff></note>`;
}

const upper1 = note('upper1', 'C', 5, 2, '1', '1');
const upper2 = note('upper2', 'D', 5, 1, '1', '1');
const lower1 = note('lower1', 'C', 3, 1, '5', '2');
const lower2 = note('lower2', 'D', 3, 1, '5', '2');
const rest =
  '<note id="rest"><rest/><duration>1</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>';
const backup = (duration: number) => `<backup><duration>${duration}</duration></backup>`;
function score(body: string, software = 'homr') {
  return `<score-partwise version="4.0"><identification><encoding><software>${software}</software></encoding></identification><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>3</beats><beat-type>8</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${body}</measure></part></score-partwise>`;
}
const interleaved = upper1 + backup(2) + rest + lower1 + upper2 + backup(1) + lower2;

function musicalEvents(xml: string) {
  const parsed = parseMusicXml(xml, { preserveNotation: true });
  return {
    notes: parsed.score.notes.map((n) => [n.midi, n.hand, n.voice, n.onsetTick, n.offsetTick]),
    measures: parsed.score.measures,
    timeSignatures: parsed.score.timeSignatures,
  };
}

describe('HOMR voice serialization for Verovio', () => {
  it('aligns polyphonic SVG notes with the engine timeline across bar boundaries', async () => {
    const { default: createVerovioModule } = await import('verovio/wasm');
    const { VerovioToolkit } = await import('verovio/esm');
    const tk = new VerovioToolkit(await createVerovioModule());
    const xml = score(interleaved).replace(
      '</part>',
      '<measure number="2">' + note('next', 'E', 5, 2, '1', '1') + '</measure></part>',
    );
    try {
      tk.setOptions(verovioOptions(900));
      expect(tk.loadData(normalizeVoices(xml))).toBeTruthy();
      tk.renderToTimemap();
      expect(
        ['upper1', 'lower1', 'upper2', 'lower2', 'next'].map((id) => tk.getTimeForElement(id)),
      ).toEqual([0, 250, 500, 500, 750]);
      const svg = tk.renderToSVG(1);
      for (const id of ['upper1', 'lower1', 'upper2', 'lower2', 'next'])
        expect(svg).toContain(`id="${id}"`);
      expect(musicalEvents(normalizeVoices(xml))).toEqual(musicalEvents(xml));
    } finally {
      tk.destroy();
    }
  }, 30_000);

  it('retains chords, note ids and notations exactly while regrouping voices', () => {
    const chord = note('chord', 'E', 5, 2, '1', '1', '<chord/>');
    const xml = score(
      interleaved.replace(
        upper1,
        upper1.replace(
          '</note>',
          '<notations><technical><fingering>5</fingering></technical></notations></note>',
        ) + chord,
      ),
    );
    const out = normalizeVoices(xml);
    expect(out).not.toBe(xml); // regrouped, not bailed out
    expect(musicalEvents(out)).toEqual(musicalEvents(xml));
    const before = new DOMParser().parseFromString(xml, 'text/xml');
    const after = new DOMParser().parseFromString(out, 'text/xml');
    const serialize = new XMLSerializer();
    for (const el of before.querySelectorAll('note'))
      expect(serialize.serializeToString(after.getElementById(el.id)!)).toBe(
        serialize.serializeToString(el),
      );
    expect(normalizeVoices(out)).toBe(out);
  });

  it('preserves ties across bars and explicit gaps, including the silent bar tail', () => {
    const body = interleaved.replace(
      upper2,
      upper2.replace('<voice>', '<tie type="start"/><voice>'),
    );
    const xml = score(body).replace(
      '</part>',
      '<measure number="2">' +
        note('tieEnd', 'D', 5, 1, '1', '1').replace('<voice>', '<tie type="stop"/><voice>') +
        '</measure></part>',
    );
    const out = normalizeVoices(xml);
    expect(musicalEvents(out)).toEqual(musicalEvents(xml));
    expect(out).toContain('<tie type="start"/>');
    expect(out).toContain('<tie type="stop"/>');
    const gap = score(interleaved + '<forward><duration>1</duration></forward>');
    expect(musicalEvents(normalizeVoices(gap))).toEqual(musicalEvents(gap));
  });

  it('leaves ordinary imports and ambiguous measures unchanged', () => {
    expect(normalizeVoices(score(interleaved, 'other'))).toBe(score(interleaved, 'other'));
    expect(normalizeVoices(score(upper1 + upper2 + backup(3) + rest + lower1 + lower2))).toBe(
      score(upper1 + upper2 + backup(3) + rest + lower1 + lower2),
    );
    for (const body of [
      interleaved + '<direction><direction-type><words>dolce</words></direction-type></direction>',
      interleaved.replace(backup(2), backup(20)),
      interleaved.replace(upper2, upper2.replace('<duration>1', '<duration>0')),
      interleaved.replace(upper2, '<attributes><divisions>4</divisions></attributes>' + upper2),
      interleaved.replace(upper2, upper2.replace('<duration>1</duration>', '<grace/>')),
    ]) {
      const xml = score(body);
      expect(normalizeVoices(xml)).toBe(xml);
    }
  });
});

describe('HOMR voice serialization refusals', () => {
  it('refuses a backup that runs before the start of the bar, even when nothing else is wrong', () => {
    // Each lane is in order and no note overlaps another in its lane; only the negative position
    // is wrong.
    const body = backup(1) + upper1 + backup(2) + rest + lower1 + upper2;
    const xml = score(body);
    expect(normalizeVoices(xml)).toBe(xml);
  });

  it('refuses a chord note that has no note before it to join', () => {
    const orphan = note('orphan', 'C', 3, 1, '5', '2', '<chord/>');
    const xml = score(upper1 + backup(2) + orphan + rest + lower1 + upper2 + backup(1) + lower2);
    expect(normalizeVoices(xml)).toBe(xml);
  });
});
