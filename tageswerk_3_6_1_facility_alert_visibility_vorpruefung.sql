-- Vorprüfung vor tageswerk_3_6_1_facility_alert_visibility.sql
-- Ausschließlich lesend. Schreibt nichts.

SELECT pruefung, status, details
FROM (
  SELECT 'temperature_alerts vorhanden' AS pruefung,
    CASE WHEN to_regclass('public.temperature_alerts') IS NOT NULL THEN 'ok' ELSE 'fehler' END AS status,
    'Temperaturwarnungen bleiben die Quelle.' AS details
  UNION ALL
  SELECT 'water_alerts vorhanden',
    CASE WHEN to_regclass('public.water_alerts') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    'Wasserwarnungen bleiben die Quelle.'
  UNION ALL
  SELECT 'tageswerk_meter_role vorhanden',
    CASE WHEN to_regprocedure('public.tageswerk_meter_role(uuid, uuid)') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    'Rollenprüfung für Betriebsleitung und Geschäftsführung.'
  UNION ALL
  SELECT 'tageswerk_bind_operation_facility vorhanden',
    CASE WHEN to_regprocedure('public.tageswerk_bind_operation_facility()') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    'Betrieb und Organisation werden gebunden.'
  UNION ALL
  SELECT 'Keine Namenskonflikte Tabellen',
    CASE WHEN to_regclass('public.facility_alert_visibility') IS NULL THEN 'ok' ELSE 'fehler' END,
    'Die Migration ist nicht wiederholbar.'
) AS rows;
