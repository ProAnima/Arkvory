---
title: Autorrecuperación
description: 'Lo que Arkvory reinicia y reanuda por sí solo tras una caída, un bloqueo o una sesión de base de datos perdida, y lo que todavía necesita a un operador.'
---

# Autorrecuperación

Arkvory reinicia por sí solo un servicio que falla y reanuda el trabajo interrumpido sin un operador. Esta página enumera qué se reinicia, cuánto tarda cada recuperación y qué problemas todavía le necesitan. Un servidor no es un sistema de alta disponibilidad: un reinicio interrumpe las conexiones durante un breve período, y los clientes reanudan sus transferencias.

## Qué se reinicia por sí solo {#overview}

Cada servicio se ejecuta bajo el gestor de servicios de la plataforma. La API, el worker y el agente de copias de seguridad terminan su propio proceso cuando no pueden continuar de forma segura. El gestor de servicios inicia entonces un proceso nuevo.

| Situación                                                          | Linux (systemd)                                        | Servicios de Windows                                            | Docker Compose                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Caída, kill, falta de memoria                                      | Reinicio tras 10 s                                     | Reinicio tras 10 s                                              | El motor reinicia el contenedor con una pausa creciente                               |
| Salida sin una solicitud de parada, también con código de salida 0 | Reinicio                                               | El lanzador convierte la salida en código 1, reinicio tras 10 s | Reinicio                                                                              |
| Pérdida de la propiedad o del arrendamiento del almacenamiento     | Salida 1, reinicio                                     | Salida 1, reinicio                                              | Salida 1, reinicio                                                                    |
| Hilo principal bloqueado                                           | El watchdog termina el proceso, reinicio               | Lo mismo                                                        | Lo mismo                                                                              |
| Base de datos inaccesible al inicio                                | Salida 1, reintento cada 10 s                          | Salida 1, reintento cada 10 s                                   | Salida 1, reintento con una pausa creciente                                           |
| La máquina se reinicia                                             | Los servicios están habilitados en `multi-user.target` | Automático (inicio retrasado)                                   | Con el motor de contenedores. Docker Desktop: después de que el usuario inicie sesión |
| Usted detiene el servicio                                          | Permanece detenido hasta el siguiente arranque         | Permanece detenido hasta el siguiente arranque                  | `docker compose stop` permanece detenido                                              |

Una comprobación de preparación que falla por sí sola no reinicia un servicio. Puede fallar porque el proceso drena antes de detenerse, o porque falta una carpeta del directorio de almacenamiento. Un reinicio no arreglaría estas causas.

## Servicios de Windows {#windows}

