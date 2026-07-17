# Reports par email

## À quoi ça sert

Les investor updates des participations arrivent par email. Plutôt que de
les recopier à la main, on les **transfère à une adresse dédiée** :
`report-albo-os@agentmail.to`. Le circuit fait le reste — identifier la
société, lire tout le contenu (texte, pièces jointes, liens), en extraire
les KPIs, ranger le report sur la fiche société et répondre dans le fil
avec un récapitulatif. À l'usage : transférer le mail, lire le récap,
c'est tout.

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
acceptée sans une de ces preuves vérifiables. Si la société existe dans
plusieurs organisations (Calte **et** Albo), le report est rangé dans
chacune. En cas de doute (aucune correspondance, ou plusieurs possibles),
le mail atterrit dans la boîte
[Rapports entrants](12-vue-consolidee.md) pour assignation manuelle.

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

Le report est attaché à la fiche de la société (onglet Rapports) : titre,
période, points clés, documents, métriques. Renvoyer deux fois le même
mail — ou le même report pour la même période — ne crée **jamais de
doublon** : la fiche est mise à jour. La synthèse IA de la société est
relancée à chaque report ingéré.

### 6. Le récapitulatif dans le fil

La réponse arrive dans le fil du forward : société identifiée (avec le
mode de rattachement), période, sources lues ✅/⚠️, KPIs cibles trouvés ou
absents, autres métriques enregistrées, valeurs inhabituelles à vérifier.
En cas d'échec, le récap dit **quoi corriger** et renvoie vers la boîte
Rapports entrants (Assigner / Retraiter / Rejeter).

> **Sous le capot** — L'email est enregistré intégralement dès son
> arrivée, avant tout traitement : si une étape échoue, rien n'est perdu
> et « Retraiter » rejoue le circuit de zéro. L'adresse est hébergée chez
> AgentMail, qui notifie Albo OS à chaque email et envoie les récaps.

## Points d'attention

- **Tout passe par un forward d'un membre** : un email envoyé directement
  par une participation à l'adresse dédiée part en quarantaine. C'est
  voulu (sécurité + contrôle de ce qui entre).
- **Liens Notion** : la page doit être partagée publiquement. Une page
  privée échoue proprement (source ⚠️, reste du mail traité).
- **Métriques hors catalogue** : visibles dans le récap sous « non
  reconnues », conservées sur le report. Si une métrique récurrente mérite
  une série, elle doit entrer au catalogue (évolution à demander).
- **Budget vs réalisé** : seules les valeurs réalisées alimentent les
  séries ; les chiffres de budget/prévisionnel restent sur le report.

## Pages liées

- [Vue consolidée](12-vue-consolidee.md) (boîte Rapports entrants),
  [Participations](04-participations.md) (onglet Rapports des fiches),
  [Valorisations, KPIs et métriques](06-valorisations-et-kpis.md)
  (catalogue, fiche KPI cible), [Intégrations](15-integrations.md)
