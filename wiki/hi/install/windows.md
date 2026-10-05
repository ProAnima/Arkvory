---
title: Windows
---

# Windows

Windows पर Arkvory चलाने के तीन तरीके हैं:

- **ग्राफ़िकल इंस्टॉलर** `Arkvory-Setup-x64.exe`। अनुशंसित। यह Windows सेवाएँ और एक समर्पित PostgreSQL डेटाबेस इंस्टॉल करता है। इसे इंटरनेट एक्सेस की ज़रूरत नहीं है।
- **PowerShell स्क्रिप्ट** `install.ps1`। यह वही Windows सेवाएँ इंस्टॉल करती है, लेकिन आपका मौजूदा PostgreSQL सर्वर इस्तेमाल करती है।
- **Docker Desktop**, `install.ps1 -Mode compose` के साथ। केवल मूल्यांकन के लिए। [Docker Compose](./docker) देखें।

## आवश्यकताएँ {#requirements}

- Windows x64, बिल्ड 10.0.17763 या उसके बाद का (Windows 10 संस्करण 1809, Windows Server 2019 या उसके बाद का)।
- Administrators समूह का खाता।
- डेटा के लिए स्थानीय NTFS वॉल्यूम। फ़ाइल स्टोरेज के लिए नेटवर्क शेयर समर्थित नहीं हैं।
- उपयोगकर्ता प्रोफ़ाइल और `AppData` के बाहर की इंस्टॉलेशन डायरेक्टरी। सेवा खाता हर पैरेंट डायरेक्टरी को पढ़ पाने में सक्षम होना चाहिए।

## ग्राफ़िकल इंस्टॉलर से इंस्टॉल करें {#install-with-the-graphical-installer}

1. [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) से `Arkvory-Setup-x64.exe` डाउनलोड करें।
2. फ़ाइल चलाएँ और User Account Control के संकेत की पुष्टि करें।
3. अंग्रेज़ी या रूसी चुनें और लाइसेंस स्वीकार करें।
4. स्वामी खाता दर्ज करें। नाम में 3 से 64 वर्ण होते हैं: लैटिन अक्षर, अंक, बिंदु, डैश या अंडरस्कोर। पासवर्ड में 12 से 128 वर्ण होते हैं।
5. प्रतीक्षा करें, जब तक सेटअप डेटाबेस, सेवाएँ और स्वामी खाता तैयार करता है।
6. अंतिम पेज पर **Open Arkvory and finish onboarding** (Arkvory खोलें और शुरुआती चरण पूरे करें) चुना हुआ रहने दें और **Finish** (समाप्त करें) पर क्लिक करें। कंसोल `http://127.0.0.1:8080/console/#onboarding` पर खुलता है।

सेटअप Start मेनू के दो शॉर्टकट भी बनाता है: **Arkvory** (कंसोल) और **API and CLI** (कंसोल का सहायता पेज)।

अगर सेटअप बताए कि Microsoft रनटाइम के लिए रीस्टार्ट चाहिए, तो Windows रीस्टार्ट करें और सेटअप फिर से चलाएँ। Arkvory का मौजूदा डेटा सुरक्षित रहता है।

इंस्टॉलेशन के बाद स्वचालित अपडेट बंद रहते हैं। उन्हें चालू करने के लिए [अपडेट](./updates) देखें।

### साइलेंट इंस्टॉलेशन {#silent-installation}

स्वचालित डिप्लॉयमेंट के लिए स्वामी खाता JSON फ़ाइल में रखें। फ़ाइल को ऐसे सुरक्षित करें कि केवल SYSTEM और Administrators उसे पढ़ सकें।

```json
{ "name": "admin", "password": "<कम से कम 12 वर्ण>" }
```

```powershell
.\Arkvory-Setup-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"
```

इंस्टॉलर खाता बनाने के बाद स्वामी फ़ाइल हटा देता है। पासवर्ड को कभी कमांड आर्गुमेंट के रूप में न दें। `/OWNERFILE` के बिना बाद में कंसोल में पुनर्प्राप्ति कुंजी से स्वामी बनाएँ। कॉन्फ़िगरेशन पूरा न होने पर सेटअप शून्य के अलावा किसी कोड के साथ समाप्त होता है। अपडेट चलने के दौरान सेटअप न चलाएँ।

