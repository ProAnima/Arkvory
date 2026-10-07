---
title: Monitorización
description: 'Puntos de conexión de estado, métricas, registros, diagnósticos de la consola y una lista sugerida de alertas para un servidor Arkvory.'
---

# Monitorización

Arkvory le ofrece cuatro fuentes de datos: endpoints de estado que responden «¿está activo?», métricas de Prometheus, líneas de registro JSON y los diagnósticos de la consola. Esta página enumera qué contiene cada fuente y termina con un conjunto de alertas para empezar.

Las métricas, los endpoints de estado y los eventos de registro describen un único proceso de la API. El worker y el agente de copias de seguridad no tienen puerto HTTP. Los ve a través de las líneas de registro, de las métricas de la cola de finalización y del estado de las copias de seguridad.

## Comprobar un servidor ahora {#quick-check}

1. Consulte el endpoint de estado público. No necesita clave:

   ```bash
   curl -fsS http://127.0.0.1:8080/health/status
   ```

   `{"status":"ready"}` con HTTP 200 significa que la API alcanza su base de datos y su directorio de almacenamiento.

2. Solicite la respuesta completa de preparación con la clave de estado que creó el instalador:

   ```bash
   sudo sh -c 'curl -fsS -H "Authorization: Bearer $(cat /opt/proanima-arkvory/config/health-token.txt)" http://127.0.0.1:8080/health/ready'
   ```

   ```powershell
   $root = 'C:\ProgramData\ProAnima\Arkvory'
   $key = (Get-Content "$root\config\health-token.txt" -Raw).Trim()
   Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://127.0.0.1:8080/health/ready
   ```

3. Compruebe las copias de seguridad:

   ```bash
   arkvoryctl backup status
   ```

   El comando necesita la clave de recuperación o la sesión de un administrador. Sale con el código 9 cuando hay una advertencia crítica activa. Para comprobaciones desatendidas, use las alertas de Prometheus que se indican más abajo. Consulte [Línea de comandos](../protocols/cli).

