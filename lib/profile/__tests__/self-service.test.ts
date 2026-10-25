import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fixActionFor, checkAadhaar, checkPan, checkUan, checkIfsc, checkPin, normaliseMobile,
  formatAddress, parseAddress, formatBank, parseBank, checkNominees, nomineeTotal,
  parseEmergency, formatEmergency, checkFieldValue, goesTo, addressOneLine,
} from '../self-service.ts';

// The exact sentences profile_completeness() (091) emits. If the function is
// reworded, this is the test that says Fix stopped knowing what to open.
const SENTENCES: [string, string][] = [
  ['Upload a passport size photo', 'photo'],
  ['Add your PAN', 'pan'],
  ['Add your Aadhaar', 'aadhaar'],
  ['Add your UAN', 'uan'],
  ['Add your salary account', 'bank'],
  ['Add your present address', 'present_address'],
  ['Add your permanent address', 'permanent_address'],
  ['Add an emergency contact', 'emergency'],
  ['Add your blood group', 'blood_group'],
  ['Add a provident fund nominee', 'nominee_pf'],
  ['Add a gratuity nominee — the shares must total 100%', 'nominee_gratuity'],
  ['Upload your onboarding documents', 'documents'],
];

test('every completeness sentence maps to its own editor — never the same one', () => {
  for (const [s, want] of SENTENCES) assert.equal(fixActionFor(s), want, s);
  assert.equal(new Set(SENTENCES.map(([s]) => fixActionFor(s))).size, SENTENCES.length);
});

test('an unknown sentence has no editor rather than a wrong one', () => {
  assert.equal(fixActionFor('Something new HR added'), null);
});

test('Aadhaar: 12 digits, not 0/1 first, Verhoeff checksum', () => {
  assert.equal(checkAadhaar('2345 6789 0124'), null);
  assert.match(checkAadhaar('2345678901')!, /12 digits/);
  assert.match(checkAadhaar('123456789012')!, /never starts/);
  assert.match(checkAadhaar('234567890125')!, /not a valid/);   // one digit off
});

test('PAN, UAN, IFSC and PIN formats', () => {
  assert.equal(checkPan('abcde1234f'), null);
  assert.ok(checkPan('ABCD1234F'));
  assert.equal(checkUan('1001 2345 6789'), null);
  assert.ok(checkUan('12345'));
  assert.equal(checkIfsc('hdfc0575460'), null);
  assert.ok(checkIfsc('HDFC1575460'));          // fifth character must be 0
  assert.equal(checkPin('560038'), null);
  assert.ok(checkPin('060038'));
});

test('mobile numbers are normalised the way people type them', () => {
  assert.equal(normaliseMobile('+91 98765 43210').value, '9876543210');
  assert.equal(normaliseMobile('09876543210').value, '9876543210');
  assert.ok(normaliseMobile('5876543210').error);
});

test('an address survives the trip through a change request', () => {
  const a = { line1: 'Flat 402, Tower C', line2: 'Sector 54', city: 'Gurugram', state: 'Haryana', pin: '122002' };
  assert.deepEqual(parseAddress(formatAddress(a)), a);
  assert.deepEqual(parseAddress(formatAddress({ ...a, line2: '' })), { ...a, line2: '' });
  assert.equal(parseAddress('free text someone typed'), null);
  assert.equal(addressOneLine(a), 'Flat 402, Tower C, Sector 54, Gurugram, Haryana 122002');
});

test('a bank account survives the trip, and a malformed one is refused', () => {
  const b = { bank_name: 'HDFC Bank', account: '045838224156', ifsc: 'HDFC0575460', holder: 'Riya Nair' };
  assert.deepEqual(parseBank(formatBank(b)), b);
  assert.equal(parseBank('Bank: X\nAccount: 12\nIFSC: BAD\nHolder: Y'), null);
});

test('nominee shares must total exactly 100%', () => {
  const r = (name: string, share: string) => ({ name, relation: 'Spouse', dob: '', share });
  assert.equal(checkNominees([r('A', '60'), r('B', '40')]), null);
  assert.match(checkNominees([r('A', '60'), r('B', '30')])!, /90%/);
  assert.match(checkNominees([r('A', '50'), r('a', '50')])!, /twice/);
  assert.equal(nomineeTotal([r('A', '33.33'), r('B', '33.33'), r('C', '33.34')]), 100);
});

test('emergency contacts keep the format IdCard already reads', () => {
  const e = { name: 'Neha Sharma', relation: 'Spouse', mobile: '9812345671' };
  assert.equal(formatEmergency(e), 'Neha Sharma · Spouse · 9812345671');
  assert.deepEqual(parseEmergency(formatEmergency(e)), e);
});

test('generic fields are validated and normalised server-side too', () => {
  assert.equal(checkFieldValue('mobile', '+91 9876543210').value, '9876543210');
  assert.ok(checkFieldValue('personal_email', 'nope').error);
  assert.ok(checkFieldValue('blood_group', 'Z+').error);
  assert.equal(checkFieldValue('blood_group', 'AB-').error, null);
  assert.ok(checkFieldValue('marriage_date', '2999-01-01').error);
});

test('who a request goes to is said in words', () => {
  const a = { l1: { name: 'Pooja Verma', code: 'X1' }, hr: { name: 'Asha Rao', code: 'H1' }, payroll: null };
  assert.equal(goesTo('spouse_name', a).summary, 'Line manager — Pooja Verma, then HR — Asha Rao');
  assert.equal(goesTo('salary_account', a).summary, 'Payroll team');
  assert.equal(goesTo('present_address', { ...a, l1: null }).summary, 'HR — Asha Rao');
});
