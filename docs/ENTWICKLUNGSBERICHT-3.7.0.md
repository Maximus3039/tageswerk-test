# Entwicklungsbericht Tageswerk 3.7.0

Stand: 21.11.2026. Branch: `modularisierung`. Öffentliche Anwendung bleibt **3.6.3**. Kein Push auf `main`, kein GitHub Pages, keine SQL-Ausführung, keine Edge-Deploys, keine PROD-Änderungen.

## 1. Vollständig implementierte Funktionen

- Management-Dashboard: mehrere Betriebe, Auswahl, Reihenfolge, Spaltenzahl, Kompakt, Monitor, Vollbild, Presets und Kennzahlenauswahl (Besucher, Umsatz, Status, Mängel, Wartung, Verbrauch). Speicherung lokal und in `user_dashboard_layouts`, wenn die Tabelle existiert.
- Betriebsstatus je Kachel: aktive und kritische Mängel, überfällige Wartungen, offene Aufgaben, letzter Tagesbericht. Fehlende Werte bleiben „Keine Daten“, nicht 0.
- Betriebsstatistik: Tag, Woche, Monat, Jahr, freier Zeitraum; 364-Tage-Vergleich; Durchschnitt, Umsatz/Besucher, Prognose; SVG-Diagramme; Export Excel/CSV und Druck-PDF.
- Historischer Kennzahlenimport: XLSX, CSV, digitale PDF; manuelle Spaltenzuordnung; Vorschau; Dublettenregel; 800er-Blöcke mit Fortschritt; Importhistorie über `tageswerk_import_day_figures` bzw. zeilenweiser Fallback ohne stille Teilübernahme des aktuellen Blocks.
- Verbrauchsauswertung: Woche und Vorjahr im Dashboard-Verbrauch; OBIS 1.8.1/1.8.2 als HT/NT; Zählerimport akzeptiert CSV zusätzlich zu XLSX. Bestehende Wechsel, Rücksetzungen, Sprungkennzeichnung und historische Zählervorschau bleiben.
- Mängel: Suche in offenen Vorgängen, Frist im Erfassungsformular, Foto-Versuch mit klarem Hinweis wenn Storage fehlt. Statuswerte bleiben `open` / `in_progress` / `pending_review` / `resolved`.
- Material: Nachbestellhinweis ohne automatische Bestellung.
- Tagesbericht: Hinweis, Besucher/Umsatz/Wetter nicht doppelt zu erfassen.
- In-App-Hinweise: Relevanzsortierung, Quittieren, ohne Push und ohne E-Mail.
- Mobile: `nexus-v44`, keine erzwungenen Horizontalüberläufe in Tabellen, Filtern und Kacheln.
- Administration: Betrieb anlegen nur für `company_admin` (org-weit), UI plus vorbereitete RPC.

## 2. Teilweise implementierte Funktionen

- Management-Verbrauch: Kalender-RPC je Medium; keine Kosten-KPIs.
- Importhistorie und transaktionale Blöcke: Client fertig, SQL 3.6.3 muss in TEST liegen.
- Dashboard-Layouts serverseitig: Client upsertet, Tabelle 3.6.3 muss in TEST liegen.
- Mangel-Fotos: Upload-Versuch und Metadaten-SQL vorbereitet, Bucket und Verknüpfung zur Mangelzeile nach Insert fehlen.
- Hinweisquittungen: lokal wirksam, Tabelle `user_notice_acks` noch nicht angebunden.
- Betrieb anlegen: UI und SQL-Datei, Funktion nicht installiert.
- Zähler-Historienübernahme: Vorschau und bestehender Commit-Pfad unverändert; kein neuer produktiver Commit.

## 3. Nicht implementierte Funktionen

- Externe Push- oder E-Mail-Benachrichtigungen.
- Automatische Bestellung.
- Statuswechsel auf `new` / `closed` (würde bestehende Daten und Tests brechen).
- Neue Rollen.
- Kiosk-Hardware-Vollbild jenseits der Fullscreen-API.
- Gescannte (nicht digitale) PDFs.
- SQL gegen TEST oder PROD.

