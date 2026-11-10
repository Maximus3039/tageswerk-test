-- Tageswerk, Kontrollabfragen für die produktive Installation
-- Nur lesen. Diese Datei legt nichts an, ändert nichts und löscht nichts.
-- Jeden Abschnitt einzeln im SQL-Editor ausführen.
-- Die fünf Migrationsdateien werden hier nicht aufgerufen.
-- Fehlende Funktionen und Tabellen werden mit to_regprocedure und to_regclass
-- geprüft. Eine direkte Namensumwandlung würde vor der Installation abbrechen,
-- weil die Temperatur- und Wasserfunktionen noch nicht existieren.

-- Abschnitt 0, vor der ersten Migration
-- Jede Zeile muss status = 'bereit' zeigen. Eine andere Zeile stoppt die Installation.

SELECT 'Funktionen vorhanden' AS pruefung,
  CASE WHEN
    to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.tageswerk_facility_organization(uuid)') IS NOT NULL
    AND to_regprocedure('public.tageswerk_bind_operation_facility()') IS NOT NULL
    AND to_regprocedure('public.tageswerk_prepare_reading()') IS NOT NULL
    AND to_regprocedure('public.manage_facility_membership(text,uuid,text,boolean)') IS NOT NULL
    AND to_regprocedure('public.accept_staff_invitation()') IS NOT NULL
    AND to_regclass('public.facilities') IS NOT NULL
    AND to_regclass('public.memberships') IS NOT NULL
    AND to_regclass('public.utility_meters') IS NOT NULL
    AND to_regclass('public.utility_meter_readings') IS NOT NULL
    AND to_regclass('public.staff_invitations') IS NOT NULL
    AND to_regclass('public.daily_reports') IS NOT NULL
    AND to_regclass('public.temperature_points') IS NULL
    AND to_regclass('public.water_pools') IS NULL
  THEN 'bereit' ELSE 'stoppen' END AS status;

SELECT 'tageswerk_meter_role entspricht 2.9' AS pruefung,
  CASE
    WHEN to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NULL THEN 'stoppen'
    WHEN position('technician' IN body) = 0
      AND position('SECURITY DEFINER' IN body) > 0
      AND (position('m.is_active IS TRUE' IN body) > 0 OR position('m.is_active = true' IN body) > 0)
      AND position('(m.role = ''company_admin'' AND m.facility_id IS NULL)' IN body) > 0
      AND position('(m.role = ''facility_manager'' AND m.facility_id = p_facility_id)' IN body) > 0
      AND position('(m.role = ''employee'' AND m.facility_id = p_facility_id)' IN body) > 0
      AND position('WHEN ''company_admin'' THEN 1' IN body) > 0
      AND position('WHEN ''facility_manager'' THEN 2' IN body) > 0
      AND position('ELSE 3' IN body) > 0
    THEN 'bereit'
    ELSE 'stoppen'
  END AS status
FROM (
  SELECT coalesce(regexp_replace(pg_get_functiondef(to_regprocedure('public.tageswerk_meter_role(uuid,uuid)')), '[[:space:]]+', ' ', 'g'), '') AS body
) AS definition;

SELECT 'tageswerk_prepare_reading entspricht der Importfassung' AS pruefung,
  CASE
    WHEN to_regprocedure('public.tageswerk_prepare_reading()') IS NULL THEN 'stoppen'
    WHEN position('technician' IN body) = 0
      AND position('actor_role = ''employee'' AND NEW.reading_type <> ''regular''' IN body) > 0
      AND position('actor_role NOT IN (''company_admin'', ''facility_manager'')' IN body) > 0
      AND position('Stornieren darf die Betriebsleitung oder Geschäftsführung.' IN body) > 0
      AND position('Eine Stornierung ändert nur den Stornierungsvermerk.' IN body) > 0
      AND position('Die Korrektur bezieht sich auf eine gültige ursprüngliche Ablesung desselben Zählers.' IN body) > 0
    THEN 'bereit'
    ELSE 'stoppen'
  END AS status
FROM (
  SELECT coalesce(regexp_replace(pg_get_functiondef(to_regprocedure('public.tageswerk_prepare_reading()')), '[[:space:]]+', ' ', 'g'), '') AS body
) AS definition;

