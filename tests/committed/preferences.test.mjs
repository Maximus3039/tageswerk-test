import assert from 'node:assert/strict';
import test from 'node:test';
import {
 autoAlertWindowsEnabled,
 personalAlertPreferenceKey,
 setAutoAlertWindowsEnabled,
 storedFacilityLocation,
 writeFacilityLocation
} from '../../js/preferences.js';

function memory() {
 return {
  store: {},
  getItem(key) { return Object.hasOwn(this.store, key) ? this.store[key] : null; },
  setItem(key, value) { this.store[key] = String(value); }
 };
}

test('Automatische Warnfenster bleiben ohne Eintrag aktiv und überstehen Neustart', () => {
 const storage = memory();
 assert.equal(autoAlertWindowsEnabled('user-1', storage), true);
 setAutoAlertWindowsEnabled('user-1', false, storage);
 assert.equal(autoAlertWindowsEnabled('user-1', storage), false);
 assert.equal(autoAlertWindowsEnabled('user-2', storage), true);
 setAutoAlertWindowsEnabled('user-1', true, storage);
 assert.equal(autoAlertWindowsEnabled('user-1', storage), true);
});

test('Warnfenster-Einstellung bleibt benutzerbezogen und unabhängig von Eskalationsregeln', () => {
 const storage = memory();
 assert.match(personalAlertPreferenceKey('user-1'), /user-1/);
 assert.notEqual(personalAlertPreferenceKey('user-1'), personalAlertPreferenceKey('user-2'));
 setAutoAlertWindowsEnabled('user-1', false, storage);
 storage.setItem('facility_escalation_settings', '{"broken":true}');
 assert.equal(autoAlertWindowsEnabled('user-1', storage), false);
 assert.equal(autoAlertWindowsEnabled('user-2', storage), true);
 const restarted = memory();
 restarted.store = {...storage.store};
 delete restarted.store.facility_escalation_settings;
 assert.equal(autoAlertWindowsEnabled('user-1', restarted), false);
 assert.equal(autoAlertWindowsEnabled('user-2', restarted), true);
});

test('Wetterstandorte werden je Betrieb gespeichert', () => {
 const storage = memory();
 writeFacilityLocation('fac-a', {lat: 53.1, lon: 12.5, source: 'geocode', uncertain: true, place: 'Pritzwalk'}, storage);
 const stored = storedFacilityLocation('fac-a', storage);
 assert.equal(stored.lat, 53.1);
 assert.equal(stored.place, 'Pritzwalk');
 assert.equal(storedFacilityLocation('fac-b', storage), null);
});
