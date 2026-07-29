# Placements

## À quoi ça sert

La page Placements (`/app/<org>/placements`, second sous-onglet de la
section **Investissements** de la barre latérale, à côté d'Entreprises)
regroupe la **trésorerie placée** : crypto, comptes de capitalisation,
dépôts à terme, comptes-titres. Ces lignes ne sont pas des participations —
on ne les suit pas avec des valorisations de tours ou un TVPI, mais comme
des **comptes** : un solde que l'on met à jour, et une performance calculée
automatiquement (dans l'esprit d'un Finary).

C'est pour ça qu'elles ont leur propre page et ne figurent plus dans la
liste [Entreprises](04-participations.md). À l'inverse, les comptes
rémunérés à disponibilité immédiate (compte booster, monétaire rapatrié)
restent des comptes bancaires côté [Trésorerie](07-tresorerie.md) : c'est
du cash disponible tout de suite, pas un placement.

## Comment ça marche

- **Quatre tuiles de synthèse** : solde total, versé net (versements moins
  retraits), plus-value latente (en euros et en %), rendement annualisé.
- **Un tableau par liquidité**, empilés dans l'ordre : **Liquide** (bandeau
  vert), **Semi-liquide** (ambre), **Non liquide** (gris). Une section vide
  ne s'affiche pas. Le classement est déduit du type — compte-titres et
  crypto en liquide, dépôt à terme en semi-liquide, compte de capitalisation
  en non liquide — et se corrige placement par placement depuis sa fiche
  (un DAT à 5 ans peut passer en non liquide).
- **Une ligne par placement** : nom et banque/plateforme, type, date
  d'ouverture, versé, retiré, solde, plus-value, rendement annualisé. Les
  montants sont au centime (ce sont des soldes de comptes). Un clic sur la
  ligne ouvre la **fiche placement**.
- **Mettre à jour un solde** : cliquer sur le solde, saisir le nouveau
  montant, Entrée. C'est le geste central de la page — le reste se recalcule
  tout seul.
- Les colonnes « versé » et « retiré » viennent des transactions bancaires
  pointées sur le deal (voir [Pointage](08-pointage.md)) ; le rendement
  annualisé est le taux de rendement interne (XIRR) de ces flux datés plus
  le solde actuel.

## La fiche placement

Un placement s'ouvre sur une **fiche légère** (pas la fiche deal complète
d'une participation) : l'en-tête (nom, banque, type, date d'ouverture) avec
la **liquidité modifiable**, les quatre tuiles du compte, l'**historique du
solde** (chaque mise à jour crée un point daté) et les **transactions
pointées** sur le placement.

Le **contenu de l'enveloppe** (les titres d'un compte-titres, les supports
d'un contrat de capitalisation) n'est pas encore affiché : il arrivera avec
la connexion Powens Wealth, qui remonte les positions (ISIN, quantité,
valorisation) des comptes d'investissement.

### Sous le capot : l'historique des soldes

Chaque mise à jour d'un solde est aussi enregistrée comme une valorisation
datée du deal. Le solde construit donc une série dans le temps — visible
sur la fiche placement, et la base d'une future courbe d'évolution.

## Points d'attention

- Un placement **sans solde renseigné** affiche « — » et n'entre ni dans la
  plus-value ni dans le rendement globaux (il compterait sinon comme une
  perte totale, à tort). Renseigner le solde une première fois suffit.
- Le rendement annualisé suppose que les versements et retraits sont bien
  pointés en banque ; un flux non pointé fausse le calcul.
- La [vue consolidée](12-vue-consolidee.md) (`/app/all`) ne distingue pas
  encore les placements : ils y restent listés avec le reste des deals.

## Pages liées

- [Entreprises](04-participations.md) (l'autre sous-onglet
  d'Investissements), [Pointage](08-pointage.md) (rattacher les
  versements/retraits), [Trésorerie](07-tresorerie.md) (les comptes
  bancaires courants)
