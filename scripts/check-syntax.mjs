import {readdir, stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipped = new Set(['node_modules', 'vendor', 'test-results', 'playwright-report', 'Testdaten']);

async function javascriptFiles(directory, found = []) {
 for (const name of await readdir(directory)) {
  if (skipped.has(name)) continue;
  const full = path.join(directory, name);
  const info = await stat(full);
  if (info.isDirectory()) await javascriptFiles(full, found);
  else if (name.endsWith('.js') || name.endsWith('.mjs')) found.push(full);
 }
 return found;
}

const files = await javascriptFiles(root);
const failed = [];
for (const file of files) {
 const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
 if (result.status !== 0) failed.push({file, output: result.stderr || result.stdout});
}
if (failed.length) {
 for (const item of failed) {
  console.error(path.relative(root, item.file));
  console.error(item.output.trim());
 }
 process.exit(1);
}
console.log('Syntax geprüft: ' + files.length + ' Dateien');
