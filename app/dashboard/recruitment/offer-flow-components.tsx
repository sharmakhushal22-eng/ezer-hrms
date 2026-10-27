'use client'
import { useState, useEffect, useRef } from 'react'
import { positionGaps } from '@/lib/recruitment/position-required'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
// send-offer-email runs on the server with no session of its own, so the browser
// hands its own over. authHeaders() reads whichever session exists — ESS or the
// dashboard — which matters because this file also renders inside ESS.
import { authHeaders } from '@/lib/auth-headers'

// The design system, aliased around this file's own S.
import {
  C as TK, F as TF, W, R, E, S as SP, Z, tone, eyebrow, numeric, inputStyle,
} from '@/lib/ui'
import { RxPage, RecruitmentHeader, SearchBox, Segmented, Help, Timeline, Callout, CandCard, ApprovalTrail, EmptyState, metaLine, fullDate, ApprovalTracker, trackerStepsOf } from '@/components/recruitment/rx'
// The offer's ceiling is the MRF budget normalised to a year. budget_max is
// quoted in the engagement's own period; offered_ctc is always annual. See
// lib/recruitment/compensation.ts for why that lives outside this page.
import { overCeiling, annualCeiling, compOf } from '@/lib/recruitment/compensation'
// Which letter an engagement gets — employment, internship, NATS / NAPS apprenticeship,
// contract — and the words that go with it (stipend / fees instead of CTC, and so on).
import { letterKindOf, specOf, isFeesKind, type LetterSpec } from '@/lib/recruitment/engagement'
// The offer email's words come from Configuration (one template per engagement), filled here
// so the mail refreshes on every offer-file edit. See lib/config/offer-mail.ts.
import { offerMailVars } from '@/lib/config/offer-mail'
import { occupiesSlot } from '@/lib/recruitment/pipeline-gates'
import { renderText } from '@/lib/config/render'

// ── STYLES ───────────────────────────────────────────────────────
// Bound to the design system. This file owns the name S, so the tokens are
// aliased: TK colour, TF type, SP spacing.
const S = {
  page: { background:TK.canvas, minHeight:'100vh', fontFamily:TF.family, color:TK.ink } as React.CSSProperties,
  card: { background:TK.surface, borderRadius:R.lg, border:`1px solid ${TK.line}`, padding:'14px 16px', marginBottom:SP.md, boxShadow:E.raised } as React.CSSProperties,
  cardP: { background:TK.surface, borderRadius:R.lg, border:`2px solid ${TK.brand}`, padding:'14px 16px', marginBottom:SP.md, boxShadow:E.floating } as React.CSSProperties,
  label: { ...eyebrow, display:'block', marginBottom:5 } as React.CSSProperties,
  input: { ...inputStyle() } as React.CSSProperties,
  select: { ...inputStyle(), cursor:'pointer' } as React.CSSProperties,
  textarea: { ...inputStyle(), height:'auto', minHeight:80, padding:'9px 11px', resize:'vertical' as const, lineHeight:1.5 } as React.CSSProperties,
  btn: (bg: string, c: string) => ({ height:36, padding:'0 16px', borderRadius:R.md, border:'none', cursor:'pointer', fontSize:TF.small, fontWeight:W.semi, fontFamily:'inherit', background:bg, color:c, whiteSpace:'nowrap' as const }) as React.CSSProperties,
  g2: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:SP.md } as React.CSSProperties,
  g3: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:SP.md } as React.CSSProperties,
  sec: { ...eyebrow, display:'flex', alignItems:'center', gap:8, marginBottom:SP.md, marginTop:SP.xs } as React.CSSProperties,
}
const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
const daysDiff = (d: string) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000))

function SecLine({ title }: { title: string }) {
  return (
    <div style={S.sec}>
      {title} <div style={{ flex:1, height:1, background:TK.line }} />
    </div>
  )
}


// Generic matcher for a record carrying company_id/position + an mrf_id (department & location resolve via the MRF).
// `position` is the record's own role string (designation/position); pass '' if none.
function recordMatchesFilters(rec: { company_id?:string|null; mrf_id?:string|null; position?:string }, mrfs:any[], f:any): boolean {
  if (f.company && rec.company_id !== f.company) return false
  if (f.position && (rec.position||'') !== f.position) return false
  if (f.department || f.location) {
    const m = (mrfs||[]).find((mm:any)=>mm.id===rec.mrf_id)
    if (f.department && m?.department_id !== f.department) return false
    if (f.location && m?.location_id !== f.location) return false
  }
  return true
}

const FILTER_EMPTY = { company:'', department:'', position:'', location:'' }
const distinctSorted = (arr:(string|undefined|null)[]) => Array.from(new Set(arr.filter(Boolean))).sort() as string[]

