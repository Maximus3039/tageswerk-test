-- Tageswerk 3.6.3, transaktionaler Besucher-/Umsatzimport.
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- p_rows: [{day, visitors, total_cents, action}] action = insert|update|skip
-- Ruft ausschließlich public.tageswerk_save_day_figures. Bei Fehler wird alles zurückgerollt.

BEGIN;

CREATE TABLE IF NOT EXISTS public.facility_day_figure_imports (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  organization_id uuid NOT NULL,
  imported_by uuid NOT NULL DEFAULT auth.uid(),
  imported_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  file_name text NOT NULL,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT facility_day_figure_imports_name CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 300),
  CONSTRAINT facility_day_figure_imports_counts CHECK (
    inserted_count >= 0 AND updated_count >= 0 AND skipped_count >= 0 AND error_count >= 0
  )
);

ALTER TABLE public.facility_day_figure_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_day_figure_imports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_day_figure_imports_select ON public.facility_day_figure_imports;
DROP POLICY IF EXISTS facility_day_figure_imports_insert ON public.facility_day_figure_imports;

CREATE POLICY facility_day_figure_imports_select ON public.facility_day_figure_imports
  FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'));

CREATE POLICY facility_day_figure_imports_insert ON public.facility_day_figure_imports
  FOR INSERT TO authenticated
  WITH CHECK (
    imported_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager')
  );

REVOKE ALL ON TABLE public.facility_day_figure_imports FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.facility_day_figure_imports TO authenticated;

CREATE OR REPLACE FUNCTION public.tageswerk_import_day_figures(
  p_facility_id uuid,
  p_file_name text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org uuid;
  v_role text;
  v_item jsonb;
  v_action text;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Anmeldung erforderlich';
  END IF;
  IF pg_catalog.char_length(pg_catalog.btrim(p_file_name)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'Bitte einen Dateinamen angeben.';
  END IF;
  IF p_rows IS NULL OR pg_catalog.jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Ungueltige Importzeilen.';
  END IF;
  IF pg_catalog.jsonb_array_length(p_rows) > 800 THEN
    RAISE EXCEPTION 'Mehr als 800 Zeilen werden in einem Vorgang nicht übernommen.';
  END IF;
  SELECT organization_id INTO v_org FROM public.facilities WHERE id = p_facility_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Betrieb nicht gefunden';
  END IF;
  v_role := public.tageswerk_figure_role(p_facility_id);
  IF v_role NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Keine Berechtigung für den historischen Import.';
  END IF;
  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_rows)
  LOOP
    v_action := COALESCE(v_item->>'action', 'insert');
    IF v_action = 'skip' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    IF v_action NOT IN ('insert', 'update') THEN
      RAISE EXCEPTION 'Unzulaessige Importaktion.';
    END IF;
    PERFORM public.tageswerk_save_day_figures(
      p_facility_id,
      (v_item->>'day')::date,
      NULLIF(v_item->>'visitors', '')::integer,
      NULL,
      NULL,
      NULLIF(v_item->>'total_cents', '')::bigint,
      CASE WHEN v_action = 'update' THEN COALESCE(NULLIF(pg_catalog.btrim(v_item->>'note'), ''), 'Historischer Import aktualisiert') ELSE COALESCE(NULLIF(pg_catalog.btrim(v_item->>'note'), ''), 'Historischer Import') END,
      'import'
    );
    IF v_action = 'update' THEN
      v_updated := v_updated + 1;
    ELSE
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;
  INSERT INTO public.facility_day_figure_imports (
    facility_id, organization_id, imported_by, file_name,
    inserted_count, updated_count, skipped_count, error_count, details
  ) VALUES (
    p_facility_id, v_org, auth.uid(), pg_catalog.btrim(p_file_name),
    v_inserted, v_updated, v_skipped, 0,
    pg_catalog.jsonb_build_object('rows', pg_catalog.jsonb_array_length(p_rows))
  ) RETURNING id INTO v_id;
  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'id', v_id,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.tageswerk_import_day_figures(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_import_day_figures(uuid, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
