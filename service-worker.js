// Sicherheitsbewusst: keine API-Antworten, Sitzungsdaten oder fremde Seiten zwischenspeichern.
// Eine neue Version ersetzt den alten Cache und bittet geöffnete Fenster um eine Aktualisierung.
const SHELL_CACHE = 'tageswerk-shell-3.4';

self.addEventListener('install', event => {
 event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
 event.waitUntil((async () => {
  const keys = await caches.keys();
  const stale = keys.filter(key => key !== SHELL_CACHE);
  await Promise.all(stale.map(key => caches.delete(key)));
  await self.clients.claim();
  if (!stale.length) return;
  const windows = await self.clients.matchAll({type: 'window'});
  for (const client of windows) client.postMessage({type: 'tageswerk-updated', cache: SHELL_CACHE});
 })());
});

self.addEventListener('fetch', event => {
 const request = event.request;
 if (request.method !== 'GET') return;
 const url = new URL(request.url);
 if (url.origin !== self.location.origin) return;
 event.respondWith((async () => {
  try {
   const fresh = await fetch(request);
   if (fresh.ok) {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, fresh.clone());
   }
   return fresh;
  } catch (error) {
   const cached = await caches.match(request) || (request.mode === 'navigate' ? await caches.match('./index.html') : null);
   if (cached) return cached;
   throw error;
  }
 })());
});
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload; try { payload=event.data.json(); } catch { return; }
  // Nur fest definierte Texte, keine vertraulichen Mangelinhalte auf Sperrbildschirm.
  const title='Tageswerk';
  const body=payload.type==='critical'?'Ein kritischer Vorgang benötigt deine Aufmerksamkeit.':'Du hast eine neue Benachrichtigung.';
  event.waitUntil(self.registration.showNotification(title,{body,icon:'./icon-192.png',badge:'./icon-192.png',tag:'tageswerk-'+(payload.id||'notice'),data:{url:self.registration.scope}}));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for (const client of clients) if(client.url.startsWith(self.registration.scope)){await client.focus();return;}
    return self.clients.openWindow(self.registration.scope);
  }));
});
