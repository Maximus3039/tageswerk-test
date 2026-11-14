-- Vorprüfung vor tageswerk_3_5_8_water_filter_flushes.sql
-- Ausschließlich lesend. Schreibt nichts, ändert keine Policies und keine Daten.
-- Im Supabase-SQL-Editor vor der Migration ausführen.
-- status = stoppen: Migration nicht starten.
-- status = bereit: Voraussetzung erfüllt.
-- status = hinweis: prüfen, Migration ggf. trotzdem möglich.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'water_pools vorhanden' AS pruefung,
    CASE WHEN to_regclass('public.water_pools') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END AS status,
    'Die Becken-Tabelle aus tageswerk_3_3_water_hygiene.sql muss existieren.' AS details
  UNION ALL
  SELECT 20, 'facilities vorhanden',
    CASE WHEN to_regclass('public.facilities') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    'facility_id braucht public.facilities.'
  UNION ALL
  SELECT 30, 'tageswerk_meter_role',
    CASE
      WHEN role_fn.oid IS NOT NULL
       AND position('technician' IN pg_get_functiondef(role_fn.oid)) > 0
      THEN 'bereit'
      WHEN role_fn.oid IS NOT NULL THEN 'hinweis'
      ELSE 'stoppen'
    END,
    CASE
      WHEN role_fn.oid IS NULL THEN 'tageswerk_meter_role fehlt.'
      WHEN position('technician' IN pg_get_functiondef(role_fn.oid)) = 0
      THEN 'tageswerk_meter_role ohne technician – tageswerk_3_4_technician_role.sql prüfen.'
      ELSE 'tageswerk_meter_role inkl. technician ist vorhanden.'
    END
  FROM (SELECT to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') AS oid) AS role_lookup
  LEFT JOIN pg_proc AS role_fn ON role_fn.oid = role_lookup.oid
  UNION ALL
  SELECT 40, 'tageswerk_bind_operation_facility',
    CASE WHEN to_regprocedure('public.tageswerk_bind_operation_facility()') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    'Bind-Triggerfunktion muss vorhanden sein.'
  UNION ALL
  SELECT 50, 'tageswerk_facility_organization',
    CASE WHEN to_regprocedure('public.tageswerk_facility_organization(uuid)') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    'Organisation wird aus dem Betrieb abgeleitet.'
  UNION ALL
  SELECT 60, 'Keine Namenskonflikte Tabellen',
    CASE
      WHEN to_regclass('public.water_filters') IS NULL
       AND to_regclass('public.water_filter_flushes') IS NULL
      THEN 'bereit' ELSE 'stoppen'
    END,
    'water_filters und water_filter_flushes dürfen vor der Migration nicht existieren.'
  UNION ALL
  SELECT 70, 'Keine Namenskonflikte Funktionen',
    CASE
      WHEN to_regprocedure('public.tageswerk_normalize_water_filter()') IS NULL
       AND to_regprocedure('public.tageswerk_protect_water_filter()') IS NULL
       AND to_regprocedure('public.tageswerk_stamp_water_filter_flush()') IS NULL
       AND to_regprocedure('public.tageswerk_protect_water_filter_flush()') IS NULL
       AND to_regprocedure('public.tageswerk_apply_water_filter_last_flush()') IS NULL
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Die neuen Funktionsnamen dürfen noch nicht belegt sein.'
  UNION ALL
  SELECT 80, 'water_pools-Spalten',
    CASE
      WHEN pools.oid IS NOT NULL
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = pools.oid AND attname = 'id' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = pools.oid AND attname = 'facility_id' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = pools.oid AND attname = 'organization_id' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = pools.oid AND attname = 'active' AND NOT attisdropped)
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Filterbindung braucht id, facility_id, organization_id und active an water_pools.'
  FROM (SELECT to_regclass('public.water_pools') AS oid) AS pools
  UNION ALL
  SELECT 90, 'RLS an water_pools',
    CASE
      WHEN pools.oid IS NOT NULL AND pools.relrowsecurity IS TRUE THEN 'bereit'
      WHEN pools.oid IS NOT NULL THEN 'hinweis'
      ELSE 'stoppen'
    END,
    CASE
      WHEN pools.oid IS NULL THEN 'water_pools fehlt.'
      WHEN pools.relrowsecurity IS NOT TRUE THEN 'water_pools ohne RLS – Installationsstand prüfen.'
      ELSE 'water_pools hat RLS.'
    END
  FROM pg_class AS pools
  WHERE pools.oid = to_regclass('public.water_pools')
  UNION ALL
  SELECT 100, 'authenticated-Rolle',
    CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN 'bereit' ELSE 'stoppen' END,
    'Supabase-Rolle authenticated muss existieren.'
  UNION ALL
  SELECT 110, 'anon-Rolle',
    CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN 'bereit' ELSE 'hinweis' END,
    'anon sollte existieren, damit REVOKE greift.'
  UNION ALL
  SELECT 120, 'Kein vorab gesetztes Filter-Policy-Konflikt',
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('water_filters', 'water_filter_flushes')
      ) THEN 'bereit' ELSE 'stoppen'
    END,
    'Vor der Migration dürfen keine Policies auf den neuen Tabellennamen liegen.'
) AS checks
ORDER BY sortierung;
