---
title: SDK TypeScript
---

# SDK TypeScript

Le SDK TypeScript est la bibliothèque cliente qu’utilisent la console et `arkvoryctl`. Il encapsule l’API REST `/api/v1`. Il valide chaque réponse à l’exécution, téléverse par parties, reprend les transferts interrompus et vérifie les téléchargements par SHA-256. Il n’utilise que des API web standard (`fetch`, flux, Web Crypto) : il fonctionne donc dans Node.js comme dans les navigateurs.

## Obtenir le SDK {#get-the-sdk}

Le SDK est le paquet d’espace de travail `@proanima/arkvory-sdk`, dans le dossier `packages/sdk` du dépôt source `ProAnima/Arkvory`. Il n’est **pas publié dans le registre npm**. Il dépend du paquet d’espace de travail `@proanima/arkvory-contracts`.

- Pour l’utiliser, compilez le dépôt source (`npm ci`, puis `npm run build`) et écrivez votre outil dans cet espace de travail, comme le font les scripts du dépôt lui-même.
- Depuis un autre langage, ou depuis un projet qui ne peut pas utiliser l’espace de travail, appelez directement l’[API REST](../api/index) avec `Authorization: Bearer <key>`.

Le code source est disponible sous la licence d’Arkvory. Vous pouvez l’utiliser et le modifier au sein de votre organisation. Vous ne pouvez pas en distribuer des copies.

## Créer un client {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **URL de base.** HTTPS est obligatoire. HTTP simple n’est autorisé que pour `localhost`, `127.0.0.1` et `[::1]`. L’URL ne doit contenir ni utilisateur, ni mot de passe, ni paramètres de requête, ni fragment. Elle peut contenir un préfixe de chemin. Les redirections sont traitées comme des erreurs.
- **Fonction de rappel du jeton.** Le SDK l’appelle à chaque requête et ne met jamais le résultat en cache. Vous pouvez renouveler les clés sans créer de nouveau client.
- **`inRepository(id)`** renvoie un client lié à un seul dépôt. C’est une commodité, pas une frontière de sécurité.

| Option             | Valeur par défaut | Signification                                                                                                                          |
| ------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `signal`           | aucune            | Annule toutes les requêtes de ce client                                                                                                |
| `requestTimeoutMs` | aucune            | Délai d’une requête qui n’a pas son propre signal (1 à 3600000)                                                                        |
| `maxAttempts`      | 5                 | Tentatives d’une requête de transfert, la première comprise (1 à 10)                                                                   |
| `maxRetries`       | 20                | Nouvelles tentatives partagées par une opération de téléversement ou de téléchargement (0 à 100)                                       |
| `attemptTimeoutMs` | 120000            | Limite d’une tentative de transfert (1 à 1800000)                                                                                      |
| `baseDelayMs`      | 500               | Premier délai d’attente entre deux tentatives, avec temporisation exponentielle (1 à 60000)                                            |
| `maxDelayMs`       | 60000             | Délai le plus long, `Retry-After` compris                                                                                              |
| `onRequest`        | aucune            | Appelée une fois par requête HTTP avec la méthode, le chemin, le statut, la durée et l’ID de requête. Ne reçoit jamais d’identifiants. |

Les nouvelles tentatives automatiques ne concernent que les transferts : `create`, les opérations internes de `resume` et `downloadVerified`. Elles s’appliquent aux échecs réseau et aux codes HTTP 408, 429, 502, 503 et 504, avec une temporisation exponentielle, et jamais avant l’échéance de `Retry-After`. Les autres appels ne s’exécutent qu’une fois. Les modifications protégées par une révision ne sont jamais répétées automatiquement.

## Tâches courantes {#common-tasks}

### Découvrir et lister {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

Les pages renvoient `next`. Transmettez-le comme `after` pour lire la page suivante.

### Téléverser un gros fichier avec reprise (Node.js) {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // non chargé en mémoire
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // à enregistrer avec l’état du job avant la première requête
const session = await releases.uploads.create(key, {
  name: 'Game.zip',
  size: String(file.size),
  sha256: hash.digest('hex'),
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const uploaded = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(`${bytes} of ${file.size} bytes`),
});
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0 : le chemin est nouveau
```

- La même clé d’idempotence avec le même descripteur renvoie la même session : une réponse perdue ne crée donc pas un second téléversement.
- `resume` lit les parties que le serveur possède déjà, compare leurs empreintes avec votre fichier et n’envoie que les parties manquantes. Après un plantage, appelez de nouveau `resume` avec l’ID de session enregistré.
- Le serveur choisit la taille des parties : 8 MiB, et plus seulement pour les fichiers qui demanderaient plus de 10 000 parties. Le SDK ne garde qu’une partie en mémoire à la fois.
- Les fichiers de 16 GiB et plus sont finalisés par le processus de traitement du serveur. `resume` l’attend.
- `assets.assign(path, artifactId, expectedRevision)` échoue avec un conflit si le chemin est à une autre révision. Lisez d’abord le chemin avec `assets.get(path)`.

### Télécharger avec vérification {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // seulement après le succès de pipeTo
```

