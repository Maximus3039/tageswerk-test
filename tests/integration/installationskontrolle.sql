-- Tageswerk, Kontrollabfragen für die produktive Installation
-- Nur lesen. Diese Datei legt nichts an, ändert nichts und löscht nichts.
-- Abschnitt 0 ist eine Ergebnistabelle. Die Abschnitte 1 bis 5 bleiben eigene Abfragen.
-- Die fünf Migrationsdateien werden hier nicht aufgerufen.
-- Fehlende Funktionen und Tabellen werden mit to_regprocedure und to_regclass geprüft.
-- pg_get_functiondef erhält nur eine zuvor aufgelöste Funktion.
-- Eine Zeile mit stoppen oder pruefen ist keine Installationsfreigabe.

-- Abschnitt 0, vor der ersten Migration
-- Jede Zeile muss status = 'bereit' zeigen. Die letzte Zeile fasst das zusammen.

WITH signatures AS (
  SELECT
    to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') AS meter_role,
    to_regprocedure('public.tageswerk_facility_organization(uuid)') AS facility_organization,
    to_regprocedure('public.tageswerk_bind_operation_facility()') AS bind_facility,
    to_regprocedure('public.tageswerk_prepare_reading()') AS prepare_reading,
    to_regprocedure('public.manage_facility_membership(text,uuid,text,boolean)') AS manage_membership,
    to_regprocedure('public.accept_staff_invitation()') AS accept_invitation,
    to_regprocedure('public.claim_staff_invitations()') AS claim_invitations,
    to_regprocedure('public.employee_update_assigned_defect(uuid,text,text)') AS update_defect,
    to_regprocedure('public.tageswerk_stamp_temperature_reading()') AS stamp_temperature,
    to_regprocedure('public.tageswerk_temperature_alert()') AS temperature_alert,
    to_regprocedure('public.tageswerk_acknowledge_temperature()') AS acknowledge_temperature,
    to_regprocedure('public.tageswerk_protect_temperature_point()') AS protect_temperature_point,
    to_regprocedure('public.tageswerk_protect_temperature_history()') AS protect_temperature_history,
    to_regprocedure('public.tageswerk_stamp_water_check()') AS stamp_water,
    to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') AS record_water,
    to_regprocedure('public.tageswerk_save_water_round_draft(uuid,uuid,jsonb,jsonb,integer)') AS save_water_draft,
    to_regprocedure('public.tageswerk_discard_water_round_draft(uuid)') AS discard_water_draft
),
bodies AS (
  SELECT
    CASE WHEN signatures.meter_role IS NULL THEN ''
      ELSE regexp_replace(pg_get_functiondef(signatures.meter_role), '[[:space:]]+', ' ', 'g') END AS meter_role,
    CASE WHEN signatures.prepare_reading IS NULL THEN ''
      ELSE regexp_replace(pg_get_functiondef(signatures.prepare_reading), '[[:space:]]+', ' ', 'g') END AS prepare_reading,
    CASE WHEN signatures.manage_membership IS NULL THEN ''
      ELSE regexp_replace(pg_get_functiondef(signatures.manage_membership), '[[:space:]]+', ' ', 'g') END AS manage_membership,
    CASE WHEN signatures.accept_invitation IS NULL THEN ''
      ELSE regexp_replace(pg_get_functiondef(signatures.accept_invitation), '[[:space:]]+', ' ', 'g') END AS accept_invitation,
    CASE WHEN signatures.claim_invitations IS NULL THEN ''
      ELSE regexp_replace(pg_get_functiondef(signatures.claim_invitations), '[[:space:]]+', ' ', 'g') END AS claim_invitations,
    CASE WHEN signatures.update_defect IS NULL THEN ''
      ELSE regexp_replace(pg_get_functiondef(signatures.update_defect), '[[:space:]]+', ' ', 'g') END AS update_defect,
    CASE WHEN signatures.stamp_water IS NULL THEN ''
      ELSE regexp_replace(pg_get_functiondef(signatures.stamp_water), '[[:space:]]+', ' ', 'g') END AS stamp_water
  FROM signatures
),
facts AS (
  SELECT
    signatures.meter_role IS NOT NULL AS has_meter_role,
    signatures.facility_organization IS NOT NULL AS has_facility_organization,
    signatures.bind_facility IS NOT NULL AS has_bind_facility,
    signatures.prepare_reading IS NOT NULL AS has_prepare_reading,
    signatures.manage_membership IS NOT NULL AS has_manage_membership,
    signatures.accept_invitation IS NOT NULL AS has_accept_invitation,
    signatures.claim_invitations IS NOT NULL AS has_claim_invitations,
    signatures.update_defect IS NOT NULL AS has_update_defect,
    signatures.stamp_temperature IS NULL
      AND signatures.temperature_alert IS NULL
      AND signatures.acknowledge_temperature IS NULL
      AND signatures.protect_temperature_point IS NULL
      AND signatures.protect_temperature_history IS NULL
      AND signatures.stamp_water IS NULL
      AND signatures.record_water IS NULL
      AND signatures.save_water_draft IS NULL
      AND signatures.discard_water_draft IS NULL
      AND to_regclass('public.temperature_points') IS NULL
      AND to_regclass('public.temperature_readings') IS NULL
      AND to_regclass('public.temperature_alerts') IS NULL
      AND to_regclass('public.water_pools') IS NULL
      AND to_regclass('public.water_checks') IS NULL
      AND to_regclass('public.water_round_drafts') IS NULL AS upcoming_absent,
    signatures.stamp_water IS NOT NULL AND position('reading_code' IN bodies.stamp_water) = 0 AS water_body_unknown,
    position('technician' IN bodies.meter_role) = 0
      AND position('SECURITY DEFINER' IN bodies.meter_role) > 0
      AND (position('m.is_active IS TRUE' IN bodies.meter_role) > 0 OR position('m.is_active = true' IN bodies.meter_role) > 0)
      AND position('(m.role = ''company_admin'' AND m.facility_id IS NULL)' IN bodies.meter_role) > 0
      AND position('(m.role = ''facility_manager'' AND m.facility_id = p_facility_id)' IN bodies.meter_role) > 0
      AND position('(m.role = ''employee'' AND m.facility_id = p_facility_id)' IN bodies.meter_role) > 0
      AND position('WHEN ''company_admin'' THEN 1' IN bodies.meter_role) > 0
      AND position('WHEN ''facility_manager'' THEN 2' IN bodies.meter_role) > 0
      AND position('ELSE 3' IN bodies.meter_role) > 0 AS meter_role_known,
    position('technician' IN bodies.prepare_reading) = 0
      AND position('actor_role = ''employee'' AND NEW.reading_type <> ''regular''' IN bodies.prepare_reading) > 0
      AND position('actor_role NOT IN (''company_admin'', ''facility_manager'')' IN bodies.prepare_reading) > 0
      AND position('Stornieren darf die Betriebsleitung oder Geschäftsführung.' IN bodies.prepare_reading) > 0
      AND position('Eine Stornierung ändert nur den Stornierungsvermerk.' IN bodies.prepare_reading) > 0
      AND position('Die Korrektur bezieht sich auf eine gültige ursprüngliche Ablesung desselben Zählers.' IN bodies.prepare_reading) > 0 AS prepare_reading_known,
    position('technician' IN bodies.manage_membership) = 0
      AND position('Keine Verwaltungsberechtigung fuer diesen Betrieb' IN bodies.manage_membership) > 0
      AND position('Ungueltige Rolle' IN bodies.manage_membership) > 0
      AND position('Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen' IN bodies.manage_membership) > 0
      AND position('Geschaeftsfuehrungsrechte werden hier nicht veraendert' IN bodies.manage_membership) > 0
      AND position('Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten' IN bodies.manage_membership) > 0
      AND position('Eigene Berechtigungen hier nicht veraenderbar' IN bodies.manage_membership) > 0
      AND (
        position('p_role NOT IN (''employee'',''facility_manager'')' IN bodies.manage_membership) > 0
        OR position('p_role NOT IN (''employee'', ''facility_manager'')' IN bodies.manage_membership) > 0
      )
      AND (
        position('Reaktivierung nur ueber gesonderte Freigabe' IN bodies.manage_membership) > 0
        OR position('DELETE FROM public.memberships' IN bodies.manage_membership) > 0
      ) AS manage_membership_known,
    position('technician' IN bodies.accept_invitation) = 0
      AND position('Bitte zuerst anmelden.' IN bodies.accept_invitation) > 0
      AND position('Die E-Mail-Adresse ist noch nicht bestätigt.' IN bodies.accept_invitation) > 0
      AND position('status = ''sent''' IN bodies.accept_invitation) > 0
      AND position('role = ''employee''' IN bodies.accept_invitation) > 0
      AND position('Keine offene Einladung gefunden.' IN bodies.accept_invitation) > 0
      AND position('staff_invitations' IN bodies.accept_invitation) > 0 AS accept_invitation_known,
    position('technician' IN bodies.claim_invitations) = 0
      AND position('IF auth.uid() IS NULL THEN RETURN 0' IN bodies.claim_invitations) > 0
      AND (
        position('status=''sent''' IN bodies.claim_invitations) > 0
        OR position('status = ''sent''' IN bodies.claim_invitations) > 0
      )
      AND (
        position('r.facility_id,''employee''' IN bodies.claim_invitations) > 0
        OR position('r.facility_id, ''employee''' IN bodies.claim_invitations) > 0
      ) AS claim_invitations_known,
    position('SECURITY DEFINER' IN bodies.update_defect) > 0
      AND position('Anmeldung erforderlich' IN bodies.update_defect) > 0
      AND position('Mitarbeiter koennen nur bearbeiten oder Erledigung melden' IN bodies.update_defect) > 0
      AND position('Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich' IN bodies.update_defect) > 0
      AND position('Mangel nicht gefunden' IN bodies.update_defect) > 0
      AND position('assigned_to IS DISTINCT FROM auth.uid()' IN bodies.update_defect) > 0
      AND position('Dieser Mangel ist dir nicht zugewiesen' IN bodies.update_defect) > 0
      AND position('Keine Betriebsberechtigung' IN bodies.update_defect) > 0
      AND position('Vorgang ist bereits abgeschlossen oder wartet auf Freigabe' IN bodies.update_defect) > 0
      AND position('FOR UPDATE' IN bodies.update_defect) > 0
      AND (position('m.organization_id=d.organization_id' IN bodies.update_defect) > 0 OR position('m.organization_id = d.organization_id' IN bodies.update_defect) > 0)
      AND (position('m.facility_id=d.facility_id' IN bodies.update_defect) > 0 OR position('m.facility_id = d.facility_id' IN bodies.update_defect) > 0)
      AND (position('m.role=''company_admin''' IN bodies.update_defect) > 0 OR position('m.role = ''company_admin''' IN bodies.update_defect) > 0)
      AND (position('p_status NOT IN (''in_progress'',''pending_review'')' IN bodies.update_defect) > 0 OR position('p_status NOT IN (''in_progress'', ''pending_review'')' IN bodies.update_defect) > 0)
      AND (position('d.status IN (''resolved'',''pending_review'')' IN bodies.update_defect) > 0 OR position('d.status IN (''resolved'', ''pending_review'')' IN bodies.update_defect) > 0)
      AND position('UPDATE public.defects SET status=p_status, change_note=' IN bodies.update_defect) > 0
      AND position('SET assigned_to' IN bodies.update_defect) = 0
      AND position('SET facility_id' IN bodies.update_defect) = 0
      AND position('SET organization_id' IN bodies.update_defect) = 0 AS update_defect_safe,
    position('m.is_active = true' IN bodies.update_defect) > 0
      OR position('m.is_active IS TRUE' IN bodies.update_defect) > 0 AS update_defect_active,
    (
      position('= ''employee''' IN bodies.update_defect) = 0
      AND position('<> ''employee''' IN bodies.update_defect) = 0
      AND (
        position('m.role=''company_admin'' OR m.facility_id=d.facility_id' IN bodies.update_defect) > 0
        OR position('m.role = ''company_admin'' OR m.facility_id = d.facility_id' IN bodies.update_defect) > 0
      )
    )
    OR (
      position('technician' IN bodies.update_defect) > 0
      AND position('assigned_to IS DISTINCT FROM auth.uid()' IN bodies.update_defect) > 0
      AND (position('m.facility_id=d.facility_id' IN bodies.update_defect) > 0 OR position('m.facility_id = d.facility_id' IN bodies.update_defect) > 0)
    )
    OR position('= ''employee''' IN bodies.update_defect) > 0
    OR position('<> ''employee''' IN bodies.update_defect) > 0 AS update_defect_known,
    to_regclass('public.facilities') IS NOT NULL AS has_facilities,
    to_regclass('public.memberships') IS NOT NULL AS has_memberships,
    to_regclass('public.utility_meters') IS NOT NULL AS has_meters,
    to_regclass('public.utility_meter_readings') IS NOT NULL AS has_readings,
    to_regclass('public.staff_invitations') IS NOT NULL AS has_invitations,
    to_regclass('public.daily_reports') IS NOT NULL AS has_daily_reports,
    to_regclass('public.temperature_points') IS NULL AS temperature_absent,
    to_regclass('public.water_pools') IS NULL AS water_absent
  FROM signatures
  CROSS JOIN bodies
),
role_column AS (
  SELECT columns.data_type
  FROM (SELECT 1) AS seed
  LEFT JOIN information_schema.columns AS columns
    ON columns.table_schema = 'public'
    AND columns.table_name = 'memberships'
    AND columns.column_name = 'role'
),
role_values AS (
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE role NOT IN ('employee', 'facility_manager', 'company_admin')
  ) AS unexpected_role
),
role_constraints AS (
  SELECT
    count(*) AS constraint_count,
    coalesce(bool_and(
      definition ILIKE '%facility_manager%'
      AND definition ILIKE '%company_admin%'
      AND definition !~* 'is_active|created|updated|profile'
    ), false) AS extendable
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
  ) AS definitions
),
reading_policy AS (
  SELECT policy.with_check
  FROM (SELECT 1) AS seed
  LEFT JOIN pg_policies AS policy
    ON policy.schemaname = 'public'
    AND policy.tablename = 'utility_meter_readings'
    AND policy.policyname = 'utility_meter_readings_insert'
),
invitation_role AS (
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_invitations' AND column_name = 'role'
    ) AS has_role_column,
    EXISTS (
      SELECT 1 FROM public.staff_invitations
      WHERE role IS NOT NULL AND role NOT IN ('employee', 'technician')
    ) AS unexpected_role
),
checks AS (
  SELECT 10 AS sort, 'Funktionen vorhanden' AS pruefung,
    CASE WHEN has_meter_role AND has_facility_organization AND has_bind_facility AND has_prepare_reading
      AND has_manage_membership AND has_accept_invitation AND has_facilities AND has_memberships
      AND has_meters AND has_readings AND has_invitations AND has_daily_reports
      AND temperature_absent AND water_absent THEN 'bereit' ELSE 'stoppen' END AS status,
    CASE WHEN has_meter_role AND has_facility_organization AND has_bind_facility AND has_prepare_reading
      AND has_manage_membership AND has_accept_invitation AND has_facilities AND has_memberships
      AND has_meters AND has_readings AND has_invitations AND has_daily_reports
      AND temperature_absent AND water_absent
      THEN 'Betriebe, Zähler, Einladungen und die Ausgangsfunktionen sind vorhanden.'
      ELSE 'Eine Ausgangsfunktion oder Betriebstabelle fehlt, oder Temperatur oder Wasser ist schon vorhanden.' END AS details
  FROM facts
  UNION ALL
  SELECT 20, 'tageswerk_meter_role entspricht 2.9',
    CASE WHEN has_meter_role AND meter_role_known THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN NOT has_meter_role THEN 'tageswerk_meter_role fehlt.'
      WHEN meter_role_known THEN 'Bekannte Funktionsfassung erkannt.'
      ELSE 'Der Funktionskörper entspricht nicht der Fassung aus Tageswerk 2.9.' END
  FROM facts
  UNION ALL
  SELECT 30, 'tageswerk_prepare_reading entspricht der Importfassung',
    CASE WHEN has_prepare_reading AND prepare_reading_known THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN NOT has_prepare_reading THEN 'tageswerk_prepare_reading fehlt.'
      WHEN prepare_reading_known THEN 'Bekannte Funktionsfassung erkannt.'
      ELSE 'Der Funktionskörper entspricht nicht der Importfassung.' END
  FROM facts
  UNION ALL
  SELECT 40, 'manage_facility_membership entspricht 2.8',
    CASE WHEN has_manage_membership AND manage_membership_known THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN NOT has_manage_membership THEN 'manage_facility_membership fehlt.'
      WHEN manage_membership_known THEN 'Berechtigungsprüfung vorhanden.'
      ELSE 'Der Funktionskörper entspricht nicht der geprüften produktiven Fassung.' END
  FROM facts
  UNION ALL
  SELECT 50, 'accept_staff_invitation entspricht 2.8',
    CASE WHEN has_accept_invitation AND accept_invitation_known THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN NOT has_accept_invitation THEN 'accept_staff_invitation fehlt.'
      WHEN accept_invitation_known THEN 'Bekannte Funktionsfassung erkannt.'
      ELSE 'Der Funktionskörper entspricht nicht der geprüften produktiven Fassung.' END
  FROM facts
  UNION ALL
  SELECT 60, 'claim_staff_invitations entspricht 2.8 oder fehlt',
    CASE WHEN NOT has_claim_invitations OR claim_invitations_known THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN NOT has_claim_invitations THEN 'Die Funktion fehlt und wird nicht vorausgesetzt.'
      WHEN claim_invitations_known THEN 'Bekannte Funktionsfassung erkannt.'
      ELSE 'Der Funktionskörper ist unbekannt.' END
  FROM facts
  UNION ALL
  SELECT 70, 'employee_update_assigned_defect ist die geprüfte Fassung',
    CASE
      WHEN NOT has_update_defect THEN 'bereit'
      WHEN NOT update_defect_safe THEN 'stoppen'
      WHEN update_defect_known THEN 'bereit'
      ELSE 'stoppen'
    END,
    CASE
      WHEN NOT has_update_defect THEN 'Die Funktion fehlt und wird nicht vorausgesetzt.'
      WHEN NOT update_defect_safe THEN 'Zuweisung, Betrieb oder eine andere Sicherheitsprüfung fehlt.'
      WHEN update_defect_known AND NOT update_defect_active THEN 'Bekannte produktive Fassung. Die Migration ergänzt die aktive Mitgliedschaft.'
      WHEN update_defect_known THEN 'Aktive Mitgliedschaft, Zuweisung und Betrieb werden geprüft.'
      ELSE 'Der Funktionskörper ist unbekannt.'
    END
  FROM facts
  UNION ALL
  SELECT 80, 'Mitgliedsrolle ist Text und bleibt bei den drei bestehenden Rollen',
    CASE WHEN role_column.data_type = 'text' AND NOT role_values.unexpected_role THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN role_column.data_type IS NULL THEN 'Die Spalte memberships.role fehlt.'
      WHEN role_column.data_type <> 'text' THEN 'Die Mitgliedsrolle ist kein Text.'
      WHEN role_values.unexpected_role THEN 'Es gibt eine Rolle außerhalb von Mitarbeiter, Betriebsleitung und Geschäftsführung.'
      ELSE 'Die drei bestehenden Rollen bleiben erhalten.' END
  FROM role_column
  CROSS JOIN role_values
  UNION ALL
  SELECT 90, 'Rollenprüfung lässt sich um Techniker erweitern',
    CASE WHEN role_constraints.constraint_count > 0 AND role_constraints.extendable THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN role_constraints.constraint_count = 0 THEN 'Keine erweiterbare Rollenprüfung ohne Techniker gefunden.'
      WHEN role_constraints.extendable THEN 'Die Rollenprüfung kann um den Techniker erweitert werden.'
      ELSE 'Die Rollenprüfung hat eine unbekannte Form.' END
  FROM role_constraints
  UNION ALL
  SELECT 100, 'Zähler-Insert entspricht der geprüften Richtlinie',
    CASE WHEN reading_policy.with_check IS NOT NULL
      AND position('technician' IN reading_policy.with_check) = 0
      AND position('employee' IN reading_policy.with_check) > 0
      AND position('reading_type' IN reading_policy.with_check) > 0
      AND position('regular' IN reading_policy.with_check) > 0
      AND position('company_admin' IN reading_policy.with_check) > 0
      AND position('facility_manager' IN reading_policy.with_check) > 0
      THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN reading_policy.with_check IS NULL THEN 'Die Richtlinie utility_meter_readings_insert fehlt.'
      WHEN position('technician' IN reading_policy.with_check) = 0
        AND position('employee' IN reading_policy.with_check) > 0
        AND position('reading_type' IN reading_policy.with_check) > 0
        AND position('regular' IN reading_policy.with_check) > 0
        AND position('company_admin' IN reading_policy.with_check) > 0
        AND position('facility_manager' IN reading_policy.with_check) > 0
      THEN 'Die bekannte Zählerrichtlinie ist vorhanden.'
      ELSE 'Die Zählerrichtlinie entspricht nicht der geprüften Fassung.' END
  FROM reading_policy
  UNION ALL
  SELECT 110, 'Einladungsrollen bleiben Mitarbeiter',
    CASE
      WHEN NOT facts.has_invitations THEN 'stoppen'
      WHEN NOT invitation_role.has_role_column THEN 'bereit'
      WHEN invitation_role.unexpected_role THEN 'stoppen'
      ELSE 'bereit'
    END,
    CASE
      WHEN NOT facts.has_invitations THEN 'Die Tabelle staff_invitations fehlt.'
      WHEN NOT invitation_role.has_role_column THEN 'Die Rollenspalte fehlt noch und wird mit der Einladung angelegt.'
      WHEN invitation_role.unexpected_role THEN 'Eine Einladung enthält eine Rolle außerhalb von Mitarbeiter und Techniker.'
      ELSE 'Vorhandene Einladungsrollen bleiben Mitarbeiter oder Techniker.'
    END
  FROM facts
  CROSS JOIN invitation_role
  UNION ALL
  SELECT 120, 'Neue Temperatur- und Wasserfunktionen fehlen noch',
    CASE
      WHEN facts.upcoming_absent THEN 'bereit'
      WHEN facts.water_body_unknown THEN 'stoppen'
      ELSE 'stoppen'
    END,
    CASE
      WHEN facts.upcoming_absent THEN 'Neue Funktionen sind noch nicht installiert.'
      WHEN facts.water_body_unknown THEN 'Die Wasserfunktion hat einen unbekannten Funktionskörper.'
      ELSE 'Temperatur oder Wasserhygiene ist bereits vorhanden.'
    END
  FROM facts
)
SELECT result.pruefung, result.status, result.details
FROM (
  SELECT checks.sort, checks.pruefung, checks.status, checks.details
  FROM checks
  UNION ALL
  SELECT 130, 'Freigabe',
    CASE WHEN bool_and(checks.status = 'bereit') THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN bool_and(checks.status = 'bereit') THEN 'Alle Voraussetzungen sind erfüllt. Die Installation bleibt eine gesonderte Freigabe.'
      ELSE 'Keine Installation, solange eine Prüfung nicht bereit ist.' END
  FROM checks
) AS result
ORDER BY result.sort;

