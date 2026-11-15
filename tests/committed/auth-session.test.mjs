import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {screenForAuth} from '../../js/password-reset.js';
import {statusNames} from '../../js/labels.js';

const auth = readFileSync(new URL('../../js/auth.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
const supabase = readFileSync(new URL('../../js/supabase.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('Normalbetrieb nutzt echtes Supabase Auth ohne Mock-Login', () => {
 assert.match(auth, /signInWithPassword/);
 assert.match(auth, /signOut/);
 assert.match(auth, /getUser/);
 assert.match(supabase, /createClient/);
 assert.match(supabase, /persistSession:\s*true/);
 assert.match(supabase, /autoRefreshToken:\s*true/);
 assert.doesNotMatch(auth, /mockLogin|fakeLogin|DESIGN-DEMO/);
 assert.doesNotMatch(supabase, /mockLogin|fakeLogin|DESIGN-DEMO/);
 assert.doesNotMatch(app, /mockLogin|fakeLogin|DESIGN-DEMO/);
});

test('Logout setzt sensible Zustände zurück', () => {
 assert.match(app, /signOut\(\)/);
 assert.match(app, /state\.cachedDefects\s*=\s*\[\]/);
 assert.match(app, /state\.defectFacilityFilter\s*=\s*'all'/);
 assert.match(app, /state\.ackRows\s*=\s*\[\]/);
 assert.match(app, /clearLocalWaterDrafts\(\)/);
 assert.match(app, /removeChannel\(state\.realtimeChannel\)/);
 assert.match(app, /onAuthStateChange/);
});

test('Ohne Session bleibt die App geschützt und Login sichtbar', () => {
 assert.equal(screenForAuth({
  callback: {type: 'none'},
  user: null,
  recoveryFlow: false,
  recoveryDone: false,
  passwordRequestOpen: false
 }), 'login');
 assert.equal(screenForAuth({
  callback: {type: 'none'},
  user: {id: 'u1'},
  recoveryFlow: false,
  recoveryDone: false,
  passwordRequestOpen: false
 }), 'app');
 assert.match(index, /Mandantentrennung aktiv/);
});

test('Mängel-Statuskeys bleiben open/in_progress/pending_review/resolved', () => {
 assert.deepEqual(Object.keys(statusNames).sort(), ['in_progress', 'open', 'pending_review', 'resolved'].sort());
 assert.equal(statusNames.open, 'Offen');
 assert.equal(statusNames.resolved, 'Abgeschlossen');
 assert.equal('new' in statusNames, false);
 assert.equal('closed' in statusNames, false);
});
