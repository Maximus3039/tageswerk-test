-- Tageswerk 3.7.0, quittierbare In-App-Hinweise.
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Keine E-Mail, kein Push. Nur der eigene Benutzer sieht und schreibt eigene Quittungen.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_notice_acks (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  notice_id text NOT NULL,
  facility_id uuid REFERENCES public.facilities (id) ON DELETE CASCADE,
  organization_id uuid,
  acknowledged_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (user_id, notice_id),
  CONSTRAINT user_notice_acks_id CHECK (char_length(btrim(notice_id)) BETWEEN 3 AND 200)
);

ALTER TABLE public.user_notice_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notice_acks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notice_acks_select ON public.user_notice_acks;
DROP POLICY IF EXISTS user_notice_acks_insert ON public.user_notice_acks;
DROP POLICY IF EXISTS user_notice_acks_delete ON public.user_notice_acks;

CREATE POLICY user_notice_acks_select ON public.user_notice_acks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_notice_acks_insert ON public.user_notice_acks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_notice_acks_delete ON public.user_notice_acks
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.user_notice_acks FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.user_notice_acks TO authenticated;

COMMIT;
