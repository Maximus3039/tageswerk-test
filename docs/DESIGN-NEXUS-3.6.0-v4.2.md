# Tageswerk 3.6.0 – Design Nexus V4.2

Mobile-First-Optimierung auf Basis von V4.1. Geschäftslogik, Supabase, RLS und Berechtigungen unverändert. V4.2 ist **nicht** committet. Pages-Pin bleibt 3.5.7 / `240a2e8`.

V4.1-Sicherung: Commit `00d02a7fc24c906e812ead3862a338b9eb8579c9` (`design: complete Tageswerk NEXUS V4.1`).

## Vorher (V4.1) → Nachher (V4.2)

| Merkmal | V4.1 | V4.2 |
|---------|------|------|
| Mobiler Kopf | Brand + Begrüßung + Spotlight inkl. Select | Header ohne Versionsnummer; Begrüßung + Status; Select direkt darunter; kompaktes Spotlight |
| KPI-Position | Nach Spotlight, Today und Quick-Aktionen | KPI direkt nach Spotlight; Today/Quick darunter |
| Module | Weitere Module vor Betriebsführung | Betriebsführung zuerst, Weitere Module danach |
| Mängel mobil | Größere Toolbar/Filter | Kompaktere Abstände und Mindesthöhen |
| Screenshots | Inkonsistente Demo-DOM-Daten | Konsistente DESIGN-DEMO mit passenden Kennzahlen |

## Umgesetzt

- `body.nexus-v42`
- Betriebsauswahl vor dem Spotlight
- Sechs KPI-Kacheln erhalten, früher im Viewport
- Neon-Kacheln unverändert im Stil, Reihenfolge Betriebsführung → Weitere Module
- `open-operations` öffnet idempotent (kein versehentliches Schließen)
- Beim Öffnen von „Mehr“ wird Betriebsführung sichtbar geladen
- Screenshot-Skript `scripts/design-review-screenshots-v42.mjs` mit DESIGN-DEMO-Kennzeichnung
- Viewport-Check 360/390/430/768/1440

## Screenshots

Ordner: `docs/design-review-3.6.0-v4.2/`  
ZIP: Desktop `Tageswerk-3.6.0-Design-v4.2.zip`

## Qualität

- Keine Schema-/Auth-/RLS-Änderungen
- Keine erfundenen produktiven Live-Daten in der App
- Sicherheits-/Mandantenhinweise bleiben sichtbar (Vorrang vor Platz)
