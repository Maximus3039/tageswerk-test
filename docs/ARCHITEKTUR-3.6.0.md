# Tageswerk 3.6.0 – Architektur und Bestandsaufnahme

Branch: `entwicklung/tageswerk-3.6.0`  
Basis-Commit: `00cc50c3e9ad8b992bc879e5999881ed0a97bfb7`  
Veröffentlichte Produktivversion: **3.5.7** (GitHub Pages fest auf `240a2e8`)

## Bestand

- Vanilla-ES-Modul-PWA ohne Framework
- Zustand über `js/state.js`
- Betriebsmodule über `operations-*`, Zähler über `meters-*`, Mängel über `defects-*`
- Filterspülungen 3.5.8 lokal (UI + SQL vorbereitet/installiert, Verhaltenstests gegen Testdatenbank offen)
- Verbrauch: serverseitige Perioden/Kalender (`utility_meter_consumption_periods`, `tageswerk_consumption_calendar`), Client aggregiert über `aggregateTrend`

## Leitentscheidungen 3.6.0

1. **Designsystem** in CSS-Variablen (`css/tokens.css`) + bestehende `css/app.css` anbinden, keine zweite App.
2. **Dashboard 2.0** modular im bestehenden `#view-dashboard`, Rollenrechte unverändert.
3. **Verbrauchsstatistik** baut auf vorhandener Perioden-/Kalenderlogik auf; keine Summation roher Zählerstände.
4. **Wetter** über Open-Meteo (ohne API-Schlüssel). Standort: optionale Facility-Koordinaten (SQL nur vorbereitet); Fallback Geocoding nach Betriebsnamen mit klarer Kennzeichnung.
5. **Tagesbericht-Wetter** als eingefrorener Snapshot-Text (SQL vorbereitet); gespeicherte Berichte ändern sich nicht nachträglich.
6. **Keine** Ausführung produktiver Migrationen, kein Push, Pages-Pin unverändert.

## Etappen

| Etappe | Inhalt |
|--------|--------|
| A | Bestandsaufnahme / Branch |
| B | Designsystem |
| C | Dashboard 2.0 |
| D | Mobile First |
| E | Verbrauchsstatistik |
| F | Wetter + Tagesberichte |
| G | Integration Filter/Mängel |
| H | Tests + Bericht |

## Neue Module (geplant)

- `css/tokens.css` – Design-Tokens
- `js/weather.js` – Wetterabruf/Cache
- `js/consumption-analytics.js` – Auswertungshelfer auf Perioden-/Kalenderdaten
- SQL-Vorbereitung unter `tageswerk_3_6_0_*` (nur Dateien, keine Ausführung)
