---
title: Puertas de enlace de lectura
description: Ejecute procesos de API adicionales solo para descargas en el mismo servidor y almacenamiento, comparta entre ellos un único presupuesto de descarga y monitorícelos.
---

# Puertas de enlace de lectura

Una **puerta de enlace de lectura** es un proceso de API adicional que solo sirve descargas. Se ejecuta en el mismo servidor que la API principal (el **writer**), usa la misma base de datos PostgreSQL y el mismo directorio de almacenamiento, y comparte un único presupuesto de descarga con el writer y con las demás puertas de enlace.

Use las puertas de enlace para repartir muchas descargas paralelas entre varios procesos mientras la velocidad total de descarga se mantiene por debajo de un único límite que usted fija. Una puerta de enlace no copia datos. Lee los archivos que publicó el writer, por lo que nunca va por detrás. Tampoco le protege de la pérdida del servidor o del disco. Para eso, consulte [Copias de seguridad](./backups) y [Espejos](./mirrors).

## Cómo funciona {#how-it-works}

- La instalación tiene un writer y hasta 15 puertas de enlace de lectura. En conjunto ocupan como máximo 16 **slots**. El writer siempre usa el slot 0. Cada puerta de enlace usa su propio slot, de 1 al número de slots menos uno.
- Todos los procesos usan una base de datos PostgreSQL y un directorio de almacenamiento. Una puerta de enlace comprueba que el almacenamiento existe y pertenece a la base de datos. Nunca lo crea.
- Usted fija una velocidad total de descarga para todos los procesos. Cada proceso recibe una parte fija e igual: el total dividido por el número de slots, redondeado hacia abajo.
- Un proceso conserva su slot mediante un lease en la base de datos. Si pierde el lease, deja de servir datos nuevos y debe reiniciarse. Así la suma de todas las partes se mantiene por debajo del total.

El writer conserva su función habitual. Recibe las subidas, atiende la consola, hace la limpieza en segundo plano y realiza todos los cambios. Una puerta de enlace nunca ejecuta la limpieza.

## Qué rechaza una puerta de enlace {#refusals}

Una puerta de enlace acepta solo `GET` y `HEAD`. Toda solicitud que cambie algo recibe HTTP 405 con el encabezado `Allow: GET, HEAD` y el código `read_only`, incluso cuando la clave tiene permisos de escritura. Esto incluye el inicio de sesión y el autorregistro. La consola forma parte únicamente del writer, por lo que no está disponible en una puerta de enlace.

Los permisos de los repositorios se comprueban en cada lectura, igual que en el writer. Las sesiones, los tokens personales y las claves de servicio funcionan en una puerta de enlace para leer.

## Requisitos {#requirements}

- **El mismo servidor.** La puerta de enlace debe ver exactamente los archivos que publicó el writer, sin retraso. No sirven los discos independientes con `rsync` ni con otra copia asíncrona. Todavía no se ha certificado ningún sistema de archivos de red, por lo que use las puertas de enlace para varios procesos en un mismo servidor.
- **Las mismas claves de servicio.** Dé a cada proceso el mismo contenido de `ARKVORY_KEYS_FILE`, para que las claves de archivo y sus ID coincidan. Las claves de servicio administradas están en la base de datos, así que coinciden por sí solas.
- **Un puerto propio.** Cada proceso del mismo equipo necesita su propio `ARKVORY_PORT`.
- **Una vista de solo lectura de los archivos.** Cuando pueda, monte el directorio de almacenamiento en modo de solo lectura para la puerta de enlace. El rechazo HTTP no sustituye a los permisos del sistema operativo. Tenga en cuenta que la puerta de enlace sigue escribiendo en la base de datos: los leases, los diagnósticos del almacenamiento, la hora del último uso de los tokens personales y los bloqueos que protegen los archivos que se están leyendo.
- **Conexiones a la base de datos.** Cada puerta de enlace necesita una conexión más que `ARKVORY_DATABASE_POOL_SIZE`. Inclúyalas en `max_connections` de PostgreSQL.

## Ejecutar una puerta de enlace {#run}

Los instaladores registran la API, el worker y el agente de copias de seguridad. No registran una puerta de enlace, y `arkvory status` no la administra. Usted inicia una puerta de enlace por su cuenta, como una instancia más del programa de la API de la versión instalada, con su propio entorno y bajo su propio administrador de servicios.

Ajustes que son iguales para todos los procesos, para dos procesos en total con 64 MiB/s en conjunto y 16 MiB/s para una cuenta o una clave:

```dotenv
ARKVORY_GATEWAY_SLOTS=2
ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND=67108864
ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL=16777216
```

El writer añade:

```dotenv
ARKVORY_ROLE=api
ARKVORY_GATEWAY_SLOT=0
```

Una puerta de enlace añade:

```dotenv
ARKVORY_ROLE=reader
ARKVORY_GATEWAY_SLOT=1
ARKVORY_PORT=8081
```

