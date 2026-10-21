import { formatNumber, plural } from '../format.js';
import type { Messages } from '../messages.js';

const notes = (n: number) => plural('nl', n, { one: '# noot', other: '# noten' });

export const score: Messages['score'] = {
  fingerLegend:
    'Vingernummers: 1 is de duim en 5 de pink, in beide handen. De bovenste notenbalk is de rechterhand, de onderste de linkerhand.',
  noteLetters: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  header: {
    back: 'Terug naar de bibliotheek',
    favourite: 'Favoriet',
  },
  sheet: {
    label: (title: string) => `Partituur van ${title}`,
  },
  keyboard: {
    label: 'Toetsenbord',
    hands: { L: 'L', R: 'R' },
  },
  view: {
    status: {
      loading: 'De partituur laden…',
      fingering: 'Vingerzetting maken…',
      rendering: 'De partituur voorbereiden…',
    },
    loadingPiano: 'De piano laden…',
    editorialShown: 'De vingerzetting van de redacteur wordt getoond',
    noNotesLeft: 'Dit stuk heeft geen noten voor de linkerhand.',
    noNotesRight: 'Dit stuk heeft geen noten voor de rechterhand.',
    noNotes: 'Dit stuk heeft geen noten om te spelen.',
    practice: 'Oefenen',
    scanSource: 'Scanbron en herkenning',
    couldNotOpenFile: (name: string) =>
      `${name} kon niet worden geopend. Dit bestand kon niet als partituur worden gelezen. digitus2 opent MusicXML- en MIDI-bestanden (.musicxml, .xml, .mxl, .mid of .midi).`,
    couldNotOpenPiece: (name: string) =>
      `${name} kon niet worden geopend. Er ging iets mis bij het voorbereiden van dit stuk. Probeer het opnieuw.`,
    details: (error: string) => `Details: ${error}`,
  },
  side: {
    label: 'Stuk en vingerzetting',
    facts: {
      level: 'Niveau',
      key: 'Toonsoort',
      time: 'Maatsoort',
      length: 'Duur',
      bars: 'Maten',
    },
    // Dutch writes the accidental into the name (Fis, Bes, Es, As); major with a capital, minor
    // without: Bes-groot, fis-klein.
    keyName: (tonic: string, accidental: '' | '#' | 'b', mode: 'major' | 'minor') => {
      const flat =
        tonic === 'B' ? 'Bes' : tonic === 'E' || tonic === 'A' ? `${tonic}s` : `${tonic}es`;
      const name = accidental === '#' ? `${tonic}is` : accidental === 'b' ? flat : tonic;
      return mode === 'major' ? `${name}-groot` : `${name.toLowerCase()}-klein`;
    },
    handSize: {
      label: 'Handgrootte',
      large: 'Groot',
      medium: 'Gemiddeld',
      small: 'Klein',
      child: 'Kind',
      help: 'De handgrootte bepaalt welke spreidingen de vingerzetting toestaat. Kies kind of klein voor kleine handen.',
    },
    showEditorial: 'Toon de vingerzetting van de redacteur',
    exportButton: 'MusicXML exporteren',
    print: 'Afdrukken',
    exportFailed: (reason: string) => `De partituur kon niet worden geëxporteerd: ${reason}`,
    printFailed: (reason: string) => `De partituur kon niet worden afgedrukt: ${reason}`,
    printHeadingTooLong: 'De titel en bronvermelding zijn te lang voor een afgedrukte pagina.',
    details: 'Details',
    timings: (solveMs: number, renderMs: number) =>
      `Vingerzetting in ${solveMs} ms · opmaak in ${renderMs} ms`,
  },
  midi: {
    label: 'MIDI-import',
    splitLabel: 'Handverdeling',
    automatic: 'Automatisch',
    splitHelp: 'Toetsen vanaf de gekozen noot omhoog gaan naar de rechterhand.',
    grids: {
      sixteenth: 'een raster van zestiende noten',
      sixteenthTriplets: 'een raster van zestiende noten met triolen',
      thirtySecond: 'een raster van tweeëndertigste noten',
      thirtySecondTriplets: 'een raster van tweeëndertigste noten met triolen',
    },
    importLine: (grid: string, movedPercent: number) =>
      `Geïmporteerd uit MIDI: noten gekwantiseerd naar ${grid}; ${formatNumber('nl', movedPercent)} % meer dan een vierenzestigste noot verschoven`,
    handCounts: (right: number, left: number) =>
      `Rechterhand: ${notes(right)} · linkerhand: ${notes(left)}`,
  },
  doc: {
    fetchFailed: (status: number) =>
      `het partituurbestand kon niet worden opgehaald (HTTP ${status})`,
    noPiece: (slug: string) => `er is geen stuk met de naam “${slug}”`,
    layoutFailed: 'de partituur kon niet worden opgemaakt, probeer het opnieuw',
  },
};
