-- Lesende Voraussetzungen für 3.6.2 im Testprojekt. Keine Schreibzugriffe.

SELECT name, status, details
FROM (
  SELECT 10 AS ord, 'tageswerk_meter_role'::text AS name,
    CASE WHEN to_regprocedure('public.tageswerk_meter_role(uuid, uuid)') IS NOT NULL THEN 'ok' ELSE 'fehlt' END AS status,
    'uuid, uuid'::text AS details
  UNION ALL SELECT 20, 'tageswerk_bind_operation_facility',
    CASE WHEN to_regprocedure('public.tageswerk_bind_operation_facility()') IS NOT NULL THEN 'ok' ELSE 'fehlt' END, 'Triggerfunktion für materials'
  UNION ALL SELECT 30, 'facilities',
    CASE WHEN to_regclass('public.facilities') IS NOT NULL THEN 'ok' ELSE 'fehlt' END, 'Kern'
  UNION ALL SELECT 40, 'procurement_requests',
    CASE WHEN to_regclass('public.procurement_requests') IS NOT NULL THEN 'ok' ELSE 'fehlt' END, 'Voraussetzung 3.1 materials'
  UNION ALL SELECT 50, 'assets',
    CASE WHEN to_regclass('public.assets') IS NOT NULL THEN 'ok' ELSE 'fehlt' END, 'Voraussetzung 3.1 materials'
  UNION ALL SELECT 60, 'maintenance_logs',
    CASE WHEN to_regclass('public.maintenance_logs') IS NOT NULL THEN 'ok' ELSE 'fehlt' END, 'Voraussetzung 3.1 materials'
  UNION ALL SELECT 70, 'materials',
    CASE WHEN to_regclass('public.materials') IS NOT NULL THEN 'ok' ELSE 'fehlt' END, 'tageswerk_3_1_materials.sql'
  UNION ALL SELECT 80, 'material_movements',
    CASE WHEN to_regclass('public.material_movements') IS NOT NULL THEN 'ok' ELSE 'fehlt' END, 'tageswerk_3_1_materials.sql'
  UNION ALL SELECT 90, 'temperature_points',
    CASE WHEN to_regclass('public.temperature_points') IS NOT NULL THEN 'ok' ELSE 'fehlt' END, 'nicht für 3.6.2-SQL, aber für UI-Warnungen'
  UNION ALL SELECT 100, 'water_pools',
    CASE WHEN to_regclass('public.water_pools') IS NOT NULL THEN 'ok' ELSE 'fehlt' END, 'nicht für 3.6.2-SQL'
  UNION ALL SELECT 110, 'staff_invitations',
    CASE WHEN to_regclass('public.staff_invitations') IS NOT NULL THEN 'ok' ELSE 'fehlt' END, 'Einladungen'
  UNION ALL SELECT 120, 'latitude-Spalte',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='facilities' AND column_name='latitude') THEN 'ok' ELSE 'fehlt' END,
    'tageswerk_3_6_0_facility_location.sql'
  UNION ALL SELECT 130, 'longitude-Spalte',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='facilities' AND column_name='longitude') THEN 'ok' ELSE 'fehlt' END,
    'tageswerk_3_6_0_facility_location.sql'
) AS x
ORDER BY ord;
