---
title: 'Webhooks'
description: 'Recevez une requête HTTP quand un dépôt change : configurez un abonnement, vérifiez la signature et gérez les livraisons répétées.'
---

# Webhooks

Un webhook signale à votre système qu'un dépôt a changé, sans qu'il ait à interroger le serveur. Le worker d'Arkvory envoie un `POST` HTTP à votre URL pour chaque événement du [flux de changements](../api/reference/artifacts#listCatalogChanges) du dépôt. Utilisez-le pour lancer un déploiement à la publication d'un build ou pour rafraîchir un cache quand un chemin reçoit une nouvelle version.

L'administrateur définit les abonnements dans un fichier. Il n'y a pas encore d'API ni de page de console pour cela. Vous pouvez aussi lire le flux vous-même avec `GET /api/v1/repositories/<repository>/changes`.

## Fonctionnement de la livraison {#how-it-works}

- **Un abonnement suit un dépôt** et envoie vers une URL.
- **Les événements arrivent dans l'ordre, un par un.** Le suivant attend que le destinataire ait répondu avec un statut `2xx`.
- **La livraison a lieu au moins une fois.** Après un plantage ou une réponse perdue, le même événement peut arriver de nouveau. Chaque événement a un `id` stable : dédupliquez avec lui.
- **Un nouvel abonnement ne reçoit que les nouveaux événements.** Ceux d'avant sa création ne sont pas envoyés.
- **Un destinataire hors service ne retarde que son propre abonnement.** L'événement attend. Arkvory réessaie après 12 secondes, double la pause jusqu'à une heure et envoie les événements dans l'ordre quand le destinataire répond de nouveau. Les envois et téléchargements n'attendent jamais un webhook.

## Configurer un abonnement {#set-up}

Vous avez besoin d'un accès aux fichiers du serveur et du droit de redémarrer le worker. Voir [Configuration](../install/configuration).

1. Créez un fichier avec le secret de signature : au moins 16 caractères imprimables aléatoires, par exemple `/root/ci.secret`. Le destinataire a besoin du même secret.
2. Lancez `configure` avec l'abonnement. La commande vérifie votre saisie, copie le secret dans `config/webhooks`, écrit le fichier d'abonnements et le réglage, redémarre les services et rétablit la configuration précédente s'ils ne deviennent pas prêts. Elle ne contacte pas le destinataire.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --webhook ci --webhook-repository releases \
  --webhook-url https://ci.example.com/hooks/arkvory \
  --webhook-secret-file /root/ci.secret \
  --webhook-actions artifact.publish
```

3. Cherchez `webhook.started` dans le journal du worker, publiez un fichier et regardez votre destinataire.

La commande écrit `config/webhooks/webhooks.json`, que vous pouvez aussi écrire à la main et indiquer dans `ARKVORY_WEBHOOKS_FILE`. Pour modifier un abonnement, relancez la commande avec le même nom. `--webhook-detach ci` le supprime : ses fichiers sont effacés et sa position oubliée. Un appel modifie un abonnement et ne se combine pas avec d'autres options de `configure`.

Le fichier comporte ces champs :

```json
{
  "webhooks": [
    {
      "id": "ci",
      "repository": "releases",
      "url": "https://ci.example.com/hooks/arkvory",
      "secretFile": "/opt/proanima-arkvory/config/webhooks/ci.secret",
      "actions": ["artifact.publish"]
    }
  ]
}
```

| Champ            | Signification                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Nom de l'abonnement : 1 à 64 caractères `a-z`, `0-9`, `_` et `-`. Sa progression est conservée sous ce nom.                                                                                          |
| `repository`     | Le dépôt dont le flux est envoyé.                                                                                                                                                                    |
| `url`            | Le destinataire. HTTPS, sans nom d'utilisateur, query ni fragment, 2048 caractères au plus. HTTP en clair n'est permis que pour `localhost`, `127.0.0.1` et `[::1]`.                                 |
| `secretFile`     | Chemin absolu du fichier contenant le secret de signature.                                                                                                                                           |
| `nextSecretFile` | Second secret facultatif pour une [rotation](#rotate-the-secret).                                                                                                                                    |
| `actions`        | Liste facultative des actions du flux à envoyer, par exemple `artifact.publish`, `artifact.delete`, `asset.replace`, `stage.add` et `package.register`. Sans elle, toutes les actions sont envoyées. |

Un fichier incorrect arrête le worker au démarrage avec `worker.unavailable`. Jusqu'à 16 abonnements sont autorisés. Sur une installation Compose, la commande monte aussi `config/webhooks` dans le conteneur du worker.

## La requête {#request}

| En-tête               | Valeur                                                                              |
| --------------------- | ----------------------------------------------------------------------------------- |
| `Content-Type`        | `application/json`                                                                  |
| `X-Arkvory-Delivery`  | L'`id` de l'événement. Il est identique à chaque répétition d'un événement.         |
| `X-Arkvory-Event`     | L'action du flux, par exemple `artifact.publish`.                                   |
| `X-Arkvory-Timestamp` | Heure Unix en secondes à laquelle la requête a été signée.                          |
| `X-Arkvory-Signature` | `sha256=<hex>`. Pendant une rotation, il y a deux valeurs séparées par une virgule. |

Le corps est du JSON :

```json
{
  "id": "releases:128",
  "repository": "releases",
  "sequence": "128",
  "action": "artifact.publish",
  "artifactId": "00000000-0000-4000-8000-000000000001",
  "detail": null
}
```

`sequence` est la position dans le flux, une chaîne décimale. `detail` est le chemin du fichier ou l'étape pour les actions qui en ont une. Le corps ne contient ni auteur, ni contenu de fichier, ni métadonnées : utilisez `artifactId` pour lire l'état actuel via l'[API](../api/index).

Répondez avec un statut `2xx` en moins de 10 secondes. Un statut `3xx` (les redirections ne sont pas suivies), `4xx`, `5xx`, une erreur de connexion ou un délai dépassé compte comme un échec. Arkvory lit au plus 4 Kio de la réponse et l'ignore.

## Vérifier la signature {#verify}

La signature est un HMAC-SHA256 avec votre secret sur le texte `<timestamp>.<body>`, écrit `sha256=` suivi du condensat hexadécimal. Vérifiez-la avant de faire confiance à une requête :

1. Lisez le corps brut, avant tout décodage JSON.
2. Refusez la requête si l'horodatage diffère de votre horloge de plus de 5 minutes.
3. Calculez la signature et comparez-la avec une fonction à temps constant. Si l'en-tête a deux valeurs, acceptez l'une ou l'autre.

Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, headers, rawBody) {
  const timestamp = headers['x-arkvory-timestamp'];
  if (!/^\d{1,12}$/.test(timestamp ?? '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(
    'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  );
  return String(headers['x-arkvory-signature'] ?? '')
    .split(',')
    .some((given) => {
      const actual = Buffer.from(given.trim());
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
}
```