SELECT 'manage_facility_membership entspricht 2.8' AS pruefung,
  CASE
    WHEN to_regprocedure('public.manage_facility_membership(text,uuid,text,boolean)') IS NULL THEN 'stoppen'
    WHEN position('technician' IN body) = 0
      AND position('Keine Verwaltungsberechtigung fuer diesen Betrieb' IN body) > 0
      AND position('Ungueltige Rolle' IN body) > 0
      AND position('Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen' IN body) > 0
      AND position('Geschaeftsfuehrungsrechte werden hier nicht veraendert' IN body) > 0
      AND position('Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten' IN body) > 0
      AND position('Reaktivierung nur ueber gesonderte Freigabe' IN body) > 0
      AND position('Eigene Berechtigungen hier nicht veraenderbar' IN body) > 0
      AND (
        position('p_role NOT IN (''employee'',''facility_manager'')' IN body) > 0
        OR position('p_role NOT IN (''employee'', ''facility_manager'')' IN body) > 0
      )
    THEN 'bereit'
    ELSE 'stoppen'
  END AS status
FROM (
  SELECT coalesce(regexp_replace(pg_get_functiondef(to_regprocedure('public.manage_facility_membership(text,uuid,text,boolean)')), '[[:space:]]+', ' ', 'g'), '') AS body
) AS definition;

SELECT 'accept_staff_invitation entspricht 2.8' AS pruefung,
  CASE
    WHEN to_regprocedure('public.accept_staff_invitation()') IS NULL THEN 'stoppen'
    WHEN position('technician' IN body) = 0
      AND position('Bitte zuerst anmelden.' IN body) > 0
      AND position('Die E-Mail-Adresse ist noch nicht bestätigt.' IN body) > 0
      AND position('status = ''sent''' IN body) > 0
      AND position('role = ''employee''' IN body) > 0
      AND position('Keine offene Einladung gefunden.' IN body) > 0
      AND position('Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.' IN body) > 0
      AND position('staff_invitations' IN body) > 0
    THEN 'bereit'
    ELSE 'stoppen'
  END AS status
FROM (
  SELECT coalesce(regexp_replace(pg_get_functiondef(to_regprocedure('public.accept_staff_invitation()')), '[[:space:]]+', ' ', 'g'), '') AS body
) AS definition;

SELECT 'claim_staff_invitations entspricht 2.8 oder fehlt' AS pruefung,
  CASE
    WHEN to_regprocedure('public.claim_staff_invitations()') IS NULL THEN 'bereit'
    WHEN position('technician' IN body) = 0
      AND (
        position('status=''sent'' AND role=''employee''' IN body) > 0
        OR position('status = ''sent'' AND role = ''employee''' IN body) > 0
      )
      AND position('Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.' IN body) > 0
    THEN 'bereit'
    ELSE 'stoppen'
  END AS status
FROM (
  SELECT coalesce(regexp_replace(pg_get_functiondef(to_regprocedure('public.claim_staff_invitations()')), '[[:space:]]+', ' ', 'g'), '') AS body
) AS definition;

