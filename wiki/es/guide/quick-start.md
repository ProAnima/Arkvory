---
title: Inicio rápido
---

# Inicio rápido

Esta página muestra el camino más corto desde cero hasta un servidor Arkvory en funcionamiento con un archivo subido. Elija un método de instalación en el paso 1 y siga los demás pasos en orden.

Descargue los instaladores solo de la [página de versiones](https://github.com/ProAnima/Arkvory/releases) del proyecto y compare su SHA-256 con los archivos de sumas de comprobación de la versión.

## Paso 1. Instalar el servidor {#step-1-install-the-server}

### Windows {#windows}

Necesita Windows 10 versión 1809 o posterior, o Windows Server 2019 o posterior, en x64, y derechos de administrador. No se necesita conexión a internet.

1. Ejecute `Arkvory-Setup-x64.exe` y confirme la solicitud de permisos de administrador.
2. Elija el idioma y acepte la licencia.
3. En la página del propietario, introduzca un nombre (3–64 letras latinas, dígitos, `.`, `-` o `_`) y una contraseña de al menos 12 caracteres. Es la primera cuenta de administrador.
4. Finalice el asistente. Este puede abrir la consola por usted.

El instalador instala el programa en `C:\Program Files\ProAnima\Arkvory` y los datos en `C:\ProgramData\ProAnima\Arkvory`. Crea cuatro servicios de Windows: `Arkvorydatabase`, `Arkvoryapi`, `Arkvoryworker` y `Arkvorybackup`. Se ejecutan sin un usuario con sesión iniciada. Consulte [Windows](../install/windows).

### Linux {#linux}

Use el paquete de su distribución. El administrador de paquetes también instala el servidor PostgreSQL (se admiten las versiones 16 a 19).

```bash
# Debian, Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora, compatibles con RHEL
sudo dnf install ./Arkvory-x86_64.rpm
```

La raíz de la instalación es `/opt/proanima-arkvory`. El paquete crea los servicios de systemd `arkvory-database`, `arkvory-api`, `arkvory-worker` y `arkvory-backup`. Compruébelos:

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

Consulte [Linux](../install/linux).

### Docker Compose {#docker-compose}

Necesita Docker con Compose. En Windows, use Docker Desktop con contenedores Linux. El script descarga Node.js y la versión, por lo que necesita acceso a internet.

Descargue `install.sh` o `install.ps1` de la versión y léalo antes de ejecutarlo.

```bash
sudo bash ./install.sh --mode compose
```

En Windows, ejecute PowerShell con el mismo usuario que ejecuta Docker Desktop, sin derechos de administrador:

```powershell
.\install.ps1 -Mode compose
```

La raíz de la instalación es `/opt/proanima-arkvory` en Linux y `C:\ProgramData\ProAnima\Arkvory` en Windows. El conjunto incluye la API, el worker, el agente de copias de seguridad y PostgreSQL 18. Consulte [Docker](../install/docker).

## Paso 2. Abrir la consola {#step-2-open-the-console}

Abra `http://127.0.0.1:8080/console/` en un navegador del propio servidor.

Al principio, el servidor escucha solo en la dirección local `127.0.0.1`. Para abrir la consola desde su propio equipo, redirija el puerto mediante SSH:

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

Después abra `http://127.0.0.1:8080/console/` en su equipo. Para dar acceso a otros equipos, configure antes [HTTPS](../install/https).

## Paso 3. Crear el propietario {#step-3-create-the-owner}

En Windows, omita este paso: el instalador ya ha creado al propietario.

En Linux y Docker, la primera cuenta se crea con la **clave de recuperación**. El instalador la escribe en `config/bootstrap-token.txt`, dentro de la raíz de la instalación. Solo un administrador puede leer el archivo.

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. En la consola, abra [[ui:navStart]] y expanda [[ui:welcomeOwner]].
2. Pegue la clave en [[ui:welcomeRecovery]].
3. Introduzca el nombre del propietario y una contraseña de al menos 12 caracteres, y seleccione [[ui:welcomeCreate]].
4. Inicie sesión con el nuevo nombre y la nueva contraseña en la tarjeta [[ui:connection]].

Mantenga en secreto la clave de recuperación y no elimine el archivo. Las herramientas de instalación y de actualización lo usan. Consulte [Seguridad](../operate/security).

El propietario es administrador y puede escribir en el repositorio `releases`. Para crear otro repositorio, abra [[ui:administration]], expanda [[ui:manageGrants]], conceda al grupo `arkvory-owners` el acceso [[ui:write]] a un nombre nuevo, como `builds`, y seleccione [[ui:saveGrant]]. El nombre de un repositorio usa letras latinas minúsculas, dígitos, `-` y `_`, y tiene como máximo 64 caracteres.

## Paso 4. Crear una clave para sus herramientas {#step-4-create-a-key-for-your-tools}

Los scripts y el cliente de línea de comandos necesitan una clave. Para una primera prueba, use un token de acceso personal:

1. Expanda [[ui:personalAccessTokens]] en la tarjeta [[ui:connection]].
2. Introduzca un nombre en [[ui:tokenName]], establezca [[ui:tokenScope]] en [[ui:tokenScopeReadWrite]] y seleccione [[ui:generateToken]].
3. Copie el token. Solo se muestra una vez.
4. Guárdelo en un archivo que solo usted pueda leer, por ejemplo `~/.arkvory/key`.

Para CI/CD y agentes de despliegue, cree en su lugar una cuenta de servicio con su propia clave. Consulte [Cuentas y acceso](../use/accounts).

## Paso 5. Subir y descargar con curl {#step-5-upload-and-download-with-curl}

Una ruta de archivo de un repositorio funciona como un archivo en un servidor web. `PUT` almacena una versión nueva de la ruta y `GET` devuelve la versión actual.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# Subida
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# Descarga
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

La subida devuelve un JSON como este:

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

Si vuelve a subir los mismos bytes, la respuesta es `200` con `"created": false` y no se crea ninguna versión nueva. Un archivo nuevo recibe el estado `201`.

En PowerShell:

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

Una solicitud `PUT` debe terminar en 30 minutos. Para archivos muy grandes o redes lentas, use el cliente de línea de comandos: sube en partes y continúa tras un fallo. Consulte [Archivos raw](../protocols/raw-files).

## Paso 6. Usar el cliente de línea de comandos {#step-6-use-the-command-line-client}

Instale `arkvoryctl` en su propio equipo: `Arkvory-CLI-Setup-x64.exe` en Windows, `Arkvory-CLI-amd64.deb` o `Arkvory-CLI-x86_64.rpm` en Linux. En una máquina de CI con Node.js 24, también sirve `arkvoryctl.mjs`.

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

El perfil usa el repositorio `releases`, salvo que agregue `--repository`. Si una transferencia se interrumpe, ejecute de nuevo el mismo comando: continúa desde donde se detuvo y comprueba el SHA-256 al final. El cliente acepta HTTP sin cifrar solo para el equipo local; para un servidor remoto, use HTTPS. Consulte [Cliente de línea de comandos](../protocols/cli).

## Siguientes pasos {#next-steps}

- [Conceptos](./concepts): repositorios, artefactos, etapas y claves.
- [HTTPS](../install/https): abra el servidor a otros equipos de forma segura.
- [Copias de seguridad](../operate/backups): conecte un almacén de copias antes de guardar datos importantes.
- [Paquetes](../use/packages) y [Promoción](../use/promotion): compilaciones con versiones para el despliegue.
- [La consola web](./console): un recorrido por todas las secciones.
