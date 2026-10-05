---
title: Images de conteneurs
description: Envoyez et récupérez des images Docker et OCI, des charts Helm et des artefacts ORAS via le registre que chaque dépôt expose sous /v2.
---

# Images de conteneurs

Chaque dépôt Arkvory est aussi un registre de conteneurs. Docker, Podman, Buildx, containerd, Helm et ORAS y envoient des données et en récupèrent avec le protocole OCI Distribution. Les couches et les manifestes d’image sont stockés comme des artefacts ordinaires. Les autorisations du dépôt, les quotas, les vérifications SHA-256, les sauvegardes et les miroirs s’y appliquent comme à tout autre fichier.

## Avant de commencer {#before-you-start}

Il vous faut :

- L’adresse du serveur avec HTTPS et un certificat de confiance, par exemple `arkvory.example`. Voir [HTTPS](../install/https).
- Un dépôt, par exemple `releases`.
- Une clé : un jeton d’accès personnel ou une clé de service. Voir [Comptes et clés](../use/accounts).

Le registre répond à la racine de l’hôte, sous `/v2/`. Il ne peut pas fonctionner sous un préfixe de chemin tel que `https://example.com/arkvory/`, car Docker n’en prend pas en charge. Un proxy inverse doit transmettre `/v2/` sans le modifier et ne doit pas mettre les corps de requête en mémoire tampon. Dans nginx, définissez `client_max_body_size 0` et désactivez la mise en mémoire tampon des requêtes.

## Noms d’images {#image-names}

Une référence d’image a cette forme :

```text
<host>/<repository>/<image>:<tag>
<host>/<repository>/<image>@sha256:<digest>
```

Le premier segment du chemin est le dépôt Arkvory. C’est la frontière d’accès : une clé ne voit que les dépôts qui lui sont accordés. Le reste est le nom de l’image, avec un ou plusieurs composants.

| Référence                                   | Dépôt      | Image           | Partie de la référence |
| ------------------------------------------- | ---------- | --------------- | ---------------------- |
| `arkvory.example/releases/web:1.4`          | `releases` | `web`           | tag `1.4`              |
| `arkvory.example/releases/team/web:1.4`     | `releases` | `team/web`      | tag `1.4`              |
| `arkvory.example/qa/tools/builder@sha256:…` | `qa`       | `tools/builder` | digest                 |

| Élément | Règle                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dépôt   | Lettres minuscules, chiffres, `_` et `-`. Commence par une lettre ou un chiffre. 64 caractères au plus.                                                            |
| Image   | Composants séparés par `/`. Un composant comporte des lettres minuscules et des chiffres, reliés par `.`, `_`, `__` ou des tirets. 200 caractères au plus en tout. |
| Tag     | Lettres, chiffres, `_`, `.` et `-`. Commence par une lettre, un chiffre ou `_`. 128 caractères au plus.                                                            |
| Digest  | `sha256:` suivi de 64 chiffres hexadécimaux en minuscules. Les autres algorithmes sont refusés.                                                                    |

Une référence sans partie image, comme `arkvory.example/web:1.4`, est refusée avec `NAME_INVALID` : `web` est pris pour le dépôt, et le nom de l’image est vide.

## Se connecter {#log-in}

Le registre prend la clé Arkvory comme mot de passe de l’authentification HTTP Basic. Le nom d’utilisateur n’est pas vérifié : utilisez n’importe quel nom, par exemple celui du job de CI. Une requête peut aussi envoyer la clé sous la forme `Authorization: Bearer <key>`. Vous n’avez besoin d’aucun service de jetons distinct.

```bash
docker login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

```powershell
Get-Content C:\Private\arkvory.key | docker login arkvory.example -u ci --password-stdin
```

Les autres clients se connectent de la même manière :

```bash
podman login arkvory.example -u ci --password-stdin < ~/.arkvory/key
helm registry login arkvory.example -u ci --password-stdin < ~/.arkvory/key
oras login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

