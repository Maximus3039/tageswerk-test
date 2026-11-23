# Manuelle historische Verbrauchserfassung 3.7.0

Stand: 21.11.2026. Branch: `modularisierung`. SQL in **TEST** ausgeführt. Kein PROD, kein `main`, kein Pages.

## Implementierte Funktionen

Im Modul Zählerstände liegt **Historische Werte erfassen** (Betriebsleitung und Geschäftsführung, nur zugeordnete Betriebe). Tägliche Ablesung bleibt unverändert und sofort erreichbar. Auf schmalen Viewports (320 / 390 / 430 px) liegt die historische Erfassung im Untermenü `Historische Werte erfassen`; `Zählerstand eintragen` bleibt direkt sichtbar.

Drei Arten:

1. **Historischer Zählerstand** — Betrieb (Auswahl oben), Zähler, Ablesedatum, Stand, optionaler Kommentar. Speichert einen regulären Stand über `tageswerk_prepare_reading`. Verbrauch bleibt berechnet.
2. **Historischer Monatsverbrauch** — Betrieb, Medium, optionaler Zähler, Monat, Jahr, Verbrauch, Einheit, optionaler Kommentar. Eigene Tabelle, getrennt von Ablesungen. Unique blockt Dubletten; nichts wird still überschrieben.
3. **Monatsverbrauch korrigieren** — nur vorhandene manuelle Zeilen. Verbrauch und/oder Kommentar ändern, Pflicht-Korrekturgrund (mindestens 3 Zeichen). Speichert `corrected_by` (`auth.uid()`), `correction_reason`, `updated_at`. AFTER-UPDATE-Trigger schreibt `utility_monthly_consumption_revisions`.

Auswertung: Tabelle, Balkendiagramm, Jahres-/Monats-/Tagesmittel, Vorjahresvergleich über gemeinsam abgedeckte Monate, Abweichung vom erfassten Monatsmittel. Fehlende Monate bleiben leer, nicht 0. Unvollständige Jahre und unvollständige Ablesemonate sind gekennzeichnet.

## Datenbank (TEST ausgeführt)

Datei: `tageswerk_3_7_0_manual_monthly_consumption.sql`.

Ausgeführt nur gegen **gamvnzggcrrlnyoknllu** (`npx supabase db query --remote=gamvnzggcrrlnyoknllu --yes --file …`). Nicht gegen PROD `eqtrifscedpsngsysxvc`.

Objekte:

- `utility_monthly_consumption` — FORCE RLS, kein DELETE
- Trigger `tageswerk_prepare_monthly_consumption` (INVOKER): INSERT nur Leitungsrolle; UPDATE nur bei geändertem Wert oder Kommentar plus Korrekturgrund; setzt `corrected_by`
- `utility_monthly_consumption_revisions` — FORCE RLS, GRANT SELECT/INSERT, kein DELETE/UPDATE
- Trigger `tageswerk_record_monthly_consumption_revision` (INVOKER)
- SELECT für jede Zählerrolle des Betriebs; INSERT/UPDATE nur `company_admin` / `facility_manager`

Keine Änderung an `tageswerk_prepare_reading`. Commit-Import unverändert nicht installiert. Bestehende Ablesungen und Zähler unverändert.

## Berechnungslogik / Quellenregel

- Differenz aufeinanderfolgender Stände derselben Reihe: unverändert.
- Kalenderabdeckung je Monat in **Tagen**. Nur wenn alle Kalendertage des Monats aus Ableseverbrauch abgedeckt sind, gilt die Quelle `readings` (vollständiger Monatsverbrauch).
- Teilweise abgedeckte Monate: `readings-partial`, Kennzeichnung „Zählerstände (Monat unvollständig)“, **kein** vollständiger Monat, **nicht** ins Jahresmittel, **nicht** zum manuellen Wert addiert.
- Ohne Ablesetage: manueller Monatswert (`monthly`).
- Fehlende Monate: leer, nicht 0.
- Beide Quellen im selben Monat: vollständige Ablesung gewinnt; Teilablesung und manuell werden nicht addiert.
- Mittel und Jahreswerte nur über vollständige abgedeckte Monate. Tagesmittel: Summe dieser Monate geteilt durch deren Kalendertage.
- Vorjahr: nur Monate, die in beiden Jahren einen vollständigen Wert haben.

## Live TEST (mgr-a1, Alpha Nord)

Kennzeichnung `TW370-HIST`. Betrieb `a1000000-0000-4000-8000-000000000011`. Medium Strom, Einheit kWh, Gesamter Betrieb.

| Monat | Erfasst | Nach Korrektur | Quelle |
|-------|---------|----------------|--------|
| Januar 2025 | 12.500 kWh | 12.400 kWh | Manueller Monatsverbrauch |
| Februar 2025 | 11.700 kWh | unverändert | Manueller Monatsverbrauch |
| März 2025 | 12.900 kWh | unverändert | Manueller Monatsverbrauch |
| April–Dezember 2025 | — | — | Nicht erfasst |

Nach Korrektur Januar: Jahresverbrauch **37.000 kWh**, Ø Monat **12.333,333 kWh**, Ø Tag **411,111 kWh** (90 Kalendertage Jan–Mär). Vorjahr: kein Vergleich (2024 ohne Werte).

Korrektur Januar 21.11.2026 15:40 MEZ: 12.500 → 12.400, Grund `TW370-HIST Testkorrektur Tippfehler Januar`. Eine Revisionszeile. Nach Neuladen der App bleiben Werte und Kennzahlen.

November 2026 aus Zählerständen: **22 kWh**, Quelle „Zählerstände (Monat unvollständig)“, Aktion „kein vollständiger Monat“. Jahres-KPIs 2026 bleiben **—** (kein voller Monat). Manuelle 2025-Werte werden nicht addiert.

## Testergebnisse

- `npm test` (Repo-Stand mit Produktiv-URL in `js/supabase.js`): **273/273**. Während des Abnahme-Servers zeigen zwei Wächter-Tests die TEST-URL (erwartet, kein Produktfehler).
- Playwright `historical-consumption.spec.js`: 2/2 (desktop + smartphone), ohne Datenbankschreibung.
- Playwright `mobile-ux-3-7.spec.js`: 6/6.
- Live TEST-UI: Speicherung, Darstellung, Mittel, Korrektur, Historie, Neuladen, Quellenregel.

## Offen

- GF- und Mitarbeiter-Sitzung unverändert nicht vorhanden; Mitarbeiter-Pfad nur per Unit-Test (Lesen ja, Schreiben nein).
- SQL nicht auf PROD.
- Historische Excel-Übernahme unverändert nicht gebaut.
- Hinweis „Für dein Konto sind keine Betriebe freigegeben“ in der Verbrauchserfassung-Karte bleibt ein bestehender UI-Fehler; die Betriebsauswahl Alpha Nord funktioniert.
