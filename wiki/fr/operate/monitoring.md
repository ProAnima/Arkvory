---
title: Supervision
description: 'Points de terminaison d’état, métriques, journaux, diagnostics de la console et liste d’alertes suggérée pour un serveur Arkvory.'
---

# Supervision

Arkvory offre quatre sources de faits : des points de terminaison d’état qui répondent à « est-il en marche », des métriques Prometheus, des lignes de journal JSON et les diagnostics de la console. Cette page décrit ce que contient chaque source et se termine par un ensemble d’alertes pour commencer.

Les métriques, les points de terminaison d’état et les événements de journal décrivent un processus API. Le processus de traitement et l’agent de sauvegarde n’ont pas de port HTTP. Vous les voyez à travers les lignes de journal, les métriques de la file de finalisation et l’état des sauvegardes.

## Vérifier un serveur maintenant {#quick-check}

1. Interrogez le point de terminaison d’état public. Il ne demande aucune clé :

   ```bash
   curl -fsS http://127.0.0.1:8080/health/status
   ```

   `{"status":"ready"}` avec HTTP 200 signifie que l’API atteint sa base de données et son répertoire de stockage.

2. Demandez la réponse de disponibilité complète avec la clé d’état créée par le programme d’installation :

   ```bash
   sudo sh -c 'curl -fsS -H "Authorization: Bearer $(cat /opt/proanima-arkvory/config/health-token.txt)" http://127.0.0.1:8080/health/ready'
   ```

   ```powershell
   $root = 'C:\ProgramData\ProAnima\Arkvory'
   $key = (Get-Content "$root\config\health-token.txt" -Raw).Trim()
   Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://127.0.0.1:8080/health/ready
   ```

3. Vérifiez les sauvegardes :

   ```bash
   arkvoryctl backup status
   ```

   La commande nécessite la clé de récupération ou la session d’un administrateur. Elle se termine avec le code 9 lorsqu’un avertissement critique est actif. Pour les contrôles automatisés, utilisez les alertes Prometheus ci-dessous. Voir [Ligne de commande](../protocols/cli).

