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
Le rattachement à une participation (parmi les sociétés de l'organisation
de la boîte uniquement) se fait en cascade, du signal le plus sûr au plus
fin :

1. **Domaine des participants** : l'expéditeur ou un destinataire porte le
   domaine de la société (celui de la fiche).
2. **Domaine dans le corps du message** : une adresse au domaine de la
   société apparaît dans le texte — le cas typique du mail transféré ou
   d'un tiers (fonds, avocat, plateforme) qui cite la société.
3. **Nom de la société dans le message** : le nom exact apparaît dans
   l'objet ou le corps (les noms de plateformes courantes — LinkedIn,
   Notion… — sont exclus pour éviter les faux positifs de signatures).
4. **Analyse par l'IA en cas de doute** : un email qu'aucune règle n'a
   rattaché est analysé pour détecter une participation concernée
   **directement ou indirectement** (reporting transféré par un fonds,
   variante d'écriture du nom…). Seul un rattachement **sans ambiguïté**
   est retenu ; il est marqué d'une étincelle ✨ dans la timeline pour
   rester identifiable (et auditable). Dans le doute, l'IA ne fait rien.

Un même email vu par plusieurs boîtes n'est rangé qu'**une fois** (le
détail indique par quelles boîtes il est passé).

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
- **Le domaine de la fiche reste la clé la plus fiable.** Une participation
  sans champ « domaine » renseigné ne peut être rattachée que par son nom
  (règle 3) ou par l'IA (règle 4) — renseigner le domaine reste le meilleur
  moyen de ne rien rater.
- **L'extraction d'un report est manuelle, à la demande.** Dans le détail
  d'un email capté, le bouton **« Extraire le report »** envoie l'email
  dans le [circuit d'analyse des reports](17-reports-par-email.md) (texte,
  PDF et Excel joints, liens DocSend/Notion → KPIs, fiche report, synthèse,
  récap par email). Rien ne part sans ce clic ; un email déjà extrait
  affiche « Déjà extrait ». Si le même report arrive aussi par le forward,
  la fiche de la période est mise à jour, jamais dupliquée. Le forward
  reste utile pour les reports qui n'arrivent pas dans une boîte connectée.
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
