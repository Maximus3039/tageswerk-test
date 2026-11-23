# Produktiv-Preflight Tageswerk 3.7.0

Stand: 23.11.2026. Branch: `modularisierung`. Öffentliche Pin **3.6.3**. PROD: `eqtrifscedpsngsysxvc`.

Ausgeführt: ausschließlich lesend `sql/releases/3.7.0/01_preflight.sql` gegen PROD (exit 0). Die CLI liefert bei Mehrfach-SELECT nur die letzte nicht-leere Menge; Katalog, Funktionen, Constraints, Policies, Buckets und Storage-Policies wurden daher als dieselben SELECT-Blöcke aus `01_preflight.sql` einzeln gelesen. Schreib-SQL `02`–`05` nicht ausgeführt. `06_verification.sql` nicht gegen PROD ausgeführt (würde heute fehlschlagen). Kein Push, kein `main`, kein GitHub Pages.

Auf eine zusätzliche Datenbanksicherung wird auf Entscheidung des Betreibers verzichtet. Das verbleibende Risiko wird akzeptiert.

## GO / NO-GO

| Entscheidung | Urteil |
|--------------|--------|
| Additive SQL 02–05 **technisch** lauffähig | **GO** — alle `need:*` da, Kalender- und Employee-Signatur passend, DO ohne EXCEPTION |
| Produktivmigration **jetzt** ausführen | **erledigt 23.11.2026** — siehe `docs/RELEASE-MIGRATION-RUN-3.7.0.md` |
| Frontend 3.7.0 **jetzt** veröffentlichen | **NO-GO** — Pin bleibt 3.6.3 |
| Excel-Commit im Frontend 3.7.0 | **GO für die Sperre** — `HISTORICAL_COMMIT_ENABLED=false`; manuelle Historie unberührt |

Gesamtempfehlung: **technisches Preflight-GO, Prozess-NO-GO für Go-Live.**

## 1. Ergebnis je Prüfung

### 1.1 Abhängigkeiten (`need:*`)

| Objekt | PROD | Aktion |
|--------|------|--------|
| `facilities`, `memberships`, `defects`, `utility_meters` | da | bestehen lassen |
| `facilities.organization_id`, `defects.change_note` | da | bestehen lassen |
| `tageswerk_meter_role`, `tageswerk_facility_organization`, `tageswerk_bind_operation_facility()` | da | bestehen lassen |

Kein BLOCKER. Der `DO`-Block in `01_preflight.sql` ist nicht abgebrochen.

### 1.2 Anzulegende Objekte (`install:*`, Dateien 02–05)

| Objekt | PROD | Datei |
|--------|------|-------|
| `tageswerk_create_facility(uuid,text)` | fehlt | 03 |
| `utility_monthly_consumption` | fehlt | 02+03+04 |
| `utility_monthly_consumption_revisions` | fehlt | 02+03+04 |
| `defect_photos` | fehlt | 02+04 |
| Bucket `defect-photos` | fehlt | 05 |
| `tageswerk_defect_photo_storage_allowed(text)` | fehlt | 05 |

Entspricht `docs/RELEASE-CHECKLISTE-3.7.0.md` Abschnitt 1 und `docs/RELEASE-MIGRATION-3.7.0.md` Abschnitt 4.2.

### 1.3 Kompatibilität / Kerne (`compat:*`)

| Objekt | PROD | Hinweis |
|--------|------|---------|
| Kalender 6 Argumente INVOKER, Tabelle mit `measured_value`/`estimated_value` | da | nicht ersetzen |
| `tageswerk_prepare_reading()` INVOKER, `series_id`, Plausibilitätstext | da | Trigger an readings INSERT/UPDATE; `exec_anon=false` |
| `employee_update_assigned_defect(uuid,text,text)` DEFINER void | da | Zuweisungsguard, kein `SET assigned_to`, `search_path` leer |
| Preview INVOKER `(uuid,jsonb)` → jsonb | da | bleibt für Excel-Vorschau |
| Commit DEFINER 5 Argumente → jsonb, Status `uebernommen` | da | Frontend 3.7.0 ruft sie **nicht** mehr auf |
| Archiv einzeln/sammeln/restore DEFINER | da | Guard-Trigger an defects I/U/D |
| `water_filter_flushes` + `tageswerk_set_water_filter_active` | da | `event_id` im Rumpf |
| `defects.archived_at` / `archived_by` | da | Check-Constraint Paar + resolved |
| `user_notice_acks` | fehlt | Frontend liest sie nicht; nicht in 02–05 |

`tageswerk_create_facility` und Monats-Triggerfunktionen sind auf PROD nicht vorhanden (erwartet).

### 1.4 Constraints

`facilities_id_organization_id_key UNIQUE (id, organization_id)` ist **bereits** auf PROD. `02_schema.sql` legt zusätzlich den Index `facilities_id_organization_id_uidx` an, falls der Name fehlt. Das ist additiv und für die Composite-FKs der neuen Tabellen nicht zwingend, weil die Unique-Constraint schon existiert. Kein Konflikt, nur ein zweiter Unique-Index gleichen Spaltensatzes.

Keine Constraints auf `utility_monthly_consumption*` / `defect_photos` (Tabellen fehlen).

### 1.5 RLS und Berechtigungen

Bestehende Policies unverändert gelesen:

- `facilities`: SELECT + UPDATE, **kein** INSERT für `authenticated` → Create-Facility-RPC bleibt nötig.
- `defects`: SELECT, INSERT, UPDATE (`defect_manager_update`).
- `utility_meter_readings`: SELECT, INSERT, UPDATE.
- `water_filter_flushes`: SELECT, INSERT.

