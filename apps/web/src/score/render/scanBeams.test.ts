import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { prepareScanBeams } from './scanBeams.js';
import { verovioOptions } from './options.js';

function note(id: string, extra = '', duration = 2, type = 'eighth', voice = '1', staff = '1') {
  return `<note id="${id}">${extra}<pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type><staff>${staff}</staff></note>`;
}

function score(
  body: string,
  meter = '<beats>3</beats><beat-type>4</beat-type>',
  software = 'homr',
) {
  return `<score-partwise version="4.0"><identification><encoding><software>${software}</software></encoding></identification><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time>${meter}</time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${body}</measure></part></score-partwise>`;
}

function beams(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('note')].map((n) => [
    n.id,
    [...n.querySelectorAll('beam')].map((b) => `${b.getAttribute('number')}:${b.textContent}`),
  ]);
}

const sixEighths = Array.from({ length: 6 }, (_, i) => note(`n${i}`)).join('');

describe('HOMR engraving fallback', () => {
  it('renders actual Verovio beams while retaining note ids, pitches and playback timing', async () => {
    const { default: createVerovioModule } = await import('verovio/wasm');
    const { VerovioToolkit } = await import('verovio/esm');
    const tk = new VerovioToolkit(await createVerovioModule());
    try {
      tk.setOptions(verovioOptions(900));
      const xml = score(sixEighths);
      expect(tk.loadData(xml)).toBeTruthy();
      expect(tk.renderToSVG(1).match(/class="flag"/g)).toHaveLength(6);
      const before = Array.from({ length: 6 }, (_, i) => tk.getMIDIValuesForElement(`n${i}`));
      expect(tk.loadData(prepareScanBeams(xml))).toBeTruthy();
      const svg = tk.renderToSVG(1);
      expect(svg.match(/class="beam"/g)).toHaveLength(3);
      expect(svg).not.toContain('class="flag"');
      expect(Array.from({ length: 6 }, (_, i) => tk.getMIDIValuesForElement(`n${i}`))).toEqual(
        before,
      );
      for (let i = 0; i < 6; i++) expect(svg).toContain(`id="n${i}"`);
    } finally {
      tk.destroy();
    }
  });

  it('connects six 3/4 eighths in beat pairs without changing any musical data', () => {
    const xml = score(sixEighths);
    const out = prepareScanBeams(xml);
    expect(beams(out)).toEqual([
      ['n0', ['1:begin']],
      ['n1', ['1:end']],
      ['n2', ['1:begin']],
      ['n3', ['1:end']],
      ['n4', ['1:begin']],
      ['n5', ['1:end']],
    ]);
    expect(parseMusicXml(out, { preserveNotation: true }).score).toEqual(
      parseMusicXml(xml, { preserveNotation: true }).score,
    );
    // Only beam nodes may change, even comments, ids, timing and notations survive.
    const original = new DOMParser().parseFromString(xml, 'text/xml');
    const prepared = new DOMParser().parseFromString(out, 'text/xml');
    prepared.querySelectorAll('beam').forEach((b) => b.remove());
    expect(new XMLSerializer().serializeToString(prepared)).toBe(
      new XMLSerializer().serializeToString(original),
    );
    expect(prepareScanBeams(out)).toBe(out);
  });

  it('groups interleaved backup voices independently and retains chord note ids', () => {
    const xml = score(
      note('a') +
        note('chord', '<chord/>') +
        '<backup><duration>2</duration></backup>' +
        note('bassA', '', 2, 'eighth', '5', '2') +
        note('b') +
        '<backup><duration>2</duration></backup>' +
        note('bassB', '', 2, 'eighth', '5', '2') +
        note('long', '', 8, 'half'),
    );
    expect(beams(prepareScanBeams(xml))).toEqual([
      ['a', ['1:begin']],
      ['chord', []],
      ['bassA', ['1:begin']],
      ['b', ['1:end']],
      ['bassB', ['1:end']],
      ['long', []],
    ]);
  });

  it('breaks at rests and forward gaps rather than joining across missing time', () => {
    const xml = score(
      note('a') +
        '<note><rest/><duration>2</duration><voice>1</voice><type>eighth</type></note>' +
        note('b') +
        '<forward><duration>2</duration></forward>' +
        note('c') +
        note('d'),
    );
    expect(beams(prepareScanBeams(xml))).toEqual([
      ['a', []],
      ['', []],
      ['b', []],
      ['c', ['1:begin']],
      ['d', ['1:end']],
    ]);
  });

  it('adds both beam levels for straight sixteenths and a secondary hook beside an eighth', () => {
    const xml = score(
      note('a', '', 1, '16th') + note('b', '', 1, '16th') + note('c') + note('d', '', 8, 'half'),
    );
    expect(beams(prepareScanBeams(xml))).toEqual([
      ['a', ['1:begin', '2:begin']],
      ['b', ['1:continue', '2:end']],
      ['c', ['1:end']],
      ['d', []],
    ]);
    const hook = score(
      note('a', '', 1, '16th') + note('b', '<dot/>', 3) + note('c', '', 8, 'half'),
    );
    expect(beams(prepareScanBeams(hook))[0]).toEqual(['a', ['1:begin', '2:forward hook']]);
  });

  it('uses dotted-quarter groups in 6/8', () => {
    expect(
      beams(prepareScanBeams(score(sixEighths, '<beats>6</beats><beat-type>8</beat-type>'))),
    ).toEqual([
      ['n0', ['1:begin']],
      ['n1', ['1:continue']],
      ['n2', ['1:end']],
      ['n3', ['1:begin']],
      ['n4', ['1:continue']],
      ['n5', ['1:end']],
    ]);
  });

  it('uses three dotted-quarter groups in 9/8', () => {
    const nine = Array.from({ length: 9 }, (_, i) => note(`n${i}`)).join('');
    const marks = beams(prepareScanBeams(score(nine, '<beats>9</beats><beat-type>8</beat-type>')));
    expect(marks.map(([, b]) => b)).toEqual(
      ['begin', 'continue', 'end', 'begin', 'continue', 'end', 'begin', 'continue', 'end'].map(
        (v) => [`1:${v}`],
      ),
    );
  });

  it('ends a group on a sixteenth after an eighth with a backward hook', () => {
    const xml = score(note('a') + note('b', '', 1, '16th') + note('c', '', 8, 'half'));
    expect(beams(prepareScanBeams(xml))).toEqual([
      ['a', ['1:begin']],
      ['b', ['1:end', '2:backward hook']],
      ['c', []],
    ]);
  });

  it.each([
    ['another exporter', score(sixEighths, undefined, 'MuseScore')],
    [
      'explicit beaming',
      score(
        sixEighths.replace('<staff>1</staff>', '<staff>1</staff><beam number="1">begin</beam>'),
      ),
    ],
    ['unknown meter', score(sixEighths, '')],
    [
      '3/8, which is not a supported meter',
      score(
        sixEighths.slice(0, sixEighths.indexOf('<note id="n3"')),
        '<beats>3</beats><beat-type>8</beat-type>',
      ),
    ],
    [
      '6/4, which is not a supported meter',
      score(sixEighths, '<beats>6</beats><beat-type>4</beat-type>'),
    ],
    ['additive meter', score(sixEighths, '<beats>2+1</beats><beat-type>4</beat-type>')],
    [
      'tuplets',
      score(
        sixEighths.replace(
          '<pitch>',
          '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><pitch>',
        ),
      ),
    ],
    ['grace notes', score(sixEighths.replace('<pitch>', '<grace/><pitch>'))],
    ['duration/type disagreement', score(sixEighths.replace('<duration>2', '<duration>1'))],
    ['invalid backup', score('<backup><duration>2</duration></backup>' + sixEighths)],
    [
      'pickup bar',
      score(sixEighths).replace('<measure number="1">', '<measure number="1" implicit="yes">'),
    ],
  ])('leaves %s unchanged', (_name, xml) => {
    expect(prepareScanBeams(xml)).toBe(xml);
  });
});
