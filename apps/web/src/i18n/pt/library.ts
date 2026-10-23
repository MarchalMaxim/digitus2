import { formatNumber, plural } from '../format.js';
import type { Messages } from '../messages.js';

const pieces = (n: number) => plural('pt', n, { one: '# peça', other: '# peças' });

export const library: Messages['library'] = {
  tiers: {
    easy: 'Fácil',
    medium: 'Intermediário',
    harder: 'Mais difícil',
    challenging: 'Desafiador',
  },
  pieces,
  welcome: {
    tagline:
      'Números dos dedos para piano. Escolha uma peça, aperte Tocar e acompanhe a nota vermelha.',
    startWith: (title: string) => `Comece com ${title}`,
    continueWith: (title: string) => `Continue com ${title}`,
  },
  pills: {
    level: 'Nível',
    length: 'Duração',
    lengths: {
      any: 'Qualquer duração',
      short: 'Menos de 1 min',
      medium: 'De 1 a 3 min',
      long: 'Mais de 3 min',
    },
  },
  shelves: {
    songs: {
      name: 'Canções',
      line: 'Melodias conhecidas, de canções infantis a filmes e jogos.',
      all: (n: number) => `Ver as ${formatNumber('pt', n)} canções`,
    },
    classical: {
      name: 'Clássica',
      line: 'Mozart, Clementi, Czerny e os estudos com que os pianistas crescem.',
      all: (n: number) => `Ver as ${formatNumber('pt', n)} peças clássicas`,
    },
    folk: {
      name: 'Folclore e músicas de Natal',
      line: 'Melodias populares, danças, músicas de Natal e hinos.',
      all: (n: number) => `Ver as ${formatNumber('pt', n)} melodias populares e músicas de Natal`,
    },
    baroque: {
      name: 'Barroca',
      line: 'Bach, Händel, Scarlatti e outros, de 1600 a 1750.',
      all: (n: number) => `Ver as ${formatNumber('pt', n)} peças barrocas`,
    },
    romantic: {
      name: 'Romântica',
      line: 'Schumann, Chopin, Tchaikovsky e outros, de 1820 a 1900.',
      all: (n: number) => `Ver as ${formatNumber('pt', n)} peças românticas`,
    },
    jazz: {
      name: 'Jazz, ragtime e moderna',
      line: 'Os rags de Joplin e a música escrita desde 1900.',
      all: (n: number) => `Ver as ${formatNumber('pt', n)} peças de jazz, ragtime e moderna`,
    },
  },
  list: {
    allStyles: 'Todos os estilos',
    otherPieces: 'Outras peças',
    showMore: (n: number) => `Mostrar mais ${formatNumber('pt', n)}`,
    showLast: (n: number) =>
      plural('pt', n, { one: 'Mostrar a última', other: 'Mostrar as # últimas' }),
    allInLevel: (n: number, level: string) => `Ver as ${formatNumber('pt', n)} em ${level}`,
    openPiece: (title: string, composer: string | null) =>
      composer === null ? `Abrir ${title}` : `Abrir ${title}, de ${composer}`,
  },
  search: {
    label: 'Pesquisar na biblioteca',
    placeholder: 'Pesquise peças e compositores',
    clear: 'Limpar',
    clearLabel: 'Limpar a pesquisa',
    noMatch: (query: string) => `Nenhuma peça corresponde a “${query}”.`,
    noMatchHint: 'A pesquisa procura em títulos, compositores e coleções.',
  },
  announce: {
    counted: (name: string, n: number) => `${name}: ${pieces(n)}`,
    showing: (shown: number, total: number) =>
      `Mostrando ${formatNumber('pt', shown)} de ${formatNumber('pt', total)}`,
    showingIn: (shown: number, total: number, level: string) =>
      `Mostrando ${formatNumber('pt', shown)} de ${formatNumber('pt', total)} em ${level}`,
  },
  aboutAndLicences: 'Informações e licenças',
  ownFile: {
    open: 'Abrir a sua própria partitura',
    dropTitle: 'Solte para abrir este arquivo',
    dropHint: 'MusicXML, MIDI, foto ou PDF',
    notScore: 'Isso não parece um arquivo MusicXML ou MIDI (.musicxml, .xml, .mxl, .mid ou .midi).',
    oneAtATime: 'Abra um arquivo MusicXML ou MIDI por vez.',
    cannotReadFiles: 'Não foi possível ler estes arquivos.',
    cannotReadFile: 'Não foi possível ler este arquivo.',
  },
  piano: {
    start: 'Tocar junto no seu piano',
    asking: 'Permita que o navegador use seu piano.',
    searching: 'Procurando seu piano. Verifique se ele está ligado.',
    connected: (name: string) => `${name} está conectado. Abra uma peça e toque a nota vermelha.`,
    yourPiano: 'Seu piano',
    none: 'Nenhum piano encontrado. Conecte-o com um cabo USB, ou pareie por Bluetooth e ligue-o.',
    bluetoothFlag: (flag: string) =>
      `No Windows, um piano Bluetooth também precisa de ${flag} definido como Enabled.`,
    denied:
      'O navegador bloqueou o MIDI neste site. Permita nas configurações do site e pressione de novo.',
    turnOff: 'Desativar',
  },
  favourites: {
    heading: 'Favoritos',
    line: 'As peças que você marcou com o coração, as mais recentes primeiro.',
    all: (n: number) => `Ver os ${formatNumber('pt', n)} favoritos`,
    remove: (title: string, composer: string | null) =>
      composer === null
        ? `Remover ${title} dos Favoritos`
        : `Remover ${title}, de ${composer}, dos Favoritos`,
  },
  myScores: {
    heading: 'Minhas partituras',
    saved: 'Salvas',
    thisVisitOnly: 'Disponíveis só nesta visita',
    saving: 'Salvando…',
    open: (name: string) => `Abrir ${name} (salva)`,
    removeLabel: (name: string) => `Remover ${name} (salva)`,
    remove: 'Remover',
    removed: (name: string) => `${name} foi removida.`,
    detail: {
      file: 'Arquivo de partitura',
      recognition: 'Reconhecimento salvo',
      draft: 'Rascunho de digitalização',
      corrected: 'Reconhecimento corrigido',
    },
    removeFailed: 'Não foi possível remover esta partitura. Tente de novo.',
    removedNotErased:
      'Esta partitura foi removida nesta visita, mas o armazenamento do navegador não pôde ser atualizado. Ela pode reaparecer após recarregar a página.',
    saveFailed: 'Não foi possível salvar sua partitura. Guarde seus arquivos originais.',
    openFailed:
      'Não foi possível abrir esta partitura salva. Escolha seu arquivo original de novo.',
  },
  credit: {
    arrangement: 'Arranjo do digitus2, CC0 (domínio público)',
    unnamedTypesetter: 'um editor desconhecido',
    engraving: (by: string, licence: string) =>
      `Edição de ${by} para o Mutopia Project, ${licence}`,
    engravingPublicDomain: (by: string) =>
      `Edição de ${by} para o Mutopia Project, domínio público`,
  },
  loadFailed: 'Não foi possível carregar os dados da peça. Verifique a conexão e tente de novo.',
};
