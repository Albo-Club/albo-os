# SPEC — Dette, Garanties & Immobilier

> Cahier des charges issu de l'interview du 29/08/2026. Aucun code n'a été
> écrit pour produire ce document. Les décisions notées `D<n>` ont été prises
> et validées explicitement pendant l'interview ; les points listés en
> § « Questions restées ouvertes » ne l'ont pas été.

---

## 1. Problème et valeur

Albo OS sait aujourd'hui répondre à « qu'est-ce que je possède ? » (deals,
placements, trésorerie). Il ne sait pas répondre à **« qu'est-ce que je
dois, à qui, et qu'est-ce que j'ai mis en gage pour l'obtenir ? »**.

Concrètement, quatre questions n'ont aujourd'hui aucune réponse dans l'app :

1. **Combien chaque société du groupe doit-elle encore ?** Le capital restant
   dû de chaque prêt bancaire n'existe nulle part. Il vit dans des tableaux
   d'amortissement PDF et dans la tête de Benjamin et Clément.
2. **Qu'est-ce qui est gagé, et à quelle hauteur ?** Un même contrat de
   capitalisation peut garantir trois prêts de trois sociétés différentes.
   Personne ne sait, sans ressortir les actes, combien il reste de marge
   disponible sur un actif.
3. **Quels biens immobiliers détient le groupe, et rapportent-ils ?** Les SCI
   possèdent des biens dont ni la valeur, ni les loyers, ni les charges ne
   sont suivis dans l'app.
4. **Quelle est la structure capitalistique des filiales ?** Depuis ALB-128,
   chaque société a son espace, mais le capital et les % de détention ne sont
   saisis nulle part.

La valeur n'est pas dans le calcul — c'est de la finance simple. Elle est
dans le fait que **ces informations soient au même endroit que les flux
bancaires**, donc vivantes plutôt que figées dans un Excel qui vieillit.

---

## 2. Utilisateurs et cas d'usage

Deux utilisateurs : Benjamin et Clément. Outil interne, pas de SaaS. Aucun
droit d'accès différencié (**D2**).

| # | Cas d'usage | Écran |
|---|---|---|
| U1 | « Combien SCI Chapelle doit-elle encore à sa banque ? » | Passif de `sci-chapelle` |
| U2 | « Quelles sont les échéances de ce prêt et où en est-on ? » | Fiche prêt |
| U3 | « Ce contrat de capitalisation, il garantit quoi au total ? Il me reste de la marge ? » | Fiche placement, côté `calte` |
| U4 | « Ce prêt est garanti par quoi ? » | Fiche prêt |
| U5 | « Quels biens possède cette SCI, combien valent-ils, combien rapportent-ils ? » | Onglet Immobilier |
| U6 | « Qui détient le capital de cette filiale ? » | Passif de la filiale |
| U7 | « J'ai reçu un relevé, je pointe le prélèvement du prêt » | Pointage |
| U8 | « Quelles sont mes sorties de trésorerie des 6 prochains mois ? » | Prévisionnel |
| U9 | « L'assistant IA : combien RDB doit encore ? » | Panneau IA |

---

## 3. Périmètre

### IN

- Les **prêts bancaires** contractés par les sociétés du groupe.
- Les **garanties** qui les couvrent : nantissement, hypothèque, PPD,
  caution, garantie d'organisme.
- Les **biens immobiliers** détenus par les sociétés du groupe, y compris en
  mode marchand de biens.
- Le **capital et les % de détention** des sociétés du groupe.
- Le branchement sur l'existant : pointage bancaire, prévisionnel de
  trésorerie, onglet « À faire », documents, assistant IA.

### OUT — explicitement

- **Le patrimoine personnel de Clément** (**D1**). Ses prêts personnels et
  l'assurance-vie qui les garantit n'entrent pas dans Albo OS. Corollaire :
  aucune notion de « personne physique » n'est créée. Les champs
  `holderPersonId` / `fromPersonId` déjà présents au schéma restent morts.
- **Les droits d'accès différenciés** (**D2**) — découle de D1 : il n'y a
  plus de donnée sensible à masquer.
- **Une vue consolidée « dette du groupe »** (**D14**). Une page par société.
  Cohérent avec la décision ALB-128 (« pas de vue consolidée groupe hors
  `/app/all` »). Le modèle est conçu pour la rendre possible plus tard, elle
  n'est pas construite.
- **La bascule des 7,8 M€ d'avances CALTE → filiales** (**D30**). Elles
  restent des deals `cca` dans `calte`. C'est une opération de données à
  part, dans un chantier dédié.
- **Le calcul automatique du tableau d'amortissement sur plusieurs
  périodes** (avenant, renégociation) — reporté au lot 5 (**D35**).
- **La gestion locative** au sens métier : quittances, appels de loyer,
  relances locataires, indexation IRL, états des lieux. Le module suit un
  bien comme un actif, pas comme un contrat de bail.
- **La copropriété** (AG, appels de fonds, tantièmes).
- **Les devises autres que l'euro** (**D36**).
- **L'historique des modifications au sens audit** (« qui a changé quoi »)
  (**D35**). Ce qui est historisé l'est par nature métier (valorisations
  datées, flux bancaires), pas par traçabilité.
- **Le chantier « onglets activables »** (**D28**) : il est nécessaire au
  confort d'usage avec 9 espaces, mais il est transverse à toute l'app. Il
  est décrit ici (§ 6.5) et sorti en lot 6.

---

## 4. Modèle de données

Conventions Albo OS respectées partout : montants **entiers en cents EUR**,
taux en **basis points**, dates en **ms epoch UTC**, `orgId` sur toute table,
`requireOrgMember` sur toute fonction, unicité enforced en mutation.

### 4.1 `loans` — un prêt contracté par une société

