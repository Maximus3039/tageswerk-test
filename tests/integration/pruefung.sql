-- Berechtigungsprüfung nach den fünf Migrationen. Nur in der bestätigten Testdatenbank.

DO $guard$
BEGIN
  IF current_setting('tageswerk.integration_test', true) IS DISTINCT FROM 'bestaetigt' THEN
    RAISE EXCEPTION 'pruefung.sql läuft nur über tests/integration/run.mjs.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') THEN
    RAISE EXCEPTION 'Diese Testdatenbank wurde schon geprüft. Verwende eine neue leere Instanz.';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.tageswerk_test_expect(p_ok boolean, p_step text)
RETURNS void
LANGUAGE plpgsql
AS $tageswerk$
BEGIN
  IF COALESCE(p_ok, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Integrationstest fehlgeschlagen: %', p_step;
  END IF;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_test_fails(p_sql text)
RETURNS boolean
LANGUAGE plpgsql
AS $tageswerk$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END;
$tageswerk$;

INSERT INTO public.organizations (id, name)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Testorganisation');
INSERT INTO public.facilities (id, organization_id, name) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Bad'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Strand');

DO $users$
DECLARE
  person record;
BEGIN
  FOR person IN
    SELECT * FROM (VALUES
      ('11111111-1111-4111-8111-111111111111'::uuid, 'gf@example.test'),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'leitung@example.test'),
      ('33333333-3333-4333-8333-333333333333'::uuid, 'mia@example.test'),
      ('44444444-4444-4444-8444-444444444444'::uuid, 'timo@example.test'),
      ('55555555-5555-4555-8555-555555555555'::uuid, 'neu.mitarbeiter@example.test'),
      ('66666666-6666-4666-8666-666666666666'::uuid, 'neu.techniker@example.test'),
      ('77777777-7777-4777-8777-777777777777'::uuid, 'bestand@example.test')
    ) AS row(id, email)
  LOOP
    INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (
      person.id, 'authenticated', 'authenticated', person.email, pg_catalog.now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now()
    );
    IF to_regclass('auth.identities') IS NOT NULL THEN
      INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
      VALUES (
        pg_catalog.gen_random_uuid(), person.id,
        pg_catalog.jsonb_build_object('sub', person.id::text, 'email', person.email),
        'email', person.id::text, pg_catalog.now(), pg_catalog.now()
      );
    END IF;
  END LOOP;
END;
$users$;

INSERT INTO public.memberships (user_id, organization_id, facility_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', NULL, 'company_admin'),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'facility_manager'),
  ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'employee'),
  ('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'technician'),
  ('77777777-7777-4777-8777-777777777777', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'employee');

INSERT INTO public.utility_meters (id, organization_id, facility_id, label)
VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Hauptzähler');

SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', false);
SET ROLE authenticated;

INSERT INTO public.temperature_points (id, facility_id, name, location, minimum_celsius, maximum_celsius)
VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Küche', 'Theke', 0, 8);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', false);
SET ROLE authenticated;

INSERT INTO public.temperature_readings (point_id, facility_id, value_celsius)
VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 12.0);

RESET ROLE;
SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 1 FROM public.temperature_alerts WHERE point_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  'Eine Temperatur außerhalb der Grenzen erzeugt eine Warnung'
);

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', false);
SET ROLE authenticated;
SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 1 FROM public.temperature_alerts),
  'Mitarbeiter sieht die Temperaturwarnung des eigenen Betriebs'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.temperature_points (facility_id, name, location, minimum_celsius, maximum_celsius) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Eigen', 'Hof', 0, 8)$$),
  'Mitarbeiter legt keine Temperaturmessstelle an'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', false);
SET ROLE authenticated;
INSERT INTO public.water_pools (id, facility_id, name)
VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Schwimmer'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Plansch');
UPDATE public.water_pool_parameters
SET min_value = 6.80, max_value = 7.60
WHERE parameter_code = 'ph'
  AND pool_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', false);
SET ROLE authenticated;

SELECT public.tageswerk_test_expect(
  (public.tageswerk_save_water_round_draft(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'ffffffff-ffff-4fff-8fff-fffffffffff1',
    '{"note":"unterwegs"}'::jsonb,
    '{"index":0,"phase":"edit"}'::jsonb,
    NULL
  ) ->> 'status') = 'stored',
  'Der Entwurf wird gespeichert'
);
SELECT public.tageswerk_test_expect(
  (public.tageswerk_discard_water_round_draft('ffffffff-ffff-4fff-8fff-fffffffffff1') ->> 'status') = 'discarded',
  'Der eigene Entwurf wird verworfen'
);
SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 0 FROM public.water_checks),
  'Verwerfen schreibt keine Messung'
);
SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 0 FROM public.water_round_drafts WHERE status = 'open' AND round_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'),
  'Ein verworfener Entwurf wird nicht mehr angeboten'
);

SELECT public.tageswerk_test_expect(
  (public.tageswerk_save_water_round_draft(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'ffffffff-ffff-4fff-8fff-fffffffffff2',
    '{}'::jsonb,
    '{"index":1,"phase":"summary"}'::jsonb,
    NULL
  ) ->> 'status') = 'stored',
  'Die Kontrollrunde hat einen offenen Entwurf'
);

SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($sql$
    SELECT public.tageswerk_record_water_round(
      'ffffffff-ffff-4fff-8fff-fffffffffff2',
      jsonb_build_array(jsonb_build_object(
        'pool_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
        'facility_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        'readings', jsonb_build_array(
          jsonb_build_object('parameter_code', 'free_chlorine', 'value', '0.50'),
          jsonb_build_object('parameter_code', 'combined_chlorine', 'value', '0.20'),
          jsonb_build_object('parameter_code', 'ph', 'value', '7.20'),
          jsonb_build_object('parameter_code', 'temperature', 'value', '25.0')
        )
      ), jsonb_build_object(
        'pool_id', '99999999-9999-4999-8999-999999999999',
        'facility_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        'readings', '[]'::jsonb
      ))
    )
  $sql$),
  'Eine unvollständige Kontrollrunde schreibt keine Messung'
);
SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 0 FROM public.water_checks),
  'Die fehlgeschlagene Kontrollrunde ist zurückgenommen'
);

SELECT public.tageswerk_test_expect(
  (public.tageswerk_record_water_round(
    'ffffffff-ffff-4fff-8fff-fffffffffff2',
    jsonb_build_array(
      jsonb_build_object(
        'pool_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
        'facility_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        'readings', jsonb_build_array(
          jsonb_build_object('parameter_code', 'free_chlorine', 'value', '0.50'),
          jsonb_build_object('parameter_code', 'combined_chlorine', 'value', '0.20'),
          jsonb_build_object('parameter_code', 'ph', 'value', '8.50'),
          jsonb_build_object('parameter_code', 'temperature', 'value', '25.0')
        )
      ),
      jsonb_build_object(
        'pool_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
        'facility_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        'readings', jsonb_build_array(
          jsonb_build_object('parameter_code', 'free_chlorine', 'value', '0.40'),
          jsonb_build_object('parameter_code', 'combined_chlorine', 'value', '0.10'),
          jsonb_build_object('parameter_code', 'ph', 'value', '7.20'),
          jsonb_build_object('parameter_code', 'temperature', 'value', '24.0')
        )
      )
    )
  ) ->> 'status') = 'stored',
  'Die Kontrollrunde speichert beide Becken'
);

RESET ROLE;
SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 2 FROM public.water_checks WHERE round_id = 'ffffffff-ffff-4fff-8fff-fffffffffff2'),
  'Beide Becken sind in derselben Runde gespeichert'
);
SELECT public.tageswerk_test_expect(
  (SELECT count(*) >= 1 FROM public.water_alerts),
  'Ein pH-Wert außerhalb der Grenzen erzeugt eine Wasserwarnung'
);
SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 0 FROM public.water_round_drafts WHERE round_id = 'ffffffff-ffff-4fff-8fff-fffffffffff2' AND status = 'open'),
  'Der abgeschlossene Entwurf ist nicht mehr offen'
);

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', false);
SET ROLE authenticated;
SELECT public.tageswerk_test_expect(
  (public.tageswerk_record_water_round(
    'ffffffff-ffff-4fff-8fff-fffffffffff2',
    jsonb_build_array(jsonb_build_object(
      'pool_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      'facility_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'readings', jsonb_build_array(jsonb_build_object('parameter_code', 'ph', 'value', '7.20'))
    ))
  ) ->> 'status') = 'already_stored',
  'Eine wiederholte Kontrollrunde wird erkannt'
);
RESET ROLE;
SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 2 FROM public.water_checks WHERE round_id = 'ffffffff-ffff-4fff-8fff-fffffffffff2'),
  'Die Wiederholung fügt keine Messung hinzu'
);

SELECT set_config('tageswerk.test_check', (SELECT id::text FROM public.water_checks LIMIT 1), false);
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', false);
SET ROLE authenticated;
SELECT public.tageswerk_test_expect((SELECT count(*) = 0 FROM public.water_checks), 'Mitarbeiter liest keine gespeicherten Wasserwerte');
SELECT public.tageswerk_test_expect((SELECT count(*) = 0 FROM public.water_alerts), 'Mitarbeiter liest keine Wasserwarnungen');
SELECT public.tageswerk_test_expect(
  (public.tageswerk_save_water_round_draft(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'ffffffff-ffff-4fff-8fff-fffffffffff3',
    '{}'::jsonb,
    '{"index":0,"phase":"edit"}'::jsonb,
    NULL
  ) ->> 'status') = 'stored',
  'Ein weiterer Entwurf bleibt für den direkten Zugriffsversuch offen'
);
SELECT set_config('tageswerk.water_round_close', 'on', true);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$UPDATE public.water_round_drafts SET status = 'completed', revision = revision + 1 WHERE round_id = 'ffffffff-ffff-4fff-8fff-fffffffffff3'$$),
  'Ein Konfigurationswert schließt den Entwurf nicht'
);
SELECT public.tageswerk_test_expect(
  (SELECT status = 'open' FROM public.water_round_drafts WHERE round_id = 'ffffffff-ffff-4fff-8fff-fffffffffff3'),
  'Der direkt angesprochene Entwurf bleibt offen'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.water_alerts (check_id, pool_id, organization_id, facility_id, parameter_code, value_amount, measured_at, recorded_by) VALUES (current_setting('tageswerk.test_check')::uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'ph', 8, now(), auth.uid())$$),
  'Eine Wasserwarnung entsteht nicht durch einen direkten Tabellenzugriff'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.water_round_discards (round_id, user_id) VALUES ('ffffffff-ffff-4fff-8fff-fffffffffff1', auth.uid())$$),
  'Die Verwerfmarkierung ist nicht direkt beschreibbar'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
