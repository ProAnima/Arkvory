---
title: 'रॉ फ़ाइलें'
description: 'एक HTTP अनुरोध से किसी फ़ाइल को उसके पथ से संग्रहीत और पढ़ें, curl, wget या PowerShell इस्तेमाल करके, बिना कुछ इंस्टॉल किए।'
---

# रॉ फ़ाइलें

रिपॉज़िटरी में एक फ़ाइल पथ वेब सर्वर पर फ़ाइल की तरह काम करता है। `PUT` किसी बॉडी को पथ के अगले संस्करण के रूप में संग्रहीत करता है। `GET` वर्तमान संस्करण लौटाता है। इसका उपयोग उन बिल्ड स्क्रिप्ट और CI जॉब से करें जिनके पास `curl` या PowerShell है और और कुछ नहीं।

यह पता तीनों मेथड के लिए समान है:

```text
https://<host>/api/v1/repositories/<repository>/raw/<path>
```

उदाहरण के लिए: `https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe`.

## फ़ाइल संग्रहीत करें {#store-a-file}

आपको एक रिपॉज़िटरी और write एक्सेस वाली कुंजी चाहिए। [खाते और कुंजियाँ](../use/accounts) देखें। कुंजी को `Authorization: Bearer <key>` के रूप में भेजें। रॉ फ़ाइलें किसी अन्य प्रकार का प्रमाणीकरण स्वीकार नहीं करतीं।

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
URL="https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"

curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$URL"
```

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe'
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

```bash
wget -qO- --method=PUT --body-file=GameSetup.exe \
  --header="Authorization: Bearer $ARKVORY_KEY" "$URL"
```

`curl -T` को फ़ाइल का पूरा पता दें, फ़ोल्डर का नहीं। पथ में वे अक्षर एन्कोड करें जिन्हें URL अनुमति नहीं देता: स्पेस को `%20`, `#` को `%23` और `?` को `%3F` लिखें।

उत्तर JSON है। नई फ़ाइल या नए बाइट `201` लौटाते हैं:

```json
{
  "path": "builds/game/1.4/GameSetup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "00000000-0000-4000-8000-000000000001", "size": "1048576", "sha256": "…" }
}
```

यदि पथ में पहले से ठीक यही बाइट हैं, तो उत्तर `200` है जिसमें `"created": false` और वही संशोधन होता है। कुछ भी संग्रहीत नहीं होता। CI जॉब का एक स्टेप नया संस्करण बनाए बिना फिर से चल सकता है। `size` दशमलव अंकों की एक स्ट्रिंग है।

### चेकसम भेजें {#send-a-checksum}

फ़ाइल का SHA-256 `X-Checksum-Sha256` के साथ भेजें, और लंबाई `Content-Length` के साथ। `curl -T` और PowerShell फ़ाइल की लंबाई भेजते हैं। फिर सर्वर बाइट को एक ही पास में सीधे स्टोरेज में लिखता है और वहीं उन्हें जाँचता है। गलत चेकसम `integrity_mismatch` कोड के साथ `422` लौटाता है, कुछ भी संग्रहीत नहीं करता, और पथ को वैसे ही बनाए रखता है।

```bash
curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "X-Checksum-Sha256: $(sha256sum GameSetup.exe | cut -d' ' -f1)" \
  "$URL"
```

```powershell
$headers['X-Checksum-Sha256'] = (Get-FileHash .\GameSetup.exe -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

चेकसम के बिना, या ऐसी chunked बॉडी के साथ जिसमें `Content-Length` नहीं है, सर्वर पहले बॉडी को एक अस्थायी फ़ाइल में लिखता है और उसका हैश बनाता है। फिर वह उसे संग्रहीत करता है। इसके लिए सर्वर की डिस्क पर थोड़े समय के लिए फ़ाइल के आकार का दोगुना तक और बाइट पर दूसरा पास चाहिए। विफलता से बची अस्थायी फ़ाइलें सर्वर एक दिन बाद हटा देता है।

जब आप चेकसम और लंबाई भेजते हैं, और पथ में पहले से ये बाइट हैं, तो सर्वर बॉडी पढ़े बिना `200` उत्तर देता है, और कनेक्शन बंद कर देता है।

### केवल बनाएँ {#create-only}

एक `PUT` केवल एक शर्त पढ़ता है, `If-None-Match: *`। इसके साथ, सर्वर फ़ाइल केवल तब संग्रहीत करता है जब पथ मौजूद न हो। अन्यथा वह `already_exists` कारण के साथ `409` उत्तर देता है, तब भी जब बाइट समान हों। `PUT` पर `If-None-Match` का कोई अन्य मान `400` लौटाता है।

```bash
curl --fail-with-body -sS -T ./notes.txt \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-None-Match: *" \
  "https://arkvory.example/api/v1/repositories/releases/raw/docs/notes.txt"
