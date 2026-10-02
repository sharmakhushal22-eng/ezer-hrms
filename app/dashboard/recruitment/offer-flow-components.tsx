'use client'
import { useState, useEffect, useRef } from 'react'
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
import { RxPage, RecruitmentHeader, SearchBox, Segmented, Help, Timeline, Callout } from '@/components/recruitment/rx'
// The offer's ceiling is the MRF budget normalised to a year. budget_max is
// quoted in the engagement's own period; offered_ctc is always annual. See
// lib/recruitment/compensation.ts for why that lives outside this page.
import { overCeiling, annualCeiling, compOf } from '@/lib/recruitment/compensation'

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
/** An HR_MANAGER holder in a given company, as /api/recruitment/offer-approval
 *  returns them. The HR Head picks one when approving; they issue the letter. */
type HrManagerOption = { id: string; name: string; code: string | null }
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
          <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:Z.raised, background:TK.surface, border:`1px solid ${TK.line}`, borderRadius:8, marginTop:3, boxShadow:E.floating, maxHeight:220, overflowY:'auto' }}>
            {hits.map(e => (
              <button key={e.id} type="button" onClick={() => { onChange([...value, e]); setQ('') }} style={{ display:'flex', width:'100%', textAlign:'left', gap:8, alignItems:'center', padding:'8px 11px', border:'none', borderBottom:`1px solid ${TK.line}`, background:TK.surface, cursor:'pointer', fontFamily:'inherit' }}>
                <span style={{ flex:1, fontSize:12.5, color:TK.ink }}>{e.full_name} <span style={{ color:TK.faint }}>· {e.emp_code || '—'}{e.designation ? ` · ${e.designation}` : ''}</span></span>
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
    // The route is session-guarded, so the headers have to be awaited before the
    // fetch — passing authHeaders() unawaited hands fetch a Promise, which it
    // ignores silently, and the call 401s with nothing failing at build time.
    ;(async () => {
      try {
        const r = await fetch(`/api/recruitment/offer-approval?company_ids=${cid}`, { headers: await authHeaders() })
        const j = await r.json()
        setHrHeads(j.heads?.[cid] || [])
      } catch { setHrHeads([]) }
    })()
  }, [candidate?.company_id, mrf?.company_id])

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
  useEffect(() => { generateTemplate() }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      `OFFER APPROVAL REQUEST — CONFIDENTIAL`,
      `Reference ${ref} · ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      '',
      block('CANDIDATE', [
        line('Name', candidate?.full_name), line('Position', mrf?.designation || candidate?.designation), line('MRF', mrf?.mrf_number),
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
        line('Notice buyout', joining.notice_buyout ? (Number(joining.notice_buyout_amount) > 0 ? `Yes — ${money(joining.notice_buyout_amount)}` : 'Yes') : null),
      ]),
      block('REMARKS', [ line('Hiring manager', hiringRemark), line('Recruiter', recruiterComments) ]),
      cc.length ? block('CC ON THE APPROVAL MAIL', [ `  ${cc.map(e => `${e.full_name}${e.emp_code ? ` (${e.emp_code})` : ''}`).join(', ')}` ]) : null,
      '',
      'Attachments: MRF · interview summary · CTC break-up acknowledgement (password-protected).',
      'Confidential — for internal approval only.',
    ]
    setTemplate(parts.filter(x => x !== null).join('\n\n').replace(/\n{3,}/g, '\n\n'))
    setShowTemplate(true)
  }

  async function submitForApproval() {
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
      ? `Offer approval request submitted — the HR Head has been notified to review and approve (${notified} notified${emailedTo ? `, mail sent to ${emailedTo}` : ''}${notifyWarning ? `; ${notifyWarning}` : ''}).`
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
        <OaCard n={1} title="Offered package" sub="from the negotiation calculator — change it there, not here">
          {negotiation ? (<>
            <div style={oaGrid('repeat(auto-fit, minmax(150px, 1fr))')}>
              <OaTile l="Annual CTC" v={`₹${fmt(ctcN)}`} sub={varAmt ? `fixed ₹${fmt(fixedAmt)}` : 'all fixed'} />
              <OaTile l="Variable" v={varAmt ? `₹${fmt(varAmt)}` : 'Nil'} sub={varAmt ? `${varPct}% of CTC` : undefined} />
              <OaTile l="Monthly in-hand" v={`₹${fmt(negotiation.net_monthly || 0)}`} sub="estimated · before TDS" tone="ok" />
              <OaTile l="Hike" v={hikeLive != null && isFinite(hikeLive) ? `${hikeLive > 0 ? '+' : ''}${hikeLive.toFixed(1)}%` : '—'} sub={prevTotal > 0 ? `over ₹${fmt(prevTotal)}` : 'enter previous CTC'} />
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
        <OaCard n={2} title="Previous employer" tag={<span className="rx-chip" style={{ color:TK.warning, background:TK.warningTint }}>Confidential — HR only</span>} sub="prefilled from the candidate record; not shown to the candidate">
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
              <div className="rx-hint" style={{ paddingBottom:10 }}>Goes into the approval mail as “Notice buyout” — leave blank if the amount is not known yet.</div>
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
              <div className="rx-mod-t">Approval request — preview</div>
              <div style={{ display:'flex', gap:8 }}>
                <button type="button" className="rx-btn sm" onClick={generateTemplate}>Regenerate</button>
                <button type="button" className="rx-btn sm g" onClick={()=>setShowTemplate(false)}>Hide</button>
              </div>
            </div>
            <div style={{ padding:'0 22px 20px' }}>
              <div className="rx-paper" style={{ padding:'28px 32px', animation:'none' }}>
                <pre style={{ margin:0, whiteSpace:'pre-wrap', fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize:11.5, lineHeight:1.65, color:TK.inkSoft }}>{template}</pre>
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
export function HRHeadApprovalDashboard({ companies, departments, locations, mrfs:mrfLookup, rail, focusOfferId }: any = {}) {
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
      .select('*, candidates(full_name, email, phone, experience_years, current_company, designation)')
      .eq('status', tab === 'pending' ? 'SUBMITTED' : 'HR_HEAD_APPROVED')
      .order('submitted_at', { ascending: false })
    setRequests(data || [])
  }

  // HR Head approves Manpower Requisitions (the only place MRFs get approved).
  async function loadMrfs() {
    const { data } = await supabase.from('manpower_requisitions')
      .select('*, companies(company_name)')
      .eq('status', 'SUBMITTED')
      .order('created_at', { ascending: false })
    setMrfs(data || [])
  }
  async function approveMrf(id: string) {
    const { error } = await supabase.from('manpower_requisitions')
      .update({ status: 'APPROVED', approved_at: new Date().toISOString() }).eq('id', id)
    if (error) { alert('Error: ' + error.message); return }
    loadMrfs()
  }
  async function rejectMrf(id: string) {
    const reason = window.prompt('Rejection reason for this MRF:'); if (reason === null) return
    const { error } = await supabase.from('manpower_requisitions')
      .update({ status: 'REJECTED', remarks: reason }).eq('id', id)
    if (error) { alert('Error: ' + error.message); return }
    loadMrfs()
  }

  // ── Rehire: HR Head re-enters a rejected candidate into the pipeline ──
  const REHIRE_STAGES = ['Applied','AI Screened','Telephonic','L1','L2','Optional Round','Shortlisted']
  async function loadRejected() {
    const { data } = await supabase.from('candidates')
      .select('id, full_name, designation, stage, blacklisted, mrf_id, company_id')
      .eq('stage', 'Rejected').order('created_at', { ascending: false })
    setRejected(data || [])
  }
  async function rehire(c: any, stage: string) {
    if (!stage) { alert('Pick a pipeline stage to place the candidate'); return }
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

  async function processApproval(req: any = selected, act: 'approve'|'reject' = action, note: string = comment, hrManager?: { id: string; name: string; code: string | null } | null): Promise<boolean> {
    if (act === 'reject' && !note.trim()) { alert('A rejection reason is required'); return false }
    // Approving IS the hand-off: it names the HR Manager who will generate and
    // send the offer letter, the same way approving an MRF names the hiring
    // manager who will run it. Checked HERE rather than only on the button —
    // this function has default parameters, so it can be called bare, and a
    // disabled control is not an enforcement point.
    if (act === 'approve' && !hrManager?.id) {
      alert('Choose the HR Manager who will issue the offer letter — approving hands it to them.')
      return false
    }
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
      // Only on approval. A rejection has nobody to hand the offer to, and
      // stamping a manager onto a rejected request would put it in their queue.
      // hr_manager_id (137) is the handle the Send Offers screen scopes on;
      // hr_manager_email is the readable echo beside it, like assigned_recruiter.
      ...(action === 'approve' && hrManager?.id
        ? { hr_manager_id: hrManager.id, hr_manager_email: `${hrManager.name}${hrManager.code ? ` (${hrManager.code})` : ''}` }
        : {}),
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
  const fRequests = requests.filter((r:any)=>(!ql || (r.candidates?.full_name||'').toLowerCase().includes(ql)) && recordMatchesFilters({ company_id:r.company_id, mrf_id:r.mrf_id, position:r.candidates?.designation }, mrfLookup, f))

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
        <div className="s12">

      {/* MRF Approvals — HR Head approves new manpower requisitions here */}
      <div style={{ marginBottom:22 }}>
        <div className="rx-label" style={{ margin:'10px 0 8px' }}>MRF Approvals ({fMrfs.length})</div>
        {fMrfs.length === 0 && (
          <div className="rx-mod" style={{ textAlign:'center' as const, padding:18 }}><span className="rx-meta">{ql?'No matching MRF':'No MRFs pending approval'}</span></div>
        )}
        {fMrfs.map(m => (
          <div key={m.id} className="rx-card" style={{ display:'flex', /* .rx-card is flex-direction:column, so a row must say so — without this, space-between distributes VERTICALLY and alignItems centres the content */ flexDirection:'row', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:SP.md }}>
            <div>
              <div style={{ fontSize:14, fontWeight:600 }}>{m.designation || m.position || 'Untitled'}</div>
              <div style={{ fontSize:12, color:TK.faint, marginTop:2 }}>
                {m.companies?.company_name || ''} · {m.no_of_openings || m.openings || 0} openings · {m.employment_type || '—'}{m.experience_required ? ` · ${m.experience_required}` : ''}
              </div>
              {m.skills_required && <div style={{ fontSize:11, color:TK.brandDeep, marginTop:3 }}>Skills: {m.skills_required}</div>}
            </div>
            <div style={{ display:'flex', gap:8, flexShrink:0 }}>
              {/* Styling only — approveMrf/rejectMrf are untouched, and
                  rejectMrf still asks for its reason the way it always has. */}
              <button type="button" className="rx-btn ok" onClick={()=>approveMrf(m.id)}>Approve</button>
              <button type="button" className="rx-btn d" onClick={()=>rejectMrf(m.id)}>Reject</button>
            </div>
          </div>
        ))}
      </div>

      {/* Rehire — re-enter rejected candidates into the pipeline at a chosen stage */}
      <div style={{ marginBottom:22 }}>
        <div className="rx-label" style={{ margin:'10px 0 8px' }}>Rehire — Rejected Candidates ({fRejected.length})</div>
        {fRejected.length === 0 && (
          <div className="rx-mod" style={{ textAlign:'center' as const, padding:18 }}><span className="rx-meta">{ql?'No matching candidate':'No rejected candidates'}</span></div>
        )}
        {fRejected.map(c => (
          <div key={c.id} className="rx-card" style={{ display:'flex', /* see the MRF row above: .rx-card supplies flex-direction:column */ flexDirection:'row', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:SP.md }}>
            <div>
              <div style={{ fontSize:14, fontWeight:600 }}>{c.full_name}{(()=>{ const mn=(mrfLookup||[]).find((m:any)=>m.id===c.mrf_id)?.mrf_number; return mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:TK.brandDeep, background:TK.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null })()}{c.blacklisted && <span style={{ fontSize:10, color:TK.critical, marginLeft:8, fontWeight:600 }}>BLACKLISTED</span>}</div>
              <div style={{ fontSize:12, color:TK.faint, marginTop:2 }}>{c.designation || '—'}</div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
              <select value={rehireStage[c.id] || ''} onChange={e=>setRehireStage(m=>({ ...m, [c.id]: e.target.value }))} className="rx-input" style={{ width:160 }}>
                <option value="">Place at stage…</option>
                {REHIRE_STAGES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
              <button type="button" className="rx-btn ok" onClick={()=>rehire(c, rehireStage[c.id])}>Rehire</button>
            </div>
          </div>
        ))}
      </div>

      <div className="rx-mod-h" style={{ marginBottom:10 }}>
        <div className="rx-mod-t">Offer approvals{tab==='pending' && fRequests.length ? <span className="rx-chip" style={{ background:TK.warningTint, color:TK.warning }}>{fRequests.length} waiting</span> : null}</div>
        <Segmented label="Offer approvals" value={tab}
          onChange={(v:'pending'|'done')=>{ setTab(v); setSelected(null) }}
          options={[{ value:'pending' as const, label:`Pending (${fRequests.length})` },
                    { value:'done' as const,    label:'Approved' }]} />
      </div>

      {fRequests.length === 0 ? (
        <div className="rx-mod" style={{ textAlign:'center' as const, padding:36 }}>
          <div style={{ fontSize:28, marginBottom:6 }}>{tab==='pending' ? '🗂️' : '✅'}</div>
          <div style={{ fontSize:14, fontWeight:700, color:TK.ink }}>{ql ? 'No matching candidate' : tab==='pending' ? 'Nothing waiting on you' : 'No approved offers yet'}</div>
          <div className="rx-meta" style={{ marginTop:4 }}>{tab==='pending' ? 'Offers land here when a recruiter submits them after the candidate accepts the salary link.' : 'Approved offers move to Send Offers for the HR manager.'}</div>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:14 }}>
          {fRequests.map((r, i) => {
            const mn = (mrfLookup||[]).find((m:any)=>m.id===r.mrf_id)?.mrf_number
            const on = selected?.id === r.id
            const ini = (r.candidates?.full_name || '?').split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase()
            const hike = r.hike_pct != null ? Number(r.hike_pct) : null
            return (
              <button key={r.id} type="button" onClick={()=>{ setSelected(r); setAction('approve'); setComment(''); setDecided(null) }} className="rx-lift"
                style={{ textAlign:'left', font:'inherit', cursor:'pointer', background:TK.surface, color:TK.ink, border:`1px solid ${on ? TK.brand : TK.line}`, boxShadow: on ? `0 0 0 3px ${TK.brandTint}` : E.raised, borderRadius:16, padding:16, display:'flex', flexDirection:'column', gap:12, animation:`rxRise .5s ${.06 * Math.min(i, 8)}s cubic-bezier(.2,.8,.2,1) both` }}>
                <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                  <div style={{ width:42, height:42, borderRadius:13, background:`linear-gradient(135deg,${TK.brand},${TK.brandDeep})`, color:TK.onAccent, display:'grid', placeItems:'center', fontWeight:800, fontSize:14, flexShrink:0 }}>{ini}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                      <span style={{ fontSize:14.5, fontWeight:800, letterSpacing:'-.01em' }}>{r.candidates?.full_name}</span>
                      {mn && <span className="rx-chip">{mn}</span>}
                    </div>
                    <div className="rx-meta" style={{ marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{[r.candidates?.designation, r.candidates?.experience_years != null ? `${r.candidates.experience_years} yrs` : null, r.candidates?.current_company].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  <span style={{ fontSize:10.5, fontWeight:700, padding:'3px 9px', borderRadius:99, background: r.status==='SUBMITTED' ? TK.warningTint : TK.positiveTint, color: r.status==='SUBMITTED' ? TK.warning : TK.positive, whiteSpace:'nowrap' }}>{r.status==='SUBMITTED' ? 'Awaiting you' : 'Approved'}</span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                  {[['Offered CTC', `₹${(Number(r.offered_ctc||0)/100000).toFixed(2)}L`], ['Hike', hike != null && isFinite(hike) ? `${hike > 0 ? '+' : ''}${hike.toFixed(1)}%` : '—'], ['DOJ', r.proposed_doj ? new Date(r.proposed_doj).toLocaleDateString('en-IN', { day:'2-digit', month:'short' }) : '—']].map(([k,v]) => (
                    <div key={k} className="rx-tile" style={{ padding:'8px 10px' }}>
                      <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:TK.muted }}>{k}</div>
                      <div style={{ fontSize:15, fontWeight:800, color: k==='Hike' && hike != null ? (hike < 0 ? TK.critical : TK.positive) : TK.ink, marginTop:2, ...numeric }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11.5, color:TK.faint }}>
                  <span>Submitted {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}{r.notice_buyout ? ' · buyout' : ''}</span>
                  <span style={{ color:TK.brandDeep, fontWeight:700 }}>{r.status==='SUBMITTED' ? 'Review & decide →' : 'View →'}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <OfferReviewDrawer
          req={selected} mrf={(mrfLookup||[]).find((m:any)=>m.id===selected.mrf_id) || null}
          processing={processing} decided={decided}
          onClose={()=>{ setSelected(null); setDecided(null); setComment('') }}
          onDecide={(act, note, hrManager)=>processApproval(selected, act, note, hrManager)} />
      )}
        </div>
      </div>
    </RxPage>
  )
}


// ── Documents on the review screen — the approval pack, downloadable in place ──
// The generated PDFs come through the API (it needs the session), so they are fetched as a blob
// and saved; MRF uploads arrive as short-lived signed URLs and are plain links.
type OfferDoc = { key: string; name: string; note?: string; url?: string }
function OfferDocuments({ requestId }: { requestId: string }) {
  const [docs, setDocs] = useState<OfferDoc[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setDocs(null); setErr('')
    ;(async () => {
      try {
        const r = await fetch(`/api/recruitment/offer-approval/documents?request_id=${encodeURIComponent(requestId)}`, { headers: await authHeaders() })
        const j = await r.json().catch(() => ({}))
        if (!live) return
        if (!r.ok) { setErr(j.error || 'Could not load the documents'); setDocs([]) } else setDocs(j.docs || [])
      } catch { if (live) { setErr('Could not load the documents'); setDocs([]) } }
    })()
    return () => { live = false }
  }, [requestId])

  async function download(d: OfferDoc) {
    setBusy(d.key); setErr('')
    try {
      const r = await fetch(`/api/recruitment/offer-approval/documents?request_id=${encodeURIComponent(requestId)}&doc=${d.key}`, { headers: await authHeaders() })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Download failed') }
      const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || `${d.name}.pdf`
      const href = URL.createObjectURL(await r.blob())
      const a = document.createElement('a'); a.href = href; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 4000)
    } catch (e: any) { setErr(`${d.name}: ${e.message}`) }
    setBusy(null)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {docs === null && [0, 1, 2].map(i => <div key={i} className="rx-tile" style={{ height:58, opacity:.5 }} />)}
      {docs?.map(d => (
        <div key={d.key} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:R.md, border:`1px solid ${TK.line}`, background:TK.surface }}>
          <div style={{ width:34, height:38, borderRadius:7, background:TK.criticalTint, color:TK.critical, display:'grid', placeItems:'center', fontSize:9.5, fontWeight:800, flexShrink:0 }}>{d.url ? 'FILE' : 'PDF'}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:TK.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.name}</div>
            {d.note && <div style={{ fontSize:11, color:TK.muted, marginTop:1 }}>{d.note}</div>}
          </div>
          {d.url
            ? <a href={d.url} target="_blank" rel="noreferrer" className="rx-btn sm" style={{ textDecoration:'none' }}>↓ Download</a>
            : <button type="button" className="rx-btn sm" disabled={busy === d.key} onClick={() => download(d)} style={{ opacity: busy === d.key ? .6 : 1 }}>{busy === d.key ? 'Preparing…' : '↓ Download'}</button>}
        </div>
      ))}
      {docs?.length === 0 && !err && <div className="rx-hint">No documents for this offer.</div>}
      {err && <div style={{ fontSize:12, color:TK.critical, background:TK.criticalTint, borderRadius:R.sm, padding:'8px 10px' }}>{err}</div>}
    </div>
  )
}

// ── HR Head review screen — a centred dialog over the dashboard; one offer, one decision ──
function OfferReviewDrawer({ req, mrf, processing, decided, onClose, onDecide }: {
  req: any; mrf: any; processing: boolean; decided: { action: 'approve'|'reject'; notified: number } | null
  onClose: () => void
  /** Approving carries the HR Manager who will issue the letter; rejecting does not. */
  onDecide: (action: 'approve'|'reject', note: string, hrManager?: HrManagerOption | null) => Promise<boolean>
}) {
  // Who may be handed the offer: HR_MANAGER holders in the request's own
  // company, from the (now session-guarded) offer-approval GET. null = still
  // loading, [] = this company has nobody with the role.
  const [managers, setManagers] = useState<HrManagerOption[] | null>(null)
  const [hrManager, setHrManager] = useState<HrManagerOption | null>(null)
  const [mode, setMode] = useState<'view'|'reject'|'approve'>('view')
  const [note, setNote] = useState('')
  const [showTpl, setShowTpl] = useState(false)
  useEffect(() => { setMode('view'); setNote(''); setShowTpl(false); setHrManager(null); setManagers(null) }, [req?.id])
  // Who can be handed this offer: HR_MANAGER holders in THIS request's company.
  // Scoped per request rather than loaded once, because the HR Head reviews
  // offers across companies and the people differ. The route is session-guarded,
  // so the headers must be awaited — an un-awaited authHeaders() is a Promise,
  // which fetch ignores silently, and the call 401s with nothing failing at build.
  useEffect(() => {
    const cid = req?.company_id
    if (!cid) { setManagers([]); return }
    let live = true
    ;(async () => {
      try {
        const r = await fetch(`/api/recruitment/offer-approval?company_ids=${cid}`, { headers: await authHeaders() })
        const j = await r.json()
        if (live) setManagers(j.managers?.[cid] || [])
      } catch { if (live) setManagers([]) }
    })()
    return () => { live = false }
  }, [req?.id, req?.company_id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !processing) onClose() }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [onClose, processing])
  useEffect(() => { if (decided) { const t = setTimeout(onClose, 1600); return () => clearTimeout(t) } }, [decided, onClose])
  if (typeof document === 'undefined') return null
  const c = req.candidates || {}
  const rs = (n: any) => `₹${fmt(Number(n || 0))}`
  const day = (v: any) => v ? new Date(v).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
  const ctc = Number(req.offered_ctc || 0), vp = Number(req.offered_variable_pct || 0), vAmt = ctc > 0 && vp > 0 ? Math.round(ctc * vp / 100) : 0
  const hike = req.hike_pct != null ? Number(req.hike_pct) : null
  const pending = req.status === 'SUBMITTED'
  const mrfNumber: string | null = mrf?.mrf_number || null
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
    <div onMouseDown={e => { if (e.target === e.currentTarget && !processing) onClose() }}
      style={{ position:'fixed', inset:0, zIndex:Z.modal, background:'rgba(15,23,42,.42)', backdropFilter:'blur(3px)', animation:'rxFade .3s both', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px 16px' }}>
      <div role="dialog" aria-modal="true" style={{ width:'min(1080px, 100%)', maxHeight:'calc(100vh - 48px)', background:TK.surface, color:TK.ink, border:`1px solid ${TK.line}`, borderRadius:R.xl, boxShadow:E.overlay, display:'flex', flexDirection:'column', overflow:'hidden', animation:'rxModal .4s cubic-bezier(.2,.8,.2,1) both' }}>
        {/* header */}
        <div style={{ padding:'18px 22px 14px', borderBottom:`1px solid ${TK.line}`, display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:46, height:46, borderRadius:14, background:`linear-gradient(135deg,${TK.brand},${TK.brandDeep})`, color:TK.onAccent, display:'grid', placeItems:'center', fontWeight:800, fontSize:15, flexShrink:0 }}>{(c.full_name || '?').split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase()}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <span style={{ fontSize:17, fontWeight:800, letterSpacing:'-.01em' }}>{c.full_name}</span>
              {mrfNumber && <span className="rx-chip">{mrfNumber}</span>}
              <span style={{ fontSize:10.5, fontWeight:700, padding:'3px 9px', borderRadius:99, background: pending ? TK.warningTint : TK.positiveTint, color: pending ? TK.warning : TK.positive }}>{pending ? 'Awaiting your decision' : 'Approved'}</span>
            </div>
            <div className="rx-meta" style={{ marginTop:2 }}>{[c.designation, c.experience_years != null ? `${c.experience_years} yrs` : null, c.current_company, c.email].filter(Boolean).join(' · ')}</div>
          </div>
          <button type="button" className="rx-btn sm g" onClick={() => !processing && onClose()} aria-label="Close">✕</button>
        </div>

        {/* body */}
        <div style={{ flex:1, overflowY:'auto', padding:'18px 22px 24px' }}>
          {decided ? (
            <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', gap:10, padding:'40px 0', animation:'rxRise .4s both' }}>
              <div style={{ width:84, height:84, borderRadius:99, display:'grid', placeItems:'center', background: decided.action==='approve' ? TK.positiveTint : TK.criticalTint, color: decided.action==='approve' ? TK.positive : TK.critical, fontSize:40, fontWeight:900, animation:'rxPop .5s cubic-bezier(.2,.8,.2,1) both' }}>{decided.action==='approve' ? '✓' : '✕'}</div>
              <div style={{ fontSize:20, fontWeight:800 }}>{decided.action==='approve' ? 'Offer approved' : 'Offer rejected'}</div>
              <div className="rx-meta" style={{ maxWidth:360 }}>{decided.action==='approve' ? `${c.full_name}'s offer moves to Send Offers. ${decided.notified ? `${decided.notified} people notified (recruiter + HR manager).` : ''}` : `The recruiter${decided.notified > 1 ? ' and the MRF raiser' : ''} ${decided.notified ? 'have been told why.' : 'will see the reason on the request.'}`}</div>
            </div>
          ) : (<div style={{ display:'flex', gap:24, flexWrap:'wrap', alignItems:'flex-start' }}>
           <div style={{ flex:'1 1 480px', minWidth:0 }}>
            {overBudget && (
              <div style={{ marginBottom:12 }}>
                <Callout tone="warn">
                  This offer is above the requisition&rsquo;s budget — {rs(ctc)} against a ceiling of {rs(ceiling)}.
                  {monthlyBudget && ` The requisition is budgeted monthly (${rs(mrf?.budget_max)}/mo), shown here as a year.`}
                </Callout>
              </div>
            )}
            {/* hero numbers */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10 }}>
              {[['Offered CTC', rs(ctc), 'per annum', TK.ink], ['Hike', hike != null && isFinite(hike) ? `${hike > 0 ? '+' : ''}${hike.toFixed(1)}%` : '—', Number(req.prev_total_ctc) > 0 ? `over ${rs(req.prev_total_ctc)}` : 'previous CTC unknown', hike != null ? (hike < 0 ? TK.critical : TK.positive) : TK.ink], ['Monthly in-hand', req.monthly_inhand ? rs(req.monthly_inhand) : '—', 'estimated · before TDS', TK.ink]].map(([k, v, sub, col], i) => (
                <div key={String(k)} className="rx-tile" style={{ animation:`rxRise .45s ${.05 * i}s cubic-bezier(.2,.8,.2,1) both` }}>
                  <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:TK.muted }}>{k}</div>
                  <div style={{ fontSize:20, fontWeight:800, letterSpacing:'-.02em', color: col as string, marginTop:3, ...numeric }}>{v}</div>
                  <div style={{ fontSize:11, color:TK.faint, marginTop:2 }}>{sub}</div>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:12 }}>
              {req.proposed_doj && <span className="rx-chip">DOJ {day(req.proposed_doj)}{req.days_to_join != null ? ` · ${req.days_to_join} days` : ''}</span>}
              {Number(req.notice_period_days) > 0 && <span className="rx-chip">Notice {req.notice_period_days} days</span>}
              {req.notice_buyout && <span className="rx-chip" style={{ background:TK.warningTint, color:TK.warning }}>Buyout{Number(req.notice_buyout_amount) > 0 ? ` ${rs(req.notice_buyout_amount)}` : ''}</span>}
              {vAmt > 0 && <span className="rx-chip">Variable {vp}%</span>}
            </div>

            <Sec t="Offered package" />
            <Row k="Fixed CTC" v={vAmt > 0 ? `${rs(ctc - vAmt)} p.a.` : `${rs(ctc)} p.a. (all fixed)`} strong />
            <Row k="Variable" v={vAmt > 0 ? `${rs(vAmt)} p.a. · ${vp}% of CTC` : null} />
            <Row k="Joining bonus" v={Number(req.joining_bonus) > 0 ? `${rs(req.joining_bonus)}${req.joining_bonus_freq ? ` (${req.joining_bonus_freq})` : ''}` : null} />
            <Row k="Retention bonus" v={Number(req.retention_bonus) > 0 ? rs(req.retention_bonus) : null} />
            <Row k="ESOP" v={Number(req.esop_value) > 0 ? `${rs(req.esop_value)}${req.esop_vesting ? ` (${req.esop_vesting})` : ''}` : null} />

            <Sec t="Previous employer" tag={<span style={{ fontSize:10, fontWeight:600, textTransform:'none', letterSpacing:0, color:TK.warning, background:TK.warningTint, padding:'2px 8px', borderRadius:99 }}>confidential</span>} />
            <Row k="Company" v={req.prev_company_name || c.current_company} />
            <Row k="Address" v={req.prev_company_address} />
            <Row k="Total CTC" v={Number(req.prev_total_ctc) > 0 ? `${rs(req.prev_total_ctc)} p.a.` : null} strong />
            <Row k="Fixed / variable" v={(Number(req.prev_fixed_ctc) > 0 || Number(req.prev_variable) > 0) ? `${Number(req.prev_fixed_ctc) > 0 ? rs(req.prev_fixed_ctc) : '—'} / ${Number(req.prev_variable) > 0 ? rs(req.prev_variable) : '—'}` : null} />
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

        {/* footer — the decision */}
        {pending && !decided && (
          <div style={{ padding:'14px 22px', borderTop:`1px solid ${TK.line}`, background:TK.surface, display:'flex', flexDirection:'column', gap:10 }}>
            {mode === 'reject' && (
              <div style={{ padding:14, borderRadius:14, border:`1px solid ${TK.criticalEdge}`, background:TK.criticalTint, display:'flex', flexDirection:'column', gap:8, animation:'rxRise .3s both' }}>
                <div style={{ fontSize:12.5, fontWeight:700, color:TK.critical }}>Why are you rejecting this offer? The recruiter and the MRF raiser will read this.</div>
                <textarea autoFocus className="rx-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. CTC is above the approved band for this grade — revise and resubmit." style={{ height:'auto', minHeight:72, resize:'vertical', padding:'10px 13px' }} />
              </div>
            )}
            {mode === 'approve' && (
              <div style={{ padding:14, borderRadius:14, border:`1px solid ${TK.positiveEdge}`, background:TK.positiveTint, display:'flex', flexDirection:'column', gap:8, animation:'rxRise .3s both' }}>
                <div style={{ fontSize:12.5, fontWeight:700, color:TK.positive }}>Approve {rs(ctc)} for {c.full_name}? Choose who will issue the offer letter.</div>
                {/* Approving IS the hand-off. Required, so the offer cannot be
                    approved into nobody's queue — the same rule the HR Head's
                    MRF approval uses when it names the hiring manager. */}
                {managers === null ? (
                  <div style={{ fontSize:11.5, color:TK.muted }}>Loading HR Managers…</div>
                ) : managers.length === 0 ? (
                  <div style={{ fontSize:11.5, color:TK.warning, background:TK.warningTint, borderRadius:8, padding:'8px 10px' }}>
                    No HR Manager is set up for this company, so this offer cannot be handed to anyone yet.
                    Ask an admin to give someone the <b>HR Manager</b> role in Assign Roles.
                  </div>
                ) : (
                  <select className="rx-input" value={hrManager?.id || ''}
                    onChange={e => setHrManager(managers.find(m => m.id === e.target.value) || null)}
                    style={{ padding:'9px 11px' }}>
                    <option value="">Select the HR Manager who will issue the letter…</option>
                    {managers.map(m => <option key={m.id} value={m.id}>{m.name}{m.code ? ` (${m.code})` : ''}</option>)}
                  </select>
                )}
                <textarea className="rx-input" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional comment — goes with the approval notification." style={{ height:'auto', minHeight:56, resize:'vertical', padding:'10px 13px' }} />
              </div>
            )}
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {mode === 'view' ? (<>
                <button type="button" className="rx-btn d" onClick={() => setMode('reject')} disabled={processing}>Reject</button>
                <span style={{ flex:1 }} />
                <button type="button" className="rx-btn p" onClick={() => setMode('approve')} disabled={processing}>Approve offer →</button>
              </>) : (<>
                <button type="button" className="rx-btn g" onClick={() => setMode('view')} disabled={processing}>← Back</button>
                <span style={{ flex:1 }} />
                <button type="button" className={`rx-btn ${mode === 'reject' ? 'd' : 'p'}`} disabled={processing || (mode === 'reject' && !note.trim()) || (mode === 'approve' && !hrManager)} onClick={() => onDecide(mode as 'approve'|'reject', note, hrManager)} style={{ opacity: processing || (mode === 'reject' && !note.trim()) || (mode === 'approve' && !hrManager) ? .55 : 1 }}>
                  {processing ? (mode === 'reject' ? 'Rejecting…' : 'Approving…') : mode === 'reject' ? 'Confirm rejection' : 'Confirm approval'}
                </button>
              </>)}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ═══════════════════════════════════════════════════════════════
// HR MANAGER: SEND OFFER LETTER
// ═══════════════════════════════════════════════════════════════
export function HRManagerSendOffer({ companies, departments, locations, mrfs:mrfLookup, allowedMrfIds = null, myEmployeeId = null, scopeToMe = false, rail }: any = {}) {
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
      .select('*, candidates(full_name, email, phone, designation, experience_years, current_company, mrf_id), companies(company_name, company_code), manpower_requisitions(designation), ctc_negotiations(basic_monthly, hra_monthly, net_monthly, variable_pct)')
      .in('status',['SUBMITTED','HR_HEAD_APPROVED'])
      .order('submitted_at',{ ascending:false })
      // A scoped hiring manager only sees offers for candidates under the MRFs assigned to
      // them; `allowedMrfIds` is null for oversight roles (no filter).
      .then(async ({ data }) => {
        // An HR Manager sees the offers the HR Head handed to THEM — hr_manager_id,
        // set at final approval (137). That REPLACES the MRF filter for them
        // rather than stacking on it: allowedMrfIds is "every MRF this viewer can
        // see", which is visibility, not assignment, and would show an HR Manager
        // every offer in their scope. Oversight logins keep the old behaviour.
        const rows = (data || []).filter((r: any) => scopeToMe
          ? (!!myEmployeeId && r.hr_manager_id === myEmployeeId)
          : (!allowedMrfIds || (r.candidates?.mrf_id && allowedMrfIds.has(r.candidates.mrf_id))))
        setApproved(rows)
        // keep the open one in sync — this is what flips the button from locked to live
        setSelected((sel: any) => sel ? (rows.find((r: any) => r.id === sel.id) || null) : sel)
        const ids = Array.from(new Set(rows.map((r: any) => r.company_id).filter(Boolean))) as string[]
        // Session-guarded route: the headers must be awaited. Handing fetch an
        // un-awaited authHeaders() Promise is ignored silently and 401s.
        if (ids.length) {
          try {
            const r = await fetch(`/api/recruitment/offer-approval?company_ids=${ids.join(',')}`, { headers: await authHeaders() })
            setHrHeads((await r.json()).heads || {})
          } catch { /* the list still renders; only the "who approves" line is missing */ }
        }
      })
  }, [allowedMrfIds, myEmployeeId, scopeToMe, tick])

  const isApproved = (r: any) => r?.status === 'HR_HEAD_APPROVED'
  const headNames = (r: any) => (hrHeads[r?.company_id] || []).map(h => `${h.name}${h.code ? ` (${h.code})` : ''}`).join(', ')

  function prepareOffer(r: any) {
    setSelected(r)
    setToEmail(r.candidates?.email || '')
    const company = r.companies?.company_name || 'our organization'
    const role = r.candidates?.designation || r.manpower_requisitions?.designation || 'the role'
    setSubject(`Offer of Employment — ${role} | ${company}`)
    setBody(`Dear ${r.candidates?.full_name},

Congratulations! We are delighted to offer you the position of ${role} at ${company}.

Your detailed offer letter is included below (and attached as an image) for your reference.

Key details:
• Annual CTC: ₹${r.offered_ctc ? fmt(r.offered_ctc) : '—'}
• Proposed Date of Joining: ${r.proposed_doj ? new Date(r.proposed_doj).toLocaleDateString('en-IN') : '—'}

This offer is valid for 7 days and is subject to background verification and document submission. To accept, simply reply to this email confirming your acceptance.

We look forward to welcoming you to the team.

Warm regards,
${company} — Human Resources`)
  }

  async function sendOffer() {
    if (!selected || !toEmail || !body) { alert('Recipient email and body are required'); return }
    // Never trust the button state alone — re-read the row so an offer the HR Head has not
    // approved (or has rejected since the screen loaded) cannot go out.
    const { data: live } = await supabase.from('offer_approval_requests').select('status').eq('id', selected.id).maybeSingle()
    if (live?.status !== 'HR_HEAD_APPROVED') { alert(live?.status === 'SUBMITTED' ? 'The HR Head has not approved this offer yet. The Send Offer button unlocks once they do.' : `This offer is ${String(live?.status || 'unavailable').replace(/_/g, ' ').toLowerCase()} — it cannot be sent.`); setTick(t => t + 1); return }

    // Validate the To + CC addresses, and warn if CC was left empty (easy to forget).
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRe.test(toEmail.trim())) { alert('Please enter a valid recipient (To) email address.'); return }
    const ccList = ccEmails.split(',').map((e: string) => e.trim()).filter(Boolean)
    const badCc = ccList.filter((e: string) => !emailRe.test(e))
    if (badCc.length) { alert('These CC email(s) look invalid:\n• ' + badCc.join('\n• ')); return }
    if (ccList.length === 0 && !confirm('No CC email added.\nSend the offer letter without any CC?')) return

    setSending(true)

    // 1. Actually email the offer letter to the candidate via Gmail.
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
        body: JSON.stringify({ to: toEmail, cc: ccEmails, subject, body, offer }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) {
        setSending(false)
        alert('Email NOT sent: ' + (d.error || `HTTP ${r.status}`) + '\nNothing was marked as sent.')
        return
      }
    } catch {
      setSending(false)
      alert('Email NOT sent: network error. Nothing was marked as sent.')
      return
    }

    // 2. Email is out — record the offer letter.
    const { error } = await supabase.from('offer_letters').insert({
      candidate_id: selected.candidate_id,
      candidate_name: selected.candidates?.full_name || toEmail,
      designation: selected.candidates?.designation || selected.manpower_requisitions?.designation || 'Not specified',
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
    await supabase.from('candidates').update({ stage: 'Offer Sent', offer_accepted: false, offer_sent_at: new Date().toISOString(), offer_reminder_sent: false }).eq('id', selected.candidate_id)

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
  const fApproved = approved.filter((r:any)=>(!sql || (r.candidates?.full_name||'').toLowerCase().includes(sql)) && recordMatchesFilters({ company_id:r.company_id, mrf_id:r.mrf_id, position:r.candidates?.designation || r.manpower_requisitions?.designation }, mrfLookup, f))
  return (
    <RxPage header={
      <RecruitmentHeader
        title="Send offer letters"
        subtitle="Every offer submitted to the HR Head. The Send Offer button unlocks the moment the HR Head approves."
        help={<Help label="Who appears here">
          <p>A candidate appears the moment the recruiter <b>submits the offer to the HR Head</b>, with the Send Offer button locked.</p>
          <p>Once the HR Head <b>approves</b>, the button unlocks. Sending emails the letter, records it, and moves the candidate to <b>Offer Sent</b>.</p>
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
        <div className="s3">
          {fApproved.length === 0 && (
            <div className="rx-mod" style={{ textAlign:'center' as const, padding:32 }}>
              <span className="rx-meta">{sql ? 'No matching candidate' : 'No offers submitted to the HR Head yet'}</span>
            </div>
          )}
          {/* No flexDirection here on purpose: this card's content really is
              stacked, so .rx-card's own flex-direction:column is what we want.
              The MRF/rehire rows in HR Head needed row and had to say so. */}
          {fApproved.map(r => (
            <div key={r.id} onClick={() => prepareOffer(r)} className="rx-card"
              style={{ cursor:'pointer', marginBottom:SP.md, border:selected?.id===r.id?`2px solid ${TK.brand}`:undefined, background:selected?.id===r.id?TK.brandTint:undefined }}>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:3 }}>{r.candidates?.full_name}{(()=>{ const mn=(mrfLookup||[]).find((m:any)=>m.id===r.mrf_id)?.mrf_number; return mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:TK.brandDeep, background:TK.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null })()}</div>
              <div style={{ fontSize:12, color:TK.faint }}>
                {r.candidates?.experience_years}yr · ₹{r.offered_ctc ? fmt(r.offered_ctc) : '—'} · Hike {r.hike_pct ? Number(r.hike_pct).toFixed(1) + '%' : '—'}
              </div>
              {isApproved(r) ? (
                <div style={{ fontSize:11, color:TK.positive, marginTop:4, display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:7, height:7, borderRadius:99, background:TK.positive, flexShrink:0 }} />
                  HR Head approved on {r.hr_head_actioned_at ? new Date(r.hr_head_actioned_at).toLocaleDateString('en-IN') : '—'} · ready to send
                </div>
              ) : (
                <div style={{ fontSize:11, color:TK.warning, marginTop:4, display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:7, height:7, borderRadius:99, background:TK.warning, flexShrink:0, animation:'rxPulse 1.6s ease-in-out infinite' }} />
                  Yet to be approved by HR Head{headNames(r) ? ` · ${headNames(r)}` : ''}
                </div>
              )}
              <div style={{ display:'flex', gap:6, marginTop:8 }}>
                <span className="rx-chip" style={{ background: isApproved(r) ? TK.positiveTint : TK.warningTint, color: isApproved(r) ? TK.positive : TK.warning, border:`1px solid ${isApproved(r) ? TK.positiveEdge : TK.warningEdge}` }}>{isApproved(r) ? 'Approved' : 'Awaiting approval'}</span>
                <button className="rx-btn sm" disabled={!isApproved(r)} onClick={e => { e.stopPropagation(); prepareOffer(r) }}
                  title={isApproved(r) ? 'Open the offer letter' : 'Unlocks once the HR Head approves'}
                  style={{ marginLeft:'auto', opacity: isApproved(r) ? 1 : .45, cursor: isApproved(r) ? 'pointer' : 'not-allowed' }}>
                  {isApproved(r) ? 'Send offer' : '🔒 Send offer'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* The letter as the candidate will read it. Presentation only: it
            renders the SAME `body` state the form edits, so there is nothing
            here that can disagree with what is actually sent. .rx-paper is
            deliberately paper-white in both themes — it is a letter. */}
        {selected && (
          <div className="s5">
            <section className="rx-mod" style={{ padding:0, background:'transparent', border:'none', boxShadow:'none' }}>
              <div className="rx-mod-h" style={{ marginBottom:10 }}>
                <div className="rx-mod-t">Letter preview</div>
                <span className="rx-mod-m">as the candidate will see it</span>
              </div>
              <div className="rx-paper" style={{ whiteSpace:'pre-wrap', maxHeight:560, overflowY:'auto' }}>
                <div style={{ fontWeight:700, fontSize:13.5, marginBottom:10 }}>{subject || 'Offer of employment'}</div>
                {body || 'Pick a candidate to build their letter.'}
              </div>
            </section>
          </div>
        )}

        {selected && (
          <div className="s4">
          <section className="rx-mod brand">
            <div className="rx-mod-h"><div className="rx-mod-t">Send offer letter</div></div>
            <div style={{ fontSize:13, fontWeight:500, color:TK.brandDeep, marginBottom:12 }}>{selected.candidates?.full_name}{(()=>{ const mn=(mrfLookup||[]).find((m:any)=>m.id===selected.mrf_id)?.mrf_number; return mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:TK.brandDeep, background:TK.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null })()}</div>
            <div style={{ marginBottom:8 }}>
              <label className="rx-label" style={{ display:'block', marginBottom:6 }}>To *</label>
              <input className="rx-input" value={toEmail} onChange={e=>setToEmail(e.target.value)} />
            </div>
            <div style={{ marginBottom:8 }}>
              <label className="rx-label" style={{ display:'block', marginBottom:6 }}>CC (comma separated)</label>
              <input className="rx-input" value={ccEmails} onChange={e=>setCcEmails(e.target.value)} placeholder="hr@company.com, md@company.com" />
            </div>
            <div style={{ marginBottom:8 }}>
              <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Subject</label>
              <input className="rx-input" value={subject} onChange={e=>setSubject(e.target.value)} />
            </div>
            <div style={{ marginBottom:12 }}>
              <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Email Body</label>
              <textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', minHeight:280 }} value={body} onChange={e=>setBody(e.target.value)} />
            </div>
            {isApproved(selected) ? (
              <div style={{ background:TK.brandTint, borderRadius:7, padding:'8px 12px', marginBottom:12, fontSize:11, color:TK.brandDeep }}>
                This emails the offer letter to the candidate via Gmail, records it, and marks the candidate <b>Offer Sent</b> in the pipeline.
              </div>
            ) : (
              <div style={{ background:TK.warningTint, border:`1px solid ${TK.warningEdge}`, borderRadius:7, padding:'8px 12px', marginBottom:12, fontSize:11, color:TK.warning }}>
                <b>Yet to be approved.</b> This offer is with the HR Head{headNames(selected) ? ` (${headNames(selected)})` : ''}. The button below unlocks automatically once it is approved — you can prepare the letter meanwhile.
              </div>
            )}
            {/* sendOffer is untouched: same validation, same send-offer-email
                POST, same records written, same confirmations. */}
            <button type="button" className="rx-btn p" onClick={sendOffer} disabled={sending || !isApproved(selected)}
              title={isApproved(selected) ? undefined : 'Waiting for HR Head approval'}
              style={{ width:'100%', opacity: isApproved(selected) ? 1 : .5, cursor: isApproved(selected) ? 'pointer' : 'not-allowed' }}>
              {sending ? 'Sending…' : isApproved(selected) ? 'Send Offer & Mark as Sent' : '🔒 Waiting for HR Head approval'}
            </button>
          </section>
          </div>
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
