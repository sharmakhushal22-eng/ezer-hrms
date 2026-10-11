'use client'
// components/recruitment/CandidateInterviewModal.tsx
//
// The candidate popup the hiring manager opens from the pipeline — a centered
// modal that runs the whole interview flow round by round:
//
//   • Telephonic is the first round and needs NO scheduling: the recruiter runs
//     it and records the feedback straight here ("Give feedback" sits where a
//     Schedule button would). The feedback form scores 8 parameters and ends in
//     a decision — Hold / Reject / Shortlist.
//   • Shortlist (or Hold) on the latest round enables "+ Add round": name the
//     round, then schedule it with ONE main interviewer and any number of
//     panelists (date/time, meeting link, passcode). Everyone gets the details
//     in ESS → Tasks & Approvals; only the main interviewer gets "Give feedback".
//   • The main interviewer's decision moves the candidate: Reject → Rejected
//     (with remark), Hold → the Hold stage (with remark; a round can still be
//     added), Shortlist → clears the round.
//   • After three decided rounds a "Shortlist" button appears beside Add round;
//     it asks for confirmation and marks the candidate Shortlisted.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
// interview-invite reads and WRITES the candidate's stage, so it is guarded
// server-side. authHeaders() reads whichever session exists — this modal opens
// from the dashboard and from the recruitment page embedded in ESS.
import { authHeaders } from '@/lib/auth-headers'
import InterviewFeedbackForm, { type Feedback, bandOf } from './InterviewFeedbackForm'
import { type Decision, DECISION_LABEL, ROUNDS_BEFORE_SHORTLIST } from '@/lib/recruitment/interview-decision'
import { CONFIDENTIAL_ROUNDS_BEFORE_SHORTLIST } from '@/lib/recruitment/confidential'
// Aliased as TK because this file already declares its own C. See lib/ui/tokens.ts.
import { C as TK, E, F, Z } from '@/lib/ui'
// The move-stage picker adopts the kit's radiogroup. moveOptions() only LABELS
// the targets; blockedReason() below still decides. See the note on roundVMs.
import { RxDialog, Icon, moveOptions, type RoundVM } from '@/components/recruitment/rx'

// ── Palette ──────────────────────────────────────────────────────────────────
//
// THESE WERE HEX LITERALS, AND THAT WAS THE BUG. Opening this modal with the
// product in dark mode gave a white card with near-black ink floating on a
// dark app — measured: page canvas rgb(15,18,22), modal card rgb(255,255,255),
// ink rgb(30,27,75). They were also the OLD purple brand (#7C3AED, #1E1B4B),
// which the product stopped using at the rebrand.
//
// THE RATCHET NEVER SAW ANY OF THIS. theme-audit counts hex on colour-bearing
// PROPERTIES; these were plain values in a const, so the scanner scored this
// file 6 (six `color:'#fff'`) while every surface in it was frozen. Fixing
// only what the tool counts would have taken it to zero and left the bug.
//
// The KEY NAMES are unchanged, so the call sites below did not have to move.
// NOTE: these are `var(...)` strings now. Never concatenate an alpha suffix
// onto one — `C.purple + '18'` produces nothing at all. Use a tint token.
const C = {
  navy:TK.ink, ink:TK.ink, purple:TK.brand, pdark:TK.brandDeep, brandTint:TK.brandTint,
  card:TK.surface, bg:TK.canvas, sunken:TK.sunken, line:TK.line, muted:TK.muted, faint:TK.faint,
  ok:TK.positive, okbg:TK.positiveTint, warn:TK.warning, warnbg:TK.warningTint, info:TK.info, infobg:TK.infoTint, dang:TK.critical,
}
const font = F.family
const DECISION_COLOR: Record<Decision, string> = { HOLD: C.warn, REJECT: C.dang, SHORTLIST: C.ok }
const DECISION_BG: Record<Decision, string> = { HOLD: C.warnbg, REJECT: TK.criticalTint, SHORTLIST: C.okbg }

// Telephonic is the default first round and is never scheduled — the recruiter records it.
const DEFAULT_ROUNDS = ['Telephonic']
const DIRECT_ROUNDS = new Set(['telephonic'])

interface Invite {
  id: string; round: string; interviewer_id: string | null; interviewer_emp_code: string | null
  interviewer_name: string | null; role?: 'MAIN' | 'PANELIST' | null
  scheduled_at: string | null; meet_link: string | null; meet_passcode?: string | null
  scheduled_by_name: string | null; status: string; feedback: Feedback | null; submitted_at: string | null
  decision?: Decision | null; decision_remark?: string | null
}
interface Emp { id: string; emp_code: string | null; full_name: string; designation: string | null; company_id: string | null }

