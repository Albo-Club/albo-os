# Pointage

## À quoi ça sert

Le pointage rattache chaque transaction bancaire à ce qu'elle représente :
un **deal** (un versement d'investissement, un retour), une ligne de
**passif** (apport en capital, mouvement de compte courant), ou une
**catégorie** de gestion courante (charge, impôt, produit, virement interne).
C'est le geste qui rend tous les chiffres justes : performance des deals,
soldes de comptes courants, analyse par catégorie.

Il se fait dans le **registre** de la [Trésorerie](07-tresorerie.md) (bas de
la Vue d'ensemble) ; le point d'entrée quotidien est la page
[À faire](16-a-faire.md), qui ouvre ce registre déjà filtré sur la file.

## Le workflow

1. Chaque nouvelle transaction arrive en statut **« À pointer »**, affiché
   en **ambre** pour repérer d'un coup d'œil ce qui reste à traiter. Ce
   n'est pas une page à part : c'est une valeur du filtre **« Statut »** du
   registre (avec le compteur de la file), qui montre aussi les échéances
   prévisionnelles **en retard**. Le même menu sert à retrouver le reste :
   prévisionnel, charges, impôts, produits, virements internes,
   investissements, comptes courants & emprunts, ignorées.
2. Chaque ligne se traite en **un seul geste** : le menu « **Affecter
   à…** », une liste cherchable qui regroupe toutes les destinations
   possibles — les **deals**, le **passif** (capital, comptes courants),
   les **catégories de charges** (salaires, honoraires, loyer, frais
   bancaires…), les **catégories de produits**, puis Impôt, Virement
   interne et Ignorer. Choisir une entrée applique immédiatement ;
   l'ordre des groupes s'adapte au sens de la transaction (une sortie
   propose les charges d'abord, une entrée les produits).
3. Sur une charge ou un produit, la **catégorie** est donc posée dès le
   choix (ou « à qualifier » pour décider plus tard) ; elle s'ajuste ensuite
   directement sur la ligne.
4. Une ligne pointée reste visible avec son nouveau statut, et toute
   transaction peut être **détachée** plus tard pour repartir en file.
5. **Actions groupées** : sélectionner plusieurs lignes et les classer
   d'un coup (charge, impôt, produit, virement interne). Les virements
   classés en masse restent à apparier (voir ci-dessous).

## Rattacher un flux à un bien immobilier

Le sélecteur « Affecter à… » propose un groupe **Biens** à côté des Deals,
des Prêts, des Capitaux propres et des Comptes courants.

C'est le seul choix du pointage qui en appelle un second : après avoir
désigné le bien, l'application demande la **nature de la dépense**. Sans
elle, elle ne saurait pas si les 40 000 € qui sortent sont des travaux, des
charges ou une partie du prix d'achat — et le prix de revient comme la
rentabilité en dépendent.

| Sens | Natures proposées |
|---|---|
| Sortie | Acquisition · Frais d'acquisition · Travaux · Charges |
| Entrée | Loyer · Revente |

**Une transaction, un bien, une seule nature** — jamais de découpage. Un
virement au notaire qui couvre le prix et les droits part entier en
« Acquisition ». Pour garder le détail sur un bien ancien, les postes
concernés restent en source « Saisi » sur la fiche du bien.

Ce second temps ne propose rien et ne présélectionne rien : il liste les
natures possibles, vous choisissez. Voir [Immobilier](20-immobilier.md).

## Les virements internes

Un virement interne est un mouvement entre deux comptes de la **même
entité**, éventuellement dans deux banques différentes. Ce n'est **pas** une
simple étiquette : c'est un **mouvement à deux jambes**, l'argent qui part
d'un compte et l'argent qui arrive sur l'autre.

Quand vous classez une ligne en virement interne, Albo OS enchaîne sur le
choix de sa **contrepartie** : il liste les mouvements des autres comptes de
la même entité, en sens inverse, du plus récent au plus ancien, avec une
recherche libre. Vous choisissez — l'app ne présélectionne jamais rien.

Tant que la contrepartie manque, le virement est **incomplet** : la ligne
porte un badge ambre et se retrouve avec le filtre « Virements à apparier »
du registre. Rien ne sort donc de l'analyse sans que ça se voie.

Une fois le virement complet, la fiche du mouvement affiche l'**écart entre
les deux jambes** (les frais bancaires, par exemple) et le **délai de
transit** entre le départ et l'arrivée.

Un mouvement entre **deux entités différentes** n'est pas un virement
interne : l'appariement est refusé, et le message vous oriente vers le bon
geste — pointer le mouvement vers cette entité, comme un investissement.

L'[assistant IA](11-assistant-ia.md) peut faire le pointage en conversation :
il liste la file et exécute le rattachement que vous lui indiquez, avec une
approbation Confirmer/Refuser à chaque écriture. Il ne devine jamais la
cible : si vous ne la nommez pas, il vous la demande.

## Les règles apprenantes

Quand vous catégorisez une transaction à la main (charge, impôt, produit —
avec éventuellement une catégorie), Albo OS **mémorise une règle** sur le
libellé/la contrepartie. Cette règle est rejouée automatiquement sur les
nouvelles transactions qui arrivent, et à la demande avec le bouton
« Appliquer les règles ». Trois gestes ne sont jamais appris : le
rapprochement à un deal (jugement humain), « Ignorer » (trop risqué en
automatique) et le **virement interne** — un libellé ne peut pas savoir sur
quel compte se trouve la contrepartie, et retirer des mouvements de l'analyse
en série sans le voir est exactement le risque qu'on veut éviter.

## Pourquoi l'outil ne propose plus rien

Albo OS affichait autrefois des propositions de rapprochement : un bandeau
« Proposition » sous les lignes à pointer, une carte « Rapprochements
suggérés » au-dessus du registre, des « règles suggérées », et une
proposition de solder l'échéance prévue juste après un pointage.

**Tout cela a été retiré.** Le système se trompait sans le dire : il
rattachait des transactions au mauvais deal, confondait un deal avec une
échéance prévue, et rien dans l'écran ne signalait que la proposition était
fausse. Une proposition juste fait gagner cinq secondes ; une proposition
fausse acceptée de confiance coûte bien davantage à retrouver.

Le pointage est donc redevenu entièrement manuel : vous ouvrez la file, vous
choisissez la destination. C'est volontairement une étape en arrière — le
temps de rassembler assez de cas réels pour reconstruire un rapprochement
automatique digne de confiance. Chaque pointage que vous faites aujourd'hui
alimente cette matière.

## Un deal en term sheet devient actif au premier versement

Pointer une **sortie** sur un deal encore _engagé_ (term sheet) le fait
**passer en actif** dans la foulée : l'argent est parti, la position existe,
elle n'a plus rien à faire dans les term sheets. Un seul versement suffit —
inutile d'attendre que l'engagement soit couvert, un fonds étant bel et bien
actif dès son premier appel de capital.

Deux limites à connaître :

- la bascule ne va **que dans ce sens** : détacher la transaction ensuite ne
  ramène pas le deal en term sheet, et un deal déjà sorti n'est jamais
  ramené en actif ;
- elle ne se déclenche que sur une **sortie** : pointer une entrée (un
  retour, une distribution) laisse le deal en term sheet.

Le geste équivalent côté Attio — passer le deal au stage « Invested » —
continue de fonctionner : les deux chemins mènent au même statut.

## Le rapprochement des échéances prévues

L'autre bout de la chaîne : une échéance du
[prévisionnel](09-previsionnel.md) qui est réellement tombée se marque
« réalisée » depuis sa ligne, dans « Échéances ponctuelles ». Vous y
choisissez vous-même la transaction correspondante — la liste est simplement
triée de la plus récente à la plus ancienne, avec une recherche libre.

Si la transaction paye moins que prévu, deux issues explicites : clore avec
l'écart, ou garder le reste attendu au prévisionnel. Une échéance devenue
sans objet s'annule directement depuis sa ligne du registre.

## La TVA, mise de côté

Qualifier le taux de TVA ligne à ligne sur les charges ne servait pas au
pilotage : c'est un travail de comptable, fait ailleurs. Toute la TVA a donc
été **retirée de l'interface** — plus de taux à choisir sur une ligne, plus
de carte « TVA récupérable », plus d'échéance de TVA suggérée.

Rien n'est perdu pour autant : les taux déjà saisis restent en base,
l'assistant IA sait toujours répondre sur la position de TVA, et la remettre
à l'écran ne demanderait qu'un travail d'affichage.

À ne pas confondre avec la **TVA des deals**, qui elle reste : les royalties
encaissées sont converties en hors taxes pour que leur multiple et leur
rendement soient justes. C'est porté par le type d'instrument, sans aucun
lien avec la qualification des charges.

### Sous le capot : ce que le pointage enregistre

Chaque rapprochement à un deal est journalisé de façon permanente (décision,
auteur, photo de la transaction au moment du geste). Ce journal est conservé
intact : c'est lui qui servira de matière d'apprentissage au futur
rapprochement automatique. Les statuts d'écarté (charge, impôt, produit,
virement interne, ignoré) sont des sous-types du même mécanisme : la ligne
sort de la file, sans deal, et reste consultable par statut.

## Points d'attention

- Une transaction allouée au **passif** ne peut pas être en même temps sur un
  deal (et inversement) : il faut la détacher d'abord.
- Un **virement interne** relie deux comptes de la **même entité**. Entre
  deux entités différentes, l'appariement est refusé : ce mouvement se pointe
  vers l'entité concernée, comme un investissement.
- La contrepartie d'un virement est **toujours choisie à la main**. L'app
  restreint la liste aux mouvements possibles et la trie par date ; elle ne
  classe jamais par vraisemblance et ne présélectionne rien.
- Les types « investissements » et « comptes courants & emprunts » sont deux
  vues du même statut « pointé » : la première montre ce qui est rattaché à
  un deal, la seconde **tout le reste** — capitaux propres, comptes courants,
  prêts bancaires et biens immobiliers. Les prêts en étaient absents par
  erreur jusqu'ici, ils y figurent désormais.

## Pages liées

- [Trésorerie](07-tresorerie.md), [Deals](05-deals.md),
  [Passif](10-passif.md), [Assistant IA](11-assistant-ia.md)
- [Dette bancaire et garanties](18-dette-et-garanties.md) et
  [Immobilier](20-immobilier.md) — les deux cibles ajoutées au sélecteur.
