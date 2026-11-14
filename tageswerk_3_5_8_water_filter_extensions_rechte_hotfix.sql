-- Hotfix: UPDATE-Rechte auf water_filters auf Spalte name begrenzen.
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: tageswerk_3_5_8_water_filter_extensions.sql ist installiert.
-- Nicht wiederholbar im Sinne destruktiver Änderungen; Rechte werden gezielt neu gesetzt.
-- Schreibt keine betrieblichen Fachdaten.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.water_filters') IS NULL THEN
    RAISE EXCEPTION 'water_filters fehlt.';
  END IF;
END;
$guard$;

-- Tabellenweites UPDATE entfernen (inkl. PUBLIC/anon-Resten).
REVOKE UPDATE ON TABLE public.water_filters FROM PUBLIC;
REVOKE UPDATE ON TABLE public.water_filters FROM anon;
REVOKE UPDATE ON TABLE public.water_filters FROM authenticated;

-- Basisrechte für die App erhalten bzw. wiederherstellen.
GRANT SELECT, INSERT ON TABLE public.water_filters TO authenticated;

-- Nur Umbenennen bleibt direkt erlaubt; active/last_* nur über SECURITY DEFINER.
GRANT UPDATE (name) ON TABLE public.water_filters TO authenticated;

DO $check$
BEGIN
  IF has_column_privilege('authenticated', 'public.water_filters', 'active', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.water_filters', 'last_flushed_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.water_filters', 'last_flushed_by', 'UPDATE')
  THEN
    RAISE EXCEPTION 'Hotfix unvollständig: active/last_* sind für authenticated weiter updatebar.';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.water_filters', 'name', 'UPDATE') THEN
    RAISE EXCEPTION 'Hotfix unvollständig: name ist für authenticated nicht updatebar.';
  END IF;
END;
$check$;

COMMIT;
