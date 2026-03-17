# BP+ Connect — Application Design

## Overview

BP+ Connect is a single-page web application that connects to a Uscom BP+ blood-pressure device, runs a measurement, and displays the results. It supports four connection transports (Simulator, Bluetooth LE, Web Serial via Capacitor/Android, Web Serial API) selected at runtime via `localStorage`.

The app is built with **Framework7** for the mobile UI shell and uses vanilla JavaScript throughout. There is no build step — all files are served as-is.

---

## Project Structure

```
bpconnect/
├── index.html                  Single-page app entry point (local dev copy)
├── manifest.json               PWA manifest (name, icons, display mode)
│
├── css/
│   ├── app.css                 Application-specific styles (measures font, layout tweaks)
│   └── fa-all.css              Font Awesome 5 icon library (solid/regular/brands)
│
├── js/                         Application JavaScript (load order is significant)
│   ├── utils.js                sleep(), debuglog() — writes to console + #debug div
│   ├── crc8.js                 CRC-8 calculator (lookup-table); used to validate XML payload
│   ├── emitter.js              Lightweight event emitter (pub/sub) used by all transports
│   ├── ble.js                  Generic BLE helper layer (wraps Web Bluetooth API)
│   ├── bpplus-ble.js           BP+ Bluetooth LE transport adapter (uses ble.js)
│   ├── bpplus-sim.js           BP+ simulator — replays a pre-recorded measurement sequence
│   ├── bpplus-serial.js        BP+ Serial transport (Capacitor plugin; Android/iOS native)
│   ├── bpplus-webserial.js     BP+ Web Serial API transport (Chrome desktop/Android)
│   ├── bpplus.js               Connection factory + BP+ protocol parser + results data model
│   └── app.js                  Framework7 app init, UI event handlers, upload logic
│
├── assets/
│   ├── uscom-logo.svg          Uscom company logo (toolbar tab icon)
│   ├── bpplus-logo.svg         BP+ product logo (navbar)
│   ├── button-connect.svg      Action button: disconnected state
│   ├── button-start.svg        Action button: connected, ready to measure
│   ├── button-stop.svg         Action button: measurement in progress
│   └── graph.png               Pulse-wave graph placeholder (Tab 3)
│
├── framework7/
│   ├── css/framework7.bundle.min.css   Framework7 UI library styles
│   └── js/framework7.bundle.min.js     Framework7 UI library JavaScript
│
├── webfonts/                   Font Awesome webfont files (woff2/woff/ttf)
│   ├── fa-brands-400.*
│   ├── fa-regular-400.*
│   └── fa-solid-900.*
│
├── apple-touch-icon*.png       iOS home-screen icons (120/152/167/180 px)
├── icon-128.png                Android icon
└── icon-192.png                Android icon (also used for PWA)
```

---

## Architecture

### Connection Abstraction

All four transports expose the same interface. `bpplus.js` selects one at startup based on `localStorage.bpconnection`:

| Class | File | Transport | Requires |
|---|---|---|---|
| `BpPlusSimulator` | `bpplus-sim.js` | Internal timer replay | Nothing (default) |
| `BpPlusBle` | `bpplus-ble.js` | Web Bluetooth API | Secure context + Chrome |
| `BpPlusSerial` | `bpplus-serial.js` | Capacitor serial plugin | Android/iOS native shell |
| `BpPlusWebSerial` | `bpplus-webserial.js` | Web Serial API | Secure context + Chrome |

Each transport emits three events via the shared `Emitter`:

| Event | Payload | Meaning |
|---|---|---|
| `receive` | `Uint8Array` | Raw bytes from device |
| `connect` | `boolean` | Connection state changed |
| `stop` | `boolean` | Measurement stopped |

### Data Flow

```
Device / Simulator
      │  raw bytes (Uint8Array)
      ▼
  receiveData()          [bpplus.js]
      │  accumulates bytes into `command` string
      ▼
  receiveProcess(line)   [bpplus.js]
      │
      ├─ 'P …'  → live pressure → #status-pressure
      ├─ 'M …'  → mode/state → status text / stop
      ├─ 'S …'  → summary result line → resultsData[] + UI
      └─ '|…'   → XML length+CRC header, then XML body
                    → DOMParser → resultsData[] + resultsInfo[] + UI
```

