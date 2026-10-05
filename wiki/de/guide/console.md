---
title: Die Webkonsole
---

# Die Webkonsole

Die Webkonsole ist die Browseroberfläche von Arkvory. Sie ist Teil des Servers, Sie installieren sie also nicht separat. Öffnen Sie `/console/` unter Ihrer Serveradresse, zum Beispiel `http://127.0.0.1:8080/console/` auf dem Server selbst oder `https://arkvory.example/console/`, nachdem Sie [HTTPS](../install/https) eingerichtet haben.

Die Konsole verwendet dieselbe HTTP-API wie der [Kommandozeilen-Client](../protocols/cli) und das [SDK](../protocols/sdk). Der Server prüft jede Anfrage. Ist eine Schaltfläche ausgeblendet, bedeutet das nur, dass Ihr Konto oder Ihr Schlüssel diesen Vorgang nicht verwenden kann.

## Aufbau {#layout}

Die Seitenleiste gruppiert die Bereiche. Auf einem schmalen Bildschirm wird die Seitenleiste zur Schaltfläche [[ui:navigationMenu]].

| Gruppe              | Bereiche                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [[ui:navLibrary]]   | [[ui:catalog]], [[ui:packages]], [[ui:history]], [[ui:metadata]]                                                          |
| [[ui:navTransfers]] | [[ui:upload]], [[ui:downloads]]                                                                                           |
| [[ui:navResources]] | [[ui:administration]], [[ui:repositories]], [[ui:services]], [[ui:updates]], [[ui:backups]], [[ui:navStart]], [[ui:help]] |

Die obere Leiste zeigt den Titel des Bereichs, die Schaltflächen [[ui:uploadFile]] und [[ui:reportOpen]] sowie die Steuerelemente für Darstellung und Sprache.

Jeder Bereich hat eine eigene Adresse, zum Beispiel `#/catalog`, `#/packages` oder `#/backups`. Ein geöffnetes Artefakt hat die Adresse `#/artifact/<repository>/<id>`. Sie können diese Adressen als Lesezeichen speichern und an andere weitergeben. Die Adresse enthält nie ein Passwort, einen Schlüssel oder einen Suchtext. Öffnen Sie einen Link, bevor Sie angemeldet sind, öffnet die Konsole ihn nach der Anmeldung.

Einige Bereiche erscheinen nur für bestimmte Benutzer:

| Bereich               | Wer ihn sieht                                                                  |
| --------------------- | ------------------------------------------------------------------------------ |
| [[ui:administration]] | Administratoren                                                                |
| [[ui:repositories]]   | Alle angemeldeten Benutzer                                                     |
| [[ui:services]]       | Der Wiederherstellungsschlüssel und Operator-Schlüssel mit delegierten Rechten |
| [[ui:updates]]        | Administratoren                                                                |
| [[ui:backups]]        | Administratoren und der Wiederherstellungsschlüssel                            |

## Anmelden {#signing-in}

Die Karte [[ui:connection]] befindet sich oben auf der Seite.

1. Füllen Sie die Felder [[ui:accountName]] und [[ui:password]] aus.
2. Wählen Sie [[ui:signIn]]. Eine Sitzung dauert 12 Stunden.
3. Die Konsole wählt im Feld [[ui:repository]] das erste Repository, das Sie lesen dürfen. Um in einem anderen Repository zu arbeiten, geben Sie seinen Namen ein oder wählen Sie es aus der Liste.

Um sich statt mit einem Passwort mit einem Schlüssel zu verbinden, öffnen Sie [[ui:keySignIn]], fügen Sie den Schlüssel ein und wählen Sie [[ui:connect]]. Der Schlüssel bleibt im Speicher dieses Browser-Tabs. Die Konsole speichert ihn nie.

Die Schaltfläche [[ui:signUp]] erscheint nur, wenn der Administrator die Selbstregistrierung erlaubt. Mit [[ui:disconnect]] beenden Sie die Verbindung.

