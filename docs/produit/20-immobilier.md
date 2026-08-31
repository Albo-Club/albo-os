# Immobilier

## À quoi ça sert

Albo OS savait ce que le groupe possède en participations et en placements,
et ce qu'il doit à ses banques. Il sait maintenant répondre à : **« que
possède cette société en immobilier, combien ça vaut, et combien ça
rapporte ? »**

Un bien immobilier n'est pas une ligne d'investissement comme une autre. Il
a un prix de revient qui se construit dans le temps, une valeur qui bouge,
des loyers et des charges qui passent en banque — et il peut être **mis en
gage** pour obtenir un prêt. C'est cette dernière raison qui a rendu le
module nécessaire : sans objet « bien », impossible de saisir le privilège de
prêteur de deniers d'une SCI sur son propre immeuble.

L'Immobilier est le **troisième onglet** d'Investissements, à côté
d'Entreprises et de [Placements](19-placements.md). Il n'ajoute aucune entrée
dans le menu de gauche : un bien reste un investissement, il fausserait
simplement les multiples du portefeuille s'il était rangé avec les
participations.

## Comment ça marche

### La liste des biens

Une ligne par bien : son nom, son adresse, son type, son usage, son prix de
revient, son rendement net et sa valeur. Le total en bas ne compte que les
biens **détenus** — additionner la dernière valeur connue d'un bien déjà
vendu compterait de l'argent qui est sorti.

Un bien vendu reste dans la liste, estompé. C'est de l'histoire, pas quelque
chose sur quoi agir.

### Saisir un bien

Ce qui se saisit, ce sont les caractéristiques du bien : nom, adresse, type
(appartement, maison, immeuble, local commercial, terrain), usage, surface,
date d'acquisition.

L'**usage** porte plus qu'il n'en a l'air. « Marchand de biens » n'est pas un
objet séparé — c'est un usage, parce qu'un bien peut en changer et que 80 %
des informations sont les mêmes. Quand il est choisi, la fiche masque
l'exploitation et met en avant le prix de revient et le résultat de sortie :
un bien acheté pour être revendu ne s'exploite pas, son résultat se lit à la
revente.

Ce qui **ne se saisit pas** : les loyers, les charges, la rentabilité, la
plus-value. Tous viennent des transactions pointées et des valorisations. Il
n'y a nulle part où les taper, et c'est voulu — un chiffre saisi se
désynchronise, un chiffre calculé ne peut pas.

### Le prix de revient, et son interrupteur

C'est le cœur du module. Le prix de revient d'un bien se compose de trois
postes : **acquisition**, **frais d'acquisition**, **travaux**.

Chaque poste porte **un seul montant**, et ce montant vient d'**une seule
source** :

| Source | Ce que le montant vaut |
|---|---|
| **Saisi** | Le montant que vous avez tapé. |
| **N flux** | La somme des transactions pointées sur ce bien avec cette nature. |

**Jamais l'addition des deux.** C'est la règle la plus importante de la page.

Et le choix se fait **poste par poste**, pas globalement — parce que les deux
cas coexistent sur le même bien. Un immeuble acquis en 2019 a un prix
d'acquisition qui ne sera jamais dans l'application : la connexion bancaire
ne remonte pas si loin. Ses travaux de 2024, eux, sont de vrais virements
pointés. Un interrupteur unique obligerait à sacrifier l'un ou l'autre.

La colonne **Source** de la fiche est l'interrupteur : cliquer dessus bascule
le poste. Le montant saisi est **conservé** quand vous passez aux flux — vous
pouvez revenir sans rien retaper.

Quand des flux sont pointés sur un poste resté en « Saisi », la fiche le
**signale** au lieu de les cacher : « 2 flux pointés sur ce poste ne sont pas
comptés ». Ils ne sont pas additionnés, mais vous savez qu'ils existent.

### L'exploitation

Loyers encaissés, charges payées, résultat net — sur les **12 mois
glissants**, et uniquement à partir de **flux pointés**. Un bien sans
transaction rattachée affiche zéro, pas une estimation.

Les échéances de prêt ne sont **jamais** des charges du bien : elles sont
rattachées au prêt, pas au bien. Sinon la même sortie d'argent serait comptée
deux fois.

Le rendement net est le résultat rapporté au prix de revient.

### Les valorisations

Un historique daté, saisi à la main. **Aucune estimation automatique** — pas
de service tiers qui devinerait la valeur d'un bien. La source est un texte
libre : « estimation agence », « notaire », « à dire d'expert ».

La plus-value latente est la différence entre la dernière valeur connue et le
prix de revient. Tant qu'aucune valorisation n'existe, elle est **inconnue**,
pas nulle — l'application ne prétend pas savoir.

Une estimation saisie deux fois à la même date remplace la précédente : une
date, une valeur.

### Emprunt lié & sûreté

