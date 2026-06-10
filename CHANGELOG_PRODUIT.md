# Nouveautés

<!--
  Trace en prose des évolutions, une entrée versionnée par PR
  (`## vX.Y.Z — JJ/MM/AAAA à HH:MM — titre`), du plus récent au plus
  ancien. Langage produit, pas technique (pas de chemins de fichiers ni de
  noms de fonctions) — ce fichier est rendu tel quel dans l'app sur
  /app/$orgSlug/changelog (import ?raw).

  Règle d'alimentation : CLAUDE.md § « Pre-PR doc audit » (question 5).
-->

Ce que chaque mise à jour change pour vous, en clair — du plus récent au
plus ancien. Les termes financiers sont expliqués dans le petit lexique en
bas de page.

---

## v1.3.0 — 11/06/2026 à 00:20 — Page Pointage fluide même avec beaucoup de transactions

La page Pointage affiche désormais ses transactions par pages de 50 lignes
(boutons Précédent / Suivant sous le tableau), au lieu de tout dérouler d'un
bloc. Fini les ralentissements quand la file ou un onglet contient des
centaines de lignes. Rien ne change pour le reste : le compteur « N à
pointer », la recherche, les onglets et la sélection multiple continuent de
porter sur l'ensemble des transactions, pas seulement la page affichée.

---

## v1.2.1 — 11/06/2026 à 00:10 — Fondations remises à neuf

Les briques techniques de navigation et de connexion passent sur leurs
dernières versions corrigées, jusqu'ici gelées à cause de défauts en amont.
Aucun changement visible dans l'app.

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

---

## v1.1.1 — 10/06/2026 à 23:30 — Ménage des branches de travail

Un nettoyage à la demande supprime les anciennes branches de travail déjà
intégrées. Aucun changement visible dans l'app.

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

---

## v1.0.3 — 10/06/2026 à 22:38 — Nettoyage de l'outillage interne

Suppression d'un automatisme de publication qui n'avait jamais fonctionné.
Aucun changement visible dans l'app.

---

## v1.0.2 — 10/06/2026 à 22:36 — Retouches visuelles du menu latéral

Trois finitions sur l'habillage de l'app : le petit trait vertical à côté
du bouton d'ouverture du menu reprend sa hauteur discrète (il ne barrait
plus toute la barre du haut), le logo de l'organisation s'affiche sans
liseré parasite, et le logo comme la photo de profil gardent leurs
proportions quand le menu est replié en mode icônes.

---

## v1.0.1 — 10/06/2026 à 22:13 — Le changelog passe au suivi par version

Chaque évolution porte désormais un numéro de version et la date et l'heure
de sa mise en ligne — cette page devient l'historique précis de l'outil.

---

## v1.0.0 — 10/06/2026 à 21:58 — Les entrées en vert

Dans toutes les vues de transactions (pointage, comptes bancaires, passif),
les **entrées d'argent s'affichent en vert** — les sorties restent en rouge.
Le sens d'un mouvement se lit d'un coup d'œil.

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
