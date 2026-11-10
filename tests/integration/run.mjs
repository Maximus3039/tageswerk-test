import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const here = path.dirname(fileURLToPath(import.meta.url));
const productionMarker = 'eqtrifscedpsngsysxvc';
const migrations = [
 'tageswerk_3_1_temperature.sql',
 'tageswerk_3_2_temperature_points.sql',
 'tageswerk_3_3_water_hygiene.sql',
 'tageswerk_3_4_technician_role.sql',
 'tageswerk_3_4_invitation_role.sql',
 'tageswerk_3_4_management_guard.sql'
];

function fail(message, code = 2) {
 console.error(message);
 process.exit(code);
}

const databaseUrl = process.env.TAGESWERK_TEST_DATABASE_URL || '';
if (process.env.TAGESWERK_TEST_DATABASE !== 'bestaetigt' || !databaseUrl) {
 fail('Keine bestätigte Testdatenbank. Der Integrationstest wurde nicht gestartet. Setze TAGESWERK_TEST_DATABASE=bestaetigt und TAGESWERK_TEST_DATABASE_URL nur für eine ausdrücklich freigegebene Testinstanz.');
}
if (databaseUrl.includes(productionMarker)) {
 fail('Die Verbindung nennt das produktive Projekt. Es wurde nichts ausgeführt.', 3);
}

let host = '';
try {
 host = new URL(databaseUrl).hostname;
} catch {
 fail('TAGESWERK_TEST_DATABASE_URL ist keine gültige Verbindungsadresse. Es wurde nichts ausgeführt.', 3);
}
if (!host || host.includes(productionMarker)) {
 fail('Die Verbindung nennt das produktive Projekt. Es wurde nichts ausgeführt.', 3);
}

const probe = spawnSync('psql', ['--version'], {encoding: 'utf8'});
if (probe.status !== 0) {
 fail('psql wurde nicht gefunden. Der Integrationstest braucht den PostgreSQL-Client und wurde nicht gestartet.', 3);
}

function psql(file, args = []) {
 const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', file, ...args], {
  cwd: root,
  encoding: 'utf8',
  env: {...process.env, PGOPTIONS: '-c tageswerk.integration_test=bestaetigt'}
 });
 if (result.status !== 0) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.replaceAll(databaseUrl, '[Verbindung]');
  console.error(output.trim());
  fail(`Der Schritt ${path.basename(file)} ist fehlgeschlagen. Die produktive Datenbank wurde nicht verwendet.`, 1);
 }
}

function query(sql) {
 const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], {
  cwd: root,
  encoding: 'utf8',
  env: {...process.env, PGOPTIONS: '-c tageswerk.integration_test=bestaetigt'}
 });
 if (result.status !== 0) {
  console.error(`${result.stdout || ''}\n${result.stderr || ''}`.replaceAll(databaseUrl, '[Verbindung]').trim());
  fail('Die Testdatenbank konnte nicht gelesen werden.', 1);
 }
 return (result.stdout || '').trim();
}

console.log(`Integrationstest gegen ${host}`);
const installed = query("SELECT to_regclass('public.temperature_points') IS NOT NULL");
if (installed === 't') {
 fail('In dieser Testdatenbank sind die Temperaturtabellen schon vorhanden. Verwende eine leere Testinstanz. Es wurde nichts verändert.', 1);
}
const hasFacilities = query("SELECT to_regclass('public.facilities') IS NOT NULL");
if (hasFacilities !== 't') psql(path.join(here, 'baseline.sql'));
psql(path.join(here, 'vorpruefung.sql'));
for (const name of migrations) psql(path.join(root, name));
psql(path.join(here, 'pruefung.sql'));
console.log('Integrationstest bestanden.');
