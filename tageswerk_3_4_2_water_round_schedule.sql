-- Tageswerk 3.4.2, mehrere Wasserhygiene-Kontrollrunden pro Tag
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: die Wasserhygiene und die korrigierte Abschlussfunktion sind installiert.
-- Diese Datei ändert keine bestehende Tabelle, keine bestehende Funktion,
-- keine bestehende Richtlinie und keinen bestehenden Schutztrigger.
-- tageswerk_record_water_round bleibt unverändert und wird nur aufgerufen.
-- Die Zuordnung entsteht in derselben Transaktion nach dem erfolgreichen Abschluss.
-- Schlägt die Zuordnung fehl, nimmt die Transaktion auch die neuen Messungen zurück.
-- Ein Termin gilt erst als abgeschlossen, wenn diese Zuordnung gespeichert ist.
-- Verworfene Entwürfe schreiben keine Zuordnung und blockieren keinen Termin.
-- Neue und geänderte Kontrollzeiten gelten ab dem nächsten Kalendertag in Europe/Berlin.
-- Der laufende Tag und bereits gespeicherte Zuordnungen bleiben unverändert.
-- Eine wiederholte identische Speicheranfrage bestätigt nur eine vorhandene Zuordnung.
-- Eine bereits gespeicherte Runde wird nicht nachträglich einem anderen Termin zugeordnet.
-- Eine geplante Runde muss alle aktiven Becken enthalten.
-- Eine Zusatzkontrolle erfasst mindestens ein aktives Becken, auch eine Auswahl.
-- Der Eigentümer der Sperrfunktion muss derselbe sein wie bei den bestehenden
-- SECURITY-DEFINER-Funktionen der Wasserhygiene.

BEGIN;

CREATE TABLE public.water_facility_slots (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  slot_time text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  effective_on date NOT NULL DEFAULT ((pg_catalog.now() AT TIME ZONE 'Europe/Berlin')::date + 1),
  retired_on date,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT water_facility_slots_time CHECK (slot_time ~ '^\d{2}:\d{2}$'),
  CONSTRAINT water_facility_slots_period CHECK (retired_on IS NULL OR retired_on > effective_on)
);

CREATE UNIQUE INDEX water_facility_slots_active_time
  ON public.water_facility_slots (facility_id, slot_time)
  WHERE active IS TRUE;

CREATE TABLE public.water_round_slots (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  round_id uuid NOT NULL,
  slot_id uuid REFERENCES public.water_facility_slots (id),
  kind text NOT NULL,
  slot_time text NOT NULL DEFAULT '',
  service_day date NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT water_round_slots_kind CHECK (
    (kind = 'planned' AND slot_id IS NOT NULL AND slot_time ~ '^\d{2}:\d{2}$')
    OR (kind = 'extra' AND slot_id IS NULL AND slot_time = '')
  )
);

CREATE UNIQUE INDEX water_round_slots_round
  ON public.water_round_slots (round_id);
CREATE UNIQUE INDEX water_round_slots_one_planned
  ON public.water_round_slots (facility_id, slot_id, service_day)
  WHERE kind = 'planned';

CREATE OR REPLACE FUNCTION public.tageswerk_lock_water_facility_plan(p_facility_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $tageswerk$
BEGIN
  IF p_facility_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('tageswerk-water-facility-plan:' || p_facility_id::text, 0::bigint)
    );
  END IF;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_water_round_covers_active_pools(
  p_round_id uuid,
  p_facility_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
  SELECT p_round_id IS NOT NULL
    AND p_facility_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.water_pools AS pool
      WHERE pool.facility_id = p_facility_id
        AND pool.active IS TRUE
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.water_pools AS pool
      WHERE pool.facility_id = p_facility_id
        AND pool.active IS TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM public.water_checks AS check_row
          WHERE check_row.round_id = p_round_id
            AND check_row.pool_id = pool.id
            AND check_row.facility_id = p_facility_id
            AND check_row.recorded_by = auth.uid()
            AND check_row.xmin = pg_catalog.pg_current_xact_id()::xid
        )
    );
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_guard_water_facility_slot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  hour integer;
  minute integer;
  active_count integer;
  today date;
  tomorrow date;
