import assert from 'node:assert/strict';
import test from 'node:test';
import {moreHubItems} from '../../js/mobile-ux.js';
import {state} from '../../js/state.js';

test('Mehr-Menü blendet Management für Mitarbeiter aus', () => {
 state.myMemberships = [{role: 'employee', is_active: true, organization_id: 'org', facility_id: 'fac'}];
 state.organizations = [{id: 'org', name: 'Org'}];
 const facilities = [{id: 'fac', organization_id: 'org', name: 'Nord'}];
 const groups = moreHubItems(state.myMemberships, facilities);
 assert.equal(groups.some(group => group.items.some(item => item.id === 'open-management-dashboard')), false);
 assert.equal(groups.some(group => group.id === 'betrieb'), true);
});

test('Mehr-Menü zeigt Verwaltung für die Geschäftsführung', () => {
 state.myMemberships = [{role: 'company_admin', is_active: true, organization_id: 'org', facility_id: null}];
 state.organizations = [{id: 'org', name: 'Org'}];
 const facilities = [{id: 'fac', organization_id: 'org', name: 'Nord'}];
 const groups = moreHubItems(state.myMemberships, facilities);
 assert.equal(groups.some(group => group.items.some(item => item.id === 'open-management-dashboard')), true);
 assert.equal(groups.some(group => group.items.some(item => item.admin)), true);
});
