---
title: कमांड लाइन (arkvoryctl)
---

# कमांड लाइन (arkvoryctl)

`arkvoryctl` लोगों और CI/CD के लिए Arkvory का दूरस्थ क्लाइंट है। यह भागों में अपलोड और डाउनलोड करता है, रुकावटों के बाद जारी रहता है और SHA-256 जाँचता है। यह उस कुंजी की अनुमतियों के साथ काम करता है जो आप इसे देते हैं।

## इंस्टॉल करें {#install}

| सिस्टम                                               | पैकेज                       | इंस्टॉल कैसे करें                                                                                                                                          |
| ---------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server 2019+ (x64)            | `Arkvory-CLI-Setup-x64.exe` | इसे चलाएँ। यह व्यवस्थापक अधिकार के बिना मौजूदा उपयोगकर्ता के लिए इंस्टॉल होता है और `arkvoryctl` को उपयोगकर्ता के `PATH` में जोड़ता है। नया टर्मिनल खोलें। |
| Debian, Ubuntu (x64)                                 | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                                                                                 |
| Fedora, RHEL-संगत (x64)                              | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                                                                                |
| Node.js 24 वाला कोई भी सिस्टम (उदाहरण के लिए CI रनर) | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                                                             |

नेटिव पैकेजों में अपना Node.js शामिल है। एकल फ़ाइल `arkvoryctl.mjs` की कोई npm निर्भरता नहीं है। फ़ाइलें `ProAnima/Arkvory` की किसी भरोसेमंद रिलीज़ से लें और उनके SHA-256 की तुलना `release-checksums.json` से करें। ARM64 पैकेज अभी उपलब्ध नहीं हैं। अपडेट करने के लिए नई स्थिर रिलीज़ इंस्टॉल करें। अनइंस्टॉल करने पर आपकी प्रोफ़ाइलें, कुंजी फ़ाइलें और चेकपॉइंट बने रहते हैं।

## सर्वर से कनेक्ट करें {#connect-to-a-server}

1. कुंजी लें: कंसोल से व्यक्तिगत एक्सेस टोकन, या अपने व्यवस्थापक से सेवा कुंजी। [खाते और कुंजियाँ](../use/accounts) देखें।
2. कुंजी को किसी भी रिपॉज़िटरी के बाहर एक निजी फ़ाइल में सहेजें। Linux पर मोड `0600` इस्तेमाल करें। Windows पर एक्सेस केवल अपने खाते को दें।
3. प्रोफ़ाइल जोड़ें और कनेक्शन जाँचें:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

`doctor` सर्वर, रिपॉज़िटरी, क्षमताएँ और कुंजी की अनुमतियाँ दिखाता है। कुंजी कभी कमांड आर्गुमेंट नहीं होती।

## प्रोफ़ाइल और एनवायरनमेंट {#profiles-and-environment}

प्रोफ़ाइलें `~/.config/arkvory` में `profiles.json` में सहेजी जाती हैं (Windows पर आपके उपयोगकर्ता फ़ोल्डर में `.config\arkvory`)। प्रोफ़ाइल में सर्वर URL, डिफ़ॉल्ट रिपॉज़िटरी और कुंजी फ़ाइल का **पथ** सहेजा जाता है, कुंजी नहीं।

| कमांड                                                                   | प्रभाव                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | प्रोफ़ाइल जोड़ता है। पहली प्रोफ़ाइल डिफ़ॉल्ट बन जाती है। डिफ़ॉल्ट रिपॉज़िटरी `releases` है। |
| `profile list`                                                          | सभी प्रोफ़ाइल और सक्रिय प्रोफ़ाइल दिखाता है                                                 |
| `profile use NAME`                                                      | प्रोफ़ाइल को डिफ़ॉल्ट बनाता है                                                              |
| `profile remove NAME`                                                   | प्रोफ़ाइल हटाता है                                                                          |

