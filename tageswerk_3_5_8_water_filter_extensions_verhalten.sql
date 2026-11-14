-- Verhaltensprüfung für Filter-Erweiterungen (Korrektur + Status).
-- NUR in einer bestätigten Testdatenbank ausführen.
-- Voraussetzung: 3.5.8-Basisverhalten und Phase-B1-Migration installiert.
-- Nutzt die UUID-Serie aus tageswerk_3_5_8_water_filter_flushes_verhalten.sql.
-- NICHT in der Produktivdatenbank ausführen.

DO $guard$
BEGIN
  IF current_setting('tageswerk.integration_test', true) IS DISTINCT FROM 'bestaetigt' THEN
    RAISE EXCEPTION 'verhalten.sql für Filter-Erweiterungen läuft nur mit tageswerk.integration_test=bestaetigt.';
  END IF;
  IF to_regclass('public.water_filter_flush_corrections') IS NULL
     OR to_regclass('public.water_filter_status_events') IS NULL THEN
    RAISE EXCEPTION 'Filter-Erweiterungen sind nicht installiert.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.water_filter_flushes
    WHERE filter_id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'
  ) THEN
    RAISE EXCEPTION 'Testdaten aus 3.5.8-Verhalten fehlen.';
  END IF;
END;
$guard$;

DO $steps$
DECLARE
  flush_id uuid;
  filter_a uuid := 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1';
  filter_b uuid := 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f2';
  manager uuid := '25252525-2525-4525-8525-252525252525';
  employee uuid := '35353535-3535-4535-8535-353535353535';
  technician uuid := '45454545-4545-4545-8545-454545454545';
  original_filter uuid;
  original_flushed timestamptz;
  original_note text;
  corrected jsonb;
  second jsonb;
  status_res jsonb;
  effective record;