Nach der Anmeldung mit einem Passwort können Sie [[ui:changeOwnPassword]] und [[ui:personalAccessTokens]] nutzen. Ein persönliches Zugriffstoken ist ein Schlüssel für Ihre eigenen Tools. Siehe [Konten und Zugriff](../use/accounts).

### Der erste Besitzer {#the-first-owner}

Eine neue Installation hat keine Konten. Unter Windows erstellt das Setup den Besitzer. Bei anderen Installationen erstellen Sie den Besitzer in der Konsole:

1. Öffnen Sie [[ui:navStart]] und erweitern Sie [[ui:welcomeOwner]].
2. Fügen Sie den Wiederherstellungsschlüssel aus `config/bootstrap-token.txt` im Installationsverzeichnis ein.
3. Geben Sie einen Namen und ein Passwort mit mindestens 12 Zeichen ein und wählen Sie dann [[ui:welcomeCreate]].
4. Melden Sie sich mit dem neuen Namen und Passwort an.

Das Formular funktioniert nur, solange es keine Konten gibt. Der Besitzer ist ein Administrator. Außerdem erhält der Besitzer über die Gruppe `arkvory-owners` Schreibzugriff auf das Repository `releases`.

## Bibliothek {#library}

### Artefakte {#artifacts}

Der Bereich [[ui:catalog]] listet die veröffentlichten Dateien des Repositorys auf. Suchen Sie nach dem Namen oder nach einem Metadatenwert. Mit [[ui:labelFilter]] zeigen Sie ein einzelnes Label an, mit [[ui:metadataFilter]] einen exakten Schlüssel mit Wert. Jede Zeile zeigt Name, Größe, Veröffentlichungszeit, Stufen und Labels. Wählen Sie [[ui:download]], um eine Datei herunterzuladen, oder [[ui:open]], um ihre Details zu sehen. [[ui:more]] zeigt die nächste Seite.

### Pakete {#packages}

Der Bereich [[ui:packages]] listet registrierte UPack-Versionen auf. Filtern Sie nach [[ui:packageGroup]] und [[ui:packageName]], legen Sie [[ui:sortBy]] und [[ui:groupBy]] fest und wählen Sie dann [[ui:apply]]. Die Stufenspalte zeigt, wohin jede Version hochgestuft wurde. Siehe [Pakete](../use/packages).

### Dateiverlauf {#file-history}

Ein Dateipfad wie `builds/game/1.4/GameSetup.exe` kann viele Male auf neuen Inhalt verweisen. Jede Änderung ist eine neue Version. Geben Sie in [[ui:history]] einen Pfad ein und wählen Sie [[ui:historyLoad]]. Sie sehen jede Version mit Autor und Zeit. Sie können jede Version öffnen, um ihren ursprünglichen Inhalt herunterzuladen. Das Wiederherstellen einer alten Version erzeugt eine neue Version; es wird nichts gelöscht. Siehe [Dateien und Pfade](../use/files).

### Artefaktdetails {#artifact-details}

Der Bereich [[ui:metadata]] zeigt ein einzelnes Artefakt:

- **Übersicht**: [[ui:summarySize]], [[ui:summaryCreated]] und [[ui:summaryHash]] mit der Schaltfläche [[ui:copyHash]].
- **Eigenschaften**: [[ui:labels]], [[ui:collections]] und [[ui:metadataFields]]. Wählen Sie [[ui:save]], um sie zu speichern. Die Datei selbst ändert sich nicht.
- **Aktionen**: [[ui:download]]; [[ui:downloadLink]] erstellt einen Link, der eine Stunde lang ohne Schlüssel funktioniert; [[ui:register]] indiziert ein UPack-Archiv.
- [[ui:assetTitle]]: [[ui:assign]] macht dieses Artefakt zum aktuellen Inhalt eines Dateipfads.
- [[ui:promotionTitle]]: [[ui:stageAdd]] markiert das Artefakt mit einer Stufe, etwa `qa` oder `release`. [[ui:promoteSubmit]] veröffentlicht es in einem anderen Repository. Siehe [Hochstufung](../use/promotion).
- [[ui:attachmentsTitle]]: [[ui:attachmentAdd]] verknüpft ein Manifest, ein SBOM, eine Signatur, einen Bericht oder eine andere Datei mit diesem Build. [[ui:attachmentHistory]] zeigt frühere Stände.
- [[ui:deletionTitle]]: [[ui:deletionInspect]] zeigt, was das Artefakt noch verwendet. Zum Löschen fügen Sie die Artefakt-ID ein und wählen [[ui:deletionSubmit]].