## 4. Neue SQL-Migrationen (nur Dateien)

- `tageswerk_3_7_0_vorpruefung.sql` (lesend)
- `tageswerk_3_7_0_create_facility.sql`
- `tageswerk_3_7_0_notice_acks.sql`
- `tageswerk_3_7_0_defect_photos.sql`

Nicht ausgeführt.

## 5. Geänderte Dateien (3.7.0)

- `index.html`, `package.json`, `manifest.webmanifest`, `service-worker.js`, `css/theme-3.6.css`
- `js/management-dashboard.js`, `js/dashboard-layouts.js`, `js/statistics.js`, `js/visitor-import.js`, `js/operations-ui-figures.js`, `js/operations-store.js`, `js/operations-ui.js`, `js/operations-ui-sections.js`, `js/app.js`
- `js/notifications.js`, `js/facilities-admin.js` (neu)
- `js/defects.js`, `js/defects-ui.js`, `js/defects-store.js`, `js/consumption-analytics.js`, `js/meters-domain.js`, `js/meter-import.js`, `js/meter-import-profiles.js`
- Tests und `scripts/patch-index-3.7.mjs`

## 6. Testergebnisse

- `npm test`: **252/252** bestanden.
- Playwright (lokal): `mobile.spec.js`, `design-v43.spec.js`, `abnahme-3-6-3.spec.js` auf Desktop und Smartphone: **12/12** bestanden.
- Vollständige Playwright-Suite und TEST-Datenbank-Integration: nicht komplett gelaufen (kein TEST-SQL, keine Testdatenänderung).

## 7. Sicherheitsprüfungen

- `isManager` unverändert.
- Keine Erweiterung der Rollenstruktur.
- Betrieb anlegen nur `company_admin` mit `facility_id IS NULL`.
- RLS in den neuen SQL-Dateien mit `FORCE ROW LEVEL SECURITY`, `search_path = ''` bei SECURITY DEFINER.
- Keine Secrets, kein Service-Role, kein TEST-Projekt im Client (`eqtrifscedpsngsysxvc`).
- Verbrauch weiterhin berechnet, nicht gespeichert.
- Historischer Zähler-Commit nicht gegen echte Daten ausgeführt.

## 8. Bekannte Probleme

- Ohne 3.6.3-SQL in TEST bleiben Layouts und Importblöcke auf Fallback (localStorage bzw. Zeile für Zeile).
- Foto-Upload ohne Bucket erzeugt keinen Mangelabbruch, speichert aber kein Bild.
- Quittungen überleben Gerätewechsel erst nach Installation von `user_notice_acks`.
- PDF-Export nutzt den Browserdruck, kein eingebettetes PDF-Binary.
- Auftragswunsch `new`/`closed` ist fachlich nicht umgesetzt, um Bestandsdaten zu schützen.

## 9. Voraussetzungen für TEST

1. Lesende Vorprüfung `tageswerk_3_7_0_vorpruefung.sql`.
2. Bestätigen, dass 3.6.3-SQL (Layouts, Import, Materials-Insert) in TEST liegt.
3. Freigabe für 3.7.0-SQL in der Reihenfolge Vorprüfung, `create_facility`, `notice_acks`, `defect_photos`.
4. Optional Storage-Bucket `defect-photos` (nicht öffentlich).
5. Keine PROD-Ausführung.

## 10. Empfohlene nächste Schritte

1. TEST-Freigabe für die vier 3.7.0-SQL-Dateien.
2. Browser-Abnahme Management-Dashboard, Importblöcke, Statistik-Export mit TEST-Konto.
3. Quittungen an `user_notice_acks` anbinden.
4. Foto nach erfolgreichem Mangel-Insert in `defect_photos` schreiben.
5. Erst danach über eine gesonderte Freigabe über Produktivsetzung sprechen.

Keine Produktivsetzung in diesem Schritt.
