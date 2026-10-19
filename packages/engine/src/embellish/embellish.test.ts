// The light embellisher, rule by rule: the port of research/embellish/tests/test_rules.py at
// light density. The expectations are the light reference's outputs
// (research/embellish/light_reference.py), not the Python tests' playful ones.
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { analyseMusicXml, top } from './analyse.js';
import { checkEmbellishment } from './check.js';
import { embellishMusicXml } from './embellish.js';
import type { EmbellishResult } from './embellish.js';
import { fracFrom } from './frac.js';
import { fixtureScore } from './testing/score.js';
import type { Bar } from './testing/score.js';

type Ev = [onset: number, midi: number, length: number];

/** The right hand's notes of one voice: onset and length in quarters, as test_rules.py's `rh`. */
function rh(xml: string, voice = 1): Ev[] {
  const { score } = parseMusicXml(xml);
  return score.notes
    .filter((n) => n.staff === 1 && n.voice === voice && !n.isGrace)
    .map((n) => [
      n.onsetTick / score.divisions,
      n.midi,
      (n.offsetTick - n.onsetTick) / score.divisions,
    ]);
}

function lh(xml: string): Ev[] {
  const { score } = parseMusicXml(xml);
  return score.notes
    .filter((n) => n.staff === 2 && !n.isGrace)
    .map((n) => [
      n.onsetTick / score.divisions,
      n.midi,
      (n.offsetTick - n.onsetTick) / score.divisions,
    ]);
}

const rules = (res: EmbellishResult) => res.inserted.map((i) => i.rule);
const E = (xml: string) => embellishMusicXml(xml);

/** `checkEmbellishment` of a result against its plain input, in the result's melody voice. */
function checked(plain: string, res: EmbellishResult) {
  expect(res.melodyVoice).not.toBeNull();
  return checkEmbellishment(plain, res.xml, res.inserted, res.melodyVoice!);
}

/** Insert `xml` before the third `<note>` of `score`, as test_rules.py does. */
function beforeThirdNote(score: string, xml: string): string {
  const at = score.indexOf('<note>', score.indexOf('<note>', score.indexOf('<note>') + 1) + 1);
  return score.slice(0, at) + xml + score.slice(at);
}

/** test_rules.py's fixture 4: C-E-D, then C. */
const fixture4 = (opts: Parameters<typeof fixtureScore>[1] = {}) =>
  fixtureScore(
    [
      [
        ['C4', 1],
        ['E4', 1],
        ['D4', 2],
      ],
      [['C4', 4]],
    ],
    opts,
  );

const CEEC: Bar = [
  ['C4', 1],
  ['E4', 1],
  ['E4', 1],
  ['C4', 1],
];

