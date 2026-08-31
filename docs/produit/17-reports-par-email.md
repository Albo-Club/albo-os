# Reports par email

## À quoi ça sert

Les investor updates des participations arrivent par email. Plutôt que de
les recopier à la main, on les **transfère à une adresse dédiée** :
`report@alboteam.com`. C'est un groupe — vous en êtes membres, donc vous
recevez chacun une copie de ce qui y passe — et le circuit y est abonné
comme un membre de plus. Le circuit fait le reste — identifier la
société, lire tout le contenu (texte, pièces jointes, liens), en extraire
les KPIs, ranger le report sur la fiche société et répondre dans le fil
avec un récapitulatif. À l'usage : transférer le mail, lire le récap,
c'est tout.

Un report qui n'est pas arrivé par mail (PDF récupéré sur un espace
investisseur, deck envoyé en main propre, export d'un outil) se dépose
directement depuis la fiche société — il suit le même circuit à partir de
la lecture du contenu. Voir « Ajouter un report à la main » plus bas.

## Comment ça marche

### 1. Transférer le mail

Transférez l'update reçu, avec ses pièces jointes, à l'adresse dédiée.
**N'importe qui peut y écrire** — vous, mais aussi un fondateur qui envoie
son update directement. Personne n'a besoin d'être déclaré à l'avance : ce
qui décide qu'un report est rangé, c'est son **contenu**, pas son
expéditeur. Un mail que le circuit ne sait rattacher à aucune participation
reste dans la boîte [Rapports entrants](12-vue-consolidee.md), sans email à
personne.

**Ce qui dépend de l'expéditeur, c'est la réponse.** Un accusé de réception
contient vos montants, vos organisations et des liens vers vos fiches : il
ne part donc **jamais** vers quelqu'un qui n'est pas membre. Un inconnu dont
le report se range correctement n'en saura rien — il ne reçoit rien du tout,
et l'adresse ne révèle même pas qu'elle existe.

**Pour recevoir l'accusé depuis une autre adresse que celle de ton compte**
— ton Gmail perso, ton adresse dans une autre boîte — déclare-la dans
[Réglages → Membres](14-organisations-membres-invitations.md), carte
« Adresses d'envoi des reports ». Sans ça, un report transféré depuis cette
adresse se rangera très bien, mais tu n'auras pas de retour : le circuit ne
sait pas que c'est toi. Une adresse déclarée n'ouvre aucun droit et ne
permet pas de se connecter — elle sert uniquement à te reconnaître comme
l'auteur d'un transfert.

### 2. Identification de la participation

Le circuit reconnaît la société concernée en croisant le **domaine de
l'expéditeur d'origine** (celui du forward, ex. `lea@tango.fr`) et le **nom
de la société** dans le message. Une suggestion de l'IA n'est jamais
acceptée sans une de ces preuves vérifiables. Beaucoup de fondateurs
écrivent depuis une adresse personnelle (gmail…) : le domaine ne dit alors
rien, et c'est le nom de la société écrit dans le message qui fait foi —
tant qu'une seule participation y est nommée. Si la société existe dans
plusieurs organisations (Calte **et** Albo), le report est rangé dans
chacune. En cas de doute (aucune correspondance, ou plusieurs sociétés
possibles), le mail atterrit dans la boîte
[Rapports entrants](12-vue-consolidee.md) pour assignation manuelle.

**Cas des sponsors** (Sezame, Parallel, Anaxago, Rewatt, Virgil…) : leurs
véhicules partagent tous le même domaine, qui dit donc **qui écrit**, pas
**de quel véhicule il parle**. Sur ces domaines, le rattachement demande
que le véhicule soit **nommé dans le message** (« Sezame Immo 6 ») ; sans
ça, le mail part dans la boîte Rapports entrants pour un rattachement à la
main, plutôt que d'être rangé au hasard chez un véhicule voisin. Un
rattachement manuel ne touche lui aussi que le véhicule choisi.

