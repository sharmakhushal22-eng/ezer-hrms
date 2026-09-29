'use client'
// components/ess/MrfForm.tsx — the full Manpower Requisition form for the ESS portal.
//
// Same shape as the Recruitment module's "New MRF" form (Quick Hire / Full MRF toggle and
// every section), but raised from an employee's own portal: it routes through the ESS
// approval chain (RM1 → RM2 → HR Head, company-scoped) built server-side in /api/ess/mrf,
// and it AUTOFILLS everything it can from the person raising it — their company and
// department (both locked), their reporting line (RM1 = them, RM2 = their manager, HOD),
// and their name. It loads its own reference lists (masters, skills, colleagues, locations)
// with the anon client, exactly like the other ESS record screens.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { authToken } from '@/lib/rms/client'
import { WAGE_CATS } from '@/lib/recruitment/min-wages'
import { jobCodePrefix, newMrfNumber } from '@/lib/recruitment/job-code'
import { C as TK, E } from '@/lib/ui'
// The redesign's stylesheet, loaded HERE rather than by a route layout.
//
// A Next route layout only wraps its own subtree, and this form renders on five
// surfaces: the recruitment page (create + read-only review), RoleTabs' Raise
// MRF and Edit-&-resubmit inside the ESS portal, and app/mrf-approve. Only the
// first is under app/dashboard/recruitment/layout.tsx. Importing the sheet in
// the component itself is the narrowest site that covers all five — importing
// it into RoleTabs or HrisShell instead would load it on every portal page,
// which is how Social's reaction pills once ended up stacked (see
// RecruitmentModule.tsx). Audited before doing this: the sheet has no bare
// element, :root-property, or universal rules that could reach ESS markup, and
// nothing in components/ess carries class="rx" or any of .s2/.s6/.sr-only/.b-*.
import '@/lib/ui/recruitment.redesign.css'
// Direct paths, NOT the rx barrel: the barrel re-exports DashboardView,
// MrfListView and PipelineView, and pulling those into the ESS bundle to get
// one icon and one meter would be a real cost.
import { Icon } from '@/components/recruitment/rx/icons'
import { LaneMeter } from '@/components/recruitment/rx/form'

// ── Palette ──────────────────────────────────────────────────────────────────
//
// THESE WERE HEX LITERALS, AND THAT WAS THE BUG. Opening "New MRF" while the
// product was in dark mode gave a white form with near-black text on it: the
// page around it repainted and this did not, because a literal cannot respond
// to anything.
//
// Every value now resolves through lib/ui/theme.css, so one attribute on <html>
// repaints this form with everything else. The names are kept — `purple`,
// `card`, `locked` — so the ~200 call sites below did not have to change, and
// the diff stays reviewable.
//
// NOTE: these are `var(...)` strings, not hex. Do not concatenate an alpha
// suffix onto one (`C.purple + '20'` produces nothing) — use a tint token.
const C = {
  ink: TK.ink, muted: TK.muted, faint: TK.faint, border: TK.line, card: TK.surface,
  purple: TK.brand, purpleD: TK.brandDeep, soft: TK.brandTint, green: TK.positive, greenBg: TK.positiveTint,
  amber: TK.warning, amberEdge: TK.warningEdge, red: TK.critical, redEdge: TK.criticalEdge, redBg: TK.criticalTint, bg: TK.canvas, locked: TK.sunken,
}
// ── The redesign vocabulary, ported by hand ──────────────────────────────────
//
// These numbers are the Recruitment redesign's (.rx-input, .rx-label, .rx-btn,
// .rx-mod), ported by hand when the stylesheet could not be reached from here.
//
// THAT IS NO LONGER TRUE, and the values below are kept deliberately rather
// than by neglect. The sheet is now imported by this file (see the top), so
// rx-* classes DO resolve on all five surfaces. The inline values stay because
// they are already correct and because the alternative — rx-input/rx-btn
// everywhere — buys nothing without a `.rx` ancestor: the sheet's radius
// overrides are written `.rx .rx-btn{…!important}` to outrank the global
// `button{border-radius:10px!important}`, and adding a `.rx` wrapper would drag
// in the frame rule (28/32/40 padding, canvas background, flex column,
// overflow:hidden) and reshape this form inside its ESS card.
//
// So the sheet is loaded for the pieces that genuinely need it — the auto-filled
// fields below and the budget lane meter — and the rest keeps the hand-port.
//
// One rx number is still deliberately NOT reproduced: the 11px button radius,
// for the reason just given.
//
// One rx number is deliberately NOT reproduced: the 11px button radius.
// UIKeyframes ships `button { border-radius:10px !important }` globally, and
// nothing outside `.rx` can outrank it — the radius below is honest about
// that being a request the browser will round to 10.
const inputBase: React.CSSProperties = {
  width: '100%', height: 42, padding: '0 13px',
  // surface, not sunken: the redesign lifts fields ONTO the card rather than
  // sinking wells into it, and pairs that with the stronger hairline.
  // (The old note here was right for its time: sunken replaced '#FAFAF8', and
  // brandEdge replaced '#DDD6FE', a light-mode lilac. Both were tokens; this
  // is a design change, not a dark-mode fix.)
  background: TK.surface, border: `1px solid ${TK.lineStrong}`, borderRadius: 11,
  color: TK.ink, fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
const st = {
  // 12.5px sentence-case ink-soft. The uppercase 11px brandDeep label was the
  // old product's signature and is what made this form read as a different
  // application from the one it opens inside.
  label: { fontSize: 12.5, fontWeight: 600, color: TK.inkSoft, display: 'block', marginBottom: 6 } as React.CSSProperties,
  input: inputBase,
  // A fixed height cannot hold a textarea; these get their padding back.
  area: { ...inputBase, height: 'auto', padding: '10px 13px', resize: 'vertical' } as React.CSSProperties,
  // onAccent, not '#fff'. White on a filled button is correct in light and
  // fails in dark, where every accent lightens and white falls to ~2.5:1.
  btn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 40, padding: '0 16px', borderRadius: 11, border: `1px solid ${TK.brandDeep}`,
    cursor: 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit',
    background: `linear-gradient(180deg, ${TK.brand}, ${TK.brandDeep})`,
    color: TK.onAccent, boxShadow: E.brand, whiteSpace: 'nowrap',
  } as React.CSSProperties,
  btnO: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 40, padding: '0 16px', borderRadius: 11, border: `1px solid ${TK.lineStrong}`,
    cursor: 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit',
    background: TK.surface, color: TK.inkSoft, whiteSpace: 'nowrap',
  } as React.CSSProperties,
}
const g2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }

