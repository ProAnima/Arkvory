---
title: Dépannage
description: 'Symptômes, causes et corrections des pannes qui surviennent sur un serveur Arkvory, et comment retrouver les journaux et l’ID de requête.'
---

# Dépannage

Trouvez votre symptôme, lisez la cause et appliquez la correction. Chaque section nomme l’événement de journal ou l’erreur que vous devriez voir. Pour la signification d’un code d’erreur, voir [Erreurs](../api/errors).

## Premières étapes {#first-steps}

1. Interrogez le point de terminaison de statut : `curl -fsS http://127.0.0.1:8080/health/status`. `{"status":"ready"}` signifie que l’API atteint sa base de données et son stockage.
2. Lisez les dernières lignes de journal du service en échec. Voir [Journaux et commentaires](#logs-and-feedback).
3. Cherchez l’événement `startup.failed` ou `worker.unavailable`. Son champ `reason` nomme la cause.
4. Si un client signale une erreur, demandez l’ID de requête et recherchez-le dans le journal.

## Le serveur ne démarre pas {#server-does-not-start}

Le gestionnaire de services redémarre un service en échec toutes les 10 secondes. Le journal répète alors `startup.failed`. Lisez le champ `reason`, ainsi que les champs `errno` et `sqlstate`.

### Le port est occupé {#port-busy}

**Cause.** `startup.failed` a `errno` `EADDRINUSE`. Un autre programme écoute sur le port 8080 (`ARKVORY_PORT`), ou un ancien processus Arkvory tourne encore.

**Correction.** Trouvez le propriétaire du port et arrêtez-le, ou changez le port.

```bash
sudo ss -ltnp 'sport = :8080'
```

```powershell
Get-NetTCPConnection -LocalPort 8080 | Select-Object LocalAddress, OwningProcess
```

Pour changer le port, modifiez `ARKVORY_PORT` dans `config/runtime.json` et redémarrez les services. L’adresse de la console change avec lui.

### La base de données est injoignable ou refuse la connexion {#database-problems}

**Cause.** Le journal affiche l’une de ces raisons :

| `reason`                                                             | Signification                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `dependency unavailable`, avec `errno` `ECONNREFUSED` ou `ETIMEDOUT` | PostgreSQL est arrêté, écoute ailleurs, ou un pare-feu le bloque           |
| `database authentication failed`                                     | L’utilisateur ou le mot de passe dans `ARKVORY_DATABASE_URL` est incorrect |
| `database does not exist`                                            | La base de données nommée dans l’URL est absente                           |
| `database role lacks a required privilege`                           | Le rôle ne peut pas créer ni modifier les tables                           |

**Correction.** Démarrez PostgreSQL, ou corrigez `ARKVORY_DATABASE_URL` dans `config/runtime.json` et redémarrez les services. La base de données gérée écoute sur `127.0.0.1:54329` (service `Arkvorydatabase` sous Windows, `arkvory-database` sous Linux). Les services remontent d’eux-mêmes lorsque la base de données répond. Ne supprimez pas le dossier `database/`.

### La base de données et le programme sont en désaccord {#migrations}

**Cause.** La raison commence par `unavailable:` et indique `Database migrations 1 through N are required; run migrate`, ou `Database schema is newer than this release`, ou `database schema is missing; run migrations`. Cela se produit après une mise à jour qui s’est arrêtée à mi-chemin, ou après qu’une ancienne version a été démarrée sur une base de données plus récente.

**Correction.** Ne démarrez pas une ancienne version sur une base de données plus récente. Vérifiez l’état avec `arkvory status --root <root>` et terminez ou annulez la mise à jour avec `recover`. Voir [Une mise à jour a échoué](#update-failed). Pour préserver les données, restaurez depuis une sauvegarde uniquement lorsque `recover` ne parvient pas à terminer.

### Un autre processus possède le stockage {#storage-identity}

**Cause.** La raison est `busy: Another writer or maintenance process owns this database`, ou `conflict: Database belongs to a different storage directory`. Une seconde API s’exécute contre la même base de données, ou le répertoire de données n’est pas celui avec lequel cette base de données a été utilisée. Chaque répertoire de stockage possède un fichier `storage-id`, et la base de données l’enregistre.

**Correction.** Arrêtez l’autre processus. Utilisez le répertoire de données qui appartient à cette base de données. Ne copiez jamais `storage-id` dans un autre répertoire, et ne connectez jamais deux installations à la même base de données.

### Permissions sur la racine ou le répertoire de données {#root-permissions}

**Cause.** `errno` est `EACCES` ou `EPERM`, ou la raison est `Cannot read ARKVORY_KEYS_FILE (EACCES)`. Le compte de service ne peut pas lire la configuration ni écrire dans le répertoire de données. Les causes typiques sont une installation dans un profil utilisateur, un dossier copié à la main ou un propriétaire modifié.

**Correction.**

- Linux : la racine et `config/` appartiennent à `root:arkvory` avec les modes 0750. `config/runtime.json` et `config/keys.json` ont le mode 0640. `data/` et `logs/` appartiennent à `arkvory:arkvory`.
- Windows : le compte `NT AUTHORITY\LocalService` doit lire chaque dossier parent de la racine, et modifier `data\`, `logs\` et la boîte de réception des mises à jour. Relancez le programme d’installation graphique pour restaurer les règles d’accès.
- Installez dans un dossier dédié, en dehors des répertoires personnels et des profils utilisateur.

### Un paramètre ou un certificat est refusé {#invalid-configuration}

**Cause.** La raison nomme une variable, par exemple `Invalid ARKVORY_PORT`, ou un problème de certificat : `TLS certificate has expired`, `TLS certificate and key do not match`, `TLS key is not an unencrypted PEM private key`. Le serveur ne démarre jamais en HTTP simple lorsque le certificat est incorrect.

**Correction.** Corrigez la variable nommée dans `config/runtime.json`. Une valeur hors de sa plage empêche le démarrage. Renouvelez ou remplacez les fichiers de certificat. Utilisez `arkvory configure --tls-off` pour revenir à HTTP simple pendant que vous corrigez les fichiers. Voir [Variables d’environnement](../reference/environment).

## La console ne peut pas joindre l’API {#console-unreachable}

| Message dans la console     | Cause                                                                                                                                                                                                         | Correction                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:errorNetwork]]         | Le navigateur n’obtient aucune réponse : le service est arrêté, l’adresse ou le port est incorrect, un pare-feu le bloque, le serveur n’écoute que sur `127.0.0.1`, ou le certificat ne correspond pas au nom | Testez `/health/status` depuis le même ordinateur que le navigateur. Vérifiez le service, l’adresse d’écoute et le pare-feu     |
| [[ui:errorGateway]]         | Un proxy inverse répond, mais pas l’API derrière lui                                                                                                                                                          | Vérifiez que l’API tourne et que le proxy pointe vers son port. Augmentez le délai de lecture du proxy pour les gros transferts |
| [[ui:errorTimeout]]         | Le serveur n’a pas répondu à temps                                                                                                                                                                            | Cherchez `upload.deadline` ou une base de données occupée dans le journal                                                       |
| [[ui:errorUnavailable]]     | Une dépendance telle que la base de données est absente un instant                                                                                                                                            | Attendez et réessayez. Voir [Occupé et indisponible](#retry-after)                                                              |
| [[ui:errorOriginForbidden]] | Une console externe s’exécute sur une adresse que `ARKVORY_CORS_ORIGINS` ne liste pas                                                                                                                         | Ajoutez l’origine exacte (schéma, hôte et port) et redémarrez l’API                                                             |
| [[ui:sessionEnded]]         | Vous vous êtes déconnecté ailleurs, le mot de passe a changé, ou l’accès a été révoqué                                                                                                                        | Reconnectez-vous                                                                                                                |

Pendant une mise à jour, la console se reconnecte d’elle-même. N’envoyez pas à nouveau la demande d’installation. Si Docker Desktop est utilisé, le serveur est absent tant que Docker Desktop ne tourne pas. Voir [Docker](#docker).

## Problèmes de connexion {#sign-in}

### Nom ou mot de passe incorrect {#wrong-password}

**Cause.** Le message est [[ui:signInFailed]] (401 `invalid_credentials`). Le serveur donne la même réponse pour un nom incorrect, un mot de passe incorrect et un compte désactivé, afin que personne ne puisse découvrir quels noms existent.

**Correction.** Un administrateur peut vérifier le compte dans [[ui:administration]] et utiliser [[ui:enableUser]] s’il est désactivé, ou [[ui:resetPassword]] pour définir un nouveau mot de passe.

### Trop de tentatives {#too-many-attempts}

**Cause.** La réponse est 429 `rate_limited` avec `login_attempts` et `Retry-After`. L’adresse a utilisé ses 10 tentatives, ou le compte est en attente après de nombreux mots de passe incorrects (jusqu’à 2 minutes). Même le mot de passe correct attend pendant ce temps.

**Correction.** Attendez le nombre de secondes indiqué dans `Retry-After`. Un administrateur peut lever l’attente d’un compte en réinitialisant le mot de passe. Un redémarrage de l’API efface les compteurs des adresses mais pas l’attente d’un compte.

### Tout le monde est bloqué derrière un proxy {#blocked-behind-proxy}

**Cause.** Le serveur voit l’adresse du proxy comme l’adresse de chaque client, de sorte que tous les clients partagent un même budget.

**Correction.** Définissez `ARKVORY_TRUSTED_PROXIES` sur les adresses du proxy et redémarrez l’API. Le proxy doit envoyer `X-Forwarded-For`. Voir [Sécurité](./security#sign-in-limits).

### Le propriétaire est perdu {#owner-lost}

**Cause.** Personne ne se souvient d’un mot de passe administrateur.

**Correction.** Utilisez la clé de récupération sur le serveur :

1. Lisez la clé dans `config/bootstrap-token.txt` en tant que root ou Administrateur.
2. Dans la console, ouvrez [[ui:keySignIn]], collez la clé et sélectionnez [[ui:connect]].
3. Ouvrez [[ui:administration]]. Utilisez [[ui:resetPassword]] pour le compte, ou [[ui:createUser]] pour créer un nouvel administrateur.
4. Sélectionnez [[ui:disconnect]] et connectez-vous avec le compte.

Le formulaire [[ui:welcomeOwner]] ne fonctionne que tant que le serveur n’a aucun compte.

### La clé de récupération est perdue {#recovery-key-lost}

**Cause.** Le fichier `config/bootstrap-token.txt` a été supprimé ou n’a jamais été enregistré. Le serveur ne détient que le hachage de la clé.

**Correction.** Avec les droits root ou Administrateur sur le serveur, écrivez une nouvelle clé et son hachage. Voir [Configuration](../install/configuration). Ne supprimez plus le fichier : les outils d’installation le lisent.

## Téléversements {#uploads}

### Un téléversement ne se termine pas {#upload-stuck}

**Cause.** Il existe plusieurs causes possibles :

- Le client a perdu la connexion. Un téléversement multipartie conserve ses parties enregistrées pendant 7 jours.
- Un gros téléversement attend le worker. Le worker est arrêté, ou il échoue. Un second worker attend en veille.
- Trop de téléversements s’exécutent en même temps. Par défaut, 2 s’exécutent, 1 par compte, et les autres attendent 20 secondes, puis reçoivent 503 `busy`.
- Un proxy inverse refuse un gros corps de requête (413) ou interrompt une requête lente (502 ou 504).

**Correction.**

1. Demandez l’état du téléversement : `arkvoryctl uploads status <id>`. Reprenez avec le même fichier et le même fichier d’état. Voir [Ligne de commande](../protocols/cli#resume-interrupted-transfers).
2. Vérifiez le worker : `systemctl status arkvory-worker`, `Get-Service Arkvoryworker`. Cherchez `completion.failed` et `completion.attempts_exhausted` avec l’`uploadId`. La métrique `arkvory_completion_oldest_queued_seconds` indique une tâche en attente.
3. Augmentez les limites du proxy pour la taille du corps et le délai de lecture. Une requête de téléversement s’arrête après 30 secondes sans données et après 30 minutes au total.
4. Une session de plus de 7 jours est perdue (409 `upload_expired`). Démarrez un nouveau téléversement.

### integrity_mismatch {#integrity-mismatch}

**Cause.** La réponse est 422 `integrity_mismatch`, ou le client se termine avec le code 5. Les octets ne correspondent pas à la taille déclarée ni au SHA-256. Le fichier a changé pendant son envoi, le hachage déclaré a été calculé pour un autre fichier, ou un proxy ou un équipement réseau a modifié le corps.

**Correction.** Renvoyez le fichier depuis une copie inchangée. La session reste ouverte, de sorte qu’un fichier corrigé peut y être envoyé. Si un téléchargement échoue à sa vérification encore et encore, téléchargez-le une nouvelle fois par un autre chemin, puis signalez l’ID de requête. Voir [Journaux et commentaires](#logs-and-feedback).

## Occupé, limité, indisponible {#retry-after}

Les codes `busy`, `unavailable` et `rate_limited` sont temporaires. La réponse contient l’en-tête `Retry-After` et le champ `retryAfterSeconds`. Attendez ce délai. Le SDK et le client en ligne de commande répètent ces réponses un nombre limité de fois.

| Réponse                            | Cause                                                                                                                                                                    | Que faire                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 503 `busy`, raison `request_limit` | Le serveur traite `ARKVORY_MAX_REQUESTS` requêtes à la fois (128 par défaut)                                                                                             | Attendez. N’augmentez la limite qu’avec assez de mémoire. Vérifiez `arkvory_http_requests_in_flight`                                                               |
| 503 `busy`                         | La file des transferts est pleine, un transfert a attendu plus de `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS` (20 s), ou le serveur termine ses requêtes en cours avant un arrêt | Attendez et répétez. Augmentez `ARKVORY_MAX_UPLOADS` ou `ARKVORY_MAX_DOWNLOADS` si cela est fréquent. `arkvory_transfer_admission_failures_total` compte les refus |
| 503 `unavailable`                  | La base de données redémarre, le processus a perdu la propriété du stockage, ou le hub est injoignable (`hub_unreachable`)                                               | Attendez. Les services redémarrent d’eux-mêmes. Voir [Autoréparation](./self-healing)                                                                              |
| 429 `rate_limited`                 | Trop de tentatives de connexion, d’inscription, de mot de passe ou de commentaires                                                                                       | Attendez. Voir [Trop de tentatives](#too-many-attempts)                                                                                                            |

Une erreur 500 `internal` n’a pas de `Retry-After`. Ne la répétez pas aveuglément. Recherchez son ID de requête dans le journal et signalez-le.

## Disque plein et quota {#disk-full}

| Réponse, raison     | Cause                                                                                                                                                            | Correction                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 507 `storage_full`  | L’espace libre du volume de stockage est inférieur à la réserve `ARKVORY_STORAGE_RESERVE_BYTES` (1 GiB par défaut), ou le disque de la base de données est plein | Libérez de l’espace sur le volume. Vérifiez `df -h` ou `Get-PSDrive`, et le volume de PostgreSQL                      |
| 507 `storage_quota` | Le quota du dépôt est épuisé                                                                                                                                     | Supprimez les anciens builds, modifiez la politique de rétention, ou augmentez le quota dans [[ui:repositoryStorage]] |
| 507 `catalog_limit` | La somme de tout le contenu réservé dépasserait `ARKVORY_CAPACITY_BYTES` (10 TiB par défaut)                                                                     | Supprimez du contenu, ou augmentez la valeur dans `config/runtime.json`                                               |
| 507 `queue_full`    | Un compte a 100 tâches de finalisation ouvertes, ou le serveur en a 10 000                                                                                       | Attendez que le worker les termine                                                                                    |

Pendant que le disque est plein, les téléchargements et la console continuent de fonctionner. `/health/ready` affiche `"writable": false`. Supprimer un artefact dans Arkvory ne libère pas le disque immédiatement : le fichier attend le nettoyage physique après son délai de grâce. Voir [Stockage](./storage). N’abaissez pas la réserve pour faire tenir plus de données, car la base de données et les journaux en ont besoin.

## Les sauvegardes échouent {#backups-failing}

Commencez par l’avertissement dans [[ui:backups]] ou `arkvoryctl backup status`, et les événements de journal `backup.request.failed` et `backup.agent.failed` avec leur `errorCode`. Voir [Sauvegardes](./backups).

| Avertissement ou message                                                            | Cause                                                                                                      | Correction                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent_offline`                                                                     | Le service de sauvegarde est arrêté, ou il ne parvient pas à démarrer                                      | Démarrez `arkvory-backup` ou `Arkvorybackup`. Lisez son journal                                                                                                    |
| `vault_unavailable`                                                                 | Le volume du coffre n’est pas monté, n’a pas de `vault.json`, ou le compte de service ne peut pas y écrire | Montez le volume avant le démarrage du service. Vérifiez le propriétaire et les autorisations. Sous Windows, redémarrez l’agent si le volume a été monté plus tard |
| `The vault directory does not exist; create it or mount its volume first`           | Le chemin est incorrect ou le volume est absent                                                            | Créez ou montez le répertoire                                                                                                                                      |
| `The vault directory is not writable`                                               | Le compte de service n’a pas d’accès en écriture                                                           | Sous Linux, montez un partage avec les `uid` et `gid` de l’utilisateur `arkvory`. Sous Windows, utilisez un volume local ou iSCSI                                  |
| `The directory has no vault.json: mount the vault volume, or pass --init-vault ...` | Un répertoire vide pourrait être un partage non monté, donc la commande le refuse                          | Montez le bon volume, ou passez `--init-vault` pour un nouveau coffre vide                                                                                         |
| `The vault must be outside the installation root and the storage directory`         | Le coffre chevauche les données                                                                            | Choisissez un répertoire distinct sur un autre volume                                                                                                              |
| `Network share paths are not supported ...`                                         | Un chemin UNC sous Windows. `LocalService` ne peut pas se connecter aux partages SMB                       | Utilisez une lettre de lecteur d’un volume local ou iSCSI                                                                                                          |
| `The backup service cannot reach /home, /root, /run/user, /tmp or /var/tmp`         | Le bac à sable systemd masque ces dossiers                                                                 | Choisissez un autre répertoire                                                                                                                                     |
| `vault_full`, `vault_low_space`                                                     | Le volume du coffre est presque plein                                                                      | Libérez de l’espace ou conservez moins de points. Les points antérieurs restent intacts                                                                            |
| `last_run_failed`                                                                   | La sauvegarde la plus récente a échoué                                                                     | Lisez l’`errorCode` avec `arkvoryctl backup jobs`                                                                                                                  |
| `verify_failed`                                                                     | Un point a échoué à sa vérification                                                                        | Ne modifiez pas le coffre. Conservez-le pour analyse et signalez-le                                                                                                |

`arkvory configure --backup-vault` restaure les anciens paramètres lorsque l’agent ne signale pas le nouveau coffre dans les 150 secondes. Une mise à jour arrête l’agent de sauvegarde, donc une sauvegarde qui s’exécute à ce moment est répétée plus tard. Lorsque les mises à jour automatiques sont activées, gardez l’heure de sauvegarde en dehors de l’heure de mise à jour (03:00 UTC par défaut).

## Un miroir ne se synchronise pas {#mirror-not-syncing}

Regardez le badge [[ui:mirrorFailing]] sur le dépôt, sur `GET /api/v1/repositories/{repository}/mirror` et sur les événements du worker `mirror.step_failed`. Les téléchargements continuent de fonctionner à partir de ce qui est copié. Voir [Miroirs](./mirrors).

| `errorCode`                                                                    | Cause                                                                                   | Correction                                                                                                                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_failed`, ou un code de la source tel que `unauthorized` ou `forbidden` | La source est injoignable, sa clé est incorrecte ou a expiré, ou il lui manque un droit | Testez la source avec la clé. Remplacez la clé avec `arkvory configure --mirror ... --mirror-token-file`. Le worker relit la clé après chaque échec |
| `mirror_mismatch`                                                              | Le même ID a un autre contenu à la source                                               | La copie est conservée. Examinez l’artefact                                                                                                         |
| `mirror_source_changed`                                                        | Le dépôt détient déjà une copie d’une autre source                                      | Détachez avec `--mirror-detach`, et mettez en miroir la nouvelle source dans un nouveau dépôt                                                       |
| `mirror_source_behind`                                                         | La source a été restaurée ou réinstallée                                                | Il réamorce de lui-même et le code disparaît                                                                                                        |
| Une erreur de certificat                                                       | La source utilise un certificat d’entreprise ou auto-signé                              | Passez `--mirror-ca-file` à `arkvory configure`. La vérification n’est jamais désactivée                                                            |

La source a besoin d’une version avec le flux de miroir. Le worker attend 2 secondes après un échec, en doublant jusqu’à 5 minutes. `ArkvoryMirrorStale` se déclenche après une heure sans rattrapage.

## Une mise à jour a échoué {#update-failed}

1. Lisez l’échec. Dans la console, [[ui:updates]] affiche un message. Le programme de mise à jour écrit `logs\updater.log` sous Windows, et `journalctl -u arkvory-update` sous Linux.
2. Vérifiez la version installée : `arkvory status --root <root>`.
3. Trouvez votre cas.

| Cas                                                                        | Ce qui s’est passé                                                                                                                        | Que faire                                                                                                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Même schéma de base de données, échec normal                               | Le programme d’installation a redémarré la version précédente                                                                             | Corrigez la cause et mettez à jour à nouveau                                                                                                     |
| La console affiche [[ui:updateMaintenance]]                                | Une version avec un changement de schéma nécessite une sauvegarde vérifiée, et le programme d’installation a refusé avant tout changement | Connectez un coffre, attendez la première sauvegarde, vérifiez à nouveau                                                                         |
| La migration a échoué                                                      | Sa transaction a été annulée, et la version précédente tourne sur le schéma précédent                                                     | Corrigez la cause et mettez à jour à nouveau                                                                                                     |
| La nouvelle version n’a pas démarré après une migration réussie            | Le journal indique `maintenance-required` et nomme un point de sauvegarde                                                                 | Corrigez la cause et exécutez `recover`, qui termine la mise à jour. Ou restaurez le point avec la version précédente                            |
| Le programme de mise à jour a été tué ou la machine a perdu l’alimentation | Le verrou `operation.lock` et le journal restent. Rien ne continue tout seul                                                              | La procédure ci-dessous                                                                                                                          |
| La console affiche [[ui:updateStale]] ou [[ui:updateUnavailable]]          | Le planificateur de l’hôte ne tourne pas ou n’est pas connecté                                                                            | Vérifiez la tâche `ProAnimaArkvoryUpdate` (Windows) ou `arkvory-update.timer` (Linux). Connectez-la avec `arkvory updates-connect --root <root>` |

Après un programme de mise à jour interrompu :

1. Arrêtez le planificateur et assurez-vous qu’aucun programme de mise à jour ne tourne. Enregistrez `journal.json` et les journaux.
2. Alors seulement, supprimez le fichier `operation.lock` dans la racine d’installation. Ne le supprimez jamais pendant qu’une mise à jour s’exécute.
3. Exécutez `recover` :

   ```bash
   sudo arkvory recover --root /opt/proanima-arkvory
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' recover --root C:\ProgramData\ProAnima\Arkvory
   ```

   Avant le début de la migration, il restaure la version précédente. Après le début de la migration, il répète la migration et démarre la nouvelle version.

4. Vérifiez `/health/ready`, la file de finalisation et un téléchargement de test. Puis réactivez le planificateur.

`arkvory updates-reset --root <root>` efface une demande de mise à jour acceptée après que vous avez réconcilié l’état. Un retour à une version antérieure n’est pas possible. Voir [Mises à jour](../install/updates).

## Docker {#docker}

- **Rien ne tourne après un redémarrage de Windows.** Docker Desktop démarre à la connexion de l’utilisateur. Activez **Start Docker Desktop when you sign in**, ou utilisez les services natifs.
- **Rien ne tourne après un redémarrage d’un hôte Linux.** Vérifiez que le moteur démarre au lancement : `systemctl is-enabled docker`.
- **Un conteneur ne peut pas lire un fichier dans `config/`.** Les conteneurs s’exécutent sous l’utilisateur `node` (uid 1000). Le programme d’installation rend `runtime.json`, `keys.json` et `health-token.txt` lisibles pour lui. Si une modification manuelle a changé le propriétaire ou le mode en 0600, l’API s’arrête avec `Cannot read ARKVORY_KEYS_FILE (EACCES)`. Restaurez le mode 0644 de ces trois fichiers. Le dossier `config/` lui-même reste fermé.
- **Le coffre n’est pas accessible en écriture.** L’agent s’exécute en uid 1000, donc le coffre doit lui appartenir. `arkvory configure --backup-vault` le met en place avec le fichier `config/compose.vault.yml`. Un partage que vous montez vous-même a besoin de `uid=1000`. Incluez `-f config/compose.vault.yml` dans chaque commande Compose manuelle, sinon `up` crée le conteneur de sauvegarde sans le coffre.
- **Un conteneur est `unhealthy`.** La vérification de santé appelle `/health/ready` toutes les 10 secondes. Docker marque le conteneur mais ne le redémarre pas. Lisez le journal du conteneur de l’API.

Affichez le journal d’un conteneur :

```bash
docker logs --tail 100 proanima-arkvory-api-1
```

## Un service Windows ne démarre pas {#windows-service}

1. Lisez l’état et la sortie d’erreur :

   ```powershell
   Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
   Get-Content C:\ProgramData\ProAnima\Arkvory\logs\arkvory-api.err.log -Tail 50
   ```

2. Ouvrez l’Observateur d’événements Windows, **Windows Logs > System**, et cherchez des événements du Service Control Manager.
3. Trouvez votre cause :

| Cause                                                                                                | Correction                                                                            |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| La racine se trouve dans un profil utilisateur, ou `LocalService` ne peut pas lire un dossier parent | Installez dans un dossier dédié. Voir [Autorisations](#root-permissions)              |
| Le port est occupé                                                                                   | Voir [Le port est occupé](#port-busy)                                                 |
| Le service de base de données ne tourne pas                                                          | Démarrez `Arkvorydatabase`. L’API réessaie toutes les 10 secondes                     |
| Les services ont démarré « en retard » après un lancement                                            | Leur type de démarrage est Automatique (démarrage différé). Attendez quelques minutes |
| Un logiciel antivirus a mis en quarantaine Node.js                                                   | Autorisez les fichiers dans `runtime\`                                                |
| `Another installation owns this service`                                                             | Des services d’une installation dans une autre racine existent. Supprimez-les d’abord |
| Un service reste arrêté                                                                              | Vous ou une mise à jour l’avez arrêté. Démarrez-le avec `Start-Service`               |

Relancez le programme d’installation graphique pour restaurer les types de démarrage et les actions de récupération des services. Voir [Windows](../install/windows).

## Journaux, ID de requête et commentaires {#logs-and-feedback}

**Trouvez les journaux.** Linux : `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. Windows : `logs\` dans la racine d’installation. Compose : `docker logs <container>`. Les formats et les événements sont dans [Supervision](./monitoring#logs).

**Trouvez l’ID de requête.** Chaque réponse contient l’en-tête `X-Request-Id`. Chaque corps d’erreur contient `requestId`. La console l’affiche sous la forme [[ui:requestIdLabel]] sous le message, et le client en ligne de commande l’affiche dans la ligne d’erreur. Recherchez cette valeur dans les journaux de l’API et du worker pour voir la requête et les tâches qu’elle a lancées.

**Envoyez des commentaires avec les journaux.**

1. Connectez-vous et sélectionnez [[ui:reportOpen]] dans la barre supérieure.
2. Décrivez le problème et ajoutez l’ID de requête. Vous pouvez ajouter jusqu’à 6 captures d’écran.
3. Si vous êtes administrateur, activez [[ui:reportServerLog]]. Cela joint les dernières lignes de journal de l’API (environ 1,5 MiB) et un résumé du système sans adresses ni secrets.
4. Sélectionnez [[ui:reportShow]] pour voir exactement ce qui sera envoyé, puis [[ui:reportSend]].

Le serveur envoie le rapport au hub ProAnimaStudio. Si le hub est injoignable ou si les commentaires sont désactivés, la console affiche l’adresse `info@proanima.net` à qui écrire. Voir [Sécurité](./security#hub) pour ce qui est envoyé.

## Pages associées {#related-pages}

- [Supervision](./monitoring)
- [Autoréparation](./self-healing)
- [Sécurité](./security)
- [Erreurs](../api/errors)
- [Windows](../install/windows)
