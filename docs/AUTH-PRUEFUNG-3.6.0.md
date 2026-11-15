# Authentifizierungsprüfung 3.6.0 (Phase 3)

Keine produktiven Anmeldeversuche.

| # | Prüfpunkt | Ergebnis | Nachweisart |
|---|-----------|----------|-------------|
| 1 | Supabase Init | createClient + persist/autoRefresh | Code |
| 2 | E-Mail/Passwort | signInWithPassword | Code |
| 3 | Ungültige Zugangsdaten | Fehler an UI | Code; Live NN |
| 4–5 | Session abgelaufen / Restore | getUser + persistSession | Code |
| 6 | Abmeldung | signOut + Cache-Clear | Code + Unit |
| 7 | Passwort-Reset | Redirect/Rate/No-leak | Unit+UI |
| 8 | Auth-State-Listener | PASSWORD_RECOVERY | Code |
| 9–11 | Netz / reconnect | status messages; visibility refresh | Code; Live NN |
| 12–13 | Geschützte Views / Module | screenForAuth login vs app | Unit |
| 14–16 | Profil / deaktiviert / Membership | filter is_active; loadPermissions | Code+Unit Scope |
| 17 | Veraltete Rechte | Memberships neu geladen | Code |
| 18–20 | Race Login/Logout/parallel | updateInProgress Guard | Code |
| 21 | Daten während Laden | status + app hidden ohne user | Code |
| 22 | Reset-Weiterleitung | feste Pages-URL | Unit |
| 23 | Session-Leaks | Logout leert defects/acks/drafts/channel | Unit |
| 24 | UI-Reset Logout | siehe 23 | Unit |
| 25 | Kein Mock-Login Normalbetrieb | assert gegen mockLogin/DEMO | Unit |

**Gesamt:** Client-Auth für Release **codegeprüft**; nicht als produktiver Auth-Penetrationstest werten.
