# Feuille de route — Chat IA

Proposition d'évolutions du panneau assistant (`src/components/ai/AiPanel.tsx`
+ agent Convex `convex/agent.ts`). Les principes d'interaction qui motivent
ces chantiers vivent dans `AI_UX_PLAYBOOK.md` — ce fichier ne liste que les
chantiers, leur valeur et leur séquencement. À mesure qu'un chantier est
livré, supprimer sa section ici (TESTING.md / KNOWN_ISSUES.md prennent le
relais, cf. audit doc de `CLAUDE.md`).

## Où on en est

- **Solide** : 27 outils scopés à l'org (17 écritures, 10 lectures), streaming
  temps réel via deltas Convex, threads persistants (rename/delete/stop),
  contexte de route dans le system prompt, rate limiting.
- **Le maillon faible** : la confirmation des écritures est purement
  **conversationnelle** — `convex/lib/instructions.ts` exige « restate + get
  user confirmation first ». C'est fragile (dépend de l'obéissance du
  modèle), lent (un aller-retour texte par action) et coûteux (tokens).
- Les résultats d'outils s'affichent en **JSON brut** dépliable : pas de
  boutons, pas de liens vers les pages de l'app, pas de pièces jointes.
- Les 5 composants AI Elements vendorés (`src/components/ai-elements/`)
  datent de la génération précédente du registry (~48 composants
  aujourd'hui, dont `confirmation`, `plan`, `queue`, `reasoning`, catégories
  voice/workflow).

**État upstream vérifié (06/2026)** : `ai` v6 a une API d'approbation
d'outils de première classe, et `@convex-dev/agent` **0.6.x la supporte
nativement** côté Convex (`needsApproval` dans `createTool`,
`agent.approveToolCall()` / `agent.denyToolCall()`, auto-deny des
approbations en suspens quand une nouvelle génération démarre). Doc :
<https://docs.convex.dev/agents/tool-approval>. C'est le verrou qui a sauté.

---

## P0 — Boutons Confirmer / Refuser : approbation d'outils native

**Valeur** : chaque écriture en base devient un clic au lieu d'un message
tapé ; la garantie « rien ne s'écrit sans accord » passe du prompt au code.
**Effort** : M.

1. **Bump `@convex-dev/agent` ≥ 0.6.3** (0.6.2 corrige la persistance du
   step final avec `saveStreamDeltas` et le doublon de message après
   approbation — issue get-convex/agent#185 ; 0.6.3 = compat types Convex
   1.41).
2. **`needsApproval: () => true` sur les 17 outils d'écriture** :
   `createCompany`, `createDeal`, `updateDeal`, `createBankAccount`,
   `createTransaction`, `matchTransactionToDeal`,
   `allocateTransactionToLiability`, `categorizeTransaction`,
   `unpointTransaction`, `createEquityPosition`, `createIntercompanyLoan`,
   `createForecastRule`, `expandForecastRules`, `markForecastEntryRealized`,
   `createValuation`, `setDealProjections`, `createKpiSnapshot`. Les
   lectures restent libres. (`needsApproval` peut être conditionnel —
   `async (_ctx, input) => …` — si un jour on veut exempter les petits
   montants ; pas pour la V1.)
3. **Deux mutations dans `convex/chat.ts`** (`approveToolCall` /
   `denyToolCall`) : `requireOrgMember` + `authorizeThread` (même garde que
   les mutations existantes), puis `chatAgent.approveToolCall(ctx,
   { threadId, approvalId })` (resp. `denyToolCall`), puis re-scheduler
   `internal.chat.streamAsync` avec le `promptMessageId` du message
   d'approbation pour que la génération reprenne. Re-lire
   `docs/tool-approval.mdx` upstream au moment de l'implémentation pour la
   signature exacte de la reprise.
4. **Front** : vendorer `confirmation` depuis le registry AI Elements
   (`pnpm dlx ai-elements@latest add confirmation`). Le composant est piloté
   par l'état du tool part (`state === 'approval-requested'` →
   `approval-responded` → `output-available` / `output-denied`) et
   `part.approval` `{ id, approved, reason }`, que `useUIMessages` expose
   déjà — seuls les handlers changent (nos mutations Convex au lieu du
   `addToolApprovalResponse` de `useChat`). Au-dessus des boutons : un
   résumé **lisible** de l'action (libellé de l'outil + paramètres formatés
   en clair — euros, %, dates — pas le JSON).
