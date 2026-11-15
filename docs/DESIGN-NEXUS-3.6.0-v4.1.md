# Tageswerk 3.6.0 – Design Nexus V4.1

Feinschliff auf Basis von V4: kompakteres Smartphone-Dashboard, keine doppelte Betriebszeile, stärkere Neon-Tiefe. Geschäftslogik, Supabase, RLS und Berechtigungen unverändert. Kein Commit in diesem Arbeitsschritt; Pages-Pin bleibt 3.5.7 / `240a2e8`.

## Vorher (V4) → Nachher (V4.1)

| Merkmal | V4 | V4.1 |
|---------|----|------|
| Kopf | Brand + Kicker + Begrüßung + Betriebsname + Status + Spotlight + separate Auswahl | Kompakte Kopfzeile (Brand + Status), Begrüßung, Spotlight mit integrierter Auswahl |
| Betriebsname | Doppelt (`#home-facility` + Spotlight) | Nur Spotlight; `#home-facility` nur noch `sr-only` |
| Betriebsauswahl | Eigene Neon-Box unter dem Spotlight | Im Spotlight, unter Statuschips |
| KPIs | Hohe Neon-Karten | Flacher, mit Specular-Highlight |
| Neon-Kacheln | Cyan-Rand + leichter Glow | Specular-Reflex, Bevel, stärkere Raumtiefe, Icon-Well |
| Bottom-Nav | Cyan-Rand, gelbes Aktiv | Stärkeres Glow, abgerundete Touch-Ziele |
| Desktop | Gleicher Aufbau | Großzügigere Abstände, gleiche Struktur |

## Umgesetzt

- `body.nexus-v41` zusätzlich zu `nexus-v4`
- `--nexus-specular` und verstärkte Tile-/Card-Schatten in Tokens
- Spotlight als einzige Betriebsdarstellung inkl. Select + Sync
- Mobile: Kicker ausgeblendet, Header/Command verdichtet
- Modul-Tiles mit Lichtkante und räumlichen Schatten
- Bestehende IDs und Datenquellen unverändert

## Bewusst nicht

- Keine erfundenen Kennzahlen
- Kein Betriebsfoto ohne echte Bild-URL
- Keine Schema-/Auth-/RLS-Änderungen
- Kein Push / Deployment

## Artefakte

- Screenshots: `docs/design-review-3.6.0-v4.1/`
- Tests: `tests/ui/design-v41.spec.js`
- Skripte: `scripts/patch-nexus-v41.mjs`, `scripts/design-review-screenshots-v41.mjs`
