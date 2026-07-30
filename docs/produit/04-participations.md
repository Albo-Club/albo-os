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
- **Colonnes réduites à l'essentiel**, dans cet ordre : ce qui décrit la
  boîte — logo et nom, **score IA de santé** (1 à 10), secteur en badge —
  puis ce qui la mesure : nombre de deals, montant investi, montant reçu,
  **TVPI**. Le tableau des term sheets affiche l'**engagé prévisionnel** à
  la place des montants (rien n'est encore décaissé) ; les deux tableaux
  d'exits remplacent le TVPI par **MOIC** et **TRI** annualisé. Tri par
  colonne sur les Actifs, clic vers la fiche ; pas de pagination — chaque
  tableau défile sous son en-tête et ses totaux.
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
  est régénérée automatiquement à chaque rapport ingéré, et peut être
  relancée à la main.
- **Deals de la société** : un tableau au même style que la liste des
  participations (badge de statut coloré — ambre term sheet, bleu actif,
  vert Exit win, rouge Exit loss —, date de
  signature, investi, reçu, TVPI), les term sheets en premier, chaque
  **ligne cliquable** vers la
  [fiche deal](05-deals.md) — c'est le seul chemin d'accès aux deals. Un
  deal se crée depuis cette fiche (menu ⋯) ; le formulaire propose
  d'emblée **tous les champs de l'instrument** choisi (montant, dates dont
  le closing, tour, valorisations, titres acquis…) pour tout renseigner en
  une fois.
- **Onglet Rapports** : les communications investisseurs — celles ingérées
  automatiquement par email (investor updates analysés : highlights,
  métriques, contenu) et celles remontées depuis Parallel/VASCO pour les SPV
  (voir [Intégrations](15-integrations.md)).
- **Onglet Documents** : upload manuel (reporting, BP, légal, autre — 20 Mo
  max, avec période couverte). Chaque document se présente comme une
  **pièce jointe** : une petite box qui porte l'icône de son format, son
  titre, le badge de son type et, en dessous, sa période et son poids. Elles
  s'empilent de la plus récente à la plus ancienne — pas de tableau ici, la
  liste ne sert pas à comparer des chiffres mais à retrouver un fichier. Un
  **clic sur la box ouvre le document**. À droite, l'état de sa **lecture**
  (voir ci-dessous), un **crayon** pour corriger le titre, le type ou la
  période, et une corbeille (avec confirmation). Un **filtre par type**, en
  haut à gauche, ne propose que les types réellement présents. Les documents
  propres à un investissement (term sheet, pacte, bulletin de
  souscription…) ne se rangent pas ici mais sur la [fiche du deal
  concerné](05-deals.md).

Le panneau d'identité, à droite. Il se présente comme une carte, au même
style que la synthèse IA, et chaque section y est introduite par une petite
pastille carrée portant son icône. Il **suit la lecture** : il défile avec la
page tant qu'il reste quelque chose à y découvrir, puis se fige une fois
qu'on est arrivé à son bas, pendant que la colonne principale continue de
défiler — l'identité de la société reste donc sous les yeux quand on lit ses
rapports ou ses deals.

- **Identité** : secteur, SIREN (affiché par groupes de trois chiffres),
  domaine — éditables en ligne (clic sur la valeur) — plus le % de
  détention, le nombre d'actions consolidé et un lien « Ouvrir dans Attio »
  quand la société est liée au CRM. Les champs se lisent en lignes —
  libellé à gauche, valeur à droite, séparés par un filet fin — de sorte
  que même les libellés longs tiennent sur une seule ligne dans la
  largeur du panneau.
- **Résumé** : le résumé de la société, dans sa propre section, aligné à
  gauche.
- **Personnes** : fondateurs, board, co-investisseurs — chacun en pastille
  avec ses initiales, et un compteur sur la section quand la liste n'est
  pas vide ; lien vers la fiche Attio quand la personne y est rattachée.
  L'édition passe par le dialogue Éditer, qui propose une recherche dans
  les personnes Attio.

### La lecture des documents

Tout document qui entre — qu'il soit déposé à la main ici ou arrivé par un
[report transféré par email](17-reports-par-email.md) — est **lu
automatiquement** : PDF et images par OCR, Excel et CSV cellule par cellule.
L'état affiché dans les actions de sa box dit où il en est :

| Ce que tu vois | Ce que ça veut dire |
| --- | --- |
| « Lecture en cours… » | Le document vient d'arriver, la lecture tourne |
| « 12 400 car. » | Lu — clique pour relire le texte extrait |
| ⚠️ avec une cause | La lecture a échoué (fichier illisible, protégé…) — le bouton ↻ relance |
| « Petite image ignorée », « Format non lu » | Rien à lire, c'est normal (logo, format non géré) |
| « Analyser » | Document déposé avant cette fonctionnalité — le bouton lance sa lecture |

Le texte extrait s'ouvre en un clic : c'est ce qui permet de **vérifier ce
que la machine a réellement lu** avant de faire confiance aux métriques
qu'elle en a tirées. Un texte très court sur un document épais est le signe
d'un scan de mauvaise qualité.

> Un document très long est tronqué à 900 000 caractères (~350 pages) ; la
> fenêtre le dit explicitement.

Les documents rangés sur une [fiche deal](05-deals.md) suivent exactement le
même circuit et affichent la même colonne.

### Sous le capot : l'enrichissement automatique

À la création d'une participation avec un domaine web, un enrichissement
automatique remplit le pitch et le résumé depuis le site de la société. Il
est additif : il ne réécrit jamais un champ déjà renseigné à la main. Si
plusieurs entités partagent le même domaine (ex. plusieurs SPV du même
sponsor), une édition du pitch se propage à toutes pour qu'elles restent
identiques.

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
