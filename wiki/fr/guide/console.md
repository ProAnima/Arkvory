---
title: La console web
---

# La console web

La console web est l’interface d’Arkvory dans le navigateur. Elle fait partie du serveur : vous ne l’installez pas séparément. Ouvrez `/console/` sur l’adresse de votre serveur, par exemple `http://127.0.0.1:8080/console/` sur le serveur lui-même, ou `https://arkvory.example/console/` une fois [HTTPS](../install/https) configuré.

La console utilise la même API HTTP que le [client en ligne de commande](../protocols/cli) et le [SDK](../protocols/sdk). Le serveur vérifie chaque requête. Lorsqu’un bouton est masqué, cela signifie seulement que votre compte ou votre clé ne peut pas effectuer cette opération.

## Disposition {#layout}

La barre latérale regroupe les sections. Sur un écran étroit, elle devient le bouton [[ui:navigationMenu]].

| Groupe              | Sections                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [[ui:navLibrary]]   | [[ui:catalog]], [[ui:packages]], [[ui:history]], [[ui:metadata]]                                                          |
| [[ui:navTransfers]] | [[ui:upload]], [[ui:downloads]]                                                                                           |
| [[ui:navResources]] | [[ui:administration]], [[ui:repositories]], [[ui:services]], [[ui:updates]], [[ui:backups]], [[ui:navStart]], [[ui:help]] |

La barre supérieure affiche le titre de la section, le bouton [[ui:uploadFile]], le bouton [[ui:reportOpen]] et les commandes d’apparence et de langue.

Chaque section a sa propre adresse, comme `#/catalog`, `#/packages` ou `#/backups`. Un artefact ouvert a l’adresse `#/artifact/<repository>/<id>`. Vous pouvez mettre ces adresses en favori et les envoyer à d’autres personnes. L’adresse ne contient jamais de mot de passe, de clé ni de texte de recherche. Si vous ouvrez un lien avant de vous connecter, la console l’ouvre après votre connexion.

Certaines sections n’apparaissent que pour certains utilisateurs :

| Section               | Qui la voit                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| [[ui:administration]] | Les administrateurs                                                          |
| [[ui:repositories]]   | Toute personne connectée                                                     |
| [[ui:services]]       | La clé de récupération, et les clés d’opérateur disposant de droits délégués |
| [[ui:updates]]        | Les administrateurs                                                          |
| [[ui:backups]]        | Les administrateurs et la clé de récupération                                |

## Connexion {#signing-in}

La carte [[ui:connection]] se trouve en haut de la page.

1. Renseignez [[ui:accountName]] et [[ui:password]].
2. Sélectionnez [[ui:signIn]]. Une session dure 12 heures.
3. La console sélectionne dans [[ui:repository]] le premier dépôt que vous pouvez lire. Pour travailler dans un autre dépôt, saisissez son nom ou choisissez-le dans la liste.

Pour vous connecter avec une clé plutôt qu’avec un mot de passe, ouvrez [[ui:keySignIn]], collez la clé et sélectionnez [[ui:connect]]. La clé reste dans la mémoire de cet onglet du navigateur. La console ne l’enregistre jamais.

[[ui:signUp]] n’apparaît que si l’administrateur autorise l’inscription libre. [[ui:disconnect]] met fin à la connexion.

Après une connexion par mot de passe, vous pouvez utiliser [[ui:changeOwnPassword]] et [[ui:personalAccessTokens]]. Un jeton d’accès personnel est une clé pour vos propres outils. Voir [Comptes et accès](../use/accounts).

### Le premier propriétaire {#the-first-owner}

Une nouvelle installation n’a aucun compte. Sous Windows, le programme d’installation crée le propriétaire. Pour les autres installations, créez le propriétaire dans la console :

1. Ouvrez [[ui:navStart]] et développez [[ui:welcomeOwner]].
2. Collez la clé de récupération qui se trouve dans `config/bootstrap-token.txt`, dans le répertoire d’installation.
3. Saisissez un nom et un mot de passe d’au moins 12 caractères, puis sélectionnez [[ui:welcomeCreate]].
4. Connectez-vous avec le nouveau nom et le mot de passe.

Le formulaire ne fonctionne que tant qu’il n’existe aucun compte. Le propriétaire est un administrateur. Il obtient aussi l’accès en écriture au dépôt `releases` par l’intermédiaire du groupe `arkvory-owners`.

## Bibliothèque {#library}

### Artefacts {#artifacts}

