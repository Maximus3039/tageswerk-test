-- Lesende Erfolgskontrolle nach tageswerk_3_5_4_day_figures.sql.
-- Diese Abfrage schreibt nichts. Sie darf im SQL-Editor ausgeführt werden.
-- Erwartung: jede Zeile status = bereit.
-- Produktives Projekt: eqtrifscedpsngsysxvc. Keine Schreibrechte in dieser Datei.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Tabelle facility_day_figures' AS pruefung,
    CASE WHEN to_regclass('public.facility_day_figures') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END AS status,
    CASE WHEN to_regclass('public.facility_day_figures') IS NOT NULL
      THEN 'facility_day_figures ist vorhanden.'
      ELSE 'facility_day_figures fehlt.' END AS details
  UNION ALL
  SELECT 20, 'Tabelle facility_day_figure_revisions',
    CASE WHEN to_regclass('public.facility_day_figure_revisions') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regclass('public.facility_day_figure_revisions') IS NOT NULL
      THEN 'facility_day_figure_revisions ist vorhanden.'
      ELSE 'facility_day_figure_revisions fehlt.' END
  UNION ALL
  SELECT 30, 'RLS und FORCE auf Kennzahlentabellen',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = 'facility_day_figures'
        AND relation.relrowsecurity AND relation.relforcerowsecurity
    ) AND EXISTS (
      SELECT 1 FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = 'facility_day_figure_revisions'
        AND relation.relrowsecurity AND relation.relforcerowsecurity
    ) THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = 'facility_day_figures'
        AND relation.relrowsecurity AND relation.relforcerowsecurity
    ) AND EXISTS (
      SELECT 1 FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = 'facility_day_figure_revisions'
        AND relation.relrowsecurity AND relation.relforcerowsecurity
    ) THEN 'RLS und FORCE RLS sind auf beiden Tabellen aktiv.'
      ELSE 'RLS oder FORCE RLS fehlt.' END
  UNION ALL
  SELECT 40, 'Leitungs-Policies ohne Mitarbeiter-Schreibzugriff',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'facility_day_figures' AND policyname = 'facility_day_figures_select'
    ) AND EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'facility_day_figures' AND policyname = 'facility_day_figures_insert'
    ) AND EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'facility_day_figures' AND policyname = 'facility_day_figures_update'
    ) AND EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'facility_day_figure_revisions' AND policyname = 'facility_day_figure_revisions_select'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('facility_day_figures', 'facility_day_figure_revisions')
        AND (qual ILIKE '%employee%' OR with_check ILIKE '%employee%')
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'facility_day_figure_revisions'
        AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'facility_day_figures' AND policyname = 'facility_day_figures_select'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'facility_day_figure_revisions'
        AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) THEN 'Select/Insert/Update für Leitung und nur Select auf Revisionen sind vorhanden.'
      ELSE 'Policies fehlen oder erlauben unzulässige Revisionsänderungen.' END
  UNION ALL
  SELECT 50, 'Trigger Guard, Audit und Bindung',
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'facility_day_figures_guard' AND NOT tgisinternal)
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'facility_day_figures_audit' AND NOT tgisinternal)
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'facility_day_figures_bind_facility' AND NOT tgisinternal)
      THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'facility_day_figures_guard' AND NOT tgisinternal)
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'facility_day_figures_audit' AND NOT tgisinternal)
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'facility_day_figures_bind_facility' AND NOT tgisinternal)
      THEN 'Guard-, Audit- und Bindungstrigger sind vorhanden.'
      ELSE 'Mindestens ein Trigger fehlt.' END
  UNION ALL
  SELECT 60, 'Öffentliche Kennzahlenfunktionen',
    CASE WHEN to_regprocedure('public.tageswerk_save_day_figures(uuid,date,integer,bigint,bigint,bigint,text,text)') IS NOT NULL
      AND to_regprocedure('public.tageswerk_day_figure_overview(uuid,date,date,text)') IS NOT NULL
      AND to_regprocedure('public.tageswerk_day_figure_period(uuid)') IS NOT NULL
      AND to_regprocedure('public.tageswerk_figure_role(uuid)') IS NOT NULL
      AND to_regprocedure('public.tageswerk_figure_change(numeric,numeric)') IS NOT NULL
      AND to_regprocedure('public.tageswerk_guard_day_figure()') IS NOT NULL
      AND to_regprocedure('public.tageswerk_audit_day_figure()') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regprocedure('public.tageswerk_save_day_figures(uuid,date,integer,bigint,bigint,bigint,text,text)') IS NOT NULL
      AND to_regprocedure('public.tageswerk_day_figure_overview(uuid,date,date,text)') IS NOT NULL
      AND to_regprocedure('public.tageswerk_day_figure_period(uuid)') IS NOT NULL
      THEN 'Speichern, Übersicht und Periodenrechnung sind vorhanden.'
      ELSE 'Mindestens eine öffentliche Kennzahlenfunktion fehlt.' END
  UNION ALL
  SELECT 70, 'Interne Summenfunktion außerhalb von public',
    CASE WHEN to_regprocedure('tageswerk_private.figure_measure(uuid,date,date,date,date,text)') IS NOT NULL
      AND to_regprocedure('public.tageswerk_figure_measure(uuid,date,date,date,date,text)') IS NULL
      THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regprocedure('tageswerk_private.figure_measure(uuid,date,date,date,date,text)') IS NOT NULL
      AND to_regprocedure('public.tageswerk_figure_measure(uuid,date,date,date,date,text)') IS NULL
      THEN 'figure_measure liegt nur in tageswerk_private.'
      ELSE 'figure_measure fehlt oder liegt noch in public.' END
  UNION ALL
  SELECT 80, 'EXECUTE nur für Speichern, Übersicht und Periode',
    CASE WHEN has_function_privilege('authenticated', 'public.tageswerk_save_day_figures(uuid,date,integer,bigint,bigint,bigint,text,text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.tageswerk_day_figure_overview(uuid,date,date,text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.tageswerk_day_figure_period(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'tageswerk_private.figure_measure(uuid,date,date,date,date,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.tageswerk_figure_role(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.tageswerk_figure_change(numeric,numeric)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.tageswerk_guard_day_figure()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.tageswerk_audit_day_figure()', 'EXECUTE')
      THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN has_function_privilege('authenticated', 'public.tageswerk_save_day_figures(uuid,date,integer,bigint,bigint,bigint,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'tageswerk_private.figure_measure(uuid,date,date,date,date,text)', 'EXECUTE')
      THEN 'authenticated darf speichern und lesen, aber keine internen Hilfsfunktionen ausführen.'
      ELSE 'Die EXECUTE-Rechte weichen vom Soll ab.' END
  UNION ALL
  SELECT 90, 'Spaltenrechte nur auf wirtschaftliche Werte',
    CASE WHEN has_table_privilege('authenticated', 'public.facility_day_figures', 'SELECT')
      AND has_table_privilege('authenticated', 'public.facility_day_figures', 'INSERT')
      AND has_column_privilege('authenticated', 'public.facility_day_figures', 'visitors', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.facility_day_figures', 'gate_cents', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.facility_day_figures', 'bistro_cents', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.facility_day_figures', 'total_cents', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.facility_day_figures', 'facility_id', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.facility_day_figures', 'organization_id', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.facility_day_figures', 'created_by', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.facility_day_figures', 'source', 'UPDATE')
      AND has_table_privilege('authenticated', 'public.facility_day_figure_revisions', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.facility_day_figure_revisions', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.facility_day_figure_revisions', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.facility_day_figure_revisions', 'DELETE')
      THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN has_column_privilege('authenticated', 'public.facility_day_figures', 'visitors', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.facility_day_figures', 'facility_id', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.facility_day_figure_revisions', 'UPDATE')
      THEN 'UPDATE nur auf Besuchern und Umsätzen; Revisionen ohne Schreibrecht.'
      ELSE 'Tabellen- oder Spaltenrechte weichen vom Soll ab.' END
  UNION ALL
  SELECT 100, 'Textberichte unverändert vorhanden',
    CASE WHEN to_regclass('public.daily_reports') IS NOT NULL
      AND to_regprocedure('public.tageswerk_bind_operation_facility()') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regclass('public.daily_reports') IS NOT NULL
      THEN 'daily_reports und die Bindungsfunktion bleiben vorhanden.'
      ELSE 'daily_reports oder die Bindungsfunktion fehlen.' END
  UNION ALL
  SELECT 110, 'Keine Kennzahlendaten durch die Migration angelegt',
    CASE WHEN COALESCE((SELECT count(*) FROM public.facility_day_figures), 0) = 0
      AND COALESCE((SELECT count(*) FROM public.facility_day_figure_revisions), 0) = 0
      THEN 'bereit' ELSE 'hinweis' END,
    CASE WHEN COALESCE((SELECT count(*) FROM public.facility_day_figures), 0) = 0
      AND COALESCE((SELECT count(*) FROM public.facility_day_figure_revisions), 0) = 0
      THEN 'Beide Kennzahlentabellen sind leer.'
      ELSE 'Es gibt bereits Kennzahlenzeilen. Das ist nach späteren Tests möglich, die Migration selbst legt keine an.' END
) AS kontrolle
ORDER BY sortierung;
