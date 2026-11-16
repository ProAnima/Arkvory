---
title: الملفات حسب المسار
description: حفظ ملف في مسار مع محفوظاته الكاملة، واستعادة مراجعات سابقة، وإضافة التسميات وبيانات التعريف والتجميعات والمرفقات.
---

# الملفات حسب المسار

الملف حسب المسار اسم في مستودع، مثل `builds/game/1.4/GameSetup.exe`، يشير إلى ملف مخزّن واحد. عندما تضع محتوى جديدًا في المسار نفسه، يشير المسار إلى الملف الجديد. ويبقى القديم ويمكنك العودة إليه. استخدم مسارًا عندما يحتاج المستخدمون والبرامج النصية إلى عنوان ثابت لـ«Setup.exe الحالي».

## ما المسار {#what-it-is}

كل ملف مخزّن هو **مُخرَج** غير قابل للتغيير له معرّف وSHA-256. المسار مؤشر إلى مُخرَج. وكل تغيير للمؤشر هو **مراجعة**، يبدأ ترقيمها من 1. ولا تُحذف المراجعات أو تُعدَّل مطلقًا.

يتكون المسار من 1 إلى 1024 حرفًا. وهو مقاطع تفصل بينها `/`. لا يكون المقطع فارغًا، ولا يساوي `.` أو `..`، ولا يحتوي على محارف تحكم. لا يمكن أن يحتوي المسار على `\` أو `:`. وحالة الأحرف مؤثرة.

المسار والحزمة طريقتان لعرض المُخرَجات نفسها: يمكن لأرشيف UPack أن يمتلك مسارًا أيضًا. راجع [حزم UPack](./packages).

## وضع ملف في مسار {#put}

تحتاج إلى الإجراءات `upload.create` و`upload.write` و`upload.complete`، وإلى `asset.read` و`asset.write` و`artifact.read`. وبمستويات المجموعات، تحتاج إلى إذن الكتابة. راجع [الأذونات](./accounts#permissions).

### باستخدام arkvoryctl {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

يرفع `put` الملف على أجزاء، مع نقطة تحقق بجانب الملف المصدر، ويجعله المراجعة التالية للمسار. ويطبع `path` و`revision` ومعرّف المُخرَج `id` و`created`. إذا كان المسار يحتوي بالفعل على البايتات نفسها، فلا يرفع `put` شيئًا ويطبع `created` بالقيمة `false`: لا تكلّف خطوة البناء المكررة شيئًا. إذا غيّر شخص المسار أثناء رفعك، يتوقف `put` مع `revision_mismatch` (رمز الخروج 6) ولا يستبدل عمله. اقرأ المحفوظات واتخذ قرارك. إذا توقف الرفع، فشغّل الأمر نفسه مجددًا. راجع [الرفع والتنزيل](./transfers#resume).

ينزّل `get` المراجعة الحالية مع الاستئناف والتحقق من SHA-256. لا يوجد أمر لسرد المسارات أو قراءة المحفوظات. استخدم وحدة التحكم أو API لذلك.

### بطلب HTTP واحد {#put-http}

يخزّن طلب `PUT` خام البايتات في المسار بطلب واحد، كما يفعل `curl -T`:

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

تتضمن الاستجابة `path` و`revision` و`created` و`artifact` مع `id` و`size` و`sha256` الخاصة به. تعيد المراجعة الجديدة `201`. وإرسال البايتات نفسها مجددًا يعيد `200` مع `created` بالقيمة false. يوجد رأسان اختياريان: يتيح `X-Checksum-Sha256` للخادم التحقق من البايتات في مرور واحد، ويرفض `If-None-Match: *` الطلب إذا كان المسار موجودًا بالفعل. يجب أن يكتمل الطلب الواحد خلال 30 دقيقة. استخدم `put` للملفات الكبيرة. راجع [الملفات الخام](../protocols/raw-files).

### في وحدة التحكم {#put-console}

1. ارفع الملف في [[ui:upload]]. راجع [الرفع والتنزيل](./transfers).
2. افتح المُخرَج في [[ui:catalog]] باستخدام [[ui:open]].
3. في [[ui:assetTitle]]، أدخل [[ui:assetPath]]، مثل `releases/current.upack`.
4. أدخل [[ui:currentRevision]]: القيمة `0` لمسار جديد، أو المراجعة الحالية المعروضة في [[ui:history]].
5. اختر [[ui:assign]].

يحمي حقل المراجعة من تغيير شخصين المسار في الوقت نفسه. إذا لم تكن القيمة هي المراجعة الحالية، يرفض الخادم الطلب بسبب تعارض. حمّل المحفوظات مجددًا وأعد المحاولة.

### باستخدام API وSDK {#put-api}

توجّه `setAsset` المسار إلى مُخرَج رفعته بالفعل. تساوي `expectedRevision` القيمة `0` لإنشاء المسار، والمراجعة الحالية في غير ذلك.

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

يعيد التعارض `409 revision_mismatch`. لا تُعد المحاولة بمراجعة تخمّنها. بعد فقدان استجابة، اقرأ المسار: إذا كان المُخرَج الجديد موجودًا فيه بالفعل، فقد اكتمل العمل.

## قراءة مسار {#read}

- ينزّل `arkvoryctl get PATH OUTPUT` الملف الحالي.
- يعيد `GET /api/v1/repositories/<repository>/raw/<path>` و`GET /api/v1/repositories/<repository>/asset/content?path=<path>` البايتات. يحتاج كلاهما إلى `content.read`، ويدعمان نطاقات البايتات وETag.
- تعيد `getAsset` (`GET …/asset?path=`) المؤشر: `path` و`revision` و`artifactId`.
- تسرد `listAssetPage` (`GET …/assets/page?prefix=`) المؤشرات. تضم الصفحات حتى 100 (50 افتراضيًا)، بترتيب بايتات مسار UTF-8. البادئة حرفية وحساسة لحالة الأحرف. مرّر `next` بوصفه `after`. تعيد `listAssets` الأقدم حتى 1000 وتطلب منك تضييق البادئة.

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## المراجعات والمحفوظات {#history}

في وحدة التحكم، افتح [[ui:history]]، واكتب المسار في [[ui:assetPath]] واختر [[ui:historyLoad]]. يعرض الجدول [[ui:revision]]، والوقت ([[ui:date]])، والكاتب ([[ui:actor]])، وللمراجعات المستعادة، المراجعة التي جاءت منها ([[ui:source]]). الأحدث أولًا. يحمّل [[ui:historyMore]] المراجعات الأقدم، 50 في كل مرة. يفتح [[ui:open]] في أحد الصفوف مُخرَج تلك المراجعة، ومنه يمكنك تنزيل محتواها الأصلي.

في API، تعيد `getAssetHistory` (`…/asset/history?path=&before=`) الصفحات بدءًا بالأحدث، وتكون `before` آخر مراجعة في الصفحة السابقة. تعيد `getAssetRevision` (`…/asset/revision?path=&revision=`) مراجعة واحدة. يكون الكاتب والوقت فارغين للمراجعات التي كُتبت قبل أن تبدأ المحفوظات بتسجيلهما. تحتاج القراءة إلى `asset.read`.

## استعادة مراجعة سابقة {#restore}

تجعل الاستعادة المسار يشير إلى مُخرَج مراجعة أقدم. ولا تنسخ بايتات ولا تحذف مراجعة: الاستعادة مراجعة جديدة هي الأحدث، وتعرض المحفوظات مصدرها.

في وحدة التحكم، حمّل المحفوظات واختر زر الاستعادة للمراجعة المطلوبة. زر المراجعة الحالية معطّل. تحتاج الاستعادة إلى `asset.restore` و`asset.read` و`artifact.read`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

القيمة `expectedRevision` هي أحدث مراجعة رأيتها. إذا تغيّر المسار في الأثناء، يعيد الخادم `409 revision_mismatch`؛ وتعرض وحدة التحكم رسالة وتطلب إعادة تحميل المحفوظات. لا تعيد الاستعادة التسميات أو بيانات التعريف القديمة: بل تبقى بحالتها الحالية.

## التسميات وبيانات التعريف والتجميعات {#labels}

يحمل كل مُخرَج ثلاثة أنواع من الملاحظات. يمكنك تغييرها في أي وقت. ولا يتغير الملف نفسه مطلقًا.

| النوع          | مثال                                           | القواعد                                                                                                                           |
| -------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| التسميات       | `test`، `staging`، `release`، `linux`          | حتى 32 تسمية. تتكون كل منها من 1 إلى 64 حرفًا أو رقمًا أو من الرموز `_` أو `.` أو `:` أو `-`. حالة الأحرف مؤثرة                     |
| بيانات التعريف | `build.number` = `42`، `git.commit` = `abc123` | حتى 32 حقلًا نصيًا. يبدأ المفتاح بحرف ويتكون من 64 حرفًا أو رقمًا أو من الرموز `_` أو `.` أو `-` كحد أقصى. لا تتجاوز القيمة 1024 حرفًا |
| التجميعات      | `desktop`، `nightly`                           | حتى 32 تجميعة. تتبع قواعد التسميات نفسها. وتجمع المُخرَجات مهما كانت إصداراتها أو مساراتها                                          |

التسميات نص حر. لا تمنح وصولًا ولا تنقل ملفًا. تقترح وحدة التحكم [[ui:labelPresets]] (`nightly` و`test` و`staging` و`release`)، لكن أي تسمية صالحة، ولا تُصحَّح `relase`. للحصول على اعتماد يستند إليه النشر، استخدم مرحلة ([المراحل والترقية](./promotion)).

**وحدة التحكم.** افتح المُخرَج في [[ui:metadata]]. أدخل [[ui:labels]] و[[ui:collections]] مفصولة بفواصل. استخدم [[ui:metadataAdd]] لإضافة حقل في [[ui:metadataFields]]: [[ui:metadataKey]] و[[ui:metadataValue]]. يحرر [[ui:metadataJson]] البيانات نفسها بصيغة JSON. اختر [[ui:save]].

**arkvoryctl.** عند الرفع، يضيف `--label test` تسمية واحدة، ويحدد `--file metadata.json` القيمتين `labels` و`metadata`:

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

لتغيير مُخرَج موجود، اقرأه، ثم أرسل الحالة الجديدة كاملةً مع المراجعة التي قرأتها:

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

يجب أن يتضمن `annotations.json` المفاتيح الثلاثة كلها: `labels` و`metadata` و`collections`. يصبح كل ما تتركه فارغًا. يحل الحفظ محل المجموعة كاملةً. إذا حفظ شخص آخر قبلك، يعيد الخادم `409 revision_mismatch`: اقرأ مجددًا واتخذ قرارك. لا تعيد SDK محاولات الحفظ هذه.

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

تحتاج إلى `annotation.read` للقراءة، وإلى `annotation.write` مع `artifact.read` للكتابة.

**البحث.** في [[ui:catalog]]، اكتب نصًا في [[ui:search]]: يطابق اسم الملف وقيم بيانات التعريف مع تجاهل حالة الأحرف. يعرض [[ui:labelFilter]] تسمية واحدة. ويطابق [[ui:metadataFilter]] مفتاحًا وقيمةً تمامًا، بما في ذلك حالة الأحرف. باستخدام `arkvoryctl`:

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

يُستخدم `--metadata-key` و`--metadata-value` معًا. تضم الصفحات حتى 100 نتيجة. مرّر `next` بوصفه `--after`. تُجمع عوامل التصفية بمنطق AND.

## المرفقات {#attachments}

تربط المرفقات ملفات أخرى بنسخة بناء: ملف بيان أو قائمة مكوّنات برمجيات (SBOM) أو توقيع أو تقرير أو أي ملف. المرفق اسم ورابط إلى مُخرَج آخر في المستودع نفسه. وتبقى نسخة البناء والمرفق ملفين منفصلين.

| القاعدة       | القيمة                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| الأنواع       | `manifest`، `sbom`، `signature`، `report`، `file`                                                                 |
| لكل نسخة بناء | 32 كحد أقصى                                                                                                       |
| الاسم         | من 1 إلى 240 حرفًا، فريد ضمن نسخة البناء (مع تجاهل حالة الأحرف)، دون `/` أو `\` أو محارف تحكم أو مسافات في الطرفين |
| الوصف         | حتى 512 حرفًا، ويمكن أن يكون فارغًا                                                                                 |
| الهدف         | مُخرَج منشور في المستودع نفسه، وليس نسخة البناء نفسها                                                               |

يحدد النوع غرض الملف فقط. لا يتحقق Arkvory من التوقيع، ولا يقرأ قائمة SBOM، ولا ينفّذ ملف البيان.

في وحدة التحكم، افتح المُخرَج. تحت [[ui:attachmentsTitle]]، وسّع نموذج [[ui:attachmentAdd]]. اختر [[ui:attachmentSource]]: يرسل [[ui:attachmentUpload]] ملفًا جديدًا ويربطه، ويربط [[ui:attachmentExisting]] مُخرَجًا منشورًا بالفعل. اختر [[ui:attachmentKind]]: [[ui:attachmentManifest]] أو [[ui:attachmentSbom]] أو [[ui:attachmentSignature]] أو [[ui:attachmentReport]] أو [[ui:attachmentFile]]. أعطه [[ui:attachmentName]]، وإذا رغبت، [[ui:attachmentDescription]]. ثم اختر [[ui:attachmentAdd]]. يزيل [[ui:attachmentUnlink]] الرابط ويبقي الملف. ويقرأ [[ui:attachmentReload]] القائمة مجددًا. إذا انقطع رفع مرفق، يعرض [[ui:attachmentRecovery]] معرّف الرفع للاستئناف به.

كل تغيير للقائمة إصدار مرقّم. يعرض [[ui:attachmentHistory]] الإصدارات السابقة، ويعيد [[ui:attachmentRestore]] أحدها بوصفه إصدارًا جديدًا.

مع `arkvoryctl`، يحتوي الملف على القائمة كاملةً كمصفوفة JSON:

```json
[
  {
    "name": "build.json",
    "kind": "manifest",
    "artifactId": "64b42380-902d-41cf-9151-10c12e4809dc",
    "description": "Build provenance from CI"
  }
]
```

```bash
arkvoryctl attachments get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl attachments set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 0 --file attachments.json
arkvoryctl attachments history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

القيمة `--revision` هي الرقم الذي قرأته باستخدام `get`؛ ولنسخة بناء جديدة تكون `0`. في API، تأخذ `replaceBuildAttachments` القيمتين `expectedRevision` و`items`؛ وتقرأ `getBuildAttachments` و`getBuildAttachmentHistory` البيانات. لتنزيل مرفق، استخدم `artifactId` من رابطه مع التنزيل العادي. تحتاج القراءة إلى `annotation.read`، والتغييرات إلى `annotation.write` مع `artifact.read`، ويحتاج رفع ملف المرفق إلى إجراءات الرفع.

لا تنتقل المرفقات والمسارات مع الترقية إلى مستودع آخر. راجع [المراحل والترقية](./promotion).

## صفحات ذات صلة {#related-pages}

- [الملفات الخام](../protocols/raw-files)
- [الرفع والتنزيل](./transfers) و[حزم UPack](./packages)
- [سطر الأوامر (arkvoryctl)](../protocols/cli)
- مرجع API: [الملفات حسب المسار](../api/reference/files)، [المُخرَجات والفهرس](../api/reference/artifacts)، [مرفقات نسخ البناء](../api/reference/attachments)
