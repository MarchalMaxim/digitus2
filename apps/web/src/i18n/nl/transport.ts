import type { Messages } from '../messages.js';

export const transport: Messages['transport'] = {
  playback: 'Afspeelknoppen',
  play: 'Afspelen',
  pause: 'Pauzeren',
  rewind: 'Terugspoelen',
  tempo: 'Tempo',
  tempoPercent: (n: number) => `${n}%`,
  tempoSpoken: (percent: string, qpm: number) => `${percent}, ${qpm} kwartnoten per minuut`,
  hands: 'Handen',
  handsBoth: 'Beide',
  handsRight: 'Rechts',
  handsLeft: 'Links',
  metronome: 'Metronoom',
  countIn: 'Aftellen',
  loopBars: 'Maten herhalen',
  loopFromBar: 'Herhalen vanaf maat',
  loopToBar: 'Herhalen tot maat',
  loopTo: 'tot',
  loopReversed: 'Het begin van de herhaling moet vóór het einde liggen.',
  samplesFailed:
    'De pianoklanken konden niet worden geladen. Controleer de verbinding en druk opnieuw op Afspelen.',
  playerFailed:
    'De speler kon niet worden geladen. Controleer de verbinding en druk opnieuw op Afspelen.',
};
