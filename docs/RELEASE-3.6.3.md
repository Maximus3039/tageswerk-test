# Release Tageswerk 3.6.3

Stand: 21.11.2026. Produktivprojekt `eqtrifscedpsngsysxvc`. Keine produktive Einladung in diesem Schritt.

## Redirect

- Secret `TAGESWERK_REDIRECT_URL`: `https://maximus3039.github.io/tageswerk-test/`
- Site URL: dieselbe Adresse
- Additional Redirect URLs: GitHub Pages (mit/ohne Slash und `/**`) plus `?vorgang=passwort`
- Netlify ist nicht mehr Site URL und nicht das Secret

## SQL (PROD)

1. `tageswerk_3_6_3_material_movements_insert.sql`
2. `tageswerk_3_6_3_retry_staff_invitation.sql`
3. `tageswerk_3_6_3_user_dashboard_layouts.sql`
4. `tageswerk_3_6_3_day_figure_import.sql`

## Edge

`invite-staff` Version 12 auf PROD. Andere Functions unverändert. Kein `--prune`.

## Tests

`npm test`: 242/242.

## Offen

Produktiver Einladungstest mit festgelegter Adresse folgt gesondert.