## Übertragungen {#transfers}

### Upload {#upload}

Wählen Sie in [[ui:upload]] eine Datei aus und dann [[ui:startUpload]]. Die Konsole berechnet zuerst den SHA-256-Wert der Datei und sendet sie dann in Teilen. Mit [[ui:pause]] halten Sie die Übertragung an; die bereits hochgeladenen Teile bleiben erhalten.

Um später fortzufahren, bewahren Sie die Upload-ID auf. Öffnen Sie [[ui:resumeTitle]], wählen Sie dieselbe Datei und geben Sie die [[ui:uploadId]] ein. Der Browser warnt Sie, bevor Sie die Seite während eines Uploads verlassen. Siehe [Übertragungen](../use/transfers).

### Downloads {#downloads}

[[ui:downloads]] ist eine Warteschlange der Dateien, die Sie aus der Konsole herunterladen. Die Konsole prüft den SHA-256-Wert jeder Datei, bevor sie die endgültige Datei speichert.

- [[ui:downloadSettings]] legt [[ui:downloadConcurrency]] (1 bis 8), [[ui:downloadInterval]] und [[ui:downloadWait]] fest.
- [[ui:downloadsPause]], [[ui:downloadsResume]], [[ui:downloadsClearWaiting]], [[ui:downloadsCancel]] und [[ui:downloadsClearFinished]] steuern die gesamte Warteschlange.
- Melden Sie sich nach dem Neuladen der Seite erneut an und wählen Sie [[ui:downloadRestore]]. Setzen Sie dann jede Datei fort und wählen Sie, wo sie gespeichert werden soll.

Große Downloads erfordern Chrome oder Edge auf einer sicheren Adresse (HTTPS oder der lokale Rechner). Temporäre Daten bleiben im privaten Speicher des Browsers.

## Ressourcen {#resources}

### Benutzer und Zugriff {#users-and-access}

Hier verwalten Administratoren Personen. [[ui:accountsHeading]] listet die Konten auf, [[ui:groupsHeading]] die Gruppen. Verwenden Sie [[ui:createUser]], [[ui:resetPassword]], [[ui:createGroup]] und [[ui:manageMembers]]. Geben Sie in [[ui:manageGrants]] einer Gruppe den Zugriff [[ui:read]] oder [[ui:write]] auf ein Repository, das Sie mit seinem Namen angeben. Ein Repository wird nicht in einem eigenen Schritt erstellt: Es existiert, sobald eine Berechtigung oder eine Dienstrichtlinie seinen Namen nennt.

### Repositorys {#repositories}

[[ui:repositories]] zeigt die Repositorys, die Sie sehen können, mit [[ui:repositoryRights]]. Jede Karte bietet [[ui:repositoryOpen]], [[ui:repositoryStorage]] (Kontingent, automatische Bereinigung und physische Bereinigung) und für Administratoren [[ui:repositoryAccess]]. Ein gespiegeltes Repository zeigt das Badge [[ui:mirrorBadge]]. Siehe [Repositorys](../use/repositories) und [Speicher](../operate/storage).

### Dienstzugriff {#service-access}

