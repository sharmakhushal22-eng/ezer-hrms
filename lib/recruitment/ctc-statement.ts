// lib/recruitment/ctc-statement.ts
//
// THE salary statement — every line of the Automated CTC model, in order, with its basis,
// monthly and annual figure. One definition feeds the recruiter's Salary Breakdown Statement
// (on screen, Excel, PDF) AND the candidate's salary link, so the two can never disagree.
// `calc` is the computeCtc() result, which is what ctc_negotiations.calculation_data stores.

import { EPF_WAGE_CEILING, LWF_CYCLE } from './ctc-model'

export type StmtRow = { kind:'row'|'head'|'sum'|'emp'|'grat'|'bonus'|'muted'|'total'|'ded'|'net'|'note'; label:string; basis?:string; monthly?:number|null; annual?:number|null; remark?:string }

/** True when a saved calculation_data carries enough to rebuild the statement. */
export function hasStatement(calc:any): boolean {
  return !!calc && calc.basic != null && calc.gross != null && calc.inHand != null && calc.epfEmployer != null
}

export function ctcStatementRows(calc:any, form:any): StmtRow[] {
  const ceil = Number(calc.epfCeiling||EPF_WAGE_CEILING)
  // PF wages = Basic capped at the ceiling. Saves made while allowances were included keep their stored base.
  const epfBase = calc.epfWageBase != null ? Number(calc.epfWageBase) : Math.min(calc.basic, ceil)
  const hraPct = Math.round((calc.hraMax || 0.5) * 100)
  const rows:StmtRow[] = [
    { kind:'row',  label:'Basic Salary', basis: calc.basicRule==='minwage' ? 'minimum wage floor' : '50% of fixed CTC', monthly:calc.basic, annual:calc.basic*12 },
    { kind:'row',  label:'House Rent Allowance (HRA)', basis:`≤ ${hraPct}% of Basic (${hraPct===50?'metro':'non-metro'} exemption cap)`, monthly:calc.hra, annual:calc.hra*12 },
  ]
  if ((calc.statBonus||0)>0) rows.push({ kind:'bonus', label:'Statutory Bonus (advance, with salary)', basis:`${calc.bonusPct}% on ₹${Math.round(calc.bonusBase||calc.basic).toLocaleString('en-IN')} · trued up at year end`, monthly:calc.statBonus, annual:calc.statBonus*12, remark:'In gross' })
  if ((calc.conveyance||0)>0) rows.push({ kind:'row', label:'Conveyance Allowance', basis:'standard ₹1,600', monthly:calc.conveyance, annual:calc.conveyance*12 })
  rows.push({ kind:'row', label:'Special Allowance', basis:'balance of fixed CTC', monthly:calc.specialAllow||0, annual:(calc.specialAllow||0)*12 })
  rows.push({ kind:'sum', label:'Gross Earnings (A)', monthly:calc.gross, annual:calc.gross*12 })
  rows.push({ kind:'emp', label:'Employer EPF', basis:`13% on PF wages ₹${Math.round(epfBase).toLocaleString('en-IN')} (Basic, ceiling ₹${ceil.toLocaleString('en-IN')})`, monthly:calc.epfEmployer, annual:calc.epfEmployer*12, remark:'In CTC' })
  rows.push({ kind:'emp', label:'Employer ESIC', basis: (calc.esicEmployer||0)>0 ? '3.25% of gross (≤ ₹21,000)' : 'not applicable — gross > ₹21,000', monthly:calc.esicEmployer||0, annual:(calc.esicEmployer||0)*12, remark:'In CTC' })
  if (calc.gratuity==='yes') rows.push({ kind:'grat', label:'Gratuity', basis:'4.81% of Basic', monthly:calc.gratuityMonthly||0, annual:(calc.gratuityMonthly||0)*12, remark:'In CTC' })
  if (calc.bonusMode==='ctc' && (calc.bonusOverheadMonthly||0)>0) rows.push({ kind:'bonus', label:'Statutory Bonus (employer overhead)', basis:`${calc.bonusPct}% on ₹${Math.round(calc.bonusBase||calc.basic).toLocaleString('en-IN')}`, monthly:calc.bonusOverheadMonthly, annual:calc.bonusOverheadMonthly*12, remark:'In CTC' })
  rows.push({ kind:'sum', label:'Fixed CTC Package', basis:'gross + employer contributions', monthly:calc.fixedMonthly, annual:calc.fixedMonthly*12 })
  rows.push({ kind:'muted', label:'Variable / Performance CTC', monthly:calc.varMonthly||0, annual:calc.variable||0 })
  rows.push({ kind:'total', label:'Total Annual CTC Package', monthly:calc.totalCTCMonthly, annual:calc.ctcAnnual })
  rows.push({ kind:'head', label:'Employee deductions & net in-hand' })
  rows.push({ kind:'sum', label:'Gross Earnings (A)', monthly:calc.gross, annual:calc.gross*12 })
  rows.push({ kind:'ded', label:'(−) Employee PF', basis:`12% on PF wages ₹${Math.round(epfBase).toLocaleString('en-IN')}`, monthly:calc.epfEmployee, annual:calc.epfEmployee*12, remark:'Deduction' })
  rows.push({ kind:'ded', label:'(−) Employee ESIC', basis: (calc.esicEmployee||0)>0 ? '0.75% of gross' : 'not applicable', monthly:calc.esicEmployee||0, annual:(calc.esicEmployee||0)*12, remark:'Deduction' })
  rows.push({ kind:'ded', label:`(−) Professional Tax`, basis: (calc.ptMonthly||0)>0 ? `${form.state} slab` : `nil in ${form.state}`, monthly:calc.ptMonthly||0, annual:(calc.ptMonthly||0)*12, remark:'Deduction' })
  rows.push({ kind:'ded', label:'(−) Labour Welfare Fund', basis: (calc.lwfMonthly||0)>0 ? `${LWF_CYCLE[form.state]||form.state} · shown as monthly average` : `nil in ${form.state}`, monthly:calc.lwfMonthly||0, annual:(calc.lwfMonthly||0)*12, remark:'Deduction' })
  rows.push({ kind:'net', label:'Net In-Hand Salary', basis:'before TDS', monthly:calc.inHand, annual:calc.inHand*12 })
  if (calc.esicNearCeiling) rows.push({ kind:'note', label:`⚠ Gross ₹${Math.round(calc.gross).toLocaleString('en-IN')} is within ₹1,000 of the ESIC ceiling (₹21,000). A small increment will take the candidate out of ESI cover; contributions continue till the end of the contribution period.` })
  rows.push({ kind:'note', label:'Net in-hand is shown before income tax (TDS). The candidate’s salary link compares TDS under the old and new regimes.' })
  return rows
}


