# Interactions IA dans un SaaS — playbook

Principes d'interaction pour un assistant intégré à un produit métier, à
l'état de l'art (mi-2026), et leur application dans Albo OS. Référence
durable : les chantiers concrets vivent dans `AI_CHAT_ROADMAP.md`, les
pièges d'implémentation dans `KNOWN_ISSUES.md`.

## 1. La sécurité par construction, jamais par prompt

Le system prompt optimise l'expérience ; **le code garantit les
invariants**. Une instruction « demande confirmation avant d'écrire » est
une politesse, pas une protection : un modèle peut l'ignorer, un prompt
injecté peut la contourner.

- Toute écriture sensible est bloquée structurellement tant que l'humain
  n'a pas approuvé (approbation d'outil native, pas conversationnelle).
- Chaque outil re-vérifie les droits **côté serveur** à chaque appel — chez
  nous : scope key `${orgId}:${userId}` du thread + `actorUserId` explicite
  (l'action de stream n'a pas d'identité auth), helpers
  `convex/lib/agentScope.ts`. L'identité ne transite jamais par le LLM.
- Hiérarchie des actions : **lecture libre** → **écriture approuvée** →
  **suppression hors agent** (UI uniquement). Un agent qui ne peut pas
  détruire n'a pas besoin qu'on lui fasse confiance pour ne pas détruire.

## 2. L'approbation au bon grain

- **Une action en base = une approbation explicite**, qui affiche les
  valeurs exactes qui vont être écrites (montants, dates, cibles) — pas une
  paraphrase du modèle.
- **Un lot homogène = une seule approbation** : pour une opération de masse,
  exposer un outil bulk approuvé une fois, jamais N popups (fatigue
  d'approbation = l'utilisateur clique sans lire = la protection est morte).
- **Les approbations expirent avec le contexte** : si la conversation
  repart, les demandes en suspens sont refusées automatiquement — un « oui »
  ne doit jamais s'appliquer à une question qui a changé.
- L'issue de chaque demande (approuvée / refusée / expirée) **reste visible
  dans l'historique** : le fil de discussion est aussi un journal.

## 3. Montrer, pas raconter (UI générative)

- Une donnée structurée retournée par un outil s'affiche en **composant
  natif** (tableau, carte, lien profond vers la page concernée). Le texte du
  modèle commente ; l'UI montre. Faire re-formater des données par le modèle,
  c'est payer des tokens pour introduire des erreurs de chiffres.
- **L'arithmétique se fait côté serveur, jamais côté modèle** : les outils
  retournent des totaux pré-calculés et les instructions interdisent de
  sommer des lignes (cf. `searchTransactions` et ses totaux TVA).
- Les unités sont strictes aux frontières : cents, basis points, dates ISO
  en entrée d'outil (validées par Zod) ; conversion en langage humain
  uniquement à l'affichage. Cf. conventions de données dans `CLAUDE.md`.

## 4. Le modèle ne devine pas

- Pas de signal → le dire. Un outil de suggestion qui ne trouve rien
  retourne une liste vide et l'instruction est explicite : *do not guess*
  (cf. `suggestMatches`).
- Les descriptions d'outils portent les règles métier au plus près de la
  décision (« the investor MUST be a group entity ») : c'est le meilleur
  emplacement de prompt qui existe — relu à chaque appel, jamais périmé par
  la conversation.
- Ce qui est ambigu se résout par une question à l'utilisateur, pas par un
  défaut silencieux.

## 5. Latence honnête, contrôle permanent

- Accusé de réception < 1 s (état « réflexion »), streaming token par token,
  états intermédiaires des outils visibles (en attente / en cours / terminé /
  erreur), bouton **stop toujours accessible** pendant une génération.
- L'état de la conversation survit au refresh : threads, messages, demandes
  d'approbation en suspens sont persistés côté serveur, pas dans l'état
  React.

## 6. Réversibilité et audit

- Toute écriture pilotée par l'IA doit avoir un **undo de première classe**
  (chez nous : `unpointTransaction`) et/ou un journal append-only des
  décisions (`matchingDecisions` — qui sert en prime de dataset
  d'apprentissage pour les suggestions).
- Les écritures sont idempotentes ou protégées contre les doublons (les
  contraintes d'unicité vivent dans les mutations, cf. `CLAUDE.md`).

## 7. L'assistant sait où est l'utilisateur

- Le contexte de page (route, org) entre dans le system prompt **par
  message** — pas figé à la création du thread (cf. `buildInstructions`).
- Les suggestions de démarrage s'adaptent à la page courante ; l'état vide
  est un tutoriel implicite des capacités réelles de l'agent.

## 8. Proactif au bon endroit, jamais en interruption

- La proactivité (brief, alertes) va dans un **espace dédié** que
  l'utilisateur ouvre quand il veut (thread « brief », badge discret) —
  jamais en popup, jamais en écriture spontanée en base.
- Un assistant proactif est en **lecture seule** : il pointe, l'humain agit.

## 9. Coût et modèle maîtrisés

- Modèle par défaut économique, montée en gamme par variable d'environnement
  (pas de redéploiement). Les boucles d'outils sont bornées (`stopWhen`),
  les embeddings désactivés quand inutiles (`skipEmbeddings`), le rate
  limiting est visible et compréhensible côté UI.
- Le coût se mesure : l'usage par message est persisté et consultable.

## 10. Une langue, des libellés, des accès

- Tout libellé du chat passe par l'i18n (en + fr), y compris les états
  d'outils et d'approbation ; les codes d'erreur restent techniques et
  anglais (règles dans `CLAUDE.md`).
- Le panneau est pilotable au clavier (raccourci global, focus géré,
  `aria-label` partout) et fonctionne en mobile (overlay).

## 11. Évaluer l'assistant comme une feature

- Chaque outil livré ajoute son scénario de validation dans `TESTING.md`
  (lecture correcte, écriture avec approbation, refus, cas vide).
- Les régressions de comportement (modèle qui n'appelle plus le bon outil,
  qui saute une étape) se détectent avec des **conversations golden**
  rejouées manuellement à chaque changement de modèle ou d'instructions —
  le changement de `ANTHROPIC_MODEL` est un événement de test, pas un
  détail de config.

---

Sources principales : AI SDK v6 (<https://ai-sdk.dev/docs>), composant agent
Convex (<https://docs.convex.dev/agents>, notamment *tool-approval*),
AI Elements (<https://ai-sdk.dev/elements>).