Hier erstellen Sie Konten für Tools und CI-Systeme. Um diesen Bereich zu sehen, verbinden Sie sich mit dem Wiederherstellungsschlüssel oder mit einem Operator-Schlüssel. Wählen Sie [[ui:serviceCreate]] und legen Sie dann [[ui:servicePolicy]] fest. [[ui:bindingRead]] und [[ui:bindingPublish]] füllen typische Berechtigungssätze aus.

Um einen Schlüssel auszustellen, öffnen Sie [[ui:serviceKeys]] und wählen Sie [[ui:keyIssue]]. Das Geheimnis wird nur einmal angezeigt. Kopieren Sie es, bestätigen Sie [[ui:keySaved]] und wählen Sie [[ui:keyActivate]]. Ein Schlüssel, der nicht aktiviert wird, läuft nach 15 Minuten ab. Mit [[ui:keyRotate]] ersetzen Sie einen Schlüssel, mit [[ui:keyRevoke]] widerrufen Sie ihn. Mit [[ui:delegations]] kann der Besitzer einem Operator eingeschränkte Verwaltungsrechte geben.

### Updates {#updates}

Der Bereich [[ui:updates]] zeigt [[ui:updateCurrent]] und [[ui:updateLatest]]. Wählen Sie [[ui:updateCheck]] oder [[ui:updateInstall]]. Aktivieren Sie in [[ui:updateSettings]] die Option [[ui:updateAutomatic]] und legen Sie die [[ui:updateHour]] fest. Siehe [Updates](../install/updates).

### Backups {#backups}

[[ui:backups]] zeigt, ob die Backups in Ordnung sind, das letzte Backup, den nächsten Lauf, den Backup-Agent und den Backup-Speicher. Wählen Sie [[ui:backupRun]], um ein Backup zu starten. [[ui:backupPoints]] listet Wiederherstellungspunkte auf; Sie können jedes Byte eines Punkts prüfen oder ihn anheften. [[ui:backupPlan]] legt die tägliche Uhrzeit, die Zeitzone und die Anzahl der aufzubewahrenden Punkte fest. Die Wiederherstellung erfolgt über einen Befehl auf dem Server. Siehe [Backups](../operate/backups).

### Erste Schritte und API-Referenz {#getting-started-and-api-reference}

[[ui:navStart]] zeigt die ersten Schritte für einen neuen Server. [[ui:help]] listet Beispielbefehle auf. [[ui:helpLoad]] zeigt die API-Vorgänge, die Ihr aktuelles Konto oder Ihr Schlüssel aufrufen kann.

## Feedback {#feedback}

Nach der Anmeldung sendet [[ui:reportOpen]] eine Nachricht über den Hub an ProAnimaStudio. Sie können bis zu 6 Bilder und eine E-Mail-Adresse für die Antwort hinzufügen. Administratoren können das Serverprotokoll anhängen. Wählen Sie [[ui:reportShow]], um genau zu sehen, was gesendet wird.

## Darstellung und Sprache {#appearance-and-language}

[[ui:theme]] bietet drei Optionen: [[ui:system]], [[ui:light]] und [[ui:dark]]. [[ui:language]] listet jede Sprache der Konsole unter ihrem eigenen Namen auf: English, Русский, Español, Français, Deutsch, Português, 中文, 日本語, 한국어, हिन्दी und العربية. Die Seite wechselt sofort, ohne Neuladen und ohne dass Ihre Eingaben verloren gehen; auf Arabisch wird sie von rechts nach links gelesen. Beim ersten Besuch richtet sich die Konsole nach den Sprachen des Browsers und greift sonst auf Englisch zurück. [[ui:helpDocs]] unter [[ui:help]] öffnet diese Dokumentation in der Sprache der Konsole. Der Browser speichert nur das Design und die Sprache, nichts über Ihr Konto oder Ihre Repositorys.

## Verwandte Seiten {#related-pages}

- [Schnellstart](./quick-start)
- [Konzepte](./concepts)
- [Konten und Zugriff](../use/accounts)
- [Fehlerbehebung](../operate/troubleshooting)
