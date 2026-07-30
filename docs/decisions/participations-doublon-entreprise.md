# Note d'options — Entreprise affichée en double sur la vue Participations

**Statut : à trancher (Benjamin + Clément). Aucun changement dans l'app —
cette note prépare la décision.**

Acté en réunion : « on garde en tête que c'est bancal, mais c'est la
meilleure solution aujourd'hui » → on réfléchit avant de toucher.

## Le constat

La page Participations empile quatre tableaux — TS en cours, Positions
ouvertes, Sorties gagnantes, Sorties perdantes — et chaque ligne est une
**entreprise** (ses deals y sont sommés). Or le statut vit sur le **deal**.
La projection serveur groupe donc les deals par entreprise **et par famille
de statut** : une boîte qui a des deals dans deux familles produit deux
lignes, dans deux tableaux (jusqu'à trois lignes possibles : TS + ouvert +
sorti). Ce n'est pas un bug d'affichage — c'est la conséquence directe du
choix « statut au niveau deal, vue au niveau entreprise ».

Chaque ligne affiche déjà « N deals », mais N est le compte du tableau où
elle se trouve, pas celui de la boîte : rien n'indique qu'une autre partie
de la boîte vit dans un autre tableau.

## Les cas réels (données au 30/07/2026)

- **Rewatt** — le cas vivant : 2 deals en obligations, un sorti (310 000 €,
  ×1,05, TRI ≈ 7,6 %) et un nouveau ticket re-rentré depuis (115 000 €, en
  cours). La boîte apparaît **aujourd'hui** à la fois dans « Positions
  ouvertes » et dans « Sorties gagnantes ». À première lecture, on croit à
  un doublon.
- **Eben Home** — le cas à venir : 3 deals, tous en cours (2 tickets SPV +
  le véhicule lead). Une seule ligne aujourd'hui. À la première sortie
  partielle, la ligne se dédouble — alors que la sortie se fera
  probablement en une fois (les 3 deals passeraient « sortis » ensemble et
  la boîte redeviendrait une ligne unique, dans le tableau Sorties).

Aujourd'hui : 1 boîte dédoublée sur ~50. Le phénomène reste rare tant que
les boîtes multi-deals sortent en bloc ; il se multipliera dès que des
tickets sortiront avant les autres (re-up après exit comme Rewatt,
remboursement d'une tranche obligataire, secondaire partiel).

## Ce que le modèle actuel garantit (à ne pas perdre sans le décider)

1. **Totaux exacts par tableau.** Chaque tableau ne somme que des deals du
   même cycle de vie : la ligne de totaux (versé, reçu, nb de deals) est
   additive et juste.
2. **Ratios homogènes.** TVPI uniquement sur l'ouvert (avec valorisation
   résiduelle), MOIC + TRI uniquement sur le réalisé. Jamais de mélange
   latent/réalisé dans une même colonne.

Le découpage en une ligne par entreprise *et par famille de statut* est
fait côté serveur précisément pour tenir ces deux garanties. Toute option
qui fusionne les lignes doit dire ce qu'elle en fait.

## Option 1 — Statu quo assumé, rendu lisible

Garder le dédoublement mais le rendre explicite : sur chaque ligne d'une
boîte présente dans plusieurs tableaux, afficher « 2 deals sur 3 » (au lieu
de « 2 deals »), et idéalement un indicateur discret « aussi en Sorties » /
« aussi en Positions ouvertes » qui renvoie vers l'autre ligne.

- **Coût** : très faible. Seule vraie modification : faire remonter du
  serveur le nombre total de deals de la boîte (chaque ligne ne connaît
  aujourd'hui que son propre tableau).
- **Ce que ça règle** : l'effet « bug » — on comprend en une seconde que la
  boîte est volontairement à deux endroits. Les chiffres ne bougent pas.
- **Ce que ça ne règle pas** : la performance globale d'une boîte (tous
  cycles de vie confondus) reste introuvable sur la page — il faut ouvrir
  la fiche société.

## Option 2 — Une ligne par entreprise, statut dominant dérivé

