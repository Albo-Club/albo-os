# Intégrations

## La page Intégrations (Réglages) — la tour de contrôle

Chaque organisation dispose d'une vue **Réglages → Intégrations**, le point
d'entrée unique des outils externes, présentés en deux groupes : **Installées**
(au moins une connexion, ou service opérationnel) et **Disponibles** (prêtes à
brancher).

- Les plateformes **par organisation** (banques via Powens, portails fonds
  type Parallel ou Teampact) affichent chaque connexion avec sa pastille
  d'état (connectée / en retard / à reconnecter / en erreur) et sa dernière
  synchronisation **réussie** (une connexion en erreur garde la date de son
  dernier succès — ou « Jamais synchronisée »). Une connexion en erreur
  affiche aussi le message d'erreur sous sa ligne, pour comprendre d'un coup
  d'œil ce qui bloque (identifiants refusés, portail injoignable…).
- Les **services partagés** (extraction Notion, DocSend) indiquent simplement
  s'ils sont opérationnels.

**Connecter et déconnecter se font depuis la page** (admins uniquement) :

- « Connecter une banque » ouvre la fenêtre sécurisée Powens (identifiants
  bancaires jamais saisis dans Albo OS) ; une connexion dégradée propose son
  bouton « Reconnecter » ici aussi (comme sur la Trésorerie) ;
- un portail investisseur se branche via un petit formulaire (nom, portail,
  identifiants) — les identifiants sont stockés côté serveur et ne
  redescendent jamais dans le navigateur ;
- une connexion de portail se **corrige sur place** (bouton crayon) : le même
  formulaire s'ouvre pré-rempli (nom, portail), les identifiants sont à
  ressaisir, et une synchronisation est relancée aussitôt pour vérifier que
  la connexion refonctionne — inutile de déconnecter puis reconnecter ;
- « Déconnecter » (avec confirmation) oublie les identifiants ; les données
  déjà importées restent en place.

Toute nouvelle plateforme déclarée au registre apparaîtra automatiquement
dans cette liste, formulaire de connexion compris.

## Attio (CRM dealflow)

**La frontière** : Attio est la source de vérité *avant* l'investissement
(dealflow, term sheets, notes) ; Albo OS *après* la signature. Albo OS
n'écrit jamais dans Attio.

**La synchro automatique** fonctionne au changement de stage dans Attio :

- **Term Sheet** → un deal *engagé* (pending) est créé dans Albo OS, avec la
  sortie de cash anticipée dans le prévisionnel ; si la société n'existe pas
  encore dans Albo OS, elle est créée automatiquement avec le nom et le
  domaine de la fiche société Attio ;
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

Chaque compte livré par une synchronisation est d'abord **rapproché des
comptes déjà connus** — par IBAN, sinon par banque et libellé identiques,
sinon parce que la banque n'a qu'un seul compte de votre côté. Reconnecter une
banque reprend donc la ligne existante, avec son historique et son pointage :
pas de banque en double. Quand deux comptes se ressemblent trop pour trancher,
rien n'est écrit — mieux vaut ne rien faire que se tromper de compte.

La santé de chaque connexion est **surveillée en continu** : état visible sur
la page Trésorerie (connectée / en retard / à reconnecter), alerte email quand
une connexion se dégrade, et bouton « Reconnecter » pour la rétablir sans
refaire toute la connexion. Un contrôle automatique interroge Powens toutes
les 6 heures, pour détecter aussi une connexion qui cesse silencieusement
d'envoyer des données (voir [Trésorerie](07-tresorerie.md)).

Une connexion qui ne dessert **aucun compte** — typiquement le reliquat d'une
tentative de connexion abandonnée — n'est pas une panne : elle passe en
« Obsolète », sans email ni bannière, et un bouton **Supprimer** la retire
définitivement (côté Powens comme dans l'app). Les comptes et les
transactions ne sont jamais touchés.

## Connecteur Claude (serveur MCP)

Albo OS expose ses données à des clients externes compatibles MCP —
principalement **claude.ai** — pour interroger le portefeuille sans ouvrir
l'app (« quelle est ma position de trésorerie ? », « liste mes deals
actifs »).

- **~24 outils de consultation** (deals, fiches sociétés, reportings des
  participations et synthèse IA, comptes, transactions, prévisionnel, passif,
  valorisations, KPIs, TVA…).
