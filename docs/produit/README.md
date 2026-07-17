# Documentation produit — Albo OS

Cette documentation explique **comment fonctionne Albo OS**, fonctionnalité
par fonctionnalité, pour quelqu'un qui n'a pas construit l'outil. Elle décrit
l'**état courant** de l'application — contrairement au
[changelog](../../CHANGELOG_PRODUIT.md), qui est le journal chronologique de
ce qui a changé.

Chaque page suit le même gabarit : *à quoi ça sert*, *comment ça marche*
(parcours utilisateur), *points d'attention*, et les liens vers les
fonctionnalités connexes. Le langage est produit ; quand un mécanisme interne
aide à comprendre (calcul d'un solde, synchronisation bancaire), il est
expliqué simplement dans un encadré « Sous le capot ».

## Sommaire

### Prise en main

| Page | Contenu |
| --- | --- |
| [Vue d'ensemble](01-vue-densemble.md) | Ce qu'est Albo OS, pour qui, la frontière avec Attio |
| [Concepts de base](02-concepts-de-base.md) | Organisations, entités du groupe vs participations, conventions, navigation |

### Portfolio

| Page | Contenu |
| --- | --- |
| [Tableau de bord](03-tableau-de-bord.md) | NAV, TVPI, capital déployé, activité récente |
| [Participations](04-participations.md) | Sociétés du portefeuille, fiches, synthèse IA, rapports |
| [Deals](05-deals.md) | Investissements, instruments, sorties, royalties, business plans |
| [Valorisations, KPIs et métriques](06-valorisations-et-kpis.md) | Juste valeur, snapshots KPI, MOIC / TVPI / TRI |

### Trésorerie

| Page | Contenu |
| --- | --- |
| [Trésorerie](07-tresorerie.md) | Comptes bancaires, transactions, analyse mensuelle |
| [Pointage](08-pointage.md) | Rapprochement des transactions, catégorisation, TVA |
| [Prévisionnel](09-previsionnel.md) | Règles récurrentes, solde projeté, rapprochement au réalisé, alertes |
| [Passif](10-passif.md) | Capitaux propres, comptes courants inter-entités |

### Transverse

| Page | Contenu |
| --- | --- |
| [Assistant IA](11-assistant-ia.md) | Le copilote ⌘J, ses outils, les approbations, Telegram |
| [Vue consolidée](12-vue-consolidee.md) | Toutes les organisations en lecture seule, boîte des rapports |
| [Compte et sécurité](13-compte-et-securite.md) | Connexion, profil, mot de passe, sessions |
| [Organisations, membres et invitations](14-organisations-membres-invitations.md) | Rôles, réglages d'org, invitations, super-admin |
| [Intégrations](15-integrations.md) | Attio, Powens, connecteur Claude (MCP), Parallel/VASCO, imports |
| [À faire](16-a-faire.md) | Tâches manuelles et signaux à traiter (pointage, banques, échéances, reportings) |
| [Reports par email](17-reports-par-email.md) | Le circuit complet des investor updates : forward, extraction, KPIs, récap |

## Comment cette doc vit

- **Source de vérité** : ce dossier (`docs/produit/`), versionné avec le code.
  Toute PR qui ajoute, modifie ou retire une fonctionnalité visible met à jour
  la page correspondante **dans la même PR** (règle dans `CLAUDE.md`,
  audit doc pré-PR).
- **Miroir Linear** : les pages sont recopiées dans les documents du projet
  Linear « Albo OS » pour lecture confortable. En cas d'écart, ce dossier
  fait foi.