4. Vérifiez les services et les dernières lignes de journal. Voir [Journaux](#logs).

`arkvory status --root <root>` affiche la version installée, le mode d’installation et la politique de mise à jour. Il n’interroge pas le serveur. `arkvoryctl doctor` montre le serveur, le dépôt, les fonctionnalités et les autorisations d’une clé. C’est un contrôle côté client, pas un contrôle d’état.

## État et disponibilité {#health}

Trois points de terminaison répondent sur le port de l’API. Aucun d’eux ne compte dans le budget de requêtes `ARKVORY_MAX_REQUESTS`, donc une charge de transfert ne peut pas faire paraître un serveur mort. Tous les trois continuent de répondre pendant que le serveur se vide avant un arrêt.

| Chemin           | Clé              | Réponse                                                                                                      | Usage                                                     |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `/health/live`   | Non              | 200 `{"status":"ok"}` tant que le processus répond                                                           | Un contrôle de processus                                  |
| `/health/status` | Non              | 200 `{"status":"ready"}`, ou 503 `{"status":"unavailable"}` ou `{"status":"draining"}` avec `Retry-After: 2` | Répartiteurs de charge et sondes de disponibilité         |
| `/health/ready`  | Toute clé valide | 200 avec les détails ci-dessous, ou 503 avec l’enveloppe d’erreur et `Retry-After`                           | Contrôles de déploiement et le contrôle d’état de Compose |

`/health/status` et `/health/ready` vérifient trois choses : la base de données répond et possède exactement les migrations de cette version, le dossier `blobs` du répertoire de stockage existe, et le processus détient toujours son verrou de stockage. Le résultat de `/health/status` est mis en cache pendant une seconde, de sorte que les sondes publiques ne peuvent pas multiplier les requêtes vers la base de données. Un serveur en cours de vidage répond `draining` immédiatement.

Sans clé, `/health/ready` renvoie 401. La clé `deployment-health` que crée le programme d’installation n’a ni droits sur les dépôts ni droits d’administrateur. Son secret se trouve dans `config/health-token.txt`.

Une réponse 200 de `/health/ready` contient ces champs :

| Champ             | Signification                                                                                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | Toujours `ready` dans une réponse 200                                                                                                                                                                                                                                                                                                        |
| `writable`        | `false` lorsque l’espace libre du volume de stockage est inférieur à `ARKVORY_STORAGE_RESERVE_BYTES`, et sur une passerelle de lecture. Les lectures fonctionnent toujours                                                                                                                                                                   |
| `replication`     | Uniquement dans un [cluster à haute disponibilité](./cluster) : `copies`, `required` et `singleCopyUntil`, ou `null` lorsque les copies ne peuvent pas être lues. `writable` vaut `false` tant que des copies manquent                                                                                                                       |
| `role`            | `api`, ou `reader` pour une passerelle de lecture                                                                                                                                                                                                                                                                                            |
| `sharedDownloads` | Le bail d’une passerelle de lecture (`slot`, `slots`, `active`, `leaseSeconds`), ou `null`                                                                                                                                                                                                                                                   |
| `transfers`       | Pour `uploads` et `downloads` : `admission` (`active`, `waiting`, `capacity`, `perPrincipalCapacity`, `waitingCapacity`, `perPrincipalWaitingCapacity`, `timeoutMs`, `rejected`, `timedOut`, `cancelled`) et `bandwidth` (`bytesPerSecond`, `perPrincipalBytesPerSecond`, `burstBytes`, `perPrincipalBurstBytes`, `waiting`, `grantedBytes`) |

Un contrôle de disponibilité en échec ne redémarre jamais un service à lui seul. Voir [Autoréparation](./self-healing).

## Métriques {#metrics}

`GET /health/metrics` renvoie les métriques du processus API au format texte Prometheus (version 0.0.4). Toute clé valide peut les lire, et cela fonctionne pendant que le serveur se vide. Créez une clé de service avec le minimum de droits pour le collecteur, et conservez-la dans un fichier que seul Prometheus lit.

```yaml
scrape_configs:
  - job_name: arkvory
    metrics_path: /health/metrics
    scheme: https
    authorization:
      credentials_file: /etc/prometheus/arkvory.key
    static_configs:
      - targets: ['arkvory.example:443']
```

La tâche doit être nommée `arkvory` : les règles d’alerte fournies la sélectionnent par son nom.

Les valeurs appartiennent au processus et repartent de zéro après un redémarrage. `arkvory_process_start_time_seconds` change lorsque cela se produit. Les étiquettes sont bornées : `route` est le modèle de route, jamais l’URL, et `status_class` vaut `2xx`, `5xx`, etc.

| Métrique                                                                                    | Étiquettes                                                 | Signification                                                                                             |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `arkvory_http_requests_total`                                                               | `method`, `route`, `status_class`                          | Réponses closes                                                                                           |
| `arkvory_http_request_duration_seconds`                                                     | idem                                                       | Histogramme de durée de 5 ms à 1800 s. Les transferts interrompus sont inclus                             |
| `arkvory_http_request_bytes_total`, `arkvory_http_response_bytes_total`                     | `method`, `route`                                          | Octets de socket, en-têtes inclus                                                                         |
| `arkvory_http_requests_in_flight`                                                           |                                                            | Requêtes admises dont les réponses sont encore ouvertes                                                   |
| `arkvory_transfer_active`, `arkvory_transfer_queue_depth`                                   | `direction`                                                | Transferts admis et transferts en attente d’un emplacement                                                |
| `arkvory_transfer_admission_failures_total`                                                 | `direction`, `reason`                                      | Transferts refusés par l’admission : `rejected` (file pleine), `timed_out`, `cancelled`                   |
| `arkvory_completion_jobs`                                                                   | `state` (`queued`, `running`)                              | Tâches de finalisation de téléversement dans la base de données                                           |
| `arkvory_completion_oldest_queued_seconds`                                                  |                                                            | Attente de la plus ancienne tâche en file exécutable                                                      |
| `arkvory_diagnostic_records_total`                                                          | `outcome` (`written`, `dropped`, `truncated`, `oversized`) | Lignes de journal par résultat                                                                            |
| `arkvory_metrics_collection_failures_total`                                                 | `collector` (`jobs`, `backup`, `mirror`, `webhook`)        | Lectures échouées de métriques adossées à la base de données                                              |
| `arkvory_backup_last_success_timestamp_seconds`                                             |                                                            | Heure d’instantané du point de sauvegarde terminé le plus récent                                          |
| `arkvory_backup_agent_last_seen_timestamp_seconds`                                          |                                                            | Dernier battement de cœur de l’agent de sauvegarde                                                        |
| `arkvory_backup_warnings`                                                                   | `code`                                                     | 1 tant que l’avertissement est actif, 0 sinon                                                             |
| `arkvory_mirror_last_sync_timestamp_seconds`, `arkvory_mirror_last_check_timestamp_seconds` | `repository`, `mode`                                       | Dernière synchronisation avec la source et dernière lecture de son flux                                   |
| `arkvory_mirror_failing`                                                                    | `repository`, `mode`                                       | 1 tant que la dernière tentative de synchronisation a échoué                                              |
| `arkvory_webhook_failing`, `arkvory_webhook_last_success_timestamp_seconds`                 | `subscription`, `repository`                               | Livraison des webhooks : 1 tant que la dernière tentative a échoué, et heure de la dernière réponse `2xx` |
| `arkvory_tls_certificate_expiry_timestamp_seconds`                                          |                                                            | Expiration du certificat HTTPS intégré. Présent uniquement avec HTTPS intégré                             |
| `arkvory_build_info`                                                                        | `service`, `version`                                       | Toujours 1                                                                                                |
| `arkvory_process_start_time_seconds`, `arkvory_process_resident_memory_bytes`               |                                                            | Heure de démarrage et mémoire résidente                                                                   |

Les métriques adossées à la base de données (finalisation, sauvegarde, miroir) sont lues au plus toutes les 5 secondes. Lorsqu’une lecture échoue, le serveur omet ces métriques au lieu d’afficher d’anciennes valeurs, et `arkvory_metrics_collection_failures_total` augmente.

Le 99e centile des requêtes de gestion, sans les transferts de fichiers :

```text
histogram_quantile(0.99, sum by (le) (rate(arkvory_http_request_duration_seconds_bucket{route!~".*(content|parts).*"}[10m])))
```

Arkvory n’exporte pas l’espace libre du volume de stockage ni celui de la base de données. Utilisez `node_exporter` pour les volumes et `postgres_exporter` pour PostgreSQL.

## Journaux {#logs}

L’API, le processus de traitement, l’agent de sauvegarde et les outils de maintenance écrivent un objet JSON par ligne sur la sortie standard. Le serveur n’écrit pas lui-même de fichiers de journal. Le gestionnaire de services de votre plateforme recueille les lignes.

| Installation                  | Où lire                                                                                                                                                                                                                                                                              | Rotation                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Linux (paquets, `install.sh`) | `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. La base de données gérée est `arkvory-database`, le programme de mise à jour est `arkvory-update`                                                                                                                   | Définie par journald                             |
| Windows                       | `logs\arkvory-api.out.log`, `arkvory-worker.out.log`, `arkvory-backup.out.log` dans la racine d’installation. La sortie d’erreur va dans les fichiers `.err.log` voisins. Le programme de mise à jour écrit `logs\updater.log`, le service de base de données écrit dans `database\` | 20 MiB par fichier, 5 anciens fichiers conservés |
| Docker Compose                | `docker logs --tail 100 proanima-arkvory-api-1`, et de même pour `-worker-1` et `-backup-1`                                                                                                                                                                                          | 20 MiB par fichier, 5 fichiers par conteneur     |

Un blocage termine un processus avec l’enregistrement `process.stalled` sur la sortie d’erreur, alors regardez aussi dans le fichier `.err.log` ou dans le journal. Voir [Windows](../install/windows#logs) pour les autres fichiers de `logs\`.

Chaque ligne commence par les mêmes champs :

| Champ                        | Valeur                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `timestamp`                  | Heure UTC au format ISO 8601                                                                                 |
| `level`                      | `debug`, `info`, `warning` ou `error`                                                                        |
| `service`                    | `api`, `worker`, `backup`, `migrate`, `gc` ou `scrub`                                                        |
| `version`, `pid`, `hostname` | Version, processus et hôte                                                                                   |
| `component`                  | `api`, `http`, `storage`, `worker`, `maintenance`, `backup`, `mirror`, `migrate`, `process` ou `diagnostics` |
| `code`                       | Le nom de l’événement                                                                                        |

Les autres champs proviennent d’une liste fixe : identifiants (`requestId`, `traceId`, `jobId`, `uploadId`, `artifactId`, `repository`, `principal`, `clientIp`), nombres (`status`, `durationMs`, `bytesSent`, `bytesReceived`, `attempts`) et champs de raison (`errorCode`, `errorName`, `errno`, `sqlstate`, `reason`). `ARKVORY_LOG_LEVEL` définit le niveau le plus bas qui est écrit.

### Événements importants {#log-events}

| Événement (`code`)                                                                                    | Niveau                                   | Signification et première action                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.listening`                                                                                       | info                                     | L’API sert les requêtes. Champs `address`, `port` et `tls`                                                                                      |
| `startup.failed`                                                                                      | error                                    | L’API n’a pas démarré. `reason` nomme la cause. Voir [Dépannage](./troubleshooting#server-does-not-start)                                       |
| `worker.unavailable`                                                                                  | error                                    | Le processus de traitement n’a pas démarré ou s’est arrêté sur une erreur                                                                       |
| `http.plaintext_exposed`                                                                              | warning                                  | L’API écoute sur une adresse non locale sans TLS et sans proxy de confiance                                                                     |
| `http.access`                                                                                         | info                                     | Une ligne par requête terminée ou interrompue                                                                                                   |
| le code d’erreur d’une requête, par exemple `unavailable` ou `internal`                               | warning pour les 4xx, error pour les 5xx | Une requête échouée avec `requestId`, `route`, `status` et, pour les erreurs système, `errorName`, `errno` ou `sqlstate`                        |
| `upload.input_timeout`, `upload.deadline`                                                             | warning                                  | Un téléversement a cessé d’envoyer des données, ou a duré plus longtemps que `ARKVORY_UPLOAD_DEADLINE_MS`                                       |
| `api.ownership_lost`, `worker.ownership_lost`                                                         | error                                    | La session de base de données qui prouve la propriété du stockage s’est rompue. Le processus se termine et redémarre                            |
| `process.stalled`                                                                                     | error                                    | Le watchdog a terminé un processus bloqué. Champ `stalledSeconds`                                                                               |
| `process.unhandled`                                                                                   | error                                    | Une erreur inattendue a terminé le processus                                                                                                    |
| `process.watchdog_failed`                                                                             | warning                                  | Le watchdog n’a pas pu démarrer. Le service fonctionne sans lui                                                                                 |
| `drain.started`, `drain.settled`, `drain.timeout`, `api.stopped`                                      | info ou warning                          | Un arrêt gracieux. `drain.timeout` signifie que des requêtes ont été coupées                                                                    |
| `tls.reloaded`, `tls.reload_failed`, `tls.expiring`                                                   | info ou warning                          | Les fichiers de certificat ont été relus, n’ont pas pu être lus, ou expirent dans moins de 14 jours. `tls.expiring` se répète une fois par jour |
| `completion.completed`, `completion.failed`, `completion.lease_lost`, `completion.attempts_exhausted` | info ou error                            | Le résultat d’une tâche de finalisation de téléversement, avec `jobId`, `uploadId` et `errorCode`                                               |
| `backup.agent.started`, `backup.agent.standby`, `backup.agent.lease_lost`                             | info ou warning                          | État de l’agent de sauvegarde                                                                                                                   |
| `backup.request.failed`, `backup.request.requeued`, `backup.failed`                                   | error ou warning                         | Une tâche de sauvegarde a échoué ou est exécutée de nouveau. Champ `errorCode`                                                                  |
| `mirror.step_failed`, `mirror.recovered`                                                              | warning ou info                          | Une étape de synchronisation de miroir a échoué (`errorCode`, `attempts`), ou fonctionne de nouveau                                             |
| `webhook.step_failed`, `webhook.recovered`                                                            | warning ou info                          | Une livraison de webhook a échoué (`subscription`, `errorCode`, `attempts`) ou refonctionne                                                     |
| `migrate.started`, `migrate.completed`, `migrate.failed`                                              | info ou error                            | La migration de base de données d’une mise à jour                                                                                               |
| `diagnostics.dropped`, `diagnostics.oversized`                                                        | warning                                  | Des lignes ont été écartées parce que le lecteur de journal est trop lent, ou une ligne était trop longue                                       |

Un lecteur de journal lent ne ralentit jamais un transfert. Lorsque la sortie est bloquée, le serveur écarte des lignes, les compte et écrit `diagnostics.dropped` avec le nombre une fois la sortie de nouveau libre. Une ligne de plus de 4096 caractères est remplacée par `diagnostics.oversized`. Les champs texte sont coupés à 256 caractères.

### ID de requête {#request-ids}

Chaque réponse porte l’en-tête `X-Request-Id`, et chaque corps d’erreur contient le champ `requestId`. La même valeur se trouve dans la ligne `http.access`, dans la ligne d’erreur, dans les lignes de la tâche de finalisation que la requête a lancée et dans les enregistrements d’audit. Un client qui signale un problème n’a besoin de vous donner que cette valeur.

```bash
journalctl -u arkvory-api -u arkvory-worker --since "1 hour ago" -o cat | grep 'REQUEST_ID'
```

```powershell
Select-String -Path "$root\logs\*.log" -Pattern 'REQUEST_ID'
```

Derrière un proxy inverse, le serveur ne reprend un `X-Request-Id` entrant que depuis une adresse figurant dans `ARKVORY_TRUSTED_PROXIES`, et uniquement s’il s’agit d’une valeur unique de 8 à 128 caractères (lettres, chiffres, `.`, `_`, `:` et `-`). Laissez le proxy réécrire l’en-tête, par exemple avec `proxy_set_header X-Request-Id $request_id;` dans nginx. Un en-tête `traceparent` W3C valide provenant d’un client quelconque devient le champ `traceId`. Il sert uniquement à la recherche et n’accorde jamais rien.

### Ce qui n’est jamais journalisé {#never-logged}

Le journal ne contient aucun mot de passe, clé, jeton, en-tête `Authorization`, corps de requête, chaîne de requête, URL ou texte d’exception. Les liens de téléchargement portent un secret dans la chaîne de requête, donc seul le modèle de route est journalisé. Le champ `reason` est le seul texte libre. Il est expurgé et coupé à 240 caractères. La ligne montre le `principal` (l’ID d’un compte ou d’une clé) et le `clientIp`. Traitez le journal comme des données personnelles.

`ARKVORY_ACCESS_LOG=false` désactive `http.access`. Les requêtes réussies vers `/health/live` et `/health/status` ne sont jamais journalisées. Les niveaux `warning` et `error` masquent aussi les lignes d’accès.

## Diagnostics dans la console {#console}

Les administrateurs voient l’état du serveur dans la console sans passer par un shell. Voir [La console web](../guide/console).

| Où                                         | Ce que vous voyez                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:backups]]                             | La ligne principale indique [[ui:backupStateOk]], [[ui:backupStateWarning]] et [[ui:backupStateCritical]]. En dessous se trouvent la sauvegarde [[ui:backupNewest]], le [[ui:backupNextRun]], le [[ui:backupAgent]], le [[ui:backupVault]] et la liste des avertissements avec l’action pour chacun |
| [[ui:updates]]                             | La version installée et la dernière version, l’heure du dernier contrôle et l’état du programme de mise à jour de l’hôte                                                                                                                                                                            |
| [[ui:repositoryStorage]] d’un dépôt        | L’utilisation du quota avec les états [[ui:storageWarning]] et [[ui:storageCritical]], et la liste [[ui:storageEvents]]                                                                                                                                                                             |
| [[ui:serviceAudit]] d’un compte de service | Qui a créé, modifié, émis ou révoqué quoi                                                                                                                                                                                                                                                           |
| La fiche du dépôt                          | Le badge [[ui:mirrorBadge]], avec l’état [[ui:mirrorFailing]] lorsque la dernière synchronisation a échoué                                                                                                                                                                                          |

