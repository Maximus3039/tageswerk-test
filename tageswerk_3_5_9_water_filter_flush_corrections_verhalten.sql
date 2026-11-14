-- Verhaltensprüfung für Filterspülungs-Korrekturen.
-- NUR in einer bestätigten Testdatenbank ausführen.
-- Voraussetzung: 3.5.8-Verhaltenstest und 3.5.9 installiert.
-- Nutzt die UUID-Serie aus tageswerk_3_5_8_water_filter_flushes_verhalten.sql.
-- NICHT in der Produktivdatenbank ausführen.

DO $guard$
BEGIN
  IF current_setting('tageswerk.integration_test', true) IS DISTINCT FROM 'bestaetigt' THEN
    RAISE EXCEPTION 'verhalten.sql für Korrekturen läuft nur mit tageswerk.integration_test=bestaetigt.';
  END IF;
  IF to_regclass('public.water_filter_flush_corrections') IS NULL THEN
    RAISE EXCEPTION 'Korrekturen sind nicht installiert.';
  END IF;
  IF to_regprocedure('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_correct_water_filter_flush fehlt.';
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
  corrected jsonb;
  old_last_a timestamptz;
  new_last_b timestamptz;
BEGIN
  SELECT id INTO flush_id
  FROM public.water_filter_flushes
  WHERE filter_id = filter_a
  ORDER BY flushed_at DESC, recorded_at DESC, id DESC
  LIMIT 1;

  PERFORM public.tageswerk_test_expect(flush_id IS NOT NULL, 'Spülung für Korrektur gefunden');

  -- Filter 2 wurde im 3.5.8-Verhalten deaktiviert; für die Korrektur wieder aktivieren.
  PERFORM set_config('request.jwt.claim.sub', manager::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', manager::text)::text, true);
  SET ROLE authenticated;
  UPDATE public.water_filters SET active = true WHERE id = filter_b;
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
    public.tageswerk_test_fails(
      format($sql$UPDATE public.water_filter_flushes SET note = 'direkt' WHERE id = %L::uuid$sql$, flush_id)
    ),
    'Direkter UPDATE bleibt gesperrt'
  );
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', manager::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', manager::text)::text, true);
  SET ROLE authenticated;

  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format(
        $sql$SELECT public.tageswerk_correct_water_filter_flush(%L::uuid, %L::uuid, now() - interval '10 minutes', 'note', 'ab')$sql$,
        flush_id, filter_b
      )
    ),
    'Begründung zu kurz'
  );

  SELECT last_flushed_at INTO old_last_a FROM public.water_filters WHERE id = filter_a;

  corrected := public.tageswerk_correct_water_filter_flush(
    flush_id,
    filter_b,
    now() - interval '30 minutes',
    'korrigierte Bemerkung',
    'Falscher Filter und Zeitpunkt'
  );
  PERFORM public.tageswerk_test_expect(coalesce((corrected ->> 'ok')::boolean, false), 'Leitung korrigiert');
  PERFORM public.tageswerk_test_expect(
    EXISTS (
      SELECT 1 FROM public.water_filter_flush_corrections
      WHERE flush_id = flush_id
        AND old_filter_id = filter_a
        AND new_filter_id = filter_b
        AND reason = 'Falscher Filter und Zeitpunkt'
        AND corrected_by = manager
    ),
    'Korrekturprotokoll gespeichert'
  );
  PERFORM public.tageswerk_test_expect(
    (
      SELECT filter_id = filter_b
         AND note = 'korrigierte Bemerkung'
         AND correction_count >= 1
         AND corrected_by = manager
      FROM public.water_filter_flushes
      WHERE id = flush_id
    ),
    'Spülung zeigt korrigierte Werte'
  );

  SELECT last_flushed_at INTO new_last_b FROM public.water_filters WHERE id = filter_b;
  PERFORM public.tageswerk_test_expect(new_last_b IS NOT NULL, 'Ziel-Filter neu berechnet');
  PERFORM public.tageswerk_test_expect(
    (
      SELECT COALESCE(last_flushed_at, '-infinity'::timestamptz)
             IS DISTINCT FROM COALESCE(old_last_a, '-infinity'::timestamptz)
      FROM public.water_filters
      WHERE id = filter_a
    )
    OR EXISTS (SELECT 1 FROM public.water_filter_flushes WHERE filter_id = filter_a),
    'Quell-Filter nach Verschieben neu bewertet'
  );

  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      $sql$UPDATE public.water_filter_flush_corrections SET reason = 'manipuliert'$sql$
    ),
    'Korrekturprotokoll unveränderlich'
  );
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format($sql$DELETE FROM public.water_filter_flushes WHERE id = %L::uuid$sql$, flush_id)
    ),
    'Löschen bleibt verboten'
  );

  RESET ROLE;
  PERFORM public.tageswerk_test_expect(true, 'Verhaltensprüfung Filterspülungs-Korrekturen abgeschlossen');
END;
$steps$;
