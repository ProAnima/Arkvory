---
title: الحسابات والوصول
description: إنشاء المستخدمين والمجموعات، ومنحهم الوصول إلى المستودعات، وإصدار رموز وصول شخصية ومفاتيح خدمة للتكامل المستمر.
---

# الحسابات والوصول

يتعامل Arkvory مع أربعة أنواع من بيانات الاعتماد. يسجّل المستخدمون الدخول بكلمة مرور. وتستخدم أدواتهم الخاصة رموز وصول شخصية. وتستخدم أنظمة التكامل المستمر (CI) ووكلاء النشر مفاتيح خدمة. وينشئ برنامج التثبيت مفتاحًا إضافيًا، هو مفتاح الاسترداد، للإعداد والطوارئ. يتحقق الخادم من كل طلب وفق بيانات الاعتماد المرفقة به.

## من يستطيع تنفيذ كل إجراء {#overview}

| بيانات الاعتماد | من ينشئها                    | مدة الصلاحية                         | الإدارة                                                | الوصول إلى المستودعات                         |
| --------------- | ---------------------------- | ------------------------------------ | ------------------------------------------------------ | --------------------------------------------- |
| جلسة بكلمة مرور | تسجيل الدخول                 | 12 ساعة                              | المستخدمون والمجموعات، إذا كان الحساب مسؤولًا           | قراءة أو كتابة لكل مستودع، عبر المجموعات      |
| رمز وصول شخصي   | أنت، من جلسة بكلمة مرور      | 90 يومًا افتراضيًا، وبحد أقصى 365 يومًا | لا يتيح الإدارة مطلقًا                                  | مجموعاتك، مع إمكانية الاقتصار على القراءة     |
| مفتاح خدمة      | مفتاح الاسترداد أو مشغّل مفوَّض | 90 يومًا افتراضيًا، وبحد أقصى 365 يومًا | ما فوّضه المالك فقط                                     | سياسة حساب الخدمة، مع تضييقها بأذونات المفتاح |
| مفتاح الاسترداد | برنامج التثبيت               | حتى تستبدله                          | المستخدمون والمجموعات وحسابات الخدمة والنسخ الاحتياطية | قراءة وكتابة في `releases`                    |

هناك ثلاث نقاط قد يغفل عنها القارئ:

- يدير حساب المسؤول المستخدمين والمجموعات. ولا يمنح الوصول إلى الملفات. يكون الوصول إلى الملفات عبر منح المجموعات فقط.
- يُنشأ مفتاح الخدمة باستخدام مفتاح الاسترداد أو مفتاح مشغّل، وليس من جلسة بكلمة مرور. لا يستطيع المسؤول الذي سجّل الدخول بكلمة مرور إنشاء حسابات خدمة.
- لا يستطيع رمز وصول شخصي أو مفتاح خدمة إنشاء مستخدمين أو مجموعات أو رموز أخرى مطلقًا.

## المالك ومفتاح الاسترداد {#owner}