La liste [[ui:storageEvents]] nécessite l’autorisation de lire les diagnostics. Entre autres événements, elle contient les requêtes échouées des clés de service dans ce dépôt, avec l’ID de requête, la route et le statut.

Les seuils de quota sont de 80 % pour l’avertissement et de 95 % pour l’état critique, sauf si un administrateur les a modifiés. Un dépôt sans quota n’a aucun seuil.

## Avertissements de stockage et de disque {#storage}

Le serveur conserve `ARKVORY_STORAGE_RESERVE_BYTES` (1 GiB par défaut) d’espace libre sur le volume de stockage pour la base de données, les journaux et le système. En dessous de cette réserve :

- `/health/ready` signale `"writable": false`, mais répond quand même 200.
- Les téléversements échouent avec 507 et la raison `storage_full`. Les téléchargements et la console continuent de fonctionner.

Le serveur ne mesure pas l’espace libre à votre place. Surveillez le volume de stockage, le volume de la base de données et le volume de sauvegarde avec vos propres outils, et alertez avant que la réserve ne soit atteinte. La réserve n’est pas un quota. `ARKVORY_CAPACITY_BYTES` limite la somme du contenu réservé et n’est pas un contrôle de disque. Voir [Stockage](./storage).

## État des sauvegardes {#backup-health}

