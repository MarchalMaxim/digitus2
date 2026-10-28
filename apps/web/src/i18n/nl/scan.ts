import { formatList, plural } from '../format.js';
import type { Messages } from '../messages.js';

export const scan: Messages['scan'] = {
  camera: {
    title: 'Fotografeer je partituur',
    starting: 'Camera starten…',
    intro:
      'Tik één keer en beweeg de telefoon dan langzaam over de pagina. De vijf foto’s worden één scherpe pagina.',
    step: (n: number, total: number) => `Foto ${n} van ${total}`,
    aim: 'Zorg dat de hele pagina in beeld is en tik dan op de knop.',
    dark: 'Te donker. Zet de zaklamp aan.',
    darkNoLight: 'Te donker. Ga naar een plek met meer licht.',
    blurry: 'Onscherp. Houd de telefoon stil.',
    retryBlurry: 'Onscherp. Houd de telefoon stil en tik opnieuw.',
    retryCapture: 'De foto is niet gelukt. Tik opnieuw.',
    sweep: (left: number) =>
      plural('nl', left, {
        one: 'Ga naar een nieuwe plek en hou even stil. Nog 1.',
        other: 'Ga naar een nieuwe plek en hou even stil. Nog #.',
      }),
    taken: (n: number, total: number) => `Foto ${n} van ${total} genomen.`,
    auto: 'Hou af en toe even stil: elke pauze op een nieuwe plek neemt een foto.',
    hold: 'Stilhouden…',
    lost: 'Richt de camera weer op de pagina.',
    turned: 'De telefoon is gedraaid. Begin deze pagina opnieuw.',
    moving: 'Langzamer. Het beeld is onscherp.',
    skip: 'De rest overslaan',
    startOver: 'Opnieuw beginnen',
    processing: 'Je foto’s samenvoegen…',
    review: 'Controleer je pagina',
    blurryResult:
      'Deze pagina is misschien onscherp. Maak hem opnieuw als de noten moeilijk te lezen zijn.',
    corners: 'Pas de paginahoeken aan',
    adjust: 'Hoeken aanpassen',
    useCorners: 'Deze hoeken gebruiken',
    invalidCorners: 'Plaats de vier hoeken in volgorde rondom de pagina.',
    cornerLabel: (n: number) =>
      ['Linkerbovenhoek', 'Rechterbovenhoek', 'Rechteronderhoek', 'Linkeronderhoek'][n - 1] ??
      'Paginahoek',
    retake: 'Opnieuw maken',
    keep: 'Pagina bewaren',
    nextPage: 'Nog een pagina fotograferen',
    finish: (n: number) =>
      plural('nl', n, { one: '# pagina gebruiken', other: '# pagina’s gebruiken' }),
    cancel: 'Annuleren',
    restart: 'Opnieuw beginnen',
    capture: 'Foto maken',
    light: 'Zaklamp',
    fallback: 'Apparaatcamera gebruiken',
    denied:
      'Cameratoegang is geblokkeerd. Sta toegang toe in je browserinstellingen of gebruik de camera van je apparaat.',
    insecure:
      'Open deze pagina via een beveiligde verbinding of gebruik de camera van je apparaat.',
    unavailable:
      'De camera kon niet starten. Sluit andere camera-apps en probeer opnieuw of gebruik de camera van je apparaat.',
    interrupted: 'De camera is gestopt. Begin opnieuw of gebruik de camera van je apparaat.',
    processingFailed:
      'Deze pagina kon niet worden voorbereid. Maak de foto opnieuw of gebruik de camera van je apparaat.',
    tooMany: 'Je kunt maximaal 20 pagina’s gebruiken. Ga verder met deze pagina’s.',
    cornerHint:
      'Sleep elke hoek naar de rand van het papier. Gebruik de pijltjestoetsen voor kleine aanpassingen.',
    pageCount: (n: number) =>
      plural('nl', n, { one: '# pagina bewaard', other: '# pagina’s bewaard' }),
    ready: 'Klaar voor de volgende pagina',
    close: 'Camera sluiten',
  },
  view: {
    back: 'Terug naar de bibliotheek',
    experimental: 'Experimenteel scannen',
    titleStart: 'Van papier naar piano',
    titleReview: 'Controleer de herkenning',
    pageImages: (n: number) =>
      plural('nl', n, { one: '# pagina-afbeelding', other: '# pagina-afbeeldingen' }),
    advice:
      'Originele pdf’s en vlakke scans in hoge resolutie werken het best. Het resultaat opent naast het origineel, zodat je het kunt controleren.',
    where:
      'De herkenning draait op de scanner van het project, in Google Cloud (Nederland). Je pagina wordt daarheen gestuurd, herkend en daarna verwijderd.',
    cancelScan: 'Scan annuleren',
    cancelling: 'Annuleren…',
    retryFailed: 'Mislukte pagina’s opnieuw proberen',
    scanScore: 'Deze partituur scannen',
    scanning: 'Bezig met herkennen…',
    scanningPage: (page: number, total: number) =>
      `Pagina ${page} van ${total} · Bezig met herkennen…`,
    waiting: 'Er wordt een andere partituur gescand. De jouwe begint zodra die klaar is.',
    progress: 'Voortgang van de herkenning',
    secondsLeft: (seconds: number) => `Ongeveer ${seconds} seconden`,
    overdue: 'Dit duurt langer dan gewoonlijk.',
    textModelMissing:
      'Herkenning van Engelse tekst is niet ingesteld. Muzikale tekst kan ontbreken.',
    help: 'Zo werkt scannen',
    original: 'Origineel',
    openPdf: 'Originele PDF openen',
    openImage: 'Originele afbeelding openen',
    preparingPdf: 'Originele PDF voorbereiden…',
    originalAlt: 'Originele gedrukte partituur',
  },
  review: {
    recognized: 'Herkende notatie',
    sheetLabel: 'ruwe scanherkenning',
    pageShown: (page: number, joined: boolean) =>
      joined
        ? `Herkenning van pagina ${page}. Kies haar opnieuw voor de hele partituur.`
        : `Herkenning van pagina ${page}`,
    allPages: 'Alle pagina’s in leesvolgorde. Kies een pagina om alleen haar herkenning te zien.',
    preparing: 'Herkende notatie voorbereiden…',
    problem: (error: string) =>
      `${error} Corrigeer de noten hier, download het ruwe bestand voor een notatieprogramma of probeer een andere afbeelding.`,
    problemInCombined: (error: string) =>
      `${error} Corrigeer de noten in de gecombineerde partituur, download het ruwe bestand voor een notatieprogramma of probeer een andere afbeelding.`,
    problemReadOnly: (error: string) =>
      `${error} Download het ruwe bestand voor een notatieprogramma of probeer een andere afbeelding.`,
    detailsSummary: 'Details van de herkenning',
    /** The disclosure holding the MusicXML downloads. */
    filesSummary: 'Bestanden voor een notatieprogramma',
    /** Under Recognition details: the importer's or renderer's own message. */
    technical: (reason: string) => `Technische reden: ${reason}`,
    retained:
      'Bewaarde originelen en herkenningen vind je in Mijn partituren. Bewaar zelf ook je originele bestanden; de opslag van je browser kan worden gewist. Bij het afspelen kan een standaardtempo van de app gelden.',
    beamGrouping: 'De balkgroepering is afgeleid en kan afwijken van het origineel.',
    graphicSpanWarning:
      'Legatobogen en andere notatiebogen blijven binnen elke gescande pagina. Vergelijk de voortzettingen aan de paginarand; ontbrekende eindpunten zijn niet hersteld.',
    /** The scanner found a piano page read as one staff: shown under Recognition details; the verdict line says it above the comparison. */
    grandStaffWarning:
      'De notenbalken zijn niet tot een pianosysteem gekoppeld, dus beide handen worden als één gelezen. De vingerzetting zou de handen verkeerd hebben: probeer een vlakkere, gelijkmatig belichte foto of de originele pdf.',
    /** The join paired a treble part and a bass part into a piano part: under Recognition details. */
    pairedStavesNote:
      'De app heeft de notenbalk met de g-sleutel en die met de f-sleutel tot een pianosysteem gekoppeld.',
    /** The scanner read only part of a line of music: shown under Recognition details; the verdict line says it above the comparison. */
    partlyReadWarning:
      'Een regel muziek is maar gedeeltelijk gelezen, dus er kunnen maten ontbreken of bijgekomen zijn. Vergelijk het resultaat met het origineel voordat je gaat oefenen.',
    unknownWarning:
      'De herkenner meldde een onbekende waarschuwing. Controleer het origineel goed.',
    tiesFromSlurs: (n: number) =>
      plural('nl', n, {
        one: '# legatoboog tussen een noot en de herhaling ervan is als overbinding gelezen.',
        other:
          '# legatobogen tussen een noot en de herhaling ervan zijn als overbindingen gelezen.',
      }),
    emptyBarsJoined: (n: number) =>
      plural('nl', n, {
        one: '# lege maat is samengevoegd met de maat ernaast.',
        other: '# lege maten zijn samengevoegd met de maat ernaast.',
      }),
    staffRegionsOmitted: (n: number) =>
      plural('nl', n, {
        one: '# kleine extra notenbalk is buiten de herkenning gelaten.',
        other: '# kleine extra notenbalken zijn buiten de herkenning gelaten.',
      }),
    downloadPagesSummary: 'Bestanden per pagina downloaden',
    downloadPage: (page: number) => `MusicXML van pagina ${page} downloaden`,
    downloadCombined: 'Gecombineerde MusicXML downloaden',
    downloadRaw: 'Ruwe MusicXML downloaden',
    downloadAll: 'Alles downloaden',
    useForFingerings: 'Gebruiken voor vingerzettingen',
    scanAgain: 'Opnieuw scannen',
  },
  verdict: {
    facts: (parts: string[]) => parts.join(' · '),
    pages: (n: number) => plural('nl', n, { one: '# pagina', other: '# pagina’s' }),
    bars: (n: number) => plural('nl', n, { one: '# maat', other: '# maten' }),
    bothHands: 'beide handen',
    oneStaff: 'één notenbalk',
    notJoined: (page: number | undefined, reason: string | undefined) =>
      page === undefined
        ? 'De pagina’s zijn niet tot één partituur samengevoegd: elke pagina staat apart en is te downloaden onder Bestanden. Vervang de pagina die afwijkt en scan opnieuw.'
        : `Pagina ${page} kon niet met de andere pagina’s worden samengevoegd${reason ? `: ${reason}` : ''}. Fotografeer haar opnieuw, plat en met de hele pagina in beeld.`,
    readAsOneStaff: (pages: number[]) =>
      pages.length === 0
        ? 'Een pagina is als één notenbalk gelezen: de handen lopen door elkaar. Vervang die foto en scan opnieuw.'
        : pages.length === 1
          ? `Pagina ${pages[0]} is als één notenbalk gelezen: de handen lopen door elkaar. Vervang die foto en scan opnieuw.`
          : `Pagina’s ${formatList('nl', pages.map(String))} zijn als één notenbalk gelezen: de handen lopen door elkaar. Vervang die foto’s en scan opnieuw.`,
    readInPart: (pages: number[]) =>
      pages.length === 0
        ? 'Een deel van een regel is niet gelezen, dus er ontbreken maten of er zijn er te veel. Vervang die foto en scan opnieuw.'
        : pages.length === 1
          ? `Een deel van een regel op pagina ${pages[0]} is niet gelezen, dus er ontbreken maten of er zijn er te veel. Vervang die foto en scan opnieuw.`
          : `Een deel van een regel op pagina’s ${formatList('nl', pages.map(String))} is niet gelezen, dus er ontbreken maten of er zijn er te veel. Vervang die foto’s en scan opnieuw.`,
    readUnclearly: (pages: number[], of: number) =>
      of === 1
        ? 'De pagina kon niet duidelijk worden gelezen. Fotografeer haar opnieuw: plat, gelijkmatig belicht, de hele pagina in beeld.'
        : pages.length === 1
          ? `Pagina ${pages[0]} kon niet duidelijk worden gelezen. Fotografeer haar opnieuw: plat, gelijkmatig belicht, de hele pagina in beeld.`
          : `Pagina’s ${formatList('nl', pages.map(String))} konden niet duidelijk worden gelezen. Fotografeer ze opnieuw: plat, gelijkmatig belicht, elke pagina helemaal in beeld.`,
  },
  edit: {
    hint: 'Selecteer een noot om die te corrigeren.',
    keys: 'Enter kiest de eerste noot. Links en Rechts kiezen de vorige of volgende noot, Omhoog en Omlaag veranderen de toonhoogte (met Shift een octaaf), Escape sluit de editor.',
    pitch: (step: string, alter: number, octave: number) =>
      `${step}${alter > 0 ? '♯︎'.repeat(alter) : '♭︎'.repeat(-alter)}${octave}`,
    bar: (bar: string) => `Maat ${bar}`,
    photoAt: (bar: string) => `${bar} op de foto`,
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
    suggestedLabel: 'Ook gelezen als',
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
    /** A rest the recognition put where the page has a note. */
    makeNote: 'Maak er een noot van',
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
    /** Read out after Undo; `what` is the correction taken back, or empty. */
    undone: (what: string) => (what ? `Ongedaan gemaakt: ${what}.` : 'Ongedaan gemaakt.'),
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
      meter: (bar: string, from: string | undefined, to: string) =>
        `Vanaf maat ${bar}: maatsoort ${from ? `${from} → ` : ''}${to}`,
      barline: (bar: string) => `Maat ${bar}: herhalingstekens verwijderd`,
    },
    setMeter: (meter: string, bar: string) => `Gebruik ${meter} vanaf maat ${bar}`,
    removeMark: (mark: 'ending' | 'repeat') =>
      mark === 'ending' ? 'Volta verwijderen' : 'Herhalingsteken verwijderen',
    stale: (kept: number) =>
      `Sommige opgeslagen correcties passen niet meer bij deze herkenning. De eerste ${kept} blijven behouden.`,
    problemsSummary: (n: number) =>
      plural('nl', n, { one: '# plek om te controleren', other: '# plekken om te controleren' }),
    problems: {
      tieGap: (where: string, pitch: string, gap: string) =>
        `${where}: de overgebonden ${pitch} eindigt ${gap} voordat de volgende ${pitch} begint. Controleer de duren.`,
      tieEarly: (where: string, pitch: string, gap: string) =>
        `${where}: de overgebonden ${pitch} loopt ${gap} door in de volgende ${pitch}. Controleer de duren.`,
      tieUnmatched: (where: string, pitch: string) =>
        `${where}: een overbinding op ${pitch} heeft geen bijpassende noot.`,
      barTiming: (timing: string) => `De handen lopen niet gelijk. ${timing}`,
      barLong: (timing: string) => `De maat is langer dan de maatsoort. ${timing}`,
      endingWithoutRepeat: (where: string) =>
        `${where}: hier is een volta gelezen, maar de partituur heeft geen herhalingsteken.`,
      repeatWithoutEnd: (where: string) =>
        `${where}: hier begint een herhaling, maar geen herhalingsteken sluit haar af.`,
    },
    gap: (beats: number) => plural('nl', beats, { one: '# tel', other: '# tellen' }),
    downloadCorrected: 'Gecorrigeerde MusicXML downloaden',
    correctedSheetLabel: 'de gecorrigeerde herkenning',
    refused: {
      missing: 'Deze noot staat niet meer in de partituur.',
      rest: 'Een rust heeft geen toonhoogte om te veranderen.',
      range: 'Die toonhoogte ligt buiten het bereik van de piano.',
      grace: 'Een voorslag duurt geen tijd, dus de duur kan hier niet veranderen.',
      tuplet:
        'De duur van een noot in een triool of een andere antimetrische groep kan hier niet veranderen. Gebruik een notatieprogramma.',
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
      meter: 'Die maatsoort kan hier niet geschreven worden.',
      noBar: 'Deze maat staat niet meer in de partituur.',
      sameMeter: (meter: string) => `De maat staat al in ${meter}.`,
      noMark: 'Deze maat heeft geen herhalingsteken.',
    },
  },
  phone: {
    takePhoto: 'Fotografeer een gedrukte partituur',
    takeAnother: 'Nog een pagina fotograferen',
  },
  errors: {
    notCombinedSaved:
      'De pagina’s zijn herkend, maar de notatie kon niet worden samengevoegd. De bestanden per pagina staan hieronder.',
    somePagesFailed:
      'Sommige pagina’s moeten opnieuw worden gescand. Herkende pagina’s blijven bewaard.',
    recognitionFailed: 'Herkenning mislukt.',
    notationNotShown:
      'De notatie kon niet worden getoond. De technische reden staat bij de herkenningsdetails.',
    noNotes: 'Er zijn geen speelbare noten herkend.',
    notUsable:
      'Deze herkenning kan nog niet voor vingerzettingen worden gebruikt: sommige noten passen niet bij elkaar.',
    offline: 'Kon de scanner niet bereiken. Controleer je verbinding en probeer het opnieuw.',
    cancelFailed:
      'Kon het annuleren niet bevestigen. De scanner stopt binnen drie minuten vanzelf.',
    timedOut: 'De herkenning duurde te lang. Probeer een kleinere, duidelijkere pagina.',
    notRecognized:
      'De scanner kon op deze pagina geen volledige partituur herkennen. Probeer de originele PDF of een vlakkere afbeelding met hogere resolutie.',
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
    arrangeTouch:
      'Zet de pagina’s in leesvolgorde: kies een pagina en verplaats die met de pijlen.',
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
    retake: (page: number) => `Pagina ${page} vervangen door een nieuwe foto`,
    retakeTouch: (page: number) => `Pagina ${page} opnieuw fotograferen`,
    /** A one-page scan: the page is "it". */
    retakeOnly: 'Vervangen door een nieuwe foto',
    retakeOnlyTouch: 'Opnieuw fotograferen',
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
    busy: 'De scanner is bezig met een andere partituur. Probeer het over een minuut opnieuw.',
    limited: 'Je hebt het afgelopen uur veel gescand. Probeer het later opnieuw.',
    serviceStatus: (status: number) =>
      `De scanner kon niet antwoorden (fout ${status}). Probeer het later opnieuw.`,
    noAnswer: 'De scanner kon niet antwoorden. Probeer het later opnieuw.',
    noResult: 'De scanner gaf geen partituur terug.',
    invalidJob: 'Ongeldige scantaak.',
  },
  join: {
    refused: (page: number | undefined, reason: string) =>
      page === undefined
        ? `Deze pagina’s kunnen niet worden samengevoegd: ${reason}.`
        : `Pagina ${page} kan niet met de andere pagina’s worden samengevoegd: ${reason}.`,
    reasons: {
      noPages: 'er is geen pagina herkend',
      entities: 'haar bestand gebruikt XML-entiteiten',
      notPartwise: 'haar bestand is geen partwise MusicXML',
      transposition: 'ze bevat een transpositie of bijzondere notenbalk- of maatkenmerken',
      partLayout: 'haar partijlijst is onvolledig',
      partOrder: 'haar partijen staan niet in de volgorde van de partijlijst',
      measureCounts: (counts: number[]) =>
        `ze is gelezen als ${plural('nl', counts.length, { one: '# partij', other: '# partijen' })} met ${formatList('nl', counts.map(String))} maten`,
      startingSetup:
        'ze heeft aan het begin geen expliciete divisions, toonsoort, maatsoort en sleutels',
      staffLayout: 'haar beginindeling van de notenbalken is onvolledig',
      staffChange: 'de indeling van haar notenbalken verandert binnen de pagina',
      instrumentUndeclared: 'ze verwijst naar een instrument zonder declaratie',
      partCounts: (found: number, first: number) =>
        `ze is gelezen als ${plural('nl', found, { one: '# partij', other: '# partijen' })}, terwijl pagina 1 er ${first} heeft`,
      layoutsDiffer: 'haar partijen of notenbalken verschillen van die van pagina 1',
      instrumentsDiffer: 'haar instrumenten verschillen van die van pagina 1',
      duplicateIds: 'ze heeft dubbele XML-id’s',
      unresolvedId: 'ze verwijst naar een XML-id die niet bestaat',
      spanNumber: 'ze heeft een ongeldig nummer voor een notatieboog',
      spanOverflow: 'ze heeft meer dan 16 nummers nodig voor één soort notatieboog',
    },
  },
};
