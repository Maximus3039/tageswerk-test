import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = readFileSync(new URL('../integration/run.mjs', import.meta.url), 'utf8');
const baseline = readFileSync(new URL('../integration/baseline.sql', import.meta.url), 'utf8');
const probe = readFileSync(new URL('../integration/vorpruefung.sql', import.meta.url), 'utf8');
const check = readFileSync(new URL('../integration/pruefung.sql', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../integration/ablauf.txt', import.meta.url), 'utf8');

test('Der Integrationstest startet nicht ohne bestätigte Testdatenbank', () => {
 const result = spawnSync(process.execPath, ['tests/integration/run.mjs'], {
  cwd: root,
  encoding: 'utf8',
  env: {...process.env, TAGESWERK_TEST_DATABASE: '', TAGESWERK_TEST_DATABASE_URL: ''}
 });
 assert.notEqual(result.status, 0);
 assert.match(`${result.stdout}\n${result.stderr}`, /bestätigte Testdatenbank/);
 assert.match(runner, /eqtrifscedpsngsysxvc/);
 assert.match(runner, /TAGESWERK_TEST_DATABASE !== 'bestaetigt'/);
 assert.doesNotMatch(runner, /supabase\.co\/rest/);
});

test('Der Ablauf installiert die sechs Migrationen und prüft die genannten Grenzen', () => {
 const order = runner.slice(runner.indexOf('const migrations'), runner.indexOf('];'));
 assert.match(order, /tageswerk_3_1_temperature\.sql[\s\S]*tageswerk_3_2_temperature_points\.sql[\s\S]*tageswerk_3_3_water_hygiene\.sql[\s\S]*tageswerk_3_4_technician_role\.sql[\s\S]*tageswerk_3_4_invitation_role\.sql[\s\S]*tageswerk_3_4_management_guard\.sql/);
 assert.match(probe, /tageswerk_meter_role entspricht nicht der geprüften Ausgangsfassung/);
 assert.match(probe, /tageswerk_prepare_reading entspricht nicht der geprüften Ausgangsfassung/);
 assert.match(probe, /manage_facility_membership entspricht nicht der geprüften Ausgangsfassung/);
 assert.match(probe, /accept_staff_invitation entspricht nicht der geprüften Ausgangsfassung/);
 assert.match(baseline, /Reaktivierung nur ueber gesonderte Freigabe/);
 assert.match(baseline, /role = 'employee'/);
 assert.match(check, /Eine Temperatur außerhalb der Grenzen erzeugt eine Warnung/);
 assert.match(check, /Der Entwurf wird gespeichert/);
 assert.match(check, /Der eigene Entwurf wird verworfen/);
 assert.match(check, /Die Kontrollrunde speichert beide Becken/);
 assert.match(check, /Die fehlgeschlagene Kontrollrunde ist zurückgenommen/);
 assert.match(check, /Die Wiederholung fügt keine Messung hinzu/);
 assert.match(check, /Mitarbeiter liest keine gespeicherten Wasserwerte/);
 assert.match(check, /Techniker liest die Wasserhistorie/);
 assert.match(check, /Techniker erfasst keine Korrektur/);
 assert.match(check, /Eine Reaktivierung mit anderer Rolle bleibt verboten/);
 assert.match(check, /Dieselbe Rolle wird wieder freigegeben/);
 assert.match(check, /Die Technikereinladung übernimmt die gespeicherte Rolle/);
 assert.match(check, /Die bestehende Mitgliedschaft wird nicht überschrieben/);
 assert.match(check, /Ein Konfigurationswert schließt den Entwurf nicht/);
 assert.match(check, /Eine Mitgliedschaft wird nicht direkt angehoben/);
 assert.match(guide, /keine Instanz an/);
 assert.match(guide, /Edge Function invite-staff wird hier nicht aufgerufen/);
});
