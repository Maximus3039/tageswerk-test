import assert from 'node:assert/strict';
import test from 'node:test';
import {
 clearWeatherCache,
 facilityCoordinates,
 looksLikePlaceName,
 resolveFacilityLocation,
 weatherForFacility,
 weatherReportLine
} from '../../js/weather.js';

test('Koordinaten und Ortsnamenprüfung trennen verlässliche Standorte', () => {
 assert.deepEqual(facilityCoordinates({latitude: 52.5, longitude: 13.4}), {
  lat: 52.5, lon: 13.4, source: 'facility', uncertain: false
 });
 assert.equal(facilityCoordinates({latitude: 200, longitude: 13}), null);
 assert.equal(looksLikePlaceName('Berlin-Lichtenberg'), true);
 assert.equal(looksLikePlaceName('a'), false);
 assert.equal(looksLikePlaceName('12345'), false);
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
