# Dette bancaire et garanties

## À quoi ça sert

Albo OS savait dire ce que le groupe possède. Il sait maintenant dire ce
qu'il **doit**, à qui, jusqu'à quand — et ce qui a été **mis en gage** pour
l'obtenir.

Deux questions n'avaient aucune réponse dans l'application :

- **Combien cette société doit-elle encore ?** Le capital restant dû de
  chaque prêt vivait dans des tableaux d'amortissement PDF.
- **Qu'est-ce qui est gagé, et à quelle hauteur ?** Un même contrat de
  capitalisation peut garantir trois emprunteurs différents. Personne ne
  savait, sans ressortir les actes, combien il restait de marge disponible.

Tout vit dans la page [Passif](10-passif.md) de chaque société, à côté des
capitaux propres et des comptes courants.

## La dette bancaire

Le bloc **Dette bancaire** ouvre la page Passif. Une ligne par prêt : son
libellé, son prêteur, son taux courant, son échéance finale, et le capital
restant dû.

Un seul montant par ligne, et d'une seule nature : la colonne de droite ne
contient que du restant dû. Un montant gagé n'y figure pas — la ligne porte
un badge, et le détail vit sur la fiche du prêt. Empiler deux natures de
montant dans la même colonne inviterait à les comparer alors qu'elles ne se
comparent pas.

Chaque section porte son propre total, et **il n'y a pas de total global** :
le capital n'est pas exigible. Un chiffre qui l'additionnerait à la dette
serait faux.

### Saisir un prêt

Ce qui se saisit, ce sont les **conditions du contrat** — jamais le résultat
du calcul. Le libellé, le prêteur, le montant emprunté, la date de
signature, la première échéance, la durée, le taux à la signature, la
périodicité (mensuelle ou trimestrielle), l'assurance emprunteur, le différé
éventuel, et le compte de prélèvement.

Le formulaire se réorganise autour du **type d'amortissement** :

| Type | Ce qu'on paie | Restant dû |
|---|---|---|
| **Annuité constante** | Mensualité fixe, part de capital croissante | Calculé |
| **Capital constant** | Capital fixe, mensualité décroissante | Calculé |
| **In fine** | Intérêts seuls, puis tout le capital à l'échéance | Le capital emprunté, jusqu'au terme |
| **Révolving** | Intérêts sur l'encours, pas d'échéancier | L'encours, saisi |

Le **différé** existe en deux natures, à ne pas confondre : *partiel*, on
paie les intérêts et le capital reste au montant emprunté ; *total*, on ne
paie rien et les intérêts se capitalisent — l'amortissement démarre alors
**au-dessus** du montant emprunté.

Dans tous les cas, le différé doit être **plus court que la durée du prêt**,
in fine compris. Un différé qui couvre toute la durée ne laisserait rien à
amortir : sur un in fine, il ferait disparaître le ballon de capital — de la
fiche comme du prévisionnel. La saisie le refuse.

### Le crédit révolving, la seule exception

Un révolving n'a ni durée ni échéancier. Son encours est donc **saisi à la
main**, et corrigé à la main. C'est la seule ligne du module où un restant
dû se saisit plutôt que se dérive — limitation assumée, pas un oubli. Sa
fiche affiche l'encours, le plafond autorisé et la marge de tirage restante.

## La fiche d'un prêt

En tête, les chiffres clés en ligne : emprunté, restant dû, type, taux
courant, mensualité, assurance. Puis les garanties, la série de taux (sur un
prêt variable seulement), l'échéancier, les transactions rattachées et les
documents.

### L'échéancier

Chaque échéance affiche sa date, sa mensualité, la part de capital, la part
d'intérêts, l'assurance, le restant dû après paiement, et le **réel**.

Trois états se lisent d'un coup d'œil : une échéance **à venir** est
estompée ; une échéance **échue sans prélèvement rattaché** est ambrée — une
attente, pas une faute, le rouge reste réservé à ce qui va mal ; une
échéance **pointée** affiche en vert le montant réellement débité.

