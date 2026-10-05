---
title: HTTPS y proxy inverso
description: 'Haga que Arkvory sea accesible de forma segura desde otros equipos, con TLS integrado o un proxy inverso, y configure la consola y CORS para otra dirección.'
---

# HTTPS y proxy inverso

Una instalación nueva escucha en `127.0.0.1:8080` por HTTP sin cifrar. Solo los programas del servidor pueden acceder a ella. Antes de que los clientes se conecten desde otros equipos, ponga HTTPS delante. Las claves, las contraseñas y los enlaces de descarga viajan en las solicitudes: nunca los envíe por HTTP sin cifrar entre equipos.

## Elija un método {#choose}

|                                | TLS integrado                                     | Proxy inverso                                                     |
| ------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------- |
| Instalaciones                  | Servicios de Windows y Linux (nativo). No Compose | Todas, y el único método para Compose                             |
| Configuración                  | Un comando `arkvory configure` con reversión      | Configuración del proxy, más `ARKVORY_TRUSTED_PROXIES` en Arkvory |
| Puerto                         | El puerto de la API, 8080 de forma predeterminada | Cualquiera, como 443                                              |
| Renovación del certificado     | La API lee por sí misma los archivos renovados    | La gestiona el proxy                                              |
| Certificados de cliente (mTLS) | No admitidos                                      | Posibles en el proxy                                              |

## Antes de empezar {#before-you-start}

- Obtenga un certificado para el nombre que usan los clientes, de una autoridad en la que confíen los clientes, por ejemplo con certbot, win-acme o su autoridad corporativa. Necesita el certificado con su cadena y la clave privada, ambos como archivos PEM. La clave no debe tener contraseña.
- Cree un nombre DNS que apunte al servidor.
- Abra solo el puerto HTTPS en el firewall, y solo a las redes de sus clientes. Nunca abra el puerto 54329 de la base de datos.

## TLS integrado {#built-in-tls}

### Prepare los archivos {#tls-files}

Los archivos deben cumplir estas reglas. El comando las comprueba todas antes de cambiar nada.

- Las rutas son absolutas.
- Cada archivo es un archivo PEM de como máximo 1 MiB. El archivo del certificado contiene el certificado y, después de él, la cadena.
- La clave es una clave privada PEM sin cifrar que coincide con el certificado.
- El certificado no ha caducado.
- La cuenta de servicio puede leer ambos archivos: `arkvory` en Linux, `LocalService` en Windows.

Arkvory hace referencia a los archivos y no los copia. Colóquelos donde permanezcan cuando los renueve. En Linux, no bajo `/home`: las unidades no pueden verlo. Los directorios de algunas herramientas de certificados solo los puede leer `root`; copie los archivos renovados a un directorio que el grupo de servicio pueda leer, por ejemplo con un hook de renovación. Ejemplo para Linux:

```bash
sudo install -d -m 0750 -o root -g arkvory /etc/arkvory/tls
sudo install -m 0644 -o root -g arkvory fullchain.pem /etc/arkvory/tls/fullchain.pem
sudo install -m 0640 -o root -g arkvory privkey.pem /etc/arkvory/tls/privkey.pem
```

En Windows, coloque los archivos en una carpeta que `LocalService` pueda leer y permita que solo SYSTEM, Administrators y `LocalService` lean la clave.

### Active el TLS integrado {#tls-enable}

1. Ejecute el comando con las rutas y la dirección en la que escuchar. `0.0.0.0` escucha en todas las interfaces IPv4, `::` en todas las interfaces, o indique la dirección de una interfaz.

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory \
     --tls-cert /etc/arkvory/tls/fullchain.pem \
     --tls-key /etc/arkvory/tls/privkey.pem \
     --listen-host 0.0.0.0
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root C:\ProgramData\ProAnima\Arkvory `
     --tls-cert C:\ProgramData\ProAnima\Arkvory\tls\fullchain.pem `
     --tls-key C:\ProgramData\ProAnima\Arkvory\tls\privkey.pem `
     --listen-host 0.0.0.0
   ```

   El comando escribe `ARKVORY_TLS_CERT_FILE`, `ARKVORY_TLS_KEY_FILE` y `ARKVORY_HOST` en `config/runtime.json`, reinicia los servicios y espera hasta que la API responda a su comprobación de disponibilidad por HTTPS. La comprobación acepta solo el certificado configurado. Cuando tiene éxito, el comando imprime el día en que caduca el certificado. Cuando algo falla, restaura el `runtime.json` anterior, reinicia los servicios con él e informa del motivo.