```

### दो लेखक {#two-writers}

जब दो अनुरोध एक ही समय पर एक ही पथ बदलते हैं, तो पहला जीतता है। बाद वाले को `revision_mismatch` कारण के साथ `409` मिलता है, और पथ विजेता की सामग्री रखता है। नया संशोधन बनाने के लिए अनुरोध फिर से चलाएँ। हारने वाले के अपलोड किए गए बाइट बिना पथ के एक आर्टिफ़ैक्ट के रूप में तब तक रहते हैं जब तक प्रतिधारण उन्हें हटा न दे।

## फ़ाइल पढ़ें {#read-a-file}

`GET` पथ का वर्तमान संस्करण लौटाता है। `HEAD` केवल हेडर लौटाता है।

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $ARKVORY_KEY" -o GameSetup.exe "$URL"
```

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\GameSetup.exe
```

```bash
wget --header="Authorization: Bearer $ARKVORY_KEY" -O GameSetup.exe "$URL"
```

उत्तर हेडर:

| हेडर                    | मान                                                         |
| ----------------------- | ----------------------------------------------------------- |
| `ETag`                  | `"sha256:<digest>"`: सामग्री का SHA-256, उद्धरण चिह्नों में |
| `Content-Length`        | फ़ाइल का आकार                                               |
| `Accept-Ranges`         | `bytes`                                                     |
| `Content-Type`          | हमेशा `application/octet-stream`                            |
| `Content-Disposition`   | फ़ाइल नाम के रूप में पथ के अंतिम खंड के साथ `attachment`    |
| `X-Arkvory-Artifact-Id` | इस संस्करण को रखने वाले आर्टिफ़ैक्ट की ID                   |

अज्ञात पथ `404` लौटाता है।

### रेंज और सशर्त अनुरोध {#ranges-and-conditional-requests}

| अनुरोध हेडर                 | प्रभाव                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Range: bytes=0-1023`       | माँगे गए भाग और `Content-Range` के साथ `206`। फ़ाइल के अंत से आगे शुरुआत `Content-Range: bytes */<size>` के साथ `416` लौटाती है। |
| `Range: bytes=-1024`        | अंतिम 1024 बाइट                                                                                                                  |
| `Range: bytes=1048576-`     | ऑफ़सेट से अंत तक                                                                                                                 |
| `If-Range: "sha256:…"`      | `Range` को केवल तब लागू करता है जब ETag ठीक यही हो। यदि पथ का नया संस्करण हो, तो आपको पूरी नई फ़ाइल मिलती है।                    |
| `If-None-Match: "sha256:…"` | यदि ETag समान हो तो बिना बॉडी `304`। यह `HEAD` के साथ भी काम करता है।                                                            |

प्रति अनुरोध केवल एक रेंज समर्थित है। कई रेंज वाला अनुरोध पूरी फ़ाइल लौटाता है।

एक पथ कभी भी नया संस्करण पा सकता है, और एक `GET` पथ को फिर से हल करता है। डाउनलोड सुरक्षित रूप से जारी रखने के लिए, पहले उत्तर का `ETag` याद रखें और उसे `If-Range` के रूप में भेजें:

```bash
etag=$(curl -sSI -H "Authorization: Bearer $ARKVORY_KEY" "$URL" | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -sS -H "Authorization: Bearer $ARKVORY_KEY" -H "If-Range: $etag" \
  -H "Range: bytes=1048576-" "$URL" >> GameSetup.part
```

