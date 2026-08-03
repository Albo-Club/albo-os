# Trésorerie

## À quoi ça sert

La page Trésorerie (`/app/<org>/cash`) centralise les comptes bancaires du
véhicule et toutes les transactions. Deux onglets :

- **Vue d'ensemble** — tout le quotidien en un seul écran, dans cet ordre :
  le **solde disponible aujourd'hui** puis les **soldes projetés à 30 et
  90 jours** (chacun détaillé en une petite somme entrées + sorties = net),
  la **courbe de solde** passé → futur, les **comptes** (avec le logo de
  leur banque, les comptes clôturés listés en dessous, atténués), et
  enfin le **registre unique** : les échéances prévisionnelles à venir
  au-dessus du séparateur « Aujourd'hui », toutes les transactions réelles
  en dessous. Si une connexion bancaire est en panne ou si le seuil
  d'alerte est franchi, une **bannière** le signale en tête de page.
- **Gestion** — tout ce qui se configure : règles récurrentes, échéances
  ponctuelles, capital engagé non appelé, alerte de seuil, connexions
  bancaires.

Le chiffre qui compte est le **solde projeté**, pas la somme brute des
entrées/sorties : c'est lui qui ouvre la page. Le cash **non liquide**
(contrats de capitalisation, comptes nantis…) est hors du disponible ; une
ligne sous les comptes en rappelle le total et renvoie vers les
[Placements](19-placements.md).

## La courbe de solde

La Vue d'ensemble trace **une seule trajectoire** : le solde du compte, mois
par mois. En trait plein le passé (le solde réellement constaté), en
pointillé le futur (le solde projeté en tenant compte de **tout** le
prévisionnel — confirmé, attendu et probable). C'est donc la trajectoire à
laquelle s'attendre, pas un scénario prudent : ce qui est probable pèse
dessus comme le reste.

La courbe est **verte tant que le solde est positif et rouge dès qu'il passe
sous zéro** — le moment du basculement se lit d'un coup d'œil. L'horizon se
choisit à 6, 12 ou 24 mois.

Un sous-titre rappelle le solde de départ et, dès qu'un mois est écoulé, la
**fiabilité** de la projection : ce qui avait été projeté pour le mois
dernier, ce qui a été réellement constaté, et l'écart.

## Comptes bancaires

Chaque compte appartient à une **entité du groupe** (la société titulaire).
Deux origines :

- **Comptes connectés** via Powens (agrégation bancaire) : soldes et
  transactions se synchronisent automatiquement. La connexion se lance avec
  le bouton « Connecter une banque » (réservé aux admins) et se fait dans la
  fenêtre sécurisée de la banque — Albo OS ne voit jamais les identifiants
  bancaires.
