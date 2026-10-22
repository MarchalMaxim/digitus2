import type { Messages } from '../messages.js';

export const app: Messages['app'] = {
  listFailed:
    'O digitus2 não conseguiu carregar a lista de peças. Verifique a conexão e recarregue a página.',
  openingScan: 'Abrindo a digitalização...',
  fileNotRestorable: 'Abra-a em Minhas partituras, ou escolha o arquivo de novo.',
  unknownPiece: 'Essa peça não está na biblioteca.',
  darkTheme: 'Tema escuro',
  engineFailed: (detail: string) => (detail ? `o motor falhou: ${detail}` : 'o motor falhou'),
  updateReady: 'Uma nova versão está pronta.',
  reload: 'Recarregar',
};
