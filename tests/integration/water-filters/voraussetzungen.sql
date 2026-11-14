-- Voraussetzungsprüfung für PostgreSQL-Integrationstests Filterspülungen 3.5.8
-- Ausschließlich lesend. Schreibt nichts, ändert keine Policies und keine Daten.
-- status = stoppen: Integration nicht starten.
-- status = bereit: Voraussetzung erfüllt.
-- status = hinweis: prüfen, Lauf ggf. trotzdem möglich.

SELECT sortierung, pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'facilities vorhanden' AS pruefung,
    CASE WHEN to_regclass('public.facilities') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END AS status,
    'Basisbetriebe aus baseline oder Produktivschema.' AS details
  UNION ALL
  SELECT 20, 'water_pools vorhanden',
    CASE WHEN to_regclass('public.water_pools') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    'Zuerst tests/integration/run.mjs (inkl. tageswerk_3_3_water_hygiene.sql).'
  UNION ALL
  SELECT 30, 'tageswerk_meter_role inkl. technician',
    CASE
      WHEN role_fn.oid IS NOT NULL
       AND position('technician' IN pg_get_functiondef(role_fn.oid)) > 0
      THEN 'bereit'
      WHEN role_fn.oid IS NOT NULL THEN 'stoppen'
      ELSE 'stoppen'
    END,
    CASE
      WHEN role_fn.oid IS NULL THEN 'tageswerk_meter_role fehlt.'
      WHEN position('technician' IN pg_get_functiondef(role_fn.oid)) = 0
      THEN 'Technikerrolle fehlt – tageswerk_3_4_technician_role.sql.'
      ELSE 'Rollenfunktion inkl. technician vorhanden.'
    END
  FROM (SELECT to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') AS oid) AS role_lookup
  LEFT JOIN pg_proc AS role_fn ON role_fn.oid = role_lookup.oid
  UNION ALL
  SELECT 40, 'tageswerk_bind_operation_facility',
    CASE WHEN to_regprocedure('public.tageswerk_bind_operation_facility()') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    'Bind-Triggerfunktion aus Betriebsmodulen.'
  UNION ALL
  SELECT 50, 'tageswerk_facility_organization',
    CASE WHEN to_regprocedure('public.tageswerk_facility_organization(uuid)') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    'Organisation wird aus dem Betrieb abgeleitet.'
  UNION ALL
  SELECT 60, 'auth.users erreichbar',
    CASE WHEN to_regclass('auth.users') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    'Supabase-Auth-Schema für Testpersonen.'
  UNION ALL
  SELECT 70, 'Rolle authenticated',
    CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN 'bereit' ELSE 'stoppen' END,
    'RLS-Tests laufen als authenticated.'
  UNION ALL
  SELECT 80, 'Filterbasis noch nicht installiert oder bereit für Verhalten',
    CASE
      WHEN to_regclass('public.water_filters') IS NULL
       AND to_regclass('public.water_filter_flushes') IS NULL
      THEN 'bereit'
      WHEN to_regclass('public.water_filters') IS NOT NULL
       AND to_regclass('public.water_filter_flushes') IS NOT NULL
      THEN 'hinweis'
      ELSE 'stoppen'
    END,
    'Fehlt die Basis: Runner installiert tageswerk_3_5_8_water_filter_flushes.sql. Existiert sie schon: nur Verhalten/Erweiterung prüfen.'
  UNION ALL
  SELECT 90, 'Erweiterung noch nicht installiert oder bereit für Verhalten',
    CASE
      WHEN to_regclass('public.water_filter_flush_corrections') IS NULL
       AND to_regclass('public.water_filter_status_events') IS NULL
      THEN 'bereit'
      WHEN to_regclass('public.water_filter_flush_corrections') IS NOT NULL
       AND to_regclass('public.water_filter_status_events') IS NOT NULL
      THEN 'hinweis'
      ELSE 'stoppen'
    END,
    'Fehlt die Erweiterung: Runner installiert tageswerk_3_5_8_water_filter_extensions.sql nach dem Basisverhalten.'
  UNION ALL
  SELECT 100, 'Kein Produktivzwang in diesem Skript',
    'bereit',
    'Dieses Skript schreibt nichts. Schreibende Schritte nur über den bestätigten Runner.'
) AS rows
ORDER BY sortierung;
