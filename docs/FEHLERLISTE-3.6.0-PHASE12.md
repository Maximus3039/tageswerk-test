# Fehler- und Befundliste – Phase Sicherheit/Integration

| ID | Modul | Beschreibung | Prio | Typ | Aktion |
|----|-------|--------------|------|-----|--------|
| SEC-RLS-01 | Mandanten | Live-RLS Cross-Tenant für Mängel/Memberships/Invites fehlt | P0 | Nachweis fehlt | Freigabe Test-/Audit |
| REL-PIN-01 | Release | Lokal 3.6.0 ≠ Pages 3.5.7 | P0 | bewusst | Pin unverändert |
| SEC-EDGE-01 | Edge | invite-staff Service-Role nur Mock geprüft | P1 | Nachweis fehlt | kein Prod-Versand |
| SEC-DEF-POL | Mängel | Keine vollständigen defects-Policies im Migrationsset | P1 | Verdacht/Nachweis fehlt | Policy-Export |
| DB-360-01 | Wetter/Location | 3.6.0-SQL nicht ausgeführt | P2 | Freigabe | optional |
| DOC-FILTER-01 | Filter | Frühere Docs sagten „Migration fehlt“ – laut Auftrag installiert | P3 | dokumentiert | korrigiert in RLS-Doc |
| UX-STATUS | Mängel | Auftragstext new/closed ≠ Code open/resolved | P3 | Hinweis | keine Umbenennung |

**Kein bestätigter P0-Exploit im Client ohne Live-Beweis.** Fehlender Nachweis ≠ bestätigter Fehler.
