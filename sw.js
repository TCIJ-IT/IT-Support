const CACHE_NAME = 'cte-it-support-v47-dup-assignee-nav-fix';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './unit-brand.jpg',
  './college-building.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_SHELL.map(item => cache.add(item).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Do not cache Firebase/API traffic; always let it go to the network.
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firebaseapp.com')
  ) {
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const fresh = fetch(req).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
  }
});

// Ready for Web Push / FCM payloads later.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data ? event.data.text() : 'لديك إشعار جديد' }; }

  const title = data.title || data.notification?.title || 'وحدة تقنية المعلومات';
  const body = data.body || data.notification?.body || 'يوجد تحديث جديد في نظام الدعم الفني.';
  const target = data.url || data.data?.url || data.fcmOptions?.link || data.webpush?.fcmOptions?.link || './index.html';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      tag: data.tag || data.data?.ticketNo || 'cte-it-notification',
      renotify: true,
      data: { url: target }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});


self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
});
