# TEST-Integration Tageswerk 3.7.0

Stand: 21.11.2026. Branch: `modularisierung`. Öffentliche Anwendung bleibt **3.6.3**. Kein Push auf `main`, kein GitHub Pages, kein PROD.

Zielprojekt: **gamvnzggcrrlnyoknllu**. `js/supabase.js` zeigt nach dieser Sitzung wieder auf die Produktiv-URL (Abnahme-Server mit Restore).

## Urteil

Verbrauchsberechnung, Zählerreihe, isolierter Zählerwechsel, die **read-only Importvorschau** und die **manuelle historische Monatsverbrauchserfassung** sind in TEST geprüft. Die Dashboard-Verbrauchskarte zeigt für `mgr-a1` wieder **Alpha Nord** (UI-Fehler, keine Rechteerweiterung). Teiljahre heißen nicht mehr Jahresverbrauch. `tageswerk_prepare_reading` bleibt der 2.9-Rumpf (INVOKER). `tageswerk_commit_historical_import` ist **nicht** installiert und wurde nicht ausgeführt. GF- und Mitarbeiter-Sitzungen fehlen weiter.

## 1. Frontend-Abhängigkeiten

Vollständige Matrix: `docs/SCHEMA-ABGLEICH-3.7.0.md`.

## 2. Fehlende Objekte

- `tageswerk_commit_historical_import` (absichtlich nicht installiert; Übernahme gesperrt)
- `water_filter_flushes`, Korrekturen, Statusereignisse, `tageswerk_set_water_filter_active`
- `employee_update_assigned_defect`
- `tageswerk_archive_defect` / `tageswerk_archive_closed_defects` / `tageswerk_restore_archived_defect`

## 3. Ergänzte Objekte

| Objekt | Vorgehen |
|--------|----------|
| `utility_meter_readings.photo_path`, `voided_by`, `void_reason` | ALTER, Checks |
| `tageswerk_prepare_reading` | CREATE OR REPLACE, Rumpf 2.9 (Reihe, Rücksetzung, Korrektur, Plausibilität, Mandant) |
| `tageswerk_replace_utility_meter` | INVOKER, GRANT authenticated |
| `critical_defect_acknowledgements` | FORCE RLS |
| `utility_meter_import_mappings` + Prepare-Trigger | FORCE RLS, kein Commit-RPC |
| `utility_meter_import_batches` / `_readings`, `tageswerk_assess_historical_import`, `tageswerk_preview_historical_import` | INVOKER, GRANT SELECT auf Batches/Readings, GRANT EXECUTE Preview/Assess; kein INSERT-GRANT auf Readings |
| `inspection_templates/points/runs/results` + RPCs | `tageswerk_3_0_inspections.sql` nach Vorprüfung (Tabellen fehlten) |

## 4. Ausgeführte TEST-Migrationen

1. `tageswerk_3_7_0_test_prepare_reading.sql`
2. `tageswerk_3_7_0_test_replace_meter.sql`
3. `tageswerk_3_7_0_test_critical_acks.sql`
4. `tageswerk_3_7_0_test_import_mappings.sql`
5. `tageswerk_3_0_inspections.sql` (nur TEST, Objekte fehlten)
6. `tageswerk_3_7_0_test_import_preview.sql` (gebaut von `scripts/build-test-import-preview.mjs`; bricht ab, wenn Commit-Funktion oder `CREATE prepare_reading` enthalten wären)

Zuvor bereits: meters_compat, consumption_calendar, escalation_settings, daily_reports, create_facility, notice_acks, defect_photos/storage.

7. `tageswerk_3_7_0_manual_monthly_consumption.sql` (nur TEST, Tabellen fehlten; FORCE RLS, INVOKER-Trigger, Revisionshistorie)

**Nicht** ausgeführt: `tageswerk_2_9_migration.sql` komplett, `tageswerk_2_9_historical_import.sql` (würde `prepare_reading` ersetzen und Commit-DEFINER anlegen), `tageswerk_3_5_8_water_filter_*.sql`, `tageswerk_3_5_1_defect_archive.sql`, `tageswerk_3_4_technician_role.sql`. Nicht auf PROD.

## 5. Verbrauchsberechnung (Zaehler A1, Alpha Nord)

Vorhandene erste Ablesung **nicht** überschrieben.

