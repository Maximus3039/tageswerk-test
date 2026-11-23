# Release-Checkliste Tageswerk 3.7.0

Stand: 23.11.2026. Branch: `modularisierung`. Öffentliche Pin **3.6.3**. Diese Checkliste ist die Ablaufsteuerung. Die **Datenbankmigration 02–05** ist am 23.11.2026 auf PROD ausgeführt. Sie erteilt **keine** Freigabe zur Veröffentlichung des Frontends.

TEST: `gamvnzggcrrlnyoknllu`. PROD: `eqtrifscedpsngsysxvc`. SQL-Paket: `sql/releases/3.7.0/`.

Auf eine zusätzliche Datenbanksicherung wird auf Entscheidung des Betreibers verzichtet. Das verbleibende Risiko wird akzeptiert.

## Ampel

| Thema | Ampel | Begründung |
|-------|-------|------------|
| Paket vorbereitet | **GRÜN** | `sql/releases/3.7.0/` ausgeführt bis Verifikation. |
| TEST-Fachabnahme 3.7.0 | **GELB** | Live-Abläufe und Mock-Playwright tragfähig; TEST ≠ PROD |
| Datenbank 3.7.0 auf PROD | **GRÜN** | 02–05 und 06 am 23.11.2026. Siehe `docs/RELEASE-MIGRATION-RUN-3.7.0.md`. |
| Frontend-Veröffentlichung | **ROT** | Pin 3.6.3. Kein `main`, kein Pages. |
| Destruktives SQL / Datenänderung | **GRÜN** | Paket additiv. Kein DROP TABLE/FUNCTION bestehender Objekte. Kein UPDATE/DELETE auf Bestandszeilen. |
| RLS bestehender Tabellen | **GRÜN** | Keine Policy auf `defects`, `facilities`, `readings`. Neue FORCE-RLS nur auf neuen Tabellen. |
| 3.6.3-Kompatibilität nach SQL | **GRÜN** | 3.6.3 ruft Create-Facility, Monate und Foto-Bucket nicht auf. |
| Excel-Commit mit Frontend 3.7.0 | **GRÜN** | `HISTORICAL_COMMIT_ENABLED=false`. Vorschau bleibt. Manuelle Historie unberührt. PROD-RPC unverändert. |
| Verzicht auf zusätzliche Sicherung | **GELB** | Betreiberentscheidung. Bei Fehler kein nachweisbarer Dump/PITR zum Zurückspielen. |
| Produktiv-Preflight 01 | **GRÜN** | 23.11.2026 lesend auf PROD: `need:*` da, DO ohne EXCEPTION. Bericht: `docs/RELEASE-PREFLIGHT-3.7.0.md`. |

Keine Freigabe in diesem Dokument.

## 1. Tatsächlich notwendige Änderungen (PROD)

Nicht anfassen (bereits passend): Kalender 6 Argumente INVOKER, `tageswerk_prepare_reading()` INVOKER mit `series_id`, `employee_update_assigned_defect(uuid,text,text)` DEFINER inkl. Zuweisungsguard, Archiv-RPCs + Guard-Trigger, Filterspülungen + `tageswerk_set_water_filter_active`, Preview, Commit (nicht ersetzen).

Anlegen durch `sql/releases/3.7.0/`:

| Objekt | Datei | Grund |
|--------|-------|--------|
| Unique `(facilities.id, organization_id)` | 02 | Constraint war da. Zweiter Index **nicht** angelegt. |
| `utility_monthly_consumption` + Revisionen, Trigger | 02+03 | manuelle Monate im Frontend |
| RLS FORCE + SELECT/INSERT/UPDATE Leitung | 04 | Mandant über `tageswerk_meter_role` |
| `tageswerk_create_facility(uuid,text)` DEFINER | 03 | GF legt Betrieb an; kein INSERT auf `facilities` für authenticated |
| `defect_photos` | 02+04 | Metadaten; Frontend lädt primär in Storage |
| Bucket `defect-photos` privat + Storage-Policies | 05 | Foto-Upload |

