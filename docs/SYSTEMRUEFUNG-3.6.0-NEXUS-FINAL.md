# Systemprüfung Tageswerk 3.6.0 – NEXUS Finalisierung

**Branch:** `entwicklung/tageswerk-3.6.0`  
**Design-Freeze NEXUS V4.3:** `7f199d9a5f80a113ead44334a97452e7cbd12b7d`  
**Bestandsaufnahme/Systemprüfung:** `b06b3b52bcbf9033fcd1759f55cd3d5cbb938079` (+ Folgelauf Tests/Notice)  
**Produktiv:** 3.5.7 · Pages-Pin: `240a2e85dee772857bd14cd6206818e33175e56e` (unverändert)  
**Dieser Auftrag:** kein Push, kein Deployment, keine produktiven SQL-Läufe, keine RLS-/Auth-Architekturänderung ohne Freigabe

---

## A. Gesamtstatus Module

| Modul | Status | Nachweis |
|-------|--------|----------|
| Dashboard | Funktionsfähig | Unit + UI + Code |
| Mängel | Funktionsfähig (Client) | Unit + UI; RLS live **nicht** nachgewiesen |
| Agenda / Meine Aufgaben | Funktionsfähig | Unit + UI |
| Tagesberichte | Funktionsfähig | Unit + UI; DB-Installation vorausgesetzt |
| Kontrollgänge | Funktionsfähig | Unit + UI |
| Wartung | Funktionsfähig | Unit + UI |
| Beschaffung | Funktionsfähig | Unit + UI |
| Temperatur | Funktionsfähig | Unit; Installation vorausgesetzt |
| Wasserhygiene | Funktionsfähig | Unit; Integration Test-DB offen |
| Filterspülungen | Teilweise | UI + SQL vorbereitet; Live-Integration offen |
| Zähler / Verbrauch | Funktionsfähig | Unit (Berechnung); keine Fake-Werte im Betrieb |
| Analytics / Trends | Funktionsfähig | Unit |
| Wetter | Teilweise | API ok; Koordinaten-Migration optional |
| Staff / Einladungen | Funktionsfähig (Client) | Mock/SQL-Text; Live-RLS offen |
| Materialbestand | Funktionsfähig | Teilweise Tests |
| Hinweise | Funktionsfähig | Unit |
| Day Figures | Funktionsfähig | Unit |
| Historischer Import | Teilweise | Preview ok; Commit gesperrt |
| PWA | Funktionsfähig | Manifest/SW vorhanden; SW-Update manuell prüfbar |
| Orgs/Facilities-Verwaltung | Teilweise | Scope/Anzeige; Admin-Pflege begrenzt |
| Profil / Passwort | Funktionsfähig | Unit + Auth-Client |

**Nicht ausreichend geprüft ohne Test-DB / Freigabe:** produktive RLS, Cross-Tenant-Isolation, Edge Function Service-Role End-to-End, Filterspülungs-Schreibpfad live.

---

## B. Fehlerliste (dieser Auftrag)

| ID | Modul | Beschreibung | Prio | Korrektur / Status |
|----|-------|--------------|------|--------------------|
| F-V43-01 | Mängel Desktop | Schaltflächen unnötig gestapelt | P2 | Behoben in V4.3 (`width:auto` Desktop, Grid mobil); Regression in `design-v43.spec.js` |
| F-V43-02 | Dashboard DEMO | Spotlight zeigte Einzelnamen bei „alle“; Zähler 0 | P2 | DEMO-Skript + `paintFacilitySpotlight` korrigiert |
| F-SEC-01 | Sicherheit | Mandanten-RLS Mängel/Memberships/Invites nicht CI-belegt | P0 | **Offen** – Nachweis nur mit Test-DB; Notice bleibt |
| F-REL-01 | Release | Lokal 3.6.0 ≠ Pages 3.5.7 | P0 | **Bewusst** – kein Pin-Wechsel in diesem Auftrag |
| F-DB-01 | Filterspülung | Migration/Integration nicht produktiv ausgeführt | P1 | **Offen** – Freigabe nötig |
| F-DB-02 | Wetterspalten | 3.6.0-SQL nicht ausgeführt | P2 | App läuft ohne; strukturierte Spalten später |
| F-IMP-01 | Historischer Import | Commit-Pfad gesperrt | P1 | **Bewusst** – Regel beibehalten |
| F-DOC-01 | Status-Worte | Auftragstext `new`/`closed` ≠ Code `open`/`resolved` | P3 | Dokumentiert; Fachregel nicht geändert |

