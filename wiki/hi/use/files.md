---
title: 'पथ वाली फ़ाइलें'
description: 'किसी फ़ाइल को पथ पर पूरे इतिहास के साथ रखें, पिछले संशोधन पुनर्स्थापित करें, और लेबल, मेटाडेटा, संग्रह और अटैचमेंट जोड़ें।'
---

# पथ वाली फ़ाइलें

पथ वाली फ़ाइल रिपॉज़िटरी में एक नाम होती है, जैसे `builds/game/1.4/GameSetup.exe`, जो एक संग्रहीत फ़ाइल की ओर इशारा करता है। जब आप उसी पथ पर नई सामग्री रखते हैं, तो पथ नई फ़ाइल की ओर इशारा करता है। पुरानी बनी रहती है, और आप उस पर लौट सकते हैं। पथ का इस्तेमाल तब करें जब लोगों और स्क्रिप्टों को "वर्तमान Setup.exe" के लिए एक स्थिर पता चाहिए।

## पथ क्या है {#what-it-is}

हर संग्रहीत फ़ाइल एक अपरिवर्तनीय **आर्टिफ़ैक्ट** है, जिसका एक ID और SHA-256 होता है। पथ एक आर्टिफ़ैक्ट की ओर एक पॉइंटर है। पॉइंटर का हर बदलाव एक **संशोधन** है, जो 1 से क्रमांकित होता है। संशोधन कभी हटाए या संपादित नहीं किए जाते।

