'use client'
// components/recruitment/InterviewFeedbackForm.tsx
//
// The interview feedback form, used in two places from one definition:
//   • mode="fill"  — an interviewer fills it from ESS → Tasks & Approvals.
//   • mode="view"  — the hiring manager reads back what an interviewer recorded,
//                    inside the candidate popup.
//
// Eight parameters, each rated 1–10 with an optional per-parameter remark, one
// mandatory written assessment, and a DECISION — Hold / Reject / Shortlist —
// where Hold and Reject require a remark. The score is out of 80
// and lands in a band so two interviewers on the same round can be compared at
// a glance. Same parameter set for every round — that is the whole point: the
// numbers are only comparable if everyone answers the same questions.

import { useMemo, useState } from 'react'
import { type Decision, DECISION_LABEL } from '@/lib/recruitment/interview-decision'

const C = {
  navy:'#1E1B4B', purple:'#7C3AED', pdark:'#3C3489', card:'#FFFFFF', bg:'#F5F3FF',
  line:'#E9E7F5', muted:'#6B6890', faint:'#9C99B8', ok:'#059669', okbg:'#ECFDF5',
  warn:'#D97706', warnbg:'#FFFBEB', dang:'#DC2626', dangbg:'#FEF2F2', info:'#2563EB', infobg:'#EFF6FF',
}
const font = '"DM Sans","Segoe UI",sans-serif'

export const FEEDBACK_PARAMS = [
  { k:'TECH',  n:'Technical / Functional Knowledge',    d:'Depth in the skills this role actually needs' },
  { k:'EXP',   n:'Relevant Experience',                 d:'How closely past work maps to this position' },
  { k:'PROB',  n:'Problem Solving & Analytical Ability', d:'How they break down and reason through a problem' },
  { k:'COMM',  n:'Communication & Articulation',        d:'Clarity of expression, listening, structure of answers' },
  { k:'OWN',   n:'Ownership & Accountability',          d:'Drives things to closure, owns outcomes and mistakes' },
  { k:'TEAM',  n:'Team Fit & Collaboration',            d:'Works with others, aligns with how this team operates' },
  { k:'LEARN', n:'Learning Agility & Adaptability',     d:'Picks up new things, handles change and ambiguity' },
  { k:'STAB',  n:'Stability & Intent',                  d:'Job-change pattern, and genuine interest in this role' },
] as const

// Legacy recommendations (pre-decision feedback) still display in view mode via `recommendation`.

export interface Feedback {
  params: Record<string, number>
  remarks: Record<string, string>
  overall: string
  recommendation: string
  total: number
  pct: number
  band: string
  decision?: Decision | null
  decision_remark?: string | null
}
const DECISION_COLOR: Record<Decision, string> = { HOLD: C.warn, REJECT: C.dang, SHORTLIST: C.ok }
const RECOMM_FOR: Record<Decision, string> = { HOLD: 'Borderline — needs another view', REJECT: 'Do Not Recommend', SHORTLIST: 'Recommend' }

export function bandOf(pct: number): [string, string] {
  if (pct >= 80) return ['Strong Hire', C.ok]
  if (pct >= 65) return ['Hire', C.info]
  if (pct >= 50) return ['Borderline', C.warn]
  return ['No Hire', C.dang]
}
const tone = (v: number) => (v >= 8 ? C.ok : v >= 5 ? C.warn : C.dang)

export function scoreFeedback(params: Record<string, number>) {
  const total = FEEDBACK_PARAMS.reduce((a, p) => a + (params[p.k] || 0), 0)
  const pct = Math.round((total / 80) * 100)
  return { total, pct, band: bandOf(pct)[0] }
}

