---
title: TypeScript SDK
---

# TypeScript SDK

TypeScript SDK वह क्लाइंट लाइब्रेरी है जिसे कंसोल और `arkvoryctl` इस्तेमाल करते हैं। यह REST API `/api/v1` को रैप करती है। यह रनटाइम पर हर उत्तर को सत्यापित करती है, भागों में अपलोड करती है, रुके हुए ट्रांसफ़र जारी रखती है और डाउनलोड को SHA-256 से सत्यापित करती है। यह केवल मानक वेब API (`fetch`, स्ट्रीम, Web Crypto) इस्तेमाल करती है, इसलिए Node.js और ब्राउज़र दोनों में चलती है।

## SDK प्राप्त करें {#get-the-sdk}

SDK, `ProAnima/Arkvory` सोर्स रिपॉज़िटरी के `packages/sdk` फ़ोल्डर में मौजूद वर्कस्पेस पैकेज `@proanima/arkvory-sdk` है। यह npm रजिस्ट्री पर **प्रकाशित नहीं** है। यह वर्कस्पेस पैकेज `@proanima/arkvory-contracts` पर निर्भर है।

- इसे इस्तेमाल करने के लिए सोर्स रिपॉज़िटरी बिल्ड करें (`npm ci`, फिर `npm run build`) और अपना टूल उसी वर्कस्पेस के भीतर लिखें, जैसे रिपॉज़िटरी की अपनी स्क्रिप्ट करती हैं।
- किसी दूसरी भाषा से, या ऐसे प्रोजेक्ट से जो वर्कस्पेस इस्तेमाल नहीं कर सकता, `Authorization: Bearer <key>` के साथ [REST API](../api/index) को सीधे कॉल करें।

सोर्स कोड Arkvory लाइसेंस के तहत उपलब्ध है। आप इसे अपने संगठन के भीतर इस्तेमाल और संशोधित कर सकते हैं। आप इसकी प्रतियाँ वितरित नहीं कर सकते।

## क्लाइंट बनाएँ {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **बेस URL।** HTTPS ज़रूरी है। सादा HTTP केवल `localhost`, `127.0.0.1` और `[::1]` के लिए मान्य है। URL में उपयोगकर्ता, पासवर्ड, क्वेरी या फ़्रैगमेंट नहीं होना चाहिए। उसमें पथ का उपसर्ग हो सकता है। रीडायरेक्ट को त्रुटि माना जाता है।
- **टोकन कॉलबैक।** SDK इसे हर अनुरोध के लिए कॉल करता है और परिणाम को कभी कैश नहीं करता। आप नया क्लाइंट बनाए बिना कुंजियाँ रोटेट कर सकते हैं।
- **`inRepository(id)`** किसी एक रिपॉज़िटरी से बँधा क्लाइंट लौटाता है। यह सुविधा है, सुरक्षा की सीमा नहीं।

| विकल्प             | डिफ़ॉल्ट | अर्थ                                                                                                              |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `signal`           | कोई नहीं | इस क्लाइंट के हर अनुरोध को रद्द करता है                                                                           |
| `requestTimeoutMs` | कोई नहीं | उस अनुरोध की समय-सीमा जिसका अपना सिग्नल नहीं है (1 से 3600000)                                                    |
| `maxAttempts`      | 5        | एक ट्रांसफ़र अनुरोध के प्रयास, पहले प्रयास सहित (1 से 10)                                                         |
| `maxRetries`       | 20       | एक अपलोड या डाउनलोड ऑपरेशन के साझा रीट्राई (0 से 100)                                                             |
| `attemptTimeoutMs` | 120000   | एक ट्रांसफ़र प्रयास की सीमा (1 से 1800000)                                                                        |
| `baseDelayMs`      | 500      | बैकऑफ़ की पहली देरी (1 से 60000)                                                                                  |
| `maxDelayMs`       | 60000    | सबसे लंबी देरी, `Retry-After` सहित                                                                                |
| `onRequest`        | कोई नहीं | हर HTTP अनुरोध पर एक बार कॉल होता है; मेथड, पथ, स्टेटस, अवधि और अनुरोध ID के साथ। इसे क्रेडेंशियल कभी नहीं मिलते। |