## ग्राफ़िकल इंस्टॉलर क्या बनाता है {#what-the-graphical-installer-creates}

| मद                        | स्थान या मान                                                                  |
| ------------------------- | ----------------------------------------------------------------------------- |
| प्रोग्राम फ़ाइलें         | `C:\Program Files\ProAnima\Arkvory`                                           |
| डेटा, कॉन्फ़िगरेशन और लॉग | `C:\ProgramData\ProAnima\Arkvory` (इंस्टॉलेशन रूट)                            |
| डेटाबेस                   | रूट के `database\` में PostgreSQL 18.4, `127.0.0.1:54329` पर                  |
| कंसोल                     | `http://127.0.0.1:8080/console/`                                              |
| पुनर्प्राप्ति कुंजी       | रूट में `config\bootstrap-token.txt`                                          |
| अपडेट टास्क               | Task Scheduler में `ProAnimaArkvoryUpdate`। हर मिनट SYSTEM के रूप में चलता है |

### सेवाएँ {#services}

| सेवा का नाम       | प्रदर्शित नाम             | खाता                          | स्टार्टअप प्रकार          |
| ----------------- | ------------------------- | ----------------------------- | ------------------------- |
| `Arkvoryapi`      | ProAnima Arkvory api      | `NT AUTHORITY\LocalService`   | Automatic (Delayed Start) |
| `Arkvoryworker`   | ProAnima Arkvory worker   | `NT AUTHORITY\LocalService`   | Automatic (Delayed Start) |
| `Arkvorybackup`   | ProAnima Arkvory backup   | `NT AUTHORITY\LocalService`   | Automatic (Delayed Start) |
| `Arkvorydatabase` | ProAnima Arkvory database | `NT AUTHORITY\NetworkService` | Automatic                 |

सेवाएँ किसी साइन-इन किए हुए उपयोगकर्ता के बिना चलती हैं। API, वर्कर और बैकअप एजेंट LocalService खाता साझा करते हैं। डेटाबेस NetworkService के तहत चलता है, इसलिए API का खाता डेटाबेस फ़ाइलें नहीं पढ़ सकता।

रूट पर पूरा नियंत्रण केवल SYSTEM और Administrators के पास है। LocalService रूट को पढ़ सकता है और केवल `data\`, `logs\` और अपडेट इनबॉक्स में बदलाव कर सकता है। पुनर्प्राप्ति कुंजी और इंस्टॉलर की बाकी क्रेडेंशियल फ़ाइलें केवल SYSTEM और Administrators पढ़ सकते हैं।

## PowerShell और मौजूदा PostgreSQL से इंस्टॉल करें {#install-with-powershell-and-an-existing-postgresql}

यह तरीका तब इस्तेमाल करें जब आपका संगठन पहले से PostgreSQL चलाता है। यह कोई प्रबंधित डेटाबेस सेवा नहीं बनाता और **Apps** में कोई प्रविष्टि नहीं जोड़ता।

1. अपने डेटाबेस व्यवस्थापक से एक खाली डेटाबेस और उसका स्वामी रोल माँगें। Arkvory अपने माइग्रेशन इसी रोल से चलाता है।
2. रिलीज़ से `install.ps1` डाउनलोड करें और उसे पढ़कर जाँच लें।
3. Windows PowerShell को **व्यवस्थापक के रूप में** खोलें और चलाएँ:

```powershell
.\install.ps1 -AutomaticUpdates
```

स्क्रिप्ट PostgreSQL कनेक्शन URL पूछती है। इनपुट छिपा रहता है। फिर यह `nodejs.org` से Node.js 24.21.0 डाउनलोड करती है, उसका SHA-256 जाँचती है और नवीनतम स्थिर रिलीज़ इंस्टॉल करती है।

प्रॉम्प्ट के बजाय आप सुरक्षित JSON फ़ाइल दे सकते हैं:

```json
{ "ARKVORY_DATABASE_URL": "postgresql://arkvory:<पासवर्ड>@db.example:5432/arkvory" }
```

```powershell
.\install.ps1 -Config C:\secure\arkvory.json
```

अगर PowerShell स्क्रिप्ट रोक दे, तो `powershell -ExecutionPolicy Bypass -File .\install.ps1` चलाएँ। इससे नीति केवल इसी प्रोसेस के लिए बदलती है।

| पैरामीटर                     | अर्थ                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| `-Root <path>`               | इंस्टॉलेशन रूट। डिफ़ॉल्ट: `C:\ProgramData\ProAnima\Arkvory`   |
| `-Version <x.y.z>`           | नवीनतम की जगह यह स्थिर संस्करण इंस्टॉल करें                   |
| `-Mode windows` या `compose` | Windows सेवाएँ (डिफ़ॉल्ट) या [Docker Compose](./docker)       |
| `-Engine docker` या `podman` | Compose के लिए कंटेनर इंजन                                    |
| `-Config <file>`             | `ARKVORY_*` सेटिंग्स वाली JSON फ़ाइल, डेटाबेस URL सहित        |
| `-Artifact <directory>`      | GitHub की जगह निकाली गई `Arkvory-Windows.zip` से इंस्टॉल करें |
| `-AutomaticUpdates`          | स्वचालित अपडेट चालू करें                                      |
| `-Pin`                       | इंस्टॉल किए गए संस्करण को पिन करें                            |

`-Root`, `-Config` और `-Artifact` को पूर्ण पथ के रूप में दें, उदाहरण के लिए `-Artifact $PWD.Path`।

स्क्रिप्ट स्वामी खाता नहीं बनाती। सर्वर पर `http://127.0.0.1:8080/console/` खोलें, **[[ui:welcomeOwner]]** चुनें और `config\bootstrap-token.txt` से पुनर्प्राप्ति कुंजी दर्ज करें।

