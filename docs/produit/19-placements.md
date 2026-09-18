# Placements

## À quoi ça sert

La page Placements (`/app/<org>/placements`, second sous-onglet de la
section **Investissements** de la barre latérale, à côté d'Entreprises)
regroupe la **trésorerie placée** : crypto, comptes de capitalisation,
dépôts à terme, comptes-titres. Ces lignes ne sont pas des participations —
on ne les suit pas avec des valorisations de tours ou un TVPI, mais comme
des **comptes** : un solde que l'on met à jour, et une performance calculée
automatiquement (dans l'esprit d'un Finary).

C'est pour ça qu'elles ont leur propre page et ne figurent plus dans la
liste [Entreprises](04-participations.md). À l'inverse, les comptes
rémunérés à disponibilité immédiate (compte booster, monétaire rapatrié)
restent des comptes bancaires côté [Trésorerie](07-tresorerie.md) : c'est
du cash disponible tout de suite, pas un placement.

## Comment ça marche

- **Créer un placement** : le bouton « Nouveau placement » en tête de page
  ouvre un formulaire — entité détentrice, support (une entreprise
  existante **ou une nouvelle, créée dans la foulée** en tapant son nom),
  type (contrat de capitalisation, dépôt à terme, compte-titres, crypto),
  et en option la banque/plateforme, la date d'ouverture et le solde
  actuel. La création débouche directement sur la fiche du placement ; la
  liquidité prend le défaut de son type, corrigeable sur la fiche.
- **Importer un relevé** : le bouton « Importer un relevé » en tête de page
  ouvre l'autre porte, celle des comptes qu'aucune connexion bancaire ne
  remonte. On dépose le PDF du relevé envoyé par la banque, il est lu
  automatiquement, et **un écran de vérification montre ce qui a été
  compris** avant que quoi que ce soit ne soit enregistré : un bloc par
  compte du relevé, avec sa valorisation, le nombre de lignes détectées et
  surtout la réponse à la seule question qui compte — **est-ce que le détail
  des lignes retombe sur le total imprimé par la banque ?** Si non, l'écart
  est affiché en rouge. Pour chaque compte on choisit : créer un placement,
  mettre à jour un placement existant, ou ne pas l'importer (ce qui est le
  réglage par défaut d'un compte courant, déjà suivi par la connexion
  bancaire). À la validation, l'import remplit d'un coup le solde du
  placement, le contenu de son enveloppe et un point d'historique **daté du
  relevé**, pas du jour de l'import. La date du dernier relevé importé
  s'affiche sous le titre de la page.
- **Quatre tuiles de synthèse** : solde total, versé net (versements moins
  retraits), plus-value latente (en euros et en %), rendement annualisé.
- **Un tableau par liquidité**, empilés dans l'ordre : **Liquide** (bandeau
  vert), **Semi-liquide** (ambre), **Non liquide** (gris). Une section vide
  ne s'affiche pas. Le classement est déduit du type — compte-titres et
  crypto en liquide, dépôt à terme en semi-liquide, compte de capitalisation
  en non liquide — et se corrige placement par placement depuis sa fiche
  (un DAT à 5 ans peut passer en non liquide).
- **Une ligne par placement** : nom et banque/plateforme, type, date
  d'ouverture, versé, retiré, solde, plus-value, rendement annualisé. Les
  montants sont au centime (ce sont des soldes de comptes). Un clic sur la
  ligne ouvre la **fiche placement**.
- **Mettre à jour un solde** : cliquer sur le solde, saisir le nouveau
  montant, Entrée. C'est le geste central de la page — le reste se recalcule
  tout seul.
- Les colonnes « versé » et « retiré » viennent des transactions bancaires
  pointées sur le deal (voir [Pointage](08-pointage.md)) ; le rendement
  annualisé est le taux de rendement interne (XIRR) de ces flux datés plus
  le solde actuel.

### Les comptes nantis

