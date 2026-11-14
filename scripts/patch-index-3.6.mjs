import fs from 'node:fs';

const path = new URL('../index.html', import.meta.url);
let html = fs.readFileSync(path, 'utf8');
html = html.replaceAll('Tageswerk 3.5.7', 'Tageswerk 3.6.0');
html = html.replace('<small>3.5.7</small>', '<small>3.6.0</small>');
if (!html.includes('theme-3.6.css')) {
 html = html.replace(
  'href="./css/app.css">',
  'href="./css/app.css"><link rel="stylesheet" href="./css/theme-3.6.css">'
 );
}
const panels = [
 '<div class="dash-hero">',
 '<div class="dash-panel" id="dash-weather-card"><h3>Wetter</h3><div id="dash-weather"><p class="help">Wird geladen …</p></div></div>',
 '<div class="dash-panel" id="dash-analytics-card"><h3>Verbrauch</h3>',
 '<div class="stats-toolbar">',
 '<label>Medium<select id="dash-analytics-medium"><option value="electricity">Strom</option><option value="water">Wasser</option><option value="heat">Fernwärme</option><option value="gas">Gas</option></select></label>',
 '<label>Zeitraum<select id="dash-analytics-range"><option value="day">Tag</option><option value="month" selected>30 Tage</option><option value="year">Jahr</option></select></label>',
 '</div><div id="dash-analytics"><p class="help">Wird geladen …</p></div></div></div>'
].join('');
if (!html.includes('id="dash-weather"')) {
 html = html.replace(
  '<div class="quick-grid" id="home-quick"></div></div>',
  `<div class="quick-grid" id="home-quick"></div></div>${panels}`
 );
}
fs.writeFileSync(path, html);
console.log({
 theme: html.includes('theme-3.6.css'),
 weather: html.includes('dash-weather'),
 version: html.includes('3.6.0')
});