**Comment nommer une fiche pour qu'elle soit reconnue** : le nom de la
fiche est ce que le circuit cherche dans le message. Il doit donc être le
libellé que la société ou le sponsor écrit lui-même — « Batch Ventures
2025 », « Sezame Immo 6 » — et pas une abréviation maison. Pas besoin qu'il
soit l'objet exact du mail : il suffit qu'il y figure en entier, quelle que
soit la ponctuation autour (« [Batch Ventures 2025] ZeroEntropy… », « Batch
Ventures 2025, LP | Capital Call »). Ce que vous mettez **entre parenthèses
en fin de nom** est ignoré au moment du rattachement : c'est la place pour
votre propre annotation, celle qui vous dit de quel véhicule il s'agit
(« Batch Ventures 2025 (Fund n°2) »).

**Quand la participation est le fonds lui-même** : un fonds dont vous êtes
souscripteur (Batch Ventures, Eutopia…) envoie des nouvelles de **ses**
participations — une revente, une distribution. La société citée n'est pas
à votre portefeuille, le fonds si : le report est rangé sur le fonds. S'il
a plusieurs millésimes, le mail doit nommer celui qui est concerné, sinon
il part dans la file — un capital call « Batch Ventures YC 2026 » ne doit
pas atterrir sur le fonds 2025.

**Quand la même boîte porte deux noms** (`Oprtrs & Co` côté Albo, `OPRTRS
CLUB` côté Calte) : rien ne permet de deviner qu'il s'agit d'une seule
participation — vu de l'outil, ces deux lignes se ressemblent autant que
Sezame Immo 2 et Immo 6, qui sont bien deux véhicules. Le rattachement est
donc **manuel et assisté** : la participation se cherche au clavier (tapez
les premières lettres de son nom ou de son organisation, la liste se
filtre), et les fiches qui partagent le site web dans une **autre
organisation** sont proposées en cases à cocher (la plus proche en tête),
jamais cochées d'avance. Et un report déjà
rangé garde un bouton « **Rattacher aussi** » pour en ajouter une plus
tard — la nouvelle s'ajoute, les précédentes ne bougent pas. La file
signale le cas d'elle-même : un repère « + Calte ? » apparaît quand une
organisation a une fiche sur le domaine du report sans rien avoir reçu.

**Quand un report s'est rangé au mauvais endroit** — mauvais véhicule d'un
sponsor, rattachement fait un peu vite — il se **détache**. Depuis la fiche
société, en ouvrant le report : « Détacher de cette participation ». Depuis
les Rapports entrants, par la croix sur la puce de la participation. Le
report quitte cette fiche avec ses fichiers et les KPIs qu'il avait
renseignés, et la synthèse de la société repart du report précédent. Les
autres participations rattachées au même report gardent le leur, et le mail
d'origine reste dans la file : il n'y a plus qu'à le rattacher là où il
devait aller.

### 3. Lecture du contenu — toutes les sources

Chaque élément du mail est lu, selon son type :

