import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
 analyticsWindow,
 buildAnalytics,
 formatDelta,
 percentChange,
 sparkHeights,
 sumPoints
} from '../../js/consumption-analytics.js';
import {weatherReportLine} from '../../js/weather.js';

const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../../css/tokens.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../../css/theme-3.6.css', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../../js/dashboard.js', import.meta.url), 'utf8');
const sections = readFileSync(new URL('../../js/operations-ui-sections.js', import.meta.url), 'utf8');
const locationMigration = readFileSync(new URL('../../tageswerk_3_6_0_facility_location.sql', import.meta.url), 'utf8');
const weatherMigration = readFileSync(new URL('../../tageswerk_3_6_0_daily_report_weather.sql', import.meta.url), 'utf8');
const pages = readFileSync(new URL('../../.github/workflows/pages.yml', import.meta.url), 'utf8');

test('3.6.0 Designsystem und Dashboard-Anker sind verdrahtet', () => {
 assert.match(index, /theme-3\.6\.css/);
 assert.match(index, /dash-weather/);
 assert.match(index, /dash-analytics/);
 assert.match(index, /dash-command/);
 assert.match(index, /nexus-kicker/);
 assert.match(index, /Betriebszentrale/);
 assert.match(index, /login-brand/);
 assert.match(index, /Dein Betrieb\. Dein Überblick\./);
 assert.match(index, /defect-composer/);
 assert.match(index, /module-grid/);
 assert.match(index, /nexus-v4/);
 assert.match(index, /nexus-v41/);
 assert.match(index, /nexus-v42/);
 assert.match(index, /nexus-v43/);
 assert.match(index, /facility-spotlight/);
 assert.match(index, /facility-select-in-spotlight/);
 assert.match(index, /more-modules-card/);
 assert.match(index, /nexus-defects-toolbar/);
 assert.match(index, /nexus-command-head/);
 assert.match(index, /class="nexus/);
 assert.match(index, /Tageswerk 3\.6\.0/);
 assert.match(tokens, /--nexus-bg/);
 assert.match(tokens, /--nexus-cyan/);
 assert.match(tokens, /--nexus-glow/);
 assert.match(tokens, /--nexus-accent/);
 assert.match(tokens, /--nexus-danger/);
 assert.match(tokens, /--nexus-success/);
 assert.match(tokens, /--tw-accent/);
 assert.match(tokens, /--tw-blue/);
 assert.match(theme, /body\.nexus::before/);
 assert.match(theme, /body\.nexus-v4/);
 assert.match(theme, /body\.nexus-v41/);
 assert.match(theme, /body\.nexus-v42/);
 assert.match(theme, /body\.nexus-v43/);
 assert.match(theme, /facility-select-in-spotlight/);
 assert.match(theme, /nexus-defects-toolbar/);
 assert.match(theme, /facility-spotlight/);
 assert.match(theme, /neon-tile/);
 assert.match(theme, /--nexus-specular/);
 assert.match(tokens, /--nexus-specular/);
 assert.match(dashboard, /facility-spotlight-status/);
 assert.match(theme, /dash-hero/);
 assert.match(theme, /kpi-strip/);
 assert.match(theme, /module-card/);
 assert.match(theme, /defect-composer/);
 assert.match(theme, /weather-card/);
 assert.match(theme, /sparkline/);
 assert.match(tokens, /prefers-reduced-motion/);
 assert.match(theme, /--nexus-motion/);
 assert.match(dashboard, /renderWeatherPanel/);
 assert.match(dashboard, /renderAnalyticsPanel/);
 assert.match(dashboard, /paintNexusStatus/);
 assert.match(dashboard, /facility-spotlight-status/);
 assert.match(dashboard, /membershipAllowsMeterReading/);
 // V4.3 Desktop: Nav/Actions nebeneinander; Mobil: 2-Spalten-Grid
 assert.match(theme, /body\.nexus-v43 \.nexus-defects-toolbar \.defects-nav button[\s\S]*?width:auto/);
 assert.match(theme, /@media\(max-width:850px\)[\s\S]*nexus-defects-toolbar \.defects-nav[\s\S]*grid-template-columns:1fr 1fr/);
 assert.match(index, /Mandantentrennung aktiv/);
});

test('Verbrauchslogik kennzeichnet Schätzungen und vergleicht Perioden', () => {
 const now = {y: 2026, m: 11, d: 14};
 const window = analyticsWindow('month', now);
 assert.equal(window.grain, 'day');
 const analytics = buildAnalytics([
  {
   medium: 'electricity', facility_id: 'f1', meter_id: 'm1', unit: 'kWh',
   bucket_start: '2026-11-14', measured_value: '10', estimated_value: null,
   parent_meter_id: null, counts_in_facility_total: true
  },
  {
   medium: 'electricity', facility_id: 'f1', meter_id: 'm1', unit: 'kWh',
   bucket_start: '2026-11-13', measured_value: null, estimated_value: '8',
   parent_meter_id: null, counts_in_facility_total: true
  }
 ], {medium: 'electricity', range: 'month', now});
 assert.equal(analytics.unit, 'kWh');
 assert.ok(['measured', 'mixed', 'estimated'].includes(analytics.current.kind));
 assert.equal(sumPoints([{total: 1000n}, {total: 500n}]).total, 1500n);
 assert.equal(percentChange(110n, 100n), 10);
 assert.equal(formatDelta(12.34).tone, 'delta-up');
 assert.equal(sparkHeights([{total: 100n}, {total: 50n, estimated: 50n, measured: null}]).length, 2);
});

test('Wetterzeile und Tagesbericht-Übernahme sind vorbereitet', () => {
 const line = weatherReportLine({
  temperature: 18,
  label: 'leicht bewölkt',
  rainChance: 10,
  source: 'Open-Meteo',
  kind: 'forecast',
  observedAt: '2026-11-14T10:00'
 }, {place: 'Berlin'});
 assert.match(line, /18 °C/);
 assert.match(line, /Open-Meteo/);
 assert.match(sections, /Wetter für Bericht laden/);
 assert.match(sections, /allowGeocode:\s*true/);
 assert.match(sections, /weatherSummary/);
 assert.match(dashboard, /weather-uncertain/);
 assert.match(locationMigration, /ADD COLUMN latitude/);
 assert.match(weatherMigration, /weather_summary/);
 assert.match(weatherMigration, /Nicht ohne ausdrückliche Freigabe ausführen/);
 assert.match(pages, /ref: 240a2e85dee772857bd14cd6206818e33175e56e/);
});
