# Design- und UX-Überarbeitung 3.6.0 v2

**Branch:** `entwicklung/tageswerk-3.6.0`  
**Commit:** `0cbde89`  
**Pages-Pin:** unverändert `240a2e8` (3.5.7)  
**Kein Push / keine DB-Änderungen**

## Durchgeführte Änderungen

1. **Designsystem v2** (`css/tokens.css`, `css/theme-3.6.css`): tieferes Anthrazit/Marineblau, helleres Blau, Gelbakzent, weniger Rahmen/Padding, kompaktere Typo.
2. **Login:** Marke, Slogan, Formular; technische Hinweise hinter `<details>`; Datenhaltung auf der Login-Ansicht ausgeblendet; Sicherheits-Hinweis bleibt sichtbar.
3. **Dashboard:** Command-Header (Begrüßung + Betrieb), KPI-Strip, kompaktes Wetter/Verbrauch, Betriebsmetriken verdichtet.
4. **Smartphone:** 2-Spalten-KPIs, kompaktes Wetter, Bottom-Nav, weniger Vertikalraum.
5. **Mängel:** Liste zuerst; Formular erst über „+ Neuen Mangel“; mobil Vollbild-Sheet; Standardfilter „Offene Vorgänge“.
6. **Betriebsmodule:** Modulkarten mit Icon + Label im Raster (2 Spalten mobil / 4 Desktop).
7. **Navigation:** Sidebar/Bottom-Nav optisch geschärft, aktive Zustände klar.

## UX-Verbesserungen

- Schnellerer Einstieg in Mängel und Module
- Weniger Scrollen auf dem Smartphone-Dashboard
- Weniger technische Texte im Hauptblickfeld
- Klarere Informationshierarchie

## Responsive Anpassungen

Geprüft über CSS-Breakpoints und UI-Tests für Smartphone/Desktop (u. a. 360–1920-Orientierung in Theme-Regeln). Kein ungewollter Horizontal-Overflow in den Design-v2-Tests.

## Testergebnisse

- `npm test`: **196/196**
- `npm run test:ui`: **47 bestanden, 1 skipped** (inkl. `design-v2.spec.js`)

## Offene Probleme

- Org-/Betriebs-Karten über Mängeln auf Desktop weiterhin sichtbar (mobil ausgeblendet)
- Wetter ohne Facility-Koordinaten bleibt leer (bewusst)
- Manuelle Feinschliff-Abnahme der neuen Screenshots empfohlen

## Screenshots

`docs/design-review-3.6.0-v2/`

## Fachliche Grenzen

Keine Änderungen an Supabase-Rollen, RLS, Tabellen, RPC oder Verbrauchsberechnungen.