2. Abra el puerto de la API en el firewall para las redes de sus clientes.
3. Pruebe desde un equipo cliente. El puerto sigue siendo 8080 a menos que cambie `ARKVORY_PORT`:

   ```bash
   curl https://arkvory.example.com:8080/health/status
   ```

   La respuesta es el estado 200 con `{"status":"ready"}`. La consola está en `https://arkvory.example.com:8080/console/`.

En Linux, la cuenta de servicio normalmente no puede escuchar en un puerto inferior a 1024. Para servir HTTPS en el puerto 443, use un [proxy inverso](#reverse-proxy).

Si el certificado no es válido al iniciar, la API se detiene con un error. Nunca recurre a HTTP sin cifrar.

### Configuración {#tls-settings}

`configure` establece los archivos y la dirección. Otras dos configuraciones se añaden a `runtime.json` a mano. Reinicie los servicios después de cambiarlas: consulte [Aplicar un cambio](./configuration#apply-change).

| Variable                     | Valor predeterminado | Significado                                                                                                                     |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TLS_MIN_VERSION`    | `TLSv1.2`            | `TLSv1.2` o `TLSv1.3`                                                                                                           |
| `ARKVORY_TLS_RELOAD_SECONDS` | `300`                | Con qué frecuencia la API vuelve a leer los archivos de certificado: de 30 a 86400 segundos, o `0` para leerlos solo al iniciar |

Cada respuesta incluye `Strict-Transport-Security: max-age=31536000`.

### Renueve el certificado {#tls-renewal}

Escriba el certificado y la clave renovados en las mismas rutas. No necesita ningún comando ni reinicio.

- La API compara los archivos cada `ARKVORY_TLS_RELOAD_SECONDS`. Las conexiones nuevas usan el certificado nuevo. Las conexiones abiertas conservan el antiguo hasta que terminan.
- Una renovación defectuosa (archivos ilegibles, una clave que no coincide, un certificado caducado) nunca reemplaza el certificado que funciona. La API registra `tls.reload_failed` y vuelve a intentarlo en el siguiente intervalo.
- Durante los últimos 14 días antes del vencimiento, la API registra `tls.expiring` una vez al día. La métrica `arkvory_tls_certificate_expiry_timestamp_seconds` es adecuada para una alerta. Consulte [Monitorización](../operate/monitoring).

### Desactive el TLS integrado {#tls-off}

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-off --listen-host 127.0.0.1
```

`--tls-off` por sí solo deja la dirección de escucha como está. Sin `--listen-host 127.0.0.1`, la API serviría entonces HTTP sin cifrar en todas las interfaces que haya abierto.

## Proxy inverso {#reverse-proxy}

El proxy acepta HTTPS de los clientes y reenvía HTTP sin cifrar a la API. Mantenga la API en `127.0.0.1:8080` e instale el proxy en el mismo host. Una instalación de Compose siempre publica solo `127.0.0.1:8080`, así que un proxy en el host le encaja directamente.

1. Instale el proxy y obtenga un certificado para él.
2. Configure el proxy como se describe en [Lo que debe hacer el proxy](#proxy-requirements).
3. Agregue la dirección del proxy a `ARKVORY_TRUSTED_PROXIES`. Consulte [Proxies de confianza](#trusted-proxies).
4. Asegúrese de que no se pueda acceder al puerto de la API desde otros equipos.
5. Pruebe: `curl https://arkvory.example.com/health/status` devuelve `{"status":"ready"}`.

### Lo que debe hacer el proxy {#proxy-requirements}

| Requisito                                                                                                         | Por qué                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Aceptar cuerpos de solicitud de cualquier tamaño (`client_max_body_size 0` en nginx)                              | Los archivos ocupan decenas de gigabytes o más. Una parte puede llegar a 1 GiB                                             |
| No almacenar en búfer los cuerpos de solicitud o respuesta (`proxy_request_buffering off`, `proxy_buffering off`) | Los bytes se transmiten en flujo. El búfer llena el disco del proxy y retrasa la transferencia                             |
| Permitir solicitudes de al menos 1900 segundos (`proxy_read_timeout`, `proxy_send_timeout`)                       | Una solicitud de subida puede tardar hasta 30 minutos (`ARKVORY_UPLOAD_DEADLINE_MS`, 1 800 000 ms de forma predeterminada) |
| Hablar HTTP/1.1 con la API y mantener la conexión                                                                 | Necesario para el streaming                                                                                                |
| Reenviar el nombre público en `Host`                                                                              | El servidor construye a partir de él enlaces absolutos, como los enlaces en las respuestas de Git LFS y npm                |
| Enviar `X-Forwarded-For` y `X-Forwarded-Proto: https`                                                             | La dirección del cliente para los registros y el límite de inicio de sesión, y el esquema de los enlaces absolutos         |
| Sobrescribir `X-Request-Id` con un ID propio                                                                      | La API conserva el ID de un proxy de confianza. Un cliente no debe elegirlo                                                |
| No escribir la cadena de consulta en su registro de acceso                                                        | Los enlaces de descarga llevan un secreto en `?token=`                                                                     |
| Establecer `Strict-Transport-Security` por sí mismo, si lo desea                                                  | La API lo envía solo desde el listener integrado                                                                           |

### nginx {#nginx}

Coloque esto en el contexto `http` de un nginx existente. Reemplace el nombre y las rutas de los certificados. El `log_format` escribe la ruta sin la cadena de consulta.

```nginx
log_format arkvory_path '$remote_addr [$time_local] "$request_method $uri $server_protocol" '
                        '$status $body_bytes_sent $request_time $request_id';
server {
    listen 443 ssl;
    server_name arkvory.example.com;
    ssl_certificate /etc/arkvory/tls/fullchain.pem;
    ssl_certificate_key /etc/arkvory/tls/privkey.pem;
    access_log /var/log/nginx/arkvory.access.log arkvory_path;
    client_max_body_size 0;
    client_body_timeout 60s;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Request-Id $request_id;
        proxy_set_header Connection "";
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 1900s;
        proxy_send_timeout 1900s;
    }
}
```

Con esta configuración, incluya el proxy en `ARKVORY_TRUSTED_PROXIES`, por ejemplo `127.0.0.1`. La directiva `proxy_set_header X-Request-Id $request_id` debe permanecer: sobrescribe un ID que un cliente podría enviar.

### Caddy {#caddy}

```caddyfile
arkvory.example.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Request-Id {http.request.uuid}
        flush_interval -1
    }
}
```

Caddy obtiene el certificado por sí mismo, transmite los cuerpos de solicitud en flujo, no tiene límite de tamaño de cuerpo ni tiempo de espera del upstream de forma predeterminada, y establece `X-Forwarded-For`, `X-Forwarded-Proto` y `X-Forwarded-Host`. Caddy no escribe ningún registro de acceso a menos que active `log`. Si lo hace, elimine la cadena de consulta de la dirección registrada.

### IIS y otros proxies {#iis}

La configuración de referencia del proyecto es el archivo nginx anterior. Estas son las opciones equivalentes para IIS con Application Request Routing y URL Rewrite. El proyecto no las prueba. Compruebe los nombres con su versión de IIS.

- Aumente el tiempo de espera del proxy del servidor a al menos 1900 segundos y establezca el umbral del búfer de respuesta en `0`.
- Aumente `maxAllowedContentLength` en el filtrado de solicitudes a su máximo, 4 294 967 295 bytes. IIS no puede aceptar un cuerpo de solicitud de 4 GiB o más, así que una sola subida con `curl -T` de un archivo así falla. `arkvoryctl` envía los archivos grandes en partes.
- Envíe el host original, `X-Forwarded-Proto: https` y la dirección del cliente en `X-Forwarded-For`. Establezca un `X-Request-Id` nuevo en una regla de URL Rewrite.
- Mantenga la cadena de consulta fuera del registro de IIS.

### Proxies de confianza {#trusted-proxies}

`ARKVORY_TRUSTED_PROXIES` acepta hasta 32 direcciones o rangos CIDR, separados por comas. Se rechazan los nombres de host y los comodines. Solo una solicitud que provenga de una de estas direcciones puede establecer:

- la dirección del cliente, con `X-Forwarded-For`. La API toma la dirección más cercana que no sea de confianza,
- el ID de solicitud, con `X-Request-Id`,
- el host de los enlaces absolutos, con `X-Forwarded-Host`.

Sin la lista, todos los clientes parecen venir de la dirección del proxy. El límite de inicio de sesión entonces cuenta a todas las personas como un solo cliente, y el registro de acceso muestra la dirección del proxy en `clientIp`. Incluya solo los proxies que controle.

En un host de Compose, la API puede ver el proxy bajo la dirección de la puerta de enlace de la red de Compose y no bajo `127.0.0.1`. Envíe una solicitud a través del proxy, busque `clientIp` en el registro `http.access` del registro de la API e incluya esa dirección.

Edite `config/runtime.json` y reinicie los servicios. Consulte [Aplicar un cambio](./configuration#apply-change).

```json
{ "ARKVORY_TRUSTED_PROXIES": "127.0.0.1,::1" }
```

Cuando la API escucha en una dirección no de bucle invertido sin TLS y sin un proxy de confianza, registra `http.plaintext_exposed` al iniciar. Una configuración de proxy correcta no lo provoca.

## La consola y su dirección de API {#console-api-address}

La consola que sirve Arkvory usa la dirección desde la que se abrió. Habla solo con su propio servidor: su política de seguridad de contenido no permite ninguna otra dirección. Detrás de un proxy funciona sin cambios en `https://arkvory.example.com/console/`.

Para alojar la consola en otro servidor web, por ejemplo junto a un portal:

1. Copie los archivos de la consola desde `releases/<version>/apps/web/public/` de la raíz de la instalación al otro servidor. Sírvalos en la ruta `/console/`, por HTTPS, con los tipos MIME correctos para `.js` y `.css`. Vuelva a copiarlos después de cada actualización de Arkvory.
2. En el `index.html` copiado, establezca la dirección de Arkvory:

   ```html
   <meta name="arkvory-api-base-url" content="https://arkvory.example.com/" />
   ```

3. Si el otro servidor establece una política de seguridad de contenido, permita `connect-src` a la dirección de Arkvory y permita el worker de scripts local.
4. Permita el origen de la consola en Arkvory. Consulte [CORS](#cors).

### CORS {#cors}

Establezca los orígenes de las aplicaciones web en otras direcciones en `ARKVORY_CORS_ORIGINS` y reinicie la API.

```json
{ "ARKVORY_CORS_ORIGINS": "https://portal.example.com,https://tools.example.com" }
```

- La lista contiene hasta 16 orígenes, cada uno con un esquema, un host y un puerto opcional, y sin ruta. Se requiere HTTPS. Solo se acepta HTTP sin cifrar para `localhost`, `127.0.0.1` y `[::1]`.
- CORS se aplica a `/api/v1/*` y `/health/ready`. Una solicitud de un origen que no esté en la lista recibe el estado 403 con el motivo `origin_not_allowed`. Una solicitud desde la propia dirección del servidor no necesita entrada.
- Un origen de la lista no obtiene derechos. Cada solicitud sigue necesitando una clave o una sesión y pasa las comprobaciones de acceso del servidor. La aplicación web envía la clave en la cabecera `Authorization`, no en una cookie.
- Los métodos permitidos son GET, HEAD, POST, PUT, PATCH y DELETE. Los navegadores pueden almacenar en caché la respuesta a una solicitud de comprobación previa durante 10 minutos.

Pruebe una solicitud de comprobación previa. La respuesta debe ser el estado 204 con su origen en `Access-Control-Allow-Origin`:

```bash
curl -i -X OPTIONS https://arkvory.example.com/api/v1/auth/me \
  -H 'Origin: https://portal.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

## Compruebe la configuración {#check}

1. `curl https://arkvory.example.com/health/status` devuelve el estado 200 y `{"status":"ready"}`. La cadena de certificados se verifica sin excepciones.
2. Abra la consola, inicie sesión y suba un archivo grande a través de la misma dirección.
3. Ejecute `arkvoryctl doctor` con un perfil que use la dirección HTTPS. No desactive la comprobación de certificados en los clientes: el cliente de línea de comandos no puede, y solo acepta HTTP sin cifrar para el equipo local. Consulte [Cliente de línea de comandos](../protocols/cli).
4. Tras un reinicio de la API, el registro no contiene ningún registro `http.plaintext_exposed`.

## Solución de problemas {#troubleshooting}

| Problema                                                                           | Causa y solución                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPS was not enabled; the previous configuration is restored`                    | El motivo se indica a continuación en el mensaje: los archivos no son PEM, la clave tiene contraseña, la clave no coincide, el certificado ha caducado, o la cuenta de servicio no puede leer un archivo. Corríjalo y ejecute el comando de nuevo |
| `TLS files must be given as absolute paths`                                        | Indique rutas completas                                                                                                                                                                                                                           |
| `Built-in TLS is for native installations; use a reverse proxy with Compose`       | Compose no incluye TLS integrado. Use un [proxy inverso](#reverse-proxy)                                                                                                                                                                          |
| Estado 413 del proxy                                                               | El límite del cuerpo es demasiado bajo. Use `client_max_body_size 0` en nginx                                                                                                                                                                     |
| Estado 502 o 504, o una subida rota tras varios minutos                            | El proxy almacena el cuerpo en búfer, o sus tiempos de espera son inferiores a 1900 segundos                                                                                                                                                      |
| Todos están limitados al iniciar sesión, o `clientIp` es siempre el proxy          | El proxy no está en `ARKVORY_TRUSTED_PROXIES`                                                                                                                                                                                                     |
| Los enlaces en las respuestas de Git LFS o npm muestran `http` o un nombre interno | El proxy no reenvía `Host` ni `X-Forwarded-Proto: https`                                                                                                                                                                                          |
| Una aplicación de navegador recibe 403 `origin_not_allowed`                        | Agregue su origen a `ARKVORY_CORS_ORIGINS` y reinicie                                                                                                                                                                                             |

Hay más sugerencias en [Solución de problemas](../operate/troubleshooting) y [Seguridad](../operate/security).
