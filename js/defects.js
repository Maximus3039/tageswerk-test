const OPEN = ['open', 'in_progress', 'pending_review'];

export function defectSection(defect) {
 if (defect?.archived_at) return 'archive';
 if (defect?.status === 'resolved') return 'done';
 return 'open';
}

export function sectionDefects(defects, section) {
 return (defects || []).filter(defect => defectSection(defect) === section);
}

export function sectionCounts(defects) {
 return {
  open: sectionDefects(defects, 'open').length,
  done: sectionDefects(defects, 'done').length,
  archive: sectionDefects(defects, 'archive').length
 };
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
