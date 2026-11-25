---
title: HTTPS والوكيل العكسي
description: أتِح الوصول إلى Arkvory بأمان من حواسيب أخرى باستخدام TLS المدمج أو وكيل عكسي، واضبط وحدة التحكم وCORS لعنوان آخر.
---

# HTTPS والوكيل العكسي

يستمع التثبيت الجديد على `127.0.0.1:8080` عبر HTTP غير مشفّر. لا تستطيع الوصول إليه إلا البرامج على الخادم. قبل اتصال العملاء من حواسيب أخرى، ضع HTTPS أمامه. تنتقل المفاتيح وكلمات المرور وروابط التنزيل في الطلبات: لا ترسلها عبر HTTP غير مشفّر بين الحواسيب أبدًا.

## اختيار طريقة {#choose}

|                       | TLS المدمج                                             | وكيل عكسي                                             |
| --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| التثبيتات             | خدمات Windows وLinux (التثبيت الأصلي). لا يشمل Compose | جميعها، وهو الطريقة الوحيدة لـCompose                 |
| الإعداد               | أمر `arkvory configure` واحد مع التراجع                | إعداد الوكيل، مع `ARKVORY_TRUSTED_PROXIES` في Arkvory |
| المنفذ                | منفذ API، وهو 8080 افتراضيًا                            | أي منفذ، مثل 443                                      |
| تجديد الشهادة         | تقرأ API الملفات المجدّدة بنفسها                        | يتولاه الوكيل                                         |
| شهادات العملاء (mTLS) | غير مدعومة                                             | ممكنة في الوكيل                                       |

## قبل البدء {#before-you-start}

- احصل على شهادة للاسم الذي يستخدمه العملاء من جهة يثق بها العملاء، مثلًا باستخدام certbot أو win-acme أو جهة إصدار الشهادات في مؤسستك. تحتاج إلى الشهادة مع سلسلتها وإلى المفتاح الخاص، كلاهما كملف PEM. يجب ألا يكون للمفتاح كلمة مرور.
- أنشئ اسم DNS يشير إلى الخادم.
- افتح منفذ HTTPS فقط في الجدار الناري، ولشبكات عملائك فقط. لا تفتح منفذ قاعدة البيانات (54329 أو 45329-45348) أبدًا.

## TLS المدمج {#built-in-tls}

### تجهيز الملفات {#tls-files}

يجب أن تستوفي الملفات هذه القواعد. يتحقق الأمر منها جميعًا قبل تغيير أي شيء.

- المسارات مطلقة.
- كل ملف هو ملف PEM لا يتجاوز حجمه 1 MiB. يحتوي ملف الشهادة على الشهادة ثم سلسلتها.
- المفتاح مفتاح خاص بصيغة PEM غير مشفّر ويطابق الشهادة.
- الشهادة غير منتهية الصلاحية.
- يستطيع حساب الخدمة قراءة الملفين: `arkvory` على Linux و`LocalService` على Windows.

يشير Arkvory إلى الملفات ولا ينسخها. ضعها في موضع تبقى فيه عند تجديدها. على Linux، لا تضعها تحت `/home`: لا تستطيع الوحدات رؤيته. لا يستطيع قراءة أدلة بعض أدوات الشهادات إلا `root`؛ انسخ الملفات المجدّدة إلى دليل تستطيع مجموعة الخدمة قراءته، مثلًا باستخدام إجراء يُنفّذ عند التجديد. مثال على Linux:

```bash
sudo install -d -m 0750 -o root -g arkvory /etc/arkvory/tls
sudo install -m 0644 -o root -g arkvory fullchain.pem /etc/arkvory/tls/fullchain.pem
sudo install -m 0640 -o root -g arkvory privkey.pem /etc/arkvory/tls/privkey.pem
```

على Windows، ضع الملفات في مجلد يستطيع `LocalService` قراءته، ولا تسمح بقراءة المفتاح إلا لـSYSTEM وAdministrators و`LocalService`.

### تفعيل TLS المدمج {#tls-enable}