const lpa = (n?: number | null) => (n ? `₹${(n / 100000).toFixed(1)}L` : '—')
const isMain = (i: Invite) => (i.role || 'MAIN') === 'MAIN'
const decisionOf = (i?: Invite | null): Decision | null => (i?.decision || i?.feedback?.decision || null) as Decision | null

export default function CandidateInterviewModal({
  candidate, mrf, confidential = false, stages, stageColor, stageText, schedulerId, onClose, onStageChange, onChanged, showNotify,
}: {
  candidate: any
  mrf: any
  /** Confidential hiring: one Telephonic round recorded here, no invites; a Shortlist decision moves the candidate straight to Negotiation. */
  confidential?: boolean
  stages: string[]
  stageColor: Record<string, string>
  stageText: Record<string, string>
  schedulerId: string | null | undefined
  onClose: () => void
  onStageChange: (id: string, stage: string, opts?: { blocked?: string }) => void
  /** The server moved the candidate (a decision or the final Shortlist) — refresh the list. */
  onChanged?: (stage?: string | null) => void
  showNotify: (m: string, t?: 'success' | 'error') => void
}) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [emps, setEmps] = useState<Emp[]>([])
  const [openRound, setOpenRound] = useState<string | null>(null)   // round whose schedule form is open
  const [viewing, setViewing] = useState<Invite | null>(null)       // read a submitted feedback
  const [fbRound, setFbRound] = useState<string | null>(null)       // recruiter recording feedback directly
  const [fbSaving, setFbSaving] = useState(false)
  const [addedRounds, setAddedRounds] = useState<string[]>([])      // HM-added rounds not yet scheduled
  const [showAddRound, setShowAddRound] = useState(false)
  const [newRound, setNewRound] = useState('')
  const [confirmShortlist, setConfirmShortlist] = useState(false)
  const [shortlisting, setShortlisting] = useState(false)
  const [stageNow, setStageNow] = useState<string>(candidate.stage)
  const [target, setTarget] = useState<string | null>(null)   // stage picked in the move radiogroup

  // schedule form state
  const [mainPick, setMainPick] = useState<Emp[]>([])
  const [panel, setPanel] = useState<Emp[]>([])
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [link, setLink] = useState('')
  const [passcode, setPasscode] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => { setStageNow(candidate.stage) }, [candidate.stage])
  // A move landed (or a decision moved the candidate): clear the picker so it
  // never shows a selection that is now behind the candidate.
  useEffect(() => { setTarget(null) }, [stageNow])

  const loadInvites = useCallback(async () => {
    try {
      const r = await fetch(`/api/recruitment/interview-invite?candidate_id=${candidate.id}`, { cache: 'no-store', headers: await authHeaders() })
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

  // The main interviewer's row for a round (the one whose feedback counts).
  const mainOf = useCallback((r: string): Invite | null => {
    const rows = invitesByRound[r] || []
    return rows.find(i => isMain(i) && i.status === 'submitted') || rows.find(isMain) || rows[0] || null
  }, [invitesByRound])
  const roundComplete = useCallback((r: string) => (invitesByRound[r] || []).some(i => isMain(i) && i.status === 'submitted'), [invitesByRound])

  // The rounds to show: the default first round, every round already on the candidate
  // (in the order they were created), and any the hiring manager has added.
  const rounds = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = []
    for (const r of [...DEFAULT_ROUNDS, ...Object.keys(invitesByRound), ...addedRounds]) {
      const k = r.toLowerCase()
      if (r && !seen.has(k)) { seen.add(k); out.push(r) }
    }
    // Confidential: the Telephonic round is the whole interview.
    return confidential ? out.filter(r => DIRECT_ROUNDS.has(r.toLowerCase())) : out
  }, [invitesByRound, addedRounds, confidential])
  const roundsNeeded = confidential ? CONFIDENTIAL_ROUNDS_BEFORE_SHORTLIST : ROUNDS_BEFORE_SHORTLIST

  // Decision flow: the LAST round on the candidate decides what the manager may do next.
  const decidedRounds = rounds.filter(r => decisionOf(mainOf(r)))
  const lastRound = rounds[rounds.length - 1]
  const lastDecision = decisionOf(mainOf(lastRound))
  const lastPending = !!lastRound && !roundComplete(lastRound)   // scheduled/awaiting or not even scheduled
  const pipelineOver = ['Rejected', 'Shortlisted', 'Offer Sent', 'Joined'].includes(stageNow)
  const canAddRound = !confidential && !pipelineOver && !lastPending && (lastDecision === 'SHORTLIST' || lastDecision === 'HOLD')
  const addRoundHint = confidential ? 'Confidential hiring — one Telephonic round only' : pipelineOver ? `Candidate is ${stageNow}` : lastPending ? `Waiting on the ${lastRound} round's feedback` : lastDecision === 'REJECT' ? 'The last round rejected this candidate' : ''
  const canShortlist = !pipelineOver && !lastPending && decidedRounds.length >= roundsNeeded && (lastDecision === 'SHORTLIST' || lastDecision === 'HOLD')

  const addRound = () => {
    const name = newRound.trim()
    if (!name) return
    if (!rounds.some(r => r.toLowerCase() === name.toLowerCase())) setAddedRounds(a => [...a, name])
    setNewRound(''); setShowAddRound(false)
    openScheduleFor(name)   // straight into scheduling, per the flow
  }

  // Gating for the manual stage buttons: can't move a candidate to Shortlisted (or beyond)
  // while any scheduled round is still waiting on its main interviewer's feedback.
  const blockedReason = useCallback((target: string): string | null => {
    const shortlistIdx = stages.indexOf('Shortlisted')
    if (shortlistIdx === -1 || stages.indexOf(target) < shortlistIdx) return null
    for (const r of Object.keys(invitesByRound)) {
      if ((invitesByRound[r] || []).length && !roundComplete(r)) return r
    }
    return null
  }, [stages, invitesByRound, roundComplete])

  /**
   * View models for the kit's stage picker. Built from invitesByRound — the SAME
   * set blockedReason() walks — so a label can never disagree with the gate: a
   * round that was named but never scheduled has no invite rows and gates
   * nothing. moveOptions() reads only `name` and `hasFeedback`.
   *
   * This is deliberately NOT the interview_rounds table. That table is what the
   * pipeline's own RoundVMs come from, and this modal never loads it — feeding
   * moveOptions an empty array here would report every stage as open and quietly
   * bypass the feedback gate.
   */
  const roundVMs = useMemo<RoundVM[]>(() => Object.keys(invitesByRound).map(r => {
    const m = mainOf(r)
    return { name: r, interviewer: m?.interviewer_name || '', at: m?.scheduled_at ?? null, hasFeedback: roundComplete(r) }
  }), [invitesByRound, mainOf, roundComplete])

  const openScheduleFor = (r: string) => {
    setOpenRound(r); setViewing(null); setFbRound(null)
    setMainPick([]); setPanel([]); setLink(''); setPasscode('')
    setDate(''); setTime('10:00')
  }

  async function sendSchedule() {
    if (!openRound) return
    if (!mainPick.length) { showNotify('Select the main interviewer', 'error'); return }
    if (!date) { showNotify('Pick an interview date', 'error'); return }
    setSending(true)
    try {
      const scheduled_at = new Date(`${date}T${time || '10:00'}`).toISOString()
      const r = await fetch('/api/recruitment/interview-invite', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({
          action: 'schedule', candidate_id: candidate.id, mrf_id: candidate.mrf_id || null,
          company_id: candidate.company_id || mrf?.company_id || null, round: openRound,
          main_interviewer_id: mainPick[0].id, panelist_ids: panel.map(p => p.id),
          scheduled_at, meet_link: link.trim() || null, meet_passcode: passcode.trim() || null,
          scheduled_by: schedulerId || null,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { showNotify(j.error || 'Could not schedule', 'error'); setSending(false); return }
      const who = `${j.main || 'main interviewer'}${j.panelists ? ` + ${j.panelists} panelist${j.panelists > 1 ? 's' : ''}` : ''}`
      showNotify(j.emailSkipped ? `Scheduled — ${who} notified in ESS (email off)` : `Scheduled — ${who}, ${j.emailed} email(s) sent`)
      setOpenRound(null)
      setAddedRounds(a => a.filter(x => x.toLowerCase() !== openRound.toLowerCase()))
      await loadInvites()
    } catch { showNotify('Could not schedule', 'error') }
    setSending(false)
  }

  // The recruiter records a round's feedback directly (Telephonic): no invite, no schedule.
  async function submitDirect(fb: Feedback) {
    if (!fbRound) return
    setFbSaving(true)
    try {
      const r = await fetch('/api/recruitment/interview-invite', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({
          action: 'direct_feedback', candidate_id: candidate.id, mrf_id: candidate.mrf_id || null,
          company_id: candidate.company_id || mrf?.company_id || null, round: fbRound,
          interviewer_id: schedulerId || null, feedback: fb,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { showNotify(j.error || 'Could not save feedback', 'error'); setFbSaving(false); return }
      const d = fb.decision as Decision
      showNotify(d === 'REJECT' ? 'Feedback saved — candidate rejected' : d === 'HOLD' ? (confidential ? 'Feedback saved — candidate on hold.' : 'Feedback saved — candidate on hold. You can still add a round.') : j.confidential && j.stage === 'Shortlisted' ? 'Feedback saved — candidate shortlisted and moved to Negotiation.' : 'Feedback saved — candidate shortlisted for this round. Add the next round.')
      setFbRound(null)
      if (j.stage) setStageNow(j.stage)
      onChanged?.(j.stage || null)
      await loadInvites()
    } catch { showNotify('Could not save feedback', 'error') }
    setFbSaving(false)
  }

  async function doShortlist() {
    setShortlisting(true)
    try {
      const r = await fetch('/api/recruitment/interview-invite', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({ action: 'shortlist', candidate_id: candidate.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { showNotify(j.error || 'Could not shortlist', 'error'); setShortlisting(false); return }
      showNotify(`${candidate.full_name} marked Shortlisted after ${j.rounds} rounds`)
      setConfirmShortlist(false); setStageNow('Shortlisted')
      onChanged?.('Shortlisted')
    } catch { showNotify('Could not shortlist', 'error') }
    setShortlisting(false)
  }

  function tryMove(stage: string) {
    const reason = blockedReason(stage)
    if (reason) { showNotify(`Complete the ${reason} round (needs interviewer feedback) before moving to ${stage}`, 'error'); return }
    onStageChange(candidate.id, stage)
  }

  const initials = (candidate.full_name || '?').split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
  const subLine = [mrf?.designation || mrf?.position, candidate.designation, candidate.mrf_id ? `MRF ${(mrf?.mrf_number || '').toString()}` : null].filter(Boolean).join(' · ')
  const candMeta = { name: candidate.full_name, sub: subLine, ai_score: candidate.ai_score ?? null }

  // ---- feedback viewer (own overlay above the modal) ----
  if (viewing) {
    return (
      <Shell onClose={onClose} wide>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
          <button onClick={() => setViewing(null)} style={btn.ghost}>← Back</button>
          <div style={{ fontSize:15, fontWeight:800 }}>{viewing.round} feedback · {viewing.interviewer_name}</div>
          {decisionOf(viewing) && <span style={{ ...decChip(decisionOf(viewing)!), marginLeft:'auto' }}>{DECISION_LABEL[decisionOf(viewing)!]}</span>}
        </div>
        <InterviewFeedbackForm mode="view" round={viewing.round} candidate={candMeta} initial={viewing.feedback} />
      </Shell>
    )
  }

  // ---- recruiter recording a round's feedback directly (Telephonic) ----
  if (fbRound) {
    return (
      <Shell onClose={() => !fbSaving && onClose()} wide>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
          <button onClick={() => !fbSaving && setFbRound(null)} style={btn.ghost}>← Back</button>
          <div>
            <div style={{ fontSize:15, fontWeight:800 }}>{fbRound} round — record feedback</div>
            <div style={{ fontSize:11.5, color:C.muted }}>Score the 8 parameters, write your assessment, then Hold / Reject / Shortlist. Reject and Hold need a remark.</div>
          </div>
        </div>
        <InterviewFeedbackForm mode="fill" round={fbRound} candidate={candMeta} submitting={fbSaving}
          questions={Array.isArray(mrf?.ctq_questions) ? mrf.ctq_questions : []}
          onSubmit={submitDirect} onClose={() => !fbSaving && setFbRound(null)} />
      </Shell>
    )
  }

  // Forward-only targets, mirroring moveStage's own rule.
  // GUARD: when the candidate is already Rejected they are not in `flow` at all,
  // so moveOptions' indexOf returns -1, slice(cur+1) becomes slice(0), and it
  // would offer every stage — including ones behind them.
  const inFlow = stages.filter(s => s !== 'Rejected').includes(stageNow)
  const moveOpts = inFlow ? moveOptions(stages, stageNow, roundVMs) : []
  // Rejected sits past Shortlisted, so blockedReason() already gates it today.
  // moveOptions strips it from the list entirely, hence its own button.
  const rejectBlocked = blockedReason('Rejected')
  const canReject = stages.includes('Rejected') && stageNow !== 'Rejected'
  const anyGated = !!rejectBlocked || moveOpts.some(o => !o.allowed)

  return (
    <Shell onClose={onClose}>
      {/* header */}
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:14 }}>
        <div style={{ width:46, height:46, borderRadius:13, background:C.purple, color:TK.onAccent, display:'grid', placeItems:'center', fontWeight:800, fontSize:15, flexShrink:0 }}>{initials}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <div style={{ fontSize:17, fontWeight:800 }}>{candidate.full_name}</div>
            <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:99, background:C.sunken, border:`1px solid ${C.line}`, lineHeight:1.45, color: stageText[stageNow] || C.muted }}>{stageNow}</span>
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
      {confidential && (
        <div style={{ display:'flex', gap:10, alignItems:'flex-start', background:TK.warningTint, border:`1px solid ${TK.warningEdge}`, borderRadius:10, padding:'9px 12px', marginBottom:10, fontSize:12, color:TK.ink, lineHeight:1.5 }}>
          <span style={{ fontSize:16 }}>🔒</span>
          <span><b>Confidential hiring.</b> Only the HR Head and HR Manager see this candidate. There is one round — Telephonic — which you record here yourself; nobody is invited. A <b>Shortlist</b> decision moves the candidate straight to Negotiation.</span>
        </div>
      )}
      <div style={{ display:'flex', alignItems:'center', gap:8, margin:'2px 0 9px', flexWrap:'wrap' }}>
        <SectionTitle>Interview rounds</SectionTitle>
        <span style={{ fontSize:11, color:C.faint }}>{decidedRounds.length} of {roundsNeeded} round{roundsNeeded === 1 ? '' : 's'} decided</span>
        <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
          {canShortlist && (
            <button onClick={() => setConfirmShortlist(true)} style={{ ...btn.small, background:C.ok, color:TK.onAccent, border:'none' }}>★ Shortlist</button>
          )}
          {!confidential && <button onClick={() => { if (canAddRound) { setNewRound(''); setShowAddRound(true) } }} disabled={!canAddRound} title={canAddRound ? '' : addRoundHint}
            style={{ ...btn.small, background:C.brandTint, color:C.pdark, border:`1px solid ${TK.brandEdge}`, opacity: canAddRound ? 1 : .45, cursor: canAddRound ? 'pointer' : 'not-allowed' }}>+ Add round</button>}
        </div>
      </div>
      {!confidential && !canAddRound && addRoundHint && (
        <div style={{ fontSize:11, color:C.faint, margin:'-4px 0 9px' }}>“+ Add round” unlocks once the latest round's feedback is Shortlist or Hold — {addRoundHint.toLowerCase()}.</div>
      )}
      <div style={{ display:'grid', gap:10, marginBottom:18 }}>
        {rounds.map((r, idx) => {
          const rows = invitesByRound[r] || []
          const main = mainOf(r)
          const decision = decisionOf(main)
          // Only interviewers who have ACKNOWLEDGED (or submitted feedback) are shown on the
          // candidate's card — an invite that nobody has picked up yet is not displayed.
          const shown = rows.filter(i => i.status === 'acknowledged' || i.status === 'submitted')
          const complete = roundComplete(r)
          const scheduled = rows.length > 0
          const direct = DIRECT_ROUNDS.has(r.toLowerCase())
          // Pill carries its own tint (a var() colour + '18' is invalid CSS).
          const [statLabel, statColor, statBg] = decision ? [DECISION_LABEL[decision], DECISION_COLOR[decision], DECISION_BG[decision]] : complete ? ['Feedback in', C.ok, C.okbg] : scheduled ? ['Scheduled', C.info, C.infobg] : ['Not scheduled', C.faint, C.sunken]
          const isOpen = openRound === r
          const panelists = shown.filter(i => !isMain(i))
          const remark = main?.decision_remark || main?.feedback?.decision_remark || null
          return (
            <div key={r} style={{ border:`1px solid ${isOpen ? C.purple : C.line}`, borderRadius:12, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 13px', background: decision === 'REJECT' ? TK.criticalTint : complete ? C.okbg : C.card }}>
                <div style={{ width:30, height:30, borderRadius:8, background: decision ? DECISION_COLOR[decision] : complete ? C.ok : scheduled ? C.info : C.sunken, color: scheduled || complete ? TK.onAccent : C.muted, display:'grid', placeItems:'center', fontSize:11, fontWeight:800, flexShrink:0 }}>{decision === 'REJECT' ? '✕' : complete ? '✓' : idx + 1}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13.5, fontWeight:700 }}>{r}{direct && !scheduled ? <span style={{ fontSize:10, color:C.faint, fontWeight:600, marginLeft:8 }}>no scheduling — record feedback directly</span> : ''}</div>
                  <div style={{ fontSize:11, color:C.muted }}>
                    {!scheduled ? (direct ? 'Feedback not recorded yet' : 'No interview scheduled yet')
                      : complete ? `Main: ${main?.interviewer_name || '—'}${panelists.length ? ` · ${panelists.length} panelist${panelists.length > 1 ? 's' : ''}` : ''}`
                      : shown.length === 0 ? 'Awaiting acknowledgement from the invited interviewers'
                      : `${shown.length} acknowledged · awaiting the main interviewer's feedback`}
                  </div>
                </div>
                <span style={{ fontSize:10, fontWeight:800, padding:'3px 10px', borderRadius:99, background: statBg, color: statColor }}>{statLabel}</span>
                {!complete && direct && !scheduled ? (
                  <button onClick={() => setFbRound(r)} style={{ ...btn.small, background:C.purple, color:TK.onAccent, border:'none' }}>Give feedback</button>
                ) : !complete && !scheduled ? (
                  <button onClick={() => (isOpen ? setOpenRound(null) : openScheduleFor(r))} style={{ ...btn.small, background: isOpen ? C.sunken : C.purple, color: isOpen ? C.ink : TK.onAccent, border: isOpen ? `1px solid ${C.line}` : 'none' }}>
                    {isOpen ? 'Close' : 'Schedule'}
                  </button>
                ) : null}
              </div>

              {/* decision remark */}
              {decision && remark ? (
                <div style={{ padding:'6px 13px 10px', fontSize:12, color:C.ink, borderTop:`1px solid ${C.line}` }}><b style={{ color: DECISION_COLOR[decision] }}>{DECISION_LABEL[decision]} remark:</b> {remark}</div>
              ) : null}

              {/* interviewer rows — acknowledged / submitted only */}
              {scheduled && shown.length === 0 && (
                <div style={{ padding:'8px 13px 12px', fontSize:11.5, color:C.faint, borderTop:`1px solid ${C.line}` }}>No interviewer has acknowledged yet — they’ll appear here once they accept the invite in ESS.</div>
              )}
              {shown.length > 0 && (
                <div style={{ padding:'4px 13px 10px' }}>
                  {shown.map(i => (
                    <div key={i.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 0', borderTop:`1px solid ${C.line}` }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12.5, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {i.interviewer_name || i.interviewer_emp_code || 'Interviewer'}
                          <span style={{ fontSize:9.5, fontWeight:800, padding:'2px 7px', borderRadius:99, marginLeft:6, background: isMain(i) ? C.infobg : C.sunken, color: isMain(i) ? C.info : C.muted }}>{isMain(i) ? 'MAIN' : 'PANELIST'}</span>
                        </div>
                        <div style={{ fontSize:10.5, color:C.faint }}>{i.scheduled_at ? new Date(i.scheduled_at).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : i.submitted_at ? `recorded ${new Date(i.submitted_at).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' })}` : 'time TBC'}{i.meet_link ? ' · link sent' : ''}{i.meet_passcode ? ` · passcode ${i.meet_passcode}` : ''}</div>
                      </div>
                      {i.status === 'submitted' && i.feedback ? (
                        <>
                          <span style={{ fontSize:10, fontWeight:800, color: bandOf(i.feedback.pct)[1] }}>{i.feedback.total}/80</span>
                          <button onClick={() => setViewing(i)} style={{ ...btn.small, background:C.info, color:TK.onAccent, border:'none' }}>View feedback</button>
                        </>
                      ) : (
                        <span style={{ fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:99, background:C.sunken, color: isMain(i) ? C.info : C.muted }}>
                          {isMain(i) ? 'Acknowledged · awaiting feedback' : 'Acknowledged'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* schedule form — one main interviewer + panelists */}
              {isOpen && (
                <div style={{ padding:'12px 13px', borderTop:`1px solid ${C.line}`, background:C.sunken }}>
                  <PeoplePicker label="Main interviewer" hint="— one person; they give the feedback" single emps={emps} value={mainPick} exclude={panel} onChange={setMainPick} placeholder="Search by name or emp code…" />
                  <div style={{ marginTop:10 }}>
                    <PeoplePicker label="Panelists" hint="— optional, any number; they get the details but not the feedback form" emps={emps} value={panel} exclude={mainPick} onChange={setPanel} placeholder="Add panelists by name or emp code…" />
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:10 }}>
                    <div><label style={lbl}>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} /></div>
                    <div><label style={lbl}>Time</label><input type="time" value={time} onChange={e => setTime(e.target.value)} style={inp} /></div>
                  </div>
                  <div style={{ marginTop:10 }}>
                    <label style={lbl}>Meeting link <span style={{ color:C.faint, fontWeight:500 }}>— Google Meet / Zoom / Teams</span></label>
                    <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://meet.google.com/…" style={inp} />
                    <label style={{ ...lbl, marginTop:10 }}>Meeting passcode <span style={{ color:C.faint, fontWeight:500 }}>— optional (Zoom/Teams)</span></label>
                    <input value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="e.g. 4821" style={inp} />
                  </div>
                  <div style={{ display:'flex', gap:8, marginTop:12 }}>
                    <button onClick={sendSchedule} disabled={sending} style={{ ...btn.pri, opacity: sending ? .6 : 1 }}>{sending ? 'Sending…' : 'Send invite'}</button>
                    <button onClick={() => setOpenRound(null)} style={btn.ghost}>Cancel</button>
                    <span style={{ marginLeft:'auto', alignSelf:'center', fontSize:11, color:C.faint }}>Emails the candidate, main interviewer and panelists; raises an ESS task for each.</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* stage move — gated */}
      <SectionTitle>Move stage</SectionTitle>
      {moveOpts.length === 0 && !canReject ? (
        <div style={{ fontSize:12, color:C.faint }}>No stage left to move to — this candidate is {stageNow}.</div>
      ) : (
        <>
          <div className="rx-move" role="radiogroup" aria-label="Next stage">
            {moveOpts.map(o => {
              // moveOptions does NOT gate Shortlisted itself; blockedReason does,
              // and it is the authority in this modal. Whichever refuses, wins.
              const reason = blockedReason(o.stage)
              const allowed = o.allowed && !reason
              return (
                <label key={o.stage} className={allowed ? '' : 'off'}>
                  <input type="radio" name="mv" disabled={!allowed} checked={target === o.stage} onChange={() => setTarget(o.stage)} />
                  <b>{o.stage}</b>
                  <small>{reason ? `Complete the ${reason} round first` : (o.reason ?? '')}</small>
                </label>
              )
            })}
          </div>
          <div className="rx-row" style={{ gap:8, marginTop:12, flexWrap:'wrap' }}>
            <button className="rx-btn p" disabled={!target} onClick={() => { if (target) tryMove(target) }}>Move candidate</button>
            {canReject && (
              <button className="rx-btn d" disabled={!!rejectBlocked} onClick={() => tryMove('Rejected')}
                title={rejectBlocked ? `Complete the ${rejectBlocked} round first` : ''}>Reject</button>
            )}
            {anyGated && <span className="rx-why"><Icon name="lock" />Feedback still outstanding</span>}
          </div>
        </>
      )}
      <div style={{ fontSize:11, color:C.faint, marginTop:8 }}>Interview decisions move the candidate automatically (Reject → Rejected, Hold → Hold, Shortlist → the round's stage). Every scheduled round needs the main interviewer's feedback before Shortlisted or beyond.</div>

      {/* Add-round popup — name the round, then it opens straight into scheduling */}
      {showAddRound && (
        <Popup onClose={() => setShowAddRound(false)}>
          <div style={{ fontSize:15, fontWeight:800, marginBottom:4 }}>Add an interview round</div>
          <div style={{ fontSize:12, color:C.muted, marginBottom:12 }}>Name the round (e.g. “Technical L1”, “HR Round”, “Panel”). Next you'll pick the main interviewer and panelists.</div>
          <label style={lbl}>Round name</label>
          <input autoFocus value={newRound} onChange={e => setNewRound(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addRound() }}
            placeholder="e.g. Technical L1" style={inp} />
          <div style={{ display:'flex', gap:8, marginTop:14 }}>
            <button onClick={addRound} disabled={!newRound.trim()} style={{ ...btn.pri, opacity: newRound.trim() ? 1 : .5 }}>Add</button>
            <button onClick={() => setShowAddRound(false)} style={btn.ghost}>Cancel</button>
          </div>
        </Popup>
      )}

      {/* Shortlist confirmation */}
      {confirmShortlist && (
        <Popup onClose={() => !shortlisting && setConfirmShortlist(false)}>
          <div style={{ fontSize:15, fontWeight:800, marginBottom:4 }}>Shortlist {candidate.full_name}?</div>
          <div style={{ fontSize:12.5, color:C.muted, marginBottom:6 }}>{decidedRounds.length} rounds decided — latest: <b style={{ color: DECISION_COLOR[lastDecision || 'SHORTLIST'] }}>{lastDecision ? DECISION_LABEL[lastDecision] : '—'}</b>.</div>
          <div style={{ fontSize:12.5, color:C.muted, marginBottom:14 }}>The candidate will be marked <b style={{ color:C.ok }}>Shortlisted</b> and move on to offer negotiation.</div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={doShortlist} disabled={shortlisting} style={{ ...btn.pri, background:C.ok, opacity: shortlisting ? .6 : 1 }}>{shortlisting ? 'Shortlisting…' : 'Yes, shortlist'}</button>
            <button onClick={() => setConfirmShortlist(false)} disabled={shortlisting} style={btn.ghost}>No</button>
          </div>
        </Popup>
      )}
    </Shell>
  )
}

// ---- people picker (module scope: never re-mounts, so the search box keeps focus) ----
function PeoplePicker({ label, hint, single, emps, value, exclude, onChange, placeholder }: {
  label: string; hint?: string; single?: boolean; emps: Emp[]; value: Emp[]; exclude?: Emp[]
  onChange: (v: Emp[]) => void; placeholder?: string
}) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    const ex = new Set((exclude || []).map(e => e.id))
    return emps.filter(e => !ex.has(e.id) && ((e.full_name || '').toLowerCase().includes(s) || (e.emp_code || '').toLowerCase().includes(s))).slice(0, 8)
  }, [q, emps, exclude])
  const toggle = (e: Emp) => {
    if (value.some(x => x.id === e.id)) onChange(value.filter(x => x.id !== e.id))
    else onChange(single ? [e] : [...value, e])
    setQ('')
  }
  return (
    <div>
      <label style={lbl}>{label} {hint && <span style={{ color:C.faint, fontWeight:500 }}>{hint}</span>}</label>
      {value.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:6 }}>
          {value.map(e => (
            <span key={e.id} style={{ display:'inline-flex', alignItems:'center', gap:6, background: single ? C.infobg : C.brandTint, color: single ? C.info : C.pdark, borderRadius:99, padding:'3px 6px 3px 10px', fontSize:11.5, fontWeight:600 }}>
              {e.full_name} <span style={{ color:C.faint }}>{e.emp_code}</span>
              <button onClick={() => toggle(e)} style={{ border:'none', background:'transparent', cursor:'pointer', color:'inherit', fontSize:13, lineHeight:1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      {(!single || value.length === 0) && (
        <div style={{ position:'relative' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder || 'Type a name or emp code…'} style={inp} />
          {hits.length > 0 && (
            <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:5, background:C.card, border:`1px solid ${C.line}`, borderRadius:8, marginTop:3, boxShadow:'0 8px 24px rgba(30,27,75,0.14)', maxHeight:220, overflowY:'auto' }}>
              {hits.map(e => {
                const on = value.some(x => x.id === e.id)
                return (
                  <button key={e.id} onClick={() => toggle(e)} style={{ display:'flex', width:'100%', textAlign:'left', gap:8, alignItems:'center', padding:'8px 11px', border:'none', borderBottom:`1px solid ${C.line}`, background: on ? C.brandTint : C.card, cursor:'pointer', fontFamily:font }}>
                    <span style={{ flex:1, fontSize:12.5, color:C.ink }}>{e.full_name} <span style={{ color:C.faint }}>· {e.emp_code || '—'}{e.designation ? ` · ${e.designation}` : ''}</span></span>
                    {on && <span style={{ color:C.ok, fontWeight:800 }}>✓</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- little building blocks ----
const lbl: React.CSSProperties = { fontSize:11, fontWeight:700, color:C.muted, marginBottom:4, display:'block' }
const inp: React.CSSProperties = { width:'100%', padding:'9px 11px', fontFamily:font, fontSize:13, border:`1px solid ${C.line}`, borderRadius:8, outline:'none', color:C.ink, background:C.card, boxSizing:'border-box' }
const btn = {
  pri: { padding:'9px 18px', borderRadius:9, border:'none', background:C.purple, color:TK.onAccent, fontFamily:font, fontSize:13, fontWeight:700, cursor:'pointer' } as React.CSSProperties,
  ghost: { padding:'7px 13px', borderRadius:8, border:`1px solid ${C.line}`, background:C.card, color:C.ink, fontFamily:font, fontSize:12.5, fontWeight:600, cursor:'pointer' } as React.CSSProperties,
  small: { padding:'6px 12px', borderRadius:8, fontFamily:font, fontSize:11.5, fontWeight:700, cursor:'pointer' } as React.CSSProperties,
}
const decChip = (d: Decision): React.CSSProperties => ({ fontSize:10, fontWeight:800, padding:'3px 10px', borderRadius:99, background: DECISION_BG[d], color: DECISION_COLOR[d] })
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:11, fontWeight:800, letterSpacing:.5, textTransform:'uppercase', color:C.muted, margin:'2px 0 9px' }}>{children}</div>
}
function Popup({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.5)', zIndex:Z.overlay, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:C.card, borderRadius:14, width:'min(440px, 100%)', padding:'18px 20px', boxShadow:E.overlay }}>{children}</div>
    </div>
  )
}
/**
 * The modal shell. `.rx-dlg-modal` brings the top layer, focus trap, Esc and
 * backdrop dismiss. It sets NO padding of its own, so the 18/20 this file's
 * content has always assumed is passed through here — the drawer's padding:0
 * trap does not repeat.
 *
 * Width is pinned to the two sizes this file used before (720 / 1000) rather
 * than the sheet's 1080 default, so the non-wide views do not suddenly grow.
 *
 * `open` is hard-true: the pipeline tab mounts this modal conditionally and
 * unmounts it on close, so there is no closed state to represent. The three
 * views below are early RETURNS, not stacked overlays — only one Shell is ever
 * mounted, so no <dialog> is ever nested inside another.
 */
function Shell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <RxDialog open onClose={onClose} variant="modal" label="Candidate"
      style={{ width: wide ? 'min(1000px, calc(100vw - 32px))' : 'min(720px, calc(100vw - 32px))', padding:'18px 20px', fontFamily:font, color:C.ink }}>
      {children}
    </RxDialog>
  )
}
