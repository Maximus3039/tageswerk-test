-- Liest die Ausgangsfassung. Bei einer Abweichung wird keine Migration gestartet.

DO $guard$
BEGIN
  IF current_setting('tageswerk.integration_test', true) IS DISTINCT FROM 'bestaetigt' THEN
    RAISE EXCEPTION 'vorpruefung.sql läuft nur über tests/integration/run.mjs.';
  END IF;
END;
$guard$;

DO $markers$
DECLARE
  definition text;
BEGIN
  definition := regexp_replace(pg_get_functiondef('public.tageswerk_meter_role(uuid,uuid)'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('technician' IN definition) > 0
     OR position('m.is_active IS TRUE' IN definition) = 0
     OR position('(m.role = ''employee'' AND m.facility_id = p_facility_id)' IN definition) = 0
     OR position('ELSE 3' IN definition) = 0 THEN
    RAISE EXCEPTION 'tageswerk_meter_role entspricht nicht der geprüften Ausgangsfassung.';
  END IF;

  definition := regexp_replace(pg_get_functiondef('public.tageswerk_prepare_reading()'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('technician' IN definition) > 0
     OR position('actor_role = ''employee'' AND NEW.reading_type <> ''regular''' IN definition) = 0
     OR position('actor_role NOT IN (''company_admin'', ''facility_manager'')' IN definition) = 0
     OR position('Stornieren darf die Betriebsleitung oder Geschäftsführung.' IN definition) = 0
     OR position('Eine Stornierung ändert nur den Stornierungsvermerk.' IN definition) = 0
     OR position('Die Korrektur bezieht sich auf eine gültige ursprüngliche Ablesung desselben Zählers.' IN definition) = 0 THEN
    RAISE EXCEPTION 'tageswerk_prepare_reading entspricht nicht der geprüften Ausgangsfassung.';
  END IF;

  definition := regexp_replace(pg_get_functiondef('public.manage_facility_membership(text,uuid,text,boolean)'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('technician' IN definition) > 0
     OR position('Keine Verwaltungsberechtigung fuer diesen Betrieb' IN definition) = 0
     OR position('Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten' IN definition) = 0
     OR position('Reaktivierung nur ueber gesonderte Freigabe' IN definition) = 0
     OR position('Geschaeftsfuehrungsrechte werden hier nicht veraendert' IN definition) = 0
     OR (
       position('p_role NOT IN (''employee'',''facility_manager'')' IN definition) = 0
       AND position('p_role NOT IN (''employee'', ''facility_manager'')' IN definition) = 0
     ) THEN
    RAISE EXCEPTION 'manage_facility_membership entspricht nicht der geprüften Ausgangsfassung.';
  END IF;

  definition := regexp_replace(pg_get_functiondef('public.accept_staff_invitation()'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('technician' IN definition) > 0
     OR position('Bitte zuerst anmelden.' IN definition) = 0
     OR position('status = ''sent''' IN definition) = 0
     OR position('role = ''employee''' IN definition) = 0
     OR position('Keine offene Einladung gefunden.' IN definition) = 0
     OR position('Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.' IN definition) = 0 THEN
    RAISE EXCEPTION 'accept_staff_invitation entspricht nicht der geprüften Ausgangsfassung.';
  END IF;

  IF to_regprocedure('public.claim_staff_invitations()') IS NOT NULL THEN
    definition := regexp_replace(pg_get_functiondef('public.claim_staff_invitations()'::regprocedure), '[[:space:]]+', ' ', 'g');
    IF position('technician' IN definition) > 0
       OR (
         position('status=''sent'' AND role=''employee''' IN definition) = 0
         AND position('status = ''sent'' AND role = ''employee''' IN definition) = 0
       ) THEN
      RAISE EXCEPTION 'claim_staff_invitations entspricht nicht der geprüften Ausgangsfassung.';
    END IF;
  END IF;
END;
$markers$;
