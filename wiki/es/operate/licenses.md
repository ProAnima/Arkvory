---
title: Licencias
description: Active la licencia de un módulo de pago en línea o sin conexión, compruebe su estado y vea qué envía y guarda Arkvory.
---

# Licencias

El núcleo gratuito de Arkvory funciona sin licencia de módulos de pago. Una licencia habilita funciones de pago de ProAnimaStudio, incluido [Arkvory Pro](modules#pro). Su caducidad no impide leer los datos Pro existentes; si las funciones de pago no están disponibles, las nuevas cargas usan el almacenamiento del núcleo y las transferencias normales. Hasta que active una licencia, Arkvory no envía nada sobre licencias a ninguna parte.

Los comandos de esta página se ejecutan en el host de la instalación, como root en Linux o como administrador en Windows. Las instalaciones con Docker Compose no cargan módulos, así que rechazan estos comandos.

## Activar en línea {#activate}

1. Guarde la clave de licencia del sitio de ProAnimaStudio en un archivo que solo usted pueda leer, por ejemplo `/root/arkvory.key`.
2. Active:

   ```bash
   sudo arkvory license activate --key-file /root/arkvory.key --root /opt/proanima-arkvory
   ```

3. Borre el archivo local de la clave después de activar. Conserve el acceso a la clave en su cuenta: puede necesitarla para recuperar la activación.

Arkvory envía la solicitud al hub de la instalación (la dirección de `config/hub.json`, la misma que para las actualizaciones) por HTTPS con verificación del certificado. Acepta la respuesta solo si la firmó la clave de licencias de ProAnimaStudio, para esta instalación y para esta solicitud. Una clave con una errata se rechaza antes de enviar nada. Activar de nuevo la misma instalación con la misma clave no ocupa una plaza nueva de la licencia.

### Qué se envía {#sent}

| Solicitud  | Contenido                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activación | La clave de licencia, el id de instalación, un valor aleatorio, la versión de Arkvory, el id y la versión de los módulos de pago instalados, la hora |
| Renovación | El id de activación y su secreto, un valor aleatorio, el número de secuencia, las versiones                                                          |

Nunca se envían el nombre del titular de la licencia, nombres de personas, direcciones, datos de la máquina, volúmenes de datos, nombres de repositorios, contenidos, metadata ni estadísticas de uso. Desactivar las estadísticas no añade ni quita nada aquí. Con el hub desactivado (`--hub-off`), use la [activación sin conexión](#offline).

### Qué se guarda {#kept}

- El token: el documento firmado del hub, en la base de datos y en las copias de seguridad.
- El secreto de activación: un archivo en `config/licenses/` que solo puede leer la cuenta de los servicios. Nunca está en la base de datos, los registros ni una copia de seguridad.
- La clave de licencia: en ninguna parte.

## Comprobar el estado {#status}

```bash
sudo arkvory license status --root /opt/proanima-arkvory
```

Añada `--json` para scripts. Un administrador global ve lo mismo en `GET /api/v1/system/license` ([referencia](../api/reference/system#getSystemLicense)). Arkvory vuelve a verificar cada documento guardado cada vez; un documento que ProAnimaStudio no firmó es `invalid` y no habilita nada.

| Estado          | Significado                                                                                       | Escrituras de pago                   |
| --------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `valid`         | La licencia está vigente; `refreshFailing` cuando el hub lleva un tiempo sin responder            | en el modo del módulo                |
| `offline-grace` | Sin renovación desde hace más de un día; el token vale hasta `offlineGraceUntil`                  | en el modo del módulo                |
| `grace`         | El plazo de la licencia terminó; periodo de gracia de renovación hasta `graceUntil`               | en el modo del módulo                |
| `mismatch`      | El token pertenece a otra instalación (una restauración en otro lugar); gracia hasta `graceUntil` | en el modo del módulo hasta entonces |
| `expired`       | `trial_expired`, `licence_expired` o `activation_stale` (el token terminó)                        | en la forma del núcleo               |
| `revoked`       | Una revocación firmada; se muestra el motivo                                                      | en la forma del núcleo               |
| `invalid`       | Un documento guardado no se verifica                                                              | en la forma del núcleo               |

En cualquier estado sus datos siguen legibles, las copias de seguridad y las restauraciones funcionan, y publicar nunca falla por una licencia: sin licencia, un módulo de pago escribe los datos nuevos en la forma del núcleo gratuito. La escritura en el modo del módulo se reanuda sola tras una renovación correcta.

## Renovación y ventana sin conexión {#refresh}

El worker renueva cada activación más o menos una vez al día y al arrancar. Cada renovación trae un token nuevo y un secreto nuevo; el secreto anterior deja de funcionar.

Si no se puede llegar al hub, el worker lo intenta de nuevo a los 15 minutos y luego espera cada vez más, hasta 6 horas. La licencia sigue `valid`; tras un día sin renovación pasa a `offline-grace`; cuando el token termina (la ventana sin conexión: 30 días por defecto, 7 en una prueba) pasa a `expired` con `activation_stale`. Un rechazo del hub, como `licence_expired` o `activation_suspended`, no se reintenta: resuélvalo y ejecute:

```bash
sudo arkvory license refresh --root /opt/proanima-arkvory
```

Atrasar el reloj no prolonga nada: Arkvory juzga por la hora más tardía que ha visto. Un reloj de la base de datos más de un día por detrás de esa hora muestra `clockRollback`.

Si una renovación pudo llegar al hub pero se perdió la respuesta, Arkvory permite una sola repetición dentro de la ventana de 10 minutos, incluso tras reiniciar. Si el resultado sigue siendo desconocido, se agota la repetición, termina la ventana o el token recibido no es válido, `activation_recovery_required` detiene las renovaciones. El token actual sigue siendo válido hasta su vencimiento. Recupere la clave y repita `license activate --key-file <file>`; `license refresh` no resuelve este estado.

### Copias y restauraciones {#copies}

Una copia de la instalación, como una máquina virtual clonada, tiene el mismo secreto. Cuando ambas copias renuevan, el hub suspende la activación (`activation_secret_reused`). Active de nuevo con la clave la instalación que conserve.

Una copia de seguridad restaurada en otra instalación conserva su token, que pertenece a la instalación anterior: el estado es `mismatch` con gracia. Active la instalación nueva con la clave y luego desactive la anterior.

Una activación sin renovar durante su ventana sin conexión y 30 días más caduca, y su plaza queda libre. La siguiente renovación recupera la plaza mientras haya una libre; si no, se rechaza con `activation_lapsed`. Desactive otra instalación y renueve.

## Desactivar {#deactivate}

```bash
sudo arkvory license deactivate lic_0123456789ABCDEFGHJKMNPQRS --root /opt/proanima-arkvory
```

Indique la licencia o una activación. El hub libera la plaza y Arkvory borra el secreto.

## Activación sin conexión {#offline}

Para hosts sin acceso al hub:

1. Escriba un archivo de solicitud:

   ```bash
   sudo arkvory license request --key-file /root/arkvory.key --out /root/request.json --root /opt/proanima-arkvory
   ```

   El archivo contiene el SHA-256 de la clave, nunca la clave. Arkvory no usa ninguna red para ello.

2. Suba el archivo en su cuenta de ProAnimaStudio y descargue la respuesta.
3. Instale la respuesta:

   ```bash
   sudo arkvory license install /root/answer.json --root /opt/proanima-arkvory
   ```

La respuesta debe corresponder a una solicitud de esta instalación. Una activación sin conexión no se renueva: vale hasta su fin, como máximo 365 días, y una solicitud nueva la prolonga. Una revocación llega a ese host solo con una lista de revocación de licencias, que se instala de la misma forma.

## Errores {#errors}

| Código                                              | Significado                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `licence_key_invalid`                               | El hub no conoce la clave                                                                                 |
| `activation_limit_reached`                          | Todas las plazas de la licencia están ocupadas; desactive otra instalación                                |
| `answer_invalid`                                    | La respuesta no está firmada por ProAnimaStudio o es para otra instalación o solicitud; no se guarda nada |
| `installation_mismatch`, `nonce_unknown`            | La respuesta sin conexión es de otra instalación o de ninguna solicitud pendiente                         |
| `seq_replayed`                                      | Un documento más antiguo que el guardado; rechazado                                                       |
| `revocation_rollback`                               | Una lista de revocación más antigua que la guardada                                                       |
| `unreachable`, `timeout`, `tls_failed`, `hub_error` | No se pudo llegar al hub; el worker lo intentará de nuevo                                                 |
