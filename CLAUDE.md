# CLAUDE.md — BP+ Connect

## Project documentation

Full application design, file structure, data flow, and protocol reference:
→ **[ApplicationDesign.md](ApplicationDesign.md)**

---

## Quick orientation

- **Single-page app** — no build step, no npm. Edit files and refresh the browser.
- **Entry point** — `index.html` (local dev copy with orange banner + simulator default)
- **Start here for logic** — `js/bpplus.js` (protocol parser, connection factory, results model)
- **Start here for UI** — `js/app.js` (Framework7 init, button handlers, table rendering)

---

## Running locally

```bash
# Simulator mode works with file:// (no server needed)
# Serial / Bluetooth require localhost or https:
python -m http.server 8080
```
Open `http://localhost:8080` — the app defaults to **Simulator** mode on first load.

---

## Key conventions

- Connection type and baud rate are persisted in `localStorage` (`bpconnection`, `bpconnrate`).
- All four transports (`BpPlusSimulator`, `BpPlusBle`, `BpPlusSerial`, `BpPlusWebSerial`) share the same event interface (`receive`, `connect`, `stop`).
- Debug output goes to the browser console **and** the `#debug` div visible in Tab 4 (Settings).
- Script load order in `index.html` is significant — `emitter.js` must precede transport files; `bpplus.js` must precede `app.js`.

---

## Files not to modify

| File / Folder | Reason |
|---|---|
| `framework7/` | Third-party library — update as a whole if needed |
| `webfonts/` | Font Awesome font files — regenerate from CSS if updated |
| `css/fa-all.css` | Font Awesome CSS — regenerate or replace as a unit |

---

## Known issues / notes

- `js/app.js` contains hard-coded Gevity API credentials (Basic Auth). See security note in `ApplicationDesign.md`.
- The graph in Tab 3 (`assets/graph.png`) is a static placeholder — live waveform rendering is not yet implemented.
- `js/bpplus-serial.js` targets the Capacitor serial plugin and will not work in a plain browser.
