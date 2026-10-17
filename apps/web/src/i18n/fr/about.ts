import type { Messages } from '../messages.js';
import { formatNumber, plural } from '../format.js';

const NUMBER_WORDS = [
  'Zéro',
  'Une',
  'Deux',
  'Trois',
  'Quatre',
  'Cinq',
  'Six',
  'Sept',
  'Huit',
  'Neuf',
];

const count = (n: number) => NUMBER_WORDS[n] ?? formatNumber('fr', n);

export const about: Messages['about'] = {
  back: 'Retour à la bibliothèque',
  title: 'À propos de digitus2',
  what: {
    heading: 'Ce que c’est',
    body: 'digitus2 écrit les numéros de doigts sur les partitions de piano pour les pianistes débutants et intermédiaires.',
  },
  how: {
    heading: 'Comment les doigtés sont choisis',
    body: (version: string) =>
      'Le moteur évalue chaque doigté possible avec les règles ergonomiques de la littérature ' +
      'sur le doigté au piano (écartements des doigts, passages du pouce, doigts faibles, ' +
      'touches noires, changements de position de la main) et choisit celui qui coûte le moins ' +
      'pour tout le morceau, grâce à une recherche exacte. La taille de votre main change les ' +
      `écartements autorisés. La version du moteur est ${version}.`,
  },
  who: {
    heading: 'Qui l’a créé',
    body:
      'Créé par Claude, le modèle d’IA d’Anthropic, lors d’un développement autonome de ' +
      'plusieurs jours dirigé par Maxim Marchal. À notre connaissance, rien de tel n’existe ' +
      'encore\u00a0: un moteur de doigté vérifié à partir d’annotations d’experts. Le code, les ' +
      'notes de recherche et les résultats de vérification se trouvent dans le [dépôt].',
  },
  licences: {
    heading: 'Licences',
    digitus2: '[digitus2] est un logiciel libre sous licence MIT.',
    verovio:
      'Gravure musicale par [Verovio], LGPL-3.0-or-later, utilisé comme bibliothèque non modifiée.',
    pdfjs: 'Les aperçus PDF utilisent [PDF.js] ([Apache-2.0]).',
    midiFile: 'Les fichiers MIDI sont lus avec [midi-file] (MIT).',
    piano:
      'Son du piano\u00a0: [smplr] (MIT) joue les échantillons du [Splendid Grand Piano] (domaine public).',
  },
  pieces: {
    heading: 'Les morceaux intégrés',
    intro: 'Les morceaux utilisent des éditions du domaine public ou sous Creative Commons.',
    count,
    credit: (shareAlike: number, attribution: number) => {
      const credited = 'mentionnées ici et sur leurs pages de partition.';
      if (shareAlike === 1 && attribution === 0)
        return 'Une gravure est partagée sous CC BY-SA et est mentionnée ici et sur sa page de partition.';
      const start = `${count(shareAlike)} gravures sont partagées sous CC BY-SA et`;
      return attribution === 0
        ? `${start} sont ${credited}`
        : `${start} ${count(attribution).toLowerCase()} sous CC BY\u00a0; toutes sont ${credited}`;
    },
    columns: {
      piece: 'Morceau',
      composer: 'Compositeur',
      engraving: 'Gravure',
      licence: 'Licence',
    },
    arrangement: 'arrangement digitus2',
    unnamedTypesetter: 'Graveur inconnu',
    archive: (n: number) =>
      plural('fr', n, {
        one: '# partition supplémentaire provient',
        other: '# partitions supplémentaires proviennent',
      }) +
      ' de l’archive MuseScore (le jeu de données PDMX). Chacune est dans le domaine public ou ' +
      'sous CC0, selon ce qu’a déclaré la personne qui l’a publiée, et indique sa source et sa licence ' +
      'sur sa page de partition.',
  },
};
