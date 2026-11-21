import {
 addCalendarDays,
 compareCalendarDay,
 figurePercent,
 figureWeekday,
 formatCents
} from './operations.js';

export function revenuePerVisitor(visitors, cents) {
 if (visitors == null || cents == null) return {state: 'missing', label: 'Keine Vergleichsdaten'};
 if (visitors === 0) return {state: 'undefined', label: 'Nicht berechenbar'};
 return {state: 'value', cents: Math.round(Number(cents) / Number(visitors)), label: formatCents(Math.round(Number(cents) / Number(visitors)))};
}

export function yearBounds(day) {
 const year = String(day || '').slice(0, 4);
 if (!/^\d{4}$/.test(year)) return null;
 return {start: `${year}-01-01`, end: `${year}-12-31`, year};
}

function recordMap(records) {
 return new Map((records || []).map(row => [row.day, row]));
}

function sumKey(records, start, end, key) {
 const byDay = recordMap(records);
 let sum = 0;
 let counted = 0;
 let missing = 0;
 let cursor = start;
 while (cursor <= end) {
  const value = byDay.get(cursor)?.[key];
  if (value == null) missing += 1;
  else {
   sum += value;
   counted += 1;
  }
  cursor = addCalendarDays(cursor, 1);
 }
 return {sum, counted, missing};
}

export function summarizeComparableWindow(rows, from, to, currentKey, priorKey) {
 if (!from || !to || from > to) return {state: 'missing', current: null, prior: null, missingCurrent: 0, missingPrior: 0};
 const byDay = recordMap(rows);
 let current = 0;
 let prior = 0;
 let counted = 0;
 let priorCounted = 0;
 let missingCurrent = 0;
 let missingPrior = 0;
 let cursor = from;
 while (cursor <= to) {
  const row = byDay.get(cursor) || {};
  if (row[currentKey] == null) missingCurrent += 1;
  else {
   current += row[currentKey];
   counted += 1;
  }
  if (row[priorKey] == null) missingPrior += 1;
  else {
   prior += row[priorKey];
   priorCounted += 1;
  }
  cursor = addCalendarDays(cursor, 1);
 }
 if (!counted && !priorCounted) return {state: 'missing', current: null, prior: null, missingCurrent, missingPrior};
 if (missingCurrent || missingPrior) {
  return {state: 'incomplete', current: counted ? current : null, prior: priorCounted ? prior : null, missingCurrent, missingPrior};
 }
 return {state: 'complete', current, prior, missingCurrent: 0, missingPrior: 0};
}

export function comparableYearToDate(today) {
 const bounds = yearBounds(today);
 if (!bounds) return null;
 return {from: bounds.start, to: today, priorFrom: compareCalendarDay(bounds.start), priorTo: compareCalendarDay(today)};
}

export function yearEndForecast(records, today, key = 'visitors') {
 const bounds = yearBounds(today);
 if (!bounds) return {state: 'missing', label: 'Kein Bezugsdatum'};
 const actual = sumKey(records, bounds.start, today, key);
 const restStart = addCalendarDays(today, 1);
 if (restStart > bounds.end) {
  if (!actual.counted) return {state: 'missing', label: 'Keine erfassten Werte'};
  return {
   state: actual.missing ? 'incomplete' : 'complete',
   actual: actual.sum,
   rest: 0,
   total: actual.sum,
   missingActual: actual.missing,
   missingRest: 0,
   method: 'weekday-364',
   label: actual.missing ? `Erfasst, ${actual.missing} Tage ohne Wert.` : 'Jahreswert vollständig erfasst.'
  };
 }
 const rest = sumKey(records, restStart, bounds.end, key);
 const restFromPrior = sumKey(
  (records || []).map(row => ({...row, day: addCalendarDays(row.day, 364)})),
  restStart,
  bounds.end,
  key
 );
 const priorRest = [];
 let cursor = restStart;
 let missingRest = 0;
 const byDay = recordMap(records);
 while (cursor <= bounds.end) {
  const priorDay = compareCalendarDay(cursor);
  const value = byDay.get(priorDay)?.[key];
  if (value == null) missingRest += 1;
  else priorRest.push(value);
  cursor = addCalendarDays(cursor, 1);
 }
 if (!actual.counted || priorRest.length < 14) {
  return {
   state: 'insufficient',
   actual: actual.counted ? actual.sum : null,
   rest: null,
   total: null,
   missingActual: actual.missing,
   missingRest,
   method: 'weekday-364',
   label: 'Zu wenig Vergleichswerte für eine Jahresprognose.'
  };
 }
 const restSum = priorRest.reduce((sum, value) => sum + value, 0);
 return {
  state: missingRest ? 'partial' : 'ok',
  actual: actual.sum,
  rest: restSum,
  total: actual.sum + restSum,
  missingActual: actual.missing,
  missingRest,
  method: 'weekday-364',
  weekday: figureWeekday(today).name,
  label: missingRest
   ? `Prognose mit ${missingRest} fehlenden Vorjahres-Tagen. Resttage nutzen denselben Wochentag vor 364 Tagen.`
   : 'Restjahr aus denselben Wochentagen vor 364 Tagen. Kein KI-Modell.',
  unusedCurrentRest: rest,
  unusedShifted: restFromPrior
 };
}
