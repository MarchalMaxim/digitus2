import type { Messages } from '../messages.js';

export const transport: Messages['transport'] = {
  playback: 'Reproducción',
  play: 'Reproducir',
  pause: 'Pausa',
  rewind: 'Rebobinar',
  tempo: 'Tempo',
  tempoPercent: (n: number) => `${n}\u00a0%`,
  tempoSpoken: (percent: string, qpm: number) => `${percent}, ${qpm} negras por minuto`,
  hands: 'Manos',
  handsBoth: 'Ambas',
  handsRight: 'Derecha',
  handsLeft: 'Izquierda',
  metronome: 'Metrónomo',
  countIn: 'Cuenta previa',
  loopBars: 'Bucle de compases',
  loopFromBar: 'Bucle desde el compás',
  loopToBar: 'Bucle hasta el compás',
  loopTo: 'a',
  loopReversed: 'El inicio del bucle debe ir antes del final.',
  samplesFailed:
    'No se pudieron cargar los sonidos del piano. Comprueba la conexión y pulsa Reproducir otra vez.',
  playerFailed:
    'No se pudo cargar el reproductor. Comprueba la conexión y pulsa Reproducir otra vez.',
};
