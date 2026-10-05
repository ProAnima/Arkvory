---
title: Actualizaciones
description: 'Cómo encuentra, verifica e instala Arkvory las nuevas versiones, con actualizaciones manuales y automáticas, la copia de seguridad antes de un cambio de esquema, la reversión, la fijación y las actualizaciones sin conexión.'
---

# Actualizaciones

ProAnimaStudio anuncia cada versión estable de Arkvory a través de un hub. Su servidor pregunta al hub qué versión puede instalar, descarga la versión, comprueba su firma y la instala. No se instala nada a menos que usted lo inicie, o que active las actualizaciones automáticas. Las actualizaciones automáticas están desactivadas de forma predeterminada.

Una actualización no es una actualización progresiva. Los servicios se detienen durante un breve período y las transferencias en curso se interrumpen. Los clientes que pueden reanudar continúan sus transferencias. Actualice en una ventana de mantenimiento.

## Cómo funcionan las actualizaciones {#how-it-works}

- **Versiones.** Solo se instalan las versiones publicadas y estables con una versión `x.y.z`. Se rechazan las versiones preliminares, las ramas, las direcciones arbitrarias y las versiones anteriores.
- **El hub decide.** Cada 6 horas el servidor pregunta al hub por la versión que tiene aprobada. El hub retiene una versión nueva o la publica paso a paso. Los archivos en sí vienen de GitHub a través de enlaces de corta duración que emite el hub. El servidor no necesita ningún token de GitHub para esto.
- **Firma.** Cada manifiesto de versión está firmado por ProAnimaStudio. El servidor comprueba la firma con una clave pública integrada en el programa instalado, y después el SHA-256 del archivo. Una versión sin firmar o alterada no se instala, tanto si viene del hub como de GitHub. No se confía en el hub para la integridad.
- **El actualizador del host.** Un temporizador en el servidor (`arkvory-update.timer` en Linux, la tarea `ProAnimaArkvoryUpdate` en Windows) ejecuta el actualizador cada minuto. Recoge las solicitudes de la consola, comprueba si hay versiones cuando han pasado 6 horas desde la última comprobación, e inicia la actualización automática en su hora. Las comprobaciones se ejecutan incluso cuando la instalación automática está desactivada.

### Qué hace una actualización {#what-an-update-does}

