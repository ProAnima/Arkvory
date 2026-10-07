---
title: Archivos raw
description: Almacene y lea un archivo por su ruta con una sola solicitud HTTP, usando curl, wget o PowerShell, sin instalar nada.
---

# Archivos raw

Una ruta de archivo en un repositorio funciona como un archivo en un servidor web. `PUT` almacena un cuerpo como la siguiente versión de una ruta. `GET` devuelve la versión actual. Úselo desde scripts de compilación y trabajos de CI que solo tienen `curl` o PowerShell.

La dirección es la misma para los tres métodos:

```text
https://<host>/api/v1/repositories/<repository>/raw/<path>
```

Por ejemplo: `https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe`.

## Almacenar un archivo {#store-a-file}

Necesita un repositorio y una clave con acceso de escritura. Consulte [Cuentas y claves](../use/accounts). Envíe la clave como `Authorization: Bearer <key>`. Los archivos raw no aceptan ningún otro tipo de autenticación.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
URL="https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"

curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$URL"
```

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe'
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

```bash
wget -qO- --method=PUT --body-file=GameSetup.exe \
  --header="Authorization: Bearer $ARKVORY_KEY" "$URL"
```

Dé a `curl -T` la dirección completa del archivo, no de una carpeta. Codifique los caracteres de la ruta que una URL no permite: escriba un espacio como `%20`, `#` como `%23` y `?` como `%3F`.

La respuesta es JSON. Un archivo nuevo o bytes nuevos devuelven `201`:

```json
{
  "path": "builds/game/1.4/GameSetup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "00000000-0000-4000-8000-000000000001", "size": "1048576", "sha256": "…" }
}
```

Si la ruta ya contiene exactamente estos bytes, la respuesta es `200` con `"created": false` y la misma revisión. No se almacena nada. Un paso de un trabajo de CI puede ejecutarse de nuevo sin crear una versión nueva. `size` es una cadena de dígitos decimales.

### Enviar una suma de comprobación {#send-a-checksum}

Envíe el SHA-256 del archivo con `X-Checksum-Sha256`, y la longitud con `Content-Length`. `curl -T` y PowerShell envían la longitud de un archivo. Entonces el servidor escribe los bytes directamente en el almacenamiento en una sola pasada y los comprueba allí. Una suma de comprobación incorrecta devuelve `422` con el código `integrity_mismatch`, no almacena nada y deja la ruta como estaba.

```bash
curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "X-Checksum-Sha256: $(sha256sum GameSetup.exe | cut -d' ' -f1)" \
  "$URL"
```

```powershell
$headers['X-Checksum-Sha256'] = (Get-FileHash .\GameSetup.exe -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

Sin la suma de comprobación, o con un cuerpo por fragmentos (chunked) que no tiene `Content-Length`, el servidor primero escribe el cuerpo en un archivo temporal y lo hashea. Después lo almacena. Esto necesita hasta el doble del tamaño del archivo en el disco del servidor durante un breve período, y una segunda pasada sobre los bytes. El servidor elimina los archivos temporales que dejó un fallo tras un día.

Cuando envía la suma de comprobación y la longitud, y la ruta ya contiene estos bytes, el servidor responde `200` sin leer el cuerpo y cierra la conexión.

### Crear solo {#create-only}

Un `PUT` lee solo una condición, `If-None-Match: *`. Con ella, el servidor almacena el archivo solo si la ruta no existe. De lo contrario responde `409` con el motivo `already_exists`, también cuando los bytes son los mismos. Cualquier otro valor de `If-None-Match` en un `PUT` devuelve `400`.

```bash
curl --fail-with-body -sS -T ./notes.txt \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-None-Match: *" \
  "https://arkvory.example/api/v1/repositories/releases/raw/docs/notes.txt"