Une boîte = une ligne, placée dans un seul tableau selon un statut dérivé
de ses deals, avec le détail par deal au drill-down (la fiche société liste
déjà tous les deals : le drill-down existe).

- **Règle de dominance à trancher** (proposition, du plus vivant au plus
  clos) : au moins un deal ouvert → Positions ouvertes ; sinon au moins un
  TS → TS en cours ; sinon tout est sorti → Sorties, gagnantes ou perdantes
  sur le résultat global. Rewatt : une seule ligne en Positions ouvertes,
  avec mention « dont 1 deal sorti ».
- **Coûts réels** :
  - Les totaux de tableau perdent leur pureté : la ligne Rewatt en
    « Positions ouvertes » embarquerait le versé/reçu du deal sorti → le
    total « Reçu » du tableau mélangerait distributions réalisées et
    positions en cours. L'alternative (ne sommer que la part « ouverte » de
    la ligne) recrée le problème en plus subtil : la ligne n'afficherait
    plus toute la boîte.
  - Les colonnes de ratios sont à repenser : sur une ligne mixte, ni le
    TVPI « ouvert » ni le MOIC « réalisé » actuels ne sont justes. La
    réponse naturelle est un multiple « toute vie » ((reçu + résiduel) /
    versé) — qui est d'ailleurs le vrai multiple de la boîte, un chiffre
    qu'on n'a nulle part aujourd'hui.
  - C'est le chantier le plus lourd des trois : projection serveur,
    colonnes, totaux et tri à revoir ensemble.
- **Bénéfice** : la promesse de la page (« une vue par entreprise »)
  devient vraie, et le multiple complet par boîte apparaît enfin quelque
  part.

## Option 3 — Vraie vue deal (interrupteur entreprise / deal)

Un interrupteur dans la barre d'outils : vue entreprise (l'actuelle) ↔ vue
deal, une ligne par deal, chaque ligne portant son propre statut — c'est
exactement la forme de l'export Excel/CSV actuel, la projection existe
donc déjà.

- **Coût assumé** : Eben Home = 3 lignes pour 3 tickets alors que la sortie
  se fera probablement en une seule opération. Sur ~55 deals, la vue est
  plus longue et répète le nom des boîtes multi-deals. Et c'est une
  deuxième surface à maintenir (tri, colonnes, totaux ×2), avec le choix de
  la vue par défaut à faire.
- **Bénéfice** : zéro ambiguïté par construction — chaque ligne a un statut
  vrai. Le besoin « voir mes tickets un par un » cesse de passer par
  l'export.
- **Nuance** : l'export plat couvre déjà ce besoin ponctuellement ; le
  toggle ne se justifie que si la lecture par ticket devient régulière.

## Effet de bord repéré au passage (même racine, pas corrigé)

Une boîte dont les deals sortis mélangent un exit gagnant et un write-off
atterrit entièrement en « Sorties perdantes » (le write-off « contamine »
le groupe), même si le multiple global de ses sorties est supérieur à 1.
Cas théorique aujourd'hui, mais c'est le même artefact « statut au niveau
entreprise » — l'option retenue devrait le trancher au même moment.

## Recommandation

**Option 1 maintenant ; option 2 en cible si le phénomène se généralise.**

- L'option 1 est petite, réversible, et tue l'essentiel du problème
  (l'effet « doublon inexpliqué ») sans toucher aux garanties de la page.
  C'est la traduction directe du « c'est bancal mais c'est la meilleure
  solution aujourd'hui ».
- L'option 2 est la vraie réponse structurelle, mais elle force des choix
  financiers (totaux mixtes, multiple « toute vie ») qui méritent leur
  propre discussion — à rouvrir quand plusieurs boîtes seront dédoublées
  durablement, ou quand le multiple complet par boîte deviendra un besoin
  exprimé.
- L'option 3 répond à un autre besoin (l'analyse par ticket, pas la
  lisibilité de la vue entreprise) ; l'export la couvre pour l'instant.

**Signal de réouverture** : ≥ 3 boîtes dédoublées en même temps, ou premier
exit partiel d'Eben Home.
