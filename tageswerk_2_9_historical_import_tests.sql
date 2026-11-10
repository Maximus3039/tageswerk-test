-- Tageswerk 2.9, Tests für den historischen Zählerimport
-- Noch nicht ausführen. Erst tageswerk_2_9_historical_import.sql committen lassen,
-- danach dieses Skript einzeln ausführen. Es ist eine Transaktion und endet mit ROLLBACK.
-- Bestehende Zähler und Ablesungen außerhalb dieser Transaktion bleiben unverändert.

BEGIN;

CREATE TEMP TABLE test_ctx (
  k text PRIMARY KEY,
  v uuid
) ON COMMIT DROP;
GRANT ALL ON TABLE test_ctx TO authenticated;

DO $fixture$
DECLARE
  v_admin uuid;
  v_org uuid;
  v_facility uuid;
  v_manager uuid;
  v_employee uuid;
  v_missing text := '';
BEGIN
  SELECT m.user_id, m.organization_id
    INTO v_admin, v_org
  FROM public.memberships m
  WHERE m.role = 'company_admin'
    AND m.facility_id IS NULL
    AND m.is_active IS TRUE
  ORDER BY m.user_id
  LIMIT 1;

  IF v_admin IS NULL THEN
    v_missing := v_missing || 'aktive Geschäftsführung ohne Betrieb; ';
  ELSIF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_admin) THEN
    v_missing := v_missing || 'Benutzerkonto der Geschäftsführung; ';
  ELSIF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org) THEN
    v_missing := v_missing || 'Organisation der Geschäftsführung; ';
  END IF;

  IF v_org IS NOT NULL THEN
    SELECT f.id INTO v_facility
    FROM public.facilities f
    WHERE f.organization_id = v_org
    ORDER BY f.id
    LIMIT 1;
    IF v_facility IS NULL THEN
      v_missing := v_missing || 'Betrieb der Organisation; ';
    END IF;
  END IF;

  IF v_org IS NOT NULL AND v_facility IS NOT NULL AND v_admin IS NOT NULL THEN
    SELECT m.user_id INTO v_manager
    FROM public.memberships m
    WHERE m.organization_id = v_org
      AND m.facility_id = v_facility
      AND m.role = 'facility_manager'
      AND m.is_active IS TRUE
      AND m.user_id <> v_admin
    ORDER BY m.user_id
    LIMIT 1;
    IF v_manager IS NULL THEN
      v_missing := v_missing || 'aktive Betriebsleitung als eigener Benutzer; ';
    ELSIF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_manager) THEN
      v_missing := v_missing || 'Benutzerkonto der Betriebsleitung; ';
    END IF;

    SELECT m.user_id INTO v_employee
    FROM public.memberships m
    WHERE m.organization_id = v_org
      AND m.facility_id = v_facility
      AND m.role = 'employee'
      AND m.is_active IS TRUE
      AND m.user_id <> v_admin
      AND m.user_id IS DISTINCT FROM v_manager
    ORDER BY m.user_id
    LIMIT 1;
    IF v_employee IS NULL THEN
      v_missing := v_missing || 'aktiver Mitarbeiter als weiterer eigener Benutzer; ';
    ELSIF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_employee) THEN
      v_missing := v_missing || 'Benutzerkonto des Mitarbeiters; ';
    END IF;
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION
      'Testvoraussetzungen fehlen. Bestehende Benutzer, Organisationen, Betriebe und Mitgliedschaften bleiben unverändert. Nicht gefunden: %',
      v_missing;
  END IF;

  INSERT INTO test_ctx (k, v) VALUES
    ('admin', v_admin),
    ('org', v_org),
    ('facility', v_facility),
    ('manager', v_manager),
    ('employee', v_employee);
END;
$fixture$;

CREATE FUNCTION pg_temp.as_user(p_user uuid)
RETURNS void
LANGUAGE plpgsql
AS $body$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
  IF auth.uid() IS DISTINCT FROM p_user THEN
    RAISE EXCEPTION 'auth.uid() liefert nicht die Testperson';
  END IF;
END;
$body$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(uuid) TO authenticated;

