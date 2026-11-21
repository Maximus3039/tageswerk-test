# Tageswerk 3.7.0 – Mobile UX-Abnahme

Stand: 21.11.2026. Branch `modularisierung`. Keine Produktivsetzung, kein SQL, kein Push auf `main`.

Screenshots und Rohmetriken: `docs/abnahme-mobile-3.7.0/` (Playwright Chromium, Touch, Höhen 844 px bzw. 1024 px bei 768 px Breite).

## 1. Geprüfte Seiten

Dashboard, Tagesgeschäft, Vorgänge, Mehr, Erfassen-Sheet, Mangel melden, Zählerstände (über Erfassen), Tagesbericht, Temperatur, Wasserhygiene, Material/Bestand, Management-Dashboard, Mitarbeiter. Zusätzlich 320 / 360 / 375 / 390 / 430 / 768 px für Navigation, Overflow und FAB.

## 2. Screenshots

Kernansichten je Breite:

| Breite | Dashboard | Tagesgeschäft | Vorgänge | Mehr | Erfassen |
| --- | --- | --- | --- | --- | --- |
| 320 | `docs/abnahme-mobile-3.7.0/320-dashboard.png` | `…/320-tagesgeschaeft.png` | `…/320-vorgaenge.png` | `…/320-mehr.png` | `…/320-erfassen.png` |
| 360 | `docs/abnahme-mobile-3.7.0/360-dashboard.png` | `…/360-tagesgeschaeft.png` | `…/360-vorgaenge.png` | `…/360-mehr.png` | `…/360-erfassen.png` |
| 375 | `docs/abnahme-mobile-3.7.0/375-dashboard.png` | `…/375-tagesgeschaeft.png` | `…/375-vorgaenge.png` | `…/375-mehr.png` | `…/375-erfassen.png` |
| 390 | `docs/abnahme-mobile-3.7.0/390-dashboard.png` | `…/390-tagesgeschaeft.png` | `…/390-vorgaenge.png` | `…/390-mehr.png` | `…/390-erfassen.png` |
| 430 | `docs/abnahme-mobile-3.7.0/430-dashboard.png` | `…/430-tagesgeschaeft.png` | `…/430-vorgaenge.png` | `…/430-mehr.png` | `…/430-erfassen.png` |
| 768 | `docs/abnahme-mobile-3.7.0/768-dashboard.png` | `…/768-tagesgeschaeft.png` | `…/768-vorgaenge.png` | `…/768-mehr.png` | `…/768-erfassen.png` |

Abläufe bei 390 px:

- `docs/abnahme-mobile-3.7.0/390-zaehlerstaende.png`
- `docs/abnahme-mobile-3.7.0/390-mangel-melden.png`
- `docs/abnahme-mobile-3.7.0/390-temperatur.png`
- `docs/abnahme-mobile-3.7.0/390-tagesberichte.png`
- `docs/abnahme-mobile-3.7.0/390-maengelmanagement.png`
- `docs/abnahme-mobile-3.7.0/390-management-dashboard.png`
- `docs/abnahme-mobile-3.7.0/390-mitarbeiterverwaltung.png`
- `docs/abnahme-mobile-3.7.0/390-wasserhygiene.png`
- `docs/abnahme-mobile-3.7.0/390-materialverwaltung.png`

Messwerte: `docs/abnahme-mobile-3.7.0/metrics.json`. Horizontaler Overflow an allen geprüften Breiten 0 px. FAB ohne Überlagerung der unteren Leiste (`navOverlap: false`).

## 3. Arbeitsabläufe

Ziel: 2–3 Interaktionen bis zur Erfassungsmaske.

| Ablauf | Interaktionen | Scroll | Bewertung |
| --- | --- | --- | --- |
| A Zählerstand | 2 (FAB → Zählerstand erfassen) | Kurz, bis das Ableseformular im Viewport liegt | Im Ziel. Seltene Zählerverwaltung bleibt eingeklappt. |
| B Mangel | 2 (FAB → Mangel melden) oder 1–2 (Vorgänge → + Neuen Mangel) | Gering | Im Ziel. Formular öffnet als Composer. |
| C Temperatur | 2 (FAB → Temperatur erfassen) | Kurz über die Betriebsmodule | Im Ziel. Einstellungen bleiben geschlossen. |
| D Tagesbericht | 2 (FAB → Tagesbericht erstellen) | Formular unter den Modulkacheln | Im Ziel. Historie hinter „Frühere Berichte“. |
| E Mangel bearbeiten (Leitung) | 1 (Vorgänge) plus Karte tippen | Liste beginnt nach Toolbar/Filter | Im Ziel. Filter hinter einer Schaltfläche. |
| F Management und Betrieb | 2 (Mehr → Management-Dashboard), Betrieb in der Kachel/Auswahl | Darstellung hinter Aufklappbereich | Im Ziel. Kachelanordnung nicht mehr dauerhaft auf der Arbeitsfläche. |

