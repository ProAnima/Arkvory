---
title: Miroirs et un second site
description: 'Conservez une copie en lecture seule de dépôts sur une seconde installation, surveillez sa synchronisation et basculez vers elle lorsque la source est perdue.'
---

# Miroirs et un second site

Un **miroir** est un dépôt sur une installation Arkvory qui est une copie en lecture seule d’un dépôt d’une autre installation, la **source**. L’installation miroir tire les changements de la source via HTTPS. Elle conserve sa propre base de données, son propre stockage, ses propres comptes et ses propres clés.

Utilisez un miroir pour servir les téléchargements depuis un second emplacement, et pour conserver un second site capable de prendre le relais lorsque la source est perdue. Un miroir n’est pas une sauvegarde de la source, et ce n’est pas une haute disponibilité automatique. Vous effectuez la bascule vous-même. Pour d’autres protections, voir [Sauvegardes](./backups) et [Passerelles de lecture](./read-gateways).

## Ce qu’est un miroir {#what-a-mirror-is}

Pour un dépôt mis en miroir, l’installation miroir copie :

- Les fichiers publiés, avec leurs octets et les **mêmes ID d’artefact** que sur la source.
- Les étiquettes, les métadonnées et les collections.
- L’enregistrement UPack, les étapes et les chemins de fichiers actuels.
- Les images de conteneurs, les objets Git LFS et les paquets npm du dépôt.
- Les suppressions. Un fichier supprimé sur la source est supprimé sur le miroir.

Les téléchargements par ID, par paquet (version, plage, étape) et par chemin de fichier répondent sur le miroir comme ils le faisaient sur la source à la dernière synchronisation. Ils continuent de fonctionner lorsque la source est indisponible.

Un miroir ne copie pas :

- Les comptes, les groupes, les clés et les autorisations. Le miroir a les siens, et ils sont indépendants : révoquer une clé sur la source n’affecte pas le miroir.
- Les références qui protègent les fichiers du nettoyage, les pièces jointes des builds, les pistes d’audit et les politiques de stockage.
- L’historique des chemins de fichiers antérieur à la première synchronisation. Les numéros de révision des étiquettes et des chemins sur le miroir lui sont propres.

Les clients ne peuvent pas écrire dans un dépôt mis en miroir. Les téléversements, les changements d’étiquettes, les chemins de fichiers, les étapes, la suppression et la promotion y reçoivent HTTP 409 avec la raison `mirror_read_only`. Les autres dépôts de l’installation miroir fonctionnent normalement. Les politiques de stockage ne s’exécutent pas dans un dépôt mis en miroir, et seule la synchronisation y supprime.

## Configurer un miroir {#set-up}

Il vous faut une clé sur la source et une commande sur le miroir.

### Créer une clé sur la source {#source-key}

Le miroir a besoin d’une clé qui ne peut que lire le dépôt source. Une clé d’écriture n’est pas nécessaire.

1. Sur la source, ouvrez [[ui:services]] avec la clé de récupération ou une clé d’opérateur.
2. Sélectionnez [[ui:serviceCreate]], et dans [[ui:servicePolicy]] ajoutez le dépôt. Sélectionnez [[ui:bindingRead]] pour renseigner les autorisations dont un miroir a besoin. Elles incluent `artifact.list`, `artifact.read`, `content.read`, `annotation.read`, `asset.read` et `package.read`.
3. Sélectionnez [[ui:keyIssue]], copiez le secret, confirmez [[ui:keySaved]] et sélectionnez [[ui:keyActivate]]. Une clé non activée expire après 15 minutes.
4. Enregistrez le secret dans un fichier sur le serveur miroir. Le fichier ne contient que la clé, sur une ligne, 16 à 4000 caractères imprimables. Seuls root ou le groupe Administrateurs peuvent le lire.

La source doit être une version avec le flux de changements. La commande de l’étape suivante le vérifie.

### Attacher le dépôt sur le miroir {#attach}

Utilisez un nom de dépôt **nouveau et vide** sur le miroir. La synchronisation rend le dépôt identique à la source, mais elle ne supprime jamais ce que la source n’a jamais eu.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases \
  --mirror-upstream https://arkvory.example \
  --mirror-token-file /root/mirror-releases.key
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root `
  --mirror releases --mirror-upstream https://arkvory.example `
  --mirror-token-file C:\secure\mirror-releases.key