Nicht im Paket: `user_notice_acks`, volle 2.9/3.4/3.5.1/3.5.8, TEST-Kompatibilitätsdateien.

## 2. Sicherheitsprüfung des Pakets (23.11.2026)

Erneut gegen `sql/releases/3.7.0/`:

| Anforderung | Befund |
|-------------|--------|
| Keine destruktiven SQL-Befehle | Kein `DROP TABLE`, kein `DROP FUNCTION` bestehender Kerne. Trigger/Policies nur anlegen, wenn der Name fehlt. |
| Keine Änderung bestehender Daten | Kein `UPDATE`/`DELETE`/`TRUNCATE` auf Bestandszeilen. Unique-Index auf `facilities(id, organization_id)` ist additiv. |
| Keine ungewollten Funktionsüberschreibungen | `03` und `05` nutzen `CREATE FUNCTION` nur wenn `to_regprocedure` fehlt. Kein `CREATE OR REPLACE` für Prepare, Commit, Employee, Archiv, Kalender, Filter. |
| Bestehende RLS bleibt | `04` nur neue Tabellen. `REVOKE`/`GRANT` nur auf `utility_monthly_consumption*`, `defect_photos`. |
| 3.6.3 bleibt kompatibel | Öffentliche App kennt die neuen RPCs/Tabellen nicht. Additive Objekte stören bestehende Aufrufe nicht. |
| Mandantentrennung | Create-Facility nur org-weite GF. Monate über `tageswerk_meter_role`. Storage-Pfad = Facility-UUID plus Rolle. `search_path` leer bei DEFINER. |

Verbleibendes Risiko ohne zusätzliche Sicherung: Schlägt die spätere Migration fehl oder wirkt anders als erwartet, gibt es **keinen** frischen Dump/PITR zum Zurückspielen. Rollback bleibt Frontend 3.6.3 und Stehenlassen additiver Objekte, nicht ein Datenbank-Restore.

## 3. Ausführungsreihenfolge

Schritte 1–5 (Datenbank) am 23.11.2026 erledigt. **Schritte 7–8 erst nach gesonderter Frontend-Freigabe.**

| Nr. | Schritt | Erfolgskontrolle | Jetzt |
|-----|---------|------------------|-------|
| 1 | PROD-Preflight, nur lesend | `01_preflight.sql`: Abhängigkeiten `need:*` da, Kalender 6 Argumente, kein EXCEPTION | erledigt 23.11.2026 (erneut); vor Schritt 3 wiederholen |
| 2 | Ergebnisse kontrollieren | Katalog vs. Abschnitt 1: Create-Facility, Monate, Bucket fehlen; Kerne nicht ersetzen | erledigt, `docs/RELEASE-PREFLIGHT-3.7.0.md` |
| 3 | SQL einzeln: 02, dann 03, dann 04, dann 05 | Je Datei `BEGIN`/`COMMIT` ohne Fehler. Nach jeder Datei kurz prüfen, dass keine Kernfunktion ersetzt wurde | erledigt 23.11.2026 |
| 4 | Erfolg je Migration | 02: Tabellen da, kein zweiter Unique-Index. 03: Create-Facility da, Prepare/Commit-md5 unverändert. 04: Policies nur neue Tabellen, FORCE RLS. 05: Bucket `public=false` | erledigt |
| 5 | Abschließende DB-Verifikation | `06_verification.sql` ohne EXCEPTION | erledigt |
| 6 | Kompatibilität 3.6.3 | Öffentliche 3.6.3 mit bestehendem Konto: Dashboard, 2 Betriebe, Wechsel, Mängel lesend | erledigt 23.11.2026, `docs/RELEASE-SMOKE-3.6.3-NACH-MIGRATION.md` |
| 7 | Frontend 3.7.0 veröffentlichen | Gesonderte Freigabe. Nicht `main`/Pages in dieser Vorbereitung | **gesperrte Freigabe** |
| 8 | Produktiver Funktionstest | Anmeldung, Dashboard, Mangel Leitung+Mitarbeiter, Monat manuell, Betrieb anlegen (GF), Foto optional. Excel-Commit nur nach gesonderter Entscheidung | **gesperrte Freigabe** |
| 9 | Release dokumentieren | Datum, Dateien, Smoke, offene Punkte. Kein Dump-SHA mehr als Pflicht | nach 8 |

