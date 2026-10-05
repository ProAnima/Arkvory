---
title: त्वरित शुरुआत
---

# त्वरित शुरुआत

यह पेज शून्य से एक चालू Arkvory सर्वर और एक अपलोड की गई फ़ाइल तक का सबसे छोटा रास्ता दिखाता है। चरण 1 में इंस्टॉलेशन का कोई एक तरीका चुनें, फिर बाकी चरण क्रम से पूरे करें।

इंस्टॉलर केवल प्रोजेक्ट के [रिलीज़ पेज](https://github.com/ProAnima/Arkvory/releases) से डाउनलोड करें और उनके SHA-256 की तुलना रिलीज़ की चेकसम फ़ाइलों से करें।

## चरण 1. सर्वर इंस्टॉल करें {#step-1-install-the-server}

### Windows {#windows}

आपको x64 पर Windows 10 का संस्करण 1809 या उसके बाद का, या Windows Server 2019 या उसके बाद का, और व्यवस्थापक अधिकार चाहिए। इंटरनेट कनेक्शन की ज़रूरत नहीं है।

1. `Arkvory-Setup-x64.exe` चलाएँ और व्यवस्थापक अनुमति के संकेत की पुष्टि करें।
2. भाषा चुनें और लाइसेंस स्वीकार करें।
3. स्वामी वाले पेज पर एक नाम (3–64 लैटिन अक्षर, अंक, `.`, `-` या `_`) और कम से कम 12 वर्णों का पासवर्ड दर्ज करें। यही पहला व्यवस्थापक खाता है।
4. विज़ार्ड पूरा करें। वह आपके लिए कंसोल खोल सकता है।

सेटअप प्रोग्राम को `C:\Program Files\ProAnima\Arkvory` में और डेटा को `C:\ProgramData\ProAnima\Arkvory` में इंस्टॉल करता है। यह चार Windows सेवाएँ बनाता है: `Arkvorydatabase`, `Arkvoryapi`, `Arkvoryworker` और `Arkvorybackup`। ये किसी साइन-इन किए हुए उपयोगकर्ता के बिना चलती हैं। [Windows](../install/windows) देखें।

### Linux {#linux}

अपने डिस्ट्रीब्यूशन का पैकेज इस्तेमाल करें। पैकेज मैनेजर PostgreSQL सर्वर भी इंस्टॉल करता है (संस्करण 16 से 19 समर्थित हैं)।

```bash
# Debian, Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora, RHEL-संगत
sudo dnf install ./Arkvory-x86_64.rpm
```

इंस्टॉलेशन रूट `/opt/proanima-arkvory` है। पैकेज systemd सेवाएँ `arkvory-database`, `arkvory-api`, `arkvory-worker` और `arkvory-backup` बनाता है। उन्हें जाँचें:

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

[Linux](../install/linux) देखें।

### Docker Compose {#docker-compose}

आपको Compose के साथ Docker चाहिए। Windows पर Linux कंटेनर वाला Docker Desktop इस्तेमाल करें। स्क्रिप्ट Node.js और रिलीज़ डाउनलोड करती है, इसलिए उसे इंटरनेट एक्सेस चाहिए।

रिलीज़ से `install.sh` या `install.ps1` डाउनलोड करें और चलाने से पहले उसे पढ़ लें।

```bash
sudo bash ./install.sh --mode compose
```

Windows पर PowerShell को उसी उपयोगकर्ता के रूप में चलाएँ जो Docker Desktop चलाता है, व्यवस्थापक अधिकार के बिना:

```powershell
.\install.ps1 -Mode compose
```

इंस्टॉलेशन रूट Linux पर `/opt/proanima-arkvory` और Windows पर `C:\ProgramData\ProAnima\Arkvory` है। स्टैक में API, वर्कर, बैकअप एजेंट और PostgreSQL 18 शामिल हैं। [Docker](../install/docker) देखें।

## चरण 2. कंसोल खोलें {#step-2-open-the-console}

सर्वर पर किसी ब्राउज़र में `http://127.0.0.1:8080/console/` खोलें।

शुरू में सर्वर केवल स्थानीय पते `127.0.0.1` पर कनेक्शन स्वीकार करता है। अपने कंप्यूटर से कंसोल खोलने के लिए पोर्ट को SSH से फ़ॉरवर्ड करें:

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

फिर अपने कंप्यूटर पर `http://127.0.0.1:8080/console/` खोलें। दूसरी मशीनों को एक्सेस देने के लिए पहले [HTTPS](../install/https) सेट करें।

## चरण 3. स्वामी बनाएँ {#step-3-create-the-owner}

Windows पर यह चरण छोड़ दें: सेटअप स्वामी को पहले ही बना चुका है।

Linux और Docker पर पहला खाता **पुनर्प्राप्ति कुंजी** से बनता है। इंस्टॉलर उसे इंस्टॉलेशन रूट में `config/bootstrap-token.txt` में लिखता है। इस फ़ाइल को केवल व्यवस्थापक पढ़ सकता है।

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. कंसोल में [[ui:navStart]] खोलें और [[ui:welcomeOwner]] को विस्तृत करें।
2. कुंजी को [[ui:welcomeRecovery]] में पेस्ट करें।
3. स्वामी का नाम और कम से कम 12 वर्णों का पासवर्ड दर्ज करें, फिर [[ui:welcomeCreate]] चुनें।
4. [[ui:connection]] कार्ड में नए नाम और पासवर्ड से साइन इन करें।

पुनर्प्राप्ति कुंजी को गोपनीय रखें और फ़ाइल को न हटाएँ। इंस्टॉलेशन और अपडेट के टूल उसका उपयोग करते हैं। [सुरक्षा](../operate/security) देखें।

स्वामी व्यवस्थापक है और रिपॉज़िटरी `releases` में लिख सकता है। दूसरी रिपॉज़िटरी बनाने के लिए [[ui:administration]] खोलें, [[ui:manageGrants]] को विस्तृत करें, समूह `arkvory-owners` को किसी नए नाम, जैसे `builds`, के लिए एक्सेस दें (अनुमति के रूप में [[ui:write]] चुनें) और [[ui:saveGrant]] चुनें। रिपॉज़िटरी का नाम छोटे लैटिन अक्षरों, अंकों, `-` और `_` से बनता है और अधिकतम 64 वर्णों का होता है।

## चरण 4. अपने टूल के लिए कुंजी बनाएँ {#step-4-create-a-key-for-your-tools}

स्क्रिप्ट और कमांड-लाइन क्लाइंट को कुंजी चाहिए। पहले परीक्षण के लिए व्यक्तिगत एक्सेस टोकन इस्तेमाल करें:

1. [[ui:connection]] कार्ड में [[ui:personalAccessTokens]] को विस्तृत करें।
2. [[ui:tokenName]] दर्ज करें, [[ui:tokenScope]] को [[ui:tokenScopeReadWrite]] पर सेट करें और [[ui:generateToken]] चुनें।
3. टोकन कॉपी करें। यह केवल एक बार दिखाया जाता है।
4. उसे ऐसी फ़ाइल में सहेजें जिसे केवल आप पढ़ सकें, उदाहरण के लिए `~/.arkvory/key`।

CI/CD और डिप्लॉयमेंट एजेंट के लिए इसके बजाय अपनी कुंजी वाला सेवा खाता बनाएँ। [खाते और एक्सेस](../use/accounts) देखें।

## चरण 5. curl से अपलोड और डाउनलोड करें {#step-5-upload-and-download-with-curl}

रिपॉज़िटरी में फ़ाइल पथ वेब सर्वर की फ़ाइल की तरह काम करता है। `PUT` पथ का नया संस्करण सहेजता है और `GET` वर्तमान संस्करण लौटाता है।

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# अपलोड
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# डाउनलोड
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

अपलोड ऐसा JSON लौटाता है:

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

अगर आप वही बाइट दोबारा अपलोड करते हैं, तो उत्तर `200` और `"created": false` के साथ आता है, और कोई नया संस्करण नहीं बनता। नई फ़ाइल को स्टेटस `201` मिलता है।

PowerShell में:

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

एक `PUT` अनुरोध 30 मिनट के भीतर पूरा होना चाहिए। बहुत बड़ी फ़ाइलों या धीमे नेटवर्क के लिए कमांड-लाइन क्लाइंट इस्तेमाल करें: वह भागों में अपलोड करता है और विफलता के बाद वहीं से जारी रहता है। [रॉ फ़ाइलें](../protocols/raw-files) देखें।

## चरण 6. कमांड-लाइन क्लाइंट इस्तेमाल करें {#step-6-use-the-command-line-client}

`arkvoryctl` को अपने कंप्यूटर पर इंस्टॉल करें: Windows पर `Arkvory-CLI-Setup-x64.exe`, Linux पर `Arkvory-CLI-amd64.deb` या `Arkvory-CLI-x86_64.rpm`। Node.js 24 वाली CI मशीन पर `arkvoryctl.mjs` भी चलता है।

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

प्रोफ़ाइल रिपॉज़िटरी `releases` इस्तेमाल करती है, जब तक आप `--repository` न जोड़ें। अगर कोई ट्रांसफ़र रुक जाए, तो वही कमांड फिर से चलाएँ: वह वहीं से जारी रहता है जहाँ रुका था और अंत में SHA-256 जाँचता है। क्लाइंट सादा HTTP केवल स्थानीय कंप्यूटर के लिए स्वीकार करता है; दूरस्थ सर्वर के लिए HTTPS इस्तेमाल करें। [कमांड-लाइन क्लाइंट](../protocols/cli) देखें।

## अगले कदम {#next-steps}

- [अवधारणाएँ](./concepts): रिपॉज़िटरी, आर्टिफ़ैक्ट, स्टेज और कुंजियाँ।
- [HTTPS](../install/https): सर्वर को दूसरी मशीनों के लिए सुरक्षित रूप से खोलें।
- [बैकअप](../operate/backups): महत्वपूर्ण डेटा रखने से पहले बैकअप स्टोरेज जोड़ें।
- [पैकेज](../use/packages) और [प्रमोशन](../use/promotion): डिप्लॉयमेंट के लिए संस्करणित बिल्ड।
- [वेब कंसोल](./console): सभी अनुभागों का दौरा।
