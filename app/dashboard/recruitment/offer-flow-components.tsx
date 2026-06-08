'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// ── STYLES ───────────────────────────────────────────────────────
const S = {
  page: { background:'#F5F3FF', minHeight:'100vh', fontFamily:'"DM Sans","Segoe UI",sans-serif', color:'#1E1B4B' } as React.CSSProperties,
  card: { background:'#fff', borderRadius:10, border:'1px solid rgba(124,58,237,0.12)', padding:'14px 16px', marginBottom:12, boxShadow:'0 1px 4px rgba(124,58,237,0.05)' } as React.CSSProperties,
  cardP: { background:'#fff', borderRadius:10, border:'1.5px solid #7C3AED', padding:'14px 16px', marginBottom:12 } as React.CSSProperties,
  label: { fontSize:11, fontWeight:600 as const, color:'#6D28D9', textTransform:'uppercase' as const, letterSpacing:'.05em', display:'block', marginBottom:4 },
  input: { width:'100%', padding:'8px 10px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  select: { width:'100%', padding:'8px 10px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  textarea: { width:'100%', padding:'9px 11px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', resize:'vertical' as const, fontFamily:'inherit', boxSizing:'border-box' as const },
  btn: (bg: string, c: string) => ({ padding:'8px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600 as const, fontFamily:'inherit', background:bg, color:c, whiteSpace:'nowrap' as const }) as React.CSSProperties,
  g2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 } as React.CSSProperties,
  g3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 } as React.CSSProperties,
  sec: { fontSize:10, fontWeight:600 as const, color:'#7C3AED', textTransform:'uppercase' as const, letterSpacing:'.06em', display:'flex', alignItems:'center', gap:8, marginBottom:10, marginTop:4 } as React.CSSProperties,
}
const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
const daysDiff = (d: string) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000))

