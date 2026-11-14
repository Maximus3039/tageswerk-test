const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const WMO = {
 0: {label: 'Klar', icon: '☀'},
 1: {label: 'Überwiegend klar', icon: '🌤'},
 2: {label: 'Teilweise bewölkt', icon: '⛅'},
 3: {label: 'Bewölkt', icon: '☁'},
 45: {label: 'Nebel', icon: '🌫'},
 48: {label: 'Reifnebel', icon: '🌫'},
 51: {label: 'Leichter Nieselregen', icon: '🌦'},
 61: {label: 'Leichter Regen', icon: '🌧'},
 63: {label: 'Regen', icon: '🌧'},
 65: {label: 'Starker Regen', icon: '🌧'},
 71: {label: 'Leichter Schnee', icon: '❄'},
 80: {label: 'Regenschauer', icon: '🌦'},
 95: {label: 'Gewitter', icon: '⛈'}
};

function weatherLabel(code) {
 return WMO[code] || {label: 'Wetter', icon: '🌡'};
}

function cacheKey(lat, lon) {
 return `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

export function facilityCoordinates(facility) {
 const lat = Number(facility?.latitude ?? facility?.lat);
 const lon = Number(facility?.longitude ?? facility?.lon);
 if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
  return {lat, lon, source: 'facility', uncertain: false};
 }
 return null;
}

export function looksLikePlaceName(name) {
 const query = String(name || '').trim();
 if (query.length < 3) return false;
 if (/^[0-9a-f-]{8,}$/i.test(query)) return false;
 if (!/[a-zäöüß]/i.test(query)) return false;
 return true;
}

export async function geocodeFacilityName(name) {
 const query = String(name || '').trim();
 if (!looksLikePlaceName(query)) return null;
 const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=1&language=de&format=json`;
 const response = await fetch(url);
 if (!response.ok) throw new Error('Geocoding nicht erreichbar.');
 const data = await response.json();
 const hit = data?.results?.[0];
 if (!hit) return null;
 return {
  lat: hit.latitude,
  lon: hit.longitude,
  source: 'geocode',
  uncertain: true,
  place: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ')
 };
}

export async function resolveFacilityLocation(facility, {allowGeocode = false} = {}) {
 const direct = facilityCoordinates(facility);
 if (direct) return direct;
 if (!allowGeocode) return null;
 return geocodeFacilityName(facility?.name);
}

export async function fetchWeather(lat, lon, {now = Date.now()} = {}) {
 const key = cacheKey(lat, lon);
 const cached = cache.get(key);
 if (cached && now - cached.at < CACHE_MS) return cached.data;
 const url = `${FORECAST_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,weather_code,precipitation,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=Europe%2FBerlin&forecast_days=1`;
 const response = await fetch(url);
 if (!response.ok) throw new Error('Wetterdienst nicht erreichbar.');
 const payload = await response.json();
 const code = Number(payload?.current?.weather_code);
 const meta = weatherLabel(code);
 const data = {
  temperature: payload?.current?.temperature_2m,
  precipitation: payload?.current?.precipitation,
  wind: payload?.current?.wind_speed_10m,
  code,
  label: meta.label,
  icon: meta.icon,
  max: payload?.daily?.temperature_2m_max?.[0],
  min: payload?.daily?.temperature_2m_min?.[0],
  rainChance: payload?.daily?.precipitation_probability_max?.[0],
  rainSum: payload?.daily?.precipitation_sum?.[0],
  observedAt: payload?.current?.time || new Date(now).toISOString(),
  source: 'Open-Meteo',
  kind: 'forecast'
 };
 cache.set(key, {at: now, data});
 return data;
}

export async function weatherForFacility(facility, {allowGeocode = false} = {}) {
 const location = await resolveFacilityLocation(facility, {allowGeocode});
 if (!location) {
  return {
   ok: false,
   error: allowGeocode
    ? 'Für diesen Betrieb konnte kein verlässlicher Standort ermittelt werden.'
    : 'Kein hinterlegter Standort. Wetter erscheint erst mit Koordinaten oder nach ausdrücklicher Standortschätzung.'
  };
 }
 try {
  const weather = await fetchWeather(location.lat, location.lon);
  return {ok: true, weather, location};
 } catch (error) {
  return {ok: false, error: error?.message || 'Wetter konnte nicht geladen werden.'};
 }
}

export function weatherReportLine(weather, location) {
 if (!weather) return '';
 const temp = weather.temperature != null ? `${weather.temperature} °C` : 'Temperatur unklar';
 const rain = weather.rainChance != null ? `${weather.rainChance} % Niederschlagswahrscheinlichkeit` : 'Niederschlag unklar';
 const place = location?.place ? ` (${location.place})` : '';
 const stamp = weather.observedAt ? `, Stand ${String(weather.observedAt).replace('T', ' ')}` : '';
 const uncertain = location?.uncertain || location?.source === 'geocode'
  ? ' Standort geschätzt – bitte prüfen.'
  : '';
 return `Wetter${place}: ${temp}, ${weather.label}, ${rain}. Quelle: ${weather.source} (${weather.kind})${stamp}.${uncertain}`;
}

export function clearWeatherCache() {
 cache.clear();
}
