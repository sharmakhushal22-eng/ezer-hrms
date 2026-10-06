'use client'
// components/recruitment/InterviewsScheduled.tsx
//
// Recruitment & ATS -> "Interviews Scheduled". The SCHEDULER's view of every
// interview they have booked: who is interviewing, when, the joining link, and
// how far that interviewer has got.
//
// READ-ONLY BY CONSTRUCTION. This file contains no insert, update, upsert or
// delete, and no handler that could move a candidate. The round flow is
// untouched: "+ Add round" -> pick the main interviewer -> they give feedback,
// and three decided rounds (Telephonic included) unlock Shortlist. That all
// lives in CandidateInterviewModal and /api/recruitment/interview-invite.
//
// THE INTERVIEWER'S HALF IS SOMEWHERE ELSE, ON PURPOSE
//
// L1 / L2 managers do not use this tab — migration 123 restricts them to
// recruitment.mrf, and their feedback happens in ESS -> Tasks & Approvals,
// where components/ess/RoleTabs.tsx (InterviewInvites) already lists every
// interview assigned to them with the join link, Acknowledge and Give feedback.
// This is the mirror of that list for the person who scheduled it, not a second
// copy of it. Status words are kept identical to that screen on purpose, so the
// two never describe the same row differently.
//
// WHY THE "No ESS login" FLAG EXISTS
//
// Feedback is submitted through /api/ess/interview, which runs behind essRoute.
// An interviewer with no ess_accounts row gets the email and the task and can
// do nothing with either: the round sits at `invited` forever, and because the
// shortlist gate counts DECIDED rounds, the candidate can never be shortlisted.
// That failure is invisible from the recruiter's side, so the tab names it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { C, F, W, R, S, TableWrap, Th, Td, Tr, Empty } from '@/lib/ui'
// The scoping rule and the status vocabulary live in lib/, not here. The test
// runner (node --experimental-strip-types) cannot load .tsx at all, so logic
// exported from a component is untestable by construction — and this rule is
// the only thing standing between one recruiter and every other recruiter's
// hiring, so it is exactly the code that must be tested.
import {
  visibleInvites, statusOf, byWhen, isMainInterviewer as isMain,
  type ScheduledInterview as Invite,
} from '@/lib/recruitment/interviews-scheduled'

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Time to be confirmed'

const toneColour: Record<'ok' | 'warn' | 'mute' | 'info', string> = {
  ok: C.positive, warn: C.warning, mute: C.muted, info: C.info,
}

