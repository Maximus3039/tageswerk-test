import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../tageswerk_3_6_1_facility_alert_visibility.sql', import.meta.url), 'utf8');
const concurrency = readFileSync(new URL('../../tageswerk_3_6_1_facility_alert_visibility_concurrency.sql', import.meta.url), 'utf8');
const pruefung = readFileSync(new URL('../../tageswerk_3_6_1_facility_alert_visibility_pruefung.sql', import.meta.url), 'utf8');
const vorpruefung = readFileSync(new URL('../../tageswerk_3_6_1_facility_alert_visibility_vorpruefung.sql', import.meta.url), 'utf8');

test('Ausblend-Migration bleibt vorbereitet und ändert keine Warnungstabellen', () => {
 assert.match(migration, /Nicht ohne ausdrückliche Freigabe ausführen/);
 assert.match(migration, /Nicht wiederholbar/);
 assert.match(migration, /CREATE TABLE public\.facility_alert_visibility/);
 assert.match(migration, /already installiert|bereits installiert/);
 assert.doesNotMatch(migration, /ALTER TABLE public\.temperature_alerts/);
 assert.doesNotMatch(migration, /ALTER TABLE public\.water_alerts/);
 assert.doesNotMatch(migration, /DROP TABLE/);
 assert.doesNotMatch(migration, /DISABLE ROW LEVEL SECURITY/);
 assert.doesNotMatch(migration, /SECURITY DEFINER/);
});

test('RLS trennt Rollen und Betriebe beim Ausblenden', () => {
 assert.match(migration, /FORCE ROW LEVEL SECURITY/);
 assert.match(migration, /facility_alert_visibility_select[\s\S]*tageswerk_meter_role\(organization_id, facility_id\) IS NOT NULL/);
 assert.match(migration, /facility_alert_visibility_insert[\s\S]*'company_admin', 'facility_manager'/);
 assert.match(migration, /alert\.facility_id = facility_alert_visibility\.facility_id/);
 assert.match(migration, /alert\.organization_id = facility_alert_visibility\.organization_id/);
 assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.facility_alert_visibility TO authenticated;/);
 assert.doesNotMatch(migration, /GRANT UPDATE ON TABLE public\.facility_alert_visibility/);
 assert.doesNotMatch(migration, /GRANT DELETE ON TABLE public\.facility_alert_visibility/);
 assert.match(migration, /Warnungen blendet die Betriebsleitung oder Geschäftsführung betriebsweit aus/);
 assert.match(migration, /Die Ausblendung gehört zu einem anderen Betrieb/);
 assert.match(migration, /pg_advisory_xact_lock/);
 assert.match(migration, /hashtextextended/);
 assert.doesNotMatch(migration, /\.\s*facility_id\s*=\s*facility_id\b/);
});

test('Prüfskripte bleiben lesend', () => {
 assert.match(vorpruefung, /Vorprüfung vor tageswerk_3_6_1_facility_alert_visibility/);
 assert.match(vorpruefung, /Ausschließlich lesend/);
 assert.doesNotMatch(vorpruefung, /INSERT INTO|UPDATE |DELETE FROM|DROP /i);
 assert.match(pruefung, /Lesende Kontrolle/);
 assert.match(pruefung, /schreibt nichts/i);
 assert.match(pruefung, /facility_manager/);
 assert.match(pruefung, /company_admin/);
 assert.match(pruefung, /pg_advisory_xact_lock/);
 assert.doesNotMatch(pruefung, /INSERT INTO|UPDATE |DELETE FROM|DROP /i);
 assert.match(concurrency, /CREATE OR REPLACE FUNCTION public\.tageswerk_stamp_facility_alert_visibility/);
 assert.match(concurrency, /pg_advisory_xact_lock/);
 assert.doesNotMatch(concurrency, /ALTER TABLE public\.temperature_/);
 assert.doesNotMatch(concurrency, /ALTER TABLE public\.water_alerts/);
});