4. Compruebe los servicios y las líneas de registro más recientes. Consulte [Registros](#logs).

`arkvory status --root <root>` muestra la versión instalada, el modo de instalación y la política de actualización. No sondea el servidor. `arkvoryctl doctor` muestra el servidor, el repositorio, las capacidades y los permisos de una clave. Es una comprobación del cliente, no del estado del servidor.

## Estado y preparación {#health}

Tres endpoints responden en el puerto de la API. Ninguno cuenta para el presupuesto de solicitudes `ARKVORY_MAX_REQUESTS`, así que una carga de transferencias no puede hacer que un servidor parezca caído. Los tres siguen respondiendo mientras el servidor drena antes de detenerse.

| Ruta             | Clave                  | Respuesta                                                                                                 | Úselo para                                                          |
| ---------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/health/live`   | No                     | 200 `{"status":"ok"}` mientras el proceso responda                                                        | Una comprobación del proceso                                        |
| `/health/status` | No                     | 200 `{"status":"ready"}`, o 503 `{"status":"unavailable"}` o `{"status":"draining"}` con `Retry-After: 2` | Balanceadores de carga y sondas de disponibilidad                   |
| `/health/ready`  | Cualquier clave válida | 200 con los detalles de abajo, o 503 con el sobre de error y `Retry-After`                                | Comprobaciones de despliegue y la comprobación de estado de Compose |

`/health/status` y `/health/ready` comprueban tres cosas: que la base de datos responde y tiene exactamente las migraciones de esta versión, que existe la carpeta `blobs` del directorio de almacenamiento y que el proceso sigue siendo el propietario de su bloqueo de almacenamiento. El resultado de `/health/status` se almacena en caché durante un segundo, así que las sondas públicas no multiplican las consultas a la base de datos. Un servidor que drena responde `draining` de inmediato.

Sin clave, `/health/ready` devuelve 401. La clave `deployment-health` que crea el instalador no tiene derechos de repositorio ni derechos de administrador. Su secreto está en `config/health-token.txt`.

Una respuesta 200 de `/health/ready` tiene estos campos:

| Campo             | Significado                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | Siempre `ready` en una respuesta 200                                                                                                                                                                                                                                                                                                      |
| `writable`        | `false` cuando el espacio libre del volumen de almacenamiento está por debajo de `ARKVORY_STORAGE_RESERVE_BYTES`, y en una puerta de enlace de lectura. Las lecturas siguen funcionando                                                                                                                                                   |
| `role`            | `api`, o `reader` para una puerta de enlace de lectura                                                                                                                                                                                                                                                                                    |
| `sharedDownloads` | El arrendamiento de una puerta de enlace de lectura (`slot`, `slots`, `active`, `leaseSeconds`), o `null`                                                                                                                                                                                                                                 |
| `transfers`       | Para `uploads` y `downloads`: `admission` (`active`, `waiting`, `capacity`, `perPrincipalCapacity`, `waitingCapacity`, `perPrincipalWaitingCapacity`, `timeoutMs`, `rejected`, `timedOut`, `cancelled`) y `bandwidth` (`bytesPerSecond`, `perPrincipalBytesPerSecond`, `burstBytes`, `perPrincipalBurstBytes`, `waiting`, `grantedBytes`) |

Una comprobación de preparación fallida por sí sola nunca reinicia un servicio. Consulte [Autorrecuperación](./self-healing).

## Métricas {#metrics}

`GET /health/metrics` devuelve las métricas del proceso de la API en el formato de texto de Prometheus (versión 0.0.4). Cualquier clave válida puede leerlas, y funciona mientras el servidor drena. Cree una clave de servicio con los mínimos derechos para el recolector y guárdela en un archivo que solo Prometheus lea.

```yaml
scrape_configs:
  - job_name: arkvory
    metrics_path: /health/metrics
    scheme: https
    authorization:
      credentials_file: /etc/prometheus/arkvory.key
    static_configs:
      - targets: ['arkvory.example:443']
```

El job debe llamarse `arkvory`: las reglas de alerta incluidas lo seleccionan por nombre.

Los valores pertenecen al proceso y empiezan en cero tras un reinicio. `arkvory_process_start_time_seconds` cambia cuando eso ocurre. Las etiquetas están acotadas: `route` es la plantilla de ruta, nunca la URL, y `status_class` es `2xx`, `5xx`, etc.

| Métrica                                                                                     | Etiquetas                                                  | Significado                                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `arkvory_http_requests_total`                                                               | `method`, `route`, `status_class`                          | Respuestas cerradas                                                                          |
| `arkvory_http_request_duration_seconds`                                                     | las mismas                                                 | Histograma de duración de 5 ms a 1800 s. Incluye las transferencias abortadas                |
| `arkvory_http_request_bytes_total`, `arkvory_http_response_bytes_total`                     | `method`, `route`                                          | Bytes del socket, incluidas las cabeceras                                                    |
| `arkvory_http_requests_in_flight`                                                           |                                                            | Solicitudes admitidas cuyas respuestas siguen abiertas                                       |
| `arkvory_transfer_active`, `arkvory_transfer_queue_depth`                                   | `direction`                                                | Transferencias admitidas y transferencias que esperan un hueco                               |
| `arkvory_transfer_admission_failures_total`                                                 | `direction`, `reason`                                      | Transferencias rechazadas por la admisión: `rejected` (cola llena), `timed_out`, `cancelled` |
| `arkvory_completion_jobs`                                                                   | `state` (`queued`, `running`)                              | Trabajos de finalización de subidas en la base de datos                                      |
| `arkvory_completion_oldest_queued_seconds`                                                  |                                                            | Espera del trabajo en cola ejecutable más antiguo                                            |
| `arkvory_diagnostic_records_total`                                                          | `outcome` (`written`, `dropped`, `truncated`, `oversized`) | Líneas de registro por resultado                                                             |
| `arkvory_metrics_collection_failures_total`                                                 | `collector` (`jobs`, `backup`, `mirror`)                   | Lecturas fallidas de métricas respaldadas por la base de datos                               |
| `arkvory_backup_last_success_timestamp_seconds`                                             |                                                            | Hora de la instantánea del punto de copia de seguridad completado más reciente               |
| `arkvory_backup_agent_last_seen_timestamp_seconds`                                          |                                                            | Último latido del agente de copias de seguridad                                              |
| `arkvory_backup_warnings`                                                                   | `code`                                                     | 1 mientras la advertencia está activa, 0 en caso contrario                                   |
| `arkvory_mirror_last_sync_timestamp_seconds`, `arkvory_mirror_last_check_timestamp_seconds` | `repository`, `mode`                                       | Última puesta al día con el origen y última lectura de su feed                               |
| `arkvory_mirror_failing`                                                                    | `repository`, `mode`                                       | 1 mientras falla el último intento de sincronización                                         |
| `arkvory_tls_certificate_expiry_timestamp_seconds`                                          |                                                            | Caducidad del certificado HTTPS integrado. Solo está presente con HTTPS integrado            |
| `arkvory_build_info`                                                                        | `service`, `version`                                       | Siempre 1                                                                                    |
| `arkvory_process_start_time_seconds`, `arkvory_process_resident_memory_bytes`               |                                                            | Hora de inicio y memoria residente                                                           |

Las métricas respaldadas por la base de datos (finalización, copia de seguridad, espejo) se leen como máximo cada 5 segundos. Cuando una lectura falla, el servidor omite estas métricas en lugar de mostrar valores antiguos, y `arkvory_metrics_collection_failures_total` crece.

El percentil 99 de las solicitudes de control, sin transferencias de archivos:

```text
histogram_quantile(0.99, sum by (le) (rate(arkvory_http_request_duration_seconds_bucket{route!~".*(content|parts).*"}[10m])))
```

Arkvory no exporta el espacio libre del volumen de almacenamiento ni de la base de datos. Use `node_exporter` para los volúmenes y `postgres_exporter` para PostgreSQL.

## Registros {#logs}

La API, el worker, el agente de copias de seguridad y las herramientas de mantenimiento escriben un objeto JSON por línea en la salida estándar. El servidor no escribe archivos de registro por sí mismo. El gestor de servicios de su plataforma recoge las líneas.

| Instalación                    | Dónde leer                                                                                                                                                                                                                                                                  | Rotación                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Linux (paquetes, `install.sh`) | `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. La base de datos administrada es `arkvory-database`, el actualizador es `arkvory-update`                                                                                                                   | La define journald                                   |
| Windows                        | `logs\arkvory-api.out.log`, `arkvory-worker.out.log`, `arkvory-backup.out.log` en la raíz de la instalación. La salida de error va a los archivos `.err.log` junto a ellos. El actualizador escribe `logs\updater.log`, el servicio de base de datos escribe en `database\` | 20 MiB por archivo, se conservan 5 archivos antiguos |
| Docker Compose                 | `docker logs --tail 100 proanima-arkvory-api-1`, y lo mismo para `-worker-1` y `-backup-1`                                                                                                                                                                                  | 20 MiB por archivo, 5 archivos por contenedor        |

Un bloqueo termina un proceso con el registro `process.stalled` en el error estándar, así que revise también el archivo `.err.log` o el journal. Consulte [Windows](../install/windows#logs) para los demás archivos de `logs\`.

Cada línea empieza con los mismos campos:

| Campo                        | Valor                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `timestamp`                  | Hora UTC en ISO 8601                                                                                        |
| `level`                      | `debug`, `info`, `warning` o `error`                                                                        |
| `service`                    | `api`, `worker`, `backup`, `migrate`, `gc` o `scrub`                                                        |
| `version`, `pid`, `hostname` | Versión, proceso y host                                                                                     |
| `component`                  | `api`, `http`, `storage`, `worker`, `maintenance`, `backup`, `mirror`, `migrate`, `process` o `diagnostics` |
| `code`                       | El nombre del evento                                                                                        |

Otros campos proceden de una lista fija: identificadores (`requestId`, `traceId`, `jobId`, `uploadId`, `artifactId`, `repository`, `principal`, `clientIp`), números (`status`, `durationMs`, `bytesSent`, `bytesReceived`, `attempts`) y campos de motivo (`errorCode`, `errorName`, `errno`, `sqlstate`, `reason`). `ARKVORY_LOG_LEVEL` establece el nivel más bajo que se escribe.

### Eventos importantes {#log-events}

| Evento (`code`)                                                                                       | Nivel                            | Significado y primera acción                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.listening`                                                                                       | info                             | La API atiende solicitudes. Campos `address`, `port` y `tls`                                                                                 |
| `startup.failed`                                                                                      | error                            | La API no se inició. `reason` indica la causa. Consulte [Solución de problemas](./troubleshooting#server-does-not-start)                     |
| `worker.unavailable`                                                                                  | error                            | El worker no se inició o se detuvo con un error                                                                                              |
| `http.plaintext_exposed`                                                                              | warning                          | La API escucha en una dirección no local sin TLS y sin un proxy de confianza                                                                 |
| `http.access`                                                                                         | info                             | Una línea por cada solicitud finalizada o abortada                                                                                           |
| el código de error de una solicitud, por ejemplo `unavailable` o `internal`                           | warning para 4xx, error para 5xx | Una solicitud fallida con `requestId`, `route`, `status` y, para errores del sistema, `errorName`, `errno` o `sqlstate`                      |
| `upload.input_timeout`, `upload.deadline`                                                             | warning                          | Una subida dejó de enviar datos, o tardó más de `ARKVORY_UPLOAD_DEADLINE_MS`                                                                 |
| `api.ownership_lost`, `worker.ownership_lost`                                                         | error                            | La sesión de base de datos que demuestra la propiedad del almacenamiento se rompió. El proceso sale y se reinicia                            |
| `process.stalled`                                                                                     | error                            | El watchdog terminó un proceso bloqueado. Campo `stalledSeconds`                                                                             |
| `process.unhandled`                                                                                   | error                            | Un error inesperado terminó el proceso                                                                                                       |
| `process.watchdog_failed`                                                                             | warning                          | El watchdog no pudo iniciarse. El servicio se ejecuta sin él                                                                                 |
| `drain.started`, `drain.settled`, `drain.timeout`, `api.stopped`                                      | info o warning                   | Una parada ordenada. `drain.timeout` significa que se cortaron solicitudes                                                                   |
| `tls.reloaded`, `tls.reload_failed`, `tls.expiring`                                                   | info o warning                   | Los archivos de certificado se volvieron a leer, no se pudieron leer, o caducan en menos de 14 días. `tls.expiring` se repite una vez al día |
| `completion.completed`, `completion.failed`, `completion.lease_lost`, `completion.attempts_exhausted` | info o error                     | El resultado de un trabajo de finalización de subida, con `jobId`, `uploadId` y `errorCode`                                                  |
| `backup.agent.started`, `backup.agent.standby`, `backup.agent.lease_lost`                             | info o warning                   | Estado del agente de copias de seguridad                                                                                                     |
| `backup.request.failed`, `backup.request.requeued`, `backup.failed`                                   | error o warning                  | Un trabajo de copia de seguridad falló o se ejecuta de nuevo. Campo `errorCode`                                                              |
| `mirror.step_failed`, `mirror.recovered`                                                              | warning o info                   | Un paso de sincronización de espejo falló (`errorCode`, `attempts`), o vuelve a funcionar                                                    |
| `migrate.started`, `migrate.completed`, `migrate.failed`                                              | info o error                     | La migración de base de datos de una actualización                                                                                           |
| `diagnostics.dropped`, `diagnostics.oversized`                                                        | warning                          | Se descartaron líneas porque el lector de registro es demasiado lento, o una línea era demasiado larga                                       |

Un lector de registro lento nunca frena una transferencia. Cuando la salida está bloqueada, el servidor descarta líneas, las cuenta y escribe `diagnostics.dropped` con el número cuando la salida vuelve a estar libre. Una línea de más de 4096 caracteres se sustituye por `diagnostics.oversized`. Los campos de texto se cortan a 256 caracteres.

### ID de solicitud {#request-ids}

Cada respuesta lleva la cabecera `X-Request-Id`, y cada cuerpo de error tiene el campo `requestId`. El mismo valor está en la línea `http.access`, en la línea de error, en las líneas del trabajo de finalización que inició la solicitud y en los registros de auditoría. Un cliente que informe de un problema solo necesita darle este valor.

```bash
journalctl -u arkvory-api -u arkvory-worker --since "1 hour ago" -o cat | grep 'REQUEST_ID'
```

```powershell
Select-String -Path "$root\logs\*.log" -Pattern 'REQUEST_ID'
```

Detrás de un proxy inverso, el servidor toma un `X-Request-Id` entrante solo de una dirección en `ARKVORY_TRUSTED_PROXIES`, y solo si es un único valor de 8 a 128 caracteres (letras, dígitos, `.`, `_`, `:` y `-`). Deje que el proxy sobrescriba la cabecera, por ejemplo con `proxy_set_header X-Request-Id $request_id;` en nginx. Una cabecera `traceparent` de W3C válida de cualquier cliente se convierte en el campo `traceId`. Solo sirve para buscar y nunca concede nada.

### Lo que nunca se registra {#never-logged}

El registro no contiene contraseñas, claves, tokens, cabeceras `Authorization`, cuerpos de solicitud, cadenas de consulta, URL ni textos de excepciones. Los enlaces de descarga llevan un secreto en la cadena de consulta, así que solo se registra la plantilla de ruta. El campo `reason` es el único texto libre. Se censura y se corta a 240 caracteres. La línea muestra el `principal` (el ID de una cuenta o clave) y la `clientIp`. Trate el registro como datos personales.

`ARKVORY_ACCESS_LOG=false` desactiva `http.access`. Las solicitudes correctas a `/health/live` y `/health/status` nunca se registran. Los niveles `warning` y `error` también ocultan las líneas de acceso.

## Diagnósticos en la consola {#console}

Los administradores ven el estado del servidor en la consola sin un shell. Consulte [La consola web](../guide/console).

| Dónde                                         | Qué ve                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:backups]]                                | El encabezado indica [[ui:backupStateOk]], [[ui:backupStateWarning]] y [[ui:backupStateCritical]]. Debajo están la copia [[ui:backupNewest]], [[ui:backupNextRun]], [[ui:backupAgent]], [[ui:backupVault]] y la lista de advertencias con la acción para cada una |
| [[ui:updates]]                                | La versión instalada y la más reciente, la hora de la última comprobación y el estado del actualizador del host                                                                                                                                                   |
| [[ui:repositoryStorage]] de un repositorio    | El uso de la cuota con los estados [[ui:storageWarning]] y [[ui:storageCritical]], y la lista [[ui:storageEvents]]                                                                                                                                                |
| [[ui:serviceAudit]] de una cuenta de servicio | Quién creó, cambió, emitió o revocó qué                                                                                                                                                                                                                           |
| La tarjeta del repositorio                    | La insignia [[ui:mirrorBadge]], con el estado [[ui:mirrorFailing]] cuando falló la última sincronización                                                                                                                                                          |

