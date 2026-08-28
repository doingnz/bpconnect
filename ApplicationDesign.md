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
│   │   ├── usb-serial.js          navigator.usb — the adapter, the only cable path on Android
│   │   ├── usb-serial-drivers.js  chip setup; Prolific PL2303 today, the seam for others
│   │   ├── detect.js              what this browser can do, and what to use
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
│   ├── tab-waveform.js            Tab 3 — Chart.js pulse waves and raw pressure
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
| `UsbSerialTransport` | `navigator.usb` | The USB-to-serial adapter, opened directly. The only cable path on Android. Chip-specific — see below. |
| `WebBluetoothTransport` | `navigator.bluetooth` | Five bridge profiles, probed in order. Writes are serialised and paced. |

`WebUsbPl2303Transport` is the former name of `UsbSerialTransport` and is still
exported as a subclass fixed to the Prolific driver, so existing integrations
keep working.

#### The USB-to-serial adapter is chip-specific

`UsbSerialTransport` is not a generic serial port. Once the bulk endpoints are
found, moving bytes is the same for every adapter, but *opening* one is not:
each vendor invented its own control-transfer protocol for the baud rate and the
modem lines, and none can be driven by guessing. Prolific happens to accept the
CDC line-coding requests after its vendor handshake; FTDI implements no CDC at
all and encodes the baud rate as a divisor in a vendor request; CP210x and CH340
differ again.

So the transport owns everything generic and a **driver** in
`sdk/transports/usb-serial-drivers.js` owns the silicon. Only Prolific PL2303 is
present, because it is the adapter shipped with a BP+ and the only one tested
against one. Its `filters` also decide what `requestDevice()` offers, so an
adapter with no driver cannot be chosen even if the rest would have worked —
which is the intended behaviour, not a limitation to work around.

Adding another chip is a driver object and a registry entry; the shape and the
`io` handle it is given are documented at the top of that file. The PL2303
handshake is pinned by a self-test that drives it against a fake `USBDevice` and
compares the exact control-transfer sequence, so a change that would break a
real adapter fails on the bench.

#### Choosing a transport

`sdk/transports/detect.js` answers "what can this browser actually do", which
matters because the gaps are platform-shaped rather than version-shaped:

| | Web Serial | WebUSB | Web Bluetooth |
|---|---|---|---|
| Desktop Chrome / Edge | yes | yes | yes |
| **Android Chrome** | **no** | yes | yes |
| Safari, Firefox | no | no | no |

`recommendedTransport()` prefers the cable — Web Serial, then the USB adapter,
then Bluetooth, which needs a separate bridge most sites do not have. The case
it exists for is a Chrome tablet: on Android there is no Web Serial at all, so
the same physical cable has to be reached through WebUSB instead. Choosing that
by hand is a step an operator should not have to know about, and getting it
wrong looks like a broken cable.

Detection is by **feature first, platform second**. `navigator.serial` being
absent is the fact that decides it; Android is used only to explain why and to
order the choices. An Android build that shipped Web Serial would then simply
use it, with no change here.

`write` resolves only when the bytes have left, as far as the underlying API
allows. The firmware-update path sends about a thousand packets back to back,
and a write that resolves early becomes a buffer overrun a long way from its
cause.

#### Planned: a direct USB transport

A future BP+ is to expose USB directly rather than through a serial bridge —
faster, and with device arrival and removal the host can see. The firmware and
its USB API are some way off, but the shape of the drop-in can be settled now,
and one decision in that API determines how big the change is.

**If the direct USB link carries the same ASCII line protocol, the drop-in is
one new file.** Nothing above the transport knows how bytes arrive: `Session`
reassembles lines from arbitrary chunks, `classify()` reads them, and the device
object is untouched. A `UsbDirectTransport` implementing `_open`, `_close`,
`_write` and `_receive` is the entire change, plus a `TransportKind` entry and a
branch in the chooser.

**If it introduces new framing — a binary header, length-prefixed records, a
command/response envelope — the change reaches into `sdk/core/`,** because the
line reader and the response classifier both assume CRLF-delimited ASCII. That
is not a reason to avoid a better wire format, but it is the difference between
a new file and a second protocol path to maintain alongside the first, and it
should be a deliberate choice rather than a discovery.

Worth settling while the USB API is still being designed:

- **Framing.** As above. Keeping the ASCII line protocol over bulk endpoints
  costs nothing at USB speeds and makes every existing host work unchanged.
- **Arrival and removal.** WebUSB raises `connect` and `disconnect` on
  `navigator.usb`, which the serial transports have no equivalent of. The
  `Transport` contract already emits `disconnect` through `_dropped()`, so
  removal fits today; arrival — reconnecting automatically when the device comes
  back — is the part with nowhere to go yet, and is worth adding to the contract
  as an optional `reconnect` capability rather than as a special case.
- **Throughput.** A firmware image is about 460 kB and currently takes minutes
  at 115200 baud in 512-byte packets. Over bulk endpoints the packet size and
  the one-outstanding-command rule become the limit instead of the line rate, so
  the update protocol is where the speed would actually be felt — and `w`'s
  `packetSize` is fixed at 512 today by the firmware, not by the link.
- **What identifies a BP+.** A direct device needs its own VID/PID and interface
  descriptors. Those become filters in the chooser, in the same place the
  adapter drivers keep theirs.

Until that firmware exists there is nothing to write against, so nothing here
is implemented. The point of writing it down is that the transport boundary is
already the right seam, and the one thing that could spoil it — new framing —
is a decision being taken elsewhere.

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
| 3 | Pulse-wave charts, the two average pulses, and the raw pressure recordings — one cuff ramp per BP reading, then the suprasystolic channel |
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