Le réel ne vaut pas la mensualité du plan, et c'est normal : il inclut
l'assurance, qui est hors mensualité. Les deux colonnes coexistent
précisément pour éviter de « corriger » un chiffre juste.

C'est aussi pourquoi elles ne s'affichent pas avec la même précision : **les
colonnes du plan sont arrondies à l'euro, le réel est au centime**. Le plan
est un calcul, le réel est un relevé bancaire. Mettre des centimes partout
donnerait à la mensualité théorique une précision qu'elle n'a pas, et
inviterait à comparer les deux chiffres au centime près alors qu'ils ne
mesurent pas la même chose.

Sur un **in fine**, la dernière ligne porte le ballon de capital, mise en
évidence. Sur un **prêt à taux variable**, les échéances postérieures à la
dernière révision constatée sont marquées **projetées** : l'application ne
prétend pas connaître le taux de 2029.

### Le taux d'un prêt variable

Un prêt à taux fixe n'a **rien** à saisir ici — la section n'apparaît même
pas. Un prêt variable porte une série datée de paliers, de deux natures :

- **Constaté** — une révision qui a eu lieu : « depuis le 01/07/2026,
  3,40 % ».
- **Projeté** — une hypothèse de pilotage : « à partir de 2028, tabler sur
  3,80 % ».

Le taux appliqué à une date est celui du dernier palier dont la date d'effet
est passée. Ajouter un palier recalcule l'échéancier et le prévisionnel.

### Corriger un prêt, ou l'amender

Le menu **⋯** porte **deux** gestes, et la différence est tout le sujet :
l'application ne peut pas deviner si un chiffre qui change est une faute de
frappe ou une renégociation. C'est vous qui le dites.

| Geste | Ce qu'il fait du passé |
|---|---|
| **Corriger** | L'**écrase**. Les conditions sont remplacées comme si les anciennes n'avaient jamais existé, et tout l'échéancier est recalculé. Pour une faute de saisie. |
| **Mettre à jour au…** | Le **conserve**. Les échéances déjà passées ne bougent pas ; les nouvelles conditions s'appliquent au capital restant, à partir de la date d'effet. Pour un avenant. |

Dans le second cas, seul ce qui change se saisit : un champ laissé vide
reste inchangé. Une renégociation qui ne touche que le taux, c'est un seul
nombre à taper. Si la banque a **recalculé** le capital restant dû à la date
d'effet, son chiffre peut être saisi et prend le pas sur celui que
l'application dériverait ; sinon elle le dérive elle-même.

Les avenants apparaissent alors dans une section dédiée de la fiche, la plus
récente en tête, avec ce que chacun a changé. La section n'existe pas tant
qu'il n'y a pas d'avenant.

⚠️ Réviser un taux variable n'est **ni** une correction **ni** un avenant :
cela passe par un palier. Le contrat prévoit la révision — il n'est pas
renégocié.

⚠️ Un crédit révolving n'a pas d'échéancier à segmenter : il n'est pas
amendable, ses conditions se corrigent en place.

## Les garanties

Une garantie porte **trois informations indépendantes**, et c'est ce qui la
rend lisible de trois côtés :

- **Sa forme** — nantissement, hypothèque, privilège de prêteur de deniers
  (PPD), caution, garantie d'organisme.
- **Son assiette** — l'actif sur lequel elle porte : un placement, un **bien
  immobilier**, les titres d'une société, ou rien de chez nous (une garantie
  Saccef, l'actif d'un tiers).
- **Son garant** — une société du groupe, un garant externe désigné par un
  libellé, ou personne de renseigné (les actes sont souvent muets sur ce
  point).

Un champ unique ne saurait pas dire « caution de CALTE sur ses propres
titres ».

### La même garantie, lue de trois côtés

Une garantie est saisie **une seule fois** et se lit :

