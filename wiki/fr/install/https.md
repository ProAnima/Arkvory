---
title: HTTPS et proxy inverse
description: 'Rendre Arkvory accessible en toute sécurité depuis d’autres ordinateurs, avec le TLS intégré ou un proxy inverse, et configurer la console et CORS pour une autre adresse.'
---

# HTTPS et proxy inverse

Une nouvelle installation écoute sur `127.0.0.1:8080` en HTTP simple. Seuls les programmes sur le serveur peuvent l’atteindre. Avant que des clients se connectent depuis d’autres ordinateurs, placez HTTPS devant. Les clés, les mots de passe et les liens de téléchargement circulent dans les requêtes : ne les envoyez jamais en HTTP simple entre ordinateurs.

## Choisir une méthode {#choose}

|                              | TLS intégré                                          | Proxy inverse                                                       |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Installations                | Services Windows et Linux (natif). Pas Compose       | Toutes, et la seule méthode pour Compose                            |
| Configuration                | Une commande `arkvory configure` avec retour arrière | Configuration du proxy, plus `ARKVORY_TRUSTED_PROXIES` dans Arkvory |
| Port                         | Le port de l’API, 8080 par défaut                    | N’importe lequel, par exemple 443                                   |
| Renouvellement du certificat | L’API relit elle-même les fichiers renouvelés        | Géré par le proxy                                                   |
| Certificats clients (mTLS)   | Non pris en charge                                   | Possibles dans le proxy                                             |

## Avant de commencer {#before-you-start}

- Obtenez un certificat pour le nom qu’utilisent les clients, auprès d’une autorité à laquelle les clients font confiance, par exemple avec certbot, win-acme ou votre autorité d’entreprise. Vous avez besoin du certificat avec sa chaîne et de la clé privée, tous deux au format PEM. La clé ne doit pas avoir de mot de passe.
- Créez un nom DNS qui pointe vers le serveur.
- N’ouvrez dans le pare-feu que le port HTTPS, et uniquement vers les réseaux de vos clients. N’ouvrez jamais le port de base de données 54329.

## TLS intégré {#built-in-tls}

### Préparer les fichiers {#tls-files}

Les fichiers doivent respecter ces règles. La commande les vérifie toutes avant de modifier quoi que ce soit.

- Les chemins sont absolus.
- Chaque fichier est un fichier PEM d’au plus 1 MiB. Le fichier de certificat contient le certificat, puis la chaîne.
- La clé est une clé privée PEM non chiffrée qui correspond au certificat.
- Le certificat n’a pas expiré.
- Le compte de service peut lire les deux fichiers : `arkvory` sous Linux, `LocalService` sous Windows.

Arkvory référence les fichiers et ne les copie pas. Placez-les là où ils restent lorsque vous les renouvelez. Sous Linux, pas sous `/home` : les unités ne le voient pas. Les répertoires de certains outils de certificats ne sont lisibles que par `root` ; copiez les fichiers renouvelés dans un répertoire que le groupe de service peut lire, par exemple avec un hook de renouvellement. Exemple pour Linux :

```bash
sudo install -d -m 0750 -o root -g arkvory /etc/arkvory/tls
sudo install -m 0644 -o root -g arkvory fullchain.pem /etc/arkvory/tls/fullchain.pem
sudo install -m 0640 -o root -g arkvory privkey.pem /etc/arkvory/tls/privkey.pem
```

Sous Windows, placez les fichiers dans un dossier que `LocalService` peut lire, et ne laissez que SYSTEM, les administrateurs et `LocalService` lire la clé.

### Activer le TLS intégré {#tls-enable}