Les comptes bancaires **nantis** (nantissement de titres, d'espèces, séquestre)
apparaissent en bas de la page, dans une section à part. Ce sont des fonds
bloqués : ils ne sont plus de la trésorerie disponible, et se lisent donc
comme du long terme. La section les liste en lecture seule (banque, nom,
entité titulaire, solde) ; un clic ouvre la fiche du compte, où le solde
s'édite comme n'importe quel compte bancaire.

Leur solde entre dans la tuile **Solde total** (le sous-texte rappelle la part
nantie) mais **jamais** dans le versé net, la plus-value ou le rendement :
derrière un compte nanti il n'y a pas de deal, donc pas de versements à
comparer.

## La fiche placement

Un placement s'ouvre sur une **fiche légère** (pas la fiche deal complète
d'une participation) : l'en-tête (nom, banque, type, date d'ouverture) avec
la **liquidité modifiable**, les quatre tuiles du compte, l'**historique du
solde** (chaque mise à jour crée un point daté) et les **transactions
pointées** sur le placement.

Quand une sûreté porte sur le contrat, un badge **« Nanti »** apparaît à côté
du nom. Un seul mot, parce que c'est le fait qui change l'usage possible du
placement — les montants, les bénéficiaires et la marge restante sont dans le
bloc « Nantissements sur ce contrat » plus bas. Le badge dit « regarde en
dessous », il ne double aucun chiffre.

### Le contenu de l'enveloppe

La fiche affiche aussi les **positions** du compte (les titres d'un
compte-titres, les supports d'un contrat de capitalisation, les lignes
crypto) : support, code ISIN et catégorie d'actif, quantité, prix moyen
d'achat, cours, valorisation, plus ou moins-value, avec le total du compte.
La ligne de liquidités du compte en fait partie — sans elle le total de
l'enveloppe ne retomberait pas sur le solde.

Un support coté **en pourcentage de son nominal** (un produit structuré à
99,13 %) s'affiche bien en pourcentage, à côté d'un fonds coté en euros par
part. Les deux ne se lisent pas dans la même unité et l'app ne les mélange
pas.

Ces positions arrivent par **deux chemins**, selon ce que la banque permet :

- **La connexion bancaire** (Powens Wealth), quand la banque est couverte :
  il suffit de **lier le placement à son compte bancaire** depuis la fiche
  (liste déroulante des comptes de l'organisation), et les positions se
  mettent à jour automatiquement chaque matin ; « Actualiser » force la mise
  à jour. Sous le tableau : « Synchronisé le … ».
- **L'import d'un relevé** (voir plus haut), quand elle ne l'est pas — le
  cas de Natixis Wealth Management. Le compte, ses positions et le solde du
  placement arrivent alors du PDF, et le tableau porte la mention **« D'après
  le relevé au … »** : la date du document, pour qu'un chiffre vieux de deux
  mois se voie comme tel.

Point d'attention : le premier chemin dépend du produit **Powens Wealth**, à
activer auprès de Powens (distinct de l'agrégation bancaire déjà branchée) —
et il ne couvre pas toutes les banques. Tant qu'il n'est pas disponible pour
une banque donnée, l'import de relevé est la façon de tenir ces placements à
jour.

### Les documents du contrat

La fiche porte enfin un bloc **Documents**, sous les nantissements : on y
dépose le term sheet d'un produit structuré, la convention de compte, une
attestation de la banque. Le texte de chaque fichier est lu comme partout
ailleurs dans l'app, donc une clause devient trouvable à la recherche —
« quelle est la barrière de protection de l'EMTN ? » n'oblige plus à
rouvrir le PDF.

Ces documents sont rattachés **au placement seul**, pas à la banque qui le
tient : la fiche de Natixis Wealth Management ne se remplit pas des notes de
tous les produits qu'elle abrite.

### Sous le capot : l'historique des soldes

Chaque mise à jour d'un solde est aussi enregistrée comme une valorisation
datée du deal. Le solde construit donc une série dans le temps — visible
sur la fiche placement, et la base d'une future courbe d'évolution.

## Points d'attention

- Un placement **sans solde renseigné** affiche « — » et n'entre ni dans la
  plus-value ni dans le rendement globaux (il compterait sinon comme une
  perte totale, à tort). Renseigner le solde une première fois suffit.
- Un placement alimenté par relevé vaut ce que disait **le dernier relevé
  importé**. Entre deux relevés le chiffre ne bouge pas : c'est voulu, et
  c'est pour ça que la date du document est affichée partout plutôt que
  celle de l'import. Passé **90 jours**, l'onglet [À faire](16-a-faire.md)
  réclame un relevé frais pour cette banque — une seule ligne, quel que soit
  le nombre de comptes qu'il couvre.
- **Réimporter le même relevé le corrige**, il ne le double pas : l'app
  range un relevé par date, et un second dépôt à la même date remplace le
  premier. Un relevé d'une autre date ajoute un point à l'historique sans
  toucher aux précédents.
- Les comptes créés par un import arrivent **marqués comme nantis** : ce
  sont des titres, pas de la trésorerie mobilisable, donc ils ne gonflent ni
  le disponible ni le prévisionnel. Si un compte ne l'est pas réellement,
  cela se décoche sur sa fiche côté [Trésorerie](07-tresorerie.md).
- Le rendement annualisé suppose que les versements et retraits sont bien
  pointés en banque ; un flux non pointé fausse le calcul.
- La [vue consolidée](12-vue-consolidee.md) (`/app/all`) ne distingue pas
  encore les placements : ils y restent listés avec le reste des deals.

## Pages liées

- [Entreprises](04-participations.md) (l'autre sous-onglet
  d'Investissements), [Pointage](08-pointage.md) (rattacher les
  versements/retraits), [Trésorerie](07-tresorerie.md) (les comptes
  bancaires courants), [À faire](16-a-faire.md) (le rappel de relevé)
