-- Tageswerk 3.6.3, lesende Vorprüfung vor TEST-Ausführung der vier Migrationen.
-- Nur pg_catalog / information_schema. Keine Tabelleninhalte, kein Schreibzugriff.
-- Ziel: Testprojekt. Nicht auf PROD ausführen, um nichts zu verändern; die Abfrage ist dennoch nur lesend.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS ord, 'material_movements vorhanden'::text AS pruefung,
    CASE WHEN to_regclass('public.material_movements') IS NOT NULL THEN 'ok' ELSE 'fehler' END AS status,
    CASE WHEN to_regclass('public.material_movements') IS NULL
      THEN 'tageswerk_3_1_materials.sql fehlt. material_movements_insert darf nicht ausgeführt werden.'
      ELSE 'Tabelle material_movements ist vorhanden.'
    END AS details

  UNION ALL
  SELECT 20, 'Policy material_movements_insert',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'material_movements' AND policyname = 'material_movements_insert'
    ) THEN 'ok' ELSE 'offen' END,
    coalesce((
      SELECT substring(qual || ' ' || coalesce(with_check, '') FROM 1 FOR 240)
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'material_movements' AND policyname = 'material_movements_insert'
    ), 'Policy fehlt.')

  UNION ALL
  SELECT 30, 'tageswerk_meter_role',
    CASE WHEN to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    CASE WHEN to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL
      THEN 'Rollenfunktion für Material und Dashboard-Import vorhanden.'
      ELSE 'tageswerk_meter_role fehlt.'
    END

  UNION ALL
  SELECT 40, 'staff_invitations',
    CASE WHEN to_regclass('public.staff_invitations') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    CASE WHEN to_regclass('public.staff_invitations') IS NULL THEN 'Einladungstabelle fehlt.' ELSE 'Tabelle vorhanden.' END

  UNION ALL
  SELECT 50, 'staff_invitations.error_detail',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_invitations' AND column_name = 'error_detail'
    ) THEN 'ok' ELSE 'fehler' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_invitations' AND column_name = 'error_detail'
    ) THEN 'Spalte error_detail vorhanden.'
      ELSE 'retry_staff_invitation würde an fehlendem error_detail scheitern.'
    END

  UNION ALL
  SELECT 60, 'staff_invitations.updated_at',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_invitations' AND column_name = 'updated_at'
    ) THEN 'ok' ELSE 'fehler' END,
    'Retry schreibt updated_at.'

  UNION ALL
  SELECT 70, 'private.can_manage_facility',
    CASE WHEN to_regprocedure('private.can_manage_facility(uuid)') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    CASE WHEN to_regprocedure('private.can_manage_facility(uuid)') IS NOT NULL
      THEN 'Verwaltungsprüfung vorhanden.'
      ELSE 'Retry darf nicht installiert werden.'
    END

  UNION ALL
  SELECT 80, 'revoke_staff_invitation',
    CASE WHEN to_regprocedure('public.revoke_staff_invitation(uuid)') IS NOT NULL THEN 'ok' ELSE 'hinweis' END,
    'Widerruf bleibt die bestehende Funktion. Retry setzt failed/revoked auf pending.'

  UNION ALL
  SELECT 90, 'retry_staff_invitation noch frei',
    CASE WHEN to_regprocedure('public.retry_staff_invitation(uuid)') IS NULL THEN 'ok' ELSE 'hinweis' END,
    CASE WHEN to_regprocedure('public.retry_staff_invitation(uuid)') IS NULL
      THEN 'CREATE OR REPLACE würde neu anlegen.'
      ELSE 'Funktion existiert bereits. Erneute Ausführung ersetzt nur diese Signatur.'
    END

  UNION ALL
  SELECT 100, 'user_dashboard_layouts',
    CASE WHEN to_regclass('public.user_dashboard_layouts') IS NULL THEN 'ok' ELSE 'hinweis' END,
    CASE WHEN to_regclass('public.user_dashboard_layouts') IS NULL
      THEN 'Tabelle fehlt. CREATE IF NOT EXISTS ist vorgesehen.'
      ELSE 'Tabelle existiert. Migration ist wiederholbar und ändert keine Betriebsdaten.'
    END

  UNION ALL
  SELECT 110, 'facility_day_figures',
    CASE WHEN to_regclass('public.facility_day_figures') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    CASE WHEN to_regclass('public.facility_day_figures') IS NULL
      THEN 'Kennzahlentabelle fehlt. Importprotokoll ohne 3.5.4 nicht sinnvoll.'
      ELSE 'Tageskennzahlen vorhanden.'
    END

  UNION ALL
  SELECT 120, 'tageswerk_save_day_figures',
    CASE WHEN to_regprocedure('public.tageswerk_save_day_figures(uuid,date,integer,bigint,bigint,bigint,text,text)') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    CASE WHEN to_regprocedure('public.tageswerk_save_day_figures(uuid,date,integer,bigint,bigint,bigint,text,text)') IS NOT NULL
      THEN 'Speicherfunktion vorhanden. Der Sammelimport ruft sie in einer Transaktion auf.'
      ELSE 'Ohne save_day_figures darf day_figure_import nicht ausgeführt werden.'
    END

  UNION ALL
  SELECT 130, 'facility_day_figure_imports',
    CASE WHEN to_regclass('public.facility_day_figure_imports') IS NULL THEN 'ok' ELSE 'hinweis' END,
    CASE WHEN to_regclass('public.facility_day_figure_imports') IS NULL
      THEN 'Protokolltabelle fehlt und würde angelegt.'
      ELSE 'Protokolltabelle existiert bereits.'
    END

  UNION ALL
  SELECT 140, 'auth.users für Layout-FK',
    CASE WHEN to_regclass('auth.users') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    'user_dashboard_layouts verweist auf auth.users.'
) AS pruefungen
ORDER BY ord;
