-- Lesende Kontrolle nach tageswerk_3_4_2_water_round_schedule.sql.
-- Diese Abfrage schreibt nichts, ändert keine Kontrollrunde und ruft keine Speicherfunktion auf.
-- Sie darf erst nach der freigegebenen Installation im SQL-Editor laufen.
-- Jede Zeile muss status = bereit zeigen. Eine Zeile stoppen heißt: nicht veröffentlichen.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Beide neuen Tabellen' AS pruefung,
    CASE
      WHEN to_regclass('public.water_facility_slots') IS NOT NULL
       AND to_regclass('public.water_round_slots') IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'water_facility_slots_time'
           AND conrelid = to_regclass('public.water_facility_slots')
       )
       AND EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'water_facility_slots_period'
           AND conrelid = to_regclass('public.water_facility_slots')
       )
       AND EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'water_round_slots_kind'
           AND conrelid = to_regclass('public.water_round_slots')
       )
      THEN 'bereit' ELSE 'stoppen'
    END AS status,
    'water_facility_slots und water_round_slots sind vorhanden. Uhrzeit, Gültigkeit und Art der Zuordnung sind eingeschränkt.' AS details
  UNION ALL
  SELECT 20, 'RLS ist aktiv und erzwungen',
    CASE
      WHEN slots.oid IS NOT NULL
       AND rounds.oid IS NOT NULL
       AND slots.relrowsecurity IS TRUE
       AND slots.relforcerowsecurity IS TRUE
       AND rounds.relrowsecurity IS TRUE
       AND rounds.relforcerowsecurity IS TRUE
       AND (
         SELECT count(*) FROM pg_policy WHERE polrelid = slots.oid
       ) = 3
       AND (
         SELECT count(*) FROM pg_policy WHERE polrelid = rounds.oid
       ) = 2
       AND NOT EXISTS (
         SELECT 1 FROM pg_policy
         WHERE polrelid IN (slots.oid, rounds.oid)
           AND polcmd IN ('d', '*')
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_policy
         WHERE polrelid = rounds.oid
           AND polcmd = 'w'
       )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Beide Tabellen haben RLS und FORCE RLS. Es gibt keine Löschrichtlinie und keine Aktualisierung der Zuordnung.'
  FROM (SELECT to_regclass('public.water_facility_slots') AS oid) AS slot_lookup
  CROSS JOIN (SELECT to_regclass('public.water_round_slots') AS oid) AS round_lookup
  LEFT JOIN pg_class AS slots ON slots.oid = slot_lookup.oid
  LEFT JOIN pg_class AS rounds ON rounds.oid = round_lookup.oid
  UNION ALL
  SELECT 30, 'Neue Funktionen',
    CASE
      WHEN to_regprocedure('public.tageswerk_lock_water_facility_plan(uuid)') IS NOT NULL
       AND to_regprocedure('public.tageswerk_water_round_covers_active_pools(uuid,uuid)') IS NOT NULL
       AND to_regprocedure('public.tageswerk_guard_water_facility_slot()') IS NOT NULL
       AND to_regprocedure('public.tageswerk_stamp_water_round_slot()') IS NOT NULL
       AND to_regprocedure('public.tageswerk_claim_water_round_slot(uuid,uuid,uuid)') IS NOT NULL
       AND to_regprocedure('public.tageswerk_record_scheduled_water_round(uuid,jsonb,uuid)') IS NOT NULL
       AND to_regprocedure('public.tageswerk_save_water_facility_slots(uuid,text[])') IS NOT NULL
       AND lock_plan.prosecdef IS FALSE
       AND covers.prosecdef IS TRUE
       AND guard_slot.prosecdef IS FALSE
       AND stamp_slot.prosecdef IS FALSE
       AND claim_slot.prosecdef IS TRUE
       AND scheduled.prosecdef IS FALSE
       AND save_plan.prosecdef IS FALSE
       AND pg_get_function_result(covers.oid) = 'boolean'
       AND pg_get_function_result(scheduled.oid) = 'jsonb'
       AND pg_get_function_result(claim_slot.oid) = 'text'
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Sperre, Vollständigkeit, Terminschutz, Zuordnungsstempel, Terminclaim, geplanter Abschluss und Kontrollzeiten sind vorhanden. Nur Vollständigkeit und Terminclaim sind SECURITY DEFINER.'
  FROM (SELECT to_regprocedure('public.tageswerk_lock_water_facility_plan(uuid)') AS oid) AS lock_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_water_round_covers_active_pools(uuid,uuid)') AS oid) AS covers_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_guard_water_facility_slot()') AS oid) AS guard_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_stamp_water_round_slot()') AS oid) AS stamp_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_claim_water_round_slot(uuid,uuid,uuid)') AS oid) AS claim_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_record_scheduled_water_round(uuid,jsonb,uuid)') AS oid) AS scheduled_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_save_water_facility_slots(uuid,text[])') AS oid) AS save_lookup
  LEFT JOIN pg_proc AS lock_plan ON lock_plan.oid = lock_lookup.oid
  LEFT JOIN pg_proc AS covers ON covers.oid = covers_lookup.oid
  LEFT JOIN pg_proc AS guard_slot ON guard_slot.oid = guard_lookup.oid
  LEFT JOIN pg_proc AS stamp_slot ON stamp_slot.oid = stamp_lookup.oid
  LEFT JOIN pg_proc AS claim_slot ON claim_slot.oid = claim_lookup.oid
  LEFT JOIN pg_proc AS scheduled ON scheduled.oid = scheduled_lookup.oid
  LEFT JOIN pg_proc AS save_plan ON save_plan.oid = save_lookup.oid
  UNION ALL
  SELECT 40, 'Berechtigungen der vier Rollen',
    CASE
      WHEN role_fn.oid IS NOT NULL
       AND position('employee' IN pg_get_functiondef(role_fn.oid)) > 0
       AND position('technician' IN pg_get_functiondef(role_fn.oid)) > 0
       AND position('facility_manager' IN pg_get_functiondef(role_fn.oid)) > 0
       AND position('company_admin' IN pg_get_functiondef(role_fn.oid)) > 0
       AND slot_select.oid IS NOT NULL
       AND slot_insert.oid IS NOT NULL
       AND slot_update.oid IS NOT NULL
       AND round_select.oid IS NOT NULL
       AND round_insert.oid IS NOT NULL
       AND pg_get_expr(slot_select.polqual, slot_select.polrelid) LIKE '%tageswerk_meter_role(organization_id, facility_id) IS NOT NULL%'
       AND pg_get_expr(round_select.polqual, round_select.polrelid) LIKE '%tageswerk_meter_role(organization_id, facility_id) IS NOT NULL%'
       AND pg_get_expr(slot_insert.polwithcheck, slot_insert.polrelid) LIKE '%facility_manager%'
       AND pg_get_expr(slot_insert.polwithcheck, slot_insert.polrelid) LIKE '%company_admin%'
       AND pg_get_expr(slot_insert.polwithcheck, slot_insert.polrelid) NOT LIKE '%employee%'
       AND pg_get_expr(slot_insert.polwithcheck, slot_insert.polrelid) NOT LIKE '%technician%'
       AND pg_get_expr(slot_update.polqual, slot_update.polrelid) LIKE '%facility_manager%'
       AND pg_get_expr(slot_update.polqual, slot_update.polrelid) LIKE '%company_admin%'
       AND pg_get_expr(slot_update.polwithcheck, slot_update.polrelid) LIKE '%facility_manager%'
       AND pg_get_expr(slot_update.polwithcheck, slot_update.polrelid) LIKE '%company_admin%'
       AND pg_get_expr(round_insert.polwithcheck, round_insert.polrelid) LIKE '%tageswerk_meter_role(organization_id, facility_id) IS NOT NULL%'
       AND pg_get_expr(round_insert.polwithcheck, round_insert.polrelid) LIKE '%user_id = auth.uid()%'
       AND pg_get_expr(round_insert.polwithcheck, round_insert.polrelid) LIKE '%tageswerk_water_round_checks_in_transaction(round_id, facility_id)%'
       AND save_plan.oid IS NOT NULL
       AND position('NOT IN (''facility_manager'', ''company_admin'')' IN pg_get_functiondef(save_plan.oid)) > 0
       AND COALESCE((SELECT has_table_privilege('authenticated', relation.oid, 'SELECT') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_facility_slots')), false)
       AND COALESCE((SELECT has_table_privilege('authenticated', relation.oid, 'INSERT') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_facility_slots')), false)
       AND COALESCE((SELECT has_table_privilege('authenticated', relation.oid, 'UPDATE') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_facility_slots')), false)
       AND NOT COALESCE((SELECT has_table_privilege('authenticated', relation.oid, 'DELETE') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_facility_slots')), true)
       AND COALESCE((SELECT has_table_privilege('authenticated', relation.oid, 'SELECT') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_round_slots')), false)
       AND COALESCE((SELECT has_table_privilege('authenticated', relation.oid, 'INSERT') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_round_slots')), false)
       AND NOT COALESCE((SELECT has_table_privilege('authenticated', relation.oid, 'UPDATE') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_round_slots')), true)
       AND NOT COALESCE((SELECT has_table_privilege('authenticated', relation.oid, 'DELETE') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_round_slots')), true)
       AND NOT COALESCE((SELECT has_table_privilege('anon', relation.oid, 'SELECT') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_facility_slots')), true)
       AND NOT COALESCE((SELECT has_table_privilege('anon', relation.oid, 'SELECT') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_round_slots')), true)
       AND NOT COALESCE((SELECT has_table_privilege('public', relation.oid, 'SELECT') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_facility_slots')), true)
       AND NOT COALESCE((SELECT has_table_privilege('public', relation.oid, 'SELECT') FROM pg_class AS relation WHERE relation.oid = to_regclass('public.water_round_slots')), true)
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Mitarbeiter, Techniker, Betriebsleitung und Geschäftsführung lesen über tageswerk_meter_role. Kontrollzeiten schreiben nur Betriebsleitung und Geschäftsführung. Zuordnungen schreibt jede dieser Rollen nur für die eigene Runde mit Messbeweis. anon und public haben keinen Zugriff.'
  FROM (SELECT to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') AS oid) AS role_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_save_water_facility_slots(uuid,text[])') AS oid) AS save_lookup
  LEFT JOIN pg_proc AS role_fn ON role_fn.oid = role_lookup.oid
  LEFT JOIN pg_proc AS save_plan ON save_plan.oid = save_lookup.oid
  LEFT JOIN pg_policy AS slot_select
    ON slot_select.polrelid = to_regclass('public.water_facility_slots')
   AND slot_select.polname = 'water_facility_slots_select'
   AND slot_select.polcmd = 'r'
  LEFT JOIN pg_policy AS slot_insert
    ON slot_insert.polrelid = to_regclass('public.water_facility_slots')
   AND slot_insert.polname = 'water_facility_slots_insert'
   AND slot_insert.polcmd = 'a'
  LEFT JOIN pg_policy AS slot_update
    ON slot_update.polrelid = to_regclass('public.water_facility_slots')
   AND slot_update.polname = 'water_facility_slots_update'
   AND slot_update.polcmd = 'w'
  LEFT JOIN pg_policy AS round_select
    ON round_select.polrelid = to_regclass('public.water_round_slots')
   AND round_select.polname = 'water_round_slots_select'
   AND round_select.polcmd = 'r'
  LEFT JOIN pg_policy AS round_insert
    ON round_insert.polrelid = to_regclass('public.water_round_slots')
   AND round_insert.polname = 'water_round_slots_insert'
   AND round_insert.polcmd = 'a'
  UNION ALL
  SELECT 50, 'Schutz vor doppelten Terminzuordnungen',
    CASE
      WHEN planned_lookup.oid IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM pg_index AS meta
         WHERE meta.indexrelid = planned_lookup.oid AND meta.indisunique IS TRUE
       )
       AND COALESCE((SELECT pg_get_indexdef(index.oid) FROM pg_class AS index WHERE index.oid = planned_lookup.oid), '') LIKE '%facility_id%'
       AND COALESCE((SELECT pg_get_indexdef(index.oid) FROM pg_class AS index WHERE index.oid = planned_lookup.oid), '') LIKE '%slot_id%'
       AND COALESCE((SELECT pg_get_indexdef(index.oid) FROM pg_class AS index WHERE index.oid = planned_lookup.oid), '') LIKE '%service_day%'
       AND COALESCE((SELECT pg_get_expr(meta.indpred, meta.indrelid) FROM pg_index AS meta WHERE meta.indexrelid = planned_lookup.oid), '') LIKE '%planned%'
       AND round_lookup.oid IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM pg_index AS meta
         WHERE meta.indexrelid = round_lookup.oid AND meta.indisunique IS TRUE AND meta.indpred IS NULL
       )
       AND COALESCE((SELECT pg_get_indexdef(index.oid) FROM pg_class AS index WHERE index.oid = round_lookup.oid), '') LIKE '%(round_id)%'
       AND time_lookup.oid IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM pg_index AS meta
         WHERE meta.indexrelid = time_lookup.oid AND meta.indisunique IS TRUE
       )
       AND COALESCE((SELECT pg_get_expr(meta.indpred, meta.indrelid) FROM pg_index AS meta WHERE meta.indexrelid = time_lookup.oid), '') LIKE '%active%'
       AND claim_slot.oid IS NOT NULL
       AND position('FOR UPDATE' IN pg_get_functiondef(claim_slot.oid)) > 0
       AND position('Dieser Termin wurde bereits abgeschlossen.' IN pg_get_functiondef(claim_slot.oid)) > 0
       AND position('RETURN ''already''' IN pg_get_functiondef(claim_slot.oid)) > 0
       AND scheduled.oid IS NOT NULL
       AND position('tageswerk_claim_water_round_slot(facility, p_slot_id, p_round_id)' IN pg_get_functiondef(scheduled.oid))
           < position('tageswerk_record_water_round(p_round_id, p_checks)' IN pg_get_functiondef(scheduled.oid))
       AND position('tageswerk_record_water_round(p_round_id, p_checks)' IN pg_get_functiondef(scheduled.oid))
           < position('INSERT INTO public.water_round_slots' IN pg_get_functiondef(scheduled.oid))
       AND position('already_stored' IN pg_get_functiondef(scheduled.oid))
           > position('tageswerk_record_water_round(p_round_id, p_checks)' IN pg_get_functiondef(scheduled.oid))
       AND position('Diese Kontrollrunde ist bereits gespeichert und kann diesem Termin nicht zugeordnet werden.' IN pg_get_functiondef(scheduled.oid)) > 0
       AND position('EXCEPTION WHEN' IN pg_get_functiondef(scheduled.oid)) = 0
       AND position('EXCEPTION WHEN' IN pg_get_functiondef(claim_slot.oid)) = 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Ein Termin und eine Runde sind je Tag eindeutig. Der zweite Mitarbeiter wartet auf die Sperre und erhält die deutsche Meldung. Eine bereits gespeicherte Runde wird nicht nachträglich zugeordnet.'
  FROM (SELECT to_regclass('public.water_round_slots_one_planned') AS oid) AS planned_lookup
  CROSS JOIN (SELECT to_regclass('public.water_round_slots_round') AS oid) AS round_lookup
  CROSS JOIN (SELECT to_regclass('public.water_facility_slots_active_time') AS oid) AS time_lookup
  LEFT JOIN pg_proc AS claim_slot ON claim_slot.oid = to_regprocedure('public.tageswerk_claim_water_round_slot(uuid,uuid,uuid)')
  LEFT JOIN pg_proc AS scheduled ON scheduled.oid = to_regprocedure('public.tageswerk_record_scheduled_water_round(uuid,jsonb,uuid)')
  UNION ALL
  SELECT 60, 'Serverseitige Vollständigkeitsprüfung',
    CASE
      WHEN covers.oid IS NOT NULL
       AND covers.prosecdef IS TRUE
       AND pg_get_function_result(covers.oid) = 'boolean'
       AND position('pool.active IS TRUE' IN pg_get_functiondef(covers.oid)) > 0
       AND position('check_row.recorded_by = auth.uid()' IN pg_get_functiondef(covers.oid)) > 0
       AND position('check_row.xmin = pg_catalog.pg_current_xact_id()::xid' IN pg_get_functiondef(covers.oid)) > 0
       AND position('INSERT' IN pg_get_functiondef(covers.oid)) = 0
       AND position('UPDATE' IN pg_get_functiondef(covers.oid)) = 0
       AND position('DELETE' IN pg_get_functiondef(covers.oid)) = 0
       AND scheduled.oid IS NOT NULL
       AND position('p_slot_id IS NOT NULL AND active_pools IS DISTINCT FROM supplied_pools' IN pg_get_functiondef(scheduled.oid)) > 0
       AND position('p_slot_id IS NOT NULL AND public.tageswerk_water_round_covers_active_pools(p_round_id, facility) IS NOT TRUE' IN pg_get_functiondef(scheduled.oid)) > 0
       AND position('supplied_pools < 1' IN pg_get_functiondef(scheduled.oid)) > 0
       AND round_insert.oid IS NOT NULL
       AND position('extra' IN pg_get_expr(round_insert.polwithcheck, round_insert.polrelid)) > 0
       AND position('extra' IN pg_get_expr(round_insert.polwithcheck, round_insert.polrelid))
           < position('tageswerk_water_round_covers_active_pools' IN pg_get_expr(round_insert.polwithcheck, round_insert.polrelid))
       AND position('planned' IN pg_get_expr(round_insert.polwithcheck, round_insert.polrelid))
           < position('tageswerk_water_round_covers_active_pools' IN pg_get_expr(round_insert.polwithcheck, round_insert.polrelid))
       AND position('tageswerk_water_round_checks_in_transaction' IN pg_get_expr(round_insert.polwithcheck, round_insert.polrelid)) > 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Eine geplante Runde muss alle aktiven Becken in derselben Transaktion enthalten. Eine Zusatzkontrolle braucht mindestens ein aktives Becken. Die Vollständigkeit aller Becken gilt dort nicht.'
  FROM (SELECT to_regprocedure('public.tageswerk_water_round_covers_active_pools(uuid,uuid)') AS oid) AS covers_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_record_scheduled_water_round(uuid,jsonb,uuid)') AS oid) AS scheduled_lookup
  LEFT JOIN pg_proc AS covers ON covers.oid = covers_lookup.oid
  LEFT JOIN pg_proc AS scheduled ON scheduled.oid = scheduled_lookup.oid
  LEFT JOIN pg_policy AS round_insert
    ON round_insert.polrelid = to_regclass('public.water_round_slots')
   AND round_insert.polname = 'water_round_slots_insert'
   AND round_insert.polcmd = 'a'
  UNION ALL
  SELECT 70, 'Abschlussfunktion unverändert',
    CASE
      WHEN recorder.oid IS NOT NULL
       AND finisher.oid IS NOT NULL
       AND recorder.prosecdef IS FALSE
       AND finisher.prosecdef IS TRUE
       AND pg_get_function_result(recorder.oid) = 'jsonb'
       AND pg_get_function_result(finisher.oid) = 'integer'
       AND position('tageswerk_finish_own_water_round_draft(p_round_id, facility)' IN pg_get_functiondef(recorder.oid)) > 0
       AND position('closed_drafts IS DISTINCT FROM 1' IN pg_get_functiondef(recorder.oid)) > 0
       AND position('UPDATE public.water_round_drafts' IN pg_get_functiondef(recorder.oid)) = 0
       AND position('EXCEPTION WHEN' IN pg_get_functiondef(recorder.oid)) = 0
       AND position('water_round_slots' IN pg_get_functiondef(recorder.oid)) = 0
       AND position('tageswerk_record_scheduled_water_round' IN pg_get_functiondef(recorder.oid)) = 0
       AND position('tageswerk_claim_water_round_slot' IN pg_get_functiondef(recorder.oid)) = 0
       AND position('tageswerk_water_round_covers_active_pools' IN pg_get_functiondef(recorder.oid)) = 0
       AND position('SET status = ''completed''' IN pg_get_functiondef(finisher.oid)) > 0
       AND position('draft.user_id = auth.uid()' IN pg_get_functiondef(finisher.oid)) > 0
       AND position('tageswerk_water_round_checks_in_transaction(p_round_id, p_facility_id) IS NOT TRUE' IN pg_get_functiondef(finisher.oid)) > 0
       AND position('EXCEPTION WHEN' IN pg_get_functiondef(finisher.oid)) = 0
       AND EXISTS (
         SELECT 1
         FROM pg_trigger AS trigger
         JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
         JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
         WHERE relation.relname = 'water_checks'
           AND trigger.tgname = 'water_checks_protect'
           AND trigger.tgisinternal IS FALSE
           AND procedure.proname = 'tageswerk_protect_water_check'
       )
       AND EXISTS (
         SELECT 1
         FROM pg_trigger AS trigger
         JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
         JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
         WHERE relation.relname = 'water_round_drafts'
           AND trigger.tgname = 'water_round_drafts_guard'
           AND trigger.tgisinternal IS FALSE
           AND procedure.proname = 'tageswerk_guard_water_round_draft'
       )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'tageswerk_record_water_round bleibt Aufrufer und kennt die neuen Tabellen nicht. Der geschützte Statuswechsel und die bestehenden Schutztrigger bleiben.'
  FROM (SELECT to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') AS oid) AS recorder_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_finish_own_water_round_draft(uuid,uuid)') AS oid) AS finisher_lookup
  LEFT JOIN pg_proc AS recorder ON recorder.oid = recorder_lookup.oid
  LEFT JOIN pg_proc AS finisher ON finisher.oid = finisher_lookup.oid
  UNION ALL
  SELECT 80, 'Eigentümer, Suchpfad und Ausführungsrechte',
    CASE
      WHEN covers.oid IS NOT NULL
       AND claim_slot.oid IS NOT NULL
       AND proof.oid IS NOT NULL
       AND scheduled.oid IS NOT NULL
       AND save_plan.oid IS NOT NULL
       AND lock_plan.oid IS NOT NULL
       AND covers.proowner = proof.proowner
       AND claim_slot.proowner = proof.proowner
       AND EXISTS (SELECT 1 FROM unnest(COALESCE(covers.proconfig, ARRAY[]::text[])) AS cfg WHERE cfg IN ('search_path=', 'search_path=""'))
       AND EXISTS (SELECT 1 FROM unnest(COALESCE(claim_slot.proconfig, ARRAY[]::text[])) AS cfg WHERE cfg IN ('search_path=', 'search_path=""'))
       AND EXISTS (SELECT 1 FROM unnest(COALESCE(scheduled.proconfig, ARRAY[]::text[])) AS cfg WHERE cfg IN ('search_path=', 'search_path=""'))
       AND EXISTS (SELECT 1 FROM unnest(COALESCE(save_plan.proconfig, ARRAY[]::text[])) AS cfg WHERE cfg IN ('search_path=', 'search_path=""'))
       AND EXISTS (SELECT 1 FROM unnest(COALESCE(lock_plan.proconfig, ARRAY[]::text[])) AS cfg WHERE cfg IN ('search_path=', 'search_path=""'))
       AND has_function_privilege('authenticated', covers.oid, 'EXECUTE')
       AND has_function_privilege('authenticated', claim_slot.oid, 'EXECUTE')
       AND has_function_privilege('authenticated', scheduled.oid, 'EXECUTE')
       AND has_function_privilege('authenticated', save_plan.oid, 'EXECUTE')
       AND has_function_privilege('authenticated', lock_plan.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', covers.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', claim_slot.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', scheduled.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', save_plan.oid, 'EXECUTE')
       AND NOT has_function_privilege('public', covers.oid, 'EXECUTE')
       AND NOT has_function_privilege('public', claim_slot.oid, 'EXECUTE')
       AND NOT has_function_privilege('public', scheduled.oid, 'EXECUTE')
       AND NOT has_function_privilege('public', save_plan.oid, 'EXECUTE')
       AND position('pg_advisory_xact_lock' IN pg_get_functiondef(lock_plan.oid)) > 0
       AND position('tageswerk_lock_water_facility_plan(p_facility_id)' IN pg_get_functiondef(save_plan.oid))
           < position('UPDATE public.water_facility_slots' IN pg_get_functiondef(save_plan.oid))
       AND position('retired_on <= today' IN pg_get_functiondef(save_plan.oid)) > 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Die DEFINER-Funktionen gehören demselben Eigentümer wie der bestehende Transaktionsbeweis. authenticated darf ausführen. anon und public dürfen es nicht.'
  FROM (SELECT to_regprocedure('public.tageswerk_water_round_covers_active_pools(uuid,uuid)') AS oid) AS covers_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_claim_water_round_slot(uuid,uuid,uuid)') AS oid) AS claim_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_water_round_checks_in_transaction(uuid,uuid)') AS oid) AS proof_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_record_scheduled_water_round(uuid,jsonb,uuid)') AS oid) AS scheduled_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_save_water_facility_slots(uuid,text[])') AS oid) AS save_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_lock_water_facility_plan(uuid)') AS oid) AS lock_lookup
  LEFT JOIN pg_proc AS covers ON covers.oid = covers_lookup.oid
  LEFT JOIN pg_proc AS claim_slot ON claim_slot.oid = claim_lookup.oid
  LEFT JOIN pg_proc AS proof ON proof.oid = proof_lookup.oid
  LEFT JOIN pg_proc AS scheduled ON scheduled.oid = scheduled_lookup.oid
  LEFT JOIN pg_proc AS save_plan ON save_plan.oid = save_lookup.oid
  LEFT JOIN pg_proc AS lock_plan ON lock_plan.oid = lock_lookup.oid
) AS kontrollen
ORDER BY sortierung;
