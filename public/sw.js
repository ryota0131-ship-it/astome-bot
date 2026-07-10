// ASTOme Service Worker
// 方針:
// - /api/ 配下(calendar-data, feedなど個人データ)は絶対にキャッシュしない → 常に最新を取得
// - HTML・アイコン等の静的資産は stale-while-revalidate(まずキャッシュを返し、裏で更新)
// - オフライン時は最後に見た画面をそのまま表示できるようにする(未来を思い出す場所が、圏外で真っ白にならないように)

const CACHE_NAME = 'astome-v1';
const PRECACHE_URLS = [
  '/calendar.html',
  '/manifest.json',
  '/asto.png',
  '/ASTO_main_image.png',
  '/ASTO_face_image.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 他ドメイン(LINEなど)へのリクエストは素通し
  if (url.origin !== self.location.origin) return;

  // 個人データAPIは常にネットワークから取得。キャッシュしない。
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ error: 'offline' }),
        { headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // 静的資産: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            cache.put(req, networkRes.clone());
          }
          return networkRes;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});
