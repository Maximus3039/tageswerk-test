import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const types = {
 '.html': 'text/html; charset=utf-8',
 '.js': 'text/javascript; charset=utf-8',
 '.mjs': 'text/javascript; charset=utf-8',
 '.css': 'text/css; charset=utf-8',
 '.json': 'application/json; charset=utf-8',
 '.webmanifest': 'application/manifest+json',
 '.png': 'image/png',
 '.svg': 'image/svg+xml'
};

const server = http.createServer((request, response) => {
 if (request.method !== 'GET' && request.method !== 'HEAD') {
  response.writeHead(405);
  response.end();
  return;
 }
 const url = new URL(request.url || '/', 'http://127.0.0.1');
 const requested = decodeURIComponent(url.pathname);
 const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
 const file = path.normalize(path.join(root, relative));
 if (file !== root && !file.startsWith(root + path.sep)) {
  response.writeHead(403);
  response.end();
  return;
 }
 fs.readFile(file, (error, data) => {
  if (error) {
   response.writeHead(404);
   response.end();
   return;
  }
  response.writeHead(200, {
   'content-type': types[path.extname(file)] || 'application/octet-stream',
   'cache-control': 'no-store'
  });
  response.end(request.method === 'HEAD' ? undefined : data);
 });
});

server.listen(port, '127.0.0.1', () => {
 console.log('Testserver auf http://127.0.0.1:' + port);
});