[[ui:catalog]] liste les fichiers publiés du dépôt. Recherchez par nom ou par valeur de métadonnée. Utilisez [[ui:labelFilter]] pour n’afficher qu’une étiquette, et [[ui:metadataFilter]] pour une clé et une valeur exactes. Chaque ligne indique le nom, la taille, l’heure de publication, les étapes et les étiquettes. Sélectionnez [[ui:download]] pour télécharger un fichier, ou [[ui:open]] pour en voir les détails. [[ui:more]] affiche la page suivante.

### Paquets {#packages}

[[ui:packages]] liste les versions UPack enregistrées. Filtrez avec [[ui:packageGroup]] et [[ui:packageName]], choisissez [[ui:sortBy]] et [[ui:groupBy]], puis sélectionnez [[ui:apply]]. La colonne des étapes indique où chaque version est promue. Voir [Paquets](../use/packages).

### Historique des fichiers {#file-history}

Un chemin de fichier, tel que `builds/game/1.4/GameSetup.exe`, peut pointer plusieurs fois vers un nouveau contenu. Chaque modification est une nouvelle version. Dans [[ui:history]], saisissez un chemin et sélectionnez [[ui:historyLoad]]. Vous voyez chaque version avec son auteur et son heure. Vous pouvez ouvrir n’importe quelle version pour télécharger son contenu d’origine. Restaurer une ancienne version crée une nouvelle version ; rien n’est supprimé. Voir [Fichiers et chemins](../use/files).

### Détails d’un artefact {#artifact-details}

[[ui:metadata]] affiche un artefact :

- **Résumé** : [[ui:summarySize]], [[ui:summaryCreated]] et [[ui:summaryHash]] avec un bouton [[ui:copyHash]].
- **Propriétés** : [[ui:labels]], [[ui:collections]] et [[ui:metadataFields]]. Sélectionnez [[ui:save]] pour les enregistrer. Le fichier lui-même ne change pas.
- **Actions** : [[ui:download]] ; [[ui:downloadLink]] crée un lien qui fonctionne pendant une heure sans clé ; [[ui:register]] indexe une archive UPack.
- [[ui:assetTitle]] : [[ui:assign]] fait de cet artefact le contenu actuel d’un chemin de fichier.
- [[ui:promotionTitle]] : [[ui:stageAdd]] marque l’artefact avec une étape, par exemple `qa` ou `release`. [[ui:promoteSubmit]] le publie dans un autre dépôt. Voir [Promotion](../use/promotion).
- [[ui:attachmentsTitle]] : [[ui:attachmentAdd]] associe à ce build un manifeste, un SBOM, une signature, un rapport ou un autre fichier. [[ui:attachmentHistory]] affiche les ensembles précédents.
- [[ui:deletionTitle]] : [[ui:deletionInspect]] montre ce qui utilise encore l’artefact. Pour le supprimer, collez l’ID de l’artefact et sélectionnez [[ui:deletionSubmit]].

## Transferts {#transfers}

### Téléversement {#upload}

Dans [[ui:upload]], choisissez un fichier et sélectionnez [[ui:startUpload]]. La console calcule d’abord le SHA-256 du fichier, puis l’envoie par parties. [[ui:pause]] interrompt le transfert et conserve les parties déjà téléversées.

Pour reprendre plus tard, conservez l’ID du téléversement. Ouvrez [[ui:resumeTitle]], sélectionnez le même fichier et renseignez [[ui:uploadId]]. Le navigateur vous avertit avant que vous quittiez la page pendant un téléversement. Voir [Transferts](../use/transfers).

### Téléchargements {#downloads}

[[ui:downloads]] est une file des fichiers que vous téléchargez depuis la console. La console vérifie le SHA-256 de chaque fichier avant d’enregistrer le fichier final.

- [[ui:downloadSettings]] définit [[ui:downloadConcurrency]] (de 1 à 8), [[ui:downloadInterval]] et [[ui:downloadWait]].
- [[ui:downloadsPause]], [[ui:downloadsResume]], [[ui:downloadsClearWaiting]], [[ui:downloadsCancel]] et [[ui:downloadsClearFinished]] pilotent l’ensemble de la file.
- Après un rechargement de la page, reconnectez-vous et sélectionnez [[ui:downloadRestore]]. Reprenez ensuite chaque fichier et choisissez où l’enregistrer.

Les gros téléchargements nécessitent Chrome ou Edge sur une adresse sécurisée (HTTPS ou l’ordinateur local). Les données temporaires restent dans le stockage privé du navigateur.

## Ressources {#resources}

### Utilisateurs et accès {#users-and-access}

