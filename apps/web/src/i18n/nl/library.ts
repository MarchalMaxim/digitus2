import { formatNumber, plural } from '../format.js';
import type { Messages } from '../messages.js';

const pieces = (n: number) => plural('nl', n, { one: '# stuk', other: '# stukken' });

export const library: Messages['library'] = {
  tiers: { easy: 'Makkelijk', medium: 'Gemiddeld', harder: 'Moeilijker', challenging: 'Uitdagend' },
  pieces,
  welcome: {
    tagline: 'Vingernummers voor piano. Kies een stuk, druk op Afspelen en volg de rode noot.',
    startWith: (title: string) => `Begin met ${title}`,
    continueWith: (title: string) => `Ga verder met ${title}`,
  },
  pills: {
    level: 'Niveau',
    length: 'Duur',
    lengths: {
      any: 'Elke duur',
      short: 'Korter dan 1 min',
      medium: '1 tot 3 min',
      long: 'Langer dan 3 min',
    },
  },
  shelves: {
    songs: {
      name: 'Liedjes',
      line: 'Bekende melodieën, van kinderliedjes tot filmmuziek en games.',
      all: (n: number) => `Alle ${formatNumber('nl', n)} liedjes`,
    },
    classical: {
      name: 'Klassiek',
      line: 'Mozart, Clementi, Czerny en de etudes waar pianisten mee opgroeien.',
      all: (n: number) => `Alle ${formatNumber('nl', n)} klassieke stukken`,
    },
    folk: {
      name: 'Volksmuziek en kerstliederen',
      line: 'Volksmelodieën, dansen, kerstliederen en hymnes.',
      all: (n: number) => `Alle ${formatNumber('nl', n)} volksmelodieën en kerstliederen`,
    },
    baroque: {
      name: 'Barok',
      line: 'Bach, Händel, Scarlatti en anderen, 1600 tot 1750.',
      all: (n: number) => `Alle ${formatNumber('nl', n)} barokstukken`,
    },
    romantic: {
      name: 'Romantiek',
      line: 'Schumann, Chopin, Tsjaikovski en anderen, 1820 tot 1900.',
      all: (n: number) => `Alle ${formatNumber('nl', n)} romantische stukken`,
    },
    jazz: {
      name: 'Jazz, ragtime en modern',
      line: 'De rags van Joplin en muziek geschreven sinds 1900.',
      all: (n: number) => `Alle ${formatNumber('nl', n)} jazz-, ragtime- en moderne stukken`,
    },
  },
  list: {
    allStyles: 'Alle stijlen',
    otherPieces: 'Overige stukken',
    showMore: (n: number) => `Nog ${formatNumber('nl', n)} tonen`,
    showLast: (n: number) =>
      plural('nl', n, { one: 'Laatste stuk tonen', other: 'Laatste # tonen' }),
    allInLevel: (n: number, level: string) => `Alle ${formatNumber('nl', n)} in ${level}`,
    openPiece: (title: string, composer: string) => `Open ${title} van ${composer}`,
  },
  search: {
    label: 'De bibliotheek doorzoeken',
    placeholder: 'Zoek stukken en componisten',
    clear: 'Wissen',
    clearLabel: 'Zoekopdracht wissen',
    noMatch: (query: string) => `Geen stuk gevonden voor “${query}”.`,
    noMatchHint: 'Zoeken werkt op titels, componisten en verzamelingen.',
  },
  announce: {
    counted: (name: string, n: number) => `${name}: ${pieces(n)}`,
    showing: (shown: number, total: number) =>
      `${formatNumber('nl', shown)} van ${formatNumber('nl', total)} getoond`,
    showingIn: (shown: number, total: number, level: string) =>
      `${formatNumber('nl', shown)} van ${formatNumber('nl', total)} getoond in ${level}`,
  },
  aboutAndLicences: 'Info en licenties',
  ownFile: {
    open: 'Open je eigen partituur',
    dropTitle: 'Laat los om dit bestand te openen',
    dropHint: 'MusicXML, MIDI, foto of PDF',
    notScore: 'Dit lijkt geen MusicXML- of MIDI-bestand (.musicxml, .xml, .mxl, .mid of .midi).',
    oneAtATime: 'Open één MusicXML- of MIDI-bestand tegelijk.',
    cannotReadFiles: 'Deze bestanden konden niet worden gelezen.',
    cannotReadFile: 'Dit bestand kon niet worden gelezen.',
  },
  favourites: {
    heading: 'Favorieten',
    line: 'De stukken die je met het hartje hebt gemarkeerd, nieuwste eerst.',
    all: (n: number) => `Alle ${formatNumber('nl', n)} favorieten`,
    remove: (title: string, composer: string) =>
      `${title} van ${composer} uit Favorieten verwijderen`,
    removed: (title: string) => `${title} staat niet meer in Favorieten.`,
  },
  myScores: {
    heading: 'Mijn partituren',
    saved: 'Opgeslagen',
    thisVisitOnly: 'Alleen beschikbaar tijdens dit bezoek',
    saving: 'Opslaan…',
    open: (name: string) => `Opgeslagen ${name} openen`,
    removeLabel: (name: string) => `Opgeslagen ${name} verwijderen`,
    remove: 'Verwijderen',
    detail: {
      file: 'Partituurbestand',
      recognition: 'Herkenning opgeslagen',
      draft: 'Scanconcept',
      corrected: 'Gecorrigeerde herkenning',
    },
    removeFailed: 'Deze partituur kon niet worden verwijderd. Probeer het opnieuw.',
    removedNotErased:
      'Deze partituur is voor dit bezoek verwijderd, maar de opslag van je browser kon niet worden bijgewerkt. Na het herladen kan de partituur terugkomen.',
    saveFailed: 'Je partituur kon niet worden opgeslagen. Bewaar je originele bestanden.',
    openFailed:
      'Deze opgeslagen partituur kon niet worden geopend. Kies je originele bestand opnieuw.',
  },
  credit: {
    arrangement: 'Arrangement van digitus2, CC0 (publiek domein)',
    unnamedTypesetter: 'een onbekende zetter',
    engraving: (by: string, licence: string) =>
      `Notenzetwerk van ${by} voor het Mutopia Project, ${licence}`,
    engravingPublicDomain: (by: string) =>
      `Notenzetwerk van ${by} voor het Mutopia Project, publiek domein`,
  },
  loadFailed:
    'De gegevens van het stuk konden niet worden geladen. Controleer de verbinding en probeer het opnieuw.',
};
