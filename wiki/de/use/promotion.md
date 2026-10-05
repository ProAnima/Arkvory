---
title: Stufen und Hochstufung
description: 'Markieren Sie Builds mit Stufen, stufen Sie sie in ein anderes Repository hoch und lassen Sie einen Deployment-Agent den neuesten Build einer Stufe auswählen.'
---

# Stufen und Hochstufung

Ein Build geht in Schritten von CI nach Produktion: getestet, freigegeben, veröffentlicht. Arkvory hat zwei Werkzeuge dafür. Eine **Stufe** ist eine Markierung an einem Build, etwa `qa` oder `release`. Eine **Hochstufung** veröffentlicht einen Build in einem anderen Repository, ohne die Bytes erneut zu senden. Verwenden Sie eines von beiden oder beide zusammen.

## Stufen und Repositorys {#concepts}

- Eine **Stufe** sagt, wo ein Build freigegeben ist. Ein Build kann mehrere Stufen haben, bis zu 16. Stufen gehören zu einem Build in einem Repository. Nur die Stufen-Vorgänge ändern sie, und jede Änderung geht mit dem Autor und einem optionalen Kommentar in ein Journal.
- Eine **Hochstufung** kopiert oder verschiebt einen Build von einem Repository in ein anderes, zum Beispiel von `dev` nach `staging` nach `prod`. Die Kopie ist ein neues Artefakt im Ziel. Es werden keine Bytes hochgeladen.
- Ein **Label** ist nur ein freies Tag ohne Verlauf. Eine Stufe ist die kontrollierte Markierung, auf die sich ein Deployment verlassen kann. Siehe [Dateien nach Pfad](./files#labels).

Ein Stufenname hat 1 bis 32 Zeichen: Kleinbuchstaben, Ziffern, `.`, `_` oder `-`, beginnend mit einem Buchstaben oder einer Ziffer. Ein Build mit einer Stufe kann nicht gelöscht werden, und die Aufbewahrung behält ihn. Entfernen Sie zuerst die Stufe.

## Stufen hinzufügen und entfernen {#stages}

Öffnen Sie in der Konsole das Artefakt in [[ui:metadata]]. Der Bereich [[ui:promotionTitle]] zeigt [[ui:stagesTitle]] mit den Stufen des Builds. Geben Sie einen [[ui:stageName]] und, wenn Sie möchten, einen [[ui:stageComment]] ein, und wählen Sie dann [[ui:stageAdd]]. Jede Stufe hat eine Schaltfläche zum Entfernen, und die Konsole bittet um Bestätigung: Deployments, die diese Stufe anfragen, wählen eine andere Version.

Die Stufen erscheinen auch im Katalog als Chips in jeder Zeile und in der Spalte [[ui:packageStages]] von [[ui:packages]].

```bash
arkvoryctl stages add 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --comment "smoke passed" --repository dev
arkvoryctl stages list 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository dev
arkvoryctl stages remove 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --repository dev
arkvoryctl stages artifacts --stage release --repository prod
```

`stages artifacts` listet jeden Build mit einer Stufe, oder eine Stufe, je 100. Übergeben Sie `next` als `--after`.

Mit der API:

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

Die Vorgänge sind `setArtifactStage`, `removeArtifactStage`, `listArtifactStages` und `listStagedArtifacts`. Das Hinzufügen einer bereits vorhandenen Stufe ändert nichts: Die erste Zeit und der erste Kommentar bleiben. Das Entfernen einer nicht vorhandenen Stufe gelingt. Ein Build mit 16 Stufen lehnt eine weitere mit `409 stage_limit` ab.

## In ein anderes Repository hochstufen {#promote}

Öffnen Sie in der Konsole das Artefakt. Das Formular [[ui:promoteTitle]] erscheint, wenn Sie den Build lesen dürfen und in mindestens ein anderes Repository hochstufen dürfen. Wählen Sie das [[ui:promoteTarget]] aus diesen Repositorys. Geben Sie die [[ui:promoteStages]] ein, die im Ziel gesetzt werden sollen, durch Kommas getrennt, und einen [[ui:promoteComment]]. Wählen Sie [[ui:promoteSubmit]]. Erlaubt es kein anderes Repository, zeigt die Konsole [[ui:promoteNoTargets]].

```bash
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --move
```

`--repository` ist die Quelle, `--to` das Ziel. Das Ergebnis enthält das Ziel-`repository`, die neue `artifactId`, die `sourceArtifactId`, den `mode`, `created` und die `stages`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}'
```

```typescript
await staging.promotions.promote(id, { target: 'prod', mode: 'copy', stages: ['release'] });
```

Die Antwort ist `201` für eine neue Kopie und `200`, wenn das Ziel sie bereits hatte. Der Vorgang ist `promoteArtifact`.

### Kopieren oder verschieben {#copy-move}

|                   | Kopieren (Standard)   | Verschieben                                                                                                                           |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Quelle            | Bleibt                | Wird im selben Schritt entfernt, in dem die Kopie veröffentlicht wird                                                                 |
| Stufen der Quelle | Bleiben an der Quelle | Gehen auf die Kopie über, zusätzlich zu den Stufen, die Sie angeben                                                                   |
| In der Konsole    |                       | Kreuzen Sie [[ui:promoteMove]] an. Die Konsole bittet um Bestätigung                                                                  |
| Blockiert, wenn   |                       | Die Quelle noch von einer externen Referenz, einem Dateipfad oder einer Anhangsverknüpfung verwendet wird. Nichts wird veröffentlicht |

Was die Kopie erhält und was nicht:

- Sie erhält die Labels, Metadaten und Sammlungen der Quelle, ihre UPack-Identität und die Stufen, die Sie angeben. Sie ist ein neues Artefakt mit neuer ID. Ihr SHA-256 ist derselbe.
- Sie erhält keine Anhänge und keine Pfadzeiger. Verknüpfen Sie sie im Ziel erneut.
- Es werden keine Bytes hochgeladen. Auf demselben Server wird die gespeicherte Datei geteilt, bis das letzte Artefakt, das sie verwendet, verschwunden ist.
- Sie zählt wie ein neuer Upload gegen das Kontingent des Ziels.
- Eine wiederholte Hochstufung gibt dieselbe Kopie zurück. Hat das Ziel bereits ein Paket mit derselben Gruppe, demselben Namen, derselben Version und derselben Prüfsumme, wird dieses Artefakt zurückgegeben. Bei anderen Bytes antwortet der Server mit `409 version_exists`.
- Das Ziel muss sich von der Quelle unterscheiden. Ein Spiegel kann kein Ziel sein, weil er schreibgeschützt ist. Siehe [Repositorys](./repositories#read-only).

Eine unterbrochene Hochstufung hinterlässt eine kurzlebige Reservierung. Führen Sie dieselbe Hochstufung als dasselbe Konto erneut aus, um fortzufahren.

## Hochstufungsverlauf {#history}

Die Artefaktseite in der Konsole zeigt [[ui:promotionHistory]], älteste zuerst: wer eine Stufe hinzugefügt oder entfernt hat, wer den Build in ein anderes Repository kopiert oder verschoben hat und woher eine empfangene Kopie stammt. [[ui:promotionMore]] lädt die nächsten Einträge.

```bash
arkvoryctl promotions history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository prod
arkvoryctl promotions journal --repository prod --after 120 --json
```

Das Journal eines Repositorys ist für CI. Fragen Sie es mit der letzten `sequence`, die Sie gesehen haben, als `--after` ab, und Sie erhalten die neuen Ereignisse der Reihe nach. Ein Ereignis hat eine `sequence`, die `action` (`stage.added`, `stage.removed`, `promoted` oder `received`), die `stage`, den `mode`, das Peer-Repository und -Artefakt, den `actor`, den `comment` und die Zeit. Seiten enthalten bis zu 100 Ereignisse. Die Vorgänge sind `listArtifactPromotions` und `listRepositoryPromotions`.

## Einen Build für das Deployment auswählen {#resolve}

Ein Deployment-Agent fragt nach „dem neuesten Build des Pakets `app`, das im Bereich `^1.4` liegt und die Stufe `release` hat“. Arkvory antwortet mit genau einer Version oder mit `404`, wenn es keine gibt.

```bash
arkvoryctl packages resolve app --group acme/game --range ^1.4 --stage release --repository prod --json
arkvoryctl packages download app ./app.upack --group acme/game --range ^1.4 --stage release --repository prod
```

`resolve` gibt die Auswahl aus, ohne sie herunterzuladen:

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

Mit HTTP gibt `resolvePackage` dies zurück, und `downloadPackageContent` sendet die Bytes derselben Auswahl in einem Aufruf:

```bash
curl -fL -G -H "Authorization: Bearer $DEPLOY_KEY" -o app.upack \
  --data-urlencode "name=app" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