-- Abschnitt 1, unmittelbar nach tageswerk_3_1_temperature.sql
-- Fehlt die Installation, lautet das Ergebnis pruefen. Die Abfrage bricht nicht ab.

SELECT 'Temperatur 3.1' AS pruefung,
  CASE WHEN ok THEN 'installiert' ELSE 'pruefen' END AS status,
  CASE WHEN ok THEN 'Tabellen, Funktionen und Berechtigungen der Temperatur sind vorhanden.'
    ELSE 'Die Temperaturinstallation ist nicht vollständig.' END AS details
FROM (
  SELECT
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
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.temperature_points'), 'DELETE'), false) AS ok
) AS installation;

-- Abschnitt 2, unmittelbar nach tageswerk_3_2_temperature_points.sql

SELECT 'Temperatur 3.2' AS pruefung,
  CASE WHEN ok THEN 'installiert' ELSE 'pruefen' END AS status,
  CASE WHEN ok THEN 'Intervall und Schutz der Messstellen sind vorhanden.'
    ELSE 'Die Messstelleninstallation ist nicht vollständig.' END AS details
FROM (
  SELECT
    to_regclass('public.temperature_points') IS NOT NULL
    AND (
      SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'temperature_points'
        AND column_name IN ('interval_unit', 'interval_count')
    ) = 2
    AND to_regprocedure('public.tageswerk_protect_temperature_point()') IS NOT NULL
    AND to_regprocedure('public.tageswerk_protect_temperature_history()') IS NOT NULL
    AND has_table_privilege('authenticated', to_regclass('public.temperature_points'), 'UPDATE')
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.temperature_points'), 'DELETE'), false) AS ok
) AS installation;

