-- Tageswerk 3.7.0, Betrieb anlegen nur durch company_admin der Organisation.
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Keine Rollenänderung. Kein INSERT für authenticated auf facilities.

BEGIN;

CREATE OR REPLACE FUNCTION public.tageswerk_create_facility(
  p_organization_id uuid,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.tageswerk_create_facility(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_create_facility(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
