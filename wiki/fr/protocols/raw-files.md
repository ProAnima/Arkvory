---
title: 'Fichiers bruts'
description: 'Stockez et lisez un fichier par son chemin en une requête HTTP, avec curl, wget ou PowerShell, sans rien installer.'
---

# Fichiers bruts

Un chemin de fichier dans un dépôt fonctionne comme un fichier sur un serveur web. `PUT` stocke un corps comme version suivante d’un chemin. `GET` renvoie la version actuelle. Utilisez-le depuis des scripts de build et des tâches CI qui disposent de `curl` ou de PowerShell et de rien d’autre.

L’adresse est la même pour les trois méthodes :

```text
https://<host>/api/v1/repositories/<repository>/raw/<path>
```

Par exemple : `https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe`.

## Stocker un fichier {#store-a-file}

Vous avez besoin d’un dépôt et d’une clé avec accès en écriture. Voir [Comptes et clés](../use/accounts). Envoyez la clé sous la forme `Authorization: Bearer <key>`. Les fichiers bruts n’acceptent aucun autre type d’authentification.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
URL="https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"

curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$URL"
```

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe'
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

```bash
wget -qO- --method=PUT --body-file=GameSetup.exe \
  --header="Authorization: Bearer $ARKVORY_KEY" "$URL"
```

Donnez à `curl -T` l’adresse complète du fichier, pas d’un dossier. Encodez les caractères du chemin qu’une URL n’autorise pas : écrivez un espace comme `%20`, `#` comme `%23` et `?` comme `%3F`.

La réponse est du JSON. Un nouveau fichier ou de nouveaux octets renvoient `201` :

```json
{
  "path": "builds/game/1.4/GameSetup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "00000000-0000-4000-8000-000000000001", "size": "1048576", "sha256": "…" }
}
```

Si le chemin contient déjà exactement ces octets, la réponse est `200` avec `"created": false` et la même révision. Rien n’est stocké. Une étape d’une tâche CI peut s’exécuter à nouveau sans créer de nouvelle version. `size` est une chaîne de chiffres décimaux.

### Envoyer une somme de contrôle {#send-a-checksum}

Envoyez le SHA-256 du fichier avec `X-Checksum-Sha256`, et la longueur avec `Content-Length`. `curl -T` et PowerShell envoient la longueur d’un fichier. Le serveur écrit alors les octets directement dans le stockage en une seule passe et les vérifie sur place. Une somme de contrôle erronée renvoie `422` avec le code `integrity_mismatch`, ne stocke rien et laisse le chemin tel quel.

```bash
curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "X-Checksum-Sha256: $(sha256sum GameSetup.exe | cut -d' ' -f1)" \
  "$URL"
```

```powershell
$headers['X-Checksum-Sha256'] = (Get-FileHash .\GameSetup.exe -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

Sans la somme de contrôle, ou avec un corps fragmenté sans `Content-Length`, le serveur écrit d’abord le corps dans un fichier temporaire et le hache. Puis il le stocke. Cela nécessite jusqu’à deux fois la taille du fichier sur le disque du serveur pendant un court moment, et une seconde passe sur les octets. Le serveur supprime les fichiers temporaires laissés par un échec au bout d’un jour.

Lorsque vous envoyez la somme de contrôle et la longueur, et que le chemin contient déjà ces octets, le serveur répond `200` sans lire le corps, et ferme la connexion.

### Création seule {#create-only}

Un `PUT` ne lit qu’une seule condition, `If-None-Match: *`. Avec elle, le serveur ne stocke le fichier que si le chemin n’existe pas. Sinon il répond `409` avec la raison `already_exists`, même lorsque les octets sont identiques. Toute autre valeur de `If-None-Match` sur un `PUT` renvoie `400`.

```bash
curl --fail-with-body -sS -T ./notes.txt \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-None-Match: *" \
  "https://arkvory.example/api/v1/repositories/releases/raw/docs/notes.txt"
