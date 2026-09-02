# Participations

## À quoi ça sert

La liste Entreprises (`/app/<org>/participations`, premier sous-onglet de
la section **Investissements** de la barre latérale) est la vue du
portefeuille **par société** : une ligne = une société, quel que soit le
nombre de deals réalisés dessus. C'est le point d'entrée vers les fiches
sociétés, leurs rapports et leurs documents.

Les **placements de trésorerie** (crypto, comptes de capitalisation, dépôts
à terme, comptes-titres) n'apparaissent pas ici : leur suivi est différent
(un solde et un rendement, pas une participation) et vit sur la page
[Placements](19-placements.md). Les fonds, eux, restent bien dans la liste.

## La liste

- **Un tableau par statut**, empilés dans l'ordre de lecture, chacun coiffé
  d'un **bandeau teinté** (pastille + titre + compteur) : **En cours (term
  sheet)** en ambre tout en haut, **Actifs** en bleu, **Exit win** en
  vert, **Exit loss** en rouge. Un tableau vide ne s'affiche pas — pas de
  term sheet en cours, pas de tableau ambre. Le compteur du bandeau compte
  les **deals** (pas les lignes) : même nombre que la ligne de totaux du
  tableau — tout se raisonne en deals.
- **Les deals annulés n'ont pas de tableau** (ni de ligne dans les autres) :
  ils vivent dans une section repliée « *n* deals annulés » tout en bas de la
  page, affichée seulement s'il en existe. Un deal annulé — virement parti
  puis remboursé — n'est ni une position ouverte ni une sortie, et il ne
  compte dans aucun total (cf. [Deals](05-deals.md#annuler-un-deal)).
- **Une société peut apparaître dans plusieurs tableaux** quand ses deals
  n'ont pas tous le même statut (ex. un deal sorti et un nouveau ticket en
  cours) : chaque tableau garde ainsi des sommes exactes. Pour que ça ne se
  lise pas comme un doublon, la colonne **Deals** de ces lignes affiche
  « 1 sur 2 » au lieu de « 1 deal » : la ligne ne couvre qu'une partie des
  deals faits sur cette société. Les autres lignes ne changent pas.
- **Colonnes réduites à l'essentiel**, dans cet ordre : ce qui décrit la
  boîte — logo et nom, **score IA de santé** (1 à 10), secteur en badge —
  puis ce qui la mesure : nombre de deals, montant investi, montant reçu,
  **TVPI**. Le tableau des term sheets affiche l'**engagé prévisionnel** à
  la place des montants (rien n'est encore décaissé) ; les deux tableaux
  d'exits remplacent le TVPI par **MOIC** et **TRI** annualisé. Tri par
  colonne sur les Actifs, clic vers la fiche ; pas de pagination — chaque
  tableau défile sous son en-tête et ses totaux.
- **Alerte « boîte silencieuse »** : une pastille d'alerte ambre s'affiche à
  côté du nom d'une société dont aucune nouvelle n'est arrivée depuis plus de
  **4 mois** (délai réglable par organisation dans Réglages → Général). Deux
  canaux comptent à égalité : les **rapports reçus par email** et les
  **communications publiées sur le portail de l'émetteur** (les SPV Parallel
  et consorts, cf. [Intégrations](15-integrations.md)) — un SPV ne rédige
  rien, il publie, et l'alerte doit lire là où il parle. Le survol donne le
  détail : par quel canal la dernière nouvelle est arrivée, depuis quand, et
  jusqu'à quelle période elle couvrait — un rapport reçu en mars peut ne
  couvrir que janvier. Une société qui n'a jamais donné de nouvelles est
  comptée depuis le versement des fonds. Les term sheets en cours et les positions sorties
  ne portent jamais cette pastille. Le même signal alimente le bloc
  « Reportings manquants » de la page [À faire](16-a-faire.md).
- **Colonnes alignées d'un tableau à l'autre** : les quatre tableaux
  partagent la même grille, donc chaque colonne tombe au même endroit et
  la page se lit d'un seul coup d'œil vertical. Un tableau qui n'a pas une
  colonne laisse sa place vide plutôt que de décaler les suivantes ; comme
  les chiffres sont en fin de ligne, ces emplacements vides se retrouvent
  au bout — le tableau des term sheets s'arrête après l'engagé, sans trou
  au milieu.
- **Ligne de totaux par tableau** : nombre de deals et montants, sommés sur
  la section entière et recalculés en direct quand un filtre ou une
  recherche est actif. La somme des exits gagnants et celle des pertes se
  lisent directement au pied de leurs tableaux.
- **Recherche et filtres** : recherche plein texte (société, deal,
  instrument, investisseur, secteur) et filtres multi-sélection par
  instrument et secteur — le filtre statut a disparu, les tableaux par
  statut jouent ce rôle. Le bandeau de tête (titre, menu ⋯, recherche et
  filtres) reste figé en haut de l'écran quand on descend dans la liste.
  Ce que vous avez filtré **reste en place** : ouvrir une fiche société,
  passer sur la trésorerie puis revenir retrouve la liste dans l'état où
  vous l'aviez laissée, jusqu'à la fermeture de l'onglet du navigateur.
  Le bouton **« Réinitialiser »** (à droite des filtres, visible dès qu'une
  recherche ou un filtre est actif) efface tout d'un coup. Chaque liste
  garde ses propres filtres : une organisation n'impose rien à une autre,
  ni à la vue consolidée.
  Export **CSV ou Excel (.xlsx)**, généré à la demande ; il respecte la
  recherche et les filtres actifs (sans filtre, tout l'ensemble est
  exporté).
- **Section « Sans deal »** : les entités du portefeuille pas encore
  rattachées à un deal.
- **Section « Archivées »** : les entités archivées, restaurables en un clic.
- **Créer une entité** (menu ⋯) : nom + SIREN ; l'entité créée est toujours
  une société de portefeuille (les entités du groupe ne se créent pas ici).

## La fiche société

En-tête : logo, nom, % de détention global. En dessous, la page se
lit en deux colonnes : le contenu principal à gauche, la **fiche d'identité
en panneau latéral à droite** (sur mobile, le panneau passe sous le
contenu).

La colonne principale, dans l'ordre de lecture :

- **Synthèse IA en premier** : score de santé, résumé exécutif, alerte
  critique éventuelle, points forts / points de vigilance, trois KPIs avec
  tendance — chiffres, variations et lignes de contexte alignés d'une
  tuile à l'autre, contexte lisible sur deux lignes — la santé de la
  boîte est la première chose qu'on voit. Elle
  est régénérée automatiquement à chaque rapport reçu — qu'il arrive par
  email ou qu'il soit publié sur le portail Parallel — et peut être
  relancée à la main. Elle suit aussi les corrections : renvoyer un
  rapport déjà reçu avec un chiffre rectifié la met à jour, alors qu'un
  renvoi strictement identique ne relance rien ; et détacher un rapport la
  recalcule sur ce qui reste — s'il n'en reste aucun, la fiche repasse à
  « aucune donnée » plutôt que de garder une note devenue sans objet.
- **Ce que vaut le score de santé.** Il note l'entreprise, pas la qualité de
  son reporting, sur trois axes : trajectoire par rapport au plan,
  trésorerie et runway, solidité de la structure (rentabilité, gouvernance,
  financement). Les bandes : **9-10 excellent**, **7-8 en bonne voie**,
  **5-6 à surveiller**, **3-4 préoccupant**, **1-2 critique**. C'est l'axe
  le plus dégradé qui commande — un runway sous six mois sans financement
  engagé plafonne la note, même avec un chiffre d'affaires en forte hausse.
  Les points forts et les points de vigilance comptent de un à trois items
  chacun : les deux colonnes n'ont pas à être de même longueur.
- **Sans rapport, pas de note.** Une société dont aucun reporting (ni
  communication Parallel) n'est encore arrivé affiche « aucune donnée » et
  reste vide dans la colonne Score — plutôt qu'une note fabriquée à partir
  du seul nom de la boîte.
- **Deals de la société** : un tableau au même style que la liste des
  participations (badge de statut coloré — ambre term sheet, bleu actif,
  vert Exit win, rouge Exit loss, gris annulé —, date de
  signature, investi, reçu, TVPI), les term sheets en premier et les deals
  annulés en dernier, chaque
  **ligne cliquable** vers la
  [fiche deal](05-deals.md) — c'est le seul chemin d'accès aux deals. Un
  deal se crée depuis cette fiche (menu ⋯) ; le formulaire propose
  d'emblée **tous les champs de l'instrument** choisi (montant, dates dont
  le closing, tour, valorisations, titres acquis…) pour tout renseigner en
  une fois.
- **Rapports & communications** : le **journal** de la société — ce qu'elle
  nous envoie, du plus récent au plus ancien. On y trouve les rapports
  investisseurs analysés (reçus par mail ou déposés à la main) et les
  communications Parallel/VASCO des SPV (voir
  [Intégrations](15-integrations.md)).
  - **Ce qui classe une ligne, c'est sa date** : la période couverte quand
    elle existe (un reporting de janvier se range en janvier même s'il est
    déposé en mars), la date de réception sinon — et la ligne dit toujours
    laquelle des deux elle affiche.
  - Chaque ligne se présente en bulle : titre, résumé d'une ligne, date, et
    le nombre de fichiers joints. Le pictogramme est sur **fond bleuté** et
    propre à sa nature (un pour les rapports, un autre pour les
    communications). Un clic ouvre le détail (points clés, métriques,
    contenu intégral ; corps et pièces jointes pour une communication
    VASCO). Les fichiers d'un rapport sont **repliés dedans** — ils ne
    prennent pas de ligne à part, et ne comptent pas non plus dans les
    documents de la société.
  - **Le bouton « Ajouter un rapport »** ouvre une fenêtre qui ne demande que
    les fichiers et, si on veut, une note de contexte : le lot part dans le
    circuit d'analyse (période, points clés, métriques, synthèse relancée —
    voir [Reports par email](17-reports-par-email.md)), qui nomme et date le
    rapport lui-même. Le bouton dit « Analyser et ajouter ». Ce bouton
    n'existe que sur une société du portefeuille : l'analyse ne sait pas lire
    une entité du groupe, dont les pièces se déposent dans les documents.
  - **Deux façons de retirer un rapport**, au bas de son détail.
    « Détacher de cette participation » le retire de cette fiche seulement,
    en gardant les fichiers et le mail d'origine rejouable — c'est le geste
    du mauvais rangement. « Supprimer définitivement » fait la même chose et
    emporte les fichiers : ils sont effacés dès qu'aucune autre participation
    ne s'en sert, et le mail d'origine perd sa pièce jointe. Les deux gestes
    existent aussi depuis les Rapports entrants (la croix détache, la
    corbeille supprime). Détail dans
    [Reports par email](17-reports-par-email.md).

