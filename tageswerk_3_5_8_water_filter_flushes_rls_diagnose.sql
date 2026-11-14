-- Lesende Diagnose zur Nachprüfung „Mitarbeiter ohne Historie …“.
-- Schreibt nichts. Ändert keine Policies. Nur SELECT.
-- Zeigt je Bedingung Erwartung, gespeicherten Policy-Text und Bewertung.

WITH policies AS (
  SELECT
    schemaname,
    tablename,
    policyname,
    cmd,
    roles::text AS roles,
    qual,
    with_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('water_filters', 'water_filter_flushes')
),
flush_select AS (
  SELECT qual AS expr
  FROM policies
  WHERE tablename = 'water_filter_flushes' AND policyname = 'water_filter_flushes_select'
),
filter_select AS (
  SELECT qual AS expr
  FROM policies
  WHERE tablename = 'water_filters' AND policyname = 'water_filters_select'
),
filter_insert AS (
  SELECT with_check AS expr
  FROM policies
  WHERE tablename = 'water_filters' AND policyname = 'water_filters_insert'
),
checks AS (
  SELECT 10 AS sortierung,
    'flush_select enthält technician' AS pruefung,
    'Policy-Text nennt technician' AS erwartet,
    coalesce((SELECT expr FROM flush_select), '<fehlt>') AS policy_text,
    CASE WHEN coalesce((SELECT expr FROM flush_select), '') ILIKE '%technician%' THEN 'ok' ELSE 'abweichung' END AS bewertung
  UNION ALL
  SELECT 20,
    'flush_select enthält facility_manager',
    'Policy-Text nennt facility_manager',
    coalesce((SELECT expr FROM flush_select), '<fehlt>'),
    CASE WHEN coalesce((SELECT expr FROM flush_select), '') ILIKE '%facility_manager%' THEN 'ok' ELSE 'abweichung' END
  UNION ALL
  SELECT 30,
    'flush_select enthält company_admin',
    'Policy-Text nennt company_admin',
    coalesce((SELECT expr FROM flush_select), '<fehlt>'),
    CASE WHEN coalesce((SELECT expr FROM flush_select), '') ILIKE '%company_admin%' THEN 'ok' ELSE 'abweichung' END
  UNION ALL
  SELECT 40,
    'flush_select ohne employee',
    'Mitarbeiter dürfen Spülhistorie nicht lesen',
    coalesce((SELECT expr FROM flush_select), '<fehlt>'),
    CASE
      WHEN coalesce((SELECT expr FROM flush_select), '') = '' THEN 'abweichung'
      WHEN coalesce((SELECT expr FROM flush_select), '') ILIKE '%employee%' THEN 'abweichung'
      ELSE 'ok'
    END
  UNION ALL
  SELECT 50,
    'Alte Prüflogik: exakter IN-String technician/facility_manager/company_admin',
    'position(''''technician'''', ''''facility_manager'''', ''''company_admin''''' …) > 0',
    coalesce((SELECT expr FROM flush_select), '<fehlt>'),
    CASE
      WHEN position('''technician'', ''facility_manager'', ''company_admin''' IN coalesce((SELECT expr FROM flush_select), '')) > 0
      THEN 'ok'
      ELSE 'fehlschlag_der_prueflogik'
    END
  UNION ALL
  SELECT 60,
    'filter_select enthält employee',
    'Mitarbeiter dürfen Filter lesen',
    coalesce((SELECT expr FROM filter_select), '<fehlt>'),
    CASE WHEN coalesce((SELECT expr FROM filter_select), '') ILIKE '%employee%' THEN 'ok' ELSE 'abweichung' END
  UNION ALL
  SELECT 70,
    'filter_select begrenzt auf active',
    'active IS TRUE oder active = true',
    coalesce((SELECT expr FROM filter_select), '<fehlt>'),
    CASE
      WHEN coalesce((SELECT expr FROM filter_select), '') ILIKE '%active IS TRUE%'
        OR coalesce((SELECT expr FROM filter_select), '') ILIKE '%active = true%'
      THEN 'ok'
      ELSE 'abweichung'
    END
  UNION ALL
  SELECT 80,
    'filter_insert enthält company_admin',
    'Nur Leitung/Admin legen Filter an',
    coalesce((SELECT expr FROM filter_insert), '<fehlt>'),
    CASE WHEN coalesce((SELECT expr FROM filter_insert), '') ILIKE '%company_admin%' THEN 'ok' ELSE 'abweichung' END
  UNION ALL
  SELECT 90,
    'filter_insert enthält facility_manager',
    'Nur Leitung/Admin legen Filter an',
    coalesce((SELECT expr FROM filter_insert), '<fehlt>'),
    CASE WHEN coalesce((SELECT expr FROM filter_insert), '') ILIKE '%facility_manager%' THEN 'ok' ELSE 'abweichung' END
  UNION ALL
  SELECT 100,
    'Alte Prüflogik: exakter IN-String company_admin/facility_manager',
    'position(''''company_admin'''', ''''facility_manager''''' …) > 0',
    coalesce((SELECT expr FROM filter_insert), '<fehlt>'),
    CASE
      WHEN position('''company_admin'', ''facility_manager''' IN coalesce((SELECT expr FROM filter_insert), '')) > 0
      THEN 'ok'
      ELSE 'fehlschlag_der_prueflogik'
    END
  UNION ALL
  SELECT 110,
    'filter_insert ohne technician/employee als Verwaltungsrolle',
    'INSERT-WITH-CHECK ohne technician und ohne employee-Rolle',
    coalesce((SELECT expr FROM filter_insert), '<fehlt>'),
    CASE
      WHEN coalesce((SELECT expr FROM filter_insert), '') ILIKE '%technician%' THEN 'abweichung'
      WHEN coalesce((SELECT expr FROM filter_insert), '') ~* $$=\s*'employee'|ANY\s*\(.*'employee'$$ THEN 'abweichung'
      ELSE 'ok'
    END
  UNION ALL
  SELECT 120,
    'Policy-Darstellung Postgres',
    'IN-Listen werden oft zu = ANY (ARRAY[…]) umgeschrieben',
    'Siehe policy_text in den Zeilen oben; exakte Komma-IN-Suche ist unzuverlässig.',
    'hinweis'
)
SELECT pruefung, erwartet, policy_text, bewertung
FROM checks
ORDER BY sortierung;