L’agent de sauvegarde envoie un battement de cœur à chaque renouvellement de bail. L’API transforme le battement de cœur et l’historique des tâches de sauvegarde en avertissements dotés de codes fixes. Voir [Sauvegardes](./backups) pour ce que chaque code vous demande de faire.

| Code                                                                            | Gravité  | Condition                                                                                         |
| ------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `agent_offline`                                                                 | critical | Aucun battement de cœur pendant 2 minutes                                                         |
| `backup_stale`                                                                  | critical | Le point le plus récent date de plus de 26 heures et le plan est actif                            |
| `vault_unavailable`                                                             | critical | Le volume du coffre n’est pas monté, n’a pas de `vault.json` ou ne peut pas être écrit            |
| `verify_failed`                                                                 | critical | Un point de restauration a échoué à sa vérification                                               |
| `vault_not_configured`, `schedule_disabled`, `no_backup_yet`, `last_run_failed` | warning  | Pas de coffre, plan désactivé, aucune première sauvegarde, dernière sauvegarde échouée            |
| `vault_low_space`                                                               | warning  | Le coffre a moins de 10 % d’espace libre, ou moins du double des nouveaux octets du dernier point |
| `never_deep_verified`                                                           | warning  | Aucune vérification complète depuis plus de 8 jours                                               |

