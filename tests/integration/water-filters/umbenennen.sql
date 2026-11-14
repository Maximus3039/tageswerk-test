-- Ergänzende Verhaltensprüfung: Filter umbenennen.
-- NUR in einer bestätigten Testdatenbank ausführen.
-- Voraussetzung: Basis- und Erweiterungs-Verhalten mit UUID-Serie a5a5…/f5f5… .
-- NICHT in der Produktivdatenbank ausführen.

DO $guard$
BEGIN
  IF current_setting('tageswerk.integration_test', true) IS DISTINCT FROM 'bestaetigt' THEN
    RAISE EXCEPTION 'umbenennen.sql läuft nur mit tageswerk.integration_test=bestaetigt.';
  END IF;
  IF to_regclass('public.water_filters') IS NULL THEN
    RAISE EXCEPTION 'water_filters fehlt.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.water_filters
    WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'
  ) THEN
    RAISE EXCEPTION 'Testdaten aus dem Filterspülungs-Verhalten fehlen.';
  END IF;
END;
$guard$;

DO $steps$
DECLARE
  filter_a uuid := 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1';
  manager uuid := '25252525-2525-4525-8525-252525252525';
  employee uuid := '35353535-3535-4535-8535-353535353535';
  technician uuid := '45454545-4545-4545-8545-454545454545';
  before_active boolean;
  before_last timestamptz;
  before_by uuid;
BEGIN
  SELECT active, last_flushed_at, last_flushed_by
    INTO before_active, before_last, before_by
  FROM public.water_filters
  WHERE id = filter_a;

  PERFORM set_config('request.jwt.claim.sub', employee::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', employee::text)::text, true);
  SET ROLE authenticated;
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format($sql$UPDATE public.water_filters SET name = 'Hack Mitarbeiter' WHERE id = %L::uuid$sql$, filter_a)
    ),
    'Mitarbeiter benennt Filter nicht um'
  );
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', technician::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', technician::text)::text, true);
  SET ROLE authenticated;
  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format($sql$UPDATE public.water_filters SET name = 'Hack Techniker' WHERE id = %L::uuid$sql$, filter_a)
    ),
    'Techniker benennt Filter nicht um'
  );
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', manager::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', manager::text)::text, true);
  SET ROLE authenticated;

  UPDATE public.water_filters
  SET name = 'Filter 1 umbenannt'
  WHERE id = filter_a;

  PERFORM public.tageswerk_test_expect(
    (SELECT name = 'Filter 1 umbenannt' FROM public.water_filters WHERE id = filter_a),
    'Leitung benennt Filter um'
  );
  PERFORM public.tageswerk_test_expect(
    (
      SELECT active IS NOT DISTINCT FROM before_active
         AND last_flushed_at IS NOT DISTINCT FROM before_last
         AND last_flushed_by IS NOT DISTINCT FROM before_by
      FROM public.water_filters
      WHERE id = filter_a
    ),
    'Umbenennen lässt active und last_flushed unverändert'
  );

  PERFORM public.tageswerk_test_expect(
    public.tageswerk_test_fails(
      format(
        $sql$UPDATE public.water_filters
           SET name = 'Filter 1 umbenannt', active = false
           WHERE id = %L::uuid$sql$,
        filter_a
      )
    ),
    'Umbenennen darf active nicht mitsetzen'
  );

  RESET ROLE;
  PERFORM public.tageswerk_test_expect(true, 'Umbenennen-Prüfung abgeschlossen');
END;
$steps$;
