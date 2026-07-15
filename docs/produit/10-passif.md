# Passif

## À quoi ça sert

La page Passif (`/app/<org>/passif`) suit ce que le véhicule **doit** et ce
qui a été **apporté** : les capitaux propres (capital social, primes
d'émission, augmentations de capital) et les comptes courants entre entités
du groupe.

## Capitaux propres

Une position de capital = un type (capital social, prime d'émission,
augmentation, report à nouveau), un montant, une date d'effet, un nombre
d'actions éventuel, et un **détenteur** : soit une organisation du groupe,
soit un tiers externe désigné par un libellé libre.

Les transactions bancaires correspondantes (l'apport reçu, par exemple) se
rattachent à la position depuis le [pointage](08-pointage.md) et apparaissent
en sous-lignes, détachables.

## Comptes courants inter-entités

Un compte courant relie deux organisations du groupe : un **créancier** (qui
prête) et un **débiteur** (qui emprunte). Il peut être rémunéré (taux) et
bloqué. Le tableau montre chaque relation avec la position (créance ou
dette) et le solde signé.

### Sous le capot : des soldes jamais saisis, toujours dérivés

Le solde d'un compte courant n'est **jamais saisi à la main** : il est
calculé depuis les transactions pointées dessus, chaque organisation sommant
**ses propres** mouvements. Côté créancier : les sorties (prêts) moins les
entrées (remboursements reçus) = la créance. Côté débiteur : l'inverse = la
dette.

Conséquence importante : si une seule des deux organisations a pointé sa
jambe du virement, **les deux soldes divergent**. Ce n'est pas un bug, c'est
un signal : il reste un pointage à faire de l'autre côté.

## Actions

- **Créer** une position de capital ou un compte courant (boutons + Capital
  et + Compte courant).
- **Éditer** : montant/type/détenteur pour le capital ; taux, blocage et date
  pour un compte courant — mais **pas ses parties** (changer de contrepartie
  = supprimer et recréer, le solde dépend de l'identité des deux orgs).
- **Détacher** une transaction allouée (elle repart en file de pointage).
- **Supprimer** : refusé tant que des transactions restent allouées — il faut
  tout détacher d'abord, des deux côtés pour un compte courant.

## Points d'attention

- Le rapprochement des transactions vers ces cibles se fait dans l'onglet
  **Transactions** de la Trésorerie, pas sur la page Passif (qui, elle,
  permet le détachement).
- Une transaction allouée au passif sort de la file de pointage mais n'est
  pas comptée comme « pointée deal » dans les vues deal.

## Pages liées

- [Pointage](08-pointage.md), [Trésorerie](07-tresorerie.md)
