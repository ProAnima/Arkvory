---
title: Présentation
description: 'ProAnima Arkvory est un dépôt auto-hébergé pour les artefacts de build et les fichiers : ce qu’il stocke, ce qu’il sait faire et comment il fonctionne.'
---

# Présentation

ProAnima Arkvory est un dépôt auto-hébergé pour les artefacts de build et les fichiers. Vous l’installez sur votre propre serveur. Il stocke les fichiers que produisent vos builds et les remet aux personnes et aux systèmes qui en ont besoin : agents de déploiement, pipelines CI/CD, machines de test et développeurs.

Arkvory est gratuit pour tout le monde, entreprises comprises. Son code source est ouvert à la lecture, mais ce n’est pas un logiciel open source. Vous pouvez l’utiliser et le modifier au sein de votre organisation. Vous ne pouvez pas en distribuer des copies, le vendre ni le proposer comme service. Consultez la [licence](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md).

## À qui il s’adresse {#who-it-is-for}

- **Les ingénieurs CI/CD** qui ont besoin d’un endroit unique pour publier des builds, retrouver un build par version ou par étape, et le télécharger dans un job de déploiement.
- **Les administrateurs** qui veulent un service de stockage tournant sur un seul serveur, qui redémarre seul, fait ses propres sauvegardes et se met à jour tout seul.
- **Les studios de jeu vidéo** qui travaillent avec Unity ou Unreal Engine. Arkvory stocke les grandes ressources binaires via Git LFS, les paquets Unity via un registre npm et les sorties de build de plusieurs dizaines de gigaoctets.
- **Les équipes réparties sur plusieurs sites** qui veulent une copie en lecture seule d’un dépôt près des personnes qui le téléchargent.

## Ce qu’il stocke {#what-it-stores}

Tout est conservé dans des **dépôts**. Un dépôt peut contenir plusieurs types de contenu en même temps :

| Contenu                            | Comment l’utiliser                                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artefacts (n’importe quel fichier) | Téléversez avec la console, le [client en ligne de commande](../protocols/cli), le [SDK](../protocols/sdk) ou l’API HTTP                                                          |
| Paquets UPack                      | Paquets versionnés avec un groupe, un nom et une version SemVer. Voir [Paquets](../use/packages).                                                                                 |
| Fichiers par chemin                | Un chemin tel que `builds/game/1.4/Setup.exe` qui conserve toutes les versions précédentes. Voir [Fichiers et chemins](../use/files) et [Fichiers bruts](../protocols/raw-files). |
| Images de conteneurs               | Un registre OCI pour Docker, Podman, Helm et ORAS. Voir [Images de conteneurs](../protocols/containers).                                                                          |
| Objets Git LFS                     | Un serveur Git LFS avec verrouillage de fichiers. Voir [Git LFS](../protocols/git-lfs).                                                                                           |
| Paquets npm et Unity               | Un registre npm que le Unity Package Manager peut utiliser. Voir [Unity et npm](../protocols/unity-npm).                                                                          |

Chaque fichier stocké est un **artefact** immuable, doté d’une somme de contrôle SHA-256. Un nouveau contenu ne remplace jamais les anciens octets ; il crée un nouvel artefact. Voir [Concepts](./concepts).

## Principales fonctionnalités {#main-capabilities}

