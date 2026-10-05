---
title: TypeScript SDK
---

# TypeScript SDK

TypeScript SDK هو مكتبة العميل التي تستخدمها وحدة التحكم و`arkvoryctl`. وهو يغلّف REST API `/api/v1`. يتحقق من كل رد أثناء التشغيل، ويرفع على أجزاء، ويتابع عمليات النقل المنقطعة، ويتحقق من التنزيلات بـ SHA-256. ولا يستخدم سوى واجهات الويب القياسية (`fetch` والتدفقات streams وWeb Crypto)، لذا يعمل في Node.js وفي المتصفحات.

## الحصول على SDK {#get-the-sdk}

SDK هو حزمة مساحة العمل `@proanima/arkvory-sdk` في المجلد `packages/sdk` من مستودع المصدر `ProAnima/Arkvory`. وهو **غير منشور في سجل npm**. ويعتمد على حزمة مساحة العمل `@proanima/arkvory-contracts`.

- لاستخدامه، ابنِ مستودع المصدر (`npm ci` ثم `npm run build`) واكتب أداتك داخل مساحة العمل هذه، كما تفعل النصوص البرمجية في المستودع نفسه.
- من لغة أخرى، أو من مشروع لا يستطيع استخدام مساحة العمل، استدعِ [REST API](../api/index) مباشرة مع `Authorization: Bearer <key>`.

الشيفرة المصدرية متاحة بموجب ترخيص Arkvory. يمكنك استخدامها وتعديلها داخل مؤسستك. ولا يجوز توزيع نسخ منها.

## إنشاء عميل {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **عنوان URL الأساسي.** HTTPS مطلوب. ولا يُسمح بـ HTTP العادي إلا لـ `localhost` و`127.0.0.1` و`[::1]`. يجب ألا يحتوي العنوان على مستخدم أو كلمة مرور أو استعلام أو جزء (fragment). ويمكن أن يحتوي على بادئة مسار. وتُعامل عمليات إعادة التوجيه كأخطاء.
- **دالة الرمز (token callback).** يستدعيها SDK مع كل طلب ولا يخزّن نتيجتها أبدًا. ويمكنك تدوير المفاتيح دون إنشاء عميل جديد.
- **`inRepository(id)`** يعيد عميلًا مرتبطًا بمستودع واحد. وهو وسيلة راحة، لا حدًّا أمنيًا.

| الخيار             | الافتراضي | المعنى                                                                                                    |
| ------------------ | --------- | --------------------------------------------------------------------------------------------------------- |
| `signal`           | لا شيء    | يلغي كل طلبات هذا العميل                                                                                  |
| `requestTimeoutMs` | لا شيء    | مهلة الطلب الذي ليس له signal خاص (من 1 إلى 3600000)                                                      |
| `maxAttempts`      | 5         | محاولات طلب نقل واحد، بما فيها الأولى (من 1 إلى 10)                                                       |
| `maxRetries`       | 20        | إعادات المحاولة المشتركة لعملية رفع أو تنزيل واحدة (من 0 إلى 100)                                         |
| `attemptTimeoutMs` | 120000    | حد محاولة نقل واحدة (من 1 إلى 1800000)                                                                    |
| `baseDelayMs`      | 500       | أول تأخير للتراجع (backoff) (من 1 إلى 60000)                                                              |
| `maxDelayMs`       | 60000     | أطول تأخير، بما فيه `Retry-After`                                                                         |
| `onRequest`        | لا شيء    | يُستدعى مرة لكل طلب HTTP مع الطريقة والمسار والحالة والمدة ومعرّف الطلب. ولا يتلقى بيانات الاعتماد أبدًا. |

لا تنطبق إعادة المحاولة التلقائية إلا على عمليات النقل: `create` والخطوات داخل `resume` و`downloadVerified`. وهي تعيد المحاولة عند أعطال الشبكة وأخطاء HTTP 408 و429 و502 و503 و504، مع تراجع أُسّي (exponential backoff)، ولا تعيدها قبل `Retry-After` أبدًا. أما بقية الاستدعاءات فتُنفَّذ مرة واحدة. والتغييرات المحمية بمراجعة لا تُكرَّر تلقائيًا أبدًا.

## المهام الشائعة {#common-tasks}

### الاستكشاف وعرض القوائم {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

تعيد الصفحات `next`. مرّره بصيغة `after` لقراءة الصفحة التالية.

### رفع ملف كبير مع الاستئناف (Node.js) {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // لا يُقرأ في الذاكرة
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // save it with the job state before the first request
const session = await releases.uploads.create(key, {
  name: 'Game.zip',
  size: String(file.size),
  sha256: hash.digest('hex'),
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const uploaded = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(`${bytes} of ${file.size} bytes`),
});
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0: the path is new
```

- يعيد مفتاح منع التكرار نفسه مع الواصف (descriptor) نفسه الجلسة نفسها، فلا يُنشئ رد مفقود عملية رفع ثانية.
- يقرأ `resume` الأجزاء التي يملكها الخادم بالفعل، ويقارن تجزئاتها (hashes) بملفك، ويرسل الأجزاء الناقصة فقط. وبعد تعطل، استدعِ `resume` مرة أخرى بمعرّف الجلسة المحفوظ.
- يختار الخادم حجم الجزء: 8 MiB، وأكبر منه فقط للملفات التي تحتاج إلى أكثر من 10,000 جزء. ويحتفظ SDK بجزء واحد في الذاكرة في كل مرة.
- الملفات التي يبلغ حجمها 16 GiB فأكثر يُكمل عامل الخادم (worker) إنهاءها. وينتظره `resume`.
- يفشل `assets.assign(path, artifactId, expectedRevision)` بتعارض إذا كان للمسار مراجعة أخرى. اقرأ المسار بـ `assets.get(path)` أولًا.

### التنزيل مع التحقق {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // only after pipeTo succeeded
```

