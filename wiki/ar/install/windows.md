---
title: Windows
---

# Windows

توجد ثلاث طرق لتشغيل Arkvory على Windows:

- **برنامج التثبيت الرسومي** `Arkvory-Setup-x64.exe`. موصى به. يثبّت خدمات Windows وقاعدة بيانات PostgreSQL مخصصة. ولا يحتاج إلى إنترنت.
- **نص PowerShell البرمجي** `install.ps1`. يثبّت خدمات Windows نفسها، لكنه يستخدم خادم PostgreSQL الموجود لديك.
- **Docker Desktop** مع `install.ps1 -Mode compose`. للتجربة فقط. راجع [Docker Compose](./docker).

## المتطلبات {#requirements}

- Windows x64، الإصدار 10.0.17763 أو أحدث (Windows 10 الإصدار 1809، أو Windows Server 2019 أو أحدث).
- حساب في مجموعة Administrators.
- وحدة تخزين NTFS محلية للبيانات. المشاركات الشبكية غير مدعومة لتخزين الملفات.
- دليل تثبيت خارج ملفات تعريف المستخدمين و`AppData`. ويجب أن يتمكن حساب الخدمة من قراءة كل دليل أب.

## التثبيت باستخدام برنامج التثبيت الرسومي {#install-with-the-graphical-installer}

