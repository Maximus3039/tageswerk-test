# Tageswerk 3.7.0 – Mobile UX-Optimierung

Stand: 21.11.2026. Branch `modularisierung`. Keine Produktivsetzung, keine SQL-Ausführung, kein Push auf `main`.

## 1. Untersuchte Seiten

Untersucht wurden Dashboard, Management-Dashboard, Betriebswechsel (Spotlight), Tagesgeschäft/Agenda, Hinweise, Mängel/Vorgänge, Betriebserfassung (Tagesberichte, Kennzahlen, Wasser, Temperatur, Filterspülung, Kontrollgänge, Wartung, Material, Beschaffung), Zählerstände/Verbrauch, Einladungen, Mitarbeiter, Eskalation, Betriebsanlage, Dialoge (Erfassen-Sheet, Mangel-Composer, Filter-Sheet), Tabellen der Tageskennzahlen und Filterleisten.

## 2. Erkannte UX-Probleme

- Die untere Navigation hatte fünf gleichwertige Einträge; Erfassen und Hinweise verlängerten die Leiste und verdrängten Vorgänge.
- Mehr zeigte alle Module untereinander: Betriebserfassung, Verbrauch, Management-Konfiguration, Historie, Einladungen, Stammdaten.
- Management-Darstellung, Zählerverwaltung und Material-Stammdaten lagen in der täglichen Arbeitsfläche.
- Mängelfilter und Kennzahlentabellen füllten den ersten Bildschirm.
- Listen und Historien luden optisch die ganze Seite, ohne Begrenzung.

## 3. Umgesetzte Verbesserungen

- Mobile Bottom-Navigation: Dashboard, Tagesgeschäft, Vorgänge, Mehr.
- Erfassen als gelber FAB über der Leiste; bestehendes Capture-Sheet unverändert.
- Hinweise über Reiter in Vorgänge.
- Mehr-Hub mit Gruppen Tagesgeschäft, Verwaltung, Auswertungen, Einstellungen; rollenabhängig über `isManager` / `mayAppointManager` (keine Regeländerung).
- Filter der Mängelliste im Bottom-Sheet; aktive Leiste wird nach dem Schließen zurückgesetzt.
- Seltene Blöcke in `<details>`: Management-Darstellung, Eskalation, Zählerverwaltung, historische Kennzahlen, Material-Stammdaten, frühere Berichte, Checklisten-Anlage.
- Listen auf dem Telefon zunächst 8–12 Einträge, Rest über „Weitere anzeigen“.
- Formularentwürfe in `sessionStorage` für Mangel, Einladung und Anmeldung.

## 4. Neue Menüstruktur (Smartphone)

| Eintrag | Ziel |
| --- | --- |
| Dashboard | Start, Aufgaben, kritische Hinweise, Schnellaktionen |
| Tagesgeschäft | Agenda (überfällig / heute / demnächst) |
| Vorgänge | Mängel, Hinweise-Reiter, Filter-Sheet |
| ＋ Erfassen | Capture-Sheet (Mangel, Zähler, Wasser, Temperatur, Bericht, Beschaffung) |
| Mehr · Tagesgeschäft | Betriebserfassung, Zählerstände |
| Mehr · Verwaltung | Management, Mitarbeiter, Einladungen, Betrieb anlegen, Eskalation |
| Mehr · Auswertungen | Kennzahlen, Verbrauch |
| Mehr · Einstellungen | Dashboard-Darstellung |

Desktop behält die seitliche Navigation (Start, Tagesgeschäft, Erfassen, Hinweise, Mängel, Meine Mängel, Mehr).

## 5. Ausgelagerte Einstellungen

- Management: Kacheln, Kennzahlen, Presets, Monitor hinter „Darstellung und Kennzahlen“. Reihenfolge-Pfeile auf Kacheln am Telefon ausgeblendet.
- Zähler: Verwaltungsformular hinter „Zählerverwaltung“. Die Ablesung bleibt oben.
- Material: Anlegen, Stammdaten und Deaktivieren hinter Aufklappbereichen. Bestand und Buchung bleiben sichtbar.
- Tagesberichte: Erfassung bleibt offen; Filter und Historie hinter „Frühere Berichte“. Historische Kennzahlen hinter vorhandenem Einstellungsblock.
- Eskalationsregeln hinter Aufklappbereich.

## 6. Verkürzte Seiten (sichtbare Bereiche)

Zählung: dauerhaft sichtbare Karten/Blöcke auf dem ersten Bildschirm eines Smartphones, ohne aufgeklappte Selten-Bereiche.

| Seite | Vorher | Nachher |
| --- | --- | --- |
| Mobile Navigation | 5 Tabs | 4 Tabs + FAB |
| Dashboard | Kommando, Spotlight, KPI, Listen, Quick, Wetter, Verbrauch | dieselben Kernblöcke, Listen gekappt |
| Vorgänge | Orgs, Betriebe, Toolbar, Filterleiste, Liste, Composer | Tabs, Toolbar, Filter-Button, Liste |
| Mehr | Modul-Kacheln plus alle Karten untereinander | Hub-Gruppen; Modul-Kacheln am Telefon ausgeblendet |
| Management | Config-Formular + Kacheln | Kacheln; Config eingeklappt |
| Zählerstände | Verwaltung + Ablesung + Liste | Ablesung + Liste; Verwaltung eingeklappt |
| Material | Stammdatenfelder in jeder Karte | Bestand/Buchung; Stammdaten eingeklappt |
| Tagesbericht | Formular + Historie | Formular; Historie eingeklappt |

## 7. Optimierte Formulare

- Größere primäre Speichern-Schaltflächen am Telefon (`min-height: 48px`).
- Dezimal-Tastaturen unverändert bei Messwerten.
- Entwürfe über `sessionStorage`, Datei- und Passwortfelder ausgeschlossen.
- Capture-Sheet mit Safe-Area unten.

## 8. Mobile Tabellenansichten

Kennzahlentabellen bleiben in der historischen Ansicht und liegen hinter „Alle Tage anzeigen“ bzw. Einstellungen. Horizontaler Überlauf der Wrapper ist begrenzt (`overflow-x: auto`, `max-width: 100%`). Keine Miniatur-Desktop-Tabelle als Daueransicht.

## 9. Testergebnisse

- `npm test`: 254/254 bestanden (inkl. `tests/committed/mobile-ux.test.mjs`).
- `npm run test:ui`: 77 bestanden, 1 übersprungen (Kennzahlen-Kompakttest nur Smartphone). FAB, Filter-Sheet, Mehr-Hub und Viewports 320–768 sind abgedeckt. Kennzahlen-Presets: fünf Schaltflächen inkl. „Aktuelle Woche“.

## 10. Noch offen

- Keine eigene Unterseite pro Statistikdiagramm; Auswertungen bleiben im Management- bzw. Verbrauchsmodul.
- Querformat-Tablet zwischen 768 und 850 px nutzt noch die mobile Leiste (gewollt bis Breakpoint 850).
- Paginierung großer Server-Listen bleibt an den bestehenden RPCs; clientseitig nur Kappung der dargestellten Karten.
- Foto-Upload am Mangel unverändert; keine neue Kamera-UI.
- Produktiv-Pin bleibt 3.6.3 auf GitHub Pages.

## Rollen

Mitarbeiter sehen im Mehr-Hub kein Management und keine Verwaltungsgruppe. `isManager`, Statuswerte und RLS sind unverändert.
