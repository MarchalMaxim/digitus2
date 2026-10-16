import { describe, expect, it } from 'vitest';
import { evaluateOmr } from '../../eval/omr.js';
import { parseMusicXml } from './read.js';

// Passing a variable also lets the regressions exercise the old parser before
// its option type exists, while retaining the normal source option.
const evaluationOptions = { source: 'omr-fixture', preserveNotation: true };
const xml = (measures: string) => `<score-partwise version="4.0"><part-list>
  <score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">${measures}</part></score-partwise>`;
const measure = (notes: string, number = 1) => `<measure number="${number}">
  <attributes><divisions>4</divisions></attributes>${notes}</measure>`;
const note = (step: string, duration: number, extra = '') => `<note>${extra}
  <pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>
  <voice>1</voice></note>`;
const multipart = (...parts: string[]) => `<score-partwise version="4.0"><part-list>
  ${parts.map((_, i) => `<score-part id="P${i}"><part-name>Piano</part-name></score-part>`).join('')}
  </part-list>${parts.map((body, i) => `<part id="P${i}">${body}</part>`).join('')}
  </score-partwise>`;

describe('parseMusicXml preserveNotation for OMR evaluation', () => {
  it('retains duplicate unisons and their editorial assignments only when enabled', () => {
    const fingering = '<notations><technical><fingering>2</fingering></technical></notations>';
    const input = xml(measure(note('C', 4, fingering) + note('C', 4, `<chord/>${fingering}`)));
    const preserved = parseMusicXml(input, evaluationOptions);
    expect(preserved.score.notes).toHaveLength(2);
    expect(Object.keys(preserved.editorial)).toHaveLength(2);
    expect(preserved.warnings).toEqual([]);
    const ordinary = parseMusicXml(input);
    expect(ordinary.score.notes).toHaveLength(1);
    expect(Object.keys(ordinary.editorial)).toHaveLength(1);
    expect(ordinary.warnings).toEqual([expect.stringContaining('duplicate')]);
  });

  it('exposes inserted unison notes to multiset precision', () => {
    const reference = parseMusicXml(xml(measure(note('C', 4))), evaluationOptions).score;
    const recognized = parseMusicXml(
      xml(measure(note('C', 4) + note('C', 4, '<chord/>'))),
      evaluationOptions,
    ).score;
    expect(evaluateOmr(reference, recognized).metrics.pitch).toMatchObject({
      matched: 1,
      reference: 1,
      recognized: 2,
      precision: 0.5,
      recall: 1,
    });
  });

  it('retains a shorter chord-member duration while ordinary imports use the leading duration', () => {
    const input = xml(measure(note('C', 4) + note('E', 2, '<chord/>')));
    expect(parseMusicXml(input, evaluationOptions).score.notes.map((n) => n.offsetTick)).toEqual([
      4, 2,
    ]);
    expect(parseMusicXml(input).score.notes.map((n) => n.offsetTick)).toEqual([4, 4]);
    const reference = parseMusicXml(
      xml(measure(note('C', 4) + note('E', 4, '<chord/>'))),
      evaluationOptions,
    ).score;
    const result = evaluateOmr(reference, parseMusicXml(input, evaluationOptions).score);
    expect(result.metrics.onsetPitch.f1).toBe(1);
    expect(result.metrics.duration.f1).toBe(0.5);
  });

  it('extends measure length for a long chord member without advancing the document cursor', () => {
    const input = xml(
      measure(note('C', 4) + note('E', 8, '<chord/>') + note('G', 1)) + measure(note('D', 4), 2),
    );
    const preserved = parseMusicXml(input, evaluationOptions).score;
    expect(preserved.notes.find((n) => n.midi === 64)?.offsetTick).toBe(8);
    expect(preserved.notes.find((n) => n.midi === 67)?.onsetTick).toBe(4);
    expect(preserved.measures.map((m) => [m.startTick, m.lengthTicks])).toEqual([
      [0, 8],
      [8, 4],
    ]);
    const ordinary = parseMusicXml(input).score;
    expect(ordinary.notes.find((n) => n.midi === 64)?.offsetTick).toBe(4);
    expect(ordinary.measures.map((m) => [m.startTick, m.lengthTicks])).toEqual([
      [0, 5],
      [5, 4],
    ]);
  });

  it('merges ties using each chord continuation duration in preservation mode', () => {
    const input = xml(
      measure(note('C', 4) + note('E', 4, '<chord/><tie type="start"/>')) +
        measure(note('C', 4) + note('E', 3, '<chord/><tie type="stop"/>'), 2),
    );
    const preserved = parseMusicXml(input, evaluationOptions).score;
    const tied = preserved.notes.filter((n) => n.midi === 64);
    expect(tied).toHaveLength(1);
    expect(tied[0]).toMatchObject({ onsetTick: 0, offsetTick: 7, sourceIndices: [1, 3] });
    expect(parseMusicXml(input).score.notes.find((n) => n.midi === 64)?.offsetTick).toBe(8);
  });

  it('keeps grace notes zero length in preservation mode', () => {
    const input = xml(measure(note('C', 4) + note('E', 999, '<chord/><grace/>')));
    const preserved = parseMusicXml(input, evaluationOptions).score;
    expect(preserved.notes.find((n) => n.isGrace)).toMatchObject({ onsetTick: 0, offsetTick: 0 });
    expect(preserved.measures[0]?.lengthTicks).toBe(4);
  });

  it.each(['gap', 'overlap'])(
    'rejects a tied segment %s instead of repairing its sounding duration',
    (change) => {
      const separation =
        change === 'gap'
          ? '<note><rest/><duration>4</duration></note>'
          : '<backup><duration>2</duration></backup>';
      const input = xml(
        measure(
          note('C', 4, '<tie type="start"/>') + separation + note('C', 4, '<tie type="stop"/>'),
        ),
      );
      expect(() => parseMusicXml(input, evaluationOptions)).toThrow(/contiguous/);
      expect(parseMusicXml(input).score.notes).toHaveLength(1);
    },
  );

  it('rejects a second tie start that would overwrite an unclosed duplicate unison', () => {
    const input = xml(
      measure(
        note('C', 4, '<tie type="start"/>') +
          note('C', 4, '<chord/><tie type="start"/>') +
          note('C', 4, '<tie type="stop"/>'),
      ),
    );
    expect(() => parseMusicXml(input, evaluationOptions)).toThrow(/tie.*already open/);
    expect(parseMusicXml(input).warnings).not.toEqual(
      expect.arrayContaining([expect.stringContaining('never closed')]),
    );
  });

  it('rejects a cross-bar tie gap revealed by a later part extending the bar', () => {
    const input = multipart(
      measure(note('C', 4, '<tie type="start"/>')) + measure(note('C', 4, '<tie type="stop"/>'), 2),
      measure(note('E', 8)) + measure(note('E', 4), 2),
    );
    expect(() => parseMusicXml(input, evaluationOptions)).toThrow(/contiguous/);
    expect(parseMusicXml(input).score.notes.filter((n) => n.midi === 60)).toHaveLength(1);
  });

  it.each([2, 3])(
    'resolves a valid %s-bar tie when its part lengthens provisional bar boundaries',
    (segments) => {
      const firstPart = Array.from({ length: segments }, (_, i) =>
        measure(note('C', 4), i + 1),
      ).join('');
      const tiedPart = Array.from({ length: segments }, (_, i) =>
        measure(
          note(
            'E',
            i === segments - 1 ? 4 : 8,
            (i > 0 ? '<tie type="stop"/>' : '') + (i < segments - 1 ? '<tie type="start"/>' : ''),
          ),
          i + 1,
        ),
      ).join('');
      const input = multipart(firstPart, tiedPart);
      const strict = parseMusicXml(input, evaluationOptions);
      expect(strict.warnings).toEqual([]);
      expect(strict.score.measures.map((m) => m.startTick)).toEqual(
        segments === 2 ? [0, 8] : [0, 8, 16],
      );
      expect(strict.score.notes.filter((n) => n.midi === 60).map((n) => n.onsetTick)).toEqual(
        segments === 2 ? [0, 8] : [0, 8, 16],
      );
      expect(strict.score.notes.find((n) => n.midi === 64)).toMatchObject({
        onsetTick: 0,
        offsetTick: segments === 2 ? 12 : 20,
      });
      expect(strict.score.notes.find((n) => n.midi === 64)?.sourceIndices).toHaveLength(segments);
      expect(parseMusicXml(input).score.notes.find((n) => n.midi === 64)?.offsetTick).toBe(
        segments === 2 ? 8 : 12,
      );
    },
  );

  it('keeps contiguous stop/start continuations open until the final segment', () => {
    const input = xml(
      measure(note('C', 4, '<tie type="start"/>')) +
        measure(note('C', 4, '<tie type="stop"/><tie type="start"/>'), 2) +
        measure(note('C', 4, '<tie type="stop"/>'), 3),
    );
    const parsed = parseMusicXml(input, evaluationOptions);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.score.notes).toHaveLength(1);
    expect(parsed.score.notes[0]).toMatchObject({
      onsetTick: 0,
      offsetTick: 12,
      sourceIndices: [0, 1, 2],
    });
  });

  it('penalizes exchanging notes between single-staff parts', () => {
    const referenceXml = multipart(measure(note('C', 4)), measure(note('E', 4)));
    const candidateXml = multipart(measure(note('E', 4)), measure(note('C', 4)));
    const reference = parseMusicXml(referenceXml, evaluationOptions).score;
    const candidate = parseMusicXml(candidateXml, evaluationOptions).score;
    const result = evaluateOmr(reference, candidate);
    expect(result.metrics.pitch.f1).toBe(1);
    expect(result.metrics.staff.f1).toBe(0);
    expect(result.metrics.voice.f1).toBe(0);
    expect(result.metrics.fullNote.f1).toBe(0);
    expect(parseMusicXml(referenceXml).score.notes.map((n) => n.staff)).toEqual([1, 1]);
  });

  it('compares equivalent one-part and two-part grand staves equally', () => {
    const onePart = xml(
      measure(
        '<attributes><staves>2</staves></attributes>' +
          note('C', 4, '<staff>1</staff>') +
          '<backup><duration>4</duration></backup>' +
          note('E', 4, '<staff>2</staff>'),
      ),
    );
    const twoParts = multipart(measure(note('C', 4)), measure(note('E', 4)));
    const result = evaluateOmr(
      parseMusicXml(onePart, evaluationOptions).score,
      parseMusicXml(twoParts, evaluationOptions).score,
    );
    expect(result.metrics.fullNote.f1).toBe(1);
    expect(result.barTimingMismatches).toBe(0);
  });

  it.each(['declared', 'explicit later in the part'])(
    'reserves the maximum staff range %s before assigning following parts',
    (kind) => {
      const firstPart =
        kind === 'declared'
          ? measure('<attributes><staves>2</staves></attributes>' + note('C', 4))
          : measure(note('C', 4)) + measure(note('G', 4, '<staff>2</staff>'), 2);
      const input = multipart(firstPart, measure(note('E', 4)));
      const parsed = parseMusicXml(input, evaluationOptions).score;
      expect(parsed.notes.find((n) => n.midi === 64)?.staff).toBe(3);
      expect(parseMusicXml(input).score.notes.find((n) => n.midi === 64)?.staff).toBe(1);
    },
  );

  it.each(['staff', 'staves'])(
    'rejects invalid explicit %s values while ordinary parsing keeps its behavior',
    (tag) => {
      for (const value of ['', '0', '-1', '0.5', 'NaN', 'Infinity', '9007199254740992']) {
        const declaration = `<${tag}>${value}</${tag}>`;
        const input = xml(
          measure(
            tag === 'staff'
              ? note('C', 4, declaration)
              : `<attributes>${declaration}</attributes>` + note('C', 4),
          ),
        );
        expect(() => parseMusicXml(input, evaluationOptions)).toThrow(/staff|staves/);
        expect(() => parseMusicXml(input)).not.toThrow();
      }
    },
  );

  it('keeps explicit false equivalent to the existing application import', () => {
    const input = xml(measure(note('C', 4) + note('C', 2, '<chord/>')));
    const ordinaryOptions = { source: 'omr-fixture', preserveNotation: false };
    expect(parseMusicXml(input, ordinaryOptions)).toEqual(
      parseMusicXml(input, { source: 'omr-fixture' }),
    );
  });

  it.each([
    '<pitch><octave>4</octave></pitch>',
    '<pitch><step>Z</step><octave>4</octave></pitch>',
    '<pitch><step>C</step></pitch>',
    '<pitch><step>C</step><octave>4.5</octave></pitch>',
    '<pitch><step>C</step><octave>NaN</octave></pitch>',
  ])('rejects incomplete or invalid required pitch fields: %s', (pitch) => {
    const input = xml(measure(`<note>${pitch}<duration>4</duration></note>`));
    expect(() => parseMusicXml(input, evaluationOptions)).toThrow(/pitch/);
  });

  it.each([
    '',
    '<duration/>',
    '<duration>0</duration>',
    '<duration>-1</duration>',
    '<duration>NaN</duration>',
    '<duration>Infinity</duration>',
    '<duration>0.1</duration>',
  ])('rejects missing, invalid or inexact nongrace duration: %s', (duration) => {
    const input = xml(
      measure(`<note><pitch><step>C</step><octave>4</octave></pitch>
        ${duration}</note>`),
    );
    expect(() => parseMusicXml(input, evaluationOptions)).toThrow(/duration/);
  });

  it('permits a grace note without duration and valid rests and cues', () => {
    const input = xml(
      measure(
        `<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>
      <note><rest/><duration>4</duration></note>
      <note><cue/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note>` +
          note('C', 4),
      ),
    );
    const result = parseMusicXml(input, evaluationOptions);
    expect(result.score.notes.map((n) => [n.midi, n.onsetTick, n.offsetTick])).toEqual([
      [62, 0, 0],
      [60, 8, 12],
    ]);
    expect(result.score.measures[0]?.lengthTicks).toBe(12);
  });

  it.each([
    note('C', 4, '<tie type="stop"/>'),
    note('C', 4, '<tie type="start"/>'),
    '<note><pitch><step>C</step><alter>0.5</alter><octave>4</octave></pitch><duration>4</duration></note>',
    '<note><pitch><step>C</step><alter>3</alter><octave>4</octave></pitch><duration>4</duration></note>',
    '<note><duration>4</duration></note>',
  ])('rejects parser warnings instead of scoring repaired notation: %s', (notes) => {
    expect(() => parseMusicXml(xml(measure(notes)), evaluationOptions)).toThrow(/notation/);
  });

  it('keeps the ordinary import defaults and warnings for repairable source notation', () => {
    const input = xml(
      measure(
        '<note><pitch/><duration>4</duration></note>' +
          '<note><pitch><step>C</step><octave>4</octave></pitch></note>',
      ),
    );
    expect(
      parseMusicXml(input).score.notes.map((n) => [n.midi, n.onsetTick, n.offsetTick]),
    ).toEqual([
      [60, 0, 4],
      [60, 4, 4],
    ]);
    expect(parseMusicXml(xml(measure(note('C', 4, '<tie type="stop"/>')))).warnings).toEqual([
      expect.stringContaining('tie stop'),
    ]);
  });

  it.each(['0', '-1', '0.1', 'NaN', 'Infinity', '9007199254740992'])(
    'rejects invalid explicitly declared divisions %s',
    (divisions) => {
      const input = xml(
        measure(note('C', 4)).replace(
          '<divisions>4</divisions>',
          `<divisions>${divisions}</divisions>`,
        ),
      );
      expect(() => parseMusicXml(input, evaluationOptions)).toThrow(/divisions/);
    },
  );

  it.each(['backup', 'forward'])(
    'rejects malformed or missing %s duration instead of rounding it away',
    (element) => {
      for (const duration of [
        '',
        '<duration>0.1</duration>',
        '<duration>0</duration>',
        '<duration>-1</duration>',
        '<duration>Infinity</duration>',
      ]) {
        const input = xml(
          measure(note('C', 4) + `<${element}>${duration}</${element}>` + note('D', 4)),
        );
        expect(() => parseMusicXml(input, evaluationOptions)).toThrow(/duration/);
      }
    },
  );

  it('keeps valid backup/forward timing exact without changing ordinary parsing', () => {
    const input = xml(
      measure(
        note('C', 4) +
          '<backup><duration>4</duration></backup>' +
          note('E', 2) +
          '<forward><duration>2</duration></forward>' +
          note('G', 4),
      ),
    );
    const preserved = parseMusicXml(input, evaluationOptions);
    expect(preserved.score.notes.map((n) => [n.midi, n.onsetTick, n.offsetTick])).toEqual([
      [60, 0, 4],
      [64, 0, 2],
      [67, 4, 8],
    ]);
    expect(preserved).toEqual(parseMusicXml(input, { source: 'omr-fixture' }));
  });

  it('retains the default parser rounding of fractional backup/forward durations', () => {
    const input = xml(
      measure(
        note('C', 4) +
          '<backup><duration>0.1</duration></backup>' +
          '<forward><duration>0.1</duration></forward>' +
          note('D', 4),
      ),
    );
    expect(parseMusicXml(input).score.notes.map((n) => n.onsetTick)).toEqual([0, 4]);
  });
});
