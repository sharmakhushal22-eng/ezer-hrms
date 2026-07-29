// ================================================================
// EZER HRMS — Minimum Wage × CTC Master Integration
// Path: lib/minimum-wage/ctcIntegration.ts
//
// CONCRETE example of wiring checkMinimumWageCompliance() into CTC
// Master save — the same pattern applies to Offer Letter generation
// and Appointment Letter generation: resolve the person's state +
// wage category, convert their proposed Basic to a MONTHLY figure
// (minimum wage is always per-month), call the one compliance
// function, and surface the result before letting the save through.
//
// ASSUMPTION flagged honestly: employees.category in your real schema
// is the SC/ST/OBC reservation category (confirmed from your export),
// NOT a skill-level category — Minimum Wage needs Unskilled/Semi-
// skilled/Skilled/Highly-skilled, which is a DIFFERENT concept. This
// needs a new column — suggested below as `employees.wage_category` —
// since conflating it with the reservation `category` column would be
// both factually wrong and a compliance risk.
// ================================================================
import { supabase } from '@/lib/supabase'
import { checkMinimumWageCompliance } from './actions'
import type { ComplianceResult } from './types'
import type { WageCategory } from './types'

export interface CtcMinimumWageCheck extends ComplianceResult {
  employee_id: string
  proposed_monthly_basic: number
  state_used: string
  category_used: WageCategory | null
}

/**
 * Call BEFORE inserting/updating a ctc_master row (or an
 * offer/appointment letter's proposed Basic). Converts the annual
 * basic being proposed into a monthly figure, resolves the
 * employee's state + wage category, and runs the one compliance
 * check every other flow uses too.
 */
export async function checkCtcMinimumWage(
  employeeId: string,
  proposedBasicAnnual: number,
  asOfDate?: string
): Promise<CtcMinimumWageCheck> {
  const { data: emp } = await supabase
    .from('employees')
    // NOTE: res_state is what's confirmed to exist today. If your
    // establishment's state (not the employee's residence) is what
    // Minimum Wage should actually key on, swap this for whichever
    // column represents place of work once that's confirmed.
    .select('res_state, wage_category') // wage_category: NEW column, see migration note below
    .eq('id', employeeId)
    .maybeSingle()

  const state = emp?.res_state ?? ''
  const category = (emp?.wage_category ?? null) as WageCategory | null
  const monthlyBasic = Math.round((proposedBasicAnnual / 12) * 100) / 100

  if (!state || !category) {
    // Missing state/category is a data-completeness problem, not a
    // pass — surfaced the same way an unconfigured rate is (rate_found=false).
    return {
      employee_id: employeeId, proposed_monthly_basic: monthlyBasic,
      state_used: state, category_used: category,
      is_compliant: false, applicable_minimum_wage: null, shortfall: null, rate_found: false,
    }
  }

  const result = await checkMinimumWageCompliance({
    state, category, proposedBasic: monthlyBasic, asOf: asOfDate,
  })

  return { employee_id: employeeId, proposed_monthly_basic: monthlyBasic, state_used: state, category_used: category, ...result }
}
