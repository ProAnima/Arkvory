---
title: حزم UPack
description: نشر حزم UPack ذات الإصدارات وسردها وتصفيتها، وتنزيل إصدار برقم محدد أو نطاق أو أحدث إصدار أو مرحلة.
---

# حزم UPack

حزمة UPack أرشيف ZIP له اسم وإصدار SemVer. يسجّل Arkvory كل إصدار مرة واحدة ولا يغيّره مطلقًا. تطلب مهمة نشر «app، الإصدار `^1.4`، المرحلة `release`» وتحصل على ملف واحد بالضبط.

## ما الحزمة {#what-it-is}

UPack ملف ZIP يحتوي على ملف `upack.json` في جذره. يحدد ملف البيان هوية الحزمة:

```json
{
  "group": "acme/game",
  "name": "game-client",
  "version": "1.4.2"
}
```

| الحقل     | القاعدة                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| `name`    | مطلوب. من 1 إلى 128 حرفًا أو رقمًا أو من الرموز `.` أو `_` أو `-`                                                   |
| `version` | مطلوب. بصيغة SemVer: `1.4.2`، `1.5.0-rc.1`، `2.0.0+build.7`. بحد أقصى 128 حرفًا                                    |
| `group`   | اختياري. مقاطع من الأحرف أو الأرقام أو الرموز `.` أو `_` أو `-`، تفصل بينها `/`. بحد أقصى 128 حرفًا. فارغ افتراضيًا |

تبقى الحقول الأخرى كما كتبتها وتُعاد في قائمة الحزم. لا يتجاوز ملف البيان 64 KiB. يجب ألا يحتوي الأرشيف على مسارات مطلقة أو `..` أو روابط رمزية أو عناصر مشفّرة أو أسماء مكررة، ولا يتجاوز 100 000 عنصر. يخزّن Arkvory الأرشيف بايتًا ببايت ولا يفكّه.

هوية الحزمة هي مجموعتها واسمها وإصدارها، مع المقارنة دون اعتبار لحالة الأحرف. داخل المستودع الواحد، ترتبط الهوية بأرشيف واحد بصورة دائمة. يُرفض تسجيل أرشيف مختلف بهوية موجودة مع `409 version_exists`. إعادة تسجيل الأرشيف نفسه آمنة ولا تغيّر شيئًا. انشر الإصلاح بإصدار جديد.

## نشر حزمة {#publish}