La lista [[ui:storageEvents]] necesita el permiso para leer diagnósticos. Entre otros eventos, contiene las solicitudes fallidas de las claves de servicio en ese repositorio, con el ID de solicitud, la ruta y el estado.

Los umbrales de cuota son 80 % para la advertencia y 95 % para el estado crítico, salvo que un administrador los cambie. Un repositorio sin cuota no tiene umbrales.

## Advertencias de almacenamiento y disco {#storage}

El servidor mantiene `ARKVORY_STORAGE_RESERVE_BYTES` (1 GiB de forma predeterminada) de espacio libre en el volumen de almacenamiento para la base de datos, los registros y el sistema. Por debajo de esta reserva:

- `/health/ready` informa `"writable": false`, pero sigue respondiendo 200.
- Las subidas fallan con 507 y el motivo `storage_full`. Las descargas y la consola siguen funcionando.

El servidor no mide el espacio libre por usted. Vigile el volumen de almacenamiento, el de la base de datos y el de copias de seguridad con sus propias herramientas, y alerte antes de llegar a la reserva. La reserva no es una cuota. `ARKVORY_CAPACITY_BYTES` limita la suma del contenido reservado y no es una comprobación del disco. Consulte [Almacenamiento](./storage).

## Estado de las copias de seguridad {#backup-health}

