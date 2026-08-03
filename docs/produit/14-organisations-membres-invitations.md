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

- **Général** : nom (admin/owner), slug (lecture seule), logo.
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

- **Case décochée** → tu reçois **« Report bien reçu »**, le même message
  que le report se soit rangé ou non.
- **Case cochée** → tu reçois le récapitulatif détaillé quand c'est rangé,
  et le message actionnable (cause + lien vers la file) quand ça coince.

C'est ce qui permet de confier à quelqu'un le seul rôle de **transférer
des reports** : il reçoit toujours le même accusé, sans jamais voir une
erreur, qui part à ceux qui gèrent la file. Voir
[Reports par email](17-reports-par-email.md).

## Le workflow d'invitation

1. Un admin/owner saisit l'email et le rôle. Un email part (dans la langue
   du destinataire s'il a déjà un compte, sinon celle de l'inviteur).
2. L'invitation est valable **7 jours** ; une seule invitation en attente par
   email et par organisation.
3. Le lien d'acceptation s'adapte à la situation : pas de compte → mini
   inscription pré-remplie (l'email est déjà vérifié par le lien) ; compte
   existant non connecté → connexion ; déjà connecté avec le bon email →
   acceptation automatique ; connecté avec un autre email → écran « mauvais
   compte ».
4. À l'acceptation, la personne devient membre avec le rôle prévu. Rouvrir le
   lien ne casse rien.

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
