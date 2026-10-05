---
title: SDK de TypeScript
---

# SDK de TypeScript

El SDK de TypeScript es la biblioteca cliente que usan la consola y `arkvoryctl`. Envuelve la API REST `/api/v1`. Valida cada respuesta en tiempo de ejecución, sube en partes, continúa las transferencias interrumpidas y verifica las descargas con SHA-256. Usa solo API web estándar (`fetch`, flujos, Web Crypto), por lo que funciona en Node.js y en navegadores.

## Obtener el SDK {#get-the-sdk}

El SDK es el paquete del workspace `@proanima/arkvory-sdk`, en la carpeta `packages/sdk` del repositorio de código fuente `ProAnima/Arkvory`. **No se publica en el registro de npm**. Depende del paquete del workspace `@proanima/arkvory-contracts`.

- Para usarlo, compile el repositorio de código fuente (`npm ci` y después `npm run build`) y escriba su herramienta dentro de ese workspace, como hacen los scripts del propio repositorio.
- Desde otro lenguaje, o desde un proyecto que no puede usar el workspace, llame directamente a la [API REST](../api/index) con `Authorization: Bearer <key>`.

El código fuente está disponible bajo la licencia de Arkvory. Puede usarlo y modificarlo dentro de su organización. No puede distribuir copias.

## Crear un cliente {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **URL base.** Se requiere HTTPS. Se permite HTTP sin cifrar solo para `localhost`, `127.0.0.1` y `[::1]`. La URL no debe contener usuario, contraseña, consulta (query) ni fragmento. Puede contener un prefijo de ruta. Las redirecciones se tratan como errores.
- **Función de devolución de llamada del token.** El SDK la llama en cada solicitud y nunca guarda el resultado en caché. Puede rotar las claves sin crear un cliente nuevo.
- **`inRepository(id)`** devuelve un cliente vinculado a un repositorio. Es una comodidad, no un límite de seguridad.

| Opción             | Valor predeterminado | Significado                                                                                                               |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `signal`           | ninguno              | Cancela todas las solicitudes de este cliente                                                                             |
| `requestTimeoutMs` | ninguno              | Plazo de una solicitud que no tiene señal propia (1 a 3600000)                                                            |
| `maxAttempts`      | 5                    | Intentos de una solicitud de transferencia, incluido el primero (1 a 10)                                                  |
| `maxRetries`       | 20                   | Reintentos compartidos por una operación de subida o de descarga (0 a 100)                                                |
| `attemptTimeoutMs` | 120000               | Límite de un intento de transferencia (1 a 1800000)                                                                       |
| `baseDelayMs`      | 500                  | Primera espera del retroceso exponencial (1 a 60000)                                                                      |
| `maxDelayMs`       | 60000                | Espera máxima, incluido `Retry-After`                                                                                     |
| `onRequest`        | ninguno              | Se llama una vez por cada solicitud HTTP con método, ruta, estado, duración e ID de solicitud. Nunca recibe credenciales. |

Los reintentos automáticos se aplican solo a las transferencias: `create`, los pasos internos de `resume` y `downloadVerified`. Reintentan los fallos de red y los códigos HTTP 408, 429, 502, 503 y 504, con retroceso exponencial, y nunca antes de `Retry-After`. Las demás llamadas se ejecutan una sola vez. Los cambios protegidos por una revisión nunca se repiten automáticamente.

## Tareas habituales {#common-tasks}

### Descubrir y listar {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

Las páginas devuelven `next`. Páselo como `after` para leer la página siguiente.

### Subir un archivo grande con reanudación (Node.js) {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // no se lee en memoria
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // guárdela con el estado del trabajo antes de la primera solicitud
const session = await releases.uploads.create(key, {
  name: 'Game.zip',
  size: String(file.size),
  sha256: hash.digest('hex'),
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const uploaded = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(`${bytes} of ${file.size} bytes`),
});
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0: la ruta es nueva
```

- La misma clave de idempotencia con el mismo descriptor devuelve la misma sesión, por lo que una respuesta perdida no crea una segunda subida.
- `resume` lee las partes que el servidor ya tiene, comprueba sus hashes con su archivo y envía solo las partes que faltan. Tras una caída, llame de nuevo a `resume` con el ID de sesión guardado.
- El servidor elige el tamaño de las partes: 8 MiB, y más solo para los archivos que necesitan más de 10 000 partes. El SDK mantiene una parte en memoria a la vez.
- Los archivos de 16 GiB o más los finaliza el worker del servidor. `resume` espera a que termine.
- `assets.assign(path, artifactId, expectedRevision)` falla con un conflicto si la ruta tiene otra revisión. Lea antes la ruta con `assets.get(path)`.

### Descargar con verificación {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // solo después de que pipeTo haya terminado correctamente
```

