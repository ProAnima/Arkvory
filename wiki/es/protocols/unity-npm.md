---
title: Paquetes de Unity y npm
description: Use un repositorio como registro con ámbito para el Unity Package Manager y como registro npm para publicar e instalar paquetes.
---

# Paquetes de Unity y npm

Cada repositorio de Arkvory es un registro compatible con npm en `https://<host>/npm/<repository>/`. El Unity Package Manager lo lee como un registro con ámbito, y `npm` publica en él e instala desde él. Los estudios lo usan para SDK, herramientas y módulos que comparten varios proyectos de Unity, cada uno con su propia versión.

Los archivos tarball de los paquetes son artefactos normales, así que los permisos del repositorio, las cuotas, las comprobaciones SHA-256, las copias de seguridad y los espejos se aplican a ellos.

## Antes de empezar {#before-you-start}

Necesita:

- La dirección del servidor con HTTPS (consulte [HTTPS](../install/https)).
- Un repositorio, por ejemplo `games`. Su dirección de registro es `https://arkvory.example/npm/games/`.
- Una clave. Los desarrolladores usan un token de acceso personal con el ámbito `read`. Los agentes de compilación que publican usan un token personal con el ámbito `read-write` o una clave de servicio. Consulte [Cuentas y claves](../use/accounts).

Arkvory envía la dirección de cada tarball al cliente en los datos del paquete. La dirección se construye a partir del nombre de host con el que llegó el cliente. Cuando un proxy inverso termina HTTPS, debe pasar la cabecera `Host` y enviar `X-Forwarded-Proto: https`, como en el ejemplo de nginx de la instalación. De lo contrario, el cliente recibe direcciones `http://` de los tarballs.

## Agregar el registro a un proyecto de Unity {#unity-manifest}

1. Abra `Packages/manifest.json` del proyecto y agregue un registro con ámbito:

```json
{
  "scopedRegistries": [
    {
      "name": "Arkvory",
      "url": "https://arkvory.example/npm/games/",
      "scopes": ["com.proanima"]
    }
  ],
  "dependencies": {
    "com.proanima.tools": "1.2.0"
  }
}
```

2. Dé la clave a Unity. No la ponga en el proyecto. Cree el archivo `.upmconfig.toml` en su carpeta de usuario (`%USERPROFILE%\.upmconfig.toml` en Windows, `~/.upmconfig.toml` en macOS y Linux):

```toml
[npmAuth."https://arkvory.example/npm/games/"]
token = "<your Arkvory key>"
alwaysAuth = true
```

3. Reinicie Unity. En la ventana Package Manager, abra **My Registries** para ver los paquetes del registro.

Notas:

- `scopes` son prefijos de nombres de paquete. Unity toma de Arkvory los paquetes cuyos nombres empiezan por un scope, y todos los demás paquetes del registro de Unity.
- La dirección en `.upmconfig.toml` debe ser la misma que `url` en el manifiesto, incluida la barra final.
- `alwaysAuth = true` es obligatorio. El registro no envía un desafío de inicio de sesión, así que Unity debe enviar el token con cada solicitud.
- Los nombres de paquete de Unity son nombres de dominio inverso en minúsculas, como `com.company.package`. Unity no admite nombres con `@scope/`.

Confirme `Packages/manifest.json` con el proyecto. Cada desarrollador conserva su propio `.upmconfig.toml`.

## Publicar un paquete {#publish}

Un paquete es una carpeta con un `package.json` en la parte superior. Publíquelo con `npm`.

1. En la carpeta del paquete, cree un archivo `.npmrc`:

```ini
registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

2. Establezca la clave en el entorno y publique:

```bash
export ARKVORY_TOKEN="$(cat ~/.arkvory/key)"
npm publish
```

```powershell
$env:ARKVORY_TOKEN = (Get-Content C:\Private\arkvory.key -Raw).Trim()
npm publish
```

La línea con `_authToken` debe empezar por la dirección del registro sin `https:`. Mantenga la clave fuera de `.npmrc`: npm reemplaza `${ARKVORY_TOKEN}` desde el entorno.

En lugar de la línea `registry` en `.npmrc`, puede establecer el registro en el `package.json` del paquete:

```json
{
  "name": "com.proanima.tools",
  "version": "1.2.0",
  "publishConfig": { "registry": "https://arkvory.example/npm/games/" }
}
```

Lo que comprueba el registro:

- **Nombre y versión.** `name` y `version` en el `package.json` dentro del tarball deben coincidir con los publicados. La versión sigue SemVer 2.0.0, por ejemplo `1.2.0` o `2.0.0-beta.1`. El registro lee los datos de la versión de este archivo, no del JSON que envía el cliente.
- **Sumas de comprobación.** La longitud, `shasum` e `integrity` que declara el cliente deben coincidir con los bytes. Una discrepancia devuelve `422 integrity_mismatch`.
- **El tarball.** Debe contener `<folder>/package.json`, como lo genera `npm pack`. Un segundo `package.json` en el archivo se rechaza, porque npm y el registro podrían leer archivos distintos.
- **Una versión es inmutable.** El mismo tarball publicado de nuevo tiene éxito y no cambia nada (`200`). Otro contenido para una versión existente devuelve `409` con el motivo `version_exists`. Publique la corrección como la siguiente versión.

`npm publish` lee el paquete del registro antes de publicarlo, así que dé a una clave de publicación `content.read` y `artifact.list` además de `upload.create`. Consulte [Permisos](#permissions).

La versión está disponible en cuanto `npm publish` termina. El tarball de una versión se almacena como el artefacto `<name>-<version>.tgz` con la etiqueta `npm`. Para un nombre con scope, `@team/util` se convierte en `util-<version>.tgz`.

## Instalar paquetes {#install}

En Unity, agregue la dependencia en el manifiesto o elija el paquete en la ventana Package Manager, en **My Registries**.

Para npm, establezca el registro en el `.npmrc` del proyecto o del usuario. Un registro para un scope es la opción habitual, porque Arkvory no reenvía solicitudes al registro público de npm:

```ini
@team:registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

```bash
npm install @team/util
npm view @team/util versions
npm search tools
```

Si establece `registry=` en Arkvory para todo el proyecto, npm busca cada paquete allí, incluidos los públicos como `lodash`, y falla con `404`. Use un registro con ámbito o un proyecto que contenga solo sus propios paquetes.

npm comprueba `dist.integrity` mientras instala y escribe la dirección del registro en `package-lock.json`.

## Versiones y dist-tags {#versions-and-tags}

Un dist-tag es un nombre móvil para una versión. `npm publish` establece `latest` en la nueva versión. Otras etiquetas ayudan a separar canales de publicación.

```bash
npm publish --tag beta
npm dist-tag add com.proanima.tools@1.3.0 latest
npm dist-tag ls com.proanima.tools
npm dist-tag rm com.proanima.tools beta
```

```bash
npm install com.proanima.tools@beta
```

| Regla                | Valor                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| Nombre de etiqueta   | Empieza por una letra. Letras, dígitos, `.`, `_` y `-`. Hasta 64 caracteres. |
| Etiquetas prohibidas | Un nombre que parece una versión (`v1`, `v2.0`), y `x` o `X`                 |
| `latest`             | Siempre apunta a una versión. Se puede mover, no eliminar (`409`).           |
| Mover una etiqueta   | `npm dist-tag add`, o publicar con `--tag`. La nueva versión debe existir.   |

Una etiqueta es solo un nombre: no elimina ni oculta otras versiones.

