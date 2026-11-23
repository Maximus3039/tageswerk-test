-- Tageswerk 3.7.0 Funktionen. Nur fehlende Objekte.
-- Ersetzt NICHT: tageswerk_prepare_reading, tageswerk_consumption_calendar,
-- tageswerk_commit_historical_import, tageswerk_preview_historical_import,
-- employee_update_assigned_defect, tageswerk_archive_*, tageswerk_set_water_filter_active.
-- Nicht ausführen ohne 01 und 02.

BEGIN;

DO $create_facility$
BEGIN
  IF to_regprocedure('public.tageswerk_create_facility(uuid,text)') IS NOT NULL THEN
    RAISE NOTICE 'tageswerk_create_facility existiert, unverändert.';
    RETURN;
  END IF;
  EXECUTE $fn$
    CREATE FUNCTION public.tageswerk_create_facility(
      p_organization_id uuid,
      p_name text
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      v_name text;
      v_id uuid;
    BEGIN
      IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Anmeldung erforderlich';
      END IF;
      v_name := pg_catalog.btrim(p_name);
      IF pg_catalog.char_length(v_name) NOT BETWEEN 2 AND 120 THEN
        RAISE EXCEPTION 'Bitte einen Betriebsnamen zwischen 2 und 120 Zeichen angeben.';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.memberships AS membership
        WHERE membership.user_id = auth.uid()
          AND membership.organization_id = p_organization_id
          AND membership.role = 'company_admin'
          AND membership.facility_id IS NULL
          AND membership.is_active = true
      ) THEN
        RAISE EXCEPTION 'Nur die Geschäftsführung legt neue Betriebe der eigenen Organisation an.';
      END IF;
      INSERT INTO public.facilities (name, organization_id)
      VALUES (v_name, p_organization_id)
      RETURNING id INTO v_id;
      RETURN pg_catalog.jsonb_build_object('ok', true, 'id', v_id, 'name', v_name, 'organization_id', p_organization_id);
    END;
    $body$;
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.tageswerk_create_facility(uuid, text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.tageswerk_create_facility(uuid, text) TO authenticated';
END;
$create_facility$;

DO $monthly_fns$
BEGIN
  IF to_regclass('public.utility_monthly_consumption') IS NULL THEN
    RAISE EXCEPTION 'utility_monthly_consumption fehlt. Zuerst 02_schema.sql.';
  END IF;

  IF to_regprocedure('public.tageswerk_prepare_monthly_consumption()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.tageswerk_prepare_monthly_consumption()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = ''
      AS $body$
      DECLARE
        v_org uuid;
        v_role text;
        v_medium text;
        v_unit text;
        v_facility uuid;
      BEGIN
        IF TG_OP = 'UPDATE' AND (
          NEW.facility_id IS DISTINCT FROM OLD.facility_id
          OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
          OR NEW.medium IS DISTINCT FROM OLD.medium
          OR NEW.unit IS DISTINCT FROM OLD.unit
          OR NEW.meter_id IS DISTINCT FROM OLD.meter_id
          OR NEW.year IS DISTINCT FROM OLD.year
          OR NEW.month IS DISTINCT FROM OLD.month
        ) THEN
          RAISE EXCEPTION 'Bestehende Monatsverbräuche werden nicht auf einen anderen Zeitraum oder Zähler verschoben.';
        END IF;
        v_org := public.tageswerk_facility_organization(NEW.facility_id);
        IF v_org IS NULL THEN
          RAISE EXCEPTION 'Der Betrieb ist unbekannt.';
        END IF;
        NEW.organization_id := v_org;
        v_role := public.tageswerk_meter_role(NEW.organization_id, NEW.facility_id);
        IF v_role IS NULL OR v_role NOT IN ('company_admin', 'facility_manager') THEN
          RAISE EXCEPTION 'Historische Monatsverbräuche darf die Betriebsleitung oder Geschäftsführung.';
        END IF;
        IF NEW.meter_id IS NOT NULL THEN
          SELECT meter.facility_id, meter.medium, meter.unit
            INTO v_facility, v_medium, v_unit
          FROM public.utility_meters meter
          WHERE meter.id = NEW.meter_id;
          IF v_facility IS NULL THEN
            RAISE EXCEPTION 'Der Zähler ist unbekannt.';
          END IF;
          IF v_facility IS DISTINCT FROM NEW.facility_id THEN
            RAISE EXCEPTION 'Der Zähler gehört nicht zu diesem Betrieb.';
          END IF;
          IF v_medium IS DISTINCT FROM NEW.medium OR v_unit IS DISTINCT FROM NEW.unit THEN
            RAISE EXCEPTION 'Verbrauchsart und Einheit müssen zum Zähler passen.';
          END IF;
        END IF;
        IF TG_OP = 'INSERT' THEN
          NEW.recorded_by := auth.uid();
          NEW.corrected_by := NULL;
          NEW.correction_reason := NULL;
          NEW.created_at := pg_catalog.now();
          NEW.updated_at := NEW.created_at;
          RETURN NEW;
        END IF;
        NEW.recorded_by := OLD.recorded_by;
        NEW.created_at := OLD.created_at;
        IF NEW.consumption_value IS NOT DISTINCT FROM OLD.consumption_value
           AND NEW.note IS NOT DISTINCT FROM OLD.note THEN
          RAISE EXCEPTION 'Die Korrektur muss Verbrauch oder Kommentar ändern.';
        END IF;
        IF NEW.correction_reason IS NULL OR char_length(btrim(NEW.correction_reason)) < 3 THEN
          RAISE EXCEPTION 'Bitte einen Korrekturgrund mit mindestens 3 Zeichen angeben.';
        END IF;
        NEW.corrected_by := auth.uid();
        NEW.updated_at := pg_catalog.now();
        RETURN NEW;
      END;
      $body$;
    $fn$;
  ELSE
    RAISE NOTICE 'tageswerk_prepare_monthly_consumption existiert, unverändert.';
  END IF;

  IF to_regprocedure('public.tageswerk_reject_monthly_consumption_delete()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.tageswerk_reject_monthly_consumption_delete()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = ''
      AS $body$
      BEGIN
        RAISE EXCEPTION 'Manuelle Monatsverbräuche werden nicht gelöscht.';
      END;
      $body$;
    $fn$;
  END IF;

  IF to_regprocedure('public.tageswerk_record_monthly_consumption_revision()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.tageswerk_record_monthly_consumption_revision()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = ''
      AS $body$
      BEGIN
        INSERT INTO public.utility_monthly_consumption_revisions (
          consumption_id, organization_id, facility_id,
          previous_value, previous_note, new_value, new_note,
          correction_reason, changed_by, changed_at
        ) VALUES (
          NEW.id, NEW.organization_id, NEW.facility_id,
          OLD.consumption_value, OLD.note, NEW.consumption_value, NEW.note,
          NEW.correction_reason, NEW.corrected_by, NEW.updated_at
        );
        RETURN NEW;
      END;
      $body$;
    $fn$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.utility_monthly_consumption'::regclass
      AND tgname = 'utility_monthly_consumption_prepare'
  ) THEN
    CREATE TRIGGER utility_monthly_consumption_prepare
      BEFORE INSERT OR UPDATE ON public.utility_monthly_consumption
      FOR EACH ROW EXECUTE FUNCTION public.tageswerk_prepare_monthly_consumption();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.utility_monthly_consumption'::regclass
      AND tgname = 'utility_monthly_consumption_bind_facility'
  ) THEN
    CREATE TRIGGER utility_monthly_consumption_bind_facility
      BEFORE INSERT OR UPDATE OF facility_id ON public.utility_monthly_consumption
      FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.utility_monthly_consumption'::regclass
      AND tgname = 'utility_monthly_consumption_no_delete'
  ) THEN
    CREATE TRIGGER utility_monthly_consumption_no_delete
      BEFORE DELETE ON public.utility_monthly_consumption
      FOR EACH ROW EXECUTE FUNCTION public.tageswerk_reject_monthly_consumption_delete();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.utility_monthly_consumption'::regclass
      AND tgname = 'utility_monthly_consumption_revision'
  ) THEN
    CREATE TRIGGER utility_monthly_consumption_revision
      AFTER UPDATE ON public.utility_monthly_consumption
      FOR EACH ROW EXECUTE FUNCTION public.tageswerk_record_monthly_consumption_revision();
  END IF;
END;
$monthly_fns$;

NOTIFY pgrst, 'reload schema';

COMMIT;