5. **i18n** : clés `chat:approval.*` (en + fr) pour les boutons et les états
   accepté/refusé. Les états refusés restent visibles dans l'historique
   (y compris l'auto-deny : toute approbation en suspens est refusée
   automatiquement si l'utilisateur envoie un nouveau message).
6. **Alléger `convex/lib/instructions.ts`** : le garde-fou final devient
   « annonce ce que tu vas faire puis appelle l'outil ; l'app demandera
   confirmation à l'utilisateur ». On garde l'annonce (contexte pour
   l'humain qui clique), on ne dépend plus du modèle pour la sécurité.
7. **Tests (TESTING.md, même PR)** : approve, deny, auto-deny (nouveau
   message pendant une approbation en suspens), stop pendant une
   approbation, refresh de la page avec approbation en suspens (l'état est
   persisté côté Convex, il doit se réafficher).

Limite connue : `dynamicTool()` ne supporte pas l'approbation (vercel/ai
#11434) — sans impact, tous nos outils sont statiques.

## P1 — Rendu riche des résultats d'outils + actions directes

**Valeur** : « montrer, pas raconter » — les données structurées que les
outils retournent déjà s'affichent en UI native au lieu de JSON, avec des
liens profonds vers l'app. **Effort** : M (incrémental, outil par outil).

- Un registre `toolRenderers: Record<string, (output) => ReactNode>` dans le
  panneau ; fallback sur l'affichage JSON actuel pour les outils sans
  renderer. Priorité aux sorties à forte densité : `listDeals` /
  `searchTransactions` (tableau compact), `getForecastBalance` (mini courbe),
  `listLiabilities` (cartes), `suggestMatches` (cartes candidates avec leur
  évidence).
- **Liens profonds** : les sorties d'outils contiennent les ids — rendre des
  `<Link>` vers `deals.$dealId`, `cash.$accountId`, etc. Le panneau connaît
  l'`orgSlug` via la route.
- **Boutons d'action directs** dans les renderers, complémentaires du P0 :
  sur une carte `suggestMatches`, un bouton « Pointer » appelle la mutation
  publique existante (`transactions.matchTransaction`) **sans repasser par
  le modèle** — zéro token, instantané, déterministe — puis poste un court
  message dans le thread pour que le modèle sache que c'est fait. Règle de
  partage : l'action initiée *par le modèle* passe par l'approbation P0 ;
  l'action initiée *par l'utilisateur depuis l'UI* appelle la mutation.
- Contrainte d'architecture confirmée upstream : `@convex-dev/agent` n'a pas
  d'API d'écriture pour les data parts custom (`data-*`) du SDK — le canal
  supporté pour l'UI générative, ce sont les **tool parts** (+ requêtes
  Convex classiques). Ne pas tenter `createUIMessageStream`/`writer` ici.

## P1 — Couverture d'outils : combler les trous vs l'app

**Valeur** : l'assistant peut répondre/agir partout où l'UI le peut.
**Effort** : S par outil (le pattern interne + `createTool` est rodé).

Lectures manquantes :

| Outil proposé | S'appuie sur | Usage type |
| --- | --- | --- |
| `getDashboardSummary` | `dashboard.getDashboard` | « Où en est-on ? » — synthèse cash/portefeuille |
| `getVatPosition` | `transactions.getVatPosition` | « Quelle TVA à déclarer ce trimestre ? » |
| `listCompanyDocuments` | `documents.listByCompany` | « Quels docs a-t-on sur X ? » |

Écritures manquantes (toutes avec `needsApproval`) :

| Outil proposé | S'appuie sur | Usage type |
| --- | --- | --- |
| `bulkCategorizeTransactions` | `transactions.bulkCategorize` | « Passe toutes les lignes Qonto en frais bancaires » — **1 approbation pour le lot**, pas N |
| `updateForecastRule` / `deleteForecastRule` | `forecasts.updateRule` / `deleteRule` | ajuster une règle récurrente |
| `createManualForecastEntry` / `updateForecastEntry` / `cancelForecastEntry` | `forecasts.*` | entrées ponctuelles du prévisionnel |
| `updateEquityPosition` / `updateIntercompanyLoan` | `liabilities.*` | corriger le passif |
| `deallocateTransaction` | `liabilities.deallocateTransaction` | défaire une allocation (symétrique d'`unpointTransaction`) |
| `updateCompany` | `companies.update` | secteur, domaine |
| `renameBankAccount` | `cash.updateAccountName` | nommage des comptes |

**Règle à inscrire dans les instructions** : les **suppressions** (deal,
position, prêt, document, KPI) restent volontairement hors agent — UI
uniquement. `deleteForecastRule` est l'exception tolérable (réversible : on
recrée la règle et on ré-expand) ; à trancher à l'implémentation.

## P1 — Suggestions contextuelles par route

**Valeur** : découvrabilité — l'état vide propose des actions pertinentes
pour la page courante. **Effort** : S.

Remplacer les 4 suggestions statiques (`SUGGESTION_KEYS`) par une map
route → clés (pointage → « Pointe les transactions en attente », page deal →
« Ajoute une valorisation », cash → « Position de cash et TVA », passif →
« Solde des C/C »…). Le panneau a déjà `useLocation()`. Pas de génération
LLM ici — statique, gratuit, prévisible.

## P2 — Pièces jointes : le reporting AI-first

**Valeur** : coller le PDF/CSV d'un reporting trimestriel → l'agent extrait
les KPIs et propose `createKpiSnapshot` / `setDealProjections` (avec
l'approbation P0 comme filet). C'est la promesse « saisie AI-first » du
schéma. **Effort** : L.

- Côté Convex : `@convex-dev/agent` a une intégration fichiers (stockage
  Convex, référencés dans les messages — `docs/files.mdx` upstream). Notre
  cap 20 MB existant s'applique. Anthropic lit les PDFs nativement.
- Côté front : le `prompt-input` actuel du registry embarque
  `PromptInputAttachments` — re-vendorer en ré-appliquant les trims
  documentés dans `KNOWN_ISSUES.md` (« Streamdown (panneau AI) »).
- Mettre à jour la note `KNOWN_ISSUES.md` sur les pertes vs assistant-ui
  (les attachments en sortent) à la livraison.

## P2 — Le brief : compagnon quotidien proactif

**Valeur** : l'assistant devient utile *sans qu'on lui demande* — au bon
endroit (un thread dédié), jamais en interruption. **Effort** : M.

Un cron Convex (quotidien ou hebdo, à trancher) lance une génération
**lecture seule** : transactions à pointer, échéances du prévisionnel du
mois, sociétés sans KPI récent, et écrit le résultat dans un thread
« Brief » de chaque utilisateur (`saveMessage`), avec un badge discret sur
le bouton du panneau. Aucune écriture en base depuis le brief — il pointe,
l'humain agit (boutons P0/P1).

## P2 — Affichage du raisonnement et des métadonnées

- `@convex-dev/agent` propage déjà les deltas de reasoning ; si on monte le
  modèle (cf. « Décisions » ci-dessous), activer le thinking adaptatif
  (`providerOptions.anthropic.thinking: { type: 'adaptive' }` sur les
  modèles ≥ sonnet 4.6) et vendorer `reasoning` — le « Réflexion… » actuel
  devient un vrai état lisible.
- Usage tokens par message : déjà persisté dans les métadonnées des messages
  côté agent — affichage discret (tooltip), utile pour surveiller le coût.

## P3 — Plus tard, si le besoin se confirme

- **File de messages** (`queue` du registry) : taper le message suivant
  pendant que le précédent streame.
- **Éditer / régénérer un message** — coût élevé, gain incertain à 2 users.
- **Entrée vocale** : `experimental_transcribe` du SDK n'a pas de provider
  Anthropic — nécessite OpenAI/Deepgram/ElevenLabs. Hors stack actuelle.
- **Panneau sur `/app/all`** : le scope `${orgId}:${userId}` est par org ;
  une vue agrégée demanderait soit un pseudo-scope « all » lecture seule,
  soit des outils cross-org dédiés. À ne traiter que si le besoin émerge.
- **Sélecteur de modèle** (`model-selector`) : aujourd'hui `ANTHROPIC_MODEL`
  env var suffit pour 2 users.

---

## Décisions à trancher avant P0

1. **Modèle par défaut** : `claude-haiku-4-5` est économique mais c'est le
   maillon le plus faible pour des enchaînements d'outils avec approbations.
   Recommandation : tester P0 avec haiku ; si les enchaînements
   suggest → approve → match déraillent, passer le défaut sur sonnet
   (l'override env existe déjà, aucun code à changer).
2. **Politique de suppression** : tout hors agent (recommandé), ou
   `deleteForecastRule` toléré ?
3. **Cadence du brief** (P2) : quotidien ou hebdo ?

## Séquencement proposé

| Ordre | Chantier | Effort | Dépend de |
| --- | --- | --- | --- |
| 1 | P0 approbation native | M | bump agent 0.6.3 |
| 2 | P1 couverture outils | S×12 | P0 (les écritures naissent avec `needsApproval`) |
| 3 | P1 suggestions par route | S | — |
| 4 | P1 rendu riche + actions directes | M | — (synergie avec P0) |
| 5 | P2 pièces jointes | L | P0 |
| 6 | P2 brief proactif | M | P1 couverture (lectures) |
| 7 | P2 reasoning/métadonnées | S | décision modèle |