## सेवाएँ प्रबंधित करें {#manage-the-services}

```powershell
Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
Restart-Service Arkvoryapi, Arkvoryworker
sc.exe qfailure Arkvoryapi
```

प्रबंधन कमांड के लिए एलिवेटेड PowerShell चाहिए और हमेशा `--root` विकल्प चाहिए:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
# ग्राफ़िकल इंस्टॉलर
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root $root
# स्क्रिप्ट से इंस्टॉलेशन
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

सभी कमांड देखने के लिए `arkvory.ps1 help` चलाएँ। कमांड [कॉन्फ़िगरेशन](./configuration) और [अपडेट](./updates) में वर्णित हैं।

## विफलता के बाद पुनर्प्राप्ति {#recovery-after-a-failure}

- जब कोई सेवा प्रोसेस बिना अनुरोध के रुक जाता है, तो Windows उसे 10 सेकंड बाद फिर से शुरू करता है। विफलताओं की गिनती एक घंटे बाद शून्य हो जाती है।
- जिस प्रोसेस का मुख्य थ्रेड 60 सेकंड तक अटका रहे, वह खुद समाप्त हो जाता है और Windows उसे फिर से शुरू करता है। [स्वतः पुनर्प्राप्ति](../operate/self-healing) देखें।
- केवल तैयारी की जाँच (readiness check) विफल होने पर सेवा फिर से शुरू नहीं होती (उदाहरण के लिए, जब सर्वर चल रहे अनुरोध पूरे कर रहा हो)। लेकिन जब डेटाबेस जवाब देना बंद कर देता है, तो API और वर्कर यह पुष्टि नहीं कर पाते कि स्टोरेज उन्हीं के पास है: लगभग 8 सेकंड बाद वे खुद समाप्त हो जाते हैं, और डेटाबेस के लौटने तक Windows उन्हें हर 10 सेकंड पर फिर से शुरू करता रहता है।
- जिस सेवा को आप खुद रोकते हैं, वह तब तक रुकी रहती है जब तक आप उसे शुरू न करें या Windows रीस्टार्ट न हो।

ग्राफ़िकल इंस्टॉलर को दोबारा चलाने से सेवाओं का स्टार्टअप प्रकार और रिकवरी कार्रवाइयाँ फिर से सेट हो जाती हैं।

## लॉग {#logs}

