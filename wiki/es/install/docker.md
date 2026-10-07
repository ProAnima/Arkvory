---
title: Docker Compose
description: 'Ejecute Arkvory como un proyecto de Docker Compose, con sus contenedores, volúmenes, puertos, actualizaciones, agente de copias de seguridad y eliminación.'
---

# Docker Compose

Una instalación de Compose ejecuta la API, el worker, el agente de copias de seguridad y PostgreSQL como contenedores en un solo host. El instalador compila la imagen de Arkvory a partir de la versión y arranca el proyecto `proanima-arkvory`. Úsela en hosts de contenedores. En Windows, Docker Desktop es solo para evaluación: consulte [Windows con Docker Desktop](#docker-desktop).

Compose no incluye HTTPS. Coloque un proxy inverso delante antes de que los clientes se conecten desde otros equipos: consulte [HTTPS y proxy inverso](./https).

## Requisitos {#requirements}

| Elemento           | Requisito                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Motor              | Docker Engine con el complemento de Compose (`docker compose`). Podman con un proveedor de compose compatible es posible con `--engine podman`, pero no está probado                         |
| Cuenta             | `root`, o un usuario del grupo `docker`                                                                                                                                                      |
| Inicio al arrancar | El motor de contenedores debe iniciarse al arrancar, o Arkvory no vuelve tras un reinicio. Compruébelo con `systemctl is-enabled docker`                                                     |
| Host               | Una instalación de Arkvory por host de contenedores. El nombre del proyecto y el puerto son fijos                                                                                            |
| Puerto libre       | 8080 en `127.0.0.1`                                                                                                                                                                          |
| Contenedores       | Solo contenedores Linux. No se admiten contenedores Windows                                                                                                                                  |
| Internet           | `nodejs.org` (el instalador descarga Node.js 24.21.0 y comprueba su SHA-256), el hub de actualizaciones o GitHub (la versión), y Docker Hub (`node:24.21.0-bookworm-slim` y `postgres:18.4`) |

El instalador no instala ni modifica el motor de contenedores, el hipervisor ni WSL.

## El paquete {#bundle}

El instalador toma una versión verificada y la descomprime en `releases/<version>/` dentro de la raíz de la instalación. El archivo de Compose es `releases/<version>/deploy/compose.yml` y el archivo de compilación es `releases/<version>/deploy/Dockerfile`. La imagen `proanima-arkvory:<version>` se compila en su host a partir de `node:24.21.0-bookworm-slim`. No se descarga nada de un registro de Arkvory.

La raíz de la instalación es `/opt/proanima-arkvory` en Linux. Su estructura se describe en [Elegir una instalación](./#installation-directory). En una instalación de Compose los datos no están en `data/`: están en los volúmenes que se describen a continuación.

## Contenedores {#containers}

| Servicio      | Imagen                       | Función                                                                                                     |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `database`    | `postgres:18.4`              | PostgreSQL. Informa de que está listo con `pg_isready` cada 5 segundos                                      |
| `api`         | `proanima-arkvory:<version>` | API HTTP y consola. Publicada en `127.0.0.1:8080`. Comprobación de estado cada 10 segundos                  |
| `worker`      | `proanima-arkvory:<version>` | Finaliza las subidas y ejecuta tareas en segundo plano. Se inicia después de que la API esté sana           |
| `backup`      | `proanima-arkvory:<version>` | Agente de copias de seguridad. Lee el volumen de almacenamiento en solo lectura. No publica ningún puerto   |
| `initialize`  | `proanima-arkvory:<version>` | De un solo uso, como root: asigna al usuario 1000 la propiedad del volumen de almacenamiento                |
| `migrate`     | `proanima-arkvory:<version>` | De un solo uso: ejecuta las migraciones de la base de datos                                                 |
| `vault-owner` | `proanima-arkvory:<version>` | De un solo uso, solo con el perfil `maintenance`: asigna al usuario 1000 la propiedad del almacén de copias |

Los servicios de larga duración se reinician a menos que los detenga. Los contenedores de Arkvory se ejecutan como el usuario `node` (usuario 1000) de la imagen, con un sistema de archivos raíz de solo lectura, un `/tmp` de 64 MiB en memoria, todas las capacidades descartadas, `no-new-privileges` y 120 segundos para detenerse. Docker conserva hasta cinco archivos de registro JSON de 20 MiB por cada contenedor.

## Volúmenes y montajes de enlace {#volumes}

### Volúmenes de Docker {#docker-volumes}

| Volumen                    | Montado en                          | Contenido                                                                                             |
| -------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                  | Contenido de archivos y staging de subidas. El agente de copias de seguridad lo monta en solo lectura |
| `proanima-arkvory_catalog` | `/var/lib/postgresql` en `database` | Los datos de PostgreSQL                                                                               |

Los volúmenes sobreviven a las actualizaciones y a `docker compose down`. Solo `down --volumes` los elimina.

### Montajes de enlace desde la raíz de la instalación {#bind-mounts}

| Ruta del host             | En el contenedor                | Modo                | Montado en                                                        |
| ------------------------- | ------------------------------- | ------------------- | ----------------------------------------------------------------- |
| `config/runtime.json`     | `/run/arkvory/runtime.json`     | solo lectura        | api, worker, backup                                               |
| `config/keys.json`        | `/run/arkvory/keys.json`        | solo lectura        | api, worker                                                       |
| `config/health-token.txt` | `/run/arkvory/health-token.txt` | solo lectura        | api, worker                                                       |
| `config/postgres.env`     | archivo de entorno              |                     | database                                                          |
| `updates/status`          | `/run/arkvory-updates/status`   | solo lectura        | api, worker                                                       |
| `updates/inbox`           | `/run/arkvory-updates/inbox`    | lectura y escritura | api, worker                                                       |
| el almacén de copias      | `/srv/arkvory-vault`            | lectura y escritura | backup, `vault-owner` (solo mientras haya un almacén configurado) |
| `config/mirrors`          | `/run/arkvory/mirrors`          | solo lectura        | api, worker (solo mientras se espeje un repositorio)              |

### Propietarios y modos {#owners}

| Ruta                                                   | Propietario y modo             | Motivo                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La raíz de la instalación                              | El usuario que instala, `0700` | La raíz contiene la clave de recuperación y la contraseña de la base de datos. Solo el usuario que instala puede entrar en ella                                                        |
| `config/runtime.json`, `keys.json`, `health-token.txt` | `0644`                         | El usuario 1000 del contenedor debe poder leerlos. `runtime.json` contiene la contraseña de la base de datos; la raíz con `0700` mantiene a los demás usuarios fuera de estos archivos |
| `updates/inbox`                                        | `0777`                         | El único directorio que el contenedor escribe en el host. El usuario del contenedor y el actualizador del host pueden tener identificadores de usuario distintos                       |
| `updates/status`                                       | `0755`                         | Lo escribe el actualizador del host; el contenedor solo lo lee                                                                                                                         |
| Volumen de almacenamiento                              | Usuario 1000                   | `initialize` lo establece al instalar y al actualizar                                                                                                                                  |
| Almacén de copias                                      | Usuario 1000                   | `vault-owner` lo establece cuando conecta el almacén. El almacén entonces pertenece al usuario del host con ID 1000                                                                    |

## Puertos {#ports}

| Puerto   | Servicio      | Exposición                                               |
| -------- | ------------- | -------------------------------------------------------- |
| 8080/TCP | API y consola | `127.0.0.1:8080` en el host. La dirección es fija        |
| 5432/TCP | PostgreSQL    | No publicado. Solo accesible dentro de la red de Compose |

El archivo de Compose pertenece al directorio de la versión, que las actualizaciones reemplazan, así que no puede cambiar allí la dirección publicada. Para acceder a la consola desde otros equipos, instale un proxy inverso en el host que reenvíe a `127.0.0.1:8080`.

## Entorno {#environment}

El archivo de Compose no establece ninguna configuración de Arkvory. Los servicios leen `/run/arkvory/runtime.json`, que en el host es `config/runtime.json`. El instalador escribe estos valores y no debe cambiarlos: `ARKVORY_HOST` (`0.0.0.0` dentro del contenedor), `ARKVORY_PORT` (`8080`), `ARKVORY_DATABASE_URL` (el contenedor `database` con una contraseña generada), `ARKVORY_DATA_DIR` (`/var/lib/arkvory`), `ARKVORY_KEYS_FILE` y `ARKVORY_UPDATE_CONTROL_DIR`.

Puede agregar otras configuraciones, como `ARKVORY_TRUSTED_PROXIES`, los límites o `ARKVORY_LOG_LEVEL`. Agréguelas a `config/runtime.json` y luego detenga e inicie los servicios como se muestra en [Gestionar el proyecto](#manage). La lista completa está en [Variables de entorno](../reference/environment). `config/compose.env` contiene `ARKVORY_IMAGE`. El instalador lo mantiene; no lo edite.

## Instalar en Linux {#install}

1. Descargue `install.sh` de [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) y léalo.
2. Ejecútelo como `root`:

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   Agregue `--automatic` para activar las actualizaciones automáticas, o `--engine podman` para Podman. Con `ARKVORY_RELEASE_VERSION=1.2.3` el script instala esa versión estable. Sin acceso a internet a GitHub, descomprima `Arkvory-Linux.tar.gz` y ejecute `sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose` en el directorio descomprimido. Node.js se descarga igualmente.

3. Espere a que el instalador termine. Comprueba y descomprime la versión, compila la imagen, inicia la base de datos, ejecuta `initialize` y `migrate`, inicia la API y el worker, espera hasta que la API informe de que está lista tres veces seguidas, inicia el agente de copias de seguridad y registra el temporizador de actualización.

Un usuario del grupo `docker` puede instalar sin `root` en un directorio que le pertenezca:

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

El instalador entonces no registra ningún temporizador de actualización. La consola no puede solicitar actualizaciones hasta que programe usted mismo el actualizador. Consulte [Actualizaciones en Compose](#updates-compose).

## Primer inicio y primeros pasos {#first-start}

1. Compruebe que los contenedores se ejecutan. Consulte [Gestionar el proyecto](#manage) para el comando `compose`.

   ```bash
   "${compose[@]}" ps
   ```

2. Lea la clave de recuperación:

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Abra `http://127.0.0.1:8080/console/#onboarding` en el servidor. Desde su propio equipo, reenvíe el puerto: `ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`.
4. En la consola, abra [[ui:navStart]] y despliegue [[ui:welcomeOwner]]. Pegue la clave en [[ui:welcomeRecovery]], introduzca el nombre del propietario y una contraseña de al menos 12 caracteres, y seleccione [[ui:welcomeCreate]].

Conserve la clave de recuperación en el servidor. Consulte [Seguridad](../operate/security).

## Gestionar el proyecto {#manage}

Abra un shell de root (`sudo -i`) y defina el comando `compose` una sola vez. Compose necesita el nombre del proyecto, el directorio del proyecto, el archivo de entorno y todos los archivos de Compose de la instalación:

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"   # linux-arm64 on arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

Si omite un archivo que existe, `up` vuelve a crear el contenedor sin el montaje del almacén o del espejo.

| Tarea                    | Comando                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Mostrar los contenedores | `"${compose[@]}" ps`                                                               |
| Leer los registros       | `"${compose[@]}" logs --tail 100 api worker backup`                                |
| Detener Arkvory          | `"${compose[@]}" stop --timeout 120 backup worker api`                             |
| Iniciar Arkvory          | `"${compose[@]}" up -d --wait api worker` y después `"${compose[@]}" up -d backup` |

Detener con `stop` mantiene un contenedor detenido tras un reinicio del motor. Inícielo de nuevo con `up -d`.

Los comandos del ciclo de vida se ejecutan con el Node.js que el instalador puso en la raíz:

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

`arkvory` no está instalado en un host de Compose, así que llame a `manage.mjs` para `status`, `update` y `configure`. Los comandos se describen en [Configuración](./configuration).

## Registros {#logs}

Los contenedores escriben en los archivos de registro JSON de Docker. Léalos con `"${compose[@]}" logs`. La API y el worker escriben un registro JSON por línea. Consulte [Monitorización](../operate/monitoring). Los comandos del ciclo de vida imprimen sus mensajes en el terminal, y el temporizador de actualización escribe en el journal: `journalctl -u arkvory-update`.

## Actualizaciones en Compose {#updates-compose}

Actualice con la consola, la ventana de actualización automática o el comando:

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

La actualización descarga y comprueba la versión, compila la nueva imagen, luego detiene `backup`, `worker` y `api` y los inicia con la nueva imagen. El contenedor `database` sigue ejecutándose. Los volúmenes permanecen como están. Una versión que cambia el esquema de la base de datos se instala solo tras una copia de seguridad verificada. Consulte [Actualizaciones](./updates).

El actualizador del host se ejecuta una vez por minuto. Instalado como `root` en un host con systemd, el instalador lo registra como `arkvory-update.timer`. Sin `root`, el instalador imprime una advertencia. Programe este comando cada minuto como el usuario que posee la instalación y tiene acceso al motor de contenedores, por ejemplo con cron:

```text
* * * * * /home/admin/arkvory/runtime/node-v24.21.0-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

Nunca dé el socket de Docker a los contenedores de Arkvory.

## Agente de copias de seguridad en Compose {#backup-agent}

El contenedor `backup` se ejecuta desde el principio. Sin un almacén, se ejecuta e informa de que no hay ningún almacén configurado. El almacén es un directorio del host, fuera de la raíz de la instalación, en un volumen aparte.

1. Monte el volumen del almacén y cree un directorio vacío, por ejemplo `/mnt/backup/arkvory`. El directorio debe existir: Compose no lo crea.
2. Conéctelo:

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
   ```

   El comando comprueba el directorio, escribe `config/compose.vault.yml`, asigna al usuario 1000 la propiedad del directorio, entrega al contenedor de copias el archivo de la clave del agente en solo lectura (`--vault-key-file`) y reinicia solo el contenedor de copias de seguridad. Tiene éxito cuando el agente informa de que el almacén está disponible. De lo contrario, restaura la configuración anterior.

3. Para desconectar el almacén, ejecute el mismo comando con `--backup-vault-off`. El almacén en sí no se toca.

Las programaciones, la retención y las restauraciones se describen en [Copias de seguridad](../operate/backups).

## Eliminar {#remove}

```bash
"${compose[@]}" down              # removes the containers, keeps the volumes
"${compose[@]}" down --volumes    # also deletes the catalog and all stored files
```

`down --volumes` elimina todos los datos. Nunca lo ejecute en una instalación que contenga archivos. Haga primero una copia de seguridad y conserve el almacén.

Después de `down`, puede eliminar lo que quede:

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

Elimine la raíz solo cuando ya no necesite la configuración y la clave de recuperación. Las imágenes de versiones anteriores permanecen en el host hasta que las elimine.

## Windows con Docker Desktop {#docker-desktop}

Use Docker Desktop solo para evaluación en una estación de trabajo. Docker Desktop es una aplicación de un solo usuario: los contenedores se ejecutan solo mientras este usuario tiene la sesión iniciada y Docker Desktop se ejecuta. Tras reiniciar el equipo, Arkvory no está disponible hasta entonces. Active **Settings > General > Start Docker Desktop when you sign in**. El instalador y el comando `status` advierten cuando esta opción está desactivada. Para un servidor, use los [servicios de Windows](./windows).

1. Inicie Docker Desktop en modo de contenedores Linux.
2. Descargue `install.ps1` de la versión y léalo.
3. Abra Windows PowerShell como el usuario que ejecuta Docker Desktop, **sin** derechos de administrador, y ejecute:

   ```powershell
   .\install.ps1 -Mode compose
   ```

   Los parámetros `-Root`, `-Version`, `-Engine`, `-Artifact`, `-AutomaticUpdates` y `-Pin` se describen en [Windows](./windows#install-with-powershell-and-an-existing-postgresql). Indique `-Root` y `-Artifact` como rutas absolutas.

4. Abra `http://127.0.0.1:8080/console/#onboarding`, lea la clave de recuperación de `C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt` y cree el propietario como se describe en [Primer inicio y primeros pasos](#first-start).

La raíz de la instalación `C:\ProgramData\ProAnima\Arkvory` concede acceso a SYSTEM, Administrators y al usuario que instala, sin herencia, porque Docker Desktop lee los montajes de enlace con el token de este usuario. No ejecute el instalador con privilegios elevados para Compose.

El instalador registra la tarea de actualización `ProAnimaArkvoryUpdate` solo cuando se ejecuta como administrador. Esa tarea conviene a un motor para todo el sistema, no a Docker Desktop. Para Docker Desktop, registre la tarea como el usuario de Docker Desktop. Funciona solo mientras este usuario tiene la sesión iniciada y Docker Desktop se ejecuta:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.21.0-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

Gestione el proyecto en PowerShell con los mismos argumentos:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Un almacén de copias en Windows debe ser un volumen local o iSCSI. Se rechazan las rutas UNC y SMB. Para eliminar la instalación, ejecute `docker @compose down --volumes`, anule el registro de la tarea con `Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false` y elimine la raíz. Haga una copia de seguridad primero.
