import type { Messages } from '../messages.js';

export const transport: Messages['transport'] = {
  playback: 'Reprodução',
  play: 'Tocar',
  pause: 'Pausar',
  rewind: 'Voltar ao início',
  tempo: 'Andamento',
  tempoPercent: (n: number) => `${n}%`,
  tempoSpoken: (percent: string, qpm: number) => `${percent}, ${qpm} semínimas por minuto`,
  hands: 'Mãos',
  handsBoth: 'Ambas',
  handsRight: 'Direita',
  handsLeft: 'Esquerda',
  metronome: 'Metrônomo',
  countIn: 'Contagem inicial',
  loopBars: 'Repetir compassos',
  loopFromBar: 'Repetir a partir do compasso',
  loopToBar: 'Repetir até o compasso',
  loopTo: 'até',
  loopReversed: 'O início da repetição deve vir antes do fim.',
  samplesFailed:
    'Não foi possível carregar os sons do piano. Verifique a conexão e toque em Tocar novamente.',
  playerFailed:
    'Não foi possível carregar o player. Verifique a conexão e toque em Tocar novamente.',
};
