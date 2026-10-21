import { formatNumber, plural } from '../format.js';
import type { Messages } from '../messages.js';

const notes = (n: number) => plural('pt', n, { one: '# nota', other: '# notas' });

export const score: Messages['score'] = {
  fingerLegend:
    'Números dos dedos: 1 é o polegar e 5 o mindinho, nas duas mãos. A pauta de cima é a mão direita e a de baixo, a mão esquerda.',
  noteLetters: ['Dó', 'Ré', 'Mi', 'Fá', 'Sol', 'Lá', 'Si'],
  header: {
    back: 'Voltar à biblioteca',
    favourite: 'Favorito',
  },
  sheet: {
    label: (title: string) => `Partitura de ${title}`,
  },
  keyboard: {
    label: 'Teclado',
    hands: { L: 'E', R: 'D' },
  },
  view: {
    status: {
      loading: 'Carregando a partitura…',
      fingering: 'Calculando o dedilhado…',
      rendering: 'Preparando a partitura…',
    },
    loadingPiano: 'Carregando o piano…',
    editorialShown: 'Mostrando o dedilhado do editor',
    noNotesLeft: 'Esta peça não tem notas para a mão esquerda.',
    noNotesRight: 'Esta peça não tem notas para a mão direita.',
    noNotes: 'Esta peça não tem notas para tocar.',
    practice: 'Prática',
    scanSource: 'Origem da digitalização e reconhecimento',
    couldNotOpenFile: (name: string) =>
      `Não foi possível abrir ${name}. Este arquivo não pôde ser lido como partitura. digitus2 abre arquivos MusicXML e MIDI (.musicxml, .xml, .mxl, .mid ou .midi).`,
    couldNotOpenPiece: (name: string) =>
      `Não foi possível abrir ${name}. Algo deu errado ao preparar esta peça. Tente novamente.`,
    details: (error: string) => `Detalhes: ${error}`,
  },
  side: {
    label: 'Peça e dedilhado',
    facts: {
      level: 'Nível',
      key: 'Tonalidade',
      time: 'Compasso',
      length: 'Duração',
      bars: 'Compassos',
    },
    keyName: (tonic: string, accidental: '' | '#' | 'b', mode: 'major' | 'minor') =>
      `${tonic}${accidental === '#' ? ' sustenido' : accidental === 'b' ? ' bemol' : ''} ${mode === 'major' ? 'maior' : 'menor'}`,
    handSize: {
      label: 'Tamanho da mão',
      large: 'Grande',
      medium: 'Média',
      small: 'Pequena',
      child: 'Criança',
      help: 'O tamanho da mão muda as aberturas que o dedilhado permite. Escolha criança ou pequena para mãos pequenas.',
    },
    showEditorial: 'Mostrar o dedilhado do editor',
    exportButton: 'Exportar MusicXML',
    print: 'Imprimir',
    exportFailed: (reason: string) => `Não foi possível exportar a partitura: ${reason}`,
    printPrepareFirst:
      'Cancele esta janela e use o botão Imprimir na partitura. Prepara a música para o papel.',
    printFailed: (reason: string) => `Não foi possível imprimir a partitura: ${reason}`,
    printHeadingTooLong: 'O título e os créditos são demasiado longos para uma página impressa.',
    details: 'Detalhes',
    timings: (solveMs: number, renderMs: number) =>
      `Dedilhado em ${solveMs} ms · diagramação em ${renderMs} ms`,
  },
  midi: {
    label: 'Importação MIDI',
    splitLabel: 'Divisão das mãos',
    automatic: 'Automática',
    splitHelp: 'As teclas da nota escolhida para cima vão para a mão direita.',
    grids: {
      sixteenth: 'uma grade de semicolcheias',
      sixteenthTriplets: 'uma grade de semicolcheias com tercinas',
      thirtySecond: 'uma grade de fusas',
      thirtySecondTriplets: 'uma grade de fusas com tercinas',
    },
    importLine: (grid: string, movedPercent: number) =>
      `Importado de MIDI: notas quantizadas em ${grid}; ${formatNumber('pt', movedPercent)} % deslocadas em mais de uma semifusa`,
    handCounts: (right: number, left: number) =>
      `Mão direita: ${notes(right)} · mão esquerda: ${notes(left)}`,
  },
  doc: {
    fetchFailed: (status: number) =>
      `não foi possível obter o arquivo da partitura (HTTP ${status})`,
    noPiece: (slug: string) => `não há nenhuma peça chamada “${slug}”`,
    layoutFailed: 'não foi possível diagramar a partitura, tente novamente',
  },
};
