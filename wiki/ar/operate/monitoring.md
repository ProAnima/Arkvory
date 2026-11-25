---
title: المراقبة
description: نقاط نهاية الصحة والمقاييس والسجلات وتشخيصات وحدة التحكم وقائمة تنبيهات مقترحة لخادم Arkvory.
---

# المراقبة

يقدم Arkvory أربعة مصادر للمعلومات: نقاط نهاية للصحة تجيب عن «هل يعمل؟»، ومقاييس Prometheus، وأسطر سجل JSON، وتشخيصات وحدة التحكم. تسرد هذه الصفحة محتوى كل مصدر، وتنتهي بمجموعة تنبيهات للبدء بها.

تصف المقاييس ونقاط نهاية الصحة وأحداث السجل عملية API واحدة. ليس للعامل ووكيل النسخ الاحتياطي منفذ HTTP. يمكنك متابعتهما من خلال أسطر السجل ومقاييس طابور الإكمال وحالة النسخ الاحتياطي.

## فحص خادم الآن {#quick-check}

1. استعلم من نقطة نهاية الحالة العامة. لا تحتاج إلى مفتاح:

   ```bash
   curl -fsS http://127.0.0.1:8080/health/status
   ```

   تعني `{"status":"ready"}` مع HTTP 200 أن واجهة API تستطيع الوصول إلى قاعدة بياناتها ودليل تخزينها.

2. اطلب استجابة الجاهزية الكاملة بمفتاح الصحة الذي أنشأه برنامج التثبيت:

   ```bash
   sudo sh -c 'curl -fsS -H "Authorization: Bearer $(cat /opt/proanima-arkvory/config/health-token.txt)" http://127.0.0.1:8080/health/ready'
   ```

   ```powershell
   $root = 'C:\ProgramData\ProAnima\Arkvory'
   $key = (Get-Content "$root\config\health-token.txt" -Raw).Trim()
   Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://127.0.0.1:8080/health/ready
   ```

3. افحص النسخ الاحتياطية:

   ```bash
   arkvoryctl backup status
   ```

   يحتاج الأمر إلى مفتاح الاسترداد أو جلسة مسؤول. ويخرج بالرمز 9 عندما يكون تحذير حرج نشطاً. للفحوص دون تدخل، استخدم تنبيهات Prometheus أدناه. انظر [سطر الأوامر](../protocols/cli).

