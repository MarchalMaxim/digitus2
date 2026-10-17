import type { Messages } from '../messages.js';
import { formatNumber, plural } from '../format.js';

const NUMBER_WORDS = [
  'Cero',
  'Uno',
  'Dos',
  'Tres',
  'Cuatro',
  'Cinco',
  'Seis',
  'Siete',
  'Ocho',
  'Nueve',
];

const count = (n: number) => NUMBER_WORDS[n] ?? formatNumber('es', n);

export const about: Messages['about'] = {
  back: 'Volver a la biblioteca',
  title: 'Acerca de digitus2',
  what: {
    heading: 'Qué es esto',
    body: 'digitus2 escribe los números de dedo en la música de piano para intérpretes de nivel inicial e intermedio.',
  },
  how: {
    heading: 'Cómo se eligen las digitaciones',
    body: (version: string) =>
      'El motor puntúa cada digitación posible con reglas ergonómicas de la literatura sobre ' +
      'digitación pianística (aperturas entre dedos, pasos del pulgar, dedos débiles, teclas ' +
      'negras, cambios de posición de la mano) y elige la de menor coste para toda la pieza ' +
      'con una búsqueda exacta. El tamaño de tu mano cambia las aperturas que permite. ' +
      `La versión del motor es ${version}.`,
  },
  who: {
    heading: 'Quién lo hizo',
    body:
      'Creado por Claude, el modelo de IA de Anthropic, en un desarrollo autónomo de varios ' +
      'días dirigido por Maxim Marchal. Que sepamos, aún no existe nada igual: un motor de ' +
      'digitación verificado con anotaciones de expertos. El código, las notas de investigación ' +
      'y los resultados de la verificación están en el [repositorio].',
  },
  licences: {
    heading: 'Licencias',
    digitus2: '[digitus2] es software libre con licencia MIT.',
    verovio:
      'Grabado musical con [Verovio], LGPL-3.0-or-later, usado como biblioteca sin modificar.',
    pdfjs: 'Las vistas previas de PDF usan [PDF.js] ([Apache-2.0]).',
    midiFile: 'Los archivos MIDI se leen con [midi-file] (MIT).',
    piano:
      'Sonido de piano: [smplr] (MIT) reproduce las muestras de [Splendid Grand Piano] (dominio público).',
  },
  pieces: {
    heading: 'Las piezas incluidas',
    intro: 'Las piezas usan ediciones de dominio público o con licencia Creative Commons.',
    count,
    credit: (shareAlike: number, attribution: number) => {
      const credited = 'citan aquí y en las páginas de sus partituras.';
      if (shareAlike === 1 && attribution === 0)
        return 'Un grabado se comparte bajo CC BY-SA y se cita aquí y en la página de su partitura.';
      const start = `${count(shareAlike)} grabados se comparten bajo CC BY-SA y`;
      return attribution === 0
        ? `${start} se ${credited}`
        : `${start} ${count(attribution).toLowerCase()} bajo CC BY; todos se ${credited}`;
    },
    columns: { piece: 'Pieza', composer: 'Compositor', engraving: 'Grabado', licence: 'Licencia' },
    arrangement: 'arreglo de digitus2',
    unnamedTypesetter: 'Grabador desconocido',
    archive: (n: number) =>
      plural('es', n, { one: '# partitura más procede', other: '# partituras más proceden' }) +
      ' del archivo de MuseScore (el conjunto de datos PDMX). Cada una es de dominio público o ' +
      'CC0, según lo declaró quien la subió, y cita su fuente y su licencia en la página de su ' +
      'partitura.',
  },
};
