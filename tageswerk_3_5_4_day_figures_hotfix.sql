-- Tageswerk 3.5.4, Hotfix COALESCE in den Kennzahlenfunktionen
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Die Migration 3.5.4 ist bereits installiert und darf nicht erneut laufen.
-- Dieser Hotfix ersetzt nur CREATE OR REPLACE FUNCTION für die betroffenen Körper.
-- Tabellen, Policies, Trigger und Rechte bleiben unverändert.
-- Ursache: COALESCE ist ein SQL-Spezialausdruck und darf nicht über
-- den Schema-Pfad pg_catalog qualifiziert werden. Dasselbe gilt für LEAST und GREATEST.

BEGIN;

CREATE OR REPLACE FUNCTION public.tageswerk_audit_day_figure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  note text := pg_catalog.btrim(COALESCE(pg_catalog.current_setting('tageswerk.figure_note', true), ''));
BEGIN
  IF NEW.visitors IS NOT DISTINCT FROM OLD.visitors
     AND NEW.gate_cents IS NOT DISTINCT FROM OLD.gate_cents
     AND NEW.bistro_cents IS NOT DISTINCT FROM OLD.bistro_cents
     AND NEW.total_cents IS NOT DISTINCT FROM OLD.total_cents THEN
    RETURN NEW;
  END IF;
  IF pg_catalog.char_length(note) < 3 THEN
    RAISE EXCEPTION 'Bitte den Grund der Änderung mit mindestens 3 Zeichen eintragen.';
  END IF;
  INSERT INTO public.facility_day_figure_revisions (
    figure_id, organization_id, facility_id, service_day,
    old_visitors, new_visitors, old_gate_cents, new_gate_cents,
    old_bistro_cents, new_bistro_cents, old_total_cents, new_total_cents,
    change_note
  ) VALUES (
    OLD.id, OLD.organization_id, OLD.facility_id, OLD.service_day,
    OLD.visitors, NEW.visitors, OLD.gate_cents, NEW.gate_cents,
    OLD.bistro_cents, NEW.bistro_cents, OLD.total_cents, NEW.total_cents,
    note
  );
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_save_day_figures(
  p_facility_id uuid,
  p_service_day date,
  p_visitors integer,
  p_gate_cents bigint,
  p_bistro_cents bigint,
  p_total_cents bigint,
  p_change_note text,
  p_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  role text;
  berlin date := (pg_catalog.timezone('Europe/Berlin', pg_catalog.now()))::date;
  next_visitors integer := p_visitors;
  next_gate bigint := p_gate_cents;
  next_bistro bigint := p_bistro_cents;
  next_total bigint := p_total_cents;
  next_source text := COALESCE(p_source, 'erfassung');
  existing public.facility_day_figures;
  saved public.facility_day_figures;
BEGIN
  role := public.tageswerk_figure_role(p_facility_id);
  IF role IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für die Tageskennzahlen.';
  END IF;
  IF role = 'employee' AND (p_service_day < berlin - 6 OR p_service_day > berlin) THEN
    RAISE EXCEPTION 'Kennzahlen außerhalb der letzten sieben Tage bleiben der Betriebsleitung vorbehalten.';
  END IF;
  IF next_source NOT IN ('erfassung', 'import') THEN
    RAISE EXCEPTION 'Die Datenquelle ist nicht vorgesehen.';
  END IF;
  IF next_source = 'import' AND role = 'employee' THEN
    RAISE EXCEPTION 'Historische Kennzahlen bleiben der Betriebsleitung und Geschäftsführung vorbehalten.';
  END IF;
  IF next_visitors < 0 OR next_gate < 0 OR next_bistro < 0 OR next_total < 0 THEN
    RAISE EXCEPTION 'Negative Kennzahlen sind nicht zulässig.';
  END IF;
  IF (next_gate IS NULL) <> (next_bistro IS NULL) THEN
    RAISE EXCEPTION 'Ein fehlender Teilumsatz wird nicht ergänzt.';
  END IF;
  IF next_gate IS NOT NULL AND next_bistro IS NOT NULL THEN
    next_total := next_gate + next_bistro;
  ELSIF role = 'employee' THEN
    RAISE EXCEPTION 'Bitte Besucherzahl, Kassenumsatz und Bistroumsatz eintragen.';
  END IF;
  IF role = 'employee' AND (next_visitors IS NULL OR next_gate IS NULL OR next_bistro IS NULL) THEN
    RAISE EXCEPTION 'Bitte Besucherzahl, Kassenumsatz und Bistroumsatz eintragen.';
  END IF;
  IF next_visitors IS NULL AND next_total IS NULL THEN
    RAISE EXCEPTION 'Bitte mindestens Besucherzahl oder Gesamtumsatz eintragen.';
  END IF;
  SELECT * INTO existing
  FROM public.facility_day_figures
  WHERE facility_id = p_facility_id AND service_day = p_service_day;
  PERFORM pg_catalog.set_config('tageswerk.figure_note', COALESCE(p_change_note, ''), true);
  IF existing.id IS NULL THEN
    INSERT INTO public.facility_day_figures (
      facility_id, service_day, visitors, gate_cents, bistro_cents, total_cents, source, imported_at, imported_by
    ) VALUES (
      p_facility_id, p_service_day, next_visitors, next_gate, next_bistro, next_total, next_source,
      CASE WHEN next_source = 'import' THEN pg_catalog.now() ELSE NULL END,
      CASE WHEN next_source = 'import' THEN auth.uid() ELSE NULL END
    )
    RETURNING * INTO saved;
  ELSE
    UPDATE public.facility_day_figures
    SET visitors = next_visitors,
        gate_cents = next_gate,
        bistro_cents = next_bistro,
        total_cents = next_total
    WHERE id = existing.id
    RETURNING * INTO saved;
  END IF;
  RETURN pg_catalog.jsonb_build_object('id', saved.id, 'service_day', saved.service_day, 'total_cents', saved.total_cents);
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_day_figure_overview(
  p_facility_id uuid,
  p_from date,
  p_to date,
  p_weekday text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  role text;
  berlin date := (pg_catalog.timezone('Europe/Berlin', pg_catalog.now()))::date;
  first_day date;
  last_day date;
  rows jsonb := '[]'::jsonb;
  day date;
  current_row public.facility_day_figures;
  prior_row public.facility_day_figures;
  dow integer;
  weekend text;
  entry jsonb;
BEGIN
  role := public.tageswerk_figure_role(p_facility_id);
  IF role IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für die Tageskennzahlen.';
  END IF;
  IF role = 'employee' THEN
    first_day := berlin - 6;
    last_day := berlin;
  ELSE
    last_day := LEAST(COALESCE(p_to, berlin), berlin);
    first_day := GREATEST(COALESCE(p_from, last_day - 30), last_day - 399);
  END IF;
  day := first_day;
  WHILE day <= last_day LOOP
    dow := pg_catalog.date_part('isodow', day)::integer;
    weekend := CASE dow WHEN 6 THEN 'saturday' WHEN 7 THEN 'sunday' ELSE '' END;
    IF role = 'employee' OR COALESCE(p_weekday, 'all') = 'all' OR p_weekday = weekend THEN
      current_row := NULL;
      prior_row := NULL;
      SELECT * INTO current_row FROM public.facility_day_figures WHERE facility_id = p_facility_id AND service_day = day;
      SELECT * INTO prior_row FROM public.facility_day_figures WHERE facility_id = p_facility_id AND service_day = day - 364;
      entry := pg_catalog.jsonb_build_object(
        'day', day,
        'weekday', CASE dow WHEN 1 THEN 'Montag' WHEN 2 THEN 'Dienstag' WHEN 3 THEN 'Mittwoch' WHEN 4 THEN 'Donnerstag' WHEN 5 THEN 'Freitag' WHEN 6 THEN 'Samstag' ELSE 'Sonntag' END,
        'weekend', weekend,
        'compareDay', day - 364,
        'visitors', current_row.visitors,
        'visitorChange', public.tageswerk_figure_change(current_row.visitors, prior_row.visitors)
      );
      IF role IN ('facility_manager', 'company_admin') THEN
        entry := entry || pg_catalog.jsonb_build_object(
          'priorVisitors', prior_row.visitors,
          'gateCents', current_row.gate_cents,
          'bistroCents', current_row.bistro_cents,
          'totalCents', current_row.total_cents,
          'priorTotalCents', prior_row.total_cents,
          'revenueChange', public.tageswerk_figure_change(current_row.total_cents, prior_row.total_cents)
        );
      END IF;
      rows := entry || rows;
    END IF;
    day := day + 1;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('access', CASE WHEN role = 'employee' THEN 'employee' ELSE 'manager' END, 'rows', rows);
END;
$tageswerk$;

COMMIT;
