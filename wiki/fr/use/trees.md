---
title: Arborescences de répertoires
description: Publiez un répertoire sous forme d’une seule archive, récupérez-le dans un dossier, comparez un dossier avec lui et réparez uniquement les fichiers qui diffèrent.
---

# Arborescences de répertoires

Un agent de déploiement ou un job de CI a souvent besoin d’un répertoire entier : un build de jeu, un ensemble d’outils, une arborescence de configuration. `arkvoryctl tree` publie un répertoire sous forme d’un seul artefact ZIP, le récupère dans un dossier, compare un dossier avec lui et répare uniquement les fichiers qui diffèrent. L’artefact est un fichier ZIP ordinaire : la console, l’API et tout outil ZIP le lisent, et les sauvegardes le conservent comme n’importe quel autre artefact.

Ces commandes font partie du cœur gratuit. Elles demandent les mêmes autorisations que les téléversements et les téléchargements : voir [Téléversements et téléchargements](./transfers).

## Publier un répertoire {#push}

```bash
arkvoryctl tree push ./Build/Game --name game-1.4.zip --label release
```

| Option                 | Signification                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `--name NAME.zip`      | Nom de l’artefact. Par défaut : le nom du dossier suivi de `.zip`. Le nom doit se terminer par `.zip`. |
| `--label TAG`          | Une étiquette pour l’artefact                                                                          |
| `--file METADATA.json` | Étiquettes et métadonnées, comme pour `upload`                                                         |
| `--compress`           | Compresse les entrées (deflate). Sans cette option, les fichiers sont stockés tels quels.              |

Le résultat indique l’`id` de l’artefact, sa `size`, son `sha256` et le nombre de fichiers dans `entries`.

- **Le même dossier donne la même archive.** Les fichiers sont rangés dans l’ordre des chemins, chaque entrée porte la date du 1980-01-01, et une seule propriété du système de fichiers est conservée : un fichier que son propriétaire peut exécuter reçoit le mode 755, tout autre fichier le mode 644. Publier de nouveau un dossier inchangé donne les mêmes octets et le même SHA-256.
- **Interruptions.** L’archive est construite à côté du dossier (`.<folder>.arkvory-tree.zip`) et téléversée par parties avec un point de contrôle. Après Ctrl+C ou une panne réseau, relancez la même commande : elle construit la même archive et reprend le téléversement. Les deux fichiers sont supprimés après la réussite.
- **Ce qui est refusé.** Les liens symboliques, les jonctions, les périphériques et les tubes à l’intérieur du dossier (`tree_entry_unsupported`), les noms que Windows ne peut pas accepter (`unsafe_name`) et deux noms qui ne diffèrent que par la casse (`case_collision`). Les dossiers vides ne sont pas conservés.
- **Stockée ou compressée.** Sans `--compress`, les octets de chaque fichier forment une plage continue de l’archive. Le serveur peut alors servir un fichier par une plage d’octets, et les réparations transfèrent exactement les octets des fichiers qui diffèrent. Avec `--compress`, l’archive est plus petite et un fichier réparé est décompressé sur votre machine.

## Récupérer un répertoire {#pull}

```bash
arkvoryctl tree pull 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

- **Un dossier vide ou absent** reçoit l’archive entière. Elle est téléchargée à côté du dossier avec des points de contrôle : une récupération interrompue reprend là où elle s’est arrêtée. Une fois son SHA-256 vérifié, les fichiers sont extraits dans un nouveau dossier à côté de la cible, qui prend ensuite la place de la cible.
- **Un dossier contenant des fichiers** devient l’arborescence. Lorsque le serveur dispose de la [table des matières](#table-of-contents), seuls les fichiers qui diffèrent sont téléchargés, chacun par sa plage d’octets, et les fichiers que l’arborescence ne contient pas sont supprimés. Sans table des matières, l’archive entière est téléchargée, et le dossier extrait remplace l’ancien.

Le dossier parent doit exister. Un fichier dans la cible est remplacé en une seule étape : il est écrit dans un fichier temporaire à côté, vérifié, puis renommé. Un programme qui lit le fichier voit soit l’ancienne version, soit la nouvelle.

## Vérifier un répertoire {#verify}

```bash
arkvoryctl tree verify 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

Le résultat liste les fichiers manquants (`missing`), les fichiers divergents (`mismatched` : autre taille ou autre SHA-256) et les fichiers en trop que l’arborescence ne contient pas (`extra`), avec leur nombre dans `counts`. Chaque liste affiche au plus 1000 chemins. `ok` vaut `true` lorsque rien ne manque ni ne diverge ; les fichiers en trop ne le modifient pas. Le code de sortie est 0 lorsque `ok` vaut true, et 5 sinon.

