-- Tageswerk 3.6.2 – Standort-UPDATE auf Koordinaten begrenzen
-- NICHT ausführen ohne ausdrückliche Freigabe.
-- Nicht in der Produktivdatenbank anwenden. Zuerst nur Testprojekt gamvnzggcrrlnyoknllu.
--
-- Befund:
-- authenticated hat tabellenweit INSERT/UPDATE/DELETE/TRUNCATE auf public.facilities (ACL arwdDxtm).
-- RLS FORCE: ohne Policy sind INSERT/DELETE bereits verweigert.
-- Policy facilities_location_update öffnet UPDATE für company_admin und facility_manager
-- ohne Spaltenbegrenzung. GRANT UPDATE (latitude, longitude) wirkt nicht, solange
-- tabellenweites UPDATE besteht.
-- Folge: Leitungsrollen können per API Name und organization_id ändern, wenn die Rolle
-- für die Zielorganisation ebenfalls passt (WITH CHECK prüft die neuen Werte).
-- Mitarbeiter bleiben ohne UPDATE-Policy ausgeschlossen.
-- App 3.6.2 schreibt nur latitude/longitude (js/dashboard.js).
--
-- 3.7.1 Betriebsverwaltung:
-- Dieses Skript sperrt organisation_id und id dauerhaft per Trigger.
-- Spätere Pflege (Name, Standorttext o. Ä.) braucht eigene GRANT UPDATE (spalte, …)
-- und eine eigene Policy – kein tabellenweites GRANT UPDATE wiederherstellen.
-- INSERT neuer Betriebe ebenfalls nur über eigene Policy oder SECURITY DEFINER,
-- nicht über tabellenweites INSERT für authenticated.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.facilities') IS NULL THEN
    RAISE EXCEPTION 'facilities fehlt.';
  END IF;
  IF to_regprocedure('public.tageswerk_meter_role(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_meter_role fehlt.';
  END IF;
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name IN ('latitude', 'longitude')
  ) < 2 THEN
    RAISE EXCEPTION 'Koordinaten-Spalten fehlen.';
  END IF;
END;
$guard$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.facilities FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.facilities TO authenticated;
GRANT UPDATE (latitude, longitude) ON TABLE public.facilities TO authenticated;

CREATE OR REPLACE FUNCTION public.tageswerk_protect_facility_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Die Betriebskennung darf nicht geändert werden.';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Die Organisationszuordnung eines Betriebs darf nicht geändert werden.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

DROP TRIGGER IF EXISTS facilities_protect_identity ON public.facilities;
CREATE TRIGGER facilities_protect_identity
  BEFORE UPDATE ON public.facilities
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_facility_identity();

REVOKE ALL ON FUNCTION public.tageswerk_protect_facility_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_protect_facility_identity() TO authenticated;

DROP POLICY IF EXISTS facilities_location_update ON public.facilities;
CREATE POLICY facilities_location_update ON public.facilities
  FOR UPDATE TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, id) IN ('company_admin', 'facility_manager')
  )
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, id) IN ('company_admin', 'facility_manager')
  );

COMMENT ON FUNCTION public.tageswerk_protect_facility_identity() IS
  'Verhindert Wechsel von id und organization_id. Standort-UPDATE bleibt bei latitude/longitude. 3.7.1 darf Name über zusätzliche Spaltenrechte pflegen, nicht über diesen Trigger umgehen.';

COMMIT;