Les documents, à droite, sous l'identité. Ce sont deux choses différentes :
un rapport est un **journal**, qu'on lit dans l'ordre, une fois, quand il
arrive ; un document est un **coffre**, qu'on cherche par nature, longtemps
après, parce qu'il faut signer ou voter. La carte **Documents** du panneau
d'identité porte le coffre : le nombre total, les **cinq plus récents** (titre,
type, date), et un bouton **+** qui ouvre la fenêtre de dépôt. Un clic
sur une ligne ouvre le fichier.

- **« Voir les N documents »** ouvre le **tiroir** latéral, la bibliothèque
  complète. On y trouve une **recherche par titre**, des **filtres par type**
  (seuls les types réellement présents sont proposés, chacun avec son
  compte), et les documents **regroupés par type** plutôt que par date : sur
  une société dont les trente-six pièces ont été déposées le même jour,
  l'ordre chronologique ne répond à rien, là où « où est le pacte ? » est la
  vraie question.
- Chaque document s'y présente comme une **pièce jointe** — une box qui porte
  l'icône de son format, son titre, le badge de son type et, en dessous, sa
  date et son poids. Un **clic sur la box ouvre le document**. À droite,
  l'état de sa **lecture** (voir ci-dessous), un **crayon** pour corriger le
  titre, le type ou la date, et une corbeille (avec confirmation).
