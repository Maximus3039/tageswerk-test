-- VORLAGE: RLS-/Mandanten-Stichprobe für eine isolierte Testdatenbank.
-- NICHT gegen die produktive Supabase-Datenbank ausführen.
-- Keine Schreibtests ohne ausdrückliche Freigabe und Testprojekt.
-- Erwartet: zwei Organisationen, je ≥1 Betrieb, Benutzer je Rolle.

-- 1) Nur lesen: Policy-Inventar
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 2) RLS aktiv?
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- 3) Beispiel-Read-Checks (Rollen-SET nur in Test-DB):
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claim.sub', '<user-uuid>', true);
-- SELECT count(*) FROM public.defects;
-- SELECT count(*) FROM public.memberships;
-- Erwartung dokumentieren: 0 Zeilen fremder Organisationen.

-- STOP: Keine INSERT/UPDATE/DELETE in dieser Vorlage ohne Freigabe.
