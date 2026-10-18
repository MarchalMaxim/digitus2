import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { beamGroups, compareBeams, errorClasses } from './diagnose.mjs';

const E = await import(
  pathToFileURL(resolve(import.meta.dirname, '../../packages/engine/dist/src/index.js')).href
);
const parse = (xml) => E.parseMusicXml(xml, { preserveNotation: true }).score;

/** One note: `p` is C5, A4 ... or 'r'; options: staff, chord, tie ('start' | 'stop'), beam. */
function n(p, duration, type, o = {}) {
  const staff = o.staff ?? 1;
  const pitch =
    p === 'r'
      ? '<rest/>'
      : `<pitch><step>${p[0]}</step><octave>${p.slice(1)}</octave></pitch>`;
  const tie = o.tie ? `<tie type="${o.tie}"/>` : '';
  const beam = o.beam ? `<beam number="1">${o.beam}</beam>` : '';
  return `<note>${o.chord ? '<chord/>' : ''}${pitch}<duration>${duration}</duration>${tie}<voice>${staff === 1 ? 1 : 5}</voice><type>${type}</type><staff>${staff}</staff>${beam}</note>`;
}
const backup = (d) => `<backup><duration>${d}</duration></backup>`;
function score(measures) {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures
    .map(
      (m, i) =>
        `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>2</divisions><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' : ''}${m}</measure>`,
    )
    .join('')}</part></score-partwise>`;
}
const LH = backup(6) + n('C3', 6, 'half', { staff: 2 });

test('a chord tie the recognition missed is counted, and an extra one too', () => {
  // Reference: C5+E5 chord tied into the next bar. Recognition: only E5 keeps its tie.
  const reference = score([
    n('D5', 4, 'half') + n('C5', 2, 'quarter', { tie: 'start' }) + n('E5', 2, 'quarter', { chord: true, tie: 'start' }) + LH,
    n('C5', 2, 'quarter', { tie: 'stop' }) + n('E5', 2, 'quarter', { chord: true, tie: 'stop' }) + n('r', 4, 'half') + LH,
  ]);
  const recognized = score([
    n('D5', 4, 'half') + n('C5', 2, 'quarter') + n('E5', 2, 'quarter', { chord: true, tie: 'start' }) + LH,
    n('C5', 2, 'quarter') + n('E5', 2, 'quarter', { chord: true, tie: 'stop' }) + n('r', 4, 'half') + LH,
  ]);
  const classes = errorClasses(parse(reference), parse(recognized));
  assert.equal(classes.tiesMissed, 1);
  assert.equal(classes.tiesExtra, 0);
  const reverse = errorClasses(parse(recognized), parse(reference));
  assert.equal(reverse.tiesExtra, 1);
  assert.equal(reverse.tiesMissed, 0);
});

test('duplicated notes and notes on the wrong staff are counted separately', () => {
  const reference = score([n('C5', 6, 'half') + backup(6) + n('E3', 6, 'half', { staff: 2 })]);
  const recognized = score([
    n('C5', 6, 'half') + n('C5', 6, 'half', { chord: true }) + n('E3', 6, 'half', { chord: true }) + backup(6) + n('r', 6, 'half', { staff: 2 }),
  ]);
  const classes = errorClasses(parse(reference), parse(recognized));
  assert.equal(classes.duplicates, 1);
  assert.equal(classes.wrongStaff, 1);
  assert.deepEqual(errorClasses(parse(reference), parse(reference)), {
    tiesMissed: 0,
    tiesExtra: 0,
    duplicates: 0,
    wrongStaff: 0,
  });
});

test('beam groups are read from the source XML and compared as exact groups', () => {
  const six = ['begin', 'continue', 'continue', 'continue', 'continue', 'end'];
  const pairs = ['begin', 'end', 'begin', 'end', 'begin', 'end'];
  const bar = (beams) =>
    score([beams.map((beam) => n('C5', 1, 'eighth', { beam })).join('') + LH]);
  const reference = beamGroups(bar(six));
  assert.deepEqual(reference, [{ bar: 0, staff: 1, onsets: ['0/1', '1/2', '1/1', '3/2', '2/1', '5/2'] }]);
  const asPairs = compareBeams(reference, beamGroups(bar(pairs)));
  assert.deepEqual(asPairs, { matched: 0, reference: 1, recognized: 3, f1: 0 });
  assert.equal(compareBeams(reference, reference).f1, 1);
  // A recognition without beams has nothing to match.
  assert.deepEqual(compareBeams(reference, beamGroups(bar([undefined, undefined, undefined, undefined, undefined, undefined]))), {
    matched: 0,
    reference: 1,
    recognized: 0,
    f1: 0,
  });
});
