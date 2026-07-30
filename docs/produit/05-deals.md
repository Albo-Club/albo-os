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
  automatiquement depuis Attio), *actif*, *sorti partiellement*, **Exit
  win** / **Exit loss** (sortie gagnante ou perdante, selon le multiple
  réalisé). La **couleur** du statut ne sert qu'à la sortie : vert = Exit
  win, rouge = Exit loss, gris = neutre (actif ou sortie sans plus-value) ;
  *engagé* est en ambre. Une **sortie partielle** vire au vert dès qu'elle
  est déjà dans le vert, jamais au rouge (la position n'est pas soldée).
  Un deal actif se suit par ses reports, pas par une couleur — le bleu
  « position ouverte » n'apparaît que sur les repères de la liste
  (bandeaux) et de la fiche société (liseré).
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
- **Documents** : les pièces propres à **ce deal** — term sheet, pacte ou
  statuts, bulletin de souscription, attestation ou KBIS, et « autre » pour
  le reste. À distinguer des documents de la **société**, qui vivent sur sa
  fiche (reportings, business plan, juridique) : un document déposé ici
  n'apparaît **que** sur le deal, jamais dans l'onglet Documents de la
  société. On dépose un fichier (**20 Mo maximum**) en lui donnant un titre,
  un type et, si utile, la **date du document** (signature par exemple) —
  cette date est facultative. Présentation identique à celle de la société :
  une box par document, un **clic pour l'ouvrir**, un **crayon** pour
  corriger titre / type / date, une corbeille (avec confirmation), un filtre
  par type, et l'état de sa **lecture** automatique — mêmes règles que côté
  société, détaillées dans [Participations](04-participations.md).
- **Notes** : texte libre.

## Gérer une sortie

Le dialogue « Gérer la sortie » pose le statut (sortie totale, partielle,
perte), la date et le produit de cession. Une sortie est **réversible** : on
peut l'annuler et le deal redevient actif.

Une fois sorti, la **couleur du statut** dit comment ça s'est passé, déduite du
multiple réalisé (MOIC, calculé depuis les transactions pointées) : **vert**
au-dessus de 1 (« Exit win »), **rouge** en dessous (« Exit loss ») — une perte
actée est toujours un « Exit loss » rouge. Pour une **sortie partielle**, le deal
reste actif (on détient encore une partie) : seul un gain déjà réalisé est
signalé (statut « Exit partiel » en **vert** quand le reçu dépasse déjà le
capital déployé), jamais en rouge, puisque la position n'est pas soldée.

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