describe('passing notes', () => {
  it('a passing note fills a third on the weak half of the first note', () => {
    const res = E(
      fixtureScore([
        [
          ['C4', 1],
          ['E4', 1],
          ['D4', 1],
          ['C4', 1],
        ],
        [['C4', 4]],
      ]),
    );
    expect(res.refusal).toBeNull();
    expect(rules(res)).toEqual(['passing']);
    expect(rh(res.xml).slice(0, 3)).toEqual([
      [0, 60, 0.5],
      [0.5, 62, 0.5],
      [1, 64, 1],
    ]);
    expect(res.inserted[0]).toEqual({
      measureIndex: 0,
      bar: '1',
      beat: '1.5',
      onset: '1/2',
      pitch: 'D4',
      midi: 62,
      rule: 'passing',
      role: 'passing',
      length: '0.5',
    });
    expect(res.skipped).toEqual({ 'no rule fits': 2, 'last bar': 1 });
    expect(res.melodyVoice).toBe('1');
  });

  it('passing note on a descending third', () => {
    const res = E(
      fixtureScore([
        [
          ['G4', 1],
          ['E4', 1],
          ['D4', 2],
        ],
        [['C4', 4]],
      ]),
    );
    expect(
      rh(res.xml)
        .slice(0, 3)
        .map((e) => e[1]),
    ).toEqual([67, 65, 64]);
  });

  it('no passing note across a fourth or a step', () => {
    const res = E(
      fixtureScore([
        [
          ['C4', 1],
          ['F4', 1],
          ['G4', 2],
        ],
        [['C4', 4]],
      ]),
    );
    expect(res.inserted).toEqual([]);
    expect(res.skipped).toEqual({ 'no rule fits': 3, 'last bar': 1 });
  });

  it('a passing note needs both ends in the key', () => {
    const res = E(
      fixtureScore([
        [
          ['C4', 1],
          ['Eb4', 1],
          ['D4', 2],
        ],
        [['C4', 4]],
      ]),
    );
    expect(res.inserted).toEqual([]);
    expect(res.skipped).toEqual({ 'no rule fits': 3, 'last bar': 1 });
  });

  it('a passing note is spelled from the key signature', () => {
    const res = E(
      fixtureScore(
        [
          [
            ['E4', 1],
            ['G4', 1],
            ['A4', 2],
          ],
          [['G4', 4]],
        ],
        { lh: [[['G2', 4]], [['G2', 4]]], fifths: 1 },
      ),
    );
    expect(rh(res.xml)[1]![1]).toBe(66);
    expect(res.inserted[0]!.pitch).toBe('F#4');
    expect(res.xml).toContain('<alter>1</alter>');
  });

  it('a passing note on a half note lands on the weak second beat', () => {
    const res = E(
      fixtureScore([
        [
          ['C4', 2],
          ['E4', 2],
        ],
        [['C4', 4]],
      ]),
    );
    expect(rh(res.xml).slice(0, 2)).toEqual([
      [0, 60, 1],
      [1, 62, 1],
    ]);
    expect(res.inserted[0]!.beat).toBe('2');
    expect(res.inserted[0]!.length).toBe('1');
  });

  it('never on a strong beat', () => {
    const res = E(
      fixtureScore([
        [
          ['C4', 3],
          ['E4', 1],
        ],
        [['F4', 4]],
      ]),
    );
    expect(res.inserted).toEqual([]);
    expect(res.skipped).toEqual({ 'strong beat': 1, 'no rule fits': 1, 'last bar': 1 });
  });

  it('a new note never sounds through a strong position', () => {
    const res = E(
      fixtureScore([
        [
          ['G4', 1 / 2],
          ['C4', 2],
          ['E4', 1],
          ['D4', 1 / 2],
        ],
        [['C4', 4]],
      ]),
    );
    expect(res.inserted).toEqual([]);
    expect(res.skipped['strong beat']).toBe(1);
    expect(res.skipped).toEqual({ 'no rule fits': 3, 'strong beat': 1, 'last bar': 1 });
  });

  it('a minor key uses the key signature’s scale', () => {
    const res = E(
      fixtureScore(
        [
          [
            ['A4', 1],
            ['C5', 1],
            ['E4', 1],
            ['G#4', 1],
          ],
          [['A4', 4]],
        ],
        { lh: [[['A2', 4]], [['A2', 4]]], mode: 'minor' },
      ),
    );
    expect(res.inserted.filter((i) => i.rule === 'passing').map((i) => i.pitch)).toEqual(['B4']);
    expect(res.inserted.every((i) => i.midi % 12 !== 7)).toBe(true);
  });

  it('a key change inside a bar is followed', () => {
    const xml = beforeThirdNote(
      fixtureScore(
        [
          [
            ['C4', 1],
            ['D4', 1],
            ['E4', 1],
            ['G4', 1],
          ],
          [['A4', 4]],
        ],
        { lh: [[['r', 4]], [['D3', 4]]] },
      ),
      '<attributes><key><fifths>1</fifths></key></attributes>',
    );
    const res = E(xml);
    expect(res.inserted.map((i) => [i.pitch, i.midi])).toEqual([['F#4', 66]]);
    expect(res.inserted[0]!.onset).toBe('5/2');
  });

  it('a time change inside a bar leaves that bar alone', () => {
    const xml = beforeThirdNote(
      fixtureScore([
        CEEC,
        [
          ['C4', 1],
          ['E4', 1],
          ['G4', 2],
        ],
        [['C4', 4]],
      ]),
      '<attributes><time><beats>2</beats><beat-type>4</beat-type></time></attributes>',
    );
    const res = E(xml);
    expect(res.inserted.every((i) => !fracFrom(i.onset).lt(fracFrom('4')))).toBe(true);
    expect(res.inserted.map((i) => [i.rule, i.pitch, i.onset, i.bar])).toEqual([
      ['passing', 'D4', '9/2', '2'],
    ]);
    expect(res.skipped['time change inside the bar']).toBe(4);
  });

  it('a compound-meter dotted quarter splits into a quarter and an eighth', () => {
    const res = E(
      fixtureScore(
        [
          [
            ['C4', 3 / 2],
            ['E4', 3 / 2],
          ],
          [['C4', 3]],
        ],
        { lh: [[['C3', 3]], [['C3', 3]]], time: [6, 8] },
      ),
    );
    expect(rh(res.xml).slice(0, 2)).toEqual([
      [0, 60, 1],
      [1, 62, 0.5],
    ]);
    expect(res.inserted[0]!.beat).toBe('1.667');
  });
});

