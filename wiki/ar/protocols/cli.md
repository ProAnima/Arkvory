---
title: سطر الأوامر (arkvoryctl)
---

# سطر الأوامر (arkvoryctl)

`arkvoryctl` هو عميل Arkvory البعيد للأشخاص ولـ CI/CD. يرفع وينزّل على أجزاء، ويتابع بعد الانقطاع، ويتحقق من SHA-256. ويعمل بأذونات المفتاح الذي تمنحه إياه.

## التثبيت {#install}

| النظام                                    | الحزمة                      | طريقة التثبيت                                                                                                            |
| ----------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Windows 10/11 وWindows Server 2019+ (x64) | `Arkvory-CLI-Setup-x64.exe` | شغّله. يثبّت للمستخدم الحالي دون صلاحيات المسؤول، ويضيف `arkvoryctl` إلى `PATH` الخاص بالمستخدم. افتح نافذة طرفية جديدة. |
| Debian وUbuntu (x64)                      | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                                               |
| Fedora والتوزيعات المتوافقة مع RHEL (x64) | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                                              |
| أي نظام فيه Node.js 24 (مثل مُشغِّل CI)   | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                           |

تتضمن الحزم الأصلية Node.js الخاص بها. ولا يعتمد الملف المفرد `arkvoryctl.mjs` على أي تبعيات npm. خذ الملفات من إصدار موثوق لـ `ProAnima/Arkvory` وقارن SHA-256 الخاص بها بـ `release-checksums.json`. حزم ARM64 غير متوفرة بعد. وللتحديث، ثبّت إصدارًا مستقرًا أحدث. ولا يحذف إلغاء التثبيت ملفات التعريف (profiles) وملفات المفاتيح ونقاط التحقق (checkpoints) الخاصة بك.

## الاتصال بخادم {#connect-to-a-server}

1. احصل على مفتاح: رمز وصول شخصي من وحدة التحكم، أو مفتاح خدمة من مسؤولك. راجع [الحسابات والمفاتيح](../use/accounts).
2. احفظ المفتاح في ملف خاص خارج أي مستودع. على Linux استخدم الوضع `0600`. وعلى Windows اسمح بالوصول لحسابك فقط.
3. أضف ملف تعريف وتحقق من الاتصال:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

يعرض `doctor` الخادم والمستودع والإمكانات وأذونات المفتاح. ولا يكون المفتاح وسيطًا في الأمر أبدًا.

## ملفات التعريف ومتغيرات البيئة {#profiles-and-environment}

تُخزَّن ملفات التعريف في `profiles.json` ضمن `~/.config/arkvory` (وعلى Windows في `.config\arkvory` داخل مجلد المستخدم). يخزّن ملف التعريف عنوان URL للخادم والمستودع الافتراضي و**مسار** ملف المفتاح، لا المفتاح نفسه.

| الأمر                                                                   | التأثير                                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | يضيف ملف تعريف. يصبح أول ملف تعريف هو الافتراضي. المستودع الافتراضي هو `releases`. |
| `profile list`                                                          | يعرض كل ملفات التعريف والملف النشط                                                 |
| `profile use NAME`                                                      | يجعل ملف تعريف هو الافتراضي                                                        |
| `profile remove NAME`                                                   | يزيل ملف تعريف                                                                     |

| المتغير              | المعنى                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | المفتاح نفسه. له الأولوية على أي ملف.                                                                                            |
| `ARKVORY_TOKEN_FILE` | مسار ملف مفتاح. له الأولوية على ملف المفتاح في ملف التعريف.                                                                      |
| `ARKVORY_BASE_URL`   | عنوان URL للخادم. وعند ضبطه **لا** يُستخدم ملف المفتاح في ملف التعريف: مرّر المفتاح عبر `ARKVORY_TOKEN` أو `ARKVORY_TOKEN_FILE`. |
| `ARKVORY_CLI_HOME`   | مجلد آخر لـ `profiles.json`                                                                                                      |

يجب أن يستخدم عنوان URL للخادم HTTPS. ويُسمح بـ HTTP العادي فقط لـ `localhost` و`127.0.0.1` و`[::1]`. ولا يمكن إيقاف التحقق من TLS.

## الخيارات العامة {#global-options}

