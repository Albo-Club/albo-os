# SPEC — Dette, Garanties & Immobilier

> Cahier des charges issu de l'interview du 29/08/2026. Aucun code n'a été
> écrit pour produire ce document. Les décisions notées `D<n>` ont été prises
> et validées explicitement ; les points listés en § 9 ne l'ont pas été.
>
> Maquette des écrans : publiée à part, référencée dans la PR.

---

## 1. Problème et valeur

Albo OS sait répondre à « qu'est-ce que je possède ? » (deals, placements,
trésorerie). Il ne sait pas répondre à **« qu'est-ce que je dois, à qui, et
qu'est-ce que j'ai mis en gage pour l'obtenir ? »**.

Quatre questions n'ont aujourd'hui aucune réponse dans l'app :

1. **Combien chaque société doit-elle encore ?** Le capital restant dû de
   chaque prêt vit dans des tableaux d'amortissement PDF.
2. **Qu'est-ce qui est gagé, et à quelle hauteur ?** Un même contrat de
   capitalisation peut garantir trois emprunteurs différents. Personne ne sait,
   sans ressortir les actes, combien il reste de marge disponible.
3. **Quels biens immobiliers détient le groupe, et rapportent-ils ?**
4. **Quelle est la structure capitalistique des filiales ?** Depuis ALB-128
   chaque société a son espace, mais capital et % de détention ne sont saisis
   nulle part.

La valeur n'est pas dans le calcul — c'est de la finance simple. Elle est dans
le fait que **ces informations soient au même endroit que les flux bancaires**,
donc vivantes plutôt que figées dans un Excel qui vieillit.

---

## 2. Utilisateurs et cas d'usage

Deux utilisateurs : Benjamin et Clément. Outil interne. Aucun droit d'accès
différencié (**D2**).

| # | Cas d'usage | Écran |
|---|---|---|
| U1 | « Combien SCI Chapelle doit-elle encore à sa banque ? » | Passif de `sci-chapelle` |
| U2 | « Où en est ce prêt, quelles échéances restent ? » | Fiche prêt |
| U3 | « Ce contrat garantit quoi au total ? Il me reste de la marge ? » | Fiche placement, `calte` |
| U4 | « Ce prêt est garanti par quoi ? » | Fiche prêt |
| U5 | « Que possède cette SCI, combien ça vaut, combien ça rapporte ? » | Onglet Immobilier |
| U6 | « Qui détient le capital de cette filiale ? » | Passif de la filiale |
| U7 | « Je pointe le prélèvement du prêt » | File de Pointage |
| U8 | « Mes sorties des 6 prochains mois ? » | Prévisionnel (dans Trésorerie) |
| U9 | « Combien RDB doit encore ? » | Assistant IA |

---

## 3. Périmètre

### IN

- Les **prêts bancaires** contractés par les sociétés du groupe.
- Les **garanties** : nantissement, hypothèque, PPD, caution, garantie
  d'organisme — y compris celles **données à un tiers hors groupe**.
- Les **biens immobiliers**, y compris en mode marchand de biens.
- Le **capital et les % de détention** des sociétés du groupe.
- Le branchement sur l'existant : pointage, prévisionnel, « À faire »,
  documents, assistant IA.

### OUT — explicitement

- **Le patrimoine personnel de Clément** (**D1**). Corollaire : aucune notion
  de personne physique n'est créée ; `holderPersonId` / `fromPersonId`
  restent morts.
- **Les droits d'accès différenciés** (**D2**).
- **Une vue consolidée « dette du groupe »** (**D14**). Une page par société.
  Le modèle la rend possible plus tard, elle n'est pas construite.
- **Deux montants pour la même dépense** (**D43**). Chaque poste a une source
  et une seule. Il n'y a nulle part de « montant théorique » doublé d'un
  « montant réel » sur la même ligne.
- **Le découpage d'une transaction en plusieurs postes** (**D42**). Une
  transaction porte une seule affectation ; l'éclater toucherait tout le
  pointage, les soldes et la TVA.
- **La bascule des 7,8 M€ d'avances CALTE → filiales** (**D30**) — chantier
  de données à part.
