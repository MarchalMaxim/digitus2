import type { Messages } from '../messages.js';
import { formatNumber, plural } from '../format.js';

const NUMBER_WORDS = [
  'Geen',
  'Eén',
  'Twee',
  'Drie',
  'Vier',
  'Vijf',
  'Zes',
  'Zeven',
  'Acht',
  'Negen',
];

const count = (n: number) => NUMBER_WORDS[n] ?? formatNumber('nl', n);

export const about: Messages['about'] = {
  back: 'Terug naar de bibliotheek',
  title: 'Over digitus2',
  what: {
    heading: 'Wat dit is',
    body: 'digitus2 zet vingernummers op pianomuziek voor beginnende en gevorderde spelers.',
  },
  how: {
    heading: 'Hoe de vingerzettingen worden gekozen',
    body: (version: string) =>
      'De engine beoordeelt elke mogelijke vingerzetting met ergonomische regels uit de ' +
      'literatuur over pianovingerzetting (vingerspreiding, duimonderzettingen, zwakke ' +
      'vingers, zwarte toetsen, wisselingen van handpositie) en kiest met een exacte ' +
      'zoekmethode de vingerzetting met de laagste kosten voor het hele stuk. Je handgrootte ' +
      `bepaalt welke spreidingen zijn toegestaan. De engineversie is ${version}.`,
  },
  who: {
    heading: 'Wie het maakte',
    body:
      'Gemaakt door Claude, het AI-model van Anthropic, in een zelfstandig bouwproces van ' +
      'meerdere dagen onder leiding van Maxim Marchal. Voor zover wij weten bestaat zoiets nog niet: ' +
      'een vingerzettingsengine die is getoetst aan annotaties van experts. De code, de ' +
      'onderzoeksnotities en de verificatieresultaten staan in de [repository].',
  },
  licences: {
    heading: 'Licenties',
    digitus2: '[digitus2] is vrije software onder de MIT-licentie.',
    verovio:
      'Notenzetting door [Verovio], LGPL-3.0-or-later, gebruikt als ongewijzigde bibliotheek.',
    pdfjs: 'PDF-voorbeelden gebruiken [PDF.js] ([Apache-2.0]).',
    midiFile: 'MIDI-bestanden worden gelezen met [midi-file] (MIT).',
    piano:
      'Pianogeluid: [smplr] (MIT) speelt de samples van de [Splendid Grand Piano] af (publiek domein).',
  },
  pieces: {
    heading: 'De ingebouwde stukken',
    intro:
      'De stukken gebruiken uitgaven uit het publieke domein of met een Creative Commons-licentie.',
    count,
    credit: (shareAlike: number, attribution: number) => {
      const credited = 'hier en op hun partituurpagina’s vermeld.';
      if (shareAlike === 1 && attribution === 0)
        return 'Eén uitgave is gedeeld onder CC BY-SA en wordt hier en op de partituurpagina vermeld.';
      const start = `${count(shareAlike)} uitgaven zijn gedeeld onder CC BY-SA en`;
      return attribution === 0
        ? `${start} worden ${credited}`
        : `${start} ${count(attribution).toLowerCase()} onder CC BY; alle worden ${credited}`;
    },
    columns: { piece: 'Stuk', composer: 'Componist', engraving: 'Uitgave', licence: 'Licentie' },
    arrangement: 'digitus2-arrangement',
    unnamedTypesetter: 'Onbekende zetter',
    archive: (n: number) =>
      plural('nl', n, { one: '# extra partituur komt', other: '# extra partituren komen' }) +
      ' uit het MuseScore-archief (de PDMX-dataset). Elke partituur is publiek domein of CC0, ' +
      'zoals de uploader het opgaf, en noemt op de eigen partituurpagina de bron en de licentie.',
  },
};
