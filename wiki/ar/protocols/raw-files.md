---
title: الملفات الخام
description: خزّن ملفًا واقرأه حسب مساره بطلب HTTP واحد، باستخدام curl أو wget أو PowerShell، من دون تثبيت أي شيء.
---

# الملفات الخام

يعمل مسار ملف في مستودع مثل ملف على خادم ويب. يخزّن `PUT` الجسم بوصفه الإصدار التالي للمسار. ويُرجع `GET` الإصدار الحالي. استخدم ذلك من نصوص البناء البرمجية ومهام CI التي لا تملك إلا `curl` أو PowerShell.

العنوان نفسه لجميع طرق HTTP الثلاث:

```text
https://<host>/api/v1/repositories/<repository>/raw/<path>
```

مثلًا: `https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe`.

## تخزين ملف {#store-a-file}

تحتاج إلى مستودع ومفتاح بحق الكتابة. راجع [الحسابات والمفاتيح](../use/accounts). أرسل المفتاح بالصيغة `Authorization: Bearer <key>`. لا تقبل الملفات الخام أي نوع آخر من المصادقة.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
URL="https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"

curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$URL"
```

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe'
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

```bash
wget -qO- --method=PUT --body-file=GameSetup.exe \
  --header="Authorization: Bearer $ARKVORY_KEY" "$URL"
```

أعطِ `curl -T` عنوان الملف الكامل، لا عنوان مجلد. رمّز المحارف في المسار التي لا يسمح بها URL: اكتب المسافة `%20`، و`#` بالشكل `%23`، و`?` بالشكل `%3F`.

الاستجابة بصيغة JSON. يُرجع الملف الجديد أو البايتات الجديدة الحالة `201`:

```json
{
  "path": "builds/game/1.4/GameSetup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "00000000-0000-4000-8000-000000000001", "size": "1048576", "sha256": "…" }
}
```

إذا كان المسار يحتوي أصلًا على هذه البايتات بالضبط، تكون الاستجابة `200` مع `"created": false` والمراجعة نفسها. لا يُخزَّن شيء. يمكن لخطوة في مهمة CI العمل مجددًا من دون إنشاء إصدار جديد. و`size` سلسلة من الأرقام العشرية.

### إرسال مجموع اختباري {#send-a-checksum}

أرسل SHA-256 للملف باستخدام `X-Checksum-Sha256`، والطول باستخدام `Content-Length`. يرسل `curl -T` وPowerShell طول الملف. يكتب الخادم عندئذ البايتات مباشرةً في التخزين بمرور واحد ويتحقق منها هناك. يُرجع المجموع الاختباري الخاطئ الحالة `422` مع الرمز `integrity_mismatch`، ولا يخزّن شيئًا، ويُبقي المسار كما كان.

```bash
curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "X-Checksum-Sha256: $(sha256sum GameSetup.exe | cut -d' ' -f1)" \
  "$URL"
```

```powershell
$headers['X-Checksum-Sha256'] = (Get-FileHash .\GameSetup.exe -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

من دون مجموع اختباري، أو مع جسم بترميز النقل المجزّأ لا يملك `Content-Length`، يكتب الخادم الجسم أولًا في ملف مؤقت ويحسب تجزئته. ثم يخزّنه. يحتاج هذا لفترة قصيرة إلى مساحة على قرص الخادم تصل إلى ضعف حجم الملف، وإلى مرور ثانٍ على البايتات. يزيل الخادم الملفات المؤقتة التي خلّفها فشل بعد يوم واحد.

عندما ترسل المجموع الاختباري والطول، ويكون المسار محتويًا أصلًا على هذه البايتات، يستجيب الخادم بالحالة `200` من دون قراءة الجسم، ويغلق الاتصال.

### الإنشاء فقط {#create-only}

يقرأ `PUT` شرطًا واحدًا فقط، هو `If-None-Match: *`. معه، لا يخزّن الخادم الملف إلا إذا لم يكن المسار موجودًا. وإلا يستجيب بالحالة `409` والسبب `already_exists`، حتى عندما تكون البايتات نفسها. تُرجع أي قيمة أخرى لـ`If-None-Match` في `PUT` الحالة `400`.

```bash
curl --fail-with-body -sS -T ./notes.txt \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-None-Match: *" \
  "https://arkvory.example/api/v1/repositories/releases/raw/docs/notes.txt"
