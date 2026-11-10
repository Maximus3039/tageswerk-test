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

Die sechs Migrationsdateien sind in der produktiven Datenbank ausgeführt. Die anschließende SQL-Kontrolle hat für alle 13 geprüften Objekte den Status OK ergeben. Dieselbe Datei nicht erneut ausführen. `main` bleibt unverändert. Die Edge Function `invite-staff` ist nicht bereitgestellt.

| Modul | Datei |
| --- | --- |
| Temperaturkontrollen, Messwerte und Temperaturwarnungen | `tageswerk_3_1_temperature.sql` |
| Temperaturmessstellen mit Intervall, Deaktivierung und Schutz der Historie | `tageswerk_3_2_temperature_points.sql` |
| Wasserhygiene, Kontrollrunden und Zwischenspeicherung | `tageswerk_3_3_water_hygiene.sql` |
| Technikerrolle in Zählern, Mitgliedschaften und Mängeln | `tageswerk_3_4_technician_role.sql` |
| Einladungsrolle Mitarbeiter oder Techniker | `tageswerk_3_4_invitation_role.sql` |
| Aktive Verwaltungsberechtigung für Liste, Einladung, Widerruf und Namen | `tageswerk_3_4_management_guard.sql` |

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

Die bereitgestellte Funktion wurde nicht heruntergeladen und nicht ersetzt. Im Repository liegt ausschließlich die vorbereitete Fassung unter `supabase/functions/invite-staff`. Die veröffentlichte Oberfläche auf `main` (`98d6d9c`) sendet `facility_id`, `email`, `first_name` und `last_name`, ohne `role`.

Die vorbereitete Fassung unterscheidet sich in diesem Vertrag:

- `role` darf fehlen oder leer sein und gilt dann als `employee`, damit der bisherige Aufruf Mitarbeiter einlädt.
- `technician` wird gespeichert. `facility_manager` und `company_admin` werden abgelehnt.
- Aufrufer ist eine aktive Geschäftsführung ohne Betrieb oder die aktive Betriebsleitung dieses Betriebs.
- Die Zeile entsteht mit Status `pending`, der Versand läuft über `inviteUserByEmail`, danach steht `sent` oder bei einem Versandfehler `failed`.
- Die Annahme bleibt `accept_staff_invitation` und übernimmt die gespeicherte Rolle. Der Eingeladene wählt sie nicht selbst.

Vor einem Austausch muss die heruntergeladene Live-Quelle mit dieser Fassung verglichen werden. Die Live-Funktion muss `role` speichern und eine fehlende Rolle als Mitarbeiter behandeln. Die neue Oberfläche sendet die Rolle bereits. Solange die Live-Funktion das Feld nicht übernimmt, entsteht aus einer Technikereinladung ein Mitarbeiter, weil `staff_invitations.role` sonst den Standard `employee` erhält. Der Dienstschlüssel bleibt in der Funktionsumgebung.

### Testergebnis am 10. November 2026

- `npm test`: 80 bestanden, 0 fehlgeschlagen. Syntax, Rollen, Temperatur, Wasser, Techniker, Einladung, Mängel, Tagesbericht, Zähler und Mandantentrennung.
- `npm run test:ui`: 8 bestanden, 0 fehlgeschlagen. Desktop und Smartphone, ohne Schreibzugriff auf die Datenbank.
- `npm run test:integration`: nicht gestartet. Es ist keine bestätigte Testdatenbank gesetzt, und die produktive Verbindung wird abgelehnt.

Festgestellte Fehler in diesem Lauf: keine.

Offen vor dem Livebetrieb:

- Der beschriebene Durchgang der vier Rollen in der produktiven Oberfläche.
- Der Vergleich der heruntergeladenen Edge Function mit der vorbereiteten Fassung und erst danach eine gesonderte Freigabe zur Bereitstellung.
- Die Veröffentlichung von `modularisierung`. Sie ist von dieser Datenbankinstallation getrennt und braucht eine eigene Freigabe. `main` wird dafür nicht verändert.
- Die sechs installierten SQL-Dateien bleiben stehen.
