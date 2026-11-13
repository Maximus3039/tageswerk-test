-- Lesende Kontrolle nach tageswerk_3_4_2_water_round_close.sql.
-- Diese Abfrage schreibt nichts, ändert keine Kontrollrunde und ruft den Abschluss nicht auf.
-- Sie darf erst nach der freigegebenen Installation im SQL-Editor laufen.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Beide Funktionen und Signaturen' AS pruefung,
    CASE
      WHEN to_regprocedure('public.tageswerk_own_water_round_stored(uuid,jsonb)') IS NOT NULL
       AND to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') IS NOT NULL
       AND to_regprocedure('public.tageswerk_own_water_round_stored(uuid,uuid[])') IS NULL
      THEN 'bereit' ELSE 'stoppen'
    END AS status,
    'Hilfsfunktion (uuid, jsonb) und Abschlussfunktion (uuid, jsonb) müssen vorhanden sein. Die Fassung (uuid, uuid[]) darf nicht bestehen.' AS details
  UNION ALL
  SELECT 20, 'Rückgabetypen',
    CASE
      WHEN helper.oid IS NOT NULL
       AND recorder.oid IS NOT NULL
       AND pg_get_function_result(helper.oid) = 'boolean'
       AND pg_get_function_result(recorder.oid) = 'jsonb'
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Die Hilfsfunktion liefert boolean. Die Abschlussfunktion liefert jsonb.'
  FROM (SELECT to_regprocedure('public.tageswerk_own_water_round_stored(uuid,jsonb)') AS oid) AS helper_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') AS oid) AS recorder_lookup
  LEFT JOIN pg_proc AS helper ON helper.oid = helper_lookup.oid
  LEFT JOIN pg_proc AS recorder ON recorder.oid = recorder_lookup.oid
  UNION ALL
  SELECT 30, 'SECURITY DEFINER nur bei der Hilfsfunktion',
    CASE
      WHEN helper.oid IS NOT NULL
       AND recorder.oid IS NOT NULL
       AND helper.prosecdef IS TRUE
       AND recorder.prosecdef IS FALSE
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Die Abschlussfunktion bleibt ein Aufrufer. Nur die Hilfsfunktion ist SECURITY DEFINER.'
  FROM (SELECT to_regprocedure('public.tageswerk_own_water_round_stored(uuid,jsonb)') AS oid) AS helper_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') AS oid) AS recorder_lookup
  LEFT JOIN pg_proc AS helper ON helper.oid = helper_lookup.oid
  LEFT JOIN pg_proc AS recorder ON recorder.oid = recorder_lookup.oid
  UNION ALL
  SELECT 40, 'Suchpfad ist leer',
    CASE
      WHEN helper.oid IS NOT NULL
       AND recorder.oid IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM unnest(COALESCE(helper.proconfig, ARRAY[]::text[])) AS cfg
         WHERE cfg IN ('search_path=', 'search_path=""')
       )
       AND EXISTS (
         SELECT 1 FROM unnest(COALESCE(recorder.proconfig, ARRAY[]::text[])) AS cfg
         WHERE cfg IN ('search_path=', 'search_path=""')
       )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Beide Funktionen haben search_path leer.'
  FROM (SELECT to_regprocedure('public.tageswerk_own_water_round_stored(uuid,jsonb)') AS oid) AS helper_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') AS oid) AS recorder_lookup
  LEFT JOIN pg_proc AS helper ON helper.oid = helper_lookup.oid
  LEFT JOIN pg_proc AS recorder ON recorder.oid = recorder_lookup.oid
  UNION ALL
  SELECT 50, 'Eigentümer der Hilfsfunktion',
    CASE
      WHEN helper.oid IS NOT NULL
       AND checks.oid IS NOT NULL
       AND proof.oid IS NOT NULL
       AND helper.proowner = checks.relowner
       AND helper.proowner = proof.proowner
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Der Eigentümer entspricht der Messtabelle und der bestehenden Beweisfunktion.'
  FROM (SELECT to_regprocedure('public.tageswerk_own_water_round_stored(uuid,jsonb)') AS oid) AS helper_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_water_round_checks_in_transaction(uuid,uuid)') AS oid) AS proof_lookup
  LEFT JOIN pg_proc AS helper ON helper.oid = helper_lookup.oid
  LEFT JOIN pg_proc AS proof ON proof.oid = proof_lookup.oid
  LEFT JOIN pg_class AS checks
    ON checks.oid = to_regclass('public.water_checks')
  UNION ALL
  SELECT 35, 'Geschützter Statuswechsel',
    CASE
      WHEN finisher.oid IS NOT NULL
       AND finisher.prosecdef IS TRUE
       AND pg_get_function_result(finisher.oid) = 'integer'
       AND EXISTS (
         SELECT 1 FROM unnest(COALESCE(finisher.proconfig, ARRAY[]::text[])) AS cfg
         WHERE cfg IN ('search_path=', 'search_path=""')
       )
       AND proof.oid IS NOT NULL
       AND finisher.proowner = proof.proowner
       AND position('draft.user_id = auth.uid()' IN pg_get_functiondef(finisher.oid)) > 0
       AND position('draft.status = ''open''' IN pg_get_functiondef(finisher.oid)) > 0
       AND position('public.tageswerk_meter_role' IN pg_get_functiondef(finisher.oid)) > 0
       AND position('tageswerk_water_round_checks_in_transaction(p_round_id, p_facility_id) IS NOT TRUE' IN pg_get_functiondef(finisher.oid)) > 0
       AND position('SET status = ''completed''' IN pg_get_functiondef(finisher.oid)) > 0
       AND position('AND status = ''open''' IN pg_get_functiondef(finisher.oid)) > 0
       AND position('GET DIAGNOSTICS closed_drafts = ROW_COUNT' IN pg_get_functiondef(finisher.oid))
           > position('UPDATE public.water_round_drafts' IN pg_get_functiondef(finisher.oid))
       AND position('EXCEPTION WHEN' IN pg_get_functiondef(finisher.oid)) = 0
       AND position('DELETE' IN pg_get_functiondef(finisher.oid)) = 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Nur der eigene offene Entwurf wird abgeschlossen, und nur bei wahrem Transaktionsbeweis.'
  FROM (SELECT to_regprocedure('public.tageswerk_finish_own_water_round_draft(uuid,uuid)') AS oid) AS finisher_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_water_round_checks_in_transaction(uuid,uuid)') AS oid) AS proof_lookup
  LEFT JOIN pg_proc AS finisher ON finisher.oid = finisher_lookup.oid
  LEFT JOIN pg_proc AS proof ON proof.oid = proof_lookup.oid
  UNION ALL
  SELECT 45, 'Abschluss nimmt genau einen Entwurf',
    CASE
      WHEN recorder.oid IS NOT NULL
       AND finisher.oid IS NOT NULL
       AND position('tageswerk_finish_own_water_round_draft(p_round_id, facility)' IN pg_get_functiondef(recorder.oid)) > 0
       AND position('closed_drafts IS DISTINCT FROM 1' IN pg_get_functiondef(recorder.oid)) > 0
       AND position('UPDATE public.water_round_drafts' IN pg_get_functiondef(recorder.oid)) = 0
       AND position('EXCEPTION WHEN' IN pg_get_functiondef(recorder.oid)) = 0
       AND recorder.prosecdef IS FALSE
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Die Abschlussfunktion bleibt Aufrufer. Kein oder mehrere Entwürfe nehmen die Messungen zurück.'
  FROM (SELECT to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') AS oid) AS recorder_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_finish_own_water_round_draft(uuid,uuid)') AS oid) AS finisher_lookup
  LEFT JOIN pg_proc AS recorder ON recorder.oid = recorder_lookup.oid
  LEFT JOIN pg_proc AS finisher ON finisher.oid = finisher_lookup.oid
  UNION ALL
  SELECT 60, 'Hilfsfunktion legt keine fremden Werte offen',
    CASE
      WHEN helper.oid IS NOT NULL
       AND pg_get_function_result(helper.oid) = 'boolean'
       AND position('recorded_by = auth.uid()' IN pg_get_functiondef(helper.oid)) > 0
       AND position('draft.user_id = auth.uid()' IN pg_get_functiondef(helper.oid)) > 0
       AND position('draft.status = ''completed''' IN pg_get_functiondef(helper.oid)) > 0
       AND position('public.tageswerk_meter_role' IN pg_get_functiondef(helper.oid)) > 0
       AND position('recorded_by IS DISTINCT FROM auth.uid()' IN pg_get_functiondef(helper.oid)) > 0
       AND position('::numeric' IN pg_get_functiondef(helper.oid)) > 0
       AND position('coalesce(item->>''note'', '''') IS DISTINCT FROM check_row.note' IN pg_get_functiondef(helper.oid)) > 0
       AND position('tageswerk_own_water_round_stored(p_round_id, p_checks)' IN pg_get_functiondef(recorder.oid)) > 0
       AND position('EXCEPTION WHEN' IN pg_get_functiondef(helper.oid)) = 0
       AND position('INSERT' IN pg_get_functiondef(helper.oid)) = 0
       AND position('UPDATE' IN pg_get_functiondef(helper.oid)) = 0
       AND position('DELETE' IN pg_get_functiondef(helper.oid)) = 0
       AND position('min(' IN pg_get_functiondef(helper.oid)) = 0
       AND position('max(' IN pg_get_functiondef(helper.oid)) = 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'already_stored verlangt die aktive Rolle, identische Messwerte und dieselbe Notiz.'
  FROM (SELECT to_regprocedure('public.tageswerk_own_water_round_stored(uuid,jsonb)') AS oid) AS helper_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') AS oid) AS recorder_lookup
  LEFT JOIN pg_proc AS helper ON helper.oid = helper_lookup.oid
  LEFT JOIN pg_proc AS recorder ON recorder.oid = recorder_lookup.oid
  UNION ALL
  SELECT 70, 'Ausführungsrechte',
    CASE
      WHEN helper.oid IS NOT NULL
       AND recorder.oid IS NOT NULL
       AND finisher.oid IS NOT NULL
       AND has_function_privilege('authenticated', helper.oid, 'EXECUTE')
       AND has_function_privilege('authenticated', recorder.oid, 'EXECUTE')
       AND has_function_privilege('authenticated', finisher.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', helper.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', recorder.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', finisher.oid, 'EXECUTE')
       AND NOT has_function_privilege('public', helper.oid, 'EXECUTE')
       AND NOT has_function_privilege('public', recorder.oid, 'EXECUTE')
       AND NOT has_function_privilege('public', finisher.oid, 'EXECUTE')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'authenticated darf ausführen. anon und public dürfen es nicht.'
  FROM (SELECT to_regprocedure('public.tageswerk_own_water_round_stored(uuid,jsonb)') AS oid) AS helper_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') AS oid) AS recorder_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_finish_own_water_round_draft(uuid,uuid)') AS oid) AS finisher_lookup
  LEFT JOIN pg_proc AS helper ON helper.oid = helper_lookup.oid
  LEFT JOIN pg_proc AS recorder ON recorder.oid = recorder_lookup.oid
  LEFT JOIN pg_proc AS finisher ON finisher.oid = finisher_lookup.oid
  UNION ALL
  SELECT 80, 'Schutztrigger der Messungen',
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger
        JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'water_checks'
          AND trigger.tgname = 'water_checks_protect'
          AND trigger.tgisinternal IS FALSE
          AND procedure.proname = 'tageswerk_protect_water_check'
          AND pg_get_triggerdef(trigger.oid) LIKE '%BEFORE UPDATE OR DELETE%'
          AND position('Gespeicherte Hygienemessungen bleiben unverändert.' IN pg_get_functiondef(procedure.oid)) > 0
      )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'water_checks_protect sperrt Änderung und Löschung gespeicherter Messungen.'
  UNION ALL
  SELECT 90, 'Entwurfsrichtlinie bleibt eng',
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_policy AS policy
        WHERE policy.polrelid = to_regclass('public.water_round_drafts')
          AND policy.polname = 'water_round_drafts_update'
          AND policy.polcmd = 'w'
          AND pg_get_expr(policy.polqual, policy.polrelid) LIKE '%user_id = auth.uid()%'
          AND pg_get_expr(policy.polqual, policy.polrelid) LIKE '%status = ''open''%'
          AND pg_get_expr(policy.polwithcheck, policy.polrelid) LIKE '%tageswerk_water_round_checks_in_transaction(round_id, facility_id)%'
      )
       AND EXISTS (
        SELECT 1
        FROM pg_policy AS policy
        WHERE policy.polrelid = to_regclass('public.water_round_drafts')
          AND policy.polname = 'water_round_drafts_select'
          AND pg_get_expr(policy.polqual, policy.polrelid) LIKE '%user_id = auth.uid()%'
          AND pg_get_expr(policy.polqual, policy.polrelid) LIKE '%status = ''open''%'
      )
       AND NOT EXISTS (
        SELECT 1
        FROM pg_policy AS policy
        WHERE policy.polrelid = to_regclass('public.water_round_drafts')
          AND policy.polcmd = 'd'
      )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Direktes Aktualisieren verlangt weiter den Beweis. Abgeschlossene und fremde Entwürfe bleiben unsichtbar. Es gibt keine Löschrichtlinie.'
  UNION ALL
  SELECT 100, 'Schutztrigger des Entwurfs',
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger
        JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'water_round_drafts'
          AND trigger.tgname = 'water_round_drafts_guard'
          AND trigger.tgisinternal IS FALSE
          AND procedure.proname = 'tageswerk_guard_water_round_draft'
          AND pg_get_triggerdef(trigger.oid) LIKE '%BEFORE UPDATE%'
          AND position('tageswerk_water_round_checks_in_transaction' IN pg_get_functiondef(procedure.oid)) > 0
          AND position('Ein abgeschlossener oder verworfener Entwurf kann nicht mehr bearbeitet werden.' IN pg_get_functiondef(procedure.oid)) > 0
      )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Der bestehende BEFORE-UPDATE-Trigger prüft den Abschluss weiterhin vor der Richtlinie.'
) AS kontrollen
ORDER BY sortierung;
