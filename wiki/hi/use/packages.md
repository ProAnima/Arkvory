---
title: 'UPack पैकेज'
description: 'संस्करणित UPack पैकेज प्रकाशित करें, उनकी सूची बनाएँ और फ़िल्टर करें, और किसी संस्करण को सटीक नंबर, श्रेणी, नवीनतम या स्टेज से डाउनलोड करें।'
---

# UPack पैकेज

UPack पैकेज एक ZIP आर्काइव है जिसका एक नाम और SemVer संस्करण होता है। Arkvory हर संस्करण को एक बार पंजीकृत करता है और उसे कभी नहीं बदलता। एक डिप्लॉयमेंट जॉब "app, संस्करण `^1.4`, स्टेज `release`" माँगता है और ठीक एक फ़ाइल पाता है।

## पैकेज क्या है {#what-it-is}

एक UPack एक ZIP फ़ाइल है जिसकी रूट में `upack.json` फ़ाइल होती है। मैनिफ़ेस्ट पैकेज का नाम बताता है:

```json
{
  "group": "acme/game",
  "name": "game-client",
  "version": "1.4.2"
}
```

| फ़ील्ड    | नियम                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `name`    | आवश्यक। 1 से 128 अक्षर, अंक, `.`, `_` या `-`                                                            |
| `version` | आवश्यक। SemVer: `1.4.2`, `1.5.0-rc.1`, `2.0.0+build.7`. अधिकतम 128 वर्ण                                 |
| `group`   | वैकल्पिक। अक्षर, अंक, `.`, `_` या `-` के खंड, `/` से अलग किए हुए। अधिकतम 128 वर्ण। डिफ़ॉल्ट रूप से खाली |

अन्य फ़ील्ड वैसे ही रहते हैं जैसे आपने लिखे और पैकेज सूची में वापस आते हैं। मैनिफ़ेस्ट अधिकतम 64 KiB का होता है। आर्काइव में एब्सोल्यूट पथ, `..`, सिम्बॉलिक लिंक, एन्क्रिप्टेड प्रविष्टियाँ या डुप्लिकेट नाम नहीं होने चाहिए, और उसमें अधिकतम 100 000 प्रविष्टियाँ होती हैं। Arkvory आर्काइव को बाइट-दर-बाइट संग्रहीत करता है और उसे अनपैक नहीं करता।

किसी पैकेज की पहचान उसका समूह, नाम और संस्करण होती है, जिसकी तुलना अक्षर केस की परवाह किए बिना होती है। एक रिपॉज़िटरी के भीतर एक पहचान हमेशा के लिए एक ही आर्काइव की होती है। किसी मौजूदा पहचान के अंतर्गत भिन्न आर्काइव पंजीकृत करना `409 version_exists` के साथ अस्वीकार कर दिया जाता है। वही आर्काइव दोबारा पंजीकृत करना सुरक्षित है और कुछ नहीं बदलता। किसी फ़िक्स को नए संस्करण के रूप में प्रकाशित करें।

## पैकेज प्रकाशित करें {#publish}