El SDK lee el contenido en rangos de 8 MiB y comprueba el tamaño, `Content-Range` y `ETag` de cada rango. Comprueba el SHA-256 de todo el archivo antes de entregar el último bloque. Si la comprobación falla, el flujo falla con `ArkvoryIntegrityError`. No despliegue nunca directamente desde el flujo: escriba en un archivo temporal y úselo solo después de que el flujo termine correctamente.

Para continuar tras un reinicio, pase como `prefix` los bytes que ya guardó. Entonces el flujo contiene solo el resto:

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

Para un único rango de bytes sin verificación, `releases.artifacts.download(id, { start: 0, end: 1023 })` devuelve el `Response` sin procesar (estado 206).

### Archivos raw por ruta {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // opcional: rechaza la operación si la ruta existe
});
console.log(result.revision, result.created); // created es false si los bytes ya estaban
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

La opción `sha256` (64 dígitos hexadecimales) permite que el servidor escriba los bytes en una sola pasada y rechace una discrepancia. `releases.assets.put(path, blob, options)` y `releases.assets.download(path, range)` son las mismas llamadas. Cada subida es una sola solicitud, así que úselas para archivos pequeños y medianos. Consulte [Archivos raw](./raw-files).

### Paquetes, promoción y enlaces {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // archivo UPack
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

La URL del enlace es un secreto que permite leer un artefacto hasta `expiresAt`. No se puede revocar antes de tiempo.

### Copias de seguridad {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // en cola para el agente de copias de seguridad
const points = await client.backup.points({ limit: 20 });
```

Las llamadas de copias de seguridad requieren una sesión de administrador de cuenta o la clave de archivo del propietario. Las claves de servicio y los tokens personales reciben 403.

## Errores {#errors}

```typescript
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

try {
  await releases.artifacts.get(id);
} catch (error) {
  if (error instanceof ArkvoryHttpError) {
    console.error(error.status, error.code, error.reason, error.requestId, error.retryAfterSeconds);
  } else if (error instanceof ArkvoryClientError) {
    console.error(error.code);
  }
}
```

| Clase                   | Significado                                                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArkvoryHttpError`      | El servidor respondió con un error. Campos: `status`, `code`, `reason`, `details`, `requestId`, `retryAfterMs`, `retryAfterSeconds`, `serverMessage`. `code` es `http_error` cuando respondió un proxy sin el formato de Arkvory. |
| `ArkvoryNetworkError`   | La conexión falló o agotó el tiempo de espera tras todos los reintentos                                                                                                                                                           |
| `ArkvoryIntegrityError` | Los bytes descargados no coinciden con el artefacto                                                                                                                                                                               |
| `ArkvoryClientError`    | Fallo local con `code`: `invalid_argument`, `insecure_url`, `invalid_response`, `response_too_large`, `size_mismatch`, `file_changed`, `upload_cancelled`, `completion_failed`                                                    |

Decida según `code` y `reason`, no según el texto del mensaje. Trate los códigos desconocidos según el estado HTTP. `Error.message` nunca contiene texto del servidor. Consulte [Errores](../api/errors).

## Navegador y Node.js {#browser-and-node-js}

- **Navegador en otro origen.** El administrador debe incluir el origen exacto de su página en `ARKVORY_CORS_ORIGINS` en el servidor. El SDK envía la clave en la cabecera `Authorization` y nunca envía cookies.
- **Claves en un navegador.** Guarde la clave solo en la memoria. No la ponga en URL, `localStorage`, registros ni en el código fuente de la página. Un usuario puede iniciar sesión con `client.login(name, password)` para obtener un token de sesión.
- **Archivos en Node.js.** Use `openAsBlob` de `node:fs` para pasar un archivo sin leerlo en memoria.
- **Cola de descargas.** `DownloadQueue` y `checkpointedDownload` ofrecen una cola acotada con pausa, reanudación y cancelación. Usted proporciona el adaptador de almacenamiento.

## Límites {#limits}

- Las respuestas JSON están limitadas a 2 MiB (las páginas de paquetes, a 8 MiB; las listas de artefactos, a 24 MiB). Las respuestas mayores fallan con `response_too_large`.
- Los tamaños son cadenas decimales, de modo que los valores superiores a 2^53 conservan toda su precisión.

## Páginas relacionadas {#related-pages}

- [Línea de comandos (arkvoryctl)](./cli)
- [Transferencias](../use/transfers)
- [Resumen de la API](../api/index) y [Autenticación](../api/authentication)
- [Archivos raw](./raw-files)
