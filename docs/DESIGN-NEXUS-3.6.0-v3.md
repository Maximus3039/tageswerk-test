# Tageswerk Nexus – Designphase V3

**Arbeitstitel:** Tageswerk Nexus  
**Produktname:** Tageswerk  
**Branch:** `entwicklung/tageswerk-3.6.0`  
**Commit:** wird nach dem Commit ergänzt  
**Pages-Pin:** unverändert `240a2e8` (3.5.7)

## Neue Hintergrundgestaltung

- Mehrschichtiger CSS-Hintergrund (`body.nexus::before` / `::after`)
- Dunkler Verlauf Anthrazit → Marineblau → Tiefschwarz
- Feines technisches Raster mit Maske
- Dezente blaue/gelbe Lichtflächen
- Keine Bilddateien

## Neue Kartengestaltung

- Halbtransparente Surfaces (`--nexus-surface`)
- Feine Konturen und Lichtkante oben
- Akzentlinie links, weiche Schatten
- Tokens: `--nexus-bg`, `--nexus-surface`, `--nexus-border`, `--nexus-glow`, `--nexus-accent`, `--nexus-text`

## Navigation

- Desktop-Sidebar mit Glas-/Kontureffekt und Glow beim aktiven Eintrag
- Bottom-Nav funktional erhalten, optisch mit Transparenz und Kontur modernisiert

## Dashboard

- Kopfzeile **BETRIEBSZENTRALE**
- Betrieb, Datum (Berlin), Status aus echten Kennzahlen
- KPI: Offene Mängel, Aufgaben, Kritische Meldungen, Laufende Vorgänge
- V2-Kompaktheit (Wetter/Verbrauch/Module) bleibt

## Login

- Futuristische Einstiegskarte
- Slogan: **Dein Betrieb. Dein Überblick.**
- Login-Logik unverändert

## Mobile Anpassungen

- Reduzierte Raster-/Glow-Intensität
- 2-Spalten-KPIs und Modulkarten
- Touch-Ziele und kein Horizontal-Overflow in den UI-Tests

## Testergebnisse

- `npm test`: 196/196
- `npm run test:ui`: 51 bestanden, 1 skipped

## Screenshots / ZIP

- Ordner: `docs/design-review-3.6.0-v3/`
- Desktop-ZIP: `Tageswerk-3.6.0-Design-v3.zip`

## Grenzen

Keine Änderungen an Supabase, RLS, Rollen, Fachlogik oder Verbrauchsberechnungen.
Kein Push, keine Veröffentlichung.
