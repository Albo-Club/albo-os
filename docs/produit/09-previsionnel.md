# Prévisionnel de trésorerie

## À quoi ça sert

Le prévisionnel projette le solde de trésorerie du véhicule dans le temps, à
partir de deux sources : les **règles récurrentes** (loyers, salaires,
échéances de dette, abonnements) et les **écritures ponctuelles** (appels de
fonds, distributions, impôts one-shot). Il est réparti sur trois onglets de
la [Trésorerie](07-tresorerie.md) : la courbe et les indicateurs dans
**Vue d'ensemble**, le détail (échéances à venir, rapprochements, grille
mois par mois — réalisé passé et projection future dans le même tableau)
dans **Prévisionnel**, et la gestion des règles, échéances ponctuelles,
TVA et alertes dans **Règles & échéances**.

## Règles et écritures

- Une **règle récurrente** décrit une cause : libellé, montant, sens,
  catégorie, fréquence (hebdo/mensuel/trimestriel/annuel), jour d'ancrage,
  dates de début/fin, deal lié éventuel (loyers SCPI, coupons). Les règles
  génèrent automatiquement des **échéances datées** sur l'horizon.
- Une **écriture ponctuelle** est une échéance saisie directement, avec un
  niveau de confiance (confirmé / attendu / probable).
- Chaque échéance a un statut : **en attente** (comptée dans la projection),
  **réalisée** (rattachée à une transaction réelle) ou **annulée**.
- Albo OS **suggère des règles** en détectant les flux récurrents des 24
  derniers mois non couverts : dès 2 occurrences pour un flux trimestriel
  ou annuel (3 pour un mensuel/hebdo), montants variables acceptés — le
  montant proposé est la médiane et la fourchette observée est affichée.
  La création reste un geste humain (dialogue pré-rempli).

### Sous le capot : une génération qui respecte vos retouches

La génération des échéances depuis les règles est relançable sans risque :
elle ne duplique jamais rien, met à jour les échéances intactes quand la
règle change, et **ne touche jamais** une échéance éditée à la main, réalisée
ou annulée. Supprimer une règle supprime ses échéances futures intactes mais
conserve l'historique (réalisées, annulées, retouchées).

## La projection

- **Courbe de solde projeté** sur 6, 12 ou 24 mois (Vue d'ensemble), avec
  deux scénarios : *engagé seul* (les flux confirmés) et *avec planifié*.
  Quand une alerte de seuil est active, le seuil apparaît en ligne
  pointillée sur la courbe.
- **Grille catégories × mois** (onglet Prévisionnel) fusionnant réalisé,
  engagé et planifié, avec
  la ligne de solde. Le réalisé du mois **consomme** le prévu de la même
  catégorie, pour ne jamais compter deux fois le même flux. Les échéances en
  retard roulent sur le mois courant (toujours attendues, juste en retard).
- **Capital engagé non appelé** : le capital restant à déployer sur les
  deals signés (engagé moins versé) — typiquement les fonds à appels
  progressifs et les tranches à venir. Ces obligations réelles mais **sans
  date** sont affichées à côté de la courbe, jamais inventées dans des
  mois. Les petits écarts de virement (moins de 1 % de l'engagé : arrondis,
  frais) ne sont pas des appels à venir et sont ignorés.
- **Fiabilité** : chaque début de mois, une photo du solde projeté est prise
  automatiquement ; le mois suivant, elle est comparée au réel pour mesurer
  la fiabilité de la projection.
- Le point de départ est le **solde disponible** (comptes actifs, non
  nantis, en euros).

## Le rapprochement au réalisé

Quand une transaction réelle correspond à une échéance attendue, Albo OS le
**suggère** (fenêtres de date, montant et libellé) : rapprochement en un clic
si les montants sont égaux, sinon un dialogue propose de clôturer avec écart
ou de **garder le reliquat** (paiement partiel : l'échéance est réalisée au
montant payé et le reste devient une nouvelle échéance ponctuelle). Si
l'échéance est liée à un deal et la transaction pas encore pointée, la
suggestion propose aussi de pointer la transaction sur le deal dans la
foulée — deux gestes distincts.

## Alertes et TVA

- **Alerte de trésorerie** : « me prévenir par email si le solde disponible
  ou un mois projeté (3 mois) passe sous X € ». Vérifiée chaque matin, avec
  une pause de 7 jours après chaque alerte envoyée. Tant que le seuil est
  franchi, une bannière rouge l'affiche aussi en tête de la Vue d'ensemble.
- **Échéance TVA suggérée** : quand la TVA du dernier trimestre clos est à
  payer, Albo OS propose de créer l'échéance correspondante (sortie
  « impôts », due le 24 du mois suivant le trimestre). Jamais créée toute
  seule.
- **Échéances à venir** : la liste des 90 prochains jours, retards en tête
  (tête de l'onglet Prévisionnel), avec les entrées, sorties et net à 30 et
  90 jours dans le bandeau de la Vue d'ensemble.
- **Digest « échéances en retard »** : quand une échéance attendue dépasse
  sa date de plus d'un jour sans être rapprochée, un email récapitule
  toutes les échéances en retard (avec le lien vers le prévisionnel pour
  les traiter). Un seul envoi quand de nouvelles échéances passent en
  retard — pas de rappel quotidien pour le même stock.

## Points d'attention

- Le prévisionnel est **en euros uniquement** ; le non-EUR est signalé à
  part.
- Rapprocher une échéance ne pointe pas la transaction (et inversement) : ce
  sont deux registres distincts — l'un projette, l'autre qualifie le réel.

## Pages liées

- [Trésorerie](07-tresorerie.md), [Pointage](08-pointage.md),
  [Deals](05-deals.md)
