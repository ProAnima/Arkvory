---
title: Sécurité
description: 'Comment renforcer la sécurité d’un serveur Arkvory, où vivent ses secrets, quelles limites protègent la connexion, ce qui est journalisé et audité, et ce qui est envoyé au hub ProAnimaStudio.'
---

# Sécurité

Cette page s’adresse à l’administrateur qui exploite un serveur. Elle commence par les étapes pour renforcer une nouvelle installation, puis décrit chaque protection en détail.

Le projet indique qu’un modèle de menace et une revue de sécurité externe restent à faire. Ne publiez pas le serveur sur l’Internet ouvert. Ne laissez que les réseaux de vos clients y accéder.

## Renforcer un nouveau serveur {#checklist}

1. Gardez l’adresse d’écoute par défaut `127.0.0.1` jusqu’à ce que HTTPS fonctionne. Voir [Réseau et HTTPS](#network).
2. Activez HTTPS et n’ouvrez que le port HTTPS aux réseaux clients. N’ouvrez jamais le port de la base de données.
3. Créez des comptes personnels pour les administrateurs. Conservez la clé de récupération pour les urgences. Voir [Clé de récupération](../install/index#recovery-key).
4. Donnez à chaque outil ou système de CI son propre compte de service avec une clé dotée du minimum de droits. Voir [Clés et jetons](#keys).
5. Laissez l’auto-enregistrement désactivé. Il est désactivé par défaut.
6. Si un proxy inverse se trouve devant Arkvory, définissez `ARKVORY_TRUSTED_PROXIES`. Voir [Limites de connexion](#sign-in-limits).
7. Placez le coffre de sauvegarde sur un volume chiffré que seuls le compte de service et l’administrateur des sauvegardes peuvent lire. Voir [Sauvegardes](./backups).
8. Conservez des copies des fichiers de secrets en dehors du serveur. Voir [Sauvegarder vos secrets](#secret-backups).
9. Connectez les métriques et les alertes. Voir [Supervision](./monitoring).

## Réseau et HTTPS {#network}

Le serveur écoute sur `127.0.0.1:8080` par défaut. Une installation native peut écouter sur une autre adresse après que vous avez configuré HTTPS :

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-cert /etc/arkvory/fullchain.pem --tls-key /etc/arkvory/privkey.pem --listen-host 0.0.0.0
```

La commande vérifie les fichiers, redémarre les services et restaure les anciens paramètres lorsque les services ne démarrent pas. Voir [HTTPS et proxy inverse](../install/https) pour la procédure complète et pour Docker Compose, qui nécessite un proxy inverse.

- Le certificat et la clé doivent être lisibles, correspondre et ne pas être expirés. Sinon, l’API ne démarre pas et ne revient jamais à HTTP en clair.
- La version TLS minimale est 1.2. Définissez `ARKVORY_TLS_MIN_VERSION=TLSv1.3` pour exiger la 1.3. Les certificats clients ne sont pas pris en charge.
- Le serveur répond avec `Strict-Transport-Security: max-age=31536000` lorsqu’il sert lui-même HTTPS. Un proxy détient cet en-tête lorsqu’il termine TLS.
- Les fichiers de certificat renouvelés sont relus toutes les 300 secondes (`ARKVORY_TLS_RELOAD_SECONDS`) sans redémarrage. Les nouvelles connexions reçoivent le nouveau certificat. Un fichier illisible laisse le certificat en service en place et écrit `tls.reload_failed`. `tls.expiring` est écrit chaque jour pendant les 14 derniers jours.
- Une adresse non locale sans TLS et sans proxy de confiance écrit l’avertissement `http.plaintext_exposed` au démarrage. Corrigez-le avant de laisser entrer les clients.
- Arkvory ne désactive jamais la vérification d’un certificat qu’il reçoit : ni pour les miroirs, ni pour le hub, ni dans le client en ligne de commande. Ajoutez votre propre autorité de certification avec `--mirror-ca-file` pour les miroirs.

Derrière un proxy inverse, l’API reste sur la boucle locale. Le proxy doit diffuser les corps en flux sans mettre en mémoire des fichiers entiers. Ne journalisez pas la chaîne de requête au niveau du proxy, car un lien de téléchargement y porte son secret.

## Secrets sur le serveur {#secrets}

Les programmes d’installation créent ces fichiers dans la racine d’installation. Conservez les autorisations que le programme d’installation a définies.

| Fichier                      | Contenu                                                                                     | Accès                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `config/bootstrap-token.txt` | La clé de récupération. Elle possède les droits d’administrateur                            | Linux : root uniquement (mode 0600). Windows : SYSTEM et Administrateurs           |
| `config/keys.json`           | Les hachages SHA-256 de la clé de récupération et de la clé d’état, jamais les clés         | Linux : root écrit, le groupe de service lit (0640). Windows : hérité de la racine |
| `config/health-token.txt`    | La clé d’état `deployment-health`. Elle n’a aucun droit sur les dépôts                      | Linux : root uniquement. Compose : lisible dans le conteneur                       |
| `config/runtime.json`        | Tous les paramètres du serveur, y compris l’URL de la base de données avec son mot de passe | Linux : root écrit, le groupe de service lit (0640). Windows : hérité de la racine |
| `config/postgres.env`        | Le mot de passe de la base de données d’une installation Compose                            | Root uniquement, ou SYSTEM et Administrateurs                                      |
| `github-token.txt`           | Un jeton GitHub facultatif pour les mises à jour                                            | Root uniquement, ou SYSTEM et Administrateurs                                      |
| `config/mirrors/*.token`     | Les clés de lecture des serveurs sources des miroirs                                        | Le compte de service                                                               |
| La clé TLS                   | La clé privée du certificat                                                                 | Vous choisissez l’emplacement. N’autorisez que le compte de service                |

Sous Windows, la racine accorde le contrôle total à SYSTEM et aux Administrateurs. Le compte de service `LocalService` lit la racine et n’écrit que dans `data\`, `logs\` et la boîte de réception des mises à jour. La base de données s’exécute sous un autre compte, de sorte que l’API ne peut pas lire les fichiers de la base de données.

Règles pour tous les secrets :

- Transmettez-les dans des fichiers ou des variables d’environnement, jamais dans des arguments de commande. Les arguments sont visibles dans la liste des processus.
- Ne copiez pas la clé de récupération vers des clients, des systèmes de CI ou des scripts. Créez des comptes et des clés de service pour le travail quotidien.
- Le serveur n’écrit jamais de clés, mots de passe, jetons, en-têtes `Authorization` ou chaînes de requête dans son journal. Voir [Supervision](./monitoring#never-logged).
- La sortie de commande du programme d’installation expurge les URL de base de données, les clés et les secrets longs.

Pour remplacer la clé de récupération, modifiez ensemble le fichier `bootstrap-token.txt` et son hachage dans `config/keys.json`, conservez l’entrée `deployment-health`, puis redémarrez l’API et le processus de traitement. Voir [Configuration](../install/configuration).

## Mots de passe et limites de connexion {#sign-in-limits}

Les mots de passe comportent de 12 à 128 caractères et ne sont conservés que sous forme de hachage salé (scrypt). Une connexion dure 12 heures. Un compte possède au plus 32 sessions actives ; une nouvelle connexion met fin à la plus ancienne. Un changement ou une réinitialisation de mot de passe met fin à toutes les sessions et révoque tous les jetons d’accès personnels du compte.

Arkvory n’a pas de verrouillage définitif, qui permettrait à quiconque connaît un nom de bloquer le propriétaire. Il ralentit les attaques par couches :

| Couche                            | Limite                                                                                                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Par adresse, connexion            | 10 tentatives à la fois, puis 1 de plus toutes les 15 secondes. Un mot de passe correct rend la tentative. IPv6 compte par réseau /64                                                                                                                                  |
| Par adresse, auto-enregistrement  | 3 tentatives, puis 1 toutes les 20 minutes ; 20 par processus, puis 1 toutes les 3 minutes                                                                                                                                                                             |
| Par compte                        | Chaque mot de passe erroné ajoute une unité de dette. La dette diminue de 1 toutes les 6 secondes. Au-delà de 20 unités, chaque mot de passe erroné ajoute une attente qui double de 1 seconde à 2 minutes. Pendant l’attente, même le mot de passe correct reçoit 429 |
| Requêtes de connexion simultanées | Au plus 16, et le corps d’une requête doit arriver en 10 secondes                                                                                                                                                                                                      |
| Vérifications de mot de passe     | Les vérifications anonymes et administrateur utilisent des files séparées, de sorte qu’un flot de connexions ne bloque pas un administrateur                                                                                                                           |

La réponse est 429 `rate_limited` avec la raison `login_attempts` et l’en-tête `Retry-After`. Les compteurs d’adresse vivent dans le processus et se réinitialisent au redémarrage. La dette du compte se trouve dans la base de données. Une réinitialisation du mot de passe par un administrateur l’efface.

Derrière un proxy inverse, définissez `ARKVORY_TRUSTED_PROXIES` avec les adresses du proxy (jusqu’à 32, IP ou CIDR). Seules ces adresses peuvent indiquer l’adresse du client avec `X-Forwarded-For`. Sans ce paramètre, chaque client partage l’adresse du proxy, et quelques connexions échouées bloquent tout le monde pendant un moment.

## Clés, jetons et expiration {#keys}

| Identifiant                       | Durée de vie                                                                                       | Rotation                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session de connexion              | 12 heures                                                                                          | Se connecter de nouveau                                                                                                                            |
| Jeton d’accès personnel           | 90 jours par défaut, au plus 365. Portée `read` ou `read-write`. Jamais de droits d’administrateur | Créez un nouveau jeton dans [[ui:personalAccessTokens]] et révoquez l’ancien                                                                       |
| Clé de service                    | 90 jours par défaut, au plus 365. Une clé émise mais non activée expire après 15 minutes           | [[ui:keyRotate]] émet une nouvelle clé. L’ancienne clé fonctionne pendant au plus 24 heures de plus. [[ui:keyRevoke]] arrête une clé immédiatement |
| Lien de téléchargement            | Une heure dans la console                                                                          | Créez un nouveau lien                                                                                                                              |
| Clé de récupération et clé d’état | Elles n’expirent pas                                                                               | Remplacez-les manuellement. Voir [Secrets sur le serveur](#secrets)                                                                                |

Créez des jetons d’accès personnels et changez les mots de passe uniquement dans une session connectée. Un jeton ne peut pas créer de jetons. Un jeton d’accès personnel n’a pas de droits d’administrateur, quel que soit son propriétaire.

Moindre privilège pour les outils :

- Créez un compte de service pour chaque consommateur dans [[ui:services]], avec [[ui:servicePolicy]] sur les dépôts exacts et les actions exactes dont il a besoin. [[ui:bindingRead]] et [[ui:bindingPublish]] remplissent des ensembles typiques.
- La création de comptes et d’attributions nécessite le droit distinct de la clé de récupération ou d’une délégation. [[ui:delegations]] permet au propriétaire de transmettre des droits limités à un opérateur. Une clé déléguée ne survit jamais à la clé de son émetteur.
- Donnez au collecteur de métriques sa propre clé avec des droits minimaux.
- Révoquer une attribution bloque une clé qui attend son activation mais ne révoque pas les clés déjà actives. Révoquez ou désactivez celles-ci vous-même. Un téléchargement commencé continue après une révocation.
- Un changement de droits s’applique dès la requête suivante. Le serveur vérifie de nouveau l’accès à chaque requête, pour les listes, les métadonnées et les octets des fichiers.

## Journaux d’audit {#audit}

| Journal                       | Ce qu’il contient                                                                                                                                                                                                    | Où le lire                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Journal de sécurité           | Connexions et échecs, enregistrements, modifications de comptes, de groupes, d’attributions, de mots de passe et de jetons d’accès personnels, avec acteur, type d’identifiant, cible, résultat et adresse du client | `GET /api/v1/security/audit`, pour une session d’administrateur ou la clé de récupération |
| Audit du catalogue            | Modifications d’artefacts, de chemins, d’annotations et d’étapes dans un dépôt                                                                                                                                       | `GET /api/v1/repositories/{repository}/audit`, avec l’autorisation de lire l’audit        |
| Activité du compte de service | Création, modifications, clés émises et révoquées d’un compte de service                                                                                                                                             | [[ui:serviceAudit]] dans la console                                                       |
| Journal du processus          | Une ligne `http.access` par requête, avec `principal` et `clientIp`                                                                                                                                                  | Voir [Supervision](./monitoring#logs)                                                     |

Le journal de sécurité est en ajout seul : la base de données refuse de modifier ou de supprimer une ligne. Le serveur conserve 365 jours et au plus 1 000 000 de lignes, et supprime les lignes les plus anciennes par lots. Les requêtes refusées par les limites de débit ne sont pas journalisées, de sorte qu’un flot ne peut pas faire grossir la table. Exportez le journal vers votre propre magasin d’événements si vous avez besoin d’un historique plus long.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "https://arkvory.example/api/v1/security/audit?limit=100"
```

Utilisez le paramètre `after` avec le dernier ID pour lire les lignes plus anciennes.

## Console et navigateur {#console-headers}

Le serveur définit ces en-têtes sur les réponses de la console :

| En-tête                   | Valeur                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | `default-src 'none'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `Referrer-Policy`         | `no-referrer`                                                                                                                                                                       |
| `X-Content-Type-Options`  | `nosniff`                                                                                                                                                                           |
| `Cache-Control`           | `private, no-store`                                                                                                                                                                 |
| `X-Request-Id`            | L’ID de requête de la réponse                                                                                                                                                       |

Chaque réponse de l’API porte aussi `X-Content-Type-Options`, `Cache-Control` et `X-Request-Id`. La CSP n’autorise aucun script en ligne, aucun script externe, aucun cadrage et aucune connexion à d’autres hôtes. Les images provenant de `blob:` sont les captures d’écran que vous ajoutez à un message de commentaires.

Le serveur ne définit aucun cookie. La console ne conserve une clé ou un jeton de session que dans la mémoire de l’onglet du navigateur. Le navigateur ne stocke que le choix de thème et de langue, ainsi que les fichiers privés de la file de téléchargement. Une page de navigateur provenant d’une autre adresse ne peut pas appeler l’API : `ARKVORY_CORS_ORIGINS` est vide par défaut. Elle liste jusqu’à 16 origines exactes pour une console externe, avec HTTPS ou HTTP sur la boucle locale. Une origine autorisée n’obtient aucun droit supplémentaire, car chaque requête nécessite une clé.

## Signature des mises à jour {#update-signing}

Chaque version possède un manifeste `arkvory-release.json` avec le SHA-256 de son archive et de son programme d’installation, ainsi qu’une signature `arkvory-release.json.sig`. La signature est une signature Ed25519 au format minisign. Le programme de mise à jour détient les clés publiques dans son code.

- Une version venant du hub ou de GitHub ne s’installe que lorsque sa signature correspond à une clé intégrée et que les valeurs SHA-256 correspondent au manifeste. Une signature erronée est une erreur, et le programme de mise à jour ne cherche pas une autre source.
- La clé de signature privée reste chez le mainteneur et n’est jamais sur votre serveur. Une version peut porter une ancienne et une nouvelle clé publique pour renouveler les clés.
- Un dossier local que vous passez avec `--artifact` relève de votre propre choix. Un fichier de signature qu’il contient est vérifié lorsqu’il est présent.
- Le programme d’installation graphique et les paquets `.deb` et `.rpm` ne sont pas encore signés avec un certificat d’éditeur. Windows affiche l’éditeur comme inconnu. Téléchargez-les uniquement depuis [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) et comparez les valeurs SHA-256 avec `release-checksums.json`.
- Une version qui modifie le schéma de la base de données ne s’installe qu’après que le serveur a réalisé et vérifié une sauvegarde récente. Voir [Mises à jour](../install/updates).

## Ce qui est envoyé au hub ProAnimaStudio {#hub}

Les mises à jour sont approuvées dans le hub de ProAnimaStudio (`https://hub.proanima.net`). Le serveur le contacte dans ces cas :

| Donnée                  | Quand                                                                 | Contenu                                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrôle de mise à jour | Toutes les 6 heures                                                   | La version actuelle, le système d’exploitation et l’architecture font partie de l’adresse. Avec les statistiques activées, un ID d’installation aléatoire dans l’en-tête `X-Install-Id`                                                                                                  |
| Événement `updated`     | Après une mise à jour installée, avec les statistiques activées       | La version et l’ID d’installation                                                                                                                                                                                                                                                        |
| Commentaires            | Uniquement lorsqu’un utilisateur envoie le formulaire dans la console | Le texte, une adresse e-mail facultative pour la réponse, jusqu’à 6 captures d’écran et le journal de la page du navigateur. Un administrateur peut ajouter les 1,5 dernier MiB du journal de l’API et un résumé du système. Le formulaire montre tout avant l’envoi ([[ui:reportShow]]) |

L’ID d’installation est un UUID aléatoire dans `config/install-id`. Il ne porte ni nom, ni adresse, ni contenu. Le projet indique que le hub ne stocke aucune adresse IP, aucun nom ni contenu de fichier. Sans statistiques, l’ID n’est pas envoyé, et le hub ne propose une version que lorsqu’elle est publiée pour toutes les installations. Le résumé du système contient les versions, le numéro de schéma et l’état des mises à jour et des miroirs, sans adresses ni secrets. Le journal de l’API ne contient pas non plus de secrets.

Désactivez-le :

```bash
sudo arkvory configure --root /opt/proanima-arkvory --statistics off
sudo arkvory configure --root /opt/proanima-arkvory --hub-off
```

- `--statistics off` arrête l’ID d’installation et l’événement `updated`. La console dispose du même commutateur : [[ui:updateStatistics]] dans [[ui:updates]].
- `--hub-off` arrête tout contact avec le hub. Les mises à jour ne viennent alors que de GitHub, et les commentaires de la console sont désactivés après le prochain redémarrage des services. Les utilisateurs reçoivent à la place l’adresse de contact affichée dans la console.
- `--hub-url https://hub.example` pointe le serveur vers un autre hub. Seuls HTTPS, ou HTTP sur la boucle locale, sont acceptés.

Les contrôles toutes les 6 heures s’exécutent aussi lorsque l’installation automatique est désactivée. Un serveur sans accès à Internet installe à partir d’une copie locale d’une version. Voir [Mises à jour](../install/updates).

## Sauvegarder vos secrets {#secret-backups}

Le coffre de sauvegarde contient le catalogue, les hachages de mots de passe et tous les fichiers publiés. Il n’est pas chiffré. Il ne contient pas les fichiers de votre configuration. Conservez une seconde copie de ces fichiers dans un endroit chiffré en dehors du serveur :

- `config/keys.json` et `config/bootstrap-token.txt` (la clé de récupération),
- `config/runtime.json`,
- le certificat et la clé TLS,
- `config/mirrors/` avec les clés des miroirs,
- `config/hub.json` et `github-token.txt`, si vous les utilisez.

Une restauration crée une nouvelle instance avec ses propres paramètres et son propre fichier de clés. Après une restauration, les sessions ont disparu, les jetons d’accès personnels et les clés de service sont révoqués, et les politiques de nettoyage et de rétention sont désactivées. Émettez de nouvelles clés et réactivez les politiques volontairement. Les mots de passe reviennent tels qu’ils étaient au moment de l’instantané. Traitez chaque copie de ces fichiers comme un secret. Voir [Sauvegardes](./backups).

## Signaler une vulnérabilité {#vulnerabilities}

Ne décrivez pas une vulnérabilité et ne publiez pas de clés dans un ticket public. Le propriétaire du projet est Ian Panaev (compte GitHub `ProAnima`). Le projet n’a pas encore publié de canal privé dédié aux signalements de sécurité. Envoyez un court message sans détails d’exploitation via le compte GitHub du projet ou à l’adresse du studio affichée par la console, `info@proanima.net`, et demandez un moyen privé de poursuivre. Voir `SECURITY.md` dans le dépôt.

## Pages associées {#related-pages}

- [Supervision](./monitoring)
- [Autoréparation](./self-healing)
- [Comptes et accès](../use/accounts)
- [HTTPS et proxy inverse](../install/https)
- [Authentification](../api/authentication)
- [Erreurs](../api/errors)