CREATE FUNCTION pg_temp.payload(
  p_key text,
  p_blatt text,
  p_zelle text,
  p_original text,
  p_datum text,
  p_zeit text,
  p_entscheidung text DEFAULT 'bestaetigt',
  p_korrigiert text DEFAULT NULL,
  p_zeitraum text DEFAULT 'vormittag',
  p_angenommen boolean DEFAULT false,
  p_uhrzeit_bestaetigt boolean DEFAULT true,
  p_begruendung text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
AS $body$
  SELECT jsonb_build_object(
    'excel_schluessel', p_key,
    'datensatz_id', p_blatt || '!' || p_zelle,
    'quelle_blatt', p_blatt,
    'quelle_zelle', p_zelle,
    'original_zaehlerstand', p_original,
    'korrigierter_zaehlerstand', p_korrigiert,
    'entscheidung', p_entscheidung,
    'ablesedatum', p_datum,
    'ablesezeitraum', p_zeitraum,
    'uhrzeit_bestaetigt', p_uhrzeit_bestaetigt,
    'bestaetigte_uhrzeit', p_zeit,
    'uhrzeit_angenommen', p_angenommen,
    'begruendung', p_begruendung
  );
$body$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(
  text, text, text, text, text, text, text, text, text, boolean, boolean, text
) TO authenticated;

DO $grants$
DECLARE
  v_signature regprocedure;
  v_def text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.tageswerk_preview_historical_import(uuid,jsonb)',
    'public.tageswerk_commit_historical_import(uuid,uuid,text,text,jsonb)',
    'public.tageswerk_assess_historical_import(uuid,jsonb)'
  ]::regprocedure[]
  LOOP
    IF NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Test 1: authenticated darf % nicht ausführen', v_signature;
    END IF;
    IF has_function_privilege('anon', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Test 1: anon darf % ausführen', v_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS recht
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'tageswerk_preview_historical_import',
        'tageswerk_commit_historical_import',
        'tageswerk_assess_historical_import',
        'tageswerk_issue_historical_permit',
        'tageswerk_consume_historical_permit'
      )
      AND recht.grantee = 0
      AND recht.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Test 1: PUBLIC darf eine Importfunktion ausführen';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'tageswerk_preview_historical_import',
        'tageswerk_assess_historical_import',
        'tageswerk_prepare_reading'
      )
      AND p.prosecdef IS TRUE
  ) THEN
    RAISE EXCEPTION 'Test 1: eine Importfunktion läuft nicht als Aufrufer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'tageswerk_commit_historical_import',
        'tageswerk_issue_historical_permit',
        'tageswerk_consume_historical_permit'
      )
      AND (
        p.prosecdef IS NOT TRUE
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
          WHERE cfg IN ('search_path=', 'search_path=""')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Test 1: eine privilegierte Importfunktion ist nicht eng begrenzt';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.tageswerk_issue_historical_permit(uuid,uuid,numeric,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.tageswerk_consume_historical_permit(uuid,numeric,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.tageswerk_issue_historical_permit(uuid,uuid,numeric,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.tageswerk_consume_historical_permit(uuid,numeric,timestamptz)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Test 1: eine API-Rolle darf Freigaben ausstellen oder verbrauchen';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'utility_meter_import_batches',
        'utility_meter_import_mappings',
        'utility_meter_import_readings',
        'utility_meter_import_permits'
      )
      AND (c.relrowsecurity IS NOT TRUE OR c.relforcerowsecurity IS NOT TRUE)
  ) THEN
    RAISE EXCEPTION 'Test 1: RLS ist nicht erzwungen';
  END IF;

  IF has_table_privilege('anon', 'public.utility_meter_import_batches', 'SELECT')
     OR has_table_privilege('anon', 'public.utility_meter_import_readings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.utility_meter_import_readings', 'DELETE') THEN
    RAISE EXCEPTION 'Test 1: Tabellenrechte sind zu weit';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.utility_meter_import_readings', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.utility_meter_import_readings', 'INSERT') THEN
    RAISE EXCEPTION 'Test 1: authenticated darf die Herkunft nicht lesen und schreiben';
  END IF;

  v_def := pg_get_functiondef('public.tageswerk_prepare_reading()'::regprocedure);
  IF position('tageswerk_consume_historical_permit' IN v_def) = 0
     OR position('tageswerk_commit_historical_import' IN v_def) = 0
     OR position('Für einen deaktivierten Zähler wird keine neue Ablesung erfasst. Korrekturen bleiben möglich.' IN v_def) = 0
     OR position('Der Zählerstand passt nicht zwischen die benachbarten Ablesungen.' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Test 1: die Ableseprüfung enthält die Importausnahme oder die Nachbarschaftsregel nicht';
  END IF;
  IF has_table_privilege('authenticated', 'public.utility_meter_import_permits', 'SELECT')
     OR has_table_privilege('authenticated', 'public.utility_meter_import_permits', 'INSERT')
     OR has_table_privilege('anon', 'public.utility_meter_import_permits', 'SELECT')
     OR has_table_privilege('service_role', 'public.utility_meter_import_permits', 'INSERT') THEN
    RAISE EXCEPTION 'Test 1: die Freigabetabelle ist für eine API-Rolle zugänglich';
  END IF;
END;
$grants$;

SET LOCAL ROLE authenticated;
SET LOCAL row_security = on;

DO $tests$
DECLARE
  v_id uuid;
  v_count integer;
  v_before integer;
  v_consumption numeric;
  v_value numeric;
  v_at timestamptz;
  v_result jsonb;
  v_token uuid := gen_random_uuid();
  v_token_again uuid := gen_random_uuid();
  v_token_dup uuid := gen_random_uuid();
  v_token_decline uuid := gen_random_uuid();
  v_token_inactive uuid := gen_random_uuid();
  v_token_late uuid := gen_random_uuid();
  v_hash text := repeat('a1', 32);
  v_hash_dup text := repeat('b2', 32);
  v_hash_decline text := repeat('c3', 32);
  v_hash_inactive text := repeat('d4', 32);
  v_hash_late text := repeat('e5', 32);
  v_bypass boolean;
  v_active boolean;
  v_number_direct text := 'TW' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_number_valid text := 'TW' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_number_dup text := 'TW' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_number_decline text := 'TW' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_number_inactive text := 'TW' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
BEGIN
  IF (SELECT count(*) FROM test_ctx WHERE k IN ('admin', 'org', 'facility', 'manager', 'employee')) <> 5 THEN
    RAISE EXCEPTION 'Test 2: Testvoraussetzungen fehlen';
  END IF;

  SELECT v INTO v_id FROM test_ctx WHERE k = 'admin';
  PERFORM pg_temp.as_user(v_id);
  v_result := public.tageswerk_preview_historical_import(
    (SELECT v FROM test_ctx WHERE k = 'facility'),
    '[]'::jsonb
  );
  IF (v_result->>'uebernehmbar')::integer <> 0 OR (v_result->>'schreibbar')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Test 2: die Geschäftsführung erhält keine leere Vorschau';
  END IF;

  SELECT v INTO v_id FROM test_ctx WHERE k = 'manager';
  PERFORM pg_temp.as_user(v_id);
  SELECT rolbypassrls INTO v_bypass
  FROM pg_roles
  WHERE rolname = current_user;
  IF current_user <> 'authenticated' OR v_bypass IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Test 2: Rolle % umgeht RLS', current_user;
  END IF;

  WITH created AS (
    INSERT INTO public.utility_meters (facility_id, medium, unit, label, meter_number)
    SELECT v, 'electricity', 'kWh', 'Direkt historisch', v_number_direct
    FROM test_ctx WHERE k = 'facility'
    RETURNING id
  )
  INSERT INTO test_ctx (k, v) SELECT 'meter_direct', id FROM created;
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 100, timestamptz '2026-02-01 08:00+00'
  FROM test_ctx WHERE k = 'meter_direct';
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 300, timestamptz '2026-02-20 08:00+00'
  FROM test_ctx WHERE k = 'meter_direct';

  BEGIN
    INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
    SELECT v, 'regular', 50, timestamptz '2026-02-10 08:00+00'
    FROM test_ctx WHERE k = 'meter_direct';
    RAISE EXCEPTION 'Test 2: ein rückläufiger Stand wurde gespeichert';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%benachbarten Ablesungen%' THEN
        RAISE EXCEPTION 'Test 2: %', SQLERRM;
      END IF;
  END;
  SELECT count(*) INTO v_count
  FROM public.utility_meter_readings
  WHERE meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_direct');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Test 2: nach dem Rücklauf sind % Ablesungen vorhanden', v_count;
  END IF;

  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 200, timestamptz '2026-02-10 08:00+00'
  FROM test_ctx WHERE k = 'meter_direct';
  IF EXISTS (
    SELECT 1 FROM public.utility_meter_import_readings source
    WHERE source.meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_direct')
  ) THEN
    RAISE EXCEPTION 'Test 2: die direkte Ablesung hat eine Importherkunft angelegt';
  END IF;

  WITH created AS (
    INSERT INTO public.utility_meters (facility_id, medium, unit, label, meter_number)
    SELECT v, 'electricity', 'kWh', 'Import gültig', v_number_valid
    FROM test_ctx WHERE k = 'facility'
    RETURNING id
  )
  INSERT INTO test_ctx (k, v) SELECT 'meter_valid', id FROM created;
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 1000, timestamptz '2026-01-01 08:00+00'
  FROM test_ctx WHERE k = 'meter_valid';
  WITH created AS (
    INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
    SELECT v, 'regular', 1300, timestamptz '2026-01-31 08:00+00'
    FROM test_ctx WHERE k = 'meter_valid'
    RETURNING id
  )
  INSERT INTO test_ctx (k, v) SELECT 'reading_later', id FROM created;

  BEGIN
    INSERT INTO public.utility_meter_import_mappings (
      facility_id, excel_schluessel, excel_bezeichnung, excel_verbrauchsart, excel_einheit, meter_id
    )
    SELECT v, 'tw-hist-valid', 'Strom Test', 'Wasser', 'm3', (SELECT v FROM test_ctx WHERE k = 'meter_valid')
    FROM test_ctx WHERE k = 'facility';
    RAISE EXCEPTION 'Test 3: eine falsche Verbrauchsart wurde zugeordnet';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Einheit%' AND SQLERRM NOT LIKE '%Verbrauchsart%' THEN
        RAISE EXCEPTION 'Test 3: %', SQLERRM;
      END IF;
  END;

  INSERT INTO public.utility_meter_import_mappings (
    facility_id, excel_schluessel, excel_bezeichnung, excel_verbrauchsart, excel_einheit, meter_id
  )
  SELECT v, 'tw-hist-valid', 'Strom Test', 'Strom', 'kWh', (SELECT v FROM test_ctx WHERE k = 'meter_valid')
  FROM test_ctx WHERE k = 'facility';

  BEGIN
    INSERT INTO public.utility_meter_import_mappings (
      facility_id, excel_schluessel, excel_bezeichnung, excel_verbrauchsart, excel_einheit, meter_id
    )
    SELECT v, 'tw-hist-valid', 'Strom noch einmal', 'Strom', 'kWh', (SELECT v FROM test_ctx WHERE k = 'meter_direct')
    FROM test_ctx WHERE k = 'facility';
    RAISE EXCEPTION 'Test 3: derselbe Excel-Zähler wurde zweimal zugeordnet';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
  BEGIN
    INSERT INTO public.utility_meter_import_mappings (
      facility_id, excel_schluessel, excel_bezeichnung, excel_verbrauchsart, excel_einheit, meter_id
    )
    SELECT v, 'tw-hist-valid-2', 'Strom zweite Mappe', 'Strom', 'kWh', (SELECT v FROM test_ctx WHERE k = 'meter_valid')
    FROM test_ctx WHERE k = 'facility';
    RAISE EXCEPTION 'Test 3: derselbe Tageswerk-Zähler wurde zweimal zugeordnet';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  SELECT count(*) INTO v_before FROM public.utility_meter_import_batches;
  v_result := public.tageswerk_preview_historical_import(
    (SELECT v FROM test_ctx WHERE k = 'facility'),
    jsonb_build_array(pg_temp.payload(
      'tw-hist-valid', 'Januar 26', 'C4', '1099,5', '2026-01-15', '09:00:00',
      'korrigiert', '1100', 'vormittag', true, true, 'Stand aus der Quelle korrigiert'
    ))
  );
  SELECT count(*) INTO v_count FROM public.utility_meter_import_batches;
  IF v_count <> v_before THEN
    RAISE EXCEPTION 'Test 3: die Vorschau hat einen Importvorgang angelegt';
  END IF;
  IF (v_result->>'uebernehmbar')::integer <> 1
     OR (v_result->>'blockiert')::integer <> 0
     OR (v_result->>'schreibbar')::boolean IS NOT TRUE
     OR v_result ? 'datensaetze' THEN
    RAISE EXCEPTION 'Test 3: Vorschau %', v_result;
  END IF;
  SELECT (elem->>'bisher')::numeric, (elem->>'danach')::numeric
    INTO v_value, v_consumption
  FROM jsonb_array_elements(v_result->'verbrauchsauswirkungen') AS elem
  WHERE (elem->>'reading_id')::uuid = (SELECT v FROM test_ctx WHERE k = 'reading_later');
  IF v_value IS DISTINCT FROM 300 OR v_consumption IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION 'Test 3: Verbrauchsvorschau % nach %', v_value, v_consumption;
  END IF;

  v_result := public.tageswerk_commit_historical_import(
    (SELECT v FROM test_ctx WHERE k = 'facility'),
    v_token,
    v_hash,
    'verbrauch.xlsx',
    jsonb_build_array(pg_temp.payload(
      'tw-hist-valid', 'Januar 26', 'C4', '1099,5', '2026-01-15', '09:00:00',
      'korrigiert', '1100', 'vormittag', true, true, 'Stand aus der Quelle korrigiert'
    ))
  );
  IF (v_result->>'erneut')::boolean IS NOT FALSE OR (v_result->>'zeilen')::integer <> 1 THEN
    RAISE EXCEPTION 'Test 3: Importergebnis %', v_result;
  END IF;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.utility_meter_import_permits) THEN
    RAISE EXCEPTION 'Test 3: der aktive Import hat eine Freigabe hinterlassen';
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user((SELECT v FROM test_ctx WHERE k = 'manager'));

  SELECT reading.reading_at, reading.reading_value
    INTO v_at, v_value
  FROM public.utility_meter_readings reading
  JOIN public.utility_meter_import_readings source ON source.reading_id = reading.id
  WHERE source.meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_valid');
  IF v_value IS DISTINCT FROM 1100
     OR v_at IS DISTINCT FROM ((date '2026-01-15' + time '09:00:00') AT TIME ZONE 'Europe/Berlin') THEN
    RAISE EXCEPTION 'Test 3: übernommener Stand % um %', v_value, v_at;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.utility_meter_import_readings source
    WHERE source.meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_valid')
      AND source.original_zaehlerstand = '1099,5'
      AND source.korrigierter_zaehlerstand = '1100'
      AND source.entscheidung = 'korrigiert'
      AND source.begruendung = 'Stand aus der Quelle korrigiert'
      AND source.uhrzeit_angenommen IS TRUE
      AND source.bestaetigte_uhrzeit = time '09:00:00'
      AND source.ablesezeitraum = 'vormittag'
      AND source.quelle_blatt = 'Januar 26'
      AND source.quelle_zelle = 'C4'
      AND source.datensatz_id = 'Januar 26!C4'
  ) THEN
    RAISE EXCEPTION 'Test 3: Originalwert oder Herkunft fehlt';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.utility_meter_readings
  WHERE meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_valid')
    AND (
      (reading_value = 1000 AND reading_at = timestamptz '2026-01-01 08:00+00')
      OR (reading_value = 1300 AND reading_at = timestamptz '2026-01-31 08:00+00')
    );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Test 3: vorhandene Ablesungen wurden verändert';
  END IF;
  SELECT consumption_value INTO v_consumption
  FROM public.utility_meter_consumption
  WHERE reading_id = (SELECT v FROM test_ctx WHERE k = 'reading_later');
  IF v_consumption IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION 'Test 3: späterer Verbrauch %', v_consumption;
  END IF;
  SELECT consumption_value INTO v_consumption
  FROM public.utility_meter_consumption
  WHERE meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_valid')
    AND reading_at = ((date '2026-01-15' + time '09:00:00') AT TIME ZONE 'Europe/Berlin');
  IF v_consumption IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'Test 3: importierter Verbrauch %', v_consumption;
  END IF;

  v_result := public.tageswerk_commit_historical_import(
    (SELECT v FROM test_ctx WHERE k = 'facility'),
    v_token,
    v_hash,
    'verbrauch.xlsx',
    '[]'::jsonb
  );
  SELECT count(*) INTO v_count
  FROM public.utility_meter_readings
  WHERE meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_valid')
    AND reading_type <> 'correction';
  IF (v_result->>'erneut')::boolean IS NOT TRUE
     OR (v_result->>'zeilen')::integer <> 1
     OR v_count <> 3 THEN
    RAISE EXCEPTION 'Test 4: wiederholter Aufruf % bei % Ablesungen', v_result, v_count;
  END IF;

  BEGIN
    PERFORM public.tageswerk_commit_historical_import(
      (SELECT v FROM test_ctx WHERE k = 'facility'),
      v_token_again,
      v_hash,
      'verbrauch.xlsx',
      jsonb_build_array(pg_temp.payload(
        'tw-hist-valid', 'Januar 26', 'C4', '1099,5', '2026-01-15', '09:00:00',
        'korrigiert', '1100'
      ))
    );
    RAISE EXCEPTION 'Test 5: dieselbe Datei wurde erneut importiert';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%für den Betrieb bereits importiert%' THEN
        RAISE EXCEPTION 'Test 5: %', SQLERRM;
      END IF;
  END;
  SELECT count(*) INTO v_count
  FROM public.utility_meter_readings
  WHERE meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_valid')
    AND reading_type <> 'correction';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Test 5: nach dem zweiten Dateiimport sind % Ablesungen vorhanden', v_count;
  END IF;

  SELECT v INTO v_id FROM test_ctx WHERE k = 'employee';
  PERFORM pg_temp.as_user(v_id);
  SELECT count(*) INTO v_count FROM public.utility_meter_import_batches;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Test 6: der Mitarbeiter sieht % Importvorgänge', v_count;
  END IF;
  BEGIN
    PERFORM public.tageswerk_commit_historical_import(
      (SELECT v FROM test_ctx WHERE k = 'facility'),
      gen_random_uuid(),
      repeat('f6', 32),
      'mitarbeiter.xlsx',
      jsonb_build_array(pg_temp.payload('tw-hist-valid', 'Januar 26', 'D4', '1200', '2026-01-20', '09:00:00'))
    );
    RAISE EXCEPTION 'Test 6: der Mitarbeiter hat importiert';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Betriebsleitung%' THEN
        RAISE EXCEPTION 'Test 6: %', SQLERRM;
      END IF;
  END;
  BEGIN
    INSERT INTO public.utility_meter_import_batches (
      facility_id, client_token, inhalt_sha256, dateiname, status
    )
    SELECT v, gen_random_uuid(), repeat('f6', 32), 'mitarbeiter.xlsx', 'offen'
    FROM test_ctx WHERE k = 'facility';
    RAISE EXCEPTION 'Test 6: der Mitarbeiter hat einen Importvorgang angelegt';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Betriebsleitung%'
         AND SQLERRM NOT LIKE '%row-level security%'
         AND SQLERRM NOT LIKE '%Berechtigung%' THEN
        RAISE EXCEPTION 'Test 6: %', SQLERRM;
      END IF;
  END;
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 400, timestamptz '2026-02-28 08:00+00'
  FROM test_ctx WHERE k = 'meter_direct';

  SELECT v INTO v_id FROM test_ctx WHERE k = 'manager';
  PERFORM pg_temp.as_user(v_id);

  WITH created AS (
    INSERT INTO public.utility_meters (facility_id, medium, unit, label, meter_number)
    SELECT v, 'electricity', 'kWh', 'Import doppelt', v_number_dup
    FROM test_ctx WHERE k = 'facility'
    RETURNING id
  )
  INSERT INTO test_ctx (k, v) SELECT 'meter_dup', id FROM created;
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 1000, (date '2026-03-01' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
  FROM test_ctx WHERE k = 'meter_dup';
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 1800, timestamptz '2026-03-20 08:00+00'
  FROM test_ctx WHERE k = 'meter_dup';
  INSERT INTO public.utility_meter_import_mappings (
    facility_id, excel_schluessel, excel_bezeichnung, excel_verbrauchsart, excel_einheit, meter_id
  )
  SELECT v, 'tw-hist-dup', 'Strom doppelt', 'Strom', 'kWh', (SELECT v FROM test_ctx WHERE k = 'meter_dup')
  FROM test_ctx WHERE k = 'facility';
  v_result := public.tageswerk_preview_historical_import(
    (SELECT v FROM test_ctx WHERE k = 'facility'),
    jsonb_build_array(pg_temp.payload('tw-hist-dup', 'Maerz 26', 'C4', '1400', '2026-03-01', '09:00:00'))
  );
  IF (v_result->'zeilen'->0->'gruende')::text NOT LIKE '%bereits abgelesen%'
     OR (v_result->>'schreibbar')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Test 7: Vorschau %', v_result->'zeilen';
  END IF;
  BEGIN
    PERFORM public.tageswerk_commit_historical_import(
      (SELECT v FROM test_ctx WHERE k = 'facility'),
      v_token_dup,
      v_hash_dup,
      'doppelt.xlsx',
      jsonb_build_array(pg_temp.payload('tw-hist-dup', 'Maerz 26', 'C4', '1400', '2026-03-01', '09:00:00'))
    );
    RAISE EXCEPTION 'Test 7: die doppelte Ablesung wurde gespeichert';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%bereits abgelesen%' OR SQLERRM NOT LIKE '%nichts geschrieben%' THEN
        RAISE EXCEPTION 'Test 7: %', SQLERRM;
      END IF;
  END;
  SELECT count(*) INTO v_count
  FROM public.utility_meter_readings
  WHERE meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_dup');
  IF v_count <> 2 OR EXISTS (
    SELECT 1 FROM public.utility_meter_import_batches WHERE inhalt_sha256 = v_hash_dup
  ) THEN
    RAISE EXCEPTION 'Test 7: die doppelte Ablesung hat Daten hinterlassen';
  END IF;

  WITH created AS (
    INSERT INTO public.utility_meters (facility_id, medium, unit, label, meter_number)
    SELECT v, 'electricity', 'kWh', 'Import rückläufig', v_number_decline
    FROM test_ctx WHERE k = 'facility'
    RETURNING id
  )
  INSERT INTO test_ctx (k, v) SELECT 'meter_decline', id FROM created;
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 1000, timestamptz '2026-04-01 08:00+00'
  FROM test_ctx WHERE k = 'meter_decline';
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 1300, timestamptz '2026-04-30 08:00+00'
  FROM test_ctx WHERE k = 'meter_decline';
  INSERT INTO public.utility_meter_import_mappings (
    facility_id, excel_schluessel, excel_bezeichnung, excel_verbrauchsart, excel_einheit, meter_id
  )
  SELECT v, 'tw-hist-decline', 'Strom Rücklauf', 'Strom', 'kWh', (SELECT v FROM test_ctx WHERE k = 'meter_decline')
  FROM test_ctx WHERE k = 'facility';

  SELECT count(*) INTO v_before FROM public.utility_meter_import_batches;
  v_result := public.tageswerk_preview_historical_import(
    (SELECT v FROM test_ctx WHERE k = 'facility'),
    jsonb_build_array(pg_temp.payload('tw-hist-decline', 'April 26', 'C9', '900', '2026-04-15', '09:00:00'))
  );
  IF (v_result->'zeilen'->0->'gruende')::text NOT LIKE '%rückläufig%' THEN
    RAISE EXCEPTION 'Test 8: Vorschau %', v_result->'zeilen';
  END IF;
  v_result := public.tageswerk_preview_historical_import(
    (SELECT v FROM test_ctx WHERE k = 'facility'),
    jsonb_build_array(pg_temp.payload(
      'tw-hist-decline', 'April 26', 'C8', '1100', '2026-04-12', '09:00:00', ''
    ))
  );
  IF (v_result->'zeilen'->0->'gruende')::text NOT LIKE '%nicht bestätigt%' THEN
    RAISE EXCEPTION 'Test 8: offene Entscheidung %', v_result->'zeilen';
  END IF;
  v_result := public.tageswerk_preview_historical_import(
    (SELECT v FROM test_ctx WHERE k = 'facility'),
    jsonb_build_array(pg_temp.payload('tw-hist-decline', 'April 26', 'C7', '1,2345', '2026-04-12', '09:00:00'))
  );
  IF (v_result->'zeilen'->0->'gruende')::text NOT LIKE '%Nachkommastellen%' THEN
    RAISE EXCEPTION 'Test 8: Nachkommastellen %', v_result->'zeilen';
  END IF;
  v_result := public.tageswerk_preview_historical_import(
    (SELECT v FROM test_ctx WHERE k = 'facility'),
    jsonb_build_array(pg_temp.payload(
      'tw-hist-decline', 'April 26', 'C6', '1100', '2026-04-12', '09:00:00',
      'bestaetigt', NULL, 'vormittag', false, false
    ))
  );
  IF (v_result->'zeilen'->0->'gruende')::text NOT LIKE '%Uhrzeit%' THEN
    RAISE EXCEPTION 'Test 8: unbestätigte Uhrzeit %', v_result->'zeilen';
  END IF;
  SELECT count(*) INTO v_count FROM public.utility_meter_import_batches;
  IF v_count <> v_before THEN
    RAISE EXCEPTION 'Test 8: eine Vorschau hat geschrieben';
  END IF;

  BEGIN
    PERFORM public.tageswerk_commit_historical_import(
      (SELECT v FROM test_ctx WHERE k = 'facility'),
      v_token_decline,
      v_hash_decline,
      'ruecklauf.xlsx',
      jsonb_build_array(
        pg_temp.payload('tw-hist-decline', 'April 26', 'C4', '1100', '2026-04-10', '09:00:00'),
        pg_temp.payload('tw-hist-decline', 'April 26', 'C5', '900', '2026-04-20', '21:00:00', 'bestaetigt', NULL, 'abend')
      )
    );
    RAISE EXCEPTION 'Test 8: der rückläufige Import wurde gespeichert';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%rückläufig%' OR SQLERRM NOT LIKE '%nichts geschrieben%' THEN
        RAISE EXCEPTION 'Test 8: %', SQLERRM;
      END IF;
  END;
  SELECT count(*) INTO v_count
  FROM public.utility_meter_readings
  WHERE meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_decline');
  IF v_count <> 2 OR EXISTS (
    SELECT 1
    FROM public.utility_meter_import_batches
    WHERE inhalt_sha256 = v_hash_decline
       OR client_token = v_token_decline
  ) THEN
    RAISE EXCEPTION 'Test 8: der abgebrochene Import hat Daten hinterlassen';
  END IF;

  WITH created AS (
    INSERT INTO public.utility_meters (facility_id, medium, unit, label, meter_number)
    SELECT v, 'electricity', 'kWh', 'Import deaktiviert', v_number_inactive
    FROM test_ctx WHERE k = 'facility'
    RETURNING id
  )
  INSERT INTO test_ctx (k, v) SELECT 'meter_inactive', id FROM created;
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 500, timestamptz '2025-05-01 08:00+00'
  FROM test_ctx WHERE k = 'meter_inactive';
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'regular', 800, timestamptz '2025-05-20 08:00+00'
  FROM test_ctx WHERE k = 'meter_inactive';
  UPDATE public.utility_meters
  SET is_active = false
  WHERE id = (SELECT v FROM test_ctx WHERE k = 'meter_inactive');
  SELECT is_active INTO v_active
  FROM public.utility_meters
  WHERE id = (SELECT v FROM test_ctx WHERE k = 'meter_inactive');
  IF v_active IS NOT FALSE THEN
    RAISE EXCEPTION 'Test 9: der Zähler ist noch aktiv';
  END IF;

  BEGIN
    INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
    SELECT v, 'regular', 600, (date '2025-05-10' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
    FROM test_ctx WHERE k = 'meter_inactive';
    RAISE EXCEPTION 'Test 9: direkte Ablesung auf deaktiviertem Zähler';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Für einen deaktivierten Zähler wird keine neue Ablesung erfasst%' THEN
        RAISE EXCEPTION 'Test 9: %', SQLERRM;
      END IF;
  END;
  PERFORM set_config('tageswerk.historical_import_batch', 'kein-uuid', true);
  BEGIN
    INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
    SELECT v, 'regular', 600, (date '2025-05-10' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
    FROM test_ctx WHERE k = 'meter_inactive';
    RAISE EXCEPTION 'Test 9: ungültige Importvariable hat eine Ablesung erlaubt';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Für einen deaktivierten Zähler wird keine neue Ablesung erfasst%' THEN
        RAISE EXCEPTION 'Test 9: %', SQLERRM;
      END IF;
  END;
  PERFORM set_config('tageswerk.historical_import_batch', gen_random_uuid()::text, true);
  BEGIN
    INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
    SELECT v, 'regular', 600, (date '2025-05-10' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
    FROM test_ctx WHERE k = 'meter_inactive';
    RAISE EXCEPTION 'Test 9: eine gesetzte Importvariable hat eine Ablesung erlaubt';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Für einen deaktivierten Zähler wird keine neue Ablesung erfasst%' THEN
        RAISE EXCEPTION 'Test 9: %', SQLERRM;
      END IF;
  END;
  PERFORM set_config('tageswerk.historical_import_batch', '', true);

  INSERT INTO public.utility_meter_import_mappings (
    facility_id, excel_schluessel, excel_bezeichnung, excel_verbrauchsart, excel_einheit, meter_id
  )
  SELECT v, 'tw-hist-inactive', 'Strom alt', 'Strom', 'kWh', (SELECT v FROM test_ctx WHERE k = 'meter_inactive')
  FROM test_ctx WHERE k = 'facility';

  BEGIN
    WITH created AS (
      INSERT INTO public.utility_meter_import_batches (
        facility_id, client_token, inhalt_sha256, dateiname, status
      )
      SELECT v, gen_random_uuid(), repeat('a9', 32), 'umgehung-wert.xlsx', 'offen'
      FROM test_ctx WHERE k = 'facility'
      RETURNING id
    )
    INSERT INTO public.utility_meter_import_readings (
      batch_id, meter_id, excel_schluessel, datensatz_id, quelle_blatt, quelle_zelle,
      original_zaehlerstand, uebernommener_wert, entscheidung, ablesedatum, ablesezeitraum,
      uhrzeit_angenommen, bestaetigte_uhrzeit, ablesezeit_bestaetigt
    )
    SELECT created.id, meter.v, 'tw-hist-inactive', 'Mai 25!C9', 'Mai 25', 'C9',
           '650', 650, 'bestaetigt', date '2025-05-10', 'vormittag',
           false, time '09:00:00',
           (date '2025-05-10' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
    FROM created
    CROSS JOIN test_ctx meter
    WHERE meter.k = 'meter_inactive';
    PERFORM set_config(
      'tageswerk.historical_import_batch',
      (SELECT id::text FROM public.utility_meter_import_batches WHERE inhalt_sha256 = repeat('a9', 32)),
      true
    );
    INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
    SELECT v, 'regular', 600, (date '2025-05-10' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
    FROM test_ctx WHERE k = 'meter_inactive';
    RAISE EXCEPTION 'Test 9: ein abweichender Herkunftswert hat die Ablesung erlaubt';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Für einen deaktivierten Zähler wird keine neue Ablesung erfasst%' THEN
        RAISE EXCEPTION 'Test 9: %', SQLERRM;
      END IF;
  END;

  BEGIN
    WITH created AS (
      INSERT INTO public.utility_meter_import_batches (
        facility_id, client_token, inhalt_sha256, dateiname, status
      )
      SELECT v, gen_random_uuid(), repeat('b9', 32), 'umgehung-spaeter.xlsx', 'offen'
      FROM test_ctx WHERE k = 'facility'
      RETURNING id
    )
    INSERT INTO public.utility_meter_import_readings (
      batch_id, meter_id, excel_schluessel, datensatz_id, quelle_blatt, quelle_zelle,
      original_zaehlerstand, uebernommener_wert, entscheidung, ablesedatum, ablesezeitraum,
      uhrzeit_angenommen, bestaetigte_uhrzeit, ablesezeit_bestaetigt
    )
    SELECT created.id, meter.v, 'tw-hist-inactive', 'Mai 25!C7', 'Mai 25', 'C7',
           '900', 900, 'bestaetigt', date '2025-05-25', 'vormittag',
           false, time '09:00:00',
           (date '2025-05-25' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
    FROM created
    CROSS JOIN test_ctx meter
    WHERE meter.k = 'meter_inactive';
    PERFORM set_config(
      'tageswerk.historical_import_batch',
      (SELECT id::text FROM public.utility_meter_import_batches WHERE inhalt_sha256 = repeat('b9', 32)),
      true
    );
    INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
    SELECT v, 'regular', 900, (date '2025-05-25' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
    FROM test_ctx WHERE k = 'meter_inactive';
    RAISE EXCEPTION 'Test 9: eine Herkunft nach dem letzten Stand hat die Ablesung erlaubt';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Für einen deaktivierten Zähler wird keine neue Ablesung erfasst%' THEN
        RAISE EXCEPTION 'Test 9: %', SQLERRM;
      END IF;
  END;

  BEGIN
    WITH created AS (
      INSERT INTO public.utility_meter_import_batches (
        facility_id, client_token, inhalt_sha256, dateiname, status
      )
      SELECT v, gen_random_uuid(), repeat('c9', 32), 'umgehung-passend.xlsx', 'offen'
      FROM test_ctx WHERE k = 'facility'
      RETURNING id
    )
    INSERT INTO public.utility_meter_import_readings (
      batch_id, meter_id, excel_schluessel, datensatz_id, quelle_blatt, quelle_zelle,
      original_zaehlerstand, uebernommener_wert, entscheidung, ablesedatum, ablesezeitraum,
      uhrzeit_angenommen, bestaetigte_uhrzeit, ablesezeit_bestaetigt
    )
    SELECT created.id, meter.v, 'tw-hist-inactive', 'Mai 25!C6', 'Mai 25', 'C6',
           '600', 600, 'bestaetigt', date '2025-05-10', 'vormittag',
           false, time '09:00:00',
           (date '2025-05-10' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
    FROM created
    CROSS JOIN test_ctx meter
    WHERE meter.k = 'meter_inactive';
    PERFORM set_config(
      'tageswerk.historical_import_batch',
      (SELECT id::text FROM public.utility_meter_import_batches WHERE inhalt_sha256 = repeat('c9', 32)),
      true
    );
    INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
    SELECT v, 'regular', 600, (date '2025-05-10' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
    FROM test_ctx WHERE k = 'meter_inactive';
    RAISE EXCEPTION 'Test 9: passende Herkunft wurde zugelassen';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Für einen deaktivierten Zähler wird keine neue Ablesung erfasst%' THEN
        RAISE EXCEPTION 'Test 9: %', SQLERRM;
      END IF;
  END;

  BEGIN
    PERFORM public.tageswerk_issue_historical_permit(
      gen_random_uuid(), gen_random_uuid(), 1, pg_catalog.now()
    );
    RAISE EXCEPTION 'Test 9: die Ausstellfunktion war aufrufbar';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.tageswerk_consume_historical_permit(
      gen_random_uuid(), 1, pg_catalog.now()
    );
    RAISE EXCEPTION 'Test 9: die Verbrauchfunktion war aufrufbar';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    INSERT INTO public.utility_meter_import_permits (
      batch_id, meter_id, reading_value, reading_at
    ) VALUES (
      gen_random_uuid(), gen_random_uuid(), 1, pg_catalog.now()
    );
    RAISE EXCEPTION 'Test 9: die Freigabetabelle war beschreibbar';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  RESET ROLE;
  INSERT INTO public.utility_meter_import_batches (
    facility_id, client_token, inhalt_sha256, dateiname, status
  )
  SELECT v, gen_random_uuid(), repeat('d9', 32), 'freigabe-direkt.xlsx', 'offen'
  FROM test_ctx WHERE k = 'facility';
  INSERT INTO public.utility_meter_import_permits (
    batch_id, meter_id, reading_value, reading_at
  )
  SELECT batch.id,
         meter.v,
         600,
         (date '2025-05-10' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
  FROM public.utility_meter_import_batches AS batch
  CROSS JOIN test_ctx AS meter
  WHERE batch.inhalt_sha256 = repeat('d9', 32)
    AND meter.k = 'meter_inactive';
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user((SELECT v FROM test_ctx WHERE k = 'manager'));
  BEGIN
    INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
    SELECT v, 'regular', 600, (date '2025-05-10' + time '09:00:00') AT TIME ZONE 'Europe/Berlin'
    FROM test_ctx WHERE k = 'meter_inactive';
    RAISE EXCEPTION 'Test 9: eine vorhandene Freigabe hat den direkten INSERT erlaubt';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Für einen deaktivierten Zähler wird keine neue Ablesung erfasst%' THEN
        RAISE EXCEPTION 'Test 9: %', SQLERRM;
      END IF;
  END;
  RESET ROLE;
  IF NOT EXISTS (
    SELECT 1
    FROM public.utility_meter_import_permits AS permit
    JOIN public.utility_meter_import_batches AS batch
      ON batch.id = permit.batch_id
    WHERE batch.inhalt_sha256 = repeat('d9', 32)
  ) THEN
    RAISE EXCEPTION 'Test 9: der direkte INSERT hat die Freigabe verbraucht';
  END IF;
  DELETE FROM public.utility_meter_import_permits AS permit
  USING public.utility_meter_import_batches AS batch
  WHERE permit.batch_id = batch.id
    AND batch.inhalt_sha256 = repeat('d9', 32);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user((SELECT v FROM test_ctx WHERE k = 'manager'));
  PERFORM set_config('tageswerk.historical_import_batch', '', true);
  SELECT count(*) INTO v_count
  FROM public.utility_meter_readings
  WHERE meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_inactive');
  IF v_count <> 2 OR EXISTS (
    SELECT 1
    FROM public.utility_meter_import_batches
    WHERE inhalt_sha256 IN (repeat('a9', 32), repeat('b9', 32), repeat('c9', 32))
  ) THEN
    RAISE EXCEPTION 'Test 9: eine Umgehungsprobe hat Daten hinterlassen';
  END IF;

  PERFORM public.tageswerk_commit_historical_import(
    (SELECT v FROM test_ctx WHERE k = 'facility'),
    v_token_inactive,
    v_hash_inactive,
    'deaktiviert.xlsx',
    jsonb_build_array(pg_temp.payload('tw-hist-inactive', 'Mai 25', 'C4', '600', '2025-05-10', '09:00:00'))
  );
  SELECT is_active INTO v_active
  FROM public.utility_meters
  WHERE id = (SELECT v FROM test_ctx WHERE k = 'meter_inactive');
  SELECT reading.reading_at INTO v_at
  FROM public.utility_meter_readings reading
  WHERE reading.meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_inactive')
    AND reading.reading_value = 600;
  IF v_active IS NOT FALSE
     OR v_at IS DISTINCT FROM ((date '2025-05-10' + time '09:00:00') AT TIME ZONE 'Europe/Berlin') THEN
    RAISE EXCEPTION 'Test 9: deaktivierter Import % um %', v_active, v_at;
  END IF;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.utility_meter_import_permits) THEN
    RAISE EXCEPTION 'Test 9: der deaktivierte Import hat eine Freigabe hinterlassen';
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user((SELECT v FROM test_ctx WHERE k = 'manager'));

  BEGIN
    PERFORM public.tageswerk_commit_historical_import(
      (SELECT v FROM test_ctx WHERE k = 'facility'),
      v_token_late,
      v_hash_late,
      'deaktiviert-spaeter.xlsx',
      jsonb_build_array(pg_temp.payload('tw-hist-inactive', 'Mai 25', 'C8', '900', '2025-05-25', '09:00:00'))
    );
    RAISE EXCEPTION 'Test 9: eine Ablesung nach dem letzten Stand wurde gespeichert';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%letzten vorhandenen Stand%' OR SQLERRM NOT LIKE '%nichts geschrieben%' THEN
        RAISE EXCEPTION 'Test 9: %', SQLERRM;
      END IF;
  END;
  SELECT count(*) INTO v_count
  FROM public.utility_meter_readings
  WHERE meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_inactive')
    AND voided_at IS NULL
    AND reading_type <> 'correction';
  IF v_count <> 3 OR EXISTS (
    SELECT 1 FROM public.utility_meter_import_batches WHERE inhalt_sha256 = v_hash_late
  ) THEN
    RAISE EXCEPTION 'Test 9: der zu späte Import hat den Bestand verändert';
  END IF;

  WITH created AS (
    INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
    SELECT v, 'regular', 1500, timestamptz '2026-02-15 08:00+00'
    FROM test_ctx WHERE k = 'meter_valid'
    RETURNING id
  )
  INSERT INTO test_ctx (k, v) SELECT 'reading_follow', id FROM created;
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, corrects_reading_id)
  SELECT reading.meter_id, 'correction', 1510, reading.id
  FROM public.utility_meter_readings reading
  WHERE reading.id = (SELECT v FROM test_ctx WHERE k = 'reading_follow');
  SELECT reading_value INTO v_value
  FROM public.utility_meter_readings
  WHERE id = (SELECT v FROM test_ctx WHERE k = 'reading_follow');
  SELECT effective_value INTO v_consumption
  FROM public.utility_meter_consumption
  WHERE reading_id = (SELECT v FROM test_ctx WHERE k = 'reading_follow');
  IF v_value IS DISTINCT FROM 1500 OR v_consumption IS DISTINCT FROM 1510 THEN
    RAISE EXCEPTION 'Test 10: Korrektur geändert % wirksam %', v_value, v_consumption;
  END IF;
  INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value, reading_at)
  SELECT v, 'reset', 0, timestamptz '2026-02-20 08:00+00'
  FROM test_ctx WHERE k = 'meter_valid';
  IF NOT EXISTS (
    SELECT 1
    FROM public.utility_meter_readings
    WHERE meter_id = (SELECT v FROM test_ctx WHERE k = 'meter_valid')
      AND reading_type = 'reset'
      AND reading_value = 0
      AND voided_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Test 10: die Rücksetzung fehlt';
  END IF;

  RAISE NOTICE 'Alle Tests für den historischen Zählerimport sind bestanden.';
END;
$tests$;

ROLLBACK;
