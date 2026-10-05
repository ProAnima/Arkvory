---
title: Mises à jour
description: 'Comment Arkvory recherche, vérifie et installe les nouvelles versions : mises à jour manuelles et automatiques, sauvegarde avant une modification du schéma, retour arrière, épinglage et mises à jour hors ligne.'
---

# Mises à jour

ProAnimaStudio annonce chaque version stable d’Arkvory via un hub. Votre serveur demande au hub quelle version il peut installer, télécharge la version, vérifie sa signature et l’installe. Rien n’est installé tant que vous ne le lancez pas, ou que vous n’activez pas les mises à jour automatiques. Les mises à jour automatiques sont désactivées par défaut.

Une mise à jour n’est pas une mise à jour progressive. Les services s’arrêtent un court instant, et les transferts en cours sont interrompus. Les clients capables de reprendre poursuivent leurs transferts. Effectuez la mise à jour dans une fenêtre de maintenance.

## Fonctionnement des mises à jour {#how-it-works}

- **Versions.** Seules les versions publiées et stables au format `x.y.z` sont installées. Les préversions, les branches, les adresses arbitraires et les versions plus anciennes sont refusées.
- **Le hub décide.** Toutes les 6 heures, le serveur demande au hub la version approuvée pour lui. Le hub retient une nouvelle version ou la diffuse progressivement. Les fichiers eux-mêmes proviennent de GitHub via des liens à durée de vie limitée que le hub émet. Le serveur n’a besoin d’aucun jeton GitHub pour cela.
- **Signature.** Le manifeste de chaque version est signé par ProAnimaStudio. Le serveur vérifie la signature avec une clé publique intégrée au programme installé, puis le SHA-256 de l’archive. Une version non signée ou altérée n’est pas installée, qu’elle vienne du hub ou de GitHub. Le hub n’est pas considéré comme fiable pour l’intégrité.
- **Le programme de mise à jour de l’hôte.** Un minuteur sur le serveur (`arkvory-update.timer` sous Linux, la tâche `ProAnimaArkvoryUpdate` sous Windows) exécute le programme de mise à jour chaque minute. Il prend en charge les demandes de la console, vérifie les versions lorsque 6 heures se sont écoulées depuis la dernière vérification, et lance la mise à jour automatique pendant son heure. Les vérifications s’exécutent même lorsque l’installation automatique est désactivée.

### Ce que fait une mise à jour {#what-an-update-does}

