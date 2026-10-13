// The admin whitelist: which settings and master columns a request may change.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { checkSettingsPatch, checkMasterRows, missingForInsert, rowProblem, MASTERS, SETTINGS } from '../admin.ts'
import { TeHttpError } from '../errors.ts'
import { csvCell, toCsv } from '../csv.ts'

const refuses = (fn: () => unknown, re: RegExp, status = 400) =>
  assert.throws(fn, (e: unknown) => e instanceof TeHttpError && e.status === status && re.test(e.message), `expected a ${status} matching ${re}`)

describe('settings', () => {
  test('valid values pass, numbers typed as text become numbers', () => {
    assert.deepEqual(checkSettingsPatch({ bill_age_days: '60', post_facto: 'blocked', auto_approve_on_timeout: true, fallback_approver_id: null }),
      { bill_age_days: 60, post_facto: 'blocked', auto_approve_on_timeout: true, fallback_approver_id: null })
  })
  test('the limits of the CHECK constraints', () => {
    refuses(() => checkSettingsPatch({ bill_age_days: 0 }), /bill age days: must be between 1 and 730/)
    refuses(() => checkSettingsPatch({ bill_age_days: 731 }), /between 1 and 730/)
    refuses(() => checkSettingsPatch({ claim_deadline_days: 1.5 }), /whole number/)
    refuses(() => checkSettingsPatch({ advance_max_pct: 101 }), /between 0 and 100/)
    refuses(() => checkSettingsPatch({ sample_pct: -1 }), /between 0 and 100/)
    refuses(() => checkSettingsPatch({ receipt_above: -5 }), /0 or more/)
    refuses(() => checkSettingsPatch({ post_facto: 'maybe' }), /allowed, limited, blocked/)
    refuses(() => checkSettingsPatch({ auto_approve_on_timeout: 'yes' }), /true or false/)
    refuses(() => checkSettingsPatch({ fallback_approver_id: 'SRS0101' }), /not a valid id/)
  })
  test('columns the server owns, and columns that do not exist, are refused', () => {
    for (const k of ['company_id', 'version', 'updated_by', 'created_at', 'updated_at', 'is_admin', '__proto__', 'constructor']) {
      refuses(() => checkSettingsPatch({ [k]: 1 } as Record<string, unknown>), /not a setting that can be changed/)
    }
    refuses(() => checkSettingsPatch({}), /at least one setting/)
  })
  test('a JSON group is merged into what is stored, not replaced', () => {
    const out = checkSettingsPatch({ gps_rules: { preApproveKm: 50 } }, { gps_rules: { preApproveKm: 75, localMaxKm: 150 } })
    assert.deepEqual(out, { gps_rules: { preApproveKm: 50, localMaxKm: 150 } })
    refuses(() => checkSettingsPatch({ gps_rules: [1, 2] }), /object of settings/)
  })
  test('every CHECK-constrained column of te_settings is in the whitelist', () => {
    for (const c of ['bill_age_days', 'claim_deadline_days', 'notice_days', 'receipt_above', 'no_bill_per_day', 'client_per_head', 'misc_per_claim',
      'comm_per_claim', 'advance_max_pct', 'grace_days', 'mileage_tolerance_pct', 'estimate_tolerance_pct', 'post_facto', 'post_facto_per_quarter',
      'fast_track_amount', 'sample_pct', 'reminder_days', 'escalate_days']) assert.ok(c in SETTINGS, c)
  })
})