يقرأ SDK المحتوى بنطاقات 8 MiB ويتحقق من الحجم و`Content-Range` و`ETag` لكل نطاق. ويتحقق من SHA-256 للملف كله قبل أن يسلّم الكتلة الأخيرة. وإذا فشل التحقق، يفشل التدفق بالخطأ `ArkvoryIntegrityError`. لا تنشر أبدًا من التدفق مباشرة: اكتب في ملف مؤقت ولا تستخدمه إلا بعد أن ينتهي التدفق بنجاح.

للمتابعة بعد إعادة التشغيل، مرّر البايتات التي حفظتها بالفعل بصيغة `prefix`. عندئذ يحتوي التدفق على الباقي فقط:

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

وللحصول على نطاق بايتات واحد دون تحقق، يعيد `releases.artifacts.download(id, { start: 0, end: 1023 })` الكائن `Response` الخام (الحالة 206).

### الملفات الخام حسب المسار {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // اختياري: ارفض إذا كان المسار موجودًا
});
console.log(result.revision, result.created); // created is false when the bytes were already there
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

يتيح الخيار `sha256` (64 رقمًا سداسي عشريًا) للخادم أن يكتب البايتات في مرور واحد ويرفض أي عدم تطابق. و`releases.assets.put(path, blob, options)` و`releases.assets.download(path, range)` هما الاستدعاءان نفسهما. وكل رفع طلب واحد، لذا استخدمهما للملفات الصغيرة والمتوسطة. راجع [الملفات الخام](./raw-files).

### الحزم والترقية والروابط {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // UPack archive
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

عنوان الرابط سر يقرأ مُخرَجًا واحدًا حتى `expiresAt`. ولا يمكن إبطاله مبكرًا.

### النسخ الاحتياطية {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // في قائمة انتظار وكيل النسخ الاحتياطي
const points = await client.backup.points({ limit: 20 });
```

تحتاج استدعاءات النسخ الاحتياطي إلى جلسة مسؤول حساب أو مفتاح ملف المالك. أما مفاتيح الخدمة والرموز الشخصية فتحصل على 403.

## الأخطاء {#errors}

```typescript
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

try {
  await releases.artifacts.get(id);
} catch (error) {
  if (error instanceof ArkvoryHttpError) {
    console.error(error.status, error.code, error.reason, error.requestId, error.retryAfterSeconds);
  } else if (error instanceof ArkvoryClientError) {
    console.error(error.code);
  }
}
```

| الفئة                   | المعنى                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArkvoryHttpError`      | أجاب الخادم بخطأ. الحقول: `status` و`code` و`reason` و`details` و`requestId` و`retryAfterMs` و`retryAfterSeconds` و`serverMessage`. يكون `code` هو `http_error` عندما يجيب وكيل (proxy) دون صيغة Arkvory. |
| `ArkvoryNetworkError`   | فشل الاتصال أو انتهت مهلته بعد كل إعادات المحاولة                                                                                                                                                         |
| `ArkvoryIntegrityError` | البايتات المنزَّلة لا تطابق المُخرَج                                                                                                                                                                      |
| `ArkvoryClientError`    | فشل محلي مع `code`: `invalid_argument` و`insecure_url` و`invalid_response` و`response_too_large` و`size_mismatch` و`file_changed` و`upload_cancelled` و`completion_failed`                                |

قرّر بحسب `code` و`reason`، لا بنص الرسالة. وعالج الرموز غير المعروفة بحسب حالة HTTP. ولا يحتوي `Error.message` على نص من الخادم أبدًا. راجع [الأخطاء](../api/errors).

## المتصفح وNode.js {#browser-and-node-js}

- **متصفح على أصل (origin) آخر.** يجب أن يدرج المسؤول الأصل الدقيق لصفحتك في `ARKVORY_CORS_ORIGINS` على الخادم. ويرسل SDK المفتاح في ترويسة `Authorization` ولا يرسل ملفات تعريف الارتباط (cookies) أبدًا.
- **المفاتيح في المتصفح.** أبقِ المفتاح في الذاكرة فقط. لا تضعه في عناوين URL أو `localStorage` أو السجلات أو مصدر الصفحة. ويمكن للمستخدم تسجيل الدخول بـ `client.login(name, password)` للحصول على رمز جلسة.
- **الملفات في Node.js.** استخدم `openAsBlob` من `node:fs` لتمرير ملف دون قراءته في الذاكرة.
- **قائمة التنزيل.** توفّر `DownloadQueue` و`checkpointedDownload` قائمة انتظار محدودة مع الإيقاف المؤقت والاستئناف والإلغاء. وأنت تقدّم مهايئ التخزين (storage adapter).

## الحدود {#limits}

- ردود JSON محدودة بـ 2 MiB (صفحات الحزم 8 MiB، وقوائم المُخرَجات 24 MiB). وتفشل الردود الأكبر بالرمز `response_too_large`.
- الأحجام نصوص عشرية، لذا تحتفظ القيم التي تتجاوز 2^53 بدقتها الكاملة.

## صفحات ذات صلة {#related-pages}

- [سطر الأوامر (arkvoryctl)](./cli)
- [النقل](../use/transfers)
- [نظرة عامة على API](../api/index) و[المصادقة](../api/authentication)
- [الملفات الخام](./raw-files)
