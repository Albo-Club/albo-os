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
apparaît avec sa pastille d'état et sa dernière relève. On peut connecter
plusieurs boîtes (perso, alboteam, morning…) — le service est partagé :
les mêmes boîtes alimentent toutes les organisations.

### 2. Relève et rangement automatiques

Toutes les 10 minutes, les nouveaux emails de chaque boîte sont relevés.
Un email est rattaché à une participation quand un de ses participants
(expéditeur ou destinataires) porte le **domaine de la société** (celui de
la fiche). Le rattachement est mécanique et prévisible — pas d'IA, donc pas
de faux positifs surprenants. Si la même société existe dans plusieurs
organisations, l'email apparaît sur chacune de ses fiches. Un même email vu
par plusieurs boîtes n'est rangé qu'**une fois** (le détail indique par
quelles boîtes il est passé).

### 3. Lire la timeline

Sur la fiche d'une participation, l'onglet **Emails** liste les échanges du
plus récent au plus ancien : sens (reçu/envoyé), objet, expéditeur, extrait
et date. Un clic ouvre le message complet (texte).

## Points d'attention

- **Seuls les emails liés au portefeuille sont conservés.** Les mails
  internes, personnels ou sans rapport ne sont **jamais** stockés dans
  Albo OS — le filtre s'applique avant tout enregistrement.
- **Le domaine de la fiche est la clé.** Une participation sans champ
  « domaine » renseigné ne peut pas recevoir d'emails ; un email dont aucun
  participant n'écrit depuis le domaine de la société (ex. un avocat qui
  écrit sans copie de la boîte) n'est pas rattaché.
- **Pas de pièces jointes** par ce canal : la timeline conserve le texte.
  Pour un report avec PDF, le
  [forward à l'adresse reports](17-reports-par-email.md) reste la bonne
  voie — les deux circuits coexistent.
- **Reconnexion périodique** : tant que l'application Google est en mode
  test, les boîtes hors alboteam demandent une reconnexion (2 clics)
  environ chaque semaine — la pastille passe « À reconnecter » sur la page
  Intégrations, sans perte de mails déjà rangés.
- **Historique** : la relève ne couvre que les emails reçus **depuis** la
  connexion de la boîte. L'import de l'historique complet est une évolution
  prévue, comme le branchement des emails « report » sur le circuit
  d'analyse (KPIs, synthèse).

## Pages liées

- [Participations](04-participations.md) (la fiche et ses onglets),
  [Reports par email](17-reports-par-email.md) (le circuit d'analyse des
  investor updates), [Intégrations](15-integrations.md) (connexion et état
  des boîtes)
