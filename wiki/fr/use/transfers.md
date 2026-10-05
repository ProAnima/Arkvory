---
title: Téléversements et téléchargements
description: 'Envoyez et récupérez des fichiers de toute taille, reprenez après une interruption, vérifiez les sommes de contrôle et partagez un fichier sans clé.'
---

# Téléversements et téléchargements

Les fichiers de toute taille arrivent dans Arkvory par parties, et un transfert qui s’arrête peut reprendre là où il s’est arrêté. Cette page montre comment faire, dans la console, avec `arkvoryctl`, avec le SDK et avec l’API HTTP.

Un téléversement nécessite les actions `upload.create`, `upload.read`, `upload.write` et `upload.complete`. En termes de groupes, il nécessite l’accès en écriture. Un téléchargement nécessite `content.read`. Voir [Autorisations](./accounts#permissions).

## Téléverser un fichier {#upload}

Chaque téléversement suit les mêmes étapes. Le client calcule le SHA-256 du fichier entier et démarre une session de téléversement avec le nom du fichier, la taille et la somme de contrôle. Il envoie le fichier par parties. Quand toutes les parties sont là, le serveur les assemble, vérifie la somme de contrôle et publie le fichier comme artefact immuable.

### Dans la console {#upload-console}

1. Sélectionnez [[ui:upload]] dans la barre latérale, ou [[ui:uploadFile]] dans la barre supérieure.
2. Choisissez le fichier sous [[ui:chooseFile]]. La console lit le fichier entier une fois pour calculer sa somme de contrôle ([[ui:hashing]]). Pour un fichier de plusieurs dizaines de gigaoctets, cela prend un certain temps avant l’envoi du premier octet.
3. Sélectionnez [[ui:startUpload]]. La barre sous [[ui:transferTitle]] affiche la progression.
4. Quand le fichier est publié, son ID est affiché. Ouvrez [[ui:catalog]] pour le voir.

[[ui:pause]] arrête le transfert et conserve les parties déjà reçues. Le navigateur vous avertit avant que vous quittiez la page pendant un téléversement. La console n’envoie ni étiquette ni métadonnées avec le fichier. Ajoutez-les ensuite dans [[ui:metadata]] ; voir [Fichiers par chemin](./files#labels).

### Avec arkvoryctl {#upload-cli}

```bash
arkvoryctl upload ./Build/Game.zip --label test
arkvoryctl upload ./Build/Game.zip --file metadata.json --state ./job-state/game.json
arkvoryctl uploads status 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl uploads cancel 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`upload` affiche l’artefact au moment de sa publication. `--label` ajoute une étiquette. `--file` pointe vers un fichier JSON contenant `labels` et `metadata`, et est prioritaire. Pour stocker le fichier sous un chemin, utilisez `put` ; pour publier un UPack, utilisez `packages publish`. Voir [Ligne de commande](../protocols/cli#transfers).

### Avec le SDK {#upload-sdk}

```typescript
const session = await releases.uploads.create(idempotencyKey, {
  name: 'Game.zip',
  size: String(file.size),
  sha256,
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const artifact = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(bytes),
});
```

`resume` envoie les parties que le serveur ne possède pas et termine le téléversement. L’exemple complet, avec le calcul du hash dans Node.js, se trouve dans [SDK TypeScript](../protocols/sdk#upload-a-large-file-with-resume-node-js).

### Avec l’API HTTP {#upload-http}

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Idempotency-Key: game-1234" \
  -H "Content-Type: application/json" \
  -d '{"name":"Game.zip","size":"73400320","sha256":"<64 hex digits>"}'

curl "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts" -H "Authorization: Bearer $ARKVORY_KEY"

curl -X PUT "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts/0" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/octet-stream" \
  -H "X-Content-SHA256: <64 hex digits of this part>" --data-binary @part-0.bin

curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads/$ID/complete" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

La taille est une chaîne décimale. L’`Idempotency-Key` comporte de 1 à 128 lettres, chiffres, `.`, `_`, `:` ou `-`. La réponse au premier appel contient l’`id` du téléversement et `expiresAt`. Le second appel renvoie la taille de partie `partBytes` et les parties déjà stockées. Chaque partie a exactement cette taille sauf la dernière. Les opérations sont `createUpload`, `listUploadParts`, `putUploadPart` et `completeUpload` ([Téléversements](../api/reference/uploads)).

Pour un petit fichier, vous pouvez utiliser deux méthodes plus simples. `PUT /uploads/{id}/content` envoie le fichier entier en une seule requête. `PUT /raw/<path>` crée la session, envoie les octets et les stocke à un chemin en une seule requête, comme le fait `curl -T`. Les deux requêtes doivent se terminer dans les 30 minutes. Utilisez les parties pour tout ce qui est volumineux ou lent. Voir [Fichiers bruts](../protocols/raw-files). Un fichier vide passe en une seule requête.

## Taille maximale d’un fichier {#limits}

| Limite                    | Valeur                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Taille de partie          | 8 MiB pour les fichiers jusqu’à environ 78 GiB. Les fichiers plus gros utilisent 16, 32, 64 MiB, etc., jusqu’à 1 GiB, afin qu’un fichier n’ait jamais besoin de plus de 10 000 parties. |
| Parties par téléversement | 10 000 (index de 0 à 9999)                                                                                                                                                              |
| Fichier maximal           | 10 000 parties de 1 GiB, environ 10 TiB                                                                                                                                                 |
| Plafond inférieur         | L’administrateur peut en définir un avec `ARKVORY_MAX_OBJECT_BYTES`                                                                                                                     |
| Nom de fichier            | 1 à 240 caractères, sans `/`, `\` ni caractères de contrôle                                                                                                                             |

Le serveur choisit la taille de partie à la création du téléversement et la conserve pour tout le téléversement. `GET /api/v1/capabilities` affiche `maxObjectBytes`, `partBytes`, `maxPartBytes` et `maxParts`. La console refuse un fichier dépassant la limite du serveur avant de commencer.

Un client garde une partie en mémoire pendant qu’il la hache et l’envoie. Pour les fichiers dépassant 78 GiB, la partie, et donc la mémoire, augmente jusqu’à 1 GiB.

L’espace disque libre sur le serveur doit pouvoir contenir les parties et le fichier assemblé pendant un certain temps. Si le disque est plein, le serveur refuse le téléversement avec `507 storage_full`.

## Reprendre un téléversement {#resume}

Une session de téléversement conserve ses parties après un échec. Pour continuer, donnez au client le même fichier et la même session.

**Console.** Dans l’onglet ouvert, sélectionnez de nouveau [[ui:startUpload]] après [[ui:pause]]. Après avoir fermé l’onglet, conservez l’ID du téléversement. Développez [[ui:resumeTitle]] : le champ [[ui:uploadId]] affiche l’ID pendant le déroulement du téléversement. Plus tard, choisissez le même fichier, saisissez l’ID à cet endroit et sélectionnez [[ui:startUpload]]. La console compare les parties avec votre fichier. Si le fichier diffère, elle s’arrête et vous le signale. [[ui:newUpload]] efface les deux champs et démarre un nouveau téléversement.

Le champ [[ui:idempotency]] est un second moyen de revenir. La console le remplit d’elle-même. La même clé avec le même fichier renvoie la même session au lieu d’en créer une seconde.

**arkvoryctl.** Relancez la même commande avec les mêmes options. Le client a enregistré un point de contrôle `<file>.arkvory-upload.json` à côté du fichier source, ou le fichier indiqué dans `--state`, avant la première requête. Pour publier les mêmes octets comme nouvel artefact, utilisez un nouveau `--state`. En CI, conservez le fichier source et le dossier d’état entre les nouvelles tentatives. Un changement de fichier, de serveur, de dépôt ou d’options produit `checkpoint_mismatch` (code de sortie 6).

**SDK.** Appelez de nouveau `resume` avec l’ID de session enregistré et le même fichier. Pour récupérer la situation lorsque même la réponse à `create` a été perdue, appelez `create` avec la même clé d’idempotence et le même descripteur : il renvoie la même session.

**HTTP.** Lisez les parties stockées avec `listUploadParts`, puis envoyez les index manquants. Renvoyer une partie avec les mêmes octets est sans danger. D’autres octets pour un index stocké sont refusés avec `409 upload_state`.

Les clients répètent aussi une requête d’eux-mêmes après une panne réseau ou après `408`, `429`, `502`, `503` et `504` : jusqu’à 20 fois pour une opération, avec une pause qui croît de 0,5 à 60 secondes et respecte `Retry-After`. `arkvoryctl` dispose des options `--retries` et `--attempt-timeout` pour les liaisons lentes.

Seuls le compte ou la clé qui a créé un téléversement peuvent le poursuivre. Pour tout autre, il n’existe pas. Renouveler une clé de service conserve le compte, la nouvelle clé poursuit donc le téléversement.

## Sommes de contrôle {#checksums}

- **Avant le téléversement.** La console, le CLI et le SDK calculent le SHA-256 du fichier et l’envoient dans la session.
- **Chaque partie.** L’en-tête `X-Content-SHA256` contient la somme de contrôle de la partie. Une partie dont les octets ne correspondent pas est refusée avec `422 integrity_mismatch` et n’est pas stockée.
- **À la fin.** Le serveur vérifie la taille et le SHA-256 du fichier assemblé par rapport à la session avant de publier. Une différence donne `422 integrity_mismatch` ; le CLI se termine avec le code 5. L’artefact n’apparaît pas.
- **Téléchargements.** La console, le CLI et le SDK vérifient le SHA-256 du fichier entier avant de le remettre. Le fichier final n’apparaît qu’après la réussite de la vérification.

L’ETag d’un fichier est sa somme de contrôle : `"sha256:<64 hex digits>"`. Les détails de l’artefact affichent le SHA-256 et [[ui:copyHash]] le copie.

## Tâche de finalisation {#completion}

L’assemblage d’un gros fichier prend du temps. Pour les fichiers inférieurs à 16 GiB, `completeUpload` les assemble pendant la requête, ce qui peut prendre jusqu’à 30 minutes. À partir de 16 GiB, le SDK, et donc la console et le CLI, demandent au processus de traitement (worker) de le finaliser : `enqueueCompletion` répond `202` avec une tâche, et le client interroge `getCompletionJob` jusqu’à ce que l’état soit `completed` ou `failed`. Une tâche en échec possède un code d’erreur, par exemple `integrity_mismatch`.

Le service worker doit être en cours d’exécution pour les tâches. Il essaie une tâche jusqu’à 5 fois, avec une pause croissante, et abandonne immédiatement sur les erreurs qu’une nouvelle tentative ne peut corriger. Un `enqueueCompletion` répété renvoie la même tâche. Si le serveur redémarre, la tâche continue. Vous n’avez pas à recommencer le téléversement.

## Expiration des téléversements {#expiry}

Une session de téléversement inachevée expire 7 jours après sa création. L’échéance figure dans `expiresAt`, n’est pas prolongée et ne bouge pas quand vous envoyez des parties. Passé ce délai, les parties et `complete` sont refusés avec `409 upload_expired`. Démarrez un nouveau téléversement. Les fichiers publiés n’expirent jamais.

Le serveur supprime les sessions expirées et leurs parties en arrière-plan. Pour en abandonner une plus tôt, utilisez `arkvoryctl uploads cancel ID` ou `cancelUpload`. Annuler n’est pas suspendre : les parties sont jetées.

## Télécharger un fichier {#download}

### Dans la console {#download-console}

Sélectionnez [[ui:download]] à côté d’un fichier dans [[ui:catalog]], ou dans les détails de l’artefact. Le navigateur demande où enregistrer le fichier. Le fichier entre dans la file d’attente dans [[ui:downloads]]. La file écrit les données dans une copie temporaire, vérifie le SHA-256, et ne remplace le fichier cible qu’ensuite.

La file d’attente nécessite Chrome ou Edge en HTTPS ou sur l’ordinateur local, car elle écrit un gros fichier via l’accès au système de fichiers du navigateur. Les autres navigateurs doivent utiliser le CLI ou le SDK.

Les états d’un téléchargement sont [[ui:downloadQueued]], [[ui:downloadRunning]], [[ui:downloadRetrying]], [[ui:downloadPaused]], [[ui:downloadSaving]], [[ui:downloadCompleted]], [[ui:downloadFailed]] et [[ui:downloadCancelled]]. Les boutons sont :

| Bouton                                         | Effet                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| [[ui:downloadResume]]                          | Reprend un téléchargement suspendu ou en échec à partir de la partie enregistrée |
| [[ui:downloadCancel]]                          | Annule un téléchargement et supprime sa copie temporaire                         |
| [[ui:downloadsPause]] / [[ui:downloadsResume]] | Suspend et libère toute la file d’attente                                        |
| [[ui:downloadsClearWaiting]]                   | Annule les téléchargements en attente                                            |
| [[ui:downloadsCancel]]                         | Annule tous les téléchargements                                                  |
| [[ui:downloadsClearFinished]]                  | Supprime les lignes terminées pour faire de la place (la file en contient 64)    |
| [[ui:downloadRestore]]                         | Après un rechargement de page, restaure les téléchargements inachevés            |

[[ui:downloadSettings]] contient [[ui:downloadConcurrency]] (de 1 à 8, 2 par défaut), [[ui:downloadInterval]] (de 0 à 60 000 ms, 250 par défaut) et [[ui:downloadWait]] (de 1 à 1800 secondes, 300 par défaut). Sélectionnez [[ui:downloadApply]] pour les appliquer. Ils ne relèvent pas les limites du serveur.

Après un rechargement ou une fermeture d’onglet, connectez-vous de nouveau au même serveur avec le même compte, ouvrez [[ui:downloads]] et sélectionnez [[ui:downloadRestore]]. Les téléchargements restaurés attendent en pause. Sélectionnez [[ui:downloadResume]] sur chacun et choisissez de nouveau le fichier cible. Le navigateur a besoin d’espace libre pour la copie temporaire.

### Avec arkvoryctl {#download-cli}

```bash
arkvoryctl download 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game.zip
arkvoryctl get builds/game/1.4/Game.zip ./Game.zip
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

Pendant un téléchargement, `<output>.arkvory-part` et `<output>.arkvory-download.json` restent à côté de la cible. Relancez la même commande après une interruption. Le fichier final n’apparaît qu’après la vérification du SHA-256. Une cible existante n’est jamais écrasée (`destination_exists`, code de sortie 6).

### Avec HTTP : plages et ETag {#download-http}

`downloadArtifact` renvoie les octets d’un artefact. `HEAD` ne renvoie que les en-têtes.

```bash
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -C - -o Game.zip \
  "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/content"
```

- `Accept-Ranges: bytes`. Envoyez `Range: bytes=1048576-`, `bytes=0-1023` ou `bytes=-500` pour une plage. La réponse est `206` avec `Content-Range`. Plusieurs plages à la fois ne sont pas prises en charge : le serveur envoie le fichier entier. Un début au-delà de la fin donne `416`.
- `ETag` est `"sha256:<hex>"`. `If-None-Match` avec celui-ci donne `304`. `If-Range` avec celui-ci poursuit une plage uniquement si le fichier est toujours identique ; sinon le fichier entier est renvoyé.
- `curl -C -` reprend un téléchargement. Les adresses par nom sont résolues à chaque requête, par exemple `packages/content?name=app&range=^1.4`, le fichier peut donc changer entre deux appels. Pour les reprendre en toute sécurité, envoyez l’ETag obtenu dans `If-Range`, ou résolvez d’abord le nom et téléchargez par l’ID de l’artefact.

Le SDK lit le contenu par plages de 8 MiB et vérifie chacune. Voir [SDK TypeScript](../protocols/sdk#download-with-verification).

## Liens pour les personnes sans clé {#links}

Un lien de téléchargement permet à quelqu’un de récupérer un fichier sans aucune clé : un testeur, un client, une machine de build qui ne détient aucun identifiant. Le lien n’ouvre que cet artefact, pour `GET` et `HEAD`, jusqu’à son expiration. Il fonctionne avec `curl -C -` et avec les plages.

Dans la console, ouvrez l’artefact dans [[ui:metadata]] et sélectionnez [[ui:downloadLink]]. La console copie le lien et l’affiche, avec son échéance. Le lien dure une heure. Le bouton n’apparaît que si vous pouvez télécharger le fichier.

```bash
arkvoryctl link 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --ttl 900
```

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/links" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"ttlSeconds":900}'
```

La durée de vie va de 60 secondes à 24 heures (86 400 secondes) et vaut une heure par défaut. La réponse contient un `token` commençant par `dtl_`, une `url` et `expiresAt`. Le CLI et le SDK affichent une URL complète. L’API renvoie le chemin, que vous ajoutez à l’adresse du serveur.

Le lien est un secret. Quiconque le possède peut télécharger le fichier. Vous ne pouvez pas révoquer un lien avant son expiration, rendez-le donc court. Traitez l’URL comme une clé : gardez-la hors des salons de discussion et des journaux publics. Les journaux de proxy et l’historique du navigateur peuvent l’enregistrer. Voir [Liens de téléchargement](../api/reference/links).

## Limites et files d’attente {#queues}

L’administrateur définit combien de transferts le serveur exécute à la fois et à quelle vitesse. Par défaut, un serveur exécute 2 téléversements et 16 téléchargements en même temps, et un compte exécute 1 téléversement et 4 téléchargements. Les autres attendent dans une file pendant jusqu’à 20 secondes. Si la file est pleine ou si l’attente se termine, le serveur répond `503` avec `Retry-After`, et les clients attendent puis réessaient. Un budget d’octets par seconde, lorsqu’il est défini, ralentit les transferts mais ne les arrête pas. Les utilisateurs ne peuvent pas voir ni modifier ces budgets. Les valeurs se trouvent dans [Variables d’environnement](../reference/environment#transfers-and-bandwidth).

## Erreurs {#errors}

| Réponse                    | Raison                                                                                     | Que faire                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `409 upload_expired`       | La session date de plus de 7 jours                                                         | Démarrez un nouveau téléversement                                                |
| `409 upload_state`         | Le téléversement est déjà publié ou annulé, ou une partie stockée contient d’autres octets | Démarrez un nouveau téléversement, ou vérifiez que vous utilisez le même fichier |
| `409 parts_incomplete`     | Certaines parties ne sont pas arrivées                                                     | Reprenez le téléversement                                                        |
| `409 part_mismatch`        | Les parties ne correspondent pas à la taille de partie ou aux index prévus                 | Reprenez la taille de partie depuis `listUploadParts` et reprenez                |
| `409 idempotency_mismatch` | La clé a été utilisée pour un autre fichier                                                | Utilisez une nouvelle clé                                                        |
| `422 integrity_mismatch`   | Une somme de contrôle ne correspond pas                                                    | Envoyez de nouveau le fichier d’origine                                          |
| `507 storage_quota`        | Le quota du dépôt est épuisé                                                               | Supprimez d’anciens builds ou demandez un quota plus grand                       |
| `507 storage_full`         | Le disque du serveur est plein                                                             | Contactez l’administrateur                                                       |
| `503` avec `Retry-After`   | Le serveur est occupé                                                                      | Attendez, les clients réessaient d’eux-mêmes                                     |

La liste complète se trouve dans [Erreurs](../api/errors).

## Pages associées {#related-pages}

- [Ligne de commande (arkvoryctl)](../protocols/cli) et [SDK TypeScript](../protocols/sdk)
- [Fichiers par chemin](./files) et [Paquets](./packages)
- Référence API : [Téléversements](../api/reference/uploads), [Liens de téléchargement](../api/reference/links), [Artefacts](../api/reference/artifacts)
