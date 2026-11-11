# Entwicklung

Tageswerk ist eine mehrbetriebliche PWA ohne Framework. Supabase ist das Backend. Entwickelt wird auf dem Branch `modularisierung`.

## Struktur

- `index.html`, `css/app.css`: Oberfläche
- `js/app.js`: Start, Navigation, Mängel
- `js/auth.js`, `js/permissions.js`, `js/state.js`: Anmeldung, Rollen, gemeinsamer Zustand
- `js/supabase.js`: Supabase-Client
- `js/meters.js`: Zähler, Ablesungen, Verbrauchsanzeige
- `js/operations.js`, `js/operations-store.js`, `js/operations-ui.js`: Tagesbericht, Kontrollgang, Wartung, Beschaffung
- `js/meter-import*.js`: historischer Excel-Import mit Vorschau und bestätigter Übernahme
- `vendor/xlsx.full.min.js`: lokales SheetJS
- `tageswerk_2_9_*.sql`: vorbereitete Migrationen und SQL-Prüfungen

Verbrauch wird nicht gespeichert. Die Anzeige berechnet ihn aus den Ablesungen.

## Regeln

JavaScript, HTML und CSS selbstständig ändern. Vorhandene Funktionen wiederverwenden.

Vorher fragen bei SQL-Ausführung, Änderungen an betrieblichen Daten, Sicherheitsarchitektur, Löschen größerer Bereiche, Commits, Pushes, Deployments und neuen kostenpflichtigen Diensten.

Historische Zählerstände nicht selbst importieren. Die Vorschau und die bestätigte Übernahme sind in der Oberfläche vorhanden. Ein echter Import braucht eine eigene Freigabe.

SQL-Dateien dürfen vorbereitet werden. Ausführen in Supabase braucht eine Freigabe. Vorhandene Migrationen nicht erneut einspielen. Zweisprachige Blattkürzel wie `Jan 90` liest der Excel-Konverter als Jahr 2090. Testdateien nutzen vierstellige Jahre, zum Beispiel `Jan 2020`.

## Tests

Die App bleibt ohne Laufzeitabhängigkeiten. Entwicklungsabhängigkeit ist nur Playwright. JavaScript-Tests nutzen den eingebauten Node-Testlauf und simulieren Supabase. Sie schreiben keine Zählerstände.

```powershell
npm test
npm run test:ui
npm run test:entwicklung
npm run test:ui:entwicklung
```

`npm test` prüft Syntax, Rollen, die sichtbare Betriebsgrenze, Excel-Konverter, Zählerzuordnung, historische Uhrzeiten, Vorschau, Importbestätigung, Übernahme, Duplikatschutz, die Zählerregeln und die simulierte Mandantentrennung. `npm run test:ui` prüft Anmeldung, Importkarte, Vorschau und die gesperrte Übernahme auf Desktop und Smartphone. GitHub Actions führt `npm test` und `npm run test:ui` aus und damit auch die Betriebsgrenze und die simulierte Mandantentrennung. `npm run test:entwicklung` und `npm run test:ui:entwicklung` bleiben erhalten.

Die Mandantentests simulieren Mitgliedschaften im Browsercode. Sie beweisen nicht, dass die Datenbank einen Mitarbeiter von einem fremden Betrieb fernhält.

Die SQL-Dateien `tageswerk_2_9_*_tests.sql` bleiben manuelle Prüfungen. GitHub Actions führt sie nicht aus.

## SQL-Stand am 9. November 2026

Keine dieser Dateien erneut ausführen.

