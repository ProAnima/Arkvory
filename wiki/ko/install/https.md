---
title: HTTPS 및 리버스 프록시
description: 내장 TLS 또는 리버스 프록시를 사용해 다른 컴퓨터에서 Arkvory에 안전하게 접근할 수 있도록 하고, 다른 주소에 맞게 콘솔과 CORS를 설정합니다.
---

# HTTPS 및 리버스 프록시

새로 설치하면 일반 HTTP로 `127.0.0.1:8080`에서 수신 대기합니다. 서버에 있는 프로그램만 연결할 수 있습니다. 다른 컴퓨터의 클라이언트가 연결하기 전에 앞단에 HTTPS를 두세요. 키, 비밀번호, 다운로드 링크는 요청을 통해 이동하므로 컴퓨터 간에 일반 HTTP로 절대 보내지 마세요.

## 방법 선택 {#choose}

|                         | 내장 TLS                                        | 리버스 프록시                                           |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| 설치                    | Windows 서비스 및 Linux(네이티브). Compose 아님 | 모든 경우, Compose에서는 유일한 방법                    |
| 설정                    | 롤백이 있는 `arkvory configure` 명령 하나       | 프록시 구성, 그리고 Arkvory의 `ARKVORY_TRUSTED_PROXIES` |
| 포트                    | API 포트, 기본 8080                             | 443 등 임의의 포트                                      |
| 인증서 갱신             | API가 갱신된 파일을 스스로 읽음                 | 프록시가 처리                                           |
| 클라이언트 인증서(mTLS) | 지원 안 함                                      | 프록시에서 가능                                         |

## 시작하기 전에 {#before-you-start}

- 클라이언트가 사용하는 이름에 대한 인증서를 클라이언트가 신뢰하는 기관에서 발급받으세요. 예를 들어 certbot, win-acme 또는 사내 기관을 사용할 수 있습니다. 인증서와 체인, 그리고 개인 키가 필요하며 둘 다 PEM 파일이어야 합니다. 키에는 비밀번호가 없어야 합니다.
- 서버를 가리키는 DNS 이름을 만드세요.
- 방화벽에서 HTTPS 포트만, 그것도 클라이언트 네트워크에만 여세요. 데이터베이스 포트 54329는 절대 열지 마세요.

## 내장 TLS {#built-in-tls}

### 파일 준비 {#tls-files}

파일은 다음 규칙을 충족해야 합니다. 명령은 무엇이든 변경하기 전에 이 모두를 확인합니다.

- 경로는 절대 경로입니다.
- 각 파일은 최대 1 MiB의 PEM 파일입니다. 인증서 파일에는 인증서와 그 뒤에 체인이 들어 있습니다.
- 키는 인증서와 일치하는 암호화되지 않은 PEM 개인 키입니다.
- 인증서가 만료되지 않았습니다.
- 서비스 계정이 두 파일을 모두 읽을 수 있습니다. Linux에서는 `arkvory`, Windows에서는 `LocalService`입니다.

Arkvory는 파일을 참조하며 복사하지 않습니다. 갱신할 때도 그대로 유지되는 위치에 두세요. Linux에서는 `/home` 아래에 두지 마세요. 유닛이 볼 수 없습니다. 일부 인증서 도구의 디렉터리는 `root`만 읽을 수 있으므로, 갱신된 파일을 서비스 그룹이 읽을 수 있는 디렉터리로 복사하세요. 예를 들어 갱신 훅을 사용합니다. Linux 예:

```bash
sudo install -d -m 0750 -o root -g arkvory /etc/arkvory/tls
sudo install -m 0644 -o root -g arkvory fullchain.pem /etc/arkvory/tls/fullchain.pem
sudo install -m 0640 -o root -g arkvory privkey.pem /etc/arkvory/tls/privkey.pem
```

Windows에서는 `LocalService`가 읽을 수 있는 폴더에 파일을 두고, SYSTEM, Administrators, `LocalService`만 키를 읽도록 하세요.

### 내장 TLS 켜기 {#tls-enable}

