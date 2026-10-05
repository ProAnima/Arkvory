---
title: HTTPS and reverse proxy
description: Make Arkvory reachable from other computers safely, with built-in TLS or a reverse proxy, and set up the console and CORS for another address.
---

# HTTPS and reverse proxy

A new installation listens on `127.0.0.1:8080` over plain HTTP. Only programs on the server can reach it. Before clients connect from other computers, put HTTPS in front of it. Keys, passwords and download links travel in requests: never send them over plain HTTP between computers.

## Choose a method {#choose}

|                            | Built-in TLS                                     | Reverse proxy                                                  |
| -------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Installations              | Windows services and Linux (native). Not Compose | All, and the only method for Compose                           |
| Setup                      | One `arkvory configure` command with rollback    | Proxy configuration, plus `ARKVORY_TRUSTED_PROXIES` in Arkvory |
| Port                       | The API port, 8080 by default                    | Any, such as 443                                               |
| Certificate renewal        | The API reads renewed files by itself            | Handled by the proxy                                           |
| Client certificates (mTLS) | Not supported                                    | Possible in the proxy                                          |

## Before you start {#before-you-start}

- Get a certificate for the name that clients use, from an authority that clients trust, for example with certbot, win-acme or your corporate authority. You need the certificate with its chain and the private key, both as PEM files. The key must have no password.
- Create a DNS name that points to the server.
- Open only the HTTPS port in the firewall, and only to the networks of your clients. Never open the database port 54329.

## Built-in TLS {#built-in-tls}

### Prepare the files {#tls-files}

The files must meet these rules. The command checks all of them before it changes anything.

- The paths are absolute.
- Each file is a PEM file of at most 1 MiB. The certificate file holds the certificate and, after it, the chain.
- The key is an unencrypted PEM private key that matches the certificate.
- The certificate has not expired.
- The service account can read both files: `arkvory` on Linux, `LocalService` on Windows.

Arkvory references the files and does not copy them. Place them where they stay when you renew them. On Linux, not under `/home`: the units cannot see it. Directories of some certificate tools are readable only by `root`; copy the renewed files to a directory the service group can read, for example with a renewal hook. Example for Linux:

```bash
sudo install -d -m 0750 -o root -g arkvory /etc/arkvory/tls
sudo install -m 0644 -o root -g arkvory fullchain.pem /etc/arkvory/tls/fullchain.pem
sudo install -m 0640 -o root -g arkvory privkey.pem /etc/arkvory/tls/privkey.pem
```

On Windows, put the files in a folder that `LocalService` can read, and let only SYSTEM, Administrators and `LocalService` read the key.

### Turn on built-in TLS {#tls-enable}

1. Run the command with the paths and the address to listen on. `0.0.0.0` listens on all IPv4 interfaces, `::` on all interfaces, or give the address of one interface.

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

   The command writes `ARKVORY_TLS_CERT_FILE`, `ARKVORY_TLS_KEY_FILE` and `ARKVORY_HOST` into `config/runtime.json`, restarts the services and waits until the API answers its readiness check over HTTPS. The check accepts only the configured certificate. When it succeeds, the command prints the day the certificate expires. When anything fails, it restores the previous `runtime.json`, restarts the services with it and reports the reason.

2. Open the API port in the firewall for your client networks.
3. Test from a client computer. The port stays 8080 unless you change `ARKVORY_PORT`:

   ```bash
   curl https://arkvory.example.com:8080/health/status
   ```

   The answer is status 200 with `{"status":"ready"}`. The console is at `https://arkvory.example.com:8080/console/`.

