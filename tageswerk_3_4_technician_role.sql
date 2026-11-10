-- Tageswerk 3.4, Rolle Techniker
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: die installierte Zähler- und Mitgliedschaftsstruktur aus Tageswerk 2.9.
-- Die Datei ist für einen Lauf vorgesehen. Ein zweiter Lauf lässt die Rolle stehen
-- und setzt keine vorhandenen Mitgliedschaften um.
-- Bestehende Rollen employee, facility_manager und company_admin bleiben erhalten.
-- Techniker sind einem Betrieb zugeordnet und stehen in tageswerk_meter_role
-- neben Mitarbeitern, nicht über der Betriebsleitung.
-- Installationsreihenfolge: tageswerk_3_1_temperature.sql, tageswerk_3_2_temperature_points.sql,
-- tageswerk_3_3_water_hygiene.sql, diese Datei, danach tageswerk_3_4_invitation_role.sql.
-- Diese Datei darf auch vor der Wasserhygiene laufen. Gespeicherte Wassermessungen
-- bleiben für Mitarbeiter unsichtbar. Techniker, Betriebsleitung und Geschäftsführung
-- lesen sie im berechtigten Betrieb.
-- staff_invitations wird hier nicht verändert. Die Rollenspalte, ihr Wächter und die
-- Prüfung der Annahme liegen ausschließlich in tageswerk_3_4_invitation_role.sql.
-- Ist memberships.role ein Enum ohne den Wert technician, ändert diese Datei nichts.
-- Der Wert muss vorher in einer eigenen, bereits festgeschriebenen Anweisung ergänzt werden:
-- ALTER TYPE public.<enum> ADD VALUE 'technician';
-- Eine unbekannte Funktionsfassung setzt die Transaktion zurück.
-- Es werden keine Betriebsdaten verändert und keine Benutzer angelegt.

BEGIN;

DO $enum_gate$
DECLARE
  role_type text;
BEGIN
  SELECT t.typname INTO role_type
  FROM pg_attribute AS attribute
  JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_type AS t ON t.oid = attribute.atttypid
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'memberships'
    AND attribute.attname = 'role'
    AND t.typtype = 'e';
  IF role_type IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum AS label
    JOIN pg_type AS enum_type ON enum_type.oid = label.enumtypid
    WHERE enum_type.typname = role_type
      AND label.enumlabel = 'technician'
  ) THEN
    RAISE EXCEPTION 'memberships.role ist ein Enum ohne den Wert technician. Zuerst getrennt festschreiben: ALTER TYPE public.%s ADD VALUE ''technician''', role_type;
  END IF;
END;
$enum_gate$;

DO $meter_role$
DECLARE
  definition text;
BEGIN
  IF to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_meter_role fehlt und wurde nicht neu erfunden.';
  END IF;
  definition := pg_get_functiondef('public.tageswerk_meter_role(uuid,uuid)'::regprocedure);
  IF position('technician' IN definition) > 0 THEN
    IF position('WHEN ''technician'' THEN 3' IN definition) = 0
       OR position('(m.role = ''employee'' AND m.facility_id = p_facility_id)' IN definition) = 0
       OR position('WHEN ''company_admin'' THEN 1' IN definition) = 0
       OR position('WHEN ''facility_manager'' THEN 2' IN definition) = 0 THEN
      RAISE EXCEPTION 'tageswerk_meter_role enthält Techniker in einer unbekannten Form und wurde nicht ersetzt.';
    END IF;
    RETURN;
  END IF;
  IF position('SECURITY DEFINER' IN definition) = 0
     OR position('m.is_active IS TRUE' IN definition) = 0
     OR position('(m.role = ''company_admin'' AND m.facility_id IS NULL)' IN definition) = 0
     OR position('(m.role = ''facility_manager'' AND m.facility_id = p_facility_id)' IN definition) = 0
     OR position('(m.role = ''employee'' AND m.facility_id = p_facility_id)' IN definition) = 0
     OR position('WHEN ''company_admin'' THEN 1' IN definition) = 0
     OR position('WHEN ''facility_manager'' THEN 2' IN definition) = 0
     OR position('ELSE 3' IN definition) = 0 THEN
    RAISE EXCEPTION 'tageswerk_meter_role entspricht nicht der geprüften Fassung aus Tageswerk 2.9 und wurde nicht ersetzt.';
  END IF;
  EXECUTE $tageswerk$
    CREATE OR REPLACE FUNCTION public.tageswerk_meter_role(
      p_organization_id uuid,
      p_facility_id uuid
    )
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT m.role
      FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.is_active IS TRUE
        AND m.organization_id = p_organization_id
        AND (
          (m.role = 'company_admin' AND m.facility_id IS NULL)
          OR (m.role = 'facility_manager' AND m.facility_id = p_facility_id)
          OR (m.role = 'technician' AND m.facility_id = p_facility_id)
          OR (m.role = 'employee' AND m.facility_id = p_facility_id)
        )
      ORDER BY CASE m.role
        WHEN 'company_admin' THEN 1
        WHEN 'facility_manager' THEN 2
        WHEN 'technician' THEN 3
        ELSE 4
      END
      LIMIT 1;
    $body$
  $tageswerk$;