function SecLine({ title }: { title: string }) {
  return (
    <div style={S.sec}>
      {title} <div style={{ flex:1, height:1, background:'#EDE9FE' }} />
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

  // Previous employer form
  const [prevForm, setPrevForm] = useState({
    prev_company_name: negotiation?.prev_company_name || '',
    prev_company_address: negotiation?.prev_company_address || '',
    prev_total_ctc: negotiation?.prev_total_ctc || '',
    prev_fixed_ctc: '',
    prev_variable: negotiation?.prev_variable || '',
    prev_ta_da: '',
    prev_additional: '',
  })

  // Joining details
  const [joining, setJoining] = useState({
    proposed_doj: negotiation?.proposed_doj || '',
    notice_period_days: candidate?.notice_period || '',
    notice_buyout: false,
  })

  const [recruiterComments, setRecruiterComments] = useState('')
  const P = (k: string, v: any) => setPrevForm(f => ({ ...f, [k]: v }))
  const J = (k: string, v: any) => setJoining(f => ({ ...f, [k]: v }))

  function generateTemplate() {
    const doj = joining.proposed_doj
    const daysToJoin = doj ? daysDiff(doj) : '—'
    const hike = negotiation?.hike_pct ? Number(negotiation.hike_pct).toFixed(1) : '—'
    const docsCount = negotiation?.documents_count || 'pending'

    const tmpl = `OFFER APPROVAL REQUEST — CONFIDENTIAL
${'─'.repeat(50)}
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
  Notice Buyout:     ${joining.notice_buyout ? 'Yes' : 'No'}

DOCUMENTS STATUS:    ${docsCount} document(s) received
BGV STATUS:          Pending

${recruiterComments ? `Recruiter Comments:\n  ${recruiterComments}` : ''}
${'─'.repeat(50)}
This document is confidential and for internal approval only.`
    setTemplate(tmpl)
    setShowTemplate(true)
  }

  async function submitForApproval() {
    if (!prevForm.prev_company_name || !prevForm.prev_total_ctc) {
      alert('Previous company name aur CTC zaroori hai')
      return
    }
    if (!joining.proposed_doj) {
      alert('Proposed DOJ zaroori hai')
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

    // Create offer approval request
    const { error } = await supabase.from('offer_approval_requests').insert({
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
    })

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
    alert('Offer approval request submitted to HR Head!')
    if (onSubmitted) onSubmitted()
  }

  return (
    <div style={{ maxWidth:700, margin:'0 auto', padding:16 }}>
      <div style={{ fontSize:16, fontWeight:600, color:'#1E1B4B', marginBottom:4 }}>Create Offer Approval Request</div>
      <div style={{ fontSize:12, color:'#9CA3AF', marginBottom:16 }}>
        {candidate?.full_name} — {mrf?.designation}
      </div>

      {/* PREVIOUS EMPLOYER SECTION */}
      <div style={S.cardP}>
        <SecLine title="Previous Employer Details" />
        <div style={{ fontSize:11, color:'#6D28D9', background:'#EDE9FE', borderRadius:6, padding:'6px 10px', marginBottom:12 }}>
          This section is confidential — NOT shown to candidate. Only visible in HR approval request.
        </div>
        <div style={{ ...S.g2, marginBottom:10 }}>
          <div><label style={S.label}>Previous Company Name *</label><input style={S.input} value={prevForm.prev_company_name} onChange={e=>P('prev_company_name',e.target.value)} placeholder="e.g. Amazon India Pvt Ltd" /></div>
          <div><label style={S.label}>Previous Company Address</label><input style={S.input} value={prevForm.prev_company_address} onChange={e=>P('prev_company_address',e.target.value)} placeholder="City, State" /></div>
        </div>
        <div style={{ ...S.g3, marginBottom:10 }}>
          <div><label style={S.label}>Previous Total CTC (₹) *</label><input style={S.input} type="number" value={prevForm.prev_total_ctc} onChange={e=>P('prev_total_ctc',e.target.value)} placeholder="Annual" /></div>
          <div><label style={S.label}>Fixed CTC (₹)</label><input style={S.input} type="number" value={prevForm.prev_fixed_ctc} onChange={e=>P('prev_fixed_ctc',e.target.value)} /></div>
          <div><label style={S.label}>Variable (₹ Annual)</label><input style={S.input} type="number" value={prevForm.prev_variable} onChange={e=>P('prev_variable',e.target.value)} /></div>
        </div>
        <div style={{ ...S.g2, marginBottom:10 }}>
          <div><label style={S.label}>TA / DA (₹ Monthly)</label><input style={S.input} type="number" value={prevForm.prev_ta_da} onChange={e=>P('prev_ta_da',e.target.value)} placeholder="0 if not applicable" /></div>
          <div><label style={S.label}>Any Additional Payment</label><input style={S.input} value={prevForm.prev_additional} onChange={e=>P('prev_additional',e.target.value)} placeholder="e.g. Car allowance, Retention" /></div>
        </div>
      </div>

      {/* JOINING DETAILS */}
      <div style={S.card}>
        <SecLine title="Joining Details" />
        <div style={{ ...S.g3, marginBottom:10 }}>
          <div><label style={S.label}>Proposed Date of Joining *</label><input style={S.input} type="date" value={joining.proposed_doj} onChange={e=>J('proposed_doj',e.target.value)} /></div>
          <div><label style={S.label}>Notice Period (Days)</label><input style={S.input} type="number" value={joining.notice_period_days} onChange={e=>J('notice_period_days',e.target.value)} /></div>
          <div style={{ display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
            <label style={{ ...S.label, marginBottom:8 }}>Notice Period Buyout</label>
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
        {joining.proposed_doj && (
          <div style={{ background:'#EDE9FE', borderRadius:7, padding:'8px 12px', fontSize:12, color:'#4C1D95' }}>
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
              <div key={l} style={{ background:'#F3F0FF', borderRadius:8, padding:'10px 12px' }}>
                <div style={{ fontSize:10, color:'#9CA3AF' }}>{l}</div>
                <div style={{ fontSize:14, fontWeight:500, color:'#4C1D95', marginTop:2 }}>{v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color:'#9CA3AF', fontSize:12 }}>No CTC negotiation found. Please complete the calculator first.</div>
        )}
      </div>

      {/* RECRUITER COMMENTS */}
      <div style={S.card}>
        <SecLine title="Recruiter Comments (Optional)" />
        <textarea style={{ ...S.textarea, minHeight:80 }} value={recruiterComments} onChange={e=>setRecruiterComments(e.target.value)} placeholder="Any additional context for HR Head..." />
      </div>

      {/* ACTIONS */}
      <div style={{ display:'flex', gap:10, marginBottom:16 }}>
        <button onClick={generateTemplate} style={S.btn('#EDE9FE','#4C1D95')}>
          🤖 Generate Approval Template
        </button>
        <button onClick={submitForApproval} disabled={saving || !template} style={S.btn(saving||!template?'rgba(124,58,237,0.4)':'#7C3AED','#fff')}>
          {saving ? 'Submitting...' : '📤 Submit to HR Head'}
        </button>
      </div>

      {/* TEMPLATE PREVIEW */}
      {showTemplate && (
        <div style={S.card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>Approval Request Template (Editable)</div>
            <button onClick={()=>setShowTemplate(false)} style={{ ...S.btn('#F3F0FF','#9CA3AF'), padding:'4px 10px', fontSize:11 }}>Hide</button>
          </div>
          <textarea style={{ ...S.textarea, minHeight:500, fontFamily:'monospace', fontSize:11 }}
            value={template} onChange={e=>setTemplate(e.target.value)} />
          <div style={{ fontSize:11, color:'#9CA3AF', marginTop:6 }}>
            You can edit the template before submitting. All changes will be saved.
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// HR HEAD: APPROVAL DASHBOARD
// ═══════════════════════════════════════════════════════════════
export function HRHeadApprovalDashboard() {
  const supabase = createClient()
  const [requests, setRequests] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [action, setAction] = useState<'approve'|'reject'>('approve')
  const [comment, setComment] = useState('')
  const [processing, setProcessing] = useState(false)
  const [tab, setTab] = useState<'pending'|'done'>('pending')

  useEffect(() => { loadRequests() }, [tab])

  async function loadRequests() {
    const { data } = await supabase.from('offer_approval_requests')
      .select('*, candidates(full_name, email, phone, experience_years, current_company)')
      .eq('status', tab === 'pending' ? 'SUBMITTED' : 'HR_HEAD_APPROVED')
      .order('submitted_at', { ascending: false })
    setRequests(data || [])
  }

  async function processApproval() {
    if (action === 'reject' && !comment.trim()) { alert('Rejection reason zaroori hai'); return }
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

    setProcessing(false)
    if (error) { alert('Error: ' + error.message); return }
    alert(action === 'approve' ? 'Approved! HR Manager ko notification gaya.' : 'Rejected. Recruiter ko notification gaya.')
    setSelected(null); setComment(''); loadRequests()
  }

  const statusColor = (s: string) => ({
    SUBMITTED: ['#EFF6FF','#1D4ED8'],
    HR_HEAD_APPROVED: ['#ECFDF5','#059669'],
    HR_HEAD_REJECTED: ['#FEF2F2','#DC2626'],
    OFFER_SENT: ['#F3F0FF','#7C3AED'],
  }[s] || ['#F9FAFB','#6B7280'])

  return (
    <div style={{ maxWidth:1100, margin:'0 auto', padding:16 }}>
      <div style={{ fontSize:16, fontWeight:600, marginBottom:4 }}>HR Head — Offer Approvals</div>
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {(['pending','done'] as const).map(t => (
          <button key={t} onClick={()=>{setTab(t);setSelected(null)}}
            style={{ ...S.btn(tab===t?'#7C3AED':'#fff', tab===t?'#fff':'#6B7280'), border: tab===t?'none':'1px solid #DDD6FE' }}>
            {t === 'pending' ? '⏳ Pending Approval' : '✅ Approved'}
          </button>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'start' }}>

        {/* Request List */}
        <div>
          {requests.length === 0 && (
            <div style={{ ...S.card, textAlign:'center' as const, color:'#9CA3AF', padding:32 }}>
              No {tab === 'pending' ? 'pending' : 'approved'} requests
            </div>
          )}
          {requests.map(r => {
            const [bg, c] = statusColor(r.status)
            return (
              <div key={r.id} onClick={()=>setSelected(r)}
                style={{ ...S.card, cursor:'pointer', border:selected?.id===r.id?'1.5px solid #7C3AED':'1px solid rgba(124,58,237,0.12)', background:selected?.id===r.id?'#F3F0FF':'#fff' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600 }}>{r.candidates?.full_name}</div>
                    <div style={{ fontSize:12, color:'#9CA3AF', marginTop:2 }}>{r.candidates?.experience_years}yr · ₹{r.offered_ctc ? fmt(r.offered_ctc) : '—'} CTC</div>
                    <div style={{ fontSize:11, color:'#7C3AED', marginTop:2 }}>Hike: {r.hike_pct ? Number(r.hike_pct).toFixed(1) + '%' : '—'}</div>
                    {r.submitted_at && <div style={{ fontSize:10, color:'#9CA3AF', marginTop:3 }}>Submitted: {new Date(r.submitted_at).toLocaleDateString('en-IN')}</div>}
                  </div>
                  <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:bg, color:c, fontWeight:500 }}>{r.status.replace('_',' ')}</span>
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
              <pre style={{ fontFamily:'monospace', fontSize:11, color:'#374151', background:'#F9FAFB', borderRadius:7, padding:12, overflowX:'auto', whiteSpace:'pre-wrap', border:'1px solid #EDE9FE', maxHeight:400, overflow:'auto' }}>
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
                  <div key={l} style={{ background:'#F9FAFB', borderRadius:7, padding:'9px 12px', border:'1px solid #EDE9FE' }}>
                    <div style={{ fontSize:10, color:'#9CA3AF' }}>{l}</div>
                    <div style={{ fontSize:13, fontWeight:500, color:'#1E1B4B', marginTop:2 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Approval Action */}
            {selected.status === 'SUBMITTED' && (
              <div style={S.cardP}>
                <div style={S.sec}>Your Decision</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
                  <button onClick={()=>setAction('approve')} style={{ ...S.btn(action==='approve'?'#ECFDF5':'#F9FAFB', action==='approve'?'#059669':'#6B7280'), border:action==='approve'?'1.5px solid #059669':'1px solid #E5E7EB', padding:12, fontSize:13 }}>
                    ✅ Approve
                  </button>
                  <button onClick={()=>setAction('reject')} style={{ ...S.btn(action==='reject'?'#FEF2F2':'#F9FAFB', action==='reject'?'#DC2626':'#6B7280'), border:action==='reject'?'1.5px solid #DC2626':'1px solid #E5E7EB', padding:12, fontSize:13 }}>
                    ❌ Reject
                  </button>
                </div>
                <div style={{ marginBottom:12 }}>
                  <label style={S.label}>{action === 'reject' ? 'Rejection Reason *' : 'Comments (Optional)'}</label>
                  <textarea style={{ ...S.textarea, minHeight:80 }} value={comment} onChange={e=>setComment(e.target.value)}
                    placeholder={action === 'reject' ? 'Reason clearly batao...' : 'Optional comments for HR Manager...'} />
                </div>
                <button onClick={processApproval} disabled={processing}
                  style={S.btn(action==='approve'?'#059669':'#DC2626','#fff')}>
                  {processing ? 'Processing...' : action === 'approve' ? 'Approve & Notify HR Manager' : 'Reject & Notify Recruiter'}
                </button>
              </div>
            )}

            {/* Already actioned */}
            {selected.status === 'HR_HEAD_APPROVED' && (
              <div style={{ background:'#ECFDF5', border:'1px solid #A7F3D0', borderRadius:10, padding:14 }}>
                <div style={{ fontSize:13, fontWeight:500, color:'#059669', marginBottom:4 }}>✅ Approved</div>
                {selected.hr_head_comments && <div style={{ fontSize:12, color:'#374151' }}>{selected.hr_head_comments}</div>}
                <div style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>
                  {selected.hr_head_actioned_at ? new Date(selected.hr_head_actioned_at).toLocaleDateString('en-IN') : ''}
                </div>
                <div style={{ fontSize:12, color:'#059669', fontWeight:500, marginTop:8 }}>
                  HR Manager ko notification bheja gaya — offer letter bhejna pending hai
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// HR MANAGER: SEND OFFER LETTER
// ═══════════════════════════════════════════════════════════════
export function HRManagerSendOffer() {
  const supabase = createClient()
  const [approved, setApproved] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [toEmail, setToEmail] = useState('')
  const [ccEmails, setCcEmails] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    supabase.from('offer_approval_requests')
      .select('*, candidates(full_name, email, phone, designation, experience_years, current_company), companies(company_name, company_code), manpower_requisitions(designation), ctc_negotiations(basic_monthly, hra_monthly, net_monthly, variable_pct)')
      .eq('status','HR_HEAD_APPROVED')
      .order('hr_head_actioned_at',{ ascending:false })
      .then(({ data }) => setApproved(data || []))
  }, [])

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
    await supabase.from('candidates').update({ stage: 'Offer Sent' }).eq('id', selected.candidate_id)

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

  return (
    <div style={{ maxWidth:900, margin:'0 auto', padding:16 }}>
      <div style={{ fontSize:16, fontWeight:600, marginBottom:4 }}>HR Manager — Send Offer Letters</div>
      <div style={{ fontSize:12, color:'#9CA3AF', marginBottom:16 }}>HR Head approved requests — offer letter send karo</div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'start' }}>
        <div>
          {approved.length === 0 && (
            <div style={{ ...S.card, textAlign:'center' as const, color:'#9CA3AF', padding:32 }}>
              No approved requests pending
            </div>
          )}
          {approved.map(r => (
            <div key={r.id} onClick={() => prepareOffer(r)}
              style={{ ...S.card, cursor:'pointer', border:selected?.id===r.id?'1.5px solid #7C3AED':'1px solid rgba(124,58,237,0.12)', background:selected?.id===r.id?'#F3F0FF':'#fff' }}>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:3 }}>{r.candidates?.full_name}</div>
              <div style={{ fontSize:12, color:'#9CA3AF' }}>
                {r.candidates?.experience_years}yr · ₹{r.offered_ctc ? fmt(r.offered_ctc) : '—'} · Hike {r.hike_pct ? Number(r.hike_pct).toFixed(1) + '%' : '—'}
              </div>
              <div style={{ fontSize:11, color:'#059669', marginTop:4 }}>
                HR Head approved on {r.hr_head_actioned_at ? new Date(r.hr_head_actioned_at).toLocaleDateString('en-IN') : '—'}
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div style={S.cardP}>
            <div style={{ fontSize:13, fontWeight:500, color:'#6D28D9', marginBottom:12 }}>Send Offer Letter — {selected.candidates?.full_name}</div>
            <div style={{ marginBottom:8 }}>
              <label style={S.label}>To *</label>
              <input style={S.input} value={toEmail} onChange={e=>setToEmail(e.target.value)} />
            </div>
            <div style={{ marginBottom:8 }}>
              <label style={S.label}>CC (comma separated)</label>
              <input style={S.input} value={ccEmails} onChange={e=>setCcEmails(e.target.value)} placeholder="hr@company.com, md@company.com" />
            </div>
            <div style={{ marginBottom:8 }}>
              <label style={S.label}>Subject</label>
              <input style={S.input} value={subject} onChange={e=>setSubject(e.target.value)} />
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={S.label}>Email Body</label>
              <textarea style={{ ...S.textarea, minHeight:280 }} value={body} onChange={e=>setBody(e.target.value)} />
            </div>
            <div style={{ background:'#F3F0FF', borderRadius:7, padding:'8px 12px', marginBottom:12, fontSize:11, color:'#4C1D95' }}>
              This emails the offer letter to the candidate via Gmail, records it, and marks the candidate <b>Offer Sent</b> in the pipeline.
            </div>
            <button onClick={sendOffer} disabled={sending}
              style={{ ...S.btn('#7C3AED','#fff'), width:'100%', padding:11, fontSize:13 }}>
              {sending ? 'Sending…' : '📤 Send Offer & Mark as Sent'}
            </button>
          </div>
        )}
      </div>
    </div>
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
    DOC_LINK_CREATED:          ['🔗','Document link created'],
    DOCUMENT_UPLOADED:         ['📄','Document uploaded'],
    DOCUMENTS_SUBMITTED:       ['✅','All documents submitted'],
    SALARY_LINK_SENT:          ['💰','Salary calculator link sent'],
    CANDIDATE_INTERESTED:      ['👍','Candidate confirmed interest'],
    OFFER_APPROVAL_REQUESTED:  ['📋','Offer approval request submitted'],
    HR_HEAD_APPROVED:          ['✅','HR Head approved'],
    HR_HEAD_REJECTED:          ['❌','HR Head rejected'],
    OFFER_LETTER_SENT:         ['📤','Offer letter sent'],
    OFFER_ACCEPTED_DIGITAL:    ['🎉','Offer accepted digitally'],
    OFFER_ACCEPTED_UPLOAD:     ['🎉','Signed copy uploaded'],
  }

  return (
    <div style={S.card}>
      <div style={{ fontSize:13, fontWeight:500, marginBottom:12 }}>Audit Trail</div>
      {logs.length === 0 && <div style={{ color:'#9CA3AF', fontSize:12 }}>No audit logs yet</div>}
      {logs.map((log, i) => {
        const [icon, label] = actionLabel[log.action_type] || ['📌', log.action_type]
        return (
          <div key={log.id} style={{ display:'flex', gap:10, paddingBottom:12, borderBottom: i<logs.length-1 ? '1px solid #F3F0FF' : 'none', marginBottom:i<logs.length-1?12:0 }}>
            <div style={{ width:28, height:28, borderRadius:99, background:'#EDE9FE', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, flexShrink:0 }}>{icon}</div>
            <div>
              <div style={{ fontSize:12, fontWeight:500, color:'#1E1B4B' }}>{label}</div>
              {log.actor_email && <div style={{ fontSize:11, color:'#9CA3AF', marginTop:1 }}>By: {log.actor_email}</div>}
              <div style={{ fontSize:10, color:'#9CA3AF', marginTop:1 }}>{new Date(log.created_at).toLocaleString('en-IN')}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
