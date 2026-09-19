'use client'
// components/recruitment/CandidateInterviewModal.tsx
//
// The candidate popup the hiring manager opens from the pipeline — a centered
// modal (it replaced the old right-hand drawer). It runs the whole interview
// flow round by round:
//
//   • Pick a round (Telephonic → L1 → L2 → Optional) and schedule it: search
//     and select one or more interviewers, set date/time, paste a meeting link,
//     and Send. That mails the candidate + interviewers and raises an ESS
//     acknowledge task for each interviewer.
//   • As interviewers acknowledge and submit the 8-parameter feedback, this
//     popup shows their status and lets the manager read every feedback back.
//   • Moving the candidate's stage forward is gated: a core round (Telephonic,
//     L1, L2) must have feedback on record before the candidate can move past
//     it — no jumping straight to Shortlisted.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import InterviewFeedbackForm, { type Feedback, bandOf } from './InterviewFeedbackForm'

const C = {
  navy:'#1E1B4B', ink:'#1E1B4B', purple:'#7C3AED', pdark:'#3C3489', brandTint:'#EDE9FE',
  card:'#FFFFFF', bg:'#F5F3FF', sunken:'#F7F6FD', line:'#E9E7F5', muted:'#6B6890', faint:'#9C99B8',
  ok:'#059669', okbg:'#ECFDF5', warn:'#D97706', warnbg:'#FFFBEB', info:'#2563EB', infobg:'#EFF6FF', dang:'#DC2626',
}
const font = '"DM Sans","Segoe UI",sans-serif'

// Rounds are dynamic now: Telephonic is the default first round; the hiring manager adds
// any further rounds (with their own names) via "+ Add round". Rounds already scheduled on
// the candidate (from interview_invites) always show too, so old L1/L2 rounds still appear.
const DEFAULT_ROUNDS = ['Telephonic']

interface Invite {
  id: string; round: string; interviewer_id: string; interviewer_emp_code: string | null
  interviewer_name: string | null; scheduled_at: string | null; meet_link: string | null
  scheduled_by_name: string | null; status: string; feedback: Feedback | null; submitted_at: string | null
}
interface Emp { id: string; emp_code: string | null; full_name: string; designation: string | null; company_id: string | null }

const lpa = (n?: number | null) => (n ? `₹${(n / 100000).toFixed(1)}L` : '—')