| वेरिएबल              | अर्थ                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | कुंजी स्वयं। किसी भी फ़ाइल पर इसे प्राथमिकता मिलती है।                                                                        |
| `ARKVORY_TOKEN_FILE` | कुंजी फ़ाइल का पथ। प्रोफ़ाइल की फ़ाइल पर इसे प्राथमिकता मिलती है।                                                             |
| `ARKVORY_BASE_URL`   | सर्वर URL। सेट होने पर प्रोफ़ाइल की कुंजी फ़ाइल इस्तेमाल **नहीं** होती: कुंजी `ARKVORY_TOKEN` या `ARKVORY_TOKEN_FILE` से दें। |
| `ARKVORY_CLI_HOME`   | `profiles.json` के लिए दूसरा फ़ोल्डर                                                                                          |

सर्वर URL में HTTPS होना चाहिए। सादा HTTP केवल `localhost`, `127.0.0.1` और `[::1]` के लिए मान्य है। TLS सत्यापन बंद नहीं किया जा सकता।

## वैश्विक विकल्प {#global-options}

| विकल्प                     | डिफ़ॉल्ट         | अर्थ                                                                                                 |
| -------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `--profile NAME`           | सक्रिय प्रोफ़ाइल | केवल इस कमांड के लिए प्रोफ़ाइल                                                                       |
| `--repository NAME`        | प्रोफ़ाइल से     | केवल इस कमांड के लिए रिपॉज़िटरी                                                                      |
| `--json`                   | बंद              | stdout पर एक संक्षिप्त JSON परिणाम; त्रुटियाँ stderr पर JSON के रूप में                              |
| `--lang en` या `--lang ru` | `LANG` से        | सहायता और संदेशों की भाषा                                                                            |
| `--timeout MS`             | 60000            | प्रबंधन अनुरोधों की सीमा (1 से 3600000)                                                              |
| `--attempt-timeout MS`     | 120000           | एक ट्रांसफ़र प्रयास की सीमा (1 से 1800000)                                                           |
| `--retries N`              | 20               | एक ऑपरेशन के लिए नेटवर्क रीट्राई (0 से 100); `0` उन्हें बंद कर देता है                               |
| `--verbose`                | बंद              | हर HTTP अनुरोध के लिए stderr पर एक पंक्ति: मेथड, पथ, स्टेटस, समय, अनुरोध ID। कोई हेडर या कुंजी नहीं। |
| `--help`, `--version`      |                  | सहायता; JSON के रूप में क्लाइंट का संस्करण                                                           |
| `--`                       |                  | विकल्पों को समाप्त करता है, उन फ़ाइल नामों के लिए जो `-` से शुरू होते हैं                            |

हर विकल्प एक ही बार आ सकता है। अज्ञात विकल्प अस्वीकार कर दिए जाते हैं।

## कमांड {#commands}

### खोज और कैटलॉग {#discovery-and-catalog}

| कमांड                                                                      | परिणाम                              |
| -------------------------------------------------------------------------- | ----------------------------------- |
| `doctor`                                                                   | कनेक्शन, क्षमताएँ और अनुमतियाँ      |
| `repositories [--after CURSOR]`                                            | कुंजी को दिखने वाली रिपॉज़िटरी      |
| `operations [--after CURSOR]`                                              | रिपॉज़िटरी में उपलब्ध API ऑपरेशन    |
| `list [--after CURSOR]`                                                    | रिपॉज़िटरी के आर्टिफ़ैक्ट           |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | नाम और मेटाडेटा के पाठ से खोज       |
| `search --metadata-key KEY --metadata-value VALUE`                         | मेटाडेटा का सटीक मिलान (दोनों दें)  |
| `inspect ID`                                                               | एक आर्टिफ़ैक्ट का मेटाडेटा          |
| `storage usage` / `storage policy`                                         | रिपॉज़िटरी का उपयोग और स्टोरेज नीति |

पेज `next` लौटाते हैं। अगला पेज पढ़ने के लिए उसे `--after` के साथ दें।

### ट्रांसफ़र {#transfers}

