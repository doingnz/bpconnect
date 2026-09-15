# Reservoir analysis — reference values

`node test/check-reservoir.mjs` compares every result of `analysis/` against
`reference/<name>.json` when one exists for a measurement. Each file says in its
`source` field where its numbers came from, and that matters, because only one
kind of source is an independent check of the whole port.

| Source | What agreement proves |
|---|---|
| `MATLAB bpp_Res2 beta7` | The port reproduces the MATLAB original: script logic and built-ins both. |
| `scipy reference` | The ported MATLAB built-ins (peak finding and widths, Savitzky-Golay, spline, root finding, Nelder-Mead) agree with scipy's independent implementations. The script logic was transcribed twice by the same reader, so a misreading of `bpp_Res2.m` would be in both. |

## The files here

All of them are **MATLAB beta7** values, produced by `export_reference.m` with
R2019b. To regenerate them — after `bpp_Res2.m` changes upstream, say:

```
# The simulator's recorded measurement, and the fixtures from BPplus-Reservoir
node --input-type=module -e "import {MEASUREMENT_XML} from './sdk/transports/simulator-data.js'; import fs from 'node:fs'; fs.mkdirSync('C:/temp/xml', {recursive: true}); fs.writeFileSync('C:/temp/xml/simulator.xml', MEASUREMENT_XML); for (const f of fs.readdirSync('D:/Uscom/github/BPplus-Reservoir/tests/fixtures').filter(n => n.endsWith('.xml'))) fs.copyFileSync('D:/Uscom/github/BPplus-Reservoir/tests/fixtures/' + f, 'C:/temp/xml/' + f)"

matlab -batch "addpath('test/reservoir'); export_reference('D:\Uscom\github\BPplus-Reservoir', 'C:\temp\xml', 'test/reservoir/reference')"
```

`export_reference.m` runs `bpp_Res2.m` as it ships and converts its
`resdata.xls`, so there is no second transcription to trust. It works from
R2019b. It rewrites two lines of `bpp_Res2.m` in a temporary copy, both placing
labels on the SEVR figure and neither touching a result: one stops the script on
some recordings on any release, and one releases before R2021a cannot parse. The
comment at the top of the file says exactly what, and each rewrite is printed.

The CardioScope fixtures are analysed too, and skipped by the check.

The corrections `analysis/` makes to beta7 on purpose (`CORRECTIONS` in
`analysis/reservoir.js`) are switched off by
`analyseReservoir(input, { compatibility: 'beta7' })`. The check compares that
against the reference, so MATLAB output stays directly comparable however many
corrections are added.

| Name | Measurement |
|---|---|
| `simulator` | The recording `sdk/transports/simulator-data.js` replays. Checked on every run and in CI. |
| `BPplus_4.4.44094.43303_00{1,2,3}`, `BPplus_DeviceFirmwareVersion` | Anonymised device recordings from `BPplus-Reservoir/tests/fixtures`. |
| `synthetic_ai_v2_Type{A,B,C}` | Hand-built aortic pulses of each Murgo type, from the same folder. |

The fixture files themselves are not copied here. Point the check at them:

```
BPPLUS_RESERVOIR_FIXTURES=D:/Uscom/github/BPplus-Reservoir/tests/fixtures node test/check-reservoir.mjs
```

## Checks when the port was written

**Against MATLAB.** R2019b (Update 9) ran beta7 over the eight measurements
above. The port, with `compatibility: 'beta7'`, agreed with it in all 89 columns
of every one; the largest relative difference was 7e-8, in the fitted rate
constants, which is the size of `fminsearch`'s own stopping tolerance.

**Against scipy.** Before a licensed MATLAB was available, the port and
`reference.py` were run over the same fixtures and 26 further local recordings.
All 34 agreed in every column, to 1e-7. The Murgo types of the three synthetic
pulses came out as A (29), B (9) and C (−19), the values their fixture was built
to produce.
