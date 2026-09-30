// lib/recruitment/__tests__/ctc-model.test.ts — the CTC data flow.
//
// computeCtc() is the one function behind the Negotiation calculator, the
// candidate's salary link and the printed statement, so a defect here reaches a
// real offer. It had no tests.
//
// WHAT THIS FILE DOES AND DOES NOT CLAIM
//
// It asserts that the implementation matches its OWN documented rules and that
// the package reconciles internally. It does NOT certify Indian statute — that
// 13% is the right employer EPF rate, or that a slab is current, is not
// something a test in this repo can settle, and pretending otherwise would turn
// a wrong constant into a "verified" one.
//
// The load-bearing assertion is the reconciliation: every rupee of fixed CTC
// must reappear as gross plus employer cost, exactly. It is true by construction
// in the current code, which is precisely why it is worth pinning — the closed
// -form ESIC solve at line ~179 is the kind of algebra a later edit breaks
// silently, and the symptom would be an offer that does not add up.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeCtc, professionalTax, labourWelfareFund, hraMaxFor,
  EPF_WAGE_CEILING, EPF_EMPLOYER_RATE, EPF_EMPLOYEE_RATE,
  ESIC_WAGE_CEILING, ESIC_EMPLOYER_RATE, ESIC_EMPLOYEE_RATE,
  GRATUITY_RATE, BONUS_ELIGIBILITY_WAGE, BONUS_CALC_FLOOR,
  CONVEYANCE_STD, HRA_MAX_METRO, HRA_MAX_NON_METRO, BASIC_OF_FIXED,
  type CtcResult, type CtcInput,
} from '../ctc-model.ts'

const near = (a: number, b: number, why: string, tol = 0.02) =>
  assert.ok(Math.abs(a - b) <= tol, `${why}: ${a} vs ${b}`)

/** A comfortable package: ₹12L fixed, Karnataka, gratuity in CTC, bonus with salary. */
// Typed as CtcInput, not inferred. With `as const` the inferred type pinned
// gratuity to 'yes' and bonusMode to 'salary', so Partial<typeof base> rejected
// the opposite value and the cases below would not type-check — invisible to
// `node --test`, which strips types and runs happily.
const base: CtcInput = {
  ctcAnnual: 1_200_000, variableAnnual: 0, minWage: 15_000,
  state: 'Karnataka', gratuity: 'yes', bonusPct: 8.33, bonusMode: 'salary',
}
const ok = (i: Partial<CtcInput> = {}): CtcResult => {
  const r = computeCtc({ ...base, ...i })
  assert.ok(r.ok, 'expected a computable package')
  return r
}

describe('the model reconciles', () => {
  test('fixed CTC is exactly gross plus every employer cost', () => {
    for (const ctcAnnual of [600_000, 1_200_000, 2_400_000, 9_000_000]) {
      const r = ok({ ctcAnnual })
      near(
        r.gross + r.epfEmployer + r.gratuityMonthly + r.bonusOverheadMonthly + r.esicEmployer,
        r.fixedMonthly,
        `fixed CTC does not reconcile at ${ctcAnnual}`,
      )
    }
  })

  test('variable is carved out of CTC, never added on top', () => {
    const r = ok({ ctcAnnual: 1_200_000, variableAnnual: 200_000 })
    assert.equal(r.fixedAnnual, 1_000_000)
    assert.equal(r.variableAnnual, 200_000)
    near(r.fixedAnnual + r.variableAnnual, r.ctcAnnual, 'fixed + variable must equal CTC')
  })

  test('gross is fully allocated — no rupee is unaccounted for', () => {
    const r = ok()
    near(r.basic + r.statBonus + r.hra + r.otherAllow, r.gross, 'gross allocation leaks')
    near(r.conveyance + r.specialAllow, r.otherAllow, 'other allowance does not split cleanly')
  })

  test('in-hand is gross less exactly the four employee deductions', () => {
    const r = ok()
    near(r.epfEmployee + r.esicEmployee + r.ptMonthly + r.lwfMonthly, r.totalDed, 'totalDed mis-sums')
    near(r.gross - r.totalDed, r.inHand, 'in-hand does not follow from gross')
  })
})

