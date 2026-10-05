---
title: Git LFS
description: Almacene los archivos grandes de un repositorio git en Arkvory y bloquee los recursos binarios, por ejemplo para proyectos de Unity y Unreal.
---

# Git LFS

Cada repositorio de Arkvory es un servidor Git LFS. Su repositorio git permanece donde está, por ejemplo en GitHub, GitLab o Gitea. Solo los archivos grandes que Git LFS rastrea y los bloqueos de archivos van a Arkvory. Los objetos LFS son artefactos normales, así que los permisos del repositorio, las cuotas, las comprobaciones SHA-256, las copias de seguridad y los espejos se aplican a ellos.

## Configurar un repositorio git {#set-up}

Necesita la dirección del servidor con HTTPS (consulte [HTTPS](../install/https)), un repositorio de Arkvory, por ejemplo `games`, y una clave (consulte [Cuentas y claves](../use/accounts)).

1. Instale Git LFS en cada máquina que use el repositorio y ejecute `git lfs install` una vez por usuario.
2. Cree el archivo `.lfsconfig` en la raíz del repositorio git y confírmelo. Hace que todo el equipo use Arkvory:

```ini
[lfs]
	url = https://arkvory.example/lfs/games
```

3. Rastree los patrones de archivo. Esto escribe `.gitattributes`, que también debe confirmar:

```bash
git lfs track "*.psd" "*.fbx" "*.wav" "*.uasset" "*.umap"
git add .gitattributes .lfsconfig
```

