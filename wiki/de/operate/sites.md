---
title: Standorte
description: Alle Installationen Ihres Clusters an einem Ort sehen, Standorte mit einem Einmalcode koppeln und ihren Zustand verfolgen.
---

# Standorte

Ein **Standort** ist eine Arkvory-Installation: die Hauptinstallation, ein Spiegel an einem anderen Ort, eine Installation, die Versionen aus einer anderen importiert. Auf [[ui:fleet]] zeigt eine Installation, der **Controller**, jeden Standort, den er verwaltet: ob er antwortet, seine Version, seine HA-Kopien und Lese-Gateways, seine Spiegel und wie weit sie zurückliegen, und seine Download-Warteschlange. Nur globale Administratoren sehen die Seite.

## Zustand des Clusters {#overview}

Die Seite beginnt mit [[ui:fleetOverview]]: was an den Standorten Aufmerksamkeit braucht und welcher Standort welchen speist. Der Controller erstellt diesen Überblick aus dem letzten Lesen der Standorte, höchstens alle 5 Sekunden, und führt sich selbst als „dieser Standort“.

### Alarme {#alerts}

Jeder Alarm nennt den Standort und das Problem. Die schwersten stehen oben: [[ui:fleetSeverityCritical]], dann [[ui:fleetSeverityWarning]], dann [[ui:fleetSeverityInfo]]. Braucht nichts Aufmerksamkeit, sagt die Liste das.

