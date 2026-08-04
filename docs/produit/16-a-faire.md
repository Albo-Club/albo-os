# À faire

## À quoi ça sert

L'onglet **À faire** (`/app/<org>/todo`) rassemble sur une seule page tout
ce qui attend une action dans l'organisation, au lieu de le laisser dispersé
dans les onglets. C'est la page à ouvrir en début de journée : si tout est
vide, rien n'est en attente.

## Comment ça marche

La page empile cinq blocs :

1. **Connexions bancaires dégradées** — la même bannière que sur la
   Trésorerie : si une banque demande une reconnexion ou n'a pas synchronisé
   depuis trop longtemps, elle apparaît en haut avec un bouton vers l'écran
   de gestion. Rien ne s'affiche quand tout est sain.
2. **Tâches** — les tâches manuelles de l'organisation, groupées par
   statut : **À faire**, **En cours** (anneau orange) et **Fait** (coche
   verte, titre barré). Un clic sur l'indicateur rond fait passer la tâche
   au statut suivant. Le bouton « Nouvelle tâche » (ou la touche **T**)
   ouvre le formulaire de création : titre, et en option une société du
   portefeuille (badge cliquable vers sa fiche), une personne assignée et
   une date d'échéance (en rouge quand elle est dépassée). Chaque groupe
   est trié par échéance ; les tâches faites restent visibles 30 jours
   puis sortent de la liste sans être supprimées.
3. **Transactions à pointer** — le compteur de la file de
   [pointage](08-pointage.md), avec un aperçu des dernières transactions en
   attente et un bouton qui ouvre le registre de la Trésorerie déjà filtré
   sur « À pointer ».
4. **Échéances en retard** — les entrées du [prévisionnel](09-previsionnel.md)
   dont la date est passée sans qu'elles soient réalisées ni annulées (même
   définition que le badge « En retard » du registre) ; le bouton ouvre le
   même registre filtré.
5. **Reportings manquants** — les participations dont aucun rapport n'est
   arrivé depuis plus de **4 mois** (délai réglable par organisation dans
   Réglages → Général). Chaque ligne renvoie vers la fiche de la société.

Tous les blocs sauf les tâches sont **automatiques** : un item disparaît de
lui-même dès que l'action est faite (transaction pointée, banque
reconnectée, échéance réalisée, rapport reçu).

## Points d'attention

- Le bloc « Reportings manquants » ne surveille que les participations qui
  portent encore un deal en cours : une position entièrement sortie, ou une
  société archivée, n'y apparaît pas. Le délai est mesuré sur la **date de
  réception** de la dernière nouvelle, pas sur la période couverte — sinon
  une société qui reporte au trimestre paraîtrait en retard le lendemain de
  son envoi.
- Une **communication publiée sur le portail** de l'émetteur (les SPV
  Parallel et consorts) compte exactement comme un rapport reçu par email :
  ces sociétés n'envoient jamais de mail, elles publient. Encore faut-il que
  l'entité soit **reliée à son émetteur** dans ses Intégrations — sans ce
  lien, ses publications restent invisibles et l'alerte se déclenche à tort.
- Une société qui **n'a jamais** donné de nouvelles est comptée depuis le
  **versement des fonds** (le premier décaissement pointé en banque, à
  défaut la date de signature du deal) : des fonds versés il y a deux
  semaines ne doivent encore rien.
- Le même signal apparaît dans la liste des participations, sous forme de
  pastille d'alerte à côté du nom de la société.
- Les tâches manuelles sont partagées entre les membres de l'organisation
  (pas de tâches privées).
- Un récapitulatif hebdomadaire par email (tâches en attente + rapports
  reçus) est envisagé en complément — non livré à ce stade.

## Pages liées

- [Pointage](08-pointage.md) — la file de rapprochement qu'alimente le bloc 3
- [Trésorerie](07-tresorerie.md) — connexions bancaires et transactions
- [Prévisionnel](09-previsionnel.md) — les échéances et leur rapprochement
- [Participations](04-participations.md) — les fiches sociétés et leurs rapports
