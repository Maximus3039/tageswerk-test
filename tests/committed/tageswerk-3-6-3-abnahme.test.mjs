import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const vorpruefung = readFileSync(new URL('../../tageswerk_3_6_3_vorpruefung.sql', import.meta.url), 'utf8');
const resetPasswords = readFileSync(new URL('../../scripts/test-env-reset-seed-passwords.ps1', import.meta.url), 'utf8');
const materials = readFileSync(new URL('../../tageswerk_3_6_3_material_movements_insert.sql', import.meta.url), 'utf8');
const retry = readFileSync(new URL('../../tageswerk_3_6_3_retry_staff_invitation.sql', import.meta.url), 'utf8');
const layouts = readFileSync(new URL('../../tageswerk_3_6_3_user_dashboard_layouts.sql', import.meta.url), 'utf8');
const imports = readFileSync(new URL('../../tageswerk_3_6_3_day_figure_import.sql', import.meta.url), 'utf8');
const handler = readFileSync(new URL('../../supabase/functions/invite-staff/handler.js', import.meta.url), 'utf8');
const staffUi = readFileSync(new URL('../../js/staff-ui.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('3.6.3-Vorprüfung bleibt lesend', () => {
 assert.match(vorpruefung, /lesende Vorprüfung/);
 assert.doesNotMatch(vorpruefung, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|NOTIFY|DO)\b/im);
});

test('Materials-INSERT qualifiziert Betrieb und Organisation', () => {
 assert.match(materials, /material\.facility_id = material_movements\.facility_id/);
 assert.match(materials, /material\.organization_id = material_movements\.organization_id/);
 assert.match(materials, /tageswerk_meter_role\(material_movements\.organization_id, material_movements\.facility_id\)/);
 assert.doesNotMatch(materials, /\.\s*facility_id\s*=\s*facility_id\b/);
 assert.match(materials, /tageswerk_material_movement_guard bleibt unverändert/);
});

test('Retry ändert keine Rolle und verhindert doppelte offene Einladungen', () => {
 assert.match(retry, /SET search_path = ''/);
 assert.match(retry, /private\.can_manage_facility/);
 assert.match(retry, /status IN \('failed', 'revoked'\)/);
 assert.match(retry, /bereits eine offene Einladung/);
 assert.doesNotMatch(retry, /UPDATE public\.memberships/);
 assert.doesNotMatch(retry, /role\s*=/);
});

test('Dashboard-Layouts und Import bleiben mandantensicher', () => {
 assert.match(layouts, /FORCE ROW LEVEL SECURITY/);
 assert.match(layouts, /user_id = auth\.uid\(\)/);
 assert.match(layouts, /ON DELETE CASCADE/);
 assert.doesNotMatch(layouts, /FOR ALL TO authenticated/);
 assert.match(imports, /tageswerk_save_day_figures/);
 assert.match(imports, /tageswerk_figure_role/);
 assert.match(imports, /jsonb_array_length\(p_rows\) > 800/);
 assert.match(imports, /FORCE ROW LEVEL SECURITY/);
 assert.match(imports, /pg_catalog\.jsonb_typeof/);
 assert.doesNotMatch(imports, /pg_catalog\.coalesce/i);
 assert.doesNotMatch(imports, /pg_catalog\.nullif/i);
 assert.match(imports, /COALESCE\(NULLIF\(pg_catalog\.btrim/);
});

test('TEST-Passwort-Reset bleibt interaktiv und an bestehende IDs gebunden', () => {
 assert.match(resetPasswords, /ConfirmReset/);
 assert.match(resetPasswords, /gamvnzggcrrlnyoknllu/);
 assert.match(resetPasswords, /eqtrifscedpsngsysxvc/);
 assert.match(resetPasswords, /auth\/v1\/admin\/users/);
 assert.match(resetPasswords, /46af6795-01c5-4f11-881e-b7ce71217e71/);
 assert.doesNotMatch(resetPasswords, /auth\.admin\.createUser|DELETE \/auth\/v1\/admin\/users/);
 assert.doesNotMatch(resetPasswords, /Write-Host \(\$pass/);
});

test('Einladungsoberfläche verlangt bestätigte Empfängeradresse', () => {
 assert.match(indexHtml, /invite-email-confirm/);
 assert.match(staffUi, /confirmInviteRecipient/);
 assert.match(staffUi, /confirm_email:recipient.email/);
 assert.match(handler, /resumeInvitation/);
 assert.match(handler, /invitation_id/);
});
