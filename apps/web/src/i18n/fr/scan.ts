import { formatList, plural } from '../format.js';
import type { Messages } from '../messages.js';

export const scan: Messages['scan'] = {
  camera: {
    title: 'Photographiez votre partition',
    starting: 'Démarrage de l’appareil photo…',
    intro:
      'Appuyez une fois, puis passez lentement le téléphone sur la page. Les cinq photos forment une seule page nette.',
    step: (n: number, total: number) => `Photo ${n} sur ${total}`,
    aim: 'Cadrez toute la page, puis appuyez sur le bouton.',
    dark: 'Trop sombre. Allumez la lampe torche.',
    darkNoLight: 'Trop sombre. Allez dans un endroit plus éclairé.',
    blurry: 'Flou. Tenez le téléphone immobile.',
    retryBlurry: 'Flou. Ne bougez plus et appuyez à nouveau.',
    retryCapture: 'La photo n’a pas été prise. Appuyez à nouveau.',
    sweep: (left: number) =>
      plural('fr', left, {
        one: 'Allez à un nouvel endroit et arrêtez-vous. Encore 1.',
        other: 'Allez à un nouvel endroit et arrêtez-vous. Encore #.',
      }),
    taken: (n: number, total: number) => `Photo ${n} sur ${total} prise.`,
    auto: 'Arrêtez-vous de temps en temps : chaque pause à un nouvel endroit prend une photo.',
    hold: 'Ne bougez plus…',
    lost: 'Pointez de nouveau l’appareil photo vers la page.',
    turned: 'Le téléphone a pivoté. Recommencez cette page.',
    moving: 'Plus lentement. L’image est floue.',
    skip: 'Passer le reste',
    startOver: 'Recommencer',
    processing: 'Assemblage de vos photos…',
    review: 'Vérifiez votre page',
    blurryResult:
      'Cette page est peut-être floue. Reprenez-la si les notes sont difficiles à lire.',
    corners: 'Ajustez les coins de la page',
    adjust: 'Ajuster les coins',
    useCorners: 'Utiliser ces coins',
    invalidCorners: 'Placez les quatre coins dans l’ordre autour de la page.',
    cornerLabel: (n: number) =>
      [
        'Coin supérieur gauche',
        'Coin supérieur droit',
        'Coin inférieur droit',
        'Coin inférieur gauche',
      ][n - 1] ?? 'Coin de la page',
    retake: 'Reprendre',
    keep: 'Garder la page',
    nextPage: 'Photographier une autre page',
    finish: (n: number) => plural('fr', n, { one: 'Utiliser # page', other: 'Utiliser # pages' }),
    cancel: 'Annuler',
    restart: 'Recommencer',
    capture: 'Prendre une photo',
    light: 'Lampe torche',
    fallback: 'Utiliser l’appareil photo du téléphone',
    denied:
      'L’accès à l’appareil photo est bloqué. Autorisez-le dans les réglages du navigateur ou utilisez l’appareil photo du téléphone.',
    insecure:
      'Ouvrez cette page avec une connexion sécurisée ou utilisez l’appareil photo du téléphone.',
    unavailable:
      'L’appareil photo n’a pas pu démarrer. Fermez les autres applications photo et réessayez, ou utilisez l’appareil photo du téléphone.',
    interrupted:
      'L’appareil photo s’est arrêté. Recommencez ou utilisez l’appareil photo du téléphone.',
    processingFailed:
      'Cette page n’a pas pu être préparée. Reprenez-la ou utilisez l’appareil photo du téléphone.',
    tooMany: 'Vous pouvez utiliser jusqu’à 20 pages. Continuez avec ces pages.',
    cornerHint:
      'Faites glisser chaque coin jusqu’au bord du papier. Utilisez les touches fléchées pour affiner.',
    pageCount: (n: number) => plural('fr', n, { one: '# page gardée', other: '# pages gardées' }),
    ready: 'Prêt pour la page suivante',
    close: 'Fermer l’appareil photo',
  },
  view: {
    back: 'Retour à la bibliothèque',
    experimental: 'Numérisation expérimentale',
    titleStart: 'Du papier au piano',
    titleReview: 'Vérifiez la reconnaissance',
    pageImages: (n: number) =>
      plural('fr', n, { one: '# image de page', other: '# images de pages' }),
    advice:
      'Les PDF d’origine et les numérisations à plat en haute résolution donnent les meilleurs résultats. Le résultat s’ouvre à côté de l’original pour que vous puissiez le vérifier.',
    where:
      'La reconnaissance se fait sur le service de numérisation du projet, sur Google Cloud (Pays-Bas). Votre page y est envoyée, reconnue, puis supprimée.',
    cancelScan: 'Annuler la numérisation',
    cancelling: 'Annulation…',
    retryFailed: 'Réessayer les pages en échec',
    scanScore: 'Numériser cette partition',
    scanning: 'Reconnaissance…',
    scanningPage: (page: number, total: number) => `Page ${page} sur ${total} · Reconnaissance…`,
    waiting:
      'Une autre partition est en cours de numérisation. La vôtre commence dès qu’elle est terminée.',
    progress: 'Progression de la reconnaissance',
    secondsLeft: (seconds: number) => `Environ ${seconds} secondes`,
    overdue: 'Cela prend plus de temps que d’habitude.',
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
    recognized: 'Notation reconnue',
    sheetLabel: 'reconnaissance brute de la numérisation',
    pageShown: (page: number, joined: boolean) =>
      joined
        ? `Reconnaissance de la page ${page}. Sélectionnez-la à nouveau pour la partition entière.`
        : `Reconnaissance de la page ${page}`,
    allPages:
      'Toutes les pages dans l’ordre de lecture. Choisissez une page pour voir sa reconnaissance seule.',
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
    /** `error` says the notation could not be drawn: it is scanned again, or its files used elsewhere. */
    notDrawnProblem: (error: string): string =>
      `${error} Numérisez à nouveau, ou téléchargez ci-dessous les fichiers pour un éditeur de partitions.`,
    /** Said after Fix all (issue 233). */
    fixedAll: (n: number): string =>
      plural('fr', n, {
        one: '# correction faite. Annuler la retire.',
        other: '# corrections faites. Annuler les retire toutes.',
      }),
    /** Under Recognition details on a device that keeps its scans as validation cases (issue 233). */
    kept: 'Les numérisations de cet appareil sont conservées pour améliorer la reconnaissance.',
    showBar: (bar: string) => `Afficher la mesure ${bar}`,
    retained:
      'Retrouvez les originaux et les reconnaissances conservés dans Mes partitions. Gardez vos fichiers d’origine\u00a0; le stockage du navigateur peut être effacé. La lecture peut utiliser un tempo par défaut de l’application.',
    beamGrouping: 'Le regroupement par ligatures est déduit et peut différer de l’original.',
    graphicSpanWarning:
      'Les liaisons et autres signes de notation restent limités à chaque page numérisée. Comparez les suites en bord de page\u00a0; les extrémités manquantes n’ont pas été réparées.',
    /** The scanner found a piano page read as one staff: shown under Recognition details; the verdict line says it above the comparison. */
    grandStaffWarning:
      'Les portées n’ont pas été réunies en système de piano : les deux mains sont lues comme une seule. Le doigté aurait de mauvaises mains : essayez une photo plus plate et bien éclairée, ou le PDF d’origine.',
    /** The join paired a treble part and a bass part into a piano part: under Recognition details. */
    pairedStavesNote:
      'L’application a réuni les portées en clé de sol et en clé de fa en un système de piano.',
    /** The scanner read only part of a line of music: shown under Recognition details; the verdict line says it above the comparison. */
    partlyReadWarning:
      'Une ligne de musique n’a été lue qu’en partie, donc des mesures peuvent manquer ou être en trop. Comparez le résultat avec l’original avant de vous exercer.',
    unknownWarning:
      'Le programme de reconnaissance a signalé un avertissement inconnu. Vérifiez bien l’original.',
    tiesFromSlurs: (n: number) =>
      plural('fr', n, {
        one: '# liaison de phrasé entre une note et sa répétition a été lue comme une liaison de prolongation.',
        other:
          '# liaisons de phrasé entre une note et sa répétition ont été lues comme des liaisons de prolongation.',
      }),
    emptyBarsJoined: (n: number) =>
      plural('fr', n, {
        one: '# mesure vide a été réunie à la mesure voisine.',
        other: '# mesures vides ont été réunies aux mesures voisines.',
      }),
    staffRegionsOmitted: (n: number) =>
      plural('fr', n, {
        one: '# petite portée supplémentaire a été écartée de la lecture.',
        other: '# petites portées supplémentaires ont été écartées de la lecture.',
      }),
    downloadPagesSummary: 'Télécharger les fichiers de chaque page',
    downloadPage: (page: number) => `Télécharger le MusicXML de la page ${page}`,
    downloadCombined: 'Télécharger le MusicXML combiné',
    downloadRaw: 'Télécharger le MusicXML brut',
    downloadAll: 'Tout télécharger',
    useForFingerings: 'Utiliser pour le doigté',
    scanAgain: 'Numériser à nouveau',
  },
  verdict: {
    facts: (parts: string[]) => parts.join(' · '),
    pages: (n: number) => plural('fr', n, { one: '# page', other: '# pages' }),
    bars: (n: number) => plural('fr', n, { one: '# mesure', other: '# mesures' }),
    bothHands: 'deux mains',
    oneStaff: 'une seule portée',
    notJoined: (page: number | undefined, reason: string | undefined) =>
      page === undefined
        ? 'Les pages n’ont pas été réunies en une seule partition\u00a0: chacune est montrée seule et se télécharge dans Fichiers. Remplacez la page qui diffère et numérisez à nouveau.'
        : `La page ${page} n’a pas pu être combinée avec les autres pages${reason ? `\u00a0: ${reason}` : ''}. Photographiez-la à nouveau, à plat et avec la page entière dans le cadre.`,
    readAsOneStaff: (pages: number[]) =>
      pages.length === 0
        ? 'Une page a été lue comme une seule portée\u00a0: les mains sont mélangées. Remplacez cette photo et numérisez à nouveau.'
        : pages.length === 1
          ? `La page ${pages[0]} a été lue comme une seule portée\u00a0: les mains sont mélangées. Remplacez cette photo et numérisez à nouveau.`
          : `Les pages ${formatList('fr', pages.map(String))} ont été lues comme une seule portée\u00a0: les mains sont mélangées. Remplacez ces photos et numérisez à nouveau.`,
    readInPart: (pages: number[]) =>
      pages.length === 0
        ? 'Une partie d’une ligne n’a pas été lue\u00a0: des mesures manquent ou sont en trop. Remplacez cette photo et numérisez à nouveau.'
        : pages.length === 1
          ? `Une partie d’une ligne de la page ${pages[0]} n’a pas été lue\u00a0: des mesures manquent ou sont en trop. Remplacez cette photo et numérisez à nouveau.`
          : `Une partie d’une ligne des pages ${formatList('fr', pages.map(String))} n’a pas été lue\u00a0: des mesures manquent ou sont en trop. Remplacez ces photos et numérisez à nouveau.`,
    readUnclearly: (pages: number[], of: number) =>
      of === 1
        ? 'La page n’a pas pu être lue clairement. Photographiez-la à nouveau\u00a0: à plat, bien éclairée, la page entière dans le cadre.'
        : pages.length === 1
          ? `La page ${pages[0]} n’a pas pu être lue clairement. Photographiez-la à nouveau\u00a0: à plat, bien éclairée, la page entière dans le cadre.`
          : `Les pages ${formatList('fr', pages.map(String))} n’ont pas pu être lues clairement. Photographiez-les à nouveau\u00a0: à plat, bien éclairées, chaque page entière dans le cadre.`,
  },
  edit: {
    hint: 'Sélectionnez une note pour la corriger.',
    keys: 'Entrée sélectionne la première note. Gauche et Droite sélectionnent la note précédente ou suivante, Haut et Bas changent sa hauteur (avec Maj, d’une octave), Échap ferme l’éditeur.',
    pitch: (step: string, alter: number, octave: number) =>
      `${({ C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' } as Record<string, string>)[step] ?? step}${alter > 0 ? '♯︎'.repeat(alter) : '♭︎'.repeat(-alter)}${octave}`,
    bar: (bar: string) => `Mesure ${bar}`,
    photoAt: (bar: string) => `${bar} sur la photo`,
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
    suggestedLabel: 'Lue aussi comme',
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
      barline: (bar: string) => `Mesure ${bar}\u00a0: marques de reprise supprimées`,
    },
    setMeter: (meter: string, bar: string) => `Passer en ${meter} à partir de la mesure ${bar}`,
    removeMark: (mark: 'ending' | 'repeat') =>
      mark === 'ending' ? 'Supprimer la volta' : 'Supprimer le signe de reprise',
    lengthenTie: (pitch: string, bar: string, length: string, dotted: boolean) =>
      `Faire du ${pitch} de la mesure ${bar} une ${length}${dotted ? ' pointée' : ''} pour que la liaison atteigne la note suivante`,
    removeTie: 'Retirer la liaison',
    fixAll: (n: number) => `Tout corriger (${n})`,
    stale: (kept: number) =>
      `Certaines corrections enregistrées ne s’appliquent plus à cette reconnaissance. Les ${kept} premières sont conservées.`,
    problemsSummary: (n: number) =>
      plural('fr', n, { one: '# endroit à vérifier', other: '# endroits à vérifier' }),
    problems: {
      tieGap: (where: string, pitch: string, gap: string) =>
        `${where}\u00a0: le ${pitch} lié finit ${gap} avant le début du ${pitch} suivant. Vérifiez les durées.`,
      tieEarly: (where: string, pitch: string, gap: string) =>
        `${where}\u00a0: le ${pitch} lié déborde de ${gap} sur le ${pitch} suivant. Vérifiez les durées.`,
      tieUnmatched: (where: string, pitch: string, side: 'start' | 'stop') =>
        side === 'start'
          ? `${where}\u00a0: une liaison sur ${pitch} n’a pas de note correspondante.`
          : `${where}\u00a0: la liaison vers ${pitch} ne part d’aucune note correspondante avant elle.`,
      tieGrace: (where: string, pitch: string) =>
        `${where}\u00a0: l’appoggiature ${pitch} est liée, mais une appoggiature ne dure pas assez pour être tenue.`,
      tieRepaired: (
        where: string,
        pitch: string,
        reason: 'gap' | 'unmatchedStart' | 'unmatchedStop' | 'grace',
      ) =>
        reason === 'gap'
          ? `${where}\u00a0: la liaison de ${pitch} n’atteint pas le ${pitch} suivant. Les deux notes sont jouées séparément.`
          : reason === 'unmatchedStart'
            ? `${where}\u00a0: la liaison de ${pitch} ne mène à aucun ${pitch} suivant. La note est jouée sans liaison.`
            : reason === 'unmatchedStop'
              ? `${where}\u00a0: la liaison vers ${pitch} ne part d’aucun ${pitch} précédent. La note est rejouée.`
              : `${where}\u00a0: l’appoggiature ${pitch} est liée. Les deux notes sont jouées séparément.`,
      tieRepairedBar: (where: string) =>
        `${where}\u00a0: une liaison ne correspond pas à ses notes. La note est jouée sans liaison.`,
      barTiming: (timing: string) => `Les mains ne concordent pas. ${timing}`,
      barLong: (timing: string) => `La mesure est plus longue que son chiffrage. ${timing}`,
      endingWithoutRepeat: (where: string) =>
        `${where}\u00a0: une volta a été lue ici, mais la partition n’a pas de signe de reprise.`,
      repeatWithoutEnd: (where: string) =>
        `${where}\u00a0: un signe de reprise s’ouvre ici, et aucun signe de reprise ne le ferme.`,
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
      noMark: 'Cette mesure n’a pas de marque de reprise.',
    },
  },
  phone: {
    takePhoto: 'Photographier une partition imprimée',
    takeAnother: 'Photographier une autre page',
  },
  errors: {
    notCombinedSaved:
      'Les pages ont été reconnues, mais leur notation n’a pas pu être combinée. Les fichiers de chaque page sont disponibles ci-dessous.',
    somePagesFailed:
      'Certaines pages doivent être numérisées à nouveau. Les pages reconnues sont conservées.',
    recognitionFailed: 'La reconnaissance a échoué.',
    /** The notation could not be drawn; `page` is the page shown on its own, absent for the whole scan. */
    notDrawn: (page: number | undefined): string =>
      page === undefined
        ? 'La notation reconnue n’a pas pu être dessinée.'
        : `Page ${page}\u00a0: la notation reconnue n’a pas pu être dessinée.`,
    /** The recognition holds no music to draw; `page` as above. */
    noMusic: (page: number | undefined): string =>
      page === undefined
        ? 'Aucune musique n’a été lue dans cette numérisation.'
        : `Page ${page}\u00a0: aucune musique n’a été lue.`,
    noNotes: 'Aucune note jouable n’a été reconnue.',
    notUsable:
      'Cette reconnaissance ne peut pas encore servir au doigté\u00a0: certaines de ses notes ne s’accordent pas.',
    /** The import refused `bar`, the bar's printed number as the engine named it (issue 233). */
    notUsableAt: (bar: string): string =>
      `La mesure ${bar} n’a pas pu être lue telle qu’elle est écrite, donc cette reconnaissance ne peut pas encore servir au doigté.`,
    notChecked:
      'Les notes n’ont pas pu être vérifiées pour le doigté dans cet onglet. Rechargez la page et rouvrez cette numérisation depuis Mes partitions.',
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
    retake: (page: number) => `Remplacer la page ${page} par une nouvelle photo`,
    retakeTouch: (page: number) => `Photographier à nouveau la page ${page}`,
    /** A one-page scan: the page is "it". */
    retakeOnly: 'La remplacer par une nouvelle photo',
    retakeOnlyTouch: 'La photographier à nouveau',
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
    refused: (page: number | undefined, reason: string) =>
      page === undefined
        ? `Ces pages ne peuvent pas être combinées\u00a0: ${reason}.`
        : `La page ${page} ne peut pas être combinée avec les autres pages\u00a0: ${reason}.`,
    reasons: {
      noPages: 'aucune page n’a été reconnue',
      entities: 'son fichier utilise des entités XML',
      notPartwise: 'son fichier n’est pas du MusicXML «\u00a0partwise\u00a0»',
      transposition:
        'elle comporte une transposition ou des attributs particuliers de portée ou de mesure',
      partLayout: 'sa liste de parties est incomplète',
      partOrder: 'ses parties ne suivent pas l’ordre de sa liste de parties',
      measureCounts: (counts: number[]) =>
        `elle a été lue comme ${plural('fr', counts.length, { one: '# partie', other: '# parties' })} avec ${formatList('fr', counts.map(String))} mesures`,
      startingSetup:
        'elle n’a pas de divisions, d’armure, de chiffrage ni de clés explicites au début',
      staffLayout: 'la disposition initiale de ses portées est incomplète',
      staffChange: 'la disposition de ses portées change à l’intérieur de la page',
      instrumentUndeclared: 'elle fait référence à un instrument qui n’est pas déclaré',
      partCounts: (found: number, first: number) =>
        `elle a été lue comme ${plural('fr', found, { one: '# partie', other: '# parties' })}, alors que la page 1 en a ${first}`,
      layoutsDiffer: 'ses parties ou ses portées diffèrent de celles de la page 1',
      instrumentsDiffer: 'ses instruments diffèrent de ceux de la page 1',
      duplicateIds: 'elle contient des identifiants XML en double',
      unresolvedId: 'elle fait référence à un identifiant XML qui n’existe pas',
      spanNumber: 'elle contient un numéro de signe de notation non valide',
      spanOverflow: 'elle demande plus de 16 numéros pour un même type de signe de notation',
    },
  },
};