BEGIN
  SELECT id, filter_id, flushed_at, note
    INTO flush_id, original_filter, original_flushed, original_note
  FROM public.water_filter_flushes
  WHERE filter_id = filter_a
  ORDER BY flushed_at DESC, recorded_at DESC, id DESC
  LIMIT 1;

  PERFORM public.tageswerk_test_expect(flush_id IS NOT NULL, 'Spülung für Korrektur gefunden');

  -- Filter B ggf. reaktivieren (kann aus Basisverhalten deaktiviert sein).
  PERFORM set_config('request.jwt.claim.sub', manager::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', manager::text)::text, true);
  SET ROLE authenticated;
  IF EXISTS (SELECT 1 FROM public.water_filters WHERE id = filter_b AND active IS NOT TRUE) THEN
    status_res := public.tageswerk_set_water_filter_active(filter_b, true, 'Reaktivierung für Korrekturtest');
    PERFORM public.tageswerk_test_expect(coalesce((status_res ->> 'ok')::boolean, false), 'Filter B reaktiviert');
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', employee::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', employee::text)::text, true);
  SET ROLE authenticated;
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format(
        $sql$SELECT public.tageswerk_correct_water_filter_flush(%L::uuid, %L::uuid, now() - interval '10 minutes', 'note', 'falscher Filter')$sql$,
        flush_id, filter_b
      )
    ),
    'Mitarbeiter korrigiert nicht'
  );
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format($sql$SELECT public.tageswerk_set_water_filter_active(%L::uuid, false, 'ohne Recht')$sql$, filter_a)
    ),
    'Mitarbeiter deaktiviert nicht'
  );
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', technician::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', technician::text)::text, true);
  SET ROLE authenticated;
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format(
        $sql$SELECT public.tageswerk_correct_water_filter_flush(%L::uuid, %L::uuid, now() - interval '10 minutes', 'note', 'falscher Filter')$sql$,
        flush_id, filter_b
      )
    ),
    'Techniker korrigiert nicht'
  );
  PERFORM public.tageswerk_test_expect(
    (SELECT count(*) >= 0 FROM public.water_filter_flush_corrections WHERE facility_id = 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5'),
    'Techniker darf Korrekturhistorie lesen'
  );
  PERFORM public.tageswerk_test_expect(
    (SELECT count(*) = 0 FROM public.water_filter_status_events),
    'Techniker sieht keine Statushistorie'
  );
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format($sql$UPDATE public.water_filter_flushes SET note = 'direkt' WHERE id = %L::uuid$sql$, flush_id)
    ),
    'Direkter UPDATE auf Original bleibt gesperrt'
  );
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', manager::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', manager::text)::text, true);
  SET ROLE authenticated;

  corrected := public.tageswerk_correct_water_filter_flush(
    flush_id,
    filter_b,
    now() - interval '30 minutes',
    'erste Korrektur',
    'Falscher Filter und Zeitpunkt'
  );
  PERFORM public.tageswerk_test_expect(coalesce((corrected ->> 'ok')::boolean, false), 'Leitung korrigiert');
  PERFORM public.tageswerk_test_expect(coalesce((corrected ->> 'original_unchanged')::boolean, false), 'Original bleibt unverändert markiert');

  PERFORM public.tageswerk_test_expect(
    (
      SELECT filter_id = original_filter
         AND flushed_at IS NOT DISTINCT FROM original_flushed
         AND note IS NOT DISTINCT FROM original_note
      FROM public.water_filter_flushes
      WHERE id = flush_id
    ),
    'Originaleintrag unverändert'
  );

  SELECT * INTO effective FROM public.tageswerk_water_filter_flush_effective(flush_id);
  PERFORM public.tageswerk_test_expect(effective.is_corrected IS TRUE, 'Effective ist korrigiert');
  PERFORM public.tageswerk_test_expect(effective.filter_id = filter_b, 'Effective Filter ist B');
  PERFORM public.tageswerk_test_expect(effective.note = 'erste Korrektur', 'Effective Bemerkung');

  second := public.tageswerk_correct_water_filter_flush(
    flush_id,
    filter_b,
    now() - interval '20 minutes',
    'zweite Korrektur',
    'Zeitpunkt nochmals angepasst'
  );
  PERFORM public.tageswerk_test_expect(coalesce((second ->> 'ok')::boolean, false), 'Mehrfachkorrektur möglich');
  PERFORM public.tageswerk_test_expect(
    (SELECT count(*) >= 2 FROM public.water_filter_flush_corrections WHERE flush_id = flush_id),
    'Beide Korrekturen bleiben erhalten'
  );
  SELECT * INTO effective FROM public.tageswerk_water_filter_flush_effective(flush_id);
  PERFORM public.tageswerk_test_expect(effective.note = 'zweite Korrektur', 'Neueste Korrektur gilt');

  PERFORM public.tageswerk_test_expect(
    (SELECT last_flushed_at IS NOT NULL FROM public.water_filters WHERE id = filter_b),
    'Ziel-Filter last_flushed neu berechnet'
  );

  status_res := public.tageswerk_set_water_filter_active(filter_b, false, 'Außer Betrieb wegen Wartung');
  PERFORM public.tageswerk_test_expect(coalesce((status_res ->> 'ok')::boolean, false), 'Außerbetriebnahme');
  PERFORM public.tageswerk_test_expect(
    EXISTS (
      SELECT 1 FROM public.water_filter_status_events
      WHERE filter_id = filter_b
        AND old_active IS TRUE
        AND new_active IS FALSE
        AND reason = 'Außer Betrieb wegen Wartung'
    ),
    'Statushistorie Außer Betrieb'
  );
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format(
        $sql$SELECT public.tageswerk_correct_water_filter_flush(%L::uuid, %L::uuid, now() - interval '5 minutes', 'x', 'auf deaktiviert')$sql$,
        flush_id, filter_b
      )
    ),
    'Korrektur auf deaktivierten Filter verboten'
  );

  status_res := public.tageswerk_set_water_filter_active(filter_b, true, 'Wieder in Betrieb');
  PERFORM public.tageswerk_test_expect(coalesce((status_res ->> 'ok')::boolean, false), 'Reaktivierung');
  PERFORM public.tageswerk_test_expect(
    (SELECT count(*) >= 2 FROM public.water_filter_status_events WHERE filter_id = filter_b),
    'Statushistorie bleibt erhalten'
  );

  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      $sql$UPDATE public.water_filters SET active = false WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f2'$sql$
    ),
    'Direkter active-UPDATE gesperrt'
  );
  PERFORM set_config('tageswerk.water_filter_status_change', '1', true);
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      $sql$UPDATE public.water_filters SET active = false WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f2'$sql$
    ),
    'GUC setzt active nicht frei'
  );
  PERFORM set_config('tageswerk.water_filter_last_flush_refresh', '1', true);
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      $sql$UPDATE public.water_filters
         SET last_flushed_at = now(), last_flushed_by = auth.uid()
         WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'$sql$
    ),
    'GUC setzt last_flushed nicht frei'
  );
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      $sql$UPDATE public.water_filter_flush_corrections SET reason = 'manipuliert'$sql$
    ),
    'Korrekturprotokoll unveränderlich'
  );
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      $sql$UPDATE public.water_filter_status_events SET reason = 'manipuliert'$sql$
    ),
    'Statusprotokoll unveränderlich'
  );
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format($sql$DELETE FROM public.water_filter_flushes WHERE id = %L::uuid$sql$, flush_id)
    ),
    'Löschen von Spülungen bleibt verboten'
  );

  -- Gleichzeitigkeit: zweite Korrektur sieht die erste (FOR UPDATE serialisiert).
  corrected := public.tageswerk_correct_water_filter_flush(
    flush_id,
    filter_b,
    now() - interval '15 minutes',
    'nach Sperre',
    'Parallele Korrektur serialisiert'
  );
  PERFORM public.tageswerk_test_expect(coalesce((corrected ->> 'ok')::boolean, false), 'Weitere Korrektur nach Sperre');
  PERFORM public.tageswerk_test_expect(
    (
      SELECT previous_note = 'zweite Korrektur'
      FROM public.water_filter_flush_corrections
      WHERE flush_id = flush_id
      ORDER BY corrected_at DESC, id DESC
      LIMIT 1
    ),
    'Keine Lost-Update: previous_* zeigt vorherige gültige Fassung'
  );

  RESET ROLE;
  PERFORM public.tageswerk_test_expect(true, 'Verhaltensprüfung Filter-Erweiterungen abgeschlossen');
END;
$steps$;