1. Mientras los servicios siguen ejecutándose, descarga la versión, comprueba la firma y el SHA-256, y descomprime los archivos en `releases/<version>/` dentro de la raíz de la instalación. Para Compose, compila la nueva imagen.
2. Si la versión cambia el esquema de la base de datos, primero realiza y verifica una copia de seguridad nueva. Consulte [La copia de seguridad antes de una actualización](#backup).
3. Detiene el agente de copias de seguridad, el worker y la API. Cada uno dispone de hasta 120 segundos para terminar.
4. Cambia la instalación a la nueva versión. Un cambio de esquema ejecuta su migración ahora.
5. Inicia la API y el worker y espera hasta que la API informe de que está lista tres veces seguidas. Después inicia el agente de copias de seguridad. El agente no forma parte de la comprobación: si no informa en unos 90 segundos, la actualización imprime una advertencia y continúa.
6. Envía el evento anónimo `updated` al hub, si las estadísticas están activadas. Un fallo aquí nunca deshace la actualización.

La versión anterior permanece en `releases/`. Todos los datos, claves y configuración permanecen como estaban.

## Comprobar si hay actualizaciones {#check}

Inicie sesión en la consola como administrador y abra [[ui:updates]]. La página muestra [[ui:updateCurrent]], [[ui:updateLatest]] y [[ui:updateChecked]]. Seleccione [[ui:updateCheck]] para preguntar al hub ahora. Después de iniciar sesión, un banner con [[ui:updateOpen]] le avisa cuando existe una versión más reciente.

Si una comprobación falla, por ejemplo sin acceso a la red, la página conserva la última versión que encontró y la marca como posiblemente obsoleta. La comprobación se vuelve a intentar después de 6 horas, o cuando selecciona [[ui:updateCheck]].

En el servidor, `arkvory status --root <root>` muestra la versión instalada, la configuración de actualización automática y la fijación.

Si la página dice que el actualizador del host no está conectado, ejecute `arkvory updates-connect --root <root>`. Conecta la consola y el temporizador de actualización de una instalación que se actualizó desde una versión antigua. Si la página dice que el actualizador ha dejado de informar, el temporizador o la tarea no se ha ejecutado durante 5 minutos. Consulte [Solución de problemas](#troubleshooting).

## Instalar manualmente {#manual}

### En la consola {#manual-console}

1. Abra [[ui:updates]] y compruebe que [[ui:updateLatest]] muestra la versión que desea.
2. Seleccione [[ui:updateInstall]]. El diálogo indica el nombre de la versión y advierte de que las transferencias pueden interrumpirse.
3. Seleccione [[ui:updateConfirmButton]]. La consola envía la versión y el SHA-256 que vio. Si los bytes publicados han cambiado desde entonces, se rechaza la solicitud.
4. Espere. La solicitud se acepta de inmediato; el actualizador del host la recoge en menos de un minuto. La página puede perder la conexión mientras los servicios se reinician y se vuelve a conectar por sí sola. No envíe una segunda solicitud.

La consola rechaza una instalación cuando la versión está fijada. Consulte [Fijar una versión](#pin).

### Con un comando {#manual-command}

```bash
sudo arkvory update --root /opt/proanima-arkvory
sudo arkvory update --root /opt/proanima-arkvory --version 1.2.3
```

Sin `--version`, el comando instala la versión que el hub aprueba para este servidor. Con `--version`, instala esa versión estable exacta, que debe ser más reciente que la instalada. El comando sale con un código de error cuando la actualización falla. Cómo ejecutar el comando en cada plataforma está en [Configuración](./configuration#lifecycle-commands).

## Actualizaciones automáticas {#automatic}

Active las actualizaciones automáticas de una de estas tres formas:

- En la consola, abra [[ui:updates]], seleccione [[ui:updateAutomatic]] en [[ui:updateSettings]], elija [[ui:updateHour]] y seleccione [[ui:updateSave]].
- En el servidor: `arkvory configure --root <root> --enable-updates`.
- Cuando instale con un script: `--automatic` para `install.sh`, `-AutomaticUpdates` para `install.ps1`.

Desactívelas con la consola o `arkvory configure --root <root> --disable-updates`.

| Regla           | Valor                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Ventana         | La hora UTC elegida. De forma predeterminada, de 03:00 a 03:59 UTC. Solo la consola establece la hora                         |
| Intentos        | Como máximo uno por día UTC, tanto si tiene éxito como si falla. Una ventana perdida no se recupera más tarde en el mismo día |
| Se omite cuando | La versión está fijada, la última comprobación falló o no se conoce ninguna versión más reciente                              |
| Versión         | La versión más reciente que el hub aprobó en la última comprobación                                                           |

Programe sus copias de seguridad fuera de la ventana de actualización. Una actualización detiene el agente de copias de seguridad, y una copia en curso se interrumpe y se pone de nuevo en cola.

## La copia de seguridad antes de una actualización {#backup}

Una actualización que no cambia el esquema de la base de datos no realiza ninguna copia de seguridad. Confíe en sus copias de seguridad programadas.

Una versión que cambia el esquema de la base de datos se instala solo detrás de una copia de seguridad nueva y verificada. El actualizador hace esto mientras los servicios siguen ejecutándose:

1. Pide al agente de copias de seguridad una copia nueva y espera hasta que la copia se realiza y se comprueba. Espera hasta 6 horas. La consola muestra que la versión se está instalando durante este tiempo.
2. Solo entonces detiene los servicios, migra la base de datos e inicia la nueva versión.

La copia de seguridad necesita tres cosas: un almacén de copias conectado que esté disponible, un agente de copias de seguridad en línea y al menos una copia que se haya completado antes. La primera copia completa de terabytes es trabajo planificado, nunca un efecto secundario de una actualización. Si falta una de las tres, la actualización se **rechaza antes de que cambie nada**. Los servicios siguen ejecutándose, la consola muestra que la instalación se rechazó, y una actualización automática lo vuelve a intentar al día siguiente. Conecte el almacén y ejecute la primera copia: consulte [Copias de seguridad](../operate/backups).

Los cambios que llegan después de la instantánea y antes de que se detengan los servicios no están en esa copia de seguridad. La copia de seguridad solo importa si la nueva versión falla después de su migración: consulte [Revertir y recuperar](#rollback).

### Actualizar con una copia de seguridad propia {#manual-upgrade}

Sin un almacén integrado, haga y verifique su propia copia de seguridad de la base de datos y de todo el almacenamiento, y luego dé al actualizador un archivo que la registre:

```bash
sudo arkvory upgrade --root /opt/proanima-arkvory --version 1.2.3 --backup-record /secure/backup-record.txt
```

El archivo es una nota suya. El actualizador solo comprueba que existe; no demuestra que la copia de seguridad esté completa. El diario y la reversión son los mismos que para `update`. Este comando solo funciona hacia adelante y se rechaza cuando la versión está fijada a otra versión.

## Revertir y recuperar {#rollback}

### Reversión automática {#automatic-rollback}

- **Sin cambio de esquema.** Si la nueva versión no pasa a estar lista, el actualizador la detiene, restaura la versión anterior, espera a que esté lista e informa `Update failed; previous release restored`.
- **Cambio de esquema, migración fallida.** La migración se ejecuta en una sola transacción. Una migración fallida se revierte, y la versión anterior se inicia de nuevo sobre el esquema sin cambios.
- **Cambio de esquema, la nueva versión no se inicia después de la migración.** La versión anterior no puede leer el nuevo esquema, así que no hay una forma automática de volver. El actualizador marca el diario como `maintenance-required` e indica el punto de copia de seguridad. Corrija la causa y ejecute `recover`, que finaliza la actualización. O restaure el punto de copia de seguridad indicado en `journal.json` y ejecute la versión anterior.

Arkvory no tiene ningún comando de degradación. El comando rechaza una versión anterior. La versión anterior permanece en `releases/` solo para la reversión automática.

### Recuperar una actualización interrumpida {#recover-update}

Una caída o una pérdida de energía durante una actualización deja dos cosas: el bloqueo `operation.lock` y el registro `journal.json` en la raíz de la instalación. Las actualizaciones nuevas y la mayoría de los comandos se niegan a ejecutarse hasta que recupere. Nunca elimine el bloqueo antes de conocer el estado.

1. Detenga el temporizador de actualización, para que no se inicie ninguna ejecución nueva. En Linux: `sudo systemctl stop arkvory-update.timer`. En Windows: `Disable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`. En una instalación de Compose sin el temporizador, detenga su tarea programada.
2. Asegúrese de que no se ejecute ningún proceso de actualización. Guarde `journal.json` y los registros.
3. Solo entonces elimine `operation.lock`.
4. Ejecute `arkvory recover --root <root>`. Avanza en la dirección que permite el diario:
   - para una actualización sin cambio de esquema, o antes de que comenzara la migración, vuelve a la versión anterior,
   - después de que comenzara la migración, avanza: repite la migración, que es segura de repetir, e inicia la nueva versión.
5. Compruebe que los servicios están listos y que una descarga de prueba funciona. Inicie el temporizador de nuevo: `sudo systemctl start arkvory-update.timer`, o `Enable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`.

Si la solicitud de la consola que inició la actualización todavía está almacenada, `arkvory updates-reset --root <root>` la elimina. Ejecútelo solo después de haber comprobado el estado. No elimina el bloqueo.

## Fijar una versión {#pin}

Fije una versión para detener toda actualización a otra versión.

```bash
sudo arkvory configure --root <root> --pin                  # pin the installed version
sudo arkvory configure --root <root> --pin --version 1.2.3  # pin another stable version
sudo arkvory configure --root <root> --unpin
```

Mientras una versión está fijada:

- las actualizaciones automáticas no hacen nada,
- la consola se niega a instalar una versión y le pide que elimine la fijación en el servidor,
- `arkvory update` instala la versión fijada y rechaza otro `--version`,
- las comprobaciones siguen ejecutándose, así que la consola sigue mostrando versiones más recientes.

Para instalar una versión más reciente después de haber fijado una anterior, fije la versión más reciente y ejecute `arkvory update`. También puede fijar mientras instala con un script: `--pin` para `install.sh`, `-Pin` para `install.ps1`.

## El hub, el canal y las estadísticas {#hub}

### Qué envía el servidor al hub {#hub-data}

| Cuándo                                                      | Qué se envía                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comprobación de actualización, cada 6 horas o a petición    | Una solicitud de actualización del proyecto `arkvory` con la versión instalada, el sistema operativo (`linux` o `windows`), el procesador (`x86_64` o `aarch64`) y el canal. Con las estadísticas activadas, se añade la cabecera `X-Install-Id` con un ID de instalación aleatorio |
| Una actualización terminada, con las estadísticas activadas | Un evento `updated` con el ID de instalación, la nueva versión, el sistema operativo, el procesador y el canal                                                                                                                                                                      |
| Descarga de una versión                                     | El hub responde con un enlace a GitHub. Los archivos vienen de allí                                                                                                                                                                                                                 |

No se envía ninguna clave, cuenta, nombre de host o contenido almacenado, y ninguna credencial llega al hub. El ID de instalación es un valor aleatorio que no identifica nada más que la instalación. Según el proyecto, el hub no almacena direcciones IP, nombres ni contenido. El hub también recibe los comentarios que un usuario envía desde la consola. Esa es una acción aparte del usuario.

Con las estadísticas desactivadas, el servidor no envía ningún ID de instalación ni eventos. El hub entonces ofrece una versión solo cuando la ha publicado para todas las instalaciones.

### Opciones {#hub-options}

| Configuración     | Valor predeterminado       | Cómo cambiarla                                                                                                        |
| ----------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Estadísticas      | activadas                  | Consola: [[ui:updateStatistics]] en [[ui:updateSettings]]. Comando: `--statistics off` o `--statistics on`            |
| Canal             | `stable`                   | `--update-channel beta` para recibir versiones que ProAnimaStudio ofrece antes, `--update-channel stable` para volver |
| Dirección del hub | `https://hub.proanima.net` | `--hub-url https://hub.example` para un hub propio, `--hub-off` para usar solo GitHub. La dirección debe usar HTTPS   |

Todas ellas son opciones de `arkvory configure --root <root>` y surten efecto sin reiniciar. Las configuraciones se almacenan en `config/hub.json`. Un cambio de la dirección del hub también cambia dónde envía los comentarios la consola, tras el siguiente reinicio de los servicios.

### Cuando el hub no es accesible {#hub-unreachable}

Si el hub no responde (fallo de red, tiempo de espera agotado o error del servidor), el actualizador lee en su lugar la última versión estable en GitHub y registra una advertencia. Realiza las mismas comprobaciones de firma y SHA-256. Un rechazo del hub (estado 4xx), un archivo que falta o una firma incorrecta son un error, y no hay alternativa.

Si las versiones en GitHub necesitan autenticación, cree el archivo `github-token.txt` en la raíz de la instalación con un token que pueda leer el contenido del repositorio. Solo los administradores pueden leer el archivo. El actualizador lo usa, los servicios no, y nunca se pasa como opción de comando. Con `--hub-off`, el actualizador siempre usa GitHub.

El servidor necesita acceso HTTPS a `hub.proanima.net`, `api.github.com`, `github.com` y los hosts de descarga de GitHub.

## Instalaciones sin conexión {#offline}

Un servidor sin acceso a internet no puede comprobar si hay versiones. La página [[ui:updates]] entonces muestra que la comprobación falló. Esto no afecta a los servicios. Actualice desde archivos en su lugar.

1. En un equipo con acceso a internet, descargue el kit para la plataforma de su servidor: `Arkvory-Linux.tar.gz` o `Arkvory-Windows.zip`. Compare su SHA-256 con `release-checksums.json` de la versión.
2. Copie el kit al servidor y descomprímalo. El directorio contiene `arkvory-release.json`, `arkvory-runtime.zip` y `arkvory-setup.mjs`. El kit no tiene archivo de firma. Descargue `arkvory-release.json.sig` de la misma página de la versión y colóquelo junto a `arkvory-release.json`: el actualizador entonces también verifica la firma.
3. Ejecute la actualización con la ruta absoluta del directorio:

   ```bash
   sudo arkvory update --root /opt/proanima-arkvory --artifact /media/release
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' update --root C:\ProgramData\ProAnima\Arkvory --artifact D:\release
   ```

El actualizador comprueba el SHA-256 del archivo con el manifiesto. Comprueba la firma solo cuando `arkvory-release.json.sig` está junto al manifiesto. Un directorio local es elección suya, así que la actualización no requiere la firma. Sin ella, la comparación del kit con `release-checksums.json` del paso 1 es su única prueba de origen. Se aplican las mismas reglas para un cambio de esquema: primero necesita una copia de seguridad verificada.

Un paquete nativo o `Arkvory-Setup-x64.exe` lleva su versión y no necesita acceso a internet. Una actualización de Compose compila la imagen en el host. Solo necesita Docker Hub cuando la imagen base `node:24.21.0-bookworm-slim` todavía no está en el host.

## Actualizar por plataforma {#platforms}

### Windows {#platform-windows}

Ejecute un `Arkvory-Setup-x64.exe` más reciente sobre el instalado. Setup encuentra los datos y no vuelve a preguntar por el propietario. Actualiza los programas, los servicios y la versión de la base de datos de la misma forma que una actualización desde la consola. Se rechaza el Setup de una versión anterior, y el Setup de la misma versión repara los servicios. No inicie Setup mientras hay una actualización en curso. El instalador solo está disponible en inglés y ruso. También puede actualizar desde la consola o con el comando.

### Paquetes de Linux {#platform-linux}

Descargue el paquete más reciente de la página de la versión e instálelo como el primero: `sudo apt install ./Arkvory-amd64.deb` o `sudo dnf install ./Arkvory-x86_64.rpm`. No hay ningún repositorio de apt o dnf, así que `apt upgrade` y `dnf upgrade` no encuentran versiones nuevas. El paso de configuración del paquete ejecuta la misma actualización que el comando, con la versión dentro del paquete. Los servicios en ejecución siguen sirviendo hasta el cambio.

Si se rechaza la actualización, por ejemplo porque un cambio de esquema necesita una copia de seguridad que no existe, la versión anterior sigue ejecutándose y el paso de configuración falla. Corrija la causa y repita el paso con `sudo dpkg --configure -a` en Debian y Ubuntu, o instalando el mismo paquete de nuevo en sistemas RPM.

Después de una actualización desde la consola, la versión que muestra el gestor de paquetes puede ser anterior a la versión en ejecución. Se rechaza un paquete anterior a la versión en ejecución.

### Instalación con script {#platform-script}

Una instalación con script no tiene el comando `arkvory`. Actualice desde la consola, o ejecute `manage.mjs update` con el Node.js de la instalación. Consulte [Configuración](./configuration#lifecycle-commands).

### Docker Compose {#platform-compose}

Actualice desde la consola o con `manage.mjs update`. El actualizador compila la imagen de la nueva versión, reemplaza los contenedores `backup`, `worker` y `api` y conserva los volúmenes. Una instalación de Compose sin `root` necesita un `updates-poll` programado. Consulte [Docker Compose](./docker#updates-compose).

## Después de la actualización {#after}

- Compruebe `arkvory status --root <root>` e inicie sesión en la consola.
- Elimine de `releases/` las versiones que ya no necesite. Conserve la versión actual y la anterior indicada en `journal.json`. El actualizador nunca elimina versiones antiguas, archivos de descarga ni staging.
- Una actualización no actualiza el Node.js de una instalación con script, los programas de PostgreSQL, el sistema operativo ni el motor de contenedores. Actualícelos por separado. Un cambio de versión principal de PostgreSQL es una migración en sí misma: haga una copia de seguridad primero.

## Solución de problemas {#troubleshooting}

| Qué ve                                                                   | Qué hacer                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La página dice que el actualizador del host no está conectado            | Ejecute `arkvory updates-connect --root <root>` en una ventana de mantenimiento                                                                                                                                                         |
| La página dice que el actualizador ha dejado de informar                 | Compruebe el temporizador o la tarea. En Linux: `systemctl status arkvory-update.timer` y `journalctl -u arkvory-update`. En Windows: la tarea `ProAnimaArkvoryUpdate` y `logs\updater.log`. Compruebe que no quede un `operation.lock` |
| La comprobación de versiones falló                                       | Compruebe el acceso al hub y a GitHub desde el servidor. Los servicios no se ven afectados                                                                                                                                              |
| La instalación se rechazó porque se necesita una copia de seguridad      | Conecte el almacén, espere la primera copia de seguridad y vuelva a comprobar el estado. Consulte [La copia de seguridad antes de una actualización](#backup)                                                                           |
| La actualización falló                                                   | Lea `journal.json`, el registro del actualizador y los registros de los servicios antes de volver a intentarlo                                                                                                                          |
| Se requiere recuperación manual                                          | Siga [Recuperar una actualización interrumpida](#recover-update)                                                                                                                                                                        |
| La configuración cambió mientras la solicitud estaba esperando           | Actualice la página y envíe la solicitud de nuevo                                                                                                                                                                                       |
| `Installation is locked`                                                 | Hay otra operación en curso, o una se bloqueó. Consulte [Recuperar una actualización interrumpida](#recover-update)                                                                                                                     |
| `Interrupted deployment; use recover after inspecting journal.json`      | Una actualización anterior no terminó. Recupere primero                                                                                                                                                                                 |
| `Downgrades are forbidden`                                               | La versión no es más reciente que la instalada                                                                                                                                                                                          |
| `Version is pinned`                                                      | Elimine la fijación, o instale la versión fijada                                                                                                                                                                                        |
| `Interrupted update request; inspect installation and use updates-reset` | Se aceptó una solicitud de la consola pero no se terminó. Compruebe el estado y luego ejecute `updates-reset`                                                                                                                           |

Hay más sugerencias en [Solución de problemas](../operate/troubleshooting) y [Autorrecuperación](../operate/self-healing).
