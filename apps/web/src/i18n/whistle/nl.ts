import type { whistle as en } from './en.js';

export const whistle: typeof en = {
  start: 'Fluit een melodie',
  hint: 'Fluit of neurie, en druk dan op Stop.',
  stop: 'Stop',
  recording: 'Opname',
  writing: 'De noten worden uitgeschreven…',
  again: 'Opnieuw fluiten',
  denied:
    'De browser heeft de microfoon geblokkeerd. Sta hem toe in de site-instellingen en druk dan opnieuw.',
  noMicrophone: 'Geen microfoon gevonden.',
  failed: 'De microfoon kon niet worden gestart.',
  noNotes: 'Er zijn geen noten gehoord. Fluit iets luider of dichter bij de microfoon.',
};