स्वचालित रीट्राई केवल ट्रांसफ़र पर लागू होते हैं: `create`, `resume` के भीतर के चरण और `downloadVerified`। वे नेटवर्क विफलताओं और HTTP 408, 429, 502, 503 और 504 को एक्सपोनेंशियल बैकऑफ़ के साथ दोबारा आज़माते हैं, और `Retry-After` से पहले कभी नहीं। बाकी कॉल एक ही बार चलते हैं। संशोधन से सुरक्षित बदलाव अपने-आप कभी दोहराए नहीं जाते।

## आम काम {#common-tasks}

### खोजें और सूची बनाएँ {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

पेज `next` लौटाते हैं। अगला पेज पढ़ने के लिए उसे `after` के रूप में दें।

### बड़ी फ़ाइल को जारी रखने की क्षमता के साथ अपलोड करें (Node.js) {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // मेमोरी में नहीं पढ़ी जाती
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // पहले अनुरोध से पहले इसे जॉब की स्थिति के साथ सहेजें
const session = await releases.uploads.create(key, {
  name: 'Game.zip',
  size: String(file.size),
  sha256: hash.digest('hex'),
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const uploaded = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(`${bytes} of ${file.size} bytes`),
});
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0: पथ नया है
```

- वही आइडेम्पोटेंसी कुंजी और वही डिस्क्रिप्टर वही सत्र लौटाते हैं, इसलिए खोया हुआ उत्तर दूसरा अपलोड नहीं बनाता।
- `resume` वे भाग पढ़ता है जो सर्वर के पास पहले से हैं, उनके हैश आपकी फ़ाइल से मिलाता है और केवल छूटे हुए भाग भेजता है। क्रैश के बाद सहेजी हुई सत्र ID के साथ `resume` फिर से कॉल करें।
- भाग का आकार सर्वर तय करता है: 8 MiB, और उससे बड़ा केवल उन फ़ाइलों के लिए जिन्हें 10,000 से ज़्यादा भाग चाहिए। SDK एक समय में एक भाग मेमोरी में रखता है।
- 16 GiB और उससे बड़ी फ़ाइलें सर्वर का वर्कर पूरी करता है। `resume` उसकी प्रतीक्षा करता है।
- `assets.assign(path, artifactId, expectedRevision)` तब टकराव के साथ विफल होता है जब पथ का कोई दूसरा संशोधन हो। पहले `assets.get(path)` से पथ पढ़ें।

### सत्यापन के साथ डाउनलोड करें {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // केवल pipeTo सफल होने के बाद
```

SDK सामग्री को 8 MiB की रेंज में पढ़ता है और हर रेंज का आकार, `Content-Range` और `ETag` जाँचता है। आख़िरी ब्लॉक देने से पहले वह पूरी फ़ाइल का SHA-256 जाँचता है। जाँच विफल हो तो स्ट्रीम `ArkvoryIntegrityError` के साथ विफल होती है। स्ट्रीम से सीधे कभी डिप्लॉय न करें: अस्थायी फ़ाइल में लिखें और स्ट्रीम के सफलतापूर्वक समाप्त होने के बाद ही उसका इस्तेमाल करें।

रीस्टार्ट के बाद जारी रखने के लिए जो बाइट आप पहले सहेज चुके हैं, उन्हें `prefix` के रूप में दें। तब स्ट्रीम में केवल बाकी हिस्सा होता है:

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

सत्यापन के बिना एक बाइट रेंज के लिए `releases.artifacts.download(id, { start: 0, end: 1023 })` कच्चा `Response` लौटाता है (स्टेटस 206)।

### पथ से रॉ फ़ाइलें {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // वैकल्पिक: पथ मौजूद हो तो अस्वीकार करें
});
console.log(result.revision, result.created); // बाइट पहले से मौजूद हों तो created false होता है
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

विकल्प `sha256` (64 हेक्साडेसिमल अंक) सर्वर को बाइट एक ही पास में लिखने और बेमेल होने पर अस्वीकार करने देता है। `releases.assets.put(path, blob, options)` और `releases.assets.download(path, range)` वही कॉल हैं। हर अपलोड एक अनुरोध है, इसलिए इन्हें छोटी और मध्यम फ़ाइलों के लिए इस्तेमाल करें। [रॉ फ़ाइलें](./raw-files) देखें।

