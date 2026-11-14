import {spawn, spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const productionMarker = 'eqtrifscedpsngsysxvc';
const manager = '25252525-2525-4525-8525-252525252525';
const employee = '35353535-3535-4535-8535-353535353535';
const filterA = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f1';
const facility = 'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5';

function fail(message, code = 2) {
 console.error(message);
 process.exit(code);
}

const databaseUrl = process.env.TAGESWERK_TEST_DATABASE_URL || '';
if (process.env.TAGESWERK_TEST_DATABASE !== 'bestaetigt' || !databaseUrl) {
 fail('Keine bestätigte Testdatenbank. Parallelitätstest nicht gestartet.');
}
if (databaseUrl.includes(productionMarker)) {
 fail('Die Verbindung nennt das produktive Projekt. Es wurde nichts ausgeführt.', 3);
}

const env = {...process.env, PGOPTIONS: '-c tageswerk.integration_test=bestaetigt'};

function psqlText(sql) {
 const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], {
  cwd: root,
  encoding: 'utf8',
  env
 });
 if (result.status !== 0) {
  console.error(`${result.stdout || ''}\n${result.stderr || ''}`.replaceAll(databaseUrl, '[Verbindung]').trim());
  fail('psql-Abfrage fehlgeschlagen.', 1);
 }
 return (result.stdout || '').trim();
}

function openSession(label) {
 const child = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
  cwd: root,
  env,
  stdio: ['pipe', 'pipe', 'pipe']
 });
 let stdout = '';
 let stderr = '';
 child.stdout.on('data', chunk => { stdout += String(chunk); });
 child.stderr.on('data', chunk => { stderr += String(chunk); });
 const done = new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', code => {
   if (code === 0) resolve({label, stdout, stderr});
   else reject(new Error(`${label} fehlgeschlagen:\n${stdout}\n${stderr}`.replaceAll(databaseUrl, '[Verbindung]')));
  });
 });
 return {
  write(sql) { child.stdin.write(`${sql}\n`); },
  end() { child.stdin.end(); },
  done
 };
}

function sleep(ms) {
 return new Promise(resolve => setTimeout(resolve, ms));
}

function asRole(userId) {
 return `
SELECT set_config('request.jwt.claim.sub', '${userId}', false);
SELECT set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
SET ROLE authenticated;
`;
}

console.log('Parallelitätstest Filterspülungen: zwei echte Sitzungen');

const ready = psqlText(`
SELECT CASE
 WHEN current_setting('tageswerk.integration_test', true) = 'bestaetigt'
  AND to_regclass('public.water_filter_flush_corrections') IS NOT NULL
  AND to_regprocedure('public.tageswerk_water_filter_flush_effective(uuid)') IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.water_filters WHERE id = '${filterA}' AND active IS TRUE)
 THEN 'ok' ELSE 'nein' END;
`);
if (ready !== 'ok') {
 fail('Voraussetzungen für den Parallelitätstest fehlen. Zuerst den Filter-Runner bis zum Erweiterungs-Verhalten ausführen.', 1);
}

const flushSetup = psqlText(`
SELECT set_config('request.jwt.claim.sub', '${employee}', false);
SELECT set_config('request.jwt.claims', '{"sub":"${employee}"}', false);
SET ROLE authenticated;
INSERT INTO public.water_filter_flushes (facility_id, filter_id, flushed_at, note)
VALUES ('${facility}', '${filterA}', now() - interval '40 minutes', 'parallel-basis')
RETURNING id::text;
RESET ROLE;
`);
const flushId = flushSetup.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1);
if (!flushId || !/^[0-9a-f-]{36}$/i.test(flushId)) {
 fail(`Parallele Basis-Spülung konnte nicht angelegt werden (Antwort: ${flushSetup}).`, 1);
}

const beforeCorrections = Number(psqlText(`SELECT count(*)::text FROM public.water_filter_flush_corrections WHERE flush_id = '${flushId}'`));
const beforeFlushes = Number(psqlText(`SELECT count(*)::text FROM public.water_filter_flushes WHERE filter_id = '${filterA}'`));

const sessionA = openSession('Korrektur-A');
const sessionB = openSession('Korrektur-B');

