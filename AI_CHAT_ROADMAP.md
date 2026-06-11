# Feuille de route — Chat IA

Proposition d'évolutions du panneau assistant (`src/components/ai/AiPanel.tsx`
+ agent Convex `convex/agent.ts`). Les principes d'interaction qui motivent
ces chantiers vivent dans `AI_UX_PLAYBOOK.md` — ce fichier ne liste que les
chantiers restants, leur valeur et leur séquencement. À mesure qu'un chantier
est livré, supprimer sa section ici (TESTING.md / KNOWN_ISSUES.md prennent le
relais, cf. audit doc de `CLAUDE.md`).

## Où on en est

Livré (v1.3.0) : approbation native des écritures (boutons Confirmer/Refuser,
`needsApproval` sur les ~28 outils d'écriture — cf. `KNOWN_ISSUES.md`
« Approbation d'outils »), ~41 outils couvrant dashboard, TVA, documents,
pointage (dont bulk), forecast complet, passif, valorisations et KPIs,
suggestions contextuelles à la route, rendu riche des résultats (tableaux,
cartes, liens profonds, bouton « Pointer » direct).

Reste à faire : les chantiers ci-dessous.

## P2 — Pièces jointes : le reporting AI-first

**Valeur** : coller le PDF/CSV d'un reporting trimestriel → l'agent extrait
les KPIs et propose `createKpiSnapshot` / `setDealProjections` (avec
l'approbation comme filet). C'est la promesse « saisie AI-first » du schéma.
**Effort** : L.

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
l'humain agit (boutons d'approbation / actions directes).

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
- **Renderers supplémentaires** : `getDashboardSummary`, `getVatPosition`,
  `listKpiSnapshots`… au fil des usages réels (le fallback JSON reste).

## Décisions à trancher

1. **Modèle par défaut** : `claude-haiku-4-5` est économique mais c'est le
   maillon le plus faible pour des enchaînements d'outils avec approbations.
   Tester en réel ; si les enchaînements suggest → approve → match
   déraillent, passer le défaut sur sonnet (l'override `ANTHROPIC_MODEL`
   existe, aucun code à changer).
2. **Cadence du brief** (P2) : quotidien ou hebdo ?

## Séquencement proposé

| Ordre | Chantier | Effort | Dépend de |
| --- | --- | --- | --- |
| 1 | P2 pièces jointes | L | — |
| 2 | P2 brief proactif | M | — |
| 3 | P2 reasoning/métadonnées | S | décision modèle |