```

### كاتبان متزامنان {#two-writers}

عندما يغيّر طلبان المسار نفسه في الوقت نفسه، يفوز الأول. يحصل المتأخر على `409` والسبب `revision_mismatch`، ويحتفظ المسار بمحتوى الفائز. شغّل الطلب مجددًا لإنشاء مراجعة جديدة. تبقى البايتات التي رفعها الخاسر كمُخرَج بلا مسار حتى تزيلها سياسة الاحتفاظ.

## قراءة ملف {#read-a-file}

يُرجع `GET` الإصدار الحالي للمسار. ويُرجع `HEAD` الترويسات فقط.

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $ARKVORY_KEY" -o GameSetup.exe "$URL"
```

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\GameSetup.exe
```

```bash
wget --header="Authorization: Bearer $ARKVORY_KEY" -O GameSetup.exe "$URL"
```

ترويسات الاستجابة:

| الترويسة                | القيمة                                                       |
| ----------------------- | ------------------------------------------------------------ |
| `ETag`                  | `"sha256:<digest>"`: قيمة SHA-256 للمحتوى، بين علامتي اقتباس |
| `Content-Length`        | حجم الملف                                                    |
| `Accept-Ranges`         | `bytes`                                                      |
| `Content-Type`          | دائمًا `application/octet-stream`                             |
| `Content-Disposition`   | `attachment` مع المقطع الأخير من المسار كاسم للملف           |
| `X-Arkvory-Artifact-Id` | معرّف المُخرَج الذي يحتوي على هذا الإصدار                       |

يُرجع المسار غير المعروف `404`.

### النطاقات والطلبات الشرطية {#ranges-and-conditional-requests}

| ترويسة الطلب                | الأثر                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Range: bytes=0-1023`       | `206` مع الجزء المطلوب و`Content-Range`. تُرجع بداية تتجاوز نهاية الملف `416` مع `Content-Range: bytes */<size>`.   |
| `Range: bytes=-1024`        | آخر 1024 بايت                                                                                                      |
| `Range: bytes=1048576-`     | من الإزاحة إلى النهاية                                                                                             |
| `If-Range: "sha256:…"`      | يطبّق `Range` فقط إذا كانت ETag مطابقة لهذه القيمة تمامًا. إذا حصل المسار على إصدار جديد، تتلقى الملف الجديد بأكمله. |
| `If-None-Match: "sha256:…"` | `304` بلا جسم إذا كانت ETag نفسها. يعمل ذلك مع `HEAD` أيضًا.                                                        |

لا يُدعم إلا نطاق واحد لكل طلب. يُرجع الطلب ذو النطاقات المتعددة الملف بأكمله.

يمكن أن يحصل مسار على إصدار جديد في أي وقت، ويحدّد `GET` المسار مجددًا. لمواصلة تنزيل بأمان، احفظ `ETag` للاستجابة الأولى وأرسلها كقيمة `If-Range`:

احفظ `ETag` من طلب `GET` الأصلي في `GameSetup.etag`؛ ولا تحصل على قيمة جديدة باستخدام `HEAD`. يحسب المثال الإزاحة من حجم الملف الجزئي الموجود، ولا يلحق الاستجابة المؤقتة إلا بعد `206`. عند `200` أو فشل الطلب، يبقى الملف الجزئي من دون تغيير: ابدأ تنزيلًا جديدًا بشكل منفصل. تحقّق من SHA-256 النهائي قبل استخدام الملف.

