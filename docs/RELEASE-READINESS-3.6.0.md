# Release-Readiness Tageswerk 3.6.0 NEXUS

**Empfehlung: C – Nicht releasebereit**  
Begründung: Mandanten-RLS für Mängel/Mitgliedschaften/Einladungen ist **nicht live nachgewiesen**; öffentlich bleibt 3.5.7; kein Testprojekt für Isolationstests. Client und Design sind lokal stabil.

Kein Push, kein Pages-Pin-Wechsel, kein Commit in diesem Auftrag bis Freigabe durch den Projektverantwortlichen.

---

## 1. Zusammenfassung

NEXUS V4.3 ist eingefroren. Unit- und UI-Baseline sind grün. Auth/Rollen/Edge/Filter sind code- und mockseitig stark abgesichert. **Produktive Cross-Tenant-Sicherheit bleibt die zentrale offene Freigabegrenze.**

## 2. Git-Stand (Baseline-Start + lokale Arbeitsdateien)

| Feld | Wert |
|------|------|
| Branch | `entwicklung/tageswerk-3.6.0` |
| Letzter Commit vor diesem Auftrag | `d8b5201` |
| Design-Freeze | `7f199d9` |
| Pages-Pin | `240a2e85dee772857bd14cd6206818e33175e56e` |
| Commit in diesem Auftrag | **noch nicht** (laut Anweisung) |

## 3. Version

Lokal **3.6.0** · Öffentlich **3.5.7**

## 4. Testresultate

| Suite | Ergebnis |
|-------|----------|
| `npm test` | **201 pass / 0 fail / 0 skip** (inkl. Auth-Session + Dashboard-Kennzahlen) |
| `npm run test:ui` | **69 pass / 1 skip / 0 fail** |
| Integration Produktiv/Test-DB | nicht ausgeführt |

Details: `docs/TESTBASELINE-3.6.0.md`

## 5–8. Sicherheit / RLS / Rollen / Edge

| Thema | Bewertung |
|-------|-----------|
| Auth-Client | A – kein Mock-Login; Logout leert Cache (Unit) |
| Rollen-UI | A – Matrix `docs/ROLLEN-MATRIX-3.6.0.md` |
| RLS Live Mandanten Kern | **D – nicht nachgewiesen** |
| Filter 3.5.8 | B Installation laut Auftrag; Live Isolation D |
| Edge invite-staff | A Mock/Handler; **kein** produktiver Versand getestet |
| Notice | bleibt |

Siehe `docs/RLS-MANDANTENTRENNUNG-3.6.0.md`, `docs/AUTH-ROLLEN-SICHERHEIT-3.6.0.md`

## 9. Filterspülungen

Frontend + Repo-SQL + Unit/UI: belastbar.  
Produktiv eingerichtet laut Auftrag.  
Cross-Tenant- und Parallelitäts-Live: fehlend (kein Testprojekt).

## 10–12. Module / Dashboard / PWA

Siehe `docs/MODUL-MATRIX-3.6.0.md`.  
Dashboard-Kennzahlen trennen Status bewusst (`open` ≠ alle aktiven).  
Wetter ohne Koordinaten ohne stilles Geocode.  
PWA-Cache `tageswerk-shell-3.6.0`; DESIGN-DEMO nur in Screenshot-Skripten.

## 13. Behobene Fehler (dieser Auftrag)

| ID | Art | Status |
|----|-----|--------|
| DOC-FILTER-01 | Korrektur: 3.5.8 nicht pauschal „fehlend“ | dokumentiert |
| TEST-AUTH-01 | Auth/Logout/Statuskeys Regression | neuer Unit-Test |
| TEST-DASH-01 | Kennzahlen-Status-Trennung | neuer Unit-Test |

Keine Designänderungen. Keine DB-Änderungen.

## 14. Offene Punkte

| ID | Kategorie | Priorität | Typ |
|----|-----------|-----------|-----|
| SEC-RLS-01 | Mängel/Memberships/Invites Live | P0 | Nachweis fehlt |
| SEC-EDGE-01 | invite-staff Service-Role Live | P1 | Nachweis fehlt |
| REL-PIN-01 | 3.6.0 ≠ Pages 3.5.7 | P0 | bewusst bis Freigabe |
| DB-360-01 | Location/Wetter-Migration | P2 | Freigabe nötig |
| IMP-01 | Historischer Import Commit | P1 | bewusst gesperrt |

## 15. Fehlende Nachweise

- Live SELECT/INSERT/UPDATE/DELETE Cross-Tenant  
- Policy-Drift Produktiv vs. Repo für `defects`/`memberships`  
- Edge E2E ohne Prod-Mail  

## 16. Risiken

1. Veröffentlichung ohne RLS-Nachweis → unakzeptabel  
2. Falsche Annahme „Repo-SQL = Prod-Policy“  
3. Cache-Mix 3.5.7/3.6.0 bei spätem Deploy ohne SW-Versionierung (Version bereits getrennt)

## 17. Nächste Schritte

1. Freigabe: isoliertes Testprojekt **oder** kontrollierter Read-only Policy-Export  
2. `scripts/rls-live-check-vorlage.sql` nur dort ausführen  
3. Danach Notice-Text anpassen – nicht vorher  
4. Optional 3.6.0 Location/Wetter-Migration  
5. Explizite Freigabe Push/Pages-Pin  

## 18. Release-Checkliste

| Punkt | Status |
|-------|--------|
| Design-Freeze V4.3 | BESTANDEN |
| Git-Status geprüft | BESTANDEN |
| Unit-Tests | BESTANDEN (Baseline; Re-Lauf nach Test-Erweiterung) |
| UI-Tests voll | BESTANDEN (69/1) |
| Authentifizierung | BESTANDEN (Code/Unit; keine Prod-Logins) |
| Rollen | BESTANDEN (Client); Live NN |
| RLS analysiert | BESTANDEN (Repo) |
| Mandantentrennung nachgewiesen | **NICHT NACHGEWIESEN** |
| Edge Functions geprüft | BESTANDEN (Mock); Live NN |
| Filterspülungen | BESTANDEN Client; Live Isolation NN |
| Mängelmanagement | BESTANDEN Client |
| Dashboard | BESTANDEN |
| Module | BESTANDEN mit Einschränkungen |
| PWA | BESTANDEN |
| Sicherheitswarnungen bewertet | BESTANDEN (bleiben) |
| DB-Stand dokumentiert | BESTANDEN mit Unsicherheit Drift |
| Migrationen abgeglichen | BESTANDEN (3.5.8 B; 3.6.0 offen) |
| Bekannte Fehler dokumentiert | BESTANDEN |
| Release-Risiken | BESTANDEN |
| Rollback-Konzept | BESTANDEN (Pin 3.5.7 belassen) |
| Deployment-Ablauf | vorbereitet, **nicht** ausgeführt |
| Freigabeentscheidung | **ausstehend** |

## 19. Empfehlung

**C – Nicht releasebereit** bis SEC-RLS-01 geklärt ist.

Optional später **B – unter Bedingungen**, wenn: Live-RLS-Nachweis positiv, Notice angepasst, Pin-Freigabe, Migrationsentscheidung.

## 20. Entscheidungen des Projektverantwortlichen

1. Testprojekt / Read-only Policy-Audit freigeben?  
2. 3.6.0 Location/Wetter-SQL ausführen?  
3. Wann Pages-Pin auf 3.6.0?  
4. Edge invite-staff Live-Review?  
5. Commit der Dokumente/Tests dieses Auftrags freigeben?  
