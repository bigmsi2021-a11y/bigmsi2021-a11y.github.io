const CACHE_PREFIX = 'blitz-';
const CACHE_NAME = 'blitz-static-v2';
const MAX_CACHE_ENTRIES = 64;
const PUBLIC_ASSETS = new Set(['/favicon.svg', '/manifest.json', '/icon-192.png', '/icon-512.png']);
const ASSET_DESTINATIONS = new Set(['script', 'style', 'image', 'font']);
let cacheWrites = Promise.resolve();

function isStaticAssetRequest(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search) return false;
  if (request.mode === 'navigate' || request.cache === 'no-store') return false;
  if (request.headers.has('authorization') || request.headers.has('range')) return false;
  if (PUBLIC_ASSETS.has(url.pathname)) return true;
  return ASSET_DESTINATIONS.has(request.destination)
    && /^\/assets\/[^/]+\.(?:js|css|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf)$/.test(url.pathname);
}

async function readStaticCache(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(request);
  } catch (error) {
    console.warn('Blitz: static cache read failed.', error);
    return undefined;
  }
}

function storeStaticResponse(request, response) {
  cacheWrites = cacheWrites.then(async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response);
      const keys = await cache.keys();
      const excess = keys.length - MAX_CACHE_ENTRIES;
      if (excess > 0) await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
    } catch (error) {
      console.warn('Blitz: static cache write failed.', error);
    }
  });
  return cacheWrites;
}

async function serveStaticAsset(request) {
  const cached = await readStaticCache(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.status === 200 && response.type === 'basic' && !response.redirected) {
      await storeStaticResponse(request, response.clone());
    }
    return response;
  } catch (error) {
    console.warn('Blitz: static asset request failed.', error);
    throw error;
  }
}

async function activateStaticCache() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  } catch (error) {
    console.warn('Blitz: static cache activation failed.', error);
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(activateStaticCache());
});

self.addEventListener('fetch', (event) => {
  // Account and voting requests always reach the network; only public assets enter this cache.
  if (isStaticAssetRequest(event.request)) event.respondWith(serveStaticAsset(event.request));
});
