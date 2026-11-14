# Releaseprüfung Tageswerk 3.6.0 – Next Generation

**Branch:** `entwicklung/tageswerk-3.6.0`  
**Geprüfter Stand vor Nachbesserungen:** `8a25e65`  
**Commit dieser Prüfung:** siehe Git-Log (dieser Bericht + Fixes)  
**Produktiv:** 3.5.7 (`240a2e8`) · **Pages-Pin:** unverändert `240a2e85dee772857bd14cd6206818e33175e56e`  
**Push / Veröffentlichung / SQL-Ausführung:** nicht erfolgt

---

## 1. Gesamtbewertung

**Ergebnis: freigabefähig nach gemeinsamer Abnahme und optionalen Migrationen.**

Gegenüber 3.5.7 enthält der Branch zusätzlich die lokal entwickelte Filterverwaltung (3.5.8) sowie das 3.6.0-Paket (Design, Dashboard, Verbrauch, Wetter, Berichts-Snapshot).

| Kategorie | Bewertung |
|-----------|-----------|
| Neue Funktionen | Designsystem, Dashboard-Wetter/-Verbrauch, Analytics, Wettermodul, Bericht-Snapshot, Filter-UI |
| Geänderte Funktionen | Dashboard-Rendering, Mängelkarten-Optik, Tagesbericht-Formular, PWA-Version 3.6.0 |
| DB-Abhängigkeiten | 2 additive Migrationen vorbereitet (Koordinaten, Wetterspalten); App läuft ohne sie |
| Regressionen | Keine in `npm test` / `test:ui` gefunden |
| Sicherheit | Keine RLS-/RPC-Lockerung; Geocode-Fallback am Dashboard abgeschaltet |
| Unvollständig | Koordinatenpflege UI fehlt; strukturierte Wetterspalten erst nach Migration; Filter-PG-Verhaltenstests offen |

---

## 2. Designprüfung

- Dark Theme (Anthrazit/Dunkelblau, Gelb-/Blauakzente) über `css/tokens.css` + `css/theme-3.6.css`
- Login, Dashboard, Mängel, Betriebsmodule einheitlich und lesbar
- Kontraste der Primärtexte und Akzente ausreichend; Hilfstexte bewusst gedämpft
- Nachgebessert: Login-Kartenbreite, Filterbar/Tabs, Review-Hinweise, Wetter-Warnbadge, Touch-Höhen

Screenshots: `docs/release-screenshots-3.6.0/`

---

## 3. Mobile Prüfung

- Bottom-Nav und große Selects für Betriebswechsel intakt
- Dashboard-Karten stapeln; Verbrauchstoolbar mobil einspaltig
- Playwright Smartphone-Projekt: 39 bestanden
- Kein kritisches Horizontales Overflow in bestehenden UI-Tests

---

## 4. Verbrauchsberechnungen

Geprüft mit künstlichen Kalenderzeilen in `tests/committed/consumption-analytics.test.mjs`:

| Szenario | Ergebnis |
|----------|----------|
| Strom HT+NT als Gesamt | Summe nur Zähler mit `counts_in_facility_total`, Unterzähler ausgeblendet |
| Nur HT | Filter `meterId` liefert Einzelwert |
| Wasser / Fernwärme / Gas | Medientrennung korrekt |
| Fehlende Messwerte / Schätzung | `mixed`/`estimated`, Label „Enthält Schätzungen“ |
| Monatsvergleich + Sprung | Delta und Spike-Flags ohne Rohstände |
| Leere Periode | kein erfundener Verbrauch |

**Wichtig:** Client addiert keine Zählerstände, sondern aggregiert Perioden-/Kalenderwerte (`aggregateTrend` / `tageswerk_consumption_calendar`). Zählerwechsel und Intervalle liegen serverseitig in der bestehenden Periodenlogik.

---

## 5. Wettermodul

| Punkt | Status |
|-------|--------|
| Open-Meteo ohne API-Key | ok |
| Cache 30 Min | ok |
| API-Fehler | Fehlermeldung, kein Absturz |
| Standort hinterlegt | Dashboard zeigt Wetter |
| Ohne Koordinaten | **kein stilles Geocoding** am Dashboard |
| Geocode | nur bei ausdrücklichem „Wetter für Bericht laden“ (`allowGeocode`) |
| Unsicherer Standort | Badge + Text „Standort geschätzt“ |

Behebung in dieser Prüfung: stilles Geocoding am Dashboard entfernt, damit keine unbemerkt falschen Orte erscheinen.

---

## 6. Tagesberichte

- Wetterübernahme optional; Snapshot wird in Vorkommnisse gemerged und optional als `weather_*` geschrieben
- Ohne Migration: Fallback auf Text-only, Speichern bleibt möglich
- Bestehende Berichte: additive Defaults, keine nachträgliche Prognose-Aktualisierung
- Nachträge ändern nicht automatisch Wetterfelder
- E-Mail-Zusammenfassung unverändert textbasiert aus gespeichertem Inhalt

---

## 7. Datenbankmigrationen

### Übersicht 3.6.0 (nur vorbereitet)

