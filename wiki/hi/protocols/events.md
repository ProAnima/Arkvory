---
title: 'इवेंट'
description: 'एक ही कर्सर से इंस्टॉलेशन के हर परिवर्तन पर नज़र रखें: CloudEvents, अनुमतियाँ, रखने की अवधि और पुनः सिंक्रनाइज़ेशन।'
---

# इवेंट

इवेंट फ़ीड किसी बाहरी सिस्टम को बताती है कि पूरे इंस्टॉलेशन में क्या बदला: प्रकाशन, हटाना, फ़ाइल पथ, पैकेज पंजीकरण, एनोटेशन, अटैचमेंट, स्टेज, प्रमोशन, कंटेनर इमेज, npm और Git LFS। यह उन सभी रिपॉज़िटरी के लिए एक क्रमबद्ध धारा है जिन्हें आप पढ़ सकते हैं, [CloudEvents 1.0](https://cloudevents.io) फ़ॉर्मैट में। इसे `arkvoryctl events tail`, [TypeScript SDK](./sdk) या `GET /api/v1/events` से पढ़ें।

इवेंट एक संकेत है कि कुछ बदला। वर्तमान स्थिति सामान्य API से पढ़ें, और इवेंट को ऐसे संभालें कि दोहराव से कोई नुकसान न हो।

## फ़ीड पढ़ें {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

कमांड हर पंक्ति में एक इवेंट JSON के रूप में छापती है और हर इवेंट के बाद स्थिति `--cursor-file` में सहेजती है। इसे फिर चलाएँ, यह वहीं से जारी रहती है जहाँ रुकी थी। `--follow` जोड़ने पर यह Ctrl+C तक नए इवेंट की प्रतीक्षा करती है। `--types artifact.*,stage.added` नामित टाइप या उपसर्ग रखता है, `--repository releases` एक रिपॉज़िटरी रखता है, और `--after <id>` दिए गए इवेंट के बाद से शुरू करता है।

TypeScript में `follow` पृष्ठ-दर-पृष्ठ पढ़ता है और आपके द्वारा संभाले गए हर इवेंट के बाद `save` बुलाता है:

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

HTTP से:

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

उत्तर में `items`, `next`, `head`, `oldest` और `epoch` होते हैं। अगले अनुरोध में `next` को `after` के रूप में दें। `after` के बिना फ़ीड सर्वर द्वारा रखे गए सबसे पुराने इवेंट से शुरू होती है। एक अनुरोध अधिकतम `limit` इवेंट लौटाता है (1–500, डिफ़ॉल्ट 100)। देखें [listEvents](../api/reference/events#listEvents)।

## इवेंट {#event}

```json
{
  "specversion": "1.0",
  "id": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f:42",
  "source": "/arkvory/studio/repositories/releases",
  "type": "arkvory.artifact.published.v1",
  "subject": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
  "time": "2026-10-17T09:30:00.000Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:arkvory:event:artifact.published:1",
  "partitionkey": "repository:releases",
  "arkvoryposition": "42",
  "arkvoryepoch": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f",
  "data": {
    "repository": "releases",
    "artifactId": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
    "name": "game.upack",
    "size": "73400320",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "labels": ["ci"],
    "stages": []
  }
}
```

- किसी इवेंट के हर दोहराव में `id` एक ही रहता है: इसी से डुप्लिकेट हटाएँ।
- `data` में आर्टिफ़ैक्ट के पहचानकर्ता और तथ्य होते हैं: नाम, दशमलव स्ट्रिंग के रूप में आकार, SHA-256, इवेंट के समय के लेबल और स्टेज, और UPack पैकेज। फ़ाइल, स्टेज, इमेज, npm और Git LFS इवेंट पथ, स्टेज, digest या tag सहित इमेज, npm पैकेज या ऑब्जेक्ट ID जोड़ते हैं।
- मेटाडेटा के मान, परिवर्तन करने वाला उपयोगकर्ता, सीक्रेट और फ़ाइलों की सामग्री कभी इवेंट में नहीं होते। अगर लेबल के कारण `data` 8 KiB से बड़ा हो जाता, तो लेबल छोड़ दिए जाते हैं और `truncated` का मान `true` होता है।
- `GET /api/v1/events/types` हर टाइप को उसके `data` के JSON Schema के साथ सूचीबद्ध करता है।

| समूह             | टाइप                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| आर्टिफ़ैक्ट      | `artifact.published`, `artifact.deleted`, `artifact.promoted`, `artifact.received`  |
| फ़ाइलें और पैकेज | `asset.revision.created`, `asset.restored`, `package.registered`                    |
| विवरण            | `annotation.updated`, `attachments.updated`, `stage.added`, `stage.removed`         |
| कंटेनर इमेज      | `oci.manifest.pushed`, `oci.manifest.deleted`, `oci.tag.updated`, `oci.tag.deleted` |
| npm और Git LFS   | `npm.version.published`, `npm.tag.updated`, `npm.tag.deleted`, `lfs.object.stored`  |

## क्रम और अनुमतियाँ {#order}

- एक रिपॉज़िटरी के इवेंट उसी क्रम में आते हैं जिसमें उनके परिवर्तन कमिट हुए (`partitionkey`)। अलग-अलग रिपॉज़िटरी के बीच स्थितियाँ यह दिखाती हैं कि इवेंट किस क्रम में दिखाई दिए, कारण और परिणाम नहीं।
- स्थितियाँ बढ़ती हैं, पर संख्याएँ छोड़ सकती हैं। कभी यह न मानें कि वे लगातार हैं।
- परिवर्तन के लगभग आधे सेकंड बाद, जब worker उसे संख्या देता है, इवेंट फ़ीड में दिखता है। worker रुका रहने तक इवेंट प्रतीक्षा करते हैं और कुछ नहीं खोता।
- आप उन रिपॉज़िटरी के इवेंट देखते हैं जहाँ आपकी कुंजी या खाते के पास `artifact.list` है, वही अनुमति जो [परिवर्तन फ़ीड](../api/reference/artifacts#listCatalogChanges) के लिए चाहिए। अनुमतियाँ हर अनुरोध पर जाँची जाती हैं, इसलिए वापस ली गई अनुमति इवेंट को तुरंत छिपा देती है।
- `next` उन इवेंट के पार भी बढ़ता है जिन्हें आप नहीं देख सकते, प्रति अनुरोध अधिकतम 5000, इसलिए सीमित अनुमतियों वाली कुंजी कभी अटकती नहीं। यह केवल बताता है कि उन स्थितियों पर सर्वर के पास अन्य इवेंट थे।

## रखने की अवधि और पुनर्स्थापना {#retention}

सर्वर इवेंट को 168 घंटे और अधिकतम 5 000 000 तक रखता है (`ARKVORY_EVENTS_RETENTION_HOURS`, `ARKVORY_EVENTS_MAX_ROWS`, देखें [एनवायरनमेंट वेरिएबल](../reference/environment))। फ़ीड एक खिड़की है, इतिहास नहीं: इतिहास कैटलॉग ऑडिट रखता है। इवेंट बैकअप का हिस्सा नहीं होते।

| उत्तर                                  | क्या हुआ                                                                   | क्या करें                                                      |
| -------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `410`, `gone/events_cursor_expired`    | आपका कर्सर `oldest` से पुराना है                                           | API से वर्तमान स्थिति पढ़ें, फिर `oldest` से जारी रखें         |
| `409`, `conflict/events_epoch_changed` | सर्वर बैकअप से पुनर्स्थापित हुआ और उसकी स्थितियों ने नया `epoch` शुरू किया | वर्तमान स्थिति पढ़ें, फिर बिना कर्सर के या नए हेड से जारी रखें |

दोनों उत्तर `events` में वर्तमान `epoch`, `oldest` और `head` देते हैं; कर्सर `<epoch>:<position>` होता है। `arkvoryctl events tail` एग्ज़िट कोड 6 के साथ समाप्त होती है, और SDK उन्हीं फ़ील्ड के साथ त्रुटि फेंकता है।

## वेबहुक {#webhooks}

[वेबहुक](./webhooks) अब भी एक रिपॉज़िटरी की परिवर्तन फ़ीड को एक HTTP पते पर भेजते हैं। इवेंट फ़ीड उनकी जगह नहीं लेती।
