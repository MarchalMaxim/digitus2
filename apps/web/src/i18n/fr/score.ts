import { formatNumber, plural } from '../format.js';
import type { Messages } from '../messages.js';

const notes = (n: number) => plural('fr', n, { one: '# note', other: '# notes' });

export const score: Messages['score'] = {
  fingerLegend:
    'Numéros de doigts\u00a0: 1 est le pouce et 5 l’auriculaire, aux deux mains. La portée du haut est la main droite, celle du bas la main gauche.',
  noteLetters: ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'],
  header: {
    back: 'Retour à la bibliothèque',
    favourite: 'Favori',
  },
  sheet: {
    label: (title: string) => `Partition de ${title}`,
  },
  keyboard: {
    label: 'Clavier',
    hands: { L: 'G', R: 'D' },
  },
  view: {
    status: {
      loading: 'Chargement de la partition…',
      fingering: 'Calcul du doigté…',
      rendering: 'Préparation de la partition…',
    },
    loadingPiano: 'Chargement du piano…',
    editorialShown: 'Affichage du doigté de l’éditeur',
    noNotesLeft: 'Ce morceau n’a pas de notes pour la main gauche.',
    noNotesRight: 'Ce morceau n’a pas de notes pour la main droite.',
    noNotes: 'Ce morceau n’a aucune note à jouer.',
    practice: 'S’exercer',
    scanSource: 'Source du scan et reconnaissance',
    couldNotOpenFile: (name: string) =>
      `Impossible d’ouvrir ${name}. Ce fichier n’a pas pu être lu comme une partition. digitus2 ouvre les fichiers MusicXML et MIDI (.musicxml, .xml, .mxl, .mid ou .midi).`,
    couldNotOpenPiece: (name: string) =>
      `Impossible d’ouvrir ${name}. Un problème est survenu pendant la préparation de ce morceau. Veuillez réessayer.`,
    details: (error: string) => `Détails\u00a0: ${error}`,
  },
  side: {
    label: 'Morceau et doigté',
    facts: {
      level: 'Niveau',
      key: 'Tonalité',
      time: 'Chiffrage',
      length: 'Durée',
      bars: 'Mesures',
    },
    keyName: (tonic: string, accidental: '' | '#' | 'b', mode: 'major' | 'minor') =>
      `${tonic}${accidental === '#' ? ' dièse' : accidental === 'b' ? ' bémol' : ''} ${mode === 'major' ? 'majeur' : 'mineur'}`,
    handSize: {
      label: 'Taille de la main',
      large: 'Grande',
      medium: 'Moyenne',
      small: 'Petite',
      child: 'Enfant',
      help: 'La taille de la main change les écarts que le doigté autorise. Choisissez enfant ou petite pour de petites mains.',
    },
    showEditorial: 'Afficher le doigté de l’éditeur',
    exportButton: 'Exporter en MusicXML',
    print: 'Imprimer',
    exportFailed: (reason: string) => `Impossible d’exporter la partition\u00a0: ${reason}`,
    printPrepareFirst:
      'Annulez cette fenêtre et utilisez le bouton Imprimer de la partition. Il prépare la musique pour le papier.',
    printFailed: (reason: string) => `Impossible d’imprimer la partition\u00a0: ${reason}`,
    printHeadingTooLong:
      'Le titre et les crédits sont trop longs pour tenir sur une page imprimée.',
    details: 'Détails',
    timings: (solveMs: number, renderMs: number) =>
      `Doigté calculé en ${solveMs}\u00a0ms · mise en page en ${renderMs}\u00a0ms`,
  },
  midi: {
    label: 'Import MIDI',
    splitLabel: 'Séparation des mains',
    automatic: 'Automatique',
    splitHelp: 'À partir de la note choisie, les touches vers l’aigu vont à la main droite.',
    grids: {
      sixteenth: 'une grille de doubles croches',
      sixteenthTriplets: 'une grille de doubles croches avec triolets',
      thirtySecond: 'une grille de triples croches',
      thirtySecondTriplets: 'une grille de triples croches avec triolets',
    },
    importLine: (grid: string, movedPercent: number) =>
      `Importé depuis MIDI\u00a0: notes quantifiées sur ${grid}\u00a0; ${formatNumber('fr', movedPercent)}\u00a0% déplacées de plus d’une quadruple croche`,
    handCounts: (right: number, left: number) =>
      `Main droite\u00a0: ${notes(right)} · main gauche\u00a0: ${notes(left)}`,
  },
  doc: {
    fetchFailed: (status: number) =>
      `le fichier de la partition n’a pas pu être récupéré (HTTP ${status})`,
    noPiece: (slug: string) => `aucun morceau ne s’appelle «\u00a0${slug}\u00a0»`,
    layoutFailed: 'la partition n’a pas pu être mise en page, veuillez réessayer',
  },
};
