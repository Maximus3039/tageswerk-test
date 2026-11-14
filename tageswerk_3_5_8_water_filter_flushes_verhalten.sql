-- Verhaltensprüfung für Filterspülungen.
-- NUR in einer bestätigten, leeren Testdatenbank ausführen.
-- Voraussetzung: Wasserhygiene, Technikerrolle und tageswerk_3_5_8_water_filter_flushes.sql.
-- Schreibt ausschließlich in die unten definierten Test-UUIDs.
-- NICHT in der Produktivdatenbank ausführen.

DO $guard$
BEGIN
  IF current_setting('tageswerk.integration_test', true) IS DISTINCT FROM 'bestaetigt' THEN
    RAISE EXCEPTION 'verhalten.sql für Filterspülungen läuft nur mit tageswerk.integration_test=bestaetigt.';
  END IF;
  IF to_regclass('public.water_filters') IS NULL OR to_regclass('public.water_filter_flushes') IS NULL THEN
    RAISE EXCEPTION 'Filterspülungen sind nicht installiert.';
  END IF;
  IF to_regclass('public.water_pools') IS NULL THEN
    RAISE EXCEPTION 'water_pools fehlt.';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.tageswerk_test_expect(p_ok boolean, p_step text)
RETURNS void
LANGUAGE plpgsql
AS $tageswerk$
BEGIN
  IF COALESCE(p_ok, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Filterspülungs-Verhaltenstest fehlgeschlagen: %', p_step;
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

-- Testorganisation und Rollen (eigene UUID-Serie, kollidiert nicht mit pruefung.sql)
INSERT INTO public.organizations (id, name)
VALUES ('a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', 'Filterspül-Testorg');

INSERT INTO public.facilities (id, organization_id, name) VALUES
  ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', 'Filterbad'),
  ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b6', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', 'Filterstrand');

DO $users$
DECLARE
  person record;
BEGIN
  FOR person IN
    SELECT * FROM (VALUES
      ('15151515-1515-4515-8515-151515151515'::uuid, 'gf-filter@example.test'),
      ('25252525-2525-4525-8525-252525252525'::uuid, 'leitung-filter@example.test'),
      ('35353535-3535-4535-8535-353535353535'::uuid, 'mitarbeiter-filter@example.test'),
      ('45454545-4545-4545-8545-454545454545'::uuid, 'techniker-filter@example.test'),
      ('55555555-5555-4555-8555-555555555555'::uuid, 'fremd-filter@example.test')
    ) AS rows(id, email)
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
    INSERT INTO public.profiles (id, full_name)
    VALUES (person.id, person.email);
  END LOOP;
END;
$users$;

INSERT INTO public.memberships (user_id, organization_id, facility_id, role, is_active) VALUES
  ('15151515-1515-4515-8515-151515151515', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', NULL, 'company_admin', true),
  ('25252525-2525-4525-8525-252525252525', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'facility_manager', true),
  ('35353535-3535-4535-8535-353535353535', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'employee', true),
  ('45454545-4545-4545-8545-454545454545', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'technician', true),
  ('55555555-5555-4555-8555-555555555555', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b6', 'employee', true);

SELECT set_config('request.jwt.claim.sub', '25252525-2525-4525-8525-252525252525', false);
SELECT set_config('request.jwt.claims', '{"sub":"25252525-2525-4525-8525-252525252525"}', false);
SET ROLE authenticated;

INSERT INTO public.water_pools (id, facility_id, name)
VALUES ('e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'Erlebnisbecken');

INSERT INTO public.water_filters (id, facility_id, pool_id, name)
VALUES
  ('f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1', 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'Filter 1'),
  ('f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f2', 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'Filter 2');

SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.water_filters (facility_id, pool_id, name) VALUES ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', '  filter 1  ')$$),
  'Aktive Filterbezeichnung je Becken ist ohne Groß-/Kleinschreibung und Leerzeichen eindeutig'
);

SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.water_filters (facility_id, pool_id, name) VALUES ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b6', 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'Fremd')$$),
  'Ungültige Filterzuordnung: Becken und Betrieb müssen zusammenpassen'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '35353535-3535-4535-8535-353535353535', false);
SELECT set_config('request.jwt.claims', '{"sub":"35353535-3535-4535-8535-353535353535"}', false);
SET ROLE authenticated;

SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 2 FROM public.water_filters WHERE active IS TRUE),
  'Mitarbeiter liest aktive Filter'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.water_filters (facility_id, pool_id, name) VALUES ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'Eigen')$$),
  'Mitarbeiter verwaltet keine Filter'
);

