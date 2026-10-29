import { DIVISIONS, type Rhythm } from './rhythm.js';

/**
 * The whistled tune as a MusicXML score (issue 237): one part, Piano, one treble staff, 4/4, the
 * key found from the notes and the tempo from the pulse. A note that crosses a barline, or whose
 * length no one note shows, is written as tied notes; a gap is rests. The same file the scanning
 * review and the strict import read for a scan.
 */

const BAR = 4 * DIVISIONS;

/** The notes a length can be written as, longest first, with the size of the unit it must start on. */
const SHAPES: { ticks: number; type: string; dots: number; align: number }[] = [
  { ticks: 16, type: 'whole', dots: 0, align: 16 },
  { ticks: 12, type: 'half', dots: 1, align: 8 },
  { ticks: 8, type: 'half', dots: 0, align: 8 },
  { ticks: 6, type: 'quarter', dots: 1, align: 4 },
  { ticks: 4, type: 'quarter', dots: 0, align: 4 },
  { ticks: 3, type: 'eighth', dots: 1, align: 2 },
  { ticks: 2, type: 'eighth', dots: 0, align: 2 },
  { ticks: 1, type: '16th', dots: 0, align: 1 },
];

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function spell(midi: number, fifths: number) {
  const name = (fifths < 0 ? FLATS : SHARPS)[((midi % 12) + 12) % 12]!;
  return {
    step: name[0]!,
    alter: name.endsWith('#') ? 1 : name.endsWith('b') ? -1 : 0,
    octave: Math.floor(midi / 12) - 1,
  };
}

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** The alteration the key signature gives each step: 1 for the sharped ones, -1 for the flatted. */
function signature(fifths: number): Map<string, number> {
  const steps = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  return new Map(steps.slice(0, Math.abs(fifths)).map((step) => [step, fifths > 0 ? 1 : -1]));
}

/** One notated piece of a note or rest: it fills `ticks` of a bar from `at`. */
interface Piece {
  midi: number | null;
  /** Ticks into its bar. */
  at: number;
  ticks: number;
  tiedFrom: boolean;
  tiedTo: boolean;
}

/** Cuts a stretch at the barlines and into lengths a note can show. */
function pieces(midi: number | null, start: number, length: number): Piece[] {
  const out: Piece[] = [];
  let at = start;
  const end = start + length;
  while (at < end) {
    const inBar = at % BAR;
    const room = Math.min(end - at, BAR - inBar);
    const shape = SHAPES.find((s) => s.ticks <= room && inBar % s.align === 0)!;
    out.push({ midi, at, ticks: shape.ticks, tiedFrom: false, tiedTo: false });
    at += shape.ticks;
  }
  if (midi !== null)
    out.forEach((piece, i) => {
      piece.tiedFrom = i > 0;
      piece.tiedTo = i < out.length - 1;
    });
  return out;
}

export function toMusicXml(rhythm: Rhythm): string {
  const { fifths, mode } = rhythm.key;
  const keySignature = signature(fifths);
  const all: Piece[] = [];
  let clock = 0;
  for (const note of rhythm.notes) {
    if (note.start > clock) all.push(...pieces(null, clock, note.start - clock));
    all.push(...pieces(note.midi, note.start, note.length));
    clock = note.start + note.length;
  }
  const bars = Math.max(1, Math.ceil(clock / BAR));
  if (clock < bars * BAR) all.push(...pieces(null, clock, bars * BAR - clock));

  const shapeOf = (ticks: number) => SHAPES.find((s) => s.ticks === ticks)!;
  const measures = Array.from({ length: bars }, (_, bar) => {
    // What a reader of the bar has in force for each step and octave: the signature, then each
    // accidental written so far (a sharp lasts to the barline, in its own octave).
    const inForce = new Map<string, number>();
    const body = all
      .filter((piece) => Math.floor(piece.at / BAR) === bar)
      .map((piece) => {
        const shape = shapeOf(piece.ticks);
        const ties =
          (piece.tiedFrom ? '<tie type="stop"/>' : '') +
          (piece.tiedTo ? '<tie type="start"/>' : '');
        const tied =
          (piece.tiedFrom ? '<tied type="stop"/>' : '') +
          (piece.tiedTo ? '<tied type="start"/>' : '');
        let pitch = '<rest/>';
        let accidental = '';
        if (piece.midi !== null) {
          const { step, alter, octave } = spell(piece.midi, fifths);
          pitch = `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
          const where = `${step}${octave}`;
          const shown = inForce.get(where) ?? keySignature.get(step) ?? 0;
          // A note tied from the last bar carries its accidental in the tie.
          if (alter !== shown && !piece.tiedFrom)
            accidental = `<accidental>${alter > 0 ? 'sharp' : alter < 0 ? 'flat' : 'natural'}</accidental>`;
          inForce.set(where, alter);
        }
        return (
          `<note>${pitch}` +
          `<duration>${piece.ticks}</duration>${ties}<voice>1</voice><type>${shape.type}</type>` +
          '<dot/>'.repeat(shape.dots) +
          accidental +
          (tied ? `<notations>${tied}</notations>` : '') +
          '</note>'
        );
      })
      .join('');
    const opening =
      bar === 0
        ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths>` +
          `<mode>${mode}</mode></key><time><beats>4</beats><beat-type>4</beat-type></time>` +
          '<clef><sign>G</sign><line>2</line></clef></attributes>' +
          '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>' +
          `<per-minute>${rhythm.bpm}</per-minute></metronome></direction-type>` +
          `<sound tempo="${rhythm.bpm}"/></direction>`
        : '';
    const closing =
      bar === bars - 1
        ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>'
        : '';
    return `<measure number="${bar + 1}">${opening}${body}${closing}</measure>`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name>' +
    '</score-part></part-list><part id="P1">' +
    measures.join('') +
    '</part></score-partwise>'
  );
}