// ── Constants (mirrored from the Recruitment MRF form) ───────────────────────
const REQ_TYPES = ['New Hire', 'Replacement', 'Temporary', 'Backfill']
const PRIORITIES: [string, string][] = [['HIGH', 'High / Urgent'], ['MEDIUM', 'Medium / Normal'], ['LOW', 'Low']]
const EMP_TYPES = ['Employee', 'Intern', 'Contract', 'Consultant', 'NAPS', 'NATS', 'Live Project']
const WORK_MODES = ['Onsite', 'Hybrid', 'Remote']
const SOURCING_MODES = ['External', 'Internal', 'Both']
const REASON_FOR_HIRE = ['New position', 'Replacement', 'Expansion', 'Attrition']
const PREV_COMPANY: [string, string][] = [['', 'Select Preference'], ['MNC', 'MNC'], ['STARTUP', 'Startup']]
const EDUCATION_OPTIONS = ['Any Graduate', 'Bachelors', 'B.Tech/B.E.', 'MBA/PGDM', 'M.Tech', 'B.Com/M.Com', 'BCA/MCA', 'Diploma', '12th Pass', 'Any Post Graduate', 'Masters']
const QUICK_HIRE_CAP = 600000
const COMPENSATION: Record<string, { kind: string; label: string; period: string; fixedTerm: boolean; ph: [string, string] }> = {
  Employee:       { kind: 'SALARY',  label: 'Salary',  period: 'ANNUAL',  fixedTerm: false, ph: ['600000', '1200000'] },
  Intern:         { kind: 'STIPEND', label: 'Stipend', period: 'MONTHLY', fixedTerm: true,  ph: ['10000', '25000'] },
  NAPS:           { kind: 'STIPEND', label: 'Stipend', period: 'MONTHLY', fixedTerm: true,  ph: ['9000', '15000'] },
  NATS:           { kind: 'STIPEND', label: 'Stipend', period: 'MONTHLY', fixedTerm: true,  ph: ['9000', '15000'] },
  'Live Project': { kind: 'STIPEND', label: 'Stipend', period: 'MONTHLY', fixedTerm: true,  ph: ['5000', '15000'] },
  Contract:       { kind: 'FEES',    label: 'Fees',    period: 'MONTHLY', fixedTerm: true,  ph: ['50000', '120000'] },
  Consultant:     { kind: 'FEES',    label: 'Fees',    period: 'MONTHLY', fixedTerm: false, ph: ['75000', '200000'] },
}
const compOf = (t: string) => COMPENSATION[t] || COMPENSATION.Employee
const perLabel = (p: string) => (p === 'ANNUAL' ? 'per annum' : 'per month')

type Master = { code: string; label: string }
async function loadMasters(codes: string[]): Promise<Record<string, Master[]>> {
  const out: Record<string, Master[]> = {}; codes.forEach(c => { out[c] = [] })
  const { data: types } = await supabase.from('master_types').select('id, code').in('code', codes)
  if (!types?.length) return out
  const byId = new Map(types.map((t: any) => [t.id, t.code]))
  const { data: vals } = await supabase.from('master_values')
    .select('type_id, code, label, is_active, sort_order').in('type_id', types.map((t: any) => t.id)).order('sort_order')
  for (const v of vals || []) { if (v.is_active === false) continue; const c = byId.get(v.type_id) as string; if (c) out[c].push({ code: v.code, label: v.label }) }
  return out
}
async function api(path: string, employeeId: string, init?: RequestInit) {
  const token = await authToken()
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${path}${sep}employee_id=${encodeURIComponent(employeeId)}`, {
    ...init, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
  return body
}

// ── Sub-components (OUTSIDE the parent — no focus loss) ───────────────────────
function SectionLine({ n, title }: { n: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '22px 0 12px' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 7, flexShrink: 0,
        background: TK.brandTint, color: TK.brand, fontSize: 11, fontWeight: 700,
      }}>{n}</span>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: TK.ink, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  )
}
// "Questions to ask" — an optional, growable list (Add+). Stored as a JSON array in
// manpower_requisitions.ctq_questions and shown to interviewers on the feedback form.
function QuestionsList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const set = (i: number, q: string) => onChange(value.map((x, idx) => idx === i ? q : x))
  const del = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {value.length === 0 && <div style={{ fontSize: 11, color: C.faint }}>No questions added — click “+ Add question” to add one.</div>}
      {value.map((q, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.faint, width: 18, textAlign: 'right' }}>{i + 1}.</span>
          <input style={{ ...st.input, flex: 1 }} value={q} onChange={e => set(i, e.target.value)} placeholder="e.g. Walk me through a project where you owned the outcome end-to-end" />
          <button type="button" onClick={() => del(i)} style={{ border: `1px solid ${C.redEdge}`, background: C.redBg, color: C.red, borderRadius: 7, padding: '7px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>Remove</button>
        </div>
      ))}
      <div><button type="button" onClick={() => onChange([...value, ''])} style={{ border: `1px solid ${C.purple}55`, background: C.soft, color: C.purpleD, borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700 }}>+ Add question</button></div>
    </div>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={st.label}>{label}{required && <span style={{ color: C.red }}> *</span>}</label>
      {children}
      {hint && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>{hint}</div>}
    </div>
  )
}
/**
 * A field filled in from the raiser's own employee record.
 *
 * Wears the kit's auto-field look (.rx-field .rx-auto + .rx-auto-tag: positive
 * tint, green "check" tag pinned bottom-right) now that the stylesheet is
 * reachable from here — but it is NOT the kit's <AutoField>.
 *
 * AutoField renders a fixed-height <input>. This renders a DIV, because the
 * measurement that produced the old note still holds: the longest value here
 * ("Sharma Retail Solutions Pvt Ltd") wraps to two lines in a
 * minmax(190px,1fr) cell, and an input — which cannot wrap — would hide half of
 * it behind the 112px inset the tag needs. A div grows instead.
 *
 * It also keeps the per-field hint. AutoField hardcodes "From profile", which
 * would erase the distinction between "you", "your manager" and "your HOD".
 */
function Locked({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rx-field rx-auto">
      <label className="rx-label">{label}</label>
      {/* paddingRight overrides `.rx-auto .rx-input{padding-right:112px}`.
          MEASURED, and the reason this is not the kit's geometry: these fields
          sit in a repeat(auto-fit, minmax(190px,1fr)) grid, so a cell is ~197px
          and that inset leaves a 72px text column — "Sharma Retail Solutions
          Pvt Ltd" wrapped to FOUR lines and the tag rendered on top of it in
          four of the five fields. The kit's 112px assumes the wide centre
          column of RaiseMrfLayout, which this form does not use. */}
      <div className="rx-input" style={{ height: 'auto', minHeight: 42, display: 'flex', alignItems: 'center', paddingRight: 13 }}>{value || '—'}</div>
      {/* ...and with the inset gone the tag can no longer float over the value,
          so it takes its own row. Inline position beats the stylesheet's
          absolute; .rx-field is already a column flex, so it simply flows. */}
      <span className="rx-auto-tag" style={{ position: 'static', alignSelf: 'flex-start' }}><Icon name="check" />{hint || 'From profile'}</span>
    </div>
  )
}
function Sel({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <select style={{ ...st.input, cursor: 'pointer' }} value={value} onChange={e => onChange(e.target.value)}>{children}</select>
}
function MasterSel({ value, onChange, opts, placeholder, useCode }: { value: string; onChange: (v: string) => void; opts: Master[]; placeholder: string; useCode?: boolean }) {
  return (
    <Sel value={value} onChange={onChange}>
      <option value="">{placeholder}</option>
      {opts.map(o => <option key={o.code} value={useCode ? o.code : o.label}>{o.label}</option>)}
    </Sel>
  )
}
function ChannelPicker({ value, onChange, opts }: { value: string[]; onChange: (v: string[]) => void; opts: Master[] }) {
  const on = (label: string) => value.includes(label)
  const toggle = (label: string) => onChange(on(label) ? value.filter(x => x !== label) : [...value, label])
  if (!opts.length) return <div style={{ fontSize: 12, color: C.faint }}>No sourcing channels configured.</div>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {opts.map(o => (
        <button key={o.code} type="button" onClick={() => toggle(o.label)}
          style={{ height: 30, padding: '0 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${on(o.label) ? TK.brandDeep : TK.line}`,
            background: on(o.label) ? `linear-gradient(180deg, ${TK.brand}, ${TK.brandDeep})` : TK.sunken,
            color: on(o.label) ? TK.onAccent : TK.inkSoft }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Skills picker — same behaviour as Recruitment: chips + a live-search dropdown over the