- `tageswerk_2_9_historical_import.sql` und `tageswerk_2_9_historical_import_fix_01.sql` sind installiert und liegen im Repository. Die Übernahme von drei Testablesungen ist erfolgt.
- `tageswerk_2_9_migration.sql` enthält die ältere Fassung von `tageswerk_prepare_reading`. Ein erneutes Ausführen würde die Importfassung zurücksetzen. Die Datei ist nicht Teil des Repository-Stands.
- `tageswerk_2_9_consumption_periods.sql` und `tageswerk_2_9_consumption_calendar.sql` tragen den Hinweis „noch nicht ausführen“. Die View und die Kalenderfunktion waren am 9. November über die API lesbar. Der Hinweis ist damit veraltet. Die Dateien bleiben lokal.
- `tageswerk_2_9_meter_replacement.sql` trägt denselben Hinweis. Die Funktion war am 9. November vorhanden. Nicht aufrufen und nicht erneut ausführen.
- `tageswerk_2_9_meter_reactivation_guard.sql` ist die neuere Fassung von `tageswerk_prepare_meter` und war zum letzten Abgleich nicht die installierte Fassung. Nicht ausführen.
- Richtlinien für Mängel, Mitgliedschaften, Einladungen und Profile liegen nicht im Repository. `pg_policies` ist über die API nicht lesbar. Die Oberfläche filtert zusätzlich. Das ersetzt die fehlende Datenbankprüfung nicht.

## Betriebsmodule 3.0

Tagesbericht, Kontrollgang, Wartung und Beschaffung nutzen die vorhandene Rollenprüfung und die vorhandene Terminberechnung aus der Zählerfälligkeit. Die Oberfläche schreibt über die angemeldete Sitzung. Ein Eintrag erscheint erst, wenn die Datenbank die gespeicherte Zeile zurückgibt. Fehlt eine Tabelle oder Funktion, bleibt das Formular stehen und die Meldung nennt die fehlende Installation. Eine E-Mail-Zusammenfassung wird nur als Text vorbereitet und nicht versendet.

Installationsreihenfolge nach Freigabe. Die Dateien legen neue Tabellen und Funktionen an und ändern keine bestehenden Zähler- oder Mangelfunktionen. Datei 1 legt `tageswerk_bind_operation_facility` an. Die drei folgenden Dateien verwenden diese Funktion:

1. `tageswerk_3_0_daily_reports.sql`
2. `tageswerk_3_0_inspections.sql`
3. `tageswerk_3_0_maintenance.sql`
4. `tageswerk_3_0_procurement.sql`

Voraussetzung ist die bereits installierte Funktion `tageswerk_meter_role`. Der nächste Wartungstermin wird nicht gespeichert. Nachträge laufen über `tageswerk_update_daily_report`, Kontrollgänge über die Funktionen in der zweiten Datei. Mitarbeiter können Bedarf melden; Genehmigen und Ablehnen prüft der Trigger `tageswerk_review_procurement`.

## Git

Keine Commits ohne Freigabe. `main` nicht anfassen. Vor einem freigegebenen Commit `npm test` ausführen und nur die genannten Dateien übertragen.

## Neue Funktion

1. Vorhandene Module und SQL-Dateien lesen.
2. Die kleinste passende Erweiterung bauen.
3. Lokale Tests ergänzen, wenn die Funktion eine Regel oder einen Ablauf festlegt.
4. `npm test` ausführen. Bei sichtbarer Oberfläche zusätzlich `npm run test:ui`.
5. Einmal berichten und auf eine Freigabe warten, wenn Commit, SQL oder Datenänderung nötig sind.

## Installation 3.4 am 10. November 2026

Die sieben Migrationsdateien sind in der produktiven Datenbank ausgeführt. Die ersten sechs Kontrollen waren OK, die siebte Kontrolle war viermal `bereit`. Dieselben Dateien nicht erneut ausführen. `main` bleibt unverändert. Die Edge Function `invite-staff` ist im Projekt `eqtrifscedpsngsysxvc` als Version 9 aktiv. `verify_jwt` bleibt `false`.