BEGIN
  today := (pg_catalog.now() AT TIME ZONE 'Europe/Berlin')::date;
  tomorrow := today + 1;
  PERFORM public.tageswerk_lock_water_facility_plan(NEW.facility_id);
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Die Zuordnung eines Kontrolltermins bleibt unverändert.';
  END IF;
  IF NEW.slot_time !~ '^\d{2}:\d{2}$' THEN
    RAISE EXCEPTION 'Bitte eine Uhrzeit im Format HH:MM eintragen.';
  END IF;
  hour := split_part(NEW.slot_time, ':', 1)::integer;
  minute := split_part(NEW.slot_time, ':', 2)::integer;
  IF hour > 23 OR minute > 59 THEN
    RAISE EXCEPTION 'Bitte eine Uhrzeit im Format HH:MM eintragen.';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.effective_on <= today THEN
    RAISE EXCEPTION 'Eine neue Kontrollzeit gilt ab dem nächsten Tag.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.effective_on <= today AND (
    NEW.slot_time IS DISTINCT FROM OLD.slot_time
    OR NEW.effective_on IS DISTINCT FROM OLD.effective_on
  ) THEN
    RAISE EXCEPTION 'Eine laufende Kontrollzeit bleibt bis zum nächsten Tag unverändert.';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.effective_on <= today
     AND (OLD.retired_on IS NULL OR OLD.retired_on > today)
     AND (
       NEW.active IS DISTINCT FROM TRUE
       OR (NEW.retired_on IS NOT NULL AND NEW.retired_on <= today)
     ) THEN
    RAISE EXCEPTION 'Eine laufende Kontrollzeit bleibt bis zum nächsten Tag unverändert.';
  END IF;
  IF NEW.active IS TRUE
     AND NEW.effective_on <= tomorrow
     AND (NEW.retired_on IS NULL OR NEW.retired_on > tomorrow) THEN
    SELECT count(*)
      INTO active_count
    FROM public.water_facility_slots AS slot
    WHERE slot.facility_id = NEW.facility_id
      AND slot.id IS DISTINCT FROM NEW.id
      AND slot.active IS TRUE
      AND slot.effective_on <= tomorrow
      AND (slot.retired_on IS NULL OR slot.retired_on > tomorrow);
    IF active_count >= 6 THEN
      RAISE EXCEPTION 'Ein Betrieb hat höchstens sechs tägliche Kontrollzeiten.';
    END IF;
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_stamp_water_round_slot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  planned text;
BEGIN
  NEW.user_id := auth.uid();
  NEW.service_day := (pg_catalog.now() AT TIME ZONE 'Europe/Berlin')::date;
  IF NEW.slot_id IS NULL THEN
    NEW.kind := 'extra';
    NEW.slot_time := '';
    RETURN NEW;
  END IF;
  SELECT slot.slot_time
    INTO planned
  FROM public.water_facility_slots AS slot
  WHERE slot.id = NEW.slot_id
    AND slot.facility_id = NEW.facility_id
    AND slot.active IS TRUE
    AND slot.effective_on <= NEW.service_day
    AND (slot.retired_on IS NULL OR slot.retired_on > NEW.service_day);
  IF planned IS NULL THEN
    RAISE EXCEPTION 'Der Termin gehört nicht zu diesem Betrieb.';
  END IF;
  NEW.kind := 'planned';
  NEW.slot_time := planned;
  RETURN NEW;
END;
$tageswerk$;

CREATE TRIGGER water_facility_slots_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.water_facility_slots
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER water_facility_slots_guard
  BEFORE INSERT OR UPDATE ON public.water_facility_slots
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_guard_water_facility_slot();
CREATE TRIGGER water_round_slots_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.water_round_slots
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER water_round_slots_stamp
  BEFORE INSERT ON public.water_round_slots
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_stamp_water_round_slot();

ALTER TABLE public.water_facility_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_facility_slots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.water_round_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_round_slots FORCE ROW LEVEL SECURITY;

