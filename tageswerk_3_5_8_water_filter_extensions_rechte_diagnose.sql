-- Lesende Diagnose: UPDATE-Rechte auf public.water_filters für authenticated.
-- Schreibt nichts. Keine Policy-Änderungen.
-- In Supabase SQL-Editor ausführen.

-- 1) has_*_privilege Kurzüberblick
SELECT
  'has_privilege' AS teil,
  has_table_privilege('authenticated', 'public.water_filters', 'UPDATE') AS table_update,
  has_column_privilege('authenticated', 'public.water_filters', 'name', 'UPDATE') AS name_update,
  has_column_privilege('authenticated', 'public.water_filters', 'active', 'UPDATE') AS active_update,
  has_column_privilege('authenticated', 'public.water_filters', 'last_flushed_at', 'UPDATE') AS last_flushed_at_update,
  has_column_privilege('authenticated', 'public.water_filters', 'last_flushed_by', 'UPDATE') AS last_flushed_by_update,
  CASE
    WHEN has_column_privilege('authenticated', 'public.water_filters', 'name', 'UPDATE')
     AND NOT has_column_privilege('authenticated', 'public.water_filters', 'active', 'UPDATE')
     AND NOT has_column_privilege('authenticated', 'public.water_filters', 'last_flushed_at', 'UPDATE')
     AND NOT has_column_privilege('authenticated', 'public.water_filters', 'last_flushed_by', 'UPDATE')
    THEN 'spaltenrechte_ok'
    ELSE 'spaltenrechte_abweichend'
  END AS spalten_bewertung,
  CASE
    WHEN has_table_privilege('authenticated', 'public.water_filters', 'UPDATE')
     AND has_column_privilege('authenticated', 'public.water_filters', 'active', 'UPDATE')
    THEN 'tabellenweites_UPDATE_vermutlich_noch_aktiv'
    WHEN NOT has_table_privilege('authenticated', 'public.water_filters', 'UPDATE')
     AND has_column_privilege('authenticated', 'public.water_filters', 'name', 'UPDATE')
    THEN 'nur_spalten_update_name__alte_pruefung_kann_fehlen'
    ELSE 'siehe_werte'
  END AS hinweis;

-- 2) Tabellenweite UPDATE-ACLs (relacl)
SELECT
  'table_acl' AS teil,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE acl.grantee::regrole::text END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_class AS cls
CROSS JOIN LATERAL aclexplode(coalesce(cls.relacl, acldefault('r', cls.relowner))) AS acl
WHERE cls.oid = 'public.water_filters'::regclass
  AND acl.privilege_type = 'UPDATE'
ORDER BY grantee;

-- 3) Explizite Spalten-UPDATE-ACLs (attacl); leer = keine spaltenweisen Einträge
SELECT
  'column_acl' AS teil,
  attr.attname AS column_name,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE acl.grantee::regrole::text END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_attribute AS attr
JOIN LATERAL aclexplode(attr.attacl) AS acl ON true
WHERE attr.attrelid = 'public.water_filters'::regclass
  AND NOT attr.attisdropped
  AND attr.attnum > 0
  AND attr.attacl IS NOT NULL
  AND acl.privilege_type = 'UPDATE'
ORDER BY attr.attname, grantee;

-- 4) information_schema Sicht für authenticated/PUBLIC/anon
SELECT
  'information_schema' AS teil,
  grantee,
  column_name,
  privilege_type,
  is_grantable
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'water_filters'
  AND privilege_type = 'UPDATE'
  AND grantee IN ('authenticated', 'PUBLIC', 'anon')
ORDER BY grantee, column_name;
