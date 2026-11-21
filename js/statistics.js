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

export function weekBounds(day) {
 const stamp = String(day || '');
 if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return null;
 const date = new Date(`${stamp}T12:00:00Z`);
 const weekday = date.getUTCDay() || 7;
 const start = addCalendarDays(stamp, 1 - weekday);
 return {from: start, to: addCalendarDays(start, 6)};
}

export function statisticsRange(kind, today, custom = {}) {
 if (kind === 'day') return {from: today, to: today, label: 'Tag'};
 if (kind === 'week') {
  const week = weekBounds(today);
  return week ? {...week, label: 'Woche'} : {from: today, to: today, label: 'Woche'};
 }
 if (kind === 'month') return {from: `${String(today).slice(0, 7)}-01`, to: today, label: 'Monat'};
 if (kind === 'year') return {from: `${String(today).slice(0, 4)}-01-01`, to: today, label: 'Jahr'};
 const from = custom.from || today;
 const to = custom.to || today;
 return {from: from <= to ? from : to, to: from <= to ? to : from, label: 'Zeitraum'};
}

export function averageVisitors(sum, counted) {
 if (!counted) return {state: 'missing', value: null};
 return {state: 'value', value: Math.round((Number(sum) / counted) * 10) / 10};
}

export function statisticsSummary(rows, from, to) {
 const visitors = summarizeComparableWindow(rows, from, to, 'visitors', 'priorVisitors');
 const revenue = summarizeComparableWindow(rows, from, to, 'totalCents', 'priorTotalCents');
 const counted = (rows || []).filter(row => row.day >= from && row.day <= to && row.visitors != null).length;
 const avg = averageVisitors(visitors.current, counted);
 const per = revenuePerVisitor(visitors.current, revenue.current);
 const visitorChange = figurePercent(visitors.current, visitors.prior);
 const revenueChange = figurePercent(revenue.current, revenue.prior);
 return {
  from,
  to,
  visitors,
  revenue,
  averageVisitors: avg,
  revenuePerVisitor: per,
  visitorChange,
  revenueChange
 };
}

export function monthBuckets(rows, key) {
 const buckets = new Map();
 for (const row of rows || []) {
  if (!row?.day || row[key] == null) continue;
  const month = String(row.day).slice(0, 7);
  const current = buckets.get(month) || {month, value: 0, counted: 0};
  current.value += row[key];
  current.counted += 1;
  buckets.set(month, current);
 }
 return [...buckets.values()].sort((left, right) => left.month.localeCompare(right.month));
}

export function chartSvg(points, {title = '', width = 320, height = 120} = {}) {
 const values = (points || []).map(point => point.value).filter(value => value != null && Number.isFinite(Number(value)));
 if (!values.length) {
  return `<svg class="mgmt-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title || 'Keine Daten'}"><text x="8" y="20" fill="currentColor">Keine Daten</text></svg>`;
 }
 const max = Math.max(...values);
 const min = Math.min(0, ...values);
 const span = max - min || 1;
 const step = values.length === 1 ? width - 16 : (width - 16) / (values.length - 1);
 const coords = values.map((value, index) => {
  const x = 8 + index * step;
  const y = height - 12 - ((value - min) / span) * (height - 28);
  return `${x.toFixed(1)},${y.toFixed(1)}`;
 });
 return `<svg class="mgmt-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${coords.join(' ')}"/></svg>`;
}

export function statisticsExportRows(rows, from, to) {
 return (rows || []).filter(row => row.day >= from && row.day <= to).map(row => ({
  Tag: row.day,
  Besucher: row.visitors ?? '',
  'Besucher Vorjahr': row.priorVisitors ?? '',
  'Umsatz Cent': row.totalCents ?? '',
  'Umsatz Vorjahr Cent': row.priorTotalCents ?? ''
 }));
}

export function downloadCsv(filename, rows) {
 const keys = rows.length ? Object.keys(rows[0]) : ['Tag'];
 const lines = [keys.join(';')].concat(rows.map(row => keys.map(key => String(row[key] ?? '').replaceAll(';', ',')).join(';')));
 const blob = new Blob(['\uFEFF' + lines.join('\n')], {type: 'text/csv;charset=utf-8'});
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = filename;
 link.click();
 URL.revokeObjectURL(url);
}

export function printStatisticsPdf(title, summary, rows) {
 const win = window.open('', '_blank', 'noopener,noreferrer');
 if (!win) return {ok: false, error: 'Das Druckfenster wurde blockiert.'};
 const table = statisticsExportRows(rows, summary.from, summary.to)
  .map(row => `<tr><td>${row.Tag}</td><td>${row.Besucher}</td><td>${row['Besucher Vorjahr']}</td><td>${row['Umsatz Cent']}</td><td>${row['Umsatz Vorjahr Cent']}</td></tr>`)
  .join('');
 win.document.write(`<!doctype html><title>${title}</title><body><h1>${title}</h1><p>${summary.from} bis ${summary.to}</p><table border="1" cellspacing="0"><tr><th>Tag</th><th>Besucher</th><th>VJ</th><th>Umsatz</th><th>Umsatz VJ</th></tr>${table}</table><script>window.print()<\/script></body>`);
 win.document.close();
 return {ok: true};
}

export function downloadXlsx(filename, rows) {
 const xlsx = globalThis.XLSX;
 if (!xlsx?.utils) return {ok: false, error: 'Excel-Bibliothek nicht geladen.'};
 const sheet = xlsx.utils.json_to_sheet(rows);
 const book = xlsx.utils.book_new();
 xlsx.utils.book_append_sheet(book, sheet, 'Kennzahlen');
 xlsx.writeFile(book, filename);
 return {ok: true};
}