// skills master, plus "add custom". Stores a comma-joined string (skills_required column).
function SkillsMultiSelect({ value, onChange, allSkills, onAddSkill, placeholder }: { value: string; onChange: (v: string) => void; allSkills: string[]; onAddSkill: (n: string) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const selected = value ? value.split(',').map(s => s.trim()).filter(Boolean) : []
  const lowerSel = selected.map(s => s.toLowerCase())
  // On focus (empty query) show the first skills; while typing, filter. Either way, never
  // show one that's already picked.
  const matches = allSkills.filter(s => !lowerSel.includes(s.toLowerCase()) && (!q.trim() || s.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 10)
  const exact = allSkills.some(s => s.toLowerCase() === q.trim().toLowerCase()) || lowerSel.includes(q.trim().toLowerCase())
  const add = (skill: string) => { if (!lowerSel.includes(skill.toLowerCase())) onChange([...selected, skill].join(', ')); setQ(''); setOpen(false) }
  const remove = (skill: string) => onChange(selected.filter(s => s !== skill).join(', '))
  const addCustom = () => { const n = q.trim(); if (!n) return; onAddSkill(n); add(n) }
  return (
    <div ref={boxRef}>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {selected.map(s => (
            <span key={s} style={{ fontSize: 11.5, height: 24, padding: '0 9px', borderRadius: 8, background: C.soft, color: C.purple, border: `1px solid ${TK.brandEdge}`, fontWeight: 500, display: 'inline-flex', alignItems: 'center' }}>
              {s}<span onClick={() => remove(s)} style={{ cursor: 'pointer', marginLeft: 5, fontWeight: 700 }}>×</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <input style={st.input} value={q} onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true) }}
          placeholder={placeholder || "Click to pick a skill, or type to search / add custom"}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) add(matches[0]); else if (q.trim() && !exact) addCustom() } }} />
        {open && (matches.length > 0 || q.trim()) && (
          // zIndex 50 is LEFT ALONE deliberately. The Z scale jumps sticky:30 →
          // nav:60 with nothing between, and this dropdown belongs exactly
          // there: over a page's sticky header, under the global nav. Z.sticky
          // would tie it with the header it must cover and Z.nav would float a
          // form's dropdown above the app bar, so tokenising here would trade
          // correct stacking for a tidier baseline.
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: C.card, border: `1px solid ${TK.line}`, borderRadius: 11, marginTop: 6, zIndex: 50, maxHeight: 220, overflowY: 'auto', boxShadow: E.floating }}>
            {matches.map(s => <div key={s} onClick={() => add(s)} style={{ padding: '9px 13px', cursor: 'pointer', fontSize: 13.5, color: C.ink }}>{s}</div>)}
            {q.trim() && !exact && (
              <div onClick={addCustom} style={{ padding: '9px 13px', cursor: 'pointer', fontSize: 13.5, color: C.purple, fontWeight: 600, borderTop: matches.length ? `1px solid ${C.border}` : 'none' }}>+ Add custom: “{q.trim()}”</div>
            )}
            {matches.length === 0 && !q.trim() && <div style={{ padding: '9px 13px', fontSize: 12.5, color: C.faint }}>Type to search or add a skill…</div>}
          </div>
        )}
      </div>
    </div>
  )
}

type Person = { id: string; full_name: string; emp_code: string; designation: string | null }

const EMPTY = {
  mrf_number: '',
  mrf_type: 'Full MRF', hiring_type: 'New Hire', urgency: 'MEDIUM', raised_by_name: '', raised_by_role: '',
  job_title: '', designation: '', business_unit: '', grade: '', job_code: '', no_of_openings: '1',
  employment_type: 'Employee', work_mode: 'Onsite', location_id: '',
  cost_center: '', is_budgeted: '', headcount_ref: '', currency: 'INR', budget_min: '', budget_max: '', wage_category: '', duration_months: '',
  reason: '', outgoing_employee_id: '', exit_reason: '', business_justification: '',
  target_joining_date: '', validity_date: '',
  experience_min: '', experience_max: '', education_min: '', education_max: '', previous_company_preference: '',
  skills_required: '', good_to_have_skills: '', job_description: '',
  ctq_questions: [] as string[],   // questions the interviewers should ask (optional)
  sourcing_mode: 'External', sourcing_channels: [] as string[],
}

