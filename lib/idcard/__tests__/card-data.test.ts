import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmergency, cardGaps, toIdCardData, type EmployeeCardRow } from '../card-data.ts';

test('the house convention: Name · Relation · Phone', () => {
  assert.deepEqual(
    parseEmergency('Priya Nair · Spouse · +91 98110 44521'),
    { name: 'Priya Nair', relation: 'Spouse', phone: '+91 98110 44521' },
  );
});

test('the phone is taken from the END, matching what the digital card shows', () => {
  // IdCard.tsx reads it as split('·').pop() — these must not disagree.
  const raw = 'K. Srinivas Reddy · Father · +91 99100 23344';
  assert.equal(parseEmergency(raw).phone, raw.split('·').pop()!.trim());
});

test('commas and pipes are accepted, because nothing enforces the dot', () => {
  assert.deepEqual(
    parseEmergency('Lakshmi Reddy, Spouse, +91 97654 22109'),
    { name: 'Lakshmi Reddy', relation: 'Spouse', phone: '+91 97654 22109' },
  );
  assert.equal(parseEmergency('Rohit Malhotra | Brother | 9820055117').phone, '9820055117');
});

test('two parts: name and phone, or name and relation when nothing is dialable', () => {
  assert.deepEqual(parseEmergency('Anita Bose · 9873310876'),
    { name: 'Anita Bose', relation: null, phone: '9873310876' });
  assert.deepEqual(parseEmergency('Anita Bose · Mother'),
    { name: 'Anita Bose', relation: 'Mother', phone: null });
});

test('one part is a phone if it has digits, a name if it does not', () => {
  assert.deepEqual(parseEmergency('+91 98110 44521'),
    { name: null, relation: null, phone: '+91 98110 44521' });
  assert.deepEqual(parseEmergency('Priya Nair'),
    { name: 'Priya Nair', relation: null, phone: null });
});

test('a relation containing a comma survives being rejoined', () => {
  const e = parseEmergency('Sunil Mehta · Father, retired · 9890133842');
  assert.equal(e.name, 'Sunil Mehta');
  assert.equal(e.phone, '9890133842');
  assert.equal(e.relation, 'Father, retired');
});

test('a trailing part that is not dialable is a relation, not a phone number', () => {
  // The failure this prevents: printing "Spouse" where the number belongs.
  const e = parseEmergency('Meera Mehta · contact via HR · unknown');
  assert.equal(e.phone, null);
  assert.equal(e.name, 'Meera Mehta');
});

test('empty, whitespace and separator-only input degrade quietly', () => {
  for (const raw of [null, undefined, '', '   ', '·', ' · · ']) {
    assert.deepEqual(parseEmergency(raw), { name: null, relation: null, phone: null }, `failed on ${JSON.stringify(raw)}`);
  }
});

test('a short digit string is not mistaken for a phone', () => {
  assert.deepEqual(parseEmergency('Flat 12'), { name: 'Flat 12', relation: null, phone: null });
});

// ── readiness ───────────────────────────────────────────────────────────────

const row = (over: Partial<EmployeeCardRow> = {}): EmployeeCardRow => ({
  id: 'e1', emp_code: 'SRS9010', full_name: 'Shreya Reddy',
  blood_group: 'O+', emergency_contact_1: 'K. Reddy · Father · 9910023344',
  photo_path: 'e1/avatar.jpg', ...over,
});

test('a complete row has no gaps', () => {
  assert.deepEqual(cardGaps(row()), []);
});

test('each gap is reported separately, so one can be chased without the others', () => {
  assert.deepEqual(cardGaps(row({ emergency_contact_1: null })), ['EMERGENCY']);
  assert.deepEqual(cardGaps(row({ blood_group: '  ' })), ['BLOOD']);
  assert.deepEqual(cardGaps(row({ photo_path: null })), ['PHOTO']);
  assert.deepEqual(
    cardGaps(row({ emergency_contact_1: '', blood_group: null, photo_path: null })),
    ['EMERGENCY', 'BLOOD', 'PHOTO'],
  );
});

test('a name with no number still counts as having an emergency contact', () => {
  // Partial is not missing — the card can print who to call even without how.
  assert.deepEqual(cardGaps(row({ emergency_contact_1: 'Priya Nair' })), []);
});

// ── mapping ─────────────────────────────────────────────────────────────────

test('a missing join prints an em dash, never the word undefined', () => {
  const d = toIdCardData({ id: 'e1' });
  assert.equal(d.name, '—');
  assert.equal(d.code, '—');
  assert.equal(d.company, '—');
  assert.equal(d.designation, null);
});

test('the mapping carries the credential and the photo through', () => {
  const d = toIdCardData(
    row({ company_name: 'Sharma Retail Solutions Pvt Ltd', location_name: 'Pune Branch', company_doj: '2022-07-04' }),
    { cardNo: 'SRS-0009010', validTill: '2027-03-31', photoDataUrl: 'data:image/jpeg;base64,xx' },
  );
  assert.equal(d.company, 'Sharma Retail Solutions Pvt Ltd');
  assert.equal(d.location, 'Pune Branch');
  assert.equal(d.doj, '2022-07-04');
  assert.equal(d.cardNo, 'SRS-0009010');
  assert.equal(d.validTill, '2027-03-31');
  assert.equal(d.photoDataUrl, 'data:image/jpeg;base64,xx');
  assert.equal(d.emergencyPhone, '9910023344');
  assert.equal(d.emergencyRelation, 'Father');
});