SELECT 'employee_update_assigned_defect ist die geprüfte Fassung' AS pruefung,
  CASE
    WHEN to_regprocedure('public.employee_update_assigned_defect(uuid,text,text)') IS NULL THEN 'bereit'
    WHEN position('SECURITY DEFINER' IN body) = 0
      OR position('Anmeldung erforderlich' IN body) = 0
      OR position('Mitarbeiter koennen nur bearbeiten oder Erledigung melden' IN body) = 0
      OR position('Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich' IN body) = 0
      OR position('Mangel nicht gefunden' IN body) = 0
      OR position('assigned_to IS DISTINCT FROM auth.uid()' IN body) = 0
      OR position('Dieser Mangel ist dir nicht zugewiesen' IN body) = 0
      OR position('Keine Betriebsberechtigung' IN body) = 0
      OR position('Vorgang ist bereits abgeschlossen oder wartet auf Freigabe' IN body) = 0
      OR position('FOR UPDATE' IN body) = 0
      OR (position('m.is_active = true' IN body) = 0 AND position('m.is_active IS TRUE' IN body) = 0)
      OR (position('m.organization_id=d.organization_id' IN body) = 0 AND position('m.organization_id = d.organization_id' IN body) = 0)
      OR (position('m.facility_id=d.facility_id' IN body) = 0 AND position('m.facility_id = d.facility_id' IN body) = 0)
      OR (position('m.role=''company_admin''' IN body) = 0 AND position('m.role = ''company_admin''' IN body) = 0)
      OR (position('p_status NOT IN (''in_progress'',''pending_review'')' IN body) = 0 AND position('p_status NOT IN (''in_progress'', ''pending_review'')' IN body) = 0)
      OR (position('d.status IN (''resolved'',''pending_review'')' IN body) = 0 AND position('d.status IN (''resolved'', ''pending_review'')' IN body) = 0)
      OR position('UPDATE public.defects SET status=p_status, change_note=' IN body) = 0
      OR position('SET assigned_to' IN body) > 0
      OR position('SET facility_id' IN body) > 0
      OR position('SET organization_id' IN body) > 0
    THEN 'stoppen'
    WHEN position('= ''employee''' IN body) = 0
      AND position('<> ''employee''' IN body) = 0
      AND (
        position('m.role=''company_admin'' OR m.facility_id=d.facility_id' IN body) > 0
        OR position('m.role = ''company_admin'' OR m.facility_id = d.facility_id' IN body) > 0
      )
    THEN 'bereit'
    WHEN position('technician' IN body) > 0
      AND position('assigned_to IS DISTINCT FROM auth.uid()' IN body) > 0
      AND (
        position('m.facility_id=d.facility_id' IN body) > 0
        OR position('m.facility_id = d.facility_id' IN body) > 0
      )
    THEN 'bereit'
    WHEN position('= ''employee''' IN body) > 0 OR position('<> ''employee''' IN body) > 0
    THEN 'bereit'
    ELSE 'stoppen'
  END AS status
FROM (
  SELECT coalesce(regexp_replace(pg_get_functiondef(to_regprocedure('public.employee_update_assigned_defect(uuid,text,text)')), '[[:space:]]+', ' ', 'g'), '') AS body
) AS definition;

SELECT 'Mitgliedsrolle ist Text und bleibt bei den drei bestehenden Rollen' AS pruefung,
  CASE WHEN data_type = 'text'
    AND NOT EXISTS (
      SELECT 1 FROM public.memberships
      WHERE role NOT IN ('employee', 'facility_manager', 'company_admin')
    )
  THEN 'bereit' ELSE 'stoppen' END AS status
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'memberships' AND column_name = 'role';

SELECT 'Rollenprüfung lässt sich um Techniker erweitern' AS pruefung,
  CASE WHEN count(*) > 0 AND bool_and(
    definition ILIKE '%facility_manager%'
    AND definition ILIKE '%company_admin%'
    AND definition !~* 'is_active|created|updated|profile'
  ) THEN 'bereit' ELSE 'stoppen' END AS status
FROM (
  SELECT pg_get_constraintdef(constraint_row.oid) AS definition
  FROM pg_constraint AS constraint_row
  JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'memberships'
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid) ILIKE '%employee%'
    AND pg_get_constraintdef(constraint_row.oid) NOT ILIKE '%technician%'
) AS role_checks;

SELECT 'Zähler-Insert entspricht der geprüften Richtlinie' AS pruefung,
  CASE WHEN position('technician' IN coalesce(policy.with_check, '')) = 0
    AND position('employee' IN coalesce(policy.with_check, '')) > 0
    AND position('reading_type' IN coalesce(policy.with_check, '')) > 0
    AND position('regular' IN coalesce(policy.with_check, '')) > 0
    AND position('company_admin' IN coalesce(policy.with_check, '')) > 0
    AND position('facility_manager' IN coalesce(policy.with_check, '')) > 0
  THEN 'bereit' ELSE 'stoppen' END AS status
FROM pg_policies AS policy
WHERE policy.schemaname = 'public'
  AND policy.tablename = 'utility_meter_readings'
  AND policy.policyname = 'utility_meter_readings_insert';

