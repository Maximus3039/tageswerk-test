# Auth, Rollen und Mandantentrennung – Prüfung 3.6.0

Stand nach NEXUS-Freeze `7f199d9…`. Keine produktiven Auth-/RLS-Änderungen in diesem Auftrag.

## 3.1 Anmeldung (Code + vorhandene Tests)

| Prüfung | Ergebnis | Nachweis |
|---------|----------|----------|
| E-Mail/Passwort | Client über Supabase Auth verdrahtet | `js/auth.js`, Login-UI |
| Falsches Passwort / unbekannte E-Mail | Fehlermeldung an Login-Oberfläche | Code; Live gegen Prod nicht ausgeführt |
| Sitzung wiederherstellen | `getSession` / Auth-Listener | Code |
| Abmeldung | Sign-out + State-Reset | Code + UI |
| Passwort zurücksetzen | Reset-Flow vorhanden | Code + Unit-Hinweise |
| Offline | Netzwerkfehler sichtbar | Code-Pfad; kein separater Offline-E2E |
| Abgelaufene Sitzung | Auth-State-Change erwartet | Code; Live nicht gemessen |

**Bewertung:** Frontend-Pfad vorhanden und für Release **nur codegeprüft**, nicht als produktiver Authentifizierungstest gewertet.

## 3.2 Profil

| Prüfung | Code |
|---------|------|
| Anzeigename | Account-Bereich / Profil |
| Rolle | aus Memberships (`roleNames`) |
| Org/Betrieb | `accessibleFacilities` / Memberships |

Profiländerungen speichern über Auth/Profile-Update – ohne Live-Schreibtest gegen Prod.

## 3.3 Rollen (Frontend-Guards)

| Rolle | Typische Sicht | Schreiben (Client) |
|-------|----------------|--------------------|
| `company_admin` | Alle Betriebe der Org | Manager-Funktionen org-weit (`facility_id == null`) |
| `facility_manager` | Zugeordnete Betriebe | Mängel-Review, Staff (ohne Manager-Ernennung ohne GF), Betriebsmodule |
| `employee` / `technician` | Zugewiesene Betriebe | Eigene zugewiesene Mängel (`in_progress`/`pending_review`), Erfassungen laut Modul |

`isManager` in `js/permissions.js` bleibt maßgeblich für UI-Guards; **DB bleibt Autorität**.

Ausgeblendete Schaltflächen ≠ Sicherheit. Client-Tests decken Filter/Guards ab; RLS live fehlt.

## 4. Mandantentrennung

| Anforderung | Client | SQL-Text | Live-RLS |
|-------------|--------|----------|----------|
| Nur berechtigte Orgs/Betriebe sehen | Ja (Scope) | Policies in Repo-SQL | **Nicht nachgewiesen** |
| Keine Cross-Org-Daten | Filter + Membership-Checks | Qualifikation in Funktionen | **Nicht nachgewiesen** |
| Manager nicht fremde Betriebe | `isManager` | Membership-Check in RPC-Text | **Nicht nachgewiesen** |

Sicherheitsnotice bleibt.

## 5. Mängel-Status (fachlich im Code)

Ist-Zustand Labels/Code: `open` → `in_progress` → `pending_review` → `resolved`  
(Auftragstext `new`/`closed` entspricht **nicht** dem Code – keine Umbenennung ohne Fachfreigabe.)

Mitarbeiter: nur `in_progress` / `pending_review` + Vermerk; kein `resolved`.  
Leitung: Freigabe/Rückgabe inkl. `resolved`.

## Nächste Freigabe-Schritte

1. Testprojekt Supabase mit anonymen Seed-Tenants  
2. Matrix SELECT/INSERT/UPDATE/DELETE je Rolle und Cross-Tenant  
3. Edge `invite-staff` nur in Testprojekt  
4. Danach Notice-Text anpassen – nicht vorher entfernen  