SELECT set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', false);
SET ROLE authenticated;
SELECT public.tageswerk_test_expect((SELECT count(*) = 2 FROM public.water_checks), 'Techniker liest die Wasserhistorie des Betriebs');
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.water_pools (facility_id, name) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Eigen')$$),
  'Techniker legt kein Becken an'
);
INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value)
VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'regular', 10);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.utility_meter_readings (meter_id, reading_type, reading_value) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'correction', 9)$$),
  'Techniker erfasst keine Korrektur'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$UPDATE public.utility_meter_readings SET voided_at = now()$$),
  'Techniker storniert keinen Zählerstand'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$SELECT public.manage_facility_membership('mia@example.test', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'facility_manager', false)$$),
  'Techniker verwaltet keine Mitgliedschaft'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', false);
SET ROLE authenticated;
SELECT public.tageswerk_test_expect(
  public.manage_facility_membership('bestand@example.test', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'technician', false) = 'Zuordnung aktualisiert',
  'Betriebsleitung ändert einen Mitarbeiter zum Techniker'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$SELECT public.manage_facility_membership('bestand@example.test', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'facility_manager', false)$$),
  'Betriebsleitung ernennt keine Betriebsleitung'
);
SELECT public.tageswerk_test_expect(
  public.manage_facility_membership('bestand@example.test', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'technician', true) = 'Zuordnung deaktiviert',
  'Betriebsleitung deaktiviert einen Techniker'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$SELECT public.manage_facility_membership('bestand@example.test', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'employee', false)$$),
  'Eine Reaktivierung mit anderer Rolle bleibt verboten'
);
SELECT public.tageswerk_test_expect(
  public.manage_facility_membership('bestand@example.test', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'technician', false) = 'Zuordnung reaktiviert',
  'Dieselbe Rolle wird wieder freigegeben'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$SELECT public.manage_facility_membership('gf@example.test', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'employee', false)$$),
  'Geschäftsführung bleibt geschützt'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT set_config('request.jwt.claims', '', false);
INSERT INTO public.staff_invitations (organization_id, facility_id, email, first_name, last_name, status, role)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'neu.mitarbeiter@example.test', 'Neu', 'Mitarbeiter', 'sent', 'employee'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'neu.techniker@example.test', 'Neu', 'Techniker', 'sent', 'technician'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bestand@example.test', 'Bestand', 'Person', 'sent', 'employee');

SELECT set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', false);
SELECT set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555"}', false);
SET ROLE authenticated;
SELECT public.tageswerk_test_expect((public.accept_staff_invitation() ->> 'success')::boolean, 'Eine Mitarbeitereinladung wird angenommen');
RESET ROLE;
SELECT public.tageswerk_test_expect(
  (SELECT role = 'employee' FROM public.memberships WHERE user_id = '55555555-5555-4555-8555-555555555555'),
  'Die angenommene Mitarbeitereinladung bleibt Mitarbeiter'
);

SELECT set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', false);
SELECT set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666"}', false);
SET ROLE authenticated;
SELECT public.tageswerk_test_expect((public.accept_staff_invitation() ->> 'role') = 'technician', 'Die Technikereinladung übernimmt die gespeicherte Rolle');

SELECT set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', false);
SELECT set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777"}', false);
SELECT public.tageswerk_test_expect((public.accept_staff_invitation() ->> 'success')::boolean, 'Eine Einladung bei bestehender Mitgliedschaft wird angenommen');
RESET ROLE;
SELECT public.tageswerk_test_expect(
  (SELECT role = 'technician' AND is_active IS TRUE FROM public.memberships WHERE user_id = '77777777-7777-4777-8777-777777777777' AND facility_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  'Die bestehende Mitgliedschaft wird nicht überschrieben'
);

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', false);
SET ROLE authenticated;
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$UPDATE public.memberships SET role = 'company_admin'$$),
  'Eine Mitgliedschaft wird nicht direkt angehoben'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.staff_invitations (organization_id, facility_id, email, first_name, last_name, role) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'fremd@example.test', 'Fremd', 'Person', 'company_admin')$$),
  'Eine direkte Einladung kann die Rolle nicht erhöhen'
);

RESET ROLE;
DROP FUNCTION public.tageswerk_test_expect(boolean, text);
DROP FUNCTION public.tageswerk_test_fails(text);