Les administrateurs gèrent ici les personnes. [[ui:accountsHeading]] liste les comptes ; [[ui:groupsHeading]] liste les groupes. Utilisez [[ui:createUser]], [[ui:resetPassword]], [[ui:createGroup]] et [[ui:manageMembers]]. Dans [[ui:manageGrants]], donnez à un groupe l’accès [[ui:read]] ou [[ui:write]] à un dépôt, désigné par son nom. Un dépôt ne se crée pas séparément : il existe dès qu’un accès accordé ou une politique de service le nomme.

### Dépôts {#repositories}

[[ui:repositories]] affiche les dépôts que vous pouvez voir, avec [[ui:repositoryRights]]. Chaque carte propose [[ui:repositoryOpen]], [[ui:repositoryStorage]] (quota, nettoyage automatique et nettoyage physique) et, pour les administrateurs, [[ui:repositoryAccess]]. Un dépôt en miroir affiche le badge [[ui:mirrorBadge]]. Voir [Dépôts](../use/repositories) et [Stockage](../operate/storage).

### Accès des services {#service-access}

C’est ici que vous créez les comptes des outils et des systèmes de CI. Pour voir cette section, connectez-vous avec la clé de récupération ou avec une clé d’opérateur. Sélectionnez [[ui:serviceCreate]], puis définissez [[ui:servicePolicy]]. [[ui:bindingRead]] et [[ui:bindingPublish]] remplissent des jeux d’autorisations types.

Pour émettre une clé, ouvrez [[ui:serviceKeys]] et sélectionnez [[ui:keyIssue]]. Le secret n’est affiché qu’une seule fois. Copiez-le, confirmez [[ui:keySaved]] et sélectionnez [[ui:keyActivate]]. Une clé qui n’est pas activée expire au bout de 15 minutes. Utilisez [[ui:keyRotate]] pour remplacer une clé et [[ui:keyRevoke]] pour la révoquer. [[ui:delegations]] permet au propriétaire de donner à un opérateur des droits d’administration limités.

### Mises à jour {#updates}

[[ui:updates]] affiche [[ui:updateCurrent]] et [[ui:updateLatest]]. Sélectionnez [[ui:updateCheck]] ou [[ui:updateInstall]]. Dans [[ui:updateSettings]], activez [[ui:updateAutomatic]] et choisissez [[ui:updateHour]]. Voir [Mises à jour](../install/updates).

### Sauvegardes {#backups}

[[ui:backups]] indique si les sauvegardes sont saines, la dernière sauvegarde, la prochaine exécution, l’agent de sauvegarde et le stockage des sauvegardes. Sélectionnez [[ui:backupRun]] pour lancer une sauvegarde. [[ui:backupPoints]] liste les points de restauration ; vous pouvez vérifier chaque octet d’un point ou l’épingler. [[ui:backupPlan]] définit l’heure quotidienne, le fuseau horaire et le nombre de points à conserver. La restauration est une commande à exécuter sur le serveur. Voir [Sauvegardes](../operate/backups).

### Premiers pas et référence de l’API {#getting-started-and-api-reference}

[[ui:navStart]] présente ce qu’il faut faire en premier sur un nouveau serveur. [[ui:help]] liste des exemples de commandes. [[ui:helpLoad]] affiche les opérations d’API que votre compte ou votre clé actuel peut appeler.

## Commentaires {#feedback}

Une fois connecté, [[ui:reportOpen]] envoie un message à ProAnimaStudio par l’intermédiaire du hub. Vous pouvez ajouter jusqu’à 6 images et une adresse e-mail pour recevoir une réponse. Les administrateurs peuvent joindre le journal du serveur. Sélectionnez [[ui:reportShow]] pour voir exactement ce qui est envoyé.

## Apparence et langue {#appearance-and-language}

[[ui:theme]] propose trois options : [[ui:system]], [[ui:light]] et [[ui:dark]]. [[ui:language]] liste chaque langue de la console sous son propre nom : English, Русский, Español, Français, Deutsch, Português, 中文, 日本語, 한국어, हिन्दी et العربية. La page change aussitôt, sans rechargement et sans perdre ce que vous avez saisi ; en arabe, elle se lit de droite à gauche. À la première visite, la console suit les langues du navigateur et se rabat sur l’anglais. [[ui:helpDocs]] dans [[ui:help]] ouvre cette documentation dans la langue de la console. Le navigateur n’enregistre que le thème et la langue, rien sur votre compte ni sur vos dépôts.

## Pages associées {#related-pages}

- [Démarrage rapide](./quick-start)
- [Concepts](./concepts)
- [Comptes et accès](../use/accounts)
- [Dépannage](../operate/troubleshooting)
