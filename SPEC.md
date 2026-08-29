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
- **L'échéancier multi-périodes** (avenant, renégociation) — lot 5 (**D35**).
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
  durationMonths     number
  rateBps            number                taux nominal (1100 = 11 %)
  rateKind           'fixed' | 'variable'
  insuranceMonthlyCents  number?           assurance emprunteur, cents/mois
  paymentFrequency   'monthly' | 'quarterly'
  deferralMonths     number?               différé d'amortissement
  bankAccountId      Id<'bankAccounts'>?   compte de prélèvement (même org)
  status             'active' | 'repaid' | 'cancelled'
  notes              string?

  .index('by_org', ['orgId'])
  .index('by_org_status', ['orgId', 'status'])
  .index('by_bank_account', ['bankAccountId'])
```

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
  pledgedAmountCents number?               absent si non chiffré (caution illimitée)
  actDate            number?
  releasedAt         number?               mainlevée. Absent = active.
  notes              string?

  .index('by_loan',            ['loanId'])
  .index('by_borrower_org',    ['borrowerOrgId'])
  .index('by_pledgor_org',     ['pledgorOrgId'])
  .index('by_subject_deal',    ['subjectDealId'])
  .index('by_subject_property',['subjectPropertyId'])
  .index('by_subject_company', ['subjectCompanyId'])
```

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
vrai risque du chantier.** Relâcher un champ requis passe côté Convex
(élargir oui, resserrer non), mais **tout le code qui lit `doc.companyId` en
le supposant présent doit être audité**. À traiter en début de lot 4, pas en
passant.

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

**Le plan** — annuité constante :

```
mensualité = P × (i / (1 − (1 + i)^(−n)))   i = rateBps / 10000 / 12
                                            n = durationMonths
```

Chaque échéance se décompose en intérêts (`capital restant × i`), capital
(`mensualité − intérêts`) et assurance (`insuranceMonthlyCents`, **hors**
mensualité). Un différé produit des échéances d'intérêts seuls.

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

### 6.3 Passif d'une société — page unique (**D32**)

`/app/$orgSlug/passif` — quatre sections, dans cet ordre (**D39**) :

```
Dette bancaire            → total restant dû, en bas de section
Comptes courants          → solde net, en bas de section
Capital                   → capital social, en bas de section
─────────────────────────
Garanties données         → détachée : ce que cette société met en gage
                            pour d'autres. Ce n'est pas une dette.
```

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
- **Chiffres clés** en ligne (emprunté, restant dû, taux, mensualité,
  assurance, dernière échéance) — pas de tuiles encadrées.
- **Garanties** : forme, assiette (lien), garant (lien), montant gagé, et la
  marge disponible sur l'assiette.
- **Échéancier** : date, mensualité, capital, intérêts, restant dû, réel.
  Trois états lisibles — à venir (grisée), échue à pointer (ambrée), pointée
  (verte). L'ambre marque une attente, pas une faute : le rouge reste réservé
  à ce qui va mal.
- **Transactions** : le tableau des prélèvements rattachés (date, sens,
  montant, libellé).
- **Documents**.

**On ne rattache pas depuis la fiche** (**D41**). C'est le patron déjà en place
sur une fiche deal (`deals.$dealId.tsx`) : la fiche affiche les transactions
rattachées et permet de les **réaffecter** via un panneau latéral ; le
rattachement initial se fait dans la file de Pointage. Aucun geste nouveau
n'est introduit.

### 6.5 Fiche d'un placement — le bloc ajouté

Sur la fiche placement existante, un bloc « Nantissements sur ce contrat » :
valeur actuelle, total gagé, marge disponible, puis une ligne par gage — y
compris ceux qui bénéficient à une autre société du groupe ou à un tiers.

C'est l'écran qui porte la valeur principale du module (U3).

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

### 6.7 Le geste de pointage

Le sélecteur **existe déjà** dans la file de Pointage, avec ses groupes Deals /
Capitaux propres / Comptes courants (`convex/liabilities.ts:listOptions` +
`src/lib/liabilityOptions.ts`). On lui ajoute **deux groupes** : Prêts, Biens.

Le seul élément réellement nouveau est le choix de la **nature de la dépense**
quand la cible est un bien (§ 4.6).

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
| 10 | SARL Bremontier — 672 K€ / 1 150 K€ ; nantissement AV 500 K€ sur CALTE (Concerto Capi n°060) + 250 K€ sur M. Peninque (AV Vibrato, valo 476 K€) | ✅ **Rentre** (**D-QA**) | Bremontier n'est pas une org, M. Peninque n'existe pas. 2 `guarantees` sans `loanId`, `borrowerLabel: "SARL Bremontier"` : (a) assiette Concerto Capi 060, `pledgorOrgId: calte`, 500 000 00 ; (b) `subjectKind: external`, `subjectLabel: "AV Vibrato — M. Peninque"`, `pledgorLabel: "M. Peninque"`, 250 000 00. Sans D-QA, la marge du Concerto Capi serait fausse de 500 K€. |

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

Table `loans`, échéancier calculé, capital restant dû, fiche prêt, bloc
« Dette bancaire » sur la page Passif, documents attachés. Le geste
« Corriger » uniquement.

**Ce que ça apporte** : ouvrir un espace et savoir combien la société doit, à
qui, à quel taux, jusqu'à quand. L'app l'ignore complètement aujourd'hui.

**Critère de succès** : les prêts de l'annexe (hors Clément) sont saisis et le
capital restant dû correspond au tableau de la banque à moins d'un euro près.

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
rentabilité, mode marchand de biens, documents. Inclut le passage de
`documents.companyId` en optionnel (§ 4.8) — **à traiter en début de lot, avec
audit des lectures existantes**.

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
6. **`documents.companyId` → optionnel** est le seul changement de contrainte
   sur une table existante. À auditer sérieusement (lot 4).
7. **Un seul XIRR dans le repo.** Le TRI d'un bien revendu réutilise
   l'implémentation des deals.
8. **Attention à la lecture en liste.** Ne jamais `.collect()` une table dont
   une ligne porte un champ texte volumineux pour n'en tirer que des champs
   légers — Convex lit et facture la ligne entière.
9. **i18n.** Toute chaîne visible passe par `t()` avec une entrée `en` **et**
   `fr`. Nouveaux namespaces à prévoir : `immobilier`, et des ajouts dans
   `passif`, `pointage`, `nav`.
10. **Saisie d'un montant en euros** → `AmountInput` / `useAmountField`, jamais
    un `<input type="number">` brut.
