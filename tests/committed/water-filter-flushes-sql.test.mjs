import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_flushes.sql', import.meta.url), 'utf8');
const pruefung = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_flushes_pruefung.sql', import.meta.url), 'utf8');
const verhalten = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_flushes_verhalten.sql', import.meta.url), 'utf8');
const vorpruefung = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_flushes_vorpruefung.sql', import.meta.url), 'utf8');
const diagnose = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_flushes_rls_diagnose.sql', import.meta.url), 'utf8');

test('Filterspülungs-Migration bleibt vorbereitet und nicht wiederholbar', () => {
 assert.match(migration, /Nicht ohne ausdrückliche Freigabe ausführen/);
 assert.match(migration, /nicht wiederholbar/);
 assert.match(migration, /water_filters sind bereits installiert|Filterspülungen sind bereits installiert/);
 assert.match(migration, /CREATE TABLE public\.water_filters/);
 assert.match(migration, /CREATE TABLE public\.water_filter_flushes/);
 assert.match(migration, /last_flushed_at/);
 assert.match(migration, /last_flushed_by/);
 assert.doesNotMatch(migration, /DROP TABLE/);
 assert.doesNotMatch(migration, /DISABLE ROW LEVEL SECURITY/);
});

test('Filter und Spülungen haben serverseitige Schutz- und Stempelregeln', () => {
 assert.match(migration, /CREATE UNIQUE INDEX water_filters_pool_active_name/);
 assert.match(migration, /lower\(btrim\(name\)\)/);
 assert.match(migration, /WHERE active IS TRUE/);
 assert.match(migration, /Filter werden nicht gelöscht, sondern deaktiviert/);
 assert.match(migration, /Dokumentierte Filterspülungen bleiben unverändert/);
 assert.match(migration, /interval '24 hours'/);
 assert.match(migration, /zukünftiger Spülzeitpunkt/);
 assert.match(migration, /NEW\.recorded_by := auth\.uid\(\)/);
 assert.match(migration, /NEW\.recorded_at := now_ts/);
 assert.match(migration, /ORDER BY flush_row\.flushed_at DESC, flush_row\.recorded_at DESC, flush_row\.id DESC/);
 assert.match(migration, /SECURITY DEFINER/);
 assert.match(migration, /TG_OP IS DISTINCT FROM 'INSERT'/);
 assert.match(migration, /TG_WHEN IS DISTINCT FROM 'AFTER'/);
 assert.match(migration, /water_filter_flushes_a_stamp/);
 assert.match(migration, /water_filter_flushes_b_bind/);
 assert.match(migration, /pg_trigger_depth\(\) <= 1/);
 assert.match(migration, /Der Filter gehört zu einem anderen Betrieb als das Becken/);
 assert.match(migration, /REVOKE ALL ON FUNCTION public\.tageswerk_apply_water_filter_last_flush\(\) FROM PUBLIC, anon, authenticated;/);
 assert.match(migration, /REVOKE ALL ON FUNCTION public\.tageswerk_stamp_water_filter_flush\(\) FROM PUBLIC, anon, authenticated;/);
});

test('RLS trennt Mitarbeiter, Techniker und Leitung', () => {
 assert.match(migration, /FORCE ROW LEVEL SECURITY/);
 assert.match(migration, /water_filters_select[\s\S]*employee[\s\S]*active IS TRUE/);
 assert.match(migration, /water_filter_flushes_select[\s\S]*'technician', 'facility_manager', 'company_admin'/);
 assert.match(migration, /water_filters_insert[\s\S]*'company_admin', 'facility_manager'/);
 assert.match(migration, /water_filters_update[\s\S]*'company_admin', 'facility_manager'/);
 assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.water_filter_flushes TO authenticated;/);
 assert.doesNotMatch(migration, /GRANT UPDATE ON TABLE public\.water_filter_flushes/);
 assert.doesNotMatch(migration, /GRANT DELETE ON TABLE public\.water_filter_flushes/);
 assert.match(migration, /filter_row\.facility_id = water_filter_flushes\.facility_id/);
 assert.match(migration, /pool\.facility_id = water_filters\.facility_id/);
 assert.doesNotMatch(migration, /\.\s*facility_id\s*=\s*facility_id\b/);
 assert.doesNotMatch(migration, /\.\s*organization_id\s*=\s*organization_id\b/);
});

test('Prüfskripte decken Schema und Verhalten ab ohne Produktivzwang', () => {
 assert.match(pruefung, /Lesende Kontrolle/);
 assert.match(pruefung, /schreibt nichts/);
 assert.match(pruefung, /24 Stunden/);
 assert.match(pruefung, /Mitarbeiter ohne Historie/);
 assert.match(pruefung, /Kein EXECUTE für authenticated/);
 assert.match(pruefung, /ILIKE '%technician%'/);
 assert.match(pruefung, /ILIKE '%facility_manager%'/);
 assert.match(pruefung, /ILIKE '%company_admin%'/);
 assert.match(pruefung, /NOT ILIKE '%employee%'/);
 assert.match(pruefung, /active = true%/);
 assert.doesNotMatch(pruefung, /position\(''technician'', ''facility_manager'', ''company_admin'''/);
 assert.match(vorpruefung, /Vorprüfung vor tageswerk_3_5_8_water_filter_flushes/);
 assert.match(vorpruefung, /Ausschließlich lesend/);
 assert.match(vorpruefung, /Keine Namenskonflikte Tabellen/);
 assert.match(vorpruefung, /technician/);
 assert.doesNotMatch(vorpruefung, /INSERT INTO|UPDATE |DELETE FROM|DROP /i);
 assert.match(diagnose, /Lesende Diagnose/);
 assert.match(diagnose, /Schreibt nichts/);
 assert.match(diagnose, /fehlschlag_der_prueflogik/);
 assert.match(diagnose, /=\s*ANY\s*\(ARRAY/);
 assert.match(diagnose, /\$\$flush_select: technician\$\$/);
 assert.match(diagnose, /\$\$'technician', 'facility_manager', 'company_admin'\$\$/);
 assert.match(diagnose, /Katalog: alle water_filters/);
 assert.match(diagnose, /Endgültige RLS-Sicherheit/);
 assert.doesNotMatch(diagnose, /position\(''''/);
 assert.doesNotMatch(diagnose, /\bINSERT INTO\b|\bDELETE FROM\b|\bDROP POLICY\b|\bCREATE POLICY\b|\bALTER POLICY\b/i);
 assert.match(verhalten, /NICHT in der Produktivdatenbank/);
 assert.match(verhalten, /tageswerk\.integration_test/);
 assert.match(verhalten, /Nachtrag außerhalb 24 Stunden/);
 assert.match(verhalten, /Zukünftiger Spülzeitpunkt/);
 assert.match(verhalten, /Deaktivierter Filter/);
 assert.match(verhalten, /Unberechtigte Spülung/);
 assert.match(verhalten, /älterer Nachtrag überschreibt nicht/);
 assert.match(verhalten, /Spülhistorie ist unveränderlich/);
 assert.match(verhalten, /Techniker liest die Spülhistorie/);
 assert.match(verhalten, /Mitarbeiter liest keine Spülhistorie/);
});