- **La renégociation avec historique** (garder l'avant et l'après d'un avenant)
  — lot 5 (**D35**). À ne pas confondre avec un taux variable, qui est géré
  dès le lot 1 (**D47**) : réviser un taux prévu au contrat n'est pas
  renégocier le contrat.
- **La récupération automatique d'un index de taux** (Euribor…) — **D47**,
  cf. Q-F.
- **Les covenants bancaires** (ratios LTV, DSCR imposés par le prêteur).
- **La gestion locative** au sens métier : quittances, appels de loyer,
  relances, indexation IRL, états des lieux. Un bien est suivi comme un actif,
  pas comme un bail.
- **La copropriété** (AG, appels de fonds, tantièmes).
- **Les devises autres que l'euro** (**D36**).
- **L'historique d'audit** (« qui a changé quoi ») (**D35**).
- **L'import de transactions.** Il n'existe pas aujourd'hui : les transactions
  viennent uniquement de la connexion bancaire. Le modèle est conçu pour en
  bénéficier si un import arrive un jour (**D43**), mais le construire est un
  chantier distinct.

---

## 4. Modèle de données

Conventions Albo OS : montants **entiers en cents EUR**, taux en **basis
points**, dates en **ms epoch UTC**, `orgId` sur toute table,
`requireOrgMember` sur toute fonction, unicité enforcée en mutation.

### 4.1 `loans` — un prêt contracté par une société

```
loans
  orgId              Id<'organizations'>   société emprunteuse
  label              string                "Prêt Palatine 2021"
  lenderName         string                "Banque Palatine" (texte libre)
  principalCents     number                montant emprunté
  signedDate         number                ms epoch
  firstPaymentDate   number                ms epoch
  durationMonths     number?               absent pour un révolving
  amortizationKind   'constant_annuity' | 'constant_capital'
                     | 'bullet' | 'revolving'          ← D45
  creditLimitCents   number?               plafond autorisé (révolving seulement)
  rateBps            number                taux À LA SIGNATURE (1100 = 11 %)
  rateKind           'fixed' | 'variable'
  insuranceMonthlyCents  number?           assurance emprunteur, cents/mois
  paymentFrequency   'monthly' | 'quarterly'
  deferralMonths     number?               différé d'amortissement
  deferralKind       'partial' | 'total'?  partiel = intérêts payés ;
                                           total = intérêts capitalisés  ← D45
  endDate            number?               ms epoch — borne de projection
                                           d'un révolving (cf. ci-dessous)
  bankAccountId      Id<'bankAccounts'>?   compte de prélèvement (même org)
  status             'active' | 'repaid' | 'cancelled'
  notes              string?

  .index('by_org', ['orgId'])
  .index('by_org_status', ['orgId', 'status'])
  .index('by_bank_account', ['bankAccountId'])
```

**Les quatre types d'amortissement** (**D45**) — sans eux, le lot 1 ne saurait
saisir qu'une minorité des prêts du groupe :

| Type | Ce qu'on paie | Restant dû | Champs requis |
|---|---|---|---|
| `constant_annuity` | Mensualité fixe, part de capital croissante | Calculé | `durationMonths` |
| `constant_capital` | Capital fixe (`P/n`), mensualité décroissante | Calculé | `durationMonths` |
| `bullet` (in fine) | Intérêts seuls, **capital en une fois à l'échéance** | = `principalCents` jusqu'au terme | `durationMonths` |
| `revolving` (lombard) | Intérêts sur l'encours ; **pas d'échéancier** | = `principalCents`, saisi | `creditLimitCents` |

**`endDate` n'a de sens que sur un révolving.** Un crédit sans échéancier et
sans durée projetterait des intérêts indéfiniment : `endDate` borne cette
projection quand le contrat a un terme connu. Absente, la projection s'arrête
à l'horizon du prévisionnel. Les trois autres types tirent leur borne de
`durationMonths` et ignorent ce champ.

**Le révolving est le cas particulier assumé.** Il n'a ni échéancier ni durée
fixe : `principalCents` y désigne l'**encours courant**, mis à jour à la main
(le geste « Corriger » du lot 1, puis « Mettre à jour au JJ/MM » au lot 5).
C'est la seule ligne du module où un restant dû est saisi plutôt que dérivé —
limitation documentée, pas oubli.

**Pas de champ « capital restant dû »** sur les trois autres types — il est
dérivé, par la même philosophie que les soldes de comptes courants
(`KNOWN_ISSUES.md` § Passif) : un chiffre stocké se désynchronise, un chiffre
dérivé ne peut pas.

### 4.1 bis `loanRates` — les révisions d'un taux variable (**D47**)

```
loanRates
  orgId     Id<'organizations'>
  loanId    Id<'loans'>
  fromDate  number     ms epoch, date d'effet
  rateBps   number
  kind      'actual' | 'forecast'
  notes     string?

  .index('by_loan_from', ['loanId', 'fromDate'])
```

**Une table et non un tableau sur le prêt** : sur vingt ans à révision
trimestrielle la série grandit sans borne, et `loans` est lu en liste sur la
page Passif — c'est exactement l'anti-pattern signalé dans `CLAUDE.md` (un
champ volumineux sur une ligne lue en liste ; Convex lit et facture la ligne
entière).

**Deux natures dans la même série, même forme :**

- `actual` — une révision qui a eu lieu : « depuis le 01/07/2026, 3,4 % ».
- `forecast` — une hypothèse de pilotage : « à partir de 2028, tabler sur 3,8 % ».

**Règle du taux applicable à une date** : le dernier `loanRates` dont
`fromDate <= date`, à défaut `loans.rateBps` (le taux à la signature). Un prêt
à taux fixe n'a donc **aucune** ligne `loanRates` — rien à saisir, rien à
maintenir.

> **L'échéancier d'un prêt à taux variable est une projection, pas un plan.**
> Personne ne connaît le taux de 2029. L'UI doit le dire : au-delà de la
> dernière révision `actual`, les échéances sont marquées comme projetées.

**Aucune récupération automatique d'index** (Euribor…). Ce serait une source
de données externe, dont l'app n'a aucun équivalent aujourd'hui : un connecteur
à construire, maintenir et sécuriser, pour une poignée de prêts. Noté en
évolution (**Q-F**), pas construit.

**Pas de champ « capital restant dû »** — il est dérivé, par la même
philosophie que les soldes de comptes courants (`KNOWN_ISSUES.md` § Passif) :
un chiffre stocké se désynchronise, un chiffre dérivé ne peut pas.

**Pas de table d'échéancier** — l'échéancier est calculé par une fonction pure
(`convex/lib/amortization.ts`, testable hors Convex comme `lib/recurrence.ts`
et `lib/liabilities.ts`). Ce qui est stocké, ce sont les occurrences
prévisionnelles, dans `forecastEntries` (§ 4.7).

**Pas de `searchText`** — ce champ n'existe que sur `transactions`, qui porte
un `searchIndex` pour la recherche du pointage. Le copier ailleurs serait du
gras sans usage.

**Pas de covenants** (LTV, DSCR imposés par la banque) — hors périmètre.

### 4.2 `guarantees` — le lien prêt ↔ sûreté

Table centrale du module. Elle porte **trois informations indépendantes**
(**D17**) :

| Information | Champ | Exemple |
|---|---|---|
| **La forme** | `form` | nantissement, hypothèque, PPD, caution, garantie d'organisme |
| **L'assiette** | `subject*` | le contrat Concerto Capi, le bien de la SCI, les titres de CALTE, rien de chez nous |
| **Le garant** | `pledgorOrgId` / `pledgorLabel` | CALTE, la SCI elle-même, Saccef |

```
guarantees
  // ── Où la ligne est classée ─────────────────────────────────────────
  orgId              Id<'organizations'>?  société qui ENREGISTRE la sûreté
  // Pas une quatrième partie : l'ancre de la ligne. Optionnel le temps du
  // remplissage en prod (migrations/backfillGuaranteeOrg), puis requis.

  // ── Bénéficiaire ────────────────────────────────────────────────────
  loanId             Id<'loans'>?          prêt interne au groupe
  borrowerOrgId      Id<'organizations'>?  org du prêt (dénormalisé, indexé)
  borrowerLabel      string?               emprunteur HORS groupe (D-QA)
  // Exactement l'un des deux : (loanId + borrowerOrgId) OU borrowerLabel.

  // ── Le garant ───────────────────────────────────────────────────────
  pledgorOrgId       Id<'organizations'>?  société du groupe qui s'engage
  pledgorLabel       string?               garant externe ("Saccef")

  // ── L'assiette ──────────────────────────────────────────────────────
  subjectKind        'placement' | 'property' | 'shares' | 'external'
  subjectDealId      Id<'deals'>?          si 'placement'
  subjectPropertyId  Id<'properties'>?     si 'property'
  subjectCompanyId   Id<'companies'>?      si 'shares'
  subjectOrgId       Id<'organizations'>?  org où vit l'assiette
  subjectLabel       string?               si 'external'

  // ── Le gage ─────────────────────────────────────────────────────────
  form               'nantissement' | 'hypotheque' | 'ppd' | 'caution'
                     | 'garantie_organisme'
  rank               number?               1 = premier rang, 2 = second…  ← D48
  pledgedAmountCents number?               absent si non chiffré (caution illimitée)
  actDate            number?
  releasedAt         number?               mainlevée. Absent = active.
  notes              string?

  .index('by_org',             ['orgId'])
  .index('by_loan',            ['loanId'])
  .index('by_borrower_org',    ['borrowerOrgId'])
  .index('by_pledgor_org',     ['pledgorOrgId'])
  .index('by_subject_deal',    ['subjectDealId'])
  .index('by_subject_property',['subjectPropertyId'])
  .index('by_subject_company', ['subjectCompanyId'])
```

**`orgId` — la société qui enregistre, pas une partie de plus.** Une sûreté
peut légitimement n'avoir **aucune** partie du groupe : le cas 10b du § 10
(la sûreté d'un tiers sur la même dette hors groupe que la nôtre) n'a ni
prêt, ni actif, ni garant de chez nous. Sans ancre, cette ligne n'était
rattachable à rien et était refusée — alors que c'est elle qui dit que nos
500 K€ ne sont pas seuls sur cette dette. `orgId` est vérifié
(`requireOrgMember`) et jamais cru sur parole ; il ne bouge pas à l'édition.

**Une seule ligne, trois lectures** (**D13**) — rien n'est stocké deux fois :

- **Côté prêt** (`by_loan`) : « garanti par une caution de CALTE — 2,4 M€ ».
- **Côté assiette** : « ce contrat est gagé au profit de SCI Chapelle ».
- **Côté garant** (`by_pledgor_org`) : « je me suis porté caution pour RDB ».

**Le patron polymorphe est celui d'`equityPositions`** (détenteur = org, ou
personne, ou libellé libre) — plusieurs champs optionnels discriminés par un
champ de nature. C'est le précédent maison, pas celui de
`transactions.allocation` (qui utilise un `targetId: string` non typé).

**Autorisation.** Une garantie traverse potentiellement deux orgs (le prêt dans
`sci-chapelle`, l'assiette dans `calte`). Le garde-fou est un helper
`requireGuaranteeParty(ctx, guarantee)` — miroir de `requireLoanParty` dans
`convex/liabilities.ts` : **membre d'au moins une des orgs parties**
(`borrowerOrgId`, `pledgorOrgId`, `subjectOrgId`). Les orgs restent à plat,
aucun héritage de droits.

**Suppression** refusée tant que des documents y sont attachés
(`has_documents`), sur le modèle du `has_allocations` existant.

### 4.3 `properties` — un bien immobilier

```
properties
  orgId              Id<'organizations'>   société détentrice (D20)
  name               string                "18 rue de la Chapelle"
  address            string
  propertyType       'appartement' | 'maison' | 'immeuble'
                     | 'local_commercial' | 'terrain'
  usage              'locatif_nu' | 'locatif_meuble' | 'colocation'
                     | 'saisonnier' | 'commercial'
                     | 'marchand_de_biens' | 'residence_secondaire'
  surfaceSqm         number?

  // ── Prix de revient : UNE source par poste (D43) ────────────────────
  costBasis          v.array(v.object({
                       poste:  'acquisition' | 'frais_acquisition' | 'travaux',
                       source: 'manual' | 'flows',
                       manualAmountCents: v.optional(v.number()),
                     }))
  // source 'manual' → manualAmountCents fait foi.
  // source 'flows'  → le montant est la somme des transactions allouées à ce
  //                   bien avec cette `category`. manualAmountCents est ignoré
  //                   (conservé, pour pouvoir rebasculer sans ressaisir).
  // JAMAIS l'addition des deux.

  // ── Exploitation : toujours dérivée des flux, jamais saisie ─────────
  // (loyers et charges viennent des transactions allouées)

  // ── Sortie
  status             'held' | 'sold'
  saleDate           number?
  salePriceCents     number?

  notes              string?

  .index('by_org', ['orgId'])
  .index('by_org_status', ['orgId', 'status'])
```

**Aucun champ de montant saisi hors `costBasis`.** Les champs
`purchasePriceCents`, `notaryFeesCents`, `agencyFeesCents`, `worksCents` de la
première version sont **supprimés** : ils doublonnaient les flux pointés
(**D43**).

**Pas de `detention`** : le bien vit dans l'org qui le détient. Un champ de
plus serait une seconde vérité.

**Pas de DPE, année de construction, pièces, frais d'ameublement** — écartés
en **D24** (gestion locative, pas pilotage patrimonial).

**Le marchand de biens est un `usage`** (**D29**) : 80 % de champs communs
avec un bien locatif, et un bien peut changer d'usage. Quand
`usage === 'marchand_de_biens'`, l'UI masque l'exploitation et met en avant le
prix de revient et le TRI de sortie.

### 4.4 `propertyValuations` — la valeur dans le temps

```
propertyValuations
  orgId       Id<'organizations'>
  propertyId  Id<'properties'>
  asOf        number
  valueCents  number
  source      string?    "estimation agence", "notaire", "à dire d'expert"
  notes       string?

  .index('by_property_asof', ['propertyId', 'asOf'])
  .index('by_org_asof', ['orgId', 'asOf'])
```

Table distincte de `valuations` (qui exige un `dealId`) — même forme, même
lecture « dernière valeur connue ». Aucune estimation automatique : pas de
PriceHubble, pas d'API tierce (**D20**).

### 4.5 `equityPositions` — un champ à ajouter

```
  ownershipBps  number?   % de détention en bps (6000 = 60 %)
```

**Le % ne vit qu'à un endroit** (**D33**) : la structure capitalistique de la
société émettrice fait foi. Côté CALTE, le deal equity **lit** ce % au lieu de
le re-saisir — l'index `by_holder_org` existe déjà et rend ce chemin naturel.

Lecture symétrique : côté CALTE un deal equity sur la SCI (montant investi) ;
côté SCI la structure capitalistique au passif (CALTE 60 %, autre associé 40 %).

### 4.6 `transactions.allocation` — deux valeurs et un champ

```
allocation: {
  kind:     'deal' | 'equity' | 'intercompany_loan' | 'transfer'
            | 'loan'      ← nouveau : targetId = Id<'loans'>
            | 'property'  ← nouveau : targetId = Id<'properties'>
  targetId: string
  category: v.optional(v.string())   ← nouveau, utilisé par 'property'
}
```

**Catégories d'un flux sur un bien** (**D42**) — six valeurs, une seule par
transaction :

| Sens | Catégorie | Entre dans |
|---|---|---|
| Sortie | `acquisition` | prix de revient |
| Sortie | `frais_acquisition` | prix de revient |
| Sortie | `travaux` | prix de revient |
| Sortie | `charges` | résultat d'exploitation |
| Entrée | `loyer` | résultat d'exploitation |
| Entrée | `revente` | plus-value réalisée |

**Une transaction, une cible, une catégorie.** On ne l'éclate jamais. Un
virement notaire qui couvre le prix et les droits part entier dans
`acquisition` ; pour garder le détail sur un bien ancien, les deux postes
restent en source `manual` — c'est exactement l'usage du choix de source.

L'index `by_org_allocation_target` sert déjà ce pattern pour les deals,
l'equity et les comptes courants : rien à construire côté lecture.

> ⚠️ **Le pointage reste 100 % humain.** Aucune suggestion, aucune
> pré-sélection, aucun classement de candidats (règle du repo, cf. `CLAUDE.md`,
> supprimée en août 2026). L'utilisateur choisit la transaction ; **la
> conséquence** (recalcul du restant dû, du réel encaissé) est automatique.
> L'automatisme est dans le calcul, jamais dans le rapprochement.

### 4.7 `forecastRules` / `forecastEntries` — réemploi

Les échéances de prêt sont générées comme des occurrences prévisionnelles
existantes :

```
  derivedKey = "loan:{loanId}:{YYYY-MM-DD}"
  loanId     Id<'loans'>?   ← nouveau, symétrique du dealId déjà présent
```

**Ce que chaque type produit dans le prévisionnel** (**D45**) — c'est le vrai
enjeu du champ `amortizationKind` :

| Type | Lignes générées |
|---|---|
| `constant_annuity` | Une ligne par échéance, montant constant |
| `constant_capital` | Une ligne par échéance, montant décroissant |
| `bullet` | De petites lignes d'intérêts, **puis une ligne de capital énorme à l'échéance** |
| `revolving` | Des lignes d'intérêts sur l'encours, jusqu'à `endDate` ou l'horizon |

> **C'est là que le type change la vie.** Un in fine de 6,6 M€ doit faire
> apparaître 6,6 M€ dans la trésorerie prévisionnelle à une date précise. Sans
> `amortizationKind`, le prévisionnel lisserait ce capital sur toute la durée
> et le ballon serait invisible jusqu'à ce qu'il tombe.

Sur un **taux variable**, les occurrences sont recalculées à partir de la série
`loanRates` (§ 4.1 bis) : le prévisionnel varie d'un palier à l'autre au lieu
de supposer un taux plat pour vingt ans.

Le flag `overridden` protège une occurrence éditée à la main, comme pour les
règles.

### 4.8 `documents` — le point d'attention

`documents.companyId` est aujourd'hui **requis**. Un acte de prêt ou un
compromis n'a pas de société-cible au sens portfolio.

```
  companyId   Id<'companies'>?    ← devient OPTIONNEL
  loanId      Id<'loans'>?
  propertyId  Id<'properties'>?
  guaranteeId Id<'guarantees'>?

  .index('by_loan', ['loanId'])
  .index('by_property', ['propertyId'])
  .index('by_guarantee', ['guaranteeId'])
```

**C'est le seul changement de contrainte sur une table existante, et le seul
vrai risque du chantier.** Le détail du piège — pourquoi le sens du changement
le rend dangereux, et dans quel ordre procéder — est documenté dans
`KNOWN_ISSUES.md` § « Un document ne peut se rattacher qu'à une société ».

**Il se traite au lot 1**, avec la table `loans` et dans la même PR : c'est le
lot qui a besoin d'attacher un acte de prêt. Le sortir en PR isolée prendrait
le risque du schéma sans aucun code pour l'exercer. Le lot 4 n'ajoute ensuite
que `propertyId`.

Ampleur réelle de l'audit, **vérifiée dans le code** : les fichiers `convex/`
qui lisent la table `documents` sont `documents`, `documentsExtract`,
`companies`, `deals`, `reportInbox`, `reportStore`, `vectorize`, `agentTools`,
`lib/duplicates`, `migrations/legalDocsImport` et leurs tests de régression.

⚠️ `intelligence.ts` et `companyEnrichment.ts` **ne touchent jamais** cette
table — une première version de ce cahier des charges les listait, à tort :
leur champ `documents` est une propriété d'un objet report, pas la table. Et
**aucun fichier `src/`** ne lit `companyId` sur un document : les queries de
liste ne le renvoient pas.

Deux valeurs à ajouter à `documents.kind` : `acte_pret`, `acte_garantie`.

### 4.9 Vue d'ensemble

```
                    ┌──────────────┐
   org emprunteuse  │    loans     │
                    └──────┬───────┘
                           │ by_loan
                    ┌──────▼────────┐
                    │  guarantees   │──── pledgorOrgId ──► org garante
                    └──┬───┬────┬───┘
        subjectKind ───┘   │    └──── 'external' (Saccef, actif d'un tiers)
             │             │
     'placement'    'property' / 'shares'
             │             │
     ┌───────▼──────┐ ┌────▼───────┐
     │ deals        │ │ properties │◄── propertyValuations
     │ (placement)  │ │            │
     └──────────────┘ └────────────┘

   transactions.allocation ──► kind + targetId + category?
```

---

## 5. Règles de calcul

### 5.1 Échéancier et capital restant dû

`i` = taux périodique = (taux applicable à la date, § 4.1 bis) / 10000 / 12,
recalculé **à chaque échéance** — un taux variable fait varier `i` en cours de
route. `n` = `durationMonths`.

**Annuité constante**

```
mensualité = P × (i / (1 − (1 + i)^(−n)))
intérêts   = capital restant × i
capital    = mensualité − intérêts
```

**Capital constant**

```
capital    = P / n                     (fixe)
intérêts   = capital restant × i       (décroissants)
mensualité = capital + intérêts        (décroissante)
```

**In fine (`bullet`)**

```
échéances 1..n−1 : intérêts seuls = P × i     capital = 0
échéance n       : intérêts + P                ← le ballon
capital restant dû = P jusqu'au terme
```

**Révolving (`lombard`)**

Aucun échéancier. Les intérêts sont calculés sur l'encours courant
(`principalCents × i`) et projetés jusqu'à `endDate` si elle est connue, sinon
jusqu'à l'horizon du prévisionnel. Le restant dû est l'encours saisi.

**Le différé** (`deferralMonths` + `deferralKind`) :

- `partial` — pendant le différé, échéances d'intérêts seuls ; le capital
  reste à `P`.
- `total` — rien n'est payé ; les intérêts se **capitalisent** et le capital
  amorti démarre au-dessus de `P`.

**L'assurance** (`insuranceMonthlyCents`) est **hors** mensualité, dans une
colonne à part : le prélèvement réel vaut mensualité + assurance.

**Le réel** — la somme des transactions allouées `kind: 'loan'` sur ce prêt.

**Capital restant dû affiché** = celui du plan à la date du jour. Le réel sert
de **contrôle**, pas de source : une divergence signale un pointage incomplet
ou un événement non saisi, pas un bug.

> Conséquence à afficher et non à masquer : la mensualité du plan (2 494 €) ne
> vaut pas le prélèvement réel (2 536 €), qui inclut l'assurance. Montrer les
> deux évite de « corriger » un chiffre juste.

### 5.2 Marge disponible sur un actif gagé

```
valeur actuelle    = dernière valorisation connue
total gagé         = Σ pledgedAmountCents des garanties actives (releasedAt absent)
                     pointant sur cet actif
marge disponible   = valeur actuelle − total gagé
```

Trois précautions :

1. **Les garanties non chiffrées sont exclues du total et listées à part.**
   Une caution illimitée ne s'additionne pas ; l'afficher comme 0 mentirait.
2. **Le montant gagé n'est pas la valeur de l'actif** — c'est le montant
   inscrit à l'acte. Il peut la dépasser : c'est l'information utile.
3. **Cette lecture traverse les orgs.** Ce n'est pas une vue consolidée au sens
   de D14 : c'est la lecture d'un lien déjà accepté en D13.
4. **Le montant gagé ne décroît pas** avec la dette. Un nantissement de
   300 K€ sur un prêt dont il ne reste que 150 K€ vaut juridiquement 300 K€
   jusqu'à la mainlevée. La marge affichée est donc **pessimiste** — c'est
   voulu, pas un bug.

**Ordre d'affichage des sûretés** (**D48**), de la plus forte à la moins
forte :

| # | Forme | Pourquoi ce rang |
|---|---|---|
| 1 | **PPD** | Sûreté réelle immobilière ; son rang remonte à la date de la vente et prime une hypothèque inscrite avant. |
| 2 | **Hypothèque** | Sûreté réelle immobilière. |
| 3 | **Nantissement** | Sûreté réelle sur titres ou contrat, réalisable rapidement. |
| 4 | **Garantie d'organisme** | Sûreté personnelle, mais le garant est une institution capitalisée. |
| 5 | **Caution** | Sûreté personnelle ; ne vaut que la solvabilité du garant. |

> ⚠️ **C'est une convention d'affichage, pas une vérité juridique.** La force
> réelle d'une sûreté dépend aussi de son `rank` (premier ou second sur le même
> actif — un second rang ne vaut que ce qui reste après le premier) et de la
> situation du débiteur. Le tri sert à lire vite, pas à conclure.

### 5.3 Prix de revient et rentabilité d'un bien

```
montant d'un poste = source 'manual' → manualAmountCents
                     source 'flows'  → Σ transactions du bien de cette category
prix de revient    = acquisition + frais_acquisition + travaux
                     (chacun pris à sa propre source)

revenus réels      = Σ transactions 'in'  category 'loyer'    (12 mois glissants)
charges réelles    = Σ transactions 'out' category 'charges'  (12 mois glissants)
résultat net       = revenus − charges
rendement net      = résultat net / prix de revient
plus-value latente = dernière valorisation − prix de revient
```

**Tous les montants d'un bien sont TTC** (**D49**). Ils viennent de flux
bancaires, et un flux bancaire est TTC par nature. Reconstituer du HT
obligerait à ventiler la TVA poste par poste ; sur un locatif nu il n'y a de
toute façon rien à récupérer.

Les échéances de prêt ne sont **jamais** des charges du bien : elles sont
allouées au prêt, pas au bien.

Pour un bien `marchand_de_biens` vendu : **TRI (XIRR)** sur les flux datés
réels, avec la même implémentation que le TRI des deals — une seule fonction
XIRR dans le repo.

### 5.4 Arrondis

Règle maison « l'actuel au centime, l'estimé arrondi » :

| Au **centime** (`fmtEurCents`) | À l'**euro** (`fmtEur`) |
|---|---|
| Échéances réelles pointées | Capital restant dû (calculé) |
| Loyers et charges encaissés | Mensualité théorique |
| Postes du prix de revient | Valorisation d'un bien |
| Montant gagé (il est à l'acte) | Marge disponible |
| Solde de compte courant | Plus-value latente, rendements, TRI |

---

## 6. Vues UI

### 6.1 Navigation — ce qui existe vraiment

Vérifié dans le code (`src/components/app-shell/nav.ts`) : la barre latérale a
**quatre entrées** — À faire, Investissements, Trésorerie, Passif. Pointage et
Prévisionnel vivent **à l'intérieur** de Trésorerie. Placements est un
sous-onglet d'Investissements (`InvestmentsTabs`).

**Le module n'ajoute aucune entrée de barre latérale.** Immobilier devient le
**troisième onglet** d'`InvestmentsTabs`, à côté d'Entreprises et Placements.

### 6.2 Modules activables (**D37**)

> Un module s'affiche s'il **contient quelque chose**, ou s'il a été
> **activé à la main**.

Vaut pour les entrées de barre latérale **et** pour les sous-onglets
d'Investissements. Une SCI qui n'a ni participation ni placement ne voit ni
l'un ni l'autre.

L'activation est **explicite**, via un menu ⋯, et c'est indispensable :
masquer automatiquement un module vide rendrait impossible la création de son
**premier** élément — il serait caché exactement quand on en a besoin.

Chantier **transverse à l'app**, sorti en lot 6.

```
┌────────────────────┬─────────────────────────────────────────────────────┐
│ [SC2] SCI Chapelle2│  Investissements                                    │
│                    │  SCI Chapelle 2                                     │
│  □ À faire         │                                                     │
│  ■ Investissements │  [Immobilier]  [⋯]   Entreprises et Placements sont │
│  □ Trésorerie      │                      masqués : rien dedans          │
│  □ Passif          │                                                     │
│                    │  ┌ BIENS ─────────────────── [+ Nouveau bien] ────┐ │
│  ESPACE DE TRAVAIL │  │ 18 rue de la Chapelle          [Détenu]        │ │
│  □ Réglages        │  │ Immeuble · Paris 18e · locatif nu    860 000 € │ │
│  □ Nouveautés      │  ├────────────────────────────────────────────────┤ │
│                    │  │ 1 bien                              860 000 € │ │
│  [+ Activer un     │  └────────────────────────────────────────────────┘ │
│     module]        │                                                     │
└────────────────────┴─────────────────────────────────────────────────────┘
```

La barre latérale garde ses **quatre entrées** ; le module n'en ajoute aucune.
Le ⋯ à côté des sous-onglets permet de réactiver Entreprises ou Placements
pour y créer un premier élément.

### 6.3 Passif d'une société — page unique (**D32**)

`/app/$orgSlug/passif` — quatre sections, dans cet ordre (**D39**) :

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Passif                                                                  │
│  Ce que SCI Chapelle doit, et à qui                                      │
│                                                                          │
│  ┌ DETTE BANCAIRE ────────────────────────────── [+ Nouveau prêt] ─────┐ │
│  │ Prêt Palatine 2021                          ● En cours    387 980 € │ │
│  │ Banque Palatine · 1,85 % · jusqu'en 06/2041  [Nantissement]         │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │ Total restant dû                                          387 980 € │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ COMPTES COURANTS ──────────────────────────────── [+ Nouveau] ──────┐ │
│  │ CALTE ↗ → SCI Chapelle                                − 1 240 000 € │ │
│  │ Avance de trésorerie · non rémunérée · depuis 03/2021                │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │ Solde net                                             − 1 240 000 € │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ CAPITAL ───────────────────────────────────────── [+ Ligne] ────────┐ │
│  │ Capital social                                            10 000 €  │ │
│  │ CALTE ↗ 60 % · M. Y 40 % · au 12/03/2019                            │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │ Capital social                                            10 000 €  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ GARANTIES DONNÉES ─── actifs en gage pour un tiers ─ [+ Ajouter] ──┐ │
│  │ SCI Chapelle ne met aucun de ses actifs en gage.                     │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Le bloc « Garanties données » est visuellement **détaché** des trois autres
(fond atténué) : ce n'est pas une dette, c'est un engagement hors bilan.

C'est aussi le **seul** endroit où une sûreté donnée à un emprunteur **hors
groupe** peut être créée et corrigée — elle ne pend à aucune fiche de prêt de
chez nous. D'où le « + » et le menu **⋯** par ligne ici, et pas seulement sur
la fiche du prêt. Sous une sûreté à nous s'affichent, en sous-ligne, les
sûretés qu'un **tiers** a données sur la **même** dette hors groupe (§ 10,
cas 10b) : nos 500 K€ ne sont pas seuls dessus. Une sûreté de tiers qui ne
correspond à aucune sûreté de chez nous est listée pour elle-même plutôt que
cachée. Les sûretés portant sur un **prêt du groupe** n'y sont pas reprises :
la fiche du prêt les liste déjà.

**Aucune tuile en tête de page** (**D38**). Un bandeau de chiffres répète ce
qui suit. Et surtout, un « total dû » qui additionnerait le capital serait
**faux** : le capital n'est pas exigible — c'est ce que la société doit à ses
associés en cas de liquidation, pas une échéance. Chaque section porte son
propre total ; **il n'y a pas de total global**.

**Un seul montant par ligne, d'une seule nature** (**D44**). La colonne de
droite ne contient que du restant dû. Le montant gagé n'y figure pas : la
ligne porte un badge « Nantissement », le détail (assiette, garant, montant,
marge) vit sur la fiche du prêt. Empiler 387 980 € et 150 000 € dans la même
colonne invite à les comparer alors qu'ils ne se comparent pas.

### 6.4 Fiche d'un prêt

`/app/$orgSlug/passif/prets/$loanId`

- **En-tête** : statut, et un menu **⋯** portant « Corriger » et « Mettre à
  jour au JJ/MM » (**D40**). Gestes rares, qui touchent aux fondations du
  calcul : les exposer en permanence donnerait envie de les utiliser.
- **Chiffres clés** en ligne (emprunté, restant dû, type d'amortissement, taux
  courant, mensualité, assurance, dernière échéance) — pas de tuiles encadrées.
- **Garanties** : forme, assiette (lien), garant (lien), montant gagé, rang, et
  la marge disponible sur l'assiette. Triées par force décroissante (**D48**).
- **Taux** (prêts variables seulement) : la série `loanRates`, révisions
  passées et paliers projetés, avec un bouton d'ajout. Absent sur un taux fixe.
- **Échéancier** : date, mensualité, capital, intérêts, restant dû, réel.
  Trois états lisibles — à venir (grisée), échue à pointer (ambrée), pointée
  (verte). L'ambre marque une attente, pas une faute : le rouge reste réservé
  à ce qui va mal.
  Sur un **taux variable**, les échéances postérieures à la dernière révision
  `actual` sont marquées **projetées** — l'app ne prétend pas connaître le taux
  de 2029.
  Sur un **in fine**, la dernière ligne porte le ballon de capital, mise en
  évidence.
  Sur un **révolving**, il n'y a pas d'échéancier : un encadré l'explique et
  affiche l'encours et le plafond.
- **Transactions** : le tableau des prélèvements rattachés (date, sens,
  montant, libellé).
- **Documents**.

**On ne rattache pas depuis la fiche** (**D41**). C'est le patron déjà en place
sur une fiche deal (`deals.$dealId.tsx`) : la fiche affiche les transactions
rattachées et permet de les **réaffecter** via un panneau latéral ; le
rattachement initial se fait dans la file de Pointage. Aucun geste nouveau
n'est introduit.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ← Passif    Prêt Palatine 2021                      ● En cours    [ ⋯ ] │
│  Banque Palatine · SCI Chapelle · signé le 14/06/2021                    │
│  ──────────────────────────────────────────────────────────────────────  │
│  EMPRUNTÉ   RESTANT DÛ   TYPE                TAUX        MENSUALITÉ  ASSUR│
│  500 000 €  387 980 €    Annuité constante   1,85 % fixe  2 494 €    42 € │
│  ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  ┌ GARANTIES ──────────────────────────────────── [+ Ajouter] ─────────┐ │
│  │ [Nantissement] [1er rang]                                 150 000 € │ │
│  │ Assiette Concerto Capi n°060 ↗ · garant CALTE ↗ · acte 14/06/2021    │ │
│  │ ┌ Assiette 1 400 000 € · déjà gagée 950 000 € · marge 450 000 €    ┐ │ │
│  │ [Caution]                                              non chiffrée │ │
│  │ Caution personnelle — Clément Alteresco · acte 14/06/2021            │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ ÉCHÉANCIER ────────────────── plan calculé · réel pointé ───────────┐ │
│  │ Échéance    Mensualité  Capital  Intérêts  Restant dû        Réel   │ │
│  │ 05/11/2026    2 494 €   1 902 €    592 €    382 284 €           —   │ │ ← grisée
│  │ 05/10/2026    2 494 €   1 899 €    595 €    384 186 €           —   │ │
│  │ 05/09/2026    2 494 €   1 896 €    598 €    386 084 €           —   │ │
│  │ 05/08/2026    2 494 €   1 893 €    601 €    387 980 €    à pointer  │ │ ← ambrée
│  │ 05/07/2026    2 494 €   1 890 €    604 €    389 873 €   2 536,00 €  │ │ ← verte
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ TRANSACTIONS ──────────── rattachées depuis la file de Pointage ────┐ │
│  │ 05/07/2026  Sortie  2 536,00 €  PRLV PALATINE PRET 8842190          │ │
│  │ 05/06/2026  Sortie  2 536,00 €  PRLV PALATINE PRET 8842190          │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ DOCUMENTS ────────────────────────────────────── [+ Ajouter] ───────┐ │
│  │ Offre de prêt.pdf · Tableau d'amortissement 2026.pdf                 │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Le réel (2 536,00 €) ne vaut pas la mensualité du plan (2 494 €) : il inclut
l'assurance. Les deux colonnes évitent de « corriger » un chiffre juste.

**Variante taux variable / révolving** — la section Taux remplace l'échéancier
quand il n'y en a pas :

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ← Passif    Crédit lombard 2023                     ● En cours    [ ⋯ ] │
│  Neuflize · Banco 2 · adossé au compte-titres n°228                      │
│  ──────────────────────────────────────────────────────────────────────  │
│  ENCOURS      PLAFOND       TYPE        TAUX                             │
│  6 600 000 €  8 000 000 €   Révolving   4,10 % variable                  │
│  ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  ┌ TAUX ───────── révisions passées et paliers projetés ─ [+ Palier] ──┐ │
│  │ À partir du     Taux      Nature                                     │ │
│  │ 01/01/2028      3,80 %    [Projeté]                                  │ │ ← grisée
│  │ 01/01/2027      4,00 %    [Projeté]                                  │ │
│  │ 01/07/2026      4,10 %    ● Constaté                                 │ │
│  │ 01/04/2026      4,35 %    ● Constaté                                 │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ ÉCHÉANCIER ────────────────────────────────────────────────────────┐ │
│  │ Un crédit révolving n'a pas d'échéancier : seuls les intérêts sur    │ │
│  │ l'encours sont projetés. Marge de tirage restante : 1 400 000 €.     │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

### 6.5 Fiche d'un placement — le bloc ajouté

Sur la fiche placement existante, un bloc « Nantissements sur ce contrat » :
valeur actuelle, total gagé, marge disponible, puis une ligne par gage — y
compris ceux qui bénéficient à une autre société du groupe ou à un tiers.

C'est l'écran qui porte la valeur principale du module (U3).

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Concerto Capi n°060                                  [Nanti]     [ ⋯ ]  │
│  Contrat de capitalisation · CALTE · non liquide                         │
│  ──────────────────────────────────────────────────────────────────────  │
│  VALEUR ACTUELLE      TOTAL GAGÉ        MARGE DISPONIBLE                 │
│  1 400 000 €          950 000 €         450 000 €                        │
│  ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  ┌ NANTISSEMENTS SUR CE CONTRAT ───────────────────────────────────────┐ │
│  │ CALTE — Prêt Neuflize                                     300 000 € │ │
│  │ Même espace · acte du 02/2020                                        │ │
│  │ SCI Chapelle — Prêt Palatine 2021 ↗                        150 000 € │ │
│  │ Autre espace du groupe · acte du 06/2021                             │ │
│  │ SARL Bremontier                                           500 000 € │ │
│  │ Emprunteur hors groupe · acte du 11/2022                             │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │ Total gagé                                                950 000 € │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

La troisième ligne est la raison d'être de **D-QA** : sans elle l'app
afficherait 950 000 € de marge au lieu de 450 000 €.

### 6.6 Onglet Immobilier

`/app/$orgSlug/immobilier` — liste (nom, adresse, usage, valeur) puis fiche :

- Chiffres clés : prix de revient, valeur, plus-value latente, rendement net.
- **Prix de revient** : une ligne par poste, **un seul montant**, et une
  colonne **Source** (`Saisi` / `N flux`) qui est l'interrupteur (**D43**).
- **Exploitation** : loyers encaissés, charges payées, résultat net — 12 mois
  glissants, uniquement des flux pointés.
- **Valorisations** : historique daté.
- **Emprunt lié & sûreté**.
- **Documents** (**D33**).

```
┌──────────────────────────────────────────────────────────────────────────┐
│  18 rue de la Chapelle                                [Détenu]    [ ⋯ ]  │
│  Immeuble · Paris 18e · locatif nu · acquis le 09/02/2019                │
│  ──────────────────────────────────────────────────────────────────────  │
│  PRIX DE REVIENT   VALEUR 03/2026   PLUS-VALUE LATENTE   RENDEMENT NET   │
│  742 000 €         860 000 €        + 118 000 €          5,8 %           │
│  ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  ┌ PRIX DE REVIENT ─── un seul montant par poste · une seule source ───┐ │
│  │ Poste                    Montant          Source                     │ │
│  │ Acquisition              658 800,00 €     [Saisi]                    │ │
│  │ Frais d'acquisition       18 300,00 €     [Saisi]                    │ │
│  │ Travaux                   64 900,00 €     ● 4 flux                   │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │ Prix de revient          742 000,00 €                                │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │ Acquis en 2019, avant la connexion bancaire — les deux premiers      │ │
│  │ postes sont saisis. Les travaux de 2024 viennent des virements.      │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ EXPLOITATION ──── 12 mois glissants · uniquement des flux pointés ──┐ │
│  │ Loyers encaissés                                       58 200,00 €  │ │
│  │ Charges payées                                       − 14 900,00 €  │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │ Résultat net                                           43 300,00 €  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ VALORISATIONS ──────────────────────────── [+ Estimation] ──────────┐ │
│  │ Mars 2026      Estimation agence                          860 000 € │ │
│  │ Février 2025   Estimation agence                          815 000 € │ │
│  │ Février 2019   Prix d'acquisition                         610 000 € │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ EMPRUNT LIÉ & SÛRETÉ ───────────────────────────────────────────────┐ │
│  │ Prêt Crédit Mutuel 2019 ↗                                 368 400 € │ │
│  │ Restant dû · jusqu'en 02/2039                                        │ │
│  │ [PPD] privilège de prêteur de deniers · garant SCI Chapelle 2        │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌ DOCUMENTS ────────────────────────────────────── [+ Ajouter] ───────┐ │
│  │ Acte de vente.pdf · Devis travaux toiture.pdf                        │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

La colonne **Source** est l'interrupteur : cliquer dessus bascule le poste
entre `Saisi` et `N flux`. Un seul montant est affiché, jamais deux.

### 6.7 Le geste de pointage

Le sélecteur **existe déjà** dans la file de Pointage, avec ses groupes Deals /
Capitaux propres / Comptes courants (`convex/liabilities.ts:listOptions` +
`src/lib/liabilityOptions.ts`). On lui ajoute **deux groupes** : Prêts, Biens.

Le seul élément réellement nouveau est le choix de la **nature de la dépense**
quand la cible est un bien (§ 4.6).

```
┌──────────────────────────────────────────────────────────────────────────┐
│  VIR SCP NOTAIRES CHAPELLE                              − 658 800,00 €   │
│  09/02/2019 · Compte Crédit Mutuel ····2210                              │
│                                                                          │
│  RATTACHER À                          NATURE DE LA DÉPENSE               │
│  ┌────────────────────────────┐       ┌──────────────────────────────┐   │
│  │ Rechercher…                │       │ [Acquisition] ← sélectionné  │   │
│  │ ── Deals ───────────────── │       │ [Frais d'acquisition]        │   │
│  │   Anaxago — Duhesme        │       │ [Travaux]                    │   │
│  │ ── Prêts ──────── NOUVEAU  │       │ [Charges]                    │   │
│  │   Crédit Mutuel 2019       │       │                              │   │
│  │ ── Biens ──────── NOUVEAU  │       │ Si transaction entrante :    │   │
│  │ ▸ 18 rue de la Chapelle    │       │ [Loyer]  [Revente]           │   │
│  │ ── Capitaux propres ────── │       └──────────────────────────────┘   │
│  │   Capital social           │                                          │
│  │ ── Comptes courants ────── │       Une transaction, un bien, UNE      │
│  │   CALTE → SCI Chapelle     │       seule nature. Ce virement couvre   │
│  └────────────────────────────┘       le prix et les droits : il part    │
│                                       en Acquisition, on ne le découpe   │
│                                       pas.                               │
└──────────────────────────────────────────────────────────────────────────┘
```

Rien n'est proposé, rien n'est pré-sélectionné, rien n'est classé par
vraisemblance : l'app liste, l'utilisateur choisit.

### 6.8 Onglet « À faire » (**D19**)

Aucune alerte, aucune notification. Signaux **dérivés** (jamais stockés), à la
manière de ceux déjà en place :

- Échéance de prêt passée sans transaction pointée.
- Loyer attendu non encaissé sur un bien.
- Bien sans valorisation depuis plus de 18 mois.

---

## 7. Cas limites

| # | Cas | Traitement |
|---|---|---|
| C1 | Un actif garantit plusieurs prêts de plusieurs sociétés | N lignes `guarantees` sur le même `subjectDealId`. L'actif n'est stocké qu'une fois (**D12**, **D3**). |
| C2 | Montant gagé > valeur de l'actif | Affiché tel quel, marge négative signalée. Le gage est un montant d'acte. |
| C3 | Caution sans montant | `pledgedAmountCents` absent. Exclue du total, listée comme « non chiffrée ». |
| C4 | Garantie Saccef | `subjectKind: 'external'`, `pledgorLabel: "Saccef"`. Mentionnée **côté prêt uniquement** (**D21**). |
| C5 | Prêt soldé par anticipation | `status: 'repaid'`, échéancier gelé, garanties à passer en mainlevée. |
| C6 | Mainlevée | `releasedAt` renseigné. La ligne reste (historique), sort du total gagé. |
| C7 | Renégociation de taux | Lot 5. Au lot 1 : « Corriger » écrase et recalcule tout. Limitation assumée. |
| C8 | Pointage incomplet d'un côté d'un C/C | CALTE +500 K€, la SCI 0. Signal de réconciliation. **Le geste est double : une fois dans chaque espace.** |
| C9 | Bien vendu | `status: 'sold'`, prix et date, TRI calculé. Reste listé, grisé. |
| C10 | Marchand de biens | `usage` dédié. Pas de loyer, postes de revient mis en avant. |
| C11 | Suppression d'un prêt portant des garanties | Refusée (`has_guarantees`). Détacher d'abord. |
| C12 | Suppression d'un placement nanti | Refusée (`is_pledged`). Un actif gagé ne disparaît pas en silence. |
| C13 | Bien acquis avant la connexion bancaire | Postes en source `manual`. Le virement de 2019 n'existera jamais dans l'app — une connexion bancaire ne remonte pas si loin. |
| C14 | Flux pointés sur un poste resté en source `manual` | Le montant saisi fait foi ; les flux ne s'y ajoutent **jamais**. L'UI signale qu'ils ne sont pas comptés, pour ne pas masquer de la donnée. |
| C15 | Virement notaire couvrant prix + droits | Rangé entier dans `acquisition`. Pour garder le détail, laisser les deux postes en `manual`. |
| C16 | Prêt in fine | `bullet`. Restant dû = capital jusqu'au terme ; le prévisionnel porte le ballon à sa date. |
| C17 | Crédit lombard / révolving | `revolving`. Pas d'échéancier, pas de durée ; l'encours est saisi, seule ligne saisie du module. Le plafond (`creditLimitCents`) permet d'afficher la marge de tirage. |
| C18 | Différé total | Les intérêts se capitalisent : le capital amorti démarre **au-dessus** du montant emprunté. À ne pas confondre avec le différé partiel. |
| C19 | Taux variable au-delà de la dernière révision connue | Échéances marquées **projetées**. Un palier `forecast` les fait varier ; sans palier, le dernier taux connu est prolongé à plat. |
| C20 | Sûreté de second rang | `rank: 2`. Elle ne vaut que ce qui reste après le premier rang — la marge disponible ne le modélise pas, c'est signalé (§ 5.2). |
| C21 | Caution personnelle du dirigeant | `form: 'caution'`, `pledgorLabel: "Clément Alteresco"` (**D46**). Aucun objet personne créé — cohérent avec D1. |

---

## 8. Décisions prises pendant l'interview

| Réf | Décision | Justification |
|---|---|---|
| **D1** | Patrimoine personnel de Clément hors Albo OS | Adossé à des actifs personnels sans lien avec CALTE. Corollaire : aucune personne physique. |
| **D2** | Aucun droit d'accès différencié | Découle de D1 : plus de donnée sensible à masquer. |
| **D3** | Un actif peut garantir plusieurs dettes | Cas dominant dans le groupe. |
| **D12** | L'actif reste sur sa page d'origine ; la garantie le référence | Une seule valeur, un seul endroit à mettre à jour. |
| **D13** | Garantie inter-espaces = une ligne unique, lue des deux côtés | Patron éprouvé par `intercompanyLoans`. Deux lignes divergeraient. |
| **D14** | Pas de vue consolidée groupe | Cohérence avec ALB-128. Le modèle la rend possible plus tard. |
| **D15** | Les filiales restent des lignes d'investissement dans CALTE + un lien vers leur espace | Ce sont de vrais investissements ; le détail vit dans leur espace. |
| **D16** | L'app calcule l'échéancier | Les conditions sont connues ; le temps réel est le besoin. Risque mitigé par le plan vs réel. |
| **D17** | Trois infos par garantie : forme, assiette, garant | Un champ unique ne sait pas dire « caution de CALTE sur ses titres ». |
| **D18** | La valo des actifs nantis vient de Placements | Le module lit, il n'écrit jamais. Une seule source. |
| **D19** | Pas d'alertes ; les actions vont dans « À faire » | Une alerte sur une valeur annuelle crierait dans le vide. |
| **D20** | Le bien immobilier est un objet à part entière, sans estimation automatique | Nécessaire pour porter une PPD/hypothèque côté actif. |
| **D21** | Saccef : garantie sans actif du groupe, côté prêt uniquement | Elle protège la banque sans rien immobiliser chez nous. |
| **D22** | Documents ajoutés à la main | Une dizaine de prêts : un import coûterait plus cher qu'à saisir. |
| **D24** | Champs du bien réduits ; valorisation historisée | Chaque champ vide est du bruit. Une plus-value sans historique ne veut rien dire. |
| **D25** | Loyers et charges via flux bancaires pointés | Rentabilité réelle, pas théorique. |
| **D27** | Marchand de biens : postes de revient distincts, TRI à la sortie | Le résultat se lit à la revente. |
| **D28** | Onglet Immobilier dans `InvestmentsTabs` | Un bien fausserait le TVPI/MOIC s'il était dans Entreprises. |
| **D29** | Marchand de biens = un usage, pas un objet séparé | 80 % de champs communs ; un bien peut changer d'usage. |
| **D30** | Bascule des avances CALTE → filiales : chantier séparé | Opération sur de la donnée de production. |
| **D31** | Le capital des filiales se saisit, avec le % | C'est du cash sorti, et CALTE n'a pas forcément 100 %. |
| **D32** | Tout sur la page Passif | Même question posée à la société : « qu'est-ce que je dois ? ». |
| **D33** | Le % ne vit qu'à un endroit ; documents rattachables à un bien | Deux saisies divergent. |
| **D34** | L'assistant IA lit **et** écrit | Chaque écriture porte `needsApproval: true` (règle du repo). |
| **D35** | « Corriger » (écrase) / « Mettre à jour au JJ/MM » (version datée) | L'app ne peut pas deviner si c'est une faute de frappe ou un avenant. |
| **D36** | Euros uniquement | Comme le reste de l'app. |
| **D37** | Un module s'affiche s'il contient quelque chose ou s'il est activé ; ⋯ pour activer | Masquer sans activation explicite bloquerait la création du premier élément. |
| **D38** | Pas de tuiles en tête du Passif ; un total par section, pas de total global | Un total qui additionne le capital serait faux. |
| **D39** | Ordre : dette → comptes courants → capital → garanties données | Ordre d'utilité, identique partout. |
| **D40** | Corriger / Mettre à jour dans le menu ⋯ | Gestes rares, cohérence avec l'app. |
| **D41** | On ne rattache pas depuis une fiche | Patron des fiches deal : la fiche affiche et réaffecte, la file de Pointage rattache. |
| **D42** | Le sélecteur de pointage gagne deux groupes + une catégorie ; une transaction n'est jamais éclatée | L'éclater toucherait pointage, soldes et TVA pour un gain marginal. |
| **D43** | Un poste de prix de revient a **une** source : saisi ou flux, jamais l'addition. Choix **par poste** | Un interrupteur global forcerait à sacrifier soit l'acquisition ancienne, soit les travaux récents. |
| **D44** | La liste des prêts ne montre pas le montant gagé, seulement un badge | Deux natures de montant dans une colonne invitent à une comparaison qui n'a pas de sens. |
| **D-QA** | On suit les garanties données à un emprunteur hors groupe | Sans elles, la marge disponible sur l'actif serait surévaluée — une erreur en notre défaveur, invisible. |
| **D45** | Quatre types d'amortissement (annuité, capital constant, in fine, révolving) + différé partiel/total | Un groupe de holdings et de SCI n'emprunte pas qu'en annuité constante. Un in fine de 6,6 M€ lissé sur vingt ans rendrait le ballon invisible dans le prévisionnel. Rétrofitter ce champ obligerait à réécrire le cœur du calcul. |
| **D46** | Caution personnelle = un libellé de garant, aucun objet personne | Cas le plus fréquent sur un prêt de SCI, et cohérent avec D1. |
| **D47** | Taux variable : série datée `loanRates` (`actual` + `forecast`), pas de récupération d'index | Un échéancier à taux variable est une projection ; les paliers la rendent explicite. Un connecteur Euribor serait une source externe inédite dans l'app, pour une poignée de prêts. |
| **D48** | Sûretés triées de la plus forte à la moins forte + champ `rank` | Convention d'affichage pour lire vite. Sans `rank`, un second rang serait indiscernable d'un premier alors qu'il ne vaut que le reliquat. |
| **D49** | Tous les montants d'un bien sont TTC | Ils viennent de flux bancaires, TTC par nature. Reconstituer du HT demanderait de ventiler la TVA poste par poste, sans gain sur un locatif nu. |

---

## 9. Questions restées ouvertes

### Q-B — Montant et assiette exacte des cautions

L'annexe mentionne « caution » pour RDB et SCI Chapelle 2 sans dire qui
cautionne, à quelle hauteur, ni sur quoi. Le modèle sait le porter ; la donnée
manque. À collecter à la saisie.

### Q-C — Fiabilité des données de l'annexe

Le tableau fourni est **un exemple, dont la fiabilité n'est pas garantie**.
Les trois interprétations de la ligne Banco 2 (deux actifs distincts /
montants d'acte vs valeur de marché / nantissement consenti par un tiers) n'ont
pas été tranchées. Le modèle les absorbe toutes les trois sans modification.

### Q-D — Référentiel de prêteurs

`lenderName` est un texte libre. Si on veut un jour « toutes mes dettes chez
Palatine », il faudra un référentiel. Le texte libre suffit au lot 1 et la
migration reste simple.

### Q-F — Récupération automatique d'un index de taux

Le niveau retenu (**D47**) est la saisie manuelle des révisions et des paliers.
Aller chercher l'Euribor automatiquement demanderait une **source de données
externe**, dont l'app n'a aujourd'hui aucun équivalent : un connecteur à
construire, maintenir et sécuriser. À reconsidérer si le nombre de prêts
variables devient significatif.

### Q-E — Import de transactions

Aucun import n'existe : les transactions viennent uniquement de la connexion
bancaire. Importer d'anciens relevés rendrait la source `flows` utilisable sur
des postes historiques (**D43**), mais c'est un chantier distinct, non chiffré
ici.

---

## 10. Test de validation — l'annexe, ligne par ligne

> Exercice imposé par le brief : le modèle doit réinstancier les lignes
> fournies **sans perte d'information et sans champ fourre-tout**. Deux
> catégories d'échec sont distinguées : « hors périmètre par décision » (le
> modèle n'est pas en cause) et « le modèle ne sait pas ».

| # | Ligne source | Verdict | Instanciation |
|---|---|---|---|
| 1 | Clément — 1,5 M€ | ⛔ **Hors périmètre (D1)** | Non modélisé. Décision produit. |
| 2 | Clément — 1,3 M€ | ⛔ **Hors périmètre (D1)** | Idem. |
| 3 | Clément — 316 K€ | ⛔ **Hors périmètre (D1)** | Idem. Le nantissement commun aux 3 prêts sort avec eux. |
| 4 | Banco 2 — 6,6 M€ ; nantissement titres 6,6 M€ + monétaire 3,3 M€ ; compte-titres CALTE n°228, valo 3,7 M€ | ✅ **Rentre** | 1 `loans` (org `banco-2`). 2 `guarantees` : (a) `nantissement`, `subjectKind: placement`, compte-titres n°228, `subjectOrgId: calte`, `pledgorOrgId: calte`, 6 600 000 00 ; (b) idem sur le support monétaire, 3 300 000 00. Emprunteur ≠ garant : natif. Total gagé (9,9 M€) > valo (3,7 M€) : affiché tel quel, marge négative (**C2**). Les trois lectures possibles de la ligne sont représentables sans changer le modèle. |
| 5 | Calte — 395 K€ ; nantissement AV 300 K€ ; Concerto Capi n°060 | ✅ **Rentre** | 1 `loans` (org `calte`) + 1 `guarantees` : `nantissement`, Concerto Capi 060, `pledgorOrgId: calte`, 300 000 00. |
| 6 | RDB — 2,4 M€ ; caution + garantie Saccef | ⚠️ **Rentre, donnée incomplète** | 1 `loans` (org `rdb`). 2 `guarantees` : (a) `caution`, `pledgorOrgId: calte`, `subjectKind: shares`, titres CALTE — **montant non fourni** (**C3**, **Q-B**) ; (b) `garantie_organisme`, `subjectKind: external`, `pledgorLabel: "Saccef"` (**D21**). Le modèle porte tout ; la source est muette. |
| 7 | SCI Chapelle — 500 K€ ; nantissement AV 150 K€ ; Concerto Capi n°060 | ✅ **Rentre** | 1 `loans` (org `sci-chapelle`) + 1 `guarantees` **inter-espaces** : assiette dans `calte`, `pledgorOrgId: calte`, `borrowerOrgId: sci-chapelle`, 150 000 00. Une ligne, lue des deux côtés (**D13**). |
| 8 | SCI Chapelle 2 — 538 K€ ; PPD + caution | ⚠️ **Rentre, donnée incomplète** | 1 `loans` (org `sci-chapelle-2`). 2 `guarantees` : (a) `ppd`, `subjectKind: property`, le bien de la SCI, `pledgorOrgId: sci-chapelle-2` — **suppose le bien saisi** (lot 4) ; (b) `caution`, garant et montant **non fournis** (**Q-B**). |
| 9 | SCI Upload — 1,3 M€ ; nantissement titres 60 K€ ; compte-titres Upload, valo 61 K€ | ✅ **Rentre** | 1 `loans` (org `sci-upload`) + 1 `guarantees` mono-espace, 60 000 00. |
| 10 | SARL Bremontier — 672 K€ / 1 150 K€ ; nantissement AV 500 K€ sur CALTE (Concerto Capi n°060) + 250 K€ sur M. Peninque (AV Vibrato, valo 476 K€) | ✅ **Rentre** (**D-QA**) | Bremontier n'est pas une org, M. Peninque n'existe pas. 2 `guarantees` sans `loanId`, `borrowerLabel: "SARL Bremontier"` : (a) assiette Concerto Capi 060, `pledgorOrgId: calte`, 500 000 00 ; (b) `subjectKind: external`, `subjectLabel: "AV Vibrato — M. Peninque"`, `pledgorLabel: "M. Peninque"`, 250 000 00. Sans D-QA, la marge du Concerto Capi serait fausse de 500 K€. La ligne (b) n'a **aucune** partie du groupe : c'est `orgId` (§ 4.2) qui la classe, dans `calte`, sous la sûreté (a) qu'elle accompagne. |

### Verdict

- **7 lignes sur 10 rentrent** sans perte d'information ni champ fourre-tout
  (dont 2 avec une donnée source manquante, ce qui n'engage pas le modèle).
- **3 lignes ne rentrent pas — toutes par décision produit** (D1), pas par
  défaut du modèle.

**Aucune ligne n'échoue par insuffisance du modèle.** Les deux cas les plus
durs — un actif garantissant trois emprunteurs dans trois espaces différents
(Concerto Capi 060, lignes 5/7/10), et un gage supérieur à la valeur de
l'actif (ligne 4) — sont portés nativement.

---

## 11. Découpage en lots

### Lot 1 — Les prêts *(le plus petit incrément utile)*

Tables `loans` et `loanRates`, **les quatre types d'amortissement**, différé
partiel/total, échéancier calculé, capital restant dû, fiche prêt, bloc
« Dette bancaire » sur la page Passif. Le geste « Corriger » uniquement.

**Et les documents attachés au prêt — dans ce lot, pas plus tard.** Attacher un
acte de prêt exige de relâcher `documents.companyId` (§ 4.8). L'ordre est
imposé et non négociable :

1. **Auditer** toutes les lectures de `doc.companyId` — 15 fichiers `convex/`
   et 5 fichiers `src/` y touchent — et les rendre tolérantes à l'absence.
2. **Relâcher** le schéma (`companyId` optionnel) et ajouter `loanId`.
3. **Tester** : un document sans société ne casse ni les fiches société, ni
   les filtres, ni la vectorisation par org.

Ces trois étapes partent **dans la même PR que la table `loans`** : séparées,
elles prendraient le risque du schéma sans rien pour l'exercer. C'est aussi ce
qui évite deux allers-retours au lieu d'un.

**Ce que ça apporte** : ouvrir un espace et savoir combien la société doit, à
qui, à quel taux, jusqu'à quand. L'app l'ignore complètement aujourd'hui.

**Critère de succès** : les prêts de l'annexe (hors Clément) sont saisis —
**y compris un in fine et un révolving** — et le capital restant dû correspond
au tableau de la banque à moins d'un euro près.

### Lot 2 — Les garanties

Table `guarantees`, les trois lectures, le bloc « Nantissements sur ce
contrat » sur la fiche placement, le calcul de marge disponible.

**Critère de succès** : le Concerto Capi n°060 affiche ses 3 gages et sa marge
depuis `calte`, alors que 2 des 3 bénéficiaires vivent ailleurs.

### Lot 3 — Le branchement

`allocation.kind: 'loan'`, échéances dans le prévisionnel
(`derivedKey "loan:…"`), signaux dans « À faire », outils de lecture pour
l'assistant IA.

**Critère de succès** : un prélèvement pointé fait bouger la colonne Réel de
l'échéancier, et les 6 prochaines échéances apparaissent dans le prévisionnel.

### Lot 4 — L'immobilier

Tables `properties` et `propertyValuations`, onglet Immobilier,
`allocation.kind: 'property'` + `category`, prix de revient à source par poste,
rentabilité, mode marchand de biens, et `documents.propertyId` (le relâchement
de `companyId` et son audit ont eu lieu au lot 1 — il ne reste ici que le champ
à ajouter).

**Critère de succès** : un bien saisi affiche son prix de revient poste par
poste avec la source de chacun, sa courbe de valeur, son rendement net réel, et
la PPD de SCI Chapelle 2 se lit des deux côtés.

### Lot 5 — Capital, détention et avenants

`equityPositions.ownershipBps`, structure capitalistique sur la page Passif,
lecture du % par le deal equity côté CALTE. Geste « Mettre à jour au JJ/MM » et
échéancier multi-périodes.

### Lot 6 — Modules activables *(transverse, hors module)*

Affichage conditionnel des entrées de barre latérale **et** des sous-onglets
d'Investissements, avec activation par le menu ⋯ (**D37**).

### Lot 7 — Écriture par l'assistant IA

Outils d'écriture sur prêts, garanties et biens, tous avec
`needsApproval: true` (**D34**). Côté serveur MCP : `write: true` sur
`defineTool`.

### Hors lots — chantiers dépendants

- **Bascule des 7,8 M€ d'avances** CALTE → filiales en comptes courants
  (**D30**).
- **Import de transactions** (**Q-E**), qui rendrait la source `flows`
  utilisable sur des postes historiques.
- **Vue consolidée groupe** (**D14**), si le besoin se confirme.

---

## 12. Points de vigilance pour l'implémentation

1. **Le pointage reste humain.** Aucune suggestion, aucun classement, aucune
   pré-sélection — règle du repo, non négociable.
2. **Rien n'est stocké deux fois.** Ni la valeur d'un actif, ni un % de
   détention, ni un solde, ni un montant de dépense. Chaque fois qu'on est
   tenté de dénormaliser, c'est qu'on s'apprête à créer deux vérités.
3. **Un poste, une source.** L'addition d'un montant saisi et de flux pointés
   est un bug, jamais une fonctionnalité (**D43**, **C14**).
4. **`requireOrgMember` sur toute fonction.** Pour les objets inter-orgs,
   `requireGuaranteeParty` sur le modèle de `requireLoanParty`. Jamais
   d'héritage de droits — les orgs restent à plat.
5. **Aucun chiffre stocké qui puisse être dérivé.** Capital restant dû, marge
   disponible, rendement, résultat d'exploitation : calculés à la lecture.
   **Deux** exceptions assumées, et deux seulement :
   - l'**encours d'un révolving**, qui n'est déductible d'aucun échéancier
     (§ 4.1) ;
   - le **capital re-notifié par la banque à la date d'un avenant**
     (`loanAmendments.outstandingCents`, lot 5). Quand le prêteur redresse le
     capital restant — arrondi de son côté, remboursement partiel jamais
     pointé chez nous — son chiffre est un **constat**, et l'app n'a aucun
     moyen de le dériver. Le champ est optionnel : absent, c'est le montant
     atteint par le plan précédent qui fait foi, ce qui reste le cas normal.

   Le critère qui autorise ces deux-là, et qui doit être opposé à toute
   demande d'une troisième : le chiffre est un **fait extérieur constaté**,
   pas un calcul qu'on préférerait figer. « Ce serait plus simple de le
   stocker » n'a jamais rempli ce critère.
6. **`lib/amortization.ts` est une fonction pure et le restera.** Elle prend
   les paramètres du prêt et la série de taux, elle rend un échéancier. Aucun
   accès Convex, testable en `node:test` — c'est ce qui rend les quatre types
   vérifiables un par un.
7. **`documents.companyId` → optionnel** est le seul changement de contrainte
   sur une table existante. À auditer sérieusement (lot 4).
8. **Un seul XIRR dans le repo.** Le TRI d'un bien revendu réutilise
   l'implémentation des deals.
9. **Attention à la lecture en liste.** Ne jamais `.collect()` une table dont
   une ligne porte un champ texte volumineux pour n'en tirer que des champs
   légers — Convex lit et facture la ligne entière.
10. **i18n.** Toute chaîne visible passe par `t()` avec une entrée `en` **et**
   `fr`. Nouveaux namespaces à prévoir : `immobilier`, et des ajouts dans
   `passif`, `pointage`, `nav`.
11. **Saisie d'un montant en euros** → `AmountInput` / `useAmountField`, jamais
    un `<input type="number">` brut.
