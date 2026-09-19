# Valorisations, KPIs et métriques

## À quoi ça sert

Trois briques distinctes nourrissent la lecture de performance du
portefeuille :

- les **valorisations** : l'historique horodaté de la juste valeur de chaque
  deal ;
- les **KPIs** : les métriques opérationnelles des sociétés (ARR, MRR,
  effectif, NAV d'un fonds…), saisies au fil des reportings ;
- les **métriques calculées** : MOIC, TVPI, DPI, TRI — jamais stockées,
  toujours recalculées à l'affichage.

## Valorisations

Chaque deal porte un historique de valorisations : une date, une juste
valeur, une méthode (dernier tour, mark-to-market…), une source et des notes.
La **dernière valorisation connue** d'un deal alimente la NAV et le TVPI du
portefeuille. La saisie se fait depuis la section « Valorisation » de la
[fiche deal](05-deals.md) — présente sur les instruments qui portent une
valeur de ligne, la liste est dans cette page —, depuis la page Placements
pour un placement de trésorerie, ou via l'[assistant IA](11-assistant-ia.md)
(« enregistre une valo de X à telle date »).

À ne pas confondre avec la section **Capital et valorisation** de la
[fiche société](04-participations.md), qui suit les **opérations sur le
capital** d'une participation en actions (tours suivants, exercices de BSA,
conversions) et en déduit la valorisation actuelle de la société et de notre
ligne. Cette lecture est informative pour l'instant : elle n'entre pas dans
le TVPI ni la NAV, qui restent alimentés par l'historique ci-dessus.

## KPIs

Un KPI = une valeur de métrique, sur une période, pour une société. Exemples :
ARR, MRR, GMV, effectif ; pour les fonds : NAV, TVPI, DPI. Il n'y a **pas de
fréquence imposée** : on saisit au fil des investor updates et des calls
fondateurs, à la main ou — le plus souvent — via l'assistant IA qui extrait
les chiffres d'un reporting. Chaque valeur garde sa source et sa date de
saisie. L'historique se consulte sur la fiche société.

### Fiche KPI cible (KPIs suivis)

Chaque participation peut porter sa liste de **KPIs suivis**, choisis dans le
catalogue de métriques (carte « KPIs suivis » en tête de la section KPIs de
la fiche). Cette fiche sert de grille de lecture aux reports reçus par
email : les KPIs cibles sont extraits en priorité (une seule valeur par KPI,
celle qui couvre la période du report), et le récap email affiche une
checklist — ✅ trouvé avec sa valeur, ⚠️ absent de ce report. Au premier
paramétrage, les métriques déjà vues dans les reports passés sont
pré-cochées ; il suffit de valider. Sans fiche définie, l'extraction
retombe sur la mémoire implicite (les métriques déjà vues).

## Métriques calculées : comment lire les chiffres

Toutes les métriques partent des **transactions bancaires pointées** sur les
deals (voir [Pointage](08-pointage.md)) :

- **Versé** : la somme des sorties pointées sur le deal.
- **Reçu** : la somme des entrées pointées sur le deal (jamais compensées
  entre elles).
- **MOIC réalisé** : Reçu ÷ Versé. Particularité : pour les deals en
  royalties, dont les encaissements sont TTC, le Reçu est dé-TVAisé (÷ 1,2)
  dans ce calcul — et uniquement dans celui-là.
- **TVPI** : (Reçu brut + valeur résiduelle) ÷ Versé. La valeur résiduelle
  vaut : zéro dès que le deal est terminé — sorti, en perte ou annulé ;
  sinon la dernière valorisation connue ; à défaut, le coût.
- **DPI** : Distribué ÷ Versé, au niveau du portefeuille.
- **TRI (XIRR)** : taux de rendement interne annualisé, calculé sur les flux
  datés réels. Au niveau d'une société, les flux de tous ses deals sont
  concaténés pour résoudre un seul TRI (le TRI ne s'additionne pas).
- **NAV du portefeuille** : somme des valeurs résiduelles des deals actifs.

## Points d'attention

- **Pas de pointage, pas de performance** : un virement non rapproché d'un
  deal n'existe pas pour le MOIC/TRI. Le pointage est la source de tout.
- Une valorisation ne remplace jamais la précédente : c'est un historique,
  la plus récente gagne.
- **Un deal annulé ne porte aucune de ces métriques** : ni MOIC, ni TVPI, ni
  TRI, et il ne compte ni dans le capital déployé, ni dans le distribué, ni
  dans la NAV. Un remboursement n'est pas un retour. Le détail est dans
  [Deals](05-deals.md) § « Annuler un deal ».
- **Un deal de rémunération de SPV non plus** : piloter un SPV pour d'autres
  investisseurs rapporte des frais de gestion et du carried, et c'est un
  revenu d'activité, pas un capital placé. Ces deals sortent donc du déployé,
  du distribué, de la NAV et du nombre de participations, et n'affichent ni
  MOIC ni TRI — un multiple calculé sur des frais avancés annoncerait un
  rendement qui n'existe pas. Leurs mouvements restent visibles sur la fiche
  du deal. À ne pas confondre avec une **participation dans une structure de
  carried**, qui est un vrai investissement et garde toutes ses métriques.

## Pages liées

- [Deals](05-deals.md), [Pointage](08-pointage.md)