describe('Basic', () => {
  test('is half of fixed pay when that clears the minimum wage', () => {
    const r = ok({ ctcAnnual: 1_200_000, minWage: 15_000 })
    assert.equal(r.basicRule, '50pct')
    near(r.basic, r.fixedMonthly * BASIC_OF_FIXED, 'Basic should be 50% of fixed')
  })

  test('is lifted to the minimum wage when half of fixed pay falls short', () => {
    // A small package in a state with a high floor: the floor must win.
    const r = ok({ ctcAnnual: 300_000, minWage: 18_000 })
    assert.equal(r.basicRule, 'minwage')
    assert.equal(r.basic, 18_000)
  })
})

describe('EPF', () => {
  test('PF wages are Basic, capped at the ceiling — allowances never enter', () => {
    const r = ok({ ctcAnnual: 9_000_000 })     // Basic far above the ceiling
    assert.equal(r.epfWageBase, EPF_WAGE_CEILING)
    assert.ok(r.basic > EPF_WAGE_CEILING, 'this case is meant to exceed the ceiling')
  })

  test('below the ceiling, PF wages are Basic itself', () => {
    const r = ok({ ctcAnnual: 400_000, minWage: 10_000 })
    assert.ok(r.basic <= EPF_WAGE_CEILING)
    near(r.epfWageBase, r.basic, 'PF wages should equal Basic below the ceiling')
  })

  test('employer and employee shares are the documented rates on PF wages', () => {
    const r = ok()
    near(r.epfEmployer, r.epfWageBase * EPF_EMPLOYER_RATE, 'employer EPF')
    near(r.epfEmployee, r.epfWageBase * EPF_EMPLOYEE_RATE, 'employee EPF')
  })

  test('an older negotiation can be recomputed on the old ceiling', () => {
    const r = ok({ ctcAnnual: 9_000_000, epfCeiling: 15_000 })
    assert.equal(r.epfWageBase, 15_000)
    assert.equal(r.epfCeiling, 15_000)
  })
})

describe('ESIC', () => {
  test('does not apply once gross passes the ceiling', () => {
    const r = ok({ ctcAnnual: 1_200_000 })
    assert.ok(r.gross > ESIC_WAGE_CEILING, 'this case is meant to exceed the ESIC ceiling')
    assert.equal(r.esicEmployer, 0)
    assert.equal(r.esicEmployee, 0)
    assert.equal(r.esicNearCeiling, false)
  })

  test('applies at the documented rates while gross is within the ceiling', () => {
    const r = ok({ ctcAnnual: 240_000, minWage: 9_000 })
    if (r.gross <= ESIC_WAGE_CEILING) {
      near(r.esicEmployer, r.gross * ESIC_EMPLOYER_RATE, 'employer ESIC')
      near(r.esicEmployee, r.gross * ESIC_EMPLOYEE_RATE, 'employee ESIC')
    }
  })

  test('the near-ceiling warning only fires while ESIC actually applies', () => {
    const r = ok({ ctcAnnual: 1_200_000 })
    assert.equal(r.esicNearCeiling, false, 'a package well past the ceiling is not "near" it')
  })
})

describe('gratuity and statutory bonus', () => {
  test('gratuity is a rate on Basic, and switching it off removes the cost', () => {
    const on = ok({ gratuity: 'yes' })
    near(on.gratuityMonthly, on.basic * GRATUITY_RATE, 'gratuity rate')
    assert.equal(ok({ gratuity: 'no' }).gratuityMonthly, 0)
  })

  test('bonus stops once Basic passes the eligibility wage', () => {
    const r = ok({ ctcAnnual: 1_200_000 })
    assert.ok(r.basic > BONUS_ELIGIBILITY_WAGE, 'this case is meant to be bonus-ineligible')
    assert.equal(r.bonusMonthly, 0)
  })

  test('an eligible bonus is computed on the Act\'s calculation ceiling, not on Basic', () => {
    const r = ok({ ctcAnnual: 300_000, minWage: 9_000, bonusPct: 8.33 })
    assert.ok(r.basic <= BONUS_ELIGIBILITY_WAGE, 'this case is meant to be bonus-eligible')
    near(r.bonusBase, Math.min(r.basic, Math.max(BONUS_CALC_FLOOR, 9_000)), 'bonus base')
    near(r.bonusMonthly, r.bonusBase * 0.0833, 'bonus amount')
  })

  test('bonus mode decides whether it sits in gross or outside it', () => {
    const inSalary = ok({ ctcAnnual: 300_000, minWage: 9_000, bonusMode: 'salary' })
    const inCtc = ok({ ctcAnnual: 300_000, minWage: 9_000, bonusMode: 'ctc' })
    near(inSalary.statBonus, inSalary.bonusMonthly, 'with salary, bonus belongs to gross')
    assert.equal(inSalary.bonusOverheadMonthly, 0)
    assert.equal(inCtc.statBonus, 0, 'only in CTC, bonus is not part of gross')
    near(inCtc.bonusOverheadMonthly, inCtc.bonusMonthly, 'only in CTC, bonus is an employer overhead')
  })
})

