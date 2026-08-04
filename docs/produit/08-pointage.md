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
   d'un coup (charge, impôt, produit, virement interne).

L'[assistant IA](11-assistant-ia.md) peut faire le pointage en conversation :
il liste la file, propose des cibles probables, et chaque geste d'écriture
passe par une approbation Confirmer/Refuser.

## Les règles apprenantes

Quand vous catégorisez une transaction à la main (charge, impôt, produit,
virement interne — avec éventuellement une catégorie), Albo OS
**mémorise une règle** sur le libellé/la contrepartie. Cette règle est
rejouée automatiquement sur les nouvelles transactions qui arrivent, et à la
demande avec le bouton « Appliquer les règles ». Deux gestes ne sont jamais
appris : le rapprochement à un deal (jugement humain) et « Ignorer » (trop
risqué en automatique).

## Les suggestions

Dans la file « À pointer », les lignes que l'outil sait probablement classer
portent un **bandeau « Proposition »** juste en dessous : la cible proposée
en clair (nom complet, jamais tronqué), un bouton « Valider » qui applique, et
« Refuser » qui écarte la proposition. Deux sources :

- les **virements internes détectés automatiquement** : deux mouvements de
  même montant, en sens opposés, entre deux comptes de l'organisation, à
  quelques jours d'écart — les deux jambes sont proposées en « Virement
  interne » ;
- l'**historique** : quand des transactions au libellé similaire ont déjà
  été pointées plusieurs fois vers le même deal ou la même cible de
  passif, cette cible est proposée.

« Refuser » ne fait que masquer le bandeau : rien n'est mémorisé, donc la
proposition peut revenir au prochain chargement de la page tant que la
transaction n'est pas pointée.

L'assistant IA s'appuie sur le même moteur (jusqu'à trois cibles probables, en
conversation). Dans les deux cas, ni l'outil ni l'assistant ne pointent jamais
seuls : la décision reste humaine — valider le bandeau, ou approuver
explicitement dans le chat.

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

Au-dessus du registre, une carte « Rapprochements suggérés »
rapproche l'autre bout de la chaîne : les échéances du
[prévisionnel](09-previsionnel.md) dues ou en retard qui ressemblent à une
transaction récente (même sens, dates et montants proches, libellé). C'est
aussi un pointage — la transaction dit ce qui s'est réellement passé, la
carte confirme que l'échéance attendue est bien celle-là. Un clic si les
montants collent, sinon un dialogue pour clore avec l'écart ou garder le
reliquat. Le détail du mécanisme est décrit dans le
[prévisionnel](09-previsionnel.md).

Le pont marche dans les deux sens : pointer une transaction sur un deal qui
attend encore une échéance prévue propose aussitôt de la réaliser, et une
échéance devenue sans objet s'annule directement depuis sa ligne du
registre.

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
auteur, photo de la transaction au moment du geste). Ce journal sert de
mémoire aux suggestions et, à terme, de données d'apprentissage pour un
rattachement plus automatique. Les statuts d'écarté (charge, impôt, produit,
virement interne, ignoré) sont des sous-types du même mécanisme : la ligne
sort de la file, sans deal, et reste consultable par statut.

## Points d'attention

- Une transaction allouée au **passif** ne peut pas être en même temps sur un
  deal (et inversement) : il faut la détacher d'abord.
- « Virement interne » reste une étiquette posée ligne par ligne : la
  détection de paires **suggère** les deux jambes mais ne les classe
  jamais toute seule.
- Les types « investissements » et « comptes courants & emprunts » sont deux
  vues du même statut « pointé » : la première montre ce qui est rattaché à
  un deal, la seconde ce qui est alloué au [passif](10-passif.md).

## Pages liées

- [Trésorerie](07-tresorerie.md), [Deals](05-deals.md),
  [Passif](10-passif.md), [Assistant IA](11-assistant-ia.md)