प्रकाशन एक अपलोड के बाद पंजीकरण है। पंजीकरण `upack.json` पढ़ता है और पहचान दर्ज करता है। आपको अपलोड कार्रवाइयों के अलावा `package.publish` और `artifact.read` कार्रवाइयाँ चाहिए। [अनुमतियाँ](./accounts#permissions) देखें।

### कंसोल में {#publish-console}

1. [[ui:upload]] में आर्काइव अपलोड करें। [अपलोड और डाउनलोड](./transfers) देखें।
2. आर्टिफ़ैक्ट को [[ui:catalog]] में [[ui:open]] से खोलें।
3. [[ui:metadata]] में [[ui:register]] चुनें। कंसोल वह नाम और संस्करण दिखाता है जिसे उसने पंजीकृत किया।

पैकेज अब [[ui:packages]] में दिखता है।

### arkvoryctl के साथ {#publish-cli}

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl packages register 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`packages publish` आर्काइव को जारी रखने के साथ अपलोड करता है और उसे पंजीकृत करता है। अगर अपलोड के बाद पंजीकरण विफल हो जाए, तो त्रुटि में `artifactId` और `register` स्टेज होते हैं। वही कमांड दोबारा चलाएँ: अपलोड दोहराया नहीं जाता, और दोबारा पंजीकृत करना सुरक्षित है। `packages register ID` उस आर्टिफ़ैक्ट को पंजीकृत करता है जो पहले से अपलोड है। [कमांड लाइन](../protocols/cli#packages-and-promotion) देखें।

### HTTP API और SDK के साथ {#publish-api}

आर्काइव को [अपलोड और डाउनलोड](./transfers#upload-http) के अनुसार अपलोड करें, फिर उसे पंजीकृत करें:

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/package" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
const entry = await releases.packages.register(uploaded.id);
console.log(entry.group, entry.name, entry.version);
```

ऑपरेशन `registerPackage` है। टूटा हुआ आर्काइव, गुम `upack.json` या गलत संस्करण `400 invalid_input` देता है।

## सूची और फ़िल्टर {#list}

कंसोल में [[ui:packages]] खोलें। एक [[ui:packageGroup]] या [[ui:packageName]] टाइप करें: दोनों ठीक-ठीक मेल खाते हैं, अक्षर केस की उपेक्षा करते हुए। [[ui:sortBy]] में एक कॉलम चुनें, [[ui:direction]] में एक क्रम ([[ui:ascending]] या [[ui:descending]]) और [[ui:groupBy]] में एक समूहन ([[ui:packageGroup]], [[ui:packageName]] या [[ui:noGrouping]]), फिर [[ui:apply]] चुनें। [[ui:clearFilters]] फ़ॉर्म रीसेट करता है। तालिका प्रत्येक संस्करण का समूह, नाम, संस्करण और स्टेज दिखाती है। [[ui:open]] आर्टिफ़ैक्ट दिखाता है। [[ui:previousPage]] और [[ui:nextPage]] पेजों के बीच ले जाते हैं।

```bash
arkvoryctl packages list --group acme/game --name game-client
arkvoryctl packages list --after <next from the previous answer>
```

API के साथ, `listPackages` `group`, `name`, `sort` (`group`, `name` या `version`), `direction` (`asc` या `desc`), `groupBy` (`none`, `group` या `package`), `after` और `limit` (1 से 100, डिफ़ॉल्ट रूप से 50) लेता है। उत्तर में `items` (group, name, version, `artifactId` और पूरा मैनिफ़ेस्ट), `groups` और `next` होते हैं। एक कर्सर उन्हीं फ़िल्टरों का होता है जिनसे वह आया। इसे केवल उन्हीं फ़िल्टरों के साथ इस्तेमाल करें।

```typescript
const page = await releases.packages.list({
  name: 'game-client',
  sort: 'version',
  direction: 'desc',
});
```

सूची बनाने के लिए `package.read` चाहिए। लेबल या मेटाडेटा से खोजने के लिए, [पथ वाली फ़ाइलें](./files#labels) देखें।

## संस्करण और श्रेणियाँ {#versions}

Arkvory संस्करणों की तुलना SemVer प्राथमिकता से करता है। `1.10.0`, `1.9.0` से नया है। प्रीरिलीज़ भाग वाला संस्करण, जैसे `1.5.0-rc.1`, `1.5.0` से पुराना है।

एक चयन एक पैकेज `name` और, वैकल्पिक रूप से, ये फ़िल्टर लेता है:

| फ़िल्टर      | अर्थ                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| `group`      | समूह। डिफ़ॉल्ट रूप से खाली: जिस पैकेज का समूह है वह केवल तब मिलता है जब आप उसे दें |
| सटीक संस्करण | एक संस्करण। केस की उपेक्षा होती है                                                 |
| श्रेणी       | एक SemVer श्रेणी                                                                   |
| `stage`      | केवल वे संस्करण जो यह स्टेज रखते हैं ([स्टेज और प्रमोशन](./promotion) देखें)       |
| प्रीरिलीज़   | प्रीरिलीज़ शामिल करें। डिफ़ॉल्ट रूप से बंद                                         |
| क्रम         | `version` (डिफ़ॉल्ट) या `promoted`                                                 |

श्रेणियाँ `1.2.3`, `^1.2`, `~1.2.3`, `1.x`, `>=1.0.0 <2.0.0`, `1.0.0 - 1.4.0` और `^1 || ^3` के रूप में लिखी जा सकती हैं। एक श्रेणी अधिकतम 256 वर्णों की होती है। सटीक संस्करण और श्रेणी को एक साथ नहीं जोड़ा जा सकता।

सटीक संस्करण या श्रेणी के बिना, चयन सबसे ऊँचा स्थिर संस्करण लौटाता है, यानी नवीनतम। प्रीरिलीज़ केवल प्रीरिलीज़ फ़िल्टर चालू होने पर, या जब सटीक संस्करण या श्रेणी स्वयं उसी `major.minor.patch` का प्रीरिलीज़ नाम लेती है, चुने जाते हैं। `order promoted` वह संस्करण चुनता है जिसे सबसे बाद में स्टेज किया गया, न कि सबसे ऊँचा, और उसे स्टेज चाहिए। अगर कुछ भी मेल न खाए, तो सर्वर `404 not_found` लौटाता है।

## पैकेज डाउनलोड करें {#download}

अगर आप देखना चाहते हैं कि आपको क्या मिलेगा तो पहले निर्धारित करें, या सीधे डाउनलोड करें।

```bash
arkvoryctl packages resolve game-client --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --exact 1.4.2 --group acme/game
arkvoryctl packages download game-client ./game-client.upack --group acme/game
```

विकल्प हैं `--group`, `--exact`, `--range`, `--stage`, `--prerelease` और `--order promoted`। सटीक संस्करण के लिए `--exact` इस्तेमाल करें, क्योंकि `--version` क्लाइंट का संस्करण छापता है। `resolve` समूह, नाम, संस्करण, `artifactId`, `sha256`, `size`, `publishedAt`, `stagedAt` और स्टेज प्रिंट करता है। `download` निर्धारित करता है, फिर उस आर्टिफ़ैक्ट को जारी रखने और SHA-256 जाँच के साथ डाउनलोड करता है, जैसा [अपलोड और डाउनलोड](./transfers#download-cli) में है। क्लाइंट को `package.read`, `artifact.read` और `content.read` चाहिए।

HTTP के साथ दो ऑपरेशन हैं। `resolvePackage` को `package.read` चाहिए और वह `resolve` जैसे ही तथ्य लौटाता है। `downloadPackageContent` चुने गए संस्करण की बाइट भेजता है और उसे केवल `content.read` चाहिए। यह हेडर `X-Arkvory-Artifact-Id` और `X-Arkvory-Package-Version` जोड़ता है।

```bash
curl -fL -G -H "Authorization: Bearer $ARKVORY_KEY" -o game-client.upack \
  --data-urlencode "name=game-client" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

नाम-आधारित पता हर अनुरोध पर निर्धारित होता है। अगर आप किसी श्रेणी के साथ डाउनलोड जारी रखते हैं, तो दोनों कॉलों के बीच फ़ाइल बदल सकती है। इसके बजाय `resolve` से `artifactId` डाउनलोड करें, या `If-Range` में `ETag` भेजें।

```typescript
const found = await prod.packages.resolve({
  name: 'game-client',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
const stream = await prod.artifacts.downloadVerified(found.artifactId);
```

जिस डिप्लॉयमेंट एजेंट को केवल बिल्ड लाने हैं, उसे HTTP पते के लिए अकेले `content.read` वाली सेवा कुंजी मिलती है, या `arkvoryctl` के लिए रीड प्रीसेट। [CI के लिए सेवा खाते और कुंजियाँ](./accounts#service-accounts) देखें।

## लेबल, मेटाडेटा और अटैचमेंट {#labels}

पैकेज संस्करण एक साधारण आर्टिफ़ैक्ट है, इसलिए [पथ वाली फ़ाइलें](./files#labels) पर जो कुछ है वह उस पर लागू होता है: `test`, `staging` और `release` जैसे लेबल, `git.commit` जैसा टेक्स्ट मेटाडेटा, संग्रह, और SBOM या हस्ताक्षर जैसे अटैचमेंट। अपलोड के समय `--label test` से पहले लेबल सेट करें। लेबल आर्काइव के बारे में कुछ नहीं बदलते। वे मुक्त पाठ हैं, कोई नियंत्रित स्थिति नहीं। जिस अनुमोदन पर कोई डिप्लॉयमेंट निर्भर कर सकता है, उसके लिए स्टेज इस्तेमाल करें। [स्टेज और प्रमोशन](./promotion) देखें।

## पुराने संस्करण रखना {#retention}

पंजीकृत पैकेज वही हैं जिन्हें रिपॉज़िटरी की प्रतिधारण नीति गिनती है। डिफ़ॉल्ट रूप से, चालू होने पर, यह प्रत्येक पैकेज और चैनल के अंतिम 10 बिल्ड रखती है। चैनल का मतलब लेबल `test`, `staging` या `release` है। स्टेज, संरक्षित लेबल, फ़ाइल पथ या अटैचमेंट लिंक वाला संस्करण प्रतिधारण द्वारा कभी नहीं हटाया जाता। प्रतिधारण तब तक बंद रहता है जब तक व्यवस्थापक उसे चालू न करे और विलोपन से सहमत न हो। [स्टोरेज और प्रतिधारण](../operate/storage) देखें।

## त्रुटियाँ {#errors}

| उत्तर                          | अर्थ                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| पंजीकरण पर `400 invalid_input` | मान्य UPack ZIP नहीं, रूट में `upack.json` नहीं, या गलत नाम या संस्करण                                                                                         |
| `409 version_exists`           | पहचान पहले से किसी अन्य आर्काइव की है। नया संस्करण प्रकाशित करें। जिस रिपॉज़िटरी में वह संस्करण भिन्न बाइट के साथ है, वहाँ प्रमोट करना भी इसी तरह विफल होता है |
| resolve पर `404 not_found`     | फ़िल्टरों से कुछ भी मेल नहीं खाता। समूह, श्रेणी और स्टेज जाँचें                                                                                                |
| `403 permission_missing`       | कुंजी में `package.read`, `package.publish` या `content.read` नहीं है                                                                                          |

## संबंधित पेज {#related-pages}

- [अपलोड और डाउनलोड](./transfers)
- [स्टेज और प्रमोशन](./promotion)
- [कमांड लाइन (arkvoryctl)](../protocols/cli)
- API संदर्भ: [पैकेज](../api/reference/packages), [स्टेज और प्रमोशन](../api/reference/promotion)
