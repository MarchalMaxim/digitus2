import { plural } from '../format.js';
import type { Messages } from '../messages.js';

export const scan: Messages['scan'] = {
  view: {
    back: 'Volver a la biblioteca',
    experimental: 'Escaneo experimental',
    titleStart: 'Del papel al piano',
    titleReview: 'Revisa el reconocimiento',
    pageImages: (n: number) =>
      plural('es', n, { one: '# imagen de página', other: '# imágenes de página' }),
    advice:
      'Los PDF originales y los escaneos planos de alta resolución funcionan mejor. Las fotos de libros son experimentales y pueden fallar, incluso con buena luz. El resultado se abre junto al original para que lo revises.',
    workerNeeded:
      'Esta opción experimental necesita el programa de PC en este ordenador. El localhost de un teléfono no puede llegar a tu PC.',
    connect: 'Conectar con este PC',
    connecting: 'Conectando…',
    cancelScan: 'Cancelar escaneo',
    cancelling: 'Cancelando…',
    retryFailed: 'Reintentar las páginas fallidas',
    scanScore: 'Escanear esta partitura',
    scanning:
      'Reconociendo en este PC… Suele tardar unos segundos; las páginas más largas pueden tardar unos minutos.',
    scanningPage: (page: number, total: number) =>
      `Página ${page} de ${total} · Reconociendo en este PC… Suele tardar unos segundos; las páginas más largas pueden tardar unos minutos.`,
    connected: 'PC conectado.',
    textModelMissing:
      'El reconocimiento de texto en inglés no está configurado. Puede faltar el texto musical. Mira la configuración más abajo.',
    original: 'Original',
    openPdf: 'Abrir el PDF original',
    openImage: 'Abrir la imagen original',
    preparingPdf: 'Preparando el PDF original…',
    originalAlt: 'Partitura impresa original',
  },
  setup: {
    summary: 'Configurar el programa de PC',
    install:
      'En el PC donde usas este navegador, abre la carpeta del proyecto digitus2. Instala una sola vez los reconocedores de fotos y de PDF y luego inicia el programa cuando lo necesites.',
    keepOpen:
      'Deja esa terminal abierta. Permite la conexión local del navegador después de pulsar Conectar con este PC. Para detener el procesamiento, cierra el programa.',
    help: 'Configuración y solución de problemas',
  },
  review: {
    caveat:
      'El reconocimiento puede tener errores en notas, ritmos, ligaduras o manos. El texto y el tempo pueden estar incompletos. Aún no se ha añadido ninguna digitación.',
    recognized: 'Notación reconocida',
    sheetLabel: 'reconocimiento en bruto del escaneo',
    viewLabel: 'Vista del reconocimiento',
    pageRecognition: 'Reconocimiento por página',
    combinedScore: 'Partitura combinada',
    pageShown: (page: number) => `Reconocimiento de la página ${page}`,
    allPages: 'Todas las páginas en orden de lectura',
    preparing: 'Preparando la notación reconocida…',
    problem: (error: string) =>
      `${error} Descarga el archivo en bruto para corregirlo en un editor de partituras, o prueba con otra imagen.`,
    detailsSummary: 'Detalles del reconocimiento',
    retained:
      'Encuentra los originales y los reconocimientos guardados en Mis partituras. Conserva tus propios archivos originales; el almacenamiento del navegador puede borrarse. El reconocimiento no está certificado como exacto; la reproducción puede usar un tempo predeterminado de la app.',
    beamGrouping: 'La agrupación de las barras se deduce y puede diferir del original.',
    graphicSpanWarning:
      'Las ligaduras y otros signos de notación se mantienen dentro de cada página escaneada. Compara las continuaciones en los bordes de página; los extremos que faltan no se han reparado.',
    unknownWarning: 'El reconocedor indicó una advertencia desconocida. Revisa bien el original.',
    downloadPagesSummary: 'Descargar los archivos de cada página',
    downloadPage: (page: number) => `Descargar el MusicXML de la página ${page}`,
    downloadCombined: 'Descargar el MusicXML combinado',
    downloadRaw: 'Descargar el MusicXML en bruto',
    useForFingerings: 'Usar para las digitaciones',
    scanAgain: 'Escanear de nuevo',
  },
  errors: {
    notCombinedSaved:
      'Se reconocieron las páginas, pero no se pudo combinar su notación. Los archivos de cada página están disponibles más abajo.',
    notCombined: (reason: string) =>
      `Se reconocieron las páginas, pero no se pudo combinar su notación. ${reason}`,
    somePagesFailed:
      'Algunas páginas necesitan otro escaneo. Las páginas reconocidas se conservan.',
    recognitionFailed: 'El reconocimiento falló.',
    notationNotShown: (reason: string) => `No se pudo mostrar la notación: ${reason}`,
    noNotes: 'No se reconoció ninguna nota que se pueda tocar.',
    notUsable: (reason: string) =>
      `Este reconocimiento no se puede usar para las digitaciones: ${reason}`,
    connectFailed:
      'No se pudo conectar con este PC. Inicia el programa y permite la conexión local de este sitio cuando el navegador lo pida. Si la denegaste, cambia el permiso de red local de este sitio e inténtalo de nuevo.',
    cancelFailed:
      'No se pudo confirmar la cancelación. Cierra la terminal del programa para detener el procesamiento.',
    timedOut: 'El reconocimiento tardó demasiado. Prueba con una página más pequeña y más nítida.',
    notRecognized:
      'El PC no pudo reconocer una partitura completa en esta página. Prueba con el PDF original o con una imagen más plana y de mayor resolución.',
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
    busy: 'El PC ya está escaneando. Inténtalo de nuevo en un momento.',
    workerStatus: (status: number) => `El programa de PC respondió con el código ${status}.`,
    invalidJob: 'Tarea de escaneo no válida.',
    updateWorker: 'Actualiza el programa de PC para continuar.',
    noJob: 'El programa no devolvió ninguna tarea de escaneo.',
  },
  join: {
    refused: (reason: string) =>
      `Estas páginas no se pueden combinar con seguridad: ${reason}. Descarga cada página para corregirla en un editor de partituras.`,
    reasons: {
      noPages: 'no hay páginas reconocidas',
      entities: 'no se admiten entidades XML',
      notPartwise: 'se esperaba MusicXML «partwise»',
      repeats: 'las repeticiones o los saltos necesitan revisión manual',
      transposition:
        'la transposición o los atributos especiales de pentagrama o de compás necesitan revisión manual',
      partLayout: 'disposición de las partes incompleta',
      partOrder: 'el orden de las partes difiere de la lista de partes',
      measureCounts: 'las partes tienen un número distinto de compases',
      startingSetup: (page: number) =>
        `la página ${page} necesita divisiones, armadura, indicación de compás y claves explícitos al principio`,
      staffLayout: 'disposición inicial de los pentagramas incompleta',
      staffChange: 'la disposición de los pentagramas cambia dentro de una página',
      instrumentUndeclared: 'una referencia de instrumento no tiene declaración',
      partCounts: 'el número de partes difiere',
      layoutsDiffer: 'las disposiciones de partes o pentagramas difieren',
      instrumentsDiffer: 'las disposiciones de instrumentos difieren',
      duplicateIds: 'identificadores XML duplicados dentro de una página',
      unresolvedId: 'referencia a un identificador XML que no existe',
      spanNumber: 'número de signo gráfico no válido',
      spanOverflow:
        'más de 16 números propios de la página para un mismo tipo de signo de notación',
    },
  },
};
