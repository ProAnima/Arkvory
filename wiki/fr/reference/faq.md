---
title: FAQ
description: 'Réponses courtes et précises aux questions fréquentes sur les limites, la disponibilité, les bases de données, les mises à jour, le déplacement de serveur, l’accès et la licence.'
---

# FAQ

## Taille et disponibilité {#size-and-availability}

### Quel est le plus gros fichier que je peux stocker ? {#max-object-size}

10 000 GiB (10 737 418 240 000 octets). Un téléversement compte au plus 10 000 parties d’au plus 1 GiB chacune. L’administrateur peut fixer une limite plus basse avec `ARKVORY_MAX_OBJECT_BYTES`. Une taille déclarée plus grande est refusée avec `400`. En pratique, l’espace disque libre, le quota du dépôt et la réserve de 1 GiB d’espace libre vous arrêtent d’abord : ils répondent `507`. Voir [Concepts](../guide/concepts#uploads) et [Variables d’environnement](./environment).

### Quelle capacité un serveur peut-il contenir ? {#capacity}

Arkvory réserve jusqu’à 10 TiB de contenu par défaut (`ARKVORY_CAPACITY_BYTES`), en comptant les fichiers publiés, les téléversements inachevés et le contenu en attente de nettoyage. C’est un compteur, pas un contrôle du disque. Le disque et la réserve sont la vraie limite. Un dépôt peut avoir son propre quota. Voir [Stockage](../operate/storage).

### Arkvory est-il hautement disponible ? {#high-availability}

Non. Une installation correspond à un serveur, avec une base de données PostgreSQL et un répertoire de contenu local. Si le serveur s’arrête, les clients attendent puis reprennent leurs transferts ; les services redémarrent seuls après un plantage ou un blocage. Pour vous protéger de la perte du serveur, utilisez les [sauvegardes](../operate/backups). Pour lire depuis un second site, utilisez les [miroirs](../operate/mirrors) ; le basculement vers un miroir est une opération manuelle, et les changements que le miroir n’a pas encore reçus sont perdus.

### Fonctionne-t-il hors ligne ? {#offline}

Le serveur fonctionne sans accès à internet. Le programme d’installation Windows inclut Node.js et PostgreSQL et s’installe hors ligne. Les paquets Linux incluent Node.js, et le gestionnaire de paquets installe PostgreSQL. Les installateurs par script et Docker téléchargent des fichiers. Les mises à jour peuvent être installées depuis une copie locale d’une version. Si le hub de mises à jour est injoignable, la vérification de mise à jour échoue et s’affiche dans la console ; rien d’autre n’est affecté. Voir [Choisir une installation](../install/index) et [Mises à jour](../install/updates).

## Stockage et base de données {#storage-and-database}

### Quelle base de données utilise-t-il ? {#database}

PostgreSQL, une base de données par installation. Le programme d’installation Windows inclut PostgreSQL 18.4. Les paquets Linux utilisent un cluster dédié d’un serveur PostgreSQL 16 à 19 de votre distribution. La pile Docker Compose exécute PostgreSQL 18.4 dans un conteneur. Les installateurs par script utilisent votre propre serveur. Ne connectez jamais deux installations à une même base de données. Le contenu des fichiers n’est pas dans la base de données : il se trouve dans le répertoire de données.

### Puis-je utiliser S3 ou un autre stockage objet ? {#s3}

Non. Le contenu des fichiers est stocké dans un répertoire local, qui doit se trouver sur un système de fichiers local prenant en charge les liens physiques, et non sur un partage réseau. Arkvory ne stocke pas de contenu dans S3 et n’offre pas d’interface S3. Le stockage des sauvegardes est un dossier sur un autre disque ou sur un partage réseau monté (sous Windows, un volume local ou iSCSI).

### Puis-je utiliser l’authentification unique de mon entreprise ? {#sso}

Non. Les comptes, les groupes et les mots de passe appartiennent à Arkvory. L’automatisation se connecte avec des clés de service. Voir [Authentification](../api/authentication).

## Exploitation du serveur {#running}

### Comment voir quelle version est installée ? {#version}

Dans la console, ouvrez [[ui:updates]] : [[ui:updateCurrent]] l’affiche. Sur le serveur, exécutez `arkvory status --root <installation root>` et lisez `current` ; sous Windows avec le programme d’installation graphique, exécutez `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root 'C:\ProgramData\ProAnima\Arkvory'` dans un PowerShell élevé. Un administrateur peut aussi appeler `GET /api/v1/system/updates`, qui renvoie `currentVersion`. La commande `arkvoryctl --version` affiche la version du client, pas celle du serveur.

### Comment activer les mises à jour automatiques ? {#automatic-updates}

Dans la console, ouvrez [[ui:updates]], sélectionnez [[ui:updateAutomatic]], choisissez l’[[ui:updateHour]] et sélectionnez [[ui:updateSave]]. Sur le serveur, exécutez `arkvory configure --root <installation root> --enable-updates` ; `--disable-updates` les désactive. Les programmes d’installation les laissent désactivées sauf si vous passez `--automatic`.

Le serveur recherche une version toutes les 6 heures, même lorsque l’installation automatique est désactivée. Lorsqu’elle est activée, une version stable s’installe une fois par jour pendant l’heure de maintenance (03:00 UTC par défaut), sauf si la version est épinglée. Une version qui modifie le schéma de la base de données ne s’installe qu’après que le serveur a effectué et vérifié une sauvegarde fraîche. Voir [Mises à jour](../install/updates).

### Qu’est-ce qu’Arkvory envoie à ProAnimaStudio ? {#hub-traffic}

Vos fichiers et vos données restent sur votre serveur. Le serveur contacte le hub ProAnimaStudio (`hub.proanima.net`), et GitHub lorsque le hub est injoignable, pour trois choses :

- **Vérifications de mise à jour.** La requête porte le nom du projet, le système d’exploitation, l’architecture du processeur, la version installée et le canal de mise à jour. Lorsque les statistiques sont activées, elle porte aussi un ID d’installation aléatoire.
- **Statistiques anonymes.** Un événement après chaque mise à jour installée, avec l’ID d’installation, la version, le système, l’architecture et le canal. Aucun nom, aucune adresse, aucun contenu ni aucune adresse IP n’est stocké. Les statistiques sont activées par défaut ; désactivez-les avec [[ui:updateStatistics]] dans [[ui:updates]] ou avec `arkvory configure --statistics off`. Sans statistiques, une nouvelle version ne vous parvient que lorsqu’elle est déployée pour tout le monde.
- **Commentaires.** Uniquement lorsqu’une personne connectée l’envoie depuis [[ui:reportOpen]]. Il contient le message, une adresse e-mail facultative, jusqu’à 6 captures d’écran et le journal de la console. Un administrateur peut ajouter le journal du serveur et un résumé des versions et des états, sans secrets. [[ui:reportShow]] montre exactement ce qui sera envoyé.

`arkvory configure --hub-off` arrête le contact avec le hub : les versions proviennent alors uniquement de GitHub, et les commentaires se désactivent après le redémarrage des services. Un `ARKVORY_HUB_URL` vide désactive uniquement les commentaires. Voir [Licence](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md), section 7.

### Les sauvegardes s’exécutent-elles toutes seules ? {#automatic-backups}

Pas avant que vous ne les configuriez. Connectez un stockage des sauvegardes avec `arkvory configure --backup-vault <folder> --vault-key-file <file>`, puis activez la planification quotidienne dans [[ui:backupPlan]] dans [[ui:backups]]. Le plan commence à 02:00 UTC et conserve 7 points de restauration quotidiens, 4 hebdomadaires et 6 mensuels. Tant que la planification n’est pas activée, la console affiche l’avertissement indiquant que la planification quotidienne est désactivée. Voir [Sauvegardes](../operate/backups).

### Comment migrer vers un autre serveur ? {#move-server}

1. Installez Arkvory, de la même version ou d’une version plus récente, sur le nouveau serveur.
2. Restaurez le point de restauration le plus récent du stockage des sauvegardes vers une base de données vide et un répertoire de stockage vide avec la commande `arkvory-backup restore`. Elle vérifie chaque fichier par SHA-256. Voir [Sauvegardes](../operate/backups).
3. Faites pointer `ARKVORY_DATABASE_URL` et `ARKVORY_DATA_DIR` dans `config/runtime.json` vers la base de données et le répertoire restaurés, redémarrez les services, puis vérifiez la console, un téléchargement et un téléversement.
4. Déplacez l’adresse (le DNS ou les réglages de la CI) vers le nouveau serveur.

Les utilisateurs, les groupes et les mots de passe reviennent. Les sessions ne sont pas transférées, les jetons personnels et les clés de service sont révoqués : reconnectez-vous et émettez de nouvelles clés. Les politiques de rétention et de nettoyage reviennent désactivées ; activez-les volontairement. Les téléversements qui n’étaient pas terminés sont annulés. Pour un dépôt que vous voulez déplacer pendant que l’ancien serveur continue de fonctionner, vous pouvez aussi laisser le nouveau serveur le suivre comme [miroir](../operate/mirrors) et le détacher au moment du basculement ; un miroir transporte les fichiers, les paquets et les images, mais pas les comptes, les clés, les pièces jointes ni les politiques.

### Que devient un transfert lorsque le serveur redémarre ? {#interrupted-transfers}

Le client poursuit. Une session de téléversement vit 7 jours et conserve les parties arrivées ; le client en ligne de commande et le SDK demandent au serveur ce qu’il possède et envoient le reste. Un téléchargement reprend avec une requête `Range`. Une seule requête `PUT`, comme pour un fichier brut ou une couche Docker, repart du premier octet. Voir [Reprendre des transferts interrompus](../protocols/cli#resume-interrupted-transfers).

### Où chercher lorsqu’un problème survient ? {#logs}

Chaque erreur a un ID de requête, dans le champ `requestId` et l’en-tête `X-Request-Id`. Retrouvez-le dans le journal d’accès du serveur. Les services écrivent leurs journaux dans le dossier `logs` sous Windows et dans le journal (`journalctl -u arkvory-api`) sous Linux. Envoyez un rapport avec [[ui:reportOpen]] pour y inclure les journaux. Voir [Dépannage](../operate/troubleshooting) et [Supervision](../operate/monitoring).

## Accès {#access}

### Comment réinitialiser le mot de passe du propriétaire ? {#reset-owner-password}

Un autre administrateur peut utiliser [[ui:resetPassword]] dans [[ui:administration]]. Si personne ne peut se connecter, utilisez la clé de récupération de `config/bootstrap-token.txt` : trouvez l’ID du compte avec `GET /api/v1/users` et envoyez `PATCH /api/v1/users/<id>` avec `{"password": "…"}`. Le nouveau mot de passe compte de 12 à 128 caractères. La réinitialisation met fin à toutes les sessions et à tous les jetons personnels du compte. Voir [Authentification](../api/authentication#recovery-key).

### Qu’est-ce que la clé de récupération, et que faire si je la perds ? {#lost-recovery-key}

C’est un secret dans `config/bootstrap-token.txt` à la racine d’installation, lisible uniquement par l’administrateur système. Il crée le premier propriétaire et administre les comptes de service. Les outils d’installation lisent ce fichier : ne le supprimez pas. Si le fichier est perdu mais que vous avez encore un compte administrateur, vous pouvez continuer à travailler avec ce compte ; pour créer une nouvelle clé de récupération, suivez [Configuration](../install/configuration). Voir [Concepts](../guide/concepts#owner-and-recovery-key).

### Quelle clé ma CI doit-elle utiliser ? {#ci-key}

Une clé de service d’un compte de service dont la politique ne contient que les actions dont le job a besoin, par exemple `upload.create`, `upload.write`, `upload.complete`, `upload.read` et `job.read` pour publier. Les préréglages de la console [[ui:bindingRead]] et [[ui:bindingPublish]] remplissent des ensembles typiques. N’utilisez pas la clé de récupération ni le jeton d’une personne dans la CI. Les clés durent 90 jours par défaut et sont limitées à 365 : prévoyez une rotation. Voir [Authentification](../api/authentication#service-accounts).

### Pourquoi un administrateur ne peut-il pas supprimer un artefact ni modifier une politique de stockage ? {#delete-forbidden}

Les actions `artifact.delete`, `storage.read`, `storage.manage` et `diagnostics.read` n’existent que pour les clés de service. Une autorisation de groupe, un jeton personnel, une session et la clé de récupération ne les portent jamais. Créez un compte de service qui possède ces actions sur le dépôt, émettez une clé, puis utilisez cette clé pour l’appel (l’API, `arkvoryctl`, ou [[ui:keySignIn]] dans la console). L’erreur est `403` avec la raison `permission_missing`. Voir [Authentification](../api/authentication#repository-actions).

### Docker, Git LFS et Unity fonctionnent-ils avec lui ? {#protocols}

Oui. Arkvory sert un registre de conteneurs à `/v2/`, un serveur Git LFS à `/lfs/<repository>` et un registre npm à `/npm/<repository>/` que le Unity Package Manager peut utiliser. Ils acceptent la clé Arkvory comme mot de passe. Voir [Clients et protocoles](../protocols/index).

## Licence {#license}

### Arkvory est-il open source ? {#open-source}

Non. Arkvory est gratuit, et son code source est ouvert à la lecture, mais ce n’est pas un logiciel open source. Il est placé sous la ProAnima Arkvory License 1.0 d’Ian Panaev, qui n’autorise pas la distribution de forks ni de copies. Veuillez ne pas le qualifier d’« open source ». Le texte complet se trouve dans [LICENSE.md](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md) ; le texte russe prévaut en cas de divergence.

### Que puis-je faire avec ? {#license-allowed}

Vous pouvez installer et utiliser autant de copies que vous voulez, à n’importe quelle fin, y compris dans une entreprise ; lire et étudier le code source ; le modifier ; et utiliser votre version modifiée au sein de votre organisation. Vous pouvez stocker et livrer vos propres artefacts par son intermédiaire, y compris à vos propres clients.

### Qu’est-ce qui n’est pas autorisé ? {#license-forbidden}

Vous ne pouvez pas distribuer le logiciel ni des versions modifiées à quiconque en dehors de votre organisation, publier des forks, des builds, des images de conteneurs ou des correctifs contenant son code, le vendre, le louer ou le prêter, ou en donner l’accès, le facturer, ni le proposer à des tiers comme service hébergé ou géré. Vous ne pouvez pas supprimer les mentions de copyright, la licence ou les noms ProAnima Arkvory et ProAnimaStudio, ni présenter une version modifiée comme l’originale. Lorsque vous décrivez publiquement un système construit sur Arkvory, citez la source : « ProAnima Arkvory by ProAnimaStudio (Ian Panaev), https://github.com/ProAnima/Arkvory ». Ne vous procurez des copies qu’auprès des sources officielles. Pour d’autres autorisations, écrivez à info@proanima.net.

### Où signaler un problème ou une vulnérabilité ? {#report}

Pour un problème lié à votre installation, utilisez [[ui:reportOpen]] dans la console. Pour un problème de sécurité, suivez [SECURITY.md](https://github.com/ProAnima/Arkvory/blob/main/SECURITY.md) dans le dépôt et ne le publiez pas publiquement.
