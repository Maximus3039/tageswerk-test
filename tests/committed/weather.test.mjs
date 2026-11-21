import assert from 'node:assert/strict';
import test from 'node:test';
import {
 applyFacilityCoordinates,
 clearWeatherCache,
 facilityCoordinates,
 looksLikePlaceName,
 parseManualCoordinates,
 resolveFacilityLocation,
 weatherForFacility,
 weatherReportLine
} from '../../js/weather.js';

test('Koordinaten und Ortsnamenprüfung trennen verlässliche Standorte', () => {
 assert.deepEqual(facilityCoordinates({latitude: 52.5, longitude: 13.4}), {
  lat: 52.5, lon: 13.4, source: 'facility', uncertain: false
 });
 assert.equal(facilityCoordinates({latitude: 200, longitude: 13}), null);
 assert.equal(facilityCoordinates({latitude: null, longitude: null}), null);
 assert.equal(looksLikePlaceName('Berlin-Lichtenberg'), true);
 assert.equal(looksLikePlaceName('a'), false);
 assert.equal(looksLikePlaceName('12345'), false);
});

test('Manuelle Standortkoordinaten werden geprüft und in den Betrieb übernommen', () => {
 const invalid = parseManualCoordinates('200', '13');
 assert.equal(invalid.ok, false);
 const parsed = parseManualCoordinates('52,5', '13,4');
 assert.equal(parsed.ok, true);
 assert.equal(parsed.location.source, 'stored');
 assert.equal(parsed.location.uncertain, false);
 const facilities = [{id: 'fac-a', name: 'Alpha Nord', latitude: null, longitude: null}];
 applyFacilityCoordinates(facilities, 'fac-a', parsed.location);
 assert.equal(facilities[0].latitude, 52.5);
 assert.equal(facilities[0].longitude, 13.4);
 const shown = facilityCoordinates(facilities[0]);
 assert.equal(shown.source, 'facility');
 assert.equal(shown.lat, 52.5);
});

test('Gespeicherter Betriebsstandort gilt nur ohne Datenbankkoordinaten', () => {
 const memory = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, value) { this.store[key] = String(value); }
 };
 memory.setItem('tageswerk-facility-locations-v1', JSON.stringify({
  'fac-a': {lat: 53.1, lon: 12.5, source: 'geocode', uncertain: true, place: 'Pritzwalk'}
 }));
 const stored = facilityCoordinates({id: 'fac-a'}, memory);
 assert.equal(stored.lat, 53.1);
 assert.equal(stored.source, 'geocode');
 const preferred = facilityCoordinates({id: 'fac-a', latitude: 52.5, longitude: 13.4}, memory);
 assert.equal(preferred.source, 'facility');
 assert.equal(preferred.lat, 52.5);
});

test('Dashboard löst ohne Koordinaten kein stilles Geocoding aus', async () => {
 clearWeatherCache();
 const denied = await resolveFacilityLocation({name: 'Berlin'}, {allowGeocode: false});
 assert.equal(denied, null);
 const weather = await weatherForFacility({name: 'Berlin'});
 assert.equal(weather.ok, false);
 assert.match(weather.error, /Kein hinterlegter Standort|Koordinaten/);
});

test('Wetterzeile kennzeichnet geschätzte Standorte', () => {
 const line = weatherReportLine({
  temperature: 12,
  label: 'Bewölkt',
  rainChance: 20,
  source: 'Open-Meteo',
  kind: 'forecast',
  observedAt: '2026-11-14T10:00'
 }, {place: 'Berlin, DE', source: 'geocode', uncertain: true});
 assert.match(line, /12 °C/);
 assert.match(line, /geschätzt/);
});