जब फ़ाइल नहीं बदली हो तो डाउनलोड छोड़ने के लिए, पिछली बार सहेजा गया ETag भेजें:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ARKVORY_KEY" \
  -H 'If-None-Match: "sha256:<digest>"' "$URL"
```

बड़ी फ़ाइलों के लिए, [`arkvoryctl get`](./cli) जारी रखते हुए डाउनलोड करता है और आपके लिए SHA-256 सत्यापित करता है।

## पथ और संस्करण {#paths-and-versions}

रॉ फ़ाइल एक [पथ वाली फ़ाइल](../use/files) है। नए बाइट के साथ हर `PUT` पथ में एक संशोधन जोड़ता है: संशोधन 1, 2, 3 और इसी तरह। पहले के संशोधन बने रहते हैं। बाइट कभी बदले नहीं जाते, क्योंकि हर संशोधन अपने स्वयं के अपरिवर्तनीय आर्टिफ़ैक्ट की ओर इंगित करता है, जिसका नाम पथ के अंतिम खंड पर रखा जाता है।

- रॉ पते पर `GET` हमेशा वर्तमान संशोधन देता है।
- किसी पथ के सभी संशोधन देखने के लिए, उसका इतिहास पढ़ें: [`getAssetHistory`](../api/reference/files#getAssetHistory), या कंसोल में [[ui:history]]।
- पुराना संशोधन पढ़ने के लिए, [`getAssetRevision`](../api/reference/files#getAssetRevision) उसका आर्टिफ़ैक्ट लौटाता है। इसे आर्टिफ़ैक्ट के कंटेंट पते से डाउनलोड करें।
- पुराने संशोधन पर लौटने के लिए, [`restoreAsset`](../api/reference/files#restoreAsset) इस्तेमाल करें। यह एक नया संशोधन जोड़ता है जो पुराने बाइट की ओर इंगित करता है।
- रिपॉज़िटरी के पथों को उपसर्ग के अनुसार सूचीबद्ध करने के लिए, [`listAssetPage`](../api/reference/files#listAssetPage) इस्तेमाल करें।
- पथ हटाया नहीं जा सकता। इतिहास बना रहता है। प्रतिधारण उन आर्टिफ़ैक्ट को नहीं हटाता जिन्हें कोई पथ संशोधन इस्तेमाल करता है।

यही ऑपरेशन [SDK](./sdk#raw-files-by-path) (`client.raw.putRawFile`, `downloadRawFile`) में और [`arkvoryctl`](./cli#transfers) (`put`, `get`) में हैं।

### पथ नियम {#path-rules}

| नियम        | मान                                                              |
| ----------- | ---------------------------------------------------------------- |
| लंबाई       | 1 से 1024 अक्षर                                                  |
| फ़ोल्डर     | `/` से अलग किए गए खंड                                            |
| अनुमति नहीं | खाली खंड (`a//b`), `.` या `..`, बैकस्लैश, कोलन और नियंत्रण अक्षर |

`curl` और ब्राउज़र भेजने से पहले URL से `.` और `..` हटा देते हैं, इसलिए ऐसा पथ कभी नहीं पहुँचता। नियम तोड़ने वाला पथ `400` लौटाता है।

## अनुमतियाँ {#permissions}

व्यक्तिगत टोकन और फ़ाइल कुंजियों को रिपॉज़िटरी पर read या write एक्सेस मिलता है। सेवा कुंजियों को सटीक कार्रवाइयाँ मिलती हैं।

| ऑपरेशन        | सेवा कुंजी कार्रवाइयाँ                                                                           | व्यक्तिगत टोकन या फ़ाइल कुंजी         |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `GET`, `HEAD` | `content.read`                                                                                   | Read एक्सेस                           |
| `PUT`         | `upload.create`, `upload.write`, `upload.complete`, `asset.read`, `asset.write`, `artifact.read` | Write एक्सेस, टोकन स्कोप `read-write` |

केवल डाउनलोड करने वाले डिप्लॉयमेंट एजेंट को `content.read` कार्रवाई चाहिए।

एक [रीड गेटवे](../operate/read-gateways) केवल `GET` और `HEAD` स्वीकार करता है। एक [मिरर](../operate/mirrors) reads परोसता है और `409` तथा `mirror_read_only` कारण के साथ `PUT` अस्वीकार करता है।

