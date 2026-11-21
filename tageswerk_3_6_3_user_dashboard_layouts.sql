-- Tageswerk 3.6.3, gespeicherte Management-Dashboard-Ansichten.
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- layouts ist JSON der persönlichen Ansicht. Es erweitert keine Betriebsrechte.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_dashboard_layouts (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  layouts jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT user_dashboard_layouts_json CHECK (jsonb_typeof(layouts) = 'array')
);

ALTER TABLE public.user_dashboard_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_dashboard_layouts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_dashboard_layouts_select ON public.user_dashboard_layouts;
DROP POLICY IF EXISTS user_dashboard_layouts_write ON public.user_dashboard_layouts;
DROP POLICY IF EXISTS user_dashboard_layouts_insert ON public.user_dashboard_layouts;
DROP POLICY IF EXISTS user_dashboard_layouts_update ON public.user_dashboard_layouts;
DROP POLICY IF EXISTS user_dashboard_layouts_delete ON public.user_dashboard_layouts;

CREATE POLICY user_dashboard_layouts_select ON public.user_dashboard_layouts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_dashboard_layouts_insert ON public.user_dashboard_layouts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_dashboard_layouts_update ON public.user_dashboard_layouts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_dashboard_layouts_delete ON public.user_dashboard_layouts
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.user_dashboard_layouts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_dashboard_layouts TO authenticated;

COMMIT;
