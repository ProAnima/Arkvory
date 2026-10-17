---
title: 'Eventos'
description: 'Siga cada cambio de la instalación con un solo cursor: CloudEvents, permisos, conservación y resincronización.'
---

# Eventos

El flujo de eventos le dice a un sistema externo qué cambió en toda la instalación: publicaciones, eliminaciones, rutas de archivos, registros de paquetes, anotaciones, adjuntos, etapas, promociones, imágenes de contenedor, npm y Git LFS. Es un único flujo ordenado para todos los repositorios que usted puede leer, en formato [CloudEvents 1.0](https://cloudevents.io). Léalo con `arkvoryctl events tail`, el [SDK de TypeScript](./sdk) o `GET /api/v1/events`.

Un evento es una pista de que algo cambió. Lea el estado actual con la API habitual y procese los eventos de modo que una repetición no cause daño.

## Leer el flujo {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

El comando imprime un evento por línea en JSON y guarda la posición en `--cursor-file` después de cada evento. Vuelva a ejecutarlo y continúa donde se detuvo. Añada `--follow` para esperar eventos nuevos hasta Ctrl+C. `--types artifact.*,stage.added` conserva los tipos o prefijos indicados, `--repository releases` conserva un repositorio y `--after <id>` empieza después del evento indicado.

En TypeScript, `follow` lee página tras página y llama a `save` después de cada evento que usted ha procesado:

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

Por HTTP:

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

La respuesta contiene `items`, `next`, `head`, `oldest` y `epoch`. Pase `next` como `after` en la siguiente solicitud. Sin `after`, el flujo empieza en el evento más antiguo que conserva el servidor. Una solicitud devuelve hasta `limit` eventos (1–500, 100 por defecto). Una página con menos de `limit` eventos no es el final del flujo. Una solicitud revisa como máximo 5000 eventos, así que ha leído todo cuando la posición de `next` es igual a `head`. Consulte [listEvents](../api/reference/events#listEvents).

## El evento {#event}

```json
{
  "specversion": "1.0",
  "id": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f:42",
  "source": "/arkvory/studio/repositories/releases",
  "type": "arkvory.artifact.published.v1",
  "subject": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
  "time": "2026-10-17T09:30:00.000Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:arkvory:event:artifact.published:1",
  "partitionkey": "repository:releases",
  "arkvoryposition": "42",
  "arkvoryepoch": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f",
  "data": {
    "repository": "releases",
    "artifactId": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
    "name": "game.upack",
    "size": "73400320",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "labels": ["ci"],
    "stages": []
  }
}
```

- `id` es el mismo en cada repetición de un evento: deduplique por él.
- `data` contiene identificadores y datos del artefacto: el nombre, el tamaño como cadena decimal, SHA-256, las etiquetas y etapas en el momento del evento y el paquete UPack. Los eventos de archivos, etapas, imágenes, npm y Git LFS añaden la ruta, la etapa, la imagen con su digest o tag, el paquete npm o el id del objeto.
- Los valores de metadatos, el usuario que hizo el cambio, los secretos y el contenido de los archivos nunca están en un evento. Si las etiquetas hicieran `data` mayor de 8 KiB, se omiten y `truncated` es `true`.
- `GET /api/v1/events/types` lista cada tipo con el JSON Schema de su `data`.

| Grupo                  | Tipos                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Artefactos             | `artifact.published`, `artifact.deleted`, `artifact.promoted`, `artifact.received`  |
| Archivos y paquetes    | `asset.revision.created`, `asset.restored`, `package.registered`                    |
| Descripciones          | `annotation.updated`, `attachments.updated`, `stage.added`, `stage.removed`         |
| Imágenes de contenedor | `oci.manifest.pushed`, `oci.manifest.deleted`, `oci.tag.updated`, `oci.tag.deleted` |
| npm y Git LFS          | `npm.version.published`, `npm.tag.updated`, `npm.tag.deleted`, `lfs.object.stored`  |

## Orden y permisos {#order}

- Los eventos de un repositorio llegan en el orden en que se confirmaron sus cambios (`partitionkey`). Entre repositorios, las posiciones muestran el orden en que los eventos se hicieron visibles, no causa y efecto.
- Las posiciones crecen, pero pueden saltar números. No espere que sean consecutivas.
- Un evento aparece en el flujo alrededor de medio segundo después de su cambio, cuando el worker le asigna un número. Mientras el worker está detenido, los eventos esperan y no se pierde nada.
- Usted ve los eventos de los repositorios donde su clave o cuenta tiene `artifact.list`, el mismo permiso que para el [flujo de cambios](../api/reference/artifacts#listCatalogChanges). Los permisos se comprueban en cada solicitud, así que un permiso revocado oculta los eventos de inmediato.
- `next` también avanza más allá de los eventos que usted no puede ver, como máximo 5000 por solicitud, de modo que una clave con pocos permisos nunca se queda quieta. Solo indica que el servidor tenía otros eventos en esas posiciones.

## Conservación y restauración {#retention}

El servidor conserva los eventos 168 horas y como máximo 5 000 000 (`ARKVORY_EVENTS_RETENTION_HOURS`, `ARKVORY_EVENTS_MAX_ROWS`, consulte [Variables de entorno](../reference/environment)). El flujo es una ventana, no un historial: el historial lo guarda la auditoría del catálogo. Los eventos no forman parte de las copias de seguridad.

| Respuesta                              | Qué pasó                                                                                          | Qué hacer                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `410`, `gone/events_cursor_expired`    | Su cursor es anterior a `oldest`                                                                  | Lea el estado actual por la API y continúe desde `oldest`                    |
| `409`, `conflict/events_epoch_changed` | El servidor se restauró desde una copia de seguridad y sus posiciones empezaron una nueva `epoch` | Lea el estado actual y continúe sin cursor o desde la nueva cabeza del flujo |

Ambas respuestas incluyen `events` con los `epoch`, `oldest` y `head` actuales; un cursor es `<epoch>:<position>`. `arkvoryctl events tail` termina con el código de salida 6 y el SDK lanza el error con los mismos campos.

## Webhooks {#webhooks}

Los [webhooks](./webhooks) siguen enviando el flujo de cambios de un repositorio a una dirección HTTP. El flujo de eventos no los sustituye.
