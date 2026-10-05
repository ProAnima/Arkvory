---
title: Imágenes de contenedor
description: Suba y descargue imágenes Docker y OCI, charts de Helm y artefactos de ORAS mediante el registro que cada repositorio tiene en /v2.
---

# Imágenes de contenedor

Cada repositorio de Arkvory es también un registro de contenedores. Docker, Podman, Buildx, containerd, Helm y ORAS suben y descargan con el protocolo OCI Distribution. Las capas y los manifiestos de las imágenes se almacenan como artefactos normales. Los permisos del repositorio, las cuotas, las comprobaciones SHA-256, las copias de seguridad y los espejos se aplican a ellos igual que a cualquier otro archivo.

## Antes de empezar {#before-you-start}

Necesita:

- La dirección del servidor con HTTPS y un certificado de confianza, por ejemplo `arkvory.example`. Consulte [HTTPS](../install/https).
- Un repositorio, por ejemplo `releases`.
- Una clave: un token de acceso personal o una clave de servicio. Consulte [Cuentas y claves](../use/accounts).

El registro responde en la raíz del host, bajo `/v2/`. No puede funcionar bajo un prefijo de ruta como `https://example.com/arkvory/`, porque Docker no lo admite. Un proxy inverso debe pasar `/v2/` sin cambios y no debe almacenar en búfer los cuerpos de las solicitudes. En nginx, establezca `client_max_body_size 0` y desactive el almacenamiento en búfer de las solicitudes.

## Nombres de imagen {#image-names}

Una referencia de imagen tiene esta forma:

```text
<host>/<repository>/<image>:<tag>
<host>/<repository>/<image>@sha256:<digest>
```

El primer segmento de la ruta es el repositorio de Arkvory. Es el límite de acceso: una clave solo ve los repositorios a los que se le ha concedido acceso. El resto es el nombre de la imagen, con uno o más componentes.

| Referencia                                  | Repositorio | Imagen          | Parte de referencia |
| ------------------------------------------- | ----------- | --------------- | ------------------- |
| `arkvory.example/releases/web:1.4`          | `releases`  | `web`           | tag `1.4`           |
| `arkvory.example/releases/team/web:1.4`     | `releases`  | `team/web`      | tag `1.4`           |
| `arkvory.example/qa/tools/builder@sha256:…` | `qa`        | `tools/builder` | digest              |

| Parte       | Regla                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositorio | Letras minúsculas, dígitos, `_` y `-`. Empieza por una letra o un dígito. Hasta 64 caracteres.                                                      |
| Imagen      | Componentes separados por `/`. Un componente tiene letras minúsculas y dígitos, unidos por `.`, `_`, `__` o guiones. Hasta 200 caracteres en total. |
| Tag         | Letras, dígitos, `_`, `.` y `-`. Empieza por una letra, un dígito o `_`. Hasta 128 caracteres.                                                      |
| Digest      | `sha256:` y 64 dígitos hexadecimales en minúscula. Se rechazan otros algoritmos.                                                                    |

Una referencia sin parte de imagen, como `arkvory.example/web:1.4`, se rechaza con `NAME_INVALID`: `web` se toma como el repositorio y el nombre de la imagen queda vacío.

## Iniciar sesión {#log-in}

El registro toma la clave de Arkvory como contraseña de la autenticación HTTP Basic. El nombre de usuario no se comprueba: use cualquier nombre, por ejemplo el del trabajo de CI. Una solicitud también puede enviar la clave como `Authorization: Bearer <key>`. No necesita un servicio de tokens aparte.

```bash
docker login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

```powershell
Get-Content C:\Private\arkvory.key | docker login arkvory.example -u ci --password-stdin
```

Los demás clientes inician sesión de la misma forma:

```bash
podman login arkvory.example -u ci --password-stdin < ~/.arkvory/key
helm registry login arkvory.example -u ci --password-stdin < ~/.arkvory/key
oras login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

