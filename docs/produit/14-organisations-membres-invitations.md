# Organisations, membres et invitations

## Créer une organisation

À la première connexion sans organisation, l'**onboarding** propose d'en
créer une : un nom et un slug (l'identifiant dans l'URL, vérifié en direct :
disponible, réservé ou déjà pris). Le créateur devient **owner**. Le slug ne
se change plus ensuite.

## Les rôles

| Action | Member | Admin | Owner |
| --- | :-: | :-: | :-: |
| Consulter les données et la liste des membres | ✅ | ✅ | ✅ |
| Saisir la donnée métier (deals, transactions, pointage…) | ✅ | ✅ | ✅ |
| Modifier nom et logo de l'organisation | ❌ | ✅ | ✅ |
| Inviter, révoquer une invitation | ❌ | ✅ | ✅ |
| Changer le rôle d'un membre, retirer un membre | ❌ | ✅ | ✅ |
| Promouvoir un owner, gérer un owner | ❌ | ❌ | ✅ |
| Connecter une banque | ❌ | ✅ | ✅ |

Garde-fous : impossible de rétrograder ou retirer le **dernier owner** ; un
admin ne peut pas se modifier lui-même ; une invitation ne peut proposer que
member ou admin (jamais owner directement).

## Les réglages d'organisation

Trois onglets dans Paramètres :

- **Général** : nom (admin/owner), slug (lecture seule), logo, et le délai
  d'alerte reporting — le nombre de mois sans rapport reçu au-delà duquel une
  participation est signalée comme silencieuse (4 mois par défaut).
- **Membres** : la liste avec rôle ; changement de rôle et retrait via un
  menu par membre (dans le respect des règles ci-dessus). Plus bas, la
  carte **Alertes par email** (voir ci-dessous).
- **Invitations** (admin/owner) : envoyer une invitation (email + rôle) et
  révoquer celles en attente.

## Qui reçoit quels emails

Sous la liste des membres, un tableau croise **les personnes** et **les six
emails récurrents** que l'application envoie :

| Alerte | Ce qui la déclenche |
| --- | --- |
| Seuil de trésorerie | Le solde projeté des 3 prochains mois passe sous le seuil de l'organisation. Arrive dans le point hebdo du lundi. |
| Échéances en retard | Des échéances attendues sont dépassées et toujours non rapprochées. Arrive dans le point hebdo du lundi. |
| Connexion bancaire | Une connexion bancaire tombe en panne ou cesse de se synchroniser. Envoyé sur le moment. |
| Échec d'indexation | Un document n'a pas pu être indexé pour la recherche de l'assistant IA. Envoyé sur le moment. |
| Reports de la semaine | Le nombre de reports rangés sur les participations. Arrive dans le point hebdo du lundi. |
| Problèmes de reports | Les emails de la file Rapports entrants : quarantaine, échec de traitement, suite donnée à un mail assigné à la main. Envoyé sur le moment. Cette case décide **aussi** de ce que tu reçois pour les reports que tu transfères toi-même (voir plus bas). |
| Nouveaux reports | Un report d'une de tes participations vient d'être rangé, transféré ou déposé par quelqu'un d'autre. Envoyé sur le moment. Rien n'est envoyé pour un report déjà présent ni pour un retraitement. |

Trois choses à savoir :

- **Tout est activé par défaut**, y compris pour un nouveau membre. C'est
  un désabonnement, pas un abonnement.
- **Les réglages suivent la personne, pas l'organisation.** Décocher une
  case ici la décoche partout ; l'écran le rappelle. On ne peut pas
  recevoir les alertes de Calte et couper celles d'Albo.
- Un admin règle la ligne de tout le monde ; chacun règle la sienne.

Ce que ce tableau **ne coupe pas** : les emails qui répondent à un geste
qu'on vient de faire — invitation, lien de connexion, et la réponse au
transfert d'un report. Ces derniers arrivent toujours, mais leur contenu
dépend de la case « Problèmes de reports » :

- **Case décochée** → tu reçois la confirmation quand le report est rangé
  (société, fiche, points clés, synthèse de la boîte), et un message court
  quand ça coince : il n'est pas passé, l'équipe s'en occupe. Sans la cause,
  sans lien, sans rien à faire.
- **Case cochée** → la même confirmation, plus le **contrôle qualité**
  (sources lues, KPIs cibles, valeurs inhabituelles), et le message
  actionnable (cause + lien vers la file) quand ça coince.

C'est ce qui permet de confier à quelqu'un le seul rôle de **transférer
des reports** : il sait si son report est passé ou non, il ne voit jamais
le diagnostic, qui part à ceux qui gèrent la file. Voir
[Reports par email](17-reports-par-email.md).

Une règle particulière sur cette case : **elle ne peut pas être décochée
partout**. Quelqu'un doit rester destinataire des erreurs, sinon le message
envoyé au transféreur (« l'équipe a été prévenue ») serait faux et l'échec
n'atteindrait personne. La liste de ceux qui les reçoivent est écrite en
clair sous le tableau.

## Le workflow d'invitation

1. Un admin/owner saisit l'email et le rôle. Un email part (dans la langue
   du destinataire s'il a déjà un compte, sinon celle de l'inviteur).
2. L'invitation est valable **7 jours** ; une seule invitation en attente par
   email et par organisation.
3. Le lien d'acceptation s'adapte à la situation : pas de compte → mini
   inscription pré-remplie (l'email est déjà vérifié par le lien) ; compte
   existant jamais activé → la personne choisit son mot de passe sur place et
   rejoint dans la foulée ; compte existant non connecté → connexion, avec
   « mot de passe oublié » et le renvoi de l'e-mail de vérification à portée ;
   déjà connecté avec le bon email → acceptation automatique ; connecté avec
   un autre email → écran « mauvais compte ».
4. À l'acceptation, la personne devient membre avec le rôle prévu. Rouvrir le
   lien ne casse rien.

Dans tous les cas l'invité repart avec un compte complet — adresse vérifiée et
mot de passe qu'il a choisi — avec lequel il se reconnecte ensuite normalement.
Une invitation ne demande jamais un mot de passe que personne n'a défini.

## Super-admin (`/app/admin`)

Le statut **super-admin** est indépendant des organisations : c'est
l'administration de la plateforme. Le tout premier utilisateur du déploiement
l'obtient automatiquement. La page montre les statistiques globales
(utilisateurs, organisations, adhésions, invitations en attente), la liste de
toutes les organisations et de tous les utilisateurs, et permet
d'**accorder / retirer** le statut super-admin (impossible de se retirer si
l'on est le dernier).

## Pages liées

- [Compte et sécurité](13-compte-et-securite.md),
  [Concepts de base](02-concepts-de-base.md)
