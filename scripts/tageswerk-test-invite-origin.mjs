/** Kanonische lokale TEST-App für Einladungslinks. Nicht in die Produktiv-PWA übernehmen. */

export const TAGESWERK_TEST_APP_ORIGIN = 'http://127.0.0.1:5173';
export const TAGESWERK_TEST_APP_URL = 'http://127.0.0.1:5173/';
export const TAGESWERK_PROD_APP_URL = 'https://maximus3039.github.io/tageswerk-test/';
export const TAGESWERK_TEST_PROJECT_REF = 'gamvnzggcrrlnyoknllu';
export const TAGESWERK_PROD_PROJECT_REF = 'eqtrifscedpsngsysxvc';

export function normalizeInviteOrigin(url) {
 const value = String(url || '').trim();
 if (!value) return '';
 try {
  const parsed = new URL(value);
  const path = parsed.pathname === '' ? '/' : parsed.pathname;
  return `${parsed.protocol}//${parsed.host}${path.endsWith('/') ? path : `${path}/`}`;
 } catch {
  return '';
 }
}

export function isAllowedTestInviteRedirect(url) {
 return normalizeInviteOrigin(url) === TAGESWERK_TEST_APP_URL;
}

export function isForbiddenTestInviteRedirect(url) {
 const value = String(url || '').toLowerCase();
 if (!value) return true;
 if (value.includes('github.io')) return true;
 if (value.includes(TAGESWERK_PROD_PROJECT_REF)) return true;
 if (value.includes('localhost')) return true;
 return !isAllowedTestInviteRedirect(url);
}

export const TEST_AUTH_REDIRECT_ALLOWLIST = [
 TAGESWERK_TEST_APP_ORIGIN,
 TAGESWERK_TEST_APP_URL,
 `${TAGESWERK_TEST_APP_ORIGIN}/**`
];
