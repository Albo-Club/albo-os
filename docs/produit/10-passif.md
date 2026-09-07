# Passif

## À quoi ça sert

La page Passif (`/app/<org>/passif`) suit ce que le véhicule **doit** et ce
qui a été **apporté** : la dette bancaire, les comptes courants entre entités
du groupe, et les capitaux propres (capital social, primes d'émission,
augmentations de capital).

Les sections sont dans cet ordre d'utilité : **dette bancaire → comptes
courants → capitaux propres**, puis, détaché en bas de page, les **garanties
données**. Chaque section porte son propre total et **il n'y a pas de total
global** : le capital n'est pas exigible, un chiffre qui l'additionnerait à
la dette serait faux.

La dette bancaire, les échéanciers et les garanties ont leur propre page :
[Dette bancaire et garanties](18-dette-et-garanties.md).

## Capitaux propres

Une position de capital = un type (capital social, prime d'émission,
augmentation, report à nouveau), un montant, une date d'effet, un nombre
d'actions éventuel, un **% de détention** éventuel, et un **détenteur** :
soit une organisation du groupe, soit un tiers externe désigné par un
libellé libre.

Les transactions bancaires correspondantes (l'apport reçu, par exemple) se
rattachent à la position depuis le [pointage](08-pointage.md) et apparaissent
en sous-lignes, détachables.

### Le % de détention ne se saisit qu'ici

C'est la **structure capitalistique de la société émettrice** qui fait foi.
Le pourcentage se saisit sur sa propre page Passif — « CALTE 60 %, M. Y
40 % » se lit chez la SCI, pas chez CALTE.

Côté détenteur, l'application **lit** ce pourcentage au lieu d'en garder une
copie. Deux saisies finiraient par diverger, et rien ne dirait laquelle a
raison.

Le % est **facultatif**, et l'absence est un vrai état : une prime d'émission
ou un report à nouveau ne portent aucune part du capital. L'application
affiche alors « — », jamais 0 % — qui affirmerait que le détenteur ne possède
rien.

## Comptes courants inter-entités

Un compte courant relie deux organisations du groupe : un **créancier** (qui
prête) et un **débiteur** (qui emprunte). Il peut être rémunéré (taux) et
bloqué. Le tableau montre le créancier et le solde.

### Une avance ne se saisit qu'une fois, du côté de celui qui doit

Le Passif ne montre que ce que la société **doit** : un compte courant
n'apparaît donc que dans l'organisation **débitrice**, et c'est la seule où
l'on peut en créer un ou y pointer un virement.

Vu du prêteur, la même avance n'est pas une dette mais un **placement** : il
la saisit comme un investissement, avec un deal de type « compte courant »
sur la société bénéficiaire. C'est déjà ainsi que sont suivies les avances
que CALTE consent à ses filiales — et c'est exactement la logique du capital
(cf. plus haut) : la société émettrice porte les fonds reçus, celui qui les
a apportés porte sa participation.

Concrètement : CALTE avance 100 000 € à Albo. Albo enregistre un compte
courant sur sa page Passif et y pointe le virement reçu. CALTE, elle, pointe
son décaissement sur son deal « compte courant — Albo Club », dans ses
participations. Une avance, deux écritures, chacune du bon côté.

### Sous le capot : des soldes jamais saisis, toujours dérivés

Le solde d'un compte courant n'est **jamais saisi à la main** : il est
calculé depuis les transactions que l'organisation débitrice a pointées
dessus — les entrées (l'argent emprunté) moins les sorties (les
remboursements). D'où un solde toujours négatif : c'est une dette.

Point d'attention : le solde du compte courant chez le débiteur et le montant
versé sur le deal chez le prêteur devraient se répondre, mais **rien ne le
vérifie automatiquement**. Un écart entre les deux signifie qu'il reste un
virement à pointer quelque part.

## Actions

- **Créer** une position de capital ou un compte courant (boutons + Capital
  et + Compte courant).
- **Éditer** : montant/type/détenteur pour le capital ; taux, blocage et date
  pour un compte courant — mais **pas ses parties** (changer de contrepartie
  = supprimer et recréer, le solde dépend de l'identité des deux orgs). À la
  création d'un compte courant, seul le créancier se choisit : le débiteur est
  l'organisation en cours.
- **Détacher** une transaction allouée (elle repart en file de pointage).
- **Supprimer** : refusé tant que des transactions restent allouées — il faut
  tout détacher d'abord, des deux côtés pour un compte courant.

## Points d'attention

- Le rapprochement des transactions vers ces cibles se fait dans l'onglet
  **Transactions** de la Trésorerie, pas sur la page Passif (qui, elle,
  permet le détachement). Le sélecteur y propose quatre groupes : Deals,
  Prêts bancaires, Capitaux propres, Comptes courants.
- **Un compte courant d'associé n'est pas un prêt bancaire.** Le premier
  relie deux sociétés du groupe et son solde se dérive des mouvements ; le
  second est une dette envers une banque, avec un échéancier calculé (cf.
  [Dette bancaire et garanties](18-dette-et-garanties.md)).
- **Un compte courant vide côté prêteur est normal**, pas un oubli : sa
  créance est dans ses [participations](04-participations.md), pas dans son
  passif.
- Une transaction allouée au passif sort de la file de pointage mais n'est
  pas comptée comme « pointée deal » dans les vues deal.

## Pages liées

- [Pointage](08-pointage.md), [Trésorerie](07-tresorerie.md),
  [Participations](04-participations.md)
