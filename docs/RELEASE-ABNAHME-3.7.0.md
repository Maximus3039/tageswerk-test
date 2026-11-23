# Release-Abnahme Tageswerk 3.7.0

Stand: 23.11.2026 (Release-Blocker). Branch: `modularisierung`. Öffentliche Anwendung bleibt **3.6.3**. Kein Push auf `main`, kein GitHub Pages, kein PROD.

TEST: `gamvnzggcrrlnyoknllu`. PROD: `eqtrifscedpsngsysxvc` unverändert. `js/supabase.js` zeigt nach der Sitzung wieder auf die Produktiv-URL.

Live-Rollen in TEST: `facility_manager` `mgr-a1@test.tageswerk.local` (unverändert); neu angelegt und authentifiziert `company_admin` `qa-gf-370@test.tageswerk.local` und `employee` `qa-ma-370@test.tageswerk.local`. Seed-Konten nicht geändert. Passwörter nicht in diesem Dokument.

## Empfehlung zur Produktivfreigabe

**Keine Freigabe von Frontend 3.7.0 / GitHub Pages.** Datenbank 3.7.0 auf PROD ist installiert. Gesamturteil: **GELB** für TEST-Abnahme, **GRÜN** für additive SQL auf PROD, **ROT** für Frontend-Pin.

Auf eine zusätzliche Datenbanksicherung wird auf Entscheidung des Betreibers verzichtet. Das verbleibende Risiko wird akzeptiert.

Begründung: Additive SQL 02–05 auf PROD ausgeführt, `06_verification.sql` bestanden. Create-Facility, Monate und Foto-Bucket sind da. Excel-Commit im Frontend 3.7.0 gesperrt. Öffentliche Pin bleibt 3.6.3, bis Frontend gesondert freigegeben wird. Lauf: `docs/RELEASE-MIGRATION-RUN-3.7.0.md`.

## 1. Accessibility

Ursache: Der Satz „Für dein Konto sind keine Betriebe freigegeben.“ lag dauerhaft in einem inneren Absatz von `#consumption-empty`. `display:none` blendet ihn optisch aus; Accessibility-Dumps und Hilfstechnik sahen den Text trotzdem, sobald der Knoten im Baum blieb.

Korrektur:

- Markup ohne festen Hinweistext.
- Text nur einsetzen, wenn wirklich keine Betriebe zugeordnet sind; sonst `replaceChildren()`.
- Versteckte Flächen (`#login` nach Abmeldung, Passwort-Dialoge, Einladung, `#app`, Views, Erfassen-Sheet, Mangel-Composer, Mobile-Sheet, Verbrauchskarte) erhalten `hidden`, `inert` und `aria-hidden` gemeinsam über `setHidden` / `show`.
- Login startet sichtbar (nicht inert). Versteckte Dialoge und Views tragen `inert` bereits im Markup, `syncHiddenDialogs` läuft vor und nach `update()`.

Live `mgr-a1`: `#consumption-empty` leer, `inert`, nicht in `document.body.innerText`. Login und Passwort-Dialoge `inert`. Der Cursor-Snapshot listet inert-Unterbäume weiter; sichtbarer Text und `offsetParent` enthalten den Hinweis nicht.

## 2. Modulübersicht

Status gilt für TEST + `mgr-a1`, sofern nicht anders vermerkt.

| Modul | Status | Nachweis |
|-------|--------|----------|
| Dashboard | vollständig (Leitung) | Live verbunden, nur Alpha Nord, Verbrauchskachel gemessen, Hinweise quittierbar |
| Management-Dashboard | vollständig (Leitung, Datenlücken) | Select nur Alpha Nord; Besucher/Umsatz ohne TEST-Tageswerte → „Keine Daten“, nicht 0 |
| Tagesberichte | vollständig | Formular Alpha Nord, Speichern an RPC gebunden |
| Mängelmanagement | vollständig außer Archiv | Leitung weist zu. Mitarbeiter speichern Vermerk und `in_progress`/`pending_review` über RPC. Archiv-RPC fehlt weiter |
| Kontrollgänge | vollständig (TEST-Live 23.11.) | QA-GF legt Checkliste und Lauf an, QA-MA führt aus und öffnet Ergebnisse. Mitarbeiter darf nicht anlegen |
| Wartungsmanagement | vollständig (TEST-Live 23.11.) | Anlage + Intervall 1 Monat, Durchführung Leitung und Mitarbeiter, nächster Termin 23.12.2026 berechnet. Mitarbeiter legt keine Anlage an |
| Temperaturkontrollen | vollständig | Messstellen, Warnungen, Einstellungen |
| Wasserhygiene | teilweise | Becken, Pläne, Hinweise. Filterspülungen nicht installiert |
| Filterspülungen | nicht funktionsfähig | Tabelle `water_filter_flushes` fehlt (PGRST205); UI-Hinweis vorgesehen |
| Zählerstände | vollständig | A1 110,5 kWh / 10 kWh; ISO-Serie; Ablesung über INSERT + Trigger |
| Historische Verbrauchserfassung | vollständig (manuell) | Jan–Mar 2025 TW370-HIST, Teiljahr-KPIs, Korrektur mit Grund |
| Verbrauchsstatistik | vollständig | Kalender-RPC mit 6 Argumenten, Auswertung, Teiljahr nicht als Jahresverbrauch |
| Besucher- und Umsatzstatistik | teilweise | Overview-RPC antwortet; TEST ohne vergleichbare Tageswerte; Import-UI vorhanden |
| Datenimport Excel-Zähler | teilweise | Lokale Prüfung + Preview-RPC (validiert Payload). Commit-RPC fehlt, Übernahme gesperrt |
| Wartungsmanagement | vollständig (nach Korrektur) | Anlagenformular; keine Anlagen in TEST |
| Materialverwaltung | vollständig | Formular; „keine Materialien erfasst“ |
| Beschaffungsanfragen | vollständig | Liste inkl. Testdatensatz, Genehmigen/Ablehnen |
| Mitarbeiterverwaltung | vollständig (Leitung) | emp-a1 / mgr-a1; Betrieb anlegen-Karte verborgen |
| Einladungen | teilweise | Liste sichtbar; historische Edge-Versände fehlgeschlagen |
| Benachrichtigungen | vollständig (In-App) | 5 Hinweise, Quittieren. Kein Push/E-Mail |
| Einstellungen / Eskalation | vollständig (UI) | Formular; serverseitige Auto-Eskalation laut Hinweis nicht aktiv |
| Betrieb anlegen | vollständig (TEST-Live) | `TW370-QA-BETRIEB 2026-11-23T08:08` in Org Alpha. GF sieht ihn, QA-MA nicht. Kurzer Name P0001. Mitarbeiter-RPC abgewiesen |