```

### Deux écrivains {#two-writers}

Lorsque deux requêtes modifient le même chemin en même temps, la première l’emporte. La suivante reçoit `409` avec la raison `revision_mismatch`, et le chemin conserve le contenu du gagnant. Relancez la requête pour créer une nouvelle révision. Les octets téléversés du perdant restent comme artefact sans chemin jusqu’à ce que la rétention les supprime.

## Lire un fichier {#read-a-file}

`GET` renvoie la version actuelle du chemin. `HEAD` ne renvoie que les en-têtes.

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $ARKVORY_KEY" -o GameSetup.exe "$URL"
```

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\GameSetup.exe
```

```bash
wget --header="Authorization: Bearer $ARKVORY_KEY" -O GameSetup.exe "$URL"
```

Les en-têtes de la réponse :

| En-tête                 | Valeur                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| `ETag`                  | `"sha256:<digest>"` : le SHA-256 du contenu, entre guillemets       |
| `Content-Length`        | La taille du fichier                                                |
| `Accept-Ranges`         | `bytes`                                                             |
| `Content-Type`          | Toujours `application/octet-stream`                                 |
| `Content-Disposition`   | `attachment` avec le dernier segment du chemin comme nom de fichier |
| `X-Arkvory-Artifact-Id` | L’identifiant de l’artefact qui détient cette version               |

Un chemin inconnu renvoie `404`.

### Plages et requêtes conditionnelles {#ranges-and-conditional-requests}

| En-tête de requête          | Effet                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Range: bytes=0-1023`       | `206` avec la partie demandée et `Content-Range`. Un début au-delà de la fin du fichier renvoie `416` avec `Content-Range: bytes */<size>`.  |
| `Range: bytes=-1024`        | Les 1024 derniers octets                                                                                                                     |
| `Range: bytes=1048576-`     | Depuis le décalage jusqu’à la fin                                                                                                            |
| `If-Range: "sha256:…"`      | Applique le `Range` uniquement si l’ETag est exactement celui-ci. Si le chemin a une nouvelle version, vous recevez tout le nouveau fichier. |
| `If-None-Match: "sha256:…"` | `304` sans corps si l’ETag est identique. Fonctionne aussi avec `HEAD`.                                                                      |

Une seule plage par requête est prise en charge. Une requête avec plusieurs plages renvoie le fichier entier.

Un chemin peut recevoir une nouvelle version à tout moment, et un `GET` résout à nouveau le chemin. Pour reprendre un téléchargement en toute sécurité, mémorisez l’`ETag` de la première réponse et envoyez-le comme `If-Range` :

```bash
etag=$(curl -sSI -H "Authorization: Bearer $ARKVORY_KEY" "$URL" | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -sS -H "Authorization: Bearer $ARKVORY_KEY" -H "If-Range: $etag" \
  -H "Range: bytes=1048576-" "$URL" >> GameSetup.part
```

Pour éviter un téléchargement lorsque le fichier n’a pas changé, envoyez l’ETag que vous avez stocké la dernière fois :

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ARKVORY_KEY" \
  -H 'If-None-Match: "sha256:<digest>"' "$URL"
```

Pour les fichiers volumineux, [`arkvoryctl get`](./cli) télécharge avec reprise et vérifie le SHA-256 pour vous.

## Chemins et versions {#paths-and-versions}

Un fichier brut est un [fichier par chemin](../use/files). Chaque `PUT` avec de nouveaux octets ajoute une révision au chemin : révision 1, 2, 3, etc. Les révisions antérieures restent. Les octets ne sont jamais remplacés, car chaque révision pointe vers son propre artefact immuable, nommé d’après le dernier segment du chemin.

- `GET` sur l’adresse brute donne toujours la révision actuelle.
- Pour voir toutes les révisions d’un chemin, lisez son historique : [`getAssetHistory`](../api/reference/files#getAssetHistory), ou [[ui:history]] dans la console.
- Pour lire une révision plus ancienne, [`getAssetRevision`](../api/reference/files#getAssetRevision) renvoie son artefact. Téléchargez-le avec l’adresse de contenu de l’artefact.
- Pour revenir à une ancienne révision, utilisez [`restoreAsset`](../api/reference/files#restoreAsset). Il ajoute une nouvelle révision qui pointe vers les anciens octets.
- Pour lister les chemins d’un dépôt par préfixe, utilisez [`listAssetPage`](../api/reference/files#listAssetPage).
- Un chemin ne peut pas être supprimé. L’historique reste. La rétention ne supprime pas les artefacts qu’utilise une révision de chemin.

Les mêmes opérations se trouvent dans le [SDK](./sdk#raw-files-by-path) (`client.raw.putRawFile`, `downloadRawFile`) et dans [`arkvoryctl`](./cli#transfers) (`put`, `get`).

### Règles de chemin {#path-rules}

| Règle    | Valeur                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| Longueur | 1 à 1024 caractères                                                                                             |
| Dossiers | Segments séparés par `/`                                                                                        |
| Interdit | Un segment vide (`a//b`), `.` ou `..`, une barre oblique inversée, un deux-points et des caractères de contrôle |

