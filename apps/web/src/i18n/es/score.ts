import { plural } from '../format.js';
import type { Messages } from '../messages.js';

const notes = (n: number) => plural('es', n, { one: '# nota', other: '# notas' });

export const score: Messages['score'] = {
  fingerLegend:
    'Números de dedos: 1 es el pulgar y 5 el meñique, en ambas manos. El pentagrama superior es la mano derecha y el inferior, la izquierda.',
  noteLetters: ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'],
  header: {
    back: 'Volver a la biblioteca',
    favourite: 'Favorito',
  },
  sheet: {
    label: (title: string) => `Partitura de ${title}`,
  },
  keyboard: {
    label: 'Teclado',
    hands: { L: 'I', R: 'D' },
  },
  view: {
    status: {
      loading: 'Cargando la partitura…',
      fingering: 'Calculando la digitación…',
      rendering: 'Preparando la partitura…',
    },
    loadingPiano: 'Cargando el piano…',
    editorialShown: 'Mostrando la digitación del editor',
    noNotesLeft: 'Esta pieza no tiene notas para la mano izquierda.',
    noNotesRight: 'Esta pieza no tiene notas para la mano derecha.',
    noNotes: 'Esta pieza no tiene notas para tocar.',
    playAlongHint: (count: number) =>
      count > 1 ? 'Toca las notas rojas en tu piano.' : 'Toca la nota roja en tu piano.',
    playAlongSound: {
      click: 'Haz clic una vez para oír la otra mano.',
      tap: 'Toca una vez para oír la otra mano.',
    },
    timingExplain:
      'Un círculo antes de una nota significa que llegó antes de tiempo; después, tarde.',
    practice: 'Práctica',
    scanSource: 'Origen del escaneo y reconocimiento',
    couldNotOpenFile: (name: string) =>
      `No se pudo abrir ${name}. Este archivo no se pudo leer como partitura. digitus2 abre archivos MusicXML y MIDI (.musicxml, .xml, .mxl, .mid o .midi).`,
    couldNotOpenPiece: (name: string) =>
      `No se pudo abrir ${name}. Algo salió mal al preparar esta pieza. Inténtalo de nuevo.`,
    details: (error: string) => `Detalles: ${error}`,
  },
  side: {
    label: 'Pieza y digitación',
    facts: {
      level: 'Nivel',
      key: 'Tonalidad',
      time: 'Compás',
      length: 'Duración',
      bars: 'Compases',
    },
    keyName: (tonic: string, accidental: '' | '#' | 'b', mode: 'major' | 'minor') =>
      `${tonic}${accidental === '#' ? ' sostenido' : accidental === 'b' ? ' bemol' : ''} ${mode === 'major' ? 'mayor' : 'menor'}`,
    handSize: {
      label: 'Tamaño de la mano',
      large: 'Grande',
      medium: 'Mediana',
      small: 'Pequeña',
      child: 'Infantil',
      help: 'El tamaño de la mano cambia los estiramientos que permite la digitación. Elige infantil o pequeña si tienes las manos pequeñas.',
    },
    showEditorial: 'Mostrar la digitación del editor',
    exportButton: 'Exportar MusicXML',
    print: 'Imprimir',
    exportFailed: (reason: string) => `No se pudo exportar la partitura: ${reason}`,
    printPrepareFirst:
      'Cancela este diálogo y utiliza el botón Imprimir de la partitura. Prepara la música para el papel.',
    printFailed: (reason: string) => `No se pudo imprimir la partitura: ${reason}`,
    printHeadingTooLong: 'El título y los créditos son demasiado largos para una página impresa.',
    details: 'Detalles',
    timings: (solveMs: number, renderMs: number) =>
      `Digitación en ${solveMs} ms · maquetación en ${renderMs} ms`,
  },
  midi: {
    label: 'Importación MIDI',
    splitLabel: 'División de manos',
    automatic: 'Automática',
    splitHelp: 'Las teclas desde la nota elegida hacia arriba van a la mano derecha.',
    handCounts: (right: number, left: number) =>
      `Mano derecha: ${notes(right)} · mano izquierda: ${notes(left)}`,
  },
  doc: {
    fetchFailed: (status: number) =>
      `no se pudo obtener el archivo de la partitura (HTTP ${status})`,
    noPiece: (slug: string) => `no hay ninguna pieza llamada “${slug}”`,
    layoutFailed: 'no se pudo maquetar la partitura, inténtalo de nuevo',
  },
};
