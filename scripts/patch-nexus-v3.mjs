import {readFileSync, writeFileSync} from 'node:fs';

let html = readFileSync('index.html', 'utf8');

html = html.replace(
 '<meta name="theme-color" content="#0a1220">',
 '<meta name="theme-color" content="#050910">'
);

html = html.replace(
 '<body>',
 '<body class="nexus">'
);

html = html.replace(
 '<p class="login-slogan">Betriebsmanagement. Klar. Sicher. Aktuell.</p>',
 '<p class="login-slogan">Dein Betrieb. Dein Überblick.</p>'
);

html = html.replace(
 '<div class="card dash-command"><div class="dash-command-top"><div><p id="home-greeting" class="home-greeting">Guten Tag!</p><p id="home-facility" class="home-facility">Betrieb</p></div><div class="dash-command-meta"><span class="help" id="live-indicator">Sync …</span><label class="sr-only" for="dashboard-facility">Betrieb auswählen</label><select id="dashboard-facility" class="app-filter" aria-label="Betrieb auswählen"><option value="all">Alle berechtigten Betriebe</option></select></div></div>',
 `<div class="card dash-command nexus-panel"><div class="dash-command-top"><div><p class="nexus-kicker">Betriebszentrale</p><p id="home-greeting" class="home-greeting">Guten Tag!</p><p id="home-facility" class="home-facility">Betrieb</p><div class="nexus-status-row"><span id="nexus-date" class="nexus-chip">—</span><span id="nexus-status" class="nexus-chip status-idle">Status wird geladen …</span></div></div><div class="dash-command-meta"><span class="help" id="live-indicator">Sync …</span><label class="sr-only" for="dashboard-facility">Betrieb auswählen</label><select id="dashboard-facility" class="app-filter" aria-label="Betrieb auswählen"><option value="all">Alle berechtigten Betriebe</option></select></div></div>`
);

html = html.replace(
 '<div class="metric-grid kpi-strip"><div class="metric kpi"><span>Offene Mängel</span><strong id="metric-open">0</strong></div><div class="metric kpi"><span>Meine Aufgaben</span><strong id="metric-mine">0</strong></div><div class="metric kpi"><span>In Bearbeitung</span><strong id="metric-progress">0</strong></div><div class="metric kpi critical"><span>Kritisch</span><strong id="metric-critical">0</strong></div></div>',
 `<div class="metric-grid kpi-strip nexus-kpi"><div class="metric kpi nexus-kpi-card" data-tone="open"><span class="kpi-dot" aria-hidden="true"></span><span>Offene Mängel</span><strong id="metric-open">0</strong></div><div class="metric kpi nexus-kpi-card" data-tone="tasks"><span class="kpi-dot" aria-hidden="true"></span><span>Aufgaben</span><strong id="metric-mine">0</strong></div><div class="metric kpi nexus-kpi-card critical" data-tone="critical"><span class="kpi-dot" aria-hidden="true"></span><span>Kritische Meldungen</span><strong id="metric-critical">0</strong></div><div class="metric kpi nexus-kpi-card" data-tone="progress"><span class="kpi-dot" aria-hidden="true"></span><span>Laufende Vorgänge</span><strong id="metric-progress">0</strong></div></div>`
);

if (!html.includes('nexus-kicker')) throw new Error('Dashboard nexus patch failed');
if (!html.includes('Dein Betrieb. Dein Überblick.')) throw new Error('Login slogan patch failed');
if (!html.includes('class="nexus"')) throw new Error('Body class missing');

writeFileSync('index.html', html);
console.log('Nexus v3 HTML-Patch ok');
