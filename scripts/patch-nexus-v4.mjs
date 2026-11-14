import {readFileSync, writeFileSync} from 'node:fs';

let html = readFileSync('index.html', 'utf8');

html = html.replace(
 '<body class="nexus">',
 '<body class="nexus nexus-v4">'
);

html = html.replace(
 '<meta name="theme-color" content="#050910">',
 '<meta name="theme-color" content="#03070f">'
);

if (!html.includes('facility-spotlight')) {
 html = html.replace(
  '<div class="card dash-command nexus-panel">',
  `<div class="card dash-command nexus-panel"><div class="nexus-brand-row"><span class="nexus-brand-mark" aria-hidden="true">◈</span><div><strong class="nexus-brand-name">Tageswerk</strong><span class="nexus-brand-tag">Nexus</span></div></div>`
 );
 html = html.replace(
  '<div class="dash-command-meta">',
  `<div id="facility-spotlight" class="facility-spotlight"><div id="facility-spotlight-media" class="facility-spotlight-media hidden" role="img" aria-label="Betriebsbild"></div><div class="facility-spotlight-body"><p class="facility-spotlight-label">Aktueller Betrieb</p><p id="facility-spotlight-name" class="facility-spotlight-name">—</p><div id="facility-spotlight-status" class="facility-spotlight-status"></div></div></div><div class="dash-command-meta facility-select-wrap">`
 );
}

if (!html.includes('neon-tile')) {
 html = html.replace(
  'class="module-card active" data-operation="reports"',
  'class="module-card neon-tile accent-cyan active" data-operation="reports"'
 );
 html = html.replaceAll(
  'class="module-card" data-operation="',
  'class="module-card neon-tile accent-cyan" data-operation="'
 );
 html = html.replace(
  'data-operation="maintenance"',
  'data-operation="maintenance"'
 );
 // accents refined after icons decorate
}

writeFileSync('index.html', html);
console.log({
 v4: html.includes('nexus-v4'),
 spotlight: html.includes('facility-spotlight'),
 brand: html.includes('nexus-brand-row')
});