- **depuis le prêt** qu'elle couvre — « garanti par un nantissement du
  contrat Concerto Capi » ;
- **depuis l'actif** qu'elle grève — « ce contrat est gagé au profit de SCI
  Chapelle » ;
- **depuis la société garante** — « je me suis porté caution pour RDB ».

Rien n'est stocké deux fois, donc rien ne peut diverger. Et la lecture
traverse les sociétés : un contrat détenu par CALTE peut garantir un prêt
d'une SCI, les deux espaces montrent la même ligne.

### La marge disponible sur un actif gagé

C'est la question qui portait toute la valeur du module, et à laquelle il
fallait ressortir les actes pour répondre. Sur la fiche d'un placement, un
bloc **Nantissements sur ce contrat** affiche trois chiffres : la valeur
actuelle, le total gagé, la marge disponible.

Trois précautions qui expliquent des chiffres parfois surprenants :

1. **Les garanties non chiffrées sont exclues du total** et listées à part.
   Une caution illimitée ne s'additionne pas ; l'afficher comme 0 mentirait.
2. **Le montant gagé n'est pas la valeur de l'actif** — c'est le montant
   inscrit à l'acte, et il peut la dépasser. Une marge négative est une
   information, pas une erreur.
3. **Le montant gagé ne décroît pas avec la dette.** Un nantissement de
   300 000 € sur un prêt dont il ne reste que 150 000 € vaut juridiquement
   300 000 € jusqu'à la mainlevée. La marge affichée est donc
   **pessimiste** — c'est voulu.

Le bloc liste **tous** les gages, y compris ceux qui profitent à une autre
société du groupe et ceux qui profitent à un emprunteur hors groupe. Sans ces
derniers, la marge serait surévaluée — une erreur en notre défaveur, et
invisible.

### Les garanties données

En bas de la page Passif, détaché des trois autres sections, un bloc
**Garanties données** liste les actifs que la société a mis en gage pour
quelqu'un d'autre. Ce n'est pas une dette, c'est un engagement hors bilan :
d'où sa mise à l'écart visuelle, et l'absence de total.

### Mainlevée

Une garantie qui a pris fin se marque en **mainlevée**. Sa ligne reste —
c'est de l'historique — et elle sort du total gagé. Supprimer efface la
ligne : à réserver à une saisie faite par erreur.

### L'ordre d'affichage

Les sûretés sont triées de la plus forte à la moins forte : PPD, hypothèque,
nantissement, garantie d'organisme, caution. Les mainlevées tombent en bas.

⚠️ C'est une **convention d'affichage, pas une vérité juridique**. La force
réelle d'une sûreté dépend aussi de son rang — un second rang ne vaut que ce
qui reste après le premier — et de la situation du débiteur. Le tri sert à
lire vite, pas à conclure.

## Le pointage d'une échéance

Le sélecteur de la file de [pointage](08-pointage.md) gagne un groupe
**Prêts bancaires**, à côté des Deals, des Capitaux propres et des Comptes
courants. Rattacher un prélèvement à son prêt le sort de la file et fait
apparaître le montant dans la colonne Réel de l'échéancier.

Rien n'est proposé, rien n'est pré-sélectionné, rien n'est classé par
vraisemblance : l'application liste, l'utilisateur choisit. La conséquence du
choix, elle, est automatique.

Le réel est placé sur l'échéance dont il occupe la **période** — un
rapprochement de calendrier, pas une proposition. Un paiement en retard reste
donc sur la période où il est tombé, ce qui rend une échéance manquée
visible au lieu de la masquer.

Le rattachement ne se fait **pas** depuis la fiche du prêt : elle affiche et
permet de réaffecter, la file de pointage rattache.

## Les échéances dans le prévisionnel

Les échéances à venir alimentent le [prévisionnel de
trésorerie](09-previsionnel.md), dans la catégorie **Dette bancaire**. Le
montant projeté inclut l'assurance : c'est ce qui sort réellement du compte.

