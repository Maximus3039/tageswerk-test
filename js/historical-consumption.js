import {percentChange} from './consumption-analytics.js';
import {
 berlinToday,
 compareDates,
 dateKey,
 localDateTimeValue,
 mediumUnits,
 parseDateKey,
 readingDraftError,
 readingInsertPayload,
 standError,
 thousandths,
 thousandthsText,
 unitsForMedium
} from './meters-domain.js';

export const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export const SOURCE_LABELS = {
 readings: 'Zählerstände (vollständiger Monat, Vorrang)',
 'readings-partial': 'Zählerstände (Monat unvollständig)',
 monthly: 'Manueller Monatsverbrauch',
 missing: 'Nicht erfasst',
 conflict: 'Doppelte Monatswerte'
};

export const SOURCE_RULE = 'Zählerstände haben Vorrang, sobald der Monat vollständig aus Ablesungen abgedeckt ist. Ein unvollständiger Ablesemonat gilt nicht als vollständiger Monatsverbrauch und wird nicht mit dem manuellen Wert addiert. Der manuelle Monatsverbrauch gilt nur, wenn keine Ablesung den Monat berührt. Fehlende Monate zählen nicht als Nullverbrauch.';

export function berlinDateKey(value) {
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return '';
 const parts = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
 const read = type => parts.find(part => part.type === type)?.value;
 return `${read('year')}-${read('month')}-${read('day')}`;
}