- **Les documents rattachés à un deal sont ici aussi**, badgés au nom du deal,
  le badge menant à sa [fiche](05-deals.md) : un pacte engage l'entité autant
  que le deal qui l'a produit, et il n'y a jamais qu'un seul fichier stocké.
  Ce rattachement n'est plus proposé au dépôt : les documents déjà rattachés
  gardent leur badge, les nouveaux restent au niveau de l'entité.
- **Le dépôt ne demande que les fichiers**, plusieurs d'un coup, 20 Mo
  chacun. Ni type, ni date, ni titre à saisir : chaque fichier est lu après
  le dépôt et **se classe tout seul** — son type et, quand le document la
  porte, sa date se remplissent quelques secondes plus tard, chacun selon son
  propre contenu. Le titre reste le nom du fichier. Un classement qui tombe à
  côté se corrige au crayon, sur la ligne du document ; une correction faite
  à la main n'est jamais réécrite. Un fichier illisible (scan sans texte,
  format non reconnu) reste simplement en « Autre ».

Le panneau d'identité, à droite. Il se présente comme une carte, au même
style que la synthèse IA, et chaque section y est introduite par une petite
pastille carrée portant son icône. Il **suit la lecture** : il défile avec la
page tant qu'il reste quelque chose à y découvrir, puis se fige une fois
qu'on est arrivé à son bas, pendant que la colonne principale continue de
défiler — l'identité de la société reste donc sous les yeux quand on lit ses
rapports ou ses deals.

