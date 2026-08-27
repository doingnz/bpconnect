# BP+ JavaScript SDK

Talk to a Uscom BP+ blood-pressure monitor from a web browser: run a
measurement, read the result, configure the device, install firmware.

No build step, no dependencies, no npm install. It is ES modules and the three
browser APIs it uses — `TextEncoder`, `TextDecoder` and `DOMParser` — are built
in.

```js
import { BpPlusDevice, WebSerialTransport } from './sdk/index.js';

const device = new BpPlusDevice(new WebSerialTransport());
await device.connect();

const result = await device.measure({ patientId: 'ABC-1' });
console.log(result.brachial.sys, result.brachial.dia);   // 118 76
console.log(result.central.cSys, result.central.cDia);   // 106 78
```

---

## Contents

1. [What this is](#1-what-this-is)
2. [Quick start](#2-quick-start)
3. [Choosing a transport](#3-choosing-a-transport)
4. [The device object](#4-the-device-object)
5. [Measurement modes](#5-measurement-modes)
6. [Reading a result](#6-reading-a-result)
7. [Handling failure](#7-handling-failure)
8. [Firmware update](#8-firmware-update)
9. [Protocol notes](#9-protocol-notes)
10. [Support and versioning](#10-support-and-versioning)

---

## 1. What this is

`sdk/` is a JavaScript client for the BP+ Terminal API. It handles the framing,
the checksums, the request/response pairing and the result parsing, and gives
you an object with methods that return values.

**It does not touch the DOM, a UI framework or `localStorage`.** You construct a
device with a transport and subscribe to events; where those events go, and what
the screen looks like, is entirely yours.

### What comes with it

| | |
|---|---|
| `sdk/` | The SDK. This is the part you integrate. |
| `app/` | A reference application built on it — five tabs, one worked example per feature. Delete it and the SDK still works. |
| `sdk/selftest.js` | Runs the whole stack against a simulated device, with no browser and no hardware. |

### What it does not do

- **No Node.js support.** It targets browsers. The self-test runs under Node
  with a `DOMParser` shim, but the transports are Web Serial, WebUSB and Web
  Bluetooth, none of which exist there.
- **No CardioScope.** Older Uscom monitors use a different result schema. The
  SDK tolerates several older BP+ behaviours (see [§9](#9-protocol-notes)) but
  is tested against BP+ only.
- **No storage, no charting, no upload.** The reference app shows one way to
  draw waveforms and lay out results; both are yours to replace.

---

## 2. Quick start

### Serve the folder

ES modules do not load over `file://`, and Web Serial, WebUSB and Web Bluetooth
all require a secure context. Any static server on `localhost` will do:

```bash
python -m http.server 8080          # → http://localhost:8080
npx serve .                         # → http://localhost:3000
```

In production, serve over `https://`.

### Measure, with no hardware

```html
<script type="module">
  import { BpPlusDevice, SimulatorTransport } from './sdk/index.js';

  const device = new BpPlusDevice(new SimulatorTransport());

  device.on('mode',     m  => console.log(m.text));       // "Measuring blood pressure"
  device.on('pressure', mm => console.log(mm, 'mmHg'));

  await device.connect();

  const result = await device.measure({ patientId: 'DEMO-1' });
  console.log(result.summary);      // "118/76 mmHg, central 106/78 mmHg"
</script>
```

Swap `SimulatorTransport` for `WebSerialTransport` and the same code drives a
real device — but `connect()` then opens a browser permission prompt, so it must
be called from a user gesture such as a click handler.

### Run the tests

```bash
npm install --no-save jsdom
node sdk/selftest.js
```

The known answers are values the device itself produces, so a change that breaks
wire compatibility fails here rather than on the bench.

---

## 3. Choosing a transport

A transport moves bytes and knows nothing about the protocol. Everything above
it is identical whichever you use.

| Class | Browser API | Use it for |
|---|---|---|
| `WebSerialTransport` | `navigator.serial` | A serial cable or USB-serial adapter on desktop |
| `WebUsbPl2303Transport` | `navigator.usb` | Android, where Web Serial does not exist |
| `WebBluetoothTransport` | `navigator.bluetooth` | A BLE-to-serial bridge |
| `SimulatorTransport` | none | Development, demos, tests |

Every class exposes `static isSupported`, so you can offer only what the browser
can actually provide rather than letting someone pick and meet the failure at
connect time:

```js
if (!WebSerialTransport.isSupported) { /* offer WebUSB or Bluetooth instead */ }
```

### Web Serial

```js
new WebSerialTransport({ baudRate: 115200, flowControl: 'hardware' })
```

8 data bits, no parity, 1 stop bit. 115200 is the device default.

### WebUSB (Android)

```js
new WebUsbPl2303Transport({ baudRate: 115200 })
```

Drives a Prolific PL2303 adapter directly, including the chip's vendor-specific
initialisation. Supports the PL2303/PL2303HX and the newer PL2303GT.

### Web Bluetooth

```js
new WebBluetoothTransport({ hardwareFlowControl: true })
```

Five bridge profiles are probed in order after the GATT connection is up:
Nordic NUS, uConnect S2B5232I, Microchip RN4870, HM-10/JDY, and the HM-10 clone
on `FFF0`. Whichever answers first is used.

`hardwareFlowControl` applies to the uConnect S2B5232I, which takes it as a
configuration byte. **The BP+ must have flow control enabled to match.**
Recommended on Android, where the link cannot keep up with 115200 baud during a
result transfer and data is otherwise lost.

Bluetooth is fine for measurements. For firmware it is slow — see
[§8](#8-firmware-update).

### Writing your own

Extend `Transport` and implement four things:

```js
import { Transport } from './sdk/index.js';

class MyTransport extends Transport {
  constructor() { super('My link'); }

  async _open()       { /* connect; throw on failure */ }
  async _close()      { /* tear down */ }
  async _write(bytes) { /* send a Uint8Array */ }
  // call this._receive(bytes) as they arrive
}
```

Two rules the layer above depends on:

- **`_write` must resolve when the bytes have actually left**, or as close to it
  as your link allows. A firmware update sends roughly a thousand packets back
  to back, and a write that resolves early becomes a buffer overrun a long way
  from its cause.
- **`_receive` may deliver any number of bytes**, including a fragment of a
  line. Do not try to reassemble; that is done for you.

---

## 4. The device object

```js
const device = new BpPlusDevice(transport, { detailLevel: 4 });
```

### Events

Subscribe with `on(event, handler)`; it returns an unsubscribe function.

| Event | Payload | When |
|---|---|---|
| `state` | `'disconnected' \| 'connected' \| 'measuring'` | The device object's own state changed |
| `mode` | `{ code, name, text, known }` | The device reported a mode. Sent on **every** change, not only when asked |
| `pressure` | `number` (mmHg) | Cuff pressure. May arrive at any time, from any cause |
| `progress` | `{ phase, bytesReceived, bytesTotal }` | A large result is arriving |
| `log` | `{ dir: 'tx' \| 'rx', text, at }` | Every line on the wire — for a trace pane |
| `warning` | `{ message }` | Non-fatal, e.g. a result checksum mismatch |
| `error` | `BpPlusError` | Something failed outside a pending request |

`mode` is worth dwelling on. The device announces every screen change without
being asked, so **watching the device means subscribing, not polling.** The one
thing notifications cannot tell you is the state you connected *into*, because
nothing has changed yet — ask once with `readMode()` and subscribe thereafter.

### Methods

| Method | Returns |
|---|---|
| `connect()` / `disconnect()` | — |
| `readApiVersion()` | `'2.4'` |
| `readMode()` | `{ code, name, text, known }` |
| `readFeatures()` | `BpPlusFeatures` — also cached on `device.features` |
| `readTime()` | `'yyyyMMddHHmmss'` |
| `readMeasurementInProgress()` | `{ running, available, code }` |
| `measure(options)` | `BpPlusMeasurement` |
| `cancel()` | — |
| `listMeasurementIds(page)` | `{ ids, declaredLength, crc }` |
| `recall(index, options)` | `BpPlusMeasurement` |
| `writeFeatures(pairs)` | `BpPlusFeatures` — **restarts the device** |
| `reboot(options)` | the mode it came back in |
| `prepareFirmwareUpdate(bytes)` | `FirmwareUpdateJob` |

Properties: `state`, `isConnected`, `isMeasuring`, `transport`, `lastMode`,
`features`.

### Requests are serialised for you

The protocol allows one outstanding command at a time. Calls queue, so you never
have to check whether the wire is busy:

```js
const [version, features] = await Promise.all([
  device.readApiVersion(),
  device.readFeatures(),
]);
```

`cancel()` is the exception — it jumps the queue, because it is the only command
the device accepts while measuring and must not wait behind the measurement it
is cancelling.

---

## 5. Measurement modes

The BP+ has a measurement mode set in its Service Menu. It changes what a
measurement does and what the result contains.

| `MeasureMode` | Label | Result |
|---|---|---|
| `bpPlus` (0) | BP+ | One BP reading and a pulse-wave analysis |
| `infraDiaBpPlus` (3) | InfraDia & BP+ | Adds an infradiastolic phase |
| `bpPlus3` (4) | BP+ [3] | Three BP readings, one analysis |
| `bpPlusAobp` (5) | BP+ AOBP | Three BP readings under the AOBP protocol |

`SELECTABLE_MEASURE_MODES` lists the four a host should offer.

### Confirm it; do not assume it

```js
const features = await device.readFeatures();

if (features.measureMode === null) {
  // The device did not report one. Not the same as mode 0 - say so.
  show('Measurement mode is unknown.');
} else {
  show(`Device is in ${features.measureModeInfo.label}`);
}
```

`measureMode` is reported from feature list version 3.0 onwards. A device that
predates it does not carry the element, and `measureMode` is then `null`.
**Null means "the device did not say", not "mode 0"** — a host that defaults it
will tell the user the device is in BP+ when it has no idea.

An operator can change the mode at the device between measurements, so read the
features immediately before starting rather than once at connect.

### AOBP

Only when the device is in AOBP. Any other mode refuses a body position.

```js
const result = await device.measure({
  patientId: 'STUDY-014',
  aobp: {
    bodyPosition: 'seated',      // or 'standing' - the only two defined
    repeats: 3,                  // 1..5     omit for the device default
    initialDelaySeconds: 300,    // 0..900   omit for the device default
    repeatDelaySeconds: 30,      // 0..180   omit for the device default
  },
});
```

Omit a field and the device applies its own: seated is 3 readings after
5 minutes, standing is 2 after 1 minute, 30 seconds apart.

**The device rejects; it never clamps.** An out-of-range value is refused
without saying which one was wrong, so the SDK range-checks before the command
goes out and throws a `BpPlusError` naming the field.

The rest period is real silence. The device announces it once and then says
nothing for up to fifteen minutes:

```js
device.on('mode', m => {
  if (m.code === DeviceMode.countDownAobp) {
    // Show a countdown. Silence this long is indistinguishable from a
    // device that has hung, and an operator will power-cycle it.
  }
});
```

`measure()` sizes its own timeout from the protocol requested, so you do not
need to pass one. The worst legal run is about 27 minutes.

### Patient ID

```js
await device.measure({ patientId: 'ABC-1' });
```

The device stores what it is sent, verbatim, straight into `<PatientID>`. It
does not unquote, escape or validate. So:

- **No comma** — it is read as the start of the next parameter.
- **No `<`, `&` or `>`** — written to the result unescaped, making the file
  unparseable.
- Quotes are not delimiters. They are stored as part of the value.

The SDK enforces letters, digits and hyphen, up to 64 characters, and refuses
anything else before sending. `PATIENT_ID_PATTERN` and `PATIENT_ID_MAX_LENGTH`
are exported if you want to filter input as it is typed.

---

## 6. Reading a result

`measure()` and `recall()` return a `BpPlusMeasurement`.

```js
result.brachial            // { sys, dia, map, pr }
result.central             // { cSys, cDia, cMap }
result.indices             // { snr, sPR, sPRV, sAI, sPP, sPPV, sSEP, ... }
result.patientId
result.info                // every MeasDataLogger attribute
result.timestamp
result.guid
result.summary             // "118/76 mmHg, central 106/78 mmHg (mean of 3)"

result.value('sAI')        // any named value, as text
result.number('sAI')       // as a number, or null
result.array('baEstimate') // a waveform, as number[]

result.xml                 // the raw document, if you want something else
result.document            // the parsed DOM
result.crcOk               // false if the checksum did not match
```

### Multi-reading modes

In BP+ [3] and AOBP the headline values are a **mean**, and the individual
readings are separate:

```js
if (result.isMultiReading) {
  console.log(result.protocol.type);          // 'aobp'
  console.log(result.protocol.bodyPosition);  // 'seated'

  for (const r of result.readings) {
    console.log(r.id, r.sys, r.dia, r.map, r.pr, r.actualDelaySeconds);
  }
}
```

If you go to the raw XML yourself, **scope your element lookups.** Each reading
carries its own `<Sys>`, `<Dia>`, `<Map>` and `<Pr>`, so a document-wide search
for `<Sys>` finds the mean only because the mean happens to be serialised first.
That is an accident of element order, not a guarantee. `result.value()` and
`result.readings` already scope correctly.

### Checksums

A result arrives with a length and a checksum, both verified. A mismatch does
not throw — `crcOk` is `false` and a `warning` is emitted, so you can show the
values flagged rather than discard a measurement that cannot be repeated.

---

## 7. Handling failure

Everything rejects with a `BpPlusError`:

```js
try {
  const result = await device.measure({ patientId: 'ABC-1' });
} catch (error) {
  error.code;      // 13
  error.codeName;  // 'measurementBPOutOfRange'
  error.message;   // 'Blood pressure was outside the measurable range.'
  error.command;   // 's 0,ABC-1'
}
```

Switch on `error.code`; show `error.message`. `describeResult(code)` gives the
same for a code you have from elsewhere.

### Codes worth handling by name

| Code | Name | Meaning |
|---|---|---|
| 2 | `cancelled` | The measurement was cancelled |
| 11 | `nibpDeviceError` | NIBP retry limit reached — check the cuff and hose |
| 13 | `measurementBPOutOfRange` | Outside the measurable range |
| 14 | `invalidCommand` | The device is on a screen that cannot do this |
| 15 | `failedSelfTest` | The device is offline until it passes its self-test |
| 17 | `deviceIsBusy` | A measurement is already running |
| 22 | `noMeasurementInProgress` | **Not a failure** — the normal idle answer |
| 50 | `updateFailed` | A firmware update ended |

Codes 18–21 are produced by the SDK, not the device: timeouts, connection
errors and receive failures. That range is reserved for host libraries, so you
can switch on the number alone and never have to distinguish "the device said
no" from "we could not ask".

### What a measurement reports

A measurement reports its outcome **exactly once**: one `F nn`, then the device
returns to Ready. Do not write a duplicate-failure guard.

The one exception is a cancelled firmware transfer — see below.

---

## 8. Firmware update

> **Interrupting an update is safe.** The image is written to a separate flash
> region. The device keeps running its current firmware until the very end, and
> the flag that tells the bootloader to adopt the new image is written only at
> the final step. It can be cancelled, restarted or unplugged at any point
> before it reboots. An interrupted transfer costs the time spent and nothing
> else — the failure to handle is always "the update did not happen", never
> "the device is half programmed".

### The device must be in its Service Menu

There is **no command that gets it there.** An operator has to navigate with the
buttons on the device. Your UI has to say so and wait:

```js
device.on('mode', m => {
  setReady(m.code === DeviceMode.serviceMenu);
});
```

The device announces its arrival, so subscribing is enough. Ask once with
`readMode()` for the state you connected into.

### Running one

```js
const bytes = new Uint8Array(await file.arrayBuffer());
const job = device.prepareFirmwareUpdate(bytes);

job.packetCount;   // 907
job.updateId;      // the image's identifying checksum
job.imageBytes;    // 464212

job.on('state',    s => console.log(s));
job.on('log',      m => console.log(m));
job.on('progress', p => {
  console.log(`${p.percent}% - packet ${p.packetIndex + 1} of ${p.packets}`);
  console.log(`${p.bytesPerSecond} B/s, ${p.secondsRemaining}s left`);
});

const outcome = await job.run();   // 'complete' | 'cancelled', or it throws
```

`prepareFirmwareUpdate` sends nothing. It computes the checksum and the packet
count so you can show the operator what is about to happen before committing.

### Cancelling

```js
job.requestCancel();
```

Nothing is sent at that moment. The flag is read by the packet loop, which
cancels only **between** packets — the one point at which host and device stay
in step.

Two consequences worth knowing:

- **A cancelled transfer can produce one extra `F 50`.** A packet already on the
  wire is still processed, its acknowledgement comes back with nobody waiting,
  and the device answers the orphan with a failure of its own. A cancel from the
  device's own buttons does the same and cannot be timed. The SDK absorbs
  exactly one; this is the only unrequested failure in the protocol.
- **The device then goes silent for several seconds** while it clears the
  transfer — about 0.6 s per 64 KB of the declared image. The SDK waits an
  interval derived from the image size rather than a fixed one.

### After a failure, restart before retrying

This is the one rule that matters:

> **A failed or cancelled transfer keeps hold of the device's update storage
> until it reboots.** Retrying without a restart can stop the device responding
> altogether — no serial reply, no buttons, no display — recoverable only by a
> power cycle. In practice one transfer succeeds per boot.

So the SDK never retries on its own, and your UI should refuse another attempt
until the device has restarted. The device announces it:

```js
device.on('mode', m => {
  if (m.code === DeviceMode.initial) allowAnotherAttempt();   // it rebooted
});
```

### Throughput

A 450 KB image is around 900 packets and roughly 640 KB on the wire, because
each packet is base64. Over a cable that is about a minute. Over Bluetooth it is
a great deal longer, and a failure costs a power cycle and a fresh start — worth
saying so before the first packet.

---

## 9. Protocol notes

Behaviours the SDK handles for you. They are here because you will see them in a
trace and wonder, and because they matter if you write your own client.

### Framing

- Lines end `CRLF`. **An empty line is not an error** — the device sends two at
  start-up to terminate whatever partial line a host may be holding.
- Three replies carry **no type letter** and must be recognised by prefix before
  any single-letter dispatch: the API version, the feature list, and the stored
  measurement list.
- **The feature list begins with `<`.** Any test for a leading angle bracket to
  find the start of a result document will swallow it.
- A result document is framed **by byte count**, not by content. The device does
  not suppress pressure or failure lines while sending it, so reading by count
  is what keeps them out of the payload.
- The result document is **UTF-8**. Decoding byte-by-byte gives Latin-1, which
  survives the checksum and then quietly corrupts any non-ASCII text.
- Checksums are transmitted as **decimal**, not hex.

### Commands and replies

- **Only one command may be outstanding.** Notifications can arrive at any
  moment, interleaved with replies.
- The detail-level command is **echoed** before its effect applies. Consume the
  echo before sending the next command.
- Setting a device feature **always restarts the device**, even when the value
  already matches. The restart *is* the acknowledgement — there is no success
  code and no feature list is returned. While the device is resetting, the
  serial line's state is undefined and unparseable bytes may arrive; discard
  them. The offline and ready notifications are the reliable markers.
- The device **rejects rather than adjusts**. An out-of-range parameter is
  refused without saying which one.

### Older devices

Tolerated, though the SDK is tested against current BP+ firmware:

- Feature lists below version 3.0 emit a malformed `<nibp_id>` closing tag. It
  is repaired before parsing; the repair is harmless on well-formed XML. Fixed
  in BP+ application firmware 5.3.0.0.
- The time reply comes either as bare digits or with a type letter. Both are
  accepted.
- Some older devices need a trailing space when setting the time.
- On some older devices the reporting detail resets after every measurement, so
  it is set immediately before every measurement rather than once.
- Devices predating feature list version 3.0 do not report a measurement mode.

### Result XML

The layout of a result document is defined in `BPPLUSR7-RS-CALCS`, not in the
Terminal API specification. `BpPlusMeasurement` covers the values most
integrations need; `result.xml` and `result.document` are there for the rest.

---

## 10. Support and versioning

`SDK_VERSION` is the SDK's own version. `TERMINAL_API_VERSION` is the protocol
revision it targets; `device.readApiVersion()` returns what the device reports.

```js
import { SDK_VERSION, TERMINAL_API_VERSION } from './sdk/index.js';
```

### Lower layers

If the device object does not do what you need, the pieces below it are
exported: `Session` to drive commands by hand, `commands` to build lines,
`classify` to parse a captured trace, and the two checksum functions.

### Reporting a problem

Turn on tracing and capture the wire. Every line in and out reaches
`device.on('log')`; the reference application shows one way to render it.
A trace plus the device's feature list is usually enough to diagnose anything.

```js
device.on('log', ({ dir, text, at }) => {
  console.log(new Date(at).toISOString(), dir === 'tx' ? '>' : '<', text);
});
```

Contact: <richard.scott@uscom.com.au>
