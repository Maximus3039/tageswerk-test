# Release-Baseline Tageswerk 3.6.0 (Phase 1)

Stand der lokalen Bestandsaufnahme vor Sicherheit-/Integrationsprüfung.  
**Kein Push, kein Deployment, keine produktiven DB-Änderungen in diesem Auftrag.**

## 1. Git-Status

| Feld | Wert |
|------|------|
| Branch | `entwicklung/tageswerk-3.6.0` |
| HEAD | `d8b5201a754e8d09c94f4cd2aa6d50c6571e3fb3` |
| Working Tree | sauber (nur untracked Junk) |
| Untracked (nicht Teil der App) | `Tageswerk-3.6.0-Designvorschau/`, `.zip`, `agent-tools-run.json` |
| Ungesicherte Codeänderungen | keine (bei Baseline-Start) |

### Letzte relevante Commits

| Hash | Kurz |
|------|------|
| `d8b5201` | test: Sicherheitsnotice und Systemprüfung nach NEXUS-Freeze |
| `b06b3b5` | docs: Bestandsaufnahme und Systemprüfung 3.6.0 |
| `7f199d9` | **Design-Freeze NEXUS V4.3** |
| `d8728e6` | NEXUS V4.2 |
| `00d02a7` | NEXUS V4.1 |

## 2. Versionen

| Ebene | Version / Pin |
|-------|----------------|
| `package.json` | `3.6.0` |
| UI (`index.html`, Manifest, SW-Cache) | `3.6.0` / `tageswerk-shell-3.6.0` |
| Öffentlich / Pages | **3.5.7** |
| Pages-Workflow-Pin | `240a2e85dee772857bd14cd6206818e33175e56e` (**unverändert**) |

Diff Pin→HEAD: ca. **31 Commits**, **159 Dateien**, **+10645 / −93** Zeilen (inkl. Design, Filter 3.5.8, Docs, Tests).

## 3. Vorhandene Dokumentation (Auszug)

- `docs/BESTANDSAUFNAHME-3.6.0.md`
- `docs/SYSTEMRUEFUNG-3.6.0-NEXUS-FINAL.md`
- `docs/AUTH-ROLLEN-SICHERHEIT-3.6.0.md`
- `docs/MODULPRUEFUNG-3.6.0-PHASEN-6-11.md`
- `docs/RELEASEPRUEFUNG-3.6.0.md`, `docs/ABSCHLUSSBERICHT-3.6.0.md`
- `docs/SICHERHEIT-3.6.0-migrationen.md`
- Design: `docs/DESIGN-NEXUS-3.6.0-v4.3.md` (+ Reviews)

## 4. Testskripte (`package.json`)

| Befehl | Zweck | Produktiv-Schreiben? |
|--------|-------|----------------------|
| `npm test` | Syntax + Unit (committed/entwicklung) | Nein (Mocks/Fixtures) |
| `npm run test:ui` | Playwright | Nein (Mock-Client, aborted Supabase) |
| `npm run check` | Syntax | Nein |
| `npm run test:entwicklung` | Teilmenge | Nein |
| `npm run test:integration` | echte Test-DB | **Nur mit URL; Produktiv-Marker sperrt** |
| `npm run test:integration:water-filters` | ditto | **Produktiv-Marker sperrt** |
| Viewport-/Screenshot-Skripte | lokal/DEMO | Nein; DESIGN-DEMO markiert |

**Nicht ausgeführt in diesem Auftrag ohne Freigabe:** Integration gegen echte DB (kein Testprojekt vorhanden).

## 5. Sicherheitsprüfungen (bestehend)

- Client: `permissions.js`, Access-Scope-, Management-, Defect-, Invitation-Tests
- SQL-Text: `sql-qualification`, `production-bodies`, water-filter SQL/RLS-Texte
- Tenant-Simulation: `tests/entwicklung/tenant-separation.test.mjs`
- Notice in UI: Mandantentrennung / Policies „noch nicht vollständig nachgewiesen“
- Integration-Runner: Hard-Stop bei produktivem Projektmarker

## 6. SQL-Migrationen (Repo)

Viele `tageswerk_*.sql` (2.9 … 3.6.0). Gruppen:

| Gruppe | Dateien (Kern) | Status-Hinweis |
|--------|----------------|----------------|
| 2.9 Zähler/Import | `tageswerk_2_9_*` | Historisch; Commit-Import gesperrt |
| 3.0–3.3 Betriebsmodule | reports, inspections, maintenance, procurement, materials, notices, temperature, water | Repo vorhanden |
| 3.4 Einladungen/Guards/Wasser-Runden | `tageswerk_3_4_*` | Repo vorhanden |
| 3.5.1 Archiv | `tageswerk_3_5_1_defect_archive*` | Repo vorhanden |
| 3.5.4 Day Figures | `tageswerk_3_5_4_day_figures*` | Repo vorhanden |
| 3.5.8 Filterspülungen | `tageswerk_3_5_8_water_filter_*` | **Laut Auftrag in Produktiv-DB eingerichtet** – in diesem Auftrag nicht erneut ausführen; Live-Verhalten Cross-Tenant weiter **nicht** CI-nachgewiesen |
| 3.6.0 Location/Wetter | `tageswerk_3_6_0_*` | Vorbereitet; Ausführung nur mit Freigabe |

Repo-SQL ≠ Nachweis „identisch aktiv in Produktiv“.

## 7. Edge Functions

| Funktion | Pfad |
|----------|------|
| `invite-staff` | `supabase/functions/invite-staff/` (`index.ts`, `handler.js`, `rules.js`) |

Keine weiteren Functions im Repo.

## 8. Anwendungsmodule (`js/`)

Auth/Shell: `app.js`, `auth.js`, `password-reset.js`, `state.js`, `supabase.js`, `permissions.js`, `utils.js`, `labels.js`  
Mängel: `defects.js`, `defects-store.js`, `defects-ui.js`  
Dashboard/Mobile: `dashboard.js`, `mobile.js`, `nexus-icons.js`  
Betrieb: `operations*.js`, `operations-ui*.js`, `water-filters.js`, `weather.js`, `consumption-analytics.js`  
Zähler/Import: `meters*.js`, `meter-import*.js`  
Staff: `staff-ui.js`

## 9. Lesen vs. Schreiben (Überblick)

| Bereich | Lesen | Schreiben (Client-Pfad) |
|---------|-------|-------------------------|
| Auth | Session | signIn/signOut/updateUser/reset |
| Mängel | `from('defects')` / Cache | insert/update/RPC Mitarbeiter-Update |
| Staff/Einladungen | memberships/staff | RPC `manage_facility_membership`, Edge invite |
| Operations | reports/inspections/… | insert/update/RPC je Modul |
| Wasser/Filter | Tabellen/RPC | Erfassen/Korrektur laut Rolle |
| Zähler | meters/readings | Ablesung (Stand), Admin-Anlage |
| Wetter | Open-Meteo | optional Berichtsfelder (nach Migration) |
| Historischer Import | Preview | Commit **gesperrt** / Freigabe |

## 10. Mock- / Demo-Mechanismen

| Ort | Risiko Normalbetrieb |
|-----|----------------------|
| Playwright-Routen / `tests/supabase-mock.mjs` | Nur Tests |
| `scripts/design-review-screenshots-v*.mjs` | DESIGN-DEMO DOM; **nicht** in App-Import |
| Patch-Skripte `scripts/patch-nexus-*.mjs` | Einmalige Dev-Patches; nicht Laufzeit |
| Kein Mock-Login in `js/auth.js` / `js/supabase.js` | Echtes Supabase Auth |

**Fazit Demo:** Kein DESIGN-DEMO-Code im produktiven Modulgraphen gefunden.

## 11. Abhängigkeiten

| Paket | Version |
|-------|---------|
| `@playwright/test` (dev) | `1.65.0` |
| Runtime | Vanilla ES-Module; Supabase-JS via CDN ESM |
| Vendor | `vendor/xlsx.full.min.js` |

## 12. Technische Baseline (Kurz)

- Lokaler Stand **3.6.0 NEXUS V4.3 eingefroren**, produktiv veröffentlicht **3.5.7**.
- Sicherheitsnotice bleibt korrekt, solange Mandanten-RLS nicht live nachgewiesen.
- Filterspülungen: Migrationen **laut Auftrag produktiv vorhanden**; fehlend bleibt reproduzierbarer Cross-Tenant-/Integrationsnachweis ohne Prod-Schreiben.
- 3.6.0 Location/Wetter-SQL: vorbereitet, Freigabe nötig.
- Integrationstests starten ohne Test-DB-URL nicht und blockieren Produktiv-Marker.
- Untracked Designvorschau/agent-tools gehören **nicht** in Commits.

Nächste Phasen: Testbaseline → Auth/Rollen/RLS-Analyse → Module → Readiness (ohne Commit bis Freigabe).
