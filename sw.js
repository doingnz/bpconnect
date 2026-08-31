/**
 * BP+ Connect — Service Worker
 *
 * CACHE_VERSION is replaced on every push to main/hwfc by GitHub Actions.
 * Changing this constant causes the browser to detect the SW file has changed,
 * download the new SW, install it (caching all assets under the new name),
 * then wait.  The page shows an "Update available" banner; the user clicks
 * "Update now" which posts SKIP_WAITING → the SW activates → page reloads.
 */

// ── This line is updated automatically by GitHub Actions on each push: ────────
const CACHE_VERSION = '6e8e23a';
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
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
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

// ── Fetch: cache-first for all assets; network-first for version.json ─────────
self.addEventListener('fetch', (event) => {
  // Only handle same-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  if (event.request.url.includes('version.json')) {
    // Network-first: always try to get the latest version info so the page
    // can detect when a new release has been deployed.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else (fast, offline-capable)
  event.respondWith(
    caches.match(event.request)
      .then((cached) => cached || fetch(event.request))
  );
});

// ── Message: SKIP_WAITING sent by the page when user confirms update ──────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