| कमांड                                                                          | परिणाम                                                                                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | किसी भी फ़ाइल का जारी रखने योग्य अपलोड                                                                          |
| `download ID OUTPUT`                                                           | जारी रखने योग्य, SHA-256 से सत्यापित डाउनलोड                                                                    |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | फ़ाइल अपलोड करता है और उसे पथ का अगला संशोधन बनाता है। अगर पथ में पहले से वही बाइट हैं, तो कुछ अपलोड नहीं होता। |
| `get PATH OUTPUT`                                                              | पथ का वर्तमान संशोधन डाउनलोड करता है, सत्यापित और जारी रखने योग्य                                               |
| `link ID [--ttl SECONDS]`                                                      | बिना कुंजी वाला डाउनलोड URL, 60 सेकंड से 24 घंटे तक मान्य (डिफ़ॉल्ट रूप से 1 घंटा)                              |
| `uploads status ID` / `uploads cancel ID`                                      | अपलोड सत्र की स्थिति; उसे रद्द करना (रद्द करना रोकना नहीं है)                                                   |

`METADATA.json` में `labels` और `metadata` (स्ट्रिंग का मैप) होते हैं। इसे `--label` पर प्राथमिकता मिलती है।

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

डाउनलोड लिंक एक सीक्रेट है। समाप्त होने से पहले उसे निरस्त नहीं किया जा सकता।

### पैकेज और प्रमोशन {#packages-and-promotion}

| कमांड                                                                                                                 | परिणाम                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | UPack पैकेज                                                                     |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | UPack आर्काइव अपलोड करता है और उसे पंजीकृत करता है                              |
| `packages register ID`                                                                                                | पहले से अपलोड किए गए UPack को पंजीकृत करता है                                   |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | संस्करण चुनता है (`--exact` और `--range` साथ नहीं दिए जा सकते)                  |
| `packages download NAME OUTPUT [same filters]`                                                                        | संस्करण चुनता है, फिर उसे सत्यापित करके डाउनलोड करता है                         |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | आर्टिफ़ैक्ट को बाइट दोबारा भेजे बिना किसी दूसरी रिपॉज़िटरी में प्रकाशित करता है |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | आर्टिफ़ैक्ट के स्टेज                                                            |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | प्रमोशन का इतिहास                                                               |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

सटीक संस्करण के लिए `--exact` इस्तेमाल करें; `--version` क्लाइंट का संस्करण छापता है। [पैकेज](../use/packages) और [प्रमोशन](../use/promotion) देखें।

### एनोटेशन और अटैचमेंट {#annotations-and-attachments}

`annotations get ID` और `annotations set ID --revision N --file ANNOTATIONS.json` लेबल, मेटाडेटा और संग्रह पढ़ते और बदलते हैं। `attachments get ID`, `attachments history ID` और `attachments set ID --revision N --file ATTACHMENTS.json` बिल्ड की जुड़ी हुई फ़ाइलों के लिए यही करते हैं। पहले पढ़ें, फिर पूरी नई स्थिति उस संशोधन के साथ भेजें जो आपने पढ़ा था। साथ-साथ हुआ बदलाव टकराव (conflict) लौटाता है (एग्ज़िट कोड 6)।

### बैकअप {#backups}

| कमांड                                                             | परिणाम                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `backup status`                                                   | बैकअप स्टोरेज, एजेंट, योजना, आख़िरी बिंदु, चेतावनियाँ; गंभीर चेतावनी पर एग्ज़िट कोड 9 |
| `backup run`                                                      | बैकअप जॉब को कतार में लगाता है                                                        |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | जॉब और पुनर्स्थापना बिंदु, सबसे नए पहले                                               |
| `backup verify POINT_ID`                                          | किसी बिंदु के पूर्ण सत्यापन को कतार में लगाता है                                      |
| `backup pin POINT_ID [--off]`                                     | बिंदु को प्रतिधारण से आगे रखता है, या उसे छोड़ देता है                                |

इन कमांड के लिए इंस्टॉलेशन स्वामी (bootstrap) की फ़ाइल कुंजी या खाता व्यवस्थापक का सत्र चाहिए। व्यक्तिगत टोकन और सेवा कुंजियों को 403 मिलता है (एग्ज़िट कोड 3)। काम सर्वर का बैकअप एजेंट करता है। मॉनिटरिंग का उदाहरण: `arkvoryctl backup status --json || alert`। [बैकअप](../operate/backups) देखें।

## रुके हुए ट्रांसफ़र जारी रखें {#resume-interrupted-transfers}

Ctrl+C या नेटवर्क विफलता के बाद **उन्हीं विकल्पों के साथ वही कमांड** फिर से चलाएँ।