describe('writing', () => {
  it('serialisation keeps the declaration, DOCTYPE, comments and processing instructions', () => {
    const input = fixture4().replace(
      '<part id="P1">',
      '<part id="P1"><!-- a comment --><?app keep="yes"?>',
    );
    const res = E(input);
    expect(res.inserted.length).toBeGreaterThan(0);
    expect(res.xml.startsWith(input.slice(0, input.indexOf('<score-partwise')))).toBe(true);
    expect(res.xml).toContain('<!DOCTYPE score-partwise');
    expect(res.xml).toContain('<!-- a comment -->');
    expect(res.xml).toContain('<?app keep="yes"?>');
    expect(res.xml.endsWith('</score-partwise>\n')).toBe(true);
  });

  it('the divisions scale-up covers attack and release', () => {
    let input = fixture4({ lh: [[['C3', 4]], [['C3', 4]]], divisions: 1 }).replace(
      '<note><pitch><step>C</step><octave>3</octave>',
      '<note attack="1" release="-1"><pitch><step>C</step><octave>3</octave>',
    );
    const first = input.indexOf('<note>');
    input =
      input.slice(0, first) +
      '<direction placement="above"><direction-type><words>x</words></direction-type>' +
      '<offset>1</offset></direction>' +
      input.slice(first);
    const res = E(input);
    expect(rules(res)).toEqual(['passing']);
    expect(res.xml).toContain('<note attack="2" release="-2">');
    expect(res.xml).toContain('<offset>2</offset>');
    expect(res.xml).toContain('<divisions>2</divisions>');
  });

  it('coarse divisions are scaled up without changing any note', () => {
    const input = fixture4({
      lh: [
        [
          ['C3', 2],
          ['G3', 2],
        ],
        [['C3', 4]],
      ],
      divisions: 1,
    });
    const res = E(input);
    expect(rules(res)).toEqual(['passing']);
    expect(res.xml).toContain('<divisions>2</divisions>');
    expect(lh(res.xml)).toEqual(lh(input));
    expect(checked(input, res).ok).toBe(true);
  });

  it('the light factor leaves divisions that already split into eighths', () => {
    const res = E(
      fixtureScore(
        [
          [
            ['C4', 2],
            ['C4', 2],
          ],
          [['C4', 4]],
        ],
        { lh: [[['C3', 4]], [['C3', 4]]], divisions: 1 },
      ),
    );
    expect(res.inserted.map((i) => [i.rule, i.pitch, i.beat, i.length])).toEqual([
      ['neighbour-repeated', 'D4', '2', '1'],
    ]);
    expect(res.xml).toContain('<divisions>1</divisions>');
    expect(res.xml).not.toContain('<divisions>2</divisions>');
  });

  it('a file with nothing to add comes back unchanged', () => {
    const input = fixtureScore(
      [
        [
          ['C4', 1],
          ['D4', 1],
          ['E4', 2],
        ],
        [['D4', 4]],
      ],
      { divisions: 1 },
    );
    const res = E(input);
    expect(res.inserted).toEqual([]);
    expect(res.xml).toBe(input);
    expect(res.skipped).toEqual({ 'no rule fits': 3, 'last bar': 1 });
  });

  it('f major spells the passing B flat', () => {
    const res = E(
      fixtureScore(
        [
          [
            ['A4', 1],
            ['C5', 1],
            ['D5', 2],
          ],
          [['C5', 4]],
        ],
        { lh: [[['F3', 4]], [['F3', 4]]], fifths: -1 },
      ),
    );
    expect(res.inserted.map((i) => [i.rule, i.pitch, i.midi])).toEqual([['passing', 'Bb4', 70]]);
    expect(res.xml).toContain(
      '<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>6</duration>' +
        '<voice>1</voice><type>eighth</type><staff>1</staff></note>',
    );
  });

  it('g flat major spells C flat in octave 5', () => {
    const res = E(
      fixtureScore(
        [
          [
            ['Bb4', 1],
            ['Db5', 1],
            ['Eb5', 2],
          ],
          [['Db5', 4]],
        ],
        { lh: [[['Gb2', 4]], [['Gb2', 4]]], fifths: -6 },
      ),
    );
    expect(res.inserted.map((i) => [i.rule, i.pitch, i.midi])).toEqual([['passing', 'Cb5', 71]]);
    expect(res.xml).toContain('<step>C</step><alter>-1</alter><octave>5</octave>');
  });

  it('a note without voice and type is split in schema order', () => {
    const input = fixture4().replace('<voice>1</voice><type>quarter</type>', '');
    const res = E(input);
    expect(res.inserted.map((i) => [i.rule, i.pitch])).toEqual([['passing', 'D4']]);
    const split =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration>' +
      '<type>eighth</type><staff>1</staff></note>';
    const added =
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>6</duration>' +
      '<voice>1</voice><type>eighth</type><staff>1</staff></note>';
    expect(res.xml).toContain(split + added);
    expect(parseMusicXml(res.xml).warnings).toEqual(parseMusicXml(input).warnings);
  });

  it('the split note keeps its notations and the new note has none', () => {
    const input = fixture4().replace(
      '<staff>1</staff></note>',
      '<staff>1</staff><notations><technical><fingering>1</fingering></technical></notations></note>',
    );
    const res = E(input);
    expect(res.inserted.map((i) => [i.rule, i.pitch])).toEqual([['passing', 'D4']]);
    const { score, editorial } = parseMusicXml(res.xml);
    const ids = Object.keys(editorial);
    expect(ids).toHaveLength(1);
    const n = score.notes.find((x) => x.id === ids[0])!;
    expect([n.onsetTick, n.midi]).toEqual([0, 60]);
  });
});

