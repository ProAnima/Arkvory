---
title: Glossaire
description: 'Définitions courtes des termes employés dans Arkvory et sa documentation, classées par ordre alphabétique, chacune avec un lien vers la page qui l’explique.'
---

# Glossaire

Les termes sont classés par ordre alphabétique. Pour les notions qu’ils recouvrent, lisez [Concepts](../guide/concepts).

## A {#letter-a}

### Compte {#account}

La connexion d’une personne sur le serveur : un nom de 3 à 64 caractères et un mot de passe de 12 à 128 caractères. Les autorisations de groupe donnent à un compte l’accès aux dépôts. Voir [Comptes et accès](../use/accounts).

### Action {#action}

Un droit précis sur un dépôt, tel que `upload.create` ou `content.read`. Les clés de service portent des actions, et la référence de l’API nomme les actions requises par chaque opération. Voir [Authentification](../api/authentication#repository-actions).

### Administrateur {#administrator}

Un compte qui gère les comptes, les groupes, les mises à jour et les sauvegardes. Un administrateur ne lit pas les fichiers d’un dépôt, sauf si un groupe lui accorde aussi cet accès. Voir [Comptes et accès](../use/accounts).

### Admission {#admission}

La limite du nombre de requêtes et de transferts que le serveur traite en même temps. Au-delà, un transfert attend brièvement, puis le serveur répond `503` avec le code `busy` et un en-tête `Retry-After`. Voir [Limites de débit et serveurs occupés](../api/index#rate-limits).

### Artefact {#artifact}

Un fichier stocké immuable, avec son SHA-256. Un nouveau contenu crée un nouvel artefact. Voir [Concepts](../guide/concepts#artifacts).

### Pièce jointe {#attachment}

Un lien d’un build vers un autre artefact du même dépôt : un manifeste, un SBOM, une signature, un rapport ou un autre fichier. Un build compte jusqu’à 32 pièces jointes. Voir [Concepts](../guide/concepts#annotations).

## B {#letter-b}

### Sauvegarde {#backup}

Une copie planifiée de la base de données et de tout le contenu publié vers le stockage des sauvegardes. Voir [Sauvegardes](../operate/backups).

### Agent de sauvegarde {#backup-agent}

Le service qui effectue les copies, les vérifie et applique la rétention aux points de restauration. Voir [Sauvegardes](../operate/backups).

### Jeton Bearer {#bearer-token}

La manière dont chaque client envoie un identifiant à `/api/v1` : l’en-tête `Authorization: Bearer <credential>`. Voir [Authentification](../api/authentication#headers).

### Liaison {#binding}

Une entrée d’une politique de service : un dépôt et la liste des actions autorisées sur celui-ci. Une politique compte jusqu’à 64 liaisons. Voir [Authentification](../api/authentication#service-accounts).

### Build {#build}

La sortie d’une exécution de CI, stockée sous forme d’artefact ou de version de paquet. Voir [Paquets](../use/packages).

## C {#letter-c}

### Catalogue {#catalog}

La liste des artefacts d’un dépôt, avec leurs noms, leurs tailles, leurs étiquettes et leurs étapes. Voir [Référence des artefacts](../api/reference/artifacts).

### Plafond {#ceiling}

La limite d’une délégation : les actions de dépôt qu’un opérateur peut inscrire dans les politiques et les clés des comptes qu’il administre. L’opérateur ne peut pas aller au-delà de son plafond. Voir [Authentification](../api/authentication#delegation).

### Somme de contrôle {#checksum}

Le SHA-256 qui prouve que les octets sont bien ceux attendus. Les téléversements le déclarent avant l’arrivée des octets, et le serveur comme les clients le vérifient. Voir [Transferts](../use/transfers).

### Nettoyage physique {#cleanup}

Aussi appelé nettoyage physique. Il libère l’espace disque du contenu supprimé en arrière-plan, par petits lots. Voir [Stockage](../operate/storage).

### Collection {#collection}

Un ensemble nommé d’artefacts. Une collection fait partie des annotations d’un artefact. Voir [Concepts](../guide/concepts#annotations).

### Comparaison et échange {#compare-and-swap}

Une modification qui indique la révision qu’elle attend, telle que `expectedRevision`. Si une autre modification est passée d’abord, le serveur répond `409` avec la raison `revision_mismatch` et ne change rien. Voir [Présentation de l’API HTTP](../api/index#revisions).

### Tâche de finalisation {#completion-job}

Une tâche d’arrière-plan du processus de traitement qui vérifie et publie un gros téléversement. Suivez-la avec `GET /api/v1/jobs/{id}`. Son état est `queued`, `running`, `completed` ou `failed`. Voir [Référence des téléversements](../api/reference/uploads#getCompletionJob).

### Console {#console}

L’interface web d’Arkvory, servie à `/console/`. Voir [La console web](../guide/console).

### CORS {#cors}

La règle du navigateur pour les pages qui appellent une API à une autre adresse. Une page d’une autre origine ne fonctionne que si l’administrateur inscrit cette origine dans `ARKVORY_CORS_ORIGINS`. Voir [Variables d’environnement](./environment).

### Curseur {#cursor}

La valeur `next` dans une page de résultats. Renvoyez-la comme `after` pour lire la page suivante ; lorsque `next` vaut `null`, la liste est complète. Voir [Présentation de l’API HTTP](../api/index#pagination).

## D {#letter-d}

### Délégation {#delegation}

Une autorisation accordée par la clé de récupération à une clé d’opérateur : elle peut administrer des comptes de service nommés, avec des actions d’administration nommées, dans la limite d’un plafond. Voir [Authentification](../api/authentication#delegation).

### Digest (empreinte) {#digest}

L’adresse de contenu d’une image de conteneur, écrite `sha256:…`. Voir [Images de conteneurs](../protocols/containers).

### Lien de téléchargement {#download-link}

Un lien à durée limitée qui télécharge un artefact sans clé. Il vit de 60 secondes à 24 heures (1 heure par défaut), et personne ne peut le révoquer avant son expiration. Voir [Authentification](../api/authentication#download-links).

## E {#letter-e}

### ETag {#etag}

Le validateur d’un téléchargement : la valeur forte `"sha256:<hex>"` de l’artefact. Utilisez-le avec `If-Range` pour reprendre en toute sécurité et avec `If-None-Match` pour éviter un téléchargement répété. Voir [Présentation de l’API HTTP](../api/index#range-downloads).

## F {#letter-f}

### Basculement {#failover}

Le déplacement des clients vers un miroir lorsque la source est perdue. L’opérateur détache le miroir, qui devient un dépôt ordinaire acceptant les modifications. Rien ne bascule tout seul. Voir [Miroirs](../operate/mirrors).

### Commentaires {#feedback}

Un rapport avec captures d’écran et journaux qu’un utilisateur connecté envoie à ProAnimaStudio depuis la console. La console montre ce qui est joint avant d’envoyer quoi que ce soit. Voir [La console web](../guide/console#feedback).

### Fichier par chemin {#file-by-path}

Un fichier désigné par un chemin dans le dépôt, tel que `builds/game/Setup.exe`, qui conserve ses révisions précédentes. Voir [Fichiers et chemins](../use/files).

### Clé de fichier {#file-key}

Un secret dont le SHA-256 figure dans le fichier de clés du serveur (`ARKVORY_KEYS_FILE`). La clé de récupération est une clé de fichier. Voir [Authentification](../api/authentication#recovery-key).

## G {#letter-g}

### Délai de grâce {#grace-period}

Le temps pendant lequel le contenu supprimé reste sur le disque avant que le nettoyage ne le retire : 24 heures par défaut. Voir [Stockage](../operate/storage).

### Groupe {#group}

Un ensemble de comptes qui partagent l’accès à un dépôt. Un groupe obtient un accès `read` ou `write` (« Lecture et écriture ») par dépôt. Voir [Comptes et accès](../use/accounts).

## H {#letter-h}

### Historique {#history}

Les révisions précédentes d’un fichier par chemin, ou d’un ensemble de pièces jointes. Voir [Fichiers et chemins](../use/files).

### Hub {#hub}

Le service ProAnimaStudio à `https://hub.proanima.net` qui annonce les versions stables et reçoit les commentaires. Voir [Mises à jour](../install/updates).

## I {#letter-i}

### Clé d’idempotence {#idempotency-key}

L’en-tête `Idempotency-Key` : une valeur de 1 à 128 caractères qui fait qu’une requête répétée ne prend effet qu’une seule fois. Voir [Présentation de l’API HTTP](../api/index#idempotency).

### Image {#image}

Une image de conteneur stockée dans le registre intégré. Voir [Images de conteneurs](../protocols/containers).

### Racine d’installation {#installation-root}

Le dossier contenant les données, la configuration et les journaux : `C:\ProgramData\ProAnima\Arkvory` sous Windows et `/opt/proanima-arkvory` sous Linux. Voir [Choisir une installation](../install/index#installation-directory).

## L {#letter-l}

### Étiquette {#label}

Un marqueur court sur un artefact, tel que `nightly` ou `tested`. Un artefact compte jusqu’à 32 étiquettes. Voir [Concepts](../guide/concepts#annotations).

### Bail {#lease}

Une réservation qu’un processus détient pendant un court instant et doit renouveler, afin qu’un seul processus effectue une tâche. L’agent de sauvegarde détient un bail de 60 secondes par défaut, de sorte que deux agents ne s’exécutent jamais en même temps. Voir [Variables d’environnement](./environment#backups).

### Vivacité (liveness) {#liveness}

La réponse de `GET /health/live` : le processus fonctionne. Elle est publique. Voir [Référence du système](../api/reference/system).

### Verrou {#lock}

Un verrou de fichier Git LFS qui empêche deux personnes de modifier le même fichier binaire. Voir [Git LFS](../protocols/git-lfs).

## M {#letter-m}

### Heure de maintenance {#maintenance-hour}

L’heure de la journée en UTC pendant laquelle les mises à jour automatiques peuvent s’installer. La valeur par défaut est 03:00. Voir [Mises à jour](../install/updates).

### Métadonnées {#metadata}

Des champs texte clé/valeur d’un artefact : jusqu’à 32 champs, avec des valeurs allant jusqu’à 1 024 caractères. Voir [Concepts](../guide/concepts#annotations).

### Miroir {#mirror}

Une copie en lecture seule d’un dépôt qu’une seconde installation maintient en suivant la source. Voir [Miroirs](../operate/mirrors).

### Source du miroir {#mirror-source}

L’installation depuis laquelle un miroir copie. Le miroir s’y connecte avec une clé en lecture seule. Voir [Miroirs](../operate/mirrors).

### Déplacement {#move}

Une promotion qui retire aussi le build du dépôt source. Voir [Promotion](../use/promotion).

## O {#letter-o}

### Premiers pas {#onboarding}

Les premières étapes après l’installation, affichées dans la console sous la section Pour commencer. Voir [Démarrage rapide](../guide/quick-start).

### OpenAPI {#openapi}

La description lisible par machine de l’API HTTP, servie à `/api/v1/openapi.json`. Voir [Présentation de l’API HTTP](../api/index#discovery).

### Propriétaire {#owner}

Le premier compte, créé pendant l’installation. C’est un administrateur et un membre du groupe `arkvory-owners`, qui peut écrire dans `releases`. Voir [Concepts](../guide/concepts#owner-and-recovery-key).

## P {#letter-p}

### Paquet {#package}

Un paquet UPack versionné avec un groupe, un nom et une version SemVer. Voir [Paquets](../use/packages).

### Groupe du paquet {#package-group}

La première partie du nom d’un paquet. Les paquets portant le même nom dans des groupes différents sont des paquets différents. Voir [Paquets](../use/packages).

### Partie {#part}

Un morceau d’un gros fichier envoyé dans sa propre requête. Une partie fait au moins 8 MiB, sauf la dernière, et au plus 1 GiB. Voir [Transferts](../use/transfers).

### Autorisation {#permission}

Le droit d’effectuer une action. Les personnes obtiennent `read` ou `write` par les groupes ; les clés de service obtiennent des actions précises. Voir [Authentification](../api/authentication#access-rules).

### Jeton d’accès personnel {#personal-access-token}

Le secret d’une personne pour les scripts et la ligne de commande. Il commence par `pat_`, expire après 90 jours par défaut (365 au maximum) et est soit en lecture seule, soit en lecture et écriture. Voir [Authentification](../api/authentication#personal-tokens).

### Épingler {#pin}

Empêcher la suppression automatique de quelque chose, comme un point de restauration. Voir [Sauvegardes](../operate/backups).

### Politique {#policy}

Les règles enregistrées d’un compte de service (ses liaisons), d’un dépôt (sa politique de stockage) ou du plan de sauvegarde. Voir [Authentification](../api/authentication#service-accounts).

### Promouvoir {#promote}

Le verbe de la promotion : publier un build dans un autre dépôt, ou le marquer avec une étape. Voir [Promotion](../use/promotion).

### Promotion {#promotion}

Le fait de publier un build dans un autre dépôt sans le téléverser de nouveau. Voir [Promotion](../use/promotion).

## Q {#letter-q}

### Quota {#quota}

L’espace maximal qu’un dépôt peut utiliser. Un nouveau téléversement qui le dépasserait est refusé avec `507` et la raison `storage_quota`. Voir [Stockage](../operate/storage).

## R {#letter-r}

### Plage (Range) {#range}

L’en-tête HTTP `Range: bytes=start-end` qui demande une partie d’un fichier. Les téléchargements prennent en charge une plage par requête, ce dont la reprise a besoin. Voir [Présentation de l’API HTTP](../api/index#range-downloads).

### Limite de débit {#rate-limit}

Une limite sur la fréquence à laquelle une chose peut être tentée. Arkvory limite les tentatives de connexion, d’inscription, de mot de passe et de commentaires, et répond `429` avec `Retry-After`. Voir [Authentification](../api/authentication#sign-in-limits).

### Passerelle de lecture {#read-gateway}

Un processus d’API supplémentaire, limité au téléchargement, sur le même stockage. Il répond à `GET` et `HEAD` et refuse les modifications avec `405`. Voir [Passerelles de lecture](../operate/read-gateways).

### Disponibilité (readiness) {#readiness}

Si le serveur peut faire son travail. `GET /health/status` est public et répond `{"status":"ready"}` ou `unavailable` ; `GET /health/ready` exige un identifiant et donne des détails. Voir [Référence du système](../api/reference/system).

### Clé de récupération {#recovery-key}

Aussi appelée clé d’amorçage. Le secret de l’installation dans `config/bootstrap-token.txt` : elle crée le propriétaire, gère les comptes de service et rétablit l’accès. Voir [Authentification](../api/authentication#recovery-key).

### Registre {#registry}

Un serveur vers lequel des clients comme Docker ou npm poussent et depuis lequel ils tirent. Arkvory possède un registre de conteneurs (`/v2/`) et un registre npm (`/npm/`). Voir [Clients et protocoles](../protocols/index).

### Dépôt {#repository}

Un espace nommé pour le contenu, avec ses propres règles d’accès et sa propre politique de stockage. Voir [Dépôts](../use/repositories).

### ID de requête {#request-id}

L’identifiant d’une requête, renvoyé dans l’en-tête `X-Request-Id` et dans chaque erreur. Communiquez-le au support. Voir [Présentation de l’API HTTP](../api/index#request-ids).

### Résoudre {#resolve}

Trouver le build vers lequel pointent une étape et une plage de versions. Voir [Promotion](../use/promotion).

### Restaurer {#restore}

Rendre de nouveau courante une révision antérieure d’un fichier, ce qui ajoute une nouvelle révision. Aussi, récupérer toute l’installation à partir d’un point de restauration. Voir [Fichiers et chemins](../use/files) et [Sauvegardes](../operate/backups).

### Point de restauration {#restore-point}

Une sauvegarde complète qui peut être restaurée. Voir [Sauvegardes](../operate/backups).

### Reprendre {#resume}

Continuer un téléversement ou un téléchargement interrompu à l’endroit où il s’est arrêté. Voir [Transferts](../use/transfers).

### Rétention {#retention}

Les règles sur la durée de conservation du contenu ou des sauvegardes. Voir [Stockage](../operate/storage).

### Politique de rétention {#retention-policy}

Les règles de rétention enregistrées d’un dépôt : combien de builds conserver, quelles étiquettes protéger et quel âge un build doit avoir avant suppression. Elle est désactivée tant qu’un administrateur ne l’active pas. Voir [Stockage](../operate/storage).

### Retry-After {#retry-after}

L’en-tête, et le champ `retryAfterSeconds` d’une erreur, qui indique combien de secondes attendre avant de réessayer après un `429` ou un `503`. Voir [Présentation de l’API HTTP](../api/index#rate-limits).

### Révision {#revision}

Une version numérotée d’un fichier par chemin, des annotations d’un artefact ou d’un réglage. Les révisions commencent à 1 et augmentent. Voir [Présentation de l’API HTTP](../api/index#revisions).

### Révoquer {#revoke}

Annuler définitivement une clé ou un jeton. Voir [Authentification](../api/authentication#service-keys).

### Retour arrière {#rollback}

Revenir à la version précédente après une mise à jour qui n’a pas démarré. Voir [Mises à jour](../install/updates).

### Renouveler {#rotate}

Remplacer une clé par une nouvelle pendant que l’ancienne fonctionne encore. L’activation de la nouvelle clé limite l’ancienne à 24 heures. Voir [Authentification](../api/authentication#service-keys).

## S {#letter-s}

### SBOM {#sbom}

Une nomenclature logicielle : la liste des composants d’un build. Vous pouvez l’attacher à un build. Voir [Concepts](../guide/concepts#annotations).

### Autoréparation {#self-healing}

Le redémarrage autonome des services après un plantage ou un blocage. Voir [Autoréparation](../operate/self-healing).

### SemVer {#semver}

Le versionnage sémantique : `MAJOR.MINOR.PATCH`, avec une partie de préversion facultative, telle que `1.4.2` ou `2.0.0-rc.1`. Voir [Paquets](../use/packages).

### Compte de service {#service-account}

Un compte pour la CI ou l’automatisation. Il possède une politique et se connecte avec des clés. Voir [Authentification](../api/authentication#service-accounts).

### Clé de service {#service-key}

Le secret avec lequel un compte de service se connecte. Il commence par `arkvory_`, n’est affiché qu’une seule fois et doit être activé. Voir [Authentification](../api/authentication#service-keys).

### Session {#session}

Une session de console connectée. Elle commence par `dps_` et dure 12 heures. Voir [Authentification](../api/authentication#sessions).

### SHA-256 {#sha-256}

La fonction de hachage qu’Arkvory utilise pour les artefacts, les parties et les versions. Elle s’écrit sous la forme de 64 chiffres hexadécimaux minuscules. Voir [Transferts](../use/transfers).

### Version stable {#stable-release}

Une version que ProAnimaStudio a approuvée pour les installations sur le canal stable. Voir [Mises à jour](../install/updates).

### Étape {#stage}

Un marqueur sur un build, tel que `qa`, `release` ou `prod`. Voir [Promotion](../use/promotion).

### Surface {#surface}

L’un des six groupes d’opérations de l’API : `discovery`, `identity`, `catalog`, `transfers`, `administration` et `operations`. Voir [Présentation de l’API HTTP](../api/index#surfaces).

## T {#letter-t}

### Tag {#tag}

Le nom donné par une image de conteneur à une version, tel que `latest` ou `1.4`. Voir [Images de conteneurs](../protocols/containers).

## U {#letter-u}

### UPack {#upack}

Le format de paquet qu’Arkvory enregistre : une archive avec un manifeste nommé `upack.json` qui indique le groupe, le nom et la version. Voir [Paquets](../use/packages).

### Mise à jour {#update}

Une version stable plus récente d’Arkvory, et son installation. Voir [Mises à jour](../install/updates).

### Téléversement {#upload}

L’action d’envoyer un fichier au serveur. Le mot désigne aussi la session de téléversement qui réserve le fichier. Voir [Transferts](../use/transfers).

### Session de téléversement {#upload-session}

Une réservation pour un fichier. Elle vit 7 jours et est terminée une fois que chaque octet est arrivé. Voir [Référence des téléversements](../api/reference/uploads).

## V {#letter-v}

### Stockage des sauvegardes {#vault}

Le stockage des sauvegardes : un dossier sur un autre disque ou sur un partage réseau. Voir [Sauvegardes](../operate/backups).

### Version {#version}

Une version SemVer d’un paquet, telle que `1.4.2`. Voir [Paquets](../use/packages).

### Plage de versions {#version-range}

Un ensemble de versions, tel que `^1.4`. Voir [Paquets](../use/packages).

## W {#letter-w}

### Processus de traitement (worker) {#worker}

Le service qui finalise les gros téléversements et synchronise les miroirs. Voir [Choisir une installation](../install/index).

### Écrivain (writer) {#writer}

Le processus d’API qui accepte les modifications, par opposition à une passerelle de lecture. Voir [Passerelles de lecture](../operate/read-gateways).
