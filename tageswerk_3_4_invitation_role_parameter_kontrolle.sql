-- Lesende Kontrolle nach tageswerk_3_4_invitation_role_parameter.sql.
-- Diese Abfrage schreibt nichts. Sie darf erst nach der freigegebenen Migration laufen.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Beide Einladungssignaturen' AS pruefung,
    CASE
      WHEN to_regprocedure('public.request_staff_invitation(uuid,text,text,text)') IS NOT NULL
       AND to_regprocedure('public.request_staff_invitation(uuid,text,text,text,text)') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen'
    END AS status,
    'Die vierstellige und die fünfstellige Funktion müssen gemeinsam vorhanden sein.' AS details
  UNION ALL
  SELECT 20, 'Fünfstellige Funktion ist abgesichert',
    CASE
      WHEN procedure.oid IS NOT NULL
       AND procedure.prosecdef IS TRUE
       AND COALESCE(procedure.proconfig::text, '') LIKE '%search_path=%'
       AND pg_get_functiondef(procedure.oid) LIKE '%private.can_manage_facility(p_facility_id)%'
       AND pg_get_functiondef(procedure.oid) LIKE '%v_role NOT IN (''employee'', ''technician'')%'
       AND position('INSERT INTO public.memberships' IN pg_get_functiondef(procedure.oid)) = 0
       AND position('public.memberships SET' IN pg_get_functiondef(procedure.oid)) = 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'SECURITY DEFINER, fester Suchpfad, Rollengrenze und keine Mitgliedschaftsänderung.'
  FROM (SELECT to_regprocedure('public.request_staff_invitation(uuid,text,text,text,text)') AS oid) AS lookup
  LEFT JOIN pg_proc AS procedure ON procedure.oid = lookup.oid
  UNION ALL
  SELECT 30, 'Ausführung nur für angemeldete Benutzer',
    CASE
      WHEN procedure.oid IS NOT NULL
       AND has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
       AND NOT has_function_privilege('public', procedure.oid, 'EXECUTE')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'authenticated darf ausführen. anon und public dürfen es nicht.'
  FROM (SELECT to_regprocedure('public.request_staff_invitation(uuid,text,text,text,text)') AS oid) AS lookup
  LEFT JOIN pg_proc AS procedure ON procedure.oid = lookup.oid
  UNION ALL
  SELECT 40, 'Eine offene Einladung je Betrieb und E-Mail',
    CASE WHEN to_regclass('public.staff_invitations_open_email_facility_key') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    'Der eindeutige Index verhindert eine zweite offene Einladung.'
) AS kontrolle
ORDER BY sortierung;