```
loans
  orgId              Id<'organizations'>   société emprunteuse
  label              string                "Prêt Palatine — acquisition 2021"
  lenderName         string                "Banque Palatine" (texte libre, pas d'objet banque)
  principalCents     number                montant emprunté, cents
  signedDate         number                ms epoch
  firstPaymentDate   number                ms epoch
  durationMonths     number
  rateBps            number                taux nominal, bps (1100 = 11 %)
  rateKind           'fixed' | 'variable'
  insuranceMonthlyCents  number?           assurance emprunteur, cents/mois
  paymentFrequency   'monthly' | 'quarterly'
  deferralMonths     number?               différé d'amortissement
  bankAccountId      Id<'bankAccounts'>?   compte de prélèvement (même org)
  status             'active' | 'repaid' | 'cancelled'
  notes              string?
  searchText         string                (convention lib/searchText.ts)

  .index('by_org', ['orgId'])
  .index('by_org_status', ['orgId', 'status'])
  .index('by_bank_account', ['bankAccountId'])
```

**Pas de champ « capital restant dû ».** Il est **dérivé** à la lecture, par
la même philosophie que les soldes de comptes courants (cf. `KNOWN_ISSUES.md`
§ Passif) : un chiffre stocké se désynchronise, un chiffre dérivé ne peut pas.

**Pas de table d'échéancier.** L'échéancier est calculé par une fonction pure
(`convex/lib/amortization.ts`, testable hors Convex comme `lib/recurrence.ts`
et `lib/liabilities.ts`). Ce qui est stocké, ce sont les **occurrences
prévisionnelles**, dans `forecastEntries` (§ 4.7).

### 4.2 `guarantees` — le lien prêt ↔ sûreté

C'est la table centrale du module. Elle porte **trois informations
indépendantes** (proposition validée en **D17**) :

| Information | Champ | Exemple |
|---|---|---|
| **La forme** de la sûreté | `form` | nantissement, hypothèque, PPD, caution, garantie d'organisme |
| **L'assiette** — sur quoi ça porte | `subject*` | le contrat Concerto Capi, le bien de la SCI, les titres de CALTE, rien de chez nous |
| **Le garant** — qui s'engage | `pledgorOrgId` / `pledgorLabel` | CALTE, la SCI elle-même, Saccef |

```
guarantees
  // ── Bénéficiaire : le prêt garanti ──────────────────────────────────
  loanId             Id<'loans'>?          prêt interne au groupe
  borrowerOrgId      Id<'organizations'>?  org du prêt (dénormalisé pour l'index)
  borrowerLabel      string?               emprunteur HORS groupe (cf. § 9, Q6)
  // Exactement l'un des deux : (loanId + borrowerOrgId) OU borrowerLabel.

  // ── Le garant ───────────────────────────────────────────────────────
  pledgorOrgId       Id<'organizations'>?  société du groupe qui s'engage
  pledgorLabel       string?               garant externe ("Saccef", "M. X")

  // ── L'assiette ──────────────────────────────────────────────────────
  subjectKind        'placement' | 'property' | 'shares' | 'external'
  subjectDealId      Id<'deals'>?          si 'placement' (le placement existant)
  subjectPropertyId  Id<'properties'>?     si 'property'
  subjectCompanyId   Id<'companies'>?      si 'shares' (titres d'une société)
  subjectOrgId       Id<'organizations'>?  org où vit l'assiette (≠ borrowerOrgId possible)
  subjectLabel       string?               si 'external' ("AV Vibrato de M. X")

  // ── Le gage ─────────────────────────────────────────────────────────
  form               'nantissement' | 'hypotheque' | 'ppd' | 'caution'
                     | 'garantie_organisme'
  pledgedAmountCents number?               montant gagé (absent si non chiffré :
                                           une caution peut être illimitée)
  actDate            number?               ms epoch, date de l'acte
  releasedAt         number?               ms epoch, mainlevée. Absent = active.
  notes              string?

  .index('by_loan',        ['loanId'])
  .index('by_borrower_org',['borrowerOrgId'])
  .index('by_pledgor_org', ['pledgorOrgId'])
  .index('by_subject_deal',    ['subjectDealId'])
  .index('by_subject_property',['subjectPropertyId'])
  .index('by_subject_company', ['subjectCompanyId'])
```

**Une seule ligne, trois lectures** (**D13**) — rien n'est stocké deux fois :

- **Côté prêt** (`by_loan`) : « garanti par une caution de CALTE — 2,4 M€ ».
- **Côté assiette** (`by_subject_deal` / `by_subject_property`) : « ce contrat
  est gagé au profit de SCI Chapelle — 150 K€ ».
- **Côté garant** (`by_pledgor_org`) : « je me suis porté caution pour RDB ».

C'est le patron déjà éprouvé par `intercompanyLoans` : une ligne partagée,
lisible des deux côtés, jamais dupliquée.

