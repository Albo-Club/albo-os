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

## Un véhicule d'investissement = une organisation

Chaque véhicule est une **organisation** distincte dans Albo OS, avec ses
propres données, cloisonnées des autres :

- l'organisation **calte** : CALTE et ses entités (Caltimo, RDB, Relais
  Chapelle, les SCIs, Banco 2…) ;
- l'organisation **albo** : Albo Club.

Créer un nouveau véhicule d'investissement = créer une nouvelle organisation.
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
