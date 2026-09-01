# BP+ Connect

A web app for the **Uscom BP+**: run a measurement, read the result, look at the
pulse waveform, configure the device, install firmware. It runs entirely in the
browser — no server, no install, no account.

## Try it

### **<https://doingnz.github.io/bpconnect/>**

**You do not need a device.** It opens on the built-in simulator, so you can take
a measurement, see the central and brachial pressures come back, and look at the
decoded waveform with nothing plugged in.

With a BP+ on the cable, open **Settings** and change the connection from
*Simulator* to the cable, then connect. Chrome or Edge, on a desktop or an
Android tablet.

> It is served over HTTPS, which is not a detail: the browser refuses to talk to
> a serial or USB device on an insecure origin, and does it by never showing a
> picker rather than by raising an error.

## What you need for a real device

| | |
|---|---|
| Browser | **Chrome or Edge.** Firefox and Safari implement none of the device APIs, and neither does anything on iOS — including Chrome there, which is Safari underneath |
| Page | **HTTPS**, or `localhost` |
| Cable | Any USB-serial adapter on a desktop. On Android it must be a **Prolific PL2303**, the only chip driver the SDK ships |

On Android the cable is reached over **WebUSB**, not Web Serial — Chrome exposes
`navigator.serial` there, but its port list enumerates Bluetooth devices rather
than the cable. The SDK works that out; you do not have to.

## Installing it as an app

It is a PWA, so Chrome will offer to install it and it then works offline. Useful
on a tablet at a bench or a clinic: the device APIs work the same whether it was
opened from the browser or from the home screen.

## What is inside

```
index.html      the shell
app/            the application -- measure, results, waveform, settings, firmware
sdk/            the BP+ JavaScript SDK, a vendored copy
sw.js           the service worker, which is what makes it work offline
test/           checks on the vendored copy
```

`sdk/` is a **copy** of [Uscom/bpplus-js-sdk](https://github.com/Uscom/bpplus-js-sdk),
pinned by `sdk/SDK-VERSION.json` — which records the release and a hash of the
folder.

**Do not edit `sdk/` in place.** An edit that lives only here is lost the next
time the folder is replaced, and invisible until then. That is not hypothetical:
this copy and one in a REDCap module drifted apart across seven files while both
reported `SDK_VERSION 1.0.0`, and nothing showed until they were diffed. Change
it upstream and re-vendor.

## Running it locally

Any static server. ES modules do not load over `file://`, and the device APIs
need a secure context, which `localhost` counts as:

```bash
python -m http.server 8080      # then http://localhost:8080
```

## Tests

```bash
node test/check-sdk.mjs
```

Checks that `sdk/` is still the copy `SDK-VERSION.json` describes, and that every
SDK file the app loads is in the service worker's precache list. The second one
matters more than it sounds: that list is written by hand, so an SDK release that
adds a file leaves it out — which costs nothing online, because the network
serves it, and stops the app starting **offline**, which is the one situation a
PWA exists for.

## Related

| | |
|---|---|
| [Uscom/bpplus-js-sdk](https://github.com/Uscom/bpplus-js-sdk) | The SDK this uses, and its integration guide |
| [Uscom/bpplus-redcap](https://github.com/Uscom/bpplus-redcap) | REDCap external modules for the same device |

Contact: <richard.scott@uscom.com.au>