- **Comptes manuels** (sans connexion) : le solde s'édite à la main. Un badge
  distingue les deux ; l'édition manuelle du solde est bloquée sur un compte
  connecté (la synchro l'écraserait).

Chaque compte connecté affiche la **fraîcheur de sa dernière synchronisation**
(« synchro il y a 3 h ») ; le texte passe en orange au-delà de 48 h sans
donnée fraîche. Les comptes manuels affichent la date de saisie du solde.

Trois états particuliers changent les calculs :

- **Nanti** : fonds bloqués (nantissement, séquestre) — le solde est
  **exclu du disponible** et du prévisionnel. Le compte quitte carrément la
  page Trésorerie : de l'argent bloqué est de l'argent long terme, il vit
  donc avec les [Placements](19-placements.md), en section « Comptes
  nantis ». Son solde est rappelé sous les comptes, dans la ligne
  « Non liquide ». (Un compte à la fois nanti et clôturé reste ici : c'est
  de l'historique.)
- **Clôturé** : compte fermé en banque, conservé pour son historique, solde
  ignoré — listé de la même façon, en dernier.
- Le « **solde disponible** » affiché partout = comptes actifs, non nantis,
  en euros. Un compte d'épargne ou un support monétaire mobilisable à vue
  (type compte booster) compte comme du disponible dès lors qu'il est saisi
  comme un compte bancaire actif non nanti.

La page de détail d'un compte montre son historique de transactions
(recherche, lien vers le deal rattaché) et permet d'éditer nom personnalisé,
solde manuel, nanti, clôturé.

### Surveillance des connexions

La section « Connexions bancaires » (onglet Gestion) affiche
l'état de chaque connexion Powens :

- 🟢 **Connectée** — la synchronisation tourne normalement.
- 🟠 **En retard** — aucune synchronisation réussie depuis plus de 48 h
  (banque indisponible, blocage temporaire… ou panne silencieuse).
- 🔴 **À reconnecter** — la banque attend une action (nouveau mot de passe,
  authentification forte) : la synchro est bloquée tant que ce n'est pas
  fait.
- 🟠 **Non suivie** — un compte est relié à une connexion que l'application
  ne surveille pas (typiquement une connexion établie en dehors de l'app) :
  rien ne se met plus à jour et aucune alerte ne peut partir. La ligne
  indique la date des dernières données reçues ; le remède est de refaire
  la connexion via « Connecter une banque ».

Chaque ligne montre la date de dernière synchronisation réussie et les
comptes alimentés. Quand une connexion se dégrade, les membres de
l'organisation qui le souhaitent reçoivent un **email d'alerte** (un par
incident — pas de rappel tant que l'état ne change pas ; qui le reçoit se
règle dans
[Réglages → Membres](14-organisations-membres-invitations.md)).
L'état est vérifié en continu : à
chaque notification de Powens, et par un contrôle automatique toutes les
6 heures qui détecte aussi le cas où Powens cesse d'envoyer des données.

Le bouton **« Reconnecter »** (sur une connexion dégradée) rouvre la fenêtre
sécurisée de la banque en ne redemandant que l'information manquante, sans
refaire toute la connexion. Dès qu'une connexion se dégrade, une bannière
apparaît aussi en tête de la Vue d'ensemble avec le nom des banques
concernées et un raccourci vers cette section.

**Rattrapage automatique du trou.** Quand une connexion revient à la normale,
l'application va chercher d'elle-même les mouvements survenus pendant la
coupure : elle repart de la dernière transaction qu'elle détient sur chaque
compte et redemande à la banque tout ce qui s'est passé depuis. Une coupure
non traitée pendant plusieurs semaines n'est donc plus une perte de données —
la reconnexion suffit à combler le trou. Aucune limite d'ancienneté n'est
appliquée : la seule borne est ce que la banque conserve encore de son côté.
Le rattrapage repasse par le même chemin que la synchro courante, donc il ne
crée pas de doublon et n'écrase aucun pointage déjà fait.

## Transactions

Une transaction = un flux bancaire réel : sens (entrée/sortie), montant,
date, libellé, contrepartie, compte. Elles arrivent par la synchro Powens,
par import (historique Airtable, CSV Mémo Bank) ou à la main (souvent via
l'assistant IA).

- **Registre unique** (bas de la Vue d'ensemble) : les échéances
  prévisionnelles à venir au-dessus du séparateur « Aujourd'hui » (en bleu ;
  en ambre quand elles sont en retard), toutes les transactions réelles en
  dessous, du plus récent au plus ancien. Filtres : recherche plein texte
  (insensible aux accents), **montant** (min/max), **statut** (dont
  « À pointer » et « Prévisionnel ») et **compte** — la même grammaire de
  filtres que la liste des participations. Plafonné aux 1 000 transactions
  les plus récentes à l'écran.
- Chaque nouvelle transaction entre dans la **file de pointage** — statut
  « À pointer », en ambre pour se repérer d'un coup d'œil. Le poste de
  travail quotidien est la page [À faire](16-a-faire.md), qui ouvre le
  registre déjà filtré ; le geste lui-même est décrit dans
  [Pointage](08-pointage.md).

### Sous le capot : une synchro qui ne casse jamais le pointage

L'ingestion est idempotente : une transaction déjà connue est mise à jour,
jamais dupliquée, et une re-livraison de la banque **n'écrase jamais** l'état
de pointage déjà posé. Les comptes historiques importés d'Airtable ont une
date de bascule : la synchro n'ingère que les transactions postérieures,
pour éviter les doublons avec l'historique.

## Points d'attention

- Le prévisionnel et tous les soldes agrègent **l'euro uniquement** ; les
  comptes en autre devise sont comptés à part.
- Les banques actuellement connectées : Palatine, Wormser, Neuflize (CALTE),
  Mémo Bank (Albo Club), Qonto (rattaché au compte historique).

## Pages liées

- [Pointage](08-pointage.md), [Prévisionnel](09-previsionnel.md),
  [Intégrations](15-integrations.md) (Powens)