describe('neighbour notes', () => {
  it('the neighbour on a repeated note is the upper whole step and returns', () => {
    const res = E(
      fixtureScore([
        [
          ['D4', 1],
          ['D4', 1],
          ['C4', 2],
        ],
        [['C4', 4]],
      ]),
    );
    expect(rules(res)).toEqual(['neighbour-repeated']);
    expect(
      rh(res.xml)
        .slice(0, 3)
        .map((e) => e[1]),
    ).toEqual([62, 64, 62]);
    expect(res.inserted[0]!.pitch).toBe('E4');
    expect(res.inserted[0]!.role).toBe('neighbour');
    expect(res.skipped).toEqual({ 'no rule fits': 1, 'last bar': 1 });
  });

  it('no neighbour a semitone above a repeated note', () => {
    for (const bars of [
      [
        [
          ['E4', 1],
          ['E4', 1],
          ['D4', 2],
        ],
        [['C4', 4]],
      ],
      [
        [
          ['B4', 1],
          ['B4', 1],
          ['A4', 2],
        ],
        [['G4', 4]],
      ],
    ] as Bar[][]) {
      const res = E(fixtureScore(bars));
      expect(res.inserted).toEqual([]);
      expect(res.skipped).toEqual({ 'no rule fits': 3, 'last bar': 1 });
    }
  });

  it('e flat major repeats a whole step up', () => {
    const res = E(
      fixtureScore(
        [
          [
            ['Eb4', 1],
            ['Eb4', 1],
            ['D4', 2],
          ],
          [['Eb4', 4]],
        ],
        { lh: [[['Eb3', 4]], [['Eb3', 4]]], fifths: -3 },
      ),
    );
    expect(res.inserted.map((i) => [i.rule, i.pitch, i.midi])).toEqual([
      ['neighbour-repeated', 'F4', 65],
    ]);
  });

  it('the long-note neighbour is not a light rule', () => {
    const res = E(
      fixtureScore([
        [
          ['G4', 2],
          ['A4', 1],
          ['G4', 1],
        ],
        [['G4', 4]],
      ]),
    );
    expect(res.inserted.map((i) => [i.rule, i.bar, i.beat, i.pitch, i.midi])).toEqual([
      ['neighbour-repeated', '1', '4.5', 'A4', 69],
    ]);
  });

  it('the anticipation is not a light rule', () => {
    for (const bars of [
      [
        [
          ['C4', 2],
          ['D4', 1],
          ['E4', 1],
        ],
        [['A4', 4]],
      ],
      [
        [
          ['C4', 2],
          ['D4', 2],
        ],
        [['G4', 4]],
      ],
    ] as Bar[][]) {
      expect(E(fixtureScore(bars)).inserted).toEqual([]);
    }
  });
});