// Map a manpower_requisitions row back into the form shape — used when editing a
// requisition that was sent back for revision.
export function mrfToForm(m: any): Record<string, any> {
  return {
    ...EMPTY,
    mrf_number: m.mrf_number || '',
    mrf_type: m.mrf_type || 'Full MRF', hiring_type: m.hiring_type || 'New Hire', urgency: m.urgency || 'MEDIUM',
    raised_by_name: m.raised_by_name || '', raised_by_role: m.raised_by_role || '',
    job_title: m.job_title || '', designation: m.designation || m.position || '', business_unit: m.business_unit || '',
    grade: m.grade || '', job_code: m.job_code || '', no_of_openings: String(m.no_of_openings || m.openings || 1),
    employment_type: m.employment_type || 'Employee', work_mode: m.work_mode || 'Onsite', location_id: m.location_id || '',
    cost_center: m.cost_center || '', is_budgeted: m.is_budgeted === true ? 'yes' : m.is_budgeted === false ? 'no' : '',
    headcount_ref: m.headcount_ref || '', currency: m.currency || 'INR',
    budget_min: m.budget_min != null ? String(m.budget_min) : '', budget_max: m.budget_max != null ? String(m.budget_max) : '',
    wage_category: m.wage_category || '',
    duration_months: m.duration_months != null ? String(m.duration_months) : '',
    reason: m.reason || m.reason_for_hire || '', outgoing_employee_id: m.outgoing_employee_id || '', exit_reason: m.exit_reason || '',
    business_justification: m.business_justification || '',
    target_joining_date: (m.target_joining_date || '').slice(0, 10), validity_date: (m.validity_date || '').slice(0, 10),
    experience_min: m.experience_min != null ? String(m.experience_min) : '', experience_max: m.experience_max != null ? String(m.experience_max) : '',
    education_min: m.education_min || '', education_max: m.education_max || '', previous_company_preference: m.previous_company_preference || '',
    skills_required: m.skills_required || '', good_to_have_skills: m.good_to_have_skills || '', job_description: m.job_description || '',
    ctq_questions: Array.isArray(m.ctq_questions) ? m.ctq_questions.map(String) : [],
    sourcing_mode: m.sourcing_mode || 'External', sourcing_channels: Array.isArray(m.sourcing_channels) ? m.sourcing_channels : [],
  }
}