- **Identité** : secteur, SIREN (affiché par groupes de trois chiffres),
  domaine — éditables en ligne (clic sur la valeur) — plus le % de
  détention et le nombre d'actions consolidé, qui sont calculés et donc en
  lecture seule. Le **% de détention** vient de deux endroits, et le premier
  gagne toujours : si la société est une **filiale du groupe**, c'est sa
  propre structure capitalistique qui fait foi — le chiffre porte alors un
  lien vers sa page Passif, là où il se saisit. Sinon, c'est le rapport entre
  les actions détenues et le total des actions de la société. Le second n'est
  qu'une approximation (il suppose le nombre total d'actions à jour) ; quand
  la source qui fait foi existe, l'application ne calcule pas un second
  chiffre à côté — deux pourcentages finiraient par diverger, et rien ne
  dirait lequel a raison. Voir [Passif](10-passif.md). Les champs se lisent en lignes — libellé à gauche, valeur
  à droite, séparés par un filet fin — de sorte que même les libellés longs
  tiennent sur une seule ligne dans la largeur du panneau.
- **Fiche Attio** : la dernière ligne du bloc Identité rattache la société à
  sa fiche dans le CRM. Quand le lien existe, elle affiche « Ouvrir dans
  Attio » et une croix pour détacher ; sinon, un clic ouvre une **recherche
  dans Attio** — on tape deux lettres et on **choisit** dans la liste (nom
  et domaine, pour départager les homonymes). On ne peut pas saisir une
  référence à la main : ce lien est ce sur quoi la synchronisation des deals
  s'appuie, une valeur inventée enverrait les prochains deals sur la
  mauvaise société. Une même fiche Attio peut être rattachée à **plusieurs**
  sociétés, y compris dans des organisations différentes : Attio ne connaît
  souvent qu'une fiche là où Albo OS a une entité par véhicule (les SPV d'une
  plateforme comme Parallel, par exemple). C'est utile surtout pour les
  sociétés créées à la main dans Albo : celles qui arrivent par la
  synchronisation sont déjà rattachées. À savoir : quand plusieurs sociétés
  partagent la même fiche, les deals qui arrivent d'Attio continuent d'aller
  sur la **première** d'entre elles (la plus ancienne de l'organisation) —
  rattacher les autres sert à ouvrir le CRM depuis leur fiche, pas à
  détourner la synchronisation.
- **Résumé** : le résumé de la société, dans sa propre section, aligné à
  gauche et **éditable au clic** — on clique le texte, on écrit, on clique
  ailleurs et c'est enregistré (Échap annule).
- **Personnes** : fondateurs, board, co-investisseurs — chacun en pastille
  avec ses initiales, et un compteur sur la section quand la liste n'est
  pas vide. Quand l'entrée est rattachée à Attio, une flèche l'indique et
  **toute la pastille** ouvre la fiche du CRM — pas seulement la flèche.
  C'est le seul geste qu'elle porte : le nom ne s'édite plus au clic, donc
  on sait toujours ce qu'un clic va faire. Corriger un nom se fait en
  retirant la pastille et en en ajoutant une nouvelle. Une pastille non
  rattachée ne réagit pas ; la croix, elle, reste à part et ne retire
  jamais par mégarde. La pastille
  **« + Ajouter »** ouvre un champ de saisie qui propose au fil de la
  frappe les résultats d'Attio, **personnes et sociétés** — un
  co-investisseur est le plus souvent un fonds. Une petite icône distingue
  les deux (silhouette pour une personne, immeuble pour une société), et
  la flèche mène ensuite à la bonne fiche du CRM. Choisir une suggestion
  rattache l'entrée à Attio ; taper un nom libre la laisse non rattachée.

