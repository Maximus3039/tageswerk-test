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

test('ersetzte Funktionen behalten Zeilenumbrüche und Zeilenkommentare', () => {
 const dynamic = migrations.slice(3);
 for (const migration of dynamic) {
  assert.doesNotMatch(migration.sql, /updated\s*:=\s*replace\(\s*definition/, migration.name);
  assert.doesNotMatch(migration.sql, /EXECUTE\s+definition\b/, migration.name);
  assert.doesNotMatch(migration.sql, /EXECUTE\s+regexp_replace/, migration.name);
  assert.match(migration.sql, /source := pg_get_functiondef/, migration.name);
  assert.match(migration.sql, /definition := regexp_replace\(source/, migration.name);
 }
 const technician = migrations[3].sql;
 assert.match(technician, /updated := replace\(\s*source,/);
 assert.match(technician, /EXECUTE replace\(source, 'role = ''employee''', 'role IN \(''employee'', ''technician''\)'\)/);
 assert.doesNotMatch(technician, /actor_role NOT IN \(''company_admin'', ''facility_manager'', ''technician''\)/);

 const body = [
  "CREATE OR REPLACE FUNCTION public.manage_facility_membership(p_email text, p_facility_id uuid, p_role text, p_remove boolean)",
  "RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''",
  'AS $function$',
  'BEGIN',
  '  -- Verwaltungsrecht des Aufrufers',
  '  IF NOT private.can_manage_facility(p_facility_id) THEN',
  "    RAISE EXCEPTION 'Keine Verwaltungsberechtigung fuer diesen Betrieb';",
  '  END IF;',
  '  -- zulässige Zielrollen',
  "  IF p_role NOT IN ('employee','facility_manager') THEN",
  "    RAISE EXCEPTION 'Ungueltige Rolle';",
  '  END IF;',
  '  -- Geschäftsführung bleibt geschützt',
  '  IF p_role = \'facility_manager\' AND NOT v_admin THEN',
  "    RAISE EXCEPTION 'Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen';",
  '  END IF;',
  '  -- eigene Zuordnung',
  '  IF v_target = v_caller THEN',
  "    RAISE EXCEPTION 'Eigene Berechtigungen hier nicht veraenderbar';",
  '  END IF;',
  "  RAISE EXCEPTION 'Geschaeftsfuehrungsrechte werden hier nicht veraendert';",
  "  IF m.role<>'employee' THEN",
  "    RAISE EXCEPTION 'Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten';",
  '  END IF;',
  'END;',
  '$function$;'
 ].join('\n');
 const collapsed = body.replace(/\s+/g, ' ');
 const commentAt = collapsed.indexOf('--');
 assert.equal(collapsed.includes('\n'), false);
 assert.match(collapsed.slice(commentAt), /Ungueltige Rolle/);
 assert.match(collapsed.slice(commentAt), /Geschaeftsfuehrungsrechte werden hier nicht veraendert/);

 let preserved = body.replace("p_role NOT IN ('employee','facility_manager')", "p_role NOT IN ('employee','technician','facility_manager')");
 preserved = preserved.replace("m.role<>'employee'", "m.role NOT IN ('employee','technician')");
 preserved = preserved.replace('Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten', 'Betriebsleitung darf nur Mitarbeiter und Techniker bearbeiten');
 const commentLines = preserved.split('\n').filter(line => line.includes('--'));
 assert.equal(commentLines.length, 4);
 for (const line of commentLines) {
  assert.equal(line.includes('RAISE EXCEPTION'), false);
  assert.equal(line.includes('technician'), false);
 }
 assert.match(preserved, /-- zulässige Zielrollen\n\s*IF p_role NOT IN \('employee','technician','facility_manager'\)/);
 assert.match(preserved, /Keine Verwaltungsberechtigung fuer diesen Betrieb/);
 assert.match(preserved, /Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen/);
 assert.match(preserved, /Eigene Berechtigungen hier nicht veraenderbar/);
 assert.match(preserved, /Geschaeftsfuehrungsrechte werden hier nicht veraendert/);
 assert.match(preserved, /Betriebsleitung darf nur Mitarbeiter und Techniker bearbeiten/);
 assert.doesNotMatch(preserved, /company_admin/);
});