**Autorisation.** Une garantie peut traverser deux orgs (le prêt dans
`sci-chapelle`, l'assiette dans `calte`). Le garde-fou est un helper
`requireGuaranteeParty(ctx, guarantee)` — miroir exact de `requireLoanParty`
dans `convex/liabilities.ts` : **membre d'au moins une des orgs parties**
(`borrowerOrgId`, `pledgorOrgId`, `subjectOrgId`). Les orgs restent à plat,
aucun héritage de droits n'est introduit.

**Suppression.** Refusée tant que la garantie porte des documents attachés
(`has_documents`), sur le modèle du `has_allocations` existant : on détache
d'abord, on supprime ensuite. Jamais de détachement implicite.

### 4.3 `properties` — un bien immobilier

```
properties
  orgId              Id<'organizations'>   société détentrice (D20)
  name               string                "24 rue Mouffetard, 3e étage"
  address            string
  propertyType       'appartement' | 'maison' | 'immeuble'
                     | 'local_commercial' | 'terrain'
  usage              'locatif_nu' | 'locatif_meuble' | 'colocation'
                     | 'saisonnier' | 'commercial'
                     | 'marchand_de_biens' | 'residence_secondaire'
  surfaceSqm         number?

  // ── Prix de revient (D27) — un poste par nature, jamais un fourre-tout
  purchasePriceCents         number       prix d'achat hors frais
  purchaseDate               number       ms epoch
  notaryFeesCents            number?
  agencyFeesCents            number?
  worksCents                 number?
  otherAcquisitionCostsCents number?

  // ── Exploitation (paramètres ; le réel vient des transactions, D25)
  monthlyRentCents    number?
  monthlyChargesCents number?

  // ── Sortie
  status             'held' | 'sold'
  saleDate           number?
  salePriceCents     number?

  notes              string?
  searchText         string

  .index('by_org', ['orgId'])
  .index('by_org_status', ['orgId', 'status'])
```

**Pas de `detention`** : le bien vit dans l'org de la société qui le détient,
la détention est portée par l'org. Un champ de plus serait une seconde vérité.

**Pas de DPE, année de construction, pièces, frais d'ameublement** : écartés
en **D24** comme relevant de la gestion locative, pas du pilotage patrimonial.

**Le marchand de biens est un `usage`, pas un objet séparé** (**D29**) : un
bien de marchand partage 80 % de ses champs avec un bien locatif, et un bien
peut changer d'usage. Quand `usage === 'marchand_de_biens'`, l'UI masque les
champs d'exploitation et met en avant le prix de revient et le TRI de sortie.

### 4.4 `propertyValuations` — la valeur du bien dans le temps

```
propertyValuations
  orgId       Id<'organizations'>
  propertyId  Id<'properties'>
  asOf        number     ms epoch
  valueCents  number
  source      string?    "estimation agence", "notaire", "à dire d'expert"
  notes       string?

  .index('by_property_asof', ['propertyId', 'asOf'])
  .index('by_org_asof', ['orgId', 'asOf'])
```

Table distincte de `valuations` (qui exige un `dealId`) — mêmes conventions,
même forme, même lecture « dernière valeur connue ». Le prix d'achat forme
la première ligne implicite de la courbe (**D24**).

Aucune estimation automatique : pas de PriceHubble, pas d'API tierce (**D20**).

### 4.5 `equityPositions` — deux champs à ajouter

La table existe. Deux ajouts, tous deux optionnels donc non cassants :

```
  ownershipBps  number?               % de détention en bps (6000 = 60 %)
  holderOrgId   (déjà présent)        la société du groupe qui détient
```

**Le % ne vit qu'à un endroit** (**D33**) : la structure capitalistique de la
société émettrice fait foi. Côté CALTE, le deal equity **lit** ce % au lieu de
le re-saisir — l'index `by_holder_org` existe déjà et rend ce chemin naturel.
Deux saisies finiraient par diverger.

Lecture symétrique (**D33**) :
- Côté **CALTE** : un deal equity sur la SCI (montant investi) → apparaît dans
  les investissements.
- Côté **SCI** : la structure capitalistique au passif (CALTE 60 %, autre
  associé 40 %).

### 4.6 `transactions.allocation` — deux valeurs d'enum

L'allocation généralisée existe déjà (`{ kind, targetId: string }`). Deux
valeurs à ajouter à `allocationKind` :

```
  'loan'      → targetId = Id<'loans'>       remboursement d'échéance
  'property'  → targetId = Id<'properties'>  loyer encaissé, charge payée
```

Rien d'autre à construire : l'index `by_org_allocation_target` sert déjà ce
pattern pour les deals, l'equity et les comptes courants.

> ⚠️ **Le pointage reste 100 % humain.** Aucune suggestion, aucune
> pré-sélection, aucun classement de candidats — la règle du repo (cf.
> `CLAUDE.md`, anti-pattern « suggestion de rapprochement », supprimée en
> août 2026). L'utilisateur choisit la transaction ; **la conséquence** (mise
> à jour du capital restant dû, du réel encaissé sur un bien) est
> automatique. L'automatisme est dans le calcul, jamais dans le
> rapprochement.

### 4.7 `forecastRules` / `forecastEntries` — réemploi, pas d'extension

Les échéances de prêt sont générées comme des occurrences prévisionnelles
existantes, avec une clé d'idempotence sur le patron déjà en place :

```
  derivedKey = "loan:{loanId}:{YYYY-MM-DD}"
```

Un champ `loanId: Id<'loans'>?` est ajouté à `forecastEntries`, symétrique du
`dealId` déjà présent, pour que la fiche prêt puisse afficher ses propres
échéances. Le flag `overridden` protège une occurrence éditée à la main,
exactement comme pour les règles.

### 4.8 `documents` — un point d'attention non trivial

Aujourd'hui `documents.companyId` est **requis** (`v.id('companies')`). Or un
acte de prêt ou un compromis n'a pas de société-cible au sens portfolio.

Trois champs à ajouter, et **une contrainte à relâcher** :

```
  companyId   Id<'companies'>?    ← devient OPTIONNEL (changement non trivial)
  loanId      Id<'loans'>?
  propertyId  Id<'properties'>?
  guaranteeId Id<'guarantees'>?

  .index('by_loan', ['loanId'])
  .index('by_property', ['propertyId'])
  .index('by_guarantee', ['guaranteeId'])
```

**Pourquoi c'est un point d'attention** : relâcher un champ requis est le sens
« facile » d'un changement de schéma Convex (élargir passe, resserrer non),
mais **tout le code qui lit `doc.companyId` en le supposant présent doit être
audité**. À traiter en début de lot 4, pas en passant.

