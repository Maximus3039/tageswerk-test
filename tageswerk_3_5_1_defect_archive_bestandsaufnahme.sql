-- Tageswerk 3.5.1: Bestandsaufnahme der vorhandenen Mängelstruktur.
-- Nur im SQL-Editor ausführen. Jede Abfrage liest den Katalog.
-- Dieses Skript ändert keine Tabelle, Funktion, keinen Trigger und keine Berechtigung.
-- Es ruft keine Archivfunktion auf und installiert die Archivmigration nicht.
-- Die Ergebnistabellen nacheinander lesen. Eine Zeile ist eine Tatsache, keine Freigabe.

SELECT '01 Schema' AS abschnitt,
       namespace.nspname AS schema_name,
       pg_catalog.pg_get_userbyid(namespace.nspowner) AS eigentuemer,
       namespace.nspacl::text AS rechte
FROM pg_catalog.pg_namespace AS namespace
WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND namespace.nspname NOT LIKE 'pg_temp%'
  AND namespace.nspname NOT LIKE 'pg_toast%'
ORDER BY namespace.nspname;

SELECT '02 Tabellen' AS abschnitt,
       namespace.nspname AS schema_name,
       relation.relname AS tabelle,
       pg_catalog.pg_get_userbyid(relation.relowner) AS eigentuemer,
       owner_role.rolsuper AS eigentuemer_ist_superuser,
       owner_role.rolbypassrls AS eigentuemer_umgeht_rls,
       relation.relrowsecurity AS rls_aktiv,
       relation.relforcerowsecurity AS rls_erzwungen,
       relation.relacl::text AS tabellenrechte
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
WHERE relation.relkind = 'r'
  AND relation.relname IN ('defects', 'defect_events', 'memberships', 'facilities')
  AND namespace.nspname = 'public'
ORDER BY relation.relname;

SELECT '03 Spalten' AS abschnitt,
       cols.table_name,
       cols.ordinal_position,
       cols.column_name,
       cols.data_type,
       cols.udt_name,
       cols.is_nullable,
       cols.column_default,
       cols.is_identity,
       cols.is_generated,
       cols.character_maximum_length
FROM information_schema.columns AS cols
WHERE cols.table_schema = 'public'
  AND cols.table_name IN ('defects', 'defect_events')
ORDER BY cols.table_name, cols.ordinal_position;

SELECT '04 Pflichtfelder ohne Vorgabe' AS abschnitt,
       cols.table_name,
       cols.column_name,
       cols.data_type
FROM information_schema.columns AS cols
WHERE cols.table_schema = 'public'
  AND cols.table_name IN ('defects', 'defect_events')
  AND cols.is_nullable = 'NO'
  AND cols.column_default IS NULL
  AND cols.is_identity = 'NO'
  AND cols.is_generated = 'NEVER'
ORDER BY cols.table_name, cols.column_name;

SELECT '05 Constraints' AS abschnitt,
       source_table.relname AS tabelle,
       constraint_row.conname,
       constraint_row.contype,
       pg_catalog.pg_get_constraintdef(constraint_row.oid) AS definition,
       target_table.relname AS ziel_tabelle
FROM pg_catalog.pg_constraint AS constraint_row
JOIN pg_catalog.pg_class AS source_table ON source_table.oid = constraint_row.conrelid
LEFT JOIN pg_catalog.pg_class AS target_table ON target_table.oid = constraint_row.confrelid
WHERE constraint_row.conrelid IN (to_regclass('public.defects'), to_regclass('public.defect_events'))
   OR constraint_row.confrelid IN (to_regclass('public.defects'), to_regclass('public.defect_events'))
ORDER BY source_table.relname, constraint_row.conname;

SELECT '06 Richtlinien' AS abschnitt,
       relation.relname AS tabelle,
       policy.polname,
       policy.polcmd,
       policy.polpermissive,
       CASE
         WHEN cardinality(policy.polroles) = 0 THEN 'PUBLIC'
         ELSE (
           SELECT string_agg(policy_role.rolname, ', ' ORDER BY policy_role.rolname)
           FROM pg_catalog.pg_roles AS policy_role
           WHERE policy_role.oid = ANY (policy.polroles)
         )
       END AS rollen,
       pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) AS using_bedingung,
       pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) AS check_bedingung
FROM pg_catalog.pg_policy AS policy
JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
WHERE relation.oid IN (to_regclass('public.defects'), to_regclass('public.defect_events'))
ORDER BY relation.relname, policy.polname;