-- Abschnitt 3, unmittelbar nach tageswerk_3_3_water_hygiene.sql

WITH signatures AS (
  SELECT to_regprocedure('public.tageswerk_stamp_water_check()') AS stamp_water
),
installation AS (
  SELECT
    to_regclass('public.water_parameter_definitions') IS NOT NULL
    AND to_regclass('public.water_pools') IS NOT NULL
    AND to_regclass('public.water_checks') IS NOT NULL
    AND to_regclass('public.water_alerts') IS NOT NULL
    AND to_regclass('public.water_round_drafts') IS NOT NULL
    AND to_regclass('public.water_round_discards') IS NOT NULL
    AND to_regprocedure('public.tageswerk_record_water_round(uuid,jsonb)') IS NOT NULL
    AND to_regprocedure('public.tageswerk_save_water_round_draft(uuid,uuid,jsonb,jsonb,integer)') IS NOT NULL
    AND to_regprocedure('public.tageswerk_discard_water_round_draft(uuid)') IS NOT NULL
    AND signatures.stamp_water IS NOT NULL
    AND has_table_privilege('authenticated', to_regclass('public.water_round_drafts'), 'SELECT')
    AND has_table_privilege('authenticated', to_regclass('public.water_round_drafts'), 'INSERT')
    AND has_table_privilege('authenticated', to_regclass('public.water_round_drafts'), 'UPDATE')
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.water_round_discards'), 'SELECT'), false)
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.water_round_discards'), 'INSERT'), false)
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.water_round_discards'), 'UPDATE'), false)
    AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.water_round_discards'), 'DELETE'), false)
    AND NOT coalesce(has_table_privilege('anon', to_regclass('public.water_checks'), 'SELECT'), false)
    AND position('reading_code' IN CASE
      WHEN signatures.stamp_water IS NULL THEN ''
      ELSE pg_get_functiondef(signatures.stamp_water)
    END) > 0 AS ok
  FROM signatures
)
SELECT 'Wasserhygiene 3.3' AS pruefung,
  CASE WHEN ok THEN 'installiert' ELSE 'pruefen' END AS status,
  CASE WHEN ok THEN 'Becken, Entwürfe, Abschluss und die Parameterauflösung sind vorhanden.'
    ELSE 'Die Wasserinstallation ist nicht vollständig oder der Funktionskörper ist unbekannt.' END AS details
