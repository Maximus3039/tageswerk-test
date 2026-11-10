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
 'css/app.css',
 'vendor/xlsx.full.min.js'
];

for (const name of fs.readdirSync(path.join(root, 'js'))) {
 if (name.endsWith('.js')) files.push(`js/${name}`);
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
console.log(`Veröffentlichung vorbereitet: ${files.length} Dateien in dist.`);
