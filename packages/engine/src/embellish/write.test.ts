// The embellisher's writer.
import { describe, expect, it } from 'vitest';
import { childElements, firstChild, parseXml } from '../io/musicxml/dom.js';
import type { Element } from '../io/musicxml/dom.js';
import type { EmbNote } from './analyse.js';
import { frac } from './frac.js';
import { insertNewNote } from './write.js';

const MEASURE =
  '<measure number="1">\n  <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice></note>\n  <note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice></note>\n</measure>';

const stepsOf = (measure: Element) =>
  childElements(measure, 'note').map(
    (n) => firstChild(firstChild(n, 'pitch')!, 'step')!.textContent,
  );

describe('insertNewNote', () => {
  const setup = () => {
    const measure = parseXml(MEASURE).documentElement!;
    const first = childElements(measure, 'note')[0]!;
    const a = { el: first, divisions: 4, voice: '1', staff: '1' } as EmbNote;
    return { measure, a };
  };

  it('puts a new note right after the note it splits, indented like the rest', () => {
    const { measure, a } = setup();
    insertNewNote(a, 62, frac(1), 0);
    expect(stepsOf(measure)).toEqual(['C', 'D', 'G']);
    expect(measure.toString()).toContain('</note>\n  <note><pitch><step>D</step>');
  });

  it('keeps several notes in order when each goes after the previous one', () => {
    const { measure, a } = setup();
    const d = insertNewNote(a, 62, frac(1), 0);
    insertNewNote(a, 64, frac(1), 0, d);
    expect(stepsOf(measure)).toEqual(['C', 'D', 'E', 'G']);
  });
});
