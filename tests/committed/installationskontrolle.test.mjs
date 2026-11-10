import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const control = readFileSync(new URL('../integration/installationskontrolle.sql', import.meta.url), 'utf8');

const upcoming = [
  'public.tageswerk_stamp_temperature_reading()',
  'public.tageswerk_temperature_alert()',
  'public.tageswerk_acknowledge_temperature()',
  'public.tageswerk_protect_temperature_point()',
  'public.tageswerk_protect_temperature_history()',
  'public.tageswerk_stamp_water_check()',
  'public.tageswerk_record_water_round(uuid,jsonb)',
  'public.tageswerk_save_water_round_draft(uuid,uuid,jsonb,jsonb,integer)',
  'public.tageswerk_discard_water_round_draft(uuid)'
];

function section0Upcoming(present) {
 const missing = upcoming.every(name => present[name] == null)
  && present.temperature_points == null
  && present.water_pools == null;
 if (missing) return 'bereit';
 const water = present['public.tageswerk_stamp_water_check()'];
 if (water != null && !water.includes('reading_code')) return 'stoppen';
 return 'stoppen';
}

function section3Water(present) {
 const water = present['public.tageswerk_stamp_water_check()'];
 if (present.water_pools == null || water == null || !water.includes('reading_code')) return 'pruefen';
 return 'installiert';
}

function requiredFunction(body, known) {
 if (body == null) return 'stoppen';
 return known(body) ? 'bereit' : 'stoppen';
}

test('Abschnitt 0 läuft ohne die noch nicht installierte Wasserfunktion', () => {
 const section0 = control.slice(control.indexOf('-- Abschnitt 0'), control.indexOf('-- Abschnitt 1'));
 assert.equal(section0Upcoming({}), 'bereit');
 assert.equal(section0Upcoming({
  'public.tageswerk_stamp_water_check()': 'WHERE code = code'
 }), 'stoppen');
 assert.equal(section0Upcoming({
  'public.tageswerk_stamp_water_check()': 'parameter_definition.code = reading_code'
 }), 'stoppen');
 assert.equal(requiredFunction(null, () => true), 'stoppen');
 assert.equal(requiredFunction('SELECT 1', body => body.includes('ELSE 3')), 'stoppen');
 assert.equal(requiredFunction('ELSE 3', body => body.includes('ELSE 3')), 'bereit');
 assert.equal(section3Water({}), 'pruefen');
 assert.equal(section3Water({
  water_pools: true,
  'public.tageswerk_stamp_water_check()': 'WHERE code = code'
 }), 'pruefen');
 assert.equal(section3Water({
  water_pools: true,
  'public.tageswerk_stamp_water_check()': 'parameter_definition.code = reading_code'
 }), 'installiert');
 assert.doesNotMatch(control, /::regprocedure/);
 assert.doesNotMatch(control, /::regclass/);
 assert.doesNotMatch(control, /has_table_privilege\('[^']+',\s*'public\./);
 assert.match(section0, /Neue Temperatur- und Wasserfunktionen fehlen noch/);
 assert.match(section0, /to_regprocedure\('public\.tageswerk_stamp_water_check\(\)'\) IS NULL/);
 assert.match(control, /pg_get_functiondef\(to_regprocedure\('public\.tageswerk_stamp_water_check\(\)'\)\)/);
 for (const name of upcoming) assert.match(control, new RegExp(name.replace(/[().]/g, '\\$&')));
});
