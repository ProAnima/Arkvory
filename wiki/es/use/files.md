---
title: Archivos por ruta
description: 'Mantenga un archivo en una ruta con un historial completo, restaure versiones anteriores y agregue etiquetas, metadatos, colecciones y adjuntos.'
---

# Archivos por ruta

Un archivo por ruta es un nombre en un repositorio, como `builds/game/1.4/GameSetup.exe`, que apunta a un archivo almacenado. Cuando pone contenido nuevo en la misma ruta, la ruta apunta al archivo nuevo. El anterior permanece y puede volver a él. Use una ruta cuando las personas y los scripts necesiten una dirección estable para «el Setup.exe actual».

## Qué es una ruta {#what-it-is}

Cada archivo almacenado es un **artefacto** inmutable con un ID y un SHA-256. Una ruta es un puntero a un artefacto. Cada cambio del puntero es una **revisión**, numerada desde 1. Las revisiones nunca se eliminan ni se editan.

Una ruta tiene de 1 a 1024 caracteres. Está formada por segmentos separados por `/`. Un segmento no está vacío, no es `.` ni `..` y no tiene caracteres de control. Una ruta no puede contener `\` ni `:`. Se distingue mayúsculas de minúsculas.

Una ruta y un paquete son dos vistas de los mismos artefactos: un archivo UPack también puede tener una ruta. Consulte [Paquetes UPack](./packages).

## Poner un archivo en una ruta {#put}

Necesita las acciones `upload.create`, `upload.write` y `upload.complete`, y `asset.read`, `asset.write` y `artifact.read`. En términos de grupos, necesita acceso de escritura. Consulte [Permisos](./accounts#permissions).

### Con arkvoryctl {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put` sube el archivo en partes, con un punto de control junto al archivo de origen, y lo convierte en la siguiente revisión de la ruta. Imprime la `path`, la `revision`, el `id` del artefacto y `created`. Si la ruta ya contiene los mismos bytes, `put` no sube nada e imprime `created` como `false`: un paso de compilación repetido no cuesta nada. Si alguien cambió la ruta mientras usted subía, `put` se detiene con `revision_mismatch` (código de salida 6) y no sobrescribe su trabajo. Lea el historial y decida. Si una subida se detiene, ejecute el mismo comando otra vez. Consulte [Subidas y descargas](./transfers#resume).

`get` descarga la revisión actual con reanudación y una comprobación SHA-256. No hay ningún comando para listar rutas ni para leer el historial. Use la consola o la API para eso.

### Con una solicitud HTTP {#put-http}

Un `PUT` raw almacena los bytes en la ruta en una sola solicitud, como hace `curl -T`:

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

La respuesta tiene `path`, `revision`, `created` y el `artifact` con su `id`, `size` y `sha256`. Una revisión nueva responde `201`. Los mismos bytes otra vez responden `200` con `created` en false. Dos cabeceras son opcionales: `X-Checksum-Sha256` permite al servidor comprobar los bytes en una sola pasada, y `If-None-Match: *` rechaza la solicitud si la ruta ya existe. Una solicitud debe terminar en un plazo de 30 minutos. Use `put` para archivos grandes. Consulte [Archivos raw](../protocols/raw-files).

### En la consola {#put-console}

1. Suba el archivo en [[ui:upload]]. Consulte [Subidas y descargas](./transfers).
2. Abra el artefacto en [[ui:catalog]] con [[ui:open]].
3. En [[ui:assetTitle]] introduzca la [[ui:assetPath]], por ejemplo `releases/current.upack`.
4. Introduzca la [[ui:currentRevision]]: `0` para una ruta nueva, o la revisión actual que se muestra en [[ui:history]].
5. Seleccione [[ui:assign]].

El campo de revisión protege contra que dos personas cambien una ruta a la vez. Si no es la actual, el servidor rechaza con un conflicto. Cargue el historial de nuevo y reintente.

### Con la API y el SDK {#put-api}

`setAsset` apunta una ruta a un artefacto que ya subió. `expectedRevision` es `0` para crear la ruta, y la revisión actual en caso contrario.

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

Un conflicto responde `409 revision_mismatch`. No reintente con una revisión adivinada. Tras una respuesta perdida, lea la ruta: si el artefacto nuevo ya está allí, ha terminado.

## Leer una ruta {#read}

- `arkvoryctl get PATH OUTPUT` descarga el archivo actual.
- `GET /api/v1/repositories/<repository>/raw/<path>` y `GET /api/v1/repositories/<repository>/asset/content?path=<path>` devuelven los bytes. Ambos necesitan `content.read` y admiten rangos y el ETag.
- `getAsset` (`GET …/asset?path=`) devuelve el puntero: `path`, `revision`, `artifactId`.
- `listAssetPage` (`GET …/assets/page?prefix=`) lista punteros. Las páginas contienen hasta 100 (50 de forma predeterminada) en orden de bytes de la ruta UTF-8. El prefijo es literal y distingue mayúsculas de minúsculas. Pase `next` como `after`. El antiguo `listAssets` devuelve hasta 1000 y le pide que reduzca el prefijo.

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## Revisiones e historial {#history}

En la consola abra [[ui:history]], escriba la ruta en [[ui:assetPath]] y seleccione [[ui:historyLoad]]. La tabla muestra la [[ui:revision]], el momento ([[ui:date]]), el autor ([[ui:actor]]) y, para las revisiones restauradas, la revisión de la que provienen ([[ui:source]]). La más reciente es la primera. [[ui:historyMore]] carga las más antiguas, 50 a la vez. [[ui:open]] en una fila abre el artefacto de esa revisión, desde donde puede descargar su contenido original.

Con la API, `getAssetHistory` (`…/asset/history?path=&before=`) devuelve las páginas, de la más reciente a la más antigua, y `before` es la última revisión de la página anterior. `getAssetRevision` (`…/asset/revision?path=&revision=`) devuelve una revisión. El autor y el momento están vacíos para las revisiones escritas antes de que el historial los registrara. Leer necesita `asset.read`.

## Restaurar una revisión anterior {#restore}

Restaurar hace que la ruta apunte al artefacto de una revisión anterior. No copia bytes ni elimina ninguna revisión: la restauración es una revisión nueva y más reciente, y el historial muestra de dónde proviene.

En la consola, cargue el historial y seleccione el botón de restaurar de la revisión que quiera. El botón de la revisión actual está desactivado. Restaurar necesita `asset.restore`, `asset.read` y `artifact.read`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

`expectedRevision` es la última revisión que vio. Si la ruta cambió mientras tanto, el servidor responde `409 revision_mismatch`; la consola muestra un mensaje y le pide que recargue el historial. Una restauración no recupera las etiquetas ni los metadatos antiguos: permanecen como están ahora.

## Etiquetas, metadatos y colecciones {#labels}

Cada artefacto lleva tres tipos de anotaciones. Puede cambiarlas en cualquier momento. El archivo en sí nunca cambia.

| Tipo        | Ejemplo                                        | Reglas                                                                                                                                           |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Etiquetas   | `test`, `staging`, `release`, `linux`          | Hasta 32. Cada una de 1 a 64 letras, dígitos, `_`, `.`, `:` o `-`. Se distingue mayúsculas de minúsculas                                         |
| Metadatos   | `build.number` = `42`, `git.commit` = `abc123` | Hasta 32 campos de texto. Una clave empieza por una letra y tiene hasta 64 letras, dígitos, `_`, `.` o `-`. Un valor tiene hasta 1024 caracteres |
| Colecciones | `desktop`, `nightly`                           | Hasta 32. Las mismas reglas que las etiquetas. Agrupan artefactos, sea cual sea su versión o ruta                                                |

Las etiquetas son texto libre. No dan acceso ni mueven ningún archivo. La consola sugiere [[ui:labelPresets]] (`nightly`, `test`, `staging`, `release`), pero cualquier etiqueta es válida, y `relase` no se corrige. Para una aprobación en la que los despliegues confíen, use una etapa ([Etapas y promoción](./promotion)).

**Consola.** Abra el artefacto en [[ui:metadata]]. Introduzca [[ui:labels]] y [[ui:collections]] separados por comas. Use [[ui:metadataAdd]] para un campo en [[ui:metadataFields]]: una [[ui:metadataKey]] y un [[ui:metadataValue]]. [[ui:metadataJson]] edita los mismos datos como JSON. Seleccione [[ui:save]].

**arkvoryctl.** Al subir, `--label test` agrega una etiqueta, y `--file metadata.json` da `labels` y `metadata`:

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

Para cambiar un artefacto existente, léalo y después envíe el estado nuevo completo con la revisión que leyó:

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

`annotations.json` debe tener las tres claves: `labels`, `metadata` y `collections`. Todo lo que omita queda vacío. Una grabación reemplaza el conjunto completo. Si alguien grabó primero, el servidor responde `409 revision_mismatch`: lea de nuevo y decida. El SDK no repite esas grabaciones.

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

Necesita `annotation.read` para leer y `annotation.write` con `artifact.read` para escribir.

**Búsqueda.** En [[ui:catalog]], escriba texto en [[ui:search]]: coincide con el nombre del archivo y los valores de metadatos, sin distinguir mayúsculas de minúsculas. [[ui:labelFilter]] muestra una etiqueta. [[ui:metadataFilter]] coincide con una clave y un valor exactamente, incluido el uso de mayúsculas. Con `arkvoryctl`:

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

`--metadata-key` y `--metadata-value` van juntos. Las páginas contienen hasta 100 resultados. Pase `next` como `--after`. Los filtros se combinan con AND.

## Adjuntos {#attachments}

Los adjuntos vinculan otros archivos a una compilación: un manifiesto, un SBOM, una firma, un informe o cualquier archivo. Un adjunto es un nombre y un enlace a otro artefacto del mismo repositorio. La compilación y el adjunto siguen siendo archivos separados.

| Regla           | Valor                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipos           | `manifest`, `sbom`, `signature`, `report`, `file`                                                                                               |
| Por compilación | Como máximo 32                                                                                                                                  |
| Nombre          | 1 a 240 caracteres, único dentro de la compilación (sin distinguir mayúsculas), sin `/`, `\`, caracteres de control ni espacios en los extremos |
| Descripción     | Hasta 512 caracteres, puede estar vacía                                                                                                         |
| Destino         | Un artefacto publicado del mismo repositorio. No la compilación en sí                                                                           |

El tipo solo indica para qué sirve el archivo. Arkvory no comprueba una firma, no lee un SBOM ni ejecuta un manifiesto.

En la consola, abra el artefacto. En [[ui:attachmentsTitle]] expanda el formulario [[ui:attachmentAdd]]. Elija el [[ui:attachmentSource]]: [[ui:attachmentUpload]] envía un archivo nuevo y lo vincula, [[ui:attachmentExisting]] vincula un artefacto que ya está publicado. Elija el [[ui:attachmentKind]]: [[ui:attachmentManifest]], [[ui:attachmentSbom]], [[ui:attachmentSignature]], [[ui:attachmentReport]] o [[ui:attachmentFile]]. Dele un [[ui:attachmentName]] y, si lo desea, una [[ui:attachmentDescription]]. Después seleccione [[ui:attachmentAdd]]. [[ui:attachmentUnlink]] elimina un vínculo y conserva el archivo. [[ui:attachmentReload]] vuelve a leer la lista. Si la subida de un adjunto se interrumpe, [[ui:attachmentRecovery]] muestra el ID de la subida con el que continuar.

Cada cambio de la lista es una versión numerada. [[ui:attachmentHistory]] muestra las anteriores, y [[ui:attachmentRestore]] devuelve una de ellas como una versión nueva.

Con `arkvoryctl`, el archivo contiene la lista completa como un array JSON:

```json
[
  {
    "name": "build.json",
    "kind": "manifest",
    "artifactId": "64b42380-902d-41cf-9151-10c12e4809dc",
    "description": "Build provenance from CI"
  }
]
```

```bash
arkvoryctl attachments get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl attachments set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 0 --file attachments.json
arkvoryctl attachments history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`--revision` es el número que leyó con `get`; una compilación nueva tiene `0`. Con la API, `replaceBuildAttachments` acepta `expectedRevision` e `items`; `getBuildAttachments` y `getBuildAttachmentHistory` leen. Para descargar un adjunto, use el `artifactId` de su vínculo con la descarga normal. Leer necesita `annotation.read`, cambiar necesita `annotation.write` con `artifact.read`, y la subida del archivo adjunto necesita las acciones de subida.

Los adjuntos y las rutas no viajan con una promoción a otro repositorio. Consulte [Etapas y promoción](./promotion).

## Páginas relacionadas {#related-pages}

- [Archivos raw](../protocols/raw-files)
- [Subidas y descargas](./transfers) y [Paquetes UPack](./packages)
- [Línea de comandos (arkvoryctl)](../protocols/cli)
- Referencia de la API: [Archivos por ruta](../api/reference/files), [Artefactos y catálogo](../api/reference/artifacts), [Adjuntos de compilación](../api/reference/attachments)
