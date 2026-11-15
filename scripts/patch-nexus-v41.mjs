import {readFileSync, writeFileSync} from 'node:fs';

let html = readFileSync('index.html', 'utf8');

html = html.replace(
 '<body class="nexus nexus-v4">',
 '<body class="nexus nexus-v4 nexus-v41">'
);

const oldCommand = `<div class="card dash-command nexus-panel"><div class="nexus-brand-row"><span class="nexus-brand-mark" aria-hidden="true">◈</span><div><strong class="nexus-brand-name">Tageswerk</strong><span class="nexus-brand-tag">Nexus</span></div></div><div class="dash-command-top"><div><p class="nexus-kicker">Betriebszentrale</p><p id="home-greeting" class="home-greeting">Guten Tag!</p><p id="home-facility" class="home-facility">Betrieb</p><div class="nexus-status-row"><span id="nexus-date" class="nexus-chip">—</span><span id="nexus-status" class="nexus-chip status-idle">Status wird geladen …</span></div></div><div id="facility-spotlight" class="facility-spotlight"><div id="facility-spotlight-media" class="facility-spotlight-media hidden" role="img" aria-label="Betriebsbild"></div><div class="facility-spotlight-body"><p class="facility-spotlight-label">Aktueller Betrieb</p><p id="facility-spotlight-name" class="facility-spotlight-name">—</p><div id="facility-spotlight-status" class="facility-spotlight-status"></div></div></div><div class="dash-command-meta facility-select-wrap"><span class="help" id="live-indicator">Sync …</span><label class="sr-only" for="dashboard-facility">Betrieb auswählen</label><select id="dashboard-facility" class="app-filter" aria-label="Betrieb auswählen"><option value="all">Alle berechtigten Betriebe</option></select></div></div>`;

const newCommand = `<div class="card dash-command nexus-panel"><div class="nexus-command-head"><div class="nexus-brand-row"><span class="nexus-brand-mark" aria-hidden="true">◈</span><div><strong class="nexus-brand-name">Tageswerk</strong><span class="nexus-brand-tag">Nexus</span></div></div><div class="nexus-status-row"><span id="nexus-date" class="nexus-chip">—</span><span id="nexus-status" class="nexus-chip status-idle">Status wird geladen …</span></div></div><p class="nexus-kicker">Betriebszentrale</p><p id="home-greeting" class="home-greeting">Guten Tag!</p><p id="home-facility" class="home-facility sr-only">Betrieb</p><div id="facility-spotlight" class="facility-spotlight"><div id="facility-spotlight-media" class="facility-spotlight-media hidden" role="img" aria-label="Betriebsbild"></div><div class="facility-spotlight-body"><div class="facility-spotlight-top"><div><p class="facility-spotlight-label">Aktueller Betrieb</p><p id="facility-spotlight-name" class="facility-spotlight-name">—</p></div><span class="help facility-sync" id="live-indicator">Sync …</span></div><div id="facility-spotlight-status" class="facility-spotlight-status"></div><div class="facility-select-wrap"><label class="sr-only" for="dashboard-facility">Betrieb auswählen</label><select id="dashboard-facility" class="app-filter" aria-label="Betrieb auswählen"><option value="all">Alle berechtigten Betriebe</option></select></div></div></div>`;

if (!html.includes(oldCommand)) {
 console.error('dash-command fragment not found');
 process.exit(1);
}

html = html.replace(oldCommand, newCommand);
writeFileSync('index.html', html);
console.log({
 v41: html.includes('nexus-v41'),
 selectInSpotlight: html.includes('facility-spotlight-body') && html.includes('facility-select-wrap'),
 homeFacilitySr: html.includes('home-facility" class="home-facility sr-only"'),
 noDashCommandTop: !html.includes('dash-command-top')
});
