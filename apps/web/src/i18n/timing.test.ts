import { describe, expect, it } from 'vitest';
import { score as en } from './en/score.js';
import { score as es } from './es/score.js';
import { score as fr } from './fr/score.js';
import { score as nl } from './nl/score.js';
import { score as pt } from './pt/score.js';

/**
 * The status line after a run of Play with the piano (issue 192): how many notes came on time, and
 * what the rings show. The first sentence agrees with the total (with the on-time count in
 * French); the second appears only when a note was not on time, and names one ring or several,
 * "the other(s)" when some note was on time, "it / them" when none was.
 */
const cases = [
  {
    lang: 'en',
    view: en.view,
    summary: {
      '0/1': '0 of 1 note on time. The ring shows it.',
      '1/1': '1 of 1 note on time.',
      '0/2': '0 of 2 notes on time. The rings show them.',
      '1/2': '1 of 2 notes on time. The ring shows the other.',
      '1/3': '1 of 3 notes on time. The rings show the others.',
    },
    all: 'Every note on time.',
    faster: 'Every note on time. Try it a little faster.',
  },
  {
    lang: 'es',
    view: es.view,
    summary: {
      '0/1': '0 de 1 nota a tiempo. El círculo la señala.',
      '1/1': '1 de 1 nota a tiempo.',
      '0/2': '0 de 2 notas a tiempo. Los círculos las señalan.',
      '1/2': '1 de 2 notas a tiempo. El círculo señala la otra.',
      '1/3': '1 de 3 notas a tiempo. Los círculos señalan las demás.',
    },
    all: 'Todas las notas a tiempo.',
    faster: 'Todas las notas a tiempo. Pruébalo un poco más rápido.',
  },
  {
    lang: 'fr',
    view: fr.view,
    summary: {
      '0/1': '0 note sur 1 en rythme. Le cercle la montre.',
      '1/1': '1 note sur 1 en rythme.',
      '0/2': '0 note sur 2 en rythme. Les cercles les montrent.',
      '1/2': '1 note sur 2 en rythme. Le cercle montre l’autre.',
      '1/3': '1 note sur 3 en rythme. Les cercles montrent les autres.',
    },
    all: 'Toutes les notes en rythme.',
    faster: 'Toutes les notes en rythme. Essayez un peu plus vite.',
  },
  {
    lang: 'nl',
    view: nl.view,
    summary: {
      '0/1': '0 van 1 noot op tijd. De cirkel wijst hem aan.',
      '1/1': '1 van 1 noot op tijd.',
      '0/2': '0 van de 2 noten op tijd. De cirkels wijzen ze aan.',
      '1/2': '1 van de 2 noten op tijd. De cirkel wijst de andere aan.',
      '1/3': '1 van de 3 noten op tijd. De cirkels wijzen de andere aan.',
    },
    all: 'Elke noot op tijd.',
    faster: 'Elke noot op tijd. Probeer het iets sneller.',
  },
  {
    lang: 'pt',
    view: pt.view,
    summary: {
      '0/1': '0 de 1 nota no tempo. O círculo a mostra.',
      '1/1': '1 de 1 nota no tempo.',
      '0/2': '0 de 2 notas no tempo. Os círculos as mostram.',
      '1/2': '1 de 2 notas no tempo. O círculo mostra a outra.',
      '1/3': '1 de 3 notas no tempo. Os círculos mostram as outras.',
    },
    all: 'Todas as notas no tempo.',
    faster: 'Todas as notas no tempo. Tente um pouco mais rápido.',
  },
] as const;

describe('the timing summary', () => {
  it.each(cases)('$lang counts the notes on time and names the rings', ({ view, summary }) => {
    for (const [pair, text] of Object.entries(summary)) {
      const [onTime, total] = pair.split('/').map(Number) as [number, number];
      expect(view.timingSummary(onTime, total), pair).toBe(text);
    }
  });

  it.each(cases)('$lang says when every note was on time', ({ view, all, faster }) => {
    expect(view.timingAllOnTime).toBe(all);
    expect(view.timingAllOnTimeFaster).toBe(faster);
  });

  it('writes the numbers the way the language does', () => {
    expect(en.view.timingSummary(12, 16)).toBe(
      '12 of 16 notes on time. The rings show the others.',
    );
    expect(en.view.timingSummary(1200, 2700)).toBe(
      '1,200 of 2,700 notes on time. The rings show the others.',
    );
    expect(nl.view.timingSummary(1200, 2700)).toBe(
      '1.200 van de 2.700 noten op tijd. De cirkels wijzen de andere aan.',
    );
  });
});