FROM installation;

-- Abschnitt 4, unmittelbar nach tageswerk_3_4_technician_role.sql

WITH signatures AS (
  SELECT
    to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') AS meter_role,
    to_regprocedure('public.tageswerk_prepare_reading()') AS prepare_reading,
    to_regprocedure('public.manage_facility_membership(text,uuid,text,boolean)') AS manage_membership
),
bodies AS (
  SELECT
    CASE WHEN signatures.meter_role IS NULL THEN ''
      ELSE regexp_replace(pg_get_functiondef(signatures.meter_role), '[[:space:]]+', ' ', 'g') END AS meter_body,
    CASE WHEN signatures.prepare_reading IS NULL THEN ''
      ELSE regexp_replace(pg_get_functiondef(signatures.prepare_reading), '[[:space:]]+', ' ', 'g') END AS reading_body,
    CASE WHEN signatures.manage_membership IS NULL THEN ''
      ELSE regexp_replace(pg_get_functiondef(signatures.manage_membership), '[[:space:]]+', ' ', 'g') END AS manage_body
  FROM signatures
),
installation AS (
  SELECT
    signatures.meter_role IS NOT NULL
    AND signatures.prepare_reading IS NOT NULL
    AND signatures.manage_membership IS NOT NULL
    AND position('WHEN ''technician'' THEN 3' IN bodies.meter_body) > 0
    AND position('actor_role IN (''employee'', ''technician'') AND NEW.reading_type <> ''regular''' IN bodies.reading_body) > 0
    AND position('Eine deaktivierte Zuordnung wird nur mit derselben Rolle wieder freigegeben.' IN bodies.manage_body) > 0
    AND position('SET is_active = true' IN bodies.manage_body) > 0
    AND EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'memberships'
        AND constraint_row.contype = 'c'
        AND pg_get_constraintdef(constraint_row.oid) ILIKE '%technician%'
    ) AS ok
  FROM signatures
  CROSS JOIN bodies
)
SELECT 'Techniker 3.4' AS pruefung,
  CASE WHEN ok THEN 'installiert' ELSE 'pruefen' END AS status,
  CASE WHEN ok THEN 'Rolle, Zählerprüfung und dieselbe Reaktivierung sind vorhanden.'
    ELSE 'Die Technikerinstallation ist nicht vollständig.' END AS details
