---
title: Clients et protocoles
---

# Clients et protocoles

Arkvory repose sur un seul stockage et un seul modèle d’accès, mais propose plusieurs façons d’y accéder. Chacune est un client ou un protocole que des outils parlent déjà. Toutes stockent les données sous forme d’artefacts Arkvory. Les mêmes autorisations, quotas, vérifications SHA-256, règles de rétention, sauvegardes et miroirs s’appliquent donc, quelle que soit la méthode choisie.

Cette page liste toutes les façons de communiquer avec Arkvory, l’usage de chacune et les identifiants qu’elle accepte. Servez-vous-en pour choisir le bon outil pour une tâche.

## Vue d’ensemble {#overview}

| Méthode                        | Adresse                                        | À utiliser pour                                                                                                         | Identifiants                                                                          |
| ------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Console web                    | `https://arkvory.example/console/`             | Parcourir les dépôts, téléverser et télécharger dans un navigateur, gérer les utilisateurs, les clés et les sauvegardes | Connexion avec un nom d’utilisateur et un mot de passe, ou une clé de service         |
| Ligne de commande `arkvoryctl` | `/api/v1`                                      | Scripts de CI, téléversements et téléchargements avec reprise, fichiers par chemin, promotion, sauvegardes              | Clé provenant d’un fichier ou d’une variable d’environnement (envoyée en Bearer)      |
| SDK TypeScript                 | `/api/v1`                                      | Vos propres outils en TypeScript ou JavaScript, dans Node.js ou un navigateur                                           | Clé fournie par une fonction de rappel (envoyée en Bearer)                            |
| API REST                       | `/api/v1/...`                                  | Intégrations dans n’importe quel langage                                                                                | `Authorization: Bearer <key>` uniquement                                              |
| Registre de conteneurs (OCI)   | `/v2/`                                         | Docker, Podman, Buildx, containerd, charts Helm, artefacts ORAS                                                         | Basic avec la clé comme mot de passe (`docker login`), ou Bearer                      |
| Git LFS                        | `/lfs/<repository>`                            | Gros fichiers d’un dépôt git, verrouillage de fichiers pour Unity et Unreal                                             | Basic avec la clé comme mot de passe (assistant d’identifiants git), ou Bearer        |
| Registre npm                   | `/npm/<repository>/`                           | Registres à portée du Unity Package Manager, `npm publish` et `npm install`                                             | Bearer (`_authToken` dans `.npmrc`, `token` dans `.upmconfig.toml`), ou Basic `_auth` |
| Fichiers bruts par chemin      | `/api/v1/repositories/<repository>/raw/<path>` | Une seule requête avec `curl -T` ou PowerShell                                                                          | `Authorization: Bearer <key>` uniquement                                              |
| Webhooks                       | L'URL de votre destinataire                    | Lancer un déploiement ou une tâche quand un dépôt change                                                                | Signature HMAC de chaque requête                                                      |

Les routes sous `/v2`, `/lfs` et `/npm` suivent les spécifications de leurs protocoles. Elles ne font pas partie du document OpenAPI de `/api/v1` et signalent les erreurs dans le format qu’attendent leurs clients.

## Identifiants {#credentials}

Chaque requête exige un identifiant, sauf les contrôles de santé publics. Arkvory accepte ces types :

| Type                    | Aspect                | Origine                                                                                                                         | Usage courant                                             |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Jeton d’accès personnel | `pat_...`             | Créé par un utilisateur dans la console. Portée `read` ou `read-write`. Expire (90 jours par défaut, 365 au plus).              | Développeurs : Unity, git, Docker sur un poste de travail |
| Clé de service          | `arkvory_...`         | Émise par un administrateur pour un compte de service, avec des actions précises par dépôt                                      | CI/CD, agents de déploiement, serveurs de build           |
| Clé de fichier          | n’importe quel secret | Le fichier de clés du serveur (`ARKVORY_KEYS_FILE`), avec `read` ou `write` par dépôt ; la clé du propriétaire administre aussi | Propriétaire de l’installation, intégrations héritées     |
| Session                 | `dps_...`             | Connexion à la console ; valable 12 heures                                                                                      | Travail interactif dans la console                        |
| Lien de téléchargement  | URL avec `?token=`    | Créé pour un artefact ; de 60 secondes à 24 heures                                                                              | Transmettre un fichier à quelqu’un qui n’a pas de clé     |

Les protocoles ne diffèrent que par la manière d’envoyer la clé :

