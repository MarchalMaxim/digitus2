import type { whistle as en } from './en.js';

export const whistle: typeof en = {
  start: 'Siffler un air',
  hint: 'Sifflez ou fredonnez, puis appuyez sur Arrêter.',
  stop: 'Arrêter',
  recording: 'Enregistrement',
  writing: 'Écriture des notes…',
  again: 'Siffler à nouveau',
  denied:
    'Le navigateur a bloqué le microphone. Autorisez-le dans les réglages du site, puis appuyez de nouveau.',
  noMicrophone: 'Aucun microphone trouvé.',
  failed: 'Le microphone n’a pas pu être démarré.',
  noNotes: 'Aucune note entendue. Sifflez un peu plus fort ou plus près du microphone.',
};