| Stand | Zeitpunkt (lokal) | UTC | Typ | Reihe |
|-------|-------------------|-----|-----|-------|
| 100,5 kWh | 21.11.2026, 15:09 | 14:09 | regular | `972862f9-d476-405b-9779-f01e47b93442` |
| 110,5 kWh | 21.11.2026, 15:12 | 14:12 | regular | dieselbe Reihe |

Berechneter Verbrauch: **10 kWh** (110,5 − 100,5). Einheit kWh. Zeitliche Zuordnung zwischen 15:09 und 15:12.

16:09 wurde von `prepare_reading` abgelehnt („Ablesezeit liegt in der Zukunft“). Danach 15:12 gespeichert.

| Fläche | Ergebnis |
|--------|----------|
| Zählerübersicht | Letzter Stand 110,5 kWh, Verbrauch 10 kWh |
| Dashboard-Verbrauchskachel | 10 kWh (gemessen), Kalenderpunkte ab 21.11. |
| Auswertung | 1 gemessener Abschnitt, Betriebssumme Strom **10 kWh** |

Verbrauch bleibt berechnet, nicht als eigene Spalte gespeichert.

## 6. Isolierte Zählerwechseltests (TW370-ISO)

Neuer Testzähler `TW370-ISO` / Nummer `ISO-370` in Alpha Nord. Seed-Zähler A1 unverändert aktiv mit 110,5 kWh.

| Schritt | Ergebnis |
|---------|----------|
| Ablesung 20,5 kWh 15:21 | gespeichert, kein Verbrauch, Reihe `73eaf013-…` |
| Ablesung 30,5 kWh 15:22 | Verbrauch **10 kWh** |
| Ablesung 10 kWh danach | abgelehnt: „Der Zählerstand passt nicht zwischen die benachbarten Ablesungen.“ |
| Korrektur 30,5 → 31,5 | gespeichert (`reading_type=correction`), Verbrauch **11 kWh** |
| Rücksetzung auf 1 kWh | gespeichert (`reset`), gleiche Reihe |
| Zählerwechsel Abschluss 2 / Anfang 0 | alter Zähler **inaktiv**, Verbrauch 1 kWh auf Abschluss; neuer Zähler **TW370-ISO-N** (`ISO-370-N`), Reihe `134b7093-…`, Stand 0 kWh |

A1 blieb aktiv. Keine stillen Überschreibungen.

## 7. Historischer Import

Frontend (unverändert, kompatibel): CSV und XLSX via SheetJS, Profil zwei Zeilen je Tag, Spalten/Zählerzuordnung, lokale Prüfung, Dubletten, Fehleranzeige, Importbestätigung, Commit-Button gesperrt ohne Vorschau+Bestätigung.

TEST-Backend:

- Preview und Assess: SECURITY INVOKER
- Commit: fehlt (PostgREST PGRST202)
- Batches/Readings: SELECT für GF/BL, kein INSERT-GRANT
- Live-Vorschau mgr-a1, Payload mit Dublette `Blatt1!B2`, ungültigem Stand `xxx`, fehlender Zuordnung: `uebernehmbar=0`, `blockiert=3`, `schreibbar=false`, Gründe zu Zuordnung, Dublette, ungültigem Stand
- Es wurde **keine** Übernahme ausgeführt

Importhistorie: Tabellen vorhanden, lesbar; ohne Commit keine Batch-Schreibvorgänge.

## 8. Echte Integrationstests

### Live TEST-UI (mgr-a1, Port 5173)

| Fläche | Ergebnis |
|--------|----------|
| Dashboard | Live verbunden, nur Alpha Nord; Verbrauchskachel 10 kWh nach zweiter A1-Ablesung |
| Management-Dashboard | Kacheln/Ansicht für Alpha Nord |
| Statistiken / Auswertung | 10 kWh Strom, 1 Abschnitt |
| Datenimport Excel | lokale UI; serverseitige Vorschau RPC live, Übernahme gesperrt |
| Zählerstände | A1 100,5 + 110,5; isolierte ISO-Serie inkl. Wechsel |
| Tagesberichte | Modul lädt |
| Mängel | 1 offen, Testdatensatz |
| Wartungen / Kontrollgänge | 0 fällig / 0 offen |
| Material / Temperatur / Wasser | Navigation; Filterspülungen fehlen |
| Benachrichtigungen | 5 Hinweise |
| Mängelfotos | Bucket privat, Upload nicht live |

### Blockierte Rollen

