import type { Messages } from '../messages.js';

export const transport: Messages['transport'] = {
  playback: 'Lecture',
  play: 'Lire',
  pause: 'Pause',
  rewind: 'Rembobiner',
  tempo: 'Tempo',
  tempoPercent: (n: number) => `${n}\u00a0%`,
  tempoSpoken: (percent: string, qpm: number) => `${percent}, ${qpm} noires par minute`,
  hands: 'Mains',
  handsBoth: 'Les deux',
  handsRight: 'Droite',
  handsLeft: 'Gauche',
  metronome: 'Métronome',
  countIn: 'Décompte',
  loopBars: 'Boucle de mesures',
  loopFromBar: 'Boucle à partir de la mesure',
  loopToBar: 'Boucle jusqu’à la mesure',
  loopTo: 'à',
  loopReversed: 'Le début de la boucle doit précéder la fin.',
  samplesFailed:
    'Les sons du piano n’ont pas pu être chargés. Vérifiez la connexion et appuyez de nouveau sur Lire.',
  playerFailed:
    'Le lecteur n’a pas pu être chargé. Vérifiez la connexion et appuyez de nouveau sur Lire.',
};
