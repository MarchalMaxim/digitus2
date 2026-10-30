import { formatNumber, plural } from '../format.js';
import type { Messages } from '../messages.js';

const pieces = (n: number) => plural('es', n, { one: '# pieza', other: '# piezas' });

export const library: Messages['library'] = {
  tiers: { easy: 'Fácil', medium: 'Intermedio', harder: 'Más difícil', challenging: 'Exigente' },
  pieces,
  welcome: {
    tagline: 'Números de dedos para piano. Elige una pieza, pulsa Reproducir y sigue la nota roja.',
    startWith: (title: string) => `Empieza con ${title}`,
    continueWith: (title: string) => `Continúa con ${title}`,
  },
  pills: {
    level: 'Nivel',
    length: 'Duración',
    lengths: {
      any: 'Cualquier duración',
      short: 'Menos de 1 min',
      medium: 'De 1 a 3 min',
      long: 'Más de 3 min',
    },
  },
  shelves: {
    songs: {
      name: 'Canciones',
      line: 'Melodías conocidas, de canciones infantiles a películas y videojuegos.',
      all: (n: number) => `Ver las ${formatNumber('es', n)} canciones`,
    },
    classical: {
      name: 'Clásica',
      line: 'Mozart, Clementi, Czerny y los estudios con los que crecen los pianistas.',
      all: (n: number) => `Ver las ${formatNumber('es', n)} piezas clásicas`,
    },
    folk: {
      name: 'Folclore y villancicos',
      line: 'Melodías populares, danzas, villancicos e himnos.',
      all: (n: number) => `Ver las ${formatNumber('es', n)} melodías populares y villancicos`,
    },
    baroque: {
      name: 'Barroca',
      line: 'Bach, Händel, Scarlatti y otros, de 1600 a 1750.',
      all: (n: number) => `Ver las ${formatNumber('es', n)} piezas barrocas`,
    },
    romantic: {
      name: 'Romántica',
      line: 'Schumann, Chopin, Chaikovski y otros, de 1820 a 1900.',
      all: (n: number) => `Ver las ${formatNumber('es', n)} piezas románticas`,
    },
    jazz: {
      name: 'Jazz, ragtime y moderna',
      line: 'Los rags de Joplin y la música escrita desde 1900.',
      all: (n: number) => `Ver las ${formatNumber('es', n)} piezas de jazz, ragtime y modernas`,
    },
  },
  list: {
    allStyles: 'Todos los estilos',
    otherPieces: 'Otras piezas',
    showOther: 'Mostrar otras piezas',
    showMore: (n: number) => `Mostrar ${formatNumber('es', n)} más`,
    showLast: (n: number) =>
      plural('es', n, { one: 'Mostrar la última', other: 'Mostrar las # últimas' }),
    allInLevel: (n: number, level: string) => `Ver las ${formatNumber('es', n)} en ${level}`,
    openPiece: (title: string, composer: string | null) =>
      composer === null ? `Abrir ${title}` : `Abrir ${title} de ${composer}`,
  },
  search: {
    label: 'Buscar en la biblioteca',
    placeholder: 'Busca piezas y compositores',
    clear: 'Borrar',
    clearLabel: 'Borrar la búsqueda',
    noMatch: (query: string) => `Ninguna pieza coincide con “${query}”.`,
    noMatchHint: 'La búsqueda mira títulos, compositores y colecciones.',
  },
  announce: {
    dealt: 'Otras piezas mostradas',
    counted: (name: string, n: number) => `${name}: ${pieces(n)}`,
    showing: (shown: number, total: number) =>
      `Mostrando ${formatNumber('es', shown)} de ${formatNumber('es', total)}`,
    showingIn: (shown: number, total: number, level: string) =>
      `Mostrando ${formatNumber('es', shown)} de ${formatNumber('es', total)} en ${level}`,
  },
  aboutAndLicences: 'Información y licencias',
  ownFile: {
    open: 'Abre tu propia partitura',
    dropTitle: 'Suelta para abrir este archivo',
    dropHint: 'MusicXML, MIDI, foto o PDF',
    notScore: 'Eso no parece un archivo MusicXML o MIDI (.musicxml, .xml, .mxl, .mid o .midi).',
    oneAtATime: 'Abre un solo archivo MusicXML o MIDI a la vez.',
    cannotReadFiles: 'No se pudieron leer estos archivos.',
    cannotReadFile: 'No se pudo leer este archivo.',
  },
  piano: {
    start: 'Toca junto con tu piano',
    asking: 'Permite que el navegador use tu piano.',
    searching: 'Buscando tu piano. Comprueba que está encendido.',
    connected: (name: string) => `${name} está conectado. Abre una pieza y toca la nota roja.`,
    yourPiano: 'Tu piano',
    none: 'No se encontró ningún piano. Conéctalo con un cable USB, o emparéjalo por Bluetooth y enciéndelo.',
    bluetoothFlag: (flag: string) =>
      `En Windows, un piano Bluetooth también necesita ${flag} configurado en Enabled.`,
    denied:
      'El navegador bloqueó MIDI para este sitio. Permítelo en la configuración del sitio y vuelve a pulsar.',
    turnOff: 'Desactivar',
  },
  favourites: {
    heading: 'Favoritos',
    line: 'Las piezas que marcaste con el corazón, las más recientes primero.',
    all: (n: number) => `Ver los ${formatNumber('es', n)} favoritos`,
    remove: (title: string, composer: string | null) =>
      composer === null
        ? `Quitar ${title} de Favoritos`
        : `Quitar ${title} de ${composer} de Favoritos`,
  },
  myScores: {
    heading: 'Mis partituras',
    saved: 'Guardadas',
    thisVisitOnly: 'Disponibles solo durante esta visita',
    saving: 'Guardando…',
    open: (name: string) => `Abrir ${name} (guardada)`,
    removeLabel: (name: string) => `Eliminar ${name} (guardada)`,
    remove: 'Eliminar',
    removed: (name: string) => `Se eliminó ${name}.`,
    detail: {
      file: 'Archivo de partitura',
      recognition: 'Reconocimiento guardado',
      draft: 'Borrador de escaneo',
      corrected: 'Reconocimiento corregido',
    },
    removeFailed: 'No se pudo eliminar esta partitura. Inténtalo de nuevo.',
    removedNotErased:
      'Esta partitura se eliminó durante esta visita, pero no se pudo actualizar el almacenamiento del navegador. Puede reaparecer al recargar.',
    saveFailed: 'No se pudo guardar tu partitura. Conserva tus archivos originales.',
    openFailed: 'No se pudo abrir esta partitura guardada. Elige de nuevo tu archivo original.',
  },
  shared: {
    share: 'Compartir',
    shareLabel: (name: string) => `Compartir ${name}`,
    withdraw: 'Retirar',
    withdrawLabel: (name: string) => `Retirar ${name} de la revisión`,
    detail: { waiting: 'Esperando revisión', shared: 'Compartida', notShared: 'No compartida' },
    sent: 'Enviada para revisión. Aparecerá en Compartidas por lectores cuando el propietario la haya leído.',
    unavailable: 'Compartir no está disponible ahora. Inténtalo más tarde.',
    tooLarge: 'Esta partitura es demasiado grande para compartirla.',
    withdrawFailed: 'No se pudo retirar esta partitura. Inténtalo de nuevo.',
    sheetHeading: 'Compartir con otros lectores',
    title: 'Título',
    composer: 'Compositor',
    titleMissing: 'Ponle un título a la partitura.',
    rule: 'Comparte solo música libre de derechos de autor o que hayas escrito tú. El propietario lee cada partitura antes de que otros puedan encontrarla.',
    free: 'Esta música es libre de compartir',
    tick: 'Marca la casilla para compartir esta partitura.',
    cancel: 'Cancelar',
    shelf: 'Compartidas por lectores',
    more: 'Más partituras compartidas',
    open: (title: string) => `Abrir ${title} (compartida)`,
    byReader: 'Compartida por un lector',
    report: 'Denunciar',
    notLoaded: 'No se pudo cargar esta partitura compartida.',
    reportHeading: 'Denunciar esta partitura',
    reasons: {
      copyright: 'Tiene derechos de autor',
      abuse: 'Es ofensiva o es spam',
      broken: 'No suena bien',
    },
    chooseReason: 'Elige un motivo.',
    reply: '¿Cómo puede responderte el propietario?',
    replyNeeded: 'Indica cómo puede responderte el propietario.',
    note: 'Algo más (opcional)',
    send: 'Enviar denuncia',
    sentHeading: 'Denuncia enviada',
    sentLine:
      'El propietario lee todas las denuncias y retira las partituras que no deben estar aquí.',
    backToScore: 'Volver a la partitura',
    failed: 'No se pudo enviar la denuncia.',
    askRemoval: 'Pedir la retirada en GitHub',
  },
  credit: {
    arrangement: 'Arreglo de digitus2, CC0 (dominio público)',
    unnamedTypesetter: 'un grabador desconocido',
    engraving: (by: string, licence: string) =>
      `Grabado de ${by} para el Mutopia Project, ${licence}`,
    engravingPublicDomain: (by: string) =>
      `Grabado de ${by} para el Mutopia Project, dominio público`,
  },
  loadFailed:
    'No se pudieron cargar los datos de la pieza. Comprueba la conexión e inténtalo de nuevo.',
};