El agente de copias de seguridad envía un latido con cada renovación del arrendamiento. La API convierte el latido y el historial de trabajos de copia de seguridad en advertencias con códigos fijos. Consulte [Copias de seguridad](./backups) para saber qué le pide cada código.

| Código                                                                          | Gravedad    | Condición                                                                                     |
| ------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `agent_offline`                                                                 | crítica     | Sin latido durante 2 minutos                                                                  |
| `backup_stale`                                                                  | crítica     | El punto más reciente es más antiguo que 26 horas y el plan está activado                     |
| `vault_unavailable`                                                             | crítica     | El volumen del almacén no está montado, no tiene `vault.json` o no se puede escribir          |
| `verify_failed`                                                                 | crítica     | Un punto de restauración falló su verificación                                                |
| `vault_not_configured`, `schedule_disabled`, `no_backup_yet`, `last_run_failed` | advertencia | Sin almacén, plan desactivado, sin primera copia, la última copia falló                       |
| `vault_low_space`                                                               | advertencia | El almacén tiene menos del 10 % libre, o menos del doble de los bytes nuevos del último punto |
| `never_deep_verified`                                                           | advertencia | Ninguna verificación completa durante más de 8 días                                           |

La métrica `arkvory_backup_warnings` lleva los mismos códigos. La antigüedad de una copia cuenta desde su hora de instantánea, no desde el momento en que terminó.