Zurück aus einem geöffneten Modul: erneutes Tippen auf **Mehr** zeigt wieder den Hub.

## 4. Erfassen-Menü

- Gelber FAB rechts über der Leiste, Mindesthöhe 48 px, Daumenreichweite.
- Sechs Aktionen: Mangel, Temperatur, Wasser, Zählerstand, Tagesbericht, Beschaffung.
- Schließen über „Schließen“; FAB ist ausgeblendet, solange das Sheet offen ist (keine Überlagerung mehr).
- Rollenfilter der Aktionen unverändert (bestehende Capture-Handler, keine Änderung an `isManager`).

## 5. Menüstruktur

Unten: Dashboard, Tagesgeschäft, Vorgänge, Mehr.

Mehr-Hub:

- Tagesgeschäft: Betriebserfassung, Zählerstände
- Verwaltung (Leitung): Management, Mitarbeiter, Einladungen, Betriebe anlegen, Eskalation
- Einstellungen (Leitung): Dashboard-Darstellung

Doppelte Einträge „Kennzahlen und Vergleich“ wurden entfernt. Die alten Modul-Kacheln sind am Telefon ausgeblendet. Hinweise liegen als einzelne Schaltfläche in Vorgänge, ohne zweite Meine/Offen-Leiste.

## 6. Erkannte Probleme (Abnahme)

1. FAB lag über Capture-„Schließen“ und über Dashboard-Zeilen.
2. Mehr öffnete automatisch Betriebserfassung und Management und wurde extrem lang.
3. Vorgänge zeigte doppelte Reiter plus dauerhafte Filter.
4. Hinweise-Beschriftung brach bei 320 px („Hinwei se“).
5. Management-Konfiguration und Orgs/Betriebe verlängerten Arbeitsansichten.
6. Einladungs-Speichern konnte hinter dem FAB liegen.

## 7. Behobene Probleme

Erste Abnahme:

- FAB-z-Index unter dem Capture-Sheet; FAB ausblenden bei offenem Sheet/Composer.
- Mehr startet als Hub; Module erst nach Auswahl; Hub ausblenden, sobald ein Modul offen ist.
- Filter der Mängel nur noch über „Filter“.
- Nur noch der Hinweise-Reiter zusätzlich zur vorhandenen Toolbar.
- Management-Darstellung, Eskalation, Unternehmen/Betriebe in Aufklappbereichen.
- `scroll-margin-bottom` für Formularfelder und primäre Schaltflächen.

Abschlusskorrekturen:

- FAB mit Abstand zur unteren Leiste, Safe-Area und Tastatur (`--tw-keyboard`). Ausblendung bei Sheet, Composer, Filterblatt und Tastaturfokus.
- Zusätzlicher Inhaltsabstand (`main` + `.view::after`) und rechter Abstand in `#home-quick`, damit Schnellaktionen nicht unter dem FAB liegen.
- Mandanten-Hinweis als aufklappbare Zusammenfassung „Mandantentrennung aktiv“; voller Text bleibt im Dokument. `.error`/`.ok` werden nicht gekürzt.
- „Zurück zu Mehr“ auf dem Management-Dashboard. Erneutes Tippen auf Mehr schließt geöffnete Module.

## 8. Verbleibende Einschränkungen

- Sehr lange Geschäftsführungs-Seiten in Mehr (Mitarbeiter, Einladungen), sobald nach unten gescrollt wird.
- Datumsfelder folgen der Browser-Locale.
- Kein physisches iPhone; Safe-Area nur per CSS (`viewport-fit=cover`, `env(safe-area-inset-bottom)`).
- Playwright-Design-Tests können unter hoher Parallelität einmalig zeitlich knappe DOM-Bereitschaft zeigen; Wiederholung bestand.
- Integrationstests gegen eine echte Datenbank starten bewusst nicht ohne bestätigte TEST-Umgebung.

## 9. Testergebnisse

- `npm test`: 254/254.
- Playwright Smartphone `mobile-ux-3-7` und `mobile-abnahme-shots`: bestanden (320–768 px).
- Playwright gesamt: 79+ bestanden. Übersprungen: Desktop-Lauf von `Mobile-Abnahme speichert Screenshots` und Desktop-Lauf von `Die Auswertungsschaltflächen bleiben auf dem Smartphone kompakt` (`test.skip`).
- Unit-Integrationen ohne TEST-DB: bewusst kein Lauf gegen echte Daten (die Tests bestehen, weil sie den Start verweigern).

Nicht ausführbar ohne Freigabe: SQL in Supabase, Edge-Deployments, GitHub-Pages, `test:integration`.

## 10. Commit

Lokaler Commit auf `modularisierung`, kein Push. Die Commit-ID steht im Git-Log von HEAD.

## Halt

PROD, `main` und Pages wurden nicht angefasst.
