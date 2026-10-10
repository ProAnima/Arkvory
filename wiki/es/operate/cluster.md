---
title: Clúster de alta disponibilidad
description: Ejecute Arkvory en dos o tres servidores Linux de un mismo sitio con una copia síncrona de todos los datos, conmutación automática por error y fencing obligatorio.
---

# Clúster de alta disponibilidad

Un clúster de Arkvory sigue funcionando cuando falla un servidor del sitio. Dos o tres servidores Linux contienen la misma copia de un volumen de bloques. Un servidor está **activo** y ejecuta Arkvory. Cuando falla, el gestor del clúster lo aísla (fencing) y arranca Arkvory en otro servidor con los mismos datos.

El clúster protege frente a la pérdida de un servidor, un disco o un enlace de red dentro de un sitio. No protege frente a la pérdida de todo el sitio. Para eso, mantenga [espejos](./mirrors) en otro sitio y [copias de seguridad](./backups) fuera del clúster.

## Cómo funciona {#how-it-works}

- **Un volumen, copias síncronas.** DRBD 9 copia cada escritura del volumen en los demás servidores antes de que la escritura termine (protocolo C). Toda la instalación vive en el volumen: la base de datos, el almacenamiento, la configuración y las versiones. El catálogo y los bytes de los archivos nunca divergen.
- **Pacemaker decide dónde se ejecuta Arkvory.** Corosync y Pacemaker mantienen el quórum, eligen el servidor activo y arrancan, en orden: el volumen, el sistema de archivos, la base de datos, `arkvory-replica`, la API, el worker, el agente de copias de seguridad, el temporizador de actualizaciones y una dirección IP virtual. Arkvory no tiene una elección propia.
- **El fencing es obligatorio.** Antes de que otro servidor tome el relevo, Pacemaker apaga el servidor averiado mediante un dispositivo de energía (IPMI, iDRAC, iLO, Redfish, una PDU) o un hipervisor. Sin fencing, dos servidores podrían escribir a la vez. Un clúster sin fencing no arranca.
- **Dos copias para cada escritura confirmada.** Arkvory responde con éxito a una escritura solo cuando esta está en al menos dos copias completas (consulte [Escrituras y copias](#writes)). Cuando falta una copia, las escrituras se detienen y las lecturas continúan.

| Perfil | Servidores de datos | Testigo                                                                                     | Cuando falla un servidor de datos                                            |
| ------ | ------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ha-2` | 2                   | obligatorio: un servidor pequeño sin datos que ejecuta `corosync-qnetd` y un desempate DRBD | Las escrituras se detienen hasta que el servidor vuelve o un operador decide |
| `ha-3` | 3                   | no se usa: los tres servidores deciden por mayoría                                          | Las escrituras continúan: quedan dos copias                                  |

`ha-3` es el perfil recomendado. `ha-2` cuesta menos y detiene las escrituras con honestidad en lugar de mantener los datos en una sola copia.

El clúster es para los paquetes nativos de Linux. Las instalaciones de Windows y Docker Compose siguen siendo servidores independientes con espejos y copias de seguridad.

## Escrituras y copias {#writes}

Una **copia completa** es el disco local del servidor activo cuando está actualizado, más cada otro servidor de datos que esté conectado, replicando y actualizado. Un servidor que se está resincronizando no cuenta hasta que esté actualizado. El testigo no tiene datos y nunca cuenta.

Cada solicitud que modifica datos (la API HTTP, el registro de contenedores, Git LFS, npm) se comprueba dos veces:

- **antes** de ejecutarse, con las copias del último segundo;
- **después** de que los datos se confirmen y sincronicen, con una lectura nueva del volumen.

Cuando existen menos copias completas de las que necesita la escritura, el cliente recibe HTTP 503 con el código `unavailable`, el motivo `replication_degraded` y una cabecera `Retry-After`, nunca un 2xx. El estado de una tarea de finalización de subida (`GET /api/v1/jobs/{id}`) se comprueba del mismo modo, porque indica al cliente que una subida grande está publicada.

Un 503 después de la confirmación significa que la operación puede existir en una sola copia. Repita la solicitud con la misma `Idempotency-Key`: la repetición devuelve el resultado existente y su 2xx lo confirma cuando vuelven a existir dos copias.

Las lecturas, las descargas, la consola, el inicio y el cierre de sesión, los comentarios y la solicitud batch de Git LFS funcionan mientras las escrituras están detenidas.

Un administrador que haya iniciado sesión en la consola ve un aviso mientras las escrituras están detenidas o mientras hay una decisión de copia única activa.

## Requisitos {#requirements}

- Dos o tres servidores de datos con la misma distribución Linux, la misma versión del paquete de Arkvory y un disco (o volumen lógico) del tamaño completo para el volumen en cada uno. Planifique todo el almacenamiento más la base de datos.
- Para `ha-2`, un tercer servidor pequeño como testigo. No necesita disco para datos y no ejecuta Arkvory.
- Una red entre los servidores con baja latencia. Cada escritura espera a los demás servidores, por lo que la latencia se suma a cada escritura. Use un enlace dedicado cuando pueda.
- DRBD 9 (el módulo del kernel y `drbd-utils` 9; muchas distribuciones incluyen el módulo antiguo 8.4, así que use los paquetes de LINBIT), `pacemaker`, `pcs`, `corosync`, `resource-agents` (en Ubuntu, `resource-agents-base` y `resource-agents-extra`), los agentes de fencing para su hardware. Para `ha-2`: `corosync-qdevice` en los servidores de datos y `corosync-qnetd` en el testigo.
- Un dispositivo de fencing para cada servidor de datos y sus credenciales.
- Una dirección IP libre en la red de los servidores. Los clientes se conectan a esta dirección virtual.
- Un certificado TLS para la dirección virtual. Guarde el certificado y la clave en el volumen, para que cada servidor los encuentre en la misma ruta.

## Crear un clúster {#build}

Los comandos siguientes usan el nombre de recurso predeterminado `arkvory`, el directorio de instalación `/opt/proanima-arkvory` y `/dev/vg0/arkvory` como disco de respaldo. Ejecútelos como root.

1. En cada servidor de datos, desempaquete el paquete de Arkvory sin instalarlo. Esto añade los archivos y el comando `arkvory` y no crea nada en `/opt/proanima-arkvory`:

   ```bash
   dpkg --unpack Arkvory-amd64.deb
   ```

2. En un servidor de datos, genere el plan. Escribe el recurso DRBD y los comandos de Pacemaker en un directorio para que los revise:

   ```bash
   arkvory cluster-plan --cluster ha-2 \
     --nodes node-a=10.0.0.11,node-b=10.0.0.12 --witness witness=10.0.0.13 \
     --disk /dev/vg0/arkvory --fence-agent fence_ipmilan \
     --virtual-ip 10.0.0.100/24 --output /root/arkvory-plan
   ```

   Para `ha-3`, indique tres servidores en `--nodes` y omita `--witness`. Opcional: `--cluster-resource`, `--drbd-minor` (por defecto 0), `--drbd-port` (por defecto 7789), `--filesystem` (`xfs` o `ext4`, por defecto `xfs`). Los nombres deben ser los nombres de host de los servidores.

3. Copie `arkvory.res` en `/etc/drbd.d/` de cada servidor, incluido el testigo. Cree los metadatos en los servidores de datos y levante el recurso en todos:

   ```bash
   drbdadm create-md arkvory   # data servers only
   drbdadm up arkvory          # every server
   ```

   En el testigo, ejecute también `systemctl enable drbd@arkvory.service` para que el desempate vuelva tras un reinicio.

   El plan permite que una copia que regresa se resincronice como mínimo a 20 MB/s, incluso con carga de escritura, y como máximo a 1 GB/s. Ajuste `c-min-rate` y `c-max-rate` en la sección `disk` a lo que soporte su enlace de replicación.

4. En el primer servidor de datos, conviértalo en primario, cree el sistema de archivos y móntelo. Con discos nuevos y vacíos, omita antes la sincronización inicial:

   ```bash
   drbdadm new-current-uuid --clear-bitmap arkvory/0
   drbdadm primary arkvory
   mkfs.xfs /dev/drbd0
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   ```

5. Instale Arkvory en el volumen montado, coloque los archivos TLS en el volumen y active el modo clúster:

   ```bash
   dpkg --configure proanima-arkvory
   install -d -m 0750 -o root -g arkvory /opt/proanima-arkvory/config/tls
   install -m 0644 tls.crt /opt/proanima-arkvory/config/tls/tls.crt
   install -m 0640 -g arkvory tls.key /opt/proanima-arkvory/config/tls/tls.key
   arkvory configure --root /opt/proanima-arkvory --tls-cert /opt/proanima-arkvory/config/tls/tls.crt --tls-key /opt/proanima-arkvory/config/tls/tls.key --listen-host 0.0.0.0
   arkvory configure --root /opt/proanima-arkvory --cluster ha-2
   ```

   `configure --cluster` comprueba que el directorio de instalación sea el dispositivo DRBD montado, que este servidor sea primario y que cada copia esté completa. Inicia `arkvory-replica`, hace que Arkvory confirme escrituras solo con dos copias completas y desactiva el arranque automático de los servicios de Arkvory: a partir de ahora los inicia Pacemaker. Si un paso falla, se restaura la configuración independiente.

6. Detenga Arkvory en el primer servidor y libere el volumen:

   ```bash
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

7. En cada uno de los demás servidores de datos, por turno, tome el volumen, prepare el servidor y libere de nuevo el volumen:

   ```bash
   drbdadm primary arkvory
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   arkvory cluster-node --root /opt/proanima-arkvory --cluster-resource arkvory
   dpkg --configure proanima-arkvory
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

   `cluster-node` crea las cuentas de servicio con los mismos ID de usuario y de grupo que en el primer servidor (los archivos del volumen les pertenecen) e instala los mismos servicios, ninguno de ellos con arranque automático. Si ya existe una cuenta con otros ID, el comando se detiene e indica qué ID debe establecer.

8. Configure el clúster Corosync con `pcs` en los servidores de datos (`pcs host auth`, `pcs cluster setup`, `pcs cluster start --all`). En Debian y Ubuntu, ejecute antes `pcs cluster destroy` en cada servidor de datos: los paquetes instalan una configuración de ejemplo de Corosync que `pcs` toma por un clúster existente. No ejecute `pcs cluster enable`: un servidor que fue aislado debe volver a unirse solo cuando usted lo inicie. Para `ha-2`, autentique también el testigo y ejecute en él `pcs qdevice setup model net --enable --start`. En Debian y Ubuntu el paquete ya ha configurado el dispositivo de quórum para su propia cuenta de servicio: ejecute allí en su lugar `systemctl enable --now corosync-qnetd`.

9. Abra `/root/arkvory-plan/pacemaker.sh`. Sustituya cada `<agent parameters: …>` por los parámetros de su dispositivo de fencing: su dirección, el inicio de sesión, el archivo de contraseña o la clave, y el enchufe o puerto de ese servidor. Después ejecute el script en un servidor de datos:

   ```bash
   sh /root/arkvory-plan/pacemaker.sh
   ```

   El script construye toda la configuración en un archivo y la aplica de una sola vez: fencing, política de quórum, el recurso DRBD, el grupo de Arkvory y sus restricciones.

10. Compruebe el clúster en el servidor activo:

    ```bash
    arkvory cluster-check --root /opt/proanima-arkvory
    ```

    El comando comprueba el quórum, que el fencing esté habilitado, que cada servidor tenga un dispositivo de fencing, la configuración de quórum y fencing de DRBD, que cada copia esté completa y que Arkvory se ejecute en exactamente un servidor. Termina con un error cuando falla una comprobación.

11. Demuestre el fencing una vez: aísle cada servidor en espera y déjelo volver (consulte [Prueba de fencing](#fence-test)).

Apunte sus clientes y el nombre DNS a la dirección virtual.

## Operación diaria {#operation}

Ejecute estos comandos como root. `cluster-status` y `cluster-single-copy` leen el volumen, así que ejecútelos en el servidor activo; los demás funcionan en cualquier servidor de datos.

| Comando                                                                   | Qué hace                                                                                                 |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `arkvory cluster-status --root <dir>`                                     | Perfil, rol de este servidor, copias completas y requeridas y cualquier decisión del operador, como JSON |
| `arkvory cluster-check --root <dir>`                                      | Todas las comprobaciones de un clúster sano; termina con un error cuando una falla                       |
| `arkvory cluster-switchover --root <dir> --to <server>`                   | Traslado planificado de Arkvory a otro servidor de datos; se rechaza si alguna copia no está completa    |
| `arkvory cluster-fence-test --root <dir> --node <standby>`                | Aísla un servidor en espera para demostrar su dispositivo de fencing; el servidor activo se rechaza      |
| `arkvory cluster-single-copy --root <dir> --until <time> --reason <text>` | Acepta escrituras con una sola copia hasta una hora; consulte [Copia única](#single-copy)                |

`pcs status` muestra el clúster tal como lo ve Pacemaker.

### Conmutación planificada {#switchover}

`cluster-switchover` pide a Pacemaker que mueva el grupo, espera hasta 5 minutos a que Arkvory se ejecute en el destino y después elimina la regla de ubicación temporal. Las conexiones con el servidor anterior se interrumpen durante el traslado; los clientes repiten sus solicitudes. Arkvory nunca vuelve por sí solo.

### Prueba de fencing {#fence-test}

`cluster-fence-test` reinicia un servidor en espera mediante su dispositivo de fencing. Tras el reinicio, inicie el clúster en ese servidor con `pcs cluster start`. Los servicios del clúster no se inician solos tras un reinicio (paso 8 de [Crear un clúster](#build)), por lo que un servidor aislado nunca se vuelve a unir sin usted.

### Actualizaciones {#updates}

Instale un paquete nuevo en cada servidor de datos. En los servidores en espera, el paquete solo reemplaza los archivos del programa, porque la versión vive en el volumen. En el servidor activo, el paquete aplica la versión: Arkvory indica a Pacemaker que deje el grupo en paz, detiene los servicios, migra, los inicia, espera a que estén listos y devuelve el grupo. Las actualizaciones automáticas funcionan del mismo modo en el servidor activo.

No inicie ni detenga los servicios de Arkvory con `systemctl` en un servidor del clúster. Pacemaker lo tomaría como un fallo. Use `pcs resource disable arkvory` y `pcs resource enable arkvory` para una parada planificada de todo el servicio.

## Fallos {#failures}

| Qué ocurre                                                            | `ha-2`                                                                                                                      | `ha-3`                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Falla un servidor en espera                                           | Aislado. Las lecturas continúan, las escrituras reciben 503 `replication_degraded`                                          | Aislado. Las lecturas y las escrituras continúan                             |
| Falla el servidor activo                                              | Aislado, Arkvory arranca en el otro servidor. Las lecturas vuelven, las escrituras esperan la segunda copia                 | Aislado, Arkvory arranca en otro servidor. Vuelven las lecturas y escrituras |
| División de red entre servidores de datos                             | El testigo da el quórum a un lado; el otro lado es aislado. Nunca dos escritores                                            | Continúa el lado mayoritario; el otro servidor es aislado                    |
| Fallan dos de tres miembros (ha-2: un servidor de datos y el testigo) | El último servidor no tiene quórum: Arkvory se detiene. Nunca un escritor sin quórum. Recupere los servidores (véase abajo) | Lo mismo para dos servidores de datos                                        |
| El fencing no funciona                                                | No hay conmutación. Arkvory permanece detenido hasta que el fencing tenga éxito                                             | Lo mismo                                                                     |

Para recuperar un servidor aislado:

1. Repare la causa e inicie el servidor.
2. Ejecute `pcs cluster start` en él.
3. El volumen resincroniza los bloques modificados. Las escrituras se reanudan solas cuando vuelven a estar completas todas las copias necesarias; `arkvory cluster-status` muestra el progreso.

Tras una pérdida de quórum, inicie el clúster en cada servidor que haya vuelto. Pacemaker ejecuta Arkvory de nuevo en el servidor con la copia más reciente. El servidor que perdió el quórum en último lugar puede ser aislado una vez más al volver, porque no pudo detenerse limpiamente: inicie el clúster en él de nuevo tras su reinicio.

Cuando el fencing falló y usted lo reparó, limpie los intentos fallidos en un servidor en marcha para que Pacemaker lo intente de nuevo: `pcs stonith history cleanup <server>` y `pcs resource cleanup`.

### Copia única {#single-copy}

Cuando un servidor de datos permanece ausente mucho tiempo (por ejemplo, por la sustitución de un disco) y las escrituras detenidas cuestan más que el riesgo, un operador puede aceptar escrituras con una copia durante un tiempo limitado:

```bash
arkvory cluster-single-copy --root /opt/proanima-arkvory --until 2026-10-12T18:00:00Z --reason "disk replacement on node-b"
```

- La hora debe estar dentro de los próximos 7 días. El comando solo funciona mientras faltan copias.
- Mientras la decisión está activa, la pérdida del servidor activo pierde las escrituras confirmadas después de ella.
- El aviso de la consola, la métrica `arkvory_replication_required_copies` y la alerta `ArkvorySingleCopyWrites` muestran la decisión.
- Termina a su hora, con `--off`, o por sí sola en cuanto todas las copias vuelven a estar completas. Una pérdida posterior detiene las escrituras de nuevo.

## Monitorización {#monitoring}

`GET /health/ready` sigue siendo 200 en el servidor activo mientras las escrituras están detenidas, de modo que un monitor no mueve un servidor sano. Su campo `writable` es `false` y el campo `replication` muestra `copies`, `required` y `singleCopyUntil`; `replication` es `null` cuando no se pueden leer las copias. Los servidores independientes no tienen el campo `replication`.

| Métrica                                    | Significado                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `arkvory_replication_copies`               | Copias completas en la última comprobación                                    |
| `arkvory_replication_required_copies`      | Copias que necesita una escritura: 2, o 1 durante una decisión de copia única |
| `arkvory_replication_writes_refused_total` | Escrituras respondidas con 503 `replication_degraded`                         |
| `arkvory_replication_check_failures_total` | Lecturas fallidas del estado de las copias                                    |

Las reglas de alerta de `deploy/monitoring/arkvory-alerts.yml` incluyen `ArkvoryReplicationDegraded`, `ArkvorySingleCopyWrites` y `ArkvoryReplicationCheckFailing`. Vigile también el propio clúster: ejecute `arkvory cluster-check` de forma periódica y alerte según su código de salida, o use la monitorización de su instalación de Pacemaker. Consulte [Monitorización](./monitoring).

## Copias de seguridad {#backups}

El agente de copias de seguridad se ejecuta solo en el servidor activo, como parte del grupo. Mantenga el almacén de copias fuera del volumen del clúster, por ejemplo en un NAS. Consulte [Copias de seguridad](./backups).
