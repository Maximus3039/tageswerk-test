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
-- Annahme liegen ausschließlich in tageswerk_3_4_invitation_role.sql.
-- Die geprüfte Produktion führt memberships.role als text. memberships_role_check
-- erlaubt technician bisher nicht und wird hier erweitert.
-- Ist die Spalte wider Erwarten ein Enum ohne den Wert technician, ändert diese Datei nichts.
-- Der Wert muss vorher in einer eigenen, bereits festgeschriebenen Anweisung ergänzt werden:
-- ALTER TYPE public.<enum> ADD VALUE 'technician';
-- Eine unbekannte Funktionsfassung setzt die Transaktion zurück.
-- manage_facility_membership bleibt auf (text, uuid, text, boolean).
-- Bekannt sind zwei Fassungen: die Deaktivierung aus Tageswerk 2.8 und die
-- produktive Fassung, die eine Zuordnung mit DELETE entfernt.
-- Leerzeichen und Zeilenumbrüche gelten dabei als formal.
-- Betriebsleitungen verwalten Mitarbeiter und Techniker des eigenen Betriebs.
-- Eine deaktivierte Zuordnung wird mit derselben Rolle wieder freigegeben.
-- Eine andere Rolle bei der Reaktivierung wird abgelehnt.
-- Geschäftsführungszuordnungen und Betriebsleitungen bleiben geschützt.
-- tageswerk_prepare_reading behält jede bestehende Prüfung. Techniker erfassen
-- normale Stände und stornieren oder korrigieren nicht.
-- employee_update_assigned_defect ist SECURITY DEFINER. Anmeldung, Zuweisung,
-- Organisation, Betrieb, Status und Arbeitsvermerk prüft die Funktion selbst.
-- Die produktive Fassung verlangt dabei kein is_active. Diese bekannte Fassung
-- wird ersetzt und verlangt danach eine aktive Mitgliedschaft.
-- Eine Fassung, die is_active bereits prüft, bleibt stehen.
-- Direkte Tabellenänderungen bleiben bei den bestehenden RLS-Regeln.
-- Die geprüfte Fassung verlangt keine Rolle employee. Eine aktive Mitgliedschaft
-- desselben Betriebs schließt den Techniker ein.
-- Eine Fassung mit ausdrücklicher Mitarbeiterbedingung wird um den Techniker ergänzt.
-- Fehlt Zuweisung, Betrieb oder die erwartete Stelle für die aktive Mitgliedschaft,
-- wird die Datei abgebrochen.
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
  definition := regexp_replace(pg_get_functiondef('public.tageswerk_meter_role(uuid,uuid)'::regprocedure), '[[:space:]]+', ' ', 'g');
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
     OR (position('m.is_active IS TRUE' IN definition) = 0 AND position('m.is_active = true' IN definition) = 0)
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
  definition text;
  updated text;
