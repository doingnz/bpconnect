# CLAUDE.md — BP+ Connect

## Project documentation

Full application design, file structure, data flow, and protocol reference:
→ **[ApplicationDesign.md](ApplicationDesign.md)**

Customer-facing SDK integration guide:
→ **[docs/SDK.md](docs/SDK.md)**

---

## Quick orientation

Two halves, and the boundary between them is the point:

| | |
|---|---|
| **`sdk/`** | Talks to the device. **No DOM, no Framework7, no localStorage.** This is what ships to customers. |
| **`app/`** | The reference UI. A consumer of `sdk/`, nothing more. Delete it and the SDK still works. |

- **ES modules, no build step.** Edit files and refresh. Each module names what it needs — there is no load order to maintain.
- **Start here for protocol** — `sdk/core/session.js` (request/response, timeouts, notification routing)
- **Start here for the API** — `sdk/device/bpplus-device.js` (what an integrator calls)
- **Start here for UI** — `app/app.js` (Framework7 init, the action button, event wiring)
- **Measurement mode, patient ID, AOBP** — `app/measure-setup.js`
- **Firmware update** — `sdk/device/firmware-update.js` (protocol), `app/tab-firmware.js` (UI)

---

## Running locally

**A local server is required.** ES modules do not load over `file://`, and Web
Serial, WebUSB and Web Bluetooth all need a secure context.

```bash
python -m http.server 8080     # → http://localhost:8080
```

Defaults to **Simulator** on first load — no hardware needed.

## Testing without hardware

```bash
node sdk/selftest.js           # needs: npm install --no-save jsdom
```

Covers framing, both CRCs, command building, response classification and a full
measurement against the simulator. The known answers are values the device
itself produces, not values this implementation happened to compute — so a
change that breaks wire compatibility fails here rather than on the bench.

The simulator also reproduces the behaviours a host must survive: the `D` echo,
the two empty lines before `M 00`, lines split across chunks, and — with
`{ orphanOnCancel: true }` — the extra `F 50` a cancel racing a packet
produces during a firmware update. `new SimulatorTransport({ scenario })`
takes `'success'`, `'cancel'`, `'nibpError'`, `'outOfRange'` or `'busy'`.
`{ measureMode: 5 }` makes it an AOBP device; `{ reportMeasureMode: false }`
makes it one that reports no mode at all, which a host must show as unknown
rather than assume a default for.

---

## Key conventions

- All settings live in `app/settings.js`. **Nothing in `sdk/` reads localStorage** — a device is constructed with an explicit transport.
- Every transport extends `sdk/transports/transport.js`: `_open`, `_close`, `_write`, and `_receive(bytes)` as they arrive.
- Failures reject with a `BpPlusError` carrying the Table 5 code, its firmware name and a sentence a UI can show. Callers switch on `error.code`.
- Debug and trace output goes to `app/ui-log.js`, fed by `device.on('log')`. The SDK emits; it never writes to the DOM.
- New files must be added to `PRECACHE` in `sw.js` or the PWA serves a half-updated app offline.

---

## Which firmware versions may be named

`sdk/` and `app/` are given to customers, so a version number in a comment is a
promise that the reader can go and look at that build.

| | |
|---|---|
| **Latest released** | 5.2.0.0 |
| **Typical in the field** | 4.1.0.0 |
| **Anything ending `.3`** | internal alpha — never released, never cite it |

A build whose version ends in `.3` exists only on a development machine. It is
occasionally given to a customer to test something specific, and replaced with a
released build shortly afterwards. Naming one in shared code or in a
specification points the reader at something they cannot obtain, and dates the
comment to a build that no longer exists anywhere.

So:

- **Never** cite `.3` builds, internal defect numbers, fix dates, firmware
  source files or line numbers, or internal document revisions in `sdk/`,
  `app/`, `ApplicationDesign.md` or a commit message.
- **Do** describe the behaviour itself. "The device answers `W`, not an F code"
  is useful forever; "fixed in x.x.x.3 per defect 1234" is useful to nobody
  outside the bench and wrong within a release.
- **Do** name a version where a code branch exists for older devices, because
  then it tells an integrator which of their devices takes that path — for
  example, the feature-XML closing-tag repair is genuinely "fixed in BP+
  application firmware 5.3.0.0", so devices below that need the repair.
- Protocol schema versions are not firmware versions. The feature list's
  `version="3.0"` and the result XML's `version="7.0"` are part of the wire
  format and should be named freely.

The same applies when writing up a specification revision: describe what the
device does, not which internal build it was observed on.

---

## Files not to modify

| File / Folder | Reason |
|---|---|
| `framework7/` | Third-party library — update as a whole |
| `webfonts/` | Font Awesome font files — regenerate from CSS if updated |
| `css/fa-all.css` | Font Awesome CSS — regenerate or replace as a unit |
| `js/vendor/` | Chart.js UMD build |
| `sdk/transports/simulator-data.js` | A recorded measurement, kept verbatim |

---

## Protocol gotchas worth knowing before you touch `sdk/core/`

These are all documented in `ApplicationDesign.md`, but they are the ones that
cause bugs that look like something else:

- **A measurement reports its `F nn` exactly ONCE.** Do not write a duplicate-failure guard. Older internal notes describe a cancel answering twice; that is not the behaviour of any released firmware.
- **The reply to `f` starts with `<`.** It must be recognised by prefix before any test for the start of a measurement XML block, or the feature list is swallowed as XML.
- **The XML block is framed by byte count**, not by content — `F nn` and `P nnn` are not suppressed while it is being sent.
- **`updateID` is the netMF CRC-32**: non-reflected, seed 0, no final inversion. Not the reflected CRC-32 every library gives you by default.
- **The device rejects, it never clamps.** An out-of-range AOBP parameter answers `F 14` without saying which one, so `sdk/core/commands.js` validates before sending.
- **AOBP needs the DEVICE in AOBP.** A body position is refused with `F 14` unless `DeviceMeasurementMode` is 5, which is why the page compares its own selection against `f` rather than assuming.
- **`M nn` is both a notification and the reply to `m`.** The session emits it *and* offers it to a pending request; consuming it as one or the other alone breaks `readMode()` or the `f` write.
- **The feature-list `version` attribute is not a capability marker.** Feature-detect the elements.
- **Firmware update acknowledges with `W` and `K <index>`, not `F 99`.** The specification says F 99 in §2.7 and Table 5; the firmware never sends it. `F 51` means "too early, ask again" and is the only retryable response.
- **Cancel a firmware transfer between packets only.** A `k` already on the wire is still processed, its orphaned `K` comes back with nobody waiting, and the device answers it with an extra `F 50`. This is the ONLY unrequested `F` in the protocol; `Session.expectStrayFailure()` absorbs exactly one, armed by the update job and nothing else.
- **`M nn` is sent on every mode change, not only when asked.** Do not poll `m` to watch the device — subscribe to `device.on('mode')`. The single `m` worth sending is one at connect, to learn the state nothing has announced yet.

---

## Known issues / notes

- The Gevity upload block and its hard-coded credentials were removed. Those credentials remain in the git history and should be rotated.
- Two service actions are off by default, both under Settings: **Device provisioning** (writing a setting to the BP+, which always restarts it) and the **Firmware update tab**.
- Only ONE firmware transfer succeeds per device boot. `F 50` from `w` means restart-then-retry, never retry — repeated attempts without a restart can hang the device outright.