4. افحص الخدمات وأحدث أسطر السجل. انظر [السجلات](#logs).

يطبع `arkvory status --root <root>` الإصدار المثبّت ووضع التثبيت وسياسة التحديث. ولا يفحص الخادم. يعرض `arkvoryctl doctor` الخادم والمستودع والإمكانات وأذونات مفتاح واحد. وهو فحص للعميل وليس فحص صحة.

## الصحة والجاهزية {#health}

تجيب ثلاث نقاط نهاية على منفذ API. لا تُحتسب أي منها ضمن ميزانية الطلبات `ARKVORY_MAX_REQUESTS`، لذلك لا يجعل حمل النقل الخادم يبدو متوقفاً. وتواصل الثلاث الإجابة أثناء استنزاف الخادم للطلبات قبل التوقف.

| المسار           | المفتاح       | الاستجابة                                                                                                  | الاستخدام                        |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `/health/live`   | لا            | 200 `{"status":"ok"}` ما دامت العملية تستجيب                                                               | فحص العملية                      |
| `/health/status` | لا            | 200 `{"status":"ready"}`، أو 503 `{"status":"unavailable"}` أو `{"status":"draining"}` مع `Retry-After: 2` | موازنات الأحمال وفحوص التوافر    |
| `/health/ready`  | أي مفتاح صالح | 200 بالتفاصيل أدناه، أو 503 مع غلاف الخطأ و`Retry-After`                                                   | فحوص النشر وفحص الصحة في Compose |

تفحص `/health/status` و`/health/ready` ثلاثة أمور: أن تستجيب قاعدة البيانات وتتضمن ترحيلات هذا الإصدار بالضبط، وأن يوجد مجلد `blobs` في دليل التخزين، وأن تظل العملية مالكة لقفل تخزينها. تُخزّن نتيجة `/health/status` مؤقتاً لمدة ثانية واحدة، كي لا تضاعف الفحوص العامة استعلامات قاعدة البيانات. يجيب الخادم الذي يستنزف الطلبات بالحالة `draining` فوراً. وتعيدان أيضاً 503 عند فشل وحدة لا تستطيع العملية الاستغناء عنها (السبب `module_failed`)، وعلى بوابة قراءة عندما تختلف خطة وحداتها عن الخطة التي سجلها الكاتب (السبب `module_plan_mismatch`)؛ انظر [ARKVORY_MODULES_FILE](../reference/environment#core). تشمل المقارنة الوحدات ومصادرها وإعداداتها، ولا تشمل رقم إصدار البرنامج: تبقى بوابة الإصدار السابق جاهزة إلى جانب كاتب محدّث ما دام مخطط قاعدة البيانات لم يتغير.

من دون مفتاح، تعيد `/health/ready` الاستجابة 401. لا يملك مفتاح `deployment-health` الذي ينشئه برنامج التثبيت حقوقاً على المستودعات ولا حقوق مسؤول. يوجد سره في `config/health-token.txt`.

تحتوي استجابة 200 من `/health/ready` على هذه الحقول:

| الحقل             | المعنى                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | دائماً `ready` في استجابة 200                                                                                                                                                                                                                                                                                                                 |
| `writable`        | تكون `false` عندما تقل المساحة الحرة لوحدة التخزين عن `ARKVORY_STORAGE_RESERVE_BYTES`، وعلى بوابة قراءة. وتستمر القراءة في العمل                                                                                                                                                                                                             |
| `replication`     | في [عنقود عالي التوافر](./cluster) فقط: `copies` و`required` و`singleCopyUntil`، أو `null` عند تعذر قراءة النسخ. تكون `writable` بقيمة `false` عند نقص النسخ                                                                                                                                                                                 |
| `role`            | ‏`api`، أو `reader` لبوابة قراءة                                                                                                                                                                                                                                                                                                             |
| `sharedDownloads` | إيجار بوابة قراءة (`slot` و`slots` و`active` و`leaseSeconds`)، أو `null`                                                                                                                                                                                                                                                                     |
| `transfers`       | لكل من `uploads` و`downloads`: ‏`admission` ‏(`active` و`waiting` و`capacity` و`perPrincipalCapacity` و`waitingCapacity` و`perPrincipalWaitingCapacity` و`timeoutMs` و`rejected` و`timedOut` و`cancelled`) و`bandwidth` ‏(`bytesPerSecond` و`perPrincipalBytesPerSecond` و`burstBytes` و`perPrincipalBurstBytes` و`waiting` و`grantedBytes`) |

لا يعيد فحص جاهزية فاشل وحده تشغيل خدمة أبداً. انظر [الإصلاح الذاتي](./self-healing).

## المقاييس {#metrics}

تعيد `GET /health/metrics` مقاييس عملية API بصيغة Prometheus النصية (الإصدار 0.0.4). يمكن لأي مفتاح صالح قراءتها، وتعمل أثناء استنزاف الخادم للطلبات. أنشئ مفتاح خدمة بأقل الحقوق لجامع المقاييس، واحتفظ به في ملف لا يقرؤه إلا Prometheus.

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

يجب أن يكون اسم المهمة `arkvory`: تختارها قواعد التنبيه المرفقة بالاسم.

تخص القيم العملية وتبدأ من الصفر بعد إعادة التشغيل. وتتغير `arkvory_process_start_time_seconds` عند حدوث ذلك. التسميات محدودة: `route` هو قالب المسار وليس عنوان URL أبداً، و`status_class` يكون `2xx` أو `5xx` وهكذا.

| المقياس                                                                                            | التسميات                                                                | المعنى                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arkvory_http_requests_total`                                                                      | `method` و`route` و`status_class`                                       | الاستجابات المغلقة                                                                                                                                                                             |
| `arkvory_http_request_duration_seconds`                                                            | نفسها                                                                   | مدرّج تكراري للمدة من 5 مللي ثانية إلى 1800 ثانية. يشمل عمليات النقل المجهضة                                                                                                                    |
| `arkvory_http_request_bytes_total` و`arkvory_http_response_bytes_total`                            | `method` و`route`                                                       | بايتات المقبس، بما فيها الترويسات                                                                                                                                                              |
| `arkvory_http_requests_in_flight`                                                                  |                                                                         | الطلبات المقبولة التي ما زالت استجاباتها مفتوحة                                                                                                                                                |
| `arkvory_transfer_active` و`arkvory_transfer_queue_depth`                                          | `direction`                                                             | عمليات النقل المقبولة وعمليات النقل التي تنتظر موضعاً                                                                                                                                           |
| `arkvory_transfer_admission_failures_total`                                                        | `direction` و`reason`                                                   | عمليات النقل التي رفضها نظام القبول: `rejected` (الطابور ممتلئ) و`timed_out` و`cancelled`                                                                                                      |
| `arkvory_download_sessions_active` و`arkvory_download_sessions_waiting`                            | `class`                                                                 | جلسات التنزيل التي تحجز موضعاً؛ والجلسات المنتظرة حسب الفئة                                                                                                                                     |
| `arkvory_download_queue_oldest_wait_seconds`                                                       |                                                                         | مدة انتظار التنزيل الأطول انتظاراً                                                                                                                                                              |
| `arkvory_download_session_events_total`                                                            | `event`                                                                 | جلسات التنزيل: `admitted` و`queued` و`completed` و`released` بعد توقف مؤقت، و`yielded` عند حد نطاق، والمسقطة بوصفها `no_show`، والمرفوضة لتجاوز الحد بوصفها `refused`                          |
| `arkvory_completion_jobs`                                                                          | `state` ‏(`queued` و`running`)                                          | مهام إكمال الرفع في قاعدة البيانات                                                                                                                                                             |
| `arkvory_completion_oldest_queued_seconds`                                                         |                                                                         | مدة انتظار أقدم مهمة قابلة للتنفيذ في الطابور                                                                                                                                                  |
| `arkvory_diagnostic_records_total`                                                                 | `outcome` ‏(`written` و`dropped` و`truncated` و`oversized`)             | أسطر السجل حسب النتيجة                                                                                                                                                                         |
| `arkvory_metrics_collection_failures_total`                                                        | `collector` ‏(`jobs` و`backup` و`mirror` و`webhook` و`fleet` و`events`) | القراءات الفاشلة للمقاييس المعتمدة على قاعدة البيانات                                                                                                                                          |
| `arkvory_backup_last_success_timestamp_seconds`                                                    |                                                                         | وقت لقطة أحدث نقطة نسخ احتياطي مكتملة                                                                                                                                                          |
| `arkvory_backup_agent_last_seen_timestamp_seconds`                                                 |                                                                         | آخر نبضة حياة لوكيل النسخ الاحتياطي                                                                                                                                                            |
| `arkvory_backup_warnings`                                                                          | `code`                                                                  | ‏1 أثناء نشاط التحذير، و0 بخلاف ذلك                                                                                                                                                            |
| `arkvory_mirror_last_sync_timestamp_seconds` و`arkvory_mirror_last_check_timestamp_seconds`        | `repository` و`mode`                                                    | آخر لحاق بالمصدر وآخر قراءة لتدفق تغييراته                                                                                                                                                     |
| `arkvory_mirror_failing`                                                                           | `repository` و`mode`                                                    | ‏1 إذا فشلت محاولة المزامنة الأخيرة                                                                                                                                                            |
| `arkvory_mirror_conflicts`                                                                         | `repository` و`mode`                                                    | إدخالات المصدر الموضوعة جانباً بسبب تعارض بينما تستمر مزامنة البقية                                                                                                                             |
| `arkvory_webhook_failing` و`arkvory_webhook_last_success_timestamp_seconds`                        | `subscription` و`repository`                                            | تسليم webhook: ‏1 إذا فشلت المحاولة الأخيرة، ووقت آخر استجابة `2xx`                                                                                                                            |
| `arkvory_events_head_position` و`arkvory_events_oldest_position`                                   |                                                                         | أحدث موضع في تدفق الأحداث وأدنى مؤشر ما زال يقبله                                                                                                                                              |
| `arkvory_events_unsequenced_age_seconds`                                                           |                                                                         | عمر أقدم حدث ما زال ينتظر ترقيم العامل له؛ و0 إذا لم ينتظر أي حدث                                                                                                                              |
| `arkvory_events_pruned_total`                                                                      |                                                                         | الأحداث التي أزالها الاحتفاظ منذ آخر استعادة                                                                                                                                                   |
| `arkvory_tls_certificate_expiry_timestamp_seconds`                                                 |                                                                         | انتهاء صلاحية شهادة HTTPS المدمجة. يوجد فقط مع HTTPS المدمج                                                                                                                                    |
| `arkvory_build_info`                                                                               | `service` و`version`                                                    | دائماً 1                                                                                                                                                                                        |
| `arkvory_module_info`                                                                              | `module` و`kind` و`source`                                              | دائماً 1 لكل وحدة لهذه العملية: وحدة تشغّلها، أو وحدة موقّعة فشلت أو رُفضت؛ ولا توجد سلسلة مقاييس للوحدة المعطّلة                                                                                   |
| `arkvory_module_up`                                                                                | `module`                                                                | ‏1 عندما تبلغ الوحدة عن `ok`، و0 عند تدهور حالتها أو فشلها أو عدم تحميل وحدة موقّعة                                                                                                             |
| `arkvory_storage_backend_up`                                                                       | `backend`                                                               | ‏1 عندما تكون وحدة تخزين هذه العملية مفتوحة وتستجيب، و0 عندما تكون غير متاحة أو معطّلة. انظر [عدة وحدات تخزين](./storage#volumes)                                                               |
| `arkvory_storage_backend_accepting`                                                                | `backend`                                                               | ‏1 عندما تقبل وحدة التخزين عمليات رفع جديدة، و0 عندما تذهب العمليات الجديدة إلى `default` بدلاً منها                                                                                            |
| `arkvory_storage_placement_fallback_total`                                                         | `backend` و`reason`                                                     | عمليات الرفع الجديدة المنشأة في `default` لأن وحدة التخزين المختارة بالتوزيع لم تقبل البيانات؛ يكون `reason` أحد `not_accepting` أو `read_only` أو `disabled` أو `unavailable` أو `not_loaded` |
| `arkvory_storage_backend_unconfigured`                                                             | `backend`                                                               | ‏1 لوحدة احتفظت ببيانات التثبيت ولم تعد مضبوطة في الإعدادات. لا يمكن قراءة ملفاتها أو تنظيفها أو نسخها احتياطياً                                                                                |
| `arkvory_process_start_time_seconds` و`arkvory_process_resident_memory_bytes`                      |                                                                         | وقت البدء والذاكرة المقيمة                                                                                                                                                                     |
| `arkvory_database_pool_connections` و`arkvory_database_pool_idle` و`arkvory_database_pool_waiting` | `pool` ‏(`queries` و`sessions` و`locks` و`module-readers`)              | اتصالات تجمّع قاعدة البيانات: المفتوحة والخاملة والمستدعون المنتظرون؛ استمرار الانتظار فوق الصفر طويلاً يعني أن التجمّع صغير جداً                                                                  |
| `arkvory_fleet_site_up`                                                                            | `site` و`name`                                                          | على المركز المتحكم: ‏1 عندما استجابت آخر قراءة للموقع المُدار، و0 بخلاف ذلك                                                                                                                     |
| `arkvory_fleet_site_last_seen_timestamp_seconds`                                                   | `site` و`name`                                                          | على المركز المتحكم: وقت آخر استجابة للموقع المُدار                                                                                                                                              |
| `arkvory_fleet_mirror_lag_changes`                                                                 | `site` و`repository`                                                    | على المركز المتحكم: عدد التغييرات التي تتأخر بها مرآة موقع مُدار عن مصدرها، وفق آخر تقرير للموقع ما دام لا يستجيب                                                                               |
| `arkvory_fleet_mirror_lag_alert_changes`                                                           |                                                                         | على المركز المتحكم: ‏`ARKVORY_FLEET_LAG_ALERT` (الافتراضي 1000)، وهو التأخر الذي يثير تنبيه المرآة؛ يقارن `ArkvoryFleetMirrorBehind` به                                                        |
| `arkvory_fleet_alerts`                                                                             | `severity` و`kind`                                                      | على المركز المتحكم: تنبيهات صفحة [المواقع](./sites#alerts)، بما فيها هذا التثبيت                                                                                                               |

تُقرأ المقاييس المعتمدة على قاعدة البيانات (الإكمال والنسخ الاحتياطي والمرآة) مرة كل 5 ثوانٍ على الأكثر. عند فشل القراءة، يحذف الخادم هذه المقاييس من الاستجابة بدلاً من عرض قيم قديمة، وتزداد `arkvory_metrics_collection_failures_total`. وتُستثنى مقاييس المواقع المُدارة (`arkvory_fleet_*`): تحتفظ بآخر قراءة للمركز المتحكم، كي لا تعيد قراءة فاشلة ضبط مدة `for` لقواعد تنبيه المواقع.

المئين الـ99 لطلبات التحكم، دون عمليات نقل الملفات:

```text
histogram_quantile(0.99, sum by (le) (rate(arkvory_http_request_duration_seconds_bucket{route!~".*(content|parts).*"}[10m])))
```

لا يصدّر Arkvory المساحة الحرة لوحدة التخزين أو قاعدة البيانات. استخدم `node_exporter` للوحدات و`postgres_exporter` لـPostgreSQL.

## السجلات {#logs}

تكتب واجهة API والعامل ووكيل النسخ الاحتياطي وأدوات الصيانة كائن JSON واحداً في كل سطر إلى الخرج القياسي. لا يكتب الخادم ملفات سجل بنفسه. يجمع مدير الخدمات لمنصتك الأسطر.

| التثبيت                     | مكان القراءة                                                                                                                                                                                                                    | التدوير                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Linux (الحزم و`install.sh`) | ‏`journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. قاعدة البيانات المُدارة هي `arkvory-database`، والمحدّث هو `arkvory-update`                                                                                     | يحدده journald                               |
| Windows                     | ‏`logs\arkvory-api.out.log` و`arkvory-worker.out.log` و`arkvory-backup.out.log` في جذر التثبيت. يذهب خرج الأخطاء إلى ملفات `.err.log` المجاورة لها. يكتب المحدّث في `logs\updater.log`، وتكتب خدمة قاعدة البيانات في `database\` | ‏20 MiB لكل ملف، مع الاحتفاظ بـ5 ملفات قديمة |
| Docker Compose              | ‏`docker logs --tail 100 proanima-arkvory-api-1`، والأمر نفسه مع `-worker-1` و`-backup-1`                                                                                                                                       | ‏20 MiB لكل ملف، و5 ملفات لكل حاوية          |

يؤدي التوقف عن الاستجابة إلى إنهاء العملية مع السجل `process.stalled` على خرج الخطأ القياسي، لذلك افحص أيضاً ملف `.err.log` أو دفتر النظام. انظر [Windows](../install/windows#logs) للملفات الأخرى في `logs\`.

يبدأ كل سطر بالحقول نفسها:

| الحقل                        | القيمة                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `timestamp`                  | وقت UTC بصيغة ISO 8601                                                                                                        |
| `level`                      | ‏`debug` أو `info` أو `warning` أو `error`                                                                                    |
| `service`                    | ‏`api` أو `worker` أو `backup` أو `migrate` أو `gc` أو `scrub`                                                                |
| `version` و`pid` و`hostname` | الإصدار والعملية والمضيف                                                                                                      |
| `component`                  | ‏`api` أو `http` أو `storage` أو `worker` أو `maintenance` أو `backup` أو `mirror` أو `migrate` أو `process` أو `diagnostics` |
| `code`                       | اسم الحدث                                                                                                                     |

تأتي الحقول الأخرى من قائمة ثابتة: المعرّفات (`requestId` و`traceId` و`jobId` و`uploadId` و`artifactId` و`repository` و`principal` و`clientIp` و`client`)، والأرقام (`status` و`durationMs` و`bytesSent` و`bytesReceived` و`attempts`)، وحقول السبب (`errorCode` و`errorName` و`errno` و`sqlstate` و`reason`). يحدد `ARKVORY_LOG_LEVEL` أدنى مستوى يُكتب.

### الأحداث المهمة {#log-events}

| الحدث (`code`)                                                                                        | المستوى                                | المعنى والإجراء الأول                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.listening`                                                                                       | معلومات                                | تقدم واجهة API الطلبات. الحقول `address` و`port` و`tls`                                                                                                                                                                   |
| `startup.failed`                                                                                      | خطأ                                    | لم تبدأ واجهة API. يحدد `reason` السبب. انظر [استكشاف الأخطاء وإصلاحها](./troubleshooting#server-does-not-start)                                                                                                          |
| `worker.unavailable`                                                                                  | خطأ                                    | لم يبدأ العامل أو توقف بخطأ                                                                                                                                                                                               |
| `worker.module_plan_mismatch` و`worker.module_plan_changed`                                           | تحذير أو خطأ                           | يخطط العامل لوحدات تختلف عما سجله الكاتب ولا يأخذ عملاً حتى تتطابق الخطتان؛ أو غيّر الكاتب خطته فيتوقف العامل ليُعاد تشغيله. أعطِ كل عملية ملف `ARKVORY_MODULES_FILE` نفسه                                                    |
| `module.refused` و`module.failed`                                                                     | تحذير (معلومات لوحدة معطّلة)            | رُفضت وحدة موقّعة مثبّتة قبل تشغيل تعليماتها البرمجية، أو فشلت في التحميل أو البدء؛ يحدد `module` اسمها و`errorCode` السبب. انظر [الوحدات](./modules#load)                                                                   |
| `http.plaintext_exposed`                                                                              | تحذير                                  | تستمع واجهة API على عنوان غير عنوان الحلقة المحلية دون TLS ودون وكيل موثوق                                                                                                                                                |
| `http.access`                                                                                         | معلومات                                | سطر واحد لكل طلب مكتمل أو مُجهض                                                                                                                                                                                            |
| رمز خطأ الطلب، مثلاً `unavailable` أو `internal`                                                       | تحذير لاستجابات 4xx وخطأ لاستجابات 5xx | طلب فاشل مع `requestId` و`route` و`status`، ولأخطاء النظام `errorName` أو `errno` أو `sqlstate`                                                                                                                           |
| `upload.input_timeout` و`upload.deadline`                                                             | تحذير                                  | توقفت عملية رفع عن إرسال البيانات، أو استغرقت أكثر من `ARKVORY_UPLOAD_DEADLINE_MS`                                                                                                                                        |
| `api.ownership_lost` و`worker.ownership_lost`                                                         | خطأ                                    | انقطعت جلسة قاعدة البيانات التي تثبت ملكية التخزين. تخرج العملية وتُعاد تشغيلها                                                                                                                                            |
| `process.handles_left`                                                                                | تحذير                                  | أبقى شيء تركته تعليمات وحدة قيد التشغيل عملية متوقفة أو فشلت في البدء حيّة؛ فخرجت رغم ذلك                                                                                                                                  |
| `process.stalled`                                                                                     | خطأ                                    | أنهى مراقب الاستجابة عملية متوقفة عن الاستجابة. الحقل `stalledSeconds`                                                                                                                                                    |
| `process.unhandled`                                                                                   | خطأ                                    | أنهى خطأ غير متوقع العملية                                                                                                                                                                                                |
| `process.watchdog_failed`                                                                             | تحذير                                  | تعذر بدء مراقب الاستجابة. تعمل الخدمة دونه                                                                                                                                                                                |
| `drain.started` و`drain.settled` و`drain.timeout` و`api.stopped`                                      | معلومات أو تحذير                       | توقف سليم. تعني `drain.timeout` أن طلبات قُطعت                                                                                                                                                                             |
| `tls.reloaded` و`tls.reload_failed` و`tls.expiring`                                                   | معلومات أو تحذير                       | أُعيدت قراءة ملفات الشهادة، أو تعذرت قراءتها، أو تنتهي صلاحيتها خلال أقل من 14 يوماً. يتكرر `tls.expiring` مرة يومياً                                                                                                        |
| `completion.completed` و`completion.failed` و`completion.lease_lost` و`completion.attempts_exhausted` | معلومات أو خطأ                         | نتيجة مهمة إكمال رفع، مع `jobId` و`uploadId` و`errorCode`                                                                                                                                                                 |
| `backup.agent.started` و`backup.agent.standby` و`backup.agent.lease_lost`                             | معلومات أو تحذير                       | حالة وكيل النسخ الاحتياطي                                                                                                                                                                                                 |
| `backup.request.failed` و`backup.request.requeued` و`backup.failed`                                   | خطأ أو تحذير                           | فشلت مهمة نسخ احتياطي أو تُشغّل مجدداً. الحقل `errorCode`                                                                                                                                                                    |
| `mirror.step_failed` و`mirror.recovered`                                                              | تحذير أو معلومات                       | فشلت خطوة مزامنة مرآة (`errorCode` و`attempts`)، أو عادت للعمل                                                                                                                                                            |
| `mirror.conflict_set_aside` و`mirror.conflict_resolved`                                               | تحذير أو معلومات                       | وضعت مرآة إدخالاً من مصدرها جانباً بسبب تعارض، أو أعادت محاولته دون جدوى (`artifactId` و`action` و`errorCode` و`attempts`)؛ أو حُلّ الإدخال                                                                                   |
| `webhook.step_failed` و`webhook.recovered`                                                            | تحذير أو معلومات                       | فشل تسليم webhook ‏(`subscription` و`errorCode` و`attempts`)، أو عاد للعمل                                                                                                                                                |
| `events.step_failed` و`events.recovered` و`events.pruned`                                             | تحذير أو معلومات                       | تعذر على العامل ترقيم الأحداث أو إزالتها (`errorCode` و`attempts`)، أو عاد للعمل، أو أزال أحداثاً قديمة (`rows`)                                                                                                           |
| `tree.index_built` و`tree.index_unavailable` و`tree.index_failed` و`tree.pass_failed`                 | معلومات أو تحذير                       | قرأ العامل جدول محتويات أرشيف (`entries`)، أو لا يستطيع فهرسته (`reason`)، أو فشل وسيحاول لاحقاً (`errorCode` و`attempts` و`retryInSeconds`)، أو تعذر عليه تنفيذ دورة. انظر [أشجار الأدلة](../use/trees#table-of-contents) |
| `migrate.started` و`migrate.completed` و`migrate.failed`                                              | معلومات أو خطأ                         | ترحيل قاعدة البيانات أثناء تحديث                                                                                                                                                                                          |
| `diagnostics.dropped` و`diagnostics.oversized`                                                        | تحذير                                  | أُسقطت أسطر لأن قارئ السجل بطيء جداً، أو لأن سطراً كان أطول من المسموح                                                                                                                                                       |

لا يبطئ قارئ سجل بطيء عملية نقل أبداً. عندما يُحجب الخرج، يسقط الخادم الأسطر ويعدّها، ويكتب `diagnostics.dropped` مع العدد بعد إتاحة الخرج مجدداً. يُستبدل السطر الأطول من 4096 محرفاً بـ`diagnostics.oversized`. وتُقتطع الحقول النصية عند 256 محرفاً.

### معرّفات الطلبات {#request-ids}

تحمل كل استجابة الترويسة `X-Request-Id`، ويتضمن جسم كل خطأ الحقل `requestId`. توجد القيمة نفسها في سطر `http.access`، وفي سطر الخطأ، وفي أسطر مهمة الإكمال التي بدأها الطلب، وفي سجلات التدقيق. لا يحتاج العميل الذي يبلغ عن مشكلة إلا إلى إعطائك هذه القيمة.

```bash
journalctl -u arkvory-api -u arkvory-worker --since "1 hour ago" -o cat | grep 'REQUEST_ID'
```

```powershell
Select-String -Path "$root\logs\*.log" -Pattern 'REQUEST_ID'
```

خلف وكيل عكسي، لا يقبل الخادم ترويسة `X-Request-Id` الواردة إلا من عنوان في `ARKVORY_TRUSTED_PROXIES`، وفقط إذا كانت قيمة واحدة من 8 إلى 128 محرفاً (أحرف وأرقام و`.` و`_` و`:` و`-`). اجعل الوكيل يستبدل الترويسة، مثلاً باستخدام `proxy_set_header X-Request-Id $request_id;` في nginx. تصبح ترويسة W3C ‏`traceparent` الصالحة من أي عميل هي الحقل `traceId`. وهي للبحث فقط ولا تمنح أي صلاحية أبداً.

### ما لا يُسجل أبداً {#never-logged}

لا يحتوي السجل على كلمات مرور أو مفاتيح أو رموز أو ترويسات `Authorization` أو أجسام طلبات أو سلاسل استعلام أو عناوين URL أو نصوص استثناءات. تحمل روابط التنزيل سراً في سلسلة الاستعلام، لذلك يُسجل قالب المسار فقط. الحقل `reason` هو النص الحر الوحيد. يُنقّح لإخفاء البيانات الحساسة ويُقتطع عند 240 محرفاً. يعرض السطر `principal` (معرّف حساب أو مفتاح) و`clientIp`. تعامل مع السجل بوصفه بيانات شخصية.

تعطل `ARKVORY_ACCESS_LOG=false` تسجيل `http.access`. لا تُسجل أبداً الطلبات الناجحة إلى `/health/live` و`/health/status`. ويخفي المستويان `warning` و`error` أسطر الوصول أيضاً.

## التشخيصات في وحدة التحكم {#console}

يرى المسؤولون حالة الخادم في وحدة التحكم دون استخدام الصدفة. انظر [وحدة تحكم الويب](../guide/console).

| الموضع                           | ما تراه                                                                                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:backups]]                   | يعرض العنوان الحالات [[ui:backupStateOk]] و[[ui:backupStateWarning]] و[[ui:backupStateCritical]]. وأسفله النسخة الاحتياطية [[ui:backupNewest]] و[[ui:backupNextRun]] و[[ui:backupAgent]] و[[ui:backupVault]] وقائمة التحذيرات مع الإجراء المطلوب لكل منها |
| [[ui:updates]]                   | الإصدار المثبّت وأحدث إصدار، ووقت آخر فحص، وحالة محدّث المضيف                                                                                                                                                                                               |
| [[ui:repositoryStorage]] لمستودع | استخدام حصة التخزين بالحالتين [[ui:storageWarning]] و[[ui:storageCritical]]، والقائمة [[ui:storageEvents]]                                                                                                                                                |
| [[ui:serviceAudit]] لحساب خدمة   | من أنشأ أو غيّر أو أصدر أو أبطل ماذا                                                                                                                                                                                                                       |
| بطاقة المستودع                   | الشارة [[ui:mirrorBadge]]، مع الحالة [[ui:mirrorFailing]] عند فشل المزامنة الأخيرة                                                                                                                                                                        |

تحتاج قائمة [[ui:storageEvents]] إلى إذن قراءة التشخيصات. وتتضمن، إلى جانب أحداث أخرى، الطلبات الفاشلة لمفاتيح الخدمة في ذلك المستودع، مع معرّف الطلب والمسار والحالة.

حدود الحصة هي 80 % للتحذير و95 % للحالة الحرجة، ما لم يغيّرها مسؤول. لا توجد حدود تحذير لمستودع بلا حصة.

## تحذيرات التخزين والقرص {#storage}

يحتفظ الخادم بمساحة حرة قدرها `ARKVORY_STORAGE_RESERVE_BYTES` (افتراضياً 1 GiB) على وحدة التخزين لقاعدة البيانات والسجلات والنظام. عند النزول دون هذا الاحتياطي:

- تُبلغ `/health/ready` عن `"writable": false`، لكنها تظل تجيب بـ200.
- تفشل عمليات الرفع بالاستجابة 507 والسبب `storage_full`. تستمر التنزيلات ووحدة التحكم في العمل.

لا يقيس الخادم المساحة الحرة نيابة عنك. راقب وحدة التخزين ووحدة قاعدة البيانات ووحدة النسخ الاحتياطي بأدواتك، وأطلق تنبيهاً قبل بلوغ الاحتياطي. الاحتياطي ليس حصة تخزين. يحدّ `ARKVORY_CAPACITY_BYTES` مجموع المحتوى المحجوز ولا يفحص القرص. انظر [التخزين](./storage).

## صحة النسخ الاحتياطية {#backup-health}

يرسل وكيل النسخ الاحتياطي نبضة حياة مع كل تجديد للإيجار. تحوّل واجهة API نبضة الحياة ومحفوظات مهام النسخ الاحتياطي إلى تحذيرات ذات رموز ثابتة. انظر [النسخ الاحتياطية](./backups) لمعرفة ما يتطلبه كل رمز منك.

| الرمز                                                                           | الخطورة | الشرط                                                                          |
| ------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `agent_offline`                                                                 | حرجة    | لا توجد نبضة حياة منذ 2 دقيقة                                                  |
| `backup_stale`                                                                  | حرجة    | أحدث نقطة أقدم من 26 ساعة والخطة مفعّلة                                         |
| `vault_unavailable`                                                             | حرجة    | وحدة المخزن غير مرتبطة، أو لا تحتوي على `vault.json`، أو لا يمكن الكتابة إليها |
| `verify_failed`                                                                 | حرجة    | فشلت نقطة استعادة في التحقق                                                    |
| `vault_not_configured` و`schedule_disabled` و`no_backup_yet` و`last_run_failed` | تحذير   | لا يوجد مخزن، أو الخطة معطّلة، أو لم تُنشأ أول نسخة احتياطية، أو فشلت آخر نسخة   |
| `vault_low_space`                                                               | تحذير   | تقل المساحة الحرة للمخزن عن 10 %، أو عن ضعفي البايتات الجديدة في آخر نقطة      |
| `never_deep_verified`                                                           | تحذير   | لم يُجر تحقق كامل منذ أكثر من 8 أيام                                            |

يحمل المقياس `arkvory_backup_warnings` الرموز نفسها. ويُحسب عمر النسخة الاحتياطية من وقت لقطتها، لا من لحظة اكتمالها.

## تنبيهات مقترحة {#alerts}

يحتوي الإصدار على قواعد Prometheus جاهزة في `releases/<version>/deploy/monitoring/arkvory-alerts.yml`. أضف الملف إلى `rule_files` في `prometheus.yml`. الحدود نقاط بداية. اضبطها وفق حركة المرور التي تقيسها.

| التنبيه                                                         | الشرط                                                                                        | الخطورة     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------- |
| `ArkvoryDown`                                                   | يفشل جمع المقاييس لمدة 2 دقيقة                                                               | حرجة        |
| `ArkvoryHighServerErrorRate`                                    | أكثر من 5 % من الاستجابات هي 5xx لمدة 10 دقائق                                               | تحذير       |
| `ArkvorySlowMetadataRequests`                                   | يتجاوز المئين الـ99 لطلبات التحكم 2 ثانية لمدة 15 دقيقة                                      | تحذير       |
| `ArkvoryCompletionBacklog`                                      | تنتظر أقدم مهمة إكمال في الطابور أكثر من 10 دقائق                                            | تحذير       |
| `ArkvoryTransferAdmissionRejections`                            | أكثر من 0.1 عملية نقل مرفوضة أو منتهية المهلة في الثانية لمدة 15 دقيقة                       | تحذير       |
| `ArkvoryDiagnosticsDropped`                                     | أُسقطت أسطر سجل خلال آخر 15 دقيقة                                                             | تحذير       |
| `ArkvoryMetricsCollectionFailing`                               | تعذرت قراءة مقياس معتمد على قاعدة البيانات                                                   | تحذير       |
| `ArkvoryTlsCertificateExpiring` و`ArkvoryTlsCertificateExpired` | تنتهي صلاحية الشهادة المدمجة خلال أقل من 14 يوماً، أو انتهت بالفعل                            | تحذير، حرجة |
| `ArkvoryBackupStale`                                            | أحدث نقطة أقدم من 26 ساعة                                                                    | حرجة        |
| `ArkvoryBackupAgentOffline`                                     | غياب نبضة الحياة لأكثر من 2 دقيقة، واستمرار الحالة لمدة 5 دقائق                              | حرجة        |
| `ArkvoryBackupWarning`                                          | ‏`vault_unavailable` أو `verify_failed` لمدة 10 دقائق                                        | حرجة        |
| `ArkvoryMirrorStale`                                            | لم تلحق مرآة بمصدرها منذ ساعة                                                                | تحذير       |
| `ArkvoryMirrorFailing`                                          | فشلت آخر مزامنة لمرآة، واستمرت الحالة لمدة 15 دقيقة                                          | تحذير       |
| `ArkvoryMirrorConflicts`                                        | لدى مرآة إدخالات من مصدرها موضوعة جانباً، لمدة 30 دقيقة                                       | تحذير       |
| `ArkvoryRestartLoop`                                            | أُعيد تشغيل عملية API عدد 3 مرات أو أكثر خلال 30 دقيقة                                        | تحذير       |
| `ArkvoryWebhookFailing`                                         | استمر فشل تسليم webhook لمدة 15 دقيقة                                                        | تحذير       |
| `ArkvoryEventSequencerStalled`                                  | انتظر حدث أكثر من 2 دقيقة ليُرقمه العامل                                                      | تحذير       |
| `ArkvoryFleetSiteDown`                                          | لا يجيب موقع مُدار المركز المتحكم لمدة 5 دقائق                                                | حرجة        |
| `ArkvoryFleetMirrorBehind`                                      | تأخر مرآة موقع مُدار يساوي `ARKVORY_FLEET_LAG_ALERT` (افتراضياً 1000) أو يتجاوزه لمدة 30 دقيقة | تحذير       |
| `ArkvoryFleetCritical`                                          | تعرض صفحة المواقع للمركز المتحكم تنبيهات حرجة لمدة 5 دقائق                                   | حرجة        |
| `ArkvoryStorageVolumeUnconfigured`                              | وحدة تحتوي على بيانات مفقودة من الإعدادات لمدة 10 دقائق                                      | حرجة        |

أضف هذه التنبيهات بنفسك، لأن Arkvory لا يصدّر بياناتها:

| التنبيه                                                       | المصدر                       | السبب                                                             |
| ------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| المساحة الحرة لوحدات التخزين وقاعدة البيانات والنسخ الاحتياطي | `node_exporter`              | يوقف القرص الممتلئ عمليات الرفع وقاعدة البيانات والنسخ الاحتياطية |
| PostgreSQL متوقف أو لديه اتصالات كثيرة جداً                    | `postgres_exporter`          | تخرج واجهة API وتُعاد تشغيلها أثناء غياب قاعدة البيانات            |
| الحالة العامة ليست `ready`                                    | فحص خارجي لـ`/health/status` | مسار الشبكة والوكيل والشهادة كما يراها العميل                     |

للوحدات وPostgreSQL، يحتوي الإصدار على قواعد جاهزة لـ`node_exporter` و`postgres_exporter` في `deploy/monitoring/arkvory-host-alerts.yml`. استبدل تعبيرات `mountpoint` بوحداتك قبل تحميل الملف.

اختبر التنبيه مرة واحدة. مثلاً، أوقف `arkvory-backup`: ينطلق `ArkvoryBackupAgentOffline` بعد نحو 7 إلى 8 دقائق (2 دقيقة دون نبضة حياة، و5 دقائق في القاعدة، إضافة إلى فاصل جمع المقاييس).

## صفحات ذات صلة {#related-pages}

- [الإصلاح الذاتي](./self-healing)
- [استكشاف الأخطاء وإصلاحها](./troubleshooting)
- [النسخ الاحتياطية](./backups)
- [متغيرات البيئة](../reference/environment)
- [الأخطاء](../api/errors)