describe('shared guards', () => {
  it('the left hand is untouched and the checker agrees', () => {
    const input = fixtureScore(
      [
        CEEC,
        [
          ['D4', 2],
          ['F4', 2],
        ],
        [['C4', 4]],
      ],
      {
        lh: [
          [
            ['C3', 2],
            ['G3', 2],
          ],
          [['G2', 4]],
          [['C3', 4]],
        ],
      },
    );
    const res = E(input);
    expect(lh(res.xml)).toEqual(lh(input));
    expect(res.inserted.map((i) => [i.rule, i.pitch, i.onset])).toEqual([['passing', 'D4', '1/2']]);
    const rep = checked(input, res);
    expect(rep.ok).toBe(true);
    expect(rep.strongTotal).toBe(6);
    expect(rep.strongKept).toBe(6);
  });

  it('a pitch class next to an accidental in the bar is skipped', () => {
    const res = E(
      fixtureScore(
        [
          [
            ['E4', 1],
            ['G4', 1],
            ['A4', 2],
          ],
          [['C4', 4]],
        ],
        {
          lh: [
            [
              ['D3', 2],
              ['F#3', 2],
            ],
            [['C3', 4]],
          ],
        },
      ),
    );
    expect(res.inserted).toEqual([]);
    expect(res.skipped['accidental nearby']).toBe(1);
  });

  it('tied, tuplet, fermata and last notes are not embellished', () => {
    const res = E(
      fixtureScore([
        [
          ['C4', 1, { tie: 'start' }],
          ['C4', 1, { tie: 'stop' }],
          ['E4', 1, { fermata: true }],
          ['G4', 1],
        ],
        [
          ['E4', 1 / 3, { tuplet: true }],
          ['F4', 1 / 3, { tuplet: true }],
          ['G4', 1 / 3, { tuplet: true }],
          ['E4', 1],
          ['C4', 2],
        ],
        [['C4', 4]],
      ]),
    );
    const onsets = res.inserted.map((i) => fracFrom(i.onset));
    const q = (n: number) => fracFrom(String(n));
    expect(onsets.every((o) => o.lt(q(0)) || !o.lt(q(3)))).toBe(true);
    expect(onsets.every((o) => o.lt(q(4)) || !o.lt(q(5)))).toBe(true);
    expect(onsets.every((o) => o.lt(q(8)))).toBe(true);
    expect(res.inserted.map((i) => [i.rule, i.pitch, i.onset])).toEqual([['passing', 'F4', '7/2']]);
    expect(res.skipped).toEqual({ tied: 2, fermata: 1, tuplet: 3, 'last bar': 1 });
  });

  it('an inserted note stays above every other sounding note', () => {
    const input = fixtureScore(
      [
        [
          ['C4', 1],
          ['E4', 1],
          ['G4', 2],
        ],
        [['C4', 4]],
      ],
      {
        lh: [
          [
            ['D4', 2],
            ['C3', 2],
          ],
          [['C3', 4]],
        ],
        rh2: [[['A3', 4]], [['r', 4]]],
      },
    );
    const res = E(input);
    expect(res.inserted.map((i) => i.pitch)).toEqual(['F4']);
    expect(res.skipped['not the top line']).toBe(1);
    expect(rh(res.xml, 2)).toEqual(rh(input, 2));
  });

  it('a pickup bar counts beats from the end', () => {
    const input = fixtureScore(
      [
        [['C4', 1]],
        [
          ['E4', 2],
          ['D4', 1],
        ],
        [['C4', 3]],
      ],
      { lh: [[['r', 1]], [['C3', 3]], [['C3', 3]]], time: [3, 4], pickup: true },
    );
    const res = E(input);
    expect(res.inserted[0]).toMatchObject({ bar: '0', beat: '3.5', measureIndex: 0 });
    expect(checked(input, res).ok).toBe(true);
  });

  it('every melody note gets at most one skip reason', () => {
    const res = E(
      fixtureScore([
        [
          ['C4', 1],
          ['D4', 1],
          ['E4', 1 / 2],
          ['G4', 1 / 2],
          ['A4', 1],
        ],
        [['G4', 4]],
      ]),
    );
    expect(res.skipped).toEqual({
      'no rule fits': 4,
      'too short or odd length': 1,
      'last bar': 1,
    });
  });

  it('a key change later in the document applies from its onset', () => {
    const plain = fixtureScore(
      [
        [
          ['C4', 1],
          ['D4', 1],
          ['E4', 1],
          ['G4', 1],
        ],
        [['A4', 4]],
      ],
      {
        lh: [
          [
            ['C3', 2],
            ['D3', 2],
          ],
          [['D3', 4]],
        ],
      },
    );
    const d3 = '<note><pitch><step>D</step><octave>3</octave>';
    const at = plain.indexOf(d3);
    const input =
      plain.slice(0, at) +
      '<attributes><key><fifths>1</fifths></key></attributes>' +
      plain.slice(at);
    expect(analyseMusicXml(input).melody.map((g) => top(g).fifths)).toEqual([0, 0, 1, 1, 1]);
    const res = E(input);
    expect(res.inserted.map((i) => [i.pitch, i.midi])).toEqual([['F#4', 66]]);
    expect(res.inserted[0]!.onset).toBe('5/2');
  });
});

