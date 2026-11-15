# Tageswerk 3.6.0 – Design Nexus V4.3 (Design-Freeze)

Finaler Feinschliff und Vereinheitlichung auf Basis von V4.2. Kein neues Designsystem. Pages-Pin bleibt 3.5.7 / `240a2e8`.

**Design-Freeze:** Nach dem Freeze-Commit gelten nur noch Korrekturen bei echten Bedien- oder Darstellungsfehlern. Keine neuen visuellen Iterationen ohne Bedarf.

## 1. Änderungen gegenüber V4.2

| Thema | V4.2 | V4.3 |
|-------|------|------|
| Betriebsauswahl | Separates Feld über dem Spotlight | Dasselbe `#dashboard-facility` im Spotlight |
| Spotlight-Name | Zusätzlicher sichtbarer Name | `sr-only` (Name kommt aus dem Select) |
| „Alle Betriebe“ | Konnte fälschlich Einzelbetrieb zeigen | Select-Text / Spotlight spiegeln den Zustand `all` |
| Mängel-Toolbar | Kompakter, aber lose Zeilen | Drei klare Reihen: Nav / Aktionen / Filter |
| Mängelkarten | Neon-Karten | Einheitliche Karten mit Prioritätsleiste und klarer Hierarchie |
| Demo-Screenshots | `mine-count` korrekt, `defect-count` oft 0 | Beide Zähler passend zur Demo-Liste |

## 2. Smartphone-Bedienung

- Weniger doppelte Betriebsanzeige
- Select im Spotlight mit Cyan-Pfeil, Touchhöhe ≥ 42–44 px
- KPI weiterhin früh im Viewport (ca. 320 px bei 390×844 ohne Hinweisbanner)
- Mängel-Kopf: Aufgaben/Offen → Neu/Aktualisieren → Filter

## 3. Betriebsauswahl unter den Modulen (`#operations-facility`)

Analyse:

1. **Funktion:** Wählt den Betrieb für Tagesbericht, Kontrollgang, Temperatur, Wasser usw. (`facility()` in `operations-ui-shared.js`).
2. **Erforderlich:** Ja. Module speichern/laden je Betrieb über dieses Feld.
3. **Synchronisation:** `#dashboard-facility` synct bei Einzelbetrieb nach `#operations-facility` (`syncOperationFacility`). Umgekehrt bleibt die Modulauswahl unabhängig, wenn die Module geöffnet sind.
4. **Rollen:** Alle Rollen mit Modulzugriff; Optionen kommen aus `state.accessibleFacilities`.

**Ergebnis:** Beibehalten. Zusammenführung mit dem Dashboard-Select würde Geschäftslogik (unabhängige Modul-Betriebsbindung) antasten und wurde daher nicht umgesetzt. Visuell als Modul-Betrieb beschriftet.

## 4. Testergebnisse

- `npm test`: 196 ok
- `npm run test:ui`: 67 ok, 1 skipped
- Viewport-Check 360/390/430/768/1440: kein Overflow, KPIs im ersten Screen

## 5. Offene Designpunkte

- Mit sichtbarem Mandanten-/Testkonto-Hinweis rutschen KPIs tiefer (Sicherheit hat Vorrang)
- Desktop-Mängel-Toolbar bleibt bewusst großzügiger als mobil
- Optionale spätere UX: Modul-Betrieb nur anzeigen, wenn Dashboard auf „Alle Betriebe“ steht (Logik-Vorschlag, nicht umgesetzt)

## 6. Geänderte Dateien

`index.html`, `css/theme-3.6.css`, `js/mobile.js`, `playwright.config.js`, Tests, `docs/DESIGN-NEXUS-3.6.0-v4.3.md`, `docs/design-review-3.6.0-v4.3/`, Skripte `patch-nexus-v43`, `design-review-screenshots-v43`, `viewport-check-v43`

## 7. Empfehlung Design-Freeze

Nach Review der V4.3-Screenshots ist ein **Design-Freeze für die NEXUS-Oberfläche 3.6.0** sinnvoll. Weitere Schritte sollten Funktionsfreigaben und Datenbank-Migrationen betreffen, keine erneute Visual-Iteration, sofern keine echten Bedienhemmnisse gemeldet werden.

V4.2-Sicherung: `d8728e69ad5b74f185068a9e0b63fdcd314c28cc`  
V4.1-Sicherung: `00d02a7fc24c906e812ead3862a338b9eb8579c9`