sessionA.write('BEGIN;');
sessionA.write(asRole(manager));
sessionA.write(`SELECT id FROM public.water_filter_flushes WHERE id = '${flushId}' FOR UPDATE;`);
await sleep(400);

sessionB.write('BEGIN;');
sessionB.write(asRole(manager));
sessionB.write(`
SELECT public.tageswerk_correct_water_filter_flush(
 '${flushId}'::uuid,
 '${filterA}'::uuid,
 now() - interval '35 minutes',
 'korrektur-sitzung-b',
 'Parallele Korrektur B'
);
`);
sessionB.write('COMMIT;');
sessionB.end();

await sleep(800);

const waiting = Number(psqlText(`
SELECT count(*)::text
FROM pg_stat_activity
WHERE datname = current_database()
  AND wait_event_type = 'Lock'
  AND query ILIKE '%tageswerk_correct_water_filter_flush%';
`));
if (waiting < 1) {
 console.warn('Hinweis: Lock-Wartezustand nicht in pg_stat_activity sichtbar; Serialisierung wird am Ergebnis geprüft.');
}

sessionA.write(`
SELECT public.tageswerk_correct_water_filter_flush(
 '${flushId}'::uuid,
 '${filterA}'::uuid,
 now() - interval '38 minutes',
 'korrektur-sitzung-a',
 'Parallele Korrektur A'
);
`);
sessionA.write('COMMIT;');
sessionA.end();

await Promise.all([sessionA.done, sessionB.done]);

const afterCorrections = Number(psqlText(`SELECT count(*)::text FROM public.water_filter_flush_corrections WHERE flush_id = '${flushId}'`));
if (afterCorrections !== beforeCorrections + 2) {
 fail(`Erwartet ${beforeCorrections + 2} Korrekturen, gefunden ${afterCorrections}.`, 1);
}

const bPrevious = psqlText(`
SELECT previous_note
FROM public.water_filter_flush_corrections
WHERE flush_id = '${flushId}' AND note = 'korrektur-sitzung-b'
ORDER BY corrected_at DESC, id DESC
LIMIT 1;
`);
if (bPrevious !== 'korrektur-sitzung-a') {
 fail(`Keine Serialisierung: Sitzung B previous_note='${bPrevious}', erwartet 'korrektur-sitzung-a'.`, 1);
}

const flushSessionA = openSession('Spülung-A');
const flushSessionB = openSession('Spülung-B');
flushSessionA.write(asRole(employee));
flushSessionB.write(asRole(manager));
flushSessionA.write(`
INSERT INTO public.water_filter_flushes (facility_id, filter_id, flushed_at, note)
VALUES ('${facility}', '${filterA}', now() - interval '5 minutes', 'parallel-spuelung-a');
`);
flushSessionB.write(`
INSERT INTO public.water_filter_flushes (facility_id, filter_id, flushed_at, note)
VALUES ('${facility}', '${filterA}', now() - interval '1 minutes', 'parallel-spuelung-b');
`);
flushSessionA.end();
flushSessionB.end();
await Promise.all([flushSessionA.done, flushSessionB.done]);

const afterFlushes = Number(psqlText(`SELECT count(*)::text FROM public.water_filter_flushes WHERE filter_id = '${filterA}'`));
if (afterFlushes < beforeFlushes + 2) {
 fail(`Parallele Spülungen fehlen: vorher ${beforeFlushes}, nachher ${afterFlushes}.`, 1);
}

const lastFlush = psqlText(`
SELECT CASE
 WHEN last_flushed_at IS NOT NULL
  AND last_flushed_at = (
   SELECT max(effective.flushed_at)
   FROM public.water_filter_flushes AS flush_row
   CROSS JOIN LATERAL public.tageswerk_water_filter_flush_effective(flush_row.id) AS effective
   WHERE effective.filter_id = '${filterA}'
  )
 THEN 'ok' ELSE 'fail'
 END
FROM public.water_filters
WHERE id = '${filterA}';
`);
if (lastFlush !== 'ok') {
 fail('last_flushed_* stimmt nach parallelen Spülungen nicht mit dem Maximum der gültigen Fassung überein.', 1);
}

console.log('Parallelitätstest bestanden: Korrekturen serialisiert, Spülungen übernommen, last_flushed atomar nachgezogen.');
