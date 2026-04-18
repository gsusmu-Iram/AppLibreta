const CACHE_NAME = 'pycseca-v7';

const CACHE_STATIC = [
  './app.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
];

// ── Almacén de alarmas en el SW ──────────────────────────────
// { id → { ts, titulo, body, repetir, tipo, timerId } }
const _alarmas = {};

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(CACHE_STATIC.map(url =>
        cache.add(url).catch(e => console.log('Cache skip:', url, e))
      ))
    ).then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first para estáticos, network-first para HTML ──
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.pathname.endsWith('app.html') || url.pathname === '/' || url.pathname.endsWith('/')){
    event.respondWith(
      fetch(event.request)
        .then(res => { caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone())); return res; })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;
      return fetch(event.request).then(res => {
        if(res && res.status === 200 && res.type !== 'opaque')
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        return res;
      }).catch(() => cached);
    })
  );
});

// ── Mensajes desde la app ─────────────────────────────────────
self.addEventListener('message', event => {
  const { type } = event.data || {};

  if(type === 'SCHEDULE_ALARM'){
    _programarAlarma(event.data);
  }
  else if(type === 'CANCEL_ALARM'){
    _cancelarAlarma(event.data.id);
  }
  else if(type === 'RESTORE_ALARMS'){
    (event.data.alarmas || []).forEach(a => _programarAlarma(a));
  }
});

// ── Programar una alarma ──────────────────────────────────────
function _programarAlarma({ id, ts, titulo, body, repetir, tipo }) {
  _cancelarAlarma(id);

  const diff = ts - Date.now();
  if(diff <= 0) return;

  const timerId = setTimeout(() => {
    _disparar(id, titulo, body, tipo);

    const minutos = parseInt(repetir) || 0;
    if(minutos > 0){
      let count = 0;
      const maxRep = 3;
      const repId = setInterval(() => {
        count++;
        _disparar(id + '_rep' + count, titulo, body, tipo);
        if(count >= maxRep) clearInterval(repId);
      }, minutos * 60000);
    }
  }, diff);

  _alarmas[id] = { ts, titulo, body, repetir, tipo, timerId };
}

// ── Cancelar alarma ───────────────────────────────────────────
function _cancelarAlarma(id) {
  if(_alarmas[id]){
    clearTimeout(_alarmas[id].timerId);
    delete _alarmas[id];
  }
}

// ── Disparar notificación ─────────────────────────────────────
function _disparar(id, titulo, body, tipo) {
  const vibrar = tipo === 'vibra' || tipo === 'sonido';
  const silencio = tipo === 'notif';
  self.registration.showNotification('⏰ ' + titulo, {
    body: body || 'PycLibreta',
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: vibrar ? [400, 150, 400, 150, 400] : [],
    silent: silencio,
    tag: 'pycseca-alarm-' + id,
    requireInteraction: true,
    actions: [
      { action: 'abrir',    title: '📋 Ver' },
      { action: 'descartar', title: '✕ Descartar' }
    ]
  });
}

// ── Click en notificación ─────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if(event.action === 'descartar') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if(list.length > 0) return list[0].focus();
      return clients.openWindow('./app.html');
    })
  );
});

// ── Push externo (uso futuro) ─────────────────────────────────
self.addEventListener('push', event => {
  if(!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || '⏰ PycLibreta', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [400, 150, 400, 150, 400],
      tag: data.tag || 'pycseca-push',
      requireInteraction: true,
    })
  );
});