```bash
etag=$(cat GameSetup.etag) || exit 1
test -n "$etag" || exit 1
offset=$(wc -c < GameSetup.part) || exit 1
offset=$(printf '%s' "$offset" | tr -d '[:space:]')
segment=$(mktemp) || exit 1
status=$(curl -fsS -o "$segment" -w '%{http_code}' \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-Range: $etag" \
  -H "Range: bytes=$offset-" "$URL") || {
  rm -f "$segment"
  exit 1
}
if [ "$status" != 206 ]; then
  rm -f "$segment"
  exit 1
fi
cat "$segment" >> GameSetup.part
result=$?
rm -f "$segment"
test "$result" -eq 0
```

لتخطي التنزيل عندما لا يتغير الملف، أرسل ETag التي خزّنتها آخر مرة:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ARKVORY_KEY" \
  -H 'If-None-Match: "sha256:<digest>"' "$URL"
```

للملفات الكبيرة، ينزّل [`arkvoryctl get`](./cli) مع الاستئناف ويتحقق من SHA-256 نيابةً عنك.

## المسارات والإصدارات {#paths-and-versions}

الملف الخام هو [ملف حسب المسار](../use/files). يضيف كل `PUT` ببايتات جديدة مراجعة إلى المسار: المراجعة 1 ثم 2 ثم 3 وهكذا. تبقى المراجعات السابقة. لا تُستبدل البايتات أبدًا، لأن كل مراجعة تشير إلى مُخرَج خاص بها غير قابل للتغيير، يحمل اسم المقطع الأخير من المسار.

- يُرجع `GET` على عنوان الملف الخام المراجعة الحالية دائمًا.
- لرؤية جميع مراجعات مسار، اقرأ محفوظاته: [`getAssetHistory`](../api/reference/files#getAssetHistory)، أو [[ui:history]] في وحدة التحكم.
- لقراءة مراجعة أقدم، يُرجع [`getAssetRevision`](../api/reference/files#getAssetRevision) المُخرَج الخاص بها. نزّله باستخدام عنوان محتوى المُخرَج.
- للعودة إلى مراجعة قديمة، استخدم [`restoreAsset`](../api/reference/files#restoreAsset). يضيف مراجعة جديدة تشير إلى البايتات القديمة.
- لسرد مسارات مستودع حسب البادئة، استخدم [`listAssetPage`](../api/reference/files#listAssetPage).
- لا يمكن حذف مسار. تبقى المحفوظات. لا تزيل سياسة الاحتفاظ المُخرَجات التي تستخدمها مراجعة مسار.

توجد العمليات نفسها في [SDK](./sdk#raw-files-by-path) ‏(`client.raw.putRawFile` و`downloadRawFile`) وفي [`arkvoryctl`](./cli#transfers) ‏(`put` و`get`).

### قواعد المسار {#path-rules}

| القاعدة   | القيمة                                                                                |
| --------- | ------------------------------------------------------------------------------------- |
| الطول     | من 1 إلى 1024 محرفًا                                                                   |
| المجلدات  | مقاطع تفصل بينها `/`                                                                  |
| غير مسموح | مقطع فارغ (`a//b`) أو `.` أو `..` أو شرطة مائلة عكسية أو نقطتان رأسيتان أو محارف تحكم |

يزيل `curl` والمتصفحات `.` و`..` من URL قبل إرساله، لذلك لا يصل مثل هذا المسار أبدًا. يُرجع المسار المخالف للقواعد `400`.

## الأذونات {#permissions}

تحصل الرموز الشخصية ومفاتيح الملفات على حق القراءة أو الكتابة في المستودع. وتحصل مفاتيح الخدمة على إجراءات محددة.

| العملية       | إجراءات مفتاح الخدمة                                                                             | الرمز الشخصي أو مفتاح الملف          |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `GET`، `HEAD` | `content.read`                                                                                   | حق القراءة                           |
| `PUT`         | `upload.create`، `upload.write`، `upload.complete`، `asset.read`، `asset.write`، `artifact.read` | حق الكتابة، ونطاق الرمز `read-write` |

