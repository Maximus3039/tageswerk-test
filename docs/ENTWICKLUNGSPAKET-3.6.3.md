# Tageswerk Entwicklungsbericht 3.6.3 (Paket bis 3.9.0)

Stand: 21.11.2026. Branch: `modularisierung`. Produktive Version unverändert 3.6.2. Kein Push auf `main`, keine GitHub-Pages-Veröffentlichung, keine PROD-SQL-Ausführung.

## 1. Ausgangszustand

Produktiv 3.6.2 mit Materialverwaltung, Wetter, persönlichen Warnfenstern. Einladungen liefen über Edge `invite-staff` und `request_staff_invitation`. Historischer Zählerimport hatte Vorschau; Kennzahlen hatten Wochentagsvergleich minus 364 Tage. `material_movements_insert` enthielt eine unqualifizierte `facility_id`-Bedingung.

## 2. Implementierte Funktionen

Siehe Abschnitte 4–10 und die TODO-Tabelle unten.

## 3. Behobene Fehler

- Einladung: Empfängeradresse kann nicht mehr still durch Autofill/Zweitfeld ersetzt werden.
- Bestehende Auth-Konten: `inviteUserByEmail` 422 führt nicht mehr zu Status `failed`, sondern zur hinterlegten Einladung ohne zweite Mail an eine andere Adresse.
- RLS `material_movements_insert`: Betriebsprüfung mit Tabellenqualifizierung vorbereitet.

## 4. Ursache des Einladungsfehlers

Kein fest hinterlegter Testempfänger im Anwendungscode. Die Edge Function sendet `inviteUserByEmail` mit der JSON-Adresse.

Tatsächliche Ursache: Das Einladungsformular lag auf derselben Seite wie Anmeldung und Mitarbeiterzuordnung, nutzte `type=email` und nur `autocomplete="off"`. Browser und Passwortmanager ignorieren das und setzen oft die gespeicherte Kontoadresse des Einladenden ein. Die Oberfläche zeigte die endgültig verwendete Adresse vor dem Versand nicht und holte den Wert erst beim Absenden aus dem Feld.

Maßnahmen: Wiederholungsfeld, sichtbare Vorschauzeile, Bestätigungsdialog, `confirm_email` im Aufruf, Handler vergleicht Bestätigung und gespeicherte Einladungszeile, Antwort enthält die tatsächlich verwendete Adresse. Keine Zustellung ins Postfach behaupten.

Die produktive Edge Function ist lokal korrigiert und laut Bestand **nicht bereitgestellt**. Ohne erneutes Deploy bleibt der Serverpfad der alte.

## 5–6. Neue und geänderte Dateien (Auswahl)

Neu: `js/invite-recipient.js`, `js/statistics.js`, `js/visitor-import.js`, `js/dashboard-layouts.js`, `js/management-dashboard.js`, SQL `tageswerk_3_6_3_*.sql`, Tests `invite-recipient.test.mjs`, `statistics.test.mjs`.

Geändert: `js/staff-ui.js`, `supabase/functions/invite-staff/handler.js`, `index.ts`, `index.html`, `js/app.js`, `js/defects.js`, `js/defects-ui.js`, `js/operations-ui-figures.js`, `css/theme-3.6.css`, `package.json`, Einladungs- und SQL-Tests.

## 7–8. Datenbank

Neu vorbereitet, nicht ausgeführt:

1. `tageswerk_3_6_3_material_movements_insert.sql`
2. `tageswerk_3_6_3_retry_staff_invitation.sql`
3. `tageswerk_3_6_3_user_dashboard_layouts.sql`
4. `tageswerk_3_6_3_day_figure_import.sql` (Importprotokoll-Tabelle)

Keine neuen Berechtigungen über Mitarbeiter/Techniker/Leitung hinaus. Dashboard-JSON speichert nur Ansichten, keine Betriebsrechte.

## 9. Oberflächen

Einladung mit Bestätigung; Management-Dashboard unter Mehr; Kennzahlen mit Umsatz/Besucher, Prognose und Dateiimport; Mängelstatistik und Überfälligkeit.

## 11–12. Tests

`npm test`: 226/226 bestanden (zuvor 219). Nicht ausgeführt: produktiver Mailversand, PROD-SQL, Playwright-UI in diesem Lauf, echte OCR-PDFs.

## 13. Nicht umgesetzt oder nur teilweise

- OCR für gescannte PDFs
- Transaktionaler Import ohne neue SQL (zeilenweise, Stopp beim ersten Fehler)
- XLSX/PDF-Statistikexport (Zahlen nutzen dieselbe Vergleichslogik; Dateiexport fehlt)
- Servergespeicherte Dashboard-Layouts ohne Migration (lokal per localStorage)
- Deploy der Edge Function `invite-staff`
- Erweiterte Verbrauchsgrenzwerte/Tarife/Kosten
- Backup-Jobs
- Versionsnummer 3.9.0 / PWA-Cache 3.6.3

## 15–16. Vor Produktivsetzung

1. TEST: SQL 3.6.3 in Reihenfolge unten.
2. TEST: Edge `invite-staff` mit `--no-verify-jwt` wie dokumentiert, nur Testprojekt.
3. Kontrollierte Testeinladung, niemals Produktivpostfach.
4. Freigabe, dann PROD SQL, dann Edge-Deploy, dann App-Release (Version dann anheben).

Migrationsreihenfolge: material_movements_insert → retry_staff_invitation → user_dashboard_layouts → day_figure_import.

## 17–18. Risiken und Empfehlung

Risiko: Autofill-Fix ohne Edge-Deploy wirkt nur in der Oberfläche. Bestehende Konten erhalten keine neue Invite-Mail. Zeilenweiser Import ist nicht atomar.

Nächste Veröffentlichung: 3.6.3 nach TEST der Einladung und der Materials-RLS, nicht 3.9.0.