El instalador gráfico e `install.ps1` registran `Arkvoryapi`, `Arkvoryworker` y `Arkvorybackup`, que comparten la cuenta `NT AUTHORITY\LocalService`, y el servicio de base de datos `Arkvorydatabase` para la base de datos administrada. Consulte [Windows](../install/windows#services).

- **Tipo de inicio.** La API, el worker y el agente de copias de seguridad usan Automático (inicio retrasado). La base de datos usa Automático. Un inicio retrasado significa que los servicios arrancan algún tiempo después del arranque, no en el mismo momento.
- **Acciones de recuperación.** Tras un error, Windows reinicia el servicio a los 10 segundos. La misma acción se repite para cada error siguiente. El contador de errores se restablece tras una hora. Las acciones de recuperación también se aplican cuando el proceso sale con un código de error.
- **Tiempo de espera de parada.** 120 segundos, para dejar que termine una solicitud en curso.
- **Registros.** La salida de cada servicio va a `logs\` y rota a los 20 MiB con 5 archivos antiguos.

Muestre las acciones de recuperación de un servicio:

```powershell
sc.exe qfailure Arkvoryapi
```

Ejecutar de nuevo el instalador gráfico restaura los tipos de inicio y las acciones de recuperación. Un servicio que usted detuvo permanece detenido.

## Unidades systemd de Linux {#linux}

Los paquetes e `install.sh` crean `arkvory-api`, `arkvory-worker` y `arkvory-backup`, y `arkvory-database` cuando la base de datos está administrada.

- `Restart=always` con `RestartSec=10` reinicia la API, el worker y el agente de copias de seguridad después de cada salida que usted no solicitó, incluido el código de salida 0.
- `StartLimitIntervalSec=0` elimina el límite de intentos de reinicio, así que systemd nunca se rinde con un servicio que falla. Un fallo permanente, como un ajuste incorrecto, provoca un reinicio cada 10 segundos hasta que lo arregle.
- La unidad de base de datos usa `Restart=on-failure` con los mismos 10 segundos.
- `TimeoutStopSec=120` da dos minutos a un servicio que se detiene.
- Las unidades están habilitadas para `multi-user.target`.

```bash
systemctl is-enabled arkvory-api arkvory-worker arkvory-backup
systemctl status arkvory-api arkvory-worker arkvory-backup
```

Solo se admite systemd para los servicios nativos. En un sistema con otro sistema de inicio, use Docker Compose.

## Docker Compose {#compose}

Todos los servicios del proyecto `proanima-arkvory` usan `restart: unless-stopped`. Los pasos únicos `initialize` y `migrate` no se reinician.

- El contenedor de la API tiene una comprobación de estado: cada 10 segundos consulta `/health/ready` con la clave de estado, con un período de inicio de 20 segundos. Un contenedor no saludable se marca, pero Docker no lo reinicia. El worker espera a una API saludable al inicio.
- Los contenedores disponen de 120 segundos para detenerse.
- El motor de contenedores debe iniciarse al arrancar. En Linux compruebe `systemctl is-enabled docker`. Arkvory no cambia el motor.
- Docker Desktop en Windows es una aplicación de un usuario. Ningún contenedor se ejecuta antes de que el usuario inicie sesión y Docker Desktop arranque. Active **Start Docker Desktop when you sign in**. El instalador y `arkvory status` avisan cuando está desactivado. Para un servidor que debe iniciarse sin un inicio de sesión, use los servicios nativos de Windows.

## Reinicio tras un bloqueo {#hang}

Un proceso puede dejar de funcionar sin terminar: un bucle infinito, una llamada de bloqueo o un bloqueo en código nativo. El gestor de servicios no lo ve, porque el proceso sigue existiendo. Por eso, cada uno de la API, el worker y el agente de copias de seguridad tiene un watchdog.

1. El hilo principal incrementa un contador una vez por segundo.
2. Un segundo hilo comprueba el contador una vez por segundo.
3. Cuando el contador no se ha movido durante `ARKVORY_WATCHDOG_SECONDS` comprobaciones seguidas (60 de forma predeterminada), el watchdog escribe el registro `process.stalled` con el campo `stalledSeconds` en el error estándar y termina el proceso.
4. El gestor de servicios reinicia el proceso como tras una caída.

El watchdog cuenta sus propios tics, no el tiempo del reloj. Cuando el host suspende o se pausa una máquina virtual, ambos hilos se detienen y no se inventa ningún bloqueo tras el despertar. Por eso, un bloqueo cuesta hasta 60 segundos más los 10 segundos del reinicio.

`ARKVORY_WATCHDOG_SECONDS` acepta de 10 a 3600. El valor `0` desactiva el watchdog. Úselo solo cuando un depurador pause el proceso, porque un proceso pausado más tiempo que el límite se reinicia. Una operación de bloqueo larga también cuenta como bloqueo. Si el propio watchdog no puede iniciarse, el servicio escribe `process.watchdog_failed` y sigue funcionando sin él. El PostgreSQL administrado no tiene watchdog. Su gestor de servicios lo reinicia tras una caída. Consulte [Variables de entorno](../reference/environment#watchdog).

## Sesión de base de datos o propiedad del almacenamiento perdidas {#ownership}

La API demuestra con una sesión de base de datos que es el único escritor del directorio de almacenamiento. La sesión se comprueba cada 2 segundos, y una comprobación que no responde en 8 segundos cuenta como perdida. El worker demuestra su rol de la misma manera. La propiedad nunca se restaura dentro de un proceso en ejecución, porque un segundo proceso podría haber tomado el relevo.

Cuando se pierde la propiedad, por ejemplo tras un reinicio de PostgreSQL, el proceso:

1. escribe `api.ownership_lost` o `worker.ownership_lost`,
2. deja de aceptar trabajo y cancela las transferencias,
3. sale con el código 1.

El gestor de servicios inicia un proceso nuevo, que comprueba todo otra vez desde el principio. Mientras la base de datos está caída, el proceso nuevo no puede iniciarse, y la API sale y se reinicia cada 10 segundos hasta que PostgreSQL responde. Esto es lo esperado. Mientras tanto, los clientes reciben 503 `unavailable` con `Retry-After`. Un agente de copias de seguridad en ejecución no sale cuando la base de datos no está disponible. Registra el error y vuelve a intentarlo después de su intervalo de sondeo (15 segundos de forma predeterminada).

## Qué ocurre con el trabajo en curso {#work}

Una caída rompe las conexiones abiertas. Los datos que se confirmaron permanecen. Lo que ocurre después depende del tipo de trabajo.

| Trabajo                                         | Tras un reinicio                                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Descarga                                        | El cliente reanuda con una solicitud de rango. El SDK y el cliente de línea de comandos lo hacen por sí solos                                                                            |
| Subida en varias partes                         | Las partes registradas permanecen en el servidor. El cliente pregunta qué partes existen y envía las que faltan. La sesión permanece abierta 7 días desde su creación                    |
| Subida de todo un archivo en una sola solicitud | El cliente envía el archivo de nuevo desde el primer byte                                                                                                                                |
| Finalización de la subida por el worker         | Consulte más abajo                                                                                                                                                                       |
| Copia de seguridad                              | Consulte más abajo                                                                                                                                                                       |
| Sincronización de espejo                        | El worker guarda su posición tras cada cambio aplicado y copia un archivo desde la primera parte que falta. Tras un fallo espera 2 segundos, duplicándose hasta 5 minutos entre intentos |
| Actualización                                   | El instalador conserva su bloqueo y su diario. No continúa por sí solo. Consulte [Solución de problemas](./troubleshooting#update-failed)                                                |

El SDK y el cliente de línea de comandos repiten los fallos de red y las respuestas 408, 429, 502, 503 y 504 un número limitado de veces. Otros clientes necesitan su propio reintento. Consulte [Transferencias](../use/transfers).

**Trabajos de finalización.** Una subida grande la termina el worker (el SDK y el cliente de línea de comandos lo hacen a partir de 16 GiB). El worker mantiene un arrendamiento de 30 segundos sobre un trabajo y lo renueva cada 2 segundos. Cuando el worker cae, el arrendamiento caduca en 30 segundos y el worker reiniciado retoma el trabajo. Un trabajo se ejecuta como máximo 5 veces. Tras un fallo espera 2 segundos, duplicándose hasta 60 segundos. Estos errores terminan un trabajo de inmediato: `forbidden`, `invalid_input`, `integrity_mismatch` y `not_found`. Un trabajo que agotó todos los intentos recibe el registro `completion.attempts_exhausted`. Volver a pedir la finalización de la misma subida vuelve a poner el trabajo en cola. La finalización comprueba los bytes almacenados, así que es seguro repetirla.

Un segundo worker sobre la misma base de datos espera como reserva (`worker.standby`) y comprueba cada 5 segundos si el primero ha desaparecido.

**Agente de copias de seguridad.** El agente mantiene un arrendamiento de 60 segundos (`ARKVORY_BACKUP_LEASE_SECONDS`) y lo renueva cada 20 segundos. Tras una caída, otro agente, o el reiniciado, toma el arrendamiento cuando caduca, así que una copia de seguridad espera hasta un minuto. El trabajo interrumpido se ejecuta de nuevo con la misma clave, hasta 5 veces. Una captura nueva libera los bloqueos de una muerta. La advertencia `agent_offline` aparece tras 2 minutos sin latido. Durante una actualización, el instalador detiene primero el agente, y la copia en curso termina como `interrupted` y se vuelve a poner en cola.

**Límites de velocidad.** Los contadores de inicio de sesión por dirección viven en el proceso y se restablecen al reiniciar. El retardo de una cuenta está en la base de datos y permanece.

## Comprobaciones al inicio {#startup-checks}

Cada proceso comprueba su entorno antes de atender. Una comprobación fallida termina el proceso con el código de salida 1 y una línea `startup.failed` (API) o `worker.unavailable` (worker). `reason` indica la causa sin secretos.

| Proceso                       | Qué se comprueba                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                           | Cada ajuste tiene un valor válido; el mensaje indica la variable, nunca su valor. El archivo de claves se lee como JSON hasta 1 MiB. HTTPS integrado: el certificado y la clave se leen, coinciden y no han caducado; no hay retroceso a HTTP. El directorio de almacenamiento es escribible. La base de datos responde y tiene todas las migraciones de esta versión y ninguna de una más reciente. El archivo `storage-id` del directorio de almacenamiento es igual a la identidad guardada en la base de datos. Ningún otro escritor tiene la base de datos |
| Worker                        | Los mismos ajustes, la base de datos, la identidad del almacenamiento y el bloqueo del único worker. Un segundo worker espera como reserva                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Agente de copias de seguridad | La identidad del almacenamiento, el número de esquema y que el almacén no se solape con el directorio de almacenamiento. Un almacén ausente o no montado no es fatal. El agente lo informa como una advertencia                                                                                                                                                                                                                                                                                                                                                 |

Tras una actualización, el instalador espera tres respuestas de preparación correctas seguidas y un worker en ejecución. Después espera unos 90 segundos al latido del agente de copias de seguridad. Un agente ausente solo es una advertencia y nunca revierte una actualización.

## Lo que todavía le necesita {#operator}

La autorrecuperación cubre fallos de un proceso. Estos necesitan un operador:

- **Un fallo permanente.** Un ajuste incorrecto, una base de datos inaccesible, un disco lleno o permisos incorrectos hacen que el servicio se reinicie cada 10 segundos sin éxito. Lea `startup.failed` y arregle la causa. Consulte [Solución de problemas](./troubleshooting).
- **Una actualización fallida.** Una actualización interrumpida conserva su bloqueo y su diario hasta que ejecute `recover`.
- **Copias de seguridad dañadas.** `verify_failed` y `vault_unavailable` necesitan a una persona. El agente mantiene el almacén sin cambios.
- **Certificados.** Arkvory lee los archivos de certificado renovados sin reiniciar (cada 300 segundos de forma predeterminada), pero sus herramientas deben renovarlos.
- **Un servicio detenido.** Un servicio que usted detuvo permanece detenido.
- **La plataforma.** Docker debe iniciarse al arrancar. Las versiones mayores de PostgreSQL, Node.js y el sistema operativo los actualiza usted.
- **Un servidor o disco perdidos.** No hay conmutación al espejo. Restaure desde una copia de seguridad. Consulte [Copias de seguridad](./backups).

## Páginas relacionadas {#related-pages}

- [Monitorización](./monitoring)
- [Solución de problemas](./troubleshooting)
- [Windows](../install/windows)
- [Variables de entorno](../reference/environment)
