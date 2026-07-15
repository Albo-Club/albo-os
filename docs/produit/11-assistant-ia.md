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

Une quarantaine d'outils, par domaine :

- **Portfolio** : lister sociétés et deals (avec performance), créer une
  participation, créer/mettre à jour un deal, éditer une société, consulter
  le résumé du véhicule, lister les documents.
- **Valorisations et KPIs** : consulter l'historique, enregistrer une
  valorisation ou un KPI depuis un reporting.
- **Business plans** : lire et remplacer les lignes d'un BP (version
  initiale ou révisée) — coller un BP dans le chat suffit.
- **Trésorerie** : comptes, transactions d'un deal, recherche de
  transactions avec totaux, création de transaction ou de compte.
- **Pointage** : lister la file, suggérer des cibles, rapprocher à un deal
  ou au passif, catégoriser (jusqu'à 50 lignes en une approbation),
  dépointer, position TVA.
- **Passif** : consulter les positions et soldes, créer/éditer capital et
  comptes courants.
- **Prévisionnel** : règles, échéances, solde projeté, réalisation d'une
  échéance, écritures ponctuelles.

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
- Il ne pointe jamais une transaction de sa propre initiative : chaque
  rapprochement est proposé puis approuvé.

## Pages liées

- [Pointage](08-pointage.md), [Deals](05-deals.md) (business plans),
  [Intégrations](15-integrations.md) (interroger Albo OS depuis Claude)
