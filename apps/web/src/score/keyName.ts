import type { Messages } from '../i18n/messages.js';

/**
 * A piece's key as the manifest writes it ("Bb major", "A minor"), in the language of `t`: the
 * tonic is named the way that language names notes ("Si bémol majeur"). A key in any other form is
 * shown as it is.
 */
export function keyName(key: string, t: Messages): string {
  const m = /^([A-G])([#b]?) (major|minor)$/.exec(key);
  if (!m) return key;
  const tonic = t.score.noteLetters['CDEFGAB'.indexOf(m[1]!)]!;
  return t.score.side.keyName(tonic, m[2] as '' | '#' | 'b', m[3] as 'major' | 'minor');
}
