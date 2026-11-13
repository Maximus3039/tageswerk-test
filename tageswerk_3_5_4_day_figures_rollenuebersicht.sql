-- Lesende Übersicht der Rollen für den Live-Test 3.5.4.
-- Schreibt nichts. Keine Passwörter, keine Auth-Daten.
-- Im SQL-Editor von eqtrifscedpsngsysxvc ausführen.

SELECT
  m.role AS rolle,
  CASE
    WHEN m.role = 'company_admin' AND m.facility_id IS NULL THEN 'Geschäftsführung (org-weit)'
    WHEN m.role = 'facility_manager' THEN 'Betriebsleitung'
    WHEN m.role = 'technician' THEN 'Techniker'
    WHEN m.role = 'employee' THEN 'Mitarbeiter'
    ELSE m.role
  END AS kennzahl_eignung,
  o.name AS organisation,
  f.name AS betrieb,
  m.is_active AS aktiv,
  p.full_name AS anzeigename,
  m.user_id
FROM public.memberships AS m
JOIN public.organizations AS o ON o.id = m.organization_id
LEFT JOIN public.facilities AS f ON f.id = m.facility_id
LEFT JOIN public.profiles AS p ON p.id = m.user_id
WHERE m.role IN ('employee', 'technician', 'facility_manager', 'company_admin')
ORDER BY
  CASE m.role
    WHEN 'company_admin' THEN 1
    WHEN 'facility_manager' THEN 2
    WHEN 'employee' THEN 3
    WHEN 'technician' THEN 4
    ELSE 5
  END,
  o.name,
  f.name NULLS FIRST,
  p.full_name NULLS LAST;
