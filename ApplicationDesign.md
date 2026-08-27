# BP+ Connect — Application Design

## Overview

BP+ Connect connects a browser to a Uscom BP+ blood-pressure monitor over the
Terminal API (version 2.4, BP+ application firmware 5.3.0.0 series), runs a
measurement, and displays the result.

It is two things in one repository:

| | |
|---|---|
| **`sdk/`** | A UI-free JavaScript SDK for the BP+ Terminal API. This is what a customer integrates. |
| **`app/`** | A reference single-page application built on it — Framework7, five tabs, one worked example per SDK feature. |

The boundary is enforced by one rule: **nothing under `sdk/` touches the DOM, a
UI framework or `localStorage`.** If `app/` could not be deleted while leaving a
working library behind, the split has failed.

ES modules throughout. No build step, no npm dependency at runtime.

---

## Project structure

```
bpconnect/
├── index.html                     The page. Loads app/app.js as a module.
├── manifest.json                  PWA manifest
├── sw.js                          Service worker — precache list must track new files
│
├── sdk/                           ── The SDK. UI-free. ──────────────────────
│   ├── index.js                   Public surface — everything a customer imports
│   ├── constants.js               DeviceMode, ResultCode, MeasureMode, BodyPosition
│   ├── selftest.js                Runs the whole stack against the simulator
│   │
│   ├── core/
│   │   ├── emitter.js             Small event emitter
│   │   ├── errors.js              BpPlusError — one error type, Table 5 codes
│   │   ├── crc8.js                Framing CRC-8 (init 0xFF, decimal on the wire)
│   │   ├── crc32-netmf.js         netMF Utility.ComputeCRC — the firmware updateID
│   │   ├── byte-stream.js         Receive buffer: lines, or exactly N bytes
│   │   ├── responses.js           One line → a typed response
│   │   ├── commands.js            Command builders, with the validation the device won't do
│   │   └── session.js             Request/response, timeouts, notification routing
│   │
│   ├── transports/
│   │   ├── transport.js           The contract. Extend this to add your own.
│   │   ├── simulator.js           A scripted BP+ — no hardware
│   │   ├── simulator-data.js      A recorded measurement, verbatim
│   │   ├── web-serial.js          navigator.serial
│   │   ├── web-usb-pl2303.js      navigator.usb — a PL2303 adapter, used on Android
│   │   └── web-bluetooth.js       navigator.bluetooth — five bridge profiles
│   │
│   └── device/
│       ├── bpplus-device.js       The object an integrator uses
│       ├── measurement.js         Result XML → typed values (single and AOBP)
│       ├── features.js            The f command: read, repair, write
│       └── firmware-update.js     The w/k/v state machine
│
├── app/                           ── The reference UI. An SDK consumer. ─────
│   ├── app.js                     Framework7 init, transport choice, action button
│   ├── settings.js                The only file that touches localStorage
│   ├── ui-log.js                  Debug and trace pane, fed by device.on('log')
│   ├── tab-measure.js             Tab 1 — live readings
│   ├── measure-setup.js           Tab 1 — mode, patient ID, AOBP protocol
│   ├── tab-results.js             Tab 2 — results table and per-reading list
│   ├── tab-waveform.js            Tab 3 — Chart.js pulse waves
│   ├── tab-settings.js            Tab 4 — connection, tracing, provisioning
│   └── tab-firmware.js            Tab 5 — firmware update (hidden by default)
│
├── css/            app.css, fa-all.css
├── js/vendor/      chart.umd.min.js (UMD, loaded as a classic script)
├── framework7/     UI library
└── webfonts/       Font Awesome
```

---

## Architecture

### Layers

```
   app/                    Framework7, DOM, localStorage
     │  device.on(...)  ·  await device.measure(...)
     ▼
   BpPlusDevice            connect, readFeatures, measure, cancel, recall, reboot
     │
     ▼
   Session                 one command outstanding · timeouts · notification routing
     │                     · length-delimited XML blocks
     ▼
   Transport               bytes in, bytes out
     │
     ▼
   Web Serial · WebUSB · Web Bluetooth · Simulator
```

### The session

This is the layer that did not exist before, and it is where most of the
protocol's difficulty lives. Section 2.1 of the specification says only one
command may be outstanding at a time, and that notifications can arrive at any
moment interleaved with command responses. So the inbound stream is split:

- **Notifications** (`M nn`, `P nnn`, `E "…"`, empty lines) are emitted as
  events whether or not a request is pending.
- **Replies** resolve the single request in flight, matched by a per-command
  predicate rather than by "the next line". `d` waits for `D n`, `f` for a line
  beginning `<Feature`, `s` for an XML block or an `S` line or `F nn`.
