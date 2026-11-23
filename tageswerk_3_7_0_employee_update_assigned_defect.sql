-- Tageswerk 3.7.0: Mitarbeiter-Mängelbearbeitung.
-- Nur TEST ausführen (gamvnzggcrrlnyoknllu). Nicht auf PROD.
-- Legt employee_update_assigned_defect an, wenn sie fehlt.
-- Keine 3.4-Techniker-Migration, keine RLS-Änderung, kein Archiv.

BEGIN;

DO $guard$
DECLARE
  existing regprocedure;
  definition text;
BEGIN
  IF to_regclass('public.defects') IS NULL THEN
    RAISE EXCEPTION 'Tabelle public.defects fehlt.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'defects' AND column_name = 'change_note'
  ) THEN
    RAISE EXCEPTION 'Spalte defects.change_note fehlt.';
  END IF;

  SELECT p.oid::regprocedure INTO existing
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'employee_update_assigned_defect';

  IF existing IS NOT NULL THEN
    definition := regexp_replace(pg_catalog.pg_get_functiondef(existing), '[[:space:]]+', ' ', 'g');
    IF existing::text NOT LIKE '%employee_update_assigned_defect(uuid,text,text)%'
       OR position('SECURITY DEFINER' IN definition) = 0
       OR position('Anmeldung erforderlich' IN definition) = 0
       OR position('Mitarbeiter koennen nur bearbeiten oder Erledigung melden' IN definition) = 0
       OR position('Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich' IN definition) = 0
       OR position('assigned_to IS DISTINCT FROM auth.uid()' IN definition) = 0
       OR position('Dieser Mangel ist dir nicht zugewiesen' IN definition) = 0
       OR position('FOR UPDATE' IN definition) = 0
       OR position('UPDATE public.defects SET status=p_status, change_note=' IN definition) = 0
       OR position('SET assigned_to' IN definition) > 0
       OR position('SET facility_id' IN definition) > 0
       OR position('SET organization_id' IN definition) > 0
       OR position('SET priority' IN definition) > 0 THEN
      RAISE EXCEPTION 'employee_update_assigned_defect entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
    END IF;
    RAISE NOTICE 'employee_update_assigned_defect ist bereits die geprüfte Fassung.';
    RETURN;
  END IF;

  EXECUTE $create$
    CREATE FUNCTION public.employee_update_assigned_defect(p_defect_id uuid, p_status text, p_note text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO ''
    AS $function$
    DECLARE d public.defects%ROWTYPE;
    BEGIN
      IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Anmeldung erforderlich'; END IF;
      IF p_status IS NULL OR p_status NOT IN ('in_progress','pending_review') THEN
        RAISE EXCEPTION 'Mitarbeiter koennen nur bearbeiten oder Erledigung melden';
      END IF;
      IF p_note IS NULL OR length(btrim(p_note)) < 3 OR length(p_note) > 2000 THEN
        RAISE EXCEPTION 'Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich';
      END IF;
      SELECT * INTO d FROM public.defects WHERE id=p_defect_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Mangel nicht gefunden'; END IF;
      IF d.assigned_to IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Dieser Mangel ist dir nicht zugewiesen';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id=auth.uid() AND m.is_active = true AND m.organization_id=d.organization_id
        AND (m.role='company_admin' OR m.facility_id=d.facility_id)
      ) THEN RAISE EXCEPTION 'Keine Betriebsberechtigung'; END IF;
      IF d.status IN ('resolved','pending_review') THEN
        RAISE EXCEPTION 'Vorgang ist bereits abgeschlossen oder wartet auf Freigabe';
      END IF;
      UPDATE public.defects SET status=p_status, change_note=btrim(p_note)
      WHERE id=p_defect_id;
    END;
    $function$
  $create$;
END;
$guard$;

REVOKE ALL ON FUNCTION public.employee_update_assigned_defect(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_update_assigned_defect(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
