-- Tageswerk 3.4.2, Bereinigung einer älteren Funktionsfassung
-- Separat freigeben und vor tageswerk_3_4_2_water_round_close.sql ausführen.
-- Entfernt nur tageswerk_own_water_round_stored(uuid, uuid[]), falls diese Fassung existiert.
-- Die aktuelle Hilfsfunktion mit dem JSON-Argument bleibt bestehen.
-- Tabellen, Messwerte, Entwürfe und Richtlinien bleiben unverändert.

DROP FUNCTION IF EXISTS public.tageswerk_own_water_round_stored(uuid, uuid[]);