- **Requests queue.** A caller never has to know whether the wire is busy.

Two behaviours exist because of the wire rather than the caller:

- **Stray-failure tolerance, armed explicitly.** A cancel during a firmware
  update can produce one more `F 50` than the host asked for: a `k` already on
  the wire is still processed, its `K` comes back with nobody waiting, and the
  device answers the orphan with an `F 50` of its own. A cancel from the
  device's own buttons does the same and cannot be timed. The firmware-update
  job arms `expectStrayFailure()` around its cancel; nothing else does.
  **There is deliberately no general duplicate-failure guard** — a measurement
  reports its `F nn` exactly once, and a blanket guard would hide a second
  genuine failure while pretending to be protocol knowledge.
- **Byte-count framing for the XML block.** Section 2.6 frames the measurement
  XML by length, and the firmware suppresses only `M nn` while sending it —
  `F nn` and `P nnn` are not suppressed. Reading by count means anything that
  arrives afterwards is a line again, not payload.

### Transports

All four extend `sdk/transports/transport.js` and implement four things:

```js
async _open()          // make the connection; throw on failure
async _close()         // tear it down
async _write(bytes)    // resolve when the bytes are away
this._receive(bytes)   // call as bytes arrive
```

| Class | API | Notes |
|---|---|---|
| `SimulatorTransport` | none | Scripted device. Default on first visit. |
| `WebSerialTransport` | `navigator.serial` | Desktop Chrome/Edge/Opera. 8N1, RTS/CTS, 115200. |
| `WebUsbPl2303Transport` | `navigator.usb` | Android, where Web Serial does not exist. PL2303HX and GT. |
| `WebBluetoothTransport` | `navigator.bluetooth` | Five bridge profiles, probed in order. Writes are serialised and paced. |

`write` resolves only when the bytes have left, as far as the underlying API
allows. The firmware-update path sends about a thousand packets back to back,
and a write that resolves early becomes a buffer overrun a long way from its
cause.

---

## Protocol reference

### Lines the device sends

| Form | Meaning |
|---|---|
| `M nn` | Device mode (Table 4). Sent on **every** change and as the reply to `m` — so a host learns that an operator has walked the device into a menu without asking. |
| `P nnn` | Cuff pressure, mmHg. May arrive at any time, from any cause. |
| `F nn` | Result code (Table 5). `F 22` and `F 99` are not failures. |
| `S …` | Measurement summary at detail level 0 |
| `D n` | Echo of the `d` command — consume before the next command |
| `verN.M` | Reply to `?`. **No type letter.** |
| `<Feature …>` | Reply to `f`. **No type letter, and it starts with `<`.** |
| `IDs_H` / `IDs_Content` | Reply to `i`. **No type letter.** Two lines, paired by the session. |
| <code>\|_XML_Size&lt;n&gt; &lt;crc&gt;_\|</code> | Header; then exactly `n` bytes, then CRLF |
| `E "…"` | Deprecated diagnostic. Log only; the `F` that follows is the answer. |
| `W` / `K n` | Firmware-update acknowledgements (**not** `F 99` — see below) |
| *(empty)* | Two precede `M 00` after any reboot. Not an error. |

### Irregularities a host must handle

Table 1 of the specification lists these; each one is handled in the file named.

| Behaviour | Handled in |
|---|---|
| Three replies carry no type letter and must be recognised by prefix first | `core/responses.js` |
| The feature list begins with `<` and must not be read as measurement XML | `core/responses.js` |
| `d` is echoed as `D` and must be consumed | `device/bpplus-device.js` |
| A cancel during a firmware update can produce one extra `F 50` | `device/firmware-update.js` |
| The XML block is length-delimited, and is UTF-8 | `core/byte-stream.js`, `core/session.js` |
| CRC values on the wire are decimal, not hex | `core/crc8.js` |
| Feature XML below version 3.0 has a malformed `<nibp_id>` closing tag | `device/features.js` |
| The `version` attribute is not a capability marker — feature-detect | `device/features.js` |
| The patient ID is stored verbatim: no comma, no `<`, `&` or `>` | `core/commands.js` |
| The time reply comes as bare digits or as `T <digits>` | `core/responses.js` |
| Unknown mode codes are informational, never an error | `constants.js` |

### Result codes

Every failure rejects with a `BpPlusError`:

```js
try {
  const result = await device.measure({ patientId: 'ABC-1' });
} catch (error) {
  error.code;      // 13
  error.codeName;  // 'measurementBPOutOfRange'
  error.message;   // 'Blood pressure was outside the measurable range.'
}
```