## 4. Entscheidung Sicherung

Auf eine zusätzliche Datenbanksicherung wird auf Entscheidung des Betreibers verzichtet. Das verbleibende Risiko wird akzeptiert.

Die Sicherung ist **keine** verpflichtende Voraussetzung mehr. Abschnitt 4 der vorigen Fassung (Dump-Pflicht vor Schritt 3) entfällt.

Freiwilliger Dump bleibt möglich (`scripts/backup-production.ps1`), ist aber nicht Gate.

## 5. Rollback

Bevorzugt: **Frontend auf 3.6.3 lassen bzw. zurück** und additive SQL stehen lassen.

| Änderung | Rollback |
|----------|----------|
| Neue Tabellen Monate/Fotos | nicht DROP. 3.6.3 nutzt sie nicht. |
| Create-Facility | 3.6.3 ruft sie nicht auf. Nicht DROP. |
| Bucket | leer lassen, nicht löschen wenn Dateien da. |
| Bestehende Daten | unberührt. |
| Frontend | GitHub Pages / `main` auf 3.6.3-Pin. |

Ohne zusätzliche Sicherung gibt es **keinen** Restore-Pfad über Dump/PITR. Keine automatischen `DROP TABLE` / `DROP FUNCTION` auf PROD.

## 6. Testergebnisse dieser Vorbereitung

| Prüfung | Ergebnis |
|---------|----------|
| `npm test` | **276/276** inkl. Additivität des SQL-Pakets |
| `01_preflight.sql` TEST | Abhängigkeiten da; DO ohne Abbruch |
| `01_preflight.sql` PROD | **23.11.2026 vor 02**: `need:*` da, `install:*` fehlten, DO ohne EXCEPTION |
| `06_verification.sql` TEST | **bestanden** (Sollobjekte bereits in TEST) |
| `02`–`05` PROD | **ausgeführt 23.11.2026**, je Datei Exit 0 |
| `06_verification.sql` PROD | **bestanden** |
| PROD nach Migration | Create-Facility, Monate, privater Foto-Bucket **da**. Unique facilities(id, org) unverändert ein Constraint. Kerne-md5 unverändert |
| TEST vs PROD | TEST belegt Archiv/Filter/Commit nicht für PROD. PROD belegt Create-Facility/Monate nicht an TEST |
| Excel-Commit-Sperre | `HISTORICAL_COMMIT_ENABLED=false`; Unit 276/276; Playwright Import+Historie 4/4 |

## 7. Verbleibende Punkte

Technisch **kein** weiterer ROT-Blocker in der Art „Paket unsicher / Schema unbekannt“. Die ausgelassene Sicherung ist bewusst kein Gate mehr.

Weiterhin vor Go-Live, aber **Freigabe-Schritte**, keine neuen Schema-Lücken:

1. **ROT (Prozess)** Schritte 7–8 ohne gesonderte Freigabe. Frontend 3.7.0 nicht veröffentlicht.
2. **GRÜN** Excel-Historien-Commit im Frontend 3.7.0 gesperrt. Wiedereinschalten nur über `HISTORICAL_COMMIT_ENABLED`.
3. **GELB** TEST ≠ PROD bei Archiv, Filterspülungen, Commit: Smoke muss auf PROD erfolgen.
4. **GELB** TEST-`tageswerk_prepare_reading` EXECUTE für `anon`; PROD nicht. Nicht mit diesem Paket ändern.

## Halt

Datenbankmigration abgeschlossen. Kein weiteres PROD-DDL. Kein Deployment. Kein Push auf `main`. Kein GitHub Pages. `js/supabase.js` bleibt auf PROD.