- **La documentation des participations est interrogeable** : pactes
  d'actionnaires, statuts, bulletins de souscription, PV d'assemblée, term
  sheets, comptes annuels, business plans. Une recherche par le sens («
  quelle est la clause de liquidité du pacte Sezame ? », « où ai-je un droit
  de préemption ? ») rend des extraits en citant le document d'origine, et
  le texte complet d'un document peut être lu au besoin. Seuls les documents
  dont le texte a été lu par l'app sont concernés — un scan illisible ou un
  fichier en échec de lecture reste invisible à la recherche.
- **4 outils d'écriture** : créer une société du portefeuille, créer un deal,
  compléter une société existante, compléter un deal existant. Ils servent à
  saisir une entité à partir d'une phrase dictée, sans ouvrir l'app. Tout le
  reste — suppressions, pointage, prévisionnel, passif — demeure hors de
  portée du connecteur.
- **Vous validez chaque écriture** : le connecteur déclare quels outils
  modifient les données, ce qui fait demander votre accord avant l'appel.
  Chaque écriture renvoie le lien de la fiche dans l'app pour relire ou
  corriger.
- **Avertissement sur les doublons** : une société qui ressemble à une fiche
  existante (même site, même nom à la forme juridique près) est quand même
  créée, mais les doublons possibles sont signalés avec leurs liens ; idem
  pour un deal entre le même investisseur et la même cible, qui peut
  légitimement être un second tour. Un SIREN déjà utilisé dans
  l'organisation, lui, est refusé.
- **Sécurisé par OAuth** : la connexion passe par la page de connexion
  habituelle d'Albo OS, et chaque utilisateur ne voit que les organisations
  dont il est membre.
- **Branchement** dans claude.ai : Réglages → Connecteurs → « Ajouter un
  connecteur personnalisé » → coller l'URL du serveur (`…/mcp`) → se
  connecter avec son compte Albo OS.

À ne pas confondre avec l'[assistant IA in-app](11-assistant-ia.md), qui
couvre bien plus de domaines en écriture et fait valider ses actions par des
boutons dans le panneau.

## Parallel / VASCO (communications SPV)

Pour les participations souscrites via un portail investisseur (Parallel,
Teampact…), la fiche société se rattache à l'émetteur correspondant depuis
son menu **⋯ → « Rattacher à une intégration »** — disponible sur toute
entité du portefeuille, quel que soit son nom. Le dialog montre les
plateformes rattachables et leur état de connexion réel (pastille rouge si
la connexion est en erreur), puis propose la liste des émetteurs à choisir ;
si la connexion est en erreur et qu'aucun deal ne peut être récupéré, le
sélecteur l'explique et renvoie vers Réglages → Intégrations. La liste propose
aussi bien les SPV ayant **déjà publié une communication** que ceux simplement
**détenus** dans le portefeuille Parallel : un SPV tout juste closé, encore sans
communication, est donc rattachable immédiatement (il apparaît après la
prochaine synchro ou un clic sur « Rafraîchir »). Une fois rattachée, les
**communications investisseurs** (annonces, documents) remontent dans la liste
« Rapports & communications » de la fiche — y compris si le rattachement a été fait
avant la première communication. Chacune s'y présente comme un rapport : une
bulle à sa date de publication, qu'un clic déplie sur le message complet et ses
pièces jointes, téléchargeables une par une depuis le portail. Un bouton
**« Rafraîchir VASCO »** apparaît en haut de la liste sur les fiches rattachées
uniquement ; une fiche non rattachée n'affiche rien.

Une communication **nouvelle** relance toute seule la synthèse IA de la société
concernée, exactement comme un reporting reçu par email : rien à cliquer. Seules
les sociétés dont l'émetteur a effectivement publié sont recalculées — une
synchronisation qui ne ramène rien ne relance rien. Rattacher une société à son
émetteur lance également son analyse dans la foulée, sans attendre la prochaine
publication. Aucun email n'est envoyé dans ces deux cas : personne n'a rien
transféré, il n'y a personne à qui répondre. Le rattachement (et le
détachement) se gèrent au même endroit qu'au départ : **⋯ → Intégrations**.

## Ingestion des rapports par email

Les investor updates transférés à l'adresse dédiée sont ingérés
automatiquement et alimentent la fiche société et sa synthèse IA. Le
circuit complet (forward, sécurité, sources lues, KPIs, récap) est décrit
dans [Reports par email](17-reports-par-email.md).

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