C'est là que le type d'amortissement change la vie. Un prêt in fine de
6,6 M€ fait apparaître 6,6 M€ dans la trésorerie prévisionnelle **à sa
date**. Sans le type, le prévisionnel lisserait ce capital sur toute la
durée et le ballon resterait invisible jusqu'à ce qu'il tombe.

La projection est rejouée à chaque enregistrement d'un prêt et à chaque
palier de taux. Une échéance modifiée à la main n'est jamais réécrite ; une
échéance que le nouvel échéancier ne produit plus est retirée au lieu de
survivre en fantôme.

## À faire

L'onglet [À faire](16-a-faire.md) signale les **échéances échues sans
prélèvement rattaché**. Aucune alerte, aucune notification : un signal
dérivé, recalculé à chaque lecture, qui dit quelle échéance attend son
pointage.

## Les documents

Un acte de prêt, une offre, un tableau d'amortissement de la banque, un acte
de nantissement se rattachent directement au prêt ou à la garantie. Ils
n'ont pas de société-cible au sens portefeuille, et n'apparaissent donc pas
sur une fiche société — ils se lisent depuis le prêt ou la garantie, et
depuis la recherche de l'assistant IA.

## L'assistant IA

L'assistant sait **lire** la dette : les prêts d'une société et leur capital
restant dû, l'échéancier d'un prêt autour d'aujourd'hui, les garanties
auxquelles la société est partie, et ce qu'un placement garantit au total.

Il sait aussi **écrire** : créer un prêt, ajouter un palier de taux sur un
prêt variable, enregistrer un avenant daté, créer une sûreté, enregistrer une
mainlevée. **Chaque écriture demande votre accord** — l'assistant s'arrête et
affiche Confirmer / Refuser.

Ce qu'il ne fait pas :

- **Supprimer.** Retirer un prêt ou une garantie reste un geste de
  l'application. Une mainlevée n'est pas une suppression : la ligne reste.
- **Corriger un prêt.** Écraser des conditions détruit un historique ; ce
  geste-là se fait à la main. L'assistant peut en revanche enregistrer un
  **avenant**, qui le conserve.
- **Saisir un capital restant dû.** Il n'y a pas de champ pour ça : ce sont
  les conditions du contrat qui se saisissent, le reste en découle.

Sur la fiche d'un prêt, il sait de quoi vous parlez quand vous dites « ce
prêt ».

## Points d'attention

- **Aucun capital restant dû n'est stocké.** Il est recalculé à chaque
  lecture depuis les conditions du prêt. Corriger un prêt le fait bouger
  immédiatement, sans reprise de données. Seule exception : l'encours d'un
  révolving.
- **Le réel est un contrôle, pas une source.** Un écart entre le plan et le
  réel signale un pointage incomplet ou un événement non saisi — pas un bug.
- **Un prêt portant des garanties ne se supprime pas** : il faut détacher les
  garanties d'abord. Idem s'il porte des documents ou des transactions
  pointées.
- **Une sûreté sur un bien immobilier se lit des deux côtés.** Un privilège
  de prêteur de deniers ou une hypothèque prend le bien pour assiette : la
  ligne apparaît sur la fiche du prêt **et** sur la fiche du bien, à partir de
  la même saisie. Sa marge disponible se compare à la dernière valorisation du
  bien. Voir [Immobilier](20-immobilier.md).

## Pages liées

- [Passif](10-passif.md) — capitaux propres et comptes courants, sur la même
  page.
- [Pointage](08-pointage.md) — le rattachement d'un prélèvement à son prêt.
- [Prévisionnel de trésorerie](09-previsionnel.md) — où tombent les
  échéances.
- [Placements](19-placements.md) — la fiche qui porte le bloc des
  nantissements.
- [Immobilier](20-immobilier.md) — les biens qu'une PPD ou une hypothèque
  prend pour assiette.
- [À faire](16-a-faire.md) — le signal des échéances en attente.
