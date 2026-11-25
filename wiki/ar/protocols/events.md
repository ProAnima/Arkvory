---
title: الأحداث
description: تابع جميع تغييرات التثبيت بمؤشر واحد، وتعرّف على CloudEvents والأذونات والاحتفاظ وإعادة المزامنة.
---

# الأحداث

تُعلِم تغذية الأحداث نظامًا خارجيًا بما تغيّر في التثبيت بأكمله: النشر والحذف ومسارات الملفات وتسجيل الحزم والتعليقات التوضيحية والمرفقات والمراحل والترقيات وصور الحاويات وnpm وGit LFS. وهي تدفق مرتب واحد لجميع المستودعات التي يُسمح لك بقراءتها، بتنسيق [CloudEvents 1.0](https://cloudevents.io). اقرأها باستخدام `arkvoryctl events tail` أو [حزمة SDK لـTypeScript](./sdk) أو `GET /api/v1/events`.

الحدث إشارة إلى أن شيئًا قد تغيّر. اقرأ الحالة الحالية عبر API المعتادة، وعالج الأحداث بحيث لا يسبب تكرار أي منها ضررًا.

## قراءة التغذية {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

يطبع الأمر حدثًا واحدًا في كل سطر بصيغة JSON، ويحفظ الموضع في `--cursor-file` بعد كل حدث. شغّله مجددًا ليواصل من حيث توقف. أضف `--follow` لانتظار أحداث جديدة حتى تضغط Ctrl+C. يُبقي `--types artifact.*,stage.added` الأنواع أو البادئات المحددة، ويقصر `--repository releases` التغذية على مستودع واحد، ويبدأ `--after <id>` بعد الحدث المحدد.

في TypeScript، يقرأ `follow` صفحة بعد أخرى ويستدعي `save` بعد كل حدث عالجته:

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

عبر HTTP:

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

تحتوي الاستجابة على `items` و`next` و`head` و`oldest` و`epoch`. مرّر `next` كقيمة `after` في الطلب التالي. من دون `after`، تبدأ التغذية من أقدم حدث يحتفظ به الخادم. يُرجع الطلب ما يصل إلى `limit` حدثًا (1–500، والقيمة الافتراضية 100). لا تعني صفحة تحتوي على أقل من `limit` حدثًا نهاية التغذية: يفحص الطلب الواحد ما لا يزيد على 5000 حدث، لذا تكون قد قرأت كل شيء عندما يساوي الموضع في `next` قيمة `head`. راجع [listEvents](../api/reference/events#listEvents).

## الحدث {#event}

```json
{
  "specversion": "1.0",
  "id": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f:42",
  "source": "/arkvory/studio/repositories/releases",
  "type": "arkvory.artifact.published.v1",
  "subject": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
  "time": "2026-10-17T09:30:00.000Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:arkvory:event:artifact.published:1",
  "partitionkey": "repository:releases",
  "arkvoryposition": "42",
  "arkvoryepoch": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f",
  "data": {
    "repository": "releases",
    "artifactId": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
    "name": "game.upack",
    "size": "73400320",
    "sha256": "d563c767a739c2a9066a2668341a473c4cb0dcbc106c2d533133ad8311c3c007",
    "labels": ["ci"],
    "stages": []
  }
}
```

- يبقى `id` نفسه عند كل تكرار للحدث: استخدمه لمنع معالجة النسخ المكررة.
- يحتوي `data` على معرّفات المُخرَج وحقائقه: الاسم والحجم كسلسلة عشرية وSHA-256 والتسميات والمراحل وقت الحدث وحزمة UPack. تضيف أحداث الملفات والمراحل والصور وnpm وGit LFS المسار أو المرحلة أو الصورة مع ملخصها أو وسمها أو حزمة npm أو معرّف الكائن.
- لا يتضمن الحدث أبدًا قيم بيانات التعريف أو المستخدم الذي أجرى التغيير أو الأسرار أو محتويات الملفات. إذا كانت التسميات ستجعل حجم `data` يتجاوز 8 KiB، تُحذف منه وتكون `truncated` بقيمة `true`.
- يسرد `GET /api/v1/events/types` جميع الأنواع مع JSON Schema الخاص بحقل `data` لكل منها.

| المجموعة       | الأنواع                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| المُخرَجات       | `artifact.published`، `artifact.deleted`، `artifact.promoted`، `artifact.received`  |
| الملفات والحزم | `asset.revision.created`، `asset.restored`، `package.registered`                    |
| الأوصاف        | `annotation.updated`، `attachments.updated`، `stage.added`، `stage.removed`         |
| صور الحاويات   | `oci.manifest.pushed`، `oci.manifest.deleted`، `oci.tag.updated`، `oci.tag.deleted` |
| npm وGit LFS   | `npm.version.published`، `npm.tag.updated`، `npm.tag.deleted`، `lfs.object.stored`  |

## الترتيب والأذونات {#order}

- تأتي أحداث المستودع الواحد بترتيب تثبيت تغييراته (`partitionkey`). بين المستودعات، تبيّن المواضع ترتيب ظهور الأحداث، ولا تبيّن علاقة السبب والنتيجة.
- تتزايد المواضع لكنها قد تتخطى أرقامًا. لا تفترض أنها متتابعة بلا فجوات.
- يظهر الحدث في التغذية بعد نحو نصف ثانية من تغييره، بعد أن يرقّمه العامل. عندما يكون العامل متوقفًا، تنتظر الأحداث ولا يُفقد شيء.
- ترى أحداث المستودعات التي يملك فيها مفتاحك أو حسابك الإذن `artifact.list`، وهو الحق نفسه المطلوب لـ[تغذية التغييرات](../api/reference/artifacts#listCatalogChanges). تُفحص الأذونات في كل طلب، لذا يخفي إبطال الحق الأحداث فورًا.
- يتجاوز `next` أيضًا الأحداث التي لا يُسمح لك برؤيتها، بحد أقصى 5000 حدث لكل طلب، لكي يواصل المفتاح ذو الصلاحيات المحدودة التقدم. وهو لا يكشف إلا أن الخادم كانت لديه أحداث أخرى في تلك المواضع.

## الاحتفاظ والاستعادة {#retention}

يحتفظ الخادم بالأحداث لمدة 168 ساعة وبحد أقصى 5 000 000 حدث (`ARKVORY_EVENTS_RETENTION_HOURS` و`ARKVORY_EVENTS_MAX_ROWS`، راجع [متغيرات البيئة](../reference/environment)). التغذية نافذة زمنية وليست سجلًا تاريخيًا: يحتفظ سجل تدقيق الفهرس بالمحفوظات. لا تشمل النسخ الاحتياطية الأحداث.

| الاستجابة                              | ما حدث                                                         | الإجراء                                                     |
| -------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| `410`، `gone/events_cursor_expired`    | مؤشرك أقدم من `oldest`                                         | اقرأ الحالة الحالية عبر API، ثم واصل من `oldest`            |
| `409`، `conflict/events_epoch_changed` | استُعيد الخادم من نسخة احتياطية وبدأت مواضعه حقبة `epoch` جديدة | اقرأ الحالة الحالية، ثم واصل من دون مؤشر أو من الرأس الجديد |

تحمل الاستجابتان الحقل `events` مع القيم الحالية لـ`epoch` و`oldest` و`head`؛ وصيغة المؤشر هي `<epoch>:<position>`. ينتهي `arkvoryctl events tail` برمز الخروج 6، وتطرح SDK الخطأ مع الحقول نفسها.

## خطافات الويب {#webhooks}

تواصل [خطافات الويب](./webhooks) إرسال تغذية التغييرات لمستودع واحد إلى عنوان HTTP. لا تحل تغذية الأحداث محلها.