| Clé                                          | À utiliser pour                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Jeton d’accès personnel, portée `read`       | Récupérer des images (pull) depuis un poste de travail                              |
| Jeton d’accès personnel, portée `read-write` | Envoyer des images (push) depuis un poste de travail                                |
| Clé de service                               | CI/CD et agents de déploiement. Le seul type de clé qui peut supprimer des images.  |
| Clé de fichier du fichier de clés du serveur | Le propriétaire de l’installation et les anciennes intégrations (`read` ou `write`) |

Un jeton personnel expire. Ensuite, chaque requête reçoit `401 UNAUTHORIZED` : créez un nouveau jeton et reconnectez-vous. Docker enregistre la clé dans `~/.docker/config.json`, sauf si vous configurez un assistant d’identifiants (credential helper). Protégez ce fichier ou utilisez un magasin d’identifiants.

## Push et pull {#push-and-pull}

```bash
docker tag web:1.4 arkvory.example/releases/team/web:1.4
docker push arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web@sha256:<digest>
```

Ce que fait le registre :

- Une couche que le dépôt possède déjà n’est pas stockée de nouveau, même si une autre image l’utilise.
- Les couches ne sont pas partagées entre les dépôts. Une demande de montage d’une couche depuis un autre dépôt reçoit une session de téléversement ordinaire : le client renvoie donc la couche.
- Chaque couche et chaque manifeste est comparé à son digest SHA-256. En cas de différence, rien n’est stocké et la réponse est `DIGEST_INVALID`.
- Un manifeste n’est accepté que si tout ce qu’il référence se trouve déjà dans le dépôt : la configuration et les couches d’une image, ou les manifestes de plateforme d’un index. Les manifestes de plateforme doivent se trouver dans la même image que leur index. Sinon, la réponse est `MANIFEST_BLOB_UNKNOWN`.
- Les téléchargements de couches prennent en charge les requêtes `Range`.

Le registre accepte ces types de manifeste :

| Type de média                                               | Utilisé pour                                        |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `application/vnd.oci.image.manifest.v1+json`                | Images OCI, charts Helm, artefacts ORAS             |
| `application/vnd.oci.image.index.v1+json`                   | Images multiplateformes, cache de registre BuildKit |
| `application/vnd.docker.distribution.manifest.v2+json`      | Images Docker (schéma 2)                            |
| `application/vnd.docker.distribution.manifest.list.v2+json` | Images Docker multiplateformes                      |

Un manifeste porte `schemaVersion: 2` et pèse au plus 4 MiB. Le schéma 1 de Docker n’est pas pris en charge. Le type provient de l’en-tête `Content-Type` ou du champ `mediaType` du manifeste, et les deux doivent concorder. Un pull renvoie le manifeste exactement tel qu’il a été envoyé, avec son propre type de média. Le registre ne convertit pas d’un format à l’autre.

### Images multiplateformes {#multi-platform-images}

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t arkvory.example/releases/team/web:1.4 --push .
```

Buildx envoie chaque manifeste de plateforme par son digest, puis l’index sous le tag. Tous vont vers le même nom d’image, comme le registre l’exige.

### Cache de build {#build-cache}

Un builder BuildKit capable d’exporter un cache, par exemple un builder `docker buildx` avec le pilote `docker-container`, peut conserver son cache de registre dans Arkvory :

```bash
docker buildx build \
  --cache-from type=registry,ref=arkvory.example/releases/team/web:cache \
  --cache-to type=registry,ref=arkvory.example/releases/team/web:cache,mode=max \
  -t arkvory.example/releases/team/web:1.4 --push .
