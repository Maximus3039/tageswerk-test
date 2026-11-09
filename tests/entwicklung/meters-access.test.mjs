import assert from 'node:assert/strict';
import test from 'node:test';
import {membershipAllowsMeterAdmin, membershipAllowsMeterReading, readingInsertPayload, unitsForMedium} from '../../js/meters.js';

const userId = 'user-1';
const facility = {id: 'fac-a', organization_id: 'org-a'};
const otherFacility = {id: 'fac-b', organization_id: 'org-a'};

function membership(role, target = facility, active = true) {
 return {user_id: userId, organization_id: target.organization_id, facility_id: role === 'company_admin' ? null : target.id, role, is_active: active};
}

test('Zähler anlegen bleibt der Leitung des eigenen Betriebs vorbehalten', () => {
 assert.equal(membershipAllowsMeterAdmin(facility, [membership('employee')], userId), false);
 assert.equal(membershipAllowsMeterAdmin(facility, [membership('facility_manager')], userId), true);
 assert.equal(membershipAllowsMeterAdmin(otherFacility, [membership('facility_manager')], userId), false);
 assert.equal(membershipAllowsMeterAdmin(facility, [membership('company_admin')], userId), true);
 assert.equal(membershipAllowsMeterAdmin(facility, [membership('facility_manager', facility, false)], userId), false);
});

test('Ablesungen dürfen Mitarbeiter nur im zugeordneten Betrieb erfassen', () => {
 assert.equal(membershipAllowsMeterReading(facility, [membership('employee')], userId), true);
 assert.equal(membershipAllowsMeterReading(otherFacility, [membership('employee')], userId), false);
 assert.equal(membershipAllowsMeterReading(facility, [membership('employee', facility, false)], userId), false);
});

test('Eine neue Ablesung speichert den Stand und keinen Verbrauch', () => {
 const payload = readingInsertPayload('meter-1', {reading_value: '1250,5', reading_at: '2020-01-01T08:00'});
 assert.deepEqual(Object.keys(payload).sort(), ['meter_id', 'reading_at', 'reading_type', 'reading_value']);
 assert.equal(payload.reading_type, 'regular');
 assert.equal(payload.reading_value, '1250.5');
 assert.equal('consumption_value' in payload, false);
});

test('Einheiten bleiben an die Verbrauchsart gebunden', () => {
 assert.deepEqual(unitsForMedium('electricity'), ['kWh']);
 assert.deepEqual(unitsForMedium('heat'), ['kWh', 'm3']);
 assert.deepEqual(unitsForMedium('unbekannt'), []);
});
