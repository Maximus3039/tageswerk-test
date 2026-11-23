# Tageswerk 3.7.0 – Produktivveröffentlichung

Stand: 23.11.2026. Frontend-Release nach erfolgreicher PROD-Migration 01–06.

## Version

- Sichtbar: **3.7.0** (`index.html`, Manifest, Service-Worker, `package.json`)
- Vorgänger: **3.6.3** (wiederherstellbar über GitHub-Pages-Pin `5d6a3b4749042bdf0906c8b1985f5bdac6fe7355`)
- Git-Tag: `v3.7.0` (SHA nach Release-Commit)

## Datenbanken

- Produktiv-Frontend: `eqtrifscedpsngsysxvc` (`js/supabase.js`)
- TEST bleibt `gamvnzggcrrlnyoknllu` und ist nicht im veröffentlichten Frontend konfiguriert
- Keine weiteren PROD-SQL-Migrationen in diesem Schritt

## Excel-Import

- Vorschau: aktiv (`tageswerk_preview_historical_import`)
- Übernahme: gesperrt (`HISTORICAL_COMMIT_ENABLED=false`)
- Manuelle historische Verbrauchserfassung: aktiv

## GitHub Pages

- Öffentliche URL: https://maximus3039.github.io/tageswerk-test/
- Pin erfolgt über `.github/workflows/pages.yml` auf `main` (Commit-SHA des Release-Stands)
- Deployment-Zeitpunkt und Workflow-Status werden nach dem Push ergänzt

## Tests vor Veröffentlichung

- `npm test` und die gesamte Playwright-Suite werden vor dem Push ausgeführt
- Bekannte Playwright-Ausnahmen: übersprungene Fälle, sofern unverändert
