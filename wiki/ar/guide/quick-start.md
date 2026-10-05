---
title: البدء السريع
---

# البدء السريع

تعرض هذه الصفحة أقصر طريق من لا شيء إلى خادم Arkvory يعمل مع ملف مرفوع واحد. اختر طريقة تثبيت واحدة في الخطوة 1، ثم اتبع الخطوات الأخرى بالترتيب.

نزّل برامج التثبيت من [صفحة الإصدارات](https://github.com/ProAnima/Arkvory/releases) الخاصة بالمشروع فقط، وقارن SHA-256 الخاص بها بملفات المجاميع الاختبارية المرفقة بالإصدار.

## الخطوة 1. ثبّت الخادم {#step-1-install-the-server}

### Windows {#windows}

تحتاج إلى Windows 10 الإصدار 1809 أو أحدث، أو Windows Server 2019 أو أحدث، على معمارية x64، وإلى صلاحيات المسؤول. ولا حاجة إلى اتصال بالإنترنت.

1. شغّل `Arkvory-Setup-x64.exe` وأكّد مطالبة المسؤول.
2. اختر اللغة ووافق على الترخيص.
3. في صفحة المالك، أدخل اسمًا (من 3 إلى 64 حرفًا لاتينيًا أو رقمًا أو `.` أو `-` أو `_`) وكلمة مرور لا تقل عن 12 حرفًا. هذا هو أول حساب مسؤول.
4. أنهِ المعالج. ويمكنه أن يفتح وحدة التحكم لك.

يثبّت برنامج التثبيت البرنامج في `C:\Program Files\ProAnima\Arkvory` والبيانات في `C:\ProgramData\ProAnima\Arkvory`. وينشئ أربع خدمات Windows: `Arkvorydatabase` و`Arkvoryapi` و`Arkvoryworker` و`Arkvorybackup`. تعمل هذه الخدمات دون مستخدم مسجّل الدخول. راجع [Windows](../install/windows).

### Linux {#linux}

استخدم الحزمة المناسبة لتوزيعتك. ويثبّت مدير الحزم أيضًا خادم PostgreSQL (الإصدارات من 16 إلى 19 مدعومة).

```bash
# Debian, Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora, RHEL-compatible
sudo dnf install ./Arkvory-x86_64.rpm
```

جذر التثبيت هو `/opt/proanima-arkvory`. وتنشئ الحزمة خدمات systemd التالية: `arkvory-database` و`arkvory-api` و`arkvory-worker` و`arkvory-backup`. تحقق منها:

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

راجع [Linux](../install/linux).

### Docker Compose {#docker-compose}

تحتاج إلى Docker مع Compose. وعلى Windows استخدم Docker Desktop مع حاويات Linux. ينزّل النص البرمجي Node.js والإصدار، لذا يحتاج إلى وصول إلى الإنترنت.

نزّل `install.sh` أو `install.ps1` من الإصدار واقرأه قبل أن تشغّله.

```bash
sudo bash ./install.sh --mode compose
```

على Windows، شغّل PowerShell بالمستخدم نفسه الذي يشغّل Docker Desktop، ودون صلاحيات المسؤول:

```powershell
.\install.ps1 -Mode compose
```

جذر التثبيت هو `/opt/proanima-arkvory` على Linux و`C:\ProgramData\ProAnima\Arkvory` على Windows. وتضم المجموعة API والعامل (worker) ووكيل النسخ الاحتياطي وPostgreSQL 18. راجع [Docker](../install/docker).

## الخطوة 2. افتح وحدة التحكم {#step-2-open-the-console}

افتح `http://127.0.0.1:8080/console/` في متصفح على الخادم.

في البداية يستمع الخادم إلى العنوان المحلي `127.0.0.1` فقط. ولفتح وحدة التحكم من حاسوبك، وجّه المنفذ عبر SSH:

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

ثم افتح `http://127.0.0.1:8080/console/` على حاسوبك. ولمنح أجهزة أخرى حق الوصول، أعدّ [HTTPS](../install/https) أولًا.

## الخطوة 3. أنشئ المالك {#step-3-create-the-owner}

تخطَّ هذه الخطوة على Windows: فقد أنشأ برنامج التثبيت المالك بالفعل.

على Linux وDocker يُنشأ الحساب الأول باستخدام **مفتاح الاسترداد**. يكتبه برنامج التثبيت في `config/bootstrap-token.txt` ضمن جذر التثبيت. ولا يستطيع قراءة الملف إلا المسؤول.

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. في وحدة التحكم، افتح [[ui:navStart]] ووسّع [[ui:welcomeOwner]].
2. الصق المفتاح في [[ui:welcomeRecovery]].
3. أدخل اسم المالك وكلمة مرور لا تقل عن 12 حرفًا، ثم اختر [[ui:welcomeCreate]].
4. سجّل الدخول بالاسم وكلمة المرور الجديدين في بطاقة [[ui:connection]].

أبقِ مفتاح الاسترداد سريًا ولا تحذف الملف. فأدوات التثبيت والتحديث تستخدمه. راجع [الأمان](../operate/security).

المالك مسؤول، ويمكنه الكتابة في المستودع `releases`. ولإنشاء مستودع آخر، افتح [[ui:administration]]، ووسّع [[ui:manageGrants]]، وامنح المجموعة `arkvory-owners` الإذن [[ui:write]] على اسم جديد، مثل `builds`، ثم اختر [[ui:saveGrant]]. يتألف اسم المستودع من أحرف لاتينية صغيرة وأرقام و`-` و`_`، ولا يزيد على 64 حرفًا.

## الخطوة 4. أنشئ مفتاحًا لأدواتك {#step-4-create-a-key-for-your-tools}

تحتاج النصوص البرمجية وعميل سطر الأوامر إلى مفتاح. وللتجربة الأولى، استخدم رمز وصول شخصيًا:

1. وسّع [[ui:personalAccessTokens]] في بطاقة [[ui:connection]].
2. أدخل [[ui:tokenName]]، واضبط [[ui:tokenScope]] على [[ui:tokenScopeReadWrite]]، ثم اختر [[ui:generateToken]].
3. انسخ الرمز. فهو يظهر مرة واحدة فقط.
4. احفظه في ملف لا يستطيع قراءته غيرك، مثل `~/.arkvory/key`.

ولمسارات CI/CD ووكلاء النشر، أنشئ بدلًا من ذلك حساب خدمة له مفتاحه الخاص. راجع [الحسابات والوصول](../use/accounts).

## الخطوة 5. ارفع وانزّل باستخدام curl {#step-5-upload-and-download-with-curl}

يعمل مسار الملف في مستودع مثل ملف على خادم ويب. يخزّن `PUT` إصدارًا جديدًا من المسار، ويعيد `GET` الإصدار الحالي.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# رفع
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# تنزيل
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

يعيد الرفع JSON على النحو التالي:

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

إذا رفعت البايتات نفسها مرة أخرى، يكون الرد `200` مع `"created": false`، ولا يُنشأ إصدار جديد. أما الملف الجديد فيحصل على الحالة `201`.

في PowerShell:

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

يجب أن ينتهي طلب `PUT` واحد خلال 30 دقيقة. وللملفات الكبيرة جدًا أو الشبكات البطيئة، استخدم عميل سطر الأوامر: فهو يرفع على أجزاء ويتابع بعد الفشل. راجع [الملفات الخام](../protocols/raw-files).

## الخطوة 6. استخدم عميل سطر الأوامر {#step-6-use-the-command-line-client}

ثبّت `arkvoryctl` على حاسوبك: `Arkvory-CLI-Setup-x64.exe` على Windows، و`Arkvory-CLI-amd64.deb` أو `Arkvory-CLI-x86_64.rpm` على Linux. وعلى جهاز CI فيه Node.js 24 يعمل `arkvoryctl.mjs` أيضًا.

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

يستخدم ملف التعريف المستودع `releases` ما لم تضف `--repository`. وإذا توقف النقل، شغّل الأمر نفسه مرة أخرى: فهو يتابع من حيث توقف ويتحقق من SHA-256 في النهاية. ولا يقبل العميل HTTP العادي إلا للحاسوب المحلي؛ فاستخدم HTTPS مع الخادم البعيد. راجع [عميل سطر الأوامر](../protocols/cli).

## الخطوات التالية {#next-steps}

- [المفاهيم](./concepts): المستودعات والمُخرَجات والمراحل والمفاتيح.
- [HTTPS](../install/https): افتح الخادم لأجهزة أخرى بأمان.
- [النسخ الاحتياطية](../operate/backups): اربط مخزنًا قبل أن تخزّن بيانات مهمة.
- [الحزم](../use/packages) و[الترقية](../use/promotion): نسخ بناء ذات إصدارات للنشر.
- [وحدة التحكم على الويب](./console): جولة في كل الأقسام.
