import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ablauf = readFileSync(new URL('../integration/water-filters/ablauf.txt', import.meta.url), 'utf8');
const voraussetzungen = readFileSync(new URL('../integration/water-filters/voraussetzungen.sql', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../integration/water-filters/run.mjs', import.meta.url), 'utf8');
const parallel = readFileSync(new URL('../integration/water-filters/parallelitaet.mjs', import.meta.url), 'utf8');
const umbenennen = readFileSync(new URL('../integration/water-filters/umbenennen.sql', import.meta.url), 'utf8');
const flushesVerhalten = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_flushes_verhalten.sql', import.meta.url), 'utf8');
const extensionsVerhalten = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_extensions_verhalten.sql', import.meta.url), 'utf8');
const flushesMigration = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_flushes.sql', import.meta.url), 'utf8');
const extensionsMigration = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_extensions.sql', import.meta.url), 'utf8');

test('Filter-Integration startet nicht ohne bestätigte Testdatenbank', () => {
 const result = spawnSync(process.execPath, ['tests/integration/water-filters/run.mjs'], {
  cwd: root,
  encoding: 'utf8',
  env: {...process.env, TAGESWERK_TEST_DATABASE: '', TAGESWERK_TEST_DATABASE_URL: ''}
 });
 assert.notEqual(result.status, 0);
 assert.match(`${result.stdout}\n${result.stderr}`, /bestätigte Testdatenbank/);
});

test('Parallelitätstest startet nicht ohne bestätigte Testdatenbank', () => {
 const result = spawnSync(process.execPath, ['tests/integration/water-filters/parallelitaet.mjs'], {
  cwd: root,
  encoding: 'utf8',
  env: {...process.env, TAGESWERK_TEST_DATABASE: '', TAGESWERK_TEST_DATABASE_URL: ''}
 });
 assert.notEqual(result.status, 0);
 assert.match(`${result.stdout}\n${result.stderr}`, /bestätigte Testdatenbank/);
});

test('Anleitung und Runner sperren Produktivprojekt und automatische Läufe', () => {
 assert.match(ablauf, /Nur für eine ausdrücklich als Testumgebung bestätigte/);
 assert.match(ablauf, /Keine automatische Ausführung gegen Supabase/);
 assert.match(ablauf, /eqtrifscedpsngsysxvc/);
 assert.match(ablauf, /TAGESWERK_TEST_DATABASE=bestaetigt/);
 assert.match(ablauf, /tests\/integration\/run\.mjs/);
 assert.match(ablauf, /Zwei-Session-Parallelität/);
 assert.match(runner, /eqtrifscedpsngsysxvc/);
 assert.match(runner, /TAGESWERK_TEST_DATABASE !== 'bestaetigt'/);
 assert.match(runner, /water_pools fehlt/);
 assert.match(runner, /parallelitaet\.mjs/);
 assert.match(runner, /umbenennen\.sql/);
 assert.doesNotMatch(runner, /supabase\.co\/rest/);
 assert.match(parallel, /zwei echte Sitzungen|zwei echte/);
 assert.match(parallel, /FOR UPDATE/);
 assert.match(parallel, /korrektur-sitzung-b/);
 assert.match(parallel, /last_flushed/);
});

test('Voraussetzungen prüfen Abhängigkeiten ohne Schreibzugriff', () => {
 assert.match(voraussetzungen, /Ausschließlich lesend/);
 assert.match(voraussetzungen, /water_pools vorhanden/);
 assert.match(voraussetzungen, /tageswerk_meter_role inkl\. technician/);
 assert.match(voraussetzungen, /tageswerk_bind_operation_facility/);
 assert.match(voraussetzungen, /tageswerk_facility_organization/);
 assert.match(voraussetzungen, /auth\.users/);
 assert.match(voraussetzungen, /Rolle authenticated/);
 assert.doesNotMatch(voraussetzungen, /\b(INSERT INTO|UPDATE |DELETE FROM|CREATE TABLE|DROP TABLE)\b/i);
});

test('Vorbereitete Testfälle decken Verwaltung, Korrektur, Sicherheit und Parallelität ab', () => {
 assert.match(flushesVerhalten, /Mitarbeiter verwaltet keine Filter/);
 assert.match(flushesVerhalten, /Mitarbeiter liest keine Spülhistorie/);
 assert.match(flushesVerhalten, /Techniker liest die Spülhistorie/);
 assert.match(flushesVerhalten, /Zukünftiger Spülzeitpunkt wird abgelehnt/);
 assert.match(flushesVerhalten, /Nachtrag außerhalb 24 Stunden wird abgelehnt/);
 assert.match(flushesVerhalten, /Spülhistorie ist unveränderlich/);
 assert.match(flushesVerhalten, /Deaktivierter Filter nimmt keine Spülung an/);
 assert.match(flushesVerhalten, /Mitarbeiter eines anderen Betriebs sieht keine Filter/);
 assert.match(extensionsVerhalten, /Mitarbeiter korrigiert nicht/);
 assert.match(extensionsVerhalten, /Techniker korrigiert nicht/);
 assert.match(extensionsVerhalten, /Originaleintrag unverändert/);
 assert.match(extensionsVerhalten, /Mehrfachkorrektur möglich/);
 assert.match(extensionsVerhalten, /Statushistorie Außer Betrieb/);
 assert.match(extensionsVerhalten, /Reaktivierung/);
 assert.match(extensionsVerhalten, /GUC setzt active nicht frei/);
 assert.match(extensionsVerhalten, /GUC setzt last_flushed nicht frei/);
 assert.match(extensionsVerhalten, /Korrekturprotokoll unveränderlich/);
 assert.match(extensionsVerhalten, /Keine Lost-Update/);
 assert.match(umbenennen, /Leitung benennt Filter um/);
 assert.match(umbenennen, /Umbenennen lässt active und last_flushed unverändert/);
 assert.match(umbenennen, /Umbenennen darf active nicht mitsetzen/);
 assert.match(parallel, /Parallele Korrektur/);
 assert.match(parallel, /parallel-spuelung-a/);
 assert.match(parallel, /parallel-spuelung-b/);
});

test('Migrationsabhängigkeiten bleiben in den Installationsdateien benannt', () => {
 assert.match(flushesMigration, /water_pools fehlt/);
 assert.match(flushesMigration, /tageswerk_meter_role fehlt/);
 assert.match(flushesMigration, /tageswerk_bind_operation_facility fehlt/);
 assert.match(flushesMigration, /nicht erneut ausführen/);
 assert.match(extensionsMigration, /tageswerk_water_filter_caps/);
 assert.match(extensionsMigration, /FOR UPDATE/);
 assert.match(extensionsMigration, /tageswerk_correct_water_filter_flush/);
 assert.match(extensionsMigration, /tageswerk_set_water_filter_active/);
 assert.doesNotMatch(extensionsMigration, /GRANT UPDATE ON TABLE public\.water_filter_flushes/);
 assert.doesNotMatch(flushesMigration, /GRANT UPDATE ON TABLE public\.water_filter_flushes/);
});
