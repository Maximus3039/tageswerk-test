# Sicherheitsbewertung Migrationen 3.6.0

## Scope

Vorbereitete Dateien (nicht ausführen ohne Freigabe):

- `tageswerk_3_6_0_facility_location*.sql`
- `tageswerk_3_6_0_daily_report_weather*.sql`

## Bewertung

| Thema | Einschätzung |
|-------|--------------|
| RLS | Keine Policy-Änderung. Neue Spalten erben bestehende Tabellen-RLS. |
| Datenverlust | Additive Spalten mit NULL/Default. Bestehende Zeilen bleiben lesbar. |
| Secrets | Open-Meteo ohne API-Schlüssel. Keine neuen Frontend-Geheimnisse. |
| Rechte | Keine neuen SECURITY DEFINER-Funktionen. |
| Mandanten | Keine quer-tenant Joins oder Views. |

## Rollback

1. Facility-Koordinaten: `ALTER TABLE facilities DROP COLUMN latitude, DROP COLUMN longitude;` (nur wenn ungenutzt).
2. Wetterspalten: Spalten an `daily_reports` droppen, nachdem Clients die Felder nicht mehr schreiben.

## Freigabe nötig für

- Ausführung der Migrationen in der produktiven Supabase-Instanz
- Befüllen echter Koordinaten
- Veröffentlichung / Pages-Pin / Push
