---
title: Windows
---

# Windows

Hay tres formas de ejecutar Arkvory en Windows:

- **Instalador gráfico** `Arkvory-Setup-x64.exe`. Es la opción recomendada. Instala servicios de Windows y una base de datos PostgreSQL dedicada. No necesita acceso a internet.
- **Script de PowerShell** `install.ps1`. Instala los mismos servicios de Windows, pero usa su servidor PostgreSQL existente.
- **Docker Desktop** con `install.ps1 -Mode compose`. Solo para evaluación. Consulte [Docker Compose](./docker).

## Requisitos {#requirements}

- Windows x64, compilación 10.0.17763 o posterior (Windows 10 versión 1809, Windows Server 2019 o posterior).
- Una cuenta del grupo Administradores.
- Un volumen NTFS local para los datos. No se admiten recursos compartidos de red para el almacenamiento de archivos.
- Un directorio de instalación fuera de los perfiles de usuario y de `AppData`. La cuenta del servicio debe poder leer todos los directorios superiores.

## Instalar con el instalador gráfico {#install-with-the-graphical-installer}

1. Descargue `Arkvory-Setup-x64.exe` de [GitHub Releases](https://github.com/ProAnima/Arkvory/releases).
2. Ejecute el archivo y confirme la solicitud del Control de cuentas de usuario.
3. Seleccione inglés o ruso y acepte la licencia.
4. Introduzca la cuenta del propietario. El nombre tiene de 3 a 64 caracteres: letras latinas, dígitos, punto, guion o guion bajo. La contraseña tiene de 12 a 128 caracteres.
5. Espere mientras el instalador prepara la base de datos, los servicios y la cuenta del propietario.
6. En la última página, deje seleccionada la opción **Open Arkvory and finish onboarding** y haga clic en **Finish** (así se llaman en el instalador). La consola se abre en `http://127.0.0.1:8080/console/#onboarding`.

El instalador también crea dos accesos directos en el menú Inicio: **Arkvory** (la consola) y **API and CLI** (la página de ayuda de la consola).

Si el instalador indica que el entorno de ejecución de Microsoft requiere un reinicio, reinicie Windows y vuelva a ejecutar el instalador. Los datos de Arkvory existentes se conservan.

Las actualizaciones automáticas están desactivadas tras la instalación. Para activarlas, consulte [Actualizaciones](./updates).

### Instalación silenciosa {#silent-installation}

Para un despliegue automatizado, coloque la cuenta del propietario en un archivo JSON. Proteja el archivo para que solo SYSTEM y Administradores puedan leerlo.

```json
{ "name": "admin", "password": "<al menos 12 caracteres>" }
```

```powershell
.\Arkvory-Setup-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"
```

El instalador elimina el archivo del propietario después de crear la cuenta. No pase nunca una contraseña como argumento de un comando. Sin `/OWNERFILE`, cree al propietario más tarde en la consola con la clave de recuperación. El instalador termina con un código distinto de cero cuando la configuración no se completó. No ejecute el instalador mientras se esté ejecutando una actualización.

## Qué crea el instalador gráfico {#what-the-graphical-installer-creates}

| Elemento                         | Ubicación o valor                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Archivos del programa            | `C:\Program Files\ProAnima\Arkvory`                                                     |
| Datos, configuración y registros | `C:\ProgramData\ProAnima\Arkvory` (la raíz de la instalación)                           |
| Base de datos                    | PostgreSQL 18.4 en `database\` de la raíz, en `127.0.0.1:54329`                         |
| Consola                          | `http://127.0.0.1:8080/console/`                                                        |
| Clave de recuperación            | `config\bootstrap-token.txt` en la raíz                                                 |
| Tarea de actualización           | `ProAnimaArkvoryUpdate` en el Programador de tareas. Se ejecuta cada minuto como SYSTEM |

### Servicios {#services}

| Nombre del servicio | Nombre para mostrar       | Cuenta                        | Tipo de inicio                |
| ------------------- | ------------------------- | ----------------------------- | ----------------------------- |
| `Arkvoryapi`        | ProAnima Arkvory api      | `NT AUTHORITY\LocalService`   | Automático (inicio retrasado) |
| `Arkvoryworker`     | ProAnima Arkvory worker   | `NT AUTHORITY\LocalService`   | Automático (inicio retrasado) |
| `Arkvorybackup`     | ProAnima Arkvory backup   | `NT AUTHORITY\LocalService`   | Automático (inicio retrasado) |
| `Arkvorydatabase`   | ProAnima Arkvory database | `NT AUTHORITY\NetworkService` | Automático                    |

Los servicios se ejecutan sin un usuario con sesión iniciada. La API, el worker y el agente de copias de seguridad comparten la cuenta LocalService. La base de datos se ejecuta con NetworkService, por lo que la cuenta de la API no puede leer los archivos de la base de datos.

La raíz concede control total solo a SYSTEM y Administradores. LocalService puede leer la raíz y modificar únicamente `data\`, `logs\` y la bandeja de entrada de actualizaciones. La clave de recuperación y los demás archivos de credenciales del instalador solo pueden leerlos SYSTEM y Administradores.

## Instalar con PowerShell y un PostgreSQL existente {#install-with-powershell-and-an-existing-postgresql}

Use este método si su organización ya tiene un servidor PostgreSQL en funcionamiento. No crea ningún servicio de base de datos administrado ni ninguna entrada en **Aplicaciones**.

1. Pida a su administrador de bases de datos una base de datos vacía y un rol que sea su propietario. Arkvory ejecuta sus migraciones con este rol.
2. Descargue `install.ps1` de la versión y revíselo.
3. Abra Windows PowerShell **como administrador** y ejecute:

```powershell
.\install.ps1 -AutomaticUpdates
```

El script solicita la URL de conexión de PostgreSQL. La entrada está oculta. Después descarga Node.js 24.21.0 de `nodejs.org`, comprueba su SHA-256 e instala la última versión estable.

En lugar de la solicitud, puede pasar un archivo JSON protegido:

```json
{ "ARKVORY_DATABASE_URL": "postgresql://arkvory:<contraseña>@db.example:5432/arkvory" }
```

```powershell
.\install.ps1 -Config C:\secure\arkvory.json
```

Si PowerShell bloquea los scripts, ejecute `powershell -ExecutionPolicy Bypass -File .\install.ps1`. Esto cambia la directiva solo para este proceso.

| Parámetro                   | Significado                                                                     |
| --------------------------- | ------------------------------------------------------------------------------- |
| `-Root <ruta>`              | Raíz de la instalación. Valor predeterminado: `C:\ProgramData\ProAnima\Arkvory` |
| `-Version <x.y.z>`          | Instala esta versión estable en lugar de la última                              |
| `-Mode windows` o `compose` | Servicios de Windows (predeterminado) o [Docker Compose](./docker)              |
| `-Engine docker` o `podman` | Motor de contenedores para Compose                                              |
| `-Config <archivo>`         | Archivo JSON con los ajustes `ARKVORY_*`, incluida la URL de la base de datos   |
| `-Artifact <directorio>`    | Instala desde un `Arkvory-Windows.zip` extraído en lugar de desde GitHub        |
| `-AutomaticUpdates`         | Activa las actualizaciones automáticas                                          |
| `-Pin`                      | Fija la versión instalada                                                       |

Indique `-Root`, `-Config` y `-Artifact` como rutas absolutas, por ejemplo `-Artifact $PWD.Path`.

El script no crea una cuenta de propietario. Abra `http://127.0.0.1:8080/console/` en el servidor, seleccione **[[ui:welcomeOwner]]** e introduzca la clave de recuperación de `config\bootstrap-token.txt`.

## Administrar los servicios {#manage-the-services}

```powershell
Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
Restart-Service Arkvoryapi, Arkvoryworker
sc.exe qfailure Arkvoryapi
```

El comando de administración necesita una consola de PowerShell con privilegios elevados y siempre la opción `--root`:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
# Instalador gráfico
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root $root
# Instalación con script
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Ejecute `arkvory.ps1 help` para ver todos los comandos. Los comandos se describen en [Configuración](./configuration) y [Actualizaciones](./updates).

## Recuperación tras un fallo {#recovery-after-a-failure}

- Cuando un proceso de servicio se detiene sin que se haya solicitado, Windows lo inicia de nuevo después de 10 segundos. El contador de fallos se restablece después de una hora.
- Un proceso cuyo hilo principal se bloquea durante 60 segundos termina por sí mismo y Windows lo inicia de nuevo. Consulte [Autorrecuperación](../operate/self-healing).
- Una comprobación de disponibilidad fallida no reinicia por sí sola un servicio (por ejemplo, mientras el servidor termina las solicitudes en curso antes de apagarse). Pero cuando la base de datos deja de responder, la API y el worker no pueden confirmar que son los propietarios del almacenamiento: tras unos 8 segundos terminan por sí mismos y Windows los inicia de nuevo cada 10 segundos hasta que la base de datos vuelve a estar disponible.
- Un servicio que usted detiene permanece detenido hasta que lo inicie o hasta que Windows se reinicie.

Si vuelve a ejecutar el instalador gráfico, se restablecen el tipo de inicio y las acciones de recuperación de los servicios.

## Registros {#logs}

| Ubicación en la raíz | Contenido                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `logs\`              | Salida de la API, del worker y del agente de copias de seguridad. Los archivos rotan a los 20 MiB; se conservan 5 archivos antiguos |
| `logs\updater.log`   | Salida de la tarea de actualización, con la misma rotación                                                                          |
| `database\`          | Registros del servicio de base de datos (`arkvory-database*.log`)                                                                   |
| `bootstrap.log`      | Salida del paso de configuración del instalador gráfico                                                                             |

El instalador también escribe su propio registro en la carpeta temporal del usuario que lo ejecutó. La API y el worker escriben un registro JSON por línea. Consulte [Monitorización](../operate/monitoring).

## Desinstalar {#uninstall}

Abra **Configuración > Aplicaciones**, seleccione **ProAnima Arkvory** y haga clic en **Desinstalar**. El desinstalador:

1. Elimina la tarea `ProAnimaArkvoryUpdate`.
2. Detiene y elimina `Arkvorybackup`, `Arkvoryworker`, `Arkvoryapi` y `Arkvorydatabase`.
3. Elimina los archivos del programa.

**Conserva** a propósito `C:\ProgramData\ProAnima\Arkvory`: la base de datos, todos los archivos, la configuración y la clave de recuperación. Nunca toca el almacén de copias. Si más adelante ejecuta el instalador de la misma versión o de una más reciente, continúa con los datos conservados. Para eliminar los datos, haga primero una copia de seguridad y después elimine usted mismo la carpeta.

Una instalación con script no tiene desinstalador. Para quitar sus servicios, ejecute en una consola de PowerShell con privilegios elevados:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false
foreach ($role in 'backup', 'worker', 'api') {
  $exe = "$root\service\arkvory-$role.exe"
  if ((Get-Service "Arkvory$role").Status -ne 'Stopped') { & $exe stopwait }
  & $exe uninstall
}
```

## Docker Desktop {#docker-desktop}

Docker Desktop es una aplicación de un solo usuario. Sus contenedores se ejecutan solo después de que este usuario inicia sesión y Docker Desktop se inicia. Tras reiniciar el equipo, Arkvory no está disponible hasta ese momento. Si instala con Docker Desktop, active **Settings > General > Start Docker Desktop when you sign in**. El instalador y el comando `status` avisan cuando este ajuste está desactivado. Para un servidor que debe iniciarse sin que nadie inicie sesión, use los servicios nativos descritos en esta página.

## Solución de problemas {#troubleshooting}

| Problema                                                            | Qué hacer                                                                                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| El instalador indica que la configuración no finalizó               | Lea `bootstrap.log`, el registro del instalador y los registros de la base de datos. No elimine la carpeta de la base de datos                        |
| `database\bootstrap-started` existe, pero `database\initialized` no | Se interrumpió la creación de la base de datos. No elimine el clúster ni repita el SQL a mano. Corrija la causa y ejecute el comando `finish-install` |
| `Run installer as Administrator`                                    | Inicie PowerShell con **Ejecutar como administrador**                                                                                                 |
| `Use a dedicated directory`                                         | La raíz ya contiene archivos. Use un directorio vacío. Administre una instalación existente con sus comandos                                          |
| `Node.js runtime is incomplete after extraction`                    | Revise la cuarentena de su software antivirus                                                                                                         |
| `Another installation owns this service`                            | Existen servicios de una instalación en otra raíz. Elimínelos primero                                                                                 |

Para finalizar una instalación interrumpida sin eliminar datos:

```powershell
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' finish-install --root C:\ProgramData\ProAnima\Arkvory
```

Encontrará más consejos en [Solución de problemas](../operate/troubleshooting).