FROM installation;

-- Abschnitt 5, unmittelbar nach tageswerk_3_4_invitation_role.sql

WITH signatures AS (
  SELECT
    to_regprocedure('public.tageswerk_guard_invitation_role()') AS guard_role,
    to_regprocedure('public.accept_staff_invitation()') AS accept_invitation
),
bodies AS (
  SELECT CASE WHEN signatures.accept_invitation IS NULL THEN ''
    ELSE regexp_replace(pg_get_functiondef(signatures.accept_invitation), '[[:space:]]+', ' ', 'g') END AS accept_body
  FROM signatures
),
installation AS (
  SELECT
    signatures.guard_role IS NOT NULL
    AND signatures.accept_invitation IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_invitations_role_check')
    AND position('v_role := coalesce(v_invitation.role, ''employee'')' IN bodies.accept_body) > 0
    AND position('coalesce(role, ''employee'') IN (''employee'', ''technician'')' IN bodies.accept_body) > 0
    AND position('UPDATE public.memberships' IN bodies.accept_body) = 0 AS ok
  FROM signatures
  CROSS JOIN bodies
)
SELECT 'Einladung 3.4' AS pruefung,
  CASE WHEN ok THEN 'installiert' ELSE 'pruefen' END AS status,
  CASE WHEN ok THEN 'Die Annahme übernimmt die gespeicherte Mitarbeiter- oder Technikerrolle.'
    ELSE 'Die Einladungsinstallation ist nicht vollständig.' END AS details
FROM installation;
