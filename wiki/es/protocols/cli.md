---
title: Línea de comandos (arkvoryctl)
---

# Línea de comandos (arkvoryctl)

`arkvoryctl` es el cliente remoto de Arkvory para personas y para CI/CD. Sube y descarga en partes, continúa tras las interrupciones y comprueba el SHA-256. Funciona con los permisos de la clave que se le proporciona.

## Instalación {#install}

| Sistema                                                         | Paquete                     | Cómo instalarlo                                                                                                                                   |
| --------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server 2019 o posterior (x64)            | `Arkvory-CLI-Setup-x64.exe` | Ejecútelo. Se instala para el usuario actual, sin derechos de administrador, y agrega `arkvoryctl` al `PATH` del usuario. Abra un terminal nuevo. |
| Debian, Ubuntu (x64)                                            | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                                                                        |
| Fedora y compatibles con RHEL (x64)                             | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                                                                       |
| Cualquier sistema con Node.js 24 (por ejemplo, un runner de CI) | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                                                    |

Los paquetes nativos incluyen su propio Node.js. El archivo único `arkvoryctl.mjs` no tiene dependencias de npm. Tome los archivos de una versión de confianza de `ProAnima/Arkvory` y compare su SHA-256 con `release-checksums.json`. Todavía no hay paquetes para ARM64. Para actualizar, instale una versión estable más reciente. La desinstalación conserva sus perfiles, sus archivos de claves y sus puntos de control.

## Conectarse a un servidor {#connect-to-a-server}

1. Obtenga una clave: un token de acceso personal de la consola o una clave de servicio de su administrador. Consulte [Cuentas y claves](../use/accounts).
2. Guarde la clave en un archivo privado fuera de cualquier repositorio. En Linux use el modo `0600`. En Windows permita el acceso solo a su cuenta.
3. Agregue un perfil y compruebe la conexión:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

`doctor` muestra el servidor, el repositorio, las capacidades y los permisos de la clave. La clave nunca es un argumento de un comando.

## Perfiles y entorno {#profiles-and-environment}

Los perfiles se guardan en `profiles.json`, en `~/.config/arkvory` (en Windows, `.config\arkvory` dentro de la carpeta del usuario). Un perfil guarda la URL del servidor, el repositorio predeterminado y la **ruta** del archivo de la clave, no la clave.

| Comando                                                                 | Efecto                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | Agrega un perfil. El primer perfil pasa a ser el predeterminado. El repositorio predeterminado es `releases`. |
| `profile list`                                                          | Muestra todos los perfiles y el activo                                                                        |
| `profile use NAME`                                                      | Establece un perfil como predeterminado                                                                       |
| `profile remove NAME`                                                   | Elimina un perfil                                                                                             |

| Variable             | Significado                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | La propia clave. Tiene prioridad sobre cualquier archivo.                                                                                               |
| `ARKVORY_TOKEN_FILE` | Ruta de un archivo de clave. Tiene prioridad sobre el archivo del perfil.                                                                               |
| `ARKVORY_BASE_URL`   | URL del servidor. Si está definida, el archivo de clave del perfil **no** se usa: proporcione la clave mediante `ARKVORY_TOKEN` o `ARKVORY_TOKEN_FILE`. |
| `ARKVORY_CLI_HOME`   | Otra carpeta para `profiles.json`                                                                                                                       |

La URL del servidor debe usar HTTPS. Se permite HTTP sin cifrar solo para `localhost`, `127.0.0.1` y `[::1]`. La verificación de TLS no se puede desactivar.

## Opciones globales {#global-options}

