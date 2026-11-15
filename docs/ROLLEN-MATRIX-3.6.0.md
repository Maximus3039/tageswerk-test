# Berechtigungsmatrix Tageswerk 3.6.0

Quellen: `js/permissions.js`, Modul-UI, SQL-Texte, Unit-Tests.  
**NN** = nicht nachgewiesen (insb. Live-RLS). UI-Guard ≠ DB-Nachweis.

Statuswerte Mängel im Code: `open` | `in_progress` | `pending_review` | `resolved`  
(Auftragstext `neu`/`closed` entspricht Labels Offen/Abgeschlossen, nicht den DB-Keys.)

## Matrix (Kurz)

| ROLLE | MODUL | LESEN | ERSTELLEN | BEARBEITEN | LÖSCHEN | FREIGEBEN |
|-------|-------|-------|-----------|------------|---------|-----------|
| company_admin | Betriebe der Org | Ja (Client+SQL-Muster) | NN/Org-Admin | NN | NN | — |
| company_admin | Mängel | Ja* | Ja* | Ja* (Review/resolved) | Archiv* | pending_review→resolved* |
| company_admin | Staff/Einladungen | Ja* | Edge invite employee/tech* | manage RPC* | Deaktivieren* | — |
| company_admin | Operations (Report/Inspection/Maint/Proc) | Ja* | Ja* | Ja* | NN | Beschaffung* |
| company_admin | Temperatur/Wasser/Filter | Ja* | Ja* | Grenzwerte/Korrektur* | NN | Quittierung* |
| company_admin | Zähler/Verbrauch | Ja* | Meter-Admin* | Ablesen* | NN | — |
| facility_manager | eigener Betrieb | Ja* | analog Leitung* | analog* | Archiv eigener Betrieb* | analog* |
| facility_manager | fremder Betrieb gleiche Org | Nein (Client) | Nein | Nein | Nein | Nein |
| facility_manager | Manager ernennen | Nein | Nein | Nein | — | — |
| employee | eigener Betrieb | Ja* | Mängel/Erfassungen* | zugewiesene Mängel (in_progress/pending_review)* | Nein | Nein |
| employee | Filterspülung | Erfassen aktiv* | Flush* | eingeschränkt* | Nein | Nein |
| employee | Spül-/Wasserhistorie | Nein/eingeschränkt* | — | — | — | — |
| technician | Historie Wasser/Filter | Ja* | Erfassen* | ohne Korrektur/Status* | Nein | Nein |
| alle | fremde Org | Nein (Client) | Nein | Nein | Nein | Nein |

\* Client und/oder Repo-SQL **A**; produktive Durchsetzung für Kernobjekte Mängel/Memberships/Invites **NN/D**.

## Entzug / Deaktivierung

| Ereignis | Client | Live-DB |
|----------|--------|---------|
| `is_active=false` | kein Manager, kein Scope | NN |
| Membership entfernt | Filter zurückgesetzt (Unit) | NN |
| Session abgelaufen | Auth-Flow | NN produktiv gemessen |

## Direkte API

Ohne gültige JWT + RLS: erwartet abgelehnt. **NN** gegen Produktiv REST.