export default function InterviewFeedbackForm({
  candidate, round, mode, initial, submitting, onSubmit, onClose, questions,
}: {
  candidate: { name: string; sub?: string; ai_score?: number | null }
  round: string
  mode: 'fill' | 'view'
  initial?: Feedback | null
  submitting?: boolean
  onSubmit?: (f: Feedback) => void
  onClose?: () => void
  /** The MRF's "questions to ask" — shown above the parameters while filling. */
  questions?: string[] | null
}) {
  const [params, setParams] = useState<Record<string, number>>(initial?.params || {})
  const [remarks, setRemarks] = useState<Record<string, string>>(initial?.remarks || {})
  const [overall, setOverall] = useState(initial?.overall || '')
  const [recomm] = useState(initial?.recommendation || '')
  const [pending, setPending] = useState<Decision | null>(null)     // decision chosen, remark being typed
  const [dRemark, setDRemark] = useState(initial?.decision_remark || '')
  const [err, setErr] = useState<string | null>(null)
  const readOnly = mode === 'view'

  const { total, pct, band } = useMemo(() => scoreFeedback(params), [params])
  const done = FEEDBACK_PARAMS.filter(p => params[p.k]).length
  const [bandLabel, bandColor] = bandOf(pct)

  const set = (k: string, v: number) => !readOnly && setParams(p => ({ ...p, [k]: v }))
  const setRem = (k: string, v: string) => !readOnly && setRemarks(r => ({ ...r, [k]: v }))

  // Scores + written assessment must be complete before any decision button works.
  function ready(): boolean {
    const missing = FEEDBACK_PARAMS.filter(p => !params[p.k])
    if (missing.length) { setErr(`${missing.length} parameter(s) not rated — all 8 must be rated.`); return false }
    if (!overall.trim()) { setErr('Detailed feedback is mandatory.'); return false }
    setErr(null); return true
  }
  function choose(d: Decision) {
    if (!ready()) return
    if (d === 'SHORTLIST') { finish(d); return }
    setPending(d)              // Hold / Reject: ask for the remark first
  }
  function finish(d: Decision) {
    const remark = dRemark.trim()
    if (d !== 'SHORTLIST' && !remark) { setErr(`A remark is required to ${d === 'HOLD' ? 'put the candidate on hold' : 'reject the candidate'}.`); return }
    setErr(null)
    onSubmit?.({ params, remarks, overall: overall.trim(), recommendation: RECOMM_FOR[d], total, pct, band, decision: d, decision_remark: remark || null })
  }

  const label: React.CSSProperties = { fontSize:11, fontWeight:700, color:C.muted, marginBottom:4, display:'block' }

  return (
    <div style={{ fontFamily:font, color:C.navy, display:'grid', gridTemplateColumns:'1fr 300px', gap:14, alignItems:'start' }}>
      {/* left — the form */}
      <div style={{ minWidth:0 }}>
        {/* candidate strip */}
        <div style={{ display:'flex', gap:12, alignItems:'center', background:C.card, border:`1px solid ${C.line}`, borderRadius:12, padding:12, marginBottom:12 }}>
          <div style={{ width:40, height:40, borderRadius:11, background:C.purple, color:'#fff', display:'grid', placeItems:'center', fontWeight:800, fontSize:14, flexShrink:0 }}>
            {candidate.name.split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, fontSize:14 }}>{candidate.name}</div>
            <div style={{ fontSize:12, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{[round, candidate.sub].filter(Boolean).join(' · ')}</div>
          </div>
          {candidate.ai_score != null && (
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:C.muted, fontWeight:700 }}>AI MATCH</div>
              <div style={{ fontSize:18, fontWeight:800, color:C.ok }}>{candidate.ai_score}%</div>
            </div>
          )}
        </div>

        {/* questions the MRF raiser wants asked */}
        {!readOnly && Array.isArray(questions) && questions.length > 0 && (
          <div style={{ background:C.infobg, border:`1px solid ${C.info}33`, borderRadius:12, padding:'12px 16px', marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:800, letterSpacing:.4, textTransform:'uppercase', color:C.info, marginBottom:8 }}>Questions to ask — from the requisition</div>
            <ol style={{ margin:0, paddingLeft:18, display:'grid', gap:4 }}>
              {questions.map((q, i) => <li key={i} style={{ fontSize:12.5, color:C.navy, lineHeight:1.5 }}>{q}</li>)}
            </ol>
          </div>
        )}

        {/* parameters */}
        <div style={{ background:C.card, border:`1px solid ${C.line}`, borderRadius:12, padding:16, marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:800, letterSpacing:.4, textTransform:'uppercase', color:C.muted }}>Rate all 8 parameters</div>
            <span style={{ fontSize:10, fontWeight:800, padding:'2px 9px', borderRadius:20, background: done===8?C.okbg:C.bg, color: done===8?C.ok:C.muted, border: done===8?'none':`1px solid ${C.line}` }}>{done} of 8 rated</span>
          </div>
          {FEEDBACK_PARAMS.map((p, i) => {
            const v = params[p.k]
            return (
              <div key={p.k} style={{ border:`1px solid ${v?tone(v)+'55':C.line}`, borderRadius:11, padding:13, marginBottom:10, background: v?'#FCFBFF':C.card }}>
                <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                  <div style={{ width:24, height:24, borderRadius:7, background: v?C.ok:C.bg, color: v?'#fff':C.muted, display:'grid', placeItems:'center', fontSize:11, fontWeight:800, flexShrink:0 }}>{v?'✓':i+1}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:13 }}>{p.n}</div>
                    <div style={{ fontSize:11, color:C.muted }}>{p.d}</div>
                  </div>
                  <div style={{ fontSize:20, fontWeight:800, minWidth:48, textAlign:'right', color: v?tone(v):C.faint }}>{v?`${v}/10`:'—'}</div>
                </div>
                <div style={{ display:'flex', gap:4, marginTop:10, flexWrap:'wrap' }}>
                  {Array.from({length:10},(_,n)=>n+1).map(n=>(
                    <button key={n} type="button" disabled={readOnly} onClick={()=>set(p.k,n)}
                      style={{ flex:1, minWidth:28, height:32, borderRadius:7, fontFamily:font, fontSize:12, fontWeight:700, cursor:readOnly?'default':'pointer',
                        border: v===n?'1px solid transparent':`1px solid ${C.line}`, background: v===n?tone(n):C.card, color: v===n?'#fff':C.muted }}>{n}</button>
                  ))}
                </div>
                {!readOnly ? (
                  <input value={remarks[p.k]||''} onChange={e=>setRem(p.k,e.target.value)} placeholder="Remarks for this parameter (optional)"
                    style={{ width:'100%', marginTop:9, padding:'8px 10px', fontFamily:font, fontSize:12.5, border:`1px solid ${C.line}`, borderRadius:8, outline:'none', color:C.navy, boxSizing:'border-box' }} />
                ) : remarks[p.k] ? (
                  <div style={{ marginTop:8, fontSize:12, color:C.muted }}><b style={{ color:C.purple }}>Remark:</b> {remarks[p.k]}</div>
                ) : null}
              </div>
            )
          })}
        </div>

        {/* overall */}
        <div style={{ background:C.card, border:`1px solid ${C.line}`, borderRadius:12, padding:16 }}>
          <div style={{ fontSize:12, fontWeight:800, letterSpacing:.4, textTransform:'uppercase', color:C.muted, marginBottom:12 }}>Overall assessment</div>
          <label style={label}>Detailed feedback{!readOnly && <span style={{ color:C.dang }}> — mandatory</span>}</label>
          {!readOnly ? (
            <textarea value={overall} onChange={e=>setOverall(e.target.value)} placeholder="Your full written assessment — what stood out, where the gaps are, and anything the next round should probe."
              style={{ width:'100%', minHeight:88, padding:'9px 11px', fontFamily:font, fontSize:13, border:`1px solid ${C.line}`, borderRadius:8, outline:'none', color:C.navy, resize:'vertical', boxSizing:'border-box' }} />
          ) : (
            <div style={{ fontSize:13, color:C.navy, whiteSpace:'pre-wrap', lineHeight:1.6 }}>{overall || '—'}</div>
          )}
          {/* decision — view mode shows what was decided; fill mode offers the three buttons */}
          {readOnly ? (
            <div style={{ marginTop:12 }}>
              <label style={label}>Decision</label>
              {initial?.decision ? (
                <>
                  <span style={{ fontSize:11, fontWeight:800, padding:'3px 11px', borderRadius:20, color:DECISION_COLOR[initial.decision], background:DECISION_COLOR[initial.decision]+'18' }}>{DECISION_LABEL[initial.decision]}</span>
                  {initial.decision_remark && <div style={{ marginTop:8, fontSize:12.5, color:C.navy, whiteSpace:'pre-wrap' }}><b style={{ color:C.purple }}>Remark:</b> {initial.decision_remark}</div>}
                </>
              ) : (
                <div style={{ fontSize:13, fontWeight:700, color:C.navy }}>{recomm || '—'}</div>
              )}
            </div>
          ) : (
            <div style={{ marginTop:16 }}>
              <label style={label}>Your decision <span style={{ color:C.faint, fontWeight:500 }}>— Hold and Reject need a remark</span></label>
              {!pending ? (
                <div style={{ display:'flex', gap:9, flexWrap:'wrap' }}>
                  <button type="button" onClick={() => choose('HOLD')} disabled={submitting} style={decBtn(C.warn, submitting)}>Hold</button>
                  <button type="button" onClick={() => choose('REJECT')} disabled={submitting} style={decBtn(C.dang, submitting)}>Reject</button>
                  <button type="button" onClick={() => choose('SHORTLIST')} disabled={submitting} style={decBtn(C.ok, submitting)}>{submitting ? 'Submitting…' : 'Shortlist'}</button>
                  {onClose && <button type="button" onClick={onClose} style={{ padding:'11px 18px', borderRadius:9, border:`1px solid ${C.line}`, background:C.card, color:C.navy, fontFamily:font, fontSize:14, fontWeight:700, cursor:'pointer', marginLeft:'auto' }}>Cancel</button>}
                </div>
              ) : (
                <div style={{ border:`1px solid ${DECISION_COLOR[pending]}55`, background:DECISION_COLOR[pending]+'0D', borderRadius:11, padding:13 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:DECISION_COLOR[pending], marginBottom:8 }}>{pending === 'HOLD' ? 'Put the candidate on hold' : 'Reject the candidate'} — add your remark</div>
                  <textarea autoFocus value={dRemark} onChange={e=>setDRemark(e.target.value)} placeholder={pending === 'HOLD' ? 'Why on hold, and what would change the call (e.g. waiting on a comparison, notice period, budget)…' : 'Why the candidate is not a fit for this role…'}
                    style={{ width:'100%', minHeight:70, padding:'9px 11px', fontFamily:font, fontSize:13, border:`1px solid ${C.line}`, borderRadius:8, outline:'none', color:C.navy, resize:'vertical', boxSizing:'border-box', background:C.card }} />
                  <div style={{ display:'flex', gap:9, marginTop:10 }}>
                    <button type="button" onClick={() => finish(pending)} disabled={submitting} style={decBtn(DECISION_COLOR[pending], submitting)}>{submitting ? 'Submitting…' : `Confirm ${DECISION_LABEL[pending] === 'On hold' ? 'Hold' : 'Reject'}`}</button>
                    <button type="button" onClick={() => { setPending(null); setErr(null) }} disabled={submitting} style={{ padding:'11px 18px', borderRadius:9, border:`1px solid ${C.line}`, background:C.card, color:C.navy, fontFamily:font, fontSize:14, fontWeight:700, cursor:'pointer' }}>Back</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {err && <div style={{ marginTop:12, fontSize:12.5, color:C.dang, background:C.dangbg, border:`1px solid ${C.dang}33`, borderRadius:8, padding:'9px 12px', fontWeight:600 }}>{err}</div>}
        </div>
      </div>

      {/* right — live score */}
      <div style={{ background:C.card, border:`1px solid ${C.line}`, borderRadius:12, padding:16, position:'sticky', top:0 }}>
        <div style={{ fontSize:12, fontWeight:800, letterSpacing:.4, textTransform:'uppercase', color:C.muted, marginBottom:10 }}>{readOnly?'Score':'Live score'}</div>
        <div style={{ textAlign:'center', padding:'6px 0 10px' }}>
          <div style={{ fontSize:42, fontWeight:800, lineHeight:1, color: done?bandColor:C.faint }}>{done?total:'—'}</div>
          <div style={{ fontSize:13, color:C.faint, fontWeight:600 }}>out of 80</div>
          {done>0 && <div style={{ marginTop:9 }}><span style={{ fontSize:11, fontWeight:800, padding:'3px 11px', borderRadius:20, color:bandColor, background:bandColor+'18' }}>{bandLabel}</span></div>}
        </div>
        <div style={{ height:8, background:C.bg, borderRadius:5, overflow:'hidden', margin:'8px 0 6px' }}>
          <div style={{ height:'100%', width:`${(total/80)*100}%`, background: done?bandColor:C.faint, borderRadius:5, transition:'width .25s' }} />
        </div>
        <div style={{ fontSize:11, color:C.faint, textAlign:'center', marginBottom:12 }}>{done?`${pct}%${done<8?` · ${8-done} to rate`:''}`:'Not started'}</div>
        {FEEDBACK_PARAMS.map(p=>{
          const v = params[p.k]
          return (
            <div key={p.k} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', fontSize:12, borderBottom:`1px solid ${C.line}` }}>
              <div style={{ color:C.muted, flex:1, paddingRight:8, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.n}</div>
              <div style={{ fontWeight:800, minWidth:32, textAlign:'right', color: v?tone(v):C.faint }}>{v||'—'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const decBtn = (color: string, busy?: boolean): React.CSSProperties => ({
  padding:'11px 22px', borderRadius:9, border:'none', background:color, color:'#fff', fontFamily:font, fontSize:14, fontWeight:700,
  cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1, minWidth:110,
})
