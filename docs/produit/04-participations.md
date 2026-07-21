# Participations

## À quoi ça sert

La section Participations (`/app/<org>/participations`) est la vue du
portefeuille **par société** : une ligne = une société, quel que soit le
nombre de deals réalisés dessus. C'est le point d'entrée vers les fiches
sociétés, leurs rapports et leurs documents.

## La liste

- **Tableau des participations actives** : logo et nom, pitch (une ligne),
  secteur, **score IA de santé** (pastille en anneau de 1 à 10, jauge remplie
  selon la note et colorée selon le verdict, issue de la synthèse IA), nombre
  de deals, montant investi, montant reçu, **TVPI**. Tri par colonne (dont le
  score IA), pagination, clic vers la fiche.
- **Recherche et filtres** : recherche plein texte (société, deal,
  instrument, investisseur, secteur) et filtres multi-sélection par
  instrument, statut et secteur. Export CSV de l'ensemble.
- **Section « Soldées »** : les sociétés dont les deals sont sortis ou passés
  en perte, avec badge gagné/perdu et colonnes **MOIC** et **TRI** annualisé.
- **Section « Sans deal »** : les entités du portefeuille pas encore
  rattachées à un deal.
- **Section « Archivées »** : les entités archivées, restaurables en un clic.
- **Créer une entité** (menu ⋯) : nom + SIREN ; l'entité créée est toujours
  une société de portefeuille (les entités du groupe ne se créent pas ici).

## La fiche société

En-tête : logo, nom, nature, % de détention global. Puis :

- **Identité** : secteur, SIREN, domaine — éditables en ligne (clic sur la
  valeur) — plus le nombre d'actions consolidé et un lien « Ouvrir dans
  Attio » quand la société est liée au CRM.
- **Personnes** : trois colonnes — fondateurs, board, co-investisseurs — avec
  lien vers la fiche Attio quand la personne y est rattachée. L'édition passe
  par le dialogue Éditer, qui propose une recherche dans les personnes Attio.
- **Deals de la société** : blocs détaillés cliquables vers chaque
  [fiche deal](05-deals.md). Un deal se crée depuis cette fiche (menu ⋯) ; le
  formulaire propose d'emblée **tous les champs de l'instrument** choisi
  (montant, dates dont le closing, tour, valorisations, titres acquis…) pour
  tout renseigner en une fois.
- **Synthèse IA** : score de santé, résumé exécutif, alerte critique
  éventuelle, points forts / points de vigilance, trois KPIs avec tendance.
  Elle est régénérée automatiquement à chaque rapport ingéré, et peut être
  relancée à la main.
- **Onglet Rapports** : les communications investisseurs — celles ingérées
  automatiquement par email (investor updates analysés : highlights,
  métriques, contenu) et celles remontées depuis Parallel/VASCO pour les SPV
  (voir [Intégrations](15-integrations.md)).
- **Onglet Documents** : upload manuel (reporting, BP, légal, autre — 20 Mo
  max, avec période couverte), téléchargement, suppression.

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