1. 경로와 수신 대기할 주소를 지정해 명령을 실행하세요. `0.0.0.0`은 모든 IPv4 인터페이스에서, `::`는 모든 인터페이스에서 수신 대기하며, 아니면 특정 인터페이스 하나의 주소를 지정하세요.

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

   이 명령은 `ARKVORY_TLS_CERT_FILE`, `ARKVORY_TLS_KEY_FILE`, `ARKVORY_HOST`를 `config/runtime.json`에 기록하고, 서비스를 다시 시작한 뒤 API가 HTTPS를 통해 준비 상태 확인에 응답할 때까지 기다립니다. 이 확인은 구성된 인증서만 허용합니다. 성공하면 명령은 인증서 만료일을 출력합니다. 무엇이든 실패하면 이전 `runtime.json`을 복원하고, 그것으로 서비스를 다시 시작한 뒤 원인을 보고합니다.

2. 방화벽에서 클라이언트 네트워크용 API 포트를 여세요.
3. 클라이언트 컴퓨터에서 테스트하세요. `ARKVORY_PORT`를 변경하지 않으면 포트는 8080입니다.

   ```bash
   curl https://arkvory.example.com:8080/health/status
   ```

   응답은 `{"status":"ready"}`와 함께 상태 200입니다. 콘솔은 `https://arkvory.example.com:8080/console/`에 있습니다.