| Alarm                                       | Schweregrad                  | Wann                                                                                                                      | Was tun                                                                                  |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Nicht erreichbar                            | [[ui:fleetSeverityCritical]] | 2 Minuten keine Antwort. Ein einzelnes fehlgeschlagenes Lesen ist kein Alarm                                              | Standort und Netz prüfen                                                                 |
| Zertifikat, widerrufen, abgelehnt, ungültig | [[ui:fleetSeverityCritical]] | Sofort, mit dem [Zustand](#states) gleichen Namens                                                                        | Neu koppeln oder beide Installationen aktualisieren                                      |
| Veraltet                                    | [[ui:fleetSeverityWarning]]  | Der Standort hat geantwortet, wurde aber über 90 Sekunden nicht gelesen: das Lesen im Hintergrund des Controllers hängt   | Den API-Prozess des Controllers prüfen                                                   |
| Nicht beschreibbar                          | [[ui:fleetSeverityCritical]] | Ein Schreibprozess lehnt Schreibvorgänge ab, ohne auszulaufen                                                             | Seine Datenbank und seinen Datenträger prüfen                                            |
| Kopien                                      | [[ui:fleetSeverityCritical]] | Einem HA-Standort fehlen Kopien seiner Daten; Schreibvorgänge pausieren, bis sie zurück sind                              | Den fehlenden Knoten zurückholen, siehe [Hochverfügbarkeits-Cluster](./cluster#failures) |
| Einzelne Kopie                              | [[ui:fleetSeverityWarning]]  | Kopien fehlen, aber ein Operator hat [eine Kopie](./cluster#single-copy) bis zu einem Zeitpunkt akzeptiert                | Den fehlenden Knoten vor diesem Zeitpunkt zurückholen                                    |
| Spiegel fehlerhaft                          | [[ui:fleetSeverityWarning]]  | Die letzte Synchronisation eines Spiegels ist fehlgeschlagen. Erneutes Lesen einer wiederhergestellten Quelle zählt nicht | Den [Fehlercode](./mirrors#error-codes) des Spiegels lesen                               |
| Spiegel im Rückstand                        | [[ui:fleetSeverityWarning]]  | Ein Spiegel liegt `ARKVORY_FLEET_LAG_ALERT` Änderungen (standardmäßig 1000) oder mehr hinter seiner Quelle                | Quelle, Netz und Spiegel prüfen                                                          |
| Updates fehlgeschlagen                      | [[ui:fleetSeverityWarning]]  | Der Updater des Standorts meldet einen Fehler                                                                             | [[ui:updates]] in den [Einstellungen des Standorts](#site-settings) öffnen               |
| Andere Version                              | [[ui:fleetSeverityInfo]]     | Auf dem Standort läuft eine andere Version als auf dem Controller                                                         | Die Standorte auf dieselbe Version aktualisieren                                         |

### Verbindungen {#map}

[[ui:fleetMap]] zeigt, welcher Standort welchen speist. Jeder Spiegel und jeder Import ist ein Pfeil vom Quellstandort zum Standort, der den Spiegel hält.

- Eine Quelle, unter deren Adresse kein verwalteter Standort antwortet, erscheint mit ihrer Adresse und gestricheltem Rahmen. Ist diese Quelle der Controller selbst, setzen Sie `ARKVORY_SITE_URL`, siehe [Einstellungen](#settings).
- Eine fehlerhafte Verbindung ist rot gestrichelt.
- Die Zahl an einer Verbindung gibt an, um wie viele Änderungen der Spiegel hinter seiner Quelle liegt.

Unter der Karte listet eine Tabelle dieselben Angaben: [[ui:fleetLinkFrom]], [[ui:fleetLinkTo]], [[ui:fleetMirrorRepository]], [[ui:fleetMirrorSourceRepository]] und [[ui:fleetLinkBehind]].

Globale Administratoren des Controllers erhalten dieselben Alarme und Verbindungen über `GET /api/v1/fleet/overview` oder im SDK mit `client.fleet.overview()`. Für Prometheus exportiert der Controller den Zustand seiner Standorte und die Zahl der Alarme, siehe [Monitoring](./monitoring#metrics).

## So funktioniert es {#how-it-works}

- Der Controller führt eine Liste der Standorte. Er liest jeden Standort alle 30 Sekunden über HTTPS und behält die letzte Antwort, sodass ein Standort, der nicht mehr antwortet, seinen letzten bekannten Zustand weiter zeigt.
- Beim Koppeln gibt der Standort dem steuernden Standort einen eigenen Schlüssel, den **Flottenschlüssel**. Er reicht nur so weit, wie der steuernde Standort es braucht: den Zustand des Standorts, die Beschreibungen in seinem Katalog und die aufgeführten Änderungen: die Download-Warteschlange, Update-Anfragen sowie Spiegel- und HA-Änderungen für den Agenten des Standorts. Dateibytes herunterladen, in Repositorys schreiben oder Konten und Schlüssel lesen oder ändern kann er nicht.
- Der Controller bewahrt die Flottenschlüssel versiegelt mit einem Schlüssel in seinem Datenverzeichnis auf (`fleet.key`). Die Datenbank und ihre Sicherungen allein verraten sie nicht. Koppeln Sie die Standorte nach einer Wiederherstellung neu.
- Jeder Standort zeigt, welche Controller ihn verwalten, und kann sie jederzeit widerrufen.

## Standort koppeln {#pair}

1. Am Standort: Öffnen Sie [[ui:fleet]] und wählen Sie unter [[ui:fleetThisSite]] [[ui:fleetMakeCode]]. Der Standort zeigt einen Code, der zehn Minuten gilt, und bei eingebautem HTTPS den Fingerabdruck seines Zertifikats.
2. Am Controller: Öffnen Sie [[ui:fleet]], geben Sie unter [[ui:fleetAdd]] die Adresse des Standorts ein und wählen Sie [[ui:fleetCheck]]. Der Controller verbindet sich und zeigt den Fingerabdruck des erhaltenen Zertifikats.
3. Vergleichen Sie die beiden Fingerabdrücke. Sie müssen gleich sein. Unterscheiden sie sich, ist die Adresse falsch oder etwas steht zwischen den Installationen: koppeln Sie nicht.
4. Geben Sie den Code ein und wählen Sie [[ui:fleetPair]]. Der Standort erscheint mit seinem Zustand in der Liste.

Ein Code gilt einmal. Ein verwendeter oder abgelaufener Code wird abgelehnt: erstellen Sie einen neuen.

Die Adresse ist die HTTPS-Adresse der API des Standorts, zum Beispiel `https://branch.example:8443`. Einfaches HTTP wird nur auf demselben Computer akzeptiert (`127.0.0.1`). Endet TLS an einem Proxy vor dem Standort, kann der Standort das Zertifikat des Proxys nicht zeigen: vergleichen Sie mit dem SHA-256-Fingerabdruck, den Ihr Browser für die Adresse des Standorts zeigt.

Danach vertraut der Controller genau diesem Zertifikat. Bekommt der Standort ein neues Zertifikat, zeigt er [[ui:fleetStateCertificate]]: entfernen Sie den Standort und koppeln Sie ihn neu.

## Zustände {#states}

| Zustand                      | Bedeutung                                                        | Was tun                                                               |
| ---------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| [[ui:fleetStateOk]]          | Der Standort hat beim letzten Lesen geantwortet                  | Nichts                                                                |
| [[ui:fleetStatePending]]     | Der Standort wurde noch nicht gelesen                            | Auf das nächste Lesen warten oder [[ui:fleetReadSite]] wählen         |
| [[ui:fleetStateUnreachable]] | Keine Antwort: Standort angehalten oder Netz gestört             | Standort und Netz prüfen. Der letzte bekannte Zustand bleibt sichtbar |
| [[ui:fleetStateCertificate]] | Der Standort zeigt ein anderes Zertifikat als das bestätigte     | Wurde das Zertifikat erneuert, Standort entfernen und neu koppeln     |
| [[ui:fleetStateRevoked]]     | Der Administrator des Standorts hat diesen Controller widerrufen | Mit einem neuen Code neu koppeln                                      |
| [[ui:fleetStateInvalid]]     | Der Standort antwortete so, dass diese Version es nicht versteht | Beide Installationen auf dieselbe Version aktualisieren               |
| [[ui:fleetStateRefused]]     | Der Standort hat die Anfrage abgelehnt                           | Mit einem neuen Code neu koppeln                                      |

## Was die Liste zeigt {#list}

- **[[ui:fleetVersion]]**: die Version des Standorts und seine Rolle, Schreiben oder Lese-Gateway.
- **[[ui:fleetCopies]]**: in einem HA-Cluster die vollständigen Kopien und wie viele ein Schreibvorgang braucht; die Lese-Gateways, die ihren Slot halten.
- **[[ui:fleetMirrors]]**: die Spiegel und Importe des Standorts; um wie viele Änderungen der am weitesten zurückliegende hinter seiner Quelle liegt, oder wie viele angehalten sind.
- **[[ui:fleetQueue]]**: laufende Downloads und Downloads, die in der Warteschlange warten.
- **[[ui:fleetSeen]]**: wann der Standort zuletzt geantwortet hat.

[[ui:fleetReadAll]] liest alle Standorte sofort, statt auf die nächste Runde zu warten. [[ui:fleetRemoveSite]] vergisst einen Standort hier; widerrufen Sie den Controller auch am Standort, denn bis dahin bleibt sein Schlüssel dort gültig.

## Inhalt eines Standorts {#content}

[[ui:fleetContent]] in der Zeile eines Standorts öffnet unter der Liste seine Repositorys, Artefakte und Dateien. Wählen Sie ein Repository; [[ui:fleetFind]] sucht Artefakte nach Name oder Label und listet Dateien, deren Pfad mit dem Eingegebenen beginnt. [[ui:fleetMore]] liest die nächste Seite.

Der steuernde Standort liest dies mit seinem Flottenschlüssel auf dem Standort und zeigt die Antwort so, wie der Standort sie gegeben hat. Nur Beschreibungen werden übertragen: Namen, Größen, Labels, Stufen, Pfade und Revisionen. Um eine Datei herunterzuladen, verwenden Sie den Standort selbst.

## Einstellungen eines Standorts {#site-settings}

[[ui:fleetSettings]] in der Zeile eines Standorts öffnet unter der Liste seine Einstellungen; [[ui:fleetThisSettings]] öffnet dieselbe Karte für diesen Standort. Die Karte hat drei Teile:

- **[[ui:fleetQueueSettings]]**: wie viele Downloads gleichzeitig laufen, für Menschen reservierte Plätze, die Strategie, die Gewichte der Klassen und die übrigen Werte der Warteschlange aus der [Verkehrssteuerung](../reference/environment#transfers-and-bandwidth). Ein leeres Feld behält den Wert aus der Umgebung des Standorts, grau angezeigt. [[ui:fleetQueueSave]] wendet die Werte sofort an, ohne Neustart: neue Entscheidungen folgen ihnen, aktive Downloads behalten ihre Plätze. [[ui:fleetQueueReset]] kehrt zur Umgebung zurück.
- **[[ui:updates]]**: installierte und neueste Version, automatische Installation und Wartungsstunde, [[ui:updateCheck]] und [[ui:updateInstall]]. Der Updater des Standorts übernimmt eine Anfrage innerhalb einer Minute; bis dahin zeigt die Karte sie als angenommen.
- **[[ui:fleetAgent]]**: die Spiegel und Importe des Standorts mit [[ui:fleetMirrorKeySave]] und [[ui:fleetMirrorDetach]], [[ui:fleetMirrorAttach]] mit dem Quellschlüssel und in einem HA-Cluster [[ui:fleetSwitchover]] auf einen Knoten mit vollständiger Kopie (Knotenname zweimal eingegeben) sowie die Entscheidung für eine Kopie. Der Agent des Standorts wendet jede Anfrage innerhalb einer Minute mit den Prüfungen und dem Rollback von `arkvory configure` und `cluster-*` an; [[ui:fleetRequests]] zeigt, wie jede endete. Der Quellschlüssel geht einmal in einer eigenen Datei an den Agenten und wird nie wieder angezeigt. Der Agent ist der Updater des Standorts: verbinden Sie ihn mit `updates-connect`.

Jede Änderung trägt die Revision, von der sie ausgeht. Hat jemand die Einstellungen inzwischen geändert, lehnt der Standort die Änderung ab und die Karte zeigt die aktuellen Werte: prüfen und erneut speichern. Der Standort hält fest, wer seine Warteschlange geändert hat: den Schlüssel des steuernden Standorts und den Namen seines Administrators.

Vom steuernden Standort aus wird ein Spiegel oder Import nur als neues Repository angebunden, und das Zertifikat der Zertifizierungsstelle einer Quelle wird am Standort selbst gesetzt (`arkvory configure --mirror-ca-file`): Was ein Standort vertraut, ändert sich nie aus der Ferne. Die Anfrageliste zeigt als Code, wie jede Änderung endete; die eigenen Worte des Agenten bleiben in seinem Protokoll am Standort. Wurde eine Änderung auf halbem Weg unterbrochen, übernimmt der Agent keine andere, bis ein Administrator des Standorts ihn geprüft und dort `arkvory changes-reset --root <Wurzel>` ausgeführt hat.

## Wer diesen Standort verwaltet {#managed-by}

Unter [[ui:fleetThisSite]] listet jeder Standort die Controller, die ihn verwalten: Name, wer sie gekoppelt hat, wann, und ihre letzte Anfrage. [[ui:fleetRevoke]] lehnt den Schlüssel des Controllers sofort ab.

## Einstellungen {#settings}

| Variable                  | Standard                        | Bedeutung                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_SITE_NAME`       | der Hostname                    | Wie diese Installation auf anderen Standorten heißt                                                                                                                                                                         |
| `ARKVORY_FLEET_KEY_FILE`  | `fleet.key` im Datenverzeichnis | Der Schlüssel, der die Schlüssel verwalteter Standorte versiegelt; beim ersten Start des Schreibprozesses erstellt                                                                                                          |
| `ARKVORY_SITE_URL`        | nicht gesetzt                   | Die Adresse `https://host[:port]`, unter der andere Standorte diese Installation erreichen. Damit führen Spiegel, deren Quelle diese Installation ist, auf [[ui:fleetMap]] zu ihr. Ein ungültiger Wert verhindert den Start |
| `ARKVORY_FLEET_LAG_ALERT` | `1000`                          | Ab wie vielen Änderungen Rückstand zur Quelle ein Spiegel eines verwalteten Standorts alarmiert; ganze Zahl, 1 oder mehr                                                                                                    |

## Grenzen {#limits}

- Fencing-Tests und das Hinzufügen oder Entfernen von Clusterknoten bleiben lokale Befehle auf den Knoten. Lese-Gateways behalten die Download-Warteschlange ihrer Umgebung.
- Ein Controller verwaltet bis zu 256 Standorte und liest höchstens acht gleichzeitig.
- Der Controller hält einen Schlüssel zu jedem verwalteten Standort: schützen Sie seine globalen Administratoren und sein Datenverzeichnis so sorgfältig wie die Standorte selbst.