Python:

```python
import hashlib, hmac, time

def verify(secret: bytes, headers, raw_body: bytes) -> bool:
    timestamp = headers.get("X-Arkvory-Timestamp", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    digest = hmac.new(secret, timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    expected = "sha256=" + digest
    given = headers.get("X-Arkvory-Signature", "").split(",")
    return any(hmac.compare_digest(part.strip(), expected) for part in given)
```

## Gérer les livraisons répétées {#repeats}

- Conservez l'`id` de chaque événement traité et ignorez une répétition.
- Répondez vite : mettez le travail en file et renvoyez `204`. Un destinataire lent retarde tous les événements suivants de son abonnement.
- Une répétition ne signifie pas que l'opération a eu lieu deux fois. Traitez l'événement comme un indice et lisez l'état actuel depuis l'API.

## Renouveler le secret {#rotate-the-secret}

1. Relancez la même commande avec `--webhook-secret-file` pour le secret actuel et `--webhook-next-secret-file` pour le nouveau. Chaque requête porte alors deux signatures.
2. Passez le destinataire au nouveau secret. Un destinataire qui accepte l'une ou l'autre signature continue de fonctionner entre-temps.
3. Relancez la commande avec le nouveau fichier de secret dans `--webhook-secret-file` et sans `--webhook-next-secret-file`.

## Destinataires privés et certificats {#private-receivers}

- Arkvory refuse les destinataires sur des adresses loopback, privées, link-local et de métadonnées cloud, ainsi que les noms qui y mènent. Le serveur ne peut ainsi pas servir à atteindre des services internes.
- Pour envoyer vers un destinataire de votre réseau, ajoutez ce réseau avec `--webhook-allow-private`, par exemple `--webhook-allow-private 10.20.0.0/16` (`ARKVORY_WEBHOOKS_ALLOW_PRIVATE`). Il reste jusqu'à la suppression du dernier abonnement.
- Si le certificat du destinataire vient de votre propre autorité, ajoutez un fichier PEM de cette autorité avec `--webhook-ca-file` (`ARKVORY_WEBHOOKS_CA_FILE`). Le certificat est toujours vérifié.

## Surveiller les webhooks {#monitor}

Le worker écrit `webhook.step_failed` avec un `errorCode` quand une livraison échoue, et `webhook.recovered` quand elle refonctionne. Les métriques `arkvory_webhook_failing` et `arkvory_webhook_last_success_timestamp_seconds` et l'alerte `ArkvoryWebhookFailing` sont décrites dans [Surveillance](../operate/monitoring).

## Dépannage {#troubleshooting}

| `errorCode` | Cause et que faire                                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked`   | L'adresse du destinataire n'est pas autorisée (loopback, privée, link-local ou métadonnées). Utilisez une adresse publique ou ajoutez le réseau à `ARKVORY_WEBHOOKS_ALLOW_PRIVATE`. |
| `timeout`   | Pas de réponse en 10 secondes. Répondez plus vite et mettez le travail en file.                                                                                                     |
| `network`   | Connexion refusée, nom introuvable ou connexion réinitialisée. Vérifiez l'URL, le DNS et le pare-feu depuis le serveur.                                                             |
| `tls`       | Le certificat n'est pas approuvé, a expiré ou porte un mauvais nom. Corrigez-le ou définissez `ARKVORY_WEBHOOKS_CA_FILE`.                                                           |
| `redirect`  | Le destinataire a répondu `3xx`. Les redirections ne sont pas suivies : utilisez l'URL finale.                                                                                      |
| `http_4xx`  | Le destinataire a refusé la requête. Vérifiez sa vérification de signature, son chemin et sa clé.                                                                                   |
| `http_5xx`  | Le destinataire est en panne. Arkvory continue de réessayer, avec jusqu'à une heure entre les essais.                                                                               |
| `secret`    | Le fichier de secret est absent, illisible ou plus court que 16 octets.                                                                                                             |

Rien n'arrive ? Vérifiez que `webhook.started` figure dans le journal du worker, que `ARKVORY_WEBHOOKS_FILE` est défini, le nom du dépôt et le filtre `actions`. Un nouvel abonnement n'envoie que les événements postérieurs à sa première étape.

## Pages associées {#related-pages}

- [Configuration](../install/configuration)
- [Surveillance](../operate/monitoring)
- [Le flux de changements dans la référence API](../api/reference/artifacts#listCatalogChanges)
