# Participations

## À quoi ça sert

La section Participations (`/app/<org>/participations`) est la vue du
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
  sheet)** en ambre tout en haut, **Actives** en bleu, **Exit win** en
  vert, **Exit loss** en rouge. Un tableau vide ne s'affiche pas — pas de
  term sheet en cours, pas de tableau ambre.
- **Colonnes réduites à l'essentiel** : logo et nom, **score IA de santé**
  (1 à 10), nombre de deals, montant investi, montant reçu, **TVPI**, et le
  secteur en badge en dernière colonne. Le tableau des term sheets affiche
  l'**engagé prévisionnel** à la place (rien n'est encore décaissé) ; les
  deux tableaux d'exits remplacent le TVPI par **MOIC** et **TRI**
  annualisé. Tri par colonne sur les Actives, clic vers la fiche ; pas de
  pagination — chaque tableau défile sous son en-tête et ses totaux.
- **Ligne de totaux par tableau** : nombre de deals et montants, sommés sur
  la section entière et recalculés en direct quand un filtre ou une
  recherche est actif. La somme des exits gagnants et celle des pertes se
  lisent directement au pied de leurs tableaux.
- **Recherche et filtres** : recherche plein texte (société, deal,
  instrument, investisseur, secteur) et filtres multi-sélection par
  instrument et secteur — le filtre statut a disparu, les tableaux par
  statut jouent ce rôle. Export CSV de l'ensemble (généré à la demande).
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
  tendance — la santé de la boîte est la première chose qu'on voit. Elle
  est régénérée automatiquement à chaque rapport ingéré, et peut être
  relancée à la main.
- **Deals de la société** : un tableau au même style que la liste des
  participations (liseré de statut dans la marge de chaque ligne — ambre
  term sheet, bleu actif, vert Exit win, rouge Exit loss —, date de
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
  max, avec période couverte), téléchargement, suppression.

Le panneau d'identité, à droite :

- **Identité** : secteur, SIREN, domaine — éditables en ligne (clic sur la
  valeur) — plus le % de détention, le nombre d'actions consolidé et un
  lien « Ouvrir dans Attio » quand la société est liée au CRM, suivi du
  résumé de la société.
- **Personnes** : fondateurs, board, co-investisseurs — avec lien vers la
  fiche Attio quand la personne y est rattachée. L'édition passe par le
  dialogue Éditer, qui propose une recherche dans les personnes Attio.

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
