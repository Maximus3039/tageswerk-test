-- Tageswerk 3.5.4, Schema-Cache für die Kennzahlen-API neu laden
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Die Tabellen und Funktionen sind bereits installiert.
-- PostgREST kennt neue Funktionen oft erst nach diesem Hinweis.
-- Die Anweisung ändert keine Tabellen, Daten oder Berechtigungen.

NOTIFY pgrst, 'reload schema';