```

### Dos escritores {#two-writers}

Cuando dos solicitudes cambian la misma ruta a la vez, gana la primera. La posterior recibe `409` con el motivo `revision_mismatch`, y la ruta conserva el contenido del ganador. Ejecute la solicitud de nuevo para crear una revisión nueva. Los bytes subidos del perdedor quedan como un artefacto sin ruta hasta que la retención los elimine.

## Leer un archivo {#read-a-file}

`GET` devuelve la versión actual de la ruta. `HEAD` devuelve solo las cabeceras.

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $ARKVORY_KEY" -o GameSetup.exe "$URL"
```

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\GameSetup.exe
```

```bash
wget --header="Authorization: Bearer $ARKVORY_KEY" -O GameSetup.exe "$URL"
```

Las cabeceras de la respuesta:

| Cabecera                | Valor                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| `ETag`                  | `"sha256:<digest>"`: el SHA-256 del contenido, entre comillas         |
| `Content-Length`        | El tamaño del archivo                                                 |
| `Accept-Ranges`         | `bytes`                                                               |
| `Content-Type`          | Siempre `application/octet-stream`                                    |
| `Content-Disposition`   | `attachment` con el último segmento de la ruta como nombre de archivo |
| `X-Arkvory-Artifact-Id` | El ID del artefacto que contiene esta versión                         |

Una ruta desconocida devuelve `404`.

### Rangos y solicitudes condicionales {#ranges-and-conditional-requests}

| Cabecera de solicitud       | Efecto                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Range: bytes=0-1023`       | `206` con la parte solicitada y `Content-Range`. Un inicio más allá del final del archivo devuelve `416` con `Content-Range: bytes */<size>`. |
| `Range: bytes=-1024`        | Los últimos 1024 bytes                                                                                                                        |
| `Range: bytes=1048576-`     | Desde el desplazamiento hasta el final                                                                                                        |
| `If-Range: "sha256:…"`      | Aplica el `Range` solo si el ETag es exactamente este. Si la ruta tiene una versión nueva, recibe todo el archivo nuevo.                      |
| `If-None-Match: "sha256:…"` | `304` sin cuerpo si el ETag es el mismo. También funciona con `HEAD`.                                                                         |

Solo se admite un rango por solicitud. Una solicitud con varios rangos devuelve el archivo completo.

Una ruta puede obtener una versión nueva en cualquier momento, y un `GET` resuelve la ruta de nuevo. Para continuar una descarga de forma segura, recuerde el `ETag` de la primera respuesta y envíelo como `If-Range`:

```bash
etag=$(curl -sSI -H "Authorization: Bearer $ARKVORY_KEY" "$URL" | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -sS -H "Authorization: Bearer $ARKVORY_KEY" -H "If-Range: $etag" \
  -H "Range: bytes=1048576-" "$URL" >> GameSetup.part
```

Para omitir una descarga cuando el archivo no ha cambiado, envíe el ETag que guardó la última vez:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ARKVORY_KEY" \
  -H 'If-None-Match: "sha256:<digest>"' "$URL"
```

Para archivos grandes, [`arkvoryctl get`](./cli) descarga con reanudación y verifica el SHA-256 por usted.

## Rutas y versiones {#paths-and-versions}

Un archivo raw es un [archivo por ruta](../use/files). Cada `PUT` con bytes nuevos agrega una revisión a la ruta: revisión 1, 2, 3 y así sucesivamente. Las revisiones anteriores permanecen. Los bytes nunca se reemplazan, porque cada revisión apunta a su propio artefacto inmutable, con el nombre del último segmento de la ruta.

- `GET` en la dirección raw siempre da la revisión actual.
- Para ver todas las revisiones de una ruta, lea su historial: [`getAssetHistory`](../api/reference/files#getAssetHistory), o [[ui:history]] en la consola.
- Para leer una revisión anterior, [`getAssetRevision`](../api/reference/files#getAssetRevision) devuelve su artefacto. Descárguelo con la dirección de contenido del artefacto.
- Para volver a una revisión antigua, use [`restoreAsset`](../api/reference/files#restoreAsset). Agrega una revisión nueva que apunta a los bytes antiguos.
- Para listar las rutas de un repositorio por prefijo, use [`listAssetPage`](../api/reference/files#listAssetPage).
- Una ruta no se puede eliminar. El historial permanece. La retención no elimina los artefactos que usa una revisión de ruta.

Las mismas operaciones están en el [SDK](./sdk#raw-files-by-path) (`client.raw.putRawFile`, `downloadRawFile`) y en [`arkvoryctl`](./cli#transfers) (`put`, `get`).

### Reglas de las rutas {#path-rules}

| Regla        | Valor                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| Longitud     | De 1 a 1024 caracteres                                                                      |
| Carpetas     | Segmentos separados por `/`                                                                 |
| No permitido | Un segmento vacío (`a//b`), `.` o `..`, barra invertida, dos puntos y caracteres de control |

