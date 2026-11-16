import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const files = [
 'index.html',
 'manifest.webmanifest',
 'service-worker.js',
 'icon-192.png',
 'icon-512.png',
 'vendor/xlsx.full.min.js'
];

const cssDir = path.join(root, 'css');
for (const name of fs.readdirSync(cssDir).sort()) {
 if (name.endsWith('.css')) files.push(`css/${name}`);
}

const jsDir = path.join(root, 'js');
for (const name of fs.readdirSync(jsDir).sort()) {
 if (name.endsWith('.js')) files.push(`js/${name}`);
}

const required = [
 'css/app.css',
 'css/theme-3.6.css',
 'css/tokens.css',
 'js/nexus-icons.js',
 'js/consumption-analytics.js',
 'js/weather.js',
 'js/water-filters.js',
 'js/permissions.js',
 'js/supabase.js'
];
for (const relative of required) {
 if (!files.includes(relative)) throw new Error(`Pflicht-Veröffentlichungsdatei fehlt in der Liste: ${relative}`);
}

fs.rmSync(dist, {recursive: true, force: true});
for (const relative of files) {
 const from = path.join(root, relative);
 if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
  throw new Error(`Veröffentlichungsdatei fehlt: ${relative}`);
 }
 const target = path.join(dist, relative);
 fs.mkdirSync(path.dirname(target), {recursive: true});
 fs.copyFileSync(from, target);
}

const blocked = [];
const walk = directory => {
 for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
  const full = path.join(directory, entry.name);
  if (entry.isDirectory()) {
   walk(full);
   continue;
  }
  const lower = entry.name.toLowerCase();
  if (lower.endsWith('.sql') || lower.startsWith('.env') || lower.endsWith('.mjs')) blocked.push(full);
 }
};
walk(dist);
if (blocked.length) throw new Error(`Unzulässige Dateien im Veröffentlichungsordner: ${blocked.join(', ')}`);

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const refs = new Set();
for (const match of html.matchAll(/(?:href|src)=["']\.\/([^"']+)["']/g)) refs.add(match[1]);
const theme = fs.readFileSync(path.join(dist, 'css/theme-3.6.css'), 'utf8');
for (const match of theme.matchAll(/@import url\(['"]\.\/([^'"]+)['"]\)/g)) refs.add(`css/${match[1]}`);
const missingRefs = [...refs].filter(relative => !fs.existsSync(path.join(dist, relative)));
if (missingRefs.length) {
 throw new Error(`Referenzierte Dateien fehlen im Veröffentlichungsordner: ${missingRefs.join(', ')}`);
}

const supabase = fs.readFileSync(path.join(dist, 'js/supabase.js'), 'utf8');
if (!supabase.includes('eqtrifscedpsngsysxvc.supabase.co')) {
 throw new Error('Veröffentlichungspaket ist nicht mit dem produktiven Supabase-Projekt verbunden.');
}
if (supabase.includes('gamvnzggcrrlnyoknllu')) {
 throw new Error('Veröffentlichungspaket enthält die Testprojekt-URL.');
}

console.log(`Veröffentlichung vorbereitet: ${files.length} Dateien in dist.`);