export default function CandidateInterviewModal({
  candidate, mrf, stages, stageColor, stageText, schedulerId, onClose, onStageChange, showNotify,
}: {
  candidate: any
  mrf: any
  stages: string[]
  stageColor: Record<string, string>
  stageText: Record<string, string>
  schedulerId: string | null | undefined
  onClose: () => void
  onStageChange: (id: string, stage: string, opts?: { blocked?: string }) => void
  showNotify: (m: string, t?: 'success' | 'error') => void
}) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [emps, setEmps] = useState<Emp[]>([])
  const [openRound, setOpenRound] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Invite | null>(null)
  const [addedRounds, setAddedRounds] = useState<string[]>([])   // HM-added rounds not yet scheduled
  const [showAddRound, setShowAddRound] = useState(false)
  const [newRound, setNewRound] = useState('')

  // schedule form state
  const [picked, setPicked] = useState<Emp[]>([])
  const [q, setQ] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [link, setLink] = useState('')
  const [sending, setSending] = useState(false)

  const loadInvites = useCallback(async () => {
    try {
      const r = await fetch(`/api/recruitment/interview-invite?candidate_id=${candidate.id}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      setInvites(Array.isArray(j.invites) ? j.invites : [])
    } catch { /* leave as-is */ }
  }, [candidate.id])

  useEffect(() => { loadInvites() }, [loadInvites])
  useEffect(() => {
    supabase.from('employees')
      .select('id, emp_code, full_name, designation, company_id')
      .is('date_of_leaving', null).order('full_name')
      .then(({ data }) => setEmps((data as Emp[]) || []))
  }, [])

  const invitesByRound = useMemo(() => {
    const m: Record<string, Invite[]> = {}
    for (const i of invites) (m[i.round] ||= []).push(i)
    return m
  }, [invites])

  const roundComplete = useCallback((r: string) => (invitesByRound[r] || []).some(i => i.status === 'submitted'), [invitesByRound])

  // The rounds to show: the default first round, every round already scheduled on the
  // candidate, and any the hiring manager has added — in a stable order, no duplicates.
  const rounds = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = []
    for (const r of [...DEFAULT_ROUNDS, ...Object.keys(invitesByRound), ...addedRounds]) {
      if (r && !seen.has(r)) { seen.add(r); out.push(r) }
    }
    return out
  }, [invitesByRound, addedRounds])

  const addRound = () => {
    const name = newRound.trim()
    if (!name) return
    if (!rounds.some(r => r.toLowerCase() === name.toLowerCase())) setAddedRounds(a => [...a, name])
    setNewRound(''); setShowAddRound(false)
    openScheduleFor(name)   // straight into scheduling, per the flow
  }

  // Gating: can't move a candidate to Shortlisted (or beyond) while any round that has been
  // scheduled is still waiting on interviewer feedback.
  const blockedReason = useCallback((target: string): string | null => {
    const shortlistIdx = stages.indexOf('Shortlisted')
    if (shortlistIdx === -1 || stages.indexOf(target) < shortlistIdx) return null
    for (const r of Object.keys(invitesByRound)) {
      if ((invitesByRound[r] || []).length && !roundComplete(r)) return r
    }
    return null
  }, [stages, invitesByRound, roundComplete])

  const openScheduleFor = (r: string) => {
    setOpenRound(r); setViewing(null)
    setPicked([]); setQ(''); setLink('')
    setDate(''); setTime('10:00')
  }

  const togglePick = (e: Emp) =>
    setPicked(p => p.some(x => x.id === e.id) ? p.filter(x => x.id !== e.id) : [...p, e])

  const searchHits = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return emps.filter(e =>
      (e.full_name || '').toLowerCase().includes(s) || (e.emp_code || '').toLowerCase().includes(s)
    ).slice(0, 8)
  }, [q, emps])

  async function sendSchedule() {
    if (!openRound) return
    if (!picked.length) { showNotify('Select at least one interviewer', 'error'); return }
    if (!date) { showNotify('Pick an interview date', 'error'); return }
    setSending(true)
    try {
      const scheduled_at = new Date(`${date}T${time || '10:00'}`).toISOString()
      const r = await fetch('/api/recruitment/interview-invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'schedule', candidate_id: candidate.id, mrf_id: candidate.mrf_id || null,
          company_id: candidate.company_id || mrf?.company_id || null, round: openRound,
          interviewer_ids: picked.map(p => p.id), scheduled_at, meet_link: link.trim() || null,
          scheduled_by: schedulerId || null,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { showNotify(j.error || 'Could not schedule', 'error'); setSending(false); return }
      showNotify(j.emailSkipped ? `Scheduled — ${j.invited} interviewer(s) notified in ESS (email off)` : `Scheduled — ${j.invited} interviewer(s), ${j.emailed} email(s) sent`)
      setOpenRound(null)
      await loadInvites()
    } catch { showNotify('Could not schedule', 'error') }
    setSending(false)
  }

  function tryMove(stage: string) {
    const reason = blockedReason(stage)
    if (reason) { showNotify(`Complete the ${reason} round (needs interviewer feedback) before moving to ${stage}`, 'error'); return }
    onStageChange(candidate.id, stage)
  }

  const initials = (candidate.full_name || '?').split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
  const subLine = [mrf?.designation || mrf?.position, candidate.designation, candidate.mrf_id ? `MRF ${(mrf?.mrf_number || '').toString()}` : null].filter(Boolean).join(' · ')

  // ---- feedback viewer (own overlay above the modal) ----
  if (viewing) {
    return (
      <Shell onClose={onClose} wide>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
          <button onClick={() => setViewing(null)} style={btn.ghost}>← Back</button>
          <div style={{ fontSize:15, fontWeight:800 }}>{viewing.round} feedback · {viewing.interviewer_name}</div>
        </div>
        <InterviewFeedbackForm
          mode="view" round={viewing.round}
          candidate={{ name: candidate.full_name, sub: subLine, ai_score: candidate.ai_score ?? null }}
          initial={viewing.feedback}
        />
      </Shell>
    )
  }

  return (
    <Shell onClose={onClose}>
      {/* header */}
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:14 }}>
        <div style={{ width:46, height:46, borderRadius:13, background:C.purple, color:'#fff', display:'grid', placeItems:'center', fontWeight:800, fontSize:15, flexShrink:0 }}>{initials}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <div style={{ fontSize:17, fontWeight:800 }}>{candidate.full_name}</div>
            <span style={{ fontSize:10, fontWeight:800, padding:'3px 10px', borderRadius:99, background:C.sunken, color: stageText[candidate.stage] || C.muted }}>{candidate.stage}</span>
          </div>
          <div style={{ fontSize:12, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{subLine || '—'}</div>
        </div>
        <button onClick={onClose} style={btn.ghost}>Close</button>
      </div>

      {/* stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:8, marginBottom:16 }}>
        {[['Current CTC', lpa(candidate.current_ctc)], ['Expected CTC', lpa(candidate.expected_ctc)], ['Notice', candidate.notice_period ? `${candidate.notice_period}d` : '—'], ['AI Score', candidate.ai_score != null ? `${candidate.ai_score}%` : '—']].map(([l, v]) => (
          <div key={l} style={{ background:C.sunken, borderRadius:9, padding:'8px 10px', border:`1px solid ${C.line}` }}>
            <div style={{ fontSize:10, color:C.faint, textTransform:'uppercase', letterSpacing:.4 }}>{l}</div>
            <div style={{ fontSize:14, fontWeight:800, marginTop:2 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* rounds */}
      <div style={{ display:'flex', alignItems:'center', gap:10, margin:'2px 0 9px' }}>
        <SectionTitle>Interview rounds</SectionTitle>
        <button onClick={() => { setNewRound(''); setShowAddRound(true) }} style={{ ...btn.small, marginLeft:'auto', background:C.brandTint, color:C.pdark, border:`1px solid ${C.purple}44` }}>+ Add round</button>
      </div>
      <div style={{ display:'grid', gap:10, marginBottom:18 }}>
        {rounds.map(r => {
          const rows = invitesByRound[r] || []
          const complete = rows.some(i => i.status === 'submitted')
          const scheduled = rows.length > 0
          const [statLabel, statColor] = complete ? ['Feedback in', C.ok] : scheduled ? ['Scheduled', C.info] : ['Not scheduled', C.faint]
          const isOpen = openRound === r
          return (
            <div key={r} style={{ border:`1px solid ${isOpen ? C.purple : C.line}`, borderRadius:12, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 13px', background: complete ? C.okbg : C.card }}>
                <div style={{ width:30, height:30, borderRadius:8, background: complete ? C.ok : scheduled ? C.info : C.sunken, color: scheduled || complete ? '#fff' : C.muted, display:'grid', placeItems:'center', fontSize:11, fontWeight:800, flexShrink:0 }}>{complete ? '✓' : '○'}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13.5, fontWeight:700 }}>{r}</div>
                  <div style={{ fontSize:11, color:C.muted }}>
                    {scheduled ? `${rows.length} interviewer${rows.length > 1 ? 's' : ''} · ${rows.filter(i => i.status === 'submitted').length} feedback in` : 'No interview scheduled yet'}
                  </div>
                </div>
                <span style={{ fontSize:10, fontWeight:800, padding:'3px 10px', borderRadius:99, background: statColor + '18', color: statColor }}>{statLabel}</span>
                <button onClick={() => (isOpen ? setOpenRound(null) : openScheduleFor(r))} style={{ ...btn.small, background: isOpen ? C.sunken : C.purple, color: isOpen ? C.ink : '#fff', border: isOpen ? `1px solid ${C.line}` : 'none' }}>
                  {isOpen ? 'Close' : scheduled ? '+ Add interview' : 'Schedule'}
                </button>
              </div>

              {/* interviewer rows */}
              {rows.length > 0 && (
                <div style={{ padding:'4px 13px 10px' }}>
                  {rows.map(i => (
                    <div key={i.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 0', borderTop:`1px solid ${C.line}` }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12.5, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.interviewer_name || i.interviewer_emp_code || 'Interviewer'}</div>
                        <div style={{ fontSize:10.5, color:C.faint }}>{i.scheduled_at ? new Date(i.scheduled_at).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : 'time TBC'}{i.meet_link ? ' · link sent' : ''}</div>
                      </div>
                      {i.status === 'submitted' && i.feedback ? (
                        <>
                          <span style={{ fontSize:10, fontWeight:800, color: bandOf(i.feedback.pct)[1] }}>{i.feedback.total}/80</span>
                          <button onClick={() => setViewing(i)} style={{ ...btn.small, background:C.info, color:'#fff', border:'none' }}>View feedback</button>
                        </>
                      ) : (
                        <span style={{ fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:99, background:C.sunken, color: i.status === 'acknowledged' ? C.info : C.warn }}>
                          {i.status === 'acknowledged' ? 'Acknowledged · awaiting feedback' : 'Invited · not acknowledged'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* schedule form */}
              {isOpen && (
                <div style={{ padding:'12px 13px', borderTop:`1px solid ${C.line}`, background:C.sunken }}>
                  <label style={lbl}>Interviewers <span style={{ color:C.faint, fontWeight:500 }}>— search by name or emp code</span></label>
                  {picked.length > 0 && (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:6 }}>
                      {picked.map(e => (
                        <span key={e.id} style={{ display:'inline-flex', alignItems:'center', gap:6, background:C.brandTint, color:C.pdark, borderRadius:99, padding:'3px 6px 3px 10px', fontSize:11.5, fontWeight:600 }}>
                          {e.full_name} <span style={{ color:C.faint }}>{e.emp_code}</span>
                          <button onClick={() => togglePick(e)} style={{ border:'none', background:'transparent', cursor:'pointer', color:C.pdark, fontSize:13, lineHeight:1 }}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ position:'relative' }}>
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Type a name or emp code…" style={inp} />
                    {searchHits.length > 0 && (
                      <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:5, background:C.card, border:`1px solid ${C.line}`, borderRadius:8, marginTop:3, boxShadow:'0 8px 24px rgba(30,27,75,0.14)', maxHeight:220, overflowY:'auto' }}>
                        {searchHits.map(e => {
                          const on = picked.some(x => x.id === e.id)
                          return (
                            <button key={e.id} onClick={() => { togglePick(e); setQ('') }} style={{ display:'flex', width:'100%', textAlign:'left', gap:8, alignItems:'center', padding:'8px 11px', border:'none', borderBottom:`1px solid ${C.line}`, background: on ? C.brandTint : C.card, cursor:'pointer', fontFamily:font }}>
                              <span style={{ flex:1, fontSize:12.5, color:C.ink }}>{e.full_name} <span style={{ color:C.faint }}>· {e.emp_code || '—'}{e.designation ? ` · ${e.designation}` : ''}</span></span>
                              {on && <span style={{ color:C.ok, fontWeight:800 }}>✓</span>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:10 }}>
                    <div><label style={lbl}>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} /></div>
                    <div><label style={lbl}>Time</label><input type="time" value={time} onChange={e => setTime(e.target.value)} style={inp} /></div>
                  </div>
                  <div style={{ marginTop:10 }}>
                    <label style={lbl}>Meeting link <span style={{ color:C.faint, fontWeight:500 }}>— Google Meet / Zoom / Teams</span></label>
                    <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://meet.google.com/…" style={inp} />
                  </div>
                  <div style={{ display:'flex', gap:8, marginTop:12 }}>
                    <button onClick={sendSchedule} disabled={sending} style={{ ...btn.pri, opacity: sending ? .6 : 1 }}>{sending ? 'Sending…' : 'Send invite'}</button>
                    <button onClick={() => setOpenRound(null)} style={btn.ghost}>Cancel</button>
                    <span style={{ marginLeft:'auto', alignSelf:'center', fontSize:11, color:C.faint }}>Emails the candidate + interviewers, and raises an ESS acknowledge task.</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* stage move — gated */}
      <SectionTitle>Move stage</SectionTitle>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
        {stages.map(s => {
          const isBack = stages.indexOf(s) < stages.indexOf(candidate.stage)
          const reason = blockedReason(s)
          const disabled = isBack || !!reason
          const current = candidate.stage === s
          return (
            <button key={s} onClick={() => { if (!disabled && !current) tryMove(s) }} disabled={disabled}
              title={isBack ? 'Pipeline moves forward only' : reason ? `Complete the ${reason} round first` : ''}
              style={{ fontFamily:font, fontSize:11, fontWeight:600, padding:'5px 11px', borderRadius:8, cursor: disabled ? 'not-allowed' : 'pointer',
                background: current ? (stageColor[s] || C.purple) : C.sunken,
                color: current ? '#fff' : (stageColor[s] || C.muted),
                border: current ? 'none' : `1px solid ${(stageColor[s] || C.line)}30`,
                opacity: disabled && !current ? .4 : 1, textDecoration: isBack ? 'line-through' : 'none' }}>
              {s}{reason && !isBack && !current ? ' 🔒' : ''}
            </button>
          )
        })}
      </div>
      <div style={{ fontSize:11, color:C.faint, marginTop:8 }}>🔒 Every scheduled round must have interviewer feedback before the candidate can move to Shortlisted or beyond.</div>

      {/* Add-round popup — name the round, then it opens straight into scheduling */}
      {showAddRound && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setShowAddRound(false) }}
          style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:C.card, borderRadius:14, width:'min(420px, 100%)', padding:'18px 20px', boxShadow:'0 24px 70px rgba(30,27,75,0.35)' }}>
            <div style={{ fontSize:15, fontWeight:800, marginBottom:4 }}>Add an interview round</div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:12 }}>Name the round (e.g. “Technical L1”, “HR Round”, “Panel”). You’ll schedule the interviewers next.</div>
            <label style={lbl}>Round name</label>
            <input autoFocus value={newRound} onChange={e => setNewRound(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addRound() }}
              placeholder="e.g. Technical L1" style={inp} />
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              <button onClick={addRound} disabled={!newRound.trim()} style={{ ...btn.pri, opacity: newRound.trim() ? 1 : .5 }}>Add</button>
              <button onClick={() => setShowAddRound(false)} style={btn.ghost}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

// ---- little building blocks ----
const lbl: React.CSSProperties = { fontSize:11, fontWeight:700, color:C.muted, marginBottom:4, display:'block' }
const inp: React.CSSProperties = { width:'100%', padding:'9px 11px', fontFamily:font, fontSize:13, border:`1px solid ${C.line}`, borderRadius:8, outline:'none', color:C.ink, background:C.card, boxSizing:'border-box' }
const btn = {
  pri: { padding:'9px 18px', borderRadius:9, border:'none', background:C.purple, color:'#fff', fontFamily:font, fontSize:13, fontWeight:700, cursor:'pointer' } as React.CSSProperties,
  ghost: { padding:'7px 13px', borderRadius:8, border:`1px solid ${C.line}`, background:C.card, color:C.ink, fontFamily:font, fontSize:12.5, fontWeight:600, cursor:'pointer' } as React.CSSProperties,
  small: { padding:'6px 12px', borderRadius:8, fontFamily:font, fontSize:11.5, fontWeight:700, cursor:'pointer' } as React.CSSProperties,
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:11, fontWeight:800, letterSpacing:.5, textTransform:'uppercase', color:C.muted, margin:'2px 0 9px' }}>{children}</div>
}
function Shell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.45)', zIndex:200, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'24px 16px', fontFamily:font, color:C.ink }}>
      <div style={{ background:C.card, borderRadius:16, width: wide ? 'min(1000px, 100%)' : 'min(720px, 100%)', boxShadow:'0 24px 70px rgba(30,27,75,0.3)', padding:'18px 20px', margin:'0 auto' }}>
        {children}
      </div>
    </div>
  )
}
