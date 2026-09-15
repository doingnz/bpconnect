# Reservoir analysis — authors, references and licensing

The code in this folder is a JavaScript port of **BPplus-Reservoir**
(`bpp_Res2`, beta7): MATLAB scripts that perform pulse wave analysis,
reservoir–excess pressure analysis and pressure-only wave intensity analysis on
BP+ measurements.

## Authors of the original

| File here | Ported from | Original authors |
|---|---|---|
| `reservoir.js` | `bpp_Res2.m`, parts of `read_BPplus.m` and `read_BPplusBPplus.m` | Alun Hughes, based on original code by Kim Parker, with input from Justin Davies |
| `kreservoir.js` | `kreservoir_v15.m`, `BPfitres_v1.m` | Kim H. Parker, with additions by Alun Hughes |
| `ai-v2.js` | `ai_v2.m` | Alun Hughes; zero-crossing search after `MMINTERP` by D. C. Hanselman |
| `matlab.js` | behaviour of MATLAB built-ins (`findpeaks`, `fminsearch`, `fzero`, `sgolay`, `spline`, `filter`) | reimplemented from their documented behaviour; no MathWorks code |

Richard Scott contributed information about the BP+ XML variables, bug reports
and code suggestions to the original.

## Licensing

The MATLAB original is distributed under the GNU General Public License,
version 3. This port is included in BP+ Connect with the permission of its
authors.

## References

Reservoir–excess pressure:

- Parker KH, Hughes AD. The theoretical basis of reservoir pressure in arteries.
  arXiv:2404.10806 (2024). https://doi.org/10.48550/arXiv.2404.10806
- Hughes AD, Parker KH. The modified arterial reservoir: an update with
  consideration of asymptotic pressure (P∞) and zero-flow pressure (Pzf).
  Proc Inst Mech Eng H 2020;234(11):1288-99. https://doi.org/10.1177/0954411920917557
- Armstrong MK, Schultz MG, Hughes AD, Picone DS, Sharman JE. Physiological and
  clinical insights from reservoir-excess pressure analysis.
  J Hum Hypertens 2021;35(9):758-68. https://doi.org/10.1038/s41371-021-00515-6

Wave intensity from pressure alone:

- Hughes A, Park C, Ramakrishnan A, Mayet J, Chaturvedi N, Parker K. Feasibility
  of estimation of aortic wave intensity using non-invasive pressure recordings
  in the absence of flow velocity in man. Front Physiol 2020;11:550.
  https://doi.org/10.3389/fphys.2020.00550
- Lindroos M, et al. J Am Coll Cardiol 1993;21:1220-5 (peak velocity assumption).
- Rivolo S, et al. IEEE EMBC 2014:5056-9 (Savitzky-Golay window for dI).

Pulse wave analysis:

- Kelly R, Hayward C, Avolio A, O'Rourke M. Noninvasive determination of
  age-related changes in the human arterial pulse. Circulation 1989;80(6):1652-9.
- Murgo JP, Westerhof N, Giolma JP, Altobelli SA. Aortic input impedance in
  normal man: relationship to pressure wave forms. Circulation 1980;62(1):105-16.
- Munir S, et al. Hypertension 2008;51(1):112-8 (peripheral augmentation index).
- Nichols WW. Clinical measurement of arterial stiffness obtained from
  noninvasive pressure waveforms. Am J Hypertens 2005;18(1 Pt 2):3S-10S
  (wasted LV pressure energy).

## Where this port departs from beta7

Defects in beta7 are corrected, each listed in `CORRECTIONS` in `reservoir.js`
and shown on the tab. `analyseReservoir(input, { compatibility: 'beta7' })`
reproduces the original exactly.

- **Diastolic duration** (`re_aodd`) is 60/HR less the ejection duration. beta7
  subtracts the end-systolic pressure divided by 1000.
- **The SEVR figure** ends systole at the ejection duration, where the SEVR
  value does. beta7 reuses a variable the wave intensity section has
  overwritten, so its figure ends systole at the minimum of that section's
  derivative instead.
- **The pulse traces figure** shows the pulses in `sSelectedPulseIndexes`.
  beta7 draws the first N−1 pulses of the recording, N being the number
  selected, so rejected pulses can appear and selected ones be missing.
- **The T1 label on the SEVR figure** is placed at the inflection sample.
  beta7 indexes the beat with `ao_Ti*samplerate`, which is `ti/fs*fs` and not
  always an integer in floating point, so on some recordings — at 200 Hz, an
  inflection at sample 7, 14, 28 or 29, among others — it stops with "Array
  indices must be positive integers" before writing any results.

Behaviour kept as beta7 has it, because changing it changes results that are
the original authors' to define:

- The beat is cut after its last falling sample before the reservoir fit, but
  the fit's time axis spans the uncut beat, so its sample interval is slightly
  longer than 1/fs. The ejection duration, rate constants, SEVR split and Ew
  inherit this.
- The pressure-time integrals (`re_ao_tti`, `re_ao_dti`) are summed over
  samples, not seconds. The tab labels them mmHg·sample.
- The time of Wf2 (`re_wf2t`) is one sample later than the peak it reports:
  the search window's offset is added to a 1-based position.

## Status

A research analysis, not a result of the BP+ and not for diagnosis. Values are
checked against the MATLAB original run on the same measurements — see
`test/reservoir/README.md`.