Keine Policies auf den noch fehlenden Monatstabellen. `04_policies.sql` setzt FORCE RLS nur dort.

RPCs: `exec_authenticated=true`, `exec_anon=false` für alle gelisteten Funktionen inkl. Prepare und Commit.

### 1.6 Trigger

Unverändert und mit 3.6.3 verträglich: `utility_meter_readings_prepare`, `utility_meter_readings_no_delete`, Archiv-Guard, Defect-Audit/Assignment/Deadlines, `facilities_protect_identity`. Keine Monats-Trigger (Tabellen fehlen).

### 1.7 Storage

Buckets `defect-photos`, `meter-photos`, `facility-photos` unter diesen IDs: **keine Zeile**. Keine Storage-Policies mit Namen `*defect*`. `05_storage.sql` legt den privaten Bucket und SELECT/INSERT-Policies nur an, wenn sie fehlen.

### 1.8 Konflikte

| Thema | Befund |
|-------|--------|
| CREATE OR REPLACE auf Kernen | nicht im Paket |
| Unique `(facilities.id, organization_id)` | schon da; 02 Index zusätzlich, harmlos |
| TEST ≠ PROD | TEST hat Create-Facility/Monate/Fotos; PROD hat Archiv/Filter/Commit |
| Excel-Commit-RPC | scharf auf PROD; Frontend 3.7.0 gesperrt |
| 3.6.3 nach 02–05 | kennt neue Objekte nicht; additive Tabellen/RPC stören bestehende Aufrufe nicht |

### 1.9 Kompatibilität 3.6.3

Die öffentliche App 3.6.3 nutzt Kalender, Prepare-Reading, Mängel, Archiv und Filter, nicht Create-Facility, nicht Monatstabellen, nicht den Foto-Bucket. Additive Installation ändert keine bestehenden Funktionskörper.

## 2. Excel-Commit vs. manuelle Historie

Getrennte Pfade:

- Excel: `js/meter-import.js` + `js/meter-import-store.js` → Preview-RPC und (bisher) Commit-RPC.
- Manuell: `js/historical-consumption-ui.js` + `js/historical-consumption.js` + `js/meters-store.js` → `utility_monthly_consumption` und historische **Stände** (kein Verbrauch speichern). Kein Import von `meter-import-store`.

Vorbereitete Sperre:

- `HISTORICAL_COMMIT_ENABLED=false` in `js/meter-import-store.js`.
- `prepareCommitCall` liefert immer `call:false` mit Hinweis, Vorschau bleibt.
- Oberfläche: Bestätigung und Button bleiben deaktiviert.
- `runHistoricalCommit` bleibt für isolierte Tests erreichbar, die UI erreicht ihn nicht.

Tests: `npm test` **276/276**. Playwright `import-vorschau` (Button und Checkbox disabled) und `historical-consumption` (Erfassung im Zählermodul, keine Schreibrequests) je Desktop+Smartphone **bestanden**.

Wiedereinschalten: Flag auf `true` setzen. Die PROD-RPC bleibt unverändert.

## 3. Notwendige Migrationen und Reihenfolge

Erst nach **gesonderter Freigabe**. Vor jeder Datei: erneut lesen, nicht 02–05 „zur Sicherheit“ wiederholen.

1. `01_preflight.sql` — **heute erledigt**, vor Schritt 3 wiederholen.
2. Kontrolle dieses Berichts gegen Checkliste — **heute**.
3. `02_schema.sql` — Tabellen Monate/Fotos; Unique-Index optional redundant.
4. `03_functions.sql` — `tageswerk_create_facility` nur wenn fehlend; Monats-Trigger wenn fehlend; `NOTIFY pgrst`.
5. `04_policies.sql` — FORCE RLS + Policies nur neue Tabellen.
6. `05_storage.sql` — privater Bucket `defect-photos` + Storage-Helper/Policies wenn fehlend.
7. `06_verification.sql` — muss Create-Facility, Monate, Bucket und Kalender 6-arg bestätigen.
8. 3.6.3-Smoke (Anmeldung, Mangel, Ablesung) **bevor** Frontend-Pin wechselt.
9. Frontend 3.7.0 nur mit gesonderter Veröffentlichung. Excel-Commit bleibt aus, bis das Flag geändert wird.
10. Produktiver Funktionstest: Betrieb anlegen (GF), manueller Monat, Foto optional, Mitarbeiter-Mangel.

Nicht ausführen: TEST-Kompatibilitätsdateien, volle 2.9/3.4/3.5.1/3.5.8, `tageswerk_commit_historical_import` CREATE OR REPLACE.

## 4. Risiken (akzeptiert bzw. verbleibend)

| Risiko | Ampel | Behandlung |
|--------|-------|------------|
| Kein frischer Dump/PITR | GELB | Betreiberverzicht. Rollback = Frontend 3.6.3, additive Objekte stehen lassen |
| Schritte 3–8 ohne Freigabe | ROT (Prozess) | NO-GO Go-Live |
| TEST ≠ PROD bei Archiv/Filter/Commit | GELB | Smoke nur auf PROD beweiskräftig |
| Zweiter Unique-Index auf facilities | GELB | additiv, kein Datenumbau |
| Commit-RPC bleibt scharf | GRÜN für 3.7.0-UI | Flag false; Direkt-RPC aus anderem Client weiter möglich |
| `user_notice_acks` fehlt | GRÜN | ungenutzt |
| Auth-Redirects historisch Netlify | GELB | außerhalb dieses SQL-Pakets |

## Halt

Kein PROD-Write. Keine Dateien 02–05 ausgeführt. Kein Deployment. Kein Push auf `main`. `js/supabase.js` bleibt auf PROD.