| Opción                    | Valor predeterminado | Significado                                                                                                          |
| ------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--profile NAME`          | perfil activo        | Perfil solo para este comando                                                                                        |
| `--repository NAME`       | el del perfil        | Repositorio solo para este comando                                                                                   |
| `--json`                  | desactivado          | Un resultado JSON compacto en stdout; los errores en JSON en stderr                                                  |
| `--lang en` o `--lang ru` | el de `LANG`         | Idioma de la ayuda y de los mensajes                                                                                 |
| `--timeout MS`            | 60000                | Límite de las solicitudes de administración (1 a 3600000)                                                            |
| `--attempt-timeout MS`    | 120000               | Límite de un intento de transferencia (1 a 1800000)                                                                  |
| `--retries N`             | 20                   | Reintentos de red de una operación (0 a 100); `0` los desactiva                                                      |
| `--verbose`               | desactivado          | Una línea en stderr por cada solicitud HTTP: método, ruta, estado, tiempo, ID de solicitud. Sin cabeceras ni claves. |
| `--help`, `--version`     |                      | Ayuda; versión del cliente como JSON                                                                                 |
| `--`                      |                      | Termina las opciones, para nombres de archivo que empiezan por `-`                                                   |

Cada opción puede aparecer una sola vez. Las opciones desconocidas se rechazan.

## Comandos {#commands}

### Descubrimiento y catálogo {#discovery-and-catalog}

| Comando                                                                    | Resultado                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------- |
| `doctor`                                                                   | Conexión, capacidades y permisos                    |
| `repositories [--after CURSOR]`                                            | Repositorios visibles para la clave                 |
| `operations [--after CURSOR]`                                              | Operaciones de la API disponibles en el repositorio |
| `list [--after CURSOR]`                                                    | Artefactos del repositorio                          |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | Búsqueda por nombre y por texto de metadatos        |
| `search --metadata-key KEY --metadata-value VALUE`                         | Coincidencia exacta de metadatos (indique ambos)    |
| `inspect ID`                                                               | Metadatos de un artefacto                           |
| `storage usage` / `storage policy`                                         | Uso del repositorio y política de almacenamiento    |

Las páginas devuelven `next`. Páselo con `--after` para leer la página siguiente.

### Transferencias {#transfers}

| Comando                                                                        | Resultado                                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | Subida reanudable de cualquier archivo                                                                                         |
| `download ID OUTPUT`                                                           | Descarga reanudable, verificada con SHA-256                                                                                    |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | Sube el archivo y lo convierte en la siguiente revisión de una ruta. Si la ruta ya contiene los mismos bytes, no se sube nada. |
| `get PATH OUTPUT`                                                              | Descarga la revisión actual de una ruta, verificada y reanudable                                                               |
| `link ID [--ttl SECONDS]`                                                      | Una URL de descarga sin clave, válida de 60 segundos a 24 horas (1 hora de forma predeterminada)                               |
| `uploads status ID` / `uploads cancel ID`                                      | Estado de una sesión de subida; cancelarla (cancelar no es pausar)                                                             |

`METADATA.json` contiene `labels` y `metadata` (un mapa de cadenas). Tiene prioridad sobre `--label`.

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

Un enlace de descarga es un secreto. No se puede revocar antes de que caduque.

### Paquetes y promoción {#packages-and-promotion}

| Comando                                                                                                               | Resultado                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | Paquetes UPack                                                         |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | Sube un archivo UPack y lo registra                                    |
| `packages register ID`                                                                                                | Registra un UPack ya subido                                            |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | Selecciona una versión (`--exact` y `--range` se excluyen mutuamente)  |
| `packages download NAME OUTPUT [same filters]`                                                                        | Selecciona una versión y después la descarga verificada                |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | Publica el artefacto en otro repositorio sin volver a enviar los bytes |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | Etapas de los artefactos                                               |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | Historial de promociones                                               |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

Use `--exact` para una versión exacta; `--version` muestra la versión del cliente. Consulte [Paquetes](../use/packages) y [Promoción](../use/promotion).

### Anotaciones y adjuntos {#annotations-and-attachments}

`annotations get ID` y `annotations set ID --revision N --file ANNOTATIONS.json` leen y reemplazan las etiquetas, los metadatos y las colecciones. `attachments get ID`, `attachments history ID` y `attachments set ID --revision N --file ATTACHMENTS.json` hacen lo mismo con los archivos vinculados de una compilación. Lea primero y después envíe el estado nuevo completo con la revisión que leyó. Un cambio concurrente devuelve un conflicto (código de salida 6).

### Copias de seguridad {#backups}

| Comando                                                           | Resultado                                                                                                      |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `backup status`                                                   | Almacén de copias, agente, plan, último punto, advertencias; código de salida 9 si hay una advertencia crítica |
| `backup run`                                                      | Pone en cola una tarea de copia de seguridad                                                                   |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | Tareas y puntos de restauración, del más reciente al más antiguo                                               |
| `backup verify POINT_ID`                                          | Pone en cola una verificación completa de un punto                                                             |
| `backup pin POINT_ID [--off]`                                     | Conserva un punto más allá de la retención, o lo libera                                                        |

Estos comandos requieren la clave de archivo del propietario de la instalación (bootstrap) o una sesión de administrador de cuenta. Los tokens personales y las claves de servicio reciben 403 (código de salida 3). El trabajo lo realiza el agente de copias de seguridad del servidor. Ejemplo de monitorización: `arkvoryctl backup status --json || alert`. Consulte [Copias de seguridad](../operate/backups).

## Reanudar las transferencias interrumpidas {#resume-interrupted-transfers}

Tras Ctrl+C o un fallo de red, ejecute de nuevo **el mismo comando con las mismas opciones**.

- `upload`, `put` y `packages publish` guardan un punto de control junto al archivo de origen: `<source>.arkvory-upload.json`, o el archivo indicado con `--state`. El punto de control almacena la clave de idempotencia antes de la primera solicitud, de modo que una respuesta perdida nunca crea una segunda copia.
- Para publicar los mismos bytes como un artefacto **nuevo**, use un archivo `--state` nuevo.
- `download` y `get` guardan `<output>.arkvory-part` y `<output>.arkvory-download.json` junto al archivo de destino. El archivo final aparece solo después de la verificación del SHA-256. Un archivo de destino existente nunca se sobrescribe.
- En CI, cree la carpeta de estado antes del trabajo y consérvela, junto con el archivo de origen, entre los reintentos.

Guarde los puntos de control en un disco local que admita vínculos físicos (NTFS, ext4, XFS), no en FAT, exFAT ni en recursos compartidos de red. Tras una caída brusca queda un archivo `.lock`. Compruebe que el proceso cuyo PID contiene ya se ha detenido y elimine solo el archivo `.lock`.

## Ejemplo de CI {#ci-example}

```bash
# La clave procede del almacén de secretos de CI. No la imprima nunca.
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

