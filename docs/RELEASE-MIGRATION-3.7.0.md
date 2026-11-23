# SQL-Bestandsaufnahme Tageswerk 3.7.0

Stand: 23.11.2026. Branch: `modularisierung`. Öffentliche Pin bleibt **3.6.3**. TEST: `gamvnzggcrrlnyoknllu`. PROD: `eqtrifscedpsngsysxvc`.

Lesendes Inventar und Preflight vor der Migration. **Additive PROD-Migration 02–05 am 23.11.2026 ausgeführt.** Laufprotokoll: `docs/RELEASE-MIGRATION-RUN-3.7.0.md`. Öffentliche Pin bleibt 3.6.3.

## 1. Urteil

TEST ist für den 3.7.0-Kern lauffähig. PROD ist **weiter** als der Halt-21.11-Stand: Inspektionen, Layouts, Day-Figure-Import, Kalender, Prepare-Reading, Replace-Meter, Preview **und** Commit, Archiv, Filterspülungen, Mitarbeiter-Mangel-RPC sind bereits da.

PROD **hat nach der Migration 23.11.2026**: `tageswerk_create_facility`, `utility_monthly_consumption` + Revisionen, `defect_photos`, Bucket `defect-photos` privat. `user_notice_acks` fehlt weiter, wird vom aktuellen Frontend nicht gelesen.

Release-SQL `sql/releases/3.7.0/` auf PROD angewendet (01–06). TEST-Kompatibilitätsdateien **nicht** auf PROD anwenden. Frontend-Pin bleibt 3.6.3.

## 2. Seit 3.6.3 in TEST nachgezogen

Reihenfolge der bekannten TEST-Ausführungen (nicht erneut ausführen):

| Nr. | Datei | Zweck | Für Kern 3.7.0? | Risiko |
|-----|-------|-------|-----------------|--------|
| A | `tageswerk_3_7_0_test_meters_compat.sql` | Zählerspalten 2.9 | ja, Ablesung | ALTER nur wenn Spalten fehlen |
| B | `tageswerk_3_7_0_test_consumption_calendar.sql` | Kalender-RPC 6 Argumente | ja, Dashboard | Signatur muss zu Frontend passen |
| C | `tageswerk_3_7_0_test_prepare_reading.sql` | `tageswerk_prepare_reading` Rumpf 2.9 INVOKER | ja, Ablesung | nicht durch 2.9-Gesamtdatei ersetzen |
| D | `tageswerk_3_7_0_test_replace_meter.sql` | Zählerwechsel INVOKER | ja für Wechsel | deaktiviert Altzähler |
| E | `tageswerk_3_7_0_test_critical_acks.sql` | Kenntnisnahmen | ja für kritische Mängel | FORCE RLS |
| F | `tageswerk_3_7_0_test_escalation_settings.sql` | Eskalationsformular | UI | FORCE, nur Leitung |
| G | `tageswerk_3_7_0_test_daily_reports.sql` | Tagesberichte Kompat | ja | Wetterspalten |
| H | `tageswerk_3_7_0_create_facility.sql` | `tageswerk_create_facility` DEFINER | ja für GF | legt Betriebe an; nur `name`+`organization_id` |
| I | `tageswerk_3_7_0_notice_acks.sql` | In-App-Quittungen | ja | user_id = auth.uid() |
| J | `tageswerk_3_7_0_defect_photos.sql` + Storage TEST | Fotometadaten / Bucket | optional | Storage-Policies |
| K | `tageswerk_3_7_0_test_import_mappings.sql` | Excel-Zuordnungen | Excel-Vorschau | kein Commit |
| L | `tageswerk_3_7_0_test_import_preview.sql` | Preview/Assess INVOKER | Excel-Vorschau | bricht ab, wenn Commit enthalten |
| M | `tageswerk_3_0_inspections.sql` | Kontrollgänge | ja | braucht `tageswerk_meter_role` / bind-Trigger |
| N | `tageswerk_3_7_0_manual_monthly_consumption.sql` | manuelle Monate | ja statt Excel-Commit | FORCE RLS, Revisionen |
| O | `tageswerk_3_7_0_employee_update_assigned_defect.sql` | Mitarbeiter-Mängel | ja | DEFINER, nur status+change_note |

