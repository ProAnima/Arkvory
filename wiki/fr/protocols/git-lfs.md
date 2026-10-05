---
title: 'Git LFS'
description: 'Stockez les fichiers volumineux d’un dépôt git dans Arkvory et verrouillez les ressources binaires, par exemple pour les projets Unity et Unreal.'
---

# Git LFS

Chaque dépôt Arkvory est un serveur Git LFS. Votre dépôt git reste où il est, par exemple sur GitHub, GitLab ou Gitea. Seuls les fichiers volumineux suivis par Git LFS, ainsi que les verrous de fichiers, vont dans Arkvory. Les objets LFS sont des artefacts ordinaires : les autorisations du dépôt, les quotas, les sommes de contrôle SHA-256, les sauvegardes et les miroirs s’y appliquent.

## Configurer un dépôt git {#set-up}

Vous avez besoin de l’adresse du serveur avec HTTPS (voir [HTTPS](../install/https)), d’un dépôt Arkvory, par exemple `games`, et d’une clé (voir [Comptes et clés](../use/accounts)).

1. Installez Git LFS sur chaque machine qui utilise le dépôt, et exécutez `git lfs install` une fois par utilisateur.
2. Créez le fichier `.lfsconfig` à la racine du dépôt git et validez-le. Il fait utiliser Arkvory à toute l’équipe :

```ini
[lfs]
	url = https://arkvory.example/lfs/games
```

3. Suivez les motifs de fichiers. Cela écrit `.gitattributes`, que vous validez aussi :

```bash
git lfs track "*.psd" "*.fbx" "*.wav" "*.uasset" "*.umap"
git add .gitattributes .lfsconfig
```