Codes 18–21 are the range Table 5 reserves for host libraries and are produced
by this SDK, never by the device — so a caller switches on `code` alone and
never has to distinguish "the device said no" from "we could not ask".

### Measurement modes

The `f` command reports `<measureMode>` as an integer.

| Value | Label | Result XML |
|---|---|---|
| 0 | BP+ | version 6.0 |
| 1 | Only BP | experimental |
| 2 | — | refused by the firmware with `F 14` |
| 3 | InfraDia & BP+ | version 6.0 |
| 4 | BP+ [3] | version 7.0, `<NibpBloodPressures>` |
| 5 | BP+ AOBP | version 7.0, plus `protocolType` and `bodyPosition` |

In modes 4 and 5 the headline numbers are a **mean**, and the document carries
one `<NibpBloodPressure>` per reading, each with its own `<Sys>`, `<Dia>`,
`<Map>` and `<Pr>`. A document-wide `getElementsByTagName('Sys')[0]` returns the
mean only because the mean happens to be serialised first. `measurement.js`
therefore scopes every lookup:

- brachial values — direct children of `<MeasDataLogger>`
- analysis values — children of `<Results><Result>`
- per reading — children of each `<NibpBloodPressure>`, via `measurement.readings`

### Firmware update

Not implemented yet (phase 2). The two things most likely to be got wrong:

- **The acknowledgements are `W` and `K <index>`, not `F 99`.** Section 2.7 and
  Table 5 of `@d1` say `F 99`; the firmware does not do this. `F 99` is
  `FinishMeasurementCode.Success` and never appears on that path.
- **`updateID` is the netMF `Utility.ComputeCRC`**: CRC-32, polynomial
  `0x04C11DB7`, MSB first, seed 0, **not reflected, no final inversion**. Not
  the reflected CRC-32 of zip and Ethernet. It chains, so a value over the whole
  file equals the accumulation over its packets. `sdk/core/crc32-netmf.js`
  implements it with a self-check.

---

## UI — tabs

| Tab | Content |
|---|---|
| 1 | Live brachial and central readings; cuff pressure during a measurement; status and any failure message |
| 2 | Full results table, the individual readings for AOBP and BP+ [3], and the measurement metadata |
| 3 | Five Chart.js pulse-wave charts |
| 4 | Connection, flow control, tracing; what the browser supports; writing a setting to the device; the debug and trace pane |
| 5 | Firmware update. Hidden unless switched on in Settings — a service action, not something a clinical user should meet on the way to a measurement |

The action button cycles on `device.state`:

```
disconnected  →[tap]→  connected  →[tap]→  measuring  →[tap]→  connected
button-connect         button-start        button-stop
```

---

## Settings — localStorage keys

Owned entirely by `app/settings.js`.

| Key | Values | Default |
|---|---|---|
| `bpconnection` | `simulator` · `bluetooth` · `serial` · `webserial` | `simulator` |
| `bpflowcontrol` | `hardware` · `none` | `hardware` |
| `bptrace` | `on` · `off` | `off` |
| `bpconnrate` | a baud rate | `115200` |

`bluetooth-nus` is a legacy value and maps onto `bluetooth`; one transport now
handles every bridge profile.

---

## Local development

**A local server is required.** ES modules do not load over `file://`, and Web
Serial, WebUSB and Web Bluetooth all need a secure context.

```bash
python -m http.server 8080     # → http://localhost:8080
npx serve .                    # → http://localhost:3000
```

Simulator mode needs no hardware and is the default on a first visit.

### Testing without a device

```bash
npm install --no-save jsdom
node sdk/selftest.js
```

The known answers are values the device itself produces, not values this
implementation happened to compute — so a change that breaks wire compatibility
fails here rather than on the bench.

### Service worker

`sw.js` precaches every file. **Anything added under `sdk/` or `app/` must be
added to `PRECACHE`**, or the PWA serves a half-updated application offline.
`CACHE_VERSION` is rewritten by GitHub Actions on push; bump it by hand when
testing locally, or unregister the worker.

---

## External dependencies

| Library | Purpose | Bundled |
|---|---|---|
| Framework7 | Mobile UI shell, tabs, navbar | Yes |
| Chart.js | Waveform charts (UMD, a global) | Yes |
| Font Awesome 5 | Icons | Yes |

No npm or build toolchain at runtime. Everything is self-contained for offline
use. `jsdom` is a development-only dependency of the self-test, installed on
demand and not committed.

The SDK itself has **no dependencies at all** — it uses `TextEncoder`,
`TextDecoder` and `DOMParser`, all of which are built into the browser.
