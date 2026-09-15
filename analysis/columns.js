/**
 * The 89 results of the reservoir analysis, in resdata.xls column order.
 *
 * `header` is the column name bpp_Res2.m writes, so a CSV exported here can be
 * pooled with the MATLAB batch output. `group` and `label` are for display.
 *
 * `units` describe the value as computed, which is not always what the MATLAB
 * comment says: the pressure-time integrals are summed over samples, not
 * seconds, and are labelled that way here.
 *
 * `device` names the BP+'s own result for the same quantity, where it reports
 * one, shown alongside in the device's own units rather than converted.
 */

export const GROUPS = [
  'Measurement',
  'Brachial (cuff)',
  'Suprasystolic (BP+)',
  'Brachial waveform',
  'Aortic waveform',
  'Aortic SEVR',
  'Aortic forward and backward pressure',
  'Aortic reservoir',
  'Brachial reservoir',
  'Wave intensity',
];

const col = (header, group, label, unit, digits, device) => ({ header, group, label, unit, digits, device });

export const COLUMNS = [
  col('re_file',           'Measurement', 'File', '', null),
  col('re_date',           'Measurement', 'Date', '', null),
  col('re_bppvers',        'Measurement', 'MeasDataLogger version', '', null),
  col('re_bppalgo',        'Measurement', 'Algorithm revision', '', null),
  col('re_resvers',        'Measurement', 'Analysis version', '', null),
  col('re_kres',           'Measurement', 'kreservoir version', '', null),
  col('re_sam_rate',       'Measurement', 'Sample rate', 'Hz', 0),
  col('re_basbp',          'Brachial (cuff)', 'Systolic', 'mmHg', 0),
  col('re_tbasbp',         'Brachial waveform', 'Time of systolic peak', 's', 3),
  col('re_ba_dbp',         'Brachial (cuff)', 'Diastolic', 'mmHg', 0),
  col('re_hr',             'Brachial (cuff)', 'Heart rate', 'bpm', 0),
  col('re_ba_map',         'Brachial (cuff)', 'Mean arterial pressure', 'mmHg', 0),
  col('re_bapp',           'Brachial (cuff)', 'Pulse pressure', 'mmHg', 0),
  col('re_aosbp',          'Aortic waveform', 'Systolic (BP+)', 'mmHg', 0),
  col('re_aodbp',          'Aortic waveform', 'Diastolic (BP+)', 'mmHg', 0),
  col('re_aopp',           'Aortic waveform', 'Pulse pressure (BP+)', 'mmHg', 0),
  col('re_snr',            'Measurement', 'Signal-to-noise ratio', 'dB', 0),
  col('re_rmssd',          'Suprasystolic (BP+)', 'Pulse rate variability (sPRV)', 'ms', 0),
  col('re_sAI',            'Suprasystolic (BP+)', 'Augmentation index (sAI)', '%', 0),
  col('re_ppv',            'Suprasystolic (BP+)', 'Pulse pressure variation (sPPV)', '%', 0),
  col('re_rwttf',          'Suprasystolic (BP+)', 'Reflected wave transit time, foot', 'ms', 0),
  col('re_rwttp',          'Suprasystolic (BP+)', 'Reflected wave transit time, peak', 'ms', 0),
  col('re_sep',            'Suprasystolic (BP+)', 'Systolic ejection period (sSEP)', 's', 3),
  col('re_quality',        'Measurement', 'Quality', '', null),
  col('re_ba_t1',          'Brachial waveform', 'T1', 's', 3),
  col('re_ba_p1',          'Brachial waveform', 'P1', 'mmHg', 1),
  col('re_ba_t2',          'Brachial waveform', 'T2', 's', 3),
  col('re_ba_p2',          'Brachial waveform', 'P2 (SBP2)', 'mmHg', 1),
  col('re_pai',            'Brachial waveform', 'Peripheral augmentation index', '%', 1),
  col('re_ba_esp',         'Brachial waveform', 'End-systolic pressure', 'mmHg', 1),
  col('re_ba_dpdt',        'Brachial waveform', 'dP/dt max', 'mmHg/s', 0),
  col('re_ao_ed',          'Aortic waveform', 'Ejection duration', 's', 3,
      [{ tag: 'cST', unit: 'ms' }, { tag: 'cED', unit: '%' }]),
  col('re_ao_esp',         'Aortic waveform', 'End-systolic pressure', 'mmHg', 1,
      [{ tag: 'cESBP', unit: 'mmHg' }]),
  col('re_ao_p1',          'Aortic waveform', 'P1', 'mmHg', 1),
  col('re_ao_p2',          'Aortic waveform', 'P2', 'mmHg', 1),
  col('re_aotr',           'Aortic waveform', 'Reflection time (Tr)', 's', 3),
  col('re_aitype',         'Aortic waveform', 'Murgo type', '', null),
  col('re_ppar',           'Aortic waveform', 'Pulse pressure amplification', 'ratio', 2),
  col('re_ao_ap',          'Aortic waveform', 'Augmented pressure', 'mmHg', 1,
      [{ tag: 'cAP', unit: 'mmHg' }]),
  col('re_pmsys',          'Aortic SEVR', 'Mean systolic pressure', 'mmHg', 1),
  col('re_pmdia',          'Aortic SEVR', 'Mean diastolic pressure', 'mmHg', 1),
  col('re_ao_tti',         'Aortic SEVR', 'Systolic pressure-time integral', 'mmHg·sample', 0),
  col('re_ao_dti',         'Aortic SEVR', 'Diastolic pressure-time integral', 'mmHg·sample', 0),
  col('re_aosevr',         'Aortic SEVR', 'SEVR (Buckberg index)', 'ratio', 3,
      [{ tag: 'cSEVR', unit: '%' }]),
  col('re_aodd',           'Aortic SEVR', 'Diastolic duration', 's', 3,
      [{ tag: 'cDT', unit: 'ms' }]),
  col('re_ao_ai',          'Aortic waveform', 'Augmentation index', '%', 0,
      [{ tag: 'cAIx', unit: '%' }]),
  col('re_ai75',           'Aortic waveform', 'Augmentation index at 75 bpm', '%', 1),
  col('re_aoti',           'Aortic waveform', 'Inflection time (Ti)', 's', 3),
  col('re_ao_ew',          'Aortic waveform', 'Wasted LV pressure energy (Ew)', 'Pa·s', 0),
  col('re_ao_dpdt',        'Aortic waveform', 'dP/dt max', 'mmHg/s', 0),
  col('re_pb',             'Aortic forward and backward pressure', 'Maximum backward pressure (Pb)', 'mmHg', 1),
  col('re_pb_t',           'Aortic forward and backward pressure', 'Time of maximum Pb', 's', 3),
  col('re_pf',             'Aortic forward and backward pressure', 'Maximum forward pressure (Pf)', 'mmHg', 1),
  col('re_pf_t',           'Aortic forward and backward pressure', 'Time of maximum Pf', 's', 3),
  col('re_PbPf',           'Aortic forward and backward pressure', 'Reflection magnitude (Pb/Pf)', 'ratio', 3),
  col('re_ri',             'Aortic forward and backward pressure', 'Reflection index Pb/(Pf+Pb)', 'ratio', 3),
  col('re_intaopr',        'Aortic reservoir', 'Integral of reservoir pressure', 'mmHg·s', 1),
  col('re_maxaopr',        'Aortic reservoir', 'Maximum reservoir pressure', 'mmHg', 1),
  col('re_tmaxaopr',       'Aortic reservoir', 'Time of maximum reservoir pressure', 's', 3),
  col('re_intaoprlessdbp', 'Aortic reservoir', 'Integral of reservoir pressure above DIA', 'mmHg·s', 2),
  col('re_intaoxsp',       'Aortic reservoir', 'Integral of excess pressure', 'mmHg·s', 2),
  col('re_maxaoxsp',       'Aortic reservoir', 'Maximum excess pressure', 'mmHg', 1),
  col('re_tmaxaoxsp',      'Aortic reservoir', 'Time of maximum excess pressure', 's', 3),
  col('re_aopinf',         'Aortic reservoir', 'P∞', 'mmHg', 1),
  col('re_aofita',         'Aortic reservoir', 'Rate constant ka', '1/s', 3),
  col('re_aofitb',         'Aortic reservoir', 'Rate constant kb', '1/s', 3),
  col('re_aorsq',          'Aortic reservoir', 'Diastolic fit R²', '', 3),
  col('re_qcaofit',        'Aortic reservoir', 'Fit quality check (1 = pass)', '', 0),
  col('re_intbapr',        'Brachial reservoir', 'Integral of reservoir pressure', 'mmHg·s', 1),
  col('re_maxbapr',        'Brachial reservoir', 'Maximum reservoir pressure', 'mmHg', 1),
  col('re_tmaxbapr',       'Brachial reservoir', 'Time of maximum reservoir pressure', 's', 3),
  col('re_intbaxsp',       'Brachial reservoir', 'Integral of excess pressure', 'mmHg·s', 2),
  col('re_maxbaxsp',       'Brachial reservoir', 'Maximum excess pressure', 'mmHg', 1),
  col('re_tmaxbap',        'Brachial reservoir', 'Time of maximum excess pressure', 's', 3),
  col('re_bafita',         'Brachial reservoir', 'Rate constant ka', '1/s', 3),
  col('re_bafitb',         'Brachial reservoir', 'Rate constant kb', '1/s', 3),
  col('re_barsq',          'Brachial reservoir', 'Diastolic fit R²', '', 3),
  col('re_bapinf',         'Brachial reservoir', 'P∞', 'mmHg', 1),
  col('re_wf1i',           'Wave intensity', 'Wf1 intensity', 'W/m²/cycle²', null),
  col('re_wf1t',           'Wave intensity', 'Wf1 time', 's', 3),
  col('re_wf1a',           'Wave intensity', 'Wf1 area', 'a.u.', null),
  col('re_wbi',            'Wave intensity', 'Wb intensity', 'W/m²/cycle²', null),
  col('re_wbt',            'Wave intensity', 'Wb time', 's', 3),
  col('re_wba',            'Wave intensity', 'Wb area', 'a.u.', null),
  col('re_wf2i',           'Wave intensity', 'Wf2 intensity', 'W/m²/cycle²', null),
  col('re_wf2t',           'Wave intensity', 'Wf2 time', 's', 3),
  col('re_wf2a',           'Wave intensity', 'Wf2 area', 'a.u.', null),
  col('re_wri',            'Wave intensity', 'Wave reflection index (Wb/Wf1 area)', 'ratio', 3),
  col('re_rhoc',           'Wave intensity', 'Wave speed estimate (c)', 'm/s', 2),
];

/**
 * A value formatted for a table. Strings pass through; a column with no
 * `digits` gets four significant figures, for values whose scale varies.
 */
export function formatValue(value, column) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return String(value);
  if (column.digits === null || column.digits === undefined) {
    return Number(value.toPrecision(4)).toLocaleString('en', { maximumFractionDigits: 20 });
  }
  return value.toFixed(column.digits);
}

/**
 * Results as CSV, with the resdata.xls headers and one row per result.
 * Numbers are written in full; a missing value is an empty cell.
 *
 * @param {Array<Object<string, number|string|null>>} rows  `values` objects
 */
export function resultsCsv(rows) {
  const lines = [COLUMNS.map(c => c.header).join(',')];
  for (const values of rows) {
    lines.push(COLUMNS.map(c => csvCell(values[c.header])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