CREATE POLICY water_facility_slots_select ON public.water_facility_slots
  FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY water_facility_slots_insert ON public.water_facility_slots
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IN ('facility_manager', 'company_admin')
  );
CREATE POLICY water_facility_slots_update ON public.water_facility_slots
  FOR UPDATE TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IN ('facility_manager', 'company_admin'))
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IN ('facility_manager', 'company_admin'));

CREATE POLICY water_round_slots_select ON public.water_round_slots
  FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY water_round_slots_insert ON public.water_round_slots
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND public.tageswerk_water_round_checks_in_transaction(round_id, facility_id)
    AND service_day = (pg_catalog.now() AT TIME ZONE 'Europe/Berlin')::date
    AND (
      (kind = 'extra' AND slot_id IS NULL)
      OR (
        kind = 'planned'
        AND public.tageswerk_water_round_covers_active_pools(round_id, facility_id)
        AND EXISTS (
          SELECT 1
          FROM public.water_facility_slots AS slot
          WHERE slot.id = water_round_slots.slot_id
            AND slot.facility_id = water_round_slots.facility_id
            AND slot.active IS TRUE
            AND slot.slot_time = water_round_slots.slot_time
            AND slot.effective_on <= water_round_slots.service_day
            AND (slot.retired_on IS NULL OR slot.retired_on > water_round_slots.service_day)
        )
      )
    )
  );

REVOKE ALL ON TABLE public.water_facility_slots FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_round_slots FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.water_facility_slots TO authenticated;
GRANT SELECT, INSERT ON TABLE public.water_round_slots TO authenticated;

