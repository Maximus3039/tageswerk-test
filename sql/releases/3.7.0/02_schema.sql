-- Tageswerk 3.7.0 Schema. Nur neue Tabellen und Indizes.
-- Kein DROP TABLE. Keine Änderung an defects, readings, filters, archive.
-- Nicht ausführen ohne bestandene 01_preflight.sql und gesonderte Freigabe.
-- Voraussetzungen: public.facilities.organization_id, public.utility_meters, public.defects.

BEGIN;

DO $facilities_unique$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'facilities'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) = 'UNIQUE (id, organization_id)'
  ) OR EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'facilities'
      AND i.indisunique
      AND i.indnkeyatts = 2
      AND pg_get_indexdef(i.indexrelid) ~ '\(id, organization_id\)'
  ) THEN
    RAISE NOTICE 'facilities(id, organization_id) ist bereits eindeutig. Kein zweiter Index.';
    RETURN;
  END IF;
  EXECUTE $idx$
    CREATE UNIQUE INDEX facilities_id_organization_id_uidx
      ON public.facilities (id, organization_id)
  $idx$;
END;
$facilities_unique$;

CREATE TABLE IF NOT EXISTS public.utility_monthly_consumption (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  medium text NOT NULL,
  unit text NOT NULL,
  meter_id uuid REFERENCES public.utility_meters (id),
  year integer NOT NULL,
  month integer NOT NULL,
  consumption_value numeric(14, 3) NOT NULL,
  note text,
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  corrected_by uuid,
  correction_reason text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT utility_monthly_consumption_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id),
  CONSTRAINT utility_monthly_consumption_medium_unit_check CHECK (
    (medium = 'electricity' AND unit = 'kWh')
    OR (medium = 'water' AND unit = 'm3')
    OR (medium IN ('gas', 'heat') AND unit IN ('kWh', 'm3'))
  ),
  CONSTRAINT utility_monthly_consumption_year_check CHECK (year BETWEEN 1990 AND 2100),
  CONSTRAINT utility_monthly_consumption_month_check CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT utility_monthly_consumption_value_check CHECK (consumption_value >= 0),
  CONSTRAINT utility_monthly_consumption_note_check CHECK (
    note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 2000
  ),
  CONSTRAINT utility_monthly_consumption_correction_check CHECK (
    (
      corrected_by IS NULL
      AND correction_reason IS NULL
    )
    OR (
      corrected_by IS NOT NULL
      AND correction_reason IS NOT NULL
      AND char_length(btrim(correction_reason)) BETWEEN 3 AND 2000
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS utility_monthly_consumption_facility_month
  ON public.utility_monthly_consumption (facility_id, medium, unit, year, month)
  WHERE meter_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS utility_monthly_consumption_meter_month
  ON public.utility_monthly_consumption (meter_id, year, month)
  WHERE meter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS utility_monthly_consumption_facility_year
  ON public.utility_monthly_consumption (facility_id, year, medium);

CREATE TABLE IF NOT EXISTS public.utility_monthly_consumption_revisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  consumption_id uuid NOT NULL REFERENCES public.utility_monthly_consumption (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  previous_value numeric(14, 3) NOT NULL,
  previous_note text,
  new_value numeric(14, 3) NOT NULL,
  new_note text,
  correction_reason text NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT utility_monthly_consumption_revisions_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id),
  CONSTRAINT utility_monthly_consumption_revisions_reason_check CHECK (
    char_length(btrim(correction_reason)) BETWEEN 3 AND 2000
  )
);

CREATE INDEX IF NOT EXISTS utility_monthly_consumption_revisions_consumption
  ON public.utility_monthly_consumption_revisions (consumption_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.defect_photos (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  defect_id uuid NOT NULL REFERENCES public.defects (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  organization_id uuid NOT NULL,
  uploaded_by uuid NOT NULL DEFAULT auth.uid(),
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT defect_photos_path CHECK (char_length(btrim(storage_path)) BETWEEN 8 AND 400),
  CONSTRAINT defect_photos_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id)
);

CREATE INDEX IF NOT EXISTS defect_photos_defect_idx
  ON public.defect_photos (defect_id, created_at DESC);

COMMIT;
