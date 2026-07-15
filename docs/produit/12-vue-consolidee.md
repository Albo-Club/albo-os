# Vue consolidée (toutes les organisations)

## À quoi ça sert

La vue « Toutes les organisations » (`/app/all`) agrège en **lecture seule**
les portefeuilles de toutes les organisations dont vous êtes membre. C'est la
photo consolidée du groupe : idéale pour comparer, chercher, exporter — pas
pour éditer.

On y accède depuis le sélecteur d'organisation (entrée « Toutes les
organisations »).

## Ce qu'elle contient

- **Participations consolidées** : la même vue que par organisation, avec une
  colonne **Organisation** en plus (badge sur chaque ligne).
- **Deals consolidés** : idem, à plat, tous véhicules confondus, triés par
  date de signature.
- **Rapports entrants** : la boîte de réception des emails de reporting
  reçus des participations — voir ci-dessous.

Chaque ligne garde ses métriques calculées (investi, reçu, TVPI, MOIC, TRI)
exactement comme dans la vue par organisation. Toute **édition** se fait dans
la vue de l'organisation concernée : un clic sur une ligne y renvoie.

## La boîte des rapports entrants

Les investor updates reçus par email arrivent dans cette boîte : expéditeur,
sujet, participation rapprochée automatiquement, état de l'extraction et
pièces jointes. Pour les lignes que le rapprochement automatique n'a pas su
traiter (« à revoir » ou rejetées), trois actions : **Assigner** à une
société, **Retraiter**, **Rejeter**. Le contenu analysé alimente ensuite la
fiche société ([Participations](04-participations.md) : rapports, synthèse
IA, KPIs).

## Points d'attention

- Une nouvelle organisation apparaît ici **automatiquement** dès que vous en
  devenez membre — rien à configurer.
- La vue est strictement en lecture : aucun bouton de création ni d'édition.

## Pages liées

- [Participations](04-participations.md), [Deals](05-deals.md),
  [Intégrations](15-integrations.md) (ingestion des rapports par email)
