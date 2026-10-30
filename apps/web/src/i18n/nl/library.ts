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
    showOther: 'Toon andere stukken',
    showMore: (n: number) => `Nog ${formatNumber('nl', n)} tonen`,
    showLast: (n: number) =>
      plural('nl', n, { one: 'Laatste stuk tonen', other: 'Laatste # tonen' }),
    allInLevel: (n: number, level: string) => `Alle ${formatNumber('nl', n)} in ${level}`,
    openPiece: (title: string, composer: string | null) =>
      composer === null ? `Open ${title}` : `Open ${title} van ${composer}`,
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
    dealt: 'Andere stukken getoond',
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
  piano: {
    start: 'Speel mee op je piano',
    asking: 'Sta de browser toe je piano te gebruiken.',
    searching: 'Je piano wordt gezocht. Controleer of hij aanstaat.',
    connected: (name: string) => `${name} is verbonden. Open een stuk en speel de rode noot.`,
    yourPiano: 'Je piano',
    none: 'Geen piano gevonden. Sluit hem aan met een USB-kabel, of koppel hem via Bluetooth en zet hem aan.',
    bluetoothFlag: (flag: string) =>
      `Op Windows heeft een Bluetooth-piano ook ${flag} op Enabled nodig.`,
    denied:
      'De browser blokkeert MIDI voor deze site. Sta het toe in de site-instellingen en druk opnieuw.',
    turnOff: 'Uitzetten',
  },
  favourites: {
    heading: 'Favorieten',
    line: 'De stukken die je met het hartje hebt gemarkeerd, nieuwste eerst.',
    all: (n: number) => `Alle ${formatNumber('nl', n)} favorieten`,
    remove: (title: string, composer: string | null) =>
      composer === null
        ? `${title} uit Favorieten verwijderen`
        : `${title} van ${composer} uit Favorieten verwijderen`,
  },
  myScores: {
    heading: 'Mijn partituren',
    saved: 'Opgeslagen',
    thisVisitOnly: 'Alleen beschikbaar tijdens dit bezoek',
    saving: 'Opslaan…',
    open: (name: string) => `Opgeslagen ${name} openen`,
    removeLabel: (name: string) => `Opgeslagen ${name} verwijderen`,
    remove: 'Verwijderen',
    removed: (name: string) => `${name} verwijderd.`,
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
  shared: {
    share: 'Delen',
    shareLabel: (name: string) => `${name} delen`,
    withdraw: 'Intrekken',
    withdrawLabel: (name: string) => `${name} uit de controle halen`,
    detail: { waiting: 'Wacht op controle', shared: 'Gedeeld', notShared: 'Niet gedeeld' },
    sent: 'Ter controle verstuurd. Het verschijnt onder Gedeeld door lezers zodra de eigenaar het heeft gelezen.',
    unavailable: 'Delen is nu niet beschikbaar. Probeer het later opnieuw.',
    tooLarge: 'Deze partituur is te groot om te delen.',
    withdrawFailed: 'Deze partituur kon niet worden ingetrokken. Probeer het opnieuw.',
    sheetHeading: 'Delen met andere lezers',
    title: 'Titel',
    composer: 'Componist',
    titleMissing: 'Geef de partituur een titel.',
    rule: 'Deel alleen muziek waarvan het auteursrecht is verlopen of die je zelf hebt geschreven. De eigenaar leest elke partituur voordat anderen haar kunnen vinden.',
    free: 'Deze muziek mag vrij gedeeld worden',
    tick: 'Vink het vakje aan om deze partituur te delen.',
    cancel: 'Annuleren',
    shelf: 'Gedeeld door lezers',
    more: 'Meer gedeelde partituren',
    open: (title: string) => `${title} openen (gedeeld)`,
    byReader: 'Gedeeld door een lezer',
    report: 'Melden',
    notLoaded: 'Deze gedeelde partituur kon niet worden geladen.',
    reportHeading: 'Deze partituur melden',
    reasons: {
      copyright: 'Er rust auteursrecht op',
      abuse: 'Ze is aanstootgevend of spam',
      broken: 'Ze speelt niet goed',
    },
    chooseReason: 'Kies een reden.',
    reply: 'Hoe kan de eigenaar je antwoorden?',
    replyNeeded: 'Geef aan hoe de eigenaar je kan antwoorden.',
    note: 'Nog iets (optioneel)',
    send: 'Melding versturen',
    sentHeading: 'Melding verstuurd',
    sentLine: 'De eigenaar leest elke melding en haalt een partituur weg die hier niet hoort.',
    backToScore: 'Terug naar de partituur',
    failed: 'De melding kon niet worden verstuurd.',
    askRemoval: 'Verwijdering vragen op GitHub',
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
