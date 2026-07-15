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
  menu par membre (dans le respect des règles ci-dessus).
- **Invitations** (admin/owner) : envoyer une invitation (email + rôle) et
  révoquer celles en attente.

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
