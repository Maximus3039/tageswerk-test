# Mandantentrennung & RLS – Tageswerk 3.6.0

**Legende Nachweisarten**

| Code | Bedeutung |
|------|-----------|
| **A** | Im Repository nachgewiesen (SQL/Code/Tests) |
| **B** | Durch vorhandene Datenbanknachweise bestätigt (z. B. Postflight; hier: Auftrag + frühere Berichte für Filter 3.5.8) |
| **C** | Nur theoretisch vorgesehen |
| **D** | Nicht nachgewiesen |
| **E** | Nachweislich fehlerhaft |

> Repository-SQL ist **kein** Beweis, dass dieselbe Policy produktiv aktiv und unverändert ist.  
> Keine produktiven Schreibtests in diesem Auftrag. Kein separates Testprojekt vorhanden.

## 1. Tabellen mit RLS im Repo (Auszug A)

| Bereich | Tabellen (Repo) | Policies im Repo |
|---------|-----------------|------------------|
| Mitgliedschaften | `memberships` (Integration-Baseline) | SELECT `user_id = auth.uid()` – **Test-Baseline, nicht Produktiv-Migration** |
| Wasserhygiene 3.3 | pools, checks, alerts, drafts, … | SELECT/INSERT/UPDATE mit `tageswerk_*`-Rollenhilfen |
| Temperatur 3.1/3.2 | points, readings, alerts | SELECT/INSERT/UPDATE |
| Material 3.1 | materials, movements | SELECT/INSERT |
| Beschaffung/Wartung/Reports 3.0 | requests, assets, logs, daily_reports, … | SELECT/INSERT/UPDATE |
| Day Figures 3.5.4 | facility_day_figures (+ revisions) | SELECT/INSERT/UPDATE |
| Filterspülungen 3.5.8 | water_filters, water_filter_flushes (+ corrections/events) | SELECT/INSERT/UPDATE; FORCE RLS |
| Mängel `defects` | Archiv-Trigger 3.5.1 | **Keine vollständigen SELECT/INSERT/UPDATE/DELETE-Policies für `defects` im Migrationsordner gefunden** → Policies liegen vermutlich außerhalb dieses Repo-Standes (**D** für Produktiv-Identität) |
| Einladungen | SQL-Rollenparameter 3.4 | Logik in Funktionen/Edge; vollständige Tabellen-Policies **D** im App-Migrationsset |

## 2. SECURITY DEFINER

Viele RPCs setzen `SECURITY DEFINER` + `SET search_path = ''` (Filter, Day Figures, Meter-Rollen, Wasser).  
**A:** Pattern im Repo konsistent.  
**D:** Kein Live-Audit Privilege-Escalation gegen Produktiv.

## 3. Prüffragen (Kurzbewertung)

| # | Frage | Bewertung |
|---|-------|-----------|
| 1–6 | RLS/Policies je Op | A für Module mit Migrationsdateien; **D** für Live-Drift; **D** für Kern `defects`/`memberships` Produktivtext |
| 7–9 | Rollen / Org / Facility | A Client + SQL-Helfer `tageswerk_meter_role` u. a. |
| 10–11 | Fremde Betriebe lesen/ändern | A Simulation/Unit; **D** Live Cross-Tenant |
| 12–15 | Rolleneskalation / fremde Memberships/Invites | A Edge `rules.js` + Invitation-Tests; **D** Live |
| 16–17 | company/facility serverseitig / WITH CHECK | A in 3.5.8 Filter & vielen 3.x Policies |
| 18–20 | DEFINER / search_path / RPC | A search_path=''; **D** Exhaustive Review alle Prod-Funktionen |
| 21–23 | Views / zu weite Policies / OR | Stichprobe A; Exhaustive **D** |
| 24–27 | Invites / veraltete Memberships / Rollenwechsel / Parallelität | A Text/Mock; Parallelität Filter nur Guard ohne Test-DB |
| 28–29 | REST direkt / Edge | A Edge-Handler-Mocks; **D** Live Service-Role |
| 30 | Nur Frontend-Filter | **Verdacht/C:** UI filtert stark; ohne Live-RLS-Nachweis für `defects` bleibt Risiko **D** |

## 4. Filterspülungen (Auftragsklarstellung)

| Aussage | Status |
|---------|--------|
| Migrationsdateien 3.5.8 im Repo | A |
| Laut Auftrag in Produktiv-DB eingerichtet | **B** (Auftraggeberaussage; nicht erneut ausführen) |
| Cross-Tenant-Isolation live gemessen | **D** |
| Frontend + Unit/UI | A |
| Integration gegen Test-DB | Guard besteht; Lauf **D** (kein Testprojekt) |

Frühere Formulierungen „Migration fehlt“ für 3.5.8 sind für diesen Auftrag **zu korrigieren**: Installation laut Auftrag vorhanden; fehlend ist der **unabhängige Live-Nachweis** der Isolation.

## 5. Kernlücke Mängel / Mitgliedschaften / Einladungen

Der UI-Notice bleibt berechtigt:

> Mandantentrennung aktiv. Datenbankregeln für Mängel, Mitgliedschaften und Einladungen sind noch nicht vollständig nachgewiesen.

| Objekt | Repo-Policy-Vollständigkeit | Live |
|--------|----------------------------|------|
| `defects` | unvollständig im Migrationsset | D |
| `memberships` | nur Test-Baseline SELECT eng | D Produktivtext |
| `staff_invitations` | Edge + SQL-Parameter | D vollständige Policy-Matrix |

## 6. Lokales Prüfskript (NICHT gegen Produktiv ausführen)

Vorlage: `scripts/rls-live-check-vorlage.sql`  
Nur für künftige **Freigabe** auf isolierter Test-DB oder kontrolliertem Read-only Audit.

## 7. Fazit

Mandantentrennung ist **architektonisch vorgesehen (A/C)** und für neuere Module (Wasser, Filter, Day Figures, …) im Repo stark ausgearbeitet.  
**Produktive Cross-Tenant-Sicherheit für Mängel/Mitgliedschaften/Einladungen: D – nicht nachgewiesen.**  
Kein bestätigter Policy-Fehler (E) ohne Live-Test; Notice **nicht** entfernen.