describe('density', () => {
  it('light adds at most one figure per bar, never in two neighbouring bars', () => {
    const res = E(fixtureScore([CEEC, CEEC, CEEC, [['C4', 4]]]));
    const bars = res.inserted.map((i) => i.bar);
    expect(new Set(bars).size).toBe(bars.length);
    expect(bars).toEqual(['1', '3']);
    expect(rules(res).every((r) => r === 'passing' || r === 'neighbour-repeated')).toBe(true);
    expect(res.skipped).toEqual({ 'no rule fits': 3, 'last bar': 1 });
  });

  it('dropped bars lose their figure and no new figure appears', () => {
    const input = fixtureScore([CEEC, CEEC, CEEC, [['C4', 4]]]);
    const all = E(input);
    const res = embellishMusicXml(input, { dropBars: [0] });
    expect(res.inserted).toHaveLength(1);
    expect(res.inserted[0]!.bar).toBe('3');
    expect(res.inserted).toEqual(all.inserted.filter((i) => i.bar === '3'));
  });

  it('deterministic', () => {
    const input = fixtureScore([CEEC, CEEC, [['C4', 4]]]);
    const a = E(input);
    const b = E(input);
    expect(a.xml).toBe(b.xml);
    expect(a.inserted).toEqual(b.inserted);
  });

  it('only light is built', () => {
    expect(() => embellishMusicXml(fixture4(), { density: 'playful' as never })).toThrow(/light/);
  });
});
