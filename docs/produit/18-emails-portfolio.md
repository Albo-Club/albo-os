# Emails du portfolio

## À quoi ça sert

Le suivi d'une participation passe beaucoup par l'email : échanges avec les
fondateurs, avocats, plateformes, co-investisseurs. Plutôt que de fouiller
plusieurs boîtes mail pour retrouver « ce qu'on s'est dit avec cette
boîte », Albo OS **connecte directement vos boîtes Gmail** et range
automatiquement chaque email lié à une participation sur sa fiche, dans
l'onglet **Emails** — reçus comme envoyés, toutes boîtes confondues. C'est
la timeline CRM du portefeuille, sur le modèle des CRM modernes
(Twenty, Attio).

## Comment ça marche

### 1. Connecter une boîte

Réglages → Intégrations → **Gmail** → « Connecter une boîte Gmail ». La
connexion se fait sur l'écran officiel de Google (autorisation en lecture
seule) ; aucun mot de passe ne transite par Albo OS. Chaque boîte connectée
apparaît avec sa pastille d'état et sa dernière relève.

**Une boîte est connectée pour une organisation précise** : connectée
depuis Albo, elle n'alimente que les participations d'Albo. Pour que la
même boîte serve aussi Calte, on la connecte une seconde fois depuis Calte
(deux autorisations indépendantes). L'étanchéité entre les véhicules est
totale.

### 2. Relève et rangement automatiques

Toutes les 10 minutes, les nouveaux emails de chaque boîte sont relevés.
Un email est rattaché à une participation quand un de ses participants
(expéditeur ou destinataires) porte le **domaine de la société** (celui de
la fiche) — parmi les sociétés de l'organisation de la boîte uniquement.
Le rattachement est mécanique et prévisible — pas d'IA, donc pas de faux
positifs surprenants. Un même email vu par plusieurs boîtes n'est rangé
qu'**une fois** (le détail indique par quelles boîtes il est passé).

L'email est conservé **en entier** : le texte du message avec ses liens
cliquables, et ses **pièces jointes** (PDF, Excel…), téléchargées et
stockées dans Albo OS — visibles dans le détail de l'email (trombone dans
la liste, téléchargement dans le dialog).

### 3. Lire la timeline

Sur la fiche d'une participation, l'onglet **Emails** liste les échanges du
plus récent au plus ancien : sens (reçu/envoyé), objet, expéditeur, extrait
et date. Un clic ouvre le message complet, avec ses pièces jointes
téléchargeables.

### 4. Suivre tout ce qui est capté

Dans chaque organisation, la page **Emails** (menu de gauche, entre Deals
et Trésorerie) liste tous les emails rattachés aux participations de cette
organisation, toutes boîtes confondues — avec les sociétés cliquables vers
leur fiche. C'est le poste de contrôle : on y vérifie d'un coup d'œil que
la capture tourne et ce qui est entré récemment. Albo et Calte ont chacun
leur page, étanches l'une à l'autre.

## Points d'attention

- **Seuls les emails liés au portefeuille sont conservés.** Les mails
  internes, personnels ou sans rapport ne sont **jamais** stockés dans
  Albo OS — le filtre s'applique avant tout enregistrement.
- **Le domaine de la fiche est la clé.** Une participation sans champ
  « domaine » renseigné ne peut pas recevoir d'emails ; un email dont aucun
  participant n'écrit depuis le domaine de la société (ex. un avocat qui
  écrit sans copie de la boîte) n'est pas rattaché.
- **Les pièces jointes sont conservées** (jusqu'à 20 Mo par fichier), mais
  leur contenu n'est **pas encore analysé** automatiquement : l'extraction
  des chiffres d'un report (KPIs, synthèse) reste pour l'instant du ressort
  du [forward à l'adresse reports](17-reports-par-email.md) — les deux
  circuits coexistent, et le branchement de l'analyse sur les emails
  stockés est une évolution prévue.
- **Ajouter une nouvelle boîte se fait en DEUX endroits.** Avant de
  cliquer « Connecter » dans Albo OS, l'adresse doit être déclarée
  **utilisateur test** dans la console Google de l'application (Google
  Auth Platform → Audience → Utilisateurs test, sur le projet Google
  Cloud d'Albo OS) — sinon Google refuse la connexion avec « Accès
  bloqué ». Cette règle vaut pour **toutes** les adresses, alboteam
  comprises, tant que l'application est en mode test. C'est l'étape
  facile à oublier.
- **Reconnexion tous les ~7 jours, pour toutes les boîtes** : tant que
  l'application Google est en mode test (non validée par Google), chaque
  autorisation expire au bout de 7 jours — la pastille passe « À
  reconnecter » sur la page Intégrations, et 2 clics la réarment (~20
  secondes, pas de mot de passe à retaper). **Un email d'alerte est envoyé
  automatiquement** à la personne qui a connecté la boîte dès que la
  reconnexion est nécessaire, avec le lien direct — un seul email par
  incident. Aucun mail n'est perdu si on reconnecte dans la semaine. La
  validation Google (audit annuel payant, plusieurs semaines) supprimerait
  cette contrainte ainsi que la liste d'utilisateurs test.
- **Historique** : la relève ne couvre que les emails reçus **depuis** la
  connexion de la boîte. L'import de l'historique complet est une évolution
  prévue, comme le branchement des emails « report » sur le circuit
  d'analyse (KPIs, synthèse).

## Pages liées

- [Participations](04-participations.md) (la fiche et ses onglets),
  [Reports par email](17-reports-par-email.md) (le circuit d'analyse des
  investor updates), [Intégrations](15-integrations.md) (connexion et état
  des boîtes)
