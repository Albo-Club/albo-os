# Intégrations

## Attio (CRM dealflow)

**La frontière** : Attio est la source de vérité *avant* l'investissement
(dealflow, term sheets, notes) ; Albo OS *après* la signature. Albo OS
n'écrit jamais dans Attio.

**La synchro automatique** fonctionne au changement de stage dans Attio :

- **Term Sheet** → un deal *engagé* (pending) est créé dans Albo OS, avec la
  sortie de cash anticipée dans le prévisionnel ;
- **Invested** → le même deal passe *actif* et l'échéance prévisionnelle est
  confirmée (elle se réalisera quand le vrai virement sera pointé).

Deux garde-fous : un deal ne se crée **qu'au Term Sheet** (un « Invested »
inconnu est ignoré — c'est ce qui a permis d'activer la synchro sans
ré-importer le portefeuille existant), et une fois un deal actif, Attio ne
peut plus écraser ses données financières.

Côté interface : lien « Ouvrir dans Attio » sur les fiches sociétés liées, et
recherche dans les personnes Attio (fondateurs, board, co-investisseurs) dans
le dialogue d'édition d'une société.

## Powens (agrégation bancaire)

Powens synchronise automatiquement comptes et transactions. La connexion à la
banque (identifiants + authentification forte) se fait dans la fenêtre
sécurisée de Powens, jamais dans Albo OS. Après chaque synchronisation,
Powens notifie Albo OS, qui met à jour les soldes et ingère les nouvelles
transactions — sans jamais dupliquer ni écraser le pointage déjà fait (voir
[Trésorerie](07-tresorerie.md)).

Chaque connexion bancaire est rattachée à la bonne organisation et à l'entité
titulaire du compte.

La santé de chaque connexion est **surveillée en continu** : état visible sur
la page Trésorerie (connectée / en retard / à reconnecter), alerte email quand
une connexion se dégrade, et bouton « Reconnecter » pour la rétablir sans
refaire toute la connexion. Un contrôle automatique interroge Powens toutes
les 6 heures, pour détecter aussi une connexion qui cesse silencieusement
d'envoyer des données (voir [Trésorerie](07-tresorerie.md)).

## Connecteur Claude (serveur MCP)

Albo OS expose ses données à des clients externes compatibles MCP —
principalement **claude.ai** — pour interroger le portefeuille sans ouvrir
l'app (« quelle est ma position de trésorerie ? », « liste mes deals
actifs »).

- **Strictement en lecture seule** : ~18 outils de consultation (deals,
  sociétés, comptes, transactions, prévisionnel, passif, valorisations,
  KPIs, TVA…), aucune écriture.
- **Sécurisé par OAuth** : la connexion passe par la page de connexion
  habituelle d'Albo OS, et chaque utilisateur ne voit que les organisations
  dont il est membre.
- **Branchement** dans claude.ai : Réglages → Connecteurs → « Ajouter un
  connecteur personnalisé » → coller l'URL du serveur (`…/mcp`) → se
  connecter avec son compte Albo OS.

À ne pas confondre avec l'[assistant IA in-app](11-assistant-ia.md), qui lui
peut écrire (avec approbation).

## Parallel / VASCO (communications SPV)

Pour les SPV souscrits via Parallel, la fiche société peut être liée à
l'émetteur correspondant : les **communications investisseurs** (annonces,
documents) remontent alors dans l'onglet Rapports de la fiche, avec
téléchargement des documents et rafraîchissement à la demande.

## Ingestion des rapports par email

Les investor updates reçus par email sont ingérés automatiquement : le
contenu est extrait, rapproché de la bonne participation, analysé
(highlights, métriques, période), et vient alimenter la fiche société et sa
synthèse IA. Les cas ambigus atterrissent dans la boîte
[Rapports entrants](12-vue-consolidee.md) pour assignation manuelle.

## Imports historiques (ponctuels)

À la reprise de l'existant, deux imports one-shot ont été réalisés — la base
Airtable historique (deals, transactions, comptes, prévisionnel de CALTE) et
le portefeuille déjà investi depuis Attio. Ils sont relançables sans créer de
doublons, mais ce sont des opérations ponctuelles, à la différence d'Attio et
Powens qui sont des flux continus. Un import CSV de l'historique Mémo Bank
existe aussi.

## Pages liées

- [Trésorerie](07-tresorerie.md), [Deals](05-deals.md),
  [Participations](04-participations.md), [Assistant IA](11-assistant-ia.md)