export function daysInMonth(year, month) {
 return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function historicalReadingDraftError(draft, {now, existingDates} = {}) {
 if (!draft?.meterId) return 'Bitte einen Zähler auswählen.';
 const date = parseDateKey(draft.reading_date);
 if (!date) return 'Bitte ein gültiges Ablesedatum eingeben.';
 const today = now || berlinToday();
 if (compareDates(date, today) > 0) return 'Historische Ablesungen müssen in der Vergangenheit liegen.';
 const at = `${draft.reading_date}T12:00`;
 const valueError = readingDraftError({reading_value: draft.reading_value, reading_at: at});
 if (valueError) return valueError;
 const day = dateKey(date);
 if ((existingDates || []).includes(day)) {
  return 'Für dieses Datum liegt bereits eine Ablesung vor. Eine Korrektur läuft über die Historie, nicht durch Überschreiben.';
 }
 const note = String(draft.note || '').trim();
 if (note.length > 2000) return 'Der Kommentar darf höchstens 2000 Zeichen haben.';
 return '';
}

export function historicalReadingPayload(meterId, draft) {
 const noon = new Date(`${draft.reading_date}T12:00:00`);
 return readingInsertPayload(meterId, {
  reading_value: draft.reading_value,
  reading_at: localDateTimeValue(noon),
  note: draft.note
 });
}

export function existingReadingDates(rows, meterId) {
 const dates = [];
 for (const row of rows || []) {
  if (row.meter_id !== meterId) continue;
  if (row.reading_type === 'correction') continue;
  const key = berlinDateKey(row.reading_at);
  if (key) dates.push(key);
 }
 return dates;
}

export function monthlyConsumptionDraftError(draft, {now, existingKeys} = {}) {
 if (!draft?.facilityId) return 'Bitte einen Betrieb auswählen.';
 if (!Object.hasOwn(mediumUnits, draft.medium)) return 'Bitte eine Verbrauchsart auswählen.';
 if (!unitsForMedium(draft.medium).includes(draft.unit)) return 'Diese Einheit ist für die Verbrauchsart nicht zulässig.';
 const year = Number(draft.year);
 const month = Number(draft.month);
 if (!Number.isInteger(year) || year < 1990 || year > 2100) return 'Bitte ein gültiges Jahr eingeben.';
 if (!Number.isInteger(month) || month < 1 || month > 12) return 'Bitte einen Monat auswählen.';
 const today = now || berlinToday();
 if (year > today.y || (year === today.y && month >= today.m)) return 'Der Monat muss in der Vergangenheit liegen.';
 const valueError = standError(draft.consumption_value);
 if (valueError) return valueError.replace('Zählerstand', 'Verbrauch');
 const note = String(draft.note || '').trim();
 if (note.length > 2000) return 'Der Kommentar darf höchstens 2000 Zeichen haben.';
 const meterId = draft.meterId || '';
 const key = monthlyKey({facilityId: draft.facilityId, medium: draft.medium, unit: draft.unit, meterId, year, month});
 if ((existingKeys || []).includes(key)) return 'Für diesen Monat ist bereits ein manueller Verbrauch gespeichert. Es wird nichts überschrieben.';
 return '';
}

export function monthlyKey(row) {
 return [row.facilityId || row.facility_id, row.medium, row.unit, row.meterId || row.meter_id || '', row.year, row.month].join('|');
}

export function monthlyCorrectionDraftError(draft, current) {
 if (!current?.id) return 'Bitte einen gespeicherten Monatswert zur Korrektur auswählen.';
 const valueError = standError(draft.consumption_value);
 if (valueError) return valueError.replace('Zählerstand', 'Verbrauch');
 const note = String(draft.note || '').trim();
 if (note.length > 2000) return 'Der Kommentar darf höchstens 2000 Zeichen haben.';
 const reason = String(draft.correction_reason || '').trim();
 if (reason.length < 3) return 'Bitte einen Korrekturgrund mit mindestens 3 Zeichen angeben.';
 if (reason.length > 2000) return 'Der Korrekturgrund darf höchstens 2000 Zeichen haben.';
 const nextValue = thousandths(String(draft.consumption_value).trim().replace(',', '.'));
 const previousValue = thousandths(String(current.consumption_value ?? '').trim().replace(',', '.'));
 const nextNote = note || '';
 const previousNote = String(current.note || '').trim();
 if (nextValue != null && previousValue != null && nextValue === previousValue && nextNote === previousNote) return 'Die Korrektur muss Verbrauch oder Kommentar ändern.';
 return '';
}

export function monthlyCorrectionPayload(draft) {
 const note = String(draft.note || '').trim();
 return {
  consumption_value: String(draft.consumption_value).trim().replace(',', '.'),
  note: note || null,
  correction_reason: String(draft.correction_reason || '').trim()
 };
}

export function monthlyInsertPayload(draft) {
 const note = String(draft.note || '').trim();
 const meterId = draft.meterId || '';
 return {
  facility_id: draft.facilityId,
  medium: draft.medium,
  unit: draft.unit,
  meter_id: meterId || null,
  year: Number(draft.year),
  month: Number(draft.month),
  consumption_value: String(draft.consumption_value).trim().replace(',', '.'),
  note: note || null
 };
}

function calendarMonthValue(calendarRows, year, month, unit) {
 const prefix = `${year}-${String(month).padStart(2, '0')}`;
 const days = new Set();
 let total = null;
 for (const row of calendarRows || []) {
  const bucket = String(row.bucket_start || row.bucket || '').slice(0, 10);
  if (!bucket.startsWith(prefix)) continue;
  if (unit && row.unit && row.unit !== unit) continue;
  const measured = thousandths(row.measured_value);
  const estimated = thousandths(row.estimated_value);
  if (row.measured_value != null && row.measured_value !== '' && measured == null) return {invalid: true};
  if (row.estimated_value != null && row.estimated_value !== '' && estimated == null) return {invalid: true};
  const part = (measured ?? 0n) + (estimated ?? 0n);
  if (measured == null && estimated == null) continue;
  total = (total ?? 0n) + part;
  days.add(bucket.length === 10 ? bucket : `${prefix}-01`);
 }
 const covered = days.size;
 const complete = covered >= daysInMonth(year, month);
 return {total, covered, complete, partial: covered > 0 && !complete};
}

export function mergeMonthlySources({year, unit, calendarRows, monthlyRows, meterId = ''} = {}) {
 const months = [];
 for (let month = 1; month <= 12; month += 1) {
  const fromReadings = calendarMonthValue(calendarRows, year, month, unit);
  const manuals = (monthlyRows || []).filter(row => {
   if (Number(row.year) !== year || Number(row.month) !== month) return false;
   if (unit && row.unit && row.unit !== unit) return false;
   const rowMeter = row.meter_id || '';
   return meterId ? rowMeter === meterId : !rowMeter;
  });
  if (fromReadings.invalid) {
   months.push({year, month, unit, total: null, source: 'conflict', incomplete: true});
   continue;
  }
  if (fromReadings.complete && fromReadings.total != null) {
   months.push({year, month, unit, total: fromReadings.total, source: 'readings', incomplete: false, coveredDays: fromReadings.covered});
   continue;
  }
  if (fromReadings.partial) {
   months.push({
    year,
    month,
    unit,
    total: fromReadings.total,
    source: 'readings-partial',
    incomplete: true,
    coveredDays: fromReadings.covered
   });
   continue;
  }
  if (manuals.length > 1) {
   months.push({year, month, unit, total: null, source: 'conflict', incomplete: true});
   continue;
  }
  if (manuals.length === 1) {
   const value = thousandths(manuals[0].consumption_value);
   months.push({
    year,
    month,
    unit,
    total: value,
    source: value == null ? 'conflict' : 'monthly',
    incomplete: value == null,
    note: manuals[0].note || '',
    id: manuals[0].id
   });
   continue;
  }
  months.push({year, month, unit, total: null, source: 'missing', incomplete: true});
 }
 return months;
}

export function monthlyStats(months) {
 const covered = (months || []).filter(row => row.total != null && row.incomplete !== true);
 if (!covered.length) return {kind: 'empty', covered: 0, yearTotal: null, avgMonth: null, avgDay: null, incomplete: true};
 const yearTotal = covered.reduce((sum, row) => sum + row.total, 0n);
 const days = covered.reduce((sum, row) => sum + daysInMonth(row.year, row.month), 0);
 return {
  kind: covered.length === 12 ? 'complete' : 'partial',
  covered: covered.length,
  yearTotal,
  avgMonth: yearTotal / BigInt(covered.length),
  avgDay: days ? yearTotal / BigInt(days) : null,
  incomplete: covered.length < 12
 };
}

export function historicalYearKpiLabel(stats) {
 if (!stats || stats.yearTotal == null || stats.kind === 'empty') return 'Erfasster Verbrauch';
 if (stats.kind === 'complete') return 'Jahresverbrauch';
 return `Verbrauch ${stats.covered} von 12 Monaten`;
}

export function historicalMonthAverageLabel(stats) {
 return stats?.kind === 'complete' ? 'Ø Monat' : 'Ø erfasster Monat';
}

export function yearOverYear(currentMonths, previousMonths) {
 const pairs = [];
 for (let month = 1; month <= 12; month += 1) {
  const current = (currentMonths || []).find(row => row.month === month && row.total != null && row.incomplete !== true);
  const previous = (previousMonths || []).find(row => row.month === month && row.total != null && row.incomplete !== true);
  if (!current || !previous) continue;
  pairs.push({month, current: current.total, previous: previous.total});
 }
 if (!pairs.length) return {kind: 'empty', months: 0, delta: null};
 const currentSum = pairs.reduce((sum, row) => sum + row.current, 0n);
 const previousSum = pairs.reduce((sum, row) => sum + row.previous, 0n);
 return {
  kind: pairs.length < 12 ? 'partial' : 'complete',
  months: pairs.length,
  current: currentSum,
  previous: previousSum,
  delta: percentChange(currentSum, previousSum),
  incomplete: pairs.length < 12
 };
}

export function historicalAverage(monthsByYear, month) {
 const values = [];
 for (const rows of Object.values(monthsByYear || {})) {
  const row = (rows || []).find(item => item.month === month && item.total != null);
  if (row) values.push(row.total);
 }
 if (!values.length) return null;
 const sum = values.reduce((total, value) => total + value, 0n);
 return sum / BigInt(values.length);
}

export function formatMonthlyAmount(total, unit) {
 if (total == null) return '—';
 return `${Number(thousandthsText(total)).toLocaleString('de-DE', {maximumFractionDigits: 3})} ${unit || ''}`.trim();
}

export {percentChange, thousandthsText};
