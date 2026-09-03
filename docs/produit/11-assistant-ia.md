# Assistant IA

## À quoi ça sert

L'assistant est un copilote conversationnel branché sur **les données de
l'organisation active** : il répond aux questions (« combien a-t-on déployé
sur X ? », « où en est la trésorerie ? »), fait les saisies fastidieuses
(KPIs, business plans, valorisations), et aide au pointage. Il agit
uniquement dans l'organisation en cours, avec les droits de l'utilisateur
connecté.

## Le panneau

- **Ouverture** : ⌘J / Ctrl+J, ou le bouton IA dans l'en-tête. Panneau
  latéral droit sur desktop, plein écran sur mobile. Son état
  ouvert/fermé est mémorisé.
- **Contexte de navigation** : l'assistant sait sur quelle page vous êtes.
  Sur une fiche deal ou société, « ce deal » / « cette société » désigne
  l'entité affichée.
- **Conversations** : le titre du panneau déroule l'historique des
  conversations (privées à chaque utilisateur et organisation). Bouton +
  pour repartir de zéro, menu pour renommer ou supprimer.
- **Réponses en streaming**, bouton Stop, copie d'une réponse, et
  **suggestions contextuelles** sur conversation vide (adaptées à la page :
  pointage, trésorerie, participations…).
- Depuis la palette ⌘K, « Demander à l'IA » envoie directement la recherche
  saisie comme première question.

## Ce qu'il sait faire

Une soixantaine d'outils, par domaine :

- **Portfolio** : lister sociétés et deals (avec performance), consulter la
  fiche complète d'une société (secteur, pitch, identité légale, personnes,
  KPI suivis), créer une participation, créer/mettre à jour un deal, éditer
  une société, consulter le résumé du véhicule, lister les documents.
- **Reportings** : lire les comptes rendus reçus des participations
  (points clés, métriques extraites) et la synthèse IA d'une société — score
  de santé, insights, alertes, et lister les **boîtes silencieuses** (celles
  qui n'ont plus reporté depuis le délai fixé par l'organisation). En lecture
  seule : les reportings arrivent par email, ils ne se créent pas depuis le
  chat.
- **Valorisations et KPIs** : consulter l'historique, enregistrer une
  valorisation ou un KPI depuis un reporting.
- **Business plans** : lire et remplacer les lignes d'un BP (version
  initiale ou révisée) — coller un BP dans le chat suffit.
- **Trésorerie** : comptes, transactions d'un deal, recherche de
  transactions avec totaux, création de transaction ou de compte.
- **Pointage** : lister la file, rapprocher à un deal ou au passif,
  catégoriser (jusqu'à 50 lignes en une approbation), dépointer, position
  TVA. Il **ne propose pas** de cible : vous la nommez, il l'applique.
- **Passif** : consulter les positions et soldes, créer/éditer capital et
  comptes courants.
- **Dette bancaire** : lister les prêts avec leur **capital restant dû** et
  l'échéancier de l'un d'eux ; créer un prêt, ajouter un **palier de taux**
  sur un prêt variable, enregistrer un **avenant** daté. Ce qui se saisit,
  ce sont les conditions du contrat — jamais le restant dû, qui en découle.
- **Garanties** : lire une sûreté depuis n'importe lequel de ses trois côtés
  (le prêt, l'actif, le garant), consulter la **marge disponible** sur un
  placement gagé ; créer une sûreté sur un prêt, enregistrer une
  **mainlevée** (qui n'est pas une suppression : la ligne reste).
- **Immobilier** : lister les biens avec leur prix de revient poste par
  poste et la source de chacun ; créer un bien, basculer la source d'un
  poste, ajouter une valorisation datée. Les loyers, charges et rendements
  ne se saisissent jamais — ils viennent des flux pointés.
- **Prévisionnel** : règles, échéances, solde projeté, réalisation d'une
  échéance, écritures ponctuelles.
- **Contenu des documents et reports** : recherche par le sens (pas par
  mots-clés) dans tous les documents de l'organisation (pactes, term
  sheets, BP, reportings…) et dans les reports reçus par email — « que dit
  le pacte de X sur la liquidité ? », « quelles boîtes ont parlé de
  recrutement ? ». L'assistant cite les documents sources dans sa réponse.
- **Mode d'emploi de l'app** : cette documentation. À « comment marche le
  pointage ? » ou « comment annuler un deal ? », l'assistant lit la page
  concernée et répond avec, en la nommant — au lieu de deviner depuis ses
  outils. C'est une lecture distincte de celle de vos documents : le pacte de
  X relève de la recherche dans les documents, le fonctionnement de l'app de
  celle-ci.

## Les approbations : Confirmer / Refuser

Toute action qui **modifie la base** s'arrête avant d'écrire : l'assistant
annonce ce qu'il va faire, et l'interface affiche deux boutons
**Confirmer / Refuser** sous l'appel d'outil. Confirmer exécute et la
réponse reprend ; Refuser fait demander à l'assistant ce qu'il faut changer.
Rien ne s'écrit jamais sans un clic explicite.

Les **suppressions** ne passent pas par l'assistant (à une exception près,
réversible : la suppression d'une règle de prévisionnel). Pour supprimer un
deal, une société, un compte ou une position, il renvoie vers l'interface.

## Telegram

Le même assistant — mêmes outils, même cloisonnement par organisation, mêmes
approbations (boutons Confirmer/Refuser dans le chat) — est accessible via un
bot Telegram, pour interroger ou saisir en mobilité.

## Points d'attention

- L'assistant convertit automatiquement les montants (vous parlez en euros,
  il stocke en centimes) et répond dans votre langue.
- Il ne pointe jamais une transaction de sa propre initiative, et il ne
  devine pas la cible : vous indiquez la transaction **et** sa destination,
  il exécute après votre approbation. Si la cible est ambiguë, il demande —
  il ne choisit pas à votre place (cf. [Pointage](08-pointage.md)). Sur un
  **bien**, il demande aussi la nature du flux, pour la même raison.
- **Toute écriture demande votre accord**, sans exception — y compris les
  nouveaux outils sur les prêts, les garanties et les biens.
- **Les suppressions ne passent pas par l'assistant.** Supprimer un prêt,
  une garantie ou un bien reste un geste de l'application. Une **mainlevée**
  n'est pas une suppression : elle est disponible, et elle conserve la ligne.
- Sur la fiche d'un **prêt** ou d'un **bien**, l'assistant sait de quoi vous
  parlez quand vous dites « ce prêt » ou « ce bien » — comme il le faisait
  déjà sur une fiche deal ou société.

## Pages liées

- [Pointage](08-pointage.md), [Deals](05-deals.md) (business plans),
  [Intégrations](15-integrations.md) (interroger Albo OS depuis Claude)
- [Dette bancaire et garanties](18-dette-et-garanties.md) et
  [Immobilier](20-immobilier.md) — les domaines ouverts à l'assistant