| Modul | Datei |
| --- | --- |
| Temperaturkontrollen, Messwerte und Temperaturwarnungen | `tageswerk_3_1_temperature.sql` |
| Temperaturmessstellen mit Intervall, Deaktivierung und Schutz der Historie | `tageswerk_3_2_temperature_points.sql` |
| Wasserhygiene, Kontrollrunden und Zwischenspeicherung | `tageswerk_3_3_water_hygiene.sql` |
| Technikerrolle in Zählern, Mitgliedschaften und Mängeln | `tageswerk_3_4_technician_role.sql` |
| Einladungsrolle Mitarbeiter oder Techniker | `tageswerk_3_4_invitation_role.sql` |
| Aktive Verwaltungsberechtigung für Liste, Einladung, Widerruf und Namen | `tageswerk_3_4_management_guard.sql` |
| Fünfstellige Einladung mit Mitarbeiter- oder Technikerrolle | `tageswerk_3_4_invitation_role_parameter.sql` |

Eine Rolle gilt nur bei `is_active = true` und nur in der eigenen Organisation. Die Geschäftsführung ist in `tageswerk_meter_role` an `facility_id IS NULL` gebunden. Die Betriebsleitung, der Techniker und der Mitarbeiter sind an ihren Betrieb gebunden.

| Bereich | Geschäftsführung | Betriebsleitung | Techniker | Mitarbeiter |
| --- | --- | --- | --- | --- |
| Betriebe | alle der Organisation | eigener Betrieb | eigener Betrieb | eigener Betrieb |
| Temperaturmessstelle anlegen, ändern, deaktivieren | ja | ja | nein | nein |
| Temperatur erfassen, Grenzwert erkennen, Warnung quittieren | ja | ja | ja | ja |
| Becken und Grenzwerte | ja | ja | nein | nein |
| Wasserrunde beginnen, speichern, fortsetzen, abschließen | ja | ja | ja | ja, eigene offene Runde |
| Wasserhistorie, Warnungen und Maßnahmen sehen | ja | ja | ja | nein |
| Zähler anlegen, korrigieren, stornieren | ja | ja | nein | nein |
| Normalen Zählerstand erfassen | ja | ja | ja | ja |
| Zugewiesenen Mangel bearbeiten | ja | ja | ja | ja |
| Mitarbeiterverwaltung, Deaktivierung, Reaktivierung | ja, einschließlich Betriebsleitung | nur Mitarbeiter und Techniker des Betriebs, Reaktivierung nur mit derselben Rolle | nein | nein |
| Einladung versenden | Mitarbeiter oder Techniker | Mitarbeiter oder Techniker | nein | nein |

Die Reaktivierung einer deaktivierten Zuordnung verlangt dieselbe Rolle. Geschäftsführungszuordnungen bleiben in der Verwaltung gesperrt. Quittieren einer Warnung markiert die Kenntnisnahme und behebt die Abweichung nicht.

### Prüfung vor dem Livebetrieb

Die automatisierten Tests simulieren Supabase. Sie haben in der produktiven Datenbank keine Zeile geschrieben. Vor der Veröffentlichung der Oberfläche auf `modularisierung` bleibt dieser Durchgang je Rolle offen:

1. Temperatur: Messstelle anlegen, Wert innerhalb und außerhalb der Grenzen speichern, Warnung quittieren, Messstelle deaktivieren. Techniker und Mitarbeiter sehen die Stelle und speichern eine Messung. Sie legen keine Stelle an.
2. Wasser: Becken mit Grenzen anlegen, Runde beginnen, Werte speichern, Entwurf schließen und fortsetzen, Runde abschließen, Warnung und Historie prüfen. Der Mitarbeiter sieht die eigene offene Eingabe und nicht die gespeicherte Historie. Der Techniker sieht die Historie und ändert keine Grenze.
3. Techniker: zugewiesenen Mangel bearbeiten, normalen Zählerstand speichern, Korrektur und Storno bleiben gesperrt, Mitarbeiterkarte bleibt verborgen.
4. Verwaltung: Mitarbeiter deaktivieren und mit derselben Rolle reaktivieren, Techniker zuordnen, Einladung versenden und annehmen. Eine Betriebsleitung ernennt keine weitere Betriebsleitung.

Anmeldung, Mängel, Tagesbericht, Zählerstände und die bisherige Mitarbeiterverwaltung sind in den lokalen Tests weiterhin an die eigene Organisation und den eigenen Betrieb gebunden. Ein Lauf gegen die produktiven Konten steht noch aus.