describe('masters', () => {
  test('only the eleven editable lists exist', () => {
    assert.deepEqual(Object.keys(MASTERS).sort(), ['te_categories', 'te_checks', 'te_city_tiers', 'te_grade_limits', 'te_grade_policies', 'te_hubs',
      'te_modes', 'te_place_types', 'te_places', 'te_stop_reasons', 'te_vehicle_types'])
    for (const t of ['te_settings', 'te_claims', 'te_audit_log', 'employees', 'te_workflow_levels', 'toString']) {
      refuses(() => checkMasterRows(t, [{ code: 'x' }]), /not a list that can be edited/, 404)
    }
  })
  test('a row is split into its key and the columns to change', () => {
    assert.deepEqual(checkMasterRows('te_vehicle_types', [{ code: 'sedan', rate_per_km: '12.5', is_active: false }]),
      [{ key: { code: 'sedan' }, patch: { rate_per_km: 12.5, is_active: false } }])
    assert.deepEqual(checkMasterRows('te_grade_limits', [{ grade: 'M2', tier: 'metro', hotel_per_night: 5500 }]),
      [{ key: { grade: 'M2', tier: 'metro' }, patch: { hotel_per_night: 5500 } }])
  })
  test('columns outside the whitelist are refused, with the row number', () => {
    refuses(() => checkMasterRows('te_categories', [{ code: 'toll', name: 'Toll' }, { code: 'misc', company_id: 'c0000000-0000-0000-0000-000000000002' }]), /Row 2: "company_id" cannot be changed/)
    refuses(() => checkMasterRows('te_checks', [{ code: 'A1', is_live: true }]), /"is_live" cannot be changed/)
    refuses(() => checkMasterRows('te_checks', [{ code: 'A1', title: 'x' }]), /"title" cannot be changed/)
    refuses(() => checkMasterRows('te_places', [{ short_name: 'HQ', owner_employee_id: 'e0000000-0000-0000-0000-000000000512' }]), /"owner_employee_id" cannot be changed/)
  })
  test('values are checked like the CHECK constraints', () => {
    refuses(() => checkMasterRows('te_modes', [{ code: 'cab', basis: 'free' }]), /basis: must be one of: km, bill, nobill, ticket, none/)
    refuses(() => checkMasterRows('te_grade_limits', [{ grade: 'M2', tier: 'village', meals_per_day: 1 }]), /tier: must be one of/)
    refuses(() => checkMasterRows('te_vehicle_types', [{ code: 'sedan', rate_per_km: -1 }]), /rate per km/)
    refuses(() => checkMasterRows('te_categories', [{ code: 'Toll Fee', name: 'x' }]), /lower-case letters/)
    refuses(() => checkMasterRows('te_checks', [{ code: 'Z99', is_enabled: false }]), /check code/)
    refuses(() => checkMasterRows('te_city_tiers', [{ city: 'Pune', state_code: 'MH' }]), /2-digit GST state code/)
  })
  test('the request itself', () => {
    refuses(() => checkMasterRows('te_modes', []), /rows to save/)
    refuses(() => checkMasterRows('te_modes', { code: 'cab' }), /rows to save/)
    refuses(() => checkMasterRows('te_modes', ['cab']), /Row 1 is not an object/)
    refuses(() => checkMasterRows('te_modes', [{ code: 'cab', name: 'Cab' }, { code: 'cab', name: 'Taxi' }]), /Row 2 repeats/)
    refuses(() => checkMasterRows('te_modes', Array.from({ length: 501 }, (_, i) => ({ code: `m${i}` }))), /at most 500/)
  })
  test('a new row needs its required columns; the checks take no new rows', () => {
    const [cat] = checkMasterRows('te_categories', [{ code: 'visa', icon: 'file' }])
    assert.deepEqual(missingForInsert('te_categories', cat), ['name'])
    const [ok] = checkMasterRows('te_categories', [{ code: 'visa', name: 'Visa fees' }])
    assert.deepEqual(missingForInsert('te_categories', ok), [])
    const [chk] = checkMasterRows('te_checks', [{ code: 'A1', is_enabled: false }])
    assert.equal(missingForInsert('te_checks', chk), null)
  })
  test('a new company place has no id; an existing one is addressed by id', () => {
    assert.deepEqual(checkMasterRows('te_places', [{ short_name: 'Pune office', address: '4 MG Road', lat: 18.52, lng: 73.85 }])[0].key, {})
    assert.deepEqual(checkMasterRows('te_places', [{ id: 'A0000000-0000-0000-0000-000000000001', is_active: false }])[0].key, { id: 'a0000000-0000-0000-0000-000000000001' })
    refuses(() => checkMasterRows('te_places', [{ short_name: 'X', address: 'Y', lat: 91, lng: 0 }]), /lat: must be between -90 and 90/)
  })
  test('rules across columns: the product rules that are CHECK constraints', () => {
    assert.equal(rowProblem('te_modes', { code: 'flight', scope_local: true, gps: 'checkin' }), 'A flight is never a local trip.')
    assert.equal(rowProblem('te_modes', { code: 'flight', scope_local: false, gps: 'track' }), 'A flight is checked in, not tracked.')
    assert.equal(rowProblem('te_modes', { code: 'cab', scope_local: true, gps: 'track' }), '')
    assert.equal(rowProblem('te_vehicle_types', { method: 'fuel', fuel: null, km_per_unit: null }), 'A fuel-based rate needs the fuel and the km per unit.')
    assert.equal(rowProblem('te_places', { country: 'India', pin_code: '12201' }), 'An address in India has a 6-digit PIN.')
    assert.equal(rowProblem('te_places', { country: 'Singapore', pin_code: '018956' }), '')
  })
})

describe('csv', () => {
  test('quotes what needs quoting', () => {
    assert.equal(csvCell('plain'), 'plain')
    assert.equal(csvCell('Nair, Rahul'), '"Nair, Rahul"')
    assert.equal(csvCell('say "hi"'), '"say ""hi"""')
    assert.equal(csvCell('two\nlines'), '"two\nlines"')
    assert.equal(csvCell(null), '')
    assert.equal(csvCell(166), '166')
    assert.equal(csvCell(true), 'Yes')
  })
  test('text that a spreadsheet would run as a formula is defused; numbers are not touched', () => {
    assert.equal(csvCell('=HYPERLINK("http://x","pay")'), `"'=HYPERLINK(""http://x"",""pay"")"`)
    assert.equal(csvCell('+91 98100 00000'), `'+91 98100 00000`)
    assert.equal(csvCell('@cmd'), `'@cmd`)
    assert.equal(csvCell('-refund'), `'-refund`)
    assert.equal(csvCell('-120.50'), '-120.50')
    assert.equal(csvCell(-120.5), '-120.5')
  })
  test('a whole file', () => {
    const csv = toCsv([{ name: 'Rahul Nair', amount: '166.00', note: 'EXP REIMB CLM-2026-000001' }], [['name', 'Beneficiary name'], ['amount', 'Amount'], ['note', 'Narration']])
    assert.equal(csv, 'Beneficiary name,Amount,Narration\r\nRahul Nair,166.00,EXP REIMB CLM-2026-000001\r\n')
  })
})
