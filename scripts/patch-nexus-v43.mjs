import {readFileSync, writeFileSync} from 'node:fs';

let html = readFileSync('index.html', 'utf8');

html = html.replace(
 '<body class="nexus nexus-v4 nexus-v41 nexus-v42">',
 '<body class="nexus nexus-v4 nexus-v41 nexus-v42 nexus-v43">'
);

const oldSelectSpot = `<div class="facility-select-wrap facility-select-primary"><label class="sr-only" for="dashboard-facility">Betrieb auswählen</label><select id="dashboard-facility" class="app-filter" aria-label="Betrieb auswählen"><option value="all">Alle berechtigten Betriebe</option></select></div><div id="facility-spotlight" class="facility-spotlight"><div id="facility-spotlight-media" class="facility-spotlight-media hidden" role="img" aria-label="Betriebsbild"></div><div class="facility-spotlight-body"><p class="facility-spotlight-label">Aktueller Betrieb</p><p id="facility-spotlight-name" class="facility-spotlight-name">—</p><div id="facility-spotlight-status" class="facility-spotlight-status"></div></div></div>`;

const newSelectSpot = `<div id="facility-spotlight" class="facility-spotlight"><div id="facility-spotlight-media" class="facility-spotlight-media hidden" role="img" aria-label="Betriebsbild"></div><div class="facility-spotlight-body"><p class="facility-spotlight-label">Aktueller Betrieb</p><div class="facility-select-wrap facility-select-in-spotlight"><label class="sr-only" for="dashboard-facility">Betrieb auswählen</label><select id="dashboard-facility" class="app-filter" aria-label="Betrieb auswählen"><option value="all">Alle berechtigten Betriebe</option></select></div><p id="facility-spotlight-name" class="facility-spotlight-name sr-only">—</p><div id="facility-spotlight-status" class="facility-spotlight-status"></div></div></div>`;

if (!html.includes(oldSelectSpot)) {
 console.error('select/spotlight fragment missing');
 process.exit(1);
}
html = html.replace(oldSelectSpot, newSelectSpot);

const oldToolbar = `<div class="defects-toolbar"><div class="row defects-nav"><button type="button" id="nav-mine" class="secondary navbtn">Meine Aufgaben <span id="mine-count" class="count">0</span></button><button type="button" id="nav-all" class="secondary navbtn active">Offene Mängel</button></div><div class="row defects-actions"><button type="button" id="open-defect-form" class="primary-action">+ Neuen Mangel</button><button type="button" id="refresh-defects" class="secondary compact-button">Aktualisieren</button></div></div>`;

const newToolbar = `<div class="defects-toolbar nexus-defects-toolbar"><div class="row defects-nav"><button type="button" id="nav-mine" class="secondary navbtn">Meine Aufgaben <span id="mine-count" class="count">0</span></button><button type="button" id="nav-all" class="secondary navbtn active">Offene Mängel</button></div><div class="row defects-actions"><button type="button" id="open-defect-form" class="primary-action">+ Neuen Mangel</button><button type="button" id="refresh-defects" class="secondary compact-button">Aktualisieren</button></div></div>`;

if (!html.includes(oldToolbar)) {
 console.error('defects toolbar missing');
 process.exit(1);
}
html = html.replace(oldToolbar, newToolbar);

writeFileSync('index.html', html);
console.log({
 v43: html.includes('nexus-v43'),
 selectInSpot: html.includes('facility-select-in-spotlight'),
 noPrimary: !html.includes('facility-select-primary'),
 nameSr: html.includes('facility-spotlight-name" class="facility-spotlight-name sr-only"'),
 defectsToolbar: html.includes('nexus-defects-toolbar')
});