Bereits vor 3.7.0 in TEST und für Module nötig, Herkunft 3.0/3.1:

- `assets`, `maintenance_logs` (`tageswerk_3_0_maintenance.sql`)
- Materialien, Beschaffung
- Temperatur, Wasserbecken (ohne Filterspülungen)

3.6.3-Dateien, in TEST vorhanden, in PROD laut Halt **fehlend**:

1. `tageswerk_3_6_2_materials_manage.sql` / `tageswerk_3_6_3_material_movements_insert.sql` (PROD hatte `material_movements_insert` schon)
2. `tageswerk_3_6_3_retry_staff_invitation.sql`
3. `tageswerk_3_6_3_user_dashboard_layouts.sql`
4. `tageswerk_3_6_3_day_figure_import.sql` (`facility_day_figure_imports` + Import-RPC)

## 3. TEST-Katalog 23.11.2026 (gelesen)

Vorhanden: Organisationen, Betriebe, Layouts, Inspektionen, Anlagen/Wartung, Tageskennzahlen, Monatsverbräuche, Kalender, Prepare-Reading, Replace-Meter, Preview, Create-Facility, Employee-Mangel-RPC.

Fehlt in TEST, auf PROD vorhanden: `tageswerk_commit_historical_import`, `tageswerk_archive_defect`, `water_filter_flushes`, `tageswerk_set_water_filter_active`.

## 4. PROD live 23.11.2026 (nur SELECT)

### 4.1 Vorhanden

Tabellen: organizations, facilities, memberships, user_dashboard_layouts, inspection_templates/points/runs/results, assets, maintenance_logs, critical_defect_acknowledgements, facility_day_figures, facility_day_figure_imports, utility_meter_import_mappings, water_filter_flushes.

Spalten: `utility_meter_readings.series_id`, `photo_path`, `utility_meters.meter_number`, `facilities.latitude`, `defects.change_note`.

RPCs (Signatur / SECURITY):

| Funktion | Argumente | DEFINER |
|----------|-----------|---------|
| `tageswerk_consumption_calendar` | facility, medium, meter_id, grain, from, to | nein |
| `tageswerk_prepare_reading` | (Trigger, keine Argumente) | nein |
| `tageswerk_replace_utility_meter` | Meterwechsel 9 Argumente | nein |
| `tageswerk_preview_historical_import` | facility, payload | nein |
| `tageswerk_commit_historical_import` | facility, token, sha256, dateiname, payload | **ja** |
| `tageswerk_archive_defect` | defect_id | **ja** |
| `employee_update_assigned_defect` | defect_id, status, note | **ja** |
| `retry_staff_invitation` | invitation_id | **ja** |
| `tageswerk_day_figure_overview` | facility, from, to, weekday | **ja** |
| `tageswerk_create_inspection_template` | facility, name, interval, unit, labels | nein |
| `tageswerk_assign_inspection` | template, assigned_to, due_at | nein |
| `tageswerk_complete_inspection` | run, results jsonb | nein |
| `tageswerk_set_water_filter_active` | filter, active, reason | **ja** |

RLS-Stichprobe: assets SELECT+INSERT; defects SELECT+INSERT+UPDATE; facilities SELECT+UPDATE (kein INSERT für authenticated — daher Create-Facility-RPC nötig); Inspektionen SELECT/INSERT/(UPDATE wo nötig); layouts CRUD; meter readings SELECT+INSERT+UPDATE; water_filter_flushes SELECT+INSERT. Storage-Bucket `defect-photos` **fehlt**.