SELECT '07 Tabellenrechte aus ACL' AS abschnitt,
       relation.relname AS tabelle,
       COALESCE(grantee.rolname, 'PUBLIC') AS rolle,
       privilege.privilege_type,
       privilege.is_grantable,
       grantor.rolname AS vergeben_von
FROM pg_catalog.pg_class AS relation
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
) AS privilege
LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = privilege.grantor
WHERE relation.oid IN (to_regclass('public.defects'), to_regclass('public.defect_events'))
ORDER BY relation.relname, rolle, privilege.privilege_type;

SELECT '08 Ausdrückliche Spaltenrechte' AS abschnitt,
       relation.relname AS tabelle,
       attribute.attname AS spalte,
       COALESCE(grantee.rolname, 'PUBLIC') AS rolle,
       privilege.privilege_type,
       privilege.is_grantable
FROM pg_catalog.pg_attribute AS attribute
JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS privilege
LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
WHERE relation.oid IN (to_regclass('public.defects'), to_regclass('public.defect_events'))
  AND attribute.attacl IS NOT NULL
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
ORDER BY relation.relname, attribute.attname, rolle, privilege.privilege_type;

SELECT '09 Wirksame Spaltenrechte' AS abschnitt,
       cols.table_name,
       cols.column_name,
       roles.rolname,
       pg_catalog.has_column_privilege(roles.oid, to_regclass(format('%I.%I', cols.table_schema, cols.table_name)), cols.column_name, 'SELECT') AS lesen,
       pg_catalog.has_column_privilege(roles.oid, to_regclass(format('%I.%I', cols.table_schema, cols.table_name)), cols.column_name, 'INSERT') AS anlegen,
       pg_catalog.has_column_privilege(roles.oid, to_regclass(format('%I.%I', cols.table_schema, cols.table_name)), cols.column_name, 'UPDATE') AS aendern
FROM information_schema.columns AS cols
JOIN pg_catalog.pg_roles AS roles
  ON roles.rolname IN ('anon', 'authenticated', 'service_role')
WHERE cols.table_schema = 'public'
  AND cols.table_name IN ('defects', 'defect_events')
ORDER BY cols.table_name, cols.column_name, roles.rolname;

SELECT '10 Rollen mit Tabellenrecht' AS abschnitt,
       relation.relname AS tabelle,
       roles.rolname,
       roles.rolsuper,
       roles.rolbypassrls,
       pg_catalog.has_table_privilege(roles.oid, relation.oid, 'SELECT') AS lesen,
       pg_catalog.has_table_privilege(roles.oid, relation.oid, 'INSERT') AS anlegen,
       pg_catalog.has_table_privilege(roles.oid, relation.oid, 'UPDATE') AS aendern,
       pg_catalog.has_table_privilege(roles.oid, relation.oid, 'DELETE') AS loeschen
FROM pg_catalog.pg_roles AS roles
JOIN pg_catalog.pg_class AS relation
  ON relation.oid IN (to_regclass('public.defects'), to_regclass('public.defect_events'))
WHERE pg_catalog.has_table_privilege(roles.oid, relation.oid, 'SELECT')
   OR pg_catalog.has_table_privilege(roles.oid, relation.oid, 'INSERT')
   OR pg_catalog.has_table_privilege(roles.oid, relation.oid, 'UPDATE')
   OR pg_catalog.has_table_privilege(roles.oid, relation.oid, 'DELETE')
ORDER BY relation.relname, roles.rolname;

SELECT '11 Rollenvererbung' AS abschnitt,
       member_role.rolname AS rolle,
       parent_role.rolname AS erbt_von
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
JOIN pg_catalog.pg_roles AS parent_role ON parent_role.oid = membership.roleid
WHERE member_role.rolname IN ('anon', 'authenticated', 'authenticator', 'service_role')
ORDER BY member_role.rolname, parent_role.rolname;

SELECT '12 Trigger' AS abschnitt,
       relation.relname AS tabelle,
       trigger_row.tgname,
       trigger_row.tgenabled,
       function_row.proname AS funktion,
       pg_catalog.pg_get_userbyid(function_row.proowner) AS funktions_eigentuemer,
       function_row.prosecdef AS security_definer,
       pg_catalog.pg_get_triggerdef(trigger_row.oid) AS definition