`curl` et les navigateurs suppriment `.` et `..` d’une URL avant de l’envoyer ; un tel chemin n’arrive donc jamais. Un chemin qui enfreint les règles renvoie `400`.

## Autorisations {#permissions}

Les jetons personnels et les clés de fichier obtiennent un accès en lecture ou en écriture au dépôt. Les clés de service obtiennent des actions précises.

| Opération     | Actions de clé de service                                                                        | Jeton personnel ou clé de fichier               |
| ------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `GET`, `HEAD` | `content.read`                                                                                   | Accès en lecture                                |
| `PUT`         | `upload.create`, `upload.write`, `upload.complete`, `asset.read`, `asset.write`, `artifact.read` | Accès en écriture, portée du jeton `read-write` |

Un agent de déploiement qui ne fait que télécharger a besoin de l’action `content.read`.

Une [passerelle de lecture](../operate/read-gateways) n’accepte que `GET` et `HEAD`. Un [miroir](../operate/mirrors) sert les lectures et refuse `PUT` avec `409` et la raison `mirror_read_only`.

## Limites {#limits}

| Limite                     | Valeur                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Taille du fichier          | La taille maximale d’objet de l’installation, `ARKVORY_MAX_OBJECT_BYTES` (environ 10 TiB par défaut)                                                                                         |
| Une requête `PUT`          | Doit se terminer en 30 minutes et ne pas s’interrompre plus de 30 secondes (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). Ce sont aussi les valeurs maximales autorisées. |
| Téléversements simultanés  | 2 par serveur et 1 par clé par défaut (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). Une requête en attente abandonne après 20 secondes avec `503`.                           |
| Téléchargements simultanés | 16 par serveur et 4 par clé par défaut                                                                                                                                                       |
| Quota                      | Le fichier compte dans le quota du dépôt et la capacité de l’installation                                                                                                                    |

