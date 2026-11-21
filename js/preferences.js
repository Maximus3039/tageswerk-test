const AUTO_ALERTS = 'tageswerk-auto-alert-windows';
const FACILITY_LOCATIONS = 'tageswerk-facility-locations-v1';

function storageOf(storage) {
 return storage || globalThis.localStorage;
}

function userKey(name, userId) {
 return `${name}:${userId || 'anon'}`;
}

export function personalAlertPreferenceKey(userId) {
 return userKey(AUTO_ALERTS, userId);
}

export function autoAlertWindowsEnabled(userId, storage) {
 try {
  return storageOf(storage).getItem(userKey(AUTO_ALERTS, userId)) !== '0';
 } catch {
  return true;
 }
}

export function setAutoAlertWindowsEnabled(userId, enabled, storage) {
 storageOf(storage).setItem(userKey(AUTO_ALERTS, userId), enabled ? '1' : '0');
}

export function readFacilityLocations(storage) {
 try {
  const raw = storageOf(storage).getItem(FACILITY_LOCATIONS);
  const parsed = raw ? JSON.parse(raw) : {};
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
 } catch {
  return {};
 }
}

export function storedFacilityLocation(facilityId, storage) {
 const row = readFacilityLocations(storage)[facilityId];
 if (!row) return null;
 const lat = Number(row.lat);
 const lon = Number(row.lon);
 if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
 return {
  lat,
  lon,
  source: row.source === 'geocode' ? 'geocode' : 'stored',
  uncertain: row.uncertain === true || row.source === 'geocode',
  place: String(row.place || '')
 };
}

export function writeFacilityLocation(facilityId, location, storage) {
 if (!facilityId || !location) return;
 const all = readFacilityLocations(storage);
 all[facilityId] = {
  lat: location.lat,
  lon: location.lon,
  source: location.source || 'stored',
  uncertain: location.uncertain === true,
  place: location.place || ''
 };
 storageOf(storage).setItem(FACILITY_LOCATIONS, JSON.stringify(all));
}
