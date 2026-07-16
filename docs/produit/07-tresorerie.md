# Trésorerie

## À quoi ça sert

La page Trésorerie (`/app/<org>/cash`) centralise les comptes bancaires du
véhicule et toutes les transactions. Trois onglets : **Aperçu** (soldes,
prévisionnel, TVA, alertes), **Transactions** (le registre complet et le
[pointage](08-pointage.md)) et **Analyse** (ventilation mensuelle par
catégorie).

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

Trois états particuliers changent les calculs :

- **Nanti** : fonds bloqués (nantissement, séquestre) — le compte reste
  visible mais son solde est **exclu du disponible** et du prévisionnel.
- **Clôturé** : compte fermé en banque, conservé pour son historique, solde
  ignoré.
- Le « **solde disponible** » affiché partout = comptes actifs, non nantis,
  en euros.

La page de détail d'un compte montre son historique de transactions
(recherche, lien vers le deal rattaché) et permet d'éditer nom personnalisé,
solde manuel, nanti, clôturé.

### Surveillance des connexions

La section « Connexions bancaires » (sous les comptes) affiche l'état de
chaque connexion Powens :

- 🟢 **Connectée** — la synchronisation tourne normalement.
- 🟠 **En retard** — aucune synchronisation réussie depuis plus de 48 h
  (banque indisponible, blocage temporaire… ou panne silencieuse).
- 🔴 **À reconnecter** — la banque attend une action (nouveau mot de passe,
  authentification forte) : la synchro est bloquée tant que ce n'est pas
  fait.

Chaque ligne montre la date de dernière synchronisation réussie et les
comptes alimentés. Quand une connexion se dégrade, les membres de
l'organisation reçoivent un **email d'alerte** (un par incident — pas de
rappel tant que l'état ne change pas). L'état est vérifié en continu : à
chaque notification de Powens, et par un contrôle automatique toutes les
6 heures qui détecte aussi le cas où Powens cesse d'envoyer des données.

Le bouton **« Reconnecter »** (sur une connexion dégradée) rouvre la fenêtre
sécurisée de la banque en ne redemandant que l'information manquante, sans
refaire toute la connexion.

## Transactions

Une transaction = un flux bancaire réel : sens (entrée/sortie), montant,
date, libellé, contrepartie, compte. Elles arrivent par la synchro Powens,
par import (historique Airtable, CSV Mémo Bank) ou à la main (souvent via
l'assistant IA).

- **Registre complet** (onglet Transactions) : toutes les transactions, tous
  statuts, filtrables par statut, compte et recherche plein texte
  (insensible aux accents). Plafonné aux 1 000 plus récentes à l'écran.
- Chaque nouvelle transaction entre dans la **file de pointage** — voir
  [Pointage](08-pointage.md).

### Sous le capot : une synchro qui ne casse jamais le pointage

L'ingestion est idempotente : une transaction déjà connue est mise à jour,
jamais dupliquée, et une re-livraison de la banque **n'écrase jamais** l'état
de pointage déjà posé. Les comptes historiques importés d'Airtable ont une
date de bascule : la synchro n'ingère que les transactions postérieures,
pour éviter les doublons avec l'historique.

## Analyse

L'onglet Analyse ventile les entrées et sorties par grande catégorie, mois
par mois, sur 3, 6 ou 12 mois, avec la ligne nette. Les virements internes
et les lignes ignorées sont exclus (comptés à part). Les catégories viennent
du [pointage](08-pointage.md).

## Points d'attention

- Le prévisionnel et tous les soldes agrègent **l'euro uniquement** ; les
  comptes en autre devise sont comptés à part.
- Les banques actuellement connectées : Palatine, Wormser, Neuflize (CALTE),
  Mémo Bank (Albo Club), Qonto (rattaché au compte historique).

## Pages liées

- [Pointage](08-pointage.md), [Prévisionnel](09-previsionnel.md),
  [Intégrations](15-integrations.md) (Powens)
