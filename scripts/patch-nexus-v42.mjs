import {readFileSync, writeFileSync} from 'node:fs';

let html = readFileSync('index.html', 'utf8');

html = html.replace(
 '<body class="nexus nexus-v4 nexus-v41">',
 '<body class="nexus nexus-v4 nexus-v41 nexus-v42">'
);

const oldDash = `<div class="card dash-command nexus-panel"><div class="nexus-command-head"><div class="nexus-brand-row"><span class="nexus-brand-mark" aria-hidden="true">◈</span><div><strong class="nexus-brand-name">Tageswerk</strong><span class="nexus-brand-tag">Nexus</span></div></div><div class="nexus-status-row"><span id="nexus-date" class="nexus-chip">—</span><span id="nexus-status" class="nexus-chip status-idle">Status wird geladen …</span></div></div><p class="nexus-kicker">Betriebszentrale</p><p id="home-greeting" class="home-greeting">Guten Tag!</p><p id="home-facility" class="home-facility sr-only">Betrieb</p><div id="facility-spotlight" class="facility-spotlight"><div id="facility-spotlight-media" class="facility-spotlight-media hidden" role="img" aria-label="Betriebsbild"></div><div class="facility-spotlight-body"><div class="facility-spotlight-top"><div><p class="facility-spotlight-label">Aktueller Betrieb</p><p id="facility-spotlight-name" class="facility-spotlight-name">—</p></div><span class="help facility-sync" id="live-indicator">Sync …</span></div><div id="facility-spotlight-status" class="facility-spotlight-status"></div><div class="facility-select-wrap"><label class="sr-only" for="dashboard-facility">Betrieb auswählen</label><select id="dashboard-facility" class="app-filter" aria-label="Betrieb auswählen"><option value="all">Alle berechtigten Betriebe</option></select></div></div></div><ul id="home-today" class="home-today"></ul><div class="quick-grid" id="home-quick"></div></div><div class="metric-grid kpi-strip nexus-kpi">`;

const newDash = `<div class="card dash-command nexus-panel"><div class="nexus-command-head"><div class="nexus-brand-row"><span class="nexus-brand-mark" aria-hidden="true">◈</span><div><strong class="nexus-brand-name">Tageswerk</strong><span class="nexus-brand-tag">Nexus</span></div></div></div><p class="nexus-kicker">Betriebszentrale</p><p id="home-greeting" class="home-greeting">Guten Tag!</p><div class="nexus-status-row home-status-row"><span id="nexus-date" class="nexus-chip">—</span><span id="nexus-status" class="nexus-chip status-idle">Status wird geladen …</span><span class="help facility-sync" id="live-indicator">Sync …</span></div><p id="home-facility" class="home-facility sr-only">Betrieb</p><div class="facility-select-wrap facility-select-primary"><label class="sr-only" for="dashboard-facility">Betrieb auswählen</label><select id="dashboard-facility" class="app-filter" aria-label="Betrieb auswählen"><option value="all">Alle berechtigten Betriebe</option></select></div><div id="facility-spotlight" class="facility-spotlight"><div id="facility-spotlight-media" class="facility-spotlight-media hidden" role="img" aria-label="Betriebsbild"></div><div class="facility-spotlight-body"><p class="facility-spotlight-label">Aktueller Betrieb</p><p id="facility-spotlight-name" class="facility-spotlight-name">—</p><div id="facility-spotlight-status" class="facility-spotlight-status"></div></div></div></div><div class="metric-grid kpi-strip nexus-kpi">`;

if (!html.includes(oldDash)) {
 console.error('dashboard fragment missing');
 process.exit(1);
}
html = html.replace(oldDash, newDash);