1. نزّل `Arkvory-Setup-x64.exe` من [GitHub Releases](https://github.com/ProAnima/Arkvory/releases).
2. شغّل الملف وأكّد مطالبة التحكم في حساب المستخدم (User Account Control).
3. اختر الإنجليزية أو الروسية ووافق على الترخيص.
4. أدخل حساب المالك. يتألف الاسم من 3 إلى 64 حرفًا: أحرف لاتينية أو أرقام أو نقطة أو شرطة أو شرطة سفلية. وتتألف كلمة المرور من 12 إلى 128 حرفًا.
5. انتظر بينما يجهّز برنامج التثبيت قاعدة البيانات والخدمات وحساب المالك.
6. في الصفحة الأخيرة، أبقِ الخيار **Open Arkvory and finish onboarding** محددًا وانقر **Finish**. تُفتح وحدة التحكم على `http://127.0.0.1:8080/console/#onboarding`.

وينشئ برنامج التثبيت أيضًا اختصارين في قائمة ابدأ (Start): **Arkvory** (وحدة التحكم) و**API and CLI** (صفحة المساعدة في وحدة التحكم).

إذا أبلغ برنامج التثبيت أن بيئة تشغيل Microsoft تتطلب إعادة تشغيل، فأعد تشغيل Windows وشغّل برنامج التثبيت مرة أخرى. وتبقى بيانات Arkvory الموجودة محفوظة.

التحديثات التلقائية متوقفة بعد التثبيت. ولتفعيلها، راجع [التحديثات](./updates).

### التثبيت الصامت {#silent-installation}

للنشر الآلي، ضع حساب المالك في ملف JSON. احمِ الملف بحيث لا يستطيع قراءته إلا SYSTEM وAdministrators.

```json
{ "name": "admin", "password": "<at least 12 characters>" }
```

```powershell
.\Arkvory-Setup-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"
```

يحذف برنامج التثبيت ملف المالك بعد أن ينشئ الحساب. لا تمرّر كلمة مرور وسيطًا في سطر الأوامر أبدًا. وإذا لم تستخدم `/OWNERFILE`، فأنشئ المالك لاحقًا في وحدة التحكم باستخدام مفتاح الاسترداد. وينتهي برنامج التثبيت برمز خروج غير صفري إذا لم يكتمل الإعداد. لا تشغّله أثناء تنفيذ تحديث.

## ما الذي ينشئه برنامج التثبيت الرسومي {#what-the-graphical-installer-creates}

| العنصر                       | الموقع أو القيمة                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| ملفات البرنامج               | `C:\Program Files\ProAnima\Arkvory`                                                  |
| البيانات والإعدادات والسجلات | `C:\ProgramData\ProAnima\Arkvory` (جذر التثبيت)                                      |
| قاعدة البيانات               | PostgreSQL 18.4 في `database\` ضمن الجذر، على `127.0.0.1:54329`                      |
| وحدة التحكم                  | `http://127.0.0.1:8080/console/`                                                     |
| مفتاح الاسترداد              | `config\bootstrap-token.txt` في الجذر                                                |
| مهمة التحديث                 | `ProAnimaArkvoryUpdate` في جدولة المهام (Task Scheduler). تعمل كل دقيقة بحساب SYSTEM |

### الخدمات {#services}

| اسم الخدمة        | الاسم المعروض             | الحساب                        | نوع بدء التشغيل    |
| ----------------- | ------------------------- | ----------------------------- | ------------------ |
| `Arkvoryapi`      | ProAnima Arkvory api      | `NT AUTHORITY\LocalService`   | تلقائي (بدء متأخر) |
| `Arkvoryworker`   | ProAnima Arkvory worker   | `NT AUTHORITY\LocalService`   | تلقائي (بدء متأخر) |
| `Arkvorybackup`   | ProAnima Arkvory backup   | `NT AUTHORITY\LocalService`   | تلقائي (بدء متأخر) |
| `Arkvorydatabase` | ProAnima Arkvory database | `NT AUTHORITY\NetworkService` | تلقائي             |

تعمل الخدمات دون مستخدم مسجّل الدخول. ويشترك API والعامل (worker) ووكيل النسخ الاحتياطي في حساب LocalService. وتعمل قاعدة البيانات بحساب NetworkService، لذا لا يستطيع حساب API قراءة ملفات قاعدة البيانات.

يمنح الجذر التحكم الكامل لـ SYSTEM وAdministrators فقط. ويستطيع LocalService قراءة الجذر، ولا يستطيع تغيير سوى `data\` و`logs\` وصندوق وارد التحديثات. أما مفتاح الاسترداد وملفات بيانات الاعتماد الأخرى الخاصة ببرنامج التثبيت فلا يقرؤها إلا SYSTEM وAdministrators.

## التثبيت باستخدام PowerShell وPostgreSQL موجود {#install-with-powershell-and-an-existing-postgresql}

استخدم هذه الطريقة إذا كانت مؤسستك تشغّل PostgreSQL بالفعل. فهي لا تنشئ خدمة قاعدة بيانات مُدارة ولا إدخالًا في قائمة **Apps** (التطبيقات).

1. اطلب من مسؤول قاعدة البيانات قاعدة بيانات فارغة ودورًا (role) يملكها. يشغّل Arkvory عمليات الترحيل (migrations) بهذا الدور.
2. نزّل `install.ps1` من الإصدار وراجعه.
3. افتح Windows PowerShell **كمسؤول** (Run as administrator) وشغّل:

```powershell
.\install.ps1 -AutomaticUpdates
```

يطلب النص البرمجي عنوان اتصال PostgreSQL. ويكون الإدخال مخفيًا. ثم ينزّل Node.js 24.21.0 من `nodejs.org`، ويتحقق من SHA-256 الخاص به، ويثبّت أحدث إصدار مستقر.

بدلًا من الطلب التفاعلي، يمكنك تمرير ملف JSON محمي:

```json
{ "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
```

```powershell
.\install.ps1 -Config C:\secure\arkvory.json
```

إذا منع PowerShell تشغيل النصوص البرمجية، فشغّل `powershell -ExecutionPolicy Bypass -File .\install.ps1`. وهذا يغيّر السياسة لهذه العملية فقط.

| المعامل                      | المعنى                                                    |
| ---------------------------- | --------------------------------------------------------- |
| `-Root <path>`               | جذر التثبيت. الافتراضي: `C:\ProgramData\ProAnima\Arkvory` |
| `-Version <x.y.z>`           | ثبّت هذا الإصدار المستقر بدلًا من الأحدث                  |
| `-Mode windows` أو `compose` | خدمات Windows (الافتراضي) أو [Docker Compose](./docker)   |
| `-Engine docker` أو `podman` | محرك الحاويات لـ Compose                                  |
| `-Config <file>`             | ملف JSON بإعدادات `ARKVORY_*`، ومنها عنوان قاعدة البيانات |
| `-Artifact <directory>`      | ثبّت من `Arkvory-Windows.zip` بعد فك ضغطه بدلًا من GitHub |
| `-AutomaticUpdates`          | فعّل التحديثات التلقائية                                  |
| `-Pin`                       | احمِ الإصدار المثبَّت من التحديث (pin)                    |

مرّر `-Root` و`-Config` و`-Artifact` كمسارات مطلقة، مثل `-Artifact $PWD.Path`.

لا ينشئ النص البرمجي حساب مالك. افتح `http://127.0.0.1:8080/console/` على الخادم، واختر **[[ui:welcomeOwner]]**، وأدخل مفتاح الاسترداد من `config\bootstrap-token.txt`.

## إدارة الخدمات {#manage-the-services}

```powershell
Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
Restart-Service Arkvoryapi, Arkvoryworker
sc.exe qfailure Arkvoryapi
```

يحتاج أمر الإدارة إلى PowerShell مرتفع الصلاحيات (elevated) وإلى الخيار `--root` دائمًا:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
# برنامج التثبيت الرسومي
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root $root
# التثبيت بالنص البرمجي
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

شغّل `arkvory.ps1 help` لعرض كل الأوامر. وتوصف الأوامر في [الإعداد](./configuration) و[التحديثات](./updates).

## الاسترداد بعد عطل {#recovery-after-a-failure}

- عندما تتوقف عملية خدمة دون طلب، يبدأها Windows مرة أخرى بعد 10 ثوانٍ. ويُصفَّر عدّاد الإخفاقات بعد ساعة واحدة.
- العملية التي يتجمّد خيطها الرئيسي (main thread) 60 ثانية تنهي نفسها، ويبدأها Windows مرة أخرى. راجع [الإصلاح الذاتي](../operate/self-healing).
- فشل فحص الجاهزية وحده لا يعيد تشغيل الخدمة (مثلًا أثناء إنهاء الخادم للطلبات الجارية قبل الإيقاف). لكن عندما تتوقف قاعدة البيانات عن الرد، لا يستطيع API والعامل التأكد من أنهما يملكان التخزين: وبعد نحو 8 ثوانٍ تنهي كل منهما نفسها، ويبدأها Windows مرة أخرى كل 10 ثوانٍ حتى تعود قاعدة البيانات.
- الخدمة التي توقفها بنفسك تبقى متوقفة حتى تبدأها أنت أو يُعاد تشغيل Windows.

يؤدي تشغيل برنامج التثبيت الرسومي مرة أخرى إلى استعادة نوع بدء التشغيل وإجراءات الاسترداد للخدمات.

## السجلات {#logs}

| الموقع في الجذر    | المحتوى                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `logs\`            | مخرجات API والعامل ووكيل النسخ الاحتياطي. تُدوَّر الملفات عند 20 MiB؛ ويُحتفظ بخمسة ملفات قديمة |
| `logs\updater.log` | مخرجات مهمة التحديث، بالتدوير نفسه                                                              |
| `database\`        | سجلات خدمة قاعدة البيانات (`arkvory-database*.log`)                                             |
| `bootstrap.log`    | مخرجات خطوة الإعداد في برنامج التثبيت الرسومي                                                   |

ويكتب برنامج التثبيت أيضًا سجله الخاص في المجلد المؤقت للمستخدم الذي شغّله. ويكتب API والعامل سجل JSON واحدًا في كل سطر. راجع [المراقبة](../operate/monitoring).

## إلغاء التثبيت {#uninstall}

افتح **الإعدادات ← التطبيقات** (Settings > Apps)، واختر **ProAnima Arkvory**، وانقر **إلغاء التثبيت** (Uninstall). يقوم برنامج إلغاء التثبيت بما يلي:

1. يزيل المهمة `ProAnimaArkvoryUpdate`.
2. يوقف `Arkvorybackup` و`Arkvoryworker` و`Arkvoryapi` و`Arkvorydatabase` ويزيلها.
3. يزيل ملفات البرنامج.

ويُبقي **عمدًا** على `C:\ProgramData\ProAnima\Arkvory`: قاعدة البيانات وكل الملفات والإعدادات ومفتاح الاسترداد. ولا يمسّ مخزن النسخ الاحتياطية أبدًا. وإذا شغّلت لاحقًا برنامج التثبيت بالإصدار نفسه أو بإصدار أحدث، فإنه يتابع بالبيانات المحفوظة. ولإزالة البيانات، أنشئ نسخة احتياطية أولًا ثم احذف المجلد بنفسك.

ليس للتثبيت بالنص البرمجي برنامج إلغاء تثبيت. ولإزالة خدماته، شغّل في PowerShell مرتفع الصلاحيات:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false
foreach ($role in 'backup', 'worker', 'api') {
  $exe = "$root\service\arkvory-$role.exe"
  if ((Get-Service "Arkvory$role").Status -ne 'Stopped') { & $exe stopwait }
  & $exe uninstall
}
```

## Docker Desktop {#docker-desktop}

Docker Desktop تطبيق لمستخدم واحد. ولا تعمل حاوياته إلا بعد أن يسجّل هذا المستخدم الدخول ويبدأ Docker Desktop. وبعد إعادة تشغيل الحاسوب لا يتوفر Arkvory حتى يحدث ذلك. وإذا ثبّتَّ باستخدام Docker Desktop، ففعّل **Settings > General > Start Docker Desktop when you sign in**. يحذّر برنامج التثبيت والأمر `status` عندما يكون هذا الإعداد متوقفًا. وللخادم الذي يجب أن يبدأ دون تسجيل دخول، استخدم الخدمات الأصلية الموضحة في هذه الصفحة.

## استكشاف الأخطاء وإصلاحها {#troubleshooting}

| المشكلة                                                                  | ما الذي تفعله                                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| يبلّغ برنامج التثبيت أن الإعداد لم يكتمل                                 | اقرأ `bootstrap.log` وسجل برنامج التثبيت وسجلات قاعدة البيانات. لا تحذف مجلد قاعدة البيانات                              |
| `database\bootstrap-started` موجود، لكن `database\initialized` غير موجود | انقطع إنشاء قاعدة البيانات. لا تحذف العنقود (cluster) ولا تكرر أوامر SQL يدويًا. أصلح السبب وشغّل الأمر `finish-install` |
| `Run installer as Administrator`                                         | ابدأ PowerShell بالخيار **Run as administrator** (تشغيل كمسؤول)                                                          |
| `Use a dedicated directory`                                              | الجذر يحتوي ملفات بالفعل. استخدم دليلًا فارغًا. وأدر التثبيت القائم بأوامره                                              |
| `Node.js runtime is incomplete after extraction`                         | تحقق من الحجر الصحي (quarantine) في برنامج مكافحة الفيروسات لديك                                                         |
| `Another installation owns this service`                                 | توجد خدمات تثبيت في جذر آخر. أزلها أولًا                                                                                 |

لإنهاء تثبيت انقطع دون حذف البيانات:

```powershell
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' finish-install --root C:\ProgramData\ProAnima\Arkvory
```

تجد مزيدًا من التلميحات في [استكشاف الأخطاء وإصلاحها](../operate/troubleshooting).
