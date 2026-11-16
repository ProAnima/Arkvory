---
title: المراحل والترقية
description: تعليم نسخ البناء بمراحل، وترقيتها إلى مستودع آخر، وإتاحة اختيار أحدث نسخة بناء لمرحلة لوكيل النشر.
---

# المراحل والترقية

تنتقل نسخة البناء من التكامل المستمر (CI) إلى بيئة الإنتاج على خطوات: الاختبار ثم الاعتماد ثم الإصدار. يوفر Arkvory أداتين لذلك. **المرحلة** علامة على نسخة بناء، مثل `qa` أو `release`. وتنشر **الترقية** نسخة بناء في مستودع آخر دون إعادة إرسال البايتات. استخدم أيًا منهما أو كليهما معًا.

## المراحل والمستودعات {#concepts}

- تحدد **المرحلة** أين اعتُمدت نسخة البناء. يمكن أن تحمل نسخة البناء عدة مراحل، حتى 16 مرحلة. تنتمي المراحل إلى نسخة بناء في مستودع واحد. ولا تغيّرها إلا عمليات المراحل، ويُسجَّل كل تغيير في سجل مع الكاتب وتعليق اختياري.
- تنسخ **الترقية** نسخة بناء أو تنقلها من مستودع إلى آخر، مثلًا من `dev` إلى `staging` إلى `prod`. تكون النسخة مُخرَجًا جديدًا في المستودع الهدف. ولا تُرفع أي بايتات.
- **التسمية** علامة حرة فقط، دون محفوظات. والمرحلة علامة مضبوطة يمكن للنشر الاستناد إليها. راجع [الملفات حسب المسار](./files#labels).

يتكون اسم المرحلة من 1 إلى 32 حرفًا: أحرف صغيرة أو أرقام أو `.` أو `_` أو `-`، ويبدأ بحرف أو رقم. لا يمكن حذف نسخة بناء لها مرحلة، ويُبقي عليها الاحتفاظ. أزل المرحلة أولًا.

## إضافة المراحل وإزالتها {#stages}

في وحدة التحكم، افتح المُخرَج في [[ui:metadata]]. يعرض قسم [[ui:promotionTitle]] العنصر [[ui:stagesTitle]] مع مراحل نسخة البناء. أدخل [[ui:stageName]]، وإذا رغبت، [[ui:stageComment]]، ثم اختر [[ui:stageAdd]]. لكل مرحلة زر لإزالتها، وتطلب وحدة التحكم التأكيد: عمليات النشر التي تطلب هذه المرحلة ستختار إصدارًا آخر.

تظهر المراحل أيضًا في الفهرس كشارات صغيرة في كل صف، وفي عمود [[ui:packageStages]] ضمن [[ui:packages]].

```bash
arkvoryctl stages add 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --comment "smoke passed" --repository dev
arkvoryctl stages list 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository dev
arkvoryctl stages remove 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --repository dev
arkvoryctl stages artifacts --stage release --repository prod
```

يسرد `stages artifacts` كل نسخة بناء لها مرحلة، أو لها مرحلة محددة، 100 في كل مرة. مرّر `next` بوصفه `--after`.

باستخدام API:

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"comment":"smoke passed"}'
curl -X DELETE "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
await dev.stages.add(id, 'qa', 'smoke passed');
const { items } = await prod.stages.artifacts({ stage: 'release' });
```

العمليات هي `setArtifactStage` و`removeArtifactStage` و`listArtifactStages` و`listStagedArtifacts`. لا تغيّر إضافة مرحلة موجودة بالفعل شيئًا: يبقى وقت الإضافة الأول والتعليق الأول. تنجح إزالة مرحلة غير موجودة. ترفض نسخة بناء لها 16 مرحلة إضافة مرحلة أخرى مع `409 stage_limit`.

## الترقية إلى مستودع آخر {#promote}

في وحدة التحكم، افتح المُخرَج. يظهر نموذج [[ui:promoteTitle]] عندما يمكنك قراءة نسخة البناء والترقية إلى مستودع آخر واحد على الأقل. اختر [[ui:promoteTarget]] من تلك المستودعات. أدخل [[ui:promoteStages]] المراد تعيينها في الهدف، مفصولة بفواصل، و[[ui:promoteComment]]. اختر [[ui:promoteSubmit]]. إذا لم يسمح أي مستودع آخر بذلك، تعرض وحدة التحكم [[ui:promoteNoTargets]].

```bash
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --move
```

يحدد `--repository` المصدر، ويحدد `--to` الهدف. تتضمن النتيجة المستودع الهدف `repository`، و`artifactId` الجديد، و`sourceArtifactId` و`mode` و`created` و`stages`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}'
```