Si el registro falla después de la subida, el error JSON contiene `stage: "register"` y el `artifactId`. Repita el mismo comando. Volver a registrar el mismo artefacto es seguro.

### Sistemas de CI {#ci-systems}

Todos los sistemas siguientes hacen lo mismo: instalan un `arkvoryctl.mjs` fijado, toman la clave del almacén de secretos del sistema y ejecutan un comando. Fije la versión y el SHA-256 para que una descarga modificada haga fallar el trabajo. Use una clave de servicio limitada al repositorio y a las acciones que necesita el trabajo ([Cuentas y claves](../use/accounts)). El agente necesita Node.js 24.

```yaml
# GitHub Actions: .github/workflows/publish.yml
name: publish
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      ARKVORY_BASE_URL: https://arkvory.example
      ARKVORY_TOKEN: ${{ secrets.ARKVORY_KEY }}
      ARKVORY_CLI_VERSION: '0.3.0'
      ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install arkvoryctl
        run: |
          curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
          echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
      - name: Publish the build
        run: node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${GITHUB_REF_NAME}/Game.zip" --json
```

```yaml
# GitLab CI: .gitlab-ci.yml (ARKVORY_TOKEN is a masked CI/CD variable)
publish:
  image: node:24
  variables:
    ARKVORY_BASE_URL: https://arkvory.example
    ARKVORY_CLI_VERSION: '0.3.0'
    ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
  script:
    - curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
    - echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
    - node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${CI_COMMIT_TAG}/Game.zip" --json
```

