-- Lesende Kontrolle vor tageswerk_3_4_invitation_role_parameter.sql.
-- Diese Abfrage schreibt nichts. Sie darf im SQL-Editor ausgeführt werden.
-- Nur wenn jede Zeile bereit ist, darf die Migration freigegeben werden.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Hilfsfunktion private.can_manage_facility' AS pruefung,
    CASE WHEN to_regprocedure('private.can_manage_facility(uuid)') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END AS status,
    CASE WHEN to_regprocedure('private.can_manage_facility(uuid)') IS NOT NULL THEN 'Die Verwaltungsprüfung ist vorhanden.' ELSE 'Die Hilfsfunktion fehlt.' END AS details
  UNION ALL
  SELECT 20, 'Vierstellige Einladung bleibt vorhanden',
    CASE WHEN to_regprocedure('public.request_staff_invitation(uuid,text,text,text)') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regprocedure('public.request_staff_invitation(uuid,text,text,text)') IS NOT NULL THEN 'Die bisherige Funktion bleibt ansprechbar.' ELSE 'Die vierstellige Funktion fehlt.' END
  UNION ALL
  SELECT 30, 'Fünfstellige Einladung ist noch nicht angelegt',
    CASE WHEN to_regprocedure('public.request_staff_invitation(uuid,text,text,text,text)') IS NULL THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN to_regprocedure('public.request_staff_invitation(uuid,text,text,text,text)') IS NULL THEN 'Die neue Signatur ist frei.' ELSE 'Die fünfstellige Funktion ist schon vorhanden.' END
  UNION ALL
  SELECT 40, 'Rollenspalte der Einladung',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_invitations' AND column_name = 'role'
    ) THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_invitations' AND column_name = 'role'
    ) THEN 'staff_invitations.role ist vorhanden.' ELSE 'Die Rollenspalte fehlt.' END
  UNION ALL
  SELECT 50, 'Nur Mitarbeiter und Techniker in der Rollenspalte',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.staff_invitations
      WHERE role IS NOT NULL AND role NOT IN ('employee', 'technician')
    ) THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.staff_invitations
      WHERE role IS NOT NULL AND role NOT IN ('employee', 'technician')
    ) THEN 'Keine fremde Einladungsrolle gespeichert.' ELSE 'Eine Einladung trägt eine unzulässige Rolle.' END
  UNION ALL
  SELECT 60, 'Keine doppelte offene Einladung',
    CASE WHEN NOT EXISTS (
      SELECT 1
      FROM public.staff_invitations
      WHERE status IN ('pending', 'sent', 'failed') AND email IS NOT NULL
      GROUP BY facility_id, lower(email)
      HAVING count(*) > 1
    ) THEN 'bereit' ELSE 'stoppen' END,
    CASE WHEN NOT EXISTS (
      SELECT 1
      FROM public.staff_invitations
      WHERE status IN ('pending', 'sent', 'failed') AND email IS NOT NULL
      GROUP BY facility_id, lower(email)
      HAVING count(*) > 1
    ) THEN 'Je Betrieb und E-Mail gibt es höchstens eine offene Einladung.' ELSE 'Doppelte offene Einladungen müssen zuerst geklärt werden.' END
) AS kontrolle
ORDER BY sortierung;