## Alertas sugeridas {#alerts}

La versión contiene reglas de Prometheus listas en `releases/<version>/deploy/monitoring/arkvory-alerts.yml`. Añada el archivo a `rule_files` en `prometheus.yml`. Los umbrales son puntos de partida. Ajuste con el tráfico que mida.

| Alerta                                                          | Condición                                                                       | Gravedad             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------- |
| `ArkvoryDown`                                                   | La recogida falla durante 2 minutos                                             | Crítica              |
| `ArkvoryHighServerErrorRate`                                    | Más del 5 % de las respuestas son 5xx durante 10 minutos                        | Advertencia          |
| `ArkvorySlowMetadataRequests`                                   | El percentil 99 de las solicitudes de control supera los 2 s durante 15 minutos | Advertencia          |
| `ArkvoryCompletionBacklog`                                      | El trabajo de finalización en cola más antiguo espera más de 10 minutos         | Advertencia          |
| `ArkvoryTransferAdmissionRejections`                            | Más de 0.1 transferencias rechazadas o agotadas por segundo durante 15 minutos  | Advertencia          |
| `ArkvoryDiagnosticsDropped`                                     | Se descartaron líneas de registro en los últimos 15 minutos                     | Advertencia          |
| `ArkvoryMetricsCollectionFailing`                               | No se pudo leer una métrica respaldada por la base de datos                     | Advertencia          |
| `ArkvoryTlsCertificateExpiring`, `ArkvoryTlsCertificateExpired` | El certificado integrado caduca en menos de 14 días, o ha caducado              | Advertencia, crítica |
| `ArkvoryBackupStale`                                            | El punto más reciente es más antiguo que 26 horas                               | Crítica              |
| `ArkvoryBackupAgentOffline`                                     | Sin latido durante más de 2 minutos, durante 5 minutos                          | Crítica              |
| `ArkvoryBackupWarning`                                          | `vault_unavailable` o `verify_failed` durante 10 minutos                        | Crítica              |
| `ArkvoryMirrorStale`                                            | Un espejo no se ha puesto al día con su origen durante una hora                 | Advertencia          |
| `ArkvoryMirrorFailing`                                          | La última sincronización de un espejo falló, durante 15 minutos                 | Advertencia          |
| `ArkvoryRestartLoop`                                            | El proceso de la API se reinició 3 o más veces en 30 minutos                    | Advertencia          |