4. Confirme y envíe (push) como de costumbre. La primera solicitud pide credenciales: consulte [Iniciar sesión](#sign-in).

La dirección LFS de un repositorio es siempre `https://<host>/lfs/<repository>`.

Para mover archivos que ya están en LFS en otro servidor, primero descargue todos los objetos del servidor antiguo, después cambie `lfs.url` y súbalos:

```bash
git lfs fetch --all origin
git config lfs.url https://arkvory.example/lfs/games
git lfs push --all origin
```

## Iniciar sesión {#sign-in}

Arkvory toma la clave como contraseña de la autenticación HTTP Basic. El nombre de usuario no se comprueba: use cualquier nombre. La clave también puede llegar como token Bearer.

Git pide el nombre de usuario y la contraseña mediante su credential helper la primera vez que el servidor responde `401`. El helper los guarda: Git Credential Manager en Windows y macOS, `credential.helper store` o `cache` en Linux.

| Quién                       | Clave                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Desarrollador               | Un token de acceso personal. Ámbito `read-write` para push y bloqueos, ámbito `read` solo para clonar y descargar (pull). |
| Servidor de compilación, CI | Una clave de servicio con las acciones de [Permisos](#permissions)                                                        |

Git guarda las credenciales por host. La clave de Arkvory no reemplaza la credencial del host de su repositorio git, por ejemplo GitHub.

En un runner de CI sin credential helper, ponga la clave en la configuración local del checkout. Así la clave solo vive en `.git/config` de ese espacio de trabajo, nunca en `.lfsconfig`:

```bash
git config lfs.url "https://ci:${ARKVORY_KEY}@arkvory.example/lfs/games"
```

No confirme una clave. No la imprima en los registros. Elimine el espacio de trabajo después del trabajo.

## Trabajo diario {#daily-work}

Git LFS funciona como con cualquier servidor LFS. Los comandos que usa:

| Comando                                 | Qué hace                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `git push`                              | Sube los objetos LFS nuevos a Arkvory antes de enviar las confirmaciones                 |
| `git clone`, `git pull`, `git checkout` | Descarga los objetos que necesita el árbol de trabajo                                    |
| `git lfs fetch --all`                   | Descarga los objetos de todas las ramas                                                  |
| `git lfs ls-files`                      | Lista los archivos rastreados y sus ID cortos                                            |
| `git lfs push --all origin`             | Vuelve a subir todos los objetos locales. Los objetos que Arkvory ya tiene no se envían. |

Un objeto que Arkvory ya tiene, con el mismo ID y tamaño, no se vuelve a enviar. Un push repetido tras una interrupción envía solo lo que falta.

## Bloquear archivos {#locks}

Los recursos binarios no se pueden fusionar. Un bloqueo indica al equipo que una persona está editando un archivo. Los bloqueos pertenecen al repositorio de Arkvory, no a una rama.

```bash
git lfs lock Content/Maps/Level01.umap
git lfs locks
git lfs unlock Content/Maps/Level01.umap
```

- Un segundo `git lfs lock` sobre la misma ruta falla con «already created lock» e indica el propietario.
- El propietario se muestra con el nombre del usuario o de la cuenta de servicio cuando se creó el bloqueo. Una clave de archivo muestra su ID.
- Solo el propietario desbloquea un archivo. `git lfs unlock --force` sobre el bloqueo de otra persona necesita una clave de servicio con la acción `artifact.delete` en el repositorio. Los tokens personales no pueden romper bloqueos.
- Una ruta de bloqueo es una ruta del repositorio git: hasta 1024 caracteres, con `/` entre carpetas y sin segmentos vacíos, `.` o `..`, barra invertida ni dos puntos.
- `git lfs locks` muestra 100 bloqueos por página.

Active la comprobación antes del push, para que git se niegue a enviar cambios a archivos que otros han bloqueado. La opción es por dirección de servidor:

```bash
git config lfs.https://arkvory.example/lfs/games.locksverify true
```

Marque los tipos de archivo que deben bloquearse antes de editarlos. Git LFS entonces los mantiene de solo lectura hasta que los bloquee:

```bash
git lfs track --lockable "*.umap" "*.uasset"
```

La comprobación de bloqueos al hacer push necesita acceso de escritura, así que un token de solo lectura no puede usarla. Use `git lfs locks` para listar bloqueos, que el acceso de lectura sí permite.

## Consejos para Unity y Unreal {#game-engines}

- Unity: mantenga los recursos de texto (`.unity`, `.prefab`, `.asset`) en git y establezca la serialización de recursos en Force Text. Rastree los binarios grandes en LFS, por ejemplo `*.png`, `*.psd`, `*.fbx`, `*.wav`, `*.mp4`, `*.exr`. También se aceptan los archivos de texto que rastree en LFS.
- Unreal Engine: rastree `*.uasset`, `*.umap` y los archivos de código fuente grandes, y marque `*.uasset` y `*.umap` como bloqueables.
- Las integraciones del editor que llaman a los comandos de bloqueo de LFS usan el protocolo estándar de bloqueo de archivos de Git LFS. Arkvory se prueba con los clientes de línea de comandos `git` y `git-lfs`.
- No ponga resultados de compilación cambiantes de decenas de gigabytes en LFS. Súbalos como artefactos o [archivos raw](./raw-files) con [`arkvoryctl`](./cli). La retención nunca elimina los objetos LFS, así que permanecen para siempre.
- El código o las herramientas grandes y reutilizables que comparten los proyectos de Unity se sirven mejor con [paquetes de Unity](./unity-npm).

## Qué se almacena {#what-is-stored}

- Un objeto LFS es un artefacto del repositorio de Arkvory. Su nombre y su identidad son el SHA-256 de su contenido (el `oid` de LFS), y tiene la etiqueta `lfs`. Verá estos artefactos en la consola en [[ui:catalog]].
- Arkvory comprueba el tamaño y el SHA-256 mientras recibe el objeto. Si difieren del `oid`, la subida falla con `422` y no se almacena nada.
- Un objeto pertenece al repositorio. Dos repositorios de Arkvory guardan sus propias copias del mismo archivo.
- La retención nunca elimina los objetos LFS, porque el servidor no puede ver qué confirmaciones aún los necesitan. No hay ningún comando para eliminar un objeto LFS. Planifique la cuota del repositorio para todo el historial de los recursos.
- Los bloqueos son filas de la base de datos. Las copias de seguridad los incluyen.

## Permisos {#permissions}

Los tokens personales y las claves de archivo obtienen acceso de lectura o de escritura al repositorio. Las claves de servicio obtienen acciones exactas.

| Operación                                       | Acciones de la clave de servicio | Token personal o clave de archivo                  |
| ----------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| Descargar (`clone`, `fetch`, `pull`)            | `content.read`                   | Acceso de lectura                                  |
| Subir (`push`)                                  | `upload.create`                  | Acceso de escritura; token con ámbito `read-write` |
| Listar bloqueos                                 | `artifact.list`                  | Acceso de lectura                                  |
| Crear, verificar y liberar los bloqueos propios | `upload.create`                  | Acceso de escritura; token con ámbito `read-write` |
| Liberar el bloqueo de otra persona (`--force`)  | `artifact.delete`                | No es posible                                      |

Un trabajo de CI que hace push y pull necesita `content.read`, `upload.create` y `artifact.list`. Una clave que solo puede hacer push igualmente se entera de que un objeto existe, así que no lo sube dos veces.

Un token personal de solo lectura puede clonar y descargar aunque la solicitud de la lista de descargas sea un `POST`. No puede subir ni bloquear. Los espejos y las puertas de enlace de lectura se tratan en [Espejos y puertas de enlace de lectura](#mirrors-and-read-gateways).

## Cómo funciona la transferencia {#how-it-works}

No necesita estos detalles para el trabajo diario. Ayudan cuando depura un proxy o un firewall.

1. Git LFS envía un `POST /lfs/<repository>/objects/batch` con la operación (`download` o `upload`) y la lista de objetos. Hasta 1000 objetos por solicitud. Git LFS envía como máximo 100 de forma predeterminada.
2. Arkvory responde con un enlace para cada objeto que debe transferirse, válido durante una hora. Para una subida, omite los objetos que ya tiene.
3. Git LFS envía cada objeto con `PUT`, o lo descarga con `GET`, a `/lfs/<repository>/objects/<oid>`. La solicitud lleva la misma clave que la solicitud batch.
4. Un `PUT` necesita una cabecera `Content-Length`. Una subida por fragmentos (chunked) se rechaza con `422`.

Se admite:

| Elemento                   | Valor                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Adaptador de transferencia | Solo `basic`                                                                                                                        |
| Algoritmo de hash          | Solo `sha256`. Un cliente que pida otro recibe `409`.                                                                               |
| Autenticación              | Basic (clave como contraseña) o Bearer                                                                                              |
| Descarga                   | `GET` y `HEAD` con solicitudes `Range`                                                                                              |
| Tipo de medio              | `application/vnd.git-lfs+json` para las solicitudes JSON. Los cuerpos de objeto de cualquier tipo de medio se almacenan como bytes. |

Los errores son documentos JSON con `message` y `request_id`. Indique el `request_id` cuando pida ayuda a su administrador.

Los enlaces apuntan a la dirección con la que el cliente llegó al servidor. Cuando un proxy inverso termina HTTPS, debe pasar la cabecera `Host` y enviar `X-Forwarded-Proto: https`, como en el ejemplo de nginx de la instalación, para que los enlaces usen `https`. Arkvory pone la clave en un enlace solo cuando el enlace es `https` o apunta al equipo local. Por HTTP sin cifrar hacia otro host, git no puede enviar la clave con el objeto y la transferencia falla.

## Archivos grandes y reanudación {#large-files}

- Git LFS envía cada objeto en una sola solicitud `PUT`. Tras un fallo, empieza el objeto de nuevo desde el primer byte. El adaptador `tus`, que reanuda dentro de un objeto, no se admite.
- Una solicitud de subida debe terminar en 30 minutos y no debe quedar detenida más de 30 segundos (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). Un archivo de muchos gigabytes necesita una red rápida y estable. Para archivos más grandes use [`arkvoryctl`](./cli), que sube en partes.
- Las descargas admiten solicitudes `Range`.
- Un objeto puede ser tan grande como el tamaño máximo de objeto de la instalación (`ARKVORY_MAX_OBJECT_BYTES`, unos 10 TiB de forma predeterminada). Un objeto más grande se rechaza en la respuesta batch con `422`.

De forma predeterminada, el servidor ejecuta 2 subidas a la vez y 1 por clave (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). Git LFS envía 8 objetos a la vez de forma predeterminada. Las demás subidas esperan un hueco libre y se abandonan a los 20 segundos (`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`) con `503`. Git LFS repite un objeto fallido unas cuantas veces, pero un push de archivos grandes es más fiable con menos transferencias en paralelo:

```bash
git config lfs.concurrenttransfers 1
```

También puede pedir al administrador que aumente los límites. Se describen en [Variables de entorno](../reference/environment#transfers-and-bandwidth).

## Espejos y puertas de enlace de lectura {#mirrors-and-read-gateways}

| Lugar                                                   | Clonar y fetch                                                                                    | Push y bloqueos                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Servidor principal                                      | Sí                                                                                                | Sí                                                                                    |
| [Espejo](../operate/mirrors)                            | Sí. El espejo tiene los objetos de su origen, así que apunte `lfs.url` a él.                      | Se rechaza (`409`, motivo `mirror_read_only`). Los bloqueos no se copian a un espejo. |
| [Puerta de enlace de lectura](../operate/read-gateways) | No. La lista de descargas es una solicitud `POST`, que una puerta de enlace de lectura no acepta. | No                                                                                    |

Apunten siempre `lfs.url` al servidor principal o a un espejo para las máquinas de solo lectura.

## Solución de problemas {#troubleshooting}

| Mensaje o síntoma                                                             | Causa                                                                                  | Qué hacer                                                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `401` o un error de autorización                                              | No hay clave, la clave es incorrecta, o el token ha caducado o se ha revocado          | Elimine la credencial guardada en su gestor de credenciales y vuelva a hacer push con una clave válida |
| `403` con «Read-only personal access token»                                   | El token tiene el ámbito `read`                                                        | Cree un token con el ámbito `read-write`                                                               |
| `403`                                                                         | La clave no tiene el acceso para esta operación, o el repositorio no le está concedido | Agregue las acciones de [Permisos](#permissions)                                                       |
| `Lock failed: already created lock`                                           | Alguien tiene el bloqueo                                                               | Pida al propietario que lo desbloquee, o a un administrador que use `--force`                          |
| `422` «Object exceeds the maximum size»                                       | El objeto es más grande que el límite de la instalación                                | Use `arkvoryctl` para esos archivos                                                                    |
| `422` al subir                                                                | El contenido no coincide con el `oid`; el archivo cambió durante el push               | Ejecute `git lfs push` de nuevo                                                                        |
| `503` o `Retry-After`                                                         | Demasiadas transferencias a la vez                                                     | Reduzca `lfs.concurrenttransfers` y reintente                                                          |
| `507`                                                                         | Se alcanzó la cuota del repositorio o la capacidad de la instalación                   | Libere espacio o solicite una cuota mayor                                                              |
| `409` al subir                                                                | El repositorio es un espejo                                                            | Haga push al servidor principal                                                                        |
| Los archivos del árbol de trabajo son archivos de texto pequeños con un `oid` | Los objetos no se descargaron, o no se ejecutó `git lfs install`                       | Ejecute `git lfs install` y después `git lfs pull`                                                     |
| `x509: certificate signed by unknown authority`                               | El cliente no confía en el certificado                                                 | Agregue la entidad de certificación al almacén de confianza del sistema, o establezca `http.sslCAInfo` |

No desactive la verificación TLS (`GIT_SSL_NO_VERIFY`): la clave se envía con cada solicitud.

## Páginas relacionadas {#related-pages}

- [Clientes y protocolos](./index)
- [Cuentas y claves](../use/accounts)
- [HTTPS](../install/https)
- [Espejos](../operate/mirrors)
- [Paquetes de Unity y npm](./unity-npm)