SELECT 'Einladungsrollen bleiben Mitarbeiter' AS pruefung,
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_invitations' AND column_name = 'role'
  ) THEN 'spalte_fehlt'
  WHEN EXISTS (
    SELECT 1 FROM public.staff_invitations
    WHERE role IS NOT NULL AND role NOT IN ('employee', 'technician')
  ) THEN 'stoppen'
  ELSE 'bereit' END AS status;

SELECT 'Neue Temperatur- und Wasserfunktionen fehlen noch' AS pruefung,
  CASE
    WHEN to_regprocedure('public.tageswerk_stamp_temperature_reading()') IS NULL
      AND to_regprocedure('public.tageswerk_temperature_alert()') IS NULL
      AND to_regprocedure('public.tageswerk_acknowledge_temperature()') IS NULL
      AND to_regprocedure('public.tageswerk_protect_temperature_point()') IS NULL
      AND to_regprocedure('public.tageswerk_protect_temperature_history()') IS NULL
      AND to_regprocedure('public.tageswerk_stamp_water_check()') IS NULL
      AND to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') IS NULL
      AND to_regprocedure('public.tageswerk_save_water_round_draft(uuid,uuid,jsonb,jsonb,integer)') IS NULL
      AND to_regprocedure('public.tageswerk_discard_water_round_draft(uuid)') IS NULL
      AND to_regclass('public.temperature_points') IS NULL
      AND to_regclass('public.temperature_readings') IS NULL
      AND to_regclass('public.temperature_alerts') IS NULL
      AND to_regclass('public.water_pools') IS NULL
      AND to_regclass('public.water_checks') IS NULL
      AND to_regclass('public.water_round_drafts') IS NULL
    THEN 'bereit'
    WHEN to_regprocedure('public.tageswerk_stamp_water_check()') IS NOT NULL
      AND position('reading_code' IN coalesce(pg_get_functiondef(to_regprocedure('public.tageswerk_stamp_water_check()')), '')) = 0
    THEN 'stoppen'
    ELSE 'stoppen'
  END AS status;

-- Abschnitt 1, unmittelbar nach tageswerk_3_1_temperature.sql
-- Fehlt die Installation, lautet das Ergebnis pruefen. Die Abfrage bricht nicht ab.

SELECT 'Temperatur 3.1' AS pruefung,
  CASE WHEN
    to_regclass('public.temperature_points') IS NOT NULL
    AND to_regclass('public.temperature_readings') IS NOT NULL
    AND to_regclass('public.temperature_alerts') IS NOT NULL
    AND to_regprocedure('public.tageswerk_stamp_temperature_reading()') IS NOT NULL
    AND to_regprocedure('public.tageswerk_temperature_alert()') IS NOT NULL
    AND to_regprocedure('public.tageswerk_acknowledge_temperature()') IS NOT NULL
    AND has_table_privilege('authenticated', to_regclass('public.temperature_points'), 'SELECT')
    AND has_table_privilege('authenticated', to_regclass('public.temperature_points'), 'INSERT')
    AND NOT coalesce(has_table_privilege('anon', to_regclass('public.temperature_points'), 'SELECT'), false)
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.temperature_points'), 'UPDATE'), false)
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.temperature_points'), 'DELETE'), false)
  THEN 'installiert' ELSE 'pruefen' END AS status;

-- Abschnitt 2, unmittelbar nach tageswerk_3_2_temperature_points.sql

SELECT 'Temperatur 3.2' AS pruefung,
  CASE WHEN
    to_regclass('public.temperature_points') IS NOT NULL
    AND (
      SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'temperature_points'
        AND column_name IN ('interval_unit', 'interval_count')
    ) = 2
    AND to_regprocedure('public.tageswerk_protect_temperature_point()') IS NOT NULL
    AND to_regprocedure('public.tageswerk_protect_temperature_history()') IS NOT NULL
    AND has_table_privilege('authenticated', to_regclass('public.temperature_points'), 'UPDATE')
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.temperature_points'), 'DELETE'), false)
  THEN 'installiert' ELSE 'pruefen' END AS status;

-- Abschnitt 3, unmittelbar nach tageswerk_3_3_water_hygiene.sql

