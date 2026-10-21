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
      'Les PDF d’origine et les numérisations à plat en haute résolution donnent les meilleurs résultats. Les photos de livres peuvent échouer, même bien éclairées. Le résultat s’ouvre à côté de l’original pour que vous puissiez le vérifier.',
    where:
      'La reconnaissance se fait sur le service de numérisation du projet, sur Google Cloud (Pays-Bas). Votre page y est envoyée, reconnue, puis supprimée.',
    cancelScan: 'Annuler la numérisation',
    cancelling: 'Annulation…',
    retryFailed: 'Réessayer les pages en échec',
    scanScore: 'Numériser cette partition',
    scanning:
      'Reconnaissance… En général moins d’une minute. La première numérisation après une période d’inactivité prend plus longtemps, car le service de numérisation doit démarrer.',
    scanningPage: (page: number, total: number) =>
      `Page ${page} sur ${total} · Reconnaissance… En général moins d’une minute. La première numérisation après une période d’inactivité prend plus longtemps, car le service de numérisation doit démarrer.`,
    textModelMissing:
      'La reconnaissance du texte anglais n’est pas configurée. Le texte musical peut manquer.',
    help: 'Comment fonctionne la numérisation',
    original: 'Original',
    openPdf: 'Ouvrir le PDF d’origine',
    openImage: 'Ouvrir l’image d’origine',
    preparingPdf: 'Préparation du PDF d’origine…',
    originalAlt: 'Partition imprimée d’origine',
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
      `${error} Corrigez les notes ici, téléchargez le fichier brut pour un éditeur de partitions ou essayez une autre image.`,
    problemInCombined: (error: string) =>
      `${error} Corrigez les notes dans la partition combinée, téléchargez le fichier brut pour un éditeur de partitions ou essayez une autre image.`,
    problemReadOnly: (error: string) =>
      `${error} Téléchargez le fichier brut pour un éditeur de partitions ou essayez une autre image.`,
    detailsSummary: 'Détails de la reconnaissance',
    /** The disclosure holding the MusicXML downloads. */
    filesSummary: 'Fichiers pour un éditeur de partitions',
    /** Under Recognition details: the importer's or renderer's own message. */
    technical: (reason: string) => `Raison technique\u00a0: ${reason}`,
    retained:
      'Retrouvez les originaux et les reconnaissances conservés dans Mes partitions. Gardez vos fichiers d’origine\u00a0; le stockage du navigateur peut être effacé. La reconnaissance n’est pas garantie exacte\u00a0; la lecture peut utiliser un tempo par défaut de l’application.',
    beamGrouping: 'Le regroupement par ligatures est déduit et peut différer de l’original.',
    graphicSpanWarning:
      'Les liaisons et autres signes de notation restent limités à chaque page numérisée. Comparez les suites en bord de page\u00a0; les extrémités manquantes n’ont pas été réparées.',
    /** The scanner found a piano page read as one staff: shown above the comparison. */
    grandStaffWarning:
      'Les portées n’ont pas été réunies en système de piano : les deux mains sont lues comme une seule. Le doigté aurait de mauvaises mains : essayez une photo plus plate et bien éclairée, ou le PDF d’origine.',
    /** The scanner read only part of a line of music: shown above the comparison. */
    partlyReadWarning:
      'Une ligne de musique n’a été lue qu’en partie, donc des mesures peuvent manquer ou être en trop. Comparez le résultat avec l’original avant de vous exercer.',
    unknownWarning:
      'Le programme de reconnaissance a signalé un avertissement inconnu. Vérifiez bien l’original.',
    downloadPagesSummary: 'Télécharger les fichiers de chaque page',
    downloadPage: (page: number) => `Télécharger le MusicXML de la page ${page}`,
    downloadCombined: 'Télécharger le MusicXML combiné',
    downloadRaw: 'Télécharger le MusicXML brut',
    useForFingerings: 'Utiliser pour le doigté',
    scanAgain: 'Numériser à nouveau',
  },
  edit: {
    hint: 'Sélectionnez une note pour la corriger.',
    keys: 'Entrée sélectionne la première note. Gauche et Droite sélectionnent la note précédente ou suivante, Haut et Bas changent sa hauteur (avec Maj, d’une octave), Échap ferme l’éditeur.',
    pitch: (step: string, alter: number, octave: number) =>
      `${({ C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' } as Record<string, string>)[step] ?? step}${alter > 0 ? '♯︎'.repeat(alter) : '♭︎'.repeat(-alter)}${octave}`,
    bar: (bar: string) => `Mesure ${bar}`,
    rightHand: 'main droite',
    leftHand: 'main gauche',
    staff: (staff: number) => `portée ${staff}`,
    lengths: {
      whole: 'ronde',
      half: 'blanche',
      quarter: 'noire',
      eighth: 'croche',
      '16th': 'double croche',
      '32nd': 'triple croche',
    } as Record<string, string>,
    noteLength: (length: string, dotted: boolean) => `${length}${dotted ? ' pointée' : ''}`,
    restLength: (length: string, dotted: boolean) =>
      `silence (${length}${dotted ? ' pointée' : ''})`,
    tied: 'liée',
    describe: (parts: string[]) => parts.join(' · '),
    panelLabel: 'Corriger la note sélectionnée',
    pitchLabel: 'Hauteur',
    lower: 'Plus bas',
    lowerLabel: 'Descendre d’un degré',
    higher: 'Plus haut',
    higherLabel: 'Monter d’un degré',
    flat: 'Bémol',
    natural: 'Bécarre',
    sharp: 'Dièse',
    lengthLabel: 'Durée',
    lengthButtons: {
      whole: 'Ronde',
      half: 'Blanche',
      quarter: 'Noire',
      eighth: 'Croche',
      '16th': 'Double',
      '32nd': 'Triple',
    } as Record<string, string>,
    dotted: 'Pointée',
    tieNext: 'Liée à la note suivante',
    tiePrevious: 'Liée à la note précédente',
    toLeftHand: 'Passer à la main gauche',
    toRightHand: 'Passer à la main droite',
    remove: 'Supprimer la note',
    /** A rest the recognition put where the page has a note. */
    makeNote: 'En faire une note',
    previous: 'Note précédente',
    next: 'Note suivante',
    done: 'Terminé',
    handBeats: (hand: string, beats: number) =>
      `${hand} ${plural('fr', beats, { one: '# temps', other: '# temps' })}`,
    timing: (bar: string, hands: string[], meter?: string) =>
      `${bar}\u00a0: ${hands.join(', ')}${meter ? `, en ${meter}` : ''}.`,
    corrections: (n: number) => plural('fr', n, { one: '# correction', other: '# corrections' }),
    undo: 'Annuler',
    reset: 'Revenir à la reconnaissance',
    resetDone: 'Toutes les corrections sont retirées. Annuler les rétablit.',
    /** Read out after Undo; `what` is the correction taken back, or empty. */
    undone: (what: string) => (what ? `Annulé\u00a0: ${what}.` : 'Annulé.'),
    listSummary: 'Voir les corrections',
    changed: {
      pitch: (where: string, from: string, to: string) => `${where}\u00a0: ${from} → ${to}`,
      duration: (where: string, pitch: string, from: string, to: string) =>
        `${where}\u00a0: ${pitch} ${from} → ${to}`,
      tie: (where: string, pitch: string) => `${where}\u00a0: ${pitch} liée au ${pitch} suivant`,
      untie: (where: string, pitch: string) => `${where}\u00a0: liaison de ${pitch} retirée`,
      hand: (where: string, pitch: string, hand: string) =>
        `${where}\u00a0: ${pitch} passée à la ${hand}`,
      removed: (where: string, pitch: string) => `${where}\u00a0: ${pitch} supprimée`,
      meter: (bar: string, from: string | undefined, to: string) =>
        `À partir de la mesure ${bar}\u00a0: chiffrage ${from ? `${from} → ` : ''}${to}`,
    },
    setMeter: (meter: string, bar: string) => `Passer en ${meter} à partir de la mesure ${bar}`,
    stale: (kept: number) =>
      `Certaines corrections enregistrées ne s’appliquent plus à cette reconnaissance. Les ${kept} premières sont conservées.`,
    problemsSummary: (n: number) =>
      plural('fr', n, { one: '# endroit à vérifier', other: '# endroits à vérifier' }),
    problems: {
      tieGap: (where: string, pitch: string, gap: string) =>
        `${where}\u00a0: le ${pitch} lié finit ${gap} avant le début du ${pitch} suivant. Vérifiez les durées.`,
      tieEarly: (where: string, pitch: string, gap: string) =>
        `${where}\u00a0: le ${pitch} lié déborde de ${gap} sur le ${pitch} suivant. Vérifiez les durées.`,
      tieUnmatched: (where: string, pitch: string) =>
        `${where}\u00a0: une liaison sur ${pitch} n’a pas de note correspondante.`,
      barTiming: (timing: string) => `Les mains ne concordent pas. ${timing}`,
      barLong: (timing: string) => `La mesure est plus longue que son chiffrage. ${timing}`,
    },
    gap: (beats: number) => plural('fr', beats, { one: '# temps', other: '# temps' }),
    downloadCorrected: 'Télécharger le MusicXML corrigé',
    correctedSheetLabel: 'la reconnaissance corrigée',
    refused: {
      missing: 'Cette note n’est plus dans la partition.',
      rest: 'Un silence n’a pas de hauteur à changer.',
      range: 'Cette hauteur sort de l’étendue du piano.',
      grace: 'Une appoggiature ne prend pas de temps\u00a0; sa durée ne peut pas être changée ici.',
      tuplet:
        'La durée d’une note de triolet ou d’un autre groupe irrégulier ne peut pas être changée ici. Utilisez un éditeur de partitions.',
      unwritable: 'Cette durée ne peut pas être écrite dans cette partition.',
      otherHand:
        'Ce changement déplacerait des notes de l’autre main ou voix\u00a0; il n’a pas été fait. Vérifiez la mesure dans un éditeur de partitions.',
      noTieTarget: (pitch: { step: string; alter: number; octave: number }) =>
        `Aucun ${scan.edit.pitch(pitch.step, pitch.alter, pitch.octave)} ne commence là où cette note finit\u00a0; elle ne peut pas être liée. Corrigez d’abord les durées.`,
      noTieSource: (pitch: { step: string; alter: number; octave: number }) =>
        `Aucun ${scan.edit.pitch(pitch.step, pitch.alter, pitch.octave)} ne finit là où cette note commence\u00a0; elle ne peut pas être liée.`,
      tieTaken: 'La note suivante est déjà liée à une autre note.',
      tiedRemove: 'Retirez la liaison de cette note avant de la supprimer.',
      chordLengths: 'Les notes de l’accord ont des durées différentes. Changez d’abord la durée.',
      oneStaff: 'Cette partition n’a qu’une portée.',
      meter: 'Ce chiffrage ne peut pas être écrit ici.',
      noBar: 'Cette mesure n’est plus dans la partition.',
      sameMeter: (meter: string) => `La mesure est déjà en ${meter}.`,
    },
  },
  phone: {
    takePhoto: 'Prendre une photo',
    takeAnother: 'Prendre une autre photo',
  },
  errors: {
    notCombinedSaved:
      'Les pages ont été reconnues, mais leur notation n’a pas pu être combinée. Les fichiers de chaque page sont disponibles ci-dessous.',
    somePagesFailed:
      'Certaines pages doivent être numérisées à nouveau. Les pages reconnues sont conservées.',
    recognitionFailed: 'La reconnaissance a échoué.',
    notationNotShown:
      'La notation n’a pas pu être affichée. La raison technique figure dans les détails de la reconnaissance.',
    noNotes: 'Aucune note jouable n’a été reconnue.',
    notUsable:
      'Cette reconnaissance ne peut pas encore servir au doigté\u00a0: certaines de ses notes ne s’accordent pas.',
    offline:
      'Impossible de joindre le service de numérisation. Vérifiez votre connexion et réessayez.',
    cancelFailed:
      'Impossible de confirmer l’annulation. Le service de numérisation s’arrête de lui-même dans les trois minutes.',
    timedOut: 'La reconnaissance a pris trop de temps. Essayez une page plus petite et plus nette.',
    notRecognized:
      'Le service de numérisation n’a pas pu reconnaître une partition complète sur cette page. Essayez le PDF d’origine ou une image plus plate et de meilleure résolution.',
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
    /** On a touch screen, where pages cannot be dragged. */
    arrangeTouch:
      'Mettez les pages dans l’ordre de lecture\u00a0: sélectionnez une page, puis déplacez-la avec les flèches.',
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
    busy: 'Le service de numérisation traite une autre partition. Réessayez dans une minute.',
    limited: 'Vous avez beaucoup numérisé au cours de la dernière heure. Réessayez plus tard.',
    serviceStatus: (status: number) =>
      `Le service de numérisation n’a pas pu répondre (erreur ${status}). Réessayez plus tard.`,
    noAnswer: 'Le service de numérisation n’a pas pu répondre. Réessayez plus tard.',
    noResult: 'Le service de numérisation n’a renvoyé aucune partition.',
    invalidJob: 'Tâche de numérisation non valide.',
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
