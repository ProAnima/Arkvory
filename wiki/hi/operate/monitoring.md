---
title: 'मॉनिटरिंग'
description: 'हेल्थ एंडपॉइंट, मेट्रिक्स, लॉग, कंसोल डायग्नोस्टिक्स और Arkvory सर्वर के लिए सुझाई गई अलर्ट सूची।'
---

# मॉनिटरिंग

Arkvory आपको तथ्यों के चार स्रोत देता है: हेल्थ एंडपॉइंट जो "यह चालू है क्या" का उत्तर देते हैं, Prometheus मेट्रिक्स, JSON लॉग पंक्तियाँ, और कंसोल के डायग्नोस्टिक्स। यह पेज बताता है कि हर स्रोत में क्या है और अंत में शुरू करने के लिए अलर्ट का एक सेट देता है।

मेट्रिक्स, हेल्थ एंडपॉइंट और लॉग इवेंट एक API प्रोसेस का वर्णन करते हैं। वर्कर और बैकअप एजेंट का कोई HTTP पोर्ट नहीं होता। आप उन्हें लॉग पंक्तियों, कंप्लीशन कतार मेट्रिक्स और बैकअप स्थिति के ज़रिए देखते हैं।

## अभी सर्वर जाँचें {#quick-check}

1. सार्वजनिक स्टेटस एंडपॉइंट से पूछें। इसे किसी कुंजी की ज़रूरत नहीं:

   ```bash
   curl -fsS http://127.0.0.1:8080/health/status
   ```

   HTTP 200 के साथ `{"status":"ready"}` का मतलब है कि API अपने डेटाबेस और स्टोरेज डायरेक्टरी तक पहुँचता है।

2. इंस्टॉलर द्वारा बनाई गई हेल्थ कुंजी के साथ पूरा रेडीनेस उत्तर माँगें:

   ```bash
   sudo sh -c 'curl -fsS -H "Authorization: Bearer $(cat /opt/proanima-arkvory/config/health-token.txt)" http://127.0.0.1:8080/health/ready'
   ```

   ```powershell
   $root = 'C:\ProgramData\ProAnima\Arkvory'
   $key = (Get-Content "$root\config\health-token.txt" -Raw).Trim()
   Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://127.0.0.1:8080/health/ready
   ```

3. बैकअप जाँचें:

   ```bash
   arkvoryctl backup status
   ```

   इस कमांड को पुनर्प्राप्ति कुंजी या किसी व्यवस्थापक के सत्र की ज़रूरत होती है। जब कोई गंभीर चेतावनी सक्रिय हो तो यह कोड 9 के साथ बाहर निकलता है। बिना निगरानी वाली जाँचों के लिए नीचे दिए Prometheus अलर्ट इस्तेमाल करें। [कमांड लाइन](../protocols/cli) देखें।