- `company_admin` (admin-a): keine gültige Sitzung, nicht erraten/zurückgesetzt
- `employee` (emp-a1): keine gültige Sitzung

### API

- Anon bleibt ohne JWT bei geschützten Tabellen 401.
- Commit-RPC nicht im Schema-Cache.

## 9. Sicherheitsprüfungen

- Keine PROD-SQL.
- `tageswerk_commit_historical_import` nicht installiert, Aufruf schlägt fehl.
- `tageswerk_prepare_reading` nach Preview-SQL unverändert (INVOKER, Plausibilität).
- Replace nur auf isoliertem TW370-ISO, nicht auf A1.
- Preview-SQL FORCE RLS, GRANT SELECT, kein GRANT INSERT auf Import-Readings.
- Mandant: mgr-a1 sieht nur Alpha Nord.
- Monatsverbräuche TEST: FORCE RLS, INSERT/UPDATE nur Leitungsrollen, Revisionshistorie ohne DELETE, kein PROD-SQL.
- Dashboard-Hinweis „Für dein Konto sind keine Betriebe freigegeben“: behoben (siehe Abschnitt 13). Rechte und RLS unverändert.

## 10. Automatisierte Tests

| Art | Inhalt | Ergebnis |
|-----|--------|----------|
| Unit / Mock | `npm test` inkl. `historical-consumption-3-7-0` | **274/274** nach Restore von `js/supabase.js` (während TEST-Rewrite fallen 2 URL-Wächter) |
| Mock-Browser | Playwright `historical-consumption.spec.js`, `mobile-ux-3-7.spec.js`, `mobile.spec.js`, Static-Server, nicht TEST-DB | siehe Abschnitt 13 |
| Echte Integration | TEST-DB + mgr-a1 | Verbrauch, ISO-Wechsel, Preview-RPC, manuelle Monate TW370-HIST, Dashboard-Korrektur |

## 10b. Historische Monatsverbräuche (echte TEST-DB, getrennt von Mock)

Sitzung: vorhandene `mgr-a1` auf Port 5173. Kein Passwort-Reset, keine Kontenänderung. `js/supabase.js` nur während des Abnahme-Servers auf TEST, danach Restore.

Gespeicherte Zeilen Alpha Nord, Strom, kWh, Gesamter Betrieb, Kommentarpräfix `TW370-HIST`:

| Monat | Wert | Korrektur |
|-------|------|-----------|
| 2025-01 | 12.500 → 12.400 kWh | Grund `TW370-HIST Testkorrektur Tippfehler Januar`, `corrected_by` gesetzt, `updated_at` 21.11.2026 14:40 UTC |
| 2025-02 | 11.700 kWh | — |
| 2025-03 | 12.900 kWh | — |

Revisionszeile: 12.500 → 12.400, ein Datensatz in `utility_monthly_consumption_revisions`.

Oberfläche nach Neuladen: **Verbrauch 3 von 12 Monaten** 37.000 kWh, **Ø erfasster Monat** 12.333,333 kWh, **Ø abgedeckter Tag** 411,111 kWh. Hinweis: unvollständig, 3 von 12. Fehlende Monate 2025 bleiben leer und zählen nicht als Null. Die Summe ist kein Jahresverbrauch.

Quellenregel live: November 2026 aus Ablesungen 22 kWh als unvollständig; nicht ins Jahresmittel; nicht mit manuellen 2025-Werten addiert. April–Dezember 2025 ohne Wert.

Mobile 320 / 390 / 430 px: historisch im Untermenü, tägliche Ablesung direkt, kein horizontales Überlaufen.

## 11. Noch blockierte Funktionen

- Historische Excel-**Übernahme** (Commit-DEFINER nicht installiert; würde `prepare_reading` ersetzen)
- Filter außer Betrieb / Spülkorrektur
- Mitarbeiter-Statuswechsel am Mangel per RPC
- Mängelarchiv
- GF- und Mitarbeiter-UI
- Foto-Upload
- (behoben) Dashboard-Karte Verbrauchserfassung ohne Betriebe trotz Alpha Nord — Abschnitt 13

## 12. Voraussetzungen für PROD

Keine Produktivsetzung.

1. PROD lesend: prepare_reading-Rumpf, Inspektionen, Kenntnisnahmen, Import-Mappings, Preview ohne Commit.
2. TEST-ALTERs nicht auf PROD, wenn Spalten schon existieren.
3. Historischer Import nur mit Vergleich des live-`prepare_reading`-MD5; Commit-SQL nicht ungeprüft aus 2.9 übernehmen.
4. Abnahme GF und Mitarbeiter nach vorhandener Sitzung, ohne Passwort-Reset.