يحتاج وكيل النشر الذي لا يفعل إلا التنزيل إلى الإجراء `content.read`.

لا تقبل [بوابة القراءة](../operate/read-gateways) إلا `GET` و`HEAD`. وتقدّم [المرآة](../operate/mirrors) القراءة وترفض `PUT` بالحالة `409` والسبب `mirror_read_only`.

## الحدود {#limits}

| الحد                     | القيمة                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| حجم الملف                | الحد الأقصى لحجم الكائن في التثبيت، `ARKVORY_MAX_OBJECT_BYTES` (نحو 10 TiB افتراضيًا)                                                                              |
| طلب `PUT` واحد           | يجب أن ينتهي خلال 30 دقيقة، وألا يتوقف مؤقتًا لأكثر من 30 ثانية (`ARKVORY_UPLOAD_DEADLINE_MS` و`ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). هاتان أيضًا أعلى قيمتين مسموحتين. |
| عمليات الرفع المتزامنة   | 8 لكل خادم و4 لكل مفتاح افتراضيًا (`ARKVORY_MAX_UPLOADS` و`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). يتوقف الطلب المنتظر عن الانتظار بعد 20 ثانية بالحالة `503`.        |
| عمليات التنزيل المتزامنة | 16 لكل خادم و4 لكل مفتاح افتراضيًا                                                                                                                                 |
| حصة التخزين              | يُحتسب الملف ضمن حصة تخزين المستودع وسعة التثبيت                                                                                                                   |