पथ में 1 से 1024 वर्ण होते हैं। यह `/` से अलग किए गए खंडों से बनता है। कोई खंड खाली नहीं होता, `.` या `..` नहीं होता और उसमें कोई कंट्रोल कैरेक्टर नहीं होता। पथ में `\` या `:` नहीं हो सकता। अक्षरों का केस मायने रखता है।

पथ और पैकेज एक ही आर्टिफ़ैक्ट के दो दृश्य हैं: एक UPack आर्काइव का भी पथ हो सकता है। [UPack पैकेज](./packages) देखें।

## किसी फ़ाइल को पथ पर रखें {#put}

आपको `upload.create`, `upload.write` और `upload.complete`, तथा `asset.read`, `asset.write` और `artifact.read` कार्रवाइयाँ चाहिए। समूहों के संदर्भ में, आपको लिखने का एक्सेस चाहिए। [अनुमतियाँ](./accounts#permissions) देखें।

### arkvoryctl के साथ {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put` फ़ाइल को भागों में अपलोड करता है, स्रोत फ़ाइल के पास एक चेकपॉइंट के साथ, और उसे पथ का अगला संशोधन बनाता है। यह `path`, `revision`, आर्टिफ़ैक्ट `id` और `created` प्रिंट करता है। अगर पथ में पहले से वही बाइट हैं, तो `put` कुछ अपलोड नहीं करता और `created` को `false` प्रिंट करता है: दोहराया गया बिल्ड चरण कुछ खर्च नहीं करता। अगर आपके अपलोड के दौरान किसी ने पथ बदल दिया, तो `put` `revision_mismatch` (एग्ज़िट कोड 6) के साथ रुक जाता है और उनका काम अधिलेखित नहीं करता। इतिहास पढ़ें और निर्णय लें। अगर अपलोड रुक जाए, तो वही कमांड दोबारा चलाएँ। [अपलोड और डाउनलोड](./transfers#resume) देखें।

`get` वर्तमान संशोधन को जारी रखने और SHA-256 जाँच के साथ डाउनलोड करता है। पथों की सूची बनाने या इतिहास पढ़ने का कोई कमांड नहीं है। उसके लिए कंसोल या API इस्तेमाल करें।

### एक HTTP अनुरोध के साथ {#put-http}

एक कच्चा `PUT` बाइट को एक ही अनुरोध में पथ पर संग्रहीत करता है, जैसा `curl -T` करता है:

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

उत्तर में `path`, `revision`, `created` और `artifact` होता है, उसके `id`, `size` और `sha256` के साथ। नया संशोधन `201` लौटाता है। वही बाइट दोबारा `200` लौटाते हैं, `created` false के साथ। दो हेडर वैकल्पिक हैं: `X-Checksum-Sha256` सर्वर को बाइट एक ही पास में जाँचने देता है, और `If-None-Match: *` पथ पहले से मौजूद होने पर अनुरोध अस्वीकार कर देता है। एक अनुरोध 30 मिनट के भीतर पूरा होना चाहिए। बड़ी फ़ाइलों के लिए `put` इस्तेमाल करें। [रॉ फ़ाइलें](../protocols/raw-files) देखें।

### कंसोल में {#put-console}

1. [[ui:upload]] में फ़ाइल अपलोड करें। [अपलोड और डाउनलोड](./transfers) देखें।
2. आर्टिफ़ैक्ट को [[ui:catalog]] में [[ui:open]] से खोलें।
3. [[ui:assetTitle]] में [[ui:assetPath]] दर्ज करें, उदाहरण के लिए `releases/current.upack`।
4. [[ui:currentRevision]] दर्ज करें: नए पथ के लिए `0`, या [[ui:history]] में दिखाया गया वर्तमान संशोधन।
5. [[ui:assign]] चुनें।

संशोधन फ़ील्ड दो लोगों द्वारा एक साथ पथ बदलने से बचाता है। अगर यह वर्तमान नहीं है, तो सर्वर टकराव के साथ अस्वीकार कर देता है। इतिहास दोबारा लोड करें और पुनः प्रयास करें।

### API और SDK के साथ {#put-api}

`setAsset` किसी पथ को उस आर्टिफ़ैक्ट की ओर इंगित करता है जिसे आप पहले ही अपलोड कर चुके हैं। `expectedRevision` पथ बनाने के लिए `0` होता है, और अन्यथा वर्तमान संशोधन।

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

टकराव `409 revision_mismatch` लौटाता है। अनुमानित संशोधन के साथ पुनः प्रयास न करें। उत्तर खो जाने के बाद, पथ पढ़ें: अगर नया आर्टिफ़ैक्ट पहले से वहाँ है, तो आपका काम हो गया।

## पथ पढ़ें {#read}

- `arkvoryctl get PATH OUTPUT` वर्तमान फ़ाइल डाउनलोड करता है।
- `GET /api/v1/repositories/<repository>/raw/<path>` और `GET /api/v1/repositories/<repository>/asset/content?path=<path>` बाइट लौटाते हैं। दोनों को `content.read` चाहिए, और वे रेंज और ETag का समर्थन करते हैं।
- `getAsset` (`GET …/asset?path=`) पॉइंटर लौटाता है: `path`, `revision`, `artifactId`।
- `listAssetPage` (`GET …/assets/page?prefix=`) पॉइंटर की सूची बनाता है। पेज UTF-8 पथ के बाइट क्रम में अधिकतम 100 (डिफ़ॉल्ट रूप से 50) रखते हैं। प्रीफ़िक्स शाब्दिक और केस-संवेदी होता है। `next` को `after` के रूप में दें। पुराना `listAssets` अधिकतम 1000 लौटाता है और प्रीफ़िक्स संकीर्ण करने को कहता है।

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## संशोधन और इतिहास {#history}

कंसोल में [[ui:history]] खोलें, [[ui:assetPath]] में पथ टाइप करें और [[ui:historyLoad]] चुनें। तालिका [[ui:revision]], समय ([[ui:date]]), लेखक ([[ui:actor]]) और, पुनर्स्थापित संशोधनों के लिए, वह संशोधन जिससे वे आए ([[ui:source]]) दिखाती है। सबसे नया पहले। [[ui:historyMore]] पुराने वाले लोड करता है, एक बार में 50। किसी पंक्ति पर [[ui:open]] उस संशोधन का आर्टिफ़ैक्ट खोलता है, जहाँ से आप उसकी मूल सामग्री डाउनलोड कर सकते हैं।

API के साथ, `getAssetHistory` (`…/asset/history?path=&before=`) पेज लौटाता है, सबसे नया पहले, और `before` पिछले पेज का अंतिम संशोधन होता है। `getAssetRevision` (`…/asset/revision?path=&revision=`) एक संशोधन लौटाता है। जो संशोधन इतिहास के रिकॉर्ड करने से पहले लिखे गए, उनके लिए लेखक और समय खाली होते हैं। पढ़ने के लिए `asset.read` चाहिए।

## पिछला संशोधन पुनर्स्थापित करें {#restore}

पुनर्स्थापित करने से पथ पुराने संशोधन के आर्टिफ़ैक्ट की ओर इशारा करता है। यह कोई बाइट कॉपी नहीं करता और कोई संशोधन नहीं हटाता: पुनर्स्थापना एक नया, नवीनतम संशोधन है, और इतिहास दिखाता है कि यह कहाँ से आया।

कंसोल में, इतिहास लोड करें और अपने मनचाहे संशोधन का पुनर्स्थापना बटन चुनें। वर्तमान संशोधन का बटन बंद रहता है। पुनर्स्थापना के लिए `asset.restore`, `asset.read` और `artifact.read` चाहिए।

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

`expectedRevision` वह नवीनतम संशोधन है जो आपने देखा। अगर इस बीच पथ बदल गया, तो सर्वर `409 revision_mismatch` लौटाता है; कंसोल एक संदेश दिखाता है और इतिहास दोबारा लोड करने को कहता है। पुनर्स्थापना पुराने लेबल या मेटाडेटा वापस नहीं लाती: वे जैसे अब हैं वैसे ही रहते हैं।

## लेबल, मेटाडेटा और संग्रह {#labels}

हर आर्टिफ़ैक्ट तीन प्रकार की टिप्पणियाँ रखता है। आप उन्हें कभी भी बदल सकते हैं। फ़ाइल स्वयं कभी नहीं बदलती।

| प्रकार   | उदाहरण                                         | नियम                                                                                                                                                  |
| -------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| लेबल     | `test`, `staging`, `release`, `linux`          | अधिकतम 32. प्रत्येक 1 से 64 अक्षर, अंक, `_`, `.`, `:` या `-`। केस मायने रखता है                                                                       |
| मेटाडेटा | `build.number` = `42`, `git.commit` = `abc123` | अधिकतम 32 टेक्स्ट फ़ील्ड। कुंजी किसी अक्षर से शुरू होती है और उसमें अधिकतम 64 अक्षर, अंक, `_`, `.` या `-` होते हैं। मान अधिकतम 1024 वर्णों का होता है |
| संग्रह   | `desktop`, `nightly`                           | अधिकतम 32. लेबल के समान नियम। वे आर्टिफ़ैक्ट को समूहित करते हैं, चाहे उनका संस्करण या पथ कुछ भी हो                                                    |

लेबल मुक्त पाठ हैं। वे कोई एक्सेस नहीं देते और कोई फ़ाइल नहीं हिलाते। कंसोल [[ui:labelPresets]] (`nightly`, `test`, `staging`, `release`) सुझाता है, लेकिन कोई भी लेबल मान्य है, और `relase` ठीक नहीं किया जाता। जिस अनुमोदन पर डिप्लॉयमेंट निर्भर करते हैं, उसके लिए स्टेज इस्तेमाल करें ([स्टेज और प्रमोशन](./promotion))।

**कंसोल।** आर्टिफ़ैक्ट को [[ui:metadata]] में खोलें। [[ui:labels]] और [[ui:collections]] को कॉमा से अलग करके दर्ज करें। [[ui:metadataFields]] में किसी फ़ील्ड के लिए [[ui:metadataAdd]] इस्तेमाल करें: एक [[ui:metadataKey]] और एक [[ui:metadataValue]]। [[ui:metadataJson]] उसी डेटा को JSON के रूप में संपादित करता है। [[ui:save]] चुनें।

**arkvoryctl।** अपलोड के समय, `--label test` एक लेबल जोड़ता है, और `--file metadata.json` `labels` और `metadata` देता है:

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

किसी मौजूदा आर्टिफ़ैक्ट को बदलने के लिए, उसे पढ़ें, फिर जो संशोधन आपने पढ़ा उसके साथ पूरी नई स्थिति भेजें:

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

`annotations.json` में तीनों कुंजियाँ होनी चाहिए: `labels`, `metadata` और `collections`। जो कुछ आप छोड़ देते हैं वह खाली हो जाता है। एक सेव पूरा सेट बदल देता है। अगर किसी ने पहले सेव कर दिया, तो सर्वर `409 revision_mismatch` लौटाता है: दोबारा पढ़ें और निर्णय लें। SDK ऐसे सेव दोहराता नहीं।

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

पढ़ने के लिए `annotation.read` और लिखने के लिए `artifact.read` के साथ `annotation.write` चाहिए।

**खोज।** [[ui:catalog]] में, [[ui:search]] में टेक्स्ट टाइप करें: यह फ़ाइल नाम और मेटाडेटा मानों से मेल खाता है, केस की उपेक्षा करते हुए। [[ui:labelFilter]] एक लेबल दिखाता है। [[ui:metadataFilter]] किसी कुंजी और मान से ठीक-ठीक मेल खाता है, केस सहित। `arkvoryctl` के साथ:

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

`--metadata-key` और `--metadata-value` साथ-साथ आते हैं। पेज अधिकतम 100 परिणाम रखते हैं। `next` को `--after` के रूप में दें। फ़िल्टर AND से जुड़ते हैं।

## अटैचमेंट {#attachments}

अटैचमेंट अन्य फ़ाइलों को किसी बिल्ड से जोड़ते हैं: एक मैनिफ़ेस्ट, एक SBOM, एक हस्ताक्षर, एक रिपोर्ट या कोई भी फ़ाइल। अटैचमेंट एक नाम और उसी रिपॉज़िटरी के किसी अन्य आर्टिफ़ैक्ट का लिंक होता है। बिल्ड और अटैचमेंट अलग-अलग फ़ाइलें रहते हैं।

| नियम        | मान                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| प्रकार      | `manifest`, `sbom`, `signature`, `report`, `file`                                                             |
| प्रति बिल्ड | अधिकतम 32                                                                                                     |
| नाम         | 1 से 240 वर्ण, बिल्ड के भीतर अद्वितीय (केस की उपेक्षा), कोई `/`, `\`, कंट्रोल कैरेक्टर या सिरों पर स्पेस नहीं |
| विवरण       | अधिकतम 512 वर्ण, खाली हो सकता है                                                                              |
| लक्ष्य      | उसी रिपॉज़िटरी का प्रकाशित आर्टिफ़ैक्ट। बिल्ड स्वयं नहीं                                                      |

प्रकार केवल बताता है कि फ़ाइल किस लिए है। Arkvory हस्ताक्षर की जाँच नहीं करता, SBOM नहीं पढ़ता और मैनिफ़ेस्ट नहीं चलाता।

कंसोल में, आर्टिफ़ैक्ट खोलें। [[ui:attachmentsTitle]] के अंतर्गत फ़ॉर्म [[ui:attachmentAdd]] का विस्तार करें। [[ui:attachmentSource]] चुनें: [[ui:attachmentUpload]] नई फ़ाइल भेजता है और उसे लिंक करता है, [[ui:attachmentExisting]] पहले से प्रकाशित आर्टिफ़ैक्ट को लिंक करता है। [[ui:attachmentKind]] चुनें: [[ui:attachmentManifest]], [[ui:attachmentSbom]], [[ui:attachmentSignature]], [[ui:attachmentReport]] या [[ui:attachmentFile]]। इसे एक [[ui:attachmentName]] दें और, अगर चाहें तो, एक [[ui:attachmentDescription]]। फिर [[ui:attachmentAdd]] चुनें। [[ui:attachmentUnlink]] एक लिंक हटाता है और फ़ाइल रखता है। [[ui:attachmentReload]] सूची दोबारा पढ़ता है। अगर किसी अटैचमेंट का अपलोड टूट जाए, तो [[ui:attachmentRecovery]] आगे बढ़ाने के लिए अपलोड ID दिखाता है।

सूची का हर बदलाव एक क्रमांकित संस्करण होता है। [[ui:attachmentHistory]] पिछले वाले दिखाता है, और [[ui:attachmentRestore]] उनमें से एक को नए संस्करण के रूप में लौटाता है।

`arkvoryctl` के साथ फ़ाइल पूरी सूची को JSON ऐरे के रूप में रखती है:

```json
[
  {
    "name": "build.json",
    "kind": "manifest",
    "artifactId": "64b42380-902d-41cf-9151-10c12e4809dc",
    "description": "Build provenance from CI"
  }
]
```

```bash
arkvoryctl attachments get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl attachments set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 0 --file attachments.json
arkvoryctl attachments history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`--revision` वह संख्या है जो आपने `get` से पढ़ी; नए बिल्ड में `0` होता है। API के साथ, `replaceBuildAttachments` `expectedRevision` और `items` लेता है; `getBuildAttachments` और `getBuildAttachmentHistory` पढ़ते हैं। किसी अटैचमेंट को डाउनलोड करने के लिए, उसके लिंक के `artifactId` के साथ सामान्य डाउनलोड इस्तेमाल करें। पढ़ने के लिए `annotation.read`, बदलने के लिए `artifact.read` के साथ `annotation.write`, और अटैचमेंट फ़ाइल के अपलोड के लिए अपलोड कार्रवाइयाँ चाहिए।

अटैचमेंट और पथ किसी अन्य रिपॉज़िटरी में प्रमोशन के साथ नहीं जाते। [स्टेज और प्रमोशन](./promotion) देखें।

## संबंधित पेज {#related-pages}

- [रॉ फ़ाइलें](../protocols/raw-files)
- [अपलोड और डाउनलोड](./transfers) और [UPack पैकेज](./packages)
- [कमांड लाइन (arkvoryctl)](../protocols/cli)
- API संदर्भ: [पथ वाली फ़ाइलें](../api/reference/files), [आर्टिफ़ैक्ट और कैटलॉग](../api/reference/artifacts), [बिल्ड अटैचमेंट](../api/reference/attachments)