```

| Option                     | Signification                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--mirror NAME`            | Le dépôt sur cette installation. 1–64 caractères : lettres minuscules, chiffres, `_` et `-`, en commençant par une lettre ou un chiffre                              |
| `--mirror-upstream URL`    | L’origine de la source : `https://host`, sans chemin, sans identifiants et sans requête. `http://` simple n’est accepté que pour `localhost`, `127.0.0.1` et `[::1]` |
| `--mirror-token-file FILE` | Un chemin absolu vers le fichier de clé                                                                                                                              |
| `--mirror-source NAME`     | Le dépôt sur la source. Par défaut : le même nom que `--mirror`                                                                                                      |
| `--mirror-ca-file FILE`    | Un fichier PEM avec l’autorité de certification de la source. Voir [HTTPS avec votre propre autorité de certification](#ca-file)                                     |

Donnez un seul dépôt à une seule commande. Vous ne pouvez pas combiner une modification de miroir avec des modifications de HTTPS, du stockage des sauvegardes ou des mises à jour dans le même appel.

1. La commande vérifie la source avec la clé avant de modifier quoi que ce soit. La source doit annoncer le flux de changements des miroirs, et le flux du dépôt source doit répondre.
2. Elle stocke la clé dans `config/mirrors/NAME.token`, écrit `config/mirrors/mirrors.json` et définit `ARKVORY_MIRRORS_FILE` dans `config/runtime.json`.
3. Elle redémarre l’API et le worker et attend qu’ils soient prêts. Si quelque chose échoue, elle restaure les fichiers précédents et redémarre à nouveau.

Dans Docker Compose, la commande écrit aussi `config/compose.mirrors.yml`, qui monte les fichiers de miroir dans les conteneurs de l’API et du worker. Ajoutez-la aux commandes Compose que vous exécutez vous-même.

Répétez la commande avec un nouveau `--mirror-token-file` pour remplacer la clé d’un dépôt. Le worker relit le fichier de clé après chaque échec, donc une nouvelle clé fonctionne sans redémarrage. Un dépôt qui met déjà en miroir une source refuse une autre source avec le message `NAME mirrors another source; detach it first`.

Sur l’installation miroir, donnez aux personnes et aux outils l’accès au dépôt. Un dépôt existe dès qu’une autorisation ou une politique de service le nomme. Utilisez [[ui:manageGrants]] dans [[ui:administration]] pour les personnes, et une politique de service pour les outils. Les autorisations de la source ne sont pas transférées.

### HTTPS avec votre propre autorité de certification {#ca-file}

Si la source utilise un certificat d’une autorité d’entreprise ou auto-signée, ajoutez `--mirror-ca-file /path/ca.pem` à la commande `--mirror`. La commande vérifie que chaque certificat peut être lu et n’a pas expiré, et elle stocke 1 à 64 certificats dans `config/mirrors/ca.pem` (le fichier ne peut pas dépasser 1 MiB). Le worker leur fait alors confiance en plus des certificats standard.

- Le fichier sert tous les miroirs de l’installation. Un nouveau `--mirror-ca-file` s’y ajoute, et un certificat déjà présent n’est conservé qu’une fois. Détacher le dernier miroir supprime le fichier.
- Le worker fait confiance à l’ensemble pour toutes ses connexions, pas seulement pour un miroir.
- La vérification des certificats n’est jamais désactivée.

## Ce qui est copié et à quelle fréquence {#sync}

Le worker de l’installation miroir effectue la synchronisation. Il n’y a pas de service distinct. Pour chaque dépôt mis en miroir, il exécute ces étapes :

1. **Remplissage initial.** Le worker note la position actuelle du flux de changements de la source. Il lit ensuite la liste des artefacts, des paquets et des chemins de fichiers page par page et rend le miroir identique.
2. **Suivi.** Le worker lit le flux de la source. Lorsqu’il est à jour, il vérifie à nouveau toutes les 10 secondes. Il enregistre sa position après chaque changement appliqué.
3. **Copie des fichiers.** Un fichier est copié par parties. Le worker vérifie le SHA-256 de chaque partie et du fichier entier. Après une interruption, il reprend à la première partie manquante. Une partie attend dans `mirror-staging` à l’intérieur du répertoire de stockage du miroir.
4. **Après une erreur.** Le worker répète l’étape après une pause qui commence à 2 secondes et double jusqu’à 5 minutes. Un miroir en échec n’arrête pas les autres.

Une installation peut avoir jusqu’à 64 dépôts mis en miroir. Les copies comptent dans la limite de capacité et sur le disque du miroir, donc prévoyez le même espace que celui dont le dépôt source a besoin. Voir [Stockage](./storage).

Si la clé de la source est révoquée ou si la source est inaccessible, le miroir continue de servir ce qu’il possède déjà et affiche l’erreur dans son état.

## Vérifier l’état de synchronisation {#status}

### Dans la console {#status-console}

Connectez la console de l’installation miroir au dépôt mis en miroir. Au-dessus du catalogue, un badge indique l’état :

- [[ui:mirrorBadge]] signifie que le miroir est à jour.
- [[ui:mirrorBehind]] signifie qu’il copie encore, ou qu’il n’a pas encore commencé.
- [[ui:mirrorFailing]] signifie que la dernière tentative a échoué. Les téléchargements continuent de fonctionner.

Ouvrez l’aide du badge ([[ui:mirrorHelpLabel]]) pour voir la source, l’heure de la dernière synchronisation et le code d’erreur. La console masque les boutons de téléversement et de modification dans un dépôt mis en miroir.

### Avec l’API {#status-api}

[getRepositoryMirror](../api/reference/mirrors#getRepositoryMirror) renvoie l’état d’un dépôt. Il nécessite le droit de lire le dépôt. Pour un dépôt ordinaire, la réponse est 404.

| Champ                            | Signification                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                           | `mirror` ou `import`                                                                                                              |
| `phase`                          | `pending` (le worker n’a pas commencé), `seeding` (remplissage initial) ou `following`                                            |
| `caughtUp`                       | `true` lorsque la position enregistrée égale la position la plus récente de la source. `null` avant la fin du remplissage initial |
| `checkedAt`, `syncedAt`          | Quand le worker a lu le flux pour la dernière fois, et quand il a été à jour pour la dernière fois                                |
| `copiedArtifacts`, `copiedBytes` | Totaux copiés jusqu’ici (`copiedBytes` est une chaîne décimale)                                                                   |
| `errorCode`, `errorAt`           | Le dernier échec d’une étape, ou `null`                                                                                           |

### Codes d’erreur {#error-codes}

| `errorCode`             | Signification et marche à suivre                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_mismatch`       | Le même ID d’artefact a un contenu différent sur la source. Le miroir conserve son fichier. Enquêtez sur l’artefact ; ne supprimez aucune des deux copies avant d’en connaître la cause                                     |
| `mirror_source_changed` | Le dépôt contient déjà une copie d’une autre source. Détachez-le, ou mettez en miroir la nouvelle source dans un nouveau dépôt                                                                                              |
| `mirror_source_behind`  | La source a été restaurée ou réinstallée, et son flux est en retard par rapport au miroir. Le miroir le relit, et le code disparaît lorsqu’il est à jour. Les fichiers absents de la source restaurée restent sur le miroir |
| `mirror_delete_blocked` | La source a supprimé un fichier que le miroir ne peut pas supprimer, car quelque chose ici l’utilise encore, comme une référence ou un historique de chemin de fichier                                                      |
| `mirror_failed`         | Un échec sans code plus précis. Lisez le journal du worker                                                                                                                                                                  |
| autres codes            | Le code de la requête échouée, par exemple `unauthorized` lorsque la clé a été révoquée ou `capacity_exceeded` lorsque le miroir est plein                                                                                  |

Le journal du worker (`component` vaut `mirror`) contient `mirror.started`, `mirror.step_failed` avec `errorCode` et `attempts`, `mirror.recovered` et `mirror.stopped`.

## Superviser les miroirs {#monitoring}

L’API de l’installation miroir expose trois métriques pour chaque dépôt mis en miroir, avec les étiquettes `repository` et `mode` :

- `arkvory_mirror_last_sync_timestamp_seconds` : la dernière fois que le miroir a été à jour.
- `arkvory_mirror_last_check_timestamp_seconds` : la dernière fois qu’il a lu le flux.
- `arkvory_mirror_failing` : 1 tant que la dernière tentative a échoué.

Les règles Prometheus prêtes à l’emploi sont `ArkvoryMirrorStale` (pas à jour depuis plus d’une heure) et `ArkvoryMirrorFailing` (l’échec dure 15 minutes). Voir [Supervision](./monitoring). Un miroir que le worker n’a pas encore atteint n’a pas d’heure de synchronisation, donc la règle stale ne se déclenche pas avant sa première synchronisation.

## Import par étape {#import}

Avec `--mirror-stages`, le dépôt de la seconde installation n’est **pas** un miroir. C’est un dépôt ordinaire accessible en écriture qui reprend les versions portant l’une des étapes de la source. Utilisez-le pour déplacer des builds d’un serveur de développement vers un serveur de production.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases --mirror-upstream https://dev.example \
  --mirror-token-file /root/dev.key --mirror-stages release
```

- Vous listez 1 à 16 noms d’étapes différents, séparés par des virgules.
- Une version est copiée une seule fois, avec le même ID, les mêmes octets, les mêmes étiquettes et le même enregistrement UPack, et avec les étapes correspondantes.
- Ensuite, elle appartient à cette installation. Les modifications, le retrait d’étape et la suppression sur la source ne l’atteignent pas. Une version que vous supprimez ici n’est jamais réimportée.
- Les téléversements et la politique de stockage du dépôt fonctionnent normalement.
- Les données de registre d’images de conteneurs, Git LFS et npm ne sont pas transférées.
- Un changement d’étapes démarre un nouveau remplissage initial. Il ne fait qu’ajouter et ignore ce qui est déjà présent.

La console affiche le badge [[ui:mirrorImport]], ou [[ui:mirrorImportFailing]] lorsque la dernière tentative a échoué. La clé sur la source a besoin des mêmes autorisations en lecture seule que pour un miroir.

## Basculer lorsque la source est perdue {#failover}

Il s’agit d’un basculement manuel pour deux installations indépendantes sur deux sites. Il n’est pas automatique. Les changements que le miroir n’avait pas encore tirés sont perdus.

### Préparer à l’avance {#failover-prepare}

1. Installez le second site avec la même version que la source lorsque vous le pouvez, avec son propre PostgreSQL et son propre disque. Les deux sites ne partagent rien.
2. Créez une clé en lecture seule sur la source et attachez chaque dépôt comme miroir. Un dépôt créé plus tard sur la source n’apparaît pas tout seul sur le miroir, donc attachez-le de la même manière.
3. Sur le miroir, émettez les clés que vos consommateurs utiliseront, y compris des clés capables d’écrire après la bascule. Les autorisations de la source ne sont pas transférées, donc une source compromise ne donne pas accès au miroir.
4. Configurez les consommateurs (CI, agents de déploiement) avec l’adresse du miroir comme solution de repli pour les téléchargements. Cela soulage aussi le lien vers la source.
5. Sauvegardez la source dans un stockage des sauvegardes en dehors de son site. Voir [Sauvegardes](./backups). Un miroir ne remplace pas cela.
6. Supervisez le miroir avec les règles ci-dessus.

### Bascule {#failover-switch}

1. Assurez-vous que la source est vraiment indisponible pour les clients et qu’elle ne reviendra pas d’elle-même. Deux sites qui acceptent tous deux des écritures vers un même dépôt logique ne peuvent pas être fusionnés plus tard. Si la source est partiellement joignable, arrêtez ses services ou fermez son port.
2. Sur le miroir, lisez `syncedAt` de chaque dépôt. Les changements sur la source après cette heure ne sont pas sur le miroir.
3. Détachez chaque dépôt mis en miroir sur le miroir. Il devient un dépôt ordinaire accessible en écriture avec les mêmes ID d’artefact et toutes ses données.

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory --mirror-detach releases
   ```

   La commande redémarre l’API et le worker, attendez-vous donc à une courte interruption.

4. Faites pointer les clients qui écrivent vers le miroir, via le DNS ou la configuration de votre CI.
5. Téléversez et téléchargez un fichier de contrôle sur le miroir.

Ce que voient les clients :

- Avant la bascule, les téléchargements depuis le miroir fonctionnent, et les écritures reçoivent 409 `mirror_read_only`.
- Après le détachement, les écritures fonctionnent. Le badge disparaît.
- Les clés et les mots de passe de la source ne fonctionnent pas sur le miroir, sauf si vous y avez créé les mêmes comptes.

Il n’y a pas de retour en arrière. Ne rattachez pas un dépôt détaché comme miroir. Pour faire revenir l’ancienne source, videz-la ou réinstallez-la et attachez les dépôts du nouveau primaire comme miroirs. N’exécutez jamais l’ancienne source et le nouveau primaire côte à côte avec les écritures activées.

### Répéter l’exercice {#failover-rehearse}

Répétez la bascule chaque trimestre et après les mises à jour. Détachez un dépôt sur une copie de secours, vérifiez `syncedAt`, un téléchargement et un téléversement, et notez la date et le résultat. Testez séparément la restauration d’une sauvegarde de la source dans une installation vide. Voir [Tester régulièrement une restauration](./backups#test-restore).

## Limites {#limits}

- Un miroir est en lecture seule jusqu’à ce que vous le détachiez. Un dépôt détaché ne peut pas redevenir un miroir.
- Le miroir n’est pas une sauvegarde. Il n’a pas de copie des comptes, des clés ou des autorisations, et il ne copie pas les références, les pièces jointes, les pistes d’audit ni les politiques de stockage.
- Le mode import ne copie pas les images de conteneurs, Git LFS ni les données npm.
- Une synchronisation ne fait qu’ajouter et mettre à jour. Après une restauration de la source, les fichiers que la source a perdus restent sur le miroir.
- Les deux installations sont mises à jour séparément. La source doit offrir le flux de changements des miroirs.
- L’ensemble des autorités de confiance de la source s’applique à tout le worker.
- Il n’y a pas de basculement automatique, pas de fencing de l’ancienne source ni de synchronisation inverse.

## Pages associées {#related-pages}

- [Sauvegardes](./backups)
- [Passerelles de lecture](./read-gateways)
- [Stockage](./storage)
- [Supervision](./monitoring)
- [Variables d’environnement](../reference/environment#mirrors)
- [Comptes et accès](../use/accounts)