### 4.2 Fehlt auf PROD

| Objekt | Für 3.7.0 | Datei (nur vorbereiten) |
|--------|-----------|-------------------------|
| `tageswerk_create_facility(uuid,text)` | ja, GF | `sql/releases/3.7.0/03_functions.sql` |
| `utility_monthly_consumption` + Revisionen | ja, manuelle Historie | `sql/releases/3.7.0/02`+`03`+`04` |
| `user_notice_acks` | nein (Frontend liest sie nicht) | nicht im Release-Paket |
| `defect_photos`, Bucket `defect-photos` | ja für Fotos, UI überspringt fehlenden Bucket | `sql/releases/3.7.0/02`+`04`+`05` |

## 5. Zwingend für ein 3.7.0-Frontend

| Objekt | Zwingend | Begründung |
|--------|----------|------------|
| Zählerspalten + `prepare_reading` 2.9-Rumpf | ja | Ablesung, Reihe, Plausibilität |
| `tageswerk_consumption_calendar` (6 Argumente) | ja | Dashboard / GF-Kacheln |
| `user_dashboard_layouts` | ja für GF-Layout | sonst nur localStorage |
| Inspektionen + 3 RPCs | ja für Kontrollgänge | TEST hatte Tabellen vorher nicht |
| `assets` / `maintenance_logs` | ja für Wartung | INSERT-RLS Leitung |
| `tageswerk_create_facility` | ja für GF-Betrieb | kein Tabellen-INSERT für authenticated |
| `employee_update_assigned_defect` | ja für Mitarbeiter-Mängel | kein Tabellen-UPDATE für Mitarbeiter |
| manuelle `utility_monthly_consumption` | ja statt Excel-Commit | Kernhistorie |
| Preview-RPC | ja für Excel-Vorschau | auf PROD vorhanden, INVOKER |
| Commit-Historie | **PROD da**, Frontend 3.7.0 gesperrt | nicht neu anlegen, nicht ersetzen |
| Archiv + Restore + Sammelarchiv | **PROD da** (inkl. Guard-Trigger) | volle 3.5.1 nicht erneut |
| Filterspülungen | **PROD da** | 3.5.8 nicht erneut |

## 6. Migrations-Checkliste PROD (nicht ausführen)

Vor jeder Datei: Funktionskörper bzw. `to_regclass` / `to_regprocedure` erneut lesen. Vorhandenes nicht mit TEST-`CREATE OR REPLACE` überschreiben.

Auf eine zusätzliche Datenbanksicherung wird auf Entscheidung des Betreibers verzichtet. Das verbleibende Risiko wird akzeptiert. Schritt 0 (Dump/PITR als Pflicht vor Schreib-SQL) entfällt.

