# Bestandsaufnahme Tageswerk 3.6.0

Stand: lokal nach Design-Freeze NEXUS V4.3 (`7f199d9a5f80a113ead44334a97452e7cbd12b7d`).  
Produktiv veröffentlicht: **3.5.7**. Kein Push, kein Pages-Pin-Wechsel, keine produktiven SQL-Läufe in diesem Auftrag.

## 1. Projektstruktur

| Bereich | Inhalt |
|--------|--------|
| HTML | `index.html` (Shell, Login, Views, Capture) |
| CSS | `css/app.css`, `css/tokens.css`, `css/theme-3.6.css` |
| JS | `js/*.js` (~33 Module), Einstieg `app.js` |
| Vendor | `vendor/xlsx.full.min.js` |
| SQL | Viele `tageswerk_*.sql` (inkl. vorbereiteter 3.6.0-Migrationen) |
| Edge | `supabase/functions/invite-staff/` |
| PWA | `manifest.webmanifest`, Icons, `service-worker.js` |
| Tests | `tests/committed`, `tests/entwicklung`, `tests/ui`, `tests/integration` |
| Docs | Architektur, Release, Sicherheit, Design-Reviews |

**Nur vorbereitet / nicht Laufzeit:** Patch-Skripte `scripts/patch-nexus-*.mjs`, Designvorschau-ZIP, 3.6.0 Location/Weather-SQL (nicht ausgeführt), Integrationstests nur mit Test-DB-Freigabe.

## 2. Modulmatrix (Kurz)

| Modul | Implementiert | UI | DB | Tests | Priorität Handlungsbedarf |
|-------|---------------|----|----|-------|---------------------------|
| Dashboard | Ja | Ja | Lesend | Ja | P2 |
| Orgs/Facilities (Anzeige/Scope) | Teilweise | Ja | RLS außer Repo | Indirekt | P1 Nachweis |
| Staff | Ja | Ja | RPC | Ja | P1 Live-Nachweis |
| Einladungen | Ja | Ja + Edge | Ja | Mock + SQL-Text | P1 |
| Agenda/Aufgaben | Ja | Ja | Indirekt | Ja | P3 |
| Mängel | Ja | Ja | Policies außer Repo | Umfangreich | P0 Nachweis |
| Tagesberichte | Ja | Ja | Ja | Ja | P2 |
| Kontrollgänge | Ja | Ja | Ja | Ja | P2 |
| Wartung | Ja | Ja | Ja | Ja | P3 |
| Beschaffung | Ja | Ja | Ja | Ja | P3 |
| Temperatur | Ja | Ja | Ja | Ja | P2 Installation |
| Wasserhygiene | Ja | Ja | Ja | Ja | P1 Test-DB |
| Filterspülungen | Ja | Ja | 3.5.8 vorbereitet | Ja (statisch) | P1 Integration |
| Zähler/Verbrauch | Ja | Ja | Ja | Ja | P3 |
| Historischer Import | Teilweise (Commit gesperrt) | Ja | Preview/Commit | Ja | P1 Freigabe |
| Materialbestand | Ja | Ja | Ja | Teilweise | P2 |
| Hinweise | Ja | Ja | Ja | Ja | P3 |
| Day Figures | Ja | Ja | 3.5.4 | Ja | P2 |
| Wetter | Ja | Ja | Spalten vorbereitet | Ja | P2 Migration |
| Passwort-Reset | Ja | Ja | Auth | Ja | P3 |
| PWA | Ja | Manifest/SW | — | Teilweise | P2 |

## 3. Sicherheitswarnung

Der Notice „Mandantentrennung aktiv … noch nicht vollständig nachgewiesen“ bleibt **korrekt**.

**Belegt (Client/Simulation/SQL-Text):** Rollen, Scope, Mängel-Filter, Einladungslogik, Management-Guards, SQL-Qualifikation.

**Nicht ohne Test-DB behauptet:** RLS live für Mängel/Mitgliedschaften/Einladungen, Cross-Tenant-Isolation, Policy-Drift.

Warnung wird **nicht** entfernt.

## 4. Top-Risiken

1. **P0** Mandanten-RLS für Mängel/Mitgliedschaften/Einladungen nicht im Repo / nicht CI-belegt  
2. **P0** Release-Divergenz 3.6.0 lokal vs. 3.5.7 Pages  
3. **P1** Filterspülungs-Integration nur vorbereitet  
4. **P1** Historischer Import Commit-Pfad  
5. **P1** Edge Function Service-Role Review  
6. **P2** Wetter ohne ausgeführte 3.6.0-Migration  
7. **P2** Betriebsmodule abhängig von DB-Installation  
8. **P3** Eskalations-UI ohne Server-Automation  