| Datei | Zweck | Tabellen | Neue Spalten | Funktionen | RLS | Risiko | Reihenfolge |
|-------|-------|----------|--------------|------------|-----|--------|-------------|
| `tageswerk_3_6_0_facility_location_vorpruefung.sql` | Lesende Vorprüfung | facilities | – | – | prüft RLS aktiv | gering | 1 |
| `tageswerk_3_6_0_facility_location.sql` | Koordinaten | facilities | `latitude`, `longitude` + Checks | – | keine neue Policy | gering (additiv) | 2 |
| `tageswerk_3_6_0_facility_location_pruefung.sql` | Lesende Nachprüfung | facilities | – | – | – | gering | 3 |
| `tageswerk_3_6_0_daily_report_weather_vorpruefung.sql` | Lesende Vorprüfung | daily_reports | – | – | prüft RLS aktiv | gering | 4 |
| `tageswerk_3_6_0_daily_report_weather.sql` | Wetter-Snapshot | daily_reports | `weather_summary`, `weather_source`, `weather_observed_at`, `weather_kind` | – | keine neue Policy | gering (Defaults für Altdaten) | 5 |
| `tageswerk_3_6_0_daily_report_weather_pruefung.sql` | Lesende Nachprüfung | daily_reports | – | – | – | gering | 6 |

**Zusätzlich im Diff zu 3.5.7 (bereits früher lokal, nicht Teil der 3.6.0-SQL-Paketausführung hier):** Filter-Migrationen `tageswerk_3_5_8_water_filter_*` – nicht erneut ausführen, wenn bereits installiert.

**Kompatibilität Produktiv-DB:** additiv, keine DROP/REWRITE, keine SECURITY DEFINER, keine Policy-Änderung. App bleibt ohne 3.6.0-Migrationen lauffähig.

---

## 8. Sicherheitsprüfung

| Thema | Ergebnis |
|-------|----------|
| Rollen / Mandanten / Betriebe | unverändert; Verbrauch nur bei `membershipAllowsMeterReading` |
| RLS | Migrationen ändern keine Policies |
| SECURITY DEFINER | keine neuen Funktionen in 3.6.0-SQL |
| Frontend-Secrets | kein Wetter-API-Key; Publishable Key unverändert in `supabase.js` |
| Design | umgeht keine Rechte |
| Pages-Pin | bleibt auf 3.5.7 |

---

## 9. Testergebnisse

| Suite | Ergebnis |
|-------|----------|
| `npm test` | **196/196 bestanden** |
| `npm run test:ui` | **39 bestanden, 1 skipped** |

Neu/erweitert in dieser Prüfung:

- `tests/committed/consumption-analytics.test.mjs`
- `tests/committed/weather.test.mjs`
- Vor-/Nachprüfungen SQL ergänzt

---

## 10. Gefundene und behobene Fehler

1. **Stilles Geocoding am Dashboard** konnte unbemerkt falsche Orte wählen → nur noch hinterlegte Koordinaten; Geocode nur auf Benutzeraktion im Tagesbericht.
2. **Geschätzte Standorte** zu schwach markiert → Badge + Snapshot-Hinweis.
3. **Verbrauchstest-Fixture** für Monatsvergleich lag in der falschen Vorperiode → Testdaten korrigiert.
4. **Design-Feinschliff** Login/Tabs/Filter/Review/Wetter-Warnung.

---

## 11. Offene Risiken

1. Ohne Facility-Koordinaten bleibt Dashboard-Wetter leer (bewusst).
2. Strukturierte `weather_*`-Spalten erst nach Freigabe der Migration.
3. Filter-PostgreSQL-Verhaltenstests gegen Testdatenbank noch offen.
4. Theme-Overlay kann in Randfällen mit alten `app.css`-Regeln konkurrieren – manuelle Abnahme empfohlen.
5. Open-Meteo-Verfügbarkeit extern.

---

## 12. Screenshots

Ordner: `docs/release-screenshots-3.6.0/`

- Desktop: Login, Dashboard, Mängel, Betrieb
- Smartphone: Login, Dashboard, Mängel, Betrieb

Erzeugung: `node scripts/release-screenshots-3.6.mjs`

---

## 13. Commit-ID

- Ausgang: `8a25e65`
- Dieser Releaseprüfungs-Commit: lokal nach Abschluss (siehe `git log -1`)

Diff zu Produktiv 3.5.7: ca. 57 Dateien / +6861 Zeilen (inkl. 3.5.8 Filter + 3.6.0).

Unbeabsichtigt untracked belassen: `agent-tools-run.json` (nicht committen).

Versionsnummern lokal: `package.json` / Manifest / SW = **3.6.0**; Pages erwartet weiterhin **3.5.7**.

---

## 14. Empfohlene Installationsreihenfolge

1. Vorprüfung Facility-Koordinaten  
2. Migration Facility-Koordinaten  
3. Nachprüfung Facility-Koordinaten  
4. Vorprüfung Daily-Report-Wetter  
5. Migration Daily-Report-Wetter  
6. Nachprüfung Daily-Report-Wetter  
7. Optional: echte Koordinaten je Betrieb pflegen  
8. Client-Release erst nach Abnahme; Pages-Pin erst dann auf neuen Release-Commit setzen  

Filter-3.5.8-Migrationen **nur**, falls in der Ziel-DB noch nicht installiert (nicht erneut).

---

## 15. Empfehlung zur Veröffentlichung

**Noch nicht veröffentlichen.**

Vor Go-Live:

1. Gemeinsame Sichtprüfung mit echten Rollen  
2. Entscheidung: Migrationen jetzt oder bewusst Text-only-Wetter  
3. Filter-Verhaltenstests auf Testdatenbank  
4. Explizite Freigabe für Push und neuen Pages-Pin  

Bis dahin: Branch `entwicklung/tageswerk-3.6.0`, kein Push, Pin `240a2e8` belassen.
