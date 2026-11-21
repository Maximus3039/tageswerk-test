const STORAGE = 'tageswerk-notice-acks';
const memoryAcks = new Map();

export const NOTICE_RANK = {
 'defect-overdue': 10,
 'inspection-overdue': 9,
 'maintenance-overdue': 8,
 'stock-low': 7,
 'temperature-warning': 7,
 'water-warning': 7,
 'consumption-spike': 6,
 'procurement-open': 5,
 'temperature-missing': 5,
 'water-missing': 5,
 'defect-new': 4
};

export function noticeRank(notice) {
 const rank = NOTICE_RANK[notice?.kind] || 0;
 return notice?.warn ? rank + 20 : rank;
}

export function readNoticeAcks(userId) {
 const key = userId || 'anon';
 try {
  const raw = localStorage.getItem(`${STORAGE}:${key}`);
  const parsed = raw ? JSON.parse(raw) : memoryAcks.get(key) || [];
  return Array.isArray(parsed) ? parsed : [];
 } catch {
  return memoryAcks.get(key) || [];
 }
}

export function writeNoticeAcks(userId, ids) {
 const key = userId || 'anon';
 const value = [...new Set(ids)];
 memoryAcks.set(key, value);
 try {
  localStorage.setItem(`${STORAGE}:${key}`, JSON.stringify(value));
 } catch {
  return value;
 }
 return value;
}

export function acknowledgeNotice(userId, noticeId) {
 const next = [...readNoticeAcks(userId), noticeId];
 writeNoticeAcks(userId, next);
 return next;
}

export function restoreNotice(userId, noticeId) {
 writeNoticeAcks(userId, readNoticeAcks(userId).filter(id => id !== noticeId));
}

export function sortNotices(notices) {
 return [...(notices || [])].sort((left, right) => noticeRank(right) - noticeRank(left) || String(left.title || '').localeCompare(String(right.title || ''), 'de'));
}

export function visibleNotices(notices, {userId, includeAcknowledged = false} = {}) {
 const acks = new Set(readNoticeAcks(userId));
 const open = (notices || []).filter(notice => includeAcknowledged || !acks.has(notice.id));
 return sortNotices(open);
}

export function consumptionSpikeNotices(facilities, spikesByFacility) {
 const notices = [];
 for (const facility of facilities || []) {
  const spikes = spikesByFacility?.[facility.id] || [];
  for (const spike of spikes) {
   notices.push({
    id: `consumption-spike:${facility.id}:${spike.medium}:${spike.bucket}`,
    facilityId: facility.id,
    organizationId: facility.organization_id,
    kind: 'consumption-spike',
    title: `Verbrauch ${spike.label || spike.medium}`,
    detail: `Unplausibler Sprung am ${spike.bucket}. Der Wert wird nicht als 0 ersetzt.`,
    warn: true
   });
  }
 }
 return notices;
}