describe('HRA and the rest of gross', () => {
  test('is capped at the metro or non-metro share of Basic', () => {
    const r = ok()
    assert.ok(r.hra <= r.basic * r.hraMax + 0.01, 'HRA exceeded its cap')
    near(r.hra, r.basic * HRA_MAX_NON_METRO, 'a comfortable package should reach the cap')
  })

  test('the metro list drives the ceiling, case-insensitively and on substrings', () => {
    for (const p of ['Mumbai', 'mumbai', 'Navi Mumbai', 'NEW DELHI', 'Kolkata', 'chennai'])
      assert.equal(hraMaxFor(p), HRA_MAX_METRO, `${p} should be a metro`)
    for (const p of ['Bengaluru', 'Pune', 'Indore', '', null, undefined])
      assert.equal(hraMaxFor(p as string), HRA_MAX_NON_METRO, `${String(p)} should not be a metro`)
  })

  test('conveyance takes the standard amount before Special Allowance gets any', () => {
    const r = ok()
    assert.equal(r.conveyance, CONVEYANCE_STD)
    assert.ok(r.specialAllow >= 0)
  })
})

describe('a package that cannot be built', () => {
  test('is refused with the minimum it would need, rather than returning nonsense', () => {
    const r = computeCtc({ ...base, ctcAnnual: 60_000, minWage: 15_000 })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.ok(r.minReqFixedAnn > r.fixedAnnual, 'the refusal must say what would be enough')
      assert.ok(r.basic > 0)
    }
  })

  test('the boundary is honoured — just above the minimum computes', () => {
    const low = computeCtc({ ...base, ctcAnnual: 60_000, minWage: 15_000 })
    assert.equal(low.ok, false)
    if (!low.ok) {
      const justEnough = computeCtc({ ...base, ctcAnnual: Math.ceil(low.minReqFixedAnn) + 12, minWage: 15_000 })
      assert.equal(justEnough.ok, true, 'a package at the stated minimum should compute')
    }
  })

  test('zero and negative input do not throw', () => {
    for (const ctcAnnual of [0, -1]) {
      const r = computeCtc({ ...base, ctcAnnual })
      assert.equal(r.ok, false, `${ctcAnnual} should be refused, not computed`)
    }
  })
})

describe('state deductions', () => {
  test('an unlisted state levies neither PT nor LWF', () => {
    assert.equal(professionalTax('Rajasthan', 90_000), 0)
    assert.equal(professionalTax('Odisha', 90_000), 0)   // repealed 1-Apr-2026
    assert.equal(labourWelfareFund('Rajasthan', 90_000), 0)
  })

  test('PT picks the highest slab the gross clears, and the boundary is exclusive', () => {
    assert.equal(professionalTax('Karnataka', 24_999), 0, 'the slab applies above the figure, not at it')
    assert.equal(professionalTax('Karnataka', 25_000), 200)
    // A multi-slab state must climb, not stop at the first match.
    assert.equal(professionalTax('West Bengal', 12_000), 110)
    assert.equal(professionalTax('West Bengal', 45_000), 200)
  })

  test('Haryana LWF is a rate with a cap, not a flat figure', () => {
    assert.equal(labourWelfareFund('Haryana', 10_000), 20)
    assert.equal(labourWelfareFund('Haryana', 100_000), 35, 'the cap must bite')
    assert.equal(labourWelfareFund('Punjab', 100_000), 5, 'a flat state stays flat')
  })
})
