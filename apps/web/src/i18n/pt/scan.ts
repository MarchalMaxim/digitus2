import { plural } from '../format.js';
import type { Messages } from '../messages.js';

export const scan: Messages['scan'] = {
  camera: {
    title: 'Fotografe a sua partitura',
    starting: 'A iniciar a câmara…',
    intro:
      'Toque uma vez e depois passe o telemóvel devagar sobre a página. As cinco fotos formam uma única página nítida.',
    step: (n: number, total: number) => `Foto ${n} de ${total}`,
    aim: 'Enquadre a página inteira e depois toque no botão.',
    dark: 'Demasiado escuro. Ligue a lanterna.',
    darkNoLight: 'Demasiado escuro. Vá para um sítio com mais luz.',
    blurry: 'Imagem desfocada. Mantenha o telemóvel imóvel.',
    retryBlurry: 'Ficou desfocada. Não mexa e toque outra vez.',
    retryCapture: 'A foto não ficou. Toque outra vez.',
    sweep: (left: number) =>
      plural('pt', left, {
        one: 'Vá para um sítio novo e pare. Falta 1.',
        other: 'Vá para um sítio novo e pare. Faltam #.',
      }),
    taken: (n: number, total: number) => `Foto ${n} de ${total} tirada.`,
    auto: 'Pare de vez em quando: cada pausa num sítio novo tira uma foto.',
    hold: 'Mantenha o telemóvel imóvel…',
    lost: 'Volte a apontar a câmara para a página.',
    turned: 'O telemóvel rodou. Recomece esta página.',
    moving: 'Mais devagar. A imagem está desfocada.',
    skip: 'Saltar o resto',
    startOver: 'Recomeçar',
    processing: 'A combinar as suas fotografias…',
    review: 'Verifique a sua página',
    blurryResult: 'Esta página pode estar desfocada. Repita-a se as notas forem difíceis de ler.',
    corners: 'Ajuste os cantos da página',
    adjust: 'Ajustar cantos',
    useCorners: 'Usar estes cantos',
    invalidCorners: 'Coloque os quatro cantos por ordem à volta da página.',
    cornerLabel: (n: number) =>
      [
        'Canto superior esquerdo',
        'Canto superior direito',
        'Canto inferior direito',
        'Canto inferior esquerdo',
      ][n - 1] ?? 'Canto da página',
    retake: 'Repetir fotografia',
    keep: 'Guardar página',
    nextPage: 'Fotografar outra página',
    finish: (n: number) => plural('pt', n, { one: 'Usar # página', other: 'Usar # páginas' }),
    cancel: 'Cancelar',
    restart: 'Recomeçar',
    capture: 'Tirar fotografia',
    light: 'Lanterna',
    fallback: 'Usar a câmara do dispositivo',
    denied:
      'O acesso à câmara está bloqueado. Permita-o nas definições do navegador ou use a câmara do dispositivo.',
    insecure: 'Abra esta página com uma ligação segura ou use a câmara do dispositivo.',
    unavailable:
      'Não foi possível iniciar a câmara. Feche outras aplicações de câmara e tente novamente, ou use a câmara do dispositivo.',
    interrupted: 'A câmara parou. Recomece ou use a câmara do dispositivo.',
    processingFailed:
      'Não foi possível preparar esta página. Repita a fotografia ou use a câmara do dispositivo.',
    tooMany: 'Pode usar até 20 páginas. Continue com estas páginas.',
    cornerHint:
      'Arraste cada canto até à borda do papel. Use as teclas de seta para ajustar com precisão.',
    pageCount: (n: number) =>
      plural('pt', n, { one: '# página guardada', other: '# páginas guardadas' }),
    ready: 'Pronto para a página seguinte',
    close: 'Fechar câmara',
  },
  view: {
    back: 'Voltar para a biblioteca',
    experimental: 'Digitalização experimental',
    titleStart: 'Do papel ao piano',
    titleReview: 'Revise o reconhecimento',
    pageImages: (n: number) =>
      plural('pt', n, { one: '# imagem de página', other: '# imagens de página' }),
    advice:
      'PDFs originais e digitalizações planas em alta resolução funcionam melhor. Fotos de livros podem falhar, mesmo bem iluminadas. O resultado abre ao lado do original para revisão.',
    where:
      'O reconhecimento roda no serviço de digitalização do projeto, no Google Cloud (Países Baixos). Sua página é enviada para lá, reconhecida e depois apagada.',
    cancelScan: 'Cancelar digitalização',
    cancelling: 'Cancelando…',
    retryFailed: 'Tentar de novo as páginas com falha',
    scanScore: 'Digitalizar esta partitura',
    scanning:
      'Reconhecendo… Costuma levar menos de um minuto. A primeira digitalização depois de um tempo sem uso demora mais, enquanto o serviço de digitalização é iniciado.',
    scanningPage: (page: number, total: number) =>
      `Página ${page} de ${total} · Reconhecendo… Costuma levar menos de um minuto. A primeira digitalização depois de um tempo sem uso demora mais, enquanto o serviço de digitalização é iniciado.`,
    textModelMissing:
      'O reconhecimento de texto em inglês não está configurado. O texto musical pode estar faltando.',
    help: 'Como funciona a digitalização',
    original: 'Original',
    openPdf: 'Abrir o PDF original',
    openImage: 'Abrir a imagem original',
    preparingPdf: 'Preparando o PDF original…',
    originalAlt: 'Partitura impressa original',
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
      `${error} Corrija as notas aqui, baixe o arquivo bruto para um editor de partituras ou tente outra imagem.`,
    problemInCombined: (error: string) =>
      `${error} Corrija as notas na partitura combinada, baixe o arquivo bruto para um editor de partituras ou tente outra imagem.`,
    problemReadOnly: (error: string) =>
      `${error} Baixe o arquivo bruto para um editor de partituras ou tente outra imagem.`,
    detailsSummary: 'Detalhes do reconhecimento',
    /** The disclosure holding the MusicXML downloads. */
    filesSummary: 'Arquivos para um editor de partituras',
    /** Under Recognition details: the importer's or renderer's own message. */
    technical: (reason: string) => `Motivo técnico: ${reason}`,
    retained:
      'Encontre os originais e os reconhecimentos guardados em Minhas partituras. Guarde seus próprios arquivos originais; o armazenamento do navegador pode ser apagado. O reconhecimento não é garantido como correto; a reprodução pode usar um andamento padrão do app.',
    beamGrouping: 'O agrupamento das barras é deduzido e pode diferir do original.',
    graphicSpanWarning:
      'Ligaduras e outros sinais de notação ficam dentro de cada página digitalizada. Compare as continuações nas bordas das páginas; os pontos finais que faltam não foram reparados.',
    /** The scanner found a piano page read as one staff: shown above the comparison. */
    grandStaffWarning:
      'As pautas não foram unidas num sistema de piano, então as duas mãos são lidas como uma. O dedilhado sairia com as mãos erradas: tente uma foto mais plana e bem iluminada ou o PDF original.',
    /** The scanner read only part of a line of music: shown above the comparison. */
    partlyReadWarning:
      'Uma linha de música foi lida só em parte, então podem faltar ou sobrar compassos. Compare o resultado com o original antes de praticar.',
    unknownWarning: 'O reconhecedor indicou um aviso desconhecido. Confira bem o original.',
    downloadPagesSummary: 'Baixar os arquivos de cada página',
    downloadPage: (page: number) => `Baixar o MusicXML da página ${page}`,
    downloadCombined: 'Baixar o MusicXML combinado',
    downloadRaw: 'Baixar o MusicXML bruto',
    downloadAll: 'Baixar tudo',
    useForFingerings: 'Usar para os dedilhados',
    scanAgain: 'Digitalizar de novo',
  },
  edit: {
    hint: 'Selecione uma nota para corrigi-la.',
    keys: 'Enter seleciona a primeira nota. Esquerda e Direita selecionam a nota anterior ou seguinte, Cima e Baixo mudam a altura (com Shift, uma oitava), Escape fecha o editor.',
    pitch: (step: string, alter: number, octave: number) =>
      `${({ C: 'Dó', D: 'Ré', E: 'Mi', F: 'Fá', G: 'Sol', A: 'Lá', B: 'Si' } as Record<string, string>)[step] ?? step}${alter > 0 ? '♯︎'.repeat(alter) : '♭︎'.repeat(-alter)}${octave}`,
    bar: (bar: string) => `Compasso ${bar}`,
    rightHand: 'mão direita',
    leftHand: 'mão esquerda',
    staff: (staff: number) => `pauta ${staff}`,
    lengths: {
      whole: 'semibreve',
      half: 'mínima',
      quarter: 'semínima',
      eighth: 'colcheia',
      '16th': 'semicolcheia',
      '32nd': 'fusa',
    } as Record<string, string>,
    noteLength: (length: string, dotted: boolean) => `${length}${dotted ? ' pontuada' : ''}`,
    restLength: (length: string, dotted: boolean) =>
      `pausa de ${length}${dotted ? ' pontuada' : ''}`,
    tied: 'ligada',
    describe: (parts: string[]) => parts.join(' · '),
    panelLabel: 'Corrigir a nota selecionada',
    pitchLabel: 'Altura',
    lower: 'Mais grave',
    lowerLabel: 'Descer um grau',
    higher: 'Mais aguda',
    higherLabel: 'Subir um grau',
    flat: 'Bemol',
    natural: 'Bequadro',
    sharp: 'Sustenido',
    lengthLabel: 'Duração',
    lengthButtons: {
      whole: 'Semibreve',
      half: 'Mínima',
      quarter: 'Semínima',
      eighth: 'Colcheia',
      '16th': 'Semicolcheia',
      '32nd': 'Fusa',
    } as Record<string, string>,
    dotted: 'Pontuada',
    tieNext: 'Ligada à próxima',
    tiePrevious: 'Ligada à anterior',
    toLeftHand: 'Passar para a mão esquerda',
    toRightHand: 'Passar para a mão direita',
    remove: 'Remover a nota',
    /** A rest the recognition put where the page has a note. */
    makeNote: 'Transformar em nota',
    previous: 'Nota anterior',
    next: 'Próxima nota',
    done: 'Concluir',
    handBeats: (hand: string, beats: number) =>
      `${hand} ${plural('pt', beats, { one: '# tempo', other: '# tempos' })}`,
    timing: (bar: string, hands: string[], meter?: string) =>
      `${bar}: ${hands.join(', ')}${meter ? `, em ${meter}` : ''}.`,
    corrections: (n: number) => plural('pt', n, { one: '# correção', other: '# correções' }),
    undo: 'Desfazer',
    reset: 'Voltar ao reconhecimento',
    resetDone: 'Todas as correções foram removidas. Desfazer as traz de volta.',
    /** Read out after Undo; `what` is the correction taken back, or empty. */
    undone: (what: string) => (what ? `Desfeito: ${what}.` : 'Desfeito.'),
    listSummary: 'Ver as correções',
    changed: {
      pitch: (where: string, from: string, to: string) => `${where}: ${from} → ${to}`,
      duration: (where: string, pitch: string, from: string, to: string) =>
        `${where}: ${pitch} ${from} → ${to}`,
      tie: (where: string, pitch: string) => `${where}: ${pitch} ligada ao próximo ${pitch}`,
      untie: (where: string, pitch: string) => `${where}: ligadura de ${pitch} removida`,
      hand: (where: string, pitch: string, hand: string) =>
        `${where}: ${pitch} passada para a ${hand}`,
      removed: (where: string, pitch: string) => `${where}: ${pitch} removida`,
      meter: (bar: string, from: string | undefined, to: string) =>
        `A partir do compasso ${bar}: fórmula de compasso ${from ? `${from} → ` : ''}${to}`,
    },
    setMeter: (meter: string, bar: string) => `Usar ${meter} a partir do compasso ${bar}`,
    stale: (kept: number) =>
      `Algumas correções salvas não se aplicam mais a este reconhecimento. As primeiras ${kept} foram mantidas.`,
    problemsSummary: (n: number) =>
      plural('pt', n, { one: '# ponto para conferir', other: '# pontos para conferir' }),
    problems: {
      tieGap: (where: string, pitch: string, gap: string) =>
        `${where}: o ${pitch} ligado termina ${gap} antes de começar o próximo ${pitch}. Confira as durações.`,
      tieEarly: (where: string, pitch: string, gap: string) =>
        `${where}: o ${pitch} ligado avança ${gap} sobre o próximo ${pitch}. Confira as durações.`,
      tieUnmatched: (where: string, pitch: string) =>
        `${where}: uma ligadura em ${pitch} não tem nota correspondente.`,
      barTiming: (timing: string) => `As mãos não coincidem. ${timing}`,
      barLong: (timing: string) =>
        `O compasso é mais longo que a sua fórmula de compasso. ${timing}`,
    },
    gap: (beats: number) => plural('pt', beats, { one: '# tempo', other: '# tempos' }),
    downloadCorrected: 'Baixar MusicXML corrigido',
    correctedSheetLabel: 'o reconhecimento corrigido',
    refused: {
      missing: 'Esta nota não está mais na partitura.',
      rest: 'Uma pausa não tem altura para mudar.',
      range: 'Essa altura está fora da extensão do piano.',
      grace: 'Uma apojatura não ocupa tempo, então sua duração não pode ser mudada aqui.',
      tuplet:
        'A duração de uma nota de tercina ou outra quiáltera não pode ser mudada aqui. Use um editor de partituras.',
      unwritable: 'Esta duração não pode ser escrita nesta partitura.',
      otherHand:
        'Esta mudança moveria notas da outra mão ou voz, por isso não foi feita. Confira o compasso num editor de partituras.',
      noTieTarget: (pitch: { step: string; alter: number; octave: number }) =>
        `Nenhum ${scan.edit.pitch(pitch.step, pitch.alter, pitch.octave)} começa onde esta nota termina, então ela não pode ser ligada. Corrija primeiro as durações.`,
      noTieSource: (pitch: { step: string; alter: number; octave: number }) =>
        `Nenhum ${scan.edit.pitch(pitch.step, pitch.alter, pitch.octave)} termina onde esta nota começa, então ela não pode ser ligada.`,
      tieTaken: 'A próxima nota já está ligada a outra nota.',
      tiedRemove: 'Remova a ligadura desta nota antes de remover a nota.',
      chordLengths: 'As notas do acorde têm durações diferentes. Mude a duração primeiro.',
      oneStaff: 'Esta partitura tem uma só pauta.',
      meter: 'Essa fórmula de compasso não pode ser escrita aqui.',
      noBar: 'Este compasso já não está na partitura.',
      sameMeter: (meter: string) => `O compasso já está em ${meter}.`,
    },
  },
  phone: {
    takePhoto: 'Fotografar uma partitura impressa',
    takeAnother: 'Fotografar outra página',
  },
  errors: {
    notCombinedSaved:
      'As páginas foram reconhecidas, mas a notação delas não pôde ser combinada. Os arquivos de cada página estão disponíveis abaixo.',
    somePagesFailed:
      'Algumas páginas precisam ser digitalizadas de novo. As páginas reconhecidas são mantidas.',
    recognitionFailed: 'O reconhecimento falhou.',
    notationNotShown:
      'Não foi possível mostrar a notação. O motivo técnico está nos detalhes do reconhecimento.',
    noNotes: 'Nenhuma nota tocável foi reconhecida.',
    notUsable:
      'Este reconhecimento ainda não pode ser usado para o dedilhado: algumas notas não se encaixam.',
    offline:
      'Não foi possível acessar o serviço de digitalização. Verifique sua conexão e tente de novo.',
    cancelFailed:
      'Não foi possível confirmar o cancelamento. O serviço de digitalização para sozinho em até três minutos.',
    timedOut: 'O reconhecimento demorou demais. Tente uma página menor e mais nítida.',
    notRecognized:
      'O serviço de digitalização não conseguiu reconhecer uma partitura completa nesta página. Tente o PDF original ou uma imagem mais plana e de maior resolução.',
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
    /** On a touch screen, where pages cannot be dragged. */
    arrangeTouch:
      'Coloque as páginas na ordem de leitura: selecione uma página e mova-a com as setas.',
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
    busy: 'O serviço de digitalização está ocupado com outra partitura. Tente de novo em um minuto.',
    limited: 'Você digitalizou bastante na última hora. Tente de novo mais tarde.',
    serviceStatus: (status: number) =>
      `O serviço de digitalização não conseguiu responder (erro ${status}). Tente de novo mais tarde.`,
    noAnswer: 'O serviço de digitalização não conseguiu responder. Tente de novo mais tarde.',
    noResult: 'O serviço de digitalização não devolveu nenhuma partitura.',
    invalidJob: 'Tarefa de digitalização inválida.',
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
