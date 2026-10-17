import { plural } from '../format.js';
import type { Messages } from '../messages.js';

export const scan: Messages['scan'] = {
  view: {
    back: 'Voltar para a biblioteca',
    experimental: 'Digitalização experimental',
    titleStart: 'Do papel ao piano',
    titleReview: 'Revise o reconhecimento',
    pageImages: (n: number) =>
      plural('pt', n, { one: '# imagem de página', other: '# imagens de página' }),
    advice:
      'PDFs originais e digitalizações planas de alta resolução funcionam melhor. Fotos de livros são experimentais e podem falhar, mesmo com boa luz. O resultado abre ao lado do original para você revisar.',
    workerNeeded:
      'Esta opção experimental precisa do programa de PC neste computador. O localhost de um celular não alcança o seu PC.',
    connect: 'Conectar a este PC',
    connecting: 'Conectando…',
    cancelScan: 'Cancelar digitalização',
    cancelling: 'Cancelando…',
    retryFailed: 'Tentar de novo as páginas com falha',
    scanScore: 'Digitalizar esta partitura',
    scanning:
      'Reconhecendo neste PC… Costuma levar alguns segundos; páginas mais longas podem levar alguns minutos.',
    scanningPage: (page: number, total: number) =>
      `Página ${page} de ${total} · Reconhecendo neste PC… Costuma levar alguns segundos; páginas mais longas podem levar alguns minutos.`,
    connected: 'PC conectado.',
    textModelMissing:
      'O reconhecimento de texto em inglês não está configurado. O texto musical pode estar faltando. Veja a configuração abaixo.',
    original: 'Original',
    openPdf: 'Abrir o PDF original',
    openImage: 'Abrir a imagem original',
    preparingPdf: 'Preparando o PDF original…',
    originalAlt: 'Partitura impressa original',
  },
  setup: {
    summary: 'Configurar o programa de PC',
    install:
      'No PC em que você usa este navegador, abra a pasta do projeto digitus2. Instale uma única vez os reconhecedores de fotos e de PDF e depois inicie o programa quando precisar.',
    keepOpen:
      'Deixe esse terminal aberto. Permita a conexão local do navegador depois de clicar em Conectar a este PC. Para parar o processamento, feche o programa.',
    help: 'Configuração e solução de problemas',
  },
  review: {
    caveat:
      'O reconhecimento pode ter erros em notas, ritmos, ligaduras ou mãos. O texto e o andamento podem estar incompletos. Nenhum dedilhado foi adicionado ainda.',
    recognized: 'Notação reconhecida',
    sheetLabel: 'reconhecimento bruto da digitalização',
    viewLabel: 'Visualização do reconhecimento',
    pageRecognition: 'Reconhecimento por página',
    combinedScore: 'Partitura combinada',
    pageShown: (page: number) => `Reconhecimento da página ${page}`,
    allPages: 'Todas as páginas na ordem de leitura',
    preparing: 'Preparando a notação reconhecida…',
    problem: (error: string) =>
      `${error} Baixe o arquivo bruto para corrigi-lo em um editor de partituras, ou tente outra imagem.`,
    detailsSummary: 'Detalhes do reconhecimento',
    retained:
      'Encontre os originais e os reconhecimentos guardados em Minhas partituras. Guarde seus próprios arquivos originais; o armazenamento do navegador pode ser apagado. O reconhecimento não é garantido como correto; a reprodução pode usar um andamento padrão do app.',
    beamGrouping: 'O agrupamento das barras é deduzido e pode diferir do original.',
    graphicSpanWarning:
      'Ligaduras e outros sinais de notação ficam dentro de cada página digitalizada. Compare as continuações nas bordas das páginas; os pontos finais que faltam não foram reparados.',
    unknownWarning: 'O reconhecedor indicou um aviso desconhecido. Confira bem o original.',
    downloadPagesSummary: 'Baixar os arquivos de cada página',
    downloadPage: (page: number) => `Baixar o MusicXML da página ${page}`,
    downloadCombined: 'Baixar o MusicXML combinado',
    downloadRaw: 'Baixar o MusicXML bruto',
    useForFingerings: 'Usar para os dedilhados',
    scanAgain: 'Digitalizar de novo',
  },
  errors: {
    notCombinedSaved:
      'As páginas foram reconhecidas, mas a notação delas não pôde ser combinada. Os arquivos de cada página estão disponíveis abaixo.',
    notCombined: (reason: string) =>
      `As páginas foram reconhecidas, mas a notação delas não pôde ser combinada. ${reason}`,
    somePagesFailed:
      'Algumas páginas precisam ser digitalizadas de novo. As páginas reconhecidas são mantidas.',
    recognitionFailed: 'O reconhecimento falhou.',
    notationNotShown: (reason: string) => `Não foi possível mostrar a notação: ${reason}`,
    noNotes: 'Nenhuma nota tocável foi reconhecida.',
    notUsable: (reason: string) =>
      `Este reconhecimento não pode ser usado para os dedilhados: ${reason}`,
    connectFailed:
      'Não foi possível conectar a este PC. Inicie o programa e permita a conexão local deste site quando o navegador perguntar. Se você negou, altere a permissão de rede local deste site e tente de novo.',
    cancelFailed:
      'Não foi possível confirmar o cancelamento. Feche o terminal do programa para parar o processamento.',
    timedOut: 'O reconhecimento demorou demais. Tente uma página menor e mais nítida.',
    notRecognized:
      'O PC não conseguiu reconhecer uma partitura completa nesta página. Tente o PDF original ou uma imagem mais plana e de maior resolução.',
  },
  pager: {
    previous: 'Anterior',
    next: 'Próxima',
    previousLabel: 'Página original anterior',
    nextLabel: 'Próxima página original',
    pageOf: (page: number, total: number) => `Página ${page} de ${total}`,
    navLabel: 'Navegação pelas páginas originais',
  },
  preview: {
    unavailable: (reason: string) => `Pré-visualização indisponível: ${reason}`,
    openToCompare: 'Abra o PDF original acima para comparar todas as páginas.',
    canvasMissing: 'O canvas não está disponível.',
    pageLabel: (page: number) => `PDF original, página ${page}`,
  },
  pages: {
    arrange:
      'Coloque as páginas na ordem de leitura. Arraste uma miniatura ou selecione uma página para movê-la.',
    originalCount: (n: number) =>
      plural('pt', n, {
        one: '# página original, na ordem de leitura.',
        other: '# páginas originais, na ordem de leitura.',
      }),
    listLabel: 'Páginas da partitura',
    select: (page: number, name: string) => `Selecionar a página ${page}: ${name}`,
    needsRetry: 'Precisa tentar de novo',
    recognized: 'Reconhecida',
    ready: 'Pronta para digitalizar',
    rotate: 'Girar 90° para a direita',
    cancelRotation: 'Cancelar o giro',
    rotating: 'Girando a imagem…',
    moveEarlier: 'Mover para antes',
    moveEarlierLabel: (page: number) => `Mover a página ${page} para antes`,
    moveLater: 'Mover para depois',
    moveLaterLabel: (page: number) => `Mover a página ${page} para depois`,
    remove: 'Remover página',
    removeLabel: (page: number) => `Remover a página ${page}`,
    addImages: 'Adicionar imagens de páginas',
    finishFirst: 'Conclua esta digitalização antes de adicionar mais páginas.',
    pageError: (page: number, error: string) => `Página ${page}: ${error}`,
    altPage: (page: number) => `Partitura impressa original, página ${page}`,
    alt: 'Partitura impressa original',
    rotated: (degrees: number) =>
      `Girada ${degrees}° para a direita para digitalizar. O arquivo original foi mantido.`,
  },
  files: {
    pageLimit: 'Escolha até 20 imagens de páginas por vez.',
    imagesOrOneFile:
      'Escolha as imagens das páginas juntas, ou abra um único arquivo PDF, MusicXML ou MIDI.',
    fileTypes: 'Escolha um arquivo PNG, JPEG ou PDF de até 10 MB.',
    contentMismatch: 'O conteúdo do arquivo não corresponde à extensão (PNG, JPEG ou PDF).',
  },
  rotation: {
    unreadable: 'Não foi possível girar esta imagem. Tente outro PNG ou JPEG.',
    tooLargeChoose:
      'Esta imagem é grande demais para ser girada aqui (máximo de 16 megapixels). Escolha uma imagem menor. Sua imagem atual não foi alterada.',
    tooLarge:
      'Esta imagem é grande demais para ser girada aqui (máximo de 16 megapixels). Sua imagem atual não foi alterada.',
    originalTooBig: 'Escolha uma imagem de até 10 MB para girar.',
    browserCannot:
      'Este navegador não conseguiu girar a imagem. Sua imagem atual não foi alterada.',
    failed: 'Não foi possível girar esta imagem. Sua imagem atual não foi alterada.',
    resultTooBig:
      'A imagem girada passa de 10 MB. Escolha uma imagem menor. Sua imagem atual não foi alterada.',
  },
  client: {
    busy: 'O PC já está digitalizando. Tente de novo em instantes.',
    workerStatus: (status: number) => `O programa de PC respondeu com o código ${status}.`,
    invalidJob: 'Tarefa de digitalização inválida.',
    updateWorker: 'Atualize o programa de PC para continuar.',
    noJob: 'O programa não devolveu nenhuma tarefa de digitalização.',
  },
  join: {
    refused: (reason: string) =>
      `Estas páginas não podem ser combinadas com segurança: ${reason}. Baixe cada página para corrigi-la em um editor de partituras.`,
    reasons: {
      noPages: 'nenhuma página reconhecida',
      entities: 'entidades XML não são compatíveis',
      notPartwise: 'era esperado MusicXML “partwise”',
      repeats: 'repetições ou saltos precisam de revisão manual',
      transposition:
        'transposição ou atributos especiais de pauta ou de compasso precisam de revisão manual',
      partLayout: 'disposição das partes incompleta',
      partOrder: 'a ordem das partes difere da lista de partes',
      measureCounts: 'as partes têm números diferentes de compassos',
      startingSetup: (page: number) =>
        `a página ${page} precisa de divisões, armadura, fórmula de compasso e claves explícitas no início`,
      staffLayout: 'disposição inicial das pautas incompleta',
      staffChange: 'a disposição das pautas muda dentro de uma página',
      instrumentUndeclared: 'uma referência de instrumento não tem declaração',
      partCounts: 'o número de partes difere',
      layoutsDiffer: 'as disposições de partes ou pautas diferem',
      instrumentsDiffer: 'as disposições de instrumentos diferem',
      duplicateIds: 'identificadores XML duplicados dentro de uma página',
      unresolvedId: 'referência a um identificador XML que não existe',
      spanNumber: 'número de sinal gráfico inválido',
      spanOverflow: 'mais de 16 números próprios da página para um mesmo tipo de sinal de notação',
    },
  },
};