END;
$meter_role$;

DO $memberships$
DECLARE
  role_type text;
  constraint_name text;
  definition text;
  scoped boolean;
  technician_known boolean := false;
BEGIN
  SELECT t.typname INTO role_type
  FROM pg_attribute AS attribute
  JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_type AS t ON t.oid = attribute.atttypid
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'memberships'
    AND attribute.attname = 'role'
    AND t.typtype = 'e';
  IF role_type IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum AS label
      JOIN pg_type AS enum_type ON enum_type.oid = label.enumtypid
      WHERE enum_type.typname = role_type
        AND label.enumlabel = 'technician'
    ) THEN
      RAISE EXCEPTION 'Der Enum-Wert technician ist noch nicht festgeschrieben. Die Datei muss einschließlich des ersten COMMIT ausgeführt werden.';
    END IF;
    technician_known := true;
  END IF;

  FOR constraint_name, definition IN
    SELECT constraint_row.conname, pg_get_constraintdef(constraint_row.oid)
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'memberships'
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) ILIKE '%employee%'
      AND pg_get_constraintdef(constraint_row.oid) NOT ILIKE '%technician%'
  LOOP
    IF definition !~* 'facility_manager' OR definition !~* 'company_admin' OR definition ~* 'is_active|created|updated|profile' THEN
      RAISE EXCEPTION 'Die Rollenprüfung % hat eine unbekannte Form: %', constraint_name, definition;
    END IF;
    scoped := definition ILIKE '%facility_id%';
    EXECUTE format('ALTER TABLE public.memberships DROP CONSTRAINT %I', constraint_name);
    IF scoped THEN
      ALTER TABLE public.memberships
        ADD CONSTRAINT memberships_role_scope_check CHECK (
          (role = 'company_admin' AND facility_id IS NULL)
          OR (role IN ('facility_manager', 'employee', 'technician') AND facility_id IS NOT NULL)
        );
    ELSE
      ALTER TABLE public.memberships
        ADD CONSTRAINT memberships_role_check CHECK (
          role IN ('employee', 'technician', 'facility_manager', 'company_admin')
        );
    END IF;
    technician_known := true;
  END LOOP;

  IF NOT technician_known THEN
    RAISE EXCEPTION 'Die Mitgliedsrolle lässt sich nicht sicher um Techniker erweitern.';
  END IF;
END;
$memberships$;

DO $readings$
DECLARE
  policy_text text;
BEGIN
  IF to_regclass('public.utility_meter_readings') IS NULL OR to_regclass('public.utility_meters') IS NULL THEN
    RAISE EXCEPTION 'Die Zählerstände sind nicht vorbereitet.';
  END IF;
  SELECT coalesce(policy.with_check, '') INTO policy_text
  FROM pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'utility_meter_readings'
    AND policy.policyname = 'utility_meter_readings_insert';
  IF policy_text IS NULL THEN
    RAISE EXCEPTION 'utility_meter_readings_insert fehlt und wurde nicht neu angelegt.';
  END IF;
  IF position('technician' IN policy_text) > 0 THEN
    IF position('reading_type' IN policy_text) = 0 OR position('regular' IN policy_text) = 0 THEN
      RAISE EXCEPTION 'utility_meter_readings_insert enthält Techniker in einer unbekannten Form und wurde nicht ersetzt.';
    END IF;
    RETURN;
  END IF;
  IF position('employee' IN policy_text) = 0
     OR position('reading_type' IN policy_text) = 0
     OR position('regular' IN policy_text) = 0
     OR position('company_admin' IN policy_text) = 0
     OR position('facility_manager' IN policy_text) = 0 THEN
    RAISE EXCEPTION 'utility_meter_readings_insert entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
  END IF;
  DROP POLICY IF EXISTS utility_meter_readings_insert ON public.utility_meter_readings;
  CREATE POLICY utility_meter_readings_insert
    ON public.utility_meter_readings FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.utility_meters AS meter
        WHERE meter.id = utility_meter_readings.meter_id
          AND (
            (
              public.tageswerk_meter_role(meter.organization_id, meter.facility_id) IN ('employee', 'technician')
              AND utility_meter_readings.reading_type = 'regular'
              AND meter.is_active IS TRUE
              AND utility_meter_readings.voided_at IS NULL
            )
            OR public.tageswerk_meter_role(meter.organization_id, meter.facility_id)
               IN ('company_admin', 'facility_manager')
          )
      )
    );
