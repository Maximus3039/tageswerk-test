# Tageswerk 3.6.0 – Design Nexus V4

Visuelle Überarbeitung der Betriebsoberfläche in Richtung futuristischer Smartphone-Leitstand. Geschäftslogik, Supabase, RLS und Berechtigungen unverändert. GitHub-Pages-Pin bleibt auf 3.5.7 / `240a2e8`.

## Vorher (Nexus V3) → Nachher (Nexus V4)

| Merkmal | V3 | V4 |
|---------|----|----|
| Farbkern | Blau/Gold-Leitstand | Tiefdunkel + Cyan-Neon, Gelb/Rot/Grün gezielt |
| Karten | Glass/Glow leicht | Mehrschichtige Schatten, Cyan-Kanten, plastische Neon-Kacheln |
| Header | Betriebszentrale-Kicker | Markenzeile Tageswerk/Nexus + persönliche Begrüßung |
| Betrieb | Filterzeile | Hervorgehobene Auswahl + Spotlight mit Statuschips (Bild nur bei echten URLs) |
| KPIs | Kompakte Statuskarten | Neon-KPI mit Tonfarben (kritisch rot, Aufgaben gelb) |
| Module | Kacheln mit Glyph-Icons | Zweispaltige Neon-Tiles + einheitliche SVG-Icons + Akzentfarben |
| Navigation | Aktives Gelb | Beleuchtetes aktives Element + SVG-Nav-Icons |
| Desktop | V3-Übertrag | Großzügigere Zentrale, gleiche Tokens |

## Umgesetzte Referenzmerkmale

- Tiefdunkler Hintergrund mit technischem Raster
- Cyan-Kanten für Standardmodule, Gelb/Rot/Grün als Akzente
- Glow und Mehrschichtschatten an Karten, Tiles, Bottom-Nav
- Große SVG-Icons (`js/nexus-icons.js`)
- Marken-Header, Begrüßung mit Anzeigename (falls vorhanden)
- Betriebs-Spotlight und Neon-Statuschips aus echten Zählern
- Modulraster 2-spaltig mobil
- `prefers-reduced-motion` über `--nexus-motion`

## Technisch noch fehlend / bewusst nicht nachgebaut

- Referenz-Demo-Zahlen und erfundene Kennzahlen (nicht als Live-Daten)
- Betriebsfoto nur, wenn `image_url` / `photo_url` / `cover_url` am Betrieb existiert
- Keine neuen Funktionsmodule aus dem Referenzbild
- Kein 3D-Parallax / schwere Animationen (Performance, Reduced Motion)
- Referenzgrafik lag lokal nicht zuverlässig vor; Umsetzung folgt den Phasen 1–6 der Vorgabe

## Dateien

- `css/tokens.css`, `css/theme-3.6.css`
- `index.html` (`body.nexus-v4`, Brand, Spotlight, Neon-Tiles)
- `js/nexus-icons.js`, `js/mobile.js`, `js/dashboard.js`, `js/app.js`
- Tests: `tests/ui/design-v4.spec.js`, Theme-Assertions
- Screenshots: `docs/design-review-3.6.0-v4/`

## Qualität

- Keine Schema-/RLS-/Auth-Änderungen
- Keine erfundenen produktiven Live-Daten in der App
- Screenshots nutzen nur visuelle Demo-Beschriftungen
- `npm test` und `npm run test:ui` vor Commit