| Source | Traitement |
| --- | --- |
| Corps du mail | Lu directement, y compris les liens cachés derrière un mot (« lien ») |
| PDF joint | Lecture OCR (Mistral) |
| Image / capture d'écran | Lecture OCR aussi (les petites images type logo sont ignorées) |
| Excel / CSV | Lu cellule par cellule, sans IA |
| Lien Notion | Page ouverte dans un vrai navigateur distant (Browserless) — la page doit être **partagée publiquement** |
| Lien Google Drive | Fichier téléchargé (s'il est partagé « avec le lien ») puis traité selon son type |
| Lien DocSend | Converti en PDF puis lu par OCR |

Règle d'or : **une source qui échoue ne bloque jamais les autres**. Elle est
marquée ⚠️ dans le récap avec la cause et le geste correctif (ex. « page
Notion inaccessible — vérifie qu'elle est partagée publiquement »), et
« Retraiter » relance tout le circuit après correction.

Le verdict de lecture de chaque pièce jointe reste consultable **après
coup** : il est repris sur la fiche société, sous le rapport auquel la pièce
jointe appartient, avec le texte lu ([Participations](04-participations.md)).
Le récap dit ce qui s'est passé sur le moment, la fiche dit ce qui est en
base.

### 4. Extraction des KPIs

L'IA lit le contenu et propose les métriques ; le rangement est fait par du
code : seules les clés du **catalogue fermé** (~35 métriques : GMV, burn,
runway, ARR…) alimentent les séries, et les conversions (k€ → €, % → …)
sont calculées, jamais confiées à l'IA. Ce qui ne rentre pas dans le
catalogue est **conservé sur le report** (rien n'est perdu) mais reste hors
séries. Si la société porte une
[fiche KPI cible](06-valorisations-et-kpis.md), elle sert de grille de
lecture : ces KPIs sont cherchés en priorité (une seule valeur par KPI,
celle qui couvre la période du report) et le récap dit lesquels manquent.

### 5. Rangement

Le report est attaché à la fiche de la société, dans la liste « Documents &
rapports », à la date de la période qu'il couvre : titre, période, points
clés, documents, métriques. Renvoyer deux fois le même
mail — ou le même report pour la même période — ne crée **jamais de
doublon** : la fiche est mise à jour. La synthèse IA de la société est
relancée à chaque report ingéré.

**Tous les courriers d'une participation ne couvrent pas une période.** Un
avis de liquidation, une notification juridique, une annonce de levée
n'ont ni période ni rythme. Ils sont rangés quand même, sans période,
datés du jour de réception — avec leur titre, leur résumé et leurs points
clés comme n'importe quel report. Rien n'est inventé : plutôt que de leur
coller un mois au hasard, la période reste vide. Deux courriers ponctuels
d'une même société ne se remplacent pas l'un l'autre, et aucun n'écrase le
report périodique de la même période.

### 6. Les mails de retour

**Quand le report est rangé**, la personne qui l'a transféré reçoit une
réponse dans son propre fil. Elle contient :

- la **société**, son logo et l'organisation où le report a été rangé ;
- la **fiche** en une ligne — le **versé** (ce qui est réellement sorti en
  banque, au centime), depuis quand, et la période du report précédent ;
- **ce que dit ce report**, en trois points ;
- **où en est la boîte** : la carte de synthèse IA de la fiche — note de
  santé et verdict, résumé, points forts et points de vigilance, les trois
  KPI suivis ;
- un **bouton** qui ouvre la fiche.

Le mail attend que l'analyse de la boîte soit à jour avant de partir : il
arrive quelques dizaines de secondes après le rangement, et la synthèse
qu'il porte tient compte du report qu'on vient de recevoir. Si l'analyse
échoue, le mail part quand même, sans cette carte.

**Si tu gères la file** (case « Problèmes de reports » cochée dans
[Réglages → Membres](14-organisations-membres-invitations.md)), le même
mail porte en plus le **contrôle qualité** : mode de rattachement, sources
lues ✅/⚠️, KPIs cibles trouvés ou absents, autres métriques enregistrées,
valeurs inhabituelles à vérifier.

**Quand ça coince**, ce que tu reçois dépend du même réglage :

- **Tu ne gères pas la file** → un message court : ton mail est bien
  arrivé, il n'a pas pu être rangé automatiquement, l'équipe a été prévenue
  et s'en occupe. **Ni la cause, ni la société, ni de lien** — rien sur quoi
  tu pourrais agir. (Il ne peut pas nommer la société : dans une bonne
  moitié des cas, l'échec est justement le circuit qui n'a pas su
  l'identifier.) Quand le problème est réglé, tu reçois la confirmation
  complète, qui rappelle en une ligne que c'est la suite de ce blocage.
- **Tu gères la file** → le message **actionnable** : la cause, le détail
  technique de l'échec, et le lien vers la boîte Rapports entrants. Ce même
  détail s'affiche sous le statut de la ligne dans la file : quand une
  catégorie d'échec est trop générique pour agir (« erreur technique »),
  c'est là que se lit ce qui s'est réellement passé.

C'est ce qui permet de confier le transfert des reports à quelqu'un sans
jamais lui envoyer les erreurs : il sait si c'est passé ou non, il ne voit
jamais le diagnostic.

**L'accusé part toujours à la personne qui a transféré**, jamais à l'adresse
du groupe — sinon tout le monde recevrait la réponse, et le circuit se
répondrait à lui-même en boucle. Le destinataire est imposé par le circuit,
pas déduit du mail reçu ; et si le groupe a réécrit l'expéditeur en cours de
route, le vrai auteur est retrouvé dans les en-têtes du message.

**Les autres membres de l'organisation sont prévenus qu'un report est
arrivé.** Ils reçoivent le même mail que le transféreur — société, fiche,
points clés, synthèse — précédé de qui l'a transféré, dans un mail à part.
Ça vaut aussi pour un report déposé à la main depuis une fiche société.
Chacun peut couper cet envoi sur sa ligne, case « Nouveaux reports ». La
semaine entière, elle, se relit dans le **point hebdo du lundi**, qui reprend
une carte par société — logo, période, note de santé et deux points clés
(voir [Prévisionnel](09-previsionnel.md)).

**Quand le report était déjà là** — vous êtes deux à avoir transféré le même
investor update — le second reçoit un accusé court : « ce report était déjà
dans Albo OS, il a été rafraîchi, rien n'a été dupliqué », avec le lien vers
la fiche. **Personne d'autre n'est prévenu** : il n'y a pas de nouvelle. En
base, rien ne se duplique jamais — ni le report, ni ses KPIs, ni ses
fichiers.

**Un transfert, une réponse — et c'est tout.** Ce que tu fais ensuite dans
la file te regarde, pas la personne qui a transféré le mail. « Retraiter »
et « Rattacher » rejouent tout le circuit **en silence** : sa boîte n'est
pas un journal de bord, et retraiter cinquante lignes d'un coup ne doit pas
lui faire cinquante mails. Le résultat de la relance se lit là où tu l'as
déclenchée — dans la file, où le statut de la ligne se met à jour.

Une seule exception, et c'est la bonne nouvelle : quand une ligne qui avait
annoncé un problème finit par passer, le transféreur reçoit **un** dernier
mail pour le lui dire. Il avait été prévenu que ça coinçait, il est prévenu
que c'est réglé. Une relance qui échoue encore, elle, ne dit rien : la
personne n'a rien à faire de ce constat, et la file l'affiche déjà.

**Un incident passager ne te dérange plus.** Il arrive que la lecture
échoue pour une raison qui n'a rien à voir avec le mail : la requête vers
l'IA est coupée en route, le service est saturé. Dans ce cas le report
n'est plus mis en échec — il est repris tout seul, jusqu'à trois fois, à
quelques minutes d'intervalle. Tu n'es prévenu que si les trois tentatives
échouent. Un problème qui se répare de lui-même ne génère donc plus ni
mail, ni geste de ta part. En revanche, un mail dont le contenu est
réellement inexploitable arrive tout de suite dans la file : inutile de te
le signaler vingt minutes plus tard.

Dans le même esprit, l'IA n'a plus besoin d'être parfaite dans sa
formulation pour que le report soit rangé. Si elle écrit le rythme ou une
unité autrement qu'attendu, c'est traduit ; et une valeur illisible ne
coûte plus que cette ligne — les autres chiffres du report et la fiche
elle-même sont rangés normalement.

> **Sous le capot** — L'email est enregistré intégralement dès son
> arrivée, avant tout traitement : si une étape échoue, rien n'est perdu
> et « Retraiter » rejoue le circuit de zéro. L'adresse est hébergée chez
> AgentMail, qui notifie Albo OS à chaque email et envoie les récaps. Le
> droit de parole d'un mail est posé une fois pour toutes, avec ce qu'il a
> annoncé : c'est ce qui rend les relances muettes et laisse quand même
> passer le mail de réparation.

## Ajouter un report à la main

Sur la fiche d'une participation, le bouton **« Ajouter »** ouvre une
fenêtre où choisir un ou plusieurs fichiers (PDF, Excel, image — 20 Mo par
fichier). C'est le **type** qui décide de la suite : choisir **Reporting**
lance le même circuit qu'un mail transféré, à partir de l'étape 3 — les
étapes 1 et 2 n'ont pas lieu d'être puisque tu as choisi la société
toi-même. Le bouton porte alors « Analyser et ajouter », et une note de
contexte peut être jointe ; ni titre ni période ne sont demandés, c'est
l'analyse qui les donne. Tout autre type (BP, juridique, pacte…) est un
simple dépôt, sans analyse.

L'option n'existe que sur une **participation** : une entité du groupe n'a
pas de reporting investisseur à analyser.

Le temps de l'analyse, une ligne « analyse en cours… » s'affiche en haut de
la liste ; quand elle disparaît, le report est là, avec sa période, ses
points clés et ses métriques, et les fichiers déposés sont repliés dedans. Comme pour un mail, le report est rangé
dans **chaque organisation** où la société existe, et la synthèse IA est
relancée.

Deux différences avec le mail : **toi, tu ne reçois rien** (tu es devant
l'écran, le résultat est sous tes yeux) — les autres membres, eux, sont
prévenus comme pour un report transféré ; et si l'analyse échoue, la ligne
passe en « analyse échouée » — le dépôt reste rattrapable depuis la boîte
[Rapports entrants](12-vue-consolidee.md), comme un mail.

## Points d'attention

- **L'adresse est ouverte, la réponse ne l'est pas** : n'importe qui peut
  écrire à l'adresse dédiée, y compris une participation qui envoie son
  update directement, et ça se range si le contenu le permet. Ce qui reste
  fermé, c'est le retour : pas de membre, pas d'accusé. Pour qu'une personne
  reçoive les accusés, il faut **l'ajouter comme membre** — et penser à
  décocher « Problèmes de reports » sur sa ligne si elle ne doit pas gérer
  la file (tout est activé par défaut). Le dépôt manuel depuis la fiche
  société est l'autre porte d'entrée, réservée aux membres de l'organisation
  de la société.
- **Le spam ne réveille personne** : l'adresse étant ouverte, un mail que le
  circuit ne rattache à rien — ou qu'AgentMail marque comme spam — attend
  dans la boîte Rapports entrants sans déclencher le moindre email. Une
  alerte par pub reçue remplirait vos boîtes ; la file est faite pour ça, et
  le point hebdo du lundi la résume.
- **Liens Notion** : la page doit être partagée publiquement. Une page
  privée échoue proprement (source ⚠️, reste du mail traité).
- **Métriques hors catalogue** : visibles dans le récap sous « non
  reconnues », conservées sur le report. Si une métrique récurrente mérite
  une série, elle doit entrer au catalogue (évolution à demander).
- **Budget vs réalisé** : seules les valeurs réalisées alimentent les
  séries ; les chiffres de budget/prévisionnel restent sur le report.
- **L'assistant IA les lit, de deux façons** : il restitue l'analyse rangée
  par le pipeline (points clés, métriques, synthèse de la société) pour une
  question factuelle — « quel CA en mars ? » ; et il fouille le texte
  intégral par le sens pour une question ouverte — « qu'est-ce qu'ils
  disent du recrutement ? ». Il choisit tout seul. Vaut dans l'app comme
  depuis claude.ai, à ceci près que la recherche dans le texte reste
  in-app.

## Pages liées

- [Vue consolidée](12-vue-consolidee.md) (boîte Rapports entrants),
  [Participations](04-participations.md) (liste « Rapports & communications »
  des fiches),
  [Valorisations, KPIs et métriques](06-valorisations-et-kpis.md)
  (catalogue, fiche KPI cible), [Intégrations](15-integrations.md)