```

L’index du cache liste des couches et une configuration de cache. Arkvory les stocke comme des blobs de l’image et les protège comme les couches de tout manifeste stocké.

### Charts Helm {#helm-charts}

Helm stocke les charts sous forme d’artefacts OCI. Après `helm registry login` :

```bash
helm push web-1.4.0.tgz oci://arkvory.example/releases/charts
helm pull oci://arkvory.example/releases/charts/web --version 1.4.0
helm install web oci://arkvory.example/releases/charts/web --version 1.4.0
```

Le chart devient l’image `charts/web` avec le tag `1.4.0` dans le dépôt `releases`. Arkvory n’a pas de dépôt de charts classique avec un fichier `index.yaml`.

### Artefacts ORAS {#oras-artifacts}

ORAS stocke des fichiers quelconques comme couches d’un manifeste OCI :

```bash
oras push arkvory.example/releases/tools/settings:1.0 ./settings.json:application/json
oras pull arkvory.example/releases/tools/settings:1.0
```

L’API Referrers n’est pas disponible : `/v2/<name>/referrers/<digest>` répond `404`. Les clients qui suivent la spécification OCI, comme ORAS, conservent alors les artefacts attachés sous des tags nommés d’après le digest.

## Tags et digests {#tags-and-digests}

- Envoyer un manifeste sous un tag déplace le tag. Le manifeste que le tag désignait auparavant reste dans le registre et peut toujours être récupéré par son digest.
- Un push par digest (`PUT /v2/<name>/manifests/sha256:…`) stocke le manifeste sans tag. Le digest doit être le SHA-256 du corps.
- Les tags sont listés dans l’ordre des octets : les majuscules viennent donc avant les minuscules.

Lister les tags d’une image :

```bash
curl -fsS -u "ci:$ARKVORY_KEY" https://arkvory.example/v2/releases/team/web/tags/list
```

La réponse est `{"name": "releases/team/web", "tags": [...]}`. Utilisez `n` pour la taille de page (100 par défaut, 1000 au plus) et `last` pour le dernier tag de la page précédente. Lorsqu’il reste des tags, l’en-tête `Link` contient l’adresse de la page suivante.

Trouver le digest d’un tag :

```bash
curl -fsSI -u "ci:$ARKVORY_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/1.4 | grep -i docker-content-digest
```

Il n’existe pas de catalogue de toutes les images (`/v2/_catalog`). Dans la console, les couches et les manifestes apparaissent parmi les artefacts du dépôt avec l’étiquette `oci`, nommés d’après leur digest. Utilisez [[ui:labelFilter]] dans [[ui:catalog]] pour les afficher.

## Supprimer des images et libérer de l’espace {#delete-images}

Vous supprimez des images par l’API du registre. La ligne de commande Docker n’a pas de commande pour cela : utilisez `curl`, `oras manifest delete` ou un autre outil de registre.

| Requête                                | Effet                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `DELETE /v2/<name>/manifests/<tag>`    | Supprime le tag uniquement. Le manifeste reste et peut être récupéré par son digest. |
| `DELETE /v2/<name>/manifests/<digest>` | Supprime le manifeste et tous les tags qui y pointent                                |
| `DELETE /v2/<name>/blobs/<digest>`     | Refusé avec `405`. Les couches disparaissent avec leurs manifestes.                  |

Les deux suppressions exigent une clé de service avec l’action `artifact.delete` dans le dépôt. Les jetons personnels, les sessions de console et les clés de fichier ne peuvent pas supprimer d’images. Une suppression répond `202`.

```bash
curl -fsS -X DELETE -H "Authorization: Bearer $ARKVORY_CLEANUP_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/sha256:<digest>
```

Comment l’espace est libéré :

1. Tant qu’un manifeste est stocké, avec ou sans tag, Arkvory le protège ainsi que chaque couche qu’il référence. La rétention les ignore, avec le motif de blocage `reference`.
2. Déplacer ou supprimer un tag ne libère rien. Les anciens manifestes gardent leurs couches tant que vous ne supprimez pas ces manifestes par digest.
3. Une fois un manifeste supprimé par digest, son artefact et les couches qu’aucun autre manifeste n’utilise perdent cette protection. Ils restent stockés jusqu’à ce que quelqu’un les retire par la rétention ou les supprime en tant qu’artefacts. Voir [Stockage](../operate/storage).
4. Une couche envoyée sans manifeste, par exemple lors d’un push qui a échoué, n’est pas protégée.
5. Lorsqu’une couche supprimée redevient nécessaire, le registre la signale comme inconnue, et le push suivant la téléverse de nouveau.

## Autorisations {#permissions}

Les jetons personnels et les clés de fichier obtiennent un accès en lecture ou en écriture à un dépôt. Les clés de service obtiennent des actions précises.

| Opération                               | Actions de la clé de service                       | Jeton personnel ou clé de fichier                         |
| --------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Récupérer des manifestes et des couches | `content.read`                                     | Accès en lecture                                          |
| Lister les tags                         | `artifact.list`                                    | Accès en lecture                                          |
| Push                                    | `upload.create`, `upload.write`, `upload.complete` | Accès en écriture ; un jeton exige la portée `read-write` |
| Supprimer un tag ou un manifeste        | `artifact.delete`                                  | Impossible                                                |

Une clé de CI qui fait des push fait généralement aussi des pull, par exemple pour les images de base ou le cache de build. Donnez-lui aussi `content.read` et `artifact.list`. Un dépôt auquel la clé n’a pas accès répond `403 DENIED`.

## Passerelles de lecture et miroirs {#read-gateways-and-mirrors}

- Une [passerelle de lecture](../operate/read-gateways) sert les pull. Un push reçoit `405`.
- Un [miroir](../operate/mirrors) reçoit les images de sa source avec leurs tags et leurs suppressions. Les clients font leurs pull sur le miroir, à sa propre adresse. Un push reçoit `409 DENIED` avec la raison `mirror_read_only`.

## Limites {#limits}

| Limite                       | Valeur                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Taille d’un manifeste        | 4 MiB                                                                                                                                                                                              |
| Taille d’une couche          | Le plus gros objet de l’installation, `ARKVORY_MAX_OBJECT_BYTES` (environ 10 TiB par défaut)                                                                                                       |
| Une requête de téléversement | Doit se terminer en 30 minutes et ne pas rester inactive plus de 30 secondes (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). 30 minutes est aussi la valeur maximale autorisée.  |
| Téléversement inachevé       | Supprimé avec ses octets après 24 heures sans activité                                                                                                                                             |
| Espace disque temporaire     | Jusqu’au double de la taille de la couche pendant son téléversement                                                                                                                                |
| Téléversements simultanés    | 1 par clé et 2 par serveur par défaut (`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`, `ARKVORY_MAX_UPLOADS`). Une requête en attente abandonne au bout de 20 secondes (`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`). |
| Téléchargements simultanés   | 4 par clé et 16 par serveur par défaut                                                                                                                                                             |
| Tags par page                | 1000                                                                                                                                                                                               |
| Quota                        | Les couches, les manifestes et les octets des téléversements inachevés comptent dans le quota du dépôt et dans la capacité de l’installation                                                       |

Docker envoie chaque couche en une seule requête. Une couche doit donc arriver dans le délai de téléversement, et le téléversement d’une couche qui échoue repart du premier octet. Pour des fichiers de plusieurs gigaoctets, utilisez plutôt [`arkvoryctl`](./cli) : il téléverse par parties et reprend après un échec. Les variables sont décrites dans [Variables d’environnement](../reference/environment#transfers-and-bandwidth).

## Non pris en charge {#not-supported}

- L’API Referrers. Elle répond `404`, et les clients se rabattent sur les tags.
- Le catalogue de toutes les images, `/v2/_catalog`.
- Le montage de couches depuis un autre dépôt. Le client téléverse de nouveau la couche.
- Un service de jetons pour les jetons Bearer. Envoyez la clé elle-même, en Basic ou en Bearer.
- Un cache pull-through de Docker Hub ou d’autres registres.
- Les manifestes Docker de schéma 1 et les digests autres que `sha256`.
- La suppression de couches individuelles.
- Une section pour les images dans la console.

## HTTP simple pour les tests {#plain-http-for-tests}

Docker refuse un registre sans HTTPS. Par défaut, seules les adresses de l’ordinateur local (`localhost`, `127.0.0.0/8`) fonctionnent en HTTP simple. Pour un serveur de test sur un autre hôte, ajoutez-le à `insecure-registries` dans la configuration du démon Docker (`/etc/docker/daemon.json` sous Linux) et redémarrez Docker :

```json
{
  "insecure-registries": ["arkvory.test:8080"]
}
```

Podman utilise l’option `--tls-verify=false`. En HTTP simple, la clé circule en clair. N’employez cette méthode que sur un réseau de test.

Pour un certificat émis par votre propre autorité de certification, Docker sous Linux lit l’autorité dans `/etc/docker/certs.d/<host>/ca.crt` (avec le port, s’il n’est pas 443). Docker Desktop utilise le magasin de certificats du système.

## Dépannage {#troubleshooting}

Docker affiche les codes d’erreur du registre en minuscules et avec des espaces, par exemple `denied` ou `name invalid`, suivis du message du serveur. Chaque erreur porte aussi un ID de requête dans `detail.requestId`. Communiquez-le à votre administrateur : il retrouvera la requête dans le journal du serveur.

| Erreur                                            | Cause                                                                                                                    | Que faire                                                                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED` (401)                              | La clé est absente, incorrecte, expirée ou révoquée                                                                      | Reconnectez-vous avec une clé valide                                                                                                                                                                                          |
| `DENIED` (403)                                    | La clé ne peut pas écrire ou ne voit pas le dépôt. Un jeton de portée `read` reçoit « Read-only personal access token ». | Utilisez une clé avec accès en écriture à ce dépôt                                                                                                                                                                            |
| `DENIED` (409)                                    | Le dépôt est un miroir                                                                                                   | Faites le push vers le serveur principal                                                                                                                                                                                      |
| `DENIED` (507)                                    | Le quota du dépôt ou la capacité de l’installation est atteint. Les téléversements inachevés comptent aussi.             | Libérez de l’espace ou demandez un quota plus grand                                                                                                                                                                           |
| `NAME_INVALID`                                    | La référence n’a pas de partie image après le dépôt, ou elle contient des majuscules                                     | Utilisez `<host>/<repository>/<image>:<tag>` en minuscules                                                                                                                                                                    |
| `MANIFEST_UNKNOWN`                                | Le tag ou le digest n’existe pas dans cette image                                                                        | Vérifiez le nom avec `tags/list`                                                                                                                                                                                              |
| `MANIFEST_BLOB_UNKNOWN`                           | Un manifeste référence une couche ou un manifeste de plateforme absent de ce dépôt                                       | Renvoyez toute l’image pour que le client téléverse les parties manquantes                                                                                                                                                    |
| `DIGEST_INVALID`                                  | Les octets ne correspondent pas au digest                                                                                | Recommencez le push. Si le problème se répète, vérifiez le proxy.                                                                                                                                                             |
| `TOOMANYREQUESTS` (503 ou 429)                    | Trop de transferts simultanés pour cette clé, ou le serveur est occupé                                                   | Attendez et réessayez. Réduisez les téléversements parallèles du client, par exemple `"max-concurrent-uploads": 1` dans la configuration du démon Docker, ou demandez à l’administrateur de relever les limites de transfert. |
| `http: server gave HTTP response to HTTPS client` | Le serveur n’a pas HTTPS                                                                                                 | Configurez [HTTPS](../install/https), ou utilisez `insecure-registries` pour un serveur de test                                                                                                                               |
| `x509: certificate signed by unknown authority`   | Docker ne fait pas confiance au certificat                                                                               | Installez le certificat de l’autorité comme décrit ci-dessus                                                                                                                                                                  |
| `413 Request Entity Too Large`                    | Le proxy inverse limite la taille des requêtes                                                                           | Définissez `client_max_body_size 0` dans nginx                                                                                                                                                                                |
| Une grosse couche s’arrête au bout de 30 minutes  | Le délai d’une requête de téléversement                                                                                  | Utilisez un réseau plus rapide, ou gardez ces fichiers hors des images et téléversez-les avec `arkvoryctl`                                                                                                                    |

## Pages associées {#related-pages}

- [Clients et protocoles](./index)
- [Comptes et clés](../use/accounts)
- [HTTPS](../install/https)
- [Stockage](../operate/storage)
- [Miroirs](../operate/mirrors) et [Passerelles de lecture](../operate/read-gateways)