## 3. Datenbank vs. Frontend

Vergleich live über die `mgr-a1`-Sitzung, ohne Migrationen auszuführen.

| Frontend-Abhängigkeit | TEST | Für 3.7.0 zwingend? |
|-----------------------|------|---------------------|
| Organisationen, Betriebe, Mitgliedschaften, Profile | ja | ja, erfüllt |
| `defects` / `defect_events` | ja | ja, erfüllt |
| `utility_meters` / readings / consumption views | ja | ja, erfüllt |
| `tageswerk_consumption_calendar` (6 Argumente inkl. `p_meter_id`) | ja | ja, erfüllt |
| `utility_monthly_consumption` + Revisionen | ja | ja für manuelle Historie, erfüllt |
| `inspection_*` | lesbar | ja für Kontrollgänge, erfüllt |
| `assets` / `maintenance_logs` / Beschaffung / Material / Temperatur / Wasserbecken | ja | ja für Betriebsmodule, erfüllt |
| `tageswerk_preview_historical_import` | ja (Payload-Prüfung) | nein für Kern 3.7.0; nur Excel-Vorschau |
| `tageswerk_commit_historical_import` | **fehlt** (PGRST202) | **nein** — Übernahme bewusst gesperrt; manuelle Monate ersetzen den Kernpfad |
| Filterspülungen 3.5.8 (`water_filter_flushes`, `tageswerk_set_water_filter_active`) | **fehlt** | **nein** für Kern 3.7.0; Modul als nicht lieferbar führen. 3.5.8 ist DEFINER und nicht ungeprüft |
| Mängelarchiv 3.5.1 | **fehlt** | **nein** für Kern; Archiv-UI ohne RPC. Migration entzieht UPDATE auf `defects` |
| `employee_update_assigned_defect` | **ja (TEST 23.11.2026)** | ja für Mitarbeiterbearbeitung; gezielte 3.7.0-Funktion, **nicht** die volle 3.4-Techniker-Migration |
| `tageswerk_day_figure_overview` mit from/to/weekday | ja | für Statistik, erfüllt |
| `tageswerk_create_facility` | ja | nur GF |
| `user_notice_acks` | lesbar, anderes Spaltenbild als `id` | Quittungen; nicht blockierend |

`employee_update_assigned_defect` ist in TEST nachgezogen. Die übrigen drei bewusst nicht installierten Pakete (Excel-Commit, Filterspülungen, Mängelarchiv) bleiben Freigabegrenzen.

## 4. Rollen

Stand 21.11.2026, 16:11. Sitzungsprüfung: Origin `http://127.0.0.1:5173`, LocalStorage-Schlüssel `sb-gamvnzggcrrlnyoknllu-auth-token`. Keine Passwörter gelesen, keine Resets.

| Rolle | Konto (TEST) | Sitzung | Ergebnis |
|-------|--------------|---------|----------|
| `facility_manager` | `mgr-a1@test.tageswerk.local` (Seed, unverändert) | **vorhanden** | Abnahmegrundlage. Nur Alpha Nord. |
| `company_admin` | `qa-gf-370@test.tageswerk.local` (neu, nur TEST) | **authentifiziert 21.11.2026** | Alpha Nord und Sued, nicht Beta. Verwaltung sichtbar. Create-RPC nur Validierung. |
| `employee` | `qa-ma-370@test.tageswerk.local` (neu, nur TEST) | **authentifiziert 21.11.2026** | Nur Alpha Nord. Keine Verwaltung. Zähler lesbar, Admin-Aktionen verborgen. Mangel-RPC PGRST202. |
| `company_admin` Seed | `admin-a@test.tageswerk.local` | keine (Passwort unbekannt, nicht zurückgesetzt) | Mitgliedschaft unverändert org-weit Alpha. |
| `employee` Seed | `emp-a1@test.tageswerk.local` | keine (nicht zurückgesetzt) | Mitgliedschaft unverändert Alpha Nord. |

Seed-Konten und Mitgliedschaften (lesend, Katalog 3.6.3 / Seed 3.6.0, nicht angefasst):

