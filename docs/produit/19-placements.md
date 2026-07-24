# Placements

## À quoi ça sert

La page Placements (`/app/<org>/placements`, entrée « Placements » de la
barre latérale) regroupe la **trésorerie placée** : crypto, comptes de
capitalisation, dépôts à terme, comptes-titres. Ces lignes ne sont pas des
participations — on ne les suit pas avec des valorisations de tours ou un
TVPI, mais comme des **comptes** : un solde que l'on met à jour, et une
performance calculée automatiquement (dans l'esprit d'un Finary).

C'est pour ça qu'elles ont leur propre page et ne figurent plus dans la
liste [Entreprises](04-participations.md).

## Comment ça marche

- **Quatre tuiles de synthèse** : solde total, versé net (versements moins
  retraits), plus-value latente (en euros et en %), rendement annualisé.
- **Une ligne par placement** : nom et banque/plateforme, type, date
  d'ouverture, versé, retiré, solde, plus-value, rendement annualisé. Les
  montants sont au centime (ce sont des soldes de comptes). Un clic sur la
  ligne ouvre la fiche du deal.
- **Mettre à jour un solde** : cliquer sur le solde, saisir le nouveau
  montant, Entrée. C'est le geste central de la page — le reste se recalcule
  tout seul.
- Les colonnes « versé » et « retiré » viennent des transactions bancaires
  pointées sur le deal (voir [Pointage](08-pointage.md)) ; le rendement
  annualisé est le taux de rendement interne (XIRR) de ces flux datés plus
  le solde actuel.

### Sous le capot : l'historique des soldes

Chaque mise à jour d'un solde est aussi enregistrée comme une valorisation
datée du deal. Le solde construit donc une série dans le temps — la base
d'une future courbe d'évolution.

## Points d'attention

- Un placement **sans solde renseigné** affiche « — » et n'entre ni dans la
  plus-value ni dans le rendement globaux (il compterait sinon comme une
  perte totale, à tort). Renseigner le solde une première fois suffit.
- Le rendement annualisé suppose que les versements et retraits sont bien
  pointés en banque ; un flux non pointé fausse le calcul.
- La [vue consolidée](12-vue-consolidee.md) (`/app/all`) ne distingue pas
  encore les placements : ils y restent listés avec le reste des deals.

## Pages liées

- [Deals](05-deals.md) (la fiche détail d'un placement),
  [Pointage](08-pointage.md) (rattacher les versements/retraits),
  [Trésorerie](07-tresorerie.md) (les comptes bancaires courants)
