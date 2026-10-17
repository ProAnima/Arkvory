---
title: Agentes de IA
description: 'Permita que un agente de IA como Claude Code busque, descargue, publique y promueva artefactos mediante arkvoryctl mcp y la habilidad de Arkvory para agentes.'
---

# Agentes de IA

Un cliente de agente de IA compatible con Model Context Protocol (MCP), como Claude Code, puede trabajar con Arkvory mediante `arkvoryctl mcp`. El cliente inicia el comando y se comunica con él por stdin y stdout; no se abre ningún puerto de red. La habilidad para agentes enseña al agente flujos de trabajo seguros sobre esta base.

## Antes de empezar {#before}

1. Instale el [cliente de línea de comandos](../protocols/cli) en la máquina donde se ejecuta el agente.
2. Cree para el agente una clave de servicio que solo alcance los repositorios y las acciones que necesita. Guárdela en un archivo que solo usted pueda leer.
3. Añada un perfil que haga referencia al archivo de la clave y compruébelo:

```bash
arkvoryctl profile add agent --server https://arkvory.example --token-file ~/.config/arkvory/agent.key --repository builds
arkvoryctl doctor --profile agent
```

Nunca pegue la clave en el chat, en un argumento ni en un archivo del proyecto. El agente nunca la ve: los resultados y los errores no la contienen.

## Conectar el servidor MCP {#connect}

```bash
claude mcp add arkvory -- arkvoryctl mcp --profile agent --root ~/work
```

Sin `--write`, el servidor es de solo lectura: el agente puede listar repositorios, buscar en todos ellos, leer artefactos, paquetes, archivos por ruta, el registro de cambios y el estado de la instalación, y descargar artefactos. No se ofrecen las herramientas que la clave no puede usar. El cliente debe admitir MCP 2025-06-18 o posterior.

## Permitir la escritura {#write}

La escritura es una configuración aparte. Indique los repositorios en los que el agente puede escribir:

```bash
claude mcp add arkvory-publish -- arkvoryctl mcp --profile agent --root ~/work --write --write-repositories builds
```

| Herramienta               | Qué hace                                                                          |
| ------------------------- | --------------------------------------------------------------------------------- |
| `arkvory_upload`          | Sube un archivo como artefacto nuevo o como la siguiente revisión de una ruta     |
| `arkvory_publish_package` | Sube un UPack y lo registra como versión de paquete                               |
| `arkvory_promote`         | Añade una etapa; con `sha256`, solo al artefacto que tiene exactamente esos bytes |
| `arkvory_stage_remove`    | Quita una etapa; el artefacto se conserva                                         |
| `arkvory_annotate`        | Reemplaza etiquetas y metadatos en la revisión que leyó el agente                 |

- Una escritura en un repositorio que no está en `--write-repositories` se rechaza antes de enviar nada (`repository_not_allowed`). El servidor sigue comprobando los permisos de la clave.
- No se puede eliminar ni restaurar nada, y no se crean enlaces de descarga. Esas tareas siguen siendo de una persona en la consola.
- El servidor pide al agente que describa cada escritura y espere su confirmación. Su cliente MCP también puede preguntar antes de cada llamada.
- Una subida se puede reanudar: tras un fallo, el agente repite la misma llamada y se devuelve el mismo artefacto en lugar de uno nuevo. El resultado indica el SHA-256 del archivo leído.

## Archivos y límites {#files}

- El agente lee y escribe archivos locales solo dentro de `--root` (el directorio actual de forma predeterminada). Una ruta que sale de él, también a través de un enlace, se rechaza (`path_outside_root`).
- Una descarga aparece solo después de comprobar su tamaño y su SHA-256. Un archivo existente solo se reemplaza cuando el agente lo pide.
- Un archivo que contiene la clave nunca se sube (`source_contains_credential`), y los archivos propios de arkvoryctl (perfiles, archivos de clave, puntos de control de subidas) nunca se leen ni se reemplazan, ni siquiera dentro de `--root` (`private_path`).
- Un resultado ocupa como máximo `--max-output-bytes` (64 KiB de forma predeterminada, hasta 1 MiB) y 100 elementos; para obtener más, el agente pasa `next` como `after`.

## Instalar la habilidad {#skill}

La habilidad es un conjunto de instrucciones para el agente: cómo buscar, verificar descargas, publicar, promover y leer códigos de error, y qué no debe hacer nunca. Se incluye con el cliente:

```bash
arkvoryctl skill install
```

La habilidad se instala en `~/.claude/skills/arkvory`; pase `--target DIR` para instalarla en un proyecto, por ejemplo `.claude/skills/arkvory`. Al volver a ejecutar el comando se actualizan los archivos que usted no ha cambiado. Un archivo que usted cambió se conserva: el comando se detiene y no cambia nada a menos que añada `--force`.

## Seguridad {#safety}

- Los nombres, etiquetas, metadatos y comentarios de los resultados los escriben otras personas. El agente los trata como datos y nunca sigue instrucciones que encuentre en ellos.
- Mantenga separadas la configuración de solo lectura y la de escritura, y permita escribir solo en los repositorios que necesita la tarea.
- Use una clave dedicada con permisos limitados; revóquela en la consola cuando el agente ya no la necesite.

## Solución de problemas {#troubleshooting}

| Error                            | Causa y solución                                                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No hay herramientas de escritura | El servidor se inició sin `--write` o la clave no tiene el permiso.                                                                                                                                                          |
| `repository_not_allowed`         | El repositorio no está en `--write-repositories`. Cambie la configuración de MCP.                                                                                                                                            |
| `forbidden`                      | La clave no tiene el permiso. Ejecute `arkvoryctl doctor` para ver los permisos.                                                                                                                                             |
| `path_outside_root`              | El archivo está fuera de `--root` o no es un archivo normal.                                                                                                                                                                 |
| `state_locked`                   | La misma subida sigue en curso en otra llamada. Tras un fallo, compruebe que ningún `arkvoryctl mcp` está subiendo ese archivo y elimine el archivo `.lock` en `mcp-uploads` del directorio de la CLI (`~/.config/arkvory`). |
| `skill_modified`                 | Usted cambió un archivo de la habilidad. Conserve su copia o repita `arkvoryctl skill install` con `--force`.                                                                                                                |
