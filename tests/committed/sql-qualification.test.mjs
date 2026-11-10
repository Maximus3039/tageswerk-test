import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migrations = [
 'tageswerk_3_1_temperature.sql',
 'tageswerk_3_2_temperature_points.sql',
 'tageswerk_3_3_water_hygiene.sql',
 'tageswerk_3_4_technician_role.sql',
 'tageswerk_3_4_invitation_role.sql',
 'tageswerk_3_4_management_guard.sql'
].map(name => ({
 name,
 sql: readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
}));

test('facility_id in Unterabfragen bleibt einer Tabelle zugeordnet', () => {
 const shadowed = /\.\s*facility_id\s*=\s*facility_id\b/;
 const shadowedOrganization = /\.\s*organization_id\s*=\s*organization_id\b/;
 for (const migration of migrations) {
  assert.doesNotMatch(migration.sql, shadowed, migration.name);
  assert.doesNotMatch(migration.sql, shadowedOrganization, migration.name);
 }
 const temperature = migrations[0].sql;
 const alerts = temperature.slice(temperature.indexOf('CREATE POLICY temperature_alerts_insert'), temperature.indexOf('CREATE POLICY temperature_alerts_update'));
 assert.match(alerts, /reading\.facility_id = temperature_alerts\.facility_id/);
 assert.match(alerts, /reading\.id = temperature_alerts\.reading_id/);
 assert.match(alerts, /tageswerk_meter_role\(temperature_alerts\.organization_id, temperature_alerts\.facility_id\)/);
 assert.doesNotMatch(alerts, /tageswerk_meter_role\(organization_id, facility_id\)/);
 const readings = temperature.slice(temperature.indexOf('CREATE POLICY temperature_readings_insert'), temperature.indexOf('CREATE POLICY temperature_alerts_select'));
 assert.match(readings, /point\.facility_id = temperature_readings\.facility_id/);
 assert.match(readings, /point\.id = temperature_readings\.point_id/);
 const water = migrations[2].sql;
 assert.match(water, /pool\.facility_id = water_checks\.facility_id/);
 assert.match(water, /alert\.facility_id = water_alert_measures\.facility_id/);
 assert.match(water, /alert\.organization_id = water_alert_measures\.organization_id/);
});