La métrique `arkvory_backup_warnings` porte les mêmes codes. L’âge d’une sauvegarde se compte à partir de son heure d’instantané, et non du moment où elle s’est terminée.

## Alertes suggérées {#alerts}

La version contient des règles Prometheus prêtes dans `releases/<version>/deploy/monitoring/arkvory-alerts.yml`. Ajoutez le fichier à `rule_files` dans `prometheus.yml`. Les seuils sont des points de départ. Ajustez-les selon le trafic que vous mesurez.

| Alerte                                                          | Condition                                                                | Gravité                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------- |
| `ArkvoryDown`                                                   | Le scrape échoue pendant 2 minutes                                       | Critique                |
| `ArkvoryHighServerErrorRate`                                    | Plus de 5 % des réponses sont des 5xx pendant 10 minutes                 | Avertissement           |
| `ArkvorySlowMetadataRequests`                                   | Le 99e centile des requêtes de gestion dépasse 2 s pendant 15 minutes    | Avertissement           |
| `ArkvoryCompletionBacklog`                                      | La plus ancienne tâche de finalisation en file attend plus de 10 minutes | Avertissement           |
| `ArkvoryTransferAdmissionRejections`                            | Plus de 0,1 transfert refusé ou expiré par seconde pendant 15 minutes    | Avertissement           |
| `ArkvoryDiagnosticsDropped`                                     | Des lignes de journal ont été écartées dans les 15 dernières minutes     | Avertissement           |
| `ArkvoryMetricsCollectionFailing`                               | Une métrique adossée à la base de données n’a pas pu être lue            | Avertissement           |
| `ArkvoryTlsCertificateExpiring`, `ArkvoryTlsCertificateExpired` | Le certificat intégré expire dans moins de 14 jours, ou a expiré         | Avertissement, critique |
| `ArkvoryBackupStale`                                            | Le point le plus récent date de plus de 26 heures                        | Critique                |
| `ArkvoryBackupAgentOffline`                                     | Aucun battement de cœur pendant plus de 2 minutes, pendant 5 minutes     | Critique                |
| `ArkvoryBackupWarning`                                          | `vault_unavailable` ou `verify_failed` pendant 10 minutes                | Critique                |
| `ArkvoryMirrorStale`                                            | Un miroir n’a pas rattrapé sa source pendant une heure                   | Avertissement           |
| `ArkvoryMirrorFailing`                                          | La dernière synchronisation d’un miroir a échoué, pendant 15 minutes     | Avertissement           |
| `ArkvoryRestartLoop`                                            | Le processus de l'API a redémarré 3 fois ou plus en 30 minutes           | Avertissement           |
| `ArkvoryWebhookFailing`                                         | Une livraison de webhook échoue depuis 15 minutes                        | Avertissement           |

