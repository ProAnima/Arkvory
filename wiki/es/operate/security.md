---
title: Seguridad
description: 'Cómo proteger un servidor Arkvory, dónde viven sus secretos, qué límites protegen el inicio de sesión, qué se registra y se audita, y qué se envía al hub de ProAnimaStudio.'
---

# Seguridad

Esta página es para el administrador que ejecuta un servidor. Empieza con los pasos para proteger una instalación nueva y después describe cada protección en detalle.

El proyecto declara que un modelo de amenazas y una revisión de seguridad externa todavía están pendientes. No publique el servidor en Internet abierto. Deje que solo las redes de sus clientes lleguen a él.

## Proteger un servidor nuevo {#checklist}

1. Mantenga la dirección de escucha predeterminada `127.0.0.1` hasta que HTTPS funcione. Consulte [Red y HTTPS](#network).
2. Active HTTPS y abra solo el puerto HTTPS a las redes de los clientes. Nunca abra el puerto de la base de datos.
3. Cree cuentas personales para los administradores. Conserve la clave de recuperación para emergencias. Consulte [Clave de recuperación](../install/index#recovery-key).
4. Dé a cada herramienta o sistema de CI su propia cuenta de servicio con una clave que tenga los mínimos derechos. Consulte [Claves y tokens](#keys).
5. Deje el autorregistro desactivado. Está desactivado de forma predeterminada.
6. Si hay un proxy inverso delante de Arkvory, configure `ARKVORY_TRUSTED_PROXIES`. Consulte [Límites de inicio de sesión](#sign-in-limits).
7. Use un vault cifrado (el predeterminado) y guarde su kit de recuperación fuera del servidor. Póngalo además en un volumen cifrado que solo puedan leer la cuenta de servicio y el administrador de copias. Véase [Copias de seguridad](./backups#encryption).
8. Conserve copias de los archivos secretos fuera del servidor. Consulte [Copie sus secretos](#secret-backups).
9. Conecte las métricas y las alertas. Consulte [Monitorización](./monitoring).

## Red y HTTPS {#network}

El servidor escucha en `127.0.0.1:8080` de forma predeterminada. Una instalación nativa puede escuchar en otra dirección después de configurar HTTPS:

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-cert /etc/arkvory/fullchain.pem --tls-key /etc/arkvory/privkey.pem --listen-host 0.0.0.0
```

El comando comprueba los archivos, reinicia los servicios y restaura los ajustes anteriores cuando los servicios no arrancan. Consulte [HTTPS y proxy inverso](../install/https) para el procedimiento completo y para Docker Compose, que necesita un proxy inverso.

- El certificado y la clave deben leerse, coincidir y no haber caducado. De lo contrario, la API no se inicia y nunca recurre a HTTP sin cifrar.
- La versión mínima de TLS es 1.2. Configure `ARKVORY_TLS_MIN_VERSION=TLSv1.3` para exigir 1.3. No se admiten certificados de cliente.
- El servidor responde con `Strict-Transport-Security: max-age=31536000` cuando sirve HTTPS por sí mismo. Un proxy es el propietario de esa cabecera cuando termina TLS.
- Los archivos de certificado renovados se vuelven a leer cada 300 segundos (`ARKVORY_TLS_RELOAD_SECONDS`) sin reiniciar. Las conexiones nuevas reciben el certificado nuevo. Un archivo que no se puede leer deja el certificado en funcionamiento en su sitio y escribe `tls.reload_failed`. `tls.expiring` se escribe a diario durante los últimos 14 días.
- Una dirección no local sin TLS y sin un proxy de confianza escribe la advertencia `http.plaintext_exposed` al inicio. Arregle esto antes de dejar entrar a los clientes.
- Arkvory nunca desactiva la comprobación de un certificado que recibe: ni para los espejos, ni para el hub, ni en el cliente de línea de comandos. Añada su propia autoridad de certificación con `--mirror-ca-file` para los espejos.

Detrás de un proxy inverso, la API permanece en loopback. El proxy debe transmitir los cuerpos sin almacenar archivos enteros en búfer. No registre la cadena de consulta en el proxy, porque un enlace de descarga lleva allí su secreto.

## Secretos en el servidor {#secrets}

Los instaladores crean estos archivos en la raíz de la instalación. Mantenga los permisos que estableció el instalador.

| Archivo                      | Contenido                                                                             | Acceso                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `config/bootstrap-token.txt` | La clave de recuperación. Tiene derechos de administrador                             | Linux: solo root (modo 0600). Windows: SYSTEM y Administradores                    |
| `config/keys.json`           | Hashes SHA-256 de la clave de recuperación y la clave de estado, nunca las claves     | Linux: root escribe, el grupo de servicio lee (0640). Windows: heredado de la raíz |
| `config/health-token.txt`    | La clave de estado `deployment-health`. No tiene derechos de repositorio              | Linux: solo root. Compose: legible en el contenedor                                |
| `config/runtime.json`        | Todos los ajustes del servidor, incluida la URL de la base de datos con su contraseña | Linux: root escribe, el grupo de servicio lee (0640). Windows: heredado de la raíz |
| `config/postgres.env`        | La contraseña de la base de datos de una instalación Compose                          | Solo root, o SYSTEM y Administradores                                              |
| `github-token.txt`           | Un token de GitHub opcional para las actualizaciones                                  | Solo root, o SYSTEM y Administradores                                              |
| `config/mirrors/*.token`     | Claves de lectura para los servidores de origen de los espejos                        | La cuenta de servicio                                                              |
| La clave TLS                 | La clave privada del certificado                                                      | Usted elige la ubicación. Permita solo la cuenta de servicio                       |

En Windows, la raíz concede control total a SYSTEM y Administradores. La cuenta de servicio `LocalService` lee la raíz y solo escribe en `data\`, `logs\` y la bandeja de entrada de actualizaciones. La base de datos se ejecuta con otra cuenta, así que la API no puede leer los archivos de la base de datos.

Reglas para todos los secretos:

- Páselos en archivos o variables de entorno, nunca en argumentos de comando. Los argumentos son visibles en la lista de procesos.
- No copie la clave de recuperación a clientes, sistemas de CI ni scripts. Cree cuentas y claves de servicio para el trabajo diario.
- El servidor nunca escribe claves, contraseñas, tokens, cabeceras `Authorization` ni cadenas de consulta en su registro. Consulte [Monitorización](./monitoring#never-logged).
- La salida de los comandos del instalador censura las URL de bases de datos, las claves y los secretos largos.

Para sustituir la clave de recuperación, cambie juntos el archivo `bootstrap-token.txt` y su hash en `config/keys.json`, conserve la entrada `deployment-health` y reinicie la API y el worker. Consulte [Configuración](../install/configuration).

## Contraseñas y límites de inicio de sesión {#sign-in-limits}

Las contraseñas tienen de 12 a 128 caracteres y se guardan solo como un hash con sal (scrypt). Un inicio de sesión dura 12 horas. Una cuenta tiene como máximo 32 sesiones activas; un inicio de sesión nuevo termina la más antigua. Un cambio de contraseña o un restablecimiento termina todas las sesiones y revoca todos los tokens personales de la cuenta.

Arkvory no tiene un bloqueo duro, que permitiría a cualquiera que sepa un nombre bloquear al propietario. Frena los ataques por capas:

| Capa                                     | Límite                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Por dirección, inicio de sesión          | 10 intentos a la vez, después 1 más cada 15 segundos. Una contraseña correcta devuelve el intento. IPv6 cuenta por red /64                                                                                                                                                  |
| Por dirección, autorregistro             | 3 intentos, después 1 cada 20 minutos; 20 por proceso, después 1 cada 3 minutos                                                                                                                                                                                             |
| Por cuenta                               | Cada contraseña incorrecta añade una unidad de deuda. La deuda se reduce en 1 cada 6 segundos. Por encima de 20 unidades, cada contraseña incorrecta añade una espera que se duplica de 1 segundo a 2 minutos. Durante la espera, incluso la contraseña correcta recibe 429 |
| Solicitudes de inicio de sesión a la vez | Como máximo 16, y el cuerpo de una solicitud debe llegar en 10 segundos                                                                                                                                                                                                     |
| Comprobaciones de contraseña             | Las comprobaciones anónimas y las de administrador usan colas separadas, así que una avalancha de inicios de sesión no bloquea a un administrador                                                                                                                           |

La respuesta es 429 `rate_limited` con el motivo `login_attempts` y la cabecera `Retry-After`. Los contadores de direcciones viven en el proceso y se restablecen al reiniciar. La deuda de la cuenta está en la base de datos. Un restablecimiento de contraseña por un administrador la borra.

Detrás de un proxy inverso, configure `ARKVORY_TRUSTED_PROXIES` con las direcciones del proxy (hasta 32, IP o CIDR). Solo estas direcciones pueden indicar la dirección del cliente con `X-Forwarded-For`. Sin el ajuste, todos los clientes comparten la dirección del proxy, y unos pocos inicios de sesión fallidos bloquean a todos durante un tiempo.

## Claves, tokens y caducidad {#keys}

| Credencial                              | Duración                                                                                                           | Rotación                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesión de inicio de sesión              | 12 horas                                                                                                           | Inicie sesión de nuevo                                                                                                                      |
| Token de acceso personal                | 90 días de forma predeterminada, como máximo 365. Alcance `read` o `read-write`. Nunca derechos de administrador   | Cree un token nuevo en [[ui:personalAccessTokens]] y revoque el antiguo                                                                     |
| Clave de servicio                       | 90 días de forma predeterminada, como máximo 365. Una clave que se emite pero no se activa caduca a los 15 minutos | [[ui:keyRotate]] emite una clave nueva. La clave antigua funciona como máximo 24 horas más. [[ui:keyRevoke]] detiene una clave de inmediato |
| Enlace de descarga                      | Una hora en la consola                                                                                             | Cree un enlace nuevo                                                                                                                        |
| Clave de recuperación y clave de estado | No caducan                                                                                                         | Sustitúyalas a mano. Consulte [Secretos en el servidor](#secrets)                                                                           |

Cree tokens personales y cambie contraseñas solo en una sesión iniciada. Un token no puede crear tokens. Un token personal no tiene derechos de administrador, sea quien sea su propietario.

Mínimo privilegio para las herramientas:

- Cree una cuenta de servicio para cada consumidor en [[ui:services]], con [[ui:servicePolicy]] sobre los repositorios exactos y las acciones exactas que necesita. [[ui:bindingRead]] y [[ui:bindingPublish]] rellenan conjuntos típicos.
- Crear cuentas y concesiones necesita el derecho separado de la clave de recuperación o de una delegación. [[ui:delegations]] permite al propietario pasar derechos limitados a un operador. Una clave delegada nunca sobrevive a la clave de su emisor.
- Dé al recolector de métricas su propia clave con derechos mínimos.
- Revocar una concesión bloquea una clave que espera activación, pero no revoca las claves que ya están activas. Revóquelas o desactívelas usted mismo. Una descarga que ha empezado continúa tras una revocación.
- Un cambio de derechos se aplica desde la siguiente solicitud. El servidor comprueba el acceso de nuevo para cada solicitud, para listas, metadatos y bytes de archivos.

## Registros de auditoría {#audit}

| Diario                             | Qué contiene                                                                                                                                                                               | Dónde leerlo                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Diario de seguridad                | Inicios de sesión y fallos, registros, cambios de cuentas, grupos, concesiones, contraseñas y tokens personales, con actor, tipo de credencial, destino, resultado y dirección del cliente | `GET /api/v1/security/audit`, para una sesión de administrador o la clave de recuperación |
| Auditoría del catálogo             | Cambios de artefactos, rutas, anotaciones y etapas en un repositorio                                                                                                                       | `GET /api/v1/repositories/{repository}/audit`, con el permiso para leer la auditoría      |
| Actividad de la cuenta de servicio | Creación, cambios, claves emitidas y revocadas de una cuenta de servicio                                                                                                                   | [[ui:serviceAudit]] en la consola                                                         |
| Registro de procesos               | Una línea `http.access` por solicitud, con `principal` y `clientIp`                                                                                                                        | Consulte [Monitorización](./monitoring#logs)                                              |

El diario de seguridad es de solo anexado: la base de datos se niega a cambiar o eliminar una fila. El servidor conserva 365 días y como máximo 1 000 000 de filas, y elimina las más antiguas por lotes. Las solicitudes que los límites de velocidad rechazan no se registran, así que una avalancha no puede hacer crecer la tabla. Exporte el diario a su propio almacén de eventos si necesita un historial más largo.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "https://arkvory.example/api/v1/security/audit?limit=100"
```

Use el parámetro `after` con el último ID para leer filas más antiguas.

## Consola y navegador {#console-headers}

El servidor establece estas cabeceras en las respuestas de la consola:

| Cabecera                  | Valor                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | `default-src 'none'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `Referrer-Policy`         | `no-referrer`                                                                                                                                                                       |
| `X-Content-Type-Options`  | `nosniff`                                                                                                                                                                           |
| `Cache-Control`           | `private, no-store`                                                                                                                                                                 |
| `X-Request-Id`            | El ID de solicitud de la respuesta                                                                                                                                                  |

Cada respuesta de la API también lleva `X-Content-Type-Options`, `Cache-Control` y `X-Request-Id`. La CSP no permite scripts en línea, scripts externos, marcos ni conexión con otros hosts. Las imágenes de `blob:` son las capturas que añade a un mensaje de comentarios.

El servidor no establece cookies. La consola guarda una clave o un token de sesión solo en la memoria de la pestaña del navegador. El navegador solo almacena la elección de tema e idioma, y los archivos privados de la cola de descargas. Una página de navegador de otra dirección no puede llamar a la API: `ARKVORY_CORS_ORIGINS` está vacía de forma predeterminada. Enumera hasta 16 orígenes exactos para una consola externa, con HTTPS o HTTP en loopback. Un origen permitido no obtiene derechos adicionales, porque cada solicitud necesita una clave.

## Firma de actualizaciones {#update-signing}

Cada versión tiene un manifiesto `arkvory-release.json` con el SHA-256 de su archivo y su instalador, y una firma `arkvory-release.json.sig`. La firma es una firma Ed25519 en el formato minisign. El actualizador guarda las claves públicas dentro de su código.

- Una versión del hub o de GitHub se instala solo cuando su firma coincide con una clave integrada y los valores SHA-256 coinciden con el manifiesto. Una firma incorrecta es un error, y el actualizador no busca otra fuente.
- La clave de firma privada se queda con el mantenedor y nunca está en su servidor. Una versión puede llevar una clave pública antigua y una nueva para rotar las claves.
- Una carpeta local que pase con `--artifact` es elección suya. Un archivo de firma que contenga se comprueba cuando está presente.
- El instalador gráfico y los paquetes `.deb` y `.rpm` todavía no están firmados con un certificado de editor. Windows muestra el editor como desconocido. Descárguelos solo de [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) y compare los valores SHA-256 con `release-checksums.json`.
- Una versión que cambia el esquema de la base de datos se instala solo después de que el servidor haya hecho y verificado una copia de seguridad reciente. Consulte [Actualizaciones](../install/updates).

## Qué se envía al hub de ProAnimaStudio {#hub}

Las actualizaciones se aprueban en el hub de ProAnimaStudio (`https://hub.proanima.net`). El servidor lo contacta en estos casos:

| Datos                         | Cuándo                                                           | Contenido                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comprobación de actualización | Cada 6 horas                                                     | La versión actual, el sistema operativo y la arquitectura forman parte de la dirección. Con las estadísticas activadas, un ID de instalación aleatorio en la cabecera `X-Install-Id`                                                                                                          |
| Evento `updated`              | Tras una actualización instalada, con las estadísticas activadas | La versión y el ID de instalación                                                                                                                                                                                                                                                             |
| Comentarios                   | Solo cuando un usuario envía el formulario en la consola         | El texto, una dirección de correo opcional para la respuesta, hasta 6 capturas y el registro de la página del navegador. Un administrador puede añadir el último 1.5 MiB del registro de la API y un resumen del sistema. El formulario lo muestra todo antes de enviarlo ([[ui:reportShow]]) |

El ID de instalación es un UUID aleatorio en `config/install-id`. No lleva nombre, dirección ni contenido. El proyecto declara que el hub no almacena direcciones IP, nombres ni contenido de archivos. Sin estadísticas no se envía el ID, y el hub ofrece una versión solo cuando se publica para todas las instalaciones. El resumen del sistema contiene versiones, el número de esquema y el estado de las actualizaciones y los espejos, sin direcciones ni secretos. El registro de la API tampoco tiene secretos.

Desactívelo:

```bash
sudo arkvory configure --root /opt/proanima-arkvory --statistics off
sudo arkvory configure --root /opt/proanima-arkvory --hub-off
```

- `--statistics off` detiene el ID de instalación y el evento `updated`. La consola tiene el mismo interruptor: [[ui:updateStatistics]] en [[ui:updates]].
- `--hub-off` detiene todo contacto con el hub. Entonces las actualizaciones solo vienen de GitHub, y los comentarios de la consola se desactivan tras el siguiente reinicio de los servicios. En su lugar, los usuarios ven la dirección de contacto que muestra la consola.
- `--hub-url https://hub.example` apunta el servidor a otro hub. Solo se acepta HTTPS, o HTTP en loopback.

Las comprobaciones cada 6 horas también se ejecutan cuando la instalación automática está desactivada. Un servidor sin acceso a Internet se instala desde una copia local de una versión. Consulte [Actualizaciones](../install/updates).

## Copie sus secretos {#secret-backups}

El vault guarda el catálogo, los hashes de contraseñas y todos los archivos publicados. Arkvory lo cifra al crearlo, y su kit de recuperación debe guardarse fuera del servidor (véase [Copias de seguridad](./backups#encryption)). El vault no guarda los archivos de su configuración. Guarde una segunda copia de esos archivos en un lugar cifrado fuera del servidor:

- el kit de recuperación del vault de copias: es la única forma de leer las copias si se pierden el servidor y su archivo de clave; guarde dos copias en dos lugares.
- `config/keys.json` y `config/bootstrap-token.txt` (la clave de recuperación),
- `config/runtime.json`,
- el certificado y la clave TLS,
- `config/mirrors/` con las claves de los espejos,
- `config/hub.json` y `github-token.txt`, si los usa.

Una restauración crea una instancia nueva con sus propios ajustes y su propio archivo de claves. Tras una restauración, las sesiones se han ido, los tokens personales y las claves de servicio están revocados, y las políticas de limpieza y retención están desactivadas. Emita claves nuevas y vuelva a activar las políticas a propósito. Las contraseñas vuelven como estaban en el momento de la instantánea. Trate cada copia de estos archivos como un secreto. Consulte [Copias de seguridad](./backups).

## Informar de una vulnerabilidad {#vulnerabilities}

No describa una vulnerabilidad ni publique claves en una incidencia pública. El propietario del proyecto es Ian Panaev (cuenta de GitHub `ProAnima`). El proyecto todavía no ha publicado un canal privado dedicado para informes de seguridad. Envíe un mensaje breve sin detalles de explotación a través de la cuenta de GitHub del proyecto o a la dirección del estudio que muestra la consola, `info@proanima.net`, y pida una vía privada para continuar. Consulte `SECURITY.md` en el repositorio.

## Páginas relacionadas {#related-pages}

- [Monitorización](./monitoring)
- [Autorrecuperación](./self-healing)
- [Cuentas y acceso](../use/accounts)
- [HTTPS y proxy inverso](../install/https)
- [Autenticación](../api/authentication)
- [Errores](../api/errors)