- `/api/v1`, la CLI, le SDK et les fichiers bruts utilisent `Authorization: Bearer <key>`.
- `/v2`, `/lfs` et `/npm` acceptent aussi HTTP Basic. Le nom d’utilisateur n’est pas vérifié. Le mot de passe est la clé Arkvory. C’est ainsi que `docker login`, les assistants d’identifiants git et `_auth` de npm envoient leurs identifiants.
- Un jeton personnel en lecture seule ne modifie jamais les données. Il peut tout de même télécharger des objets Git LFS, car la requête batch de Git LFS est un `POST`, y compris pour les téléchargements.

Création des jetons et des clés : [Comptes et clés](../use/accounts). Détail des en-têtes : [Authentification](../api/authentication).

## Laquelle utiliser ? {#which-one-should-i-use}

| Tâche                                                                                                 | Méthode recommandée                                                  |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Téléverser un artefact de build depuis la CI et reprendre après une panne réseau                      | [`arkvoryctl upload`](./cli) ou [`arkvoryctl put`](./cli)            |
| Publier un paquet UPack depuis la CI                                                                  | [`arkvoryctl packages publish`](./cli)                               |
| Déployer « la dernière version 1.4 de l’étape `release` » sur un serveur                              | [`arkvoryctl packages download --range ^1.4 --stage release`](./cli) |
| Envoyer un fichier de taille petite ou moyenne par chemin depuis un script shell, sans rien installer | [Fichiers bruts](./raw-files) avec `curl -T` ou PowerShell           |
| Stocker des images de conteneurs ou des charts Helm                                                   | [Images de conteneurs](./containers)                                 |
| Garder les textures, modèles et niveaux d’un jeu en dehors de l’hôte git                              | [Git LFS](./git-lfs)                                                 |
| Partager des paquets Unity entre projets                                                              | [Paquets Unity et npm](./unity-npm)                                  |
| Créer votre propre outil ou interface web                                                             | [SDK TypeScript](./sdk)                                              |
| Intégrer depuis Python, Go, C# ou un autre langage                                                    | [API REST](../api/index)                                             |
| Explorer, gérer les utilisateurs, les clés et les sauvegardes                                         | [Console web](../guide/console)                                      |

Quelques règles pratiques :

- **Gros fichiers (plusieurs gigaoctets) :** utilisez `arkvoryctl` ou le SDK. Ils téléversent par parties et reprennent après une interruption. Une requête `PUT` unique (fichiers bruts, objets Git LFS, `npm publish`, couche Docker) repart de l’octet zéro après un échec.
- **L’outil parle déjà un protocole :** utilisez ce protocole. Docker, git et Unity n’ont besoin d’aucun logiciel supplémentaire.
- **Machine qui ne fait que lire :** donnez-lui un jeton en lecture seule ou une clé de service limitée aux actions de lecture.

## Règles communes {#shared-rules}

**HTTPS.** Utilisez HTTPS pour tous les clients. La CLI et le SDK refusent HTTP simple, sauf sur l’interface de bouclage (`localhost`, `127.0.0.1`, `[::1]`). Docker exige un certificat de confiance. Git envoie la clé avec chaque requête. Voir [HTTPS](../install/https).

**Même stockage.** Une couche d’image, un objet Git LFS, une archive npm et un fichier brut sont tous des artefacts. Ils comptent dans les quotas du dépôt et dans la capacité de l’installation. Ils sont vérifiés par SHA-256 au moment du stockage. Ils sont inclus dans les sauvegardes.

**Passerelles de lecture et miroirs.** Une passerelle de lecture n’accepte que `GET` et `HEAD`. Un miroir est une copie en lecture seule d’un dépôt sur une autre installation.

| Méthode                | Sur une passerelle de lecture                       | Sur un miroir                                                      |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `/api/v1`, CLI, SDK    | Lecture seule                                       | Lecture ; les modifications sont refusées (`409 mirror_read_only`) |
| Registre de conteneurs | Pull                                                | Pull ; le push est refusé                                          |
| Git LFS                | Non pris en charge (la requête batch est un `POST`) | Clone et fetch ; le push et les verrous sont refusés               |
| Registre npm           | Installation et recherche                           | Installation et recherche ; la publication est refusée             |
| Fichiers bruts         | `GET` et `HEAD`                                     | `GET` et `HEAD`                                                    |

Voir [Passerelles de lecture](../operate/read-gateways) et [Miroirs](../operate/mirrors).

## Pages associées {#related-pages}

- [Ligne de commande (arkvoryctl)](./cli)
- [SDK TypeScript](./sdk)
- [Images de conteneurs](./containers)
- [Git LFS](./git-lfs)
- [Paquets Unity et npm](./unity-npm)
- [Fichiers bruts](./raw-files)
- [Webhooks](./webhooks)
- [Présentation de l’API](../api/index) et [Erreurs](../api/errors)
