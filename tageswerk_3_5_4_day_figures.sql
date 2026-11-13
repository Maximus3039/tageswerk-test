-- Tageswerk 3.5.4, Tageskennzahlen
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: public.tageswerk_meter_role, public.tageswerk_facility_organization
-- und public.tageswerk_bind_operation_facility.
-- Textberichte in public.daily_reports bleiben unverändert.
-- Techniker behalten diesen Textzugriff und erhalten keinen Zugriff auf Kennzahlen.
-- Die Funktionen laufen mit Eigentümerrechten, weil Mitarbeiter die Tabelle nicht lesen dürfen.
-- Sie prüfen die Mitgliedschaft selbst und geben Mitarbeitern keine Umsatzbeträge zurück.
-- Der zusammengesetzte Fremdschlüssel nutzt die vorhandene Eindeutigkeit
-- facilities (id, organization_id), wie in den Migrationen 2.9.
-- Die interne Summenfunktion liegt in tageswerk_private und ist über PostgREST nicht erreichbar.

BEGIN;

CREATE SCHEMA IF NOT EXISTS tageswerk_private;
REVOKE ALL ON SCHEMA tageswerk_private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.facility_day_figures (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  service_day date NOT NULL,
  visitors integer,
  gate_cents bigint,
  bistro_cents bigint,
  total_cents bigint,
  source text NOT NULL DEFAULT 'erfassung',
  imported_at timestamptz,
  imported_by uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT facility_day_figures_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id),
  CONSTRAINT facility_day_figures_one_per_day UNIQUE (facility_id, service_day),
  CONSTRAINT facility_day_figures_visitors CHECK (visitors IS NULL OR visitors >= 0),
  CONSTRAINT facility_day_figures_gate CHECK (gate_cents IS NULL OR gate_cents >= 0),
  CONSTRAINT facility_day_figures_bistro CHECK (bistro_cents IS NULL OR bistro_cents >= 0),
  CONSTRAINT facility_day_figures_total CHECK (total_cents IS NULL OR total_cents >= 0),
  CONSTRAINT facility_day_figures_source CHECK (source IN ('erfassung', 'import')),
  CONSTRAINT facility_day_figures_parts CHECK (
    (gate_cents IS NULL AND bistro_cents IS NULL)
    OR (gate_cents IS NOT NULL AND bistro_cents IS NOT NULL AND total_cents = gate_cents + bistro_cents)
  ),
  CONSTRAINT facility_day_figures_present CHECK (visitors IS NOT NULL OR total_cents IS NOT NULL)
);

CREATE INDEX facility_day_figures_facility_day ON public.facility_day_figures (facility_id, service_day DESC);

CREATE TABLE public.facility_day_figure_revisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  figure_id uuid NOT NULL REFERENCES public.facility_day_figures (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  service_day date NOT NULL,
  old_visitors integer,
  new_visitors integer,
  old_gate_cents bigint,
  new_gate_cents bigint,
  old_bistro_cents bigint,
  new_bistro_cents bigint,
  old_total_cents bigint,
  new_total_cents bigint,
  editor_id uuid NOT NULL DEFAULT auth.uid(),
  edited_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  change_note text NOT NULL,
  CONSTRAINT facility_day_figure_revisions_note CHECK (pg_catalog.char_length(pg_catalog.btrim(change_note)) >= 3),
  CONSTRAINT facility_day_figure_revisions_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id)
);

CREATE OR REPLACE FUNCTION public.tageswerk_guard_day_figure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.facility_id IS DISTINCT FROM OLD.facility_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.imported_at IS DISTINCT FROM OLD.imported_at
       OR NEW.imported_by IS DISTINCT FROM OLD.imported_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.service_day IS DISTINCT FROM OLD.service_day
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Betrieb, Organisation und Herkunft eines Kennzahlentages bleiben unveränderlich.';
    END IF;
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_audit_day_figure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  note text := pg_catalog.btrim(pg_catalog.coalesce(pg_catalog.current_setting('tageswerk.figure_note', true), ''));
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

