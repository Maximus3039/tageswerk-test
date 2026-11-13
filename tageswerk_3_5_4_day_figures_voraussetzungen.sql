-- Lesende Kontrolle vor tageswerk_3_5_4_day_figures.sql.
-- Diese Abfrage schreibt nichts. Sie darf im SQL-Editor ausgeführt werden.
-- Nur wenn jede Zeile bereit ist, darf die Migration freigegeben werden.
-- Produktives Projekt: eqtrifscedpsngsysxvc. Keine Schreibrechte in dieser Datei.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Organisationen und Betriebe' AS pruefung,
    CASE WHEN to_regclass('public.organizations') IS NOT NULL AND to_regclass('public.facilities') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END AS status,
    CASE WHEN to_regclass('public.organizations') IS NOT NULL AND to_regclass('public.facilities') IS NOT NULL
      THEN 'organizations und facilities sind vorhanden.'
      ELSE 'organizations oder facilities fehlen.' END AS details
  UNION ALL
  SELECT 20, 'Zusammengesetzte Eindeutigkeit facilities(id, organization_id)',
    CASE WHEN EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'facilities'
        AND constraint_row.contype IN ('u', 'p')
        AND pg_get_constraintdef(constraint_row.oid) ILIKE '%(id, organization_id)%'
    ) OR EXISTS (
      SELECT 1
      FROM pg_index AS index_row
      JOIN pg_class AS relation ON relation.oid = index_row.indrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'facilities'
        AND index_row.indisunique
        AND pg_get_indexdef(index_row.indexrelid) ILIKE '%(id, organization_id)%'
    ) THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'facilities'
        AND constraint_row.contype IN ('u', 'p')
        AND pg_get_constraintdef(constraint_row.oid) ILIKE '%(id, organization_id)%'
    ) OR EXISTS (
      SELECT 1
      FROM pg_index AS index_row
      JOIN pg_class AS relation ON relation.oid = index_row.indrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'facilities'
        AND index_row.indisunique
        AND pg_get_indexdef(index_row.indexrelid) ILIKE '%(id, organization_id)%'
    ) THEN 'Die zusammengesetzte Eindeutigkeit ist vorhanden.'
      ELSE 'facilities(id, organization_id) ist nicht eindeutig. Der Fremdschlüssel der Migration würde scheitern.' END
  UNION ALL
  SELECT 30, 'Mitgliedschaften',
    CASE WHEN to_regclass('public.memberships') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regclass('public.memberships') IS NOT NULL THEN 'public.memberships ist vorhanden.' ELSE 'public.memberships fehlt.' END
  UNION ALL
  SELECT 40, 'Rollenfunktion tageswerk_meter_role',
    CASE WHEN to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL THEN 'tageswerk_meter_role ist vorhanden.' ELSE 'tageswerk_meter_role fehlt.' END
  UNION ALL
  SELECT 50, 'Organisationsfunktion tageswerk_facility_organization',
    CASE WHEN to_regprocedure('public.tageswerk_facility_organization(uuid)') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regprocedure('public.tageswerk_facility_organization(uuid)') IS NOT NULL THEN 'tageswerk_facility_organization ist vorhanden.' ELSE 'tageswerk_facility_organization fehlt.' END
  UNION ALL
  SELECT 60, 'Bindungstriggerfunktion tageswerk_bind_operation_facility',
    CASE WHEN to_regprocedure('public.tageswerk_bind_operation_facility()') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regprocedure('public.tageswerk_bind_operation_facility()') IS NOT NULL THEN 'tageswerk_bind_operation_facility ist vorhanden.' ELSE 'tageswerk_bind_operation_facility fehlt. Tagesberichte 3.0 prüfen.' END
  UNION ALL
  SELECT 70, 'Textberichte daily_reports',
    CASE WHEN to_regclass('public.daily_reports') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regclass('public.daily_reports') IS NOT NULL THEN 'daily_reports ist vorhanden und bleibt von 3.5.4 unberührt.' ELSE 'daily_reports fehlt.' END
  UNION ALL
  SELECT 80, 'Kennzahlentabellen sind noch nicht angelegt',
    CASE WHEN to_regclass('public.facility_day_figures') IS NULL
      AND to_regclass('public.facility_day_figure_revisions') IS NULL THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regclass('public.facility_day_figures') IS NULL
      AND to_regclass('public.facility_day_figure_revisions') IS NULL
      THEN 'Die neuen Tabellen sind frei.'
      ELSE 'facility_day_figures oder facility_day_figure_revisions existieren bereits. Keine zweite Ausführung ohne Freigabe.' END
  UNION ALL
  SELECT 90, 'Öffentliche Kennzahlenfunktionen sind noch nicht angelegt',
    CASE WHEN to_regprocedure('public.tageswerk_save_day_figures(uuid,date,integer,bigint,bigint,bigint,text,text)') IS NULL
      AND to_regprocedure('public.tageswerk_day_figure_overview(uuid,date,date,text)') IS NULL
      AND to_regprocedure('public.tageswerk_day_figure_period(uuid)') IS NULL THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regprocedure('public.tageswerk_save_day_figures(uuid,date,integer,bigint,bigint,bigint,text,text)') IS NULL
      AND to_regprocedure('public.tageswerk_day_figure_overview(uuid,date,date,text)') IS NULL
      AND to_regprocedure('public.tageswerk_day_figure_period(uuid)') IS NULL
      THEN 'Die öffentlichen Kennzahlenfunktionen sind frei.'
      ELSE 'Mindestens eine Kennzahlenfunktion ist schon vorhanden.' END
  UNION ALL
  SELECT 100, 'Schema tageswerk_private',
    CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tageswerk_private') THEN 'bereit' ELSE 'hinweis' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tageswerk_private')
      THEN 'tageswerk_private ist vorhanden. Die Migration legt es bei Bedarf mit IF NOT EXISTS erneut an.'
      ELSE 'tageswerk_private fehlt noch. Die Migration legt das Schema an.' END
  UNION ALL
  SELECT 110, 'Rollen authenticated und anon',
    CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
      AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
      AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
      THEN 'Die Supabase-Rollen sind vorhanden.'
      ELSE 'authenticated oder anon fehlt.' END
) AS kontrolle
ORDER BY sortierung;
