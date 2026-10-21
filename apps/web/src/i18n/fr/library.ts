import { formatNumber, plural } from '../format.js';
import type { Messages } from '../messages.js';

const pieces = (n: number) => plural('fr', n, { one: '# morceau', other: '# morceaux' });

export const library: Messages['library'] = {
  tiers: { easy: 'Facile', medium: 'Moyen', harder: 'Plus difficile', challenging: 'Exigeant' },
  pieces,
  welcome: {
    tagline:
      'Les numéros de doigts pour le piano. Choisissez un morceau, appuyez sur Lire et suivez la note rouge.',
    startWith: (title: string) => `Commencer avec ${title}`,
    continueWith: (title: string) => `Reprendre avec ${title}`,
  },
  pills: {
    level: 'Niveau',
    length: 'Durée',
    lengths: {
      any: 'Toutes durées',
      short: 'Moins de 1\u00a0min',
      medium: '1 à 3\u00a0min',
      long: 'Plus de 3\u00a0min',
    },
  },
  shelves: {
    songs: {
      name: 'Chansons',
      line: 'Mélodies connues, des chansons enfantines au cinéma et aux jeux vidéo.',
      all: (n: number) => `Voir les ${formatNumber('fr', n)} chansons`,
    },
    classical: {
      name: 'Classique',
      line: 'Mozart, Clementi, Czerny et les études qui forment les pianistes.',
      all: (n: number) => `Voir les ${formatNumber('fr', n)} morceaux classiques`,
    },
    folk: {
      name: 'Folklore et chants de Noël',
      line: 'Airs traditionnels, danses, chants de Noël et hymnes.',
      all: (n: number) => `Voir les ${formatNumber('fr', n)} airs traditionnels et chants de Noël`,
    },
    baroque: {
      name: 'Baroque',
      line: 'Bach, Haendel, Scarlatti et d’autres, de 1600 à 1750.',
      all: (n: number) => `Voir les ${formatNumber('fr', n)} morceaux baroques`,
    },
    romantic: {
      name: 'Romantique',
      line: 'Schumann, Chopin, Tchaïkovski et d’autres, de 1820 à 1900.',
      all: (n: number) => `Voir les ${formatNumber('fr', n)} morceaux romantiques`,
    },
    jazz: {
      name: 'Jazz, ragtime et moderne',
      line: 'Les rags de Joplin et la musique écrite depuis 1900.',
      all: (n: number) => `Voir les ${formatNumber('fr', n)} morceaux de jazz, ragtime et moderne`,
    },
  },
  list: {
    allStyles: 'Tous les styles',
    otherPieces: 'Autres morceaux',
    showMore: (n: number) => `Afficher ${formatNumber('fr', n)} de plus`,
    showLast: (n: number) =>
      plural('fr', n, { one: 'Afficher le dernier', other: 'Afficher les # derniers' }),
    allInLevel: (n: number, level: string) => `Voir les ${formatNumber('fr', n)} en ${level}`,
    openPiece: (title: string, composer: string | null) =>
      composer === null ? `Ouvrir ${title}` : `Ouvrir ${title} de ${composer}`,
  },
  search: {
    label: 'Rechercher dans la bibliothèque',
    placeholder: 'Rechercher un morceau ou un compositeur',
    clear: 'Effacer',
    clearLabel: 'Effacer la recherche',
    noMatch: (query: string) => `Aucun morceau ne correspond à «\u00a0${query}\u00a0».`,
    noMatchHint: 'La recherche porte sur les titres, les compositeurs et les recueils.',
  },
  announce: {
    counted: (name: string, n: number) => `${name}\u00a0: ${pieces(n)}`,
    showing: (shown: number, total: number) =>
      `Affichage de ${formatNumber('fr', shown)} sur ${formatNumber('fr', total)}`,
    showingIn: (shown: number, total: number, level: string) =>
      `Affichage de ${formatNumber('fr', shown)} sur ${formatNumber('fr', total)} en ${level}`,
  },
  aboutAndLicences: 'À propos et licences',
  ownFile: {
    open: 'Ouvrir votre propre partition',
    dropTitle: 'Déposez le fichier pour l’ouvrir',
    dropHint: 'MusicXML, MIDI, photo ou PDF',
    notScore:
      'Ce fichier ne semble pas être un fichier MusicXML ou MIDI (.musicxml, .xml, .mxl, .mid ou .midi).',
    oneAtATime: 'Ouvrez un seul fichier MusicXML ou MIDI à la fois.',
    cannotReadFiles: 'Impossible de lire ces fichiers.',
    cannotReadFile: 'Impossible de lire ce fichier.',
  },
  favourites: {
    heading: 'Favoris',
    line: 'Les morceaux que vous avez marqués d’un cœur, les plus récents d’abord.',
    all: (n: number) => `Voir les ${formatNumber('fr', n)} favoris`,
    remove: (title: string, composer: string | null) =>
      composer === null
        ? `Retirer ${title} des favoris`
        : `Retirer ${title} de ${composer} des favoris`,
  },
  myScores: {
    heading: 'Mes partitions',
    saved: 'Enregistrées',
    thisVisitOnly: 'Disponibles pour cette visite seulement',
    saving: 'Enregistrement…',
    open: (name: string) => `Ouvrir ${name} (enregistrée)`,
    removeLabel: (name: string) => `Supprimer ${name} (enregistrée)`,
    remove: 'Supprimer',
    removed: (name: string) => `${name} a été supprimé.`,
    detail: {
      file: 'Fichier de partition',
      recognition: 'Reconnaissance enregistrée',
      draft: 'Brouillon de numérisation',
      corrected: 'Reconnaissance corrigée',
    },
    removeFailed: 'Impossible de supprimer cette partition. Réessayez.',
    removedNotErased:
      'Cette partition a été supprimée pour cette visite, mais le stockage du navigateur n’a pas pu être mis à jour. Elle peut réapparaître après un rechargement.',
    saveFailed: 'Votre partition n’a pas pu être enregistrée. Conservez vos fichiers d’origine.',
    openFailed:
      'Cette partition enregistrée n’a pas pu être ouverte. Choisissez à nouveau votre fichier d’origine.',
  },
  credit: {
    arrangement: 'Arrangement de digitus2, CC0 (domaine public)',
    unnamedTypesetter: 'un graveur inconnu',
    engraving: (by: string, licence: string) =>
      `Gravure de ${by} pour le Mutopia Project, ${licence}`,
    engravingPublicDomain: (by: string) =>
      `Gravure de ${by} pour le Mutopia Project, domaine public`,
  },
  loadFailed:
    'Impossible de charger les informations du morceau. Vérifiez la connexion et réessayez.',
};
