# Deals

## À quoi ça sert

Un **deal** = un investissement précis : un instrument souscrit à un instant
donné. Un réinvestissement (follow-on) est un nouveau deal. La section Deals
(`/app/<org>/deals`) montre le portefeuille **à plat** — une ligne par deal —
là où [Participations](04-participations.md) regroupe par société.

## Anatomie d'un deal

- **Investisseur** : l'entité du groupe qui a investi — toujours une entité
  du groupe, jamais une participation. C'est une règle stricte de l'outil.
- **Cible** : la société investie.
- **Via SPV** (optionnel) : quand l'investissement passe par un SPV
  intermédiaire.
- **Instrument** : le type d'investissement. Une vingtaine sont gérés —
  actions, BSA, BSA-AIR, SAFE, obligations convertibles ou simples, compte
  courant d'associé, royalties, engagement LP dans un fonds, parts de SPV,
  lead SPV (fees + carried), structure de carried (participation dans un
  véhicule dédié au carried, type OPRTRS & Co), immobilier
  direct, SCPI, CTO, dépôt à terme, crypto, prêt, compte de capitalisation.
  Chaque instrument a ses
  champs propres (prix par action et valorisation d'entrée pour les actions,
  taux et maturité pour la dette, cap et discount pour un SAFE, etc.).
- **Montants** : un deal a un **engagé** (ce qu'on s'est engagé à investir,
  saisi) et un **décaissé (réel)** (ce qui est réellement sorti, calculé depuis
  les transactions bancaires pointées, jamais saisi). Pour un deal direct les
  deux sont égaux une fois câblé, donc on n'en affiche qu'un : le **décaissé
  (réel)** s'il est investi, l'**engagé prévisionnel** s'il est encore en term
  sheet (rien n'est décaissé). Les **fonds** affichent les deux — engagé
  (commit) vs **capital appelé** — car ils diffèrent réellement.
- **Statut** : *engagé* (term sheet signée, pas encore câblé — créé
  automatiquement depuis Attio), *actif*, *sorti partiellement*, *sorti*,
  *passé en perte*.
- **Dates** : signature (tri par défaut), closing, sortie.
- **Titres et détention** : les deals en actions enregistrent le **nombre de
  titres acquis** et le **prix par titre**. Un achat sur le **secondaire**
  n'est pas un instrument à part : c'est un deal en **actions** dont le
  **tour** est « Secondaire ». Le
  **pourcentage de détention** ne se saisit
  pas sur le deal : il est **calculé au niveau de la société** (titres détenus
  rapportés au capital total), là où il a du sens — une société peut porter
  plusieurs deals.

## La fiche deal

- **Montants en tête** : le montant du deal + « Reçu ». Le montant s'adapte au
  cas (cf. « Montants » ci-dessus : décaissé réel si investi, engagé
  prévisionnel si en term sheet, ou les deux pour un fonds).
- **Bloc instrument** : les champs propres au type d'instrument, éditables en
  ligne. Le type s'affiche dans ce bloc (et sert de titre à la fiche tant que
  le deal n'a pas de nom personnalisé) ; on le change via ⋯ → « Modifier ».
- **Panneau Royalties** (deals royalties) : capital investi, taux de
  royalties, plafond, multiples plancher/plafond, business plan initial
  trimestre par trimestre et réels — les écarts et le BP dégradé sont
  calculés à l'affichage.
- **Section Fonds** (engagements LP) : appels et distributions.
- **Business plan vs réalisé** : graphique et tableau comparant le BP initial
  (figé au closing), le BP révisé et le réel. La saisie du BP se fait via
  l'[assistant IA](11-assistant-ia.md) (coller le BP suffit), pas par un
  formulaire.
- **Prévisionnel du deal** : les échéances prévisionnelles liées (loyers
  SCPI, coupons, appels programmés) et le reste engagé à déployer. Le
  bouton **« Ajouter une prévision »** crée une échéance ponctuelle
  directement rattachée à ce deal, sans passer par la Trésorerie ; elle
  remonte aussitôt ici et dans le prévisionnel de trésorerie.
- **Transactions** : les mouvements bancaires rattachés au deal. Un clic
  ouvre le détail avec possibilité de **réaffecter** la transaction à un
  autre deal.
- **Notes** : texte libre.

## Gérer une sortie

Le dialogue « Gérer la sortie » pose le statut (sortie totale, partielle,
perte), la date et le produit de cession. Une sortie est **réversible** : on
peut l'annuler et le deal redevient actif.

Une fois sorti, le deal porte un **badge gagné/perdu** déduit du multiple
réalisé (MOIC, calculé depuis les transactions pointées) : au-dessus de 1
c'est un **exit gagnant**, en dessous un **exit perdant** — une perte actée
est toujours « perdant ». Pour une **sortie partielle**, le deal reste actif
(on détient encore une partie) : seul un gain déjà réalisé est signalé (badge
« Exit gagnant » quand le reçu dépasse déjà le capital déployé), jamais
« perdant », puisque la position n'est pas soldée.

## Points d'attention

- **Supprimer un deal est refusé** tant que des transactions lui sont
  rattachées — il faut les détacher d'abord (aucune transaction orpheline).
- Les métriques affichées (Versé, Reçu, MOIC, TRI) sont **toujours
  recalculées** depuis les transactions pointées — le pointage est donc la
  condition pour que les chiffres soient justes. Voir
  [Pointage](08-pointage.md) et
  [Valorisations, KPIs et métriques](06-valorisations-et-kpis.md).
- Les deals venus d'Attio gardent leur lien (identifiant Attio) ; une fois
  actifs, Attio ne peut plus écraser leurs données financières.

## Pages liées

- [Participations](04-participations.md), [Pointage](08-pointage.md),
  [Valorisations, KPIs et métriques](06-valorisations-et-kpis.md),
  [Intégrations](15-integrations.md) (synchro Attio)