| الخيار                     | الافتراضي         | المعنى                                                                                            |
| -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `--profile NAME`           | ملف التعريف النشط | ملف التعريف لهذا الأمر فقط                                                                        |
| `--repository NAME`        | من ملف التعريف    | المستودع لهذا الأمر فقط                                                                           |
| `--json`                   | متوقف             | نتيجة JSON مضغوطة واحدة على stdout؛ والأخطاء بصيغة JSON على stderr                                |
| `--lang en` أو `--lang ru` | من `LANG`         | لغة المساعدة والرسائل                                                                             |
| `--timeout MS`             | 60000             | حد طلبات الإدارة (من 1 إلى 3600000)                                                               |
| `--attempt-timeout MS`     | 120000            | حد محاولة نقل واحدة (من 1 إلى 1800000)                                                            |
| `--retries N`              | 20                | إعادات المحاولة عند أعطال الشبكة لعملية واحدة (من 0 إلى 100)؛ و`0` توقفها                         |
| `--verbose`                | متوقف             | سطر stderr واحد لكل طلب HTTP: الطريقة والمسار والحالة والزمن ومعرّف الطلب. دون ترويسات أو مفاتيح. |
| `--help` و`--version`      |                   | المساعدة؛ وإصدار العميل بصيغة JSON                                                                |
| `--`                       |                   | ينهي الخيارات، لأسماء الملفات التي تبدأ بـ `-`                                                    |

يمكن أن يظهر كل خيار مرة واحدة فقط. وتُرفض الخيارات غير المعروفة.

## الأوامر {#commands}

### الاستكشاف والفهرس {#discovery-and-catalog}

| الأمر                                                                      | النتيجة                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------ |
| `doctor`                                                                   | الاتصال والإمكانات والأذونات                     |
| `repositories [--after CURSOR]`                                            | المستودعات المرئية للمفتاح                       |
| `operations [--after CURSOR]`                                              | عمليات API المتاحة في المستودع                   |
| `list [--after CURSOR]`                                                    | مُخرَجات المستودع                                |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | بحث بالاسم وبنص بيانات التعريف                   |
| `search --metadata-key KEY --metadata-value VALUE`                         | مطابقة دقيقة لبيانات التعريف (مرّر الاثنين معًا) |
| `inspect ID`                                                               | بيانات التعريف لمُخرَج واحد                      |
| `storage usage` / `storage policy`                                         | استخدام المستودع وسياسة التخزين                  |

تعيد الصفحات `next`. مرّره مع `--after` لقراءة الصفحة التالية.

### عمليات النقل {#transfers}

| الأمر                                                                          | النتيجة                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | رفع قابل للاستئناف لأي ملف                                                                     |
| `download ID OUTPUT`                                                           | تنزيل قابل للاستئناف ومتحقَّق منه بـ SHA-256                                                   |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | يرفع الملف ويجعله المراجعة التالية لمسار. وإذا كان المسار يحتوي البايتات نفسها، فلا يُرفع شيء. |
| `get PATH OUTPUT`                                                              | ينزّل المراجعة الحالية لمسار، مع التحقق وإمكانية الاستئناف                                     |
| `link ID [--ttl SECONDS]`                                                      | عنوان تنزيل دون مفتاح، صالح من 60 ثانية إلى 24 ساعة (ساعة واحدة افتراضيًا)                     |
| `uploads status ID` / `uploads cancel ID`                                      | حالة جلسة رفع؛ وإلغاؤها (الإلغاء ليس إيقافًا مؤقتًا)                                           |

يحتوي `METADATA.json` على `labels` و`metadata` (خريطة من النصوص). وله الأولوية على `--label`.

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

رابط التنزيل سر. ولا يمكن إبطاله قبل انتهاء صلاحيته.

### الحزم والترقية {#packages-and-promotion}

| الأمر                                                                                                                 | النتيجة                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | حزم UPack                                               |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | يرفع أرشيف UPack ويسجّله                                |
| `packages register ID`                                                                                                | يسجّل UPack مرفوعًا بالفعل                              |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | يحدد إصدارًا (`--exact` و`--range` يستبعد أحدهما الآخر) |
| `packages download NAME OUTPUT [same filters]`                                                                        | يحدد إصدارًا ثم ينزّله مع التحقق                        |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | ينشر المُخرَج في مستودع آخر دون إرسال البايتات مرة أخرى |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | مراحل المُخرَجات                                        |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | محفوظات الترقية                                         |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

استخدم `--exact` لإصدار محدد بدقة؛ ويطبع `--version` إصدار العميل. راجع [الحزم](../use/packages) و[الترقية](../use/promotion).

### التعليقات التوضيحية والمرفقات {#annotations-and-attachments}