```typescript
const found = await prod.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
```

Die Filter sind in jedem Werkzeug dieselben: der Paket-`name`, die `group` (leer, wenn das Paket keine hat), eine exakte Version oder ein Bereich, die `stage`, ob Vorabversionen eingeschlossen werden, und die Reihenfolge. Bereiche werden in [UPack-Pakete](./packages#versions) erklärt.

Standardmäßig gewinnt die neueste SemVer-Version. Mit `--order promoted` (`order=promoted` in HTTP) gewinnt die zuletzt hochgestufte Version, auch wenn ihre Nummer niedriger ist. Dafür ist eine Stufe nötig.

Der Name wird bei jeder Anfrage aufgelöst, daher können zwei Aufrufe verschiedene Builds zurückgeben, wenn jemand dazwischen hochstuft. Nehmen Sie für einen Download, der fortgesetzt werden muss, die `artifactId` aus `resolve` und laden Sie diese herunter.

## Zurücksetzen {#rollback}

Mit der Reihenfolge `promoted` ist ein Rollback ein gewöhnlicher Schritt. Entfernen Sie die Stufe von der fehlerhaften Version, und die davor hochgestufte Version wird zur Auswahl. Um eine ältere Version wieder aktuell zu machen, entfernen Sie ihre Stufe und fügen Sie sie erneut hinzu: Das Hinzufügen einer bereits vorhandenen Stufe erneuert ihre Zeit nicht.

```bash
arkvoryctl stages remove <faulty artifact id> release --repository prod
arkvoryctl packages download app ./app.upack --stage release --order promoted --repository prod
```

## Berechtigungen {#permissions}

| Aktion                                        | Schlüssel: Repository-Aktionen                                       | Personen: Gruppen-Zugriff              |
| --------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| Stufen und den Verlauf eines Builds lesen     | `artifact.read`                                                      | Lesen                                  |
| Hochgestufte Builds und das Journal auflisten | `artifact.list`                                                      | Lesen                                  |
| Eine Stufe hinzufügen oder entfernen          | `artifact.promote` mit `artifact.read`                               | Schreiben                              |
| Mit Kopieren hochstufen                       | Quelle: `artifact.read` und `content.read`. Ziel: `artifact.promote` | Lesen an der Quelle, Schreiben am Ziel |
| Mit Verschieben hochstufen                    | Dasselbe, und `artifact.promote` an der Quelle                       | Schreiben an beiden                    |
| Eine Version auflösen                         | `package.read`                                                       | Lesen                                  |
| Die gewählte Version nach Namen herunterladen | `content.read`                                                       | Lesen                                  |

Ein Schlüssel für einen Deployment-Agent, der nur herunterlädt, braucht `content.read` im Repository, das er liest. Für `arkvoryctl packages download` braucht er außerdem `package.read` und `artifact.read`. Siehe [Berechtigungen](./accounts#permissions).

Server können Builds auch untereinander austauschen: Ein Repository kann aus einem Repository eines anderen Servers die Versionen importieren, die bestimmte Stufen tragen. Siehe [Spiegel](../operate/mirrors).

## Verwandte Seiten {#related-pages}

- [UPack-Pakete](./packages) und [Repositorys](./repositories)
- [Konten und Zugriff](./accounts)
- [Kommandozeile (arkvoryctl)](../protocols/cli#packages-and-promotion)
- API-Referenz: [Stufen und Hochstufung](../api/reference/promotion)