| Clave                                               | Para qué usarla                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Token de acceso personal, ámbito `read`             | Descargar (pull) desde una estación de trabajo                                        |
| Token de acceso personal, ámbito `read-write`       | Subir (push) desde una estación de trabajo                                            |
| Clave de servicio                                   | CI/CD y agentes de despliegue. Es el único tipo de clave que puede eliminar imágenes. |
| Clave de archivo del archivo de claves del servidor | El propietario de la instalación y las integraciones antiguas (`read` o `write`)      |

Un token personal caduca. A partir de ese momento, toda solicitud recibe `401 UNAUTHORIZED`: cree un token nuevo e inicie sesión de nuevo. Docker guarda la clave en `~/.docker/config.json`, salvo que configure un credential helper. Proteja ese archivo o use un almacén de credenciales.

## Subir y descargar imágenes {#push-and-pull}

```bash
docker tag web:1.4 arkvory.example/releases/team/web:1.4
docker push arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web@sha256:<digest>
```

Qué hace el registro:

- Una capa que el repositorio ya contiene no se almacena de nuevo, aunque la use otra imagen.
- Las capas no se comparten entre repositorios. Una solicitud para montar una capa de otro repositorio recibe una sesión de subida normal, así que el cliente vuelve a enviar la capa.
- Cada capa y cada manifiesto se comprueban con su digest SHA-256. Si no coinciden, no se almacena nada y se devuelve `DIGEST_INVALID`.
- Un manifiesto se acepta solo cuando todo lo que referencia ya está en el repositorio: la configuración y las capas de una imagen, o los manifiestos de plataforma de un índice. Los manifiestos de plataforma deben estar en la misma imagen que su índice. En caso contrario, la respuesta es `MANIFEST_BLOB_UNKNOWN`.
- Las descargas de capas admiten solicitudes `Range`.

El registro acepta estos tipos de manifiesto:

| Tipo de medio                                               | Uso                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| `application/vnd.oci.image.manifest.v1+json`                | Imágenes OCI, charts de Helm, artefactos de ORAS        |
| `application/vnd.oci.image.index.v1+json`                   | Imágenes multiplataforma, caché de registro de BuildKit |
| `application/vnd.docker.distribution.manifest.v2+json`      | Imágenes de Docker (schema 2)                           |
| `application/vnd.docker.distribution.manifest.list.v2+json` | Imágenes multiplataforma de Docker                      |

Un manifiesto tiene `schemaVersion: 2` y ocupa como máximo 4 MiB. Docker schema 1 no se admite. El tipo procede de la cabecera `Content-Type` o del campo `mediaType` del manifiesto, y ambos deben coincidir. Un pull devuelve el manifiesto exactamente como se subió, con su propio tipo de medio. El registro no convierte entre formatos.

### Imágenes multiplataforma {#multi-platform-images}

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t arkvory.example/releases/team/web:1.4 --push .
```

Buildx sube cada manifiesto de plataforma por su digest y después el índice bajo el tag. Todos van al mismo nombre de imagen, como exige el registro.

### Caché de compilación {#build-cache}

Un builder de BuildKit que pueda exportar una caché, por ejemplo un builder de `docker buildx` con el controlador `docker-container`, puede guardar su caché de registro en Arkvory:

```bash
docker buildx build \
  --cache-from type=registry,ref=arkvory.example/releases/team/web:cache \
  --cache-to type=registry,ref=arkvory.example/releases/team/web:cache,mode=max \
  -t arkvory.example/releases/team/web:1.4 --push .