SELECT 'Wasserhygiene 3.3' AS pruefung,
  CASE WHEN
    to_regclass('public.water_parameter_definitions') IS NOT NULL
    AND to_regclass('public.water_pools') IS NOT NULL
    AND to_regclass('public.water_checks') IS NOT NULL
    AND to_regclass('public.water_alerts') IS NOT NULL
    AND to_regclass('public.water_round_drafts') IS NOT NULL
    AND to_regclass('public.water_round_discards') IS NOT NULL
    AND to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') IS NOT NULL
    AND to_regprocedure('public.tageswerk_save_water_round_draft(uuid,uuid,jsonb,jsonb,integer)') IS NOT NULL
    AND to_regprocedure('public.tageswerk_discard_water_round_draft(uuid)') IS NOT NULL
    AND to_regprocedure('public.tageswerk_stamp_water_check()') IS NOT NULL
    AND has_table_privilege('authenticated', to_regclass('public.water_round_drafts'), 'SELECT')
    AND has_table_privilege('authenticated', to_regclass('public.water_round_drafts'), 'INSERT')
    AND has_table_privilege('authenticated', to_regclass('public.water_round_drafts'), 'UPDATE')
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.water_round_discards'), 'SELECT'), false)
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.water_round_discards'), 'INSERT'), false)
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.water_round_discards'), 'UPDATE'), false)
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.water_round_discards'), 'DELETE'), false)
    AND NOT coalesce(has_table_privilege('anon', to_regclass('public.water_checks'), 'SELECT'), false)
    AND position('reading_code' IN coalesce(pg_get_functiondef(to_regprocedure('public.tageswerk_stamp_water_check()')), '')) > 0
  THEN 'installiert' ELSE 'pruefen' END AS status;

-- Abschnitt 4, unmittelbar nach tageswerk_3_4_technician_role.sql

SELECT 'Techniker 3.4' AS pruefung,
  CASE WHEN
    to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.tageswerk_prepare_reading()') IS NOT NULL
    AND to_regprocedure('public.manage_facility_membership(text,uuid,text,boolean)') IS NOT NULL
    AND position('WHEN ''technician'' THEN 3' IN meter_body) > 0
    AND position('actor_role IN (''employee'', ''technician'') AND NEW.reading_type <> ''regular''' IN reading_body) > 0
    AND position('Eine deaktivierte Zuordnung wird nur mit derselben Rolle wieder freigegeben.' IN manage_body) > 0
    AND position('SET is_active = true' IN manage_body) > 0
    AND EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'memberships'
        AND constraint_row.contype = 'c'
        AND pg_get_constraintdef(constraint_row.oid) ILIKE '%technician%'
    )
  THEN 'installiert' ELSE 'pruefen' END AS status
FROM (
  SELECT coalesce(regexp_replace(pg_get_functiondef(to_regprocedure('public.tageswerk_meter_role(uuid,uuid)')), '[[:space:]]+', ' ', 'g'), '') AS meter_body,
         coalesce(regexp_replace(pg_get_functiondef(to_regprocedure('public.tageswerk_prepare_reading()')), '[[:space:]]+', ' ', 'g'), '') AS reading_body,
         coalesce(regexp_replace(pg_get_functiondef(to_regprocedure('public.manage_facility_membership(text,uuid,text,boolean)')), '[[:space:]]+', ' ', 'g'), '') AS manage_body
) AS definitions;

-- Abschnitt 5, unmittelbar nach tageswerk_3_4_invitation_role.sql

SELECT 'Einladung 3.4' AS pruefung,
  CASE WHEN
    to_regprocedure('public.tageswerk_guard_invitation_role()') IS NOT NULL
    AND to_regprocedure('public.accept_staff_invitation()') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_invitations_role_check')
    AND position('v_role := coalesce(v_invitation.role, ''employee'')' IN accept_body) > 0
    AND position('coalesce(role, ''employee'') IN (''employee'', ''technician'')' IN accept_body) > 0
    AND position('UPDATE public.memberships' IN accept_body) = 0
  THEN 'installiert' ELSE 'pruefen' END AS status
FROM (
  SELECT coalesce(regexp_replace(pg_get_functiondef(to_regprocedure('public.accept_staff_invitation()')), '[[:space:]]+', ' ', 'g'), '') AS accept_body
) AS definition;
