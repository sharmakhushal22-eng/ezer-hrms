// The RC normaliser, and the contract with the rules engine that reads its output.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { normaliseRc, normaliseBody, normaliseClass, normaliseFuel, isoDate, mockRc, rcProvider, MOCK_RC } from '../providers/rc.ts'
import { TeConfigError } from '../errors.ts'

// The generated engine is CommonJS; load it the CommonJS way so this test runs the real file.
const load = createRequire(import.meta.url)
const EZ = (load('../engine/te-engine.js') as typeof import('../engine/te-engine.js')).createEngine()

describe('dates', () => {
  test('the formats providers send', () => {
    assert.equal(isoDate('18-08-2036'), '2036-08-18')
    assert.equal(isoDate('18/08/2036'), '2036-08-18')
    assert.equal(isoDate('18-Aug-2036'), '2036-08-18')
    assert.equal(isoDate('2036-08-18'), '2036-08-18')
    assert.equal(isoDate('2036-08-18T00:00:00.000Z'), '2036-08-18')
  })
  test('unreadable or impossible dates are empty, never guessed', () => {
    for (const v of ['', 'NA', '31-02-2026', '2026-13-01', 'LTT']) assert.equal(isoDate(v), '')
  })
})

describe('the words the engine compares exactly', () => {
  test('two-wheeler classes carry 2W', () => {
    assert.equal(normaliseClass('M-Cycle/Scooter(2WN)'), 'M-Cycle/Scooter(2WN)')
    assert.equal(normaliseClass('MOTOR CYCLE'), 'MOTOR CYCLE (2WN)')
    assert.equal(normaliseClass('Moped'), 'Moped (2WN)')
    assert.equal(normaliseClass('Motor Car (LMV)'), 'Motor Car (LMV)')
  })
  test('fuel', () => {
    assert.equal(normaliseFuel('ELECTRIC(BOV)'), 'Electric')
    assert.equal(normaliseFuel('PETROL'), 'Petrol')
    assert.equal(normaliseFuel('PETROL/CNG'), 'CNG')
    assert.equal(normaliseFuel('DIESEL'), 'Diesel')
    assert.equal(normaliseFuel(''), '')
  })
  test('body', () => {
    assert.equal(normaliseBody('HATCHBACK'), 'Hatchback')
    assert.equal(normaliseBody('SALOON'), 'Sedan')
    assert.equal(normaliseBody('Sport Utility Vehicle'), 'SUV')
    assert.equal(normaliseBody('MUV'), 'MUV')
    assert.equal(normaliseBody('RIGID (PASSENGER CAR)'), '')
  })
})

describe('normaliseRc', () => {
  const raw = MOCK_RC.HR26DK4821

  test('maps an aggregator record into the ten fields', () => {
    assert.deepEqual(normaliseRc(raw), {
      maker: 'Honda', model: 'City ZX', cls: 'Motor Car (LMV)', body: 'Sedan', fuel: 'Petrol', owner: 'Rahul Nair',
      regd: '2021-08-19', rcValid: '2036-08-18', insValid: '2027-08-18', pucValid: '2027-02-10',
    })
  })
  test('accepts the engine\'s own field names too', () => {
    const own = { maker: 'Honda', model: 'City ZX', cls: 'Motor Car (LMV)', body: 'Sedan', fuel: 'Petrol', owner: 'Rahul Nair', regd: '2021-08-19', rcValid: '2036-08-18', insValid: '2027-08-18', pucValid: '2027-02-10' }
    assert.deepEqual(normaliseRc(own), own)
  })
  test('an electric vehicle has no pollution certificate', () => {
    assert.equal(normaliseRc(MOCK_RC.HR51BZ2208)?.pucValid, '')
    assert.equal(normaliseRc(MOCK_RC.HR51BZ2208)?.fuel, 'Electric')
  })
  test('no owner or no class is unusable: null, so the employee attaches a photo', () => {
    assert.equal(normaliseRc({ ...raw, owner_name: '' }), null)
    assert.equal(normaliseRc({ ...raw, vehicle_class_desc: undefined }), null)
    assert.equal(normaliseRc(null), null)
    assert.equal(normaliseRc('HR26DK4821'), null)
  })
})

describe('what the real rules engine makes of a normalised RC', () => {
  const type = (reg: string) => EZ.rcType(normaliseRc(MOCK_RC[reg])!)

  test('rcType: sedan, suv, bike, ev', () => {
    assert.equal(type('HR26DK4821'), 'sedan')
    assert.equal(type('HR26EF3021'), 'suv')
    assert.equal(type('DL8SCK7710'), 'bike')
    assert.equal(type('HR26AB1190'), 'bike')
    assert.equal(type('HR51BZ2208'), 'ev')
  })
  test('rcType: a two-wheeler whose class has no 2W code is still a bike after normalising', () => {
    assert.equal(EZ.rcType(normaliseRc({ owner_name: 'Rahul Nair', vehicle_class: 'MOTOR CYCLE', fuel_type: 'PETROL' })!), 'bike')
  })
  test('rcType: an unknown body type falls to suv. This is the engine\'s rule, documented in rc.ts', () => {
    assert.equal(EZ.rcType(normaliseRc({ owner_name: 'Rahul Nair', vehicle_class: 'Motor Car (LMV)', fuel_type: 'PETROL', body_type: 'RIGID' })!), 'suv')
  })
  test('nameMatch: match, partial, no', () => {
    assert.equal(EZ.nameMatch(normaliseRc(MOCK_RC.HR26DK4821)!.owner, 'Rahul Nair'), 'match')
    assert.equal(EZ.nameMatch('RAHUL  K. NAIR', 'Rahul Nair'), 'match')
    assert.equal(EZ.nameMatch(normaliseRc(MOCK_RC.HR26EF3021)!.owner, 'Rahul Nair'), 'partial')
    assert.equal(EZ.nameMatch('Arjun Rao', 'Rahul Nair'), 'no')
  })
  test('the number format the engine accepts', () => {
    assert.ok(EZ.rcFmtOk('hr26 dk 4821'))
    assert.ok(EZ.rcFmtOk('22 BH 1234 AA'))
    assert.ok(!EZ.rcFmtOk('HELLO'))
    assert.equal(EZ.rcNorm('hr26 dk-4821'), 'HR26DK4821')
  })
})

describe('choosing the provider', () => {
  test('nothing configured = no provider', () => {
    assert.equal(rcProvider({}), undefined)
    assert.equal(rcProvider({ TE_RC_PROVIDER: 'none' }), undefined)
  })
  test('mock answers the demo numbers and nothing else', async () => {
    const rc = rcProvider({ TE_RC_PROVIDER: 'mock' })
    assert.equal(rc, mockRc)
    assert.equal((await rc!('HR26DK4821'))?.owner, 'Rahul Nair')
    assert.equal(await rc!('HR26ZZ0001'), null)
  })
  test('mock is refused on a production deployment', () => {
    assert.throws(() => rcProvider({ TE_RC_PROVIDER: 'mock', VERCEL_ENV: 'production' }), TeConfigError)
  })
  test('a name that does not exist is a loud error, not a silent "no provider"', () => {
    assert.throws(() => rcProvider({ TE_RC_PROVIDER: 'vahan-pro' }), (e: unknown) => e instanceof TeConfigError && /vahan-pro/.test(e.message))
  })
})