Linux에서 서비스 계정은 일반적으로 1024 미만 포트에서 수신 대기할 수 없습니다. 443 포트에서 HTTPS를 제공하려면 [리버스 프록시](#reverse-proxy)를 사용하세요.

시작할 때 인증서가 유효하지 않으면 API는 오류와 함께 중지합니다. 일반 HTTP로 폴백하지 않습니다.

### 설정 {#tls-settings}

`configure`는 파일과 주소를 설정합니다. 두 가지 설정은 `runtime.json`에 직접 넣습니다. 변경한 뒤에는 서비스를 다시 시작하세요. [변경 사항 적용](./configuration#apply-change)을 참조하세요.

| 변수                         | 기본값    | 의미                                                                     |
| ---------------------------- | --------- | ------------------------------------------------------------------------ |
| `ARKVORY_TLS_MIN_VERSION`    | `TLSv1.2` | `TLSv1.2` 또는 `TLSv1.3`                                                 |
| `ARKVORY_TLS_RELOAD_SECONDS` | `300`     | API가 인증서 파일을 다시 읽는 주기: 30~86400초, `0`이면 시작할 때만 읽음 |

모든 응답에는 `Strict-Transport-Security: max-age=31536000`이 포함됩니다.

### 인증서 갱신 {#tls-renewal}

갱신된 인증서와 키를 같은 경로에 기록하세요. 명령도, 재시작도 필요하지 않습니다.

- API는 `ARKVORY_TLS_RELOAD_SECONDS`마다 파일을 비교합니다. 새 연결은 새 인증서를 사용합니다. 열려 있는 연결은 끝날 때까지 이전 인증서를 유지합니다.
- 잘못된 갱신(읽을 수 없는 파일, 일치하지 않는 키, 만료된 인증서)은 동작 중인 인증서를 절대 대체하지 않습니다. API는 `tls.reload_failed`를 기록하고 다음 주기에 다시 시도합니다.
- 만료 전 마지막 14일 동안 API는 하루에 한 번 `tls.expiring`을 기록합니다. 메트릭 `arkvory_tls_certificate_expiry_timestamp_seconds`는 경보에 적합합니다. [모니터링](../operate/monitoring)을 참조하세요.

### 내장 TLS 끄기 {#tls-off}

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-off --listen-host 127.0.0.1
```

`--tls-off`만 지정하면 수신 대기 주소가 그대로 유지됩니다. `--listen-host 127.0.0.1`이 없으면 API는 열어 둔 모든 인터페이스에서 일반 HTTP를 제공하게 됩니다.

## 리버스 프록시 {#reverse-proxy}

프록시는 클라이언트로부터 HTTPS를 받아 일반 HTTP로 API에 전달합니다. API를 `127.0.0.1:8080`에 두고 프록시를 같은 호스트에 설치하세요. Compose 설치는 항상 `127.0.0.1:8080`만 게시하므로, 호스트의 프록시가 그대로 맞습니다.

1. 프록시를 설치하고 그에 대한 인증서를 발급받으세요.
2. [프록시가 해야 할 일](#proxy-requirements)에 설명된 대로 프록시를 구성하세요.
3. 프록시의 주소를 `ARKVORY_TRUSTED_PROXIES`에 추가하세요. [신뢰할 수 있는 프록시](#trusted-proxies)를 참조하세요.
4. 다른 컴퓨터에서 API 포트에 접근할 수 없도록 하세요.
5. 테스트: `curl https://arkvory.example.com/health/status`가 `{"status":"ready"}`를 반환합니다.

### 프록시가 해야 할 일 {#proxy-requirements}

| 요구 사항                                                                              | 이유                                                                                           |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 모든 크기의 요청 본문 수락(nginx에서는 `client_max_body_size 0`)                       | 파일이 수십 GB 이상입니다. 파트 하나는 최대 1 GiB일 수 있습니다                                |
| 요청 또는 응답 본문 버퍼링 안 함(`proxy_request_buffering off`, `proxy_buffering off`) | 바이트가 스트리밍으로 통과합니다. 버퍼링은 프록시 디스크를 채우고 전송을 지연시킵니다          |
| 최소 1900초의 요청 허용(`proxy_read_timeout`, `proxy_send_timeout`)                    | 업로드 요청 하나가 최대 30분 걸릴 수 있습니다(`ARKVORY_UPLOAD_DEADLINE_MS`, 기본 1 800 000 ms) |
| API와 HTTP/1.1로 통신하고 연결 유지                                                    | 스트리밍에 필요                                                                                |
| `Host`에 공용 이름 전달                                                                | 서버가 이 값으로 Git LFS 및 npm 응답의 링크 같은 절대 링크를 만듭니다                          |
| `X-Forwarded-For`와 `X-Forwarded-Proto: https` 전송                                    | 로그와 로그인 제한에 쓰이는 클라이언트 주소, 그리고 절대 링크의 스킴                           |
| `X-Request-Id`를 자체 ID로 덮어쓰기                                                    | API는 신뢰할 수 있는 프록시의 ID를 유지합니다. 클라이언트가 이를 선택해서는 안 됩니다          |
| 액세스 로그에 쿼리 문자열을 기록하지 않기                                              | 다운로드 링크는 `?token=`에 시크릿을 담습니다                                                  |
| 원한다면 `Strict-Transport-Security`를 직접 설정                                       | API는 내장 리스너에서만 이를 전송합니다                                                        |

### nginx {#nginx}

기존 nginx의 `http` 컨텍스트에 이것을 넣으세요. 이름과 인증서 경로를 바꾸세요. `log_format`은 쿼리 문자열 없이 경로를 기록합니다.

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

이 구성에서는 프록시를 `ARKVORY_TRUSTED_PROXIES`에 등록하세요. 예를 들어 `127.0.0.1`입니다. 지시문 `proxy_set_header X-Request-Id $request_id`는 반드시 남겨야 합니다. 클라이언트가 보낼 수 있는 ID를 덮어쓰기 때문입니다.

### Caddy {#caddy}

```caddyfile
arkvory.example.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Request-Id {http.request.uuid}
        flush_interval -1
    }
}
```

Caddy는 인증서를 스스로 발급받고, 요청 본문을 스트리밍하며, 기본적으로 본문 크기 제한과 업스트림 시간 초과가 없고, `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`를 설정합니다. `log`를 켜지 않으면 Caddy는 액세스 로그를 기록하지 않습니다. 켠다면 기록되는 주소에서 쿼리 문자열을 제거하세요.

### IIS 및 기타 프록시 {#iis}

프로젝트의 참조 구성은 위의 nginx 파일입니다. 다음은 Application Request Routing 및 URL Rewrite를 사용하는 IIS에 해당하는 설정입니다. 프로젝트는 이를 테스트하지 않습니다. IIS 버전에 맞게 이름을 확인하세요.

- 서버 프록시의 시간 초과를 최소 1900초로 늘리고, 응답 버퍼 임계값을 `0`으로 설정하세요.
- 요청 필터링의 `maxAllowedContentLength`를 최댓값인 4 294 967 295바이트로 늘리세요. IIS는 4 GiB 이상의 요청 본문을 받을 수 없으므로, 그런 파일을 `curl -T`로 한 번에 업로드하면 실패합니다. `arkvoryctl`은 대용량 파일을 파트로 나누어 보냅니다.
- 원래 호스트, `X-Forwarded-Proto: https`, 그리고 `X-Forwarded-For`의 클라이언트 주소를 보내세요. URL Rewrite 규칙에서 새 `X-Request-Id`를 설정하세요.
- IIS 로그에 쿼리 문자열이 들어가지 않게 하세요.

### 신뢰할 수 있는 프록시 {#trusted-proxies}

`ARKVORY_TRUSTED_PROXIES`는 쉼표로 구분된 최대 32개의 주소 또는 CIDR 범위를 받습니다. 호스트 이름과 와일드카드는 거부됩니다. 이 주소 중 하나에서 온 요청만 다음을 설정할 수 있습니다.

- `X-Forwarded-For`로 클라이언트 주소. API는 신뢰할 수 없는 가장 가까운 주소를 사용합니다.
- `X-Request-Id`로 요청 ID.
- `X-Forwarded-Host`로 절대 링크의 호스트.

목록이 없으면 모든 클라이언트가 프록시 주소에서 오는 것으로 보입니다. 그러면 로그인 제한이 모든 사람을 하나의 클라이언트로 세고, 액세스 로그의 `clientIp`에 프록시 주소가 표시됩니다. 직접 관리하는 프록시만 등록하세요.

Compose 호스트에서는 API가 프록시를 `127.0.0.1`이 아니라 Compose 네트워크 게이트웨이 주소로 볼 수 있습니다. 프록시를 통해 요청을 하나 보내고, API 로그의 `http.access` 레코드에서 `clientIp`를 찾아 그 주소를 등록하세요.

`config/runtime.json`을 편집하고 서비스를 다시 시작하세요. [변경 사항 적용](./configuration#apply-change)을 참조하세요.

```json
{ "ARKVORY_TRUSTED_PROXIES": "127.0.0.1,::1" }
```

API가 TLS 없이, 신뢰할 수 있는 프록시 없이 비루프백 주소에서 수신 대기하면 시작할 때 `http.plaintext_exposed`를 기록합니다. 올바른 프록시 설정은 이것을 트리거하지 않습니다.

## 콘솔과 API 주소 {#console-api-address}

Arkvory가 제공하는 콘솔은 열린 주소를 사용합니다. 콘솔은 자신의 서버하고만 통신합니다. 콘텐츠 보안 정책이 다른 주소를 허용하지 않습니다. 프록시 뒤에서도 `https://arkvory.example.com/console/`에서 그대로 동작합니다.

콘솔을 다른 웹 서버, 예를 들어 포털 옆에 호스팅하려면:

1. 설치 루트의 `releases/<version>/apps/web/public/`에서 콘솔 파일을 다른 서버로 복사하세요. `/console/` 경로에서 HTTPS로 제공하고, `.js`와 `.css`에 올바른 MIME 타입을 사용하세요. Arkvory를 업데이트할 때마다 다시 복사하세요.
2. 복사한 `index.html`에서 Arkvory의 주소를 설정하세요:

   ```html
   <meta name="arkvory-api-base-url" content="https://arkvory.example.com/" />
   ```

3. 다른 서버가 콘텐츠 보안 정책을 설정한다면, `connect-src`에 Arkvory 주소를 허용하고 로컬 스크립트 워커를 허용하세요.
4. Arkvory에서 콘솔의 오리진을 허용하세요. [CORS](#cors)를 참조하세요.

### CORS {#cors}

다른 주소에 있는 웹 애플리케이션의 오리진을 `ARKVORY_CORS_ORIGINS`에 설정하고 API를 다시 시작하세요.

```json
{ "ARKVORY_CORS_ORIGINS": "https://portal.example.com,https://tools.example.com" }
```

- 목록은 최대 16개의 오리진을 담으며, 각 오리진은 스킴, 호스트, 선택적 포트로 구성되고 경로는 없습니다. HTTPS가 필요합니다. 일반 HTTP는 `localhost`, `127.0.0.1`, `[::1]`에만 허용됩니다.
- CORS는 `/api/v1/*`와 `/health/ready`에 적용됩니다. 목록에 없는 오리진의 요청은 사유 `origin_not_allowed`와 함께 상태 403을 받습니다. 서버 자체 주소에서 온 요청은 등록이 필요하지 않습니다.
- 목록에 있는 오리진이라고 해서 권한이 생기지는 않습니다. 모든 요청은 여전히 키나 세션이 필요하며 서버의 액세스 검사를 통과해야 합니다. 웹 애플리케이션은 키를 쿠키가 아니라 `Authorization` 헤더로 보냅니다.
- 허용되는 메서드는 GET, HEAD, POST, PUT, PATCH, DELETE입니다. 브라우저는 프리플라이트 요청의 응답을 10분 동안 캐시할 수 있습니다.

프리플라이트 요청을 테스트하세요. 응답은 `Access-Control-Allow-Origin`에 오리진이 포함된 상태 204여야 합니다:

```bash
curl -i -X OPTIONS https://arkvory.example.com/api/v1/auth/me \
  -H 'Origin: https://portal.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

## 설정 확인 {#check}

1. `curl https://arkvory.example.com/health/status`가 상태 200과 `{"status":"ready"}`를 반환합니다. 인증서 체인이 예외 없이 검증됩니다.
2. 콘솔을 열고 로그인한 뒤, 같은 주소를 통해 큰 파일을 업로드하세요.
3. HTTPS 주소를 사용하는 프로필로 `arkvoryctl doctor`를 실행하세요. 클라이언트에서 인증서 검사를 끄지 마세요. 명령줄 클라이언트는 끌 수 없으며, 로컬 컴퓨터에 대해서만 일반 HTTP를 허용합니다. [명령줄 클라이언트](../protocols/cli)를 참조하세요.
4. API를 다시 시작한 뒤 로그에 `http.plaintext_exposed` 레코드가 없습니다.

## 문제 해결 {#troubleshooting}

| 문제                                                                         | 원인과 해결 방법                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPS was not enabled; the previous configuration is restored`              | 메시지에 원인이 이어집니다. 파일이 PEM이 아니거나, 키에 비밀번호가 있거나, 키가 일치하지 않거나, 인증서가 만료되었거나, 서비스 계정이 파일을 읽을 수 없습니다. 문제를 해결하고 명령을 다시 실행하세요 |
| `TLS files must be given as absolute paths`                                  | 전체 경로를 지정하세요                                                                                                                                                                                |
| `Built-in TLS is for native installations; use a reverse proxy with Compose` | Compose에는 내장 TLS가 없습니다. [리버스 프록시](#reverse-proxy)를 사용하세요                                                                                                                         |
| 프록시에서 상태 413                                                          | 본문 제한이 너무 낮습니다. nginx에서 `client_max_body_size 0`을 사용하세요                                                                                                                            |
| 상태 502 또는 504, 또는 몇 분 후 깨진 업로드                                 | 프록시가 본문을 버퍼링하거나, 시간 초과가 1900초보다 짧습니다                                                                                                                                         |
| 로그인할 때 모든 사람이 제한되거나, `clientIp`가 항상 프록시임               | 프록시가 `ARKVORY_TRUSTED_PROXIES`에 없습니다                                                                                                                                                         |
| Git LFS 또는 npm 응답의 링크에 `http` 또는 내부 이름이 표시됨                | 프록시가 `Host` 또는 `X-Forwarded-Proto: https`를 전달하지 않습니다                                                                                                                                   |
| 브라우저 애플리케이션이 403 `origin_not_allowed`를 받음                      | 해당 오리진을 `ARKVORY_CORS_ORIGINS`에 추가하고 다시 시작하세요                                                                                                                                       |

더 많은 힌트는 [문제 해결](../operate/troubleshooting)과 [보안](../operate/security)에 있습니다.