- `upload`, `put` और `packages publish` स्रोत फ़ाइल के पास चेकपॉइंट रखते हैं: `<source>.arkvory-upload.json`, या `--state` से दी गई फ़ाइल। यह पहले अनुरोध से पहले आइडेम्पोटेंसी कुंजी सहेज लेता है, इसलिए खोया हुआ उत्तर कभी दूसरी प्रति नहीं बनाता।
- वही बाइट **नए** आर्टिफ़ैक्ट के रूप में प्रकाशित करने के लिए नई `--state` फ़ाइल इस्तेमाल करें।
- `download` और `get` आउटपुट के पास `<output>.arkvory-part` और `<output>.arkvory-download.json` रखते हैं। अंतिम फ़ाइल SHA-256 सत्यापन के बाद ही दिखती है। मौजूदा आउटपुट फ़ाइल कभी अधिलेखित नहीं की जाती।
- CI में जॉब से पहले state फ़ोल्डर बनाएँ और रीट्राई के बीच उसे स्रोत फ़ाइल के साथ बनाए रखें।

चेकपॉइंट हार्ड लिंक वाली स्थानीय डिस्क (NTFS, ext4, XFS) पर रखें, FAT, exFAT या नेटवर्क शेयर पर नहीं। हार्ड क्रैश के बाद `.lock` फ़ाइल बची रह जाती है। जाँचें कि उसमें लिखी PID वाला प्रोसेस रुक चुका है, फिर केवल `.lock` फ़ाइल हटाएँ।

## CI उदाहरण {#ci-example}

```bash
# कुंजी CI के सीक्रेट स्टोर से आती है। उसे कभी प्रिंट न करें।
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

अगर अपलोड के बाद पंजीकरण विफल हो जाए, तो JSON त्रुटि में `stage: "register"` और `artifactId` होते हैं। वही कमांड दोहराएँ। उसी आर्टिफ़ैक्ट को दोबारा पंजीकृत करना सुरक्षित है।

### CI सिस्टम {#ci-systems}

नीचे दिए सभी सिस्टम एक ही काम करते हैं: एक पिन किया हुआ `arkvoryctl.mjs` इंस्टॉल करना, सिस्टम के सीक्रेट स्टोर से कुंजी लेना और एक कमांड चलाना। संस्करण और SHA-256 पिन करें, ताकि बदला हुआ डाउनलोड जॉब को विफल कर दे। ऐसी सेवा कुंजी इस्तेमाल करें जो रिपॉज़िटरी और जॉब की ज़रूरी कार्रवाइयों तक सीमित हो ([खाते और कुंजियाँ](../use/accounts))। एजेंट पर Node.js 24 चाहिए।

```yaml
# GitHub Actions: .github/workflows/publish.yml
name: publish
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      ARKVORY_BASE_URL: https://arkvory.example
      ARKVORY_TOKEN: ${{ secrets.ARKVORY_KEY }}
      ARKVORY_CLI_VERSION: '0.3.0'
      ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install arkvoryctl
        run: |
          curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
          echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
      - name: Publish the build
        run: node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${GITHUB_REF_NAME}/Game.zip" --json
```

```yaml
# GitLab CI: .gitlab-ci.yml (ARKVORY_TOKEN is a masked CI/CD variable)
publish:
  image: node:24
  variables:
    ARKVORY_BASE_URL: https://arkvory.example
    ARKVORY_CLI_VERSION: '0.3.0'
    ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
  script:
    - curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
    - echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
    - node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${CI_COMMIT_TAG}/Game.zip" --json
