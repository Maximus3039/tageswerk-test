-- Lesende Kontrolle nach tageswerk_3_5_1_defect_archive.sql.
-- Diese Abfrage schreibt nichts, ändert keinen Mangel und ruft keine Archivfunktion auf.
-- Sie darf erst nach der freigegebenen Installation im SQL-Editor laufen.
-- Jede Zeile muss status = bereit zeigen. Eine Zeile stoppen heißt: nicht veröffentlichen.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Archivspalten ohne Vorgabewert' AS pruefung,
    CASE
      WHEN (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'defects'
          AND column_default IS NULL
          AND is_nullable = 'YES'
          AND (
            (column_name = 'archived_at' AND data_type = 'timestamp with time zone')
            OR (column_name = 'archived_by' AND data_type = 'uuid')
            OR (column_name = 'resolved_at' AND data_type = 'timestamp with time zone')
          )
      ) = 3
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'defects_archive_pair_check'
          AND conrelid = 'public.defects'::regclass
      )
      THEN 'bereit' ELSE 'stoppen'
    END AS status,
    'archived_at, archived_by und resolved_at sind leerbar und ohne Vorgabewert. Eine Archivierung braucht beide Angaben und den Status abgeschlossen.' AS details
  UNION ALL
  SELECT 20, 'RLS der Mängel bleibt wirksam',
    CASE
      WHEN defects.relrowsecurity IS TRUE
       AND events.relrowsecurity IS TRUE
       AND (SELECT count(*) FROM pg_policy WHERE polrelid = defects.oid) >= 1
       AND (SELECT count(*) FROM pg_policy WHERE polrelid = events.oid) >= 1
      THEN 'bereit' ELSE 'stoppen'
    END,
    'defects und defect_events behalten RLS und mindestens eine Richtlinie. Die Archivierung ersetzt diese Richtlinien nicht.'
  FROM pg_class AS defects
  JOIN pg_class AS events ON events.oid = 'public.defect_events'::regclass
  WHERE defects.oid = 'public.defects'::regclass
  UNION ALL
  SELECT 30, 'Archivierte Zeilen sind geschützt',
    CASE
      WHEN guard.oid IS NOT NULL
       AND guard.tgtype & 1 = 1
       AND guard.tgtype & 2 = 2
       AND guard.tgtype & 4 = 0
       AND guard.tgtype & 8 = 8
       AND guard.tgtype & 16 = 16
       AND guard.tgfoid = guard_fn.oid
       AND position('Archivierte Mängel können nicht verändert werden.' IN pg_get_functiondef(guard_fn.oid)) > 0
       AND position('Archivierte Mängel können nicht gelöscht werden.' IN pg_get_functiondef(guard_fn.oid)) > 0
       AND position('Archivierung ist nur über die vorgesehene Funktion möglich.' IN pg_get_functiondef(guard_fn.oid)) > 0
       AND position('Die Wiederherstellung verändert keine gespeicherten Angaben.' IN pg_get_functiondef(guard_fn.oid)) > 0
       AND NOT has_column_privilege('authenticated', 'public.defects', 'archived_at', 'UPDATE')
       AND NOT has_column_privilege('authenticated', 'public.defects', 'archived_by', 'UPDATE')
       AND has_column_privilege('authenticated', 'public.defects', 'archived_at', 'SELECT')
       AND has_column_privilege('authenticated', 'public.defects', 'status', 'UPDATE')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Ein Trigger vor Änderung und Löschung sperrt archivierte Mängel. Die Archivspalten sind für die Anmeldung nicht direkt schreibbar, der Status bleibt es.'
  FROM (SELECT to_regprocedure('public.tageswerk_defect_archive_guard()') AS oid) AS guard_lookup
  LEFT JOIN pg_proc AS guard_fn ON guard_fn.oid = guard_lookup.oid
  LEFT JOIN pg_trigger AS guard ON guard.tgrelid = 'public.defects'::regclass
    AND guard.tgname = 'aa_defects_archive_guard'
    AND NOT guard.tgisinternal
  UNION ALL
  SELECT 40, 'Archivfunktionen prüfen den Betrieb',
    CASE
      WHEN archive_one.prosecdef IS TRUE
       AND archive_many.prosecdef IS TRUE
       AND restore_one.prosecdef IS TRUE
       AND allowed.prosecdef IS TRUE
       AND pg_get_function_result(archive_many.oid) = 'integer'
       AND EXISTS (SELECT 1 FROM unnest(COALESCE(archive_one.proconfig, ARRAY[]::text[])) AS cfg WHERE cfg IN ('search_path=', 'search_path=""'))
       AND EXISTS (SELECT 1 FROM unnest(COALESCE(archive_many.proconfig, ARRAY[]::text[])) AS cfg WHERE cfg IN ('search_path=', 'search_path=""'))
       AND EXISTS (SELECT 1 FROM unnest(COALESCE(restore_one.proconfig, ARRAY[]::text[])) AS cfg WHERE cfg IN ('search_path=', 'search_path=""'))
       AND position('company_admin' IN pg_get_functiondef(allowed.oid)) > 0
       AND position('facility_id IS NULL' IN pg_get_functiondef(allowed.oid)) > 0
       AND position('facility_manager' IN pg_get_functiondef(allowed.oid)) > 0
       AND position('defect.facility_id = p_facility_id' IN pg_get_functiondef(archive_many.oid)) > 0
       AND position('defect.organization_id = facility_org' IN pg_get_functiondef(archive_many.oid)) > 0
       AND position('Aus Archiv zurückgeholt' IN pg_get_functiondef(restore_one.oid)) > 0
       AND position('Gesehen und archiviert' IN pg_get_functiondef(archive_one.oid)) > 0
       AND position('water_checks' IN pg_get_functiondef(restore_one.oid)) = 0
       AND position('SET status' IN pg_get_functiondef(restore_one.oid)) = 0
       AND position('SET title' IN pg_get_functiondef(restore_one.oid)) = 0
       AND position('SET description' IN pg_get_functiondef(restore_one.oid)) = 0
       AND position('SET change_note' IN pg_get_functiondef(restore_one.oid)) = 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Einzelarchivierung, Sammelarchivierung und Wiederherstellung laufen als definierte Funktionen mit leerem Suchpfad. Die Sammelarchivierung bleibt auf den übergebenen Betrieb begrenzt.'
  FROM (SELECT to_regprocedure('public.tageswerk_archive_defect(uuid)') AS oid) AS one_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_archive_closed_defects(uuid)') AS oid) AS many_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_restore_archived_defect(uuid)') AS oid) AS restore_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_defect_archive_allowed(uuid,uuid)') AS oid) AS allowed_lookup
  LEFT JOIN pg_proc AS archive_one ON archive_one.oid = one_lookup.oid
  LEFT JOIN pg_proc AS archive_many ON archive_many.oid = many_lookup.oid
  LEFT JOIN pg_proc AS restore_one ON restore_one.oid = restore_lookup.oid
  LEFT JOIN pg_proc AS allowed ON allowed.oid = allowed_lookup.oid
  UNION ALL
  SELECT 50, 'Ausführung nur für angemeldete Leitungen',
    CASE
      WHEN has_function_privilege('authenticated', 'public.tageswerk_archive_defect(uuid)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.tageswerk_archive_closed_defects(uuid)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.tageswerk_restore_archived_defect(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.tageswerk_archive_defect(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.tageswerk_archive_closed_defects(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.tageswerk_restore_archived_defect(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.tageswerk_defect_archive_guard()', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.tageswerk_defect_archive_allowed(uuid,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.tageswerk_defect_archive_guard()', 'EXECUTE')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Die drei Archivfunktionen sind für angemeldete Benutzer aufrufbar. Die interne Prüfung und der Schutztrigger sind es nicht. Anonyme Aufrufe sind gesperrt.'
  UNION ALL
  SELECT 60, 'Bestehende Bearbeitung bleibt unverändert',
    CASE
      WHEN employee.oid IS NOT NULL
       AND position('archived_at' IN pg_get_functiondef(employee.oid)) = 0
       AND position('archived_by' IN pg_get_functiondef(employee.oid)) = 0
       AND position('tageswerk_archive_defect' IN pg_get_functiondef(employee.oid)) = 0
       AND position('UPDATE public.defects SET status=p_status, change_note=' IN pg_get_functiondef(employee.oid)) > 0
       AND position('Vorgang ist bereits abgeschlossen oder wartet auf Freigabe' IN pg_get_functiondef(employee.oid)) > 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'employee_update_assigned_defect schreibt weiterhin nur Status und Arbeitsvermerk und kennt das Archiv nicht.'
  FROM (SELECT to_regprocedure('public.employee_update_assigned_defect(uuid,text,text)') AS oid) AS employee_lookup
  LEFT JOIN pg_proc AS employee ON employee.oid = employee_lookup.oid
) AS checks
ORDER BY sortierung;
