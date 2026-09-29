'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// The design system, aliased around this file's own S.
import {
  C as TK, F as TF, W, R, E, S as SP, tone, eyebrow, numeric, inputStyle,
} from '@/lib/ui'
import { RxPage, RecruitmentHeader, SearchBox, Segmented, Help } from '@/components/recruitment/rx'

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
          <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:5, background:TK.surface, border:`1px solid ${TK.line}`, borderRadius:8, marginTop:3, boxShadow:E.floating, maxHeight:220, overflowY:'auto' }}>
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

// ═══════════════════════════════════════════════════════════════
// RECRUITER: CREATE OFFER APPROVAL REQUEST
// ═══════════════════════════════════════════════════════════════
export function CreateOfferApproval({ candidate, negotiation, mrf, onSubmitted }: any) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [template, setTemplate] = useState('')
  const [showTemplate, setShowTemplate] = useState(false)
  const [cc, setCc] = useState<CcEmp[]>([])

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
    const doj = joining.proposed_doj
    const daysToJoin = doj ? daysDiff(doj) : '—'
    const hike = negotiation?.hike_pct ? Number(negotiation.hike_pct).toFixed(1) : '—'
    const docsCount = negotiation?.documents_count || 'pending'

    const tmpl = `OFFER APPROVAL REQUEST — CONFIDENTIAL
${''.repeat(50)}
Reference: OAR-${Date.now().toString().slice(-6)}
Date: ${new Date().toLocaleDateString('en-IN')}
Prepared by: [Recruiter Name]

CANDIDATE INFORMATION:
  Name:              ${candidate?.full_name || '—'}
  MRF Reference:     ${mrf?.mrf_number || mrf?.id?.slice(0,8) || '—'}
  Position:          ${mrf?.designation || candidate?.designation || '—'}
  Experience:        ${candidate?.experience_years || '—'} years

PREVIOUS EMPLOYER DETAILS:
  Company:           ${prevForm.prev_company_name || '—'}
  Address:           ${prevForm.prev_company_address || '—'}
  Previous CTC:      ₹${prevForm.prev_total_ctc ? fmt(Number(prevForm.prev_total_ctc)) : '—'}
  Fixed CTC:         ₹${prevForm.prev_fixed_ctc ? fmt(Number(prevForm.prev_fixed_ctc)) : '—'}
  Variable:          ₹${prevForm.prev_variable ? fmt(Number(prevForm.prev_variable)) : '—'}
  TA / DA:           ₹${prevForm.prev_ta_da ? fmt(Number(prevForm.prev_ta_da)) + '/month' : 'Nil'}
  Additional:        ${prevForm.prev_additional || 'Nil'}

OFFERED COMPENSATION PACKAGE:
  Annual CTC:        ₹${negotiation?.offered_ctc ? fmt(negotiation.offered_ctc) : '—'}
  Fixed:             ₹${negotiation?.offered_ctc && negotiation?.variable_pct ? fmt(negotiation.offered_ctc * (1 - negotiation.variable_pct/100)) : '—'}
  Variable (${negotiation?.variable_pct || 0}%): ₹${negotiation?.offered_ctc && negotiation?.variable_pct ? fmt(negotiation.offered_ctc * negotiation.variable_pct/100) : '—'}
  Monthly Gross:     ₹${negotiation?.offered_ctc ? fmt(Math.round(negotiation.offered_ctc * (1-((negotiation.variable_pct||0)/100)) / 12)) : '—'}
  Monthly In-Hand:   ₹${negotiation?.net_monthly ? fmt(negotiation.net_monthly) : '—'} (est., excl. TDS)

  One-time Payments:
  Joining Bonus:     ₹${negotiation?.joining_bonus ? fmt(negotiation.joining_bonus) : 'Nil'} ${negotiation?.joining_bonus_freq ? `(${negotiation.joining_bonus_freq})` : ''}
  Retention Bonus:   ₹${negotiation?.retention_bonus ? fmt(negotiation.retention_bonus) : 'Nil'} ${negotiation?.retention_bonus_freq ? `(${negotiation.retention_bonus_freq})` : ''}
  ESOP:              ₹${negotiation?.esop_value ? fmt(negotiation.esop_value) : 'Nil'} ${negotiation?.esop_remark ? `(${negotiation.esop_remark})` : ''}

  HIKE: ${hike}% over previous CTC

JOINING DETAILS:
  Proposed DOJ:      ${doj ? new Date(doj).toLocaleDateString('en-IN') : '—'}
  Days to Join:      ${daysToJoin} days from today
  Notice Period:     ${joining.notice_period_days || '—'} days
  Notice Buyout:     ${joining.notice_buyout ? `Yes${Number(joining.notice_buyout_amount) > 0 ? ` — ₹${fmt(Number(joining.notice_buyout_amount))}` : ''}` : 'No'}

DOCUMENTS STATUS:    ${docsCount} document(s) received
BGV STATUS:          Pending

HIRING MANAGER REMARK / TARGET:
  ${hiringRemark || 'Nil'}

${recruiterComments ? `Recruiter Comments:\n  ${recruiterComments}` : ''}
${''.repeat(50)}
This document is confidential and for internal approval only.`
    setTemplate(tmpl)
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
        const r = await fetch('/api/recruitment/offer-approval', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ action:'submitted', request_id: created.id }) })
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

  return (
    <div style={{ maxWidth:700, margin:'0 auto', padding:16 }}>
      <div style={{ fontSize:16, fontWeight:600, color:TK.ink, marginBottom:4 }}>Create Offer Approval Request</div>
      <div style={{ fontSize:12, color:TK.faint, marginBottom:16 }}>
        {candidate?.full_name} — {mrf?.designation}
      </div>

      {/* PREVIOUS EMPLOYER SECTION */}
      <div style={S.cardP}>
        <SecLine title="Previous Employer Details" />
        <div style={{ fontSize:11, color:TK.brandDeep, background:TK.brandTint, borderRadius:7, padding:'6px 10px', marginBottom:12 }}>
          This section is confidential — NOT shown to candidate. Only visible in HR approval request.
        </div>
        <div style={{ ...S.g2, marginBottom:10 }}>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Previous Company Name *</label><input className="rx-input" value={prevForm.prev_company_name} onChange={e=>P('prev_company_name',e.target.value)} placeholder="e.g. Amazon India Pvt Ltd" /></div>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Previous Company Address</label><input className="rx-input" value={prevForm.prev_company_address} onChange={e=>P('prev_company_address',e.target.value)} placeholder="City, State" /></div>
        </div>
        <div style={{ ...S.g3, marginBottom:10 }}>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Previous Total CTC (₹) *</label><input className="rx-input" type="number" value={prevForm.prev_total_ctc} onChange={e=>P('prev_total_ctc',e.target.value)} placeholder="Annual" /></div>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Fixed CTC (₹)</label><input className="rx-input" type="number" value={prevForm.prev_fixed_ctc} onChange={e=>P('prev_fixed_ctc',e.target.value)} /></div>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Variable (₹ Annual)</label><input className="rx-input" type="number" value={prevForm.prev_variable} onChange={e=>P('prev_variable',e.target.value)} /></div>
        </div>
        <div style={{ ...S.g2, marginBottom:10 }}>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>TA / DA (₹ Monthly)</label><input className="rx-input" type="number" value={prevForm.prev_ta_da} onChange={e=>P('prev_ta_da',e.target.value)} placeholder="0 if not applicable" /></div>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Any Additional Payment</label><input className="rx-input" value={prevForm.prev_additional} onChange={e=>P('prev_additional',e.target.value)} placeholder="e.g. Car allowance, Retention" /></div>
        </div>
      </div>

      {/* JOINING DETAILS */}
      <div style={S.card}>
        <SecLine title="Joining Details" />
        <div style={{ ...S.g3, marginBottom:10 }}>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Proposed Date of Joining *</label><input className="rx-input" type="date" value={joining.proposed_doj} onChange={e=>J('proposed_doj',e.target.value)} /></div>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Notice Period (Days)</label><input className="rx-input" type="number" value={joining.notice_period_days} onChange={e=>J('notice_period_days',e.target.value)} /></div>
          <div style={{ display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
            <label className="rx-label" style={{ marginBottom:8 }}>Notice Period Buyout</label>
            <div style={{ display:'flex', gap:12, alignItems:'center' }}>
              {['Yes','No'].map(opt => (
                <label key={opt} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13 }}>
                  <input type="radio" name="buyout" value={opt} checked={joining.notice_buyout===(opt==='Yes')}
                    onChange={()=>J('notice_buyout',opt==='Yes')} />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        </div>
        {joining.notice_buyout && (
          <div style={{ ...S.g3, marginBottom:10 }}>
            <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Buyout Amount (₹)</label><input className="rx-input" type="number" min={0} step={1} value={joining.notice_buyout_amount} onChange={e=>J('notice_buyout_amount',e.target.value)} placeholder="e.g. 60000" /></div>
          </div>
        )}
        {joining.proposed_doj && (
          <div style={{ background:TK.brandTint, borderRadius:7, padding:'8px 12px', fontSize:12, color:TK.brandDeep }}>
            Days to join: <strong>{daysDiff(joining.proposed_doj)} days</strong> from today
          </div>
        )}
      </div>

      {/* OFFERED COMPENSATION SUMMARY (read only from negotiation) */}
      <div style={S.card}>
        <SecLine title="Offered Compensation (from Calculator)" />
        {negotiation ? (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            {[
              ['Annual CTC', `₹${fmt(negotiation.offered_ctc || 0)}`],
              ['Monthly In-Hand', `₹${fmt(negotiation.net_monthly || 0)}`],
              ['Hike %', `${Number(negotiation.hike_pct||0).toFixed(1)}%`],
            ].map(([l,v]) => (
              <div key={l} style={{ background:TK.brandTint, borderRadius:10, padding:'10px 12px' }}>
                <div style={{ ...eyebrow }}>{l}</div>
                <div style={{ fontSize:14, fontWeight:500, color:TK.brandDeep, marginTop:2 }}>{v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color:TK.faint, fontSize:12 }}>No CTC negotiation found. Please complete the calculator first.</div>
        )}
      </div>

      {/* HIRING MANAGER REMARK / ADDITIONAL */}
      <div style={S.card}>
        <SecLine title="Hiring Manager — Remark / Additional (e.g. Target)" />
        <input className="rx-input" value={hiringRemark} onChange={e=>setHiringRemark(e.target.value)} placeholder="e.g. Target for the role, special note for HR Head…" />
      </div>

      {/* RECRUITER COMMENTS */}
      <div style={S.card}>
        <SecLine title="Recruiter Comments (Optional)" />
        <textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', minHeight:80 }} value={recruiterComments} onChange={e=>setRecruiterComments(e.target.value)} placeholder="Any additional context for HR Head..." />
      </div>

      {/* CC — everyone picked here receives the same approval mail as the HR Head */}
      <div style={S.card}>
        <SecLine title="CC on the approval mail (optional)" />
        <div style={{ fontSize:11.5, color:TK.faint, marginBottom:8 }}>The HR Head gets the approval mail with the MRF, interview summary and CTC acknowledgement attached. Anyone you add here is CC'd on the same mail.</div>
        <CcPicker value={cc} onChange={setCc} />
      </div>

      {/* ACTIONS */}
      <div style={{ display:'flex', gap:10, marginBottom:16 }}>
        <button onClick={generateTemplate} style={S.btn(TK.brandTint,TK.brandDeep)}>Generate Approval Template
        </button>
        <button onClick={submitForApproval} disabled={saving || !template} style={S.btn(saving||!template?'rgba(37,99,235,0.4)':TK.brand,TK.surface)}>
          {saving ? 'Submitting...' : 'Submit to HR Head'}
        </button>
      </div>

      {/* TEMPLATE PREVIEW — read-only */}
      {showTemplate && (
        <div style={S.card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>Approval Request Preview (read-only)</div>
            <button onClick={()=>setShowTemplate(false)} style={{ ...S.btn(TK.brandTint,TK.faint), padding:'4px 10px', fontSize:11 }}>Hide</button>
          </div>
          <pre style={{ fontFamily:'monospace', fontSize:11, color:TK.inkSoft, background:TK.sunken, borderRadius:7, padding:12, whiteSpace:'pre-wrap', border: `1px solid ${TK.brandEdge}`, maxHeight:500, overflow:'auto', margin:0 }}>
            {template}
          </pre>
          <div style={{ fontSize:11, color:TK.faint, marginTop:6 }}>
            This is a preview of what HR Head will see. To change it, edit the fields above and re-generate.
          </div>
        </div>
      )}
    </div>
  )
}


// HR HEAD: APPROVAL DASHBOARD
// ═══════════════════════════════════════════════════════════════
export function HRHeadApprovalDashboard({ companies, departments, locations, mrfs:mrfLookup, rail }: any = {}) {
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

  async function processApproval() {
    if (action === 'reject' && !comment.trim()) { alert('A rejection reason is required'); return }
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
        const r = await fetch('/api/recruitment/offer-approval', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ action:'decided', request_id: selected.id }) })
        const j = await r.json().catch(() => ({})); notified = Number(j.notified || 0)
      } catch { /* the decision is saved regardless */ }
    }

    setProcessing(false)
    if (error) { alert('Error: ' + error.message); return }
    alert(action === 'approve'
      ? `Approved. ${notified ? `${notified} people notified (recruiter + HR manager) — the offer can now be sent.` : 'Saved — nobody could be notified.'}`
      : `Rejected. ${notified ? `${notified} people notified (recruiter + MRF raiser).` : 'Saved — nobody could be notified.'}`)
    setSelected(null); setComment(''); loadRequests()
  }

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
    <RxPage rail={rail} header={
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
        <div style={{ fontSize:13, fontWeight:600, color:TK.brandDeep, margin:'10px 0 8px' }}>MRF Approvals ({fMrfs.length})</div>
        {fMrfs.length === 0 && (
          <div style={{ ...S.card, textAlign:'center' as const, color:TK.faint, padding:18, fontSize:12 }}>{ql?'No matching MRF':'No MRFs pending approval'}</div>
        )}
        {fMrfs.map(m => (
          <div key={m.id} style={{ ...S.card, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:600 }}>{m.designation || m.position || 'Untitled'}</div>
              <div style={{ fontSize:12, color:TK.faint, marginTop:2 }}>
                {m.companies?.company_name || ''} · {m.no_of_openings || m.openings || 0} openings · {m.employment_type || '—'}{m.experience_required ? ` · ${m.experience_required}` : ''}
              </div>
              {m.skills_required && <div style={{ fontSize:11, color:TK.brandDeep, marginTop:3 }}>Skills: {m.skills_required}</div>}
            </div>
            <div style={{ display:'flex', gap:8, flexShrink:0 }}>
              <button onClick={()=>approveMrf(m.id)} style={S.btn(TK.positive,TK.surface)}>Approve</button>
              <button onClick={()=>rejectMrf(m.id)} style={{ ...S.btn(TK.criticalTint,TK.critical), border: `1px solid ${TK.criticalTint}` }}>Reject</button>
            </div>
          </div>
        ))}
      </div>

      {/* Rehire — re-enter rejected candidates into the pipeline at a chosen stage */}
      <div style={{ marginBottom:22 }}>
        <div style={{ fontSize:13, fontWeight:600, color:TK.brandDeep, margin:'10px 0 8px' }}>Rehire — Rejected Candidates ({fRejected.length})</div>
        {fRejected.length === 0 && (
          <div style={{ ...S.card, textAlign:'center' as const, color:TK.faint, padding:18, fontSize:12 }}>{ql?'No matching candidate':'No rejected candidates'}</div>
        )}
        {fRejected.map(c => (
          <div key={c.id} style={{ ...S.card, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:600 }}>{c.full_name}{(()=>{ const mn=(mrfLookup||[]).find((m:any)=>m.id===c.mrf_id)?.mrf_number; return mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:TK.brandDeep, background:TK.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null })()}{c.blacklisted && <span style={{ fontSize:10, color:TK.critical, marginLeft:8, fontWeight:600 }}>BLACKLISTED</span>}</div>
              <div style={{ fontSize:12, color:TK.faint, marginTop:2 }}>{c.designation || '—'}</div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
              <select value={rehireStage[c.id] || ''} onChange={e=>setRehireStage(m=>({ ...m, [c.id]: e.target.value }))} className="rx-input" style={{ width:160 }}>
                <option value="">Place at stage…</option>
                {REHIRE_STAGES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
              <button onClick={()=>rehire(c, rehireStage[c.id])} style={S.btn(TK.positive,TK.surface)}>Rehire</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize:13, fontWeight:600, color:TK.brandDeep, margin:'4px 0 8px' }}>Offer Approvals</div>
      <div style={{ marginBottom:16 }}>
        <Segmented label="Offer approvals" value={tab}
          onChange={(v:'pending'|'done')=>{ setTab(v); setSelected(null) }}
          options={[{ value:'pending' as const, label:`Pending (${fRequests.length})` },
                    { value:'done' as const,    label:'Approved' }]} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'start' }}>

        {/* Request List */}
        <div>
          {fRequests.length === 0 && (
            <div style={{ ...S.card, textAlign:'center' as const, color:TK.faint, padding:32 }}>
              {ql ? 'No matching candidate' : `No ${tab === 'pending' ? 'pending' : 'approved'} requests`}
            </div>
          )}
          {fRequests.map(r => {
            const [bg, c] = statusColor(r.status)
            return (
              <div key={r.id} onClick={()=>setSelected(r)}
                style={{ ...S.card, cursor:'pointer', border:selected?.id===r.id?`2px solid ${TK.brand}`:`1px solid ${TK.line}`, background:selected?.id===r.id?TK.brandTint: TK.surface }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600 }}>{r.candidates?.full_name}{(()=>{ const mn=(mrfLookup||[]).find((m:any)=>m.id===r.mrf_id)?.mrf_number; return mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:TK.brandDeep, background:TK.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null })()}</div>
                    <div style={{ fontSize:12, color:TK.faint, marginTop:2 }}>{r.candidates?.experience_years}yr · ₹{r.offered_ctc ? fmt(r.offered_ctc) : '—'} CTC</div>
                    <div style={{ fontSize:11, color:TK.brand, marginTop:2 }}>Hike: {r.hike_pct ? Number(r.hike_pct).toFixed(1) + '%' : '—'}</div>
                    {r.submitted_at && <div style={{ fontSize:TF.micro, color:TK.muted, marginTop:SP.xs }}>Submitted: {new Date(r.submitted_at).toLocaleDateString('en-IN')}</div>}
                  </div>
                  <span style={{ fontSize:TF.micro, padding:'3px 9px', borderRadius:R.pill, background:bg, color:c, fontWeight:W.medium, lineHeight:1.45 }}>{r.status.replace('_',' ')}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Detail + Action */}
        {selected && (
          <div>
            {/* Template */}
            <div style={S.card}>
              <div style={{ fontSize:13, fontWeight:500, marginBottom:10 }}>Approval Request</div>
              <pre style={{ fontFamily:'monospace', fontSize:11, color:TK.inkSoft, background:TK.sunken, borderRadius:7, padding:12, overflowX:'auto', whiteSpace:'pre-wrap', border: `1px solid ${TK.brandEdge}`, maxHeight:400, overflow:'auto' }}>
                {selected.template_content || 'Template not available'}
              </pre>
            </div>

            {/* Key Numbers */}
            <div style={S.card}>
              <div style={S.sec}>Key Numbers</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[
                  ['Previous CTC', `₹${selected.prev_total_ctc ? fmt(selected.prev_total_ctc) : '—'}`],
                  ['Offered CTC', `₹${selected.offered_ctc ? fmt(selected.offered_ctc) : '—'}`],
                  ['Hike', `${selected.hike_pct ? Number(selected.hike_pct).toFixed(1) + '%' : '—'}`],
                  ['Days to Join', `${selected.days_to_join || '—'} days`],
                  ['Proposed DOJ', selected.proposed_doj ? new Date(selected.proposed_doj).toLocaleDateString('en-IN') : '—'],
                  ['Notice Period', `${selected.notice_period_days || '—'} days`],
                ].map(([l,v]) => (
                  <div key={l} style={{ background:TK.sunken, borderRadius:7, padding:'9px 12px', border: `1px solid ${TK.brandEdge}` }}>
                    <div style={{ ...eyebrow }}>{l}</div>
                    <div style={{ fontSize:13, fontWeight:500, color:TK.ink, marginTop:2 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Hiring Manager remark / target (#8) */}
            {selected.hiring_manager_remark && (
              <div style={S.card}>
                <div style={S.sec}>Hiring Manager Remark / Target</div>
                <div style={{ fontSize:13, color:TK.ink, whiteSpace:'pre-wrap' }}>{selected.hiring_manager_remark}</div>
              </div>
            )}

            {/* Approval Action */}
            {selected.status === 'SUBMITTED' && (
              <div style={S.cardP}>
                <div style={S.sec}>Your Decision</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
                  <button onClick={()=>setAction('approve')} style={{ ...S.btn(action==='approve'?TK.positiveTint:TK.sunken, action==='approve'?TK.positive:TK.muted), border:action==='approve'?`2px solid ${TK.positive}`:`1px solid ${TK.line}`, padding:12, fontSize:13 }}>Approve
                  </button>
                  <button onClick={()=>setAction('reject')} style={{ ...S.btn(action==='reject'?TK.criticalTint:TK.sunken, action==='reject'?TK.critical:TK.muted), border:action==='reject'?`2px solid ${TK.critical}`:`1px solid ${TK.line}`, padding:12, fontSize:13 }}>Reject
                  </button>
                </div>
                <div style={{ marginBottom:12 }}>
                  <label className="rx-label" style={{ display:'block', marginBottom:6 }}>{action === 'reject' ? 'Rejection Reason *' : 'Comments (Optional)'}</label>
                  <textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', minHeight:80 }} value={comment} onChange={e=>setComment(e.target.value)}
                    placeholder={action === 'reject' ? 'Reason clearly batao...' : 'Optional comments for HR Manager...'} />
                </div>
                <button onClick={processApproval} disabled={processing}
                  style={S.btn(action==='approve'?TK.positive:TK.critical,TK.surface)}>
                  {processing ? 'Processing...' : action === 'approve' ? 'Approve & Notify HR Manager' : 'Reject & Notify Recruiter'}
                </button>
              </div>
            )}

            {/* Already actioned */}
            {selected.status === 'HR_HEAD_APPROVED' && (
              <div style={{ background:TK.positiveTint, border: `1px solid ${TK.positiveTint}`, borderRadius:10, padding:14 }}>
                <div style={{ fontSize:13, fontWeight:500, color:TK.positive, marginBottom:4 }}>Approved</div>
                {selected.hr_head_comments && <div style={{ fontSize:12, color:TK.inkSoft }}>{selected.hr_head_comments}</div>}
                <div style={{ fontSize:11, color:TK.faint, marginTop:4 }}>
                  {selected.hr_head_actioned_at ? new Date(selected.hr_head_actioned_at).toLocaleDateString('en-IN') : ''}
                </div>
                <div style={{ fontSize:12, color:TK.positive, fontWeight:500, marginTop:8 }}>
                  The HR Manager has been notified — sending the offer letter is still pending
                </div>
              </div>
            )}
          </div>
        )}
      </div>
        </div>
      </div>
    </RxPage>
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

  useEffect(() => {
    supabase.from('offer_approval_requests')
      .select('*, candidates(full_name, email, phone, designation, experience_years, current_company, mrf_id), companies(company_name, company_code), manpower_requisitions(designation), ctc_negotiations(basic_monthly, hra_monthly, net_monthly, variable_pct)')
      .eq('status','HR_HEAD_APPROVED')
      .order('hr_head_actioned_at',{ ascending:false })
      // A scoped hiring manager only sees offers for candidates under the MRFs assigned to
      // them; `allowedMrfIds` is null for oversight roles (no filter).
      .then(({ data }) => setApproved((data || []).filter((r: any) => !allowedMrfIds || (r.candidates?.mrf_id && allowedMrfIds.has(r.candidates.mrf_id)))))
  }, [allowedMrfIds])

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
        headers: { 'Content-Type': 'application/json' },
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
    <RxPage rail={rail} header={
      <RecruitmentHeader
        title="Send offer letters"
        subtitle="Requests the HR Head has approved. Review the letter, then send it to the candidate."
        help={<Help label="Who appears here">
          <p>Only requests already <b>approved by the HR Head</b>. Nothing reaches this list before that.</p>
          <p>Sending emails the letter, records it, and moves the candidate to <b>Offer Sent</b>.</p>
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
        <div className="s4">
          {fApproved.length === 0 && (
            <div style={{ ...S.card, textAlign:'center' as const, color:TK.faint, padding:32 }}>
              {sql ? 'No matching candidate' : 'No approved requests pending'}
            </div>
          )}
          {fApproved.map(r => (
            <div key={r.id} onClick={() => prepareOffer(r)}
              style={{ ...S.card, cursor:'pointer', border:selected?.id===r.id?`2px solid ${TK.brand}`:`1px solid ${TK.line}`, background:selected?.id===r.id?TK.brandTint: TK.surface }}>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:3 }}>{r.candidates?.full_name}{(()=>{ const mn=(mrfLookup||[]).find((m:any)=>m.id===r.mrf_id)?.mrf_number; return mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:TK.brandDeep, background:TK.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null })()}</div>
              <div style={{ fontSize:12, color:TK.faint }}>
                {r.candidates?.experience_years}yr · ₹{r.offered_ctc ? fmt(r.offered_ctc) : '—'} · Hike {r.hike_pct ? Number(r.hike_pct).toFixed(1) + '%' : '—'}
              </div>
              <div style={{ fontSize:11, color:TK.positive, marginTop:4 }}>
                HR Head approved on {r.hr_head_actioned_at ? new Date(r.hr_head_actioned_at).toLocaleDateString('en-IN') : '—'}
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div className="s8" style={S.cardP}>
            <div style={{ fontSize:13, fontWeight:500, color:TK.brandDeep, marginBottom:12 }}>Send Offer Letter — {selected.candidates?.full_name}{(()=>{ const mn=(mrfLookup||[]).find((m:any)=>m.id===selected.mrf_id)?.mrf_number; return mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:TK.brandDeep, background:TK.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null })()}</div>
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
            <div style={{ background:TK.brandTint, borderRadius:7, padding:'8px 12px', marginBottom:12, fontSize:11, color:TK.brandDeep }}>
              This emails the offer letter to the candidate via Gmail, records it, and marks the candidate <b>Offer Sent</b> in the pipeline.
            </div>
            <button onClick={sendOffer} disabled={sending}
              style={{ ...S.btn(TK.brand,TK.surface), width:'100%', padding:11, fontSize:13 }}>
              {sending ? 'Sending…' : 'Send Offer & Mark as Sent'}
            </button>
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

  return (
    <div style={S.card}>
      <div style={{ fontSize:13, fontWeight:500, marginBottom:12 }}>Audit Trail</div>
      {logs.length === 0 && <div style={{ color:TK.faint, fontSize:12 }}>No audit logs yet</div>}
      {logs.map((log, i) => {
        const [icon, label] = actionLabel[log.action_type] || ['', log.action_type]
        return (
          <div key={log.id} style={{ display:'flex', gap:10, paddingBottom:12, borderBottom: i<logs.length-1 ? `1px solid ${TK.line}` : 'none', marginBottom:i<logs.length-1?12:0 }}>
            <div style={{ width:28, height:28, borderRadius:99, background:TK.brandTint, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, flexShrink:0 }}>{icon}</div>
            <div>
              <div style={{ fontSize:12, fontWeight:500, color:TK.ink }}>{label}</div>
              {log.actor_email && <div style={{ fontSize:11, color:TK.faint, marginTop:1 }}>By: {log.actor_email}</div>}
              <div style={{ fontSize:TF.micro, color:TK.muted, marginTop:1 }}>{new Date(log.created_at).toLocaleString('en-IN')}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
