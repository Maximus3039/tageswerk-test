-- Tageswerk 3.6.3, fehlgeschlagene oder widerrufene Einladung erneut auf pending setzen.
-- Nicht ohne ausdrückliche Freigabe ausführen. Nicht auf PROD ohne gesonderte Freigabe.
-- Setzt nur status/error_detail/updated_at. Keine Rolle, kein Betrieb, keine E-Mail-Änderung.
-- Der anschließende Versand muss dieselbe Einladungs-ID verwenden, keine zweite INSERT-Zeile.

BEGIN;

CREATE OR REPLACE FUNCTION public.retry_staff_invitation(p_invitation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.staff_invitations;
  v_open uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Anmeldung erforderlich';
  END IF;
  SELECT * INTO v_row FROM public.staff_invitations WHERE id = p_invitation_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Einladung nicht gefunden';
  END IF;
  IF NOT private.can_manage_facility(v_row.facility_id) THEN
    RAISE EXCEPTION 'Keine aktive Verwaltungsberechtigung fuer diesen Betrieb';
  END IF;
  IF v_row.status NOT IN ('failed', 'revoked') THEN
    RAISE EXCEPTION 'Nur fehlgeschlagene oder widerrufene Einladungen koennen erneut vorbereitet werden.';
  END IF;
  SELECT invitation.id
    INTO v_open
    FROM public.staff_invitations AS invitation
   WHERE invitation.id <> p_invitation_id
     AND invitation.facility_id = v_row.facility_id
     AND pg_catalog.lower(invitation.email) = pg_catalog.lower(v_row.email)
     AND invitation.status IN ('pending', 'sent', 'failed')
   LIMIT 1;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'Fuer diese E-Mail-Adresse liegt bereits eine offene Einladung vor.';
  END IF;
  UPDATE public.staff_invitations
     SET status = 'pending',
         error_detail = NULL,
         updated_at = pg_catalog.now()
   WHERE id = p_invitation_id
     AND status IN ('failed', 'revoked');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Die Einladung konnte nicht erneut vorbereitet werden.';
  END IF;
  RETURN p_invitation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.retry_staff_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_staff_invitation(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