الحساب الأول هو المالك، وهو مسؤول. ينشئه معالج الإعداد على Windows. وعلى Linux وDocker، تنشئه في وحدة التحكم باستخدام مفتاح الاسترداد، كما هو موضح في [وحدة التحكم على الويب](../guide/console#the-first-owner).

المالك عضو في المجموعة `arkvory-owners` التي تملك إذن الكتابة في المستودع `releases`. لأي مستودع آخر، امنح مجموعةً الوصول إليه بنفسك. راجع [المجموعات والوصول إلى المستودعات](#groups).

مفتاح الاسترداد هو الملف `config/bootstrap-token.txt` في دليل التثبيت. لا يستطيع قراءته إلا مسؤول الخادم. لا تنسخه إلى CI أو أجهزة العملاء. تقرؤه أدوات التثبيت والتحديث، لذا لا تحذفه. راجع [الأمان](../operate/security).

## إنشاء مستخدمين {#users}

لا ينشئ المستخدمين إلا المسؤولون. يتكون الاسم من 3 إلى 64 حرفًا أو رقمًا أو من الرموز `.` أو `_` أو `-`. وتتكون كلمة المرور من 12 إلى 128 حرفًا. يستوعب التثبيت 1000 حساب كحد أقصى.

في وحدة التحكم:

1. سجّل الدخول بصفتك مسؤولًا وافتح [[ui:administration]].
2. وسّع [[ui:createUser]].
3. أدخل [[ui:accountName]] و[[ui:password]]. حدّد [[ui:administrator]] فقط لمن يديرون المستخدمين.
4. اختر [[ui:createUser]].

يسرد جدول [[ui:accountsHeading]] الحسابات. يحظر [[ui:disableUser]] حسابًا: تنتهي جلساته فورًا وتتوقف رموز وصوله الشخصية عن العمل حتى تختار [[ui:enableUser]]. لتعيين كلمة مرور جديدة لشخص، وسّع [[ui:resetPassword]]. وينهي ذلك جلسات الحساب ويبطل جميع رموز وصوله الشخصية.

في API، تستدعي جلسة مسؤول أو مفتاح الاسترداد هذه العمليات: `createUser` و`updateUser` و`listUsers`.

```bash
curl -X POST "$ARKVORY/api/v1/users" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here","administrator":false}'
```

```typescript
await client.administration.users.create('anna', 'a long password here', false);
```

لا يتضمن `arkvoryctl` أوامر للحسابات. استخدم وحدة التحكم أو API.

التسجيل الذاتي معطّل افتراضيًا. يفعّله مسؤول الخادم باستخدام `ARKVORY_ALLOW_REGISTRATION=true` (راجع [متغيرات البيئة](../reference/environment)). عندئذ يظهر [[ui:signUp]] على بطاقة تسجيل الدخول. لا يملك الحساب الجديد الوصول إلى أي مستودع حتى يضيفه مسؤول إلى مجموعة. يتوقف التسجيل الذاتي عند 900 حساب، لتبقى 100 خانة متاحة للمسؤولين.

## المجموعات والوصول إلى المستودعات {#groups}

يحصل المستخدمون على الوصول عبر المجموعات. للمجموعة أعضاء، ومستوى وصول واحد لكل مستودع:

| المستوى في وحدة التحكم | المعنى                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| [[ui:read]]            | العرض والتنزيل                                                                           |
| [[ui:write]]           | كل ما تتيحه القراءة، بالإضافة إلى الرفع والنشر وتغيير بيانات التعريف والترقية والاستعادة |

لا يحتاج المستودع إلى خطوة إنشاء منفصلة. يوجد بمجرد ذكر اسمه في منحة وصول أو سياسة خدمة. يستخدم اسمه أحرفًا لاتينية صغيرة وأرقامًا و`-` و`_`، ويبدأ بحرف أو رقم، ولا يتجاوز 64 حرفًا. راجع [المستودعات](./repositories).

في وحدة التحكم، افتح [[ui:administration]]:

1. وسّع [[ui:createGroup]]، وأدخل اسم [[ui:accessGroup]] (من 2 إلى 64 حرفًا أو رقمًا أو من الرموز `.` أو `_` أو `-`) ثم اختر [[ui:createGroup]].
2. وسّع [[ui:manageMembers]]، واختر المجموعة والحساب، ثم اختر [[ui:addMember]]. يزيل [[ui:removeMember]] الحساب من المجموعة.
3. وسّع [[ui:manageGrants]]، واختر المجموعة، واكتب اسم [[ui:repository]]، واختر مستوى [[ui:access]] ثم اختر [[ui:saveGrant]]. يزيل [[ui:removeGrant]] حق الوصول.

يعرض الجدول أسفل النماذج [[ui:members]] و[[ui:grants]] لكل مجموعة. يسري حذف عضو أو منحة وصول بدءًا من الطلب التالي للحساب. وتبقى الملفات في مواضعها.

يستوعب التثبيت 100 مجموعة و10 000 عضوية و10 000 منحة وصول إجمالًا كحد أقصى.

في API، العمليات هي `createAccessGroup` و`addGroupMember` و`removeGroupMember` و`setGroupGrant` و`removeGroupGrant`:

```bash
curl -X PUT "$ARKVORY/api/v1/access-groups/$GROUP_ID/grants/builds" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"access":"write"}'
```

```typescript
await client.administration.groups.setGrant(groupId, 'builds', 'write');
```

## الأذونات {#permissions}

وراء مستويي القراءة والكتابة 24 إجراءً للمستودع. يحدد مفتاح الخدمة هذه الإجراءات واحدًا واحدًا. يعرض `arkvoryctl doctor` و`GET /api/v1/auth/permissions` الإجراءات التي تملكها بيانات الاعتماد الحالية في كل مستودع.

| الإجراء            | التسمية في وحدة التحكم             | ما يتيحه                                                    |
| ------------------ | ---------------------------------- | ----------------------------------------------------------- |
| `repository.read`  | [[ui:permission.repository.read]]  | سرد المستودعات وعرض حقوقك الخاصة، دون الوصول إلى الملفات    |
| `artifact.list`    | [[ui:permission.artifact.list]]    | سرد المُخرَجات والبحث فيها، وقراءة قائمة المراحل وسجل الترقية |
| `artifact.read`    | [[ui:permission.artifact.read]]    | تفاصيل مُخرَج واحد ومراحله ومحفوظات ترقيته                    |
| `content.read`     | [[ui:permission.content.read]]     | تنزيل البايتات وإنشاء روابط تنزيل وتحديد حزمة لتنزيلها      |
| `upload.create`    | [[ui:permission.upload.create]]    | بدء عملية رفع                                               |
| `upload.read`      | [[ui:permission.upload.read]]      | قراءة حالة عملية الرفع الخاصة بك وأجزائها                   |
| `upload.write`     | [[ui:permission.upload.write]]     | إرسال بايتات عملية الرفع الخاصة بك                          |
| `upload.complete`  | [[ui:permission.upload.complete]]  | إنهاء عملية الرفع الخاصة بك وبدء مهمة إكمال                 |
| `upload.cancel`    | [[ui:permission.upload.cancel]]    | إلغاء عملية الرفع الخاصة بك                                 |
| `job.read`         | [[ui:permission.job.read]]         | قراءة مهمة الإكمال الخاصة بك                                |
| `package.read`     | [[ui:permission.package.read]]     | سرد حزم UPack وتحديد إصدار                                  |
| `package.publish`  | [[ui:permission.package.publish]]  | تسجيل أرشيف مرفوع بوصفه حزمة                                |
| `asset.read`       | [[ui:permission.asset.read]]       | قراءة مسارات الملفات ومحفوظاتها ومراجعاتها                  |
| `asset.write`      | [[ui:permission.asset.write]]      | جعل مُخرَج المحتوى الحالي لمسار                               |
| `asset.restore`    | [[ui:permission.asset.restore]]    | استعادة مراجعة سابقة لمسار                                  |
| `annotation.read`  | [[ui:permission.annotation.read]]  | قراءة التسميات وبيانات التعريف والتجميعات والمرفقات         |
| `annotation.write` | [[ui:permission.annotation.write]] | تغيير التسميات وبيانات التعريف والتجميعات والمرفقات         |
| `artifact.promote` | [[ui:permission.artifact.promote]] | إضافة المراحل وإزالتها والترقية إلى المستودع                |
| `reference.write`  | [[ui:permission.reference.write]]  | إضافة مرجع خارجي خاص بك على مُخرَج وإزالته                    |
| `audit.read`       | [[ui:permission.audit.read]]       | قراءة سجل تدقيق فهرس المستودع                               |
| `artifact.delete`  | [[ui:permission.artifact.delete]]  | فحص المُخرَجات وحذفها، ومعاينة الاحتفاظ وتطبيقه               |
| `storage.read`     | [[ui:permission.storage.read]]     | قراءة سياسة التخزين والاستخدام وإعدادات التنظيف             |
| `storage.manage`   | [[ui:permission.storage.manage]]   | تغيير سياسة التخزين وإعدادات التنظيف وتشغيلها               |
| `diagnostics.read` | [[ui:permission.diagnostics.read]] | قراءة أحداث التخزين                                         |

تُطابق مستويات المجموعة الإجراءات كما يلي:

- تمنح **القراءة** `repository.read` و`artifact.list` و`artifact.read` و`content.read` و`package.read` و`asset.read` و`annotation.read`.
- تمنح **الكتابة** كل ما تتيحه القراءة، بالإضافة إلى `upload.create` و`upload.read` و`upload.write` و`upload.complete` و`upload.cancel` و`job.read` و`package.publish` و`asset.write` و`asset.restore` و`annotation.write` و`artifact.promote` و`reference.write` و`audit.read`.
- **لا يمنح أي مستوى مجموعة** `artifact.delete` و`storage.read` و`storage.manage` و`diagnostics.read`. يُتاح حذف المُخرَجات وإدارة التخزين لمفاتيح الخدمة التي تنص على هذه الإجراءات. راجع [التخزين والاحتفاظ](../operate/storage).

المرآة نسخة للقراءة فقط من مستودع آخر ([المرايا](../operate/mirrors)). يُرفض كل إجراء يغيّرها مع `409 mirror_read_only`، مهما كانت منح الوصول.

## كلمات المرور والجلسات {#passwords}

سجّل الدخول باستخدام [[ui:accountName]] و[[ui:password]] في بطاقة [[ui:connection]]. تستمر الجلسة 12 ساعة. وينهيها [[ui:disconnect]].

لتغيير كلمة مرورك، استخدم [[ui:changeOwnPassword]] في البطاقة نفسها. أدخل [[ui:currentPassword]] و[[ui:newPassword]]. تنتهي جميع جلساتك ورموز وصولك الشخصية، لذا تسجّل الدخول مجددًا وتنشئ رموزًا جديدة. يستطيع المسؤول إعادة تعيين كلمة مرور حساب آخر دون معرفة الكلمة القديمة.

يبطئ الخادم محاولات التخمين:

- يمكن لعنوان شبكة واحد محاولة تسجيل الدخول 10 مرات دفعة واحدة، ثم محاولة إضافية كل 15 ثانية.
- بعد إدخال كلمات مرور خاطئة كثيرة لحساب واحد، ينتظر الحساب مددًا متزايدة، حتى دقيقتين. وحتى كلمة المرور الصحيحة تُرفض أثناء الانتظار. الاستجابة هي `429 rate_limited` مع `Retry-After`.
- عند استخدام وكيل عكسي، يُدرجه المسؤول في `ARKVORY_TRUSTED_PROXIES`. وإلا يتشارك جميع المستخدمين عنوانًا واحدًا.

في API، تستبدل `login` الاسم وكلمة المرور بجلسة تُستخدم بوصفها رمز حامل، وتغيّر `changeOwnPassword` كلمة المرور:

```bash
curl -X POST "$ARKVORY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here"}'
```

## رموز الوصول الشخصية {#tokens}

رمز الوصول الشخصي مفتاح لأدواتك الخاصة: برنامج نصي على حاسوبك أو `arkvoryctl` أو SDK. يعمل بهويتك، مع مستودعات مجموعاتك.

لا تنشئ الرموز إلا جلسة بكلمة مرور. لا يستطيع الرمز إنشاء رمز آخر ولا يملك حقوق مسؤول.

1. سجّل الدخول بكلمة مرورك.
2. في بطاقة [[ui:connection]]، وسّع [[ui:personalAccessTokens]].
3. أدخل [[ui:tokenName]]. اختر [[ui:tokenExpiry]]: [[ui:tokenDays30]] أو [[ui:tokenDays90]] أو [[ui:tokenDays365]].
4. اختر [[ui:tokenScope]]: [[ui:tokenScopeRead]] أو [[ui:tokenScopeReadWrite]]. يرفض رمز القراءة كل تغيير مع `403 read_only_token`.
5. اختر [[ui:generateToken]] ثم [[ui:copyToken]]. يُعرض الرمز مرة واحدة. ويبدأ بـ`pat_`.

يعرض الجدول [[ui:tokenPrefix]] و[[ui:tokenCreated]] و[[ui:tokenExpires]] و[[ui:tokenLastUsed]] و[[ui:tokenStatus]] لكل رمز: [[ui:tokenActive]] أو [[ui:tokenExpired]] أو [[ui:tokenRevokedState]]. لإيقاف رمز، اختر [[ui:revokeToken]] وأكّد باستخدام [[ui:tokenRevokeConfirmSubmit]]. يفقد العملاء الذين يستخدمونه الوصول فورًا.

يمكن للحساب امتلاك 50 رمزًا نشطًا. يستطيع المسؤول سرد رموز أي حساب وإبطالها باستخدام `listAccountTokens` و`revokeAccountToken`.

في API، للرمز اسم، ويمكن تحديد انتهاء صلاحيته (حتى 365 يومًا من الآن) ونطاقه اختياريًا:

```bash
curl -X POST "$ARKVORY/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name":"laptop","scope":"read-write","expiresAt":"2027-01-31T00:00:00Z"}'
```

```typescript
const created = await client.identity.createToken('laptop', { scope: 'read-write' });
console.log(created.token); // يُعرض مرة واحدة
```

النطاق الافتراضي في API هو `read-write`. وتختار وحدة التحكم [[ui:tokenScopeRead]] مسبقًا.

مرّر الرمز إلى `arkvoryctl` في ملف خاص. راجع [سطر الأوامر](../protocols/cli#connect-to-a-server).

## حسابات الخدمة ومفاتيح CI {#service-accounts}

حساب الخدمة هوية لأداة، وليس لشخص. وله **سياسة** تحدد المستودعات والإجراءات التي يمكنه استخدامها. يمتلك حساب الخدمة مفاتيح. وللمفتاح أيضًا قائمته الخاصة بالمستودعات والإجراءات. الحقوق الفعلية هي تقاطع القائمتين، إجراءً بإجراء. لا تمنح السياسة الفارغة أي وصول إلى الملفات.

تدير الوصول الخدمي باستخدام مفتاح الاسترداد أو مفتاح مشغّل فوّض إليه المالك حقوقًا. في وحدة التحكم:

1. اختر [[ui:disconnect]] إذا كنت قد سجّلت الدخول. ثم افتح [[ui:keySignIn]]، والصق مفتاح الاسترداد في [[ui:serviceKey]] واختر [[ui:connect]].
2. افتح [[ui:services]]. لا يظهر هذا القسم إلا لمفتاح الاسترداد ومفاتيح المشغّلين.

### إنشاء حساب وسياسته {#service-policy}

1. في [[ui:services]]، وسّع [[ui:serviceCreate]].
2. أدخل [[ui:serviceName]] (من 3 إلى 64 حرفًا أو رقمًا أو من الرموز `.` أو `_` أو `-`).
3. تحت [[ui:servicePolicy]]، اختر [[ui:bindingAdd]] واكتب اسم [[ui:repository]].
4. عيّن الأذونات: يضبط [[ui:bindingRead]] و[[ui:bindingPublish]] مجموعتين شائعتين، ويمسحهما [[ui:bindingNone]]، ويسرد [[ui:bindingPermissions]] كل إجراء. اختر [[ui:bindingRemove]] لإزالة مستودع.
5. اختر [[ui:serviceCreate]].

الإعدادان المسبقان هما:

| الإعداد المسبق        | الإجراءات                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:bindingRead]]    | `repository.read`، `artifact.read`، `artifact.list`، `content.read`، `package.read`، `asset.read`، `annotation.read`                                                              |
| [[ui:bindingPublish]] | مجموعة القراءة، بالإضافة إلى `upload.create` و`upload.read` و`upload.write` و`upload.complete` و`upload.cancel` و`job.read` و`package.publish` و`asset.write` و`annotation.write` |

لا يتضمن أي من الإعدادين الترقية أو الاستعادة أو الحذف. أضف `artifact.promote` لمهمة ترقية. يحتاج وكيل نشر يقتصر على التنزيل إلى مجموعة القراءة لاستخدام `arkvoryctl`. أما تنزيل حزمة باسمها عبر HTTP مباشرةً، فيكفيه `content.read` وحده.

تضم السياسة 64 مستودعًا كحد أقصى، ويضم التثبيت 1000 حساب خدمة كحد أقصى. للسياسة المحفوظة إصدار. إذا غيّرها شخص آخر في الأثناء، تعرض وحدة التحكم تعارضًا وتحتفظ بمسودتك: اختر [[ui:serviceRefresh]] وطبّق تغييرك مجددًا. يحظر [[ui:serviceDisable]] جميع مفاتيح الحساب. وقد تكتمل عمليات النقل الجارية بالفعل.

### إصدار مفتاح وحفظه وتفعيله {#service-key-issue}

1. افتح الحساب و[[ui:serviceKeys]] الخاصة به.
2. وسّع [[ui:keyIssue]]. أدخل [[ui:keyName]]. اضبط انتهاء الصلاحية في [[ui:keyExpiry]] أو اتركه فارغًا لمدة 90 يومًا. أطول مدة صلاحية هي 365 يومًا.
3. ضيّق الأذونات إذا احتاج المفتاح إلى أقل مما يملكه الحساب. اختر [[ui:keyIssue]].
4. تعرض نافذة [[ui:keySecret]] السر مرة واحدة. اختر [[ui:keyCopy]] واحفظه في مخزن أسرار CI. يبدأ السر بـ`arkvory_`.
5. حدّد [[ui:keySaved]] واختر [[ui:keyActivate]].

المفتاح غير المفعّل لا يعمل وتنتهي صلاحيته بعد 15 دقيقة. يظهر بالحالة [[ui:keyPending]] حتى تفعّله. يمكن للحساب امتلاك 3 مفاتيح نشطة ومفتاحين معلّقين في الوقت نفسه. الحالات هي [[ui:keyPending]] و[[ui:keyActive]] و[[ui:keyRevoked]] و[[ui:keyExpired]]؛ ويسرد [[ui:keyDetails]] معرّف المفتاح وأذوناته.

إذا فُقدت الاستجابة قبل نسخ السر، فلن يستطيع الخادم عرضه مجددًا. أبطل المفتاح وأصدر آخر.

في API، ينشئ مفتاح الاسترداد الحساب ثم يصدر المفتاح. يجعل الرأس `Idempotency-Key` (من 1 إلى 128 حرفًا أو رقمًا أو من الرموز `.` أو `_` أو `:` أو `-`) تكرار الطلب آمنًا، لكن الطلب المكرر لا يعيد السر. يفعّل المفتاح نفسه باستدعاء `activateServiceKey`:

```bash
curl -X POST "$ARKVORY/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-prod","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["repository.read","artifact.read","artifact.list","content.read","package.read","upload.create","upload.read","upload.write","upload.complete","job.read","package.publish","asset.read","asset.write"]}]}'

curl -X POST "$ARKVORY/api/v1/service-accounts/$ACCOUNT_ID/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: ci-prod-2026-10" \
  -d '{"name":"pipeline-2026","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["content.read","package.read","artifact.read"]}]}'

curl -X POST "$ARKVORY/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

الخطوات نفسها في SDK:

```typescript
const account = await root.administration.services.create('ci-prod', bindings);
const issued = await root.administration.credentials.issue(account.id, requestId, {
  name: 'pipeline-2026',
  bindings,
});
if (!issued.secret) throw new Error('Lost response: revoke the key and issue another');
await saveToSecretStore(issued.secret);
await new ArkvoryClient(url, () => issued.secret ?? '').identity.activateKey();
```

مرّر المفتاح المفعّل إلى المهمة عبر `ARKVORY_TOKEN_FILE` أو `ARKVORY_TOKEN`. راجع [مثال CI](../protocols/cli#ci-example).

### التدوير والإبطال {#service-key-rotate}

دوّر المفتاح قبل انتهاء صلاحيته، دون انقطاع:

1. بجانب المفتاح، اختر [[ui:keyRotate]]. يُملأ النموذج بأذونات المفتاح القديم. ويمكنك فقط الإبقاء عليها أو تقليلها.
2. أصدر المفتاح الجديد واحفظ سره وفعّله.
3. حوّل مهامك إلى السر الجديد.
4. اختر [[ui:keyRevoke]] للمفتاح القديم.

يحدّ تفعيل المفتاح الجديد صلاحية القديم بحد أقصى 24 ساعة إضافية، حتى لا يستمر مفتاح قديم منسي في العمل. الإبطال نهائي ويطلب اسم المفتاح. تُرفض الطلبات الجديدة بالمفتاح فورًا. وقد تكتمل عمليات النقل الجارية بالفعل. في API، العمليتان هما `rotateServiceKey` و`revokeServiceKey`.

يعرض [[ui:serviceAudit]] في الحساب من أصدر المفاتيح وفعّلها ودوّرها وأبطلها، مع الوقت. ولا يحتفظ بأسرار. يحتفظ الخادم بأحدث 100 000 حدث لجميع الحسابات.

### الإدارة المفوَّضة {#delegation}

لا تستخدم مفتاح الاسترداد في العمل اليومي. يستطيع المالك تفويض أجزاء من إدارة الخدمات إلى **مفتاح مشغّل**، والإبقاء على مفتاح الاسترداد دون اتصال.

1. باستخدام مفتاح الاسترداد، أنشئ حساب خدمة للمشغّل بسياسة فارغة، وأصدر مفتاحًا له وفعّله.
2. افتح [[ui:serviceKeys]] لذلك الحساب واختر [[ui:delegations]] على المفتاح.
3. وسّع [[ui:delegationNew]]. أدخل [[ui:delegationTarget]]، وهو الحساب الذي سيديره المشغّل.
4. حدّد [[ui:delegationActions]] واضبط [[ui:delegationCeiling]]، وهو أقصى ما يمكن للمشغّل منحه في المستودعات.
5. اختر [[ui:delegationSave]].

الإجراءات السبعة هي:

| الإجراء                  | التسمية في وحدة التحكم                   | ما يُسمح للمشغّل به               |
| ------------------------ | ---------------------------------------- | ------------------------------- |
| `service-account.read`   | [[ui:permission.service-account.read]]   | عرض الحساب                      |
| `service-account.manage` | [[ui:permission.service-account.manage]] | تمكينه وتعطيله                  |
| `policy.read`            | [[ui:permission.policy.read]]            | قراءة سياسته                    |
| `policy.manage`          | [[ui:permission.policy.manage]]          | استبدال سياسته                  |
| `credential.read`        | [[ui:permission.credential.read]]        | سرد مفاتيحه                     |
| `credential.manage`      | [[ui:permission.credential.manage]]      | إصدار مفاتيحه وتدويرها وإبطالها |
| `service-audit.read`     | [[ui:permission.service-audit.read]]     | قراءة سجل نشاطه                 |

القواعد:

- يجب أن يبقى كل ما يعيّنه المشغّل ضمن الحد الأعلى. وتنتهي صلاحية أي مفتاح يصدره في موعد لا يتجاوز انتهاء صلاحية مفتاحه هو.
- يستطيع المشغّل إصدار مفاتيح للحساب المستهدف، لذا اعتبر التفويض ثقةً بكل ما يسمح به الحد الأعلى.
- لا يستطيع المشغّل إدارة حسابه الخاص أو التفويض إلى غيره. ولا يمكن أن يكون الحساب مستهدفًا ومشغّلًا في الوقت نفسه.
- لا يؤدي حذف التفويض باستخدام [[ui:delegationRemove]] إلى إبطال المفاتيح التي فعّلها المشغّل بالفعل. أبطلها بنفسك.
- يرى المشغّل تفويضاته الخاصة في [[ui:delegationOwn]].

لا يضبط التفويضات إلا مفتاح الاسترداد. العمليات هي `listServiceDelegations` و`setServiceDelegation` و`removeServiceDelegation`.

## التدقيق {#audit}

يستطيع المسؤولون قراءة سجل الأمان للتثبيت: عمليات تسجيل الدخول وإخفاقاتها، والتسجيل، وتغيير كلمات المرور وإعادة تعيينها، وتغييرات المستخدمين والمجموعات ومنح الوصول، وإنشاء الرموز وإبطالها. يتضمن كل إدخال الوقت والجهة المنفّذة ونوع بيانات الاعتماد وعنوان العميل والهدف والنتيجة (`success` أو `failure` أو `denied`). ولا يتضمن كلمات مرور أو أسرارًا. يحتفظ الخادم بالإدخالات لمدة 365 يومًا أو حتى 1 000 000 إدخال، أيهما يتحقق أولًا.

لا تتضمن وحدة التحكم شاشة لهذا السجل. اقرأه عبر API باستخدام جلسة مسؤول أو مفتاح الاسترداد. تضم الصفحات 50 إدخالًا افتراضيًا و100 كحد أقصى، بدءًا بالأحدث. مرّر `next` بوصفه `after` للصفحة التالية.

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" "$ARKVORY/api/v1/security/audit?limit=20"
```

```typescript
const page = await client.administration.security.audit({ limit: 20 });
```

سجل نشاط حساب الخدمة منفصل. راجع [إصدار مفتاح وحفظه وتفعيله](#service-key-issue).

## إذا تعذّر على المالك الدخول {#recovery}

عندما لا يستطيع أحد تسجيل الدخول بصفة مسؤول، استخدم مفتاح الاسترداد:

1. اقرأ المفتاح على الخادم: `config/bootstrap-token.txt` في دليل التثبيت. لا يستطيع ذلك إلا مسؤول الخادم.
2. في وحدة التحكم، افتح [[ui:keySignIn]]، والصق المفتاح في [[ui:serviceKey]] واختر [[ui:connect]].
3. افتح [[ui:administration]]. وسّع [[ui:resetPassword]]، واختر الحساب، وأدخل [[ui:newPassword]] ثم اختر [[ui:resetPassword]]. إذا ظهر الحساب معطّلًا، فاختر [[ui:enableUser]].
4. سجّل الدخول بكلمة المرور الجديدة.

يمكنك أيضًا إنشاء مسؤول جديد باستخدام [[ui:createUser]] وتحديد [[ui:administrator]].

لا يعمل نموذج [[ui:welcomeOwner]] إلا عندما يخلو التثبيت من الحسابات. بعد ذلك، استخدم مفتاح الاسترداد لإصلاح الحسابات، وليس للبدء من جديد.

إذا فُقد مفتاح الاسترداد نفسه، يستبدل مسؤول الخادم قيمة SHA-256 الخاصة بالمفتاح في `config/keys.json` ويعيد تشغيل API. راجع [الأمان](../operate/security).

## صفحات ذات صلة {#related-pages}

- [وحدة التحكم على الويب](../guide/console)
- [المستودعات](./repositories)
- [سطر الأوامر (arkvoryctl)](../protocols/cli)
- [المصادقة](../api/authentication) ومرجع API: [الحسابات وتسجيل الدخول](../api/reference/accounts)، [حسابات الخدمة والمفاتيح](../api/reference/services)
- [الأمان](../operate/security)
