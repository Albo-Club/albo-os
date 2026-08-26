# Reports par email

## À quoi ça sert

Les investor updates des participations arrivent par email. Plutôt que de
les recopier à la main, on les **transfère à une adresse dédiée** :
`report-albo-os@agentmail.to`. Le circuit fait le reste — identifier la
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

Toi ou Ben transférez l'update reçu (avec ses pièces jointes) à l'adresse
dédiée. Seuls les emails transférés par un **membre du workspace** sont
traités : un email arrivant de n'importe qui d'autre part en quarantaine,
sans réponse à l'expéditeur (pour ne jamais révéler que l'adresse existe) —
vous êtes prévenus par un email séparé.

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

**Quand la même boîte porte deux noms** (`Oprtrs & Co` côté Albo, `OPRTRS
CLUB` côté Calte) : rien ne permet de deviner qu'il s'agit d'une seule
participation — vu de l'outil, ces deux lignes se ressemblent autant que
Sezame Immo 2 et Immo 6, qui sont bien deux véhicules. Le rattachement est
donc **manuel et assisté** : au moment de choisir, les fiches qui partagent
le site web dans une **autre organisation** sont proposées en cases à
cocher (la plus proche en tête), jamais cochées d'avance. Et un report déjà
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

### 6. La réponse dans le fil

Toute personne qui transfère reçoit une réponse dans son propre fil. Ce
qu'elle contient dépend de son rôle, réglé dans
[Réglages → Membres](14-organisations-membres-invitations.md) :

- **Tu ne gères pas la file** (case « Problèmes de reports » décochée) → tu
  reçois **« Report bien reçu »**, exactement le même message que le report
  se soit rangé ou non. Pas de verdict, pas de lien, rien à faire. C'est
  volontaire : on ne demande pas à quelqu'un dont le rôle s'arrête au
  transfert de lire un diagnostic qu'il ne traitera pas.
- **Tu gères la file** (case cochée) → tu reçois le vrai contenu : le
  **récapitulatif détaillé** quand c'est rangé (société identifiée et mode
  de rattachement, période, sources lues ✅/⚠️, KPIs cibles trouvés ou
  absents, autres métriques enregistrées, valeurs inhabituelles à
  vérifier), et le message **actionnable** quand ça coince (la cause, le
  détail technique de l'échec, et le lien vers la boîte Rapports
  entrants). Ce même détail technique s'affiche sous le statut de la ligne
  dans la boîte Rapports entrants : quand une catégorie d'échec est trop
  générique pour agir (« erreur technique »), c'est là que se lit ce qui
  s'est réellement passé.

Les autres personnes qui gèrent la file sont prévenues **uniquement quand
il y a un problème**, par un email séparé. Un report qui se range
correctement ne génère aucune notification pour qui ne l'a pas transféré :
pas de bruit pour une chaîne qui marche. Le volume, lui, se lit dans le
**point hebdo du lundi**, qui compte les reports rangés dans la semaine
(voir [Prévisionnel](09-previsionnel.md)).

C'est ce qui permet de confier le transfert des reports à quelqu'un sans
jamais lui envoyer les erreurs — il reçoit toujours le même accusé de
réception, et les problèmes atterrissent chez ceux qui tiennent la file.

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

Deux différences avec le mail : **aucun récapitulatif n'est envoyé** (tu es
devant l'écran, le résultat est sous tes yeux), et si l'analyse échoue, la
ligne passe en « analyse échouée » — le dépôt reste rattrapable depuis la
boîte [Rapports entrants](12-vue-consolidee.md), comme un mail.

## Points d'attention

- **Tout passe par un forward d'un membre** : un email envoyé directement
  par une participation à l'adresse dédiée part en quarantaine. C'est
  voulu (sécurité + contrôle de ce qui entre). Le dépôt manuel depuis la
  fiche société est l'autre porte d'entrée, réservée aux membres de
  l'organisation de la société. Pour qu'une nouvelle personne puisse
  transférer, il faut donc **l'ajouter comme membre** — et penser à
  décocher « Problèmes de reports » sur sa ligne si elle ne doit pas gérer
  la file (tout est activé par défaut).
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
  [Participations](04-participations.md) (liste « Documents & rapports » des
  fiches),
  [Valorisations, KPIs et métriques](06-valorisations-et-kpis.md)
  (catalogue, fiche KPI cible), [Intégrations](15-integrations.md)