export default function MrfForm({ employeeId, onDone, onCancel, notify, initial, replaceId, readOnly, viewRow, onApprove, onReject, onRevise, actionBusy }: {
  employeeId: string
  onDone: () => void
  onCancel: () => void
  notify: (m: string, t?: 'success' | 'error') => void
  initial?: Record<string, any> | null   // prefill (editing a sent-back requisition)
  replaceId?: string | null              // scrap this requisition when the new one is submitted
  // ── read-only approval mode ──
  readOnly?: boolean                     // show the requisition filled but non-editable
  viewRow?: any | null                   // the MRF row being reviewed (its raiser gives the locked fields)
  onApprove?: () => void
  onReject?: (note: string) => void
  onRevise?: (note: string) => void      // "send back for revision"
  actionBusy?: boolean
}) {
  const [form, setForm] = useState<any>({ ...EMPTY, ...(initial || {}) })
  const [done, setDone] = useState<null | { id: string; mrf_number?: string }>(null)   // success screen after submit
  const [replaceRef, setReplaceRef] = useState<string | null>(replaceId || null)
  const [masters, setMasters] = useState<Record<string, Master[]>>({})
  const [people, setPeople] = useState<Person[]>([])
  const [skills, setSkills] = useState<string[]>([])
  const [locations, setLocations] = useState<{ id: string; location_name: string }[]>([])
  const [auto, setAuto] = useState<any>(null)   // raiser autofill bundle
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sbOpen, setSbOpen] = useState(false)   // send-back note box (read-only mode)
  const [sbNote, setSbNote] = useState('')
  // In read-only approval mode the locked Company/Department/RM fields must reflect the
  // MRF's RAISER, not the approver looking at it — so the autofill reads the raiser's row.
  const raiserId = readOnly && viewRow?.requested_by ? String(viewRow.requested_by) : employeeId
  // Requisition ID is reserved the moment the form opens (same MRF-YYYY-NNNNN shape as the
  // DB default), checked against existing rows, and sent on save — so the raiser sees the
  // number while filling, and what they see is exactly what gets saved.
  async function reserveMrfNumber() {
    for (let i = 0; i < 6; i++) {
      const cand = newMrfNumber()
      const { data } = await supabase.from('manpower_requisitions').select('id').eq('mrf_number', cand).maybeSingle()
      if (!data) { setForm((f: any) => ({ ...f, mrf_number: cand })); return }
    }
  }
  useEffect(() => { if (!readOnly && !(initial as any)?.mrf_number) reserveMrfNumber() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const F = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  // Persist a brand-new skill to the master so it is there next time, and show it now.
  const addSkill = async (name: string) => {
    const n = name.trim(); if (!n) return
    setSkills(s => (s.some(x => x.toLowerCase() === n.toLowerCase()) ? s : [...s, n].sort((a, b) => a.localeCompare(b))))
    await supabase.from('skills').insert({ name: n }).then(() => {}, () => {})   // ignore duplicates
  }

  useEffect(() => {
    let live = true
    ;(async () => {
      setLoading(true)
      // The raiser — their company & department (locked) and reporting line.
      const { data: me } = await supabase.from('employees')
        .select('id, full_name, emp_code, designation, company_id, department_id, hod_id, l1_manager_id, companies:companies!employees_company_id_fkey(company_name), departments:departments!employees_department_id_fkey(dept_name, dept_code)')
        .eq('id', raiserId).maybeSingle()
      const mm: any = me || {}
      const others = [mm.l1_manager_id, mm.hod_id].filter(Boolean)
      const { data: rel } = others.length
        ? await supabase.from('employees').select('id, full_name, emp_code').in('id', others)
        : { data: [] as any[] }
      const byId: Record<string, any> = {}; (rel || []).forEach((r: any) => { byId[r.id] = r })
      // Raiser's ESS role (for "Raised By — Role"): first non-Employee role, else designation.
      let role = mm.designation || ''
      const { data: acct } = await supabase.from('ess_accounts').select('id').eq('employee_id', raiserId).maybeSingle()
      if (acct?.id) {
        const { data: ur } = await supabase.from('ess_user_roles').select('ess_roles(role_name, role_code)').eq('ess_account_id', acct.id).eq('is_active', true)
        const names = (ur || []).map((r: any) => r.ess_roles).filter((r: any) => r && r.role_code !== 'EMPLOYEE')
        if (names.length) role = names[0].role_name
      }
      const fmt = (p: any) => p ? `${p.full_name} (${p.emp_code})` : '—'
      const bundle = {
        name: mm.full_name || '', code: mm.emp_code || '', designation: mm.designation || '', role,
        company_id: mm.company_id || '', company_name: mm.companies?.company_name || '—',
        department_id: mm.department_id || '', department_name: mm.departments?.dept_name || '—', department_code: mm.departments?.dept_code || '',
        rm1: mm.full_name ? `${mm.full_name} (${mm.emp_code})` : '—',
        rm2: fmt(byId[mm.l1_manager_id]), rm2_id: mm.l1_manager_id || '',
        hod: fmt(byId[mm.hod_id]), hod_id: mm.hod_id || '',
      }
      // Reference lists — company-scoped where it matters.
      const [mst, ppl, locs, sk] = await Promise.all([
        loadMasters(['grade', 'shift_type', 'candidate_source', 'separation_reason', 'business_unit', 'cost_center', 'currency']),
        mm.company_id ? supabase.from('employees').select('id, full_name, emp_code, designation').eq('company_id', mm.company_id).eq('employment_status', 'Active').order('full_name') : Promise.resolve({ data: [] as any[] }),
        mm.company_id ? supabase.from('locations').select('id, location_name').eq('company_id', mm.company_id).eq('status', 'Active').order('location_name') : Promise.resolve({ data: [] as any[] }),
        supabase.from('skills').select('name').order('name'),
      ])
      if (!live) return
      setAuto(bundle)
      setMasters(mst)
      setPeople((ppl.data as any[]) || [])
      setLocations((locs.data as any[]) || [])
      setSkills(((sk.data as any[]) || []).map((r: any) => r.name).filter(Boolean))
      setForm((f: any) => ({ ...f, raised_by_name: f.raised_by_name || bundle.name, raised_by_role: f.raised_by_role || bundle.role }))
      setLoading(false)
    })()
    return () => { live = false }
  }, [raiserId])

  const isQuick = form.mrf_type === 'Quick Hire'
  const isReplacement = form.hiring_type === 'Replacement' || form.hiring_type === 'Backfill'
  const comp = compOf(form.employment_type)

  // Lane check — annualised max vs the ₹6L cap.
  const annualMax = (Number(form.budget_max) || 0) * (comp.period === 'MONTHLY' ? 12 : 1)
  // The same annualisation applied to the floor, so the lane meter can draw the
  // whole band. Presentation only — no check reads this.
  const annualMin = (Number(form.budget_min) || 0) * (comp.period === 'MONTHLY' ? 12 : 1)
  const laneShouldBe = annualMax > QUICK_HIRE_CAP ? 'Full MRF' : 'Quick Hire'
  const laneMismatch = !!form.budget_max && laneShouldBe !== form.mrf_type

  async function save(status: 'DRAFT' | 'SUBMITTED') {
    const designation = String(form.designation || '').trim()
    if (!designation) { notify('Designation is required.', 'error'); return }
    const bMin = Number(form.budget_min) || 0, bMax = Number(form.budget_max) || 0
    if (bMin && bMax && bMin > bMax) { notify(`${comp.label} range minimum (₹${bMin.toLocaleString('en-IN')}) cannot be more than the maximum (₹${bMax.toLocaleString('en-IN')}).`, 'error'); return }
    if (status === 'SUBMITTED') {
      if (!form.reason) { notify('Reason for hire is required to submit.', 'error'); return }
      if (!form.target_joining_date) { notify('Target joining date is required to submit.', 'error'); return }
      if (!isQuick && !String(form.skills_required || '').trim() && !String(form.job_description || '').trim()) { notify('Add mandatory skills or a job description to submit a Full MRF.', 'error'); return }
      if (isReplacement && !form.outgoing_employee_id) { notify('Pick the outgoing employee for a replacement.', 'error'); return }
    }
    setSaving(true)
    try {
      const payload = {
        action: 'create', status, designation,
        mrf_number: form.mrf_number || null,   // the number shown in the form — kept on resubmit too
        replace_id: replaceRef || null,   // scrap the old requisition (resubmit / edit after send-back)
        mrf_type: form.mrf_type, hiring_type: form.hiring_type, urgency: form.urgency,
        raised_by_name: form.raised_by_name || null, raised_by_role: form.raised_by_role || null,
        job_title: form.job_title || null, business_unit: form.business_unit || null, grade: form.grade || null, job_code: form.job_code || null,
        openings: Number(form.no_of_openings) || 1,
        hod_id: auto?.hod_id || null,
        employment_type: form.employment_type, work_mode: form.work_mode, location_id: form.location_id || null,
        cost_center: form.cost_center || null, is_budgeted: form.is_budgeted, headcount_ref: form.headcount_ref || null,
        currency: form.currency || 'INR', budget_min: form.budget_min || null, budget_max: form.budget_max || null,
        wage_category: form.wage_category || null,
        compensation_type: comp.kind, pay_period: comp.period,
        duration_months: (comp.fixedTerm || form.duration_months) ? (Number(form.duration_months) || null) : null,
        reason: form.reason || null,
        outgoing_employee_id: isReplacement ? (form.outgoing_employee_id || null) : null,
        exit_reason: isReplacement ? (form.exit_reason || null) : null,
        business_justification: form.business_justification || null,
        target_joining_date: form.target_joining_date || null, validity_date: form.validity_date || null,
        experience_min: form.experience_min || null, experience_max: form.experience_max || null,
        education_min: form.education_min || null, education_max: form.education_max || null,
        previous_company_preference: form.previous_company_preference || null,
        skills_required: form.skills_required || null, good_to_have_skills: form.good_to_have_skills || null,
        ctq_questions: (form.ctq_questions || []).map((q: string) => String(q).trim()).filter(Boolean),
        job_description: form.job_description || null,
        sourcing_mode: form.sourcing_mode || null, sourcing_channels: form.sourcing_channels || [],
      }
      const res = await api('/api/ess/mrf', employeeId, { method: 'POST', body: JSON.stringify(payload) })
      if (status === 'DRAFT') { notify('MRF saved as draft.'); onDone(); return }
      // Submitted → show the success screen with "raise one more" / "resubmit".
      setReplaceRef(null)
      setDone({ id: res?.id || '', mrf_number: res?.mrf_number || form.mrf_number || '' })
    } catch (e: any) { notify(e.message, 'error') } finally { setSaving(false) }
  }

  // Reset to a fresh, blank requisition (keeps the autofilled name/role + company chain).
  function raiseAnother() {
    setForm({ ...EMPTY, raised_by_name: auto?.name || '', raised_by_role: auto?.role || '' })
    setReplaceRef(null); setDone(null)
    reserveMrfNumber()   // a fresh number for the next requisition
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }
  // Go back to editing the just-submitted one — on the next submit it is scrapped and a
  // corrected requisition is submitted in its place.
  function resubmit() {
    setReplaceRef(done?.id || null); setDone(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }

  if (loading) return <div style={{ fontSize: 13, color: C.muted, padding: '10px 0' }}>Loading form…</div>

  // ── Success screen ─────────────────────────────────────────────────────────
  if (done) return (
    <div style={{ border: `1px solid ${TK.positiveEdge}`, borderRadius: 20, padding: '32px 24px', marginBottom: 12, background: C.greenBg, boxShadow: E.raised, textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: C.green, color: TK.onAccent, fontSize: 36, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>✓</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>You have successfully raised the MRF</div>
      {done.mrf_number && <div style={{ display: 'inline-block', marginTop: 8, fontSize: 13, fontWeight: 700, color: C.purpleD, background: C.soft, borderRadius: 99, padding: '4px 14px', letterSpacing: '.03em' }}>Requisition ID: {done.mrf_number}</div>}
      <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.6, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
        It’s been sent for approval through your reporting chain (RM2 → HR Head).
        You can raise another, or resubmit this one if you spotted a mistake (the one you just submitted will be scrapped).
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
        <button type="button" style={st.btn} onClick={raiseAnother}>＋ Raise one more MRF</button>
        <button type="button" style={st.btnO} onClick={resubmit}>↺ Resubmit (fix this one)</button>
        <button type="button" style={{ ...st.btnO, marginLeft: 8 }} onClick={onDone}>Done</button>
      </div>
    </div>
  )

  return (
    <div className="ez-mrf" style={{ border: `1px solid ${TK.line}`, borderRadius: 20, padding: '20px 22px', marginBottom: 12, background: TK.surface, boxShadow: E.raised }}>
      {/* :focus and ::placeholder cannot be expressed inline, and this form
          cannot reach a stylesheet — recruitment.redesign.css is imported by
          one layout and the ESS side imports no CSS at all. One scoped block,
          the same trick UIKeyframes uses, gives every field the redesign's
          focus ring on BOTH screens. */}
      {/* !important on border-color only, and it is load-bearing: the border is
          set INLINE (this repo styles inline by rule), and an inline
          declaration outranks any stylesheet rule without it. Measured — the
          ring landed and the border stayed grey until this was added. The
          box-shadow needs no such help; nothing sets it inline. */}
      <style>{`.ez-mrf input:focus,.ez-mrf select:focus,.ez-mrf textarea:focus{border-color:${TK.brand}!important;box-shadow:0 0 0 4px ${TK.brandTint}}
.ez-mrf input::placeholder,.ez-mrf textarea::placeholder{color:${TK.faint}}`}</style>
      {readOnly && (
        <div style={{ fontSize: 12.5, color: C.ink, background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 8, padding: '9px 12px', marginBottom: 10, fontWeight: 600 }}>
          Reviewing this requisition — read only. Use the buttons at the bottom to Approve, Send back, or Reject.
        </div>
      )}
      <div style={{ pointerEvents: readOnly ? 'none' : undefined }}>
      {replaceRef && (
        <div style={{ fontSize: 12.5, color: TK.warning, background: TK.warningTint, border: `1px solid ${TK.warningEdge}`, borderRadius: 11, padding: '10px 13px', marginBottom: 12, lineHeight: 1.55 }}>
          <b>Editing / resubmitting.</b> When you submit, the previous requisition is scrapped and this corrected one goes for approval afresh.
        </div>
      )}
      {/* Quick Hire / Full MRF toggle */}
      <div style={{ display: 'flex', gap: 4, border: `1px solid ${TK.line}`, background: TK.sunken, borderRadius: 13, padding: 4, marginBottom: 4 }}>
        {(['Quick Hire', 'Full MRF'] as const).map(t => (
          <button key={t} type="button" onClick={() => F('mrf_type', t)}
            style={{ flex: 1, height: 36, border: '1px solid transparent', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              background: form.mrf_type === t ? `linear-gradient(180deg, ${TK.brand}, ${TK.brandDeep})` : 'transparent',
              borderColor: form.mrf_type === t ? TK.brandDeep : 'transparent',
              boxShadow: form.mrf_type === t ? E.brand : 'none',
              color: form.mrf_type === t ? TK.onAccent : TK.muted }}>
            {t} ({t === 'Quick Hire' ? 'CTC ≤ ₹6L' : 'CTC > ₹6L'})
          </button>
        ))}
      </div>
      {laneMismatch && (
        <div style={{ fontSize: 12.5, color: C.red, background: C.redBg, border: `1px solid ${TK.criticalEdge}`, borderRadius: 11, padding: '9px 12px', margin: '10px 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>This budget suits <b>{laneShouldBe}</b>.</span>
          <button type="button" style={{ ...st.btnO, height: 30, padding: '0 12px', fontSize: 12.5 }} onClick={() => F('mrf_type', laneShouldBe)}>Switch to {laneShouldBe}</button>
        </div>
      )}

      {/* 1 · Requisition Meta */}
      <SectionLine n="1" title="Requisition Meta" />
      <div style={g2}>
        <Field label="Requisition Type"><Sel value={form.hiring_type} onChange={v => F('hiring_type', v)}>{REQ_TYPES.map(t => <option key={t}>{t}</option>)}</Sel></Field>
        <Field label="Priority"><Sel value={form.urgency} onChange={v => F('urgency', v)}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel></Field>
        <Field label="Requisition ID" hint={form.mrf_number ? 'Reserved for this requisition' : 'Reserving a number…'}><div style={{ ...st.input, background: C.locked, color: form.mrf_number ? C.ink : C.faint, fontWeight: form.mrf_number ? 700 : 400, letterSpacing: form.mrf_number ? '.03em' : 0, display: 'flex', alignItems: 'center', minHeight: 38 }}>{form.mrf_number || 'Generating…'}</div></Field>
        <Field label="Raised By — Name"><input style={st.input} value={form.raised_by_name} onChange={e => F('raised_by_name', e.target.value)} placeholder="Your name" /></Field>
        <Field label="Raised By — Role"><input style={st.input} value={form.raised_by_role} onChange={e => F('raised_by_role', e.target.value)} placeholder="e.g. Department Head" /></Field>
      </div>

      {/* 2 · Position Details */}
      <SectionLine n="2" title="Position Details" />
      <div style={g2}>
        <Locked label="Company" value={auto?.company_name} hint="auto · your company" />
        <Locked label="Department / Function" value={auto?.department_name} hint="auto · your department" />
        <Field label="Business Unit"><MasterSel value={form.business_unit} onChange={v => F('business_unit', v)} opts={masters.business_unit || []} placeholder="Select…" /></Field>
        <Field label="Job Title"><input style={st.input} value={form.job_title} onChange={e => F('job_title', e.target.value)} placeholder="e.g. Backend Engineer II" /></Field>
        <Field label="Designation" required><input style={st.input} value={form.designation} onChange={e => F('designation', e.target.value)} placeholder="e.g. Senior Engineer" /></Field>
        <Field label="No. of Openings"><input type="number" min="1" style={st.input} value={form.no_of_openings} onChange={e => F('no_of_openings', e.target.value)} /></Field>
        <Field label="Grade / Band"><MasterSel value={form.grade} onChange={v => F('grade', v)} opts={masters.grade || []} placeholder="Select…" /></Field>
        <Field label="Job Code" hint={form.job_code ? 'Custom code' : 'Auto-generated on save — leave blank, or type your own'}><input style={st.input} value={form.job_code} onChange={e => F('job_code', e.target.value)} placeholder={`${jobCodePrefix(auto?.department_code, auto?.department_name, form.designation)}## (auto)`} /></Field>
        <Locked label="RM1 — Reporting Manager" value={auto?.rm1} hint="auto · you" />
        <Locked label="RM2 — Skip-level Manager" value={auto?.rm2} hint="auto · your manager" />
        <Locked label="HOD — Department Head" value={auto?.hod} hint="auto · your HOD" />
      </div>

      {/* 3 · Employment Details */}
      <SectionLine n="3" title="Employment Details" />
      <div style={g2}>
        <Field label="Employment Type"><Sel value={form.employment_type} onChange={v => F('employment_type', v)}>{EMP_TYPES.map(t => <option key={t}>{t}</option>)}</Sel></Field>
        <Field label="Work Mode"><Sel value={form.work_mode} onChange={v => F('work_mode', v)}>{WORK_MODES.map(t => <option key={t}>{t}</option>)}</Sel></Field>
        <Field label="Work Location"><Sel value={form.location_id} onChange={v => F('location_id', v)}><option value="">Select Location</option>{locations.map(l => <option key={l.id} value={l.id}>{l.location_name}</option>)}</Sel></Field>
      </div>

      {/* 4 · Budget & Cost */}
      <SectionLine n="4" title="Budget & Cost" />
      <div style={{ fontSize: 12.5, color: TK.inkSoft, background: C.soft, border: `1px solid ${TK.brandEdge}`, borderRadius: 11, padding: '9px 12px', margin: '2px 0 12px' }}>
        {form.employment_type} → paid as <b>{comp.label.toLowerCase()}</b>, quoted <b>{perLabel(comp.period)}</b>
      </div>
      <div style={g2}>
        <Field label="Cost Center"><MasterSel value={form.cost_center} onChange={v => F('cost_center', v)} opts={masters.cost_center || []} placeholder="Select…" /></Field>
        <Field label="Budgeted Position"><Sel value={form.is_budgeted} onChange={v => F('is_budgeted', v)}><option value="">Not specified</option><option value="yes">Yes — budgeted</option><option value="no">No — unbudgeted</option></Sel></Field>
        <Field label="Approved Headcount Ref."><input style={st.input} value={form.headcount_ref} onChange={e => F('headcount_ref', e.target.value)} placeholder="e.g. HCP-2026-014" /></Field>
        <Field label="Currency"><MasterSel value={form.currency} onChange={v => F('currency', v)} opts={masters.currency || []} placeholder="INR" useCode /></Field>
        <Field label={`${comp.label} Range — Min`} hint={perLabel(comp.period)}><input type="number" style={st.input} value={form.budget_min} onChange={e => F('budget_min', e.target.value)} placeholder={comp.ph[0]} /></Field>
        <Field label={`${comp.label} Range — Max`} hint={perLabel(comp.period)}><input type="number" style={{ ...st.input, ...((Number(form.budget_min) > 0 && Number(form.budget_max) > 0 && Number(form.budget_min) > Number(form.budget_max)) ? { borderColor: C.red } : {}) }} value={form.budget_max} onChange={e => F('budget_max', e.target.value)} placeholder={comp.ph[1]} /></Field>
        {Number(form.budget_min) > 0 && Number(form.budget_max) > 0 && Number(form.budget_min) > Number(form.budget_max) && (
          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: C.red, background: C.redBg, borderRadius: 7, padding: '7px 10px' }}>Minimum cannot be more than maximum — please correct the {comp.label.toLowerCase()} range.</div>
        )}
        <Field label="Worker / Skill Category" hint="Sets the state minimum wage applied in salary negotiation">
          <Sel value={form.wage_category} onChange={v => F('wage_category', v)}>
            <option value="">Select category…</option>
            {WAGE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
          </Sel>
        </Field>
        {(comp.fixedTerm || comp.period === 'MONTHLY') && (
          <Field label="Duration (months)"><input type="number" min="1" max="60" style={st.input} value={form.duration_months} onChange={e => F('duration_months', e.target.value)} /></Field>
        )}
      </div>
      {/* Where the band sits against the Quick Hire cap.
          The meter DRAWS a decision this form already made — annualMin and
          annualMax are the same annualisation laneShouldBe is computed from, so
          the picture and the check can never disagree. `lane` is null until a
          budget exists, so the badge cannot assert a lane the check never made,
          and the mismatch banner above keeps sole ownership of the switch
          action. Nothing here writes, validates, or changes the lane. */}
      <div style={{ marginTop: 14 }}>
        <LaneMeter
          minRupees={annualMin || null}
          maxRupees={annualMax || null}
          cap={QUICK_HIRE_CAP}
          lane={form.budget_max ? laneShouldBe : null} />
      </div>

      {/* 5 · Justification */}
      <SectionLine n="5" title="Justification" />
      <div style={g2}>
        <Field label="Reason for Hire"><Sel value={form.reason} onChange={v => F('reason', v)}><option value="">Select Reason</option>{REASON_FOR_HIRE.map(r => <option key={r}>{r}</option>)}</Sel></Field>
        <Field label="Outgoing Employee" hint="Only for Replacement / Backfill">
          <Sel value={form.outgoing_employee_id} onChange={v => F('outgoing_employee_id', v)}>
            <option value="">{isReplacement ? 'Select Employee' : '— N/A —'}</option>
            {isReplacement && people.map(p => <option key={p.id} value={p.id}>{p.full_name} ({p.emp_code})</option>)}
          </Sel>
        </Field>
        <Field label="Reason for Exit"><MasterSel value={form.exit_reason} onChange={v => F('exit_reason', v)} opts={isReplacement ? (masters.separation_reason || []) : []} placeholder={isReplacement ? 'Select Reason' : '— N/A —'} /></Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Business Justification"><textarea style={{ ...st.area, minHeight: 80 }} value={form.business_justification} onChange={e => F('business_justification', e.target.value)} placeholder="Why this headcount is needed — business impact, workload, revenue linkage…" /></Field>
      </div>

      {/* 6 · Timeline */}
      <SectionLine n="6" title="Timeline" />
      <div style={g2}>
        <Field label="Target Joining Date"><input type="date" style={st.input} value={form.target_joining_date} onChange={e => F('target_joining_date', e.target.value)} /></Field>
        <Field label="Requisition Validity / Expiry" hint="Auto-flagged as expired if unfilled past this date"><input type="date" style={st.input} value={form.validity_date} onChange={e => F('validity_date', e.target.value)} /></Field>
      </div>

      {/* 7 · Candidate Requirements (Full MRF only) */}
      {!isQuick && <>
        <SectionLine n="7" title="Candidate Requirements" />
        <div style={g2}>
          <Field label="Experience — Min (years)"><input type="number" style={st.input} value={form.experience_min} onChange={e => F('experience_min', e.target.value)} /></Field>
          <Field label="Experience — Max (years)"><input type="number" style={st.input} value={form.experience_max} onChange={e => F('experience_max', e.target.value)} /></Field>
          <Field label="Education — Minimum"><Sel value={form.education_min} onChange={v => F('education_min', v)}><option value="">Any</option>{EDUCATION_OPTIONS.map(o => <option key={o}>{o}</option>)}</Sel></Field>
          <Field label="Education — Maximum"><Sel value={form.education_max} onChange={v => F('education_max', v)}><option value="">Any</option>{EDUCATION_OPTIONS.map(o => <option key={o}>{o}</option>)}</Sel></Field>
          <Field label="Previous Company Preference"><Sel value={form.previous_company_preference} onChange={v => F('previous_company_preference', v)}>{PREV_COMPANY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel></Field>
        </div>
        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
          <Field label="Mandatory Skills"><SkillsMultiSelect value={form.skills_required} onChange={v => F('skills_required', v)} allSkills={skills} onAddSkill={addSkill} /></Field>
          <Field label="Good-to-have Skills"><SkillsMultiSelect value={form.good_to_have_skills} onChange={v => F('good_to_have_skills', v)} allSkills={skills} onAddSkill={addSkill} placeholder="Search good-to-have skills, or add custom" /></Field>
          <Field label="Job Description"><textarea style={{ ...st.area, minHeight: 120 }} value={form.job_description} onChange={e => F('job_description', e.target.value)} placeholder="Role summary, responsibilities, must-haves…" /></Field>
          <Field label="Questions to ask the candidate" hint="optional · every interviewer sees these on the feedback form"><QuestionsList value={form.ctq_questions || []} onChange={v => F('ctq_questions', v)} /></Field>
        </div>
      </>}

      {/* 8 · Approval Workflow (fixed ESS routing) */}
      <SectionLine n="8" title="Approval Workflow" />
      <div style={{ fontSize: 12.5, color: C.muted, background: C.soft, border: `1px solid ${TK.brandEdge}`, borderRadius: 11, padding: '12px 14px', lineHeight: 1.6 }}>
        On submit this routes through your reporting chain, company-scoped:
        <div style={{ marginTop: 4, color: C.ink, fontWeight: 500 }}>You ({auto?.code}) → RM2 {auto?.rm2 !== '—' ? `· ${auto.rm2}` : '(if set)'} → HR Head</div>
      </div>

      {/* 9 · Sourcing (Full MRF only) */}
      {!isQuick && <>
        <SectionLine n="9" title="Sourcing" />
        <div style={g2}>
          <Field label="Internal vs External"><Sel value={form.sourcing_mode} onChange={v => F('sourcing_mode', v)}>{SOURCING_MODES.map(t => <option key={t}>{t}</option>)}</Sel></Field>
        </div>
        <div style={{ marginTop: 10 }}>
          <Field label="Preferred Sourcing Channels"><ChannelPicker value={form.sourcing_channels} onChange={v => F('sourcing_channels', v)} opts={masters.candidate_source || []} /></Field>
        </div>
      </>}

      {/* 10 · Attachments */}
      <SectionLine n="10" title="Attachments" />
      <div style={{ fontSize: 12, color: C.faint }}>Files can be attached from the Recruitment module once the MRF is created.</div>

      </div>{/* end read-only body wrapper */}

      {/* Footer */}
      {readOnly ? (
        <div style={{ marginTop: 16 }}>
          {sbOpen && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.amber, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>Remark — what should the raiser fix?</div>
              <textarea autoFocus value={sbNote} onChange={e => setSbNote(e.target.value)} placeholder="e.g. Budget looks high for this grade — please revise the range." style={{ ...st.input, minHeight: 64, resize: 'vertical' }} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {sbOpen ? (
              <>
                <button type="button" style={st.btnO} disabled={actionBusy} onClick={() => { setSbOpen(false); setSbNote('') }}>← Back</button>
                <button type="button" style={{ ...st.btn, background: C.amber, marginLeft: 'auto' }} disabled={actionBusy || !sbNote.trim()} onClick={() => onRevise?.(sbNote.trim())}>{actionBusy ? 'Sending…' : 'Send back for revision'}</button>
              </>
            ) : (
              <>
                <button type="button" style={{ ...st.btnO, borderColor: C.red, color: C.red }} disabled={actionBusy} onClick={() => onReject?.(sbNote)}>Reject</button>
                <button type="button" style={{ ...st.btnO, borderColor: C.amberEdge, color: C.amber }} disabled={actionBusy} onClick={() => setSbOpen(true)}>↩ Send back</button>
                <button type="button" style={{ ...st.btn, background: C.green, marginLeft: 'auto' }} disabled={actionBusy} onClick={() => onApprove?.()}>{actionBusy ? 'Approving…' : 'Approve'}</button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
          <button type="button" style={st.btnO} disabled={saving} onClick={() => save('DRAFT')}>Save Draft</button>
          <button type="button" style={st.btn} disabled={saving} onClick={() => save('SUBMITTED')}>{saving ? 'Submitting…' : 'Submit for Approval'}</button>
          <button type="button" style={{ ...st.btnO, marginLeft: 'auto' }} disabled={saving} onClick={onCancel}>Cancel</button>
        </div>
      )}
    </div>
  )
}