يتكون النشر من رفع يتبعه تسجيل. يقرأ التسجيل `upack.json` ويحفظ الهوية. تحتاج إلى الإجراءين `package.publish` و`artifact.read`، بالإضافة إلى إجراءات الرفع. راجع [الأذونات](./accounts#permissions).

### في وحدة التحكم {#publish-console}

1. ارفع الأرشيف في [[ui:upload]]. راجع [الرفع والتنزيل](./transfers).
2. افتح المُخرَج في [[ui:catalog]] باستخدام [[ui:open]].
3. في [[ui:metadata]]، اختر [[ui:register]]. تعرض وحدة التحكم الاسم والإصدار اللذين سجّلتهما.

تظهر الحزمة الآن في [[ui:packages]].

### باستخدام arkvoryctl {#publish-cli}

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl packages register 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

يرفع `packages publish` الأرشيف مع إمكانية الاستئناف ثم يسجّله. إذا فشل التسجيل بعد الرفع، يتضمن الخطأ `artifactId` والمرحلة `register`. شغّل الأمر نفسه مجددًا: لا يتكرر الرفع، والتسجيل مرتين آمن. يسجّل `packages register ID` مُخرَجًا رُفع بالفعل. راجع [سطر الأوامر](../protocols/cli#packages-and-promotion).

### باستخدام HTTP API وSDK {#publish-api}

ارفع الأرشيف كما في [الرفع والتنزيل](./transfers#upload-http)، ثم سجّله:

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/package" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
const entry = await releases.packages.register(uploaded.id);
console.log(entry.group, entry.name, entry.version);
```

العملية هي `registerPackage`. يؤدي الأرشيف التالف أو غياب `upack.json` أو الإصدار غير الصحيح إلى `400 invalid_input`.

## السرد والتصفية {#list}

في وحدة التحكم، افتح [[ui:packages]]. اكتب [[ui:packageGroup]] أو [[ui:packageName]]: كلاهما يطابق تمامًا مع تجاهل حالة الأحرف. اختر عمودًا في [[ui:sortBy]]، وترتيبًا في [[ui:direction]] ([[ui:ascending]] أو [[ui:descending]])، وتجميعًا في [[ui:groupBy]] ([[ui:packageGroup]] أو [[ui:packageName]] أو [[ui:noGrouping]])، ثم اختر [[ui:apply]]. يعيد [[ui:clearFilters]] ضبط النموذج. يعرض الجدول المجموعة والاسم والإصدار ومراحل كل إصدار. يعرض [[ui:open]] المُخرَج. وينقلك [[ui:previousPage]] و[[ui:nextPage]] بين الصفحات.

```bash
arkvoryctl packages list --group acme/game --name game-client
arkvoryctl packages list --after <next from the previous answer>
```

في API، تأخذ `listPackages` المعاملات `group` و`name` و`sort` (`group` أو `name` أو `version`)، و`direction` (`asc` أو `desc`)، و`groupBy` (`none` أو `group` أو `package`)، و`after` و`limit` (من 1 إلى 100، والافتراضي 50). تحتوي الاستجابة على `items` (المجموعة والاسم والإصدار و`artifactId` وملف البيان كاملًا)، و`groups` و`next`. يرتبط المؤشر بعوامل التصفية التي نتج عنها. استخدمه مع عوامل التصفية نفسها فقط.

```typescript
const page = await releases.packages.list({
  name: 'game-client',
  sort: 'version',
  direction: 'desc',
});
```

يحتاج السرد إلى `package.read`. للبحث بالتسميات أو بيانات التعريف بدلًا من ذلك، راجع [الملفات حسب المسار](./files#labels).

## الإصدارات والنطاقات {#versions}

يقارن Arkvory الإصدارات وفق أسبقية SemVer. الإصدار `1.10.0` أحدث من `1.9.0`. والإصدار الذي يتضمن جزءًا تمهيديًا، مثل `1.5.0-rc.1`، أقدم من `1.5.0`.

يأخذ الاختيار اسم الحزمة `name`، ويمكن أن يأخذ عوامل التصفية التالية اختياريًا:

| عامل التصفية        | المعنى                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| `group`             | المجموعة. فارغة افتراضيًا: لا تُعثر على حزمة لها مجموعة إلا إذا حددتها       |
| إصدار محدد          | إصدار واحد، مع تجاهل حالة الأحرف                                           |
| نطاق                | نطاق SemVer                                                                |
| `stage`             | الإصدارات التي تحمل هذه المرحلة فقط (راجع [المراحل والترقية](./promotion)) |
| الإصدارات التمهيدية | تضمين الإصدارات التمهيدية. معطّل افتراضيًا                                   |
| الترتيب             | `version` (الافتراضي) أو `promoted`                                        |

يمكن كتابة النطاقات بصيغ `1.2.3` و`^1.2` و`~1.2.3` و`1.x` و`>=1.0.0 <2.0.0` و`1.0.0 - 1.4.0` و`^1 || ^3`. لا يتجاوز النطاق 256 حرفًا. ولا يمكن الجمع بين إصدار محدد ونطاق.

دون إصدار محدد أو نطاق، يعيد الاختيار أعلى إصدار مستقر، أي الأحدث. لا تُختار الإصدارات التمهيدية إلا عند تفعيل عامل التصفية الخاص بها، أو عندما يحدد الإصدار المحدد أو النطاق نفسه إصدارًا تمهيديًا له `major.minor.patch` نفسه. يختار `order promoted` الإصدار الذي أُضيفت إليه المرحلة أخيرًا، وليس الأعلى، ويتطلب تحديد مرحلة. إذا لم يطابق شيء، يعيد الخادم `404 not_found`.

## تنزيل حزمة {#download}

حدّد الإصدار أولًا إذا أردت رؤية ما ستحصل عليه، أو نزّله مباشرةً.

```bash
arkvoryctl packages resolve game-client --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --exact 1.4.2 --group acme/game
arkvoryctl packages download game-client ./game-client.upack --group acme/game
```

الخيارات هي `--group` و`--exact` و`--range` و`--stage` و`--prerelease` و`--order promoted`. استخدم `--exact` للإصدار المحدد، لأن `--version` يطبع إصدار العميل. يطبع `resolve` المجموعة والاسم والإصدار و`artifactId` و`sha256` و`size` و`publishedAt` و`stagedAt` والمراحل. يحدّد `download` الإصدار، ثم ينزّل ذلك المُخرَج مع الاستئناف والتحقق من SHA-256، كما في [الرفع والتنزيل](./transfers#download-cli). يحتاج العميل إلى `package.read` و`artifact.read` و`content.read`.

مع HTTP، توجد عمليتان. تحتاج `resolvePackage` إلى `package.read` وتعيد المعلومات نفسها التي يعيدها `resolve`. وترسل `downloadPackageContent` بايتات الإصدار المختار، ولا تحتاج إلا إلى `content.read`. وتضيف الرأسين `X-Arkvory-Artifact-Id` و`X-Arkvory-Package-Version`.

```bash
curl -fL -G -H "Authorization: Bearer $ARKVORY_KEY" -o game-client.upack \
  --data-urlencode "name=game-client" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

يحدد العنوان المعتمد على الاسم الإصدار في كل طلب. إذا استأنفت تنزيلًا بنطاق بايتات، فقد يكون الملف قد تغيّر بين الاستدعاءين. نزّل باستخدام `artifactId` الناتج عن `resolve` بدلًا من ذلك، أو أرسل `ETag` في `If-Range`.

```typescript
const found = await prod.packages.resolve({
  name: 'game-client',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
const stream = await prod.artifacts.downloadVerified(found.artifactId);
```

يحصل وكيل نشر يقتصر عمله على جلب نسخ البناء على مفتاح خدمة يتضمن `content.read` وحده لعنوان HTTP، أو الإعداد المسبق للقراءة لاستخدام `arkvoryctl`. راجع [حسابات الخدمة ومفاتيح CI](./accounts#service-accounts).

## التسميات وبيانات التعريف والمرفقات {#labels}

إصدار الحزمة مُخرَج عادي، لذا ينطبق عليه كل ما في [الملفات حسب المسار](./files#labels): تسميات مثل `test` و`staging` و`release`، وبيانات تعريف نصية مثل `git.commit`، وتجميعات، ومرفقات مثل قائمة مكوّنات البرمجيات (SBOM) أو توقيع. عيّن التسميات الأولى عند الرفع باستخدام `--label test`. لا تغيّر التسميات شيئًا في الأرشيف. وهي نص حر وليست حالة مضبوطة. للحصول على اعتماد يمكن للنشر الاستناد إليه، استخدم مرحلة. راجع [المراحل والترقية](./promotion).

## الاحتفاظ بالإصدارات القديمة {#retention}

الحزم المسجّلة هي ما تحسبه سياسة الاحتفاظ للمستودع. افتراضيًا، عند تمكينها، تحتفظ بآخر 10 نسخ بناء لكل حزمة وقناة. القناة هي التسمية `test` أو `staging` أو `release`. لا تحذف سياسة الاحتفاظ مطلقًا إصدارًا له مرحلة أو تسمية محمية أو مسار ملف أو رابط مرفق. يبقى الاحتفاظ معطّلًا حتى يمكّنه مسؤول ويوافق على الحذف. راجع [التخزين والاحتفاظ](../operate/storage).

## الأخطاء {#errors}

| الاستجابة                         | المعنى                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `400 invalid_input` عند التسجيل   | أرشيف ZIP غير صالح بصيغة UPack، أو غياب `upack.json` في الجذر، أو اسم أو إصدار غير صحيح                                                                |
| `503 unavailable` عند التسجيل     | تعذرت قراءة الأرشيف المخزّن: التخزين لا يستجيب أو الأرشيف مفقود منه. تعيد SDK وعميل سطر الأوامر الطلب. إذا استمرت الاستجابة، فاطلب من مسؤول فحص التخزين |
| `409 version_exists`              | ترتبط الهوية بالفعل بأرشيف آخر. انشر إصدارًا جديدًا. وتفشل بالطريقة نفسها الترقية إلى مستودع لديه الإصدار ببايتات مختلفة                                 |
| `404 not_found` عند تحديد الإصدار | لا شيء يطابق عوامل التصفية. تحقّق من المجموعة والنطاق والمرحلة                                                                                          |
| `403 permission_missing`          | يفتقر المفتاح إلى `package.read` أو `package.publish` أو `content.read`                                                                                |

## صفحات ذات صلة {#related-pages}

- [الرفع والتنزيل](./transfers)
- [المراحل والترقية](./promotion)
- [سطر الأوامر (arkvoryctl)](../protocols/cli)
- مرجع API: [الحزم](../api/reference/packages)، [المراحل والترقية](../api/reference/promotion)
