# Testbaseline Tageswerk 3.6.0

Ausgeführt nach Design-Freeze `7f199d9` und Docs/Notice-Commits `b06b3b5` / `d8b5201`.  
HEAD zum Lauf: `d8b5201a754e8d09c94f4cd2aa6d50c6571e3fb3`  
Keine produktiven Schreibzugriffe.

## Befehle

| Befehl | Vorhanden | Sicherheit | Ergebnis |
|--------|-----------|------------|----------|
| `npm test` (vor Erweiterung) | Ja | lokal Mocks/Fixtures | **196 pass / 0 fail / 0 skip** · ≈ 17 s Wall |
| `npm test` (nach Auth-/Dashboard-Tests) | Ja | lokal | **201 pass / 0 fail / 0 skip** · Node ≈ 1485 ms · Wall ≈ 18 s · Syntax 150 Dateien |
| `npm run test:ui` | Ja | Playwright + Mock-Supabase, Abort prod hosts | **69 pass / 0 fail / 1 skip** · ≈ 31 s Playwright / ≈ 37 s Wall |
| `npm run check` | Ja (Teil von `npm test`) | Syntax | bestanden |
| Lint / Build | **Nein** in `package.json` | — | nicht anwendbar |
| Viewport-Skripte | `scripts/viewport-check-v43.mjs` | lokal | nicht erneut in diesem Lauf; Design-Freeze bereits geprüft |
| `test:integration*` | Ja | **Produktiv-Marker-Sperre** | bewusst **nicht** ausgeführt (kein Testprojekt) |

## Unit (`npm test`)

- Reproduzierbar: zweiter Stichprobenlauf der berührten Suites zuvor ebenfalls grün
- Integration-Harness/Filter-Integration: starten ohne bestätigte Test-DB und bestehen als Guard-Tests
- Keine Fehlermeldungen außer erwarteten simulierten RPC-Fehlermeldungen in Wasser-Tests

## UI (`npm run test:ui`)

- **70** spezifizierte Läufe (Desktop + Smartphone Projekte)
- **69 bestanden**, **1 übersprungen** (bestehender Skip, Importvorschau/Entwicklung)
- Enthält erneut: Design V2–V4.3, Mängelarchiv, Day Figures, Password Reset, Water Filters/History, Smoke, Mobile, Operations, Temperature, Notice-Regression (`design-v43`)

**Hinweis:** Die früher genannten „67 bestanden“ gelten nicht mehr als Nachweis für den aktuellen Stand; dieser Lauf ersetzt sie.

## Klassifikation der Nachweise

| Art | In dieser Baseline |
|-----|--------------------|
| Unit-Test | Ja |
| UI-Test | Ja |
| Mock-Integration | Ja (Guards) |
| Statischer SQL-/Sicherheitsnachweis | Ja (in Unit) |
| Tatsächlicher Datenbanknachweis | **Nein** (kein Testprojekt; Prod-Schreiben verboten) |