| Alias | Rolle | Organisation | Betrieb |
|-------|-------|--------------|---------|
| admin-a | `company_admin`, aktiv, `facility_id` leer | Test Org Alpha | alle Alpha-Betriebe (erwartet: Nord und Sued) |
| mgr-a1 | `facility_manager`, aktiv | Test Org Alpha | Alpha Nord |
| emp-a1 | `employee`, aktiv | Test Org Alpha | Alpha Nord |
| emp-a2 | `employee` | Test Org Alpha | Alpha Sued |
| admin-b | `company_admin` | Test Org Beta | org-weit Beta |
| mgr-b1 / emp-b1 | Leitung / Mitarbeiter | Test Org Beta | Beta Ost |

Mandantentrennung: Alpha-Konten dürfen Beta nicht sehen. Keine Frontend-Rollensimulation, keine Policy-Änderung.

Ausführliche Vorbereitung: [Abschnitt 11](#11-rollenabnahme-vorbereiten).

## 5. Mobile

Emuliert, angemeldet, nach FAB-Korrektur.

| Breite | Horizontal | FAB vs. Navigation |
|--------|------------|-------------------|
| 320 px | Overflow 0 | Abstand 23 px, keine Überdeckung |
| 390 px | 0 | 23 px |
| 430 px | 0 | 23 px |
| 768 px | kein Überlauf (scrollWidth ≤ client) | Bottom-Nav + FAB (Schwelle 850 px), Abstand 23 px |

Karten in der Viewportbreite. Untermenüs (Historie, Betriebskennzahlen) als Klappabschnitte. Touch-Ziele der Navigation ≥ 44 px laut bestehendem Mobile-CSS.

## 6. Fehlerbehandlung

| Fall | Verhalten |
|------|-----------|
| Fehlende Betriebe | Verbrauchspanel nur dann mit Hinweis; sonst leerer, inerter Knoten |
| Fehlende Modul-SQL | Wasserfilter: Schema-Fehler; Statistik/Import: Missing-Flags in Store |
| Ungültige Importvorschau | Preview-RPC P0001 „Importdaten müssen eine Liste sein“ |
| Ungültiger Betriebsname an Create-RPC | P0001 Längenprüfung (ohne Speichern) |
| Fehlende Berechtigung | Betrieb-anlegen für Leitung verborgen; Management nur Alpha Nord |
| Doppelte/abgebrochene Speicherung | `opsUi.saving` / `state.busy`; historische Dublette serverseitig verhindert |
| Fehlende Filtertabelle | PGRST205, kein stilles Schreiben |
| Archiv-RPC | PGRST202, Oberfläche darf nicht als gespeichert gelten |
| Leere Kontrollgang-Namen / keine Punkte | Check `inspection_templates_name` bzw. „mindestens einen und höchstens 30 Prüfpunkte“ |
| Wiederholtes Abschließen eines Laufs | kein zweiter Lauf; Vermerke werden überschrieben |
| Abbruch der REST-Anfrage | `TimeoutError`, keine stillen Schreibvorgänge |

Netzwerk: gezielter Abort-Signal-Timeout gegen REST, nicht das App-Offline-Flag.

## 7. Testergebnisse

Getrennt.

| Art | Inhalt | Ergebnis |
|-----|--------|----------|
| Unit / Mock | `npm test` nach Restore von `js/supabase.js` | **275/275**. Während TEST-Rewrite fiel nur das Pages-Paket (PROD-URL) aus — erwartet. |
| Playwright Mock | Archiv, Historie, Mobile-UX | zuvor 10/10 ohne Operations |
| Playwright Mock | `operations.spec.js` | **2/2 bestanden** (nach `show()`/`setHidden`) |
| Playwright Mock | volle Suite `playwright.config.js`, Port 4179, `scripts/static-server.mjs`, Projekte desktop + smartphone | **82 bestanden, 0 fehlgeschlagen, 2 übersprungen**. Keine echte TEST-Datenbank. |
| Echte Integration | TEST, QA-GF + QA-MA | Abschnitte 12–14 |

## 8. Kritische Fehler

Behoben in dieser Abnahme:

1. Accessibility: versteckter Betriebe-Hinweis.
2. Kontrollgang/Wartung: leeres Panel durch fehlenden `intervalNames`-Import.
3. Mitarbeiter-Mängelbearbeitung: fehlende RPC in TEST (PGRST202), Abschnitt 13.

Offen, nicht kritisch für Leitungs-/GF-Kern, aber release-blockierend für „vollständig 3.7.0“:

- Filterspülungen nicht installiert.
- Excel-Historien-Commit nicht installiert.
- Mängelarchiv-RPCs fehlen weiter.

## 9. Sicherheitsrisiken

- RLS und `isManager` unverändert. Keine PROD-SQL. TEST-Service-Role nur für Auth-Admin-API und den GF-`memberships`-Insert (Anwendungstabelle), nicht gegen `auth.*` per SQL.
- Preview-RPC bleibt INVOKER; Commit nicht aufrufbar.
- Create-Facility-RPC: QA-GF Validierung P0001 ohne INSERT; QA-MA serverseitig abgewiesen.
- QA-Konten nur TEST, Auth-Admin-API (kein `auth.*`-SQL), Mitgliedschaften über bestehende App-Tabellen/RPCs. Seed-Konten unangetastet.
- Einladungs-E-Mail-Versand historisch fehlgeschlagen; QA-MA daher über `manage_facility_membership` als mgr-a1, nicht über Einladungslink.
- Accessibility: Hilfstechnik-Dumps können inert-Dialoge noch auflisten; Fokus und sichtbarer Text nicht.

## 10. Fehlende Voraussetzungen für eine Produktivsetzung

1. Lesendes PROD-Inventar liegt vor (`docs/RELEASE-MIGRATION-3.7.0.md`). Auf eine zusätzliche Datenbanksicherung wird auf Entscheidung des Betreibers verzichtet. Das verbleibende Risiko wird akzeptiert.
2. TEST-Rollen- und Modulabnahme erledigt (Abschnitte 12–14). PROD-Rollenabnahme und Schritte 3–8 der Checkliste brauchen gesonderte Freigabe.
3. PROD-Lücken bis zur Migration: `tageswerk_create_facility`, `utility_monthly_consumption`, Foto-Bucket. TEST-Kompatibilitätsdateien nicht ungeprüft auf PROD.
4. Entscheidung, ob die Excel-Übernahme mit Frontend 3.7.0 auf PROD genutzt werden darf (RPC ist dort bereits da).
5. Keine ungeprüfte Übernahme von 3.5.8 / 3.5.1 / 3.4 / 2.9-Gesamtdateien.

## 11. Rollenabnahme vorbereiten

Kein Konto angelegt, kein Reset, kein PROD, keine RLS-Änderung. Rollen kommen aus `memberships` und RPCs, nicht aus der Oberfläche.

### 11.1 Verfügbare Testzugänge

| Zugang | Status | Nutzung |
|--------|--------|---------|
| mgr-a1 | Sitzung auf Port 5173 gegen TEST | Bereits genutzt. Nicht überschreiben. |
| admin-a | Auth-User und org-weite Mitgliedschaft vorhanden, **kein** Passwort in dieser Umgebung, **keine** Sitzung | Bevorzugtes GF-Konto, **falls** das Passwort lokal beim Operator liegt. Nicht zurücksetzen. |
| emp-a1 | Auth-User und Mitgliedschaft Alpha Nord vorhanden, **kein** Passwort hier, **keine** Sitzung | Bevorzugtes Mitarbeiterkonto unter derselben Bedingung. |

Seed-Passwörter liegen nicht in Git, nicht in der Prozessumgebung und nicht im Agent-Store (`docs/TEST-ABNAHME-AUTH-3.6.3.md`).

### 11.2 Vorschlag neuer TEST-Abnahmekonten (angelegt, siehe Abschnitt 12)

Nur falls admin-a / emp-a1 nicht angemeldet werden können. Domain bleibt `@test.tageswerk.local`. Passwörter nur lokal, mindestens 12 Zeichen, nicht in Chat oder Git.

| Vorschlag | E-Mail | Rolle | Organisation | Betrieb |
|-----------|--------|-------|--------------|---------|
| QA-GF 3.7.0 | `qa-gf-370@test.tageswerk.local` | `company_admin`, aktiv, `facility_id` NULL | Test Org Alpha `a0000000-0000-4000-8000-000000000001` | org-weit (Nord und Sued, nicht Beta) |
| QA-MA 3.7.0 | `qa-ma-370@test.tageswerk.local` | `employee`, aktiv | dieselbe Org | nur Alpha Nord `a1000000-0000-4000-8000-000000000011` |

Anlagewege (ausgeführt in Abschnitt 12):

1. Mitarbeiter: Einladung durch mgr-a1, Berechtigung Mitarbeiter, Betrieb Alpha Nord, Annahme über den Einladungslink. Edge-Versand war zuletzt fehlgeschlagen — ohne funktionierenden Versand keine Annahme.
2. Geschäftsführung: mgr-a1 darf **keine** `company_admin`-Mitgliedschaft vergeben (`mayAppointManager` / RPC). Dafür braucht es entweder eine Anmeldung als admin-a oder eine ausdrücklich freigegebene TEST-Auth-Anlage plus Membership-Zeile. Nicht per Frontend-Flag, nicht per Policy-Aufweichung.

Seed-Konten admin-a / emp-a1 nicht umbenennen, nicht deaktivieren, nicht mit den QA-Adressen ersetzen.

### 11.3 Testplan `company_admin` (nach gültiger Sitzung)

Umgebung: `scripts/serve-abnahme-test.ps1`, danach Restore von `js/supabase.js`. Keine Rollen im Client setzen.

| Nr. | Prüfung | Erwartet | Nicht erwartet |
|-----|---------|----------|----------------|
| G1 | Betriebsauswahl Dashboard | Alpha Nord und Alpha Sued; Filter „Alle berechtigten Betriebe“ | Beta Ost/West |
| G2 | Management-Dashboard | Kacheln für mehrere Alpha-Betriebe, Presets, Spalten, Monitor | fremde Org |
| G3 | Layout speichern | `user_dashboard_layouts` für diese `user_id`; nach Reload gleich | Layout von mgr-a1 |
| G4 | Besucher/Umsatz | Statistik-UI, Overview-RPC, fehlende Tage nicht 0 | Schreiben ohne Absicht; fremde Org |
| G5 | Verbrauch | Kalender und Auswertung über Alpha-Betriebe | Beta-Zähler |
| G6 | Betrieb anlegen | Karte `#facility-admin-card` sichtbar; RPC `tageswerk_create_facility` | Anlegen ohne ausdrückliche Freigabe ( testhalber nur Name ≥ 2 Zeichen nach Freigabe, z. B. `TW370-QA-…`) |
| G7 | Mitarbeiter | org-weite Teamliste, Ernennung `facility_manager` möglich | Änderung an Beta |
| G8 | Betriebsübergreifend | Dashboard-Filter alle Alpha; Kennzahlen/Mängel je Betrieb getrennt | Summe erfundener Nullwerte |

Negativ: Login als GF darf mgr-a1-Rechte nicht erweitern und keine Mitarbeiter-Simulation im Frontend.

### 11.4 Testplan `employee` (nach gültiger Sitzung)

Zuordnung nur Alpha Nord. Vorab Mangel A1 der Person zuweisen lassen (Leitung), ohne Konten zu ändern außer der Zuweisung am vorhandenen Mangel — oder neuen Testermangel durch den Mitarbeiter selbst.

| Nr. | Prüfung | Erwartet | Nicht sichtbar / nicht speicherbar |
|-----|---------|----------|-----------------------------------|
| M1 | Tagesgeschäft / Agenda | Eigene fällige Punkte Alpha Nord | Fremde Betriebe |
| M2 | Mangel erfassen | INSERT `defects` im eigenen Betrieb | andere `facility_id` |
| M3 | Zugewiesene Mängel bearbeiten | UI „Meine Bearbeitung“ | Speichern über `employee_update_assigned_defect` ist in TEST **PGRST202** — als Blocker dokumentieren, nicht durch Tabellen-UPDATE umgehen |
| M4 | Zählerstand | Ablesen (`membershipAllowsMeterReading`) | Zähler anlegen, Korrektur, Wechsel, historische Monate (`membershipAllowsMeterAdmin`) |
| M5 | Temperatur | Messung speichern | Messstellen-Einstellungen, Ausblenden |
| M6 | Kontrollgänge | Zugewiesene Läufe abschließen | Checkliste anlegen / zuweisen |
| M7 | Tagesbericht | Speichern für Alpha Nord | Genehmigen von Beschaffung, Anlagen anlegen |

Verwaltung (Muss-Negativliste, `moreHubItems` / `isManager` / `mayAppointManager`):

- Management-Dashboard, Dashboard-Darstellung
- Mitarbeiterkarte, Einladungen
- Betrieb anlegen
- Eskalationsregeln
- Historische Verbrauchserfassung

### 11.5 Sicherheit der Vorbereitung

- Keine `isManager`-Änderung, keine RLS-Änderung, kein Service-Role gegen PROD.
- Vorbereitung ohne Auth-Admin und ohne Seed-Reset. Die spätere TEST-Anlage (Abschnitt 12) nutzt Auth-Admin-API, nicht `auth.*`-SQL und nicht `test-env-reset-seed-passwords.ps1`.

### 11.6 Nächster Schritt

Erledigt in Abschnitt 12. Mitarbeiter-Mangelbearbeitung nach Abschnitt 13 in TEST geschlossen, ohne die volle 3.4-Techniker-Migration.

## 12. Rollenabnahme TEST 3.7.0 (ausgeführt)

Datum: 21.11.2026. Nur Projekt `gamvnzggcrrlnyoknllu`. Kein PROD, kein `main`, kein Pages. Keine RLS-Änderung, `isManager` unverändert. Seed-Konten admin-a / mgr-a1 / emp-a1 / emp-a2 lesend bestätigt unverändert.

### 12.1 Anlage

| Schritt | Weg | Ergebnis |
|---------|-----|----------|
| Auth-User QA-GF / QA-MA | GoTrue Admin `POST /auth/v1/admin/users`, E-Mail bestätigt | IDs `878e25bd-d8ea-448a-a612-8db0b3cb77a1` bzw. `5d1f6b9d-633a-418c-9c5b-709de765ded4` |
| GF-Mitgliedschaft | Insert `public.memberships`: `company_admin`, Org Alpha, `facility_id` NULL, aktiv | `manage_facility_membership` vergibt diese Rolle nicht |
| MA-Mitgliedschaft | RPC `manage_facility_membership` als `mgr-a1` | Antwort „Mitarbeiter zugeordnet“, Alpha Nord, `employee` |
| Zugangsdaten | individuelle Zufallspasswörter | nur lokale Temp-Datei, nicht Git, nicht dieses Dokument |

Lesekatalog `tageswerk_3_7_0_qa_konten_lesend.sql`: beide Konten aktiv, E-Mail bestätigt, Zuordnungen wie geplant.

### 12.2 Live `company_admin` (`qa-gf-370@test.tageswerk.local`)

Eigene Playwright-Sitzung gegen `http://127.0.0.1:5173` (TEST-Rewrite), ohne die mgr-a1-LocalStorage zu überschreiben.

| Nr. | Prüfung | Ergebnis |
|-----|---------|----------|
| G1 | Dashboard-Betrieb | „Alle berechtigten Betriebe“, Alpha Nord, Alpha Sued. **Kein Beta.** REST: nur Organisation „Test Org Alpha“. |
| G2 | Management | Button sichtbar. Mehr-Hub: Verwaltung inkl. Management-Dashboard. |
| G5 / G8 | Mandant | Nur Alpha-Betriebe in Select und REST. |
| G6 | Betrieb anlegen | `#facility-admin-card` sichtbar. RPC mit Namen `x`: P0001 „Bitte einen Betriebsnamen zwischen 2 und 120 Zeichen angeben.“ **Kein INSERT.** |
| G7 | Mitarbeiter / Einladungen / Eskalation | Karten nicht `hidden`. Mehr-Hub listet Mitarbeiter, Einladungen, Betriebe anlegen, Eskalation, Dashboard-Darstellung. |
| Zähler-Admin | Historie / Zähler anlegen | für GF sichtbar (Leitungspfad). |

Layout-Persistenz (G3) und Tageswerte Besucher/Umsatz (G4) nicht erneut mit Schreibzugriff geprüft; gleiche RPCs wie bei mgr-a1, andere `user_id`.

### 12.3 Live `employee` (`qa-ma-370@test.tageswerk.local`)

| Nr. | Prüfung | Ergebnis |
|-----|---------|----------|
| M1 | Betriebe | Nur Alpha Nord. Nicht Sued, nicht Beta. REST-`facilities` nur Nord. |
| Verwaltung | Mehr-Hub | nur Tagesgeschäft (Betriebserfassung, Zählerstände). Kein Management, keine Mitarbeiter, keine Einladungen, kein Betrieb anlegen, keine Eskalation. |
| G6 negativ | Create-Facility | „Nur die Geschäftsführung legt neue Betriebe der eigenen Organisation an.“ |
| M3 | `employee_update_assigned_defect` | **behoben 23.11.2026**, siehe Abschnitt 13. |
| M4 | Zähler | 3 Zähler Alpha Nord lesbar. `#add-meter` und `#historical-open` `hidden`. |
| Karten | Admin | `facility-admin-card`, Management, Staff, Invite, Settings `hidden`. |

Kein Zählerstand geschrieben. Kein neuer Betrieb. Kein Mangel-UPDATE über die Tabelle.

### 12.4 Scripts (ohne Geheimnisse)

- `scripts/qa-370-create-test-accounts.ps1` — TEST-Auth-Anlage, Membership GF.
- `scripts/qa-370-live-roles.mjs` — isolierte Logins, liest Passwörter nur aus `%TEMP%\tageswerk-qa-370-secrets.json`.
- `scripts/qa-370-employee-defect-live.mjs` — Zuweisung und Mitarbeiter-RPC, gleiche Geheimdatei.

## 13. Mitarbeiter-Mängelbearbeitung (TEST 23.11.2026)

### 13.1 Fehlerursache

PGRST202 kam nicht von einer falschen Signatur, sondern von einer **fehlenden Funktion**. Frontend und Tests rufen `employee_update_assigned_defect(p_defect_id uuid, p_status text, p_note text)` auf. In TEST gab es keine `pg_proc`-Zeile dieses Namens. `tageswerk_3_4_technician_role.sql` ersetzt die Funktion nur, wenn sie schon existiert, und würde zusätzlich Techniker-Rollen und Policies anfassen. Deshalb nicht 3.4 ausführen.

Statusmodell unverändert: `open` → `in_progress` → `pending_review` → `resolved`. Mitarbeiter-UI „Meine Bearbeitung“ nur bei Zuweisung auf `auth.uid()`. Leitung speichert weiter per Tabellen-UPDATE (`defect_manager_update` / `private.can_manage_facility`). Mitarbeiter haben **kein** Tabellen-UPDATE.

### 13.2 Lösung

Neue Datei `tageswerk_3_7_0_employee_update_assigned_defect.sql`, nur TEST ausgeführt:

- `CREATE FUNCTION` wenn fehlend; abweichende vorhandene Fassung wird **nicht** ersetzt.
- `SECURITY DEFINER`, `search_path` leer.
- Schreibt nur `status` und `change_note`. Kein `assigned_to`, `facility_id`, `organization_id`, `priority`.
- `GRANT EXECUTE` an `authenticated`, `REVOKE` von `PUBLIC`/`anon`.
- `NOTIFY pgrst, 'reload schema'`.
- Keine Policy-Änderung, kein `DISABLE ROW LEVEL SECURITY`.

Oberfläche: Pflichtvermerk 3–2000 Zeichen, gleiche Regel wie die Funktion.

### 13.3 Serverseitige Prüfungen

| Prüfung | Verhalten |
|---------|-----------|
| Anmeldung | `auth.uid()` sonst „Anmeldung erforderlich“ |
| Status | nur `in_progress` oder `pending_review` |
| Vermerk | 3–2000 Zeichen |
| Zeile | `FOR UPDATE`, sonst „Mangel nicht gefunden“ |
| Zuweisung | `assigned_to IS DISTINCT FROM auth.uid()` |
| Betrieb | aktive Mitgliedschaft derselben Organisation und (`company_admin` org-weit oder `facility_id` = Mangelbetrieb) |
| Endzustand | bei `resolved`/`pending_review` keine weitere Mitarbeiteränderung |
| Verlauf | Trigger `audit_defect_change` protokolliert Statuswechsel |

### 13.4 Live TEST

Zuweisung: `qa-gf-370@test.tageswerk.local` (gleiche UPDATE-Policy wie Betriebsleitung). Seed-`mgr-a1` nicht angemeldet, Passwort unverändert. Neuer Mangel `TW370-QA-MA-MANGEL 2026-11-23T08:01`, Alpha Nord, zugewiesen an QA-MA. Seed-Mängel A1/A2 unangetastet.

| Schritt | Ergebnis |
|---------|----------|
| A Zuweisung | INSERT mit `created_by` + `assigned_to` QA-MA, Status `open`, Priorität `normal` |
| B Öffnen | Karte Alpha Nord, „Meine Bearbeitung“ |
| C Vermerk | `in_progress`, Text gespeichert |
| D Status | `pending_review` mit zweitem Vermerk |
| E Reload | Status und Vermerk unverändert; Zuweisung und Priorität/Betrieb unverändert |
| F Unzulässig | `resolved` abgewiesen; kurzer Vermerk abgewiesen; erneutes `in_progress` nach Review abgewiesen |
| G Fremder Betrieb | Mangel A2 (Sued) nicht lesbar; RPC „Dieser Mangel ist dir nicht zugewiesen“. Unbekannte ID: „Mangel nicht gefunden“ |

UI nach Speichern: „Erledigung gemeldet · Freigabe ausstehend“, Bearbeitung gesperrt bis Leitung prüft.

### 13.5 Tests

`npm test` 275/275. Playwright `tests/ui/defect-archive.spec.js` 2/2. Live-Skript ohne Passwörter im Repository.

### 13.6 Offen

- Mängelarchiv-RPCs fehlen weiter.
- Volle 3.4-Technikerrolle bleibt uninstalliert.
- Funktion liegt nur in TEST, nicht in PROD.

## 14. Letzte Funktionsabnahme TEST 23.11.2026

Keine neuen Funktionen. Authentifiziert: `qa-gf-370@test.tageswerk.local`, `qa-ma-370@test.tageswerk.local`. Seed-Konten unangetastet. Skript `scripts/qa-370-final-live.mjs`.

### 14.1 Kontrollgänge

| Schritt | Ergebnis |
|---------|----------|
| Anlegen | Checkliste `TW370-QA-KG 2026-11-23T08:08`, Intervall 1 Woche, Punkte „Pumpe TW370“, „Filter TW370“ |
| Zuweisen | Lauf an QA-MA, fällig +1 Tag |
| Durchführen | QA-MA `tageswerk_complete_inspection`, Status `completed`, `performed_by` QA-MA |
| Erneut öffnen | Lauf und Ergebnisse lesbar |
| Rechte MA | Anlegen: „Kontrollgänge legt die Betriebsleitung oder Geschäftsführung an.“ Sued-Läufe: 0 |
| Ungültig | leerer Name: Check Constraint; leere Punkte: Exception |

### 14.2 Wartung

| Schritt | Ergebnis |
|---------|----------|
| Anlegen | `TW370-QA-WARTUNG 2026-11-23T08:08`, Alpha Nord, Intervall 1 Monat, verantwortlich QA-MA |
| Durchführung Leitung | Log mit Vermerk, `completed_by` QA-GF |
| Nächster Termin | `assetNextDue` → **2026-12-23T08:08:37.906Z** (nicht in der Tabelle gespeichert) |
| Durchführung Mitarbeiter | zweites Log, `completed_by` QA-MA |
| Erneut öffnen | Anlage und beide Logs lesbar |
| Rechte MA | INSERT `assets` per RLS abgewiesen |

### 14.3 Geschäftsführer-Dashboard

REST/RPC, nicht nur UI:

- Betriebe: Alpha Nord, Alpha Sued, später QA-Betrieb. **Kein Beta** (`hasBeta=false`). Kalender Beta: leere Liste, kein Mandantendatensatz.
- Layout: Upsert `tw370-layout-2026-11-23T08:08` mit Nord+Sued; neue Sitzung liest dieselbe `user_id`-Zeile.
- Verbrauch Nord: `tageswerk_consumption_calendar` 2 Monatszeilen, ohne Fehler.
- Besucher/Umsatz: `tageswerk_day_figure_overview` `access=manager`; Tageswerte `null`, Vergleich `Keine Vergleichsdaten` / `state=missing` (nicht 0).
- `utility_monthly_consumption` 2026 Nord: leer (manuelle TEST-Monate liegen in 2025).

### 14.4 Betrieb anlegen

Nebenwirkungen geprüft: nur INSERT `name`+`organization_id`, Lat/Long nullable, Trigger nur Identity-Schutz bei UPDATE, kein authenticated-INSERT. Ausführung in TEST.

- RPC-Ergebnis `ok`, Id `a2963699-cb25-401c-b9ae-31ac69946229`, Org Alpha.
- Nach Reload in der GF-Betriebsliste.
- QA-MA sieht nur Alpha Nord, nicht den neuen Betrieb, nicht Sued, nicht Beta.
- Kurzer Name: Längenprüfung. Mitarbeiter: „Nur die Geschäftsführung …“.

### 14.5 Fehlerbehandlung

Ungültige Pflichtfelder und Rechte: siehe 14.1–14.4. Wiederholtes Complete: **kein zweiter Lauf**, Vermerk wird überschrieben. REST-Abort: `TimeoutError`.

### 14.6 Offen nach dieser Runde

- Complete-Inspection überschreibt bei Wiederholung den Vermerk.
- TEST fehlt Filterspülung, Archiv, Excel-Commit; PROD hat diese Objekte (nicht umgekehrt).
- Create-Facility und manuelle Monate fehlen auf PROD, bis `sql/releases/3.7.0/` freigegeben und ausgeführt ist. Zusätzliche Sicherung entfällt auf Betreiberentscheidung.

SQL-Reihenfolge: `docs/RELEASE-MIGRATION-3.7.0.md`.

## 15. UI-Blocker Operations / Playwright (23.11.2026)

### 15.1 Ursache der Timeouts

Betroffen: Betriebsmodul-Kacheln in `#operations-tabs` (Tagesbericht, Kontrollgang, Wartung und die übrigen Module) auf Desktop und Smartphone.

`inert` auf `#view-more` (und weiteren `.view`) ist **beabsichtigt**, solange die Fläche `hidden` ist: versteckte Dialoge und Views sollen nicht fokussierbar sein. Echte Navigation nutzt `show()` / `setHidden()` und entfernt `inert` zusammen mit `hidden`.

Die Tests entfernten nur die Klasse `hidden`. `syncHiddenDialogs` ließ `inert` stehen. Playwright klickte dann auf unerreichbare Kacheln.

**Keine pauschale Entfernung von `inert`.** Benutzer über die Navigation waren nicht betroffen. Es war ein Initialisierungs-/Test-Mismatch, kein Rechtefehler.

### 15.2 Korrektur

- `setHidden` koppelt `hidden`, `inert` und `aria-hidden`.
- `show()` nutzt das für alle Schalen einschließlich `#app`.
- `syncHiddenDialogs` auch für `#app`; Aufruf direkt nach den Imports und nach `update()`.
- Login ohne initiale `hidden`-Klasse, damit die Anmeldung vor dem Auth-Lauf bedienbar ist.
- Versteckte Dialoge/Views/`#app` starten im Markup mit `inert`.
- Mock-Tests öffnen Schalen über `show()`, nicht über `classList`.
- Playwright: `serviceWorkers: 'block'`, damit der PWA-Worker den Supabase-Mock nicht umgeht.

Geprüft in der Mock-Suite: Navigation, Dashboard, Mängel (Composer bleibt geschlossen inert), Betriebsmodule, Mobile-Nav, Passwort-Dialoge, Rollen (Abnahme-Specs GF vs. Mitarbeiter).

### 15.3 Playwright-Zählung

Umgebung: lokal, `npx playwright test`, `playwright.config.js`, Webserver `node scripts/static-server.mjs` auf **127.0.0.1:4179**. `js/supabase.js` zeigt auf PROD-URL; Netz zu `supabase.co` ist in den Specs **abgebrochen**, Auth/RPC kommen aus **CDN-Mocks**. Keine Schreibvorgänge in TEST oder PROD.

| | Anzahl |
|--|--------|
| Bestanden | **82** |
| Fehlgeschlagen | **0** |
| Übersprungen | **2** (Desktop überspringt Mobile-Screenshots; ein Viewport-Fall nur Smartphone) |
| Gesamt | 84 |

`operations.spec.js` einzeln: **2/2**.

Unit: **276/276** (`npm test`, inkl. Additivität `sql/releases/3.7.0/`).

### 15.4 Risiken (Freigabe)

| Thema | Ampel | Hinweis |
|-------|-------|---------|
| Datenverlust | **GRÜN** | Diese Runde keine DDL/DML auf PROD. |
| RLS / Mandanten | **GRÜN** | Policies nicht geändert. Inventar: SELECT/INSERT/UPDATE je geprüfter Tabelle vorhanden. |
| Bestehende Funktionen | **GELB** | PROD hat Commit-, Archiv- und Filter-RPCs, TEST nicht. 3.7.0-Frontend ruft Commit nach Vorschau+Bestätigung auf. |
| DB-Abhängigkeiten | **GELB** | Kalender 6 Argumente und Prepare-Reading 0 Argumente auf PROD vorhanden. Create-Facility fehlt. |
| Rückwärtskompatibilität | **GELB** | 3.7.0-Frontend auf PROD: Kontrollgang/Wartung/Mitarbeiter-Mangel möglich; Betrieb anlegen und manuelle Monate nicht. Öffentliche App bleibt 3.6.3. |
| Fehlende Migrationen | **ROT** bis gesonderte Freigabe | `tageswerk_create_facility`, `utility_monthly_consumption`, Foto-Bucket. Paket vorbereitet, nicht ausgeführt. |
| Fehlerbehandlung | **GRÜN** | Mock und TEST: sichtbare Fehler, keine stillen Writes. |

## 16. Produktiv-Releasepaket (vorbereitet, nicht ausgeführt)

SQL: `sql/releases/3.7.0/` (`01` lesen, `02`–`05` additiv, `06` prüfen). Ablauf: `docs/RELEASE-CHECKLISTE-3.7.0.md`.

Auf eine zusätzliche Datenbanksicherung wird auf Entscheidung des Betreibers verzichtet. Das verbleibende Risiko wird akzeptiert.

`02`–`05` weder auf PROD noch auf TEST ausgeführt. TEST hat die Sollobjekte bereits; `06` dort ohne EXCEPTION. PROD: Create-Facility, Monate, privater Foto-Bucket fehlen; Archiv-RPCs inklusive Restore/Sammelarchiv und Employee-Guard sind vorhanden.

## Halt

Kein PROD-Write über lesendes Inventar hinaus, kein `main`, kein Pages, kein Commit, kein Push, kein Seed-Reset. QA-Konten und QA-Testdaten nur TEST. Passwörter nicht im Repository. `js/supabase.js` bleibt auf PROD `eqtrifscedpsngsysxvc`.