Toute la fiche s'édite ainsi, au clic sur la valeur, sans fenêtre ni bouton
Enregistrer. Le menu ⋯ ne garde que ce qui n'est pas un champ de la fiche :
**renommer** la société, créer un deal, lier une plateforme externe,
archiver, supprimer.

### Les secteurs

Le secteur répond à une seule question : **à quel marché la société
vend-elle ?** Quatorze valeurs, pas une de plus — SaaS / Logiciel, Fintech,
Santé / Biotech, Silver economy, AgriFood, Consumer / Retail, Marketplace,
Industrie / Circulaire, DeepTech, Immobilier, Fonds / Véhicules, Mobilité,
EdTech, Autre.

Trois principes tiennent la liste, et évitent qu'elle regonfle :

- **Le marché, jamais le véhicule.** SPV, fonds, studio, structure de
  carried : c'est déjà l'instrument du deal qui le dit. Les participations
  sans marché propre — un fonds, un studio — se rangent toutes dans
  « Fonds / Véhicules », plutôt qu'une étiquette par véhicule.
- **La verticale l'emporte sur le modèle**, quand elle existe dans la liste :
  un logiciel vendu aux radiologues est en Santé, un logiciel vendu aux
  agriculteurs en AgriFood. « SaaS / Logiciel » ne garde que le logiciel B2B
  sans verticale dominante, et « DeepTech » les ruptures scientifiques
  qu'aucun marché de la liste ne couvre. Seule exception assumée : une
  marketplace reste une marketplace.
- **Pas de lecture transversale.** Le climat a été essayé comme secteur puis
  retiré : avec une thèse d'impact, les trois quarts du portefeuille peuvent
  le revendiquer — il n'y a donc rien à trier, et la case attirait tout ce
  qui passait (un logiciel, une opération immobilière, deux fonds). Chaque
  société est revenue à son marché réel.

Le champ reste **libre à la saisie** : on peut taper un secteur qui n'est pas
dans la liste, et il réapparaîtra ensuite dans le sélecteur. Mais c'est un
signal, pas une pratique — si une valeur libre s'installe, c'est qu'il
manque une case, et elle se tranche pour tout le portefeuille. L'assistant
IA, lui, ne peut plus en inventer : il choisit dans la liste ou laisse vide.

### La lecture des documents

Tout document qui entre — qu'il soit déposé à la main ici ou arrivé par un
[report transféré par email](17-reports-par-email.md) — est **lu
automatiquement** : PDF et images par OCR, Excel et CSV cellule par cellule.
Un classeur Excel est lu **sur tous ses onglets**, chacun repris avec son nom
et son nombre de lignes. L'état affiché dans les actions de sa box dit où il
en est :

| Ce que tu vois | Ce que ça veut dire |
| --- | --- |
| « Lecture en cours… » | Le document vient d'arriver, la lecture tourne (elle ne peut plus y rester bloquée, voir plus bas) |
| « 12 400 car. » | Lu — clique pour relire le texte extrait |
| ⚠️ avec une cause | La lecture a échoué (fichier illisible, protégé…) — le bouton ↻ relance |
| « Petite image ignorée », « Format non lu » | Rien à lire, c'est normal (logo, format non géré) |
| « Analyser » | Document déposé avant cette fonctionnalité — le bouton lance sa lecture |

Une lecture qui **ne revient jamais** est rattrapée toute seule : dans
l'heure, l'app relance le document resté en attente, et si la seconde
tentative n'aboutit pas davantage, il bascule en rouge « Lecture jamais
terminée » avec son bouton ↻. C'est volontairement bruyant — un document
qui reste indéfiniment « en cours » a l'air parfaitement normal dans la
liste, alors que l'assistant, lui, ne le voit pas : il répondrait depuis les
autres documents sans jamais dire qu'il en manque un.