CREATE OR REPLACE FUNCTION public.tageswerk_claim_water_round_slot(
  p_facility_id uuid,
  p_slot_id uuid,
  p_round_id uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  slot_facility uuid;
  slot_time text;
  slot_effective date;
  slot_retired date;
  existing_round uuid;
  today date;
BEGIN
  IF auth.uid() IS NULL OR p_facility_id IS NULL OR p_round_id IS NULL THEN
    RAISE EXCEPTION 'Die Kontrollrunde ist unvollständig.';
  END IF;
  IF public.tageswerk_meter_role(public.tageswerk_facility_organization(p_facility_id), p_facility_id) IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Betrieb.';
  END IF;
  IF p_slot_id IS NULL THEN
    SELECT link.round_id
      INTO existing_round
    FROM public.water_round_slots AS link
    WHERE link.round_id = p_round_id
      AND link.facility_id = p_facility_id
      AND link.kind = 'extra'
      AND link.slot_id IS NULL;
    IF existing_round = p_round_id THEN
      RETURN 'already';
    END IF;
    RETURN '';
  END IF;
  today := (pg_catalog.now() AT TIME ZONE 'Europe/Berlin')::date;
  SELECT slot.facility_id, slot.slot_time, slot.effective_on, slot.retired_on
    INTO slot_facility, slot_time, slot_effective, slot_retired
  FROM public.water_facility_slots AS slot
  WHERE slot.id = p_slot_id
    AND slot.active IS TRUE
  FOR UPDATE;
  IF slot_facility IS NULL OR slot_facility IS DISTINCT FROM p_facility_id OR slot_time IS NULL THEN
    RAISE EXCEPTION 'Der Termin gehört nicht zu diesem Betrieb.';
  END IF;
  IF slot_effective > today OR (slot_retired IS NOT NULL AND slot_retired <= today) THEN
    RAISE EXCEPTION 'Dieser Termin gilt an diesem Tag nicht.';
  END IF;
  SELECT link.round_id
    INTO existing_round
  FROM public.water_round_slots AS link
  WHERE link.facility_id = p_facility_id
    AND link.slot_id = p_slot_id
    AND link.service_day = today
    AND link.kind = 'planned';
  IF existing_round IS NOT NULL AND existing_round IS DISTINCT FROM p_round_id THEN
    RAISE EXCEPTION 'Dieser Termin wurde bereits abgeschlossen.';
  END IF;
  IF existing_round = p_round_id THEN
    RETURN 'already';
  END IF;
  RETURN slot_time;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_record_scheduled_water_round(
  p_round_id uuid,
  p_checks jsonb,
  p_slot_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  result jsonb;
  facility uuid;
  claimed text;
  active_pools integer;
  supplied_pools integer;
BEGIN
  IF p_round_id IS NULL
     OR pg_catalog.jsonb_typeof(p_checks) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_checks) < 1 THEN
    RAISE EXCEPTION 'Die Kontrollrunde ist unvollständig.';
  END IF;
  facility := (p_checks->0->>'facility_id')::uuid;
  SELECT count(*)
    INTO active_pools
  FROM public.water_pools AS pool
  WHERE pool.facility_id = facility
    AND pool.active IS TRUE;
  SELECT count(DISTINCT (item->>'pool_id')::uuid)
    INTO supplied_pools
  FROM pg_catalog.jsonb_array_elements(p_checks) AS item
  WHERE (item->>'facility_id')::uuid = facility
    AND EXISTS (
      SELECT 1
      FROM public.water_pools AS pool
      WHERE pool.id = (item->>'pool_id')::uuid
        AND pool.facility_id = facility
        AND pool.active IS TRUE
    );
  IF active_pools < 1
     OR supplied_pools < 1
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements(p_checks) AS item
       WHERE (item->>'facility_id')::uuid IS DISTINCT FROM facility
          OR NOT EXISTS (
            SELECT 1
            FROM public.water_pools AS pool
            WHERE pool.id = (item->>'pool_id')::uuid
              AND pool.facility_id = facility
              AND pool.active IS TRUE
          )
     ) THEN
    RAISE EXCEPTION 'Die Kontrollrunde umfasst nicht alle aktiven Becken.';
  END IF;
  IF p_slot_id IS NOT NULL AND active_pools IS DISTINCT FROM supplied_pools THEN
    RAISE EXCEPTION 'Die Kontrollrunde umfasst nicht alle aktiven Becken.';
  END IF;
  claimed := public.tageswerk_claim_water_round_slot(facility, p_slot_id, p_round_id);
  result := public.tageswerk_record_water_round(p_round_id, p_checks);
  IF pg_catalog.jsonb_typeof(result) IS DISTINCT FROM 'object'
     OR (result->>'round_id')::uuid IS DISTINCT FROM p_round_id THEN
    RETURN result;
  END IF;
  IF result->>'status' = 'already_stored' THEN
    IF claimed = 'already' THEN
      RETURN result;
    END IF;
    RAISE EXCEPTION 'Diese Kontrollrunde ist bereits gespeichert und kann diesem Termin nicht zugeordnet werden.';
  END IF;
  IF result->>'status' IS DISTINCT FROM 'stored' THEN
    RETURN result;
  END IF;
  IF claimed = 'already' THEN
    RAISE EXCEPTION 'Diese Kontrollrunde ist bereits einem Termin zugeordnet.';
  END IF;
  IF p_slot_id IS NOT NULL AND public.tageswerk_water_round_covers_active_pools(p_round_id, facility) IS NOT TRUE THEN
    RAISE EXCEPTION 'Die Kontrollrunde umfasst nicht alle aktiven Becken.';
  END IF;
  INSERT INTO public.water_round_slots (facility_id, round_id, slot_id, kind, slot_time)
  VALUES (
    facility,
    p_round_id,
    p_slot_id,
    CASE WHEN p_slot_id IS NULL THEN 'extra' ELSE 'planned' END,
    CASE WHEN p_slot_id IS NULL THEN '' ELSE claimed END
  );
  RETURN result;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_save_water_facility_slots(
  p_facility_id uuid,
  p_times text[]
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  entry text;
  hour integer;
  minute integer;
  existing uuid;
  today date;
  tomorrow date;
BEGIN
  IF p_facility_id IS NULL OR p_times IS NULL OR cardinality(p_times) > 6 THEN
    RAISE EXCEPTION 'Bitte höchstens sechs Kontrollzeiten eintragen.';
  END IF;
  IF public.tageswerk_meter_role(public.tageswerk_facility_organization(p_facility_id), p_facility_id)
     NOT IN ('facility_manager', 'company_admin') THEN
    RAISE EXCEPTION 'Kontrollzeiten legt die Betriebsleitung oder Geschäftsführung fest.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_times) AS item GROUP BY item HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Jede Kontrollzeit wird nur einmal eingetragen.';
  END IF;
  FOREACH entry IN ARRAY p_times LOOP
    IF entry !~ '^\d{2}:\d{2}$' THEN
      RAISE EXCEPTION 'Bitte eine Uhrzeit im Format HH:MM eintragen.';
    END IF;
    hour := split_part(entry, ':', 1)::integer;
    minute := split_part(entry, ':', 2)::integer;
    IF hour > 23 OR minute > 59 THEN
      RAISE EXCEPTION 'Bitte eine Uhrzeit im Format HH:MM eintragen.';
    END IF;
  END LOOP;
  today := (pg_catalog.now() AT TIME ZONE 'Europe/Berlin')::date;
  tomorrow := today + 1;
  PERFORM public.tageswerk_lock_water_facility_plan(p_facility_id);
  UPDATE public.water_facility_slots
  SET active = false
  WHERE facility_id = p_facility_id
    AND active IS TRUE
    AND retired_on IS NOT NULL
    AND retired_on <= today;
  UPDATE public.water_facility_slots
  SET retired_on = tomorrow
  WHERE facility_id = p_facility_id
    AND active IS TRUE
    AND effective_on <= today
    AND (retired_on IS NULL OR retired_on > today)
    AND NOT (slot_time = ANY (p_times));
  UPDATE public.water_facility_slots
  SET retired_on = NULL
  WHERE facility_id = p_facility_id
    AND active IS TRUE
    AND effective_on <= today
    AND retired_on > today
    AND slot_time = ANY (p_times);
  UPDATE public.water_facility_slots
  SET active = false
  WHERE facility_id = p_facility_id
    AND active IS TRUE
    AND effective_on > today
    AND NOT (slot_time = ANY (p_times));
  FOREACH entry IN ARRAY p_times LOOP
    existing := NULL;
    SELECT slot.id
      INTO existing
    FROM public.water_facility_slots AS slot
    WHERE slot.facility_id = p_facility_id
      AND slot.slot_time = entry
      AND slot.active IS TRUE
      AND slot.effective_on <= tomorrow
      AND (slot.retired_on IS NULL OR slot.retired_on > tomorrow)
    LIMIT 1;
    IF existing IS NOT NULL THEN
      CONTINUE;
    END IF;
    existing := NULL;
    SELECT slot.id
      INTO existing
    FROM public.water_facility_slots AS slot
    WHERE slot.facility_id = p_facility_id
      AND slot.slot_time = entry
      AND slot.active IS TRUE
      AND slot.effective_on > today
    ORDER BY slot.effective_on
    LIMIT 1;
    IF existing IS NOT NULL THEN
      UPDATE public.water_facility_slots
      SET active = true, effective_on = tomorrow, retired_on = NULL
      WHERE id = existing;
      CONTINUE;
    END IF;
    UPDATE public.water_facility_slots
    SET active = false
    WHERE facility_id = p_facility_id
      AND slot_time = entry
      AND active IS TRUE
      AND effective_on <= today
      AND retired_on IS NOT NULL
      AND retired_on <= today;
    INSERT INTO public.water_facility_slots (facility_id, slot_time, active, effective_on)
    VALUES (p_facility_id, entry, true, tomorrow);
  END LOOP;
END;
$tageswerk$;

REVOKE ALL ON FUNCTION public.tageswerk_lock_water_facility_plan(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_water_round_covers_active_pools(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_guard_water_facility_slot() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_stamp_water_round_slot() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_claim_water_round_slot(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_record_scheduled_water_round(uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_save_water_facility_slots(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_lock_water_facility_plan(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_water_round_covers_active_pools(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_guard_water_facility_slot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_stamp_water_round_slot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_claim_water_round_slot(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_record_scheduled_water_round(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_save_water_facility_slots(uuid, text[]) TO authenticated;

COMMIT;