يقرأ `annotations get ID` و`annotations set ID --revision N --file ANNOTATIONS.json` التسميات وبيانات التعريف والتجميعات ويستبدلها. ويفعل `attachments get ID` و`attachments history ID` و`attachments set ID --revision N --file ATTACHMENTS.json` الشيء نفسه للملفات المرتبطة بنسخة بناء. اقرأ أولًا، ثم أرسل الحالة الجديدة الكاملة مع المراجعة التي قرأتها. وأي تغيير متزامن يعيد تعارضًا (رمز الخروج 6).

### النسخ الاحتياطية {#backups}

| الأمر                                                             | النتيجة                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `backup status`                                                   | المخزن والوكيل والخطة وآخر نقطة والتحذيرات؛ ورمز الخروج 9 عند وجود تحذير حرج |
| `backup run`                                                      | يضع مهمة نسخ احتياطي في قائمة الانتظار                                       |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | المهام ونقاط الاستعادة، الأحدث أولًا                                         |
| `backup verify POINT_ID`                                          | يضع تحققًا كاملًا من نقطة في قائمة الانتظار                                  |
| `backup pin POINT_ID [--off]`                                     | يُبقي نقطة بعد انتهاء مدة الاحتفاظ، أو يحرّرها                               |

تحتاج هذه الأوامر إلى مفتاح الملف الخاص بمالك التثبيت (bootstrap) أو إلى جلسة مسؤول حساب. أما الرموز الشخصية ومفاتيح الخدمة فتحصل على 403 (رمز الخروج 3). ويؤدي وكيل النسخ الاحتياطي في الخادم العمل. مثال للمراقبة: `arkvoryctl backup status --json || alert`. راجع [النسخ الاحتياطية](../operate/backups).

## استئناف عمليات النقل المنقطعة {#resume-interrupted-transfers}

بعد Ctrl+C أو عطل في الشبكة، شغّل **الأمر نفسه بالخيارات نفسها** مرة أخرى.

- يحتفظ `upload` و`put` و`packages publish` بنقطة تحقق بجوار الملف المصدر: `<source>.arkvory-upload.json`، أو الملف المعطى بـ `--state`. وتخزّن مفتاح منع التكرار (idempotency key) قبل الطلب الأول، فلا يُنشئ رد مفقود نسخة ثانية أبدًا.
- لنشر البايتات نفسها كمُخرَج **جديد**، استخدم ملف `--state` جديدًا.
- يحتفظ `download` و`get` بـ `<output>.arkvory-part` و`<output>.arkvory-download.json` بجوار الملف الناتج. ولا يظهر الملف النهائي إلا بعد التحقق من SHA-256. ولا يُستبدل ملف ناتج موجود أبدًا.
- في CI، أنشئ مجلد الحالة قبل المهمة واحتفظ به، مع الملف المصدر، بين عمليات إعادة المحاولة.

احتفظ بنقاط التحقق على قرص محلي يدعم الروابط الصلبة (NTFS وext4 وXFS)، لا على FAT أو exFAT أو مشاركات شبكية. وبعد تعطل حاد (hard crash) يبقى ملف `.lock`. تأكد من أن العملية التي يحمل رقمها (PID) قد توقفت، ثم احذف ملف `.lock` فقط.

## مثال CI {#ci-example}

```bash
# The key comes from the CI secret store. Never print it.
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

إذا فشل التسجيل بعد الرفع، يحتوي خطأ JSON على `stage: "register"` وعلى `artifactId`. كرّر الأمر نفسه. فتسجيل المُخرَج نفسه مرة أخرى آمن.

### أنظمة CI {#ci-systems}

تقوم الأنظمة التالية كلها بالأمر نفسه: تثبيت `arkvoryctl.mjs` بإصدار مثبّت، وأخذ المفتاح من مخزن الأسرار في النظام، وتشغيل أمر واحد. ثبّت الإصدار وقيمة SHA-256 حتى تفشل المهمة إذا تغيّر التنزيل. استخدم مفتاح خدمة مقيّدًا بالمستودع وبالإجراءات التي تحتاجها المهمة ([الحسابات والمفاتيح](../use/accounts)). يحتاج الوكيل إلى Node.js 24.

```yaml
# GitHub Actions: .github/workflows/publish.yml
name: publish
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      ARKVORY_BASE_URL: https://arkvory.example
      ARKVORY_TOKEN: ${{ secrets.ARKVORY_KEY }}
      ARKVORY_CLI_VERSION: '0.3.0'
      ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install arkvoryctl
        run: |
          curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
          echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
      - name: Publish the build
        run: node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${GITHUB_REF_NAME}/Game.zip" --json
```

```yaml
# GitLab CI: .gitlab-ci.yml (ARKVORY_TOKEN is a masked CI/CD variable)
publish:
  image: node:24
  variables:
    ARKVORY_BASE_URL: https://arkvory.example
    ARKVORY_CLI_VERSION: '0.3.0'
    ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
  script:
    - curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
    - echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
    - node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${CI_COMMIT_TAG}/Game.zip" --json
