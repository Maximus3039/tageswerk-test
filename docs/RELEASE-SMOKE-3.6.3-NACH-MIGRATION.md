# Funktionsprüfung veröffentlichte 3.6.3 nach PROD-Migration 3.7.0

Stand: 23.11.2026, 11:35. Öffentliche URL: `https://maximus3039.github.io/tageswerk-test/`. PROD: `eqtrifscedpsngsysxvc`.

Nur lesen. Keine Testdaten, kein Passwort-Reset, kein Deployment, kein Push, keine weitere SQL-Migration.

## Urteil

| Prüfung | Ergebnis |
|---------|----------|
| Veröffentlichte Version | **bestanden** — Titel und Überschrift **Tageswerk 3.6.3** |
| Frontend spricht PROD | **bestanden** — `js/supabase.js` auf Pages: `eqtrifscedpsngsysxvc.supabase.co` |
| Login-Oberfläche | **bestanden** — E-Mail, Passwort, Anmelden sichtbar |
| GoTrue / E-Mail-Login | **bestanden** — Auth-Settings HTTP 200, Provider `email` |
| Anmeldung mit bestehendem Konto | **bestanden** — Sitzung in der öffentlichen 3.6.3, Status „Anmeldung und Datenbankabfrage erfolgreich“, Live verbunden |
| Dashboard | **bestanden** — Begrüßung, Kennzahlen, Wetter, Verbrauchskachel, Hinweise |
| Zugeordnete Betriebe | **bestanden** — 1 Unternehmen, 2 Betriebe: Prignitzer Badewelt, Strandbad Friedensteich |
| Betriebswechsel | **bestanden** — Wechsel auf Strandbad Friedensteich: KPIs 0, Verbrauch „Keine Daten“, Wetter ohne Standort |
| Mängelübersicht | **bestanden** — Alle Betriebe: 3 offen, Überschrift Mängel 10 inkl. Archiv. Strandbad: 0 offen, Archiv 1 |

Gesamt nach angemeldeter Sitzung 23.11.2026 ca. 12:06: **bestanden** für Dashboard, Betriebsauswahl, Betriebswechsel und Mängel. Keine Datensätze angelegt oder geändert.

## Was geprüft wurde

1. Pages lädt `https://maximus3039.github.io/tageswerk-test/?v=363`.
2. Kein localStorage-Auth im Cursor-Browser (`sessionKeys` leer).
3. Auth-Settings der Produktiv-API antworten (Signup-Flag und Mailer nicht verändert; nur gelesen).
4. TEST-Konten (`@test.tageswerk.local`, Datei unter `%TEMP%`) wurden **nicht** gegen PROD verwendet.

## Live-Smoke (angemeldet, nur lesen)

- Dashboard: „Guten Tag, Maximilian!“, 3 offene Mängel bei „Alle berechtigten Betriebe“, Verbrauchskachel mit Kalender-RPC (HTTP 200), Live-Anzeige verbunden.
- Betriebe in der Auswahl: Alle berechtigten Betriebe, Prignitzer Badewelt, Strandbad Friedensteich. Verbindungstest: 1 Unternehmen, 2 Betriebe.
- Wechsel auf Strandbad Friedensteich: Dashboard ohne offene Hinweise/Mängel; Verbrauch „Keine Daten“ (kein Fehler); Wetter „Kein hinterlegter Standort“ (kein Schreibversuch).
- Mängel: Ansicht „Alle Mängel“ lädt. Über alle Betriebe: Offen 3 (u. a. bestehende Titel an der Badewelt), Archiv 7. Filter Strandbad: Offen 0, Archiv 1. `GET /rest/v1/defects` HTTP 200.
- Nicht angeklickt: Speichern, Mangel anlegen, Archivieren, Standort schätzen.

## Konsole / Netz

Keine JavaScript-Ausnahme in der Statuszeile. Netz (Performance):

| Aufruf | Befund |
|--------|--------|
| `/auth/v1/token` | einmal 400, danach 200 (Anmeldeversuch vor Erfolg) |
| `/rest/v1/staff_invitations` | einmal 400, Wiederholung 200 — Liste danach sichtbar |
| `tageswerk_consumption_calendar` | mehrfach 200 |
| `organizations`, `facilities`, `memberships`, `defects` | 200 |

Der 400er auf Einladungen ist ein einmaliger Schema-/Select-Retry der 3.6.3-UI, kein Migrationsfehler und kein Schreibzugriff.

## Katalog (bereits nach Migration)

Unverändert und von 3.6.3 genutzt: Kalender 6 Argumente, Prepare-Reading, defects SELECT, facilities SELECT. Neue 3.7.0-Objekte werden von 3.6.3 nicht aufgerufen.
