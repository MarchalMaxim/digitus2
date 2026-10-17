import { plural } from '../format.js';
import type { Messages } from '../messages.js';

export const scan: Messages['scan'] = {
  view: {
    back: 'Retour à la bibliothèque',
    experimental: 'Numérisation expérimentale',
    titleStart: 'Du papier au piano',
    titleReview: 'Vérifiez la reconnaissance',
    pageImages: (n: number) =>
      plural('fr', n, { one: '# image de page', other: '# images de pages' }),
    advice:
      'Les PDF d’origine et les numérisations à plat en haute résolution donnent les meilleurs résultats. Les photos de livres sont expérimentales et peuvent échouer, même bien éclairées. Le résultat s’ouvre à côté de l’original pour que vous puissiez le vérifier.',
    workerNeeded:
      'Cette option expérimentale nécessite le programme PC sur cet ordinateur. Le localhost d’un téléphone ne peut pas joindre votre PC.',
    connect: 'Se connecter à ce PC',
    connecting: 'Connexion…',
    cancelScan: 'Annuler la numérisation',
    cancelling: 'Annulation…',
    retryFailed: 'Réessayer les pages en échec',
    scanScore: 'Numériser cette partition',
    scanning:
      'Reconnaissance sur ce PC… En général quelques secondes\u00a0; les pages plus longues peuvent prendre quelques minutes.',
    scanningPage: (page: number, total: number) =>
      `Page ${page} sur ${total} · Reconnaissance sur ce PC… En général quelques secondes\u00a0; les pages plus longues peuvent prendre quelques minutes.`,
    connected: 'PC connecté.',
    textModelMissing:
      'La reconnaissance du texte anglais n’est pas configurée. Le texte musical peut manquer. Voir la configuration ci-dessous.',
    original: 'Original',
    openPdf: 'Ouvrir le PDF d’origine',
    openImage: 'Ouvrir l’image d’origine',
    preparingPdf: 'Préparation du PDF d’origine…',
    originalAlt: 'Partition imprimée d’origine',
  },
  setup: {
    summary: 'Configurer le programme PC',
    install:
      'Sur le PC qui exécute ce navigateur, ouvrez le dossier du projet digitus2. Installez une seule fois les outils de reconnaissance des photos et des PDF, puis lancez le programme quand vous en avez besoin.',
    keepOpen:
      'Laissez ce terminal ouvert. Autorisez la connexion locale du navigateur après avoir appuyé sur «\u00a0Se connecter à ce PC\u00a0». Pour arrêter le traitement, fermez le programme.',
    help: 'Configuration et dépannage',
  },
  review: {
    caveat:
      'La reconnaissance peut contenir des erreurs de notes, de rythmes, de liaisons ou de mains. Le texte et le tempo peuvent être incomplets. Aucun doigté n’a encore été ajouté.',
    recognized: 'Notation reconnue',
    sheetLabel: 'reconnaissance brute de la numérisation',
    viewLabel: 'Affichage de la reconnaissance',
    pageRecognition: 'Reconnaissance par page',
    combinedScore: 'Partition combinée',
    pageShown: (page: number) => `Reconnaissance de la page ${page}`,
    allPages: 'Toutes les pages dans l’ordre de lecture',
    preparing: 'Préparation de la notation reconnue…',
    problem: (error: string) =>
      `${error} Téléchargez le fichier brut pour le corriger dans un éditeur de partitions, ou essayez une autre image.`,
    detailsSummary: 'Détails de la reconnaissance',
    retained:
      'Retrouvez les originaux et les reconnaissances conservés dans Mes partitions. Gardez vos fichiers d’origine\u00a0; le stockage du navigateur peut être effacé. La reconnaissance n’est pas garantie exacte\u00a0; la lecture peut utiliser un tempo par défaut de l’application.',
    beamGrouping: 'Le regroupement par ligatures est déduit et peut différer de l’original.',
    graphicSpanWarning:
      'Les liaisons et autres signes de notation restent limités à chaque page numérisée. Comparez les suites en bord de page\u00a0; les extrémités manquantes n’ont pas été réparées.',
    unknownWarning:
      'Le programme de reconnaissance a signalé un avertissement inconnu. Vérifiez bien l’original.',
    downloadPagesSummary: 'Télécharger les fichiers de chaque page',
    downloadPage: (page: number) => `Télécharger le MusicXML de la page ${page}`,
    downloadCombined: 'Télécharger le MusicXML combiné',
    downloadRaw: 'Télécharger le MusicXML brut',
    useForFingerings: 'Utiliser pour le doigté',
    scanAgain: 'Numériser à nouveau',
  },
  errors: {
    notCombinedSaved:
      'Les pages ont été reconnues, mais leur notation n’a pas pu être combinée. Les fichiers de chaque page sont disponibles ci-dessous.',
    notCombined: (reason: string) =>
      `Les pages ont été reconnues, mais leur notation n’a pas pu être combinée. ${reason}`,
    somePagesFailed:
      'Certaines pages doivent être numérisées à nouveau. Les pages reconnues sont conservées.',
    recognitionFailed: 'La reconnaissance a échoué.',
    notationNotShown: (reason: string) => `La notation n’a pas pu être affichée\u00a0: ${reason}`,
    noNotes: 'Aucune note jouable n’a été reconnue.',
    notUsable: (reason: string) =>
      `Cette reconnaissance ne peut pas servir pour le doigté\u00a0: ${reason}`,
    connectFailed:
      'Impossible de se connecter à ce PC. Lancez le programme, puis autorisez la connexion locale de ce site quand votre navigateur la demande. Si vous l’avez refusée, modifiez l’autorisation de réseau local de ce site et réessayez.',
    cancelFailed:
      'Impossible de confirmer l’annulation. Fermez le terminal du programme pour arrêter le traitement.',
    timedOut: 'La reconnaissance a pris trop de temps. Essayez une page plus petite et plus nette.',
    notRecognized:
      'Le PC n’a pas pu reconnaître une partition complète sur cette page. Essayez le PDF d’origine ou une image plus plate et de meilleure résolution.',
  },
  pager: {
    previous: 'Précédente',
    next: 'Suivante',
    previousLabel: 'Page d’origine précédente',
    nextLabel: 'Page d’origine suivante',
    pageOf: (page: number, total: number) => `Page ${page} sur ${total}`,
    navLabel: 'Navigation dans les pages d’origine',
  },
  preview: {
    unavailable: (reason: string) => `Aperçu indisponible\u00a0: ${reason}`,
    openToCompare: 'Ouvrez le PDF d’origine ci-dessus pour comparer toutes les pages.',
    canvasMissing: 'Le canevas n’est pas disponible.',
    pageLabel: (page: number) => `PDF d’origine, page ${page}`,
  },
  pages: {
    arrange:
      'Placez les pages dans l’ordre de lecture. Faites glisser une miniature ou sélectionnez une page pour la déplacer.',
    originalCount: (n: number) =>
      plural('fr', n, {
        one: '# page d’origine, dans l’ordre de lecture.',
        other: '# pages d’origine, dans l’ordre de lecture.',
      }),
    listLabel: 'Pages de la partition',
    select: (page: number, name: string) => `Sélectionner la page ${page}\u00a0: ${name}`,
    needsRetry: 'À réessayer',
    recognized: 'Reconnue',
    ready: 'Prête à numériser',
    rotate: 'Pivoter de 90° vers la droite',
    cancelRotation: 'Annuler la rotation',
    rotating: 'Rotation de l’image…',
    moveEarlier: 'Placer plus tôt',
    moveEarlierLabel: (page: number) => `Placer la page ${page} plus tôt`,
    moveLater: 'Placer plus tard',
    moveLaterLabel: (page: number) => `Placer la page ${page} plus tard`,
    remove: 'Retirer la page',
    removeLabel: (page: number) => `Retirer la page ${page}`,
    addImages: 'Ajouter des images de pages',
    finishFirst: 'Terminez cette numérisation avant d’ajouter d’autres pages.',
    pageError: (page: number, error: string) => `Page ${page}\u00a0: ${error}`,
    altPage: (page: number) => `Partition imprimée d’origine, page ${page}`,
    alt: 'Partition imprimée d’origine',
    rotated: (degrees: number) =>
      `Pivotée de ${degrees}° vers la droite pour la numérisation. Le fichier d’origine est conservé.`,
  },
  files: {
    pageLimit: 'Choisissez jusqu’à 20 images de pages à la fois.',
    imagesOrOneFile:
      'Choisissez ensemble des images de pages, ou ouvrez un seul fichier PDF, MusicXML ou MIDI.',
    fileTypes: 'Choisissez un fichier PNG, JPEG ou PDF de 10\u00a0Mo au maximum.',
    contentMismatch: 'Le contenu du fichier ne correspond pas à son extension (PNG, JPEG ou PDF).',
  },
  rotation: {
    unreadable: 'Cette image n’a pas pu être pivotée. Essayez un autre fichier PNG ou JPEG.',
    tooLargeChoose:
      'Cette image est trop grande pour être pivotée ici (16\u00a0mégapixels au maximum). Choisissez une image plus petite. Votre image actuelle reste inchangée.',
    tooLarge:
      'Cette image est trop grande pour être pivotée ici (16\u00a0mégapixels au maximum). Votre image actuelle reste inchangée.',
    originalTooBig: 'Choisissez une image de 10\u00a0Mo au maximum à pivoter.',
    browserCannot:
      'Ce navigateur n’a pas pu pivoter l’image. Votre image actuelle reste inchangée.',
    failed: 'Cette image n’a pas pu être pivotée. Votre image actuelle reste inchangée.',
    resultTooBig:
      'L’image pivotée dépasse 10\u00a0Mo. Choisissez une image plus petite. Votre image actuelle reste inchangée.',
  },
  client: {
    busy: 'Le PC est déjà en train de numériser. Réessayez dans un instant.',
    workerStatus: (status: number) => `Le programme PC a répondu avec le code ${status}.`,
    invalidJob: 'Tâche de numérisation non valide.',
    updateWorker: 'Mettez à jour le programme PC pour continuer.',
    noJob: 'Le programme n’a pas renvoyé de tâche de numérisation.',
  },
  join: {
    refused: (reason: string) =>
      `Ces pages ne peuvent pas être combinées en toute sécurité\u00a0: ${reason}. Téléchargez chaque page pour la corriger dans un éditeur de partitions.`,
    reasons: {
      noPages: 'aucune page reconnue',
      entities: 'les entités XML ne sont pas prises en charge',
      notPartwise: 'MusicXML «\u00a0partwise\u00a0» attendu',
      repeats: 'les reprises ou les sauts demandent une vérification manuelle',
      transposition:
        'la transposition ou des attributs particuliers de portée ou de mesure demandent une vérification manuelle',
      partLayout: 'disposition des parties incomplète',
      partOrder: 'l’ordre des parties diffère de la liste des parties',
      measureCounts: 'les parties n’ont pas le même nombre de mesures',
      startingSetup: (page: number) =>
        `la page ${page} a besoin de divisions, d’une armure, d’un chiffrage et de clés explicites au début`,
      staffLayout: 'disposition initiale des portées incomplète',
      staffChange: 'la disposition des portées change à l’intérieur d’une page',
      instrumentUndeclared: 'une référence d’instrument n’a pas de déclaration',
      partCounts: 'le nombre de parties diffère',
      layoutsDiffer: 'les dispositions des parties ou des portées diffèrent',
      instrumentsDiffer: 'les dispositions des instruments diffèrent',
      duplicateIds: 'identifiants XML en double dans une même page',
      unresolvedId: 'référence à un identifiant XML introuvable',
      spanNumber: 'numéro de signe graphique non valide',
      spanOverflow: 'plus de 16 numéros propres à la page pour un même type de signe de notation',
    },
  },
};