| रूट में स्थान      | सामग्री                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `logs\`            | API, वर्कर और बैकअप एजेंट का आउटपुट। फ़ाइलें 20 MiB पर रोटेट होती हैं; 5 पुरानी फ़ाइलें रखी जाती हैं |
| `logs\updater.log` | अपडेट टास्क का आउटपुट, उसी रोटेशन के साथ                                                             |
| `database\`        | डेटाबेस सेवा के लॉग (`arkvory-database*.log`)                                                        |
| `bootstrap.log`    | ग्राफ़िकल इंस्टॉलर के कॉन्फ़िगरेशन चरण का आउटपुट                                                     |

सेटअप अपना लॉग उस उपयोगकर्ता के अस्थायी फ़ोल्डर में भी लिखता है जिसने उसे चलाया। API और वर्कर हर पंक्ति में एक JSON रिकॉर्ड लिखते हैं। [मॉनिटरिंग](../operate/monitoring) देखें।

## अनइंस्टॉल करें {#uninstall}

**Settings > Apps** (सेटिंग्स > ऐप्स) खोलें, **ProAnima Arkvory** चुनें और **Uninstall** (अनइंस्टॉल करें) पर क्लिक करें। अनइंस्टॉलर:

1. `ProAnimaArkvoryUpdate` टास्क हटाता है।
2. `Arkvorybackup`, `Arkvoryworker`, `Arkvoryapi` और `Arkvorydatabase` को रोककर हटाता है।
3. प्रोग्राम फ़ाइलें हटाता है।

यह जान-बूझकर `C:\ProgramData\ProAnima\Arkvory` को **रखता** है: डेटाबेस, सारी फ़ाइलें, कॉन्फ़िगरेशन और पुनर्प्राप्ति कुंजी। यह बैकअप स्टोरेज को कभी नहीं छूता। अगर आप बाद में उसी या नए संस्करण का सेटअप चलाते हैं, तो वह रखे गए डेटा के साथ आगे बढ़ता है। डेटा हटाने के लिए पहले बैकअप बनाएँ और फिर फ़ोल्डर खुद हटाएँ।

स्क्रिप्ट से किए गए इंस्टॉलेशन में अनइंस्टॉलर नहीं होता। उसकी सेवाएँ हटाने के लिए एलिवेटेड PowerShell में यह चलाएँ:

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

Docker Desktop एक उपयोगकर्ता का एप्लिकेशन है। उसके कंटेनर तभी चलते हैं जब यह उपयोगकर्ता साइन इन करे और Docker Desktop शुरू हो जाए। कंप्यूटर रीस्टार्ट होने के बाद तब तक Arkvory उपलब्ध नहीं रहता। अगर आप Docker Desktop से इंस्टॉल करते हैं, तो **Settings > General > Start Docker Desktop when you sign in** चालू करें। यह सेटिंग बंद होने पर इंस्टॉलर और `status` कमांड चेतावनी देते हैं। जिस सर्वर को साइन-इन के बिना शुरू होना है, उसके लिए इस पेज पर बताई गई नेटिव सेवाएँ इस्तेमाल करें।

## समस्या निवारण {#troubleshooting}

| समस्या                                                                      | क्या करें                                                                                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| सेटअप बताता है कि कॉन्फ़िगरेशन पूरा नहीं हुआ                                | `bootstrap.log`, सेटअप लॉग और डेटाबेस लॉग पढ़ें। डेटाबेस फ़ोल्डर न हटाएँ                                                          |
| `database\bootstrap-started` मौजूद है, लेकिन `database\initialized` नहीं है | डेटाबेस बनाने का काम बीच में रुक गया। क्लस्टर न हटाएँ और SQL हाथ से दोबारा न चलाएँ। कारण ठीक करें और `finish-install` कमांड चलाएँ |
| `Run installer as Administrator`                                            | PowerShell को **Run as administrator** (व्यवस्थापक के रूप में चलाएँ) से शुरू करें                                                 |
| `Use a dedicated directory`                                                 | रूट में पहले से फ़ाइलें हैं। खाली डायरेक्टरी इस्तेमाल करें। मौजूदा इंस्टॉलेशन को उसके अपने कमांड से प्रबंधित करें                 |
| `Node.js runtime is incomplete after extraction`                            | अपने एंटीवायरस सॉफ़्टवेयर का क्वारंटीन जाँचें                                                                                     |
| `Another installation owns this service`                                    | किसी दूसरे रूट के इंस्टॉलेशन की सेवाएँ मौजूद हैं। पहले उन्हें हटाएँ                                                               |

डेटा हटाए बिना अधूरा इंस्टॉलेशन पूरा करने के लिए:

```powershell
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' finish-install --root C:\ProgramData\ProAnima\Arkvory
```

और संकेत [समस्या निवारण](../operate/troubleshooting) में हैं।