BEGIN
  IF to_regprocedure('public.tageswerk_prepare_reading()') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_prepare_reading() fehlt und wurde nicht neu erfunden.';
  END IF;
  definition := regexp_replace(pg_get_functiondef('public.tageswerk_prepare_reading()'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('technician' IN definition) > 0 THEN
    IF position('actor_role IN (''employee'', ''technician'') AND NEW.reading_type <> ''regular''' IN definition) = 0
       OR position('actor_role NOT IN (''company_admin'', ''facility_manager'')' IN definition) = 0
       OR position('Stornieren darf die Betriebsleitung oder Geschäftsführung.' IN definition) = 0 THEN
      RAISE EXCEPTION 'tageswerk_prepare_reading enthält Techniker in einer unbekannten Form und wurde nicht ersetzt.';
    END IF;
    RETURN;
  END IF;
  IF position('actor_role = ''employee'' AND NEW.reading_type <> ''regular''' IN definition) = 0
     OR position('actor_role NOT IN (''company_admin'', ''facility_manager'')' IN definition) = 0
     OR position('Stornieren darf die Betriebsleitung oder Geschäftsführung.' IN definition) = 0
     OR position('Eine Stornierung ändert nur den Stornierungsvermerk.' IN definition) = 0
     OR position('Die Korrektur bezieht sich auf eine gültige ursprüngliche Ablesung desselben Zählers.' IN definition) = 0 THEN
    RAISE EXCEPTION 'tageswerk_prepare_reading entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
  END IF;
  updated := replace(
    definition,
    'actor_role = ''employee'' AND NEW.reading_type <> ''regular''',
    'actor_role IN (''employee'', ''technician'') AND NEW.reading_type <> ''regular'''
  );
  IF updated = definition OR position('actor_role = ''employee''' IN updated) > 0 THEN
    RAISE EXCEPTION 'tageswerk_prepare_reading konnte nicht eindeutig erweitert werden und wurde nicht ersetzt.';
  END IF;
  EXECUTE updated;
END;
$prepare$;

DO $staff$
DECLARE
  signature text;
  definition text;
  updated text;
  recognized boolean;
BEGIN
  IF to_regprocedure('public.manage_facility_membership(text,uuid,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'manage_facility_membership(text, uuid, text, boolean) fehlt und wurde nicht neu erfunden.';
  END IF;
  definition := regexp_replace(pg_get_functiondef('public.manage_facility_membership(text,uuid,text,boolean)'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('private.can_manage_facility(' IN definition) > 0 THEN
    IF position('Keine Verwaltungsberechtigung fuer diesen Betrieb' IN definition) = 0
       OR position('Ungueltige Rolle' IN definition) = 0
       OR position('Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen' IN definition) = 0
       OR position('Geschaeftsfuehrungsrechte werden hier nicht veraendert' IN definition) = 0
       OR position('Eigene Berechtigungen hier nicht veraenderbar' IN definition) = 0
       OR position('UPDATE public.memberships SET role = ''company_admin''' IN definition) > 0 THEN
      RAISE EXCEPTION 'manage_facility_membership entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
    END IF;
    IF position('p_role NOT IN (''employee'',''technician'',''facility_manager'')' IN definition) > 0
       OR position('p_role NOT IN (''employee'', ''technician'', ''facility_manager'')' IN definition) > 0 THEN
      NULL;
    ELSIF position('p_role NOT IN (''employee'',''facility_manager'')' IN definition) > 0
       OR position('p_role NOT IN (''employee'', ''facility_manager'')' IN definition) > 0 THEN
      updated := replace(definition, 'p_role NOT IN (''employee'',''facility_manager'')', 'p_role NOT IN (''employee'',''technician'',''facility_manager'')');
      updated := replace(updated, 'p_role NOT IN (''employee'', ''facility_manager'')', 'p_role NOT IN (''employee'', ''technician'', ''facility_manager'')');
      updated := replace(updated, 'm.role<>''employee''', 'm.role NOT IN (''employee'',''technician'')');
      updated := replace(updated, 'm.role <> ''employee''', 'm.role NOT IN (''employee'', ''technician'')');
      updated := replace(updated, 'Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten', 'Betriebsleitung darf nur Mitarbeiter und Techniker bearbeiten');
      IF updated = definition
         OR position('private.can_manage_facility(' IN updated) = 0
         OR position('Geschaeftsfuehrungsrechte werden hier nicht veraendert' IN updated) = 0
         OR position('technician' IN updated) = 0 THEN
        RAISE EXCEPTION 'manage_facility_membership erkennt Techniker nicht an einer erwarteten Stelle.';
      END IF;
      EXECUTE updated;
    ELSE
      RAISE EXCEPTION 'manage_facility_membership entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
    END IF;
  ELSIF position('technician' IN definition) > 0 THEN
    IF position('p_role NOT IN (''employee'',''technician'',''facility_manager'')' IN definition) = 0
       OR position('m.role NOT IN (''employee'',''technician'')' IN definition) = 0
       OR position('Geschaeftsfuehrungsrechte werden hier nicht veraendert' IN definition) = 0
       OR position('Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen' IN definition) = 0
       OR position('Eine deaktivierte Zuordnung wird nur mit derselben Rolle wieder freigegeben.' IN definition) = 0
       OR position('SET is_active = true' IN definition) = 0 THEN
      RAISE EXCEPTION 'manage_facility_membership enthält Techniker in einer unbekannten Form und wurde nicht ersetzt.';
    END IF;
  ELSIF position('Keine Verwaltungsberechtigung fuer diesen Betrieb' IN definition) = 0
     OR position('Ungueltige Rolle' IN definition) = 0
     OR position('Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen' IN definition) = 0
     OR position('Geschaeftsfuehrungsrechte werden hier nicht veraendert' IN definition) = 0
     OR position('Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten' IN definition) = 0
     OR position('Eigene Berechtigungen hier nicht veraenderbar' IN definition) = 0
     OR (
       position('p_role NOT IN (''employee'',''facility_manager'')' IN definition) = 0
       AND position('p_role NOT IN (''employee'', ''facility_manager'')' IN definition) = 0
     )
     OR (
       position('Reaktivierung nur ueber gesonderte Freigabe' IN definition) = 0
       AND position('DELETE FROM public.memberships' IN definition) = 0
     ) THEN
    RAISE EXCEPTION 'manage_facility_membership entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
  ELSE
    EXECUTE $replace_membership$
      CREATE OR REPLACE FUNCTION public.manage_facility_membership(
        p_email text,
        p_facility_id uuid,
        p_role text,
        p_remove boolean DEFAULT false
      )
      RETURNS text
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $function$
      DECLARE
        v_org uuid; v_target uuid; v_caller uuid := auth.uid();
        v_company_admin boolean; v_manager boolean; v_existing uuid;
        v_existing_role text; v_existing_active boolean;
      BEGIN
        IF v_caller IS NULL THEN RAISE EXCEPTION 'Anmeldung erforderlich'; END IF;
        SELECT organization_id INTO v_org FROM public.facilities WHERE id = p_facility_id;
        IF v_org IS NULL THEN RAISE EXCEPTION 'Betrieb nicht gefunden'; END IF;
        SELECT EXISTS(
          SELECT 1 FROM public.memberships AS membership
          WHERE membership.user_id = v_caller
            AND membership.organization_id = v_org
            AND membership.role = 'company_admin'
            AND membership.is_active = true
        ) INTO v_company_admin;
        SELECT EXISTS(
          SELECT 1 FROM public.memberships AS membership
          WHERE membership.user_id = v_caller
            AND membership.organization_id = v_org
            AND membership.facility_id = p_facility_id
            AND membership.role = 'facility_manager'
            AND membership.is_active = true
        ) INTO v_manager;
        IF NOT (v_company_admin OR v_manager) THEN
          RAISE EXCEPTION 'Keine Verwaltungsberechtigung fuer diesen Betrieb';
        END IF;
        IF p_role NOT IN ('employee','technician','facility_manager') THEN
          RAISE EXCEPTION 'Ungueltige Rolle';
        END IF;
        IF p_role = 'facility_manager' AND NOT v_company_admin THEN
          RAISE EXCEPTION 'Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen';
        END IF;
        SELECT users.id INTO v_target
        FROM auth.users AS users
        WHERE lower(users.email) = lower(btrim(p_email))
        LIMIT 1;
        IF v_target IS NULL THEN
          RAISE EXCEPTION 'Kein registriertes Tageswerk-Konto mit dieser E-Mail vorhanden';
        END IF;
        IF v_target = v_caller THEN
          RAISE EXCEPTION 'Eigene Berechtigungen hier nicht veraenderbar';
        END IF;
        IF EXISTS(
          SELECT 1 FROM public.memberships AS membership
          WHERE membership.user_id = v_target
            AND membership.organization_id = v_org
            AND membership.role = 'company_admin'
        ) THEN
          RAISE EXCEPTION 'Geschaeftsfuehrungsrechte werden hier nicht veraendert';
        END IF;
        SELECT membership.id INTO v_existing
        FROM public.memberships AS membership
        WHERE membership.user_id = v_target
          AND membership.organization_id = v_org
          AND membership.facility_id = p_facility_id
        ORDER BY membership.id
        LIMIT 1
        FOR UPDATE;
        IF v_existing IS NOT NULL THEN
          IF NOT v_company_admin AND EXISTS(
            SELECT 1 FROM public.memberships AS m
            WHERE m.id = v_existing
              AND m.role NOT IN ('employee','technician')
          ) THEN
            RAISE EXCEPTION 'Betriebsleitung darf nur Mitarbeiter und Techniker bearbeiten';
          END IF;
          IF p_remove THEN
            UPDATE public.memberships SET is_active = false WHERE id = v_existing;
            RETURN 'Zuordnung deaktiviert';
          END IF;
          SELECT membership.role, membership.is_active
            INTO v_existing_role, v_existing_active
          FROM public.memberships AS membership
          WHERE membership.id = v_existing;
          IF v_existing_active = false THEN
            IF p_role IS DISTINCT FROM v_existing_role THEN
              RAISE EXCEPTION 'Eine deaktivierte Zuordnung wird nur mit derselben Rolle wieder freigegeben.';
            END IF;
            UPDATE public.memberships SET is_active = true WHERE id = v_existing;
            RETURN 'Zuordnung reaktiviert';
          END IF;
          UPDATE public.memberships SET role = p_role WHERE id = v_existing;
          RETURN 'Zuordnung aktualisiert';
        END IF;
        IF p_remove THEN RAISE EXCEPTION 'Keine Zuordnung vorhanden'; END IF;
        INSERT INTO public.memberships(user_id, organization_id, facility_id, role)
          VALUES (v_target, v_org, p_facility_id, p_role);
        RETURN 'Mitarbeiter zugeordnet';
      END;
      $function$
    $replace_membership$;
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
    definition := regexp_replace(pg_get_functiondef(signature::regprocedure), '[[:space:]]+', ' ', 'g');
    IF position('private.can_access_facility(' IN definition) > 0 THEN
      IF position('SECURITY DEFINER' IN definition) = 0
         OR position('Anmeldung erforderlich' IN definition) = 0
         OR position('Mitarbeiter koennen nur bearbeiten oder Erledigung melden' IN definition) = 0
         OR position('Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich' IN definition) = 0
         OR position('Mangel nicht gefunden' IN definition) = 0
         OR position('assigned_to IS DISTINCT FROM auth.uid()' IN definition) = 0
         OR position('Dieser Mangel ist dir nicht zugewiesen' IN definition) = 0
         OR position('Keine Betriebsberechtigung' IN definition) = 0
         OR position('Vorgang ist bereits abgeschlossen oder wartet auf Freigabe' IN definition) = 0
         OR position('FOR UPDATE' IN definition) = 0
         OR position('SET assigned_to' IN definition) > 0
         OR position('SET facility_id' IN definition) > 0
         OR position('SET organization_id' IN definition) > 0 THEN
        RAISE EXCEPTION 'employee_update_assigned_defect entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
      END IF;
    ELSIF position('SECURITY DEFINER' IN definition) = 0
       OR position('Anmeldung erforderlich' IN definition) = 0
       OR position('Mitarbeiter koennen nur bearbeiten oder Erledigung melden' IN definition) = 0
       OR position('Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich' IN definition) = 0
       OR position('Mangel nicht gefunden' IN definition) = 0
       OR position('assigned_to IS DISTINCT FROM auth.uid()' IN definition) = 0
       OR position('Dieser Mangel ist dir nicht zugewiesen' IN definition) = 0
       OR position('Keine Betriebsberechtigung' IN definition) = 0
       OR position('Vorgang ist bereits abgeschlossen oder wartet auf Freigabe' IN definition) = 0
       OR position('FOR UPDATE' IN definition) = 0
       OR (position('m.organization_id=d.organization_id' IN definition) = 0 AND position('m.organization_id = d.organization_id' IN definition) = 0)
       OR (position('m.facility_id=d.facility_id' IN definition) = 0 AND position('m.facility_id = d.facility_id' IN definition) = 0)
       OR (position('m.role=''company_admin''' IN definition) = 0 AND position('m.role = ''company_admin''' IN definition) = 0)
       OR (position('p_status NOT IN (''in_progress'',''pending_review'')' IN definition) = 0 AND position('p_status NOT IN (''in_progress'', ''pending_review'')' IN definition) = 0)
       OR (position('d.status IN (''resolved'',''pending_review'')' IN definition) = 0 AND position('d.status IN (''resolved'', ''pending_review'')' IN definition) = 0)
       OR position('UPDATE public.defects SET status=p_status, change_note=' IN definition) = 0
       OR position('SET assigned_to' IN definition) > 0
       OR position('SET facility_id' IN definition) > 0
       OR position('SET organization_id' IN definition) > 0
    THEN
      RAISE EXCEPTION 'employee_update_assigned_defect entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
    END IF;
    IF position('private.can_access_facility(' IN definition) = 0 THEN
    recognized := position('technician' IN definition) > 0
      OR (
        position('= ''employee''' IN definition) = 0
        AND position('<> ''employee''' IN definition) = 0
        AND (
          position('m.role=''company_admin'' OR m.facility_id=d.facility_id' IN definition) > 0
          OR position('m.role = ''company_admin'' OR m.facility_id = d.facility_id' IN definition) > 0
        )
      );
    IF recognized
       AND (
         position('m.is_active = true' IN definition) > 0
         OR position('m.is_active IS TRUE' IN definition) > 0
       ) THEN
      NULL;
    ELSIF recognized THEN
      EXECUTE $replace_defect$
        CREATE OR REPLACE FUNCTION public.employee_update_assigned_defect(p_defect_id uuid, p_status text, p_note text)
        RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
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
      $replace_defect$;
    ELSE
      updated := replace(definition, '<> ''employee''', 'NOT IN (''employee'', ''technician'')');
      updated := replace(updated, '= ''employee''', 'IN (''employee'', ''technician'')');
      IF position('m.is_active = true' IN updated) = 0 AND position('m.is_active IS TRUE' IN updated) = 0 THEN
        updated := replace(updated, 'm.user_id=auth.uid() AND m.organization_id', 'm.user_id=auth.uid() AND m.is_active = true AND m.organization_id');
        updated := replace(updated, 'm.user_id = auth.uid() AND m.organization_id', 'm.user_id = auth.uid() AND m.is_active = true AND m.organization_id');
      END IF;
      IF updated = definition
         OR position('assigned_to IS DISTINCT FROM auth.uid()' IN updated) = 0
         OR position('Keine Betriebsberechtigung' IN updated) = 0
         OR (position('m.facility_id=d.facility_id' IN updated) = 0 AND position('m.facility_id = d.facility_id' IN updated) = 0)
         OR (position('m.is_active = true' IN updated) = 0 AND position('m.is_active IS TRUE' IN updated) = 0)
      THEN
        RAISE EXCEPTION 'employee_update_assigned_defect erkennt Techniker nicht an einer erwarteten Stelle.';
      END IF;
      EXECUTE updated;
    END IF;
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
  -- Entwurfstabellen, Abschluss- und Verwerffunktionen bleiben unangetastet.
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
