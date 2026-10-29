import { formatList, plural } from '../format.js';
import type { Messages } from '../messages.js';

export const scan: Messages['scan'] = {
  camera: {
    title: 'Fotografía tu partitura',
    starting: 'Iniciando la cámara…',
    intro:
      'Toca una vez y luego pasa el teléfono despacio sobre la página. Las cinco fotos forman una sola página nítida.',
    step: (n: number, total: number) => `Foto ${n} de ${total}`,
    aim: 'Encuadra toda la página y luego toca el botón.',
    dark: 'Demasiado oscuro. Enciende la linterna.',
    darkNoLight: 'Demasiado oscuro. Busca un sitio con más luz.',
    blurry: 'Se ve borroso. Mantén el teléfono quieto.',
    retryBlurry: 'Borrosa. No muevas el teléfono y toca otra vez.',
    retryCapture: 'La foto no se ha hecho. Toca otra vez.',
    sweep: (left: number) =>
      plural('es', left, {
        one: 'Ve a un sitio nuevo y detente. Falta 1.',
        other: 'Ve a un sitio nuevo y detente. Faltan #.',
      }),
    taken: (n: number, total: number) => `Foto ${n} de ${total} tomada.`,
    auto: 'Detente de vez en cuando: cada pausa en un sitio nuevo toma una foto.',
    hold: 'Mantén el teléfono quieto…',
    lost: 'Vuelve a apuntar la cámara a la página.',
    turned: 'El teléfono ha girado. Empieza esta página de nuevo.',
    moving: 'Más despacio. La imagen está borrosa.',
    skip: 'Omitir el resto',
    startOver: 'Empezar de nuevo',
    processing: 'Combinando tus fotos…',
    review: 'Revisa tu página',
    blurryResult: 'Puede que esta página esté borrosa. Repítela si cuesta leer las notas.',
    corners: 'Ajusta las esquinas de la página',
    adjust: 'Ajustar esquinas',
    useCorners: 'Usar estas esquinas',
    invalidCorners: 'Coloca las cuatro esquinas en orden alrededor de la página.',
    cornerLabel: (n: number) =>
      [
        'Esquina superior izquierda',
        'Esquina superior derecha',
        'Esquina inferior derecha',
        'Esquina inferior izquierda',
      ][n - 1] ?? 'Esquina de la página',
    retake: 'Repetir foto',
    keep: 'Guardar página',
    nextPage: 'Fotografiar otra página',
    finish: (n: number) => plural('es', n, { one: 'Usar # página', other: 'Usar # páginas' }),
    cancel: 'Cancelar',
    restart: 'Empezar de nuevo',
    capture: 'Hacer foto',
    light: 'Linterna',
    fallback: 'Usar la cámara del dispositivo',
    denied:
      'El acceso a la cámara está bloqueado. Permítelo en los ajustes del navegador o usa la cámara del dispositivo.',
    insecure: 'Abre esta página con una conexión segura o usa la cámara del dispositivo.',
    unavailable:
      'La cámara no se ha podido iniciar. Cierra otras aplicaciones de cámara e inténtalo de nuevo, o usa la cámara del dispositivo.',
    interrupted: 'La cámara se ha detenido. Empieza de nuevo o usa la cámara del dispositivo.',
    processingFailed:
      'No se ha podido preparar esta página. Repite la foto o usa la cámara del dispositivo.',
    tooMany: 'Puedes usar hasta 20 páginas. Continúa con estas páginas.',
    cornerHint:
      'Arrastra cada esquina hasta el borde del papel. Usa las flechas del teclado para ajustar con precisión.',
    pageCount: (n: number) =>
      plural('es', n, { one: '# página guardada', other: '# páginas guardadas' }),
    ready: 'Listo para la siguiente página',
    close: 'Cerrar cámara',
  },
  view: {
    back: 'Volver a la biblioteca',
    experimental: 'Escaneo experimental',
    titleStart: 'Del papel al piano',
    titleReview: 'Revisa el reconocimiento',
    pageImages: (n: number) =>
      plural('es', n, { one: '# imagen de página', other: '# imágenes de página' }),
    advice:
      'Los PDF originales y los escaneos planos de alta resolución funcionan mejor. El resultado se abre junto al original para revisarlo.',
    where:
      'El reconocimiento se hace en el escáner del proyecto, en Google Cloud (Países Bajos). Tu página se envía allí, se reconoce y después se borra.',
    cancelScan: 'Cancelar escaneo',
    cancelling: 'Cancelando…',
    retryFailed: 'Reintentar las páginas fallidas',
    scanScore: 'Escanear esta partitura',
    scanning: 'Reconociendo…',
    scanningPage: (page: number, total: number) => `Página ${page} de ${total} · Reconociendo…`,
    waiting: 'Se está escaneando otra partitura. La tuya empieza en cuanto termine.',
    progress: 'Progreso del reconocimiento',
    secondsLeft: (seconds: number) => `Unos ${seconds} segundos`,
    overdue: 'Está tardando más de lo habitual.',
    textModelMissing:
      'El reconocimiento de texto en inglés no está configurado. Puede faltar el texto musical.',
    help: 'Cómo funciona el escaneo',
    original: 'Original',
    openPdf: 'Abrir el PDF original',
    openImage: 'Abrir la imagen original',
    preparingPdf: 'Preparando el PDF original…',
    originalAlt: 'Partitura impresa original',
  },
  review: {
    recognized: 'Notación reconocida',
    sheetLabel: 'reconocimiento en bruto del escaneo',
    pageShown: (page: number, joined: boolean) =>
      joined
        ? `Reconocimiento de la página ${page}. Selecciónala de nuevo para ver la partitura entera.`
        : `Reconocimiento de la página ${page}`,
    allPages:
      'Todas las páginas en orden de lectura. Elige una página para ver solo su reconocimiento.',
    preparing: 'Preparando la notación reconocida…',
    problem: (error: string) =>
      `${error} Corrige las notas aquí, descarga el archivo sin procesar para un editor de partituras o prueba con otra imagen.`,
    problemInCombined: (error: string) =>
      `${error} Corrige las notas en la partitura combinada, descarga el archivo sin procesar para un editor de partituras o prueba con otra imagen.`,
    problemReadOnly: (error: string) =>
      `${error} Descarga el archivo sin procesar para un editor de partituras o prueba con otra imagen.`,
    detailsSummary: 'Detalles del reconocimiento',
    /** The disclosure holding the MusicXML downloads. */
    filesSummary: 'Archivos para un editor de partituras',
    /** Under Recognition details: the importer's or renderer's own message. */
    technical: (reason: string) => `Motivo técnico: ${reason}`,
    /** `error` says the notation could not be drawn: it is scanned again, or its files used elsewhere. */
    notDrawnProblem: (error: string): string =>
      `${error} Escanea de nuevo o descarga abajo los archivos para un editor de partituras.`,
    /** Said after Fix all (issue 233). */
    fixedAll: (n: number): string =>
      plural('es', n, {
        one: '# corrección hecha. Deshacer la quita.',
        other: '# correcciones hechas. Deshacer las quita todas.',
      }),
    /** Under Recognition details on a device that keeps its scans as validation cases (issue 233). */
    kept: 'Los escaneos de este dispositivo se guardan para mejorar el reconocimiento.',
    showBar: (bar: string) => `Mostrar el compás ${bar}`,
    retained:
      'Encuentra los originales y los reconocimientos guardados en Mis partituras. Conserva tus propios archivos originales; el almacenamiento del navegador puede borrarse. La reproducción puede usar un tempo predeterminado de la app.',
    beamGrouping: 'La agrupación de las barras se deduce y puede diferir del original.',
    graphicSpanWarning:
      'Las ligaduras y otros signos de notación se mantienen dentro de cada página escaneada. Compara las continuaciones en los bordes de página; los extremos que faltan no se han reparado.',
    /** The scanner found a piano page read as one staff: shown under Recognition details; the verdict line says it above the comparison. */
    grandStaffWarning:
      'Los pentagramas no se emparejaron en un sistema de piano, así que las dos manos se leen como una. La digitación saldría con las manos mal: prueba una foto más plana y bien iluminada o el PDF original.',
    /** The join paired a treble part and a bass part into a piano part: under Recognition details. */
    pairedStavesNote:
      'La aplicación emparejó los pentagramas de clave de sol y de fa en un sistema de piano.',
    /** The scanner read only part of a line of music: shown under Recognition details; the verdict line says it above the comparison. */
    partlyReadWarning:
      'Una línea de música se leyó solo en parte, así que pueden faltar o sobrar compases. Compara el resultado con el original antes de practicar.',
    unknownWarning: 'El reconocedor indicó una advertencia desconocida. Revisa bien el original.',
    tiesFromSlurs: (n: number) =>
      plural('es', n, {
        one: '# ligadura de expresión entre una nota y su repetición se leyó como ligadura de unión.',
        other:
          '# ligaduras de expresión entre una nota y su repetición se leyeron como ligaduras de unión.',
      }),
    emptyBarsJoined: (n: number) =>
      plural('es', n, {
        one: '# compás vacío se unió al compás contiguo.',
        other: '# compases vacíos se unieron a los compases contiguos.',
      }),
    staffRegionsOmitted: (n: number) =>
      plural('es', n, {
        one: '# pentagrama pequeño adicional se dejó fuera de la lectura.',
        other: '# pentagramas pequeños adicionales se dejaron fuera de la lectura.',
      }),
    downloadPagesSummary: 'Descargar los archivos de cada página',
    downloadPage: (page: number) => `Descargar el MusicXML de la página ${page}`,
    downloadCombined: 'Descargar el MusicXML combinado',
    downloadRaw: 'Descargar el MusicXML en bruto',
    downloadAll: 'Descargar todo',
    useForFingerings: 'Usar para las digitaciones',
    scanAgain: 'Escanear de nuevo',
  },
  verdict: {
    facts: (parts: string[]) => parts.join(' · '),
    pages: (n: number) => plural('es', n, { one: '# página', other: '# páginas' }),
    bars: (n: number) => plural('es', n, { one: '# compás', other: '# compases' }),
    bothHands: 'ambas manos',
    oneStaff: 'un solo pentagrama',
    notJoined: (page: number | undefined, reason: string | undefined) =>
      page === undefined
        ? 'Las páginas no se unieron en una sola partitura: cada una se muestra por separado y se puede descargar en Archivos. Sustituye la página que difiere y escanea de nuevo.'
        : `La página ${page} no se pudo combinar con las demás páginas${reason ? `: ${reason}` : ''}. Fotografíala de nuevo, plana y con la página entera en el encuadre.`,
    readAsOneStaff: (pages: number[]) =>
      pages.length === 0
        ? 'Una página se leyó como un solo pentagrama: las manos están mezcladas. Cambia esa foto y escanea de nuevo.'
        : pages.length === 1
          ? `La página ${pages[0]} se leyó como un solo pentagrama: las manos están mezcladas. Cambia esa foto y escanea de nuevo.`
          : `Las páginas ${formatList('es', pages.map(String))} se leyeron como un solo pentagrama: las manos están mezcladas. Cambia esas fotos y escanea de nuevo.`,
    readInPart: (pages: number[]) =>
      pages.length === 0
        ? 'Parte de una línea no se leyó, así que faltan compases o sobran. Cambia esa foto y escanea de nuevo.'
        : pages.length === 1
          ? `Parte de una línea de la página ${pages[0]} no se leyó, así que faltan compases o sobran. Cambia esa foto y escanea de nuevo.`
          : `Parte de una línea de las páginas ${formatList('es', pages.map(String))} no se leyó, así que faltan compases o sobran. Cambia esas fotos y escanea de nuevo.`,
    readUnclearly: (pages: number[], of: number) =>
      of === 1
        ? 'La página no se pudo leer con claridad. Fotografíala de nuevo: plana, con luz uniforme, la página entera en el encuadre.'
        : pages.length === 1
          ? `La página ${pages[0]} no se pudo leer con claridad. Fotografíala de nuevo: plana, con luz uniforme, la página entera en el encuadre.`
          : `Las páginas ${formatList('es', pages.map(String))} no se pudieron leer con claridad. Fotografíalas de nuevo: planas, con luz uniforme, cada página entera en el encuadre.`,
  },
  edit: {
    hint: 'Selecciona una nota para corregirla.',
    keys: 'Intro selecciona la primera nota. Izquierda y Derecha seleccionan la nota anterior o siguiente, Arriba y Abajo cambian su altura (con Mayús, una octava), Escape cierra el editor.',
    pitch: (step: string, alter: number, octave: number) =>
      `${({ C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' } as Record<string, string>)[step] ?? step}${alter > 0 ? '♯︎'.repeat(alter) : '♭︎'.repeat(-alter)}${octave}`,
    bar: (bar: string) => `Compás ${bar}`,
    photoAt: (bar: string) => `${bar} en la foto`,
    rightHand: 'mano derecha',
    leftHand: 'mano izquierda',
    staff: (staff: number) => `pentagrama ${staff}`,
    lengths: {
      whole: 'redonda',
      half: 'blanca',
      quarter: 'negra',
      eighth: 'corchea',
      '16th': 'semicorchea',
      '32nd': 'fusa',
    } as Record<string, string>,
    noteLength: (length: string, dotted: boolean) => `${length}${dotted ? ' con puntillo' : ''}`,
    restLength: (length: string, dotted: boolean) =>
      `silencio de ${length}${dotted ? ' con puntillo' : ''}`,
    tied: 'ligada',
    describe: (parts: string[]) => parts.join(' · '),
    panelLabel: 'Corregir la nota seleccionada',
    pitchLabel: 'Altura',
    suggestedLabel: 'También leída como',
    lower: 'Más grave',
    lowerLabel: 'Bajar un grado',
    higher: 'Más aguda',
    higherLabel: 'Subir un grado',
    flat: 'Bemol',
    natural: 'Becuadro',
    sharp: 'Sostenido',
    lengthLabel: 'Duración',
    lengthButtons: {
      whole: 'Redonda',
      half: 'Blanca',
      quarter: 'Negra',
      eighth: 'Corchea',
      '16th': 'Semicorchea',
      '32nd': 'Fusa',
    } as Record<string, string>,
    dotted: 'Con puntillo',
    tieNext: 'Ligada a la siguiente',
    tiePrevious: 'Ligada a la anterior',
    toLeftHand: 'Pasar a la mano izquierda',
    toRightHand: 'Pasar a la mano derecha',
    remove: 'Quitar la nota',
    /** A rest the recognition put where the page has a note. */
    makeNote: 'Convertir en nota',
    previous: 'Nota anterior',
    next: 'Nota siguiente',
    done: 'Listo',
    handBeats: (hand: string, beats: number) =>
      `${hand} ${plural('es', beats, { one: '# tiempo', other: '# tiempos' })}`,
    timing: (bar: string, hands: string[], meter?: string) =>
      `${bar}: ${hands.join(', ')}${meter ? `, en ${meter}` : ''}.`,
    corrections: (n: number) => plural('es', n, { one: '# corrección', other: '# correcciones' }),
    undo: 'Deshacer',
    reset: 'Volver al reconocimiento',
    resetDone: 'Se quitaron todas las correcciones. Deshacer las recupera.',
    /** Read out after Undo; `what` is the correction taken back, or empty. */
    undone: (what: string) => (what ? `Deshecho: ${what}.` : 'Deshecho.'),
    listSummary: 'Ver las correcciones',
    changed: {
      pitch: (where: string, from: string, to: string) => `${where}: ${from} → ${to}`,
      duration: (where: string, pitch: string, from: string, to: string) =>
        `${where}: ${pitch} ${from} → ${to}`,
      tie: (where: string, pitch: string) => `${where}: ${pitch} ligada al siguiente ${pitch}`,
      untie: (where: string, pitch: string) => `${where}: ligadura de ${pitch} quitada`,
      hand: (where: string, pitch: string, hand: string) =>
        `${where}: ${pitch} pasada a la ${hand}`,
      removed: (where: string, pitch: string) => `${where}: ${pitch} quitada`,
      meter: (bar: string, from: string | undefined, to: string) =>
        `Desde el compás ${bar}: indicación de compás ${from ? `${from} → ` : ''}${to}`,
      barline: (bar: string) => `Compás ${bar}: marcas de repetición quitadas`,
    },
    setMeter: (meter: string, bar: string) => `Usar ${meter} desde el compás ${bar}`,
    removeMark: (mark: 'ending' | 'repeat') =>
      mark === 'ending' ? 'Quitar la casilla de repetición' : 'Quitar el signo de repetición',
    lengthenTie: (pitch: string, bar: string, length: string, dotted: boolean) =>
      `Hacer del ${pitch} del compás ${bar} una ${length}${dotted ? ' con puntillo' : ''} para que la ligadura llegue`,
    removeTie: 'Quitar la ligadura',
    fixAll: (n: number) => `Corregir los ${n}`,
    stale: (kept: number) =>
      `Algunas correcciones guardadas ya no se aplican a este reconocimiento. Se conservan las primeras ${kept}.`,
    problemsSummary: (n: number) =>
      plural('es', n, { one: '# punto que revisar', other: '# puntos que revisar' }),
    problems: {
      tieGap: (where: string, pitch: string, gap: string) =>
        `${where}: el ${pitch} ligado termina ${gap} antes de que empiece el siguiente ${pitch}. Revisa las duraciones.`,
      tieEarly: (where: string, pitch: string, gap: string) =>
        `${where}: el ${pitch} ligado se mete ${gap} en el siguiente ${pitch}. Revisa las duraciones.`,
      tieUnmatched: (where: string, pitch: string, side: 'start' | 'stop') =>
        side === 'start'
          ? `${where}: una ligadura en ${pitch} no tiene nota que le corresponda.`
          : `${where}: la ligadura hacia ${pitch} no viene de ninguna nota anterior que le corresponda.`,
      tieGrace: (where: string, pitch: string) =>
        `${where}: la nota de adorno ${pitch} está ligada, pero una nota de adorno no ocupa tiempo que sostener.`,
      tieRepaired: (
        where: string,
        pitch: string,
        reason: 'gap' | 'unmatchedStart' | 'unmatchedStop' | 'grace',
      ) =>
        reason === 'gap'
          ? `${where}: la ligadura en ${pitch} no llega al siguiente ${pitch}. Se tocan como dos notas.`
          : reason === 'unmatchedStart'
            ? `${where}: la ligadura en ${pitch} no lleva a ningún ${pitch} siguiente. La nota se toca sin ligadura.`
            : reason === 'unmatchedStop'
              ? `${where}: la ligadura hacia ${pitch} no viene de ningún ${pitch} anterior. La nota se toca de nuevo.`
              : `${where}: la nota de adorno ${pitch} está ligada. Se tocan como dos notas.`,
      tieRepairedBar: (where: string) =>
        `${where}: una ligadura no encaja con sus notas. Se toca sin ligadura.`,
      barTiming: (timing: string) => `Las manos no coinciden. ${timing}`,
      barLong: (timing: string) => `El compás es más largo que su indicación de compás. ${timing}`,
      endingWithoutRepeat: (where: string) =>
        `${where}: aquí se leyó una casilla de repetición, pero la partitura no tiene signo de repetición.`,
      repeatWithoutEnd: (where: string) =>
        `${where}: aquí se abre un signo de repetición y ningún signo de repetición lo cierra.`,
    },
    gap: (beats: number) => plural('es', beats, { one: '# tiempo', other: '# tiempos' }),
    downloadCorrected: 'Descargar MusicXML corregido',
    correctedSheetLabel: 'el reconocimiento corregido',
    refused: {
      missing: 'Esta nota ya no está en la partitura.',
      rest: 'Un silencio no tiene altura que cambiar.',
      range: 'Esa altura está fuera del registro del piano.',
      grace: 'Una nota de adorno no ocupa tiempo, así que aquí no se puede cambiar su duración.',
      tuplet:
        'La duración de una nota de un tresillo u otro grupo irregular no se puede cambiar aquí. Usa un editor de partituras.',
      unwritable: 'Esta duración no se puede escribir en esta partitura.',
      otherHand:
        'Este cambio movería notas de la otra mano o voz, así que no se hizo. Revisa el compás en un editor de partituras.',
      noTieTarget: (pitch: { step: string; alter: number; octave: number }) =>
        `Ningún ${scan.edit.pitch(pitch.step, pitch.alter, pitch.octave)} empieza donde termina esta nota, así que no se puede ligar. Corrige primero las duraciones.`,
      noTieSource: (pitch: { step: string; alter: number; octave: number }) =>
        `Ningún ${scan.edit.pitch(pitch.step, pitch.alter, pitch.octave)} termina donde empieza esta nota, así que no se puede ligar.`,
      tieTaken: 'La nota siguiente ya está ligada a otra nota.',
      tiedRemove: 'Quita la ligadura de esta nota antes de quitar la nota.',
      chordLengths: 'Las notas del acorde tienen duraciones distintas. Cambia primero la duración.',
      oneStaff: 'Esta partitura tiene un solo pentagrama.',
      meter: 'Esa indicación de compás no se puede escribir aquí.',
      noBar: 'Este compás ya no está en la partitura.',
      sameMeter: (meter: string) => `El compás ya está en ${meter}.`,
      noMark: 'Este compás no tiene marca de repetición.',
    },
  },
  phone: {
    takePhoto: 'Fotografía una partitura impresa',
    takeAnother: 'Fotografiar otra página',
  },
  errors: {
    notCombinedSaved:
      'Se reconocieron las páginas, pero no se pudo combinar su notación. Los archivos de cada página están disponibles más abajo.',
    somePagesFailed:
      'Algunas páginas necesitan otro escaneo. Las páginas reconocidas se conservan.',
    recognitionFailed: 'El reconocimiento falló.',
    /** The notation could not be drawn; `page` is the page shown on its own, absent for the whole scan. */
    notDrawn: (page: number | undefined): string =>
      page === undefined
        ? 'No se pudo dibujar la notación reconocida.'
        : `Página ${page}: no se pudo dibujar la notación reconocida.`,
    /** The recognition holds no music to draw; `page` as above. */
    noMusic: (page: number | undefined): string =>
      page === undefined
        ? 'No se leyó música en este escaneo.'
        : `Página ${page}: no se leyó música.`,
    noNotes: 'No se reconoció ninguna nota que se pueda tocar.',
    notUsable:
      'Este reconocimiento todavía no se puede usar para la digitación: algunas de sus notas no encajan.',
    /** The import refused `bar`, the bar's printed number as the engine named it (issue 233). */
    notUsableAt: (bar: string): string =>
      `El compás ${bar} no se pudo leer tal como está escrito, así que este reconocimiento todavía no se puede usar para la digitación.`,
    notChecked:
      'Las notas no se pudieron comprobar para la digitación en esta pestaña. Recarga la página y abre este escaneo desde Mis partituras.',
    offline: 'No se pudo conectar con el escáner. Comprueba tu conexión e inténtalo de nuevo.',
    cancelFailed:
      'No se pudo confirmar la cancelación. El escáner se detiene solo en un máximo de tres minutos.',
    timedOut: 'El reconocimiento tardó demasiado. Prueba con una página más pequeña y más nítida.',
    notRecognized:
      'El escáner no pudo reconocer una partitura completa en esta página. Prueba con el PDF original o con una imagen más plana y de mayor resolución.',
  },
  pager: {
    previous: 'Anterior',
    next: 'Siguiente',
    previousLabel: 'Página original anterior',
    nextLabel: 'Página original siguiente',
    pageOf: (page: number, total: number) => `Página ${page} de ${total}`,
    navLabel: 'Navegación por las páginas originales',
  },
  preview: {
    unavailable: (reason: string) => `Vista previa no disponible: ${reason}`,
    openToCompare: 'Abre el PDF original de arriba para comparar todas las páginas.',
    canvasMissing: 'El lienzo no está disponible.',
    pageLabel: (page: number) => `PDF original, página ${page}`,
  },
  pages: {
    arrange:
      'Ordena las páginas en orden de lectura. Arrastra una miniatura o selecciona una página para moverla.',
    /** On a touch screen, where pages cannot be dragged. */
    arrangeTouch:
      'Ordena las páginas en orden de lectura: selecciona una página y muévela con las flechas.',
    originalCount: (n: number) =>
      plural('es', n, {
        one: '# página original, en orden de lectura.',
        other: '# páginas originales, en orden de lectura.',
      }),
    listLabel: 'Páginas de la partitura',
    select: (page: number, name: string) => `Seleccionar la página ${page}: ${name}`,
    needsRetry: 'Hay que reintentar',
    recognized: 'Reconocida',
    ready: 'Lista para escanear',
    rotate: 'Girar 90° a la derecha',
    cancelRotation: 'Cancelar el giro',
    rotating: 'Girando la imagen…',
    moveEarlier: 'Mover antes',
    moveEarlierLabel: (page: number) => `Mover la página ${page} antes`,
    moveLater: 'Mover después',
    moveLaterLabel: (page: number) => `Mover la página ${page} después`,
    remove: 'Quitar página',
    removeLabel: (page: number) => `Quitar la página ${page}`,
    addImages: 'Añadir imágenes de páginas',
    finishFirst: 'Termina este escaneo antes de añadir más páginas.',
    pageError: (page: number, error: string) => `Página ${page}: ${error}`,
    altPage: (page: number) => `Partitura impresa original, página ${page}`,
    alt: 'Partitura impresa original',
    rotated: (degrees: number) =>
      `Girada ${degrees}° a la derecha para escanear. Se conserva el archivo original.`,
    retake: (page: number) => `Sustituir la página ${page} por una foto nueva`,
    retakeTouch: (page: number) => `Fotografiar de nuevo la página ${page}`,
    /** A one-page scan: the page is "it". */
    retakeOnly: 'Sustituirla por una foto nueva',
    retakeOnlyTouch: 'Fotografiarla de nuevo',
  },
  files: {
    pageLimit: 'Elige hasta 20 imágenes de páginas a la vez.',
    imagesOrOneFile:
      'Elige las imágenes de las páginas juntas, o abre un solo archivo PDF, MusicXML o MIDI.',
    fileTypes: 'Elige un archivo PNG, JPEG o PDF de hasta 10 MB.',
    contentMismatch: 'El contenido del archivo no coincide con su extensión (PNG, JPEG o PDF).',
  },
  rotation: {
    unreadable: 'No se pudo girar esta imagen. Prueba con otro PNG o JPEG.',
    tooLargeChoose:
      'Esta imagen es demasiado grande para girarla aquí (máximo 16 megapíxeles). Elige una imagen más pequeña. Tu imagen actual no cambia.',
    tooLarge:
      'Esta imagen es demasiado grande para girarla aquí (máximo 16 megapíxeles). Tu imagen actual no cambia.',
    originalTooBig: 'Elige una imagen de hasta 10 MB para girarla.',
    browserCannot: 'Este navegador no pudo girar la imagen. Tu imagen actual no cambia.',
    failed: 'No se pudo girar esta imagen. Tu imagen actual no cambia.',
    resultTooBig:
      'La imagen girada supera los 10 MB. Elige una imagen más pequeña. Tu imagen actual no cambia.',
  },
  client: {
    busy: 'El escáner está ocupado con otra partitura. Inténtalo de nuevo dentro de un minuto.',
    limited: 'Has escaneado mucho en la última hora. Inténtalo de nuevo más tarde.',
    serviceStatus: (status: number) =>
      `El escáner no pudo responder (error ${status}). Inténtalo de nuevo más tarde.`,
    noAnswer: 'El escáner no pudo responder. Inténtalo de nuevo más tarde.',
    noResult: 'El escáner no devolvió ninguna partitura.',
    invalidJob: 'Tarea de escaneo no válida.',
  },
  join: {
    refused: (page: number | undefined, reason: string) =>
      page === undefined
        ? `Estas páginas no se pueden combinar: ${reason}.`
        : `La página ${page} no se puede combinar con las demás páginas: ${reason}.`,
    reasons: {
      noPages: 'no se reconoció ninguna página',
      entities: 'su archivo usa entidades XML',
      notPartwise: 'su archivo no es MusicXML «partwise»',
      transposition: 'incluye una transposición o atributos especiales de pentagrama o de compás',
      partLayout: 'su lista de partes está incompleta',
      partOrder: 'sus partes no están en el orden de su lista de partes',
      measureCounts: (counts: number[]) =>
        `se leyó como ${plural('es', counts.length, { one: '# parte', other: '# partes' })} con ${formatList('es', counts.map(String))} compases`,
      startingSetup:
        'al principio no tiene divisiones, armadura, indicación de compás ni claves explícitas',
      staffLayout: 'la disposición inicial de sus pentagramas está incompleta',
      staffChange: 'la disposición de sus pentagramas cambia dentro de la página',
      instrumentUndeclared: 'hace referencia a un instrumento que no está declarado',
      partCounts: (found: number, first: number) =>
        `se leyó como ${plural('es', found, { one: '# parte', other: '# partes' })}, mientras que la página 1 tiene ${first}`,
      layoutsDiffer: 'sus partes o pentagramas difieren de los de la página 1',
      instrumentsDiffer: 'sus instrumentos difieren de los de la página 1',
      duplicateIds: 'tiene identificadores XML duplicados',
      unresolvedId: 'hace referencia a un identificador XML que no existe',
      spanNumber: 'tiene un número no válido en un signo de notación',
      spanOverflow: 'necesita más de 16 números para un mismo tipo de signo de notación',
    },
  },
};