CREATE TRIGGER facility_day_figures_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.facility_day_figures
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();

CREATE TRIGGER facility_day_figures_guard
  BEFORE UPDATE ON public.facility_day_figures
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_guard_day_figure();

CREATE TRIGGER facility_day_figures_audit
  BEFORE UPDATE OF visitors, gate_cents, bistro_cents, total_cents ON public.facility_day_figures
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_audit_day_figure();

ALTER TABLE public.facility_day_figures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_day_figures FORCE ROW LEVEL SECURITY;
ALTER TABLE public.facility_day_figure_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_day_figure_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY facility_day_figures_select ON public.facility_day_figures FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IN ('facility_manager', 'company_admin'));
CREATE POLICY facility_day_figures_insert ON public.facility_day_figures FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.tageswerk_meter_role(organization_id, facility_id) IN ('facility_manager', 'company_admin'));
CREATE POLICY facility_day_figures_update ON public.facility_day_figures FOR UPDATE TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IN ('facility_manager', 'company_admin'))
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IN ('facility_manager', 'company_admin'));

CREATE POLICY facility_day_figure_revisions_select ON public.facility_day_figure_revisions FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IN ('facility_manager', 'company_admin'));

CREATE OR REPLACE FUNCTION public.tageswerk_figure_role(p_facility_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  organization uuid;
  role text;
BEGIN
  organization := public.tageswerk_facility_organization(p_facility_id);
  IF organization IS NULL THEN
    RETURN NULL;
  END IF;
  -- Eigene Auswahl: tageswerk_meter_role bevorzugt technician vor employee.
  -- Eine zusätzliche Mitarbeitermitgliedschaft behält den Kennzahlenzugriff.
  -- Eine reine Technikermitgliedschaft bleibt hier ohne Rolle.
  SELECT m.role INTO role
  FROM public.memberships m
  WHERE m.user_id = auth.uid()
    AND m.is_active IS TRUE
    AND m.organization_id = organization
    AND m.role IN ('employee', 'facility_manager', 'company_admin')
    AND (
      (m.role = 'company_admin' AND m.facility_id IS NULL)
      OR (m.role IN ('facility_manager', 'employee') AND m.facility_id = p_facility_id)
    )
  ORDER BY CASE m.role
    WHEN 'company_admin' THEN 1
    WHEN 'facility_manager' THEN 2
    ELSE 3
  END
  LIMIT 1;
  RETURN role;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_figure_change(p_current numeric, p_prior numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $tageswerk$
DECLARE
  difference numeric := p_current - p_prior;
  negative boolean := difference < 0;
  numerator numeric;
  denominator numeric;
  quotient numeric;
  remainder numeric;
  absolute_tenths numeric;
  tone text;
  label text;
BEGIN
  IF p_current IS NULL OR p_prior IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('state', 'missing', 'label', 'Keine Vergleichsdaten', 'tone', 'flat');
  END IF;
  IF p_prior = 0 THEN
    RETURN pg_catalog.jsonb_build_object('state', 'undefined', 'label', 'Nicht berechenbar', 'tone', 'flat');
  END IF;
  -- Dieselbe Rundung wie figurePercent: eine Nachkommastelle, ab genau 5 weg von null.
  numerator := pg_catalog.abs(difference) * 1000;
  denominator := pg_catalog.abs(p_prior);
  quotient := pg_catalog.trunc(numerator / denominator);
  remainder := numerator - (quotient * denominator);
  IF remainder * 2 >= denominator THEN
    quotient := quotient + 1;
  END IF;
  IF negative THEN
    quotient := -quotient;
  END IF;
  absolute_tenths := pg_catalog.abs(quotient);
  tone := CASE WHEN quotient > 0 THEN 'up' WHEN quotient < 0 THEN 'down' ELSE 'flat' END;
  label := CASE WHEN quotient > 0 THEN '+' WHEN quotient < 0 THEN '-' ELSE '' END
    || pg_catalog.trunc(absolute_tenths / 10)::text
    || ','
    || (absolute_tenths - pg_catalog.trunc(absolute_tenths / 10) * 10)::text
    || ' %';
  RETURN pg_catalog.jsonb_build_object('state', 'value', 'label', label, 'tone', tone);
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
  next_source text := pg_catalog.coalesce(p_source, 'erfassung');
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
  PERFORM pg_catalog.set_config('tageswerk.figure_note', pg_catalog.coalesce(p_change_note, ''), true);
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
    last_day := pg_catalog.least(pg_catalog.coalesce(p_to, berlin), berlin);
    first_day := pg_catalog.greatest(pg_catalog.coalesce(p_from, last_day - 30), last_day - 399);
  END IF;
  day := first_day;
  WHILE day <= last_day LOOP
    dow := pg_catalog.date_part('isodow', day)::integer;
    weekend := CASE dow WHEN 6 THEN 'saturday' WHEN 7 THEN 'sunday' ELSE '' END;
    IF role = 'employee' OR pg_catalog.coalesce(p_weekday, 'all') = 'all' OR p_weekday = weekend THEN
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

-- Interne Summenfunktion: nicht in public, damit PostgREST sie nicht anbietet.
CREATE OR REPLACE FUNCTION tageswerk_private.figure_measure(
  p_facility_id uuid,
  p_start date,
  p_end date,
  p_prior_start date,
  p_prior_end date,
  p_metric text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  day date;
  missing integer := 0;
  current_sum numeric := 0;
  prior_sum numeric := 0;
  amount numeric;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_prior_start IS NULL OR p_prior_end IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('state', 'missing', 'label', 'Keine Vergleichsdaten', 'tone', 'flat');
  END IF;
  day := p_start;
  WHILE day <= p_end LOOP
    amount := NULL;
    SELECT CASE p_metric WHEN 'visitors' THEN visitors WHEN 'gate' THEN gate_cents WHEN 'bistro' THEN bistro_cents ELSE total_cents END
      INTO amount FROM public.facility_day_figures WHERE facility_id = p_facility_id AND service_day = day;
    IF amount IS NULL THEN missing := missing + 1; ELSE current_sum := current_sum + amount; END IF;
    day := day + 1;
  END LOOP;
  day := p_prior_start;
  WHILE day <= p_prior_end LOOP
    amount := NULL;
    SELECT CASE p_metric WHEN 'visitors' THEN visitors WHEN 'gate' THEN gate_cents WHEN 'bistro' THEN bistro_cents ELSE total_cents END
      INTO amount FROM public.facility_day_figures WHERE facility_id = p_facility_id AND service_day = day;
    IF amount IS NULL THEN missing := missing + 1; ELSE prior_sum := prior_sum + amount; END IF;
    day := day + 1;
  END LOOP;
  IF missing > 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'state', 'incomplete',
      'missing', missing,
      'label', CASE WHEN missing = 1 THEN 'Es fehlen Daten für 1 Tag.' ELSE 'Es fehlen Daten für ' || missing::text || ' Tage.' END
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object('state', 'complete', 'change', public.tageswerk_figure_change(current_sum, prior_sum))
    || pg_catalog.jsonb_build_object('current', current_sum, 'prior', prior_sum);
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_day_figure_period(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  role text;
  berlin date := (pg_catalog.timezone('Europe/Berlin', pg_catalog.now()))::date;
  anchor date;
  prior_anchor date;
  month_start date;
  prior_month_start date;
  year_start date;
  prior_year_start date;
  visitors jsonb;
  total jsonb;
  manager boolean;
BEGIN
  role := public.tageswerk_figure_role(p_facility_id);
  IF role IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für die Tageskennzahlen.';
  END IF;
  manager := role IN ('facility_manager', 'company_admin');
  SELECT pg_catalog.max(service_day) INTO anchor
  FROM public.facility_day_figures
  WHERE facility_id = p_facility_id AND service_day <= berlin;
  IF anchor IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('access', CASE WHEN manager THEN 'manager' ELSE 'employee' END, 'anchor', NULL);
  END IF;
  prior_anchor := (anchor - interval '1 year')::date;
  IF pg_catalog.date_part('month', prior_anchor) IS DISTINCT FROM pg_catalog.date_part('month', anchor)
     OR pg_catalog.date_part('day', prior_anchor) IS DISTINCT FROM pg_catalog.date_part('day', anchor) THEN
    prior_anchor := NULL;
  END IF;
  month_start := pg_catalog.date_trunc('month', anchor)::date;
  year_start := pg_catalog.date_trunc('year', anchor)::date;
  prior_month_start := CASE WHEN prior_anchor IS NULL THEN NULL ELSE pg_catalog.date_trunc('month', prior_anchor)::date END;
  prior_year_start := CASE WHEN prior_anchor IS NULL THEN NULL ELSE pg_catalog.date_trunc('year', prior_anchor)::date END;
  visitors := tageswerk_private.figure_measure(p_facility_id, month_start, anchor, prior_month_start, prior_anchor, 'visitors');
  total := tageswerk_private.figure_measure(p_facility_id, month_start, anchor, prior_month_start, prior_anchor, 'total');
  IF NOT manager THEN
    visitors := visitors - 'current' - 'prior';
    total := total - 'current' - 'prior';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'access', CASE WHEN manager THEN 'manager' ELSE 'employee' END,
    'anchor', anchor,
    'month', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'visitors', visitors,
      'total', total,
      'gate', CASE WHEN manager THEN tageswerk_private.figure_measure(p_facility_id, month_start, anchor, prior_month_start, prior_anchor, 'gate') ELSE NULL END,
      'bistro', CASE WHEN manager THEN tageswerk_private.figure_measure(p_facility_id, month_start, anchor, prior_month_start, prior_anchor, 'bistro') ELSE NULL END
    )),
    'year', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'visitors', CASE
        WHEN manager THEN tageswerk_private.figure_measure(p_facility_id, year_start, anchor, prior_year_start, prior_anchor, 'visitors')
        ELSE tageswerk_private.figure_measure(p_facility_id, year_start, anchor, prior_year_start, prior_anchor, 'visitors') - 'current' - 'prior'
      END,
      'total', CASE
        WHEN manager THEN tageswerk_private.figure_measure(p_facility_id, year_start, anchor, prior_year_start, prior_anchor, 'total')
        ELSE tageswerk_private.figure_measure(p_facility_id, year_start, anchor, prior_year_start, prior_anchor, 'total') - 'current' - 'prior'
      END,
      'gate', CASE WHEN manager THEN tageswerk_private.figure_measure(p_facility_id, year_start, anchor, prior_year_start, prior_anchor, 'gate') ELSE NULL END,
      'bistro', CASE WHEN manager THEN tageswerk_private.figure_measure(p_facility_id, year_start, anchor, prior_year_start, prior_anchor, 'bistro') ELSE NULL END
    ))
  );
END;
$tageswerk$;

REVOKE ALL ON TABLE public.facility_day_figures FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.facility_day_figure_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.facility_day_figures TO authenticated;
GRANT UPDATE (visitors, gate_cents, bistro_cents, total_cents) ON TABLE public.facility_day_figures TO authenticated;
GRANT SELECT ON TABLE public.facility_day_figure_revisions TO authenticated;

REVOKE ALL ON FUNCTION public.tageswerk_guard_day_figure() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_audit_day_figure() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_figure_role(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_figure_change(numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_save_day_figures(uuid, date, integer, bigint, bigint, bigint, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_day_figure_overview(uuid, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tageswerk_private.figure_measure(uuid, date, date, date, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_day_figure_period(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_save_day_figures(uuid, date, integer, bigint, bigint, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_day_figure_overview(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_day_figure_period(uuid) TO authenticated;

COMMIT;
