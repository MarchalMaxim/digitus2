import type { Messages } from '../messages.js';

export const app: Messages['app'] = {
  listFailed:
    'digitus2 n’a pas pu charger la liste des morceaux. Vérifiez la connexion et rechargez la page.',
  openingScan: 'Ouverture de la numérisation...',
  fileNotRestorable: 'Ouvrez-la depuis Mes partitions, ou choisissez à nouveau le fichier.',
  darkTheme: 'Thème sombre',
  updateReady: 'Une nouvelle version est prête.',
  reload: 'Recharger',
  engineFailed: (detail: string) =>
    detail ? `le moteur a échoué\u00a0: ${detail}` : 'le moteur a échoué',
};
