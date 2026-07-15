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
portefeuille. La saisie se fait depuis la fiche deal ou via
l'[assistant IA](11-assistant-ia.md) (« enregistre une valo de X à telle
date »).

## KPIs

Un KPI = une valeur de métrique, sur une période, pour une société. Exemples :
ARR, MRR, GMV, effectif ; pour les fonds : NAV, TVPI, DPI. Il n'y a **pas de
fréquence imposée** : on saisit au fil des investor updates et des calls
fondateurs, à la main ou — le plus souvent — via l'assistant IA qui extrait
les chiffres d'un reporting. Chaque valeur garde sa source et sa date de
saisie. L'historique se consulte sur la fiche société.

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
  vaut : zéro si le deal est sorti ou en perte ; sinon la dernière
  valorisation connue ; à défaut, le coût.
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

## Pages liées

- [Deals](05-deals.md), [Pointage](08-pointage.md),
  [Tableau de bord](03-tableau-de-bord.md)