4. सेवाएँ और सबसे नई लॉग पंक्तियाँ जाँचें। [लॉग](#logs) देखें।

`arkvory status --root <root>` इंस्टॉल किया गया संस्करण, इंस्टॉलेशन मोड और अपडेट नीति छापता है। यह सर्वर की जाँच नहीं करता। `arkvoryctl doctor` सर्वर, रिपॉज़िटरी, क्षमताएँ और एक कुंजी की अनुमतियाँ दिखाता है। यह क्लाइंट जाँच है, हेल्थ चेक नहीं।

## हेल्थ और रेडीनेस {#health}

API पोर्ट पर तीन एंडपॉइंट उत्तर देते हैं। इनमें से कोई भी अनुरोध बजट `ARKVORY_MAX_REQUESTS` में नहीं गिना जाता, इसलिए ट्रांसफ़र का भार सर्वर को मृत नहीं दिखा सकता। रोकने से पहले सर्वर के ड्रेन होते समय तीनों उत्तर देते रहते हैं।

| पथ               | कुंजी              | उत्तर                                                                                                           | इसका उपयोग                            |
| ---------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `/health/live`   | नहीं               | 200 `{"status":"ok"}` जब तक प्रोसेस उत्तर देता है                                                               | प्रोसेस जाँच                          |
| `/health/status` | नहीं               | 200 `{"status":"ready"}`, या 503 `{"status":"unavailable"}` या `{"status":"draining"}`, `Retry-After: 2` के साथ | लोड बैलेंसर और अपटाइम प्रोब           |
| `/health/ready`  | कोई भी मान्य कुंजी | नीचे दिए विवरणों के साथ 200, या त्रुटि एनवेलप और `Retry-After` के साथ 503                                       | डिप्लॉयमेंट जाँच और Compose हेल्थ चेक |

`/health/status` और `/health/ready` तीन चीज़ें जाँचते हैं: डेटाबेस उत्तर देता है और उसमें ठीक इसी रिलीज़ के माइग्रेशन हैं, स्टोरेज डायरेक्टरी का `blobs` फ़ोल्डर मौजूद है, और प्रोसेस अब भी अपना स्टोरेज लॉक रखता है। `/health/status` का परिणाम एक सेकंड के लिए कैश होता है, इसलिए सार्वजनिक प्रोब डेटाबेस क्वेरी नहीं बढ़ा सकते। ड्रेन होता सर्वर तुरंत `draining` उत्तर देता है।

बिना कुंजी `/health/ready` 401 लौटाता है। इंस्टॉलर द्वारा बनाई गई कुंजी `deployment-health` के पास न रिपॉज़िटरी अधिकार हैं न व्यवस्थापक अधिकार। उसका सीक्रेट `config/health-token.txt` में है।

`/health/ready` के 200 उत्तर में ये फ़ील्ड होते हैं:

| फ़ील्ड            | अर्थ                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | 200 उत्तर में हमेशा `ready`                                                                                                                                                                                                                                                                                                                   |
| `writable`        | `false` जब स्टोरेज वॉल्यूम की खाली जगह `ARKVORY_STORAGE_RESERVE_BYTES` से कम हो, और रीड गेटवे पर। पढ़ना फिर भी काम करता है                                                                                                                                                                                                                    |
| `replication`     | केवल [उच्च उपलब्धता क्लस्टर](./cluster) में: `copies`, `required` और `singleCopyUntil`, या कॉपी पढ़ी न जा सकें तो `null`। कॉपी कम होने पर `writable` `false` होता है                                                                                                                                                                          |
| `role`            | `api`, या रीड गेटवे के लिए `reader`                                                                                                                                                                                                                                                                                                           |
| `sharedDownloads` | रीड गेटवे की लीज़ (`slot`, `slots`, `active`, `leaseSeconds`), या `null`                                                                                                                                                                                                                                                                      |
| `transfers`       | `uploads` और `downloads` के लिए: `admission` (`active`, `waiting`, `capacity`, `perPrincipalCapacity`, `waitingCapacity`, `perPrincipalWaitingCapacity`, `timeoutMs`, `rejected`, `timedOut`, `cancelled`) और `bandwidth` (`bytesPerSecond`, `perPrincipalBytesPerSecond`, `burstBytes`, `perPrincipalBurstBytes`, `waiting`, `grantedBytes`) |

अकेली विफल रेडीनेस जाँच कभी किसी सेवा को रीस्टार्ट नहीं करती। [स्वतः पुनर्प्राप्ति](./self-healing) देखें।

## मेट्रिक्स {#metrics}

`GET /health/metrics` API प्रोसेस के मेट्रिक्स Prometheus टेक्स्ट फ़ॉर्मैट (संस्करण 0.0.4) में लौटाता है। कोई भी मान्य कुंजी इसे पढ़ सकती है, और यह सर्वर के ड्रेन होते समय भी काम करता है। स्क्रेपर के लिए सबसे कम अधिकारों वाली सेवा कुंजी बनाएँ और उसे ऐसी फ़ाइल में रखें जिसे केवल Prometheus पढ़ता हो।

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

जॉब का नाम `arkvory` होना चाहिए: भेजे गए अलर्ट नियम उसे नाम से चुनते हैं।

मान प्रोसेस के होते हैं और रीस्टार्ट के बाद शून्य से शुरू होते हैं। ऐसा होने पर `arkvory_process_start_time_seconds` बदल जाता है। लेबल सीमित होते हैं: `route` रूट टेम्पलेट है, कभी URL नहीं, और `status_class` `2xx`, `5xx` वगैरह होता है।

| मेट्रिक                                                                                     | लेबल                                                       | अर्थ                                                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `arkvory_http_requests_total`                                                               | `method`, `route`, `status_class`                          | बंद उत्तर                                                                                |
| `arkvory_http_request_duration_seconds`                                                     | वही                                                        | 5 ms से 1800 s तक की अवधि हिस्टोग्राम। रद्द किए गए ट्रांसफ़र भी शामिल हैं                |
| `arkvory_http_request_bytes_total`, `arkvory_http_response_bytes_total`                     | `method`, `route`                                          | सॉकेट बाइट, हेडर सहित                                                                    |
| `arkvory_http_requests_in_flight`                                                           |                                                            | स्वीकृत अनुरोध जिनके उत्तर अभी खुले हैं                                                  |
| `arkvory_transfer_active`, `arkvory_transfer_queue_depth`                                   | `direction`                                                | स्वीकृत ट्रांसफ़र और स्लॉट की प्रतीक्षा करते ट्रांसफ़र                                   |
| `arkvory_transfer_admission_failures_total`                                                 | `direction`, `reason`                                      | एडमिशन द्वारा अस्वीकार किए गए ट्रांसफ़र: `rejected` (कतार भरी), `timed_out`, `cancelled` |
| `arkvory_completion_jobs`                                                                   | `state` (`queued`, `running`)                              | डेटाबेस में अपलोड कंप्लीशन जॉब                                                           |
| `arkvory_completion_oldest_queued_seconds`                                                  |                                                            | सबसे पुराने चलाए जा सकने वाले कतारबद्ध जॉब की प्रतीक्षा                                  |
| `arkvory_diagnostic_records_total`                                                          | `outcome` (`written`, `dropped`, `truncated`, `oversized`) | परिणाम के अनुसार लॉग पंक्तियाँ                                                           |
| `arkvory_metrics_collection_failures_total`                                                 | `collector` (`jobs`, `backup`, `mirror`, `webhook`)        | डेटाबेस-आधारित मेट्रिक्स की विफल पढ़ाई                                                   |
| `arkvory_backup_last_success_timestamp_seconds`                                             |                                                            | सबसे नए पूर्ण बैकअप बिंदु का स्नैपशॉट समय                                                |
| `arkvory_backup_agent_last_seen_timestamp_seconds`                                          |                                                            | बैकअप एजेंट की अंतिम हार्टबीट                                                            |
| `arkvory_backup_warnings`                                                                   | `code`                                                     | चेतावनी सक्रिय होने पर 1, अन्यथा 0                                                       |
| `arkvory_mirror_last_sync_timestamp_seconds`, `arkvory_mirror_last_check_timestamp_seconds` | `repository`, `mode`                                       | स्रोत के साथ अंतिम कैच-अप और उसके फ़ीड की अंतिम पढ़ाई                                    |
| `arkvory_mirror_failing`                                                                    | `repository`, `mode`                                       | अंतिम सिंक्रनाइज़ेशन प्रयास विफल होने पर 1                                               |
| `arkvory_webhook_failing`, `arkvory_webhook_last_success_timestamp_seconds`                 | `subscription`, `repository`                               | वेबहुक डिलीवरी: आख़िरी प्रयास विफल होने तक 1, और आख़िरी `2xx` उत्तर का समय               |
| `arkvory_tls_certificate_expiry_timestamp_seconds`                                          |                                                            | अंतर्निहित HTTPS प्रमाणपत्र की समाप्ति। केवल अंतर्निहित HTTPS के साथ मौजूद               |
| `arkvory_build_info`                                                                        | `service`, `version`                                       | हमेशा 1                                                                                  |
| `arkvory_process_start_time_seconds`, `arkvory_process_resident_memory_bytes`               |                                                            | शुरुआत का समय और रेज़िडेंट मेमोरी                                                        |

डेटाबेस-आधारित मेट्रिक्स (कंप्लीशन, बैकअप, मिरर) अधिकतम हर 5 सेकंड में पढ़े जाते हैं। जब कोई पढ़ाई विफल होती है, तो सर्वर पुराने मान दिखाने के बजाय इन मेट्रिक्स को छोड़ देता है, और `arkvory_metrics_collection_failures_total` बढ़ जाता है।

फ़ाइल ट्रांसफ़र के बिना, कंट्रोल अनुरोधों का 99वाँ पर्सेंटाइल:

```text
histogram_quantile(0.99, sum by (le) (rate(arkvory_http_request_duration_seconds_bucket{route!~".*(content|parts).*"}[10m])))
```

Arkvory स्टोरेज वॉल्यूम या डेटाबेस की खाली जगह एक्सपोर्ट नहीं करता। वॉल्यूम के लिए `node_exporter` और PostgreSQL के लिए `postgres_exporter` इस्तेमाल करें।

## लॉग {#logs}

API, वर्कर, बैकअप एजेंट और रखरखाव टूल हर पंक्ति में एक JSON ऑब्जेक्ट मानक आउटपुट पर लिखते हैं। सर्वर स्वयं लॉग फ़ाइलें नहीं लिखता। आपके प्लेटफ़ॉर्म का सेवा मैनेजर पंक्तियाँ एकत्र करता है।

| इंस्टॉलेशन                     | कहाँ पढ़ें                                                                                                                                                                                                                               | रोटेशन                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Linux (packages, `install.sh`) | `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`। प्रबंधित डेटाबेस `arkvory-database` है, अपडेटर `arkvory-update`                                                                                                         | journald द्वारा सेट                               |
| Windows                        | इंस्टॉलेशन रूट में `logs\arkvory-api.out.log`, `arkvory-worker.out.log`, `arkvory-backup.out.log`। त्रुटि आउटपुट उनके पास वाली `.err.log` फ़ाइलों में जाता है। अपडेटर `logs\updater.log` लिखता है, डेटाबेस सेवा `database\` में लिखती है | प्रति फ़ाइल 20 MiB, 5 पुरानी फ़ाइलें रखी जाती हैं |
| Docker Compose                 | `docker logs --tail 100 proanima-arkvory-api-1`, और वही `-worker-1` तथा `-backup-1` के लिए                                                                                                                                               | प्रति फ़ाइल 20 MiB, प्रति कंटेनर 5 फ़ाइलें        |

हैंग प्रोसेस को मानक त्रुटि पर `process.stalled` रिकॉर्ड के साथ समाप्त कर देता है, इसलिए `.err.log` फ़ाइल या जर्नल में भी देखें। `logs\` में मौजूद अन्य फ़ाइलों के लिए [Windows](../install/windows#logs) देखें।

हर पंक्ति इन्हीं फ़ील्ड से शुरू होती है:

| फ़ील्ड                       | मान                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `timestamp`                  | ISO 8601 में UTC समय                                                                                         |
| `level`                      | `debug`, `info`, `warning` या `error`                                                                        |
| `service`                    | `api`, `worker`, `backup`, `migrate`, `gc` या `scrub`                                                        |
| `version`, `pid`, `hostname` | रिलीज़, प्रोसेस और होस्ट                                                                                     |
| `component`                  | `api`, `http`, `storage`, `worker`, `maintenance`, `backup`, `mirror`, `migrate`, `process` या `diagnostics` |
| `code`                       | इवेंट का नाम                                                                                                 |

अन्य फ़ील्ड एक निश्चित सूची से आते हैं: पहचानकर्ता (`requestId`, `traceId`, `jobId`, `uploadId`, `artifactId`, `repository`, `principal`, `clientIp`), संख्याएँ (`status`, `durationMs`, `bytesSent`, `bytesReceived`, `attempts`) और कारण फ़ील्ड (`errorCode`, `errorName`, `errno`, `sqlstate`, `reason`)। `ARKVORY_LOG_LEVEL` वह निम्नतम स्तर सेट करता है जो लिखा जाता है।

### महत्वपूर्ण इवेंट {#log-events}

| इवेंट (`code`)                                                                                        | स्तर                                 | अर्थ और पहला कदम                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `api.listening`                                                                                       | info                                 | API अनुरोध परोसता है। फ़ील्ड `address`, `port` और `tls`                                                                               |
| `startup.failed`                                                                                      | error                                | API शुरू नहीं हुआ। `reason` कारण बताता है। [समस्या निवारण](./troubleshooting#server-does-not-start) देखें                             |
| `worker.unavailable`                                                                                  | error                                | वर्कर शुरू नहीं हुआ या त्रुटि के साथ रुक गया                                                                                          |
| `http.plaintext_exposed`                                                                              | warning                              | API बिना TLS और बिना भरोसेमंद प्रॉक्सी के नॉन-लूपबैक पते पर सुनता है                                                                  |
| `http.access`                                                                                         | info                                 | प्रत्येक पूर्ण या रद्द अनुरोध के लिए एक पंक्ति                                                                                        |
| किसी अनुरोध का त्रुटि कोड, उदाहरण के लिए `unavailable` या `internal`                                  | 4xx के लिए warning, 5xx के लिए error | `requestId`, `route`, `status` और, सिस्टम त्रुटियों के लिए, `errorName`, `errno` या `sqlstate` वाला विफल अनुरोध                       |
| `upload.input_timeout`, `upload.deadline`                                                             | warning                              | किसी अपलोड ने डेटा भेजना रोक दिया, या उसे `ARKVORY_UPLOAD_DEADLINE_MS` से अधिक समय लगा                                                |
| `api.ownership_lost`, `worker.ownership_lost`                                                         | error                                | स्टोरेज के स्वामित्व को सिद्ध करने वाला डेटाबेस सत्र टूट गया। प्रोसेस बाहर निकलता है और रीस्टार्ट होता है                             |
| `process.stalled`                                                                                     | error                                | वॉचडॉग ने अटके प्रोसेस को समाप्त किया। फ़ील्ड `stalledSeconds`                                                                        |
| `process.unhandled`                                                                                   | error                                | किसी अप्रत्याशित त्रुटि ने प्रोसेस समाप्त किया                                                                                        |
| `process.watchdog_failed`                                                                             | warning                              | वॉचडॉग शुरू नहीं हो सका। सेवा उसके बिना चलती है                                                                                       |
| `drain.started`, `drain.settled`, `drain.timeout`, `api.stopped`                                      | info or warning                      | सुव्यवस्थित रोक। `drain.timeout` का मतलब है कि अनुरोध काट दिए गए                                                                      |
| `tls.reloaded`, `tls.reload_failed`, `tls.expiring`                                                   | info or warning                      | प्रमाणपत्र फ़ाइलें फिर पढ़ी गईं, पढ़ी नहीं जा सकीं, या 14 दिनों से कम में समाप्त हो रही हैं। `tls.expiring` दिन में एक बार दोहराता है |
| `completion.completed`, `completion.failed`, `completion.lease_lost`, `completion.attempts_exhausted` | info or error                        | अपलोड कंप्लीशन जॉब का परिणाम, `jobId`, `uploadId` और `errorCode` के साथ                                                               |
| `backup.agent.started`, `backup.agent.standby`, `backup.agent.lease_lost`                             | info or warning                      | बैकअप एजेंट की स्थिति                                                                                                                 |
| `backup.request.failed`, `backup.request.requeued`, `backup.failed`                                   | error or warning                     | बैकअप जॉब विफल हुआ या फिर चलता है। फ़ील्ड `errorCode`                                                                                 |
| `mirror.step_failed`, `mirror.recovered`                                                              | warning or info                      | मिरर सिंक्रनाइज़ेशन का कोई चरण विफल हुआ (`errorCode`, `attempts`), या फिर काम करता है                                                 |
| `webhook.step_failed`, `webhook.recovered`                                                            | warning or info                      | वेबहुक डिलीवरी विफल हुई (`subscription`, `errorCode`, `attempts`) या फिर से चल रही है                                                 |
| `migrate.started`, `migrate.completed`, `migrate.failed`                                              | info or error                        | अपडेट का डेटाबेस माइग्रेशन                                                                                                            |
| `diagnostics.dropped`, `diagnostics.oversized`                                                        | warning                              | पंक्तियाँ इसलिए छोड़ दी गईं क्योंकि लॉग पाठक बहुत धीमा है, या कोई पंक्ति बहुत लंबी थी                                                 |

एक धीमा लॉग पाठक कभी ट्रांसफ़र धीमा नहीं करता। जब आउटपुट अवरुद्ध होता है, सर्वर पंक्तियाँ छोड़ देता है, उन्हें गिनता है, और आउटपुट फिर खाली होने पर संख्या के साथ `diagnostics.dropped` लिखता है। 4096 वर्णों से लंबी पंक्ति `diagnostics.oversized` से बदल दी जाती है। टेक्स्ट फ़ील्ड 256 वर्णों पर काट दिए जाते हैं।

### अनुरोध ID {#request-ids}

हर उत्तर में हेडर `X-Request-Id` होता है, और हर त्रुटि बॉडी में फ़ील्ड `requestId` होता है। वही मान `http.access` पंक्ति में, त्रुटि पंक्ति में, उस अनुरोध से शुरू हुए कंप्लीशन जॉब की पंक्तियों में, और ऑडिट रिकॉर्ड में होता है। समस्या बताने वाले क्लाइंट को आपको केवल यही मान देना होता है।

```bash
journalctl -u arkvory-api -u arkvory-worker --since "1 hour ago" -o cat | grep 'REQUEST_ID'
```

```powershell
Select-String -Path "$root\logs\*.log" -Pattern 'REQUEST_ID'
```

रिवर्स प्रॉक्सी के पीछे, सर्वर आने वाला `X-Request-Id` केवल `ARKVORY_TRUSTED_PROXIES` के किसी पते से लेता है, और तभी जब वह 8 से 128 वर्णों का एकल मान हो (अक्षर, अंक, `.`, `_`, `:` और `-`)। प्रॉक्सी को यह हेडर अधिलेखित करने दें, उदाहरण के लिए nginx में `proxy_set_header X-Request-Id $request_id;` के साथ। किसी भी क्लाइंट से मान्य W3C `traceparent` हेडर फ़ील्ड `traceId` बन जाता है। यह केवल खोजने के लिए है और कभी कुछ नहीं देता।

### क्या कभी लॉग नहीं होता {#never-logged}

लॉग में पासवर्ड, कुंजियाँ, टोकन, `Authorization` हेडर, अनुरोध बॉडी, क्वेरी स्ट्रिंग, URL या अपवाद टेक्स्ट नहीं होते। डाउनलोड लिंक क्वेरी स्ट्रिंग में एक सीक्रेट रखते हैं, इसलिए केवल रूट टेम्पलेट लॉग होता है। फ़ील्ड `reason` ही एकमात्र खुला टेक्स्ट है। इसे रीडैक्ट किया जाता है और 240 वर्णों पर काटा जाता है। पंक्ति `principal` (किसी खाते या कुंजी की ID) और `clientIp` दिखाती है। लॉग को व्यक्तिगत डेटा मानें।

`ARKVORY_ACCESS_LOG=false` `http.access` बंद कर देता है। `/health/live` और `/health/status` के सफल अनुरोध कभी लॉग नहीं होते। स्तर `warning` और `error` भी एक्सेस पंक्तियाँ छिपा देते हैं।

## कंसोल में डायग्नोस्टिक्स {#console}

व्यवस्थापक बिना शेल के कंसोल में सर्वर की स्थिति देखते हैं। [वेब कंसोल](../guide/console) देखें।

| कहाँ                                        | आप क्या देखते हैं                                                                                                                                                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:backups]]                              | शीर्षक [[ui:backupStateOk]], [[ui:backupStateWarning]] और [[ui:backupStateCritical]] बताता है। नीचे [[ui:backupNewest]] बैकअप, [[ui:backupNextRun]], [[ui:backupAgent]], [[ui:backupVault]] और चेतावनियों की सूची होती है, हर एक के लिए कदम के साथ |
| [[ui:updates]]                              | इंस्टॉल किया गया और नवीनतम संस्करण, अंतिम जाँच का समय, और होस्ट अपडेटर की स्थिति                                                                                                                                                                   |
| किसी रिपॉज़िटरी का [[ui:repositoryStorage]] | स्थितियों [[ui:storageWarning]] और [[ui:storageCritical]] के साथ कोटा का उपयोग, और सूची [[ui:storageEvents]]                                                                                                                                       |
| किसी सेवा खाते का [[ui:serviceAudit]]       | किसने क्या बनाया, बदला, जारी या निरस्त किया                                                                                                                                                                                                        |
| रिपॉज़िटरी कार्ड                            | बैज [[ui:mirrorBadge]], अंतिम सिंक्रनाइज़ेशन विफल होने पर स्थिति [[ui:mirrorFailing]] के साथ                                                                                                                                                       |

सूची [[ui:storageEvents]] के लिए डायग्नोस्टिक्स पढ़ने की अनुमति चाहिए। अन्य इवेंट के साथ उसमें उस रिपॉज़िटरी की सेवा कुंजियों के विफल अनुरोध होते हैं, अनुरोध ID, रूट और स्टेटस के साथ।

कोटा की सीमाएँ चेतावनी के लिए 80 % और गंभीर स्थिति के लिए 95 % हैं, जब तक कोई व्यवस्थापक उन्हें न बदले। बिना कोटा वाली रिपॉज़िटरी की कोई सीमा नहीं होती।

## स्टोरेज और डिस्क चेतावनियाँ {#storage}

सर्वर डेटाबेस, लॉग और सिस्टम के लिए स्टोरेज वॉल्यूम पर `ARKVORY_STORAGE_RESERVE_BYTES` (डिफ़ॉल्ट रूप से 1 GiB) खाली जगह रखता है। इस रिज़र्व से नीचे:

- `/health/ready` `"writable": false` बताता है, लेकिन फिर भी 200 उत्तर देता है।
- अपलोड 507 और कारण `storage_full` के साथ विफल होते हैं। डाउनलोड और कंसोल काम करते रहते हैं।

सर्वर आपके लिए खाली जगह नहीं मापता। स्टोरेज वॉल्यूम, डेटाबेस वॉल्यूम और बैकअप वॉल्यूम पर अपने टूल से नज़र रखें, और रिज़र्व तक पहुँचने से पहले अलर्ट लगाएँ। रिज़र्व कोटा नहीं है। `ARKVORY_CAPACITY_BYTES` आरक्षित सामग्री का योग सीमित करता है और डिस्क जाँच नहीं है। [स्टोरेज](./storage) देखें।

## बैकअप हेल्थ {#backup-health}

बैकअप एजेंट हर लीज़ नवीनीकरण के साथ हार्टबीट भेजता है। API हार्टबीट और बैकअप जॉब के इतिहास को निश्चित कोड वाली चेतावनियों में बदल देता है। हर कोड आपसे क्या चाहता है, यह [बैकअप](./backups) में देखें।

| कोड                                                                             | गंभीरता  | शर्त                                                                                       |
| ------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `agent_offline`                                                                 | critical | 2 मिनट तक कोई हार्टबीट नहीं                                                                |
| `backup_stale`                                                                  | critical | सबसे नया बिंदु 26 घंटे से पुराना है और योजना चालू है                                       |
| `vault_unavailable`                                                             | critical | बैकअप स्टोरेज वॉल्यूम माउंट नहीं है, उसमें `vault.json` नहीं है या उसमें लिखा नहीं जा सकता |
| `verify_failed`                                                                 | critical | कोई पुनर्स्थापना बिंदु अपनी जाँच में विफल हुआ                                              |
| `vault_not_configured`, `schedule_disabled`, `no_backup_yet`, `last_run_failed` | warning  | बैकअप स्टोरेज नहीं, योजना बंद, पहला बैकअप नहीं, अंतिम बैकअप विफल                           |
| `vault_low_space`                                                               | warning  | बैकअप स्टोरेज में 10 % से कम खाली जगह है, या अंतिम बिंदु के नए बाइट के दुगुने से कम        |
| `never_deep_verified`                                                           | warning  | 8 दिनों से अधिक समय तक कोई पूर्ण जाँच नहीं                                                 |

मेट्रिक `arkvory_backup_warnings` वही कोड रखता है। बैकअप की आयु उसके स्नैपशॉट समय से गिनी जाती है, उसके पूरा होने के क्षण से नहीं।

## सुझाए गए अलर्ट {#alerts}

रिलीज़ में `releases/<version>/deploy/monitoring/arkvory-alerts.yml` में तैयार Prometheus नियम हैं। फ़ाइल को `prometheus.yml` में `rule_files` में जोड़ें। सीमाएँ शुरुआती बिंदु हैं। उन्हें अपने मापे गए ट्रैफ़िक के अनुसार समायोजित करें।

| अलर्ट                                                           | शर्त                                                                        | गंभीरता           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------- |
| `ArkvoryDown`                                                   | स्क्रेप 2 मिनट तक विफल रहता है                                              | Critical          |
| `ArkvoryHighServerErrorRate`                                    | 10 मिनट तक 5 % से अधिक उत्तर 5xx हैं                                        | Warning           |
| `ArkvorySlowMetadataRequests`                                   | 15 मिनट तक कंट्रोल अनुरोधों का 99वाँ पर्सेंटाइल 2 s से ऊपर है               | Warning           |
| `ArkvoryCompletionBacklog`                                      | सबसे पुराना कतारबद्ध कंप्लीशन जॉब 10 मिनट से अधिक प्रतीक्षा करता है         | Warning           |
| `ArkvoryTransferAdmissionRejections`                            | 15 मिनट तक प्रति सेकंड 0.1 से अधिक अस्वीकृत या टाइमआउट ट्रांसफ़र            | Warning           |
| `ArkvoryDiagnosticsDropped`                                     | पिछले 15 मिनटों में लॉग पंक्तियाँ छोड़ी गईं                                 | Warning           |
| `ArkvoryMetricsCollectionFailing`                               | कोई डेटाबेस-आधारित मेट्रिक पढ़ी नहीं जा सकी                                 | Warning           |
| `ArkvoryTlsCertificateExpiring`, `ArkvoryTlsCertificateExpired` | अंतर्निहित प्रमाणपत्र 14 दिनों से कम में समाप्त हो रहा है, या समाप्त हो गया | Warning, critical |
| `ArkvoryBackupStale`                                            | सबसे नया बिंदु 26 घंटे से पुराना है                                         | Critical          |
| `ArkvoryBackupAgentOffline`                                     | 2 मिनट से अधिक समय तक कोई हार्टबीट नहीं, 5 मिनट तक                          | Critical          |
| `ArkvoryBackupWarning`                                          | 10 मिनट तक `vault_unavailable` या `verify_failed`                           | Critical          |
| `ArkvoryMirrorStale`                                            | कोई मिरर एक घंटे से अपने स्रोत के साथ कैच-अप नहीं कर पाया                   | Warning           |
| `ArkvoryMirrorFailing`                                          | किसी मिरर का अंतिम सिंक्रनाइज़ेशन 15 मिनट तक विफल रहा                       | Warning           |
| `ArkvoryRestartLoop`                                            | API प्रोसेस 30 मिनट में 3 या अधिक बार रीस्टार्ट हुआ                         | Warning           |
| `ArkvoryWebhookFailing`                                         | वेबहुक डिलीवरी 15 मिनट से विफल हो रही है                                    | Warning           |

ये अलर्ट स्वयं जोड़ें, क्योंकि Arkvory वह डेटा एक्सपोर्ट नहीं करता:

| अलर्ट                                           | स्रोत                           | क्यों                                                               |
| ----------------------------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| स्टोरेज, डेटाबेस और बैकअप वॉल्यूम की खाली जगह   | `node_exporter`                 | भरी डिस्क अपलोड, डेटाबेस और बैकअप रोक देती है                       |
| PostgreSQL बंद है या उसके बहुत अधिक कनेक्शन हैं | `postgres_exporter`             | डेटाबेस के अनुपलब्ध रहने पर API बाहर निकलता है और रीस्टार्ट होता है |
| सार्वजनिक स्टेटस `ready` नहीं है                | `/health/status` का बाहरी प्रोब | क्लाइंट से दिखने वाला नेटवर्क पथ, प्रॉक्सी और प्रमाणपत्र            |

वॉल्यूम और PostgreSQL के लिए रिलीज़ में `node_exporter` और `postgres_exporter` के तैयार नियम `deploy/monitoring/arkvory-host-alerts.yml` में हैं। फ़ाइल लोड करने से पहले `mountpoint` एक्सप्रेशन को अपने वॉल्यूम से बदलें।

किसी अलर्ट को एक बार जाँचें। उदाहरण के लिए, `arkvory-backup` रोकें: `ArkvoryBackupAgentOffline` लगभग 7 से 8 मिनट बाद सक्रिय होता है (2 मिनट बिना हार्टबीट, नियम में 5 मिनट, और स्क्रेप अंतराल)।

## संबंधित पेज {#related-pages}

- [स्वतः पुनर्प्राप्ति](./self-healing)
- [समस्या निवारण](./troubleshooting)
- [बैकअप](./backups)
- [एनवायरनमेंट वेरिएबल](../reference/environment)
- [त्रुटियाँ](../api/errors)
