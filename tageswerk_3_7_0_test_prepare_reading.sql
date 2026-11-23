-- Tageswerk 3.7.0 TEST: volle Ableselogik statt Stub.
-- NUR gamvnzggcrrlnyoknllu. Nicht auf PROD.
-- Rumpf aus tageswerk_2_9_migration.sql. Kein DROP von Zählern oder Ablesungen.

BEGIN;

ALTER TABLE public.utility_meter_readings
  ADD COLUMN IF NOT EXISTS photo_path text,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

DO $checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_readings_photo_check') THEN
    ALTER TABLE public.utility_meter_readings
      ADD CONSTRAINT utility_readings_photo_check
      CHECK (photo_path IS NULL OR char_length(photo_path) BETWEEN 1 AND 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_readings_void_check') THEN
    ALTER TABLE public.utility_meter_readings
      ADD CONSTRAINT utility_readings_void_check
      CHECK (
        (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
        OR (
          voided_at IS NOT NULL
          AND voided_by IS NOT NULL
          AND void_reason IS NOT NULL
          AND char_length(btrim(void_reason)) BETWEEN 3 AND 2000
        )
      );
  END IF;
END;
$checks$;

CREATE OR REPLACE FUNCTION public.tageswerk_prepare_reading()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  meter public.utility_meters%ROWTYPE;
  actor_role text;
  original public.utility_meter_readings%ROWTYPE;
  previous_reading public.utility_meter_readings%ROWTYPE;
  next_reading public.utility_meter_readings%ROWTYPE;
  previous_value numeric;
  next_value numeric;
  fallback_value numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;

  SELECT * INTO meter
  FROM public.utility_meters
  WHERE id = CASE WHEN TG_OP = 'UPDATE' THEN OLD.meter_id ELSE NEW.meter_id END;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zähler wurde nicht gefunden.';
  END IF;

  actor_role := public.tageswerk_meter_role(meter.organization_id, meter.facility_id);
  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Zähler.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('tageswerk.utility_facility'),
    hashtext(meter.facility_id::text)
  );

  SELECT * INTO meter
  FROM public.utility_meters
  WHERE id = CASE WHEN TG_OP = 'UPDATE' THEN OLD.meter_id ELSE NEW.meter_id END;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'Eine Stornierung ist endgültig.';
    END IF;
    IF NEW.meter_id IS DISTINCT FROM OLD.meter_id
       OR NEW.series_id IS DISTINCT FROM OLD.series_id
       OR NEW.reading_type IS DISTINCT FROM OLD.reading_type
       OR NEW.reading_value IS DISTINCT FROM OLD.reading_value
       OR NEW.reading_at IS DISTINCT FROM OLD.reading_at
       OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.note IS DISTINCT FROM OLD.note
       OR NEW.photo_path IS DISTINCT FROM OLD.photo_path
       OR NEW.corrects_reading_id IS DISTINCT FROM OLD.corrects_reading_id
       OR NEW.parent_meter_id IS DISTINCT FROM OLD.parent_meter_id
       OR NEW.counts_in_facility_total IS DISTINCT FROM OLD.counts_in_facility_total THEN
      RAISE EXCEPTION 'Eine Stornierung ändert nur den Stornierungsvermerk.';
    END IF;
    IF NEW.voided_at IS NULL OR NEW.void_reason IS NULL THEN
      RAISE EXCEPTION 'Eine vorhandene Ablesung kann nur mit Begründung storniert werden.';
    END IF;
    IF actor_role NOT IN ('company_admin', 'facility_manager') THEN
      RAISE EXCEPTION 'Stornieren darf die Betriebsleitung oder Geschäftsführung.';
    END IF;

    NEW.voided_at := now();
    NEW.voided_by := auth.uid();
    NEW.void_reason := btrim(NEW.void_reason);

    IF OLD.reading_type <> 'correction'
       AND EXISTS (
         SELECT 1
         FROM public.utility_meter_readings correction
         WHERE correction.corrects_reading_id = OLD.id
           AND correction.voided_at IS NULL
       ) THEN
      RAISE EXCEPTION 'Diese Ablesung hat eine gültige Korrektur und kann nicht storniert werden. Stornieren Sie zuerst die Korrektur.';
    END IF;

    IF OLD.reading_type = 'reset'
       AND EXISTS (
         SELECT 1
         FROM public.utility_meter_readings later
         WHERE later.meter_id = OLD.meter_id
           AND later.id <> OLD.id
           AND later.voided_at IS NULL
           AND later.reading_type <> 'correction'
           AND later.reading_at > OLD.reading_at
       ) THEN
      RAISE EXCEPTION 'Eine Rücksetzung mit späteren Ablesungen kann nicht storniert werden.';
    END IF;

    IF OLD.reading_type <> 'correction'
       AND NOT EXISTS (
         SELECT 1
         FROM public.utility_meter_readings earlier
         WHERE earlier.meter_id = OLD.meter_id
           AND earlier.series_id = OLD.series_id
           AND earlier.id <> OLD.id
           AND earlier.voided_at IS NULL
           AND earlier.reading_type <> 'correction'
           AND earlier.reading_at < OLD.reading_at
       )
       AND EXISTS (
         SELECT 1
         FROM public.utility_meter_readings later
         WHERE later.meter_id = OLD.meter_id
           AND later.series_id = OLD.series_id
           AND later.id <> OLD.id
           AND later.voided_at IS NULL
           AND later.reading_type <> 'correction'
           AND later.reading_at > OLD.reading_at
       ) THEN
      RAISE EXCEPTION 'Der erste Stand einer fortgesetzten Zählreihe kann nicht storniert werden.';
    END IF;

    IF OLD.reading_type = 'regular'
       AND EXISTS (
         SELECT 1
         FROM public.utility_meter_readings later
         WHERE later.meter_id = OLD.meter_id
           AND later.series_id = OLD.series_id
           AND later.voided_at IS NULL
           AND later.reading_type = 'reset'
           AND later.reading_at > OLD.reading_at
           AND NOT EXISTS (
             SELECT 1
             FROM public.utility_meter_readings between_reading
             WHERE between_reading.meter_id = OLD.meter_id
               AND between_reading.series_id = OLD.series_id
               AND between_reading.id <> OLD.id
               AND between_reading.voided_at IS NULL
               AND between_reading.reading_type = 'regular'
               AND between_reading.reading_at > OLD.reading_at
               AND between_reading.reading_at < later.reading_at
           )
       ) THEN
      RAISE EXCEPTION 'Der letzte normale Stand vor einer Rücksetzung kann nicht storniert werden.';
    END IF;

    IF OLD.reading_type = 'correction' THEN
      SELECT * INTO original
      FROM public.utility_meter_readings
      WHERE id = OLD.corrects_reading_id;
      SELECT COALESCE(
        (
          SELECT other.reading_value
          FROM public.utility_meter_readings other
          WHERE other.corrects_reading_id = original.id
            AND other.id <> OLD.id
            AND other.voided_at IS NULL
          ORDER BY other.created_at DESC, other.id DESC
          LIMIT 1
        ),
        original.reading_value
      ) INTO fallback_value;
      SELECT * INTO previous_reading
      FROM public.utility_meter_readings anchor
      WHERE anchor.meter_id = original.meter_id
        AND anchor.series_id = original.series_id
        AND anchor.id <> original.id
        AND anchor.voided_at IS NULL
        AND anchor.reading_type <> 'correction'
        AND anchor.reading_at < original.reading_at
      ORDER BY anchor.reading_at DESC, anchor.created_at DESC
      LIMIT 1;
      SELECT * INTO next_reading
      FROM public.utility_meter_readings anchor
      WHERE anchor.meter_id = original.meter_id
        AND anchor.series_id = original.series_id
        AND anchor.id <> original.id
        AND anchor.voided_at IS NULL
        AND anchor.reading_type <> 'correction'
        AND anchor.reading_at > original.reading_at
      ORDER BY anchor.reading_at ASC, anchor.created_at ASC
      LIMIT 1;
      IF original.reading_type = 'regular' THEN
        previous_value := CASE WHEN previous_reading.id IS NULL THEN NULL
          ELSE public.tageswerk_effective_reading_value(previous_reading.id) END;
        next_value := CASE
          WHEN next_reading.id IS NULL OR next_reading.reading_type = 'reset' THEN NULL
          ELSE public.tageswerk_effective_reading_value(next_reading.id) END;
        IF (previous_value IS NOT NULL AND fallback_value < previous_value)
           OR (next_value IS NOT NULL AND fallback_value > next_value) THEN
          RAISE EXCEPTION 'Die Stornierung würde einen unplausiblen Zählerstand wiederherstellen.';
        END IF;
      ELSIF original.reading_type = 'reset' THEN
        IF next_reading.id IS NOT NULL THEN
          IF next_reading.reading_type IS DISTINCT FROM 'regular'
             OR fallback_value > public.tageswerk_effective_reading_value(next_reading.id) THEN
            RAISE EXCEPTION 'Die Stornierung würde einen unplausiblen Rücksetzstand wiederherstellen.';
          END IF;
        END IF;
      ELSE
        RAISE EXCEPTION 'Diese Korrektur kann nicht sicher storniert werden.';
      END IF;
    ELSIF OLD.reading_type = 'regular' THEN
      SELECT * INTO previous_reading
      FROM public.utility_meter_readings anchor
      WHERE anchor.meter_id = OLD.meter_id
        AND anchor.series_id = OLD.series_id
        AND anchor.id <> OLD.id
        AND anchor.voided_at IS NULL
        AND anchor.reading_type <> 'correction'
        AND anchor.reading_at < OLD.reading_at
      ORDER BY anchor.reading_at DESC, anchor.created_at DESC
      LIMIT 1;
      SELECT * INTO next_reading
      FROM public.utility_meter_readings anchor
      WHERE anchor.meter_id = OLD.meter_id
        AND anchor.series_id = OLD.series_id
        AND anchor.id <> OLD.id
        AND anchor.voided_at IS NULL
        AND anchor.reading_type <> 'correction'
        AND anchor.reading_at > OLD.reading_at
      ORDER BY anchor.reading_at ASC, anchor.created_at ASC
      LIMIT 1;
      IF previous_reading.id IS NOT NULL
         AND next_reading.reading_type = 'regular'
         AND public.tageswerk_effective_reading_value(next_reading.id)
             < public.tageswerk_effective_reading_value(previous_reading.id) THEN
        RAISE EXCEPTION 'Die Stornierung würde die Zählreihe unplausibel machen.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.reading_type <> 'correction' AND meter.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Für einen deaktivierten Zähler wird keine neue Ablesung erfasst. Korrekturen bleiben möglich.';
  END IF;
  IF actor_role = 'employee' AND NEW.reading_type <> 'regular' THEN
    RAISE EXCEPTION 'Mitarbeiter erfassen normale Zählerstände.';
  END IF;

  NEW.recorded_by := auth.uid();
  NEW.created_at := now();
  NEW.voided_at := NULL;
  NEW.voided_by := NULL;
  NEW.void_reason := NULL;
  NEW.note := NULLIF(btrim(NEW.note), '');
  NEW.photo_path := NULLIF(btrim(NEW.photo_path), '');
  NEW.parent_meter_id := meter.parent_meter_id;
  NEW.counts_in_facility_total := meter.parent_meter_id IS NULL AND meter.counts_in_facility_total;

  IF NEW.reading_type = 'correction' THEN
    SELECT * INTO original
    FROM public.utility_meter_readings
    WHERE id = NEW.corrects_reading_id;
    IF NOT FOUND
       OR original.meter_id <> NEW.meter_id
       OR original.reading_type = 'correction'
       OR original.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'Die Korrektur bezieht sich auf eine gültige ursprüngliche Ablesung desselben Zählers.';
    END IF;
    NEW.series_id := original.series_id;
    NEW.reading_at := original.reading_at;
    NEW.parent_meter_id := original.parent_meter_id;
    NEW.counts_in_facility_total := original.counts_in_facility_total;
    SELECT * INTO previous_reading
    FROM public.utility_meter_readings anchor
    WHERE anchor.meter_id = original.meter_id
      AND anchor.series_id = original.series_id
      AND anchor.id <> original.id
      AND anchor.voided_at IS NULL
      AND anchor.reading_type <> 'correction'
      AND anchor.reading_at < original.reading_at
    ORDER BY anchor.reading_at DESC, anchor.created_at DESC
    LIMIT 1;
    SELECT * INTO next_reading
    FROM public.utility_meter_readings anchor
    WHERE anchor.meter_id = original.meter_id
      AND anchor.series_id = original.series_id
      AND anchor.id <> original.id
      AND anchor.voided_at IS NULL
      AND anchor.reading_type <> 'correction'
      AND anchor.reading_at > original.reading_at
    ORDER BY anchor.reading_at ASC, anchor.created_at ASC
    LIMIT 1;
    IF original.reading_type = 'regular' THEN
      previous_value := CASE WHEN previous_reading.id IS NULL THEN NULL
        ELSE public.tageswerk_effective_reading_value(previous_reading.id) END;
      next_value := CASE
        WHEN next_reading.id IS NULL OR next_reading.reading_type = 'reset' THEN NULL
        ELSE public.tageswerk_effective_reading_value(next_reading.id) END;
      IF (previous_value IS NOT NULL AND NEW.reading_value < previous_value)
         OR (next_value IS NOT NULL AND NEW.reading_value > next_value) THEN
        RAISE EXCEPTION 'Der korrigierte Stand passt nicht zu den benachbarten Ablesungen.';
      END IF;
    ELSIF original.reading_type = 'reset' THEN
      IF next_reading.id IS NOT NULL THEN
        IF next_reading.reading_type IS DISTINCT FROM 'regular'
           OR NEW.reading_value > public.tageswerk_effective_reading_value(next_reading.id) THEN
          RAISE EXCEPTION 'Der korrigierte Rücksetzstand passt nicht zur folgenden Ablesung.';
        END IF;
      END IF;
    ELSE
      RAISE EXCEPTION 'Diese Ablesung kann nicht korrigiert werden.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.reading_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Die Ablesezeit liegt in der Zukunft.';
  END IF;

  SELECT * INTO previous_reading
  FROM public.utility_meter_readings anchor
  WHERE anchor.meter_id = NEW.meter_id
    AND anchor.voided_at IS NULL
    AND anchor.reading_type <> 'correction'
    AND anchor.reading_at < NEW.reading_at
  ORDER BY anchor.reading_at DESC, anchor.created_at DESC
  LIMIT 1;
  SELECT * INTO next_reading
  FROM public.utility_meter_readings anchor
  WHERE anchor.meter_id = NEW.meter_id
    AND anchor.voided_at IS NULL
    AND anchor.reading_type <> 'correction'
    AND anchor.reading_at > NEW.reading_at
  ORDER BY anchor.reading_at ASC, anchor.created_at ASC
  LIMIT 1;

  IF NEW.reading_type = 'reset' THEN
    IF next_reading.id IS NOT NULL THEN
      RAISE EXCEPTION 'Eine Rücksetzung ist nur nach der letzten Ablesung möglich.';
    END IF;
    IF previous_reading.reading_type IS DISTINCT FROM 'regular' THEN
      RAISE EXCEPTION 'Eine Rücksetzung braucht zuvor einen normalen Stand als Verbrauchsgrenze.';
    END IF;
    NEW.series_id := previous_reading.series_id;
    RETURN NEW;
  END IF;

  IF previous_reading.id IS NULL THEN
    NEW.series_id := COALESCE(next_reading.series_id, gen_random_uuid());
  ELSE
    NEW.series_id := previous_reading.series_id;
  END IF;

  previous_value := CASE
    WHEN previous_reading.id IS NULL OR previous_reading.series_id IS DISTINCT FROM NEW.series_id THEN NULL
    ELSE public.tageswerk_effective_reading_value(previous_reading.id)
  END;
  next_value := CASE
    WHEN next_reading.id IS NULL
         OR next_reading.series_id IS DISTINCT FROM NEW.series_id
         OR next_reading.reading_type = 'reset' THEN NULL
    ELSE public.tageswerk_effective_reading_value(next_reading.id)
  END;
  IF (previous_value IS NOT NULL AND NEW.reading_value < previous_value)
     OR (next_value IS NOT NULL AND NEW.reading_value > next_value) THEN
    RAISE EXCEPTION 'Der Zählerstand passt nicht zwischen die benachbarten Ablesungen.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

COMMENT ON FUNCTION public.tageswerk_prepare_reading() IS
  'TEST 3.7.0: 2.9-Ableselogik (Reihe, Wechsel, Rücksetzung, Plausibilität, Mandant).';

COMMIT;