export default function InterviewsScheduledTab({
  supabase, employeeId, isOversight, companyId,
}: {
  supabase: any
  employeeId: string | null
  isOversight?: boolean
  companyId?: string | null
}) {
  const [rows, setRows] = useState<Invite[] | null>(null)
  const [noEssLogin, setNoEssLogin] = useState<Set<string>>(new Set())
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'open' | 'done'>('all')

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('interview_invites')
        .select('*').order('scheduled_at', { ascending: false, nullsFirst: false })
      if (error) { setErr(error.message); setRows([]); return }
      const all = (data || []) as Invite[]
      const mine = visibleInvites(all, {
        employeeId: employeeId || null,
        isOversight: !!isOversight,
        companyId: companyId ?? null,
      }).sort(byWhen)
      setRows(mine); setErr('')

      // Which of these interviewers can actually submit feedback. One query,
      // ids only — no credential value is read, and none could be: ess_accounts
      // holds a hash, and nothing here selects it.
      const ids = [...new Set(mine.map(r => r.interviewer_id).filter(Boolean))] as string[]
      if (!ids.length) { setNoEssLogin(new Set()); return }
      const { data: accts, error: aErr } = await supabase
        .from('ess_accounts').select('employee_id').in('employee_id', ids)
      // A failure here must not blank the table — the flag is an extra, not the
      // screen. Report nothing rather than flag everyone as broken.
      if (aErr) { setNoEssLogin(new Set()); return }
      const have = new Set((accts || []).map((a: any) => a.employee_id))
      setNoEssLogin(new Set(ids.filter(id => !have.has(id))))
    } catch (e: any) {
      setErr(e?.message || 'Could not load the scheduled interviews.')
      setRows([])
    }
  }, [supabase, employeeId, isOversight, companyId])

  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (rows || []).filter(r => {
      if (only === 'open' && r.status === 'submitted') return false
      if (only === 'done' && r.status !== 'submitted') return false
      if (!s) return true
      return [r.candidate_name, r.interviewer_name, r.round].some(v => (v || '').toLowerCase().includes(s))
    })
  }, [rows, q, only])

  const counts = useMemo(() => {
    const r = rows || []
    return {
      all: r.length,
      open: r.filter(x => x.status !== 'submitted').length,
      done: r.filter(x => x.status === 'submitted').length,
      stalled: r.filter(x => x.interviewer_id && noEssLogin.has(x.interviewer_id) && x.status !== 'submitted').length,
    }
  }, [rows, noEssLogin])

  if (rows === null) {
    return <div style={{ padding: 28, textAlign: 'center', color: C.muted, fontSize: F.small }}>Loading scheduled interviews…</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: S.md }}>
        <input
          className="rx-input" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search candidate, interviewer or round…" style={{ maxWidth: 320 }}
        />
        {([['all', `All (${counts.all})`], ['open', `Awaiting feedback (${counts.open})`], ['done', `Feedback in (${counts.done})`]] as const).map(([k, label]) => (
          <button
            key={k} onClick={() => setOnly(k)}
            style={{
              padding: '6px 12px', borderRadius: R.pill, cursor: 'pointer', fontSize: F.tiny, fontWeight: W.semi,
              fontFamily: 'inherit',
              border: `1px solid ${only === k ? C.brand : C.line}`,
              background: only === k ? C.brandTint : C.surface,
              color: only === k ? C.brandDeep : C.inkSoft,
            }}>{label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: F.tiny, color: C.faint }}>
          {isOversight ? 'Every interview in view' : 'Interviews you scheduled'}
        </span>
      </div>

      {counts.stalled > 0 && (
        <div style={{
          background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, color: C.critical,
          borderRadius: R.md, padding: '10px 12px', marginBottom: S.md, fontSize: F.small, lineHeight: 1.5,
        }}>
          <b>{counts.stalled} interview{counts.stalled === 1 ? '' : 's'} cannot receive feedback.</b> That interviewer has no
          ESS login, so they can neither acknowledge nor submit — the round stays open and the candidate can never reach
          three decided rounds. Create the login in <b>ESS &amp; Role Management → Credentials</b>.
        </div>
      )}

      {err && (
        <div style={{ background: C.criticalTint, color: C.critical, borderRadius: R.md, padding: '10px 12px', marginBottom: S.md, fontSize: F.small }}>
          Could not load the scheduled interviews: {err}
        </div>
      )}

      {shown.length === 0 ? (
        <Empty
          title={counts.all === 0 ? 'No interviews scheduled yet' : 'Nothing matches that filter'}
          hint={counts.all === 0
            ? 'Open a candidate in Pipeline, add a round and send the invite — it will appear here with its joining link.'
            : 'Clear the search or choose a different filter.'}
        />
      ) : (
        <TableWrap minWidth={980}>
          <thead>
            <tr>
              <Th>Candidate</Th>
              <Th>Round</Th>
              <Th>When</Th>
              <Th>Interviewer</Th>
              <Th>Joining link</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => {
              const st = statusOf(r)
              const stalled = !!r.interviewer_id && noEssLogin.has(r.interviewer_id) && r.status !== 'submitted'
              return (
                <Tr key={r.id}>
                  <Td strong>{r.candidate_name || '—'}</Td>
                  <Td>
                    <span style={{
                      fontSize: F.tiny, fontWeight: W.bold, color: C.brandDeep, background: C.brandTint,
                      borderRadius: R.pill, padding: '2px 9px',
                    }}>{r.round}</span>
                  </Td>
                  <Td>{when(r.scheduled_at)}</Td>
                  <Td>
                    <div>{r.interviewer_name || '—'}{!isMain(r) && <span style={{ color: C.faint, fontSize: F.tiny }}> · panelist</span>}</div>
                    {stalled && (
                      <div style={{ fontSize: F.tiny, color: C.critical, fontWeight: W.semi, marginTop: 2 }}>
                        No ESS login — cannot submit feedback
                      </div>
                    )}
                  </Td>
                  <Td>
                    {r.meet_link
                      ? <a href={r.meet_link} target="_blank" rel="noreferrer"
                           style={{ color: C.brand, fontWeight: W.semi }}>Join link</a>
                      : <span style={{ color: C.faint }}>—</span>}
                    {r.meet_passcode && (
                      <div style={{ fontSize: F.tiny, color: C.muted }}>Passcode {r.meet_passcode}</div>
                    )}
                  </Td>
                  <Td>
                    <span style={{ color: toneColour[st.tone], fontWeight: W.semi, fontSize: F.tiny }}>{st.label}</span>
                    {r.status === 'submitted' && r.submitted_at && (
                      <div style={{ fontSize: F.tiny, color: C.faint }}>{when(r.submitted_at)}</div>
                    )}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      <div style={{ fontSize: F.tiny, color: C.faint, marginTop: S.md, lineHeight: 1.6 }}>
        Interviewers acknowledge and submit their feedback in <b>ESS → Tasks &amp; Approvals</b>, where the same
        interviews appear with this joining link. Three decided rounds, Telephonic included, unlock Shortlist on the
        candidate. This screen only reports that progress — it changes nothing.
      </div>
    </div>
  )
}
