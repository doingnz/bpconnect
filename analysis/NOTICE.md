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

## Status

A research analysis, not a result of the BP+ and not for diagnosis. Values are
checked against an independent implementation and, where available, against
the MATLAB original — see `test/reservoir/README.md`.