### Protocol Lines

| Prefix | Example | Meaning |
|---|---|---|
| `P` | `P 120` | Live cuff pressure in mmHg |
| `M 03` | | Mode: measuring blood pressure |
| `M 05` | | Mode: measuring |
| `M 06` | | Mode: measuring pulse wave |
| `M 07` | | Mode: calculating |
| `M 02` | | Stopped |
| `S` | `S ID SNR Sys Map Dia Pr cSys cMap cDia …` | Summary result (space-delimited) |
| `\|` | `\|_XML_Size <len> <crc8>_\|` | XML transfer header |
| `<BPplus>` … `</BPplus>` | XML | Full result XML (validated by CRC-8) |

### Results Data Model

`resultsData[]` in `bpplus.js` holds the table rows displayed in Tab 2. Each entry:

```js
{ id, measure, label, unit, result }
```

Key measures: `Sys`, `Dia`, `Map`, `Pr`, `cSys`, `cDia`, `cMap`, `SNR`, `sPR`, `sPRV`, `sAI`, `sDpDtMax`, `sPP`, `sPPV`, `sRWTTFoot`, `sRWTTPeak`, `sSEP`

`resultsInfo[]` holds metadata from the XML `<MeasDataLogger>` attributes: `datetime`, `guid`, `version`, `nibp`, `nibpversion`, `nibp_id`, `software_version`, `firmware_version`, `device_id`.

---

## UI — Tabs

| Tab | Icon | Content |
|---|---|---|
| Tab 1 | list-ol | Live brachial + central BP readings; status pressure during measurement; optional patient lookup/upload section |
| Tab 2 | table | Full results table (all 17 measures + metadata) |
| Tab 3 | chart-line | Pulse-wave graph image (static placeholder) |
| Tab 4 | uscom logo | Settings: connection type, baud rate; debug output div |

The action button (top-right) cycles through three states driven by `bpplus.status()`:

```
disconnected  →[tap]→  connecting → connected  →[tap]→  running  →[tap]→  connected
button-connect.svg            button-start.svg          button-stop.svg
```

---

## Settings — localStorage Keys

| Key | Values | Default |
|---|---|---|
| `bpconnection` | `simulator` \| `bluetooth` \| `serial` \| `webserial` | `simulator` |
| `bpconnrate` | `auto` \| `115200` \| `57600` \| `38400` \| `19200` | `auto` |

`auto` rate resolves to:
- `19200` on Bluefy browser
- `57600` on Windows
- `115200` otherwise

---

## Local Development

### Running a local server

The app must be served over HTTP (not opened as `file://`) for Web Serial and Web Bluetooth to work (they require a secure context).

```bash
# Python (built-in)
python -m http.server 8080
# then open http://localhost:8080

# Node.js
npx serve .
# then open http://localhost:3000
```

**Simulator mode** works without a server and without any hardware — it is the default when no `localStorage` key is set.

### Local dev additions (index.html)

The local copy adds:

- An orange **dev banner** at the top showing real-time Serial/Bluetooth API availability and whether the page context is secure.
- Inline script that **defaults `localStorage.bpconnection` to `"simulator"`** on first load.
- Replaced the inline `<script>` API-check snippets (which printed raw JS source in the original) with proper DOM-text updates.
- Title changed to `BP+ Connect [LOCAL DEV]` for easy browser-tab identification.

### Security note — Gevity upload credentials

`js/app.js` contains **hard-coded Basic Auth credentials** for the Gevity health API (`mmurdock@longevum.com` / `Longevum321!`). These are credentials for the beta/test environment. Do not commit changes that expose these in a public repo, and rotate them if the beta environment is accessible externally. The upload section is hidden by default (shown only with `?uploadGevity=1`).

---

## External Dependencies

| Library | Version | Purpose | Bundled |
|---|---|---|---|
| Framework7 | (bundled) | Mobile UI components, tabs, navbar, Dom7 (`$$`) | Yes |
| Font Awesome 5 | (bundled) | Icons | Yes |

No npm/build toolchain. No CDN dependencies — everything is self-contained for offline use.