FROM pg_catalog.pg_trigger AS trigger_row
JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
JOIN pg_catalog.pg_proc AS function_row ON function_row.oid = trigger_row.tgfoid
WHERE trigger_row.tgrelid IN (to_regclass('public.defects'), to_regclass('public.defect_events'))
  AND NOT trigger_row.tgisinternal
ORDER BY relation.relname, trigger_row.tgname;

SELECT '13 Funktionen' AS abschnitt,
       function_row.proname,
       pg_catalog.pg_get_function_identity_arguments(function_row.oid) AS argumente,
       pg_catalog.pg_get_userbyid(function_row.proowner) AS eigentuemer,
       function_row.prosecdef AS security_definer,
       function_row.proconfig::text AS einstellungen,
       function_row.proacl::text AS ausführungsrechte,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles AS role_row
         WHERE role_row.rolname = 'anon'
           AND pg_catalog.has_function_privilege(role_row.oid, function_row.oid, 'EXECUTE')
       ) AS anon_darf_ausfuehren,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles AS role_row
         WHERE role_row.rolname = 'authenticated'
           AND pg_catalog.has_function_privilege(role_row.oid, function_row.oid, 'EXECUTE')
       ) AS authenticated_darf_ausfuehren,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles AS role_row
         WHERE role_row.rolname = 'service_role'
           AND pg_catalog.has_function_privilege(role_row.oid, function_row.oid, 'EXECUTE')
       ) AS service_role_darf_ausfuehren,
       position('UPDATE' IN function_row.prosrc) > 0 AS enthaelt_update,
       CASE
         WHEN position('UPDATE' IN function_row.prosrc) = 0 THEN NULL
         ELSE substring(function_row.prosrc FROM position('UPDATE' IN function_row.prosrc) FOR 280)
       END AS aenderungsausschnitt
FROM pg_catalog.pg_proc AS function_row
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function_row.pronamespace
WHERE namespace.nspname = 'public'
  AND function_row.prokind = 'f'
  AND function_row.prosrc ILIKE '%defect%'
ORDER BY function_row.proname, argumente;

SELECT '14 Abhängige Sichten' AS abschnitt,
       namespace.nspname AS schema_name,
       relation.relname AS sicht,
       relation.relkind,
       pg_catalog.pg_get_userbyid(relation.relowner) AS eigentuemer
FROM pg_catalog.pg_rewrite AS rewrite
JOIN pg_catalog.pg_depend AS dependency ON dependency.objid = rewrite.oid
JOIN pg_catalog.pg_class AS relation ON relation.oid = rewrite.ev_class
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE dependency.refobjid IN (to_regclass('public.defects'), to_regclass('public.defect_events'))
  AND relation.relkind IN ('v', 'm')
ORDER BY namespace.nspname, relation.relname;

SELECT '15 Bearbeitungsbild' AS abschnitt,
       punkt,
       ergebnis