Deux valeurs à ajouter à l'enum `documents.kind` : `acte_pret`,
`acte_garantie`. Ça couvre le besoin **D22** (contrats, tableaux
d'amortissement, actes notariés) et **D33** (toute la doc d'un bien
accessible depuis sa ligne).

### 4.9 Vue d'ensemble des relations

```
                    ┌──────────────┐
   org emprunteuse  │    loans     │
   (ex. sci-chapelle)└──────┬──────┘
                            │ by_loan
                    ┌───────▼───────┐
                    │  guarantees   │──── pledgorOrgId ──► org garante (ex. calte)
                    └───┬───┬───┬───┘
        subjectKind ────┘   │   └──── 'external' (Saccef, actif d'un tiers)
             │              │
     'placement'      'property' / 'shares'
             │              │
     ┌───────▼──────┐  ┌────▼───────┐
     │ deals        │  │ properties │◄── propertyValuations (historique)
     │ (placement,  │  │            │
     │  org calte)  │  └────────────┘
     └──────────────┘

   transactions.allocation ──► 'loan' | 'property' | 'deal' | 'equity'
                                    | 'intercompany_loan' | 'transfer'
```

---

## 5. Règles de calcul

### 5.1 Échéancier et capital restant dû

**Le plan** — annuité constante, formule classique, calculée par une fonction
pure :

```
mensualité = P × (i / (1 − (1 + i)^(−n)))   où i = rateBps / 10000 / 12
                                                  n = durationMonths
```

Chaque échéance se décompose en intérêts (`capital restant × i`), capital
(`mensualité − intérêts`) et assurance (`insuranceMonthlyCents`, hors
mensualité). Un différé (`deferralMonths`) produit des échéances d'intérêts
seuls avant le début de l'amortissement.

**Le réel** — la somme des transactions pointées avec
`allocation.kind === 'loan'` et `targetId === loanId`.

**Capital restant dû affiché** = celui du plan à la date du jour. Le réel
sert de **contrôle**, pas de source : si le cumulé réel diverge du plan, c'est
un signal de pointage incomplet ou d'un événement non saisi (remboursement
anticipé), pas un bug. Même philosophie que les soldes de comptes courants
divergents.

> Ce « plan vs réel » est exactement le patron des royalties
> (`dealProjections` : BP signé vs réalité issue des transactions pointées).
> Ne pas en inventer un second.

### 5.2 Marge disponible sur un actif gagé

Sur la fiche d'un placement ou d'un bien :

```
valeur actuelle            = dernière valorisation connue
total gagé                 = Σ pledgedAmountCents des garanties actives
                             (releasedAt absent) pointant sur cet actif
marge disponible           = valeur actuelle − total gagé
```

**Trois précautions.**

1. **Les garanties non chiffrées sont exclues du total et signalées.** Une
   caution illimitée ne s'additionne pas ; l'afficher comme 0 mentirait.
2. **Le montant gagé n'est pas la valeur de l'actif.** C'est le montant
   inscrit à l'acte. Il peut dépasser la valeur de marché — c'est
   précisément l'information utile.