On Linux the service account cannot normally listen on a port below 1024. To serve HTTPS on port 443, use a [reverse proxy](#reverse-proxy).

If the certificate is invalid at start, the API stops with an error. It never falls back to plain HTTP.

### Settings {#tls-settings}

`configure` sets the files and the address. Two more settings go into `runtime.json` by hand. Restart the services after you change them: see [Apply a change](./configuration#apply-change).

| Variable                     | Default   | Meaning                                                                                                     |
| ---------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TLS_MIN_VERSION`    | `TLSv1.2` | `TLSv1.2` or `TLSv1.3`                                                                                      |
| `ARKVORY_TLS_RELOAD_SECONDS` | `300`     | How often the API reads the certificate files again: 30 to 86400 seconds, or `0` to read them only at start |

Every response carries `Strict-Transport-Security: max-age=31536000`.

### Renew the certificate {#tls-renewal}

Write the renewed certificate and key to the same paths. You need no command and no restart.

- The API compares the files every `ARKVORY_TLS_RELOAD_SECONDS`. New connections use the new certificate. Open connections keep the old one until they end.
- A broken renewal (unreadable files, a key that does not match, an expired certificate) never replaces the working certificate. The API logs `tls.reload_failed` and tries again at the next interval.
- During the last 14 days before the expiry, the API logs `tls.expiring` once a day. The metric `arkvory_tls_certificate_expiry_timestamp_seconds` is suitable for an alert. See [Monitoring](../operate/monitoring).

### Turn off built-in TLS {#tls-off}

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-off --listen-host 127.0.0.1
```

`--tls-off` alone leaves the listening address as it is. Without `--listen-host 127.0.0.1`, the API would then serve plain HTTP on every interface that you opened.

## Reverse proxy {#reverse-proxy}

The proxy accepts HTTPS from clients and forwards plain HTTP to the API. Keep the API on `127.0.0.1:8080` and install the proxy on the same host. A Compose installation always publishes only `127.0.0.1:8080`, so a proxy on the host fits it directly.

1. Install the proxy and get a certificate for it.
2. Configure the proxy as described in [What the proxy must do](#proxy-requirements).
3. Add the address of the proxy to `ARKVORY_TRUSTED_PROXIES`. See [Trusted proxies](#trusted-proxies).
4. Make sure that the API port is not reachable from other computers.
5. Test: `curl https://arkvory.example.com/health/status` returns `{"status":"ready"}`.

### What the proxy must do {#proxy-requirements}

| Requirement                                                                                     | Why                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Accept request bodies of any size (`client_max_body_size 0` in nginx)                           | Files are tens of gigabytes or more. A part can be up to 1 GiB                                       |
| Do not buffer request or response bodies (`proxy_request_buffering off`, `proxy_buffering off`) | Bytes stream through. Buffering fills the disk of the proxy and delays the transfer                  |
| Allow requests of at least 1900 seconds (`proxy_read_timeout`, `proxy_send_timeout`)            | One upload request may take up to 30 minutes (`ARKVORY_UPLOAD_DEADLINE_MS`, 1 800 000 ms by default) |
| Speak HTTP/1.1 to the API and keep the connection                                               | Needed for streaming                                                                                 |
| Forward the public name in `Host`                                                               | The server builds absolute links from it, such as the links in Git LFS and npm answers               |
| Send `X-Forwarded-For` and `X-Forwarded-Proto: https`                                           | The client address for logs and the sign-in limit, and the scheme of absolute links                  |
| Overwrite `X-Request-Id` with an ID of its own                                                  | The API keeps the ID from a trusted proxy. A client must not choose it                               |
| Do not write the query string to its access log                                                 | Download links carry a secret in `?token=`                                                           |
| Set `Strict-Transport-Security` itself, if you want it                                          | The API sends it only from the built-in listener                                                     |

### nginx {#nginx}

Put this in the `http` context of an existing nginx. Replace the name and the certificate paths. The `log_format` writes the path without the query string.

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

With this configuration, list the proxy in `ARKVORY_TRUSTED_PROXIES`, for example `127.0.0.1`. The directive `proxy_set_header X-Request-Id $request_id` must stay: it overwrites an ID that a client may send.

### Caddy {#caddy}

```caddyfile
arkvory.example.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Request-Id {http.request.uuid}
        flush_interval -1
    }
}
```

Caddy gets the certificate by itself, streams request bodies, has no body size limit and no upstream timeout by default, and sets `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`. Caddy writes no access log unless you enable `log`. If you do, remove the query string from the logged address.

### IIS and other proxies {#iis}

The project's reference configuration is the nginx file above. These are the equivalent settings for IIS with Application Request Routing and URL Rewrite. The project does not test them. Check the names against your IIS version.

- Raise the timeout of the server proxy to at least 1900 seconds, and set the response buffer threshold to `0`.
- Raise `maxAllowedContentLength` in request filtering to its maximum, 4 294 967 295 bytes. IIS cannot accept a request body of 4 GiB or more, so a single `curl -T` upload of such a file fails. `arkvoryctl` sends large files in parts.
- Send the original host, `X-Forwarded-Proto: https` and the client address in `X-Forwarded-For`. Set a fresh `X-Request-Id` in a URL Rewrite rule.
- Keep the query string out of the IIS log.

### Trusted proxies {#trusted-proxies}

`ARKVORY_TRUSTED_PROXIES` takes up to 32 addresses or CIDR ranges, separated by commas. Hostnames and wildcards are refused. Only a request that comes from one of these addresses may set:

- the client address, with `X-Forwarded-For`. The API takes the nearest address that is not trusted,
- the request ID, with `X-Request-Id`,
- the host of absolute links, with `X-Forwarded-Host`.

Without the list, every client appears to come from the address of the proxy. The sign-in limit then counts all people as one client, and the access log shows the proxy address in `clientIp`. List only proxies that you control.

On a Compose host, the API may see the proxy under the address of the Compose network gateway and not under `127.0.0.1`. Send one request through the proxy, find `clientIp` in the `http.access` record in the API log, and list that address.

Edit `config/runtime.json` and restart the services. See [Apply a change](./configuration#apply-change).

```json
{ "ARKVORY_TRUSTED_PROXIES": "127.0.0.1,::1" }
```

When the API listens on a non-loopback address without TLS and without a trusted proxy, it logs `http.plaintext_exposed` at start. A correct proxy setup does not trigger it.

## The console and its API address {#console-api-address}

The console that Arkvory serves uses the address it was opened from. It talks only to its own server: its content security policy allows no other address. Behind a proxy it works unchanged at `https://arkvory.example.com/console/`.

To host the console on another web server, for example next to a portal:

1. Copy the console files from `releases/<version>/apps/web/public/` in the installation root to the other server. Serve them at the path `/console/`, over HTTPS, with the correct MIME types for `.js` and `.css`. Copy them again after each Arkvory update.
2. In the copied `index.html`, set the address of Arkvory:

   ```html
   <meta name="arkvory-api-base-url" content="https://arkvory.example.com/" />
   ```

3. If the other server sets a content security policy, allow `connect-src` to the Arkvory address and allow the local script worker.
4. Allow the origin of the console in Arkvory. See [CORS](#cors).

### CORS {#cors}

Set the origins of web applications on other addresses in `ARKVORY_CORS_ORIGINS` and restart the API.

```json
{ "ARKVORY_CORS_ORIGINS": "https://portal.example.com,https://tools.example.com" }
```

- The list holds up to 16 origins, each with a scheme, a host and an optional port, and no path. HTTPS is required. Plain HTTP is accepted only for `localhost`, `127.0.0.1` and `[::1]`.
- CORS applies to `/api/v1/*` and `/health/ready`. A request from an origin that is not listed gets status 403 with the reason `origin_not_allowed`. A request from the server's own address needs no entry.
- An origin in the list gets no rights. Every request still needs a key or a session and passes the access checks of the server. The web application sends the key in the `Authorization` header, not in a cookie.
- The allowed methods are GET, HEAD, POST, PUT, PATCH and DELETE. Browsers may cache the answer to a preflight request for 10 minutes.

Test a preflight request. The answer must be status 204 with your origin in `Access-Control-Allow-Origin`:

```bash
curl -i -X OPTIONS https://arkvory.example.com/api/v1/auth/me \
  -H 'Origin: https://portal.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

## Check the setup {#check}

1. `curl https://arkvory.example.com/health/status` returns status 200 and `{"status":"ready"}`. The certificate chain verifies without exceptions.
2. Open the console, sign in and upload a large file through the same address.
3. Run `arkvoryctl doctor` with a profile that uses the HTTPS address. Do not turn off the certificate check on clients: the command-line client cannot, and it accepts plain HTTP only for the local computer. See [Command-line client](../protocols/cli).
4. After a restart of the API, the log has no `http.plaintext_exposed` record.

## Troubleshooting {#troubleshooting}

| Problem                                                                      | Cause and fix                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPS was not enabled; the previous configuration is restored`              | The reason follows in the message: the files are not PEM, the key has a password, the key does not match, the certificate expired, or the service account cannot read a file. Fix it and run the command again |
| `TLS files must be given as absolute paths`                                  | Give full paths                                                                                                                                                                                                |
| `Built-in TLS is for native installations; use a reverse proxy with Compose` | Compose has no built-in TLS. Use a [reverse proxy](#reverse-proxy)                                                                                                                                             |
| Status 413 from the proxy                                                    | The body limit is too low. Use `client_max_body_size 0` in nginx                                                                                                                                               |
| Status 502 or 504, or a broken upload after minutes                          | The proxy buffers the body, or its timeouts are shorter than 1900 seconds                                                                                                                                      |
| Everyone is limited at sign-in, or `clientIp` is always the proxy            | The proxy is not in `ARKVORY_TRUSTED_PROXIES`                                                                                                                                                                  |
| Links in Git LFS or npm answers show `http` or an internal name              | The proxy does not forward `Host` or `X-Forwarded-Proto: https`                                                                                                                                                |
| A browser application gets 403 `origin_not_allowed`                          | Add its origin to `ARKVORY_CORS_ORIGINS` and restart                                                                                                                                                           |

More hints are in [Troubleshooting](../operate/troubleshooting) and [Security](../operate/security).