FROM (
  SELECT 'authenticated Tabellenrecht UPDATE auf defects' AS punkt,
         CASE
           WHEN to_regclass('public.defects') IS NULL THEN 'tabelle fehlt'
           ELSE pg_catalog.has_table_privilege('authenticated', 'public.defects', 'UPDATE')::text
         END AS ergebnis
  UNION ALL
  SELECT 'authenticated Tabellenrecht SELECT auf defects',
         CASE
           WHEN to_regclass('public.defects') IS NULL THEN 'tabelle fehlt'
           ELSE pg_catalog.has_table_privilege('authenticated', 'public.defects', 'SELECT')::text
         END
  UNION ALL
  SELECT 'authenticated Tabellenrecht INSERT auf defects',
         CASE
           WHEN to_regclass('public.defects') IS NULL THEN 'tabelle fehlt'
           ELSE pg_catalog.has_table_privilege('authenticated', 'public.defects', 'INSERT')::text
         END
  UNION ALL
  SELECT 'authenticated Tabellenrecht DELETE auf defects',
         CASE
           WHEN to_regclass('public.defects') IS NULL THEN 'tabelle fehlt'
           ELSE pg_catalog.has_table_privilege('authenticated', 'public.defects', 'DELETE')::text
         END
  UNION ALL
  SELECT 'anon Tabellenrecht UPDATE auf defects',
         CASE
           WHEN to_regclass('public.defects') IS NULL THEN 'tabelle fehlt'
           ELSE pg_catalog.has_table_privilege('anon', 'public.defects', 'UPDATE')::text
         END
  UNION ALL
  SELECT 'service_role vorhanden',
         EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role')::text
  UNION ALL
  SELECT 'service_role Tabellenrecht UPDATE auf defects',
         CASE
           WHEN to_regclass('public.defects') IS NULL THEN 'tabelle fehlt'
           WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN 'rolle fehlt'
           ELSE pg_catalog.has_table_privilege('service_role', 'public.defects', 'UPDATE')::text
         END
  UNION ALL
  SELECT 'authenticated Spaltenrecht UPDATE status',
         CASE
           WHEN EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'defects' AND column_name = 'status'
           ) THEN pg_catalog.has_column_privilege('authenticated', 'public.defects', 'status', 'UPDATE')::text
           ELSE 'spalte fehlt'
         END
  UNION ALL
  SELECT 'authenticated Spaltenrecht UPDATE assigned_to',
         CASE
           WHEN EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'defects' AND column_name = 'assigned_to'
           ) THEN pg_catalog.has_column_privilege('authenticated', 'public.defects', 'assigned_to', 'UPDATE')::text
           ELSE 'spalte fehlt'
         END
  UNION ALL
  SELECT 'authenticated Spaltenrecht UPDATE change_note',
         CASE
           WHEN EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'defects' AND column_name = 'change_note'
           ) THEN pg_catalog.has_column_privilege('authenticated', 'public.defects', 'change_note', 'UPDATE')::text
           ELSE 'spalte fehlt'
         END
  UNION ALL
  SELECT 'authenticated Spaltenrecht SELECT defects',
         CASE
           WHEN to_regclass('public.defects') IS NULL THEN 'tabelle fehlt'
           ELSE pg_catalog.has_table_privilege('authenticated', 'public.defects', 'SELECT')::text
         END
  UNION ALL
  SELECT 'authenticated Spaltenrecht SELECT defect_events',
         CASE
           WHEN to_regclass('public.defect_events') IS NULL THEN 'tabelle fehlt'
           ELSE pg_catalog.has_table_privilege('authenticated', 'public.defect_events', 'SELECT')::text
         END
  UNION ALL
  SELECT 'Eigentuemer von defects',
         COALESCE((
           SELECT pg_catalog.pg_get_userbyid(relation.relowner)
           FROM pg_catalog.pg_class AS relation
           WHERE relation.oid = to_regclass('public.defects')
         ), 'tabelle fehlt')
  UNION ALL
  SELECT 'Eigentuemer von employee_update_assigned_defect',
         COALESCE((
           SELECT string_agg(pg_catalog.pg_get_userbyid(function_row.proowner), ', ' ORDER BY function_row.oid::text)
           FROM pg_catalog.pg_proc AS function_row
           JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function_row.pronamespace
           WHERE namespace.nspname = 'public'
             AND function_row.proname = 'employee_update_assigned_defect'
         ), 'funktion fehlt')
  UNION ALL
  SELECT 'employee_update_assigned_defect ist SECURITY DEFINER',
         COALESCE((
           SELECT string_agg(function_row.prosecdef::text, ', ' ORDER BY function_row.oid::text)
           FROM pg_catalog.pg_proc AS function_row
           JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function_row.pronamespace
           WHERE namespace.nspname = 'public'
             AND function_row.proname = 'employee_update_assigned_defect'
         ), 'funktion fehlt')
  UNION ALL
  SELECT 'Anzahl Trigger auf defects',
         (
           SELECT count(*)::text
           FROM pg_catalog.pg_trigger AS trigger_row
           WHERE trigger_row.tgrelid = to_regclass('public.defects')
             AND NOT trigger_row.tgisinternal
         )
  UNION ALL
  SELECT 'Anzahl Richtlinien auf defects',
         (
           SELECT count(*)::text
           FROM pg_catalog.pg_policy AS policy
           WHERE policy.polrelid = to_regclass('public.defects')
         )
  UNION ALL
  SELECT 'Anzahl Richtlinien auf defect_events',
         (
           SELECT count(*)::text
           FROM pg_catalog.pg_policy AS policy
           WHERE policy.polrelid = to_regclass('public.defect_events')
         )
  UNION ALL
  SELECT 'Archivspalten bereits vorhanden',
         (
           SELECT count(*)::text
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'defects'
             AND column_name IN ('archived_at', 'archived_by', 'resolved_at')
         )
) AS facts
ORDER BY punkt;
