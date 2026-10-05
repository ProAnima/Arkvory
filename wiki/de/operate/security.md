---
title: Sicherheit
description: 'Wie Sie einen Arkvory-Server härten, wo seine Geheimnisse liegen, welche Grenzen die Anmeldung schützen, was protokolliert und auditiert wird und was an den Hub von ProAnimaStudio gesendet wird.'
---

# Sicherheit

Diese Seite richtet sich an den Administrator, der einen Server betreibt. Sie beginnt mit den Schritten zum Härten einer neuen Installation und beschreibt dann jeden Schutz im Detail.

Das Projekt gibt an, dass ein Bedrohungsmodell und eine externe Sicherheitsprüfung noch offen sind. Veröffentlichen Sie den Server nicht im offenen Internet. Lassen Sie nur die Netze Ihrer Clients darauf zugreifen.

## Einen neuen Server härten {#checklist}

1. Behalten Sie die Standard-Listenadresse `127.0.0.1`, bis HTTPS funktioniert. Siehe [Netzwerk und HTTPS](#network).
2. Schalten Sie HTTPS ein und öffnen Sie nur den HTTPS-Port für die Client-Netze. Öffnen Sie niemals den Datenbankport.
3. Erstellen Sie persönliche Konten für die Administratoren. Bewahren Sie den Wiederherstellungsschlüssel für Notfälle auf. Siehe [Wiederherstellungsschlüssel](../install/index#recovery-key).
4. Geben Sie jedem Werkzeug oder CI-System ein eigenes Dienstkonto mit einem Schlüssel, der die wenigsten Rechte hat. Siehe [Schlüssel und Token](#keys).
5. Lassen Sie die Selbstregistrierung aus. Sie ist standardmäßig aus.
6. Wenn ein Reverse-Proxy vor Arkvory steht, setzen Sie `ARKVORY_TRUSTED_PROXIES`. Siehe [Anmeldegrenzen](#sign-in-limits).
7. Legen Sie den Backup-Speicher auf einen verschlüsselten Datenträger, den nur das Dienstkonto und der Backup-Administrator lesen können. Siehe [Backups](./backups).
8. Bewahren Sie Kopien der Geheimnisdateien außerhalb des Servers auf. Siehe [Sichern Sie Ihre Geheimnisse](#secret-backups).
9. Verbinden Sie die Metriken und die Alarme. Siehe [Monitoring](./monitoring).

## Netzwerk und HTTPS {#network}

Der Server lauscht standardmäßig auf `127.0.0.1:8080`. Eine native Installation kann auf einer anderen Adresse lauschen, nachdem Sie HTTPS konfiguriert haben:

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-cert /etc/arkvory/fullchain.pem --tls-key /etc/arkvory/privkey.pem --listen-host 0.0.0.0
```

Der Befehl prüft die Dateien, startet die Dienste neu und stellt die alten Einstellungen wieder her, wenn die Dienste nicht hochkommen. Siehe [HTTPS und Reverse-Proxy](../install/https) für das vollständige Verfahren und für Docker Compose, das einen Reverse-Proxy benötigt.

- Das Zertifikat und der Schlüssel müssen lesbar sein, zusammenpassen und dürfen nicht abgelaufen sein. Andernfalls startet die API nicht und fällt nie auf einfaches HTTP zurück.
- Die minimale TLS-Version ist 1.2. Setzen Sie `ARKVORY_TLS_MIN_VERSION=TLSv1.3`, um 1.3 zu verlangen. Client-Zertifikate werden nicht unterstützt.
- Der Server antwortet mit `Strict-Transport-Security: max-age=31536000`, wenn er HTTPS selbst bereitstellt. Ein Proxy besitzt diesen Header, wenn er TLS terminiert.
- Erneuerte Zertifikatsdateien werden alle 300 Sekunden (`ARKVORY_TLS_RELOAD_SECONDS`) ohne Neustart erneut gelesen. Neue Verbindungen erhalten das neue Zertifikat. Eine Datei, die nicht gelesen werden kann, lässt das funktionierende Zertifikat an Ort und Stelle und schreibt `tls.reload_failed`. `tls.expiring` wird täglich für die letzten 14 Tage geschrieben.
- Eine Nicht-Loopback-Adresse ohne TLS und ohne vertrauenswürdigen Proxy schreibt beim Start die Warnung `http.plaintext_exposed`. Beheben Sie das, bevor Sie Clients hereinlassen.
- Arkvory schaltet die Prüfung eines empfangenen Zertifikats nie ab: nicht für Spiegel, nicht für den Hub, nicht im Kommandozeilen-Client. Fügen Sie Ihre eigene Zertifizierungsstelle mit `--mirror-ca-file` für Spiegel hinzu.

Hinter einem Reverse-Proxy bleibt die API auf Loopback. Der Proxy muss Bodies streamen, ohne ganze Dateien zu puffern. Protokollieren Sie den Query-String nicht am Proxy, weil ein Download-Link dort sein Geheimnis trägt.

## Geheimnisse auf dem Server {#secrets}

Die Installer erstellen diese Dateien im Installationsverzeichnis. Behalten Sie die Berechtigungen bei, die der Installer gesetzt hat.

| Datei                        | Inhalt                                                                                       | Zugriff                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `config/bootstrap-token.txt` | Der Wiederherstellungsschlüssel. Er hat Administratorrechte                                  | Linux: nur root (Modus 0600). Windows: SYSTEM und Administrators                          |
| `config/keys.json`           | SHA-256-Hashes des Wiederherstellungsschlüssels und des Health-Schlüssels, nie die Schlüssel | Linux: root schreibt, die Dienstgruppe liest (0640). Windows: vom Stammverzeichnis geerbt |
| `config/health-token.txt`    | Der Health-Schlüssel `deployment-health`. Er hat keine Repository-Rechte                     | Linux: nur root. Compose: im Container lesbar                                             |
| `config/runtime.json`        | Alle Servereinstellungen, einschließlich der Datenbank-URL mit ihrem Passwort                | Linux: root schreibt, die Dienstgruppe liest (0640). Windows: vom Stammverzeichnis geerbt |
| `config/postgres.env`        | Das Datenbankpasswort einer Compose-Installation                                             | Nur root, oder SYSTEM und Administrators                                                  |
| `github-token.txt`           | Ein optionales GitHub-Token für Updates                                                      | Nur root, oder SYSTEM und Administrators                                                  |
| `config/mirrors/*.token`     | Leseschlüssel für die Quellserver von Spiegeln                                               | Das Dienstkonto                                                                           |
| Der TLS-Schlüssel            | Der private Schlüssel des Zertifikats                                                        | Sie wählen den Ort. Erlauben Sie nur dem Dienstkonto den Zugriff                          |

Auf Windows gewährt das Stammverzeichnis SYSTEM und Administrators die vollständige Kontrolle. Das Dienstkonto `LocalService` liest das Stammverzeichnis und schreibt nur nach `data\`, `logs\` und in den Update-Eingang. Die Datenbank läuft unter einem anderen Konto, sodass die API die Datenbankdateien nicht lesen kann.

Regeln für alle Geheimnisse:

- Übergeben Sie sie in Dateien oder Umgebungsvariablen, nie in Befehlsargumenten. Argumente sind in der Prozessliste sichtbar.
- Kopieren Sie den Wiederherstellungsschlüssel nicht auf Clients, CI-Systeme oder Skripte. Erstellen Sie Konten und Dienstschlüssel für die tägliche Arbeit.
- Der Server schreibt niemals Schlüssel, Passwörter, Token, `Authorization`-Header oder Query-Strings in sein Log. Siehe [Monitoring](./monitoring#never-logged).
- Die Befehlsausgabe des Installers redigiert Datenbank-URLs, Schlüssel und lange Geheimnisse.

Um den Wiederherstellungsschlüssel zu ersetzen, ändern Sie die Datei `bootstrap-token.txt` und ihren Hash in `config/keys.json` gemeinsam, behalten Sie den Eintrag `deployment-health` und starten Sie die API und den Worker neu. Siehe [Konfiguration](../install/configuration).

## Passwörter und Anmeldegrenzen {#sign-in-limits}

Passwörter haben 12 bis 128 Zeichen und werden nur als gesalzener Hash (scrypt) gespeichert. Eine Anmeldung dauert 12 Stunden. Ein Konto hat höchstens 32 aktive Sitzungen; eine neue Anmeldung beendet die älteste. Eine Passwortänderung oder ein Zurücksetzen beendet alle Sitzungen und widerruft alle persönlichen Token des Kontos.

Arkvory hat keine harte Sperre, die es jedem, der einen Namen kennt, erlauben würde, den Besitzer auszusperren. Es verlangsamt Angriffe in Schichten:

| Schicht                          | Grenze                                                                                                                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pro Adresse, Anmeldung           | 10 Versuche auf einmal, danach 1 weiterer alle 15 Sekunden. Ein korrektes Passwort gibt den Versuch zurück. IPv6 zählt pro /64-Netz                                                                                                                                                |
| Pro Adresse, Selbstregistrierung | 3 Versuche, danach 1 alle 20 Minuten; 20 pro Prozess, danach 1 alle 3 Minuten                                                                                                                                                                                                      |
| Pro Konto                        | Jedes falsche Passwort fügt eine Einheit Schuld hinzu. Die Schuld schrumpft um 1 alle 6 Sekunden. Über 20 Einheiten fügt jedes falsche Passwort eine Wartezeit hinzu, die sich von 1 Sekunde auf 2 Minuten verdoppelt. Während der Wartezeit erhält auch das korrekte Passwort 429 |
| Anmeldeanforderungen auf einmal  | Höchstens 16, und der Body einer Anforderung muss innerhalb von 10 Sekunden eintreffen                                                                                                                                                                                             |
| Passwortprüfungen                | Anonyme und Administrator-Prüfungen verwenden getrennte Warteschlangen, sodass eine Flut von Anmeldungen einen Administrator nicht blockiert                                                                                                                                       |

Die Antwort ist 429 `rate_limited` mit dem Grund `login_attempts` und dem Header `Retry-After`. Die Adresszähler leben im Prozess und werden bei einem Neustart zurückgesetzt. Die Kontoschuld steht in der Datenbank. Ein Passwort-Reset durch einen Administrator löscht sie.

Hinter einem Reverse-Proxy setzen Sie `ARKVORY_TRUSTED_PROXIES` auf die Adressen des Proxys (bis zu 32, IP oder CIDR). Nur diese Adressen dürfen die Client-Adresse mit `X-Forwarded-For` nennen. Ohne die Einstellung teilen alle Clients die Adresse des Proxys, und ein paar fehlgeschlagene Anmeldungen sperren alle für eine Weile aus.

## Schlüssel, Token und Ablauf {#keys}

| Anmeldedatum                                     | Lebensdauer                                                                                                              | Rotation                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anmeldesitzung                                   | 12 Stunden                                                                                                               | Erneut anmelden                                                                                                                                               |
| Persönliches Zugriffstoken                       | Standardmäßig 90 Tage, höchstens 365. Umfang `read` oder `read-write`. Nie Administratorrechte                           | Erstellen Sie ein neues Token in [[ui:personalAccessTokens]] und widerrufen Sie das alte                                                                      |
| Dienstschlüssel                                  | Standardmäßig 90 Tage, höchstens 365. Ein Schlüssel, der ausgegeben aber nicht aktiviert wurde, läuft nach 15 Minuten ab | [[ui:keyRotate]] gibt einen neuen Schlüssel aus. Der alte Schlüssel funktioniert höchstens 24 weitere Stunden. [[ui:keyRevoke]] stoppt einen Schlüssel sofort |
| Download-Link                                    | Eine Stunde in der Konsole                                                                                               | Erstellen Sie einen neuen Link                                                                                                                                |
| Wiederherstellungsschlüssel und Health-Schlüssel | Sie laufen nicht ab                                                                                                      | Ersetzen Sie sie von Hand. Siehe [Geheimnisse auf dem Server](#secrets)                                                                                       |

Erstellen Sie persönliche Token und ändern Sie Passwörter nur in einer angemeldeten Sitzung. Ein Token kann keine Token erstellen. Ein persönliches Token hat keine Administratorrechte, wem auch immer es gehört.

Minimale Rechte für Werkzeuge:

- Erstellen Sie ein Dienstkonto für jeden Verbraucher in [[ui:services]], mit [[ui:servicePolicy]] auf den genauen Repositorys und den genauen Aktionen, die er braucht. [[ui:bindingRead]] und [[ui:bindingPublish]] füllen typische Mengen.
- Das Erstellen von Konten und Gewährungen benötigt das separate Recht des Wiederherstellungsschlüssels oder einer Delegierung. [[ui:delegations]] lässt den Besitzer begrenzte Rechte an einen Operator weitergeben. Ein delegierter Schlüssel überlebt nie den Schlüssel seines Ausstellers.
- Geben Sie dem Metrik-Scraper einen eigenen Schlüssel mit minimalen Rechten.
- Das Widerrufen einer Gewährung blockiert einen Schlüssel, der auf die Aktivierung wartet, widerruft aber keine Schlüssel, die bereits aktiv sind. Widerrufen oder deaktivieren Sie diese selbst. Ein Download, der begonnen hat, läuft nach einem Widerruf weiter.
- Eine Änderung der Rechte gilt ab der nächsten Anforderung. Der Server prüft den Zugriff für jede Anforderung erneut, für Listen, Metadaten und Dateibytes.

## Audit-Logs {#audit}

| Journal               | Was es enthält                                                                                                                                                                                 | Wo zu lesen                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Sicherheitsjournal    | Anmeldungen und Fehler, Registrierungen, Änderungen von Konten, Gruppen, Gewährungen, Passwörtern und persönlichen Token, mit Akteur, Art des Anmeldedatums, Ziel, Ergebnis und Client-Adresse | `GET /api/v1/security/audit`, für eine Administrator-Sitzung oder den Wiederherstellungsschlüssel |
| Katalog-Audit         | Änderungen von Artefakten, Pfaden, Annotationen und Stufen in einem Repository                                                                                                                 | `GET /api/v1/repositories/{repository}/audit`, mit der Berechtigung, das Audit zu lesen           |
| Dienstkonto-Aktivität | Erstellung, Änderungen, ausgegebene und widerrufene Schlüssel eines Dienstkontos                                                                                                               | [[ui:serviceAudit]] in der Konsole                                                                |
| Prozess-Log           | Eine Zeile `http.access` pro Anforderung, mit `principal` und `clientIp`                                                                                                                       | Siehe [Monitoring](./monitoring#logs)                                                             |

Das Sicherheitsjournal ist nur anhängend: die Datenbank weigert sich, eine Zeile zu ändern oder zu löschen. Der Server behält 365 Tage und höchstens 1.000.000 Zeilen und entfernt die ältesten Zeilen in Stapeln. Anforderungen, die Ratenbegrenzungen ablehnen, werden nicht journalisiert, sodass eine Flut die Tabelle nicht wachsen lassen kann. Exportieren Sie das Journal in Ihren eigenen Ereignisspeicher, wenn Sie einen längeren Verlauf brauchen.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "https://arkvory.example/api/v1/security/audit?limit=100"
```

Verwenden Sie den Parameter `after` mit der letzten ID, um ältere Zeilen zu lesen.

## Konsole und Browser {#console-headers}

Der Server setzt diese Header auf die Antworten der Konsole:

| Header                    | Wert                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | `default-src 'none'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `Referrer-Policy`         | `no-referrer`                                                                                                                                                                       |
| `X-Content-Type-Options`  | `nosniff`                                                                                                                                                                           |
| `Cache-Control`           | `private, no-store`                                                                                                                                                                 |
| `X-Request-Id`            | Die Anfrage-ID der Antwort                                                                                                                                                          |

Jede API-Antwort trägt auch `X-Content-Type-Options`, `Cache-Control` und `X-Request-Id`. Die CSP erlaubt kein Inline-Skript, kein externes Skript, kein Framing und keine Verbindung zu anderen Hosts. Bilder aus `blob:` sind die Screenshots, die Sie einer Feedback-Nachricht hinzufügen.

Der Server setzt keine Cookies. Die Konsole hält einen Schlüssel oder ein Sitzungstoken nur im Speicher des Browser-Tabs. Der Browser speichert nur die Wahl von Theme und Sprache sowie die privaten Dateien der Download-Warteschlange. Eine Browserseite von einer anderen Adresse kann die API nicht aufrufen: `ARKVORY_CORS_ORIGINS` ist standardmäßig leer. Es listet bis zu 16 genaue Origins für eine externe Konsole auf, mit HTTPS oder HTTP auf Loopback. Ein erlaubter Origin erhält keine zusätzlichen Rechte, weil jede Anforderung einen Schlüssel braucht.

## Update-Signierung {#update-signing}

Jedes Release hat ein Manifest `arkvory-release.json` mit dem SHA-256 seines Archivs und Installers sowie eine Signatur `arkvory-release.json.sig`. Die Signatur ist eine Ed25519-Signatur im minisign-Format. Der Updater trägt die öffentlichen Schlüssel in seinem Code.

- Ein Release aus dem Hub oder von GitHub wird nur installiert, wenn seine Signatur zu einem eingebauten Schlüssel passt und die SHA-256-Werte zum Manifest passen. Eine falsche Signatur ist ein Fehler, und der Updater sucht nicht nach einer anderen Quelle.
- Der private Signierschlüssel bleibt beim Maintainer und ist nie auf Ihrem Server. Ein Release kann einen alten und einen neuen öffentlichen Schlüssel tragen, um Schlüssel zu rotieren.
- Ein lokaler Ordner, den Sie mit `--artifact` übergeben, ist Ihre eigene Wahl. Eine Signaturdatei darin wird geprüft, wenn sie vorhanden ist.
- Der grafische Installer und die Pakete `.deb` und `.rpm` sind noch nicht mit einem Herausgeberzertifikat signiert. Windows zeigt den Herausgeber als unbekannt an. Laden Sie sie nur von [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) herunter und vergleichen Sie die SHA-256-Werte mit `release-checksums.json`.
- Ein Release, das das Datenbankschema ändert, wird erst installiert, nachdem der Server ein frisches Backup erstellt und geprüft hat. Siehe [Updates](../install/updates).

## Was an den Hub von ProAnimaStudio gesendet wird {#hub}

Updates werden im Hub von ProAnimaStudio (`https://hub.proanima.net`) freigegeben. Der Server kontaktiert ihn in diesen Fällen:

| Daten              | Wann                                                             | Inhalt                                                                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update-Prüfung     | Alle 6 Stunden                                                   | Die aktuelle Version, das Betriebssystem und die Architektur sind Teil der Adresse. Bei eingeschalteten Statistiken eine zufällige Installations-ID im Header `X-Install-Id`                                                                                                        |
| Ereignis `updated` | Nach einem installierten Update, bei eingeschalteten Statistiken | Die Version und die Installations-ID                                                                                                                                                                                                                                                |
| Feedback           | Nur wenn ein Benutzer das Formular in der Konsole sendet         | Der Text, eine optionale E-Mail-Adresse für die Antwort, bis zu 6 Screenshots und das Log der Browserseite. Ein Administrator kann die letzten 1,5 MiB des API-Logs und eine Systemzusammenfassung hinzufügen. Das Formular zeigt alles davon, bevor Sie senden ([[ui:reportShow]]) |

Die Installations-ID ist eine zufällige UUID in `config/install-id`. Sie trägt keinen Namen, keine Adresse und keinen Inhalt. Das Projekt gibt an, dass der Hub keine IP-Adressen, Namen oder Dateiinhalte speichert. Ohne Statistiken wird die ID nicht gesendet, und der Hub bietet eine Version nur an, wenn sie für alle Installationen freigegeben ist. Die Systemzusammenfassung enthält Versionen, die Schemanummer und den Zustand von Updates und Spiegeln, ohne Adressen und Geheimnisse. Auch das API-Log enthält keine Geheimnisse.

Schalten Sie es ab:

```bash
sudo arkvory configure --root /opt/proanima-arkvory --statistics off
sudo arkvory configure --root /opt/proanima-arkvory --hub-off
```

- `--statistics off` stoppt die Installations-ID und das Ereignis `updated`. Die Konsole hat denselben Schalter: [[ui:updateStatistics]] in [[ui:updates]].
- `--hub-off` stoppt jeden Kontakt mit dem Hub. Updates kommen dann nur von GitHub, und das Konsolen-Feedback ist nach dem nächsten Neustart der Dienste aus. Die Benutzer erhalten stattdessen die in der Konsole angezeigte Kontaktadresse.
- `--hub-url https://hub.example` verweist den Server auf einen anderen Hub. Nur HTTPS oder HTTP auf Loopback wird akzeptiert.

Die Prüfungen alle 6 Stunden laufen auch, wenn die automatische Installation aus ist. Ein Server ohne Internetzugang installiert aus einer lokalen Kopie eines Releases. Siehe [Updates](../install/updates).

## Sichern Sie Ihre Geheimnisse {#secret-backups}

Der Backup-Speicher enthält den Katalog, die Passwort-Hashes und alle veröffentlichten Dateien. Er ist nicht verschlüsselt. Er enthält nicht die Dateien Ihrer Konfiguration. Bewahren Sie eine zweite Kopie dieser Dateien an einem verschlüsselten Ort außerhalb des Servers auf:

- `config/keys.json` und `config/bootstrap-token.txt` (der Wiederherstellungsschlüssel),
- `config/runtime.json`,
- das TLS-Zertifikat und den Schlüssel,
- `config/mirrors/` mit den Schlüsseln der Spiegel,
- `config/hub.json` und `github-token.txt`, wenn Sie sie verwenden.

Eine Wiederherstellung erstellt eine neue Instanz mit ihren eigenen Einstellungen und ihrer eigenen Schlüsseldatei. Nach einer Wiederherstellung sind Sitzungen weg, persönliche Token und Dienstschlüssel sind widerrufen, und Bereinigungs- und Aufbewahrungsrichtlinien sind aus. Geben Sie neue Schlüssel aus und schalten Sie die Richtlinien bewusst wieder ein. Passwörter kehren so zurück, wie sie zum Snapshot-Zeitpunkt waren. Behandeln Sie jede Kopie dieser Dateien als Geheimnis. Siehe [Backups](./backups).

## Eine Schwachstelle melden {#vulnerabilities}

Beschreiben Sie eine Schwachstelle nicht und veröffentlichen Sie keine Schlüssel in einem öffentlichen Issue. Der Besitzer des Projekts ist Ian Panaev (GitHub-Konto `ProAnima`). Das Projekt hat noch keinen eigenen privaten Kanal für Sicherheitsmeldungen veröffentlicht. Senden Sie eine kurze Nachricht ohne Exploit-Details über das GitHub-Konto des Projekts oder an die Studio-Adresse, die die Konsole anzeigt, `info@proanima.net`, und bitten Sie um einen privaten Weg zur Fortsetzung. Siehe `SECURITY.md` im Repository.

## Verwandte Seiten {#related-pages}

- [Monitoring](./monitoring)
- [Selbstheilung](./self-healing)
- [Konten und Zugriff](../use/accounts)
- [HTTPS und Reverse-Proxy](../install/https)
- [Authentifizierung](../api/authentication)
- [Fehler](../api/errors)
