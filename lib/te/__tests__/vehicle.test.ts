// lib/te/__tests__/vehicle.test.ts — vehicle numbers and what an RC allows.
//
// The number format is checked before Vahan is asked, so a typo costs nothing;
// these assertions are what "a typo" means. The save gate decides whether a
// button is offered — the server refuses independently, so a mistake here is a
// bad experience rather than a bad payment, but it is still worth pinning down.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  isRegValid, longDay, normaliseReg, ownerNote, ratePerKm, rcMarks, saveGate,
  showReg, vehicleSubtitle, REG_FORMAT_MESSAGE,
} from '../vehicle.ts'
import type { RcChecked, TeVehicle, TeVehicleType } from '../types.ts'

const TODAY = '2026-11-16'

const rc = (over: Partial<RcChecked> = {}): RcChecked => ({
  no: 'HR26DK4821', src: 'vahan', checked: TODAY, type: 'car', match: 'match',
  maker: 'Maruti', model: 'Baleno', cls: 'Motor Car (LMV)', body: 'Hatchback', fuel: 'Petrol',
  owner: 'RAHUL NAIR', regd: '2021-04-02', rcValid: '2036-04-01', insValid: '2027-03-31', pucValid: '2027-01-10',
  ...over,
})

describe('the vehicle number', () => {
  it('strips everything that is not a letter or a digit', () => {
    assert.equal(normaliseReg('hr26 dk 4821'), 'HR26DK4821')
    assert.equal(normaliseReg('HR-26-DK-4821'), 'HR26DK4821')
    assert.equal(normaliseReg('  hr26dk4821  '), 'HR26DK4821')
  })

  it('tidies what is shown without gluing it together', () => {
    assert.equal(showReg('  hr26   dk  4821 '), 'HR26 DK 4821')
  })

  it('accepts the ordinary state format', () => {
    for (const r of ['HR26DK4821', 'HR26 DK 4821', 'DL8SCK7710', 'KA01AB1234', 'TN9B5555', 'MH12A999']) {
      assert.ok(isRegValid(r), `${r} should be valid`)
    }
  })

  it('accepts the Bharat series, for a vehicle moved between states', () => {
    assert.ok(isRegValid('22BH1234AA'))
    assert.ok(isRegValid('22 BH 1234 A'))
  })

  it('rejects what is not a registration number', () => {
    for (const r of ['', 'ABC', '1234', 'HR26DK', 'HRDK4821', 'HR26DK48217', '26HR DK 4821', 'HR26DKAB4821']) {
      assert.equal(isRegValid(r), false, `${r} should be rejected`)
    }
  })

  it('has one sentence for a bad number, the engine’s own', () => {
    assert.match(REG_FORMAT_MESSAGE, /HR26 DK 4821/)
    assert.match(REG_FORMAT_MESSAGE, /22 BH 1234 AA/)
  })
})

describe('the RC marks', () => {
  it('shows all three when they are in date', () => {
    const marks = rcMarks(rc(), TODAY)
    assert.deepEqual(marks.map(m => m.tone), ['ok', 'ok', 'ok'])
    assert.equal(marks[0].text, 'RC till 1 Apr 2036')
  })

  it('marks an expired one, and says expired rather than till', () => {
    const marks = rcMarks(rc({ insValid: '2026-03-31' }), TODAY)
    const ins = marks.find(m => m.label === 'Insurance')!
    assert.equal(ins.tone, 'bad')
    assert.equal(ins.text, 'Insurance expired 31 Mar 2026')
  })

  it('says a PUC is not needed rather than leaving a gap', () => {
    // An electric vehicle has no pollution certificate; the RC returns ''.
    const marks = rcMarks(rc({ pucValid: '' }), TODAY)
    const puc = marks.find(m => m.label === 'PUC')!
    assert.equal(puc.tone, 'mute')
    assert.equal(puc.text, 'PUC: not needed')
  })

  it('drops a required date that is missing, rather than inventing one', () => {
    const marks = rcMarks(rc({ insValid: '' as unknown as string }), TODAY)
    assert.equal(marks.find(m => m.label === 'Insurance'), undefined)
  })

  it('has nothing to say without an RC', () => {
    assert.deepEqual(rcMarks(null, TODAY), [])
  })

  it('writes an RC date with its year, unlike every other date here', () => {
    assert.equal(longDay('2036-04-01'), '1 Apr 2036')
    assert.equal(longDay(''), '')
  })
})