// ── CC picker — search employees by name / code, keep a few as chips. Module scope, so the
// search box never re-mounts while typing. Everyone picked gets the HR Head's approval mail.
type CcEmp = { id: string; full_name: string; emp_code: string | null; designation: string | null }
function CcPicker({ value, onChange }: { value: CcEmp[]; onChange: (v: CcEmp[]) => void }) {
  const supabase = createClient()
  const [emps, setEmps] = useState<CcEmp[]>([])
  const [q, setQ] = useState('')
  useEffect(() => { supabase.from('employees').select('id, full_name, emp_code, designation').is('date_of_leaving', null).order('full_name').then(({ data }) => setEmps((data as CcEmp[]) || [])) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const s = q.trim().toLowerCase()
  const hits = s ? emps.filter(e => !value.some(v => v.id === e.id) && ((e.full_name || '').toLowerCase().includes(s) || (e.emp_code || '').toLowerCase().includes(s))).slice(0, 8) : []
  return (
    <div>
      {value.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:6 }}>
          {value.map(e => (
            <span key={e.id} style={{ display:'inline-flex', alignItems:'center', gap:6, background:TK.brandTint, color:TK.brandDeep, borderRadius:99, padding:'3px 6px 3px 10px', fontSize:11.5, fontWeight:600 }}>
              {e.full_name} <span style={{ color:TK.faint }}>{e.emp_code}</span>
              <button type="button" onClick={() => onChange(value.filter(v => v.id !== e.id))} style={{ border:'none', background:'transparent', cursor:'pointer', color:TK.brandDeep, fontSize:13, lineHeight:1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ position:'relative' }}>
        <input className="rx-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or employee code to CC…" />
        {hits.length > 0 && (
          <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:Z.navMenu, background:TK.surface, border:`1px solid ${TK.line}`, borderRadius:8, marginTop:3, boxShadow:E.floating, maxHeight:220, overflowY:'auto' }}>
            {hits.map(e => (
              <button key={e.id} type="button" onClick={() => { onChange([...value, e]); setQ('') }} style={{ display:'flex', width:'100%', textAlign:'left', gap:8, alignItems:'center', padding:'8px 11px', border:'none', borderBottom:`1px solid ${TK.line}`, background:TK.surface, cursor:'pointer', fontFamily:'inherit' }}>
                <span style={{ flex:1, fontSize:12.5, color:TK.ink }}>{e.full_name} <span style={{ color:TK.faint }}>· {e.emp_code || '-'}{e.designation ? ` · ${e.designation}` : ''}</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


// ── Offer-approval form primitives (module scope: never re-mount while typing) ──
function OaField({ label, hint, children, span }: { label: string; hint?: string; children: React.ReactNode; span?: number }) {
  return (
    <div className="rx-field" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label className="rx-label">{label}</label>
      {children}
      {hint && <div className="rx-hint">{hint}</div>}
    </div>
  )
}
function OaCard({ n, title, sub, tag, children }: { n: number; title: string; sub?: string; tag?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rx-mod">
      <div className="rx-mod-h">
        <div className="rx-mod-t"><span style={{ width:24, height:24, borderRadius:8, background:TK.brandTint, color:TK.brandDeep, display:'grid', placeItems:'center', fontSize:12, fontWeight:800 }}>{n}</span>{title}{tag}</div>
        {sub && <div className="rx-mod-m">{sub}</div>}
      </div>
      {children}
    </div>
  )
}
function OaTile({ l, v, sub, tone }: { l: string; v: string; sub?: string; tone?: 'brand' | 'ok' }) {
  return (
    <div className="rx-tile" style={tone === 'ok' ? { background:TK.positiveTint } : undefined}>
      <div style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color: tone === 'ok' ? TK.positive : TK.muted }}>{l}</div>
      <div style={{ fontSize:18, fontWeight:800, letterSpacing:'-.02em', color: tone === 'ok' ? TK.positive : TK.ink, marginTop:3, ...numeric }}>{v}</div>
      {sub && <div style={{ fontSize:11.5, color:TK.faint, marginTop:2 }}>{sub}</div>}
    </div>
  )
}
const oaGrid = (cols: string): React.CSSProperties => ({ display:'grid', gridTemplateColumns: cols, gap:12 })

// ═══════════════════════════════════════════════════════════════
// RECRUITER: CREATE OFFER APPROVAL REQUEST
// ═══════════════════════════════════════════════════════════════
export function CreateOfferApproval({ candidate, negotiation, mrf, onSubmitted }: any) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [template, setTemplate] = useState('')
  const [showTemplate, setShowTemplate] = useState(false)
  const [cc, setCc] = useState<CcEmp[]>([])
  const [hrHeads, setHrHeads] = useState<{ id:string; name:string; code:string|null }[] | null>(null)
  useEffect(() => {
    const cid = candidate?.company_id || mrf?.company_id
    if (!cid) { setHrHeads([]); return }
    authHeaders().then(h => fetch(`/api/recruitment/offer-approval?company_ids=${cid}`, { headers: h })).then(r => r.json()).then(j => setHrHeads(j.heads?.[cid] || [])).catch(() => setHrHeads([]))
  }, [candidate?.company_id, mrf?.company_id])

  // Position facts the offer letter states (lib/recruitment/position-required.ts): the MRF's
  // department and work location, else what was typed on the candidate. Required to submit.
  const [pos, setPos] = useState<{ department: string | null; location: string | null } | null>(null)
  useEffect(() => {
    const req = candidate?.application_details?.requisition || {}
    Promise.all([
      mrf?.department_id ? supabase.from('departments').select('dept_name').eq('id', mrf.department_id).maybeSingle() : Promise.resolve({ data: null } as any),
      mrf?.location_id ? supabase.from('locations').select('location_name').eq('id', mrf.location_id).maybeSingle() : Promise.resolve({ data: null } as any),
    ]).then(([d, l]: any[]) => setPos({ department: d.data?.dept_name || req.department || null, location: req.job_location || l.data?.location_name || null }))
      .catch(() => setPos({ department: req.department || null, location: req.job_location || null }))
  }, [mrf?.department_id, mrf?.location_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const designation = candidate?.designation || mrf?.designation || mrf?.position || null
  const posGaps = pos ? positionGaps({ designation, department: pos.department, location: pos.location }) : []

  // Everything the recruiter already captured is prefilled: the negotiation's previous-employer
  // fields when it has them, else the Add Candidate form (compensation block, notice, DOJ).
  const comp = candidate?.application_details?.compensation || {}
  const rs = (v: any) => { const n = Number(v); return n > 0 ? Math.round(n) : '' }
  const lpaToRs = (v: any) => { const n = Number(v); return n > 0 ? Math.round(n * 100000) : '' }
  const noticeDays = Number(negotiation?.notice_period_days || candidate?.notice_period_days || candidate?.notice_period || 0)
  const defaultDoj = (() => {
    if (negotiation?.proposed_doj) return String(negotiation.proposed_doj).slice(0, 10)
    if (candidate?.onboarding_date) return String(candidate.onboarding_date).slice(0, 10)
    if (candidate?.doj) return String(candidate.doj).slice(0, 10)
    if (noticeDays > 0) return new Date(Date.now() + noticeDays * 86400000).toISOString().slice(0, 10)
    return ''
  })()

  // Previous employer form
  const [prevForm, setPrevForm] = useState({
    prev_company_name: negotiation?.prev_company_name || candidate?.current_company || comp.offer_company || '',
    prev_company_address: negotiation?.prev_company_address || '',
    prev_total_ctc: rs(negotiation?.prev_total_ctc) || rs(comp.total_current_ctc_rs) || rs(candidate?.current_ctc) || '',
    prev_fixed_ctc: rs(negotiation?.prev_fixed_ctc) || lpaToRs(comp.current_fixed_lpa) || rs(candidate?.current_ctc) || '',
    prev_variable: rs(negotiation?.prev_variable) || lpaToRs(comp.current_variable_lpa) || '',
    prev_ta_da: rs(negotiation?.prev_ta_da) || '',
    prev_additional: negotiation?.prev_additional || (comp.offer_in_hand === 'Yes' && comp.offer_company ? `Offer in hand: ${comp.offer_company}${comp.offer_amount_lpa ? ` (₹${Number(comp.offer_amount_lpa).toFixed(2)} LPA)` : ''}` : ''),
  })

  // Joining details
  const [joining, setJoining] = useState({
    proposed_doj: defaultDoj,
    notice_period_days: noticeDays > 0 ? String(noticeDays) : '',
    notice_buyout: !!comp.buyout && String(comp.buyout).toLowerCase() === 'yes',
    notice_buyout_amount: negotiation?.notice_buyout_amount != null ? String(negotiation.notice_buyout_amount) : '',
  })

  const [recruiterComments, setRecruiterComments] = useState('')
  const [hiringRemark, setHiringRemark] = useState('')
  const P = (k: string, v: any) => setPrevForm(f => ({ ...f, [k]: v }))
  const J = (k: string, v: any) => setJoining(f => ({ ...f, [k]: v }))

  // The approval template is built from the prefilled data as soon as the form opens, so
  // the recruiter reviews it rather than typing it; edits regenerate it via the button.
  // Built as soon as the form opens, and again once the department / location are looked up.
  useEffect(() => { generateTemplate() }, [pos]) // eslint-disable-line react-hooks/exhaustive-deps

  function generateTemplate() {
    // Only lines with a value — the same rule as the HR Head's mail. No "—" or "Nil" filler.
    const money = (v: any) => `₹${fmt(Number(v))}`
    const line = (k: string, v: any) => { const t = v == null ? '' : String(v).trim(); return t ? `  ${k.padEnd(20)} ${t}` : null }
    const block = (title: string, lines: (string | null)[]) => { const L = lines.filter(Boolean); return L.length ? `${title}\n${L.join('\n')}` : null }
    const ctc = Number(negotiation?.offered_ctc || 0), vp = Number(negotiation?.variable_pct || 0)
    const vAmt = ctc > 0 && vp > 0 ? Math.round(ctc * vp / 100) : 0
    const prevT = Number(prevForm.prev_total_ctc || 0)
    const hike = prevT > 0 && ctc > 0 ? ((ctc - prevT) / prevT * 100) : (negotiation?.hike_pct != null ? Number(negotiation.hike_pct) : null)
    const doj = joining.proposed_doj
    const ref = `OAR-${(mrf?.mrf_number || '').replace(/^MRF-/, '') || Date.now().toString().slice(-6)}-${(candidate?.full_name || 'C').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 3)}`
    const parts = [
      `OFFER APPROVAL REQUEST (CONFIDENTIAL)`,
      `Reference ${ref} · ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      '',
      block('CANDIDATE', [
        line('Name', candidate?.full_name), line('Position', designation), line('Department', pos?.department), line('Work location', pos?.location), line('MRF', mrf?.mrf_number),
        line('Experience', candidate?.experience_years != null ? `${candidate.experience_years} years` : null), line('Current company', candidate?.current_company),
      ]),
      block('PREVIOUS EMPLOYER', [
        line('Company', prevForm.prev_company_name), line('Address', prevForm.prev_company_address),
        line('Previous CTC', prevT > 0 ? `${money(prevT)} p.a.` : null),
        line('Fixed', Number(prevForm.prev_fixed_ctc) > 0 ? `${money(prevForm.prev_fixed_ctc)} p.a.` : null),
        line('Variable', Number(prevForm.prev_variable) > 0 ? `${money(prevForm.prev_variable)} p.a.` : null),
        line('TA / DA', Number(prevForm.prev_ta_da) > 0 ? `${money(prevForm.prev_ta_da)} per month` : null),
        line('Additional', prevForm.prev_additional),
      ]),
      block('OFFERED PACKAGE', [
        line('Annual CTC', ctc > 0 ? `${money(ctc)} p.a.` : null),
        line('Fixed', vAmt > 0 ? `${money(ctc - vAmt)} p.a.` : null),
        line('Variable', vAmt > 0 ? `${money(vAmt)} p.a. (${vp}% of CTC)` : null),
        line('Monthly in-hand', negotiation?.net_monthly ? `${money(negotiation.net_monthly)} (est., excl. TDS)` : null),
        line('Joining bonus', Number(negotiation?.joining_bonus) > 0 ? `${money(negotiation.joining_bonus)}${negotiation?.joining_bonus_freq ? ` (${negotiation.joining_bonus_freq})` : ''}` : null),
        line('Retention bonus', Number(negotiation?.retention_bonus) > 0 ? `${money(negotiation.retention_bonus)}${negotiation?.retention_bonus_freq ? ` (${negotiation.retention_bonus_freq})` : ''}` : null),
        line('ESOP', Number(negotiation?.esop_value) > 0 ? `${money(negotiation.esop_value)}${negotiation?.esop_remark ? ` (${negotiation.esop_remark})` : ''}` : null),
        line('Hike', hike != null && isFinite(hike) ? `${hike > 0 ? '+' : ''}${hike.toFixed(1)}% over previous CTC` : null),
      ]),
      block('JOINING', [
        line('Proposed DOJ', doj ? `${new Date(doj).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} (${daysDiff(doj)} days from today)` : null),
        line('Notice period', joining.notice_period_days ? `${joining.notice_period_days} days` : null),
        line('Notice buyout', joining.notice_buyout ? (Number(joining.notice_buyout_amount) > 0 ? `Yes · ${money(joining.notice_buyout_amount)}` : 'Yes') : null),
      ]),
      block('REMARKS', [ line('Hiring manager', hiringRemark), line('Recruiter', recruiterComments) ]),
      cc.length ? block('CC ON THE APPROVAL MAIL', [ `  ${cc.map(e => `${e.full_name}${e.emp_code ? ` (${e.emp_code})` : ''}`).join(', ')}` ]) : null,
      '',
      'Attachments: MRF · interview summary · CTC break-up acknowledgement (password-protected).',
      'Confidential: for internal approval only.',
    ]
    setTemplate(parts.filter(x => x !== null).join('\n\n').replace(/\n{3,}/g, '\n\n'))
    setShowTemplate(true)
  }

  async function submitForApproval() {
    if (!pos || posGaps.length) {
      alert(`${posGaps.join(', ') || 'Designation, department and work location'} ${posGaps.length === 1 ? 'is' : 'are'} required: the offer letter states them. Add them on the MRF (or the candidate) first.`)
      return
    }
    if (!prevForm.prev_company_name || !prevForm.prev_total_ctc) {
      alert('Previous company name and CTC are required')
      return
    }
    if (!joining.proposed_doj) {
      alert('Proposed DOJ is required')
      return
    }
    setSaving(true)

    // Update ctc_negotiations with prev employer data
    await supabase.from('ctc_negotiations').update({
      prev_company_name: prevForm.prev_company_name,
      prev_company_address: prevForm.prev_company_address,
      prev_total_ctc: Number(prevForm.prev_total_ctc) || null,
      prev_fixed_ctc: Number(prevForm.prev_fixed_ctc) || null,
      prev_variable: Number(prevForm.prev_variable) || null,
      prev_ta_da: Number(prevForm.prev_ta_da) || null,
      prev_additional: prevForm.prev_additional || null,
      proposed_doj: joining.proposed_doj,
      notice_period_days: Number(joining.notice_period_days) || null,
    }).eq('id', negotiation?.id)

    // Create offer approval request (retried without notice_buyout_amount if migration 133 is not applied yet)
    const buyoutAmt = joining.notice_buyout && Number(joining.notice_buyout_amount) > 0 ? Number(joining.notice_buyout_amount) : null
    const row: any = {
      candidate_id: candidate?.id,
      mrf_id: candidate?.mrf_id || null,
      company_id: candidate?.company_id || null,
      ctc_negotiation_id: negotiation?.id || null,
      prev_company_name: prevForm.prev_company_name,
      prev_company_address: prevForm.prev_company_address,
      prev_total_ctc: Number(prevForm.prev_total_ctc) || null,
      prev_fixed_ctc: Number(prevForm.prev_fixed_ctc) || null,
      prev_variable: Number(prevForm.prev_variable) || null,
      prev_ta_da: Number(prevForm.prev_ta_da) || null,
      prev_additional: prevForm.prev_additional || null,
      offered_ctc: negotiation?.offered_ctc || null,
      offered_variable_pct: negotiation?.variable_pct || null,
      monthly_inhand: negotiation?.net_monthly || null,
      joining_bonus: negotiation?.joining_bonus || null,
      joining_bonus_freq: negotiation?.joining_bonus_freq || null,
      retention_bonus: negotiation?.retention_bonus || null,
      esop_value: negotiation?.esop_value || null,
      esop_vesting: negotiation?.esop_remark || null,
      hike_pct: negotiation?.hike_pct || null,
      proposed_doj: joining.proposed_doj,
      days_to_join: daysDiff(joining.proposed_doj),
      notice_period_days: Number(joining.notice_period_days) || null,
      notice_buyout: joining.notice_buyout,
      template_content: template,
      status: 'SUBMITTED',
      submitted_at: new Date().toISOString(),
      recruiter_comments: recruiterComments || null,
      hiring_manager_remark: hiringRemark || null,
      notice_buyout_amount: buyoutAmt,
      cc_employee_ids: cc.map(e => e.id),
    }
    let ins = await supabase.from('offer_approval_requests').insert(row).select('id').single()
    if (ins.error && (ins.error.code === 'PGRST204' || /notice_buyout_amount|cc_employee_ids/.test(ins.error.message))) {
      const { notice_buyout_amount: _b, cc_employee_ids: _c, ...rest } = row
      ins = await supabase.from('offer_approval_requests').insert(rest).select('id').single()
    }
    const { data: created, error } = ins

    // Tell the HR Head(s) of the company there is an offer to review and approve (ESS bell +
    // Tasks & Approvals, deep-linked to the HR Head tab). Best-effort: the request stands either way.
    let notified = 0, notifyWarning = '', emailedTo = ''
    if (!error && created?.id) {
      try {
        const r = await fetch('/api/recruitment/offer-approval', { method:'POST', headers: await authHeaders(), body: JSON.stringify({ action:'submitted', request_id: created.id }) })
        const j = await r.json().catch(() => ({}))
        notified = Number(j.notified || 0); notifyWarning = j.warning || j.emailSkipped || (!r.ok ? (j.error || 'notification failed') : '')
        if (Number(j.emailed) > 0) emailedTo = `${j.emailed} recipient(s)`
      } catch { notifyWarning = 'notification failed' }
    }

    // Audit log
    await supabase.from('recruitment_audit_logs').insert({
      candidate_id: candidate?.id,
      company_id: candidate?.company_id || null,
      action_type: 'OFFER_APPROVAL_REQUESTED',
      details: { candidate_name: candidate?.full_name, position: mrf?.designation },
      created_at: new Date().toISOString(),
    })

    setSaving(false)
    if (error) { alert('Error: ' + error.message); return }
    alert(notified > 0
      ? `Offer approval request submitted. The HR Head has been notified to review and approve (${notified} notified${emailedTo ? `, mail sent to ${emailedTo}` : ''}${notifyWarning ? `; ${notifyWarning}` : ''}).`
      : `Offer approval request submitted. ${notifyWarning || 'The HR Head could not be notified.'}`)
    if (onSubmitted) onSubmitted()
  }

  // ── derived, for the summary rail ──
  const ctcN = Number(negotiation?.offered_ctc || 0), varPct = Number(negotiation?.variable_pct || 0)
  const varAmt = ctcN > 0 && varPct > 0 ? Math.round(ctcN * varPct / 100) : 0
  const fixedAmt = ctcN - varAmt
  const prevTotal = Number(prevForm.prev_total_ctc || 0)
  const hikeLive = prevTotal > 0 && ctcN > 0 ? ((ctcN - prevTotal) / prevTotal) * 100 : (negotiation?.hike_pct != null ? Number(negotiation.hike_pct) : null)
  const readiness = [
    { k: 'Previous company', ok: !!prevForm.prev_company_name },
    { k: 'Previous CTC', ok: Number(prevForm.prev_total_ctc) > 0 },
    { k: 'Proposed DOJ', ok: !!joining.proposed_doj },
    { k: 'Approval preview generated', ok: !!template },
    { k: posGaps.length ? `Position: add ${posGaps.join(', ').toLowerCase()} (on the MRF or the candidate)` : 'Designation, department and work location', ok: !!pos && posGaps.length === 0 },
  ]
  const ready = readiness.every(x => x.ok) && !!negotiation
  const initials = (candidate?.full_name || '?').split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
  return (
    <div className="rx-grid rx-stag">
      {/* ── LEFT: the request, in four numbered steps ── */}
      <div className="s8" style={{ display:'flex', flexDirection:'column', gap:16 }}>
        {/* candidate strip */}
        <div className="rx-mod" style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
          <div style={{ width:48, height:48, borderRadius:14, background:`linear-gradient(135deg,${TK.brand},${TK.brandDeep})`, color:TK.onAccent, display:'grid', placeItems:'center', fontWeight:800, fontSize:16, flexShrink:0 }}>{initials}</div>
          <div style={{ flex:'1 1 240px', minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <span style={{ fontSize:17, fontWeight:800, color:TK.ink, letterSpacing:'-.01em' }}>{candidate?.full_name}</span>
              {mrf?.mrf_number && <span className="rx-chip">{mrf.mrf_number}</span>}
              {candidate?.offer_revised && <span className="rx-chip" style={{ color:TK.warning, background:TK.warningTint }}>Revised offer</span>}
            </div>
            <div className="rx-meta" style={{ marginTop:3 }}>
              {[mrf?.designation || candidate?.designation, candidate?.current_company ? `at ${candidate.current_company}` : null, candidate?.experience_years != null ? `${candidate.experience_years} yrs` : null, candidate?.stage].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:TK.muted }}>Accepted offer</div>
            <div style={{ fontSize:20, fontWeight:800, color:TK.positive, ...numeric }}>₹{fmt(ctcN)}</div>
            <div className="rx-meta">per annum</div>
          </div>
        </div>

        {/* 1 · offered package — read only, straight from the calculator */}
        <OaCard n={1} title="Offered package" sub="from the negotiation calculator. Change it there, not here">
          {negotiation ? (<>
            <div style={oaGrid('repeat(auto-fit, minmax(150px, 1fr))')}>
              <OaTile l="Annual CTC" v={`₹${fmt(ctcN)}`} sub={varAmt ? `fixed ₹${fmt(fixedAmt)}` : 'all fixed'} />
              <OaTile l="Variable" v={varAmt ? `₹${fmt(varAmt)}` : 'Nil'} sub={varAmt ? `${varPct}% of CTC` : undefined} />
              <OaTile l="Monthly in-hand" v={`₹${fmt(negotiation.net_monthly || 0)}`} sub="estimated · before TDS" tone="ok" />
              <OaTile l="Hike" v={hikeLive != null && isFinite(hikeLive) ? `${hikeLive > 0 ? '+' : ''}${hikeLive.toFixed(1)}%` : '-'} sub={prevTotal > 0 ? `over ₹${fmt(prevTotal)}` : 'enter previous CTC'} />
            </div>
            {(Number(negotiation.joining_bonus) > 0 || Number(negotiation.retention_bonus) > 0 || Number(negotiation.esop_value) > 0) && (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:12 }}>
                {Number(negotiation.joining_bonus) > 0 && <span className="rx-chip">Joining bonus ₹{fmt(negotiation.joining_bonus)}{negotiation.joining_bonus_freq ? ` · ${negotiation.joining_bonus_freq}` : ''}</span>}
                {Number(negotiation.retention_bonus) > 0 && <span className="rx-chip">Retention ₹{fmt(negotiation.retention_bonus)}{negotiation.retention_bonus_freq ? ` · ${negotiation.retention_bonus_freq}` : ''}</span>}
                {Number(negotiation.esop_value) > 0 && <span className="rx-chip">ESOP ₹{fmt(negotiation.esop_value)}{negotiation.esop_remark ? ` · ${negotiation.esop_remark}` : ''}</span>}
              </div>
            )}
          </>) : (
            <div className="rx-meta">No CTC negotiation found. Build the offer in the Negotiation tab first.</div>
          )}
        </OaCard>

        {/* 2 · previous employer */}
        <OaCard n={2} title="Previous employer" tag={<span className="rx-chip" style={{ color:TK.warning, background:TK.warningTint }}>Confidential · HR only</span>} sub="prefilled from the candidate record; not shown to the candidate">
          <div style={oaGrid('1fr 1fr')}>
            <OaField label="Previous company *"><input className="rx-input" value={prevForm.prev_company_name} onChange={e=>P('prev_company_name',e.target.value)} placeholder="e.g. Amazon India Pvt Ltd" /></OaField>
            <OaField label="Company address"><input className="rx-input" value={prevForm.prev_company_address} onChange={e=>P('prev_company_address',e.target.value)} placeholder="City, State" /></OaField>
          </div>
          <div style={{ ...oaGrid('1fr 1fr 1fr'), marginTop:12 }}>
            <OaField label="Previous total CTC (₹ p.a.) *" hint={prevTotal > 0 && ctcN > 0 ? `hike works out to ${hikeLive! > 0 ? '+' : ''}${hikeLive!.toFixed(1)}%` : undefined}><input className="rx-input" type="number" min={0} step={1} value={prevForm.prev_total_ctc} onChange={e=>P('prev_total_ctc',e.target.value)} placeholder="e.g. 900000" /></OaField>
            <OaField label="Fixed (₹ p.a.)"><input className="rx-input" type="number" min={0} step={1} value={prevForm.prev_fixed_ctc} onChange={e=>P('prev_fixed_ctc',e.target.value)} placeholder="e.g. 810000" /></OaField>
            <OaField label="Variable (₹ p.a.)"><input className="rx-input" type="number" min={0} step={1} value={prevForm.prev_variable} onChange={e=>P('prev_variable',e.target.value)} placeholder="e.g. 90000" /></OaField>
          </div>
          <div style={{ ...oaGrid('1fr 1fr'), marginTop:12 }}>
            <OaField label="TA / DA (₹ monthly)"><input className="rx-input" type="number" min={0} step={1} value={prevForm.prev_ta_da} onChange={e=>P('prev_ta_da',e.target.value)} placeholder="0 if not applicable" /></OaField>
            <OaField label="Any additional payment"><input className="rx-input" value={prevForm.prev_additional} onChange={e=>P('prev_additional',e.target.value)} placeholder="e.g. car allowance, retention, offer in hand" /></OaField>
          </div>
        </OaCard>

        {/* 3 · joining */}
        <OaCard n={3} title="Joining" sub="when the candidate can start, and what it costs to get them">
          <div style={oaGrid('1fr 1fr 1fr')}>
            <OaField label="Proposed date of joining *" hint={joining.proposed_doj ? `${daysDiff(joining.proposed_doj)} days from today` : undefined}><input className="rx-input" type="date" value={joining.proposed_doj} onChange={e=>J('proposed_doj',e.target.value)} /></OaField>
            <OaField label="Notice period (days)"><input className="rx-input" type="number" min={0} step={1} value={joining.notice_period_days} onChange={e=>J('notice_period_days',e.target.value)} placeholder="e.g. 30" /></OaField>
            <OaField label="Notice buyout">
              <div className="rx-seg" style={{ display:'inline-flex', gap:4, padding:4, borderRadius:11, background:TK.sunken }}>
                {[['No', false], ['Yes', true]].map(([l, v]) => (
                  <button key={String(l)} type="button" onClick={() => J('notice_buyout', v)} className="rx-btn sm" style={{ border:'none', boxShadow:'none', background: joining.notice_buyout === v ? TK.surface : 'transparent', color: joining.notice_buyout === v ? TK.ink : TK.muted, fontWeight: joining.notice_buyout === v ? 700 : 500 }}>{l as string}</button>
                ))}
              </div>
            </OaField>
          </div>
          {joining.notice_buyout && (
            <div style={{ ...oaGrid('1fr 2fr'), marginTop:12, alignItems:'end' }}>
              <OaField label="Buyout amount (₹)"><input className="rx-input" type="number" min={0} step={1} value={joining.notice_buyout_amount} onChange={e=>J('notice_buyout_amount',e.target.value)} placeholder="e.g. 60000" /></OaField>
              <div className="rx-hint" style={{ paddingBottom:10 }}>Goes into the approval mail as “Notice buyout”. Leave blank if the amount is not known yet.</div>
            </div>
          )}
        </OaCard>

        {/* 4 · notes & recipients */}
        <OaCard n={4} title="Notes & recipients" sub="context for the HR Head, and who else should get the mail">
          <div style={oaGrid('1fr')}>
            <OaField label="Hiring manager remark / target"><input className="rx-input" value={hiringRemark} onChange={e=>setHiringRemark(e.target.value)} placeholder="e.g. Target for the role, special note for the HR Head…" /></OaField>
            <OaField label="Recruiter comments"><textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', minHeight:76 }} value={recruiterComments} onChange={e=>setRecruiterComments(e.target.value)} placeholder="Any additional context for the HR Head…" /></OaField>
            <OaField label="CC on the approval mail" hint="Everyone here receives the same mail and attachments as the HR Head."><CcPicker value={cc} onChange={setCc} /></OaField>
          </div>
        </OaCard>

        {/* the approval request, as the HR Head will see it */}
        {showTemplate && (
          <div className="rx-mod" style={{ padding:0, overflow:'hidden' }}>
            <div className="rx-mod-h" style={{ padding:'14px 22px 0' }}>
              <div className="rx-mod-t">Approval request: preview</div>
              <div style={{ display:'flex', gap:8 }}>
                <button type="button" className="rx-btn sm" onClick={generateTemplate}>Regenerate</button>
                <button type="button" className="rx-btn sm g" onClick={()=>setShowTemplate(false)}>Hide</button>
              </div>
            </div>
            <div style={{ padding:'0 22px 20px' }}>
              <div className="rx-paper" style={{ padding:'28px 32px', animation:'none' }}>
                <pre style={{ margin:0, whiteSpace:'pre-wrap', fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize:11.5, lineHeight:1.65, color:TK.ink }}>{template}</pre>
              </div>
              <div className="rx-hint" style={{ marginTop:8 }}>This is what goes to the HR Head with the mail. Edit the fields above and click Regenerate to refresh it.</div>
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: summary rail — who approves, what goes, and the two actions ── */}
      <div className="s4" style={{ position:'sticky', top:16, display:'flex', flexDirection:'column', gap:16 }}>
        <div className="rx-mod">
          <div className="rx-mod-h"><div className="rx-mod-t">Approval summary</div></div>
          <div style={{ display:'grid', gap:10 }}>
            <div className="rx-tile" style={{ background:TK.brandTint, border:`1px solid ${TK.brandEdge}` }}>
              <div style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:TK.brandDeep }}>Will be approved by</div>
              <div style={{ fontSize:14, fontWeight:700, color:TK.ink, marginTop:4 }}>
                {hrHeads == null ? 'Looking up the HR Head…' : hrHeads.length ? hrHeads.map(h => `${h.name}${h.code ? ` (${h.code})` : ''}`).join(', ') : 'No HR Head set for this company'}
              </div>
              <div className="rx-hint" style={{ marginTop:2 }}>Notified in HRIS → Tasks & Approvals and by mail{cc.length ? `, CC ${cc.length}` : ''}.</div>
            </div>
            <div>
              <div style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:TK.muted, marginBottom:6 }}>Goes with the mail</div>
              {[['MRF', mrf?.mrf_number ? `Requisition ${mrf.mrf_number} as a PDF` : 'Requisition as a PDF'], ['Interview summary', 'every candidate on this MRF, rounds, scores and decisions'], ['CTC acknowledgement', 'the accepted salary break-up · password-protected (candidate’s mobile number)']].map(([k, v]) => (
                <div key={k} style={{ display:'flex', gap:8, padding:'6px 0', borderTop:`1px solid ${TK.line}`, fontSize:12.5 }}>
                  <span style={{ color:TK.positive, fontWeight:800 }}>📎</span><div><b style={{ color:TK.ink }}>{k}</b><div className="rx-hint">{v}</div></div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:TK.muted, marginBottom:6 }}>Ready to submit?</div>
              {readiness.map(x => (
                <div key={x.k} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', fontSize:12.5, color: x.ok ? TK.ink : TK.muted }}>
                  <span style={{ width:18, height:18, borderRadius:99, display:'grid', placeItems:'center', fontSize:11, fontWeight:800, background: x.ok ? TK.positiveTint : TK.sunken, color: x.ok ? TK.positive : TK.faint }}>{x.ok ? '✓' : '·'}</span>{x.k}
                </div>
              ))}
            </div>
          </div>
          <div className="rx-sep" />
          <div style={{ display:'grid', gap:8 }}>
            <button type="button" className="rx-btn" onClick={generateTemplate} disabled={!negotiation}>{template ? 'Regenerate preview' : 'Generate preview'}</button>
            <button type="button" className="rx-btn p" onClick={submitForApproval} disabled={saving || !ready} style={{ opacity: saving || !ready ? .55 : 1 }}>{saving ? 'Submitting…' : 'Submit to HR Head →'}</button>
            {!ready && <div className="rx-hint" style={{ textAlign:'center' }}>{!template ? 'Generate the preview, then submit.' : 'Fill the starred fields to submit.'}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

// HR HEAD: APPROVAL DASHBOARD
// ═══════════════════════════════════════════════════════════════
export function HRHeadApprovalDashboard({ companies, departments, locations, mrfs:mrfLookup, rail, focusOfferId, employeeId, onReviewMrf }: any = {}) {
  const supabase = createClient()
  const [f, setF] = useState(FILTER_EMPTY)
  const [requests, setRequests] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [action, setAction] = useState<'approve'|'reject'>('approve')
  const [comment, setComment] = useState('')
  const [processing, setProcessing] = useState(false)
  const [tab, setTab] = useState<'pending'|'done'>('pending')
  const [mrfs, setMrfs] = useState<any[]>([])
  const [rejected, setRejected] = useState<any[]>([])
  const [rehireStage, setRehireStage] = useState<Record<string,string>>({})
  const [hq, setHq] = useState('')
  // Rehire can run to dozens of rows; show a few and let the rest open on demand.
  const [showAllRehire, setShowAllRehire] = useState(false)
  const REHIRE_PREVIEW = 4

  useEffect(() => { loadRequests() }, [tab])
  useEffect(() => { loadMrfs(); loadRejected() }, [])
  // Deep link (…&tab=hrhead&offer=<id>): open that candidate's review drawer as soon as it is loaded.
  const focusedOffer = useRef(false)
  useEffect(() => {
    if (!focusOfferId || focusedOffer.current || !requests.length) return
    const hit = requests.find((r: any) => r.id === focusOfferId)
    if (hit) { setSelected(hit); setAction('approve'); setComment(''); focusedOffer.current = true }
    else if (tab === 'pending') setTab('done')   // maybe already decided — look in Approved once
    else focusedOffer.current = true
  }, [focusOfferId, requests, tab])

  async function loadRequests() {
    const { data } = await supabase.from('offer_approval_requests')
      .select('*, candidates(full_name, email, phone, experience_years, current_company, designation, mrf_id), ctc_negotiations(calculation_data)')
      .eq('status', tab === 'pending' ? 'SUBMITTED' : 'HR_HEAD_APPROVED')
      .order('submitted_at', { ascending: false })
    setRequests(data || [])
  }

  // Requisitions in approval, with where each one sits. This list used to carry its own
  // Approve / Reject buttons that wrote status:'APPROVED' / 'REJECTED' straight onto the row —
  // skipping the approval chain, so an MRF could open with its HR Head step still PENDING and
  // no hiring manager assigned (17 rows in the data were left that way). The decision now
  // happens only where the chain is honoured: the MRF tab's review (POST /api/ess/mrf), which
  // checks the caller IS the pending approver, records the step, asks the HR Head to assign the
  // hiring manager(s), advances the chain and notifies. Here: the tracker, and a Review button
  // for the requisitions actually waiting on the viewer. (The hand-off rule, that approving
  // must name the hiring manager(s) of the MRF's own company, is enforced on that same path by
  // lib/recruitment/mrf-approve.ts.)
  async function loadMrfs() {
    const { data } = await supabase.from('manpower_requisitions')
      .select('*, companies(company_name)')
      .in('status', ['SUBMITTED', 'ON_HOLD'])
      .order('created_at', { ascending: false })
    setMrfs(data || [])
  }

  // ── Rehire: HR Head re-enters a rejected candidate into the pipeline ──
  // No Shortlisted: a shortlisted candidate holds one of the requisition's openings
  // (lib/recruitment/pipeline-gates.ts), so re-entering at Shortlisted would jump the
  // interview rounds AND the openings cap at once. Rehire puts them back in the funnel.
  const REHIRE_STAGES = ['Applied','AI Screened','Telephonic','L1','L2','Optional Round']
  async function loadRejected() {
    const { data } = await supabase.from('candidates')
      .select('id, full_name, designation, stage, blacklisted, mrf_id, company_id')
      .eq('stage', 'Rejected').order('created_at', { ascending: false })
    setRejected(data || [])
  }
  async function rehire(c: any, stage: string) {
    if (!stage) { alert('Pick a pipeline stage to place the candidate'); return }
    if (occupiesSlot(stage)) { alert(`A rehired candidate re-enters the interview funnel: ${stage} holds an opening and is reached through the rounds.`); return }
    const { error } = await supabase.from('candidates')
      .update({ stage, blacklisted: false, blacklist_reason: null, status: 'active' }).eq('id', c.id)
    if (error) { alert('Error: ' + error.message); return }
    await supabase.from('recruitment_audit_logs').insert({
      candidate_id: c.id, company_id: c.company_id || null, action_type: 'CANDIDATE_REHIRED',
      details: { to_stage: stage, name: c.full_name }, created_at: new Date().toISOString(),
    })
    setRehireStage(m => { const n = { ...m }; delete n[c.id]; return n })
    loadRejected()
  }

  async function processApproval(req: any = selected, act: 'approve'|'reject' = action, note: string = comment): Promise<boolean> {
    if (act === 'reject' && !note.trim()) { alert('A rejection reason is required'); return false }
    const selected = req, action = act, comment = note
    setProcessing(true)
    // DB CHECK constraint allows only 'APPROVED' / 'REJECTED' (not 'APPROVE'/'REJECT').
    const headAction = action === 'approve' ? 'APPROVED' : 'REJECTED'
    const newStatus = action === 'approve' ? 'HR_HEAD_APPROVED' : 'HR_HEAD_REJECTED'
    const { error } = await supabase.from('offer_approval_requests').update({
      status: newStatus,
      hr_head_action: headAction,
      hr_head_comments: comment,
      hr_head_actioned_at: new Date().toISOString(),
    }).eq('id', selected.id)

    await supabase.from('recruitment_audit_logs').insert({
      candidate_id: selected.candidate_id,
      action_type: `HR_HEAD_${headAction}`,
      details: { candidate_name: selected.candidates?.full_name, comment },
      created_at: new Date().toISOString(),
    })

    // Notify the recruiter(s) on the MRF (and, on approval, the HR managers who send the offer).
    let notified = 0
    if (!error) {
      try {
        const r = await fetch('/api/recruitment/offer-approval', { method:'POST', headers: await authHeaders(), body: JSON.stringify({ action:'decided', request_id: selected.id }) })
        const j = await r.json().catch(() => ({})); notified = Number(j.notified || 0)
      } catch { /* the decision is saved regardless */ }
    }

    setProcessing(false)
    if (error) { alert('Error: ' + error.message); return false }
    setDecided({ action, notified })
    setComment(''); loadRequests()
    return true
  }
  const [decided, setDecided] = useState<{ action: 'approve'|'reject'; notified: number } | null>(null)

  const statusColor = (s: string) => ({
    SUBMITTED: [TK.infoTint,TK.info],
    HR_HEAD_APPROVED: [TK.positiveTint,TK.positive],
    HR_HEAD_REJECTED: [TK.criticalTint,TK.critical],
    OFFER_SENT: [TK.brandTint,TK.brand],
  }[s] || [TK.sunken,TK.muted])

  const ql = hq.trim().toLowerCase()
  // Position options pooled from all three lists shown on this dashboard.
  const positionOpts = distinctSorted([
    ...mrfs.map((m:any)=>m.designation||m.position),
    ...rejected.map((c:any)=>c.designation),
    ...requests.map((r:any)=>r.candidates?.designation),
  ])
  // MRF rows carry company/department/location/designation directly.
  const mrfMatch = (m:any) => recordMatchesFilters({ company_id:m.company_id, mrf_id:m.id, position:m.designation||m.position }, [m], f)
  const fMrfs = mrfs.filter((m:any)=>(!ql || (m.designation||m.position||'').toLowerCase().includes(ql)) && mrfMatch(m))
  const fRejected = rejected.filter((c:any)=>(!ql || (c.full_name||'').toLowerCase().includes(ql)) && recordMatchesFilters({ company_id:c.company_id, mrf_id:c.mrf_id, position:c.designation }, mrfLookup, f))
  const fRequests = requests.filter((r:any)=>(!ql || (r.candidates?.full_name||'').toLowerCase().includes(ql)) && recordMatchesFilters({ company_id:r.company_id, mrf_id:r.mrf_id || r.candidates?.mrf_id, position:r.candidates?.designation }, mrfLookup, f))

  return (
    <RxPage header={
      <RecruitmentHeader
        title="HR Head approvals"
        subtitle="Sign off new requisitions, decide on offers that recruiters have escalated, and re-enter rejected candidates."
        help={<Help label="What lands here">
          <p><b>MRF approvals</b> are requisitions waiting on your sign-off before hiring can start.</p>
          <p><b>Offer approvals</b> arrive from the Offer Approval tab once a candidate has accepted their salary.</p>
          <p><b>Rehire</b> puts a previously rejected candidate back into the pipeline at a stage you choose.</p>
        </Help>}
      />}>
      <div className="rx-grid rx-stag">
        <div className="s12 rx-bar" style={{ gap:10 }}>
          <SearchBox value={hq} onChange={setHq} placeholder="Search candidate or job role…" label="Search approvals" />
          {/* CORRECTION to what step 10 said here: this file's RecFilterBar was
              NOT sticky -- that was page.tsx's separate copy. The reason these
              controls are inline is consistency with the other tabs, and it let
              the duplicated component go once Send Offers stopped using it.
              Same `f` state, same setF. */}
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.company}
            onChange={e=>setF({ ...f, company:e.target.value, department:'', location:'' })}>
            <option value="">All companies</option>
            {(companies||[]).map((co:any)=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.department}
            onChange={e=>setF({ ...f, department:e.target.value })}>
            <option value="">All departments</option>
            {(departments||[]).filter((d:any)=>!f.company||d.company_id===f.company).map((d:any)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.location}
            onChange={e=>setF({ ...f, location:e.target.value })}>
            <option value="">All locations</option>
            {(locations||[]).filter((l:any)=>!f.company||l.company_id===f.company).map((l:any)=><option key={l.id} value={l.id}>{l.location_name}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.position}
            onChange={e=>setF({ ...f, position:e.target.value })}>
            <option value="">All positions</option>
            {positionOpts.map((p:string)=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="s12" style={{ display:'flex', flexDirection:'column', gap:22 }}>

      {/* Offer approvals first: they are the decisions waiting on this person
          and were buried under the MRF and rehire lists (eight rehire rows
          pushed them below the fold). Then MRF approvals, then rehire. */}
      <section style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div className="rx-mod-h" style={{ marginBottom:0, flexWrap:'wrap' }}>
        <div className="rx-mod-t">Offer approvals{tab==='pending' && fRequests.length ? <span className="rx-b b-warn">{fRequests.length} waiting on you</span> : null}</div>
        <Segmented label="Offer approvals" value={tab}
          onChange={(v:'pending'|'done')=>{ setTab(v); setSelected(null) }}
          options={[{ value:'pending' as const, label:`Pending${tab==='pending' ? ` · ${fRequests.length}` : ''}` },
                    { value:'done' as const,    label:`Approved${tab==='done' ? ` · ${fRequests.length}` : ''}` }]} />
      </div>

      {fRequests.length === 0 ? (
        <EmptyState title={ql ? 'No matching candidate' : tab==='pending' ? 'Nothing waiting on you' : 'No approved offers yet'}
          hint={ql ? 'Try another name, or clear the filters.' : tab==='pending' ? 'Offers land here when a recruiter submits them after the candidate accepts the salary link.' : 'Approved offers move to Send Offers for the HR Manager.'} />
      ) : (
        <div className="rx-ccg">
          {fRequests.map((r) => {
            const mn = (mrfLookup||[]).find((m:any)=>m.id===(r.mrf_id || r.candidates?.mrf_id))?.mrf_number
            const on = selected?.id === r.id
            const hike = r.hike_pct != null ? Number(r.hike_pct) : null
            const open = () => { setSelected(r); setAction('approve'); setComment(''); setDecided(null) }
            const pending = r.status === 'SUBMITTED'
            return (
              <CandCard key={r.id} name={r.candidates?.full_name || '-'} mrf={mn} selected={on} onOpen={open}
                label={`${pending ? 'Review' : 'View'} the offer for ${r.candidates?.full_name || 'this candidate'}`}
                badges={pending ? <span className="rx-b b-warn">Awaiting you</span> : <span className="rx-b b-pos">Approved</span>}
                meta={metaLine(r.candidates?.designation, r.candidates?.experience_years != null ? `${r.candidates.experience_years} yr exp` : null, r.candidates?.current_company)}
                body={
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:8 }}>
                    {[['CTC', r.offered_ctc ? `₹${(Number(r.offered_ctc)/100000).toFixed(2)}L` : '-'], ['Hike', hike != null && isFinite(hike) ? `${hike > 0 ? '+' : ''}${hike.toFixed(1)}%` : '-'], ['Joins', r.proposed_doj ? fullDate(r.proposed_doj).replace(/ \d{4}$/, '') : '-']].map(([k,v]) => (
                      <div key={k} className="rx-tile" style={{ padding:'8px 10px', minWidth:0 }}>
                        <div style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:TK.muted }}>{k}</div>
                        <div style={{ fontSize:14.5, fontWeight:700, color: k==='Hike' && hike != null ? (hike < 0 ? TK.critical : TK.positive) : TK.ink, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', ...numeric }}>{v}</div>
                      </div>
                    ))}
                  </div>}
                status={pending ? null : <>Approved{r.hr_head_actioned_at ? ` ${fullDate(r.hr_head_actioned_at)}` : ''} · with the HR Manager in <b>Send Offers</b></>}
                statusTone="pos"
                actions={<>
                  <span className="rx-meta">Submitted {r.submitted_at ? fullDate(r.submitted_at) : '-'}{r.notice_buyout ? ' · buyout' : ''}</span>
                  <span className="sp" />
                  <button type="button" className={pending ? 'rx-btn sm p' : 'rx-btn sm'} onClick={open}>{pending ? 'Review & decide' : 'View'}</button>
                </>} />
            )
          })}
        </div>
      )}
      </section>

      {/* MRFs in approval: read-only tracker; the decision is made in the MRF tab review */}
      <section style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <div className="rx-mod-h" style={{ marginBottom:0 }}><div className="rx-mod-t">MRFs in approval {fMrfs.length > 0 && <span className="rx-meta">{fMrfs.length} · {fMrfs.filter((m:any)=>!!employeeId && trackerStepsOf(m.approval_chain).find(st=>st.status==='PENDING')?.approverId===employeeId).length} waiting on you</span>}</div></div>
        {fMrfs.length === 0 && (
          <div className="rx-mod" style={{ textAlign:'center' as const, padding:16 }}><span className="rx-meta">{ql?'No matching MRF':'No requisitions in approval'}</span></div>
        )}
        {fMrfs.map(m => {
          const n = Number(m.no_of_openings || m.openings || 0)
          const steps = trackerStepsOf(m.approval_chain)
          const pendingStep = steps.find(st => st.status === 'PENDING')
          const mine = !!employeeId && pendingStep?.approverId === employeeId
          return (
          <div key={m.id} className="rx-card" style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
              <div style={{ minWidth:0, flex:'1 1 280px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <span className="rx-cc-n" title={m.designation || m.position || 'Untitled'}>{m.designation || m.position || 'Untitled'}</span>
                  {m.mrf_number && <span className="rx-mrf">{m.mrf_number}</span>}
                  {m.status === 'ON_HOLD' && <span className="rx-b b-warn">On hold</span>}
                </div>
                <div className="rx-cc-m" style={{ marginTop:3 }}>
                  {metaLine(m.companies?.company_name, `${n} opening${n === 1 ? '' : 's'}`, m.employment_type, m.experience_required)}
                </div>
              </div>
              {mine && onReviewMrf && (
                <button type="button" className="rx-btn sm p" style={{ flexShrink:0 }} onClick={()=>onReviewMrf(m.id)}
                  title="Open the requisition to approve (and assign the hiring manager), send back or reject">Review &amp; decide</button>
              )}
            </div>
            {/* Read-only: who it is with now, and the whole chain on click. */}
            <ApprovalTracker steps={steps} status={m.status} raisedAt={m.created_at} viewerId={employeeId} compact />
          </div>
        )})}
      </section>

      {/* Rehire — re-enter rejected candidates into the pipeline at a chosen stage */}
      <section style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <div className="rx-mod-h" style={{ marginBottom:0 }}><div className="rx-mod-t">Rehire rejected candidates <span className="rx-meta">{fRejected.length}</span></div></div>
        {fRejected.length === 0 && (
          <div className="rx-mod" style={{ textAlign:'center' as const, padding:16 }}><span className="rx-meta">{ql?'No matching candidate':'No rejected candidates'}</span></div>
        )}
        {(showAllRehire || ql ? fRejected : fRejected.slice(0, REHIRE_PREVIEW)).map(c => {
          const mn = (mrfLookup||[]).find((m:any)=>m.id===c.mrf_id)?.mrf_number
          return (
          <div key={c.id} className="rx-card" style={{ display:'flex', /* see the MRF row above */ flexDirection:'row', flexWrap:'wrap', justifyContent:'space-between', alignItems:'center', gap:10, padding:'10px 13px' }}>
            <div style={{ minWidth:0, flex:'1 1 220px', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <span className="rx-cc-n" title={c.full_name}>{c.full_name}</span>
              {mn && <span className="rx-mrf">{mn}</span>}
              {c.blacklisted && <span className="rx-cc-tag crit">Blacklisted</span>}
              {c.designation && <span className="rx-meta" style={{ fontSize:12 }}>{c.designation}</span>}
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
              <select value={rehireStage[c.id] || ''} onChange={e=>setRehireStage(m=>({ ...m, [c.id]: e.target.value }))} className="rx-input" style={{ width:160, height:34, fontSize:13 }} aria-label={`Stage to place ${c.full_name} at`}>
                <option value="">Place at stage…</option>
                {REHIRE_STAGES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
              <button type="button" className="rx-btn sm" disabled={!rehireStage[c.id]} title={rehireStage[c.id] ? `Rehire at ${rehireStage[c.id]}` : 'Pick a stage first'} onClick={()=>rehire(c, rehireStage[c.id])}>Rehire</button>
            </div>
          </div>
        )})}
        {!ql && fRejected.length > REHIRE_PREVIEW && (
          <button type="button" className="rx-btn sm g" style={{ alignSelf:'flex-start' }} onClick={()=>setShowAllRehire(v=>!v)}>
            {showAllRehire ? 'Show fewer' : `Show all ${fRejected.length}`}
          </button>
        )}
      </section>

      {selected && (
        <OfferReviewDrawer
          req={selected} mrf={(mrfLookup||[]).find((m:any)=>m.id===(selected.mrf_id || selected.candidates?.mrf_id)) || null} locations={locations || []}
          processing={processing} decided={decided}
          onClose={()=>{ setSelected(null); setDecided(null); setComment('') }}
          onDecide={(act, note)=>processApproval(selected, act, note)}
          onRevised={(n)=>{ setDecided({ action:'approve', notified:n }); setComment(''); loadRequests() }} />
      )}
        </div>
      </div>
    </RxPage>
  )
}


// ── Documents on the review screen — the approval pack, previewable and downloadable in place ──
// The generated PDFs come through the API (it needs the session), so they are fetched as a blob:
// saved for Download, shown in a frame for Preview. MRF uploads arrive as two short-lived signed
// URLs — `url` opens inline (Preview), `downloadUrl` saves.
type OfferDoc = { key: string; name: string; note?: string; url?: string; downloadUrl?: string }
const docApi = (requestId: string, key?: string) =>
  `/api/recruitment/offer-approval/documents?request_id=${encodeURIComponent(requestId)}${key ? `&doc=${key}` : ''}`

/** The generated PDF as a blob + the file name the server gave it. */
async function fetchDocBlob(requestId: string, d: OfferDoc): Promise<{ blob: Blob; name: string }> {
  const r = await fetch(docApi(requestId, d.key), { headers: await authHeaders() })
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Could not load the document') }
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || `${d.name}.pdf`
  return { blob: new Blob([await r.blob()], { type: 'application/pdf' }), name }
}

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = href; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 4000)
}

// What the browser can show in a frame. Word / Excel uploads can only be downloaded.
const fileKind = (name: string) => {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return ext === 'pdf' ? 'pdf' : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext) ? 'image' : ['txt', 'csv'].includes(ext) ? 'text' : 'other'
}

/** Full-screen viewer over the review screen. Escape closes the viewer, not the review. */
function DocPreview({ requestId, doc, onClose, onDownload, load, hint }: {
  requestId: string; doc: OfferDoc; onClose: () => void; onDownload: () => void
  /** where the PDF comes from when the doc has no URL — default: the approval-pack API */
  load?: () => Promise<{ blob: Blob; name: string }>; hint?: string
}) {
  const [src, setSrc] = useState<string | null>(doc.url || null)
  const [err, setErr] = useState('')
  const kind = doc.url ? fileKind(doc.name) : 'pdf'
  useEffect(() => {
    if (doc.url) return
    let live = true, href = ''
    ;(load ? load() : fetchDocBlob(requestId, doc))
      .then(({ blob }) => { href = URL.createObjectURL(blob); if (live) setSrc(href) })
      .catch((e: any) => { if (live) setErr(e.message) })
    return () => { live = false; if (href) URL.revokeObjectURL(href) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the document, not the (inline) loader
  }, [requestId, doc.key, doc.url])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const note = hint || (doc.key === 'ctc' ? 'Password-protected: the password is the candidate’s registered mobile number.' : '')
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Preview: ${doc.name}`}
      style={{ position:'fixed', inset:0, zIndex:Z.modal, background:TK.canvas, display:'flex', flexDirection:'column', animation:'rxFade .2s both' }}>
      <div style={{ padding:'12px 20px', borderBottom:`1px solid ${TK.line}`, background:TK.surface, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <button type="button" className="rx-btn sm g" onClick={onClose}>← Back</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:800, color:TK.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{doc.name}</div>
          {note && <div style={{ fontSize:11.5, color:TK.warning }}>{note}</div>}
        </div>
        <button type="button" className="rx-btn sm" onClick={onDownload}>↓ Download</button>
      </div>
      <div style={{ flex:1, minHeight:0, display:'flex', alignItems:'center', justifyContent:'center', padding: kind === 'image' ? 20 : 0 }}>
        {err ? <div style={{ fontSize:13, color:TK.critical, background:TK.criticalTint, borderRadius:R.md, padding:'12px 16px' }}>{err}</div>
          : !src ? <div className="rx-meta">Preparing the preview…</div>
          : kind === 'image' ? <img src={src} alt={doc.name} style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', borderRadius:R.md, boxShadow:E.raised }} />
          : kind === 'other' ? (
            <div style={{ textAlign:'center', display:'flex', flexDirection:'column', gap:10, alignItems:'center' }}>
              <div style={{ fontSize:14, fontWeight:700, color:TK.ink }}>This file type can&rsquo;t be shown in the browser.</div>
              <div className="rx-meta">Download it to open it on your computer.</div>
              <button type="button" className="rx-btn p" onClick={onDownload}>↓ Download</button>
            </div>)
          : <iframe src={src} title={doc.name} style={{ width:'100%', height:'100%', border:'none', background:TK.surface }} />}
      </div>
    </div>,
    document.body,
  )
}

function OfferDocuments({ requestId }: { requestId: string }) {
  const [docs, setDocs] = useState<OfferDoc[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<OfferDoc | null>(null)
  useEffect(() => {
    let live = true
    setDocs(null); setErr(''); setPreview(null)
    ;(async () => {
      try {
        const r = await fetch(docApi(requestId), { headers: await authHeaders() })
        const j = await r.json().catch(() => ({}))
        if (!live) return
        if (!r.ok) { setErr(j.error || 'Could not load the documents'); setDocs([]) } else setDocs(j.docs || [])
      } catch { if (live) { setErr('Could not load the documents'); setDocs([]) } }
    })()
    return () => { live = false }
  }, [requestId])

  async function download(d: OfferDoc) {
    if (d.url) { window.open(d.downloadUrl || d.url, '_blank', 'noopener'); return }
    setBusy(d.key); setErr('')
    try { const { blob, name } = await fetchDocBlob(requestId, d); saveBlob(blob, name) }
    catch (e: any) { setErr(`${d.name}: ${e.message}`) }
    setBusy(null)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {docs === null && [0, 1, 2].map(i => <div key={i} className="rx-tile" style={{ height:58, opacity:.5 }} />)}
      {docs?.map(d => (
        <div key={d.key} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:R.md, border:`1px solid ${TK.line}`, background:TK.surface, flexWrap:'wrap' }}>
          <div style={{ width:34, height:38, borderRadius:7, background:TK.criticalTint, color:TK.critical, display:'grid', placeItems:'center', fontSize:9.5, fontWeight:800, flexShrink:0 }}>{d.url ? 'FILE' : 'PDF'}</div>
          <div style={{ flex:'1 1 140px', minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:TK.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.name}</div>
            {d.note && <div style={{ fontSize:11, color:TK.muted, marginTop:1 }}>{d.note}</div>}
          </div>
          <div style={{ display:'flex', gap:6, flexShrink:0 }}>
            <button type="button" className="rx-btn sm g" onClick={() => setPreview(d)}>👁 Preview</button>
            <button type="button" className="rx-btn sm" disabled={busy === d.key} onClick={() => download(d)} style={{ opacity: busy === d.key ? .6 : 1 }}>{busy === d.key ? 'Preparing…' : '↓ Download'}</button>
          </div>
        </div>
      ))}
      {docs?.length === 0 && !err && <div className="rx-hint">No documents for this offer.</div>}
      {err && <div style={{ fontSize:12, color:TK.critical, background:TK.criticalTint, borderRadius:R.sm, padding:'8px 10px' }}>{err}</div>}
      {preview && <DocPreview requestId={requestId} doc={preview} onClose={() => setPreview(null)} onDownload={() => download(preview)} />}
    </div>
  )
}

// ── HR Head: edit an offer (revision) ──
// The compensation is recomputed on the server with the same CTC model and inputs the recruiter's
// calculation used (app/api/recruitment/offer-revise), so only the headline figures are asked for.
type OfferEditVals = { offered_ctc: string; variable_pct: string; joining_bonus: string; joining_bonus_freq: string; retention_bonus: string; esop_value: string; esop_vesting: string; proposed_doj: string }
const offerEditVals = (r: any): OfferEditVals => ({
  offered_ctc: r?.offered_ctc != null ? String(Math.round(Number(r.offered_ctc))) : '',
  variable_pct: String(r?.offered_variable_pct ?? r?.ctc_negotiations?.variable_pct ?? 0),
  joining_bonus: String(Number(r?.joining_bonus) || 0), joining_bonus_freq: r?.joining_bonus_freq || '',
  retention_bonus: String(Number(r?.retention_bonus) || 0),
  esop_value: String(Number(r?.esop_value) || 0), esop_vesting: r?.esop_vesting || '',
  proposed_doj: r?.proposed_doj ? String(r.proposed_doj).slice(0, 10) : '',
})
function OfferEditForm({ vals, onChange, err }: { vals: OfferEditVals; onChange: (v: OfferEditVals) => void; err: string }) {
  const field = (k: keyof OfferEditVals, label: string, type = 'number', hint?: string) => (
    <div style={{ minWidth:0 }}>
      <label className="rx-label" style={{ display:'block', marginBottom:5 }}>{label}</label>
      <input className="rx-input" type={type} value={vals[k]} onChange={e => onChange({ ...vals, [k]: e.target.value })} style={{ width:'100%' }} />
      {hint && <div style={{ fontSize:11, color:TK.faint, marginTop:3 }}>{hint}</div>}
    </div>
  )
  const ctc = Number(vals.offered_ctc) || 0, vp = Number(vals.variable_pct) || 0
  return (
    <section style={{ border:`2px solid ${TK.brand}`, borderRadius:R.lg, padding:'16px 18px', marginBottom:16, background:TK.surface }}>
      <div style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.08em', color:TK.brandDeep, marginBottom:12 }}>Edit offer</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'12px 14px' }}>
        {field('offered_ctc', 'Annual CTC (₹) *', 'number', ctc > 0 ? `₹${fmt(ctc)} · fixed ₹${fmt(ctc - ctc * vp / 100)}` : undefined)}
        {field('variable_pct', 'Variable (% of CTC)')}
        {field('proposed_doj', 'Date of joining *', 'date')}
        {field('joining_bonus', 'Joining bonus (₹)')}
        {field('joining_bonus_freq', 'Joining bonus paid', 'text', 'e.g. One-time, with first salary')}
        {field('retention_bonus', 'Retention bonus (₹)')}
        {field('esop_value', 'ESOP value (₹)')}
        {field('esop_vesting', 'ESOP vesting', 'text')}
      </div>
      <div style={{ fontSize:12, color:TK.muted, marginTop:12, lineHeight:1.5 }}>The salary break-up (Basic, HRA, PF, in-hand) is recalculated from the new CTC with the same rules as the original calculation. Saving approves the revised offer and sends it back to Send Offers.</div>
      {err && <div style={{ fontSize:12.5, color:TK.critical, background:TK.criticalTint, borderRadius:R.md, padding:'9px 12px', marginTop:10 }}>{err}</div>}
    </section>
  )
}

// ── HR Head review screen — full screen over the dashboard; one offer, one decision ──
function OfferReviewDrawer({ req, mrf, locations, processing, decided, onClose, onDecide, onRevised }: {
  req: any; mrf: any; locations: any[]; processing: boolean; decided: { action: 'approve'|'reject'; notified: number } | null
  onClose: () => void; onDecide: (action: 'approve'|'reject', note: string) => Promise<boolean>
  /** the HR Head edited the offer and approved it (app/api/recruitment/offer-revise) */
  onRevised: (notified: number) => void
}) {
  const [mode, setMode] = useState<'view'|'reject'|'approve'|'edit'>('view')
  const [note, setNote] = useState('')
  const [showTpl, setShowTpl] = useState(false)
  const [edit, setEdit] = useState<OfferEditVals>(() => offerEditVals(req))
  const [saving, setSaving] = useState(false)
  const [editErr, setEditErr] = useState('')
  useEffect(() => { setMode('view'); setNote(''); setShowTpl(false); setEdit(offerEditVals(req)); setEditErr('') }, [req?.id])
  async function saveRevision() {
    setSaving(true); setEditErr('')
    try {
      const r = await fetch('/api/recruitment/offer-revise', { method:'POST', headers: { ...(await authHeaders()), 'Content-Type':'application/json' }, body: JSON.stringify({ request_id: req.id, ...edit, comment: note }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setEditErr(j.error || 'Could not save the revised offer'); setSaving(false); return }
      setSaving(false); onRevised(Number(j.notified || 0))
    } catch { setEditErr('Network error. Nothing was saved'); setSaving(false) }
  }
  const busyAny = processing || saving
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !processing) onClose() }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [onClose, processing])
  useEffect(() => { if (decided) { const t = setTimeout(onClose, 1600); return () => clearTimeout(t) } }, [decided, onClose])
  if (typeof document === 'undefined') return null
  const c = req.candidates || {}
  const rs = (n: any) => `₹${fmt(Number(n || 0))}`
  const day = (v: any) => v ? new Date(v).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '-'
  const ctc = Number(req.offered_ctc || 0), vp = Number(req.offered_variable_pct || 0), vAmt = ctc > 0 && vp > 0 ? Math.round(ctc * vp / 100) : 0
  const hike = req.hike_pct != null ? Number(req.hike_pct) : null
  const pending = req.status === 'SUBMITTED'
  const mrfNumber: string | null = mrf?.mrf_number || null
  // The state the job is in: the one the salary was calculated for (its minimum wage, PF and PT
  // rules), else the MRF location's — same order as the HR Manager's offer file.
  const state: string | null = req.revised_calculation?.state || req.ctc_negotiations?.calculation_data?.state || (locations || []).find((l: any) => l.id === mrf?.location_id)?.state || null
  // The offer's ceiling is the MRF budget normalised to a year (budget_max is quoted in the
  // engagement's own period; offered_ctc is always annual) — lib/recruitment/compensation.ts.
  const ceiling = annualCeiling(mrf?.budget_max, mrf?.employment_type)
  const overBudget = overCeiling(req.offered_ctc, mrf?.budget_max, mrf?.employment_type)
  const monthlyBudget = compOf(mrf?.employment_type).period === 'MONTHLY'
  const Row = ({ k, v, strong }: { k: string; v: any; strong?: boolean }) => (v == null || v === '' || v === false) ? null : (
    <div style={{ display:'flex', gap:12, padding:'7px 0', borderBottom:`1px solid ${TK.line}`, fontSize:13 }}>
      <span style={{ flex:'0 0 170px', color:TK.muted }}>{k}</span><span style={{ flex:1, color:TK.ink, fontWeight: strong ? 700 : 500, ...numeric }}>{String(v)}</span>
    </div>
  )
  const Sec = ({ t, tag }: { t: string; tag?: React.ReactNode }) => <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.08em', color:TK.brandDeep, margin:'18px 0 6px' }}>{t}{tag}</div>
  return createPortal(
    <div role="dialog" aria-modal="true"
      style={{ position:'fixed', inset:0, zIndex:Z.modal, background:TK.canvas, color:TK.ink, display:'flex', flexDirection:'column', animation:'rxFade .25s both' }}>
        {/* header */}
        <div style={{ background:TK.surface, borderBottom:`1px solid ${TK.line}` }}>
        <div style={{ maxWidth:1280, margin:'0 auto', padding:'14px 24px', display:'flex', alignItems:'center', gap:12 }}>
          <button type="button" className="rx-btn sm g" onClick={() => !processing && onClose()} aria-label="Back to HR Head approvals">← Back</button>
          <div style={{ width:46, height:46, borderRadius:14, background:`linear-gradient(135deg,${TK.brand},${TK.brandDeep})`, color:TK.onAccent, display:'grid', placeItems:'center', fontWeight:800, fontSize:15, flexShrink:0 }}>{(c.full_name || '?').split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase()}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <span style={{ fontSize:17, fontWeight:800, letterSpacing:'-.01em' }}>{c.full_name}</span>
              {mrfNumber && <span className="rx-chip">{mrfNumber}</span>}
              <span style={{ fontSize:10.5, fontWeight:700, padding:'3px 9px', borderRadius:99, background: pending ? TK.warningTint : TK.positiveTint, color: pending ? TK.warning : TK.positive }}>{pending ? 'Awaiting your decision' : 'Approved'}</span>
            </div>
            <div className="rx-meta" style={{ marginTop:2 }}>{[c.designation, c.experience_years != null ? `${c.experience_years} yrs` : null, c.current_company, c.email].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        </div>

        {/* body */}
        <div style={{ flex:1, overflowY:'auto' }}>
        <div style={{ maxWidth:1280, margin:'0 auto', padding:'22px 24px 32px', height: decided ? '100%' : undefined, boxSizing:'border-box' }}>
          {decided ? (
            <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', gap:10, padding:'40px 0', animation:'rxRise .4s both' }}>
              <div style={{ width:84, height:84, borderRadius:99, display:'grid', placeItems:'center', background: decided.action==='approve' ? TK.positiveTint : TK.criticalTint, color: decided.action==='approve' ? TK.positive : TK.critical, fontSize:40, fontWeight:900, animation:'rxPop .5s cubic-bezier(.2,.8,.2,1) both' }}>{decided.action==='approve' ? '✓' : '✕'}</div>
              <div style={{ fontSize:20, fontWeight:800 }}>{decided.action==='approve' ? 'Offer approved' : 'Offer rejected'}</div>
              <div className="rx-meta" style={{ maxWidth:360 }}>{decided.action==='approve' ? `${c.full_name}'s offer moves to Send Offers. ${decided.notified ? `${decided.notified} people notified (recruiter + HR manager).` : ''}` : `The recruiter${decided.notified > 1 ? ' and the MRF raiser' : ''} ${decided.notified ? 'have been told why.' : 'will see the reason on the request.'}`}</div>
            </div>
          ) : (<div style={{ display:'flex', gap:24, flexWrap:'wrap', alignItems:'flex-start' }}>
           <div style={{ flex:'1 1 480px', minWidth:0 }}>
            {req.revision_note && pending && (
              <div style={{ marginBottom:12 }}>
                <Callout tone="warn">
                  <b>Revision requested</b>{req.revision_requested_by ? ` by ${req.revision_requested_by}` : ''}{req.revision_requested_at ? ` on ${day(req.revision_requested_at)}` : ''}: “{req.revision_note}”. Edit the offer below and approve it. It goes back to Send Offers.
                </Callout>
              </div>
            )}
            {mode === 'edit' && <OfferEditForm vals={edit} onChange={setEdit} err={editErr} />}
            {overBudget && (
              <div style={{ marginBottom:12 }}>
                <Callout tone="warn">
                  This offer is above the requisition&rsquo;s budget: {rs(ctc)} against a ceiling of {rs(ceiling)}.
                  {monthlyBudget && ` The requisition is budgeted monthly (${rs(mrf?.budget_max)}/mo), shown here as a year.`}
                </Callout>
              </div>
            )}
            {/* hero numbers */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10 }}>
              {[['Offered CTC', rs(ctc), 'per annum', TK.ink], ['Hike', hike != null && isFinite(hike) ? `${hike > 0 ? '+' : ''}${hike.toFixed(1)}%` : '-', Number(req.prev_total_ctc) > 0 ? `over ${rs(req.prev_total_ctc)}` : 'previous CTC unknown', hike != null ? (hike < 0 ? TK.critical : TK.positive) : TK.ink], ['Monthly in-hand', req.monthly_inhand ? rs(req.monthly_inhand) : '-', 'estimated · before TDS', TK.ink]].map(([k, v, sub, col], i) => (
                <div key={String(k)} className="rx-tile" style={{ animation:`rxRise .45s ${.05 * i}s cubic-bezier(.2,.8,.2,1) both` }}>
                  <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:TK.muted }}>{k}</div>
                  <div style={{ fontSize:20, fontWeight:800, letterSpacing:'-.02em', color: col as string, marginTop:3, ...numeric }}>{v}</div>
                  <div style={{ fontSize:11, color:TK.faint, marginTop:2 }}>{sub}</div>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:12 }}>
              {state && <span className="rx-chip">State · {state}</span>}
              {req.proposed_doj && <span className="rx-chip">DOJ {day(req.proposed_doj)}{req.days_to_join != null ? ` · ${req.days_to_join} days` : ''}</span>}
              {Number(req.notice_period_days) > 0 && <span className="rx-chip">Notice {req.notice_period_days} days</span>}
              {req.notice_buyout && <span className="rx-chip" style={{ background:TK.warningTint, color:TK.warning }}>Buyout{Number(req.notice_buyout_amount) > 0 ? ` ${rs(req.notice_buyout_amount)}` : ''}</span>}
              {vAmt > 0 && <span className="rx-chip">Variable {vp}%</span>}
            </div>

            <Sec t="Offered package" />
            <Row k="State" v={state ? `${state}${req.revised_calculation?.state || req.ctc_negotiations?.calculation_data?.state ? ' (salary calculated for this state)' : ''}` : null} />
            <Row k="Fixed CTC" v={vAmt > 0 ? `${rs(ctc - vAmt)} p.a.` : `${rs(ctc)} p.a. (all fixed)`} strong />
            <Row k="Variable" v={vAmt > 0 ? `${rs(vAmt)} p.a. · ${vp}% of CTC` : null} />
            <Row k="Joining bonus" v={Number(req.joining_bonus) > 0 ? `${rs(req.joining_bonus)}${req.joining_bonus_freq ? ` (${req.joining_bonus_freq})` : ''}` : null} />
            <Row k="Retention bonus" v={Number(req.retention_bonus) > 0 ? rs(req.retention_bonus) : null} />
            <Row k="ESOP" v={Number(req.esop_value) > 0 ? `${rs(req.esop_value)}${req.esop_vesting ? ` (${req.esop_vesting})` : ''}` : null} />

            <Sec t="Previous employer" tag={<span style={{ fontSize:10, fontWeight:600, textTransform:'none', letterSpacing:0, color:TK.warning, background:TK.warningTint, padding:'2px 8px', borderRadius:99 }}>confidential</span>} />
            <Row k="Company" v={req.prev_company_name || c.current_company} />
            <Row k="Address" v={req.prev_company_address} />
            <Row k="Total CTC" v={Number(req.prev_total_ctc) > 0 ? `${rs(req.prev_total_ctc)} p.a.` : null} strong />
            <Row k="Fixed / variable" v={(Number(req.prev_fixed_ctc) > 0 || Number(req.prev_variable) > 0) ? `${Number(req.prev_fixed_ctc) > 0 ? rs(req.prev_fixed_ctc) : '-'} / ${Number(req.prev_variable) > 0 ? rs(req.prev_variable) : '-'}` : null} />
            <Row k="TA / DA (monthly)" v={Number(req.prev_ta_da) > 0 ? rs(req.prev_ta_da) : null} />
            <Row k="Additional" v={req.prev_additional} />

            {(req.hiring_manager_remark || req.recruiter_comments) && (<>
              <Sec t="Remarks" />
              <Row k="Hiring manager" v={req.hiring_manager_remark} />
              <Row k="Recruiter" v={req.recruiter_comments} />
            </>)}

            {!pending && (<>
              <Sec t="Your decision" />
              <Row k="Outcome" v={req.hr_head_action === 'REJECTED' ? 'Rejected' : 'Approved'} strong />
              <Row k="On" v={req.hr_head_actioned_at ? new Date(req.hr_head_actioned_at).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : null} />
              <Row k="Comment" v={req.hr_head_comments} />
            </>)}

            {ceiling > 0 && !overBudget && <div className="rx-hint" style={{ marginTop:10 }}>Within the requisition&rsquo;s budget ceiling of {rs(ceiling)} a year.</div>}

            {/* the history of what the HR Head is signing off — recruitment_audit_logs */}
            {req.candidate_id && <div style={{ marginTop:16 }}><AuditTrailViewer candidateId={req.candidate_id} /></div>}

            {req.template_content && (
              <div style={{ marginTop:16 }}>
                <button type="button" className="rx-btn sm" onClick={() => setShowTpl(v => !v)}>{showTpl ? 'Hide' : 'Show'} the recruiter's request text</button>
                {showTpl && <div className="rx-paper" style={{ marginTop:10, padding:'22px 26px', animation:'rxRise .35s both' }}><pre style={{ margin:0, whiteSpace:'pre-wrap', fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize:11.5, lineHeight:1.6 }}>{req.template_content}</pre></div>}
              </div>
            )}
           </div>

           {/* documents — the same pack the HR Head was mailed, downloadable here */}
           <div style={{ flex:'1 1 300px', maxWidth:'100%', minWidth:0, background:TK.sunken, border:`1px solid ${TK.line}`, borderRadius:R.lg, padding:14 }}>
            <div style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.08em', color:TK.brandDeep, marginBottom:10 }}>Documents</div>
            <OfferDocuments requestId={req.id} />
           </div>
          </div>)}
        </div>
        </div>

        {/* footer — the decision */}
        {pending && !decided && (
          <div style={{ borderTop:`1px solid ${TK.line}`, background:TK.surface }}>
          <div style={{ maxWidth:1280, margin:'0 auto', padding:'14px 24px', display:'flex', flexDirection:'column', gap:10 }}>
            {mode === 'reject' && (
              <div style={{ padding:14, borderRadius:14, border:`1px solid ${TK.criticalEdge}`, background:TK.criticalTint, display:'flex', flexDirection:'column', gap:8, animation:'rxRise .3s both' }}>
                <div style={{ fontSize:12.5, fontWeight:700, color:TK.critical }}>Why are you rejecting this offer? The recruiter and the MRF raiser will read this.</div>
                <textarea autoFocus className="rx-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. CTC is above the approved band for this grade. Revise and resubmit." style={{ height:'auto', minHeight:72, resize:'vertical', padding:'10px 13px' }} />
              </div>
            )}
            {mode === 'approve' && (
              <div style={{ padding:14, borderRadius:14, border:`1px solid ${TK.positiveEdge}`, background:TK.positiveTint, display:'flex', flexDirection:'column', gap:8, animation:'rxRise .3s both' }}>
                <div style={{ fontSize:12.5, fontWeight:700, color:TK.positive }}>Approve {rs(ctc)} for {c.full_name}? A note for the HR manager is optional.</div>
                <textarea autoFocus className="rx-input" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional comment (goes with the approval notification)." style={{ height:'auto', minHeight:56, resize:'vertical', padding:'10px 13px' }} />
              </div>
            )}
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {mode === 'view' ? (<>
                <button type="button" className="rx-btn d" onClick={() => setMode('reject')} disabled={busyAny}>Reject</button>
                <span style={{ flex:1 }} />
                <button type="button" className="rx-btn" onClick={() => { setEdit(offerEditVals(req)); setEditErr(''); setNote(''); setMode('edit') }} disabled={busyAny}>✎ Edit offer</button>
                <button type="button" className="rx-btn p" onClick={() => setMode('approve')} disabled={busyAny}>Approve offer →</button>
              </>) : mode === 'edit' ? (<>
                <button type="button" className="rx-btn g" onClick={() => { setMode('view'); setEditErr('') }} disabled={saving}>← Cancel</button>
                <input className="rx-input" value={note} onChange={e => setNote(e.target.value)} placeholder="Comment for the HR Manager (optional)" style={{ flex:1, minWidth:160 }} />
                <button type="button" className="rx-btn p" disabled={saving} onClick={saveRevision}>{saving ? 'Saving…' : 'Save & approve revised offer'}</button>
              </>) : (<>
                <button type="button" className="rx-btn g" onClick={() => setMode('view')} disabled={processing}>← Back</button>
                <span style={{ flex:1 }} />
                <button type="button" className={`rx-btn ${mode === 'reject' ? 'd' : 'p'}`} disabled={processing || (mode === 'reject' && !note.trim())} onClick={() => onDecide(mode as 'approve'|'reject', note)} style={{ opacity: processing || (mode === 'reject' && !note.trim()) ? .55 : 1 }}>
                  {processing ? (mode === 'reject' ? 'Rejecting…' : 'Approving…') : mode === 'reject' ? 'Confirm rejection' : 'Confirm approval'}
                </button>
              </>)}
            </div>
          </div>
          </div>
        )}
    </div>,
    document.body,
  )
}

// ── Send Offers: the HR Manager's offer file ─────────────────────────────────────
// Full screen, read like a filled form in four parts — Candidate, Background, Offer,
// Interviews & documents — stepped with Back / Next, then a last part with ONE checkbox that
// confirms the whole file. Candidate and joining details can be edited part by part (which
// withdraws the confirmation); the approved compensation is locked. Once confirmed,
// "Generate offer letter" builds the multi-page letter on the company letterhead; Send unlocks
// after that (and after the HR Head has approved). The server enforces the same order:
// app/api/recruitment/offer-file and send-offer-email.
type FileRow = { key: string; section: string; label: string; value: string | null; raw: any; type: string; editable: boolean }
type OfferFileData = {
  request: { id: string; status: string }
  candidate: { id: string; full_name: string; email: string | null }
  company: { company_name: string } | null
  rows: FileRow[]
  documents: { key: string; id: string; name: string; label: string; size: number | null; uploaded_at: string | null; url: string | null; downloadUrl: string | null }[]
  interviews: { key: string; round: string; interviewer: string | null; decision: string | null; score: string | null; on: string | null; remark: string | null }[]
  salary: { rows: { kind: string; label: string; basis?: string; monthly?: number | null; annual?: number | null }[]; extras: [string, number | string][]; totalLabel?: string } | null
  /** which letter this engagement gets, and its fixed term */
  letter?: LetterSpec & { months: number | null }
  /** things to look at before confirming — advisory */
  warnings?: string[]
  verification: { verified: { by: string; at: string } | null; letter: { by: string; at: string } | null }
  required: number; complete: boolean; fileHash: string
}
const fileApi = (id: string, extra = '') => `/api/recruitment/offer-file?request_id=${encodeURIComponent(id)}${extra}`
const whenShort = (v?: string | null) => v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
const OFFER_STEPS: { title: string; sub: string; sections?: string[]; salary?: boolean; extra?: 'review' }[] = [
  { title: 'Candidate', sub: 'Personal & contact details', sections: ['Personal', 'Contact'] },
  { title: 'Background', sub: 'Education, experience & previous employer', sections: ['Education & experience', 'Previous employer (as approved)', 'Source'] },
  { title: 'Offer', sub: 'Position, joining & approved compensation', sections: ['Position & joining', 'Offered compensation (approved, locked)'], salary: true },
  { title: 'Interviews & documents', sub: 'Interview outcomes and the pre-negotiation documents', extra: 'review' },
]
const draftOf = (r: FileRow) => r.raw == null ? '' : r.type === 'date' ? String(r.raw).slice(0, 10) : Array.isArray(r.raw) ? r.raw.join(', ') : String(r.raw)
const formHead: React.CSSProperties = { fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.08em', color:TK.brandDeep, margin:'4px 0 12px' }

/** One field of the form: label over a filled box, or an input while the part is being edited. */
function FormField({ row, editing, value, onChange }: { row: FileRow; editing: boolean; value: string; onChange: (v: string) => void }) {
  const wide = row.type === 'textarea'
  const live = editing && row.editable
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined, minWidth:0 }}>
      <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:TK.muted, marginBottom:5, display:'flex', gap:6, alignItems:'center' }}>
        {row.label}{!row.editable && <span title="Locked" style={{ fontSize:10 }}>🔒</span>}
      </div>
      {live ? (
        wide
          ? <textarea className="rx-input" value={value} onChange={e => onChange(e.target.value)} style={{ height:'auto', minHeight:70, padding:'9px 12px', resize:'vertical', width:'100%' }} />
          : <input className="rx-input" value={value} onChange={e => onChange(e.target.value)} style={{ width:'100%' }}
              type={row.type === 'number' ? 'number' : row.type === 'date' ? 'date' : row.type === 'email' ? 'email' : row.type === 'tel' ? 'tel' : 'text'} />
      ) : (
        <div style={{ minHeight:38, padding:'9px 12px', borderRadius:R.md, border:`1px solid ${TK.line}`, background: row.editable ? TK.surface : TK.sunken, fontSize:13.5, fontWeight:600, color: row.value ? TK.ink : TK.faint, whiteSpace:'pre-wrap', wordBreak:'break-word', boxSizing:'border-box' }}>
          {row.value || '-'}
        </div>
      )}
    </div>
  )
}

/** Advisory notes from the offer file (a stipend below the prescribed minimum, a missing period…). */
function WarnList({ items }: { items: string[] }) {
  return (
    <div style={{ fontSize:12.5, color:TK.warning, background:TK.warningTint, border:`1px solid ${TK.warningEdge}`, borderRadius:R.md, padding:'10px 14px', marginBottom:12, lineHeight:1.55 }}>
      <div style={{ fontWeight:800, fontSize:11, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>Check before you confirm</div>
      {items.map((w, i) => <div key={i} style={{ display:'flex', gap:8 }}><span>•</span><span>{w}</span></div>)}
    </div>
  )
}

/** The numbered steps across the top; visited steps can be reopened. */
function OfferStepper({ step, reached, onGo }: { step: number; reached: number; onGo: (i: number) => void }) {
  const all = [...OFFER_STEPS.map(s => s.title), 'Verify & send']
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
      {all.map((t, i) => {
        const on = i === step, open = i <= reached
        return (
          <button key={t} type="button" disabled={!open} onClick={() => onGo(i)}
            style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'6px 12px 6px 6px', borderRadius:99, border:`1px solid ${on ? TK.brand : TK.line}`, background: on ? TK.brandTint : TK.surface, color: on ? TK.brandDeep : open ? TK.ink : TK.faint, fontSize:12.5, fontWeight:700, fontFamily:'inherit', cursor: open ? 'pointer' : 'not-allowed' }}>
            <span style={{ width:22, height:22, borderRadius:99, display:'grid', placeItems:'center', fontSize:11, background: on ? TK.brand : i < reached ? TK.positiveTint : TK.sunken, color: on ? TK.onAccent : i < reached ? TK.positive : TK.muted }}>{i < reached && !on ? '✓' : i + 1}</span>
            {t}
          </button>
        )
      })}
    </div>
  )
}

function OfferFileScreen({ req, mrfNumber, headNames, mail, onClose, onSend, sending, onFactsChanged }: {
  req: any; mrfNumber: string | null; headNames: string
  /** an edit changed something the e-mail quotes (address, name, position, joining date) */
  onFactsChanged: (f: { email: string | null; name: string | null; designation: string | null; doj: string | null }) => void
  mail: { to: string; cc: string; subject: string; body: string; setTo: (v: string) => void; setCc: (v: string) => void; setSubject: (v: string) => void; setBody: (v: string) => void }
  onClose: () => void; onSend: () => void; sending: boolean
}) {
  const [file, setFile] = useState<OfferFileData | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<OfferDoc | null>(null)
  const [letterPreview, setLetterPreview] = useState(false)
  const [generating, setGenerating] = useState(false)
  const approved = req.status === 'HR_HEAD_APPROVED'
  const last = OFFER_STEPS.length   // index of the "Verify & send" part

  useEffect(() => {
    let live = true
    setFile(null); setErr(''); setStep(0); setReached(0); setEditing(false)
    ;(async () => {
      try {
        const r = await fetch(fileApi(req.id), { headers: await authHeaders() })
        const j = await r.json().catch(() => ({}))
        if (!live) return
        if (r.ok) { setFile(j); if (j.verification?.verified) setReached(last) }   // already confirmed: every part is open
        else setErr(j.error || 'Could not load the offer file')
      } catch { if (live) setErr('Could not load the offer file') }
    })()
    return () => { live = false }
  }, [req.id, last])

  async function post(body: any): Promise<OfferFileData | null> {
    if (busy || generating) return null
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/recruitment/offer-file', { method:'POST', headers: { ...(await authHeaders()), 'Content-Type':'application/json' }, body: JSON.stringify({ request_id: req.id, ...body }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Failed'); return null }
      setFile(j); return j
    } catch { setErr('Network error. Nothing was saved'); return null }
    finally { setBusy(false) }
  }

  const go = (i: number) => { if (editing) return; setStep(i); setReached(r => Math.max(r, i)); setErr('') }
  const stepRows = (i: number) => (file?.rows || []).filter(r => (OFFER_STEPS[i]?.sections || []).includes(r.section))
  function startEdit() {
    const d: Record<string, string> = {}
    for (const r of stepRows(step)) if (r.editable) d[r.key] = draftOf(r)
    setDraft(d); setEditing(true)
  }
  async function saveEdit() {
    const before = Object.fromEntries(stepRows(step).filter(r => r.editable).map(r => [r.key, draftOf(r)]))
    const changes = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== before[k]))
    if (!Object.keys(changes).length) { setEditing(false); return }
    const j = await post({ action:'edit', changes })
    if (!j) return
    setEditing(false)
    if (['email', 'full_name', 'designation', 'proposed_doj'].some(k => k in changes)) {
      const raw = (k: string) => (j.rows || []).find((r: any) => r.key === k)?.raw ?? null
      onFactsChanged({ email: raw('email'), name: raw('full_name'), designation: raw('designation'), doj: raw('proposed_doj') })
    }
  }

  async function letterBlob(mark: boolean) {
    const r = await fetch(fileApi(req.id, `&letter=1${mark ? '&mark=1' : ''}`), { headers: await authHeaders() })
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Could not build the offer letter') }
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'Offer-Letter.pdf'
    return { blob: new Blob([await r.blob()], { type:'application/pdf' }), name }
  }
  async function generate() {
    if (busy || generating) return
    setGenerating(true); setErr('')
    try {
      await letterBlob(true)   // builds it and records that it was generated
      const r = await fetch(fileApi(req.id), { headers: await authHeaders() }); if (r.ok) setFile(await r.json())
      setLetterPreview(true)
    } catch (e: any) { setErr(e.message) }
    setGenerating(false)
  }
  async function downloadLetter() {
    try { const { blob, name } = await letterBlob(false); saveBlob(blob, name) } catch (e: any) { setErr(e.message) }
  }

  if (typeof document === 'undefined') return null
  const verified = file?.verification.verified || null
  const letter = file?.verification.letter || null
  const canSend = approved && !!file?.complete && !!letter
  const locked = busy || generating
  const open = ['SUBMITTED', 'HR_HEAD_APPROVED'].includes(req.status)
  const cur = OFFER_STEPS[step]
  const editable = !!cur && stepRows(step).some(r => r.editable) && open
  const grid: React.CSSProperties = { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(230px, 1fr))', gap:'14px 16px' }
  const card: React.CSSProperties = { background:TK.surface, border:`1px solid ${TK.line}`, borderRadius:R.lg, padding:'18px 20px', marginBottom:14 }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Offer file: ${req.candidates?.full_name || ''}`}
      style={{ position:'fixed', inset:0, zIndex:Z.modal, background:TK.canvas, color:TK.ink, display:'flex', flexDirection:'column', animation:'rxFade .25s both' }}>
      {/* header */}
      <div style={{ background:TK.surface, borderBottom:`1px solid ${TK.line}` }}>
        <div style={{ maxWidth:1120, margin:'0 auto', padding:'12px 24px', display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <button type="button" className="rx-btn sm g" onClick={onClose}>← Back to list</button>
            <div style={{ flex:'1 1 260px', minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <span style={{ fontSize:17, fontWeight:800 }}>{req.candidates?.full_name}</span>
                {mrfNumber && <span className="rx-chip">{mrfNumber}</span>}
                <span style={{ fontSize:10.5, fontWeight:700, padding:'3px 9px', borderRadius:99, background: approved ? TK.positiveTint : TK.warningTint, color: approved ? TK.positive : TK.warning }}>{approved ? 'HR Head approved' : `Awaiting HR Head${headNames ? ` · ${headNames}` : ''}`}</span>
                {verified && <span style={{ fontSize:10.5, fontWeight:700, padding:'3px 9px', borderRadius:99, background:TK.positiveTint, color:TK.positive }}>✓ Verified</span>}
              </div>
              <div className="rx-meta" style={{ marginTop:2 }}>{[req.candidates?.designation || req.manpower_requisitions?.designation, req.companies?.company_name].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          {file && <OfferStepper step={step} reached={reached} onGo={go} />}
        </div>
      </div>

      {/* body */}
      <div style={{ flex:1, overflowY:'auto' }}>
        <div style={{ maxWidth:1120, margin:'0 auto', padding:'20px 24px 32px' }}>
          {err && <div style={{ fontSize:12.5, color:TK.critical, background:TK.criticalTint, border:`1px solid ${TK.criticalEdge}`, borderRadius:R.md, padding:'9px 12px', marginBottom:12 }}>{err}</div>}
          {!file && !err && [0, 1].map(i => <div key={i} className="rx-tile" style={{ height:160, marginBottom:14, opacity:.5 }} />)}

          {file && cur && (
            <>
              <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:18, fontWeight:800 }}>Part {step + 1} of {OFFER_STEPS.length} · {cur.title}</div>
                  <div className="rx-meta">{cur.sub}</div>
                </div>
                {editable && !editing && <button type="button" className="rx-btn sm" disabled={locked} onClick={startEdit}>✎ Edit details</button>}
                {editing && (
                  <div style={{ display:'flex', gap:8 }}>
                    <button type="button" className="rx-btn sm g" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
                    <button type="button" className="rx-btn sm p" disabled={busy} onClick={saveEdit}>{busy ? 'Saving…' : 'Save changes'}</button>
                  </div>
                )}
              </div>
              {!!file.warnings?.length && cur.salary && <WarnList items={file.warnings} />}
              {editing && verified && <div style={{ fontSize:12, color:TK.warning, background:TK.warningTint, borderRadius:R.md, padding:'8px 12px', marginBottom:12 }}>Saving a change withdraws the verification. You will confirm the file again in the last part.</div>}

              {(cur.sections || []).map(sec => {
                const rows = stepRows(step).filter(r => r.section === sec)
                if (!rows.length) return null
                return (
                  <section key={sec} style={card}>
                    <div style={formHead}>{sec}</div>
                    <div style={grid}>
                      {rows.map(r => <FormField key={r.key} row={r} editing={editing} value={draft[r.key] ?? ''} onChange={v => setDraft(d => ({ ...d, [r.key]: v }))} />)}
                    </div>
                  </section>
                )
              })}

              {cur.salary && file.salary && (
                <section style={card}>
                  <div style={formHead}>{file.letter ? `${file.letter.annexA} (approved, locked)` : 'Salary break-up (approved, locked)'}</div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
                      <thead><tr style={{ background:TK.sunken }}>{['Component', 'Basis', 'Monthly', file.salary.totalLabel || 'Annual'].map((h, i) => <th key={h} style={{ textAlign: i >= 2 ? 'right' : 'left', padding:'8px 12px', fontWeight:700, color:TK.muted, borderBottom:`1px solid ${TK.line}` }}>{h}</th>)}</tr></thead>
                      <tbody>{file.salary.rows.map((r, i) => {
                        const strong = ['sum', 'total', 'net', 'head'].includes(r.kind)
                        return (
                          <tr key={i} style={{ background: r.kind === 'head' ? TK.sunken : undefined }}>
                            <td style={{ padding:'7px 12px', fontWeight: strong ? 700 : 500, borderBottom:`1px solid ${TK.line}` }}>{r.label}</td>
                            <td style={{ padding:'7px 12px', color:TK.muted, borderBottom:`1px solid ${TK.line}` }}>{r.basis || ''}</td>
                            <td style={{ padding:'7px 12px', textAlign:'right', fontWeight: strong ? 700 : 500, borderBottom:`1px solid ${TK.line}`, ...numeric }}>{r.monthly != null ? `₹${fmt(r.monthly)}` : ''}</td>
                            <td style={{ padding:'7px 12px', textAlign:'right', fontWeight: strong ? 700 : 500, borderBottom:`1px solid ${TK.line}`, ...numeric }}>{r.annual != null ? `₹${fmt(r.annual)}` : ''}</td>
                          </tr>
                        )
                      })}</tbody>
                    </table>
                  </div>
                  {file.salary.extras.length > 0 && <div style={{ paddingTop:10, fontSize:12.5, color:TK.muted }}>{file.salary.extras.map(([k, v]) => `${k}: ${typeof v === 'number' ? `₹${fmt(v)}` : v}`).join(' · ')}</div>}
                </section>
              )}

              {cur.extra === 'review' && (<>
                <section style={card}>
                  <div style={formHead}>Interviews</div>
                  {file.interviews.length === 0 ? <div className="rx-hint">No interview feedback is recorded for this candidate.</div> : (
                    <div style={grid}>
                      {file.interviews.map(i => (
                        <div key={i.key} style={{ border:`1px solid ${TK.line}`, borderRadius:R.md, padding:'11px 13px', background:TK.surface }}>
                          <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:TK.muted }}>{i.round}</div>
                          <div style={{ fontSize:14, fontWeight:700, marginTop:3 }}>{i.decision || 'Feedback recorded'}{i.score ? <span style={{ fontWeight:600, color:TK.muted }}> · {i.score}</span> : null}</div>
                          {i.interviewer && <div style={{ fontSize:12, color:TK.muted, marginTop:2 }}>by {i.interviewer}{i.on ? ` · ${whenShort(i.on)}` : ''}</div>}
                          {i.remark && <div style={{ fontSize:12, marginTop:6 }}>“{i.remark}”</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <section style={card}>
                  <div style={formHead}>Documents · pre-negotiation check ({file.documents.length})</div>
                  {file.documents.length === 0 ? <div className="rx-hint">The candidate has not uploaded any documents.</div> : (
                    <div style={grid}>
                      {file.documents.map(d => (
                        <div key={d.key} style={{ border:`1px solid ${TK.line}`, borderRadius:R.md, padding:'11px 13px', background:TK.surface, display:'flex', flexDirection:'column', gap:8 }}>
                          <div style={{ display:'flex', gap:10, alignItems:'center', minWidth:0 }}>
                            <div style={{ width:32, height:36, borderRadius:7, background:TK.criticalTint, color:TK.critical, display:'grid', placeItems:'center', fontSize:9, fontWeight:800, flexShrink:0 }}>{(d.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()}</div>
                            <div style={{ minWidth:0 }}>
                              <div style={{ fontSize:13, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.label}</div>
                              <div style={{ fontSize:11, color:TK.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.name}</div>
                            </div>
                          </div>
                          <div style={{ display:'flex', gap:6 }}>
                            <button type="button" className="rx-btn sm g" style={{ flex:1 }} disabled={!d.url} onClick={() => setPreview({ key: d.key, name: d.name, url: d.url || undefined, downloadUrl: d.downloadUrl || undefined })}>👁 Preview</button>
                            <button type="button" className="rx-btn sm" style={{ flex:1 }} disabled={!d.downloadUrl} onClick={() => d.downloadUrl && window.open(d.downloadUrl, '_blank', 'noopener')}>↓ Download</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>)}
            </>
          )}

          {/* the last part: one checkbox, then generate, then send */}
          {file && step === last && (
            <>
              <div style={{ fontSize:18, fontWeight:800, marginBottom:4 }}>Verify & send</div>
              <div className="rx-meta" style={{ marginBottom:14 }}>Confirm the file, generate the {file.letter?.title || 'offer letter'}, then send it.</div>
              {!!file.warnings?.length && <WarnList items={file.warnings} />}
              <section style={{ ...card, border:`2px solid ${verified ? TK.positive : TK.brand}`, background: verified ? TK.positiveTint : TK.surface }}>
                <label style={{ display:'flex', gap:14, alignItems:'flex-start', cursor: locked || !open ? 'not-allowed' : 'pointer' }}>
                  <input type="checkbox" checked={!!verified} disabled={locked || !open}
                    onChange={e => post({ action:'verify', checked: e.target.checked, hash: file.fileHash })}
                    style={{ width:22, height:22, marginTop:2, accentColor:TK.positive, flexShrink:0, cursor:'inherit' }} />
                  <div>
                    <div style={{ fontSize:15, fontWeight:800 }}>I have verified all the details of {req.candidates?.full_name}</div>
                    <div style={{ fontSize:12.5, color:TK.muted, marginTop:4, lineHeight:1.55 }}>
                      Personal, contact, education, experience, previous employer, position, {file.letter?.months ? 'period, ' : ''}joining and the approved {file.letter?.payNoun || 'compensation'} in parts 1–3, the {file.letter ? file.letter.annexA.toLowerCase() : 'salary break-up'},
                      {` ${file.interviews.length} interview${file.interviews.length === 1 ? '' : 's'}`} and {file.documents.length} document{file.documents.length === 1 ? '' : 's'}, and they are correct.
                    </div>
                    {verified && <div style={{ fontSize:12, fontWeight:700, color:TK.positive, marginTop:8 }}>Verified by {verified.by} · {whenShort(verified.at)}</div>}
                  </div>
                </label>
              </section>

              <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'flex-start' }}>
                <section style={{ ...card, flex:'1 1 300px', marginBottom:0, opacity: verified ? 1 : .7 }}>
                  <div style={formHead}>{file.letter?.title || 'Offer letter'}</div>
                  {file.letter && file.letter.kind !== 'EMPLOYMENT' && (
                    <div style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:99, background:TK.infoTint, color:TK.info, marginBottom:8 }}>
                      {file.letter.label} · {file.letter.payNoun}{file.letter.months ? ` · ${file.letter.months} months` : ''}
                    </div>
                  )}
                  <div className="rx-meta" style={{ marginBottom:12, lineHeight:1.5 }}>
                    {!verified ? 'Tick the confirmation above to unlock this.'
                      : letter ? `Generated by ${letter.by} · ${whenShort(letter.at)}.` : `Generate the ${(file.letter?.title || 'offer letter').toLowerCase()} on the company letterhead: letter, ${(file.letter?.annexA || 'salary break-up').toLowerCase()} (Annexure A) and terms (Annexure B).`}
                  </div>
                  <button type="button" className="rx-btn p" disabled={!verified || locked} onClick={generate} style={{ width:'100%', opacity: verified ? 1 : .5, cursor: verified ? 'pointer' : 'not-allowed' }}>
                    {generating ? 'Generating…' : !verified ? '🔒 Generate letter' : letter ? '↻ Regenerate letter' : `Generate ${file.letter?.kind === 'EMPLOYMENT' || !file.letter ? 'offer letter' : file.letter.title.toLowerCase()}`}
                  </button>
                  {letter && (
                    <div style={{ display:'flex', gap:8, marginTop:8 }}>
                      <button type="button" className="rx-btn sm g" style={{ flex:1 }} onClick={() => setLetterPreview(true)}>👁 Preview</button>
                      <button type="button" className="rx-btn sm" style={{ flex:1 }} onClick={downloadLetter}>↓ Download</button>
                    </div>
                  )}
                </section>

                <section style={{ ...card, flex:'2 1 420px', marginBottom:0, border:`1px solid ${canSend ? TK.brand : TK.line}`, opacity: letter ? 1 : .7 }}>
                  <div style={formHead}>Send offer</div>
                  {[['To *', mail.to, mail.setTo, ''], ['CC (comma separated)', mail.cc, mail.setCc, 'hr@company.com, md@company.com'], ['Subject', mail.subject, mail.setSubject, '']].map(([l, v, set, ph]: any) => (
                    <div key={l} style={{ marginBottom:8 }}>
                      <label className="rx-label" style={{ display:'block', marginBottom:5 }}>{l}</label>
                      <input className="rx-input" value={v} placeholder={ph} onChange={e => set(e.target.value)} />
                    </div>
                  ))}
                  <label className="rx-label" style={{ display:'block', marginBottom:5 }}>Email body</label>
                  <textarea className="rx-input" value={mail.body} onChange={e => mail.setBody(e.target.value)} style={{ height:'auto', minHeight:200, resize:'vertical', padding:'10px 13px', marginBottom:10 }} />
                  <div style={{ fontSize:11.5, borderRadius:7, padding:'8px 12px', marginBottom:10, background: canSend ? TK.brandTint : TK.warningTint, color: canSend ? TK.brandDeep : TK.warning }}>
                    {!approved ? `Yet to be approved by the HR Head${headNames ? ` (${headNames})` : ''}. You can verify and generate meanwhile.`
                      : !verified ? 'Tick the confirmation above first.'
                      : !letter ? 'Generate the letter first. It is attached to this mail.'
                      : 'Emails the candidate with the offer letter PDF attached, records it, and moves the candidate to Offer Sent.'}
                  </div>
                  <button type="button" className="rx-btn p" onClick={onSend} disabled={sending || !canSend || locked} style={{ width:'100%', opacity: canSend ? 1 : .5, cursor: canSend ? 'pointer' : 'not-allowed' }}>
                    {sending ? 'Sending…' : canSend ? 'Send offer & mark as sent' : '🔒 Send offer'}
                  </button>
                </section>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Back / Next */}
      {file && (
        <div style={{ background:TK.surface, borderTop:`1px solid ${TK.line}` }}>
          <div style={{ maxWidth:1120, margin:'0 auto', padding:'12px 24px', display:'flex', alignItems:'center', gap:10 }}>
            <button type="button" className="rx-btn g" disabled={step === 0 || editing} onClick={() => go(step - 1)}>← Back</button>
            <span style={{ flex:1, textAlign:'center', fontSize:12, color:TK.muted }}>{editing ? 'Save or cancel your changes to move on' : `Step ${step + 1} of ${last + 1}`}</span>
            {step < last && <button type="button" className="rx-btn p" disabled={editing} onClick={() => go(step + 1)}>{step === last - 1 ? 'Next: Verify & send →' : 'Next →'}</button>}
          </div>
        </div>
      )}

      {preview && <DocPreview requestId={req.id} doc={preview} onClose={() => setPreview(null)} onDownload={() => preview.downloadUrl && window.open(preview.downloadUrl, '_blank', 'noopener')} />}
      {letterPreview && <DocPreview requestId={req.id} doc={{ key:'offer-letter', name:`${file?.letter?.title || 'Offer letter'}: ${req.candidates?.full_name || ''}` }} load={() => letterBlob(false)}
        hint={`On the ${file?.company?.company_name || 'company'} letterhead`} onClose={() => setLetterPreview(false)} onDownload={downloadLetter} />}
    </div>,
    document.body,
  )
}

// ═══════════════════════════════════════════════════════════════
// HR MANAGER: SEND OFFER LETTER
// ═══════════════════════════════════════════════════════════════
export function HRManagerSendOffer({ companies, departments, locations, mrfs:mrfLookup, allowedMrfIds = null, rail }: any = {}) {
  const supabase = createClient()
  const [f, setF] = useState(FILTER_EMPTY)
  const [approved, setApproved] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [toEmail, setToEmail] = useState('')
  const [ccEmails, setCcEmails] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sq, setSq] = useState('')
  const [hrHeads, setHrHeads] = useState<Record<string, { id: string; name: string; code: string | null }[]>>({})
  const [tick, setTick] = useState(0)

  // Requests appear here the moment the recruiter submits them to the HR Head — with the
  // Send Offer button locked — and unlock once approved. Poll so an approval made in HRIS
  // shows up without a reload.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15000)
    const onVis = () => { if (document.visibilityState === 'visible') setTick(t => t + 1) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  useEffect(() => {
    supabase.from('offer_approval_requests')
      .select('*, candidates(full_name, email, phone, designation, experience_years, current_company, mrf_id, application_details), companies(company_name, company_code), manpower_requisitions(designation, employment_type, duration_months, is_confidential), ctc_negotiations(basic_monthly, hra_monthly, net_monthly, variable_pct, is_stipend, stipend_monthly, tds_applicable, tds_pct)')
      .in('status',['SUBMITTED','HR_HEAD_APPROVED'])
      .order('submitted_at',{ ascending:false })
      // Until migration 135 adds is_confidential, PostgREST rejects the column — retry without it.
      .then(r => r.error && /is_confidential/i.test(r.error.message || '')
        ? supabase.from('offer_approval_requests')
            .select('*, candidates(full_name, email, phone, designation, experience_years, current_company, mrf_id, application_details), companies(company_name, company_code), manpower_requisitions(designation, employment_type, duration_months), ctc_negotiations(basic_monthly, hra_monthly, net_monthly, variable_pct, is_stipend, stipend_monthly, tds_applicable, tds_pct)')
            .in('status',['SUBMITTED','HR_HEAD_APPROVED']).order('submitted_at',{ ascending:false })
        : r)
      // A scoped hiring manager only sees offers for candidates under the MRFs assigned to
      // them; `allowedMrfIds` is null for oversight roles (no filter).
      .then(({ data }: any) => {
        const rows = (data || []).filter((r: any) => !allowedMrfIds || (r.candidates?.mrf_id && allowedMrfIds.has(r.candidates.mrf_id)))
        setApproved(rows)
        // keep the open one in sync — this is what flips the button from locked to live
        setSelected((sel: any) => sel ? (rows.find((r: any) => r.id === sel.id) || null) : sel)
        const ids = Array.from(new Set(rows.map((r: any) => r.company_id).filter(Boolean))) as string[]
        if (ids.length) authHeaders().then(h => fetch(`/api/recruitment/offer-approval?company_ids=${ids.join(',')}`, { headers: h })).then(r => r.json()).then(j => setHrHeads(j.heads || {})).catch(() => null)
      })
  }, [allowedMrfIds, tick])

  const isApproved = (r: any) => r?.status === 'HR_HEAD_APPROVED'
  const headNames = (r: any) => (hrHeads[r?.company_id] || []).map(h => `${h.name}${h.code ? ` (${h.code})` : ''}`).join(', ')
  // The engagement decides the letter: the offer file's own employment type if edited there,
  // else the MRF's. Same rule as lib/recruitment/offer-dossier.ts.
  const kindOf = (r: any) => letterKindOf(r?.candidates?.application_details?.requisition?.employment_type || r?.manpower_requisitions?.employment_type)
  const monthsOfRow = (r: any) => { const v = Number(r?.candidates?.application_details?.requisition?.duration_months ?? r?.manpower_requisitions?.duration_months); return v > 0 ? Math.round(v) : null }
  const payLine = (r: any) => {
    const n = r.ctc_negotiations
    if (n?.is_stipend && Number(n.stipend_monthly) > 0) return `₹${fmt(n.stipend_monthly)}/month ${isFeesKind(kindOf(r)) ? 'fees' : 'stipend'}`
    return `CTC ₹${r.offered_ctc ? fmt(r.offered_ctc) : '-'}${r.hike_pct ? ` · Hike ${Number(r.hike_pct).toFixed(1)}%` : ''}`
  }
  // The request's own mrf_id is empty on older rows; the candidate always carries it. Reading only
  // the request is why one card showed its MRF chip and the next did not — and why the department /
  // location filters silently dropped those rows.
  const mrfIdOf = (r: any) => r?.mrf_id || r?.candidates?.mrf_id || null
  const mrfNo = (r: any) => (mrfLookup||[]).find((m:any)=>m.id===mrfIdOf(r))?.mrf_number || null

  // The e-mail that carries the letter. Its words are the engagement's Configuration template
  // ("Offer email — Employment / Internship / NATS / NAPS / Contract / Consultant"), resolved for
  // the offer's branch and company and fetched once when the offer file opens; it is re-filled
  // whenever an edit in the offer file changes something it quotes, so the mail never disagrees
  // with the letter. HR can still adjust the text before sending.
  const [mailTpl, setMailTpl] = useState<{ forId: string; subject: string; body: string; source: string; version: number } | null>(null)
  const [mailTplError, setMailTplError] = useState('')
  const lastFacts = useRef<{ name?: string | null; designation?: string | null; doj?: string | null }>({})
  function mailText(r: any, f: { name?: string | null; designation?: string | null; doj?: string | null } = {}, tpl = mailTpl) {
    if (!tpl || tpl.forId !== r.id) return { subject: '', body: '' }
    const v = offerMailVars(r, f)
    return { subject: renderText(tpl.subject, v).text.replace(/\s*\n\s*/g, ' '), body: renderText(tpl.body, v).text }
  }

  async function prepareOffer(r: any) {
    setSelected(r)
    setToEmail(r.candidates?.email || '')
    setSubject(''); setBody(''); setMailTplError(''); lastFacts.current = {}
    try {
      const res = await fetch(`/api/recruitment/send-offer-email?request_id=${r.id}`, { cache: 'no-store', headers: await authHeaders() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setMailTplError(d.error || `HTTP ${res.status}`); return }
      const tpl = { forId: r.id, subject: d.subject || '', body: d.body || '', source: d.template?.source || 'DEFAULT', version: d.template?.version || 0 }
      setMailTpl(tpl)
      const m = mailText(r, lastFacts.current, tpl)
      setSubject(m.subject); setBody(m.body)
    } catch { setMailTplError('network error') }
  }

  function factsChanged(f: { email: string | null; name: string | null; designation: string | null; doj: string | null }) {
    if (!selected) return
    if (f.email) setToEmail(f.email)
    lastFacts.current = f
    const m = mailText(selected, f)
    if (m.body) { setSubject(m.subject); setBody(m.body) }
  }

  async function sendOffer() {
    if (!selected || !toEmail || !body) { alert('Recipient email and body are required'); return }
    // A placeholder the template's values did not fill would reach the candidate as "{{…}}".
    const unfilled = [...new Set([...`${subject}\n${body}`.matchAll(/\{\{\s*([#/]?[\w ]+?)\s*\}\}/g)].map(m => m[1]))]
    if (unfilled.length) { alert(`The email still has placeholders that have no value:\n• ${unfilled.map(u => `{{${u}}}`).join('\n• ')}\n\nType the real values into the email, or fix the template in Configuration → Offer email.`); return }
    // Never trust the button state alone — re-read the row so an offer the HR Head has not
    // approved (or has rejected since the screen loaded) cannot go out.
    const { data: live } = await supabase.from('offer_approval_requests').select('status').eq('id', selected.id).maybeSingle()
    if (live?.status !== 'HR_HEAD_APPROVED') { alert(live?.status === 'SUBMITTED' ? 'The HR Head has not approved this offer yet. The Send Offer button unlocks once they do.' : `This offer is ${String(live?.status || 'unavailable').replace(/_/g, ' ').toLowerCase()}. It cannot be sent.`); setTick(t => t + 1); return }

    // Validate the To + CC addresses, and warn if CC was left empty (easy to forget).
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRe.test(toEmail.trim())) { alert('Please enter a valid recipient (To) email address.'); return }
    const ccList = ccEmails.split(',').map((e: string) => e.trim()).filter(Boolean)
    const badCc = ccList.filter((e: string) => !emailRe.test(e))
    if (badCc.length) { alert('These CC email(s) look invalid:\n• ' + badCc.join('\n• ')); return }
    if (ccList.length === 0 && !confirm('No CC email added.\nSend the offer letter without any CC?')) return

    setSending(true)

    // 1. Actually email the offer letter to the candidate via Gmail.
    let sentPosition: { designation?: string | null; department?: string | null; location?: string | null } | null = null
    try {
      const offer = {
        candidate_name: selected.candidates?.full_name,
        designation: selected.candidates?.designation || selected.manpower_requisitions?.designation,
        company_name: selected.companies?.company_name,
        annual_ctc: selected.offered_ctc,
        variable_pct: selected.offered_variable_pct ?? selected.ctc_negotiations?.variable_pct,
        monthly_basic: selected.ctc_negotiations?.basic_monthly,
        monthly_hra: selected.ctc_negotiations?.hra_monthly,
        monthly_inhand: selected.monthly_inhand ?? selected.ctc_negotiations?.net_monthly,
        joining_bonus: selected.joining_bonus,
        retention_bonus: selected.retention_bonus,
        esop_value: selected.esop_value,
        proposed_doj: selected.proposed_doj,
      }
      const r = await fetch('/api/recruitment/send-offer-email', {
        method: 'POST',
        headers: await authHeaders(),
        // request_id: the server attaches the generated letter, and refuses unless the file is
        // fully verified and the letter was generated from it.
        body: JSON.stringify({ to: toEmail, cc: ccEmails, subject, body, offer, request_id: selected.id }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) {
        setSending(false)
        alert('Email NOT sent: ' + (d.error || `HTTP ${r.status}`) + '\nNothing was marked as sent.')
        return
      }
      sentPosition = d.position || null   // what the letter stated: kept on the offer_letters row
    } catch {
      setSending(false)
      alert('Email NOT sent: network error. Nothing was marked as sent.')
      return
    }

    // 2. Email is out — record the offer letter.
    const { error } = await supabase.from('offer_letters').insert({
      candidate_id: selected.candidate_id,
      candidate_name: selected.candidates?.full_name || toEmail,
      designation: sentPosition?.designation || selected.candidates?.designation || selected.manpower_requisitions?.designation || 'Not specified',
      department: sentPosition?.department || null,
      location: sentPosition?.location || null,
      company_id: selected.company_id || null,
      letter_content: body,
      to_email: toEmail,
      cc_emails: ccEmails.split(',').map((e: string) => e.trim()).filter(Boolean),
      status: 'SENT',
      sent_at: new Date().toISOString(),
    })

    // Update approval request
    await supabase.from('offer_approval_requests').update({
      status: 'OFFER_SENT',
      hr_manager_accepted_at: new Date().toISOString(),
      offer_sent_at: new Date().toISOString(),
    }).eq('id', selected.id)

    // Update candidate stage
    // offer_response cleared: a revised offer that goes out is waiting on the candidate again.
    await supabase.from('candidates').update({ stage: 'Offer Sent', offer_accepted: false, offer_response: null, offer_sent_at: new Date().toISOString(), offer_reminder_sent: false }).eq('id', selected.candidate_id)

    // Auto-close the MRF once its openings are filled by sent/joined offers.
    const { data: candRow } = await supabase.from('candidates').select('mrf_id').eq('id', selected.candidate_id).maybeSingle()
    const mrfId = candRow?.mrf_id
    if (mrfId) {
      const { data: m } = await supabase.from('manpower_requisitions').select('no_of_openings, openings, status').eq('id', mrfId).maybeSingle()
      if (m && m.status !== 'CLOSED') {
        const openings = Number(m.no_of_openings || m.openings || 1)
        const { count } = await supabase.from('candidates').select('id', { count: 'exact', head: true }).eq('mrf_id', mrfId).in('stage', ['Offer Sent', 'Joined'])
        if ((count || 0) >= openings) await supabase.from('manpower_requisitions').update({ status: 'CLOSED' }).eq('id', mrfId)
      }
    }

    // Audit log
    await supabase.from('recruitment_audit_logs').insert({
      candidate_id: selected.candidate_id,
      company_id: selected.company_id || null,
      action_type: 'OFFER_LETTER_SENT',
      details: { to: toEmail, cc: ccEmails },
      created_at: new Date().toISOString(),
    })

    setSending(false)
    if (error) { alert('Email sent, but saving the record failed: ' + error.message); return }
    alert(`Offer letter emailed to ${toEmail} and marked as Sent. Candidate moved to "Offer Sent".`)
    setSelected(null)
    setApproved(a => a.filter(r => r.id !== selected.id))
  }

  const sql = sq.trim().toLowerCase()
  const positionOpts = distinctSorted(approved.map((r:any)=>r.candidates?.designation || r.manpower_requisitions?.designation))
  const fApproved = approved.filter((r:any)=>(!sql || (r.candidates?.full_name||'').toLowerCase().includes(sql)) && recordMatchesFilters({ company_id:r.company_id, mrf_id:mrfIdOf(r), position:r.candidates?.designation || r.manpower_requisitions?.designation }, mrfLookup, f))
  return (
    <RxPage header={
      <RecruitmentHeader
        title="Send offer letters"
        subtitle="Every offer submitted to the HR Head. Open the offer file to verify it, generate the letter and send it."
        help={<Help label="How this works">
          <p>A candidate appears the moment the recruiter <b>submits the offer to the HR Head</b>.</p>
          <p>Open the <b>offer file</b>: four parts (candidate, background, offer, interviews &amp; documents) read like a filled form, with <b>Next</b> to move on. Candidate and joining details can be edited; the approved compensation is locked.</p>
          <p>The letter follows the engagement on the MRF: an <b>Employee</b> gets an Offer of Employment with a CTC break-up; an <b>Intern</b> an Internship Offer with a stipend and period; <b>NATS</b> / <b>NAPS</b> an Offer of Apprenticeship under the Apprentices Act, 1961 (stipend, Government share by DBT, no PF/ESIC); <b>Contract</b> / <b>Consultant</b> an engagement letter with fees and TDS under s.194J. Each on its own company's letterhead.</p>
          <p>In the last part, one checkbox confirms the whole file. <b>Generate letter</b> then builds the multi-page letter on the company letterhead, and <b>Send</b> unlocks once the HR Head has approved; it emails the letter, records it, and moves the candidate to <b>Offer Sent</b>.</p>
        </Help>}
      />}>
      <div className="rx-grid rx-stag">
        <div className="s12 rx-bar" style={{ gap:10 }}>
          <SearchBox value={sq} onChange={setSq} placeholder="Search candidate…" label="Search approved requests" />
          {/* Inline for the same reason as the other tabs: one shared filter bar
              per screen, and dropping the duplicate let this file's copy go. */}
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.company}
            onChange={e=>setF({ ...f, company:e.target.value, department:'', location:'' })}>
            <option value="">All companies</option>
            {(companies||[]).map((co:any)=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.department}
            onChange={e=>setF({ ...f, department:e.target.value })}>
            <option value="">All departments</option>
            {(departments||[]).filter((d:any)=>!f.company||d.company_id===f.company).map((d:any)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.location}
            onChange={e=>setF({ ...f, location:e.target.value })}>
            <option value="">All locations</option>
            {(locations||[]).filter((l:any)=>!f.company||l.company_id===f.company).map((l:any)=><option key={l.id} value={l.id}>{l.location_name}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.position}
            onChange={e=>setF({ ...f, position:e.target.value })}>
            <option value="">All positions</option>
            {positionOpts.map((p:string)=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {fApproved.length === 0 ? (
          <div className="s12"><EmptyState title={sql ? 'No matching candidate' : 'No offers submitted to the HR Head yet'}
            hint={sql ? 'Try another name, or clear the filters.' : 'A candidate appears here the moment the recruiter submits their offer from Offer Approval.'} /></div>
        ) : (
          /* One card grammar (CandCard): name + MRF, meta, tags, where the
             approval sits, and the action pinned to the bottom so the buttons
             of a row line up. The old card carried an "Approved" pill beside
             "HR Head approved … ready to send" — the same fact twice — and a
             d/m/yyyy date where the rest of the module says "28 Sep 2026". */
          <div className="s12 rx-ccg">
            {fApproved.map(r => {
              const ok = isApproved(r)
              const kind = kindOf(r)
              const months = monthsOfRow(r)
              const heads = headNames(r)
              const approver = r.hr_head_email || heads
              return (
                <CandCard key={r.id} name={r.candidates?.full_name || '-'} mrf={mrfNo(r)}
                  selected={selected?.id === r.id} onOpen={() => prepareOffer(r)} label={`Open the offer file for ${r.candidates?.full_name || 'this candidate'}`}
                  meta={metaLine(r.candidates?.designation || r.manpower_requisitions?.designation,
                    r.candidates?.experience_years != null ? `${r.candidates.experience_years} yr exp` : null,
                    payLine(r), months && kind !== 'EMPLOYMENT' ? `${months} months` : null)}
                  tags={(kind !== 'EMPLOYMENT' || r.manpower_requisitions?.is_confidential) ? <>
                    {kind !== 'EMPLOYMENT' && <span className="rx-cc-tag info" title={specOf(kind).title}>{specOf(kind).label}</span>}
                    {r.manpower_requisitions?.is_confidential && <span className="rx-cc-tag warn" title="Confidential hiring: self-approved by the HR Head">🔒 Confidential</span>}
                  </> : null}
                  body={<ApprovalTrail
                    summary={ok
                      ? <>Approved by <b>{approver || 'the HR Head'}</b>{r.hr_head_actioned_at ? ` on ${fullDate(r.hr_head_actioned_at)}` : ''} · ready to send</>
                      : <>Waiting on <b>{heads || 'the HR Head'}</b> · HR Head</>}
                    steps={[
                      { label:'Offer raised', who: r.submitted_by && !/^[0-9a-f-]{36}$/i.test(r.submitted_by) ? r.submitted_by : 'Recruiter', when: r.submitted_at ? fullDate(r.submitted_at) : null, state:'done' },
                      { label:'HR Head approval', who: ok ? approver : (heads || 'HR Head not set for this company'), when: ok && r.hr_head_actioned_at ? fullDate(r.hr_head_actioned_at) : null, state: ok ? 'done' : 'now' },
                      { label:'Send the offer letter', who: r.hr_manager_email || 'HR Manager', state: ok ? 'now' : 'todo' },
                    ]} />}
                  actions={<>
                    <span className="rx-meta">{r.proposed_doj ? `Joins ${fullDate(r.proposed_doj)}` : (r.submitted_at ? `Raised ${fullDate(r.submitted_at)}` : '')}</span>
                    <span className="sp" />
                    <button type="button" className={ok ? 'rx-btn sm p' : 'rx-btn sm'} onClick={() => prepareOffer(r)}
                      title={ok ? 'Verify the file, generate the offer letter and send it' : 'Verify the file now; Send unlocks once the HR Head approves'}>
                      Open offer file →
                    </button>
                  </>} />
              )
            })}
          </div>
        )}

        {/* The offer file: full screen, verify → generate → send. */}
        {selected && (
          <OfferFileScreen req={selected} mrfNumber={mrfNo(selected)}
            headNames={headNames(selected)} sending={sending} onSend={sendOffer} onClose={() => setSelected(null)} onFactsChanged={factsChanged}
            mail={{ to: toEmail, cc: ccEmails, subject, body, setTo: setToEmail, setCc: setCcEmails, setSubject, setBody }} />
        )}
      </div>
    </RxPage>
  )
}

// ═══════════════════════════════════════════════════════════════
// AUDIT TRAIL VIEWER
// ═══════════════════════════════════════════════════════════════
export function AuditTrailViewer({ candidateId }: { candidateId: string }) {
  const supabase = createClient()
  const [logs, setLogs] = useState<any[]>([])

  useEffect(() => {
    if (!candidateId) return
    supabase.from('recruitment_audit_logs')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setLogs(data || []))
  }, [candidateId])

  const actionLabel: Record<string, [string, string]> = {
    DOC_LINK_CREATED:          ['','Document link created'],
    DOCUMENT_UPLOADED:         ['','Document uploaded'],
    DOCUMENTS_SUBMITTED:       ['','All documents submitted'],
    SALARY_LINK_SENT:          ['','Salary calculator link sent'],
    CANDIDATE_INTERESTED:      ['','Candidate confirmed interest'],
    OFFER_APPROVAL_REQUESTED:  ['','Offer approval request submitted'],
    HR_HEAD_APPROVED:          ['','HR Head approved'],
    HR_HEAD_REJECTED:          ['','HR Head rejected'],
    OFFER_LETTER_SENT:         ['','Offer letter sent'],
    OFFER_ACCEPTED:            ['','Offer accepted'],
    OFFER_ACCEPTED_DIGITAL:    ['','Offer accepted digitally'],
    OFFER_ACCEPTED_UPLOAD:     ['','Signed copy uploaded'],
    OFFER_REVISE_REQUESTED:    ['','Offer revision requested'],
    OFFER_BACKOUT:             ['','Candidate backed out'],
  }

  // Newest first, per section 7. The QUERY still asks for ascending order —
  // only the presentation is reversed here, so nothing that depends on the read
  // order changes. The icon half of each actionLabel tuple is empty throughout
  // (it has been for a while), so the tone carries the meaning instead.
  const items = [...logs].reverse().map((log) => {
    const [, label] = actionLabel[log.action_type] || ['', log.action_type]
    const tone: 'pos' | 'warn' | 'mute' | '' =
      /APPROVED|ACCEPTED|SUBMITTED|REHIRED/.test(log.action_type) ? 'pos'
      : /REJECTED|BACKOUT|REVISE/.test(log.action_type) ? 'warn'
      : ''
    return {
      title: label,
      meta: `${log.actor_email ? `${log.actor_email} · ` : ''}${new Date(log.created_at).toLocaleString('en-IN')}`,
      tone,
    }
  })

  return (
    <section className="rx-mod">
      <div className="rx-mod-h">
        <div className="rx-mod-t">Audit trail</div>
        {items.length > 0 && <span className="rx-mod-m">{items.length} event{items.length === 1 ? '' : 's'}</span>}
      </div>
      {items.length === 0
        ? <span className="rx-meta">No audit logs yet</span>
        : <Timeline items={items} />}
    </section>
  )
}
