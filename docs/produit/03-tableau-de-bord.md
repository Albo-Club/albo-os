# Tableau de bord

## À quoi ça sert

Le tableau de bord (`/app/<org>`) est la page d'accueil d'une organisation :
une photo synthétique du véhicule — valeur du portefeuille, capital déployé,
trésorerie, activité récente. Il est en lecture seule.

## Ce qu'il affiche

- **Carte principale** : la **valorisation estimée du portefeuille (NAV)** en
  format compact (le montant exact apparaît en infobulle), le **TVPI** du
  portefeuille, et une courbe de tendance de la NAV. Si certaines
  participations n'ont pas de valorisation connue, la carte signale que la
  NAV est partielle.
- **Quatre tuiles** :
  - **Capital déployé** (avec le nombre de participations) ;
  - **Distribué** (avec le ratio DPI) ;
  - **Trésorerie** (avec le nombre de comptes bancaires) ;
  - **Participations** (avec le nombre de deals actifs).
- **Allocation** : le capital déployé réparti par type d'instrument (actions,
  obligations, fonds, SCPI…), en barres proportionnelles.
- **Activité récente** : les dernières transactions bancaires (sens, libellé,
  date, compte ou deal, montant), avec un lien vers la Trésorerie.

## Points d'attention

- La NAV vaut : dernière valorisation connue de chaque deal actif, ou à
  défaut son coût. Les deals soldés comptent pour zéro. Le calcul détaillé
  est dans [Valorisations, KPIs et métriques](06-valorisations-et-kpis.md).
- Les chiffres de trésorerie reprennent le périmètre « disponible » (comptes
  actifs, non nantis) décrit dans [Trésorerie](07-tresorerie.md).

## Pages liées

- [Participations](04-participations.md), [Deals](05-deals.md),
  [Trésorerie](07-tresorerie.md)