Les sûretés qui portent sur ce bien, avec le prêt que chacune couvre, **ce
qu'il reste à devoir dessus et jusqu'à quand**. Une sûreté seule ne dit rien
de l'exposition : c'est la dette qu'elle garantit qui la porte. Le restant dû
est recalculé à chaque lecture, jamais stocké. Un crédit révolving n'affiche
d'échéance finale que si le contrat lui en donne une — il n'en a pas par
nature.

C'est la **même ligne** que celle affichée sur la fiche du prêt, lue de
l'autre côté — rien n'est saisi deux fois, donc les deux vues ne peuvent pas
diverger. Voir [Dette bancaire et garanties](18-dette-et-garanties.md).

On ne crée pas une sûreté depuis ici : elle se saisit depuis le prêt qu'elle
garantit, là où son bénéficiaire est sans ambiguïté.

### Pointer un flux sur un bien

Dans la file de [Pointage](08-pointage.md), le sélecteur « Affecter à… »
propose désormais un groupe **Biens** à côté des Deals, des Prêts, des
Capitaux propres et des Comptes courants.

Choisir un bien ouvre un second temps : la **nature de la dépense**. C'est le
seul endroit du pointage où l'application pose une deuxième question, et elle
est nécessaire — sans elle, l'application ne saurait pas si les 40 000 €
sortis sont des travaux, des charges ou une partie du prix.

| Sens | Natures proposées | Ce que ça alimente |
|---|---|---|
| Sortie | Acquisition, Frais d'acquisition, Travaux | le prix de revient |
| Sortie | Charges | l'exploitation |
| Entrée | Loyer | l'exploitation |
| Entrée | Revente | la plus-value réalisée |

**Une transaction, un bien, une seule nature.** On ne la découpe jamais. Un
virement au notaire qui couvre le prix et les droits part entier en
« Acquisition » ; pour garder le détail sur un bien ancien, on laisse les
deux postes en source « Saisi ».

Comme partout dans le pointage : rien n'est proposé, rien n'est
pré-sélectionné, rien n'est classé par vraisemblance. L'application liste,
vous choisissez.

Le tableau **Transactions** de la fiche porte un bouton **« Détacher »** par
ligne. La fiche défait un pointage, elle n'en fait jamais : détacher renvoie
le mouvement dans la file, où vous choisissez sa cible **et** sa nature — un
flux immobilier ne peut pas changer de cible sans que la seconde question
soit reposée.

### Vendre un bien

Le statut passe à « Vendu », avec une date et un prix. Le bien reste listé et
sa fiche affiche son **résultat de sortie** — le taux de rendement interne
calculé sur les flux datés réels, avec la même méthode que le TRI des deals.

Un prix de vente sans date (ou l'inverse) est refusé : une demi-vente
produirait un résultat silencieusement faux.

## L'assistant IA

L'assistant sait **lire** les biens : leur prix de revient poste par poste
avec la source de chacun, la dernière valeur connue, la plus-value latente et
le rendement net.

Il sait aussi **écrire** : créer un bien, basculer la source d'un poste,
ajouter une valorisation datée, et rattacher un flux à un bien — en
demandant alors la nature de la dépense, comme le ferait la file de
pointage. **Chaque écriture demande votre accord.**

Ce qu'il ne fait pas : supprimer un bien (geste de l'application), ni saisir
un loyer, une charge ou un rendement — ils n'existent nulle part comme champ.

Sur la fiche d'un bien, il sait de quoi vous parlez quand vous dites « ce
bien ».

## Points d'attention

- **Tous les montants sont TTC.** Ils viennent de flux bancaires, TTC par
  nature. Reconstituer du hors taxes obligerait à ventiler la TVA poste par
  poste, sans gain sur un locatif nu.
- **Un poste, une source.** Si un chiffre vous semble trop bas, regardez
  d'abord la colonne Source : le poste est peut-être en « Saisi » alors que
  les flux sont pointés, ou l'inverse.
- **Le prix de revient est au centime, la valeur est arrondie à l'euro.**
  L'un vient de la banque, l'autre est une estimation — les centimes y
  suggéreraient une précision qui n'existe pas.
- **La marge disponible sur un bien gagé est pessimiste.** Un montant inscrit
  à l'acte ne diminue pas quand la dette se rembourse : il vaut son montant
  jusqu'à la mainlevée.
- **Un bien gagé ne se supprime pas.** Il faut d'abord détacher la sûreté.
  Même chose s'il porte des transactions pointées ou des documents.
- **Pas de gestion locative.** Ni quittances, ni appels de loyer, ni
  indexation, ni états des lieux. Un bien est suivi comme un actif, pas comme
  un bail.

## Pages liées

- [Dette bancaire et garanties](18-dette-et-garanties.md) — les prêts que les
  biens garantissent, et la lecture d'une sûreté des deux côtés.
- [Pointage](08-pointage.md) — le geste qui alimente le prix de revient et
  l'exploitation.
- [Placements](19-placements.md) et [Participations](04-participations.md) —
  les deux autres onglets d'Investissements.
- [À faire](16-a-faire.md) — le signal des biens dont la valeur a vieilli.
- [Assistant IA](11-assistant-ia.md) — ce qu'il sait lire et écrire ici.