- **Fichiers volumineux.** Les téléversements se font par parties et peuvent reprendre après une panne réseau ou un redémarrage. Un objet peut peser jusqu’à environ 10 TiB. Les téléchargements prennent en charge les plages HTTP (Range) : ils peuvent donc reprendre eux aussi.
- **Contrôle d’accès.** Comptes utilisateur, groupes, jetons d’accès personnels et comptes de service avec clés. Chaque clé n’obtient que les actions de dépôt dont elle a besoin.
- **Étapes et promotion.** Marquez un build `qa`, `release` ou `prod`, ou publiez-le dans un autre dépôt sans nouveau téléversement. Un agent de déploiement peut demander « le dernier build `release` de la plage de versions `^1.4` ».
- **Métadonnées.** Étiquettes, métadonnées textuelles, collections et fichiers joints tels que manifestes, SBOM et signatures.
- **Rétention.** Conservez les N derniers builds de chaque paquet, définissez des quotas et supprimez l’ancien contenu en arrière-plan.
- **Sauvegardes.** Un agent de sauvegarde copie chaque jour la base de données et tout le contenu vers un stockage des sauvegardes situé sur un autre disque ou sur un NAS, puis vérifie les copies.
- **Miroirs.** Une seconde installation peut conserver une copie en lecture seule d’un dépôt et la servir lorsque le serveur principal est indisponible.
- **Passerelles de lecture.** Des processus de téléchargement supplémentaires, sur le même stockage partagé, se répartissent un même budget de téléchargement.
- **Autoréparation.** Les services redémarrent après un plantage ou un blocage. Les longs transferts peuvent reprendre après le redémarrage.
- **Mises à jour.** Le serveur recherche les versions stables signées que ProAnimaStudio approuve dans son hub. Il les installe manuellement, ou automatiquement pendant une heure de maintenance, et peut revenir à la version précédente.
- **Console web.** Thèmes clair et sombre, en onze langues : anglais, russe, espagnol, français, allemand, portugais, chinois, japonais, coréen, hindi et arabe (de droite à gauche). Cette documentation existe dans les mêmes langues. Voir [La console web](./console).

## Fonctionnement {#how-it-runs}

Arkvory s’exécute sur un seul serveur. Il utilise PostgreSQL pour le catalogue et un répertoire local pour le contenu. Trois services fonctionnent ensemble :

| Service                          | Rôle                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| API                              | Le serveur HTTP : l’API, la console et les registres. Il exécute aussi la rétention et le nettoyage physique. |
| Processus de traitement (worker) | Tâches d’arrière-plan : finalisation des gros téléversements et synchronisation des miroirs                   |
| Agent de sauvegarde              | Sauvegardes planifiées vers le stockage des sauvegardes                                                       |

Vous pouvez l’installer de trois manières :

| Plateforme                    | Programme d’installation                  | Détails                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server | `Arkvory-Setup-x64.exe`                   | Un assistant d’installation. Il inclut Node.js et PostgreSQL et fonctionne sans accès à internet. Les services s’exécutent sans utilisateur connecté. Voir [Windows](../install/windows). |
| Linux                         | `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm` | Paquets pour apt et dnf, avec des services systemd. Voir [Linux](../install/linux).                                                                                                       |
| Docker                        | Docker Compose                            | L’API, le processus de traitement, l’agent de sauvegarde et PostgreSQL dans des conteneurs. Voir [Docker](../install/docker).                                                             |

Par défaut, le serveur n’écoute que sur `127.0.0.1:8080`. Avant que d’autres machines s’y connectent, configurez [HTTPS](../install/https).

Une installation correspond à un serveur : s’il s’arrête, les clients attendent son retour. Sous Linux, un [cluster à haute disponibilité](../operate/cluster) de deux ou trois serveurs prend le relais lorsque l’un d’eux tombe en panne. Utilisez les [sauvegardes](../operate/backups) et, si nécessaire, des [miroirs](../operate/mirrors) sur un second site.

## Pour aller plus loin {#where-to-go-next}

1. [Démarrage rapide](./quick-start) : installez Arkvory et téléversez votre premier fichier.
2. [Concepts](./concepts) : les termes que le reste de la documentation emploie.
3. [Installation](../install/index) : prérequis et options pour chaque plateforme.
4. [Client en ligne de commande](../protocols/cli) : utilisez Arkvory depuis des scripts et la CI.
5. [Sauvegardes](../operate/backups) : protégez vos données avant la mise en production.