1. شغّل الأمر مع المسارات وعنوان الاستماع. يستمع `0.0.0.0` على جميع واجهات IPv4، و`::` على جميع الواجهات، أو أدخل عنوان واجهة واحدة.

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

   يكتب الأمر `ARKVORY_TLS_CERT_FILE` و`ARKVORY_TLS_KEY_FILE` و`ARKVORY_HOST` في `config/runtime.json`، ويعيد تشغيل الخدمات وينتظر حتى تستجيب API لفحص الجاهزية عبر HTTPS. لا يقبل الفحص إلا الشهادة المضبوطة. عند النجاح، يطبع الأمر تاريخ انتهاء الشهادة. إذا فشل أي شيء، يستعيد `runtime.json` السابق ويعيد تشغيل الخدمات به ويبلّغ عن السبب.

2. افتح منفذ API في الجدار الناري لشبكات عملائك.
3. اختبر من حاسوب عميل. يبقى المنفذ 8080 ما لم تغيّر `ARKVORY_PORT`:

   ```bash
   curl https://arkvory.example.com:8080/health/status
   ```

   تكون الاستجابة بالحالة 200 مع `{"status":"ready"}`. توجد وحدة التحكم على `https://arkvory.example.com:8080/console/`.

على Linux، لا يستطيع حساب الخدمة عادةً الاستماع على منفذ أقل من 1024. لتقديم HTTPS على المنفذ 443، استخدم [وكيلًا عكسيًا](#reverse-proxy).

إذا كانت الشهادة غير صالحة عند البدء، تتوقف API مع خطأ. ولا تعود إلى HTTP غير مشفّر أبدًا.

### الإعدادات {#tls-settings}

يضبط `configure` الملفات والعنوان. يُضاف إعدادان آخران يدويًا إلى `runtime.json`. أعد تشغيل الخدمات بعد تغييرهما: راجع [تطبيق تغيير](./configuration#apply-change).

| المتغير                      | القيمة الافتراضية | المعنى                                                                                     |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `ARKVORY_TLS_MIN_VERSION`    | `TLSv1.2`         | `TLSv1.2` أو `TLSv1.3`                                                                     |
| `ARKVORY_TLS_RELOAD_SECONDS` | `300`             | تواتر إعادة قراءة API لملفات الشهادة: من 30 إلى 86400 ثانية، أو `0` لقراءتها عند البدء فقط |

تحمل كل استجابة الترويسة `Strict-Transport-Security: max-age=31536000`.

### تجديد الشهادة {#tls-renewal}

اكتب الشهادة والمفتاح المجدّدين في المسارين نفسيهما. لا تحتاج إلى أمر أو إعادة تشغيل.

- تقارن API الملفات كل `ARKVORY_TLS_RELOAD_SECONDS`. تستخدم الاتصالات الجديدة الشهادة الجديدة. وتحتفظ الاتصالات المفتوحة بالقديمة حتى تنتهي.
- لا يستبدل تجديد معيب (ملفات غير قابلة للقراءة أو مفتاح غير مطابق أو شهادة منتهية) الشهادة العاملة أبدًا. تسجّل API الحدث `tls.reload_failed` وتحاول مجددًا في الفترة التالية.
- خلال آخر 14 يومًا قبل انتهاء الصلاحية، تسجّل API الحدث `tls.expiring` مرة يوميًا. يصلح المقياس `arkvory_tls_certificate_expiry_timestamp_seconds` لإعداد تنبيه. راجع [المراقبة](../operate/monitoring).

### إيقاف TLS المدمج {#tls-off}

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-off --listen-host 127.0.0.1
```

يُبقي `--tls-off` وحده عنوان الاستماع كما هو. من دون `--listen-host 127.0.0.1`، ستقدّم API عندئذ HTTP غير مشفّر على كل واجهة فتحتها.

## الوكيل العكسي {#reverse-proxy}

يقبل الوكيل HTTPS من العملاء ويمرّر HTTP غير مشفّر إلى API. أبقِ API على `127.0.0.1:8080` وثبّت الوكيل على المضيف نفسه. ينشر تثبيت Compose دائمًا `127.0.0.1:8080` فقط، لذا يلائمه وكيل على المضيف مباشرةً.

1. ثبّت الوكيل واحصل على شهادة له.
2. اضبط الوكيل كما هو موضح في [متطلبات الوكيل](#proxy-requirements).
3. أضف عنوان الوكيل إلى `ARKVORY_TRUSTED_PROXIES`. راجع [الوكلاء الموثوقون](#trusted-proxies).
4. تأكد من تعذّر الوصول إلى منفذ API من حواسيب أخرى.
5. اختبر: يُرجع `curl https://arkvory.example.com/health/status` القيمة `{"status":"ready"}`.

### متطلبات الوكيل {#proxy-requirements}

| المتطلب                                                                                            | السبب                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| قبول أجسام الطلبات بأي حجم (`client_max_body_size 0` في nginx)                                     | يبلغ حجم الملفات عشرات الغيغابايت أو أكثر. ويمكن أن يصل حجم الجزء إلى 1 GiB                       |
| عدم تخزين أجسام الطلبات أو الاستجابات مؤقتًا (`proxy_request_buffering off`، `proxy_buffering off`) | تمر البايتات تدفقيًا. يملأ التخزين المؤقت قرص الوكيل ويؤخّر النقل                                   |
| السماح بطلبات مدتها 1900 ثانية على الأقل (`proxy_read_timeout`، `proxy_send_timeout`)              | قد يستغرق طلب رفع واحد حتى 30 دقيقة (`ARKVORY_UPLOAD_DEADLINE_MS`، افتراضيًا 1 800 000 مللي ثانية) |
| استخدام HTTP/1.1 مع API والإبقاء على الاتصال                                                       | ضروري للنقل التدفقي                                                                               |
| تمرير الاسم العام في `Host`                                                                        | يبني الخادم منه الروابط المطلقة، مثل الروابط في استجابات Git LFS وnpm                             |
| إرسال `X-Forwarded-For` و`X-Forwarded-Proto: https`                                                | عنوان العميل للسجلات وحد تسجيل الدخول، ومخطط الروابط المطلقة                                      |
| استبدال `X-Request-Id` بمعرّف من عنده                                                               | تحتفظ API بمعرّف الوكيل الموثوق. يجب ألا يختاره العميل                                             |
| عدم كتابة سلسلة الاستعلام في سجل الوصول                                                            | تحمل روابط التنزيل سرًا في `?token=`                                                               |
| ضبط `Strict-Transport-Security` بنفسه إذا أردت استخدامه                                            | لا ترسله API إلا من المستمع المدمج                                                                |

### nginx {#nginx}

ضع هذا في سياق `http` لخادم nginx موجود. استبدل الاسم ومسارات الشهادة. يكتب `log_format` المسار من دون سلسلة الاستعلام.

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

مع هذه الإعدادات، أدرج الوكيل في `ARKVORY_TRUSTED_PROXIES`، مثل `127.0.0.1`. يجب إبقاء التوجيه `proxy_set_header X-Request-Id $request_id`: فهو يستبدل معرّفًا قد يرسله العميل.

### Caddy {#caddy}

```caddyfile
arkvory.example.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Request-Id {http.request.uuid}
        flush_interval -1
    }
}
```

يحصل Caddy على الشهادة بنفسه وينقل أجسام الطلبات تدفقيًا، ولا يفرض حدًا لحجم الجسم أو مهلة للاتصال بالخادم الخلفي افتراضيًا، ويضبط `X-Forwarded-For` و`X-Forwarded-Proto` و`X-Forwarded-Host`. لا يكتب Caddy سجل وصول ما لم تفعّل `log`. إذا فعّلته، فأزل سلسلة الاستعلام من العنوان المسجّل.

### IIS والوكلاء الآخرون {#iis}

الإعداد المرجعي للمشروع هو ملف nginx أعلاه. هذه الإعدادات المكافئة لـIIS مع Application Request Routing وURL Rewrite. لا يختبرها المشروع. تحقق من الأسماء وفق إصدار IIS لديك.

- ارفع مهلة وكيل الخادم إلى 1900 ثانية على الأقل، واضبط عتبة التخزين المؤقت للاستجابة على `0`.
- ارفع `maxAllowedContentLength` في تصفية الطلبات إلى قيمته القصوى، 4 294 967 295 بايت. لا يستطيع IIS قبول جسم طلب بحجم 4 GiB أو أكثر، لذا يفشل رفع ملف بهذا الحجم بطلب `curl -T` واحد. يرسل `arkvoryctl` الملفات الكبيرة في أجزاء.
- أرسل المضيف الأصلي و`X-Forwarded-Proto: https` وعنوان العميل في `X-Forwarded-For`. اضبط `X-Request-Id` جديدًا في قاعدة URL Rewrite.
- استبعد سلسلة الاستعلام من سجل IIS.

### الوكلاء الموثوقون {#trusted-proxies}

يقبل `ARKVORY_TRUSTED_PROXIES` حتى 32 عنوانًا أو نطاق CIDR، مفصولة بفواصل. تُرفض أسماء المضيفين والمحارف البديلة. لا يُسمح إلا لطلب قادم من أحد هذه العناوين بتعيين:

- عنوان العميل بواسطة `X-Forwarded-For`. تأخذ API أقرب عنوان غير موثوق،
- معرّف الطلب بواسطة `X-Request-Id`،
- مضيف الروابط المطلقة بواسطة `X-Forwarded-Host`.

من دون القائمة، يظهر كل عميل كأنه قادم من عنوان الوكيل. يحسب حد تسجيل الدخول عندئذ جميع الأشخاص عميلًا واحدًا، ويُظهر سجل الوصول عنوان الوكيل في `clientIp`. لا تدرج إلا وكلاء تتحكم فيهم.

على مضيف Compose، قد ترى API الوكيل بعنوان بوابة شبكة Compose بدلًا من `127.0.0.1`. أرسل طلبًا واحدًا عبر الوكيل، واعثر على `clientIp` في سجل `http.access` داخل سجل API، وأدرج ذلك العنوان.

عدّل `config/runtime.json` وأعد تشغيل الخدمات. راجع [تطبيق تغيير](./configuration#apply-change).

```json
{ "ARKVORY_TRUSTED_PROXIES": "127.0.0.1,::1" }
```

عندما تستمع API على عنوان غير عنوان الاسترجاع المحلي، ومن دون TLS ووكيل موثوق، تسجّل `http.plaintext_exposed` عند البدء. لا يؤدي إعداد الوكيل الصحيح إلى هذا التحذير.

## وحدة التحكم وعنوان API الخاص بها {#console-api-address}

تستخدم وحدة التحكم التي يقدّمها Arkvory العنوان الذي فُتحت منه. لا تتصل إلا بخادمها: لا تسمح سياسة أمان المحتوى الخاصة بها بأي عنوان آخر. خلف وكيل، تعمل من دون تغييرات على `https://arkvory.example.com/console/`.

لاستضافة وحدة التحكم على خادم ويب آخر، مثلًا بجانب بوابة:

1. انسخ ملفات وحدة التحكم من `releases/<version>/apps/web/public/` ضمن جذر التثبيت إلى الخادم الآخر. قدّمها على المسار `/console/` عبر HTTPS، مع أنواع MIME الصحيحة لـ`.js` و`.css`. انسخها مجددًا بعد كل تحديث لـArkvory.
2. في `index.html` المنسوخ، اضبط عنوان Arkvory:

   ```html
   <meta name="arkvory-api-base-url" content="https://arkvory.example.com/" />
   ```

3. إذا كان الخادم الآخر يضبط سياسة أمان محتوى، فاسمح لـ`connect-src` بالاتصال بعنوان Arkvory، واسمح بعامل النص البرمجي المحلي.
4. اسمح بأصل وحدة التحكم في Arkvory. راجع [CORS](#cors).

### CORS {#cors}

اضبط أصول تطبيقات الويب الموجودة على عناوين أخرى في `ARKVORY_CORS_ORIGINS` وأعد تشغيل API.

```json
{ "ARKVORY_CORS_ORIGINS": "https://portal.example.com,https://tools.example.com" }
```

- تتسع القائمة لما يصل إلى 16 أصلًا، يتألف كل منها من مخطط ومضيف ومنفذ اختياري، ومن دون مسار. HTTPS مطلوب. لا يُقبل HTTP غير المشفّر إلا مع `localhost` و`127.0.0.1` و`[::1]`.
- ينطبق CORS على `/api/v1/*` و`/health/ready`. يحصل الطلب القادم من أصل غير مدرج على الحالة 403 مع السبب `origin_not_allowed`. لا يحتاج الطلب القادم من عنوان الخادم نفسه إلى إدخال.
- لا يمنح إدراج الأصل أي حقوق. يظل كل طلب بحاجة إلى مفتاح أو جلسة، ويخضع لفحوص الوصول على الخادم. يرسل تطبيق الويب المفتاح في الترويسة `Authorization`، وليس في ملف تعريف ارتباط.
- الطرق المسموحة هي GET وHEAD وPOST وPUT وPATCH وDELETE. يمكن للمتصفحات تخزين استجابة الطلب التمهيدي مؤقتًا لمدة 10 دقائق.

اختبر طلبًا تمهيديًا. يجب أن تكون الاستجابة بالحالة 204 وأن يظهر أصلك في `Access-Control-Allow-Origin`:

```bash
curl -i -X OPTIONS https://arkvory.example.com/api/v1/auth/me \
  -H 'Origin: https://portal.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

## التحقق من الإعداد {#check}

1. يُرجع `curl https://arkvory.example.com/health/status` الحالة 200 والقيمة `{"status":"ready"}`. ويُتحقق من سلسلة الشهادة من دون استثناءات.
2. افتح وحدة التحكم وسجّل الدخول وارفع ملفًا كبيرًا عبر العنوان نفسه.
3. شغّل `arkvoryctl doctor` بملف تعريف يستخدم عنوان HTTPS. لا توقف التحقق من الشهادة على العملاء: لا يتيح عميل سطر الأوامر ذلك، ولا يقبل HTTP غير المشفّر إلا للحاسوب المحلي. راجع [عميل سطر الأوامر](../protocols/cli).
4. بعد إعادة تشغيل API، لا يحتوي السجل على إدخال `http.plaintext_exposed`.

## استكشاف الأخطاء وإصلاحها {#troubleshooting}

| المشكلة                                                                      | السبب والحل                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPS was not enabled; the previous configuration is restored`              | يأتي السبب بعد ذلك في الرسالة: الملفات ليست PEM، أو المفتاح محمي بكلمة مرور، أو المفتاح لا يطابق الشهادة، أو الشهادة منتهية، أو حساب الخدمة لا يستطيع قراءة ملف. أصلح السبب وشغّل الأمر مجددًا |
| `TLS files must be given as absolute paths`                                  | أدخل مسارات كاملة                                                                                                                                                                            |
| `Built-in TLS is for native installations; use a reverse proxy with Compose` | لا يتضمن Compose دعم TLS مدمجًا. استخدم [وكيلًا عكسيًا](#reverse-proxy)                                                                                                                         |
| الحالة 413 من الوكيل                                                         | حد الجسم منخفض جدًا. استخدم `client_max_body_size 0` في nginx                                                                                                                                 |
| الحالة 502 أو 504، أو انقطاع الرفع بعد دقائق                                 | يخزّن الوكيل الجسم مؤقتًا، أو تقل مهله عن 1900 ثانية                                                                                                                                           |
| تقييد الجميع عند تسجيل الدخول، أو كون `clientIp` هو الوكيل دائمًا             | الوكيل غير مدرج في `ARKVORY_TRUSTED_PROXIES`                                                                                                                                                 |
| روابط في استجابات Git LFS أو npm تُظهر `http` أو اسمًا داخليًا                  | لا يمرّر الوكيل `Host` أو `X-Forwarded-Proto: https`                                                                                                                                          |
| تطبيق متصفح يتلقى 403 `origin_not_allowed`                                   | أضف أصله إلى `ARKVORY_CORS_ORIGINS` وأعد التشغيل                                                                                                                                             |

للمزيد من الإرشادات، راجع [استكشاف الأخطاء وإصلاحها](../operate/troubleshooting) و[الأمان](../operate/security).
