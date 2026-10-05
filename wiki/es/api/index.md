---
title: 'Descripción general de la API HTTP'
description: 'Las reglas que toda integración con la API HTTP de Arkvory necesita: JSON y tamaños, descubrimiento, paginación, revisiones, idempotencia, reintentos, rangos, errores y límites.'
---

# Descripción general de la API HTTP

La API HTTP es la interfaz que usan la consola web, el cliente de línea de comandos y el SDK. Todo lo que ellos hacen, su integración puede hacerlo en cualquier lenguaje. Esta página explica las reglas que se aplican a todas las operaciones. Las páginas de [Páginas de referencia](#reference-pages) enumeran cada operación con su regla de acceso, su regla de reintento, sus parámetros y sus respuestas, y se generan a partir del contrato que el servidor aplica.

## Conceptos básicos {#basics}

- **Ruta base.** Toda operación está bajo `/api/v1`, por ejemplo `https://arkvory.example/api/v1/repositories`. Las únicas excepciones son las comprobaciones de estado bajo `/health`.
- **Formato.** Las solicitudes y las respuestas son JSON (`application/json`). Un cuerpo JSON está limitado a 64 KiB, y una solicitud que envía otro tipo de contenido para una operación JSON recibe `415`. Los bytes de los archivos se envían como `application/octet-stream`.
- **Campos desconocidos.** La mayoría de las operaciones rechaza una solicitud que lleva un campo que no definen (`400`, con el campo en `details`). En las respuestas, ignore los campos que no conozca.
- **Las horas** son marcas de tiempo RFC 3339 en UTC. Los **ID** de artefactos, subidas, trabajos, cuentas y claves son UUID.
- **Nombres.** Un nombre de repositorio coincide con `[a-z0-9][a-z0-9_-]{0,63}`. Un nombre de archivo (el nombre del artefacto) tiene hasta 240 caracteres y ningún `/` ni `\`. Una ruta dentro de un repositorio tiene hasta 1.024 caracteres.
- **Caché.** Las respuestas llevan `Cache-Control: private, no-store`.
- **Otros protocolos.** Las rutas `/v2` (contenedores), `/lfs` (Git LFS) y `/npm` siguen las especificaciones de sus propios clientes y usan sus propios formatos de error. No forman parte del documento OpenAPI. Véase [Clientes y protocolos](../protocols/index).

### Tamaños y recuentos {#sizes}

Un número JSON no puede transportar todos los valores de 64 bits. Por eso Arkvory envía **los tamaños y los contadores de bytes como cadenas decimales**: `"size": "1048576"`. Lo mismo vale para el tamaño que declara al crear una subida. Un tamaño no lleva signo, ni ceros a la izquierda, ni más de 16 dígitos. Los recuentos, las revisiones, los límites y los índices de parte son enteros JSON normales.

El objeto más grande es 10.000 GiB (10 737 418 240 000 bytes) salvo que el administrador fije un `ARKVORY_MAX_OBJECT_BYTES` menor. Un tamaño declarado mayor se rechaza con `400`.

## Autenticación {#authentication}

Toda operación, excepto el inicio de sesión, las comprobaciones públicas de estado y las opciones de inicio de sesión, necesita una credencial en el encabezado `Authorization: Bearer <credential>`. La credencial es una sesión de consola, un token de acceso personal, una clave de servicio o la clave de recuperación. Lo que una credencial puede hacer depende de su tipo y de la **regla de acceso** de cada operación. Lea [Autenticación](./authentication) antes de diseñar la integración, y dé a la automatización una clave de servicio con solo las acciones que necesita.

## Descubrimiento {#discovery}

Un cliente puede preguntar al servidor qué admite en lugar de adivinarlo. Todo esto necesita una credencial.

| Solicitud                      | Respuesta                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/capabilities`     | Las versiones de la API (`v1`), el rol de la puerta de enlace (`api` o `reader`), las banderas de funciones y los límites de este servidor: `maxObjectBytes`, `partBytes` (la parte más pequeña, 8 MiB), `maxPartBytes` (1 GiB), `maxParts` (10.000) y `maxPageSize` (100).                                                        |
| `GET /api/v1/operations`       | Las operaciones que esta credencial puede probablemente llamar, cada una con su `operationId`, método, ruta, `surface`, clase de `retry`, acciones requeridas y condiciones restantes. Filtre con `repository`, `surface`, `after` y `limit` (de 1 a 100, 50 por defecto). La lista es orientativa: solo la solicitud real decide. |
| `GET /api/v1/openapi.json`     | El documento OpenAPI 3.0.3 de la API de escritura. Añada `?surface=<name>` para obtener solo una superficie.                                                                                                                                                                                                                       |
| `GET /api/v1/auth/permissions` | Las acciones de la credencial que llama, por repositorio.                                                                                                                                                                                                                                                                          |
| `GET /api/v1/auth/me`          | Quién es la credencial, su tipo y sus permisos generales `read`/`write`.                                                                                                                                                                                                                                                           |
| `GET /api/v1/repositories`     | Los repositorios que la credencial puede ver.                                                                                                                                                                                                                                                                                      |

Use `capabilities` para leer los límites en lugar de fijarlos en el código. Trate una bandera de función que no conozca como `false`.

### Superficies {#surfaces}

Las operaciones se agrupan en seis **superficies**. Son etiquetas del contrato, no servicios separados; las URL no cambian.

| Superficie       | Qué abarca                                                                           |
| ---------------- | ------------------------------------------------------------------------------------ |
| `discovery`      | Capacidades, el catálogo de operaciones, OpenAPI y repositorios                      |
| `identity`       | Inicio de sesión, la propia identidad del llamante, tokens y activación de claves    |
| `catalog`        | Artefactos, anotaciones, paquetes, archivos por ruta, etapas, promoción, adjuntos    |
| `transfers`      | Sesiones de subida, partes, trabajos de finalización y descargas                     |
| `administration` | Cuentas, grupos, cuentas de servicio, claves, delegaciones, actualizaciones y copias |
| `operations`     | Estado de vida, disponibilidad, métricas y comentarios                               |

Las comprobaciones de estado son `GET /health/live` (el proceso se ejecuta) y `GET /health/status` (pública; `{"status":"ready"}` o `unavailable`) sin credencial, y `GET /health/ready` y `GET /health/metrics` con una. No usan el presupuesto de solicitudes, así que la carga no hace que un balanceador retire el servidor.

## Paginación {#pagination}

Una lista se devuelve página a página. La respuesta tiene `items` y `next`. Cuando `next` no es `null`, devuélvalo sin cambios en el parámetro de consulta `after` para leer la página siguiente; cuando es `null`, la lista está completa. Trate un cursor como una cadena opaca y no construya uno usted mismo.

`limit` fija el tamaño de página, de 1 a 100. La mayoría de las listas devuelve 50 elementos cuando lo omite. Las páginas no son una instantánea: los elementos que llegan mientras lee pueden aparecer o no. Los filtros y el orden deben seguir siendo los mismos mientras sigue `next`.

## Revisiones y compare-and-swap {#revisions}

Las cosas que las personas editan tienen una **revisión** que cuenta desde 1: las etiquetas, los metadatos y las colecciones de un artefacto, los adjuntos de una compilación, una ruta de archivo, una política de almacenamiento, el plan de copias de seguridad y la configuración de una cuenta de servicio. Un cambio nombra la revisión que espera en el cuerpo de la solicitud, como `expectedRevision`:

```json
{ "expectedRevision": 3, "value": { "labels": ["tested"], "metadata": {}, "collections": [] } }
```

Si la revisión actual no es 3, nada cambia y el servidor responde `409` con el motivo `revision_mismatch`. Esto es **compare-and-swap**. Lea el estado de nuevo, aplique su cambio y envíe la nueva revisión. Nunca haga un bucle con un número mayor para forzar la escritura. Use `0` para algo que aún no existe, como una ruta nueva. La API no usa el encabezado `If-Match`.

Un **artefacto descargado** tiene otro validador, el `ETag`. Véase [Descargas por rangos y ETags](#range-downloads).

## Claves de idempotencia {#idempotency}

Un encabezado `Idempotency-Key` hace que una solicitud repetida surta efecto una sola vez. Use un valor de 1 a 128 caracteres de letras, dígitos y `_ . : -`, y guárdelo con el estado del trabajo antes de la primera solicitud, para que un trabajo reiniciado repita la misma clave. Estas escrituras necesitan una:

| Operación                                                           | Una repetición con la misma clave y el mismo cuerpo                                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `createUpload`                                                      | Devuelve la misma sesión de subida.                                                                               |
| `issueServiceKey` y `rotateServiceKey`                              | Devuelve los metadatos de la clave con `200`, sin el secreto. Revoque la clave y emita otra si perdió el secreto. |
| `requestBackupRun`, `requestBackupVerify`, `requestBackupRetention` | Devuelve la misma solicitud en lugar de encolar otra.                                                             |

La misma clave con un cuerpo distinto se rechaza con `409` y el motivo `idempotency_mismatch`. Una clave está limitada al llamante y al destino, así que dos llamantes pueden usar el mismo valor.

Otras escrituras es seguro repetirlas por otro motivo: fijan un estado (fijar una etapa, registrar un paquete, revocar una clave), o son compare-and-swap. La sección siguiente le dice cuáles.

## Reglas de reintento {#retry-rules}

Toda operación tiene una **clase de reintento**. La clase dice a un cliente qué hacer cuando no recibió la respuesta. La referencia la muestra como "Retry" en cada operación.

| Clase              | Significado                                      | Qué hacer                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`             | Leer no cambia nada.                             | Repita con retroceso.                                                                                                                                                                        |
| `idempotent`       | La misma solicitud tiene el mismo efecto.        | Repita. Una respuesta puede diferir en detalle: borrar dos veces puede informar de que el objeto ya no está.                                                                                 |
| `idempotency-key`  | Seguro solo con una clave.                       | Repita con la misma `Idempotency-Key` y el mismo cuerpo.                                                                                                                                     |
| `compare-and-swap` | Un cambio que depende de una revisión.           | Lea el estado, decida de nuevo y repita con la revisión que leyó. Nunca suba `expectedRevision` para pasar un `409`.                                                                         |
| `reconcile-upload` | Un paso de una sesión de subida.                 | Lea primero la subida y sus partes (`getUpload`, `listUploadParts`) y envíe lo que falte. Un `PUT` de archivo completo no puede continuar por el medio: empieza otra vez desde el byte cero. |
| `reconcile-job`    | Encolar un trabajo de finalización.              | Lea primero el trabajo (`getCompletionJob`). Un trabajo fallido puede encolarse de nuevo.                                                                                                    |
| `never-automatic`  | Una repetición podría hacer la acción dos veces. | No repita automáticamente. Compruebe el resultado y decida. Ejemplos: crear una cuenta, un token o un enlace de descarga, ejecutar una política de almacenamiento, enviar comentarios.       |

Un fallo de red y los estados `408`, `429`, `502`, `503` y `504` son temporales: repita según la clase, espere al menos lo que indique `Retry-After` y añada un retroceso exponencial con un límite de intentos. No repita `401`, `403` ni otras respuestas `4xx` sin cambiar la solicitud. No repita `500` a ciegas; dé el ID de solicitud al soporte. Tras un `503` en un cambio, el resultado es desconocido, así que use la clase para averiguar qué pasó. El SDK y el cliente de línea de comandos aplican estas reglas.

## Descargas por rangos y ETags {#range-downloads}

`GET` y `HEAD` de `…/artifacts/{id}/content` devuelven los bytes originales con un `ETag` fuerte de la forma `"sha256:<hex>"` y `Accept-Ranges: bytes`. Lo mismo vale para las descargas por paquete (`…/packages/content`) y por ruta de archivo (`…/asset/content`, `…/raw/{path}`). Buscan el artefacto actual en cada solicitud; `packages/content` y `raw` nombran el que eligieron en `X-Arkvory-Artifact-Id`, para que pueda fijarlo y reanudar.

- `Range: bytes=0-1023`, `bytes=1024-` y `bytes=-1024` devuelven `206` con `Content-Range`. El servidor sirve un solo rango; una lista de rangos se responde con el archivo completo.
- Un inicio más allá del final del archivo devuelve `416` con el código `invalid_input`, el motivo `range_not_satisfiable` y `Content-Range: bytes */<size>`.
- Para reanudar, envíe `Range` junto con `If-Range: "<el ETag que vio>"`. Si el contenido detrás de un nombre ha cambiado, el `ETag` es distinto y recibe el archivo nuevo completo en lugar de uno mezclado.
- `If-None-Match` con el `ETag` devuelve `304` sin cuerpo.
- Verifique el SHA-256 de lo que guardó. El ETag lo lleva.

Un enlace de descarga (`?token=`) funciona en la ruta de contenido de un artefacto. Véase [Autenticación](./authentication#download-links).

## Errores {#errors}

Todo fallo tiene el mismo sobre JSON: `code`, `message`, `requestId` y, cuando hay más que decir, `reason`, `details` y `retryAfterSeconds`. Decida por `code` y `reason`, nunca por el `message`. Los motivos desconocidos cuentan como ausentes, y un `code` desconocido se maneja por su estado HTTP. Véase [Errores](./errors).

## Límites de tasa y servidores ocupados {#rate-limits}

Arkvory no mide las llamadas a la API por minuto. Limita cuánto hace a la vez y limita los intentos de adivinar una contraseña:

- **Ocupado.** El servidor admite un número fijo de solicitudes y transferencias a la vez (`ARKVORY_MAX_REQUESTS`, 128 por defecto; 2 subidas y 16 descargas por defecto). Una transferencia puede esperar en una cola limitada hasta 20 segundos. Cuando no hay sitio, la respuesta es `503` con el código `busy`. Repita tras `Retry-After`.
- **Capacidad.** Una reserva de disco llena, una cuota o un límite del número de objetos devuelve `507`, que no mejora esperando.
- **Intentos.** Demasiados intentos de inicio de sesión, registro, contraseña o comentarios devuelven `429` con el código `rate_limited`. Véase [Autenticación](./authentication#sign-in-limits).

Tanto `429` como `503` llevan el encabezado `Retry-After` en segundos (2 cuando el servidor no tiene estimación) y el mismo número en `retryAfterSeconds`. Si una solicitud pasa por un proxy, el proxy puede añadir sus propios límites.

## ID de solicitud {#request-ids}

Toda respuesta tiene un encabezado `X-Request-Id`, y todo error tiene el mismo valor en `requestId`. Regístrelo con su propio trabajo y cítelo al soporte. Un ID de solicitud que usted envíe se usa solo cuando llega a través de un proxy listado en `ARKVORY_TRUSTED_PROXIES` y tiene de 8 a 128 caracteres seguros; en caso contrario, el servidor crea uno nuevo. Un encabezado `traceparent` de W3C se registra solo en el registro de acceso del servidor.

## Navegadores y CORS {#cors}

Una página web en la misma dirección que Arkvory funciona sin ninguna configuración. Una página en otra dirección funciona solo si el administrador lista su origen exacto en `ARKVORY_CORS_ORIGINS` (hasta 16, HTTPS o HTTP de bucle local). Otro origen recibe `403` con el motivo `origin_not_allowed`, incluso cuando la clave es válida. Las solicitudes nunca usan cookies: envíe la clave en el encabezado `Authorization` y manténgala en memoria. Véase [Variables de entorno](../reference/environment).

## Promesa de compatibilidad {#evolution}

`/api/v1` cambia solo por adición: nuevas operaciones, nuevos campos opcionales de solicitud, nuevos campos de respuesta, nuevos motivos de error y nuevas banderas de funciones. Un cambio que rompería un cliente, como un significado distinto, un nuevo campo obligatorio, un estado distinto o una paginación distinta, recibe una nueva versión de la API y un período en el que ambas funcionan. En cambio, su cliente tiene que:

- ignorar los campos de respuesta que no conozca;
- tratar un `reason` desconocido como ausente y un `code` desconocido por su estado HTTP;
- tomar los límites de `capabilities`;
- enviar solo los campos que la operación define.

Los valores de `operationId` son nombres estables. Úselos cuando asocie operaciones a su propio código.

## Ejemplo: subir un archivo y descargarlo {#example}

Esta secuencia sube un archivo en una sola solicitud. Para archivos de más de unos gigabytes, o en enlaces poco fiables, use [`arkvoryctl`](../protocols/cli) o el [SDK](../protocols/sdk): envían partes y continúan tras un fallo. El ejemplo usa `jq` para leer el JSON.

Primero, fije la dirección y la clave, y calcule el tamaño y el SHA-256 del archivo:

```bash
export ARKVORY_URL=https://arkvory.example
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
FILE=./Setup.exe
SIZE=$(stat -c %s "$FILE")
SHA=$(sha256sum "$FILE" | cut -d ' ' -f 1)
```

**Paso 1. Reserve la subida.** La misma `Idempotency-Key` devuelve la misma sesión, así que puede repetir esta llamada sin riesgo.

```bash
ID=$(curl -fsS -X POST "$ARKVORY_URL/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Idempotency-Key: build-1042-setup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Setup.exe\",\"size\":\"$SIZE\",\"sha256\":\"$SHA\",\"labels\":[\"nightly\"]}" \
  | jq -r .id)
```

**Paso 2. Envíe los bytes.** El servidor publica el artefacto cuando el tamaño y el SHA-256 coinciden.

```bash
curl -fsS -X PUT "$ARKVORY_URL/api/v1/repositories/releases/uploads/$ID/content" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Content-Type: application/octet-stream" \
  -T "$FILE" | jq '{id, status}'
```

**Paso 3. Descárguelo.** El ID del artefacto es el ID de la subida.

```bash
curl -fL -o Setup-copy.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY_URL/api/v1/repositories/releases/artifacts/$ID/content"
sha256sum Setup-copy.exe
```

El paso 2 responde `{"id": "…", "status": "available"}`. Si la conexión se corta durante el paso 2, lea la subida con `GET …/uploads/$ID`: mientras su estado sea `pending`, envíe el archivo otra vez desde el principio. Una sesión de subida vive 7 días. La clave necesita las acciones `upload.create`, `upload.write`, `upload.complete` y `content.read` sobre `releases`. Véase [Subidas](./reference/uploads) y [Transferencias](../use/transfers).

## Páginas de referencia {#reference-pages}

Cada página enumera las operaciones de un grupo con su regla de acceso, su clase de reintento, sus parámetros y sus respuestas.

- [Sistema y estado](./reference/system): estado de vida, disponibilidad, métricas, OpenAPI, capacidades
- [Repositorios](./reference/repositories)
- [Subidas](./reference/uploads)
- [Artefactos y catálogo](./reference/artifacts)
- [Paquetes](./reference/packages)
- [Archivos por ruta](./reference/files)
- [Etapas y promoción](./reference/promotion)
- [Políticas de almacenamiento y retención](./reference/storage)
- [Espejos](./reference/mirrors)
- [Enlaces de descarga](./reference/links)
- [Adjuntos de compilación](./reference/attachments)
- [Cuentas e inicio de sesión](./reference/accounts)
- [Cuentas de servicio y claves](./reference/services)
- [Copias de seguridad](./reference/backups)
- [Actualizaciones](./reference/updates)
- [Comentarios](./reference/feedback)

Páginas relacionadas: [Autenticación](./authentication), [Errores](./errors), [SDK de TypeScript](../protocols/sdk).
