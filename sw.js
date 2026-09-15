/**
 * BP+ Connect — Service Worker
 *
 * Network first, cache when offline. Every request goes to the server, which
 * answers 304 when a file has not changed, and what comes back is kept. The
 * cache is used when the network fails, or is slow and a copy exists. A deploy
 * therefore shows on the next ordinary reload, whatever sw.js says.
 *
 * CACHE_VERSION is replaced on every push to main by GitHub Actions. A changed
 * sw.js installs a new worker, which caches all assets under the new name and
 * waits. The page shows an "Update available" banner; "Update now" posts
 * SKIP_WAITING → the worker activates → the page reloads. It waits for the user
 * because a reload drops the connection to the device.
 */

// ── This line is updated automatically by GitHub Actions on each push: ────────
const CACHE_VERSION = 'f6c1a95';
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME = 'bpconnect-' + CACHE_VERSION;

const PRECACHE = [
  './',
  './index.html',
  './version.json',
  './manifest.json',
  './css/app.css',
  './css/fa-all.css',
  './framework7/css/framework7.bundle.min.css',
  './framework7/js/framework7.bundle.min.js',
  './js/vendor/chart.umd.min.js',

  // The SDK. A vendored copy of Uscom/bpplus-js-sdk -- see sdk/SDK-VERSION.json.
  './sdk/index.js',
  './sdk/constants.js',
  './sdk/core/emitter.js',
  './sdk/core/errors.js',
  './sdk/core/advice.js',
  './sdk/core/crc8.js',
  './sdk/core/crc32-netmf.js',
  './sdk/core/byte-stream.js',
  './sdk/core/responses.js',
  './sdk/core/commands.js',
  './sdk/core/session.js',
  './sdk/transports/transport.js',
  './sdk/transports/simulator.js',
  './sdk/transports/simulator-data.js',
  './sdk/transports/web-serial.js',
  './sdk/transports/usb-serial.js',
  './sdk/transports/usb-serial-drivers.js',
  './sdk/transports/detect.js',
  './sdk/transports/web-bluetooth.js',
  './sdk/device/bpplus-device.js',
  './sdk/device/measurement.js',
  './sdk/device/features.js',
  './sdk/device/firmware-update.js',

  // The reference application.
  './app/app.js',
  './app/settings.js',
  './app/ui-log.js',
  './app/measure-setup.js',
  './app/tab-measure.js',
  './app/tab-results.js',
  './app/tab-waveform.js',
  './app/tab-settings.js',
  './app/tab-firmware.js',
  './app/tab-reservoir.js',

  // The reservoir analysis. UI-free; see analysis/NOTICE.md.
  './analysis/index.js',
  './analysis/matlab.js',
  './analysis/ai-v2.js',
  './analysis/kreservoir.js',
  './analysis/reservoir.js',
  './analysis/columns.js',
  './analysis/input.js',

  './assets/uscom-logo.svg',
  './assets/bpplus-logo.svg',
  './assets/button-connect.svg',
  './assets/button-start.svg',
  './assets/button-stop.svg',
  './webfonts/fa-solid-900.woff2',
  './webfonts/fa-regular-400.woff2',
  './webfonts/fa-brands-400.woff2',
  './icon-192.png',
  './icon-128.png',
  './apple-touch-icon.png',
];

// ── Install: cache all assets ─────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    // Past the HTTP cache: the server sends no Cache-Control, so the browser
    // could otherwise hand back a stale copy to cache.
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
    // Do NOT call skipWaiting() here — we wait for the user to confirm the
    // update via the page banner before activating the new SW.
  );
});

// ── Activate: delete caches from old versions ─────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('bpconnect-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network first, the cache when offline ──────────────────────────────
// Cache-first served the files cached when this worker was installed until
// sw.js changed, and a deploy that leaves CACHE_VERSION alone never changes it:
// every ordinary reload after a Ctrl+F5 went back to the old files.

// How long to wait for the server before a cached copy will do.
const NETWORK_TIMEOUT_MS = 4000;

// After the network fails or is too slow, answer from the cache for this long,
// so an app starting offline does not wait on every file in turn.
const OFFLINE_BACKOFF_MS = 10000;
let offlineUntil = 0;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  // One entry per file: version.json is asked for with a cache-busting query.
  const key = new URL(request.url);
  key.search = '';
  const cached = () => cache.match(key.href);

  if (Date.now() < offlineUntil) {
    const copy = await cached();
    if (copy) return copy;
  }

  // Revalidate past the HTTP cache. A navigation cannot be copied with options,
  // so it is rebuilt from its URL.
  const revalidate = request.mode === 'navigate'
    ? new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(request, { cache: 'no-cache' });

  let answered = false;
  const network = fetch(revalidate).then((response) => {
    answered = true;
    offlineUntil = 0;
    if (response.status === 200) cache.put(key.href, response.clone());
    return response;
  }, (error) => {
    answered = true;
    offlineUntil = Date.now() + OFFLINE_BACKOFF_MS;
    throw error;
  });

  // A slow network gets the cached copy if there is one; with none, keep waiting.
  const slow = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS))
    .then(async () => {
      if (answered) return network;
      const copy = await cached();
      if (!copy) return network;
      offlineUntil = Date.now() + OFFLINE_BACKOFF_MS;
      return copy;
    });

  try {
    return await Promise.race([network, slow]);
  } catch {
    return (await cached()) || Response.error();
  }
}

// ── Message: SKIP_WAITING sent by the page when user confirms update ──────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