4. Validez et poussez comme d’habitude. La première requête demande des identifiants : voir [Se connecter](#sign-in).

L’adresse LFS d’un dépôt est toujours `https://<host>/lfs/<repository>`.

Pour déplacer des fichiers déjà présents dans LFS sur un autre serveur, téléchargez d’abord tous les objets depuis l’ancien serveur, puis changez `lfs.url` et téléversez-les :

```bash
git lfs fetch --all origin
git config lfs.url https://arkvory.example/lfs/games
git lfs push --all origin
```

## Se connecter {#sign-in}

Arkvory utilise sa clé comme mot de passe de l’authentification HTTP Basic. Le nom d’utilisateur n’est pas vérifié : utilisez n’importe quel nom. La clé peut aussi être fournie comme jeton Bearer.

Git demande le nom d’utilisateur et le mot de passe via son gestionnaire d’identifiants la première fois que le serveur répond `401`. Le gestionnaire les enregistre : Git Credential Manager sous Windows et macOS, `credential.helper store` ou `cache` sous Linux.

| Qui                  | Clé                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Développeur          | Un jeton d’accès personnel. Portée `read-write` pour le push et les verrous, portée `read` pour le clone et le pull uniquement. |
| Serveur de build, CI | Une clé de service avec les actions de [Autorisations](#permissions)                                                            |

Git conserve les identifiants par hôte. La clé d’Arkvory ne remplace pas l’identifiant de l’hôte de votre dépôt git, par exemple GitHub.

Sur un runner CI sans gestionnaire d’identifiants, placez la clé dans la configuration locale de la copie de travail. La clé ne vit alors que dans `.git/config` de cet espace de travail, jamais dans `.lfsconfig` :

```bash
git config lfs.url "https://ci:${ARKVORY_KEY}@arkvory.example/lfs/games"
```

Ne validez pas une clé. Ne l’affichez pas dans les journaux. Supprimez l’espace de travail après la tâche.

## Travail quotidien {#daily-work}

Git LFS fonctionne comme avec n’importe quel serveur LFS. Les commandes que vous utilisez :

| Commande                                | Ce qu’elle fait                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `git push`                              | Téléverse les nouveaux objets LFS dans Arkvory avant de pousser les commits                     |
| `git clone`, `git pull`, `git checkout` | Télécharge les objets dont l’arbre de travail a besoin                                          |
| `git lfs fetch --all`                   | Télécharge les objets de toutes les branches                                                    |
| `git lfs ls-files`                      | Liste les fichiers suivis et leurs identifiants courts                                          |
| `git lfs push --all origin`             | Téléverse à nouveau tous les objets locaux. Les objets que possède Arkvory ne sont pas envoyés. |

Un objet que possède déjà Arkvory, avec le même identifiant et la même taille, n’est pas envoyé à nouveau. Un push répété après une interruption n’envoie que ce qui manque.

## Verrouiller des fichiers {#locks}

Les ressources binaires ne peuvent pas être fusionnées. Un verrou indique à l’équipe qu’une personne modifie un fichier. Les verrous appartiennent au dépôt Arkvory, pas à une branche.

```bash
git lfs lock Content/Maps/Level01.umap
git lfs locks
git lfs unlock Content/Maps/Level01.umap
```

- Un second `git lfs lock` sur le même chemin échoue avec « already created lock » et nomme le propriétaire.
- Le propriétaire est indiqué par le nom de l’utilisateur ou du compte de service au moment du verrou. Une clé de fichier affiche son identifiant.
- Seul le propriétaire déverrouille un fichier. `git lfs unlock --force` sur le verrou d’une autre personne nécessite une clé de service avec l’action `artifact.delete` dans le dépôt. Les jetons personnels ne peuvent pas forcer les verrous.
- Un chemin de verrou est un chemin du dépôt git : jusqu’à 1024 caractères, avec `/` entre les dossiers, et sans segment vide, `.` ou `..`, barre oblique inversée ni deux-points.
- `git lfs locks` affiche 100 verrous par page.

Activez la vérification avant le push, pour que git refuse de pousser des modifications vers des fichiers verrouillés par d’autres. Le réglage est propre à l’adresse du serveur :

```bash
git config lfs.https://arkvory.example/lfs/games.locksverify true
```

Marquez les types de fichiers qui doivent être verrouillés avant modification. Git LFS les garde alors en lecture seule jusqu’à ce que vous les verrouilliez :

```bash
git lfs track --lockable "*.umap" "*.uasset"
```

La vérification des verrous au push nécessite un accès en écriture ; un jeton en lecture seule ne peut donc pas l’utiliser. Utilisez `git lfs locks` pour lister les verrous, ce que l’accès en lecture autorise.

## Astuces Unity et Unreal {#game-engines}

- Unity : gardez les ressources texte (`.unity`, `.prefab`, `.asset`) dans git et réglez la sérialisation des ressources sur Force Text. Suivez les gros binaires dans LFS, par exemple `*.png`, `*.psd`, `*.fbx`, `*.wav`, `*.mp4`, `*.exr`. Les fichiers texte que vous suivez tout de même dans LFS sont acceptés aussi.
- Unreal Engine : suivez `*.uasset`, `*.umap` et les gros fichiers sources, et marquez `*.uasset` et `*.umap` comme verrouillables.
- Les intégrations d’éditeur qui appellent les commandes de verrouillage LFS utilisent le protocole standard de verrouillage de fichiers de Git LFS. Arkvory est testé avec les clients en ligne de commande `git` et `git-lfs`.
- Ne placez pas dans LFS des sorties de build changeantes de plusieurs dizaines de gigaoctets. Téléversez-les comme artefacts ou [fichiers bruts](./raw-files) avec [`arkvoryctl`](./cli). Les objets LFS ne sont jamais supprimés par la rétention : ils restent pour toujours.
- Le code ou les outils volumineux et réutilisables que partagent les projets Unity sont mieux servis par les [paquets Unity](./unity-npm).

## Ce qui est stocké {#what-is-stored}

- Un objet LFS est un artefact du dépôt Arkvory. Son nom et son identité sont le SHA-256 de son contenu (le `oid` de LFS), et il porte l’étiquette `lfs`. Vous voyez ces artefacts dans la console sous [[ui:catalog]].
- Arkvory vérifie la taille et le SHA-256 pendant qu’il reçoit l’objet. S’ils diffèrent du `oid`, le téléversement échoue avec `422` et rien n’est stocké.
- Un objet appartient au dépôt. Deux dépôts Arkvory détiennent leurs propres copies du même fichier.
- La rétention ne supprime jamais les objets LFS, car le serveur ne peut pas savoir quels commits en ont encore besoin. Il n’existe aucune commande pour supprimer un objet LFS. Prévoyez le quota du dépôt pour tout l’historique des ressources.
- Les verrous sont des lignes de la base de données. Les sauvegardes les incluent.

## Autorisations {#permissions}

Les jetons personnels et les clés de fichier obtiennent un accès en lecture ou en écriture au dépôt. Les clés de service obtiennent des actions précises.

| Opération                                          | Actions de clé de service | Jeton personnel ou clé de fichier               |
| -------------------------------------------------- | ------------------------- | ----------------------------------------------- |
| Téléchargement (`clone`, `fetch`, `pull`)          | `content.read`            | Accès en lecture                                |
| Téléversement (`push`)                             | `upload.create`           | Accès en écriture, portée du jeton `read-write` |
| Lister les verrous                                 | `artifact.list`           | Accès en lecture                                |
| Créer, vérifier et libérer ses propres verrous     | `upload.create`           | Accès en écriture, portée du jeton `read-write` |
| Libérer le verrou d’une autre personne (`--force`) | `artifact.delete`         | Impossible                                      |

Une tâche CI qui pousse et tire a besoin de `content.read`, `upload.create` et `artifact.list`. Une clé qui ne peut que pousser apprend tout de même qu’un objet existe, elle ne le téléverse donc pas deux fois.

Un jeton personnel en lecture seule peut cloner et tirer bien que la requête de liste de téléchargement soit un `POST`. Il ne peut ni pousser ni verrouiller. Un miroir et une passerelle de lecture sont traités dans [Miroirs et passerelles de lecture](#mirrors-and-read-gateways).

## Comment fonctionne le transfert {#how-it-works}

Ces détails ne sont pas nécessaires au travail quotidien. Ils aident à déboguer un proxy ou un pare-feu.

1. Git LFS envoie un `POST /lfs/<repository>/objects/batch` avec l’opération (`download` ou `upload`) et la liste des objets. Jusqu’à 1000 objets par requête. Git LFS en envoie au plus 100 par défaut.
2. Arkvory répond avec un lien pour chaque objet à transférer, valable une heure. Pour un téléversement, il omet les objets qu’il possède déjà.
3. Git LFS envoie chaque objet avec `PUT`, ou le télécharge avec `GET`, vers `/lfs/<repository>/objects/<oid>`. La requête porte la même clé que la requête par lots.
4. Un `PUT` exige un en-tête `Content-Length`. Un téléversement par morceaux (chunked) est refusé avec `422`.

Pris en charge :

| Élément                 | Valeur                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Adaptateur de transfert | `basic` uniquement                                                                                                     |
| Algorithme de hachage   | `sha256` uniquement. Un client qui en demande un autre reçoit `409`.                                                   |
| Authentification        | Basic (clé comme mot de passe) ou Bearer                                                                               |
| Téléchargement          | `GET` et `HEAD` avec requêtes `Range`                                                                                  |
| Type de média           | `application/vnd.git-lfs+json` pour les requêtes JSON. Les corps d’objet de tout type de média sont stockés en octets. |

Les erreurs sont des documents JSON avec `message` et `request_id`. Citez le `request_id` lorsque vous demandez de l’aide à votre administrateur.

Les liens pointent vers l’adresse avec laquelle le client a atteint le serveur. Lorsqu’un proxy inverse termine HTTPS, il doit transmettre l’en-tête `Host` et envoyer `X-Forwarded-Proto: https`, comme dans l’exemple nginx de l’installation, pour que les liens utilisent `https`. Arkvory n’insère la clé dans un lien que si le lien est `https` ou pointe vers l’ordinateur local. En HTTP simple vers un autre hôte, git ne peut pas envoyer la clé avec l’objet et le transfert échoue.

## Fichiers volumineux et reprise {#large-files}

- Git LFS envoie chaque objet en une seule requête `PUT`. Après un échec, il recommence l’objet depuis le premier octet. L’adaptateur `tus`, qui reprend à l’intérieur d’un objet, n’est pas pris en charge.
- Une requête de téléversement doit se terminer en 30 minutes et ne pas s’interrompre plus de 30 secondes (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). Un fichier de plusieurs gigaoctets exige un réseau rapide et stable. Pour les fichiers plus volumineux, utilisez [`arkvoryctl`](./cli), qui téléverse par parties.
- Les téléchargements acceptent les requêtes `Range`.
- Un objet peut atteindre la taille maximale d’objet de l’installation (`ARKVORY_MAX_OBJECT_BYTES`, environ 10 TiB par défaut). Un objet plus volumineux est refusé dans la réponse par lots avec `422`.

Par défaut, le serveur exécute 2 téléversements en même temps et 1 par clé (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). Git LFS envoie 8 objets en même temps par défaut. Les autres téléversements attendent une place libre et abandonnent après 20 secondes (`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`) avec `503`. Git LFS répète un objet en échec quelques fois, mais un push de fichiers volumineux est plus fiable avec moins de transferts parallèles :

```bash
git config lfs.concurrenttransfers 1
```

Vous pouvez aussi demander à l’administrateur d’augmenter les limites. Elles sont décrites dans [Variables d’environnement](../reference/environment#transfers-and-bandwidth).

## Miroirs et passerelles de lecture {#mirrors-and-read-gateways}

| Emplacement                                       | Clone et fetch                                                                                      | Push et verrous                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Serveur principal                                 | Oui                                                                                                 | Oui                                                                                       |
| [Miroir](../operate/mirrors)                      | Oui. Le miroir possède les objets de sa source, pointez donc `lfs.url` vers lui.                    | Refusé (`409`, raison `mirror_read_only`). Les verrous ne sont pas copiés vers un miroir. |
| [Passerelle de lecture](../operate/read-gateways) | Non. La liste de téléchargement est une requête `POST`, qu’une passerelle de lecture n’accepte pas. | Non                                                                                       |

Pointez toujours `lfs.url` vers le serveur principal, ou vers un miroir pour les machines en lecture seule.

## Dépannage {#troubleshooting}

| Message ou symptôme                                                            | Cause                                                                           | Que faire                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `401` ou une erreur d’autorisation                                             | Aucune clé, une mauvaise clé, ou un jeton expiré ou révoqué                     | Supprimez l’identifiant enregistré dans votre gestionnaire d’identifiants et poussez à nouveau avec une clé valide |
| `403` avec « Read-only personal access token »                                 | Le jeton a la portée `read`                                                     | Créez un jeton avec la portée `read-write`                                                                         |
| `403`                                                                          | La clé n’a pas l’accès pour cette opération, ou le dépôt ne lui est pas accordé | Ajoutez les actions de [Autorisations](#permissions)                                                               |
| `Lock failed: already created lock`                                            | Quelqu’un détient le verrou                                                     | Demandez au propriétaire de déverrouiller, ou à un administrateur d’utiliser `--force`                             |
| `422` « Object exceeds the maximum size »                                      | L’objet dépasse la limite de l’installation                                     | Utilisez `arkvoryctl` pour ces fichiers                                                                            |
| `422` au téléversement                                                         | Le contenu ne correspond pas au `oid` ; le fichier a changé pendant le push     | Relancez `git lfs push`                                                                                            |
| `503` ou `Retry-After`                                                         | Trop de transferts en même temps                                                | Réduisez `lfs.concurrenttransfers` et réessayez                                                                    |
| `507`                                                                          | Le quota du dépôt ou la capacité de l’installation est atteint                  | Libérez de l’espace ou demandez un quota plus élevé                                                                |
| `409` au téléversement                                                         | Le dépôt est un miroir                                                          | Poussez vers le serveur principal                                                                                  |
| Les fichiers de l’arbre de travail sont de petits fichiers texte avec un `oid` | Les objets n’ont pas été téléchargés, ou `git lfs install` n’a pas été exécuté  | Exécutez `git lfs install`, puis `git lfs pull`                                                                    |
| `x509: certificate signed by unknown authority`                                | Le client ne fait pas confiance au certificat                                   | Ajoutez l’autorité de certification au magasin de confiance du système, ou définissez `http.sslCAInfo`             |

Ne désactivez pas la vérification TLS (`GIT_SSL_NO_VERIFY`) : la clé est envoyée à chaque requête.

## Pages associées {#related-pages}

- [Clients et protocoles](./index)
- [Comptes et clés](../use/accounts)
- [HTTPS](../install/https)
- [Miroirs](../operate/mirrors)
- [Paquets Unity et npm](./unity-npm)
