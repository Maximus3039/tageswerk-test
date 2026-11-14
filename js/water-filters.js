import {facilityVisibleToMember, membershipCoversFacility, waterHistoryRole} from './permissions.js';

export function canManageWaterFilters(facility, memberships) {
 return (memberships || []).some(membership => membershipCoversFacility(facility, membership, false));
}

export function canRecordWaterFilterFlush(facility, memberships) {
 return facilityVisibleToMember(facility, memberships);
}

export function canReadWaterFilterFlushHistory(facility, memberships) {
 return waterHistoryRole(facility, memberships);
}

export function canCorrectWaterFilterFlush(facility, memberships) {
 return canManageWaterFilters(facility, memberships);
}

export function waterFilterDraftError(draft) {
 const name = String(draft?.name ?? '').trim();
 if (!draft?.poolId) return 'Bitte ein Becken wählen.';
 if (name.length < 1 || name.length > 200) return 'Bitte eine Filterbezeichnung mit 1 bis 200 Zeichen eintragen.';
 return '';
}

export function waterFilterFlushDraftError(draft, now = new Date()) {
 if (!draft?.filterId) return 'Bitte einen Filter wählen.';
 const note = String(draft?.note ?? '');
 if (note.length > 2000) return 'Die Bemerkung darf höchstens 2000 Zeichen haben.';
 if (!draft?.flushedAt) return '';
 const flushed = new Date(draft.flushedAt);
 if (Number.isNaN(flushed.getTime())) return 'Der Spülzeitpunkt ist ungültig.';
 const stamp = now instanceof Date ? now : new Date(now);
 if (flushed.getTime() > stamp.getTime()) return 'Ein zukünftiger Spülzeitpunkt ist nicht zulässig.';
 if (flushed.getTime() < stamp.getTime() - 24 * 60 * 60 * 1000) {
  return 'Eine nachträgliche Spülung ist höchstens 24 Stunden zulässig.';
 }
 return '';
}

export function waterFilterFlushCorrectionDraftError(draft, original) {
 const reason = String(draft?.reason ?? '').trim();
 if (reason.length < 3 || reason.length > 2000) return 'Bitte eine Begründung mit 3 bis 2000 Zeichen angeben.';
 if (!draft?.filterId) return 'Bitte einen Filter wählen.';
 const note = String(draft?.note ?? '');
 if (note.length > 2000) return 'Die Bemerkung darf höchstens 2000 Zeichen haben.';
 if (!draft?.flushedAt) return 'Bitte einen Spülzeitpunkt angeben.';
 const flushed = new Date(draft.flushedAt);
 if (Number.isNaN(flushed.getTime())) return 'Der Spülzeitpunkt ist ungültig.';
 if (flushed.getTime() > Date.now()) return 'Ein zukünftiger Spülzeitpunkt ist nicht zulässig.';
 if (
  String(draft.filterId) === String(original?.filterId || '')
  && String(draft.flushedAt) === String(original?.flushedAt || '')
  && String(draft.note ?? '') === String(original?.note ?? '')
 ) {
  return 'Es wurde keine Änderung angegeben.';
 }
 return '';
}

export function filtersForPool(filters, poolId, {includeInactive = false} = {}) {
 return (filters || [])
  .filter(filter => filter.poolId === poolId && (includeInactive || filter.active !== false))
  .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'de'));
}

export function flushesForFilter(flushes, filterId) {
 return (flushes || [])
  .filter(flush => flush.filterId === filterId)
  .sort((left, right) => String(right.flushedAt || '').localeCompare(String(left.flushedAt || '')));
}

export function flushesForFacility(flushes, facilityId) {
 return (flushes || [])
  .filter(flush => flush.facilityId === facilityId)
  .sort((left, right) => String(right.flushedAt || '').localeCompare(String(left.flushedAt || '')));
}

export function flushCorrectionMark(flush) {
 if (flush?.isCorrected === true || flush?.correctedAt || Number(flush?.correctionCount) > 0) return 'Korrigiert';
 return '';
}

export function waterFilterStatusDraftError(draft) {
 const reason = String(draft?.reason ?? '').trim();
 if (reason.length < 3 || reason.length > 2000) return 'Bitte eine Begründung mit 3 bis 2000 Zeichen angeben.';
 if (typeof draft?.active !== 'boolean') return 'Der neue Status fehlt.';
 return '';
}

export function waterFilterInsertPayload(facility, draft, actor) {
 return {
  organization_id: facility.organization_id,
  facility_id: facility.id,
  pool_id: draft.poolId,
  name: String(draft.name || '').trim(),
  active: draft.active !== false,
  created_by: actor?.userId
 };
}

export function waterFilterFlushInsertPayload(facility, draft) {
 const payload = {
  organization_id: facility.organization_id,
  facility_id: facility.id,
  filter_id: draft.filterId,
  note: String(draft.note || '').trim()
 };
 if (draft.flushedAt) payload.flushed_at = draft.flushedAt;
 return payload;
}

export function waterFilterFlushCorrectionArgs(flushId, draft) {
 return {
  p_flush_id: flushId,
  p_filter_id: draft.filterId,
  p_flushed_at: draft.flushedAt,
  p_note: String(draft.note || '').trim(),
  p_reason: String(draft.reason || '').trim()
 };
}
