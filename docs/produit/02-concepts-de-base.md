# Concepts de base

## Organisations et rôles

Une **organisation** = une société du groupe (voir la
[vue d'ensemble](01-vue-densemble.md)). Toutes les données métier — deals,
sociétés, transactions, prévisionnel, passif — appartiennent à une
organisation et ne sont visibles que par ses membres.

Trois rôles, du plus au moins puissant : **owner**, **admin**, **member**.
En pratique : tout le monde consulte et saisit la donnée métier ; la gestion
de l'organisation elle-même (nom, logo, membres, invitations) est réservée
aux admins/owners. Le détail des permissions est dans
[Organisations, membres et invitations](14-organisations-membres-invitations.md).

Il existe aussi un statut **super-admin**, indépendant des organisations, qui
donne accès à l'administration de la plateforme entière.

## Entités du groupe vs participations

Toutes les sociétés vivent dans le même annuaire, mais deux natures se
distinguent :

- **Entités du groupe** : les sociétés juridiques *de l'organisation
  elle-même* — sa société racine (CALTE dans l'organisation CALTE, Albo Club
  dans Albo…), et le cas échéant ses SPV. Ce sont elles qui investissent et
  qui portent les comptes bancaires : **l'investisseur d'un deal est toujours
  une entité du groupe**. Elles ne peuvent pas être supprimées.
- **Participations** (portfolio) : les sociétés *dans lesquelles* on a
  investi — startups, fonds, SPV externes, SCPI.

À ne pas confondre : l'**organisation** est l'espace (le contenant) ; les
**entités du groupe** sont les sociétés juridiques qui y vivent (le contenu).
Une filiale apparaît donc à deux endroits : dans son organisation à elle, et
dans celle de CALTE au titre de ce que CALTE y a investi. C'est voulu — c'est
déjà le cas d'Albo Club.

## Conventions de données

Quelques conventions traversent toute l'application :

- **Montants** : stockés en centimes d'euro, toujours en nombres entiers.
  L'affichage fait la conversion — vous ne manipulez jamais les centimes.
  Ils sont affichés **au centime** là où le montant est réel et doit se
  recouper avec la banque (transactions, soldes, pointage, comptes courants,
  TVA, royalties, versé/reçu d'un deal), et **arrondis à l'euro** là où c'est
  une estimation ou du pilotage (valorisations, KPIs, engagement,
  prévisionnel).
- **Taux** : stockés en points de base (1100 = 11 %). Même principe :
  l'affichage montre des pourcentages.
- **Devise** : l'euro partout par défaut. Les soldes et le prévisionnel
  n'agrègent que l'EUR ; le non-EUR est compté à part pour visibilité.
- **Dates** : stockées en UTC, affichées en local.
- **Montants toujours positifs** : sur une transaction, le sens (entrée ou
  sortie) est porté séparément du montant.

## Naviguer dans l'application

- **Barre latérale gauche** (repliable, ⌘B) : le sélecteur d'organisation en
  haut (avec l'entrée « Toutes les organisations »), puis les sections
  À faire, Investissements (deux sous-onglets : Entreprises et Placements),
  Trésorerie, Passif, et l'espace de travail (Paramètres, Nouveautés). En
  pied : le menu utilisateur. Les deals s'ouvrent depuis la fiche d'une
  participation — ils n'ont plus d'entrée dédiée dans le menu.
- **Palette de commandes** (⌘K) : recherche globale dans l'organisation —
  deals, sociétés, transactions — avec navigation directe vers la fiche, et
  l'action « Demander à l'IA » qui transmet la requête à l'assistant.
- **Assistant IA** (⌘J) : panneau latéral droit persistant, décrit dans
  [Assistant IA](11-assistant-ia.md).

## Pages liées

- [Vue d'ensemble](01-vue-densemble.md)
- [Organisations, membres et invitations](14-organisations-membres-invitations.md)