## Réparer un répertoire {#repair}

```bash
arkvoryctl tree repair 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

La réparation réécrit tous les fichiers manquants et divergents et conserve les fichiers en trop. Avec une table des matières, elle ne télécharge que les entrées de ces fichiers ; `fetchedBytes` dans le résultat indique combien d’octets de l’archive elle a lus. Sans table des matières, elle télécharge d’abord l’archive entière.

## La table des matières {#table-of-contents}

Après la publication d’une archive, le processus de traitement (worker) du serveur la lit une fois et enregistre chaque fichier : son chemin, sa taille, son SHA-256 et l’emplacement de ses octets dans l’archive. Cela concerne les artefacts dont le nom se termine par `.zip` ou `.upack`. Tant que ce n’est pas terminé, ou lorsque l’archive ne peut pas être indexée, les commandes travaillent avec l’archive entière.

Un serveur qui dispose de la table propose `zip-tree` dans `tree` de `GET /api/v1/capabilities` (voir `arkvoryctl doctor`) ; avec un serveur plus ancien, les commandes utilisent l’archive entière. La table elle-même est l’opération [getArtifactTree](../api/reference/artifacts#getArtifactTree) : `status` vaut `ready`, `pending` ou `unavailable` avec un `reason`.

| `reason`             | Signification                                                                      |
| -------------------- | ---------------------------------------------------------------------------------- |
| `not_archive`        | Le nom de l’artefact ne se termine pas par `.zip` ou `.upack`                      |
| `invalid_archive`    | Le fichier n’est pas une archive ZIP lisible                                       |
| `unsafe_entry`       | Un chemin sort de l’archive, ou une entrée est un lien ou un fichier spécial       |
| `encrypted_entry`    | Une entrée est chiffrée                                                            |
| `duplicate_entry`    | Deux entrées ont le même chemin, y compris sans tenir compte de la casse           |
| `unsupported_method` | Une entrée utilise une méthode de compression autre que stored ou deflate          |
| `crc_mismatch`       | Les octets d’une entrée ne correspondent pas à sa somme de contrôle dans l’archive |
| `too_many_entries`   | Plus de 100 000 entrées                                                            |
| `too_large`          | Plus de 100 Gio une fois décompressée                                              |

## Comment les fichiers sont vérifiés {#checks}

- **Chaque fichier est vérifié avant de prendre sa place.** Avec une table des matières, sa taille et son SHA-256 doivent correspondre aux valeurs que le serveur a calculées à partir de l’archive publiée. Sans table, le SHA-256 de l’archive entière est vérifié d’abord, puis la taille et le CRC-32 de chaque fichier. Une divergence arrête la commande avec `checksum_mismatch` (code de sortie 5), et le fichier du dossier reste tel qu’il était.
- **Rien n’est écrit hors du dossier.** Les chemins lus dans l’archive et fournis par le serveur sont traités comme des données non fiables. Un chemin qui sort du dossier est refusé avec `path_outside_root`. Un lien à l’intérieur du dossier sur le chemin d’un fichier n’est jamais suivi. Les noms que Windows ne peut pas accepter (`CON`, `aux.txt`, `a:b`, un point ou une espace final) sont refusés avec `unsafe_name` sur tous les systèmes : une arborescence a ainsi le même sens sous Windows et sous Linux.
- **Modes.** Un fichier extrait de l’archive reçoit le mode 755 si l’archive le marque comme exécutable, sinon 644 (Linux et macOS). Un fichier réparé par plage conserve le mode du fichier qu’il remplace.

## Transferts plus rapides {#extensions}

Le téléversement de l’archive entière par `tree push` et son téléchargement par `tree pull` passent par le même transfert que `upload` et `download`. Un [module client](../protocols/cli#client-modules) doté d’une extension de transfert peut les prendre en charge lorsque le serveur propose la même extension ; l’archive reste un ZIP ordinaire, et son SHA-256 ainsi que chaque fichier sont vérifiés comme décrit ci-dessus. Sans module, ou lorsque le serveur ne la propose pas, `arkvoryctl` utilise son propre transfert.

## Pages associées {#related-pages}

- [Téléversements et téléchargements](./transfers)
- [Ligne de commande](../protocols/cli)
- [Référence des artefacts](../api/reference/artifacts)