### पैकेज, प्रमोशन और लिंक {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // UPack आर्काइव
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

लिंक URL एक सीक्रेट है जो `expiresAt` तक एक आर्टिफ़ैक्ट को पढ़ने देता है। इसे समय से पहले निरस्त नहीं किया जा सकता।

### बैकअप {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // बैकअप एजेंट के लिए कतार में
const points = await client.backup.points({ limit: 20 });
```

बैकअप कॉल के लिए खाता व्यवस्थापक का सत्र या स्वामी की फ़ाइल कुंजी चाहिए। सेवा कुंजियों और व्यक्तिगत टोकन को 403 मिलता है।

## त्रुटियाँ {#errors}

```typescript
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

try {
  await releases.artifacts.get(id);
} catch (error) {
  if (error instanceof ArkvoryHttpError) {
    console.error(error.status, error.code, error.reason, error.requestId, error.retryAfterSeconds);
  } else if (error instanceof ArkvoryClientError) {
    console.error(error.code);
  }
}
```

| क्लास                   | अर्थ                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ArkvoryHttpError`      | सर्वर ने त्रुटि के साथ उत्तर दिया। फ़ील्ड: `status`, `code`, `reason`, `details`, `requestId`, `retryAfterMs`, `retryAfterSeconds`, `serverMessage`। जब कोई प्रॉक्सी Arkvory के फ़ॉर्मेट के बिना उत्तर दे, तब `code` `http_error` होता है। |
| `ArkvoryNetworkError`   | सभी रीट्राई के बाद कनेक्शन विफल रहा या टाइमआउट हो गया                                                                                                                                                                                      |
| `ArkvoryIntegrityError` | डाउनलोड किए गए बाइट आर्टिफ़ैक्ट से मेल नहीं खाते                                                                                                                                                                                           |
| `ArkvoryClientError`    | `code` के साथ स्थानीय विफलता: `invalid_argument`, `insecure_url`, `invalid_response`, `response_too_large`, `size_mismatch`, `file_changed`, `upload_cancelled`, `completion_failed`                                                       |

निर्णय `code` और `reason` से लें, संदेश के पाठ से नहीं। अज्ञात कोड को HTTP स्टेटस से सँभालें। `Error.message` में सर्वर का पाठ कभी नहीं होता। [त्रुटियाँ](../api/errors) देखें।

## ब्राउज़र और Node.js {#browser-and-node-js}

- **किसी दूसरे ऑरिजिन पर ब्राउज़र।** व्यवस्थापक को सर्वर पर `ARKVORY_CORS_ORIGINS` में आपके पेज का सटीक ऑरिजिन सूचीबद्ध करना होगा। SDK कुंजी को `Authorization` हेडर में भेजता है और कुकी कभी नहीं भेजता।
- **ब्राउज़र में कुंजियाँ।** कुंजी केवल मेमोरी में रखें। उसे URL, `localStorage`, लॉग या पेज के सोर्स में न रखें। सत्र टोकन पाने के लिए उपयोगकर्ता `client.login(name, password)` से साइन इन कर सकता है।
- **Node.js में फ़ाइलें।** फ़ाइल को मेमोरी में पढ़े बिना देने के लिए `node:fs` का `openAsBlob` इस्तेमाल करें।
- **डाउनलोड कतार।** `DownloadQueue` और `checkpointedDownload` रोकने, जारी रखने और रद्द करने की सुविधा वाली सीमित कतार देते हैं। स्टोरेज एडैप्टर आप देते हैं।

## सीमाएँ {#limits}

- JSON उत्तर 2 MiB तक सीमित हैं (पैकेज पेज 8 MiB, आर्टिफ़ैक्ट सूचियाँ 24 MiB)। बड़े उत्तर `response_too_large` के साथ विफल होते हैं।
- आकार दशमलव स्ट्रिंग होते हैं, इसलिए 2^53 से ऊपर के मान भी पूरी परिशुद्धता में रहते हैं।

## संबंधित पेज {#related-pages}

- [कमांड लाइन (arkvoryctl)](./cli)
- [ट्रांसफ़र](../use/transfers)
- [API का अवलोकन](../api/index) और [प्रमाणीकरण](../api/authentication)
- [रॉ फ़ाइलें](./raw-files)
