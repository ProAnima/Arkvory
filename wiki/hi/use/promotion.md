---
title: 'स्टेज और प्रमोशन'
description: 'बिल्ड को स्टेज से चिह्नित करें, उन्हें किसी अन्य रिपॉज़िटरी में प्रमोट करें, और किसी डिप्लॉयमेंट एजेंट को स्टेज का सबसे नया बिल्ड चुनने दें।'
---

# स्टेज और प्रमोशन

एक बिल्ड CI से प्रोडक्शन तक चरणों में जाता है: परीक्षित, अनुमोदित, रिलीज़। Arkvory के पास इसके लिए दो टूल हैं। एक **स्टेज** किसी बिल्ड पर एक चिह्न है, जैसे `qa` या `release`। **प्रमोशन** किसी बिल्ड को बाइट दोबारा भेजे बिना किसी अन्य रिपॉज़िटरी में प्रकाशित करता है। इनमें से कोई एक, या दोनों साथ इस्तेमाल करें।

## स्टेज और रिपॉज़िटरी {#concepts}

- एक **स्टेज** बताता है कि कोई बिल्ड कहाँ अनुमोदित है। एक बिल्ड में कई स्टेज हो सकते हैं, अधिकतम 16। स्टेज एक रिपॉज़िटरी में किसी बिल्ड से संबंधित होते हैं। उन्हें केवल स्टेज ऑपरेशन बदलते हैं, और हर बदलाव लेखक और वैकल्पिक टिप्पणी के साथ एक जर्नल में जाता है।
- एक **प्रमोशन** किसी बिल्ड को एक रिपॉज़िटरी से दूसरी में कॉपी या स्थानांतरित करता है, उदाहरण के लिए `dev` से `staging` से `prod`। कॉपी लक्ष्य में एक नया आर्टिफ़ैक्ट है। कोई बाइट अपलोड नहीं होती।
- एक **लेबल** केवल एक मुक्त टैग है, जिसका कोई इतिहास नहीं। स्टेज वह नियंत्रित चिह्न है जिस पर कोई डिप्लॉयमेंट निर्भर कर सकता है। [पथ वाली फ़ाइलें](./files#labels) देखें।

स्टेज नाम में 1 से 32 वर्ण होते हैं: लोअरकेस अक्षर, अंक, `.`, `_` या `-`, जो किसी अक्षर या अंक से शुरू होते हैं। स्टेज वाला बिल्ड हटाया नहीं जा सकता, और प्रतिधारण उसे रखती है। पहले स्टेज हटाएँ।

## स्टेज जोड़ें और हटाएँ {#stages}

कंसोल में, आर्टिफ़ैक्ट को [[ui:metadata]] में खोलें। अनुभाग [[ui:promotionTitle]] बिल्ड के स्टेज के साथ [[ui:stagesTitle]] दिखाता है। एक [[ui:stageName]] और, अगर चाहें तो, एक [[ui:stageComment]] दर्ज करें, फिर [[ui:stageAdd]] चुनें। प्रत्येक स्टेज में उसे हटाने का एक बटन होता है, और कंसोल पुष्टि माँगता है: जो डिप्लॉयमेंट इस स्टेज को माँगते हैं वे कोई दूसरा संस्करण चुनेंगे।

स्टेज कैटलॉग में भी दिखते हैं, प्रत्येक पंक्ति में चिप्स के रूप में, और [[ui:packages]] के कॉलम [[ui:packageStages]] में।

```bash
arkvoryctl stages add 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --comment "smoke passed" --repository dev
arkvoryctl stages list 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository dev
arkvoryctl stages remove 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --repository dev
arkvoryctl stages artifacts --stage release --repository prod
```

`stages artifacts` हर उस बिल्ड की सूची बनाता है जिसमें कोई स्टेज है, या एक स्टेज, एक बार में 100। `next` को `--after` के रूप में दें।

API के साथ:

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

ऑपरेशन हैं `setArtifactStage`, `removeArtifactStage`, `listArtifactStages` और `listStagedArtifacts`। जो स्टेज पहले से है उसे जोड़ने से कुछ नहीं बदलता: पहला समय और टिप्पणी बनी रहती है। जो स्टेज नहीं है उसे हटाना सफल होता है। 16 स्टेज वाला बिल्ड दूसरा स्टेज `409 stage_limit` के साथ अस्वीकार कर देता है।

## किसी अन्य रिपॉज़िटरी में प्रमोट करें {#promote}

कंसोल में, आर्टिफ़ैक्ट खोलें। फ़ॉर्म [[ui:promoteTitle]] तब दिखता है जब आप बिल्ड पढ़ सकते हैं और कम से कम एक अन्य रिपॉज़िटरी में प्रमोट कर सकते हैं। उन रिपॉज़िटरी में से [[ui:promoteTarget]] चुनें। लक्ष्य में सेट करने के लिए [[ui:promoteStages]] दर्ज करें, कॉमा से अलग करके, और एक [[ui:promoteComment]]। [[ui:promoteSubmit]] चुनें। अगर कोई अन्य रिपॉज़िटरी इसकी अनुमति नहीं देती, तो कंसोल [[ui:promoteNoTargets]] कहता है।

```bash
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --move
```

`--repository` स्रोत है, `--to` लक्ष्य। परिणाम में लक्ष्य `repository`, नया `artifactId`, `sourceArtifactId`, `mode`, `created` और `stages` होते हैं।

```bash
curl -X POST "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}'
```

```typescript
await staging.promotions.promote(id, { target: 'prod', mode: 'copy', stages: ['release'] });
```

नई कॉपी के लिए उत्तर `201` होता है और जब लक्ष्य में वह पहले से हो तब `200`। ऑपरेशन `promoteArtifact` है।

### कॉपी या स्थानांतरण {#copy-move}

|                | कॉपी (डिफ़ॉल्ट)   | स्थानांतरण                                                                                                   |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| स्रोत          | रहता है           | कॉपी के प्रकाशित होने के उसी चरण में हटा दिया जाता है                                                        |
| स्रोत के स्टेज | स्रोत पर रहते हैं | आपके दिए स्टेज के अलावा, कॉपी पर चले जाते हैं                                                                |
| कंसोल में      |                   | [[ui:promoteMove]] चुनें। कंसोल पुष्टि माँगता है                                                             |
| कब अवरुद्ध     |                   | स्रोत अभी भी किसी बाहरी संदर्भ, फ़ाइल पथ या अटैचमेंट लिंक द्वारा इस्तेमाल होता है। कुछ भी प्रकाशित नहीं होता |

कॉपी को क्या मिलता है और क्या नहीं:

- इसे स्रोत के लेबल, मेटाडेटा और संग्रह, उसकी UPack पहचान और आपके दिए स्टेज मिलते हैं। यह एक नया आर्टिफ़ैक्ट है, नए ID के साथ। इसका SHA-256 वही होता है।
- इसे कोई अटैचमेंट और कोई पथ पॉइंटर नहीं मिलता। उन्हें लक्ष्य में दोबारा लिंक करें।
- कोई बाइट अपलोड नहीं होती। उसी सर्वर पर संग्रहीत फ़ाइल तब तक साझा रहती है जब तक उसे इस्तेमाल करने वाला अंतिम आर्टिफ़ैक्ट चला न जाए।
- यह लक्ष्य के कोटा में एक नए अपलोड की तरह गिना जाता है।
- प्रमोशन दोहराने पर वही कॉपी लौटती है। अगर लक्ष्य में उसी समूह, नाम, संस्करण और चेकसम वाला पैकेज पहले से है, तो वही आर्टिफ़ैक्ट लौटाया जाता है। भिन्न बाइट के साथ सर्वर `409 version_exists` लौटाता है।
- लक्ष्य स्रोत से भिन्न होना चाहिए। मिरर लक्ष्य नहीं हो सकता, क्योंकि वह रीड-ओनली है। [रिपॉज़िटरी](./repositories#read-only) देखें।

बाधित प्रमोशन एक अल्पकालिक आरक्षण छोड़ जाता है। जारी रखने के लिए उसी खाते के रूप में वही प्रमोशन दोबारा चलाएँ।

## प्रमोशन इतिहास {#history}

कंसोल में आर्टिफ़ैक्ट पेज [[ui:promotionHistory]] दिखाता है, सबसे पुराना पहले: किसने स्टेज जोड़ा या हटाया, किसने बिल्ड को किसी अन्य रिपॉज़िटरी में कॉपी या स्थानांतरित किया, और प्राप्त कॉपी कहाँ से आई। [[ui:promotionMore]] अगली प्रविष्टियाँ लोड करता है।

```bash
arkvoryctl promotions history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository prod
arkvoryctl promotions journal --repository prod --after 120 --json
```

किसी रिपॉज़िटरी का जर्नल CI के लिए है। इसे उस अंतिम `sequence` के साथ पोल करें जो आपने `--after` के रूप में देखा, और आपको नई घटनाएँ क्रम में मिलती हैं। एक घटना में `sequence`, `action` (`stage.added`, `stage.removed`, `promoted` या `received`), `stage`, `mode`, पीयर रिपॉज़िटरी और आर्टिफ़ैक्ट, `actor`, `comment` और समय होते हैं। पेज अधिकतम 100 घटनाएँ रखते हैं। ऑपरेशन हैं `listArtifactPromotions` और `listRepositoryPromotions`।

## डिप्लॉयमेंट के लिए बिल्ड चुनें {#resolve}

एक डिप्लॉयमेंट एजेंट माँगता है "पैकेज `app` का सबसे नया बिल्ड जो `^1.4` श्रेणी में है और जिसका स्टेज `release` है"। Arkvory ठीक एक संस्करण लौटाता है, या कोई न हो तो `404`।

```bash
arkvoryctl packages resolve app --group acme/game --range ^1.4 --stage release --repository prod --json
arkvoryctl packages download app ./app.upack --group acme/game --range ^1.4 --stage release --repository prod
```

`resolve` चयन को डाउनलोड किए बिना प्रिंट करता है:

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

HTTP के साथ, `resolvePackage` यही लौटाता है, और `downloadPackageContent` उसी चयन की बाइट एक ही कॉल में भेजता है:

```bash
curl -fL -G -H "Authorization: Bearer $DEPLOY_KEY" -o app.upack \
  --data-urlencode "name=app" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

```typescript
const found = await prod.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
```

फ़िल्टर हर टूल में वही हैं: पैकेज `name`, `group` (अगर पैकेज का कोई न हो तो खाली), सटीक संस्करण या श्रेणी, `stage`, प्रीरिलीज़ शामिल करना है या नहीं, और क्रम। श्रेणियाँ [UPack पैकेज](./packages#versions) में समझाई गई हैं।

डिफ़ॉल्ट रूप से सबसे नया SemVer संस्करण जीतता है। `--order promoted` (HTTP में `order=promoted`) के साथ वह संस्करण जीतता है जिसे सबसे बाद में स्टेज किया गया, भले ही उसका नंबर कम हो। इसके लिए एक स्टेज चाहिए।

नाम हर अनुरोध पर निर्धारित होता है, इसलिए दो कॉल अलग-अलग बिल्ड लौटा सकती हैं जब बीच में कोई प्रमोट करे। जिस डाउनलोड को जारी रखना है, उसके लिए `resolve` से `artifactId` लें और उसे डाउनलोड करें।

## रोलबैक {#rollback}

`promoted` क्रम के साथ, रोलबैक एक साधारण चरण है। दोषपूर्ण संस्करण से स्टेज हटाएँ, और उससे पहले स्टेज किया गया संस्करण चयन बन जाता है। किसी पुराने संस्करण को दोबारा वर्तमान बनाने के लिए, उसका स्टेज हटाएँ और एक बार फिर जोड़ें: जो स्टेज पहले से है उसे जोड़ने से उसका समय नवीनीकृत नहीं होता।

```bash
arkvoryctl stages remove <faulty artifact id> release --repository prod
arkvoryctl packages download app ./app.upack --stage release --order promoted --repository prod
```

## अनुमतियाँ {#permissions}

| कार्रवाई                                  | कुंजियाँ: रिपॉज़िटरी कार्रवाइयाँ                                     | लोग: समूह एक्सेस                |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| किसी बिल्ड के स्टेज और इतिहास पढ़ना       | `artifact.read`                                                      | पढ़ना                           |
| स्टेज किए गए बिल्ड और जर्नल की सूची बनाना | `artifact.list`                                                      | पढ़ना                           |
| स्टेज जोड़ना या हटाना                     | `artifact.promote` के साथ `artifact.read`                            | लिखना                           |
| कॉपी के साथ प्रमोट करना                   | स्रोत: `artifact.read` और `content.read`. लक्ष्य: `artifact.promote` | स्रोत पर पढ़ना, लक्ष्य पर लिखना |
| स्थानांतरण के साथ प्रमोट करना             | वही, और स्रोत पर `artifact.promote`                                  | दोनों पर लिखना                  |
| संस्करण निर्धारित करना                    | `package.read`                                                       | पढ़ना                           |
| चुने गए संस्करण को नाम से डाउनलोड करना    | `content.read`                                                       | पढ़ना                           |

जिस डिप्लॉयमेंट एजेंट को केवल डाउनलोड करना है उसे जिस रिपॉज़िटरी से वह पढ़ता है उसमें `content.read` चाहिए। `arkvoryctl packages download` के लिए उसे `package.read` और `artifact.read` भी चाहिए। [अनुमतियाँ](./accounts#permissions) देखें।

सर्वर स्वयं भी बिल्ड का आदान-प्रदान कर सकते हैं: एक रिपॉज़िटरी किसी अन्य सर्वर की रिपॉज़िटरी से उन संस्करणों को आयात कर सकती है जो कुछ स्टेज रखते हैं। [मिरर](../operate/mirrors) देखें।

## संबंधित पेज {#related-pages}

- [UPack पैकेज](./packages) और [रिपॉज़िटरी](./repositories)
- [खाते और एक्सेस](./accounts)
- [कमांड लाइन (arkvoryctl)](../protocols/cli#packages-and-promotion)
- API संदर्भ: [स्टेज और प्रमोशन](../api/reference/promotion)
