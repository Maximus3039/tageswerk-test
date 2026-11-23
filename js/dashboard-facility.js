export function consumptionFacilitiesAvailable(facilities) {
 return Array.isArray(facilities) && facilities.length > 0;
}

export function chosenConsumptionFacilityId(facilities, {previous, dashboard, touched} = {}) {
 const list = facilities || [];
 if (!list.length) return '';
 if (touched && list.some(item => item.id === previous)) return previous;
 if (dashboard && dashboard !== 'all' && list.some(item => item.id === dashboard)) return dashboard;
 return list[0].id;
}
