# Entwicklung

Tageswerk ist eine mehrbetriebliche PWA ohne Framework. Supabase ist das Backend. Entwickelt wird auf dem Branch `modularisierung`.

## Struktur

- `index.html`, `css/app.css`: Oberfläche
- `js/app.js`: Start, Navigation, Mängel
- `js/auth.js`, `js/permissions.js`, `js/state.js`: Anmeldung, Rollen, gemeinsamer Zustand
- `js/supabase.js`: Supabase-Client
- `js/meters.js`: Zähler, Ablesungen, Verbrauchsanzeige
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

`npm test` prüft Syntax, Rollen, Excel-Konverter, Zählerzuordnung, historische Uhrzeiten, Vorschau, Importbestätigung, Übernahme, Duplikatschutz und die Zählerregeln. `npm run test:ui` prüft Anmeldung, Importkarte, Vorschau und die gesperrte Übernahme auf Desktop und Smartphone. GitHub Actions führt diese beiden Befehle aus. `npm run test:entwicklung` und `npm run test:ui:entwicklung` bleiben erhalten und prüfen dieselben Import- und Zählerfälle.

Die SQL-Dateien `tageswerk_2_9_*_tests.sql` bleiben manuelle Prüfungen. GitHub Actions führt sie nicht aus.

## Git

Keine Commits ohne Freigabe. `main` nicht anfassen. Vor einem freigegebenen Commit `npm test` ausführen und nur die genannten Dateien übertragen.

## Neue Funktion

1. Vorhandene Module und SQL-Dateien lesen.
2. Die kleinste passende Erweiterung bauen.
3. Lokale Tests ergänzen, wenn die Funktion eine Regel oder einen Ablauf festlegt.
4. `npm test` ausführen. Bei sichtbarer Oberfläche zusätzlich `npm run test:ui`.
5. Einmal berichten und auf eine Freigabe warten, wenn Commit, SQL oder Datenänderung nötig sind.
