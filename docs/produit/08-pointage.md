# Pointage

## À quoi ça sert

Le pointage rattache chaque transaction bancaire à ce qu'elle représente :
un **deal** (un versement d'investissement, un retour), une ligne de
**passif** (apport en capital, mouvement de compte courant), ou une
**catégorie** de gestion courante (charge, impôt, produit, virement interne).
C'est le geste qui rend tous les chiffres justes : performance des deals,
soldes de comptes courants, analyse par catégorie, TVA.

Il se fait dans l'onglet **Transactions** de la [Trésorerie](07-tresorerie.md).

## Le workflow

1. Chaque nouvelle transaction arrive en statut **« À pointer »** (file
   d'attente avec compteur).
2. Chaque ligne se traite en **un seul geste** : le menu « **Affecter
   à…** », une liste cherchable qui regroupe toutes les destinations
   possibles — les **deals**, le **passif** (capital, comptes courants),
   les **catégories de charges** (salaires, honoraires, loyer, frais
   bancaires…), les **catégories de produits**, puis Impôt, Virement
   interne et Ignorer. Choisir une entrée applique immédiatement ;
   l'ordre des groupes s'adapte au sens de la transaction (une sortie
   propose les charges d'abord, une entrée les produits).
3. Sur une charge ou un produit, la **catégorie** est donc posée dès le
   choix (ou « à qualifier » pour décider plus tard) ; le **taux de TVA**
   s'ajuste ensuite directement sur la ligne.
4. Une bannière « Annuler » (~5 secondes) permet de revenir sur un geste, et
   toute transaction peut être **détachée** plus tard pour repartir en file.
5. **Actions groupées** : sélectionner plusieurs lignes et les classer
   d'un coup (charge, impôt, produit, virement interne).

L'[assistant IA](11-assistant-ia.md) peut faire le pointage en conversation :
il liste la file, propose des cibles probables, et chaque geste d'écriture
passe par une approbation Confirmer/Refuser.

## Les règles apprenantes

Quand vous catégorisez une transaction à la main (charge, impôt, produit,
virement interne — avec éventuellement catégorie et taux de TVA), Albo OS
**mémorise une règle** sur le libellé/la contrepartie. Cette règle est
rejouée automatiquement sur les nouvelles transactions qui arrivent, et à la
demande avec le bouton « Appliquer les règles ». Deux gestes ne sont jamais
appris : le rapprochement à un deal (jugement humain) et « Ignorer » (trop
risqué en automatique).

## Les suggestions

Pour une transaction en attente, l'outil propose jusqu'à trois cibles
probables en s'appuyant sur l'historique : les transactions au libellé
similaire déjà pointées (signal principal), les décisions récentes, et la
proximité du montant avec l'engagement d'un deal. Ni l'outil ni l'assistant
ne pointent jamais seuls : la décision reste humaine (ou approuvée
explicitement dans le chat).

## La TVA

- Les montants sont toujours TTC ; on qualifie le **taux** (0 / 5,5 / 10 /
  20 %) sur les charges et produits, et le montant de TVA est déduit
  automatiquement.
- La carte **TVA récupérable** (onglet Règles & échéances) montre la position cumulée :
  TVA déductible (sur les charges) moins TVA collectée (sur les produits),
  avec le nombre de lignes restant « à qualifier ».
- L'historique n'est volontairement pas qualifié en masse : salaires,
  assurances ou frais bancaires sont exonérés, un taux global serait faux.
  On qualifie ligne à ligne.

### Sous le capot : ce que le pointage enregistre

Chaque rapprochement à un deal est journalisé de façon permanente (décision,
auteur, photo de la transaction au moment du geste). Ce journal sert de
mémoire aux suggestions et, à terme, de données d'apprentissage pour un
rattachement plus automatique. Les statuts d'écarté (charge, impôt, produit,
virement interne, ignoré) sont des sous-types du même mécanisme : la ligne
sort de la file, sans deal, et reste consultable par statut.

## Points d'attention

- Une transaction allouée au **passif** ne peut pas être en même temps sur un
  deal (et inversement) : il faut la détacher d'abord.
- « Virement interne » est une étiquette : les deux jambes d'un virement ne
  sont pas encore appariées automatiquement.

## Pages liées

- [Trésorerie](07-tresorerie.md), [Deals](05-deals.md),
  [Passif](10-passif.md), [Assistant IA](11-assistant-ia.md)