```groovy
// Jenkins: Jenkinsfile. The agent has Node.js 24 and a checked arkvoryctl.mjs, installed as above.
pipeline {
  agent any
  environment {
    ARKVORY_BASE_URL = 'https://arkvory.example'
    ARKVORY_TOKEN = credentials('arkvory-key')
  }
  stages {
    stage('Publish') {
      steps {
        sh 'node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${BUILD_NUMBER}/Game.zip" --json'
      }
    }
  }
}
```

Cualquier otro sistema, como TeamCity o Buildkite, funciona igual: defina `ARKVORY_BASE_URL` y `ARKVORY_TOKEN` desde su almacén de secretos y ejecute el comando. Decida según el [código de salida](#exit-codes).

## Salida {#output}

- Los resultados son JSON en stdout. Sin `--json`, el JSON lleva sangría. Los comandos de copias de seguridad imprimen líneas legibles salvo que agregue `--json`.
- El progreso aparece solo en un stderr interactivo.
- Un error sin `--json` es una línea en stderr con el código del servidor, el motivo, el mensaje, el paso siguiente y el ID de solicitud. Con `--json`, stderr contiene `{"error": {...}}` con `code`, `exitCode`, `status`, `serverCode`, `reason`, `requestId` y `retryAfterSeconds`. Si el código es desconocido, decida según `exitCode`.

## Códigos de salida {#exit-codes}

| Código | Significado                                                                                |
| ------ | ------------------------------------------------------------------------------------------ |
| 0      | Correcto                                                                                   |
| 2      | Argumentos o configuración incorrectos                                                     |
| 3      | Falta la clave o se denegó el acceso (401, 403)                                            |
| 4      | Error HTTP o de red, tiempo de espera agotado, servidor ocupado, no encontrado             |
| 5      | Fallo de integridad (SHA-256 distinto, 422 `integrity_mismatch`)                           |
| 6      | Conflicto: revisión, estado, bloqueo, archivo existente, punto de control modificado (409) |
| 7      | Error de archivo local o respuesta del servidor no válida                                  |
| 8      | Límite de capacidad del servidor: cuota, disco, cola (507 `capacity_exceeded`)             |
| 9      | `backup status`: hay una advertencia crítica de copia de seguridad activa                  |
| 130    | Interrumpido                                                                               |

El cliente reintenta solo los fallos de red y los códigos HTTP 408, 429, 502, 503 y 504, dentro del límite de `--retries`.

## Solución de problemas {#troubleshooting}

| Mensaje                                 | Causa y solución                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `credential_required` (salida 3)        | No se encontró ninguna clave. Compruebe `--token-file` y `ARKVORY_TOKEN_FILE`, o proporcione la clave cuando se use `ARKVORY_BASE_URL`.          |
| `forbidden` (salida 3)                  | La clave no tiene el permiso. Ejecute `doctor` para ver los permisos.                                                                            |
| `checkpoint_mismatch` (salida 6)        | El archivo, el servidor, el repositorio o las opciones difieren del punto de control guardado. Use las opciones originales o un `--state` nuevo. |
| `state_locked` (salida 6)               | Otro proceso usa el punto de control, o queda un `.lock` antiguo tras una caída.                                                                 |
| `destination_exists` (salida 6)         | El archivo de destino existe. Elija otro nombre.                                                                                                 |
| `revision_mismatch` en `put` (salida 6) | Alguien cambió la ruta mientras tanto. Revise el historial de la ruta y después decida.                                                          |
| salida 8                                | La cuota o el disco están llenos. Consulte al administrador.                                                                                     |

## Páginas relacionadas {#related-pages}

- [Clientes y protocolos](./index)
- [Transferencias](../use/transfers) y [Archivos por ruta](../use/files)
- [SDK de TypeScript](./sdk)
- [Errores](../api/errors)
