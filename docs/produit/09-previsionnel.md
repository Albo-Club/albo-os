# Prévisionnel de trésorerie

## À quoi ça sert

Le prévisionnel projette le solde de trésorerie du véhicule dans le temps, à
partir de deux sources : les **règles récurrentes** (loyers, salaires,
échéances de dette, abonnements) et les **écritures ponctuelles** (appels de
fonds, distributions, impôts one-shot). Il vit dans la
[Trésorerie](07-tresorerie.md) : les soldes projetés à 30/90 jours, la
courbe et les échéances (dans le registre unique, au-dessus du séparateur
« Aujourd'hui ») sur la **Vue d'ensemble**, la gestion des règles, échéances
ponctuelles et alertes dans l'onglet **Gestion**. Le rapprochement
d'une échéance avec une transaction réelle, lui, est un geste de
[pointage](08-pointage.md) et se fait au-dessus du registre.

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

- **Soldes projetés à 30 et 90 jours** en tête de la Vue d'ensemble :
  solde disponible + net des échéances attendues de la fenêtre (retards
  inclus), chacun détaillé en une petite somme entrées + sorties = net.
- **Courbe de solde projeté** sur 6, 12 ou 24 mois (Vue d'ensemble) : une
  seule trajectoire, le réel en trait plein puis le projeté en pointillé,
  en tenant compte de **tout** le prévisionnel (confirmé, attendu,
  probable). Le réalisé du mois **consomme** le prévu de la même
  catégorie, pour ne jamais compter deux fois le même flux ; les échéances
  en retard roulent sur le mois courant (toujours attendues, juste en
  retard).
- **Capital engagé non appelé** (onglet Gestion) : le capital restant à
  déployer sur les deals signés (engagé moins versé) — typiquement les
  fonds à appels progressifs et les tranches à venir. Ces obligations
  réelles mais **sans date** ne sont jamais inventées dans des mois ;
  créer une échéance ponctuelle est le geste pour dater un appel. Les
  petits écarts de virement (moins de 1 % de l'engagé : arrondis, frais)
  ne sont pas des appels à venir et sont ignorés.
- **Fiabilité** : chaque début de mois, une photo du solde projeté est prise
  automatiquement ; le mois suivant, elle est comparée au réel pour mesurer
  la fiabilité de la projection.
- Le point de départ est le **solde disponible** (comptes actifs, non
  nantis, en euros).

## Le rapprochement au réalisé

Il se fait depuis la ligne de l'échéance, dans « Échéances ponctuelles » :
pointer une échéance sur une transaction est de la même nature que pointer
une transaction sur un deal.

L'action « **Marquer réalisée** » ouvre la liste des transactions de
l'organisation, de la plus récente à la plus ancienne, avec une recherche
libre par libellé ou contrepartie. **Vous choisissez la transaction** :
l'outil ne présélectionne rien et ne classe rien par vraisemblance.

Si la transaction paye moins que prévu, deux issues explicites : clore avec
l'écart (le montant prévu est conservé, l'écart reste lisible), ou **garder
le reste attendu** — l'échéance est réalisée au montant payé et le reliquat
devient une nouvelle échéance ponctuelle.

Albo OS **suggérait** autrefois ces rapprochements automatiquement, dans les
deux sens. Ces propositions ont été retirées : elles se trompaient en
silence. Le [pointage](08-pointage.md) explique pourquoi et ce qui est prévu
ensuite.

## Alertes

- **Alerte de trésorerie** : « me prévenir par email si le solde disponible
  ou un mois projeté (3 mois) passe sous X € ». Le seuil se règle par
  organisation ; le franchissement est signalé dans le **point hebdo du
  lundi matin** (voir plus bas). Tant que le seuil est franchi, une
  bannière rouge l'affiche aussi en tête de la Vue d'ensemble — celle-là
  est immédiate et visible de tous.
- **Échéances à venir** : les 90 prochains jours vivent dans le registre,
  au-dessus du séparateur « Aujourd'hui » (statut « Prévu » en bleu) ; une
  échéance en retard descend à sa date avec un statut « En retard » en
  ambre, et fait partie du filtre « À pointer ». Une échéance devenue sans
  objet s'**annule** directement depuis sa ligne du registre (occurrences
  de règles récurrentes comprises), avec confirmation : elle sort du solde
  projeté.
- **Le point hebdo du lundi matin** : **deux emails séparés** — un pour
  Albo, un pour Calte et ses filiales (une section par société à
  l'intérieur), pour ne jamais mélanger deux bilans dans le même mail. Une
  famille qui n'a rien à dire n'envoie rien du tout. Chacun rassemble les
  seuils de trésorerie franchis, les échéances en retard (celles dépassées
  de plus d'un jour sans avoir été rapprochées) et **les reports reçus dans
  la semaine, une carte par société** : logo, période couverte, note de
  santé de la boîte et deux points clés du report — avec les liens pour
  aller traiter ce qui doit l'être. Rien à signaler = pas d'email. Chacun
  choisit les trois morceaux qu'il veut y voir depuis **Réglages →
  Membres** ; qui coupe les trois ne reçoit plus le point hebdo du tout.
  Voir
  [Organisations, membres et invitations](14-organisations-membres-invitations.md)
  et [Reports par email](17-reports-par-email.md).

## Points d'attention

- Le prévisionnel est **en euros uniquement** ; le non-EUR est signalé à
  part.
- Rapprocher une échéance ne pointe pas la transaction (et inversement) : ce
  sont deux registres distincts — l'un projette, l'autre qualifie le réel.

## Pages liées

- [Trésorerie](07-tresorerie.md), [Pointage](08-pointage.md),
  [Deals](05-deals.md)