const afterResolved = `<div class="metric-grid kpi-strip secondary"><div class="metric kpi"><span>Zur Freigabe</span><strong id="metric-review">0</strong></div><div class="metric kpi"><span>Abgeschlossen</span><strong id="metric-resolved">0</strong></div></div><div class="dash-hero">`;
const withHome = `<div class="metric-grid kpi-strip secondary"><div class="metric kpi"><span>Zur Freigabe</span><strong id="metric-review">0</strong></div><div class="metric kpi"><span>Abgeschlossen</span><strong id="metric-resolved">0</strong></div></div><ul id="home-today" class="home-today"></ul><div class="quick-grid" id="home-quick"></div><div class="dash-hero">`;
if (!html.includes(afterResolved)) {
 console.error('kpi secondary fragment missing');
 process.exit(1);
}
html = html.replace(afterResolved, withHome);

const moreStart = `<div id="view-more" class="view hidden"><div class="card"><h2>Weitere Module</h2><p class="help">Mitarbeiterverwaltung, Einladungen und Betriebseinstellungen. Der Eintrag Verbrauch öffnet die Verbrauchserfassung.</p><div class="row"><button type="button" id="open-consumption" class="secondary navbtn">Verbrauch</button><button type="button" id="open-operations" class="secondary navbtn">Betrieb</button></div></div><div class="card hidden" id="operations-card">`;
const moreNew = `<div id="view-more" class="view hidden"><div class="card" id="operations-card"><div class="section-title"><h2>Betriebsführung</h2></div>`;

// Extract operations-card body carefully
const opsMarker = 'id="operations-card">';
const opsIdx = html.indexOf(opsMarker);
if (opsIdx < 0) {
 console.error('operations-card missing');
 process.exit(1);
}
const opsInnerStart = opsIdx + opsMarker.length;
const opsEndMarker = '</div><div class="card hidden" id="consumption-card">';
const opsEnd = html.indexOf(opsEndMarker, opsInnerStart);
if (opsEnd < 0) {
 console.error('operations end missing');
 process.exit(1);
}
const opsInner = html.slice(opsInnerStart, opsEnd);
// opsInner starts with section-title... through panel
const weitereCard = `<div class="card" id="more-modules-card"><h2>Weitere Module</h2><p class="help">Verbrauchserfassung und Betriebseinstellungen. Mitarbeiterverwaltung und Einladungen bleiben unverändert berechtigt.</p><div class="row"><button type="button" id="open-consumption" class="secondary navbtn">Verbrauch</button><button type="button" id="open-operations" class="secondary navbtn">Betrieb</button></div></div>`;

const oldMoreBlock = html.slice(html.indexOf('id="view-more"'), opsEnd);
const newMoreBlock = `id="view-more" class="view hidden"><div class="card" id="operations-card">${opsInner}</div>${weitereCard}`;
// Fix: opsInner already includes section-title from old card - old was `<div class="card hidden" id="operations-card"><div class="section-title"...`
// We're replacing from view-more through opsEnd (before consumption)

const viewMoreIdx = html.indexOf('<div id="view-more"');
const before = html.slice(0, viewMoreIdx);
const after = html.slice(opsEnd); // starts with </div><div class="card hidden" id="consumption-card">
// opsEnd points to '</div><div class="card hidden" id="consumption-card">' - the </div> closes operations-card
// so after includes that closing </div> - we need consumption card without the ops closing duplicate

// Re-parse: opsEnd = index of '</div><div class="card hidden" id="consumption-card">'
// html[opsInnerStart:opsEnd] = content inside operations-card
// We want: view-more > operations-card (content) > weitere > then consumption...

html = before + `<div id="view-more" class="view hidden"><div class="card" id="operations-card">${opsInner}</div>${weitereCard}` + after.slice('</div>'.length);

writeFileSync('index.html', html);
console.log({
 v42: html.includes('nexus-v42'),
 selectPrimary: html.includes('facility-select-primary'),
 homeAfterKpi: html.indexOf('id="home-today"') > html.indexOf('metric-resolved'),
 opsBeforeMore: html.indexOf('id="operations-card"') < html.indexOf('id="more-modules-card"'),
 opsNotHidden: !html.includes('card hidden" id="operations-card"'),
 consumption: html.includes('id="consumption-card"')
});
