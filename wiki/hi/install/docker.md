---
title: Docker Compose
description: 'Arkvory को Docker Compose प्रोजेक्ट के रूप में चलाएँ, उसके कंटेनर, वॉल्यूम, पोर्ट, अपडेट, बैकअप एजेंट और हटाने के साथ।'
---

# Docker Compose

Compose इंस्टॉलेशन एक ही होस्ट पर API, वर्कर, बैकअप एजेंट और PostgreSQL को कंटेनर के रूप में चलाता है। इंस्टॉलर रिलीज़ से Arkvory इमेज बनाता है और प्रोजेक्ट `proanima-arkvory` शुरू करता है। इसे कंटेनर होस्ट पर इस्तेमाल करें। Windows पर Docker Desktop केवल मूल्यांकन के लिए है: [Windows और Docker Desktop](#docker-desktop) देखें।

Compose में अंतर्निहित HTTPS नहीं है। दूसरे कंप्यूटरों से क्लाइंट जुड़ने से पहले इसके सामने रिवर्स प्रॉक्सी रखें: [HTTPS और रिवर्स प्रॉक्सी](./https) देखें।

## आवश्यकताएँ {#requirements}

| मद          | आवश्यकता                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| इंजन        | Compose प्लगइन के साथ Docker Engine (`docker compose`)। संगत compose प्रोवाइडर वाला Podman `--engine podman` के साथ संभव है, पर उसकी जाँच नहीं की गई                            |
| खाता        | `root`, या `docker` समूह का कोई उपयोगकर्ता                                                                                                                                      |
| बूट पर शुरू | कंटेनर इंजन बूट पर शुरू होना चाहिए, वरना रीस्टार्ट के बाद Arkvory वापस नहीं आता। `systemctl is-enabled docker` से जाँचें                                                        |
| होस्ट       | प्रति कंटेनर होस्ट एक Arkvory इंस्टॉलेशन। प्रोजेक्ट नाम और पोर्ट तय हैं                                                                                                         |
| खाली पोर्ट  | `127.0.0.1` पर 8080                                                                                                                                                             |
| कंटेनर      | केवल Linux कंटेनर। Windows कंटेनर समर्थित नहीं हैं                                                                                                                              |
| इंटरनेट     | `nodejs.org` (इंस्टॉलर Node.js 24.21.0 डाउनलोड करता है और उसका SHA-256 जाँचता है), अपडेट हब या GitHub (रिलीज़), और Docker Hub (`node:24.21.0-bookworm-slim` और `postgres:18.4`) |

इंस्टॉलर कंटेनर इंजन, हाइपरवाइज़र या WSL इंस्टॉल या बदलता नहीं है।

## बंडल {#bundle}

इंस्टॉलर सत्यापित रिलीज़ लेता है और उसे इंस्टॉलेशन रूट में `releases/<version>/` पर खोलता है। Compose फ़ाइल `releases/<version>/deploy/compose.yml` है और बिल्ड फ़ाइल `releases/<version>/deploy/Dockerfile` है। इमेज `proanima-arkvory:<version>` आपके होस्ट पर `node:24.21.0-bookworm-slim` से बनाई जाती है। किसी Arkvory रजिस्ट्री से कुछ भी पुल नहीं किया जाता।

इंस्टॉलेशन रूट Linux पर `/opt/proanima-arkvory` है। उसका लेआउट [इंस्टॉलेशन चुनें](./#installation-directory) में वर्णित है। Compose इंस्टॉलेशन में डेटा `data/` में नहीं होता: वह नीचे वर्णित वॉल्यूम में होता है।

## कंटेनर {#containers}

| सेवा          | इमेज                         | भूमिका                                                                                              |
| ------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `database`    | `postgres:18.4`              | PostgreSQL। हर 5 सेकंड में `pg_isready` के साथ तैयार बताता है                                       |
| `api`         | `proanima-arkvory:<version>` | HTTP API और कंसोल। `127.0.0.1:8080` पर प्रकाशित। हर 10 सेकंड में हेल्थ चेक                          |
| `worker`      | `proanima-arkvory:<version>` | अपलोड पूरा करता है और पृष्ठभूमि जॉब चलाता है। API के स्वस्थ होने के बाद शुरू होता है                |
| `backup`      | `proanima-arkvory:<version>` | बैकअप एजेंट। स्टोरेज वॉल्यूम को रीड-ओनली पढ़ता है। कोई पोर्ट प्रकाशित नहीं करता                     |
| `initialize`  | `proanima-arkvory:<version>` | एकबारगी, root के रूप में: स्टोरेज वॉल्यूम पर उपयोगकर्ता 1000 को स्वामित्व देता है                   |
| `migrate`     | `proanima-arkvory:<version>` | एकबारगी: डेटाबेस माइग्रेशन चलाता है                                                                 |
| `vault-owner` | `proanima-arkvory:<version>` | एकबारगी, केवल `maintenance` प्रोफ़ाइल के साथ: बैकअप स्टोरेज पर उपयोगकर्ता 1000 को स्वामित्व देता है |

लंबे समय तक चलने वाली सेवाएँ तब तक रीस्टार्ट होती हैं जब तक आप उन्हें न रोकें। Arkvory के कंटेनर इमेज के `node` उपयोगकर्ता (उपयोगकर्ता 1000) के रूप में चलते हैं, रीड-ओनली रूट फ़ाइल सिस्टम, मेमोरी में 64 MiB `/tmp`, सभी क्षमताएँ हटाई गईं, `no-new-privileges` और रुकने के लिए 120 सेकंड के साथ। Docker प्रत्येक कंटेनर के लिए 20 MiB की अधिकतम पाँच JSON लॉग फ़ाइलें रखता है।

## वॉल्यूम और बाइंड माउंट {#volumes}

### Docker वॉल्यूम {#docker-volumes}

| वॉल्यूम                    | यहाँ माउंट                           | सामग्री                                                                 |
| -------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                   | फ़ाइल सामग्री और अपलोड स्टेजिंग। बैकअप एजेंट इसे रीड-ओनली माउंट करता है |
| `proanima-arkvory_catalog` | `database` में `/var/lib/postgresql` | PostgreSQL डेटा                                                         |

वॉल्यूम अपडेट और `docker compose down` से बचे रहते हैं। केवल `down --volumes` उन्हें हटाता है।

### इंस्टॉलेशन रूट से बाइंड माउंट {#bind-mounts}

| होस्ट पथ                  | कंटेनर में                      | मोड      | यहाँ माउंट                                                 |
| ------------------------- | ------------------------------- | -------- | ---------------------------------------------------------- |
| `config/runtime.json`     | `/run/arkvory/runtime.json`     | रीड-ओनली | api, worker, backup                                        |
| `config/keys.json`        | `/run/arkvory/keys.json`        | रीड-ओनली | api, worker                                                |
| `config/health-token.txt` | `/run/arkvory/health-token.txt` | रीड-ओनली | api, worker                                                |
| `config/postgres.env`     | एनवायरनमेंट फ़ाइल               |          | database                                                   |
| `updates/status`          | `/run/arkvory-updates/status`   | रीड-ओनली | api, worker                                                |
| `updates/inbox`           | `/run/arkvory-updates/inbox`    | रीड-राइट | api, worker                                                |
| बैकअप स्टोरेज             | `/srv/arkvory-vault`            | रीड-राइट | backup, `vault-owner` (केवल जब बैकअप स्टोरेज कॉन्फ़िगर हो) |
| `config/mirrors`          | `/run/arkvory/mirrors`          | रीड-ओनली | api, worker (केवल जब कोई रिपॉज़िटरी मिरर हो)               |

### स्वामी और मोड {#owners}

| पथ                                                     | स्वामी और मोड                        | क्यों                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| इंस्टॉलेशन रूट                                         | इंस्टॉल करने वाला उपयोगकर्ता, `0700` | रूट में पुनर्प्राप्ति कुंजी और डेटाबेस पासवर्ड रहता है। केवल इंस्टॉल करने वाला उपयोगकर्ता इसमें प्रवेश कर सकता है                                     |
| `config/runtime.json`, `keys.json`, `health-token.txt` | `0644`                               | कंटेनर में उपयोगकर्ता 1000 को उन्हें पढ़ना है। `runtime.json` में डेटाबेस पासवर्ड रहता है; `0700` रूट दूसरे उपयोगकर्ताओं को इन फ़ाइलों से दूर रखता है |
| `updates/inbox`                                        | `0777`                               | वह एकमात्र डायरेक्टरी जिसे कंटेनर होस्ट पर लिखता है। कंटेनर उपयोगकर्ता और होस्ट अपडेटर के user ID अलग हो सकते हैं                                     |
| `updates/status`                                       | `0755`                               | होस्ट अपडेटर द्वारा लिखा जाता है; कंटेनर इसे केवल पढ़ता है                                                                                            |
| स्टोरेज वॉल्यूम                                        | उपयोगकर्ता 1000                      | `initialize` इसे इंस्टॉल और अपडेट पर सेट करता है                                                                                                      |
| बैकअप स्टोरेज                                          | उपयोगकर्ता 1000                      | बैकअप स्टोरेज जोड़ने पर `vault-owner` इसे सेट करता है। फिर बैकअप स्टोरेज ID 1000 वाले होस्ट उपयोगकर्ता का होता है                                     |

## पोर्ट {#ports}

| पोर्ट    | सेवा         | एक्सपोज़र                                               |
| -------- | ------------ | ------------------------------------------------------- |
| 8080/TCP | API और कंसोल | होस्ट पर `127.0.0.1:8080`। पता तय है                    |
| 5432/TCP | PostgreSQL   | प्रकाशित नहीं। केवल Compose नेटवर्क के भीतर पहुँच योग्य |

Compose फ़ाइल रिलीज़ डायरेक्टरी की होती है, जिसे अपडेट बदल देते हैं, इसलिए आप वहाँ प्रकाशित पता नहीं बदल सकते। दूसरे कंप्यूटरों से कंसोल तक पहुँचने के लिए, होस्ट पर रिवर्स प्रॉक्सी इंस्टॉल करें जो `127.0.0.1:8080` पर अग्रेषित करे।

## एनवायरनमेंट {#environment}

Compose फ़ाइल कोई Arkvory सेटिंग सेट नहीं करती। सेवाएँ `/run/arkvory/runtime.json` पढ़ती हैं, जो होस्ट पर `config/runtime.json` है। इंस्टॉलर ये मान लिखता है और आपको उन्हें नहीं बदलना चाहिए: `ARKVORY_HOST` (कंटेनर के भीतर `0.0.0.0`), `ARKVORY_PORT` (`8080`), `ARKVORY_DATABASE_URL` (बनाए गए पासवर्ड वाला `database` कंटेनर), `ARKVORY_DATA_DIR` (`/var/lib/arkvory`), `ARKVORY_KEYS_FILE` और `ARKVORY_UPDATE_CONTROL_DIR`।

आप अन्य सेटिंग्स जोड़ सकते हैं, जैसे `ARKVORY_TRUSTED_PROXIES`, सीमाएँ या `ARKVORY_LOG_LEVEL`। उन्हें `config/runtime.json` में जोड़ें, फिर [प्रोजेक्ट प्रबंधित करें](#manage) में दिखाए अनुसार सेवाएँ रोकें और शुरू करें। पूरी सूची [एनवायरनमेंट वेरिएबल](../reference/environment) में है। `config/compose.env` में `ARKVORY_IMAGE` रहता है। इंस्टॉलर इसे बनाए रखता है; इसे संपादित न करें।

## Linux पर इंस्टॉल करें {#install}

1. [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) से `install.sh` डाउनलोड करें और पढ़ें।
2. इसे `root` के रूप में चलाएँ:

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   स्वचालित अपडेट चालू करने के लिए `--automatic` जोड़ें, या Podman के लिए `--engine podman`। `ARKVORY_RELEASE_VERSION=1.2.3` के साथ स्क्रिप्ट वही स्थिर संस्करण इंस्टॉल करती है। GitHub तक इंटरनेट न होने पर, `Arkvory-Linux.tar.gz` खोलें और खोली गई डायरेक्टरी में `sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose` चलाएँ। Node.js फिर भी डाउनलोड होता है।

3. इंस्टॉलर के पूरा होने की प्रतीक्षा करें। यह रिलीज़ जाँचता और खोलता है, इमेज बनाता है, डेटाबेस शुरू करता है, `initialize` और `migrate` चलाता है, API और वर्कर शुरू करता है, API के लगातार तीन बार तैयार बताने तक प्रतीक्षा करता है, बैकअप एजेंट शुरू करता है और अपडेट टाइमर पंजीकृत करता है।

`docker` समूह का उपयोगकर्ता बिना `root` के उस डायरेक्टरी में इंस्टॉल कर सकता है जिसका वह स्वामी है:

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

तब इंस्टॉलर कोई अपडेट टाइमर पंजीकृत नहीं करता। जब तक आप स्वयं अपडेटर शेड्यूल नहीं करते, कंसोल अपडेट का अनुरोध नहीं कर सकता। [Compose में अपडेट](#updates-compose) देखें।

## पहला शुरू और शुरुआती चरण {#first-start}

1. जाँचें कि कंटेनर चल रहे हैं। `compose` कमांड के लिए [प्रोजेक्ट प्रबंधित करें](#manage) देखें।

   ```bash
   "${compose[@]}" ps
   ```

2. पुनर्प्राप्ति कुंजी पढ़ें:

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. सर्वर पर `http://127.0.0.1:8080/console/#onboarding` खोलें। अपने कंप्यूटर से पोर्ट अग्रेषित करें: `ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`।
4. कंसोल में [[ui:navStart]] खोलें और [[ui:welcomeOwner]] का विस्तार करें। कुंजी को [[ui:welcomeRecovery]] में चिपकाएँ, स्वामी का नाम और कम से कम 12 अक्षरों का पासवर्ड दर्ज करें, और [[ui:welcomeCreate]] चुनें।

पुनर्प्राप्ति कुंजी सर्वर पर रखें। [सुरक्षा](../operate/security) देखें।

## प्रोजेक्ट प्रबंधित करें {#manage}

root शेल खोलें (`sudo -i`) और `compose` कमांड को एक बार परिभाषित करें। Compose को प्रोजेक्ट नाम, प्रोजेक्ट डायरेक्टरी, एनवायरनमेंट फ़ाइल और इंस्टॉलेशन की हर Compose फ़ाइल चाहिए:

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"   # linux-arm64 on arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

यदि आप मौजूद कोई फ़ाइल छोड़ देते हैं, तो `up` कंटेनर को बिना बैकअप स्टोरेज या मिरर माउंट के फिर से बना देता है।

| कार्य             | कमांड                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| कंटेनर दिखाएँ     | `"${compose[@]}" ps`                                                            |
| लॉग पढ़ें         | `"${compose[@]}" logs --tail 100 api worker backup`                             |
| Arkvory रोकें     | `"${compose[@]}" stop --timeout 120 backup worker api`                          |
| Arkvory शुरू करें | `"${compose[@]}" up -d --wait api worker` और फिर `"${compose[@]}" up -d backup` |

`stop` से रोकने पर इंजन के रीस्टार्ट के बाद कंटेनर रुका रहता है। इसे `up -d` से फिर शुरू करें।

लाइफ़साइकल कमांड उस Node.js से चलते हैं जो इंस्टॉलर ने रूट में रखा है:

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

Compose होस्ट पर `arkvory` इंस्टॉल नहीं होता, इसलिए `status`, `update` और `configure` के लिए `manage.mjs` कॉल करें। कमांड [विन्यास](./configuration) में वर्णित हैं।

## लॉग {#logs}

कंटेनर Docker की JSON लॉग फ़ाइलों में लिखते हैं। उन्हें `"${compose[@]}" logs` से पढ़ें। API और वर्कर प्रति पंक्ति एक JSON रिकॉर्ड लिखते हैं। [मॉनिटरिंग](../operate/monitoring) देखें। लाइफ़साइकल कमांड अपने संदेश टर्मिनल पर छापते हैं, और अपडेट टाइमर जर्नल में लिखता है: `journalctl -u arkvory-update`।

## Compose में अपडेट {#updates-compose}

कंसोल, स्वचालित अपडेट विंडो या कमांड से अपडेट करें:

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

अपडेट रिलीज़ डाउनलोड और जाँचता है, नई इमेज बनाता है, फिर `backup`, `worker` और `api` रोकता है और उन्हें नई इमेज के साथ शुरू करता है। `database` कंटेनर चलता रहता है। वॉल्यूम वैसे ही रहते हैं। डेटाबेस स्कीमा बदलने वाला रिलीज़ केवल सत्यापित बैकअप के बाद इंस्टॉल होता है। [अपडेट](./updates) देखें।

होस्ट अपडेटर मिनट में एक बार चलता है। systemd होस्ट पर `root` के रूप में इंस्टॉल होने पर इंस्टॉलर इसे `arkvory-update.timer` के रूप में पंजीकृत करता है। `root` के बिना, इंस्टॉलर चेतावनी छापता है। इस कमांड को उस उपयोगकर्ता के रूप में हर मिनट शेड्यूल करें जो इंस्टॉलेशन का स्वामी है और कंटेनर इंजन तक पहुँच रखता है, उदाहरण के लिए cron के साथ:

```text
* * * * * /home/admin/arkvory/runtime/node-v24.21.0-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

Arkvory कंटेनरों को कभी Docker सॉकेट न दें।

## Compose में बैकअप एजेंट {#backup-agent}

`backup` कंटेनर शुरू से चलता है। बिना बैकअप स्टोरेज के यह चलता है और बताता है कि कोई बैकअप स्टोरेज कॉन्फ़िगर नहीं है। बैकअप स्टोरेज होस्ट की एक डायरेक्टरी है, इंस्टॉलेशन रूट से बाहर, एक अलग वॉल्यूम पर।

1. बैकअप स्टोरेज वॉल्यूम माउंट करें और एक खाली डायरेक्टरी बनाएँ, उदाहरण के लिए `/mnt/backup/arkvory`। डायरेक्टरी मौजूद होनी चाहिए: Compose इसे नहीं बनाता।
2. इसे जोड़ें:

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
   ```

   कमांड डायरेक्टरी जाँचता है, `config/compose.vault.yml` लिखता है, डायरेक्टरी पर उपयोगकर्ता 1000 को स्वामित्व देता है, एजेंट की कुंजी की फ़ाइल को बैकअप कंटेनर को केवल-पढ़ने के रूप में देता है (`--vault-key-file`) और केवल बैकअप कंटेनर रीस्टार्ट करता है। यह तब सफल होता है जब एजेंट बैकअप स्टोरेज को उपलब्ध बताता है। वरना यह पिछला विन्यास बहाल कर देता है।

3. बैकअप स्टोरेज हटाने के लिए, वही कमांड `--backup-vault-off` के साथ चलाएँ। बैकअप स्टोरेज को स्वयं छुआ नहीं जाता।

शेड्यूल, प्रतिधारण और पुनर्स्थापनाएँ [बैकअप](../operate/backups) में वर्णित हैं।

## हटाएँ {#remove}

```bash
"${compose[@]}" down              # removes the containers, keeps the volumes
"${compose[@]}" down --volumes    # also deletes the catalog and all stored files
```

`down --volumes` सारा डेटा हटा देता है। इसे कभी ऐसे इंस्टॉलेशन पर न चलाएँ जिसमें फ़ाइलें हों। पहले बैकअप बनाएँ, और बैकअप स्टोरेज रखें।

`down` के बाद, आप जो बचा है उसे हटा सकते हैं:

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

रूट को तभी हटाएँ जब आपको विन्यास और पुनर्प्राप्ति कुंजी की ज़रूरत न रहे। पुराने संस्करणों की इमेजें होस्ट पर तब तक रहती हैं जब तक आप उन्हें न हटाएँ।

## Windows और Docker Desktop {#docker-desktop}

Docker Desktop को केवल वर्कस्टेशन पर मूल्यांकन के लिए इस्तेमाल करें। Docker Desktop एक उपयोगकर्ता का एप्लिकेशन है: कंटेनर तभी चलते हैं जब यह उपयोगकर्ता साइन-इन हो और Docker Desktop चल रहा हो। कंप्यूटर के रीस्टार्ट के बाद तब तक Arkvory अनुपलब्ध रहता है। **Settings > General > Start Docker Desktop when you sign in** चालू करें। यह सेटिंग बंद होने पर इंस्टॉलर और `status` कमांड चेतावनी देते हैं। सर्वर के लिए, [Windows सेवाएँ](./windows) इस्तेमाल करें।

1. Docker Desktop को Linux कंटेनर मोड में शुरू करें।
2. रिलीज़ से `install.ps1` डाउनलोड करें और पढ़ें।
3. उस उपयोगकर्ता के रूप में Windows PowerShell खोलें जो Docker Desktop चलाता है, व्यवस्थापक अधिकारों के **बिना**, और चलाएँ:

   ```powershell
   .\install.ps1 -Mode compose
   ```

   पैरामीटर `-Root`, `-Version`, `-Engine`, `-Artifact`, `-AutomaticUpdates` और `-Pin` [Windows](./windows#install-with-powershell-and-an-existing-postgresql) में वर्णित हैं। `-Root` और `-Artifact` निरपेक्ष पथ के रूप में दें।

4. `http://127.0.0.1:8080/console/#onboarding` खोलें, `C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt` से पुनर्प्राप्ति कुंजी पढ़ें और [पहला शुरू और शुरुआती चरण](#first-start) में वर्णित अनुसार स्वामी बनाएँ।

इंस्टॉलेशन रूट `C:\ProgramData\ProAnima\Arkvory` SYSTEM, Administrators और इंस्टॉल करने वाले उपयोगकर्ता को बिना विरासत के पहुँच देता है, क्योंकि Docker Desktop इस उपयोगकर्ता के टोकन से बाइंड माउंट पढ़ता है। Compose के लिए इंस्टॉलर को उन्नत (elevated) न चलाएँ।

इंस्टॉलर अपडेट कार्य `ProAnimaArkvoryUpdate` को केवल तब पंजीकृत करता है जब वह व्यवस्थापक के रूप में चलता है। वह कार्य सिस्टम-व्यापी इंजन के लिए उपयुक्त है, Docker Desktop के लिए नहीं। Docker Desktop के लिए, कार्य को Docker Desktop उपयोगकर्ता के रूप में पंजीकृत करें। यह केवल तब काम करता है जब यह उपयोगकर्ता साइन-इन हो और Docker Desktop चल रहा हो:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.21.0-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

प्रोजेक्ट को PowerShell में उन्हीं आर्गुमेंट के साथ प्रबंधित करें:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Windows पर बैकअप स्टोरेज स्थानीय या iSCSI वॉल्यूम होना चाहिए। UNC और SMB पथ अस्वीकार कर दिए जाते हैं। इंस्टॉलेशन हटाने के लिए, `docker @compose down --volumes` चलाएँ, कार्य को `Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false` से हटाएँ, और रूट को हटाएँ। पहले बैकअप लें।