`curl` y los navegadores eliminan `.` y `..` de una URL antes de enviarla, así que esa ruta nunca llega. Una ruta que incumple las reglas devuelve `400`.

## Permisos {#permissions}

Los tokens personales y las claves de archivo obtienen acceso de lectura o de escritura al repositorio. Las claves de servicio obtienen acciones exactas.

| Operación     | Acciones de la clave de servicio                                                                 | Token personal o clave de archivo                  |
| ------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `GET`, `HEAD` | `content.read`                                                                                   | Acceso de lectura                                  |
| `PUT`         | `upload.create`, `upload.write`, `upload.complete`, `asset.read`, `asset.write`, `artifact.read` | Acceso de escritura; token con ámbito `read-write` |

Un agente de despliegue que solo descarga necesita la acción `content.read`.

Una [puerta de enlace de lectura](../operate/read-gateways) acepta solo `GET` y `HEAD`. Un [espejo](../operate/mirrors) atiende las lecturas y rechaza `PUT` con `409` y el motivo `mirror_read_only`.

## Límites {#limits}

| Límite                | Valor                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tamaño del archivo    | El tamaño máximo de objeto de la instalación, `ARKVORY_MAX_OBJECT_BYTES` (unos 10 TiB de forma predeterminada)                                                                               |
| Una solicitud `PUT`   | Debe terminar en 30 minutos y no debe quedar detenida más de 30 segundos (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). Estos son también los valores máximos permitidos. |
| Subidas simultáneas   | 2 por servidor y 1 por clave de forma predeterminada (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). Una solicitud en espera se abandona a los 20 segundos con `503`.          |
| Descargas simultáneas | 16 por servidor y 4 por clave de forma predeterminada                                                                                                                                        |
| Cuota                 | El archivo cuenta para la cuota del repositorio y para la capacidad de la instalación                                                                                                        |