END;
$readings$;

DO $prepare$
DECLARE
  signature text;
  definition text;
  updated text;
BEGIN
  SELECT procedure.oid::regprocedure::text INTO signature
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'tageswerk_prepare_reading';
  IF signature IS NULL THEN
    RAISE EXCEPTION 'tageswerk_prepare_reading fehlt.';
  END IF;
  definition := pg_get_functiondef(signature::regprocedure);
  IF position('technician' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position('actor_role = ''employee''' IN definition) = 0 THEN
    RAISE EXCEPTION 'tageswerk_prepare_reading begrenzt Mitarbeiter nicht an der erwarteten Stelle.';
  END IF;
  updated := replace(definition, 'actor_role = ''employee''', 'actor_role IN (''employee'', ''technician'')');
  EXECUTE updated;
END;
$prepare$;

DO $staff$
DECLARE
  signature text;
  definition text;
  updated text;
  changed boolean;
BEGIN
  SELECT procedure.oid::regprocedure::text INTO signature
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'manage_facility_membership';
  IF signature IS NULL THEN
    RAISE EXCEPTION 'manage_facility_membership fehlt.';
  END IF;
  definition := pg_get_functiondef(signature::regprocedure);
  IF position('technician' IN definition) = 0 THEN
    updated := definition;
    changed := false;
    IF position('''employee'', ''facility_manager''' IN updated) > 0 THEN
      updated := replace(updated, '''employee'', ''facility_manager''', '''employee'', ''technician'', ''facility_manager''');
      changed := true;
    ELSIF position('''facility_manager'', ''employee''' IN updated) > 0 THEN
      updated := replace(updated, '''facility_manager'', ''employee''', '''employee'', ''technician'', ''facility_manager''');
      changed := true;
    ELSIF position('''employee'',''facility_manager''' IN updated) > 0 THEN
      updated := replace(updated, '''employee'',''facility_manager''', '''employee'', ''technician'', ''facility_manager''');
      changed := true;
    ELSIF position('ARRAY[''employee'', ''facility_manager'']' IN updated) > 0 THEN
      updated := replace(updated, 'ARRAY[''employee'', ''facility_manager'']', 'ARRAY[''employee'', ''technician'', ''facility_manager'']');
      changed := true;
    ELSIF position('ARRAY[''employee''::text, ''facility_manager''::text]' IN updated) > 0 THEN
      updated := replace(updated, 'ARRAY[''employee''::text, ''facility_manager''::text]', 'ARRAY[''employee''::text, ''technician''::text, ''facility_manager''::text]');
      changed := true;
    END IF;
    IF NOT changed THEN
      RAISE EXCEPTION 'manage_facility_membership erlaubt die Rolle Techniker noch nicht an einer erkennbaren Stelle.';
    END IF;
    EXECUTE updated;
  END IF;

  signature := NULL;
  SELECT procedure.oid::regprocedure::text INTO signature
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'list_facility_employees';
  IF signature IS NOT NULL THEN
    definition := pg_get_functiondef(signature::regprocedure);
    IF position('technician' IN definition) = 0 AND position('role = ''employee''' IN definition) > 0 THEN
      EXECUTE replace(definition, 'role = ''employee''', 'role IN (''employee'', ''technician'')');
    END IF;
  END IF;

  signature := NULL;
  SELECT procedure.oid::regprocedure::text INTO signature
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'employee_update_assigned_defect';
  IF signature IS NOT NULL THEN
    definition := pg_get_functiondef(signature::regprocedure);
    IF position('technician' IN definition) = 0 THEN
      updated := definition;
      updated := replace(updated, '<> ''employee''', 'NOT IN (''employee'', ''technician'')');
      updated := replace(updated, '= ''employee''', 'IN (''employee'', ''technician'')');
      IF updated = definition THEN
        RAISE EXCEPTION 'employee_update_assigned_defect erkennt Techniker nicht an einer erwarteten Stelle.';
      END IF;
      EXECUTE updated;
    END IF;
  END IF;
END;
$staff$;

DO $defects$
DECLARE
  policy record;
  using_expr text;
  check_expr text;
  command text;
BEGIN
  FOR policy IN
    SELECT tablename, policyname, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('defects', 'defect_events')
  LOOP
    using_expr := policy.qual;
    check_expr := policy.with_check;
    IF position('= ''employee''' IN coalesce(using_expr, '')) = 0
       AND position('= ''employee''' IN coalesce(check_expr, '')) = 0 THEN
      CONTINUE;
    END IF;
    IF using_expr IS NOT NULL THEN
      using_expr := replace(using_expr, '= ''employee''', 'IN (''employee'', ''technician'')');
    END IF;
    IF check_expr IS NOT NULL THEN
      check_expr := replace(check_expr, '= ''employee''', 'IN (''employee'', ''technician'')');
    END IF;
    IF position('= ''employee''' IN coalesce(using_expr, '')) > 0
       OR position('= ''employee''' IN coalesce(check_expr, '')) > 0 THEN
      RAISE EXCEPTION 'Die Mangelrichtlinie %.% kann nicht sicher erweitert werden.', policy.tablename, policy.policyname;
    END IF;
    EXECUTE format('DROP POLICY %I ON public.%I', policy.policyname, policy.tablename);
    command := format(
      'CREATE POLICY %I ON public.%I FOR %s TO %s',
      policy.policyname,
      policy.tablename,
      policy.cmd,
      array_to_string(policy.roles, ', ')
    );
    IF using_expr IS NOT NULL THEN
      command := command || format(' USING (%s)', using_expr);
    END IF;
    IF check_expr IS NOT NULL THEN
      command := command || format(' WITH CHECK (%s)', check_expr);
    END IF;
    EXECUTE command;
  END LOOP;
END;
$defects$;

DO $water$
BEGIN
  IF to_regclass('public.water_pools') IS NULL
     OR to_regclass('public.water_checks') IS NULL
     OR to_regclass('public.water_alerts') IS NULL
     OR to_regclass('public.water_alert_measures') IS NULL THEN
    RAISE NOTICE 'Wasserhygiene ist noch nicht installiert. Die Historienregeln folgen mit Tageswerk 3.3.';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.tageswerk_water_check_in_round(
    p_pool_id uuid,
    p_measured_at timestamptz
  )
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
  AS $tageswerk$
  DECLARE
    v_mode text;
    v_count integer;
    v_today date;
    v_measured date;
  BEGIN
    IF p_pool_id IS NULL OR p_measured_at IS NULL THEN
      RETURN false;
    END IF;
    SELECT pool.schedule_mode, pool.interval_count
      INTO v_mode, v_count
    FROM public.water_pools AS pool
    WHERE pool.id = p_pool_id;
    IF v_mode IS NULL THEN
      RETURN false;
    END IF;
    v_today := (pg_catalog.now() AT TIME ZONE 'Europe/Berlin')::date;
    v_measured := (p_measured_at AT TIME ZONE 'Europe/Berlin')::date;
    IF v_mode = 'weekly' THEN
      RETURN p_measured_at >= pg_catalog.now() - make_interval(days => greatest(v_count, 1) * 7);
    END IF;
    IF v_mode = 'daily' AND v_count > 1 THEN
      RETURN v_measured >= (v_today - (v_count - 1));
    END IF;
    RETURN v_measured = v_today;
  END;
  $tageswerk$;

  REVOKE ALL ON FUNCTION public.tageswerk_water_check_in_round(uuid, timestamptz) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.tageswerk_water_check_in_round(uuid, timestamptz) TO authenticated;

  DROP POLICY IF EXISTS water_checks_select ON public.water_checks;
  CREATE POLICY water_checks_select ON public.water_checks FOR SELECT TO authenticated
    USING (
      public.tageswerk_meter_role(organization_id, facility_id) IN ('technician', 'facility_manager', 'company_admin')
    );

  DROP POLICY IF EXISTS water_alerts_select ON public.water_alerts;
  CREATE POLICY water_alerts_select ON public.water_alerts FOR SELECT TO authenticated
    USING (
      public.tageswerk_meter_role(organization_id, facility_id) IN ('technician', 'facility_manager', 'company_admin')
    );

  DROP POLICY IF EXISTS water_alert_measures_select ON public.water_alert_measures;
  CREATE POLICY water_alert_measures_select ON public.water_alert_measures FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.water_alerts AS alert
        WHERE alert.id = water_alert_measures.alert_id
          AND alert.organization_id = water_alert_measures.organization_id
          AND alert.facility_id = water_alert_measures.facility_id
      )
    );
END;
$water$;

COMMIT;
