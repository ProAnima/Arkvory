---
title: Linux
description: 'Instale Arkvory en Linux desde el paquete .deb o .rpm, inícielo, gestione los servicios de systemd, actualícelo y desinstálelo.'
---

# Linux

Hay dos formas de ejecutar Arkvory en Linux:

- **Paquete** `Arkvory-amd64.deb` o `Arkvory-x86_64.rpm`. Recomendado. Instala servicios de systemd y un clúster de PostgreSQL dedicado que Arkvory gestiona. Su gestor de paquetes proporciona los programas de PostgreSQL.
- **Script** `install.sh`. Instala los mismos servicios, pero usa un servidor PostgreSQL existente. También admite arm64. Consulte [Usar un PostgreSQL existente](#existing-postgresql).

Para Docker, consulte [Docker Compose](./docker). Para un primer recorrido por la consola, consulte el [Inicio rápido](../guide/quick-start).

## Requisitos {#requirements}

| Elemento                   | Requisito                                                                                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Procesador                 | x64 para los paquetes. No hay paquetes arm64: use `install.sh` en arm64                                                                                                                                                                                                                      |
| Sistema de inicio          | systemd. No se admiten OpenRC, runit y otros sistemas de inicio                                                                                                                                                                                                                              |
| Biblioteca C               | glibc 2.28 o posterior. No se admite Alpine Linux (musl)                                                                                                                                                                                                                                     |
| Distribuciones probadas    | Ubuntu 24.04 para el `.deb`, Fedora 44 para el `.rpm`. Otras distribuciones con systemd que cumplan las dependencias siguientes no están probadas                                                                                                                                            |
| Dependencias del `.deb`    | `postgresql` 16 o posterior, `systemd`, `python3`, `ca-certificates`, `libc6` 2.28 o posterior, `libstdc++6`, `libgcc-s1`, `libatomic1`                                                                                                                                                      |
| Dependencias del `.rpm`    | `postgresql-server` 16 o posterior, `systemd`, `python3`, `ca-certificates`, `glibc` 2.28 o posterior, `libstdc++`, `libatomic`                                                                                                                                                              |
| Programas de PostgreSQL    | Versión 16 a 19. El paso de instalación busca en `/usr/lib/postgresql/*/bin`, `/usr/pgsql-*/bin`, `/usr/bin` y `/usr/lib/pgsql/bin` y toma la versión más alta que encuentra. Si su distribución solo ofrece una versión anterior, agregue primero un repositorio de PostgreSQL más reciente |
| Cuenta                     | `root`, o un usuario que pueda ejecutar `sudo`                                                                                                                                                                                                                                               |
| Puertos libres             | 8080 y 54329 en `127.0.0.1`                                                                                                                                                                                                                                                                  |
| Almacenamiento de archivos | Un sistema de archivos local que admita enlaces físicos. No use un recurso compartido de red                                                                                                                                                                                                 |

El paquete contiene Node.js 24. Instalarlo no necesita acceso a internet más allá de lo que su gestor de paquetes use para las dependencias.

El paquete nunca cambia un clúster o servicio PostgreSQL existente. Arkvory inicia su propio clúster a partir de los programas de PostgreSQL.

## Instalar el paquete {#install-package}

1. Descargue el paquete para su distribución desde [GitHub Releases](https://github.com/ProAnima/Arkvory/releases), junto con `native-linux.json` de la misma versión.
2. Compare el SHA-256 del paquete con el valor de `native-linux.json`. Los paquetes no están firmados con una clave de editor, así que esta comprobación es la única prueba de lo que descargó.
3. Instale el paquete. Mantenga el `./` delante del nombre del archivo: le indica al gestor de paquetes que el archivo es local. En Debian y Ubuntu:

```bash
sudo apt install ./Arkvory-amd64.deb
```

En Fedora y sistemas compatibles con RPM:

```bash
sudo dnf install ./Arkvory-x86_64.rpm
```

El gestor de paquetes instala las dependencias y luego Arkvory se configura solo. El proceso:

1. copia Node.js a `/opt/proanima-arkvory/runtime/node`,
2. crea las dos cuentas de servicio, la configuración, las claves y la clave de recuperación,
3. crea e inicia el clúster de PostgreSQL y ejecuta las migraciones de la base de datos,
4. registra e inicia los servicios y el temporizador de actualizaciones,
5. espera hasta que la API responde a su comprobación de disponibilidad tres veces seguidas.

Al final imprime la dirección de la consola y la ruta de la clave de recuperación. Si un paso falla, la instalación se detiene con un error. Consulte [Solución de problemas](#troubleshooting).

Las actualizaciones automáticas están desactivadas después de la instalación. Para activarlas, consulte [Actualizaciones](./updates).

## Qué crea el paquete {#what-package-creates}

### Archivos y directorios {#files}

| Ruta                                                            | Contenido                                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/usr/lib/proanima-arkvory/`                                    | Carga del paquete: Node.js, los archivos de la versión y el instalador. Propiedad del paquete                                                                                        |
| `/usr/bin/arkvory`                                              | El comando de gestión. Consulte [El comando arkvory](#arkvory-command)                                                                                                               |
| `/usr/share/applications/arkvory.desktop`                       | Entrada de menú que abre la consola en un escritorio. Un servidor sin escritorio no la usa                                                                                           |
| `/opt/proanima-arkvory/`                                        | La raíz de la instalación: configuración, datos, base de datos, código de programa de cada versión. Su estructura se describe en [Elegir una instalación](./#installation-directory) |
| `/etc/systemd/system/arkvory-*.service`, `arkvory-update.timer` | Las unidades de servicio y el temporizador de actualizaciones                                                                                                                        |

La raíz es `root:arkvory` con modo `0711`. Dentro de ella, `config/` es `0750 root:arkvory`, `data/` y `logs/` pertenecen a `arkvory`, y `database/` pertenece a `arkvory-db` con modo `0700`. Los archivos de la clave de recuperación y de la contraseña de la base de datos solo los puede leer `root`.

### Cuentas {#accounts}

| Cuenta       | Ejecuta                                    | Notas                                                                                                                |
| ------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `arkvory`    | API, worker, agente de copias de seguridad | Cuenta de sistema, sin shell de inicio de sesión, home `/opt/proanima-arkvory/data`                                  |
| `arkvory-db` | La base de datos                           | Cuenta de sistema, sin shell de inicio de sesión. La cuenta de la API no puede leer los archivos de la base de datos |

### Servicios {#services}

| Unidad                 | Se ejecuta como                             | Política de reinicio                                                            |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `arkvory-database`     | `arkvory-db`                                | `on-failure`, tras 10 segundos                                                  |
| `arkvory-api`          | `arkvory`                                   | `always`, tras 10 segundos                                                      |
| `arkvory-worker`       | `arkvory`                                   | `always`, tras 10 segundos                                                      |
| `arkvory-backup`       | `arkvory`                                   | `always`, tras 10 segundos                                                      |
| `arkvory-update.timer` | inicia `arkvory-update.service` como `root` | Cada minuto. La tarea comprueba si hay solicitudes de actualización y versiones |

Todas las unidades se inician al arrancar (`multi-user.target`). Conceden 120 segundos para detenerse. Se ejecutan con `NoNewPrivileges`, un `/tmp` privado, un sistema de archivos de solo lectura fuera de sus propios directorios y sin acceso a `/home`. La API y el worker solo pueden escribir en `data/`, `logs/` y `updates/inbox/` de la raíz. El agente de copias de seguridad lee el almacenamiento y solo escribe en el almacén de copias. Como `/home` está oculto para las unidades, nunca coloque certificados, almacenes o el directorio de datos bajo un directorio personal.

Un servicio que se detiene sin su solicitud se inicia de nuevo tras 10 segundos. Un proceso cuyo hilo principal se bloquea durante 60 segundos se termina a sí mismo y se inicia de nuevo. Una comprobación de disponibilidad fallida por sí sola no reinicia un servicio. Consulte [Autorrecuperación](../operate/self-healing).

### Puertos {#ports}

| Puerto    | Uso                                 | Exposición                                             |
| --------- | ----------------------------------- | ------------------------------------------------------ |
| 8080/TCP  | API y consola                       | Solo `127.0.0.1`, hasta que configure [HTTPS](./https) |
| 54329/TCP | El clúster gestionado de PostgreSQL | Solo `127.0.0.1`. El número es fijo                    |

## Primer inicio y configuración inicial {#first-start}

1. Compruebe que los servicios se ejecutan:

   ```bash
   systemctl status arkvory-database arkvory-api arkvory-worker arkvory-backup
   ```

2. Lea la clave de recuperación. Solo `root` puede leerla.

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Abra `http://127.0.0.1:8080/console/#onboarding`. En un servidor remoto, reenvíe primero el puerto y abra la dirección en su propio equipo:

   ```bash
   ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
   ```

4. En la consola, abra [[ui:navStart]] y expanda [[ui:welcomeOwner]]. Pegue la clave en [[ui:welcomeRecovery]], introduzca el nombre del propietario y una contraseña de al menos 12 caracteres, y seleccione [[ui:welcomeCreate]]. El nombre tiene de 3 a 64 caracteres: letras latinas, dígitos, punto, guion o guion bajo.
5. Inicie sesión con el nuevo nombre y la contraseña.

El propietario es el primer administrador. La clave de recuperación permanece en el servidor: no elimine el archivo y no lo copie a clientes ni a sistemas de CI. Las herramientas de instalación lo leen. Para el trabajo diario, cree cuentas y claves de servicio. Consulte [Cuentas y acceso](../use/accounts) y [Seguridad](../operate/security).

Antes de que los clientes se conecten desde otros equipos, configure [HTTPS](./https). Después conecte un almacén de copias y ejecute una primera copia de seguridad: consulte [Copias de seguridad](../operate/backups).

Para instalar en un servidor desde su propio equipo, puede usar Arkvory Remote Setup en su lugar. Consulte [Elegir una instalación](./#remote-installation-over-ssh).

## El comando arkvory {#arkvory-command}

El paquete instala `/usr/bin/arkvory`. `arkvory help` lista todos los comandos y no necesita derechos especiales. Todos los demás comandos necesitan `root` y la raíz de la instalación:

```bash
sudo arkvory status --root /opt/proanima-arkvory
```

`status` imprime el modo de instalación, la versión instalada, el ajuste de actualización automática y la fijación de versión.

| Comando           | Uso                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `status`          | Muestra la versión instalada y la política de actualización                                                           |
| `update`          | Instala ahora una versión estable más reciente. Consulte [Actualizaciones](./updates)                                 |
| `configure`       | HTTPS, almacén de copias, espejos, política de actualización y hub. Consulte [Configuración](./configuration)         |
| `recover`         | Termina una actualización interrumpida. Consulte [Actualizaciones](./updates#recover-update)                          |
| `finish-install`  | Continúa una instalación interrumpida                                                                                 |
| `updates-connect` | Conecta la consola y el temporizador de actualizaciones de una instalación que se actualizó desde una versión antigua |

## Registros {#logs}

Los servicios escriben en el journal del sistema. La API y el worker escriben un registro JSON por línea.

```bash
sudo journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup -u arkvory-database
sudo journalctl -u arkvory-api -f
sudo journalctl -u arkvory-update --since today
```

`arkvory-update` contiene la salida del temporizador de actualizaciones. El tamaño y la retención del journal son ajustes de su sistema operativo. Para los campos de los registros y las métricas, consulte [Monitorización](../operate/monitoring). Los comandos de despliegue imprimen líneas con la forma `<ISO-8601 time> INFO|WARN|ERROR <text>`. Los secretos se eliminan de ellas.

## Actualizar {#upgrade}

Instale un paquete más reciente sobre el anterior, o actualice desde la consola o con `arkvory update`. Los servicios en ejecución siguen sirviendo hasta que la actualización cambia al nuevo código. Consulte [Actualizaciones](./updates) para las políticas, la copia de seguridad antes de un cambio de esquema de la base de datos y los pasos de recuperación.

No hay un repositorio apt ni dnf para Arkvory. Descargue cada paquete nuevo desde la página de versiones.

## Desinstalar {#remove}

### Desinstalar el paquete y conservar los datos {#remove-package}

En Debian y Ubuntu:

```bash
sudo apt remove proanima-arkvory
```

En Fedora y sistemas compatibles con RPM:

```bash
sudo dnf remove proanima-arkvory
```

La desinstalación detiene y desactiva los servicios y el temporizador de actualizaciones. Elimina `/usr/lib/proanima-arkvory`, `/usr/bin/arkvory` y la entrada de menú. **Conserva** a propósito:

- `/opt/proanima-arkvory`: la base de datos, todos los archivos, la configuración y la clave de recuperación,
- los archivos de unidad en `/etc/systemd/system`, las cuentas `arkvory` y `arkvory-db`,
- el almacén de copias y su drop-in de systemd. Nunca toca el almacén.

`apt purge` no elimina más que `apt remove`. Si instala el paquete de nuevo, continúa con los datos conservados e inicia los servicios.

### Eliminar todo {#remove-all}

Esto elimina todos los archivos almacenados y el catálogo. Haga una copia de seguridad primero y conserve el almacén.

```bash
sudo systemctl disable --now arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-database
sudo rm -rf /opt/proanima-arkvory
sudo rm -f /etc/systemd/system/arkvory-*.service /etc/systemd/system/arkvory-update.timer
sudo rm -rf /etc/systemd/system/arkvory-backup.service.d
sudo systemctl daemon-reload
sudo userdel arkvory
sudo userdel arkvory-db
```

Elimine primero el paquete, como se describe arriba. Tras una instalación por script no hay paquete: el primer comando detiene los servicios, y los comandos que nombran `arkvory-database` y `arkvory-db` informan de que no existen.

## Usar un PostgreSQL existente {#existing-postgresql}

El paquete siempre crea su propio clúster. Para usar un servidor PostgreSQL que ejecuta su organización, instale con `install.sh`. Crea los mismos tres servicios y el temporizador de actualizaciones, pero ninguna unidad `arkvory-database` ni el comando `/usr/bin/arkvory`.

Use una versión de PostgreSQL de la 16 a la 19. Use una base de datos para una instalación de Arkvory. Nunca conecte dos instalaciones a la misma base de datos.

1. Pida a su administrador de bases de datos una base de datos vacía y un rol que sea su propietario. Arkvory ejecuta sus migraciones con este rol.
2. Descargue `install.sh` de la versión y léalo. Necesita `bash`, `curl`, `python3`, `tar` y `xz`, systemd y `root`.
3. Ejecútelo. El script pide la URL de conexión; la entrada está oculta.

   ```bash
   sudo bash ./install.sh --automatic
   ```

   Para pasar la URL en un archivo en su lugar, cree un archivo que solo `root` pueda leer:

   ```json
   { "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
   ```

   ```bash
   sudo bash ./install.sh --config /root/arkvory.json
   ```

4. Elimine el directorio temporal `/opt/proanima-arkvory/bootstrap.*` cuando la instalación haya terminado. Si escribió la URL en el indicador, el directorio la guarda en `native.json`.
5. Cree el propietario como se describe en [Primer inicio y primeros pasos](#first-start).

El script descarga Node.js 24.21.0 de `nodejs.org`, comprueba su SHA-256 e instala la última versión estable. Omita `--automatic` para mantener las actualizaciones automáticas desactivadas. Las variables de entorno cambian los valores predeterminados:

| Variable                  | Significado                                                                 | Valor predeterminado    |
| ------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| `ARKVORY_INSTALL_ROOT`    | Raíz de la instalación. Use un directorio dedicado y vacío fuera de `/home` | `/opt/proanima-arkvory` |
| `ARKVORY_RELEASE_VERSION` | Instalar esta versión estable en lugar de la más reciente                   | última estable          |
| `ARKVORY_ARTIFACT_DIR`    | Instalar desde un `Arkvory-Linux.tar.gz` descomprimido en lugar de GitHub   | sin definir             |

Páselas a través de `sudo env`, por ejemplo `sudo env ARKVORY_INSTALL_ROOT=/srv/arkvory bash ./install.sh`.

Sin el comando `arkvory`, llame al programa de gestión con el Node.js que instaló el script. Use `linux-arm64` en arm64:

```bash
root=/opt/proanima-arkvory
sudo "$root/runtime/node-v24.21.0-linux-x64/bin/node" "$root/manage.mjs" status --root "$root"
```

Usted mismo hace las copias de seguridad y el mantenimiento del servidor PostgreSQL. El agente de copias de seguridad de Arkvory copia el contenido de la base de datos al almacén a través de la URL de conexión. Consulte [Copias de seguridad](../operate/backups).

## Solución de problemas {#troubleshooting}

| Problema                                                            | Qué hacer                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PostgreSQL 16–19 server binaries are required`                     | Faltan los programas de PostgreSQL o son demasiado antiguos. Instale un servidor PostgreSQL de la versión 16 a la 19 e instale el paquete de nuevo                                                                                                                                                                                                                                                               |
| `Use a dedicated empty installation directory`                      | `/opt/proanima-arkvory` contiene archivos de una primera instalación que se detuvo antes de guardar `installation.json`. El instalador nunca sobrescribe una configuración. Lea el journal y la salida del gestor de paquetes y corrija la causa. Un directorio que aún no contiene datos se puede mover para poder instalar de nuevo. No elimine `config/` ni `database/` de una instalación que contenga datos |
| `Installation is locked`                                            | Hay una operación en curso o que se ha bloqueado. Detenga el temporizador de actualizaciones, lea `journal.json` en la raíz y no elimine `operation.lock` antes de conocer el estado. Consulte [Actualizaciones](./updates#recover-update)                                                                                                                                                                       |
| Existe `database/bootstrap-started`, pero no `database/initialized` | La creación de la base de datos se interrumpió. No elimine el clúster ni repita el SQL a mano. Corrija la causa y ejecute `sudo arkvory finish-install --root /opt/proanima-arkvory`                                                                                                                                                                                                                             |
| Un servicio no se inicia                                            | `journalctl -u arkvory-api -n 100`. Un fallo de inicio imprime un registro JSON con un `reason` que nombra el ajuste, nunca su valor                                                                                                                                                                                                                                                                             |
| El puerto 8080 está ocupado                                         | Otro programa lo usa. Libere el puerto o establezca `ARKVORY_PORT` en `config/runtime.json`. Consulte [Configuración](./configuration#address-and-port). El puerto de la base de datos 54329 no se puede cambiar                                                                                                                                                                                                 |

Si la instalación se detuvo después de escribir `installation.json`, también puede repetir el paso de configuración del paquete: `sudo dpkg --configure -a` en Debian y Ubuntu, o instalar el mismo paquete de nuevo en sistemas RPM.

Hay más sugerencias en [Solución de problemas](../operate/troubleshooting).