Le texte extrait s'ouvre en un clic : c'est ce qui permet de **vérifier ce
que la machine a réellement lu** avant de faire confiance aux métriques
qu'elle en a tirées. Un texte très court sur un document épais est le signe
d'un scan de mauvaise qualité.

> Un document très long est tronqué à 900 000 caractères (~350 pages) ; la
> fenêtre le dit explicitement. Sur un classeur, la place est partagée entre
> les onglets — la coupe tombe sur celui qui déborde, jamais sur les autres,
> et le texte indique combien de lignes ont été laissées de côté.

Une fois lu, le document est aussi **indexé pour la recherche de
[l'assistant](11-assistant-ia.md)** — c'est ce qui lui permet de répondre à
« que dit le pacte de X sur… ». Une seconde icône, à côté de l'état de
lecture, dit où en est cette indexation :

| Ce que tu vois | Ce que ça veut dire |
| --- | --- |
| 🔍✓ | Indexé — l'assistant peut chercher dans son contenu |
| Roue qui tourne | Indexation en cours (elle réessaie toute seule en cas de saturation passagère) |
| ⚠️ avec un bouton ↻ | L'indexation a échoué malgré plusieurs tentatives — un **email** t'a prévenu, le bouton relance |
| 🔍✗ | Rien à indexer, c'est normal (pas de texte, contenu déjà couvert par son report, ou tableur) |
| 🔍 cliquable | Document d'avant cette fonctionnalité — le bouton lance son indexation |

Un échec d'indexation n'est **jamais silencieux** : après la dernière
tentative, les membres de l'organisation reçoivent un email avec le document
concerné et le bouton de relance à portée de clic. Le fichier lui-même n'est
jamais affecté.

> **Les tableurs (Excel, CSV) ne sont pas indexés**, et c'est volontaire : la
> recherche de l'assistant fonctionne sur le sens des phrases, et des colonnes
> de chiffres coupées de leur en-tête n'ont pas de sens à retrouver. Ils
> affichent donc 🔍✗ « Tableur — non indexé ». Leur lecture, elle, se fait
> normalement : le texte extrait reste consultable en un clic, onglet par
> onglet. Un tableur reçu en pièce jointe d'un rapport reste couvert par la
> recherche via le contenu de ce rapport.

Les documents rangés sur une [fiche deal](05-deals.md) suivent exactement le
même circuit et affichent la même colonne.

### Sous le capot : l'enrichissement automatique

À la création d'une participation avec un domaine web, un enrichissement
automatique remplit le pitch et le résumé depuis le site de la société. Il
est additif : il ne réécrit jamais un champ déjà renseigné à la main. Si
plusieurs entités partagent le même domaine (ex. les boutiques d'une même
enseigne), une édition du pitch se propage à toutes pour qu'elles restent
identiques.

Les **véhicules d'investissement** (les SPV d'une plateforme comme Parallel
ou Sezame) échappent à cette règle : ils partagent tous le site de leur
sponsor tout en étant des opérations différentes. Leur pitch n'est donc
jamais déduit du site ni recopié d'un SPV voisin — il vient des
communications investisseur de la plateforme, dès que la fiche est rattachée
à son SPV dans [Intégrations](15-integrations.md), ou de votre saisie. Et
corriger le résumé d'un SPV ne touche plus les autres.

## Actions de cycle de vie

- **Archiver** : masque la société partout (réversible). Refusé tant qu'elle
  est référencée par un deal, une relation, un KPI, un compte bancaire ou un
  document — il faut réaffecter ou vider d'abord.
- **Supprimer** : définitif ; refusé pour les entités du groupe et pour toute
  société encore référencée.

## Points d'attention

- Certaines participations sont **groupées** sous une même ligne (ex. les SPV
  d'un même sponsor comme Parallel) : le groupe a son nom d'affichage et ses
  blocs KPI consolidés configurables.
- La détention entre sociétés (SCI 50/50, participation d'Albo dans un SPV…)
  est enregistrée comme relation société-à-société, mais ne s'édite pas
  encore dans l'interface.

## Pages liées

- [Deals](05-deals.md),
  [Valorisations, KPIs et métriques](06-valorisations-et-kpis.md),
  [Intégrations](15-integrations.md) (rapports par email, Parallel/VASCO)
