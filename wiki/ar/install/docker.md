---
title: Docker Compose
description: شغّل Arkvory كمشروع Docker Compose، وتعرّف على حاوياته ووحدات تخزينه ومنافذه وتحديثاته ووكيل النسخ الاحتياطي وإزالته.
---

# Docker Compose

يشغّل تثبيت Compose كلًا من API والعامل ووكيل النسخ الاحتياطي وPostgreSQL في حاويات على مضيف واحد. يبني برنامج التثبيت صورة Arkvory من الإصدار ويبدأ مشروع `proanima-arkvory`. استخدمه على مضيفي الحاويات. على Windows، يُستخدم Docker Desktop للتجربة فقط: راجع [Windows مع Docker Desktop](#docker-desktop).

لا يتضمن Compose دعم HTTPS مدمجًا. ضع وكيلًا عكسيًا أمامه قبل اتصال العملاء من حواسيب أخرى: راجع [HTTPS والوكيل العكسي](./https).

## المتطلبات {#requirements}

| العنصر            | المتطلب                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| المحرّك            | Docker Engine مع إضافة Compose ‏(`docker compose`). يمكن استخدام Podman مع موفّر compose متوافق بواسطة `--engine podman`، لكنه لم يُختبر                                         |
| الحساب            | `root` أو مستخدم في مجموعة `docker`                                                                                                                                            |
| البدء عند الإقلاع | يجب أن يبدأ محرّك الحاويات عند الإقلاع، وإلا فلن يعود Arkvory بعد إعادة التشغيل. تحقق باستخدام `systemctl is-enabled docker`                                                    |
| المضيف            | تثبيت Arkvory واحد لكل مضيف حاويات. اسم المشروع والمنفذ ثابتان                                                                                                                 |
| المنفذ المتاح     | 8080 على `127.0.0.1`                                                                                                                                                           |
| الحاويات          | حاويات Linux فقط. حاويات Windows غير مدعومة                                                                                                                                    |
| الإنترنت          | `nodejs.org` (ينزّل برنامج التثبيت Node.js 24.22.3 ويتحقق من SHA-256 الخاص به)، ومركز التحديث أو GitHub (الإصدار)، وDocker Hub ‏(`node:24.22.3-bookworm-slim` و`postgres:18.7`) |

لا يثبّت برنامج التثبيت محرّك الحاويات أو مراقب الأجهزة الافتراضية أو WSL ولا يغيّرها.

## حزمة النشر {#bundle}

يأخذ برنامج التثبيت إصدارًا تم التحقق منه ويفكّه في `releases/<version>/` ضمن جذر التثبيت. ملف Compose هو `releases/<version>/deploy/compose.yml` وملف البناء هو `releases/<version>/deploy/Dockerfile`. تُبنى الصورة `proanima-arkvory:<version>` على مضيفك انطلاقًا من `node:24.22.3-bookworm-slim`. لا تُسحب أي صورة من سجل حاويات خاص بـArkvory.

جذر التثبيت هو `/opt/proanima-arkvory` على Linux. يُشرح تنظيمه في [اختيار طريقة التثبيت](./#installation-directory). في تثبيت Compose لا تكون البيانات في `data/`، بل في وحدات التخزين الموضحة أدناه.

## الحاويات {#containers}

| الخدمة        | الصورة                       | الدور                                                                                             |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `database`    | `postgres:18.7`              | PostgreSQL. تبلغ عن الجاهزية باستخدام `pg_isready` كل 5 ثوانٍ                                      |
| `api`         | `proanima-arkvory:<version>` | HTTP API ووحدة التحكم. منشورة على `127.0.0.1:8080`. فحص السلامة كل 10 ثوانٍ                        |
| `worker`      | `proanima-arkvory:<version>` | تُكمل عمليات الرفع وتنفّذ المهام الخلفية. تبدأ بعد اجتياز API فحص السلامة                           |
| `backup`      | `proanima-arkvory:<version>` | وكيل النسخ الاحتياطي. يقرأ وحدة تخزين الملفات للقراءة فقط. لا ينشر أي منفذ                        |
| `initialize`  | `proanima-arkvory:<version>` | تُنفّذ مرة واحدة بحساب root: تمنح المستخدم 1000 ملكية وحدة تخزين الملفات                            |
| `migrate`     | `proanima-arkvory:<version>` | تُنفّذ مرة واحدة: تنفّذ ترحيلات قاعدة البيانات                                                       |
| `vault-owner` | `proanima-arkvory:<version>` | تُنفّذ مرة واحدة، ومع ملف التعريف `maintenance` فقط: تمنح المستخدم 1000 ملكية مخزن النسخ الاحتياطية |

يُعاد تشغيل الخدمات طويلة التشغيل ما لم توقفها. تعمل حاويات Arkvory بحساب `node` (المستخدم 1000) في الصورة، مع نظام ملفات جذري للقراءة فقط، و`/tmp` في الذاكرة بسعة 64 MiB، وإسقاط جميع القدرات، و`no-new-privileges`، ومهلة توقف قدرها 120 ثانية. يحتفظ Docker بما يصل إلى خمسة ملفات سجل JSON بحجم 20 MiB لكل حاوية.

## وحدات التخزين وربط أدلة المضيف {#volumes}

### وحدات تخزين Docker {#docker-volumes}

| وحدة التخزين               | موضع التركيب                        | المحتوى                                                                     |
| -------------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                  | محتوى الملفات ومساحة الرفع المؤقتة. يركّبها وكيل النسخ الاحتياطي للقراءة فقط |
| `proanima-arkvory_catalog` | `/var/lib/postgresql` في `database` | بيانات PostgreSQL                                                           |

تبقى وحدات التخزين بعد التحديثات و`docker compose down`. ولا يحذفها إلا `down --volumes`.

### ربط أدلة من جذر التثبيت {#bind-mounts}

| المسار على المضيف         | داخل الحاوية                    | الوضع            | الحاويات التي يركّب فيها                               |
| ------------------------- | ------------------------------- | ---------------- | ----------------------------------------------------- |
| `config/runtime.json`     | `/run/arkvory/runtime.json`     | للقراءة فقط      | api، worker، backup                                   |
| `config/keys.json`        | `/run/arkvory/keys.json`        | للقراءة فقط      | api، worker                                           |
| `config/health-token.txt` | `/run/arkvory/health-token.txt` | للقراءة فقط      | api، worker                                           |
| `config/postgres.env`     | ملف بيئة                        |                  | database                                              |
| `updates/status`          | `/run/arkvory-updates/status`   | للقراءة فقط      | api، worker                                           |
| `updates/inbox`           | `/run/arkvory-updates/inbox`    | للقراءة والكتابة | api، worker                                           |
| مخزن النسخ الاحتياطية     | `/srv/arkvory-vault`            | للقراءة والكتابة | backup، `vault-owner` (فقط عند ضبط مخزن نسخ احتياطية) |
| `config/mirrors`          | `/run/arkvory/mirrors`          | للقراءة فقط      | api، worker (فقط عندما يكون أحد المستودعات مرآة)      |

### المالكون وأوضاع الأذونات {#owners}

| المسار                                                 | المالك ووضع الأذونات   | السبب                                                                                                                                                                    |
| ------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| جذر التثبيت                                            | مستخدم التثبيت، `0700` | يحتوي الجذر على مفتاح الاسترداد وكلمة مرور قاعدة البيانات. لا يستطيع دخوله إلا مستخدم التثبيت                                                                            |
| `config/runtime.json`، `keys.json`، `health-token.txt` | `0644`                 | يجب أن يستطيع المستخدم 1000 داخل الحاوية قراءتها. يحتوي `runtime.json` على كلمة مرور قاعدة البيانات؛ ويمنع وضع الجذر `0700` المستخدمين الآخرين من الوصول إلى هذه الملفات |
| `updates/inbox`                                        | `0777`                 | الدليل الوحيد الذي تكتب فيه الحاوية على المضيف. قد يختلف معرّف مستخدم الحاوية عن معرّف محدّث المضيف                                                                         |
| `updates/status`                                       | `0755`                 | يكتب فيه محدّث المضيف؛ وتقرأه الحاوية فقط                                                                                                                                 |
| وحدة تخزين الملفات                                     | المستخدم 1000          | تضبطها `initialize` عند التثبيت والتحديث                                                                                                                                 |
| مخزن النسخ الاحتياطية                                  | المستخدم 1000          | تضبطه `vault-owner` عند توصيل المخزن. يصبح المخزن حينها ملكًا لمستخدم المضيف ذي المعرّف 1000                                                                               |

## المنافذ {#ports}

| المنفذ   | الخدمة           | الإتاحة                                           |
| -------- | ---------------- | ------------------------------------------------- |
| 8080/TCP | API ووحدة التحكم | `127.0.0.1:8080` على المضيف. العنوان ثابت         |
| 5432/TCP | PostgreSQL       | غير منشور. يمكن الوصول إليه داخل شبكة Compose فقط |

ينتمي ملف Compose إلى دليل الإصدار الذي تستبدله التحديثات، لذلك لا يمكنك تغيير العنوان المنشور فيه. للوصول إلى وحدة التحكم من حواسيب أخرى، ثبّت وكيلًا عكسيًا على المضيف يمرّر الطلبات إلى `127.0.0.1:8080`.

## البيئة {#environment}

لا يضبط ملف Compose أي إعدادات لـArkvory. تقرأ الخدمات `/run/arkvory/runtime.json`، وهو `config/runtime.json` على المضيف. يكتب برنامج التثبيت القيم التالية ويجب ألا تغيّرها: `ARKVORY_HOST` ‏(`0.0.0.0` داخل الحاوية)، و`ARKVORY_PORT` ‏(`8080`)، و`ARKVORY_DATABASE_URL` (حاوية `database` مع كلمة مرور مولّدة)، و`ARKVORY_DATA_DIR` ‏(`/var/lib/arkvory`)، و`ARKVORY_KEYS_FILE`، و`ARKVORY_UPDATE_CONTROL_DIR`.

يمكنك إضافة إعدادات أخرى، مثل `ARKVORY_TRUSTED_PROXIES` أو الحدود أو `ARKVORY_LOG_LEVEL`. أضفها إلى `config/runtime.json`، ثم أوقف الخدمات وابدأها كما هو موضح في [إدارة المشروع](#manage). القائمة الكاملة في [متغيرات البيئة](../reference/environment). يحتوي `config/compose.env` على `ARKVORY_IMAGE`. يديره برنامج التثبيت؛ فلا تعدّله.

## التثبيت على Linux {#install}

1. نزّل `install.sh` من [إصدارات GitHub](https://github.com/ProAnima/Arkvory/releases) واقرأه.
2. شغّله بحساب `root`:

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   أضف `--automatic` لتفعيل التحديثات التلقائية، أو `--engine podman` لاستخدام Podman. مع `ARKVORY_RELEASE_VERSION=1.2.3` يثبّت النص البرمجي ذلك الإصدار المستقر. من دون اتصال إنترنت بـGitHub، فكّ `Arkvory-Linux.tar.gz` وشغّل `sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose` في الدليل المفكوك. يظل تنزيل Node.js مطلوبًا.

3. انتظر انتهاء برنامج التثبيت. يتحقق من الإصدار ويفكّه ويبني الصورة ويشغّل قاعدة البيانات وينفّذ `initialize` و`migrate`، ثم يشغّل API والعامل وينتظر حتى تبلغ API عن الجاهزية ثلاث مرات متتالية، ثم يشغّل وكيل النسخ الاحتياطي ويسجّل مؤقّت التحديث.

يمكن لمستخدم في مجموعة `docker` التثبيت من دون `root` في دليل يملكه:

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

عندها لا يسجّل برنامج التثبيت مؤقّت تحديث. لا تستطيع وحدة التحكم طلب التحديثات حتى تجدول المحدّث بنفسك. راجع [التحديثات في Compose](#updates-compose).

## التشغيل الأول والخطوات الأولى {#first-start}

1. تحقق من تشغيل الحاويات. راجع [إدارة المشروع](#manage) لمعرفة أمر `compose`.

   ```bash
   "${compose[@]}" ps
   ```

2. اقرأ مفتاح الاسترداد:

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. افتح `http://127.0.0.1:8080/console/#onboarding` على الخادم. من حاسوبك، مرّر المنفذ: `ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`.
4. في وحدة التحكم، افتح [[ui:navStart]] ووسّع [[ui:welcomeOwner]]. ألصق المفتاح في [[ui:welcomeRecovery]]، وأدخل اسم المالك وكلمة مرور لا تقل عن 12 حرفًا، واختر [[ui:welcomeCreate]].

احتفظ بمفتاح الاسترداد على الخادم. راجع [الأمان](../operate/security).

## إدارة المشروع {#manage}

افتح صدفة بحساب root ‏(`sudo -i`) وعرّف أمر `compose` مرة واحدة. يحتاج Compose إلى اسم المشروع ودليل المشروع وملف البيئة وجميع ملفات Compose الخاصة بالتثبيت:

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.22.3-linux-x64/bin/node"   # linux-arm64 على arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

إذا أغفلت ملفًا موجودًا، يعيد `up` إنشاء الحاوية من دون تركيب مخزن النسخ الاحتياطية أو المرآة.

| المهمة        | الأمر                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| عرض الحاويات  | `"${compose[@]}" ps`                                                        |
| قراءة السجلات | `"${compose[@]}" logs --tail 100 api worker backup`                         |
| إيقاف Arkvory | `"${compose[@]}" stop --timeout 120 backup worker api`                      |
| بدء Arkvory   | `"${compose[@]}" up -d --wait api worker` ثم `"${compose[@]}" up -d backup` |

يبقي الإيقاف بواسطة `stop` الحاوية متوقفة بعد إعادة تشغيل المحرّك. ابدأها مجددًا بواسطة `up -d`.

تعمل أوامر دورة الحياة باستخدام Node.js الذي وضعه برنامج التثبيت في الجذر:

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

لا يُثبَّت `arkvory` على مضيف Compose، لذا استدعِ `manage.mjs` للأوامر `status` و`update` و`configure`. تُشرح الأوامر في [الإعدادات](./configuration).

## السجلات {#logs}

تكتب الحاويات في ملفات سجل JSON الخاصة بـDocker. اقرأها بواسطة `"${compose[@]}" logs`. تكتب API والعامل سجل JSON واحدًا في كل سطر. راجع [المراقبة](../operate/monitoring). تطبع أوامر دورة الحياة رسائلها في الطرفية، ويكتب مؤقّت التحديث في سجل النظام: `journalctl -u arkvory-update`.

## التحديثات في Compose {#updates-compose}

حدّث من وحدة التحكم أو من خلال نافذة التحديث التلقائي أو بالأمر:

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

ينزّل التحديث الإصدار ويتحقق منه ويبني الصورة الجديدة، ثم يوقف `backup` و`worker` و`api` ويشغّلها بالصورة الجديدة. تستمر حاوية `database` في العمل. تبقى وحدات التخزين كما هي. لا يُثبَّت إصدار يغيّر مخطط قاعدة البيانات إلا بعد نسخة احتياطية تم التحقق منها. راجع [التحديثات](./updates).

يعمل محدّث المضيف مرة كل دقيقة. عند التثبيت بحساب `root` على مضيف systemd، يسجّله برنامج التثبيت باسم `arkvory-update.timer`. من دون `root`، يطبع برنامج التثبيت تحذيرًا. جدْوِل هذا الأمر كل دقيقة بحساب المستخدم الذي يملك التثبيت ويستطيع الوصول إلى محرّك الحاويات، مثلًا باستخدام cron:

```text
* * * * * /home/admin/arkvory/runtime/node-v24.22.3-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

لا تمنح حاويات Arkvory مقبس Docker أبدًا.

## وكيل النسخ الاحتياطي في Compose {#backup-agent}

تعمل حاوية `backup` منذ البداية. من دون مخزن نسخ احتياطية، تستمر في العمل وتبلّغ بأنه لم يُضبط مخزن. المخزن دليل على المضيف، خارج جذر التثبيت، وعلى وحدة تخزين منفصلة.

1. ركّب وحدة تخزين النسخ الاحتياطية وأنشئ دليلًا فارغًا، مثل `/mnt/backup/arkvory`. يجب أن يكون الدليل موجودًا: لا ينشئه Compose.
2. صِله:

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
   ```

   يتحقق الأمر من الدليل ويكتب `config/compose.vault.yml`، ويمنح المستخدم 1000 ملكية الدليل، ويمرّر ملف مفتاح الوكيل إلى حاوية النسخ الاحتياطي للقراءة فقط (`--vault-key-file`)، ويعيد تشغيل حاوية النسخ الاحتياطي وحدها. ينجح عندما يبلّغ الوكيل بأن المخزن متاح. وإلا فإنه يستعيد الإعدادات السابقة.

3. لفصل المخزن، شغّل الأمر نفسه مع `--backup-vault-off`. لا يُمس المخزن نفسه.

تُشرح الجداول الزمنية والاحتفاظ والاستعادة في [النسخ الاحتياطي](../operate/backups).

## الإزالة {#remove}

```bash
"${compose[@]}" down              # يزيل الحاويات ويحتفظ بوحدات التخزين
"${compose[@]}" down --volumes    # يحذف أيضًا الفهرس وجميع الملفات المخزّنة
```

يحذف `down --volumes` جميع البيانات. لا تنفّذه أبدًا على تثبيت يحتوي ملفات. أنشئ نسخة احتياطية أولًا واحتفظ بمخزن النسخ الاحتياطية.

بعد `down`، يمكنك إزالة ما تبقّى:

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

لا تحذف الجذر إلا بعد الاستغناء عن الإعدادات ومفتاح الاسترداد. تبقى صور الإصدارات السابقة على المضيف حتى تزيلها.

## Windows مع Docker Desktop {#docker-desktop}

استخدم Docker Desktop للتجربة على محطة عمل فقط. Docker Desktop تطبيق لمستخدم واحد: لا تعمل الحاويات إلا ما دام هذا المستخدم مسجّل الدخول وDocker Desktop يعمل. بعد إعادة تشغيل الحاسوب، يظل Arkvory غير متاح حتى يتحقق ذلك. فعّل **الإعدادات > عام > بدء Docker Desktop عند تسجيل الدخول**. يحذّر برنامج التثبيت وأمر `status` عندما يكون هذا الإعداد متوقفًا. للخادم، استخدم [خدمات Windows](./windows).

1. شغّل Docker Desktop في نمط حاويات Linux.
2. نزّل `install.ps1` من الإصدار واقرأه.
3. افتح Windows PowerShell بحساب المستخدم الذي يشغّل Docker Desktop، **من دون** حقوق مسؤول، وشغّل:

   ```powershell
   .\install.ps1 -Mode compose
   ```

   تُشرح المعاملات `-Root` و`-Version` و`-Engine` و`-Artifact` و`-AutomaticUpdates` و`-Pin` في [Windows](./windows#install-with-powershell-and-an-existing-postgresql). مرّر `-Root` و`-Artifact` كمسارات مطلقة.

4. افتح `http://127.0.0.1:8080/console/#onboarding`، واقرأ مفتاح الاسترداد من `C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt`، وأنشئ المالك كما هو موضح في [التشغيل الأول والخطوات الأولى](#first-start).

يمنح جذر التثبيت `C:\ProgramData\ProAnima\Arkvory` حق الوصول إلى SYSTEM وAdministrators ومستخدم التثبيت من دون توريث، لأن Docker Desktop يقرأ الأدلة المرتبطة باستخدام رمز وصول هذا المستخدم. لا تشغّل برنامج التثبيت بحقوق مرتفعة عند استخدام Compose.

لا يسجّل برنامج التثبيت مهمة التحديث `ProAnimaArkvoryUpdate` إلا عند تشغيله كمسؤول. تناسب هذه المهمة محرّكًا يعمل على مستوى النظام، ولا تناسب Docker Desktop. عند استخدام Docker Desktop، سجّل المهمة بحساب مستخدم Docker Desktop. لا تعمل إلا ما دام هذا المستخدم مسجّل الدخول وDocker Desktop يعمل:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.22.3-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

أدِر المشروع في PowerShell باستخدام الوسائط نفسها:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.22.3-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

يجب أن يكون مخزن النسخ الاحتياطية على Windows وحدة تخزين محلية أو iSCSI. تُرفض مسارات UNC وSMB. لإزالة التثبيت، شغّل `docker @compose down --volumes`، وألغِ تسجيل المهمة بواسطة `Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false`، واحذف الجذر. أنشئ نسخة احتياطية أولًا.
