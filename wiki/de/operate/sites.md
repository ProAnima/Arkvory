---
title: Standorte
description: Alle Installationen Ihres Clusters an einem Ort sehen, Standorte mit einem Einmalcode koppeln und ihren Zustand verfolgen.
---

# Standorte

Ein **Standort** ist eine Arkvory-Installation: die Hauptinstallation, ein Spiegel an einem anderen Ort, eine Installation, die Versionen aus einer anderen importiert. Auf [[ui:fleet]] zeigt eine Installation, der **Controller**, jeden Standort, den er verwaltet: ob er antwortet, seine Version, seine HA-Kopien und Lese-Gateways, seine Spiegel und wie weit sie zurückliegen, und seine Download-Warteschlange. Nur globale Administratoren sehen die Seite.

## So funktioniert es {#how-it-works}

- Der Controller führt eine Liste der Standorte. Er liest jeden Standort alle 30 Sekunden über HTTPS und behält die letzte Antwort, sodass ein Standort, der nicht mehr antwortet, seinen letzten bekannten Zustand weiter zeigt.
- Beim Koppeln gibt der Standort dem steuernden Standort einen eigenen Schlüssel, den **Flottenschlüssel**. Er reicht nur so weit, wie der steuernde Standort es braucht: den Zustand des Standorts, die Beschreibungen in seinem Katalog und zwei Einstellungen: die Download-Warteschlange und Update-Anfragen. Dateibytes herunterladen, in Repositorys schreiben oder Konten und Schlüssel lesen oder ändern kann er nicht.
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

[[ui:fleetSettings]] in der Zeile eines Standorts öffnet unter der Liste seine Einstellungen; [[ui:fleetThisSettings]] öffnet dieselbe Karte für diesen Standort. Die Karte hat zwei Teile:

- **[[ui:fleetQueueSettings]]**: wie viele Downloads gleichzeitig laufen, für Menschen reservierte Plätze, die Strategie, die Gewichte der Klassen und die übrigen Werte der Warteschlange aus der [Verkehrssteuerung](../reference/environment#transfers-and-bandwidth). Ein leeres Feld behält den Wert aus der Umgebung des Standorts, grau angezeigt. [[ui:fleetQueueSave]] wendet die Werte sofort an, ohne Neustart: neue Entscheidungen folgen ihnen, aktive Downloads behalten ihre Plätze. [[ui:fleetQueueReset]] kehrt zur Umgebung zurück.
- **[[ui:updates]]**: installierte und neueste Version, automatische Installation und Wartungsstunde, [[ui:updateCheck]] und [[ui:updateInstall]]. Der Updater des Standorts übernimmt eine Anfrage innerhalb einer Minute; bis dahin zeigt die Karte sie als angenommen.

Jede Änderung trägt die Revision, von der sie ausgeht. Hat jemand die Einstellungen inzwischen geändert, lehnt der Standort die Änderung ab und die Karte zeigt die aktuellen Werte: prüfen und erneut speichern. Der Standort hält fest, wer seine Warteschlange geändert hat: den Schlüssel des steuernden Standorts und den Namen seines Administrators.

## Wer diesen Standort verwaltet {#managed-by}

Unter [[ui:fleetThisSite]] listet jeder Standort die Controller, die ihn verwalten: Name, wer sie gekoppelt hat, wann, und ihre letzte Anfrage. [[ui:fleetRevoke]] lehnt den Schlüssel des Controllers sofort ab.

## Einstellungen {#settings}

| Variable                 | Standard                        | Bedeutung                                                                                                          |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_SITE_NAME`      | der Hostname                    | Wie diese Installation auf anderen Standorten heißt                                                                |
| `ARKVORY_FLEET_KEY_FILE` | `fleet.key` im Datenverzeichnis | Der Schlüssel, der die Schlüssel verwalteter Standorte versiegelt; beim ersten Start des Schreibprozesses erstellt |

## Grenzen {#limits}

- Spiegel und HA werden weiterhin an jedem Standort eingerichtet, in seiner Konsole oder mit `arkvory configure`; sie vom Controller aus zu ändern, folgt als Nächstes. Lese-Gateways behalten die Download-Warteschlange ihrer Umgebung.
- Ein Controller verwaltet bis zu 256 Standorte und liest höchstens acht gleichzeitig.
- Der Controller hält einen Schlüssel zu jedem verwalteten Standort: schützen Sie seine globalen Administratoren und sein Datenverzeichnis so sorgfältig wie die Standorte selbst.