لا يدعم `PUT` الواحد الاستئناف: بعد فشل، يبدأ مجددًا من البايت الأول. استخدم الملفات الخام للملفات الصغيرة والمتوسطة وللنصوص البرمجية. للملفات الكبيرة أو الشبكات البطيئة، استخدم [`arkvoryctl put`](./cli) أو [SDK](./sdk). يرفعان في أجزاء، ويواصلان بعد فشل، ويتحققان من SHA-256. ويخزّنان الملف أيضًا كمراجعة لمسار. تُشرح المتغيرات في [متغيرات البيئة](../reference/environment#transfers-and-bandwidth).

## Unity Addressables {#addressables}

تحمّل Addressables الفهرس وحزم الأصول بطلبات `GET` عادية، لذلك يمكن وضع مجلد بناء تحت مسار ملف خام. يناسب ذلك نسخ البناء الداخلية وضمان الجودة والأدوات. ولا يناسب نسخ اللعبة لدى اللاعبين على الإنترنت العام: تتطلب قراءة ملف خام مفتاحًا دائمًا، وتنتهي صلاحية رابط التنزيل خلال 24 ساعة، ولا يُعد المفتاح داخل نسخة لعبة موزّعة سرًا.

ارفع المجلد باستخدام `arkvoryctl put`. لا تُرسل مجددًا الملفات التي لم تتغير بايتاتها. استخدم مجلدًا واحدًا لكل نسخة بناء، لأن المسار يُرجع أحدث مراجعة دائمًا، ويجب ألا يتعامل فهرس قديم مع حزم أصول جديدة:

```bash
cd ServerData/StandaloneWindows64
find . -type f | while read -r file; do
  arkvoryctl put "$file" "addressables/game/$BUILD/StandaloneWindows64/${file#./}" || exit 1
done
```

```powershell
$root = (Resolve-Path .\ServerData\StandaloneWindows64).Path
Get-ChildItem $root -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($root.Length + 1) -replace '\\', '/'
  arkvoryctl put $_.FullName "addressables/game/$env:BUILD/StandaloneWindows64/$relative"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

اضبط مسار التحميل البعيد في ملف تعريف Addressables على عنوان الملفات الخام لذلك المجلد، مثل `https://arkvory.example/api/v1/repositories/releases/raw/addressables/game/<build>/[BuildTarget]`. أعطِ نسخة اللعبة مفتاحًا لا يستطيع إلا القراءة: رمز وصول شخصيًا بحق القراءة، أو مفتاح خدمة بالإجراء `content.read`. لا تقبل الملفات الخام المفتاح إلا في الترويسة `Authorization`، لذا اضبطها في كل طلب:

```csharp
Addressables.WebRequestOverride = request =>
{
    if (request.url.StartsWith("https://arkvory.example/"))
        request.SetRequestHeader("Authorization", "Bearer " + readKey);
};
```

الخاصية هي `Addressables.WebRequestOverride` في Addressables 1.x؛ تحقق من اسمها في إصدارك. هذا نمط للاستخدام وليس تكاملًا مختبرًا.

## استكشاف الأخطاء وإصلاحها {#troubleshooting}

الأخطاء مستندات JSON تحتوي على `code` و`reason` و`message` و`requestId`. راجع [الأخطاء](../api/errors). أعطِ المسؤول `requestId` للعثور على الطلب في سجل الخادم.

| الحالة         | السبب                                                       | المسبّب                                                                                 | الإجراء                                                                 |
| -------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `400`          | `validation`                                                | المسار أو `Content-Length` أو `X-Checksum-Sha256` أو `If-None-Match` غير صالح          | تحقق من قواعد المسار ورمّز URL                                           |
| `401`          | `credential_missing`، `credential_invalid`، `token_expired` | مفتاح مفقود أو غير صحيح، أو رمز منتهٍ                                                   | أرسل `Authorization: Bearer <key>`. لا تعمل مصادقة Basic للملفات الخام. |
| `403`          | `permission_missing`، `read_only_token`                     | لا يستطيع المفتاح الكتابة، أو هو رمز للقراءة فقط                                       | استخدم مفتاحًا بالإجراءات المذكورة في [الأذونات](#permissions)           |
| `404`          |                                                             | المسار غير موجود، أو لا يرى المفتاح المستودع                                           | تحقق من اسم المستودع والمسار                                            |
| `409`          | `already_exists`                                            | إرسال `If-None-Match: *` مع وجود المسار                                                | أزِل الترويسة لإضافة مراجعة                                              |
| `409`          | `revision_mismatch`                                         | غيّر طلب آخر المسار أولًا                                                                | شغّل الطلب مجددًا                                                         |
| `409`          | `mirror_read_only`                                          | المستودع مرآة                                                                          | اكتب إلى الخادم الرئيسي                                                 |
| `416`          | `range_not_satisfiable`                                     | يبدأ النطاق بعد نهاية الملف                                                            | تحقق من الحجم بواسطة `HEAD`                                             |
| `422`          | `integrity_mismatch`                                        | لا يطابق الجسم `X-Checksum-Sha256` أو `Content-Length`                                 | احسب المجموع الاختباري مجددًا؛ وتحقق من الوكيل                           |
| `503`          | `busy`                                                      | عدد كبير جدًا من عمليات النقل المتزامنة                                                 | انتظر المدة في `Retry-After` وأعد المحاولة                              |
| `507`          | `storage_quota`                                             | بُلغت حصة تخزين المستودع أو سعة التثبيت                                                 | حرّر مساحة أو اطلب حصة تخزين أكبر                                        |
| ليست حالة HTTP | `curl: (55)` أو `(56)` أثناء الإرسال                        | أغلق الخادم الاتصال. عندما يحتوي المسار على البايتات أصلًا، يستجيب بالحالة `200` ويغلق. | شغّل `curl -i` واقرأ الاستجابة                                           |
| ليست حالة HTTP | يُغلق الاتصال بعد 30 دقيقة                                   | المهلة النهائية للرفع                                                                  | استخدم `arkvoryctl put`                                                 |

## صفحات ذات صلة {#related-pages}

- [العملاء والبروتوكولات](./index)
- [سطر الأوامر (arkvoryctl)](./cli)
- [حزمة SDK لـTypeScript](./sdk)
- [الملفات والمسارات](../use/files)
- [مرجع API: الملفات حسب المسار](../api/reference/files)
