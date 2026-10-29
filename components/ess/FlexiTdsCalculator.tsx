'use client'
// components/ess/FlexiTdsCalculator.tsx — Flexi + TDS calculator for the ESS Flexi section.
// Logic ported from the OFB TDS portal: 9 salary slabs, flexi wallet (Old/New regime),
// HRA exemption, 80C/80D/NPS/other deductions, old-vs-new regime tax comparison.
// EZER-themed. CTC auto-prefilled from the employee's ctc_master.
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { loadSalary, type SalaryStructure } from '@/lib/employees/hr-actions'
import * as XLSX from 'xlsx'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'
import PayStyles from '@/components/ess/payroll/PayStyles'

const P = {
  navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep, border: TK.line, muted: TK.muted,
  bg: TK.canvas, card: TK.surface, green: TK.positive, greenBg: TK.positiveTint, amber: TK.warning, amberBg: TK.warningTint,
  red: TK.critical, redBg: TK.criticalTint, teal: TK.positive, tealBg: TK.sunken, purpleBg: TK.brandTint,
}

// ── Policy constants (OFB flexi + FY 2026-27 tax) ──
const SLAB_LABELS = ['≤5 LPA', '5.1–7.99 LPA', '8–11.99 LPA', '12–17.99 LPA', '18–24.99 LPA', '25–29.99 LPA', '30–39.99 LPA', '40–49.99 LPA', '50+ LPA']
const OLD: Record<string, number>[] = [
  {},
  { pda: 18000, fuel: 60000, meal: 55000, attire: 40000, childEdu: 36000, hostel: 84000 },
  { pda: 24000, device: 50000, fuel: 96000, meal: 55000, attire: 48000, childEdu: 36000, hostel: 84000 },
  { pda: 30000, tel: 18000, device: 50000, fuel: 144000, meal: 55000, attire: 60000, childEdu: 36000, hostel: 84000 },
  { pda: 36000, tel: 18000, device: 90000, lta: 1, car: 216000, driver: 144000, fuel: 144000, meal: 80000, attire: 60000, childEdu: 36000, hostel: 84000 },
  { pda: 48000, tel: 18000, device: 130000, lta: 1, car: 300000, driver: 192000, fuel: 160000, meal: 96000, attire: 78000, childEdu: 36000, hostel: 84000 },
  { pda: 54000, tel: 18000, device: 150000, lta: 1, car: 360000, driver: 240000, fuel: 192000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
  { pda: 60000, tel: 18000, device: 200000, lta: 1, car: 420000, driver: 240000, fuel: 240000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
  { pda: 60000, tel: 18000, device: 200000, lta: 1, car: 600000, driver: 240000, fuel: 300000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
]
const NEW: Record<string, number>[] = [
  {}, {},
  { device: 50000, fuel: 96000, meal: 55000 },
  { tel: 18000, device: 50000, fuel: 144000, meal: 55000 },
  { tel: 18000, device: 90000, car: 216000, driver: 144000, fuel: 144000, meal: 80000 },
  { tel: 18000, device: 130000, car: 300000, driver: 192000, fuel: 160000, meal: 96000 },
  { tel: 18000, device: 150000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
  { tel: 18000, device: 200000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
  { tel: 18000, device: 200000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
]
const COMPS: { k: string; l: string; perq?: boolean }[] = [
  { k: 'pda', l: 'Professional Dev. Allowance' }, { k: 'tel', l: 'Telephone / WiFi Bill' },
  { k: 'device', l: 'Device Leasing' }, { k: 'lta', l: 'Leave Travel Allowance' },
  { k: 'car', l: 'Car Lease', perq: true }, { k: 'driver', l: 'Driver Allowance', perq: true },
  { k: 'fuel', l: 'Fuel Reimbursement' }, { k: 'meal', l: 'Meal Coupon (Zaggle)' },
  { k: 'attire', l: 'Corporate Attire' }, { k: 'childEdu', l: "Children's Education" }, { k: 'hostel', l: 'Hostel Allowance' },
]
const PERQ_ANN = (7000 + 3000) * 12

const R = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const N = (v: any) => parseFloat(v) || 0
const getSlab = (c: number) => { const l = c / 1e5; if (l <= 5) return 0; if (l <= 7.99) return 1; if (l <= 11.99) return 2; if (l <= 17.99) return 3; if (l <= 24.99) return 4; if (l <= 29.99) return 5; if (l <= 39.99) return 6; if (l <= 49.99) return 7; return 8 }
const oldTax = (t: number) => { if (t <= 250000) return 0; if (t <= 500000) return (t - 250000) * .05; if (t <= 1000000) return 12500 + (t - 500000) * .2; return 112500 + (t - 1000000) * .3 }
const newTax = (t: number) => { if (t <= 400000) return 0; if (t <= 800000) return (t - 400000) * .05; if (t <= 1200000) return 20000 + (t - 800000) * .1; if (t <= 1600000) return 60000 + (t - 1200000) * .15; if (t <= 2000000) return 120000 + (t - 1600000) * .2; if (t <= 2400000) return 200000 + (t - 2000000) * .25; return 300000 + (t - 2400000) * .3 }
function finalize(base: number, inc: number, isNew: boolean) {
  const r = isNew ? (inc <= 1200000 ? base : 0) : (inc <= 500000 ? Math.min(base, 12500) : 0)
  const a = Math.max(0, base - r)
  const sc = inc > 5e7 ? (isNew ? .25 : .37) : inc > 2e7 ? .25 : inc > 1e7 ? .15 : inc > 5e6 ? .1 : 0
  return Math.round((a + a * sc) * 1.04)
}
function hraCalcPeriod(monthlyHRA: number, basic: number, rentM: number, fromM: number, toM: number, metro: boolean) {
  if (!rentM || fromM > toM) return 0
  const mo = toM - fromM + 1
  const hraP = monthlyHRA * mo, rentP = rentM * mo, basicP = (basic / 12) * mo
  return Math.min(hraP, Math.max(0, rentP - basicP * .1), basicP * (metro ? .5 : .4))
}

const MONTHS = ['April 2026', 'May 2026', 'June 2026', 'July 2026', 'August 2026', 'September 2026', 'October 2026', 'November 2026', 'December 2026', 'January 2027', 'February 2027', 'March 2027']

// ── styles ── The surfaces come from PayStyles (the ezp-* classes, same look as ESS → Leave);
// these few inline pieces cover what the sheet has no class for, all on theme tokens.
const s = {
  // A sub-section heading inside a declaration panel (HRA, 80C, …).
  sec: { fontSize: 11, fontWeight: 700, color: P.muted, textTransform: 'uppercase' as const, letterSpacing: '.05em', margin: '18px 0 10px', paddingTop: 14, borderTop: `1px solid ${P.border}` } as React.CSSProperties,
  // A sunken well — child boxes, HRA periods.
  well: { background: TK.sunken, border: `1px solid ${P.border}`, borderRadius: 10, padding: 12, marginBottom: 12 } as React.CSSProperties,
  // A label · value total line on a sunken strip.
  tot: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, background: TK.sunken, border: `1px solid ${P.border}`, color: P.navy, fontVariantNumeric: 'tabular-nums' } as React.CSSProperties,
  // The header row of the salary-structure and flexi grid tables.
  th: { fontSize: 11, fontWeight: 600, color: P.muted, background: TK.sunken, borderBottom: `1px solid ${P.border}` } as React.CSSProperties,
}

function Fg({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="ezp-field" style={{ marginBottom: 12 }}><label className="ezp-label">{label}</label>{children}</div>
}

/** `sandbox`: the Help → TDS Calculator for HR. Nothing is saved and no declaration is read —
 *  only the chosen employee's CTC and joining date are prefilled (or nothing, with no employee),
 *  and every figure stays editable. The employee's own Flexi section is the non-sandbox use. */
export default function FlexiTdsCalculator({ employeeId, empName, empCode, sandbox = false }: { employeeId: string; empName?: string; empCode?: string; sandbox?: boolean }) {
  const [step, setStep] = useState(1)
  const [f, setF] = useState<Record<string, string>>({
    ctc: '', variable: '', doj: '',
    rentM: '', hra1From: '1', hra1To: '12', cityType: 'nonmetro', landlordPAN: '',
    showHra2: '', rentM2: '', hra2From: '7', hra2To: '12', cityType2: 'nonmetro', landlordPAN2: '',
    lic: '', ppf: '', elss: '', tuit: '', hlP: '',
    medSelf: '', medParents: '', hlInt: '', hlLoanNo: '',
    npsSelf: '0', emplrNpsOld: '0', emplrNpsNew: '0',
    eduLoan: '', eduLoanNo: '', dep80dd: '0', dis80ddb: '', pmFund: '',
    oi: '', bon: '', iinc: '', varEx: '', iInc: '',
  })
  const [oFlexi, setOFlexi] = useState<Record<string, number>>({})
  const [nFlexi, setNFlexi] = useState<Record<string, number>>({})
  const [child, setChild] = useState({ count: 0, c1: { school: false, hostel: false }, c2: { school: false, hostel: false } })
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }))

  // Regime declaration: OLD / NEW chosen by the employee, stored in DB.
  const FY = '2026-27'
  const [chosenRegime, setChosenRegime] = useState<'OLD' | 'NEW' | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [defaultedNew, setDefaultedNew] = useState(false)   // mid-year joiner auto-defaulted to New
  const [userPicked, setUserPicked] = useState(false)       // has the employee explicitly chosen a regime?
  // Set by the "no election by the 4th ⇒ New" rule (072). Shown, not enforced — the
  // employee may still submit their own choice, which overwrites the default.
  const [defaultedByRule, setDefaultedByRule] = useState<string | null>(null)
  const [status, setStatus] = useState<'NEW' | 'DRAFT' | 'SUBMITTED'>('NEW')
  const [editMode, setEditMode] = useState<null | 'flexi' | 'all'>(null)  // after submit: what can be edited
  const [draftMsg, setDraftMsg] = useState('')
  const norm = (v: any): 'OLD' | 'NEW' => String(v || '').toUpperCase().includes('NEW') ? 'NEW' : 'OLD'

  // Read/write gates. Once SUBMITTED everything locks; Edit unlocks only the allowed sections:
  // Old regime → flexi + investments; New regime → flexi only. Regime itself never changes after submit.
  const isSubmitted = status === 'SUBMITTED'
  const flexiRW  = !isSubmitted || editMode === 'flexi' || editMode === 'all'
  const investRW = !isSubmitted || editMode === 'all'
  const basicRW  = !isSubmitted || editMode === 'all'
  const regimeLocked = isSubmitted
  const viewLocked = isSubmitted && !editMode
  const fsReset: React.CSSProperties = { border: 'none', padding: 0, margin: 0, minInlineSize: 'auto' }

  // Prefill CTC / variable + DOJ, restore any saved draft/submission, set the default regime.
  useEffect(() => {
    if (!employeeId) return   // sandbox with nobody chosen: a blank calculator
    (async () => {
      const [{ data: cm }, { data: emp }, declRes, formRes] = await Promise.all([
        supabase.from('ctc_master').select('annual_ctc, annual_variable').eq('employee_id', employeeId).order('effective_from', { ascending: false }).limit(1),
        supabase.from('employees').select('company_id, company_doj, group_doj, tds_regime').eq('id', employeeId).maybeSingle(),
        supabase.from('tds_declarations').select('regime, declaration_status').eq('employee_id', employeeId).eq('fy', FY).maybeSingle().then(r => r, () => ({ data: null })),
        supabase.from('flexi_tds_forms').select('regime, status, form_data').eq('employee_id', employeeId).eq('fy', FY).maybeSingle().then(r => r, () => ({ data: null })),
      ])
      setCompanyId((emp as any)?.company_id || null)
      const doj = (emp as any)?.company_doj || (emp as any)?.group_doj
      if (sandbox) {
        // A calculation, not this employee's declaration: CTC + DOJ only, nothing restored.
        if (cm?.[0]) setF(p => ({ ...p, ctc: String(Math.round(cm[0].annual_ctc || 0)) || '', variable: String(Math.round(cm[0].annual_variable || 0)) }))
        if (doj) setF(p => ({ ...p, doj: String(doj).slice(0, 10) }))
        return
      }

      // ── Restore a previously saved form (draft or submitted) — every field comes back ──
      const savedForm: any = (formRes as any)?.data
      if (savedForm?.form_data) {
        const fd = savedForm.form_data || {}
        if (fd.f) setF(p => ({ ...p, ...fd.f }))
        if (fd.oFlexi) setOFlexi(fd.oFlexi)
        if (fd.nFlexi) setNFlexi(fd.nFlexi)
        if (fd.child) setChild(fd.child)
        if (savedForm.regime) { setChosenRegime(norm(savedForm.regime)); setUserPicked(true) }
        setStatus(savedForm.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT')
        if (savedForm.status === 'SUBMITTED') setSaved(true)
        // CTC, variable and DOJ always come from the record, never from the saved form: they
        // are not the employee's to change, and a form saved before a revision holds stale pay.
        if (cm?.[0]) setF(p => ({ ...p, ctc: String(Math.round(cm[0].annual_ctc || 0)), variable: String(Math.round(cm[0].annual_variable || 0)) }))
        if (doj) setF(p => ({ ...p, doj: String(doj).slice(0, 10) }))
        return
      }

      // ── No saved form — fresh prefill ──
      if (cm?.[0]) setF(p => ({ ...p, ctc: String(Math.round(cm[0].annual_ctc || 0)), variable: String(Math.round(cm[0].annual_variable || 0)) }))
      if (doj) setF(p => ({ ...p, doj: String(doj).slice(0, 10) }))

      // Default regime: submitted declaration → saved tds_regime → (mid-year joiner, no declaration ⇒ NEW).
      const decl: any = (declRes as any)?.data
      if (decl?.declaration_status === 'SUBMITTED' && decl?.regime) { setChosenRegime(norm(decl.regime)); setUserPicked(true); return }
      if (decl?.declaration_status === 'DEFAULTED') setDefaultedByRule(decl.updated_at || decl.created_at || 'the 5th')
      if ((emp as any)?.tds_regime) { setChosenRegime(norm((emp as any).tds_regime)); setUserPicked(true); return }
      if (doj) {
        const d = new Date(String(doj).slice(0, 10)).getTime()
        const fyStart = Date.UTC(2026, 3, 1), fyEnd = Date.UTC(2027, 2, 31)
        if (d > fyStart && d <= fyEnd) { setChosenRegime('NEW'); setDefaultedNew(true) }
      }
    })()
  }, [employeeId])

  // Persist the full calculator state to flexi_tds_forms (draft or submitted).
  async function persistForm(newStatus: 'DRAFT' | 'SUBMITTED') {
    if (sandbox) return { error: { message: 'The Help calculator does not save.' } }
    const payload = {
      employee_id: employeeId, company_id: companyId, fy: FY,
      regime: chosenRegime, status: newStatus,
      form_data: { f, oFlexi, nFlexi, child },
      submitted_at: newStatus === 'SUBMITTED' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    return supabase.from('flexi_tds_forms').upsert(payload, { onConflict: 'employee_id,fy' })
  }

  async function saveDraft() {
    setDraftMsg(''); setSaving(true)
    const { error } = await persistForm('DRAFT')
    setSaving(false)
    if (error) { setDraftMsg('⚠ ' + error.message); return }
    setStatus('DRAFT')
    setDraftMsg('Draft saved. You can leave and return anytime')
    setTimeout(() => setDraftMsg(''), 3500)
  }

  // The employee's ACTUAL salary structure, from the same loader the Employee Master
  // uses (lib/employees/hr-actions → loadSalary). Both screens therefore render one
  // computation, so a figure can never read differently in one place than the other.
  const [real, setReal] = useState<SalaryStructure | null>(null)
  useEffect(() => { if (employeeId) loadSalary(employeeId).then(setReal).catch(() => setReal(null)) }, [employeeId])
  const rd = real?.detail || null

  // ── Derived salary ──
  const sal = useMemo(() => {
    const ctc = N(f.ctc), vari = N(f.variable)
    const fixed = ctc - vari
    if (rd) {
      // Real structure — annualise the stored monthly figures rather than assuming
      // Basic is 50% of Fixed and HRA 50% of Basic.
      const basic = rd.basic * 12, hra = rd.hra * 12, epf = rd.erPf * 12
      // Wallet = the GROSS Special Allowance. rd.special is already net of what has
      // been declared, so using it would shrink the budget as the employee declares.
      const other = Math.round((rd.specialGross || rd.special) * 12)
      return { ctc, vari, fixed, basic, hra, epf, lta8: Math.round(basic * .0833), other, si: getSlab(ctc) }
    }
    const basic = fixed * .5, hra = basic * .5
    const epf = Math.min((basic / 12) * .12, 1800) * 12, lta8 = Math.round(basic * .0833), other = Math.max(0, fixed - basic - hra - epf)
    return { ctc, vari, fixed, basic, hra, epf, lta8, other, si: getSlab(ctc) }
  }, [f.ctc, f.variable, rd])

  // ── Joining-date pro-ration for FY 2026-27 (1 Apr 2026 – 31 Mar 2027) ──
  // DOJ on/before 1 Apr 2026 → full 12 months. DOJ after → pro-rata on worked days,
  // with TDS spread over the remaining pay months.
  const join = useMemo(() => {
    const full = { pr: 1, months: 12, mid: false }
    if (!f.doj) return full
    const parts = f.doj.split('-').map(Number)
    if (parts.length < 3 || !parts[0]) return full
    const [y, mo, day] = parts
    const doj = Date.UTC(y, mo - 1, day)
    const fyStart = Date.UTC(2026, 3, 1), fyEnd = Date.UTC(2027, 2, 31)
    if (doj <= fyStart || doj > fyEnd) return full            // joined before this FY (or future) → full year
    const totalDays = Math.round((fyEnd - fyStart) / 86400000) + 1
    const workedDays = Math.round((fyEnd - doj) / 86400000) + 1
    const fyMonth = mo >= 4 ? mo - 3 : mo + 9                  // April=1 … March=12
    return { pr: Math.min(1, workedDays / totalDays), months: Math.max(1, 13 - fyMonth), mid: true }
  }, [f.doj])

  const schoolCount = (child.count >= 1 && child.c1.school ? 1 : 0) + (child.count >= 2 && child.c2.school ? 1 : 0)
  const hostelCount = (child.count >= 1 && child.c1.hostel ? 1 : 0) + (child.count >= 2 && child.c2.hostel ? 1 : 0)
  const getOldLimit = (k: string) => {
    const b = OLD[sal.si] || {}
    if (k === 'lta') return b.lta ? sal.lta8 : 0
    if (k === 'childEdu') return schoolCount > 0 ? (b.childEdu || 0) * schoolCount : 0
    if (k === 'hostel') return hostelCount > 0 ? (b.hostel || 0) * hostelCount : 0
    return b[k] || 0
  }
  const getNewLimit = (k: string) => (NEW[sal.si] || {})[k] || 0

  function setFlexi(rg: 'old' | 'new', k: string, v: number) {
    const upd = (prev: Record<string, number>, gl: (k: string) => number) => {
      const nx = { ...prev, [k]: v }
      if (k === 'car') nx.driver = v > 0 ? gl('driver') : 0
      if (k === 'driver') nx.car = v > 0 ? gl('car') : 0
      return nx
    }
    if (rg === 'old') setOFlexi(p => upd(p, getOldLimit)); else setNFlexi(p => upd(p, getNewLimit))
  }

  const oTot = Object.values(oFlexi).reduce((a, b) => a + (b || 0), 0)
  const nTot = Object.values(nFlexi).reduce((a, b) => a + (b || 0), 0)

  const hraExempt = useMemo(() => {
    if (!sal.basic) return 0
    const mHRA = sal.hra / 12
    const p1 = hraCalcPeriod(mHRA, sal.basic, N(f.rentM), +f.hra1From, +f.hra1To, f.cityType === 'metro')
    let p2 = 0
    if (f.showHra2) p2 = hraCalcPeriod(mHRA, sal.basic, N(f.rentM2), +f.hra2From, +f.hra2To, f.cityType2 === 'metro')
    return p1 + p2
  }, [f, sal])

  // ── Tax computation (with joining-date pro-ration) ──
  const T = useMemo(() => {
    const { ctc, basic, hra, epf, vari, other, si } = sal
    if (!ctc) return null
    const pr = join.pr, months = join.months
    // Salary income is earned only for the worked portion of the FY → pro-rate.
    const eBasic = basic * pr, eHra = hra * pr, eEpf = epf * pr, eOther = other * pr, eVari = vari * pr
    const earnedCtc = ctc * pr
    const hE = hraExempt                                              // period-based (worked months)
    // c80 = manual investments (full) + employee PF (salary-linked → pro-rated), capped ₹1.5L
    const c80 = Math.min(N(f.lic) + N(f.ppf) + N(f.elss) + eEpf + N(f.tuit) + N(f.hlP), 150000)
    const medS = Math.min(N(f.medSelf), 25000), medP = Math.min(N(f.medParents), 50000)   // actual → full
    const hlI = Math.min(N(f.hlInt), 200000)
    const npsS = N(f.npsSelf)                                          // actual investment → full
    const eNpsO = f.emplrNpsOld === 'on' ? Math.round(eBasic * .1) : 0 // employer NPS is salary-linked → pro-rated
    const eNpsN = f.emplrNpsNew === 'on' ? Math.round(eBasic * .14) : 0
    const eduLoan = Math.min(N(f.eduLoan), 200000)
    const dep80dd = N(f.dep80dd), dis80ddb = Math.min(N(f.dis80ddb), 100000), pmFund = Math.min(N(f.pmFund), 200000)
    const addI = N(f.oi) + N(f.bon) + N(f.iinc) + N(f.varEx) + N(f.iInc)  // actual income → full
    // Flexi claimed & perquisite are salary-wallet-linked → pro-rated.
    const oClaim = Math.round(oTot * pr), nClaim = Math.round(nTot * pr)
    const ltaAmt = Math.round((oFlexi.lta || 0) * pr)
    const oPerq = (oFlexi.car || 0) > 0 ? Math.round(PERQ_ANN * pr) : 0
    const nPerq = (nFlexi.car || 0) > 0 ? Math.round(PERQ_ANN * pr) : 0
    const walBalO = Math.max(0, eOther - oClaim), walBalN = Math.max(0, eOther - nClaim)
    const grossO = eBasic + (eHra - hE) + walBalO + eVari + addI + oPerq
    const grossN = eBasic + eHra + walBalN + eVari + addI + nPerq
    const extraOldDed = eduLoan + dep80dd + dis80ddb + pmFund
    const gO = earnedCtc + addI + oPerq, dO = 50000 + hE + ltaAmt + oClaim + c80 + medS + medP + hlI + npsS + eNpsO + eEpf + extraOldDed
    const tO = Math.max(0, gO - dO), bO = oldTax(tO), fO = finalize(bO, tO, false)
    const gN = earnedCtc + addI + nPerq, dN = 75000 + nClaim + eNpsN + eEpf
    const tN = Math.max(0, gN - dN), bN = newTax(tN), fN = finalize(bN, tN, true)
    const denom = earnedCtc || ctc
    return {
      gO, dO, tO, bO, fO, moO: Math.round(fO / months), efO: (fO / denom * 100).toFixed(2),
      gN, dN, tN, bN, fN, moN: Math.round(fN / months), efN: (fN / denom * 100).toFixed(2),
      hE, c80, medS, medP, hlI, npsS, eNpsO, eNpsN, eduLoan, dep80dd, dis80ddb, pmFund,
      ltaAmt, addI, oPerq, nPerq, walBalO, walBalN, grossO, grossN, si,
      eBasic, eHra, eOther, eVari, oClaim, nClaim, months, pr, mid: join.mid,
    }
  }, [sal, hraExempt, f, oFlexi, nFlexi, oTot, nTot, join])

  // Recommended regime = the one with the LOWER annual tax.
  const recRegime: 'OLD' | 'NEW' | null = T ? (T.fO <= T.fN ? 'OLD' : 'NEW') : null
  // Default selection follows the lower-tax regime until the employee explicitly picks (or it's locked).
  useEffect(() => {
    if (recRegime && !userPicked && !isSubmitted) setChosenRegime(recRegime)
  }, [recRegime, userPicked, isSubmitted])

  // ── Stepper ──
  const STEPS = ['Employee & Salary', 'Flexi Declaration', 'Investments', 'TDS Report']
  const Stepper = () => (
    <div className="ezp-panel" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '10px 12px' }}>
      {STEPS.map((lbl, i) => {
        const n = i + 1, active = step === n, done = step > n
        return (
          <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => n <= step && setStep(n)} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 12px 0 6px', borderRadius: 99, border: `1px solid ${active ? TK.brandDeep : done ? TK.brandEdge : P.border}`, background: active ? TK.brand : done ? P.purpleBg : TK.surface, color: active ? TK.onAccent : done ? P.purpleDark : P.muted, fontSize: 12, fontWeight: 600, cursor: n <= step ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, background: active ? TK.onAccent : done ? TK.brand : TK.sunken, color: active ? TK.brand : done ? TK.onAccent : P.muted, border: active || done ? 'none' : `1px solid ${P.border}`, fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{done ? '' : n}</span>
              {lbl}
            </button>
            {i < 3 && <span style={{ width: 14, height: 2, background: step > n ? TK.brandEdge : P.border, borderRadius: 2 }} />}
          </div>
        )
      })}
    </div>
  )

  // ── STEP 1 — Employee & salary ──
  const step1 = (
    <div>
      <div className="ezp-panel">
        <div className="ezp-head"><h3>Employee Information</h3></div>
        {/* An employee's CTC, variable and DOJ are HR's record, not inputs — the declaration and
            the TDS projection must be worked on the pay payroll will actually run. Only the
            Help → TDS Calculator sandbox (a what-if for hiring managers / HR) edits them. */}
        <p className="ezp-sub">{sandbox ? 'Prefilled from the record when an employee is picked. Adjust CTC / variable to try a different package.' : 'From your salary record. If any of this is wrong, raise it with HR — it cannot be changed here.'}</p>
        <div className="ezp-grid2" style={{ columnGap: 12, rowGap: 0 }}>
          <Fg label="Employee Name"><input className="ezp-input" value={empName || ''} readOnly /></Fg>
          <Fg label="Employee Code"><input className="ezp-input" value={empCode || ''} readOnly /></Fg>
          {sandbox ? <>
            <Fg label="Annual CTC (₹)"><input className="ezp-input" type="number" value={f.ctc} onChange={e => set('ctc', e.target.value)} placeholder="e.g. 1500000" /></Fg>
            <Fg label="Date of Joining"><input className="ezp-input" type="date" value={f.doj} onChange={e => set('doj', e.target.value)} /></Fg>
            <Fg label="Annual Variable Pay (₹)"><input className="ezp-input" type="number" value={f.variable} onChange={e => set('variable', e.target.value)} placeholder="0 if none" /></Fg>
          </> : <>
            <Fg label="Annual CTC (₹)"><input className="ezp-input" style={{ cursor: 'default' }} value={f.ctc ? R(N(f.ctc)) : 'Not on record'} readOnly tabIndex={-1} /></Fg>
            <Fg label="Date of Joining"><input className="ezp-input" style={{ cursor: 'default' }} value={f.doj ? new Date(f.doj + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not on record'} readOnly tabIndex={-1} /></Fg>
            <Fg label="Annual Variable Pay (₹)"><input className="ezp-input" style={{ cursor: 'default' }} value={f.ctc ? R(N(f.variable)) : 'Not on record'} readOnly tabIndex={-1} /></Fg>
          </>}
        </div>
      </div>
      {/* Actual salary structure — identical rows, order and figures to
          Employee Master → View → Salary, because both read one loader. */}
      {rd && (
        <div className="ezp-panel">
          <div className="ezp-head">
            <h3>Your Salary Structure</h3>
            <span className="ezp-chip is-ok">
              ✓ as per your record
            </span>
            {rd.payType && rd.payType !== 'Regular' && (
              <span className="ezp-chip is-brand">{rd.payType}</span>
            )}
          </div>

          <div className="ezp-stats" style={{ marginBottom: 12 }}>
            {[
              { l: 'Annual CTC', v: rd.totalCtc || rd.annualCtc, c: 'is-brand' },
              { l: 'Net Take-home / mo', v: rd.net, c: 'is-ok' },
              { l: 'Fixed / mo', v: rd.fixedMonthly, c: '' },
            ].map(x => (
              <div key={x.l} className="ezp-stat">
                <div className="ezp-stat-name">{x.l}</div>
                <div className={`ezp-stat-num ${x.c}`}>{R(x.v)}</div>
              </div>
            ))}
          </div>

          <div className="ezp-table-wrap">
            <div style={{ ...s.th, display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', padding: '9px 12px', letterSpacing: '.03em' }}>
              <span>COMPONENT</span><span style={{ textAlign: 'right' }}>MONTHLY</span><span style={{ textAlign: 'right' }}>ANNUAL</span>
            </div>
            {(() => {
              const M = (v: number) => v * 12
              const Row = ({ label, m, kind }: { label: string; m: number; kind?: 'sub' | 'net' | 'total' }) => (
                <div style={{
                  display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', padding: '9px 12px', borderTop: `1px solid ${TK.line}`,
                  background: kind === 'total' ? TK.brandTint : kind === 'net' ? TK.positiveTint : kind === 'sub' ? TK.sunken : TK.surface,
                  fontWeight: kind ? 700 : 400, fontVariantNumeric: 'tabular-nums',
                  color: kind === 'total' ? TK.brandDeep : kind === 'net' ? TK.positive : TK.ink,
                }}>
                  <span style={{ fontSize: 12.5 }}>{label}</span>
                  <span style={{ fontSize: 12.5, textAlign: 'right' }}>{R(m)}</span>
                  <span style={{ fontSize: 12.5, textAlign: 'right' }}>{R(M(m))}</span>
                </div>
              )
              return (
                <>
                  <Row label="Basic" m={rd.basic} />
                  <Row label="HRA" m={rd.hra} />
                  {rd.statBonus > 0 && <Row label="Statutory Bonus" m={rd.statBonus} />}
                  {rd.conveyance > 0 && <Row label="Conveyance" m={rd.conveyance} />}
                  {rd.special > 0 && <Row label="Special Allowance" m={rd.special} />}
                  {rd.flexiMonthly > 0 && <Row label="Flexi (declared)" m={rd.flexiMonthly} />}
                  <Row label="Gross" m={rd.gross} kind="sub" />
                  {rd.erPf > 0 && <Row label="Employer PF" m={rd.erPf} />}
                  {rd.erEsic > 0 && <Row label="Employer ESIC" m={rd.erEsic} />}
                  {rd.gratuity > 0 && <Row label="Gratuity" m={rd.gratuity} />}
                  {(rd.eePf > 0 || rd.eeEsic > 0 || rd.pt > 0 || rd.lwf > 0) && (
                    <div style={{ padding: '7px 12px', background: TK.sunken, fontSize: 10.5, fontWeight: 700, color: TK.muted, letterSpacing: '.05em', borderTop: `1px solid ${TK.line}` }}>DEDUCTIONS</div>
                  )}
                  {rd.eePf > 0 && <Row label="Employee PF" m={rd.eePf} />}
                  {rd.eeEsic > 0 && <Row label="Employee ESIC" m={rd.eeEsic} />}
                  {rd.pt > 0 && <Row label="Professional Tax" m={rd.pt} />}
                  {rd.lwf > 0 && <Row label="LWF" m={rd.lwf} />}
                  <Row label="Net Take-home" m={rd.net} kind="net" />
                  <Row label="Fixed" m={rd.fixedMonthly} kind="sub" />
                  {rd.variableAnnual > 0 && <Row label="Variable" m={Math.round(rd.variableAnnual / 12)} />}
                  <Row label="Total CTC" m={Math.round(rd.totalCtc / 12)} kind="total" />
                </>
              )
            })()}
          </div>
          <div className="ezp-hint">
            FY 2026-27 salary structure: the same figures shown in your HR record. Monthly amounts are pro-rated on actual paid days during payroll.
          </div>
        </div>
      )}

      {sal.ctc > 0 && (
        <div className="ezp-panel">
          <div className="ezp-head">
            <h3>{rd ? 'Flexi Wallet Basis' : 'Salary Breakup'}</h3>
            <span className="ezp-chip is-brand">Slab: {SLAB_LABELS[sal.si]}</span>
          </div>
          {/* Monthly is shown first and largest because that is the figure the HR record
              (Employee Master → Salary) displays. The annual number sits beside it, labelled,
              so the wallet budget can't be mistaken for a different Special Allowance. */}
          <div style={{ background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, borderRadius: 10, padding: '14px 16px', color: TK.ink, fontVariantNumeric: 'tabular-nums' }}>
            <div style={{ fontSize: 12, color: P.muted }}>Flexi Wallet {rd ? '(funded by Special Allowance)' : '(Other Reimbursement)'}</div>
            {rd ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', margin: '4px 0 2px' }}>
                <div>
                  <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', color: TK.brandDeep }}>{R(rd.specialGross || rd.special)}</span>
                  <span style={{ fontSize: 12, color: P.muted, marginLeft: 5 }}>per month</span>
                </div>
                <div style={{ color: TK.brandEdge }}>|</div>
                <div>
                  <span style={{ fontSize: 17, fontWeight: 700 }}>{R(sal.other)}</span>
                  <span style={{ fontSize: 12, color: P.muted, marginLeft: 5 }}>per year</span>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', color: TK.brandDeep }}>{R(sal.other)}</div>
                <div style={{ fontSize: 11.5, color: P.muted }}>Fixed − Basic − HRA − PF</div>
              </>
            )}
            {rd && <div style={{ fontSize: 11.5, color: P.muted }}>Your full Special Allowance: {R(rd.specialGross || rd.special)}/month. {rd.flexiMonthly > 0 ? `${R(rd.flexiMonthly)}/month already declared, ${R(Math.max(0,(rd.specialGross||rd.special)-rd.flexiMonthly))} left.` : ''}</div>}
          </div>
          <div className="ezp-note" style={{ margin: '10px 0 0' }}>
            {rd
              ? <><b>Source:</b> full Special Allowance <b>{R(rd.specialGross || rd.special)}/month</b> × 12 = <b>{R(sal.other)} annual wallet</b>. Declared flexi is deducted from the Special Allowance paid as salary.</>
              : <><b>Formula:</b> {R(sal.fixed)} − {R(sal.basic)} (Basic) − {R(sal.hra)} (HRA) − {R(sal.epf)} (PF) = <b>Flexi Wallet {R(sal.other)}</b></>}
          </div>
        </div>
      )}
      {sal.ctc > 0 && join.mid && (
        <div className="ezp-note">
          <span className="ezp-note-t">Mid-year joining: pro-rata applies</span>
          <div>You are with the company for <b>{join.months} month{join.months === 1 ? '' : 's'}</b> of FY 2026-27, so your salary income is earned for ≈<b>{Math.round(join.pr * 100)}%</b> of the year. Tax is computed on this pro-rated income and the <b>monthly TDS is spread over the {join.months} remaining pay month{join.months === 1 ? '' : 's'}</b>. (Employees who joined on/before 1 Apr 2026 are taxed on the full 12 months.)</div>
        </div>
      )}
      {sal.ctc > 0 && !join.mid && f.doj && (
        <div className="ezp-hint" style={{ margin: '0 4px 12px' }}>Joined on/before 1 Apr 2026: taxed on the full financial year.</div>
      )}
    </div>
  )

  // ── STEP 2 — Flexi declaration ──
  const carSel = (oFlexi.car || 0) > 0 || (nFlexi.car || 0) > 0
  const WalletBar = ({ title, used, io }: { title: string; used: number; io: boolean }) => {
    const bud = sal.other, pctv = bud > 0 ? Math.min(used / bud * 100, 100) : 0, ov = used > bud + 1
    const tone = ov ? 'bad' : pctv > 80 ? 'warn' : io ? 'warn' : 'ok'
    return (
      <div className="ezp-panel">
        <div className="ezp-head" style={{ marginBottom: 10 }}>
          <h3>{io ? '' : ''} {title}</h3>
          <span className={`ezp-head-meta ezp-num ezp-${tone}`} style={{ fontWeight: 700 }}>{ov ? 'EXCEEDED!' : R(Math.max(0, bud - used)) + ' left'}</span>
        </div>
        <div className="ezp-meter"><i className={`is-${tone}`} style={{ width: pctv + '%' }} /></div>
        <div className="ezp-meter-cap"><span>Used: {R(used)}</span><span>Budget: {R(bud)}</span></div>
        {ov && <div className="ezp-note is-bad" style={{ margin: '10px 0 0' }}>Flexi wallet limit exceeded. Remove some allowances.</div>}
      </div>
    )
  }
  const step2 = (
    <div>
      {carSel && (
        <div className="ezp-note is-warn">
          <span className="ezp-note-t" style={{ marginBottom: 8 }}>Car Lease + Driver: Perquisite Tax Applied</span>
          <div className="ezp-stats">
            {[['Car Lease Perq', '₹7,000', 'per month'], ['Driver Perq', '₹3,000', 'per month'], ['Total Perquisite', '₹10,000', '₹1,20,000/yr → taxable']].map(([l, v, sub]) => (
              <div key={l} className="ezp-stat">
                <div className="ezp-stat-name">{l}</div><div className="ezp-stat-num is-warn">{v}</div><div className="ezp-muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, marginTop: 8 }}>Car lease is tax-exempt; Car + Driver are always selected together.</div>
        </div>
      )}
      <div className="ezp-panel">
        <div className="ezp-head"><h3>👨‍👩‍👧 Children Details</h3><span className="ezp-chip is-warn">(Old Regime only)</span></div>
        <p className="ezp-sub">Affects Children&apos;s Education &amp; Hostel Allowance limits</p>
        <div style={{ maxWidth: 240 }}>
          <Fg label="Number of Children">
            <select className="ezp-input" value={child.count} onChange={e => setChild(c => ({ ...c, count: +e.target.value }))}>
              <option value={0}>0 children</option><option value={1}>1 child</option><option value={2}>2 children (max)</option>
            </select>
          </Fg>
        </div>
        {child.count > 0 && (
          <div className="ezp-grid2">
            {[1, 2].slice(0, child.count).map(n => {
              const cd = n === 1 ? child.c1 : child.c2
              const upd = (patch: any) => setChild(c => ({ ...c, [n === 1 ? 'c1' : 'c2']: { ...cd, ...patch } }))
              return (
                <div key={n} style={{ ...s.well, marginBottom: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: P.navy, marginBottom: 8 }}>Child {n}</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TK.inkSoft, marginBottom: 6, cursor: 'pointer' }}><input type="checkbox" style={{ width: 16, height: 16, accentColor: TK.brand }} checked={cd.school} onChange={e => upd({ school: e.target.checked })} /> Going to school?</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TK.inkSoft, cursor: 'pointer' }}><input type="checkbox" style={{ width: 16, height: 16, accentColor: TK.brand }} checked={cd.hostel} onChange={e => upd({ hostel: e.target.checked })} /> Staying in hostel?</label>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="ezp-cols"><WalletBar title="Old Regime Wallet" used={oTot} io={true} /><WalletBar title="New Regime Wallet" used={nTot} io={false} /></div>
      <div className="ezp-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 440 }}>
        <div style={{ ...s.th, display: 'grid', gridTemplateColumns: '1.7fr 1fr 1fr', padding: '10px 14px' }}>
          <span>Component</span><span style={{ textAlign: 'center' }}>Old Regime</span><span style={{ textAlign: 'center' }}>New Regime</span>
        </div>
        {COMPS.map(({ k, l, perq }) => {
          const oL = getOldLimit(k), nL = getNewLimit(k)
          const drop = (lim: number, val: number, rg: 'old' | 'new') => lim
            ? <select className="ezp-input" style={{ height: 32, padding: '0 8px', width: 'auto', minWidth: 96 }} value={val} onChange={e => setFlexi(rg, k, +e.target.value)}><option value={0}>₹0</option><option value={lim}>{R(lim)}</option></select>
            : <span style={{ fontSize: 11.5, color: TK.faint }}>Not eligible</span>
          return (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr 1fr', alignItems: 'center', padding: '9px 14px', borderTop: `1px solid ${P.border}`, background: perq ? TK.warningTint : TK.surface }}>
              <div><div style={{ fontSize: 13, color: P.navy }}>{l}</div>{perq && <span className="ezp-chip is-warn" style={{ height: 18, fontSize: 10, padding: '0 7px', marginTop: 3 }}>Perquisite Tax</span>}</div>
              <div style={{ textAlign: 'center' }}>{drop(oL, oFlexi[k] || 0, 'old')}</div>
              <div style={{ textAlign: 'center' }}>{drop(nL, nFlexi[k] || 0, 'new')}</div>
            </div>
          )
        })}
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr 1fr', padding: '10px 14px', borderTop: `1px solid ${TK.lineStrong}`, background: TK.sunken, fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <span>Total Selected</span><span style={{ textAlign: 'center', color: oTot > sal.other ? P.red : TK.warning }}>{R(oTot)}</span><span style={{ textAlign: 'center', color: nTot > sal.other ? P.red : P.green }}>{R(nTot)}</span>
        </div>
        </div></div>
      </div>
    </div>
  )

  // ── STEP 3 — Investments ──
  const numIn = (k: string, ph = '0') => <input className="ezp-input" type="number" value={f[k]} onChange={e => set(k, e.target.value)} placeholder={ph} />
  const c80Total = Math.min(N(f.lic) + N(f.ppf) + N(f.elss) + sal.epf + N(f.tuit) + N(f.hlP), 150000)
  const addITotal = N(f.oi) + N(f.bon) + N(f.iinc) + N(f.varEx) + N(f.iInc)
  const step3 = (
    <div>
      <div className="ezp-cols">
        {/* OLD */}
        <div className="ezp-panel" style={{ borderTop: `3px solid ${TK.warning}` }}>
          <div className="ezp-head" style={{ marginBottom: 4 }}><h3>Old Regime Declaration</h3></div>
          <p className="ezp-sub" style={{ margin: '0 0 12px' }}>Std Deduction ₹50,000 | 80C max ₹1,50,000</p>
          {sal.hra > 0 && (
            <div className="ezp-note" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span className="ezp-num"><b>Your HRA: Annual {R(sal.hra)} · Monthly {R(sal.hra / 12)}</b></span>
              <button className="ezp-ghost" onClick={() => setF(p => ({ ...p, rentM: String(Math.round(sal.hra / 12)), hra1From: '1', hra1To: '12' }))}>Apply suggested rent →</button>
            </div>
          )}
          <div style={s.sec}>HRA Exemption (Old Regime only)</div>
          <div style={s.well}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>Period 1: Rent Paid</div>
            <div className="ezp-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', rowGap: 0 }}>
              <Fg label="From Month"><select className="ezp-input" value={f.hra1From} onChange={e => set('hra1From', e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Fg>
              <Fg label="To Month"><select className="ezp-input" value={f.hra1To} onChange={e => set('hra1To', e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Fg>
            </div>
            <Fg label="Monthly Rent Paid (₹)">{numIn('rentM')}</Fg>
            <Fg label="City Type"><select className="ezp-input" value={f.cityType} onChange={e => set('cityType', e.target.value)}><option value="nonmetro">Non-Metro (40% of Basic)</option><option value="metro">Metro (50% of Basic)</option></select></Fg>
            <Fg label="Landlord PAN (required if annual rent > ₹1,00,000)"><input className="ezp-input" style={{ textTransform: 'uppercase' }} value={f.landlordPAN} onChange={e => set('landlordPAN', e.target.value.toUpperCase())} placeholder="ABCDE1234F" /></Fg>
          </div>
          <label className="ezp-check" style={{ alignItems: 'center', fontWeight: 600, marginBottom: 12 }}>
            <input type="checkbox" checked={!!f.showHra2} onChange={e => set('showHra2', e.target.checked ? 'y' : '')} /> Changed residence mid-year? Add second HRA period
          </label>
          {f.showHra2 && (
            <div style={s.well}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>Period 2</div>
              <div className="ezp-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', rowGap: 0 }}>
                <Fg label="From Month"><select className="ezp-input" value={f.hra2From} onChange={e => set('hra2From', e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Fg>
                <Fg label="To Month"><select className="ezp-input" value={f.hra2To} onChange={e => set('hra2To', e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Fg>
              </div>
              <Fg label="Monthly Rent Paid (₹)">{numIn('rentM2')}</Fg>
              <Fg label="City Type"><select className="ezp-input" value={f.cityType2} onChange={e => set('cityType2', e.target.value)}><option value="nonmetro">Non-Metro (40%)</option><option value="metro">Metro (50%)</option></select></Fg>
            </div>
          )}
          {N(f.rentM) > 0 && <div className="ezp-note is-ok ezp-num">Total HRA Exempt: <b>{R(hraExempt)}</b></div>}

          <div style={s.sec}>Section 80C (Max ₹1,50,000)</div>
          <div style={{ ...s.tot, fontWeight: 400, marginBottom: 12 }}><span style={{ color: P.muted }}>Employee PF (auto)</span><span style={{ fontWeight: 700 }}>{R(sal.epf)}</span></div>
          <Fg label="LIC Premium">{numIn('lic')}</Fg><Fg label="PPF">{numIn('ppf')}</Fg><Fg label="ELSS / Mutual Funds">{numIn('elss')}</Fg>
          <Fg label="Tuition Fees">{numIn('tuit')}</Fg><Fg label="Home Loan Principal">{numIn('hlP')}</Fg>
          <div style={{ ...s.tot, background: c80Total >= 150000 ? P.greenBg : P.amberBg, border: `1px solid ${c80Total >= 150000 ? TK.positiveEdge : TK.warningEdge}`, color: c80Total >= 150000 ? P.teal : P.amber }}><span>Total 80C</span><span>{R(c80Total)} / ₹1,50,000</span></div>

          <div style={s.sec}>80D, Home Loan &amp; NPS</div>
          <Fg label="80D Self + Family (max ₹25,000)">{numIn('medSelf')}</Fg>
          <Fg label="80D Parents (max ₹50,000)">{numIn('medParents')}</Fg>
          <Fg label="Home Loan Interest Sec 24(b) (max ₹2,00,000)">{numIn('hlInt')}</Fg>
          <Fg label="NPS Self 80CCD(1B) (max ₹50,000)"><select className="ezp-input" value={f.npsSelf} onChange={e => set('npsSelf', e.target.value)}><option value="0">₹0: Not investing</option><option value="50000">₹50,000: Max benefit</option></select></Fg>
          <Fg label="Employer NPS 80CCD(2): 10% of Basic (fully exempt)"><select className="ezp-input" value={f.emplrNpsOld} onChange={e => set('emplrNpsOld', e.target.value)}><option value="0">₹0: Not applicable</option><option value="on">{R(Math.round(sal.basic * .1))} (Basic × 10%)</option></select></Fg>

          <div style={s.sec}>Other Deductions (80E · 80DD · 80DDB · 80G)</div>
          <Fg label="80E: Education Loan Interest (max ₹2,00,000)">{numIn('eduLoan')}</Fg>
          <Fg label="80DD: Dependent Disability (fixed)"><select className="ezp-input" value={f.dep80dd} onChange={e => set('dep80dd', e.target.value)}><option value="0">₹0: Not applicable</option><option value="75000">₹75,000: 40–80% (Normal)</option><option value="125000">₹1,25,000: 80%+ Severe</option></select></Fg>
          <Fg label="80DDB: Specified Disease (max ₹1,00,000)">{numIn('dis80ddb')}</Fg>
          <Fg label="80G: PM Relief / PM CARES (100%, max ₹2,00,000)">{numIn('pmFund')}</Fg>
        </div>
        {/* NEW */}
        <div className="ezp-panel" style={{ borderTop: `3px solid ${TK.positive}` }}>
          <div className="ezp-head" style={{ marginBottom: 4 }}><h3>New Regime Declaration</h3></div>
          <p className="ezp-sub" style={{ margin: '0 0 12px' }}>Std Deduction ₹75,000 | No HRA / 80C / 80D</p>
          <div className="ezp-note is-ok">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 2 }}><span style={{ fontWeight: 600 }}>Standard Deduction (auto)</span><b className="ezp-num">₹75,000</b></div>
            <div style={{ fontSize: 11.5, color: P.muted }}>HRA · LTA · 80C · 80D · Home Loan: Not applicable</div>
          </div>
          <Fg label="Employer NPS 80CCD(2): 14% of Basic (fully exempt)"><select className="ezp-input" value={f.emplrNpsNew} onChange={e => set('emplrNpsNew', e.target.value)}><option value="0">₹0: Not applicable</option><option value="on">{R(Math.round(sal.basic * .14))} (Basic × 14%)</option></select></Fg>
          <div style={s.sec}>Additional Income (FY 2026-27)</div>
          <Fg label="Other Income (rental, freelance)">{numIn('oi')}</Fg>
          <Fg label="Bonus / Commission">{numIn('bon')}</Fg>
          <Fg label="Incentive / Award">{numIn('iinc')}</Fg>
          <Fg label="Variable Pay Expected (rest of year)">{numIn('varEx')}</Fg>
          <Fg label="Interest Income (FD / Savings)">{numIn('iInc')}</Fg>
          <div style={s.tot}><span>Total Additional Income</span><span>{R(addITotal)}</span></div>
        </div>
      </div>
    </div>
  )

  // Download the full declaration (all filled details) as a multi-sheet Excel.
  function downloadDeclaration() {
    if (!T) return
    const isOld = chosenRegime === 'OLD'
    const rec = T.fO <= T.fN ? 'OLD' : 'NEW'
    const dt = new Date().toLocaleString('en-IN')
    const num = (v: any) => Math.round(Number(v) || 0)

    // 1) Summary
    const summary: any[][] = [
      ['EZER HRMS: Flexi & TDS Declaration', ''],
      ['Financial Year', 'FY 2026-27 (AY 2027-28)'],
      ['Employee', `${empName || ''} (${empCode || ''})`],
      ['Submitted On', dt],
      ['Chosen Regime', isOld ? 'OLD Regime' : 'NEW Regime'],
      ['', ''],
      ['SALARY', ''],
      ['Annual CTC', num(sal.ctc)],
      ['Variable Pay (annual)', num(sal.vari)],
      ['Fixed Salary (annual)', num(sal.fixed)],
      ['Basic (monthly)', num(sal.basic / 12)],
      ['HRA (monthly)', num(sal.hra / 12)],
      ['Employer PF (annual)', num(sal.epf)],
      ['Flexi Wallet (monthly)', num(sal.other)],
      ['Salary Slab', SLAB_LABELS[sal.si]],
      ['Months in FY (worked)', `${T.months} of 12 (${Math.round(T.pr * 100)}%)`],
    ]

    // 2) Flexi declaration (per component, both regimes, annual)
    const flexi: any[][] = [['Component', 'Old Regime (₹/yr)', 'New Regime (₹/yr)']]
    COMPS.forEach(c => { const o = oFlexi[c.k] || 0, n = nFlexi[c.k] || 0; if (o || n) flexi.push([c.l, o, n]) })
    flexi.push(['TOTAL', Object.values(oFlexi).reduce((a, b) => a + (b || 0), 0), Object.values(nFlexi).reduce((a, b) => a + (b || 0), 0)])

    // 3) Investments / deductions (annual)
    const inv: any[][] = [
      ['Deduction / Investment', 'Amount (₹)', 'Applies to'],
      ['Monthly Rent Declared', N(f.rentM), 'Old (HRA)'],
      ['HRA Exemption', num(T.hE), 'Old'],
      ['80C: LIC', N(f.lic), 'Old'],
      ['80C: PPF', N(f.ppf), 'Old'],
      ['80C: ELSS / Mutual Funds', N(f.elss), 'Old'],
      ['80C: Tuition Fees', N(f.tuit), 'Old'],
      ['80C: Home Loan Principal', N(f.hlP), 'Old'],
      ['80C: Employee PF (auto)', num(sal.epf), 'Old'],
      ['80C Total (capped ₹1.5L)', num(T.c80), 'Old'],
      ['80D: Self + Family', num(T.medS), 'Old'],
      ['80D: Parents', num(T.medP), 'Old'],
      ['Home Loan Interest 24(b)', num(T.hlI), 'Old'],
      ['NPS Self 80CCD(1B)', num(T.npsS), 'Old'],
      ['Employer NPS 80CCD(2)', num(isOld ? T.eNpsO : T.eNpsN), 'Both'],
      ['80E: Education Loan', num(T.eduLoan), 'Old'],
      ['80DD: Dependent Disability', num(T.dep80dd), 'Old'],
      ['80DDB: Disease Treatment', num(T.dis80ddb), 'Old'],
      ['80G: PM Relief / Donations', num(T.pmFund), 'Old'],
      ['Additional Income', num(T.addI), 'Both'],
    ]

    // 4) TDS report (both regimes)
    const tds: any[][] = [
      ['', 'Old Regime', 'New Regime'],
      ['Gross Taxable Income', num(T.grossO), num(T.grossN)],
      ['Total Deductions', num(T.dO), num(T.dN)],
      ['Net Taxable Income', num(T.tO), num(T.tN)],
      ['Annual Tax', num(T.fO), num(T.fN)],
      ['Monthly TDS', num(T.moO), num(T.moN)],
      ['Effective Rate %', T.efO, T.efN],
      ['', '', ''],
      ['Recommended Regime', rec, ''],
      ['Your Chosen Regime', isOld ? 'OLD' : 'NEW', ''],
      ['Annual Tax Saving (best)', Math.abs(T.fO - T.fN), ''],
      ['Payable Monthly TDS (chosen)', isOld ? num(T.moO) : num(T.moN), ''],
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(flexi), 'Flexi Declaration')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inv), 'Investments')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tds), 'TDS Report')
    XLSX.writeFile(wb, `EZER_Flexi_TDS_Declaration_${empCode || 'employee'}.xlsx`)
  }

  // Full declaration as a formatted, printable PDF (opens → Save as PDF).
  function downloadDeclarationPdf() {
    if (!T) return
    const isOld = chosenRegime === 'OLD'
    const rec = T.fO <= T.fN ? 'OLD' : 'NEW'
    const dt = new Date().toLocaleString('en-IN')
    const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
    const kv = (rows: [string, string][]) => rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')
    const flexiRows = COMPS.filter(c => (oFlexi[c.k] || 0) || (nFlexi[c.k] || 0)).map(c => `<tr><td>${esc(c.l)}</td><td class="r">${R(oFlexi[c.k] || 0)}</td><td class="r">${R(nFlexi[c.k] || 0)}</td></tr>`).join('')
    const oTotV = Object.values(oFlexi).reduce((a, b) => a + (b || 0), 0), nTotV = Object.values(nFlexi).reduce((a, b) => a + (b || 0), 0)
    const invRows = ([
      ['HRA Exemption', R(T.hE)], ['80C (capped ₹1.5L)', R(T.c80)], ['80D Self+Family', R(T.medS)], ['80D Parents', R(T.medP)],
      ['Home Loan Interest 24(b)', R(T.hlI)], ['NPS Self 80CCD(1B)', R(T.npsS)], ['Employer NPS 80CCD(2)', R(isOld ? T.eNpsO : T.eNpsN)],
      ['80E Education Loan', R(T.eduLoan)], ['80DD Dependent Disability', R(T.dep80dd)], ['80DDB Disease', R(T.dis80ddb)], ['80G Donations', R(T.pmFund)], ['Additional Income', R(T.addI)],
    ] as [string, string][]).filter(([, v]) => v !== '₹0').map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Flexi & TDS Declaration: ${esc(empCode)}</title><style>
      *{box-sizing:border-box} body{font-family:"DM Sans","Segoe UI",sans-serif;color:#1E1B4B;margin:0;background:#F5F3FF}
      .doc{background:#fff;max-width:820px;margin:22px auto;padding:34px 40px;border:1px solid #E9E7F5;border-radius:14px}
      .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2563EB;padding-bottom:14px;margin-bottom:16px}
      .brand{font-size:22px;font-weight:800;color:#2563EB}.title{text-align:right;font-size:14px;font-weight:800;letter-spacing:.05em}
      .title .sub{font-size:11px;color:#2563EB}
      .badge{display:inline-block;padding:4px 14px;border-radius:99px;font-weight:800;font-size:13px;background:${isOld ? TK.warningTint : TK.positiveTint};color:${isOld ? TK.warning : TK.positive};border:2px solid ${isOld ? TK.warningTint : TK.positive}}
      h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#3C3489;margin:20px 0 6px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      td,th{padding:7px 10px;border-bottom:1px solid #F1F0FA;text-align:left}
      th{background:#1E1B4B;color:#fff;font-size:11px}.r{text-align:right}.k{color:#6B7280;width:45%}.v{font-weight:600}
      .tot td{font-weight:800;color:#2563EB;background:#F5F3FF}
      .note{margin-top:20px;font-size:11px;color:#9CA3AF;line-height:1.5;border-top:1px dashed #E9E7F5;padding-top:12px}
      @media print{body{background:#fff}.doc{border:none;margin:0;border-radius:0;max-width:100%}}
    </style></head><body><div class="doc">
      <div class="hd"><div><div class="brand">EZER HRMS</div><div style="font-size:12px;color:#6B7280">Flexi &amp; Tax Declaration</div></div>
        <div class="title"><div>FLEXI &amp; TDS</div><div class="sub">DECLARATION · FY 2026-27</div></div></div>
      <table>${kv([['Employee', `${empName || ''} (${empCode || ''})`], ['Submitted On', dt]])}
        <tr><td class="k">Chosen Regime</td><td><span class="badge">${isOld ? 'OLD REGIME' : 'NEW REGIME'}</span></td></tr></table>
      <h3>Salary</h3><table>${kv([['Annual CTC', R(sal.ctc)], ['Variable Pay', R(sal.vari)], ['Fixed Salary', R(sal.fixed)], ['Basic (monthly)', R(sal.basic / 12)], ['HRA (monthly)', R(sal.hra / 12)], ['Flexi Wallet (monthly)', R(sal.other)], ['Salary Slab', SLAB_LABELS[sal.si]], ['Months in FY (worked)', `${T.months} of 12 (${Math.round(T.pr * 100)}%)`]])}</table>
      <h3>Flexi Declaration (annual)</h3><table><thead><tr><th>Component</th><th class="r">Old Regime</th><th class="r">New Regime</th></tr></thead><tbody>${flexiRows || '<tr><td colspan="3" style="color:#9CA3AF">None declared</td></tr>'}<tr class="tot"><td>Total</td><td class="r">${R(oTotV)}</td><td class="r">${R(nTotV)}</td></tr></tbody></table>
      <h3>Investments &amp; Deductions</h3><table><tbody>${invRows || '<tr><td colspan="2" style="color:#9CA3AF">None declared</td></tr>'}</tbody></table>
      <h3>TDS Report</h3><table><thead><tr><th></th><th class="r">Old Regime</th><th class="r">New Regime</th></tr></thead><tbody>
        <tr><td>Gross Taxable</td><td class="r">${R(T.grossO)}</td><td class="r">${R(T.grossN)}</td></tr>
        <tr><td>Deductions</td><td class="r">${R(T.dO)}</td><td class="r">${R(T.dN)}</td></tr>
        <tr><td>Net Taxable</td><td class="r">${R(T.tO)}</td><td class="r">${R(T.tN)}</td></tr>
        <tr><td>Annual Tax</td><td class="r">${R(T.fO)}</td><td class="r">${R(T.fN)}</td></tr>
        <tr class="tot"><td>Monthly TDS</td><td class="r">${R(T.moO)}</td><td class="r">${R(T.moN)}</td></tr></tbody></table>
      <div style="margin-top:12px;font-size:13px"><b>Recommended:</b> ${rec} Regime (lower tax) · <b>Your choice:</b> ${isOld ? 'Old' : 'New'} · <b>Payable Monthly TDS:</b> ${R(isOld ? T.moO : T.moN)}</div>
      <div class="note">System-generated declaration for FY 2026-27 (AY 2027-28). Figures are estimates for planning; actual TDS may vary with final proofs and payroll processing. Not tax advice.</div>
    </div><script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  // Submit the chosen regime → store in DB + LOCK + download. Confirms first (Yes/No).
  async function submitRegime() {
    if (sandbox) return
    if (!chosenRegime || !T) return
    const isOldR = chosenRegime === 'OLD'
    const emplrNps = f.emplrNpsOld === 'on' || f.emplrNpsNew === 'on'
    // Confirmation: are you sure you want to select this regime? (+ NPS warning if applicable)
    let msg = `Are you sure you want to select the ${isOldR ? 'Old' : 'New'} Regime?\n\nYour regime will be locked after submission and your declaration will be downloaded.`
    if (emplrNps) msg = `You have chosen Employer NPS that will reduce your in-hand.\n\n` + msg
    msg += `\n\nYes → submit & download   ·   No → go back and choose`
    if (!window.confirm(msg)) return
    setSaving(true); setSaved(false)
    const isOld = chosenRegime === 'OLD'
    const monthlyTds = isOld ? T.moO : T.moN
    // Primary store: employees.tds_regime (read by flexi / claims / payroll).
    const { error } = await supabase.from('employees').update({ tds_regime: chosenRegime }).eq('id', employeeId)
    // Full calculator state (draft/submit persistence — every field returns on revisit).
    try { await persistForm('SUBMITTED') } catch { /* form store optional (needs sql52) */ }
    // Structured declaration → Investment report + payroll TDS.
    try {
      await supabase.from('tds_declarations').upsert({
        employee_id: employeeId, company_id: companyId, fy: FY, regime: chosenRegime,
        sec_80c: T.c80, sec_80d: T.medS + T.medP, sec_80e: T.eduLoan, sec_24b: T.hlI,
        hra_claimed: T.hE, lta_claimed: T.ltaAmt, nps_80ccd1b: T.npsS,
        employer_nps_80ccd2: isOld ? T.eNpsO : T.eNpsN,
        total_declared: T.c80 + T.medS + T.medP + T.hlI + T.eduLoan + T.npsS,
        annual_tax_old: T.fO, annual_tax_new: T.fN, monthly_tds: monthlyTds,
        // Write-through (C1a): the engine reads the RENT, the metro flag and the landlord
        // PAN from tds_declarations — not hra_claimed, which is this calculator's own
        // working. Leaving them behind here is how monthly_rent went missing on STC9064
        // and HRA exemption computed to zero.
        monthly_rent: N(f.rentM), is_metro: f.cityType === 'metro',
        landlord_pan: f.landlordPAN ? String(f.landlordPAN).toUpperCase() : null,
        sec_80d_self: T.medS, sec_80d_parents: T.medP,
        declaration_status: 'SUBMITTED', submitted_at: new Date().toISOString(),
      }, { onConflict: 'employee_id,fy' })
    } catch { /* tds_declarations optional (needs sql44) */ }
    // The itemised split (C1c) — one row per section, so the payslip can print
    // "Provident Fund / LIC / PPF" under 80C instead of one capped total.
    try {
      const lines = [
        ['80C_LIC', N(f.lic)], ['80C_PPF', N(f.ppf)], ['80C_ELSS', N(f.elss)], ['80C_TUITION', N(f.tuit)],
        ['80C_PRINCIPAL', N(f.hlP)], ['80CCC', N(f.pmFund)], ['80CCD_1B', N(f.npsSelf)],
        ['80D_SELF', N(f.medSelf)], ['80D_PARENTS', N(f.medParents)], ['80E', N(f.eduLoan)], ['24B_SELF', N(f.hlInt)],
      ] as [string, number][]
      const rows = lines.map(([section_code, declared_amount]) => ({
        employee_id: employeeId, fy: FY, section_code, declared_amount, source: 'calculator', updated_at: new Date().toISOString(),
      }))
      await supabase.from('investment_declaration_lines').upsert(rows, { onConflict: 'employee_id,fy,section_code' })
    } catch { /* lines table optional (needs 066) */ }
    setSaving(false)
    if (error) { alert('Could not save your regime: ' + error.message); return }
    setSaved(true); setDefaultedNew(false); setStatus('SUBMITTED'); setEditMode(null)
    // Auto-download the full declaration (PDF) after submit.
    try { downloadDeclarationPdf() } catch { /* download best-effort */ }
  }

  // ── STEP 4 — TDS report ──
  const step4 = (() => {
    if (!T) return <div className="ezp-panel"><div className="ezp-empty">Complete Steps 1–3 first.</div></div>
    const rec = T.fO <= T.fN ? 'OLD' : 'NEW', save = Math.abs(T.fO - T.fN)
    const metrics = [
      { l: 'Annual CTC', v: R(sal.ctc), s: SLAB_LABELS[sal.si] }, { l: T.mid ? 'Earned Salary' : 'Flexi Wallet', v: R(T.mid ? sal.ctc * T.pr : sal.other), s: T.mid ? `${T.months} mo · ${Math.round(T.pr * 100)}%` : 'Other Reimb.' },
      { l: 'Old Regime Tax', v: R(T.fO), s: 'Eff ' + T.efO + '%' }, { l: 'New Regime Tax', v: R(T.fN), s: 'Eff ' + T.efN + '%' },
      { l: 'HRA Exemption', v: R(T.hE), s: T.hE ? 'Old only' : 'No rent' }, { l: 'Tax Savings', v: R(save), s: rec + ' wins' },
      { l: 'Monthly TDS', v: R(rec === 'OLD' ? T.moO : T.moN), s: 'Recommended' }, { l: 'Best Regime', v: rec, s: 'For you' },
    ]
    const row = (l: string, oV: string, nV: string, exempt = false) => (
      <tr style={{ background: exempt ? P.greenBg : 'transparent' }}>
        <td style={{ color: exempt ? P.teal : P.navy }} dangerouslySetInnerHTML={{ __html: l }} />
        <td className="num" style={{ color: exempt ? P.teal : P.navy }}>{oV}</td>
        <td className="num" style={{ color: exempt ? P.teal : P.navy }}>{nV}</td>
      </tr>
    )
    const bold = (l: string, oV: string, nV: string, bg: string, col = P.navy) => (
      <tr style={{ background: bg }}><td style={{ fontSize: 13, fontWeight: 700, color: col, borderTop: `1px solid ${TK.lineStrong}` }}>{l}</td><td className="num" style={{ fontSize: 13, fontWeight: 700, color: col, borderTop: `1px solid ${TK.lineStrong}` }}>{oV}</td><td className="num" style={{ fontSize: 13, fontWeight: 700, color: col, borderTop: `1px solid ${TK.lineStrong}` }}>{nV}</td></tr>
    )
    const sec = (t: string) => <tr><td colSpan={3} style={{ fontSize: 11, fontWeight: 700, color: P.muted, background: TK.sunken, letterSpacing: '.05em' }}>{t}</td></tr>
    return (
      <div>
        <section className="ezp-hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div><div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.01em' }}>Recommended: {rec === 'OLD' ? 'Old' : 'New'} Regime</div><p className="ezp-hero-label" style={{ margin: '2px 0 0' }}>You save <b className="ezp-num">{R(save)}</b> annually</p></div>
          <div style={{ textAlign: 'right' }}><p className="ezp-hero-num" style={{ justifyContent: 'flex-end' }}><b>{R(rec === 'OLD' ? T.fO : T.fN)}</b></p><p className="ezp-hero-label ezp-num" style={{ margin: '2px 0 0' }}>Annual Tax · Monthly TDS {R(rec === 'OLD' ? T.moO : T.moN)}</p></div>
        </section>

        {/* ── Save & Submit: choose Old / New regime, save draft, or submit (locks) ── */}
        {!sandbox && <div className="ezp-panel">
          <div className="ezp-head">
            <h3>Save &amp; Submit: Tax Regime</h3>
            {isSubmitted && !editMode && <span className="ezp-chip is-ok">Submitted &amp; locked</span>}
            {editMode && <span className="ezp-chip is-warn">Editing {editMode === 'all' ? 'flexi + investments' : 'flexi only'}</span>}
            {status === 'DRAFT' && <span className="ezp-chip is-info">Draft saved</span>}
          </div>
          {!userPicked && !isSubmitted && recRegime && (
            <div className="ezp-note">We&apos;ve pre-selected the <b>{recRegime === 'OLD' ? 'Old' : 'New'} Regime</b>. It gives you the <b>lower annual tax</b>. You can change it below before submitting.
            </div>
          )}
          {isSubmitted && !editMode && (
            <div className="ezp-note is-ok">You submitted the <b>{chosenRegime === 'OLD' ? 'Old' : 'New'} Regime</b>. Your regime is locked. {chosenRegime === 'OLD' ? 'Use Edit to change your flexi & investment declarations.' : 'Use Edit to change your flexi declaration (investment sections don’t apply to the New Regime).'}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginBottom: 12 }}>
            {(['OLD', 'NEW'] as const).map(rg => {
              const sel = chosenRegime === rg
              const isOld = rg === 'OLD'
              const tax = isOld ? T.fO : T.fN, mo = isOld ? T.moO : T.moN
              return (
                <button key={rg} onClick={() => { if (!regimeLocked) { setChosenRegime(rg); setUserPicked(true); setSaved(false) } }} disabled={regimeLocked} style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: regimeLocked ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: P.navy,
                  border: `1px solid ${sel ? (isOld ? TK.warning : P.green) : TK.lineStrong}`,
                  boxShadow: sel ? `0 0 0 1px ${isOld ? TK.warning : P.green}` : 'none',
                  background: sel ? (isOld ? TK.warningTint : P.greenBg) : TK.surface, opacity: regimeLocked && !sel ? .45 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 99, border: `2px solid ${sel ? (isOld ? TK.warning : P.green) : TK.lineStrong}`, background: sel ? (isOld ? TK.warning : P.green) : TK.surface, boxShadow: sel ? `inset 0 0 0 2px ${TK.surface}` : 'none', display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: P.navy }}>{isOld ? 'Old Regime' : 'New Regime'}</span>
                    {rec === rg && <span className="ezp-chip is-brand" style={{ height: 18, fontSize: 10, padding: '0 7px' }}>Recommended</span>}
                    {regimeLocked && sel && <span style={{ fontSize: 10 }}></span>}
                  </div>
                  <div className="ezp-num" style={{ fontSize: 11.5, color: P.muted, marginTop: 6 }}>Annual tax <b style={{ color: P.navy }}>{R(tax)}</b> · Monthly TDS <b style={{ color: P.navy }}>{R(mo)}</b></div>
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {(!isSubmitted || editMode) && (
              <button className="ezp-btn" onClick={submitRegime} disabled={!chosenRegime || saving}>
                {saving ? 'Saving…' : editMode ? 'Save & re-submit' : `Submit ${chosenRegime || ''} declaration`}
              </button>
            )}
            {!isSubmitted && (
              <button className="ezp-ghost" style={{ height: 38 }} onClick={saveDraft} disabled={saving}>Save Draft</button>
            )}
            {isSubmitted && !editMode && (
              <button className="ezp-btn" onClick={() => setEditMode(chosenRegime === 'OLD' ? 'all' : 'flexi')}>Edit {chosenRegime === 'OLD' ? 'flexi & investments' : 'flexi'}
              </button>
            )}
            {isSubmitted && !editMode && (
              <>
                <button className="ezp-ghost" style={{ height: 38 }} onClick={downloadDeclarationPdf}>⬇ Download PDF</button>
                <button className="ezp-ghost" style={{ height: 38 }} onClick={downloadDeclaration}>⬇ Excel</button>
              </>
            )}
            {editMode && <button className="ezp-ghost" style={{ height: 38 }} onClick={() => { setEditMode(null); setStatus('SUBMITTED') }}>Cancel edit</button>}
            {draftMsg && <span style={{ fontSize: 12, color: draftMsg.startsWith('⚠') ? P.red : P.teal, fontWeight: 600 }}>{draftMsg}</span>}
          </div>
        </div>}

        {T.mid && (
          <div className="ezp-note">
            <div>📅 <b>Pro-rated for mid-year joining:</b> salary income taxed for <b>{T.months} of 12 months</b> (≈{Math.round(T.pr * 100)}%). Annual tax above is spread over the <b>{T.months} remaining pay month{T.months === 1 ? '' : 's'}</b>Monthly TDS = Annual Tax ÷ {T.months}. Standard deduction &amp; your actual investment declarations are counted in full.</div>
          </div>
        )}
        <div className="ezp-panel">
          <div className="ezp-stats" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
            {metrics.map(m => <div key={m.l} className="ezp-stat"><div className="ezp-stat-name">{m.l}</div><div className="ezp-stat-num">{m.v}</div><div className="ezp-muted" style={{ fontSize: 11, marginTop: 2 }}>{m.s}</div></div>)}
          </div>
        </div>
        <div className="ezp-cols">
          {(['OLD', 'NEW'] as const).map(rg => {
            const io = rg === 'OLD', ir = rec === rg
            const tax = io ? T.fO : T.fN, gr = io ? T.gO : T.gN, ded = io ? T.dO : T.dN, tx2 = io ? T.tO : T.tN, mo = io ? T.moO : T.moN, eff = io ? T.efO : T.efN
            return (
              <div key={rg} className="ezp-panel" style={{ borderTop: `3px solid ${io ? TK.warning : P.green}`, ...(ir ? { borderColor: TK.brandEdge, borderTopColor: io ? TK.warning : P.green, boxShadow: `0 0 0 1px ${TK.brandEdge}` } : {}) }}>
                <div className="ezp-head" style={{ marginBottom: 4 }}><h3>{io ? 'Old' : 'New'} Regime</h3>{ir && <span className="ezp-chip is-brand">Recommended</span>}</div>
                <div className="ezp-num" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', color: io ? TK.warning : P.green, margin: '2px 0' }}>{R(tax)}</div>
                <div className="ezp-num" style={{ fontSize: 11.5, color: P.muted, marginBottom: 8 }}>Effective {eff}% · Monthly TDS {R(mo)}</div>
                {[['Gross Income', R(gr)], ['(–) Deductions', R(ded)], ['= Net Taxable', R(tx2)], ['Annual Tax', R(tax)], ['Monthly TDS', R(mo)]].map(([l, v]) => <div key={l} className="ezp-row"><span>{l}</span><b>{v}</b></div>)}
              </div>
            )
          })}
        </div>
        <div className="ezp-panel">
          <div className="ezp-head"><h3>Taxable Income Breakup (Component-wise)</h3></div>
          <p className="ezp-sub">What is taxable, what is exempt, and how TDS is computed</p>
          <div className="ezp-table-wrap">
            <table className="ezp-table" style={{ minWidth: 420 }}>
              <thead><tr><th>Component</th><th className="num" style={{ color: TK.warning }}>Old (₹)</th><th className="num" style={{ color: P.green }}>New (₹)</th></tr></thead>
              <tbody>
                {sec(T.mid ? `📌 INCOME (${T.months} months · pro-rated ${Math.round(T.pr * 100)}%)` : 'INCOME')}
                {row('Basic Salary (100% taxable)', R(T.eBasic), R(T.eBasic))}
                {row('HRA Received (' + R(T.eHra) + ')', '', '')}
                {T.hE > 0 && row('&nbsp;&nbsp;✓ HRA Exemption', `(${R(T.hE)})`, 'N/A', true)}
                {row('&nbsp;&nbsp;= Net Taxable HRA', R(T.eHra - T.hE), R(T.eHra))}
                {row('Flexi Wallet: Total ' + R(T.eOther), '', '')}
                {(T.oClaim > 0 || T.nClaim > 0) && row('&nbsp;&nbsp;✓ Flexi Claimed (exempt on bills)', T.oClaim ? `(${R(T.oClaim)})` : '-', T.nClaim ? `(${R(T.nClaim)})` : '-', true)}
                {row('&nbsp;&nbsp;= Wallet Balance (taxable)', R(T.walBalO), R(T.walBalN))}
                {T.eVari > 0 && row('Variable Pay', R(T.eVari), R(T.eVari))}
                {T.addI > 0 && row('Additional Income', R(T.addI), R(T.addI))}
                {(T.oPerq > 0 || T.nPerq > 0) && row('Car+Driver Perquisite (₹10,000/mo)', T.oPerq ? `+${R(T.oPerq)}` : '-', T.nPerq ? `+${R(T.nPerq)}` : '-')}
                {bold('Gross Taxable Income', R(T.grossO), R(T.grossN), TK.sunken, P.navy)}
                {sec('DEDUCTIONS')}
                {row('Standard Deduction', '(₹50,000)', '(₹75,000)', true)}
                {T.ltaAmt > 0 && row('Leave Travel Allowance', `(${R(T.ltaAmt)})`, 'N/A', true)}
                {T.c80 > 0 && row('80C: EPF + Investments', `(${R(T.c80)})`, 'N/A', true)}
                {T.medS > 0 && row('80D Self + Family', `(${R(T.medS)})`, 'N/A', true)}
                {T.medP > 0 && row('80D Parents', `(${R(T.medP)})`, 'N/A', true)}
                {T.hlI > 0 && row('Home Loan Interest 24(b)', `(${R(T.hlI)})`, 'N/A', true)}
                {T.dep80dd > 0 && row('80DD: Dependent Disability', `(${R(T.dep80dd)})`, 'N/A', true)}
                {T.dis80ddb > 0 && row('80DDB: Disease Treatment', `(${R(T.dis80ddb)})`, 'N/A', true)}
                {T.pmFund > 0 && row('80G: PM Relief Fund', `(${R(T.pmFund)})`, 'N/A', true)}
                {T.eduLoan > 0 && row('80E: Education Loan', `(${R(T.eduLoan)})`, 'N/A', true)}
                {T.npsS > 0 && row('NPS Self 80CCD(1B)', `(${R(T.npsS)})`, 'N/A', true)}
                {(T.eNpsO > 0 || T.eNpsN > 0) && row('Employer NPS 80CCD(2)', T.eNpsO ? `(${R(T.eNpsO)})` : '-', T.eNpsN ? `(${R(T.eNpsN)})` : '-', true)}
                {bold('Net Taxable Income', R(T.tO), R(T.tN), P.purpleBg, P.purpleDark)}
                {sec('TAX')}
                {row('Tax on income (slab)', R(T.bO), R(T.bN))}
                {row('Rebate u/s 87A', T.tO <= 500000 ? `(${R(Math.min(T.bO, 12500))})` : '-', T.tN <= 1200000 ? `(${R(T.bN)})` : '-', true)}
                {row('Add: 4% Health & Edu Cess', R(Math.round(T.fO / 1.04 * .04)), R(Math.round(T.fN / 1.04 * .04)))}
                {bold('TOTAL ANNUAL TAX', R(T.fO), R(T.fN), TK.brandTint, TK.brandDeep)}
                {bold(`MONTHLY TDS (÷${T.months})`, R(T.moO), R(T.moN), TK.sunken, P.navy)}
              </tbody>
            </table>
          </div>
        </div>
        <div className="ezp-note is-warn">
          <span className="ezp-note-t">Important Disclaimer</span>
          <div>
            This is an <b>estimate</b> for comparison &amp; investment planning only. Actual TDS may vary with final proofs, payroll processing, mid-year changes or tax-law amendments. Please confirm with your HR / Finance team and file your full investment declaration on the HRMS portal for accurate TDS. Not tax or financial advice. FY 2026-27 (AY 2027-28).
          </div>
        </div>
        <button className="ezp-ghost" style={{ height: 38 }} onClick={() => setStep(3)}>Back</button>
      </div>
    )
  })()

  return (
    <div className="ezp">
      <PayStyles />
      <div className="ezp-title">
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2>{sandbox ? 'TDS Calculator' : <>Flexi &amp; TDS Calculator</>}</h2>
          <p>{sandbox
            ? <>Work out flexi, deductions and Old vs New regime tax for any figures · FY 2026-27 · <b>nothing here is saved</b> and no one&apos;s declaration changes</>
            : 'Plan your flexi benefit declaration and compare Old vs New tax regime · FY 2026-27'}</p>
        </div>
        {sandbox && sal.ctc > 0 && step === 4 && (
          <button className="ezp-ghost" style={{ height: 38 }} onClick={downloadDeclaration}>Download Excel</button>
        )}
        {/* Save Draft from any step (pre-submit) — data is stored and returns pre-filled */}
        {!isSubmitted && !sandbox && (
          <button className="ezp-ghost" style={{ height: 38 }} onClick={saveDraft} disabled={saving}>Save Draft</button>
        )}
      </div>
      {draftMsg && <div className={`ezp-note ${draftMsg.startsWith('⚠') ? 'is-bad' : 'is-ok'}`} style={{ fontWeight: 600 }}>{draftMsg}</div>}
      {defaultedByRule && !isSubmitted && (
        <div className="ezp-note is-warn">
          <b>New Regime applied by default</b>: no regime was chosen by the 4th of the month{/^\d{4}-/.test(defaultedByRule) ? ` (set on ${new Date(defaultedByRule).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})` : ''}. Payroll is taxing you on the New Regime. You can still submit your own choice here; submitting replaces the default.
        </div>
      )}
      {viewLocked && <div className="ezp-note">This declaration is submitted &amp; locked. Go to <b>Step 4</b> and press <b>Edit</b> to change {chosenRegime === 'OLD' ? 'flexi or investments' : 'your flexi'}.</div>}
      <Stepper />
      {step === 1 && <fieldset disabled={!basicRW} style={fsReset}>{step1}</fieldset>}
      {step === 2 && <fieldset disabled={!flexiRW} style={fsReset}>{step2}</fieldset>}
      {step === 3 && <fieldset disabled={!investRW} style={fsReset}>{step3}</fieldset>}
      {step === 4 && step4}
      {/* Step navigation — kept OUTSIDE the disabled fieldsets so a submitted (locked) employee can still page through and view all steps. */}
      {step === 1 && sal.ctc > 0 && <div style={{ textAlign: 'right', marginTop: 6 }}><button className="ezp-btn" onClick={() => setStep(2)}>Next: Flexi Declaration →</button></div>}
      {step === 2 && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 6 }}><button className="ezp-ghost" style={{ height: 38 }} onClick={() => setStep(1)}>Back</button><button className="ezp-btn" onClick={() => setStep(3)}>Next: Investments →</button></div>}
      {step === 3 && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 6 }}><button className="ezp-ghost" style={{ height: 38 }} onClick={() => setStep(2)}>Back</button><button className="ezp-btn" onClick={() => setStep(4)}>Calculate TDS →</button></div>}
    </div>
  )
}