Añada estas alertas usted mismo, porque Arkvory no exporta los datos:

| Alerta                                                                                | Origen                                | Por qué                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Espacio libre de los volúmenes de almacenamiento, base de datos y copias de seguridad | `node_exporter`                       | Un disco lleno detiene las subidas, la base de datos y las copias de seguridad |
| PostgreSQL está caído o tiene demasiadas conexiones                                   | `postgres_exporter`                   | La API sale y se reinicia mientras la base de datos no está disponible         |
| El estado público no es `ready`                                                       | Una sonda externa de `/health/status` | La ruta de red, el proxy y el certificado, vistos desde un cliente             |

Para los volúmenes y para PostgreSQL, la versión incluye reglas listas para `node_exporter` y `postgres_exporter` en `deploy/monitoring/arkvory-host-alerts.yml`. Sustituya las expresiones `mountpoint` por sus propios volúmenes antes de cargar el archivo.

Pruebe una alerta una vez. Por ejemplo, detenga `arkvory-backup`: `ArkvoryBackupAgentOffline` se dispara unos 7 u 8 minutos después (2 minutos sin latido, 5 minutos en la regla, más el intervalo de recogida).

## Páginas relacionadas {#related-pages}

- [Autorrecuperación](./self-healing)
- [Solución de problemas](./troubleshooting)
- [Copias de seguridad](./backups)
- [Variables de entorno](../reference/environment)
- [Errores](../api/errors)
