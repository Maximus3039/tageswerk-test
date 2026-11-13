-- Tageswerk 3.5.1: Zerlegung der beiden gestoppten Prüfungen.
-- Nur im SQL-Editor ausführen. Jede Abfrage liest den Katalog.
-- Dieses Skript ändert keine Tabelle, Funktion, keinen Trigger und keine Berechtigung.
-- erfuellt heißt: die Teilbedingung der bisherigen Prüfung trifft zu.
-- nicht erfuellt heißt noch nicht, dass die Sicherheit verletzt ist. Die Spalte einordnung trennt das.

WITH guard_fn AS (
  SELECT to_regprocedure('public.tageswerk_defect_archive_guard()') AS oid
),
guard_body AS (
  SELECT pg_catalog.pg_get_functiondef(guard_fn.oid) AS body
  FROM guard_fn
),
guard_trigger AS (
  SELECT trigger_row.tgtype, trigger_row.tgfoid
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = to_regclass('public.defects')
    AND trigger_row.tgname = 'aa_defects_archive_guard'
    AND NOT trigger_row.tgisinternal
),
employee_fn AS (
  SELECT to_regprocedure('public.employee_update_assigned_defect(uuid,text,text)') AS oid
),
employee_body AS (
  SELECT pg_catalog.pg_get_functiondef(employee_fn.oid) AS body
  FROM employee_fn
)
SELECT pruefung, teilbedingung, ergebnis, einordnung
FROM (
  SELECT '30 Archivierte Zeilen sind geschützt' AS pruefung,
         'Trigger aa_defects_archive_guard vorhanden' AS teilbedingung,
         CASE WHEN EXISTS (SELECT 1 FROM guard_trigger) THEN 'erfuellt' ELSE 'nicht erfuellt' END AS ergebnis,
         'Sicherheit' AS einordnung
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Trigger ist zeilenweise',
         CASE WHEN EXISTS (SELECT 1 FROM guard_trigger WHERE tgtype & 1 = 1) THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Trigger ist BEFORE',
         CASE WHEN EXISTS (SELECT 1 FROM guard_trigger WHERE tgtype & 2 = 2) THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Trigger umfasst INSERT',
         CASE WHEN EXISTS (SELECT 1 FROM guard_trigger WHERE tgtype & 4 = 4) THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Trigger umfasst DELETE',
         CASE WHEN EXISTS (SELECT 1 FROM guard_trigger WHERE tgtype & 8 = 8) THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Trigger umfasst UPDATE',
         CASE WHEN EXISTS (SELECT 1 FROM guard_trigger WHERE tgtype & 16 = 16) THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Triggerfunktion ist SECURITY DEFINER',
         CASE WHEN EXISTS (SELECT 1 FROM guard_fn JOIN pg_catalog.pg_proc AS fn ON fn.oid = guard_fn.oid WHERE fn.prosecdef IS TRUE) THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Keine Einstellung tageswerk.defect_archive',
         CASE WHEN position('tageswerk.defect_archive' IN body) = 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Kein current_setting',
         CASE WHEN position('current_setting' IN body) = 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Kein set_config',
         CASE WHEN position('set_config' IN body) = 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Freigabetabelle wird gelesen',
         CASE WHEN position('tageswerk_private.defect_archive_permit' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Freigabe ist an die angemeldete Person gebunden',
         CASE WHEN position('permit.actor_id = auth.uid()' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Wiederherstellung verlangt die passende Freigabe',
         CASE WHEN position('permit_operation IS DISTINCT FROM ''restore''' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Archivierung verlangt die passende Freigabe',
         CASE WHEN position('permit_operation IS DISTINCT FROM ''archive''' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Archivierte Zeile bleibt gesperrt',
         CASE WHEN position('Archivierte Mängel können nicht verändert werden.' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Archivierte Zeile bleibt unlöschbar',
         CASE WHEN position('Archivierte Mängel können nicht gelöscht werden.' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Direkte Archivierung bleibt gesperrt',
         CASE WHEN position('Archivierung ist nur über die vorgesehene Funktion möglich.' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Alter Meldungstext der Wiederherstellung',
         CASE WHEN position('Die Wiederherstellung verändert keine gespeicherten Angaben.' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Prüftext'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Aktueller Meldungstext der Wiederherstellung',
         CASE WHEN position('Die Wiederherstellung verändert keine Arbeitsvermerke, Fristen oder den Status.' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Arbeitsvermerk bleibt gleich',
         CASE WHEN position('NEW.change_note IS DISTINCT FROM OLD.change_note' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Status bleibt gleich',
         CASE WHEN position('NEW.status IS DISTINCT FROM OLD.status' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'Frist bleibt gleich',
         CASE WHEN position('NEW.resolution_due_at IS DISTINCT FROM OLD.resolution_due_at' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM guard_body
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'authenticated darf archived_at lesen',
         CASE WHEN pg_catalog.has_column_privilege('authenticated', 'public.defects', 'archived_at', 'SELECT') THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'authenticated darf archived_at nicht ändern',
         CASE WHEN NOT pg_catalog.has_column_privilege('authenticated', 'public.defects', 'archived_at', 'UPDATE') THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'authenticated darf archived_by nicht ändern',
         CASE WHEN NOT pg_catalog.has_column_privilege('authenticated', 'public.defects', 'archived_by', 'UPDATE') THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'authenticated darf resolved_at nicht ändern',
         CASE WHEN NOT pg_catalog.has_column_privilege('authenticated', 'public.defects', 'resolved_at', 'UPDATE') THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'authenticated darf status ändern',
         CASE WHEN pg_catalog.has_column_privilege('authenticated', 'public.defects', 'status', 'UPDATE') THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'authenticated darf change_note ändern',
         CASE WHEN pg_catalog.has_column_privilege('authenticated', 'public.defects', 'change_note', 'UPDATE') THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'authenticated darf assigned_to ändern',
         CASE WHEN pg_catalog.has_column_privilege('authenticated', 'public.defects', 'assigned_to', 'UPDATE') THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'authenticated darf defects lesen',
         CASE WHEN pg_catalog.has_table_privilege('authenticated', 'public.defects', 'SELECT') THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'authenticated darf defect_events lesen',
         CASE WHEN pg_catalog.has_table_privilege('authenticated', 'public.defect_events', 'SELECT') THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '30 Archivierte Zeilen sind geschützt', 'UPDATE- oder ALL-Richtlinie auf defects',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_catalog.pg_policy
           WHERE polrelid = to_regclass('public.defects')
             AND polcmd IN ('*', 'w')
         ) THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'Funktion employee_update_assigned_defect(uuid,text,text) vorhanden',
         CASE WHEN oid IS NOT NULL THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_fn
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'Funktionstext enthält archived_at nicht',
         CASE WHEN position('archived_at' IN body) = 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_body
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'Funktionstext enthält archived_by nicht',
         CASE WHEN position('archived_by' IN body) = 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_body
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'Funktionstext enthält tageswerk_archive_defect nicht',
         CASE WHEN position('tageswerk_archive_defect' IN body) = 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_body
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'Kompakte UPDATE-Zeile ohne Leerzeichen',
         CASE WHEN position('UPDATE public.defects SET status=p_status, change_note=' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Prüftext'
  FROM employee_body
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'UPDATE public.defects vorhanden',
         CASE WHEN position('UPDATE public.defects' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_body
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'SET status=p_status oder SET status = p_status',
         CASE WHEN position('SET status=p_status' IN body) > 0 OR position('SET status = p_status' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_body
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'change_note= oder change_note =',
         CASE WHEN position('change_note=' IN body) > 0 OR position('change_note =' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_body
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'SET assigned_to fehlt',
         CASE WHEN position('SET assigned_to' IN body) = 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_body
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'SET facility_id fehlt',
         CASE WHEN position('SET facility_id' IN body) = 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_body
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'SET organization_id fehlt',
         CASE WHEN position('SET organization_id' IN body) = 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_body
  UNION ALL
  SELECT '60 Bestehende Bearbeitung bleibt unverändert', 'Abschluss bleibt für Mitarbeiter gesperrt',
         CASE WHEN position('Vorgang ist bereits abgeschlossen oder wartet auf Freigabe' IN body) > 0 THEN 'erfuellt' ELSE 'nicht erfuellt' END,
         'Sicherheit'
  FROM employee_body
) AS parts
ORDER BY pruefung, teilbedingung;

SELECT 'Spaltenrecht' AS abschnitt,
       cols.column_name AS spalte,
       roles.rolname AS rolle,
       pg_catalog.has_column_privilege(roles.oid, to_regclass('public.defects'), cols.column_name, 'SELECT') AS lesen,
       pg_catalog.has_column_privilege(roles.oid, to_regclass('public.defects'), cols.column_name, 'UPDATE') AS aendern
FROM information_schema.columns AS cols
JOIN pg_catalog.pg_roles AS roles ON roles.rolname IN ('authenticated', 'service_role')
WHERE cols.table_schema = 'public'
  AND cols.table_name = 'defects'
ORDER BY cols.ordinal_position, roles.rolname;

SELECT 'Tabellenrecht defects' AS abschnitt,
       COALESCE(grantee.rolname, 'PUBLIC') AS rolle,
       privilege.privilege_type,
       privilege.is_grantable
FROM pg_catalog.pg_class AS relation
CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) AS privilege
LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
WHERE relation.oid = to_regclass('public.defects')
ORDER BY rolle, privilege.privilege_type;

SELECT 'Mitarbeiterfunktion Ausschnitt' AS abschnitt,
       CASE
         WHEN body IS NULL THEN NULL
         WHEN position('UPDATE' IN body) = 0 THEN body
         ELSE substring(body FROM position('UPDATE' IN body) FOR 400)
       END AS update_ausschnitt
FROM (
  SELECT pg_catalog.pg_get_functiondef(to_regprocedure('public.employee_update_assigned_defect(uuid,text,text)')) AS body
) AS employee_lookup;