Un solo `PUT` no tiene reanudación: tras un fallo, empieza de nuevo desde el primer byte. Use archivos raw para archivos pequeños y medianos y para scripts. Para archivos grandes o redes lentas, use [`arkvoryctl put`](./cli) o el [SDK](./sdk). Suben en partes, continúan tras un fallo y comprueban el SHA-256. También almacenan el archivo como una revisión de una ruta. Las variables se describen en [Variables de entorno](../reference/environment#transfers-and-bandwidth).

## Unity Addressables {#addressables}

Addressables cargan el catálogo y los bundles con peticiones `GET` normales, así que una carpeta de compilación puede estar bajo una ruta raw. Esto sirve para compilaciones internas, QA y herramientas. No sirve para jugadores en internet público: leer raw siempre requiere una clave, un enlace de descarga caduca en 24 horas y una clave dentro de un cliente distribuido no es secreta.

Suba la carpeta con `arkvoryctl put`. Los archivos cuyos bytes no cambiaron no se vuelven a enviar. Use una carpeta por compilación, porque una ruta siempre devuelve su revisión más reciente y un catálogo antiguo no debe encontrarse con bundles nuevos:

```bash
cd ServerData/StandaloneWindows64
find . -type f | while read -r file; do
  arkvoryctl put "$file" "addressables/game/$BUILD/StandaloneWindows64/${file#./}" || exit 1
done
```

```powershell
$root = (Resolve-Path .\ServerData\StandaloneWindows64).Path
Get-ChildItem $root -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($root.Length + 1) -replace '\\', '/'
  arkvoryctl put $_.FullName "addressables/game/$env:BUILD/StandaloneWindows64/$relative"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Defina la ruta de carga remota del perfil de Addressables como la dirección raw de esa carpeta, por ejemplo `https://arkvory.example/api/v1/repositories/releases/raw/addressables/game/<build>/[BuildTarget]`. Dé al cliente una clave que solo pueda leer: un token de acceso personal con lectura o una clave de servicio con la acción `content.read`. Raw acepta la clave solo en el encabezado `Authorization`, así que añádala a cada petición:

```csharp
Addressables.WebRequestOverride = request =>
{
    if (request.url.StartsWith("https://arkvory.example/"))
        request.SetRequestHeader("Authorization", "Bearer " + readKey);
};
```

En Addressables 1.x la propiedad es `Addressables.WebRequestOverride`; compruebe el nombre en su versión. Es un patrón, no una integración probada.

## Solución de problemas {#troubleshooting}

Los errores son documentos JSON con `code`, `reason`, `message` y `requestId`. Consulte [Errores](../api/errors). Dé el `requestId` a su administrador para encontrar la solicitud en el registro del servidor.

| Estado          | Motivo                                                      | Causa                                                                                         | Qué hacer                                                                                      |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `400`           | `validation`                                                | La ruta, `Content-Length`, `X-Checksum-Sha256` o `If-None-Match` no son válidos               | Compruebe las reglas de las rutas y codifique la URL                                           |
| `401`           | `credential_missing`, `credential_invalid`, `token_expired` | No hay clave, la clave es incorrecta, o el token ha caducado                                  | Envíe `Authorization: Bearer <key>`. La autenticación Basic no funciona para los archivos raw. |
| `403`           | `permission_missing`, `read_only_token`                     | La clave no puede escribir, o es un token de solo lectura                                     | Use una clave con las acciones de [Permisos](#permissions)                                     |
| `404`           |                                                             | La ruta no existe, o la clave no ve el repositorio                                            | Compruebe el nombre del repositorio y la ruta                                                  |
| `409`           | `already_exists`                                            | `If-None-Match: *` y la ruta existe                                                           | Elimine la cabecera para agregar una revisión                                                  |
| `409`           | `revision_mismatch`                                         | Otra solicitud cambió la ruta antes                                                           | Ejecute la solicitud de nuevo                                                                  |
| `409`           | `mirror_read_only`                                          | El repositorio es un espejo                                                                   | Escriba en el servidor principal                                                               |
| `416`           | `range_not_satisfiable`                                     | El rango empieza después del final del archivo                                                | Compruebe el tamaño con `HEAD`                                                                 |
| `422`           | `integrity_mismatch`                                        | El cuerpo no coincide con `X-Checksum-Sha256` o `Content-Length`                              | Calcule la suma de comprobación de nuevo; compruebe el proxy                                   |
| `503`           | `busy`                                                      | Demasiadas transferencias a la vez                                                            | Espere el tiempo de `Retry-After` y reintente                                                  |
| `507`           | `storage_quota`                                             | Se alcanzó la cuota del repositorio o la capacidad de la instalación                          | Libere espacio o solicite una cuota mayor                                                      |
| No es un estado | `curl: (55)` o `(56)` al enviar                             | El servidor cerró la conexión. Cuando la ruta ya contiene los bytes, responde `200` y cierra. | Ejecute `curl -i` y lea la respuesta                                                           |
| No es un estado | La conexión se cierra tras 30 minutos                       | El plazo de subida                                                                            | Use `arkvoryctl put`                                                                           |

## Páginas relacionadas {#related-pages}

- [Clientes y protocolos](./index)
- [Línea de comandos (arkvoryctl)](./cli)
- [SDK de TypeScript](./sdk)
- [Archivos y rutas](../use/files)
- [Referencia de la API: Archivos por ruta](../api/reference/files)