### Edge Function invite-staff

Die produktive Funktion im Projekt `eqtrifscedpsngsysxvc` ist seit dem 11. November 2026 Version 9 und `ACTIVE`. `verify_jwt` bleibt `false`. Die Funktion prüft den Bearer-Token selbst mit `auth.getUser()`. Ein Aufruf ohne gültige Anmeldung legt keine Einladung an. Die Gateway-Prüfung ist damit nicht die erste Sperre. Eine erneute Bereitstellung muss diese Einstellung ausdrücklich beibehalten:

`npx supabase functions deploy invite-staff --remote=eqtrifscedpsngsysxvc --no-verify-jwt --use-api`

Der Funktionsname muss genannt sein. `--prune` darf nicht verwendet werden.

Die korrigierte lokale Fassung übernimmt Version 8 und ergänzt nur die Rolle. Erhalten bleiben CORS, `OPTIONS`, die Eingabeprüfung, `inviteUserByEmail`, `TAGESWERK_REDIRECT_URL`, die Status `pending`, `sent` und `failed`, die Statusänderung nur bei `pending`, `error_detail` und die Fehlerprotokolle. `employee` und `technician` gehen an die fünfstellige `request_staff_invitation`. Eine fehlende oder leere Rolle bleibt Mitarbeiter. Andere Rollen werden abgelehnt, bevor die Datenbankfunktion läuft. Der Dienstschlüssel schreibt keine Rolle und keine Mitgliedschaft.

Offen bleibt das bereits registrierte Konto. Version 8 erkennt es nicht gesondert. Jeder Versandfehler, auch `already registered`, setzt `failed` und speichert `error_detail`. Die Anmeldung ruft `accept_staff_invitation` für eine Einladung mit Status `sent` auf. Diese Annahme vergibt die gespeicherte Rolle nur, wenn noch keine Zuordnung für den Betrieb besteht, und ändert eine bestehende oder deaktivierte Mitgliedschaft nicht. `sent` würde deshalb beim nächsten Login eine neue Zuordnung anlegen, ohne dass Version 8 dafür einen eigenen Weg enthält. Dieses Verhalten bleibt deshalb unverändert. Die Oberfläche enthält noch einen Erfolgssatz für `existing_account`. Die korrigierte Funktion liefert dieses Feld nicht.

Die veröffentlichte Oberfläche auf `main` sendet keine Rolle. Daraus wird weiterhin ein Mitarbeiter. Die Oberfläche auf `modularisierung` sendet Mitarbeiter oder Techniker.

### Testergebnis am 11. November 2026

- `npm test`: 82 bestanden, 0 fehlgeschlagen. Syntax, Rollen, Temperatur, Wasser, Techniker, Einladung, Mängel, Tagesbericht, Zähler und Mandantentrennung.
- `npm run test:ui`: 8 bestanden, 0 fehlgeschlagen. Desktop und Smartphone, ohne Schreibzugriff auf die Datenbank.
- `npm run test:integration`: nicht gestartet. Es ist keine bestätigte Testdatenbank gesetzt, und die produktive Verbindung wird abgelehnt.

Festgestellte Fehler in diesem Lauf: keine. Die sichtbare Kennung ist `3.4.2`. Der Service Worker ersetzt nur den statischen Anwendungscache. Sitzungen, lokale Entwürfe und Datenbankzeilen bleiben erhalten.

Offen vor dem Livebetrieb:

- Der beschriebene Durchgang der vier Rollen in der produktiven Oberfläche. Dabei dürfen keine Testeinladungen ohne Freigabe versendet und keine Betriebsdaten verändert werden.
- Ein bereits registriertes Konto bleibt bei einem Versandfehler auf `failed`. Die Oberfläche zeigt dafür keinen eigenen Erfolgssatz.
- Die Veröffentlichung von `modularisierung` auf `main` braucht eine eigene Freigabe. `main` wird dafür nicht verändert.