## सीमाएँ {#limits}

| सीमा            | मान                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| फ़ाइल आकार      | इंस्टॉलेशन का अधिकतम ऑब्जेक्ट आकार, `ARKVORY_MAX_OBJECT_BYTES` (डिफ़ॉल्ट रूप से लगभग 10 TiB)                                                                                  |
| एक `PUT` अनुरोध | 30 मिनट के भीतर पूरा होना चाहिए और 30 सेकंड से अधिक रुकना नहीं चाहिए (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`)। ये अधिकतम अनुमत मान भी हैं।            |
| एक साथ अपलोड    | डिफ़ॉल्ट रूप से प्रति सर्वर 2 और प्रति कुंजी 1 (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`)। प्रतीक्षारत अनुरोध 20 सेकंड के बाद `503` के साथ हार मान लेता है। |
| एक साथ डाउनलोड  | डिफ़ॉल्ट रूप से प्रति सर्वर 16 और प्रति कुंजी 4                                                                                                                               |
| कोटा            | फ़ाइल रिपॉज़िटरी कोटा और इंस्टॉलेशन की क्षमता के विरुद्ध गिनी जाती है                                                                                                         |

एक अकेले `PUT` में resume नहीं होता: विफलता के बाद, यह पहले बाइट से फिर शुरू होता है। छोटी और मध्यम फ़ाइलों तथा स्क्रिप्ट के लिए रॉ फ़ाइलें इस्तेमाल करें। बड़ी फ़ाइलों या धीमे नेटवर्क के लिए, [`arkvoryctl put`](./cli) या [SDK](./sdk) इस्तेमाल करें। वे भागों में अपलोड करते हैं, विफलता के बाद जारी रखते हैं और SHA-256 जाँचते हैं। वे फ़ाइल को पथ के संशोधन के रूप में भी संग्रहीत करते हैं। वेरिएबल [एनवायरनमेंट वेरिएबल](../reference/environment#transfers-and-bandwidth) में वर्णित हैं।

## Unity Addressables {#addressables}

Addressables कैटलॉग और बंडल साधारण `GET` अनुरोधों से लोड करते हैं, इसलिए बिल्ड फ़ोल्डर raw पथ के नीचे रह सकता है। यह आंतरिक बिल्ड, QA और टूल के लिए उपयुक्त है। सार्वजनिक इंटरनेट पर खिलाड़ियों के लिए यह उपयुक्त नहीं है: raw पढ़ने के लिए हमेशा कुंजी चाहिए, डाउनलोड लिंक 24 घंटे में समाप्त हो जाता है, और जारी किए गए क्लाइंट के अंदर की कुंजी गोपनीय नहीं रहती।

`arkvoryctl put` से फ़ोल्डर अपलोड करें। जिन फ़ाइलों के बाइट नहीं बदले, उन्हें दोबारा नहीं भेजा जाता। हर बिल्ड के लिए एक फ़ोल्डर इस्तेमाल करें, क्योंकि पथ हमेशा अपना नवीनतम संशोधन लौटाता है और पुराना कैटलॉग नए बंडलों से नहीं मिलना चाहिए:

```bash
cd ServerData/StandaloneWindows64
find . -type f | while read -r file; do
  arkvoryctl put "$file" "addressables/game/$BUILD/StandaloneWindows64/${file#./}" || exit 1
done
```

```powershell
$root = (Resolve-Path .\ServerData\StandaloneWindows64).Path
Get-ChildItem $root -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($root.Length + 1) -replace '\\', '/'
  arkvoryctl put $_.FullName "addressables/game/$env:BUILD/StandaloneWindows64/$relative"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Addressables प्रोफ़ाइल का रिमोट लोड पथ उस फ़ोल्डर के raw पते पर सेट करें, उदाहरण के लिए `https://arkvory.example/api/v1/repositories/releases/raw/addressables/game/<build>/[BuildTarget]`। क्लाइंट को केवल पढ़ने वाली कुंजी दें: पढ़ने की पहुँच वाला व्यक्तिगत एक्सेस टोकन, या `content.read` कार्रवाई वाली सेवा कुंजी। raw कुंजी केवल `Authorization` हेडर में स्वीकार करता है, इसलिए इसे हर अनुरोध में सेट करें:

```csharp
Addressables.WebRequestOverride = request =>
{
    if (request.url.StartsWith("https://arkvory.example/"))
        request.SetRequestHeader("Authorization", "Bearer " + readKey);
};
```

Addressables 1.x में यह प्रॉपर्टी `Addressables.WebRequestOverride` है; अपने संस्करण में नाम जाँचें। यह एक पैटर्न है, परीक्षित इंटीग्रेशन नहीं।

## समस्या निवारण {#troubleshooting}

त्रुटियाँ `code`, `reason`, `message` और `requestId` वाले JSON दस्तावेज़ हैं। [त्रुटियाँ](../api/errors) देखें। सर्वर लॉग में अनुरोध खोजने के लिए अपने व्यवस्थापक को `requestId` दें।

| स्टेटस      | कारण                                                        | वजह                                                                                                    | क्या करें                                                                              |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `400`       | `validation`                                                | पथ, `Content-Length`, `X-Checksum-Sha256` या `If-None-Match` मान्य नहीं है                             | पथ नियम जाँचें और URL एन्कोड करें                                                      |
| `401`       | `credential_missing`, `credential_invalid`, `token_expired` | कुंजी नहीं, गलत कुंजी, या समाप्त टोकन                                                                  | `Authorization: Bearer <key>` भेजें। Basic प्रमाणीकरण रॉ फ़ाइलों के लिए काम नहीं करता। |
| `403`       | `permission_missing`, `read_only_token`                     | कुंजी लिख नहीं सकती, या वह रीड-ओनली टोकन है                                                            | [अनुमतियाँ](#permissions) की कार्रवाइयों वाली कुंजी इस्तेमाल करें                      |
| `404`       |                                                             | पथ मौजूद नहीं है, या कुंजी रिपॉज़िटरी नहीं देख सकती                                                    | रिपॉज़िटरी नाम और पथ जाँचें                                                            |
| `409`       | `already_exists`                                            | `If-None-Match: *` और पथ मौजूद है                                                                      | संशोधन जोड़ने के लिए हेडर हटाएँ                                                        |
| `409`       | `revision_mismatch`                                         | किसी दूसरे अनुरोध ने पहले पथ बदल दिया                                                                  | अनुरोध फिर से चलाएँ                                                                    |
| `409`       | `mirror_read_only`                                          | रिपॉज़िटरी एक मिरर है                                                                                  | मुख्य सर्वर पर लिखें                                                                   |
| `416`       | `range_not_satisfiable`                                     | रेंज फ़ाइल के अंत के बाद शुरू होती है                                                                  | `HEAD` से आकार जाँचें                                                                  |
| `422`       | `integrity_mismatch`                                        | बॉडी `X-Checksum-Sha256` या `Content-Length` से मेल नहीं खाती                                          | चेकसम फिर से निकालें; प्रॉक्सी जाँचें                                                  |
| `503`       | `busy`                                                      | एक साथ बहुत अधिक ट्रांसफ़र                                                                             | `Retry-After` में दिए समय तक प्रतीक्षा करें और फिर प्रयास करें                         |
| `507`       | `storage_quota`                                             | रिपॉज़िटरी कोटा या इंस्टॉलेशन की क्षमता भर गई है                                                       | जगह खाली करें या बड़ा कोटा माँगें                                                      |
| स्टेटस नहीं | भेजते समय `curl: (55)` या `(56)`                            | सर्वर ने कनेक्शन बंद कर दिया। जब पथ में पहले से बाइट हों, तो वह `200` उत्तर देता है और बंद कर देता है। | `curl -i` चलाएँ और उत्तर पढ़ें                                                         |
| स्टेटस नहीं | कनेक्शन 30 मिनट बाद बंद हो जाता है                          | अपलोड की समय-सीमा                                                                                      | `arkvoryctl put` इस्तेमाल करें                                                         |

## संबंधित पेज {#related-pages}

- [क्लाइंट और प्रोटोकॉल](./index)
- [कमांड लाइन (arkvoryctl)](./cli)
- [TypeScript SDK](./sdk)
- [फ़ाइलें और पथ](../use/files)
- [API संदर्भ: पथ वाली फ़ाइलें](../api/reference/files)
