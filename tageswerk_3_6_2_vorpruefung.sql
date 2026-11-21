-- Tageswerk 3.6.2, lesende Vorprüfung für Materialpflege und Standort-UPDATE
-- Nur pg_catalog / information_schema. Keine produktiven Tabelleninhalte.
-- Ziel: Testprojekt gamvnzggcrrlnyoknllu.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS ord, 'materials vorhanden'::text AS pruefung,
    CASE WHEN to_regclass('public.materials') IS NOT NULL THEN 'ok' ELSE 'fehler' END AS status,
    CASE WHEN to_regclass('public.materials') IS NULL
      THEN 'Tabelle fehlt. tageswerk_3_1_materials.sql ist Voraussetzung für tageswerk_3_6_2_materials_manage.sql.'
      ELSE 'Tabelle materials ist vorhanden.'
    END AS details

  UNION ALL
  SELECT 20, 'material_movements vorhanden',
    CASE WHEN to_regclass('public.material_movements') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    CASE WHEN to_regclass('public.material_movements') IS NULL
      THEN 'Buchungstabelle fehlt (ebenfalls 3.1).'
      ELSE 'Tabelle material_movements ist vorhanden.'
    END

  UNION ALL
  SELECT 30, 'materials.is_active',
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'materials'
      ) THEN 'fehler'
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'is_active'
      ) THEN 'ok'
      ELSE 'offen'
    END,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'materials'
      ) THEN 'materials fehlt; ADD COLUMN nicht möglich.'
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'is_active'
      ) THEN 'Spalte is_active vorhanden; ADD COLUMN IF NOT EXISTS ist wiederholbar.'
      ELSE 'Spalte fehlt. Migration würde DEFAULT true setzen, bestehende Zeilen bleiben erhalten.'
    END

  UNION ALL
  SELECT 40, 'materials Policies',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'materials'
    ) THEN 'hinweis' ELSE 'offen' END,
    coalesce((
      SELECT string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname)
      FROM pg_policies WHERE schemaname = 'public' AND tablename = 'materials'
    ), 'keine Policy (Tabelle fehlt oder RLS ohne Policy).')

  UNION ALL
  SELECT 50, 'materials_update Policy',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'materials' AND policyname = 'materials_update'
    ) THEN 'ok' ELSE 'offen' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'materials' AND policyname = 'materials_update'
    ) THEN 'UPDATE-Policy existiert; DROP/CREATE in der Migration ist wiederholbar.'
    ELSE 'Noch keine UPDATE-Policy. SELECT/INSERT bleiben durch 3.1 unberührt.'
    END

  UNION ALL
  SELECT 60, 'materials Grants authenticated',
    'hinweis',
    coalesce((
      SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type)
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'materials' AND grantee = 'authenticated'
    ), 'keine Grants oder Tabelle fehlt')

  UNION ALL
  SELECT 70, 'facilities vorhanden',
    CASE WHEN to_regclass('public.facilities') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    CASE WHEN to_regclass('public.facilities') IS NULL THEN 'facilities fehlt.' ELSE 'Tabelle facilities ist vorhanden.' END

  UNION ALL
  SELECT 80, 'facilities.latitude/longitude',
    CASE
      WHEN (
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name IN ('latitude', 'longitude')
      ) = 2 THEN 'ok'
      ELSE 'fehler'
    END,
    CASE
      WHEN (
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name IN ('latitude', 'longitude')
      ) = 2 THEN 'Koordinaten-Spalten vorhanden.'
      ELSE 'Spalten fehlen. tageswerk_3_6_0_facility_location.sql muss vor tageswerk_3_6_2_facility_location_update.sql laufen.'
    END

  UNION ALL
  SELECT 90, 'facilities Policies',
    'hinweis',
    coalesce((
      SELECT string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname)
      FROM pg_policies WHERE schemaname = 'public' AND tablename = 'facilities'
    ), 'keine')

  UNION ALL
  SELECT 100, 'facilities_location_update Policy',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'facilities' AND policyname = 'facilities_location_update'
    ) THEN 'ok' ELSE 'offen' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'facilities' AND policyname = 'facilities_location_update'
    ) THEN 'Standort-UPDATE-Policy existiert; DROP/CREATE ist wiederholbar.'
    ELSE 'Noch keine Standort-UPDATE-Policy.'
    END

  UNION ALL
  SELECT 110, 'facilities Grants authenticated',
    'hinweis',
    coalesce((
      SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type)
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'facilities' AND grantee = 'authenticated'
    ), 'keine Grants oder Tabelle fehlt')

  UNION ALL
  SELECT 120, 'tageswerk_meter_role',
    CASE WHEN to_regprocedure('public.tageswerk_meter_role(uuid, uuid)') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    CASE
      WHEN to_regprocedure('public.tageswerk_meter_role(uuid, uuid)') IS NULL THEN 'Funktion fehlt.'
      ELSE 'Signatur (uuid, uuid) vorhanden.'
    END

  UNION ALL
  SELECT 130, 'RLS materials',
    CASE
      WHEN to_regclass('public.materials') IS NULL THEN 'fehler'
      WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'materials' AND c.relrowsecurity) THEN 'ok'
      ELSE 'fehler'
    END,
    coalesce((
      SELECT 'rls=' || c.relrowsecurity::text || ' force=' || c.relforcerowsecurity::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'materials'
    ), 'materials fehlt')

  UNION ALL
  SELECT 140, 'RLS facilities',
    CASE
      WHEN to_regclass('public.facilities') IS NULL THEN 'fehler'
      WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'facilities' AND c.relrowsecurity) THEN 'ok'
      ELSE 'fehler'
    END,
    coalesce((
      SELECT 'rls=' || c.relrowsecurity::text || ' force=' || c.relforcerowsecurity::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'facilities'
    ), 'facilities fehlt')

  UNION ALL
  SELECT 150, 'materials Zeilenschätzung',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'materials'
    ) THEN 'ok' ELSE 'fehler' END,
    coalesce((
      SELECT 'reltuples≈' || c.reltuples::bigint::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'materials'
    ), 'keine Schätzung, Tabelle fehlt')
) AS vorpruefung
ORDER BY ord;