1. Pendant que les services continuent de fonctionner, il télécharge la version, vérifie la signature et le SHA-256, et décompresse les fichiers dans `releases/<version>/` de la racine d’installation. Pour Compose, il construit la nouvelle image.
2. Si la version modifie le schéma de la base de données, il effectue et vérifie d’abord une nouvelle sauvegarde. Voir [La sauvegarde avant une mise à jour](#backup).
3. Il arrête l’agent de sauvegarde, le processus de traitement (worker) et l’API. Chacun dispose de jusqu’à 120 secondes pour se terminer.
4. Il bascule l’installation vers la nouvelle version. Une modification du schéma exécute sa migration à ce moment-là.
5. Il démarre l’API et le processus de traitement (worker) et attend que l’API se déclare prête trois fois de suite. Il démarre ensuite l’agent de sauvegarde. L’agent ne fait pas partie du contrôle : s’il ne se manifeste pas dans un délai d’environ 90 secondes, la mise à jour affiche un avertissement et continue.
6. Il envoie l’événement anonyme `updated` au hub, si les statistiques sont activées. Un échec ici n’annule jamais la mise à jour.

L’ancienne version reste dans `releases/`. Toutes les données, les clés et la configuration restent inchangées.

## Rechercher des mises à jour {#check}

Connectez-vous à la console en tant qu’administrateur et ouvrez [[ui:updates]]. La page affiche [[ui:updateCurrent]], [[ui:updateLatest]] et [[ui:updateChecked]]. Sélectionnez [[ui:updateCheck]] pour interroger le hub maintenant. Après votre connexion, une bannière avec [[ui:updateOpen]] vous signale l’existence d’une version plus récente.

Si une vérification échoue, par exemple sans accès réseau, la page conserve la dernière version trouvée et la marque comme éventuellement obsolète. La vérification est retentée après 6 heures, ou lorsque vous sélectionnez [[ui:updateCheck]].

Sur le serveur, `arkvory status --root <root>` affiche la version installée, le réglage des mises à jour automatiques et l’épinglage.

Si la page indique que le programme de mise à jour de l’hôte n’est pas connecté, exécutez `arkvory updates-connect --root <root>`. Il connecte la console et le minuteur de mise à jour d’une installation mise à jour depuis une ancienne version. Si la page indique que le programme de mise à jour ne se manifeste plus, le minuteur ou la tâche ne s’est pas exécuté depuis 5 minutes. Voir [Dépannage](#troubleshooting).

## Installer manuellement {#manual}

### Dans la console {#manual-console}

1. Ouvrez [[ui:updates]] et vérifiez que [[ui:updateLatest]] affiche la version souhaitée.
2. Sélectionnez [[ui:updateInstall]]. La boîte de dialogue nomme la version et avertit que les transferts peuvent être interrompus.
3. Sélectionnez [[ui:updateConfirmButton]]. La console envoie la version et le SHA-256 que vous avez vus. Si les octets publiés ont changé depuis, la demande est refusée.
4. Patientez. La demande est acceptée immédiatement ; le programme de mise à jour de l’hôte la prend en charge en moins d’une minute. La page peut perdre la connexion pendant le redémarrage des services et se reconnecte d’elle-même. N’envoyez pas de seconde demande.

La console refuse une installation lorsque la version est épinglée. Voir [Épingler une version](#pin).

### Avec une commande {#manual-command}

```bash
sudo arkvory update --root /opt/proanima-arkvory
sudo arkvory update --root /opt/proanima-arkvory --version 1.2.3
```

Sans `--version`, la commande installe la version que le hub approuve pour ce serveur. Avec `--version`, elle installe cette version stable exacte, qui doit être plus récente que la version installée. La commande se termine avec un code d’erreur lorsque la mise à jour échoue. La façon d’exécuter la commande sur chaque plateforme est décrite dans [Configuration](./configuration#lifecycle-commands).

## Mises à jour automatiques {#automatic}

Activez les mises à jour automatiques de l’une des trois façons suivantes :

- Dans la console, ouvrez [[ui:updates]], sélectionnez [[ui:updateAutomatic]] sous [[ui:updateSettings]], choisissez [[ui:updateHour]] et sélectionnez [[ui:updateSave]].
- Sur le serveur : `arkvory configure --root <root> --enable-updates`.
- Lors d’une installation par script : `--automatic` pour `install.sh`, `-AutomaticUpdates` pour `install.ps1`.

Désactivez-les avec la console ou `arkvory configure --root <root> --disable-updates`.

| Règle      | Valeur                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Fenêtre    | L’heure UTC choisie. Par défaut, de 03:00 à 03:59 UTC. Seule la console définit l’heure                                  |
| Tentatives | Au plus une par jour UTC, qu’elle réussisse ou échoue. Une fenêtre manquée n’est pas rattrapée plus tard dans la journée |
| Ignorée si | La version est épinglée, la dernière vérification a échoué, ou aucune version plus récente n’est connue                  |
| Version    | La version la plus récente que le hub a approuvée lors de la dernière vérification                                       |

Planifiez vos sauvegardes en dehors de la fenêtre de mise à jour. Une mise à jour arrête l’agent de sauvegarde, et une sauvegarde en cours est interrompue et remise en file d’attente.

## La sauvegarde avant une mise à jour {#backup}

Une mise à jour qui ne modifie pas le schéma de la base de données n’effectue aucune sauvegarde. Fiez-vous à vos sauvegardes planifiées.

Une version qui modifie le schéma de la base de données ne s’installe qu’après une sauvegarde récente et vérifiée. Le programme de mise à jour effectue cette opération pendant que les services fonctionnent encore :

1. Il demande une nouvelle sauvegarde à l’agent de sauvegarde et attend que la sauvegarde soit effectuée et contrôlée. Il attend jusqu’à 6 heures. La console indique que la version s’installe pendant ce temps.
2. Ce n’est qu’alors qu’il arrête les services, migre la base de données et démarre la nouvelle version.

La sauvegarde nécessite trois éléments : un stockage des sauvegardes connecté et disponible, un agent de sauvegarde en ligne, et au moins une sauvegarde déjà terminée auparavant. La première sauvegarde complète de plusieurs téraoctets est un travail planifié, jamais un effet secondaire d’une mise à jour. Si l’un des trois manque, la mise à jour est **refusée avant toute modification**. Les services continuent de fonctionner, la console indique que l’installation a été refusée, et une mise à jour automatique réessaie le jour suivant. Connectez le stockage des sauvegardes et lancez la première sauvegarde : voir [Sauvegardes](../operate/backups).

Les modifications qui arrivent après l’instantané et avant l’arrêt des services ne figurent pas dans cette sauvegarde. La sauvegarde n’a d’importance que si la nouvelle version échoue après sa migration : voir [Revenir en arrière et récupérer](#rollback).

### Mettre à niveau avec votre propre sauvegarde {#manual-upgrade}

Sans stockage des sauvegardes intégré, effectuez et vérifiez votre propre sauvegarde de la base de données et de tout le stockage, puis fournissez au programme de mise à jour un fichier qui l’enregistre :

```bash
sudo arkvory upgrade --root /opt/proanima-arkvory --version 1.2.3 --backup-record /secure/backup-record.txt
```

Le fichier est votre propre note. Le programme de mise à jour vérifie seulement qu’il existe ; il ne prouve pas que la sauvegarde est complète. Le journal et le retour arrière sont les mêmes que pour `update`. Cette commande ne fonctionne que vers l’avant et est refusée lorsque la version est épinglée à une autre version.

## Revenir en arrière et récupérer {#rollback}

### Retour arrière automatique {#automatic-rollback}

- **Aucune modification du schéma.** Si la nouvelle version ne devient pas prête, le programme de mise à jour l’arrête, restaure la version précédente, attend la disponibilité et signale `Update failed; previous release restored`.
- **Modification du schéma, migration échouée.** La migration s’exécute dans une seule transaction. Une migration échouée est annulée, et la version précédente redémarre sur le schéma inchangé.
- **Modification du schéma, la nouvelle version ne démarre pas après la migration.** La version précédente ne peut pas lire le nouveau schéma : il n’existe donc aucun retour automatique. Le programme de mise à jour marque le journal `maintenance-required` et nomme le point de sauvegarde. Corrigez la cause et exécutez `recover`, qui termine la mise à jour. Ou restaurez le point de sauvegarde nommé dans `journal.json` et exécutez la version précédente.

Arkvory n’a pas de commande de rétrogradation. La commande refuse une version plus ancienne. La version précédente reste dans `releases/` uniquement pour le retour arrière automatique.

### Récupérer une mise à jour interrompue {#recover-update}

Un plantage ou une coupure de courant pendant une mise à jour laisse deux éléments : le verrou `operation.lock` et l’enregistrement `journal.json` dans la racine d’installation. Les nouvelles mises à jour et la plupart des commandes refusent de s’exécuter jusqu’à la récupération. Ne supprimez jamais le verrou avant de connaître l’état.

1. Arrêtez le minuteur de mise à jour, afin qu’aucune nouvelle exécution ne démarre. Sous Linux : `sudo systemctl stop arkvory-update.timer`. Sous Windows : `Disable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`. Dans une installation Compose sans minuteur, arrêtez votre tâche planifiée.
2. Assurez-vous qu’aucun processus de mise à jour ne s’exécute. Sauvegardez `journal.json` et les journaux.
3. Ne supprimez `operation.lock` qu’ensuite.
4. Exécutez `arkvory recover --root <root>`. Il avance dans la direction que permet le journal :
   - pour une mise à jour sans modification du schéma, ou avant le début de la migration, il revient à la version précédente,
   - après le début de la migration, il avance : il répète la migration, qui peut être répétée sans danger, et démarre la nouvelle version.
5. Vérifiez que les services sont prêts et qu’un téléchargement de test fonctionne. Redémarrez le minuteur : `sudo systemctl start arkvory-update.timer`, ou `Enable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`.

Si la demande de la console qui a lancé la mise à jour est encore enregistrée, `arkvory updates-reset --root <root>` la supprime. Ne l’exécutez qu’après avoir vérifié l’état. Il ne supprime pas le verrou.

## Épingler une version {#pin}

Épinglez une version pour empêcher toute mise à jour vers une autre version.

```bash
sudo arkvory configure --root <root> --pin                  # pin the installed version
sudo arkvory configure --root <root> --pin --version 1.2.3  # pin another stable version
sudo arkvory configure --root <root> --unpin
```

Tant qu’une version est épinglée :

- les mises à jour automatiques ne font rien,
- la console refuse d’installer une version et vous demande de retirer l’épinglage sur le serveur,
- `arkvory update` installe la version épinglée et refuse un autre `--version`,
- les vérifications continuent, donc la console affiche toujours les versions plus récentes.

Pour installer une version plus récente après avoir épinglé une version plus ancienne, épinglez la version plus récente et exécutez `arkvory update`. Vous pouvez aussi épingler lors d’une installation par script : `--pin` pour `install.sh`, `-Pin` pour `install.ps1`.

## Le hub, le canal et les statistiques {#hub}

### Ce que le serveur envoie au hub {#hub-data}

| Quand                                                             | Ce qui est envoyé                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vérification des mises à jour, toutes les 6 heures ou sur demande | Une demande de mise à jour du projet `arkvory` avec la version installée, le système d’exploitation (`linux` ou `windows`), le processeur (`x86_64` ou `aarch64`) et le canal. Si les statistiques sont activées, l’en-tête `X-Install-Id` avec un ID d’installation aléatoire est ajouté |
| Mise à jour terminée, si les statistiques sont activées           | Un événement `updated` avec l’ID d’installation, la nouvelle version, le système d’exploitation, le processeur et le canal                                                                                                                                                                |
| Téléchargement d’une version                                      | Le hub répond avec un lien vers GitHub. Les fichiers viennent de là                                                                                                                                                                                                                       |

Aucune clé, aucun compte, aucun nom d’hôte et aucun contenu stocké n’est envoyé, et aucun identifiant n’atteint le hub. L’ID d’installation est une valeur aléatoire qui n’identifie que l’installation. Selon le projet, le hub ne stocke ni adresses IP, ni noms, ni contenus. Le hub reçoit aussi les commentaires qu’un utilisateur envoie depuis la console. Il s’agit d’une action distincte de l’utilisateur.

Lorsque les statistiques sont désactivées, le serveur n’envoie aucun ID d’installation ni aucun événement. Le hub ne propose alors une version que lorsqu’il l’a diffusée à toutes les installations.

### Options {#hub-options}

| Réglage        | Valeur par défaut          | Comment le modifier                                                                                                                    |
| -------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Statistiques   | activées                   | Console : [[ui:updateStatistics]] sous [[ui:updateSettings]]. Commande : `--statistics off` ou `--statistics on`                       |
| Canal          | `stable`                   | `--update-channel beta` pour recevoir des versions que ProAnimaStudio propose plus tôt, `--update-channel stable` pour revenir         |
| Adresse du hub | `https://hub.proanima.net` | `--hub-url https://hub.example` pour un hub qui vous est propre, `--hub-off` pour n’utiliser que GitHub. L’adresse doit utiliser HTTPS |

Ce sont toutes des options de `arkvory configure --root <root>` et elles prennent effet sans redémarrage. Les réglages sont stockés dans `config/hub.json`. Un changement de l’adresse du hub change aussi l’endroit où la console envoie les commentaires, après le prochain redémarrage des services.

### Quand le hub est injoignable {#hub-unreachable}

Si le hub ne répond pas (panne réseau, délai dépassé ou erreur du serveur), le programme de mise à jour lit à la place la dernière version stable sur GitHub et journalise un avertissement. Il effectue les mêmes contrôles de signature et de SHA-256. Un refus du hub (statut 4xx), un fichier manquant ou une mauvaise signature est une erreur, et il n’y a pas de repli.

Si les versions sur GitHub nécessitent une authentification, créez le fichier `github-token.txt` dans la racine d’installation avec un jeton capable de lire le contenu du dépôt. Seuls les administrateurs peuvent lire le fichier. Le programme de mise à jour l’utilise, les services non, et il n’est jamais transmis comme option de commande. Avec `--hub-off`, le programme de mise à jour utilise toujours GitHub.

Le serveur a besoin d’un accès HTTPS à `hub.proanima.net`, `api.github.com`, `github.com` et aux hôtes de téléchargement de GitHub.

## Installations hors ligne {#offline}

Un serveur sans accès à internet ne peut pas vérifier les versions. La page [[ui:updates]] indique alors que la vérification a échoué. Cela n’affecte pas les services. Mettez plutôt à jour à partir de fichiers.

1. Sur un ordinateur avec accès à internet, téléchargez le kit correspondant à la plateforme de votre serveur : `Arkvory-Linux.tar.gz` ou `Arkvory-Windows.zip`. Comparez leurs SHA-256 avec `release-checksums.json` de la version.
2. Copiez le kit sur le serveur et décompressez-le. Le répertoire contient `arkvory-release.json`, `arkvory-runtime.zip` et `arkvory-setup.mjs`. Le kit n’a pas de fichier de signature. Téléchargez `arkvory-release.json.sig` depuis la même page de version et placez-le à côté de `arkvory-release.json` : le programme de mise à jour vérifie alors aussi la signature.
3. Lancez la mise à jour avec le chemin absolu du répertoire :

   ```bash
   sudo arkvory update --root /opt/proanima-arkvory --artifact /media/release
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' update --root C:\ProgramData\ProAnima\Arkvory --artifact D:\release
   ```

Le programme de mise à jour vérifie le SHA-256 de l’archive par rapport au manifeste. Il ne vérifie la signature que lorsque `arkvory-release.json.sig` se trouve à côté du manifeste. Un répertoire local relève de votre choix : la mise à jour n’exige donc pas la signature. Sans elle, la comparaison du kit avec `release-checksums.json` à l’étape 1 est votre seule preuve d’origine. Les mêmes règles s’appliquent en cas de modification du schéma : vous avez d’abord besoin d’une sauvegarde vérifiée.

Un paquet natif ou `Arkvory-Setup-x64.exe` embarque sa version et ne nécessite aucun accès à internet. Une mise à jour Compose construit l’image sur l’hôte. Il n’a besoin de Docker Hub que lorsque l’image de base `node:24.21.0-bookworm-slim` n’est pas encore présente sur l’hôte.

## Mise à jour par plateforme {#platforms}

### Windows {#platform-windows}

Exécutez un `Arkvory-Setup-x64.exe` plus récent par-dessus celui installé. Le programme d’installation retrouve les données et ne redemande pas le propriétaire. Il met à jour les programmes, les services et la version de la base de données de la même manière qu’une mise à jour depuis la console. Le programme d’installation d’une version plus ancienne est refusé, et celui de la même version répare les services. Ne lancez pas le programme d’installation pendant qu’une mise à jour est en cours. Le programme d’installation n’existe qu’en anglais et en russe. Vous pouvez aussi mettre à jour depuis la console ou avec la commande.

### Paquets Linux {#platform-linux}

Téléchargez le paquet plus récent depuis la page de version et installez-le comme le premier : `sudo apt install ./Arkvory-amd64.deb` ou `sudo dnf install ./Arkvory-x86_64.rpm`. Il n’y a pas de dépôt apt ou dnf, donc `apt upgrade` et `dnf upgrade` ne trouvent pas les nouvelles versions. L’étape de configuration du paquet exécute la même mise à jour que la commande, avec la version à l’intérieur du paquet. Les services en cours continuent de répondre jusqu’à la bascule.

Si la mise à jour est refusée, par exemple parce qu’une modification du schéma nécessite une sauvegarde qui n’existe pas, l’ancienne version continue de fonctionner et l’étape de configuration échoue. Corrigez la cause, puis répétez l’étape avec `sudo dpkg --configure -a` sous Debian et Ubuntu, ou en réinstallant le même paquet sur les systèmes RPM.

Après une mise à jour depuis la console, la version affichée par le gestionnaire de paquets peut être plus ancienne que la version en cours d’exécution. Un paquet plus ancien que la version en cours est refusé.

### Installation par script {#platform-script}

Une installation par script n’a pas de commande `arkvory`. Mettez à jour depuis la console, ou exécutez `manage.mjs update` avec le Node.js de l’installation. Voir [Configuration](./configuration#lifecycle-commands).

### Docker Compose {#platform-compose}

Mettez à jour depuis la console ou avec `manage.mjs update`. Le programme de mise à jour construit l’image de la nouvelle version, remplace les conteneurs `backup`, `worker` et `api` et conserve les volumes. Une installation Compose sans `root` nécessite un `updates-poll` planifié. Voir [Docker Compose](./docker#updates-compose).

## Après la mise à jour {#after}

- Vérifiez `arkvory status --root <root>` et connectez-vous à la console.
- Supprimez de `releases/` les versions dont vous n’avez plus besoin. Conservez la version actuelle et la précédente indiquée dans `journal.json`. Les anciennes versions, les fichiers téléchargés et les fichiers de préparation ne sont jamais supprimés par le programme de mise à jour.
- Une mise à jour ne met pas à niveau le Node.js d’une installation par script, les programmes PostgreSQL, le système d’exploitation ni le moteur de conteneurs. Mettez-les à jour séparément. Un changement de version majeure de PostgreSQL est une migration à part : sauvegardez d’abord.

## Dépannage {#troubleshooting}

| Ce que vous voyez                                                            | Que faire                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La page indique que le programme de mise à jour de l’hôte n’est pas connecté | Exécutez `arkvory updates-connect --root <root>` dans une fenêtre de maintenance                                                                                                                                                                         |
| La page indique que le programme de mise à jour ne se manifeste plus         | Vérifiez le minuteur ou la tâche. Sous Linux : `systemctl status arkvory-update.timer` et `journalctl -u arkvory-update`. Sous Windows : la tâche `ProAnimaArkvoryUpdate` et `logs\updater.log`. Vérifiez qu’un fichier `operation.lock` ne subsiste pas |
| La vérification des versions a échoué                                        | Vérifiez l’accès au hub et à GitHub depuis le serveur. Les services ne sont pas affectés                                                                                                                                                                 |
| L’installation a été refusée car une sauvegarde est nécessaire               | Connectez le stockage des sauvegardes, attendez la première sauvegarde, vérifiez à nouveau l’état. Voir [La sauvegarde avant une mise à jour](#backup)                                                                                                   |
| La mise à jour a échoué                                                      | Lisez `journal.json`, le journal du programme de mise à jour et les journaux des services avant de réessayer                                                                                                                                             |
| Une récupération manuelle est nécessaire                                     | Suivez [Récupérer une mise à jour interrompue](#recover-update)                                                                                                                                                                                          |
| Les réglages ont changé pendant l’attente de la demande                      | Actualisez la page et envoyez à nouveau la demande                                                                                                                                                                                                       |
| `Installation is locked`                                                     | Une autre opération est en cours, ou a planté. Voir [Récupérer une mise à jour interrompue](#recover-update)                                                                                                                                             |
| `Interrupted deployment; use recover after inspecting journal.json`          | Une mise à jour précédente ne s’est pas terminée. Récupérez d’abord                                                                                                                                                                                      |
| `Downgrades are forbidden`                                                   | La version n’est pas plus récente que la version installée                                                                                                                                                                                               |
| `Version is pinned`                                                          | Retirez l’épinglage, ou installez la version épinglée                                                                                                                                                                                                    |
| `Interrupted update request; inspect installation and use updates-reset`     | Une demande de la console a été acceptée mais non terminée. Vérifiez l’état, puis exécutez `updates-reset`                                                                                                                                               |

D’autres conseils figurent dans [Dépannage](../operate/troubleshooting) et [Autoréparation](../operate/self-healing).
