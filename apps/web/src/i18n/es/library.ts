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
    showMore: (n: number) => `Mostrar ${formatNumber('es', n)} más`,
    showLast: (n: number) =>
      plural('es', n, { one: 'Mostrar la última', other: 'Mostrar las # últimas' }),
    allInLevel: (n: number, level: string) => `Ver las ${formatNumber('es', n)} en ${level}`,
    openPiece: (title: string, composer: string) => `Abrir ${title} de ${composer}`,
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
  favourites: {
    heading: 'Favoritos',
    all: (n: number) => `Ver los ${formatNumber('es', n)} favoritos`,
  },
  myScores: {
    heading: 'Mis partituras',
    saved: 'Guardadas',
    thisVisitOnly: 'Disponibles solo durante esta visita',
    saving: 'Guardando…',
    open: (name: string) => `Abrir ${name} (guardada)`,
    removeLabel: (name: string) => `Eliminar ${name} (guardada)`,
    remove: 'Eliminar',
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