No hay forma de eliminar una versión publicada. Consulte [Funciones no admitidas](#not-supported).

## Búsqueda {#search}

La lista **My Registries** de Unity y `npm search` usan la dirección de búsqueda `/-/v1/search`. La búsqueda encuentra los paquetes cuyo nombre o descripción contiene el texto, sin distinguir mayúsculas, y los paquetes que tienen el texto como palabra clave completa. Sin texto, lista todos los paquetes.

- Devuelve una línea por paquete: la versión con la etiqueta `latest`, o si no, la versión más reciente.
- Los resultados se ordenan por nombre. No hay clasificación por popularidad.
- `size` es 20 de forma predeterminada y como máximo 250. `from` es el desplazamiento.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example/npm/games/-/v1/search?text=tools&from=0&size=20"
```

Para leer un paquete directamente, solicite su nombre. `@scope/name` se puede enviar como `@scope%2fname`:

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" https://arkvory.example/npm/games/com.proanima.tools
```

La respuesta lista cada versión con el contenido de su `package.json` (incluidos los campos `unity` y `displayName` que Unity lee), los dist-tags y los momentos de publicación. `dist` tiene `tarball`, `shasum` (SHA-1) e `integrity` (SHA-512).

## Nombres y límites {#limits}

| Elemento                                | Regla                                                                                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nombre del paquete                      | Letras minúsculas, dígitos, `.`, `_`, `~` y `-`, empezando por una letra o un dígito. Hasta 214 caracteres. `@scope/name` se permite para npm.                                          |
| Versión                                 | SemVer 2.0.0, hasta 256 caracteres                                                                                                                                                      |
| `package.json` en el tarball            | Hasta 256 KiB. Los datos de todas las versiones vienen en una sola respuesta, así que manténgalo pequeño.                                                                               |
| Tarball                                 | Hasta el tamaño máximo de objeto de la instalación, `ARKVORY_MAX_OBJECT_BYTES` (unos 10 TiB de forma predeterminada). Un archivo que se expande más de 100 veces más 64 MiB se rechaza. |
| El resto de la solicitud de publicación | Hasta 8 MiB de JSON, anidado como máximo 64 niveles. El tarball se lee como flujo y no se mantiene en memoria.                                                                          |
| Una solicitud de publicación            | Debe terminar en 30 minutos y no debe quedar detenida más de 30 segundos (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`)                                               |
| Subidas simultáneas                     | 2 por servidor y 1 por clave de forma predeterminada. Una solicitud en espera se abandona a los 20 segundos.                                                                            |
| Texto de búsqueda                       | Hasta 256 caracteres                                                                                                                                                                    |

`npm publish` es una sola solicitud, y empieza de nuevo desde el primer byte tras un fallo. Para paquetes de muchos gigabytes, suba el archivo con [`arkvoryctl`](./cli) como artefacto o [archivo raw](./raw-files). Los recursos binarios grandes que cambian a menudo se colocan mejor en [Git LFS](./git-lfs); mantenga el código y los recursos estables en paquetes.

Los límites del servidor están en [Variables de entorno](../reference/environment#transfers-and-bandwidth).

## Permisos {#permissions}

Los tokens personales y las claves de archivo obtienen acceso de lectura o de escritura al repositorio. Las claves de servicio obtienen acciones exactas.

| Operación                                        | Acciones de la clave de servicio | Token personal o clave de archivo                  |
| ------------------------------------------------ | -------------------------------- | -------------------------------------------------- |
| Instalar: leer un paquete y descargar un tarball | `content.read`                   | Acceso de lectura                                  |
| Buscar, listar dist-tags                         | `artifact.list`                  | Acceso de lectura                                  |
| Publicar, agregar y eliminar dist-tags           | `upload.create`                  | Acceso de escritura; token con ámbito `read-write` |

Un desarrollador que solo instala paquetes necesita un token con el ámbito `read`. Un agente de compilación que publica necesita `upload.create`, `content.read` y `artifact.list`. Nadie puede eliminar una versión publicada.

## Puertas de enlace de lectura y espejos {#read-gateways-and-mirrors}

- Una [puerta de enlace de lectura](../operate/read-gateways) atiende la instalación y la búsqueda, porque son solicitudes `GET`. Una publicación recibe `405`.
- Un [espejo](../operate/mirrors) guarda las versiones y las etiquetas de su origen. La instalación y la búsqueda funcionan. La publicación se rechaza con `409` y el motivo `mirror_read_only`. Las direcciones de los tarballs en los datos de un espejo apuntan al espejo.

Para usar un espejo en Unity, ponga la dirección del espejo en `url` y su clave en `.upmconfig.toml`.

## Funciones no admitidas {#not-supported}

- Eliminar una versión (`npm unpublish`). Los proyectos fijan versiones, y una eliminación rompería sus compilaciones. Publique una versión corregida y mueva la etiqueta en su lugar.
- `npm deprecate`, `npm login`, `npm owner`, `npm access` y otros comandos de administración. Las solicitudes que cambian datos en otras rutas responden `405` con «This registry supports publish, install and dist-tags». Cree un token en la consola y póngalo en `.npmrc` en lugar de `npm login`.
- La lista de todos los paquetes en `/-/all`, y `npm audit`.
- Un proxy a los registros públicos. Arkvory almacena sus propios paquetes. Los paquetes de npmjs.com o del registro de Unity se obtienen desde allí.
- La clasificación de los resultados de búsqueda.
- Una sección para paquetes en la consola. Los tarballs aparecen en [[ui:catalog]] como artefactos con la etiqueta `npm`.

## Solución de problemas {#troubleshooting}

Los errores tienen la forma `{"error": "...", "code": "...", "request_id": "..."}`. `npm` imprime `error`. Dé el `request_id` a su administrador para encontrar la solicitud en el registro del servidor.

| Síntoma                                               | Causa                                                                                | Qué hacer                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` en Unity o npm                                  | El cliente no envió la clave, o la clave es incorrecta, ha caducado o se ha revocado | En Unity, compruebe que la dirección en `.upmconfig.toml` sea igual a `url` en el manifiesto y que `alwaysAuth = true`. En npm, compruebe que la línea `_authToken` empiece por el mismo host y la misma ruta que `registry`. |
| `403` al publicar                                     | El token tiene el ámbito `read`, o la clave no tiene `upload.create`                 | Use una clave con acceso de escritura                                                                                                                                                                                         |
| `404` para un paquete                                 | No existe ese paquete en este repositorio, o la clave no ve el repositorio           | Compruebe el repositorio en la dirección y el nombre. Para un paquete de Unity, compruebe que su nombre empiece por un scope de `scopes`.                                                                                     |
| `404` para un paquete público                         | `registry=` apunta a Arkvory para todos los paquetes                                 | Use `@scope:registry=`                                                                                                                                                                                                        |
| `409` con `version_exists`                            | La versión existe con otro contenido                                                 | Publique una versión nueva                                                                                                                                                                                                    |
| `409` con `state_conflict`                            | Intentó eliminar `latest`                                                            | Mueva `latest` a otra versión en su lugar                                                                                                                                                                                     |
| `409` con `mirror_read_only`                          | El repositorio es un espejo                                                          | Publique en el servidor principal                                                                                                                                                                                             |
| `422` con `integrity_mismatch`                        | Los bytes difieren del `shasum` o del `integrity` declarados                         | Empaquete y publique de nuevo. Compruebe que ningún proxy cambie el cuerpo.                                                                                                                                                   |
| `400` «package.json names another package or version» | El `package.json` dentro del tarball difiere del nombre o de la versión publicados   | Ejecute `npm publish` desde una compilación limpia del paquete                                                                                                                                                                |
| `400` «Only publishing a new version is supported»    | El comando envió un paquete modificado, por ejemplo `npm deprecate`                  | Estos comandos no se admiten                                                                                                                                                                                                  |
| `405`                                                 | El comando no es compatible con este registro                                        | Consulte [Funciones no admitidas](#not-supported)                                                                                                                                                                             |
| `507`                                                 | Se alcanzó la cuota del repositorio o la capacidad de la instalación                 | Libere espacio o solicite una cuota mayor                                                                                                                                                                                     |
| `503`                                                 | Demasiadas subidas a la vez                                                          | Espere y reintente                                                                                                                                                                                                            |
| Los tarballs se descargan desde `http://` y fallan    | El proxy no envía `X-Forwarded-Proto: https`                                         | Corrija el proxy como se describe en [Antes de empezar](#before-you-start)                                                                                                                                                    |

## Páginas relacionadas {#related-pages}

- [Clientes y protocolos](./index)
- [Git LFS](./git-lfs)
- [Cuentas y claves](../use/accounts)
- [HTTPS](../install/https)
- [Espejos](../operate/mirrors)
