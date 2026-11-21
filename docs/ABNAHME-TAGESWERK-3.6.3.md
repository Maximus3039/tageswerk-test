# Abnahmebericht Tageswerk 3.6.3 (technisch, vor TEST-SQL)

Stand: 21.11.2026. Branch: `modularisierung`. Produktivversion unverändert **3.6.2**.

Keine PROD-SQL-Ausführung, kein Push auf `main`, kein GitHub-Pages-Deployment, keine produktiven E-Mails.

## Ergebnis

Die Anwendung 3.6.3 ist **technisch vorbereitet** für eine TEST-Abnahme. Die vier SQL-Dateien wurden nach der Vorprüfung **korrigiert**. Sie wurden **nicht** in TEST ausgeführt.

Automatisierte Tests: **234/234**. Playwright-Browser fehlen in dieser Umgebung (Chromium nicht installiert). UI-Spezifikation `tests/ui/abnahme-3-6-3.spec.js` ist hinterlegt.

## 1. SQL-Vorprüfung

| Datei | Syntax / Abhängigkeiten | RLS / Mandant | Integrität | Rückwärtskompatibel | Urteil |
|---|---|---|---|---|---|
| `tageswerk_3_6_3_material_movements_insert.sql` | braucht `material_movements`, `tageswerk_meter_role` | Policy neu, Trigger unverändert | EXISTS mit qualifizierten IDs | DROP/CREATE derselben Policy | bereit nach TEST-Vorprüfabfrage |
| `tageswerk_3_6_3_retry_staff_invitation.sql` | braucht `staff_invitations.error_detail`, `updated_at`, `private.can_manage_facility` | nur Leitungsbetrieb | keine Rollenänderung; blockt zweite offene Einladung | neue Funktion | bereit |
| `tageswerk_3_6_3_user_dashboard_layouts.sql` | `auth.users` | FORCE RLS, nur `auth.uid()` | CASCADE beim Benutzerlöschen | CREATE IF NOT EXISTS | bereit |
| `tageswerk_3_6_3_day_figure_import.sql` | `facility_day_figures`, `tageswerk_save_day_figures`, `tageswerk_figure_role` | SELECT/INSERT nur GF/BL | Transaktion über save_day_figures, Limit 800 | neue Tabelle/Funktion | bereit |

Lesende Kontrolle: `tageswerk_3_6_3_vorpruefung.sql` (kein Schreibzugriff).

### Gefundene SQL-Fehler (vor Korrektur)

1. Retry setzte `pending`, die Edge Function legte danach eine **zweite** Einladung an (`request_staff_invitation`).
2. Import-SQL erzeugte nur eine Protokolltabelle **ohne INSERT** und **ohne Sammelfunktion**.
3. Dashboard-Layouts nutzten `FOR ALL` und fehlendes `ON DELETE CASCADE`.
4. `search_path = ''` ohne `pg_catalog` bei `lower`/`btrim`/`jsonb_build_object`.

Diese Punkte sind in den SQL-Dateien und im Handler behoben.

## 2. Einladungsfunktion

| Prüfpunkt | Befund |
|---|---|
| Empfängeradresse | Wiederholungsfeld, Vorschau, Confirm-Dialog, `confirm_email` |
| Neue Benutzer | `inviteUserByEmail` mit bestätigter Adresse |
| Bestehende Benutzer | 422 → Status `sent`, keine zweite Mail an andere Adresse |
| Rolle/Betrieb | unverändert über `request_staff_invitation` |
| Erneut versenden | `retry_staff_invitation` + `invitation_id` Resume, kein zweites INSERT |
| Fehler | verständliche Meldungen, kein Zustellnachweis |

Edge Function bleibt lokal, **nicht bereitgestellt**, **nicht auf PROD überschreiben**.

TEST-Deploy erst nach Freigabe, nur Projekt `gamvnzggcrrlnyoknllu`:

`npx supabase functions deploy invite-staff --remote gamvnzggcrrlnyoknllu --no-verify-jwt --use-api`

Nicht `--prune`. Nicht `eqtrifscedpsngsysxvc`.

## 3. Historischer Import

XLSX/CSV: Parser und Dublettenregeln getestet. Digitale PDF: Zahlen nach dem Datum. Gescannte PDF: Ablehnung. Limit 800 Zeilen. Client speichert zeilenweise und stoppt; transaktional erst nach SQL `tageswerk_import_day_figures`.

## 4. Statistiken

364-Tage-Vergleich unverändert (`compareCalendarDay`). Fehlende Tage werden nicht als 0 summiert (`summarizeComparableWindow`). Prognose regelbasiert, bei dünner Datenlage `insufficient`.

## 5. Management-Dashboard

Nur Leitungsbetriebe. Heute/Monat/Jahr gleichzeitig. Offene Mängel klickbar. Konfig + Monitormodus im Formular. Raster per CSS, eine Spalte unter 768px. Mitarbeiter sehen den Einstieg nicht (`syncManagementAccess`). Server-Layouts erst nach SQL; sonst localStorage.

## 6. Tests

Neu/erweitert: Einladungs-Resume, Importlimit, PDF, Vergleichsfenster, SQL-Abnahme, Playwright-Spezifikation.

Playwright-Lauf: **fehlgeschlagen**, weil Chromium in der Agent-Umgebung nicht liegt. Spezifikation ist ausführbar nach `npx playwright install`.

## 7. Halt vor TEST-SQL

Die Vorprüfungsdatei ist vorbereitet. Die Ausführung in TEST braucht eine **ausdrückliche Freigabe** (Datenbankregel). Reihenfolge nach GO:

1. `tageswerk_3_6_3_vorpruefung.sql` (lesen)
2. Nur wenn alle relevanten Zeilen `ok`/`hinweis`, nicht `fehler`
3. `material_movements_insert` → `retry_staff_invitation` → `user_dashboard_layouts` → `day_figure_import`
4. Invite-staff nur TEST-Remote

## 8. Nächster Schritt

Freigabe für TEST-SQL und TEST-Edge. Danach Funktionsabnahme mit Testkonten, ohne Produktivpost.
