# Deals

## À quoi ça sert

Un **deal** = un investissement précis : un instrument souscrit à un instant
donné. Un réinvestissement (follow-on) est un nouveau deal. Un deal s'ouvre
**depuis la fiche de sa société** ([Participations](04-participations.md)) —
il n'y a plus de liste de deals dédiée dans une organisation, la logique de
lecture passant toujours par l'entreprise. La [vue
consolidée](12-vue-consolidee.md) garde, elle, sa liste de deals à plat
toutes organisations confondues.

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
  automatiquement depuis Attio), *actif*, **Exit win** / **Exit loss**
  (sortie gagnante ou perdante, selon le multiple réalisé). Le statut se lit
  sur un **seul badge**, en teinte claire, avec la même **couleur** partout
  (fiche deal, liste des deals, fiche société) que les bandeaux de la liste
  des participations : ambre = *engagé*, bleu = position ouverte (actif),
  vert = Exit win, rouge = Exit loss. Le **gris** couvre les deux cas qui ne
  sont ni une victoire ni une perte : une sortie dont le multiple n'est pas
  calculable (aucun capital décaissé), et un deal **annulé** (cf. « Annuler un
  deal » plus bas). Un deal *engagé*
  **passe tout seul en actif** dès qu'un décaissement lui est pointé
  (cf. [Pointage](08-pointage.md)).
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

La fiche est bâtie comme celle d'une société : une colonne principale au
centre pour la vie du deal, et un **panneau latéral à droite** qui reste
visible pendant qu'on fait défiler la page.

- **Montants en tête** : le montant du deal + « Reçu ». Le montant s'adapte au
  cas (cf. « Montants » ci-dessus : décaissé réel si investi, engagé
  prévisionnel si en term sheet, ou les deux pour un fonds).
- **Détails de l'instrument** (panneau de droite) : les caractéristiques
  propres au type d'instrument — montants, taux, dates, multiples — une par
  ligne, **éditables au clic** sur la valeur. Le type lui-même sert de titre à
  la fiche tant que le deal n'a pas de nom personnalisé ; on le change via
  ⋯ → « Modifier ».
- **Panneau Royalties** (deals royalties) : les royalties perçues face au
  plancher et au plafond, puis le business plan initial trimestre par
  trimestre et les réels — les écarts et le BP dégradé sont calculés à
  l'affichage. Les paramètres (capital investi, taux, multiples, dates) sont
  dans le panneau de droite, comme pour tout autre instrument.
- **Section Fonds** (engagements LP) : appels et distributions.
- **Business plan vs réalisé** : graphique et tableau comparant le BP initial
  (figé au closing), le BP révisé et le réel. La saisie du BP se fait via
  l'[assistant IA](11-assistant-ia.md) (coller le BP suffit), pas par un
  formulaire.
- **Prévisionnel du deal** : les échéances prévisionnelles liées (loyers
  SCPI, coupons, appels programmés). Le capital engagé restant à déployer
  se lit dans la [Trésorerie](09-previsionnel.md), carte « Capital engagé
  non appelé », où la courbe dont il est mis à part est sous les yeux. Le
  bouton **« Ajouter une prévision »** crée une échéance ponctuelle
  directement rattachée à ce deal, sans passer par la Trésorerie ; elle
  remonte aussitôt ici et dans le prévisionnel de trésorerie.
- **Transactions** : les mouvements bancaires rattachés au deal. Un clic
  ouvre le détail avec possibilité de **réaffecter** la transaction à un
  autre deal.
- **Documents** : les pièces propres à **ce deal** — term sheet, pacte ou
  statuts, bulletin de souscription, attestation ou KBIS, et « autre » pour
  le reste. Cette liste ne montre que les documents **de ce deal**, mais ils
  apparaissent aussi dans la liste « Documents & rapports » de la
  [société](04-participations.md), avec le badge du deal : un pacte engage
  l'entité autant que le deal qui l'a produit, et il n'y a jamais qu'un seul
  fichier stocké. On dépose un fichier (**20 Mo maximum**) en lui donnant un titre,
  un type et, si utile, la **date du document** (signature par exemple) —
  cette date est facultative. **Plusieurs fichiers peuvent être déposés en
  une fois** : chacun garde son titre, le type et la date s'appliquant à
  tout le lot. Présentation identique à celle de la société :
  une box par document, un **clic pour l'ouvrir**, un **crayon** pour
  corriger titre / type / date, une corbeille (avec confirmation), un filtre
  par type, et l'état de sa **lecture** automatique — mêmes règles que côté
  société, détaillées dans [Participations](04-participations.md).
- **Notes** : texte libre, sous les détails de l'instrument dans le panneau de
  droite, **éditables au clic** comme les autres lignes du panneau : on clique
  le texte, on écrit, on clique ailleurs — c'est enregistré. Échap annule.

## Gérer une sortie

Le dialogue « Gérer la sortie » pose le statut (sortie totale ou perte
totale), la date et le produit de cession. Une sortie est **réversible** : on
peut l'annuler et le deal redevient actif.

Une fois sorti, la **couleur du statut** dit comment ça s'est passé, déduite du
multiple réalisé (MOIC, calculé depuis les transactions pointées) : **vert**
au-dessus de 1 (« Exit win »), **rouge** en dessous (« Exit loss ») — une perte
actée est toujours un « Exit loss » rouge.

## Annuler un deal

Il arrive qu'un deal soit **annulé après le virement** : les fonds partent,
l'opération ne se fait finalement pas, l'argent revient. Les deux mouvements
bancaires existent et doivent être pointés sur quelque chose — donc le deal
(et l'entité en face) doit exister dans Albo OS. Mais ce n'est **ni une
sortie ni une perte** : il n'y a jamais eu de participation.

Le statut **« Annulé »** est là pour ça. Il se pose dans le même dialogue que
les sorties (« Gérer la sortie » → type *Annulé*), avec la date du
remboursement et le montant remboursé, et il est **réversible** comme une
sortie.

Un deal annulé est traité comme **hors performance** : pas de multiple, pas de
TRI, pas de TVPI — un remboursement n'est pas un retour, et l'afficher à 1,00×
en vert raconterait une victoire qui n'a pas eu lieu. Il ne compte ni dans le
capital déployé, ni dans le distribué, ni dans la valeur du portefeuille, ni
dans le nombre de participations du tableau de bord, et l'entreprise n'est plus
attendue sur ses reportings.

Côté affichage, il est **volontairement discret** : absent des tableaux par
statut de la liste des participations — il vit dans une section repliée
« *n* deals annulés » en bas de page, qui n'apparaît que s'il en existe au
moins un — et masqué de la liste des deals tant qu'on n'a pas coché *Annulé*
dans le filtre Statut. Il reste visible normalement sur la **fiche société**
(en dernier) et sur sa propre fiche.

Une **cession partielle** n'a pas de statut dédié : le deal reste **actif**,
puisqu'on en détient encore une partie. L'argent déjà récupéré apparaît dans
le reçu et dans le multiple réalisé du deal — c'est là qu'on lit le gain, pas
dans le statut. Pensez à mettre à jour la **valorisation** de ce qui reste
détenu après la cession, sans quoi la valeur du portefeuille compte à la fois
le cash encaissé et la totalité de la ligne d'origine.

## Points d'attention

- **Supprimer un deal est refusé** tant que des transactions lui sont
  rattachées — il faut les détacher d'abord (aucune transaction orpheline).
- **Supprimer un deal supprime aussi ses documents**, fichiers compris.
  Ils n'existent nulle part ailleurs : à récupérer avant, si besoin.
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