3. **Cette lecture traverse les orgs** (les garanties viennent de
   `sci-chapelle`, l'actif est dans `calte`). Ce n'est pas une vue consolidée
   au sens de D14 : c'est la lecture d'un lien déjà accepté en D13.

### 5.3 Rentabilité d'un bien

```
prix de revient   = purchasePrice + notaryFees + agencyFees + works
                    + otherAcquisitionCosts
revenus réels     = Σ transactions 'in'  allouées au bien
charges réelles   = Σ transactions 'out' allouées au bien
                    (hors échéances de prêt, allouées au prêt)
plus-value latente = dernière valorisation − prix de revient
rendement brut     = (loyer mensuel × 12) / prix de revient
rendement net      = (revenus réels − charges réelles) sur 12 mois glissants
                     / prix de revient
```

Pour un bien `marchand_de_biens` vendu : **TRI (XIRR)** sur les flux datés
réels (sorties d'acquisition et de travaux, entrée de revente), avec la même
implémentation que le TRI des deals — une seule fonction XIRR dans le repo.

### 5.4 Arrondis

Application stricte de la règle maison « l'actuel au centime, l'estimé
arrondi » :

| Au **centime** (`fmtEurCents`) | À l'**euro** (`fmtEur`) |
|---|---|
| Échéances réelles pointées | Capital restant dû (calculé) |
| Loyers et charges encaissés | Mensualité théorique |
| Prix d'achat, frais, prix de revient | Valorisation d'un bien |
| Montant gagé (il est à l'acte) | Marge disponible |
| Solde de compte courant | Plus-value latente, rendements, TRI |

Le capital restant dû est **estimé** (il sort d'un calcul, pas d'un
mouvement) : arrondi à l'euro.

---

## 6. Vues UI

### 6.1 Passif d'une société — page unique (**D32**)

`/app/$orgSlug/passif`

```
┌──────────────────────────────────────────────────────────────────────┐
│  Passif — SCI Chapelle                                               │
│                                                                      │
│  ┌ Dette bancaire ─────────────────────────────── + Nouveau prêt ─┐  │
│  │ Prêt Palatine 2021    500 000 €   RD 412 300 €  1,85 %  2036   │  │
│  │   └ garanti par : Nantissement — Concerto Capi 060 (CALTE) ↗   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌ Garanties données ─────────────────────────────────────────────┐  │
│  │ (ce que CETTE société met en gage pour d'autres — vide ici)    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌ Capital ──────────────────────────────────── + Nouvelle ligne ─┐  │
│  │ Capital social  10 000 €    CALTE 60 % ↗  ·  M. Y 40 %         │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌ Comptes courants ──────────────────────────────────────────────┐  │
│  │ CALTE → SCI Chapelle       − 1 240 000 €  (dette)         ↗    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

Les ↗ sont des liens qui traversent les espaces (**D13**, **D15**).

### 6.2 Fiche d'un prêt

`/app/$orgSlug/passif/prets/$loanId`

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Passif      Prêt Palatine 2021               [Corriger] [Màj au…] │
│  Banque Palatine · SCI Chapelle                          ● En cours  │
│                                                                      │
│  Emprunté        Restant dû      Taux        Fin        Mensualité   │
│  500 000 €       412 300 €       1,85 %      03/2036    2 640 €      │
│                                                                      │
│  ┌ Garanties ──────────────────────────────── + Ajouter ──────────┐  │
│  │ Nantissement · 150 000 €                                       │  │
│  │   Assiette : Concerto Capi n°060 ↗   Garant : CALTE ↗           │  │
│  │   Valeur de l'assiette : 1 400 000 €  ·  déjà gagée : 950 000 € │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌ Échéancier ────────────────────── ○ Plan  ● Plan vs réel ──────┐  │
│  │ Date      Mensualité   Capital   Intérêts   Assur.   Restant   │  │
│  │ 05/09/26   2 640 €     2 004 €     636 €     42 €    410 296 € │  │
│  │ 05/08/26   2 640 €     2 001 €     639 €     42 €    412 300 € ✓│  │
│  │            (✓ = pointé sur une vraie transaction)               │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌ Documents ──────────────────────────────── + Ajouter ──────────┐  │
│  │ 📄 Offre de prêt.pdf   ·   📄 Tableau d'amortissement.pdf      │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

Les deux boutons d'en-tête matérialisent **D35** : « Corriger » écrase
(c'était une faute de saisie), « Mettre à jour au JJ/MM » crée une version
datée (la réalité a changé). L'app ne devine jamais lequel s'applique.

### 6.3 Fiche d'un placement — le bloc ajouté

Sur la fiche placement existante (`calte`), un bloc en plus :

```
┌ Nantissements sur ce contrat ──────────────────────────────────────┐
│  Valeur actuelle 1 400 000 €  ·  Gagé 950 000 €  ·  Marge 450 000 €│
│                                                                    │
│  CALTE — Prêt Neuflize ↗                              300 000 €    │
│  SCI Chapelle — Prêt Palatine 2021 ↗                  150 000 €    │
│  SARL Bremontier (hors groupe)                        500 000 €    │
└────────────────────────────────────────────────────────────────────┘
```

C'est l'écran qui porte la valeur principale du module (U3).

### 6.4 Onglet Immobilier

`/app/$orgSlug/immobilier` — troisième sous-onglet de la section
Investissements, à côté d'Entreprises et Placements (**D28**).

Liste : nom, adresse, usage, prix de revient, valeur, plus-value, rendement.
Fiche : Description / Acquisition / Exploitation / Valorisations (courbe) /
Emprunts liés / Garanties / Documents.

### 6.5 Onglets activables (**D28**, lot 6, transverse)

Avec 9 espaces, une SCI qui possède un immeuble affiche aujourd'hui 8 onglets
dont 6 vides.

**Le principe** : un espace n'affiche que les modules qu'il utilise. On active
un module depuis un menu « + » de la barre latérale, ce qui fait apparaître
son onglet.

**Pourquoi l'activation est explicite et non déduite du contenu** : masquer
automatiquement un onglet vide rendrait impossible la création du **premier**
élément — l'onglet serait caché précisément quand on en a besoin. L'activation
explicite évite ce blocage.

Ce n'est **pas** déduit du type de société : une SCI peut avoir un
prévisionnel, CALTE peut n'avoir aucun immobilier en direct. C'est un choix
par espace, module par module.

### 6.6 Onglet « À faire » (**D19**)

Aucune alerte, aucune notification. Ce qui demande une action remonte dans
l'onglet existant, en signaux **dérivés** (jamais stockés), à la manière des
signaux déjà en place :

- Échéance de prêt passée sans transaction pointée.
- Loyer attendu non encaissé sur un bien.
- Bien sans valorisation depuis plus de 18 mois.

---

## 7. Cas limites

| # | Cas | Traitement |
|---|---|---|
| C1 | Un actif garantit plusieurs prêts de plusieurs sociétés | N lignes `guarantees` pointant le même `subjectDealId`. L'actif n'est stocké qu'une fois (**D12**, **D3**). |
| C2 | Le montant gagé dépasse la valeur de l'actif | Affiché tel quel, marge négative signalée. Le gage est un montant d'acte, pas une valeur de marché. |
| C3 | Caution sans montant | `pledgedAmountCents` absent. Exclue du total gagé, listée à part comme « non chiffrée ». |
| C4 | Garantie Saccef | `subjectKind: 'external'`, `pledgorLabel: "Saccef"`, aucun actif du groupe. Mentionnée **côté prêt uniquement** (**D21**). |
| C5 | Prêt soldé par anticipation | `status: 'repaid'`, échéancier gelé, garanties à passer en mainlevée (`releasedAt`). |
| C6 | Mainlevée d'une garantie | `releasedAt` renseigné. La ligne reste (historique), sort du total gagé. |
| C7 | Renégociation de taux | Lot 5. Au lot 1 : « Corriger » écrase les paramètres et recalcule tout l'échéancier. Limitation assumée et documentée. |
| C8 | Pointage incomplet d'un côté d'un compte courant | CALTE affiche +500 K€, la SCI 0. Signal de réconciliation, pas un bug. **Le geste de pointage est double : une fois dans chaque espace.** |
| C9 | Bien vendu | `status: 'sold'`, prix et date de vente, TRI calculé. Le bien reste listé, grisé. |
| C10 | Bien en marchand de biens | `usage: 'marchand_de_biens'`. Pas de loyer, postes de revient mis en avant. |
| C11 | Suppression d'un prêt portant des garanties | Refusée (`has_guarantees`). Détacher d'abord. |
| C12 | Suppression d'un placement nanti | Refusée (`is_pledged`). Un actif gagé ne disparaît pas en silence. |
| C13 | Emprunteur hors groupe | Cf. § 9 — décision produit non prise. |

---

## 8. Décisions prises pendant l'interview

| Réf | Décision | Justification |
|---|---|---|
| **D1** | Le patrimoine personnel de Clément est hors Albo OS | Ses prêts sont adossés à des actifs personnels sans lien avec CALTE. Corollaire : aucune notion de personne physique. |
| **D2** | Aucun droit d'accès différencié | Découle de D1 : plus de donnée sensible à masquer. Évite un chantier « qui voit quoi » inexistant ailleurs dans l'app. |
| **D3** | Un actif peut garantir plusieurs dettes ; le lien est central | C'est le cas dominant dans le groupe. |
| **D12** | L'actif reste sur sa page d'origine ; la garantie le référence | Une seule valeur, un seul endroit à mettre à jour. |
| **D13** | Une garantie inter-espaces = une ligne unique, lisible des deux côtés | Patron déjà éprouvé par `intercompanyLoans`. Deux lignes divergeraient. |
| **D14** | Pas de vue consolidée groupe | Cohérence avec ALB-128. Le modèle la rend possible plus tard sans surcoût aujourd'hui. |
| **D15** | Les filiales restent des lignes d'investissement dans CALTE, avec un lien vers leur espace | Ce sont de vrais investissements ; le détail vit dans l'espace de la filiale. |
| **D16** | L'app calcule l'échéancier | Benjamin a les conditions de tous les prêts ; le temps réel est le besoin. Risque assumé, mitigé par le « plan vs réel ». |
| **D17** | Toute garantie a une assiette ; trois infos : forme, assiette, garant | Un modèle à un seul champ ne sait pas dire « caution de CALTE sur ses titres ». |
| **D18** | La valo des actifs nantis vient de Placements | Le module Dette lit, il n'écrit jamais. Une seule source. |
| **D19** | Pas d'alertes ; les actions vont dans « À faire » | Une alerte sur une valeur mise à jour une fois par an crierait dans le vide. |
| **D20** | Le bien immobilier est un objet à part entière, sans estimation automatique | Nécessaire pour porter une PPD/hypothèque côté actif. Pas de dépendance tierce. |
| **D21** | Saccef : garantie sans actif du groupe, mentionnée côté prêt | Elle protège la banque sans rien immobiliser chez nous. |
| **D22** | Documents ajoutés à la main | Une dizaine de prêts : un import coûterait plus cher à coder qu'à saisir. |
| **D24** | Champs du bien réduits ; valorisation historisée | Chaque champ vide est du bruit. Une plus-value sans historique ne veut rien dire. |
| **D25** | Loyers et charges via flux bancaires pointés | Même geste que pour la dette. Rentabilité réelle, pas théorique. |
| **D27** | Marchand de biens : postes de revient distincts, TRI à la sortie | Le résultat se lit à la revente, pas en loyers. |
| **D28** | Onglet Immobilier ; onglets activables en chantier séparé | Un bien n'a rien à faire dans Entreprises (fausserait TVPI/MOIC). L'activation est transverse à l'app. |
| **D29** | Marchand de biens = un usage, pas un objet séparé | 80 % de champs communs ; un bien peut changer d'usage. |
| **D30** | Bascule des avances CALTE → filiales : chantier séparé | Opération sur de la donnée de production, à ne pas mélanger. |
| **D31** | Le capital des filiales se saisit, avec le % | C'est du cash sorti, et CALTE n'a pas forcément 100 %. |
| **D32** | Tout sur la page Passif | Même question posée à la société : « qu'est-ce que je dois ? ». |
| **D33** | Le % ne vit qu'à un endroit : la structure capitalistique fait foi ; documents rattachables à un bien | Deux saisies divergent. |
| **D34** | L'assistant IA lit **et** écrit | Chaque écriture porte `needsApproval: true` (règle du repo, non négociable). |
| **D35** | Deux gestes : « Corriger » (écrase) / « Mettre à jour au JJ/MM » (version datée) | L'app ne peut pas deviner si c'est une faute de frappe ou un avenant. |
| **D36** | Euros uniquement | Comme le reste de l'app. |

---

## 9. Questions restées ouvertes

### Q-A — Un emprunteur hors groupe (bloquant pour une ligne de l'annexe)

**La question a été posée pendant l'interview (lot 2, Q6) et n'a jamais été
répondue** — la discussion sur le multi-org l'a interrompue.

Le cas : un actif de CALTE garantit le prêt d'une société qui n'appartient
pas au groupe (SARL Bremontier dans l'annexe). Trois options avaient été
proposées :

- **A.** On ne suit que les dettes du groupe. La marge disponible sur l'actif
  serait alors **surévaluée** : 500 K€ gagés ne seraient pas comptés.
- **B.** On suit la garantie donnée, sans suivre la dette du tiers.
  L'emprunteur est un simple libellé.
- **C.** On suit aussi la dette du tiers (montant, échéances).

**Le modèle ci-dessus est écrit pour l'option B** (champ `borrowerLabel` sur
`guarantees`, alternatif à `loanId`). C'est ce qui permet à la ligne 10 de
l'annexe de rentrer, et à la marge disponible d'être juste. **Cette
proposition n'a pas été validée** — si Benjamin tranche autrement, retirer
`borrowerLabel` (option A) ou créer une entité pour le tiers (option C).

### Q-B — Le montant et l'assiette exacte des cautions

L'annexe mentionne « caution » pour RDB et SCI Chapelle 2 sans dire qui
cautionne, ni à quelle hauteur, ni sur quoi. Le modèle sait le porter ; la
donnée manque. À collecter à la saisie.

### Q-C — Les données de l'annexe elles-mêmes

Benjamin a indiqué en cours d'interview que le tableau fourni est **un
exemple, dont la fiabilité n'est pas garantie**. Les trois interprétations de
la ligne Banco 2 (deux actifs distincts / montants d'acte vs valeur de marché
/ nantissement consenti par un tiers) n'ont pas été tranchées. Le modèle les
absorbe toutes les trois sans modification, mais la donnée réelle reste à
établir.

### Q-D — Le libellé du prêteur

`lenderName` est un texte libre. Si le groupe travaille avec un nombre réduit
de banques et qu'on veut un jour « toutes mes dettes chez Palatine », il
faudra un référentiel. Non tranché ; le texte libre suffit au lot 1 et la
migration vers un référentiel reste simple.

---

## 10. Test de validation — l'annexe, ligne par ligne

> Exercice imposé par le brief : le modèle doit réinstancier les lignes
> fournies **sans perte d'information et sans champ fourre-tout**. Deux
> catégories d'échec sont distinguées : « hors périmètre par décision » (le
> modèle n'est pas en cause) et « le modèle ne sait pas » (le modèle est à
> corriger).

| # | Ligne source | Verdict | Instanciation |
|---|---|---|---|
| 1 | Clément — prêt 1,5 M€ | ⛔ **Hors périmètre (D1)** | Non modélisé. Décision produit, pas un défaut. |
| 2 | Clément — prêt 1,3 M€ | ⛔ **Hors périmètre (D1)** | Idem. |
| 3 | Clément — prêt 316 K€ | ⛔ **Hors périmètre (D1)** | Idem. Le nantissement commun aux 3 prêts (AV Vibrato, 800 K€ sur une valo de 977 K€) sort avec eux. |
| 4 | Banco 2 — 6,6 M€ ; nantissement titres 6,6 M€ + monétaire 3,3 M€ ; compte-titres CALTE n°228, valo 3,7 M€ | ✅ **Rentre** | 1 `loans` (org `banco-2`, 6 600 000 00 cents). 2 `guarantees` : (a) `form: nantissement`, `subjectKind: placement`, `subjectDealId` = compte-titres n°228, `subjectOrgId: calte`, `pledgorOrgId: calte`, `pledgedAmountCents: 6 600 000 00` ; (b) idem sur le support monétaire, 3 300 000 00. Emprunteur ≠ garant : porté nativement. Le total gagé (9,9 M€) dépasse la valo (3,7 M€) : affiché tel quel, marge négative (**C2**). Les trois lectures possibles de cette ligne (deux actifs / montants d'acte / gage consenti par un tiers) sont représentables sans changer le modèle. |
| 5 | Calte — 395 K€ ; nantissement AV 300 K€ ; Concerto Capi n°060, valo 1,4 M€ | ✅ **Rentre** | 1 `loans` (org `calte`). 1 `guarantees` : `nantissement`, `subjectDealId` = Concerto Capi 060, `pledgorOrgId: calte`, 300 000 00. |
| 6 | RDB — 2,4 M€ ; caution + garantie Saccef | ⚠️ **Rentre, donnée incomplète** | 1 `loans` (org `rdb`). 2 `guarantees` : (a) `form: caution`, `pledgorOrgId: calte`, `subjectKind: shares`, `subjectCompanyId` = CALTE — **montant non fourni** (`pledgedAmountCents` absent, cf. **C3** et **Q-B**) ; (b) `form: garantie_organisme`, `subjectKind: external`, `pledgorLabel: "Saccef"` (**D21**). Le modèle porte tout ; c'est la source qui est muette. |
| 7 | SCI Chapelle — 500 K€ ; nantissement AV 150 K€ ; Concerto Capi n°060 | ✅ **Rentre** | 1 `loans` (org `sci-chapelle`). 1 `guarantees` **inter-espaces** : `subjectDealId` = Concerto Capi 060 (`subjectOrgId: calte`), `pledgorOrgId: calte`, `borrowerOrgId: sci-chapelle`, 150 000 00. Une seule ligne, lisible des deux côtés (**D13**). |
| 8 | SCI Chapelle 2 — 538 K€ ; PPD + caution | ⚠️ **Rentre, donnée incomplète** | 1 `loans` (org `sci-chapelle-2`). 2 `guarantees` : (a) `form: ppd`, `subjectKind: property`, `subjectPropertyId` = le bien de la SCI, `pledgorOrgId: sci-chapelle-2` — **suppose que le bien soit saisi** (lot 4) ; (b) `form: caution`, garant et montant **non fournis** (**Q-B**). |
| 9 | SCI Upload — 1,3 M€ ; nantissement titres 60 K€ ; compte-titres Upload, valo 61 K€ | ✅ **Rentre** | 1 `loans` (org `sci-upload`). 1 `guarantees` : `nantissement`, `subjectDealId` = compte-titres Upload (`subjectOrgId: sci-upload`), `pledgorOrgId: sci-upload`, 60 000 00. Cas mono-espace. |
| 10 | SARL Bremontier — 672 K€ / 1 150 K€ ; nantissement AV 500 K€ sur CALTE (Concerto Capi n°060) + 250 K€ sur M. Peninque (AV Vibrato, valo 476 K€) | ⚠️ **Rentre sous réserve d'une décision produit non prise (Q-A)** | Bremontier n'est pas une org du groupe, et M. Peninque n'existe pas. Avec l'option **B** proposée : 2 `guarantees` sans `loanId`, `borrowerLabel: "SARL Bremontier"` — (a) `subjectDealId` = Concerto Capi 060, `pledgorOrgId: calte`, 500 000 00 ; (b) `subjectKind: external`, `subjectLabel: "AV Vibrato — M. Peninque"`, `pledgorLabel: "M. Peninque"`, 250 000 00. **Sans cette décision, la ligne ne rentre pas**, et la marge disponible sur le Concerto Capi serait fausse de 500 K€. |

### Verdict

- **7 lignes sur 10 rentrent** sans perte d'information ni champ fourre-tout
  (dont 2 avec une donnée source manquante, ce qui n'engage pas le modèle).
- **3 lignes ne rentrent pas — toutes par décision produit** (D1, le
  patrimoine de Clément), pas par défaut du modèle.
- **1 ligne (n°10) dépend d'une décision non prise** (Q-A). Le modèle proposé
  l'absorbe ; la décision reste à valider.

**Aucune ligne n'échoue par insuffisance du modèle.** Les deux cas les plus
durs — un actif garantissant trois emprunteurs différents (Concerto Capi 060,
lignes 5/7/10), et un gage supérieur à la valeur de l'actif (ligne 4) — sont
portés nativement.

---

## 11. Découpage en lots

Chaque lot est livrable seul et apporte quelque chose.

### Lot 1 — Les prêts *(le plus petit incrément utile)*

Table `loans`, échéancier calculé, capital restant dû, fiche prêt, bloc
« Dette bancaire » sur la page Passif. Documents attachés au prêt.
Le geste « Corriger » uniquement (pas de version datée).

**Ce que ça apporte** : ouvrir un espace et savoir combien la société doit, à
qui, à quel taux, jusqu'à quand. Aujourd'hui l'app ne le sait pas du tout.

**Critère de succès** : les prêts de l'annexe (hors Clément) sont saisis, et
le capital restant dû affiché correspond au tableau de la banque à moins d'un
euro près.

### Lot 2 — Les garanties

Table `guarantees`, les trois lectures (côté prêt, côté assiette, côté
garant), le bloc « Nantissements sur ce contrat » sur la fiche placement,
le calcul de marge disponible.

**Ce que ça apporte** : U3, la question à laquelle personne ne sait répondre
aujourd'hui sans ressortir les actes.

**Critère de succès** : le Concerto Capi n°060 affiche ses 3 gages et la marge
restante, depuis `calte`, alors que 2 des 3 prêts vivent dans d'autres espaces.

### Lot 3 — Le branchement

`allocation.kind: 'loan'`, échéances dans le prévisionnel
(`derivedKey: "loan:…"`), signaux dans « À faire », outils de lecture pour
l'assistant IA.

**Ce que ça apporte** : le module cesse d'être une saisie et devient vivant —
le prévisionnel intègre la dette, le pointage nourrit le réel.

**Critère de succès** : un prélèvement pointé sur un prêt fait bouger la
colonne « réel » de l'échéancier, et les 6 prochaines échéances apparaissent
dans le prévisionnel.

### Lot 4 — L'immobilier

Tables `properties` et `propertyValuations`, onglet Immobilier, allocation
`'property'`, rentabilité, mode marchand de biens, documents attachés.
Inclut le passage de `documents.companyId` en optionnel (§ 4.8) — **à traiter
en début de lot, avec audit des lectures existantes**.

**Ce que ça apporte** : U5, et l'assiette manquante des PPD/hypothèques.

**Critère de succès** : un bien saisi affiche son prix de revient, sa courbe
de valeur, son rendement net réel, et la PPD de SCI Chapelle 2 se lit des
deux côtés.

### Lot 5 — Capital, détention et avenants

`equityPositions.ownershipBps`, structure capitalistique sur la page Passif,
lecture du % par le deal equity côté CALTE. Geste « Mettre à jour au JJ/MM »
et échéancier multi-périodes.

**Ce que ça apporte** : U6, et la capacité d'encaisser une renégociation sans
perdre l'historique.

### Lot 6 — Onglets activables *(transverse, hors module)*

Activation par espace des modules affichés dans la barre latérale.

**Ce que ça apporte** : avec 9 espaces, une SCI n'affiche plus 6 onglets vides.
Confort d'usage, pas de donnée nouvelle.

### Lot 7 — Écriture par l'assistant IA

Outils d'écriture sur prêts, garanties et biens, tous avec
`needsApproval: true` (**D34**). Si le serveur MCP les expose aussi :
`write: true` sur `defineTool`.

### Hors lots — chantiers dépendants, à planifier séparément

- **Bascule des 7,8 M€ d'avances** CALTE → filiales en comptes courants
  (**D30**). Prérequis pour que la page Passif d'une filiale soit complète.
- **Vue consolidée groupe** (**D14**), si le besoin se confirme.

---

## 12. Points de vigilance pour l'implémentation

1. **Le pointage reste humain.** Aucune suggestion, aucun classement, aucune
   pré-sélection — la règle du repo est explicite et non négociable.
2. **Rien n'est stocké deux fois.** Ni la valeur d'un actif, ni un % de
   détention, ni un solde. Chaque fois qu'on est tenté de dénormaliser, c'est
   qu'on s'apprête à créer deux vérités.
3. **`requireOrgMember` sur toute fonction.** Pour les objets inter-orgs
   (garanties), `requireGuaranteeParty` sur le modèle de `requireLoanParty` :
   membre d'au moins une des parties. Jamais d'héritage de droits — les orgs
   restent à plat.
4. **Aucun chiffre stocké qui puisse être dérivé.** Capital restant dû, marge
   disponible, rendement : tous calculés à la lecture.
5. **`documents.companyId` → optionnel** est le seul changement de contrainte
   sur une table existante. À auditer sérieusement (lot 4).
6. **Un seul XIRR dans le repo.** Le TRI d'un bien vendu réutilise
   l'implémentation des deals.
7. **Attention à la lecture en liste.** Ne jamais `.collect()` une table dont
   une ligne porte un champ texte volumineux pour n'en tirer que des champs
   légers — Convex lit et facture la ligne entière.
