# Modulprüfung Phasen 6–11 (Kurz)

Code- und Testlage nach Freeze V4.3. Keine Live-Schreibtests gegen Produktiv-DB.

## Betriebsführung

| Modul | UI/Validierung | DB | Tests | Auffälligkeit |
|-------|----------------|----|-------|---------------|
| Tagesberichte | Ja | Ja | Ja | Doppelübermittlung clientseitig begrenzt; DB-Installation nötig |
| Kontrollgänge | Ja | Ja | Ja | Auffälligkeit → Mangel-Pfad vorhanden |
| Wartung | Ja | Ja | Ja | Überfälligkeit berechnet |
| Beschaffung | Ja | Ja | Ja | Freigabe nur Leitung |
| Temperatur | Ja | Ja | Ja | Grenzwerte/Quittierung |
| Wasserhygiene | Ja | Ja | Ja (simuliert) | Live-RLS offen |
| Filterspülung | Ja | SQL vorbereitet | Statisch + Guard | Integration braucht Freigabe/Test-DB |

## Verbrauch

| Punkt | Status |
|-------|--------|
| Stand vs. Verbrauch | Korrekt getrennt (Stand speichern, Verbrauch berechnen) |
| Medien | Strom/Wasser/Wärme/Gas in Analytics |
| Historie/Vergleiche | Monat/Jahr/Delta/Spike in Analytics |
| Diagramme | Sparkline/Analytics; mobil gestapelt |
| Fake-Werte | Keine im Normalbetrieb |

## Dashboard

| Punkt | Status |
|-------|--------|
| Kennzahlenquellen | Mängel-Filter + Operations-Aggregation |
| Betriebsauswahl | Spotlight/`dashboard-facility`; Sync zu `operations-facility` |
| Wetter | Open-Meteo; ohne Koordinaten kein stilles Geocode |
| Aktualisierung | bei Betriebswechsel/Refresh; Realtime wo verdrahtet |

## Mitarbeiter / Einladungen

Client-Guards + SQL-Text + Edge-Struktur getestet; Live-Mandantennachweis offen. Notice bleibt.

## Weitere Module

Material, Hinweise, Day Figures, Profil: vorhanden und weitgehend unit-getestet.  
Unternehmens-/Betriebsverwaltung: Scope-Anzeige stark; Admin-Pflege begrenzt.

## PWA / Smartphone

| Punkt | Status |
|-------|--------|
| Manifest / Icons / 3.6.0 | Vorhanden |
| Service Worker | Cache-Ersatz getestet (Unit) |
| Bottom-Nav | UI-Tests Smartphone |
| Touchflächen Mängel | ≥44px in V4.3 |

## Codequalität (Stichprobe)

- Shell-Listener einmalig registriert (Unit)
- Keine Groß-CSS-Bereinigung (Design-Freeze)
- Pages-Pin unverändert
