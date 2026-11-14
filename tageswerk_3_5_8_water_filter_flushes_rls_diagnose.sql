-- Lesende Diagnose zur Nachprüfung „Mitarbeiter ohne Historie …“.
-- Schreibt nichts. Ändert keine Policies. Nur SELECT.
-- Zeigt Policy-Definitionen aus pg_policies und bewertet Rollenhinweise
-- unabhängig von IN (...) bzw. = ANY (ARRAY[...]).
-- Textvergleiche sind Hinweise, kein endgültiger Nachweis der RLS-Sicherheit.

WITH policies AS (
  SELECT
    schemaname,
    tablename,
    policyname,
    cmd,
    roles::text AS roles,
    coalesce(qual, '') AS qual,
    coalesce(with_check, '') AS with_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('water_filters', 'water_filter_flushes')
),
flush_select AS (
  SELECT qual AS expr
  FROM policies
  WHERE tablename = 'water_filter_flushes'
    AND policyname = 'water_filter_flushes_select'
),
filter_select AS (
  SELECT qual AS expr
  FROM policies
  WHERE tablename = 'water_filters'
    AND policyname = 'water_filters_select'
),
filter_insert AS (
  SELECT with_check AS expr
  FROM policies
  WHERE tablename = 'water_filters'
    AND policyname = 'water_filters_insert'
),
filter_update AS (
  SELECT
    qual AS using_expr,
    with_check AS check_expr
  FROM policies
  WHERE tablename = 'water_filters'
    AND policyname = 'water_filters_update'
),
flush_insert AS (
  SELECT with_check AS expr
  FROM policies
  WHERE tablename = 'water_filter_flushes'
    AND policyname = 'water_filter_flushes_insert'
),
policy_catalog AS (
  SELECT
    1 AS sortierung,
    $$Katalog: alle water_filters / water_filter_flushes Policies$$ AS pruefung,
    $$Jede erwartete Policy erscheint mit cmd und Definition$$ AS erwartet,
    format(
      $$%s.%s [%s] roles=%s | USING=%s | WITH CHECK=%s$$,
      tablename,
      policyname,
      cmd,
      roles,
      nullif(qual, ''),
      nullif(with_check, '')
    ) AS policy_text,
    $$katalog$$ AS bewertung
  FROM policies
),
role_checks AS (
  SELECT 10 AS sortierung,
    $$flush_select: technician$$ AS pruefung,
    $$Historie-SELECT nennt technician (IN oder ANY ARRAY)$$ AS erwartet,
    coalesce((SELECT expr FROM flush_select), $$<fehlt>$$) AS policy_text,
    CASE
      WHEN coalesce((SELECT expr FROM flush_select), '') ~* $$technician$$ THEN $$ok$$
      ELSE $$abweichung$$
    END AS bewertung
  UNION ALL
  SELECT 20,
    $$flush_select: facility_manager$$,
    $$Historie-SELECT nennt facility_manager$$,
    coalesce((SELECT expr FROM flush_select), $$<fehlt>$$),
    CASE
      WHEN coalesce((SELECT expr FROM flush_select), '') ~* $$facility_manager$$ THEN $$ok$$
      ELSE $$abweichung$$
    END
  UNION ALL
  SELECT 30,
    $$flush_select: company_admin$$,
    $$Historie-SELECT nennt company_admin$$,
    coalesce((SELECT expr FROM flush_select), $$<fehlt>$$),
    CASE
      WHEN coalesce((SELECT expr FROM flush_select), '') ~* $$company_admin$$ THEN $$ok$$
      ELSE $$abweichung$$
    END
  UNION ALL
  SELECT 40,
    $$flush_select: ohne employee$$,
    $$Mitarbeiter lesen keine Spülhistorie$$,
    coalesce((SELECT expr FROM flush_select), $$<fehlt>$$),
    CASE
      WHEN coalesce((SELECT expr FROM flush_select), '') = '' THEN $$abweichung$$
      WHEN coalesce((SELECT expr FROM flush_select), '') ~* $$employee$$ THEN $$abweichung$$
      ELSE $$ok$$
    END
  UNION ALL
  SELECT 50,
    $$Alte Prüflogik: exakte Komma-IN-Kette technician/facility_manager/company_admin$$,
    $$Suche nach IN-Komma-Kette – in pg_policies oft falsch-negativ wegen ANY ARRAY$$,
    coalesce((SELECT expr FROM flush_select), $$<fehlt>$$),
    CASE
      WHEN position(
        $$'technician', 'facility_manager', 'company_admin'$$
        IN coalesce((SELECT expr FROM flush_select), '')
      ) > 0
      THEN $$ok$$
      ELSE $$fehlschlag_der_prueflogik$$
    END
  UNION ALL
  SELECT 60,
    $$filter_select: employee$$,
    $$Mitarbeiter dürfen Filter lesen$$,
    coalesce((SELECT expr FROM filter_select), $$<fehlt>$$),
    CASE
      WHEN coalesce((SELECT expr FROM filter_select), '') ~* $$employee$$ THEN $$ok$$
      ELSE $$abweichung$$
    END
  UNION ALL
  SELECT 70,
    $$filter_select: active begrenzt$$,
    $$active IS TRUE oder active = true$$,
    coalesce((SELECT expr FROM filter_select), $$<fehlt>$$),
    CASE
      WHEN coalesce((SELECT expr FROM filter_select), '') ~* $$active\s+IS\s+TRUE|active\s*=\s*true$$
      THEN $$ok$$
      ELSE $$abweichung$$
    END
  UNION ALL
  SELECT 80,
    $$filter_insert: company_admin$$,
    $$Nur Leitung/Admin legen Filter an$$,
    coalesce((SELECT expr FROM filter_insert), $$<fehlt>$$),
    CASE
      WHEN coalesce((SELECT expr FROM filter_insert), '') ~* $$company_admin$$ THEN $$ok$$
      ELSE $$abweichung$$
    END
  UNION ALL
  SELECT 90,
    $$filter_insert: facility_manager$$,
    $$Nur Leitung/Admin legen Filter an$$,
    coalesce((SELECT expr FROM filter_insert), $$<fehlt>$$),
    CASE
      WHEN coalesce((SELECT expr FROM filter_insert), '') ~* $$facility_manager$$ THEN $$ok$$
      ELSE $$abweichung$$
    END
  UNION ALL
  SELECT 100,
    $$Alte Prüflogik: exakte Komma-IN-Kette company_admin/facility_manager$$,
    $$Suche nach IN-Komma-Kette – in pg_policies oft falsch-negativ wegen ANY ARRAY$$,
    coalesce((SELECT expr FROM filter_insert), $$<fehlt>$$),
    CASE
      WHEN position(
        $$'company_admin', 'facility_manager'$$
        IN coalesce((SELECT expr FROM filter_insert), '')
      ) > 0
      THEN $$ok$$
      ELSE $$fehlschlag_der_prueflogik$$
    END
  UNION ALL
  SELECT 110,
    $$filter_insert: ohne technician und ohne employee-Rolle$$,
    $$INSERT-WITH-CHECK ohne technician und ohne employee$$,
    coalesce((SELECT expr FROM filter_insert), $$<fehlt>$$),
    CASE
      WHEN coalesce((SELECT expr FROM filter_insert), '') ~* $$technician$$ THEN $$abweichung$$
      WHEN coalesce((SELECT expr FROM filter_insert), '') ~*
        $$=\s*'employee'|ANY\s*\([^)]*'employee'$$
      THEN $$abweichung$$
      ELSE $$ok$$
    END
  UNION ALL
  SELECT 120,
    $$filter_update: nur Leitung/Admin$$,
    $$USING und WITH CHECK nennen company_admin und facility_manager, nicht employee/technician$$,
    format(
      $$USING=%s | WITH CHECK=%s$$,
      coalesce((SELECT using_expr FROM filter_update), $$<fehlt>$$),
      coalesce((SELECT check_expr FROM filter_update), $$<fehlt>$$)
    ),
    CASE
      WHEN coalesce((SELECT using_expr FROM filter_update), '') ~* $$company_admin$$
       AND coalesce((SELECT using_expr FROM filter_update), '') ~* $$facility_manager$$
       AND coalesce((SELECT check_expr FROM filter_update), '') ~* $$company_admin$$
       AND coalesce((SELECT check_expr FROM filter_update), '') ~* $$facility_manager$$
       AND coalesce((SELECT using_expr FROM filter_update), '') !~* $$employee|technician$$
       AND coalesce((SELECT check_expr FROM filter_update), '') !~* $$employee|technician$$
      THEN $$ok$$
      ELSE $$abweichung$$
    END
  UNION ALL
  SELECT 130,
    $$flush_insert: aktive Mitgliedschaft und aktiver Filter$$,
    $$WITH CHECK nennt tageswerk_meter_role und active$$,
    coalesce((SELECT expr FROM flush_insert), $$<fehlt>$$),
    CASE
      WHEN coalesce((SELECT expr FROM flush_insert), '') ~* $$tageswerk_meter_role$$
       AND coalesce((SELECT expr FROM flush_insert), '') ~* $$active$$
      THEN $$ok$$
      ELSE $$abweichung$$
    END
  UNION ALL
  SELECT 140,
    $$Hinweis: Grenzen der Textprüfung$$,
    $$IN und ANY ARRAY werden hier gleich behandelt; Laufzeitverhalten braucht Rollen-Tests$$,
    $$Textmatches sind Hinweise. Endgültige RLS-Sicherheit folgt aus Policy-Semantik und Verhaltenstests, nicht aus Teilstrings.$$,
    $$hinweis$$
)
SELECT pruefung, erwartet, policy_text, bewertung
FROM (
  SELECT * FROM policy_catalog
  UNION ALL
  SELECT * FROM role_checks
) AS diagnose
ORDER BY sortierung, pruefung;
