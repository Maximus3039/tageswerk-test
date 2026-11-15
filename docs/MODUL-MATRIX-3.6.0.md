# Modulmatrix Tageswerk 3.6.0

| MODUL | FRONTEND | DATENFLUSS | BERECHTIGUNG | TESTS | RISIKO | STATUS |
|-------|----------|------------|--------------|-------|--------|--------|
| Dashboard | Ja | Lesen Mängel/Wetter/Verbrauch | Scope Client | Unit+UI | P2 Konsistenz/Wetter | Funktionsfähig |
| Mängel | Ja | CRUD/RPC | Client+SQL-Text; Live RLS **NN** | stark | P0 Nachweis | Funktionsfähig Client |
| Agenda/Aufgaben | Ja | abgeleitet | Scope | Unit+UI | niedrig | Funktionsfähig |
| Tagesberichte | Ja | RW | Rollen | Unit+UI | mittel | Funktionsfähig |
| Kontrollgänge | Ja | RW | Rollen | Unit | mittel | Funktionsfähig |
| Wartung | Ja | RW | Rollen | Unit | mittel | Funktionsfähig |
| Beschaffung | Ja | RW + Freigabe | Leitung freigibt | Unit | mittel | Funktionsfähig |
| Temperatur | Ja | RW | Rollen | Unit+UI | mittel | Funktionsfähig |
| Wasserhygiene | Ja | RW/RPC | Rollen | Unit+UI | P1 Live | Funktionsfähig |
| Filterspülungen | Ja | RW; Migration **prod laut Auftrag** | Rollen SQL A | Unit+UI; Integration Guard | P1 Cross-Tenant NN | Funktionsfähig Client |
| Zähler/Verbrauch | Ja | Stand speichern, Verbrauch rechnen | Meter-Rolle | Unit | niedrig | Funktionsfähig |
| Historischer Import | Ja Preview | Commit gesperrt | Leitung | Unit | P1 Freigabe | Teilweise |
| Material | Ja | RW | Rollen | Unit | mittel | Funktionsfähig |
| Hinweise | Ja | RW | Scope | Unit | niedrig | Funktionsfähig |
| Day Figures | Ja | RW | Leitung | Unit+UI | mittel | Funktionsfähig |
| Staff/Einladungen | Ja + Edge | RPC/Edge | Manager | Unit Mock | P1 Live Edge | Funktionsfähig Client |
| Wetter | Ja | Open-Meteo | — | Unit | P2 Koordinaten | Teilweise |
| PWA | Manifest/SW | Cache 3.6.0 | — | Unit SW | P2 Update | Funktionsfähig |
| Profil/Passwort | Ja | Auth | User | Unit+UI | niedrig | Funktionsfähig |

**Freigabefähig je Modul:** nur mit klarer Trennung „Client grün“ vs. „Live-RLS nachgewiesen“. Gesamtrelease: siehe `RELEASE-READINESS-3.6.0.md`.
