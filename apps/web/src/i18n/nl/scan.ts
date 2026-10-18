import { plural } from '../format.js';
import type { Messages } from '../messages.js';

export const scan: Messages['scan'] = {
  view: {
    back: 'Terug naar de bibliotheek',
    experimental: 'Experimenteel scannen',
    titleStart: 'Van papier naar piano',
    titleReview: 'Controleer de herkenning',
    pageImages: (n: number) =>
      plural('nl', n, { one: '# pagina-afbeelding', other: '# pagina-afbeeldingen' }),
    advice:
      'Originele PDF’s en vlakke scans met hoge resolutie werken het best. Foto’s van boeken zijn experimenteel en kunnen mislukken, ook bij goed licht. Het resultaat opent naast het origineel, zodat je het kunt controleren.',
    workerNeeded:
      'Voor deze experimentele optie heb je de pc-worker op deze computer nodig. De localhost van een telefoon kan je pc niet bereiken.',
    connect: 'Verbinden met deze pc',
    connecting: 'Verbinden…',
    cancelScan: 'Scan annuleren',
    cancelling: 'Annuleren…',
    retryFailed: 'Mislukte pagina’s opnieuw proberen',
    scanScore: 'Deze partituur scannen',
    scanning:
      'Bezig met herkennen op deze pc… Meestal een paar seconden; langere pagina’s kunnen enkele minuten duren.',
    scanningPage: (page: number, total: number) =>
      `Pagina ${page} van ${total} · Bezig met herkennen op deze pc… Meestal een paar seconden; langere pagina’s kunnen enkele minuten duren.`,
    connected: 'Pc verbonden.',
    textModelMissing:
      'Herkenning van Engelse tekst is niet ingesteld. Muzikale tekst kan ontbreken. Zie de installatie hieronder.',
    original: 'Origineel',
    openPdf: 'Originele PDF openen',
    openImage: 'Originele afbeelding openen',
    preparingPdf: 'Originele PDF voorbereiden…',
    originalAlt: 'Originele gedrukte partituur',
  },
  setup: {
    summary: 'De pc-worker installeren',
    install:
      'Open op de pc waarop je deze browser gebruikt de projectmap van digitus2. Installeer de herkenners voor foto’s en PDF’s één keer en start de worker wanneer je hem nodig hebt.',
    keepOpen:
      'Laat die terminal open. Sta de lokale verbinding van de browser toe nadat je op Verbinden met deze pc hebt gedrukt. Sluit de worker om het verwerken te stoppen.',
    help: 'Installatie en probleemoplossing',
  },
  review: {
    caveat:
      'De herkenning kan fouten bevatten in noten, ritmes, bogen of handen. Tekst en tempo kunnen onvolledig zijn. Er zijn nog geen vingerzettingen toegevoegd.',
    recognized: 'Herkende notatie',
    sheetLabel: 'ruwe scanherkenning',
    viewLabel: 'Weergave van de herkenning',
    pageRecognition: 'Herkenning per pagina',
    combinedScore: 'Gecombineerde partituur',
    pageShown: (page: number) => `Herkenning van pagina ${page}`,
    allPages: 'Alle pagina’s in leesvolgorde',
    preparing: 'Herkende notatie voorbereiden…',
    problem: (error: string) =>
      `${error} Corrigeer de noten hier, download het ruwe bestand voor een notatieprogramma of probeer een andere afbeelding.`,
    detailsSummary: 'Details van de herkenning',
    /** Under Recognition details: the importer's or renderer's own message. */
    technical: (reason: string) => `Technische reden: ${reason}`,
    retained:
      'Bewaarde originelen en herkenningen vind je in Mijn partituren. Bewaar zelf ook je originele bestanden; de opslag van je browser kan worden gewist. De herkenning is niet gegarandeerd juist; bij het afspelen kan een standaardtempo van de app gelden.',
    beamGrouping: 'De balkgroepering is afgeleid en kan afwijken van het origineel.',
    graphicSpanWarning:
      'Legatobogen en andere notatiebogen blijven binnen elke gescande pagina. Vergelijk de voortzettingen aan de paginarand; ontbrekende eindpunten zijn niet hersteld.',
    unknownWarning:
      'De herkenner meldde een onbekende waarschuwing. Controleer het origineel goed.',
    downloadPagesSummary: 'Bestanden per pagina downloaden',
    downloadPage: (page: number) => `MusicXML van pagina ${page} downloaden`,
    downloadCombined: 'Gecombineerde MusicXML downloaden',
    downloadRaw: 'Ruwe MusicXML downloaden',
    useForFingerings: 'Gebruiken voor vingerzettingen',
    scanAgain: 'Opnieuw scannen',
  },
  edit: {
    hint: 'Selecteer een noot om die te corrigeren.',
    keys: 'Links en Rechts kiezen de vorige of volgende noot, Omhoog en Omlaag veranderen de toonhoogte, Escape sluit de editor.',
    pitch: (step: string, alter: number, octave: number) =>
      `${step}${alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter)}${octave}`,
    bar: (bar: string) => `Maat ${bar}`,
    rightHand: 'rechterhand',
    leftHand: 'linkerhand',
    staff: (staff: number) => `notenbalk ${staff}`,
    lengths: {
      whole: 'hele',
      half: 'halve',
      quarter: 'kwart',
      eighth: 'achtste',
      '16th': 'zestiende',
      '32nd': 'tweeëndertigste',
    } as Record<string, string>,
    noteLength: (length: string, dotted: boolean) =>
      `${dotted ? 'gepunteerde ' : ''}${length} noot`,
    restLength: (length: string, dotted: boolean) =>
      `${dotted ? 'gepunteerde ' : ''}${length} rust`,
    tied: 'overgebonden',
    describe: (parts: string[]) => parts.join(' · '),
    panelLabel: 'De gekozen noot corrigeren',
    pitchLabel: 'Toonhoogte',
    lower: 'Lager',
    lowerLabel: 'Eén stap lager',
    higher: 'Hoger',
    higherLabel: 'Eén stap hoger',
    flat: 'Mol',
    natural: 'Herstellingsteken',
    sharp: 'Kruis',
    lengthLabel: 'Duur',
    lengthButtons: {
      whole: 'Hele',
      half: 'Halve',
      quarter: 'Kwart',
      eighth: 'Achtste',
      '16th': '16e',
      '32nd': '32e',
    } as Record<string, string>,
    dotted: 'Gepunteerd',
    tieNext: 'Overgebonden naar volgende',
    tiePrevious: 'Overgebonden van vorige',
    toLeftHand: 'Naar de linkerhand',
    toRightHand: 'Naar de rechterhand',
    remove: 'Noot verwijderen',
    previous: 'Vorige noot',
    next: 'Volgende noot',
    done: 'Klaar',
    handBeats: (hand: string, beats: number) =>
      `${hand} ${plural('nl', beats, { one: '# tel', other: '# tellen' })}`,
    timing: (bar: string, hands: string[], meter?: string) =>
      `${bar}: ${hands.join(', ')}${meter ? `, in ${meter}` : ''}.`,
    corrections: (n: number) => plural('nl', n, { one: '# correctie', other: '# correcties' }),
    undo: 'Ongedaan maken',
    reset: 'Terug naar de herkenning',
    resetDone: 'Alle correcties zijn weggehaald. Ongedaan maken zet ze terug.',
    listSummary: 'Correcties bekijken',
    changed: {
      pitch: (where: string, from: string, to: string) => `${where}: ${from} → ${to}`,
      duration: (where: string, pitch: string, from: string, to: string) =>
        `${where}: ${pitch} ${from} → ${to}`,
      tie: (where: string, pitch: string) =>
        `${where}: ${pitch} overgebonden naar de volgende ${pitch}`,
      untie: (where: string, pitch: string) => `${where}: overbinding op ${pitch} weggehaald`,
      hand: (where: string, pitch: string, hand: string) => `${where}: ${pitch} naar de ${hand}`,
      removed: (where: string, pitch: string) => `${where}: ${pitch} verwijderd`,
    },
    stale: (kept: number) =>
      `Sommige opgeslagen correcties passen niet meer bij deze herkenning. De eerste ${kept} blijven behouden.`,
    problemsSummary: (n: number) =>
      plural('nl', n, { one: '# plek om te controleren', other: '# plekken om te controleren' }),
    problems: {
      tieGap: (where: string, pitch: string, gap: string) =>
        `${where}: de overbinding op ${pitch} bereikt de volgende ${pitch} ${gap} te laat.`,
      tieEarly: (where: string, pitch: string, gap: string) =>
        `${where}: de overbinding op ${pitch} bereikt de volgende ${pitch} ${gap} te vroeg.`,
      tieUnmatched: (where: string, pitch: string) =>
        `${where}: een overbinding op ${pitch} heeft geen bijpassende noot.`,
      barTiming: (timing: string) => `De handen lopen niet gelijk. ${timing}`,
    },
    gap: (beats: number) => plural('nl', beats, { one: '# tel', other: '# tellen' }),
    downloadCorrected: 'Gecorrigeerde MusicXML downloaden',
    correctedSheetLabel: 'de gecorrigeerde herkenning',
    refused: {
      missing: 'Deze noot staat niet meer in de partituur.',
      rest: 'Een rust heeft geen toonhoogte om te veranderen.',
      range: 'Die toonhoogte ligt buiten het bereik van de piano.',
      grace: 'Een voorslag duurt geen tijd, dus de duur kan hier niet veranderen.',
      unwritable: 'Deze duur kan in deze partituur niet geschreven worden.',
      otherHand:
        'Deze wijziging zou noten in de andere hand of stem verplaatsen en is niet uitgevoerd. Controleer de maat in een notatieprogramma.',
      noTieTarget: (pitch: { step: string; alter: number; octave: number }) =>
        `Er begint geen ${scan.edit.pitch(pitch.step, pitch.alter, pitch.octave)} waar deze noot eindigt, dus overbinden kan niet. Corrigeer eerst de duren.`,
      noTieSource: (pitch: { step: string; alter: number; octave: number }) =>
        `Er eindigt geen ${scan.edit.pitch(pitch.step, pitch.alter, pitch.octave)} waar deze noot begint, dus overbinden kan niet.`,
      tieTaken: 'De volgende noot is al overgebonden vanaf een andere noot.',
      tiedRemove: 'Haal eerst de overbinding van deze noot weg.',
      chordLengths: 'De noten van het akkoord hebben verschillende duren. Verander eerst de duur.',
      oneStaff: 'Deze partituur heeft één notenbalk.',
    },
  },
  phone: {
    takePhoto: 'Foto maken',
    takeAnother: 'Nog een foto maken',
    explain:
      'De herkenning draait op een pc, en een telefoon kan die niet bereiken. Stuur deze foto’s naar de pc waarop het programma draait en open ze daar.',
    share: 'Foto’s naar je pc sturen',
    save: 'Foto’s opslaan',
    shareTitle: 'Foto’s van een partituur',
    shared: 'Foto’s doorgegeven. Open ze op je pc met ‘Open je eigen partituur’.',
    saved:
      'Foto’s opgeslagen op dit apparaat. Zet ze op je pc en open ze daar met ‘Open je eigen partituur’.',
  },
  errors: {
    notCombinedSaved:
      'De pagina’s zijn herkend, maar de notatie kon niet worden samengevoegd. De bestanden per pagina staan hieronder.',
    notCombined: (reason: string) =>
      `De pagina’s zijn herkend, maar de notatie kon niet worden samengevoegd. ${reason}`,
    somePagesFailed:
      'Sommige pagina’s moeten opnieuw worden gescand. Herkende pagina’s blijven bewaard.',
    recognitionFailed: 'Herkenning mislukt.',
    notationNotShown: 'De notatie kon niet worden getoond. De technische reden staat bij de herkenningsdetails.',
    noNotes: 'Er zijn geen speelbare noten herkend.',
    notUsable: 'Deze herkenning kan nog niet voor vingerzettingen worden gebruikt: sommige noten passen niet bij elkaar.',
    connectFailed:
      'Kon geen verbinding maken met deze pc. Start de worker en sta de lokale verbinding van deze site toe als je browser erom vraagt. Heb je die geweigerd? Wijzig dan de toestemming voor het lokale netwerk van deze site en probeer het opnieuw.',
    cancelFailed:
      'Kon het annuleren niet bevestigen. Sluit de terminal van de worker om het verwerken te stoppen.',
    timedOut: 'De herkenning duurde te lang. Probeer een kleinere, duidelijkere pagina.',
    notRecognized:
      'De pc kon op deze pagina geen volledige partituur herkennen. Probeer de originele PDF of een vlakkere afbeelding met hogere resolutie.',
  },
  pager: {
    previous: 'Vorige',
    next: 'Volgende',
    previousLabel: 'Vorige originele pagina',
    nextLabel: 'Volgende originele pagina',
    pageOf: (page: number, total: number) => `Pagina ${page} van ${total}`,
    navLabel: 'Navigatie door de originele pagina’s',
  },
  preview: {
    unavailable: (reason: string) => `Voorbeeld niet beschikbaar: ${reason}`,
    openToCompare: 'Open de originele PDF hierboven om alle pagina’s te vergelijken.',
    canvasMissing: 'Canvas is niet beschikbaar.',
    pageLabel: (page: number) => `Originele PDF, pagina ${page}`,
  },
  pages: {
    arrange:
      'Zet de pagina’s in leesvolgorde. Sleep een miniatuur of kies een pagina om die te verplaatsen.',
    /** On a touch screen, where pages cannot be dragged. */
    arrangeTouch: 'Zet de pagina’s in leesvolgorde: kies een pagina en verplaats die met de pijlen.',
    originalCount: (n: number) =>
      plural('nl', n, {
        one: '# originele pagina, in leesvolgorde.',
        other: '# originele pagina’s, in leesvolgorde.',
      }),
    listLabel: 'Pagina’s van de partituur',
    select: (page: number, name: string) => `Pagina ${page} kiezen: ${name}`,
    needsRetry: 'Opnieuw proberen',
    recognized: 'Herkend',
    ready: 'Klaar om te scannen',
    rotate: '90° rechtsom draaien',
    cancelRotation: 'Draaien annuleren',
    rotating: 'Afbeelding draaien…',
    moveEarlier: 'Eerder zetten',
    moveEarlierLabel: (page: number) => `Pagina ${page} eerder zetten`,
    moveLater: 'Later zetten',
    moveLaterLabel: (page: number) => `Pagina ${page} later zetten`,
    remove: 'Pagina verwijderen',
    removeLabel: (page: number) => `Pagina ${page} verwijderen`,
    addImages: 'Pagina-afbeeldingen toevoegen',
    finishFirst: 'Rond deze scan af voordat je meer pagina’s toevoegt.',
    pageError: (page: number, error: string) => `Pagina ${page}: ${error}`,
    altPage: (page: number) => `Originele gedrukte partituur, pagina ${page}`,
    alt: 'Originele gedrukte partituur',
    rotated: (degrees: number) =>
      `${degrees}° rechtsom gedraaid voor het scannen. Het originele bestand blijft bewaard.`,
  },
  files: {
    pageLimit: 'Kies maximaal 20 pagina-afbeeldingen tegelijk.',
    imagesOrOneFile: 'Kies pagina-afbeeldingen samen, of open één PDF-, MusicXML- of MIDI-bestand.',
    fileTypes: 'Kies een PNG-, JPEG- of PDF-bestand tot 10 MB.',
    contentMismatch:
      'De inhoud van het bestand komt niet overeen met de extensie (PNG, JPEG of PDF).',
  },
  rotation: {
    unreadable: 'Deze afbeelding kon niet worden gedraaid. Probeer een andere PNG of JPEG.',
    tooLargeChoose:
      'Deze afbeelding is te groot om hier te draaien (maximaal 16 megapixel). Kies een kleinere afbeelding. Je huidige afbeelding blijft ongewijzigd.',
    tooLarge:
      'Deze afbeelding is te groot om hier te draaien (maximaal 16 megapixel). Je huidige afbeelding blijft ongewijzigd.',
    originalTooBig: 'Kies een afbeelding tot 10 MB om te draaien.',
    browserCannot:
      'Deze browser kon de afbeelding niet draaien. Je huidige afbeelding blijft ongewijzigd.',
    failed: 'Deze afbeelding kon niet worden gedraaid. Je huidige afbeelding blijft ongewijzigd.',
    resultTooBig:
      'De gedraaide afbeelding is groter dan 10 MB. Kies een kleinere afbeelding. Je huidige afbeelding blijft ongewijzigd.',
  },
  client: {
    busy: 'De pc is al aan het scannen. Probeer het zo meteen opnieuw.',
    workerStatus: (status: number) => `De pc-worker gaf status ${status}.`,
    invalidJob: 'Ongeldige scantaak.',
    updateWorker: 'Werk de pc-worker bij om door te gaan.',
    noJob: 'De worker gaf geen scantaak terug.',
  },
  join: {
    refused: (reason: string) =>
      `Deze pagina’s kunnen niet veilig worden samengevoegd: ${reason}. Download elke pagina om die in een notatie-editor te corrigeren.`,
    reasons: {
      noPages: 'geen herkende pagina’s',
      entities: 'XML-entiteiten worden niet ondersteund',
      notPartwise: 'partwise MusicXML verwacht',
      repeats: 'herhalingen of sprongen moeten handmatig worden nagekeken',
      transposition:
        'transpositie of bijzondere notenbalk- of maatkenmerken moeten handmatig worden nagekeken',
      partLayout: 'onvolledige indeling van de partijen',
      partOrder: 'de volgorde van de partijen wijkt af van de partijlijst',
      measureCounts: 'partijen hebben een ongelijk aantal maten',
      startingSetup: (page: number) =>
        `pagina ${page} heeft een expliciete begin-indeling (divisions), toonsoort, maatsoort en sleutels nodig`,
      staffLayout: 'onvolledige beginindeling van de notenbalken',
      staffChange: 'de indeling van de notenbalken verandert binnen een pagina',
      instrumentUndeclared: 'verwijzing naar een instrument zonder declaratie',
      partCounts: 'het aantal partijen verschilt',
      layoutsDiffer: 'de indeling van partijen of notenbalken verschilt',
      instrumentsDiffer: 'de indeling van instrumenten verschilt',
      duplicateIds: 'dubbele XML-id’s binnen één pagina',
      unresolvedId: 'verwijzing naar een XML-id die niet bestaat',
      spanNumber: 'ongeldig nummer van een notatieboog',
      spanOverflow: 'meer dan 16 paginaspecifieke nummers voor één soort notatieboog',
    },
  },
};
