# Schema-Abgleich Tageswerk 3.7.0

Stand: 21.11.2026. Branch: `modularisierung`. Ziel: TEST `gamvnzggcrrlnyoknllu`. PROD `eqtrifscedpsngsysxvc` unverändert.

Frontend: Vanilla-ES-Module unter `js/`. Gemeinsamer Zustand nur über `js/state.js`. Verbrauch wird nicht gespeichert.

## 1. Frontend-Datenbankabhängigkeiten

| Frontend-Abhängigkeit | In TEST? | Schema kompatibel? | RLS | Getestet |
|-----------------------|----------|--------------------|-----|----------|
| `organizations`, `facilities`, `memberships`, `profiles` | ja | ja (inkl. `facilities.latitude/longitude`) | bestehend | Live mgr-a1: 1 Unternehmen, 1 Betrieb Alpha Nord |
| `defects`, `defect_events` | ja | ja | bestehend | Live: Mangel A1 sichtbar |
| `defect_photos` + Bucket `defect-photos` | ja | privat, jpeg/png/webp/heic | Storage-Policies authenticated | Anon 401 zuvor; Upload nicht live |
| `staff_invitations` + `request/revoke/retry/accept_staff_invitation` | ja | ja | bestehend | Live: Einladungsliste sichtbar |
| Edge `invite-staff` | ja (TEST) | — | — | Versand zuvor unvollständig |
| `user_dashboard_layouts` | ja | ja | bestehend | Vorherige Layout-Abnahme |
| `user_notice_acks` | ja | ja | user_id = auth.uid() | Unit; Live Hinweise geladen |
| `facility_escalation_settings` | ja | Kompat 3.7.0 | FORCE, nur GF/BL | UI Eskalation geladen |
| `critical_defect_acknowledgements` | **ergänzt** | `defect_id`, `acknowledged_by`, `acknowledged_at` | FORCE, SELECT Rolle, INSERT GF/BL | Schema; Quittieren nicht neu ausgelöst |
| `facility_day_figures` + Import/Save-RPCs | ja | ja | bestehend | Vorheriger Import 1999-03-* |
| `daily_reports` + `tageswerk_update_daily_report` / `link` | ja | Kompat 3.7.0 + Wetter | FORCE | Live: „Letzter Tagesbericht: keine Daten“ |
| `utility_meters` 2.9-Spalten | ja | Kompat 3.7.0 | SELECT Facility, INSERT/UPDATE GF/BL | Live Zaehler A1 |
| `utility_meter_readings` inkl. `series_id`, `voided_by`, `photo_path` | ja | **prepare_reading 2.9** | Trigger + SELECT Rolle | Live 100,5 kWh, `series_id` gesetzt |
| Views `utility_meter_consumption` / `_periods` | ja | security_invoker | über Basistabellen | Eine Ablesung → „Kein Verbrauch“ korrekt |
| `tageswerk_consumption_calendar` | ja | Signatur 6 Argumente | INVOKER | Dashboard „Keine Daten“ bis zweite Ablesung |
| `tageswerk_replace_utility_meter` | **ergänzt** | INVOKER, GF/BL | GRANT authenticated | Schema; Wechsel nicht ausgeführt (würde Zähler deaktivieren) |
| `utility_meter_import_mappings` | **ergänzt** | Trigger setzt `revoked_by` | FORCE, GF/BL | Schema; UI nach Excel |
| `tageswerk_preview_historical_import` | **fehlt** | — | — | UI: „Importvorschau gesperrt“ |
| `tageswerk_commit_historical_import` | **fehlt, absichtlich** | DEFINER, schreibt Historie | — | Nicht aufgerufen |
| `inspection_*` + Create/Assign/Complete/Defect-RPCs | **ergänzt** aus 3.0 | INVOKER | FORCE | Live: 0 offene Kontrollgänge |
| `assets`, `maintenance_logs`, `asset_defects`, `procurement_requests` | ja | ja | bestehend | Navigation erreichbar |
| `materials`, `material_movements` | ja | ja | bestehend | Navigation Bestand |
| `temperature_*` | ja | ja | bestehend | Dashboard: 1 Temperaturkontrolle ausstehend |
| `water_pools`, `water_checks`, `water_round_drafts` + Round-RPCs | ja | ja | bestehend | Dashboard: 1 Hygienekontrolle |
| `water_filters` (Stub) | ja, unvollständig | nur `name/active` | — | Filterspülungen **fehlen** |
| `water_filter_flushes` / Korrekturen / Status + `tageswerk_set_water_filter_active` | **fehlt** | 3.5.8 wäre DEFINER-Caps | — | angehalten |
| `employee_update_assigned_defect` | **fehlt** | 3.4 würde Rollenmodell berühren | — | angehalten |
| `tageswerk_archive_defect` / restore / archive_closed | **fehlt** | 3.5.1 entzieht UPDATE auf `defects` | — | angehalten |
| Realtime `defects` + `critical_defect_acknowledgements` | Kanal abonniert | Tabelle da | — | Live-Indikator „verbunden“ |

## 2. Fehlende Objekte (bewusst nicht nachgezogen)

1. Historischer Import: Preview + Commit ersetzen `tageswerk_prepare_reading` und nutzen SECURITY DEFINER. Nach der vollen 2.9-Ableselogik nicht ungeprüft.
2. Filterspülungen 3.5.8: TEST-`water_filters` ist ein Stub; Erweiterungen sind nicht wiederholbar und DEFINER.
3. Mängelarchiv 3.5.1: entzieht Tabellen-UPDATE.
4. `employee_update_assigned_defect` aus der Techniker-Migration 3.4.

## 3. Ergänzte Objekte (nur TEST)

Siehe `docs/TEST-INTEGRATION-3.7.0.md`.

## 4. Voraussetzungen für PROD

TEST-Kompatibilitätsdateien nicht blind auf PROD. PROD zuerst lesend inventarisieren. `tageswerk_3_0_inspections.sql` und 2.9-Ableserumpf nur nach Freigabe, wenn PROD die Objekte noch nicht hat.