Le SDK lit le contenu par plages de 8 MiB et vérifie la taille, `Content-Range` et `ETag` de chaque plage. Il vérifie le SHA-256 du fichier entier avant de livrer le dernier bloc. Si la vérification échoue, le flux échoue avec `ArkvoryIntegrityError`. Ne déployez jamais directement depuis le flux : écrivez dans un fichier temporaire et ne l’utilisez qu’une fois le flux terminé avec succès.

Pour reprendre après un redémarrage, transmettez en `prefix` les octets déjà enregistrés. Le flux ne contient alors que le reste :

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

Pour une seule plage d’octets sans vérification, `releases.artifacts.download(id, { start: 0, end: 1023 })` renvoie la `Response` brute (statut 206).

### Fichiers bruts par chemin {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // facultatif : refuser si le chemin existe
});
console.log(result.revision, result.created); // created vaut false si les octets étaient déjà là
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

L’option `sha256` (64 chiffres hexadécimaux) permet au serveur d’écrire les octets en un seul passage et de rejeter toute différence. `releases.assets.put(path, blob, options)` et `releases.assets.download(path, range)` sont les mêmes appels. Chaque téléversement tient en une seule requête : réservez-les donc aux fichiers de taille petite ou moyenne. Voir [Fichiers bruts](./raw-files).

### Paquets, promotion et liens {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // archive UPack
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

L’URL du lien est un secret qui permet de lire un artefact jusqu’à `expiresAt`. Elle ne peut pas être révoquée avant.

### Sauvegardes {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // mise en file d’attente pour l’agent de sauvegarde
const points = await client.backup.points({ limit: 20 });
```

Les appels de sauvegarde nécessitent une session d’administrateur de compte ou la clé de fichier du propriétaire. Les clés de service et les jetons personnels reçoivent 403.

## Erreurs {#errors}

```typescript
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

try {
  await releases.artifacts.get(id);
} catch (error) {
  if (error instanceof ArkvoryHttpError) {
    console.error(error.status, error.code, error.reason, error.requestId, error.retryAfterSeconds);
  } else if (error instanceof ArkvoryClientError) {
    console.error(error.code);
  }
}
```

| Classe                  | Signification                                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArkvoryHttpError`      | Le serveur a répondu par une erreur. Champs : `status`, `code`, `reason`, `details`, `requestId`, `retryAfterMs`, `retryAfterSeconds`, `serverMessage`. `code` vaut `http_error` lorsqu’un proxy a répondu sans respecter le format d’Arkvory. |
| `ArkvoryNetworkError`   | La connexion a échoué ou le délai a expiré après toutes les nouvelles tentatives                                                                                                                                                               |
| `ArkvoryIntegrityError` | Les octets téléchargés ne correspondent pas à l’artefact                                                                                                                                                                                       |
| `ArkvoryClientError`    | Échec local, avec un `code` parmi : `invalid_argument`, `insecure_url`, `invalid_response`, `response_too_large`, `size_mismatch`, `file_changed`, `upload_cancelled`, `completion_failed`                                                     |

Décidez d’après `code` et `reason`, pas d’après le texte du message. Traitez les codes inconnus d’après le statut HTTP. `Error.message` ne contient jamais de texte du serveur. Voir [Erreurs](../api/errors).

## Navigateur et Node.js {#browser-and-node-js}

- **Navigateur sur une autre origine.** L’administrateur doit lister l’origine exacte de votre page dans `ARKVORY_CORS_ORIGINS` sur le serveur. Le SDK envoie la clé dans l’en-tête `Authorization` et n’envoie jamais de cookies.
- **Clés dans un navigateur.** Gardez la clé en mémoire uniquement. Ne la placez ni dans des URL, ni dans `localStorage`, ni dans des journaux, ni dans le code source de la page. Un utilisateur peut se connecter avec `client.login(name, password)` pour obtenir un jeton de session.
- **Fichiers dans Node.js.** Utilisez `openAsBlob` de `node:fs` pour transmettre un fichier sans le lire en mémoire.
- **File de téléchargement.** `DownloadQueue` et `checkpointedDownload` fournissent une file bornée avec pause, reprise et annulation. Vous fournissez l’adaptateur de stockage.

## Limites {#limits}

- Les réponses JSON sont limitées à 2 MiB (pages de paquets : 8 MiB, listes d’artefacts : 24 MiB). Les réponses plus volumineuses échouent avec `response_too_large`.
- Les tailles sont des chaînes décimales : les valeurs supérieures à 2^53 conservent donc toute leur précision.

## Pages associées {#related-pages}

- [Ligne de commande (arkvoryctl)](./cli)
- [Transferts](../use/transfers)
- [Présentation de l’API](../api/index) et [Authentification](../api/authentication)
- [Fichiers bruts](./raw-files)