| Nr. | Schritt | Status 23.11. | Aktion |
|-----|---------|---------------|--------|
| 1 | Lesendes Inventar (diese Dateien) | erledigt | vor Schreib-SQL wiederholen |
| 2 | `user_dashboard_layouts` | da | nicht erneut |
| 3 | `retry_staff_invitation` | da | nicht erneut |
| 4 | `facility_day_figure_imports` | da | nicht erneut |
| 5 | Zählerspalten series_id / meter_number / photo_path | da | TEST-Datei A nicht anwenden |
| 6 | `tageswerk_consumption_calendar` 6 Argumente | da, INVOKER | TEST-Datei B nicht anwenden |
| 7 | `tageswerk_prepare_reading()` | da, INVOKER | TEST-Datei C nicht anwenden |
| 8 | `tageswerk_replace_utility_meter` | da | TEST-Datei D nicht anwenden |
| 9 | `critical_defect_acknowledgements` | da | TEST-Datei E nicht anwenden |
| 10 | Inspektionen + 3 RPCs | da | `tageswerk_3_0_inspections.sql` nicht anwenden |
| 11 | assets / maintenance_logs | da, RLS INSERT+SELECT | nicht anwenden |
| 12 | `employee_update_assigned_defect` | da, DEFINER, 3 Argumente | TEST-Datei O nicht anwenden |
| 13 | Preview-RPC | da, INVOKER | Preview-TEST-Datei nicht anwenden |
| 14 | Commit-RPC | da, DEFINER, `uebernommen`, 5 Argumente wie Frontend | nicht ersetzen |
| 15 | Archiv `archive` / `archive_closed` / `restore` + `tageswerk_defect_archive_guard` | da, DEFINER, `search_path` leer | volle 3.5.1 nicht erneut |
| 16 | Filterspülungen + `tageswerk_set_water_filter_active` | da, jsonb/`event_id` | 3.5.8 nicht erneut |
| 17 | `employee_update_assigned_defect` | da: Zuweisungsguard, kein `SET assigned_to`, void | nicht ersetzen |
| 18 | `tageswerk_create_facility` | **fehlt** | `sql/releases/3.7.0/03_functions.sql` |
| 19 | `utility_monthly_consumption` | **fehlt** | `02`+`03`+`04` |
| 20 | `user_notice_acks` | fehlt | nicht im Paket |
| 21 | `defect_photos` / Bucket | fehlt | `02`+`04`+`05` |
| 22 | 3.4 / volle 2.9 | — | nicht |

Abhängigkeiten 18–19: `tageswerk_meter_role`, `tageswerk_facility_organization`, `tageswerk_bind_operation_facility`, `facilities.organization_id`. Preflight 23.11.2026 auf PROD: Trigger `prepare_reading` an `utility_meter_readings`; kein EXCEPTION im DO (letzte sichtbare Menge: Triggerkatalog).

## 7. Risiken

- Auf eine zusätzliche Datenbanksicherung wird auf Entscheidung des Betreibers verzichtet. Das verbleibende Risiko wird akzeptiert: bei Fehlschlag der späteren Migration kein frischer Dump/PITR.
- TEST-Dateien mit `CREATE OR REPLACE` dürfen PROD-Fassungen nicht überschreiben.
- PROD hat Archiv-Guard; TEST nicht. Leitung-UPDATE auf `defects` auf PROD durch Guard begrenzt.
- 3.7.0-Frontend ruft `tageswerk_commit_historical_import` **nicht** auf (`HISTORICAL_COMMIT_ENABLED=false`). PROD-Funktion bleibt scharf, UI und `prepareCommitCall` sperren.
- Create-Facility in TEST hat am 23.11. einen QA-Betrieb angelegt; PROD nie so testen.
- Auth-Redirects PROD zeigten zuletzt noch Netlify, nicht GitHub Pages.
- TEST `tageswerk_prepare_reading` EXECUTE für `anon`; PROD nicht.

## 8. SQL-Paket `sql/releases/3.7.0/`

| Datei | Aufgabe | Diese Sitzung |
|-------|---------|---------------|
| `01_preflight.sql` | Lesender Katalog + Abbruch bei fehlenden Abhängigkeiten | TEST und PROD gelesen |
| `02_schema.sql` | Neue Tabellen/Indizes | nicht ausgeführt |
| `03_functions.sql` | Create-Facility nur wenn fehlend, Monats-Trigger | nicht ausgeführt |
| `04_policies.sql` | RLS nur neue Tabellen | nicht ausgeführt |
| `05_storage.sql` | privater Bucket + Pfad-Helper | nicht ausgeführt |
| `06_verification.sql` | Sollzustand | TEST bestanden; PROD würde heute fehlen (Create/Monate/Bucket) |

## Halt

Keine Schreib-SQL auf PROD. Inventar lesend. Keine Freigabe für Migration oder Veröffentlichung. Auf eine zusätzliche Datenbanksicherung wird auf Entscheidung des Betreibers verzichtet. Das verbleibende Risiko wird akzeptiert.