Un `PUT` isolé n’a pas de reprise : après un échec, il recommence depuis le premier octet. Utilisez les fichiers bruts pour les fichiers petits et moyens et pour les scripts. Pour les fichiers volumineux ou les réseaux lents, utilisez [`arkvoryctl put`](./cli) ou le [SDK](./sdk). Ils téléversent par parties, continuent après un échec et vérifient le SHA-256. Ils stockent aussi le fichier comme révision d’un chemin. Les variables sont décrites dans [Variables d’environnement](../reference/environment#transfers-and-bandwidth).

## Unity Addressables {#addressables}

Addressables chargent le catalogue et les bundles avec de simples requêtes `GET` ; un dossier de build peut donc se trouver sous un chemin raw. Cela convient aux builds internes, à la QA et aux outils. Cela ne convient pas aux joueurs sur l'internet public : une lecture raw exige toujours une clé, un lien de téléchargement expire en 24 heures et une clé dans un client distribué n'est pas secrète.

Envoyez le dossier avec `arkvoryctl put`. Les fichiers dont les octets n'ont pas changé ne sont pas renvoyés. Utilisez un dossier par build, car un chemin renvoie toujours sa révision la plus récente et un ancien catalogue ne doit pas rencontrer de nouveaux bundles :

```bash
cd ServerData/StandaloneWindows64
find . -type f | while read -r file; do
  arkvoryctl put "$file" "addressables/game/$BUILD/StandaloneWindows64/${file#./}" || exit 1
done
```

```powershell
$root = (Resolve-Path .\ServerData\StandaloneWindows64).Path
Get-ChildItem $root -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($root.Length + 1) -replace '\\', '/'
  arkvoryctl put $_.FullName "addressables/game/$env:BUILD/StandaloneWindows64/$relative"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Définissez le chemin de chargement distant du profil Addressables sur l'adresse raw de ce dossier, par exemple `https://arkvory.example/api/v1/repositories/releases/raw/addressables/game/<build>/[BuildTarget]`. Donnez au client une clé en lecture seule : un jeton d'accès personnel avec lecture, ou une clé de service avec l'action `content.read`. Raw n'accepte la clé que dans l'en-tête `Authorization` ; ajoutez-la à chaque requête :

```csharp
Addressables.WebRequestOverride = request =>
{
    if (request.url.StartsWith("https://arkvory.example/"))
        request.SetRequestHeader("Authorization", "Bearer " + readKey);
};
```

Dans Addressables 1.x, la propriété est `Addressables.WebRequestOverride` ; vérifiez le nom dans votre version. C'est un modèle, pas une intégration testée.

## Dépannage {#troubleshooting}

Les erreurs sont des documents JSON avec `code`, `reason`, `message` et `requestId`. Voir [Erreurs](../api/errors). Donnez le `requestId` à votre administrateur pour retrouver la requête dans le journal du serveur.

| Statut        | Raison                                                      | Cause                                                                                                  | Que faire                                                                                                  |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `400`         | `validation`                                                | Le chemin, `Content-Length`, `X-Checksum-Sha256` ou `If-None-Match` n’est pas valide                   | Vérifiez les règles de chemin et encodez l’URL                                                             |
| `401`         | `credential_missing`, `credential_invalid`, `token_expired` | Aucune clé, une mauvaise clé, ou un jeton expiré                                                       | Envoyez `Authorization: Bearer <key>`. L’authentification Basic ne fonctionne pas pour les fichiers bruts. |
| `403`         | `permission_missing`, `read_only_token`                     | La clé ne peut pas écrire, ou c’est un jeton en lecture seule                                          | Utilisez une clé avec les actions de [Autorisations](#permissions)                                         |
| `404`         |                                                             | Le chemin n’existe pas, ou la clé ne voit pas le dépôt                                                 | Vérifiez le nom du dépôt et le chemin                                                                      |
| `409`         | `already_exists`                                            | `If-None-Match: *` et le chemin existe                                                                 | Supprimez l’en-tête pour ajouter une révision                                                              |
| `409`         | `revision_mismatch`                                         | Une autre requête a modifié le chemin en premier                                                       | Relancez la requête                                                                                        |
| `409`         | `mirror_read_only`                                          | Le dépôt est un miroir                                                                                 | Écrivez vers le serveur principal                                                                          |
| `416`         | `range_not_satisfiable`                                     | La plage commence après la fin du fichier                                                              | Vérifiez la taille avec `HEAD`                                                                             |
| `422`         | `integrity_mismatch`                                        | Le corps ne correspond pas à `X-Checksum-Sha256` ou `Content-Length`                                   | Recalculez la somme de contrôle ; vérifiez le proxy                                                        |
| `503`         | `busy`                                                      | Trop de transferts en même temps                                                                       | Attendez la durée indiquée dans `Retry-After` et réessayez                                                 |
| `507`         | `storage_quota`                                             | Le quota du dépôt ou la capacité de l’installation est atteint                                         | Libérez de l’espace ou demandez un quota plus élevé                                                        |
| Pas un statut | `curl: (55)` ou `(56)` pendant l’envoi                      | Le serveur a fermé la connexion. Lorsque le chemin contient déjà les octets, il répond `200` et ferme. | Exécutez `curl -i` et lisez la réponse                                                                     |
| Pas un statut | La connexion se ferme après 30 minutes                      | Le délai de téléversement                                                                              | Utilisez `arkvoryctl put`                                                                                  |

## Pages associées {#related-pages}

- [Clients et protocoles](./index)
- [Ligne de commande (arkvoryctl)](./cli)
- [SDK TypeScript](./sdk)
- [Fichiers et chemins](../use/files)
- [Référence d’API : fichiers par chemin](../api/reference/files)
