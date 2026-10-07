---
title: 'Webhooks'
description: 'Reciba una petición HTTP cuando cambia un repositorio: configure una suscripción, verifique la firma y maneje las entregas repetidas.'
---

# Webhooks

Un webhook avisa a su sistema de que algo cambió en un repositorio, para que no tenga que consultar periódicamente. El worker de Arkvory envía un `POST` HTTP a su URL por cada evento del [feed de cambios](../api/reference/artifacts#listCatalogChanges) del repositorio. Úselo para iniciar un despliegue cuando se publica una compilación, o para actualizar una caché cuando una ruta recibe una versión nueva.

El administrador define las suscripciones en un archivo. Todavía no hay API ni página de la consola para ellas. También puede leer el feed usted mismo con `GET /api/v1/repositories/<repository>/changes`.

## Cómo funciona la entrega {#how-it-works}

- **Una suscripción sigue un repositorio** y envía a una URL.
- **Los eventos llegan en orden, de uno en uno.** El siguiente espera hasta que el receptor responda con un estado `2xx`.
- **La entrega ocurre al menos una vez.** Tras un fallo o una respuesta perdida, el mismo evento puede llegar otra vez. Cada evento tiene un `id` estable: deduplique por él.
- **Una suscripción nueva recibe solo eventos nuevos.** Los anteriores a su creación no se envían.
- **Un receptor caído retrasa solo su suscripción.** El evento espera. Arkvory reintenta a los 12 segundos, duplica la pausa hasta una hora y envía los eventos en orden cuando el receptor vuelve a responder. Las subidas y descargas nunca esperan a un webhook.

## Configurar una suscripción {#set-up}

Necesita acceso a los archivos del servidor y permiso para reiniciar el worker. Consulte [Configuración](../install/configuration).

1. Cree un archivo con el secreto de firma: al menos 16 caracteres imprimibles aleatorios, por ejemplo `/root/ci.secret`. El receptor necesita el mismo secreto.
2. Ejecute `configure` con la suscripción. El comando valida lo que usted indica, copia el secreto en `config/webhooks`, escribe el archivo de suscripciones y el ajuste, reinicia los servicios y restaura la configuración anterior si no quedan listos. No contacta con el receptor.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --webhook ci --webhook-repository releases \
  --webhook-url https://ci.example.com/hooks/arkvory \
  --webhook-secret-file /root/ci.secret \
  --webhook-actions artifact.publish
```

3. Busque `webhook.started` en el registro del worker, publique un archivo y observe su receptor.

El comando escribe `config/webhooks/webhooks.json`, que también puede escribir a mano e indicar en `ARKVORY_WEBHOOKS_FILE`. Para cambiar una suscripción, ejecute el comando de nuevo con el mismo nombre. `--webhook-detach ci` la elimina: se borran sus archivos y se olvida su posición. Una llamada cambia una suscripción y no se puede mezclar con otras opciones de `configure`.

El archivo tiene estos campos:

```json
{
  "webhooks": [
    {
      "id": "ci",
      "repository": "releases",
      "url": "https://ci.example.com/hooks/arkvory",
      "secretFile": "/opt/proanima-arkvory/config/webhooks/ci.secret",
      "actions": ["artifact.publish"]
    }
  ]
}
```

| Campo            | Significado                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Nombre de la suscripción: de 1 a 64 caracteres `a-z`, `0-9`, `_` y `-`. Su progreso se guarda con este nombre.                                                                                  |
| `repository`     | El repositorio cuyo feed se envía.                                                                                                                                                              |
| `url`            | El receptor. HTTPS, sin nombre de usuario, query ni fragmento, hasta 2048 caracteres. HTTP sin cifrar solo se permite para `localhost`, `127.0.0.1` y `[::1]`.                                  |
| `secretFile`     | Ruta absoluta del archivo con el secreto de firma.                                                                                                                                              |
| `nextSecretFile` | Segundo secreto opcional para una [rotación](#rotate-the-secret).                                                                                                                               |
| `actions`        | Lista opcional de acciones del feed que se envían, por ejemplo `artifact.publish`, `artifact.delete`, `asset.replace`, `stage.add` y `package.register`. Sin ella se envían todas las acciones. |

Un archivo incorrecto detiene el worker al arrancar con `worker.unavailable`. Se permiten hasta 16 suscripciones. En una instalación con Compose el comando también monta `config/webhooks` en el contenedor del worker.

## La petición {#request}

| Encabezado            | Valor                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| `Content-Type`        | `application/json`                                                           |
| `X-Arkvory-Delivery`  | El `id` del evento. Es el mismo en cada repetición de un evento.             |
| `X-Arkvory-Event`     | La acción del feed, por ejemplo `artifact.publish`.                          |
| `X-Arkvory-Timestamp` | Hora Unix en segundos en que se firmó la petición.                           |
| `X-Arkvory-Signature` | `sha256=<hex>`. Durante una rotación hay dos valores separados por una coma. |

El cuerpo es JSON:

```json
{
  "id": "releases:128",
  "repository": "releases",
  "sequence": "128",
  "action": "artifact.publish",
  "artifactId": "00000000-0000-4000-8000-000000000001",
  "detail": null
}
```

`sequence` es la posición en el feed, una cadena decimal. `detail` es la ruta del archivo o la etapa en las acciones que la tienen. El cuerpo no incluye autor, contenido de archivos ni metadatos: use `artifactId` para leer el estado actual con la [API](../api/index).

Responda con cualquier estado `2xx` en menos de 10 segundos. Un estado `3xx` (no se siguen las redirecciones), `4xx`, `5xx`, un error de conexión o un tiempo agotado cuenta como fallo. Arkvory lee como máximo 4 KiB de la respuesta y la ignora.

## Verificar la firma {#verify}

La firma es HMAC-SHA256 con su secreto sobre el texto `<timestamp>.<body>`, escrita como `sha256=` y el resumen hexadecimal. Compruébela antes de confiar en una petición:

1. Lea el cuerpo sin procesar, antes de analizar el JSON.
2. Rechace la petición si la marca de tiempo difiere de su reloj en más de 5 minutos.
3. Calcule la firma y compárela con una función de tiempo constante. Si el encabezado tiene dos valores, acepte cualquiera.

Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, headers, rawBody) {
  const timestamp = headers['x-arkvory-timestamp'];
  if (!/^\d{1,12}$/.test(timestamp ?? '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(
    'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  );
  return String(headers['x-arkvory-signature'] ?? '')
    .split(',')
    .some((given) => {
      const actual = Buffer.from(given.trim());
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
}
```

Python:

```python
import hashlib, hmac, time

def verify(secret: bytes, headers, raw_body: bytes) -> bool:
    timestamp = headers.get("X-Arkvory-Timestamp", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    digest = hmac.new(secret, timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    expected = "sha256=" + digest
    given = headers.get("X-Arkvory-Signature", "").split(",")
    return any(hmac.compare_digest(part.strip(), expected) for part in given)
```

## Manejar entregas repetidas {#repeats}

- Guarde el `id` de cada evento procesado e ignore una repetición.
- Responda rápido: ponga el trabajo en cola y devuelva `204`. Un receptor lento retrasa todos los eventos posteriores de su suscripción.
- Una repetición no significa que la operación ocurriera dos veces. Trate el evento como una pista y lea el estado actual desde la API.

## Rotar el secreto {#rotate-the-secret}

1. Ejecute el mismo comando con `--webhook-secret-file` para el secreto actual y `--webhook-next-secret-file` para el nuevo. Cada petición llevará dos firmas.
2. Cambie el receptor al secreto nuevo. Un receptor que acepta cualquiera de las firmas sigue funcionando mientras tanto.
3. Ejecute el comando de nuevo con el archivo del secreto nuevo en `--webhook-secret-file` y sin `--webhook-next-secret-file`.

## Receptores privados y certificados {#private-receivers}

- Arkvory rechaza receptores en direcciones loopback, privadas, link-local y de metadatos de la nube, y nombres que se resuelven a ellas. Así no se puede usar el servidor para llegar a servicios internos.
- Para enviar a un receptor de su red, añada la red con `--webhook-allow-private`, por ejemplo `--webhook-allow-private 10.20.0.0/16` (`ARKVORY_WEBHOOKS_ALLOW_PRIVATE`). Se mantiene hasta que se elimina la última suscripción.
- Si el certificado del receptor proviene de su propia autoridad, añada un archivo PEM con esa autoridad mediante `--webhook-ca-file` (`ARKVORY_WEBHOOKS_CA_FILE`). El certificado siempre se verifica.

## Supervisar webhooks {#monitor}

El worker escribe `webhook.step_failed` con un `errorCode` cuando falla una entrega, y `webhook.recovered` cuando vuelve a funcionar. Las métricas `arkvory_webhook_failing` y `arkvory_webhook_last_success_timestamp_seconds` y la alerta `ArkvoryWebhookFailing` se describen en [Supervisión](../operate/monitoring).

## Solución de problemas {#troubleshooting}

| `errorCode` | Causa y qué hacer                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blocked`   | La dirección del receptor no está permitida (loopback, privada, link-local o de metadatos). Use una dirección pública o añada la red a `ARKVORY_WEBHOOKS_ALLOW_PRIVATE`. |
| `timeout`   | Sin respuesta en 10 segundos. Responda más rápido y ponga el trabajo en cola.                                                                                            |
| `network`   | Conexión rechazada, nombre no encontrado o conexión restablecida. Compruebe la URL, el DNS y el cortafuegos desde el servidor.                                           |
| `tls`       | El certificado no es de confianza, caducó o tiene un nombre incorrecto. Corríjalo o defina `ARKVORY_WEBHOOKS_CA_FILE`.                                                   |
| `redirect`  | El receptor respondió `3xx`. No se siguen las redirecciones: use la URL final.                                                                                           |
| `http_4xx`  | El receptor rechazó la petición. Revise su comprobación de firma, su ruta y su clave.                                                                                    |
| `http_5xx`  | El receptor falló. Arkvory sigue reintentando, con hasta una hora entre intentos.                                                                                        |
| `secret`    | El archivo de secreto no existe, no se puede leer o mide menos de 16 bytes.                                                                                              |

¿No llega nada? Compruebe que `webhook.started` está en el registro del worker, que `ARKVORY_WEBHOOKS_FILE` está definido, el nombre del repositorio y el filtro `actions`. Una suscripción nueva solo envía eventos posteriores a su primer paso.

## Páginas relacionadas {#related-pages}

- [Configuración](../install/configuration)
- [Supervisión](../operate/monitoring)
- [El feed de cambios en la referencia de la API](../api/reference/artifacts#listCatalogChanges)