1. Exécutez la commande avec les chemins et l’adresse d’écoute. `0.0.0.0` écoute sur toutes les interfaces IPv4, `::` sur toutes les interfaces, ou indiquez l’adresse d’une seule interface.

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory \
     --tls-cert /etc/arkvory/tls/fullchain.pem \
     --tls-key /etc/arkvory/tls/privkey.pem \
     --listen-host 0.0.0.0
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root C:\ProgramData\ProAnima\Arkvory `
     --tls-cert C:\ProgramData\ProAnima\Arkvory\tls\fullchain.pem `
     --tls-key C:\ProgramData\ProAnima\Arkvory\tls\privkey.pem `
     --listen-host 0.0.0.0
   ```

   La commande écrit `ARKVORY_TLS_CERT_FILE`, `ARKVORY_TLS_KEY_FILE` et `ARKVORY_HOST` dans `config/runtime.json`, redémarre les services et attend que l’API réponde à son contrôle de disponibilité en HTTPS. Le contrôle n’accepte que le certificat configuré. En cas de succès, la commande affiche le jour d’expiration du certificat. En cas d’échec, elle restaure le `runtime.json` précédent, redémarre les services avec celui-ci et indique la raison.

2. Ouvrez le port de l’API dans le pare-feu pour les réseaux de vos clients.
3. Testez depuis un ordinateur client. Le port reste 8080 sauf si vous modifiez `ARKVORY_PORT` :

   ```bash
   curl https://arkvory.example.com:8080/health/status
   ```

   La réponse a le statut 200 avec `{"status":"ready"}`. La console se trouve à `https://arkvory.example.com:8080/console/`.

