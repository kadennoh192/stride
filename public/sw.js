/* The build finalizer injects the complete hashed local asset inventory. */
const VERSION = `stride-shell-${self.__STRIDE_BUILD__ || 'development'}`;
const PRECACHE = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', ...(self.__STRIDE_PRECACHE__ || [])];
self.addEventListener('install', event => {
  // Do not skipWaiting: the previous app keeps its matching assets until all tabs close.
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    try {
      await Promise.all([...new Set(PRECACHE)].map(async path => {
        const response = await fetch(new Request(new URL(path,self.location.origin),{cache:'reload',credentials:'same-origin'}));
        if (!response.ok || response.redirected || new URL(response.url).origin !== self.location.origin) throw new Error('Offline installation requires an authenticated, complete app response.');
        await cache.put(path,response);
      }));
    } catch (error) {await caches.delete(VERSION);throw error;}
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('stride-shell-') && key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || request.headers.has('RSC') || url.searchParams.has('_rsc')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // Keep the installed shell matched to its build until the safe update activates.
        if (response.status >= 500 && url.pathname !== '/watch') return await caches.match('/') || response;
        return response;
      } catch {
        if (url.pathname === '/watch') return new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Stride Watch Link</title><main style="font:16px system-ui;padding:24px;text-align:center"><h1>Internet needed</h1><p>Watch Link does not save changes offline. Reconnect, then reopen your link.</p></main>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
        return await caches.match('/') || new Response('Stride has not finished installing for offline use. Reconnect once to finish setup.', {status:503,headers:{'Content-Type':'text/plain'}});
      }
    })());
    return;
  }
  if (/\.(?:js|css|woff2?|png|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(cache.put(request, copy));
      }
      return response;
    })());
  }
});
self.addEventListener('push', event => {
  let data = {title:'Stride reminder',body:'Your next step is waiting.',url:'/#today',tag:'stride-reminder'};
  try {data = {...data,...event.data.json()};} catch {}
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icon-192.png',badge:'/icon-192.png',tag:data.tag,data:{url:data.url},renotify:true}));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/#today',self.location.origin);
  if(url.origin !== self.location.origin)return;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async list => {
    const client = list[0];
    if(client){await client.navigate(url.href);return client.focus();}
    return clients.openWindow(url.href);
  }));
});