```

```groovy
// Jenkins: Jenkinsfile. The agent has Node.js 24 and a checked arkvoryctl.mjs, installed as above.
pipeline {
  agent any
  environment {
    ARKVORY_BASE_URL = 'https://arkvory.example'
    ARKVORY_TOKEN = credentials('arkvory-key')
  }
  stages {
    stage('Publish') {
      steps {
        sh 'node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${BUILD_NUMBER}/Game.zip" --json'
      }
    }
  }
}
```

أي نظام آخر، مثل TeamCity أو Buildkite، يعمل بالطريقة نفسها: اضبط `ARKVORY_BASE_URL` و`ARKVORY_TOKEN` من مخزن الأسرار فيه وشغّل الأمر. احكم على النتيجة من [رمز الخروج](#exit-codes).

## المخرجات {#output}

- النتائج بصيغة JSON على stdout. وبدون `--json` يكون JSON منسّقًا بمسافات بادئة. وتطبع أوامر النسخ الاحتياطي أسطرًا مقروءة ما لم تضف `--json`.
- يظهر التقدم فقط على stderr تفاعلي.
- الخطأ بدون `--json` سطر stderr واحد فيه رمز الخادم والسبب والرسالة والخطوة التالية ومعرّف الطلب. ومع `--json` يحتوي stderr على `{"error": {...}}` مع `code` و`exitCode` و`status` و`serverCode` و`reason` و`requestId` و`retryAfterSeconds`. قرّر بحسب `exitCode` عندما يكون الرمز غير معروف.

## رموز الخروج {#exit-codes}

| الرمز | المعنى                                                                            |
| ----- | --------------------------------------------------------------------------------- |
| 0     | نجاح                                                                              |
| 2     | وسائط أو إعداد خاطئ                                                               |
| 3     | لا يوجد مفتاح، أو الوصول مرفوض (401 و403)                                         |
| 4     | خطأ في HTTP أو الشبكة، أو انتهاء مهلة، أو انشغال الخادم، أو عدم العثور على العنصر |
| 5     | فشل في السلامة (عدم تطابق SHA-256، و422 `integrity_mismatch`)                     |
| 6     | تعارض: المراجعة أو الحالة أو القفل أو ملف موجود أو نقطة تحقق تغيّرت (409)         |
| 7     | خطأ في ملف محلي أو رد خادم غير صالح                                               |
| 8     | بلوغ حد سعة الخادم: الحصة أو القرص أو قائمة الانتظار (507 `capacity_exceeded`)    |
| 9     | `backup status`: يوجد تحذير حرج نشط للنسخ الاحتياطي                               |
| 130   | قوطع التنفيذ                                                                      |

يعيد العميل المحاولة فقط عند أعطال الشبكة وأخطاء HTTP 408 و429 و502 و503 و504، ضمن حد `--retries`.

## استكشاف الأخطاء وإصلاحها {#troubleshooting}

| الرسالة                                 | السبب والحل                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `credential_required` (الخروج 3)        | لم يُعثر على مفتاح. تحقق من `--token-file` أو `ARKVORY_TOKEN_FILE`، أو اضبط المفتاح عند استخدام `ARKVORY_BASE_URL`.  |
| `forbidden` (الخروج 3)                  | المفتاح لا يملك الإذن. شغّل `doctor` لعرض الأذونات.                                                                  |
| `checkpoint_mismatch` (الخروج 6)        | الملف أو الخادم أو المستودع أو الخيارات تختلف عن نقطة التحقق المحفوظة. استخدم الخيارات الأصلية، أو `--state` جديدًا. |
| `state_locked` (الخروج 6)               | عملية أخرى تستخدم نقطة التحقق، أو بقي ملف `.lock` قديم بعد تعطل.                                                     |
| `destination_exists` (الخروج 6)         | ملف الإخراج موجود. اختر اسمًا آخر.                                                                                   |
| `revision_mismatch` في `put` (الخروج 6) | غيّر شخص ما المسار في الأثناء. افحص محفوظات المسار ثم قرّر.                                                          |
| الخروج 8                                | الحصة أو القرص ممتلئ. اسأل المسؤول.                                                                                  |

## صفحات ذات صلة {#related-pages}

- [العملاء والبروتوكولات](./index)
- [النقل](../use/transfers) و[الملفات حسب المسار](../use/files)
- [TypeScript SDK](./sdk)
- [الأخطاء](../api/errors)
