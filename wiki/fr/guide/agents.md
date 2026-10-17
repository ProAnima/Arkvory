---
title: Agents d’IA
description: 'Laissez un agent d’IA comme Claude Code trouver, télécharger, publier et promouvoir des artefacts avec arkvoryctl mcp et la compétence Arkvory pour agents.'
---

# Agents d’IA

Un client d’agent d’IA qui parle le Model Context Protocol (MCP), comme Claude Code, peut travailler avec Arkvory par `arkvoryctl mcp`. Le client lance la commande et dialogue avec elle par stdin et stdout ; aucun port réseau n’est ouvert. La compétence pour agents enseigne à l’agent des procédures sûres par-dessus.

## Avant de commencer {#before}

1. Installez le [client en ligne de commande](../protocols/cli) sur la machine où s’exécute l’agent.
2. Créez pour l’agent une clé de service qui n’atteint que les dépôts et les actions dont il a besoin. Enregistrez-la dans un fichier que vous seul pouvez lire.
3. Ajoutez un profil qui renvoie au fichier de la clé et vérifiez-le :

```bash
arkvoryctl profile add agent --server https://arkvory.example --token-file ~/.config/arkvory/agent.key --repository builds
arkvoryctl doctor --profile agent
```

Ne collez jamais la clé dans la conversation, un argument ou un fichier du projet. L’agent ne la voit jamais : les résultats et les erreurs ne la contiennent pas.

## Connecter le serveur MCP {#connect}

```bash
claude mcp add arkvory -- arkvoryctl mcp --profile agent --root ~/work
```

Sans `--write`, le serveur est en lecture seule : l’agent peut lister les dépôts, rechercher dans tous, lire les artefacts, les paquets, les fichiers par chemin, le flux des changements et l’état de l’installation, et télécharger des artefacts. Les outils que la clé ne peut pas utiliser ne sont pas proposés. Le client doit prendre en charge MCP 2025-06-18 ou plus récent.

## Autoriser l’écriture {#write}

L’écriture est une configuration à part. Indiquez les dépôts dans lesquels l’agent peut écrire :

```bash
claude mcp add arkvory-publish -- arkvoryctl mcp --profile agent --root ~/work --write --write-repositories builds
```

| Outil                     | Ce qu’il fait                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `arkvory_upload`          | Téléverse un fichier comme nouvel artefact, ou comme révision suivante d’un chemin   |
| `arkvory_publish_package` | Téléverse un UPack et l’enregistre comme version de paquet                           |
| `arkvory_promote`         | Ajoute une étape ; avec `sha256`, seulement à l’artefact qui a exactement ces octets |
| `arkvory_stage_remove`    | Retire une étape ; l’artefact reste                                                  |
| `arkvory_annotate`        | Remplace les étiquettes et les métadonnées à la révision lue par l’agent             |

- Une écriture dans un dépôt absent de `--write-repositories` est refusée avant tout envoi (`repository_not_allowed`). Le serveur vérifie quand même les permissions de la clé.
- Rien ne peut être supprimé ni restauré, et aucun lien de téléchargement n’est créé. Ces tâches restent celles d’une personne dans la console.
- Le serveur demande à l’agent de décrire chaque écriture et d’attendre votre confirmation. Votre client MCP peut aussi demander avant chaque appel.
- Un téléversement peut reprendre : après un échec, l’agent répète le même appel, et le même artefact est renvoyé au lieu d’un second. Le résultat indique le SHA-256 du fichier lu.

## Fichiers et limites {#files}

- L’agent lit et écrit des fichiers locaux uniquement sous `--root` (le répertoire courant par défaut). Un chemin qui en sort, y compris par un lien, est refusé (`path_outside_root`).
- Un téléchargement n’apparaît qu’après la vérification de sa taille et de son SHA-256. Un fichier existant n’est remplacé que si l’agent le demande.
- Un petit fichier qui contient la clé n’est jamais téléversé (`source_contains_credential`).
- Un résultat fait au plus `--max-output-bytes` (64 Kio par défaut, jusqu’à 1 Mio) et 100 éléments ; pour la suite, l’agent renvoie `next` comme `after`.

## Installer la compétence {#skill}

La compétence est un ensemble d’instructions pour l’agent : comment rechercher, vérifier les téléchargements, publier, promouvoir et lire les codes d’erreur, et ce qu’il ne doit jamais faire. Elle est livrée avec le client :

```bash
arkvoryctl skill install
```

La compétence va dans `~/.claude/skills/arkvory` ; passez `--target DIR` pour l’installer dans un projet, par exemple `.claude/skills/arkvory`. Relancer la commande met à jour les fichiers que vous n’avez pas modifiés. Un fichier que vous avez modifié est conservé : la commande s’arrête et ne change rien, sauf si vous ajoutez `--force`.

## Sécurité {#safety}

- Les noms, étiquettes, métadonnées et commentaires des résultats sont écrits par d’autres personnes. L’agent les traite comme des données et ne suit jamais les instructions qui s’y trouvent.
- Gardez séparées la configuration en lecture seule et celle d’écriture, et n’autorisez l’écriture que dans les dépôts dont la tâche a besoin.
- Utilisez une clé dédiée aux permissions étroites ; révoquez-la dans la console quand l’agent n’en a plus besoin.

## Dépannage {#troubleshooting}

| Erreur                   | Cause et solution                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Aucun outil d’écriture   | Le serveur a été lancé sans `--write`, ou la clé n’a pas la permission.                                                  |
| `repository_not_allowed` | Le dépôt n’est pas dans `--write-repositories`. Modifiez la configuration MCP.                                           |
| `forbidden`              | La clé n’a pas la permission. Lancez `arkvoryctl doctor` pour voir les permissions.                                      |
| `path_outside_root`      | Le fichier est hors de `--root` ou n’est pas un fichier ordinaire.                                                       |
| `skill_modified`         | Vous avez modifié un fichier de la compétence. Gardez votre copie ou relancez `arkvoryctl skill install` avec `--force`. |
