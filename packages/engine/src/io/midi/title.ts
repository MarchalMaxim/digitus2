/**
 * Titles of a MIDI import: the sequence name when it names a piece, else the file name made
 * readable. A name such as "Piano", "Track 1" or a copyright line is no title.
 */

/** midi-file reads meta text one byte per character (Latin-1); this restores the real text. */
export function decodeMetaText(text: string): string {
  const codes = Array.from(text, (c) => c.charCodeAt(0));
  let out: string;
  if (codes.some((c) => c > 255)) out = text;
  else if (codes[0] === 0xfe && codes[1] === 0xff) out = utf16(codes, false);
  else if (codes[0] === 0xff && codes[1] === 0xfe) out = utf16(codes, true);
  else {
    try {
      out = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(codes));
    } catch {
      out = text;
    }
  }
  // eslint-disable-next-line no-control-regex
  return out.replace(/\u0000/g, '').trim();
}

function utf16(bytes: number[], littleEndian: boolean): string {
  let out = '';
  for (let i = 2; i + 1 < bytes.length; i += 2) {
    const a = bytes[i]!;
    const b = bytes[i + 1]!;
    out += String.fromCharCode(littleEndian ? a | (b << 8) : (a << 8) | b);
  }
  return out;
}

const GENERIC_WORDS = new Set(
  `track tracks seq sequence sequencer untitled unnamed new song midi file conductor control
   tempo master global meta setup system gs gm xg reset staff part voice instrument channel ch
   up down upper lower right left hand hands rh lh md mg mi treble bass melody accompaniment
   accomp solo primo secondo rechts links droite gauche derecha izquierda pf piano pianoforte
   grand acoustic bright electric honky tonk keyboard keys harpsichord organ strings string
   ensemble violin viola cello flute oboe clarinet bassoon horn trumpet guitar harp choir vocals
   vox drums percussion score partitur partition partitura klavier flügel flugel fluegel clavier
   clavecin cembalo mano main mão mao rechte linke rechter linker direita esquerda
   rechterhand linkerhand`.split(/\s+/),
);
const SOFTWARE_OR_RIGHTS =
  /copyright|\(c\)|©|all rights|generated|lilypond|musescore|sibelius|\bfinale\s+(?:v?\d|\()|cakewalk|sonar|garageband|noteworthy|http|www\.|\b(?:sequenced|created|arranged|edited|transcribed|programmed|typeset|made)\s+(?:by|with)\b/;
const MAX_TITLE_LENGTH = 80;

/** True for a name that cannot title a piece: empty, an instrument, a track label, a credit. */
export function isGenericName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > MAX_TITLE_LENGTH || !/\p{L}/u.test(trimmed)) return true;
  if (SOFTWARE_OR_RIGHTS.test(trimmed.toLowerCase())) return true;
  const tokens = trimmed
    .split(/(?<=\p{Ll})(?=\p{Lu})|[^\p{L}\p{N}]+/u)
    .filter((t) => t !== '')
    .map((t) => t.toLowerCase());
  return tokens.every((t) => /^\d+$/.test(t) || t.length === 1 || GENERIC_WORDS.has(t));
}

const ABBREVIATIONS: Readonly<Record<string, string>> = { op: 'Op.', no: 'No.', nr: 'Nr.' };

/**
 * "SchumannOp15No07" -> "Schumann Op. 15 No. 7": words split at case and digit changes, a stem
 * without spaces gets its hyphens and underscores read as spaces, and opus and number
 * abbreviations lose their zeros. A stem with spaces keeps its own spacing. Never capitalises.
 */
export function cleanFileTitle(stem: string): string {
  let s = stem.replace(/_/g, ' ');
  if (!/\s/.test(stem))
    s = s.replace(/(?<=\S)-(?=\S)/g, ' ').replace(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})/gu, ' ');
  s = s.replace(
    /\b(op|no|nr)\s*0*(\d+)\b/gi,
    (_, word: string, n: string) => `${ABBREVIATIONS[word.toLowerCase()]!} ${n}`,
  );
  s = s.replace(/\s+/g, ' ').trim();
  return s === '' ? stem : s;
}