Keine P0/P1-Frontend-Hotfixes ohne Freigabe an RLS/Auth vorgenommen.

---

## C. Sicherheitsbericht

### Geprüft (Client / Simulation / SQL-Text)

- Rollen: `company_admin`, `facility_manager`, `employee` in Permissions/Guards
- Scope: nur `accessibleFacilities` / aktive Memberships in UI-Filtern
- Mängel: Statusübergänge und Sichtbarkeit clientseitig getestet
- Einladungen: Validierung + Edge-Handler-Struktur im Repo
- Notice bleibt sichtbar und inhaltlich korrekt

### Geprüft anhand vorhandener SQL-Dateien (nicht live ausgeführt)

- Policy-Texte und SECURITY DEFINER-Hinweise in Migrationsdateien
- Keine neue Policy in diesem Auftrag geändert

### Nicht nachgewiesen

1. Live SELECT/INSERT/UPDATE/DELETE Isolation Mängel über Tenant-Grenzen  
2. Membership-/Invite-Policies gegen Cross-Org-Zugriff  
3. RPC mit SECURITY DEFINER ohne Privilege-Escalation  
4. Edge `invite-staff` mit Service-Role nur unter Freigabe-Testumgebung  

**Empfehlung:** gesonderte Test-DB + RLS-Checkliste (schreibend nur gegen Testprojekt), danach Notice-Text anpassen – nicht vorher entfernen.

---

## D. Testbericht (Stand Design-Freeze V4.3)

| Suite | Ergebnis |
|-------|----------|
| `npm test` | 196 bestanden |
| `npm run test:ui` | 67 bestanden, 1 übersprungen |
| Integration produktiv | nicht ausgeführt (Regel) |
| Screenshot-DEMO | nur Design; keine Auth-Erfolgsbewertung |

Gezielte Erweiterungen in V4.3: Viewport-Checks 360–1440, Defects-Toolbar-Desktop-Layout, Facility-Spotlight „alle“.

Weitere sinnvolle Unit-/UI-Erweiterungen (Status, Permissions, Grenzwerte) sind in der Prioritätenliste unten – ohne Großfunktionen.

---

## E. Release-Checkliste 3.6.0

| Kriterium | Bewertung | Art des Nachweises |
|-----------|-----------|--------------------|
| NEXUS V4.3 Design eingefroren | Ja | Commit `7f199d9…` |
| Kein horizontales Overflow Kernviews | Ja (geprüft) | Playwright + Viewport-Skript |
| Unit-/UI-Regression Grün | Ja | Tests ausgeführt |
| Mandanten-RLS vollständig nachgewiesen | Nein | Noch nicht geprüft (Test-DB) |
| Filterspülung produktiv angebunden | Nein | Nur Code/SQL vorbereitet |
| Wetter-Koordinaten-Migration | Optional | Nur Code geprüft |
| Pages-Pin / 3.5.7 unangetastet | Ja | Workflow `240a2e8…` |
| Freigabe Veröffentlichung | **Nein** | Explizit nicht Teil dieses Auftrags |

**Einschätzung:** Technisch lokal stabil und designseitig eingefroren; **nicht releasebereit**, bis P0-Sicherheitsnachweis (Test-DB) und Freigabeentscheidung inklusive optionaler Migrationen vorliegen.

---

## Verbleibende Aufgaben (priorisiert)

1. **P0** RLS-/Mandantennachweis auf Test-DB (Freigabe)  
2. **P1** Filterspülungs-Migration + Integrationstest (Freigabe)  
3. **P1** Edge invite-staff Review in Testumgebung  
4. **P2** Wetter-Koordinatenpflege UI / Migration nach Freigabe  
5. **P2** Weitere UI-Tests leere Listen / Fehlerzustände  
6. **P3** Design nur bei echten Bedienfehlern anfassen (Freeze)

Siehe auch: `docs/BESTANDSAUFNAHME-3.6.0.md`, `docs/DESIGN-NEXUS-3.6.0-v4.3/`.