La puerta de enlace necesita también el resto de los ajustes de la API: `ARKVORY_DATABASE_URL` de la misma base de datos, `ARKVORY_DATA_DIR` que lleve al mismo almacenamiento (la ruta puede ser distinta, pero la identidad del almacenamiento debe coincidir), `ARKVORY_KEYS_FILE` y los ajustes de HTTPS si la puerta de enlace es accesible desde otros equipos. Consulte [Variables de entorno](../reference/environment#read-gateways).

| Variable                                                 | Regla                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_GATEWAY_SLOTS`                                  | El número de procesos, incluido el writer, de 2 a 16                                                                                        |
| `ARKVORY_GATEWAY_SLOT`                                   | El slot de este proceso, de 0 al número de slots menos uno. El writer es 0 y una puerta de enlace no es 0                                   |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | Obligatoria. La velocidad total de todos los procesos, al menos 65 536 veces el número de slots y como máximo 1 TiB por segundo             |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | La velocidad total para una cuenta o una clave en todos los procesos. `0` significa sin límite. En otro caso, el mismo intervalo que arriba |

Si define cualquiera de estas variables, defina el slot, el número de slots y la velocidad total en cada proceso. Un valor no válido detiene el proceso al iniciarse, con un mensaje que nombra la variable. Una puerta de enlace sin configuración de descarga compartida se niega a iniciarse.

1. Decida el número de slots y las velocidades.
2. Añada al writer las tres variables comunes y sus dos variables propias, y reinicie el writer. Guarda la política en la base de datos.
3. Inicie la puerta de enlace con sus propias variables. Si sus valores difieren de la política guardada, no se inicia.
4. Compruebe la disponibilidad de cada proceso y pruebe una descarga por rangos en cada uno. Consulte [Monitorizar las puertas de enlace](#monitoring).
5. Solo entonces añada la puerta de enlace a su balanceador de carga.

Algunas reglas protegen el perfil:

- Una puerta de enlace solo puede iniciarse después de que el writer guarde la política.
- Una vez que la política existe en la base de datos, un writer sin estas variables no se inicia. Se detiene con el mensaje de que la base de datos exige la configuración de descarga compartida.
- No puede cambiar las velocidades ni el número de slots en una instalación en funcionamiento. Consulte [Cambiar la configuración](#change).

## El presupuesto de descarga {#budget}

Cada proceso recibe `total / slots`, redondeado hacia abajo. Lo mismo se aplica a la velocidad para una cuenta o una clave. Por ejemplo, con 64 MiB/s y 2 slots, cada proceso sirve hasta 32 MiB/s, y una cuenta recibe hasta 8 MiB/s en cada proceso.

- Un proceso no puede usar la parte de otro. Si se detiene uno de dos procesos, se obtiene la mitad del total. Esto mantiene el límite simple y comprobable.
- Los ajustes locales `ARKVORY_DOWNLOAD_BYTES_PER_SECOND` y `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` pueden reducir una parte, no aumentarla.
- Los presupuestos de subida permanecen en el writer, porque las puertas de enlace no reciben subidas.
- La cola de transferencias en espera y el límite de transferencias activas son locales de cada proceso, por lo que las capacidades de todos los procesos se suman.

El límite se aplica a los datos de la aplicación, con una pequeña ráfaga. No es un límite de la interfaz de red. Consulte [Variables de entorno](../reference/environment#transfers-and-bandwidth).

## Leases y fallos {#leases}

La base de datos reserva un slot durante 10 segundos. Un proceso lo renueva cada 2 segundos y confía localmente en el lease durante 8 segundos como máximo. Un lease cuyo tiempo ha vencido nunca se reactiva, aunque llegue una respuesta tardía.

- **Lease perdido.** El proceso deja de entregar datos nuevos, responde con 503 a las nuevas solicitudes autorizadas y necesita un reinicio. Una descarga que se cortó puede continuar con un reintento o con una solicitud de rango. Esto se aplica también al writer.
- **Reinicio del mismo slot.** El proceso nuevo espera hasta que vence la reserva anterior, hasta 10 segundos después de su última renovación y hasta 15 segundos en total. Si una puerta de enlace en funcionamiento todavía conserva el slot, el proceso nuevo se detiene con `busy`.
- **Relojes.** Los leases dependen de relojes monótonos. Un salto del reloj del servidor de la base de datos, o una máquina virtual detenida, puede dejar a un proceso sirviendo más allá de su lease. En ese caso, detenga los procesos antiguos antes de iniciar un reemplazo.
- **Fallo de la base de datos.** La base de datos es el punto débil. Si deja de estar accesible, los leases vencen y todos los procesos dejan de servir datos.

El servidor puede detectar un proceso muerto que perdió la red solo mediante TCP keepalive. Defina `tcp_keepalives_idle`, `tcp_keepalives_interval` y `tcp_keepalives_count` en PostgreSQL, por ejemplo en 10, 5 y 3 segundos, o defina `tcp_user_timeout`. Sin ellos, un writer o un worker nuevo puede esperar el largo tiempo de espera predeterminado del sistema operativo.

## Monitorizar las puertas de enlace {#monitoring}

- `GET /health/status` es público y devuelve solo `ready`, `unavailable` o `draining`, con 503 cuando el proceso no puede servir (slot o lease perdido, vaciado). Úselo para su balanceador de carga.
- `GET /health/ready` requiere una clave. Devuelve `role`, `writable` (siempre `false` en una puerta de enlace), `sharedDownloads` con `slot`, `slots`, `active` y `leaseSeconds`, y los números de las colas locales de transferencias. Responde 503 cuando se pierde el slot. En una instalación independiente, `sharedDownloads` es `null`.
- `GET /health/live` solo indica que el proceso HTTP se ejecuta. No dice si una puerta de enlace puede servir.
- `GET /health/metrics` de cada proceso muestra únicamente ese proceso. Consulte cada puerta de enlace y use las métricas HTTP y de transferencias del propio proceso.

Compruebe cada proceso por separado. Que una puerta de enlace tenga `writable` en false es normal. Consulte [Monitorización](./monitoring).

## Encaminar las solicitudes {#routing}

El balanceador de carga es cosa suya. Arkvory no incluye ningún balanceador.

- Envíe al writer toda solicitud que cambie datos y `/console/`.
- Puede repartir las lecturas de bytes entre el writer y las puertas de enlace: `GET` y `HEAD` para `/api/v1/repositories/NAME/artifacts/ID/content`, para `.../packages/content` y para `.../asset/content`. Mantenga las demás solicitudes en el writer.
- Transmita los encabezados `Authorization`, `Range`, `If-Range` y `ETag`. Transmita el cuerpo en flujo, sin almacenar todo el archivo en un búfer. No redirija a un cliente a una URL que contenga una clave.
- Añada un backend al balanceador solo cuando su disponibilidad autenticada sea correcta.

El SDK de TypeScript puede continuar una descarga interrumpida a través de otro backend en buen estado detrás de la misma dirección. Una conexión TCP en curso no pasa de un servidor a otro.

## Cambiar la configuración {#change}

No puede cambiar las velocidades ni el número de slots mientras la instalación se ejecuta, ni volver a un único proceso mientras exista la política. Aunque todas las puertas de enlace estén detenidas, la política guardada impide un inicio sin límites.

1. Detenga el tráfico entrante. Detenga el writer, todas las puertas de enlace y el worker, y confirme que realmente están detenidos.
2. Espere a que hayan vencido los leases en la base de datos.
3. Haga una copia de seguridad. Consulte [Copias de seguridad](./backups).
4. Un administrador de la base de datos de Arkvory elimina todas las filas de las tablas `arkvory_gateway_leases` y `arkvory_download_policy` en una sola transacción. Esto restablece solo el estado de coordinación, no el catálogo.
5. Inicie el writer con los ajustes nuevos y después las puertas de enlace.

No lo haga nunca mientras algún proceso pueda seguir ejecutándose.

Una actualización requiere el mismo cuidado. Detenga todas las puertas de enlace antes de que la instalación se actualice e inícielas después desde la versión nueva. Una puerta de enlace que sigue ejecutando código antiguo con un esquema de base de datos más nuevo se declara a sí misma como no lista. Las herramientas sin conexión de reparación de la limpieza también requieren detener todas las puertas de enlace. La limpieza en línea del writer, no.

## Puertas de enlace o espejos {#gateways-or-mirrors}

|                                                | Puertas de enlace de lectura                                        | Espejos                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Qué es                                         | Más procesos de API en el mismo servidor y almacenamiento           | Una segunda instalación independiente con una copia de los datos                |
| Datos                                          | Una sola copia, leída en directo                                    | Una segunda copia, obtenida con retraso                                         |
| Cuentas y claves                               | Las mismas que las del writer                                       | Las suyas propias                                                               |
| Disco adicional                                | Ninguno                                                             | Sí, tanto como necesiten los repositorios                                       |
| Requiere                                       | La misma base de datos y el mismo sistema de archivos               | Un enlace HTTPS con el origen y una clave de solo lectura                       |
| Protege de la pérdida del servidor o del disco | No                                                                  | En parte: sirve mientras el origen no está disponible y puede conmutar a él     |
| Úselo para                                     | Más descargas paralelas con un único límite de velocidad compartido | Un segundo sitio, una oficina más cercana a los usuarios, una reserva en espera |

Ambos complementan las copias de seguridad; no las sustituyen.

## Límites {#limits}

- Todos los procesos deben compartir un servidor y un directorio de almacenamiento. Máquinas distintas requieren un sistema de archivos probado para ello, y todavía no se ha probado ninguno.
- No hay compatibilidad con el instalador, ni conmutación automática ni balanceador integrado.
- Una base de datos y un writer siguen siendo un único punto de fallo.
- El presupuesto es fijo por slot y no se redistribuye, y no hay planificación por prioridad.
- No se puede cambiar la política en una instalación en funcionamiento.

## Páginas relacionadas {#related-pages}

- [Espejos](./mirrors)
- [Monitorización](./monitoring)
- [Autorrecuperación](./self-healing)
- [Variables de entorno](../reference/environment#read-gateways)
- [Actualizaciones](../install/updates)