```typescript
await staging.promotions.promote(id, { target: 'prod', mode: 'copy', stages: ['release'] });
```

الاستجابة هي `201` لنسخة جديدة، و`200` عندما تكون موجودة بالفعل في الهدف. العملية هي `promoteArtifact`.

### النسخ أو النقل {#copy-move}

|                | النسخ (الافتراضي) | النقل                                                                       |
| -------------- | ----------------- | --------------------------------------------------------------------------- |
| المصدر         | يبقى              | يُزال في الخطوة نفسها التي تُنشر فيها النسخة                                  |
| مراحل المصدر   | تبقى على المصدر   | تنتقل إلى النسخة، بالإضافة إلى المراحل التي تحددها                          |
| في وحدة التحكم |                   | حدّد [[ui:promoteMove]]. تطلب وحدة التحكم التأكيد                            |
| يُمنع عندما     |                   | يبقى المصدر مستخدمًا بواسطة مرجع خارجي أو مسار ملف أو رابط مرفق. لا يُنشر شيء |

ما تحصل عليه النسخة وما لا تحصل عليه:

- تحصل على تسميات المصدر وبيانات تعريفه وتجميعاته وهويته بصيغة UPack والمراحل التي تحددها. وهي مُخرَج جديد بمعرّف جديد. وتبقى قيمة SHA-256 نفسها.
- لا تحصل على المرفقات أو مؤشرات المسارات. اربطها مجددًا في الهدف.
- لا تُرفع أي بايتات. على الخادم نفسه، يُشارَك الملف المخزّن حتى زوال آخر مُخرَج يستخدمه.
- تُحتسَب ضمن حصة الهدف مثل عملية رفع جديدة.
- تعيد الترقية المكررة النسخة نفسها. إذا كان الهدف يحتوي بالفعل على حزمة لها المجموعة والاسم والإصدار والمجموع الاختباري نفسها، يُعاد ذلك المُخرَج. أما مع بايتات مختلفة، فيعيد الخادم `409 version_exists`.
- يجب أن يختلف الهدف عن المصدر. لا يمكن أن تكون المرآة هدفًا لأنها للقراءة فقط. راجع [المستودعات](./repositories#read-only).

تترك الترقية المنقطعة حجزًا قصير الأجل. شغّل الترقية نفسها مجددًا بالحساب نفسه للاستئناف.

## محفوظات الترقية {#history}

تعرض صفحة المُخرَج في وحدة التحكم [[ui:promotionHistory]]، بدءًا بالأقدم: من أضاف مرحلة أو أزالها، ومن نسخ نسخة البناء أو نقلها إلى مستودع آخر، ومن أين جاءت نسخة مستلَمة. يحمّل [[ui:promotionMore]] الإدخالات التالية.

```bash
arkvoryctl promotions history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository prod
arkvoryctl promotions journal --repository prod --after 120 --json
```

سجل المستودع مخصص لـCI. استعلم عنه دوريًا بتمرير آخر `sequence` رأيته إلى `--after`، فتحصل على الأحداث الجديدة بالترتيب. يتضمن الحدث `sequence`، و`action` (`stage.added` أو `stage.removed` أو `promoted` أو `received`)، و`stage` و`mode`، والمستودع والمُخرَج المقابلين، و`actor` و`comment` والوقت. تضم الصفحات حتى 100 حدث. العمليتان هما `listArtifactPromotions` و`listRepositoryPromotions`.

## اختيار نسخة بناء للنشر {#resolve}

يطلب وكيل النشر «أحدث نسخة بناء للحزمة `app` تقع ضمن النطاق `^1.4` وتحمل المرحلة `release`». يعيد Arkvory إصدارًا واحدًا بالضبط، أو `404` إذا لم يوجد أي إصدار.

```bash
arkvoryctl packages resolve app --group acme/game --range ^1.4 --stage release --repository prod --json
arkvoryctl packages download app ./app.upack --group acme/game --range ^1.4 --stage release --repository prod
```

يطبع `resolve` الاختيار دون تنزيله:

```json
{
  "group": "acme/game",
  "name": "app",
  "version": "1.4.7",
  "artifactId": "3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11",
  "sha256": "…",
  "size": "73400320",
  "publishedAt": "2026-10-01T09:30:00.000Z",
  "stagedAt": "2026-10-02T12:00:00.000Z",
  "stages": ["qa", "release"]
}
```

مع HTTP، تعيد `resolvePackage` هذه البيانات، وترسل `downloadPackageContent` بايتات الاختيار نفسه في استدعاء واحد:

```bash
curl -fL -G -H "Authorization: Bearer $DEPLOY_KEY" -o app.upack \
  --data-urlencode "name=app" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

```typescript
const found = await prod.packages.resolve({
  name: 'app',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
```

عوامل التصفية نفسها في كل أداة: اسم الحزمة `name`، و`group` (فارغة إذا لم تكن للحزمة مجموعة)، وإصدار محدد أو نطاق، و`stage`، وما إذا كان يجب تضمين الإصدارات التمهيدية، والترتيب. تُشرح النطاقات في [حزم UPack](./packages#versions).

افتراضيًا، يُختار أحدث إصدار SemVer. ومع `--order promoted` (`order=promoted` في HTTP)، يُختار الإصدار الذي أُضيفت إليه المرحلة أخيرًا، حتى لو كان رقمه أقل. يتطلب ذلك تحديد مرحلة.

يُحدَّد الاسم في كل طلب، لذا قد يعيد استدعاءان نسختي بناء مختلفتين إذا أجرى شخص ترقية بينهما. لتنزيل يحتاج إلى الاستئناف، خذ `artifactId` من `resolve` ونزّل ذلك المُخرَج.

## التراجع {#rollback}

مع الترتيب `promoted`، يكون التراجع خطوة عادية. أزل المرحلة من الإصدار المعيب، فيصبح الإصدار الذي أُضيفت إليه المرحلة قبله هو الاختيار. لجعل إصدار أقدم هو الحالي مجددًا، أزل مرحلته وأضفها مرة أخرى: إضافة مرحلة موجودة بالفعل لا تجدّد وقتها.

```bash
arkvoryctl stages remove <faulty artifact id> release --repository prod
arkvoryctl packages download app ./app.upack --stage release --order promoted --repository prod
```

## الأذونات {#permissions}

| الإجراء                           | المفاتيح: إجراءات المستودع                                         | المستخدمون: وصول المجموعة        |
| --------------------------------- | ------------------------------------------------------------------ | -------------------------------- |
| قراءة مراحل نسخة بناء ومحفوظاتها  | `artifact.read`                                                    | قراءة                            |
| سرد نسخ البناء ذات المراحل والسجل | `artifact.list`                                                    | قراءة                            |
| إضافة مرحلة أو إزالتها            | `artifact.promote` مع `artifact.read`                              | كتابة                            |
| الترقية بالنسخ                    | المصدر: `artifact.read` و`content.read`. الهدف: `artifact.promote` | قراءة في المصدر، وكتابة في الهدف |
| الترقية بالنقل                    | الأذونات نفسها، بالإضافة إلى `artifact.promote` في المصدر          | كتابة في كليهما                  |
| تحديد إصدار                       | `package.read`                                                     | قراءة                            |
| تنزيل الإصدار المختار بالاسم      | `content.read`                                                     | قراءة                            |

يحتاج مفتاح وكيل نشر يقتصر على التنزيل إلى `content.read` في المستودع الذي يقرأ منه. ولاستخدام `arkvoryctl packages download`، يحتاج أيضًا إلى `package.read` و`artifact.read`. راجع [الأذونات](./accounts#permissions).

يمكن للخوادم أيضًا تبادل نسخ البناء تلقائيًا: يستطيع مستودع استيراد الإصدارات التي تحمل مراحل معينة من مستودع على خادم آخر. راجع [المرايا](../operate/mirrors).

## صفحات ذات صلة {#related-pages}

- [حزم UPack](./packages) و[المستودعات](./repositories)
- [الحسابات والوصول](./accounts)
- [سطر الأوامر (arkvoryctl)](../protocols/cli#packages-and-promotion)
- مرجع API: [المراحل والترقية](../api/reference/promotion)