// ── The CANDIDATE'S salary link — simplified statutory view ─────────────────────────────
// What the candidate sees is deliberately simpler than the recruiter's working statement:
//   Employee EPF  = 12% of Basic           Employer EPF  = 13% of Basic
//   Employee ESIC = 0.75% of Basic         Employer ESIC = 3.25% of Basic   (only if Basic < ₹21,000)
//   No professional tax, no LWF, no gratuity or bonus lines.
// Basic (min-wage rule) and the HRA cap come from the saved calculation; gross is what is left
// of the fixed CTC after the two employer contributions, allocated as HRA + conveyance + special
// allowance, so the package still adds up to the offered CTC.
export const LINK_ESIC_BASIC_LIMIT = 21000
export function linkStatementRows(calc: any, offeredAnnual?: number | null): { rows: StmtRow[]; basic: number; gross: number; epfEmployee: number; esicEmployee: number; inHand: number; fixedMonthly: number; special: number } | null {
  const ctcAnnual = Number(calc?.ctcAnnual || offeredAnnual || 0)
  const basic = Number(calc?.basic || 0)
  if (!ctcAnnual || !basic) return null
  const variable = Math.max(0, Number(calc.variable ?? calc.variableAnnual ?? 0))
  const fixedMonthly = (ctcAnnual - variable) / 12
  const epfEmployer = basic * 0.13, epfEmployee = basic * 0.12
  const esic = basic < LINK_ESIC_BASIC_LIMIT
  const esicEmployer = esic ? basic * 0.0325 : 0, esicEmployee = esic ? basic * 0.0075 : 0
  const gross = Math.max(0, fixedMonthly - epfEmployer - esicEmployer)
  const hraMax = Number(calc.hraMax) || 0.4
  const rem = Math.max(0, gross - basic)
  const hra = Math.min(basic * hraMax, rem)
  const other = Math.max(0, rem - hra)
  const conveyance = Math.min(other, 1600)
  const special = Math.max(0, other - conveyance)
  const totalDed = epfEmployee + esicEmployee
  const inHand = gross - totalDed
  const hraPct = Math.round(hraMax * 100)
  const rows: StmtRow[] = [
    { kind:'row', label:'Basic Salary', basis: calc.basicRule==='minwage' ? 'minimum wage floor' : '50% of fixed CTC', monthly:basic, annual:basic*12 },
    { kind:'row', label:'House Rent Allowance (HRA)', basis:`${hraPct}% of Basic`, monthly:hra, annual:hra*12 },
  ]
  if (conveyance > 0) rows.push({ kind:'row', label:'Conveyance Allowance', basis:'standard ₹1,600', monthly:conveyance, annual:conveyance*12 })
  rows.push({ kind:'row', label:'Special Allowance', basis:'balance of fixed CTC', monthly:special, annual:special*12 })
  rows.push({ kind:'sum', label:'Gross Earnings (A)', monthly:gross, annual:gross*12 })
  rows.push({ kind:'emp', label:'Employer EPF', basis:'13% of Basic', monthly:epfEmployer, annual:epfEmployer*12, remark:'In CTC' })
  if (esic) rows.push({ kind:'emp', label:'Employer ESIC', basis:'3.25% of Basic (Basic < ₹21,000)', monthly:esicEmployer, annual:esicEmployer*12, remark:'In CTC' })
  rows.push({ kind:'sum', label:'Fixed CTC Package', basis:'gross + employer contributions', monthly:fixedMonthly, annual:fixedMonthly*12 })
  if (variable > 0) rows.push({ kind:'muted', label:'Variable / Performance CTC', monthly:variable/12, annual:variable })
  rows.push({ kind:'total', label:'Total Annual CTC Package', monthly:ctcAnnual/12, annual:ctcAnnual })
  rows.push({ kind:'head', label:'Employee deductions & net in-hand' })
  rows.push({ kind:'sum', label:'Gross Earnings (A)', monthly:gross, annual:gross*12 })
  rows.push({ kind:'ded', label:'(−) Employee PF', basis:'12% of Basic', monthly:epfEmployee, annual:epfEmployee*12, remark:'Deduction' })
  if (esic) rows.push({ kind:'ded', label:'(−) Employee ESIC', basis:'0.75% of Basic', monthly:esicEmployee, annual:esicEmployee*12, remark:'Deduction' })
  rows.push({ kind:'net', label:'Net In-Hand Salary', basis:'before TDS', monthly:inHand, annual:inHand*12 })
  rows.push({ kind:'note', label:'Net in-hand is shown before income tax (TDS). Use the calculator below to compare TDS under the old and new regimes.' })
  return { rows, basic, gross, epfEmployee, esicEmployee, inHand, fixedMonthly, special }
}
