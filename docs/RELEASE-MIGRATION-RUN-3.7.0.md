# Produktivmigration Tageswerk 3.7.0 (nur Datenbank)

Stand: 23.11.2026. PROD: `eqtrifscedpsngsysxvc`. Branch: `modularisierung`. Öffentliche Pin bleibt **3.6.3**.

Kein Frontend-Release. Kein Push auf `main`. Kein GitHub Pages. Keine Testdatensätze angelegt. Auf eine zusätzliche Sicherung wurde auf Entscheidung des Betreibers verzichtet.

## Ausgeführte Dateien

| Datei | Zeitpunkt | Ergebnis |
|-------|-----------|----------|
| Unique-Prüfung `facilities` | vor 02 | Constraint `facilities_id_organization_id_key UNIQUE (id, organization_id)` vorhanden. PK `(id)` vorhanden. |
| `01_preflight.sql` | erneut, vor 02 | Exit 0, DO ohne EXCEPTION. Katalog wie Preflight: `need:*` da, `install:*` fehlten. |
| `02_schema.sql` | danach | Exit 0. Tabellen `utility_monthly_consumption`, `_revisions`, `defect_photos` da. Index `facilities_id_organization_id_uidx` **nicht** angelegt. |
| `03_functions.sql` | danach | Exit 0. `tageswerk_create_facility(uuid,text)` und Monats-Triggerfunktion da. |
| `04_policies.sql` | danach | Exit 0. FORCE RLS auf den drei neuen Tabellen. Policies SELECT/INSERT/(UPDATE Monate). Bestehende `defects`/`facilities`-Policies unverändert. |
| `05_storage.sql` | danach | Exit 0. Bucket `defect-photos` privat, Limit 5 MiB. Helper-RPC da. Storage SELECT+INSERT für `authenticated`, kein UPDATE/DELETE. |
| `06_verification.sql` | danach | Exit 0, DO ohne EXCEPTION. |

## Kernfunktionen unverändert (md5 vor/nach 03)

| Funktion | md5 |
|----------|-----|
| `tageswerk_prepare_reading()` | `fbc448aecb56f4e34e7228826c48f980` |
| `tageswerk_commit_historical_import` | `1cb14ed9a707484d147af514b4ac9a40` |
| `employee_update_assigned_defect` | `844c00470f7d4abf93036dacd9a24a59` |
| `tageswerk_consumption_calendar` 6-arg | `7e060ab9b42370673822b784dc4877ea` |

## Abweichungen

- Unique `(id, organization_id)` war schon als Constraint da. `02_schema.sql` prüft das und legt keinen zweiten Index an.
- `user_notice_acks` fehlt weiter (nicht im Paket).
- Neue Tabellen haben **0 Zeilen**. Keine produktiven Testdaten.

## Datenbankstatus nach Migration

Vorhanden für 3.7.0: Create-Facility (authenticated EXECUTE, nicht anon), Monatstabellen + FORCE RLS, `defect_photos` + privater Bucket + SELECT/INSERT-Policies.

Unverändert für 3.6.3: Kalender, Prepare-Reading (`anon` ohne EXECUTE), Commit, Archiv, Filter, facilities ohne INSERT für authenticated.

## 3.6.3-Kompatibilität

Katalog: bestehende Signaturen, md5 und RLS der von 3.6.3 genutzten Objekte unverändert. 3.6.3 ruft die neuen Tabellen und `tageswerk_create_facility` nicht auf. Kein Live-Login-Smoke in dieser Sitzung (keine Testdatensätze).

## Empfehlung Frontend-Release

**Noch nicht veröffentlichen.** Pin bleibt 3.6.3, bis eine gesonderte Freigabe für GitHub Pages / `main` vorliegt.

Die Datenbank ist für Frontend 3.7.0 vorbereitet (Betrieb anlegen, manuelle Monate, Fotos). Excel-Commit bleibt im 3.7.0-Frontend gesperrt (`HISTORICAL_COMMIT_ENABLED=false`). Vor dem Pin-Wechsel: produktiver Funktionstest mit bestehenden Konten, ohne neue Betriebe oder Monate, sofern nicht ausdrücklich zugestimmt.