Ajoutez vous-même ces alertes, car Arkvory n’exporte pas les données :

| Alerte                                                                    | Source                                | Pourquoi                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| Espace libre des volumes de stockage, de base de données et de sauvegarde | `node_exporter`                       | Un disque plein arrête les téléversements, la base de données et les sauvegardes |
| PostgreSQL est arrêté ou a trop de connexions                             | `postgres_exporter`                   | L’API se termine et redémarre tant que la base de données est absente            |
| L’état public n’est pas `ready`                                           | Une sonde externe de `/health/status` | Le chemin réseau, le proxy et le certificat, vus depuis un client                |

Pour les volumes et pour PostgreSQL, la version contient des règles prêtes pour `node_exporter` et `postgres_exporter` dans `deploy/monitoring/arkvory-host-alerts.yml`. Remplacez les expressions `mountpoint` par vos propres volumes avant de charger le fichier.

Testez une alerte une fois. Par exemple, arrêtez `arkvory-backup` : `ArkvoryBackupAgentOffline` se déclenche environ 7 à 8 minutes plus tard (2 minutes sans battement de cœur, 5 minutes dans la règle, plus l’intervalle de scrape).

## Pages associées {#related-pages}

- [Autoréparation](./self-healing)
- [Dépannage](./troubleshooting)
- [Sauvegardes](./backups)
- [Variables d’environnement](../reference/environment)
- [Erreurs](../api/errors)