## 13. Dashboard-Korrektur und Stabilisierung (21.11.2026)

Kein PROD-SQL, keine Kontenänderung, kein Push.

### Fehlerursache

Keine RLS- oder Rollenlücke. `mgr-a1` bleibt `facility_manager` nur für Alpha Nord (`a1000000-0000-4000-8000-000000000011`).

`populateConsumptionFacility` leerte `#consumption-facility` mit `replaceChildren()` und füllte Optionen danach. Der `MutationObserver` in `js/meters-ui.js` wertete den leeren Select aus, obwohl `state.accessibleFacilities` Alpha Nord enthielt, und schrieb „Für dein Konto sind keine Betriebe freigegeben.“ Zusätzlich blieb `#consumption-empty` sichtbar, wenn die Dashboard-Auswahl `all` war, weil der Verbrauch-Select denselben Wert übernahm.

### Korrektur

- Optionen in einem Schritt setzen (`replaceChildren(...options)`), dann Wert.
- Leermeldung nur bei leerer Mitgliedschaftsliste (`consumptionFacilitiesAvailable`).
- Verbrauchsbetrieb ignoriert Dashboard-`all`; folgt nur zugeordneten Betrieben.
- Observer prüft `state.accessibleFacilities`; leerer Select während des Neuaufbaus gilt nicht als fehlende Rechte.
- `#consumption-empty` per `hidden` / `aria-hidden` und CSS `display:none`.
- Teiljahr-KPIs: `Verbrauch N von 12 Monaten`, `Ø erfasster Monat`, `Ø abgedeckter Tag`.
- Mobile: `Betriebskennzahlen` eingeklappt; FAB über der 69-px-Navigation; Karten `max-width:100%`.

### Betroffene Module

`js/dashboard-facility.js` (neu), `js/dashboard.js`, `js/meters-ui.js`, `js/historical-consumption.js`, `js/historical-consumption-ui.js`, `js/mobile-ux.js`, `index.html`, `css/theme-3.6.css`, Tests `historical-consumption-3-7-0.test.mjs` / `historical-consumption.spec.js`.

### Live TEST (mgr-a1, Port 5173, Sitzung vorhanden)

| Fläche | Ergebnis |
|--------|----------|
| Verbrauchskarte | `#consumption-empty` `display:none`; Select nur Alpha Nord |
| Dashboard-Filter | „Alle berechtigten Betriebe“ + Alpha Nord |
| Verbrauchskachel | 22 kWh gemessen (November 2026, unvollständig) |
| Historisch 2025 | Verbrauch 3 von 12 Monaten, 37.000 kWh |
| Management | Select und Kachel nur Alpha Nord; Besucher/Umsatz ohne TEST-Daten |
| Rechte | keine Erweiterung; andere Betriebe nicht sichtbar |

### Mobile (emuliert, angemeldet)

| Breite | Horizontaler Overflow | FAB vs. Navigation |
|--------|----------------------|--------------------|
| 320 px | 0 | Abstand 23 px, keine Überdeckung |
| 390 px | 0 | Abstand 23 px |
| 430 px | 0 | Abstand 23 px |

Karten in der Viewportbreite. `Betriebskennzahlen` als Klappabschnitt. Accessibility-Baum listet den Leersatz weiter, sichtbar ist er nicht.

### Automatisierte Tests (nach Restore von `js/supabase.js` auf PROD-URL)

Getrennt von der Live-Sitzung. Keine Schreibzugriffe auf TEST oder PROD.

| Art | Inhalt | Ergebnis |
|-----|--------|----------|
| Unit / Mock | `npm test` | **274/274**, 0 fehlgeschlagen |
| Playwright (Mock, Port 4179) | `historical-consumption.spec.js`, `mobile-ux-3-7.spec.js`, `mobile.spec.js` | **10/10** (desktop + smartphone) |

### Verbleibend

- GF- und Mitarbeiter-Live-UI ohne Sitzung
- Historische Excel-Übernahme weiter gesperrt
- Accessibility-Dump zeigt versteckten Leersatz
- Screenshot-Tool timeout bei 430 px; Maße per CDP

## Halt

Kein PROD, kein `main`, kein Pages, kein Commit, kein Push, kein Passwort-Reset.
