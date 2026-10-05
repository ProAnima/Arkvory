---
title: 'Vue d’ensemble de l’API HTTP'
description: 'Les règles dont chaque intégration à l’API HTTP d’Arkvory a besoin : JSON et tailles, découverte, pagination, révisions, idempotence, nouvelles tentatives, plages, erreurs et limites.'
---

# Vue d’ensemble de l’API HTTP

L’API HTTP est l’interface utilisée par la console web, le client en ligne de commande et le SDK. Tout ce qu’ils font, votre intégration peut le faire dans n’importe quel langage. Cette page explique les règles qui s’appliquent à chaque opération. Les pages de la section [Pages de référence](#reference-pages) listent chaque opération avec sa règle d’accès, sa règle de nouvelle tentative, ses paramètres et ses réponses ; elles sont générées à partir du contrat que le serveur applique.

## Notions de base {#basics}

- **Chemin de base.** Chaque opération se trouve sous `/api/v1`, par exemple `https://arkvory.example/api/v1/repositories`. Les seules exceptions sont les contrôles de santé sous `/health`.
- **Format.** Les requêtes et les réponses sont en JSON (`application/json`). Un corps JSON est limité à 64 Kio, et une requête qui envoie un autre type de contenu pour une opération JSON reçoit `415`. Les octets des fichiers sont envoyés en `application/octet-stream`.
- **Champs inconnus.** La plupart des opérations refusent une requête contenant un champ qu’elles ne définissent pas (`400`, avec le champ dans `details`). Dans les réponses, ignorez les champs que vous ne connaissez pas.
- **Les heures** sont des horodatages RFC 3339 en UTC. **Les ID** d’artefacts, de téléversements, de tâches, de comptes et de clés sont des UUID.
- **Noms.** Un nom de dépôt correspond à `[a-z0-9][a-z0-9_-]{0,63}`. Un nom de fichier (le nom de l’artefact) comporte jusqu’à 240 caractères et pas de `/` ni de `\`. Un chemin dans un dépôt comporte jusqu’à 1 024 caractères.
- **Mise en cache.** Les réponses portent `Cache-Control: private, no-store`.
- **Autres protocoles.** Les routes `/v2` (conteneurs), `/lfs` (Git LFS) et `/npm` suivent les spécifications de leurs propres clients et utilisent leurs propres formats d’erreur. Elles ne font pas partie du document OpenAPI. Voir [Clients et protocoles](../protocols/index).

### Tailles et nombres {#sizes}

Un nombre JSON ne peut pas porter toutes les valeurs 64 bits. Arkvory envoie donc **les tailles et les compteurs d’octets sous forme de chaînes décimales** : `"size": "1048576"`. Il en va de même pour la taille que vous déclarez lorsque vous créez un téléversement. Une taille n’a pas de signe, pas de zéros de tête et pas plus de 16 chiffres. Les nombres, les révisions, les limites et les index de parties sont des entiers JSON ordinaires.

Le plus grand objet fait 10 000 Gio (10 737 418 240 000 octets), sauf si l’administrateur définit un `ARKVORY_MAX_OBJECT_BYTES` inférieur. Une taille déclarée supérieure est refusée avec `400`.

## Authentification {#authentication}

Chaque opération, hormis la connexion, les contrôles de santé publics et les options de connexion, exige un identifiant dans l’en-tête `Authorization: Bearer <credential>`. L’identifiant est une session de console, un jeton d’accès personnel, une clé de service ou la clé de récupération. Ce qu’un identifiant peut faire dépend de son type et de la **règle d’accès** de chaque opération. Lisez [Authentification](./authentication) avant de concevoir l’intégration, et donnez à l’automatisation une clé de service avec uniquement les actions dont elle a besoin.

## Découverte {#discovery}

Un client peut demander au serveur ce qu’il prend en charge au lieu de le deviner. Toutes ces opérations exigent un identifiant.

| Requête                        | Réponse                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/capabilities`     | Les versions de l’API (`v1`), le rôle de la passerelle (`api` ou `reader`), les indicateurs de fonctionnalité et les limites de ce serveur : `maxObjectBytes`, `partBytes` (la plus petite partie, 8 Mio), `maxPartBytes` (1 Gio), `maxParts` (10 000) et `maxPageSize` (100).                                                                              |
| `GET /api/v1/operations`       | Les opérations que cet identifiant peut probablement appeler, chacune avec son `operationId`, sa méthode, son chemin, sa `surface`, sa classe de `retry`, les actions requises et les conditions restantes. Filtrez avec `repository`, `surface`, `after` et `limit` (de 1 à 100, 50 par défaut). La liste est indicative : seule la requête réelle décide. |
| `GET /api/v1/openapi.json`     | Le document OpenAPI 3.0.3 de l’API d’écriture. Ajoutez `?surface=<name>` pour n’obtenir qu’une seule surface.                                                                                                                                                                                                                                               |
| `GET /api/v1/auth/permissions` | Les actions de l’identifiant appelant par dépôt.                                                                                                                                                                                                                                                                                                            |
| `GET /api/v1/auth/me`          | Qui est l’identifiant, son type et ses droits généraux `read`/`write`.                                                                                                                                                                                                                                                                                      |
| `GET /api/v1/repositories`     | Les dépôts que l’identifiant peut voir.                                                                                                                                                                                                                                                                                                                     |

Utilisez `capabilities` pour lire les limites au lieu de les coder en dur. Traitez un indicateur de fonctionnalité que vous ne connaissez pas comme `false`.

### Surfaces {#surfaces}

Les opérations sont regroupées en six **surfaces**. Ce sont des étiquettes du contrat, pas des services distincts ; les URL ne changent pas.

| Surface          | Ce qu’elle couvre                                                                       |
| ---------------- | --------------------------------------------------------------------------------------- |
| `discovery`      | Fonctionnalités, catalogue d’opérations, OpenAPI et dépôts                              |
| `identity`       | Connexion, identité de l’appelant, jetons et activation de clé                          |
| `catalog`        | Artefacts, annotations, paquets, fichiers par chemin, étapes, promotion, pièces jointes |
| `transfers`      | Sessions de téléversement, parties, tâches de finalisation et téléchargements           |
| `administration` | Comptes, groupes, comptes de service, clés, délégations, mises à jour et sauvegardes    |
| `operations`     | Vivacité, disponibilité, métriques et commentaires                                      |

Les contrôles de santé sont `GET /health/live` (le processus fonctionne) et `GET /health/status` (public ; `{"status":"ready"}` ou `unavailable`) sans identifiant, et `GET /health/ready` et `GET /health/metrics` avec un identifiant. Ils ne consomment pas le budget de requêtes, donc la charge ne fait pas retirer le serveur par un répartiteur.

## Pagination {#pagination}

Une liste est renvoyée page par page. La réponse contient `items` et `next`. Lorsque `next` n’est pas `null`, renvoyez-la telle quelle dans le paramètre de requête `after` pour lire la page suivante ; lorsqu’elle vaut `null`, la liste est complète. Traitez un curseur comme une chaîne opaque et ne le construisez pas vous-même.

`limit` définit la taille de page, de 1 à 100. La plupart des listes renvoient 50 éléments si vous l’omettez. Les pages ne sont pas un instantané : les éléments qui arrivent pendant votre lecture peuvent apparaître ou non. Les filtres et l’ordre de tri doivent rester identiques pendant que vous suivez `next`.

## Révisions et compare-and-swap {#revisions}

Les objets que les personnes modifient ont une **révision** qui compte à partir de 1 : les étiquettes, les métadonnées et les collections d’un artefact, les pièces jointes d’un build, un chemin de fichier, une politique de stockage, le plan de sauvegarde et les paramètres d’un compte de service. Une modification indique la révision attendue dans le corps de la requête, via `expectedRevision` :

```json
{ "expectedRevision": 3, "value": { "labels": ["tested"], "metadata": {}, "collections": [] } }
```

Si la révision actuelle n’est pas 3, rien ne change et le serveur répond `409` avec la raison `revision_mismatch`. C’est le **compare-and-swap**. Relisez l’état, appliquez-y votre modification et envoyez la nouvelle révision. Ne bouclez jamais avec un nombre plus grand pour forcer l’écriture. Utilisez `0` pour un objet qui n’existe pas encore, comme un nouveau chemin. L’API n’utilise pas l’en-tête `If-Match`.

Un **artefact téléchargé** a un validateur différent, l’`ETag`. Voir [Téléchargements par plage et ETags](#range-downloads).

## Clés d’idempotence {#idempotency}

Un en-tête `Idempotency-Key` fait qu’une requête répétée n’a d’effet qu’une fois. Utilisez une valeur de 1 à 128 caractères composée de lettres, de chiffres et de `_ . : -`, et conservez-la avec l’état de la tâche avant la première requête, afin qu’une tâche redémarrée répète la même clé. Ces écritures en ont besoin :

| Opération                                                           | Une répétition avec la même clé et le même corps                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `createUpload`                                                      | Renvoie la même session de téléversement.                                                                                           |
| `issueServiceKey` and `rotateServiceKey`                            | Renvoie les métadonnées de la clé avec `200`, sans le secret. Révoquez la clé et émettez-en une autre si vous avez perdu le secret. |
| `requestBackupRun`, `requestBackupVerify`, `requestBackupRetention` | Renvoie la même requête au lieu d’en mettre une autre en file d’attente.                                                            |

La même clé avec un corps différent est refusée avec `409` et la raison `idempotency_mismatch`. Une clé est limitée à l’appelant et à la cible, donc deux appelants peuvent utiliser la même valeur.

D’autres écritures peuvent être répétées sans risque pour une autre raison : elles définissent un état (définir une étape, enregistrer un paquet, révoquer une clé), ou bien ce sont des compare-and-swap. La section suivante vous indique lesquelles.

## Règles de nouvelle tentative {#retry-rules}

Chaque opération a une **classe de nouvelle tentative**. Cette classe indique à un client quoi faire lorsqu’il n’a pas reçu la réponse. La référence l’affiche sous « Retry » pour chaque opération.

| Classe             | Signification                                        | Que faire                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read`             | La lecture ne change rien.                           | Répétez avec un délai croissant.                                                                                                                                                                       |
| `idempotent`       | La même requête a le même effet.                     | Répétez. Une réponse peut différer dans le détail : supprimer deux fois peut signaler que l’objet a disparu.                                                                                           |
| `idempotency-key`  | Sûr uniquement avec une clé.                         | Répétez avec la même `Idempotency-Key` et le même corps.                                                                                                                                               |
| `compare-and-swap` | Une modification qui dépend d’une révision.          | Relisez l’état, décidez de nouveau, puis répétez avec la révision que vous avez lue. N’augmentez jamais `expectedRevision` pour franchir un `409`.                                                     |
| `reconcile-upload` | Une étape d’une session de téléversement.            | Lisez d’abord le téléversement et ses parties (`getUpload`, `listUploadParts`), puis envoyez ce qui manque. Un `PUT` de fichier entier ne peut pas reprendre au milieu : il recommence à l’octet zéro. |
| `reconcile-job`    | Mise en file d’attente d’une tâche de finalisation.  | Lisez d’abord la tâche (`getCompletionJob`). Une tâche échouée peut être remise en file d’attente.                                                                                                     |
| `never-automatic`  | Une répétition pourrait exécuter l’action deux fois. | Ne répétez pas automatiquement. Vérifiez le résultat, puis décidez. Exemples : créer un compte, un jeton ou un lien de téléchargement, exécuter une politique de stockage, envoyer des commentaires.   |

Une panne réseau et les statuts `408`, `429`, `502`, `503` et `504` sont temporaires : répétez selon la classe, attendez au moins la durée indiquée par `Retry-After` et ajoutez un délai exponentiel avec une limite du nombre de tentatives. Ne répétez pas les réponses `401`, `403` et les autres `4xx` sans changer la requête. Ne répétez pas `500` à l’aveugle ; transmettez l’ID de requête au support. Après un `503` sur une modification, le résultat est inconnu : utilisez la classe pour savoir ce qui s’est passé. Le SDK et le client en ligne de commande appliquent ces règles.

## Téléchargements par plage et ETags {#range-downloads}

`GET` et `HEAD` de `…/artifacts/{id}/content` renvoient les octets d’origine avec un `ETag` fort de la forme `"sha256:<hex>"` et `Accept-Ranges: bytes`. Il en va de même pour les téléchargements par paquet (`…/packages/content`) et par chemin de fichier (`…/asset/content`, `…/raw/{path}`). Ils recherchent l’artefact courant à chaque requête ; `packages/content` et `raw` nomment celui qu’ils ont choisi dans `X-Arkvory-Artifact-Id`, afin que vous puissiez l’épingler pour une reprise.

- `Range: bytes=0-1023`, `bytes=1024-` et `bytes=-1024` renvoient `206` avec `Content-Range`. Le serveur sert une seule plage ; une liste de plages reçoit le fichier entier en réponse.
- Un début au-delà de la fin du fichier renvoie `416` avec le code `invalid_input`, la raison `range_not_satisfiable` et `Content-Range: bytes */<size>`.
- Pour reprendre, envoyez `Range` avec `If-Range: "<the ETag you saw>"`. Si le contenu derrière un nom a changé, l’`ETag` diffère et vous recevez le fichier nouveau en entier au lieu d’un fichier mélangé.
- `If-None-Match` avec l’`ETag` renvoie `304` sans corps.
- Vérifiez le SHA-256 de ce que vous avez enregistré. L’ETag le porte.

Un lien de téléchargement (`?token=`) fonctionne sur la route de contenu d’un artefact. Voir [Authentification](./authentication#download-links).

## Erreurs {#errors}

Chaque échec a la même enveloppe JSON : `code`, `message`, `requestId`, et, lorsqu’il y a plus à dire, `reason`, `details` et `retryAfterSeconds`. Décidez d’après `code` et `reason`, jamais d’après le `message`. Les raisons inconnues comptent comme absentes, et un `code` inconnu est traité selon son statut HTTP. Voir [Erreurs](./errors).

## Limites de débit et serveurs occupés {#rate-limits}

Arkvory ne mesure pas les appels d’API par minute. Il limite ce qu’il fait en même temps et limite les tentatives de deviner un mot de passe :

- **Occupé.** Le serveur admet un nombre fixe de requêtes et de transferts en même temps (`ARKVORY_MAX_REQUESTS`, 128 par défaut ; 2 téléversements et 16 téléchargements par défaut). Un transfert peut attendre dans une file d’attente bornée jusqu’à 20 secondes. Lorsqu’il n’y a pas de place, la réponse est `503` avec le code `busy`. Répétez après `Retry-After`.
- **Capacité.** Une réserve de disque pleine, un quota ou une limite sur un nombre d’objets renvoie `507`, ce qui ne s’améliore pas en attendant.
- **Tentatives.** Trop de tentatives de connexion, d’inscription, de mot de passe ou de commentaires renvoient `429` avec le code `rate_limited`. Voir [Authentification](./authentication#sign-in-limits).

`429` et `503` portent tous deux l’en-tête `Retry-After` en secondes (2 lorsque le serveur n’a pas d’estimation) et le même nombre dans `retryAfterSeconds`. Si une requête passe par un proxy, le proxy peut ajouter ses propres limites.

## ID de requête {#request-ids}

Chaque réponse a un en-tête `X-Request-Id`, et chaque erreur a la même valeur dans `requestId`. Journalisez-la avec votre propre tâche et citez-la au support. Un ID de requête que vous envoyez n’est utilisé que s’il arrive via un proxy listé dans `ARKVORY_TRUSTED_PROXIES` et comporte de 8 à 128 caractères sûrs ; sinon le serveur en crée un nouveau. Un en-tête W3C `traceparent` est enregistré uniquement dans le journal d’accès du serveur.

## Navigateurs et CORS {#cors}

Une page web à la même adresse qu’Arkvory fonctionne sans aucun réglage. Une page à une autre adresse ne fonctionne que si l’administrateur liste son origine exacte dans `ARKVORY_CORS_ORIGINS` (jusqu’à 16, HTTPS ou HTTP sur l’interface de bouclage). Une autre origine reçoit `403` avec la raison `origin_not_allowed`, même lorsque la clé est valide. Les requêtes n’utilisent jamais de cookies : envoyez la clé dans l’en-tête `Authorization` et gardez-la en mémoire. Voir [Variables d’environnement](../reference/environment).

## Promesse de compatibilité {#evolution}

`/api/v1` ne change que par ajout : nouvelles opérations, nouveaux champs de requête facultatifs, nouveaux champs de réponse, nouvelles raisons d’erreur et nouveaux indicateurs de fonctionnalité. Une modification qui casserait un client, comme un sens différent, un nouveau champ obligatoire, un statut différent ou une pagination différente, donne lieu à une nouvelle version de l’API et à une période pendant laquelle les deux fonctionnent. En retour, votre client doit :

- ignorer les champs de réponse qu’il ne connaît pas ;
- traiter une `reason` inconnue comme absente et un `code` inconnu selon son statut HTTP ;
- prendre les limites dans `capabilities` ;
- n’envoyer que les champs que l’opération définit.

Les valeurs `operationId` sont des noms stables. Utilisez-les lorsque vous associez des opérations à votre propre code.

## Exemple : téléverser un fichier et le télécharger {#example}

Cette séquence téléverse un fichier en une seule requête. Pour les fichiers de plus de quelques gigaoctets, ou sur des liaisons peu fiables, utilisez [`arkvoryctl`](../protocols/cli) ou le [SDK](../protocols/sdk) : ils envoient des parties et reprennent après un échec. L’exemple utilise `jq` pour lire le JSON.

D’abord, définissez l’adresse et la clé, puis calculez la taille et le SHA-256 du fichier :

```bash
export ARKVORY_URL=https://arkvory.example
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
FILE=./Setup.exe
SIZE=$(stat -c %s "$FILE")
SHA=$(sha256sum "$FILE" | cut -d ' ' -f 1)
```

**Étape 1. Réservez le téléversement.** La même `Idempotency-Key` renvoie la même session, vous pouvez donc répéter cet appel sans risque.

```bash
ID=$(curl -fsS -X POST "$ARKVORY_URL/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Idempotency-Key: build-1042-setup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Setup.exe\",\"size\":\"$SIZE\",\"sha256\":\"$SHA\",\"labels\":[\"nightly\"]}" \
  | jq -r .id)
```

**Étape 2. Envoyez les octets.** Le serveur publie l’artefact lorsque la taille et le SHA-256 correspondent.

```bash
curl -fsS -X PUT "$ARKVORY_URL/api/v1/repositories/releases/uploads/$ID/content" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Content-Type: application/octet-stream" \
  -T "$FILE" | jq '{id, status}'
```

**Étape 3. Téléchargez-le.** L’ID de l’artefact est l’ID du téléversement.

```bash
curl -fL -o Setup-copy.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY_URL/api/v1/repositories/releases/artifacts/$ID/content"
sha256sum Setup-copy.exe
```

L’étape 2 répond `{"id": "…", "status": "available"}`. Si la connexion se coupe pendant l’étape 2, relisez le téléversement avec `GET …/uploads/$ID` : tant que son statut est `pending`, renvoyez le fichier depuis le début. Une session de téléversement vit 7 jours. La clé a besoin des actions `upload.create`, `upload.write`, `upload.complete` et `content.read` sur `releases`. Voir [Téléversements](./reference/uploads) et [Transferts](../use/transfers).

## Pages de référence {#reference-pages}

Chaque page liste les opérations d’un groupe avec leur règle d’accès, leur classe de nouvelle tentative, leurs paramètres et leurs réponses.

- [Système et santé](./reference/system) : vivacité, disponibilité, métriques, OpenAPI, capacités
- [Dépôts](./reference/repositories)
- [Téléversements](./reference/uploads)
- [Artefacts et catalogue](./reference/artifacts)
- [Paquets](./reference/packages)
- [Fichiers par chemin](./reference/files)
- [Étapes et promotion](./reference/promotion)
- [Politiques de stockage et rétention](./reference/storage)
- [Miroirs](./reference/mirrors)
- [Liens de téléchargement](./reference/links)
- [Pièces jointes de build](./reference/attachments)
- [Comptes et connexion](./reference/accounts)
- [Comptes de service et clés](./reference/services)
- [Sauvegardes](./reference/backups)
- [Mises à jour](./reference/updates)
- [Commentaires](./reference/feedback)

Pages associées : [Authentification](./authentication), [Erreurs](./errors), [SDK TypeScript](../protocols/sdk).
