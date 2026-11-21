import {
 aggregateTrend,
 dateKey,
 berlinToday,
 addDays,
 formatAmount,
 thousandthsText,
 trendQuality
} from './meters-domain.js';

export const analyticsMedia = [
 {id: 'electricity', label: 'Strom'},
 {id: 'water', label: 'Wasser'},
 {id: 'heat', label: 'Fernwärme'},
 {id: 'gas', label: 'Gas'}
];

export function analyticsWindow(range, now = berlinToday()) {
 if (range === 'day') {
  return {from: dateKey(now), to: dateKey(now), grain: 'day', compareFrom: dateKey(addDays(now, -1)), compareTo: dateKey(addDays(now, -1))};
 }
 if (range === 'week') {
  const from = addDays(now, -6);
  const compareTo = addDays(from, -1);
  const compareFrom = addDays(compareTo, -6);
  return {from: dateKey(from), to: dateKey(now), grain: 'day', compareFrom: dateKey(compareFrom), compareTo: dateKey(compareTo)};
 }
 if (range === 'yoy') {
  const from = {y: now.y - 1, m: now.m, d: now.d};
  return {
   from: dateKey(from),
   to: dateKey(now),
   grain: 'month',
   compareFrom: dateKey({y: now.y - 2, m: now.m, d: now.d}),
   compareTo: dateKey(addDays(from, -1))
  };
 }
 if (range === 'year') {
  const from = {y: now.y, m: 1, d: 1};
  return {
   from: dateKey(from),
   to: dateKey(now),
   grain: 'month',
   compareFrom: dateKey({y: now.y - 1, m: 1, d: 1}),
   compareTo: dateKey({y: now.y - 1, m: now.m, d: now.d})
  };
 }
 const from = addDays(now, -29);
 const compareTo = addDays(from, -1);
 const compareFrom = addDays(compareTo, -29);
 return {
  from: dateKey(from),
  to: dateKey(now),
  grain: 'day',
  compareFrom: dateKey(compareFrom),
  compareTo: dateKey(compareTo)
 };
}

function pointTotal(point) {
 if (point?.invalid || point?.total == null) return null;
 return point.total;
}

export function sumPoints(points) {
 let total = 0n;
 let has = false;
 let estimated = false;
 let measured = false;
 let invalid = false;
 for (const point of points || []) {
  if (point.invalid) {
   invalid = true;
   continue;
  }
  if (point.estimated != null) estimated = true;
  if (point.measured != null) measured = true;
  const value = pointTotal(point);
  if (value == null) continue;
  total += value;
  has = true;
 }
 if (!has) return {kind: invalid ? 'invalid' : 'empty'};
 return {
  kind: estimated && measured ? 'mixed' : estimated ? 'estimated' : 'measured',
  total,
  estimated,
  measured
 };
}

export function percentChange(current, previous) {
 if (current == null || previous == null || previous === 0n) return null;
 const delta = Number(current - previous) / Number(previous) * 100;
 if (!Number.isFinite(delta)) return null;
 return delta;
}

export function spikeFlags(points, {threshold = 0.5} = {}) {
 const flags = [];
 const usable = (points || []).filter(point => !point.invalid && point.total != null);
 for (let index = 1; index < usable.length; index += 1) {
  const prev = usable[index - 1].total;
  const curr = usable[index].total;
  if (prev == null || prev === 0n || curr == null) continue;
  const change = Number(curr - prev) / Number(prev);
  if (Math.abs(change) >= threshold) {
   flags.push({
    bucket: usable[index].bucket,
    change,
    quality: trendQuality(usable[index])
   });
  }
 }
 return flags;
}

export function buildAnalytics(calendarRows, {medium, meterId = '', range = 'month', now = berlinToday()} = {}) {
 const window = analyticsWindow(range, now);
 const rows = (calendarRows || []).filter(row => row.medium === medium && (!meterId || row.meter_id === meterId));
 const trend = aggregateTrend(rows, Boolean(meterId));
 const group = trend.groups[0];
 const points = group?.points || [];
 const inRange = points.filter(point => point.bucket >= window.from && point.bucket <= window.to);
 const compare = points.filter(point => point.bucket >= window.compareFrom && point.bucket <= window.compareTo);
 const current = sumPoints(inRange);
 const previous = sumPoints(compare);
 const unit = group?.unit || '';
 const delta = current.kind !== 'empty' && current.kind !== 'invalid' && previous.kind !== 'empty' && previous.kind !== 'invalid'
  ? percentChange(current.total, previous.total)
  : null;
 return {
  window,
  unit,
  current,
  previous,
  delta,
  points: inRange,
  spikes: spikeFlags(inRange),
  hiddenSubmeters: trend.hiddenSubmeters === true,
  qualityLabel: current.kind === 'estimated' || current.kind === 'mixed' ? 'Enthält Schätzungen' : current.kind === 'measured' ? 'Gemessen' : current.kind === 'invalid' ? 'Unklar' : 'Keine Daten'
 };
}

export function formatAnalyticsValue(summary, unit) {
 if (!summary || summary.kind === 'empty') return '—';
 if (summary.kind === 'invalid') return 'Unklar';
 return formatAmount(thousandthsText(summary.total), unit) || '—';
}

export function formatDelta(delta) {
 if (delta == null) return {text: 'kein Vergleich', tone: 'delta-flat'};
 const rounded = Math.round(delta * 10) / 10;
 if (rounded > 0) return {text: `+${rounded} %`, tone: 'delta-up'};
 if (rounded < 0) return {text: `${rounded} %`, tone: 'delta-down'};
 return {text: '0 %', tone: 'delta-flat'};
}

export function sparkHeights(points, slots = 14) {
 const list = (points || []).slice(-slots);
 if (!list.length) return Array.from({length: slots}, () => ({height: 4, estimate: false, empty: true}));
 const values = list.map(point => (point.invalid || point.total == null ? null : Number(point.total)));
 const max = Math.max(1, ...values.filter(value => value != null));
 return list.map(point => {
  if (point.invalid || point.total == null) return {height: 4, estimate: false, empty: true};
  const height = Math.max(6, Math.round(Number(point.total) / max * 72));
  return {height, estimate: point.estimated != null && point.measured == null, empty: false};
 });
}