```

El índice de la caché enumera capas y una configuración de caché. Arkvory los almacena como blobs de la imagen y los protege igual que las capas de cualquier manifiesto almacenado.

### Charts de Helm {#helm-charts}

Helm almacena los charts como artefactos OCI. Después de `helm registry login`:

```bash
helm push web-1.4.0.tgz oci://arkvory.example/releases/charts
helm pull oci://arkvory.example/releases/charts/web --version 1.4.0
helm install web oci://arkvory.example/releases/charts/web --version 1.4.0
```

El chart se convierte en la imagen `charts/web` con el tag `1.4.0` en el repositorio `releases`. Arkvory no tiene un repositorio de charts clásico con un archivo `index.yaml`.

### Artefactos de ORAS {#oras-artifacts}

ORAS almacena cualquier archivo como capas de un manifiesto OCI:

```bash
oras push arkvory.example/releases/tools/settings:1.0 ./settings.json:application/json
oras pull arkvory.example/releases/tools/settings:1.0
```

La API Referrers no está disponible: `/v2/<name>/referrers/<digest>` responde `404`. Los clientes que siguen la especificación OCI, como ORAS, guardan entonces los artefactos asociados bajo tags con el nombre del digest.

## Tags y digests {#tags-and-digests}

- Subir un manifiesto bajo un tag mueve el tag. El manifiesto al que apuntaba antes el tag permanece en el registro y todavía se puede descargar por su digest.
- Una subida por digest (`PUT /v2/<name>/manifests/sha256:…`) almacena el manifiesto sin tag. El digest debe ser el SHA-256 del cuerpo.
- Los tags se listan en orden de bytes, así que las mayúsculas van antes que las minúsculas.

Liste los tags de una imagen:

```bash
curl -fsS -u "ci:$ARKVORY_KEY" https://arkvory.example/v2/releases/team/web/tags/list
```

La respuesta es `{"name": "releases/team/web", "tags": [...]}`. Use `n` para el tamaño de página (100 de forma predeterminada, 1000 como máximo) y `last` para el último tag de la página anterior. Si hay más tags, la cabecera `Link` contiene la dirección de la página siguiente.

Encuentre el digest de un tag:

```bash
curl -fsSI -u "ci:$ARKVORY_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/1.4 | grep -i docker-content-digest
```

No hay un catálogo de todas las imágenes (`/v2/_catalog`). En la consola, las capas y los manifiestos aparecen entre los artefactos del repositorio con la etiqueta `oci`, con su digest como nombre. Use [[ui:labelFilter]] en [[ui:catalog]] para mostrarlos.

## Eliminar imágenes y liberar espacio {#delete-images}

Las imágenes se eliminan mediante la API del registro. La línea de comandos de Docker no tiene un comando para ello: use `curl`, `oras manifest delete` u otra herramienta de registro.

| Solicitud                              | Efecto                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `DELETE /v2/<name>/manifests/<tag>`    | Elimina solo el tag. El manifiesto permanece y se puede descargar por su digest. |
| `DELETE /v2/<name>/manifests/<digest>` | Elimina el manifiesto y todos los tags que apuntan a él                          |
| `DELETE /v2/<name>/blobs/<digest>`     | Se rechaza con `405`. Las capas desaparecen junto con sus manifiestos.           |

Ambas eliminaciones requieren una clave de servicio con la acción `artifact.delete` en el repositorio. Los tokens personales, las sesiones de la consola y las claves de archivo no pueden eliminar imágenes. Una eliminación responde `202`.

```bash
curl -fsS -X DELETE -H "Authorization: Bearer $ARKVORY_CLEANUP_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/sha256:<digest>
```

Cómo se libera el espacio:

1. Mientras un manifiesto está almacenado, con tag o sin él, Arkvory lo protege a él y a todas las capas a las que hace referencia. La retención los omite con el impedimento `reference`.
2. Mover o eliminar un tag no libera nada. Los manifiestos antiguos conservan sus capas hasta que usted elimine esos manifiestos por digest.
3. Cuando se elimina un manifiesto por digest, su artefacto y las capas que ningún otro manifiesto usa pierden esta protección. Siguen almacenados hasta que alguien los quita con la retención o los elimina como artefactos. Consulte [Almacenamiento](../operate/storage).
4. Una capa que se subió sin manifiesto, por ejemplo en una subida que falló, no está protegida.
5. Cuando se vuelve a necesitar una capa que se eliminó, el registro la notifica como desconocida y la siguiente subida la sube de nuevo.

## Permisos {#permissions}

Los tokens personales y las claves de archivo obtienen acceso de lectura o de escritura a un repositorio. Las claves de servicio obtienen acciones exactas.

| Operación                       | Acciones de la clave de servicio                   | Token personal o clave de archivo                             |
| ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Descargar manifiestos y capas   | `content.read`                                     | Acceso de lectura                                             |
| Listar tags                     | `artifact.list`                                    | Acceso de lectura                                             |
| Subir (push)                    | `upload.create`, `upload.write`, `upload.complete` | Acceso de escritura; un token necesita el ámbito `read-write` |
| Eliminar un tag o un manifiesto | `artifact.delete`                                  | No es posible                                                 |

Una clave de CI que sube imágenes suele descargar también, por ejemplo imágenes base o la caché de compilación. Concédale además `content.read` y `artifact.list`. Un repositorio al que la clave no tiene acceso responde `403 DENIED`.

## Puertas de enlace de lectura y espejos {#read-gateways-and-mirrors}

- Una [puerta de enlace de lectura](../operate/read-gateways) atiende las descargas (pull). Un push recibe `405`.
- Un [espejo](../operate/mirrors) recibe las imágenes de su origen junto con sus tags y eliminaciones. Los clientes descargan del espejo desde su propia dirección. Un push recibe `409 DENIED` con el motivo `mirror_read_only`.

## Límites {#limits}

| Límite                    | Valor                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tamaño del manifiesto     | 4 MiB                                                                                                                                                                                                           |
| Tamaño de la capa         | El objeto más grande de la instalación, `ARKVORY_MAX_OBJECT_BYTES` (unos 10 TiB de forma predeterminada)                                                                                                        |
| Una solicitud de subida   | Debe terminar en 30 minutos y no debe quedar detenida más de 30 segundos (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). 30 minutos es también el valor máximo permitido.                     |
| Subida sin terminar       | Se elimina junto con sus bytes tras 24 horas sin actividad                                                                                                                                                      |
| Espacio temporal en disco | Hasta el doble del tamaño de la capa mientras se sube                                                                                                                                                           |
| Subidas simultáneas       | 1 por clave y 2 por servidor de forma predeterminada (`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`, `ARKVORY_MAX_UPLOADS`). Una solicitud en espera se abandona a los 20 segundos (`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`). |
| Descargas simultáneas     | 4 por clave y 16 por servidor de forma predeterminada                                                                                                                                                           |
| Tags por página           | 1000                                                                                                                                                                                                            |
| Cuota                     | Las capas, los manifiestos y los bytes de las subidas sin terminar cuentan para la cuota del repositorio y para la capacidad de la instalación                                                                  |

Docker envía cada capa en una sola solicitud. Por tanto, una capa debe llegar dentro del plazo de subida, y una subida de capa fallida vuelve a empezar desde el primer byte. Para archivos de muchos gigabytes, use en su lugar [`arkvoryctl`](./cli): sube en partes y continúa tras un fallo. Las variables se describen en [Variables de entorno](../reference/environment#transfers-and-bandwidth).

## Funciones no admitidas {#not-supported}

- La API Referrers. Responde `404` y los clientes recurren a los tags.
- El catálogo de todas las imágenes, `/v2/_catalog`.
- Montar capas desde otro repositorio. El cliente vuelve a subir la capa.
- Un servicio de tokens para tokens Bearer. Envíe la propia clave con Basic o Bearer.
- Una caché pull-through de Docker Hub o de otros registros.
- Manifiestos Docker schema 1 y digests distintos de `sha256`.
- Eliminar capas individuales.
- Una sección de imágenes en la consola.

## HTTP sin cifrar para pruebas {#plain-http-for-tests}

Docker rechaza un registro sin HTTPS. De forma predeterminada, solo las direcciones del equipo local (`localhost`, `127.0.0.0/8`) funcionan con HTTP sin cifrar. Para un servidor de pruebas en otro host, agréguelo a `insecure-registries` en la configuración del daemon de Docker (`/etc/docker/daemon.json` en Linux) y reinicie Docker:

```json
{
  "insecure-registries": ["arkvory.test:8080"]
}
```

Podman usa la opción `--tls-verify=false`. Con HTTP sin cifrar, la clave viaja en texto claro. Use esta opción solo en una red de pruebas.

Para un certificado de su propia entidad de certificación, Docker en Linux lee la CA de `/etc/docker/certs.d/<host>/ca.crt` (con el puerto, si no es el 443). Docker Desktop usa el almacén de confianza del sistema.

## Solución de problemas {#troubleshooting}

Docker muestra los códigos de error del registro en minúsculas y con espacios, por ejemplo `denied` o `name invalid`, seguidos del mensaje del servidor. Cada error incluye además un ID de solicitud en `detail.requestId`. Facilítelo a su administrador: con él encuentra la solicitud en el registro del servidor.

| Error                                             | Causa                                                                                                                   | Qué hacer                                                                                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED` (401)                              | La clave falta, es incorrecta, ha caducado o se ha revocado                                                             | Inicie sesión de nuevo con una clave válida                                                                                                                                                                            |
| `DENIED` (403)                                    | La clave no puede escribir o no ve el repositorio. Un token con ámbito `read` recibe «Read-only personal access token». | Use una clave con acceso de escritura a este repositorio                                                                                                                                                               |
| `DENIED` (409)                                    | El repositorio es un espejo                                                                                             | Suba al servidor principal                                                                                                                                                                                             |
| `DENIED` (507)                                    | Se alcanzó la cuota del repositorio o la capacidad de la instalación. También cuentan las subidas sin terminar.         | Libere espacio o solicite una cuota mayor                                                                                                                                                                              |
| `NAME_INVALID`                                    | La referencia no tiene parte de imagen después del repositorio, o tiene mayúsculas                                      | Use `<host>/<repository>/<image>:<tag>` en minúsculas                                                                                                                                                                  |
| `MANIFEST_UNKNOWN`                                | El tag o el digest no existe en esta imagen                                                                             | Compruebe el nombre con `tags/list`                                                                                                                                                                                    |
| `MANIFEST_BLOB_UNKNOWN`                           | Un manifiesto hace referencia a una capa o a un manifiesto de plataforma que no está en este repositorio                | Suba de nuevo la imagen completa para que el cliente suba las partes que faltan                                                                                                                                        |
| `DIGEST_INVALID`                                  | Los bytes no coinciden con el digest                                                                                    | Suba de nuevo. Si se repite, revise el proxy.                                                                                                                                                                          |
| `TOOMANYREQUESTS` (503 o 429)                     | Hay demasiadas transferencias de esta clave a la vez, o el servidor está ocupado                                        | Espere y reintente. Reduzca las subidas en paralelo del cliente, por ejemplo `"max-concurrent-uploads": 1` en la configuración del daemon de Docker, o pida al administrador que aumente los límites de transferencia. |
| `http: server gave HTTP response to HTTPS client` | El servidor no tiene HTTPS                                                                                              | Configure [HTTPS](../install/https) o use `insecure-registries` para un servidor de pruebas                                                                                                                            |
| `x509: certificate signed by unknown authority`   | Docker no confía en el certificado                                                                                      | Instale el certificado de la CA como se describe más arriba                                                                                                                                                            |
| `413 Request Entity Too Large`                    | El proxy inverso limita el tamaño de las solicitudes                                                                    | Establezca `client_max_body_size 0` en nginx                                                                                                                                                                           |
| Una capa grande se detiene a los 30 minutos       | El plazo de subida de una solicitud                                                                                     | Use una red más rápida, o mantenga esos archivos fuera de las imágenes y súbalos con `arkvoryctl`                                                                                                                      |

## Páginas relacionadas {#related-pages}

- [Clientes y protocolos](./index)
- [Cuentas y claves](../use/accounts)
- [HTTPS](../install/https)
- [Almacenamiento](../operate/storage)
- [Espejos](../operate/mirrors) y [Puertas de enlace de lectura](../operate/read-gateways)
