import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const here = path.dirname(fileURLToPath(import.meta.url));
const productionMarker = 'eqtrifscedpsngsysxvc';

function fail(message, code = 2) {
 console.error(message);
 process.exit(code);
}

const databaseUrl = process.env.TAGESWERK_TEST_DATABASE_URL || '';
if (process.env.TAGESWERK_TEST_DATABASE !== 'bestaetigt' || !databaseUrl) {
 fail('Keine bestätigte Testdatenbank. Der Filter-Integrationstest wurde nicht gestartet. Setze TAGESWERK_TEST_DATABASE=bestaetigt und TAGESWERK_TEST_DATABASE_URL nur für eine ausdrücklich freigegebene Testinstanz.');
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

const env = {...process.env, PGOPTIONS: '-c tageswerk.integration_test=bestaetigt'};

function psql(file, args = []) {
 const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', file, ...args], {
  cwd: root,
  encoding: 'utf8',
  env
 });
 if (result.status !== 0) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.replaceAll(databaseUrl, '[Verbindung]');
  console.error(output.trim());
  fail(`Der Schritt ${path.basename(file)} ist fehlgeschlagen. Die produktive Datenbank wurde nicht verwendet.`, 1);
 }
 return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function query(sql) {
 const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], {
  cwd: root,
  encoding: 'utf8',
  env
 });
 if (result.status !== 0) {
  console.error(`${result.stdout || ''}\n${result.stderr || ''}`.replaceAll(databaseUrl, '[Verbindung]').trim());
  fail('Die Testdatenbank konnte nicht gelesen werden.', 1);
 }
 return (result.stdout || '').trim();
}

function requireReady(output, label) {
 const stopRows = output.split(/\r?\n/).filter(line => /(^|\s|\|)stoppen(\s|\||$)/.test(line));
 if (stopRows.length) {
  console.error(output.trim());
  fail(`${label}: Es gibt „stoppen“-Ergebnisse. Schreibende Schritte wurden nicht gestartet.`, 1);
 }
}

console.log(`Filter-Integrationstest gegen ${host}`);

const hasPools = query("SELECT to_regclass('public.water_pools') IS NOT NULL");
if (hasPools !== 't') {
 fail('water_pools fehlt. Zuerst tests/integration/run.mjs auf derselben bestätigten Testinstanz ausführen. Es wurde nichts verändert.', 1);
}

const roleOk = query(`
SELECT CASE
 WHEN to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL
  AND position('technician' IN pg_get_functiondef(to_regprocedure('public.tageswerk_meter_role(uuid,uuid)'))) > 0
 THEN 't' ELSE 'f' END
`);
if (roleOk !== 't') {
 fail('tageswerk_meter_role inkl. technician fehlt. Basis-Integration unvollständig. Es wurde nichts verändert.', 1);
}

const voraussetzungen = psql(path.join(here, 'voraussetzungen.sql'));
requireReady(voraussetzungen, 'Voraussetzungsprüfung');
console.log('Voraussetzungsprüfung ohne stoppen.');

const hasFilters = query("SELECT to_regclass('public.water_filters') IS NOT NULL");
const hasExtensions = query("SELECT to_regclass('public.water_filter_flush_corrections') IS NOT NULL");

if (hasFilters !== 't') {
 console.log('Installiere Filterspülungs-Basis …');
 const flushProbe = psql(path.join(root, 'tageswerk_3_5_8_water_filter_flushes_vorpruefung.sql'));
 requireReady(flushProbe, 'Vorprüfung Filterspülungen');
 psql(path.join(root, 'tageswerk_3_5_8_water_filter_flushes.sql'));
} else {
 console.log('Filterspülungs-Basis ist bereits installiert.');
}

const hasVerhaltenData = query(`
SELECT EXISTS (
 SELECT 1 FROM public.water_filters WHERE id = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1'
)::text
`);
if (hasVerhaltenData !== 't') {
 console.log('Führe Basis-Verhalten aus …');
 psql(path.join(root, 'tageswerk_3_5_8_water_filter_flushes_verhalten.sql'));
} else {
 console.log('Basis-Verhaltensdaten sind bereits vorhanden.');
}

if (hasExtensions !== 't') {
 console.log('Installiere Filter-Erweiterungen …');
 const extProbe = psql(path.join(root, 'tageswerk_3_5_8_water_filter_extensions_vorpruefung.sql'));
 requireReady(extProbe, 'Vorprüfung Filter-Erweiterungen');
 psql(path.join(root, 'tageswerk_3_5_8_water_filter_extensions.sql'));
} else {
 console.log('Filter-Erweiterungen sind bereits installiert.');
}

// Erweiterungs-Verhalten ist nicht streng idempotent; vorhandene Korrekturen markieren einen früheren Lauf.
const hasCorrectionRun = query(`
SELECT EXISTS (
 SELECT 1 FROM public.water_filter_flush_corrections
 WHERE facility_id = 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5'
)::text
`);
if (hasCorrectionRun !== 't') {
 console.log('Führe Erweiterungs-Verhalten aus …');
 psql(path.join(root, 'tageswerk_3_5_8_water_filter_extensions_verhalten.sql'));
} else {
 console.log('Erweiterungs-Verhalten scheint bereits gelaufen zu sein; überspringe Wiederholung.');
}

console.log('Führe Umbenennen-Prüfung aus …');
psql(path.join(here, 'umbenennen.sql'));

console.log('Führe Zwei-Session-Parallelität aus …');
const parallel = spawnSync(process.execPath, [path.join(here, 'parallelitaet.mjs')], {
 cwd: root,
 encoding: 'utf8',
 env: {...process.env, TAGESWERK_TEST_DATABASE: 'bestaetigt', TAGESWERK_TEST_DATABASE_URL: databaseUrl}
});
if (parallel.status !== 0) {
 console.error(`${parallel.stdout || ''}\n${parallel.stderr || ''}`.replaceAll(databaseUrl, '[Verbindung]').trim());
 fail('Der Parallelitätstest ist fehlgeschlagen.', 1);
}
console.log((parallel.stdout || '').trim());

console.log('Filter-Integrationstest vorbereitet und bestanden.');
