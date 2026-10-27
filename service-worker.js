// Sicherheitsbewusst: keine API-Antworten, Sitzungsdaten oder geschützten Seiten zwischenspeichern.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
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
