---
title: Subidas y descargas
description: 'Envíe y obtenga archivos de cualquier tamaño, continúe tras una interrupción, compruebe las sumas de comprobación y comparta un archivo sin clave.'
---

# Subidas y descargas

Los archivos de cualquier tamaño llegan a Arkvory en partes, y una transferencia que se detiene puede continuar desde donde se detuvo. Esta página muestra cómo hacerlo en la consola, con `arkvoryctl`, con el SDK y con la API HTTP.

Una subida necesita las acciones `upload.create`, `upload.read`, `upload.write` y `upload.complete`. En términos de grupos, necesita acceso de escritura. Una descarga necesita `content.read`. Consulte [Permisos](./accounts#permissions).

## Subir un archivo {#upload}

Cada subida sigue los mismos pasos. El cliente calcula el SHA-256 del archivo completo e inicia una sesión de subida con el nombre del archivo, el tamaño y la suma de comprobación. Envía el archivo en partes. Cuando ya están todas las partes, el servidor las ensambla, comprueba la suma de comprobación y publica el archivo como un artefacto inmutable.

### En la consola {#upload-console}

1. Seleccione [[ui:upload]] en la barra lateral, o [[ui:uploadFile]] en la barra superior.
2. Elija el archivo en [[ui:chooseFile]]. La consola lee el archivo completo una vez para calcular su suma de comprobación ([[ui:hashing]]). Para un archivo de decenas de gigabytes, esto tarda un rato antes de que se envíe el primer byte.
3. Seleccione [[ui:startUpload]]. La barra bajo [[ui:transferTitle]] muestra el progreso.
4. Cuando se publica el archivo, se muestra su ID. Abra [[ui:catalog]] para verlo.

[[ui:pause]] detiene la transferencia y conserva las partes que llegaron. El navegador le avisa antes de que salga de la página durante una subida. La consola no envía etiquetas ni metadatos con el archivo. Agréguelos después en [[ui:metadata]]; consulte [Archivos por ruta](./files#labels).

### Con arkvoryctl {#upload-cli}

```bash
arkvoryctl upload ./Build/Game.zip --label test
arkvoryctl upload ./Build/Game.zip --file metadata.json --state ./job-state/game.json
arkvoryctl uploads status 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl uploads cancel 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`upload` imprime el artefacto cuando se publica. `--label` agrega una etiqueta. `--file` apunta a un archivo JSON con `labels` y `metadata`, y tiene prioridad. Para almacenar el archivo bajo una ruta, use `put`; para publicar un UPack, use `packages publish`. Consulte [Línea de comandos](../protocols/cli#transfers).

### Con el SDK {#upload-sdk}

```typescript
const session = await releases.uploads.create(idempotencyKey, {
  name: 'Game.zip',
  size: String(file.size),
  sha256,
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const artifact = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(bytes),
});
```

`resume` envía las partes que el servidor no tiene y completa la subida. El ejemplo completo, con el cálculo del hash en Node.js, está en el [SDK de TypeScript](../protocols/sdk#upload-a-large-file-with-resume-node-js).

### Con la API HTTP {#upload-http}

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Idempotency-Key: game-1234" \
  -H "Content-Type: application/json" \
  -d '{"name":"Game.zip","size":"73400320","sha256":"<64 hex digits>"}'

curl "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts" -H "Authorization: Bearer $ARKVORY_KEY"

curl -X PUT "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts/0" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/octet-stream" \
  -H "X-Content-SHA256: <64 hex digits of this part>" --data-binary @part-0.bin

curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads/$ID/complete" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

El tamaño es una cadena decimal. La `Idempotency-Key` tiene de 1 a 128 letras, dígitos, `.`, `_`, `:` o `-`. La respuesta a la primera llamada tiene el `id` de la subida y `expiresAt`. La segunda llamada devuelve el tamaño de parte `partBytes` y las partes que ya están almacenadas. Cada parte tiene exactamente ese tamaño salvo la última. Las operaciones son `createUpload`, `listUploadParts`, `putUploadPart` y `completeUpload` ([Subidas](../api/reference/uploads)).

Para un archivo pequeño puede usar dos formas más simples. `PUT /uploads/{id}/content` envía el archivo completo en una sola solicitud. `PUT /raw/<path>` crea la sesión, envía los bytes y los almacena en una ruta en una sola solicitud, como hace `curl -T`. Ambas solicitudes deben terminar en un plazo de 30 minutos. Use partes para todo lo que sea grande o lento. Consulte [Archivos raw](../protocols/raw-files). Un archivo vacío va en una sola solicitud.

## Qué tamaño puede tener un archivo {#limits}

| Límite             | Valor                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tamaño de parte    | 8 MiB para archivos de hasta unos 78 GiB. Los archivos más grandes usan 16, 32, 64 MiB y así sucesivamente, hasta 1 GiB, de modo que un archivo nunca necesita más de 10 000 partes. |
| Partes por subida  | 10 000 (índices 0 a 9999)                                                                                                                                                            |
| Archivo más grande | 10 000 partes de 1 GiB, unos 10 TiB                                                                                                                                                  |
| Límite inferior    | El administrador puede establecer uno con `ARKVORY_MAX_OBJECT_BYTES`                                                                                                                 |
| Nombre de archivo  | 1 a 240 caracteres, sin `/`, `\` ni caracteres de control                                                                                                                            |

El servidor elige el tamaño de parte cuando se crea la subida y lo mantiene durante toda la subida. `GET /api/v1/capabilities` muestra `maxObjectBytes`, `partBytes`, `maxPartBytes` y `maxParts`. La consola rechaza un archivo por encima del límite del servidor antes de empezar.

Un cliente mantiene una parte en memoria mientras la procesa y la envía. Para archivos de más de 78 GiB, la parte, y por tanto la memoria, crece hasta 1 GiB.

El espacio libre en disco del servidor debe contener las partes y el archivo ensamblado durante un tiempo. Si el disco está lleno, el servidor rechaza la subida con `507 storage_full`.

## Reanudar una subida {#resume}

Una sesión de subida conserva sus partes tras un fallo. Para continuar, proporcione al cliente el mismo archivo y la misma sesión.

**Consola.** Dentro de la pestaña abierta, seleccione [[ui:startUpload]] de nuevo tras [[ui:pause]]. Después de cerrar la pestaña, conserve el ID de la subida. Expanda [[ui:resumeTitle]]: el campo [[ui:uploadId]] muestra el ID mientras se ejecuta la subida. Más tarde, elija el mismo archivo, introduzca allí el ID y seleccione [[ui:startUpload]]. La consola compara las partes con su archivo. Si el archivo difiere, se detiene y se lo indica. [[ui:newUpload]] borra ambos campos e inicia una subida nueva.

El campo [[ui:idempotency]] es una segunda forma de volver. La consola lo rellena por sí sola. La misma clave con el mismo archivo devuelve la misma sesión en lugar de una segunda.

**arkvoryctl.** Ejecute el mismo comando con las mismas opciones. El cliente guardó un punto de control `<file>.arkvory-upload.json` junto al archivo de origen, o el archivo indicado en `--state`, antes de la primera solicitud. Para publicar los mismos bytes como un artefacto nuevo, use un `--state` nuevo. En CI, conserve el archivo de origen y la carpeta de estado entre los reintentos. Un cambio del archivo, del servidor, del repositorio o de las opciones da `checkpoint_mismatch` (código de salida 6).

**SDK.** Llame a `resume` de nuevo con el ID de sesión guardado y el mismo archivo. Para recuperarse cuando se perdió incluso la respuesta a `create`, llame a `create` con la misma clave de idempotencia y el mismo descriptor: devuelve la misma sesión.

**HTTP.** Lea las partes almacenadas con `listUploadParts` y después envíe los índices que falten. Volver a enviar una parte con los mismos bytes es seguro. Otros bytes para un índice almacenado se rechazan con `409 upload_state`.

Los clientes también repiten una solicitud por sí solos tras un fallo de red o tras `408`, `429`, `502`, `503` y `504`: hasta 20 veces por operación, con una pausa que crece de 0,5 a 60 segundos y respeta `Retry-After`. `arkvoryctl` tiene las opciones `--retries` y `--attempt-timeout` para enlaces lentos.

Solo la cuenta o la clave que creó una subida puede continuarla. Para cualquier otra persona no existe. Rotar una clave de servicio conserva la cuenta, así que la nueva clave continúa la subida.

## Sumas de comprobación {#checksums}

- **Antes de la subida.** La consola, el CLI y el SDK calculan el SHA-256 del archivo y lo envían en la sesión.
- **Cada parte.** La cabecera `X-Content-SHA256` contiene la suma de comprobación de la parte. Una parte cuyos bytes no coinciden se rechaza con `422 integrity_mismatch` y no se almacena.
- **Al final.** El servidor comprueba el tamaño y el SHA-256 del archivo ensamblado contra la sesión antes de publicarlo. Una discrepancia es `422 integrity_mismatch`; el CLI sale con el código 5. El artefacto no aparece.
- **Descargas.** La consola, el CLI y el SDK comprueban el SHA-256 del archivo completo antes de entregarlo. El archivo final aparece solo después de que la comprobación se supere.

El ETag de un archivo es su suma de comprobación: `"sha256:<64 hex digits>"`. Los detalles del artefacto muestran el SHA-256 y [[ui:copyHash]] lo copia.

## Trabajo de finalización {#completion}

Ensamblar un archivo grande lleva tiempo. Para archivos de menos de 16 GiB, `completeUpload` los ensambla dentro de la solicitud, lo que puede tardar hasta 30 minutos. A partir de 16 GiB, el SDK, y por tanto la consola y el CLI, piden al proceso de trabajo (worker) que lo termine: `enqueueCompletion` responde `202` con una tarea, y el cliente consulta `getCompletionJob` hasta que el estado es `completed` o `failed`. Una tarea fallida tiene un código de error, por ejemplo `integrity_mismatch`.

El servicio de trabajo (worker) debe estar en ejecución para las tareas. Intenta una tarea hasta 5 veces, con una pausa creciente, y se rinde de inmediato ante errores que un reintento no puede corregir. Un `enqueueCompletion` repetido devuelve la misma tarea. Si el servidor se reinicia, la tarea continúa. No tiene que iniciar la subida de nuevo.

## Caducidad de la subida {#expiry}

Una sesión de subida sin terminar caduca 7 días después de crearse. El momento está en `expiresAt`, no se amplía y no cambia cuando envía partes. Después, las partes y `complete` se rechazan con `409 upload_expired`. Inicie una subida nueva. Los archivos publicados nunca caducan.

El servidor elimina las sesiones caducadas y sus partes en segundo plano. Para abandonar una antes, use `arkvoryctl uploads cancel ID` o `cancelUpload`. Cancelar no es pausar: las partes se descartan.

## Descargar un archivo {#download}

### En la consola {#download-console}

Seleccione [[ui:download]] junto a un archivo en [[ui:catalog]], o en los detalles del artefacto. El navegador pregunta dónde guardar el archivo. El archivo pasa a la cola en [[ui:downloads]]. La cola escribe los datos en una copia temporal, comprueba el SHA-256 y solo entonces reemplaza el archivo de destino.

La cola necesita Chrome o Edge sobre HTTPS o en el equipo local, porque escribe un archivo grande mediante el acceso al sistema de archivos del navegador. Otros navegadores deberían usar el CLI o el SDK.

Los estados de una descarga son [[ui:downloadQueued]], [[ui:downloadRunning]], [[ui:downloadRetrying]], [[ui:downloadPaused]], [[ui:downloadSaving]], [[ui:downloadCompleted]], [[ui:downloadFailed]] y [[ui:downloadCancelled]]. Los botones son:

| Botón                                          | Efecto                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [[ui:downloadResume]]                          | Continuar una descarga pausada o fallida desde la parte guardada |
| [[ui:downloadCancel]]                          | Cancelar una descarga y eliminar su copia temporal               |
| [[ui:downloadsPause]] / [[ui:downloadsResume]] | Retener y liberar toda la cola                                   |
| [[ui:downloadsClearWaiting]]                   | Cancelar las descargas que esperan                               |
| [[ui:downloadsCancel]]                         | Cancelar todas las descargas                                     |
| [[ui:downloadsClearFinished]]                  | Quitar las filas terminadas para hacer sitio (la cola admite 64) |
| [[ui:downloadRestore]]                         | Tras recargar la página, recuperar las descargas sin terminar    |

[[ui:downloadSettings]] tiene [[ui:downloadConcurrency]] (1 a 8, predeterminado 2), [[ui:downloadInterval]] (0 a 60 000 ms, predeterminado 250) y [[ui:downloadWait]] (1 a 1800 segundos, predeterminado 300). Seleccione [[ui:downloadApply]] para aplicarlos. No elevan los límites del servidor.

Después de recargar o de cerrar la pestaña, inicie sesión de nuevo en el mismo servidor con la misma cuenta, abra [[ui:downloads]] y seleccione [[ui:downloadRestore]]. Las descargas restauradas esperan en pausa. Seleccione [[ui:downloadResume]] en cada una y vuelva a elegir el archivo de destino. El navegador necesita espacio libre para la copia temporal.

### Con arkvoryctl {#download-cli}

```bash
arkvoryctl download 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game.zip
arkvoryctl get builds/game/1.4/Game.zip ./Game.zip
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

Mientras se ejecuta una descarga, `<output>.arkvory-part` y `<output>.arkvory-download.json` permanecen junto al destino. Ejecute el mismo comando otra vez tras una interrupción. El archivo final aparece solo después de la comprobación del SHA-256. Un destino existente nunca se sobrescribe (`destination_exists`, código de salida 6).

### Con HTTP: rangos y ETag {#download-http}

`downloadArtifact` devuelve los bytes de un artefacto. `HEAD` devuelve solo las cabeceras.

```bash
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -C - -o Game.zip \
  "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/content"
```

- `Accept-Ranges: bytes`. Envíe `Range: bytes=1048576-`, `bytes=0-1023` o `bytes=-500` para un rango. La respuesta es `206` con `Content-Range`. No se admiten varios rangos a la vez: el servidor envía el archivo completo. Un inicio más allá del final da `416`.
- `ETag` es `"sha256:<hex>"`. `If-None-Match` con él da `304`. `If-Range` con él continúa un rango solo cuando el archivo sigue siendo el mismo; de lo contrario, llega el archivo completo.
- `curl -C -` reanuda una descarga. Las direcciones por nombre se resuelven en cada solicitud, por ejemplo `packages/content?name=app&range=^1.4`, así que el archivo puede cambiar entre dos llamadas. Para reanudarlas de forma segura, envíe el ETag que obtuvo en `If-Range`, o resuelva el nombre primero y descargue por el ID del artefacto.

El SDK lee el contenido en rangos de 8 MiB y verifica cada uno. Consulte el [SDK de TypeScript](../protocols/sdk#download-with-verification).

## Enlaces para personas sin clave {#links}

Un enlace de descarga permite a alguien obtener un archivo sin ninguna clave: un probador, un cliente, una máquina de compilación que no guarda credenciales. El enlace abre solo ese artefacto, para `GET` y `HEAD`, hasta que caduca. Funciona con `curl -C -` y con rangos.

En la consola, abra el artefacto en [[ui:metadata]] y seleccione [[ui:downloadLink]]. La consola copia el enlace y lo muestra, con su caducidad. El enlace dura una hora. El botón aparece solo si puede descargar el archivo.

```bash
arkvoryctl link 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --ttl 900
```

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/links" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"ttlSeconds":900}'
```

La vigencia es de 60 segundos a 24 horas (86 400 segundos) y una hora de forma predeterminada. La respuesta tiene un `token` que empieza por `dtl_`, una `url` y `expiresAt`. El CLI y el SDK imprimen una URL completa. La API devuelve la ruta, que usted añade a la dirección del servidor.

El enlace es un secreto. Quien lo tenga puede descargar el archivo. No puede revocar un enlace antes de que caduque, así que haga que sea corto. Trate la URL como una clave: manténgala fuera de las salas de chat y de los registros públicos. Los registros del proxy y el historial del navegador pueden registrarla. Consulte [Enlaces de descarga](../api/reference/links).

## Límites y colas {#queues}

El administrador establece cuántas transferencias ejecuta el servidor a la vez y a qué velocidad. De forma predeterminada, un servidor ejecuta 2 subidas y 16 descargas al mismo tiempo, y una cuenta ejecuta 1 subida y 4 descargas. Las demás esperan en una cola hasta 20 segundos. Si la cola está llena o la espera termina, el servidor responde `503` con `Retry-After`, y los clientes esperan y reintentan. Un presupuesto de bytes por segundo, cuando está definido, hace las transferencias más lentas pero no las detiene. Los usuarios no pueden ver ni cambiar estos presupuestos. Los valores están en [Variables de entorno](../reference/environment#transfers-and-bandwidth).

## Errores {#errors}

| Respuesta                  | Motivo                                                                            | Qué hacer                                                     |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `409 upload_expired`       | La sesión tiene más de 7 días                                                     | Inicie una subida nueva                                       |
| `409 upload_state`         | La subida ya está publicada o cancelada, o una parte almacenada tiene otros bytes | Inicie una subida nueva, o compruebe que usa el mismo archivo |
| `409 parts_incomplete`     | Algunas partes no han llegado                                                     | Reanude la subida                                             |
| `409 part_mismatch`        | Las partes no coinciden con el tamaño o los índices de parte previstos            | Tome el tamaño de parte de `listUploadParts` y reanude        |
| `409 idempotency_mismatch` | La clave se usó para otro archivo                                                 | Use una clave nueva                                           |
| `422 integrity_mismatch`   | Una suma de comprobación no coincide                                              | Envíe el archivo original de nuevo                            |
| `507 storage_quota`        | La cuota del repositorio está agotada                                             | Elimine compilaciones antiguas o pida una cuota mayor         |
| `507 storage_full`         | El disco del servidor está lleno                                                  | Llame al administrador                                        |
| `503` con `Retry-After`    | El servidor está ocupado                                                          | Espere, los clientes reintentan por sí solos                  |

La lista completa está en [Errores](../api/errors).

## Páginas relacionadas {#related-pages}

- [Línea de comandos (arkvoryctl)](../protocols/cli) y [SDK de TypeScript](../protocols/sdk)
- [Archivos por ruta](./files) y [Paquetes](./packages)
- Referencia de la API: [Subidas](../api/reference/uploads), [Enlaces de descarga](../api/reference/links), [Artefactos](../api/reference/artifacts)
