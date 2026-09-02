# BP+ JavaScript SDK -- the guide has moved

The integration guide that used to be this file now lives with the SDK itself:

**<https://github.com/Uscom/bpplus-js-sdk/blob/main/docs/SDK.md>**

This is a stub rather than a deletion because `sdk/index.js`, `sw.js` and any
number of existing links point here.

## Why it moved

`sdk/` in this repository is a **copy**. The SDK is developed at
[Uscom/bpplus-js-sdk](https://github.com/Uscom/bpplus-js-sdk) and consumed by
this application, by the REDCap external modules, and by whatever comes next.

A guide living beside one consumer goes stale for all the others, and this one
did. Three of its claims were wrong by the time it moved:

- **"Android Chrome has no Web Serial at all."** True when it was written.
  Chrome 151 on Android exposes `navigator.serial`, but its port list
  enumerates Bluetooth SPP devices rather than the USB cable -- which is worse
  than the API being absent, because feature detection now gives a confident
  wrong answer.
- **F 11 means "NIBP retry limit reached."** It is the blood-pressure module's
  general fault code and carries no cause of its own; a device that aborts on
  its first attempt reports the same 11.
- It documented none of `unusableReason`, `alertsOf`, `parseAlerts`,
  `classifyAlert` or `error.alerts`.

All three are corrected upstream.

## The copy in this repository

`sdk/SDK-VERSION.json` records which copy it is: the upstream commit, and a
hash of the folder.

**Do not edit `sdk/` in place.** An edit that lives only here is lost the next
time the folder is replaced, and invisible until then. A version number records
only what nobody changed, which is why `SDK-VERSION.json` carries a hash of the
folder as well. Change it upstream and re-copy.