Sous Linux, le compte de service ne peut normalement pas écouter sur un port inférieur à 1024. Pour servir HTTPS sur le port 443, utilisez un [proxy inverse](#reverse-proxy).

Si le certificat est invalide au démarrage, l’API s’arrête avec une erreur. Elle ne revient jamais à du HTTP simple.

### Réglages {#tls-settings}

`configure` définit les fichiers et l’adresse. Deux autres réglages sont ajoutés à `runtime.json` à la main. Redémarrez les services après les avoir modifiés : voir [Appliquer une modification](./configuration#apply-change).

| Variable                     | Valeur par défaut | Signification                                                                                                                 |
| ---------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TLS_MIN_VERSION`    | `TLSv1.2`         | `TLSv1.2` ou `TLSv1.3`                                                                                                        |
| `ARKVORY_TLS_RELOAD_SECONDS` | `300`             | Fréquence à laquelle l’API relit les fichiers de certificat : de 30 à 86400 secondes, ou `0` pour ne les lire qu’au démarrage |

Chaque réponse porte `Strict-Transport-Security: max-age=31536000`.

### Renouveler le certificat {#tls-renewal}

Écrivez le certificat et la clé renouvelés aux mêmes chemins. Aucune commande ni redémarrage n’est nécessaire.

- L’API compare les fichiers toutes les `ARKVORY_TLS_RELOAD_SECONDS`. Les nouvelles connexions utilisent le nouveau certificat. Les connexions ouvertes gardent l’ancien jusqu’à leur fin.
- Un renouvellement défectueux (fichiers illisibles, clé qui ne correspond pas, certificat expiré) ne remplace jamais le certificat qui fonctionne. L’API journalise `tls.reload_failed` et réessaie à l’intervalle suivant.
- Pendant les 14 derniers jours avant l’expiration, l’API journalise `tls.expiring` une fois par jour. La métrique `arkvory_tls_certificate_expiry_timestamp_seconds` convient pour une alerte. Voir [Supervision](../operate/monitoring).

### Désactiver le TLS intégré {#tls-off}

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-off --listen-host 127.0.0.1
```

`--tls-off` seul laisse l’adresse d’écoute telle quelle. Sans `--listen-host 127.0.0.1`, l’API servirait alors du HTTP simple sur chaque interface que vous avez ouverte.

## Proxy inverse {#reverse-proxy}

Le proxy accepte HTTPS des clients et transmet du HTTP simple à l’API. Gardez l’API sur `127.0.0.1:8080` et installez le proxy sur le même hôte. Une installation Compose ne publie toujours que `127.0.0.1:8080`, donc un proxy sur l’hôte lui convient directement.

1. Installez le proxy et obtenez un certificat pour lui.
2. Configurez le proxy comme décrit dans [Ce que le proxy doit faire](#proxy-requirements).
3. Ajoutez l’adresse du proxy à `ARKVORY_TRUSTED_PROXIES`. Voir [Proxies de confiance](#trusted-proxies).
4. Assurez-vous que le port de l’API n’est pas accessible depuis d’autres ordinateurs.
5. Testez : `curl https://arkvory.example.com/health/status` renvoie `{"status":"ready"}`.

### Ce que le proxy doit faire {#proxy-requirements}

| Exigence                                                                                                          | Raison                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Accepter des corps de requête de toute taille (`client_max_body_size 0` dans nginx)                               | Les fichiers font plusieurs dizaines de gigaoctets ou plus. Une partie peut atteindre 1 GiB                          |
| Ne pas mettre en tampon les corps de requête ou de réponse (`proxy_request_buffering off`, `proxy_buffering off`) | Les octets circulent en flux. La mise en tampon remplit le disque du proxy et retarde le transfert                   |
| Autoriser des requêtes d’au moins 1900 secondes (`proxy_read_timeout`, `proxy_send_timeout`)                      | Une requête de téléversement peut prendre jusqu’à 30 minutes (`ARKVORY_UPLOAD_DEADLINE_MS`, 1 800 000 ms par défaut) |
| Parler HTTP/1.1 à l’API et garder la connexion                                                                    | Nécessaire pour le streaming                                                                                         |
| Transmettre le nom public dans `Host`                                                                             | Le serveur construit les liens absolus à partir de lui, comme ceux des réponses Git LFS et npm                       |
| Envoyer `X-Forwarded-For` et `X-Forwarded-Proto: https`                                                           | L’adresse du client pour les journaux et la limite de connexion, et le schéma des liens absolus                      |
| Remplacer `X-Request-Id` par un ID qui lui est propre                                                             | L’API conserve l’ID d’un proxy de confiance. Un client ne doit pas le choisir                                        |
| Ne pas écrire la chaîne de requête dans son journal d’accès                                                       | Les liens de téléchargement portent un secret dans `?token=`                                                         |
| Définir `Strict-Transport-Security` lui-même, si vous le souhaitez                                                | L’API ne l’envoie que depuis l’écouteur intégré                                                                      |

### nginx {#nginx}

Placez ceci dans le contexte `http` d’un nginx existant. Remplacez le nom et les chemins des certificats. Le `log_format` écrit le chemin sans la chaîne de requête.

```nginx
log_format arkvory_path '$remote_addr [$time_local] "$request_method $uri $server_protocol" '
                        '$status $body_bytes_sent $request_time $request_id';
server {
    listen 443 ssl;
    server_name arkvory.example.com;
    ssl_certificate /etc/arkvory/tls/fullchain.pem;
    ssl_certificate_key /etc/arkvory/tls/privkey.pem;
    access_log /var/log/nginx/arkvory.access.log arkvory_path;
    client_max_body_size 0;
    client_body_timeout 60s;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Request-Id $request_id;
        proxy_set_header Connection "";
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 1900s;
        proxy_send_timeout 1900s;
    }
}
```

Avec cette configuration, listez le proxy dans `ARKVORY_TRUSTED_PROXIES`, par exemple `127.0.0.1`. La directive `proxy_set_header X-Request-Id $request_id` doit rester : elle remplace un ID qu’un client pourrait envoyer.

### Caddy {#caddy}

```caddyfile
arkvory.example.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Request-Id {http.request.uuid}
        flush_interval -1
    }
}
```

Caddy obtient le certificat par lui-même, transmet les corps de requête en flux, n’a par défaut ni limite de taille de corps ni délai d’attente vers l’amont, et définit `X-Forwarded-For`, `X-Forwarded-Proto` et `X-Forwarded-Host`. Caddy n’écrit pas de journal d’accès sauf si vous activez `log`. Si vous le faites, retirez la chaîne de requête de l’adresse journalisée.

### IIS et autres proxies {#iis}

La configuration de référence du projet est le fichier nginx ci-dessus. Voici les réglages équivalents pour IIS avec Application Request Routing et URL Rewrite. Le projet ne les teste pas. Vérifiez les noms par rapport à votre version d’IIS.

- Augmentez le délai d’attente du proxy de serveur à au moins 1900 secondes, et définissez le seuil de tampon de réponse à `0`.
- Augmentez `maxAllowedContentLength` dans le filtrage des requêtes jusqu’à son maximum, 4 294 967 295 octets. IIS ne peut pas accepter un corps de requête de 4 GiB ou plus, donc un téléversement unique avec `curl -T` d’un tel fichier échoue. `arkvoryctl` envoie les gros fichiers par parties.
- Envoyez l’hôte d’origine, `X-Forwarded-Proto: https` et l’adresse du client dans `X-Forwarded-For`. Définissez un nouvel `X-Request-Id` dans une règle URL Rewrite.
- Gardez la chaîne de requête hors du journal IIS.

### Proxies de confiance {#trusted-proxies}

`ARKVORY_TRUSTED_PROXIES` accepte jusqu’à 32 adresses ou plages CIDR, séparées par des virgules. Les noms d’hôtes et les jokers sont refusés. Seule une requête provenant de l’une de ces adresses peut définir :

- l’adresse du client, avec `X-Forwarded-For`. L’API prend l’adresse la plus proche qui n’est pas de confiance,
- l’ID de requête, avec `X-Request-Id`,
- l’hôte des liens absolus, avec `X-Forwarded-Host`.

Sans la liste, chaque client semble venir de l’adresse du proxy. La limite de connexion compte alors toutes les personnes comme un seul client, et le journal d’accès affiche l’adresse du proxy dans `clientIp`. Ne listez que les proxies que vous contrôlez.

Sur un hôte Compose, l’API peut voir le proxy sous l’adresse de la passerelle du réseau Compose et non sous `127.0.0.1`. Envoyez une requête à travers le proxy, trouvez `clientIp` dans l’enregistrement `http.access` du journal de l’API, puis listez cette adresse.

Modifiez `config/runtime.json` et redémarrez les services. Voir [Appliquer une modification](./configuration#apply-change).

```json
{ "ARKVORY_TRUSTED_PROXIES": "127.0.0.1,::1" }
```

Lorsque l’API écoute sur une adresse qui n’est pas l’interface de bouclage sans TLS et sans proxy de confiance, elle journalise `http.plaintext_exposed` au démarrage. Une configuration de proxy correcte ne la déclenche pas.

## La console et son adresse d’API {#console-api-address}

La console servie par Arkvory utilise l’adresse depuis laquelle elle a été ouverte. Elle ne communique qu’avec son propre serveur : sa politique de sécurité du contenu n’autorise aucune autre adresse. Derrière un proxy, elle fonctionne sans modification à `https://arkvory.example.com/console/`.

Pour héberger la console sur un autre serveur web, par exemple à côté d’un portail :

1. Copiez les fichiers de la console depuis `releases/<version>/apps/web/public/` de la racine d’installation vers l’autre serveur. Servez-les au chemin `/console/`, en HTTPS, avec les types MIME corrects pour `.js` et `.css`. Copiez-les de nouveau après chaque mise à jour d’Arkvory.
2. Dans le fichier `index.html` copié, définissez l’adresse d’Arkvory :

   ```html
   <meta name="arkvory-api-base-url" content="https://arkvory.example.com/" />
   ```

3. Si l’autre serveur définit une politique de sécurité du contenu, autorisez `connect-src` vers l’adresse d’Arkvory et autorisez le worker de script local.
4. Autorisez l’origine de la console dans Arkvory. Voir [CORS](#cors).

### CORS {#cors}

Définissez les origines des applications web situées sur d’autres adresses dans `ARKVORY_CORS_ORIGINS` et redémarrez l’API.

```json
{ "ARKVORY_CORS_ORIGINS": "https://portal.example.com,https://tools.example.com" }
```

- La liste contient jusqu’à 16 origines, chacune avec un schéma, un hôte et un port facultatif, sans chemin. HTTPS est requis. Le HTTP simple n’est accepté que pour `localhost`, `127.0.0.1` et `[::1]`.
- CORS s’applique à `/api/v1/*` et `/health/ready`. Une requête provenant d’une origine non listée reçoit le statut 403 avec la raison `origin_not_allowed`. Une requête provenant de l’adresse du serveur lui-même n’a besoin d’aucune entrée.
- Une origine présente dans la liste n’obtient aucun droit. Chaque requête nécessite toujours une clé ou une session et passe les contrôles d’accès du serveur. L’application web envoie la clé dans l’en-tête `Authorization`, pas dans un cookie.
- Les méthodes autorisées sont GET, HEAD, POST, PUT, PATCH et DELETE. Les navigateurs peuvent mettre en cache la réponse à une requête préliminaire pendant 10 minutes.

Testez une requête préliminaire. La réponse doit avoir le statut 204 avec votre origine dans `Access-Control-Allow-Origin` :

```bash
curl -i -X OPTIONS https://arkvory.example.com/api/v1/auth/me \
  -H 'Origin: https://portal.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

## Vérifier la configuration {#check}

1. `curl https://arkvory.example.com/health/status` renvoie le statut 200 et `{"status":"ready"}`. La chaîne de certificats se vérifie sans exception.
2. Ouvrez la console, connectez-vous et téléversez un gros fichier via la même adresse.
3. Exécutez `arkvoryctl doctor` avec un profil qui utilise l’adresse HTTPS. Ne désactivez pas la vérification des certificats sur les clients : le client en ligne de commande ne le peut pas, et il n’accepte le HTTP simple que pour l’ordinateur local. Voir [Client en ligne de commande](../protocols/cli).
4. Après un redémarrage de l’API, le journal ne contient aucun enregistrement `http.plaintext_exposed`.

## Dépannage {#troubleshooting}

| Problème                                                                     | Cause et correction                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPS was not enabled; the previous configuration is restored`              | La raison suit dans le message : les fichiers ne sont pas au format PEM, la clé a un mot de passe, la clé ne correspond pas, le certificat a expiré, ou le compte de service ne peut pas lire un fichier. Corrigez-le et relancez la commande |
| `TLS files must be given as absolute paths`                                  | Indiquez des chemins complets                                                                                                                                                                                                                 |
| `Built-in TLS is for native installations; use a reverse proxy with Compose` | Compose n’a pas de TLS intégré. Utilisez un [proxy inverse](#reverse-proxy)                                                                                                                                                                   |
| Statut 413 renvoyé par le proxy                                              | La limite de corps est trop basse. Utilisez `client_max_body_size 0` dans nginx                                                                                                                                                               |
| Statut 502 ou 504, ou téléversement interrompu après quelques minutes        | Le proxy met le corps en tampon, ou ses délais d’attente sont inférieurs à 1900 secondes                                                                                                                                                      |
| Tout le monde est limité à la connexion, ou `clientIp` est toujours le proxy | Le proxy n’est pas dans `ARKVORY_TRUSTED_PROXIES`                                                                                                                                                                                             |
| Les liens des réponses Git LFS ou npm affichent `http` ou un nom interne     | Le proxy ne transmet pas `Host` ou `X-Forwarded-Proto: https`                                                                                                                                                                                 |
| Une application de navigateur reçoit 403 `origin_not_allowed`                | Ajoutez son origine à `ARKVORY_CORS_ORIGINS` et redémarrez                                                                                                                                                                                    |

D’autres indications se trouvent dans [Dépannage](../operate/troubleshooting) et [Sécurité](../operate/security).