```

```groovy
// Jenkins: Jenkinsfile. The agent has Node.js 24 and a checked arkvoryctl.mjs, installed as above.
pipeline {
  agent any
  environment {
    ARKVORY_BASE_URL = 'https://arkvory.example'
    ARKVORY_TOKEN = credentials('arkvory-key')
  }
  stages {
    stage('Publish') {
      steps {
        sh 'node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${BUILD_NUMBER}/Game.zip" --json'
      }
    }
  }
}
```

TeamCity या Buildkite जैसा कोई भी अन्य सिस्टम इसी तरह काम करता है: उसके सीक्रेट स्टोर से `ARKVORY_BASE_URL` और `ARKVORY_TOKEN` सेट करें और कमांड चलाएँ। नतीजे का निर्णय [एग्ज़िट कोड](#exit-codes) से करें।

## आउटपुट {#output}

- परिणाम stdout पर JSON होते हैं। `--json` के बिना JSON इंडेंट किया जाता है। बैकअप कमांड `--json` जोड़े बिना पढ़ने योग्य पंक्तियाँ छापते हैं।
- प्रगति केवल इंटरैक्टिव stderr पर दिखती है।
- `--json` के बिना त्रुटि stderr की एक पंक्ति होती है, जिसमें सर्वर कोड, कारण, संदेश, अगला कदम और अनुरोध ID होते हैं। `--json` के साथ stderr में `code`, `exitCode`, `status`, `serverCode`, `reason`, `requestId` और `retryAfterSeconds` वाला `{"error": {...}}` होता है। कोड अज्ञात हो तो `exitCode` से निर्णय लें।

## एग्ज़िट कोड {#exit-codes}

| कोड | अर्थ                                                              |
| --- | ----------------------------------------------------------------- |
| 0   | सफलता                                                             |
| 2   | गलत आर्गुमेंट या कॉन्फ़िगरेशन                                     |
| 3   | कुंजी नहीं है, या एक्सेस अस्वीकृत (401, 403)                      |
| 4   | HTTP या नेटवर्क त्रुटि, टाइमआउट, सर्वर व्यस्त, नहीं मिला          |
| 5   | अखंडता विफलता (SHA-256 बेमेल, 422 `integrity_mismatch`)           |
| 6   | टकराव: संशोधन, स्थिति, लॉक, मौजूदा फ़ाइल, बदला हुआ चेकपॉइंट (409) |
| 7   | स्थानीय फ़ाइल त्रुटि या अमान्य सर्वर उत्तर                        |
| 8   | सर्वर की क्षमता सीमा: कोटा, डिस्क, कतार (507 `capacity_exceeded`) |
| 9   | `backup status`: गंभीर बैकअप चेतावनी सक्रिय है                    |
| 130 | बाधित                                                             |

क्लाइंट केवल नेटवर्क विफलताओं और HTTP 408, 429, 502, 503 और 504 को `--retries` की सीमा के भीतर दोबारा आज़माता है।

## समस्या निवारण {#troubleshooting}

| संदेश                                    | कारण और समाधान                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `credential_required` (एग्ज़िट 3)        | कोई कुंजी नहीं मिली। `--token-file`, `ARKVORY_TOKEN_FILE` जाँचें, या `ARKVORY_BASE_URL` इस्तेमाल होने पर कुंजी सेट करें। |
| `forbidden` (एग्ज़िट 3)                  | कुंजी के पास अनुमति नहीं है। अनुमतियाँ देखने के लिए `doctor` चलाएँ।                                                      |
| `checkpoint_mismatch` (एग्ज़िट 6)        | फ़ाइल, सर्वर, रिपॉज़िटरी या विकल्प सहेजे गए चेकपॉइंट से अलग हैं। मूल विकल्प इस्तेमाल करें, या नई `--state` दें।          |
| `state_locked` (एग्ज़िट 6)               | कोई दूसरा प्रोसेस चेकपॉइंट इस्तेमाल कर रहा है, या क्रैश के बाद पुरानी `.lock` बची है।                                    |
| `destination_exists` (एग्ज़िट 6)         | आउटपुट फ़ाइल मौजूद है। कोई दूसरा नाम चुनें।                                                                              |
| `put` पर `revision_mismatch` (एग्ज़िट 6) | इस बीच किसी ने पथ बदल दिया। पथ का इतिहास देखें, फिर तय करें।                                                             |
| एग्ज़िट 8                                | कोटा या डिस्क भर गई है। व्यवस्थापक से कहें।                                                                              |

## संबंधित पेज {#related-pages}

- [क्लाइंट और प्रोटोकॉल](./index)
- [ट्रांसफ़र](../use/transfers) और [पथ वाली फ़ाइलें](../use/files)
- [TypeScript SDK](./sdk)
- [त्रुटियाँ](../api/errors)
