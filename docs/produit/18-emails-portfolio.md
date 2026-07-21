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

Dans la vue « Toutes les organisations », la page **Emails** (menu de
gauche, à côté de Rapports) liste tous les emails rattachés, toutes
organisations et toutes boîtes confondues — avec les sociétés cliquables
vers leur fiche. C'est le poste de contrôle : on y vérifie d'un coup d'œil
que la capture tourne et ce qui est entré récemment.

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
- **Reconnexion périodique** : tant que l'application Google est en mode
  test, les boîtes hors alboteam demandent une reconnexion (2 clics)
  environ chaque semaine — la pastille passe « À reconnecter » sur la page
  Intégrations, sans perte de mails déjà rangés.
- **Historique** : la relève ne couvre que les emails reçus **depuis** la
  connexion de la boîte. L'import de l'historique complet est une évolution
  prévue, comme le branchement des emails « report » sur le circuit
  d'analyse (KPIs, synthèse).

## Pages liées

- [Vue consolidée](12-vue-consolidee.md) (la page Emails cross-org),
  [Participations](04-participations.md) (la fiche et ses onglets),
  [Reports par email](17-reports-par-email.md) (le circuit d'analyse des
  investor updates), [Intégrations](15-integrations.md) (connexion et état
  des boîtes)
