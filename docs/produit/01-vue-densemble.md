# Vue d'ensemble

## Ce qu'est Albo OS

Albo OS est l'outil interne de pilotage du family office **CALTE** et de la
holding d'investissement **Albo Club**. C'est un outil de middle-office : il
centralise le suivi des participations, les mouvements bancaires, les
valorisations, les KPIs des sociétés investies, le prévisionnel de trésorerie
et le passif — avec un assistant IA branché sur toutes ces données.

Ce n'est **pas** un SaaS public : il est conçu pour une petite équipe
(aujourd'hui deux utilisateurs, Benjamin et Clément) qui pilote plusieurs
véhicules d'investissement.

## La frontière avec Attio

La règle d'attribution est simple et stricte :

- **Attio (le CRM) = source de vérité AVANT l'investissement** : dealflow,
  sourcing, notes de call, term sheets. Albo OS n'écrit jamais dans Attio.
- **Albo OS = source de vérité APRÈS la signature** : suivi de la
  participation, transactions, valorisations, KPIs, trésorerie.

Le passage de relais est automatisé : quand un deal atteint le stage
« Term Sheet » dans Attio, il apparaît dans Albo OS en statut *engagé*
(pending) ; quand il passe « Invested », il devient *actif*. Les détails sont
dans [Intégrations](15-integrations.md).

## Une société = une organisation

Chaque société du groupe est une **organisation** distincte dans Albo OS,
avec ses propres données, cloisonnées des autres : ses comptes bancaires, ses
investissements, son capital et ses comptes courants. CALTE, Albo Club, et
chacune des filiales — Caltimo, RDB, Relais Chapelle, les SCI, Banco 2 — ont
la leur.

Les organisations sont **à plat** : aucune n'est « dans » une autre. Ce qui
relie deux sociétés du groupe, ce sont des liens financiers, lisibles des
deux côtés : le capital détenu et les comptes courants. Une avance de CALTE à
une de ses filiales est donc un investissement du côté de CALTE, et une dette
du côté de la filiale — le même euro, vu des deux bords.

Créer une nouvelle société = créer une nouvelle organisation.
Un utilisateur peut être membre de plusieurs organisations et bascule de
l'une à l'autre via le sélecteur en haut de la barre latérale. Une
[vue consolidée](12-vue-consolidee.md) en lecture seule agrège toutes les
organisations de l'utilisateur.

## Les grandes briques

| Brique | Ce qu'elle couvre |
| --- | --- |
| **Portfolio** | Participations, deals, valorisations, KPIs, business plans |
| **Trésorerie** | Comptes bancaires (synchronisés via Powens), transactions, pointage, analyse |
| **Prévisionnel** | Flux récurrents et ponctuels, solde projeté, alertes |
| **Passif** | Capitaux propres, comptes courants inter-entités |
| **Assistant IA** | Copilote conversationnel sur les données de l'org, in-app et Telegram |
| **Intégrations** | Attio, Powens, connecteur Claude (MCP), Parallel/VASCO, ingestion email |

## Pages liées

- [Concepts de base](02-concepts-de-base.md) — le vocabulaire et les
  conventions à connaître avant tout le reste.