describe('whether the vehicle can be added', () => {
  const rules = { owner: 'any', insurance: 'warn' }

  it('allows a vehicle whose papers are in date', () => {
    assert.deepEqual(saveGate({ rc: rc(), rules, today: TODAY }), { canSave: true, message: '', blocking: false })
  })

  it('refuses an expired registration outright', () => {
    const g = saveGate({ rc: rc({ rcValid: '2026-04-01' }), rules, today: TODAY })
    assert.equal(g.canSave, false)
    assert.equal(g.blocking, true)
    assert.equal(g.message, 'The RC expired on 1 Apr 2026. This vehicle cannot be used for paid travel.')
  })

  it('warns about lapsed insurance, or refuses it, as the company says', () => {
    const lapsed = rc({ insValid: '2026-03-31' })
    const warned = saveGate({ rc: lapsed, rules: { insurance: 'warn' }, today: TODAY })
    assert.equal(warned.canSave, true)
    assert.equal(warned.blocking, false)
    assert.match(warned.message, /your approver will see this/)

    const blocked = saveGate({ rc: lapsed, rules: { insurance: 'block' }, today: TODAY })
    assert.equal(blocked.canSave, false)
    assert.equal(blocked.blocking, true)
    assert.match(blocked.message, /Renew it, then add the vehicle/)
  })

  it('puts an expired RC ahead of lapsed insurance: the worse problem is the one told', () => {
    const both = rc({ rcValid: '2026-01-01', insValid: '2026-03-31' })
    assert.match(saveGate({ rc: both, rules, today: TODAY }).message, /^The RC expired/)
  })

  it('has nothing to block before the RC has been looked up', () => {
    assert.deepEqual(saveGate({ rc: null, rules, today: TODAY }), { canSave: true, message: '', blocking: false })
  })
})

describe('whose vehicle it may be', () => {
  it('says what the company allows', () => {
    assert.match(ownerNote({ owner: 'self' }), /only for a vehicle in your name/)
    assert.match(ownerNote({ owner: 'family' }), /your own or a family member/)
    assert.match(ownerNote({ owner: 'any' }), /Allowed/)
    assert.match(ownerNote({}), /Allowed/)
  })
})

describe('the rate a kilometre', () => {
  const fuel = { Petrol: 100, Diesel: 90 }

  it('uses the flat rate when the type has one', () => {
    assert.equal(ratePerKm({ id: 'car', name: 'Car', eg: null, method: 'fixed', rate: 12, fuel: null, kmpl: null, wear: 0, on: true }, fuel), 12)
  })

  it('works a fuel rate out from the price, the mileage and the wear', () => {
    // 100 a litre over 20 km/l is 5 a km, plus 2 of wear.
    assert.equal(ratePerKm({ id: 'car', name: 'Car', eg: null, method: 'fuel', rate: 0, fuel: 'Petrol', kmpl: 20, wear: 2, on: true }, fuel), 7)
  })

  it('falls back to the flat rate rather than dividing by zero', () => {
    assert.equal(ratePerKm({ id: 'car', name: 'Car', eg: null, method: 'fuel', rate: 9, fuel: 'Petrol', kmpl: 0, wear: 2, on: true }, fuel), 9)
  })

  it('is nothing for a type that does not exist', () => {
    assert.equal(ratePerKm(undefined, fuel), 0)
  })
})

describe('the line under a vehicle', () => {
  const types: TeVehicleType[] = [
    { id: 'car', name: 'Car', eg: null, method: 'fixed', rate: 12, fuel: null, kmpl: null, wear: 0, on: true },
    { id: 'suv', name: 'SUV', eg: null, method: 'fixed', rate: 18, fuel: null, kmpl: null, wear: 0, on: true },
  ]
  const veh = (over: Partial<TeVehicle> = {}): TeVehicle => ({
    id: 'v1', emp: 'e1', type: 'car', declared: 'car', reg: 'HR26DK4821', rc: rc(),
    whose: 'self', photo: false, verified: true, vby: 'rc', added: TODAY, ...over,
  } as TeVehicle)

  it('names the type, the rate and what the RC says it is', () => {
    assert.equal(vehicleSubtitle(veh(), types, {}), 'Car · ₹12 a km · Maruti Baleno, Petrol')
  })

  it('says the RC photo is with HR when there is no RC', () => {
    assert.match(vehicleSubtitle(veh({ rc: null }), types, {}), /RC photo with HR$/)
  })

  it('says so plainly when the RC disagreed with what was declared', () => {
    // Declared an SUV, the RC says a car: paid as a car, and it says why.
    assert.match(vehicleSubtitle(veh({ type: 'car', declared: 'suv' }), types, {}), /you said SUV$/)
  })
})
