const OPEN = ['open', 'in_progress', 'pending_review'];
const PRIORITY_RANK = {critical: 0, high: 1, normal: 2, low: 3};
export const DASHBOARD_DEFECT_LIMIT = 10;
export const DEFECT_FACILITY_ALL = 'all';

export function defectSection(defect) {
 if (defect?.archived_at) return 'archive';
 if (defect?.status === 'resolved') return 'done';
 return 'open';
}

export function isActiveDefect(defect) {
 return defectSection(defect) === 'open' && OPEN.includes(defect?.status || 'open');
}

export function sectionDefects(defects, section) {
 return (defects || []).filter(defect => defectSection(defect) === section);
}

export function activeDefects(defects) {
 return (defects || []).filter(isActiveDefect);
}

export function myActiveDefects(defects, userId) {
 if (!userId) return [];
 return activeDefects(defects).filter(defect => defect.assigned_to === userId);
}

export function sortByPriorityThenAge(defects) {
 return [...(defects || [])].sort((left, right) =>
  (PRIORITY_RANK[left.priority] ?? 2) - (PRIORITY_RANK[right.priority] ?? 2)
  || new Date(left.created_at || 0) - new Date(right.created_at || 0)
 );
}

export function dashboardRecentDefects(defects, limit = DASHBOARD_DEFECT_LIMIT) {
 return sortByPriorityThenAge(activeDefects(defects)).slice(0, limit);
}

export function dashboardMineDefects(defects, userId, limit = DASHBOARD_DEFECT_LIMIT) {
 return sortByPriorityThenAge(myActiveDefects(defects, userId)).slice(0, limit);
}

export function sectionCounts(defects) {
 return {
  open: sectionDefects(defects, 'open').length,
  done: sectionDefects(defects, 'done').length,
  archive: sectionDefects(defects, 'archive').length
 };
}

export function archiveHeading(count, open) {
 return `${open ? '▼' : '▶'} Archiv (${count})`;
}

export function matchesArchiveQuery(defect, query) {
 const text = String(query || '').trim().toLocaleLowerCase('de');
 if (!text) return true;
 return `${defect?.title || ''} ${defect?.description || ''}`.toLocaleLowerCase('de').includes(text);
}

export function completionStamp(defect) {
 return defect?.resolved_at || defect?.created_at || '';
}

export function sortByCompletion(defects) {
 return [...(defects || [])].sort((left, right) => String(completionStamp(right)).localeCompare(String(completionStamp(left))));
}

export function completionText(defect) {
 const closed = defect?.resolved_at ? new Date(defect.resolved_at) : null;
 if (closed && !Number.isNaN(closed.getTime())) return `Abgeschlossen am ${closed.toLocaleString('de-DE')}`;
 const created = defect?.created_at ? new Date(defect.created_at) : null;
 if (created && !Number.isNaN(created.getTime())) return `Erfasst am ${created.toLocaleString('de-DE')}`;
 return '';
}

export function closedInFacility(defects, facilityId) {
 return (defects || []).filter(defect => defect.facility_id === facilityId && defect.status === 'resolved' && !defect.archived_at);
}

export function archiveConfirmation(count, facilityName) {
 const noun = count === 1 ? 'abgeschlossenen Mangel' : 'abgeschlossene Mängel';
 return `Alle ${count} ${noun} von ${facilityName} archivieren?`;
}

export function openStatuses() {
 return [...OPEN];
}

export function defectFacilityOptions(facilities) {
 return [...(facilities || [])].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'de'));
}

export function resolveDefectFacilityFilter(filter, facilities) {
 if (filter === DEFECT_FACILITY_ALL || filter == null || filter === '') return DEFECT_FACILITY_ALL;
 return (facilities || []).some(facility => facility.id === filter) ? filter : DEFECT_FACILITY_ALL;
}

export function filterDefectsByFacility(defects, facilityFilter) {
 const selected = facilityFilter || DEFECT_FACILITY_ALL;
 if (selected === DEFECT_FACILITY_ALL) return [...(defects || [])];
 return (defects || []).filter(defect => defect.facility_id === selected);
}

export function visibleDefectsForMode(defects, mode, userId) {
 return (defects || []).filter(defect => {
  if (mode === 'mine') return defect.assigned_to === userId && isActiveDefect(defect);
  if (mode === 'open') return isActiveDefect(defect);
  if (mode === 'review') return defect.status === 'pending_review' && isActiveDefect(defect);
  return true;
 });
}

export function scopeDefects(defects, {facilityFilter = DEFECT_FACILITY_ALL, mode = 'all', userId = null} = {}) {
 const scoped = filterDefectsByFacility(defects, facilityFilter);
 if (mode === 'all') return scoped;
 return visibleDefectsForMode(scoped, mode, userId);
}
