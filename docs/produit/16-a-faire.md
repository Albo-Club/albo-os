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
2. **Tâches** — une liste de tâches manuelles propre à l'organisation :
   on ajoute une tâche en une ligne, on la coche quand c'est fait, on la
   supprime quand elle n'a plus lieu d'être. Les tâches faites restent
   visibles barrées, en bas de liste.
3. **Transactions à pointer** — le compteur de la file de
   [pointage](08-pointage.md), avec un aperçu des dernières transactions en
   attente et un bouton qui ouvre directement l'onglet Transactions de la
   Trésorerie.
4. **Échéances en retard** — les entrées du [prévisionnel](09-previsionnel.md)
   dont la date est passée sans qu'elles soient réalisées ni annulées (même
   définition que le badge « En retard » de l'onglet Prévisionnel).
5. **Reportings manquants** — les participations qui envoyaient des rapports
   et n'en ont plus envoyé **depuis plus de 3 mois**. Chaque ligne renvoie
   vers la fiche de la société.

Tous les blocs sauf les tâches sont **automatiques** : un item disparaît de
lui-même dès que l'action est faite (transaction pointée, banque
reconnectée, échéance réalisée, rapport reçu).

## Points d'attention

- Le bloc « Reportings manquants » ne surveille que les participations qui
  ont **déjà envoyé au moins un rapport** et qui portent encore un deal en
  cours : une société qui n'a jamais reporté, ou une position entièrement
  sortie, n'y apparaît pas. Le délai est mesuré sur la **date de réception**
  du dernier rapport, pas sur la période couverte.
- Les tâches manuelles sont partagées entre les membres de l'organisation
  (pas de tâches privées).
- Un récapitulatif hebdomadaire par email (tâches en attente + rapports
  reçus) est envisagé en complément — non livré à ce stade.

## Pages liées

- [Pointage](08-pointage.md) — la file de rapprochement qu'alimente le bloc 3
- [Trésorerie](07-tresorerie.md) — connexions bancaires et transactions
- [Prévisionnel](09-previsionnel.md) — les échéances et leur rapprochement
- [Participations](04-participations.md) — les fiches sociétés et leurs rapports
