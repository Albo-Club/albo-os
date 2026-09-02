# Nouveautés

<!--
  Trace en prose des évolutions, une entrée versionnée par PR
  (`## vX.Y.Z — JJ/MM/AAAA à HH:MM — titre`), du plus récent au plus
  ancien. Corps en langage produit (pas de chemins de fichiers ni de
  noms de fonctions) — ce fichier est rendu tel quel dans l'app sur
  /app/$orgSlug/changelog (import ?raw).

  Chaque entrée se termine par un blockquote « 🔧 Notes techniques » :
  synthèse de ce qui a été fait techniquement (fichiers, fonctions,
  décisions), façon description de PR, pour un dev ou un agent qui
  reprend le code. Fichiers et fonctions autorisés ici (et seulement
  ici). Markdown pur uniquement — pas de <details>, le rendu in-app
  (react-markdown sans rehype-raw) ignore le HTML brut.

  Règle d'alimentation : CLAUDE.md § « Pre-PR doc audit » (question 5).
-->

Ce que chaque mise à jour change pour vous, en clair — du plus récent au
plus ancien. Les termes financiers sont expliqués dans le petit lexique en
bas de page.

---

## v1.212.1 — 02/09/2026 à 17:45 — Le contenu des fenêtres reste dans le cadre

Quand une fenêtre s'ouvrait par-dessus la page — ajouter des documents,
confirmer une suppression, éditer une ligne — un texte long débordait du
cadre : les noms de fichiers passaient par-dessus le bord, et le bouton de
validation se retrouvait carrément en dehors de la boîte, coupé. Le contenu
ne collait plus à la marge de la fenêtre, et rien ne signalait ce qui était
tronqué.

C'est corrigé à la source, pour toutes les fenêtres et toutes les cartes de
l'app d'un coup : un nom trop long est désormais abrégé avec des points de
suspension (le nom complet apparaît au survol), les boutons restent à leur
place, et un mot sans espace — nom de fichier, adresse e-mail, lien — passe
à la ligne au lieu de sortir du cadre. Le nom de la société dans la colonne
« Org » de la liste des participations, qui pouvait mordre sur la colonne
voisine, est abrégé de la même façon.

> **🔧 Notes techniques**
>
> - Cause racine : `DialogContent`, `AlertDialogContent` et `CardHeader`
>   (`src/components/ui/`) sont des `grid`. Un enfant de grille a
>   `min-width: auto` = sa taille min-content, donc un fragment insécable
>   gonfle la colonne implicite au-delà du `max-w-*` du conteneur — tous les
>   enfants suivent, `DialogFooter` compris, d'où les boutons hors cadre.
> - `truncate` ne corrigeait rien : son `overflow: hidden` annule la taille
>   minimale **automatique** d'un item flex/grid, pas la contribution
>   min-content qui dimensionne la piste. D'où les passes précédentes sans
>   effet. Correctif : `[&>*]:min-w-0` sur les trois primitives — les
>   `truncate` déjà posés dans les 46 appelants deviennent effectifs.
> - Second mode d'échec, indépendant : un mot sans opportunité de coupure
>   reste plus large que la boîte. Filet global `overflow-wrap: break-word`
>   sur `body` (`src/styles/app.css`), qui ne se déclenche que si le mot ne
>   tient pas seul sur une ligne.
> - `ParticipationsTable.tsx` : badge org de la colonne à largeur fixe passé
>   en `max-w-full` + `title` + `<span className="truncate">`, selon
>   l'anti-pattern déjà documenté dans `CLAUDE.md`.
> - Vérifié en rendant le markup réel de `AddFilesDialog` avec le CSS buildé
>   dans Chromium headless, avec et sans le patch. Détail du piège dans
>   `KNOWN_ISSUES.md` § « `truncate` ne retient rien dans une boîte en
>   `grid` » ; candidat template ajouté à `TEMPLATE_SYNC.md`.

---

## v1.212.0 — 02/09/2026 à 16:04 — Une publication Parallel te prévient par email

Jusqu'ici, un reporting publié sur le portail Parallel mettait bien la fiche et
la note de santé à jour, mais en silence : il fallait ouvrir l'app pour
s'apercevoir qu'il y avait du neuf. Un reporting transféré par email, lui,
donnait un accusé de réception.

Désormais, une publication Parallel envoie **le même email** — un par société
concernée : carte de la société, lien vers sa fiche, titres des publications, et
la note de santé **remise à jour de cette publication** (score, résumé, points
forts et de vigilance, KPIs). Il part aux membres de l'organisation qui n'ont
pas désactivé les annonces de reporting.

Trois différences, toutes dues au fait que personne n'a rien envoyé : pas de
réponse dans un fil de discussion (il n'y en a pas), la ligne d'origine dit
« Publié sur le portail le … » au lieu de « Transféré par … », et il n'y a pas
de bloc « ce que dit ce report » — les chiffres d'une publication Parallel ne
sont pas extraits, c'est la synthèse qui porte le fond.

**Chaque publication n'est annoncée qu'une fois**, quel que soit le nombre de
synchronisations. Et le tout premier remplissage du cache d'un portail
n'envoie rien : un historique n'est pas une nouvelle.

> **🔧 Notes techniques**
>
> - **Prérequis : le cache Parallel passe en upsert.** `replaceCommunicationsCache`
>   effaçait tout et réinsérait à chaque cycle. Aucune date affichée n'en était
>   faussée (la fiche lit `publishDate`), mais l'**identité** des lignes était
>   détruite, donc aucun état ne pouvait y vivre — un marqueur « déjà annoncée »
>   aurait été balayé toutes les 48 h et le même mail serait reparti
>   indéfiniment. La mutation insère le nouveau, patche ce qui a bougé, supprime
>   ce que le portail ne liste plus. « Nouveau » devient structurel (aucune
>   ligne n'existait) au lieu d'être recalculé à la volée, et une ligne connue
>   coûte un patch au lieu d'un delete + insert. ⚠️ `announcedAt` n'est
>   **pas** dans le patch de rafraîchissement : c'est ce qui le fait survivre.
> - **`convex/vascoNotify.ts`** (nouveau module, miroir de `reportNotify`) :
>   `claimArrivals` estampille `announcedAt` en transaction puis rend ce que les
>   communications disent ; `announce` vérifie l'inbox sortante **avant** de
>   réclamer (sinon l'annonce serait brûlée sans envoi), réclame, lance
>   `intelligence.runAnalysis`, puis construit un mail **par destinataire** via
>   `reportNotify.entityCards` et `reportConfirmationHtml`.
> - **Deux ordres non permutables** : la synthèse tourne avant la construction
>   du mail (la carte dit « où en est la boîte »), et la réclamation précède
>   l'envoi (une reprise du scheduler ne doit pas doubler). Comme `notifiedAt`,
>   la marque n'est jamais relâchée.
> - **Bootstrap** : un premier remplissage marque tout comme déjà annoncé et ne
>   planifie que les analyses. Un pull vide mais réussi vide le cache et rend le
>   remplissage suivant silencieux — ça échoue du bon côté.
> - `emailTemplates` : `publishedOn` et `publicationTitles` optionnels sur
>   `ReportConfirmationData`, le titre « Nouveau report » couvrant les deux
>   origines. Aucun changement pour le canal mail.
> - **Non régression** : `regression.vascoAnalysis.test.ts` passe de 6 à 11 cas.
>   Contrôle négatif dans les deux sens — le garde-fou du bootstrap retiré fait
>   échouer « le premier remplissage n'annonce pas », le marqueur non posé fait
>   échouer « une arrivée n'est réclamée qu'une fois ».
> - ⚠️ `convex/_generated/api.d.ts` porte **deux lignes ajoutées à la main**
>   pour le nouveau module : le codegen ne tourne pas hors ligne, et c'est
>   l'exception documentée dans `KNOWN_ISSUES.md` § « Codegen Convex hors-ligne ».
>   Le prochain `convex deploy` réécrit le même contenu.
## v1.211.0 — 02/09/2026 à 15:46 — Déposer un document ne demande plus rien

Le formulaire d'ajout d'un document posait quatre questions — type, période,
titre, deal — sur un fichier que l'app allait de toute façon lire quelques
secondes plus tard. Il n'en pose plus aucune.

**Déposer.** La fenêtre se réduit à « choisir des fichiers », plusieurs d'un
coup, sur une société comme sur un prêt, une garantie ou un bien. Chaque
fichier est ensuite lu, et **se classe tout seul** : son type, et sa date
quand le document la porte, se remplissent quelques secondes plus tard, sans
recharger la page. Chacun selon son propre contenu — déposer un pacte, un
business plan et un KBIS d'un seul geste range les trois correctement, là où
l'ancien formulaire appliquait un type unique à tout le lot.

Le titre reste le nom du fichier : c'est vous qui l'avez nommé. Un classement
qui tombe à côté se corrige au crayon, sur la ligne du document — et une
correction faite à la main n'est jamais réécrite. Un fichier illisible (scan
sans texte, format non reconnu) reste simplement en « Autre ».

**Ajouter un rapport** garde sa porte et son circuit d'analyse, et perd lui
aussi son sélecteur : les fichiers, une note de contexte si elle aide
l'analyse, c'est tout. Le bouton disparaît en revanche des entités du
groupe — l'analyse n'a jamais su lire autre chose qu'une société du
portefeuille, le sélecteur servait jusqu'ici de rattrapage silencieux.

**Deux choses disparaissent.** Le rattachement d'un document à un deal ne se
crée plus au dépôt : les documents déjà rattachés gardent leur badge et leur
lien vers la fiche du deal, les nouveaux restent au niveau de l'entité. Et un
reporting ne peut plus être déposé par la carte Documents : il passe par
« Ajouter un rapport », seule porte qui déclenche l'analyse.

> **🔧 Notes techniques**
>
> - Nouveau `convex/documentsClassify.ts` : `run` (action) appelle le modèle
>   sur le texte déjà extrait (fenêtre 12 000 car.) et rend `{ kind, period }` ;
>   `apply` (mutation) arbitre. Branché en fin de `documentsExtract.run`,
>   uniquement sur un état `extracted` — une lecture ratée ne coûte aucun appel.
> - Deux garde-fous côté code, pas côté prompt : le `kind` n'est accepté que
>   dans le vocabulaire de l'**ancre** (`VOCABULARIES`, société / prêt /
>   garantie / bien), et le patch ne s'applique qu'à une ligne encore dans son
>   état de dépôt (`source: 'upload'`, `kind: 'other'`, pas de `period`) — un
>   type choisi par un humain n'est jamais écrasé. `reporting` n'est dans aucun
>   vocabulaire : c'est un aiguillage vers `reportInbox.createFromUpload`, pas
>   une étiquette. Ré-indexation sémantique quand le type change.
> - Front : `AddDocumentDialog` est remplacé par deux composants —
>   `documents/AddFilesDialog.tsx` (dépôt nu, partagé par la carte Documents
>   d'une société **et** par `DocumentsSection`, qui passe donc au multi-fichiers)
>   et `companies/AddReportDialog.tsx` (fichiers + note, pipeline d'analyse,
>   affiché seulement si `company.kind === 'portfolio'`). `DocumentAnchor` et
>   `anchorArgs` déménagent dans `AddFilesDialog`, augmentés du cas `company`.
> - Orphelins retirés : `DealSelect` / `DealOption` / `MAX_BYTES` de
>   `documentFields.tsx`, la prop `deals` de `CompanyDocumentsCard` et
>   `CompanyReportsSection`, et les clés i18n correspondantes.
> - `convex/regression.docClassify.test.ts` (7 tests) fixe l'arbitrage :
>   vocabulaire par ancre, refus de `reporting`, non-écrasement d'un choix
>   humain, document sans texte hors cible, et `parsePeriod` qui refuse tout
>   ce qui n'est pas `AAAA-MM[-JJ]`.
> - ⚠️ `convex/_generated/api.d.ts` a été complété **à la main** (deux lignes
>   pour le nouveau module) : la session n'avait pas de déploiement Convex pour
>   lancer `convex codegen`. Le prochain `convex dev`/`deploy` régénère à
>   l'identique.
## v1.210.0 — 02/09/2026 à 15:31 — Un rapport se supprime, fichier compris

Jusqu'ici, un rapport arrivé au mauvais endroit ne pouvait que se
**détacher** : il quittait la fiche, mais son fichier restait dans le
stockage sans que rien ne permette de l'enlever. Le détail d'un rapport
propose désormais un second geste, **« Supprimer définitivement »** : le
rapport quitte la fiche comme au détachement, et cette fois le fichier part
avec lui — dès lors qu'aucune autre participation ne s'en sert. Le mail
d'origine perd alors sa pièce jointe : il reste listé dans les Rapports
entrants avec le nom et le poids du fichier, mais il n'y a plus rien à
télécharger ni à retraiter. Le même geste est disponible depuis les
**Rapports entrants**, par la corbeille à côté de la croix sur la puce de la
participation.

Les deux gestes restent distincts, et la fenêtre de confirmation dit ce que
chacun emporte : **détacher** répare un mauvais rangement en laissant tout
rejouable, **supprimer** fait vraiment disparaître le fichier.

Au passage, un défaut silencieux est corrigé côté documents. Le même fichier
peut être rattaché à plusieurs sociétés à la fois — c'est le cas de tout
reporting reçu pour une boîte détenue par deux de nos organisations.
Supprimer ce document depuis une fiche effaçait jusqu'ici le fichier pour
**toutes** les autres, sans avertissement : la ligne restait, le
téléchargement ne donnait plus rien. Désormais un fichier n'est effacé que
lorsque plus aucune fiche ne le désigne.

> **🔧 Notes techniques**
>
> - Nouveau `convex/lib/documentBlobs.ts` : `releaseStorage(ctx, storageId,
>   { inboundEmailId })` supprime le blob **et** sa ligne `documentTexts`
>   seulement si le nouvel index `documents.by_storage` ne trouve plus de
>   ligne. Le mail source n'est pas compté comme détenteur : le `storageId`
>   de sa pièce jointe est remis à `undefined` au passage (nom et taille
>   conservés). Tout chemin de suppression l'appelle **après** avoir
>   supprimé sa propre ligne — plus jamais `ctx.storage.delete` en direct.
> - `documents:remove` et la cascade de `deals:remove` passent dessus : c'est
>   la correction du blanchiment silencieux des lignes sœurs du fan-out.
> - `convex/reportInbox.ts` : le corps de `detachCompany` devient
>   `removeReportForCompany(ctx, report, { deleteFiles })`, partagé avec la
>   nouvelle mutation `deleteReport`. Les deux font exactement le même
>   ménage (ligne `companyReports`, lignes `documents` de l'entité,
>   `kpiSnapshots` sourcés, fraîcheur, pointeur `companyIntelligence`,
>   correction de la ligne `inboundEmails`, entrée d'index sémantique) et ne
>   diffèrent que sur le sort des fichiers.
> - `sourceInbound` sort de `reportInbox.ts` vers `convex/lib/reportSource.ts`
>   pour être lisible aussi depuis `documents:remove`.
> - Front : `CompanyReportsSection.tsx` porte les deux boutons dans le pied du
>   détail d'un rapport, et `routes/app/all/reports.tsx` une seconde icône
>   (corbeille) à côté de la croix sur la puce de chaque participation. Les
>   deux surfaces partagent le même schéma — une seule fenêtre de
>   confirmation paramétrée par le mode, dont le texte dit ce que le geste
>   emporte.
> - 6 tests de régression ajoutés à `regression.reportDetach.test.ts`,
>   dont deux qui échouent sur l'ancien `documents:remove`.
> - Merge de `main` : la relance de la synthèse ajoutée par la v1.209.3 vit
>   désormais dans le corps partagé, donc une **suppression** rafraîchit la
>   note comme un détachement.

## v1.209.3 — 02/09/2026 à 15:19 — La note IA suit les corrections et les retraits

Deux situations laissaient la synthèse d'une société décrire autre chose que
ce que sa fiche affichait.

**Un rapport corrigé.** Un fondateur envoie son reporting, puis le renvoie
avec un chiffre rectifié. La fiche montrait bien la nouvelle version, mais
l'app classait l'envoi en « déjà reçu » : la note de santé continuait de
commenter la version périmée, et personne n'était prévenu. Un renvoi qui
change réellement quelque chose est désormais traité comme du neuf — la note
se met à jour et le récap part normalement. Un renvoi strictement identique,
lui, reste silencieux comme avant : pas de mail, pas d'analyse inutile.

**Un rapport détaché.** Retirer un rapport d'une société ne recalculait pas sa
note, qui continuait de décrire un rapport absent. Elle est maintenant
recalculée sur ce qui reste. Et si c'était le dernier, la fiche repasse
franchement à « aucune donnée » : plus de score orphelin dans la liste des
participations en face d'une fiche vide.

> **🔧 Notes techniques**
>
> - **Même cause que ALB-238, deux symptômes.** Le recalcul de la synthèse
>   était accroché à « une ligne `companyReports` a été créée », pas à « le
>   contenu a changé », et seulement du côté de l'ajout.
> - **Renvoi corrigé** : `reportStore.storeForCompany` renvoie désormais
>   `changed` en plus de `created`, calculé par `reportContentChanged` — qui
>   compare exactement ce que la fiche affiche et ce qui nourrit
>   `intelligence.getContext` (`headline`, `title`, `keyHighlights`,
>   `metrics`, `rawContent`). Hors comparaison : `processedAt`,
>   `pipelineVersion`, identifiants AgentMail, `inboundEmailId` — ils changent
>   à chaque renvoi sans changer ce que le report dit. Les cartes de métriques
>   sont comparées **clés triées** (l'extraction reconstruit l'objet à chaque
>   passage). `reportStore.run` bascule de `anyCreated` à `anyNews`.
> - **Détachement** : `reportInbox.detachCompany` planifie
>   `intelligence.runAnalysis`. Sur le dernier report, `runAnalysis` tombe sur
>   `no_data`, qui efface l'analyse — c'est ce qui vide la colonne Score IA,
>   laquelle lit `aiAnalysis` seule.
> - **Non régression** : `convex/regression.reportAnalysisTriggers.test.ts`
>   (8 cas). Contrôle négatif effectué dans les deux sens — les 5 cas de
>   correction échouent si `reportContentChanged` est neutralisé, le cas du
>   détachement échoue si la planification est retirée.
> - Docs : `KNOWN_ISSUES.md` § « Un report renvoyé n'est pas forcément un
>   doublon » (nouvelle) et § « Détacher un report » (sixième effet), règle
>   anti-pattern dans `CLAUDE.md` (déclencher sur le contenu, et respecter la
>   symétrie ajout/retrait), `TESTING.md` R21, R28d et compteur B11,
>   `docs/produit/04-participations.md`.
## v1.209.2 — 02/09/2026 à 15:10 — Corriger une garantie ne change plus son garant

Quand une société du groupe garantit l'emprunt d'une autre — le contrat
d'assurance-vie de CALTE qui garantit le prêt de la SCI Chapelle, par exemple —
ouvrir cette garantie depuis le Passif de l'emprunteuse pour y corriger un
détail **remplaçait le garant par la société de la page**. Le champ « Garant »
se rouvrait sur la société courante au lieu du garant réel, et un simple
enregistrement suffisait à déplacer la garantie, sans alerte ni trace.

Le champ affiche désormais le garant inscrit sur la garantie. Corriger un
montant, un rang ou une date ne touche plus à qui s'est porté garant.

C'est le cas de figure central du module — un actif détenu par une société qui
garantit l'emprunt d'une autre — et le seul écran depuis lequel une garantie se
corrige, donc la correction valait d'être faite avant toute saisie.

> **🔧 Notes techniques**
>
> - `GuaranteeDialog.tsx` initialisait onze champs depuis la ligne éditée et le
>   douzième (`pledgorOrg`) depuis l'`orgId` de la page. À la sauvegarde, ce
>   `pledgorOrgId` partait tel quel dans `guarantees:update` : réassignation
>   silencieuse, aucune erreur, aucune validation franchie.
> - Il **ne pouvait pas** faire mieux : `enrich()` (`convex/guarantees.ts`) ne
>   rendait que `pledgorOrgSlug`, un libellé, quand le `<Select>` a besoin de
>   l'id. La correction expose `pledgorOrgId` à côté du slug — comme
>   `subjectOrgId` juste au-dessus — puis le fait remonter dans
>   `EditableGuarantee` (`GuaranteeList.tsx`) et dans l'état du dialogue.
> - **Un test Convex** pin le contrat côté serveur (la moitié qui peut
>   régresser en silence) : sur la sûreté inter-sociétés de l'annexe, les deux
>   surfaces d'édition — fiche du prêt et Passif du garant — rendent bien
>   `pledgorOrgId`. Vérifié en le retirant : le test tombe. La préselection
>   elle-même se vérifie à la main (`TESTING.md` GG7), le repo n'ayant aucun
>   harnais de test de composant React et en introduire un pour ça aurait été
>   une infra entière non demandée.
> - Le patron `useState(orgId)` sur un champ éditable n'existait nulle part
>   ailleurs dans `src/` — défaut isolé, désormais consigné en anti-patron dans
>   `CLAUDE.md`.

## v1.209.1 — 02/09/2026 à 13:35 — Toute garantie est classée quelque part

Suite technique de la version précédente, sans effet visible. Le champ qui dit
dans quelle société une garantie est enregistrée devient **obligatoire** : il
n'existe plus de sûreté sans domicile, donc plus de sûreté que personne ne
peut lire.

> **🔧 Notes techniques**
>
> - `guarantees.orgId` passe de `v.optional(v.id('organizations'))` à
>   `v.id('organizations')` (`convex/schema.ts`). Il n'avait vécu optionnel
>   qu'une release, le temps du remplissage prévu par le purge-then-narrow.
> - **Le remplissage n'a rien eu à faire** : `backfillGuaranteeOrg:dryRun` en
>   prod a rendu `missing: 0`, la table `guarantees` étant encore vide (le
>   module a été déployé le jour même). Le fichier de migration est supprimé —
>   resserré, il ne peut plus rencontrer une ligne à remplir, et le garder
>   aurait demandé de museler `no-unnecessary-condition`. La trace de
>   l'opération vit dans `MIGRATIONS.md` § « Resserrement de
>   `guarantees.orgId` », avec la leçon : compter la donnée **avant** d'écrire
>   le filet, la prod étant lisible depuis la session.
> - `convex/guarantees.ts` : `partiesOf` prend l'org de dépôt en second
>   argument plutôt que dans l'objet, ce qui sépare enfin les orgs
>   **référencées** (lues sur le prêt et sur l'actif) de celle où la ligne est
>   classée. Les deux contrôles partagent `assertMemberOfAny` et ne diffèrent
>   plus que par la liste passée. Les branches qui toléraient un `orgId`
>   absent disparaissent — elles ne pouvaient plus rien tolérer.
> - Deux tests de plus : l'org de dépôt est bien celle demandée à la création,
>   et une édition qui réécrit **toutes** les parties ne la déplace pas.
## v1.209.0 — 02/09/2026 à 10:46 — Un reporting Parallel déclenche son analyse tout seul

Jusqu'ici, seul un reporting **reçu par email** relançait la synthèse IA de la
société. Un reporting publié sur le portail Parallel était bien récupéré,
rangé et affiché — mais il fallait aller cliquer « Relancer l'analyse » à la
main pour que la note de santé en tienne compte. En pratique, personne n'y
pensait, et la synthèse d'une société suivie via Parallel décrivait la
situation d'avant.

Désormais, une communication **nouvelle** sur le portail relance l'analyse de
la société concernée toute seule, exactement comme un reporting reçu par
email. Seules les sociétés dont l'émetteur a réellement publié sont
recalculées : une synchronisation qui ne ramène rien ne relance rien.

Deuxième correction, dans la foulée : **rattacher** une société à son émetteur
Parallel lance aussi son analyse immédiatement. Auparavant, une société
fraîchement rattachée devait attendre la publication suivante — parfois des
mois — pour être analysée une première fois.

Aucun email n'est envoyé dans ces deux cas : personne n'a rien transféré, il
n'y a personne à qui répondre. Le bouton « Relancer l'analyse » reste
disponible pour re-scorer après une modification à la main ou rejouer une
analyse en échec.

> **🔧 Notes techniques**
>
> - **Cause racine (ALB-238), pas un fil oublié.** `intelligence.runAnalysisBatch`
>   n'était planifié qu'en fin de pipeline mail (`reportStore.run`). Le pull
>   VASCO se terminait sur `vasco.replaceCommunicationsCache` sans aval. Le
>   plug ne pouvait pas être ajouté tel quel : la mutation **purge puis
>   réinsère** tout le lot de la paire (org, clientSlug), donc après le swap
>   toutes les lignes portent le même `fetchedAt` et plus rien ne distingue une
>   communication qui vient d'arriver d'une ancienne. Un webhook est un
>   événement, un pull est une photo.
> - **La détection vit dans le remplacement**, seul moment où « nouveau » est
>   connaissable : les `communicationId` sur le point d'être supprimés sont lus
>   avant le delete, le lot pullé est diffé contre eux, et
>   `scheduleAnalysisForIssuers` planifie **un `runAnalysis` par entité** liée à
>   un émetteur porteur d'une communication nouvelle (non archivées,
>   `clientSlug` respecté). Pas `runAnalysisBatch` : sa boucle séquentielle ne
>   sert qu'à envoyer l'accusé après ses analyses, et il n'y a pas de mail ici —
>   des jobs indépendants évitent en plus de tenir N appels LLM dans une seule
>   action au premier remplissage.
> - **`companies.setVascoLink` planifie aussi `runAnalysis`.** Le rattachement
>   se fait **depuis** le cache, donc au moment du lien tout le backlog de
>   l'entité est déjà « connu » et la détection ci-dessus ne se déclencherait
>   jamais dessus. Le lien est son propre déclencheur.
> - **Non régression** : `convex/regression.vascoAnalysis.test.ts` (6 cas) —
>   arrivée détectée, re-pull identique silencieux, périmètre limité aux
>   émetteurs qui ont publié, émetteur orphelin et entité archivée ignorés,
>   mémoire cloisonnée par `clientSlug`, rattachement déclencheur. Les tests
>   lisent la file `_scheduled_functions` sans l'exécuter (sinon appels LLM
>   réels).
> - Docs : `KNOWN_ISSUES.md` § « Communications → AI synthesis » réécrit (la
>   section affirmait « by design there is no auto-trigger »), règle
>   anti-pattern ajoutée dans `CLAUDE.md` (pull ⇒ mémoire du « déjà vu » avant
>   déclencheur), `TESTING.md` TP12b + IG9, `docs/produit/` 04 et 15.
> - **Hors périmètre, signalé** : une communication VASCO n'est toujours pas
>   une ligne `companyReports` (lue live par `pullCommunicationsForSynthesis`),
>   donc elle reste invisible pour la fraîcheur des reportings et les
>   notifications. Chantier séparé.
## v1.208.0 — 02/09/2026 à 09:14 — L'assistant passe sur le moteur GLM Flash

L'assistant de l'app change de moteur : il tourne désormais sur **GLM Flash**,
là où il utilisait jusqu'ici la génération Flash de DeepSeek. Le changement
est un choix d'outil, pas une évolution de l'app : mêmes accès à vos données,
mêmes outils, mêmes demandes de confirmation avant toute écriture, même
capacité à ingérer de longs documents.

Comme précédemment, le même moteur alimente aussi, en arrière-plan, la lecture
des reportings reçus par email, l'enrichissement des fiches sociétés,
l'identification de l'expéditeur d'un report et les synthèses de
participations. Si vous constatez une différence de qualité sur l'une de ces
lectures automatiques, c'est la première piste à regarder.

Le moteur reste déclaré sous sa forme « dernière version en date » : il suivra
donc automatiquement les prochaines versions de cette génération, sans
intervention de notre part.

> **🔧 Notes techniques**
>
> - `convex/lib/instructions.ts` : `AGENT_MODEL` par défaut passe de
>   `~deepseek/deepseek-v4-flash-latest` à `~z-ai/glm-flash-latest`. Source
>   unique inchangée, toujours surchargeable par la var d'env Convex
>   `OPENROUTER_MODEL`. Aucune autre logique touchée — `getModel()`
>   (`convex/agent.ts`) et ses cinq consommateurs (`reportStore`,
>   `companyEnrichment`, `reportIdentify`, `intelligence`,
>   `migrations/alboDocBackfill`) héritent du changement.
> - Slug retenu : l'**alias** OpenRouter préfixé `~`, qui redirige aujourd'hui
>   vers `z-ai/glm-5.3-flash` — 1,31 M tokens de contexte (identique à
>   l'ancien), `tools` + `structured_outputs` supportés, donc `generateObject`
>   et l'approbation d'outils fonctionnent à l'identique.
> - Coût : 0,075 $/M en entrée et 0,25 $/M en sortie, contre 0,05 / 0,16 pour
>   DeepSeek V4 Flash — soit ~1,5× plus cher, ce qui reste marginal à notre
>   volume. Le cache de préfixe reste automatique côté fournisseur
>   (`input_cache_read` à 0,015 $/M), sans clé à injecter : le wrapper `fetch`
>   supprimé à l'époque de Mistral n'a pas à revenir.
> - Wording du system prompt corrigé (« You run on the GLM model … ») et
>   commentaire d'en-tête de `convex/agent.ts` mis à jour. `KNOWN_ISSUES.md`
>   § « Modèle de l'agent » retitré (OpenRouter / GLM) ; défaut mis à jour
>   dans `CLAUDE.md`, `.env.example` et `TESTING.md`.
> - ⚠️ Le code ne porte que le **défaut**. Si `OPENROUTER_MODEL` est posé sur
>   le déploiement prod, c'est lui qui gagne : le basculement effectif demande
>   `pnpm exec convex env set --prod OPENROUTER_MODEL "~z-ai/glm-flash-latest"`
>   (ou la suppression de la variable pour retomber sur le défaut du code).
> - Claim périmé nettoyé au passage : la liste « Trade-offs vs
>   PROJECT_BRIEF.md » de `KNOWN_ISSUES.md` annonçait encore
>   `deepseek/deepseek-v4-pro` comme défaut de l'agent (faux depuis la bascule
>   Flash de la v1.192.0). Elle ne répète plus la valeur — elle renvoie à
>   `AGENT_MODEL` et au § « Modèle de l'agent », donc elle ne peut plus
>   dériver.

## v1.207.1 — 02/09/2026 à 08:51 — Les étiquettes ne se chevauchent plus

Dans le tiroir des documents d'une société, l'étiquette bleue « Deal · … »
passait par-dessus le compteur de caractères et les icônes de droite quand
le nom du deal était un peu long. La faute à des étiquettes qui refusaient
de rétrécir ou de passer à la ligne : faute de place, elles débordaient
simplement sur ce qu'il y avait à côté.

- Dans le tiroir des documents, l'étiquette du deal **passe à la ligne**
  sous le titre plutôt que de recouvrir les actions, et s'abrège avec des
  points de suspension si le nom du deal est très long (le nom entier reste
  lisible au survol).
- Même correction sur les deux autres endroits où le même défaut existait
  sans avoir encore été repéré : l'étiquette de société d'une tâche de la
  page **À faire**, et l'étiquette « + autres sociétés ? » des reports
  entrants dans la vue consolidée.

Le reste de l'application a été passé en revue pour ce défaut précis : les
autres écrans étaient déjà corrects. Un point de vigilance reste ouvert, non
corrigé ici parce qu'il touche la largeur des colonnes : dans la liste
Entreprises en vue consolidée, la colonne des sociétés du groupe est étroite
et un nom long (« Relais Chapelle ») peut mordre sur la colonne voisine.

> **🔧 Notes techniques**
>
> - Cause commune : `Badge` et `Button` (`src/components/ui/*`) portent
>   `shrink-0` + `whitespace-nowrap` dans leur variante de base. Dans une
>   ligne flex contrainte ils ne rétrécissent ni ne passent à la ligne, et
>   rien ne les rogne — ils débordent en silence sur le voisin. Le symptôme
>   n'apparaît que si le badge porte une **donnée non bornée** (nom de
>   société, d'org, libellé de deal), d'où son caractère intermittent.
> - `DocumentAttachment.tsx` : `flex-wrap` sur la ligne titre + badges.
>   `CompanyDocumentsCard.tsx` : badge deal en `max-w-full` + `truncate` +
>   `title`. Le plafond **`max-w-full`, pas une valeur fixe** — mesuré dans
>   le sheet (`sm:max-w-lg`), `max-w-[16rem]` laissait encore 80 px de
>   débordement, `max-w-full` tombe à 0.
> - Même patron appliqué à `todo.tsx` (badge société) et à
>   `all/reports.tsx` (badge « + orgs ? », qui était le seul de sa cellule
>   sans plafond alors que ses voisins en avaient un).
> - Vérification : réplique DOM des cartes rendue dans Chromium avec le CSS
>   Tailwind du projet, débordement mesuré au pixel (106 px avant → 0 après)
>   plutôt que constaté à l'œil.
> - Règle ajoutée aux anti-patterns de `CLAUDE.md` ; ligne TP10c de
>   `TESTING.md` complétée.

## v1.207.0 — 01/09/2026 à 16:51 — La documentation d'Albo OS se lit dans Albo OS

Il existait déjà une documentation produit complète — vingt pages qui
expliquent, fonctionnalité par fonctionnalité, ce que l'outil sait faire.
Elle n'était lisible que sur GitHub ou dans Linear, c'est-à-dire nulle part
quand on est en train de s'en servir.

- Un menu **Documentation** apparaît en bas de la barre latérale, à côté de
  Nouveautés. Il ouvre le sommaire, et la liste des vingt pages reste
  affichée à gauche pendant la lecture.
- Les liens entre pages naviguent **dans l'application** : cliquer « Deals »
  depuis la page Participations ouvre la page Deals, sans partir sur GitHub.
- Chaque page a sa propre adresse, donc se met en favori et se partage.
- Ce n'est pas une copie : la page affichée **est** le fichier du dépôt. Une
  documentation corrigée dans une PR est à jour dans l'app au déploiement
  suivant, sans recopie possible à oublier.

Au passage, l'audit qui a précédé a corrigé trois inexactitudes : la page des
métriques ne disait pas qu'un deal **annulé** ne porte ni multiple ni TVPI ni
TRI, la vue consolidée décrivait trois actions sur les reports entrants au
lieu de cinq, et la page « À faire » annonçait sept blocs pour en détailler
huit.

> **🔧 Notes techniques**
>
> - Routes `src/routes/app/$orgSlug/docs.tsx` (layout + sommaire latéral),
>   `docs.index.tsx` (rend `README.md`) et `docs.$page.tsx` (`beforeLoad`
>   lève `notFound()` sur un slug inconnu, `head()` titre la page).
> - `src/lib/produitDocs.ts` : `import.meta.glob<string>('../../docs/produit/*.md',
>   { query: '?raw', eager: true })`. Le dossier est **globbé**, pas listé —
>   une page ajoutée apparaît au build suivant sans inscription nulle part.
>   Slug = nom de fichier, titre = H1, ordre = numérotation des fichiers.
> - `src/components/docs/markdown.tsx` : la table de composants markdown est
>   sortie de `changelog.tsx` (déplacement pur, rendu du changelog inchangé)
>   et partagée. `DocMarkdown.tsx` la surcharge pour les tableaux GFM et pour
>   les liens : `NN-slug.md` → `Link` vers la route interne, `README.md` →
>   sommaire, `../../CHANGELOG_PRODUIT.md` → `/changelog`, cible inconnue →
>   texte simple (même règle que le miroir Linear). Les 171 liens du dossier
>   résolvent.
> - Corrections de l'audit : `docs/produit/06-valorisations-et-kpis.md`
>   (statut `cancelled`, cf. `convex/lib/metrics.ts:isTerminalStatus`),
>   `12-vue-consolidee.md` (la duplication du circuit reports est remplacée
>   par un renvoi vers `17-reports-par-email.md`, qui fait foi),
>   `16-a-faire.md` (« sept » → « huit » blocs). `CLAUDE.md` : l'assistant
>   passe de « ~50 outils / 8 fichiers » à « ~65 / 10 » — `agentToolsDebt.ts`
>   et `agentToolsIntelligence.ts` manquaient à l'énumération.
> - `TESTING.md` : SH24.

## v1.206.1 — 31/08/2026 à 19:15 — Le mail d'accusé de réception redevient lisible

Quand un report est rangé, l'email de confirmation reprend la synthèse de la
fiche : le score, les points forts et de vigilance, et trois tuiles de KPI.
Chez certains clients mail, cette partie arrivait cassée — le texte d'une
tuile se superposait à la ligne du dessous, les puces et les deux colonnes
ne démarraient pas à la même hauteur.

- Les tuiles n'ont plus de hauteur imposée : un libellé long s'affiche en
  entier, dans une taille adaptée à sa longueur, sans jamais recouvrir ce
  qui suit.
- Les trois tuiles gardent une hauteur commune, quel que soit leur contenu.
- Les puces et les colonnes « Points forts » / « Points de vigilance »
  s'alignent en haut dans tous les clients mail.
- Les KPI de la synthèse sont désormais des valeurs courtes et chiffrées,
  comme prévu au départ : le détail passe dans la ligne de contexte, plus
  dans le gros chiffre.

> **🔧 Notes techniques**
>
> - `convex/emailTemplates.ts` : `insightTile` devient `insightCell` et rend
>   un `<td>` bordé au lieu d'une table imbriquée — les cellules d'une même
>   ligne partagent sa hauteur, ce que les `height:14/28/24px` (+
>   `overflow:hidden`) tentaient d'obtenir et qui débordait dès qu'une valeur
>   passait sur deux lignes. Nouvelle fonction `valueFontSize` (21/17/15px
>   selon la longueur), gouttières en cellules vides.
> - Tous les `valign=` des blocs du mail report sont doublés d'un
>   `style="vertical-align:…"` : certains clients strippent l'attribut, la
>   cellule retombe alors sur `middle` — d'où les puces et la colonne
>   « vigilance » décalées d'une demi-ligne.
> - `convex/lib/reportPrompts.ts` : `top_insights.current_value` borné à
>   12 caractères (une valeur, pas une phrase), `label` à 2-3 mots, le détail
>   renvoyé dans `context`.
> - `tests/reportEmail.test.ts` (nouveau, `pnpm test:unit`) : rendu avec des
>   textes longs, aucune hauteur fixe, aucun `valign` sans CSS équivalent.
>   Piège documenté dans `KNOWN_ISSUES.md` § « HTML email : ni hauteur fixe,
>   ni `valign` seul ».

## v1.206.0 — 31/08/2026 à 18:37 — La garantie qu'un tiers donne sur la même dette

Quand on garantit l'emprunt de quelqu'un d'extérieur au groupe, on n'est
souvent pas le seul à le faire. Sur les 1,15 M€ empruntés par la SARL
Bremontier, CALTE a nanti 500 000 € sur son contrat Concerto Capi — et un
tiers a nanti autant sur une assurance-vie à lui. Cette seconde sûreté ne
touche rien de chez nous : ni notre prêt, ni notre actif, ni notre société.
L'app la refusait donc, et on lisait notre gage comme la seule sûreté du
créancier.

Elle se saisit désormais, dans l'espace où on la constate, et elle s'affiche
en sous-ligne sous notre propre garantie sur la même dette : « autre sûreté
sur cette dette : … ». Si aucune garantie de chez nous ne porte sur cet
emprunteur, elle apparaît seule, badgée « sûreté d'un tiers » avec le nom du
garant — rien ne disparaît faute de ligne à qui s'accrocher.

Le bloc **Garanties données**, en bas de la page Passif, gagne au passage un
bouton **Ajouter** et un menu **⋯** par ligne (modifier, mainlevée,
supprimer). C'était le trou : une garantie donnée hors groupe ne pend à
aucune fiche de prêt, donc elle n'avait aucun endroit d'où être créée ni
corrigée — et une société sans aucun prêt ne pouvait enregistrer aucune
garantie du tout.

Les garanties qui couvrent un prêt du groupe ne sont pas reprises dans ce
bloc : la fiche du prêt les liste déjà, et elles ne disent rien de ce que
cette société a **donné**.

> **🔧 Notes techniques**
>
> - `guarantees.orgId` (optionnel + index `by_org`, `convex/schema.ts`) : la
>   société qui **enregistre** la sûreté, pas une quatrième partie. Elle
>   ancre la ligne du cas 10b de `SPEC.md` § 10, qui n'a ni `loanId`, ni
>   `pledgorOrgId`, ni `subjectOrgId` et tombait donc sur `not_a_party`.
> - `requireGuaranteeParty` inclut `orgId` dans ses parties (lecture).
>   L'écriture passe par `requireCanFile` : `requireOrgMember(orgId)` **et**
>   au moins une org de chez nous parmi les orgs **référencées** (lues sur le
>   prêt et sur l'actif, jamais sur un argument) — sauf quand il n'y en a
>   aucune, le cas 10b. Sans le second contrôle, un membre de `calte`
>   pourrait accrocher une ligne au prêt et à l'actif de `sci-upload`.
>   `update` ne patche pas `orgId` : une sûreté ne déménage pas.
> - `guarantees:listByPledgorOrg` lit `by_pledgor_org` (nos sûretés) **et**
>   `by_org` (ce que l'org a classé sans le donner). Les secondes s'accrochent
>   en `otherSecurities` sous **la première** de nos sûretés portant le même
>   `borrowerLabel` normalisé ; celles sans correspondance remontent en ligne
>   à part (`isOwnPledge: false`). Les sûretés sur un prêt du groupe sont
>   exclues (la fiche du prêt les liste déjà).
> - Front : `GuaranteesGivenSection` prend l'`orgId`, ouvre `GuaranteeDialog`
>   en création et en édition (nouveau type `EditableGuarantee` dans
>   `GuaranteeList.tsx`, satisfait par les deux formes de ligne), et rend les
>   sous-lignes. `GuaranteeDialog` envoie l'`orgId` de la page à la création.
> - Côté agent : `createGuaranteeInternal` écrit l'`orgId` du thread, et
>   `listGuaranteesInternal` lit aussi `by_org`.
> - `convex/migrations/backfillGuaranteeOrg.ts` (`dryRun` / `apply` /
>   `verify`, idempotent) remplit le champ depuis `pledgorOrgId` →
>   `borrowerOrgId` → `subjectOrgId`. **Étape 1 d'un purge-then-narrow** : le
>   champ ne devient requis qu'après le passage en prod (`verify` à
>   `clean: true`). Une ligne sans aucune des trois parties est signalée, pas
>   rangée au hasard.
> - Tests : 4 cas de plus dans `convex/regression.guarantees.test.ts` (sûreté
>   sans partie acceptée, passif d'un inconnu refusé, co-sûreté accrochée une
>   seule fois, co-sûreté orpheline listée seule, prêt du groupe non repris).

## v1.205.0 — 31/08/2026 à 16:25 — Six informations que les fiches savaient sans les dire

Suite de l'audit du module Dette & Garanties. Ici, rien n'était faux : c'était
de l'information que l'application possédait déjà et n'affichait nulle part.

**La liste des prêts dit maintenant ce qui les garantit.** Chaque ligne du
bloc Dette bancaire porte un badge par sûreté active — Nantissement, PPD,
Caution — de la plus forte à la moins forte. Une sûreté levée ne badge plus :
elle ne couvre plus rien. Toujours aucun montant gagé dans la colonne de
droite, qui ne contient que du restant dû.

**La fiche d'un bien dit ce qu'il reste à devoir sur le prêt qu'il garantit.**
Une sûreté seule ne dit rien de l'exposition : c'est la dette qu'elle couvre
qui la porte. Le bloc « Emprunt lié & sûreté » affiche donc le restant dû et
l'échéance finale du prêt.

**Un placement mis en gage le dit dans son en-tête**, par un badge « Nanti ».
Un seul mot, parce que c'est le fait qui change l'usage possible du contrat ;
les montants restent dans le bloc « Nantissements » plus bas.

**Le % de détention d'une filiale vient enfin d'un seul endroit.** Sur la
fiche d'une société du groupe vue depuis CALTE, le pourcentage affiché est
celui saisi dans la table de capitalisation de la filiale, avec un lien vers
sa page Passif. L'application calculait jusqu'ici un second pourcentage à
partir du nombre d'actions — une approximation qui pouvait diverger du
chiffre officiel sans que rien ne dise lequel avait raison.

**On peut détacher une transaction depuis la fiche d'un prêt ou d'un bien.**
Un prélèvement pointé sur le mauvais prêt se corrigeait jusqu'ici uniquement
depuis le registre de Trésorerie. La fiche **défait** un pointage, elle n'en
fait jamais : détacher renvoie le mouvement dans la file, où vous choisissez
sa cible.

**Un loyer qui cesse de tomber remonte dans « À faire ».** Un bien qui
encaissait un loyer chaque mois et pour lequel le mois dernier rien n'est
arrivé apparaît dans un nouveau bloc. Deux limites assumées, qui évitent un
signal qui crie pour rien : le **mois en cours n'est jamais jugé** — un loyer
du 5 n'est pas en retard le 2 — et un bien **jamais loué** n'apparaît pas,
puisqu'il n'y a pas d'habitude à comparer.

> **🔧 Notes techniques**
>
> - **Badge de sûreté** : `loans:list` renvoie `guaranteeForms`, les formes
>   des garanties actives d'un prêt, dédupliquées et triées par
>   `sortByStrength`. Jamais `pledgedAmountCents` — un test l'assure en
>   vérifiant qu'aucun montant gagé ne voyage dans la ligne (D44).
> - **Restant dû du prêt lié** : `guarantees:listBySubjectProperty` renvoie
>   `loanOutstandingCents` et `loanLastPaymentDate`, tirés d'un **seul**
>   échéancier (`summarize` rend la paire). Piège traité : un révolving n'a
>   pas d'échéance finale, et son échéancier est borné par l'appelant —
>   `summarize` aurait rapporté l'horizon passé en argument comme si c'était
>   la dernière échéance. Le champ ne vaut donc que `loan.endDate` sur ce type.
> - **% de détention (D33)** : `liabilities:getOwnershipForCompany` existait,
>   testée, et n'était appelée par aucun écran. Branchée sur
>   `participations.$companyId.tsx` ; quand elle répond, elle **remplace** le
>   ratio actions/total plutôt que de s'afficher à côté. `docs/produit/10`
>   affirmait déjà que « côté détenteur, l'application lit ce pourcentage » :
>   la doc était en avance sur le code, elle est maintenant vraie.
> - **Détacher** : bouton par ligne appelant `liabilities:deallocateTransaction`
>   sur les deux fiches. Écart assumé avec le plan, qui annonçait un panneau
>   de réaffectation façon fiche deal : la page Passif a déjà cette convention
>   pour ce geste sur cette mutation, et la fiche prêt en est la voisine
>   directe. Un second patron pour le même geste aurait coûté un concept de
>   plus ; le registre de Trésorerie garde la réaffectation directe.
> - **Signal loyer** : dérivé dans `todo:getTodo`, sans nouveau champ. Fenêtre
>   décalée d'un cran (M−1 vide, M−2/M−3/M−4 servis) et comparaison par index
>   de mois absolu (`année × 12 + mois`, UTC) pour traverser décembre. Cinq
>   tests couvrent le cas nominal, le mois courant non jugé, le bien jamais
>   loué, et le fait qu'une charge n'est pas un loyer. Voir `KNOWN_ISSUES.md`
>   « Un signal dérivé sans référentiel ».
## v1.204.0 — 31/08/2026 à 16:00 — Ranger ses actes avec ses prêts et ses biens

Le module Dette & Garanties savait tout stocker sauf le papier. Un prêt, un
bien et une garantie affichaient bien une section « Documents » — mais sans
aucun moyen d'y déposer quoi que ce soit, elle restait vide à jamais.
C'est réparé : **on peut désormais rattacher des fichiers aux trois**.

**Sur un prêt** — l'offre de prêt, le tableau d'amortissement de la banque,
l'acte. La section Documents de la fiche accepte maintenant les dépôts, et
liste ce qui est là avec sa date et son poids.

**Sur un bien** — l'acte de vente, le compromis, les devis de travaux.

**Sur une garantie** — l'acte de nantissement, l'inscription d'hypothèque,
l'acte de caution. On y accède par le menu ⋯ de la garantie, sur la fiche du
prêt. Ce choix est délibéré : une liste de sûretés se lit pour comparer des
montants et des rangs, et une zone de dépôt sous chaque ligne aurait enterré
cette lecture.

Chaque fichier peut porter un **type** (acte de prêt, acte de garantie,
juridique, autre) et une **date**, se renommer, s'ouvrir d'un clic et se
supprimer. Comme ailleurs dans l'application, la limite est de 20 Mo par
fichier, et le contenu des PDF est lu automatiquement pour que l'assistant
puisse le retrouver.

Un point à connaître : ces documents n'apparaissent **pas** sur la fiche
d'une société du portefeuille. C'est voulu — un acte de prêt n'a pas de
société-cible, il appartient à son prêt. On le retrouve depuis sa fiche
d'origine et par la recherche.

> **🔧 Notes techniques**
>
> - Nouveau composant partagé `src/components/documents/DocumentsSection.tsx`,
>   branché sur la fiche prêt, la fiche bien et — via un dialog ouvert depuis
>   le ⋯ d'une garantie — `LoanGuaranteesSection`. Il prend une `anchor`
>   discriminée (`loan` / `property` / `guarantee`) et **jamais un `orgId`** :
>   `documents:create` résout l'org depuis l'ancre présente, une org fournie
>   par l'appelant serait un trou de tenancy.
> - Délibérément plus maigre que la surface documents de la fiche société
>   (`CompanyDocumentsCard` + `AddDocumentDialog`), qu'il n'étend pas : pas de
>   recherche, pas de regroupement par type, pas de sélection multiple. Une
>   société de portefeuille accumule des dizaines de pièces ; un prêt porte une
>   offre et un tableau. Un filtre sur quatre lignes est du mobilier. Si un
>   prêt se met un jour à en accumuler autant, il faudra adopter cette
>   surface-là plutôt que faire grossir celle-ci jusqu'à la recopier.
> - L'appelant possède la query et passe `docs` : les trois ancres ont trois
>   queries différentes, et un hook ne peut pas être appelé par ligne de liste
>   (le cas garantie en rend un par garantie). Côté garantie, `skip` tant que
>   le dialog est fermé.
> - `documents:listByGuarantee` renvoyait une projection plus pauvre que ses
>   deux jumelles (ni `period`, ni `size`, ni `contentType`, ni l'état de
>   lecture). Alignée sur `listByLoan` — les trois alimentent le même
>   composant, et un champ manquant sur l'une est un champ inutilisable sur
>   les trois. Un test compare désormais les jeux de clés des trois.
> - Nouveau namespace i18n `documents` (en + fr), et retrait des clés
>   `passif:loan.documents` / `immobilier:sheet.documents` que le composant
>   partagé rend orphelines.
> - `convex/regression.docOptionalCompany.test.ts` couvre maintenant les trois
>   ancres : un bien et une garantie en sont, aucune des lignes ne porte de
>   `companyId`, et les trois projections sont identiques.
## v1.203.2 — 31/08/2026 à 16:12 — Trois chiffres remis d'aplomb sur la dette

Un audit à froid du module Dette & Garanties a fait remonter trois endroits
où l'application affichait ou protégeait mal un chiffre. Aucun n'était
visible à l'œil nu, et c'est bien le problème.

**Le ballon d'un prêt in fine ne peut plus disparaître.** Un prêt in fine
dont le différé couvrait toute la durée produisait un échéancier fait
uniquement d'intérêts : aucun remboursement de capital, un restant dû figé
au montant emprunté même après le terme, et surtout **aucune trace du
capital dans le prévisionnel de trésorerie**. Sur un in fine de 6,6 M€, la
somme n'apparaissait nulle part avant de tomber. La saisie refuse désormais
un différé aussi long que la durée — pour les quatre types de prêt, sans
exception — et un prêt déjà enregistré de cette façon retrouve son ballon
tout seul à la lecture.

**Un placement mis en gage ne se supprime plus en silence.** Supprimer un
contrat nanti laissait la garantie qui s'appuyait dessus sans assiette : plus
de libellé, plus de valeur à laquelle comparer la marge disponible. La
suppression est maintenant refusée tant qu'une garantie pointe sur le
placement — y compris une garantie déjà levée, dont l'historique a lui aussi
besoin de son assiette pour se lire. Les prêts et les biens étaient déjà
protégés ainsi ; le placement ne l'était pas.

**L'échéancier ne prétend plus au centime près.** Les colonnes du plan
(mensualité, capital, intérêts, assurance, restant dû) s'affichent désormais
arrondies à l'euro, tandis que la colonne Réel reste au centime. Le plan est
un calcul, le réel est un relevé bancaire : les afficher avec la même
précision invitait à comparer au centime deux chiffres qui ne mesurent pas la
même chose, et donnait envie de « corriger » un écart parfaitement normal —
celui de l'assurance.

> **🔧 Notes techniques**
>
> - **Ballon in fine** : `assertValidTerms` (`convex/loans.ts`) n'exempte plus
>   `amortizationKind === 'bullet'` du contrôle `deferral >= durationMonths`,
>   et `buildSchedule` (`convex/lib/amortization.ts`) clampe `deferralPeriods`
>   à `totalPeriods − 1` pour tous les types. Les deux sont nécessaires : la
>   validation ferme la saisie, le clamp répare la donnée déjà stockée (une
>   query ne doit jamais lever). Le clamp exemptait le `bullet` au motif qu'un
>   in fine est déjà « intérêts seuls » — mais la période supprimée était
>   celle qui porte le ballon. Tests : `tests/amortization.test.ts` (le ballon
>   survit au différé total) + `convex/regression.loans.test.ts` (la mutation
>   refuse). `KNOWN_ISSUES.md` décrivait déjà le comportement corrigé : c'est
>   la doc qui avait raison, pas le code.
> - **C12** : `deals:remove` (`convex/deals.ts`) interroge l'index
>   `by_subject_deal` de `guarantees` et lève `is_pledged`. Le garde-fou
>   ignore `releasedAt` volontairement, comme ses jumeaux `loans:remove` et
>   `properties:remove`. Surfacé dans `deals.$dealId.tsx` via la table
>   d'erreurs existante. Nouvelle section `KNOWN_ISSUES.md` et nouvel
>   anti-pattern `CLAUDE.md` sur la vraie cause : le garde-fou vit dans le
>   fichier de l'objet référencé, jamais dans celui de la table qu'on écrit.
> - **Arrondis** : les colonnes de plan de l'échéancier passent de
>   `fmtEurCents` à `fmtEur` (`passif.prets.$loanId.tsx`), conformément à
>   § 5.4 « l'actuel au centime, l'estimé arrondi ». Colonne Réel, table des
>   transactions et total versé restent au centime.
> - **Hygiène** : `modules:list` mémoïse la lecture des deals de l'org (les
>   sondes `entreprises`, `placements` et `investments` la relisaient quatre
>   fois par chargement de page) ; commentaire corrigé sur
>   `properties:getById`, qui annonçait renvoyer les sûretés du bien alors
>   qu'elles se lisent depuis `guarantees:listBySubjectProperty`.
> - **SPEC § 12.5** assume désormais **deux** exceptions au non-stockage —
>   l'encours d'un révolving et `loanAmendments.outstandingCents` — avec le
>   critère qui les autorise : un fait extérieur constaté, jamais un calcul
>   qu'on préfère figer.
## v1.203.1 — 31/08/2026 à 15:54 — Une barre de recherche pour rattacher un report

Dans les Rapports entrants, rattacher un mail à une participation passait par
une liste déroulante qui affichait tout le portefeuille de toutes vos
organisations, à faire défiler jusqu'à la bonne ligne. Le sélecteur devient un
champ de recherche : tapez les premières lettres du nom de la participation ou
de son organisation, la liste se filtre à la frappe, Entrée valide. Le reste ne
bouge pas — les fiches du même domaine dans une autre organisation restent
proposées en cases à cocher sous le choix, et « Rattacher et traiter » reste le
geste final.

> **🔧 Notes techniques**
>
> - `src/routes/app/all/reports.tsx` : le `Select` shadcn de la modale
>   d'attachement est remplacé par un combobox `TargetCombobox` local
>   (Popover + Command/cmdk), sur le même patron que `CompanyCombobox`
>   (`deals.$dealId.tsx`) et `DealCombobox` — un combobox de ce type tourne
>   déjà dans une `Dialog` ailleurs dans l'app.
> - La valeur `cmdk` de chaque item concatène nom + organisation +
>   `companyId`, pour que la recherche porte sur les deux libellés et que
>   deux orgs détenant une société homonyme restent distinctes.
> - Comportement inchangé : choisir une participation réinitialise les cases
>   « même domaine, autre organisation », et `assignCompany` est appelée à
>   l'identique.
> - Deux clés i18n ajoutées (`assignDialog.search`, `assignDialog.empty`) en
>   `fr` et `en` ; `docs/produit/17-reports-par-email.md` mis à jour.

---

## v1.203.0 — 31/08/2026 à 15:17 — Les documents quittent le fil des rapports

Sur une fiche société, tout vivait dans une seule liste : les rapports reçus,
les communications des plateformes et les documents déposés, mélangés du plus
récent au plus ancien. Ça se lisait bien sur une boîte à deux documents. Sur
Hectarea, qui en compte trente-six déposés le même jour, le rapport de board
disparaissait au milieu des pactes et des PV d'assemblée — et trier par date
ne servait à rien, puisque tout était arrivé ensemble.

**Deux endroits, deux usages.** La colonne principale ne porte plus que ce que
la société nous envoie : les **rapports** et les **communications** des
plateformes, dans l'ordre. Les documents, eux, remontent dans le panneau de
droite, dans une carte **Documents** placée sous la fiche d'identité — avec
leur nombre, les cinq plus récents et un bouton pour en ajouter. Un rapport se
lit dans l'ordre, une fois, quand il arrive ; un document se cherche par
nature, longtemps après, parce qu'il faut signer ou voter. Ce ne sont pas les
mêmes gestes.

**Un vrai coffre, avec une recherche.** « Voir les N documents » ouvre un
tiroir latéral qui montre enfin la bibliothèque complète : une **recherche par
titre** — elle n'existait nulle part jusqu'ici, et c'est ce qui manquait le
plus au-delà de vingt documents —, des **filtres par type** qui ne proposent
que ce qui est réellement présent, et les documents **regroupés par type**
plutôt qu'empilés par date. Les titres longs y sont enfin lisibles en entier.

**Deux portes d'ajout au lieu d'une.** Le bouton de la section rapports dit
« Ajouter un rapport » et lance l'analyse ; le **+** de la carte Documents
dépose simplement le fichier. Le type reste modifiable dans les deux cas — on
peut toujours changer d'avis en cours de route —, mais la porte qu'on pousse
dit désormais ce qu'on dépose. C'est ce qui manquait : quelques pièces
juridiques étaient parties dans le circuit d'analyse sans que personne ne
touche au menu déroulant.

**La fiche deal perd son bloc Documents.** Il n'a jamais servi : aucun
document du portefeuille n'y avait été déposé, et tout est classé au niveau de
la société. Un document rattaché à un deal reste visible sur la fiche de la
société, badgé au nom du deal, comme avant.

> **🔧 Notes techniques**
>
> - `CompanyTimelineSection.tsx` → `CompanyReportsSection.tsx` : les entrées
>   `type: 'doc'` et le filtre par type sortent du fil, qui ne porte plus que
>   les rapports et les communications VASCO. Les pièces jointes d'un rapport
>   (`reportId`) restent repliées dans sa ligne.
> - Nouveau `CompanyDocumentsCard.tsx` : la carte du panneau de droite, son
>   tiroir (`Sheet` shadcn, recherche + filtres + groupes par `kind`, tous
>   côté client sur la liste déjà chargée) et les dialogues d'édition /
>   suppression / texte extrait, déplacés depuis la timeline.
> - `AddDocumentDialog.tsx` extrait et partagé par les deux portes, avec une
>   prop `defaultKind` (`reporting` / `legal`) ; le sélecteur des 8 types reste
>   entier des deux côtés, et le titre du dialogue suit le type courant.
> - `documentFields.tsx` : vocabulaire des types, conversions de dates,
>   `KindSelect` / `DealSelect` / `useDealLabel`, partagés par les deux.
> - `participations.$companyId.tsx` : l'`<aside>` devient un conteneur de deux
>   cartes (identité, puis documents) au lieu d'être lui-même la carte. Le
>   collant (`useStickyBottom`) et le `lg:items-start` du parent sont
>   inchangés — cf. `KNOWN_ISSUES.md` § « Panneau latéral figé ».
> - Fiche deal : `DealDocumentsSection.tsx` supprimé (425 lignes), avec la
>   query `documents.listByDeal` devenue sans appelant et le bloc i18n
>   `participations:dealDocuments.*`. L'index `by_deal` reste utilisé par les
>   transactions, le prévisionnel et les projections.
> - i18n : `participations:timeline.*` ne garde que les clés du fil de
>   rapports, tout le reste passe sous `participations:documents.*` (fr + en).
> - Le pourquoi de la re-séparation, ses trois invariants et la cascade de
>   suppression d'un deal sont dans `KNOWN_ISSUES.md` § « Documents &
>   rapports : deux surfaces ».
## v1.202.0 — 31/08/2026 à 15:09 — Le point hebdo du lundi raconte enfin la semaine

Le mail du lundi matin se contentait d'annoncer « 3 reports rangés cette
semaine » : un compteur, aucune idée de quelles boîtes avaient donné de
leurs nouvelles ni de ce qu'elles disaient. Il reprend maintenant la forme
du mail qu'on reçoit après avoir transféré un report.

**Un mail par famille, plus un mail fourre-tout.** Albo reçoit le sien,
Calte et ses filiales le leur — deux bilans ne se mélangent plus dans le
même email. Une famille qui n'a rien à signaler n'envoie rien ; l'objet
porte le nom de la famille (« Point hebdo Calte — 4 reports rangés »).

**Les reports de la semaine, une carte par société.** Logo, nom cliquable
vers la fiche, période couverte, la note de santé de la boîte (la même que
sur sa fiche) et les deux points clés du report. Au-delà de six sociétés
dans une même organisation, le reste se compte en « + N autres ».

**Le reste du mail passe au même format.** La trésorerie devient une carte
avec le montant projeté en évidence et le seuil en dessous ; les échéances
en retard, une liste à puces en vrac jusqu'ici, deviennent un tableau
lisible — date, libellé, montant aligné à droite, en rouge ou en vert selon
le sens.

Rien ne change côté réglages : chacun choisit toujours les trois morceaux
qu'il veut recevoir depuis Réglages → Membres, et qui coupe tout ne reçoit
toujours rien.

> **🔧 Notes techniques**
>
> - `convex/lib/weeklyDigest.ts` : `familyOf(slug)` route une org vers son
>   mail (`albo` seule, tout le reste avec `calte`) et `digestsFor()`
>   remplace `sectionsFor()` comme cœur testable — elle rend 0 à 2 digests
>   par membre. « Tout le reste » plutôt qu'une liste figée des 7 slugs de
>   filiales : les orgs sont à plat, rien au schéma ne dit qui est filiale de
>   qui, et une liste ferait disparaître une 8e filiale du point hebdo au
>   lieu de la mettre dans le mail CALTE.
> - `convex/emailTemplates.ts` : `weeklyDigestEmail()` prend un `familyName`
>   et rend ses trois blocs en cartes (`digestCard`), avec un
>   `reportCard(DigestReportItem)` — pastille `scoreColor()` partagée avec la
>   synthèse du mail de confirmation, 2 highlights max, 6 cartes max
>   (`REPORT_EMAIL_MAX_CARDS`). Le mail reste bilingue en/fr, contrairement
>   aux recaps de report qui sont FR-only.
> - `convex/forecasts.ts` `sendWeeklyDigest` : la boucle qui comptait les
>   reports de la semaine collecte en plus société + `companyIntelligence`
>   (`health_score`) pour les 6 premières ; au-delà elle ne fait plus que
>   compter. L'envoi boucle sur les familles, `notified` compte désormais les
>   mails envoyés.
> - `logoUrl()` sort de `convex/reportNotify.ts` pour devenir
>   `companyLogoUrl()` dans `convex/lib/domain.ts`, partagé par les deux
>   circuits d'email.
> - `tests/weeklyDigest.test.ts` couvre `familyOf` et `digestsFor` (split,
>   filiale dans le mail CALTE, famille muette qui disparaît seule).

## v1.201.0 — 30/08/2026 à 12:40 — L'assistant sait aussi écrire la dette et l'immobilier

Lot 7, le dernier du module Dette & Garanties. L'assistant savait déjà lire
les prêts, les garanties et les biens ; il peut maintenant les **écrire** —
et chaque écriture passe devant vous.

**Ce qu'il sait faire de plus.** Créer un prêt, ajouter un palier de taux sur
un prêt variable, enregistrer un avenant daté. Créer une sûreté sur un prêt,
enregistrer une mainlevée. Créer un bien, basculer la source d'un poste de
prix de revient, ajouter une valorisation datée. Et rattacher un flux à un
prêt ou à un bien — ce dernier point comblant au passage un oubli : il savait
lire un prêt depuis le mois dernier, mais pas y rattacher un prélèvement,
alors que c'était possible à la main.

**Chaque écriture demande votre accord**, sans exception. La génération
s'arrête, Confirmer / Refuser s'affiche, et rien n'est écrit tant que vous
n'avez pas tranché.

**Ce qu'il ne fait toujours pas, et pourquoi.**

- **Supprimer.** Retirer un prêt, une garantie ou un bien reste un geste de
  l'application. Une mainlevée n'est pas une suppression — elle est
  disponible, et elle conserve la ligne.
- **Corriger un prêt.** Écraser des conditions détruit un historique. Il peut
  en revanche enregistrer un **avenant**, qui le conserve.
- **Saisir un résultat.** Ni capital restant dû, ni loyer, ni charge, ni
  rendement : ce sont les conditions et les flux qui se saisissent, le reste
  en découle. Il n'y a pas de champ, donc pas d'outil.
- **Deviner une cible.** Comme pour le pointage, vous nommez la transaction
  et sa destination. Sur un bien, il demande aussi la nature du flux plutôt
  que de la supposer.

**Il sait de quoi vous parlez.** Sur la fiche d'un prêt ou d'un bien, « ce
prêt » et « ce bien » désignent celui que vous avez sous les yeux — comme
c'était déjà le cas sur une fiche deal ou société.

**Côté connecteur Claude** (le serveur MCP), les mêmes opérations sont
exposées et marquées comme des écritures, pour que le client demande
confirmation de son côté.

> **🔧 Notes techniques**
>
> - **`convex/agentToolsDebt.ts`** passe de lecture seule à lecture/écriture :
>   8 outils d'écriture (`createLoan`, `addLoanRate`, `addLoanAmendment`,
>   `createGuarantee`, `releaseGuarantee`, `createProperty`,
>   `setPropertyCostSource`, `addPropertyValuation`) + `listProperties` en
>   lecture. Tous les writes portent `needsApproval: true` ; chaque
>   `internalMutation` re-vérifie l'appartenance via la scope key du thread,
>   l'action de stream n'ayant aucune identité auth.
> - **L'org de l'assiette d'une garantie est résolue DEPUIS l'actif**, jamais
>   prise en argument — sinon un appelant pourrait se déclarer partie d'une
>   garantie qui ne le concerne pas.
> - **Correctif** : `agentToolsPointage:allocateTransactionToLiability`
>   acceptait `equity | intercompany_loan` seulement (livré au lot 4) ; il
>   accepte désormais aussi `loan` et `property` + la catégorie.
> - **MCP** : `listLoans`, `listGuarantees`, `listProperties` en lecture,
>   `createLoan`, `createProperty`, `addPropertyValuation` avec
>   `write: true` (donc `readOnlyHint: false`). ⚠️ `needsApproval` n'a aucun
>   effet là-bas — pas d'UI in-app pour l'afficher.
> - **Contexte d'entité élargi** de `deal | company` à
>   `deal | company | loan | property` dans `lib/instructions.ts`, `chat.ts`
>   (validateur + args de `streamAsync`) et `AiPanel`.
> - **`BASE_INSTRUCTIONS`** gagne trois paragraphes (dette, garanties,
>   immobilier). Les outils de dette du lot 3 n'en avaient aucun : le modèle
>   les avait sans savoir quoi en faire.
> - **Piège documenté** : le SDK AI **normalise** `needsApproval` en
>   prédicat, y compris quand le flag est absent. `expect(x.needsApproval)
>   .toBe(true)` passe donc sur **tous** les outils et ne prouve rien — il
>   faut **appeler** la fonction. Détail dans `KNOWN_ISSUES.md`.
> - **Tests** : `convex/regression.debtWrites.test.ts` (28 cas) — le flag
>   d'approbation appelé outil par outil dans les deux sens, les annotations
>   MCP, l'absence d'outil de suppression, la résolution d'org, et la
>   tenancy.

---

## v1.200.0 — 30/08/2026 à 12:05 — Chaque société ne voit que ce qui la concerne

Lot 6 du module Dette & Garanties, et le seul qui ne parle pas de dette :
un chantier transverse à toute l'application.

Toutes les organisations ne font pas la même chose. Une SCI qui détient un
immeuble n'a ni participation ni placement ; une holding d'investissement n'a
pas de bien. Jusqu'ici chaque espace affichait tous les modules, vides
compris — et un module vide, c'est du bruit qu'il faut apprendre à ignorer.

**Un module s'affiche s'il contient quelque chose.** Rien à déclarer, rien à
régler : la première ligne créée le fait apparaître. L'application le
vérifie à chaque affichage plutôt que de garder un réglage qui finirait par
se désynchroniser.

Cela vaut pour les entrées de la barre latérale — Investissements,
Trésorerie, Passif — **et** pour les trois sous-onglets d'Investissements.

**Et le problème de l'œuf et de la poule ?** Si un module vide est masqué,
comment y créer son premier élément ? C'est le rôle du bouton **« Activer un
module »** en bas de la barre latérale, et du **⋯** à côté des sous-onglets.
Ils listent exactement ce qui est masqué et le ramènent d'un clic ; le
module reste alors visible même vide, le temps d'y créer quelque chose.

Deux garde-fous qui comptent :

- **Éteindre un module qui contient des lignes ne les cache pas.** Le contenu
  l'emporte — des lignes existantes ne doivent jamais devenir inaccessibles.
- **La page ou l'onglet que vous consultez ne se masque jamais**, même si le
  module vient de se vider. Se retrouver sur une page dont l'onglet a disparu
  serait une trappe.

**« À faire » ne se masque pas** : c'est là que remontent les signaux de tous
les autres modules. Le masquer masquerait le moyen d'agir sur le reste.

> **🔧 Notes techniques**
>
> - **Schéma, additif** : `organizations.enabledModules` (tableau optionnel
>   de slugs, borné par construction à un par module connu).
> - **`convex/lib/modules.ts`** — le registre et la règle, purs et partagés
>   par le serveur et les deux surfaces : `isVisible` = « contient quelque
>   chose OU activé », `visibleModules`, `activatableModules`. Testés en
>   `node:test`.
> - **`convex/modules.ts:list`** — une sonde `.first()` par module à chaque
>   lecture (une question d'existence, jamais un comptage). La racine
>   `group_root` de l'org est explicitement exclue du contenu d'Entreprises :
>   la compter rendrait l'onglet définitivement non vide et la règle sans
>   objet. `setEnabled` refiltre sur `ALL_MODULES`, donc un module retiré du
>   code ne traîne pas en base.
> - **Front** : `nav.ts` étiquette chaque entrée de son module,
>   `AppSidebar` filtre et rend `ModuleActivator`, `InvestmentsTabs` fait de
>   même pour ses trois onglets et garde toujours l'onglet actif. Pendant le
>   chargement de la query **tout** s'affiche : une barre latérale qui perd
>   des entrées le temps d'un aller-retour se lit comme une perte de données.
> - **Tests** : `tests/modules.test.ts` (règle pure) et
>   `convex/regression.modules.test.ts` (10 cas bout en bout).

---

## v1.199.0 — 30/08/2026 à 11:35 — Qui détient quoi, et les prêts qu'on renégocie

Lot 5 du module Dette & Garanties : la structure capitalistique des sociétés
du groupe, et la possibilité d'**amender** un prêt sans réécrire son passé.

**Le % de détention, saisi à un seul endroit.** La section Capital de chaque
société gagne une colonne **Détention**. Le pourcentage se saisit sur la page
Passif de la société **émettrice** — « CALTE 60 %, M. Y 40 % » se lit chez la
SCI, pas chez CALTE. Côté détenteur, l'application **lit** ce pourcentage au
lieu d'en garder une copie : deux saisies finiraient par diverger, et rien ne
dirait laquelle a raison.

Le % reste facultatif, et l'absence est un vrai état : une prime d'émission
ou un report à nouveau ne portent aucune part du capital. L'application
affiche alors « — », jamais « 0 % » — qui affirmerait que le détenteur ne
possède rien.

**Renégocier un prêt sans effacer ce qui a été payé.** Le menu ⋯ d'une fiche
de prêt porte désormais **deux** gestes, et la différence est tout le sujet :

- **Corriger** écrase les conditions, comme si les anciennes n'avaient jamais
  existé. C'est pour une faute de saisie.
- **Mettre à jour au…** enregistre un **avenant daté** : les échéances déjà
  passées ne bougent pas, et les nouvelles conditions s'appliquent au capital
  restant à partir de la date d'effet.

L'application ne peut pas deviner lequel des deux s'applique — une faute de
frappe et une renégociation ressemblent exactement à la même chose. C'est
vous qui tranchez.

Seul ce qui change se saisit : un champ laissé vide reste inchangé. Une
renégociation qui ne touche que le taux, c'est un nombre à taper. Et si la
banque a **recalculé** le capital restant dû à la date d'effet, son chiffre
peut être saisi et prend le pas sur celui que l'application dériverait.

L'échéancier devient alors **multi-périodes** : une seule liste continue, où
la partie déjà courue reste exactement ce qu'elle était et la suite est
recalculée. Les avenants apparaissent dans une section dédiée, la plus
récente en tête, avec ce que chacun a changé — et cette section n'existe pas
tant qu'il n'y a pas d'avenant.

Trois gestes voisins à ne pas confondre : **corriger** écrase, **amender**
conserve, et **ajouter un palier de taux** n'est ni l'un ni l'autre — c'est
le contrat lui-même qui prévoyait la révision. Un crédit révolving, qui n'a
pas d'échéancier à segmenter, n'est pas amendable : ses conditions se
corrigent en place.

> **🔧 Notes techniques**
>
> - **Schéma, additif** : `equityPositions.ownershipBps` (optionnel, bps) et
>   table `loanAmendments` (`by_loan_from`), dont chaque champ de conditions
>   est optionnel — absent = inchangé.
> - **`lib/amortization.ts`** — nouvelle fonction pure
>   `buildScheduleWithAmendments` : coupe le segment courant à la date
>   d'effet, reprend le restant dû atteint (ou celui recalé par la banque via
>   `outstandingCents`, la seule exception assumée au « rien de dérivable
>   n'est stocké » de ce coin), réancre la série sur la première échéance
>   non servie et renumérote en continu. Sans avenant elle rend exactement
>   `buildSchedule` — le cas courant ne paie rien pour une fonctionnalité
>   qu'il n'utilise pas.
> - **Un seul lecteur d'échéancier.** Quatre surfaces en lisaient un (fiche,
>   prévisionnel, « À faire », agent), chacune reconstruisant les termes à la
>   main. Elles passent désormais toutes par `loans:loanSchedule`, qui charge
>   paliers **et** avenants — sans quoi une renégociation ferait diverger la
>   projection et la fiche sur le même prêt, invisible jusqu'au premier
>   avenant puis faux partout d'un coup.
> - **`loans:addAmendment` / `removeAmendment`** — une date, un avenant
>   (ré-entrer la même date remplace) ; refus avant la première échéance
>   (`amendment_before_start`, c'est une correction) et sur un révolving
>   (`revolving_not_amendable`). La suppression du prêt emporte ses avenants
>   comme elle emportait déjà ses paliers.
> - **`liabilities:getOwnershipForCompany`** — lecture inter-org du %, par le
>   chemin que D33 nomme : `by_holder_org` borne aux positions détenues
>   ailleurs, puis le SIREN joint les deux côtés. C'est la clé que
>   `migrations/createSubsidiaryOrgs` a construite en clonant délibérément le
>   SIREN sur le `group_root` de chaque filiale.
> - ⚠️ **`companyRelations.ownershipPct` reste en base** et porte le même
>   fait en `0-100` : c'est le doublon préexistant que D33 interdit. Il n'est
>   pas retiré ici (donnée de production, lu par `companies.ts`) — signalé
>   dans `KNOWN_ISSUES.md`, à arbitrer comme un chantier de données à part.
> - **Tests** : `tests/amortization.test.ts` § avenants (9 cas : le passé
>   inchangé au centime, le capital repris, la durée restante, l'enchaînement
>   de plusieurs avenants dans le désordre, la numérotation continue) et
>   `convex/regression.equityAmendments.test.ts` (14 cas).

---

## v1.198.0 — 30/08/2026 à 11:05 — L'immobilier entre dans Albo OS

Albo OS savait ce que le groupe possède en participations et en placements,
et ce qu'il doit à ses banques. Il sait maintenant répondre à : **« que
possède cette société en immobilier, combien ça vaut, et combien ça
rapporte ? »** C'est le lot 4 du module Dette & Garanties.

**Un troisième onglet, pas une entrée de plus.** L'Immobilier s'installe à
côté d'Entreprises et de Placements, dans Investissements. Un bien reste un
investissement — il fausserait simplement les multiples du portefeuille s'il
était rangé avec les participations. Le menu de gauche ne bouge pas.

**Le prix de revient, et son interrupteur.** C'est le cœur du module. Un bien
a trois postes de revient — acquisition, frais d'acquisition, travaux — et
chacun porte **un seul montant**, venu d'**une seule source** : soit le
montant que vous avez saisi, soit la somme des flux bancaires pointés sur ce
bien. **Jamais l'addition des deux.**

Et le choix se fait **poste par poste**, parce que les deux cas coexistent
sur le même immeuble : un bien acquis en 2019 a un prix qui ne sera jamais
dans l'application — la connexion bancaire ne remonte pas si loin — pendant
que ses travaux de 2024 sont de vrais virements. Un interrupteur unique
obligerait à sacrifier l'un ou l'autre. La colonne « Source » de la fiche
bascule le poste d'un clic, et le montant saisi est conservé : on peut
revenir sans rien retaper.

Quand des flux sont pointés sur un poste resté en « Saisi », la fiche le
**dit** — « 2 flux ne sont pas comptés » — au lieu de les cacher. Ils ne sont
pas additionnés, mais vous savez qu'ils existent.

**La rentabilité est réelle, jamais théorique.** Loyers encaissés, charges
payées, résultat net : sur 12 mois glissants, et uniquement à partir de
transactions pointées. Un bien sans flux rattaché affiche zéro, pas une
estimation. Les échéances de prêt ne sont jamais des charges du bien — elles
sont rattachées au prêt, sinon la même sortie serait comptée deux fois.

**Les valorisations sont datées et saisies à la main.** Aucune estimation
automatique. Tant qu'aucune valeur n'est connue, la plus-value latente est
**inconnue**, pas nulle : l'application ne prétend pas savoir.

**Le marchand de biens est un usage, pas un objet à part.** Quand il est
choisi, la fiche masque l'exploitation — un bien acheté pour être revendu ne
s'exploite pas — et met en avant le prix de revient puis le résultat de
sortie, calculé sur les flux datés réels à la revente.

**Une hypothèque peut enfin porter sur un immeuble.** Jusqu'ici une garantie
ne pouvait prendre pour assiette qu'un placement, des titres ou « rien de
chez nous » : le privilège de prêteur de deniers d'une SCI sur son propre
bien n'était pas saisissable. Il l'est. Et il se lit des **deux côtés** — sur
la fiche du prêt et sur la fiche du bien — à partir d'une seule saisie.

**Pointer un flux sur un bien.** Le sélecteur de la file de Pointage gagne un
groupe **Biens**. C'est le seul endroit de l'application où choisir une cible
en appelle une seconde : la **nature de la dépense**. Sans elle, impossible de
savoir si les 40 000 € qui sortent sont des travaux, des charges ou une part
du prix. Une transaction, un bien, une seule nature — jamais de découpage. Et
comme partout : rien n'est proposé, rien n'est présélectionné, rien n'est
classé par vraisemblance.

**Un signal de plus dans « À faire ».** Les biens détenus sans estimation
depuis plus de 18 mois y remontent : leur plus-value et leur rendement se
comparent sinon à une valeur qui ne veut plus dire grand-chose.

**Deux oublis du lot précédent corrigés au passage.** Les transactions
pointées sur un **prêt bancaire** n'apparaissaient dans aucun onglet du
registre de trésorerie ; elles figurent désormais avec les comptes courants.
Et l'assistant IA, qui savait lire un prêt, ne savait pas y **rattacher** un
prélèvement alors que c'était possible à la main : il le sait maintenant, et
sait aussi pointer sur un bien.

> **🔧 Notes techniques**
>
> - **Schéma, strictement additif** (prod) : tables `properties` (avec
>   `costBasis` : un tableau borné à trois postes, chacun portant sa `source`
>   et son `manualAmountCents`) et `propertyValuations`. Élargissements
>   d'unions : `guaranteeSubjectKind` += `'property'`, `allocationKind` +=
>   `'property'`. Nouveaux champs optionnels : `guarantees.subjectPropertyId`,
>   `documents.propertyId`, `transactions.allocation.category`. Nouveaux index
>   `by_subject_property`, `by_property`, `properties.by_org(_status)`,
>   `propertyValuations.by_property_asof`. Le validateur est exporté sous
>   `propertyAssetType` : `propertyType` était déjà pris au niveau module par
>   le champ d'instrument d'un deal immo.
> - **`convex/lib/properties.ts`** — moteur pur (aucun import Convex, testé en
>   `node:test` hors `convex/`, comme `amortization.ts`) : `resolveCostBasis`
>   (une source par poste, remboursements soustraits, flux ignorés comptés à
>   part), `operatingResult` (12 mois glissants), `netYield`,
>   `latentGainCents`, `exitCashflows` (branché sur le **seul** `xirr` du
>   repo). Rien de dérivable n'est stocké.
> - **`convex/properties.ts`** — `list` / `listOptions` / `getById` / `create`
>   / `update` / `remove` / `setCostPosteSource` / `addValuation` /
>   `removeValuation`, toutes derrière `requireOrgMember`. Garde-fous de
>   suppression : `has_guarantees`, `has_allocations`, `has_documents`.
> - **`convex/guarantees.ts`** — `describeSubject`, `siblingPledges`,
>   `subjectValueCents` et `resolveParties` apprennent `'property'` ; nouvelle
>   query `listBySubjectProperty` (miroir de `listBySubjectDeal`). L'org de
>   l'assiette continue d'être lue sur l'actif, jamais sur un argument.
> - **`convex/lib/pointage.ts`** — `applyAllocateToLiability` accepte
>   `'property'` + un `category` optionnel : requis sur un bien
>   (`missing_category`), refusé ailleurs (`category_not_supported`), et l'org
>   du bien est vérifiée comme celle d'un prêt (`property_wrong_org`). La
>   direction n'est **pas** contrainte à la mutation : un remboursement de
>   travaux revient en `in` et se soustrait du poste.
> - **`lib/categories.ts` (les deux miroirs)** — `effectiveCategory` range
>   `'property'` dans un nouveau seau `real_estate`. Sans ça un flux
>   immobilier tombait dans `'deals'` et polluait les investissements **en
>   silence** — c'est le piège du fichier.
> - **Correctifs lot 3** : `transactions:listLedger` (le filtre « liability »
>   omettait `'loan'`, désormais `['equity','intercompany_loan','loan',
>   'property']`) et `agentToolsPointage:allocateTransactionToLiability`
>   (l'énum s'arrêtait à `equity | intercompany_loan`).
> - **Front** : routes `immobilier.index.tsx` / `immobilier.$propertyId.tsx`,
>   composants `src/components/immobilier/*`, troisième onglet dans
>   `InvestmentsTabs` + `alsoActiveOn` dans `nav.ts`. Le `TargetCombobox`
>   gagne un second panneau pour la nature (état `pendingProperty`), le seul
>   endroit du picker qui n'applique pas au premier clic. Namespace i18n
>   `immobilier` (fr + en) + ajouts dans `pointage`, `passif`, `todo`.
> - **Tests** : `tests/properties.test.ts` (moteur pur) et
>   `convex/regression.properties.test.ts` (bout en bout, 16 cas). Ajout de
>   `tests/amortization.test.ts` § « attribution du réel » qui épingle le
>   caractère **déterministe et calendaire** d'`attributeActuals` — le montant
>   n'influence jamais le placement, l'ordre des flux non plus.
> - **Doc** : nouvelle page produit `docs/produit/20-immobilier.md` (+ son
>   document Linear et son entrée dans `DOCS`), `SPEC.md` corrigé sur deux
>   points (`loans.endDate` documenté au § 4.1 ; `intelligence.ts` et
>   `companyEnrichment.ts` retirés de la liste d'audit du § 4.8 — ils ne
>   touchent jamais la table `documents`).

---

## v1.197.0 — 29/08/2026 à 23:31 — Ce que chaque société doit, et ce qui est mis en gage

Albo OS savait dire ce que le groupe possède. Il sait maintenant dire ce
qu'il **doit**, à qui, jusqu'à quand — et ce qui a été mis en gage pour
l'obtenir. Les trois premiers lots du module Dette & Garanties sont livrés.

**La dette bancaire.** La page Passif de chaque société s'ouvre sur ses
prêts : prêteur, taux courant, échéance finale, capital restant dû. Chaque
prêt a sa fiche, avec son échéancier complet. Ce qui se saisit, ce sont les
conditions du contrat — le montant emprunté, la durée, le taux, la
périodicité, l'assurance, le différé éventuel. Jamais le résultat du calcul :
le capital restant dû est recalculé à chaque lecture, il ne peut donc pas se
désynchroniser. Corriger un prêt le fait bouger immédiatement.

Les quatre façons d'emprunter sont là dès maintenant : annuité constante,
capital constant, in fine, et crédit révolving. Un groupe de holdings et de
SCI n'emprunte pas qu'en annuité constante, et le type change tout — un in
fine de 6,6 M€ fait apparaître ses 6,6 M€ dans la trésorerie prévisionnelle
**à sa date**, au lieu d'être lissé sur vingt ans et de rester invisible
jusqu'à ce qu'il tombe. Le différé existe en deux natures, à ne pas
confondre : partiel, on paie les intérêts ; total, ils se capitalisent et
l'amortissement démarre au-dessus du montant emprunté.

Un prêt à taux variable porte une série datée de paliers, constatés ou
projetés. Au-delà de la dernière révision constatée, les échéances sont
marquées **projetées** : l'application ne prétend pas connaître le taux de
2029. Un prêt à taux fixe n'a rien à saisir là — la section n'apparaît même
pas.

**Les garanties.** Une garantie est décrite par trois informations
distinctes : sa forme (nantissement, hypothèque, privilège de prêteur de
deniers, caution, garantie d'organisme), l'actif sur lequel elle porte, et
qui s'engage. Elle est saisie une seule fois et se lit de trois côtés :
depuis le prêt qu'elle couvre, depuis l'actif qu'elle grève, depuis la
société garante. Rien n'est saisi deux fois, donc rien ne peut diverger — et
la lecture traverse les sociétés : un contrat détenu par CALTE qui garantit
un prêt d'une SCI se lit dans les deux espaces.

La question qui obligeait jusqu'ici à ressortir les actes a enfin sa réponse.
Sur la fiche d'un placement, un bloc affiche sa valeur actuelle, le total
gagé et la **marge disponible**. Il compte tous les gages, y compris ceux qui
profitent à une autre société du groupe et ceux qui profitent à un emprunteur
extérieur — sans ces derniers, la marge serait surévaluée, une erreur en
notre défaveur et invisible. Trois précautions expliquent des chiffres
parfois surprenants : une caution illimitée n'est pas comptée dans le total
(elle est listée à part, l'afficher comme zéro mentirait) ; un montant gagé
peut dépasser la valeur de l'actif, et la marge devient négative ; un montant
gagé ne décroît pas quand la dette se rembourse, il vaut son montant d'acte
jusqu'à la mainlevée. La marge affichée est donc volontairement pessimiste.

Les sûretés s'affichent de la plus forte à la moins forte. C'est une
convention de lecture, pas une vérité juridique : un second rang ne vaut que
ce qui reste après le premier.

**Le branchement sur l'existant.** Le sélecteur de pointage gagne un groupe
« Prêts bancaires ». Rattacher un prélèvement à son prêt le sort de la file
et fait apparaître le montant dans la colonne Réel de l'échéancier, en face
de la bonne échéance. Le réel ne vaut pas la mensualité du plan — il inclut
l'assurance — et les deux colonnes coexistent précisément pour éviter de
« corriger » un chiffre juste.

Rien n'est proposé, rien n'est pré-sélectionné, rien n'est classé par
vraisemblance : l'application liste, vous choisissez. Seule la conséquence
est automatique.

Les échéances à venir alimentent le prévisionnel de trésorerie, l'onglet
À faire signale les échéances échues sans prélèvement rattaché, et
l'assistant IA sait désormais répondre à « combien RDB doit-elle encore ».

Les actes de prêt et de nantissement se rattachent directement au prêt ou à
la garantie : ils n'ont pas de société-cible au sens portefeuille, et n'ont
plus besoin d'en emprunter une.

Restent à venir : l'immobilier, la structure capitalistique des filiales, les
avenants avec historique, et l'écriture par l'assistant.

> **🔧 Notes techniques**
>
> - **Lot 1 — les prêts.** Tables `loans` + `loanRates`. Le cœur est
>   `convex/lib/amortization.ts` : fonction **pure**, zéro import Convex ni
>   Node, testée par `tests/amortization.test.ts` en `node:test` (hors
>   `convex/`, sinon le bundle de déploiement casse) — même patron que
>   `lib/recurrence.ts`, dont elle réutilise la date-math UTC.
>   `buildSchedule` couvre les quatre `amortizationKind`, le différé
>   partiel/total, la périodicité mensuelle/trimestrielle et la série de
>   taux ; `outstandingAt` / `summarize` en dérivent les chiffres de la
>   fiche. Aucun capital restant dû stocké, aucune table d'échéancier — la
>   seule exception assumée est l'encours d'un `revolving`, documentée au
>   schéma. `periodicRate` fait UNE division (`bps × mois / (10000 × 12)`) :
>   la forme en deux divisions rendait 0,009999999999999998 pour un taux
>   mensuel de 12 %, artefact qui voyageait ensuite sur 240 échéances.
> - **`documents.companyId` → optionnel**, seul changement de contrainte sur
>   une table existante. L'ordre de `KNOWN_ISSUES.md` a été suivi : audit
>   d'abord, tolérance ensuite, schéma enfin. L'audit a trouvé 5 crashs
>   runtime (`vectorize.getDocumentForIndex`, `indexDocumentImpl`,
>   `notifyIndexFailure`, et deux `db.get(undefined)` dans
>   `migrations/legalDocsImport`) et 1 corruption silencieuse
>   (`lib/duplicates.ts` clé `"undefined|titre"` fusionnant tous les
>   documents non classés). `documents.create` ne prend jamais l'org en
>   argument : elle la résout depuis l'ancre (`companyId`, sinon `loanId`,
>   sinon `guaranteeId`, sinon `dealId`) et vérifie l'appartenance dessus.
> - **Lot 2 — les garanties.** Table `guarantees` sur le patron polymorphe
>   d'`equityPositions`. `requireGuaranteeParty` (`convex/guarantees.ts`) est
>   calqué sur `requireLoanParty` : membre d'au moins une des orgs parties
>   (`borrowerOrgId` / `pledgorOrgId` / `subjectOrgId`), refus si la garantie
>   ne touche aucune org du groupe. Les orgs dénormalisées sont résolues
>   depuis les lignes référencées, jamais depuis un argument. Marge et tri
>   dans `convex/lib/guarantees.ts` (pur, `tests/guarantees.test.ts`).
>   `subjectKind` n'a pas encore `'property'` : la valeur arrivera avec la
>   table `properties` (élargir une union est sans migration).
> - **Lot 3 — le branchement.** `allocationKind` gagne `'loan'` ;
>   `applyAllocateToLiability` accepte la cible et vérifie l'org
>   (`bank_loan_wrong_org`). `buildLiabilityOptions` construit un troisième
>   groupe alimenté DIRECTEMENT par `loans.listOptions`, jamais par une liste
>   aplatie re-filtrée. Le réel par échéance est `attributeActuals` : un
>   rapprochement de **calendrier** d'un flux déjà pointé, pas un moteur de
>   suggestion — ne pas le transformer en classement par vraisemblance.
>   `forecasts.expandLoanSchedules` projette les échéances futures
>   (`derivedKey` `"loan:{loanId}:{YYYY-MM-DD}"`, `entryUpsertAction`
>   respecté) et purge les occurrences futures intactes que le nouvel
>   échéancier ne produit plus. Nouveau bucket d'analyse `debt` dans
>   `lib/categories.ts` (et sa copie miroir `src/lib/categories.ts`).
>   `convex/agentToolsDebt.ts` expose quatre outils de **lecture seule** ;
>   toute écriture devra porter `needsApproval: true`.
> - **Tests** : `tests/amortization.test.ts` (41), `tests/guarantees.test.ts`
>   (17), `convex/regression.loans.test.ts`,
>   `convex/regression.docOptionalCompany.test.ts`,
>   `convex/regression.guarantees.test.ts`,
>   `convex/regression.loanPointage.test.ts`.

## v1.196.3 — 29/08/2026 à 20:42 — Le cahier des charges du suivi de la dette et des garanties

Albo OS sait dire ce que le groupe possède, pas ce qu'il doit. Aucun prêt
bancaire n'existe aujourd'hui dans l'application : le capital restant dû de
chaque société vit dans des tableaux d'amortissement PDF, et personne ne
peut dire, sans ressortir les actes, combien il reste de marge disponible
sur un contrat de capitalisation mis en gage pour trois prêts différents.

Ce cahier des charges décrit le module à construire : les prêts contractés
par chaque société, les garanties qui les couvrent (nantissement,
hypothèque, privilège de prêteur de deniers, caution, garantie
d'organisme), les biens immobiliers détenus par les SCI, et la structure
capitalistique des filiales. Une garantie y est décrite par trois
informations distinctes — sa forme, l'actif sur lequel elle porte, et qui
s'engage — ce qui permet enfin de lire la même garantie depuis le prêt,
depuis l'actif gagé, et depuis la société garante, sans jamais saisir
l'information deux fois.

Rien n'est développé à ce stade : le document est un plan découpé en sept
lots livrables, dont le premier répond déjà à « combien cette société
doit-elle, à qui, jusqu'à quand ». Le patrimoine personnel reste
explicitement hors de l'application.

> **🔧 Notes techniques**
>
> - Nouveau fichier `SPEC.md` à la racine, issu d'une interview de cadrage.
>   Aucun code applicatif : pas de `convex/`, pas de composant React, pas de
>   migration.
> - Modèle retenu : `loans` (paramètres du prêt, sans capital restant dû —
>   dérivé d'une fonction pure d'amortissement `lib/amortization.ts`, pas de
>   table d'échéancier), `guarantees` (ligne unique inter-orgs portant forme /
>   assiette polymorphe / garant, sur le patron polymorphe d'`equityPositions`
>   et le patron inter-orgs d'`intercompanyLoans`), `properties` +
>   `propertyValuations`.
> - `properties.costBasis` : un poste de prix de revient a **une** source —
>   `manual` ou `flows` — choisie poste par poste, jamais l'addition des deux.
>   Les champs de montant saisis d'une première version (prix d'achat, frais,
>   travaux) ont été retirés : ils doublonnaient les flux pointés.
> - Extensions : deux valeurs sur `allocationKind` (`loan`, `property`), un
>   `allocation.category` optionnel (six natures pour un bien : acquisition,
>   frais d'acquisition, travaux, charges, loyer, revente — une transaction
>   n'est jamais éclatée), `equityPositions.ownershipBps`,
>   `forecastEntries.loanId`, et le passage de `documents.companyId` en
>   optionnel — seul changement de contrainte sur une table existante, à
>   auditer en début de lot 4.
> - Autorisation : `requireGuaranteeParty` calqué sur `requireLoanParty`
>   (membre d'au moins une org partie). Les orgs restent à plat, aucun
>   héritage de droits.
> - Réemploi assumé : le sélecteur de pointage existant gagne deux groupes
>   (`liabilities:listOptions` + `lib/liabilityOptions.ts`) ; `forecastEntries`
>   avec `derivedKey "loan:{id}:{date}"` pour les échéances ; le XIRR des deals
>   pour le TRI d'un bien revendu ; le patron « transactions rattachées +
>   réaffectation » des fiches deal pour la fiche prêt — aucun geste de
>   rattachement nouveau.
> - UI vérifiée contre le code : la barre latérale a quatre entrées, Immobilier
>   devient le troisième onglet d'`InvestmentsTabs`. Modules affichés seulement
>   s'ils contiennent quelque chose ou ont été activés (chantier transverse,
>   lot 6).
> - `loans.amortizationKind` ouvre quatre types (annuité constante, capital
>   constant, in fine, révolving), chacun avec sa formule et sa génération
>   d'occurrences dans `forecastEntries` — un in fine doit faire apparaître son
>   ballon à date, pas lissé sur vingt ans. `deferralKind` distingue le différé
>   partiel du différé total. Le révolving est la seule ligne du module dont le
>   restant dû est saisi et non dérivé, faute d'échéancier dont le déduire.
> - `loanRates` (table, pas tableau sur le prêt : la série grandit sans borne
>   et `loans` est lu en liste) porte les révisions `actual` et les paliers
>   `forecast`. Taux applicable = dernier `fromDate <= date`, à défaut
>   `loans.rateBps` — un prêt à taux fixe n'a aucune ligne à saisir.
> - `guarantees.rank` et un ordre d'affichage par force décroissante, signalé
>   comme convention de lecture et non comme vérité juridique.
> - Le test de validation imposé (réinstancier les 10 lignes de l'annexe
>   fournie) est déroulé ligne par ligne en § 10 : 7 rentrent, 3 sortent par
>   décision produit assumée, aucune n'échoue par insuffisance du modèle.
> - `KNOWN_ISSUES.md` gagne une section sur `documents.companyId`, obligatoire
>   aujourd'hui : le relâcher se déploiera sans broncher côté Convex alors que
>   tout le code qui suppose le champ présent continuera de compiler et cassera
>   à l'exécution. Audit des lectures d'abord, schéma ensuite.

---
## v1.196.2 — 28/08/2026 à 16:30 — Une étiquette qui ne servait à rien sur les sociétés du groupe

Chaque société du groupe portait un type — « société d'exploitation », « SCI »,
« société de gestion » — qui n'avait aucun effet : aucun écran ne l'affichait,
aucun calcul ne s'en servait, et l'app ne permettait même pas de le choisir.
Une distinction qui promet quelque chose et ne tient rien finit par tromper.

Ces quatre étiquettes sont repliées en une seule. Ce qui compte reste inchangé :
une société du groupe peut investir et détenir un compte bancaire, une société
du portefeuille non. La nature juridique d'une société continue de se lire dans
sa forme (SAS, SCI, SASU), là où elle a toujours été juste.

Rien ne change à l'écran.

> **🔧 Notes techniques**
>
> - Étape 1 d'un purge-then-narrow. `companyKind` (schema.ts) et
>   `kindValidator` (companies.ts) acceptent désormais **aussi**
>   `group_entity` ; les quatre valeurs dépréciées restent tolérées le temps
>   que la donnée soit réécrite.
> - Nouvelle migration `convex/migrations/collapseGroupKinds.ts`
>   (`dryRun` / `apply` / `verify`) : réécrit `group_operating`, `group_sci`,
>   `group_spv` et `group_manco` en `group_entity`. `group_root` et
>   `portfolio` sont épargnés — seules valeurs lues pour elles-mêmes (Attio,
>   page Passif, rattachement des reportings). Idempotente.
> - `verify` est la porte de l'étape 2 : le retrait des quatre littéraux du
>   schéma ne partira que quand elle renverra `remaining: 0`. L'ordre inverse
>   ferait échouer le déploiement.
> - `CLAUDE.md` § Modèle multi-org fixe la règle : trois valeurs de `kind`, et
>   pas de nouveau sous-type descriptif — la nature se lit dans `legalForm`.
> - `convex/regression.groupKinds.test.ts` couvre le comptage, la réécriture,
>   la préservation de `group_root` / `portfolio` et l'idempotence.

## v1.196.1 — 28/08/2026 à 16:15 — Le compte courant entre CALTE et Albo était à l'envers

L'avance de trésorerie entre CALTE et Albo Club était enregistrée dans le
mauvais sens : l'app présentait Albo comme le prêteur et CALTE comme
l'emprunteur, alors que les mouvements bancaires des deux côtés disent
l'inverse — c'est CALTE qui a avancé les fonds.

Une fois la correction passée, la somme apparaît comme une créance chez CALTE
et une dette chez Albo, ce qui est sa nature réelle.

À noter au passage : les deux côtés n'affichent pas le même montant, parce que
CALTE n'a rattaché que deux mouvements à ce compte courant là où Albo en a
rattaché six. Ce n'est pas une erreur de l'app — c'est le signal qu'il reste
des mouvements à pointer côté CALTE.

> **🔧 Notes techniques**
>
> - Nouvelle migration one-shot `convex/migrations/fixLoanDirection.ts`
>   (`inspect` / `apply`). `inspect` liste tous les `intercompanyLoans` avec
>   les deux soldes dérivés (`computeLoanBalanceCents` sur les transactions
>   allouées de chaque org) et un flag `looksReversed` : vrai quand les deux
>   signes contredisent les rôles enregistrés.
> - `apply` intervertit `fromOrgId` / `toOrgId` sur un prêt. Une inversion
>   n'étant pas idempotente, elle exige `currentFromSlug` / `currentToSlug` et
>   lève `direction_mismatch` sinon — un second passage échoue au lieu de
>   remettre l'erreur. Les transactions pointées ne bougent pas : elles visent
>   le prêt, et chaque solde est re-dérivé depuis les rôles inversés.
> - `convex/regression.loanDirection.test.ts` couvre la détection, la
>   correction et le refus du second passage.
> - `KNOWN_ISSUES.md` § Passif : comment distinguer un sens inversé (les deux
>   signes se contredisent) d'un simple trou de pointage (signes cohérents,
>   montants qui divergent).

## v1.196.0 — 28/08/2026 à 14:34 — Chaque société du groupe aura son propre espace

Jusqu'ici, les filiales de CALTE — Caltimo, RDB, Relais Chapelle, les SCI,
Banco 2 — n'existaient que comme des lignes à l'intérieur de l'espace CALTE.
Sans comptes bancaires à elles, sans bilan, et avec une TVA calculée pour les
huit sociétés réunies, donc juste pour aucune.

Chacune reçoit maintenant son propre espace, sur le modèle d'Albo Club : ses
comptes, ses investissements, son capital, ses comptes courants. Les espaces
restent à plat — aucun n'est « dans » un autre. Ce qui relie deux sociétés du
groupe, ce sont des liens financiers lisibles des deux côtés : une avance de
CALTE à une filiale est un investissement chez CALTE et une dette chez la
filiale.

Cette mise à jour prépare le terrain : elle crée les espaces et n'y touche à
rien d'autre. Les comptes bancaires des filiales, leurs biens et leurs
emprunts arrivent ensuite.

> **🔧 Notes techniques**
>
> - Nouvelle migration one-shot `convex/migrations/createSubsidiaryOrgs.ts`
>   (`inspect` lecture seule / `apply`) : crée les 7 orgs filiales de `calte`,
>   y recopie les membres de `calte` avec leur rôle, et y insère une
>   `companies` `group_root` clonée depuis la ligne source (identité légale
>   uniquement — `attioCompanyId` et `airtableId` volontairement non clonés).
>   Idempotente et **strictement additive** : aucune ligne existante n'est
>   modifiée.
> - `inspect` remonte par filiale `dealsAsInvestor` et `bankAccountsOwned` :
>   les deux compteurs qui conditionnent une éventuelle reclassification de la
>   ligne source de `group_*` vers `portfolio` (un investisseur de deal et un
>   propriétaire de compte doivent être `group_*`). Non fait ici — décision
>   séparée.
> - Doc : `CLAUDE.md` § « Modèle multi-org » réécrit (1 société juridique =
>   1 org, orgs à plat, pourquoi le passif le supposait déjà et pourquoi la
>   TVA était fausse) ; nouvelle section `KNOWN_ISSUES.md` sur ce que la
>   création des orgs ne règle pas (les 7,8 M€ d'avances restent des deals
>   `cca`, l'écran Participations ne lit que les `deals`, Powens est par org) ;
>   `MIGRATIONS.md` + `docs/produit/01` et `02` mis à jour.

## v1.195.1 — 26/08/2026 à 20:41 — Le garde-fou qui empêchait un build cassé était rangé dans un tiroir que plus personne n'ouvre

Rien de visible dans l'app. Une consigne interne qui protège l'application
d'une brique tierce défectueuse était écrite au mauvais endroit : l'outil qui
installe les dépendances a déménagé ce réglage, et ne lisait donc plus la
consigne. Elle est déplacée là où elle est de nouveau prise en compte.

Rien ne change aujourd'hui — aucune version de brique n'a bougé — mais la
protection redevient effective pour les mises à jour à venir, au lieu de tomber
au premier déploiement qui recalcule les dépendances.

> **🔧 Notes techniques**
>
> - Déplacement de l'override `unstorage: 2.0.0-alpha.7` du champ `pnpm` de
>   `package.json` vers la clé `overrides` de `pnpm-workspace.yaml`. pnpm 11 ne
>   lit plus ce champ (`The "pnpm" field in package.json is no longer read by
>   pnpm`) : le pin était devenu inerte, masqué par le lockfile et par le
>   `packageManager` encore en 10.x.
> - Vérifié sur une copie jetable avec `pnpm@10.28.0` (la version de
>   `packageManager`, donc celle de la CI et de Vercel) : lockfile supprimé,
>   résolution complète → `unstorage@2.0.0-alpha.7`. Contre-épreuve sans
>   override → `alpha.9`, dont le manifeste ne déclare toujours aucune
>   dépendance (`npm view` vide, comme `.6` à `.8`) : le pin reste nécessaire.
> - `KNOWN_ISSUES.md` § « pnpm.overrides » : snippet passé en YAML + section
>   sur le piège du champ mort. Message d'échec de `update-deps.yml` et ligne
>   `TEMPLATE_SYNC.md` repointés vers le nouvel emplacement, plus une entrée de
>   backlog template pour la règle elle-même.

## v1.195.0 — 26/08/2026 à 20:02 — Une adresse maison pour les reports, et un accusé qui revient au bon expéditeur

L'adresse de dépôt des reports peut désormais être une adresse à vous —
`report@alboteam.com` — au lieu de l'adresse technique du prestataire. C'est un
groupe : vous en êtes membres, vous recevez chacun une copie de ce qui y passe,
et le circuit y est abonné comme un membre de plus.

**N'importe qui peut y écrire, et personne n'a besoin d'être inscrit à
l'avance.** Un fondateur qui envoie son update directement à cette adresse est
traité comme un transfert : ce qui décide qu'un report est rangé, c'est son
contenu — le circuit doit reconnaître une participation et le prouver — jamais
l'identité de l'expéditeur. Ce qui reste fermé, c'est la **réponse** : l'accusé
porte vos montants, vos organisations et des liens vers vos fiches, donc il ne
part jamais vers quelqu'un qui n'est pas membre. Un inconnu n'obtient rien, pas
même la confirmation que l'adresse existe.

**L'accusé revient à celui qui a transféré, jamais au groupe.** C'était le vrai
risque de cette adresse partagée : une réponse envoyée à l'alias serait
redistribuée à tout le monde — et au circuit lui-même, qui répondrait à son
tour, en boucle. Le destinataire est maintenant **imposé** par l'app, plus
jamais déduit du mail reçu. Et si le groupe a réécrit l'expéditeur en route,
le vrai auteur est retrouvé dans les en-têtes du message.

**Tu peux transférer depuis une autre adresse que celle de ton compte.**
Réglages → Membres, nouvelle carte « Adresses d'envoi des reports » : déclare
ton Gmail perso ou ton adresse dans une autre boîte, et tu reçois l'accusé
complet comme depuis ton adresse habituelle. Sans déclaration, le report se
range quand même, mais en silence — le circuit ne sait pas que c'est toi. Une
adresse déclarée n'ouvre aucun droit et ne permet pas de se connecter : elle
sert uniquement à reconnaître l'auteur d'un transfert.

**Le spam ne réveille plus personne.** Une adresse ouverte reçoit des
sollicitations : un mail que le circuit ne rattache à rien, ou marqué comme
spam, attend maintenant dans les Rapports entrants **sans déclencher le moindre
email**. Une alerte par pub reçue, c'est la boîte qui se remplit — exactement ce
qu'on venait de corriger. La file reste l'endroit où ça se traite, et le point
du lundi la résume.

À faire côté console avant de confier l'adresse : sur le groupe, **préfixe de
sujet vide et footer désactivé**, et « Envoyer les réponses à » réglé sur
l'expéditeur du message. Ces trois réglages sont ce qui empêche Google de
remplacer l'expéditeur par l'adresse du groupe.

> **🔧 Notes techniques**
>
> - `lib/reportSenders.ts` (nouveau) : `resolveMemberByEmail` (compte **ou**
>   alias, puis appartenance à une org) et la liste noire `blockedSenderAddresses`
>   — l'inbox (son `inbox_id` AgentMail **est** son adresse) + les alias du
>   groupe, variable `REPORT_GROUP_ADDRESSES` (séparateur virgule).
> - `agentmail.replyToMessage` prend un `to` **obligatoire**. L'API AgentMail
>   documente `to` comme optionnel mais ne dit **nulle part** à qui part une
>   réponse sans lui : c'était déduit du message d'origine, donc de son `From` /
>   `Reply-To`. `reply_all` reste proscrit (il répondrait au groupe).
> - `agentmail.originalSenderOf` lit `X-Original-Sender` via **Get Message** :
>   le payload du webhook `message.received` ne porte aucun en-tête. L'appel
>   n'a lieu que si le `From` reçu est une adresse bloquée — sinon rejet
>   silencieux (`dropped loop-back`).
> - `reportInbox.ingest` : l'appartenance ne conditionne plus le traitement,
>   seulement l'attribution (`senderUserId`). `unknown_sender` disparaît comme
>   motif de blocage ; `reprocess` rejoue toujours, spam compris.
> - `reportIdentify.markProcessing` refusait toute ligne sans `senderUserId` :
>   un second garde en aval qui annulait le changement en silence (ligne créée,
>   jamais analysée). Retiré — la claim reste exclusive. Test vérifié **rouge**
>   contre l'ancien garde.
> - `lib/reportRouting.ts` : `!senderIsMember` → `alertOthers: false` et
>   `broadcast: kind === 'success'`. `reportNotify` compare l'abonnement aux
>   erreurs sur le `userId`, plus sur l'adresse (un alias est la même personne).
> - Schéma : `userEmailAliases` (`by_email`, `by_user`) + `organizations`
>   `listMemberAliases` / `addMemberAlias` / `removeMemberAlias` (refus
>   `email_taken`, `blocked_address`, `invalid_email` ; admin pour la ligne
>   d'un autre) et `SendingAddressesCard`.
> - Tests : `tests/reportSenders.test.ts` (6 cas purs sur la liste noire) et
>   `convex/regression.reportSenders.test.ts` (8 cas base). `tests/reportRouting`
>   mis à jour sur la nouvelle règle du silence. 150 tests Convex, 314 unitaires.
> - Quatrième garde-fou **hors code**, à poser dans la console AgentMail :
>   `report@alboteam.com` dans la *send block list* de l'inbox — plus aucun mail
>   sortant ne peut atteindre le groupe, quelle que soit la régression.

## v1.194.0 — 26/08/2026 à 19:30 — Une invitation ne peut plus demander un mot de passe qui n'existe pas

Inviter quelqu'un pouvait se terminer en cul-de-sac. Si une trace de compte
traînait déjà sur son adresse — une inscription abandonnée en cours de route,
un vieux compte jamais activé — la page d'invitation lui demandait « votre mot
de passe ». Un mot de passe que personne n'avait jamais défini. Aucune issue
depuis cet écran : ni « mot de passe oublié », ni explication, et le lien
magique renvoyait sur ce même formulaire sans dire pourquoi.

**La page distingue désormais trois situations au lieu de deux.** Un compte
existe vraiment (adresse déjà confirmée) → on demande le mot de passe, avec
« Mot de passe oublié ? » à portée de main et, si l'adresse n'a jamais été
confirmée, le bouton pour se renvoyer l'e-mail de vérification. Une trace de
compte sans confirmation → la personne **choisit son mot de passe sur place**
et rejoint dans la foulée : suivre le lien d'invitation reçu dans sa boîte
prouve déjà qu'elle en est propriétaire, ce que l'application faisait déjà
pour une inscription neuve. Aucun compte → l'inscription habituelle, inchangée.

Dans les trois cas la personne repart avec un compte complet : adresse
vérifiée et mot de passe qu'elle a choisi, avec lequel elle se reconnecte
ensuite normalement. Aucun raccourci, aucun compte à moitié créé.

**Et quand un lien de connexion échoue, ça se voit.** Un lien magique expiré
(ils ne durent que quelques minutes) ou déjà utilisé ramenait sur le
formulaire d'invitation sans un mot — d'où l'impression que le bouton ne
faisait rien. Le motif de l'échec est maintenant affiché, avec quoi faire
ensuite.

> **🔧 Notes techniques**
>
> - `invitations.preview` renvoie `accountState: 'none' | 'claimable' |
>   'active'` à la place du booléen `accountExists` : une ligne Better Auth ne
>   vaut pas compte utilisable, `emailVerified: false` veut dire que personne
>   n'a jamais prouvé posséder la boîte mail — donc ce qui est posé dessus ne
>   prouve rien (c'est la position de Better Auth lui-même, cf.
>   `revokeUnprovenAccountAccess`).
> - Nouveau plugin Better Auth `convex/lib/authInvite.ts` — endpoint
>   `POST /invitation/set-password`, chargé dans `convex/auth.ts` et
>   rate-limité (5/min). Gated par le token d'invitation, résolu côté serveur
>   via `internal.invitations.liveInviteEmail` (le body ne fait que
>   recouper). Il jette l'identifiant non prouvé et les sessions en cours,
>   pose le mot de passe choisi et `emailVerified: true`. **Il refuse un
>   compte vérifié** (`account_already_active`) : un token d'invitation ne
>   doit jamais pouvoir écraser le mot de passe d'un compte réel. Il n'ouvre
>   pas de session — le front enchaîne `signIn.email`, comme le fait déjà le
>   parcours d'inscription.
> - `accept-invite.$token.tsx` : trois branches (`SignInToAccept` +
>   « mot de passe oublié » + renvoi de vérification, `CreateAccountCard`
>   avec `claim` true/false), et `validateSearch` sur `error` pour afficher
>   le `?error=` que Better Auth renvoie après un `/magic-link/verify` raté.
> - Couverture : `convex/regression.invitations.test.ts` (les trois
>   `accountState`, `liveInviteEmail`) et `tests/invitations.test.ts`
>   (`isInviteLive`).

## v1.193.2 — 26/08/2026 à 12:10 — Les reports de fonds retrouvent leur véhicule

Un mail de Batch Ventures annonçant la revente d'une de leurs boîtes
revenait « Participation introuvable », alors que le fonds est bien au
portefeuille. Deux raisons, corrigées toutes les deux.

**Le nom de la fiche peut enfin porter votre annotation.** Le circuit
cherche le nom de la société dans le message ; il devait jusqu'ici y
figurer au caractère près, annotation comprise. Une fiche nommée « Batch
Ventures 2025 (Fund n°2) » ne pouvait donc jamais accrocher un mail
intitulé « [Batch Ventures 2025] … ». Désormais ce qui est **entre
parenthèses en fin de nom** est ignoré au moment du rattachement : le nom
sert à reconnaître le message, la parenthèse vous sert à vous. Les espaces
en double ne bloquent plus rien non plus.

La règle de nommage qui en découle : nommez la fiche comme la société ou le
sponsor s'appelle lui-même, et mettez votre repère entre parenthèses à la
fin. C'est ce qui permet aux capital calls envoyés par l'administrateur du
fonds — depuis un domaine qui n'est ni le vôtre ni celui du fonds — de se
ranger quand même au bon endroit.

**Un fonds peut être la participation, pas seulement l'expéditeur.**
Quand un fonds transmettait des nouvelles d'une de ses boîtes, le circuit
cherchait cette boîte-là. Logique pour un véhicule de co-investissement,
faux pour un fonds dont vous êtes souscripteur : la boîte citée n'est pas à
votre portefeuille, le fonds si. Le report se range maintenant sur le
fonds. Si le fonds a plusieurs millésimes, le mail doit toujours nommer
celui qui est concerné — sinon direction la file, plutôt qu'un rangement au
hasard entre deux millésimes.

Inchangé : rien ne se range sans preuve vérifiable, et un mail qui parle de
la famille (« [Batch Ventures] +11 investissements ») sans nommer de
véhicule reste dans les Rapports entrants.

> **🔧 Notes techniques**
>
> - `convex/lib/emailIdentify.ts` : `nameAppearsInText` compare désormais
>   sur `matchableName(name)` — retrait d'un groupe parenthésé **terminal**
>   (une parenthèse au milieu est conservée : `SIDE - ADEQUA (POTIONS) - AB
>   tasty`) et réduction des espaces multiples des deux côtés (le texte est
>   aplati, donc un nom coupé par un retour à la ligne accroche aussi). La
>   recherche reste mot-entier, déterministe, sans fuzzy — le classement par
>   proximité de nom reste proscrit comme critère de rattachement.
> - `identityKey` garde volontairement le nom **complet** : deux entités qui
>   ne diffèrent que par leur annotation restent deux participations, et un
>   mail nommant les deux part en `ambiguous`. Aucun impact sur le fan-out
>   multi-org ni sur la règle des domaines de sponsors.
> - `convex/reportIdentify.ts` : le prompt d'identification tranche le cas
>   `is_fund_forward` sur la liste des candidats, les deux lectures étant
>   exclusives (la cible du report si elle y figure, sinon le fonds
>   lui-même). La corroboration par domaine n'est plus neutralisée sur un
>   transfert de fonds — elle ne peut de toute façon corroborer qu'un
>   candidat dont le domaine **est** celui de l'auteur, donc le fonds ; sur
>   un domaine portant plusieurs millésimes (`batch.ventures` en porte
>   quatre) la règle des domaines partagés continue d'exiger le nom.
> - Tests : `tests/emailIdentify.test.ts` (annotation terminale, parenthèse
>   médiane, double espace, retour à la ligne, discrimination entre
>   millésimes, mail « famille » qui ne nomme rien).
> - Suite : renommer les fiches Batch en prod pour qu'elles portent le
>   libellé du sponsor, et passer les autres familles (Parallel, Sezame,
>   Anaxago) au même crible.

---

## v1.193.1 — 26/08/2026 à 12:03 — Le mail de report annonce le versé, pas l'engagé

Sur le premier report reçu en vrai, la ligne de fiche du mail était vide. Elle
affichait le montant **engagé**, or ce champ n'est presque jamais rempli côté
Calte : 275 des 280 lignes d'investissement n'en ont pas. La ligne aurait donc
disparu sur la quasi-totalité des reports.

Elle affiche désormais le **versé** — ce qui est réellement sorti en banque sur
les deals de la société, au centime, comme partout ailleurs dans l'app dès
qu'un chiffre vient d'un mouvement bancaire — avec le mois depuis lequel.

Deux précisions : une distribution qui revient ne vient jamais en déduction du
versé (c'est du Reçu, une autre colonne), et un deal signé mais pas encore
financé fait disparaître la ligne plutôt que d'annoncer « Versé : 0 € ».

> **🔧 Notes techniques**
>
> - `reportNotify.entityCards` somme `deals.transactionTotals(...).paidActual`
>   sur les deals de la société au lieu de `committedAmount`. Le champ de
>   `ReportEntityCard` devient `paidCents`.
> - Rendu par `EUR_CENTS_FMT` (2 décimales) et non `EUR_FMT` : un versé est un
>   montant réel, cf. « l'actuel au centime, l'estimé arrondi ».
> - `paid > 0 ? paid : undefined` — pas de « Versé : 0 € » sur un deal signé
>   non financé.
> - `regression.reportAudience.test.ts` : deux cas neufs — la somme ignore les
>   entrées et couvre plusieurs deals sans `committedAmount` ; un deal engagé
>   sans transaction ne produit aucun chiffre.

---

## v1.193.0 — 26/08/2026 à 11:03 — Le mail qui dit vraiment ce que le report raconte

Transférer un investor update donnait jusqu'ici un accusé de deux lignes :
« bien reçu, ça suit son cours ». Le même message que ça se soit rangé ou
non — donc un message qui pouvait mentir. Il est remplacé par un vrai mail.

**Quand le report est rangé**, tu reçois la société et son logo,
l'organisation où il a été rangé, la ligne de fiche (total investi, date du
premier investissement, période du report précédent), **ce que dit ce
report en trois points**, la **carte de synthèse de la boîte** telle qu'elle
s'affiche sur sa fiche — note de santé, résumé, points forts, points de
vigilance et les trois KPI suivis — et un bouton qui ouvre la fiche.

Ce mail attend que l'analyse de la boîte soit à jour avant de partir. Il
arrive quelques dizaines de secondes après le rangement, mais la synthèse
qu'il porte tient compte du report qu'on vient de recevoir, pas du
précédent.

**Quand ça coince**, celui qui a transféré reçoit un message court : son
mail est bien arrivé, il n'a pas pu être rangé, l'équipe a été prévenue et
s'en occupe. Ni la cause, ni le nom de la société, ni de lien — rien sur
quoi il pourrait agir. Quand c'est réparé, il reçoit la confirmation
complète, qui rappelle en une ligne que c'est la suite du blocage. C'est ce
qui permet de confier l'adresse de transfert à quelqu'un sans jamais lui
envoyer une erreur technique.

Pour que cette phrase reste vraie, **la liste de ceux qui reçoivent les
erreurs ne peut plus être vidée** : impossible de décocher la dernière
personne, et la liste s'affiche désormais en clair sous le tableau des
alertes, dans Réglages → Membres.

**Les autres membres de l'organisation sont maintenant prévenus** qu'un
report est arrivé : ils reçoivent le même mail, précédé de qui l'a
transféré. Ça vaut aussi pour un report déposé à la main depuis une fiche
société. Une nouvelle case « Nouveaux reports » permet de couper cet envoi.

**Et si vous transférez le même report à deux**, le second reçoit un accusé
court — « ce report était déjà là, il a été rafraîchi » — et **personne
d'autre n'est dérangé** : il n'y a pas de nouvelle à annoncer.

> **🔧 Notes techniques**
>
> - `emailTemplates.ts` : `reportReceiptHtml()` (sans argument, volontairement
>   identique succès/échec) est remplacé par `reportConfirmationHtml`,
>   `reportSoftFailureHtml` et `reportDuplicateHtml`. `reportRecapSuccessHtml`
>   disparaît au profit de `qualityBlocks()`, désormais un **bloc optionnel**
>   de la confirmation (`ReportRecapData` → `ReportQuality`). Mise en page en
>   `<table>` avec hauteurs fixes sur les tuiles KPI ; tokens de marque
>   convertis en hex (`#009966` / `#e7000b` / `#d27c1b`) et anneau de score SVG
>   remplacé par un carré bordé — Gmail supprime le SVG des mails reçus.
> - `lib/reportRouting.ts` : `routeRecap` gagne un troisième axe (`broadcast`)
>   et le kind `duplicate`. Le canal suit le geste, le contenu suit le rôle
>   (`withQuality`), l'audience suit l'événement.
> - `reportStore.storeForCompany` retourne `{ reportId, created }` ; une
>   fan-out où rien n'a été créé bascule en `kind: 'duplicate'` — pas de
>   diffusion.
> - `intelligence.runAnalysisBatch` remplace les `runAnalysis` fire-and-forget
>   par entité et déclenche l'envoi **à la fin** des analyses. Une analyse en
>   échec ne retient pas le mail (la confirmation part sans la carte).
> - `reportNotify` : mails construits **par destinataire**. `entityCards`
>   filtre sur `organizationMembers` (montants et liens jamais hors org),
>   agrège les deals via `by_org_target` et lit `companyIntelligence`.
>   `broadcastTargets` exclut le transféreur et respecte le nouveau kind
>   `reportAdded`. `claimNotify` retourne `previousKind`, ce qui donne la
>   ligne « le report qui coinçait est maintenant rangé ».
> - `lib/reportRecipients.ts` : définition unique des destinataires
>   `reportIssues`, utilisée par l'envoi, par l'écran et par le garde-fou
>   `last_report_recipient` dans `organizations.setMemberAlertPref`. Nouvelle
>   query `listReportIssueRecipients` + lecture en clair dans `AlertPrefsCard`.
> - Le dépôt manuel (`origin: 'upload'`) ne répond plus « rien à personne » :
>   pas de fil où répondre, mais la diffusion org a lieu (repli sur
>   `AGENTMAIL_INBOX_ID`).
> - Env : poser `LOGO_DEV_TOKEN` (ou `VITE_LOGO_DEV_TOKEN`) côté Convex pour
>   les logos dans les mails ; sans elle, initiale de la société.
> - Tests : `regression.reportAudience.test.ts` (10 cas) couvre le routage,
>   le cloisonnement multi-org, la diffusion et le garde-fou.

## v1.192.1 — 26/08/2026 à 09:22 — Transférer un report ne remplit plus ta boîte

Un seul investor update transféré à l'adresse dédiée pouvait produire
**quatre accusés de réception**, étalés sur plusieurs jours, sans que
personne ne comprenne pourquoi. Le record signalé : une quarantaine de mails
pour une seule série de reports.

La cause n'était pas un emballement du circuit, mais une règle mal posée. Les
deux boutons de la file « Reports entrants » — **Retraiter** et **Rattacher** —
rejouent tout le traitement, et ils remettaient au passage le compteur
d'accusés à zéro. Chaque clic renvoyait donc un mail à la personne qui avait
transféré le report. C'est logique vu du code, absurde vu de la boîte mail :
elle a envoyé un email une fois, et se retrouve à recevoir le journal de bord
de tout ce qu'on fait ensuite de son côté.

Désormais : **un transfert, une réponse.** Retraiter et Rattacher rejouent le
circuit **en silence**. Le résultat de la relance se lit là où tu l'as
déclenchée — dans la file, où le statut de la ligne se met à jour — et plus
dans la boîte de quelqu'un d'autre.

Une exception, et une seule : la bonne nouvelle. Quand une ligne qui avait
annoncé un problème finit par passer, le transféreur reçoit **un** dernier
mail pour le lui dire. Il avait été prévenu que ça coinçait, il est prévenu
que c'est réglé. À l'inverse, une relance qui échoue encore ne dit rien : ce
constat ne lui demande aucun geste, et la file l'affiche déjà.

Un cas ancien reste muet : un report reçu **avant** cette mise à jour et
réparé à la main aujourd'hui n'enverra pas son mail de bonne nouvelle. Son
historique ne dit pas ce qui lui avait été annoncé, et entre risquer un mail
de trop et un mail de moins, le circuit choisit le silence.

> **🔧 Notes techniques**
>
> - `inboundEmails.notifiedAt` est la **seule** barrière anti-doublon, et elle
>   est posée par ligne. `reportInbox.reprocess` et `assignCompany` (branche
>   non-additive) la remettaient à `undefined` : c'est le bug, pas le
>   pipeline. Les deux mutations ne touchent plus au champ.
> - Nouveau `inboundEmails.notifiedKind`
>   (`success` | `failure` | `quarantine`) : ce que le dernier mail a annoncé.
>   `reportNotify.claimNotify` prend désormais le `kind` et arbitre —
>   première prise toujours accordée ; ensuite refus, **sauf** `success` sur
>   une ligne dont le dernier mot était `failure`/`quarantine`. Un `notifiedAt`
>   sans `notifiedKind` (lignes antérieures) est traité comme définitif :
>   biais assumé vers le silence.
> - Diagnostic conduit sur les vrais mails (en-têtes bruts) et non sur les
>   logs : les quatre accusés Corma portent le **même** `In-Reply-To`, donc
>   aucune boucle d'emails ni ligne dupliquée — c'était bien une seule ligne
>   ré-autorisée à parler. `reprocess`/`assignCompany` ne sont appelées que
>   depuis `src/routes/app/all/reports.tsx` : aucun cron, aucun outil agent
>   ou MCP ne peut déclencher un accusé.
> - `convex/regression.reportNotifyReplay.test.ts` (8 cas : première prise,
>   5 relances muettes, échec après échec, mail de réparation unique,
>   quarantaine réparée, ligne sans genre, et les deux mutations qui
>   conservent `notifiedAt`). **Vérifié rouge** contre l'ancien code — les 8
>   échouent. 135 tests de régression Convex, 297 unitaires.
> - `TESTING.md` : R28 précisé, R29b et R29c ajoutés. Piège consigné dans
>   `KNOWN_ISSUES.md` § « `notifiedAt` est un droit de parole ».

## v1.192.0 — 25/08/2026 à 18:54 — L'assistant passe sur un moteur plus rapide

L'assistant de l'app change de moteur : il tourne désormais sur la génération
**Flash** du modèle DeepSeek, là où il utilisait jusqu'ici la génération
**Pro**. Concrètement, ses réponses arrivent plus vite, et il coûte environ
neuf fois moins cher à faire tourner — pour un coût de fonctionnement qui
devient marginal à notre volume.

Rien ne change dans ce qu'il sait faire : mêmes accès à vos données, mêmes
outils, mêmes demandes de confirmation avant toute écriture. Le même moteur
alimente aussi, en arrière-plan, la lecture des reportings reçus par email,
l'enrichissement des fiches sociétés et les synthèses de participations.

Une nuance à connaître : le moteur est déclaré sous sa forme « dernière
version en date ». Il suivra donc automatiquement les prochaines versions de
cette génération, sans intervention de notre part. Si l'assistant se met un
jour à répondre différemment sans que rien n'ait été modifié dans l'app,
c'est la première piste à regarder.

> **🔧 Notes techniques**
>
> - `convex/lib/instructions.ts` : `AGENT_MODEL` par défaut passe de
>   `deepseek/deepseek-v4-pro` à `~deepseek/deepseek-v4-flash-latest`. Source
>   unique inchangée, toujours surchargeable par la var d'env Convex
>   `OPENROUTER_MODEL`. Aucun autre code touché — `getModel()`
>   (`convex/agent.ts`) et ses cinq consommateurs (`reportStore`,
>   `companyEnrichment`, `reportIdentify`, `intelligence`,
>   `migrations/alboDocBackfill`) héritent du changement.
> - Le slug retenu est l'**alias** OpenRouter préfixé `~`, qui redirige
>   aujourd'hui vers `deepseek/deepseek-v4-flash-0731` (1,31 M tokens de
>   contexte, `tools` + `structured_outputs` supportés — donc `generateObject`
>   et l'approbation d'outils fonctionnent à l'identique). Choix assumé de
>   l'alias plutôt que du slug daté : arbitrage produit, le compromis est
>   documenté.
> - Le system prompt reste littéralement vrai (« You run on the DeepSeek
>   model … ») : on ne change pas de famille, donc pas de correction de
>   wording. En revanche l'agent annonce désormais un alias de routage comme
>   son id, et non un deployment id — le modèle réellement servi se lit dans
>   le champ `model` des lignes `llm_usage` (logs Convex).
> - Le prompt caching côté DeepSeek reste automatique sur le préfixe partagé
>   (system prompt + schémas d'outils), sans clé de cache à injecter : le
>   wrapper `fetch` supprimé à l'époque de Mistral n'a pas à revenir.
> - `KNOWN_ISSUES.md` § « Modèle de l'agent » : nouvelle puce sur l'alias
>   mouvant (surface d'impact au-delà du chat + id annoncé ≠ deployment id) et
>   la commande pour figer sur le slug daté si besoin. Défaut mis à jour dans
>   `CLAUDE.md`, `README.md`, `.env.example` et `TESTING.md`.
> - ⚠️ Le code ne porte que le **défaut**. Si `OPENROUTER_MODEL` est déjà posé
>   sur le déploiement prod, c'est lui qui gagne : le basculement effectif
>   demande `pnpm exec convex env set --prod OPENROUTER_MODEL "~deepseek/deepseek-v4-flash-latest"`
>   (ou la suppression de la variable pour retomber sur le défaut du code).

## v1.191.0 — 25/08/2026 à 14:45 — Un document ne peut plus rester « en cours de lecture » pour toujours

Quand un document entre dans l'app, son texte est lu automatiquement — c'est
ce qui le rend consultable et surtout trouvable par l'assistant. Jusqu'ici, si
cette lecture s'interrompait en cours de route, le document restait affiché
« Lecture en cours… » **indéfiniment**, et personne n'avait de raison de s'en
apercevoir : dans la liste il a l'air parfaitement normal, il s'ouvre, il se
télécharge. Seul l'assistant savait qu'il ne l'avait jamais lu — et il ne le
disait pas.

Ce n'était pas « un document en moins ». Sur la fiche Hectarea, le PV
d'assemblée générale signé est resté bloqué quatre mois, pendant lesquels
toute question sur cette AG était répondue depuis un **extrait caviardé** du
même PV, où plusieurs décisions sont remplacées par des « […] ». C'est la
mauvaise version qui faisait autorité, en silence.

Désormais, une lecture qui ne revient pas est reprise automatiquement dans
l'heure. Si la seconde tentative échoue elle aussi, le document bascule en
rouge **« Lecture jamais terminée »**, avec son bouton de relance manuelle à
côté. Le principe : mieux vaut une alerte visible qu'une attente éternelle
qui ressemble à du normal.

Au passage, l'outil de contrôle des imports en masse de documents a été
corrigé : il était censé signaler les fichiers déposés deux fois, mais il
reconnaissait un doublon exactement de la même façon que le mécanisme censé
les empêcher — il ne pouvait donc signaler que ceux qui n'avaient jamais eu
lieu. Il compare maintenant les titres à la façon d'un lecteur humain, en
ignorant tirets, majuscules et accents, et il ne se laisse plus tromper par
les quelques octets d'écart entre deux exports du même PDF. Les quatre
doublons déjà présents sur Hectarea, eux, restent à supprimer à la main : ce
correctif regarde vers les prochains imports, il ne touche à aucune donnée.

> **🔧 Notes techniques**
>
> - `convex/documentsExtract.ts` : nouvelle `sweepStalePending`
>   (`internalMutation`), branchée sur un cron horaire dans `convex/crons.ts`.
>   `run` est un monde clos (finit toujours sur `extracted`/`skipped`/`failed`),
>   donc un `pending` qui survit = action morte en route. Deux étapes pour ne
>   pas boucler sur un OCR facturé : relance + estampille
>   `ocrDetail: 'sweep_retry'`, puis abandon sur `failed`/`stuck_pending`.
>   L'estampille vit dans `ocrDetail` (invisible tant que l'état est `pending`,
>   et `documents:reextract` la nettoie déjà → une relance humaine ré-arme la
>   reprise auto). Nouvel index `documents.by_ocr_state`
>   (`['ocrState','uploadedAt']`), période de grâce d'1 h, lot de 20.
> - `convex/lib/duplicates.ts` : `normalizeDocumentTitle` +
>   `groupDuplicateDocuments`, clé société + titre normalisé, **taille exclue**.
>   `migrations/legalDocsImport.ts:verify` s'y branche et renvoie désormais des
>   groupes `{ company, rows: [{ _id, title, size }] }` — les tailles servent à
>   arbitrer, plus à identifier. Le garde-fou d'`attachBatch` garde sa clé
>   stricte : il supprime le blob qu'il saute, un faux positif y détruirait un
>   vrai document.
> - Régression : `convex/regression.docHygiene.test.ts` (7 cas — machine à
>   états du sweep, et les 4 vraies paires Hectarea vs leurs voisins distincts).
>   Vérifié rouge avec l'ancienne clé.
> - i18n `participations:documentReading.detail.stuck_pending` (EN/FR).
>   Docs : `KNOWN_ISSUES.md` (2 sections), `TESTING.md` TP6e,
>   `docs/produit/04-participations.md`, `MIGRATIONS.md`.
> - Effet de bord attendu au déploiement : le PV d'AG Hectarea (`pending`
>   depuis avril) est repris dès le premier passage du cron. Cf. ALB-127.

---

## v1.190.7 — 24/08/2026 à 11:44 — Deux pièges d'outillage consignés pour la prochaine fois

Rien de visible dans l'app. Cette version écrit noir sur blanc deux pièges
rencontrés en coulisses, pour que la prochaine personne — ou le prochain
assistant — ne reperde pas le même temps dessus.

Le premier touche à la confiance qu'on peut accorder à une réponse. Quand
l'assistant va lire directement dans la base, il passe par un outil qui choisit
une fois pour toutes, au moment où il démarre, la base qu'il va interroger — et
ne revient jamais sur ce choix. S'il s'est fixé sur la base de test, vide, au
lieu de celle de production, il continue d'y répondre sans le moindre message
d'erreur : des tableaux vides, des montants qui ne correspondent à rien, et
aucun signe que la question a simplement été posée au mauvais endroit. Le mode
d'emploi est maintenant écrit — comment repérer le cas en cinq secondes,
comment le corriger, et lequel des deux outils fait foi quand ils se
contredisent.

Le second est une correction d'inventaire : un décompte interne annonçait onze
fichiers là où il n'en reste que trois. Le chiffre était devenu faux à la
dernière mise à jour, et il était écrit d'une façon qui le rendait
invérifiable. Les trois fichiers sont désormais nommés un par un.

> **🔧 Notes techniques**
>
> - Nouvelle section `KNOWN_ISSUES.md` « Serveur MCP du CLI Convex : le
>   déploiement est figé au démarrage du process ». Cause vérifiée dans
>   `convex@1.42.3` : `cli/mcp.js:47` garde le process vivant, et
>   `cli/lib/deploymentSelection.js:360-361` appelle `dotenv.config()`, qui
>   n'écrase jamais une clé déjà présente dans `process.env` — la première
>   lecture de `CONVEX_DEPLOYMENT` est donc figée pour la vie du process, là où
>   le CLI repart d'un process neuf à chaque commande. C'est toute l'asymétrie.
> - Aggravants : `status.js:40-42` conseille explicitement le déploiement dev
>   (« Generally default to using the development deployment ») alors que le
>   repo est prod-only ; `status.js:66` fait un `process.chdir` qui donne
>   l'illusion d'une re-résolution ; le `deploymentSelector` est un jeton opaque
>   décodé sans revalidation (`requestContext.js:96-101`) ; et le `.mcp.json` du
>   plugin `convex@claude-plugins-official` ne passe aucun flag.
> - Remèdes documentés : le CLI (`convex run --prod`) fait foi ; croiser l'URL
>   renvoyée par `status` avec `VITE_CONVEX_URL` ; redémarrer Claude Code pour
>   dégeler le process ; `--prod` **plus** `--cautiously-allow-production-pii`
>   pour viser la prod, en sachant que le second lève un garde-fou PII.
>   Distinction posée avec les deux autres « MCP » du repo (`convex/mcp/` et les
>   serveurs tiers), rappelée dans `CLAUDE.md`.
> - `KNOWN_ISSUES.md` § « Skills vendorisées » : 11 → **3** fichiers hors
>   périmètre, nommés (`convex-create-component/agents/openai.yaml`,
>   `convex-create-component/assets/icon.svg`, `frontend-design/LICENSE.txt`).
>   Le glob `convex-*/…` rendait le décompte invérifiable ; #399 avait emporté
>   les 8 autres avec les anciennes skills Convex. Arbitrage inchangé — ce ne
>   sont pas des instructions lues par un agent — mais désormais étayé : les
>   trois sont byte-identiques à l'upstream aux `pinnedRef` du lock. La règle
>   absolue de `CLAUDE.md` est qualifiée en conséquence (fichiers
>   d'instruction, exception documentée pour les annexes).
> - Aucun fichier vendorisé ni `skills-lock.json` touché : pas de churn de
>   `computedHash`, parité de hash avec le template préservée. Le piège MCP est
>   ajouté à `TEMPLATE_SYNC.md` — le template ship le même plugin non flagué.

## v1.190.6 — 24/08/2026 à 10:48 — Les fiches Convex de l'assistant remises à jour

Rien de visible dans l'app. Cette version répare les « fiches de procédure »
que l'assistant IA lit avant de toucher au code de la base de données.

Convex a refait toute sa bibliothèque de fiches début août : trois des nôtres
n'existaient plus sous leur ancien nom, et le contrôle automatique passait au
rouge à chaque ouverture de session. Les fiches sont repointées vers leurs
remplaçantes, les anciennes supprimées, et les deux contrôles (intégrité de
notre copie, et fraîcheur par rapport à l'original) repassent au vert.

Deux fiches proposées par Convex ont été écartées volontairement : l'une
poussait à installer un système de connexion concurrent du nôtre, l'autre ne
renvoyait que vers des fiches qu'on n'a pas. Une troisième a été retirée : elle
ne sert plus qu'à créer une application neuve, ce qui n'a pas d'objet ici.

> **🔧 Notes techniques**
>
> - `get-convex/agent-skills@90ae2c3` (01/08/2026) régénère tout le repo
>   depuis le hub `convex-agents` : ~33 `SKILL.md` par _capability_, toutes
>   préfixées `convex-`, plus aucun répertoire `references/`. Le commit
>   annonce lui-même les suppressions.
> - `skills-lock.json` : `convex-migration-helper` → `convex-migrate`,
>   `convex-performance-audit` → `convex-advisor`, `convex-setup-auth` →
>   `convex-authz` (clé, `skillPath`, `references` retiré). Les six entrées
>   `get-convex/agent-skills` passent de `ec1e6ba` à `6843b65`.
>   `convex-create-component` est exempté du générateur en amont : contenu
>   inchangé. `convex-quickstart` est **retirée** du lock : régénérée, elle
>   échafaude désormais une app Next.js neuve — sans objet sur un repo
>   existant, et un risque d'activation à contretemps.
> - Écarts assumés vs le mapping upstream : pas de `convex-auth` (installe
>   `@convex-dev/auth`, concurrent de notre Better Auth), pas de
>   `convex-optimize` (délègue à `launch-readiness` / `check-updates` /
>   `sentinel`, non vendorisées).
> - `--update` n'a pas été utilisé : il re-pinne toutes les familles du lock.
>   SHA écrit à la main sur les seules entrées Convex, puis
>   `pnpm run sync:skills` (mode auto-réparateur).
> - Le script ne prune pas : les trois `.agents/skills/<ancien-nom>/` et leurs
>   symlinks `.claude/skills/` supprimés à la main, sinon ils restent chargés
>   par Claude Code tout en étant invisibles de `--check` et de `--verify`.
> - Overrides projet ajoutés dans `CLAUDE.md` : `convex-authz` impose
>   `requireIdentity`/`requireOwner` dans `convex/model/auth.ts` — à traduire
>   vers `convex/lib/auth.ts` (`requireAppUser`, `requireOrgMember`,
>   `requireOrgRole`), notre ownership passant par `organizationMembers` et
>   non par un champ `ownerId`. Le routeur `convex` fetche désormais un
>   catalogue servi en HTTP, hors portée du lock.
> - Piège documenté dans `KNOWN_ISSUES.md` (404 ≠ dérive nominale ;
>   `--update` ne répare pas un `skillPath` mort) et candidat template
>   ajouté à `TEMPLATE_SYNC.md` — le template ship le même lock périmé.

## v1.190.5 — 24/08/2026 à 10:39 — Le contrôle quotidien de la prod refonctionne, et l'état du projet vient à vous

Deux corrections qui vont ensemble, et une leçon qui les relie.

**Le contrôle quotidien de la prod était aveugle depuis le 31 juillet.** Chaque
matin, un robot vérifie qu'Albo OS répond. Le 30 juillet, l'adresse qu'il
visite a été remplacée par une page inexistante — sans doute pour tester
l'alerte, puis oubliée. Depuis, il visitait une page introuvable, en concluait
que la prod était morte, et rédigeait un rapport. Vingt-cinq jours de suite.
La prod, elle, allait très bien. L'adresse est remise, le contrôle vérifié,
le rapport refermé.

**Le point commun avec ce qui précède** : l'alerte fonctionnait parfaitement.
Elle écrivait, tous les jours, au bon endroit — un endroit où personne ne
passe. Le robot de mise à jour des dépendances a échoué tous les lundis
pendant un mois de la même façon. Et cinq demandes de modification attendent
depuis un mois et demi.

**D'où la seconde correction** : quand vous ouvrez une session de travail sur
le projet, vous voyez maintenant, en une ligne, ce qui attend — les robots en
échec et les demandes en attente. L'information vient à vous là où vous
travaillez déjà, au lieu de s'empiler dans un onglet. Et surtout : **elle se
tait quand tout va bien**, sinon elle deviendrait à son tour du bruit qu'on
apprend à ignorer.

> **🔧 Notes techniques**
>
> - **`PROD_URL`** : variable de dépôt remise de
>   `https://os.alboteam.com/zz-nexiste-pas` à `https://os.alboteam.com`.
>   `prod-smoke` relancé à la main → **success**. Issue #342 (24 commentaires
>   sur 25 jours) refermée avec l'explication.
> - **`scripts/session-status.mjs`** + entrée dans le hook `SessionStart` de
>   `.claude/settings.json` (et script `session:status` pour l'usage manuel).
>   Deux appels `gh` (`pr list`, `run list --branch main`), ~2 s. Ne retient
>   que le run le plus récent de chaque workflow — un échec ancien déjà repassé
>   au vert est de l'histoire, pas un problème en cours.
> - Deux propriétés à préserver : **sortie vide quand tout est propre**, et
>   **jamais d'échec de session** (`gh` absent, hors ligne ou déconnecté →
>   exit 0 silencieux). Appelé via `node` et non `pnpm run`, pour éviter la
>   sonde de dépendances que pnpm exécute avant chaque script.
> - **`TEMPLATE_SYNC.md`** : deux affirmations que j'avais écrites sans
>   vérifier sont corrigées. Le template n'a **jamais** porté le placeholder
>   `allowBuilds` (son `pnpm-workspace.yaml` n'a pas bougé depuis mai — le
>   placeholder venait d'Albo OS), et il a pinné `packageManager` avec un hash
>   d'intégrité dès le 20/08, plus strict que ce qu'on fait ici. La ligne passe
>   en « already upstream ». La règle « jamais de champ `engines` » est
>   resserrée : elle dépend du `nodeVersion` du projet Vercel, et le template
>   en déclare un sans dommage.
> - **`TEMPLATE_SYNC.md`** : ligne « vulnérable maintenant » sur le template —
>   son lockfile épingle `better-auth@1.6.14` et il charge `magicLink()`, donc
>   tout projet démarré depuis lui naît dans la plage de l'advisory.
> - **`KNOWN_ISSUES.md`** : nouvelle section « Une alerte qui marche n'est pas
>   une alerte qui arrive » (les trois cas mesurés, et la question à se poser
>   pour tout nouvel automatisme), et la section `update-deps` passe en
>   « résolu » — la politique d'org a été levée, le drapeau du dépôt basculé,
>   et le premier run complet a produit la PR #398.

## v1.190.4 — 24/08/2026 à 09:56 — L'alerte de mise à jour dit enfin ce qui a lâché

Petit correctif sur le ticket d'alerte ouvert automatiquement quand la mise à
jour hebdomadaire des dépendances échoue.

Il affirmait systématiquement qu'une dépendance ne compilait plus. C'était
faux la dernière fois : tout compilait très bien, c'est l'ouverture de la
demande de modification qui avait été refusée pour une raison de droits. Une
alerte qui se trompe de diagnostic envoie chercher au mauvais endroit.

Le ticket **nomme désormais l'étape qui a réellement échoué**, et se contente
de citer les causes déjà rencontrées à titre indicatif au lieu d'en désigner
une.

> **🔧 Notes techniques**
>
> - `.github/workflows/update-deps.yml`, step `Open or update failure issue` :
>   le corps du ticket interrogeait zéro API et présumait la cause. Il appelle
>   maintenant `actions.listJobsForWorkflowRun` pour retrouver le premier step
>   en `conclusion === 'failure'` et l'afficher. Appel dans un `try/catch` —
>   lever l'alerte prime sur le détail, une API en erreur ne doit pas avaler
>   la notification.
> - **Piège associé** : déclarer un bloc `permissions:` met à `none` tout
>   scope non listé. L'appel exigeait donc d'ajouter `actions: read`, sans
>   quoi le `catch` aurait avalé un 403 en silence et l'alerte serait restée
>   muette sur l'étape.
> - La ligne « Étape en échec » est un élément de tableau `null` filtré avant
>   le `join`, pour ne pas laisser de ligne vide quand l'API n'a rien pu dire.
> - **Contexte** : découvert en déclenchant le job à la main après le
>   correctif `unstorage`. `lint`, `test:unit` et `build` passent tous
>   désormais ; le job bute sur `Open PR` avec « GitHub Actions is not
>   permitted to create or approve pull requests » — une politique de
>   l'organisation GitHub, pas un problème de code. Documenté dans
>   `KNOWN_ISSUES.md`.

## v1.190.3 — 20/08/2026 à 18:11 — Le robot de mise à jour repasse au vert

Suite directe des deux versions précédentes, et fin de l'histoire : la mise à
jour hebdomadaire des dépendances fonctionne à nouveau de bout en bout.

Une fois la faille de connexion corrigée, le robot est allé plus loin qu'avant
mais butait encore, sur un tout autre obstacle : une brique technique publiée
en amont dans un état cassé, qui réclamait un composant qu'elle avait oublié
d'emporter avec elle. La version précédente de cette brique est désormais
maintenue en place explicitement, le temps que l'éditeur corrige.

Aucun effet visible dans l'app. Ce qui change : les mises à jour de sécurité
et de correctifs recommenceront à arriver toutes seules chaque lundi.

> **🔧 Notes techniques**
>
> - **Symptôme** : `pnpm build` mourait avant de démarrer, sur un
>   `failed to load config from vite.config.ts` suivi d'un
>   `ERR_MODULE_NOT_FOUND` réclamant le paquet `destr`, importé depuis
>   `unstorage@2.0.0-alpha.8`.
> - **Cause** : publication cassée en amont. Le `dist/index.mjs` d'alpha.8
>   importe `destr` cinq fois et son manifeste ne déclare **aucune**
>   dépendance. Sur une install propre, rien d'autre n'amène `destr` dans
>   l'arbre. alpha.7 ne marche que parce qu'elle n'importe pas encore `destr` —
>   toute la ligne `2.0.0-alpha.*` déclare zéro dépendance.
> - **Chemin** : `nitro@3.0.260429-beta` dépend de `unstorage: ^2.0.0-alpha.7`,
>   et un caret sur une **préversion** accepte les préversions suivantes — d'où
>   le passage en alpha.8. Retomber sur la stable `1.17.5` (qui, elle, déclare
>   bien `destr`) est impossible : hors de la plage de nitro.
> - **Correctif** : `pnpm.overrides` → `"unstorage": "2.0.0-alpha.7"`, le
>   patron déjà documenté dans `KNOWN_ISSUES.md`, avec sa condition de
>   déblocage (une alpha dont `npm view … dependencies` renvoie enfin quelque
>   chose).
> - **Vérification** : job du lundi rejoué **sur arbre vierge** — `pnpm update`
>   complet (37 deps directes), puis `rm -rf node_modules`, `pnpm install`,
>   `lint`, `test:unit`, `test:convex` (120/120), `build` — tous verts.
> - **Leçon, ajoutée à `KNOWN_ISSUES.md`** : ce type de bug est **invisible sur
>   un `node_modules` chaud**, une copie résiduelle du paquet manquant
>   satisfaisant l'import. C'est ce qui a produit un « build vert » local
>   erroné à la version précédente, pendant que la CI voyait juste. Toute
>   vérification de dépendance passe désormais par
>   `rm -rf node_modules && pnpm install && pnpm build`.

## v1.190.2 — 20/08/2026 à 13:03 — Faille de connexion par lien magique corrigée

**À lire même si le reste ne vous intéresse pas.** La bibliothèque qui gère la
connexion à Albo OS portait une faille classée **sévère**, qui touche
précisément le mode de connexion utilisé ici : le lien magique reçu par
e-mail. Elle permettait, dans certaines conditions, de prendre la main sur un
compte en le « préparant » avant que son propriétaire ne se connecte pour la
première fois.

Albo OS tournait sur une version vulnérable. Cette mise à jour installe la
version corrigée. **Rien à faire de votre côté**, aucun changement visible à
l'usage, et les sessions ouvertes restent valides.

Pourquoi ça n'avait pas été corrigé plus tôt : la version corrective était
mécaniquement bloquée. L'outil qui met les dépendances à jour chaque semaine
échouait, parce qu'un composant intermédiaire refusait cette nouvelle version
— c'est ce blocage qui a été levé au passage, et il l'est pour de bon.

> **🔧 Notes techniques**
>
> - **Faille** : `GHSA-qq9h-g4jm-xgf3`, sévérité **high** — « Account takeover
>   via pre-account hijacking on magic-link and email-OTP sign-in ». Plage
>   vulnérable `>= 1.1.3, < 1.6.22`, corrigée en **1.6.22**. La prod tournait
>   en `better-auth@1.6.16` et `convex/auth.ts` charge bien `magicLink()` :
>   exposition directe. `pnpm audit` passe de 28 vulnérabilités (14 high) à 27
>   (13 high), l'advisory disparaît.
> - **Ce qui bloquait** : `@convex-dev/better-auth` casse le typage à partir
>   de `better-auth@1.6.18` — `useSession().data` s'effondre en `never`, d'où
>   `TS2322` sur la prop `authClient` de `ConvexBetterAuthProvider`
>   (`src/routes/__root.tsx:111`). Cause amont : better-auth 1.6.18+ expose
>   des types de retour **nommés** (`ReactAuthClient`) là où c'était un type
>   structurel anonyme, et le `AuthClient` du composant
>   (`Omit<BetterAuthClientPlugin, …>` autour de `PluginsWithoutCrossDomain`)
>   ne s'unifie plus. Suivi amont : `get-convex/better-auth#420` (ouvert,
>   confirmé par deux tiers, reproduit jusqu'en 1.6.25).
> - **Bisect** (le tableau qui justifie le pin) :
>
>   | adapter | better-auth | `tsc` | `test:convex` |
>   | ------- | ----------- | ----- | ------------- |
>   | 0.12.2  | 1.6.16      | ✅    | ✅            |
>   | 0.12.2  | **1.6.30**  | ✅    | ✅            |
>   | 0.12.3  | 1.6.30      | ✅    | ❌ timeouts   |
>   | 0.12.4  | 1.6.30      | ❌    | —             |
>   | 0.12.5  | 1.6.30      | ❌    | —             |
>
>   L'échappatoire est donc l'adapter **0.12.2**, celui déjà en prod : il
>   accepte la version corrigée. 0.12.3 typecheck mais ralentit le harness
>   `convex-test` au point de faire expirer 2 à 4 tests sur 120 (timeout 5 s,
>   nombre variable d'un run à l'autre) — écarté aussi.
>
> - **Changement** : `@convex-dev/better-auth` épinglé en **exact** `0.12.2`
>   (un `^` ou un `~` laisserait passer 0.12.3+ en 0.x), et `better-auth` en
>   `~1.6.30` — patches 1.6.x automatiques, jamais 1.7.x qui sort de la plage
>   de peer de l'adapter (`>=1.6.9 <1.7.0`) et supprime l'export
>   `better-auth/plugins#mcp` dont `convex/auth.ts` dépend.
> - **Vérification** : `pnpm update` complet (37 deps directes) puis `lint` /
>   `test:unit` / `test:convex` ×3 / `build` — tous verts, adapter maintenu en
>   0.12.2. Le job hebdomadaire n'est donc plus bloqué. Les 37 bumps ne sont
>   **pas** dans cette PR : ils partiront dans la PR du job, séparément.
> - **Condition de déblocage du pin** : documentée dans `KNOWN_ISSUES.md`
>   § « `@convex-dev/better-auth` : fenêtre de versions verrouillée ».

## v1.190.1 — 20/08/2026 à 11:51 — Les mises à jour de dépendances repartent

Rien de visible dans l'app : cette version répare l'outillage qui la
construit.

Trois choses étaient cassées, chacune en silence.

- **Les commandes de développement ne démarraient plus** sur les postes
  équipés de la dernière version de l'outil qui installe les dépendances.
  Un réglage laissé à moitié rempli faisait échouer chaque commande, alors
  que la même chose passait sans problème sur le serveur de build. Réparé,
  et écrit de façon à valoir pour l'ancienne comme pour la nouvelle version.
- **Le robot qui met les dépendances à jour chaque lundi échouait depuis
  plus d'un mois**, sans que personne ne le voie. Il faisait pourtant son
  travail : il refusait d'ouvrir une mise à jour qui casse la compilation.
  Mais son échec ne se voyait nulle part, ce qui donnait l'illusion que les
  dépendances étaient tenues à jour alors qu'aucune n'avait bougé. Il ouvre
  désormais un ticket quand il échoue.
- **Un second robot de mise à jour était annoncé mais n'avait jamais été
  activé** — sa configuration promettait une politique qui n'existait pas.
  Elle est retirée : un seul mécanisme, celui qui fonctionne.

Au passage, les nouveaux espaces de travail installent leurs dépendances
tout seuls, et la version de l'outil d'installation est fixée à un seul
endroit au lieu de quatre.

> **🔧 Notes techniques**
>
> - `pnpm-workspace.yaml` : `allowBuilds` portait encore les placeholders du
>   template (`"set this to true or false"`). pnpm 11 lit `allowBuilds` et
>   ignore `onlyBuiltDependencies` → valeur non booléenne = build refusé →
>   `ERR_PNPM_IGNORED_BUILDS` en **exit 1**, et comme pnpm 11 lance un
>   `runDepsStatusCheck` avant chaque script, **tout `pnpm <script>` sortait
>   en 1** en local (y compris le hook `SessionStart`). La CI, pinnée sur
>   pnpm 10, lisait `onlyBuiltDependencies` et restait verte. Les deux clés
>   sont désormais correctes et synchronisées : l'install passe sur 10 comme
>   sur 11.
> - `package.json` : ajout de `packageManager: "pnpm@10.28.0"`, seul champ
>   ajouté. Trois versions de pnpm cohabitaient — local
>   11.22.0 (corepack), CI 10.x, et Vercel **10.28.0 choisi « d'après la
>   date de création du projet »** (log de build), un pin invisible hors du
>   repo. Le pin retenu est celui que la prod exécute déjà : corepack
>   réaligne le local, `pnpm/action-setup` réaligne la CI, et **Vercel lit
>   le champ** : le build preview de la PR est passé de « Using pnpm@10.x
>   based on project creation date » à « with package.json#packageManager
>   pnpm@10.28.0 » — même version, donc aucun changement de comportement,
>   mais l'heuristique hors repo disparaît. Le lockfile n'a pas bougé
>   (toujours en `lockfileVersion` 9.0).
> - **Aucun champ `engines`**, et c'est délibéré dans les deux cas.
>   `engines.pnpm` : la doc Vercel documente `ERR_PNPM_UNSUPPORTED_ENGINE`
>   quand il ne colle pas au pnpm réellement choisi (par heuristique), donc
>   il armerait une panne de build au prochain patch de leur côté.
>   `engines.node` : le projet Vercel tourne sur **Node 24.x** et un
>   `engines.node` dans `package.json` **écrase le réglage projet** — le
>   déclarer aurait rétrogradé la prod en silence. Node reste désaligné
>   (local 22, CI 22, Vercel 24) ; c'est un sujet à part, pas un effet de
>   bord à embarquer ici.
> - `ci.yml`, `update-deps.yml`, `sync-skills.yml` : `version: 10` retiré des
>   trois `pnpm/action-setup@v4` — sans `version:`, l'action lit
>   `packageManager`. Une seule source de vérité à bumper.
> - `update-deps.yml` : step `if: failure()` qui ouvre (ou commente) une
>   issue `dependencies` avec l'URL du run, + `permissions.issues: write`.
>   Le job échouait chaque lundi depuis le 21/07 au moins (5/5) sur un
>   `TS2322` dans `src/routes/__root.tsx` déclenché par un bump `better-auth`
>   — correctif hors périmètre, c'est l'issue qui le portera.
> - `renovate.json` supprimé : app jamais installée (0 PR, 0 branche
>   `renovate/*`), config morte redondante avec `update-deps.yml` — ce que
>   `TEMPLATE_SYNC.md` actait déjà (« Replaces the dormant Renovate app »).
> - `.conductor/settings.toml` créé, avec pour `scripts.setup` un
>   `pnpm install --frozen-lockfile` (et non `conductor.json`, legacy).
>   Aucun setup n'existait, ni dans le repo ni côté app.
> - `KNOWN_ISSUES.md` : deux sections neuves — la mesure du coût disque réel
>   des `node_modules` en worktrees (clones CoW APFS) et le triple pin pnpm.

---

## v1.190.0 — 08/08/2026 à 11:45 — Le prévisionnel Airtable arrive dans les échéances

Airtable s'éteint, et il gardait encore quelque chose que l'app ne montrait
pas : les **prévisions de rentrée et de sortie**. 83 rentrées et 32 sorties
qui vivaient là-bas sans jamais apparaître nulle part dans Albo OS.

Elles rejoignent CALTE, dans **Trésorerie → Échéances ponctuelles**. Elles
comptent dans la courbe de trésorerie, se rapprochent d'une transaction
comme n'importe quelle échéance, et se modifient ou s'annulent à la main.

Trois choix qui méritent d'être dits, parce qu'ils se voient à l'écran :

- **Elles arrivent en « attendu », pas en « confirmé ».** Un prévisionnel
  n'est pas un engagement : ces montants nourrissent le scénario _avec
  planifié_ et laissent la courbe _engagée_ — la lecture prudente —
  exactement comme elle était. Vous pouvez passer une ligne en confirmé au
  cas par cas quand elle se solidifie.
- **Les échéances déjà dépassées sont reprises aussi**, et remontent donc
  « en retard ». C'est voulu : les écarter aurait embelli la trajectoire en
  silence au moment précis où la source disparaît. Il y en a une quinzaine à
  passer en revue une bonne fois.
- **Dix lignes ont été écartées** parce qu'elles redisaient une règle
  récurrente que vous avez déjà dans l'app : les loyers IROKO (mensuels et
  annuels) et le remboursement Wormser. Les importer aurait compté le même
  argent deux, voire trois fois.

Deux réserves, signalées et **pas** corrigées d'office — c'est à vous de
trancher dans l'app : quelques lignes rattachées à aucun deal (les fiches
sociétés ont été redécoupées depuis l'import d'origine, le lien automatique
n'est plus fiable et une erreur accrocherait de l'argent à la mauvaise
position), et deux doublons internes à Airtable — Weefin secondaire saisi
deux fois, et deux loyers Tiny Home au même jour.

> **🔧 Notes techniques**
>
> - Le cœur d'arbitrage est isolé et testé : `convex/lib/airtableForecasts.ts`
>   (`planForecastImport`, `RULE_DUPLICATE_ROWS`, `findInternalDuplicates`,
>   `airtableDerivedKey`) + `tests/airtableForecasts.test.ts`. Le sens vient de
>   la table d'origine, jamais du signe du montant : la table « sortie »
>   contient quelques cellules positives, et le classement fait foi.
> - Le tirage des deux tables est factorisé dans
>   `airtableImport.fetchForecastSourceRows()`, désormais partagé entre
>   l'upsert legacy `forecasts` de `runImport` (comportement inchangé : il
>   ré-applique ses propres valeurs par défaut) et le nouveau port.
> - Opération one-shot : `airtableImport:forecastEntriesDryRun` /
>   `forecastEntriesApply` / `forecastEntriesVerify`. Idempotente via
>   `forecastEntries.derivedKey` = `airtable:{recordId}` (nouveau préfixe,
>   documenté dans `convex/schema.ts`) ; pas de `ruleId`, donc `expandRules`
>   n'y touche jamais et les lignes vivent dans la table des ponctuelles. Une
>   échéance déjà rapprochée ou annulée n'est jamais réécrite par un re-run.
> - Rattachement au deal seulement si la société Airtable résout vers **un
>   seul** deal (`by_airtable_id` puis `by_org_target`) : le
>   `1 deal = Entreprise × instrumentKind` de l'import d'origine a été défait
>   par `cleanupCalteImport` et `consolidateRewattCalte`.
> - Le tout vit dans `convex/airtableImport.ts` plutôt que dans un module
>   `convex/migrations/` dédié : un nouveau module Convex ne peut pas
>   s'auto-référencer via `internal.…` sans régénérer `_generated/api.d.ts`
>   (cf. `KNOWN_ISSUES.md` « `convex codegen` can't run in the remote exec
>   environment »), et ce fichier est déjà le module d'import one-shot
>   Airtable. Index de l'opération dans `MIGRATIONS.md`, avec un garde-fou
>   ajouté au chantier « retrait de la table legacy `forecasts` » :
>   `fetchForecastSourceRows` ne doit plus être supprimé avec elle.

## v1.189.5 — 08/08/2026 à 11:39 — La cofo de Climate House sort de la fiche Climate House

Deux personnes physiques figuraient dans le portefeuille CALTE comme s'il
s'agissait de sociétés dans lesquelles on avait investi. En réalité, le
18/05/2026, CALTE a **racheté à deux cofondateurs de Climate House** les titres
qu'ils détenaient dans leur véhicule commun. L'ancien import avait lu le
**vendeur** comme la cible de l'investissement — d'où deux fiches à 2 000 €
au nom de personnes.

L'occasion a fait apparaître une confusion plus ancienne : **la cofo de
Climate House est une société à part entière**, distincte de Climate House.
Les comptes certifiés le disent d'ailleurs sur deux lignes séparées. L'outil,
lui, mettait l'entrée dans la cofo (10 000 €, novembre 2025) sur la fiche
Climate House.

Les deux sont désormais dissociées :

- **Cofo Climate House** — nouvelle fiche, 14 000 € : l'entrée de 10 000 € et
  les deux rachats de 2 000 €.
- **Climate House** — garde ses 20 000 € de titres et son compte courant.

Les deux fiches au nom de personnes sont archivées. Les mouvements bancaires
suivent leur investissement, rien n'est dépointé.

> **🔧 Notes techniques**
>
> - Nouveau `convex/migrations/reassignClimateHouseCofoDeals.ts` (`dryRun` /
>   `apply`) : crée la fiche `Cofo Climate House` (réutilisée si elle existe
>   déjà), repointe 3 deals via `targetCompanyId`, archive les 2 fiches
>   personne.
> - Les deux rachats reçoivent un `deals.name` (« Rachat titres cofondateur —
>   … ») : sans ça la fiche porterait deux deals de 2 000 € signés le même jour,
>   impossibles à distinguer. Même patron que l'adresse dans le nom du deal sur
>   REWATT.
> - Les transactions ne sont pas touchées : elles portent un `dealId`, jamais
>   une société.
> - `resolve()` accepte la fiche **source ou** la fiche canonique (règle de
>   `consolidateRewattCalte`) → 2ᵉ run no-op. Clés écrites ajoutées à
>   `manuallyEditedFields`, sinon `airtableImport:runImport` remettrait le
>   vendeur en cible.
> - Archivage refusé s'il reste une référence (11 tables) ; le deal en instance
>   de départ est décompté pour ne pas se bloquer lui-même.

## v1.189.4 — 08/08/2026 à 10:30 — Les trois dernières fiches du ménage CALTE

Le nettoyage précédent a archivé 38 fiches sur 41 et **refusé les trois
dernières** : chacune portait encore quelque chose, et le garde-fou préfère
signaler plutôt que de laisser des données pendues à une fiche archivée. Voici
ce qu'elles portaient, et ce qu'on en fait.

**Serendip Invest** et **Calte SASU** étaient retenues par un lien vers un
e-mail — un reliquat de l'ancienne fonctionnalité e-mails, retirée depuis, que
plus rien ne lit dans l'app. Ces liens morts sont supprimés, les deux fiches
partent en archive.

**Upcyclea** est un cas différent, et je m'étais trompé en la classant en
« dossier regardé jamais investi ». Upcyclea est **une participation Albo
Club** : elle a sa propre fiche de ce côté-là. Ce que portait la fiche CALTE —
le reporting annuel 2025, son PDF, sa synthèse et ses 17 indicateurs — est le
**double exact** de ce que porte déjà la fiche Albo, qui a en plus les
rapports T3 et T4 2025. Rien d'unique côté CALTE : le reporting était
simplement arrivé sur les deux fiches à la fois. On le détache de la fiche
CALTE (la fiche Albo garde tout), puis la fiche s'archive.

À l'arrivée, le portefeuille CALTE ne contient plus que des participations.

> **🔧 Notes techniques**
>
> - Nouveau `convex/migrations/archiveCalteBlockedCards.ts` (`dryRun` /
>   `apply`) : reprend les 3 fiches remontées en `skipped` par
>   `cleanupCalteOrphanCompanies:apply`.
> - Les références sont scindées en **`clearable`** (`companyEmailLinks`,
>   table legacy inerte ; `companyIntelligence`, donnée dérivée régénérée à la
>   demande — même arbitrage que `cleanupCalteImport`) et **`blocking`** (tout
>   le reste). Une fiche encore `blocking` n'est **pas** touchée du tout : rien
>   n'est supprimé sur une fiche qui resterait bloquée de toute façon.
> - Le reporting Upcyclea est détaché **depuis l'app** via
>   `reportInbox.detachCompany`, pas réimplémenté ici : cette mutation corrige
>   aussi la ligne `inboundEmails` source (un replay ne remet pas le report) et
>   retire l'entrée d'index sémantique. Le `dryRun` porte le rappel et refuse
>   d'archiver tant que le détachement n'est pas fait.
> - Mêmes gardes que ses sœurs : ancrage `_id` prod, nom exact, org, idempotent.

## v1.189.3 — 08/08/2026 à 09:30 — Le portefeuille ne contient plus que des participations

L'ancienne base Airtable créait une fiche société pour **chaque** ligne de
mouvement, quelle qu'en soit la raison. Le portefeuille s'est donc retrouvé
peuplé de choses qui n'ont jamais été des investissements : des dons à des
associations et fondations, des honoraires d'avocats et de notaires, le
commissariat aux comptes, la DGFIP, des libellés de virement, des comptes de
passage — et même une fiche pour CALTE elle-même.

Après le nettoyage précédent, 44 de ces fiches ne portaient plus aucune
participation. Chacune a été tranchée sur ses mouvements bancaires et sur la
plaquette signée au 31/12/2025 : **41 sont archivées**. Deux d'entre elles
méritent d'être signalées parce qu'elles ne sont pas rien, elles ne sont
simplement pas des participations — le compte courant de Clément (70 700 €,
qui est au passif) et le nantissement de 3 280 000 € (un actif, mais un
compte bloqué en garantie d'un prêt).

Et dans l'autre sens, la plaquette et les relevés ont révélé **trois positions
que l'outil ignorait** : Priv. Equity Rothschild pour 387 321 €, Invest for
Planet pour 5 000 € — toutes deux aux montants du bilan certifié — et l'avance
en compte courant du Chaptal, 10 000 € sortis le 01/10/2025 et remboursés en
totalité le 15/07/2026, donc créée puis soldée dans le même geste. Les trois
mouvements bancaires correspondants, restés jusqu'ici en attente, sont pointés
sur leur ligne.

Rien n'est perdu : les fiches sont archivées, pas supprimées.

> **🔧 Notes techniques**
>
> - Nouveau `convex/migrations/cleanupCalteOrphanCompanies.ts` (`dryRun` /
>   `apply`), même patron que les précédents : ancrage par `_id` prod, garde
>   sur le nom exact, archivage refusé si une seule référence subsiste
>   (14 tables couvertes, `deals` compté sur ses trois rôles).
> - Chaque ligne porte son `kind` — `donation`, `supplier`, `tax`, `banking`,
>   `import_artefact`, `not_a_company`, `dealflow`, `wrong_org` — pour que la
>   preuve du classement reste dans le code plutôt que d'être à re-dériver.
> - `MISSING_DEALS` crée les trois deals manquants sur les fiches existantes,
>   investisseur = `group_root` de l'org. Chaque `movements[]` déclaré est pointé
>   sur le nouveau deal sous garde (org, montant, date, sens, non déjà pointé) :
>   un mouvement qui a bougé depuis l'audit est remonté dans `skipped`, il n'est
>   pas forcé. Rothschild n'a aucun mouvement dans la base : `signedDate` reste
>   vide plutôt qu'inventée. Le Chaptal, remboursé, naît `fully_exited` avec
>   `exitedDate` + `exitProceeds`.

## v1.189.2 — 07/08/2026 à 19:15 — Le compte courant Flexliving se recolle bien

Le nettoyage du portefeuille a tourné sur la base : 26 participations
découpées en 60, 13 fiches société en double archivées, 4 lignes qui n'en
étaient pas retirées ou fusionnées. Une seule chose ne s'est pas faite —
la fusion des deux comptes courants Flexliving, l'outil l'a refusée par
excès de prudence.

La raison : les deux fiches société avaient déjà été réunies quelques
instants plus tôt dans la même opération, et le contrôle de sécurité,
qui vérifie qu'on manipule bien la bonne ligne, cherchait encore
l'ancienne. Il accepte désormais les deux lectures. Les 14 500 € de
remboursements pourront rejoindre la ligne qui les concerne.

Le prêt Wormser reste volontairement en dehors : il porte un échéancier
de trésorerie bien vivant, que la sortie du portefeuille ne doit pas
emporter.

> **🔧 Notes techniques**
>
> - `migrations/cleanupCalteImport.ts` : la garde de `DEAL_MERGES` comparait
>   le nom de la cible du deal absorbé au seul `expectedTarget`, alors que le
>   bloc 4 (fusion des fiches) a déjà repointé ce `targetCompanyId` vers la
>   fiche survivante plus tôt dans la même transaction. Nouveau
>   `isExpectedMergeTarget` : source **ou** canonique, même forme que le
>   `onSource || onCanonical` de `consolidateRewattCalte:resolveOperation`.
>   Appliqué à `dryRun` et à `apply`.
> - Relance de `apply` sûre : le module est idempotent, tous les autres blocs
>   sont des no-op au second passage.
> - `verify` après le run remonte deux écarts **préexistants**, hors périmètre
>   de la migration : `CCA Albo` (400 000 € au deal contre 1 630 000 € de
>   mouvements) et `DOKA - Pre-seed` (0 € contre 55 000 €).

## v1.189.1 — 07/08/2026 à 18:45 — Nettoyage du portefeuille CALTE repris d'Airtable

Le portefeuille CALTE vient d'une base Airtable qui ne connaissait ni deal ni
entité investisseuse : seulement des sociétés et des mouvements bancaires
étiquetés. La reprise a donc **fabriqué** les participations, en regroupant tous
les mouvements d'une même société portant la même étiquette. Une seule ligne
pouvait ainsi mélanger des choses sans rapport — une acquisition immobilière et
les avances en compte courant à la filiale, une cession de titres et les BSPCE
d'un salarié, un pre-seed et un bridge signé deux ans plus tard.

Les 247 participations issues de cette reprise ont été relues une par une, sur
leurs mouvements bancaires, et recoupées avec le document de remise au propre du
4 août. Le nettoyage qui en découle est prêt à être lancé sur la base :

- **27 participations qui en contenaient plusieurs sont découpées en 62.**
  Chaque tour retrouve sa vraie date d'entrée et son vrai montant, au lieu d'un
  cumul écrasé sur la date du premier versement. Les encaissements (exits,
  remboursements, coupons) restent sur la ligne d'origine : une revente porte
  presque toujours sur l'ensemble des titres, pas sur un tour précis.
- **10 fiches société en double disparaissent.** Les entités du groupe —
  Caltimo, RDB, Relais Chapelle, les SCI, Banco 2 — avaient chacune une seconde
  fiche créée par la reprise, plus Cœur Pigalle, Asterion Side Onima et
  Flexliving en double graphie. Deux fiches Batch vides sont archivées ; les
  quatre fonds Batch, eux, sont bien quatre fonds distincts.
- **Trois lignes sortent du portefeuille** parce que ce ne sont pas des
  investissements : le prêt Wormser que CALTE rembourse (les parts Iroko en sont
  la garantie), un retrait de cagnotte Anaxago et une cession de titres à un
  tiers. Leurs mouvements repartent dans la file de pointage pour être qualifiés
  correctement.
- **Trois doublons de participation** sont réunis, dont des remboursements qui
  atterrissaient sur une ligne vide au lieu de la ligne qu'ils remboursent.
- Une participation manquante est créée (RM Expansion), deux dates de signature
  sont posées, et Sant Roch devient Sant Roch - Contrast — nom commercial et nom
  de la SAS.

Rien n'est perdu : les fiches sont archivées et non supprimées, et une
sauvegarde complète est prise avant toute écriture.

Deux sujets restent ouverts et ne sont pas touchés ici : le dossier Bureaux à
Partager, dont la répartition entre titres et compte courant demande un
arbitrage, et les avances en compte courant aux filiales, qui resteront
comptées comme des participations tant que l'outil ne saura pas les porter au
passif.

> **🔧 Notes techniques**
>
> - Nouveau `convex/migrations/cleanupCalteImport.ts` (`dryRun` / `apply` /
>   `verify`), même patron que `consolidateRewattCalte.ts` : ancrage par `_id`
>   prod, garde sur le nom exact, rapport avant écriture.
> - Découpage : les mouvements déclarés sont appariés par (date, montant) aux
>   transactions sortantes du deal et consommés une fois — deux versements
>   identiques le même jour sont gérés, une part introuvable fait sauter le deal
>   entier plutôt qu'un découpage partiel. Le deal existant garde son
>   `airtableId` et porte la première opération ; les suivantes sont insérées
>   avec le même investisseur, la même cible et le même `instrumentKind`, et se
>   distinguent par `deals.name`.
> - Fusions : toutes les tables référençant une `company` (deals ×3 rôles,
>   `companyRelations`, `documents`, `companyReports`, `companyEmailLinks`,
>   `bankAccounts`, `kpiSnapshots`, `todos`, `companyIntelligence`) et un `deal`
>   (`transactions` + `allocation.targetId`, `valuations`, `dealProjections`,
>   `documents`, `forecasts`, `forecastRules`, `forecastEntries`,
>   `matchingDecisions`) sont repointées avant archivage ou suppression.
> - Les fiches sont archivées (`archivedAt`), refusé s'il reste une référence ;
>   les deals, qui n'ont pas ce champ, sont supprimés une fois vidés — invariant
>   de `deals.remove`. Clés écrites ajoutées à `manuallyEditedFields`.
> - Contrainte relevée au passage et documentée dans `KNOWN_ISSUES.md` :
>   `intercompanyLoans` relie deux **organisations** et rejette `same_org`, donc
>   le module Passif ne peut pas porter un compte courant entre deux entités
>   d'une même org.

## v1.189.0 — 07/08/2026 à 18:35 — La file des reports se répare toute seule

Le correctif d'il y a une heure n'a tenu qu'un tour : les deux mêmes reports
sont repartis en erreur, avec deux messages différents. C'est le signe qu'on
rustinait des symptômes. Cette fois le problème est pris à la racine — et il
y en avait deux, distincts.

**Une reformulation ne fait plus perdre un report.** L'IA avait écrit
« half-year » là où on attendait « semestriel » : le bon rythme, dit
autrement. On exigeait d'elle l'exactitude d'un formulaire et on jetait le
report entier au moindre écart. Désormais les formulations équivalentes sont
traduites — le rythme, les unités (`k€`, `M€`, `%`), les nombres écrits avec
une espace ou une virgule. Et surtout : **un chiffre illisible ne coûte plus
que sa ligne**, là où il emportait avant les quinze autres et la fiche avec
eux. Rien n'est deviné pour autant — une unité inconnue reste hors des
séries plutôt que d'être convertie au hasard.

**Un incident passager ne te dérange plus.** L'autre report était mort sur
une requête coupée en route — rien à voir avec son contenu. Or la file
traitait tout échec comme définitif : mail d'échec, et un « Retraiter »
manuel comme seule sortie. Un hoquet de trois secondes te coûtait une
intervention. Maintenant le report est repris tout seul, jusqu'à trois fois,
à 1, 5 puis 15 minutes — **et tu n'es prévenu que si les trois échouent**. À
l'inverse, un contenu réellement inexploitable arrive dans la file tout de
suite : inutile de te le signaler vingt minutes plus tard.

Les deux reports concernés peuvent être retraités depuis « Reports
entrants ».

> **🔧 Notes techniques**
>
> - Nouveau `convex/lib/reportAnalysis.ts` : le contrat modèle au complet.
>   `analysisSchema` reste **strict** (c'est lui qui contraint
>   `generateObject`, et le JSON Schema qu'on en dérive est la seule consigne
>   reçue par le provider) ; `parseLenient` lit le chemin de repli, où rien
>   ne contraint le modèle — synonymes normalisés (`normalizeReportType`,
>   `normalizeUnit`, `looseNumber`), métrique invalide filtrée seule. Échec
>   uniquement si ni `title` ni `headline`.
> - `parseIdentificationLenient` (`convex/lib/emailIdentify.ts`) fait pareil
>   côté brique 3, avec `confidence` retombant sur `'low'` — la branche
>   **stricte** de `acceptIdentification`, donc un écart resserre le
>   rattachement au lieu de le relâcher.
> - Nouveau `convex/lib/modelRetry.ts` : `isTransientModelError` +
>   `RETRY_BACKOFFS_MS`. `ModelOutputError` porte nos propres échecs de
>   lecture, pour que la classification (qui lit le message) ne prenne jamais
>   un `raw_label` « timeout » pour une panne passagère.
> - `reportInbox.retryAfterTransient` repasse la ligne en `received` (le
>   statut qu'exigent déjà `markProcessing`/`markStoring`) et replanifie.
>   Budget **par étape** via `retryStep` + `retryAttempts` sur
>   `inboundEmails` : pas de reset à écrire ailleurs. Aucune notification —
>   `claimNotify` ne tirant qu'une fois, un mail d'échec prématuré ferait
>   taire le récap de succès.
> - Les deux `callModel` relaient une erreur passagère au lieu de replier sur
>   `generateText` : une requête coupée ne dit rien sur la sortie structurée,
>   enchaîner une seconde génération brûle le même échec deux fois.
> - Tests : `regression.reportAnalysisSchema.test.ts` (étendu),
>   `regression.modelRetry.test.ts` et `regression.reportRetry.test.ts`
>   (budget borné, retour en `received`, budget par étape).

## v1.188.3 — 07/08/2026 à 17:48 — Un report n'est plus perdu parce qu'une case était vide

Deux reports — GOODVEST et WIND CAPITAL 2 — sont revenus en « erreur technique
pendant l'analyse » et n'ont jamais été rangés. Le mail était pourtant bien
reçu, bien rattaché à la bonne participation, et son contenu bien lu : c'est la
dernière étape, celle qui remplit la fiche du report, qui refusait le résultat.

En cause, une case facultative laissée vide. Chaque chiffre extrait peut porter
sa propre période, utile seulement quand il ne couvre pas la même que le report
— donc vide dans l'immense majorité des cas. Le contrôle qualité exigeait quand
même qu'elle soit là, et rejetait la fiche entière quand elle manquait : tous
les autres chiffres du report partaient avec.

Une case facultative absente est désormais lue comme vide, ce qui est sa
signification. Les deux reports concernés peuvent être retraités depuis la file
« Reports entrants » — rien n'a été perdu, l'e-mail et ses pièces jointes sont
toujours là.

> **🔧 Notes techniques**
>
> - `analysisSchema` (`convex/reportStore.ts`) : les quatre champs optionnels
>   (`report_period`, `report_type`, `metrics[].catalog_key`,
>   `metrics[].period`) passent de `.nullable()` à `.nullable().default(null)`.
>   En Zod, `.nullable()` autorise la valeur `null` mais rend la **clé**
>   obligatoire — or un modèle répondant en JSON libre omet la clé au lieu
>   d'écrire `"period": null`. Le type de sortie reste `string | null`, donc
>   `RawMetric`, `toCanonical` et `storeForCompany` sont inchangés.
> - Même correctif sur `real_sender_email` dans `identificationSchema`
>   (`convex/reportIdentify.ts`), même défaut latent.
> - Ce `safeParse` n'est atteint que par le repli `generateText`, déclenché
>   quand `generateObject` échoue (logué en `console.warn` seulement). La
>   cause de cet échec initial sur ces deux mails reste à confirmer dans les
>   logs Convex prod — piste : reports longs, sortie tronquée.
> - Nouveau `convex/regression.reportAnalysisSchema.test.ts` (3 cas) : une clé
>   optionnelle omise se lit `null`, un champ requis manquant échoue toujours.
> - Piège documenté dans `KNOWN_ISSUES.md` § « Schéma Zod servi à un LLM ».

## v1.188.2 — 07/08/2026 à 16:14 — Rewatt ne compte plus que pour une seule société dans CALTE

Le portefeuille CALTE affichait dix lignes Rewatt : une par adresse d'opération,
plus une ligne pour la participation au capital, plus un doublon vide. Or il n'y
a qu'une seule société derrière tout ça — Rewatt achète, rénove et revend chaque
appartement depuis son propre bilan, sans créer de véhicule dédié. Dix lignes
pour un seul partenaire, ça fausse le compte des participations et ça éclate son
historique.

Rewatt ne fait désormais qu'une seule ligne, qui porte son identité légale. Les
huit opérations deviennent huit financements rattachés à cette ligne, chacun
nommé par son adresse — Rue Monge, Rue Froment, Boulevard Ney… — donc on lit
toujours quelle opération a rapporté quoi, sans avoir dix fiches à ouvrir.

Deux corrections viennent avec :

- **Sept des huit opérations étaient enregistrées comme des obligations.** Ce
  n'en sont pas : ce sont des avances sur un compte courant d'associé, tirées
  au fil des acquisitions sur une convention unique signée en avril 2023. Elles
  sont requalifiées, avec leur taux réel (3 %, 4 %, ou indexé pour Rue Monge).
  Seule l'opération du boulevard de Port-Royal est un véritable emprunt
  obligataire.
- **Le financement du boulevard de Port-Royal apparaissait toujours en cours**
  alors qu'il a été remboursé le 30 décembre 2025. Il est soldé, avec le montant
  effectivement encaissé.

La ligne Rewatt de l'organisation Albo n'est pas concernée : elle était déjà
unique et correctement rattachée.

> **🔧 Notes techniques**
>
> - Nouveau module one-shot `convex/migrations/consolidateRewattCalte.ts`
>   (`dryRun` / `apply` / `verify`), sur le modèle de `calteInstrumentImport`.
>   Il ne s'exécute pas au déploiement : lancement manuel en
>   `convex run --prod` après merge, snapshot `convex export --prod` d'abord.
> - `apply` fait cinq choses : pose l'identité légale (siren `950792473`,
>   `legalName`, `legalForm`, `countryCode`, `sector`) sur la ligne `REWATT`
>   survivante — champs vides uniquement, unicité SIREN re-vérifiée ; repointe
>   les 8 deals via `targetCompanyId` et écrit leur adresse dans `deals.name` ;
>   requalifie 7 deals `os` → `cca` avec `interestRate` / `principalAmount` ;
>   solde le deal Port-Royal (`fully_exited`, 30/12/2025, 41 866,67 €) ;
>   archive les 8 entités vidées + l'orphelin `Rewatt - Port Royal 5éme`.
> - Sources : les lettres `Appel de fonds #N` / `Remboursement #N` et la
>   `Convention d'avance en compte courant d'associés` du 20/04/2023 (Drive,
>   dossier « REWATT »). Montants et taux repris verbatim ; les 8 montants
>   rapprochent au centime le cash déjà enregistré sur chaque deal. Aucune
>   valeur écrite sans pièce : la lettre de remboursement d'Esquirol est absente
>   du Drive, donc sa sortie n'est pas renseignée.
> - Gardes : ancrage par `_id` prod + contrôle du nom exact courant (attention,
>   `REWATT - 33 chaussée d'Antin ` porte une espace finale) ; `resolveOperation`
>   accepte la cible source **ou** la cible canonique, ce qui rend le second run
>   no-op. Champs déjà remplis jamais écrasés, divergences remontées dans
>   `mismatches`. Archivage = soft delete `archivedAt`, refusé tant qu'une
>   référence subsiste (`blockingRefs` local, qui ajoute `companyReports` et
>   `companyIntelligence` à la couverture de `companies.listBlockingRefs`).
> - Chaque clé écrite est ajoutée à `deals.manuallyEditedFields`, sinon un
>   re-run de `airtableImport:runImport` réécraserait tout (cf. `KNOWN_ISSUES.md`
>   « Édition manuelle deals »).

## v1.188.1 — 07/08/2026 à 16:20 — La récupération des chiffres encaisse la saturation du modèle

Au premier passage réel sur les documents juridiques, le modèle de lecture a
été saturé côté fournisseur. L'outil a alors marqué en échec des dizaines de
documents en quelques secondes, alors que la limite se lève en quelques
minutes — et, surtout, il n'aurait rien gardé des documents déjà lus si le
passage avait été interrompu.

Trois corrections :

- **Il attend au lieu d'abandonner.** Quand le modèle est saturé, l'outil
  patiente (30 s, puis 1, 2 et 4 minutes) avant de réessayer. Une erreur qui
  n'est pas une saturation n'est pas réessayée : ce serait du temps perdu.
- **Il ne perd plus ce qu'il a lu.** Chaque document lu est mémorisé
  immédiatement. Une interruption ne coûte plus que le document en cours, et
  la relance repart exactement où elle s'est arrêtée.
- **Il s'arrête proprement plutôt que de s'acharner.** Si deux documents
  d'affilée résistent à toute l'attente, l'outil arrête le passage, le dit
  clairement, et écrit un rapport marqué comme **partiel** — relancer plus
  tard suffit.

Un rythme d'appel un peu plus espacé a aussi été mis en place, pour éviter de
déclencher la saturation.

> **🔧 Notes techniques**
>
> - Cause exacte : `generateObject` retente 3 fois en interne puis lève ;
>   `extractDocument` attrape et **renvoie** `{ error }`. L'action sort donc en
>   succès, `convex run` en code 0, et le retry de `convex()` — qui ne se
>   déclenche que sur throw du sous-processus — n'était jamais atteint.
> - `scripts/backfill-deal-fields.mjs` : `RATE_LIMITED` (regex sur le message
>   fournisseur), `extractWithBackoff` (`MODEL_BACKOFFS` 30/60/120/240 s,
>   uniquement sur saturation), `PACE_MS` = 1,5 s entre deux appels.
> - Écriture du cache déplacée en fin de **chaque** extraction réussie au lieu
>   de la fin du run.
> - Arrêt anticipé après 2 documents consécutifs ayant épuisé le backoff :
>   `stopped` court-circuite la boucle avant l'arbitrage (planifier une société
>   sur un jeu de documents à moitié lu produirait des trous qui ressemblent à
>   des constats), et le rapport MD porte un bandeau « PARTIEL ».
> - `stats.companies` compté à l'exécution et non depuis `selected.length`.
> - Pièges consignés : `KNOWN_ISSUES.md` § « Backfill depuis la doc juridique »
>   (point 4).

---

## v1.188.0 — 07/08/2026 à 15:57 — Le score de santé se remet à trancher

Le score IA de santé donnait presque toujours la même note. Sur le
portefeuille Albo, tout tenait entre 4 et 7 — et huit sociétés sur dix entre
5 et 7. Wandercraft, qui entre au Next40 et signe 350 robots avec Renault,
et une marque dont le chiffre d'affaires a été divisé par deux et qui n'a
fait que 13 % de son budget annuel : un point d'écart. Une note qui ne
sépare pas ces deux-là ne sert à rien.

L'analyse dispose maintenant d'un vrai barème. Elle note l'entreprise — pas
la qualité de son reporting — sur trois axes : la trajectoire par rapport au
plan, la trésorerie et le runway, la solidité de la structure (rentabilité,
gouvernance, financement). Neuf ou dix pour une boîte excellente, sept-huit
en bonne voie, cinq-six à surveiller, trois-quatre préoccupant, un-deux
critique. C'est l'axe le plus dégradé qui commande : un runway sous six mois
sans financement engagé plafonne la note, quel que soit le reste.

L'analyse ne s'oblige plus non plus à trouver trois points forts et trois
points de vigilance à chaque société. Elle en donne un à trois de chaque
côté, selon ce que disent réellement les chiffres — une boîte qui décroche
partout n'a plus à se voir inventer des qualités pour faire nombre.

Enfin, une société dont aucun reporting n'est encore arrivé n'est plus notée
du tout : elle affiche « aucune donnée » et reste vide dans la colonne Score.
Jusqu'ici elle recevait une vraie note, construite à partir de son seul nom
de domaine.

Les notes déjà affichées datent de l'ancien barème : elles se mettront à jour
au prochain reporting reçu, ou tout de suite avec « Relancer l'analyse » sur
la fiche de la société.

> **🔧 Notes techniques**
>
> - `convex/lib/reportPrompts.ts` — `INTELLIGENCE_SYSTEM_PROMPT` : ajout d'une
>   section « BARÈME DU SCORE DE SANTÉ » (5 bandes ancrées sur runway / écart
>   au plan / structure, règle de plafond par l'axe le plus dégradé, consigne
>   d'usage de toute l'échelle). Le `"score": 6` de l'exemple JSON devient un
>   placeholder : c'était le seul chiffre du prompt, et le modèle le recopiait
>   (cf. `KNOWN_ISSUES.md` « Prompt de notation »). `good_points` /
>   `bad_points` passent de « EXACTEMENT 3 » à « 1 à 3 », et la posture
>   n'exige plus un contrepoids absent des données.
> - `convex/intelligence.ts` — la branche `no_data` de `runAnalysis` était
>   morte : elle testait `!text`, or `getContext` renvoie toujours au moins
>   l'en-tête `## Entreprise:`. `getContext` expose désormais `hasReports` et
>   la garde porte sur `hasReports || vascoBlock`. Le statut `no_data` passe
>   `analysis: null` pour effacer une synthèse périmée — la colonne Score lit
>   `aiAnalysis` seule (`deals.aiScoresByCompany`), sans regarder le statut.
> - `src/lib/reportScore.ts` — commentaire seul : le barème du prompt et les
>   seuils de `scoreVerdict` sont alignés bande par bande (7-10 vert / 5-6
>   ambre / 1-4 rouge), les déplacer séparément casse la cohérence
>   libellé ↔ couleur.
> - Docs : `docs/produit/04-participations.md` (barème + cas sans reporting),
>   `TESTING.md` TP12, `KNOWN_ISSUES.md`.

## v1.187.2 — 07/08/2026 à 14:46 — On reconnaît un reporting d'un document au premier coup d'œil

Dans la chronologie d'une entité, un reporting, une communication VASCO et un
simple document déposé portaient tous la même petite icône grise : il fallait
lire le badge pour savoir ce qu'on avait sous les yeux.

Les reportings et les communications ont désormais leur propre pictogramme, sur
fond bleuté — la famille « ce qu'on nous a envoyé » se distingue d'un regard de
la famille « ce qu'on a classé ». Et les documents eux-mêmes affichent une
icône qui suit le type de fichier : tableur, présentation, archive, image, ou
document texte, au lieu de la même feuille pour tout. Valable sur la fiche
entité comme sur l'onglet documents d'un deal.

> **🔧 Notes techniques**
>
> - `src/components/documents/DocumentAttachment.tsx` : `FileGlyph` élargi
>   (présentation, archive, PDF/Word/texte, `File` en repli). L'ordre des
>   tests compte — les types OOXML contiennent tous « document » dans leur
>   sous-type, donc les familles spécifiques passent avant.
> - `src/components/companies/CompanyTimelineSection.tsx` : `CommunicationRow`
>   prend une prop `glyph` (`FileChartColumn` pour un report, `Megaphone` pour
>   VASCO) et son carré passe en `bg-info/10 text-info`. Le carré d'un
>   document reste neutre — c'est la teinte qui porte la distinction de
>   famille, l'icône la distinction de nature.
> - Aucune couleur par type de fichier : `positive` sert à marquer une
>   plus-value, le détourner en « vert Excel » aurait brouillé le signal.

## v1.187.1 — 07/08/2026 à 14:08 — Un fichier introuvable ne fait plus perdre son reporting

Lors de la reprise de l'historique des reportings, quatre d'entre eux ne sont
pas passés. La cause : leur pièce jointe était référencée dans l'ancien outil
mais le fichier lui-même n'existait plus. L'import s'arrêtait alors sur ce
report et le laissait de côté — alors que son texte, son analyse et ses
chiffres, eux, étaient parfaitement disponibles.

Désormais une pièce jointe irrécupérable ne coûte plus que la pièce jointe :
le reporting est importé sans elle, et les fichiers manquants sont listés à
part en fin d'opération, distincts des vrais échecs.

> **🔧 Notes techniques**
>
> - `scripts/import-albo-reports.mjs` : le téléchargement + upload de chaque
>   fichier passe dans son propre `try/catch`. Un échec alimente désormais
>   `fileWarnings` (nouveau compteur, affiché séparément) au lieu de faire
>   remonter l'exception au `catch` du report, qui sautait l'appel à
>   `importOne`.
> - Cause racine côté source : des lignes `report_files` d'Albo app pointent
>   vers un chemin sans objet dans Supabase Storage (`storage.objects` vide
>   pour ces clés) — Storage répond 400, pas 404.
> - Concernait 4 reports sur 139 : Jeen `March 2026` (les deux), Jeen
>   `November 2025`, Tango `Q1 2026`. Le re-run les crée ; les 135 déjà
>   importés ressortent en « déjà présents » grâce à `alboReportId`.

## v1.187.0 — 07/08/2026 à 13:43 — Un deal annulé n'est plus obligé de se déguiser en sortie

Il arrive qu'un deal soit annulé **après** le virement : les fonds partent,
l'opération ne se fait finalement pas, l'argent revient quelques semaines
plus tard. C'est ce qui s'est passé sur le SPV Parallel Dix-huit. Les deux
mouvements bancaires existent et doivent bien se pointer quelque part — donc
le deal et l'entité en face doivent exister dans Albo OS.

Jusqu'ici, aucun statut ne disait la vérité. _Actif_ faisait croire à une
position ouverte qu'on n'a jamais eue. _Exité_ affichait un multiple de 1,00×
et un badge vert « Exit win », comme une opération réussie. _Passé en perte_
peignait la même chose en rouge. Trois façons de mentir sur le même mouvement
aller-retour.

Un quatrième statut arrive : **« Annulé »**. Il se pose dans le dialogue de
sortie habituel (« Gérer la sortie » → type _Annulé_), avec la date du
remboursement et le montant remboursé, et il s'annule comme une sortie si
c'était une erreur.

Un deal annulé est **hors performance** : pas de multiple, pas de TRI, pas de
TVPI — un remboursement n'est pas un retour. Il ne compte ni dans le capital
déployé, ni dans le distribué, ni dans la valeur du portefeuille, ni dans le
nombre de participations du tableau de bord. Et l'entreprise en face n'est
plus attendue sur ses reportings : plus d'alerte « boîte silencieuse » pour un
deal qui n'a jamais eu lieu.

Il est aussi **volontairement discret**, pour ne pas encombrer des listes qui
parlent de participations réelles. Il n'a pas de tableau dans la liste des
participations : il vit dans une section repliée « _n_ deals annulés » tout en
bas de la page, qui n'apparaît que s'il en existe au moins un. Dans la liste
des deals, il est masqué tant qu'on n'a pas coché _Annulé_ dans le filtre
Statut. Il reste visible normalement là où on le cherche vraiment : sur la
fiche de la société (en dernier) et sur sa propre fiche, avec un badge
**gris** — ni vert, ni rouge, puisque ce n'est ni une victoire ni une perte.

> **🔧 Notes techniques**
>
> - Nouveau littéral `cancelled` sur `dealStatus` (`convex/schema.ts`) et sur
>   `statusValidator` (`convex/deals.ts`), propagé aux enums des outils agent
>   (`convex/agentTools.ts`) et MCP (`convex/mcp/registry.ts`).
> - Statut **terminal** : `isTerminalStatus` extrait dans
>   `convex/lib/metrics.ts` (utilisé par `residualValueCents`, qui rend 0), et
>   rang 2 dans le `STATUS_RANK` de `convex/lib/attioSync.ts` — un événement
>   Attio « Invested » ne peut plus ressusciter un deal annulé.
> - `buildParticipationRows` (`convex/deals.ts`) gagne un bucket `cancelled` à
>   part entière, avec `tvpi`/`moic`/`tri` à `null` (les deux derniers
>   l'étaient déjà, conditionnés sur `settled`). `withReportAlerts`
>   (`convex/lib/reportFreshness.ts`) n'alerte plus sur ces lignes.
> - `convex/dashboard.ts` saute les deals annulés dans le calcul
>   déployé/distribué : leurs flux se neutralisent, les compter gonflerait les
>   deux compteurs bruts. Les autres agrégats les excluaient déjà via
>   `isActive` et `residualValueCents`.
> - Front : bucket `cancelled` gris neutre dans `src/lib/dealStatusBadge.ts`
>   (source unique de la couleur), section repliée `CancelledSection` dans
>   `ParticipationsView.tsx` (même pattern que « Entités archivées »),
>   masquage par défaut dans `DealsListView.tsx` sauf facette cochée,
>   `STATUS_ORDER` à 3 dans `CompanyDealsTable.tsx`, 3ᵉ option dans
>   `ExitDealDialog.tsx`. Libellés en/fr dans `participations.json` et
>   `chat.json`.
> - Tests ajoutés : `residualValueCents` sur `cancelled`
>   (`tests/metrics.test.ts`) et non-résurrection par `advancesStatus`
>   (`tests/attioSync.test.ts`).

---

## v1.186.0 — 07/08/2026 à 13:35 — Récupérer les chiffres des participations depuis les documents juridiques

Beaucoup de fiches deals et sociétés ont des cases vides — nombre de titres,
prix de souscription, pourcentage de détention, taille et type du tour,
valorisations, dates de closing — alors que l'information dort dans les
pactes, bulletins de souscription et PV déjà déposés sur les fiches.

Un nouvel outil les lit et propose de les remplir. Il fonctionne en deux
temps, et le premier n'écrit **rien** :

- **Proposition.** L'outil parcourt les participations d'Albo Club, fait lire
  chaque document juridique, et rend un rapport en trois sections :
  **propositions** (case vide, valeur trouvée), **écarts** (le document
  contredit ce qui est déjà saisi) et **non traité** (avec le motif :
  document illisible, tour non qualifié, sources contradictoires…). Chaque
  ligne indique le document source et l'extrait exact qui justifie la valeur.
- **Validation.** Le rapport sort aussi en tableur. Il suffit de mettre `1`
  dans la colonne « ok » sur les lignes retenues et de relancer : seules
  celles-là sont écrites.

Trois garanties tenues par construction. Une valeur déjà saisie n'est
**jamais** écrasée en silence : si un document la contredit, la ligne part en
écarts et attend une validation explicite. Rien n'est deviné : quand un
document ne dit pas quelque chose, la case reste vide avec un motif plutôt que
de recevoir une estimation. Et les valorisations, qui se déduisent d'un calcul
plutôt que de se lire, sont signalées comme telles — avec une alerte
supplémentaire quand des instruments ont converti à prix réduit, ce qui gonfle
mécaniquement le résultat.

L'outil est rejouable : une nouvelle participation ou de nouveaux documents
déposés, on relance et seul ce qui a changé est retraité.

À noter : sur une fiche société, le pourcentage affiché en en-tête et le
pourcentage de détention stocké sur le deal peuvent différer. Ce n'est pas une
erreur — l'un rapporte les titres détenus au capital effectivement émis,
l'autre reprend le pourcentage du pacte, calculé en incluant les titres à
émettre. Deux questions différentes, deux réponses différentes.

> **🔧 Notes techniques**
>
> - Nouveau `convex/lib/docBackfill.ts` : couche **pure** (aucun accès base,
>   aucun réseau) qui arbitre les sources, convertit en centimes/bps/ISO,
>   dérive les valorisations et trie en PROPOSITION / ECART / NON_TRAITE.
>   `planDeal()` en est le seul point d'entrée.
> - Nouveau `convex/migrations/alboDocBackfill.ts` : `listTargets` (cibles +
>   valeurs courantes, sans une ligne de texte), `getDocText` (fenêtres de
>   40 000 caractères), `extractDocument` (un appel `generateObject` par
>   document, schéma Zod strict, `keepOnlyQuoted` rejette toute valeur dont
>   l'extrait n'est pas littéralement dans le texte), `planForDeal`,
>   `applyRows`.
> - `applyRows` porte la règle cardinale : verrou optimiste sur
>   `expectedCurrent` — la colonne doit encore contenir exactement ce que le
>   dry-run a vu, sinon la ligne est refusée. C'est ce qui rend un 2ᵉ apply
>   no-op et interdit l'écrasement silencieux. SIREN repassé par
>   `normalizeSiren` + `assertSirenFree`, `roundType` revalidé contre l'enum.
> - Nouveau `scripts/backfill-deal-fields.mjs` : orchestrateur deux modes
>   (dry-run par défaut / `--apply <csv>`), pagination + recollage du texte,
>   cache `scripts/data/.backfill-cache.json` par documentId + hash FNV-1a du
>   texte qui court-circuite le modèle **avant** l'appel, rendu markdown + CSV
>   (parseur RFC-4180 minimal, BOM strippé).
> - Rattachement document → deal : un document portant `dealId` alimente ce
>   deal ; sur une société à deal unique les documents non rattachés
>   l'alimentent aussi ; sur une société à plusieurs deals ils n'alimentent
>   que l'identité société (attribuer un pacte au mauvais tour serait
>   exactement l'erreur plausible à éviter).
> - `convex/regression.docBackfill.test.ts` : 17 tests sur fixture figée
>   (l'extraction LLM n'est pas reproductible en CI, la couche déterministe
>   si). Cas de référence Auxicare reproduit à l'identique, plus le piège des
>   trois nombres d'actions, la hiérarchie des sources, le repli non dilué et
>   la règle cardinale.
> - `companies.notes` reste hors périmètre : aucune convention ne définit ce
>   qui doit y figurer. La note de base FD va dans les notes du **deal**.

---

## v1.185.0 — 07/08/2026 à 13:00 — L'historique de vos reportings rejoint Albo OS

Jusqu'ici, Albo OS ne connaissait vos participations qu'à partir de juillet
2026, date à laquelle les reportings ont commencé à arriver par e-mail. Tout
ce qui précède — deux ans et demi d'updates investisseurs, depuis janvier
2024 — vivait dans l'autre outil. Résultat : une fiche participation
commençait au milieu de l'histoire.

Cette mise à jour apporte la machinerie qui rapatrie cet historique dans
l'org Albo : **139 reportings** sur **31 participations**, avec leurs pièces
jointes. Une fois l'opération lancée, la frise d'une participation se lit
d'un bout à l'autre, et l'assistant IA peut s'appuyer dessus.

Le soin a porté sur les doublons. Certains reportings étaient présents des
deux côtés, et rien ne permettait de les reconnaître automatiquement : selon
les cas, la période diffère (un même e-mail Goodvest est classé « juin » ici
et « T2 » là), la date d'arrivée diffère, ou l'identifiant du message ne
correspond pas parce que nous recevons des transferts. Les reportings ont
donc été comparés sur leur **contenu**, participation par participation :
**18 doublons** ont été écartés après vérification.

L'inverse a été traité avec la même attention : deux documents peuvent
légitimement partager une période sans être le même. L'annonce Wandercraft ×
Renault et le reporting mensuel de mars sont deux choses différentes ; chez
Bleen, l'e-mail annonçant l'entrée de Jimmy au capital et la notification
formelle au titre du pacte aussi. Ces cas-là ont été conservés en double,
délibérément.

Trois participations restent volontairement de côté : celles dont les
nouvelles passent par un portail plutôt que par e-mail, et une dont il faut
encore décider à quelle entité rattacher les reportings.

> **🔧 Notes techniques**
>
> - Nouveau champ `companyReports.alboReportId` (+ index `by_albo_report`) :
>   l'uuid de la ligne Supabase d'origine, seule clé d'idempotence de
>   l'import. Additif, jamais posé par le pipeline e-mail ni par un dépôt
>   manuel.
> - `convex/migrations/alboReportsImport.ts` — `startUploads` (URLs d'upload),
>   `plan` (état Albo OS lu en direct pour le dry run), `importOne` (écriture
>   d'un report + ses `documents` + `documentTexts`), `verify`. `importOne`
>   renvoie toujours `created` / `already_imported` / `period_taken` : une
>   collision **saute**, elle n'écrase jamais.
> - `scripts/import-albo-reports.mjs` — lit Supabase, résout les décisions,
>   fait transiter les octets de Supabase Storage vers Convex storage sans
>   passer par une fonction Convex. `--dry` par défaut.
> - `scripts/data/albo-reports-albo.json` — décisions figées et relues :
>   mapping des 31 participations, 18 doublons vérifiés sur le contenu,
>   6 lignes explicitement autorisées à partager un créneau de période,
>   3 participations écartées avec leur motif.
> - **N'utilise pas** `reportStore.storeForCompany` : elle met à jour sur
>   place et supprime les `documents` du report. `companyIntelligence.
latestReportId` est laissé intact (un import historique ne repointe pas
>   la synthèse courante). `recordReportOnCompany` est monotone, donc la
>   fraîcheur ne recule pas.
> - Les métriques sont recopiées telles quelles dans `metrics` (affichage) et
>   n'alimentent pas `kpiSnapshots` : le catalogue canonique diffère et aucun
>   LLM ne tourne pendant l'import. Le texte déjà extrait des pièces jointes
>   est repris dans `documentTexts` pour ne pas repayer l'OCR.
> - Les lignes arrivent en `vectorState: 'pending'` ; l'indexation se fait
>   ensuite via `vectorize:backfillAll` (éviter une rafale d'embeddings).
> - Pourquoi aucune clé automatique ne convenait :
>   `KNOWN_ISSUES.md` § « Reprise d'un historique de reports depuis un autre
>   outil ». Runbook : `MIGRATIONS.md`.

---

## v1.184.0 — 07/08/2026 à 12:19 — Le connecteur Claude lit enfin la documentation juridique des participations

Les 320 documents juridiques versés sur les fiches des participations —
pactes d'actionnaires, statuts, bulletins de souscription, PV d'assemblée,
term sheets, comptes annuels — étaient jusqu'ici invisibles depuis
claude.ai. Le connecteur savait dire _qu'un_ pacte existait sur une fiche :
son titre, sa date, son poids. Il ne pouvait pas l'ouvrir, ni chercher
dedans. Répondre à « qu'est-ce que dit la clause de liquidité de Sezame ? »
supposait d'ouvrir l'app et de lire le PDF soi-même.

Le connecteur accède maintenant au **contenu** de cette documentation, de
deux façons complémentaires :

- **Une recherche par le sens sur toute la documentation de
  l'organisation.** On pose la question en français, sans deviner les mots
  exacts du document : « où est-ce que j'ai un droit de préemption ? », «
  quelles sont mes obligations de non-concurrence ? ». La réponse rend des
  extraits en citant le document d'origine, et la recherche peut être
  restreinte à une seule participation. Elle couvre aussi les reportings
  investisseurs déjà analysés.
- **La lecture intégrale d'un document**, quand un extrait ne suffit pas —
  relire un pacte en entier, vérifier un article précis des statuts.

En pratique, il devient possible de croiser depuis Claude une question
juridique et les chiffres du portefeuille dans la même conversation : « sur
quelles participations ai-je un droit de suite, et combien y ai-je investi
? ».

Deux limites à connaître. Seuls les documents **dont l'app a réussi à lire
le texte** sont concernés : un scan de mauvaise qualité ou un fichier en
échec de lecture reste invisible à la recherche — la fiche société indique
l'état de lecture document par document. Et le connecteur reste en
**lecture** sur ce périmètre : il ne peut ni ajouter, ni modifier, ni
supprimer un document.

> **🔧 Notes techniques**
>
> - Deux outils MCP en lecture ajoutés à `convex/mcp/registry.ts` (26 → 28
>   outils, 24 en lecture) : `searchDocuments`, wrapper direct sur
>   `internal.vectorize.searchInternal` — exactement le même appel que
>   l'outil agent in-app `agentToolsDocuments.ts`, aucun backend nouveau ;
>   et `getDocumentText`, adossé à un nouvel `internalQuery`
>   `getDocumentTextInternal` (`convex/agentTools.ts`).
> - `getDocumentTextInternal` est le pendant MCP de
>   `documents.getExtractedText` : `actorUserId` explicite au lieu de
>   l'identité de session (l'endpoint `/mcp` n'en a pas), `readMembership` +
>   contrôle `doc.orgId === orgId`, lecture de `documentTexts` par
>   `storageId` (le texte est propriété du blob, pas de la ligne).
> - **Pagination obligatoire** : un texte stocké va jusqu'à
>   `MAX_DOCUMENT_CHARS` (900 000 caractères), soit ~900 ko dans une seule
>   réponse JSON-RPC. La lecture se fait donc par fenêtre de 40 000
>   caractères avec `nextOffset` rappelé jusqu'à `null`. Ne pas confondre
>   avec `truncated`, qui dit que le fichier a été coupé à l'extraction —
>   détaillé dans `KNOWN_ISSUES.md` « Serveur MCP distant » point 9.
> - `listCompanyDocumentsInternal` renvoie en plus `ocrState` (champ
>   additif, l'agent in-app le voit aussi) : sans lui le client appelle
>   `getDocumentText` à l'aveugle sur un document jamais lu et ne sait pas
>   interpréter le `null`.
> - ⚠️ Après déploiement : **déconnecter puis reconnecter** le connecteur
>   Albo OS dans claude.ai — les schémas d'outils sont figés au moment de la
>   connexion.

## v1.183.0 — 06/08/2026 à 12:52 — Un virement interne devient un mouvement à deux jambes, plus une simple étiquette

Jusqu'ici, classer une transaction en « virement interne » posait une
étiquette sur cette ligne, et rien d'autre. Les deux jambes d'un même
virement — l'argent qui part d'un compte, l'argent qui arrive sur l'autre —
n'étaient reliées par rien. Personne ne pouvait donc voir qu'il en manquait
une : une jambe classée toute seule sortait de l'analyse en silence, et une
vraie dépense classée par erreur disparaissait sans laisser de trace.

Un virement interne est désormais **un mouvement à deux jambes**. Quand vous
classez une ligne en virement interne, Albo OS vous demande dans la foulée sa
contrepartie et vous propose les mouvements des **autres comptes de la même
entité**, en sens inverse. Vous choisissez, le virement est complet.

Ce que ça change concrètement :

- **Un virement incomplet se voit.** Le registre Trésorerie gagne un filtre
  « Virements à apparier », et la ligne porte un badge orange tant que sa
  contrepartie manque. Rien ne peut plus disparaître par inattention.
- **L'écart entre les deux jambes est affiché.** Si 50 000 € partent et que
  49 985 € arrivent, les 15 € de frais bancaires apparaissent sur la fiche du
  mouvement au lieu de s'évaporer.
- **Le délai de transit est visible.** Un virement parti lundi et arrivé
  mercredi n'est plus un trou inexpliqué dans le solde.
- **Un virement entre deux entités différentes est refusé.** Ce n'est pas un
  virement interne : c'est un mouvement vers cette entité, à pointer comme un
  investissement. Le message vous le dit et vous oriente.
- **Les virements internes ne s'apprennent plus automatiquement.** Un
  classement automatique par libellé pouvait retirer des mouvements de
  l'analyse en série, sans que personne le remarque. Un libellé ne peut de
  toute façon pas deviner sur quel compte se trouve la contrepartie.

Les virements déjà classés avant cette mise à jour ne sont pas modifiés : ils
apparaissent simplement dans « Virements à apparier », ce qui vous donne la
liste de ce qui reste à relier. Rien ne change dans l'analyse des flux ni dans
le prévisionnel — un virement interne en reste exclu, exactement comme avant.

> **🔧 Notes techniques**
>
> - Nouvelle table `transfers` (`orgId`, `ownerCompanyId`, `createdBy`),
>   délibérément minimale : montant, écart et délai de transit sont **dérivés**
>   des deux jambes, jamais stockés (même principe que les soldes de C/C).
> - Réutilise le pointage généralisé existant : `allocationKind` gagne
>   `'transfer'`, et chaque jambe porte
>   `allocation = { kind: 'transfer', targetId }`. C'est le **seul** kind qui
>   laisse `matchStatus` à `'internal_transfer'` au lieu de `'matched'` — donc
>   `effectiveCategory` continue de renvoyer `null` et l'analyse ne bouge pas.
> - Cœur d'écriture dans `convex/lib/pointage.ts` : `applyOpenTransfer`,
>   `applyPairTransfer` (invariant dur : même `bankAccounts.ownerCompanyId`,
>   comptes distincts, sens opposés ; absorbe la demi-jambe adverse pour
>   fusionner deux moitiés en un seul virement), `applyUnpairTransfer` (supprime
>   la ligne `transfers` devenue sans jambe). `assertNotAllocatedToLiability`
>   devient `assertNotAllocatedElsewhere` (nouveau code `allocated_to_transfer`).
> - Helpers de lecture partagés dans `convex/lib/transfers.ts`
>   (`transferLegs`, `transferLegCounts`, `isIncompleteTransferLeg`) — les
>   lignes taguées avant la feature n'ont pas d'allocation et sont donc
>   incomplètes **par construction**, sans backfill.
> - API publique `convex/transfers.ts` : `getForTransaction` (écart + transit),
>   `listPairable` (filtre **structurel**, jamais un tri par vraisemblance —
>   cf. interdit anti-suggestion), `pairTransfer`, `unpairTransfer`.
> - `listLedger` gagne `transferState: 'incomplete'` (même grammaire que
>   `matchedKind`) et expose `transferIncomplete` par ligne.
> - `internal_transfer` retiré de `CategoryRuleStatus` (création **et**
>   application, via `isActiveRule`) ; la valeur reste dans l'union du schéma
>   pour ne pas invalider les lignes existantes. One-shot
>   `transactions:dropInternalTransferRules` pour nettoyer la table.
> - Front : `TransferPairDialog.tsx` (enchaîné après le tag), badge et action
>   « Apparier » dans `PointageTable`, bloc contrepartie/écart/transit dans
>   `TransactionSheet`, filtre dans `TransactionsLedger`.
> - 13 tests de régression dans `convex/regression.transfers.test.ts`.

## v1.182.1 — 06/08/2026 à 12:47 — L'import des documents juridiques survit à une coupure réseau

Un incident réseau pendant l'import — une simple résolution DNS qui échoue —
interrompait toute l'opération au lot en cours. L'import reprend maintenant
tout seul : trois tentatives espacées avant de renoncer, et un lot en échec
n'arrête plus les suivants. Les documents déjà importés ne sont jamais
recréés, donc relancer reste sans risque.

> **🔧 Notes techniques**
>
> - `scripts/import-legal-docs.mjs` : `convex()` enveloppe désormais
>   `convexOnce()` avec trois tentatives et un backoff (4s, 8s). La CLI Convex
>   shell-out meurt avec un code non nul sur un incident réseau transitoire —
>   il suffit d'un échec DNS sur son reporting Sentry — ce qui faisait planter
>   le script entier via un rejet non capturé.
> - Les appels `startUploads` et `attachBatch` sont chacun dans un `try` : le
>   lot concerné part dans `failures`, la boucle continue. Un `attachBatch`
>   raté laisse des blobs non référencés, inertes, que le re-run réécrit.

## v1.182.0 — 06/08/2026 à 12:22 — Toute la documentation juridique d'Albo Club rejoint les fiches société

Les pactes, bulletins de souscription, statuts, procès-verbaux d'assemblée et
comptes annuels d'Albo Club vivaient jusqu'ici uniquement dans le Drive. Ils
sont désormais importables en une seule opération sur les fiches société :
**320 documents répartis sur 42 participations**, avec leur type et, quand le
nom de fichier le portait, leur date.

Une fois importés, ils passent par la lecture automatique et deviennent
consultables depuis la fiche société et interrogeables par l'assistant.

Ce qui a été volontairement laissé de côté, et pourquoi :

- **les documents nominatifs des autres investisseurs** (leurs bulletins,
  leurs actes de renonciation, leurs engagements contractuels) : ils
  n'engagent pas Albo Club et noieraient les fiches — la souscription
  d'Auxicare en comptait quatorze pour une seule qui nous concerne ;
- les certificats de signature, les récapitulatifs automatiques et les RIB ;
- les decks et présentations, qui ne sont pas des documents juridiques ;
- les fichiers dépassant la limite de 20 Mo, et les archives compressées,
  que la lecture automatique ne sait pas ouvrir ;
- la version la plus légère quand un même document existe en double —
  typiquement un bulletin non signé à côté de sa version signée.

Les documents déjà déposés à la main restent en place : l'import les
reconnaît et ne les recrée pas.

> **🔧 Notes techniques**
>
> - Nouveau module `convex/migrations/legalDocsImport.ts` : `startUploads`
>   (mint d'URLs d'upload), `attachBatch` (écriture des lignes `documents`,
>   avec planification de `documentsExtract.run` comme le fait
>   `documents:create`), plus `dryRun` et `verify` en lecture seule.
> - Les octets ne transitent jamais par une fonction Convex : le script
>   `scripts/import-legal-docs.mjs` tire le fichier de l'API Drive et le POSTe
>   directement sur l'URL d'upload, qui accepte une requête non authentifiée.
>   C'est ce qui permet un import piloté en CLI sans session utilisateur.
> - Idempotence sur le triplet `companyId` + `title` + `size` : un re-run est
>   un no-op, un run interrompu se reprend en le relançant. Le blob fraîchement
>   téléversé d'une ligne ignorée est supprimé pour ne pas laisser de storage
>   orphelin.
> - La correspondance est figée dans `scripts/data/legal-docs-albo.json`
>   (320 lignes : société, identifiant Drive, titre, type, période). Elle a été
>   produite par balayage de l'arbre Drive « ⚠️ Investissements » puis revue à
>   la main ; six documents Wheelee déjà présents en base en ont été retirés
>   après rapprochement sur la taille en octets.
> - Le titre stocké perd son extension, par cohérence avec les uploads
>   manuels ; le type MIME est reconstruit depuis `sourceExt`.

## v1.181.1 — 06/08/2026 à 09:25 — La liste des participations arrête de relire tous les reportings

Depuis l'arrivée de l'alerte « cette participation ne reporte plus », ouvrir
la liste des participations faisait relire à la base **l'intégralité des
reportings reçus** — le texte complet de chaque e-mail et de chaque pièce
jointe — pour n'en tirer qu'une seule information par société : la date du
dernier reçu. Invisible à l'usage, mais lourd : la consommation de la base a
été multipliée par quatre en une journée, jusqu'à frôler le plafond mensuel
du compte. Rien ne s'était cassé, mais l'outil s'approchait de la limite où
il aurait pu s'arrêter.

Cette date est désormais notée sur la fiche de la société **au moment où le
reporting arrive**, une fois pour toutes. La liste la lit au passage, sans
rouvrir un seul reporting. Rien ne change à l'écran : mêmes alertes, mêmes
sociétés signalées, mêmes délais — c'est le chemin pour y arriver qui a été
raccourci.

> **🔧 Notes techniques**
>
> - Cause : `lib/reportFreshness.ts:listSilentCompanies` faisait un
>   `.collect()` de `companyReports` par org pour en dériver deux dates par
>   société. Convex lit la **ligne entière** — donc `rawContent` (≤ 300k
>   caractères) et `cleanedHtml` (≤ 100k) à chaque exécution — et la fonction
>   est appelée par `deals.listParticipations` **et**
>   `aggregate.listParticipations`, deux requêtes réactives sur la page la
>   plus ouverte de l'app.
> - Correctif : dénormalisation de `companies.lastReportAt` et
>   `lastReportCoverageAt`, maintenues par `recordReportOnCompany`
>   (`lib/reportFreshness.ts`) appelé depuis `reportStore.storeForCompany`.
>   Écriture monotone (max) : un report antidaté ne fait pas reculer la
>   fraîcheur. La liste lit ces champs sur les `companies` qu'elle collectait
>   déjà → coût de lecture supplémentaire nul.
> - Les **quatre** sites de mutation de `companyReports` sont couverts :
>   insert et patch (`reportStore`), patch d'état d'indexation (`vectorize`,
>   sans effet sur les dates) et surtout la **suppression**
>   (`reportInbox.detachCompany`, arrivé avec le détachement de la v1.181.0).
>   Une écriture monotone ne sait pas reculer : détacher le dernier report
>   d'une participation la laissait plus fraîche qu'elle ne l'est, donc
>   dispensée d'alerte en silence. D'où `recomputeReportFreshness`, qui
>   reconstruit depuis les reports restants sur ce seul geste — rare, humain,
>   jamais sur un chemin de lecture.
> - `migrations/backfillReportFreshness` (`dryRun`/`apply`/`report`)
>   reconstruit les deux dates depuis les reports. **À lancer juste après le
>   deploy**, sinon toute participation ayant reporté avant compte comme
>   « sans nouvelle » — cf. `MIGRATIONS.md`.
> - Comportement inchangé : `regression.reportFreshness.test.ts` passe sans
>   modification de ses assertions (seul le fixture maintient désormais la
>   copie, comme le pipeline).
> - Le piège générique et les foyers restants (`documents.extractedText`,
>   `reportInbox.list`, `companyReports.listByCompany`) sont documentés dans
>   `KNOWN_ISSUES.md` « Database I/O : un gros champ texte sur une ligne lue
>   en liste », plus un anti-pattern dans `CLAUDE.md`.

## v1.181.0 — 05/08/2026 à 19:54 — Un report rangé sur la mauvaise participation se détache

Jusqu'ici, rattacher un report était à sens unique : on pouvait l'ajouter à
une participation, jamais l'en retirer. Un rattachement fait un peu vite, ou
tombé sur le mauvais véhicule d'un sponsor, restait donc sur la fiche pour
toujours — avec ses fichiers et les KPIs qu'il avait renseignés.

Le geste inverse existe maintenant, à l'endroit où l'erreur se constate comme
à celui où elle se commet :

- **Depuis la fiche société** : ouvrir le report dans la liste Documents &
  rapports, puis « Détacher de cette participation ».
- **Depuis les Rapports entrants** : la croix sur la puce de la participation
  concernée.

Dans les deux cas, le report quitte cette fiche **proprement** : ses fichiers
et les KPIs qu'il avait alimentés partent avec lui, il sort de la recherche
de la société, et la synthèse repart du report précédent. Ce qui ne bouge
pas : les **autres** participations rattachées au même report gardent le
leur, et le mail d'origine reste dans la file — il n'y a plus qu'à le
rattacher là où il devait aller. Un détachement est définitif côté fiche,
d'où la fenêtre de confirmation qui dit ce qui part.

> **🔧 Notes techniques**
>
> - Nouvelle mutation publique `reportInbox.detachCompany({ reportId })`,
>   miroir de `assignCompany` : `requireOrgMember` sur l'org du report, puis
>   suppression de toute l'empreinte écrite par `reportStore.storeForCompany`
>   pour **cette entité seulement** — ligne `companyReports`, lignes
>   `documents` filtrées sur `companyId`, `kpiSnapshots` taggés
>   `source: "report:<id>"`, repli de `companyIntelligence.latestReportId` sur
>   le report suivant (ou effacement), et `vectorize.removeEntry` sur la clé
>   `report:<id>`.
> - Le **blob de storage n'est pas supprimé** : il est partagé par les lignes
>   `documents` de toutes les entités du fan-out et par la pièce jointe de
>   `inboundEmails`. Détail et pièges dans `KNOWN_ISSUES.md` § « Détacher un
>   report ».
> - La ligne de la file est corrigée dans la même transaction
>   (`matchedCompanies`, `reportIds`), sinon un « Retraiter » ultérieur
>   remettrait le report sur l'entité détachée. Ça a demandé un back-link
>   `companyReports.inboundEmailId` (posé au rangement) ; les lignes
>   antérieures sont retrouvées via `agentmailMessageId`.
> - `reportInbox.list` expose désormais `matched: [{ companyId, name,
reportId }]` au lieu de `matchedNames` + `matchedCompanyIds` — la file
>   rend une puce par **entité** (deux orgs = deux puces) avec sa croix, et
>   seules celles portant réellement un report en ont une.
> - Couverture : `convex/regression.reportDetach.test.ts` (6 cas — périmètre
>   de la suppression, blob préservé, correction de la file, repli et
>   effacement du pointeur de synthèse, refus hors org). `TESTING.md` R28c /
>   R28d.

## v1.180.2 — 05/08/2026 à 19:27 — Les fondateurs et co-investisseurs liés à Attio se voient enfin comme des liens

Sur la fiche d'une participation, les puces des sections Fondateur(s),
Membres du board et Co-investisseurs ouvrent la fiche Attio correspondante
quand elles sont reliées au CRM. Mais rien ne le disait vraiment : la puce
changeait juste de fond au survol, exactement comme n'importe quel élément
neutre, et la petite flèche en bout de puce se remarquait à peine. On ne
savait pas où l'on pouvait cliquer.

Le nom se **souligne** désormais au survol des puces reliées à Attio,
comme partout ailleurs dans l'app. Les puces sans lien, elles, ne bougent
pas — la différence entre « ça ouvre le CRM » et « c'est juste un nom »
se lit maintenant d'un coup d'œil.

> **🔧 Notes techniques**
>
> - `src/components/companies/PeopleEditor.tsx` (`PersonChip`) : ajout de
>   `group` sur l'ancre Attio et de `underline-offset-2 group-hover:underline`
>   sur le `span` du nom. Le soulignement porte sur le seul nom, pas sur
>   l'avatar ni sur la flèche `ArrowUpRight` — ils vivent dans les gaps du
>   flex.
> - Aligne les puces sur la convention déjà en place pour le champ Attio de
>   la fiche société (`AttioCompanyField.tsx`, `underline-offset-4
hover:underline`).
> - Le fond `has-[a:hover]:bg-accent` de la puce est conservé : les deux
>   signaux se cumulent. La branche non liée (`url === null`) est inchangée.

## v1.180.1 — 05/08/2026 à 18:13 — Les courriers sans période ne bloquent plus le circuit des reports

Un courrier de liquidation transféré sur Wheelee revenait indéfiniment en
« erreur technique pendant l'analyse », et le rattacher à la main n'y
changeait rien. La cause : le circuit exigeait de **tout** report une
période couverte et un rythme (mensuel, trimestriel, annuel…). Un avis de
liquidation, une notification juridique, une annonce de levée n'ont ni
l'une ni l'autre — le circuit refusait donc la lecture pourtant correcte
qu'en faisait l'IA, et bouclait à chaque nouvel essai puisque le contenu,
lui, ne changeait jamais.

Ces courriers sont désormais rangés comme les autres, avec leur titre,
leur résumé et leurs points clés, **sans période**, à leur date de
réception. Rien n'est inventé : plutôt que de leur coller un mois au
hasard, la période reste vide. Deux courriers ponctuels d'une même société
ne se remplacent plus l'un l'autre, et aucun n'écrase le report périodique
de la même période.

Second changement, valable pour **tous** les échecs : le message technique
de l'erreur s'affiche maintenant sous le statut dans la boîte Rapports
entrants, et dans l'email « Report non traité ». Jusqu'ici il n'était
lisible que depuis la console technique — une catégorie comme « erreur
technique pendant l'analyse » ne disait rien de ce qui s'était passé.

> **🔧 Notes techniques**
>
> - `convex/reportStore.ts` : `report_period` et `report_type` passent en `.nullable()` dans `analysisSchema`, avec une règle explicite dans le `SYSTEM_PROMPT` (un document ponctuel est un report valide, `title`/`headline`/`key_highlights` toujours remplis, aucune période inventée). Les deux champs deviennent `v.optional` sur `storeForCompany` — le schéma Convex les déclarait déjà facultatifs.
> - **Piège du dédoublonnage** : `by_company_period` avec `reportPeriod: undefined` matche _toutes_ les lignes sans période d'une société — un `.first()` naïf aurait fait écraser silencieusement chaque courrier ponctuel par le suivant. Un document sans période est donc identifié par son message d'origine (`subject` + `emailDate`, portés par un mail comme par un dépôt manuel). `periodSortDate` retombe sur `receivedAt` pour garder un ancrage dans la timeline (index `by_company`). Détaillé dans `KNOWN_ISSUES.md` § « Report sans période ».
> - Nouveau `convex/regression.reportStore.test.ts` (4 cas : coexistence, rejeu idempotent, non-collision avec un report périodique, dédup périodique inchangée) — vérifié en échec contre la version naïve avant d'être figé. 61 tests de régression Convex, 317 unitaires.
> - Visibilité de l'erreur : `reportInbox.list` renvoie `error` (champ déjà écrit par `reportIdentify.setReview`, exposé nulle part) ; affiché sous le badge dans `src/routes/app/all/reports.tsx` (tronqué, complet au survol) ; `reportRecapFailureHtml` prend un `detail` optionnel borné à 300 caractères. Message brut, dev-facing, non traduit.
> - Récap de succès sans période : titre « ✅ Report rangé — document ponctuel, sans période », objet « Albo OS — report rangé : document ponctuel ».

## v1.180.0 — 05/08/2026 à 18:11 — Rattacher un report à une seconde participation

Une même boîte détenue par Calte **et** Albo peut porter un nom différent de
chaque côté — `Oprtrs & Co` ici, `OPRTRS CLUB` là ; `Parallel Invest SPV 13
(Bernay)` et `Parallel Invest SPV13`. Rien ne permet de deviner que ces deux
lignes sont la même boîte : elles se ressemblent autant que Sezame Immo 2 et
Sezame Immo 6, qui sont deux véhicules bien distincts. Le report se rangeait
donc d'un seul côté, et il n'y avait aucun moyen d'ajouter l'autre après
coup.

- **Un report peut désormais être rattaché à plusieurs participations**, et
  on peut en ajouter une **même quand le report est déjà rangé** : la
  nouvelle s'ajoute aux précédentes, celles déjà servies ne bougent pas.
- **Les fiches apparentées vous sont proposées.** Quand vous choisissez une
  participation, celles qui partagent son site web dans une **autre
  organisation** apparaissent sous forme de cases à cocher, la plus proche
  en tête. Rien n'est coché tout seul : sur un domaine de plateforme, les
  voisines sont d'autres véhicules, à vous de dire lesquelles sont
  concernées.
- **La file vous le signale.** Un report rangé alors qu'une organisation a
  une fiche sur le même domaine sans rien avoir reçu porte un repère
  « + Calte ? » dans la colonne Participation, et un bouton « Rattacher
  aussi ». Un report déjà rangé des deux côtés n'affiche rien.
- **Aucun accusé en double** : ajouter une participation à un report déjà
  traité ne renvoie pas de récapitulatif à qui l'avait transféré.

Le repère nomme l'**organisation**, pas le nombre de fiches : sur un domaine
comme celui de Parallel, l'autre organisation en héberge une quinzaine sans
rapport, et un « +15 » n'aurait rien voulu dire.

> **🔧 Notes techniques**
>
> - `reportInbox.assignCompany` prend `companyIds` (1..n) et devient
>   **additif** sur une ligne `processed` : union avec `matchedCompanies`,
>   `reportIds` remis à zéro, `notifiedAt` **conservé** (pas de second récap).
>   Rejouer `reportStore.run` est sûr : il upsert par (société, période), donc
>   les entités déjà servies sont mises à jour en place.
> - `reportInbox.list` renvoie `matchedCompanyIds` et `relatedOrgNames` — les
>   orgs qui n'ont **rien** reçu du report alors qu'elles portent une société
>   sur un des domaines rattachés. Nommer l'org plutôt que compter les
>   entités évite le « +15 » d'un domaine de sponsor.
> - `listAssignTargets` expose `orgId` + `domain` ; le dialog
>   (`src/routes/app/all/reports.tsx`) construit le bloc « même domaine, autre
>   org », trié par un Dice sur bigrammes (`nameProximity`) — un tri, jamais
>   une décision.
> - Tests : `convex/regression.reportIdentify.test.ts` (ajout après coup,
>   union, `notifiedAt` préservé, apparition/disparition du repère).

## v1.179.0 — 05/08/2026 à 13:56 — Le pointage ne propose plus rien (et c'est voulu)

Albo OS affichait des propositions de rapprochement un peu partout : un
bandeau « Proposition » sous les lignes à pointer, une carte
« Rapprochements suggérés », des « règles suggérées », et une proposition de
solder l'échéance prévue juste après un pointage. **Tout cela est retiré.**

La raison est simple : le système se trompait sans le dire. Il rattachait
des transactions au mauvais deal, confondait un deal avec une échéance
prévue, et rien à l'écran ne signalait que la proposition était fausse. Une
proposition juste fait gagner cinq secondes ; une proposition fausse
acceptée de confiance coûte beaucoup plus cher à retrouver.

Le pointage redevient donc entièrement manuel : vous ouvrez la file, vous
choisissez la destination avec le menu « Affecter à… », comme avant. Rien
d'autre ne change — la classification (charge, impôt, produit, virement
interne), les actions groupées, le détachement et l'historique sont
intacts. L'assistant IA sait toujours pointer, mais il ne devine plus la
cible : vous la lui nommez, il l'applique après approbation.

Nouveau au passage : une échéance prévue se marque **« réalisée » depuis sa
ligne**, dans « Échéances ponctuelles ». Vous y choisissez vous-même la
transaction correspondante — la liste est triée de la plus récente à la
plus ancienne, avec une recherche libre. Si la transaction paye moins que
prévu, vous choisissez de clore avec l'écart ou de garder le reste attendu.

C'est volontairement une étape en arrière, le temps de rassembler assez de
cas réels pour reconstruire un rapprochement automatique digne de
confiance. Chaque pointage fait à la main aujourd'hui alimente cette
matière : l'historique des décisions est conservé intact.

> **🔧 Notes techniques**
>
> - **Backend supprimé** : `transactions.getPointageSuggestions`,
>   `forecasts.suggestForecastMatches`, `forecasts.suggestRules` /
>   `dismissRuleSuggestion`, `agentToolsPointage.suggestMatchesInternal` +
>   l'outil agent `suggestMatches` et son entrée MCP, ainsi que les moteurs
>   purs `lib/suggest.ts`, `lib/entryMatching.ts`, `lib/transferPairs.ts`
>   et `lib/recurrenceDetection.ts` (avec leurs tests).
> - `transactions.matchTransaction` ne lit plus les `forecastEntries` : son
>   retour `pendingEntry` (qui alimentait le toast « Réaliser l'échéance »)
>   est supprimé, la mutation renvoie `null`. Le cœur `applyMatchToDeal`
>   est inchangé.
> - `lib/instructions.ts` : la consigne « utilise `suggestMatches` » est
>   remplacée par une interdiction explicite de proposer ou deviner une
>   cible — sans ça l'agent aurait cherché un outil disparu et inventé.
> - **Front supprimé** : `SuggestionBand` + état `refusedSuggestions` dans
>   `PointageTable.tsx`, `ForecastMatchSuggestions.tsx`,
>   `SuggestedRules.tsx` (et le `RulePrefill` devenu mort), le renderer
>   `suggestMatches` du panneau AI, clés i18n associées (fr + en).
> - **Ajout** : `RealizeEntryDialog` dans `ForecastSection.tsx` — sélecteur
>   de transaction via `transactions.listLedger` (date desc + recherche
>   libre), **aucun classement ni présélection**, modes `close` /
>   `keepRemainder` conservés. C'était le seul chemin manuel manquant :
>   les deux appelants de `markEntryRealized` vivaient dans les surfaces
>   supprimées.
> - **Schéma inchangé, aucune migration.** `matchStatus`, `allocation` et
>   surtout `matchingDecisions` (append-only) sont intacts. La table
>   `dismissedRuleSuggestions` devient inerte mais reste déclarée.
> - Garde-fou ajouté en anti-pattern dans `CLAUDE.md` + section refondue
>   dans `KNOWN_ISSUES.md` « Pointage transaction → deal ».

---

## v1.178.0 — 05/08/2026 à 12:15 — Les filtres restent en place quand vous changez de page

Vous filtriez la liste des investissements sur un instrument, vous ouvriez
une fiche pour vérifier un chiffre, vous reveniez : la liste était revenue
à zéro. Même chose sur le registre de trésorerie. Un filtre ne survivait
pas à une navigation, ce qui obligeait à le reposer à chaque aller-retour.

C'est fini. La recherche et les filtres sont désormais **mémorisés** :

- **Liste Entreprises** (par organisation et vue consolidée) : recherche,
  instrument, secteur.
- **Deals consolidés** : recherche, instrument, statut, secteur.
- **Registre de trésorerie** : recherche, montant min/max, statut et compte.

Vous partez sur une fiche, sur une autre page, vous rechargez même l'écran :
en revenant, la liste est exactement dans l'état où vous l'aviez laissée.
La mémoire est propre à **l'onglet du navigateur** — un nouvel onglet repart
sans filtre, et fermer l'onglet oublie tout. Chaque liste a la sienne : une
organisation n'impose pas ses filtres à une autre, ni à la vue consolidée.

Pour tout effacer d'un coup, le bouton **« Réinitialiser »** est à droite des
filtres. Il existait déjà sur les listes d'investissements mais n'apparaissait
que si une facette était cochée : il se déclenche maintenant dès qu'une
**recherche** est en cours, et il efface recherche et filtres ensemble. Le
registre de trésorerie, qui n'en avait pas, l'a désormais aussi.

Un détail conservé : les liens qui ouvrent le registre déjà filtré (les
boutons « Pointer » de la page À faire, les emails de rappel) restent
prioritaires sur le dernier filtre mémorisé — ils vous emmènent bien là où
ils le promettent.

> **🔧 Notes techniques**
>
> - Nouveau hook `src/hooks/usePersistentFilters.ts` : état de filtres
>   miroité dans `sessionStorage` sous une clé passée par la vue
>   (`participations:<slug|all>`, `deals:<slug|all>`, `cash-ledger:<slug>`).
>   API `[filters, patch, reset]` + helper `toggleValue` pour les facettes
>   multi-select ; valeurs JSON-sérialisables (tableaux, pas de `Set`).
> - Restauration dans un `useEffect` **après** le premier render (pas dans
>   l'état initial) : le serveur rend sans storage, lire pendant le render
>   casserait l'hydratation — même pattern que `ThemePicker`. L'état porte
>   la clé pour laquelle il a été restauré, ce qui empêche l'effet
>   d'écriture de persister les valeurs par défaut par-dessus l'entrée
>   sauvegardée (au montage comme au changement d'org).
> - `ParticipationsView` et `DealsListView` : les `useState<Set<string>>`
>   deviennent des tableaux persistés, re-dérivés en `Set` via `useMemo`
>   (`FacetFilter` est inchangé). La condition d'affichage du bouton
>   « Réinitialiser » passe de `hasFilters` à `search || hasFilters`, sur
>   la valeur **non débouncée** pour réagir dès la première frappe.
> - `TransactionsLedger` : statut, compte, recherche et bornes de montant
>   passent dans le hook (`accountId: ''` = tous les comptes) ; un effet
>   déclaré après le hook réapplique `initialFilter` (`?filter=`) par-dessus
>   la valeur restaurée, et un bouton « Réinitialiser » (clé
>   `pointage:filter.reset`, EN/FR) a été ajouté à la barre.
> - Docs : `TESTING.md` SH23 (listes) et CA14 (registre),
>   `docs/produit/04-participations.md` et `07-tresorerie.md`, plus une
>   ligne `TEMPLATE_SYNC.md` (le hook est du core générique).

## v1.177.2 — 05/08/2026 à 12:00 — Un report de sponsor ne contamine plus les véhicules voisins

Un report Sezame se rangeait à la fois sur Sezame Immo 2 et Sezame Immo 6.
La raison : tous les véhicules d'un sponsor partagent le même site web, et
c'est ce site qui servait à reconnaître la participation. Le même défaut
guettait Parallel, Anaxago, Rewatt, Virgil ou La Vie de Quartier — partout
où plusieurs lignes du portefeuille vivent sous un seul domaine.

- **Le site ne suffit plus quand plusieurs lignes le partagent.** Il dit qui
  écrit, pas de quel véhicule il parle. Sur ces domaines, il faut désormais
  que le véhicule soit **nommé dans le message** pour que le report se range
  tout seul.
- **Le doute part dans la file, plus dans une fiche au hasard.** Si le
  message ne nomme aucun véhicule, le mail atterrit dans Rapports entrants
  avec la mention « plusieurs participations possibles » — vous le rattachez
  en un clic, à la bonne ligne.
- **Le rattachement à la main ne déborde plus non plus.** Choisir un
  véhicule n'attache le report qu'à celui-là, alors qu'il arrosait avant
  tous ses voisins de domaine. Idem pour un dépôt de fichier depuis une
  fiche société.
- **Ce qui ne change pas** : une même boîte détenue par Calte **et** Albo
  reçoit toujours son report des deux côtés.

Les reports déjà rangés au mauvais endroit avant ce correctif restent à
corriger à la main.

> **🔧 Notes techniques**
>
> - Une seule notion porte la règle : `identityKey` dans
>   `convex/lib/emailIdentify.ts` — le domaine identifie une participation
>   s'il n'en porte qu'une (`sharedDomains` calcule les domaines disqualifiés
>   sur tous les candidats, toutes orgs), sinon c'est le nom normalisé.
> - `reportIdentify.run` : nouvelle étape `resolveOnSharedDomains` entre la
>   corroboration et la décision — sur un domaine partagé, les candidats
>   corroborés par le **nom** l'emportent ; si aucun ne l'est, tout le domaine
>   revient dans la sélection, ce qui produit ≥ 2 clés d'identité et donc
>   `ambiguous`. Le test d'ambiguïté et le fan-out se calculent maintenant sur
>   `identityKey` (le fan-out se réduit à un filtre sur la clé acceptée).
> - `reportInbox.sameParticipation` (rattachement manuel + upload) passe par
>   le même helper, sinon la correction manuelle ré-arrosait les voisins.
> - Tests : `tests/emailIdentify.test.ts` (helpers purs) et
>   `convex/regression.reportIdentify.test.ts` (fan-out du rattachement
>   manuel, cas Sezame / Waro multi-org / SPV détenu par deux orgs).
> - Limite assumée : le seul discriminant accepté est le nom complet de
>   l'entité. Deux entités d'une même boîte nommées différemment sur un
>   domaine de sponsor (`Oprtrs & Co` vs `OPRTRS CLUB`) ne fanent plus
>   ensemble — à corriger dans la donnée, pas dans le code (cf.
>   `KNOWN_ISSUES.md`).

## v1.177.1 — 05/08/2026 à 11:47 — Les tableurs sortent de la recherche de l'assistant

Un budget Excel ajouté sur une fiche société refusait obstinément d'être
indexé, et vous prévenait par email à chaque tentative. Deux choses derrière
ce message, et une seule vraie question.

Le déclencheur d'abord : depuis que les classeurs sont lus **en entier** (et
non plus tronqués à leurs premières lignes), un gros budget part au service
d'indexation en paquets nettement plus lourds qu'avant. Trop lourds pour
l'hébergeur européen sur lequel on a volontairement épinglé ce service : il
refusait la demande, sans repli possible ailleurs. Les envois sont désormais
découpés bien plus finement — même contenu, même hébergeur, mais chaque
demande passe.

La vraie question ensuite : **est-ce qu'un tableur a sa place dans cette
recherche ?** Non. L'assistant cherche sur le sens des phrases ; un tableau
découpé en morceaux perd ses en-têtes, et des colonnes de chiffres n'ont pas
de sens à retrouver. On indexait donc à perte.

- **Excel et CSV ne sont plus indexés**, volontairement. Ils affichent
  « Tableur — non indexé » à la place de l'alerte rouge, et ne déclenchent
  plus d'email.
- **Leur lecture ne change pas** : le texte extrait reste consultable en un
  clic, tous les onglets, comme avant.
- **Un tableur reçu par mail** reste couvert par la recherche à travers le
  contenu du rapport qui le transporte.
- **Tout le reste gagne de la marge** : pactes, term sheets, rapports et
  documents juridiques étaient plus près de la même limite qu'on ne le
  pensait.

Une limite assumée : l'assistant ne sait donc pas répondre sur le contenu
d'un business plan en tableur. Le jour où on le voudra, la bonne réponse
sera de lui donner de quoi **lire** le document, pas de l'indexer.

> **🔧 Notes techniques**
>
> - `convex/vectorize.ts` : `MAX_EMBEDDINGS_PER_CALL = 16` appliqué via
>   `wrapEmbeddingModel` (`ai`). Le client `@convex-dev/rag` passe les chunks
>   par paquets de 100 (en dur) et `@openrouter/ai-sdk-provider` laisse
>   `maxEmbeddingsPerCall` à `undefined` : `embedMany` envoyait les 100 chunks
>   (~100 k car.) en **une** requête, ~27 k tokens en prose et davantage sur du
>   tabulaire, contre la fenêtre de 32 k tokens de l'endpoint Nebius épinglé.
>   Au-delà, OpenRouter n'a plus d'endpoint où router (`allow_fallbacks: false`)
>   et répond **404** — d'où le `provider_http_404`, classé permanent donc sans
>   retry. Le wrapper laisse `modelId` et `provider` intacts : l'identité du
>   namespace RAG ne bouge pas, aucun backfill nécessaire.
> - `convex/lib/fileText.ts` : `isSpreadsheet(filename, contentType)`, mêmes
>   règles que `documentsExtract.classify` (xlsx/xls/xlsm/csv, extension ou
>   content-type), posé à côté de `isImage` pour que lecteurs et indexeur ne
>   divergent pas. Consommé par `documentSkipReason` (`convex/vectorize.ts`),
>   nouveau code de skip `'spreadsheet'` → état `skipped`, pas d'email.
>   Libellés `participations:vectorization.detail.spreadsheet` (FR/EN).
> - Le pipeline reports n'est **pas** touché : le texte d'une PJ tableur reste
>   fondu dans `rawContent` et indexé avec son report.
> - `tests/fileText.test.ts` (nouveau) couvre `isSpreadsheet` ; détails et
>   pièges dans `KNOWN_ISSUES.md` § « Vectorisation ».

---

## v1.177.0 — 05/08/2026 à 11:35 — Une même fiche Attio se rattache à plusieurs sociétés

Rattacher un SPV Parallel à sa fiche Attio était tout simplement impossible :
la ligne **Fiche Attio** du bloc Identité répondait « Cette fiche Attio est
déjà rattachée à une autre société ». Et pour cause — Attio ne connaît
**qu'une** fiche « Parallel Invest », avec un deal par SPV, là où Albo OS
tient **une entité par SPV**. La fiche était donc déjà prise par le chapeau,
et aucun des SPV ne pouvait ouvrir le CRM depuis sa propre page.

Désormais une même fiche Attio se rattache à **autant de sociétés que
nécessaire**, y compris dans des organisations différentes. Le geste ne
change pas : on clique la ligne, on cherche dans Attio, on choisit — et
c'est accepté même si une autre société pointe déjà sur la même fiche.

Un point à connaître : quand plusieurs sociétés partagent une fiche, les
deals qui arrivent d'Attio continuent d'atterrir sur la **première** d'entre
elles (la plus ancienne de l'organisation). Rattacher les suivantes sert à
ouvrir le CRM depuis leur page, pas à détourner la synchronisation — pour
changer la société cible d'un deal, ça se fait toujours sur le deal.

> **🔧 Notes techniques**
>
> - `convex/companies.ts` : suppression de `assertAttioCompanyIdFree` et de son
>   appel dans `update`. L'ancrage reste trimé, `''` détache toujours.
> - `convex/attioSync.ts:resolveOrCreateTargetCompany` lisait
>   `by_attio_company_id` en **`.unique()`** — c'était toute la raison d'être
>   du garde-fou : un doublon aurait fait throw la synchro au prochain
>   événement Attio. Remplacé par un `.collect()` + première société **de
>   l'org** ; l'ordre d'index étant l'ordre de création, la cible d'un deal
>   déjà synchronisé ne bouge pas.
> - Effet de bord voulu du même passage : l'ancrage est désormais posé sur la
>   société créée **dès qu'aucune société de cette org ne le porte** (avant :
>   dès qu'une société le portait **où que ce soit**). Une org B qui recevait
>   des deals sur une fiche déjà ancrée en org A créait jusqu'ici une société
>   neuve à **chaque** événement, faute de pouvoir s'ancrer.
> - Front : la branche d'erreur `attio_company_already_used` de
>   `AttioCompanyField.tsx` et ses clés i18n fr/en tombent avec le code serveur
>   qui les émettait.
> - `convex/regression.deals.test.ts` : les deux tests qui asseyaient le refus
>   (même org, puis cross-org) deviennent leur inverse, plus une assertion que
>   la cible de la synchro ne bouge pas quand un second SPV réclame l'ancrage.

---

## v1.176.1 — 05/08/2026 à 11:28 — Chaque SPV a de nouveau son propre résumé

La fiche de **Parallel Invest SPV24** décrivait, mot pour mot, l'opération du
**SPV11** en Normandie — jusqu'à nommer SPV11 dans le texte. Rien à voir avec
le rattachement du deal, qui était correct : c'est le résumé qui se recopiait
d'un SPV à l'autre. En cause, une règle qui veut que deux fiches partageant le
même site web affichent le même pitch — utile pour les boutiques d'une même
enseigne, absurde pour des SPV, qui portent tous le site de leur plateforme
tout en étant des opérations différentes.

Désormais, un véhicule d'investissement (les SPV Parallel, Sezame et
consorts) est traité pour ce qu'il est : une opération à part. Son résumé
n'est plus déduit du site de la plateforme, plus jamais recopié depuis un SPV
voisin, et le corriger à la main ne touche plus aucune autre fiche. Il vient
des communications investisseur de la plateforme dès que la fiche est
rattachée à son SPV, ou de votre saisie.

Les deux fiches abîmées — **SPV 23 (STOA – Pessac)**, qui affichait la
plaquette commerciale de Parallel, et **SPV24**, qui affichait SPV11 —
retrouvent une description de leur propre opération.

> **🔧 Notes techniques**
>
> - Nouveau prédicat `isVehicleEntity` dans `convex/lib/pitch.ts` : `sponsor`,
>   `vascoIssuerId`, ou jeton « SPVn » dans le nom (les lignes SPV de Calte
>   n'ont pas de `sponsor` — même jeton que `vasco.ts:spvNumberOf`).
> - Exclusion sur les trois chemins d'écriture du pitch :
>   `companyEnrichment.enrich` s'arrête pour un véhicule (plus d'héritage du
>   voisin canonique ni de génération depuis la home du sponsor),
>   `applyPitchToDomainGroup` saute les lignes véhicules, et
>   `companies.update` ne propage plus le `summary` édité si l'entité est un
>   véhicule. `enrichFromVasco` / `applyVascoPitch` restent la source de
>   vérité, inchangés.
> - Cause racine : `getTarget` construisait le groupe de domaine sur
>   `parallel-invest.com` (15 SPV côté Calte) et `pickCanonicalPitch` élisait
>   le résumé le plus long, recopié tel quel sans appel LLM.
> - Rattrapage données : `convex/migrations/fixSpvPitches.ts`
>   (`dryRun`/`apply`), ancré `_id` + garde nom + garde sur le texte erroné,
>   idempotent. Textes reconstruits depuis les notes de l'entité et le deal
>   Attio, jamais depuis le site.
> - Tests : `tests/pitch.test.ts` couvre le prédicat (SPV avec/sans espace,
>   sponsor, lien VASCO, société ordinaire).

---

## v1.176.0 — 05/08/2026 à 11:24 — Le statut « Exit partiel » disparaît

Le dialogue « Gérer la sortie » ne propose plus que **deux** types : sortie
totale ou perte totale. Le troisième, « Exit partiel », est retiré.

Il ne servait presque à rien. Un deal en exit partiel était traité **comme un
deal actif** absolument partout : mêmes multiples, même valeur au tableau de
bord, même place en haut des listes, même suivi des reportings manquants. Sa
seule différence visible tenait à un badge vert quand l'argent déjà récupéré
dépassait le capital investi. En échange, son nom laissait croire qu'il fallait
le poser dès qu'on encaissait quelque chose — un coupon d'obligation, une
royaltie, un remboursement — alors que ces rentrées sont le fonctionnement
normal d'un placement, pas une sortie.

**Une cession partielle se saisit toujours, autrement** : le deal reste
**actif**, puisque vous en détenez encore une partie. L'argent récupéré se lit
là où il a toujours été — dans le reçu et dans le multiple réalisé du deal.
Pensez seulement à mettre à jour la **valorisation** de ce qui reste détenu :
sans ça, la valeur du portefeuille compte à la fois le cash encaissé et la
totalité de la ligne d'origine.

Un seul deal était concerné en base, **VIASANA**, repassé en actif. Sa date et
son produit de cession ont été conservés.

> **🔧 Notes techniques**
>
> - Retrait de `partially_exited` du validateur `dealStatus`
>   (`convex/schema.ts`, `convex/deals.ts:statusValidator`), des schémas
>   d'outils agent (`convex/agentTools.ts`) et MCP (`convex/mcp/registry.ts`).
> - Purge prod **avant** resserrement (règle « purger d'abord ») : VIASANA
>   (`calte`) patché sur le seul champ `status` → `active`, ce qui préserve
>   `exitedDate`/`exitProceeds` là où le geste « Annuler la sortie » les aurait
>   mis à `null`. Tracé dans `MIGRATIONS.md`.
> - Simplifications des tests de statut devenus binaires :
>   `convex/dashboard.ts` (`isActive`), `convex/lib/reportFreshness.ts` (la
>   boucle sur deux statuts devient un seul `withIndex('by_org_status')`),
>   `convex/agentTools.ts` (`activeDeals`).
> - `convex/lib/attioSync.ts` : `DealStatus` resserré et `STATUS_RANK`
>   renuméroté (`pending 0 < active 1 < fully_exited = written_off 2`) — le
>   ratchet forward-only est inchangé.
> - `src/lib/dealStatusBadge.ts` : suppression de la branche « win-only »
>   (v1.126.0) ; `dealBucket` n'a plus de cas particulier. Un seul badge, même
>   palette.
> - `src/components/deals/ExitDealDialog.tsx` : `EXIT_STATUSES` passe à deux
>   entrées. `CompanyDealsTable.tsx` : `STATUS_ORDER` allégé.
> - i18n : 4 clés `status.partially_exited` retirées (`participations` +
>   `chat`, en & fr).
> - `convex/airtableImport.ts` : la valeur Airtable legacy « Exit partiel »
>   mappe désormais sur `active` (mapping explicite, pas le fallback).
> - Docs : `docs/produit/05-deals.md`, `TESTING.md` (SH17, TD5, DL7),
>   `KNOWN_ISSUES.md` (rangs Attio), `MIGRATIONS.md`.

---

## v1.175.1 — 05/08/2026 à 10:55 — Les listes déroulantes des fiches s'enregistrent enfin

Sur une fiche deal, choisir « Trimestriel » dans **Périodicité du coupon**
ne servait à rien : la ligne se refermait, le champ restait sur « — », et
rien n'indiquait que le choix venait d'être perdu. Même chose partout
ailleurs pour un champ à choix multiple édité au clic — **Type de fonds**
(« Private equity »…) sur un deal de fonds, mais aussi Remboursement,
Durée, Tour, Type de SAFE et Type de bien.

Le problème ne touchait **que** ces champs à liste déroulante. Les montants,
pourcentages, dates et textes s'enregistraient normalement, ce qui rendait
la panne d'autant plus déroutante : sur la même colonne de droite, un
champ sur deux répondait.

C'est corrigé : un choix dans une liste déroulante s'écrit immédiatement,
avec le même retour que les autres champs (« Modifications enregistrées »),
et la valeur est toujours là après rechargement de la page. Le correctif
est fait dans le composant d'édition partagé, donc il vaut pour **tous**
les champs à choix d'Albo OS, présents et à venir.

> **🔧 Notes techniques**
>
> - Cause : dans `src/components/ui/inline-field.tsx`, l'éditeur des champs
>   `format: 'enum'` rendait un `<Select open defaultValue=…>` (Radix) —
>   donc une valeur **non contrôlée**. Depuis
>   `@radix-ui/react-use-controllable-state` ≥ 1.2, `onValueChange` n'est
>   appelé **synchronement** que si la valeur est **contrôlée** ; en non
>   contrôlé, l'appel est différé dans un `useEffect`.
> - Radix appelle `onValueChange` puis `onOpenChange(false)` ; notre
>   `onOpenChange` fait `setEditing(false)`, ce qui **démonte le `Select`
>   dans le même commit React**. L'effet différé n'a jamais lieu → `onCommit`
>   jamais appelé → aucun `deals.update`, sans erreur ni toast.
> - Correctif : `value={typeof rawValue === 'string' ? rawValue : ''}` à la
>   place de `defaultValue` (Radix traite `''` comme « pas de valeur » et
>   affiche le placeholder). Un seul prop, dans le composant partagé, donc
>   valable pour tous les enums (`ENUM_FIELD_VALUES`).
> - **Audit de tous les sélecteurs de l'app** (le bug ne devait pas dormir
>   ailleurs) : sur les 34 `<Select>` de `src/`, 33 étaient déjà contrôlés ;
>   toutes les `Checkbox` aussi ; les deux `Tabs` non contrôlés (`me.tsx`,
>   `cash.index.tsx`) ne déclenchent aucune écriture ; les combobox
>   (`SectorCombobox`, `CompanyCombobox`, `DealCombobox`) appellent leur
>   `onChange` elles-mêmes, donc synchronement. Seul autre non contrôlé : le
>   sélecteur de compte bancaire de la fiche placement (`placements.$dealId.tsx`,
>   bloc « Enveloppe ») — il **marchait** (son démontage attend l'aller-retour
>   de la mutation), passé en `value=""` par prudence.
> - Non concernés, vérifiés : les `Select` de `DealFieldInput` (dialog
>   d'édition, restent montés) et `SectorCombobox` (appelle `onChange`
>   lui-même, synchrone).
> - Règle ajoutée dans `KNOWN_ISSUES.md` § « Édition inline des fiches » :
>   tout contrôle Radix dont la sélection le démonte doit être **contrôlé**.
>   `TESTING.md` FD38 durci (le choix enum doit survivre au rechargement).

---

## v1.175.0 — 04/08/2026 à 19:21 — Créer une société ou un deal depuis Claude, sans ouvrir l'app

Le connecteur Claude savait lire le portefeuille, rien de plus. Pour entrer
une nouvelle boîte ou une nouvelle participation, il fallait revenir dans
l'app — soit remplir le formulaire à la main, soit passer par l'assistant du
panneau latéral. Deux allers-retours pour une information qu'on venait déjà
de dicter.

Le connecteur sait maintenant **écrire**. Vous donnez l'info en vrac, en une
phrase, et c'est Claude qui range dans les bonnes cases.

- **Quatre gestes possibles** : créer une société du portefeuille, créer un
  deal, compléter une société existante, compléter un deal existant. Le reste
  du connecteur ne change pas.
- **Vous validez avant, toujours** : le connecteur annonce désormais quels
  outils modifient les données, et Claude demande votre accord avant chaque
  écriture. Rien ne part sans un clic de votre part.
- **Un lien pour vérifier** : chaque création renvoie l'adresse de la fiche
  dans l'app. Un clic et vous êtes dessus pour relire ou corriger.
- **Il prévient au lieu de bloquer** : si une société ressemble à une fiche
  déjà en base — même site, même nom à la forme juridique près — la fiche est
  quand même créée, mais Claude vous signale les doublons possibles avec leurs
  liens. Même chose pour un deal entre le même investisseur et la même cible :
  c'est parfois un vrai second tour, à vous de juger. Seule exception, le
  SIREN : un numéro déjà utilisé par une autre société est refusé net.
- **Une limite assumée** : les paramètres de contrat de royalties (plan
  d'affaires trimestriel, plancher et plafond de multiple) restent modifiables
  uniquement dans l'app, sur leur écran dédié.

> **🔧 Notes techniques**
>
> - Registre MCP (`convex/mcp/registry.ts`) : quatre outils d'écriture
>   `createCompany` / `updateCompany` / `createDeal` / `updateDeal`, montants
>   en cents, taux en bps, dates en ISO `YYYY-MM-DD` converties par
>   `optionalISODate`. Schéma financier factorisé dans `dealValueSchema` +
>   `dealValueArgs`. Les énums viennent des sources de vérité existantes
>   (`lib/sectors.ts`, `lib/instruments.ts`), jamais redéclarées.
> - `defineTool` prend un flag `write` et calcule `annotations`
>   (`readOnlyHint`), émises dans `tools/list` (`convex/mcp/server.ts`) : c'est
>   le signal MCP standard qui fait demander confirmation au client, puisque le
>   `needsApproval` du chat in-app n'a pas d'équivalent hors app.
> - Pas de mutation dupliquée : les internes existants de `convex/agentTools.ts`
>   (`createCompanyInternal`, `createDealInternal`, `update*Internal`) sont
>   élargis en champs **optionnels**. Les schémas zod des outils du chat sont
>   inchangés — ils n'envoient simplement jamais les nouveaux champs. Effet de
>   bord additif assumé : ces internes renvoient maintenant aussi `similar`,
>   que l'agent in-app voit également.
> - Détection de quasi-doublons dans `convex/lib/duplicates.ts`
>   (`normalizeCompanyName` : accents, ponctuation et suffixe juridique repliés ;
>   `findSimilarCompanies` sur domaine/nom, `findSimilarDeals` sur
>   investisseur+cible). Jamais bloquant, sauf `assertSirenFree` — invariant
>   déjà en place, exporté depuis `convex/companies.ts` pour éviter une seconde
>   implémentation. Tests purs dans `tests/duplicates.test.ts`.
> - Liens profonds construits depuis `SITE_URL`, avec routage
>   `placements/` vs `deals/` via `isTreasuryPlacement`.

---

## v1.174.1 — 04/08/2026 à 19:09 — L'alerte « boîte silencieuse » écoute enfin les SPV

L'alerte lancée ce matin criait au silence sur des sociétés qui parlaient
pourtant très récemment : tous les SPV Parallel de CALTE portaient une
pastille ambre alors que leurs communications dataient de quelques
semaines.

La cause tient en une phrase : l'alerte ne lisait que les rapports reçus
**par email**. Or un SPV n'envoie jamais de mail — il **publie** sur le
portail de son émetteur, et ces communications s'affichent déjà dans la
fiche société. L'alerte regardait la seule boîte aux lettres, là où ces
sociétés-là ne passent jamais.

Désormais les deux canaux comptent à égalité : un rapport reçu par email
et une communication publiée sur le portail remettent le compteur à zéro
de la même façon. Le survol de la pastille précise **par quel canal** la
dernière nouvelle est arrivée — « Dernier report reçu il y a 5 mois » ou
« Dernière communication il y a 5 mois » — pour savoir où aller chercher.

Un point à connaître : une entité ne bénéficie de ce rattrapage que si
elle est **reliée à son émetteur** dans ses Intégrations. Un SPV non relié
reste vu comme muet, puisque rien ne permet de savoir où il publie.

> **🔧 Notes techniques**
>
> - `convex/lib/reportFreshness.ts` : `listSilentCompanies` lit une seconde
>   source, `vascoCommunicationsCache`, en plus de `companyReports`. La map
>   `${vascoClientSlug}:${vascoIssuerId}` → `companyId` est construite depuis
>   les `companies` déjà chargées ; le cache n'est lu que si au moins une
>   entité porte un lien (pas d'abonnement Convex inutile sur une org sans
>   connexion portail).
> - `publishDate` est une chaîne ISO du portail : une date absente ou
>   illisible est **écartée** plutôt que repliée sur `fetchedAt`, qui vaut
>   toujours « aujourd'hui » et éteindrait l'alerte pour de mauvaises
>   raisons.
> - `SilentCompany.lastReportAt` devient `lastNewsAt`, plus `lastNewsSource`
>   (`'report' | 'vasco'`) : le tooltip doit nommer le canal, sinon il envoie
>   chercher un email qui n'existe pas. Les trois consommateurs suivent
>   (`ParticipationsTable`, `todo.tsx`, outil agent `listSilentCompanies`).
> - `convex/regression.reportFreshness.test.ts` : 4 tests de plus (10 au
>   total) — communication récente vs vieille, entité non reliée qui ne lit
>   rien du cache de l'org, communication sans date, et canal de la dernière
>   nouvelle.
> - Limite assumée : si la connexion au portail casse, les communications
>   cessent d'être rafraîchies et l'alerte finit par se déclencher à tort.
>   Non traité ici.

---

## v1.174.0 — 04/08/2026 à 16:54 — Les boîtes qui ne donnent plus de nouvelles se signalent toutes seules

Une participation qui cesse de reporter ne fait pas de bruit : c'est
justement le problème. Il fallait ouvrir l'onglet **À faire** pour s'en
apercevoir, et le délai y était figé à trois mois pour tout le monde.

- **Une pastille d'alerte dans la liste des participations**, à côté du nom
  de la société. Au survol : depuis quand le dernier rapport est arrivé, et
  **jusqu'à quelle période il couvrait** — un rapport reçu en mars peut ne
  couvrir que janvier, et les deux dates ne disent pas la même chose.
- **Le délai se règle par organisation** (Réglages → Général), à **4 mois**
  par défaut. Le changer déplace le signal partout à la fois : la liste des
  participations, l'onglet À faire et l'assistant disent toujours la même
  chose.
- **Les boîtes qui n'ont jamais reporté comptent aussi**, mais à partir du
  **versement des fonds** : des fonds virés il y a deux semaines ne doivent
  encore rien. Jusqu'ici elles étaient simplement invisibles.
- **L'assistant sait répondre** à « quelles boîtes ne nous ont pas reporté
  depuis longtemps ? », dans le chat comme sur Telegram.

Le délai est toujours mesuré sur la **date de réception** d'un rapport, pas
sur la période qu'il couvre : sinon une société qui reporte au trimestre
paraîtrait en retard le lendemain de son envoi. Les term sheets en cours et
les positions entièrement sorties ne sont jamais signalés.

> **🔧 Notes techniques**
>
> - Détection centralisée dans `convex/lib/reportFreshness.ts`
>   (`listSilentCompanies`) : un seul scan indexé `by_org` des
>   `companyReports` pour le dernier `emailDate` et le dernier
>   `periodSortDate` par société ; les transactions ne sont lues que pour les
>   sociétés sans aucun rapport (`firstOutflowAt` sur l'index `by_deal`,
>   repli sur `signedDate`). Scope : `companies.kind = 'portfolio'` non
>   archivées, cibles d'un deal `active` / `partially_exited`.
> - Seuil porté par `organizations.reportSilenceMonths` (optionnel, défaut
>   `DEFAULT_SILENCE_MONTHS = 4`, bornes 1-24 validées dans
>   `organizations.updateGeneral` et dans le schéma Zod du formulaire).
> - Un producteur, trois consommateurs : `deals.listParticipations` et
>   `aggregate.listParticipations` taguent leurs lignes via
>   `withReportAlerts` (jamais sur les buckets `pending` / `settled`),
>   `todo.getTodo` remplace sa boucle à N requêtes par le helper, et
>   `companyReports.silentInternal` sert l'outil agent `listSilentCompanies`
>   (lecture seule, `readMembership` sur la scope key du thread).
> - Front : `SilenceBadge` local à `ParticipationsTable.tsx` (tooltip shadcn,
>   le `TooltipProvider` vient du `SidebarProvider` du layout), champ
>   « Alerte reporting » dans `settings/general.tsx`, i18n sous
>   `participations:silence.*`, `todo:reports.*` et
>   `settings:general.reportSilence*`.
> - Invariants pinnés dans `convex/regression.reportFreshness.test.ts`
>   (réception vs période couverte, décaissement pointé prioritaire sur la
>   signature, seuil par org, exclusion des sorties et des archivées).

---

## v1.173.0 — 04/08/2026 à 16:48 — Un deal en term sheet passe en actif dès que l'argent part

Jusqu'ici, un deal créé en **term sheet** y restait bloqué. On pouvait pointer
le virement, voir le décaissé apparaître sur sa fiche — le deal continuait
d'être compté parmi les engagements à venir, et rien dans l'application ne
permettait de le passer en actif : il fallait repasser par Attio.

C'est réglé : **pointer une sortie sur un deal en term sheet le fait passer en
actif**. L'argent est parti, la position existe, elle sort de la liste des
term sheets — dans la fiche, dans la liste des deals et dans les
participations, sans rien avoir à faire de plus.

Un seul versement suffit : inutile d'attendre que l'engagement soit couvert,
un fonds étant bel et bien actif dès son premier appel de capital.

Deux précisions :

- la bascule ne va que dans ce sens — détacher la transaction ensuite ne
  ramène pas le deal en term sheet, et un deal déjà sorti n'est jamais
  ramené en actif ;
- seules les **sorties** déclenchent le passage : pointer un retour ou une
  distribution laisse le deal en term sheet.

Passer le deal au stage « Invested » dans Attio continue bien sûr de
fonctionner : les deux chemins mènent au même statut. En revanche les deals
pointés **avant** cette mise à jour ne sont pas rattrapés — détacher puis
repointer leur virement les fait basculer.

> **🔧 Notes techniques**
>
> - La règle vit dans `applyMatchToDeal` (`convex/lib/pointage.ts`), le cœur
>   partagé du pointage : elle couvre donc d'un coup la mutation manuelle
>   `transactions.matchTransaction` et l'outil de pointage de l'agent
>   (`agentToolsPointage.ts`), sans les toucher.
> - Condition volontairement minimale : `deal.status === 'pending'` **et**
>   `tx.direction === 'out'` → `patch('deals', dealId, { status: 'active' })`.
>   Pas de seuil « décaissé ≥ engagé », qui laisserait un `fund_lp` appelé à
>   30 % en term sheet.
> - Forward-only, aligné sur `advancesStatus` du chemin Attio « Invested »
>   (`convex/attioSync.ts`) : les autres statuts sont intouchés et
>   `applyUnmatch` ne rétrograde pas (un deal `active` sans transaction est un
>   cas légitime — import Airtable, webhook Attio).
> - Couverture : 4 tests dans `convex/regression.pointage.test.ts` (sortie
>   partielle → `active`, dépointage non rétrogradant, entrée sans effet,
>   deal `fully_exited` inchangé). Rien d'autre n'a bougé : ni schéma, ni UI,
>   ni migration.

---

## v1.172.0 — 03/08/2026 à 18:10 — Les rapports et les documents d'une société vivent enfin au même endroit

Une fiche société avait deux onglets, et il fallait choisir le bon **avant**
de savoir ce qu'on tenait. Un reporting déposé dans « Documents » restait un
PDF muet : pas de période, pas de KPIs, pas de synthèse relancée — rien qui
dise que c'était un rapport. Et un pacte, lui, n'existait que sur la fiche du
deal, alors qu'il engage la société entière.

Les deux onglets n'en font plus qu'un : **« Documents & rapports »**, une
seule liste chronologique, du plus récent au plus ancien.

- **Tout y est** : les rapports investisseurs analysés, les communications
  Parallel/VASCO, et les documents déposés — **y compris ceux rattachés à un
  deal**, qui portent le badge du deal concerné et renvoient vers sa fiche. Un
  seul fichier stocké, deux endroits pour le retrouver.
- **La date classe la ligne** : la période couverte quand elle existe (un
  reporting de janvier se range en janvier, même déposé en mars), la date de
  dépôt sinon — et la ligne dit toujours laquelle des deux elle affiche.
- **Un seul bouton « Ajouter »**, et c'est le type choisi qui décide : un
  **Reporting** part dans le circuit d'analyse (le bouton devient « Analyser
  et ajouter » et l'encart le dit avant le clic), le reste est un simple
  dépôt. On peut aussi rattacher le document à un deal au passage.
- **Le filtre** retrouve un pacte au milieu de quarante rapports : il ne
  propose que ce qui existe sur la fiche, groupé en communications
  (rapports, VASCO) et documents.
- **Les communications VASCO** ne s'affichent plus dépliées en entier les unes
  sous les autres : chacune devient une bulle, comme un rapport, qu'un clic
  ouvre sur le message complet et ses pièces jointes. Le bouton « Rafraîchir
  VASCO » est en haut de la liste ; le rattachement à un émetteur se gère au
  seul endroit qui le faisait déjà, le menu ⋯ → Intégrations.
- **Fin d'un doublon** : les pièces jointes d'un rapport étaient listées deux
  fois (sous le rapport et dans l'onglet Documents). Elles ne vivent plus que
  sous leur rapport.

L'assistant IA suit la même règle : quand on lui demande les documents d'une
société, il remonte désormais aussi ceux rattachés à ses deals.

> **🔧 Notes techniques**
>
> - Fusion de `CompanyReportsSection` + `ReportingsSection` (supprimés) dans
>   `src/components/companies/CompanyTimelineSection.tsx` : une liste d'entrées
>   typées (`report` / `vasco` / `doc`) triée sur un `sortDate` unique
>   (`periodSortDate ?? processedAt ?? emailDate` pour un report,
>   `publishDate` parsé pour VASCO, `period ?? uploadedAt` pour un document).
>   Les documents portant un `reportId` sont exclus des entrées et repliés dans
>   la bulle de leur report. Les onglets (`ui/tabs`) disparaissent de
>   `participations.$companyId.tsx`.
> - `documents:listByCompany` ne filtre plus `dealId === undefined` et renvoie
>   le `deal` (id, nom, instrument) de chaque ligne, résolu par un `db.get` par
>   deal **distinct**. `listByDeal` et la fiche deal sont inchangés — le
>   `dealId` est une étiquette, pas une seconde copie.
>   `agentTools:listCompanyDocumentsInternal` suit la même règle et expose
>   `dealId` (description de l'outil mise à jour).
> - Une seule fenêtre d'ajout : `kind === 'reporting'` (et
>   `company.kind === 'portfolio'`) route vers `reportInbox.createFromUpload`
>   (pipeline complet, pas de titre/période demandés), sinon `documents.create`
>   avec `dealId` facultatif. L'input de date est un `month` pour les types
>   société, un `date` pour les types deal.
> - `VascoCommunicationsSection.tsx` renommé `VascoCommunications.tsx` : la
>   liste dépliée est remplacée par un hook `useVascoCommunications` (cache
>   réactif + bootstrap au 1er affichage) et un `VascoCommunicationDialog` ; le
>   rendu des bulles vit dans la timeline. `VascoLinkDialog` inchangé.
> - `DocumentAttachment` prend un `extraBadge` optionnel (le badge deal) ; i18n
>   regroupée sous `participations:timeline.*` (les blocs `tabs` et
>   `reportings` sont supprimés, `dealDocuments` reste à la fiche deal).

---

## v1.171.1 — 03/08/2026 à 17:36 — Toute la pastille ouvre la fiche Attio, pas seulement la flèche

Sur une fiche société, les pastilles de personnes rattachées à Attio ne
s'ouvraient que par leur petite flèche ↗ — une cible de quelques pixels qu'il
fallait viser. Maintenant que la pastille ne sert plus à rien d'autre (le nom
ne s'édite plus au clic), **elle est cliquable en entier** : un clic n'importe
où dessus ouvre la fiche du CRM, et son fond réagit au survol pour le dire.

Une pastille non rattachée à Attio reste inerte, comme avant. La croix, elle,
n'a pas bougé : elle est en dehors du lien, la survoler ne colore pas la
pastille, et la cliquer retire l'entrée sans ouvrir quoi que ce soit.

> **🔧 Notes techniques**
>
> - `src/components/companies/PeopleEditor.tsx` : `PersonChip` enveloppe
>   initiales + nom + flèche dans le `<a>` quand `url` existe, au lieu de
>   n'y mettre que l'icône. Le `<button>` de retrait reste **hors** de
>   l'ancre — un bouton ne peut pas s'imbriquer dans un lien, et le retrait
>   ne doit pas être à un clic de travers du CRM.
> - Retour visuel via `has-[a:hover]:bg-accent` sur le conteneur (même
>   variante `:has()` que `src/components/ui/attachment.tsx`), donc le survol
>   de la croix ne colore pas la pastille.
> - L'`aria-label` « Ouvrir dans Attio » qui portait l'ancienne ancre laissait
>   place à un lien sans nom lisible ; il devient un `title`, le nom de la
>   personne redevenant le libellé accessible du lien, et la flèche passe en
>   `aria-hidden`.

## v1.171.0 — 03/08/2026 à 16:46 — Les co-investisseurs se cherchent aussi dans les sociétés d'Attio

Dans le bloc Identité d'une fiche société, les pastilles de personnes
(fondateurs, board, co-investisseurs) posaient une question à chaque clic :
est-ce que ça ouvre la fiche Attio, ou est-ce que ça modifie le nom ? Les deux
gestes vivaient au même endroit, sans rien pour les distinguer.

La pastille **n'est plus cliquable**. Seules deux choses réagissent, et elles
sont explicites : la flèche ↗, qui ouvre la fiche dans Attio, et la croix, qui
retire l'entrée. Corriger un nom se fait désormais en retirant la pastille et
en en ajoutant une nouvelle — c'est aussi la seule façon de la rattacher à une
autre fiche du CRM, ce qui évite les liens qui ne décrivent plus la bonne
personne.

La recherche Attio de ce champ, elle, ne regardait que les **personnes**. Un
co-investisseur étant le plus souvent un fonds, il fallait taper son nom à la
main et renoncer au lien vers le CRM. Elle interroge maintenant **personnes et
sociétés** en même temps, et chaque suggestion porte une petite icône pour
qu'on ne les confonde pas : une silhouette pour une personne, un immeuble pour
une société. La flèche de la pastille mène ensuite à la bonne fiche — celle
d'un contact ou celle d'un fonds, selon le cas.

Si l'un des deux annuaires ne répond pas, l'autre continue de proposer ses
résultats ; la recherche n'est déclarée indisponible que lorsque les deux sont
muets, et la saisie libre reste toujours possible.

> **🔧 Notes techniques**
>
> - `src/components/companies/PeopleEditor.tsx` : `PersonChip` perd son état
>   `editing` et le bouton de renommage inline — le nom redevient du texte, la
>   pastille n'expose plus que le lien Attio et le retrait. `PersonInput`
>   n'est donc plus utilisé que par `AddPerson` : ses props `initial` et le
>   `skipRef` associé (qui évitaient de relancer une recherche sur le nom
>   d'origine) tombent avec lui.
> - `PersonInput` appelle désormais `api.attio.searchPeople` **et**
>   `api.attio.searchCompanies` en parallèle (`Promise.all`) et fusionne les
>   deux listes ; l'erreur n'est affichée que si les deux actions remontent un
>   `error`. Aucun changement côté Convex : `searchCompanies` existait déjà
>   pour la ligne « Fiche Attio ».
> - `convex/lib/people.ts` : `personValidator` gagne un
>   `attioRecordType: 'person' | 'company'` optionnel (+ `ATTIO_RECORD_TYPES`
>   / `attioRecordTypeValidator`). Absent = personne, donc les entrées
>   existantes restent valides sans migration. `PersonChip` s'en sert pour
>   choisir entre `attioPersonUrl` et `attioCompanyUrl` — sans ça, un fonds
>   pointerait vers une URL `/person/…` inexistante.
> - La ligne « Fiche Attio » du bloc Identité (`AttioCompanyField`) reste
>   **volontairement** en recherche sociétés seule : c'est l'ancre sur
>   laquelle la synchro des deals se résout.
> - i18n : `edit.personSearchNoResults` remplacé par
>   `edit.attioSearchNoResults` (la liste n'est plus mono-objet), ajout de
>   `edit.attioTypePerson` / `edit.attioTypeCompany` pour les icônes, et
>   `edit.peopleNamePlaceholder` passe à « Nom ou société ».

## v1.170.1 — 03/08/2026 à 15:28 — Un fichier Excel est enfin lu en entier, tous ses onglets compris

Jusqu'ici, un classeur Excel un peu fourni ne livrait qu'une partie de son
contenu : le premier onglet était lu, et **tout ce qui suivait disparaissait
en silence**. Un reporting avec un onglet P&L dense suivi d'onglets KPIs et
Trésorerie ne rendait que le P&L — le reste n'existait tout simplement pas,
ni dans le texte extrait, ni pour l'assistant, ni pour l'extraction
automatique des métriques.

La cause : une limite de taille appliquée à l'ensemble du classeur **après**
sa lecture. Le premier onglet la consommait entièrement, et la coupe tombait
avant que les autres soient écrits.

Désormais, la place disponible est **partagée entre les onglets** : chacun
apparaît toujours, avec son nom et son nombre de lignes réel, et les onglets
qui ont besoin de peu laissent la place à ceux qui ont besoin de beaucoup. Un
classeur qui dépasse malgré tout la taille maximale voit la coupe tomber sur
l'onglet volumineux, jamais sur les petits, et le texte le dit noir sur blanc
(« … lignes tronquées ») plutôt que de faire disparaître les données sans
prévenir. Même chose pour les CSV, qui n'étaient lus que sur leurs 300
premières lignes.

Au passage, les reportings reçus par email peuvent porter **deux fois plus de
contenu** avant d'être résumés, ce qui laisse à l'analyse automatique de quoi
travailler sur les gros classeurs.

> **🔧 Notes techniques**
>
> - `convex/lib/excel.ts` : suppression du cap plat `MAX_CHARS = 40_000` et du
>   cap dur `MAX_ROWS_PER_SHEET = 300`, appliqués après concaténation des
>   onglets — c'est ce qui faisait disparaître les onglets suivants. Le budget
>   est désormais celui du document (`MAX_DOCUMENT_CHARS`, 900k) et il est
>   réparti en max-min fair entre onglets (`fairShares`) : les onglets sous
>   leur quote-part libèrent le reliquat pour les gros.
> - En-têtes et marqueurs de coupe sont payés d'avance sur le budget, donc un
>   onglet non vide est **toujours** présent dans la sortie, avec son nombre de
>   lignes réel — un classeur ne peut plus paraître avoir moins d'onglets
>   qu'il n'en a. Toute coupe est explicite (`[...N lignes tronquées]`).
> - `csvToText` passe sur le même mécanisme (il partageait les constantes
>   supprimées) : plus de coupe à 300 lignes.
> - `convex/reportExtract.ts` : `MAX_EXTRACTED_CHARS` 150k → 300k. Ce qui
>   borne ici, c'est la fenêtre de contexte du modèle (`callModel` dans
>   `reportStore.ts` reçoit ce texte entier), pas Convex — 300k ≈ 80k tokens,
>   confortable sous une fenêtre de 128k, alors que la ligne `companyReports`
>   reste à ~420 Ko de la limite d'1 Mo.
> - `tests/excel.test.ts` : test de régression ALB-114 (classeur 3 onglets à
>   premier onglet dense → les 3 rendus), vérifié rouge sur l'ancien code.

---

## v1.170.0 — 03/08/2026 à 12:48 — Le point du lundi compte les reports de la semaine

Le mail du lundi matin gagne une ligne par organisation : **le nombre de
reports rangés dans la semaine écoulée**. De quoi voir d'un coup d'œil que le
circuit tourne, sans recevoir un mail à chaque report qui arrive.

Comme les autres blocs, il se coupe depuis **Réglages → Membres**, case
« Reports de la semaine ». Et comme les autres, il suffit à lui seul à
déclencher le mail : une semaine sans alerte de trésorerie ni échéance en
retard mais avec trois reports rangés vous enverra quand même le point hebdo.
Qui coupe les trois cases ne reçoit toujours rien.

Une précision de lecture : une société détenue par Calte **et** Albo range son
report dans chacune. Un seul mail transféré compte donc 1 dans les deux
sections. Chaque ligne est juste dans son organisation, mais les deux ne
s'additionnent pas.

> **🔧 Notes techniques**
>
> - Sixième drapeau `notifyWeeklyReports` sur `userPrefs` (opt-out, comme les
>   cinq autres) + sixième colonne dans la matrice. **Tout nouveau bloc du
>   digest doit avoir le sien** : sans ça il ré-arme le mail du lundi chez
>   quelqu'un qui avait tout coupé — c'est la règle que `sectionsFor` fait
>   respecter, tests à l'appui.
> - Comptage dans `sendWeeklyDigest` : lecture de `companyReports` par l'index
>   `by_org` en `order('desc')`, arrêt dès qu'une ligne sort de la fenêtre —
>   seules les lignes de la semaine sont touchées. `DIGEST_WINDOW_MS` vaut une
>   période de cron ; déplacer le cron sans le suivre créerait un trou ou un
>   recouvrement.
> - Le compteur reflète ce qui est **en base**, pas ce qui a été envoyé : un
>   mail en quarantaine ou en échec n'y figure pas tant qu'il n'a pas été
>   repris depuis la file.

---

## v1.169.0 — 03/08/2026 à 11:51 — Transférer un report sans jamais recevoir d'erreur

Depuis la mise à jour précédente, on peut confier à quelqu'un le seul rôle de
transférer les investor updates à l'adresse dédiée, sans lui envoyer les
problèmes du circuit. Il restait un défaut : quand le report se rangeait bien
cette personne recevait un récapitulatif, et quand ça coinçait elle ne recevait
**rien**. Un accusé de réception qui n'arrive qu'une fois sur deux inquiète
plus qu'il ne rassure.

Désormais, **toute personne qui transfère reçoit une réponse dans son fil**, à
chaque fois. Ce qu'elle contient dépend de son rôle :

- **Elle ne gère pas la file** (case « Problèmes de reports » décochée) → elle
  reçoit « **Report bien reçu** », exactement le même message que le report se
  soit rangé ou non. Aucun verdict, aucun lien, rien à faire.
- **Elle gère la file** → elle reçoit le vrai contenu : le récapitulatif
  détaillé quand c'est rangé, et le message actionnable — la cause et le lien
  vers la boîte Rapports entrants — quand ça coince.

Les autres personnes qui gèrent la file sont prévenues **uniquement en cas de
problème**, par un email séparé. Un report qui se range correctement ne
déclenche aucune notification pour qui ne l'a pas transféré : pas de bruit pour
une chaîne qui marche.

Un trou est bouché au passage : un mail d'un membre classé en spam partait en
quarantaine sans que son expéditeur en sache rien. Il reçoit maintenant la même
réponse que dans tous les autres cas.

> **🔧 Notes techniques**
>
> - **Décision isolée** dans `convex/lib/reportRouting.ts:routeRecap`, épinglée
>   par `tests/reportRouting.test.ts` (6 cas : succès/échec/quarantaine ×
>   transféreur abonné, non abonné, non membre). Deux axes indépendants — le
>   **canal** suit le geste (réponse en fil pour le transféreur membre, mail
>   neuf sinon), le **contenu** suit le rôle (abonné `reportIssues` →
>   actionnable, sinon accusé neutre).
> - **`emailTemplates.ts:reportReceiptHtml()` ne prend aucun argument**, à
>   dessein : lui en passer un (cause, société, un simple ✅/⚠️) suffirait à
>   révéler l'issue et casserait la garantie. Le texte ne promet rien sur un
>   humain — ce serait faux si plus personne n'est abonné.
> - `reportNotify.send` lit `listRecipients` **avant** de router : la liste
>   sert à la fois de destinataires et de test « l'expéditeur gère-t-il la
>   file ? », et le transféreur en est retiré pour ne pas être notifié deux
>   fois. Une seule prise de `notifiedAt` couvre les deux envois.
> - Un `success` ne déclenche plus aucun envoi vers un tiers
>   (`alertOthers: false`).

---

## v1.168.0 — 03/08/2026 à 11:37 — Déposer plusieurs documents en une fois

Ajouter des documents se faisait un par un : choisir le fichier, remplir le
titre, le type, la date, enregistrer — puis tout recommencer pour le
suivant. Avec les cinq pièces d'une assemblée générale ou le lot de
documents d'un closing, la corvée était réelle.

La fenêtre de sélection accepte désormais **plusieurs fichiers d'un coup**,
sur l'onglet Documents d'une société comme sur le bloc Documents d'une fiche
deal. La modale liste alors **un titre par fichier**, pré-rempli par le nom
du fichier et modifiable ligne par ligne, pendant que le **type** et la
**période** (ou la date, côté deal) se choisissent **une seule fois** et
s'appliquent à tout le lot — c'est presque toujours ce qu'on veut quand on
dépose des pièces qui vont ensemble. Un seul fichier sélectionné : l'écran
est exactement celui d'avant.

Deux garde-fous inchangés : la limite de **20 Mo par fichier** reste, et si
un fichier trop lourd se glisse dans la sélection, le lot entier est refusé
avant tout envoi plutôt que d'en perdre un en silence. Chaque document part
ensuite en lecture automatique comme aujourd'hui.

> **🔧 Notes techniques**
>
> - `ReportingsSection.tsx` et `DealDocumentsSection.tsx` : l'état
>   `pendingFile: File | null` devient `pendingFiles: Array<File>` avec un
>   tableau `titles` parallèle, qui porte aussi le titre unique en mode
>   édition — un seul chemin de code pour les deux cas. `<input multiple>`,
>   et `handlePick` reçoit désormais le tableau complet.
> - `handleSave` boucle en série sur les fichiers (upload
>   `files:generateUploadUrl` puis `documents:create` par fichier). Un échec
>   interrompt le lot : les documents déjà créés restent, la liste étant
>   réactive. Aucun changement backend — `documents:create` prend toujours
>   un `storageId` à la fois.
> - Même idiome que `AddReportDialog` (`CompanyReportsSection.tsx`), y
>   compris le rejet du lot entier si un fichier dépasse `MAX_BYTES`.
> - Les deux `DialogContent` passent en `max-h-[85vh] overflow-y-auto`
>   (règle CLAUDE.md sur les modales à contenu extensible).
> - i18n : `dialogTitle`, `added` et `titleLabel` passent au pluriel
>   (`_one` / `_other`) dans les namespaces `reportings.*` et
>   `dealDocuments.*`, EN et FR.

---

## v1.167.0 — 03/08/2026 à 10:42 — Vous choisissez qui reçoit quels emails, et les alertes du matin deviennent un point hebdo

Jusqu'ici, les emails de l'application partaient à tout le monde, sans
réglage possible : une alerte de trésorerie le matin, un digest d'échéances
en retard un autre matin, et deux notifications séparées quand une connexion
bancaire tombait ou qu'un document ne s'indexait pas.

**Deux changements.** D'abord, les alertes de trésorerie et les échéances en
retard ne partent plus au fil de l'eau : elles se retrouvent dans un **seul
email, le lundi matin**, avec une section par organisation. Vous voyez d'un
coup ce qui cloche partout, au lieu de recevoir des mails isolés en semaine.
S'il n'y a rien à signaler, il n'y a pas d'email.

Ensuite, **Réglages → Membres** accueille un tableau « Alertes par email »
qui croise les personnes et les cinq alertes que l'application envoie : seuil
de trésorerie, échéances en retard, connexion bancaire, échec d'indexation,
problèmes de reports. Chacun coche ce qu'il veut recevoir ; un admin règle la
ligne de tout le monde. Tout est activé par défaut, y compris pour un nouveau
membre — c'est un désabonnement, pas un abonnement. Attention, ces réglages
suivent la **personne** et pas l'organisation : les décocher ici les décoche
partout.

**Un cas concret que ça débloque** : confier à quelqu'un le seul rôle de
transférer les reports reçus à l'adresse dédiée. Il continue de recevoir
l'accusé de réception de chaque report qu'il transfère — ça, ça ne se coupe
pas, c'est la réponse à son geste — mais les erreurs du circuit (report non
traité, email en quarantaine) ne lui reviennent plus dans son fil : elles
partent à ceux qui gèrent la file. Il suffit de décocher « Problèmes de
reports » sur sa ligne.

> **🔧 Notes techniques**
>
> - **Modèle.** Cinq drapeaux `notify*` optionnels sur `userPrefs`, stockés
>   en **opt-out** (absent = abonné) : aucune migration, et un nouveau membre
>   est abonné d'office. Volontairement hors de la ligne `users`, que
>   `requireAppUser` lit dans chaque query. `convex/lib/notificationPrefs.ts`
>   expose `wantsAlert` / `readAlertPrefs` / `setAlertPref` — tout nouvel
>   envoi récurrent doit passer par là.
> - **Digest.** `forecasts.checkCashAlerts` et `checkOverdueEntries`
>   fusionnent en `forecasts.sendWeeklyDigest` (cron `weekly` lundi 07:00
>   UTC). Deux passes : les constats par org, puis un mail par membre filtré
>   via `sectionsFor` (`convex/lib/weeklyDigest.ts`, cœur pur épinglé par
>   `tests/weeklyDigest.test.ts`). Le **cooldown 7 j** et la fenêtre
>   « nouvellement en retard » de 24 h sont **retirés** — la cadence hebdo
>   fait l'anti-spam, chaque run est une photo. `lastNotifiedAt` reste écrit
>   comme trace, sans rôle de barrière. `cashAlertEmail` + `overdueEntriesEmail`
>   → `weeklyDigestEmail` (sections optionnelles, fr/en).
> - **Alertes immédiates.** `powens:maybeNotifyConnectionHealth` et
>   `vectorize:notifyIndexFailure` sautent les membres désabonnés ;
>   `notifiedHealth` continue d'être marqué même si personne n'a reçu le mail
>   (état d'incident, pas compteur d'envois).
> - **Reports.** `reportNotify.send` ne répond plus dans le fil que pour un
>   `success` : `failure`, `quarantine` et les suites de lignes assignées à la
>   main partent en mail neuf, `listRecipients` filtrant sur `reportIssues`.
>   C'est ce qui permet un transféreur sans accès aux erreurs.
> - **Front.** `organizations.listAlertPrefs` / `setMemberAlertPref`
>   (auto-édition sans rôle, édition d'autrui en `admin`, appartenance à l'org
>   re-vérifiée côté serveur) et `src/components/settings/AlertPrefsCard.tsx`
>   sous la liste des membres. i18n `settings:alerts.*` fr/en.

---

## v1.166.1 — 03/08/2026 à 10:39 — Un report envoyé depuis une adresse perso se range enfin tout seul

Quand un fondateur envoie son investor update depuis son adresse
personnelle (gmail…) plutôt que depuis celle de sa société, le circuit
n'avait plus le domaine pour reconnaître la participation. Il lui restait
pourtant une preuve solide — le nom de la société écrit noir sur blanc dans
le message — mais l'IA, à qui on demande de ne jamais deviner, se déclarait
hésitante, et cette hésitation suffisait à tout bloquer : le report partait
dans « Reports entrants » avec « participation introuvable », à ranger à la
main.

Désormais l'hésitation de l'IA n'a plus le dernier mot sur une preuve
vérifiée. Si le mail ne nomme **qu'une seule** participation, le report est
rangé directement. S'il en nomme plusieurs, le doute est réel et le mail
continue de passer par la file pour arbitrage manuel — et un mail qui ne
nomme aucune participation connue n'est toujours jamais rangé au hasard.

Concrètement : les updates des fondateurs qui écrivent depuis leur adresse
perso arrivent à bon port sans intervention.

> **🔧 Notes techniques**
>
> - `convex/reportIdentify.ts` : la condition de sortie en `no_match`
>   mêlait deux choses, l'absence de corroboration déterministe et le
>   `confidence === 'low'` du modèle. Le second terme annulait le premier
>   même quand il était satisfait.
> - Décision extraite en fonctions pures dans `convex/lib/emailIdentify.ts` :
>   `namedIdentities()` (participations nommées dans le mail, sur **toute**
>   la liste de candidats, clé d'identité domaine sinon nom — même règle que
>   le check d'ambiguïté) et `acceptIdentification()` (pas de corroboration →
>   review ; `low` ne veto que si `namedCount > 1`).
> - `tests/emailIdentify.test.ts` (nouveau) couvre les cas : gmail + un seul
>   nom → match, gmail + plusieurs noms + `low` → review, corroboration par
>   domaine seule → match, aucune corroboration → review.
> - Rejoué sur le mail réel qui a déclenché le bug (Sant Roch) : sur les 323
>   participations des deux orgs, une seule est nommée dans le message → le
>   pick `low` est accepté.
> - Le log de non-match porte désormais `named=N` en plus de `picks`/
>   `confidence`, pour diagnostiquer sans accès à la base.
> - Non traité ici, à suivre : le pipeline report n'a **aucun retry** sur ses
>   appels LLM (un échec transitoire = cul-de-sac + un mail), et le champ
>   `inboundEmails.error` n'est remonté ni dans la file ni dans le mail
>   d'échec — c'est ce qui a rendu les 3 « erreur technique pendant
>   l'analyse » indiagnosticables côté utilisateur. Le pattern à reprendre
>   existe déjà dans `convex/vectorize.ts`.

---

## v1.166.0 — 31/07/2026 à 16:26 — L'indexation des documents se voit, se relance, et prévient quand elle échoue

L'assistant cherche dans le contenu des documents grâce à une indexation qui
tourne en coulisses. Jusqu'ici, quand elle échouait — typiquement quand le
service d'indexation européen était saturé, comme ce matin — ça ne se voyait
nulle part : le document restait simplement introuvable pour l'assistant.

C'est terminé. Chaque document affiche désormais, à côté de son état de
lecture, un **état d'indexation** : indexé, en cours, échec (avec un bouton
de relance), ou rien à indexer. En cas d'échec passager, l'indexation
**réessaie toute seule** plusieurs fois, à quelques minutes d'intervalle ;
si elle n'y arrive toujours pas, vous recevez un **email** avec le document
concerné et le lien pour relancer en un clic. Un document ne disparaît plus
jamais des radars en silence.

Le rattrapage de l'historique profite du même filet : il reprend là où il
s'était arrêté au lieu de tout refaire, et s'interrompt proprement si le
service sature — on le relance plus tard, il continue.

> **🔧 Notes techniques**
>
> - `vectorState`/`vectorDetail` sur `documents` et `companyReports`
>   (`convex/schema.ts`), même mécanique de trace que `ocrState`.
> - `convex/vectorize.ts` : chaque `indexDocument`/`indexReport` écrit son
>   verdict ; échec transitoire → 3 tentatives espacées (+1 min, +5 min)
>   puis email aux membres (`vectorizeFailureEmail`,
>   `convex/emailTemplates.ts`) — jamais d'échec silencieux.
> - Classification de la couche fautive dans
>   `convex/lib/vectorizeErrors.ts:classifyIndexError` (testée dans
>   `tests/vectorizeErrors.test.ts`) : `provider_http_<status>` /
>   `provider_unreachable` / `provider_bad_response` /
>   `index_write_failed`.
> - Backfill séquentiel et **reprenable** : saute `indexed`/`skipped`,
>   s'arrête proprement sur quota (résumé `STOPPED`), re-run = reprise.
>   Pas de cron de rattrapage — un seul moteur, celui de la trace OCR.
> - UI : `VectorStatus` (jumeau d'`OcrStatus`,
>   `src/components/documents/DocumentReading.tsx`), branché dans
>   `DocumentAttachment` ; relance via `documents:reindex`.
> - Contexte : le 429 Nebius du 31/07 venait du quota mutualisé
>   OpenRouter→Nebius (trafic mondial du modèle ×2), pas de notre volume —
>   cf. `KNOWN_ISSUES.md` § « Vectorisation ».

## v1.165.0 — 31/07/2026 à 16:10 — « 1 sur 2 » dans la colonne Deals

La mention qui signale qu'une société apparaît dans plusieurs tableaux
passe **sous le nom de la société à la colonne Deals** : une ligne qui ne
couvre qu'une partie des deals faits sur la boîte affiche simplement
« 1 sur 2 » au lieu de « 1 deal ». Plus de sous-titre ni de pastille sous
le nom — l'information est là où on compte les deals, et elle dit
l'essentiel : ce n'est pas un doublon, c'est un deal parmi deux.

> **🔧 Notes techniques**
>
> - `ParticipationsView.tsx` : le `crossRef` (total + autres tableaux) se
>   simplifie en un seul champ `companyDealTotal`, posé uniquement quand la
>   ligne ne porte pas tous les deals de la société ; toujours sommé sur
>   l'ensemble non filtré. Le helper `rowBucket` et `BUCKET_ORDER`,
>   devenus inutiles, sont retirés (retour à la boucle de répartition
>   d'origine).
> - `ParticipationsTable.tsx` : la cellule société revient à son état
>   d'avant, la colonne Deals rend `dealsOfTotal` (« {{n}} sur {{total}} »)
>   quand `companyDealTotal` est présent. Clés `crossRef.*` supprimées.

## v1.164.0 — 31/07/2026 à 14:16 — Fini le faux doublon dans la liste des participations

Quand une société a des deals dans des états différents — par exemple un
deal sorti et un nouveau ticket en cours, comme Rewatt — elle apparaît dans
deux tableaux de la liste, et ça pouvait se lire comme un doublon. Ces
lignes portent maintenant un sous-titre sous le nom de la société : « 1
deal sur 2 · 1 sorti » côté positions ouvertes, « 1 deal sur 2 · toujours
en portefeuille » côté exits, avec une pastille de la couleur du tableau où
vit le reste de la société. Rien ne change sur les autres lignes ni dans
les chiffres : chaque tableau garde ses sommes exactes.

> **🔧 Notes techniques**
>
> - Calcul **100 % client** dans `ParticipationsView.tsx` : la vue possède
>   déjà toutes les lignes d'une société, un helper `rowBucket` (même arbre
>   de décision que `dealBucket`) classe chaque ligne, et les sociétés
>   présentes dans ≥ 2 tableaux reçoivent un `crossRef` (total de deals +
>   autres tableaux), calculé sur l'ensemble **non filtré** pour que la
>   mention ne clignote pas avec les facettes. Aucun changement serveur.
> - Rendu dans `ParticipationsTable.tsx` (cellule société, colonne gelée) :
>   sous-titre « N deals sur M » + pastille par autre tableau via
>   `participationBucketBand` — la palette de statut existante. Nouvelles
>   clés i18n `crossRef.*` (fr/en). Doc produit et TESTING.md (SH19) mis à
>   jour.

## v1.163.0 — 30/07/2026 à 18:54 — Une petite roue qui tourne partout où ça charge

Jusqu'ici, quand l'app attendait quelque chose, elle affichait un simple
« Chargement… » figé. Rien ne distinguait un écran qui travaille d'un écran
qui a planté. Une **petite roue qui tourne** accompagne désormais chaque
attente, toujours au même endroit et toujours avec la même allure :

- **Les pages et les tableaux qui se remplissent** : accueil, fiche deal,
  fiche société, fiche placement, to-do, administration, participations,
  deals, pointage, passif, documents, reportings, KPIs, trésorerie
  (prévisionnel, fiche compte), plan vs réel, fonds.
- **Les fichiers qu'on envoie** : documents d'un deal, reportings et reports
  d'une société, logo. Le bouton garde son libellé « Téléversement… » et
  gagne la roue à côté — on voit que l'envoi est en cours, pas bloqué.
- **Les analyses en arrière-plan** : un reporting reçu par e-mail ou déposé à
  la main passe par une extraction automatique. Tant qu'elle tourne, le
  statut « en cours de traitement » porte la roue, dans la boîte de réception
  des reportings comme sur la fiche société.

Rien ne change dans les données ni dans les gestes : c'est uniquement de la
lisibilité. Les endroits qui avaient déjà leur indicateur (lecture d'un
document, synthèse IA, synchronisation bancaire, panneau IA) sont inchangés.

> **🔧 Notes techniques**
>
> - `src/components/ui/spinner.tsx` : ajout de `LoadingLine` à côté du
>   `Spinner` existant — un `<span>` `inline-flex` qui pose la roue
>   (`size-3.5`) devant son libellé, en `text-muted-foreground text-sm`.
>   Inline pour se centrer dans un parent flex comme dans une `TableCell`
>   en `text-center`, sans s'étirer.
> - Famille « chargement de données » : les ~25 `<div|p className="…text-sm">
{t('loading')}</…>` disséminés dans les routes et les composants sont
>   remplacés par `<LoadingLine>{t('loading')}</LoadingLine>`. Aucune clé i18n
>   nouvelle, aucune condition de rendu touchée.
> - Famille « upload » : `<Spinner />` conditionné à l'état `saving` dans les
>   boutons de `DealDocumentsSection`, `ReportingsSection` et
>   `CompanyReportsSection` ; dans `ImageUpload`, la zone de dépôt empile la
>   roue au-dessus du libellé.
> - Famille « analyse » : `reports.tsx` ajoute la roue dans le `Badge` quand
>   `row.status === 'processing'` ; `UploadProgressLine`
>   (`CompanyReportsSection`) passe en `flex` pour porter la roue tant que le
>   statut n'est pas `needs_review`.
> - Écarté volontairement : pas de skeletons, pas de barre de progression en
>   pourcentage. Sur les grandes tables (participations, pointage,
>   prévisionnel) un skeleton resterait plus lisible qu'une roue — piste pour
>   un passage dédié.

---

## v1.162.1 — 30/07/2026 à 18:45 — La fiche deal ne parle plus d'une courbe qu'elle n'affiche pas

La section Prévisionnel d'une fiche deal affichait une ligne « Reste à
déployer : X (engagé Y − versé Z) — sans date d'appel, compté à part de la
courbe ». Elle est retirée.

La phrase était écrite du point de vue de la Trésorerie, où le capital
engagé non appelé est posé juste à côté de la courbe de prévisionnel : la
mise à part se comprend d'un coup d'œil. Sur une fiche deal, il n'y a
aucune courbe — la référence pointait dans le vide. Pire, dès qu'un appel
de fonds était daté dans le prévisionnel, la ligne annonçait « sans date
d'appel » juste au-dessus de l'échéance datée qui la contredisait.

Le montant reste-t-il lisible ? Oui, à son seul endroit cohérent : la carte
**« Capital engagé non appelé »** de la Trésorerie (onglet Gestion), qui le
totalise sur tous les deals et le détaille deal par deal.

À noter, sans changement à ce stade : un engagement non versé mais déjà
daté dans le prévisionnel est compté deux fois au niveau de l'organisation
— une fois dans la courbe au mois de l'appel, une fois dans la carte du
capital engagé non appelé. Corriger cela suppose de changer la règle de
calcul de la carte, ce qui n'entre pas dans ce nettoyage.

> **🔧 Notes techniques**
>
> - `DealForecastSection.tsx` : suppression du paragraphe
>   `dealForecast.committed` ; `isEmpty` ne dépend plus que de
>   `entries.length` (sans quoi un deal sans échéance mais avec un reste
>   engagé n'affichait plus ni état vide ni table).
> - `convex/forecasts.ts` — `getDealForecast` ne renvoie plus que
>   `entries` : `committedCents` / `paidCents` / `remainingCents` étaient
>   devenus orphelins, ainsi que le scan des transactions du deal (une
>   lecture de moins par ouverture de fiche). `getCommittedPipeline` est
>   inchangé et reste le seul porteur de la règle, filtre miettes
>   `PIPELINE_RESIDUAL_RATIO` compris.
> - Clés `dealForecast.committed` retirées de `fr` et `en`
>   (`participations`).
> - `TESTING.md` : FC27 réécrit (plus de ligne à vérifier), FC14 ne
>   mentionne plus la fiche deal ; `docs/produit/05-deals.md` renvoie vers
>   la Trésorerie pour le reste à déployer.
> - Ce merge retire aussi trois marqueurs de conflit (`<<<<<<<`,
>   `=======`, `>>>>>>>`) commités par erreur dans ce fichier sur `main`
>   (PR #338) : ils s'affichaient tels quels dans la page Nouveautés. Les
>   deux entrées encadrées (v1.162.0 et v1.161.0) sont conservées telles
>   quelles.

## v1.162.0 — 30/07/2026 à 18:40 — Pointer un deal rattrape son échéance prévue, et les échéances s'annulent depuis le registre

Deux angles morts du rapprochement prévisionnel ↔ réel disparaissent :

- **Pointer une transaction sur un deal propose de réaliser son échéance
  prévue.** Jusqu'ici, si la suggestion de rapprochement n'était pas passée
  (virement trop tardif, montant trop différent), on pointait la transaction
  sur le deal… et l'échéance prévisionnelle restait « En retard » dans le
  registre, sans moyen simple de la solder. Le pointage propose désormais
  aussitôt, dans la notification de succès, de **réaliser l'échéance
  attendue** du deal — même éloignée en date ou en montant : le lien au deal
  suffit.
- **Annuler une échéance directement depuis le registre.** Chaque ligne
  prévisionnelle du registre porte une action « Annuler l'échéance » avec
  confirmation — y compris les occurrences générées par une règle
  récurrente, qui jusqu'ici ne pouvaient être annulées que via l'assistant
  IA. L'échéance annulée sort du registre et du solde projeté.

> **🔧 Notes techniques**
>
> - `transactions.matchTransaction` retourne désormais `pendingEntry`
>   (l'échéance `pending` du deal la plus proche en date — même sens, EUR,
>   sans fenêtre date/montant) ; `PointageTable.handleMatch` affiche un
>   toast avec action « Réaliser l'échéance » →
>   `forecasts.markEntryRealized` (mode `close`, l'écart reste lisible).
> - Lignes prévisionnelles de `PointageTable` : bouton « Annuler
>   l'échéance » + AlertDialog → `forecasts.cancelEntry` (mutation
>   existante, jusqu'ici réservée aux ponctuelles de l'onglet Gestion).
> - Test de régression ajouté (`convex/regression.pointage.test.ts` :
>   retour `pendingEntry`, plus proche en date, même sens) ; docs produit
>   08/09, `TESTING.md` (FC20, FC30, B11) et `KNOWN_ISSUES.md` mis à jour.

## v1.161.0 — 30/07/2026 à 18:35 — La TVA quitte l'écran, les comptes nantis rejoignent les placements

Deux nettoyages qui vont dans le même sens : ne garder à l'écran que ce qui
sert au pilotage.

**La TVA sort de l'interface.** Qualifier un taux de TVA ligne à ligne sur
les charges ne servait pas au quotidien — c'est un travail de comptable, fait
ailleurs. Le sélecteur de taux sur les lignes de charges et de produits, la
carte « TVA récupérable » et l'échéance de TVA suggérée disparaissent donc.
Une ligne de charge se qualifie maintenant par sa **catégorie**, et rien
d'autre. Les taux déjà saisis restent en base et l'assistant IA sait toujours
répondre sur la position de TVA : c'est un retrait d'écran, pas une
suppression.

À ne pas confondre avec la **TVA des deals**, qui elle ne bouge pas : les
royalties encaissées restent converties en hors taxes pour que leur multiple
et leur rendement soient justes. C'est bien la distinction qu'on voulait
garder.

**Les comptes nantis basculent dans les Placements.** Un nantissement de
titres ou d'espèces, c'est de l'argent bloqué — donc du long terme, pas de la
trésorerie. Ces comptes quittent la page Trésorerie et apparaissent en bas de
la page Placements, dans une section « Comptes nantis » : banque, nom, entité
titulaire, solde. Leur total s'ajoute au solde des placements (le sous-texte
rappelle la part nantie) mais reste hors du versé, de la plus-value et du
rendement — il n'y a pas de deal derrière un compte. Côté Trésorerie, leur
montant est rappelé dans la ligne « Non liquide » sous les comptes. Les
comptes **clôturés**, eux, ne bougent pas : ils restent en Trésorerie, c'est
de l'historique.

> **🔧 Notes techniques**
>
> - Retrait TVA front : `VatRateSelect` (dans `PointageTable.tsx`),
>   `VatCard.tsx`, `VatSuggestionCard.tsx` et le miroir `src/lib/vat.ts`
>   supprimés ; plus d'envoi de `DEFAULT_VAT_RATE_BPS` sur
>   `categorizeAsCharge`/`bulkCategorize` (écrire un taux non relisible serait
>   pire que pas de taux). Backend intact : schéma, `setVatRate`,
>   `getVatPosition`, `suggestVatEntry`/`createVatEntry`, outils agent/MCP.
>   La dé-TVA des royalties vit dans `convex/lib/metrics.ts` (par
>   `instrumentKind`), elle ne lit jamais `vatRateBps` — zéro impact.
> - Comptes nantis : prédicat partagé `isPledgedPlacement`
>   (`CashAccounts.tsx`, nanti ET non clôturé) consommé par la carte Comptes,
>   par le total « non liquide » de `ForecastOverview` et par
>   `placements.index.tsx` ; nouvelle section `PledgedAccountsSection` dans
>   `PlacementsView.tsx` (lecture seule, ligne → `/cash/$accountId`), solde
>   ajouté à la seule tuile « solde total ».
> - `tests/vat.test.ts` perd le test de miroir front (le module n'existe
>   plus), garde la dérivation Convex.

## v1.160.0 — 30/07/2026 à 18:25 — Rattacher une société à sa fiche Attio, depuis sa fiche

Les sociétés qui arrivent par la synchronisation Attio sont déjà rattachées à
leur fiche CRM. Celles créées à la main dans Albo, non — et rien ne permettait
de le faire : la ligne « Fiche Attio » du panneau d'identité affichait le lien
quand il existait, un tiret sinon, sans jamais rien proposer.

Elle devient **la dernière ligne éditable du panneau**, dans le même geste que
les autres :

- Pas de lien ? Un clic ouvre une **recherche dans Attio**. On tape deux
  lettres, on choisit dans la liste — chaque suggestion affiche le nom et, si
  Attio le connaît, le **domaine**, ce qui permet de départager les homonymes.
- Un lien existe ? La ligne affiche « Ouvrir dans Attio » et une **croix pour
  détacher**.

On ne peut pas saisir une référence à la main, uniquement en choisir une :
c'est ce lien qui indique à la synchronisation où ranger les prochains deals,
une valeur inventée les enverrait en silence sur la mauvaise société. Pour la
même raison, une fiche Attio ne peut être rattachée qu'à **une seule** société,
toutes organisations confondues — sinon la synchronisation se bloque.

> **🔧 Notes techniques**
>
> - `convex/attio.ts` : action `searchCompanies`, miroir de `searchPeople` sur
>   l'objet `companies` d'Attio (même garde d'appartenance via
>   `internal.attio.requireMember`, mêmes dégradations douces `config` /
>   `upstream`, clé jamais loguée). Helpers `companyName` / `companyDomain` sur
>   les attributs historisés ; le domaine remonte pour départager les homonymes
>   dans le picker.
> - `convex/companies.ts` : `update` accepte `attioCompanyId` (`''` → colonne
>   retirée, comme `domain`). ⚠️ `assertAttioCompanyIdFree` est **global, pas
>   par org** : `by_attio_company_id` est un index global lu en `.unique()` par
>   `attioSync.ts:resolveOrCreateTargetCompany`, donc un doublon d'ancrage —
>   même inter-org — ferait throw la synchro. Nouveau code d'erreur
>   `attio_company_already_used`.
> - `src/components/companies/AttioCompanyField.tsx` (nouveau) : la ligne du
>   panneau, posée comme un `IdentityField` (elle ne peut pas en être un : sa
>   valeur au repos est un lien + une croix). Picker `AttioCompanySearch` —
>   recherche débouncée, popover de résultats, `preventDefault` sur `mousedown`
>   pour que le blur n'annule pas avant le clic. Aucun chemin de saisie libre.
> - `AttioCompanyLink` retiré de `EntityFiche.tsx` (orphelin après ce
>   changement) ; `edit.personSearching` / `edit.personSearchError` renommées
>   `edit.attioSearching` / `edit.attioSearchError` — leur texte était déjà
>   générique et sert maintenant aux deux pickers.
> - Tests : trois cas ajoutés à `convex/regression.deals.test.ts` (ancrage déjà
>   pris refusé, refus **inter-org**, détachement qui libère l'ancrage).
> - Docs : `TESTING.md` (TP11 corrigé, nouveau TP11e),
>   `docs/produit/04-participations.md`, `KNOWN_ISSUES.md` (§ fiche société,
>   points 5 et 6).

## v1.159.0 — 30/07/2026 à 17:35 — La fiche société s'édite au clic, comme la fiche deal

La fiche deal s'édite déjà entièrement au clic : on clique une valeur du
panneau de droite, on écrit, c'est enregistré. La fiche société, elle,
gardait deux gestes différents — le secteur, le SIREN et le domaine
s'éditaient au clic, mais le **résumé** et les **personnes** obligeaient
encore à ouvrir le dialogue « Modifier », qui prend tout l'écran sur mobile.

Les deux fiches se manipulent désormais **de la même façon**, partout dans le
panneau latéral :

- **Résumé** : un clic sur le texte (ou sur « Ajouter un résumé de la
  société… » quand il n'y en a pas) ouvre la saisie ; on clique ailleurs et
  c'est enregistré. Échap annule.
- **Personnes** : fondateurs, board et co-investisseurs se gèrent sur place.
  La pastille **« + Ajouter »** ouvre un champ de saisie, un clic sur un nom
  le corrige, la croix retire la personne. La saisie propose toujours les
  **personnes d'Attio** au fil de la frappe : choisir une suggestion rattache
  la personne au CRM, taper un nom libre la laisse non rattachée.
- **Notes d'un deal** : même geste que les lignes juste au-dessus — plus de
  crayon, plus de boutons Enregistrer / Annuler.

Le menu ⋯ de la fiche société ne garde que ce qui n'est pas un champ de la
fiche : **renommer** la société, créer un deal, lier une plateforme externe,
archiver, supprimer.

> **🔧 Notes techniques**
>
> - `src/components/ui/inline-field.tsx` : `InlineField` gagne un `layout`
>   `block` (pas de libellé, valeur pleine largeur — la section porte déjà son
>   titre), le format `multiline` (textarea, blur commit, Échap annule, Entrée
>   = retour à la ligne) et une prop `placeholder` qui remplace le tiret cadratin
>   sur un champ vide. `FieldFormat` (`src/lib/parse.ts`) accueille
>   `'multiline'` — même parse/sérialisation que `'text'`.
> - `src/components/companies/PeopleEditor.tsx` (nouveau) : les trois sections
>   de personnes, ajout / renommage / retrait en place. Chaque ligne porte son
>   **index dans le tableau stocké** (les sections sont un regroupement
>   d'affichage par rôle), `companies.update` recevant toujours la **liste
>   complète**. `PersonInput` (partagé ajout + renommage) reprend la recherche
>   Attio de l'ancien `PersonRow` ; les boutons de suggestion font
>   `preventDefault` sur `mousedown` pour que le blur ne valide pas le nom tapé
>   avant que le clic n'atterrisse. Renommer à la main **détache**
>   `attioRecordId`, comme avant.
> - `src/routes/app/$orgSlug/participations.$companyId.tsx` : `EditCompanyDialog`
>   (~230 lignes) et `PersonRow` (~170) remplacés par `RenameCompanyDialog`
>   (le nom seul — il vit dans l'en-tête, pas dans le panneau) ; résumé en
>   `InlineField` `block`/`multiline` dans une section **toujours affichée** ;
>   `peopleByRole` remplacé par `<PeopleEditor>`. Le menu ⋯ passe à
>   `common:actions.rename`.
> - `src/routes/app/$orgSlug/deals.$dealId.tsx` : `NotesSection` passe au même
>   `InlineField` (l'état local `editing`/`pending` et les boutons disparaissent).
> - `src/components/companies/EntityFiche.tsx` : `PeopleList`, `Person` et
>   `personInitials` déménagent dans `PeopleEditor` ; les branches JSX
>   `linkedin`/`email` jamais alimentées ne sont pas reconduites (cf.
>   `KNOWN_ISSUES.md` § personnes).
> - i18n : `identity.summaryPlaceholder`, `identity.addPerson`,
>   `common:actions.rename` ajoutées (fr + en) ; `edit.domainLabel`,
>   `edit.domainPlaceholder`, `edit.sectorLabel`, `edit.summaryLabel`,
>   `edit.summaryPlaceholder`, `edit.peopleLabel`, `edit.peopleAdd`,
>   `edit.peopleNameRequired`, `edit.personLinkedToAttio`, `notes.empty` et
>   `identity.empty` retirées.
> - Docs : `TESTING.md` (TP11, TP11b, nouveau TP11d, FD17),
>   `docs/produit/04-participations.md`, `docs/produit/05-deals.md`,
>   `KNOWN_ISSUES.md` (§ personnes), `TEMPLATE_SYNC.md` (ligne `InlineField`).

## v1.158.0 — 30/07/2026 à 17:11 — Créer un placement depuis la page Placements

Jusqu'ici, un placement (contrat de capitalisation, dépôt à terme,
compte-titres, crypto) ne pouvait naître que depuis la fiche d'une
entreprise déjà existante — il fallait d'abord créer l'entreprise dans la
liste Entreprises, puis ouvrir sa fiche, puis créer le deal.

La page **Placements** porte maintenant un bouton **« Nouveau placement »** :
un seul formulaire pour choisir l'entité détentrice, le support — une
entreprise existante **ou une nouvelle, créée dans la foulée** en tapant
simplement son nom —, le type de placement, et en option la
banque/plateforme, la date d'ouverture et le solde actuel. La création
ouvre directement la fiche du placement, rangé dans sa section de
liquidité (corrigeable sur la fiche, comme avant).

> **🔧 Notes techniques**
>
> - `CreatePlacementDialog.tsx` (nouveau) : Select entité `group_*`
>   (pré-sélection si unique), Select support avec sentinelle
>   « + Nouvelle entreprise » → `companies.create` (kind `portfolio`, nom
>   seul) puis `deals.create` (types `TREASURY_PLACEMENT_KINDS`,
>   `currentValue`/`bankName`/`closingDate` optionnels) ; navigation vers
>   `/placements/$dealId`.
> - `placements.index.tsx` : bouton « Nouveau placement » en tête de page.
> - Deux mutations séquentielles assumées (une société orpheline sans deal
>   est inoffensive si la seconde échoue) ; clés i18n `placements:create.*`.

## v1.157.0 — 30/07/2026 à 17:05 — Trésorerie : une seule vue d'ensemble, le solde projeté en premier

La page Trésorerie passe de quatre onglets à **deux** : tout le quotidien
tient maintenant dans la **Vue d'ensemble**, et l'onglet **Gestion** garde ce
qui se configure une fois par mois (règles récurrentes, échéances
ponctuelles, capital engagé non appelé, TVA, seuil d'alerte, connexions
bancaires).

En tête de page, le chiffre qui compte : le **solde projeté**. Trois tuiles
sur une ligne — le disponible aujourd'hui (au centime), puis le solde
projeté à **30 jours** et à **90 jours**, chacun détaillé en une petite
somme : entrées, sorties, et le net souligné. La courbe de solde reste
juste en dessous, suivie des **comptes avec le logo de leur banque** pour
les reconnaître d'un coup d'œil — les comptes nantis ou clôturés restent
listés, atténués, hors du disponible. Une ligne discrète rappelle le cash
**non liquide** (contrats de capitalisation…) et renvoie vers les
Placements.

En bas de page, **un seul registre** : les échéances prévues au-dessus du
séparateur « Aujourd'hui », toutes les transactions réelles en dessous. Une
échéance en retard descend à sa date, en ambre. Plus de bouton « À
pointer » : c'est une valeur du filtre **Statut** (avec son compteur), aux
côtés de la recherche, d'un nouveau filtre **Montant** (min/max) et du
compte — la même grammaire de filtres que les participations. Le statut
« À pointer » s'affiche désormais en **ambre**, ici comme dans le panneau
de détail d'une transaction (qui montrait… rien : le statut disparaissait
au clic, c'est corrigé). Le pointage quotidien, lui, se lance depuis
l'onglet **À faire**, qui ouvre ce registre déjà filtré.

Le tableau prévisionnel « catégories × mois » est retiré — la projection
continue de tourner exactement pareil sous la courbe.

> **🔧 Notes techniques**
>
> - `cash.index.tsx` : 2 onglets (`apercu`/`gestion`), `?filter=` pré-filtre
>   le registre ; `?tab=previsionnel|transactions|analyse` retombent sur la
>   Vue d'ensemble. `ForecastGridSection.tsx` et `UpcomingEntries.tsx`
>   supprimés (backend `getForecastGrid` conservé pour la courbe) ; la carte
>   pipeline extraite dans `CommittedPipelineCard.tsx` (onglet Gestion).
> - `CashKpis.tsx` : 3 tuiles — dispo (centimes) + projetés 30/90 j
>   (`available + netCents` de `getUpcomingEntries`, arrondi euro) avec somme
>   entrées/sorties/net sur 3 lignes.
> - `CashAccounts.tsx` : carte Comptes unifiée (dispo + nantis/clôturés
>   atténués) avec logos via `lib/bankDomains.ts` → `CompanyLogo` (logo.dev) ;
>   ligne non-liquide = somme des placements `placementLiquidity() !== 'liquid'`.
> - `TransactionsLedger.tsx` + `PointageTable.tsx` : lignes prévisionnelles
>   (`getUpcomingEntries`) fusionnées au registre avec séparateur
>   « Aujourd'hui », badges Prévu (info) / En retard (warning), montants
>   prévisionnels arrondis à l'euro ; filtre Statut (menu unique, compteur
>   inline) + filtre Montant client-side (`AmountInput` min/max) ; badge
>   `unmatched` en warning (4.4).
> - Bug 4.5 : `TransactionSheet` affiche le statut et lit la ligne **live**
>   (plus le snapshot du clic). CTAs To do / VatCard / email
>   `overdueEntriesEmail` → `/cash?filter=unmatched`.

## v1.156.0 — 30/07/2026 à 16:57 — Une liste de secteurs qui veut enfin dire quelque chose

La liste des secteurs avait dérivé : des étiquettes créées une par une au fil
des deals, des doublons de casse, et surtout des cases qui ne décrivaient pas
un marché — un studio, une structure de carried, un fonds. Résultat : filtrer
par secteur ne renseignait plus sur l'exposition réelle du portefeuille.

Elle est ramenée à **quatorze valeurs**, chacune avec une définition : SaaS /
Logiciel, Fintech, Santé / Biotech, Silver economy, AgriFood, Consumer /
Retail, Marketplace, Industrie / Circulaire, DeepTech, Immobilier, Fonds /
Véhicules, Mobilité, EdTech, Autre.

Ce qui change concrètement :

- **Le secteur dit le marché, plus le véhicule.** SPV, fonds, studio, carried :
  l'instrument du deal le disait déjà. Les participations sans marché propre se
  rangent désormais toutes dans « Fonds / Véhicules ».
- **« Climat » disparaît.** Avec une thèse d'impact, les trois quarts du
  portefeuille pouvaient le revendiquer : la case ne triait rien et attirait
  tout — elle contenait un logiciel, une opération immobilière et deux fonds.
  Chaque société est revenue à son marché réel.
- **Deux nouveaux secteurs** : **Silver economy**, qui sort l'accompagnement du
  grand âge de la santé (ce ne sont ni les mêmes clients ni les mêmes
  financeurs), et **DeepTech**, pour les ruptures scientifiques qu'aucun marché
  de la liste ne couvre.
- **« Services » disparaît aussi** : c'était le fourre-tout où tombait ce qu'on
  ne savait pas ranger.
- **Plus aucune valeur libre héritée.** Les étiquettes créées à la volée
  (Agritech, Retail, Mobility, Circular Economy, Start-up Studio…) sont
  ramenées sur la liste. Vingt participations changent de secteur.

Le champ reste **saisissable librement** : si une case manque, on peut toujours
taper un secteur. L'assistant IA, lui, ne peut plus en inventer — il choisit
dans la liste ou laisse vide, ce qui était la principale source de dérive.

> **🔧 Notes techniques**
>
> - Liste canonique déplacée de `src/lib/sectors.ts` vers `convex/lib/sectors.ts`
>   (même pattern que `lib/instruments.ts`) : front, outils d'agent et migration
>   partagent la même source. Le doc-comment porte les 4 règles d'affectation —
>   marché ≠ véhicule, la verticale bat le modèle, `marketplace` en exception
>   assumée, aucune lecture transversale — plus le budget de largeur des
>   libellés (la colonne Secteur de `ParticipationsTable` est dimensionnée sur
>   le libellé le plus long, désormais « Industrie / Circulaire »).
> - `SECTOR_SLUGS` : 16 → 14. Ajouts `silver` / `deeptech` ; retraits `climate`,
>   `services`, `media`, `crypto`. Libellés FR/EN mis à jour (`industry`
>   « Industrie / DeepTech » → « Industrie / Circulaire », `fund` → « Fonds /
>   Véhicules », `consumer` → « Consumer / Retail »). `companies.sector` reste
>   `v.string()` au schéma — le combobox créable est inchangé.
> - `agentTools` : `createCompany` / `updateCompany` passent de
>   `z.string().optional()` à `z.enum(SECTOR_SLUGS).optional()` (const partagé
>   `sectorInput`). C'est le verrou : les valeurs one-off type « Carried Interest
>   Structure » venaient de là.
> - Migration `convex/migrations/normalizeSectors.ts` (`dryRun` / `apply` /
>   `report`) : 18 décisions par entité ancrées `_id` prod + garde nom (une même
>   valeur d'origine peut partir sur deux cibles — `services` → `industry` pour
>   Reekom, `silver` pour Tango/Auxicare), puis alias par valeur pour le reste,
>   archivées et org Calte incluses. Idempotente, non destructive : une valeur
>   sans lecture unique est remontée dans `needsManualReview` plutôt que réécrite
>   en `other`. À lancer juste après le deploy.
> - Doc : `TESTING.md` SH19c (libellé le plus long) + nouvelle ligne SH22,
>   `MIGRATIONS.md`, `docs/produit/04-participations.md` § « Les secteurs »,
>   anti-pattern `CLAUDE.md`.

## v1.155.1 — 30/07/2026 à 16:40 — Plan de test de la fiche deal remis d'équerre

Rien ne change dans l'application : deux étapes du plan de test interne
décrivaient un écran qui n'existe plus (un bandeau de montants qui n'apparaît
plus tel quel, et un sélecteur de type d'instrument retiré de l'en-tête depuis
longtemps). Elles décrivent maintenant ce que l'écran fait vraiment.

> **🔧 Notes techniques**
>
> - `TESTING.md` FD9 : le « strip Engagé / Versé / Reçu » ne correspondait plus
>   à `dealAmountTiles` — une seule tuile de montant dans le cas courant
>   (« Décaissé (réel) »), « Engagé prévisionnel » si `status === 'pending'`,
>   deux tuiles pour `fund_lp` seulement, « Reçu » toujours à côté. La ligne
>   portait aussi encore « Documents juste sous les Transactions » (le bloc est
>   en bas de la colonne centrale depuis v1.155.0).
> - `TESTING.md` FD39 : suppression du scénario (a) « aperçu via le sélecteur
>   de type d'en-tête » — ce sélecteur n'existe plus (cf. FD8), le changement de
>   type passe par ⋯ → « Modifier ». La ligne ne garde que les champs calculés
>   non éditables et le no-op du champ € vidé.
> - À noter, **non corrigé** : le drapeau `editable` d'`InstrumentDetails`
>   (`src/components/deals/InstrumentBlock.tsx`) n'a plus de site d'appel à
>   `false` depuis le retrait de ce mode aperçu — sa branche lecture seule
>   (`IdentityField`) est du code mort.

## v1.155.0 — 30/07/2026 à 16:30 — La fiche deal adopte la structure de la fiche société

La fiche d'un deal s'ouvrait comme une longue colonne : les caractéristiques
de l'instrument en haut, puis tout le reste à la suite. Il fallait remonter en
haut de page à chaque fois qu'on voulait revérifier un taux ou une date
pendant qu'on regardait les transactions.

Elle est maintenant bâtie **comme la fiche d'une société** : un **panneau à
droite** rassemble les **détails de l'instrument** — montants, taux, dates,
multiples, une caractéristique par ligne — et les **notes** du deal. Ce
panneau **reste visible pendant qu'on fait défiler** la page, exactement comme
la fiche d'identité d'une société. Chaque valeur s'y **édite au clic**, sans
passer par le dialogue « Modifier ».

La colonne centrale est consacrée à la vie du deal : le suivi propre à
l'instrument quand il en a un (les royalties perçues et leur suivi
trimestriel, le perçu à date d'un SPV en gestion), puis les **transactions**,
le prévisionnel, le business plan vs réalisé et les documents.

Conséquence sur les deals **royalties** et **SPV en gestion** : leurs
paramètres ne sont plus répétés dans le panneau du milieu, ils sont à droite
avec ceux de tous les autres instruments. Pour les royalties, les montants en
euros du plancher et du plafond restent affichés sur la barre de progression.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/deals.$dealId.tsx` : passage en deux colonnes
>   (`flex-col lg:flex-row` + `aside` 320 px avec `useStickyBottom`), même
>   squelette que `participations.$companyId.tsx`. Ordre de la colonne
>   centrale : `InstrumentPanel` → `Transactions` → `DealForecastSection` →
>   `FundSection` / `PlanVsActualSection` → `DealDocumentsSection`.
>   `NotesSection` rendue dans un `IdentitySection` (icône + titre + crayon en
>   action) et déplacée dans l'`aside`.
> - `src/components/deals/InstrumentBlock.tsx` : `InstrumentBlock` éclaté en
>   `InstrumentDetails` (les champs `INSTRUMENT_FIELDS` en rangées
>   `InlineField layout="row"`, pour **tous** les kinds, `Placeholder` pour
>   les kinds `render: 'placeholder'`) et `InstrumentPanel` (le corps des
>   kinds `render: 'custom'`, `null` sinon). `CustomPanelProps` perd
>   `notesSlot` et `onEdit`.
> - `RoyaltiesPanel` / `LeadSpvPanel` : suppression de leur carte
>   « Paramètres » (doublon du panneau latéral) et du bouton « Modifier »
>   local ; le `notesSlot` du royalty disparaît. Clés i18n
>   `fiche.royalty.paramsTitle|edit` et `fiche.leadSpv.paramsTitle|edit`
>   retirées (fr + en) ; `dealForecast.hint` corrigée (« Transactions
>   ci-dessus »).
> - Docs : `TESTING.md` (intro de la section fiche deal, FD4/FD22/FD24/FD35,
>   FD41, nouveau FD44) et `docs/produit/05-deals.md`.

## v1.154.0 — 30/07/2026 à 14:35 — Déposer un report soi-même depuis la fiche société

Jusqu'ici, un report n'entrait que par mail : on transférait l'update à
l'adresse dédiée et le circuit faisait le reste. Tous les reports ne
passent pas par là — un PDF récupéré sur un espace investisseur, un deck
remis en main propre, un export sorti d'un outil restaient dehors.

L'onglet **Rapports** d'une fiche société porte maintenant un bouton
**« Ajouter un report »**. On dépose un ou plusieurs fichiers (PDF, Excel,
image — 20 Mo par fichier), on ajoute une note de contexte si c'est utile,
et on lance l'analyse. **C'est exactement le même traitement qu'un mail
transféré** : lecture du contenu (OCR compris), extraction de la période,
des points clés et des métriques, alimentation des séries de KPIs,
rangement sur la fiche et relance de la synthèse IA. Le report est rangé
dans chaque organisation où la société existe, comme pour un mail.

Le temps de l'analyse — quelques dizaines de secondes selon le poids du
fichier — une ligne « analyse en cours… » s'affiche sous le titre de
l'onglet, et le report apparaît tout seul quand c'est prêt. Pas de récap
par mail pour un dépôt manuel : le résultat est sous vos yeux. Si l'analyse
échoue, la ligne le dit avec la raison, et le dépôt reste rattrapable
depuis la boîte Rapports entrants, comme n'importe quel mail.

> **🔧 Notes techniques**
>
> - Nouvelle mutation `reportInbox.createFromUpload` : crée une ligne
>   `inboundEmails` marquée `origin: 'upload'` (nouveau champ optionnel du
>   schéma, absent = email) avec `matchedCompanies` déjà rempli, puis
>   enchaîne sur `reportExtract.run`. La brique 3 (identification LLM) est
>   sautée — la société est choisie par l'utilisateur ; le fan-out
>   multi-org réutilise la règle domaine/nom exact, extraite de
>   `assignCompany` dans le helper `sameParticipation`.
> - Briques 4 et 5 inchangées : `reportExtract` sait déjà lire une pièce
>   jointe présente en storage. `reportStore.storeForCompany` bascule le
>   report et ses `documents` sur `source: 'upload'` et laisse les ids
>   AgentMail vides quand `origin === 'upload'`.
> - `reportNotify.send` sort tôt sur une ligne d'origine `upload` : ses ids
>   AgentMail sont des placeholders, il n'y a pas de fil où répondre.
> - Front : `CompanyReportsSection` porte l'en-tête + le bouton (visible
>   aussi sur l'état vide), le dialog d'upload (`files.generateUploadUrl`
>   puis la mutation) et la ligne d'avancement alimentée par
>   `reportInbox.listUploadsInProgress` (scan des 50 lignes les plus
>   récentes — `matchedCompanies` est un tableau, non indexable).
> - Régression multi-tenant ajoutée : un membre de l'org A ne peut pas
>   déposer de report sur une participation de l'org B.

## v1.153.0 — 30/07/2026 à 12:36 — Trésorerie : le cash d'abord, une seule courbe, des filtres

La Vue d'ensemble de la Trésorerie répond maintenant aux questions dans
l'ordre où on se les pose.

**Où est le cash.** L'indicateur « Solde disponible » ne se contente plus
d'afficher un total : il liste chaque compte avec son solde, au centime, et
le total au-dessus. Compte courant, compte booster, tout ce qui est
mobilisable apparaît là — plus besoin de descendre en bas de page pour voir
la répartition, le tableau des comptes par banque a disparu. Les comptes
**non disponibles** (nantis, clôturés) sont regroupés en bas de page, dans
une section « Hors trésorerie disponible » qui dit clairement qu'ils sont
exclus du total. Chaque ligne reste cliquable vers le détail du compte.

**Ce qui tombe.** Les deux blocs « 30 prochains jours » et « 90 prochains
jours » sont désormais côte à côte, sur une seule ligne. Le bloc
« Atterrissage fin de mois » a été retiré : il redisait, moins clairement, ce
que la courbe montre déjà.

**La trajectoire.** Il n'y a plus qu'une seule courbe au lieu de deux
scénarios qu'on confondait (« projeté engagé » / « projeté avec prévu ») : le
solde du compte, trait plein sur le passé, pointillé sur le futur, en tenant
compte de tout le prévisionnel. Et surtout : elle est **verte tant que le
solde est positif, rouge dès qu'il passe sous zéro**. Le moment où ça bascule
se voit immédiatement. La ligne du seuil d'alerte a été retirée du graphe (le
bandeau d'alerte et son réglage, eux, ne changent pas).

**Les transactions se filtrent.** La rangée de sept onglets (Tout, À pointer,
Pointé, Charges, Impôts, Produits, Virements internes) est remplacée par un
bouton « À pointer » — la file, avec son compteur — et un menu « Type » qui
couvre tout le reste, avec deux entrées nouvelles : **Investissements** (les
transactions rattachées à un deal) et **Comptes courants & emprunts** (celles
allouées au passif). « Je veux voir toutes mes charges » se fait en un choix.

**Les propositions de pointage se lisent enfin.** Le petit bouton gris tronqué
(« ✓ La V… ») est remplacé par un bandeau sous la transaction concernée : le
mot « Proposition », la cible en clair et en entier, puis « Valider » ou
« Refuser ». On comprend qu'il y a quelque chose à décider, et on sait quoi.

> **🔧 Notes techniques**
>
> - `CashKpis` : la tuile « Solde disponible » devient une carte pleine
>   largeur listant les comptes actifs non nantis (lien `/cash/$accountId`
>   par ligne, solde via `fmtEurCents`, fraîcheur de synchro via le nouveau
>   composant exporté `AccountFreshness`) ; tuile « Atterrissage » supprimée ;
>   les deux tuiles de flux passent en `grid-cols-2` inconditionnel.
> - `CashAccounts.tsx` : `CashAccounts` (groupement par banque) devient
>   `UnavailableAccountsSection` — table unique des comptes nantis/clôturés,
>   rendue seulement s'il y en a. Le regroupement par banque et la colonne
>   Entité disparaissent avec elle.
> - `ForecastChart` : une seule série projetée (`plannedBalanceCents`), la
>   série « engagé » et la `ReferenceLine` du seuil sont retirées. Couleur par
>   signe via un `linearGradient` à deux arrêts confondus, dont l'offset est
>   calculé sur l'étendue **de chaque série** (`zeroOffset`) — le piège des
>   unités `objectBoundingBox` est documenté dans `KNOWN_ISSUES.md` « Courbe
>   de solde bicolore » (contraintes : `type="monotone"` et `baseValue={0}`).
> - `listLedger` (`convex/transactions.ts`) : nouvel argument `matchedKind`
>   ('deal' | 'liability'), exclusif de `status`, servi par le nouvel index
>   `by_org_allocation_kind` (`['orgId', 'allocation.kind']`). Avec un terme
>   de recherche, le filtre s'applique en JS après l'index de recherche (dont
>   les `filterFields` n'incluent pas `allocation.kind`).
> - `TransactionsLedger` : `TabsList` remplacé par un bouton toggle
>   « À pointer » (compteur `countByStatus`) + un `Select` « Type » ; un seul
>   état `filter` en dessous, donc aucune combinaison contradictoire possible.
>   L'entrée « Pointé » disparaît (redondante avec Investissements + Comptes
>   courants & emprunts).
> - `PointageTable` : la puce de suggestion sort de `RowActions` et devient
>   `SuggestionBand`, rendue dans une `TableRow` supplémentaire (`colSpan`,
>   `Fragment` par transaction, ligne du dessus en `border-b-0`). « Refuser »
>   alimente un `Set` d'ids en state local — les suggestions étant recalculées
>   à chaque lecture, un refus persistant demanderait une table dédiée (hors
>   périmètre).
> - i18n : `cash.unavailable.*`, `forecast.chartProjected`,
>   `pointage.suggestion.*`, `pointage.filter.type`,
>   `pointage.view.{deal,liability,ignored}` ajoutés en fr/en ; `totalHint`,
>   `kpis.landing*`, `accountsTitle`, `closedSection`, `col.entity`,
>   `chartCommitted`, `chartPlanned`, `view.matched` retirés.
> - `TESTING.md` : CA1, CA2, CA11, FC1, FC19, RU23, RU24, RU32 réécrits,
>   RU33/RU34 ajoutés (filtres par nature de rattachement, bouton toggle).

## v1.152.0 — 30/07/2026 à 12:26 — Les documents deviennent des pièces jointes, et se renomment

L'onglet **Documents** d'une société ne ressemble plus à un tableau. Chaque
document s'y présente comme une **pièce jointe** : une petite box qui porte
l'icône de son format, son titre, le badge de son type et, en dessous, sa
période et son poids. Elles s'empilent de la plus récente à la plus ancienne.
Le mot « Reporting » qui coiffait la liste a disparu — il n'y a pas que des
reportings ici, et l'onglet le dit déjà.

Trois conséquences au quotidien :

- **Un clic sur la box ouvre le document.** Plus besoin de viser une petite
  icône de téléchargement.
- **Un crayon permet de corriger** le titre, le type et la période d'un
  document déjà déposé — un nom de fichier illisible se réécrit en deux
  secondes, sans supprimer puis re-téléverser. L'assistant retrouve
  immédiatement le document sous son nouveau nom.
- **Un filtre par type**, en haut de la liste, ne propose que les types
  réellement présents.

Le bloc **Documents** d'une fiche deal (term sheet, pacte, bulletin de
souscription…) adopte exactement la même présentation, avec ses propres types
et la date du document. Rien ne bouge côté fichiers : ceux déjà déposés
restent en place, avec leur lecture automatique déjà faite.

> **🔧 Notes techniques**
>
> - Nouvelle primitive `src/components/ui/attachment.tsx` (composant
>   `attachment` du registry shadcn, variante Radix — deps `radix-ui` +
>   `button`, déjà présentes). Une seule déviation, commentée dans le
>   fichier : `AttachmentAction` par défaut en `icon-sm`, notre `button.tsx`
>   ne déclarant pas la taille `icon-xs` d'upstream.
> - `src/components/documents/DocumentAttachment.tsx` : la carte partagée par
>   les deux surfaces — `AttachmentTrigger asChild` sur un `<a target=_blank>`
>   (toute la box ouvre le fichier), actions au-dessus (`z-20`) portant
>   `OcrStatus`, le crayon et la corbeille ; icône déduite du `contentType`
>   (image / tableur / doc), vignette rouge quand la lecture a échoué.
> - `ReportingsSection.tsx` : suppression du `h2`, des groupes pliables
>   (`GROUPS`/`Collapsible`) et du tableau ; ajout du filtre `Select` (types
>   réellement présents uniquement) et de la liste de cartes. La modale de
>   métadonnées est mutualisée création/édition (`pendingFile` xor
>   `editingId`). Idem `DealDocumentsSection.tsx`, qui garde son titre (hors
>   onglet) et sa date de document.
> - Backend : mutation `documents.update` (titre trimé non vide, `kind`,
>   `period` — vidée, elle est supprimée par le `patch`). Un changement de
>   titre **ou** de type replanifie `vectorize.indexDocument` : le titre et le
>   type nourrissent l'index sémantique (ligne d'en-tête + `filterValues`),
>   sinon l'assistant continuerait à chercher sous l'ancien nom.
> - i18n : clés `filter.*`, `editDialogTitle`, `updated`, `addedOn` +
>   namespace `documentAttachment` (fr/en) ; retrait des clés devenues
>   orphelines (`reportings.col.*`, `reportings.group.*`,
>   `dealDocuments.col.*`, `documentReading.column`, les deux `download`).

## v1.151.0 — 30/07/2026 à 11:30 — Le statut d'un deal se lit à la même couleur partout

Sur la fiche société, le tableau des deals affichait deux repères de statut à
la fois : un petit liseré coloré dans la marge de chaque ligne, et un badge.
Le liseré n'existait nulle part ailleurs dans l'application, et sa couleur ne
disait pas la même chose que celle du badge — il disparaît.

Reste **un seul badge**, désormais coloré comme les bandeaux de la liste des
participations : **ambre** pour un term sheet en cours, **bleu** pour une
position ouverte (deal actif), **vert** pour un Exit win, **rouge** pour un
Exit loss. En teinte claire, lisible d'un coup d'œil, ce qui aide surtout
quand une société porte plusieurs deals à des stades différents.

Cette même palette s'applique maintenant partout où le statut d'un deal
s'affiche — fiche deal et liste des deals comprises : un deal actif y était
gris neutre, il est bleu comme ailleurs. Seul cas encore gris : une sortie
dont le multiple n'est pas calculable (aucun capital décaissé), qui n'est ni
une victoire ni une perte.

> **🔧 Notes techniques**
>
> - `src/lib/dealStatusBadge.ts` : nouvelle fonction `dealBucket(status, moic)`
>   qui range un deal dans l'un des quatre buckets `ParticipationBucket`
>   (`pending` / `active` / `exit_win` / `exit_loss`, `null` si le MOIC d'une
>   sortie n'est pas calculable) — même arbre de décision que le découpage
>   par société de `ParticipationsView`. `dealStatusBadge()` en dérive
>   directement sa teinte via la table `BUCKET_TINT` (`border-X/40 bg-X/10
text-X` sur les tokens `warning` / `info` / `positive` / `destructive`),
>   donc plus de règle « signal-only » : l'actif passe de `secondary` neutre à
>   bleu, et le TS d'un ambre plein à un ambre teinté.
> - `dealStatusAccent()` supprimée : elle n'avait qu'un appelant, le liseré de
>   `CompanyDealsTable.tsx`, retiré ici (avec la cellule `relative` et
>   l'import `cn` devenus inutiles).
> - Signature de `dealStatusBadge()` inchangée → les autres appelants
>   (`deals.$dealId.tsx`, `DealsListView.tsx`) héritent de la nouvelle palette
>   sans modification. Les libellés restent servis par `dealStatusLabelKey()`
>   et les clés i18n `participations:status.*` existantes.
> - Docs mises à jour : `TESTING.md` (SH17, FE1b), `docs/produit/04` et `05`,
>   et la puce anti-pattern de `CLAUDE.md` qui décrivait l'ancienne règle
>   « la couleur ne porte que l'exit ».

---

## v1.150.3 — 30/07/2026 à 10:19 — Des tests de régression gardent les fondations

Mise à jour purement technique : une suite de tests automatiques vérifie
désormais, à chaque modification du code, que les protections fondamentales
de l'application tiennent toujours — l'étanchéité entre les véhicules
d'investissement (un membre d'une organisation ne peut jamais voir ni
modifier les données d'une autre), les rôles, les règles de création des
deals, le pointage des transactions, le prévisionnel de trésorerie, le
passif et la vue agrégée. Si une future évolution casse silencieusement
l'une de ces garanties, la mise en production est bloquée automatiquement.

> **🔧 Notes techniques**
>
> - Suite de régression `convex-test` + vitest (`pnpm test:convex`, branchée
>   dans le job CI `check`) : 35 tests dans `convex/regression.*.test.ts`,
>   backend Convex en mémoire, zéro réseau, zéro déploiement.
> - Harness partagé `convex/regression.setup.ts` : enregistre le composant
>   Better Auth via `@convex-dev/better-auth/test`, seed `user`/`session`
>   du composant + ligne `users` applicative, identité
>   `withIdentity({ subject, sessionId })` — le vrai `requireAppUser` /
>   `requireOrgMember` s'exécute, aucun mock.
> - Couverture : multi-tenant (`not_a_member`, accès anonyme), rôles
>   (`insufficient_role`, `owner_only`), deals (`siren_already_used`,
>   `assertInvestorIsGroupEntity`, idempotence `attioSync.upsertFromDeal`),
>   pointage (`applyMatchToDeal`/`applyUnmatch` + `matchingDecisions`
>   append-only), forecasts (`expandRules` idempotent, `getForecastGrid`,
>   `markEntryRealized` close/keepRemainder), passif
>   (`getLiabilities` : soldes C/C dérivés, allocations), `aggregate.listDeals`.
> - Les fichiers vivent dans `convex/` sans être déployés : le CLI Convex
>   ignore tout module dont le nom contient plus d'un point (cf.
>   `KNOWN_ISSUES.md`). Aucun code métier modifié.

## v1.150.2 — 30/07/2026 à 10:28 — Ménage : organisations parasites et commande de rattrapage

Deux corvées d'entretien, invisibles dans l'app au quotidien.

La liste des organisations contenait **deux espaces créés par des comptes
inconnus** en juin. Ils ne voyaient rien de CALTE ni d'Albo Club — chaque
organisation est étanche — mais ils polluaient la liste. Un outil permet
maintenant de les inspecter (qui en est membre, ce qu'ils contiennent) puis de
les supprimer, avec deux garde-fous : impossible de supprimer CALTE ou Albo
Club, impossible de supprimer un espace qui contient encore des données.

Et la commande de rattrapage des transactions accepte désormais le nom court
d'une organisation (« calte ») au lieu de son identifiant technique, comme
toutes les autres commandes d'administration.

> **🔧 Notes techniques**
>
> - `convex/migrations/purgeStrayOrgs.ts` : `inspect` (internalQuery, lecture
>   seule) rend les membres avec leur compte user (email, date, autres orgs) et
>   le compte de lignes de chaque table scopée org ; `apply` (internalMutation)
>   supprime invitations + membres + org + logo. Gardes : `PROTECTED_SLUGS`
>   (`calte`, `albo`) et `org_not_empty:<slug>:<table=n>`. Les tables filles
>   (`valuations`, `kpiSnapshots`, `transactions`…) sont couvertes
>   transitivement par leur parent. Les comptes users ne sont PAS supprimés —
>   décision séparée côté Better Auth (`users:cascadeDelete`).
> - `powens:backfillConnection` : `orgId` et `orgSlug` désormais tous deux
>   optionnels au validateur, garde `org_id_or_slug_required` dans le handler,
>   résolution par la nouvelle `powens:orgIdBySlug`. L'appel schedulé depuis
>   `upsertConnectionStatus` passe toujours l'id.

---

## v1.150.1 — 30/07/2026 à 10:20 — Un détecteur de code mort, lançable à la demande

Mise à jour purement technique : un détecteur de code inutilisé (fichiers,
briques et dépendances que plus rien ne référence) est désormais disponible
en une commande. Un premier audit a dressé la liste des candidats au
nettoyage — rien n'est supprimé à ce stade, la purge sera validée
séparément.

> **🔧 Notes techniques**
>
> - `knip` (v6) installé en devDependency, configuré via `knip.jsonc` :
>   entrées pour les routes TanStack Start (`src/routes/**`, référencées via
>   `routeTree.gen.ts`), les fonctions Convex (`convex/*.ts` +
>   `convex/migrations/*`, référencées via les proxys générés
>   `api.*`/`internal.*`), les scripts et les tests. Ignorés :
>   `convex/_generated/`, le vendoré (`src/components/ai-elements/`) et
>   `src/components/ui/` (shadcn, audité à part). `tailwindcss` /
>   `tw-animate-css` en `ignoreDependencies` (imports CSS non suivis par
>   knip).
> - Script `pnpm deadcode`, **hors CI volontairement** : une croix rouge
>   permanente sur chaque PR (le repo n'est pas encore propre) coûte plus
>   qu'elle n'apporte. Brancher un job bloquant une fois la purge faite.
> - Rapport d'audit complet (candidats classés sûr / douteux) dans la
>   description de la PR. Aucune suppression dans cette PR.
> - `TESTING.md` B10 et `TEMPLATE_SYNC.md` (candidat template) mis à jour.

## v1.150.0 — 30/07/2026 à 10:05 — L'app est surveillée tous les matins

Chaque matin à 7h, une vérification automatique s'assure que l'application
en production répond correctement : pages publiques accessibles, connexion
opérationnelle, protections de sécurité en place. Si quelque chose casse,
une alerte est créée automatiquement sur GitHub avec le détail de ce qui ne
répond plus — plus besoin de découvrir une panne en tombant dessus par
hasard. Tant que le problème n'est pas résolu, les échecs suivants
s'ajoutent à la même alerte au lieu d'en créer de nouvelles.

> **🔧 Notes techniques**
>
> - Nouveau workflow `.github/workflows/prod-smoke.yml` : cron quotidien
>   05:00 UTC (7h Paris en été) + `workflow_dispatch`, qui rejoue le smoke
>   existant `scripts/e2e-smoke.mjs --url $PROD_URL` contre la prod
>   (21 checks non authentifiés : pages publiques, headers de sécurité,
>   santé du proxy Better Auth, forme du HTML SSR). Aucun changement du
>   script ni du code applicatif.
> - L'URL de prod vient de la **variable de repo** GitHub `PROD_URL`
>   (Settings → Secrets and variables → Actions → Variables) — pas de
>   secret ni d'URL en dur ; échec explicite si elle manque.
> - En échec, `actions/github-script` ouvre une issue labellisée
>   `prod-smoke` avec la sortie du smoke (ANSI strippé) ; si une issue
>   `prod-smoke` est déjà ouverte, il la commente au lieu d'en rouvrir une.

## v1.149.1 — 29/07/2026 à 21:45 — La doc produit se recopie toute seule dans Linear

La documentation produit lisible dans Linear se met désormais à jour
**automatiquement** : dès qu'une mise à jour touchant la doc part en
production, les pages concernées sont recopiées dans le projet Linear
« Albo OS » dans la foulée. Plus de recopie à la main, donc plus de
décalage entre ce que fait l'outil et ce que raconte la doc — le retard
constaté aujourd'hui (une douzaine de jours, une vingtaine d'évolutions)
ne peut plus se reproduire.

Les liens entre pages pointent maintenant vers les documents Linear
correspondants : on navigue dans la doc depuis Linear comme dans le repo.
Rappel utile : le dossier du repo reste la référence, une retouche faite
directement dans Linear sera écrasée à la prochaine mise à jour.

> **🔧 Notes techniques**
>
> - Nouveau `scripts/sync-linear-docs.mjs` : pousse `docs/produit/*.md` dans
>   les documents Linear via `documentUpdate` (GraphQL). Retire le H1,
>   préfixe la bannière « Miroir en lecture », et réécrit les liens
>   relatifs inter-pages vers les URLs Linear (un lien hors dossier perd sa
>   cible et garde son texte). Modes : liste de chemins, `--all`,
>   `--dry-run` (hors-ligne, sans clé).
> - Nouveau workflow `.github/workflows/sync-linear-docs.yml` : sur push
>   `main` touchant `docs/produit/**`, calcule les pages modifiées via
>   `git diff` contre `github.event.before` (repli `HEAD^` si le SHA est
>   nul ou dangling) et les pousse. `workflow_dispatch` repousse tout.
>   Secret `LINEAR_API_KEY`. Pas de `pnpm install` — le script n'utilise que
>   des builtins Node + `fetch`.
> - La map `DOCS` (fichier → id/url du document Linear) est vérifiée dans
>   les deux sens à chaque run : page sans document ou document sans page →
>   exit 2. C'est le garde-fou contre une page ajoutée qui n'atteindrait
>   jamais Linear.
> - La sync suit le `git diff`, **pas** une comparaison de contenu : Linear
>   normalise le markdown à l'écriture (`-` → `*`, `| --- |` → `| -- |`),
>   donc le stocké n'égale jamais l'envoyé — cf. `KNOWN_ISSUES.md`
>   « Miroir Linear de `docs/produit/` ».
> - `CLAUDE.md` q.7 : la consigne « mirror after the PR ships » (jamais
>   applicable — la session de l'agent se termine à l'ouverture de la PR)
>   est remplacée par le fait automatique + le seul geste manuel restant
>   (créer/retirer le document Linear et son entrée `DOCS`).
> - `TESTING.md` B8 et `docs/produit/README.md` mis à jour.

## v1.149.0 — 29/07/2026 à 20:55 — Le contenu de l'enveloppe arrive sur la fiche placement

La fiche d'un placement gagne une section **« Contenu de l'enveloppe »** :
les titres d'un compte-titres, les supports d'un contrat de capitalisation,
les lignes crypto — remontés automatiquement depuis la connexion bancaire
(Powens Wealth). Pour chaque ligne : le support (et son code ISIN), la
quantité, la valeur unitaire, la valorisation et la plus ou moins-value,
avec le total du compte en pied de tableau.

Le geste d'installation est simple : sur la fiche du placement, **lier le
placement à son compte bancaire** (une liste déroulante des comptes de
l'organisation). Une fois lié, les positions se rafraîchissent toutes
seules chaque matin, et un bouton « Actualiser » force la mise à jour à la
demande. On peut délier à tout moment.

⚠️ Ce flux repose sur le produit **Powens Wealth**, distinct de
l'agrégation bancaire déjà en place : il doit être activé auprès de Powens
(Account Manager). Tant qu'il ne l'est pas, la section affiche simplement
« aucune position » — rien ne casse.

> **🔧 Notes techniques**
>
> - Nouvelle table `investmentPositions` (miroir des investissements Powens,
>   remplacement en bloc par compte à chaque sync) + `deals.bankAccountId`
>   optionnel (lien enveloppe, éditable/effaçable via `deals.update`).
> - `convex/investments.ts` : `listByAccount` (query org-scopée),
>   `refresh` (action « Actualiser », erreurs typées
>   `powens_wealth_unavailable` / `powens_no_user`), `syncOrg`/`syncAll`
>   (internal) sur `GET /2.0/users/me/investments`, résolution
>   `id_account` → `bankAccounts.by_powens_account`. Cron quotidien 06:30
>   UTC (no-op tant que le produit Wealth n'est pas activé).
> - Fiche placement (`placements.$dealId.tsx`) : section enveloppe (liaison
>   compte, tableau des positions, total, dernier sync, états vides).
> - Piège d'activation + décisions de design documentés dans
>   `KNOWN_ISSUES.md` § « Positions Powens Wealth ».

## v1.148.0 — 29/07/2026 à 20:30 — Sidebar resserrée : Investissements réunit Entreprises et Placements

La barre latérale passe à quatre entrées : **À faire, Investissements,
Trésorerie, Passif**. Entreprises et Placements ne disparaissent pas — ce
sont désormais les deux **sous-onglets** de la nouvelle section
Investissements, qui s'ouvre sur Entreprises. Deux façons de suivre ses
investissements, un seul endroit : les participations d'un côté, la
trésorerie placée de l'autre, et on bascule de l'une à l'autre en un clic.

La page Placements se structure par **liquidité** : trois sections —
Liquide, Semi-liquide, Non liquide — sur le modèle des tableaux par statut
de la liste Entreprises. Le classement se déduit du type de placement
(compte-titres et crypto en liquide, dépôt à terme en semi-liquide, compte
de capitalisation en non liquide) et se corrige placement par placement :
un DAT à 5 ans peut passer en non liquide.

Un placement s'ouvre maintenant sur sa **fiche placement**, volontairement
légère — un placement est un compte, pas une participation : l'essentiel du
compte en tuiles, la liquidité modifiable, l'**historique du solde** (chaque
mise à jour crée un point daté) et les transactions pointées. Le contenu de
l'enveloppe (les titres d'un compte-titres, les supports d'un contrat de
capitalisation) viendra avec la connexion Powens Wealth.

> **🔧 Notes techniques**
>
> - Sidebar : `nav.ts` remplace les entrées Entreprises + Placements par une
>   entrée `items.investments` → `/participations`, avec `alsoActiveOn:
['/app/$orgSlug/placements']` honoré par `AppSidebar.tsx` ; sous-onglets
>   partagés `src/components/investments/InvestmentsTabs.tsx` (Links stylés
>   TabsTrigger) rendus dans les headers des deux pages.
> - Liquidité : champ optionnel `deals.liquidity`
>   (`liquid`/`semi_liquid`/`illiquid`, validator partagé
>   `convex/lib/instruments.ts`), défaut par type + override via
>   `placementLiquidity()` (`convex/lib/instrumentMapping.ts`) ;
>   `PlacementsView.tsx` regroupe en trois sections à bandeaux
>   (vert/ambre/gris, miroir de `participationBucketBand`).
> - Fiche placement : nouvelle route `placements.$dealId.tsx` (getById +
>   `transactions.listByDeal` + `valuations.list`, XIRR client identique à la
>   liste) ; la ligne de la liste navigue vers cette fiche au lieu de la
>   fiche deal.
> - `pnpm typecheck`, `lint`, `build` verts ; smoke tests non lancés (dev
>   server requis).

## v1.147.2 — 29/07/2026 à 20:35 — Une seule ligne Palatine, connectée

Les mouvements Palatine vivaient dans **deux lignes** : l'ancienne, venue de
l'import Airtable (88 mouvements de 2020 au 20/02/2026, plus jamais mise à
jour), et celle créée par la connexion bancaire en juin. Même compte à la
banque, deux lignes chez nous.

L'opération de fusion les réunit : l'ancienne ligne — celle qui porte
l'historique et vos pointages — récupère les mouvements récents, l'IBAN et la
connexion, puis la ligne en double disparaît. Il reste **un seul compte
courant Palatine, connecté**, avec l'historique complet depuis 2020.

Deux précisions : le second compte courant Palatine (peu actif) et les
comptes de nantissement sont de vrais comptes distincts chez la banque — ils
ne sont pas touchés. Et il subsiste un trou du 21/02 au 08/06 sur ce compte,
antérieur à la connexion : c'est exactement ce que le rattrapage à date
imposée (v1.147.1) sait aller rechercher, une fois la fusion faite.

> **🔧 Notes techniques**
>
> - `convex/migrations/mergePalatineAccount.ts` (`dryRun` / `apply` /
>   `verify`), ancrée sur les `_id` prod lus via
>   `powens:diagnoseOrgAccountLinks`. Sens de fusion : la ligne **importée**
>   survit (elle porte `airtableId`, les transactions et les
>   `matchingDecisions`) et reprend le lien Powens de la ligne acct 35, qui
>   est ensuite supprimée.
> - Sont repointés vers la ligne conservée : `transactions.bankAccountId`,
>   `matchingDecisions.txBankAccountId` (log append-only dont le snapshot ne
>   doit pas pendouiller) et `forecasts.bankAccountId` (table legacy).
>   `bankName` est aligné sur « Palatine » pour que la page Cash cesse
>   d'afficher deux groupes ; `label` n'est pas touché (règle du schéma).
> - Gardes : org calte, même entité titulaire, banque Palatine des deux
>   côtés, survivante importée et non liée, fusionnée liée à Powens et non
>   importée. Idempotente (no-op une fois la ligne fusionnée supprimée).
> - Effet de bord voulu : la survivante gardant son `airtableId`, la borne
>   d'ingestion (`computeCutoff`) repart de sa dernière transaction Airtable
>   (20/02/2026). Le trou 21/02 → 08/06 se comble donc ensuite via
>   `powens:backfillConnection` avec `minDate: "2026-02-21"` — au-dessus du
>   plancher, et sans doublon (idempotence par `powensTxId`).

## v1.147.1 — 29/07/2026 à 20:05 — Réparer un trou de synchro repéré après coup

Le rattrapage livré en v1.147.0 repart de la dernière transaction connue sur
le compte, ce qui couvre le cas normal : au moment où une connexion est
rétablie, ce repère précède encore la période manquante. Mais si le trou
n'est repéré que plus tard, une fois que de nouvelles transactions sont
arrivées, le repère a dépassé la zone à combler — et le rattrapage
l'enjambe.

Il est désormais possible d'imposer une **date de départ** au rattrapage,
pour aller rechercher une période précise indépendamment de ce repère. Le
cas d'usage : un trou découvert des semaines après la reconnexion. La
protection contre les doublons avec l'historique importé reste en place, une
date imposée ne peut pas remonter au-delà.

Opération technique lancée à la main — aucun changement dans l'application.

> **🔧 Notes techniques**
>
> - `convex/powens.ts:backfillConnection` : argument optionnel `minDate`
>   (`YYYY-MM-DD`, validé, sinon `invalid_min_date`). Il remplace le point de
>   reprise pour tous les comptes de la connexion, y compris ceux sans
>   aucune transaction (rien d'où reprendre autrement) ; `computeCutoff`
>   reste le plancher dur. Le log par compte signale « (date imposée) ».
> - Pourquoi : le point de reprise ne vaut qu'à l'instant de la reconnexion
>   (cf. `KNOWN_ISSUES.md` « Rattrapage après reconnexion »). Sur le trou
>   Qonto 02/06 → 22/07, découvert le 29/07 alors que la reconnexion datait
>   du 23/07, le point de reprise était déjà au 28/07.
> - Test `TESTING.md` P16.

---

## v1.147.0 — 29/07/2026 à 16:56 — Une reconnexion bancaire rattrape les transactions manquées

Jusqu'ici, une connexion bancaire coupée puis rétablie repartait **de la date
de reconnexion** : tout ce qui s'était passé entre-temps sur le compte ne
remontait jamais dans Albo OS. Une coupure repérée tardivement se traduisait
donc par un trou définitif dans la trésorerie — et c'est exactement ce qui est
arrivé au compte Qonto, resté muet du 2 juin au 22 juillet 2026, avec près de
2,4 M€ de virements entrants absents du registre.

Désormais, dès qu'une connexion redevient saine, l'application **va chercher
elle-même ce qu'elle a manqué** : elle repart de la dernière transaction
connue sur chaque compte et redemande à la banque tout ce qui s'est produit
depuis. Concrètement, il suffit de reconnecter la banque — le trou se comble
tout seul dans la foulée, sans manipulation.

Trois garanties :

- **Aucune limite d'ancienneté** : une coupure de plusieurs mois est rattrapée
  entièrement, tant que la banque conserve l'historique de son côté.
- **Aucun doublon** : une transaction déjà présente est reconnue et mise à
  jour, jamais recréée.
- **Aucun pointage perdu** : le rapprochement déjà fait sur une transaction
  n'est jamais écrasé par le rattrapage.

Les mouvements récupérés entrent normalement dans la file de pointage et
suivent les règles de catégorisation apprises, comme n'importe quelle
transaction synchronisée.

> **🔧 Notes techniques**
>
> - `convex/powens.ts:backfillConnection` (internalAction) : pull REST
>   `GET /users/me/accounts/{id}/transactions?min_date=…` avec le token
>   permanent de l'org. Point de reprise = dernière tx détenue par compte
>   (`listAccountsForBackfill`, index `by_account_date`) moins
>   `BACKFILL_OVERLAP_MS` (7 j, règlements différés). Pagination via les
>   liens opaques `_links.next.href` (garde-fou `BACKFILL_MAX_PAGES`),
>   try/catch par compte, aucun token dans les logs.
> - Déclenchement dans `upsertConnectionStatus` : santé calculée **avant**
>   le patch, planification (`ctx.scheduler.runAfter(0, …)`) sur la seule
>   transition `≠ connected → connected` (ligne absente incluse). Le report
>   post-commit garantit que les comptes de la connexion sont déjà reliés.
> - Chemin d'écriture mutualisé : la boucle d'insertion de
>   `ingestConnectionSync` est extraite en `writeAccountTransactions`
>   (filtre cutover + dédup `powensTxId` + `ruleFieldsFor` à l'insert),
>   appelée par le webhook **et** par `ingestBackfilledTransactions` — les
>   deux chemins ne peuvent plus diverger.
> - S'appuie sur le re-tamponnage de `powensConnectionId` livré en v1.146.0 :
>   sans lui, un compte repris par une nouvelle connexion serait invisible au
>   rattrapage, qui scope par connexion.
> - Pas de plafond de profondeur : il recréerait le bug sur une panne longue
>   (cf. `KNOWN_ISSUES.md` « Rattrapage après reconnexion »). Tests
>   `TESTING.md` P14/P15 ; doc produit `07-tresorerie.md`.

---

## v1.146.0 — 29/07/2026 à 16:37 — Reconnecter une banque ne crée plus de doublon

Jusqu'ici, reconnecter une banque pouvait faire apparaître une **deuxième
fois la même banque** dans la trésorerie : la reconnexion attribue de
nouveaux identifiants aux mêmes comptes, et l'application les prenait pour
des comptes inconnus. L'ancienne ligne cessait de se mettre à jour tout en
continuant d'alerter, sans moyen de faire taire l'alerte.

Désormais, à chaque synchronisation, un compte qui arrive est d'abord
**rapproché des comptes déjà connus** — par IBAN, sinon par banque et
libellé identiques, sinon parce que la banque n'a qu'un seul compte de votre
côté. S'il est reconnu, le lien est simplement repris : même ligne, même
historique, même pointage. Aucun doublon.

Deuxième changement, sur les alertes : une connexion qui ne dessert **aucun
compte** — typiquement le reliquat d'une tentative de connexion abandonnée —
n'est plus considérée comme une panne. Elle n'envoie plus d'e-mail, ne
déclenche plus la bannière, s'affiche en gris « Obsolète », et un bouton
**Supprimer** permet de la retirer définitivement (côté banque comme dans
l'app). Vos comptes et vos transactions ne sont pas touchés.

> **🔧 Notes techniques**
>
> - Nouvelle règle d'identité pure et testée dans `convex/lib/powensAccounts.ts`
>   (`matchExistingAccount`, 12 tests dans `tests/powensAccounts.test.ts`) :
>   IBAN → banque + libellé → compte unique d'une banque à compte unique.
>   Les règles faibles ne volent jamais un compte déjà lié et refusent tout
>   candidat dont l'IBAN contredit le payload ; égalité = `ambiguous`, arrêt
>   dur sans écriture.
> - `resolveAccount` (`convex/powens.ts`) tente ce rapprochement avant de
>   créer un compte ; `linkQonto` disparaît, le cas Qonto devient la règle 3.
>   La branche « déjà lié » re-tamponne désormais `powensConnectionId` : un
>   compte repris par une nouvelle connexion ne reste plus attaché à la
>   morte.
> - Santé : une connexion dégradée ne desservant aucun compte actif passe en
>   `obsolete` dans `listConnections` (et `inactive` côté page Intégrations),
>   sort de la bannière et de `maybeNotifyConnectionHealth`. Action
>   `powens.deleteConnection` (rôle admin, garde `connection_in_use`,
>   `DELETE /users/me/connections/{id}` puis suppression de la ligne de
>   suivi ; 404 côté Powens = ligne supprimée quand même).
> - Diagnostic opérateur `powens:diagnoseOrgAccountLinks` (lecture seule) :
>   IBAN, ids Powens, nb de transactions et bornes de dates par compte, pour
>   distinguer un vrai second compte d'un doublon avant toute fusion.

---

## v1.145.0 — 29/07/2026 à 16:18 — L'assistant lit les reportings et la fiche société

L'assistant sait désormais chercher dans le **contenu** de vos documents et
reports (v1.143.0), mais il ne voyait toujours pas le travail d'analyse fait
par le pipeline : les points clés d'un reporting, ses métriques rangées, et
la synthèse IA d'une société. C'est corrigé.

Il accède maintenant à la liste des reportings d'une participation, au
détail de chacun (points clés + métriques extraites) et à la synthèse d'une
société — score de santé, forces, points de vigilance, alertes. En lecture
seule : les reportings continuent d'arriver par transfert d'email.

La différence avec la recherche par le sens : pour « que dit le reporting
sur le recrutement ? », l'assistant fouille le texte ; pour « quel était le
CA de mars ? », il lit la métrique rangée, exacte. Il choisit tout seul.

Dans la foulée, il connaît aussi la **fiche complète d'une société** :
secteur, pitch, identité légale, personnes, KPIs suivis. Avant, il ne
voyait qu'un nom — il pouvait citer une participation sans savoir ce
qu'elle fait.

Ces nouveautés valent dans l'app (panneau ⌘J) **et** depuis claude.ai via
le connecteur, qui passe de 18 à 22 outils de consultation. Si vous
utilisez le connecteur, déconnectez-le et reconnectez-le une fois pour que
les nouveaux outils apparaissent.

> **🔧 Notes techniques**
>
> - Nouveau fichier de domaine `convex/agentToolsReports.ts` : trois outils
>   de lecture (`listCompanyReports`, `getCompanyReport`,
>   `getCompanyIntelligence`), branchés sur `chatAgent` dans
>   `convex/agent.ts` et miroités dans `convex/mcp/registry.ts` (le MCP
>   n'expose pas `searchDocuments`, qui reste in-app).
> - Internals scopés `actorUserId` (pattern `readMembership`) :
>   `companyReports.listInternal` / `getInternal` et
>   `intelligence.getByCompanyInternal`.
> - `getInternal` ne sert **pas** `rawContent` : ce texte est déjà indexé
>   par la vectorisation (v1.143.0) et se lit via `searchDocuments`. Les
>   deux portes sont documentées dans `KNOWN_ISSUES.md` § « Outils reports
>   vs searchDocuments ».
> - Piège traité : `companyReports.metrics` est une map de nombres nus dont
>   l'unité vit dans `METRIC_CATALOG`. Nouveau helper pur `storageUnitFor`
>   (`convex/lib/metricCatalog.ts`, testé sur les 35 clés) ; `getInternal`
>   renvoie `{key, value, unit}` par métrique, sans quoi le modèle lit
>   86 k€ comme 8,6 M€. Documenté dans `KNOWN_ISSUES.md`.
> - Côté portfolio : `listCompaniesInternal` s'enrichit (secteur, domaine,
>   pitch, groupe, sponsor), nouvel outil `getCompany` pour le détail, et
>   `listCompanyDocuments` expose `reportId` pour chaîner un fichier vers
>   son reporting. Pas d'URL de storage exposée — décision assumée.

---

## v1.144.1 — 29/07/2026 à 10:01 — La vectorisation reste hébergée en Europe

La recherche dans les documents s'appuyait sur le routage automatique
d'OpenRouter, qui pouvait diriger les calculs vers différents hébergeurs
selon la charge. Le traitement est désormais **épinglé sur Nebius Token
Factory**, hébergé aux Pays-Bas : le texte de vos documents ne transite plus
que par cet hébergeur européen, à prix identique.

> **🔧 Notes techniques**
>
> - `convex/vectorize.ts` : routage OpenRouter épinglé sur le provider
>   `nebius` (`provider: { order: ['nebius'], allow_fallbacks: false }`)
>   dans `openrouter.textEmbeddingModel(...)`. Pas de fallback : une panne
>   Nebius fait échouer l'indexation (schedulée, relançable) et la
>   recherche plutôt que d'envoyer le texte ailleurs — choix documenté
>   dans `KNOWN_ISSUES.md` § « Vectorisation documents & reports ».

---

## v1.144.0 — 28/07/2026 à 20:56 — La fiche d'identité reste sous les yeux

Sur une fiche société, le panneau d'identité disparaissait par le haut dès
qu'on descendait dans la page : pour comparer une information d'identité avec
un rapport ou un deal plus bas, il fallait remonter.

Le panneau défile maintenant normalement tant qu'il reste quelque chose à
découvrir dessous, puis **se fige** une fois qu'on est arrivé à son bas. La
colonne du milieu continue de défiler dessous, et le panneau reste visible en
entier. Sur une fiche courte, qui tient déjà dans l'écran, il se fige
directement en haut. Sur mobile et petits écrans, où le panneau passe sous le
contenu, rien ne change.

> **🔧 Notes techniques**
>
> - Nouveau hook `src/hooks/useStickyBottom.ts` + `lg:sticky` sur l'`aside` de
>   `participations.$companyId.tsx`, avec un `top` inline calculé.
> - `position: sticky` + `bottom` **ne fige pas** un panneau plus haut que
>   l'écran : un offset `bottom` ne retient pas une boîte qui remonte, il tire
>   vers le haut une boîte située sous la ligne de flottaison. Mesuré au
>   navigateur avant d'écrire le code. La solution est un `top` **négatif**
>   valant `-(hauteurPanneau - hauteurScrollport) - gap` ; le panneau défile
>   puis se fige quand son bas atteint le bas du scrollport.
> - Le calcul dépend de la hauteur rendue → `ResizeObserver` sur le panneau et
>   sur le scrollport (la hauteur bouge quand le résumé/les personnes se
>   chargent, ou quand le panneau IA s'ouvre).
> - Le scroll de l'app n'est pas celui de la fenêtre (shell `h-svh
overflow-hidden`, défilement dans un `div overflow-y-auto`), d'où la
>   remontée d'ancêtres `scrollParent()` au lieu de `window.innerHeight`.
> - Panneau plus court que l'écran → repli sur un `top` positif, sinon il
>   serait figé en bas avec un blanc au-dessus.
> - Détail complet du piège dans `KNOWN_ISSUES.md`.

## v1.143.0 — 28/07/2026 à 20:19 — L'assistant sait chercher dans vos documents et reports

La lecture automatique des documents (arrivée avec la v1.142.0) trouve son
prolongement : l'assistant peut désormais **chercher dans le contenu** de
tout ce qui a été lu. Posez la question en langage naturel — « que dit le
pacte de Sezame sur la clause de liquidité ? », « quelles boîtes du
portefeuille ont parlé de difficultés de recrutement ? » — et il retrouve
les passages pertinents dans les pactes, term sheets, BP, documents
juridiques et reportings de l'organisation, ainsi que dans les reports
investisseurs reçus par email, puis répond en citant ses sources.

La recherche se fait **par le sens**, pas par mots-clés : une question sur
les « problèmes de trésorerie » retrouve un passage qui parle de « runway
réduit à 4 mois ». Elle fonctionne en français comme en anglais, et reste
strictement cloisonnée par organisation.

Chaque document dont la lecture aboutit est indexé automatiquement — rien à
faire de votre côté. Les documents et reports déjà présents seront indexés
en une passe à l'activation (les anciens documents jamais lus passeront
d'abord par la lecture automatique).

> **🔧 Notes techniques**
>
> - Nouveau composant `@convex-dev/rag` (`convex/convex.config.ts`) —
>   embeddings `qwen/qwen3-embedding-8b` via OpenRouter (même clé que le
>   chat, provider hébergé UE), dimension 4096, **un namespace par org**,
>   clés idempotentes `doc:<id>` / `report:<id>`.
> - `convex/vectorize.ts` : instance RAG, indexation
>   `indexDocument`/`indexReport` (texte lu depuis `documentTexts` — zéro
>   OCR en propre, l'extraction reste à `documentsExtract.ts` qui schedule
>   l'indexation en fin de run), suppression `removeEntry` (schedulée par
>   `documents:remove` et le cascade `deals:remove`), recherche
>   `searchInternal` (re-check membership), backfill
>   `backfillAll`/`backfillOrg` (cf. `MIGRATIONS.md` — les documents
>   uploadés sans état de lecture sont d'abord envoyés à l'extraction).
> - Reports : indexation schedulée en fin de `reportStore:storeForCompany`
>   (le re-import d'une période remplace l'entrée, aligné sur la dedup).
>   Les documents issus d'email ne sont pas indexés individuellement (déjà
>   couverts par l'entrée du report).
> - Nouvel outil d'agent `searchDocuments`
>   (`convex/agentToolsDocuments.ts`, lecture seule) branché dans
>   `convex/agent.ts` + consigne dans `convex/lib/instructions.ts`.
> - `convex/_generated/api.d.ts` édité à la main (lignes mécaniques
>   `rag` + nouveaux modules — convention KNOWN_ISSUES « Codegen Convex
>   hors-ligne ») ; le prochain `convex deploy` régénère à l'identique.
> - Docs : section `KNOWN_ISSUES.md` « Vectorisation documents & reports »
>   (bascule de modèle = namespace neuf + backfill), ligne `MIGRATIONS.md`,
>   scénario `TESTING.md` C35, page produit assistant, ligne
>   `TEMPLATE_SYNC.md`.

---

## v1.142.1 — 28/07/2026 à 18:29 — Correctif : le déploiement de la lecture des documents

La mise en ligne de la lecture automatique des documents a échoué au
déploiement : un ancien champ, que plus aucun code n'utilise mais que
certains documents portent encore en base, avait été retiré. La base a
refusé la mise à jour, et rien n'est parti en production.

Le champ est remis en place — aucun changement visible côté produit, la
fonctionnalité de lecture part maintenant normalement. Le nettoyage de ces
anciennes données est planifié à part, en récupérant leur texte plutôt qu'en
le jetant : ces documents s'afficheront comme déjà lus, sans repasser à
l'OCR.

> **🔧 Notes techniques**
>
> - `documents.extractedText` a été retiré du schéma en v1.141.0 sur la foi
>   d'un grep (aucune écriture dans le repo, aucune lecture). Des lignes de
>   prod le portent quand même — écrit hors du repo, avant `documentTexts`.
>   `convex deploy` a rejeté le push : « Object contains extra field
>   `extractedText` that is not in the validator ».
> - Le champ est restauré (`v.optional(v.string())`), commenté comme legacy.
>   Aucun autre changement : la lecture des documents est inchangée.
> - Leçon consignée dans `KNOWN_ISSUES.md` : un grep dit qu'aucun code
>   **actuel** n'écrit un champ, pas qu'aucune **donnée** ne le porte.
> - Chantier de retrait (reprise du texte vers `documentTexts` + purge, puis
>   resserrage du schéma) documenté dans `MIGRATIONS.md`.

## v1.142.0 — 28/07/2026 à 18:18 — La fiche d'identité d'une société est enfin lisible

Le panneau d'identité, à droite de la fiche société, empilait quatre blocs de
même poids dans un cadre blanc : rien n'accrochait l'œil, et trois détails le
rendaient franchement désagréable à lire. Les libellés longs — « Nb d'actions
consolidé », « Détention globale (%) » — passaient à la ligne et cassaient
l'alignement des valeurs entre les deux colonnes. Le résumé de la société
était justifié, ce qui creusait de larges blancs entre les mots dans une
colonne aussi étroite. Et rien ne distinguait une section d'une autre.

Le panneau reprend désormais le style de la synthèse IA : une carte, et
chaque section introduite par une petite pastille carrée avec son icône.
Les champs se lisent en lignes — libellé à gauche, valeur à droite, un filet
fin entre chaque — si bien qu'aucun libellé ne passe plus à la ligne et que
les chiffres s'alignent enfin verticalement. Le résumé devient une section à
part entière, aligné à gauche. Fondateurs, board et co-investisseurs
s'affichent en pastilles avec leurs initiales, chaque section portant son
compteur.

Rien ne change côté saisie : secteur, SIREN et domaine s'éditent toujours
d'un clic sur la valeur, et les champs vides gardent leur tiret.

> **🔧 Notes techniques**
>
> - `EntityFiche.tsx` : `IdentityField` passe d'une pile libellé/valeur à une
>   ligne `flex justify-between` avec `border-b` + `last:border-b-0` — c'est
>   ce qui règle le retour à la ligne des libellés longs dans les 320 px du
>   panneau. `IdentitySection` accepte deux props optionnelles, `icon`
>   (pastille carrée 22 px) et `count` (badge), toutes deux opt-in pour que la
>   section « Deals » de la colonne principale reste inchangée. `PeopleList`
>   rend des pastilles arrondies avec initiales (helper local
>   `personInitials`) ; les branches LinkedIn/mail, toujours inertes, sont
>   conservées telles quelles.
> - `src/components/ui/inline-field.tsx` : nouvelle prop
>   `layout: 'stacked' | 'row'`, défaut `stacked` — la fiche deal
>   (`InstrumentBlock.tsx`) n'est donc pas touchée. Le bouton de repos est
>   extrait dans une variable partagée par les deux layouts, l'édition est
>   identique dans les deux cas.
> - `participations.$companyId.tsx` : l'`aside` passe en
>   `bg-card rounded-xl` (parité visuelle avec `CompanyAiSynthesisBlock`), la
>   grille `grid-cols-2` devient une pile de lignes, et le résumé sort du bloc
>   Identité pour devenir sa propre `IdentitySection` — sans `text-justify`.
>   Icônes lucide : `IdCard`, `AlignLeft`, `User`, `Users`, `Handshake`.
> - Aucune nouvelle clé i18n : les libellés existants sont réutilisés tels
>   quels, y compris `identity.summary` promu en titre de section.

## v1.141.0 — 28/07/2026 à 18:07 — Documents : voir ce que la machine a lu

Jusqu'ici, savoir si un document avait bien été déchiffré supposait de
retrouver le récap reçu dans le fil du mail — et pour un fichier déposé à la
main, la question n'avait même pas de réponse : il n'était pas lu du tout.

Deux changements, sur l'onglet Documents des fiches société **et** sur le
bloc Documents des fiches deal :

- **Tout document déposé à la main est désormais lu automatiquement**, comme
  ceux qui arrivent par un report transféré : PDF et images par OCR, Excel et
  CSV cellule par cellule.
- **Une colonne « Lecture »** dit, document par document, où ça en est :
  lecture en cours, lu (avec le volume de texte obtenu), échec avec sa cause,
  ou « rien à lire » pour un logo ou un format non géré.

Le volume de texte est cliquable : il ouvre **le texte réellement extrait**.
C'est le geste qui permet de vérifier ce que la machine a lu avant de faire
confiance aux métriques qu'elle en a tirées — quelques centaines de
caractères sur un PDF de trente pages, c'est un scan illisible, pas un
reporting vide.

Le circuit est le même des deux côtés : un term sheet déposé sur un deal est
lu exactement comme un investor update reçu par mail.

Pour un document en échec, ou déposé avant cette mise à jour, un bouton
relance la lecture à la demande. Les causes d'échec sont formulées exactement
comme dans le récap email, pour que les deux surfaces ne racontent jamais
deux histoires différentes.

> **🔧 Notes techniques**
>
> - Nouvelle table `documentTexts` : **une ligne par blob de storage**, pas
>   par document. Le texte reste hors de `documents` parce que Convex lit la
>   ligne entière — `documents:listByCompany` charge 200 lignes à chaque
>   affichage. Clé sur `storageId` → le fan-out multi-org du pipeline report
>   partage une seule extraction. Détail complet dans `KNOWN_ISSUES.md`.
> - `documents` gagne `ocrState` / `ocrDetail` / `ocrChars` (petits, lus avec
>   la liste) ; le champ mort `extractedText` (déclaré, jamais écrit) est
>   retiré. `ocrDetail` réutilise le **vocabulaire de codes** de
>   `inboundEmails.sources[].detail`.
> - `convex/documentsExtract.ts` : action interne planifiée par
>   `documents:create`, même routeur « monde clos » que `reportExtract`
>   réduit à un fichier. Elle adopte le texte déjà présent pour un blob au
>   lieu de relancer un OCR — c'est ce qui évite de payer Mistral deux fois
>   sur les pièces jointes des reports.
> - `convex/lib/fileText.ts` : seuils de classification et budget de texte
>   (`MAX_DOCUMENT_CHARS` = 900 000, ~350 pages) partagés par les deux
>   chemins d'extraction, pour qu'ils ne dérivent pas.
> - `reportExtract` persiste désormais le texte **par pièce jointe** (en plus
>   du texte combiné) ; `reportStore` recopie l'état du routeur sur chaque
>   ligne `documents` créée.
> - Front : `src/components/documents/DocumentReading.tsx` (`OcrStatus` +
>   `ExtractedTextDialog`) partagé par `ReportingsSection` et
>   `DealDocumentsSection` ; requête `documents:getExtractedText` chargée
>   uniquement à l'ouverture (`'skip'` sinon), mutation `documents:reextract`.
>   Clés i18n sous `participations:documentReading.*`.
> - `deals:remove` supprimait le blob d'un document de deal sans passer par
>   `documents:remove` : sa ligne `documentTexts` serait restée orpheline.
>   Helper `convex/lib/documentTexts.ts` appelé aux deux endroits.

## v1.140.0 — 28/07/2026 à 14:57 — Les documents d'une société se rangent en juridique et en reporting

Sur la fiche d'une société, l'onglet **Documents** mélangeait deux familles
qui n'ont rien à voir : ce que la boîte nous envoie (reportings, business
plans) et ce qui engage l'entité (statuts, pactes, KBIS…). Ils sont
maintenant séparés en blocs repliables — **Reporting & suivi**, **Juridique
& légal**, et **Autres** — chacun avec son nombre de documents dans le
titre. Tout est déplié à l'ouverture : on replie ce qu'on ne veut pas voir,
rien n'est masqué par surprise. Un bloc sans document ne s'affiche pas.

Rien ne change à l'ajout d'un document (les types proposés sont les mêmes),
ni sur la fiche d'un deal, où la question ne se pose pas : on n'y trouve que
des documents liés à l'investissement.

> **🔧 Notes techniques**
>
> - `src/components/companies/ReportingsSection.tsx` : le tableau plat est
>   remplacé par une liste de groupes `Collapsible` (`ui/collapsible`),
>   pilotés par une constante `GROUPS` (`reporting` = `reporting` + `bp`,
>   `legal` = `legal`, `other` = tout le reste, y compris les kinds deal que
>   le schéma accepte aussi). Le rendu d'un groupe est extrait dans un
>   composant local `DocumentGroup` (ouvert par défaut) ; un groupe vide
>   n'est pas rendu, l'état vide global est inchangé.
> - `src/locales/{fr,en}/participations.json` : nouvelles clés
>   `reportings.group.{reporting,legal,other}`.
> - Aucun changement de modèle ni de migration : les quatre `kind` existent
>   déjà en base, seul le regroupement d'affichage est nouveau.
> - `DealDocumentsSection` n'est pas touché.

---

## v1.139.2 — 28/07/2026 à 09:35 — Les onglets Reports / Documents adoptent le style du reste de l'app

Sur la fiche d'une participation, les onglets **Reports** et **Documents**
étaient les seuls de l'app à s'afficher en texte souligné. Ils prennent
désormais la même forme que partout ailleurs — notamment la barre de la
page Cash (Vue d'ensemble / Prévisionnel / Transactions / Règles &
échéances) : des pastilles dans un bandeau gris, l'onglet actif en blanc.
Rien ne change dans le contenu des deux onglets.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/participations.$companyId.tsx` : la `TabsList`
>   de la zone reporting passe de `variant="line"` au variant par défaut
>   (pastilles), identique à `cash.index.tsx`.
> - C'était le seul usage de `variant="line"` du repo ; le variant reste
>   défini dans `src/components/ui/tabs.tsx` et disponible si besoin.

---

## v1.139.1 — 27/07/2026 à 23:25 — Les badges de secteur tiennent tous sur une ligne

Dans la liste Entreprises, le secteur « Marketplace / E-commerce » était le
seul libellé trop long pour sa colonne : sa pastille passait sur deux lignes
et dépassait en hauteur toutes les autres, ce qui donnait une colonne
irrégulière. Le libellé devient simplement **« Marketplace »** et tous les
badges de secteur s'alignent désormais sur une seule ligne, à la même
hauteur.

> **🔧 Notes techniques**
>
> - `src/locales/{fr,en}/participations.json` : clé `sectors.marketplace`
>   raccourcie en « Marketplace » (le seul libellé qui débordait — mesuré à
>   143 px pour ~126 px de texte disponible dans le badge, police de
>   fallback Arial/Liberation Sans 12 px ; les trois suivants —
>   « Fonds / Private equity » 116 px, « Consumer / Marques » 112 px,
>   « Industrie / DeepTech » 111 px — tenaient déjà).
> - `ParticipationsTable.tsx` : le badge de secteur perd
>   `whitespace-normal text-center` et revient au `whitespace-nowrap` natif
>   du composant `Badge`. Largeur de colonne `COL_WIDTHS.sector` inchangée
>   (160 px) ; son commentaire, qui annonçait à tort quatre libellés sur
>   deux lignes, est corrigé.
> - `TESTING.md` SH19c mis à jour : le scénario pointe désormais
>   « Fonds / Private equity » (nouveau libellé le plus long) et attend des
>   badges tous sur une ligne.

---

## v1.139.0 — 27/07/2026 à 23:02 — Les documents d'un deal se rangent sur le deal

La fiche deal a enfin son bloc **Documents**, juste sous les Transactions —
là où il n'y avait qu'un encart « à venir ». On y dépose la term sheet, le
pacte ou les statuts, le bulletin de souscription, une attestation ou un
KBIS, et tout le reste sous « Autre ».

Chaque document se dépose en un clic (**20 Mo maximum**) : on lui donne un
titre, un type et, si c'est utile, sa **date** — la date de signature par
exemple, mais elle reste facultative. Le tableau liste ensuite titre, type,
date, taille et date d'ajout ; chaque ligne se télécharge ou se supprime,
avec une confirmation avant l'effacement définitif.

Le rangement est volontairement étanche : un document déposé sur un deal
**n'apparaît que là**, jamais dans l'onglet Documents de la société — qui
reste réservé à ce qui concerne l'entreprise elle-même (reportings,
business plan, juridique). L'assistant applique la même règle quand on lui
demande les documents d'une société. Conséquence à garder en tête :
**supprimer un deal supprime aussi ses documents**, fichiers compris.

> **🔧 Notes techniques**
>
> - Pas de nouvelle table : la table `documents` existante gagne un
>   `dealId: v.optional(v.id('deals'))` + index `by_deal`, et son union
>   `kind` s'élargit de `term_sheet` / `pacte` / `subscription` /
>   `attestation` (les types société restent). Champ optionnel additif →
>   **aucune migration**. `companyId` reste rempli (la cible du deal), donc
>   le scoping org et `by_company` continuent de marcher pour les deux
>   familles ; `period` sert de « date du document » côté deal.
> - `convex/documents.ts` : nouvelle query `listByDeal` ; `create` accepte
>   un `dealId` optionnel et vérifie que le deal existe, est dans la même
>   org et cible bien la société sous laquelle le doc est classé.
>   `listByCompany` **filtre les lignes portant un `dealId`** — c'est ce
>   filtre qui rend le cloisonnement effectif (même filtre dans
>   `convex/agentTools.ts:listCompanyDocumentsInternal` pour l'assistant).
> - `convex/deals.ts:remove` : suppression en cascade des documents du deal
>   **et** de leurs fichiers (`ctx.storage.delete`), sinon lignes orphelines
>   - storage qui fuit. Le refus sur transactions rapprochées est inchangé.
> - Front : `src/components/deals/DealDocumentsSection.tsx` (calqué sur
>   `ReportingsSection`), branché dans
>   `src/routes/app/$orgSlug/deals.$dealId.tsx` à la place du placeholder,
>   après les Transactions. i18n : bloc `participations:dealDocuments.*`
>   (fr + en), clés `fiche.documents.*` obsolètes retirées.
> - `TESTING.md` : FD9 recalé (le bloc n'est plus un placeholder) + FD41
>   (upload / 20 Mo / download / suppression) et FD42 (cloisonnement
>   société ↔ deal, cascade à la suppression) ; note sur TP6.
>   `docs/produit/05-deals.md` et `04-participations.md` mis à jour.

## v1.138.1 — 27/07/2026 à 23:03 — Une colonne Secteur plus compacte

Sur la liste Entreprises, la colonne **Secteur** était calibrée sur le
libellé le plus long (« Marketplace / E-commerce ») : elle réservait cette
largeur sur **toutes** les lignes, y compris celles où le badge affiche
« Fintech ». Elle est maintenant **plus étroite d'environ 50 px**, au
profit des colonnes de chiffres à sa droite, et les **quatre libellés les
plus longs passent sur deux lignes dans le badge** au lieu d'imposer leur
largeur à la colonne entière. Tous les autres secteurs restent sur une
ligne, et l'alignement des colonnes entre les tableaux (En cours, Actifs,
Exit win, Exit loss) est inchangé.

> **🔧 Notes techniques**
>
> - `src/components/participations/ParticipationsTable.tsx` :
>   `COL_WIDTHS.sector` passe de 208 à 160 px — volontairement en dessous
>   de la largeur du badge le plus long, la grille de colonnes partagée
>   (`table-fixed` + colgroup) restant la référence commune aux trois
>   variantes.
> - Le badge secteur reçoit `whitespace-normal text-center` pour
>   neutraliser le `whitespace-nowrap` par défaut du composant `Badge` et
>   retomber sur deux lignes. Seuls les 4 libellés > ~17 caractères
>   (marketplace, fund, industry, consumer) sont concernés, en FR comme en
>   EN.
> - `TESTING.md` : SH19c recalé (deux lignes attendues sur les longs
>   libellés) et seuils de scroll horizontal de SH19b ramenés à ~1040 px
>   (~1144 px en vue agrégée).

---

## v1.138.0 — 27/07/2026 à 22:54 — L'en-tête de la liste Entreprises reste en haut

Sur la liste Entreprises, le bandeau de tête — **titre**, menu `⋯` et la
barre **recherche / Instrument / Secteur** — reste maintenant figé en haut
de l'écran quand on descend dans la liste. Avant, il fallait remonter tout
en haut de la page pour lancer une recherche ou poser un filtre : sur un
portefeuille qui empile quatre tableaux (term sheets, actifs, exit win,
exit loss), ça faisait beaucoup d'allers-retours. Les actions de tri du
portefeuille restent désormais à portée de clic depuis n'importe où dans
la liste.

Même comportement en vue **Toutes les organisations**, où le bandeau figé
emporte le titre et son sous-titre.

> **🔧 Notes techniques**
>
> - `src/components/participations/ParticipationsView.tsx` : le titre et la
>   barre d'outils sont réunis dans un seul conteneur
>   `sticky top-0 -mx-6 px-6 border-b bg-background` — même motif que
>   l'en-tête de la fiche société (`participations.$companyId.tsx`). Le
>   conteneur de scroll est celui du layout org (`app/$orgSlug/route.tsx`).
> - Le titre arrive par une nouvelle prop `header?: ReactNode` plutôt que de
>   rester dans la route : deux éléments `sticky` empilés auraient exigé un
>   offset `top` codé en dur (et différent entre les deux pages, la vue
>   agrégée ayant un sous-titre).
> - `z-40` sur le bandeau, au-dessus des cellules d'en-tête figées des
>   tableaux (`z-30`), sinon celles-ci repassent par-dessus au scroll.
> - Routes adaptées : `app/$orgSlug/participations.index.tsx` (titre + menu
>   `⋯`) et `app/all/participations.tsx` (titre + sous-titre).
> - Docs : ligne SH21 ajoutée à `TESTING.md`, `docs/produit/04-participations.md`
>   complété.

---

## v1.137.2 — 27/07/2026 à 22:50 — Les noms de sociétés ne sont plus coupés

Sur la liste Entreprises, un nom de société trop long pour sa colonne
**passe maintenant sur deux lignes** au lieu d'être coupé avec « … » dès la
première — « La Vie de Quartier - Bdv… » redevient lisible en entier. Au
survol, une infobulle affiche toujours le nom complet, et un nom qui
dépasserait même deux lignes se coupe proprement à la fin de la seconde.
Rien d'autre ne bouge : les colonnes restent alignées entre les tableaux
et la colonne Société garde sa largeur.

> **🔧 Notes techniques**
>
> - `src/components/participations/ParticipationsTable.tsx` : le nom dans
>   la cellule Société passe de `truncate` à
>   `line-clamp-2 whitespace-normal break-words` (le `whitespace-nowrap`
>   par défaut des cellules shadcn est neutralisé au niveau du span) +
>   `title` pour l'infobulle. Point F3 de la revue UI, oublié dans la
>   fournée #298.
> - `TESTING.md` SH19b recalé (deux lignes + tooltip au lieu de « … »).

---

## v1.137.1 — 27/07/2026 à 22:38 — Une seule icône pour les Entreprises

Dans le menu de gauche, « Entreprises » s'affichait avec un camembert
alors que la recherche rapide (⌘K) proposait les sociétés avec une icône
d'immeuble. C'est désormais la même icône d'immeuble des deux côtés.

> **🔧 Notes techniques**
>
> - `src/components/app-shell/nav.ts` : l'entrée `items.participations`
>   passe de `PieChart` à `Building2`, dans `getNavGroups()` (vue par-org)
>   comme dans `getAllNavGroups()` (vue agrégée `/app/all`), pour rester
>   cohérente avec le groupe « Entreprises » de `CommandPalette.tsx`.
> - `PieChart` n'était plus utilisé ailleurs : import retiré.

## v1.137.0 — 27/07/2026 à 22:32 — Fiches plus lisibles et export Excel

Une fournée de retouches issues de la revue de l'app, pour rendre les
fiches plus lisibles et les listes plus propres.

**Fiche société.** La box Identité gagne en lisibilité : les libellés
(Secteur, SIREN, Domaine…) passent en petites majuscules discrètes et les
valeurs ressortent davantage. Le **résumé** de la société n'est plus un
texte posé sous la box : il est intégré à la fiche d'identité avec son
propre libellé, en texte justifié. Le **SIREN** s'affiche désormais par
groupes de trois chiffres (552 178 639), comme partout ailleurs. Dans la
**Synthèse IA**, les trois tuiles KPI s'alignent enfin : chiffres,
variations et lignes de contexte tombent sur les mêmes lignes d'une tuile
à l'autre, et la ligne de contexte s'écrit sur deux lignes au lieu d'être
systématiquement coupée par « … ».

**Fiche deal.** La grosse carte « Entité liée » au milieu de la fiche
disparaît (le lien de retour vers la société, en haut de fiche, fait déjà
le travail), ainsi que la section « Reporting & KPIs » qui n'affichait
rien. La vignette de famille d'instrument (« Capital », « Dette »…) est
retirée : elle n'apportait rien de plus que le type déjà affiché.

**Liste Entreprises.** La petite flèche qui apparaissait au survol en bout
de ligne est retirée — le grisé de la ligne suffit. L'**export** propose
désormais **CSV et Excel (.xlsx)**, et il respecte la recherche et les
filtres en cours (sans filtre, tout est exporté comme avant).

> **🔧 Notes techniques**
>
> - Fiche deal : sections « Entité liée » et « Reporting » supprimées de
>   `deals.$dealId.tsx` ; badge archétype et `ARCHETYPE_BADGE` retirés de
>   `InstrumentBlock.tsx` (le mapping `INSTRUMENT_ARCHETYPE` reste, il
>   pilote le layout). Clés i18n `archetype.*`, `fiche.entity.*`,
>   `fiche.reporting.*` purgées.
> - Identité : hiérarchie libellé/valeur unifiée dans `IdentityField`
>   (`EntityFiche.tsx`) et `InlineField` (`ui/inline-field.tsx`) — libellé
>   `text-[11px] uppercase tracking-wide`, valeur `font-medium` ; résumé
>   déplacé dans la section Identité (`participations.$companyId.tsx`).
> - SIREN : nouveau helper pur `formatSiren` (`src/lib/siren.ts` +
>   `tests/siren.test.ts`), appliqué à l'affichage seulement (l'édition
>   garde la valeur brute).
> - Synthèse IA : `KpiTile` passe en subgrid (`grid-rows-subgrid
row-span-4`, placeholders pour tendance/contexte absents) pour aligner
>   les rangées entre tuiles ; contexte en `line-clamp-2` + tooltip.
> - Liste : colonne chevron retirée de `ParticipationsTable.tsx` (colgroup
>   et `colSpan` recalés). Export : `handleExport(format)` dans
>   `ParticipationsView.tsx`, filtre par `companyId` des lignes visibles,
>   XLSX via `write-excel-file` 4.1.1 (import dynamique
>   `write-excel-file/browser`, cellules numériques typées) ; menus mis à
>   jour dans `participations.index.tsx` (deux entrées CSV/Excel).

---

## v1.136.0 — 27/07/2026 à 22:15 — Le score IA reste visible au scroll

Sur la liste Entreprises, le **score IA** reste maintenant figé à l'écran
avec le nom de la société quand on fait défiler le tableau vers la droite.
Avant, seule la colonne Société tenait bon : dès qu'on allait chercher le
TVPI ou le TRI, la note disparaissait et on ne pouvait plus croiser
« qu'est-ce que ça vaut » avec « comment ça va ». Les deux repères de
lecture d'une ligne restent désormais sous les yeux en permanence, sur les
quatre tableaux (term sheets, actifs, exit win, exit loss).

En vue **Toutes les organisations**, la colonne **Org** passe juste après le
score IA : elle serait sinon coincée entre les deux colonnes figées et
mangerait de la place à l'écran sans raison.

> **🔧 Notes techniques**
>
> - `src/components/participations/ParticipationsTable.tsx` : le figeage
>   passe d'une à deux colonnes. Les classes `headCornerClass` /
>   `footCornerClass` / `stickyCellClass` perdent leur `left-0` en dur, le
>   décalage vient de deux objets de style `frozenCompany` (0) et
>   `frozenScore` (`COMPANY_MIN_WIDTH`).
> - L'offset de la 2ᵉ colonne figée est constant par construction : le
>   scroll horizontal ne se déclenche qu'une fois la table à son
>   `min-width` (`fixedWidth + COMPANY_MIN_WIDTH`), où la colonne Société —
>   la seule flexible — est pile à son minimum.
> - La colonne Org (`showOrg`) est déplacée après le score IA dans le
>   `colgroup`, l'en-tête, la ligne et le pied de totaux, pour que les deux
>   colonnes figées restent les deux premières.
> - `SortableHead` accepte une prop `style` (elle porte le `left` de la
>   colonne figée).
> - Docs : ligne SH19 de `TESTING.md` mise à jour, et section « Colonne
>   figée » de `KNOWN_ISSUES.md` complétée sur le cas multi-colonnes.

---

## v1.135.4 — 27/07/2026 à 21:45 — Le secteur remonte avant les chiffres

Sur la liste Entreprises, la colonne **Secteur** passe juste après le score
IA, avant les colonnes de chiffres. Depuis que les quatre tableaux
partagent la même grille, ceux qui n'ont pas toutes les colonnes (les term
sheets surtout, sans Reçu ni multiple) ouvraient un **trou blanc au milieu
du tableau**, entre les montants et le secteur. Les emplacements vides sont
maintenant en **bout de ligne**, où l'œil ne les lit plus comme un trou.

Au passage, les colonnes regroupent ce qui va ensemble : ce qui décrit la
boîte (société, score, secteur) d'abord, ce qui la mesure (deals, montants,
multiples) ensuite.

Le badge de secteur le plus long débordait de trois pixels sur la colonne
voisine : sa colonne a été élargie.

> **🔧 Notes techniques**
>
> - `ParticipationsTable.tsx` : la colonne Secteur passe de l'avant-dernière
>   position à la 3ᵉ (après Score IA), dans le `<colgroup>`, l'en-tête, le
>   corps et le pied. Aucun contenu de cellule ne change.
> - `COL_WIDTHS.sector` 192 → 208 px : « Marketplace / E-commerce » mesure
>   195 px, il débordait donc — sans ellipse, les cellules étant
>   `whitespace-nowrap` sans clamp. `COL_WIDTHS.amount` 144 → 152 px (1 px
>   de marge seulement sur l'en-tête « Montant investi »).
>   `COMPANY_MIN_WIDTH` 256 → 240 px pour compenser : le seuil de scroll
>   horizontal ne bouge quasiment pas (~1128 px, ~1232 px en vue agrégée).
> - Largeurs re-mesurées dans Chromium **sans clamp** sur la sonde : le
>   `max-width:100%` de la vérification précédente écrasait `scrollWidth` et
>   masquait justement ce type de débordement. Chaque colonne garde ≥ 4 px
>   de marge, mesurée avec la police de **repli** de la stack (Inter est
>   plus étroite, donc c'est le pire cas).
> - TESTING.md (SH19/SH19b) et `docs/produit/04-participations.md` alignés.

---

## v1.135.3 — 27/07/2026 à 20:24 — Colonnes alignées sur la liste Entreprises

Sur la liste Entreprises, les quatre tableaux (En cours, Actifs, Exit win,
Exit loss) partagent désormais **la même grille de colonnes**. Chaque
colonne tombe exactement au même endroit d'un tableau à l'autre : le
« Montant investi » des Actifs est pile au-dessus de celui des Exit win,
« Secteur » et la flèche de fin de ligne sont alignés partout. Avant,
chaque tableau calculait ses largeurs à partir de son propre contenu, d'où
des colonnes en escalier d'une section à l'autre.

Un tableau qui n'a pas une colonne **laisse sa place vide** au lieu de
décaler les suivantes — le tableau des term sheets a donc des colonnes
blanches à droite, et celui des Actifs laisse vide l'emplacement du TRI.
Seule la colonne « Société » s'étire avec la fenêtre ; un nom trop long se
coupe avec « … » plutôt que d'élargir la colonne.

> **🔧 Notes techniques**
>
> - `ParticipationsTable.tsx` : passage en `table-fixed` + `<colgroup>`
>   partagé, largeurs déclarées dans `COL_WIDTHS` (org, aiScore, deals,
>   amount ×2, ratio ×2, sector, chevron) ; la colonne Société n'a pas de
>   largeur et absorbe le reste, avec un `minWidth` = somme des largeurs
>   fixes + `COMPANY_MIN_WIDTH` en dessous duquel la table scrolle
>   horizontalement (colonne figée déjà en place).
> - Les trois variantes (`pending` / `active` / `settled`) rendent
>   maintenant **le même nombre de cellules** dans le même ordre : les
>   emplacements sans contenu sont des `TableHead` / `TableCell` vides au
>   lieu d'être omis (en-tête, corps et pied). `colSpan` devient constant
>   (9 + org).
> - Nom de société en `truncate` (+ `min-w-0` sur le flex parent) : en
>   largeur fixe, il ne peut plus pousser la colonne.
> - Alignement et absence de débordement vérifiés dans Chromium sur les
>   trois variantes (positions x identiques, aucune cellule ne dépasse sa
>   largeur, en-tête le plus long et badge secteur le plus long inclus).
> - TESTING.md : SH19 ajusté + nouveau cas **SH19b** (alignement
>   inter-tableaux) ; `docs/produit/04-participations.md` mis à jour.

---

## v1.135.2 — 27/07/2026 à 20:07 — La ligne de titres des tableaux se détache

Dans les tableaux de participations, la ligne des titres de colonnes
(« Société », « Score IA », « Montant investi »…) avait le même fond blanc
que les lignes de sociétés en dessous : rien ne la démarquait, et l'œil ne
voyait plus où commençait la liste. Elle prend désormais le **même fond
gris que la ligne de totaux** en bas du tableau. La liste est encadrée par
ses deux lignes de repère, et chaque participation se distingue mieux.

> **🔧 Notes techniques**
>
> - `ParticipationsTable.tsx` : `headCornerClass` / `headCellClass` passent
>   de `bg-background` à `bg-muted`, en miroir de `footCornerClass` /
>   `footCellClass`. Fond opaque conservé (obligatoire : les cellules sont
>   `sticky` et les colonnes défilent dessous).
> - Aucun changement de structure ni de layout — les trois variantes du
>   tableau (actif / en cours / sorties) en héritent d'office.

---

## v1.135.1 — 27/07/2026 à 19:37 — « Actifs », et des compteurs en deals

Le tableau des participations actives s'appelle désormais **« Actifs »**
(et non « Actives »), et le compteur de chaque bandeau compte maintenant
les **deals** — la même unité et le même nombre que la ligne de totaux du
tableau (« Actifs (48 deals) »). Il comptait les lignes (sociétés), d'où
un « 44 » en haut face à un « 48 deals » en bas qui semblait incohérent.

> **🔧 Notes techniques**
>
> - Bandeau (`ParticipationsView.tsx`) : compteur = somme des `dealCount`
>   des lignes du bucket, rendu via la clé existante `dealsCount` ;
>   `sections.active` renommé « Actifs » (fr).
> - TESTING.md (SH19/SH20) et `docs/produit/04-participations.md` alignés.

## v1.135.0 — 27/07/2026 à 19:21 — Un tableau par statut dans la liste des entreprises

Le liseré coloré dans la marge des lignes n'était pas assez lisible : il
disparaît, remplacé par un découpage de la liste en **un tableau par
statut**, chacun coiffé d'un bandeau teinté (pastille, titre, compteur) :

- **En cours (term sheet)** en ambre, tout en haut — et affiché uniquement
  s'il y a des term sheets en cours. Ses colonnes montrent l'**engagé
  prévisionnel** (rien n'est encore décaissé).
- **Actives** en bleu : toutes les entreprises avec des deals actifs.
- **Exit win** en vert et **Exit loss** en rouge, chacun avec MOIC et TRI.

Chaque tableau garde sa **ligne de totaux** : la somme des exits gagnants
et celle des pertes se lisent maintenant directement. La recherche et les
filtres restent uniques en haut et s'appliquent à tous les tableaux ; le
filtre « statut » disparaît, devenu redondant. Une société avec un term
sheet **et** des deals actifs apparaît dans les deux tableaux, avec des
sommes exactes de chaque côté.

Sur la **fiche société**, le tableau des deals garde son **liseré coloré**
dans la marge (ambre = term sheet, bleu = actif, vert = Exit win, rouge =
Exit loss) — c'est lui qui distingue les statuts d'un coup d'œil — et les
term sheets remontent en tête du tableau. Les badges de statut, eux, ne
changent pas : un deal actif reste gris neutre, la couleur n'apparaît que
quand elle signale quelque chose.

> **🔧 Notes techniques**
>
> - `buildParticipationRows` (`convex/deals.ts`) : bucket `pending` dédié
>   (clé société × pending/active/settled) + somme `committed` par ligne ;
>   champs `hasPending`/`statuses` retirés de la projection (le tri
>   pending-first et la facette statut n'existent plus).
> - `ParticipationsView.tsx` : découpage en 4 sections (`SECTIONS`),
>   bandeaux via `participationBucketBand()` (nouveau, dans
>   `dealStatusBadge.ts` — source unique des couleurs, remplace
>   `dealStatusAccent` supprimé) ; répartition win/loss au niveau du
>   groupe (write-off ou MOIC < 1 → loss, MOIC inconnu jamais loss).
> - `ParticipationsTable.tsx` : prop `variant` (`pending`/`active`/
>   `settled`) — colonne Engagé et totaux dédiés pour les TS, liseré
>   retiré des lignes.
> - `dealStatusBadge()` inchangé (actif = gris neutre, signal-only) ;
>   `dealStatusAccent` reste la source du liseré, désormais propre à
>   `CompanyDealsTable.tsx`, qui trie TS → ouvertes → exits.
> - Docs : TESTING.md (SH17–SH20, FE1b), docs/produit 04 + 05.

## v1.134.0 — 27/07/2026 à 18:55 — Le badge « Entreprise » disparaît de la fiche société

L'en-tête de la fiche société ne porte plus la pastille bleue
« Entreprise » à côté du nom : elle ne disait rien qu'on ne sache déjà en
arrivant sur la page.

- **L'en-tête se lit plus vite** : logo, nom, puis le % de détention et le
  menu d'actions. Rien d'autre ne bouge.

> **🔧 Notes techniques**
>
> - `participations.$companyId.tsx` : suppression du `EntityNatureBadge`
>   dans l'en-tête sticky + import orphelin.
> - `EntityFiche.tsx` : le composant `EntityNatureBadge` et le type
>   `EntityNature` n'ayant plus d'appelant sont retirés, avec l'import
>   `Badge` devenu inutile.
> - i18n : clés `participations:nature.*` supprimées (fr + en).
> - Docs : `TESTING.md` FE1 + intro « Fiche société » et
>   `docs/produit/04-participations.md` ne mentionnent plus la nature dans
>   l'en-tête.

## v1.133.0 — 27/07/2026 à 18:47 — Thème et langue passent dans Mon compte

Le pied de la barre latérale ne porte plus les réglages d'affichage : il ne
reste que le menu utilisateur.

- **Un bloc « Apparence »** apparaît dans **Mon compte**, onglet Profil,
  sous les informations personnelles : le thème de couleur et la langue de
  l'interface s'y règlent, avec le même effet immédiat qu'avant.
- **Rien d'autre ne change** : le thème reste mémorisé sur l'appareil, la
  langue reste rattachée au compte et continue de servir pour les emails.
  Le bouton clair/sombre reste, lui, dans le bandeau du haut.

> **🔧 Notes techniques**
>
> - `AppSidebar.tsx` : `SidebarFooter` réduit à `NavUser` (suppression des
>   deux `SidebarMenuItem` + imports orphelins).
> - `ThemePicker.tsx` : déclencheur `SidebarMenuButton` → `Button` ghost
>   (pastille + nom du thème courant), `DropdownMenuContent` repassé en
>   `align="end"` sans `side="right"`.
> - `LanguageSwitcher.tsx` : la branche `variant="sidebar"` devenue morte
>   est supprimée, la prop `variant` disparaît — seul le bouton ghost
>   `FR`/`EN` subsiste.
> - `routes/app/me.tsx` : nouvelle `Card` « Apparence » en fin d'onglet
>   Profil, libellés réutilisés (`nav:theme.label`, `common:language.label`)
>   pour éviter de dupliquer les chaînes ; ajout de `account:appearance.*`
>   (fr + en).
> - Docs : `TESTING.md` I4/SH7 et `docs/produit/02` + `13` pointent vers le
>   nouvel emplacement.

## v1.132.0 — 27/07/2026 à 18:29 — La liste des entreprises ne pagine plus

Dans la foulée de la refonte de la liste : la pagination disparaît. Toutes
les participations s'affichent d'un seul tenant — comme dans un tableur —
et défilent sous l'en-tête et la ligne de totaux, qui restent visibles.
Plus besoin d'aller chercher une société « en page 4 » : on fait défiler,
on filtre ou on cherche. Le passage des lignes en version allégée (mise à
jour précédente) rend l'affichage complet instantané.

> **🔧 Notes techniques**
>
> - `ParticipationsTable.tsx` : suppression de `usePagination` /
>   `PaginationFooter` / découpage `PAGE_SIZE` — rendu direct de
>   `sortedRows` dans le conteneur borné (`max-h-[70vh]`) qui portait déjà
>   l'en-tête et les totaux sticky.
> - Orphelins retirés : prop `resetKey` et `filterKey` de
>   `ParticipationsView.tsx`. `LocalPagination.tsx` reste utilisé par les
>   autres listes (deals agrégés…).
> - TESTING.md (SH19/SH20, section deals per-org retirée) et
>   `docs/produit/04-participations.md` mis à jour.

## v1.131.0 — 27/07/2026 à 18:08 — Le portefeuille se pilote depuis la liste des entreprises

Grande passe d'ergonomie issue du point produit du jour : l'application se
recentre sur la liste des entreprises et leurs fiches.

- **Liste des entreprises épurée** : les colonnes se limitent à l'essentiel
  — société (logo agrandi, lignes plus lisibles), score IA, nombre de
  deals, montant investi, reçu, TVPI, et le secteur en badge en bout de
  ligne. Le pitch d'une ligne disparaît du tableau.
- **Le statut se lit d'un coup d'œil** : un liseré coloré dans la marge de
  chaque ligne — orange pour un deal en cours (term sheet), bleu pour une
  participation active, vert pour une sortie gagnante, rouge pour une
  perte. Les participations soldées s'appellent désormais **« Exit win »**
  et **« Exit loss »**, et les deals en cours remontent en haut de la
  liste.
- **Des totaux comme dans un tableur** : une ligne de totaux fixée en bas
  du tableau somme le nombre de deals, l'investi et le reçu — sur toutes
  les pages, et recalculée à la volée quand on filtre ou qu'on cherche.
  « Combien a-t-on investi en immobilier actif ? » se lit désormais
  directement dans la liste, qui remplace l'ancien tableau de bord.
- **Fiche entreprise réorganisée** : la santé de la boîte (synthèse IA)
  arrive tout en haut, suivie d'un vrai tableau des deals — chaque ligne
  est cliquable vers la fiche du deal. L'identité, le résumé et les
  personnes (fondateurs, board, co-investisseurs) se rangent dans un
  panneau latéral à droite.
- **Navigation simplifiée** : les deals s'ouvrent uniquement depuis la
  fiche de leur entreprise (l'entrée « Deals » du menu disparaît, comme le
  fil d'Ariane du haut de page) ; l'accueil d'une organisation mène
  directement à la liste des entreprises.
- **Les emails du portfolio se retirent** : la timeline d'emails par
  participation et le raccordement Gmail n'étaient pas au niveau ; la
  fonctionnalité est retirée entièrement pour être repensée à froid. Les
  reports par email (investor updates transférés) continuent, eux, de
  fonctionner normalement.
- **Listes plus rapides** : la liste des entreprises ne charge plus que ce
  qu'elle affiche, au lieu de l'intégralité des données de chaque deal.

> **🔧 Notes techniques**
>
> - Nouvelle query de projection `deals.listParticipations` (+ sœur
>   `aggregate.listParticipations`) : agrégats par société calculés côté
>   serveur (`buildParticipationRows`, XIRR sur l'union des flux), les
>   documents deals complets ne transitent plus ; export CSV en fetch
>   one-shot au clic. Filtre `isTreasuryPlacement` conservé côté serveur.
> - `ParticipationsTable.tsx` refondu : liseré via `dealStatusAccent()`
>   (nouveau token `--info` dans `brand.css`), libellés via
>   `dealStatusLabelKey()` (source unique `dealStatusBadge.ts`), en-tête
>   sticky + ligne de totaux sticky (sticky par cellule, conteneur borné —
>   cf. KNOWN_ISSUES « Colonne figée »).
> - Fiche société (`participations.$companyId.tsx`) : layout deux colonnes
>   (`lg:flex-row`), nouveau `CompanyDealsTable.tsx` (lignes cliquables,
>   conventions de montants de `dealAmountTiles`), `DealsList` supprimé.
> - Suppressions : feature emails (`convex/gmail.ts`, route `/emails`,
>   `CompanyEmailsSection`, cron, callback OAuth — tables `gmail*` /
>   `companyEmail*` déclarées inertes, pipeline reports AgentMail intact),
>   dashboard UI (redirect `/app/$orgSlug` → participations,
>   `convex/dashboard.ts` conservé pour le MCP), entrée nav Deals + route
>   `deals.index.tsx`, breadcrumb (`AppHeader.tsx` réécrit).
> - Docs : TESTING.md (SH/FE/M4 réécrits, section Gmail supprimée),
>   KNOWN_ISSUES.md (section tables Gmail inertes, note sticky),
>   TEMPLATE_SYNC.md (token `--info`), docs/produit (pages 03 et 18
>   supprimées, 02/04/05 réécrites).

## v1.130.1 — 27/07/2026 à 09:40 — Fenêtre de rapprochement : le texte ne déborde plus

La fenêtre « Les montants diffèrent » (celle qui propose de clore avec
l'écart ou de conserver le reliquat, depuis les rapprochements suggérés)
débordait de son cadre : les boutons, trop larges pour tenir sur une seule
ligne, poussaient tout le contenu au-delà des bords de la fenêtre. Les
boutons passent désormais à la ligne quand la place manque, et le texte
reste dans le cadre.

> **🔧 Notes techniques**
>
> - `src/components/cash/ForecastMatchSuggestions.tsx` : `sm:flex-wrap` sur
>   le `DialogFooter` de la boîte de décision de rapprochement.
> - Cause : `DialogContent` est un `grid`, et les `Button` sont
>   `whitespace-nowrap shrink-0` — la largeur min-content du footer (3
>   boutons + gaps) dépassait `sm:max-w-md`, ce qui élargissait la colonne
>   de grille au-delà du `max-width` et faisait déborder tout le contenu.
>   Autoriser le wrap ramène le min-content à la largeur du bouton le plus
>   large.

---

## v1.130.0 — 27/07/2026 à 09:20 — Les rapprochements suggérés passent dans Transactions

La carte « Rapprochements suggérés » — celle qui repère qu'une échéance
attendue ressemble à une transaction récente — quitte l'onglet
**Prévisionnel** pour s'installer en tête de l'onglet **Transactions**,
au-dessus du registre.

C'est le même geste que le reste du pointage : confirmer qu'un mouvement
bancaire réel correspond à ce qu'on attendait. Tout se traite donc au même
endroit — les transactions à affecter à un deal, au passif ou à une
catégorie, et les échéances du prévisionnel à rapprocher.

La carte reste visible quel que soit le filtre de statut affiché, et son
fonctionnement ne change pas (un clic quand les montants sont égaux,
sinon le choix entre clore avec l'écart ou garder le reliquat).
L'onglet Prévisionnel garde les échéances à venir et la grille mois par
mois.

> **🔧 Notes techniques**
>
> - Déplacement pur côté route : `<ForecastMatchSuggestions>` passe du
>   `TabsContent` `previsionnel` au `TabsContent` `transactions` de
>   `src/routes/app/$orgSlug/cash.index.tsx`, rendu au-dessus de
>   `<TransactionsLedger>` (le tab passe en `space-y-6`).
> - Rendu inconditionnel du filtre de statut du registre : les transactions
>   candidates de `suggestForecastMatches` ne sont pas nécessairement
>   `unmatched` (seules les transactions déjà consommées par une échéance,
>   `ignored` et les virements internes sont exclues côté serveur) — gater
>   sur le filtre « À pointer » aurait masqué des suggestions valides.
> - Aucun changement backend : `forecasts.suggestForecastMatches`,
>   `forecasts.markEntryRealized` et `transactions.matchTransaction`
>   inchangés.
> - Docs : ligne FC16 de `TESTING.md` (emplacement), FC20 (renvoi),
>   `docs/produit/09-previsionnel.md` et `docs/produit/08-pointage.md`.

## v1.129.5 — 26/07/2026 à 23:40 — Sécurité : reprise de compte par email périmé, et emails neutralisés

Changements internes, sans effet visible dans l'application.

Changer l'adresse email de son compte met désormais le compte à jour
**partout** : jusqu'ici l'ancienne adresse restait attachée en base, et
quelqu'un qui aurait récupéré cette adresse abandonnée pour créer un compte
aurait hérité de l'accès, des organisations et des droits de son précédent
propriétaire.

Les emails envoyés par l'application (invitation, alerte de trésorerie,
échéances en retard, connexion bancaire, boîte Gmail à reconnecter…)
affichent maintenant les noms et libellés de façon neutralisée : un nom
d'organisation ou un libellé d'échéance contenant du code ne peut plus
modifier l'apparence de l'email reçu par quelqu'un d'autre.

> **🔧 Notes techniques**
>
> Report des correctifs de sécurité du template amont, ce fork étant antérieur
> au fix. La troisième faille du lot (open redirect sur `?redirect=`) était
> déjà couverte par la v1.129.3 — voir la note de fusion en fin d'entrée.
>
> - **Reprise de compte via email périmé (critique).** `user.changeEmail` est
>   activé et `provisionAppUser` (`convex/lib/auth.ts`) retombe sur un lookup
>   `by_email` quand `betterAuthId` ne matche pas — mais rien ne resynchronisait
>   `users.email` après un changement côté Better Auth. Ajout de
>   `databaseHooks.user.update.after` dans `createAuth` (`convex/auth.ts`), qui
>   appelle la nouvelle `internal.users.syncFromBetterAuth` : elle retrouve la
>   ligne **par `betterAuthId`** (clé stable, jamais par email) et recopie
>   `email` / `name`. Idempotente, et sans write quand rien n'a changé — la
>   ligne `users` est chaude. Scénario d'attaque et règle anti-récidive dans
>   `KNOWN_ISSUES.md` § « Reprise de compte via email périmé ».
> - **Injection HTML dans les emails (moyen).** Le helper `esc()` de
>   `convex/emailTemplates.ts` (échappe `& < > " '`, existait déjà pour les
>   récaps de reports) est remonté en haut du fichier, étendu aux guillemets et
>   apostrophes, et appliqué aux valeurs utilisateur de la branche HTML des huit
>   templates transactionnels : `invitationEmail`,
>   `changeEmailVerificationEmail`, `deleteAccountVerificationEmail`,
>   `passwordChangedEmail`, `cashAlertEmail`, `overdueEntriesEmail` (dont les
>   libellés d'échéance), `powensConnectionAlertEmail` (dont l'`errorMessage`
>   relayé par la banque) et `gmailReauthAlertEmail`. Sujets et branches texte
>   inchangés ; les URLs sont construites côté serveur, donc laissées telles
>   quelles (liens intacts).
>
> **Fusion avec la v1.129.3 (open redirect).** Cette branche portait aussi un
> correctif pour la 3ᵉ faille, développé en parallèle : il a été **abandonné au
> rebase** au profit de `internalRedirectSearch`. Motif : notre garde était une
> regex `/^\/(?![/\\])/`, et le parseur d'URL supprime tab/LF/CR **avant** de
> résoudre — `/<TAB>/evil.com` passait donc le test puis résolvait vers
> `https://evil.com` (vérifié). La résolution contre une origine sonde de
> `src/lib/safe-redirect.ts` n'a pas ce trou, et couvre aussi `/register`.
>
> Un anti-pattern ajouté dans `CLAUDE.md` (échappement des emails) ; ligne L2
> de `TESTING.md` mise à jour.

## v1.129.4 — 26/07/2026 à 23:12 — Documentation des agents : mise à jour TanStack

Changement interne, sans effet visible dans l'application. La documentation
technique que les agents IA lisent avant d'écrire du code a été mise à jour
depuis sa source officielle.

> **🔧 Notes techniques**
>
> `pnpm run sync:skills:update` — 5 skills TanStack passent de `fc83c03` à
> `179d9b9` (+ `ai-elements`, dont seul le `pinnedRef` bouge, contenu
> identique). Diff relu avant merge, comme l'exige `CLAUDE.md` (une maj de
> skill est une surface de prompt-injection).
>
> - **Forme** : le frontmatter regroupe `type`/`library`/`library_version`
>   sous une clé `metadata:`, et les `name:` perdent leur préfixe de chemin
>   (`router-core/data-loading` → `data-loading`). Sans effet sur notre
>   vendorisation : le script s'appuie sur les clés du lock, pas sur le
>   frontmatter. Les liens inter-familles upstream sont inchangés, la règle de
>   traduction de `KNOWN_ISSUES.md` reste valide.
> - **Fond** : nouvel anti-pattern « ne pas faire un `fetch('/api/...')`
>   relatif depuis un loader SSR » (passer par un server function) ;
>   « typecheck ≠ contrat runtime » ; mutations cache-cohérentes avec
>   `router.invalidate({ sync: true })` ; et un nouveau CRITICAL côté auth :
>   la page atteinte par un visiteur anonyme ne doit rien divulguer, et
>   « le redirect ne doit contenir qu'une URL de retour relative
>   assainie » — exactement ce que la v1.129.3 vient de mettre en place.
> - Aucun override projet (`CLAUDE.md`, `KNOWN_ISSUES.md`) ne devient faux ;
>   aucun `fetch('/api/...')` relatif dans nos loaders. `--verify` et
>   `--check` verts après bump.

## v1.129.3 — 26/07/2026 à 23:02 — Connexion : les liens de retour piégés sont neutralisés

Correctif de sécurité, sans changement visible à l'usage. Un lien de connexion
forgé pouvait, jusqu'ici, vous envoyer vers un site extérieur juste après une
authentification réussie — un classique du phishing : le domaine affiché et la
page de connexion sont les vrais, seule la destination finale est celle de
l'attaquant. La destination de retour est désormais contrainte aux pages de
l'application ; toute autre valeur est ignorée et vous atterrissez normalement
sur votre tableau de bord.

> **🔧 Notes techniques**
>
> Portage du correctif template `albo-ouvre-boite` (commit `c3ec25d`, PR #54).
>
> - Le `?redirect=` de `/login` et `/register` était typé `z.string().optional()`
>   puis passé à `window.location.replace()` (`src/routes/login.tsx`). Better
>   Auth ne couvrait pas ce chemin : `trustedOrigins` ne valide que
>   `callbackURL`/`redirectTo`, et `signIn.email` n'en reçoit aucun ici.
> - Nouveau helper partagé `src/lib/safe-redirect.ts` : `isInternalPath()` et le
>   champ Zod `internalRedirectSearch`, appliqué au `validateSearch` des deux
>   routes. Les `callbackURL` en aval (magic link, vérification email, Google)
>   héritent donc d'une valeur déjà assainie.
> - **Pas de regex** : la validation résout la valeur contre une origine bidon et
>   exige que le résultat y reste (`new URL(v, PROBE).origin === PROBE` +
>   `v.startsWith('/')`). Un regex « commence par `/` mais pas `//` » laisse
>   passer `/<TAB>/evil.com`, que le parseur d'URL réduit ensuite à
>   `//evil.com`. Le champ finit par `.catch(undefined)` (et non un throw) pour
>   ne pas signaler la tentative à l'attaquant.
> - `tests/safeRedirect.test.ts` : 24 vecteurs (18 hostiles neutralisés, 6
>   chemins internes préservés à l'identique), exécutés par `pnpm test:unit`.
> - Docs : section « Return-URL `?redirect=` » dans `KNOWN_ISSUES.md`,
>   anti-pattern dans `CLAUDE.md`, ligne A4 de `TESTING.md` corrigée (le garde
>   `/app` n'ajoute aucun paramètre de retour) et nouvelle ligne S8.

## v1.129.2 — 26/07/2026 à 15:00 — Documentation des agents : contrôle d'intégrité

Changement interne, sans effet visible dans l'application. La documentation
technique lue par les agents IA est désormais vérifiée à chaque modification du
code : si un fichier a été altéré ou est resté périmé, l'intégration continue
le signale et une seule commande le répare.

> **🔧 Notes techniques**
>
> Suite de la v1.129.1. En portant les PR du template, on a découvert que
> `scripts/sync-skills.mjs` ne vérifiait **jamais** l'état du disque : `--check`
> comme le mode par défaut comparaient le hash du lock à l'**upstream**, et
> `isVendored()` ne testait que l'_existence_ des fichiers. Un fichier vendorisé
> édité à la main, tronqué ou périmé était invisible des deux côtés — démontré
> en ajoutant une ligne dans un `SKILL.md` : `--check` restait vert, exit 0.
> C'est la cause racine des trois fichiers `references/` Convex périmés
> (`migrations-component.md` avait 54 lignes de retard).
>
> - Nouveau mode `--verify` (`pnpm run sync:skills:verify`) : `hashLocal()`
>   reproduit `fetchSkillAt()` contre l'arbre de travail (même ordre de
>   fichiers, même cadrage) et compare à `computedHash`. Aucun réseau.
> - Le mode par défaut devient **auto-réparateur** : `runSync` réécrit dès que
>   le local diverge du lock, donc `pnpm run sync:skills` répare un arbre
>   corrompu sans `--force`.
> - CI : le job `skills-drift` (réseau, 62 requêtes par PR, pouvait rougir sur
>   un hoquet GitHub) est remplacé par `skills-verify` (hors-ligne,
>   déterministe). La dérive upstream reste couverte par le hook `SessionStart`
>   et le cron hebdo.
> - Vérifs : 3 types de corruption détectés (SKILL.md modifié, référence
>   modifiée, fichier supprimé) → exit 2 ; réparation par `sync:skills` seul,
>   arbre restauré à l'identique (0 diff) ; idempotence et `--check` inchangés ;
>   lint + typecheck + build verts.
> - Ajouté au backlog `TEMPLATE_SYNC.md` : le template porte le même bug.

## v1.129.1 — 26/07/2026 à 14:32 — Documentation des agents : arborescence TanStack officielle

Changement interne, sans effet visible dans l'application : la documentation
technique que les agents IA lisent avant d'écrire du code a été remise à jour
depuis les sources officielles.

> **🔧 Notes techniques**
>
> Port ciblé des PR #50 et #51 du template `albo-ouvre-boite`, sans passer par
> `pnpm run upgrade-template` (le template a divergé de dix PR, dont plusieurs
> portées depuis Albo OS — un merge complet aurait été du bruit conflictuel pour
> zéro gain). Aucun code applicatif touché.
>
> - `scripts/sync-skills.mjs` accepte désormais un tableau `references` par
>   skill (fichiers annexes vendorisés et intégrés au `computedHash`, donc
>   couverts par la détection de dérive) et plafonne les fetchs simultanés à 8
>   (`MAX_IN_FLIGHT`) — au-delà de ~30 handshakes TLS parallèles
>   `raw.githubusercontent.com` cesse de répondre et fait sauter le budget 10 s
>   du hook `SessionStart`.
> - `tanstack-start-best-practices` (un `SKILL.md` routeur aux 2 liens cassés +
>   13 `rules/*.md` orphelins issus d'un repo communautaire, jamais rafraîchis)
>   est remplacé par les **5 familles officielles** de `TanStack/router@fc83c03`
>   — 34 fichiers : server functions, middleware, SSR, data loading, guards,
>   search/path params, type safety, Router ↔ Query. Couverture des 13 règles
>   supprimées vérifiée thème par thème avant suppression.
> - Skills Convex bumpées `7a6fcc6` → `ec1e6ba` avec leurs `references` : trois
>   fichiers étaient réellement périmés, dont `migrations-component.md` avec 54
>   lignes de retard.
> - `eslint.config.mjs` ignore `.agents/skills` et `.claude/skills` (les
>   exemples `.tsx` vendorisés vivent hors de tout projet tsconfig).
> - Vérifs : `sync:skills` idempotent, `--force` reproductible, `--check` vert
>   en ~0,8 s sur 62 fichiers, audit de liens 43 résolus / 0 cassé dans une
>   famille, `pnpm lint` et `pnpm build` verts.

## v1.129.0 — 24/07/2026 à 12:45 — Placements : la trésorerie placée a sa propre page

La crypto, les comptes de capitalisation, les dépôts à terme et les
comptes-titres ne se suivent pas comme des participations : pas de tour de
table ni de TVPI, juste un **solde** et **combien ça rapporte**. Ils ont
désormais leur page dédiée, « Placements », dans la barre latérale sous
Trésorerie — et sortent de la liste Entreprises (les fonds, eux, y restent).

Sur cette page, façon Finary : quatre tuiles (solde total, versé net,
plus-value latente, rendement annualisé) et une ligne par placement avec son
versé, son retiré, son solde et sa performance. Le solde se met à jour d'un
clic directement dans le tableau ; chaque mise à jour est datée et conservée,
ce qui prépare une future courbe d'évolution. Le rendement annualisé est
calculé sur les flux réellement pointés en banque plus le solde actuel.

> **🔧 Notes techniques**
>
> - Périmètre défini par `TREASURY_PLACEMENT_KINDS` (`crypto`,
>   `capitalization_account`, `dat`, `cto`) + helper `isTreasuryPlacement`
>   dans `convex/lib/instrumentMapping.ts` — distinct de l'archétype
>   `placement`, qui ne pilote que le layout de la fiche deal.
> - Nouvelle route `src/routes/app/$orgSlug/placements.index.tsx` +
>   `src/components/placements/PlacementsView.tsx` : tuiles `KpiCard`,
>   table avec solde éditable inline (pattern `EditableCa`), XIRR par ligne
>   et global via `xirr(flows + solde terminal)`. Montants au centime
>   (`fmtEurCents`). Les lignes sans solde sont exclues de la plus-value et
>   du rendement globaux.
> - `deals.update` (`convex/deals.ts`) : tout patch de `currentValue`
>   (> 0, changé) insère aussi une ligne `valuations`
>   (`mark_to_market`, source `balance_update`) — historique daté du solde,
>   quel que soit le point d'entrée (page Placements, fiche, dialogue).
>   Effet de bord assumé : la NAV/TVPI du dashboard comptera ces placements
>   à leur valeur marquée (aujourd'hui ils comptent au coût, faute de
>   valorisation).
> - `/app/$orgSlug/participations` filtre `isTreasuryPlacement` avant
>   `ParticipationsView` (facettes, export CSV et section « Soldées »
>   suivent) ; la liste **non filtrée** continue d'alimenter « Sans deal ».
>   `/app/all` inchangé (pas encore de vue placements cross-org).
> - Nav + breadcrumb (`nav.ts`, `AppHeader.tsx`), namespace i18n
>   `placements` (fr/en), doc produit `docs/produit/19-placements.md`,
>   TESTING.md section « Vue Placements » (PL1-PL6).

## v1.128.0 — 23/07/2026 à 17:15 — Emails : rattachement plus malin, avec l'IA en filet

Jusqu'ici, un email n'était rangé sur la fiche d'une participation que si
l'expéditeur ou un destinataire portait le domaine de la société. Beaucoup
de vrais échanges passaient au travers : un report transféré, un fonds qui
transmet le reporting d'une de vos lignes, un avocat qui parle du deal…

Le rattachement se fait désormais **en cascade**, du signal le plus sûr au
plus fin : domaine des participants, puis domaine cité dans le corps du
message (cas du transfert), puis nom exact de la société dans l'objet ou le
corps — et, pour les emails qu'aucune règle ne rattache, une **analyse par
l'IA** détecte les participations concernées directement ou indirectement.
L'IA ne rattache que quand c'est sans ambiguïté, et ces liens sont marqués
d'une étincelle ✨ dans la timeline pour rester identifiables. Rien d'autre
ne change : seuls les emails liés au portefeuille sont conservés, et
l'extraction de report reste sur votre clic.

> **🔧 Notes techniques**
>
> - `convex/gmail.ts` : `findMatches` réécrit en cascade déterministe
>   (`participant_domain` → `body_domain` → `name_mention`) + fallback
>   `identifyByLlm` (generateObject via `getModel()`, fallback
>   generateText, confiance high uniquement, picks re-validés dans
>   `storeMessage`) ; méthode tracée sur `companyEmailLinks.matchMethod`
>   (nouveau champ optionnel au schéma). Suppression du skip « mail 100 %
>   interne » (un transfert interne peut matcher via le corps).
> - Helpers partagés extraits dans `convex/lib/emailIdentify.ts`
>   (`nameAppearsInText`, `extractEmailAddresses`, `extractJson`,
>   blocklist plateformes) — `reportIdentify.ts` les consomme désormais.
> - UI : flag `viaLlm` exposé par `gmail.listByOrg`/`listByCompany`,
>   étincelle `Sparkles` sur `/app/$orgSlug/emails` et l'onglet Emails de
>   la fiche (i18n `emails.aiMatched`).
> - Piège documenté (`KNOWN_ISSUES.md` « Connecteur Gmail ») : un échec de
>   l'appel LLM saute le message sans retry (curseur consommé) — rattrapé
>   par le futur backfill d'historique.

## v1.127.0 — 23/07/2026 à 17:07 — Statut des deals : la couleur ne sert plus qu'aux sorties

Les badges de statut d'un deal étaient devenus confus : plusieurs couleurs se
chevauchaient et un deal sorti pouvait porter deux badges qui répétaient la
même info (deux rouges sur une perte, deux gris sur une sortie à plat).

Désormais **un seul badge par deal**, et la couleur ne parle que quand elle
veut dire quelque chose :

- **gris** — rien à signaler : un deal actif, ou une sortie sans plus-value
  (un deal actif se suit avec ses reports, pas avec une couleur) ;
- **ambre** — term sheet signée, pas encore câblée ;
- **vert** — sortie gagnante, y compris une **sortie partielle déjà dans le
  vert** (le gain réalisé reste signalé, jamais une perte tant que la position
  n'est pas soldée) ;
- **rouge** — sortie en perte ou dépréciation.

Plus de double badge, et la même règle s'applique partout : liste des deals,
vue consolidée, fiche société et fiche deal.

> **🔧 Notes techniques**
>
> - Nouvelle source unique `dealStatusBadge(status, moic)`
>   (`src/lib/dealStatusBadge.ts`) → `{ variant, className }`. Couleur d'un exit
>   depuis le MOIC réalisé (`DealRow.moic` côté serveur, ou `dealMoic(deal, txs)`
>   sur la fiche) : `pending` → ambre, `fully_exited` ≥ 1 → vert / < 1 → rouge /
>   MOIC nul → neutre, `written_off` → rouge, `partially_exited` ≥ 1 → vert
>   (win-only, jamais rouge — reprend la logique de la v1.126.0), sinon neutre.
> - Remplace les 3 copies de `statusVariant` + l'override `pending` inline + le
>   composant `ExitBadge` (supprimé, sa logique win-only repliée dans le helper)
>   dans `DealsListView` (liste par-org **et** `/app/all`), `ParticipationsTable`
>   (`DealsList` + section soldés) et `deals.$dealId`. Un seul `<Badge>` par deal.
> - Clés i18n `participations.exitBadge.*` retirées (FR + EN) ; les libellés
>   réutilisent `status.*`.

## v1.126.1 — 23/07/2026 à 16:39 — Sync Attio : la société arrive avec son vrai nom

Quand un deal passait en Term Sheet dans Attio, la société créée dans Albo OS
prenait le **nom du deal** (ex. « Invest Startup Studio ») au lieu du nom de
la société (« You.Switch »). Corrigé : la synchro va maintenant chercher la
fiche société dans Attio et crée la société avec son **vrai nom et son
domaine**. Les sociétés déjà arrivées en « coquille » se réparent toutes
seules à la prochaine modification du deal dans Attio — un nom corrigé à la
main n'est jamais écrasé.

> **🔧 Notes techniques**
>
> - `convex/attioSync.ts` : nouveau `fetchCompanyIdentity` (re-fetch de la
>   company Attio associée — nom + premier domaine — le payload deal ne porte
>   que la référence), branché sur le webhook ET le backfill ;
>   `resolveOrCreateTargetCompany` crée la société avec cette identité,
>   `repairStubTargetCompany` répare les stubs au refresh Term Sheet.
> - `convex/lib/attioSync.ts` : décision pure `companyIdentityPatch`
>   (rename stub-only, domaine rempli seulement si vide) + constante
>   `ATTIO_STUB_COMPANY_NAME` — testée dans `tests/attioSync.test.ts`.

## v1.126.0 — 23/07/2026 à 15:43 — Sortie partielle : le gain déjà réalisé s'affiche

Un deal en **sortie partielle** garde son statut « Exit partiel » et reste
dans les participations actives — c'est normal, on détient encore une partie.
Mais désormais, dès que le montant déjà reçu dépasse le capital déployé, sa
fiche affiche un badge **« Exit gagnant »** : le gain réalisé ne passe plus
inaperçu. Rien ne s'affiche tant que la position n'est pas dans le vert, et
**jamais** de badge « perdant » sur une sortie partielle — le deal n'étant pas
soldé, le reste de la position peut encore remonter.

> **🔧 Notes techniques**
>
> - `ExitBadge` (`src/components/deals/ExitBadge.tsx`) : la garde de rendu
>   inclut désormais `partially_exited`, en logique « win-only » — le badge
>   n'est rendu que si `dealMoic` renvoie `isWin === true` (MOIC ≥ 1) ; un
>   MOIC < 1 ou nul (deal non soldé) ne rend rien, jamais « lost » ni le
>   neutre « Sorti ». `fully_exited` / `written_off` inchangés.
> - Surface : la **fiche deal** (`deals.$dealId.tsx`, déjà branchée sur
>   `ExitBadge` avec les vraies transactions → MOIC exact, dé-TVA royalties
>   incluse). Volontairement **pas** ajouté aux listes (`DealsListView`
>   n'affiche aucun badge win/lost, et la table par société n'agrège pas un
>   partiel au niveau société). Aucune nouvelle clé i18n (réutilise
>   `participations:exitBadge.win`), aucun changement de schéma.

## v1.125.0 — 23/07/2026 à 15:22 — Le titre reste figé en haut des fiches entité et deal

Sur une **fiche entreprise** ou une **fiche deal**, le titre (le nom, son
statut et le menu d'actions « … ») reste désormais **collé en haut de la
page** quand vous faites défiler vers le bas. Plus besoin de remonter tout en
haut pour savoir où vous êtes ou pour rouvrir le menu d'actions : le repère
reste toujours visible.

> **🔧 Notes techniques**
>
> - Barre de titre rendue `sticky top-0` dans `participations.$companyId.tsx`
>   et `deals.$dealId.tsx` — le conteneur de scroll est le `div.overflow-y-auto`
>   qui enveloppe l'`Outlet` (`app/$orgSlug/route.tsx`), donc pas de JS.
> - Full-bleed via `-mx-6 px-6` (le `main` est en `p-6`) + `bg-background`
>   `border-b` `z-10` pour masquer proprement le contenu qui passe dessous.

## v1.124.2 — 23/07/2026 à 14:45 — Emails : plus aucun scroll horizontal dans la fenêtre du mail

Verrouillage complet de la fenêtre d'email : les blocs internes (en-tête,
corps du message) ne peuvent plus créer de barre de défilement horizontale.
Tout respecte la largeur de la fenêtre et revient à la ligne ; seul le
défilement vertical reste possible. Ça règle les cas — surtout les mails au
titre très long — où il fallait « glisser vers la gauche » pour voir la suite.

> **🔧 Notes techniques**
>
> - `src/components/companies/CompanyEmailsSection.tsx`, `EmailDetailDialog` :
>   sur le `DialogContent`, ajout de `overflow-x-hidden` (un conteneur en
>   `overflow-y-auto` voit son `overflow-x` calculé en `auto` par le
>   navigateur → autorise un scroll horizontal ; on le force à `hidden`) et
>   de `[&>*]:min-w-0` (les enfants d'une grille ont `min-width: auto` et
>   peuvent élargir la piste au-delà du plafond ; on les laisse rétrécir pour
>   forcer le retour à la ligne). Même `overflow-x-hidden` ajouté sur la boîte
>   de scroll du corps du message. Complète le plafond `sm:max-w-2xl!` de
>   v1.124.1.

## v1.124.1 — 23/07/2026 à 14:29 — Emails : la fenêtre du mail qui débordait de l'écran

La vraie cause des débordements de la fenêtre d'email : la fenêtre elle-même
n'était pas limitée en largeur et s'étirait à la taille de son contenu le plus
large (un sujet très long sur une seule ligne), au point de sortir de l'écran.
Elle est désormais correctement plafonnée et centrée, et tout le mail tient
dans le cadre. (Les deux correctifs précédents ne traitaient que le contenu à
l'intérieur du cadre, pas la taille du cadre — d'où l'impression que « rien ne
se passait ».)

> **🔧 Notes techniques**
>
> - `src/components/companies/CompanyEmailsSection.tsx` : `DialogContent` du
>   `EmailDetailDialog` passé de `sm:max-w-2xl` à `sm:max-w-2xl!` (important
>   suffixe). Le `DialogContent` shadcn embarque un `max-w-[calc(100%-2rem)]`
>   de base qui l'emportait dans la cascade CSS sur un `sm:max-w-2xl` nu (cf.
>   `KNOWN_ISSUES.md` « tailwind-merge v3 / Tailwind v4 »), donc la boîte
>   n'était jamais plafonnée à 2xl et s'étalait à la largeur de son plus large
>   enfant. Seule modale du projet à contenir un enfant aussi large (le sujet
>   d'un mail sur une ligne), d'où le fait qu'elle seule exposait le bug.

## v1.124.0 — 23/07/2026 à 14:14 — Prévisionnel : ajouter une échéance directement depuis un deal

Vous pouvez maintenant créer une **prévision ponctuelle** (un coupon attendu,
un loyer, un appel de fonds programmé…) directement depuis la fiche d'un deal,
sans repasser par la Trésorerie. Un bouton **« Ajouter une prévision »** dans
la section Prévisionnel du deal ouvre le formulaire, l'échéance est
automatiquement rattachée au deal et remonte aussitôt dans le prévisionnel de
trésorerie.

> **🔧 Notes techniques**
>
> - Aucune évolution backend ni de schéma : `forecastEntries.dealId` et la
>   mutation `createManualEntry` (avec `dealId`) existaient déjà.
> - `EntryDialog` (`src/components/cash/ForecastSection.tsx`) est désormais
>   exporté et accepte une prop optionnelle `lockedDealId` : quand elle est
>   fournie, le sélecteur de deal est masqué et l'échéance est liée à ce deal.
> - `DealForecastSection` (`src/components/deals/DealForecastSection.tsx`) reçoit
>   `orgId`, affiche un bouton « Ajouter une prévision » (visible même quand la
>   section est vide, avec un état vide dédié) et monte `EntryDialog` en mode
>   verrouillé.
> - Fiche deal (`deals.$dealId.tsx`) : passe `orgId={deal.orgId}`. Le `hint` de
>   la section, qui renvoyait à la page Trésorerie pour la gestion, a été
>   corrigé. Clés i18n `dealForecast.add` / `dealForecast.empty` (en + fr).

## v1.123.1 — 23/07/2026 à 11:47 — Emails : titre trop long qui débordait de la fenêtre

Suite du correctif précédent : quand le sujet d'un email était très long
(par exemple une invitation d'agenda avec la date et l'adresse dans le
titre), le titre débordait sur le côté et passait sous la croix de
fermeture. Le titre revient désormais à la ligne et laisse la place au
bouton de fermeture.

> **🔧 Notes techniques**
>
> - `src/components/companies/CompanyEmailsSection.tsx` : ajout de `pr-8`
>   (marge réservée au bouton close de la `DialogContent`) et `break-words`
>   sur le `DialogTitle` du `EmailDetailDialog`. Sans marge à droite, un
>   sujet long passait sous la croix ; `break-words` couvre les sujets
>   contenant une longue chaîne sans espace (adresse email, URL).

## v1.123.0 — 23/07/2026 à 11:32 — Centimes : les montants réels affichés au centime là où ça compte

Fini les montants arrondis à l'euro sur les écrans où le centime compte. Les
montants **réels** — transactions bancaires, soldes de comptes, pointage,
comptes courants, TVA et le suivi des royalties — s'affichent désormais **au
centime** (ex. `1 234,56 €` au lieu de `1 235 €`). Sur la fiche d'un deal, le
montant réellement versé, le reçu, la table des transactions et la comparaison
plan vs réel passent aussi au centime, pour que tout se recoupe avec le relevé
bancaire. Les montants d'**estimation et de pilotage** — valorisations, KPIs,
engagements, prévisionnel, tableau de bord — restent arrondis à l'euro : à ce
niveau les centimes seraient du bruit (et suggéreraient une précision qui
n'existe pas sur une valo).

> **🔧 Notes techniques**
>
> - Changement d'affichage uniquement : les montants sont déjà stockés en
>   centimes (entiers), rien ne bouge en base ni dans les calculs.
> - Nouveau formateur `fmtEurCents` (2 décimales) dans `useFormatters()`
>   (`src/components/participations/ParticipationsTable.tsx`), à côté du
>   `fmtEur` arrondi conservé pour le portfolio.
> - Couche cash passée à 2 décimales : `TransactionSheet.tsx` (`fmtSigned`),
>   `cash.$accountId.tsx`, `PassifTables.tsx`, `VatCard.tsx`,
>   `CashAccounts.tsx`.
> - Fiche deal : table des transactions + tuiles « versé »/« reçu » (flag
>   `precise` sur `dealAmountTiles`), `RoyaltiesPanel.tsx` (panneau entier),
>   `LeadSpvPanel.tsx` (collecté), `FundSection.tsx` (appelé/distribué), table
>   de `PlanVsActualSection.tsx` → `fmtEurCents`. Le graphe plan-vs-réel garde
>   son axe arrondi (des ticks au centime seraient illisibles).
> - Prévisionnel/suggestions, valos, plus-value latente, engagement, dashboard
>   et e-mails : inchangés (arrondi euro). Règle documentée dans `CLAUDE.md`
>   § Gestion des arrondis (centimes).

## v1.122.1 — 23/07/2026 à 11:10 — Emails : corps de message qui débordait à l'ouverture

À l'ouverture d'un email contenant de très longs liens (par exemple des URL
de téléchargement de pièces jointes sans espaces), le corps du message
débordait sur le côté et s'affichait mal. Les longues chaînes sont désormais
coupées proprement pour tenir dans la fenêtre.

> **🔧 Notes techniques**
>
> - `src/components/companies/CompanyEmailsSection.tsx` : ajout de
>   `break-words` sur le conteneur du corps (`detail.bodyText`) du
>   `EmailDetailDialog`. Le `whitespace-pre-wrap` seul ne coupait pas les
>   tokens sans espaces (longues URL), d'où le débordement horizontal du
>   modal.

## v1.122.0 — 22/07/2026 à 12:21 — Emails : bouton « Extraire le report » (validation manuelle)

Depuis le détail d'un email capté (fiche participation ou page Emails), un
bouton **« Extraire le report »** envoie l'email dans le circuit d'analyse
des reports — le même que le transfert d'emails : lecture du texte, des PDF
et Excel joints, des liens DocSend/Notion, extraction des KPIs, fiche
report sur l'onglet Rapports, synthèse IA et récap par email. **Rien n'est
extrait automatiquement** : chaque extraction part d'un clic, et un email
déjà extrait affiche « Déjà extrait » (pas de double traitement). Si le
même report arrive aussi par le transfert, la fiche de la période est mise
à jour, jamais dupliquée.

> **🔧 Notes techniques**
>
> - `gmail.processAsReport` (mutation, membre d'une org liée requis) : crée
>   la ligne `inboundEmails` avec provenance synthétique
>   (`agentmailMessageId = gmail:<emailId>`, dedup naturel par
>   `by_message_id`), `matchedCompanies` = les liens du mail (brique 3
>   d'identification LLM sautée), `senderUserId` = le déclencheur, puis
>   schedule `reportExtract.run` directement.
> - `reportExtract.run` : raccourci storage — une pièce jointe portant déjà
>   un `storageId` (mail capté Gmail) est lue depuis le storage Convex,
>   jamais retéléchargée d'AgentMail ni re-stockée. Circuit forward
>   inchangé.
> - Dialog email : bouton avec états (spinner / « Déjà extrait » réactif
>   via `getById.processedAsReport`), i18n fr/en.

## v1.121.0 — 22/07/2026 à 19:54 — Tâches : statuts, société liée, assignation et échéances

La liste de tâches de l'onglet **À faire** passe d'une simple check-list à
un vrai suivi, inspiré des outils de gestion de portefeuille :

- **Trois statuts** au lieu de deux : à faire, **en cours** (anneau orange)
  et fait (coche verte, titre barré). Un clic sur l'indicateur fait passer
  la tâche au statut suivant.
- Les tâches sont **groupées par statut** avec un compteur par groupe, et
  triées par échéance dans chaque groupe.
- Chaque tâche peut porter une **société du portefeuille** (badge cliquable
  vers sa fiche), une **personne assignée** et une **date d'échéance**
  (affichée en rouge quand elle est dépassée).
- Nouveau bouton **« Nouvelle tâche »** — ou la touche **T** depuis la page —
  qui ouvre un petit formulaire de création ; Échap le referme.
- Les tâches faites restent visibles **30 jours**, puis sortent de la liste
  (elles ne sont pas supprimées).

> **🔧 Notes techniques**
>
> - Schéma `todos` étendu : statut `in_progress`, champs optionnels
>   `dueDate`, `assigneeUserId`, `companyId` (rétro-compatible, pas de
>   migration).
> - `convex/todo.ts` : `createTask` valide l'assignee (membre de l'org) et
>   la société (même org) ; `setTaskDone` remplacée par `setTaskStatus`
>   (3 états) ; `getTodo` enrichit chaque tâche (nom société/assignee),
>   masque les faites > 30 jours (`DONE_VISIBLE_MS`) et trie par échéance
>   puis création.
> - `src/routes/app/$orgSlug/todo.tsx` : groupes À faire / En cours / Fait,
>   indicateur tri-state cliquable (tokens `--warning`/`--positive`),
>   composer repliable (Input + Selects société/membre + date), raccourci
>   clavier T (ignoré dans les champs), suppression au survol.

## v1.120.0 — 22/07/2026 à 12:06 — Gmail : email d'alerte quand une boîte doit être reconnectée

Plus besoin de surveiller la page Intégrations : quand l'autorisation d'une
boîte Gmail expire (la limite hebdomadaire du mode test Google) ou est
révoquée, **un email est envoyé automatiquement** à la personne qui a
connecté la boîte, avec le lien direct vers la page Intégrations — la
reconnexion prend une vingtaine de secondes. Un seul email par incident,
pas de rappels.

> **🔧 Notes techniques**
>
> - `gmail.notifyReauthRequired` (internalMutation) : déclenchée par
>   `syncAll` au passage `reauth_required` (`invalid_grant` au refresh) ;
>   destinataire = `gmailAccounts.userId`, template bilingue
>   `gmailReauthAlertEmail` (`convex/emailTemplates.ts`), envoi via
>   `@convex-dev/resend`.
> - Garde anti-spam `gmailAccounts.reauthNotifiedAt` (même convention que
>   `powensConnections.notifiedHealth`), effacée au reconnect
>   (`saveAccount`) → un incident = un email.

## v1.119.1 — 22/07/2026 à 11:39 — Gmail : documentation du mode test Google (utilisateurs test, reconnexion à 7 jours)

Clarification de la documentation après le passage de l'application Google
en « Externe / Test » (nécessaire pour connecter les boîtes hors alboteam) :
ajouter une nouvelle boîte demande d'abord de déclarer l'adresse comme
« utilisateur test » dans la console Google, et toutes les autorisations
expirent au bout de 7 jours (2 clics pour reconnecter) tant que la
validation Google n'est pas passée.

> **🔧 Notes techniques**
>
> - Doc uniquement : `docs/produit/18-emails-portfolio.md` (points
>   d'attention : procédure d'ajout en deux endroits, expiration 7 jours
>   généralisée) et `KNOWN_ISSUES.md` § « Connecteur Gmail » (bascule
>   Internal → External/Testing, liste d'utilisateurs test, blocage du
>   mode production sans validation CASA).

## v1.119.0 — 21/07/2026 à 20:52 — Page « Emails » : le suivi des mails captés, par organisation

Nouvelle entrée **Emails** dans le menu de gauche de chaque organisation
(entre Deals et Trésorerie) : la liste de **tous les emails rattachés aux
participations de cette organisation**, toutes boîtes confondues, du plus
récent au plus ancien. Pour chaque email : date, sens (reçu/envoyé), objet
(avec trombone s'il a des pièces jointes), expéditeur, **société(s)
rattachée(s)** — cliquables vers la fiche — et la boîte qui l'a capté. Un
clic ouvre le message complet, comme sur les fiches. C'est l'endroit où
vérifier d'un coup d'œil que la capture fonctionne — Albo et Calte ont
chacun leur page, étanches l'une à l'autre.

> **🔧 Notes techniques**
>
> - Query `gmail.listByOrg` : liens `companyEmailLinks` par le nouvel index
>   `by_org_and_sentAt` (desc, dédupliqués par email, borné ~100), gardée
>   `requireOrgMember` — strictement org-scopée, cohérente avec le modèle
>   de boîtes par organisation.
> - Route `src/routes/app/$orgSlug/emails.tsx` (pattern de la page
>   Rapports), dialog de détail réutilisé (`EmailDetailDialog` exporté de
>   `CompanyEmailsSection`), entrée nav `getNavGroups` (icône Mail), i18n
>   fr/en (`participations:emails.page.*`, `nav:items.emails`).

## v1.118.0 — 21/07/2026 à 18:32 — Emails du portfolio : boîtes par organisation et pièces jointes conservées

Deux renforcements du connecteur Gmail livré aujourd'hui, avant sa première
vraie utilisation :

**Chaque boîte appartient désormais à une organisation.** Une boîte
connectée depuis Albo n'alimente que les participations d'Albo ; pour
qu'elle serve aussi Calte, on la connecte une seconde fois depuis Calte
(deux autorisations indépendantes). L'étanchéité entre les véhicules est
totale : un email ne peut jamais se retrouver dans une organisation qui ne
suit pas la société concernée, et perdre l'accès à un véhicule ne laisse
aucune donnée derrière soi. La boîte connectée avant ce changement (aucune
donnée relevée) est retirée automatiquement — il suffit de la reconnecter
depuis la bonne organisation.

**Les emails sont conservés en entier.** Pour chaque email rattaché à une
participation : les pièces jointes (PDF, Excel…) sont téléchargées et
stockées dans Albo OS — visibles et téléchargeables dans le détail de
l'email (trombone dans la liste) — et les liens cliquables du message
(DocSend, Notion…) sont préservés dans le texte. Tout est donc en place
pour extraire plus tard les données des reports reçus par email, même des
mois après, sans dépendre de Gmail.

> **🔧 Notes techniques**
>
> - `gmailAccounts.orgId` (+ `gmailOAuthStates.orgId`) : upsert par
>   (org, email), `startConnect`/`disconnect` admin-gated sur l'org,
>   matching restreint aux sociétés de l'org de la boîte (`findMatches`
>   partagé query/mutation). `orgId` laissé optional au schéma pour la
>   ligne legacy pré-séparation ; purge auto dans `syncAll` ; à resserrer
>   ensuite (widen-migrate-narrow).
> - Pièces jointes : probe de match read-only (`matchProbe`) avant tout
>   téléchargement (rien pour les mails non matchés ni déjà stockés), puis
>   `messages.attachments.get` → `ctx.storage.store` (≤ 20 Mo, cap 10,
>   images inline < 100 Ko ignorées) → `companyEmails.attachments`.
> - `htmlToText` préserve les URLs des `<a href>` (« libellé (url) ») ;
>   `gmailMessageId` stocké comme référence de re-fetch.
> - Front : PJ téléchargeables dans le dialog (`CompanyEmailsSection`),
>   trombone sur les lignes, `startConnect({orgId})`, Intégrations par org
>   (badge « Par organisation »).

## v1.117.2 — 21/07/2026 à 18:17 — Parallel : correction du chemin de lecture du portefeuille (rattachement des SPV détenus)

La détection des SPV détenus — celle qui permet de les rattacher **avant** leur
première communication — lisait une source que Parallel **masque** au compte
investisseur : elle ne remontait donc rien. Elle s'appuie désormais sur la vue
**portefeuille** du compte, bien lisible par notre connexion. Un SPV détenu
doit maintenant apparaître dans la liste de rattachement après une
synchronisation.

> **🔧 Notes techniques**
>
> - `pullPortfolioIssuers` (`convex/vasco.ts`) lit désormais
>   `Account.portfolio.active` (`ActiveParticipation.issuerId` / `issuerName`),
>   des scalaires directs, au lieu de
>   `accountSecurityContracts.security.company` — ce dernier revient
>   **vide/masqué** pour la persona investisseur (vérifié en prod :
>   `probePortfolioIssuers` → `portfolioCount: 0`, sans erreur), comme
>   `GetSecurities`.
> - `issuerId` = l'id Company de l'émetteur, **même id** que
>   `Communication.issuer.id` → la réconciliation (remontée des communications
>   futures) reste garantie. Normalisation scalaire-ou-liste
>   (`firstNonEmptyString` ; la doc rend ces champs `[String]`).
>   ⚠️ `TransactionSecurity.issuerCompany` (type `IssuerCompany`) volontairement
>   écarté : son id peut différer.
> - Nouvelle sonde `vasco:probePortfolioParticipations` : dump brut de
>   `portfolio.active` + ids des communications, pour confirmer en prod la
>   lisibilité du chemin et la réconciliation des id avant de s'y fier.

## v1.117.1 — 21/07/2026 à 17:55 — Gmail : message d'erreur clair quand la connexion n'est pas encore configurée

Cliquer « Connecter une boîte Gmail » avant la configuration des identifiants
Google affichait par erreur le message de la connexion bancaire. Le bouton
explique désormais la vraie cause : Gmail n'est pas encore configuré côté
serveur (ou, le cas échéant, une erreur Gmail spécifique).

> **🔧 Notes techniques**
>
> - `settings/integrations.tsx` : le catch d'`openWebview` distingue la
>   plateforme et le code `ConvexError` (`gmail_env_missing` → toast dédié) ;
>   nouvelles clés i18n `toasts.gmailNotConfigured`/`gmailRedirectError`
>   (fr/en). Ligne GM9 ajoutée à `TESTING.md`.

## v1.117.0 — 21/07/2026 à 17:02 — Emails du portfolio : boîtes Gmail connectées, timeline par participation

Vos boîtes Gmail se connectent maintenant directement à Albo OS (Réglages →
Intégrations → Gmail), sans passer par un service tiers. Toutes les 10
minutes, les nouveaux emails — reçus **et** envoyés — sont relevés, et chaque
email dont un participant appartient au domaine d'une société du portefeuille
apparaît sur la fiche de la participation, dans un nouvel onglet **Emails** :
liste chronologique, clic pour lire le message complet. Un même email vu par
plusieurs boîtes n'apparaît qu'une fois, en précisant par quelles boîtes il
est passé.

Côté confidentialité : **seuls les emails liés à une participation sont
conservés**. Le reste de vos boîtes (mails internes, personnels, newsletters)
n'entre jamais dans Albo OS. Les pièces jointes ne sont pas récupérées par ce
canal — pour un report avec un PDF, l'adresse de transfert des reports reste
la bonne voie.

À venir dans de prochaines livraisons : le branchement des emails « report »
sur le circuit d'analyse existant (KPIs, synthèse), puis l'import de
l'historique complet de chaque boîte.

> **🔧 Notes techniques**
>
> - Connecteur Gmail en OAuth Google direct, architecture inspirée du module
>   messaging de Twenty CRM : `convex/gmail.ts` (flow OAuth : mutation
>   `startConnect` + route HTTP `GET /gmail/oauth/callback` dans
>   `convex/http.ts` ; états anti-CSRF one-shot `gmailOAuthStates`).
> - Tables : `gmailAccounts` (une ligne par boîte, refresh token secret,
>   curseur incrémental `historyId`), `companyEmails` (un message dédupliqué
>   par `Message-ID`, texte nettoyé borné, sans pièces jointes) +
>   `companyEmailLinks` (jointure email ↔ société, fan-out multi-org).
> - Sync par cron 10 min (`crons.ts` → `gmail.syncAll`) via
>   `users.history.list` ; curseur expiré → ré-ancrage au présent (le trou
>   sera comblé par le backfill, étape à venir). `invalid_grant` → statut
>   « à reconnecter ».
> - Matching **déterministe** (pas de LLM) : domaine des participants ==
>   `companies.domain` (kind `portfolio`, non archivée), freemail et domaines
>   des boîtes connectées exclus, mails 100 % internes ignorés.
> - Registre : entrée `gmail` (auth `webview`, scope global) dans
>   `convex/lib/connectors.ts` ; dispatch webview par plateforme dans
>   `connections.listIntegrations`/`status`/`syncNow`. Front : onglet Emails
>   (`CompanyEmailsSection.tsx`) sur `participations.$companyId.tsx`,
>   connexion/déconnexion sur la page Intégrations.
> - Env : `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (client
>   OAuth dédié au scope `gmail.readonly` — distinct du client de sign-in
>   `GOOGLE_CLIENT_ID`). Cf. `KNOWN_ISSUES.md` « Connecteur Gmail ».

## v1.116.0 — 21/07/2026 à 16:59 — Parallel : rattacher un SPV détenu même sans communication

Jusqu'ici, la liste de rattachement d'une entité à un deal Parallel ne
proposait que les SPV ayant **déjà publié une communication** (reporting,
coupon, avis…). Un SPV que vous détenez mais qui n'a encore rien communiqué
— par exemple une opération tout juste closée — restait introuvable dans la
liste, impossible à rattacher.

Désormais, la liste s'appuie **aussi sur votre portefeuille Parallel** : tout
SPV que vous détenez apparaît et peut être rattaché, sans attendre sa première
communication. Et le rattachement pointe sur le bon émetteur, donc dès qu'une
communication arrive, elle remonte automatiquement dans l'onglet Rapports de
l'entité — rien à refaire.

Après la prochaine synchronisation (ou un clic sur **« Rafraîchir »**), les
SPV manquants apparaissent dans la liste.

> **🔧 Notes techniques**
>
> - Le sélecteur d'émetteurs (`vasco.listCachedVascoIssuers`) est désormais
>   alimenté par **deux sources unies** : les communications
>   (`vascoCommunicationsCache`) **et** le portefeuille détenu
>   (`vascoPortfolioIssuers`, nouvelle table). Union dédupliquée sur
>   `clientSlug:issuerId`.
> - Nouveau chemin API VASCO, indépendant des communications :
>   `GetAccount.accountSecurityContracts → security → company { id label }`
>   (`GET_PORTFOLIO_ISSUERS` + `pullPortfolioIssuers` dans `convex/vasco.ts`).
>   `Security.company` et `Communication.issuer` sont tous deux le type
>   `Company`, donc `company.id === issuer.id` : l'id stocké via le
>   portefeuille réconcilie avec les futures communications (c'est ce qui
>   garantit la remontée). Best-effort : un champ non lisible par la persona
>   investisseur revient `null` → ignoré, jamais deviné.
> - Pull branché sur `refreshVascoCacheForOrg` (cron 48 h + bouton
>   « Rafraîchir »), isolé du pull communications (un échec n'affecte ni ne
>   vide l'autre cache). Remplacement atomique par `(orgId, clientSlug)` via
>   `replacePortfolioIssuersCache`.
> - Sonde de vérification prod `vasco:probePortfolioIssuers` : confirme la
>   lisibilité du chemin et la réconciliation des id (les SPV présents dans les
>   deux sources tombent dans `inBothCount` ; les détenus-sans-comm dans
>   `portfolioOnly`). Front inchangé (même forme de retour).

## v1.115.1 — 21/07/2026 à 13:15 — Barre latérale : Membres et Invitations retirés du menu (doublon avec Paramètres)

« Membres » et « Invitations » n'apparaissent plus dans le menu de gauche :
ces deux entrées faisaient **doublon** avec les onglets du même nom déjà
présents dans **Paramètres**. On les retrouve désormais à un seul endroit — la
page **Paramètres** — ce qui allège le bas du menu, qui ne garde que Paramètres
et Nouveautés.

> **🔧 Notes techniques**
> Retrait des deux `NavLeaf` (`items.members`, `items.invitations`) du groupe
> secondaire `groups.workspace` dans `getNavGroups()`
> (`src/components/app-shell/nav.ts`) ; imports d'icônes `Users`/`Mail` devenus
> inutiles supprimés. Clés i18n orphelines `items.members`/`items.invitations`
> retirées de `src/locales/{fr,en}/nav.json` (les clés `appShell.breadcrumb.*`
> restent, utilisées par le fil d'Ariane). Aucune perte d'accès : les onglets
> Membres/Invitations vivent dans `/app/$orgSlug/settings`. TESTING.md (SH1)
> mis à jour.

## v1.115.0 — 21/07/2026 à 12:55 — Score IA : pastille en anneau et tri sur la table Entreprises

Le score IA de santé est plus lisible et plus actionnable sur la page
Entreprises :

- il s'affiche désormais en **pastille « anneau »** — une jauge circulaire
  dont l'arc se remplit selon la note sur 10, colorée en vert / orange /
  rouge selon le verdict — à la place de l'ancien carré ;
- la colonne **se trie** : un clic sur l'en-tête classe les sociétés par
  note (les meilleures d'abord, un second clic inverse) ; les sociétés sans
  synthèse passent en fin de liste ;
- la **même pastille** est reprise sur la fiche entité, pour garder la
  lecture cohérente entre la liste et le détail.

Les seuils de couleur restent inchangés (vert ≥ 7, orange 5-6, rouge ≤ 4),
donc la couleur reste alignée avec le texte de verdict de la fiche.

> **🔧 Notes techniques**
>
> - Nouveau composant partagé `ScoreRing` (`src/components/companies/ScoreRing.tsx`) :
>   jauge SVG (arc = `score/10`, `-rotate-90` pour démarrer en haut), couleur
>   dérivée de `scoreVerdict` (seuils inchangés), tokens `positive` / `warning`
>   / `destructive`, deux tailles `sm` (table) et `lg` (hero fiche). Source
>   unique → cohérence table ↔ fiche garantie.
> - `ParticipationsTable.tsx` : la colonne « Score IA » passe sur `ScoreRing` et
>   devient triable (`SortKey` étendu à `'aiScore'`, tri client-side, notes
>   absentes → `NEGATIVE_INFINITY` donc en fin de liste en desc ; en-tête via
>   `SortableHead`, non triable sur la table « Soldées »).
> - `CompanyAiSynthesisBlock.tsx` : le carré du hero de synthèse est remplacé
>   par `ScoreRing size="lg"`.
> - `reportScore.ts` : `verdictSquareClass` / `VERDICT_SQUARE` retirés (devenus
>   orphelins) ; `scoreVerdict` conservé (couleur de l'anneau + texte de verdict).

## v1.114.0 — 21/07/2026 à 12:45 — Intégrations : corriger une connexion en un clic

Quand une connexion à un portail investisseur (Parallel / VASCO) est en
erreur, plus besoin de la supprimer puis la recréer : un bouton **Modifier**
(crayon) ouvre le formulaire pré-rempli (nom, portail), il suffit de
ressaisir les identifiants et d'enregistrer. Une synchronisation est
relancée aussitôt pour vérifier que la connexion refonctionne — la pastille
passe au vert dans la foulée (ou affiche la nouvelle erreur, le cas
échéant). Les identifiants déjà enregistrés ne redescendent jamais dans le
navigateur : ils se remplacent, ils ne se consultent pas.

> **🔧 Notes techniques**
>
> - `convex/connections.ts` : mutation `updateConnection` (admin-gated sur
>   l'org de la ligne, validée `parseConnection`, unicité du label hors
>   soi-même, `lastError` purgé, `active: true` reposé) ;
>   `listIntegrations` expose désormais `config` (non-secret, registre
>   `configKeys`) pour pré-remplir le formulaire — jamais `credentials`.
> - `settings/integrations.tsx` : bouton crayon par connexion credentials
>   (admin) ; `ConnectDialog` gagne un mode édition (`existing` +
>   `onSaved`) qui appelle `updateConnection` puis déclenche `syncNow`
>   (plateformes `manualSync`) pour retamponner l'état réactivement.
> - i18n FR/EN (`settings:integrations` : `actions.edit`,
>   `dialog.editTitle/editDescription`, `toasts.updated`) ; TESTING.md
>   (IG10) et doc produit Intégrations à jour.

## v1.113.0 — 21/07/2026 à 12:38 — Liste Entreprises : le one-liner s'élargit sur grand écran

Dans la liste Entreprises, la colonne **One-liner** ne reste plus coincée à
une largeur fixe : sur les écrans larges, elle s'élargit par paliers pour
afficher davantage du pitch. Le texte complet reste accessible au survol tant
qu'il dépasse encore la place disponible. Fini les grands blancs entre les
colonnes pendant que le one-liner était rogné.

> **🔧 Notes techniques**
>
> - `src/components/participations/ParticipationsTable.tsx` (`OneLinerCell`) :
>   le plafond `max-w-72` (288 px) devient responsive — `lg:max-w-sm`
>   (384 px), `xl:max-w-md` (448 px), `2xl:max-w-lg` (512 px) — appliqué à la
>   fois sur le `<span>` simple et sur le `<button>` tronqué.
> - La mesure existante (`ResizeObserver` comparant `scrollWidth > clientWidth`)
>   se recalcule au resize et bascule seule entre texte simple et
>   bouton-popover : le popover ne subsiste que tant que le texte est tronqué.
> - Aucune autre colonne touchée — le tableau reste en `table-layout: auto`,
>   le one-liner absorbe simplement l'espace horizontal restant via son
>   plafond élargi.

## v1.112.1 — 21/07/2026 à 12:20 — Intégrations : état de connexion honnête et erreurs visibles

Fin des signaux contradictoires sur les connexions aux portails
investisseurs (Parallel / VASCO) :

- la « dernière synchro » affichée est désormais celle de la dernière
  synchronisation **réussie** — une connexion en erreur ne peut plus
  afficher pastille rouge et « dernière synchro il y a 5 secondes » en
  même temps ;
- une connexion en erreur affiche **le message d'erreur** sous sa ligne
  dans Réglages → Intégrations, pour voir immédiatement ce qui bloque
  (identifiants refusés, portail injoignable…) ;
- sur la fiche entité, le dialog « Rattacher à une intégration » montre
  l'état réel de la plateforme (pastille rouge si la connexion est en
  erreur, plus jamais verte à tort) ;
- quand la connexion est en erreur, le sélecteur de deals du portail
  l'explique clairement au lieu d'un « Aucun deal disponible » muet.

> **🔧 Notes techniques**
>
> - `convex/connections.ts` : `markConnected` ne tamponne plus
>   `lastConnectedAt` sur un échec (seul `lastError` est posé) —
>   `lastConnectedAt` signifie désormais « dernier succès » ;
>   `listIntegrations` expose `lastError` (sanitisé, jamais de secret)
>   pour les connexions credentials et webview.
> - `settings/integrations.tsx` : message `lastError` affiché sous une
>   connexion en erreur.
> - `EntityIntegrationsDialog.tsx` : pastille agrégée honnête
>   (verte seulement si une connexion est `connected`, rouge si
>   erreur, ambre sinon).
> - `VascoCommunicationsSection.tsx` (`VascoLinkDialog`) : lit l'état de
>   connexion via `listIntegrations` et affiche `link.connectionError`
>   quand la connexion échoue et que le cache d'émetteurs est vide.

## v1.112.0 — 21/07/2026 à 11:53 — Rattacher une intégration depuis la fiche entité

Le rattachement d'une participation à un portail investisseur (Parallel /
VASCO) se fait désormais depuis le menu **⋯** de sa fiche : « Rattacher à
une intégration ». Le dialog montre les plateformes rattachables avec leur
état de connexion — si la plateforme est connectée, on choisit l'émetteur
dans la liste ; sinon, un lien renvoie vers Réglages → Intégrations.

Deux effets concrets :

- **toute entité du portefeuille peut être rattachée**, quel que soit son
  nom — jusqu'ici, le rattachement n'était proposé que sur les entités dont
  le nom évoquait le portail, ce qui rendait certaines participations
  impossibles à relier ;
- **l'onglet Rapports est plus propre** : le bandeau « Connecter VASCO »
  disparaît ; les communications investisseurs ne s'affichent que sur les
  fiches réellement rattachées.

> **🔧 Notes techniques**
>
> - Flag `entityLink` au registre (`lib/connectors.ts`, vasco seul), exposé
>   par `connections.listIntegrations`.
> - Nouveau `EntityIntegrationsDialog` (`src/components/companies/`) : liste
>   des plateformes `entityLink` avec état de connexion, bascule vers le
>   picker `VascoLinkDialog` (ex-`LinkParallelDialog`, exporté).
> - Entrée « Rattacher à une intégration » dans le menu ⋯ de
>   `participations.$companyId.tsx` (entités `portfolio` uniquement).
> - `VascoCommunicationsSection` simplifiée : rendu uniquement si rattachée ;
>   heuristique par slugs connectés + CTA retirés, query
>   `vasco.listConnectedClientSlugs` supprimée (orpheline), clés i18n
>   `vasco:link.prompt`/`cta` retirées.

## v1.111.6 — 21/07/2026 à 11:03 — Intégrations : formulaire et liste plus clairs

Deux améliorations de lisibilité sur la page Réglages → Intégrations :

- **Le formulaire « Connecter » explique chaque champ** : « Portail » montre
  un exemple et précise où trouver l'identifiant (le début de l'adresse web
  du portail — « parallel » pour parallel.vasco.fund), et les champs
  identifiant / mot de passe indiquent qu'il s'agit de vos accès à ce
  portail.
- **La liste respire, façon Attio** : l'état d'une connexion est porté par
  une simple pastille de couleur (verte / orange / rouge, libellé au
  survol) au lieu d'un badge texte ; la dernière synchro est alignée à
  droite, distincte de la description de la plateforme ; le bouton
  « Connecter » n'est mis en avant que tant qu'aucune connexion n'existe
  (ensuite, un discret « Ajouter ») ; la déconnexion devient une icône
  sobre en bout de ligne.
- **Synchroniser à la demande** : les plateformes qui s'y prêtent (portails
  investisseurs — les banques, elles, poussent leurs données toutes seules)
  gagnent un bouton de synchronisation manuelle ; la pastille et la
  « dernière synchro » de chaque connexion se mettent à jour en direct,
  succès comme échec.

> **🔧 Notes techniques**
>
> - `ConnectDialog` (`settings/integrations.tsx`) : aide et placeholder par
>   champ résolus depuis l'i18n **par plateforme**
>   (`settings:integrations.fieldHelp.<platform>.<key>` /
>   `fieldPlaceholders.<platform>.<key>`, rendu `FieldDescription`) — le
>   formulaire reste générique, une nouvelle plateforme documente ses champs
>   en ajoutant ses clés i18n. Libellé `fields.clientSlug` simplifié en
>   « Portail ».
> - `PlatformRow` : `STATE_PILL` remplacé par `StateDot` (pastille `size-2`,
>   libellé en `title`/`aria-label`) ; ligne de connexion en
>   `justify-between` (synchro `text-xs tabular-nums` à droite) ; bouton
>   connect `outline` → `ghost` « Ajouter » dès qu'une connexion existe ;
>   déconnexion en `icon-sm` ghost ; clé i18n `integrations.none` retirée
>   (redondante avec le groupe « Disponibles »).
> - Sync manuelle : flag `manualSync` au registre (`lib/connectors.ts`,
>   vasco seul), action `connections.syncNow` (org-member-guarded, dispatch
>   par plateforme → `vasco.refreshVascoCacheForOrg`), qui tamponne
>   désormais `markConnected` (succès/erreur) sur chaque connexion tentée —
>   la page se met à jour réactivement. Bouton `RefreshCw` sur la ligne
>   plateforme.

## v1.111.5 — 21/07/2026 à 10:52 — Connexion instantanée au chargement

Suite du chantier vitesse : au chargement d'une page (arrivée, rafraîchissement),
l'application sait désormais **immédiatement** que vous êtes connecté. Le
serveur lit votre session dès la première requête et la transmet à la page,
au lieu de laisser le navigateur la redécouvrir en plusieurs allers-retours
successifs. Résultat : l'écran « loading » intermédiaire dure nettement moins
longtemps avant l'affichage de vos données.

> **🔧 Notes techniques**
>
> - Préchargement de session SSR (pattern officiel `@convex-dev/better-auth`) :
>   `getToken` serveur dans `src/lib/auth-server.ts` (partagé avec le proxy
>   `/api/auth`), `beforeLoad` racine qui lit le cookie et passe le JWT Convex
>   au client via le contexte déshydraté, `ConvexBetterAuthProvider` déplacé de
>   `router.tsx` vers `__root.tsx` pour recevoir `initialToken`.
> - La cascade séquentielle get-session → token → WebSocket devient
>   parallèle : le WebSocket Convex s'authentifie dès l'hydratation.
> - Garde `typeof window` dans `beforeLoad` : le contexte SSR est réhydraté
>   tel quel, les navigations SPA ne paient aucun aller-retour serveur —
>   cf. `KNOWN_ISSUES.md` « Préchargement de session SSR ».
> - `useAuthState` (garde anti-flash) volontairement intouché.

## v1.111.4 — 21/07/2026 à 10:25 — Convex à jour, et les dépendances mises à jour toutes seules

Le moteur de données de l'app (Convex) passe à sa dernière version. Et un
robot vérifie désormais chaque lundi matin si des briques logicielles de
l'app ont une nouvelle version : si oui, il prépare tout seul une
proposition de mise à jour, déjà testée, qu'il ne reste qu'à valider.
Aucun changement visible dans l'app.

> **🔧 Notes techniques**
>
> - `convex` 1.38.0 → 1.42.3 (`pnpm add convex@latest`) ; `pnpm lint`,
>   `pnpm test:unit` (228) et `pnpm build` verts.
> - Nouveau workflow `.github/workflows/update-deps.yml` (lundi 06:30 UTC,
>   calqué sur `sync-skills.yml`) : `scripts/update-deps.mjs` fait un
>   `pnpm update` (dans les plages semver — jamais de saut de majeure),
>   génère l'entrée de changelog listant les paquets bumpés, puis le
>   workflow relance lint/tests/build **avant** d'ouvrir la PR
>   `chore/update-deps` (la CI ne se déclenche pas sur les PRs créées avec
>   `GITHUB_TOKEN`).
> - Contexte : `renovate.json` existe mais l'app Renovate n'a jamais exécuté
>   un seul job sur ce repo (0 PR, 0 issue, 0 branche `renovate/*`) — ce
>   workflow maison la remplace.

## v1.111.3 — 21/07/2026 à 10:04 — Fiche entité : description en bloc pleine largeur

Sur la fiche d'une entreprise, la description passe désormais dans un bloc
encadré qui occupe toute la largeur, dans le même style que le bloc
« Identité » juste en dessous. Fini la colonne de texte étroite calée à gauche
avec du vide à droite : la présentation est plus nette et cohérente avec le
reste de la fiche.

> **🔧 Notes techniques**
> Le paragraphe `summary` de l'en-tête de `participations.$companyId.tsx`
> reçoit le style du bloc Identité (`rounded-lg border p-4`) et perd son
> plafond de largeur (`max-w-3xl` retiré) : il s'étend sur toute la largeur du
> contenu au lieu d'être limité à 768 px.

## v1.111.2 — 20/07/2026 à 19:55 — Fiche entité : description alignée sous le nom

Sur la fiche d'une entreprise, le texte de description repasse toujours sous
le nom de la société, aligné à gauche. Sur les grands écrans il se retrouvait
décalé sur la droite, collé au menu d'actions — c'est corrigé.

> **🔧 Notes techniques**
> Le paragraphe `summary` de l'en-tête de `participations.$companyId.tsx`
> était un enfant du conteneur flex (`flex flex-wrap items-center`) avec
> `w-full max-w-3xl` : sur grand écran sa largeur plafonnée tenait sur la même
> ligne que le nom, et le `ml-auto` du menu le poussait à droite. Il est sorti
> de la rangée flex pour redevenir un bloc plein placé sous le nom (retrait de
> `w-full`, `max-w-3xl` conservé pour la lisibilité).

## v1.111.1 — 20/07/2026 à 19:52 — Chargement de l'application plus rapide

L'arrivée sur Albo OS (première visite de la journée, rafraîchissement de
page) devient sensiblement plus rapide, sur deux fronts :

- **Le serveur reste éveillé.** Avec deux utilisateurs, le serveur qui rend
  les pages s'endormait entre vos visites et devait redémarrer à chaque
  arrivée (1 à 3 secondes de latence à froid). Il est désormais maintenu
  chaud en permanence par un signal automatique toutes les 5 minutes.
- **Le panneau AI ne bloque plus l'affichage.** Son moteur d'affichage
  (rendu des réponses, code, tableaux) se charge désormais en parallèle,
  juste après la page, au lieu d'être téléchargé avant le premier affichage
  de chaque écran.

> **🔧 Notes techniques**
>
> - Nouveau cron Convex `warm vercel ssr` (toutes les 5 min) →
>   `convex/warmup.ts:pingSite`, un `fetch(SITE_URL)` qui garde la fonction
>   SSR Vercel chaude (garde anti-localhost identique à `convex/auth.ts`).
> - `AiPanel` passé en `React.lazy` + `Suspense` dans
>   `src/routes/app/$orgSlug/route.tsx` : le chunk du layout org tombe de
>   ~180 Ko (47 Ko gz) à ~12 Ko (3,3 Ko gz), le stack streamdown/ai-elements
>   (~90 Ko gz) sort du chemin critique de toutes les pages de l'app.
> - `convex/_generated/api.d.ts` : entrée `warmup` ajoutée à la main
>   (l'environnement distant ne peut pas lancer la codegen — cf.
>   `KNOWN_ISSUES.md` « Codegen Convex hors-ligne ») ; le prochain
>   `convex dev`/`convex deploy` la régénère à l'identique.

## v1.111.0 — 20/07/2026 à 19:41 — Intégrations : la tour de contrôle

La page **Réglages → Intégrations** devient le point d'entrée unique des
outils externes, sur le modèle des intégrations d'Attio ou Granola :

- les plateformes sont désormais présentées en deux groupes — **Installées**
  (au moins une connexion, ou service opérationnel) et **Disponibles**
  (prêtes à brancher) ;
- **connecter se fait depuis la page** : « Connecter une banque » ouvre la
  fenêtre sécurisée Powens, et les portails investisseurs (Parallel,
  Teampact…) se branchent via un petit formulaire — nom, portail,
  identifiants — sans plus passer par la ligne de commande ;
- **déconnecter aussi** : chaque connexion à identifiants peut être retirée
  (avec confirmation) — les identifiants sont oubliés, les données déjà
  importées restent ; une connexion bancaire dégradée propose son bouton
  « Reconnecter » directement ici ;
- réservé aux **admins** de l'organisation ; les identifiants saisis partent
  côté serveur et ne redescendent jamais dans le navigateur.

> **🔧 Notes techniques**
>
> - Nouvelles mutations publiques admin-gated `connections.createConnection`
>   (validée contre le registre via `parseConnection`, refus des doublons de
>   label — l'écrasement volontaire reste au CLI `connections:seedConnection`)
>   et `connections.disconnectConnection` (delete, oubli des credentials).
> - `connections.listIntegrations` enrichie : `id` par connexion
>   (`externalConnections._id` ou `powensConnectionId`) + `configKeys`/
>   `credentialKeys` du registre — le **formulaire de connexion est générique**,
>   ses champs sont pilotés par la déclaration de la plateforme
>   (`settings:integrations.fields.<key>`).
> - `settings/integrations.tsx` réécrite : groupes Installées/Disponibles,
>   webview Powens (`startBankConnection`/`startReconnect`) branchée depuis la
>   page, dialogs connect/disconnect (max-h 85vh), i18n EN/FR.

## v1.110.0 — 20/07/2026 à 17:39 — Connexions externes : socle modulaire + page Intégrations

Les connexions aux plateformes externes (banques via Powens, portails fonds
via Parallel/VASCO, extraction Notion et DocSend) reposent désormais sur un
socle commun — un registre des plateformes et une gestion unifiée des
connexions — au lieu de branchements codés au cas par cas. Ajouter une
nouvelle plateforme demain sera plus simple et plus sûr.

Et c'est désormais visible : une nouvelle page **Réglages → Intégrations**
liste, pour chaque organisation, les plateformes branchées et disponibles
avec leur état — connexions bancaires avec leur santé et leur dernière
synchro, connexion Parallel, services d'extraction (Notion, DocSend)
opérationnels ou non. Une vue d'état façon « intégrations » d'Attio ou
Granola : les actions restent sur leurs pages (la reconnexion bancaire se
fait toujours depuis la Trésorerie).

Dans la foulée, le bloc « Communications investisseurs » des fiches
participations n'est plus réservé à Parallel : il se propose désormais sur
toute entité liée à un portail investisseur **connecté** de l'organisation.
Brancher demain un nouveau portail (par exemple Teampact, également géré via
VASCO) suffira à faire apparaître ses communications — sans développement.

> **🔧 Notes techniques**
>
> - Nouveau registre `convex/lib/connectors.ts` (powens/vasco/notion/docsend :
>   portée, mode d'auth, clés requises) + noyau commun `convex/connections.ts`
>   (table générique `externalConnections`, seed/remove/list/markConnected,
>   diagnostic `connections:status` dispatché par type d'auth, jamais par
>   plateforme).
> - `convex/vasco.ts` devient le module de référence : la logique GraphQL est
>   inchangée mais lit ses connexions via le noyau (adaptateur `vascoCreds` +
>   `parseConnection`). Les fonctions maison (`vasco:seedConnection`,
>   `deleteConnection`, `getConnectionsByOrgSlug`…) sont remplacées par les
>   génériques `connections:*`.
> - `downloadDocSend` extrait de `reportExtract.ts` vers `convex/lib/docsend.ts`
>   (1 module = 1 plateforme) ; `powens.ts` expose `connectionHealth` pour le
>   statut du registre.
> - Migration one-shot idempotente `migrations/externalConnections:
migrateVascoConnections` (à lancer juste après le deploy — cf.
>   `MIGRATIONS.md`) ; table `vascoConnections` conservée déclarée-mais-inerte.
> - Page `settings/integrations` : query publique sanitisée
>   `connections.listIntegrations` (jamais de secret), pastilles d'état par
>   type d'auth (santé Powens dérivée via `connectionHealth`, état credentials
>   via `lastConnectedAt`/`lastError`, env keys pour Notion), onglet ajouté au
>   layout Réglages, i18n `settings:integrations.*` (EN/FR).
> - Détection du bloc Communications généralisée : `VascoCommunicationsSection`
>   matche les slugs des portails connectés (`vasco.listConnectedClientSlugs`,
>   query publique sans secret) au lieu du `/parallel/i` codé en dur ; libellés
>   `vasco:*` neutralisés (plus de « Parallel » en dur).
> - Tests `tests/connectors.test.ts` (intégrité du registre + validation des
>   lignes).

## v1.109.0 — 17/07/2026 à 18:28 — Pointage : les suggestions en un clic

Deuxième étape de la refonte du pointage : la file « À pointer » **propose
avant de demander**. Les lignes que l'outil sait probablement classer
portent désormais une **puce ✓ avec la cible proposée**, à côté du menu
« Affecter à… » — un clic dessus applique (avec le même « Annuler » de
5 secondes).

Deux types de propositions :

- **Virements internes détectés automatiquement** : deux mouvements de
  même montant, en sens opposés, entre deux comptes de l'organisation, à
  quelques jours d'écart — les deux jambes du virement reçoivent la puce
  « Virement interne ». Plus besoin de reconnaître les paires à l'œil.
- **Cibles apprises de l'historique** : quand des transactions au libellé
  similaire ont déjà été pointées plusieurs fois vers le même deal ou la
  même ligne de passif, la cible est proposée directement.

L'outil ne classe jamais tout seul : sans clic de votre part, rien ne
bouge. Les propositions sont volontairement prudentes — mieux vaut pas de
puce qu'une puce fausse.

> **🔧 Notes techniques**
>
> - `transactions.getPointageSuggestions` (query publique) : 30 tx
>   `unmatched` les plus récentes ; paires de virements via le nouveau
>   `convex/lib/transferPairs.ts` (pur, 4 tests — montant exact, sens
>   opposés, comptes différents, ≤ 4 j, appariement glouton au plus
>   proche) ; sinon top-1 de `lib/suggest.ts:rankCandidates` (moteur
>   partagé avec l'agent), seuil ≥ 2 libellés similaires déjà pointés.
> - Front : puce `✓ {label}` dans `RowActions` (`PointageTable.tsx`),
>   résolution des labels depuis les `listOptions` déjà chargés, clic →
>   `handleAssign` (mêmes mutations que le picker). Query active sur le
>   filtre « À pointer » uniquement (`TransactionsLedger.tsx`).
> - Docs : `TESTING.md` RU32, `docs/produit/08-pointage.md` § Les
>   suggestions (+ point d'attention virement interne mis à jour),
>   `KNOWN_ISSUES.md` § Pointage (caps et résolution client des puces).

## v1.108.0 — 17/07/2026 à 18:07 — Pointage : un seul geste, « Affecter à… »

Le pointage d'une transaction demandait de choisir d'abord un **mode** —
« Rattacher » (deal, passif) ou « Écarter » (charge, impôt, produit,
virement interne, ignorer) — puis, pour une charge ou un produit, de
préciser la catégorie dans un second temps. Ce choix de mode disparaît :

- Chaque ligne se traite désormais avec **un seul menu « Affecter à… »**,
  cherchable, qui regroupe tout : vos deals, le passif (capital, comptes
  courants), les **catégories de charges et de produits en direct**
  (salaires, honoraires, loyer… — la catégorie est posée dès le choix),
  puis Impôt, Virement interne et Ignorer.
- Choisir une entrée **applique immédiatement** — plus de bouton de
  confirmation. La bannière « Annuler » (~5 s) reste là pour se raviser,
  et « Détacher » permet toujours de revenir en arrière plus tard.
- Le menu s'adapte au sens de la transaction : une **sortie** propose les
  charges en premier, une **entrée** les produits.
- Rien ne change sur le fond : TVA ajustable sur la ligne, actions
  groupées, règles apprenantes et suggestions fonctionnent comme avant.

C'est la première étape de la refonte du pointage ; la seconde apportera
les **suggestions pré-remplies** validables en un clic.

> **🔧 Notes techniques**
>
> - `TargetCombobox.tsx` réécrit en picker unifié : `PointageTarget`
>   étendu (`category` charge/produit + `status` tax/transfer/ignored),
>   groupes Charges/Produits (feuilles = slugs de `CHARGE_CATEGORIES`/
>   `PRODUCT_CATEGORIES` + « à qualifier ») et « Autres », application
>   au `onSelect` (plus d'état armé ni de bouton Rattacher).
> - `PointageTable.tsx` : `RowActions` réduit au picker, dispatcher
>   `handleAssign` → `handleMatch` (deal/passif) ou `handleDiscard`
>   (étendu pour porter la catégorie) ; menu « Écarter » et
>   `DropdownMenu` supprimés ; aucune mutation backend nouvelle
>   (`categorizeAsCharge/Product` acceptaient déjà `category`).
> - Invariants préservés (KNOWN_ISSUES « Pointage ») : routage
>   deal→`matchTransaction` vs passif→`allocateTransaction`, règles
>   apprises seulement sur charge/impôt/produit/virement unitaires.
> - i18n : `combobox.*` enrichi, `actions.match`/`actions.discard`
>   retirés (orphelins). `TESTING.md` RU3/RU4/RU8/RU17/RU17b/RU19 ;
>   `docs/produit/08-pointage.md` § Le workflow.

## v1.107.1 — 17/07/2026 à 18:10 — Documentation : le circuit des reports par email

La documentation produit gagne une page dédiée au circuit des reports par
email : ce que fait le transfert vers l'adresse dédiée, comment la
participation est identifiée, comment chaque type de contenu est lu (PDF,
Excel, image, Notion, Drive, DocSend), comment les KPIs sont extraits et
rangés, et ce que dit le récapitulatif. Les pages Intégrations et Vue
consolidée pointent désormais vers cette référence unique.

> **🔧 Notes techniques**
>
> - Nouvelle page `docs/produit/17-reports-par-email.md` (gabarit standard : à quoi ça sert / comment ça marche / points d'attention / pages liées, encadré « Sous le capot »).
> - `docs/produit/15-integrations.md` § « Ingestion des rapports par email » réduit à un pointeur (une seule source de vérité) ; liens croisés depuis `12-vue-consolidee.md` ; ligne ajoutée au sommaire `README.md`.
> - Doc uniquement — aucun changement de code.

## v1.107.0 — 17/07/2026 à 17:50 — Prévisionnel : un seul tableau

L'onglet Prévisionnel affichait **deux tableaux** qui se ressemblaient : la
grille « Détail par catégorie et par mois » (la projection, avec le réalisé
des mois passés) et un tableau « Entrées / sorties par catégorie » purement
rétrospectif. La redondance rendait la page chargée et la différence peu
lisible.

Le tableau rétrospectif est **retiré** : la grille suffit — ses colonnes
des mois passés montrent déjà ce qui s'est réellement passé, catégorie par
catégorie, et ses colonnes futures la projection, dans un seul et même
tableau. Les anciens liens vers l'onglet « Analyse » continuent d'atterrir
sur le Prévisionnel.

> **🔧 Notes techniques**
>
> - Suppression de `src/components/cash/CategoryBreakdown.tsx` et de la
>   query `convex/transactions.ts:getCategoryBreakdown` (plus aucun
>   consommateur) ; import retiré de `cash.index.tsx`.
> - i18n : bloc `cash:analysis` réduit à `inflows`/`outflows` (utilisés par
>   la grille `ForecastGridSection`).
> - Docs : `TESTING.md` (intro niveau 3, lignes AN1–AN3 retirées),
>   `docs/produit/07-tresorerie.md` § Analyse rétrospective,
>   `09-previsionnel.md`.

## v1.106.0 — 17/07/2026 à 17:50 — Fiche KPI cible par participation

Chaque participation peut maintenant porter sa **fiche de KPIs suivis** :
la liste des indicateurs (issus du catalogue) que vous voulez voir dans
chaque report — par exemple GMV, burn, runway pour Tango. La fiche
s'édite en deux clics sur la page de la participation (section KPIs), et
si elle est vide au premier passage, les métriques déjà vues dans les
reports passés sont pré-cochées : une validation suffit.

Effet sur le circuit des reports : l'extraction cherche ces KPIs en
priorité (une seule valeur par KPI, celle qui couvre la période — fini
les doublons type « GMV du trimestre » + « GMV du mois record »), et le
récap email affiche une **checklist nette** : ✅ trouvé avec sa valeur,
⚠️ absent de ce report. Les récaps deviennent comparables d'un trimestre
à l'autre. Sans fiche définie, rien ne change pour la boîte.

> **🔧 Notes techniques**
>
> - Schéma : `companies.kpiTargets` (clés catalogue, validées par `sanitizeKpiTargets` dans `companies.update` — dédup + filtre + cap 15). Helpers `sanitizeKpiTargets`/`targetsPromptList` dans `convex/lib/metricCatalog.ts` (testés).
> - `convex/reportStore.ts` : union des fiches des entités matchées → bloc « KPIs CIBLES » injecté dans le prompt d'extraction (règle : une valeur par cible, celle couvrant la période ; stocks = fin de période) ; checklist calculée en code et passée au récap. `missingUsual` désactivé quand une fiche existe.
> - Récap (`convex/reportNotify.ts` + `convex/emailTemplates.ts`) : section « KPIs cibles » ✅/⚠️, les métriques hors fiche passent sous « Autres métriques enregistrées ».
> - UI : `src/components/companies/KpiTargetsCard.tsx` (badges + dialog cochable, pré-cochage depuis les KPIs déjà vus), montée dans `KpisSection`. i18n `participations:kpiTargets` fr+en. TESTING R31–R33.

## v1.105.0 — 17/07/2026 à 17:45 — Nouvel onglet « À faire » : tout ce qui attend une action

Un nouvel onglet **À faire** apparaît dans la barre latérale, juste sous le
Tableau de bord. Il rassemble sur une seule page tout ce qui attend une
action dans l'organisation — la page à ouvrir en début de journée :

- **Connexions bancaires** : si une banque demande une reconnexion ou n'a
  plus synchronisé, la bannière d'alerte de la Trésorerie s'affiche en haut.
- **Tâches** : une liste de tâches manuelles partagée dans l'organisation —
  on ajoute en une ligne, on coche quand c'est fait, on supprime au besoin.
- **Transactions à pointer** : le compteur de la file de pointage, un aperçu
  des dernières transactions en attente et un bouton direct vers l'onglet
  Transactions.
- **Échéances en retard** : les entrées du prévisionnel dont la date est
  passée sans réalisation (même définition que le badge « En retard »).
- **Reportings manquants** : les participations qui envoyaient des rapports
  et sont silencieuses depuis plus de 3 mois, avec lien vers leur fiche.

Tout sauf les tâches est automatique : un item disparaît de lui-même dès que
l'action est faite. Un récap hebdomadaire par email est prévu dans un second
temps.

> **🔧 Notes techniques**
>
> - `convex/todo.ts` : query `getTodo` (compteur + aperçu des transactions
>   `unmatched` via `by_org_matchStatus`, participations silencieuses —
>   portfolio non archivées, cible d'un deal `active`/`partially_exited`,
>   ≥ 1 `companyReports`, dernier reçu (`emailDate`) > 90 j — et tâches) +
>   mutations `createTask`/`setTaskDone`/`removeTask`. Nouvelle table
>   `todos` (orgId, title, status open/done, index `by_org`).
> - Réutilisation côté client : `powens.listConnections` (via le composant
>   `ConnectionsBanner` existant) et `forecasts.getUpcomingEntries` filtrée
>   sur `overdue` — aucune logique dupliquée pour ces deux signaux.
> - Front : `src/routes/app/$orgSlug/todo.tsx`, entrée nav (`nav.ts`,
>   icône ListTodo) + breadcrumb (`AppHeader.tsx`), namespace i18n `todo`
>   (en/fr). `convex/_generated/api.d.ts` resynchronisé à la main (codegen
>   indisponible dans l'environnement).

## v1.104.0 — 17/07/2026 à 17:34 — Prévisionnel : « Capital engagé non appelé » (fin des miettes)

La carte « Reste à déployer (deals signés) » affichait aussi les **petits
écarts de virement** — quelques euros de différence entre le montant engagé
sur un deal et ce qui a réellement été viré (arrondis, frais bancaires).
Ces miettes ne seront jamais « déployées » : ce ne sont pas des appels de
fonds à venir.

- La carte est **renommée « Capital engagé non appelé »** — son vrai sens :
  le capital promis (fonds à appels progressifs, tranches à venir) qui
  sortira un jour mais n'a pas de date.
- Les écarts **inférieurs à 1 % du montant engagé** sont désormais ignorés,
  sur la carte du Prévisionnel comme sur la ligne « Reste à déployer » des
  fiches deal. Un vrai appel de fonds reste toujours affiché.

> **🔧 Notes techniques**
>
> - `convex/forecasts.ts` : constante `PIPELINE_RESIDUAL_RATIO = 0.01`
>   appliquée dans `getCommittedPipeline` (skip du deal) et
>   `getDealForecast` (`remainingCents` forcé à 0) — les résidus concernés
>   sur albo : Hectarea 86,88 €, Ouisub 10 €, Komeet 7,83 €.
> - i18n `forecast.pipeline.title`/`hint` (fr/en) ; `TESTING.md` FC14 +
>   FC27 ; `docs/produit/09-previsionnel.md`.

## v1.103.0 — 17/07/2026 à 10:15 — Prévisionnel : des suggestions de règles plus généreuses

Le détecteur de flux récurrents (la carte « Règles suggérées ») était trop
timide : il exigeait des montants quasi identiques, trois occurrences
minimum quelle que soit la fréquence, et ne regardait que 12 mois en
arrière — beaucoup de vrais récurrents passaient sous le radar. Il est
recalibré :

- **Fenêtre élargie à 24 mois** d'historique : les flux **annuels**
  (assurances, cotisations, taxes) deviennent détectables, et les
  trimestriels ont plus de matière.
- **2 occurrences suffisent** pour un flux trimestriel ou annuel — un seul
  intervalle propre est déjà un bon signal. Les mensuels et hebdos gardent
  le seuil de 3 (deux virements espacés d'un mois ne font pas un loyer).
- **Montants variables acceptés** : une facture de rattrapage ou un
  prélèvement fluctuant (énergie, intérêts) ne disqualifie plus le flux.
  Il suffit que la majorité des montants soient proches de la médiane ; le
  montant proposé est la médiane, et la fourchette observée (min → max)
  reste affichée sur la carte pour juger avant de créer la règle.

Rien ne change au principe : l'outil **suggère**, la création d'une règle
reste toujours votre geste (dialogue pré-rempli), et « Ignorer » reste
définitif.

> **🔧 Notes techniques**
>
> - `convex/lib/recurrenceDetection.ts` : `DETECTION_MIN_OCCURRENCES_LONG
= 2` (trimestriel/annuel, appliqué après `detectFrequency`),
>   stabilité des montants en règle **majoritaire** (`≥ 60 %` dans
>   `±40 %` de la médiane, constantes `DETECTION_AMOUNT_MAJORITY` /
>   `DETECTION_AMOUNT_TOLERANCE`) au lieu du gate tous-montants ±30 %.
> - `convex/forecasts.ts` : `DETECTION_LOOKBACK_MONTHS` 12 → 24.
> - Tests unitaires mis à jour + nouveaux cas (trimestriel/annuel à 2
>   occurrences, outlier toléré, groupe majoritairement instable rejeté) —
>   `tests/recurrenceDetection.test.ts`, 213 tests verts.
> - Docs : `TESTING.md` FC21, `docs/produit/09-previsionnel.md`,
>   `KNOWN_ISSUES.md` (calibrage documenté), hint i18n de la carte.

## v1.102.0 — 17/07/2026 à 09:45 — Trésorerie : alerte email sur les échéances en retard

Une échéance attendue (loyer, appel de fonds, TVA…) qui dépasse sa date
sans être rapprochée d'une transaction réelle passait inaperçue : elle
restait simplement listée « en retard » dans le prévisionnel, à charge d'y
penser. Désormais, **un email récapitulatif** part automatiquement :

- Déclenché quand une échéance attendue dépasse sa date de **plus d'un
  jour** (le temps que la banque synchronise et que le rapprochement se
  fasse normalement).
- L'email liste **toutes** les échéances en retard — date, libellé,
  montant — avec un lien direct vers l'onglet Prévisionnel pour les
  traiter : rapprocher, re-dater, ou annuler.
- Anti-harcèlement : un seul envoi quand de **nouvelles** échéances
  passent en retard. Pas de rappel quotidien pour le même stock — le
  prévisionnel reste l'écran de référence.

C'est la troisième alerte automatique de la Trésorerie, avec l'alerte de
seuil de solde et la surveillance des connexions bancaires.

> **🔧 Notes techniques**
>
> - `convex/forecasts.ts:checkOverdueEntries` (internalMutation, cron
>   quotidien 07:10 UTC dans `convex/crons.ts`) : en retard = `pending` +
>   EUR + `date < now − OVERDUE_GRACE_MS` (1 jour) ; envoi seulement si une
>   échéance a franchi la limite depuis le run précédent
>   (`OVERDUE_NEW_WINDOW_MS` = cadence du cron — anti-spam **sans état**,
>   cf. `KNOWN_ISSUES.md` « Cash flow forecast » : ne pas changer la
>   fréquence du cron sans ajuster la fenêtre).
> - `convex/emailTemplates.ts:overdueEntriesEmail` : template bilingue,
>   max 8 lignes + « + N », CTA vers `/cash?tab=previsionnel`.
> - Tests : `TESTING.md` FC29 ; doc produit `09-previsionnel.md` § Alertes.

## v1.101.0 — 16/07/2026 à 18:06 — Trésorerie : les connexions bancaires « fantômes » deviennent visibles

Jusqu'ici, un compte bancaire pouvait sembler connecté alors que sa
connexion était **morte en silence** : établie en dehors de l'application
(c'est le cas de Qonto), elle n'était ni surveillée ni rafraîchie — sans
qu'aucun écran ne le signale. C'est corrigé :

- La section « Connexions bancaires » (onglet Règles & échéances) affiche
  désormais un état 🟠 **« Non suivie »** pour ces connexions : quelle
  banque, quels comptes concernés, la date des dernières données reçues, et
  la marche à suivre (refaire la connexion via « Connecter une banque »).
- La **bannière d'alerte** de la Vue d'ensemble les signale aussi, comme
  pour une connexion en panne.
- Chaque compte connecté affiche maintenant la **fraîcheur de sa dernière
  synchronisation** (« synchro il y a 3 h ») dans la liste des comptes ; le
  texte passe en **orange** au-delà de 48 h sans donnée fraîche — un compte
  qui décroche se voit d'un coup d'œil, sans ouvrir le détail.

> **🔧 Notes techniques**
>
> - `convex/powens.ts:listConnections` : détecte les comptes Powens-liés
>   (`powensAccountId` posé, non archivés/clôturés) dont la
>   `powensConnectionId` n'a pas de ligne `powensConnections`, groupés par
>   banque et renvoyés en `health: 'untracked'` (`lastSuccessfulSyncAt` =
>   max des `balanceAsOf`). Cause racine : connexion sous un user Powens
>   non géré → webhooks ignorés + poll aveugle (cf. `KNOWN_ISSUES.md`
>   « État Non suivie », avec le runbook `diagnoseQontoMatch` →
>   `resetQontoPowensLink` → reconnexion in-app).
> - `BankConnectionsHealth.tsx` : pastille « Non suivie » (ambre), hint
>   dédié, pas de bouton Reconnecter sur une ligne untracked ; la bannière
>   (`ConnectionsBanner`) hiérarchise action_required > stale > untracked.
> - `CashAccounts.tsx` : sous-texte de fraîcheur relatif via `useAgo`
>   (exporté de `BankConnectionsHealth`), ambre au-delà de 48 h
>   (constante miroir de `STALE_AFTER_MS`) ; clé i18n `asOf` retirée
>   (orpheline).

## v1.100.0 — 16/07/2026 à 17:21 — Trésorerie : la page repensée en quatre onglets

La page Trésorerie était devenue illisible : tout s'empilait sur un seul
écran. Elle est désormais découpée en **quatre onglets**, du plus consulté
au plus « réglage » :

- **Vue d'ensemble** — l'essentiel en une hauteur d'écran : le solde
  disponible, l'atterrissage fin de mois, et deux nouvelles tuiles **« 30
  prochains jours »** et **« 90 prochains jours »** qui détaillent chacune
  les entrées, les sorties et le net attendus. En dessous, la courbe de
  solde passé → futur — avec, nouveauté, votre **seuil d'alerte tracé en
  pointillés** sur la courbe quand l'alerte est active — puis les comptes
  bancaires, désormais regroupés **par banque** (sous-total par banque,
  entité titulaire sur chaque ligne) pour répondre d'un coup d'œil à « où
  est le cash ? ».
- **Prévisionnel** — le détail mois par mois : les échéances à venir
  (retards en tête), les rapprochements suggérés, le reste à déployer sur
  les deals signés, la grille par catégorie et par mois, et l'analyse
  rétrospective des flux (l'ancien onglet Analyse, qui fusionne ici).
- **Transactions** — inchangé : le registre complet et le pointage.
- **Règles & échéances** — tout ce qui se configure, regroupé au même
  endroit : règles récurrentes et suggestions, échéances ponctuelles, TVA,
  alerte de seuil, et connexions bancaires.

Deux **bannières d'alerte** apparaissent en tête de la Vue d'ensemble quand
quelque chose réclame votre attention : une connexion bancaire en panne
(avec le nom des banques et un raccourci pour la reconnecter), ou le seuil
d'alerte de trésorerie franchi. Plus besoin d'attendre l'email.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/cash.index.tsx` : passage de 3 à 4 onglets
>   (`apercu`/`previsionnel`/`transactions`/`gestion`), l'ancien
>   `?tab=analyse` redirige vers `previsionnel` via `validateSearch`.
> - `ForecastOverview.tsx` allégé (KPIs + courbe + bannière de seuil) ; la
>   grille catégories × mois et le pipeline engagé déménagent dans le
>   nouveau `ForecastGridSection.tsx` (sélecteur d'horizon propre).
> - `CashKpis.tsx` : tuiles composites 30/90 j (entrées/sorties/net) ;
>   `forecasts.getUpcomingEntries` renvoie désormais les bruts
>   `in30/out30/in90/out90` en plus des nets.
> - `ForecastChart.tsx` : prop `thresholdCents` → `ReferenceLine`
>   (`ifOverflow="extendDomain"`) ; seuil lu depuis `getCashAlert`.
> - `CashAccounts.tsx` : regroupement par banque (clé insensible à la
>   casse pour fusionner « PALATINE » importé et « Palatine » Powens),
>   sous-totaux, colonne Entité ; `ConnectionsBanner` ajouté dans
>   `BankConnectionsHealth.tsx`.
> - Docs mises à jour : `TESTING.md` (CA2/CA9/AN1/FC1/FC12–FC25/M1),
>   `docs/produit/07/08/09`, `KNOWN_ISSUES.md` (référence d'onglet).

## v1.99.0 — 16/07/2026 à 15:48 — Trésorerie : surveillance des connexions bancaires

Les connexions bancaires (Powens) sont désormais **surveillées en continu**.
Sur la page Trésorerie, une nouvelle section **« Connexions bancaires »**
affiche pour chaque banque connectée : son état — 🟢 **Connectée**,
🟠 **En retard** (aucune synchronisation réussie depuis plus de 48 h) ou
🔴 **À reconnecter** (la banque attend une action de votre part : nouveau mot
de passe, authentification forte…) — et la date de sa **dernière
synchronisation**.

Dès qu'une connexion se dégrade, vous recevez un **email d'alerte** (un seul
par incident, pas de rappel tant que rien ne change). La panne la plus
sournoise — la banque qui cesse silencieusement d'envoyer des données — est
détectée automatiquement : l'application va elle-même vérifier l'état des
connexions toutes les 6 heures, sans dépendre des notifications de Powens.

Un bouton **« Reconnecter »** apparaît sur toute connexion dégradée : il ouvre
le parcours bancaire en ne redemandant que ce qui manque (code, mot de passe),
sans refaire toute la connexion.

> **🔧 Notes techniques**
>
> - Nouvelle table `powensConnections` (une ligne par connexion Powens) :
>   état, `lastSuccessfulSyncAt` (le `last_update` Powens), `lastWebhookAt`,
>   `lastPolledAt`, `notifiedHealth` (anti-spam). Santé **dérivée** à la
>   lecture (`connectionHealth` dans `convex/powens.ts`) : `action_required`
>   si state ∈ {wrongpass, SCARequired, webauthRequired, actionNeeded,
>   passwordExpired, additionalInformationNeeded}, `stale` si aucun signal
>   depuis > 48 h, sinon `connected`.
> - Double alimentation : le webhook `CONNECTION_SYNCED` upserte la ligne à
>   chaque réception (y compris payload à 0 compte, cas typique d'une synchro
>   en échec) ; cron `pollConnectionsHealth` toutes les 6 h
>   (`GET /users/me/connections?expand=connector` avec le token permanent de
>   chaque org) + `evaluateConnectionsHealth` qui ré-évalue la staleness même
>   quand rien n'arrive. Une connexion absente du poll (supprimée côté
>   Powens) est retirée du suivi.
> - Alerte email aux membres de l'org sur transition vers un état dégradé
>   (`powensConnectionAlertEmail` dans `convex/emailTemplates.ts`), un email
>   par incident via `notifiedHealth`, remis à zéro au retour à la normale.
> - Reconnexion : action `startReconnect` → webview Powens `/reconnect` avec
>   `connection_id` (même posture sécurité que `startBankConnection`).
> - UI : `src/components/cash/BankConnectionsHealth.tsx` (query
>   `powens.listConnections`), section insérée sous les comptes sur
>   `/app/$orgSlug/cash`.

## v1.98.0 — 16/07/2026 à 15:57 — Deals : « Secondaire » redevient un type de tour, retiré des instruments

« Secondaire » n'est plus proposé comme **type d'instrument** à la création ou
à l'édition d'un deal. Un achat sur le secondaire se saisit désormais comme un
deal en **actions** dont le **tour** est « Secondaire » — là où cette
information a du sens. Les deals importés depuis Attio en « Secondary Shares »
arrivent maintenant en deal actions avec le tour « Secondaire » prérempli.
Rien n'est perdu par ailleurs : un _fonds_ secondaire reste un engagement dans
un **fonds** de type « Secondaire ».

> **🔧 Notes techniques**
>
> - Retrait de `'secondary'` de `INSTRUMENTS` (`convex/lib/instruments.ts`) ;
>   le round type `'secondary'` (dans `ROUND_TYPES`) est inchangé. Nettoyage
>   des mappings d'archétype (`instrumentMapping.ts`), du picker d'édition
>   (`deals.$dealId.tsx`), du regroupement front (`ParticipationsTable`), des
>   labels i18n (`participations.json`, `chat.json`), de l'import Airtable
>   legacy et d'un commentaire de schéma.
> - Sync Attio (`convex/lib/attioSync.ts` + `convex/attioSync.ts`) :
>   « Secondary Shares » → instrument `share`, avec `roundType: 'secondary'`
>   posé **à la création uniquement** (helper pur
>   `secondaryRoundFromInstrumentRaw`, testé) pour ne pas écraser une édition
>   manuelle ultérieure.
> - Aucune migration : le seul deal historiquement sur l'instrument `secondary`
>   (Oprtrs & Co) a déjà été reclassé en `carry_vehicle` (cf. #231), donc plus
>   aucun deal ne porte `'secondary'` → le resserrement du validateur se
>   déploie sans opération prod.

## v1.97.0 — 16/07/2026 à 15:19 — Deals : nouveau type d'instrument « Structure de carried »

Un **nouveau type d'instrument** rejoint la liste des deals : **« Structure de
carried »**. Il modélise une **participation (equity) qu'on détient dans un
véhicule dédié au carried interest** — une « Manco » —, typiquement
**OPRTRS & Co** : on détient des titres d'une structure qui, elle, reverse du
carried.

C'est un type **distinct de « Lead SPV (gestion) »** : ce dernier suit **nos
revenus** quand c'est **nous** qui gérons un SPV (frais + carried), alors que
« Structure de carried » suit une **participation qu'on détient** dans une
telle structure.

- Sélectionnable comme tout autre instrument, via **⋯ → Modifier** (dialogue
  d'édition du deal).
- Sur la fiche, il affiche : **date de closing**, **titres acquis**, **prix par
  titre** et **carried** (le taux de carried de la structure).

> **🔧 Notes techniques**
>
> - `carry_vehicle` ajouté à la liste source `INSTRUMENTS`
>   (`convex/lib/instruments.ts`) → le validateur `instrumentValidator` du
>   schéma se met à jour seul (source unique, pas de redéclaration).
> - `convex/lib/instrumentMapping.ts` : archétype `equity`, rendu `fields`, et
>   `CARRY_VEHICLE_FIELDS` = `closingDate` / `sharesAcquired` / `pricePerShare`
>   / `carriedRate` (colonnes `deals` existantes → **aucun changement de
>   schéma**). La détention % n'est volontairement pas un champ deal (calculée
>   au niveau société).
> - Ajouté au sélecteur de l'`EditDealDialog` (`INSTRUMENTS` dans
>   `src/routes/app/$orgSlug/deals.$dealId.tsx`) et libellé i18n
>   `instrument.carry_vehicle` (fr « Structure de carried » / en « Carried
>   interest structure ») dans `participations.json` **et** `chat.json`.
> - **Pas de migration** : « Oprtrs & Co » (org Albo) reste en `secondary`
>   (importé du `type_d_invest = "Secondary Shares"` d'Attio) et sera
>   rebasculé à la main dans l'app.

## v1.96.0 — 16/07/2026 à 15:14 — Deals : le titre d'un deal renommé n'affiche plus le type

Depuis la dernière mise à jour, le titre d'une fiche deal montrait **« Nom ·
Type d'instrument »**. Quand vous renommez un deal, ce **« · Type »** collé
derrière votre nom faisait doublon. Il **disparaît** : un deal que vous avez
renommé s'affiche désormais avec **son nom seul**, partout (fiche, fil
d'ariane, sélecteurs de pointage, recherche). Le type d'instrument reste bien
visible dans les **informations** de la fiche et dans la **colonne dédiée** de
la liste — et se modifie toujours via **⋯ → Modifier**. Un deal **sans nom
personnalisé** continue, lui, d'afficher le type comme titre.

> **🔧 Notes techniques**
>
> - `src/components/participations/ParticipationsTable.tsx` : `useDealTitle`
>   renvoie désormais `deal.name` seul quand un nom custom existe (fallback
>   label instrument sinon). Suppression de l'option `withInstrument`, devenue
>   sans objet.
> - `src/components/app-shell/AppHeader.tsx` : `buildDealCrumbs` appelle
>   `dealTitle(deal)` sans l'option retirée (signature allégée).
> - `src/routes/app/$orgSlug/deals.$dealId.tsx` : commentaire du titre mis à
>   jour. Ajuste le format « Nom · Type » introduit en v1.95.1.

## v1.95.1 — 16/07/2026 à 14:58 — Deals : sélecteur de type d'instrument retiré de la fiche

Sur une fiche deal, un sélecteur **« Type d'instrument »** trônait en tête de
page. En réalité il ne faisait qu'un **aperçu** : changer le type dedans
redessinait l'affichage sans **rien enregistrer** — trompeur au quotidien. Il
est **retiré**. Le type d'instrument s'affiche désormais directement dans le
**titre** de la fiche (« Nom · Type »), et se **change** comme les autres
informations via **⋯ → Modifier**.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/deals.$dealId.tsx` : suppression de l'état
>   d'aperçu local (`previewKind` / `effectiveKind` / `unsaved`) et du bloc
>   sélecteur. `InstrumentBlock` reçoit maintenant `deal.instrumentKind` et
>   `editable` (toujours vrai — l'édition inline n'est plus désactivée pendant
>   un aperçu). Titre passé de `dealTitle(deal, { withInstrument: false })` à
>   `dealTitle(deal)` pour garder le type visible.
> - Clés i18n orphelines retirées (`participations:fiche.typeLabel` et
>   `fiche.preview.*`, EN + FR). Docs à jour : `docs/produit/05-deals.md` et
>   `TESTING.md` (intro fiche deal + test FD8 réorienté). Le vrai changement de
>   type reste dans `EditDealDialog` (inchangé).

## v1.95.0 — 16/07/2026 à 14:26 — Deals : type de tour aussi sur l'equity via SPV

Le champ **« Tour »** (Pre-seed, Seed, Série A/B/C+, Bridge, Secondaire),
jusqu'ici réservé aux deals en **actions en direct**, est désormais aussi
disponible sur les deals en **equity via SPV** — c'est la même notion de tour de
financement de la société cible, que l'investissement passe en direct ou via un
véhicule intermédiaire.

- Sur une fiche deal _parts de SPV_, le champ **« Tour »** s'affiche à côté des
  valorisations et s'édite d'un clic (même liste de choix que pour un deal en
  actions).

> **🔧 Notes techniques**
>
> - `roundType` ajouté à `SPV_FIELDS` dans `convex/lib/instrumentMapping.ts`,
>   placé avant `preMoneyValuation` pour miroiter `EQUITY_FIELDS`. L'affichage
>   read-only (`InstrumentBlock`) et le dialog d'édition (`deals.$dealId.tsx`)
>   sont tous deux pilotés par `INSTRUMENT_FIELDS`, donc ce seul ajout suffit.
> - Aucun changement de schéma ni d'i18n : la colonne `deals.roundType`, le
>   format `enum`, les valeurs `ROUND_TYPES` et les libellés
>   `field.roundType` / `enum.roundType.*` (fr + en) existaient déjà pour
>   l'equity direct `share` et sont réutilisés tels quels.

## v1.94.0 — 16/07/2026 à 13:54 — Deals : montant unique et cohérent en tête de fiche

Suite d'ALB-55 : en tête d'une fiche deal (et dans les colonnes de la ligne
« Deals » d'une fiche entité), on voyait à la fois **« Engagé »** et
**« Décaissé (réel) »** — identiques pour un deal direct, donc redondants.

- Un deal **investi** n'affiche plus que le **« Décaissé (réel) »** (le montant
  réellement viré, calculé depuis les transactions pointées) + « Reçu ».
- Un deal encore en **term sheet** affiche le **« Engagé prévisionnel »** (le
  montant du TS) — puisque rien n'a encore été décaissé.
- Les **fonds** gardent bien les deux (« Engagé » = ce qu'on committe et
  « Décaissé (réel) » = capital appelé & versé), car ils diffèrent réellement.

> **🔧 Notes techniques**
>
> - Helper partagé `dealAmountTiles(deal)` dans
>   `src/components/participations/ParticipationsTable.tsx` : renvoie les tuiles
>   de montant selon `isFund` (`fund_lp`/`secondary`) et `status === 'pending'`.
>   Réutilisé par la fiche deal (`deals.$dealId.tsx`, grille de `Stat`) et par
>   `DealsList` (fiche entité). « Reçu » ajouté systématiquement.
> - i18n `deal.committedForecast` (« Engagé prévisionnel » / « Forecast
>   commitment »).
> - Vue agrégée « tous les deals » (`DealsListView`) et export CSV **inchangés**
>   (tableau à colonnes fixes).

## v1.93.0 — 16/07/2026 à 10:22 — Deals : un seul montant saisi, « Capital appelé » sur les fonds

Suite d'ALB-55 : on clarifie les montants sur les fiches deal, qui prêtaient à
confusion (« Montant engagé » **et** « Montant contractuel »).

- **Un seul montant saisi** sur les deals directs (actions, SAFE, obligations
  convertibles, SPV, SCPI, immobilier, placements) : « **Montant engagé** ».
  L'ancien « Montant contractuel » disparaît de ces fiches — il faisait doublon
  avec la tuile « **Payé** », déjà calculée depuis les virements rapprochés.
- Sur les **fonds**, on garde bien deux montants distincts : « Montant engagé »
  (ce qu'on s'engage à investir) et l'ancien « Montant contractuel » **renommé
  « Capital appelé »** (le capital appelé par le fonds), en plus de la tuile
  « Payé ».
- La **plus-value** d'un placement (crypto, compte de capitalisation) se calcule
  désormais à partir du « Montant engagé ».

> **🔧 Notes techniques**
>
> - `convex/lib/instrumentMapping.ts` : `paidAmount` retiré de
>   `EQUITY`/`SAFE`/`OC`/`SPV`/`SCPI`/`IMMO`/`PLACEMENT_FIELDS` ; **conservé dans
>   `FONDS_FIELDS`**. Se répercute d'un coup sur la grille de la fiche, l'édition
>   inline et le formulaire de création (tous pilotés par `INSTRUMENT_FIELDS`).
> - `src/components/deals/InstrumentBlock.tsx` : `LatentGain` (placements)
>   calcule `currentValue − (committedAmount ?? paidAmount)` (base = montant
>   investi, fallback legacy).
> - i18n `field.paidAmount` renommé « Capital appelé » / « Called capital »
>   (n'apparaît plus que sur les fonds) ; `field.committedAmount` inchangé.
> - Champ `paidAmount` **conservé au schéma** (écrit par la sync VASCO/Parallel
>   et les imports) — non affiché hors fonds, **aucune migration**. Le
>   prévisionnel n'utilise pas ce champ (le payé dérive des transactions).

## v1.92.0 — 15/07/2026 à 20:03 — Deals : création plus complète, détention au niveau société, tour « Secondaire »

Plusieurs améliorations sur les deals, remontées à l'usage :

- **Création plus complète** : le formulaire de création d'un deal propose
  désormais **tous les champs de l'instrument** choisi (montant, dates dont le
  closing, tour, valorisations, titres acquis…). Tout se saisit d'un coup —
  plus besoin de compléter la fiche après coup.
- **Titres acquis** : les deals en **actions** enregistrent le **nombre de
  titres** acquis lors du tour.
- **Prix par titre** : les deals en actions peuvent aussi renseigner le
  **prix par titre** — utile notamment pour un **secondaire** (rachat
  d'actions existantes : titres × prix).
- **Détention au niveau société** : le pourcentage de détention n'est plus
  saisi deal par deal. Il est **calculé au niveau de la société** (titres
  détenus rapportés au capital total), là où il a du sens — une société peut
  porter plusieurs deals.
- **Date de closing sur les fonds** : elle s'affiche maintenant aussi sur les
  deals de type **fonds** (elle l'était déjà pour les actions, SAFE, OC…).
- **Nouveau tour « Secondaire »** (rachat d'actions existantes) dans la liste
  des tours de table.

> **🔧 Notes techniques**
>
> - `convex/lib/instruments.ts` : `'secondary'` ajouté à `ROUND_TYPES` — le
>   validator, le champ `roundType` du schéma et les options d'édition en
>   dérivent (union élargie, rétro-compatible, **aucune migration**).
> - `convex/lib/instrumentMapping.ts` : `EQUITY_FIELDS` +`sharesAcquired` +`pricePerShare` −`ownershipPct` ; `SAFE`/`BSA`/`OC` −`ownershipPct` ;
>   `FONDS_FIELDS` +`closingDate`. `spvOwnershipPct` (SPV) laissé intact. Le
>   champ `ownershipPct` reste au schéma (données préservées, juste plus
>   affiché). `pricePerShare` était déjà câblé (format `eur`, i18n fr/en).
> - `DealFieldInput` extrait dans `src/components/deals/DealFieldInput.tsx`
>   (composant partagé édition + création). `CreateDealDialog`
>   (`participations.$companyId.tsx`) rend `INSTRUMENT_FIELDS[instrument]`
>   — hors `committedAmount`/`signedDate` gérés en champs cœur — parse via
>   `parseField` et envoie le tout à `deals.create` (déjà tolérant via
>   `...dealFields`). `DialogContent` passé en `max-h-[85vh] overflow-y-auto`.
> - Détention société **inchangée** (Σ `sharesAcquired` / `totalShares` dans
>   `participations.$companyId.tsx`), désormais alimentée par les titres saisis
>   sur les deals actions.
> - i18n `enum.roundType.secondary` (fr « Secondaire » / en « Secondary »).
> - **Hors périmètre, décision différée** : la fusion « Montant engagé »
>   (`committedAmount`) / « Montant contractuel » (`paidAmount`) n'est pas
>   traitée ici — à trancher en réunion (cf. analyse dans la PR).

## v1.91.2 — 15/07/2026 à 19:34 — Fiches SPV Parallel Calte : import des termes obligataires

Les fiches des SPV Parallel de Calte n'avaient que le montant, le nom du SPV et
la date — l'API Vasco ne donne pas les conditions de l'emprunt. Ces conditions
(taux, périodicité des coupons, remboursement, principal) vivent dans les
**contrats d'émission stockés dans le Drive**. On les récupère et on les remplit
pour le lot documenté : **SPV 4, 5, 6, 7, 11 et 13** — chacun avec son taux, sa
périodicité et sa modalité de remboursement, sourcés au contrat. **SPV 9** est
au passage requalifié en obligation **convertible** (c'en est une) avec son taux
de 12 %. Le remplissage ne touche que les champs vides et signale toute valeur
qui divergerait de l'existant. Hors de ce lot : SPV 18 (opération Vanves annulée
et remboursée — la fiche est supprimée à la main), SPV 14 et 17 (contrat absent
du Drive), SPV 2 (déjà sortie), et SPV 8 / 16 (ce sont des actions, pas des
obligations).

> **🔧 Notes techniques**
> Nouvelle migration one-shot `convex/migrations/calteInstrumentImport.ts`
> (`dryRun` / `apply` / `verify`), pendant Calte de `alboInstrumentImport.ts` et
> calquée dessus. Ancrage par `_id` prod + garde `expectedTarget` (nom de la
> company cible) ; `fill-empty-only` sur `principalAmount` (cents),
> `interestRate` (bps), `couponPeriodicity`, `repaymentModality` — `closingDate`
> / `spvName` / `paidAmount` restent gérés par le bridge Vasco
> (`vasco:backfillSpvInstruments`), `maturityDate` omis (durée contractuelle
> N mois après une « date de jouissance » non datée). Le `dryRun` renvoie un
> bloc `mismatches` (champ déjà rempli ≠ valeur du doc, jamais écrasé). Valeurs
> extraites des contrats d'émission Parallel (Drive), recoupées avec les
> positions Vasco. SPV 5 importé au taux contractuel de base (10,5 %) — un
> avenant à 13 % existe côté attestations, à arbitrer. SPV 9 requalifié `os` →
> `oc` via un champ `force` (idempotent par valeur, comme la requalif Keenest de
> `alboInstrumentImport`) + `interestRate` 12 % ; termes de conversion non
> extraits, donc non importés.

## v1.91.1 — 15/07/2026 à 18:16 — Fiches Parallel : la description colle à l'opération, pas à son avancement

La description générée pour les SPV Parallel donnait l'**actualité** de
l'opération (« première vente, remboursement partiel… ») au lieu de dire
**ce qu'est** l'opération. Corrigé : le one-liner et le résumé décrivent désormais
l'**opération telle qu'elle a été présentée** (nature, actif/secteur, géographie,
structure), **sans aucun élément d'avancement, de performance ou daté**. Pour
regénérer les fiches déjà décrites, relancer le rattrapage.

> **🔧 Notes techniques**
>
> - `companyEnrichment.ts` : `VASCO_PITCH_PROMPT` réécrit — description
>   **intemporelle** de l'opération, interdiction explicite du statut /
>   avancement / performance / daté. `getVascoEnrichmentTarget` trie les
>   communications **oldest-first** (la 1ʳᵉ = la présentation du deal) pour que le
>   contexte du prompt soit dominé par le pitch d'origine, pas les updates.
> - Régénération : `convex run --prod companyEnrichment:backfillVascoPitches '{}'`
>   (écrase les descriptions existantes).

## v1.91.0 — 15/07/2026 à 17:51 — Deals en term sheet : toujours au prévisionnel, mieux repérés, et reprise des TS en cours

Trois améliorations sur les deals qui arrivent d'Attio en **Term Sheet** :

- **Toujours une ligne au prévisionnel.** Un deal en term sheet crée maintenant
  systématiquement sa sortie anticipée — même sans date d'investissement
  renseignée dans Attio. Dans ce cas elle est posée sur le mois en cours et
  **taguée « date à préciser »** ; le tag disparaît dès que tu renseignes une
  date (dans Attio ou directement dans Albo OS).
- **Repérage « TS » partout.** Les deals en term sheet portent un badge **« TS »**
  (ambre) dans la liste des deals, sur leur fiche, et dans l'onglet
  Participations (une société qui a un deal en TS l'affiche sur sa ligne) — pour
  distinguer d'un coup d'œil ce qui est **engagé mais pas encore investi**.
- **Reprise des term sheets déjà en cours.** Les deals actuellement en term
  sheet dans Attio (pas les investis, déjà présents) peuvent être importés en une
  fois. À lancer une seule fois (voir notes techniques).

> **🔧 Notes techniques**
>
> - `attioSync.upsertDealForecastEntry` : la ligne de prévisionnel est désormais
>   **toujours** créée (montant = `value`). Sans `date_de_l_investissement` →
>   date placeholder (fin du mois courant) + champ additif
>   `forecastEntries.dateMissing: true`. Le flag saute quand Attio fournit une
>   vraie date (resync) ou via `forecasts.updateEntry` (édition manuelle) ; un
>   resync sans date ne réécrit jamais une date posée à la main.
> - Badge « TS » : i18n `participations:status.pending` = « TS », tonalité
>   `--warning` (ambre) sur la liste des deals, la fiche et la vue Participations
>   (chip `hasPending` au niveau société). Badge « date à préciser »
>   (`common:dateMissing`) sur les lignes concernées (section prévisionnel +
>   section forecast de la fiche deal).
> - Backfill : `attioSync.backfillTermSheets` (internalAction) — query paginée
>   des deals, filtre stage Term Sheet par id, chacun dans `upsertFromDeal`
>   (idempotent, ne crée jamais sur Invested). Lancer :
>   `npx convex run --prod attioSync:backfillTermSheets`.

## v1.90.1 — 15/07/2026 à 17:40 — Pont Parallel → fiches deal : pré-remplissage des instruments SPV (simulation)

Nouvel outil interne pour **réconcilier les positions Parallel (Vasco) avec les
fiches deal des SPV** et compléter les détails d'instrument manquants — montant
payé, nom du SPV, date de closing. Il tourne d'abord en **simulation** : il
propose, SPV par SPV, ce qu'il écrirait, signale les écarts avec l'existant et
les positions sans fiche (ou l'inverse), et **n'écrit rien** tant que le
remplissage n'est pas lancé explicitement. Rien de visible dans l'app à ce
stade ; c'est le socle avant de fiabiliser les fiches SPV.

> **🔧 Notes techniques**
> Ajout du pont instruments dans `convex/vasco.ts` (le pull Parallel existait
> déjà — seul le write vers les deals manquait). `backfillSpvInstruments`
> (internalAction, `convex run --prod`, `dryRun: true` par défaut) : pull des
> positions via `pullPositions`, appariement position ↔ deal par **numéro de
> SPV** (`spvNumberOf` — token « SPVn » commun au `vehicleName`/`securityName`
> Parallel et au nom de la company cible), puis proposition **fill-empty-only**
> de `paidAmount` (investedCents), `spvName` (vehicleName) et `closingDate`
> (effectiveDate). `securitiesNumber`/`priceBySecurity`/`capitalCallPercentage`
> n'ont pas de champ d'affichage pour l'archétype equity/spv_share → **reportés**
> (`extraVascoData`), jamais écrits ; un champ rempli divergent devient une
> discrepancy, jamais écrasé. `instrumentKind` non touché : la requalif
> `os → spv_share` est signalée (`needsRequalification`) mais reste manuelle.
> Écriture via `applyInstrumentBridgePatch` (marque `manuallyEditedFields`).
> Piège de cycle d'inférence TS documenté dans `KNOWN_ISSUES.md`
> « VASCO API → instrument bridge ».

## v1.90.0 — 15/07/2026 à 17:39 — Fiches Parallel : la description de l'opération est générée depuis Parallel

Les SPV Parallel n'avaient pas de description utile : le one-liner et le résumé
sous l'en-tête se basent d'habitude sur le **site web** de la société — or un SPV
n'en a pas (son domaine pointe la plateforme). Désormais, pour une entité
**rattachée à son SPV Parallel**, Albo génère ces deux champs à partir des
**communications Parallel** : nature de l'opération (promotion immobilière,
club deal, dette, foncière, tech…), **géographie** et stade. On sait d'un coup
d'œil, en arrivant sur la fiche, de quoi il s'agit.

C'est généré **automatiquement au rattachement** d'une entité à son SPV, et un
rattrapage couvre toutes les entités Parallel déjà rattachées. Ça **remplace** la
description issue du domaine (inadaptée aux SPV). Valable pour **toutes les orgs**
qui ont une connexion Parallel (Calte aujourd'hui, Albo dès qu'elle sera
branchée).

> **🔧 Notes techniques**
>
> - `companyEnrichment.ts` : 2ᵉ source de pitch « VASCO » à côté de la source
>   « site web ». `enrichFromVasco` lit les communications en cache
>   (`vascoCommunicationsCache`, filtré par `vascoClientSlug` + `vascoIssuerId`)
>   - le nom du SPV → `generatePitch` (helper LLM factorisé, `getModel()`) →
>     `applyVascoPitch` qui **écrase** `oneLiner` + `summary` (vs `applyEnrichment`,
>     additif). Skip si non rattaché / pas de comms en cache.
> - Déclencheurs org-agnostiques (pilotés par le lien VASCO, jamais l'org) :
>   `setVascoLink` planifie `enrichFromVasco` ; backfill one-shot
>   `backfillVascoPitches` (rafraîchit le cache par org puis décrit toutes les
>   entités rattachées de chaque org ayant une connexion active). cf.
>   MIGRATIONS.md.

## v1.89.1 — 15/07/2026 à 17:24 — Documentation produit complète

Albo dispose désormais d'une **documentation produit** qui explique, page par
page, comment fonctionne chaque partie de l'outil — participations, deals,
trésorerie, pointage, prévisionnel, passif, assistant IA, intégrations,
comptes et organisations. Écrite pour quelqu'un qui n'a pas construit
l'outil, en langage simple, elle décrit l'état courant de chaque
fonctionnalité (là où ces Nouveautés racontent ce qui change au fil du
temps). Elle sera tenue à jour à chaque évolution, et une copie de lecture
est disponible dans les documents du projet Linear « Albo OS ».

> **🔧 Notes techniques**
>
> - Nouveau dossier `docs/produit/` : 16 pages markdown (README sommaire +
>   15 pages par module), gabarit commun « à quoi ça sert / comment ça
>   marche / points d'attention / pages liées », rédigées depuis une
>   exploration complète du code (routes, modules Convex, agent, MCP).
> - `CLAUDE.md` : question 7 ajoutée à l'audit doc pré-PR (toute feature
>   visible ajoutée/modifiée/retirée → mettre à jour la page
>   `docs/produit/` correspondante dans la même PR) + entrée dans « Where
>   things live ». Le dossier repo est la source de vérité, miroir Linear
>   en lecture.

## v1.89.0 — 15/07/2026 à 13:40 — Communications Parallel : chargement instantané (cache + rafraîchissement automatique)

Ouvrir le rattachement à un SPV Parallel et afficher les communications d'une
entité étaient **lents** : à chaque clic, Albo se reconnectait à Parallel et
retéléchargeait tout. Désormais Albo garde une **copie locale** des
communications Parallel : l'ouverture du sélecteur de SPV **et** l'affichage des
communications sont **instantanés**. Cette copie est **rafraîchie automatiquement
tous les 2 jours** en arrière-plan, et un bouton **« Rafraîchir »** permet de
forcer une mise à jour immédiate (par exemple juste après un nouveau deal). La
toute première ouverture reste un chargement en direct — le temps de remplir la
copie — puis tout est instantané.

À noter : Parallel n'envoie aucune notification quand une communication ou un SPV
est ajouté, donc un nouvel élément apparaît au prochain rafraîchissement
(automatique sous 2 jours, ou immédiat via le bouton).

> **🔧 Notes techniques**
>
> - Nouvelle table `vascoCommunicationsCache` (1 ligne par communication ;
>   remplacement **atomique** par `(orgId, clientSlug)`). Métadonnées seulement —
>   les octets des PDF restent téléchargés en direct
>   (`downloadCommunicationDocument`).
> - `vasco.ts` : lectures **réactives** `listCachedVascoIssuers` /
>   `getCachedCommunications` (l'UI lit le cache → instantané) ; rafraîchissement
>   `refreshVascoCacheForOrg` (pull complet → `replaceCommunicationsCache`,
>   best-effort : un échec garde l'ancien cache) exposé via un cron
>   `refreshAllVascoCaches` (`crons.ts`, toutes les 48 h) **et** une action
>   publique `refreshVascoCacheNow` (org-guardée, bouton « Rafraîchir »).
>   Suppression des actions live `listVascoIssuers` / `fetchCommunications` (+ le
>   pull allégé de la v1.88.2), remplacées par le cache.
> - Front `VascoCommunicationsSection` : picker + liste lisent les queries du
>   cache ; amorçage (option 1) = un pull au 1er affichage si le cache est vide ;
>   bouton « Rafraîchir » via le hook `useVascoRefresh`. i18n
>   `vasco:communications.refreshError` (en+fr).
> - Contexte : VASCO n'expose **pas** de webhook pour le persona investisseur
>   (pull-only, vérifié sur la doc API) → cache + cron + refresh manuel est la
>   seule voie « rapide ET frais ».

## v1.88.2 — 15/07/2026 à 11:59 — Rattachement Parallel : ciblé sur les bonnes entités et plus rapide à ouvrir

Deux réglages sur la section Reports des participations :

- Le bloc **« Rattacher à Parallel »** ne s'affiche désormais **que sur les
  entités Parallel** — repérées par leur nom, leur domaine ou leur origine — et
  sur celles déjà rattachées. Fini l'encart sur les ~185 autres participations
  où il n'avait rien à faire. (Rien ne change sur les entités juridiques du
  groupe, ni sur une entité déjà liée.)
- **Ouvrir le sélecteur de SPV est plus rapide** : Albo ne télécharge plus tout
  le contenu des communications juste pour lister les SPV, seulement l'essentiel
  (nom du SPV + dernier titre).

> **🔧 Notes techniques**
>
> - `VascoCommunicationsSection` : gate resserré —
>   `looksParallel = kind === 'portfolio' && /parallel/i.test(name + domain + sponsor + group)`
>   **OU** déjà rattaché. Union multi-champs délibérée : le domaine seul n'est
>   pas fiable sur les SPV (souvent vide ou pointant la plateforme mère), le nom
>   (« PARALLEL INVEST … ») rattrape. Corrige le bruit sans retomber dans le trou
>   de la v1.86.1 (aucune entité Parallel cachée).
> - `vasco.ts` : `GET_COMMUNICATIONS_LIGHT` (émetteur + titre + dates, **sans**
>   `htmlContent` ni `communicationDocuments`) + `pullCommunicationsLight`,
>   branchés dans `listVascoIssuers`. Le picker ne rapatrie plus les corps
>   complets de toutes les communications juste pour dédupliquer les émetteurs.
>   `fetchCommunications` (liste des comms d'une entité rattachée) inchangé — il
>   a besoin des corps et des pièces jointes.

## v1.88.1 — 15/07/2026 à 11:17 — Validations « tâches planifiées » : réglage sans effet retiré

La mise à jour v1.83.3 annonçait la fin des demandes de validation à
répétition quand l'assistant gère ses rappels planifiés. En pratique ça ne
marchait pas : ces confirmations viennent de la **plateforme claude.ai**
(la couche qui fait tourner les sessions), pas de l'application — et elles
ne peuvent **pas** être désactivées depuis le dépôt. Le réglage sans effet
a donc été retiré. Aucun impact sur l'outil ; pour éviter ces fenêtres, la
seule voie reste de ne pas déclencher ces tâches planifiées.

> **🔧 Notes techniques**
> Retrait du bloc `permissions.allow` (`mcp__Claude_Code_Remote__*`) de
> `.claude/settings.json` — inefficace : testé en direct, le prompt
> réapparaît malgré la règle chargée au démarrage. Ces approbations (outils
> Routines / Remote Control) ne transitent pas par le système de permissions
> du repo, mais par la couche Remote Control de claude.ai. Piège documenté
> dans `KNOWN_ISSUES.md` (« Prompts Claude Code Remote (Routines) »).

## v1.88.0 — 15/07/2026 à 10:49 — Synthèse IA : bouton « Relancer l'analyse » et prise en compte des communications Parallel

La **synthèse IA** (« Cerveau ») de chaque fiche entité peut désormais être
**relancée à la demande** : un bouton « Relancer l'analyse » apparaît dans
l'en-tête du bloc (et sur la ligne d'attente tant qu'aucune synthèse n'existe).
Un clic lance l'analyse — le bloc passe en « Analyse en cours… » puis se met à
jour tout seul en « terminé ». Surtout, pour les entités investies via
**Parallel**, la synthèse tient maintenant compte de leurs **communications
Parallel** (titres, contenus, documents), en plus des reports reçus par mail.
Jusqu'ici la synthèse ne se déclenchait qu'à la réception d'un report par mail :
les entités Parallel, qui n'en reçoivent pas, restaient sans synthèse — elles
peuvent désormais être analysées d'un clic.

> **🔧 Notes techniques**
>
> - `intelligence.rerun` : nouvelle mutation publique (org-member-guarded) qui
>   passe la ligne `companyIntelligence` en `processing` (UI réactive immédiate)
>   puis planifie `runAnalysis`. Le trigger mail (`reportStore`, fan-out
>   d'ingestion) reste l'unique autre déclencheur — inchangé.
> - `runAnalysis` : après `getContext` (élargi pour renvoyer aussi les liens
>   `vascoClientSlug`/`vascoIssuerId`), pull **live** des communications de
>   l'émetteur VASCO lié via `vasco.pullCommunicationsForSynthesis`
>   (internalAction system-context : `getActiveConnectionsByOrgId` auth-less →
>   `pullCommunications` → filtre `issuerId`), concaténées au contexte du prompt.
>   Best-effort (`[]` si échec VASCO). Garde `no_data` ré-évaluée sur
>   (contexte **OU** comms).
> - Front : `CompanyAiSynthesisBlock` → sous-composant `RerunButton` (icône
>   refresh, spinner tant que `pending || status === 'processing'`), visible en
>   états vide/erreur/terminé. i18n `participations:intelligence.rerun` /
>   `rerunError` (en+fr). Aucun changement de schéma.

## v1.87.1 — 15/07/2026 à 12:50 — Reports par email : les liens Notion en notion.com sont détectés

Correctif sur le circuit des reports : les liens Notion au nouveau format
`notion.com` (celui que Notion génère désormais avec « Copier le lien »,
comme dans l'update Tango du jour) n'étaient pas reconnus — le report
était rangé sans la page Notion. Ils sont maintenant détectés comme les
anciens formats. Pour un report déjà rangé sans sa page Notion :
« Retraiter » depuis la page Reports entrants.

> **🔧 Notes techniques**
>
> - `convex/lib/reportLinks.ts` : troisième pattern `NOTION_PATTERNS` pour `(*.)notion.com` (ex. `app.notion.com/p/<workspace>/<page>`), avec exigence d'un id de page 32-hex dans l'URL pour ne pas embarquer les pages marketing (`notion.com/pricing`…). Les domaines historiques `notion.so` / `*.notion.site` sont inchangés.
> - Nouveau `tests/reportLinks.test.ts` (4 cas, dont l'URL Tango réelle et le cas marketing exclu).

## v1.87.0 — 15/07/2026 à 10:42 — Vos deals en term sheet arrivent tout seuls depuis Attio

Quand un deal passe en **Term Sheet** dans Attio (vous vous êtes engagé à
verser les fonds), il apparaît maintenant **automatiquement dans vos deals**
Albo OS, marqué **« Term sheet »** — visible, mais pas encore réalisé. Et une
**sortie de trésorerie anticipée** est ajoutée à votre prévisionnel, à la date
d'investissement prévue, pour mieux anticiper le décaissement.

Quand le deal passe ensuite en **Invested**, il bascule en réalisé et la ligne
du prévisionnel est confirmée (elle se soldera toute seule au pointage du vrai
virement).

Vos deals **déjà investis ne sont jamais réimportés** : la synchro ne crée un
deal qu'au stade Term Sheet, donc aucun doublon avec ce qui est déjà dans
Albo OS. À noter : la ligne de prévisionnel n'apparaît que si la **date
d'investissement** est renseignée dans Attio (sinon le deal s'affiche quand
même, sans échéance). Fonction à activer une fois côté configuration (voir
notes techniques) — tant qu'elle ne l'est pas, rien ne change.

> **🔧 Notes techniques**
>
> - Reprise du chantier « Lot 2 » (webhook Attio → deals), réécrit sur le
>   modèle prévisionnel actuel (`forecastEntries` + rattachement deal). La
>   PR #89, basée sur un `main` périmé, est remplacée.
> - `convex/attioSync.ts` : `upsertFromDeal` réel (mutation interne, écrit via
>   `ctx.db`, investisseur = `group_root` de l'org). La décision de branche est
>   **pure** dans `convex/lib/attioSync.ts` (`decideSyncAction`), testée
>   (`tests/attioSync.test.ts`). Term Sheet → deal `pending` + une
>   `forecastEntries` (`direction: out`, `confidence: expected`, `category:
deals`, `derivedKey: deal:{id}` **stable**, date = `date_de_l_investissement`,
>   montant = `value` Attio) ; Invested → statut `active` (forward-only) +
>   `confidence: confirmed`. **Jamais de création sur Invested** (verrou
>   anti-doublon). Frontière d'attribution : `pending` = Attio source (refresh),
>   `active` = Albo OS source (aucun écrasement).
> - Schéma additif : `deals.status += 'pending'`, `INSTRUMENTS += 'unknown'`
>   (fallback instrument absent/non mappé, archétype placeholder). i18n
>   `participations:status.pending` (« Term sheet ») + `instrument.unknown`.
> - Webhook durci : re-fetch transitoire (réseau / 5xx Attio) → 503 (retry) ;
>   erreur de config (secret/clé absente) → 200 (pas de tempête de retries).
> - Activation prod : `pnpm exec convex env set ATTIO_WEBHOOK_SECRET <secret>`
>   - webhook Attio `record.updated` sur l'objet `deals` → `/attio/webhook`.

## v1.86.2 — 14/07/2026 à 12:20 — Reports par email : extraction Notion fiabilisée

Correctif sur le circuit des reports : l'extraction des pages Notion
échouait systématiquement, y compris sur des pages publiques — Notion a
récemment fermé l'accès technique que le monde entier utilisait pour lire
ses pages sans navigateur. L'extraction passe désormais par un service de
rendu (la page est ouverte dans un vrai navigateur distant, son contenu est
récupéré en texte), avec l'ancienne méthode toujours tentée en premier au
cas où Notion rouvrirait l'accès. Une clé gratuite est à configurer sur
browserless.io (voir notes techniques) ; les reports Notion déjà en échec
peuvent ensuite être relancés avec « Retraiter » depuis la page Reports
entrants.

> **🔧 Notes techniques**
>
> - Diagnostic (13/07/2026) : `loadPageChunk`/`loadCachedPageChunkV2` → 400 même sur page publique (www + sous-domaine), `notion-client` npm cassé pareil, HTML public = coquille SPA, UA Googlebot → 403. Aucune voie sans navigateur — documenté dans `KNOWN_ISSUES.md` « Notion : extraction ».
> - `convex/lib/notion.ts` : chaîne API interne (auto-guérison) → **Browserless** (`POST /content`, `waitForSelector: .notion-page-content`, `bestAttempt`, HTML → texte via `htmlToText`, garde anti-coquille `MIN_USEFUL_CHARS`) → **Jina Reader** (`r.jina.ai`, payant, utilisé seulement si `BROWSERLESS_TOKEN` absent). `extractPageId` accepte aussi les UUID avec tirets.
> - Nouvel env **`BROWSERLESS_TOKEN`** (browserless.io, plan gratuit 1000 unités/mois — largement assez pour 2-3 reports/jour) : `pnpm exec convex env set BROWSERLESS_TOKEN <token> --prod`. `BROWSERLESS_URL` optionnel (région, défaut `production-sfo`). `JINA_API_KEY` reste supporté en alternative payante. Sans aucune clé, comportement précédent (échec actionnable).
> - Libellé du récap `notion_unreachable` reformulé (la cause n'est plus forcément une page privée) ; TESTING R17/R17b mis à jour.

## v1.86.1 — 14/07/2026 à 14:48 — Reportings Parallel : le rattachement s'affiche sur toutes les entités investies

Le bloc « Rattacher à Parallel » n'apparaissait que si l'entité portait la
mention « Parallel » dans un champ d'origine — du coup il restait invisible sur
beaucoup de fiches. Il s'affiche désormais sur **toutes les entités investies**,
sous forme d'un encart clair dans l'onglet Reports : un clic pour lier la fiche
à son deal Parallel, et ses communications apparaissent. (Rien ne change sur les
entités juridiques du groupe.)

> **🔧 Notes techniques**
>
> - `VascoCommunicationsSection` : suppression du gate `sponsor`/`group`. Le bloc
>   s'affiche si `company.kind === 'portfolio'` **ou** entité déjà rattachée ;
>   l'état non-rattaché passe d'un bouton fantôme discret à un encart pointillé
>   visible (nouvelle clé i18n `vasco:link.prompt`, en+fr).

## v1.86.0 — 14/07/2026 à 14:25 — Les reportings Parallel arrivent sur vos fiches deals

Les entités investies via **Parallel** (les SPV Youse, Bernay, Abel Garnier,
STOA, NG Invest…) peuvent désormais afficher leurs **communications Parallel**
directement dans l'onglet « Reports » de leur fiche : chaque annonce datée
(coupons, reportings, actualités de l'opération) avec, quand il y en a, le
**document à télécharger** (le reporting PDF). On rattache une fiche à son deal
Parallel en un clic (« Rattacher à Parallel » → on choisit le SPV) ; les
communications s'affichent alors, rafraîchies à la demande. Rien n'est stocké :
tout est lu en direct depuis Parallel. Une entité non concernée ne voit aucun
changement.

> **🔧 Notes techniques**
>
> - `convex/vasco.ts` : trois actions org-guardées, lecture live (login +
>   appels externes, non réactives) — `fetchCommunications({orgId, clientSlug,
issuerId})` (scope `GetCommunications(userId)`, filtré par issuer, tri date
>   desc), `listVascoIssuers` (émetteurs distincts + dernier titre pour le
>   picker), `downloadCommunicationDocument` (le `downloadUrl` VASCO est
>   authentifié → proxy : login + fetch bearer → `ctx.storage` → `getUrl`).
>   `htmlContent` nettoyé en texte (`stripHtml`) côté serveur.
> - Mapping entité↔émetteur **par id** : champs `companies.vascoClientSlug` +
>   `companies.vascoIssuerId` (schéma), mutation `companies.setVascoLink`
>   (set/unset ensemble ; jamais par nom, les labels sont opaques « SPVn »).
> - Front : `src/components/vasco/VascoCommunicationsSection.tsx` dans l'onglet
>   Report de `participations.$companyId` (bloc communications + dialog de
>   rattachement) ; namespace i18n `vasco` (en+fr). Le linker n'apparaît que sur
>   une entité Parallel (`sponsor`/`group`) ou déjà rattachée.
> - Détails et pièges (accès investisseur, proxy download, doublon de connexion 401) : `KNOWN_ISSUES.md` § « VASCO API » ; recette de test : `TESTING.md`
>   § « Communications Parallel ».

## v1.85.0 — 14/07/2026 à 14:23 — Le prévisionnel se rattache aux deals

Les flux prévisionnels peuvent désormais être **rattachés à un deal** — les
loyers Iroko à votre deal SCPI, un coupon à son obligation, un appel de
fonds daté à son deal signé.

- Dans les formulaires de règle récurrente et d'échéance ponctuelle, un
  nouveau champ **« Deal (optionnel) »** : choisissez le deal, et toutes
  les occurrences générées portent le lien (le retirer est tout aussi
  simple).
- La **fiche deal** gagne une section **« Prévisionnel »** : les échéances
  à venir rattachées au deal (avec leur confiance) et le reste à déployer
  engagé — juste au-dessus des transactions réalisées. Les trois couches
  au même endroit : réalisé, prévu, engagé.
- Bonus de cohérence : quand vous **rapprochez** une échéance rattachée à
  un deal avec un mouvement bancaire pas encore pointé, l'application vous
  propose dans la foulée de **pointer la transaction sur ce deal** — un
  clic dans la notification, et le geste reste explicite.
- L'assistant IA sait faire pareil : créer ou modifier une règle/échéance
  avec son deal.

> **🔧 Notes techniques**
>
> - `dealId` optionnel sur `forecastRules` (nouveau) + activation du champ
>   réservé sur `forecastEntries` (+ index `by_deal`) ; garde-fou
>   `assertDealInOrg` (`deal_wrong_org`) sur toutes les écritures ;
>   `expandRules` propage le `dealId` de la règle (insert **et** resync) ;
>   le reliquat d'un paiement partiel hérite du lien. Clear par `null`
>   (même convention wire que `category`).
> - Query `forecasts.getDealForecast` (échéances pending par `by_deal` +
>   reste à déployer, même dérivation que `getCommittedPipeline`) →
>   section `src/components/deals/DealForecastSection.tsx` sur la fiche
>   deal. Sélecteur `DealCombobox` (réutilisé du pointage) dans
>   `RuleDialog`/`EntryDialog` via `deals.listOptions`.
> - `suggestForecastMatches` renvoie `pointToDealId` (échéance liée + tx
>   non pointée) → toast avec action « Pointer sur le deal »
>   (`transactions.matchTransaction`, le pointage reste un geste distinct).
> - Outils agent : `dealId` sur create/update règle et échéance, exposé
>   dans les listes. i18n fr/en (`cash:forecast.dealLabel`,
>   `participations:dealForecast`).

## v1.84.0 — 14/07/2026 à 14:17 — Même domaine, même description

Quand plusieurs entités partagent le même site web (par exemple les différentes
sociétés « La Vie de Quartier »), elles affichent maintenant **le même
one-liner et le même résumé**, pour rester cohérentes. Concrètement :

- **Si vous modifiez le résumé de l'une, il se met à jour sur toutes** celles
  qui ont le même domaine (au sein d'un même espace) — plus besoin de recopier.
- **À la génération automatique**, une nouvelle entité reprend le texte d'une
  entité sœur déjà décrite (même domaine) au lieu d'en réécrire une variante.
- L'existant est **harmonisé** en une passe : pour chaque domaine partagé, le
  résumé le plus complet devient le résumé commun.

> **🔧 Notes techniques**
>
> - Nouveau `convex/lib/pitch.ts` : `pickCanonicalPitch` (résumé le plus long
>   du groupe) + `applyPitchToDomainGroup(ctx, orgId, domain, fields, mode)`
>   (`overwrite` = propagation/unif, `fill` = enrichissement additif). Tests
>   `tests/pitch.test.ts`.
> - `companies.update` propage un `summary` édité à tout le groupe de même
>   domaine (par org). `companyEnrichment.enrich` réutilise le pitch d'un voisin
>   (pas d'appel LLM) sinon génère ; `applyEnrichment` remplit tout le groupe en
>   mode `fill`.
> - Migration one-shot `convex/migrations/unifyDomainPitches.ts` (`dryRun`/
>   `apply`/`report`) pour figer l'existant. Invariant documenté dans
>   `KNOWN_ISSUES.md` « Pitch partagé par domaine ». `MIGRATIONS.md` mis à jour.

## v1.83.4 — 14/07/2026 à 13:53 — Nettoyage des résumés génériques par lot

Complément à l'outillage de nettoyage : le premier passage (non filtré) avait
posé un résumé sur beaucoup de lignes de plateforme (les SPV Parallel, les
opérations Anaxago, des fonds…), toutes avec le même texte générique décrivant
la plateforme plutôt que l'actif. Un outil permet maintenant de vider ces
résumés **par catégorie** en une fois, tout en préservant les résumés utiles
(lignes de deal décrivant la vraie société investie) et ceux rédigés à la main.

> **🔧 Notes techniques**
>
> - `backfillCompanyEnrichment.clearByReason({ reasons })` : vide
>   `oneLiner`+`summary` sur les entités portfolio dont le motif
>   `classifyExclusion` est dans la liste passée (buckets plateformes/
>   véhicules). Ne touche jamais `side_deal` (décrit la boîte sous-jacente) ni
>   `lvdq_sub_entity` (curé) sauf si explicitement nommés. Complète
>   `clearByIds` (liste d'id) et `listEnrichedNonCompanies` (revue).
> - `MIGRATIONS.md` mis à jour.

## v1.83.3 — 14/07/2026 à 13:39 — Moins d'interruptions de l'assistant sur les tâches planifiées

L'assistant n'a plus besoin d'une validation manuelle à chaque fois qu'il
crée, met à jour ou supprime un **rappel planifié** (par exemple la
revérification automatique d'une pull request). Ces actions n'ont aucun
effet sur vos données : elles sont désormais autorisées d'office — fini les
clics de confirmation à répétition.

> **🔧 Notes techniques**
> Ajout d'un bloc `permissions.allow` dans `.claude/settings.json`
> auto-autorisant les 4 outils de planification du serveur MCP « Claude
> Code Remote » : `create_trigger`, `update_trigger`, `delete_trigger`,
> `send_later`. Périmètre volontairement restreint à ces 4-là (pas de
> `fire_trigger` ni `list_triggers`). Config versionnée et partagée → vaut
> pour les deux utilisateurs ; effet immédiat en session, persistance
> assurée par le commit (le conteneur des sessions web est recréé à zéro,
> seul le versionné survit).

## v1.83.2 — 14/07/2026 à 13:20 — Résumés : exclure les produits d'épargne et nettoyer les scories

Deux ajustements au rattrapage des résumés :

- Les **contrats de capitalisation** (ex. « Capitalisation Palatine ») sont
  désormais écartés de la génération, comme les autres lignes qui ne sont pas
  des sociétés — leur domaine est celui de la banque, un résumé n'aurait pas
  de sens.
- Un **outil de vérification** permet de repérer les lignes non-sociétés qui
  auraient reçu un résumé générique lors du tout premier passage (avant la
  mise en place du filtre), pour les vider proprement — en préservant les
  résumés rédigés à la main.

> **🔧 Notes techniques**
>
> - `backfillCompanyEnrichment` : motif `capitalisation_contract` ajouté à
>   `classifyExclusion`.
> - Nouveau `listEnrichedNonCompanies` (lecture seule) : liste les entités
>   motif-exclu portant déjà `oneLiner`/`summary` (scories du 1er backfill
>   #201, non filtré), avec le texte. `clearByIds` vide `oneLiner`+`summary`
>   sur une **liste d'id explicite** (jamais de wipe global — protège les
>   résumés curés type « La vie de Quartier - Holding »).
> - `MIGRATIONS.md` mis à jour.

## v1.83.1 — 14/07/2026 à 13:18 — Parallel : préparation de l'affichage des communications par deal

Travail préparatoire (rien de visible pour l'instant) en vue d'afficher, dans la
section « Report » de chaque entité, les communications publiées par Parallel sur
chaque deal (datées, avec pièces jointes). Cette étape ajoute un outil de
diagnostic interne pour vérifier que ces communications sont bien lisibles via
l'API avant de construire l'affichage.

> **🔧 Notes techniques**
>
> - `convex/vasco.ts` : nouvelle `internalAction` `probeCommunications`
>   (diagnostic CLI — `npx convex run --prod vasco:probeCommunications
'{"orgSlug":"calte"}'`) : login, liste des comptes, puis `GetCommunications`
>   sous chaque scoping candidat (`userId`, `accountId`). Renvoie la réponse
>   GraphQL **brute** (`data` + `errors` + `extensions.warnings`), car le refus
>   d'accès de la persona investisseur arrive en `warnings` (champ `null`) et non
>   en `errors`.
> - Ajoute `vascoGraphqlRaw` (variante non-throwing de `vascoGraphql`) et la
>   requête `GET_COMMUNICATIONS` (`id`, `title`, `period`, `publishDate`,
>   `issuer { id label }`, `communicationDocuments { document { … downloadUrl } }`).
> - Aucune UI ni écriture DB. Phase 1 (dé-risquage) de l'étape 2b VASCO ;
>   l'affichage (read path org-guardé + rattachement entité↔émetteur + bloc dans
>   `CompanyReportsSection` + roll-up org) suivra une fois l'accès prouvé.

## v1.83.0 — 14/07/2026 à 13:09 — Le prévisionnel se mesure, vous alerte, et anticipe la TVA

Trois compléments au prévisionnel de trésorerie :

- **Fiabilité mesurée** : chaque 1er du mois, une photo du prévisionnel est
  prise automatiquement. Dès le mois suivant, la page Trésorerie affiche
  l'écart entre ce qui était projeté pour le mois écoulé et ce qui s'est
  réellement passé — pour savoir à quel point faire confiance à la courbe.
- **Alerte de seuil** : réglez un seuil (ex. 50 000 €) sur la page
  Trésorerie ; si le solde projeté des 3 prochains mois passe dessous, vous
  recevez un email — au plus un par semaine, et le réglage se modifie ou se
  coupe à tout moment.
- **Échéance TVA estimée** : quand la TVA du trimestre clos est à payer
  (collectée > déductible), une carte propose de créer l'échéance
  correspondante (datée du 24 du mois suivant le trimestre) dans le
  prévisionnel — en un clic, jamais automatiquement, avec un avertissement
  si des transactions du trimestre restent à qualifier.

> **🔧 Notes techniques**
>
> - Premiers **crons Convex** du repo (`convex/crons.ts`) : snapshot
>   mensuel (1er, 05:00 UTC → `forecasts.captureSnapshots`, idempotent par
>   (org, mois), relançable via `convex run`) et alertes quotidiennes
>   (07:00 UTC → `checkCashAlerts`, cooldown 7 j, email bilingue
>   `emailTemplates.ts:cashAlertEmail` via Resend). Fonctions internal sans
>   auth — même famille d'exceptions que les backfills (KNOWN_ISSUES).
> - Nouvelles tables `forecastSnapshots` (append-only, projection 12 mois
>   au 1er du mois) et `cashAlertSettings` (une par org, `lastNotifiedAt`
>   remis à zéro à chaque modification). Query `getForecastReliability`
>   (snapshot M-1 vs solde réel fin M-1), `getCashAlert`/`setCashAlert`.
> - TVA trimestrielle : `previousQuarter` (pur, `lib/recurrence.ts`, testé),
>   `computeVatPositionForOrg` extrait de `getVatPosition` avec fenêtre de
>   dates, `suggestVatEntry`/`createVatEntry` (montant recalculé serveur,
>   idempotent par `derivedKey` "vat:{org}:{trimestre}" — sans `ruleId`,
>   l'échéance reste une ponctuelle éditable). UI :
>   `VatSuggestionCard.tsx`, `CashAlertCard.tsx`, ligne fiabilité dans
>   `ForecastOverview.tsx`.

## v1.82.2 — 14/07/2026 à 12:49 — Nettoyage des domaines et ciblage du rattrapage

En lançant le rattrapage des résumés, on a découvert que beaucoup de fiches
Calte avaient un **domaine mal enregistré** (collé sous forme de lien ou
d'adresse complète avec des paramètres de suivi). Conséquence : leur **logo
était cassé** et le résumé ne pouvait pas se générer. Cette mise à jour :

- **répare les domaines** existants (ils redeviennent un simple nom de site,
  ex. `anaxago.com`), ce qui rétablit les logos **et** débloque la génération ;
- **normalise désormais tout domaine à la saisie** — coller une adresse
  complète ou un lien fonctionne, c'est nettoyé automatiquement ;
- **cible mieux le rattrapage** : les lignes qui ne sont pas des sociétés
  (lignes de deal, SPV, fonds, véhicules d'investissement) sont désormais
  écartées de la génération de résumé, où elle n'a pas de sens.

> **🔧 Notes techniques**
>
> - Helper pur `convex/lib/domain.ts:normalizeDomain` (retire wrapper markdown
>   `[…](…)`, protocole, chemin/query, `www.` ; `null` si irréductible) +
>   tests `tests/domain.test.ts`. Appliqué à l'écriture (`companies.create`/
>   `update`, `agentTools.createCompanyInternal`) et défensivement au fetch
>   (`companyEnrichment.fetchSiteText`).
> - Migration `convex/migrations/normalizeCompanyDomains.ts` (`dryRun`/`apply`/
>   `report`) : réécrit les domaines corrompus en base (idempotent, non
>   destructif — illisible → `needsManualReview`). **À lancer avant** le
>   backfill.
> - `backfillCompanyEnrichment` : filtre `classifyExclusion` (motifs
>   structurels + liste nominative) ; `dryRun` sort `willEnrich` vs `excluded`.
> - Contexte complet : `KNOWN_ISSUES.md` « Domaines corrompus ». `MIGRATIONS.md`
>   mis à jour (2 lignes).

## v1.82.1 — 14/07/2026 à 12:26 — Rattrapage des résumés/one-liners pour les entités déjà existantes

Le remplissage automatique du one-liner et du résumé (v1.81) ne se déclenchait
que pour les **nouvelles** entités, ou quand on posait un domaine pour la
première fois. Les entités déjà en base avec un domaine — SPV, véhicules, et
autres sociétés dont le domaine avait été rempli lors des imports précédents —
restaient donc vides. Cette mise à jour ajoute une **opération de rattrapage**
qui relance la génération sur toutes ces entités (Calte et Albo) d'un coup. À
noter : pour les SPV et véhicules, le domaine pointe souvent vers le site de la
plateforme mère, donc le texte généré peut décrire la plateforme plutôt que le
véhicule — ces quelques cas sont à relire à la main.

> **🔧 Notes techniques**
>
> - Migration one-shot `convex/migrations/backfillCompanyEnrichment.ts`
>   (`dryRun` / `apply` / `report`) : liste toute entité `kind: 'portfolio'`
>   non archivée, toutes orgs, ayant un `domain` mais `oneLiner` et/ou
>   `summary` vide, et schedule `companyEnrichment.enrich` sur chacune
>   (staggeré `STAGGER_MS` pour lisser les appels site + LLM). Additive et
>   idempotent (l'action ne remplit que les champs `undefined`). `report`
>   reliste ce qui reste vide après coup (site injoignable → saisie manuelle).
> - Ligne ajoutée à `MIGRATIONS.md`. Aucun changement de schéma ni d'UI.

## v1.82.0 — 14/07/2026 à 12:20 — La Trésorerie repère vos flux récurrents et propose des règles

Le prévisionnel apprend de votre historique. La Trésorerie détecte désormais
les **flux qui reviennent régulièrement** dans les 12 derniers mois — même
sens, même rythme (hebdo, mensuel, trimestriel), montants stables — et les
propose comme **règles récurrentes** quand aucune règle existante ne les
couvre déjà.

- Une carte « Règles suggérées » apparaît en tête de la section Règles
  récurrentes (uniquement quand il y a quelque chose à proposer) : libellé,
  montant médian avec la fourchette observée, rythme détecté, nombre
  d'occurrences.
- **« Créer la règle »** ouvre le formulaire habituel **prérempli** — vous
  ajustez si besoin, vous enregistrez, la projection se recalcule. Rien ne
  se crée jamais tout seul.
- **« Ignorer »** est définitif : la suggestion ne reviendra pas.

> **🔧 Notes techniques**
>
> - Moteur pur `convex/lib/recurrenceDetection.ts` (+ 11 tests) : groupement
>   par `(direction, pattern)` via `deriveCategoryPattern` (même clé que les
>   règles apprenantes de catégorie), ≥ 3 occurrences, intervalles réguliers
>   (médiane + 60 % dans la tolérance — survit à une occurrence manquée),
>   montants tous à ±30 % de la médiane ; dédup contre les règles actives
>   (même sens/fréquence, montant ±15 %).
> - Query `forecasts.suggestRules` (12 mois, comptes EUR) + mutation
>   `dismissRuleSuggestion` ; nouvelle table `dismissedRuleSuggestions`
>   (orgId, pattern, direction — pas de surface d'édition en V1, dashboard
>   Convex comme `categoryRules`).
> - UI : `src/components/cash/SuggestedRules.tsx` ; `RuleDialog` accepte un
>   `prefill` (mode création). i18n fr/en `cash:forecast.suggestedRules`.

## v1.81.0 — 14/07/2026 à 12:05 — Résumés des participations Albo + remplissage automatique depuis le domaine

Deux nouveautés autour du résumé de société introduit en v1.80 :

- **Les 35 participations opérationnelles d'Albo ont leur résumé** : 2-3
  phrases factuelles rédigées à partir du site officiel de chaque société
  (même périmètre que les one-liners — les SPV immobiliers et véhicules
  d'investissement n'en ont pas, un résumé n'y a pas de sens). Les domaines
  manquants de Redesk et Loewi ont été retrouvés au passage. L'import est
  prêt à être exécuté en prod (dry-run puis apply, commandes dans le module).
- **Remplissage automatique pour les prochaines entités, dans les deux
  espaces (Calte et Albo)** : dès qu'une société portfolio a un domaine —
  posé à la création (y compris via l'assistant) ou plus tard sur sa fiche —
  le one-liner du tableau **et** le résumé de la fiche se génèrent tout
  seuls en arrière-plan à partir du site web. Une valeur déjà renseignée
  n'est jamais écrasée : on peut toujours corriger à la main, la correction
  reste. Si le site est inaccessible, les champs restent simplement vides.

> **🔧 Notes techniques**
>
> - Nouveau module `convex/companyEnrichment.ts` : action interne `enrich`
>   (fetch homepage + `htmlToText`, puis `generateObject` sur `getModel()`
>   avec fallback `generateText`, prompt FR) → mutation `applyEnrichment`
>   **additive** (n'écrit que les champs encore `undefined`, re-vérifié à
>   l'écriture). Schedulée via `ctx.scheduler.runAfter(0, …)` depuis
>   `companies.create` (si domaine), `companies.update` (pose de domaine,
>   kind `portfolio` uniquement) et `agentTools.createCompanyInternal`.
>   Échecs silencieux (warn logs), aucun impact UI.
> - Migration one-shot `convex/migrations/alboSummaryImport.ts`
>   (`dryRun`/`apply`/`verify`, pattern d'`alboOneLinerImport`) : 35
>   `summary` + 2 `domain` (Redesk `redesk.fr`, Wheelee - Loewi `loewi.fr`),
>   ancrée par `_id` prod + garde nom. Ligne ajoutée à `MIGRATIONS.md`.
> - `convex/_generated/api.d.ts` re-synchronisé à la main (codegen
>   indisponible dans l'environnement). TESTING.md : lignes ED6f/ED6g.

## v1.80.1 — 14/07/2026 à 11:28 — Parallel (VASCO) : outillage pour débusquer le login qui échoue en prod

Correctif technique. Le diagnostic a montré que Parallel renvoie « identifiants
invalides » depuis la prod — donc pas un blocage réseau, mais un mot de passe
stocké qui ne correspond pas. Ce patch ajoute de quoi le confirmer sans exposer
le secret, et de quoi ré-enregistrer le mot de passe sans risque de corruption.

> **🔧 Notes techniques**
>
> - `debugVascoLogin` remonte désormais, par connexion, `storedUsername`,
>   `storedPasswordLen` et `storedPasswordSha12` (empreinte SHA-256 tronquée,
>   non réversible) — pour comparer le secret stocké à l'attendu sans le
>   divulguer.
> - `seedConnection` accepte `passwordB64` (mot de passe en base64) en plus de
>   `password`, pour ré-enregistrer un mot de passe à l'abri du mangling
>   shell/copier-coller. `pnpm lint` + `pnpm test:unit` au vert.

## v1.80.0 — 14/07/2026 à 11:38 — Résumé de la société sur sa fiche

Chaque fiche société peut maintenant porter un **résumé** de deux à trois
lignes, affiché juste sous le nom de la société en haut de sa fiche — plus
complet que le one-liner du tableau des entreprises, qui reste inchangé. Le
résumé se saisit via le dialog « Modifier » de la fiche (nouveau champ
« Résumé ») ; le vider le retire de la fiche. Le champ est prêt partout — il
sera rempli dans un premier temps sur les participations Albo.

> **🔧 Notes techniques**
>
> - Nouveau champ optionnel `companies.summary` (`convex/schema.ts`), accepté
>   par le patch de `companies.update` (`convex/companies.ts`) : trim, `''`
>   efface (miroir de `domain`).
> - Fiche entité (`src/routes/app/$orgSlug/participations.$companyId.tsx`) :
>   affichage du résumé sous l'en-tête (`whitespace-pre-line`, texte muted) +
>   `Textarea` « Résumé » dans `EditCompanyDialog`.
> - i18n FR/EN (`participations.json` : `edit.summaryLabel`,
>   `edit.summaryPlaceholder`) ; TESTING.md ligne ED6e. Pas de seed dans cette
>   PR — remplissage Albo à suivre.

## v1.79.0 — 14/07/2026 à 11:38 — La page Trésorerie devient un cockpit

L'onglet Aperçu de la Trésorerie est réorganisé pour répondre d'abord aux
questions qui comptent : combien j'ai, où j'atterris, qu'est-ce qui tombe
bientôt.

- **Bandeau de chiffres clés** en tête de page : solde disponible (avec le
  détail des fonds bloqués ou clôturés), atterrissage projeté fin de mois,
  et net des échéances à 30 et 90 jours (entrées − sorties, retards
  compris).
- **Échéances à venir** : une nouvelle liste 30/90 jours montre tout ce qui
  tombe bientôt — y compris les occurrences des règles récurrentes (loyers,
  salaires…), qui n'étaient visibles jusqu'ici que dans la courbe. Les
  retards remontent en premier, marqués en rouge.
- **Nouvel ordre de lecture** : chiffres clés, courbe, grille, échéances et
  rapprochements suggérés d'abord ; comptes bancaires, TVA et gestion des
  règles/échéances ponctuelles en dessous.

> **🔧 Notes techniques**
>
> - Nouvelle query `forecasts.getUpcomingEntries` (pending EUR ≤ 90 j,
>   retards inclus sans borne basse — même position que le rollover de la
>   grille ; renvoie aussi `net30Cents`/`net90Cents`), partagée entre le
>   bandeau et la liste (dédup de souscription Convex).
> - Nouveaux composants `src/components/cash/CashKpis.tsx` (bandeau, 4
>   tuiles ; atterrissage = `projection[0]` de la grille) et
>   `UpcomingEntries.tsx` (toggle 30/90 j, lecture seule) ;
>   `ForecastOverview` accueille le bandeau (prop `accounts`) ; les cartes
>   Solde disponible/total quittent `CashAccounts` (tables seules) ;
>   réordonnancement dans `cash.index.tsx`. i18n fr/en (`cash:kpis`,
>   `cash:upcoming`). TESTING CA2/FC1 mis à jour + FC19-FC20.

## v1.78.0 — 14/07/2026 à 11:10 — Voir un one-liner en entier d'un clic

Dans le tableau des entreprises, un one-liner un peu long était coupé (« … ») et
on n'en voyait pas la fin. Désormais, quand un one-liner est tronqué, il devient
**cliquable** (petit souligné pointillé au survol) : un clic ouvre une petite
carte avec le **texte complet**. Le reste de la ligne continue d'ouvrir la fiche
de la société comme avant. Les one-liners courts, qui tiennent déjà en entier,
ne changent pas.

> **🔧 Notes techniques**
>
> - `ParticipationsTable.tsx` : sous-composant `OneLinerCell` qui détecte la
>   troncature via un callback ref stable + `ResizeObserver` (`scrollWidth >
clientWidth`), robuste au resize et au swap span↔bouton. Seuls les
>   one-liners coupés deviennent un `PopoverTrigger` ; `stopPropagation` sur le
>   clic/keydown du bouton et sur le `PopoverContent` pour ne jamais déclencher
>   la navigation de ligne (`role="link"`).
> - Remplace l'ancien `title` natif (tooltip navigateur) sur la cellule.
> - Nouvelle clé i18n `participations.oneLinerExpand` (FR/EN) pour l'aria-label.

## v1.77.1 — 14/07/2026 à 11:09 — Parallel (VASCO) : diagnostic de connexion depuis la prod

Correctif technique. La connexion à Parallel échoue depuis les serveurs de
production alors que les identifiants sont valides (elle marche depuis un autre
environnement). Ajout d'un outil de diagnostic pour identifier précisément la
cause, et d'un en-tête d'identification qui peut à lui seul débloquer.

> **🔧 Notes techniques**
>
> - `convex/vasco.ts` : en-tête `User-Agent` sur les appels VASCO (certains WAF
>   rejettent une requête sans UA) ; l'erreur `vasco_login_failed` remonte
>   désormais le **code HTTP + un extrait du corps** de la réponse.
> - Nouvelle action interne `debugVascoLogin`
>   (`convex run --prod vasco:debugVascoLogin '{"orgSlug":"calte"}'`) : renvoie
>   l'**IP de sortie** de Convex + la réponse brute du login par connexion
>   (status/corps, token masqué) — pour trancher entre blocage IP/WAF et autre.
>   `pnpm lint` + `pnpm test:unit` au vert.

## v1.77.0 — 14/07/2026 à 11:01 — Rapprochement des échéances prévues avec les mouvements réels

La page Trésorerie sait désormais **rapprocher le prévu du réel**. Une carte
« Rapprochements suggérés » repère les échéances dues ou en retard qui
ressemblent à un mouvement bancaire récent (même sens, montant proche, date
proche, libellé qui colle) et propose de les rapprocher en un clic — les
occurrences des règles récurrentes (loyers, salaires…) comme les échéances
ponctuelles.

Quand les montants ne collent pas exactement, la décision vous appartient,
explicitement :

- **Clore avec l'écart** (par défaut) : l'échéance est considérée réalisée
  telle quelle, l'écart reste visible.
- **Conserver le reliquat** (paiement partiel) : la partie payée est
  réalisée et le solde restant redevient une échéance à venir, visible dans
  les échéances ponctuelles.

Au passage, **l'assistant IA parle désormais le même prévisionnel que la
page** : sa projection de trésorerie utilise exactement la même logique que
la courbe et la grille (flux du mois courant déjà passés en banque non
recomptés, échéances en retard glissées sur le mois courant, comptes
disponibles uniquement). Il sait aussi gérer le reliquat d'un paiement
partiel quand vous lui demandez de pointer une échéance.

> **🔧 Notes techniques**
>
> - Moteur de suggestion pur `convex/lib/entryMatching.ts` (fenêtres
>   sens/date ±10 j/montant 50–150 %, score montant+date+libellé,
>   affectation greedy 1↔1) + `tests/entryMatching.test.ts` ; query
>   `forecasts.suggestForecastMatches` (exclut les tx `ignored`/virements
>   internes et celles déjà portées par un `realizedTransactionId`).
> - `markEntryRealized` (+ outil agent) prend `mode: 'close' |
'keepRemainder'` via le cœur partagé `applyMarkEntryRealized` ; le
>   reliquat devient une entry one-shot pure (sans `ruleId`/`derivedKey`).
> - UI : `src/components/cash/ForecastMatchSuggestions.tsx` (carte + dialog
>   de décision), i18n fr/en `cash:forecast.suggestions`.
> - Alignement agent/MCP : `getForecastBalanceInternal` rebranché sur le
>   cœur grille extrait `forecasts.ts:computeForecastGridForOrg`
>   (`historyMonths: 0`) ; l'ancienne sémantique fenêtrée
>   (`buildMonthlyBalance`, query publique `getForecastBalance`) est
>   supprimée. KNOWN_ISSUES/TESTING mis à jour (F6-F14, FC16-FC18).

## v1.76.1 — 14/07/2026 à 10:44 — Parallel (VASCO) : lecture des positions + vérif en prod

Suite de la connexion Parallel. Albo OS lit désormais tes **positions réelles**
depuis Parallel (montant investi par ligne, société, véhicule, date), et une
commande permet de **vérifier la connexion directement en prod**. Toujours rien
d'affiché dans l'app pour l'instant : c'est la fondation pour rattacher ces
lignes à tes deals et remonter les valorisations (étape suivante).

> **🔧 Notes techniques**
>
> - `convex/vasco.ts` : les positions se lisent maintenant via
>   `GetAccount(id).investments` (montant investi réel par ligne : `amount` en
>   cents, `securityName`, `vehicleName`, `securitiesNumber`, dates) — les
>   `accountSecurityContracts` renvoyaient des montants **masqués** (0) pour le
>   persona investisseur. Cf. `KNOWN_ISSUES.md` « VASCO API ».
> - Nouvelle action interne `verifyConnection` (lançable en
>   `convex run --prod vasco:verifyConnection '{"orgSlug":"calte"}'`, sans
>   session auth) : remonte les positions par connexion pour valider un accès en
>   prod. `fetchParticipations` (publique, org-gardée) partage le même code.
> - Mutation `deleteConnection` (retirer une connexion, ex. ligne seedée par
>   erreur) + lecture par slug `getConnectionsByOrgSlug` ; parsing null-safe des
>   contrats. `pnpm lint` + `pnpm test:unit` au vert ; pas de resync
>   `_generated` (module `vasco` déjà enregistré).

## v1.76.0 — 14/07/2026 à 10:43 — One-liners des participations Albo + nouveau secteur « Consumer »

Chaque société opérationnelle du portefeuille Albo a désormais un **one-liner** :
une phrase courte qui dit en un coup d'œil ce qu'elle fait, affichée dans le
tableau des participations (par ex. « Marketplace de produits électroniques
reconditionnés » pour BackMarket, ou « Exosquelettes de marche et robots
humanoïdes » pour Wandercraft). Les SPV immobiliers et véhicules
d'investissement (Parallel Invest, Sezame Immo, fonds…) restent volontairement
sans one-liner — une accroche produit n'aurait pas de sens pour eux.

Côté **secteurs**, les quelques sociétés qui n'en avaient pas encore un sont
désormais classées (Wandercraft, AZmed, Genomines, Versant, Jeen, ACT Running,
Oprtrs & Co). Et un nouveau secteur **« Consumer / Marques »** fait son
apparition pour les marques qui vendent leur propre produit (Eclo Beauty,
Bleen, JOONE, ACT Running), là où « Marketplace » ne collait pas vraiment.

> **🔧 Notes techniques**
>
> - Nouveau slug `consumer` ajouté à `SECTOR_SLUGS` (`src/lib/sectors.ts`) +
>   libellés i18n `participations.sectors.consumer` (« Consumer / Marques » /
>   « Consumer / Brands »). Repris automatiquement par `SectorCombobox` et le
>   filtre secteur, sans autre changement.
> - Migration one-shot idempotente `convex/migrations/alboOneLinerImport.ts`
>   (`dryRun`/`apply`/`verify`, prod-only manuelle, calquée sur
>   `alboIdentityImport`) : `ENTRIES` n'écrit `oneLiner`/`sector` que si le
>   champ est vide (valeurs saisies à la main préservées), `SECTOR_OVERRIDES`
>   force `consumer` sur les 4 marques D2C. Sociétés ancrées par `_id` prod +
>   contrôle du nom exact avant tout patch.
> - One-liners FR (~3-7 mots) rédigés à partir des sites officiels, périmètre
>   startups opérationnelles uniquement.
> - Commentaire `oneLiner` dans `convex/schema.ts` mis à jour : la convention
>   « hand-filled, no backfill » est levée pour ce seed unique.

## v1.75.0 — 14/07/2026 à 10:30 — Prévisionnel de trésorerie par catégorie : la grille réalisé / engagé / prévu

Deuxième jalon de la refonte de la trésorerie : le prévisionnel devient
lisible et honnête.

**Une grille catégories × mois.** Sous la courbe, un tableau croise chaque
grande catégorie avec les mois passés et à venir : le passé montre le
réalisé (ce qui s'est vraiment passé), le futur montre ce qui est engagé et
ce qui est prévu, et la dernière ligne donne le solde projeté mois par
mois. Le mois en cours fusionne les deux mondes : le réalisé à date, plus
le « reste à venir ».

**Fini le double comptage.** Une échéance prévue qui s'est déjà réalisée ce
mois-ci ne compte plus deux fois : le réalisé consomme le prévu, catégorie
par catégorie. Et une échéance en retard (prévue le mois dernier, jamais
passée en banque) reste attendue — elle glisse sur le mois en cours au lieu
de disparaître en silence.

**Deux courbes de certitude.** La projection distingue désormais le
scénario « engagé » (les flux confirmés uniquement) du scénario « avec
prévu » (tout compris) — deux trajectoires superposées sur le graphique.

**Le reste à déployer, enfin visible.** Une carte affiche le capital engagé
sur les deals signés qui n'a pas encore été versé — deal par deal. Ce sont
des obligations réelles sans date : elles sont comptées à part, jamais
inventées dans la courbe.

**Les prévisions parlent la même langue que le réalisé.** Les règles
récurrentes et les échéances ponctuelles se rangent dans les mêmes grandes
catégories que les transactions (salaires, loyers, deals, comptes
courants…) via un sélecteur — plus de texte libre.

> **🔧 Notes techniques**
>
> - Moteur pur `convex/lib/recurrence.ts:buildForecastGrid` (testé par
>   `tests/forecastGrid.test.ts`) : axe mois historique→horizon,
>   consommation par cellule (direction × catégorie) sur le mois courant
>   (engagé d'abord, puis prévu avec le reliquat), rollover des échéances
>   en retard, projection cumulée en deux scénarios.
> - Query `forecasts.getForecastGrid` (périmètre = comptes EUR disponibles,
>   buckets réalisés via `effectiveCategory`) + `getCommittedPipeline`
>   (reste à déployer = `committedAmount` − Versé dérivé des transactions).
> - `ForecastOverview.tsx` remplace `ForecastChartCard` (courbe 2 séries
>   projetées via `ForecastChart` remanié, carte pipeline, grille) ;
>   sélecteurs de catégorie dans `RuleDialog`/`EntryDialog`
>   (`forecastCategories(direction)`, clear via `null` dans
>   `updateRule`/`updateEntry`).
> - `getForecastBalance` (outil agent/MCP) garde l'ancienne sémantique
>   fenêtrée — divergence documentée dans `KNOWN_ISSUES.md`.

## v1.74.1 — 14/07/2026 à 09:50 — Parallel (VASCO) : première brique de connexion

Vos participations, valorisations et reportings passés par **Parallel Invest**
ne vivent aujourd'hui que sur leur plateforme — rien n'arrive par e-mail. On a
commencé à les rapatrier dans Albo OS. Cette première étape pose la **connexion
sécurisée** : Albo OS sait désormais s'authentifier auprès de Parallel et lire
les données d'un véhicule, avec un accès distinct par véhicule et par entité
(Parallel–Calte aujourd'hui, Parallel–Albo et d'autres ensuite). Rien de
visible dans l'application pour l'instant — l'affichage des lignes, des
valorisations et des reportings arrive dans les étapes suivantes. La connexion
a été validée sur le vrai compte Calte (portefeuille réel : STOA Bordeaux,
NG Invest, obligations, etc.).

> **🔧 Notes techniques**
>
> - Nouvelle table interne `vascoConnections` (secrets au repos, une ligne par
>   couple client VASCO × org Albo OS, upsert sur `by_client_and_username`) et
>   module `convex/vasco.ts` : helpers `fetch` en runtime Convex par défaut pour
>   `POST /auth/login` → JWT et appels GraphQL authentifiés, registre de
>   connexions (`authorizeAndListConnections`, `markConnected`, `seedConnection`)
>   et action `fetchParticipations` (gardée par appartenance à l'org, lecture
>   seule — aucune écriture dans les tables portefeuille à ce stade).
> - Scoping investisseur : `api.<client>.vasco.fund` a l'introspection coupée et
>   le persona `ROLE_DISTRIBUTED_CUSTOMER` n'accède pas à `GetAccounts` /
>   `GetSecurities` / `GetParticipationsSummary`. Les positions se lisent via
>   `GetUser(id).accounts` → `GetAccount(id).accountSecurityContracts` (id user
>   extrait des claims du JWT). Détaillé dans `KNOWN_ISSUES.md` « VASCO API ».
> - `convex/_generated/api.d.ts` synchronisé à la main (ajout du module `vasco`)
>   car `convex codegen` exige un déploiement authentifié, indisponible dans
>   l'environnement distant ; `pnpm dev` le régénère à l'identique. `pnpm lint`
>   et `pnpm test:unit` au vert.

## v1.74.0 — 14/07/2026 à 10:05 — Trésorerie : solde disponible, grandes catégories et classement automatique

Premier jalon de la refonte de la trésorerie (socle du futur prévisionnel).

**Des soldes auxquels on peut se fier.** La page Trésorerie affiche
désormais le **solde disponible** — le cash réellement mobilisable — à côté
du solde total. Chaque compte peut être qualifié depuis sa fiche : fonds
nantis ou bloqués (comptés à part), compte clôturé à la banque (conservé
avec tout son historique, mais hors des soldes), et pour les comptes non
connectés à la banque, le solde se saisit à la main avec sa date, pour
toujours savoir de quand date le chiffre.

**Des grandes catégories, sans comptabilité analytique.** Les charges et
produits se classent en une douzaine de grandes familles (salaires,
honoraires, abonnements, loyers, frais bancaires, royalties & dividendes…)
directement depuis le registre des transactions. Les rattachements
existants comptent d'office : un deal, un compte courant, un impôt sont
déjà des catégories.

**Le classement apprend tout seul.** Classer une transaction une fois
suffit : l'outil mémorise une règle et classe automatiquement les
transactions similaires à leur arrivée de la banque. Un bouton « Appliquer
les règles » rattrape la file en attente d'un clic.

**Un nouvel onglet Analyse.** Entrées et sorties par catégorie et par mois
(3, 6 ou 12 mois), avec le net mensuel — pour voir enfin d'où vient et où
part l'argent, virements internes exclus.

> **🔧 Notes techniques**
>
> - `bankAccounts` : nouveaux champs `accountStatus` (active/closed) et
>   `pledged` ; prédicat partagé `convex/lib/bankAccounts.ts:isAvailableAccount`
>   appliqué au solde de départ du prévisionnel (`forecasts.ts`), au cash du
>   dashboard (`dashboard.ts`) et à l'outil agent ; mutations
>   `cash.updateAccountSettings` / `cash.updateAccountBalance` (refusée sur
>   un compte Powens), dialog d'édition sur `/cash/$accountId`.
> - `transactions.category` (slug, statuts charge/product uniquement, même
>   invariant que `vatRateBps` dans `convex/lib/pointage.ts`) ; listes de
>   catégories dupliquées `convex/lib/categories.ts` ↔ `src/lib/categories.ts`
>   (sync testée par `tests/categories.test.ts`).
> - Table `categoryRules` (upsert par org + pattern stable du libellé,
>   `deriveCategoryPattern`) : règles créées par les gestes unitaires de
>   pointage et `setCategory`, rejouées à l'insert (webhook Powens, import
>   Mémo CSV) et à la demande (`transactions.applyCategoryRules`) — jamais de
>   ligne `matchingDecisions` (décision machine). Cf. `KNOWN_ISSUES.md`
>   « Catégories & règles apprenantes ».
> - Query `transactions.getCategoryBreakdown` (buckets dérivés via
>   `effectiveCategory`) + composant `CategoryBreakdown` (onglet Analyse,
>   `?tab=analyse`).

## v1.73.2 — 13/07/2026 à 22:47 — Un peu d'air entre le nom d'une fiche et son badge

Sur la fiche d'une entreprise et sur la fiche d'un deal, le badge affiché
juste à droite du nom (« Entreprise », statut du deal) était collé un peu
trop près du titre. On a ajouté un léger espace pour qu'il respire, de la
même manière sur les deux pages.

> **🔧 Notes techniques**
>
> - Ajout d'un `ms-1.5` sur le badge d'en-tête : cette marge inline-start
>   (~6 px) s'ajoute au `gap-3` du header et porte l'écart nom↔badge de ~12
>   à ~18 px, sans toucher aux autres écarts (logo↔nom, badge↔actions) ni
>   aux vues liste (où le badge de statut vit dans sa propre colonne).
> - `EntityNatureBadge` (`src/components/companies/EntityFiche.tsx`) accepte
>   désormais un `className` optionnel, passé depuis le header de
>   `participations.$companyId.tsx` — la marge vit côté header, pas dans le
>   composant partagé.
> - Même `ms-1.5` sur le badge de statut du header de `deals.$dealId.tsx` :
>   les deux seuls en-têtes où un badge est directement collé au nom, gardés
>   cohérents.

## v1.73.1 — 13/07/2026 à 22:24 — Correctif : défilement de la fenêtre « Modifier » d'une société

La fenêtre « Modifier » d'une participation ou d'une entité pouvait devenir
trop haute pour l'écran lorsqu'une société comptait beaucoup de personnes
(fondateurs, co-investisseurs…) : le bas du formulaire et le bouton
« Enregistrer » se retrouvaient hors de portée, sans possibilité de faire
défiler. La fenêtre défile désormais dès que son contenu dépasse la hauteur
de l'écran, comme les autres grandes fenêtres de l'application.

> **🔧 Notes techniques**
>
> - `EditCompanyDialog` (`participations.$companyId.tsx`) : ajout de
>   `max-h-[85vh] overflow-y-auto` sur le `DialogContent`, alignant le dialog
>   sur le pattern déjà en place ailleurs (`deals.$dealId.tsx`,
>   `RoyaltiesPanel.tsx`, `CompanyReportsSection.tsx`).
> - Ce même dialog édite aussi bien les participations `portfolio` que les
>   entités `group_*` (même route, même composant) : les deux cas signalés
>   sont donc couverts par un seul correctif.

## v1.73.0 — 13/07/2026 à 21:35 — Import de l'identité des participations Albo (Drive + Attio)

Les fiches des participations Albo se remplissent : SIREN, raison sociale,
secteur, nombre total d'actions (qui fait apparaître la détention globale),
et les trois listes Fondateurs / Membres du board / Co-investisseurs,
extraits des documents juridiques du Drive et vérifiés ligne à ligne.
Chaque personne retrouvée dans Attio devient cliquable : son nom ouvre
directement sa fiche Attio. Les fonds et les personnes absentes d'Attio
restent affichés en texte simple. Une valeur déjà saisie à la main n'est
jamais écrasée, et l'import ne s'exécute qu'après validation d'un rapport
de contrôle.

> **🔧 Notes techniques**
>
> - Nouvelle migration one-shot `convex/migrations/alboIdentityImport.ts`
>   (`dryRun` / `apply` / `verify`) : 45 sociétés de l'org `albo`, ancrées
>   par `_id` prod + garde sur le nom exact. Champs scalaires écrits
>   seulement si `undefined` ; `people` posé seulement si la fiche n'en a
>   aucun ; unicité SIREN re-vérifiée via l'index `by_org_siren` (conflit
>   → rapporté, pas écrit).
> - Données extraites des docs du dossier Drive « ⚠️ Investissements »
>   (8 agents parallèles, chaque valeur avec doc source + citation) ; les
>   44 SIREN passent la clé de Luhn. 158 personnes physiques résolues
>   contre l'objet `people` d'Attio (98 liées via `attioRecordId`, dont 16
>   « probables » signalées dans la table de revue partagée avec Benjamin).
> - Exclusions volontaires : `totalShares` non importé pour les positions
>   détenues via SPV (le % de détention serait faux) ou quand le chiffre
>   documenté est périmé (Waro, Bleen) ; rien d'importé pour « LVDQ Bdv
>   Voltaire » (aucun doc juridique n'existe encore). Runbook en tête du
>   module ; exécution prod manuelle (snapshot → dryRun → apply → verify).

---

---

## v1.72.0 — 13/07/2026 à 20:50 — Reports par email : récaps et file d'attente (brique 6)

Sixième et dernière brique du circuit des reports par email — la boucle est
fermée. Chaque report transféré reçoit désormais un récapitulatif **en
réponse dans le fil même du transfert** : participation(s) rattachée(s) avec
lien vers la fiche, période, sources traitées, métriques enregistrées, et
trois signaux de contrôle — métriques non reconnues, valeurs inhabituelles
par rapport au report précédent (erreur d'unité probable), et métriques
habituellement présentes mais absentes. En cas d'échec, la réponse indique
la raison et renvoie vers la file. Un email d'un expéditeur inconnu ou du
spam déclenche un message séparé aux membres — jamais de réponse à
l'inconnu. Sur la page « Reports entrants », trois actions ferment la
boucle : **Rattacher** (choisir la participation, le traitement reprend tout
seul), **Retraiter** (rejouer de zéro, par exemple après avoir complété une
fiche), **Rejeter**.

> **🔧 Notes techniques**
>
> - Nouveau module `convex/reportNotify.ts` : `send` (success/failure/quarantine), idempotent via claim `notifiedAt` ; routing anti-énumération re-vérifié **au moment de l'envoi** (`isMemberEmail`) — membre → `replyToMessage` in-thread, sinon mail neuf aux membres (`sendMessage`, destinataires = tous les `organizationMembers`). Wrappers reply/send ré-ajoutés à `convex/agentmail.ts`.
> - Gabarits français dans `convex/emailTemplates.ts` (§ recaps, HTML compact) : formatage cents/bps → €/%, libellés de méthode de match, détails de sources actionnables, raisons de review.
> - Récap succès construit dans `reportStore.run` avec la mémoire PRE-stockage : non-reconnues (échec `toCanonical`), inhabituelles (ratio ≥ 8 vs dernière valeur connue, même unité), habituelles absentes. Hooks échec : `reportIdentify.setReview`, `no_content` (extraction), quarantaine à l'ingestion.
> - Actions publiques `reportInbox` : `assignCompany` (garde `requireOrgMember` sur l'org de la cible, fan-out même domaine/nom cross-org, reprise `reportExtract`/`reportStore` selon l'état, `matchMethod: 'manual'`), `reprocess` (reset complet + re-auth du From), `reject` (`manual_reject`) + query `listAssignTargets`. Helpers factorisés `memberUserIdFor`/`requireAnyMember`.
> - Page `/app/all/reports` : colonne Actions (Rattacher via Dialog+Select, Retraiter, Rejeter), toasts sonner, i18n fr/en. `convex/_generated/api.d.ts` re-synchronisé à la main (codegen indisponible dans l'environnement).

## v1.71.0 — 13/07/2026 à 20:20 — Reports par email : fiche, métriques et rangement (brique 5)

Cinquième brique du circuit des reports par email — celle qui transforme le
contenu extrait en données exploitables. Chaque report traité produit
désormais une fiche complète (titre, période, résumé, points clés) rangée
sur la fiche de **chaque** entité concernée, dans les deux organisations si
besoin, avec ses pièces jointes dans l'onglet Documents. Les métriques sont
extraites avec un garde-fou anti-dérive : un **catalogue fermé** de
métriques officielles (CA, EBITDA, trésorerie, effectif…), la mémoire des
métriques déjà connues de chaque boîte pour rester cohérent d'un mois à
l'autre, et les conversions d'unités (« 1,2 M€ », « 15 % ») faites par du
code vérifié — jamais par l'IA. Une métrique inconnue du catalogue est
conservée sur le report mais n'entre jamais dans les séries temporelles.
Renvoyer un report déjà importé met à jour la fiche existante au lieu de
créer un doublon, et la synthèse IA de la participation se relance
automatiquement à chaque nouveau report.

> **🔧 Notes techniques**
>
> - Nouveau module `convex/reportStore.ts`, chaîné depuis `reportExtract.setExtraction` (verrou `markStoring`). Un appel LLM (pattern `generateObject`/fallback) produit fiche + métriques **telles qu'écrites** (valeur + unité vue : EUR/kEUR/MEUR/percent/count/months) ; devise étrangère et budget/forecast → jamais sur une clé canonique.
> - `lib/metricCatalog.ts` : catalogue fermé (~35 clés typées eur/percent/count/months), `toCanonical` = conversion déterministe (cents, bps), rejet des clés hallucinées et unités incompatibles → snapshot brut seulement. `lib/reportPeriod.ts` : parsing déterministe des périodes (mois/trimestre/semestre/année/plage). **13 tests unitaires** ajoutés (135 au total).
> - Rangement démultiplié : `storeForCompany` par entité matchée — `companyReports` (dédup index `by_company_period`, renvoi = patch ; nouveau champ `rawMetrics` pour le snapshot audit), `documents` par entité (blob storage partagé, jamais supprimé au re-import), `kpiSnapshots` idempotents (clé company+metricType+periodStart+`source: report:<id>`), `companyIntelligence.latestReportId` + `intelligence.runAnalysis` re-déclenchée.
> - Mémoire anti-dérive : `knownMetrics` (dernière valeur par metricType via `by_company_metric`) injectée dans le prompt. Échec d'analyse → `needs_review`/`analyze_error`. Statut final `processed` + `reportIds` sur le courrier entrant.
> - `convex/_generated/api.d.ts` re-synchronisé à la main (codegen indisponible dans l'environnement).

## v1.70.0 — 13/07/2026 à 19:25 — Reports par email : extraction du contenu (brique 4)

Quatrième brique du circuit des reports par email. Une fois le report
rattaché à sa participation, tout son contenu est extrait automatiquement :
le corps du mail, les PDF (lecture OCR), les captures d'écran de tableaux
collées dans le message (les logos et signatures sont ignorés), les Excel et
CSV, les pages Notion publiques, les fichiers Google Drive partagés par lien,
les documents DocSend, et même les liens cachés derrière des redirections de
tracking. Chaque élément finit dans exactement un de trois états — extrait,
stocké tel quel, ou échec signalé avec sa raison — visibles dans la nouvelle
colonne « Contenu » (✅/📦/⚠️) : un format inconnu ne produit jamais d'erreur
imprévue, et une source qui échoue n'empêche jamais de traiter le reste. Les
pièces jointes sont conservées. Si aucun contenu exploitable n'est trouvé
nulle part, l'email part en « À traiter / Aucun contenu exploitable ».

> **🔧 Notes techniques**
>
> - Nouveau module `convex/reportExtract.ts` (routeur monde fermé), chaîné depuis `reportIdentify.setMatch` ; verrou `markExtracting` (matché + pas encore de `sources`). Résultats sur `inboundEmails` : `sources[]` (kind/label/state/detail/chars), `extractedText` (agrégé, cap 150k chars), `attachments[].storageId` (fichiers dans le storage Convex, cap 20 Mo → `file_too_large` au-delà, non stocké).
> - Helpers : `lib/ocr.ts` (Mistral OCR PDF+images — le modèle chat OpenRouter ne lit pas les PDF, décision assumée d'un seul chemin OCR ; jamais de throw, `''` en échec), `lib/excel.ts` (dump cellules borné via `xlsx`, pas de pré-digestion — leçon « llmPrompt vide mais truthy »), `lib/notion.ts` (loadPageChunk non officiel, échec = cas nominal), `lib/reportLinks.ts` (détection Notion/GDrive/DocSend + résolution des liens de tracking seulement si aucun lien direct).
> - `downloadAttachment` ré-ajouté au wrapper AgentMail (raw / presigned URL / base64 gérés). Petites images (<15 Ko) = logos → stockées sans OCR. GDrive : exports publics (Sheets→xlsx, Docs/Slides→pdf), page HTML de login détectée = non partagé. DocSend via docsend2pdf.com (choix validé, confidentialité assumée).
> - Dépendance ajoutée : `xlsx`. Env requis : `MISTRAL_API_KEY` (déjà documenté dans `.env.example`). `convex/_generated/api.d.ts` re-synchronisé à la main (codegen indisponible dans l'environnement).

## v1.69.0 — 13/07/2026 à 20:14 — Import des instruments du portefeuille Albo

Les fiches des 51 participations Albo se remplissent d'un coup : les
caractéristiques de chaque instrument (taux et échéances des obligations,
paramètres des contrats de royalties, valorisations et pourcentages de
détention des tours, caps et décotes des convertibles, véhicules SPV,
conditions de carried des SPV menés en lead) ont été extraites des documents
juridiques du Drive, vérifiées ligne à ligne, puis importées en masse — sans
toucher aux montants, statuts et dates déjà saisis. Chaque valeur importée est
traçable vers son document source. Au passage, la périodicité de coupon
« Semestriel » fait son entrée dans les fiches obligataires, et la
participation Keenest est requalifiée en BSA Air (c'était un investissement
direct, pas un véhicule SPV).

> **🔧 Notes techniques**
>
> - Nouvelle migration one-shot `convex/migrations/alboInstrumentImport.ts`
>   (`dryRun`/`apply`/`verify`, modèle `splitAlboSponsorSpvs`) : ~46 deals
>   patchés par `_id` prod avec garde org + nom de la cible, écriture
>   uniquement des champs `undefined` (sauf requalification Keenest
>   `instrumentKind`→`bsa_air`, idempotente par valeur). Données en dur dans
>   le module, converties aux conventions du schéma (cents, bps, ms epoch,
>   multiples décimaux).
> - `'semestriel'` ajouté à `COUPON_PERIODICITIES`
>   (`convex/lib/instruments.ts`) + labels `enum.couponPeriodicity` dans
>   `src/locales/{fr,en}/participations.json` — schéma, mutations et UI
>   suivent automatiquement.
> - Extraction amont : 8 agents parallèles sur le Drive (dossier
>   « ⚠️ Investissements »), ~240 valeurs sourcées (doc + citation +
>   confiance) ; les estimations fragiles (% SPV sur émission max, valos de
>   tours absentes des docs) ne sont volontairement PAS importées. Runbook
>   prod dans le doc-comment du module + ligne dans `MIGRATIONS.md`.

## v1.68.0 — 13/07/2026 à 18:55 — Reports par email : rattachement automatique à la participation (brique 3)

Troisième brique du circuit des reports par email. Chaque email transféré est
désormais rattaché automatiquement à la bonne participation : l'assistant lit
le message (y compris le bloc de transfert pour retrouver l'auteur d'origine),
le compare au portefeuille des deux organisations, et sa proposition n'est
acceptée que si elle est confirmée par un signal vérifiable (le domaine email
de l'auteur ou le nom de la boîte présent dans le message) — jamais sur sa
seule intuition. Si la boîte existe dans les deux organisations ou via
plusieurs entités, le rattachement s'applique à toutes. Le cas « un fonds
transmet le report d'une de ses participations » est reconnu et rattaché à la
bonne cible. En cas de doute (introuvable, plusieurs candidates possibles),
l'email part en file « À traiter » avec la raison affichée, et la page
« Reports entrants » montre désormais la participation rattachée.

> **🔧 Notes techniques**
>
> - Nouveau module `convex/reportIdentify.ts` : `run` (internalAction) chaîné après l'auth de la brique 2 (directement, ou après hydratation du corps via `thenIdentify`). Verrou `markProcessing` (statut `received` + `senderUserId` + pas déjà matché) contre les doubles exécutions.
> - Appel LLM au pattern projet (`generateObject` Zod sur `getModel()` OpenRouter, fallback `generateText` + parse JSON) : candidates = toutes les `companies` kind `portfolio` non archivées des 2 orgs (id, nom, domaine, org) ; sortie = auteur réel, ids candidats, cas fonds→participation, confiance. Garde anti-injection dans le system prompt (le contenu du mail est une donnée).
> - **Corroboration déterministe obligatoire** : domaine de l'auteur réel = `companies.domain` (freemails et domaines internes exclus), ou nom en mot entier dans objet+corps (emails/URLs strippés — leçon Albo App). Pick non corroboré = pas de match. Cas fonds : corroboration par nom uniquement.
> - **Démultiplication** : expansion du match à toutes les entités de même domaine ou même nom (cross-org) → `inboundEmails.matchedCompanies` (+ `realSenderEmail`, `matchMethod`). Ambiguïté = clés d'identité distinctes parmi les picks corroborés → `needs_review`/`ambiguous` ; sinon `no_match` / `identify_error`.
> - Page `/app/all/reports` : colonne Participation (noms résolus dans `reportInbox.list`) ; nouvelles raisons i18n fr/en. `convex/_generated/api.d.ts` re-synchronisé à la main (codegen indisponible dans l'environnement).

## v1.67.0 — 13/07/2026 à 18:00 — Reports par email : contrôle de l'expéditeur (brique 2)

Deuxième brique du circuit des reports par email. Chaque email reçu est
désormais authentifié dès son arrivée : seuls les emails transférés par un
membre de l'équipe sont acceptés pour traitement. Un email venant d'une
adresse inconnue, ou marqué comme spam, part en quarantaine — visible sur la
page « Reports entrants » avec le badge « À traiter » et sa raison
(« Expéditeur inconnu » ou « Spam ») — et ne reçoit jamais aucune réponse
automatique : impossible pour un tiers de deviner que l'adresse existe.

> **🔧 Notes techniques**
>
> - Auth expéditeur inline dans `reportInbox.ingest` (même transaction que l'insert) : `From` doit matcher un `users` (index `by_email`) membre d'au moins une org (`organizationMembers.by_user`) → `senderUserId` posé ; sinon statut `needs_review` + `statusReason: 'unknown_sender'`. Échec de casse = fail-safe vers la quarantaine.
> - Label AgentMail `spam` (détection native) capturé dans `normalizeMessage` (nouveau champ `labels`) → quarantaine `statusReason: 'spam'` avant même le check expéditeur.
> - Nouveau champ `inboundEmails.senderUserId` (optional) ; `reportInbox.list` expose `senderVerified` ; la page `/app/all/reports` affiche la raison à côté du badge (i18n `reports:reasons.*` fr/en).
> - Log d'observabilité des clés du payload webhook (préparation du contrôle SPF/DKIM : on décidera sur la forme réelle des messages, cf. design).
> - Aucun email sortant dans toute la brique (anti-énumération) — les notifications arrivent en brique 6.

## v1.66.0 — 13/07/2026 à 17:40 — Réception des reports par email (brique 1)

Première brique du nouveau circuit de traitement des reports envoyés par
email. Chaque email transféré vers la boîte reports dédiée est désormais
enregistré dans Albo OS dès sa réception — avant tout traitement — et visible
sur une nouvelle page « Reports entrants » (vue toutes organisations) : date
de réception, expéditeur, objet, nombre de pièces jointes et statut. Un même
email reçu deux fois n'apparaît qu'une seule fois. Les étapes suivantes
(vérification de l'expéditeur, rattachement à la participation, extraction du
contenu et des métriques, récap) arriveront brique par brique ; l'ancienne
version expérimentale de ce circuit a été retirée.

> **🔧 Notes techniques**
>
> - Nouvelle table `inboundEmails` (store-first) : chaque webhook AgentMail `message.received` est inséré avec le statut `received` avant tout traitement ; dédup par `agentmailMessageId` (index `by_message_id`) dans `reportInbox.ingest` ; snapshots de corps tronqués à 100k chars (cap document 1 Mo), hydratation asynchrone via `body_url`/API quand le webhook arrive sans corps.
> - `convex/agentmail.ts` réécrit : wrapper REST minimal (normalize, fetchBody, getMessage), vérif Svix inchangée, garde anti-boucle (message émis par l'inbox → ignoré), le webhook ne fait plus aucune logique métier.
> - Pipeline legacy supprimé : `convex/reportPipeline.ts`, `convex/reportAnalysis.ts`, `convex/lib/reportMatching.ts`, `convex/lib/reportLinks.ts`, `convex/lib/ocr.ts` + test orphelin. Les tables `companyReports`/`documents`/`companyIntelligence` et leurs queries de lecture restent.
> - Nouvelle page `/app/all/reports` (`src/routes/app/all/reports.tsx`) branchée sur `reportInbox.list` (accès : membre d'au moins une org, même frontière que la vue agrégée) ; entrée nav « Reports entrants », namespace i18n `reports` (fr+en).
> - `convex/_generated/api.d.ts` synchronisé à la main (codegen indisponible dans l'environnement d'exécution — pas d'auth Convex) : à régénérer au prochain `convex dev` local.

## v1.65.3 — 13/07/2026 à 12:31 — Mise à jour des fiches Better Auth de l'assistant

Changement interne, sans effet visible dans l'app : les fiches de référence
Better Auth utilisées par l'assistant IA ont été resynchronisées avec leur
version à jour en amont, et une fiche qui ne se chargeait plus a été réparée.

> **🔧 Notes techniques**
>
> - Bump des 6 skills `better-auth/skills` au commit upstream `17dfe3a` dans `skills-lock.json`. Contenu mis à jour pour `better-auth-best-practices`, `create-auth`, `organization-best-practices`, `two-factor-authentication-best-practices` ; inchangé pour `email-and-password-best-practices` et `better-auth-security-best-practices`.
> - Échec `skills-drift` réparé : l'upstream a renommé `security/SKILL.MD` → `security/SKILL.md` (casse du nom de fichier, `raw.githubusercontent` est sensible à la casse) ; `skillPath` corrigé dans le lock, contenu identique.
> - Skill `create-auth-skill` renommé `create-auth` pour suivre le `name` amont : dossier `.agents/skills/`, symlink `.claude/skills/`, clé de lock et ligne du tableau `CLAUDE.md`.
> - Diffs upstream relus un par un (aucune prompt-injection) ; re-vendorisation via `raw` (SHA résolu par `git ls-remote`, sans `--update` car `api.github.com` est bloqué dans le sandbox).

## v1.65.2 — 13/07/2026 à 11:56 — Cadre de travail de l'assistant IA

Changement interne, sans effet visible dans l'app : l'assistant IA suit
désormais un cadre explicite avant chaque tâche de code — comprendre la
demande, proposer un plan et le faire valider avant d'écrire, puis rester au
plus près de ce qui est demandé sans y ajouter de « petit plus » non demandé.

> **🔧 Notes techniques**
>
> - Section « Règles de travail » ajoutée en fin de `CLAUDE.md` (append-only, aucun contenu existant modifié).
> - Nouveau skill `.claude/skills/golden-rules/SKILL.md` (`/golden-rules`) : reformulation de l'intention → plan-first → 5 règles d'exécution → étape de vérification.
> - Fichier réel sous `.claude/skills/` (délibérément pas sous `.agents/skills/`, que `pnpm run sync:skills` écrase depuis l'upstream).

## v1.65.1 — 09/07/2026 à 14:31 — Fiche deal Royalties : saisie du CA réel réparée

Sur un deal **Royalties**, cliquer sur une case **CA réel** (ou CA du BP
initial) du tableau trimestriel pour saisir un montant faisait quitter la
fiche et afficher **« Deal introuvable »**, sans jamais laisser rien
renseigner. La case s'ouvre désormais **en édition directe**, on tape le
montant et il s'enregistre **sans changer de page**.

> **🔧 Notes techniques**
>
> - Bug de _rules of hooks_ : `EditableCa` (`RoyaltiesPanel.tsx`) appelait
>   `useAmountField` **dans** la branche `if (editing)`. Le passage en édition
>   ajoutait un hook absent du render précédent → `Rendered more hooks than
during the previous render`. Le hook est remonté au **top-level** du
>   composant, ses props n'étant _spreadées_ sur l'input que quand la cellule
>   est ouverte (même pattern que `DealFieldInput`).
> - Pourquoi « Deal introuvable » : la route `deals.$dealId.tsx` déclare **le
>   même** composant `NotFound` en `errorComponent` **et** `notFoundComponent`,
>   donc tout crash de render dans la fiche s'affiche comme un deal absent. Ni
>   donnée ni schéma touchés.
> - Filet manquant relevé : `eslint-plugin-react-hooks` n'est pas dans la
>   config lint (`@tanstack/eslint-config` ne l'embarque pas), d'où le passage
>   en prod sans alerte. Piège de debug + recommandation documentés dans
>   `KNOWN_ISSUES.md` (section panneau Royalties).

---

## v1.65.0 — 03/07/2026 à 00:05 — Vue Deals : nouvelles colonnes, colonne figée et deals soldés à part

La liste transversale des **deals** (par organisation et vue agrégée) adopte
les mêmes repères que la vue Entreprises. L'ordre de lecture devient :
**Société · Secteur · Instrument · Stage · Investi le · Montant investi ·
Reçu · TVPI**. Les colonnes Investisseur et Engagé disparaissent pour alléger
le tableau ; le **Stage** reprend le tour de table du deal (Seed, Série A…)
quand il est renseigné, « — » sinon.

Quand le tableau déborde en largeur, la **colonne Société reste figée** à
gauche pendant le défilement horizontal — le nom de la boîte reste toujours
sous les yeux. Et comme pour les entreprises, les **deals soldés** (sortie
totale ou perte) passent dans une **section dédiée en bas de page**, où la
colonne **Statut** réapparaît pour distinguer les sorties des dépréciations.
Une seule barre de recherche et de filtres pilote les deux tables ; l'export
CSV reste inchangé et couvre l'ensemble des deals.

> **🔧 Notes techniques**
>
> - `DealsListView.tsx` refondu : d'une table plate unique à un orchestrateur
>   (recherche + facettes + split actives/soldées) rendant deux `DealsTable` —
>   le bas porte le flag `settled` (colonne Statut réaffichée, tri désactivé),
>   sur le modèle `ParticipationsView`/`ParticipationsTable`.
> - Colonnes : Secteur (`col.sector`), Stage (nouveau `col.stage`, lit le champ
>   **existant** `roundType` via `enum.roundType.*` — aucun ajout au schéma, pas
>   de backfill), Investi le (nouveau `col.investedOn`, affiche `signedDate`),
>   Montant investi (`col.invested`, donnée `paidActual`). Retrait des colonnes
>   Investisseur / Engagé / Statut de la table active (facette Statut conservée).
> - `roundType` remonte déjà via le `...deal` de `enrich` (`deals.list` +
>   `aggregate.listDeals`, pas de validateur `returns`) ; surfacé côté client par
>   un type local `DealListRow = DealRow & { roundType? }` — le `DealRow` partagé
>   et `ParticipationsTable.tsx` ne sont pas touchés.
> - Colonne figée : `stickyHeadClass`/`stickyCellClass` dupliqués localement
>   (fond opaque + hover `color-mix` piloté par `group-hover`, cf.
>   `KNOWN_ISSUES.md` « Colonne figée »). Split : `fully_exited`/`written_off`
>   en bas, le reste (dont `partially_exited`) reste actif. Routes
>   `deals.index.tsx` / `all/deals.tsx` inchangées (prop compatible).
> - i18n EN + FR : `col.stage`, `col.investedOn` (participations),
>   `settled.sectionTitle` (deals). TESTING.md : DL1/DL3/DL4 mis à jour,
>   nouvelles lignes DL6 (colonne figée) + DL7 (split soldés).

---

## v1.64.0 — 02/07/2026 à 23:31 — Vue Entreprises : nouvelles colonnes et colonne figée

La liste des **entreprises** (par organisation et vue agrégée) gagne trois
colonnes : le **one-liner** (le pitch de la boîte en une ligne, à remplir à la
main sur chaque société), le **secteur**, et le **score IA** — la note sur 10
issue de la synthèse automatique des reports investisseurs, avec le même code
couleur que la fiche société (vert ≥ 7, orange 5-6, rouge ≤ 4). Une société
sans synthèse affiche simplement « — » ; le score apparaîtra au fil des
reports reçus.

L'ordre de lecture devient : société · one-liner · secteur · score IA ·
deals · **montant investi** (le décaissé réel) · reçu · TVPI. Et quand la
table déborde en largeur, la **colonne société reste figée** à gauche pendant
le défilement horizontal — on garde toujours le nom sous les yeux. La section
des participations soldées (avec son badge de sortie) est inchangée.

> **🔧 Notes techniques**
>
> - Schéma : nouveau champ `companies.oneLiner` (`v.optional(v.string())`),
>   sans backfill ni UI de saisie (remplissage manuel).
> - `convex/deals.ts` : `companyRef` expose `oneLiner` ; nouveaux helpers
>   exportés `aiHealthScore` (lecture défensive de
>   `aiAnalysis?.health_score?.score`, null si non numérique) et
>   `aiScoresByCompany` (une lecture indexée `companyIntelligence.by_org` →
>   map companyId → score, pas de N+1). `deals.list` attache `target.aiScore` ;
>   `convex/aggregate.ts` fait la même jointure batchée par org.
> - `ParticipationsTable.tsx` : colonnes One-liner (tronquée, tooltip),
>   Secteur (libellé i18n `sectors.*`), Score IA (carré teinté via
>   `scoreVerdict`/`verdictSquareClass` de `src/lib/reportScore.ts`) ; en-tête
>   « Versé » remplacé par la clé `col.invested` (« Montant investi », même
>   donnée `paid`). Première colonne figée : `sticky left-0` + fond **opaque**
>   `bg-background` (sinon les cellules transparaissent en glissant dessous) ;
>   le hover de ligne étant translucide (`bg-muted/50`), la cellule figée
>   composite la même teinte via `color-mix` piloté par `group-hover` (classe
>   `group` posée sur toutes les lignes). `ui/table.tsx` intact (le
>   passthrough `className` suffisait).
> - i18n EN + FR : `col.oneLiner`, `col.sector`, `col.aiScore`,
>   `col.invested`. TESTING.md : nouvelle ligne SH19.

---

## v1.63.0 — 02/07/2026 à 19:09 — Édition au clic des fiches deal & société

Fini le détour par le menu « … » pour corriger une valeur. Sur la fiche d'un
**deal**, les champs du bloc **« Détails de l'instrument »** (montants, taux,
dates, listes) s'éditent maintenant **directement au clic** : on clique sur la
valeur, on la modifie, **Entrée** (ou un clic ailleurs) enregistre, **Échap**
annule. Même geste sur la fiche d'une **société**, pour le bloc **« Identité »** :
**secteur**, **SIREN** et **domaine** se corrigent d'un clic.

Les valeurs **calculées** ne bougent pas — détention, nombre d'actions, décaissé
réel et lien Attio restent en lecture seule — et un champ ajusté à la main est
**protégé** : un ré-import de données ne l'écrase plus. Le menu « … » reste là
pour ce qu'il fait seul (renommer, changer le type d'instrument, réaffecter le
deal, gérer les personnes). Enfin, tant qu'on **prévisualise** un autre type
d'instrument, l'édition au clic est mise en pause pour éviter toute confusion.

> **🔧 Notes techniques**
>
> - Nouveau composant partagé `src/components/ui/inline-field.tsx` (`InlineField`) :
>   généralise l'interaction clic → saisie → Entrée/blur commit / Échap cancel de
>   `EditableCa` (`RoyaltiesPanel`) à une grille de champs multi-formats. L'éditeur
>   est piloté par le `FieldFormat` (€ / % / date / nombre / décimal / année /
>   texte, `Select` pour les enums) ; `renderEditor` sert d'échappatoire pour le
>   combobox créable du secteur.
> - Parsing/sérialisation factorisés dans `src/lib/parse.ts` (`parseField`,
>   `rawToInput`, type `FieldFormat`) — source unique partagée avec le dialog
>   d'édition ; `deals.$dealId.tsx` s'y branche (suppression du `parseField`
>   local dupliqué, `fieldToInput` délègue à `rawToInput`).
> - Deal : `InstrumentBlock` / `FieldsView` reçoivent `editable` (= `!unsaved`,
>   coupé en aperçu de type) et écrivent via un patch à un seul champ sur
>   `deals.update` (qui marque `manuallyEditedFields`). Société : bloc Identité
>   câblé sur `companies.update` (secteur / SIREN / domaine) ; `SectorCombobox`
>   gagne `defaultOpen` + `onOpenChange` pour s'ouvrir puis se refermer en inline.
> - Les colonnes deal ne se vident pas via la mutation → un champ vidé est un
>   no-op ; côté société, SIREN / domaine vidés partent en `''` (efface). Nouvelle
>   clé i18n `participations:edit.inlineLabel` (EN + FR).

---

## v1.62.0 — 02/07/2026 à 15:17 — Fiche entreprise : synthèse IA en pleine largeur

Sur la page d'une société, la **synthèse IA** quitte les onglets pour devenir
un **bloc pleine largeur**, placé juste sous le bloc des deals et au-dessus des
onglets. Son contenu ne change pas : le score coloré selon le verdict, la phrase
de synthèse, les points forts et de vigilance, les trois indicateurs clés et
l'alerte critique (uniquement si elle existe). Tant qu'aucune synthèse n'a été
générée, une simple ligne discrète prend sa place.

Les onglets en dessous sont simplifiés et réordonnés : **Reports** (l'historique
des reports) d'abord, puis **Documents**. L'ancien onglet « Synthèse IA » est
supprimé — son contenu vit désormais dans le bloc au-dessus. Le bouton
« Ajouter un report » (désactivé) disparaît lui aussi.

> **🔧 Notes techniques**
>
> - Nouveau composant `CompanyAiSynthesisBlock.tsx`, extrait tel quel de
>   l'ex-zone 1 (héros `SynthesisHero`) de `CompanyReportsSection.tsx` : même
>   query `intelligence.getByCompany`, même rendu. Monté dans la route
>   `participations.$companyId.tsx` en pleine largeur entre le bloc Deals et le
>   `<Tabs>`, gardé par `company`.
> - `CompanyReportsSection.tsx` ne rend plus que l'historique (ex-zone 2) ;
>   en-tête « Historique des reports » conservé, bouton « Ajouter un report »
>   désactivé retiré (+ imports orphelins `Plus`, `Tooltip*`, `cn`,
>   `reportScore`, `moneyTone`).
> - `<Tabs>` réordonné (`defaultValue="reports"`, Reports puis Documents) ;
>   onglet `intelligence` + composant `CompanyIntelligenceCard.tsx` supprimés.
>   Query `intelligence.getByCompany` **conservée** (utilisée par le bloc).
> - État vide standalone = une ligne sobre (plus d'encart en pointillés).
> - i18n EN+FR : retrait de `tabs.intelligence`, `reports.history.add/addHint`,
>   `intelligence.title/updated/section.insights/section.alerts` ; clés
>   partagées avec le bloc (`intelligence.status.*`, `section.good/bad`)
>   conservées.

---

## v1.61.1 — 02/07/2026 à 15:16 — Suivi des remontées vers le template

Changement interne, sans effet visible dans l'app : on met en place un suivi
des améliorations « cœur » d'Albo OS qui pourraient être reversées dans le
template de départ (le starter SaaS dont Albo OS est dérivé), pour ne plus les
perdre au fil des développements.

> **🔧 Notes techniques**
>
> - Nouveau `TEMPLATE_SYNC.md` : backlog des candidats à remonter vers
>   `albo-ouvre-boite` (sens inverse de `UPGRADING.md`), avec l'heuristique
>   ✅/❌ (générique vs métier) et un tableau de suivi par candidat.
> - `CLAUDE.md` § « Pre-PR doc audit » : ajout de la question 6 — à chaque PR,
>   flaguer le code réutilisable (infra, auth, `convex/lib/`,
>   `src/components/ui/*`, DX/CI) dans `TEMPLATE_SYNC.md` + une section
>   « Template sync » dans la description de la PR.
> - L'agent se contente de flaguer ; Benjamin/Clément portent le code dans le
>   template. Pointeur croisé ajouté en tête de `UPGRADING.md`.

## v1.61.0 — 02/07/2026 à 13:41 — Fiche entreprise : onglet Reports repensé

L'onglet **Reports** d'une société a été réorganisé en deux zones plus
lisibles.

En tête, une **synthèse IA** met en avant le dernier report reçu : un score
sur 10 dans un carré coloré selon le verdict (vert « en bonne voie », ambre
« à surveiller », rouge « à risque »), une phrase de synthèse, les points
forts et les points de vigilance côte à côte, trois indicateurs clés, et —
seulement s'il y en a une — une alerte critique intégrée et dépliable.

En dessous, l'**historique des reports** se présente comme une pile de cartes
cliquables, de la plus récente à la plus ancienne. Chaque carte affiche la
période, un résumé en une ligne, sa date de réception et son ancienneté
(« il y a 13 j »), un badge « à jour » sur le dernier report, et un raccourci
« Voir les docs » vers les documents source. Un clic ouvre le détail complet
du report.

> **🔧 Notes techniques**
>
> - `CompanyReportsSection.tsx` refondu en deux zones : héros `SynthesisHero`
>   (query `intelligence.getByCompany`, même payload Cerveau 3 que
>   `CompanyIntelligenceCard`, présentation différente) + `ReportHistory`
>   (cartes issues de `companyReports.listByCompany`, dialog détail conservé).
> - Helper couleur centralisé `src/lib/reportScore.ts` : `scoreVerdict`
>   (seuils ≥7 / 5-6 / ≤4) → carrés teintés sur les tokens
>   `positive` / `warning` / `destructive`. Nouveau token sémantique
>   `--warning` (+ `--warning-foreground`), light+dark, dans `brand.css` —
>   seul changement hors onglet.
> - `documents.listByCompany` renvoie désormais `reportId` : les pièces
>   jointes email d'un report sont regroupées côté client pour alimenter
>   « Voir les docs » (aucun nouvel endpoint).
> - Le score reste au niveau société : les cartes de l'historique ont un
>   carré neutre (pas de score par report). Bouton « Ajouter un report »
>   désactivé avec tooltip (ingestion email uniquement, pas de création
>   manuelle). L'onglet « Synthèse IA » (intelligence) est conservé tel quel.

## v1.60.3 — 02/07/2026 à 12:01 — Chat IA : budget et validation sur l'accès HTTP

Durcissement de sécurité interne. L'accès HTTP annexe du chat IA (un point
d'entrée direct utilisé pour des tests, en marge du panneau intégré) applique
désormais le **même budget d'usage par utilisateur** que le panneau : un membre
authentifié ne peut plus contourner la limite en bouclant sur cet accès, ce qui
protège le coût des appels au modèle. Le corps de chaque requête est aussi
validé — JSON malformé rejeté proprement, taille du message plafonnée,
organisation vérifiée — au lieu d'être traité sans contrôle. Aucun changement
visible à l'usage normal.

> **🔧 Notes techniques**
>
> - `convex/chat.ts`, handler `streamOverHttp` (route `/api/chat`) : 4
>   correctifs chirurgicaux, la logique de streaming et
>   `sendMessage`/`respondToToolApproval` restent inchangées.
> - `request.json()` est enveloppé dans un `try/catch` → `400 Bad JSON` si le
>   corps n'est pas du JSON valide (avant : seule httpAction sans garde,
>   audit §5.1).
> - `consumeLimit(ctx, 'chatSend', probeUser._id)` ajouté **après**
>   `actionAuthProbe` (user résolu), même clé/budget que `sendMessage`
>   (30/min/user, `convex/rateLimiters.ts`) — comble le contournement §4.1.
> - Plafond `PROMPT_MAX = 30_000` caractères sur le prompt (aligné sur
>   `MAX_TEXT` de `reportAnalysis.ts`) → `400 Prompt too long` si dépassé.
> - L'appel `actionAuthProbe` est enveloppé dans un `try/catch` → `403`
>   propre : un `orgId` malformé (rejeté par le validateur `v.id`) ou un
>   non-membre ne fuit plus en `500`. Signature d'`actionAuthProbe` et casts
>   `as Id<>` laissés tels quels (option légère).
> - `TESTING.md` : cas C31–C34 ajoutés au Niveau 5 (JSON malformé, 31e
>   requête/min, prompt géant, `orgId` invalide).

## v1.60.2 — 02/07/2026 à 11:14 — Réception d'e-mails : vérification obligatoire

Durcissement de sécurité interne. Le point d'entrée qui reçoit les e-mails
entrants (utilisés pour la génération de rapports) rejette désormais
systématiquement toute requête tant que son secret de vérification n'est pas
configuré, au lieu de la traiter sans contrôle. Le comportement est aligné sur
les autres intégrations entrantes (banque, CRM, Telegram). Aucun changement
visible à l'usage : le secret est bien en place en production.

> **🔧 Notes techniques**
>
> - `convex/agentmail.ts`, handler `agentmailWebhook` : le chemin fail-open
>   (`console.warn` + traitement du payload quand `AGENTMAIL_WEBHOOK_SECRET`
>   est absent) est remplacé par un guard fail-closed
>   `if (!secret) throw new ConvexError('missing_agentmail_webhook_secret')`,
>   identique à `telegram.ts`, `powens.ts` et `attioSync.ts`. La vérification
>   Svix devient inconditionnelle (le secret est garanti présent) ; import de
>   `ConvexError` ajouté.
> - Hors périmètre, signalés par l'audit et à traiter dans des PR séparées :
>   comparaison Svix non constant-time (§3.4) et absence d'anti-rejeu (§3.5).

## v1.60.1 — 02/07/2026 à 10:58 — Isolation inter-organisations renforcée (deals)

Correctif de sécurité interne. À la modification d'un deal, le SPV
intermédiaire ne peut plus être rattaché à une société d'une autre
organisation : l'isolation des données entre organisations est désormais
vérifiée de la même façon à la création **et** à la modification d'un deal.
Aucun changement visible à l'usage.

> **🔧 Notes techniques**
>
> - `convex/deals.ts`, mutation `update` : ajout de la revalidation
>   `assertSameOrg(ctx, deal.orgId, patch.viaSpvCompanyId, 'spv_wrong_org')`
>   quand le patch porte un `viaSpvCompanyId`, symétrique de celle déjà
>   présente dans `create`. `investorCompanyId` et `targetCompanyId` étaient
>   déjà revalidés dans `update` ; seul `viaSpvCompanyId` manquait.
> - Sans ce contrôle, un membre pouvait pointer le SPV d'un de ses deals vers
>   une société d'une autre org et lire ses données au travers de l'enrichissement
>   du deal — seule faille d'isolation cross-org restante côté backend.

## v1.60.0 — 01/07/2026 à 18:41 — TRI des participations exact (calcul serveur)

Le taux de rendement interne (TRI) affiché pour une société soldée est
désormais **exact**. Il est calculé côté serveur sur l'enchaînement daté des
flux réels (versements et encaissements) de **tous** les deals de la société,
au lieu d'une approximation qui annualisait le multiple entre la première
entrée et la dernière sortie.

Concrètement, pour une société qui a plusieurs investissements à des dates
d'entrée et de sortie différentes, le TRI affiché **change** — il devient plus
juste. L'écart avec l'ancien chiffre peut être important quand les opérations
sont étalées dans le temps. Le TRI reste vide (« — ») lorsqu'il n'est pas
définissable mathématiquement, par exemple une perte totale sans aucun
encaissement — le multiple 0,00× et le badge « perdu » signalent déjà la perte.

L'export CSV des participations gagne deux colonnes, **MOIC** et **TRI**
réalisés par ligne, alignées sur ces mêmes chiffres. L'assistant IA lit lui
aussi ces valeurs réelles (versé, reçu, MOIC, TRI) plutôt que les seuls
montants saisis.

> **🔧 Notes techniques**
>
> - Nouveau helper pur `realizedCashflows(txs, instrumentKind)` dans
>   `convex/lib/metrics.ts` : flux signés et dé-TVA-és (÷1,2 pour `royalty`),
>   prêts pour `xirr()`. Le TRI d'une société se résout sur l'**union** des flux
>   de ses deals — le TRI/IRR n'est pas additif, il ne se déduit pas des TRI par
>   deal.
> - `convex/deals.ts` : helper `dealRealizedMetrics(ctx, deal)` (une seule
>   lecture des transactions) → `{ paidActual, received, flows, moic, irr }`
>   avec `irr = xirr(flows)`. `deals.list` renvoie ces champs par deal ; idem
>   `convex/aggregate.ts` pour la vue cross-org `/app/all`.
> - Front `ParticipationsTable.tsx` : le groupement par société accumule les
>   `flows` et calcule `tri = xirr(g.flows)` (solveur partagé `~/lib/xirr`).
>   Suppression de `annualizedTri` et des dates de groupe `signedDate` /
>   `exitedDate` qui ne servaient qu'à l'approximation. Le MOIC société reste
>   calculé côté client (Σproceeds / Σcapital, additif donc exact).
> - Export CSV `ParticipationsView.tsx` : colonnes MOIC (`d.moic`) et TRI
>   (`d.irr`, ratio décimal), lues depuis les champs autoritatifs.
> - Outil IA `agentTools.ts` (`listDealsInternal` / `listDeals`) : expose le
>   réalisé `paidActual` / `received` / `moic` / `irr` par deal.
> - Tests purs : `realizedCashflows` (`tests/metrics.test.ts`) et un cas de
>   divergence à 2 deals (`tests/groupTri.test.ts`) — XIRR exact ≈ 28,6 % vs
>   ancienne approximation ≈ 7,8 %. Dashboard inchangé (TVPI/DPI dérivés
>   d'agrégats additifs).

## v1.59.1 — 01/07/2026 à 18:00 — Cohérence des indicateurs de portefeuille

Les multiples et taux de performance (MOIC, TVPI, TRI, DPI, valeur
résiduelle / NAV) sont désormais calculés à partir d'une seule et même
formule partagée par tous les écrans (liste des participations, tableau de
bord, export CSV, fiche fonds). Auparavant chaque écran refaisait le calcul
de son côté, avec un risque de voir les chiffres diverger d'un endroit à
l'autre. Aucun chiffre affiché ne change : c'est un nettoyage interne qui
garantit que tous les écrans parlent le même langage.

> **🔧 Notes techniques**
>
> - Nouveau module pur `convex/lib/metrics.ts`, source unique de vérité :
>   `sumCashflows` (capital = Σ sortantes jamais dé-TVA'ées ; proceeds = Σ
>   entrantes, ÷1,2 uniquement pour `royalty`), `proceedsFromReceived`,
>   `residualValueCents`, `moic`, `tvpi` (sur le reçu brut), `dpi`,
>   `annualizedTri`, et un `MS_PER_YEAR` unique aligné sur actual/365.
> - `src/lib/xirr.ts` déplacé vers `convex/lib/xirr.ts` (importe le
>   `MS_PER_YEAR` partagé) ; l'ancien chemin ré-exporte pour ne rien casser
>   (`RoyaltiesPanel`).
> - Sites rebranchés sans changer les valeurs : `dealMetrics.dealMoic`
>   (wrapper mince), `ParticipationsTable` (résiduel + MOIC/TVPI/TRI groupe
>   et fiche), `ParticipationsView` (TVPI export CSV), `FundSection`
>   (DPI/TVPI fonds), dashboard `index.tsx` (TVPI/DPI), `convex/dashboard.ts`
>   et `agentTools.getDashboardSummaryInternal` (NAV via `residualValueCents`).
> - Correction d'une incohérence : le TRI de la liste passait de 365,25 à 365
>   jours pour s'aligner sur le XIRR (variation d'affichage négligeable).
> - Nouveau `tests/metrics.test.ts` (node:test) verrouillant dé-TVA
>   royalty-only, capital jamais dé-TVA'é, MOIC=0 → TRI −100 %, capital=0 →
>   null, day-count.

## v1.59.0 — 01/07/2026 à 18:04 — Royalties : trimestres en colonnes dans le suivi

Sur la fiche d'une participation en royalties, le tableau de suivi trimestriel
est désormais présenté « à l'horizontale » : chaque trimestre occupe une
**colonne**, et les lignes portent les métriques (CA et royalties du BP
initial, du BP dégradé, du réel, puis l'écart en euros et en pourcentage). Le
cumul reste affiché, à droite du tableau. Cette orientation colle à la lecture
habituelle d'un business plan et facilite la comparaison d'un trimestre à
l'autre. Les cases de CA (BP initial et réel) restent modifiables au clic comme
avant.

> **🔧 Notes techniques**
>
> - `src/components/deals/RoyaltiesPanel.tsx` : transposition purement
>   présentationnelle du tableau. `buildRoyaltyRows` (et `royalties.ts`) est
>   inchangé — `rows` (une entrée par trimestre) et `totals` sont réutilisés
>   tels quels, seul le rendu change.
> - Les trimestres deviennent les en-têtes de colonnes ; deux colonnes de
>   gauche portent le groupe (rowSpan=2 : BP initial / BP dégradé / Réel /
>   Écart) et le sous-libellé (CA / Royalties / € / %). Le `Cumul` passe du
>   `TableFooter` (supprimé) à une colonne de droite.
> - Hiérarchie visuelle (`COL_BP_INITIAL` / `COL_BP_DEGRADED` / `COL_REAL`)
>   appliquée aux `TableRow` au lieu des colonnes. Helper local `euroCell`
>   pour les cellules euros en lecture seule ; `EditableCa` réutilisé pour les
>   deux lignes de CA éditables.

## v1.58.0 — 01/07/2026 à 17:48 — Vue transversale des deals + recherche globale

Les deals ne se retrouvaient qu'en passant par leur entreprise, alors qu'une
même boîte peut porter plusieurs deals — impossible de savoir dans quelle entité
vivait un deal donné. Trois nouveautés y répondent :

- **Une liste « Deals »** dans le menu de gauche : tous vos deals, toutes
  entités confondues, sur une seule page. Chaque ligne montre à la fois la
  société investie **et** l'entité investisseuse, avec recherche, filtres
  (instrument, statut, secteur), tri et export CSV. Disponible aussi dans la vue
  agrégée « Toutes les organisations » (avec la colonne Organisation).
- **Une recherche globale (⌘K / Ctrl+K)**, accessible partout depuis le bouton
  « Rechercher » de l'en-tête : elle interroge d'un coup les **deals**, les
  **sociétés** et les **mouvements** bancaires, résultats regroupés par type —
  on choisit d'un clic si l'on ouvre la société ou le deal.
- **L'assistant IA sait sur quoi vous travaillez** : quand vous consultez une
  fiche deal ou société, il opère directement dessus (« résume ce deal » sans
  avoir à le nommer). La recherche propose aussi « Demander à l'IA » pour
  envoyer votre requête à l'assistant.

> **🔧 Notes techniques**
>
> - Liste plate : `src/components/deals/DealsListView.tsx` (une ligne = un
>   deal, cible + investisseur), montée sur les routes
>   `src/routes/app/$orgSlug/deals.index.tsx` et `src/routes/app/all/deals.tsx`
>   (réutilise `api.deals.list` / `api.aggregate.listDeals`). `FacetFilter`
>   extrait de `ParticipationsView` vers un module partagé ; `SortableHead`,
>   `useFormatters`, `useDealTitle`, `residualCents` réutilisés. Entrée nav
>   `items.deals` + segment breadcrumb `deals`.
> - Recherche : query `convex/search.ts:global` (deals + sociétés filtrés en
>   mémoire, transactions via l'index full-text `search_text`), palette
>   `src/components/search/CommandPalette.tsx` (shadcn `command` + `Dialog`),
>   montée dans `route.tsx` avec un listener ⌘K et un bouton dans `AppHeader`.
>   Palette org-scoped.
> - Contexte IA : `AiPanel` dérive l'entité courante (`useParams`) et la passe
>   dans `context.entity` de `sendMessage` / `respondToToolApproval`
>   (`convex/chat.ts`), transmise à `buildInstructions`
>   (`convex/lib/instructions.ts`). Pont « Demander à l'IA » via les props
>   `initialPrompt` / `onPromptConsumed` du panneau.

## v1.57.0 — 01/07/2026 à 16:54 — Participations : retrait de la colonne « Investi le »

La liste des participations (regroupée par entreprise) affichait une colonne
« Investi le ». Comme une même entreprise peut porter plusieurs deals à des
dates différentes, cette date agrégée n'était pas pertinente et pouvait
rester vide. Elle a été retirée de la liste. Les dates propres à chaque deal
(closing, signature) restent visibles sur la fiche du deal et dans l'export.

> **🔧 Notes techniques**
>
> - Suppression de la colonne « Investi le » dans
>   `src/components/participations/ParticipationsTable.tsx` : en-tête, cellule,
>   clé de tri `invested`, et l'agrégat `group.signedDate` (min des
>   `signedDate` des deals) qui n'alimentait plus que cette colonne. `fmtDate`
>   retiré des dépendances de la table et de `CompanyRows`.
> - Le champ per-deal `signedDate` (`DealRow`) reste utilisé par la liste des
>   deals de la fiche entité (`DealsList`) et l'export CSV — non touché.

## v1.56.0 — 01/07/2026 à 16:45 — Participations soldées : toujours visibles, avec le TRI

La section « Participations soldées » en bas de la liste Entreprises est
désormais **toujours dépliée** : plus de bouton pour la replier, elle reste
visible en bas de page. La **barre de recherche et les filtres** du haut de la
liste s'appliquent maintenant **aussi** aux participations soldées — il n'y a
donc plus qu'une seule barre, celle du haut (celle qui était juste au-dessus des
soldées a été retirée).

Côté indicateurs, la colonne **TVPI** a été retirée des participations soldées
(elle vaut toujours le MOIC une fois sorti) et une colonne **TRI** (taux de
rendement annualisé) a été ajoutée à côté du MOIC : elle traduit le multiple en
rendement par an sur la durée de détention. Une perte totale s'affiche à −100 %,
et le TRI reste « — » tant qu'aucune date de sortie n'est renseignée.

> **🔧 Notes techniques**
>
> - `ParticipationsView.tsx` devient le propriétaire unique de la recherche +
>   des facettes (état, `useMemo` `facets`/`filtered`, toolbar, export CSV
>   `handleExport` sur le set complet non splitté, `exportRef`). Il applique le
>   filtre puis splitte en `active` / `settled` et passe chaque sous-ensemble
>   déjà filtré à `ParticipationsTable`. Section soldés rendue en `<section>`
>   avec un simple `<h3>` (plus d'état `open`/chevron), masquée si `settled`
>   filtré est vide.
> - `ParticipationsTable.tsx` perd sa toolbar/recherche/facettes/export
>   (remontés) ; il ne fait plus que grouper par société, trier et paginer. Le
>   variant `settled` remplace la colonne TVPI par **MOIC + TRI**. Nouveaux
>   props `isFiltered` (message vide) et `resetKey` (reset pagination). Helper
>   `residualCents` désormais exporté (réutilisé par l'export dans la vue).
> - TRI = IRR à deux points sur le **même** agrégat que le MOIC :
>   `MOIC^(1/années) − 1`, avec années = (`exitedDate` la plus récente −
>   `signedDate` la plus ancienne) du groupe / `MS_PER_YEAR`. Nécessite les deux
>   dates et une durée positive, sinon `null` → « — ». `exitedDate` ajouté au
>   type `DealRow` (déjà présent côté serveur via le spread `...deal`).
>   Formateur `fmtPercent` ajouté à `useFormatters`. Clé i18n `col.tri`
>   (FR « TRI » / EN « IRR »).

## v1.55.0 — 01/07/2026 à 16:32 — Montants plus lisibles pendant la saisie

Quand vous saisissez un montant en euros dans un champ (création d'un deal,
édition d'une fiche participation, prévisionnel de trésorerie, passif, sorties,
revenus royalties…), les milliers s'espacent automatiquement au fil de la
frappe : `1 000 000` au lieu de `1000000`. Plus besoin de compter les zéros
pour vérifier qu'on tape le bon montant. La valeur enregistrée ne change pas —
seul l'affichage pendant la saisie est mis en forme.

> **🔧 Notes techniques**
>
> - Nouveau composant partagé `src/components/ui/amount-input.tsx` : hook
>   `useAmountField(value, onChange)` (props à spread, gère le formatage, le
>   nettoyage et la restauration du caret via `ref`) + wrapper `AmountInput`
>   pour un `<Input>` simple. Le contrat reste une string brute non formatée
>   côté parent, donc les parsers euros existants (`eurosToCents`,
>   `parseAmountToCents`, `parseEuros`) fonctionnent sans changement.
> - Groupement à l'espace (et non la virgule locale) car le séparateur décimal
>   peut être une virgule ; l'espace est la seule marque de milliers non
>   ambiguë pour de la saisie.
> - Câblé sur tous les champs montant EUR éditables : `CreateDealDialog` et
>   `DealFieldInput` (format `eur` uniquement), `ExitDealDialog`,
>   `ForecastSection`, `CreateEquityDialog`, `RoyaltiesPanel` (cellule inline
>   `EditableCa` + revenu trimestriel). `CreateDealDialog` bascule aussi sur
>   `eurosToCents` (gère la virgule décimale, l'input passant de `number` à
>   `text`).

## v1.54.1 — 01/07/2026 à 16:33 — Nouveautés : les horaires affichés passent à l'heure de Paris

Sur la page Nouveautés, l'heure de chaque mise à jour était écrite en UTC, ce qui
la faisait apparaître environ 2h en avance sur l'heure réelle (heure de Paris).
La convention de rédaction est désormais explicite : l'horaire est écrit en heure
de Paris. Les prochaines entrées afficheront donc la bonne heure.

> **🔧 Notes techniques**
>
> - Aucun changement de code : la page `changelog.tsx` rend `CHANGELOG_PRODUIT.md`
>   tel quel (`?raw`), les horaires sont saisis à la main dans le fichier.
> - Cause du décalage : l'horloge de l'environnement d'exécution est en UTC, mais
>   la règle demande l'heure d'ouverture de PR en Europe/Paris. Sans conversion,
>   les horaires sortaient ~2h trop tôt (CEST) / ~1h (CET).
> - Correctif : renforcement de la règle « Pre-PR doc audit » (question 5) dans
>   `CLAUDE.md` — l'offset UTC→Paris (+2h été / +1h hiver) est maintenant explicité.

## v1.54.0 — 01/07/2026 à 15:00 — Fiches deals : suppression des mentions d'import externe

Sur la fiche d'un deal, la petite pastille jaune « Modifié à la main » et la
note associée dans la fenêtre d'édition ont été retirées : elles faisaient
référence à un mécanisme d'import externe qui n'a plus lieu d'être ici. Les
champs restent modifiables comme avant, l'affichage est simplement plus épuré.

> **🔧 Notes techniques**
>
> - `src/components/deals/InstrumentBlock.tsx` : `FieldRow` ne prend plus le
>   flag `manuallyEdited` ; suppression du point `bg-chart-4` + tooltip et des
>   imports `Tooltip*` désormais inutilisés, ainsi que du `editedSet` dérivé de
>   `deal.manuallyEditedFields`.
> - `deals.$dealId.tsx` : retrait du paragraphe `edit.fieldsHint` dans le
>   dialogue d'édition ; commentaire de mécanisme reformulé sans « Airtable ».
> - i18n : suppression des clés `fiche.manuallyEdited` et `edit.fieldsHint`
>   (fr/en), et retrait de « Airtable » de `org.settings.demoDescription`.
> - Le garde-fou `manuallyEditedFields` reste actif côté backend (`upsertDeals`)
>   — seule sa surface UI disparaît.

## v1.53.3 — 01/07/2026 à 12:00 — Secteur d'une entité : un secteur créé réapparaît dans la liste

Quand vous ajoutiez un secteur qui n'était pas dans la liste proposée (en le
tapant à la main sur une entité), il n'était plus proposé ensuite : sur une
autre entité, il fallait le retaper à l'identique. Désormais, tout secteur déjà
utilisé par une entité de l'organisation apparaît directement dans la liste de
sélection du champ secteur.

> **🔧 Notes techniques**
>
> - `SectorCombobox` accepte une prop `extraSectors` : les valeurs de secteur
>   libres (hors `SECTOR_SLUGS`) déjà stockées sur d'autres entités sont
>   fusionnées dans la liste d'options, affichées telles quelles (pas de label
>   i18n), dédupliquées.
> - Dans `EditCompanyDialog` (`participations.$companyId.tsx`), on lit
>   `api.companies.list` scopée à l'org pour dériver les secteurs existants et
>   les passer au combobox. `companies.sector` reste un champ texte libre.

## v1.53.2 — 01/07/2026 à 11:00 — Reporting par email : le corps des mails est enfin lu

Certains reports transférés par email n'apparaissaient pas dans l'app. En cause :
le contenu des mails un peu volumineux (typiquement un transfert avec pièce
jointe) n'était pas récupéré, ce qui empêchait la création du report — sans
message d'erreur visible. C'est corrigé : un report transféré est désormais
traité à partir du corps du mail et rattaché à la bonne participation, même si
les clés optionnelles (lecture des PDF, réponse de confirmation) ne sont pas
encore configurées.

> **🔧 Notes techniques**
>
> - Le webhook AgentMail `message.received` omet `text`/`html` pour les gros
>   messages : le corps vit derrière un `body_url` présigné (S3). Nouveau
>   `fetchBody()` dans `convex/agentmail.ts` (GET du lien, sans auth) ;
>   `reportPipeline.run` extrait le corps dans l'ordre inline → `body_url` →
>   `getMessage`.
> - `apiKey()` ne throw plus : `getMessage` / `downloadAttachment` / `reply` /
>   `send` dégradent proprement (warn + null/false) quand `AGENTMAIL_API_KEY` est
>   absente — le run ne crashe plus après le 200 du webhook.
> - Parsing du `From` « Nom <email> » → email seul ; logs `[reportPipeline]`
>   (received / body chars / matched / stored) pour l'observabilité dans Convex.

## v1.53.1 — 30/06/2026 à 20:15 — Garde-fou : changelog obligatoire en CI

Pour éviter qu'une évolution n'arrive en ligne sans être documentée dans
« Nouveautés » (ce qui était arrivé pour le reporting par email), la
chaîne d'intégration **refuse désormais toute pull request qui n'ajoute pas
de nouvelle entrée de changelog**. Aucun changement visible côté application.

> **🔧 Notes techniques**
>
> - Nouveau job `changelog` dans `.github/workflows/ci.yml` (sur `pull_request`
>   uniquement) : échoue si l'entrée `## vX.Y.Z` en tête de
>   `CHANGELOG_PRODUIT.md` est déjà présente sur la base de la PR (donc aucune
>   nouvelle entrée ajoutée). Compare via `git show $BASE_SHA:…` + `grep -Fxq`,
>   `fetch-depth: 0` pour disposer de l'historique.
> - Matérialise la règle `CLAUDE.md` § « Pre-PR doc audit » (question 5),
>   jusqu'ici uniquement sur la confiance.

## v1.53.0 — 30/06/2026 à 19:52 — Reporting : suivi des reports et synthèse IA sur la fiche

La fiche d'une participation gagne une zone **« Reporting »** organisée en
onglets :

- **Documents** — l'espace d'upload manuel existant, inchangé.
- **Reports** — la liste des **reports reçus par email** (période, type, date,
  statut). Un clic sur une ligne ouvre le détail : titre, points clés,
  métriques et contenu brut du report.
- **Synthèse IA** — une lecture synthétique générée automatiquement :
  résumé exécutif, **note de santé** (avec points forts et points de
  vigilance), indicateurs clés avec tendance, et alertes. La carte indique
  clairement si l'analyse est en cours, en échec, ou en attente de données.

> **🔧 Notes techniques**
>
> - Onglets ajoutés sur `src/routes/app/$orgSlug/participations.$companyId.tsx`
>   (`Tabs` shadcn) : `ReportingsSection` (existant) + deux nouveaux composants
>   `src/components/companies/CompanyReportsSection.tsx` (tableau + dialog
>   détail) et `CompanyIntelligenceCard.tsx` (synthèse IA).
> - Lecture seule, scoping org via `requireOrgMember` : queries publiques
>   `convex/companyReports.ts` (`listByCompany`, `getById`) et
>   `convex/intelligence.ts:getByCompany`. La donnée est produite par le
>   pipeline d'ingestion (#143).
> - i18n EN + FR, namespace `participations` : `tabs`, `reports`,
>   `intelligence`.

## v1.52.0 — 30/06/2026 à 19:40 — Reporting : réception automatique des reports par email

Un email envoyé à l'**adresse de reporting dédiée** est désormais traité
automatiquement : Albo OS crée le report, le **rattache à la bonne société**,
stocke les pièces jointes, extrait les informations structurées, génère une
**synthèse IA** et répond une confirmation à l'expéditeur. Plus besoin de
saisir les reports investisseurs à la main.

> **🔧 Notes techniques**
>
> - Transport email via **AgentMail** (inbox dédiée + webhook `message.received`
>   signé Svix) : `convex/agentmail.ts` (wrapper REST `fetch`, vérif signature
>   Web Crypto) + route dans `convex/http.ts`.
> - Orchestrateur `convex/reportPipeline.ts` : dédup → extraction texte/liens →
>   résolution company/org cross-org → extraction structurée
>   (`convex/reportAnalysis.ts`, `generateObject` + Zod) → stockage
>   (`companyReports` + `documents`) → synthèse IA (`convex/intelligence.ts`,
>   agent dédié + tool `webSearch` Linkup) → reply de confirmation.
> - Schéma : tables `companyReports` et `companyIntelligence` ; `documents`
>   gagne `reportId` / `extractedText` / `inline`.
> - Env requis (Convex) : `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`,
>   `AGENTMAIL_WEBHOOK_SECRET`, `LINKUP_API_KEY`. OCR des PJ et suivi KPI
>   structuré différés.

## v1.51.2 — 30/06/2026 à 18:00 — Favicon Albo agrandi dans l'onglet

Le **« a » d'Albo** occupe désormais une plus grande part de l'icône :
la marge autour du logo a été réduite pour qu'il soit plus lisible dans
l'onglet du navigateur et sur l'écran d'accueil.

> **🔧 Notes techniques**
>
> - Régénération des assets `public/` (mêmes fichiers que v1.51.1) avec un
>   padding réduit autour du glyphe : `pad=12` sur 100 pour les favicons web
>   arrondis (zone utile 76 vs 48 auparavant), `pad=14` pour
>   `apple-touch-icon` / `android-chrome` (carrés pleins). Couleurs
>   inchangées (a `#0A0A0A` sur fond crème `#F4F3EF`).

## v1.51.1 — 30/06/2026 à 17:30 — Nouveau favicon Albo

L'onglet du navigateur affiche désormais le **« a » d'Albo** (le logo de
la marque, repris du site alboteam.com) à la place de l'icône générique du
template. Les icônes d'écran d'accueil (iOS / Android) et la tuile
d'application reprennent le même logo.

> **🔧 Notes techniques**
>
> - Favicon source récupéré sur `alboteam.com` (site Framer, lien
>   `rel="icon"`) : le mark « a » de la marque.
> - Régénération de tous les assets dans `public/` à partir du tracé SVG
>   officiel recoloré (a noir `#0A0A0A` sur fond crème `#F4F3EF`) :
>   `favicon.ico` (multi-tailles 16/32/48/64), `favicon.png`,
>   `favicon-16x16.png`, `favicon-32x32.png` (coins arrondis), plus
>   `apple-touch-icon.png` (180, carré plein), `android-chrome-192x192.png`
>   et `android-chrome-512x512.png`.
> - Aucun changement dans `src/routes/__root.tsx` : les balises `<link>`
>   pointaient déjà sur ces noms de fichiers. `logo.svg` / `logo-mark.svg`
>   (logos applicatifs) laissés inchangés.

## v1.51.0 — 30/06/2026 à 17:00 — Participations : actives en haut, soldées repliées en bas

La liste des participations est désormais scindée en **deux tableaux empilés** :

- en **haut**, les participations **actives** (et en sortie partielle) — le
  tableau habituel, inchangé ;
- en **bas**, une section **« Participations soldées (N) »**, **repliée par
  défaut** (un clic pour la déplier), qui regroupe les sorties totales et les
  pertes totales. Le compteur reste visible même repliée.

Le tableau des soldées reprend la même présentation (regroupement par société,
formatage) et ajoute une colonne **MOIC** ainsi que le **badge** gagnant /
perdant / « Sorti ». Une perte totale s'affiche toujours en perdant. S'il n'y a
aucune participation soldée, la section n'apparaît pas. La séparation s'applique
à la vue d'une organisation comme à la vue agrégée toutes organisations, et
l'export CSV continue de couvrir l'ensemble des deals (actifs + soldés).

> **🔧 Notes techniques**
>
> - Nouveau wrapper `ParticipationsView`
>   (`src/components/participations/ParticipationsView.tsx`) : scinde le `deals`
>   déjà chargé (un seul aller-retour) en actifs / soldés sur `status` et empile
>   deux `ParticipationsTable`. La section soldés réutilise le pattern
>   collapsible maison (`useState` + chevron) comme `ArchivedSection`.
> - `ParticipationsTable` gagne deux props : `settled` (ajoute la colonne MOIC +
>   `ExitBadge`, en-têtes non triables) et `exportDeals` (l'export reste branché
>   sur le jeu complet, en amont du split — comportement export inchangé).
> - MOIC du groupe **dérivé des sommes agrégées** déjà en scope (`paidActual` /
>   `received`) — les transactions brutes ne sont pas chargées. Dé-TVA royalty
>   appliquée **par deal** (`received / 1.2`, convention de `dealMoic`) pour ne
>   **jamais surévaluer** un groupe à instruments mixtes. `ExitBadge` réutilisé
>   tel quel via un deal synthétique (statut + instrument non-royalty) et des
>   transactions synthétiques portant les proceeds déjà nets de TVA.
> - Routes `app/$orgSlug/participations.index.tsx` et
>   `app/all/participations.tsx` consomment `ParticipationsView`. i18n :
>   `col.moic` + `settled.sectionTitle` (EN + FR).

## v1.50.0 — 30/06/2026 à 16:30 — Sortie d'un deal : badge gagnant/perdant et geste dédié

Sur la fiche d'une participation, un nouveau geste **« Marquer comme sorti »**
(menu en haut à droite) permet d'enregistrer la sortie d'un investissement :
type de sortie (totale, partielle ou perte totale), date de sortie et produit
de sortie. Le produit est pré-rempli avec le total des sommes déjà reçues, mais
reste librement modifiable. La sortie est **réversible** : un bouton
« Annuler la sortie » repasse le deal en actif et efface les informations de
sortie.

Une fois le deal sorti, un **badge** apparaît à côté du statut :

- **Exit gagnant** (vert) quand l'argent récupéré dépasse le capital investi,
- **Exit perdant** (rouge) quand il est inférieur,
- **Sorti** (neutre) quand le multiple n'est pas calculable (aucun flux), sans
  rien affirmer sur la performance.

Une participation explicitement **dépréciée** affiche toujours « Exit perdant ».

> **🔧 Notes techniques**
>
> - Nouveau `src/lib/dealMetrics.ts` : `dealMoic(deal, transactions)` →
>   `{ moic, isWin }`. Assiette = Σ flux entrants / Σ flux sortants, les deux
>   issus des transactions réelles (pas de `exitProceeds`). Dé-TVA ÷1.2 sur les
>   entrants **uniquement** si `instrumentKind === 'royalty'` ; le capital
>   (sortants) n'est jamais dé-TVA-é. `moic = null` si Σ sortants = 0.
> - `src/components/deals/ExitBadge.tsx` : badge à 3 états rendu seulement pour
>   `status ∈ {fully_exited, written_off}`. `written_off` force « perdant » ;
>   sinon `isWin` décide (`null` → « Sorti » neutre). RoyaltiesPanel n'est pas
>   touché (son CoC garde le scalaire `capitalInvested`).
> - `src/components/deals/ExitDealDialog.tsx` : dialog dédié (select statut,
>   date, produit pré-rempli depuis `received`), persiste via `deals.update`
>   existant. Bouton « Annuler la sortie » → `status: 'active'` + clear.
> - `convex/deals.ts` : ajout de `exitProceeds` à `dealFields` (absent
>   auparavant) ; dans `update`, `exitedDate`/`exitProceeds` acceptent un `null`
>   explicite qui efface le champ (Convex ne transmet pas `undefined` côté
>   client). Greffe UI dans `deals.$dealId.tsx` (badge + entrée de menu).

## v1.49.2 — 30/06/2026 à 10:51 — Royalties : correction d'affichage de la jauge

Sur la fiche d'un investissement à royalties, l'étiquette flottante des
**royalties perçues (réel)** est désormais correctement alignée aux extrémités
de la jauge : à 0 € reçu elle ne déborde plus à gauche, et au plafond elle ne
déborde plus à droite.

> **🔧 Notes techniques**
>
> - `src/components/deals/RoyaltiesPanel.tsx` : ancrage de l'étiquette flottante
>   du curseur rendu sensible aux bords. Extraction de `cursorPct =
barPct(realizedCumul)` (réutilisé par l'étiquette et le remplissage), puis
>   bascule de `-translate-x-1/2` vers `translate-x-0` (≤ 5 %) ou
>   `-translate-x-full` (≥ 95 %) pour éviter le clipping hors de la piste.

## v1.49.1 — 30/06/2026 à 12:00 — Royalties : date de début des royalties

Les paramètres d'un investissement à royalties accueillent un nouveau champ
optionnel **« Début des royalties »**. Purement informatif, il se saisit dans
la fenêtre d'édition (sélecteur de date) et s'affiche dans le bloc paramètres,
entre la date d'investissement et la date de fin. Laissé vide, il affiche
« — ». Il ne modifie **aucun calcul** (TRI, multiple, barre de progression
restent inchangés).

> **🔧 Notes techniques**
>
> - Nouveau champ `royaltyStartDate` (`v.optional(v.number())`, ms epoch)
>   ajouté sur le modèle exact de `investmentDate`/`endDate`, sur les cinq
>   points de la chaîne : groupe royalty de `convex/schema.ts`, `dealFields`
>   dans `convex/deals.ts` (patchable via `deals.update`), `ROYALTY_FIELDS`
>   dans `convex/lib/instrumentMapping.ts`, `FIELD_FORMAT` (`'date'`) dans
>   `InstrumentBlock.tsx`, et le tableau `params` de `RoyaltiesPanel.tsx`
>   (`fmtDate`). Clé i18n `field.royaltyStartDate` (EN/FR). Découvert
>   automatiquement par `EditDealDialog` (date picker via le format `date`).
> - Strictement informatif : absent de toute formule (TRI/CoC/barre). Pas de
>   migration, pas de donnée dérivée.

## v1.49.0 — 30/06/2026 à 11:45 — Royalties : barre plus lisible et distinction « rien saisi » / « zéro »

Sur la fiche d'un investissement à royalties, la **barre de progression** gagne
deux libellés discrets — **« Plancher »** et **« Plafond »** — placés au-dessus
de leurs montants respectifs, pour lire la jauge d'un coup d'œil. Le montant de
royalties perçues n'apparaît **plus qu'une seule fois**, sur l'étiquette posée
sur la barre (avec sa mention « (HT) ») : le doublon affiché en haut à droite du
bloc a été retiré.

Dans le **tableau de suivi trimestriel**, on distingue désormais clairement un
trimestre **sans relevé** d'un trimestre **à zéro** : une cellule réelle (ou
prévue) sans point affiche « — », tandis qu'un point réellement saisi à 0
affiche « 0 € ». À l'édition, **vider** une cellule **supprime** le point (la
cellule repasse à « — »), alors que saisir **« 0 »** conserve un point à zéro.

> **🔧 Notes techniques**
>
> - `src/components/deals/RoyaltiesPanel.tsx` — barre : libellés
>   `field.floorMultiple` / `field.capMultiple` empilés au-dessus des montants
>   de repère (spans `bottom-0 flex flex-col`, ancrés au trait, libellé qui
>   pousse vers le haut). Retrait du span cumul `realizedCumul` en haut à droite
>   du bloc réalisé ; ajout du `htTag` sur l'étiquette flottante de la barre
>   (seul affichage du cumul désormais).
> - `EditableCa` : ajout d'un callback `onDelete` et réécriture de `commit` en
>   trois cas — `draft.trim() === ''` → `onDelete` (suppression du point) ;
>   parse réussi (0 inclus) → `onSave` ; parse `null` sur saisie non vide
>   (« abc ») → no-op sans suppression. Branché sur les deux colonnes BP et réel
>   via `removeBpPoint` / `removeActual` (filter sans réinsertion, patch
>   `deals.update`). L'affichage `value == null ? '—' : fmtEur(value)` distingue
>   déjà point absent / point à 0 — seul le comportement d'édition changeait.

## v1.48.1 — 30/06/2026 à 10:30 — Royalties : TRI masqué tant que le capital n'est pas recouvré + barre plus lisible

Sur la fiche d'un investissement à royalties, le **TRI annualisé** ne s'affiche
plus tant que le capital investi n'a pas été recouvré (multiple récupéré
inférieur à 1×) : dans cette phase le taux est mathématiquement exact mais très
instable et trompeur, on affiche donc « **n/a — capital non recouvré** ». Le
TRI réapparaît automatiquement dès que le capital est recouvré.

La **barre de progression** gagne en lisibilité : un repère vertical **explicite
sur le plafond** (en plus du plancher), et un **code couleur à trois zones**
(avant le minimum garanti, entre le minimum et le plafond, plafond atteint). Le
montant de royalties perçues affiché est désormais suivi d'un discret « (HT) »
pour rappeler qu'il s'agit du montant hors taxes (l'écart avec le total TTC des
encaissements correspond à la TVA).

> **🔧 Notes techniques**
>
> - `RoyaltiesPanel.tsx` : le bloc TRI n'est plus gardé par `tri != null` mais
>   par le CoC — `coc < 1` → libellé `triNotRecovered` ; sinon la valeur signée
>   (`signTone`) ; `xirr()` à `null` → « — ». La sous-note `triRecovering` et ses
>   clés i18n (fr/en) sont retirées (devenues mortes).
> - Barre : nouveau drapeau `capReached` ; le remplissage passe à trois états
>   (`bg-primary` / `bg-positive` / `bg-chart-5`). Trait plafond ajouté en
>   **dehors** de la track `overflow-hidden` (sinon le coin `rounded-full` le
>   masque), aligné via `top-6`. Cumul réalisé suffixé de la clé `htTag`.
> - Le calcul `src/lib/xirr.ts` est **inchangé** (déjà un XIRR daté actual/365,
>   `r` annualisé) : seul l'affichage évolue. `KNOWN_ISSUES.md` et `TESTING.md`
>   (FD31, FD34) mis à jour en conséquence.

## v1.48.0 — 29/06/2026 à 22:30 — Royalties : performance réelle (CoC, TRI) et fiche réorganisée

Le suivi des royalties distingue désormais clairement la **projection** (le
tableau, basé sur le chiffre d'affaires saisi) du **réalisé** (ce qui a
vraiment été encaissé) :

- **Barre de progression repensée.** Elle se base maintenant sur le cash
  réellement reçu (transactions entrantes ramenées hors taxes), plus sur la
  projection du tableau. Deux zones colorées (sécurisation jusqu'au plancher,
  rendement au-delà), les repères **plancher** et **plafond** affichent montant
  et multiple alignés sous leur trait, et un message d'état indique ce qu'il
  reste à percevoir avant le minimum garanti ou le plafond.
- **Multiple récupéré (CoC).** Combien le capital a déjà rapporté, exprimé en
  multiple (ex. « 0,18x »), en regard du plancher et du plafond.
- **TRI annualisé.** Le taux de rendement interne, calculé sur le capital
  investi et les encaissements réels à leurs dates. Négatif tant que le capital
  n'est pas récupéré (mention « en cours de récupération »).
- **Fiche réorganisée.** Pour un deal royalty : paramètres → notes → indicateurs
  de réalisé → tableau de suivi.
- **Unités dans l'édition.** Les champs du formulaire d'édition affichent leur
  unité (€, %, ×) pour lever toute ambiguïté.

> **🔧 Notes techniques**
>
> - Séparation stricte projection / réalisé. La barre, le CoC et le TRI sont
>   calculés **uniquement** sur les transactions entrantes du deal
>   (`transactions.listByDeal`), dé-TVA-ées à 20 % (`amount / 1.2`) ; le tableau
>   reste sur `actualPoints`. Le capital (`capitalInvested`) n'est **jamais**
>   dé-TVA-é.
> - Helper XIRR : nouveau `src/lib/xirr.ts` (Newton-Raphson + repli bissection,
>   day-count actual/365), couvert par `tests/xirr.test.ts`. Flux du TRI : un
>   sortant `-capitalInvested` à `investmentDate` + chaque entrant `amount/1.2` à
>   sa `transactionDate`.
> - Threading : `CustomPanelProps` reçoit `transactions?` et `notesSlot?`
>   (`InstrumentBlock.tsx`) ; `deals.$dealId.tsx` passe `txs` et injecte
>   `NotesSection` dans le panneau pour les deals royalty (sinon rendue dessous).
> - Unités d'édition : map `FORMAT_UNIT` (`eur`→€, `pct`→%, `decimal`→×) dans
>   `InstrumentBlock.tsx` ; `DealFieldInput` (`deals.$dealId.tsx`) enveloppe
>   l'`Input` dans `InputGroup` + `InputGroupAddon align="inline-end"`.
> - Barre : positions via `barPct(amount)` sur l'échelle 0→`capAmount`, repères
>   en éléments absolus, message d'état selon `realizedCumul` vs
>   `floorAmount`/`capAmount`.

## v1.47.0 — 29/06/2026 à 21:30 — Suivi des royalties : édition, plancher/plafond et progression

Le panneau de suivi des royalties s'enrichit et corrige plusieurs points :

- **Montants collés mieux interprétés.** Un chiffre d'affaires avec décimales
  fines (ex. « 311 995,152 ») n'est plus lu comme une valeur géante : quand les
  milliers sont déjà séparés par un espace, la virgule est traitée comme une
  décimale. Plus de montants absurdes après un collage.
- **Cellules de CA modifiables.** Vous pouvez désormais corriger directement un
  chiffre d'affaires dans le tableau — aussi bien la colonne **BP initial** que
  la colonne **Réel** — en cliquant sur la cellule, sans repasser par l'import.
- **Lecture hiérarchisée.** Les colonnes sont mises en valeur selon leur
  importance : le **Réel** ressort, le **BP dégradé** (la référence de
  comparaison) est marqué, le **BP initial** reste discret.
- **Nouveaux paramètres.** Date d'investissement, **plancher** et **plafond**
  (saisis en multiple du capital, ex. « 1,25x », « 2x », avec le montant calculé
  affiché), et date de fin.
- **Barre de progression.** Le cumul des royalties perçues se positionne sur une
  échelle plancher → plafond, avec le pourcentage atteint ; la barre passe au
  vert dès que le plancher est franchi.

L'ancien bloc « Business plan vs réalisé » disparaît des fiches royalties (il est
remplacé par ce tableau) ; il reste disponible pour les autres instruments.

> **🔧 Notes techniques**
>
> - Parsing : `parseAmountToCents` (`src/lib/royalties.ts`) devient
>   _space-aware_ — `hadSpaceGroup = /\d\s\d/.test(raw)` ; une virgule seule
>   suivie de 3 chiffres n'est traitée comme séparateur de milliers que si aucun
>   espace n'a déjà groupé les milliers, sinon c'est une décimale. Régression
>   couverte dans `tests/royalties.test.ts` (cas « 311 995,152 » → 31199515).
> - Édition inline : composant local `EditableCa` dans `RoyaltiesPanel.tsx`
>   (clic → `Input` → Enter/blur → `parseAmountToCents`). Sauvegarde via le même
>   mécanisme de liste que `addActual` (dedup-replace + `deals.update` patch) :
>   `saveBpPoint` pour `bpPoints`, `addActual` réutilisé pour `actualPoints`.
> - Style : constantes `COL_BP_INITIAL` / `COL_BP_DEGRADED` / `COL_REAL`
>   (tokens `text-muted-foreground`, `bg-muted/40`, `font-medium`) appliquées en
>   en-tête, corps et pied.
> - Paramètres : champs `investmentDate`, `floorMultiple`, `capMultiple`,
>   `endDate` (optionnels) ajoutés à `convex/schema.ts`, `dealFields`
>   (`convex/deals.ts`), `ROYALTY_FIELDS` (`convex/lib/instrumentMapping.ts`) et
>   `FIELD_FORMAT` (`InstrumentBlock.tsx`, formats `date` / `decimal` existants).
>   Plancher/plafond stockés en multiple ; montant = `multiple × capitalInvested`
>   dérivé à l'affichage, rien de stocké.
> - Progression : `totals.actualRoyalty` (déjà calculé) comparé à `floorAmount` /
>   `capAmount` ; barre `div` stylée par tokens, repère plancher en marqueur.
> - `PlanVsActualSection` conditionné sur `instrumentKind !== 'royalty'` dans
>   `deals.$dealId.tsx` (modèle `FundSection`).

## v1.46.1 — 29/06/2026 à 20:30 — Correction : enregistrement d'une règle récurrente de trésorerie

Dans la trésorerie, lors de la création d'une **règle récurrente**, le bouton
**Enregistrer** restait grisé si le montant était saisi avec le symbole **€**
(ex. « 5 580 € »). Le montant est désormais correctement interprété même
lorsqu'il contient le symbole de l'euro : la règle s'enregistre normalement.

> **🔧 Notes techniques**
>
> - `parseEuros` (`src/components/cash/ForecastSection.tsx`) ne retirait que les
>   espaces et la virgule ; un `€` collé au montant donnait `Number("5580€") =
NaN`, donc `amountCents === null` → `invalid === true` → bouton désactivé.
> - Fix : la regex de nettoyage retire aussi le symbole `€` (`/[\s€]/g`).

## v1.46.0 — 29/06/2026 à 19:11 — Suivi des royalties trimestre par trimestre

Les deals en **royalties** (ex. La Vie de Quartier) ont désormais leur propre
panneau de suivi. Renseignez une fois les trois paramètres — capital investi,
taux de dépréciation, taux de royalties — puis **collez votre business plan**
depuis Excel ou Google Sheets (deux colonnes : trimestre, chiffre d'affaires
prévu). Un aperçu vous montre ce qui a été reconnu **avant** d'enregistrer.

Ensuite, **ajoutez le chiffre d'affaires réalisé** trimestre par trimestre :
c'est la seule donnée à saisir. Le tableau compare automatiquement, pour chaque
trimestre, le BP initial, le BP dégradé (BP moins la dépréciation) et le réel —
en chiffre d'affaires **et** en royalties — avec l'écart entre le réel et le BP
dégradé (en euros et en pourcentage, coloré en vert ou rouge) et les cumuls en
bas de tableau.

> **🔧 Notes techniques**
>
> - 2e panel custom après Lead SPV (PR #127), même pattern : `RoyaltiesPanel`
>   branché dans `CUSTOM_PANELS` (`src/components/deals/InstrumentBlock.tsx`),
>   props `CustomPanelProps`, édition des 3 scalaires via `EditDealDialog` +
>   `INSTRUMENT_FIELDS['royalty']` (`convex/lib/instrumentMapping.ts`).
> - Nouveauté vs Lead SPV : deux **listes** sur `deals`
>   (`bpPoints`/`actualPoints`, `v.array(v.object(...))` dans `schema.ts` et
>   `dealFields` de `convex/deals.ts`), mises à jour par patch partiel via
>   `deals.update` depuis le panneau (pas via `INSTRUMENT_FIELDS`).
> - Calculs (BP dégradé, royalties, écart, cumuls) dérivés à l'affichage,
>   rien de stocké : `buildRoyaltyRows` dans `src/lib/royalties.ts`. Parsing du
>   collage tabulé tolérant FR/US (`parseAmountToCents`) + normalisation des
>   trimestres en clé canonique `"Qn YYYY"` (`normalizeQuarter`, `parseBpPaste`),
>   couverts par `tests/royalties.test.ts`.
> - Nouveaux champs `capitalInvested` (cents) / `depreciationRate` (bps) +
>   formats dans `FIELD_FORMAT`. Champs optionnels → aucune migration sur les
>   4 deals royalty existants.

## v1.45.0 — 29/06/2026 à 18:05 — Liste des entreprises plus lisible

La liste des entreprises se lit plus vite. **Cliquez n'importe où sur une
ligne** pour ouvrir la fiche — le bouton « Ouvrir la fiche » répété sur chaque
ligne disparaît, et une discrète flèche apparaît à droite au survol. Les noms
de société s'alignent désormais proprement à gauche.

Les valeurs « neutres » s'effacent visuellement pour laisser ressortir
l'essentiel : un montant **reçu à 0 €** et un **TVPI à 1,00×** s'affichent en
gris clair. L'œil va d'abord aux lignes qui ont distribué quelque chose ou dont
le multiple s'écarte de 1.

> **🔧 Notes techniques**
>
> - `src/components/participations/ParticipationsTable.tsx` (`CompanyRows`) :
>   suppression du bouton/pilule `openDetail` ; la `TableRow` devient le seul
>   point de navigation (`onClick` existant + `tabIndex`/`role="link"`/
>   `onKeyDown` Enter pour le clavier, `aria-label` via la clé i18n
>   `rowOpenAria`). Colonne traînante ajoutée avec une flèche `ArrowRight`
>   en `opacity-0 group-hover/group-focus-visible:opacity-100` ; `colSpan` du
>   loader passé à 7/8.
> - Mise en muted des valeurs neutres via deux helpers locaux
>   `isNeutralAmount` (reçu `=== 0`) et `isNeutralTvpi` (arrondi à `1,00×`),
>   appliquant `text-muted-foreground` sur les cellules Reçu et TVPI. Token DS
>   existant réutilisé, aucune couleur en dur.
> - Périmètre strict liste entreprises ; le même rendu muted pourrait être
>   partagé plus tard avec la fiche deal / les cards KPI du dashboard (autre PR).

## v1.44.0 — 29/06/2026 à 17:44 — Nouveau moteur pour l'assistant IA

L'assistant IA d'Albo OS change de moteur : il tourne désormais sur le modèle
**DeepSeek V4 Pro**, via la passerelle OpenRouter. Au quotidien rien ne change
dans l'usage — même panneau, mêmes outils, mêmes garde-fous de confirmation
avant chaque écriture — mais les réponses s'appuient sur un modèle plus récent
et plus capable. Si vous demandez à l'assistant quel modèle il utilise, il
répond maintenant « DeepSeek V4 Pro ».

> **🔧 Notes techniques**
>
> - Swap de provider isolé dans `getModel()` (`convex/agent.ts`) : remplacement
>   de `@ai-sdk/mistral` par `@openrouter/ai-sdk-provider` (`createOpenRouter` →
>   `openrouter.chat(AGENT_MODEL)`). Le wrapper `fetch` qui injectait
>   `prompt_cache_key` (spécifique Mistral) est supprimé — DeepSeek cache le
>   préfixe automatiquement côté serveur.
> - Id du modèle : source unique `convex/lib/instructions.ts:AGENT_MODEL`
>   (ex-`MISTRAL_MODEL`), défaut `deepseek/deepseek-v4-pro`, override via la var
>   d'env Convex `OPENROUTER_MODEL`. Clé sous `OPENROUTER_API_KEY`.
> - Scripts (`setup.mjs`, `setup-prod.mjs`, `e2e-smoke.mjs`), `.env.example` et
>   docs (README, KNOWN_ISSUES, TESTING, CLAUDE) alignés sur les nouvelles vars.
>   Identité de l'agent dans le system prompt mise à jour.

## v1.43.0 — 26/06/2026 à 15:30 — Lead SPV (gestion)

Quand vous êtes **lead d'un SPV** (Hectarea, Eben Home), vous ne faites pas que
co-investir : vous **gérez**, et à ce titre vous percevez des **frais de gestion**
et du **carried**. Ce volet gestion a désormais son propre type de deal,
**Lead SPV (gestion)**, distinct du deal d'investissement « Equity via SPV ». Sur
une même société, les deux deals coexistent côte à côte : l'un suit votre invest,
l'autre vos revenus de gérant.

Le deal Lead SPV affiche un panneau dédié : les **paramètres** que vous renseignez
(montant levé, % de frais de gestion, hurdle, % de carried) et, en lecture seule,
le **perçu à date** — la somme des encaissements rattachés au deal. Niveau 1, donc
pas encore de projection ni de ventilation frais/carried : on suit ce qui est
réellement tombé.

> **🔧 Notes techniques**
>
> - Nouvel `instrumentKind` **`lead_spv`** (additif) dans
>   `convex/lib/instruments.ts` + liste du sélecteur dans
>   `src/routes/app/$orgSlug/deals.$dealId.tsx`.
> - Nouvel archétype **`management`** et `render: 'custom'` dans
>   `convex/lib/instrumentMapping.ts`. 4 colonnes `deals` neuves (`v.optional`) :
>   `amountRaised` (cents), `managementFeeRate` / `hurdleRate` / `carriedRate`
>   (bps) — schéma + validateur `patch` de `deals.update` + `FIELD_FORMAT`.
> - **Premier vrai panel custom** : registre `CUSTOM_PANELS`
>   (`instrumentKind → composant`) dans `InstrumentBlock.tsx`, branché sur
>   `render === 'custom'` (royalty reste sur son placeholder, faute d'entrée).
>   Nouveau `src/components/deals/LeadSpvPanel.tsx`. `InstrumentBlock` reçoit
>   `received` (somme des flux entrants, déjà calculée page) + `onEdit` (ouvre le
>   dialog d'édition existant). `lead_spv` est listé dans `INSTRUMENT_FIELDS` pour
>   que ce dialog édite ses 4 paramètres — le mode de rendu (custom) et les champs
>   éditables restent orthogonaux.
> - i18n EN/FR (`instrument.lead_spv`, 4 `field.*`, `archetype.management`,
>   `fiche.leadSpv.*`) ; badge `management` réutilise le token `positive`.

## v1.42.0 — 26/06/2026 à 12:30 — Equity via SPV

Les participations détenues **via un SPV** sont désormais reconnues pour ce
qu'elles sont : de l'**equity** sur la société cible, simplement détenue de façon
indirecte. Ce type d'instrument, jusqu'ici présenté comme « Titres SPV » dans la
catégorie des fonds, s'appelle maintenant **« Equity via SPV »** et apparaît dans
la catégorie **Capital**, comme une prise de participation classique.

Sa fiche affiche désormais : date et montant d'investissement, **nom du SPV**,
détention via le SPV, frais de structuration, puis valorisations pre-money et
post-money. La société cible reste rattachée au deal comme pour toute
participation. Les participations « via SPV » déjà saisies conservent toutes
leurs valeurs et s'affichent simplement avec ces champs.

> **🔧 Notes techniques**
>
> - Pas de nouveau `instrumentKind` : `spv_share` (12 deals réels en org `albo`)
>   est **reclassé** `funds_lp → equity` dans `INSTRUMENT_ARCHETYPE`
>   (`convex/lib/instrumentMapping.ts`), render `fields` inchangé. La valeur enum
>   et les données en base ne bougent pas — aucune migration.
> - Nouvelle config `SPV_FIELDS` : `closingDate`, `paidAmount`, `spvName`,
>   `spvOwnershipPct`, `structuringFees`, `preMoneyValuation`,
>   `postMoneyValuation`. `underlyingTarget` **retiré de l'affichage** (la cible
>   passe par `targetCompanyId`) mais conservé en base, en sommeil.
> - 1 seule colonne neuve : `spvName v.optional(v.string())` (`convex/schema.ts`
>   - `dealFields` dans `convex/deals.ts`, éditable) ; `FIELD_FORMAT: 'text'`
>     (`InstrumentBlock.tsx`). `spvOwnershipPct` / `structuringFees` réutilisés tels
>     quels. `viaSpvCompanyId` (référence entité) **non** utilisé : le SPV n'est pas
>     modélisé comme entité.
> - Libellé i18n EN/FR « Equity via SPV » (fiche `participations.json` + vue agent
>   `chat.json`) ; nouveau libellé `field.spvName`. Incohérence assumée et
>   documentée : equity direct → `ownershipPct`, equity via SPV →
>   `spvOwnershipPct` (unification = migration future, hors périmètre).

## v1.41.0 — 26/06/2026 à 11:30 — Fiches dédiées pour les BSA et les obligations convertibles

Les **BSA** et les **obligations convertibles (OC)** ont désormais leur propre
fiche, distincte du SAFE. Jusqu'ici ces trois instruments partageaient la même
liste de champs ; ils sont pourtant économiquement différents.

- Un **BSA** affiche maintenant ses champs propres : date d'attribution, nombre
  de BSA, prix d'acquisition, prix d'exercice, parité, date limite d'exercice,
  puis les titres obtenus et la détention résultante en cas d'exercice.
- Une **OC** affiche les siens : montant et date d'investissement, taux
  d'intérêt, date de maturité, ratio et discount de conversion, puis la
  valorisation à la conversion, les titres obtenus et la détention résultante.
- Le **SAFE** et le **BSA Air** restent ensemble, et le sélecteur de type
  d'instrument côté SAFE ne propose plus que **SAFE / BSA Air**.

Les participations BSA et OC déjà saisies conservent toutes leurs valeurs : elles
s'affichent simplement avec les champs adaptés à leur nature.

> **🔧 Notes techniques**
>
> - Séparation des configs d'archétype dans `convex/lib/instrumentMapping.ts` :
>   `bsa` pointe sur un nouveau `BSA_FIELDS`, `oc` + `convertible_note` sur un
>   nouveau `OC_FIELDS` ; tous deux retirés de `SAFE_FIELDS`. Archétype `equity`
>   et render `fields` inchangés pour les trois.
> - 8 colonnes neuves (toutes `v.optional`, en sommeil) dans `convex/schema.ts`
>   - `convex/deals.ts` `dealFields` : `grantDate`, `warrantsCount`,
>     `warrantPrice`, `strikePrice`, `warrantParity`, `exerciseDeadlineDate`
>     (BSA), `conversionRatio`, `conversionDiscount` (OC). L'OC réutilise
>     `interestRate` + `maturityDate` (bloc debt) et le trio post-conversion
>     `conversionValuation` / `sharesAcquired` / `ownershipPct`.
> - `SAFE_TYPES` garde `oc` (validateur, en sommeil) ; nouveau
>   `SAFE_TYPE_OPTIONS = ['safe','bsa_air']` alimente le select via
>   `ENUM_FIELD_VALUES.safeType`.
> - Front : `FIELD_FORMAT` (`InstrumentBlock.tsx`) étendu des 8 champs ; nouveau
>   format `decimal` (parité / ratio fractionnaires, parseur `decimalToNumber`
>   dans `src/lib/parse.ts`, input `step="any"`). Le BSA s'affiche à plat (pas
>   d'onglets pré/post, faute de marqueur `conversionValuation`) ; l'OC garde
>   les onglets. Libellés i18n EN/FR des 8 champs.

## v1.40.0 — 26/06/2026 à 09:57 — Saisir vos flux de trésorerie ponctuels

Le prévisionnel de trésorerie gagne une section **« Échéances ponctuelles »**,
juste sous les règles récurrentes dans l'onglet **Aperçu** de la page Cash.
Vous pouvez désormais **lister, créer, modifier et annuler** un flux unique —
appel de capital, distribution, impôt one-shot, cession — directement depuis
l'écran, sans passer par l'assistant. Les échéances sont triées par date, avec
montant signé (−/+), un niveau de **confiance** (confirmé / attendu / probable)
et un **statut** (à venir / réalisé / annulé). Annuler une échéance la retire
du solde projeté sans l'effacer : l'historique reste intact, et la **courbe se
met à jour immédiatement**.

> **🔧 Notes techniques**
>
> - Nouvelle query publique `convex/forecasts.ts` `listEntries({ orgId,
status? })` : `requireOrgMember`, index `by_org_and_date` (tri date
>   ascendant gratuit), filtre `ruleId == null` (seules les one-shot pures),
>   renvoie les Doc bruts. Calquée sur `agentToolsForecasts.listEntriesInternal`
>   mais sans filtre date ni limite (V1).
> - Front : `ForecastEntriesSection` + `EntryDialog` dans
>   `src/components/cash/ForecastSection.tsx`, montés sous `ForecastRulesSection`
>   dans `cash.index.tsx`. `EntryDialog` calqué sur `RuleDialog` (création →
>   `createManualEntry`, édition → `updateEntry`, annulation → `cancelEntry` via
>   Dialog de confirmation), sans champ fréquence/jour. Lignes `pending`
>   éditables/annulables ; `realized`/`cancelled` atténuées et figées. Aucun
>   appel à `expandRules` : la réactivité Convex rafraîchit table +
>   `getForecastBalance`.
> - i18n `cash:forecast.entries.*` (en/fr), réutilise `cash:forecast.rules.in/out`
>   et `common:actions.*`.
> - Limitation V1 assumée : une occurrence de règle passée en `overridden`
>   (faisable uniquement via l'agent IA aujourd'hui) n'apparaît ni dans cette
>   table (`ruleId == null`) ni dans la table des règles — seulement dans la
>   courbe. Cf. `KNOWN_ISSUES.md` « Cash flow forecast ».

## v1.39.1 — 26/06/2026 à 09:57 — Ménage d'outillage interne

Retrait de deux scripts de diagnostic temporaires qui avaient servi à
cartographier les entités orphelines avant leur réparation manuelle. Ils ont
fait leur travail et n'avaient plus de raison d'exister. Aucun changement
visible côté application.

> **🔧 Notes techniques**
>
> - Suppression de `convex/migrations/diagnoseAlboUmbrellas.ts` et
>   `convex/migrations/diagnoseDeadEntities.ts` — deux `internalQuery dryRun`
>   en lecture seule, invoqués manuellement via `convex run`, créés pour
>   l'enquête sur les entités orphelines (réparation des chapeaux Sezame /
>   Parallel sur `albo`, repérage des entités sans deal). Diagnostics
>   ponctuels, jamais référencés par le code (front, crons, tests) ni par un
>   export — d'où une suppression purement chirurgicale.
> - Une fois mergé, ces fonctions disparaissent de la prod au prochain build
>   Vercel (`build:vercel` → `convex deploy`) ; elles ne s'affichent plus dans
>   la liste `convex run`.

## v1.39.0 — 26/06/2026 à 09:46 — Retrouver les entités sans deal

Sur la page **Participations**, les entités qui n'ont **aucun deal** étaient
jusqu'ici invisibles, puisque la liste se construit à partir des deals. Pour les
retrouver (les compléter, les archiver ou les supprimer), il fallait passer par
des liens bruts — pas pratique. Désormais, **s'il existe au moins une entité sans
deal**, un petit lien discret apparaît en bas de la liste : « N entités sans
deal ». Un clic le **déroule sur place** (comme la section « Archivées ») et
liste chaque entité avec un accès direct à sa fiche. S'il n'y en a aucune, rien
ne s'affiche — la page reste propre. Les entités juridiques du groupe (SCI,
holdings…) n'apparaissent jamais dans cette liste.

> **🔧 Notes techniques**
>
> - Ajout 100 % front + lecture dans
>   `src/routes/app/$orgSlug/participations.index.tsx` : nouveau composant
>   `WithoutDealSection`, calqué sur `ArchivedSection` (toggle `useState`,
>   chevron, rendu `null` si liste vide).
> - Dérivation côté client : `companies.list({ kind: 'portfolio' })` (déjà
>   filtré non-archivé + exclut nativement les `group_*` via l'index
>   `by_org_kind`) croisé avec l'ensemble des IDs référencés par
>   `api.deals.list` (`targetCompanyId` / `investorCompanyId` /
>   `viaSpvCompanyId`). Matching **par `_id`**, jamais par nom. Aucune nouvelle
>   query, mutation, route ni schéma — `deals` est déjà chargé par la page.
> - Ouverture de la fiche via le même `<Link>` que les lignes existantes
>   (`/app/$orgSlug/participations/$companyId`). Libellés i18n
>   `participations:withoutDeal.sectionTitle_one/_other` (EN/FR).

## v1.38.0 — 25/06/2026 à 23:20 — Suppression définitive d'une entité

Depuis la fiche d'une entité, un nouveau bouton **Supprimer** permet de la
retirer **définitivement** — utile pour faire le ménage des coquilles vides
créées par erreur. C'est différent de l'**archivage** (qui masque l'entité mais
la garde et reste réversible) : ici, l'entité disparaît pour de bon, l'action
est **irréversible**. Deux garde-fous protègent des erreurs : on ne peut pas
supprimer une **entité juridique** du groupe (SCI, holding…), ni une entité
encore **reliée** à des deals, mouvements ou autres éléments — un message
l'explique alors et propose de tout détacher d'abord. En cas de doute,
l'archivage reste recommandé.

> **🔧 Notes techniques**
>
> - Nouvelle mutation `convex/companies.ts` `remove({ id })`, calquée sur
>   `deals.remove` : `requireOrgMember`, refus des `kind` `group_*`
>   (`ConvexError('cannot_delete_group_entity')`), réutilisation du helper
>   existant `listBlockingRefs` (refus `company_has_references` si une référence
>   subsiste), puis `ctx.db.delete`. Hard delete réel, distinct de `archive`
>   (soft delete `archivedAt`) — schéma et archivage inchangés.
> - `listBlockingRefs` est déjà exhaustif sur les 8 champs du schéma qui
>   pointent vers une `company` (deals target/investor/viaSpv, companyRelations
>   parent/child, kpiSnapshots, bankAccounts, documents). `equityPositions` /
>   `intercompanyLoans` référencent l'**org**, jamais une `company` : rien à y
>   vérifier (commenté dans le code).
> - UI dans `src/routes/app/$orgSlug/participations.$companyId.tsx` : item
>   destructif « Supprimer » dans le menu de la fiche + `Dialog` de
>   confirmation calqué sur l'archivage (bouton désactivé si `group_*` ou si
>   l'entité porte des deals, message contextuel ; `err.data` ConvexError mappé
>   en i18n). Succès → toast + redirection vers la liste.
> - i18n EN/FR : namespace `deleteCompany` dans `src/locales/{en,fr}/participations.json`.

## v1.37.0 — 25/06/2026 à 23:15 — Nouveautés : affichage par paliers

La page « Nouveautés » n'affiche plus tout l'historique d'un coup : seules les
**10 dernières** mises à jour sont visibles à l'ouverture, et un bouton « Voir
les nouveautés plus anciennes » en déroule 10 de plus à chaque clic. L'intro en
haut et le petit lexique en bas restent toujours là. La page reste légère et
rapide à mesure que l'historique s'allonge (une entrée par release), sans rien
perdre du contenu.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/changelog.tsx` : `parseChangelog()` (pur, exécuté
>   une fois au chargement du module) découpe l'import `?raw` en
>   `header` / `entries[]` / `footer`. Les entrées sont les sections `## …`
>   dont le titre porte le séparateur `—` (couvre `## vX.Y.Z — …` **et** les
>   4 entrées historiques `## Mois AAAA — …`) ; le premier titre sans `—`
>   (le « Petit lexique ») démarre le footer, toujours épinglé.
> - Rendu en deux blocs `ReactMarkdown` (entête + N entrées visibles, puis
>   footer) partageant le même `markdownComponents` extrait au niveau module ;
>   `visibleCount` (`useState`, pas de 10) borne le slice — le coût de rendu
>   suit le nombre d'entrées affichées, plus l'historique complet.
> - Libellé bouton i18n `nav:changelogPage.showOlder` (FR/EN, interpolation
>   `{{remaining}}` — pas `count` pour éviter la pluralisation i18next).

## v1.36.0 — 25/06/2026 à 23:14 — Filtres et tri sur la liste Entreprises

La page **Entreprises** gagne des filtres et de nouveaux tris pour retrouver
plus vite une participation :

- **Filtres** (multi-sélection, cumulables avec la recherche) : par **type
  d'instrument**, par **statut** et par **secteur**. Un filtre n'apparaît que
  s'il y a au moins deux valeurs à distinguer. Un bouton **« Réinitialiser »**
  efface tous les filtres actifs.
- **Tri par date d'investissement** : une nouvelle colonne **« Investi le »**
  affiche la date du premier investissement dans la société et permet de
  classer du plus récent au plus ancien (et inversement).
- **Tri par nombre de deals** : la colonne **Deals** est désormais cliquable
  pour trier les sociétés par nombre d'investissements.
- La colonne **« Engagé »** (montant engagé) a été **retirée** de la vue
  liste ; seul le **montant versé** y reste affiché. Le montant engagé reste
  visible sur la fiche de chaque deal et dans l'export CSV.

> **🔧 Notes techniques**
>
> - Tout est porté par `src/components/participations/ParticipationsTable.tsx`
>   (composant partagé par la vue par-org et la vue agrégée `/app/all`).
> - Nouveau composant interne `FacetFilter` (dropdown + `DropdownMenuCheckboxItem`,
>   menu maintenu ouvert via `onSelect preventDefault`). Trois facettes
>   (`instrument`, `status`, `sector`) dérivées du jeu de deals complet et
>   localisées ; rendues seulement si ≥ 2 valeurs distinctes.
> - Les filtres s'appliquent au **niveau deal** dans le `useMemo` `filtered`
>   (avant regroupement par société), composables avec la recherche. La
>   pagination se réinitialise via une `filterKey` ajoutée à la clé de reset.
> - `SortKey` : `committed` retiré, `invested` et `deals` ajoutés. Le groupe
>   société porte désormais `signedDate` (= **min** des dates de deals = date
>   d'entrée) à la place de `committed`. Colonnes `committed` retirées du
>   header et de `CompanyRows` ; colonne `invested` (via `fmtDate`) ajoutée.
> - L'export CSV et la `DealsList` de la fiche conservent le montant engagé
>   (`col.committed` toujours utilisée par l'export).
> - i18n : `participations.col.invested` + bloc `participations.filters.*`
>   (EN/FR).

## v1.35.0 — 25/06/2026 à 22:44 — Notes éditables depuis la fiche deal

Les **notes** d'un deal se modifient désormais directement depuis sa fiche,
sans passer par le dialog « Modifier » :

- La section **Notes** affiche un petit crayon ; un clic ouvre une zone de
  saisie multi-lignes avec **Enregistrer** / **Annuler**.
- La section reste **toujours visible**, même quand le deal n'a pas encore de
  note (« Aucune note pour le moment. »), ce qui permet d'en **ajouter** une.
- Vider entièrement le champ puis enregistrer **efface** la note.
- Une note saisie à la main est protégée d'un éventuel ré-import (comme les
  autres champs édités manuellement).

> **🔧 Notes techniques**
>
> - Nouveau composant `NotesSection` dans
>   `src/routes/app/$orgSlug/deals.$dealId.tsx` : édition inline (état local
>   `editing`/`value`/`pending`), `Textarea` shadcn, toggle crayon.
> - Sauvegarde via `api.deals.update` avec un **patch partiel** `{ notes }`
>   (la mutation acceptait déjà le champ et marque `notes` dans
>   `manuallyEditedFields`). Diff sur la valeur trimmée → no-op si inchangé,
>   chaîne vide → note effacée (l'affichage retombe sur l'état vide).
> - Bloc lecture-seule précédent remplacé ; clés i18n
>   `participations:notes.empty` / `notes.placeholder` (EN/FR).

## v1.34.0 — 25/06/2026 à 23:10 — Avertissements de suppression rangés dans la confirmation

Les avertissements qui empêchent d'archiver une entité ou de supprimer un deal
ne s'affichent plus en permanence sur la fiche. Désormais, l'action reste
accessible dans le menu : c'est en cliquant sur **Archiver** (fiche entité) ou
**Supprimer** (fiche deal) que la fenêtre de confirmation explique, le cas
échéant, pourquoi l'opération est bloquée — « Cette entité porte N deal(s)… »
ou « Ce deal a N mouvement(s) rapproché(s)… » — et désactive le bouton de
validation tant que le blocage subsiste. La fiche reste ainsi dégagée tant
qu'on ne cherche pas réellement à supprimer.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/participations.$companyId.tsx` et
>   `src/routes/app/$orgSlug/deals.$dealId.tsx` : suppression du bandeau inline
>   `archive.blocked` / `deleteDeal.blocked` rendu en haut de page.
> - L'entrée de menu destructive (`Archiver` / `Supprimer`) n'est plus
>   `disabled` quand `dealCount > 0` / `linkedCount > 0` : le dialog s'ouvre.
> - Le message bloquant est déplacé dans le `DialogContent` (ternaire vs
>   `confirmBody`) et le bouton de validation porte désormais
>   `disabled={…|| dealCount > 0}` / `disabled={…|| linkedCount > 0}`. Garde
>   serveur (`company_has_references`, `deal_has_transactions`) inchangée.
> - `TESTING.md` : lignes AR1 et DD2 mises à jour.

## v1.33.1 — 25/06/2026 à 22:32 — Diagnostic : entités portfolio sans deal (lecture seule)

Nouveau diagnostic interne, en lecture seule, qui mesure sur les deux véhicules
(Albo et Calte) les entités du portefeuille qu'aucun investissement ne référence
— les candidates potentielles à un futur ménage. Il liste, pour chacune, son
identité (SIREN, forme juridique, date de création…) et sa provenance, signale
les doublons de noms exacts et les copies portant le nom d'une entité juridique
protégée. Aucun changement visible, aucune donnée modifiée.

> **🔧 Notes techniques**
>
> - `convex/migrations/diagnoseDeadEntities.ts` : nouvel `internalQuery dryRun`
>   (lecture seule, modèle `diagnoseAlboUmbrellas`). Pour chaque org (`albo`,
>   `calte`) : résumé chiffré (total entités archivées comprises, `group_*`
>   protégées, portfolio sans deal, archivées), liste détaillée des entités
>   portfolio sans deal (identité + `identityFilled` + provenance `airtableId`/
>   `attioCompanyId` + flag heuristique `isLikelyShell`), et rapport de doublons
>   (groupes de noms exacts avec présence de deals par ID, portfolio dont le nom
>   matche un `group_*`).
> - Matching deal → entité strictement **par ID** (`targetCompanyId`,
>   `investorCompanyId`, `viaSpvCompanyId`) pour ne pas être trompé par les
>   doublons de noms. Les `group_*` ne sont jamais candidates, listées à part.
> - `pnpm exec convex run --prod migrations/diagnoseDeadEntities:dryRun`.

---

## v1.33.0 — 25/06/2026 à 11:38 — Secteur éditable depuis la fiche entité

Le **secteur** d'une entité du portefeuille se modifie désormais directement
depuis l'application :

- Dans le dialog **« Modifier la société »**, un nouveau champ **« Secteur »**
  propose un sélecteur recherchable avec une liste de secteurs courants (SaaS,
  Fintech, Santé, Climat, Immobilier, Fonds, Crypto…).
- Vous pouvez **choisir un secteur de la liste** ou **saisir votre propre
  valeur** si aucune ne convient (« Créer … »).
- Pour retirer le secteur, rouvrez le sélecteur et recliquez sur le secteur
  déjà sélectionné.
- Le secteur reste visible dans le bloc Identité de la fiche et la recherche
  des participations le prend en compte (libellé traduit ou valeur libre).

> **🔧 Notes techniques**
>
> - Liste canonique des secteurs dans `src/lib/sectors.ts` (`SECTOR_SLUGS`,
>   slugs stables) ; libellés via i18n `participations:sectors.<slug>` (EN/FR).
> - Nouveau composant `src/components/companies/SectorCombobox.tsx` : combobox
>   créatif (Popover + `Command` cmdk) calqué sur `TargetCombobox`. Un secteur
>   prédéfini est stocké comme **slug**, une saisie libre **verbatim** — le
>   champ `companies.sector` reste `v.optional(v.string())`, donc **aucune
>   migration**. Toggle pour vider (reclic sur le secteur actif → `''`).
> - Câblage dans `EditCompanyDialog` (`participations.$companyId.tsx`) : état
>   `sector`, champ après le domaine, `sector` ajouté au `patch` de
>   `companies.update` (qui l'acceptait déjà). Affichage fiche via
>   `t('sectors.<v>', { defaultValue: v })` (fallback valeur brute).
> - Recherche `ParticipationsTable` enrichie : slug brut **+** libellé traduit
>   ajoutés au haystack (même pattern que l'instrument).

## v1.32.0 — 25/06/2026 à 10:40 — Actions des pages regroupées dans un menu

Les actions de modification de chaque page sont désormais regroupées derrière
un unique bouton menu (icône « … ») aligné à droite du titre, au lieu d'occuper
l'en-tête sous forme de boutons bien visibles :

- **Entreprises** : « Nouvelle entité » et « Exporter CSV » passent dans le menu.
- **Fiche d'une entité** : « Modifier », « Nouveau deal » et « Archiver »
  passent dans le menu (Archiver en rouge).
- **Fiche d'un deal** : « Modifier » et « Supprimer » passent dans le menu
  (Supprimer en rouge).

Les listes et les fiches restent ainsi au premier plan, l'écran est plus épuré.

> **🔧 Notes techniques**
>
> - Nouveau libellé i18n `common:actions.menu` (nom accessible du déclencheur).
> - `ParticipationsTable` accepte une prop `exportRef` : quand elle est fournie,
>   le bouton CSV de la barre d'outils est masqué et `handleExport` est exposé
>   via la ref, pour que le menu d'en-tête déclenche l'export en conservant le
>   filtre de recherche/tri. La vue cross-org `/app/all` n'a pas de menu et garde
>   son bouton d'export dans la barre d'outils.
> - `participations.index.tsx`, `participations.$companyId.tsx` et
>   `deals.$dealId.tsx` : les boutons d'en-tête sont remplacés par un
>   `DropdownMenu` (déclencheur `Button variant="outline" size="icon-sm"` +
>   `MoreHorizontal`, `align="end"`). Items destructifs (`Archiver`, `Supprimer`)
>   en `variant="destructive"`, désactivés quand une référence bloque l'action
>   (deals rattachés / transactions liées).

## v1.31.0 — 25/06/2026 à 11:01 — Fiche entreprise : focus identité + reporting

La fiche d'une entreprise est allégée et recentrée sur l'essentiel :

- Le bloc « Identité » affiche désormais la **détention globale (%)** et le
  **nombre d'actions consolidé** (cumul des titres acquis sur tous les deals
  de la société).
- La section « Reportings & documents » s'appelle simplement **« Reporting »**
  (l'ajout de documents reste inchangé).
- La section **« KPIs » est retirée** de la fiche.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/participations.$companyId.tsx` : extraction d'un
>   mémo `heldShares` (Σ `sharesAcquired` des deals) réutilisé par le calcul
>   `ownership` et par le nouveau `sharesConsolidated`. Deux `IdentityField`
>   dans le bloc identité — `info.ownershipGlobal` (ex-`info.ownership`,
>   conservé pour l'en-tête) et `info.sharesConsolidated`.
> - Le rendu `<KpisSection>` et son import sont retirés de la fiche, mais le
>   composant `src/components/companies/KpisSection.tsx` et le bloc i18n
>   `participations:kpis` (fr/en) sont **conservés** (non câblés) pour un
>   éventuel ré-affichage. Le backend KPIs (`convex/kpis.ts`, outil agent
>   `createKpiSnapshot`) reste intact — seul l'affichage front est retiré.
> - i18n : `reportings.title` → « Reporting » (fr/en), ajout de
>   `info.ownershipGlobal` / `info.sharesConsolidated` (fr/en).

## v1.30.0 — 25/06/2026 à 10:31 — Fiche deal : entité liée entièrement cliquable

Sur la fiche d'un deal, le bloc « Entité liée » est désormais cliquable sur
toute sa surface (et plus seulement sur la flèche au bout de la ligne) pour
ouvrir la fiche de l'entité investie.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/deals.$dealId.tsx`, section « Entité liée » :
>   la ligne enveloppe désormais tout le `CardContent` dans un seul `Link`
>   (classe `group block`) vers `/app/$orgSlug/participations/$companyId`,
>   au lieu de deux liens distincts (nom + flèche) qui auraient été imbriqués.
>   Le nom redevient un `span` avec `group-hover:underline` et la flèche
>   `ArrowRight` réagit au survol via `group-hover`. La branche sans
>   `deal.target` reste un `CardContent` non cliquable.

## v1.29.1 — 25/06/2026 à 10:08 — Fiche entreprise : nom et instrument du deal séparés

Sur la fiche d'une entreprise, la ligne d'un deal affichait son nom personnalisé
collé à son type d'instrument (par ex. « Sezame immo 6 · Titres SPV »).
Désormais deux champs distincts : un champ **Nom** (le nom personnalisé du deal,
« — » s'il n'y en a pas) et un champ **Instrument** (le type seul). L'en-tête de
la fiche du deal, qui n'affichait déjà que le nom, est inchangé.

> **🔧 Notes techniques**
>
> - `src/components/participations/ParticipationsTable.tsx` (`DealsList`) :
>   le champ unique `deal.instrument` rendait `dealTitle(dl)` (nom + instrument
>   combinés). Scindé en deux `Field` : `deal.name` (`dl.name ?? '—'`) et
>   `deal.instrument` (libellé d'instrument seul via `t('instrument.<kind>')`).
>   `useDealTitle` (titre combiné) reste utilisé tel quel par les comboboxes de
>   pointage et le fil d'Ariane — non touché.
> - Nouvelle clé i18n `deal.name` (`Nom` / `Name`) dans
>   `src/locales/{fr,en}/participations.json`.

## v1.29.0 — 25/06/2026 à 10:00 — Domaine de société éditable depuis la fiche

Le domaine d'une société se modifie maintenant directement depuis la fiche, via
le bouton « Modifier » (à côté du nom et du SIREN). C'est ce domaine qui
alimente le logo affiché en en-tête de fiche et dans les listes : renseignez
par exemple `stripe.com` et le logo apparaît automatiquement ; videz le champ
et l'icône de secours reprend sa place.

> **🔧 Notes techniques**
>
> - `companies.update` acceptait déjà `domain` ; ajout d'une normalisation
>   serveur (`convex/companies.ts`) : domaine `trim()`, chaîne vide → champ
>   effacé (`undefined`), calquée sur le traitement du SIREN.
> - `EditCompanyDialog` (`src/routes/app/$orgSlug/participations.$companyId.tsx`) :
>   nouvel état `domain` + champ de saisie sous le SIREN, envoyé dans le `patch`.
> - i18n : clés `edit.domainLabel` / `edit.domainPlaceholder` (en + fr),
>   `edit.companyDescription` mise à jour.
> - Aucun stockage de logo (cf. `KNOWN_ISSUES.md` « Logos d'entreprises ») :
>   le domaine continue d'être hotlinké à la volée par `CompanyLogo`.

## v1.28.3 — 24/06/2026 à 22:10 — Diagnostic : détail d'identité des entités cibles (lecture seule)

Complément au diagnostic interne : un relevé en lecture seule du détail complet
(nom, SIREN, forme juridique, date de création…) des entités cibles, pour
distinguer une entité renseignée d'une coquille créée par migration. Aucun
changement visible, aucune donnée modifiée.

> **🔧 Notes techniques**
>
> - `convex/migrations/diagnoseAlboUmbrellas.ts` : nouvel `internalQuery
entityDetails` (lecture seule). Pour chaque umbrella albo + ses entités
>   cibles candidates, renvoie le doc complet via `entityView` (tous les champs
>   d'identité + `_creationTime` + `archivedAt`) avec un bloc `identityFilled`
>   indiquant quels champs sont réellement remplis (coquille vs entité complète).
>   `pnpm exec convex run --prod migrations/diagnoseAlboUmbrellas:entityDetails`.

---

## v1.28.2 — 24/06/2026 à 21:55 — Diagnostic interne des entités chapeau (lecture seule)

Ajout d'un diagnostic interne, en lecture seule, pour mesurer les entités
« chapeau » à nettoyer (deals encore rattachés à « Sezame » / « Parallel
Invest » archivées, et homonymes côté Calte). Aucun changement visible dans
l'application, aucune donnée modifiée.

> **🔧 Notes techniques**
>
> - `convex/migrations/diagnoseAlboUmbrellas.ts` : `internalQuery dryRun`
>   (les queries Convex ne peuvent pas écrire → `convex run --prod … :dryRun`
>   ne mute rien). Pour chaque umbrella albo (ancrée par `attioCompanyId`) :
>   statut archivé, deals encore rattachés (`by_org_target`) avec
>   `name`/`notes`/`attioDealId`/montant/tx pour le mapping manuel, entités
>   cibles candidates (existence + archivé), refs bloquantes (mirror de
>   `companies.listBlockingRefs`) et `archivableOnceDealsReassigned`.
> - Calte : doublons de nom normalisé (casse/accents/espaces) + collisions de
>   préfixe (`SEZAME` vs `SEZAME IMMO 1`). Liste seule, aucun plan d'action.

---

## v1.28.1 — 24/06/2026 à 21:50 — Procédure interne en cas de dérive des skills

Ajout d'une consigne interne pour l'assistant : pas d'impact visible dans
l'application.

> **🔧 Notes techniques**
>
> - `CLAUDE.md` § « Skills (READ BEFORE CODING) » : nouvelle procédure à suivre
>   quand le job CI `skills-drift` est rouge avant un merge — expliquer
>   l'erreur (`pnpm run sync:skills:check`), récupérer la maj sur une branche
>   dédiée (`pnpm run sync:skills:update`), expliquer le `git diff`
>   (`.agents/skills/*/SKILL.md` + `skills-lock.json`) et demander l'accord
>   avant de merger, au lieu de contourner ou `--update` à l'aveugle.

## v1.28.0 — 24/06/2026 à 20:30 — Transactions : voir le deal rattaché en un coup d'œil

Dans la Trésorerie, une transaction déjà pointée montrait son statut (« Pointé »)
sans dire **à quoi** elle était rattachée. C'est corrigé.

- Sous le statut, chaque transaction pointée affiche désormais **le deal**
  rattaché (ou l'entité de passif — capital, compte courant), en **lien
  cliquable** : un clic ouvre la fiche du deal (ou la page Passif).
- Même lien dans le détail d'une transaction (volet latéral) et dans la colonne
  « Deal » de la fiche d'un compte.

> **🔧 Notes techniques**
>
> - Résolution **100 % front**, sans nouveau read serveur : `listLedger` renvoie
>   déjà `allocation = { kind, targetId }`, et `PointageTable` charge déjà
>   `deals` (`deals.listOptions`) + `liabilityOptions` pour ses comboboxes. On en
>   dérive deux maps (`dealsById`, `liabilityByTarget`) pour le libellé.
> - Nouveau composant `MatchLink` (`src/components/pointage/PointageTable.tsx`) :
>   deal → `/app/$orgSlug/deals/$dealId`, equity/loan → `/app/$orgSlug/passif`
>   (pas de fiche par-entité). `stopPropagation` pour ne pas ouvrir le sheet au
>   clic. `orgSlug` threadé via `TransactionsLedger` ← `cash.index.tsx` ; absent
>   = texte brut (vue agrégée).
> - Rendu sous le badge dans la cellule **Statut** ; ligne « Rattaché à » ajoutée
>   au `TransactionSheet` (prop `match`, clé i18n `pointage:detail.matchedTo`).
> - Fiche compte (`cash.$accountId.tsx`) : colonne « Deal » rendue cliquable
>   (le serveur renvoyait déjà `tx.deal`). Reste deal-only par design.

## v1.27.2 — 24/06/2026 à 20:20 — Nom de la société dans le fil d'Ariane

Sur la fiche d'une entreprise, le dernier élément du fil d'Ariane (en haut de
page) affiche désormais le **nom de la société** au lieu de son identifiant
technique. Le fil se lit « Organisation › Entreprises › ‹Nom de la société› ».
Aucun identifiant brut n'apparaît plus, y compris pendant le chargement ou si
la page pointe vers une société introuvable (le fil s'arrête alors à
« Entreprises »).

> **🔧 Notes techniques**
>
> - Défaut d'affichage pur, front only. `buildCompanyCrumbs` ajouté dans
>   `src/components/app-shell/AppHeader.tsx`, calqué sur `buildDealCrumbs`
>   (déjà en place pour la route deal).
> - La company est lue via la query existante `api.companies.getById`
>   (réutilisée, pas de nouvelle query) au pattern **non-throwing**
>   `useQuery(convexQuery(...))` + `enabled: companyId != null` : un
>   `companyId` invalide dégrade le breadcrumb au lieu de jeter vers
>   l'`errorComponent` parent et de casser le header. Leaf = `company.name`
>   (aligné sur le H1), non cliquable.
> - Libellé « Entreprises » inchangé (clé i18n existante
>   `nav:appShell.breadcrumb.participations`). Route deal et autres routes
>   strictement inchangées.

---

## v1.27.1 — 24/06/2026 à 20:15 — Mise à jour d'une skill agent (interne)

Mise à jour interne d'une fiche de bonnes pratiques destinée aux assistants
IA qui travaillent sur le projet. Aucun impact sur l'application ni sur vos
données.

> **🔧 Notes techniques**
>
> - `skills/convex-performance-audit` re-vendorisée au tip upstream courant
>   (`get-convex/agent-skills@main`, `pinnedRef` `7a6fcc6` → `ec1e6ba`) — le
>   seul skill ayant dérivé. Changement de contenu purement cosmétique (un
>   renvoi « `skills/convex-migration-helper/SKILL.md` » devient « le skill
>   `convex-migration-helper` ») ; aucune guidance comportementale modifiée,
>   donc aucun override projet à ajuster. `pnpm run sync:skills:check` repasse
>   au vert.
> - Bump fait à la main (résolution du tip via un appel unauth à
>   `api.github.com`, puis `pnpm run sync:skills`) car `sync:skills:update`
>   échoue dans le sandbox cloud — nouvelle section `KNOWN_ISSUES.md`
>   « `sync:skills:update` échoue dans le sandbox cloud ».

---

## v1.27.0 — 24/06/2026 à 20:10 — Réaffecter un deal & archiver une entité

Deux nouveautés pour ranger le portefeuille quand un deal a été créé sous la
mauvaise société :

- **Réaffecter un deal** : depuis la page d'un deal, **Modifier** propose
  désormais un sélecteur d'**entité cible**. On déplace le deal vers la bonne
  entreprise du portefeuille ; ses transactions rapprochées et ses valorisations
  **suivent** automatiquement (le rapprochement reste intact).
- **Archiver / restaurer une entité** : une entreprise du portefeuille peut être
  **archivée** (masquée des listes, de façon réversible) depuis sa fiche. Par
  sécurité, l'archivage est **refusé** tant que l'entité est encore reliée à
  des deals, des relations, des KPI, des comptes bancaires ou des documents —
  un message indique alors quoi traiter d'abord. Les entités archivées se
  retrouvent (et se **restaurent**) via une section dédiée en bas de la liste
  des entreprises.

> **🔧 Notes techniques**
>
> - **Réaffectation** : aucune mutation créée — `deals.update`
>   (`convex/deals.ts`) accepte déjà `targetCompanyId` dans le `patch` avec le
>   garde-fou same-org (`assertSameOrg` / `target_wrong_org`). Front : nouveau
>   combobox local `CompanyCombobox` (Popover + Command, calqué sur
>   `DealCombobox`) dans `EditDealDialog` (`deals.$dealId.tsx`), alimenté par
>   `companies.list { kind: 'portfolio' }` (déjà filtré non-archivé) ; ajout de
>   `targetCompanyId` au patch diff de la nouvelle structure d'édition.
> - **Archivage** : `companies.archive` / `companies.restore` /
>   `companies.listArchived` (`convex/companies.ts`). `archive` pose
>   `archivedAt = Date.now()` après le garde-fou `listBlockingRefs` (deals
>   target + investisseur + viaSpv, `companyRelations` parent/enfant,
>   `kpiSnapshots`, `bankAccounts`, `documents`) → `ConvexError('company_has_references')`.
>   `restore` efface `archivedAt` (`patch` avec `undefined`). Les deux sont
>   idempotents. Pas de hard delete.
> - Front : bouton **Archiver** + dialog de confirmation sur
>   `participations.$companyId.tsx` (calqué sur la suppression de deal,
>   désactivé si des deals visibles ciblent l'entité) ; section repliable
>   `ArchivedSection` + **Restaurer** sur `participations.index.tsx`.
> - i18n EN/FR : bloc `archive.*` + clés `edit.target*` du namespace
>   `participations`.

---

## v1.26.0 — 24/06/2026 à 19:30 — Fil d'Ariane de la fiche deal

Sur la **fiche d'un deal**, le fil d'Ariane en haut de page indique désormais
le chemin complet et lisible : **Organisation › Entreprises › ‹société› ›
‹deal›**. « Entreprises » et le nom de la société sont cliquables (retour à la
liste ou à la fiche société), et le dernier élément reprend le nom du deal.
Fini l'identifiant technique illisible et le maillon « Deals » mort qui
s'affichaient auparavant. Un deal sans société rattachée affiche simplement
**Organisation › Entreprises › ‹deal›**.

> **🔧 Notes techniques**
>
> - `src/components/app-shell/AppHeader.tsx` : nouveau `buildDealCrumbs`
>   dédié à la route `/app/$orgSlug/deals/$dealId` (le `buildCrumbs` générique
>   produisait un crumb « Deals » avec `href` vers une route inexistante + l'id
>   Convex brut en feuille). Le libellé entreprise **réutilise** la clé i18n
>   existante `nav:appShell.breadcrumb.participations` (aucune nouvelle clé) ;
>   la feuille reprend `useDealTitle({ withInstrument: false })`.
> - `dealId` lu via `useParams({ strict: false })` ; deal chargé via
>   `useQuery(convexQuery(api.deals.getById, …))` (et non `useConvexQuery`) :
>   ce pattern **ne jette pas** sur erreur, donc un `dealId` invalide ne casse
>   pas le header partagé via la boundary de la route parente. Query `enabled`
>   uniquement sur la route deal.
> - États dégradés sûrs : pendant le chargement / not-found (`deal` undefined),
>   le fil s'arrête à « Entreprises » ; `target` null → crumb société omis.
>   **Jamais** d'id brut ni de lien cassé, dans aucun état.
> - `TESTING.md` : nouvelle vérif SH14 (breadcrumb fiche deal, EN/FR + états
>   dégradés). Hors scope (follow-up) : l'id brut en feuille de la fiche
>   société `/participations/$companyId`.

## v1.25.0 — 24/06/2026 à 18:55 — « Participations » devient « Entreprises »

Le terme **« Participations »** est renommé **« Entreprises »** (et
**« Companies »** en anglais) partout dans l'interface : l'entrée du menu
latéral, le fil d'Ariane, l'indicateur du tableau de bord, le titre de la
page liste et celui de la fiche société. Rien d'autre ne change — les pages,
les adresses et vos données restent identiques.

> **🔧 Notes techniques**
>
> - Renommage **cosmétique** limité aux valeurs de strings i18n (EN →
>   « Companies », FR → « Entreprises ») : `src/locales/{en,fr}/nav.json`
>   (`appShell.breadcrumb.participations`, `items.participations`),
>   `dashboard.json` (`kpi.participations`, `kpi.deployedHint_one/other`),
>   `participations.json` (`metaTitle`, `metaTitleAll`, `metaTitleDetail` en
>   FR, `title`, `back` en FR, `empty`, `search.noResults`). Les libellés EN
>   `metaTitleDetail`/`back` étaient déjà migrés (« Investment » / « ←
>   Investments »), non touchés.
> - Aucune clé JSON, route, namespace i18n, composant ni code Convex modifié :
>   le namespace `participations`, les chemins `/participations*` et la table
>   restent inchangés ; `{{count}}` et les suffixes de phrases préservés.
> - `TESTING.md` : libellés rafraîchis dans la section App shell (SH1/SH4/SH5)
>   - nouvelle vérif SH13 (nav/breadcrumb/KPI/liste/fiche, EN et FR).

## v1.24.0 — 24/06/2026 à 18:14 — Participations : clic sur une ligne ouvre la fiche

Dans les **Participations**, cliquer **n'importe où sur une ligne** ouvre
désormais directement la **fiche de la société** — où ses deals sont listés.
Le dépliage de la ligne (chevron) qui affichait les deals sous la table est
retiré : un clic vous emmène droit à la fiche, et le bouton « Ouvrir la fiche »
reste disponible. La recherche, le tri, la pagination et l'export CSV ne
changent pas.

> **🔧 Notes techniques**
>
> - Front pur, dans `src/components/participations/ParticipationsTable.tsx` :
>   retrait de l'état d'expansion (`expanded`/`toggle`), du chevron et de la
>   ligne `DealsList` inline ; `CompanyRows` n'a plus les props
>   `isOpen`/`onToggle`/`colSpan`.
> - Le clic ligne câble `useNavigate` vers
>   `/app/$orgSlug/participations/$companyId`, gardé par `slug` (la vue agrégée
>   `/app/all` dérive l'org de chaque deal ; sans slug la ligne n'est pas
>   cliquable). Le bouton « Ouvrir la fiche » et son `stopPropagation` sont
>   conservés ; les deals restent atteignables via la fiche entité (qui liste
>   déjà `DealsList`).

## v1.23.0 — 24/06/2026 à 17:11 — Participations : retour à une liste simple

Les **Participations** reviennent à une présentation simple : **une ligne par
société**, dépliable vers ses deals. Le regroupement de plusieurs sociétés sous
un même « groupe » (badges _groupe_/_sponsor_, bouton « Voir le groupe » et page
de consolidation dédiée) est **retiré** — il ajoutait de la complexité sans usage
réel. Le tri, la recherche, la pagination et l'export CSV restent identiques. Côté
société, le champ **« Groupe »** disparaît des fenêtres de création et de
modification ; tout le reste (nom, SIREN, personnes, deals) est intact.

> **🔧 Notes techniques**
>
> - Étape A (code uniquement) : on retire le code qui lit/écrit/affiche le
>   regroupement, **le schéma reste inchangé** — `companies.group`, `companies.sponsor`,
>   la table `portfolioGroupSettings` et leurs index restent déclarés, inertes (le
>   nettoyage données + schéma sera une Étape B dédiée, avec snapshot).
> - Front : suppression de la route `participations.group.$slug.tsx` ; reducer de
>   `ParticipationsTable.tsx` reclassé par société (forme pré‑#83), retrait des
>   badges groupe/sponsor et du bouton « Voir le groupe », retrait de `showEntity` ;
>   retrait du champ Groupe + select de type dans `participations.$companyId.tsx` et
>   `participations.index.tsx` ; `EntityFiche.tsx` simplifié (nature « company »
>   uniquement) ; nettoyage des clés i18n `participations` (badge/kind/block/group,
>   natures sponsor/group, identity de conso).
> - Back : suppression de `convex/participations.ts`, `convex/lib/groupSettings.ts`,
>   `convex/lib/portfolioGroups.ts` et de `tests/portfolioGroups.test.ts` ;
>   `companies.update`, `deals.ts` et `aggregate.ts` allégés de la méta‑groupe
>   (`buildGroupMeta`/`groupMeta`, `companyRef` sans champs groupe).
>   `assertInvestorIsGroupEntity` (entités juridiques `group_*`) est conservé — sans
>   rapport avec la feature de regroupement.

## v1.22.0 — 24/06/2026 à 12:30 — Recherche Attio des personnes

Dans la fenêtre **Modifier la société**, chaque ligne de personne propose
désormais une **recherche Attio** : tapez un nom, les **suggestions** issues
d'Attio apparaissent (avec un repère « Attio »), et un clic **remplit le nom et
le lien** vers la fiche Attio de la personne — son nom devient ensuite cliquable
sur la fiche. L'ajout **à la main** reste possible : si vous ne choisissez
aucune suggestion, la personne est simplement enregistrée **sans lien**, comme
avant. Une personne liée affiche un discret « **Lié à Attio** ». Si la recherche
est momentanément indisponible, un message neutre s'affiche et la saisie
manuelle continue de fonctionner.

> **🔧 Notes techniques**
>
> - Backend : nouvelle **action** `convex/attio.ts:searchPeople` (seules les
>   actions font du réseau externe). POST `…/v2/objects/people/records/query`,
>   filtre `name $contains`, 8 résultats max, **lecture seule**. La clé
>   `ATTIO_API_KEY` (réutilisée du webhook entrant `attioSync.ts`) est lue
>   **côté serveur uniquement** et jamais loggée. Auth via l'`internalQuery`
>   probe `requireMember` → `requireOrgMember` appelé en `ctx.runQuery` (une
>   action n'a pas `ctx.db`).
> - Dégradation propre : clé manquante → `error:'config'`, Attio en erreur /
>   transport KO → `error:'upstream'`, liste vide, **pas de crash** (seul un
>   non-membre lève). Le front affiche un message neutre et garde l'ajout manuel.
> - Front : `participations.$companyId.tsx` — extraction d'un composant
>   `PersonRow` (état de recherche local par ligne), `useAction` débouncé 300 ms
>   (`useDebouncedValue`), suggestions dans un `Popover`/`PopoverAnchor` ancré
>   sur l'input (badge « Attio »). Éditer le nom remet `attioRecordId: undefined`
>   (délie). **Save inchangé** : `companies.update`, remplacement total, pas de
>   nouvelle mutation.
> - Le lien vers la fiche est déjà fabriqué par `attioPersonUrl` (5b) dès que
>   `attioRecordId` est rempli. i18n EN/FR : `edit.personSearching`,
>   `personSearchNoResults`, `personSearchError`, `personLinkedToAttio`,
>   `attioBadge`.
> - Hors périmètre : pré-remplissage depuis le team Attio de l'entité (5d),
>   toute écriture vers Attio, resync des noms snapshotés.

## v1.21.0 — 24/06/2026 à 11:45 — Fondateurs, board et co-investisseurs sur la fiche

Les fiches société affichent désormais leurs **fondateurs**, **membres du
board** et **co-investisseurs**, regroupés par rôle. Un nouveau bloc dans la
fenêtre **Modifier la société** permet de les **ajouter, renommer ou
retirer**, à la main par leur nom. Quand une personne est déjà liée à Attio,
son nom devient un **lien cliquable** vers sa fiche Attio ; sinon il s'affiche
en texte simple. Les sections sans personne restent discrètes (« À
renseigner »).

> **🔧 Notes techniques**
>
> - Affichage : `PeopleList` (`src/components/companies/EntityFiche.tsx`) rend
>   le **nom** en lien quand un `attioUrl` est fourni. L'URL est fabriquée par
>   `attioPersonUrl` (`src/lib/attio.ts`, miroir de `attioCompanyUrl`, segment
>   `/person/<record_id>`, `null` si `VITE_ATTIO_WORKSPACE_URL` absente). Le
>   groupement par rôle se fait dans `participations.$companyId.tsx`
>   (`peopleByRole`).
> - Édition : section « Personnes » greffée sur `EditCompanyDialog` (liste de
>   lignes rôle + nom + retirer, bouton « ajouter »). Au save, la **liste
>   complète** part dans `companies.update` (`patch.people`, remplacement
>   total). `attioRecordId` d'une personne déjà liée est **préservé** au
>   rebuild (aucune UI pour le saisir en 5b). Gate Save : un nom vide bloque
>   (miroir du rejet backend `invalid_person_name`).
> - i18n EN/FR : `personRole.{founder,board,coinvestor}`, `edit.people*`,
>   `edit.errors.invalid_person_name`.

## v1.20.1 — 24/06/2026 à 09:15 — Préparer fondateurs, board et co-investisseurs

Les fiches société pourront bientôt lister leurs **fondateurs**, **membres du
board** et **co-investisseurs**. Cette mise à jour pose la **fondation
technique** côté base de données : rien ne change encore à l'écran, mais ces
personnes peuvent désormais être enregistrées (avec, si besoin, un lien vers
leur fiche Attio). L'affichage et la saisie arriveront dans une prochaine
mise à jour.

> **🔧 Notes techniques**
>
> - Nouveau champ `people` sur la table `companies`
>   (`v.optional(v.array(...))`, donc additif — pas de migration) : liste
>   d'objets `{ role, name, attioRecordId? }`.
> - Enum `role` (`founder | board | coinvestor`) + validateur d'objet
>   `personValidator` centralisés dans `convex/lib/people.ts`, selon la
>   convention `literals(...)` du Lot 3 ; importés par `convex/schema.ts` et la
>   mutation.
> - `companies.update` étendue (pas de nouvelle mutation) : accepte `people` en
>   **remplacement total** de la liste ; `role` invalide rejeté par le
>   validateur Convex, `name` vide rejeté (`invalid_person_name`) avant tout
>   write. Scoping `requireOrgMember` inchangé.
> - Choix assumé : `people` est un **champ**, pas une table dédiée ;
>   `linkedin`/`email` non stockés (accessibles via Attio). Cf. `KNOWN_ISSUES.md`
>   « Fiche entité ». Affichage + dialog d'édition = Lot 5b.

Changer le **type d'instrument** d'un deal depuis l'écran « Modifier » est
désormais **enregistré** comme les autres champs. Et pour éviter toute
inquiétude : quand vous sélectionnez un nouveau type, un **message** vous
confirme que les champs propres à l'ancien type ne sont **pas effacés**. Ils
sont simplement mis en sommeil — masqués tant que le deal reste sur le nouveau
type, et **rétablis à l'identique** si vous repassez au type d'origine. Aucune
donnée n'est perdue lors d'un changement de type.

> **🔧 Notes techniques**
>
> - Bannière de confirmation conditionnelle dans `EditDealDialog`
>   (`src/routes/app/$orgSlug/deals.$dealId.tsx`), affichée quand
>   `instrument !== deal.instrumentKind` ; libellé `participations:edit.typeChangeNotice`
>   (interpolation `from`/`to` via `t('participations:instrument.<kind>')`), EN/FR.
> - **Aucun changement backend** : `convex/deals.ts:update` persistait déjà
>   `{ instrumentKind }` (clé du validateur de patch) et ajoutait toute clé du
>   patch à `manuallyEditedFields` (shipé en Lot 3, PR #96). L'invariant
>   « sommeil » vient de la sémantique du patch partiel `ctx.db.patch` : seules
>   les clés fournies sont écrites, donc changer le type ne touche que la colonne
>   `instrumentKind` — aucune mise à null collatérale des champs hors-type.
> - Scénario de survie documenté dans `TESTING.md` (FD15).

## v1.19.0 — 23/06/2026 à 23:15 — Modifier les champs d'un deal à la main

La fiche d'un investissement devient **éditable**. Le bouton « Modifier » ouvre
désormais, en plus du nom et du type, **tous les champs propres au type
d'instrument** : on peut corriger un taux, une valorisation, une date de
closing, un type de tour, un montant… chacun dans le bon format (euros, %,
date, liste de choix).

- Chaque champ modifié à la main est **protégé** : le prochain ré-import depuis
  Airtable ne l'écrasera plus. Un **petit point** à côté du champ, sur la fiche,
  signale qu'il a été saisi à la main.
- Une saisie incohérente (lettres dans un montant, par exemple) **bloque
  l'enregistrement** — rien n'est sauvegardé à moitié.
- Les libellés lèvent une ambiguïté : le **« Montant contractuel »** (saisi à la
  main) est distinct du **« Décaissé (réel) »**, qui reste calculé
  automatiquement à partir des mouvements bancaires et n'est pas modifiable.

Le type d'instrument, lui, reste pour l'instant un aperçu non enregistré sur la
fiche : son changement définitif arrivera dans un lot dédié.

> **🔧 Notes techniques**
>
> - Backend : 7 validateurs enum d'archétype (`roundType`, `safeType`,
>   `couponPeriodicity`, `repaymentModality`, `termDuration`, `fundType`,
>   `propertyType`) déplacés vers `convex/lib/instruments.ts` (source unique,
>   - tableaux `ENUM_FIELD_VALUES` pour les selects) ; `schema.ts` et
>     `deals.ts` les importent. `dealFields` (partagé `create`/`update`) étendu
>     des ~25 champs d'archétype manquants.
> - Garde-fou : nouvelle colonne `deals.manuallyEditedFields: string[]`.
>   `deals.update` ajoute au set **toute** clé patchée (uniforme côté écriture) ;
>   `airtableImport.ts:upsertDeals` retire du patch les colonnes présentes dans
>   ce set (intersection effective : `paidAmount`, `sharesAcquired`,
>   `signedDate`, `exitedDate`, `status`, `instrumentKind`, `targetCompanyId`,
>   `currency`). Champ additif/optionnel → pas de migration. Détaillé dans
>   `KNOWN_ISSUES.md` « Édition manuelle deals ».
> - Front : `EditDealDialog` (`src/routes/app/$orgSlug/deals.$dealId.tsx`)
>   étendu — rend les `INSTRUMENT_FIELDS[deal.instrumentKind]` en inputs typés
>   par `FIELD_FORMAT` (exporté depuis `InstrumentBlock.tsx`). Patch en diff
>   (seuls les champs réellement changés sont envoyés), gate `valid` qui
>   désactive Save. Parsers partagés dans `src/lib/parse.ts` (€→cents, %→bps,
>   date→ms). Marqueur « édité à la main » via tooltip dans `InstrumentBlock`.
>   `paidActual` jamais éditable (calculé, hors dialog).
> - i18n EN/FR : `edit.fieldsHint`, `edit.selectPlaceholder`,
>   `fiche.manuallyEdited`, libellés `deal.paid` / `field.paidAmount` clarifiés.

## v1.18.0 — 23/06/2026 à 21:40 — Fiche deal qui s'adapte au type d'instrument

La fiche d'un investissement change désormais de visage selon son type. Le bloc
central affiche, dans le bon ordre et avec le bon format (montants en euros, taux
en %, dates), exactement les informations qui comptent pour ce type d'instrument :
actions, obligations, SAFE, fonds, immobilier, SCPI, placements de trésorerie…
Les royalties affichent un panneau « à venir » et les types pas encore configurés
un bloc neutre.

Quelques nouveautés visibles :

- Un **badge de couleur** indique la grande famille de l'instrument (capital,
  dette, fonds, immobilier, royalties, placement…).
- Un **sélecteur de type** en haut de la fiche permet de **prévisualiser** à quoi
  ressemblerait la fiche dans un autre type, sans rien enregistrer : un bandeau
  « Aperçu — non enregistré » le rappelle clairement, et tout revient à la normale
  au rechargement.
- Les **SAFE** proposent une vue Pré / Post-conversion.
- Les **placements** (crypto, contrats de capitalisation) affichent la
  **plus-value latente** (valeur actuelle − montant versé), en vert ou en rouge.
- Une carte **Entité liée** renvoie vers la société investie ; des emplacements
  **Reporting & KPIs** et **Documents** sont réservés pour la suite.

Cette fiche reste en lecture seule : l'édition du type et des champs arrivera
ensuite.

> **🔧 Notes techniques**
>
> - Nouveau composant `src/components/deals/InstrumentBlock.tsx` : bloc central
>   **lecture seule** piloté par `convex/lib/instrumentMapping.ts` (lit
>   `INSTRUMENT_RENDER` pour le mode, `INSTRUMENT_FIELDS` pour les colonnes
>   ordonnées, `INSTRUMENT_ARCHETYPE` pour le badge). Aucune liste de champs en
>   dur : seul un `FIELD_FORMAT` (champ → format cents/bps/ms/enum) vit côté
>   front. Modèle deux-états SAFE déduit de la position de `conversionValuation`
>   dans le mapping (pas de liste codée en dur) ; plus-value placement via
>   `signTone`. Badges d'archétype via tokens `chart-1..5` / `positive`.
> - `src/routes/app/$orgSlug/deals.$dealId.tsx` : la grille d'infos à plat est
>   remplacée par un overview (Engagé/Versé/Reçu) + `InstrumentBlock`. Sélecteur
>   de type = état local `previewKind` (jamais persisté, cf. Lot 3) avec bandeau
>   « aperçu non enregistré » + reset. Ajout carte entité + placeholders
>   reporting/documents. Helpers orphelins (`Info`, `fmtPct`, `fmtNum`) retirés.
> - i18n EN/FR : nouveaux namespaces `field.*`, `enum.*`, `archetype.*`,
>   `fiche.*` dans `src/locales/{en,fr}/participations.json`.
> - Dette tracée dans `KNOWN_ISSUES.md` : `INSTRUMENTS` dupliqué dans la route
>   deal vs `convex/lib/instruments.ts` (à nettoyer dans un lot ultérieur).
> - Front uniquement : aucune mutation, aucun changement de schéma, aucune
>   commande `--prod`.

## v1.17.0 — 23/06/2026 à 21:38 — Fiches entités : un socle commun par nature

Les fiches d'entité s'organisent désormais autour d'un même squelette, quel que
soit le type : un en-tête (nom, nature, détention), un bloc d'identité qui
s'adapte à la nature de l'entité, puis les zones Reporting/KPIs et Documents.

- **Entreprise** : secteur, SIREN, nom de domaine, détention, lien vers la fiche
  Attio, et des sections Fondateur(s) / Membres du board / Co-investisseurs (pour
  l'instant à renseigner — leur saisie viendra plus tard).
- **Sponsor dette** : nom, type de plateforme, lien Attio et contact principal
  (à renseigner) ; rappel que les deals de dette rattachés remontent via les
  entités membres.
- **Groupe** : nom, identifiant stable, type, et la liste des entités membres.

Tout reste en lecture seule sur le bloc d'identité — l'édition fine (le crayon)
arrivera dans une prochaine étape. Les actions déjà en place (modifier une
société, créer un deal, renommer/classer un groupe) sont conservées.

> **🔧 Notes techniques**
>
> - Nouveau module présentation `src/components/companies/EntityFiche.tsx`
>   (`EntityNatureBadge`, `IdentityField`, `IdentitySection`, `PeopleList`,
>   `ReservedSection`, `AttioCompanyLink`) — briques read-only partagées.
> - Refonte de `participations.$companyId.tsx` (nature « company ») et
>   `participations.group.$slug.tsx` (natures « sponsor »/« group ») au même
>   squelette, **édition existante conservée**. Nature dérivée : company
>   `portfolio` → Entreprise ; `portfolioGroupSettings.groupKind === 'sponsor'`
>   → Sponsor dette ; sinon → Groupe (le `groupKind` vit sur
>   `portfolioGroupSettings`, pas sur `companies`).
> - Aucun champ ajouté au schéma : fondateurs/board/co-investisseurs, type de
>   plateforme et contact sponsor sont rendus en « À renseigner » (cf.
>   `KNOWN_ISSUES.md` « Fiche entité »).
> - Lien Attio via `src/lib/attio.ts:attioCompanyUrl`, base d'URL publique
>   `VITE_ATTIO_WORKSPACE_URL` (sans elle : pas de lien, jamais d'URL devinée).
> - i18n EN/FR : blocs `nature` et `identity` dans
>   `src/locales/{en,fr}/participations.json`.

## v1.16.2 — 23/06/2026 à 20:33 — Placements de trésorerie : socle de fiche (technique)

Suite du socle des fiches par type d'instrument : les placements de trésorerie
(crypto, contrats de capitalisation) sortent du « type non encore configuré » et
disposent d'une fiche minimale côté serveur (date de placement, montant placé,
valeur actuelle, établissement). Rien de visible pour l'instant ; l'affichage et
le calcul de plus-value latente viendront avec l'interface.

> **🔧 Notes techniques**
>
> - Nouvel archétype `placement` dans `convex/lib/instrumentMapping.ts` :
>   `crypto` et `capitalization_account` passent de `unassigned`/`placeholder` à
>   `placement`/`fields`, config partagée `PLACEMENT_FIELDS` (`closingDate`,
>   `paidAmount`, `currentValue`, `bankName`). `cto` reste seul en
>   `unassigned`/`placeholder` (pas de deal en prod pour cadrer son layout). Les
>   `Record` restent totaux (19 clés) ; `INSTRUMENT_FIELDS` passe à 17 types.
> - `convex/schema.ts` : une seule colonne neuve optionnelle `currentValue`
>   (cents). Date de placement / montant placé / établissement réutilisent
>   `closingDate` / `paidAmount` / `bankName`. La plus-value latente
>   (`currentValue − paidAmount`) sera calculée côté front (Lot 2), non stockée.
> - Aucune mutation, aucune migration, aucune commande `--prod`.

## v1.16.1 — 23/06/2026 à 19:56 — Socle des fiches par type d'instrument (technique)

Préparation interne de la refonte des fiches deal/instrument : le socle de
données par type d'instrument est posé côté serveur. Rien de visible pour
l'instant ; les nouvelles informations s'afficheront avec les prochaines mises
à jour de l'interface.

> **🔧 Notes techniques**
>
> - Nouveau module source unique `convex/lib/instrumentMapping.ts` : 5
>   archétypes (`equity`, `debt`, `funds_lp`, `real_estate`, `royalties`) + un
>   bucket d'attente `unassigned`. `INSTRUMENT_ARCHETYPE` et `INSTRUMENT_RENDER`
>   sont des `Record` totaux sur les 19 `instrumentKind` ; `INSTRUMENT_FIELDS`
>   est partiel (15 types configurés, ordre = ordre d'affichage). `royalty` en
>   render `custom` (panel réservé) ; `cto`, `crypto`, `capitalization_account`
>   en `placeholder` (design reporté avant Lot 2). `bsa`/`convertible_note`
>   réutilisent la config `safe`, `loan` la config `os`, `secondary` la config
>   `fonds`.
> - `convex/schema.ts` : 7 enums (`roundType`, `safeType`, `couponPeriodicity`,
>   `repaymentModality`, `termDuration`, `fundType`, `propertyType`) + 24
>   colonnes optionnelles dormantes sur `deals`. Colonnes de valorisation
>   neuves `preMoneyValuation`/`postMoneyValuation` (l'`entryValuation`
>   existant n'est pas touché). Réutilisation des colonnes existantes quand le
>   sens correspond (roundSize, interestRate, maturityDate, principalAmount,
>   committedAmount, paidAmount, sharesAcquired, pricePerShare, valuationCap,
>   discount).
> - Aucune mutation, aucune migration, aucune commande `--prod` : colonnes en
>   sommeil jusqu'au câblage du front (Lot 2).

## v1.16.0 — 23/06/2026 à 18:36 — Participations : distinguer sponsors et groupes

Les **groupes de participations** peuvent désormais être de deux natures :
**sponsor** ou **groupe**. Un badge dédié les distingue d'un coup d'œil dans la
liste des participations et sur la page consolidée. À la **création d'un
nouveau groupe** (en tapant un nom inédit depuis une fiche société), le choix
du type est **obligatoire** — impossible d'enregistrer tant qu'il n'est pas
fait. Les groupes existants restent affichés comme avant ; vous pouvez les
classer (ou les reclasser) à tout moment depuis leur page consolidée. Ce
réglage est purement visuel : il ne change aucun calcul ni aucun KPI.

> **🔧 Notes techniques**
>
> - Nouveau champ optionnel `groupKind` (`'sponsor' | 'group'`) sur
>   `portfolioGroupSettings` (`convex/schema.ts`). Rétro-compatible, sans
>   backfill : un groupe sans `groupKind` retombe sur le badge « groupe ».
> - `ensureGroupSettings` (`convex/lib/groupSettings.ts`) accepte un 4e
>   paramètre `groupKind` écrit **uniquement à l'insert** ; l'early-return sur
>   groupe existant garantit l'idempotence (jamais réécrit). `GroupMeta` +
>   `buildGroupMeta` propagent le champ.
> - `companies.update` accepte `groupKind` dans le `patch`, le transmet à
>   `ensureGroupSettings` puis le retire avant le `ctx.db.patch('companies')`
>   (ce n'est pas un champ société). Backend permissif : le forçage du choix
>   est côté front.
> - Nouvelle mutation `participations.setGroupKind` (reclassement depuis la
>   page conso) ; `getGroup` renvoie `groupKind`. Les `companyRef` de
>   `convex/deals.ts` et `convex/aggregate.ts` exposent `groupKind`.
> - Front : sélecteur de type dans `EditCompanyDialog`
>   (`participations.$companyId.tsx`) affiché et requis **seulement quand le
>   nom de groupe saisi est nouveau** ; badges sponsor/groupe dans
>   `ParticipationsTable.tsx` et `participations.group.$slug.tsx` (avec
>   sélecteur de reclassement, état « À classer » pour les groupes legacy).
> - i18n EN/FR : `badge.sponsor`, `kind.*`, `edit.kind*`, `group.kind*`.

## v1.15.0 — 22/06/2026 à 17:45 — Participations : supprimer un deal (protégé)

La fiche d'un deal dispose désormais d'un bouton **« Supprimer »** qui efface
définitivement l'investissement, après une confirmation explicite. Garde-fou :
la suppression est **bloquée** tant que des mouvements bancaires sont rapprochés
sur le deal — le bouton est alors désactivé et indique combien de mouvements
dé-rapprocher au préalable. Une fois le deal supprimé, on revient sur la fiche de
la société.

> **🔧 Notes techniques**
>
> - Backend : garde ajoutée dans `convex/deals.ts` `remove` — avant le hard
>   delete, lecture de l'index `by_deal` ; si une transaction est liée →
>   `ConvexError('deal_has_transactions')` (préserve l'invariant
>   `matched ⟺ dealId`, évite les transactions orphelines). Existence +
>   `requireOrgMember` inchangés.
> - Front : dans `deals.$dealId.tsx`, bouton « Supprimer » (destructive) +
>   `Dialog` de confirmation. Bouton désactivé quand
>   `listByDeal(dealId).length > 0`, avec message pluralisé. Au succès,
>   navigation vers `deal.target` (fiche entité) ou `/participations`.
> - Filet de sécurité : l'erreur `deal_has_transactions` est aussi gérée dans le
>   `catch` (toast clair), au cas où. i18n EN/FR sous `deleteDeal.*`.

## v1.14.1 — 22/06/2026 à 12:11 — Synchronisation Attio (préparation technique)

Préparation de la synchronisation automatique depuis Attio : lorsqu'un deal
change d'étape dans Attio (passage en « Term Sheet » ou « Invested »), Albo OS
pourra bientôt créer ou mettre à jour le deal correspondant. Ce lot pose la
plomberie technique côté serveur ; rien n'est encore visible ni écrit en base.

> **🔧 Notes techniques**
>
> - Nouveau endpoint webhook `POST /attio/webhook` (`convex/http.ts` →
>   `convex/attioSync.ts:attioWebhook`). Vérification de signature
>   HMAC-SHA256 (hex) sur le corps brut, header `Attio-Signature`, secret
>   `ATTIO_WEBHOOK_SECRET` — même approche Web Crypto que Powens
>   (`crypto.subtle.verify`), adaptée (Powens = base64 + message préfixé).
> - Pour chaque event : re-fetch du record via `GET /v2/objects/deals/records/{id}`
>   (Bearer `ATTIO_API_KEY`), lecture de la valeur **active**
>   (`active_until === null`) de `stage` / `value` / `albo_or_calte` /
>   `associated_company` / `type_d_invest` / `date_de_l_investissement`.
>   Filtre serveur sur les status id Term Sheet (`bb580481…`) et Invested
>   (`b59066ed…`) ; tout autre stage → 200 no-op. 401 seulement si signature
>   invalide.
> - `internal.attioSync.upsertFromDeal` : **squelette** (Lot 1), signature
>   d'args complète mais ne fait que logger, aucune écriture DB. L'upsert réel
>   (deal `pending`/`active` + forecast, investor = `group_root`, idempotent
>   sur `attioDealId`) est le Lot 2.
> - Env à positionner en prod : `ATTIO_WEBHOOK_SECRET` (nouveau),
>   `ATTIO_API_KEY` (déjà set).

## v1.14.0 — 22/06/2026 à 15:30 — Participations : créer un deal depuis la fiche entité

La fiche d'une société dispose désormais d'un bouton **« Nouveau deal »** dans son
en-tête, qui ouvre un dialog de création d'investissement rattaché à cette société.
Choisissez l'investisseur (une entité du groupe — présélectionné s'il n'y en a
qu'une) et l'instrument parmi la liste complète, et renseignez éventuellement un
montant engagé et une date de signature. À la validation, le deal apparaît
aussitôt dans la liste de la fiche. Les erreurs de cohérence (investisseur invalide,
mauvaise organisation) affichent un message clair.

> **🔧 Notes techniques**
>
> - Front uniquement, dans `participations.$companyId.tsx` : nouveau
>   `CreateDealDialog` (Dialog shadcn + `Select` investisseur/instrument) ouvert
>   depuis l'en-tête de la fiche. **Aucune mutation backend ajoutée ni modifiée.**
> - Soumission : `deals.create({ orgId, investorCompanyId, targetCompanyId, instrumentKind, committedAmount?, signedDate? })`.
>   `status` ('active') et `currency` ('EUR') gardent leurs défauts backend (non
>   exposés). Montant euros → cents (`Math.round(x * 100)`) ; date → ms epoch
>   (`new Date(v).getTime()`).
> - Investisseur = entités `group_*` via `api.companies.list({ orgId })` filtrées
>   client-side (`kind.startsWith('group_')`, miroir de `assertInvestorIsGroupEntity`) ;
>   présélection si une seule, sinon choix obligatoire (pas de défaut deviné).
> - Instruments importés de la source unique `convex/lib/instruments.ts`
>   (`INSTRUMENTS`), pas de liste recopiée. Erreurs `investor_must_be_group_entity`
>   / `investor_wrong_org` / `target_wrong_org` / `spv_wrong_org` classées via
>   `ConvexError.data`. i18n EN/FR sous `createDeal.*`.

## v1.13.0 — 22/06/2026 à 12:00 — Participations : créer une entité depuis la liste

La page **Participations** dispose désormais d'un bouton **« Nouvelle entité »**
dans son en-tête, qui ouvre un dialog de création. Renseignez le nom (obligatoire),
éventuellement le SIREN (9 chiffres) et un groupe — nouveau ou choisi dans la liste
des groupes existants. À la validation, l'entité est créée et vous êtes redirigé
vers sa fiche. Si le SIREN est invalide ou déjà utilisé, un message clair s'affiche
sans rien créer.

> **🔧 Notes techniques**
>
> - Front uniquement, dans `participations.index.tsx` : nouveau
>   `CreateCompanyDialog` (calqué sur `EditCompanyDialog` pour le style, la
>   validation SIREN et le `<datalist>` groupe via `api.participations.listGroups`)
>   - bouton « Nouvelle entité » dans l'en-tête de la liste.
> - Soumission : `companies.create({ orgId, name, kind: 'portfolio', siren? })`
>   (`kind` forcé, non exposé), puis `companies.update({ id, patch: { group } })`
>   **conditionnel** si un groupe est saisi (`create` n'accepte pas `group`).
>   **Aucune mutation backend ajoutée ni modifiée.**
> - Cas create OK / update groupe KO : navigation vers la fiche créée + toast
>   d'avertissement explicite (l'entité n'est pas perdue). Erreurs `invalid_siren`
>   / `siren_already_used` classées comme dans l'edit dialog (`ConvexError.data`).
> - i18n EN/FR ajoutée sous `create.*` ; les libellés de champs réutilisent
>   `edit.*`.

## v1.12.1 — 21/06/2026 à 18:30 — Participations : rattacher des entités depuis la page groupe

Sur la **page consolidée d'un groupe**, un bouton **« Ajouter une entité »**
permet désormais de rattacher plusieurs sociétés au groupe en une seule fois,
sans passer par la fiche de chacune. Le sélecteur ne propose que les sociétés
du portefeuille **qui n'appartiennent à aucun groupe** ; cochez-en plusieurs,
validez, et elles rejoignent aussitôt la liste et les KPI consolidés.

> **🔧 Notes techniques**
>
> - Front uniquement, dans `participations.group.$slug.tsx` : nouveau
>   `AddEntityDialog` (Dialog + liste de `Checkbox`) ouvert depuis l'en-tête de
>   `EntityList` (qui reçoit désormais `orgId`).
> - Source : `api.companies.list({ orgId, kind: 'portfolio' })` filtrée
>   client-side sur `!c.group`. Validation = `Promise.all` de
>   `companies.update({ id, patch: { group } })` (clé logique du groupe courant) —
>   **aucune nouvelle mutation**. La query `getGroup` se rafraîchit seule (Convex
>   réactif).
> - i18n EN/FR ajoutée sous `group.*` (libellés bouton/dialog, état vide, toast
>   pluralisé).

## v1.12.0 — 21/06/2026 à 12:55 — Participations : regrouper plusieurs entités

Vous pouvez désormais **regrouper plusieurs sociétés du portefeuille** sous une
seule ligne dans Participations (par exemple tous les SPV d'une même plateforme,
ou les boutiques d'une même enseigne).

- Depuis la fiche d'une société, un champ **Groupe** permet de l'assigner à un
  groupe existant ou d'en **créer un nouveau** (il suffit de taper son nom).
  Laisser le champ vide retire la société du groupe.
- Dans la liste des participations, les sociétés d'un même groupe se
  **consolident sur une seule ligne** (montants engagés / versés / reçus et TVPI
  additionnés), avec un badge « groupe ». Les sociétés sans groupe ne changent
  pas. Déplier la ligne montre tous les deals du groupe en précisant à quelle
  entité chacun appartient.
- Un bouton **« Voir le groupe »** ouvre une **page consolidée** dédiée : KPI
  agrégés que vous pouvez **réordonner et masquer** selon vos préférences, nom
  d'affichage **renommable**, et la liste des entités cliquables vers leur fiche.
- La vue **toutes organisations** bénéficie aussi de ce regroupement.

> **🔧 Notes techniques**
>
> - Schéma : champ optionnel `companies.group` (clé logique, distinct de
>   `sponsor`) + index `by_org_group` ; nouvelle table `portfolioGroupSettings`
>   (slug d'URL stable généré une fois, `displayName` renommable, config `blocks`)
>   avec index `by_org_group` / `by_org_slug`.
> - Logique pure testée (`convex/lib/portfolioGroups.ts` + `tests/portfolioGroups.test.ts`) :
>   `aggregateEntities` (TVPI = (reçu+résiduel)/versé, même formule que le reducer
>   client), `resolveBlocks`/`sanitizeBlocks` (catalogue `KPI_BLOCKS` extensible
>   sans migration), `slugify`/`uniqueSlug`. Helpers ctx dans
>   `convex/lib/groupSettings.ts` (`ensureGroupSettings`, `getGroupBySlug`,
>   `buildGroupMeta`).
> - Back : `companies.update` étendu (`group`, trim, upsert settings via
>   `ensureGroupSettings`) ; `convex/participations.ts` (`getGroup`, `listGroups`,
>   `setGroupBlocks`, `setGroupDisplayName`). Les `companyRef` de `deals.ts` et
>   `aggregate.ts` portent `group`/`groupSlug`/`groupDisplayName` (via `buildGroupMeta`,
>   une lecture indexée par org) → la liste consolide dans les deux vues sans
>   requête de rendu supplémentaire.
> - Front : reducer de `ParticipationsTable` regroupé par `group` (clé préfixée
>   `g:`), bouton « Voir le groupe », `DealsList` avec `showEntity` ; champ Groupe
>   (`Input` + `datalist`) dans `EditCompanyDialog` ; nouvelle route
>   `participations.group.$slug.tsx` (en-tête + KPI réordonnables/masquables +
>   liste d'entités). i18n EN/FR.

## v1.11.0 — 18/06/2026 à 17:29 — Invitations : entrée directe dans l'organisation

Accepter une invitation est désormais plus simple et fiable.

- Un **nouvel invité** définit son nom et son mot de passe et **entre
  directement** dans l'organisation, sans étape « vérifiez votre e-mail » :
  cliquer sur le lien d'invitation reçu prouve déjà que la boîte mail est la
  sienne.
- Si vous êtes **déjà connecté avec un autre compte** que celui invité, un écran
  clair vous le signale et vous propose de **vous déconnecter pour continuer**
  (ou d'annuler) — plus de déconnexion subie.
- Après acceptation, vous atterrissez **dans l'organisation de l'invitation**,
  même si vous étiez déjà membre d'une autre.
- Rouvrir un lien déjà accepté ne provoque plus d'erreur.
- Les inscriptions classiques (hors invitation) continuent, elles, de demander
  la vérification de l'e-mail.

> **🔧 Notes techniques**
>
> - Cause racine : `signUp.email` n'embarquait pas le token d'invitation et,
>   sous `requireEmailVerification`, n'ouvrait jamais de session → `invitations.accept`
>   ne se rejouait jamais. Fix : hook `databaseHooks.user.create.before`
>   (`convex/auth.ts`) qui pose `emailVerified` **uniquement** si le body du
>   signup porte un token valide (`internal.invitations.validateInviteForSignup`,
>   token + email + pending + non expiré). `autoSignIn` ne se déclenche pas sous
>   `requireEmailVerification`, donc le front enchaîne `signUp → signIn → accept`
>   (`src/routes/accept-invite.$token.tsx`, `register.tsx`), avec
>   `callbackURL=/accept-invite/<token>` en filet. `inviteToken` est un champ de
>   body extra (forwardé par le client BA, jamais persisté).
> - `invitations.accept` rendu idempotent (réconcilie `acceptedAt` si déjà
>   membre, retourne toujours `orgSlug`) ; match email insensible casse + trim.
>   Logique pure extraite dans `convex/lib/invitations.ts` + `tests/invitations.test.ts`.
> - Écran de désambiguïsation (`SwitchAccountCard`) : déconnexion consentie,
>   token préservé, clés i18n `auth:acceptInvite.wrongAccount.*` (EN/FR).
>   Détails et pièges : `KNOWN_ISSUES.md` « Invitation : signup sans vérification
>   email (token-gated) ».

## v1.10.0 — 16/06/2026 à 15:30 — Tableau de bord repensé

Le tableau de bord adopte une mise en page plus éditoriale et plus dense.

- Une **carte héros** met en avant la **valeur estimée du portefeuille** (NAV),
  avec un badge **TVPI** et une **courbe d'évolution** mensuelle.
- Les indicateurs clés passent en grille **2×2** : Capital déployé (sur N
  participations), Distribué (avec le **DPI**), Trésorerie (nombre de comptes
  connectés) et Participations (nombre de deals actifs).
- En bas, **Répartition par instrument** (barres) et **Activité récente** (les 5
  dernières opérations, débits en rouge / crédits en vert) côte à côte, avec le
  lien vers la trésorerie.

> **🔧 Notes techniques**
>
> - `convex/dashboard.ts` (`getDashboard`) : ajout de `accountsCount` (comptes
>   EUR non archivés) et de `navSeries` (série NAV mensuelle, plafonnée à ~24
>   points). Les transactions et valuations sont désormais lues une seule fois
>   par deal — passe unique réutilisée pour les totaux **et** la série — donc le
>   dernier point de la courbe réconcilie avec le NAV ponctuel. Le DPI
>   (distribué / déployé) est calculé côté client.
> - Refonte de `src/routes/app/$orgSlug/index.tsx` en composants
>   `src/components/dashboard/{HeroCard,AllocationCard,ActivityCard}.tsx` :
>   sparkline recharts en import dynamique (fill via `--chart-1`), barres
>   d'allocation au token accent en opacité dégressive (pas de couleur en dur),
>   lignes d'activité avec `directionTone`. `KpiCard` réutilisée. Nouvelles clés
>   i18n `dashboard` FR/EN : `overview`, `hero.*`, `kpi.dpi*`,
>   `kpi.deployedHint*`, `kpi.accounts*`.

## v1.9.0 — 16/06/2026 à 10:45 — Trésorerie unifiée : Aperçu + Transactions

Le Pointage rejoint la Trésorerie : une seule entrée de menu, deux onglets.

- **Aperçu** : la courbe de trésorerie passe **tout en haut**, suivie du solde
  et des comptes, de la TVA récupérable, puis du prévisionnel (règles
  d'entrées/sorties récurrentes — inchangé).
- **Transactions** : un registre complet façon Pennylane, avec **toutes** les
  transactions de tous les comptes. Une transaction rapprochée ne disparaît
  plus — elle reste visible avec son statut. « À pointer » devient un simple
  filtre (par défaut, avec son compteur), aux côtés de Tout / Pointé / Charges
  / Impôts / Produits / Virements internes ; on peut aussi filtrer par compte
  et rechercher. Le rapprochement se fait directement dans le tableau, et on
  peut détacher une ligne déjà pointée d'un clic.

L'ancien menu « Pointage » disparaît ; les anciens liens vers cette page
redirigent automatiquement vers l'onglet Transactions.

Nouveau thème de couleur **« Albo (orange) »** dans le sélecteur de thème.

> **🔧 Notes techniques**
>
> - Backend : `convex/transactions.ts` gagne `listLedger` (registre complet,
>   filtres `status?`/`bankAccountId?`/`search?`, enrichi du compte, borné aux
>   `LEDGER_LIMIT = 1000` plus récentes, plus récent d'abord — choix d'index
>   selon le filtre, post-filtre compte en JS quand l'index de recherche ne
>   peut l'appliquer) et `countByStatus` (badge « À pointer »). Mutations de
>   pointage réutilisées telles quelles.
> - `PointageTable.tsx` paramétré par `statusColumn` : colonne Statut + action
>   par ligne résolue selon `matchStatus` (match/écarter pour unmatched, sélecteur
>   TVA + Détacher pour charge/produit, Détacher sinon). Le bandeau « Annuler »
>   transitoire reste réservé à l'inbox « À pointer » ; en mode registre la
>   ligne reste visible via la réactivité. `DiscardedTable` supprimée (couverte
>   par le registre). `TxDetails` (`TransactionSheet.tsx`) gagne `matchStatus?`
>   et `allocation?`.
> - Nouveau `src/components/cash/TransactionsLedger.tsx` (filtres statut/compte/
>   recherche → `PointageTable` en mode `statusColumn`).
> - `cash.index.tsx` : page à 2 onglets via `validateSearch` `?tab=` (optionnel,
>   défaut Aperçu). `ForecastSection.tsx` scindé en `ForecastChartCard` (courbe,
>   en haut) et `ForecastRulesSection` (règles, en bas).
> - `pointage.index.tsx` → redirect `beforeLoad` vers `/cash?tab=transactions`.
>   `nav.ts` (item Pointage retiré), `VatCard.tsx` (lien « à qualifier » →
>   registre), `ThemePicker.tsx` + `brand.css` (`data-theme='albo'`,
>   `oklch(0.588 0.17 36.5)`), i18n `cash`/`pointage`/`nav` (en+fr).
> - Plafond du registre documenté dans `KNOWN_ISSUES.md` « Registre Transactions ».

## v1.8.0 — 15/06/2026 à 16:52 — Logos des entreprises du portefeuille

Les participations affichent désormais le logo de chaque société : dans la
liste des participations (par véhicule et dans la vue consolidée) ainsi qu'en
en-tête de la fiche société. Quand le logo n'est pas disponible (société sans
site renseigné), une icône neutre prend le relais — aucune image cassée.

> **🔧 Notes techniques**
>
> - Nouveau composant `src/components/CompanyLogo.tsx` : URL CDN logo.dev
>   construite côté client depuis `companies.domain` + clé publishable
>   `VITE_LOGO_DEV_TOKEN` ; fallback `Building2` sur domaine/token absent ou
>   `onError`. **Pas de stockage** (hotlink CDN, cf. `KNOWN_ISSUES.md`
>   « Logos d'entreprises »).
> - `domain` remonté dans l'enrichissement des deals (`companyRef` de
>   `convex/deals.ts` et `convex/aggregate.ts`) puis threadé dans
>   `ParticipationsTable.tsx` (type `DealRow.target`, groupe) ; logo ajouté à
>   l'en-tête de `routes/app/$orgSlug/participations.$companyId.tsx`.
> - Le `domain` provient du snapshot Attio figé (`attioAlboImport.ts`),
>   éditable via `EditCompanyDialog`. Env var publishable à poser
>   (`.env.example`, Vercel).

## v1.7.5 — 15/06/2026 à 16:28 — Outillage : assistant Resend dans Claude Code

Outillage développeur, rien ne change dans l'app : le plugin Resend officiel
pour Claude Code est désormais activé dans le dépôt — Claude peut envoyer et
inspecter les emails Resend directement pendant le développement.

> **🔧 Notes techniques**
>
> - `.claude/settings.json` : `enabledPlugins: { "resend@claude-plugins-official": true }`
>   (serveur MCP + skills Resend, auto-update via le marketplace officiel, donc
>   hors `skills-lock.json`).
> - La clé `RESEND_API_KEY` du plugin se met dans le gitignored
>   `.claude/settings.local.json` (`env`), **distincte** de la clé runtime de
>   l'app (Convex env, `convex/email.ts`).
> - `KNOWN_ISSUES.md` § « Resend: two integrations » documente le piège des
>   deux clés homonymes.

## v1.7.4 — 15/06/2026 à 15:17 — Note interne : pourquoi l'assistant tourne sur Mistral

Note interne pour l'équipe : la raison du choix de Mistral pour l'assistant —
souveraineté des données en Europe, coût, et choix volontairement réversible —
est désormais consignée. Rien ne change à l'usage.

> **🔧 Notes techniques**
>
> - Nouvelle section « Why Mistral (and not Claude) » dans `KNOWN_ISSUES.md` :
>   résidence EU de la donnée, coût sur le volume d'appels multi-outils, et
>   réversibilité via `getModel()` (`convex/agent.ts`). Complète les sections
>   mécaniques existantes (« Mistral model id », « Mistral prompt caching »).

## v1.7.3 — 15/06/2026 à 13:58 — Lisibilité des montants du tableau de bord

Sur le tableau de bord, les gros montants des tuiles (capital déployé, NAV,
trésorerie…) débordaient de leur carte : le symbole € et les séparateurs de
milliers étaient rognés. Ils s'affichent désormais en notation abrégée —
« 54,0 M€ », « 6,2 M€ » — et le montant exact apparaît en survolant la tuile.
Les barres de défilement, jusqu'ici visibles un peu partout, sont également
masquées pour une interface plus nette (le défilement reste inchangé).

> **🔧 Notes techniques**
>
> - Nouveau formateur `fmtEurCompact` dans `useFormatters()`
>   (`src/components/participations/ParticipationsTable.tsx`) : `Intl.NumberFormat`
>   en `notation: 'compact'`, 1 décimale.
> - `KpiCard` (`src/components/dashboard/KpiCard.tsx`) gagne une prop `title`
>   (tooltip natif du montant exact) ; valeur passée en `tabular-nums
whitespace-nowrap`.
> - Tableau de bord (`src/routes/app/$orgSlug/index.tsx`) : KPI monétaires
>   (deployed/distributed/cash/nav) en compact, montant complet en `title`.
> - Masquage global des scrollbars natives dans `src/styles/app.css`
>   (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) ; le
>   pouce custom de `ScrollArea` (Radix, un div) n'est pas affecté.

## v1.7.2 — 12/06/2026 à 16:05 — Documentation du connecteur Claude

Mise à jour purement documentaire, rien ne change à l'écran.

> **🔧 Notes techniques**
>
> - `KNOWN_ISSUES.md` § « Serveur MCP distant » : claude.ai fige les
>   schémas d'outils à la connexion du connecteur → après un déploiement
>   qui les modifie, déconnecter/reconnecter le connecteur (constat du
>   test live de la v1.7.1).

## v1.7.1 — 12/06/2026 à 15:02 — Connecteur Claude : fini les organisations devinées

Amélioration du connecteur Claude : vos organisations (et uniquement les
vôtres) sont désormais annoncées automatiquement à Claude, qui ne peut plus
se tromper de nom quand il interroge vos données. Une nouvelle organisation
créée dans Albo OS apparaît dans le connecteur sans aucune manipulation.

> **🔧 Notes techniques**
>
> - Constat en test : claude.ai ne charge qu'un sous-ensemble des outils
>   par conversation → `listOrgs` peut manquer et le modèle devinait des
>   slugs erronés (`albo-club`).
> - `convex/mcp/server.ts` : à `initialize` et `tools/list` (requêtes
>   authentifiées), les orgs du user sont résolues
>   (`internal.mcp.queries.listOrgsForUser`) et injectées — `enum` sur le
>   paramètre `org` de chaque outil (`orgAwareSchema`) + liste des slugs
>   dans les `instructions` du serveur. Aucun slug en dur ; l'autorisation
>   reste le re-check `readMembership` à chaque `tools/call`.

## v1.7.0 — 12/06/2026 à 11:36 — L'assistant arrive dans Claude (connecteur MCP)

Vos données de pilotage sont désormais consultables directement depuis
Claude (claude.ai, web et mobile) : ajoutez Albo OS comme « connecteur
personnalisé » et posez vos questions — participations, trésorerie, passif,
prévisionnel, valorisations, KPIs. Claude interroge vos données en **lecture
seule**, après connexion avec votre compte Albo OS (chaque utilisateur ne
voit que ses organisations). Aucune écriture possible par ce canal : la
création et la modification restent dans l'app et le bot Telegram.

> **🔧 Notes techniques**
>
> - `convex/mcp/` : serveur MCP distant Streamable HTTP **stateless** fait
>   main (`server.ts` — JSON-RPC `initialize`/`tools/list`/`tools/call` ;
>   le SDK MCP officiel est Node-only, incompatible avec le runtime des
>   httpActions Convex). Registre de 18 outils lecture (`registry.ts`,
>   schémas zod v4 → `z.toJSONSchema`) qui réutilise les internals des
>   outils agent (`{orgId, actorUserId}` + `readMembership`) ; résolutions
>   user BA → `users` et slug → org dans `queries.ts`.
> - OAuth 2.1 : plugin Better Auth `mcp({ loginPage: '/login' })` (DCR +
>   PKCE ; tables `oauthApplication`/`oauthAccessToken` déjà présentes dans
>   le composant Convex BA). Métadonnées RFC 9728 servies sur convex.site,
>   RFC 8414 au root du domaine app
>   (`src/routes/[.]well-known.oauth-authorization-server.ts`). Reprise du
>   flow après login dans `/login` via `callbackURL` (survit au roundtrip
>   email du magic link).
> - Rate limit `mcpToolCall` (60/min/user), 401 + `WWW-Authenticate`,
>   bypass dev `MCP_DEV_TOKEN`/`MCP_DEV_EMAIL` pour curl/Inspector. Pièges
>   et fallbacks : `KNOWN_ISSUES.md` « Serveur MCP distant ».

## v1.6.4 — 11/06/2026 à 19:05 — Garde-fou : les sauvegardes de données ne partent plus dans le code

Changement purement technique, rien ne change à l'écran : les sauvegardes
de la base de données (créées avant chaque opération sensible) sont
désormais automatiquement exclues du dépôt de code, pour éviter tout risque
de fuite de données.

> **🔧 Notes techniques**
>
> - Ajout de `/albo-backup*.zip` au `.gitignore` : les snapshots produits
>   par l'étape `convex export --prod --path …` (runbook `MIGRATIONS.md`)
>   ne peuvent plus être commités par mégarde. Le repo est **public** → un
>   dump de données prod commité serait une fuite. Aucun zip n'était suivi
>   jusqu'ici ; protection préventive.

## v1.6.3 — 11/06/2026 à 18:29 — Raccordement au template Ouvre-Boîte

Mise à jour technique, rien ne change à l'écran : Albo OS est désormais
raccordé à son template d'origine, ce qui permettra de récupérer proprement
ses futures améliorations de socle (authentification, sécurité, outillage).

> **🔧 Notes techniques**
>
> - Merge `-s ours` de `template/main` (albo-ouvre-boite) : enregistre le
>   lien de parenté sans adopter de code — les prochains
>   `pnpm run upgrade-template` seront des merges 3-way propres.
> - Adoptés explicitement : `.template-version` (v0.2.0), `UPGRADING.md`
>   (lien changelog repointé vers le repo template),
>   `scripts/upgrade-template.mjs` (version capable de graft).
> - Volontairement non repris (déjà refait ici, ou machinerie propre au
>   template) : WhatsNew.tsx, README.product, release-tag.yml, notif
>   signup, bumps de majors (Renovate). Détail et conséquences dans
>   `KNOWN_ISSUES.md` § « Upgrade depuis le template ».

## v1.6.2 — 11/06/2026 à 18:20 — Nettoyage final de la migration précédente

Suite et fin de la correction v1.6.1 : suppression de l'ancien emplacement
de la « dernière organisation visitée », désormais inutile. Aucun
changement visible dans l'app.

> **🔧 Notes techniques**
>
> - Retrait du champ legacy `users.lastOrgSlug` du schéma, du fallback de
>   lecture dans `convex/lib/userPrefs.ts:getLastOrgSlug`, du nettoyage
>   legacy dans `admin:purgeExcept` et de la mutation one-shot
>   `users:purgeLegacyLastOrgSlug` (chantier `MIGRATIONS.md` soldé).
> - ⚠️ Pré-requis au merge : avoir exécuté la purge en prod
>   (`pnpm exec convex run --prod users:purgeLegacyLastOrgSlug`) — sinon
>   la validation de schéma fait échouer le `convex deploy` du build
>   Vercel (garde-fou voulu, la prod en place n'est pas affectée).

## v1.6.1 — 11/06/2026 à 18:11 — Consommation de données divisée, fin d'une boucle invisible

L'application relisait inutilement vos données en continu : garder deux
onglets ouverts sur deux organisations différentes déclenchait une boucle
invisible où chaque onglet réécrivait sans fin la « dernière organisation
visitée », forçant tout l'écran à se recharger des milliers de fois. C'est
corrigé — la consommation de données du compte redescend très nettement, et
l'app ne refait plus de travail en arrière-plan quand rien n'a changé.

> **🔧 Notes techniques**
>
> - Cause racine double : (1) `setLastOrg` patchait la ligne `users`, lue
>   par `requireAppUser` dans **toutes** les queries → chaque write
>   ré-exécutait toutes les subscriptions ouvertes ; (2) l'effect de
>   `src/routes/app/$orgSlug/route.tsx` dépendait de `users.me` → deux
>   onglets sur deux orgs se ré-écrivaient en ping-pong (~16K mutations,
>   4,83 GB de DB bandwidth sur le quota Free de 1 GB).
> - `lastOrgSlug` déplacé vers la nouvelle table `userPrefs` (index
>   `by_user`, helpers `convex/lib/userPrefs.ts`), lue par `users.me` avec
>   fallback sur le champ legacy ; writers migrés (`setLastOrg`,
>   `organizations.create`, `invitations.accept`, purge `admin`).
> - Front : garde `lastOrgSyncedRef` — on ne persiste qu'une fois par slug
>   visité, plus jamais en réaction à un update de `me`.
> - Champ legacy `users.lastOrgSlug` conservé en lecture seule ; purge
>   one-shot `users:purgeLegacyLastOrgSlug` (migre la valeur vers
>   `userPrefs` puis nettoie — exécutable dès le déploiement, runbook
>   `MIGRATIONS.md`).
> - Audit perf annexe : RAS de comparable ; `Date.now()` dans les queries
>   forecast (cache défait) → wontfix documenté dans `KNOWN_ISSUES.md`,
>   à ré-évaluer si ces queries montent dans le breakdown Usage.
> - Docs : `KNOWN_ISSUES.md` « Hot `users` row », anti-pattern `CLAUDE.md`,
>   TESTING A2b (test anti-boucle 2 onglets).

## v1.6.0 — 11/06/2026 à 17:45 — L'assistant arrive sur Telegram

Vous pouvez désormais parler à l'assistant directement depuis Telegram,
comme à n'importe quel contact : posez vos questions sur le portefeuille,
le cash ou le passif depuis votre téléphone, sans ouvrir l'application.
Les actions d'écriture (créer une transaction, pointer, etc.) restent
protégées : l'assistant propose l'action et vous la validez d'un bouton
Confirmer ou Refuser, exactement comme dans l'app. Deux commandes
accompagnent le bot : « /new » pour repartir sur une conversation vierge
et « /org » pour changer de véhicule d'investissement. L'accès est
strictement réservé aux comptes liés par un code fourni par
l'administrateur. En coulisses, le coût des conversations avec
l'assistant a aussi été fortement optimisé (mise en cache du contexte).

> **🔧 Notes techniques**
>
> - `convex/telegram.ts` (nouveau) : webhook `/telegram/webhook` (secret
>   token vérifié en temps constant, ACK immédiat + worker schedulé),
>   table `telegramAccounts` (linking par code one-shot via le runbook CLI
>   `telegram:createLinkCode`, org courante + thread courant par compte),
>   tour d'agent non streamé (`chatAgent.generateText` + typing),
>   approbations en inline keyboard reprises via `promptMessageId` (même
>   contrat que `chat.respondToToolApproval`, cf. KNOWN_ISSUES).
> - Prompt caching Mistral (commit séparé) : `prompt_cache_key` injecté
>   par un `fetch` custom dans `createMistral` (`convex/agent.ts`,
>   `@ai-sdk/mistral` 3.0.37 n'a pas l'option) + `usageHandler` loggant
>   `llm_usage` (input/output/cacheRead) par appel LLM.
> - Setup one-time documenté dans le README « Telegram bot » ; checklist
>   TESTING « Bot Telegram » (T1–T12).

## v1.5.3 — 11/06/2026 à 17:07 — Notes techniques sur chaque nouveauté

Chaque mise à jour de cette page se termine désormais par un court encadré
« Notes techniques » qui résume, pour les développeurs (et les IA) qui
reprennent le code, ce qui a été fait sous le capot — y compris sur toutes
les mises à jour passées.

> **🔧 Notes techniques**
>
> - Rétrofit d'un blockquote « 🔧 Notes techniques » (synthèse façon
>   description de PR, reconstituée depuis les messages de commit) sur
>   toutes les entrées existantes de `CHANGELOG_PRODUIT.md`.
> - Règle pérennisée dans `CLAUDE.md` (pre-PR doc audit, question 5) :
>   toute nouvelle entrée doit porter la section ; en-tête du fichier et
>   ligne SH12 de `TESTING.md` mis à jour.
> - Format blockquote (pas `<details>`) : `/app/$orgSlug/changelog` rend
>   via react-markdown sans `rehype-raw`, le HTML brut serait ignoré.
>   Aucun changement de code.

## v1.5.2 — 11/06/2026 à 11:40 — Tableau de bord et pointage plus rapides

Le tableau de bord d'une organisation s'affiche désormais quasi
instantanément (il relisait tout l'historique bancaire à chaque ouverture),
et les tables de pointage chargent nettement plus vite. Pointer une
transaction ne fait plus recharger toute la page : chaque clic de la file
est maintenant immédiat. L'assistant répond aussi plus vite quand il
consulte la synthèse de l'organisation, et il sait maintenant dire
correctement quel moteur le propulse (Mistral Medium 3.5) quand on le lui
demande.

> **🔧 Notes techniques**
>
> - `getDashboard` et l'outil agent `getDashboardSummary` ne scannent plus
>   toutes les transactions de l'org : lectures par deal via l'index
>   `by_deal`.
> - `listUnmatched` / `listByStatus` : plus de `db.get` compte par ligne —
>   une Map des comptes de l'org chargée une fois.
> - Pointage : comboboxes branchées sur les nouvelles queries légères
>   `deals.listOptions` / `liabilities.listOptions` (zéro lecture de
>   transactions), au lieu de `deals.list` + `getLiabilities` qui se
>   réinvalidaient à chaque clic de pointage.
> - Prompt système : déclare l'id du modèle configuré (source unique
>   `MISTRAL_MODEL` lue dans `convex/lib/instructions.ts`) — interrogé,
>   l'agent répondait « Mistral Large 2 » faute de connaître son
>   déploiement.

## v1.5.1 — 11/06/2026 à 10:21 — Passage de l'assistant IA sur Mistral

L'assistant intégré (panneau ⌘J) tourne désormais sur Mistral Medium 3.5. Mêmes outils, mêmes conversations — seul le moteur de réponse change.

> **🔧 Notes techniques** — `@ai-sdk/anthropic` remplacé par
> `@ai-sdk/mistral` dans `convex/agent.ts` ; modèle par défaut
> `mistral-medium-3.5`, override via la variable d'env Convex
> `MISTRAL_MODEL`, clé dans `MISTRAL_API_KEY`. Wizards de setup, hints du
> smoke test et docs alignés.

## v1.5.0 — 11/06/2026 à 10:20 — L'assistant agit, vous validez d'un clic

### ✅ Confirmer une action en un clic

Quand l'assistant s'apprête à écrire quelque chose (créer un deal, pointer
une transaction, ajouter une valorisation…), il ne demande plus un « oui »
dans la conversation : un bloc **Confirmer / Refuser** apparaît directement
sous l'action proposée, avec les valeurs exactes qui seront enregistrées.
Rien ne s'écrit sans votre clic — c'est désormais garanti par l'application
elle-même, plus seulement par la consigne donnée à l'IA. Une demande
laissée en attente est automatiquement annulée si la conversation repart
sur autre chose, et l'historique garde la trace de ce qui a été confirmé
ou refusé.

### 📊 Des réponses qui se lisent d'un coup d'œil

Quand l'assistant consulte vos données, le résultat s'affiche désormais en
clair : tableau des participations (cliquable — chaque ligne ouvre la page
du deal), totaux et lignes des recherches de transactions, projection de
trésorerie mois par mois, passif groupé, valorisations. Le détail technique
reste disponible dans le bloc dépliable. Et sur les suggestions de
pointage, un bouton **« Pointer »** rattache la transaction immédiatement,
sans repasser par la conversation.

### 🧰 Un assistant qui couvre (presque) tout

L'assistant sait maintenant : résumer l'organisation (« où en est-on ? »),
donner la position de TVA, lister les documents d'une société, classer
plusieurs transactions d'un coup (une seule confirmation pour le lot),
gérer le prévisionnel de bout en bout (modifier ou supprimer une règle,
ajouter/modifier/annuler une échéance ponctuelle), corriger le passif et
détacher une transaction mal allouée, renommer un compte bancaire et
mettre à jour la fiche d'une société. Les suppressions importantes restent
volontairement réservées à l'application.

### 💡 Des suggestions qui suivent votre page

À l'ouverture d'une nouvelle conversation, les suggestions s'adaptent à
l'écran où vous êtes : sur le Pointage, l'assistant propose de pointer les
transactions en attente ; sur la Trésorerie, la position de cash et la
TVA ; sur le Passif, les comptes courants — et ainsi de suite.

### 📋 En préparation

La feuille de route de l'assistant (pièces jointes, brief proactif) et un
guide des bonnes pratiques rejoignent la documentation du projet.

> **🔧 Notes techniques**
>
> - Bump `@convex-dev/agent` 0.6.3 (support natif `needsApproval` /
>   `approveToolCall`) ; mutation publique `chat.respondToToolApproval`
>   (gardes org+thread, rate-limit `chatSend`, enregistrement de la
>   décision puis reprise du stream via `promptMessageId`).
> - `needsApproval: true` posé sur tous les outils d'écriture ; composant
>   ai-elements `Confirmation` branché sur les états de tool part
>   `approval-requested` / `responded` / `output-denied` ; libellés i18n
>   en/fr ; system prompt débarrassé de la confirmation conversationnelle.
> - 14 nouveaux outils (~41 au total) : `getDashboardSummary`,
>   `getVatPosition`, `listCompanyDocuments`, `bulkCategorizeTransactions`
>   (lot max 50, une seule approbation), forecast complet (update/delete
>   de règle, entrées manuelles/override/annulation), updates passif +
>   `deallocateTransaction`, `updateCompany`, `renameBankAccount` —
>   helpers métier existants réutilisés, suppressions hors agent (sauf
>   `deleteForecastRule`).
> - Rendu riche des résultats d'outils : 7 renderers (deals, transactions,
>   suggestions de pointage, forecast, passif, valorisations) avec liens
>   profonds vers les pages et bouton « Pointer » direct (mutation
>   publique, sans repasser par le modèle) ; fallback JSON conservé.
> - Suggestions de l'état vide contextuelles à la route courante. Docs :
>   `KNOWN_ISSUES.md` « Approbation d'outils », TESTING C27–C30.

---

## v1.4.0 — 11/06/2026 à 15:05 — Toutes les listes paginées, entrée dans l'app plus directe

### 📄 Des listes qui restent fluides partout

Après la page Pointage, toutes les grandes listes passent en pages de 50
lignes : les participations (vue par organisation et vue « Tout »), les
transactions d'un deal et celles d'un compte bancaire. Comme sur le
Pointage, la recherche, le tri, les totaux et l'export CSV continuent de
porter sur l'ensemble des données, pas seulement la page affichée.

### ⚡ Fini le « redirection… puis chargement… » à l'ouverture

L'app vous amène désormais directement sur votre dernière organisation, en
une seule étape : la redirection se décide immédiatement, avant même le
chargement de vos données. Sur un nouvel appareil, l'app retrouve votre
dernière organisation comme avant.

> **🔧 Notes techniques**
>
> - `usePagination` / `PaginationFooter` extraits dans
>   `src/components/data-table/LocalPagination.tsx` et appliqués aux
>   tables qui grossissent avec l'usage : participations (vue par-org +
>   vue agrégée `/app/all`), transactions d'un deal, transactions d'un
>   compte bancaire. Recherche, tri, totaux, export CSV et Versé/Reçu
>   opèrent toujours sur la liste complète ; les tables bornées par nature
>   (membres, comptes, passif, règles forecast, admin) restent sans
>   pagination.
> - `/` redirige vers `/app` en `beforeLoad` (307 serveur, plus d'écran
>   « redirecting » hydraté) ; `/app` redirige vers la dernière org via le
>   cookie `last_org_slug` (lecture isomorphe, `src/lib/lastOrg.ts`), sans
>   attendre l'auth Convex ; fallback `users.lastOrgSlug`. Le layout d'org
>   écrit le cookie à chaque visite et l'efface avant de bouncer un
>   non-membre (anti-boucle). Smoke test adapté aux 307 attendus.

---

## v1.3.4 — 11/06/2026 à 15:00 — Infrastructure de mise à jour des skills agents durcie

Les skills agents (instructions données à l'IA pour utiliser les librairies du projet) sont désormais épinglés à un commit immuable plutôt qu'à une branche mouvante. La source de la skill TanStack Start passe du repo communautaire `deckardger` vers le monorepo officiel TanStack. Une nouvelle commande (`sync:skills:update`) permet de faire des bumps délibérés et reviewables, distincts du simple vendoring reproductible.

> **🔧 Notes techniques**
>
> - `skills-lock.json` : deux refs par skill — `trackingRef` (branche
>   surveillée pour la dérive) et `pinnedRef` (SHA immuable réellement
>   vendorisé). Les bumps deviennent délibérés et diffables.
> - `scripts/sync-skills.mjs` : mode `--update` qui résout le tip du
>   `trackingRef` via l'API GitHub et avance le `pinnedRef` ; `--check`
>   compare au tip sans toucher le pin. La GitHub Action hebdo passe sur
>   `sync:skills:update`.
> - `tanstack-start-best-practices` re-sourcée de
>   `deckardger/tanstack-agent-skills` vers `TanStack/router`
>   (first-party, versionnée avec les releases de
>   `@tanstack/react-start`).

---

## v1.3.3 — 11/06/2026 à 09:46 — Nettoyage interne

Harmonisation interne du code (commentaires unifiés en anglais). Aucun
changement visible dans l'app.

> **🔧 Notes techniques** — sweep commentaires uniquement sur 85 fichiers
> (`src/`, `convex/`, `tests/`, `scripts/`) : tous les commentaires
> français (`//`, `/* */`, JSDoc, JSX, CSS) passent en anglais. Chaînes
> i18n, templates email, prompts agent et seeds intacts. Règle ajoutée aux
> anti-patterns de `CLAUDE.md`.

---

## v1.3.2 — 11/06/2026 à 01:10 — Nettoyage après la réindexation

Retrait de l'étape technique ponctuelle qui a réindexé l'historique des
transactions lors de la mise à jour précédente. Aucun changement visible
dans l'app.

> **🔧 Notes techniques** — `build:vercel` revient à `convex deploy` seul,
> les backfills one-shot de la v1.3.1 ayant tourné au déploiement (logs
> Vercel : `backfillSearchText` 1278 lignes mises à jour,
> `backfillMatchStatus` rien à reprendre).

---

## v1.3.1 — 11/06/2026 à 00:50 — La recherche retrouve les transactions historiques

Chercher « Antese » dans les transactions pouvait ne rien renvoyer alors que
les lignes existaient bel et bien : les transactions importées avant
l'arrivée de la recherche (historique Mémo Bank, premières synchros
bancaires) n'étaient pas indexées — ni pour la barre de recherche, ni pour
l'assistant. C'est corrigé : l'historique complet redevient cherchable, et
les lignes de l'import Mémo Bank apparaissent désormais correctement dans la
file de pointage.

> **🔧 Notes techniques**
>
> - Cause : les transactions écrites avant l'arrivée du champ dérivé
>   `searchText` (import CSV Mémo Bank, premières syncs Powens) n'étaient
>   indexées ni pour la recherche UI ni pour l'outil agent.
> - `importMemoCsvTransactions` pose désormais `matchStatus: 'unmatched'`
>   à l'insert (sinon les lignes manquaient aussi à la file de pointage).
> - Backfills internes `backfillSearchText` / `backfillMatchStatus`
>   (arg `{}` = toutes les orgs), exécutés une fois au déploiement via
>   `build:vercel` (étape temporaire retirée en v1.3.2). Docs :
>   `KNOWN_ISSUES.md`, `MIGRATIONS.md`.

---

## v1.3.0 — 11/06/2026 à 00:20 — Page Pointage fluide même avec beaucoup de transactions

La page Pointage affiche désormais ses transactions par pages de 50 lignes
(boutons Précédent / Suivant sous le tableau), au lieu de tout dérouler d'un
bloc. Fini les ralentissements quand la file ou un onglet contient des
centaines de lignes. Rien ne change pour le reste : le compteur « N à
pointer », la recherche, les onglets et la sélection multiple continuent de
porter sur l'ensemble des transactions, pas seulement la page affichée.

> **🔧 Notes techniques** — pagination purement côté rendu (50 lignes par
> page) sur les tables de la page Pointage ; les queries Convex sont
> inchangées : compteur, sélection bulk et sa purge, recherche et onglets
> opèrent toujours sur la liste complète (filtrage serveur en amont).
> Changement de recherche/onglet ramène à la page 1 ; la page courante se
> borne quand la liste rétrécit.

---

## v1.2.1 — 11/06/2026 à 00:10 — Fondations remises à neuf

Les briques techniques de navigation et de connexion passent sur leurs
dernières versions corrigées, jusqu'ici gelées à cause de défauts en amont.
Aucun changement visible dans l'app.

> **🔧 Notes techniques** — retrait des `pnpm.overrides` : TanStack résout
> de nouveau un `router-core` unique (1.171.13, le typage
> `server.handlers` tient sans pin) et better-auth 1.6.16 épingle
> better-call 1.3.6 (`openapi.mjs`/`validator.mjs` restaurés). Règle de
> gel Renovate et section `KNOWN_ISSUES.md` correspondante supprimées.
> Vérifié : lint, 70/70 tests unitaires, build.

---

## v1.2.0 — 10/06/2026 à 23:35 — Un assistant qui se manie comme les grands

### 💬 Une vraie zone de saisie

La zone de saisie de l'assistant passe en **multiligne** : Entrée envoie,
**Maj+Entrée** va à la ligne, et le champ **grandit avec votre texte** — fini
le message long invisible dans une ligne unique. Pendant que l'assistant
répond, le bouton d'envoi devient un **bouton stop**.

### ✨ Une conversation plus fluide

Le fil **suit la réponse en cours d'écriture** ; si vous remontez relire un
passage, il vous laisse tranquille et un bouton permet de **revenir en bas**
d'un clic. Une nouvelle conversation propose des **suggestions de départ**
(position de cash, passif, projection, valorisations), et quand l'assistant
consulte vos données, son travail s'affiche dans un **bloc dépliable** —
statut, demande, résultat.

### ⌨️ Au clavier

**⌘J / Ctrl+J** ouvre et ferme le panneau de l'assistant, prêt à taper.

> **🔧 Notes techniques**
>
> - Rendu maison du panneau (input mono-ligne, scroll manuel,
>   react-markdown) remplacé par les composants Vercel AI Elements
>   vendorés dans `src/components/ai-elements/` (registry 403 depuis le
>   réseau restreint → sources GitHub, imports réécrits).
> - `PromptInput` : textarea auto-grow (cap ~12rem), garde IME, stop
>   intégré au bouton d'envoi ; `Conversation` stick-to-bottom ; markdown
>   streaming via `streamdown` (plugins Shiki/KaTeX/Mermaid trimés,
>   `@source` Tailwind v4 dans `app.css`) ; tool calls en blocs dépliables
>   (labels i18n) ; suggestions métier sur l'état vide ; ⌘J/Ctrl+J toggle
>   - focus du composer.
> - Threads/rename/delete et toute la couche Convex (`sendMessage`,
>   `stopStream`, `useUIMessages`) inchangés. Skill `ai-elements` ajoutée
>   à `skills-lock.json` ; trims documentés dans `KNOWN_ISSUES.md`
>   « Streamdown ».

---

## v1.1.1 — 10/06/2026 à 23:30 — Ménage des branches de travail

Un nettoyage à la demande supprime les anciennes branches de travail déjà
intégrées. Aucun changement visible dans l'app.

> **🔧 Notes techniques** — workflow GitHub Actions à déclenchement manuel
> qui supprime les branches dont la PR est mergée (35+ branches `claude/*`
> accumulées : les sessions ne peuvent pas supprimer leurs refs via le
> proxy git). PRs ouvertes et branches sans PR préservées.

---

## v1.1.0 — 10/06/2026 à 22:58 — La TVA récupérable, suivie au plus près

Un vrai suivi de TVA fait son entrée pour fiabiliser les charges réelles :

- **Un taux de TVA sur chaque charge et produit.** Quand vous classez une
  transaction en charge, elle part avec 20 % de TVA par défaut — ajustable
  ligne à ligne (0 %, 5,5 %, 10 %, 20 %) dans les onglets Charges et
  Produits du pointage. Les transactions déjà classées sont marquées
  « à qualifier » : à vous de poser le bon taux (les salaires, assurances et
  frais bancaires n'ont pas de TVA — pas de calcul global trompeur).
- **Une carte « TVA récupérable » sur la page Trésorerie** : la TVA
  déductible de vos charges moins la TVA collectée sur vos produits, avec le
  nombre de transactions restant à qualifier. De quoi savoir où en est votre
  créance de TVA pour le prévisionnel.
- **L'assistant sait maintenant chercher dans toutes les transactions.**
  « Combien a-t-on payé à Antese au total ? » : il retrouve tous les
  paiements d'un fournisseur (rapprochés ou non) et répond avec les totaux —
  TTC, et TVA incluse quand les lignes sont qualifiées.
- **Le vert et le rouge partout.** Les badges Entrée/Sortie des deals et
  Créance/Dette du passif passent en couleur, les entrées oubliées en noir
  (dashboard, prévisionnel) passent au vert — le sens d'un mouvement se lit
  désormais d'un coup d'œil sur toutes les pages.

> **🔧 Notes techniques**
>
> - Taux de TVA par transaction (basis points : 0/550/1000/2000), défaut
>   20 % à la catégorisation en charge ; la TVA est toujours dérivée du
>   TTC, jamais stockée. Carte « TVA récupérable » (déductible −
>   collectée + compteur « à qualifier ») sur la page Trésorerie.
> - Agent : nouvel outil `searchTransactions` (tous statuts, totaux
>   pré-agrégés TTC + TVA) ; `categorizeTransaction` accepte le taux de
>   TVA.
> - UI : token `--positive` + helpers `moneyTone`, badges Entrée/Sortie et
>   Créance/Dette teintés, verts manquants ajoutés (dashboard,
>   prévisionnel, plan vs réel, delta KPI).

---

## v1.0.3 — 10/06/2026 à 22:38 — Nettoyage de l'outillage interne

Suppression d'un automatisme de publication qui n'avait jamais fonctionné.
Aucun changement visible dans l'app.

> **🔧 Notes techniques** — retrait du workflow release-please (47/47 runs
> en échec : un réglage d'organisation GitHub bloque la création de PR par
> Actions) et nettoyage de ses mentions dans `CLAUDE.md`, `README.md` et
> `KNOWN_ISSUES.md`. Le versionnage produit vit dans ce fichier.

---

## v1.0.2 — 10/06/2026 à 22:36 — Retouches visuelles du menu latéral

Trois finitions sur l'habillage de l'app : le petit trait vertical à côté
du bouton d'ouverture du menu reprend sa hauteur discrète (il ne barrait
plus toute la barre du haut), le logo de l'organisation s'affiche sans
liseré parasite, et le logo comme la photo de profil gardent leurs
proportions quand le menu est replié en mode icônes.

> **🔧 Notes techniques** — bump `tailwind-merge` v3 pour que les classes
> Tailwind v4 à `!` final (`p-0!`, `p-2!`) se dédupliquent correctement
> (le clipping des boutons de la sidebar repliée venait de là) ; hauteur
> du séparateur du header via le variant `data-[orientation=vertical]` ;
> `bg-sidebar-primary` peint uniquement derrière le fallback du switcher
> d'org, pour que les logos uploadés s'affichent sans halo.

---

## v1.0.1 — 10/06/2026 à 22:13 — Le changelog passe au suivi par version

Chaque évolution porte désormais un numéro de version et la date et l'heure
de sa mise en ligne — cette page devient l'historique précis de l'outil.

> **🔧 Notes techniques** — la question 5 du pre-PR doc audit
> (`CLAUDE.md`) devient inconditionnelle : chaque PR ajoute une entrée
> `## vX.Y.Z — JJ/MM/AAAA à HH:MM — titre` en tête de ce fichier (minor =
> feature visible, patch = fix/technique ; heure d'ouverture de la PR,
> Europe/Paris).

---

## v1.0.0 — 10/06/2026 à 21:58 — Les entrées en vert

Dans toutes les vues de transactions (pointage, comptes bancaires, passif),
les **entrées d'argent s'affichent en vert** — les sorties restent en rouge.
Le sens d'un mouvement se lit d'un coup d'œil.

> **🔧 Notes techniques** — `text-foreground` → `text-emerald-600` pour
> les transactions `direction === 'in'` dans `PointageTable`,
> `TransactionSheet`, la page de compte bancaire et `PassifTables` (les
> sorties restent en `text-destructive`).

---

## Juin 2026 — La finition qui change tout

### 💶 Le passé et le futur sur la même courbe

La courbe de trésorerie montre désormais **le solde réel des 6 derniers
mois** (trait plein) qui se prolonge en **solde projeté** (pointillé) — on
voit d'un coup d'œil d'où l'on vient et où l'on va, sans rupture.

### 📐 Le TVPI partout

La table des participations affiche le **TVPI de chaque société et de
chaque deal** — le multiple qui répond à « pour 1 € investi, combien
j'en ai aujourd'hui ? » (l'argent déjà revenu + ce que la participation
vaut encore). Et toutes les colonnes se **trient d'un clic**.

### 📤 Export Excel

Un bouton **Exporter CSV** sur les participations : la liste filtrée part
dans Excel, prête à retravailler.

### ✏️ Le passif s'édite enfin

Les positions de capital et les comptes courants se **modifient et se
suppriment** directement depuis la page Passif. Garde-fou : une ligne sur
laquelle des transactions sont encore pointées ne peut pas être supprimée —
on détache d'abord, on supprime ensuite.

> **🔧 Notes techniques**
>
> - Passif : mutations update/delete sur `equityPositions` et
>   `intercompanyLoans` ; suppression refusée si des transactions sont
>   encore allouées dessus (`has_allocations`) ; dialogs de création
>   réutilisés en édition.
> - Trésorerie : `getForecastBalance(historyMonths)` reconstruit le solde
>   réel de fin de mois à rebours (`buildMonthlyHistory`, fonction pure
>   testée) ; la courbe fusionne réel (trait plein) et projeté (pointillé)
>   avec jonction au solde courant.
> - Participations : TVPI par deal et par société (dernière valo, fallback
>   coût, 0 si sorti — convention dashboard), tri client sur toutes les
>   colonnes, export CSV (`;` + BOM UTF-8 pour Excel FR) des deals
>   filtrés.
> - Legacy : `seed:purgeLegacyForecasts` + création de `MIGRATIONS.md`
>   (index des opérations data prod, runbook de retrait de la table
>   `forecasts`).

---

## Juin 2026 — Le pilotage en un coup d'œil

### 📊 Un vrai tableau de bord

La page d'accueil de chaque organisation affiche enfin l'essentiel :
**participations actives, capital déployé, distribué, trésorerie, NAV
estimée et TVPI** — calculés en temps réel depuis vos données (NAV = ce
que vaut le portefeuille aujourd'hui ; TVPI = le multiple sur le capital
investi). S'y ajoutent
la répartition du capital par type d'instrument et l'activité bancaire
récente.

### 📉 La trésorerie se projette

Sur la page Trésorerie, une **courbe du solde projeté** (6, 12 ou 24 mois)
part de vos soldes bancaires réels et déroule vos flux récurrents : loyers,
salaires, échéances… Créez et gérez ces **règles récurrentes** directement
sur la page (ou via l'assistant) — la projection se recalcule à chaque
modification, et un passage sous zéro se voit immédiatement.

> **🔧 Notes techniques**
>
> - `convex/dashboard.ts:getDashboard` : participations actives (cibles
>   distinctes), déployé/distribué (Σ des transactions pointées par deal),
>   trésorerie (Σ des soldes EUR réels), NAV estimée (dernière valo par
>   deal, fallback versé + flag `navIsPartial`), répartition par
>   instrument, activité récente.
> - `/app/$orgSlug` : le redirect placeholder devient un vrai dashboard
>   (6 cartes KPI, barres de répartition, activité récente) ; entrée
>   sidebar Dashboard activée.
> - `/app/$orgSlug/cash` : courbe du solde projeté (recharts client-only,
>   ligne de référence 0 si négatif), horizon 6/12/24 mois, CRUD des
>   règles récurrentes avec `expandRules` automatique post-save
>   (idempotent par `derivedKey`) ; `forecasts.listRules` + `deleteRule`
>   (conserve les entrées réalisées/annulées/éditées).

---

## Juin 2026 — Chaque projet a enfin sa vue

Tous les investissements ne se suivent pas pareil. Les pages de deal et de
société s'adaptent maintenant au type de projet.

### 📈 Royalties : le BP face à la réalité

- Saisissez le **business plan initial** (et ses révisions) en le collant
  simplement dans l'assistant — il structure les lignes pour vous.
- La page du deal affiche la **courbe BP initial vs BP révisé vs réalisé**
  (le réalisé vient automatiquement des transactions pointées) et le tableau
  des périodes avec l'écart cumulé, en rouge quand on est en retard sur le
  plan.

### 🏦 Fonds : appelé, distribué, performance

- Les deals de type fonds affichent **Engagé / Appelé / Distribué / DPI /
  TVPI** d'un coup d'œil (appelé = ce que le fonds a réellement demandé ;
  DPI = la part déjà rendue en cash), avec l'historique des valorisations.

### 🏢 Sociétés : reportings et KPIs au même endroit

- **Déposez les reportings** (investor updates, BP, juridique) directement
  sur la page de la société : classés, datés, téléchargeables.
- **Les KPIs s'historisent** : collez un reporting dans l'assistant, il en
  extrait les métriques (ARR, cash, effectifs… et NAV/TVPI pour les fonds) —
  vous confirmez, c'est enregistré.

> **🔧 Notes techniques**
>
> - Schéma : `dealProjections` (BP en lignes datées, versions `initial`
>   figée au closing / `revised` actualisée, unicité (deal, version,
>   période) enforcée par la mutation `replaceVersion`, delete + insert
>   idempotent) ; `documents` (reportings par société, storage Convex
>   20 Mo, source upload) ; `kpiSnapshots` (table existante enfin exposée
>   UI + agent).
> - Backend : `convex/projections.ts`, `convex/kpis.ts`,
>   `convex/documents.ts` (queries/mutations publiques + variantes agent
>   qui re-vérifient l'appartenance) ; outils agent dans
>   `agentToolsProjections.ts` (lister/poser un BP, lister/créer des
>   snapshots KPI).
> - Front : page deal — sections « BP vs réalisé » (recharts client-only,
>   réalisé issu des transactions pointées, écart cumulé vs BP révisé avec
>   fallback initial) et « Fonds » (Engagé/Appelé/Distribué/DPI/TVPI +
>   historique des valos) ; page société — sections KPIs et Reportings &
>   documents ; séries cumulées pures dans `src/lib/projectionSeries.ts`
>   (testées).

## Juin 2026 — L'assistant devient copilote

**En une phrase** : Albo OS passe en AI-first — l'assistant n'est plus un
gadget caché derrière un bouton, c'est un copilote toujours présent à côté de
l'écran, capable de lire **et d'agir** sur tout le portefeuille, jusqu'à
pré-pointer les transactions bancaires.

### ✨ L'assistant, toujours à vos côtés

- **Un panneau dédié, toujours ouvert.** Le chat vit à droite de l'écran et
  vous suit de page en page — la conversation ne se ferme plus jamais toute
  seule. Repliez-le d'un clic, il s'en souvient à votre prochaine visite.
- **Il sait où vous êtes.** Une question posée depuis la page Pointage ou
  Trésorerie est comprise dans son contexte.
- **Des conversations qui se gèrent.** Historique complet, reprise
  automatique de la dernière discussion, renommage, suppression, titre
  automatique.
- **Des réponses enfin lisibles.** Tableaux et listes mis en forme, bouton
  copier, bouton stop, et les actions de l'assistant visibles en temps réel.

### 🤝 Il ne fait plus que répondre — il travaille

- **Pointage intelligent** ⭐ — « suggère-moi des rattachements » : il analyse
  les pointages passés et propose pour chaque transaction en attente le deal
  ou le compte le plus probable, preuves à l'appui. Vous confirmez, il
  pointe. Rien n'est jamais écrit sans votre accord.
- **Prévisionnel de trésorerie** — créer une règle (« loyer de 1 500 € chaque
  5 du mois ») et demander la projection de cash sur 12 mois, directement
  dans la conversation.
- **Valorisations** — « ajoute une valo de 1,2 M€ sur ce deal au 31/12 » :
  enregistré, l'historique se construit.
- **Passif** — consulter capitaux propres et comptes courants inter-entités
  (soldes calculés en temps réel), en créer de nouveaux.
- Toujours là : création de sociétés, deals, comptes et transactions — chaque
  organisation reste strictement cloisonnée.

### 📰 Et ce changelog

- **Les nouveautés, dans l'app.** Cette page « Nouveautés » est accessible en
  bas du menu — chaque release y laisse sa trace, en clair.

### 🛡️ Sous le capot

- Qualité verrouillée : chaque modification passe une batterie complète de
  vérifications automatiques avant déploiement.
- Fiabilité renforcée du pointage : interface et assistant partagent
  exactement les mêmes règles métier.

> **🔧 Notes techniques**
>
> - `AiPanel` persistant dans le layout org (400px desktop, overlay
>   mobile, état en cookie `ai_panel_state` — pattern `sidebar_state`)
>   remplace le slide-over ; threads list/rename/delete + reprise auto du
>   plus récent ; stop via `abortStream` ; contexte de page injecté en
>   system prompt par message (`buildInstructions`,
>   `convex/lib/instructions.ts`, pur + testé) ; titre auto au premier
>   message.
> - Cœur du pointage extrait dans `convex/lib/pointage.ts` (invariants
>   matched ⟺ deal ∨ allocation, miroir `reconciled`, log append-only
>   `matchingDecisions`) — partagé entre mutations publiques et outils
>   agent, zéro divergence de règles.
> - Outils agent par domaine (`agentToolsPointage.ts` puis passif /
>   forecast / valuations, ~23 outils) avec scope key `${orgId}:${userId}`
>   re-vérifiée à chaque appel ; ranking pur des suggestions de pointage
>   dans `convex/lib/suggest.ts` (similarité de libellés + décisions
>   passées + Δ montant vs engagé, testé).
> - CI : job lint → tests unitaires → build + job séparé de dérive des
>   skills ; enum instruments dédupliquée dans
>   `convex/lib/instruments.ts`.
> - Page « Nouveautés » : `/app/$orgSlug/changelog` rend ce fichier via
>   import `?raw` (react-markdown + remark-gfm), lien sidebar.

---

## Petit lexique

- **Pointage** : rattacher une transaction bancaire à ce qu'elle paie ou
  rembourse (un deal, une position de capital, un compte courant). C'est ce
  qui permet de calculer « Versé » et « Reçu » automatiquement, sans saisie.
- **BP (business plan)** : les flux prévus d'un projet, période par période.
  « BP révisé » = la version corrigée quand la réalité a dévié du plan.
- **NAV** : ce que vaut le portefeuille aujourd'hui, d'après les dernières
  valorisations connues (à défaut, le montant investi).
- **TVPI** : (argent déjà récupéré + valeur restante) ÷ argent investi.
  1,50× = pour 1 € mis, 1,50 € de valeur créée.
- **DPI** : pareil, mais en ne comptant que le cash déjà rendu —
  argent récupéré ÷ argent investi.
- **Engagé / Appelé** (fonds) : le montant promis au fonds / la part que le
  fonds a effectivement demandée à ce jour.
- **C/C (compte courant d'associé)** : argent avancé entre deux entités du
  groupe. Son solde n'est jamais saisi à la main : il est calculé depuis les
  transactions pointées dessus.
