# Compte et sécurité

## Se connecter

Trois façons d'entrer, sur la même page de connexion :

- **Email + mot de passe** (méthode principale). Mot de passe de 12
  caractères minimum, vérifié en temps réel contre la base de fuites « Have
  I Been Pwned » (un mot de passe compromis est refusé), avec jauge de
  robustesse.
- **Lien magique** : un email avec un lien qui connecte sans mot de passe.
  Réservé aux comptes **existants** — il ne crée jamais de compte.
- **Google** (si configuré sur l'instance).

À la création d'un compte, l'email doit être **vérifié** (lien envoyé par
email) avant de pouvoir se connecter. Exception : arriver par une
[invitation](14-organisations-membres-invitations.md) vaut vérification — le
lien d'invitation prouve la possession de la boîte mail.

**Mot de passe oublié** : saisie de l'email → lien de réinitialisation →
nouveau mot de passe. La réinitialisation déconnecte toutes les autres
sessions. Les messages restent volontairement neutres quel que soit l'email
saisi, pour ne pas révéler quels comptes existent.

## La page Profil (`/app/me`)

Trois onglets :

- **Profil** : avatar (upload/suppression), nom, et changement d'email — la
  confirmation part vers l'adresse **actuelle**, pour que le propriétaire
  légitime approuve avant que la nouvelle adresse soit active.
- **Sécurité** : s'envoyer un lien magique, gérer les comptes liés (Google),
  changer de mot de passe (déconnecte les autres sessions et notifie par
  email), se déconnecter, et la zone de danger : **supprimer le compte**
  (confirmé par email ; retire toutes les adhésions aux organisations).
- **Sessions** : la liste des appareils connectés, gérables.

## Langue et thème

Le choix de langue (**français / anglais**) et de thème (clair/sombre) se
fait dans la barre latérale. La langue choisie est mémorisée et sert aussi
pour les emails transactionnels (invitations, vérifications).

## Points d'attention

- Les tentatives sont limitées en débit sur tous les endpoints sensibles
  (connexion, inscription, réinitialisation).
- La première personne inscrite sur le déploiement devient automatiquement
  super-admin (voir
  [Organisations, membres et invitations](14-organisations-membres-invitations.md)).

## Pages liées

- [Organisations, membres et invitations](14-organisations-membres-invitations.md)