INSERT INTO public.water_filter_flushes (facility_id, filter_id, flushed_at, note)
VALUES ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1', now() - interval '2 hours', 'erste Spülung');

SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 0 FROM public.water_filter_flushes),
  'Mitarbeiter liest keine Spülhistorie'
);
SELECT public.tageswerk_test_expect(
  (SELECT last_flushed_by = '35353535-3535-4535-8535-353535353535' FROM public.water_filters WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'),
  'Mitarbeiter sieht die aktualisierte letzte Spülung am Filter'
);

SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.water_filter_flushes (facility_id, filter_id, flushed_at) VALUES ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1', now() + interval '1 hour')$$),
  'Zukünftiger Spülzeitpunkt wird abgelehnt'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.water_filter_flushes (facility_id, filter_id, flushed_at) VALUES ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1', now() - interval '25 hours')$$),
  'Nachtrag außerhalb 24 Stunden wird abgelehnt'
);

INSERT INTO public.water_filter_flushes (facility_id, filter_id, flushed_at, note)
VALUES ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1', now() - interval '30 minutes', 'zweite Spülung');

SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$UPDATE public.water_filter_flushes SET note = 'geaendert' WHERE filter_id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'$$),
  'Spülhistorie ist unveränderlich'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$DELETE FROM public.water_filter_flushes WHERE filter_id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'$$),
  'Spülhistorie ist nicht löschbar'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '45454545-4545-4545-8545-454545454545', false);
SELECT set_config('request.jwt.claims', '{"sub":"45454545-4545-4545-8545-454545454545"}', false);
SET ROLE authenticated;

SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 2 FROM public.water_filter_flushes WHERE filter_id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'),
  'Techniker liest die Spülhistorie'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$UPDATE public.water_filters SET name = 'Hack' WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'$$),
  'Techniker verwaltet keine Filter'
);

INSERT INTO public.water_filter_flushes (facility_id, filter_id, flushed_at, note)
VALUES ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1', now() - interval '23 hours', 'älterer Nachtrag');

SELECT public.tageswerk_test_expect(
  (SELECT last_flushed_at > now() - interval '1 hour' FROM public.water_filters WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'),
  'Ein älterer Nachtrag überschreibt nicht die neuere letzte Spülung'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '25252525-2525-4525-8525-252525252525', false);
SELECT set_config('request.jwt.claims', '{"sub":"25252525-2525-4525-8525-252525252525"}', false);
SET ROLE authenticated;

UPDATE public.water_filters
SET active = false
WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f2';

SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.water_filter_flushes (facility_id, filter_id, flushed_at) VALUES ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f2', now())$$),
  'Deaktivierter Filter nimmt keine Spülung an'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$UPDATE public.water_filters SET last_flushed_at = now(), last_flushed_by = auth.uid() WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'$$),
  'Letzte Spülung darf nicht direkt manipuliert werden'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$DELETE FROM public.water_filters WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f2'$$),
  'Filter werden nicht gelöscht'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', false);
SELECT set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555"}', false);
SET ROLE authenticated;

SELECT public.tageswerk_test_expect(
  (SELECT count(*) = 0 FROM public.water_filters),
  'Mitarbeiter eines anderen Betriebs sieht keine Filter'
);
SELECT public.tageswerk_test_expect(
  public.tageswerk_test_fails($$INSERT INTO public.water_filter_flushes (facility_id, filter_id, flushed_at) VALUES ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1', now())$$),
  'Unberechtigte Spülung für fremden Betrieb wird abgelehnt'
);

RESET ROLE;
SELECT public.tageswerk_test_expect(true, 'Verhaltensprüfung Filterspülungen abgeschlossen');
