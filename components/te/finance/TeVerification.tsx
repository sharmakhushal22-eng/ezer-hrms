'use client'
// components/te/finance/TeVerification.tsx — the Finance verification desk.
// Screens a3, a4, a5, a6, a7.
//
// A manager decides whether a trip SHOULD have happened. Finance checks
// whether what is claimed for it is right: the bills, the flags, the limits.
// Same claim, different question — so the desk leads with what needs looking
// at rather than with whatever is oldest.
//
// FOUR EYES. A company can set two Finance levels, and the person who did
// level 1 cannot also do level 2 (screens a6, a7). That rule lives in the
// server — te_step_block_reason answers it, and it arrives as can.act with
// can.why saying why not. This desk renders that refusal; it never works out
// who may sign off what.
import { useCallback, useEffect, useState } from 'react'
import { te, type ClaimSummaryRow } from '@/lib/te/client'
import { errorText, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeClaimApproval from '../approve/TeClaimApproval'

const BAND_TONE: Record<string, string> = { High: 't-crit', Medium: 't-warn', Low: 't-pos' }

export default function TeVerification({ onToast, onOpenTrip }: {
  onToast: (message: string) => void
  /** Open the trip behind a claim. Every row here already carried trip_id and
   *  trip_no and only printed the name as text, so Finance could read what a
   *  trip cost only one claim at a time. */
  onOpenTrip?: (tripId: string) => void
}) {
  const [rows, setRows] = useState<ClaimSummaryRow[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])
  // Rejected claims are the other half of this desk's job, and had nowhere to
  // be seen: te.claimReopen had no caller, so a claim rejected by mistake was
  // final even though the server allows Finance to reopen one until its month
  // is locked. Two lists rather than one screen, because they are different
  // questions — "is this right?" and "was refusing this right?".
  const [showing, setShowing] = useState<'IN_VERIFICATION' | 'REJECTED'>('IN_VERIFICATION')
  const [reopening, setReopening] = useState<string | null>(null)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let current = true
    // ON_HOLD belongs in this queue, not outside it. te__enter_verification
    // puts a High-risk or audit-sampled claim on hold FOR Finance to look at,
    // and asking only for IN_VERIFICATION hid exactly those: the desk said
    // "Nothing to verify" while the claimant's own screen said it was with
    // Finance, and the only way back to it was the approvals list.
    te.finance.claims({ status: showing === 'IN_VERIFICATION' ? 'IN_VERIFICATION,ON_HOLD' : showing })
      .then(p => { if (current) { setRows(p.rows ?? []); setError('') } })
      .catch(e => { if (current) { setRows([]); setError(errorText(e)) } })
    return () => { current = false }
  }, [tick, showing])

  /** Put a rejected claim back into its approval chain. The server refuses if
   *  the caller is the claimant or the month is locked; its words are shown. */
  async function reopen(claim: ClaimSummaryRow) {
    if (!why.trim()) return
    setBusy(claim.id); setError('')
    try {
      await te.claimReopen(claim.id, why.trim())
      onToast(`${claim.claim_no} reopened. It goes back into approval.`)
      setReopening(null); setWhy(''); reload()
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  if (open) {
    return (
      <TeClaimApproval
        claimId={open}
        onBack={() => setOpen(null)}
        onDecided={message => { onToast(message); setOpen(null); reload() }}
      />
    )
  }

  const list = rows ?? []
  // What a desk actually triages by: the risky and the already-flagged first,
  // the routine rest after. Oldest-first would bury the ones that matter.
  const attention = list.filter(r => r.status === 'ON_HOLD' || r.risk_band === 'High' || r.is_exception || r.open_flags > 0)
  const routine = list.filter(r => !attention.includes(r))

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Verification</h1>
          <p>Claims a manager has approved, waiting on Finance. Check the bills and the flags, then verify, hold or send back.</p>
        </div>
      </div>

      <div className="seg scopes" role="group" aria-label="Which claims">
        <button type="button" aria-pressed={showing === 'IN_VERIFICATION'} onClick={() => { setShowing('IN_VERIFICATION'); setReopening(null); setOpen(null) }}>
          <TeIcon name="verify" size="sm" />To verify
        </button>
        <button type="button" aria-pressed={showing === 'REJECTED'} onClick={() => { setShowing('REJECTED'); setReopening(null); setOpen(null) }}>
          <TeIcon name="close" size="sm" />Rejected
        </button>
      </div>

      {error ? (
        <div className="card"><p className="muted">{error}</p><button type="button" className="btn sm" onClick={reload}>Try again</button></div>
      ) : null}

      {showing === 'REJECTED' ? (
        <div className="card pad0">
          <div className="day"><span>Rejected</span><span>{list.length}</span></div>
          {rows === null ? <div className="empty"><b>Loading…</b></div> : null}
          {rows !== null && !list.length ? (
            <div className="empty"><b>Nothing rejected</b>A refused claim appears here, and can be put back if it was refused by mistake.</div>
          ) : null}
          {list.map(r => (
            <div key={r.id} className="li">
              <span className="ico"><TeIcon name="close" /></span>
              <div className="grow">
                <div className="b">{r.claim_no} · {r.employee_name}</div>
                <div className="small muted">
                  {[r.trip_name || 'Other expenses', r.department, r.period_label].filter(Boolean).join(' · ')}
                </div>
                {reopening === r.id ? (
                  <div className="form">
                    <div className="note">
                      <TeIcon name="info" size="sm" />
                      <span>The claim goes back into its approval chain from the beginning. The employee is told it was reopened, and your reason is kept on it.</span>
                    </div>
                    <label className="fld sm"><span>Why it should not have been refused</span>
                      <input value={why} onChange={e => setWhy(e.target.value)} placeholder="Rejected by mistake; the client is on the visitor log" />
                    </label>
                    <div className="row tight">
                      <button type="button" className="btn" onClick={() => { setReopening(null); setWhy('') }}>Never mind</button>
                      <button type="button" className="btn pri" disabled={!why.trim() || busy === r.id} onClick={() => reopen(r)}>
                        {busy === r.id ? 'Reopening…' : 'Reopen it'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="amt">
                <b>{rs(r.claimed_total)}</b>
                {reopening !== r.id ? (
                  <button type="button" className="btn sm" onClick={() => { setReopening(r.id); setWhy(''); setError('') }}>Reopen</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {showing !== 'IN_VERIFICATION' ? null : [{ title: 'Needs a look', rows: attention }, { title: 'Routine', rows: routine }].map(group => (
        group.rows.length ? (
          <div key={group.title} className="card pad0">
            <div className="day"><span>{group.title}</span><span>{group.rows.length}</span></div>
            {group.rows.map(r => (
              <div key={r.id} className="li">
                <span className="ico"><TeIcon name="other" /></span>
                {/* The claim is still the row's main target; the trip sits
                    beside it as its own control. A button cannot be nested
                    inside a button, which is why this is a div with a role
                    rather than the <button> it used to be. */}
                <div className="grow click" role="button" tabIndex={0}
                  onClick={() => setOpen(r.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(r.id) } }}
                >
                  <div className="b">{r.claim_no} · {r.employee_name}</div>
                  <div className="small muted">
                    {[r.trip_name || 'Other expenses', r.grade, r.department, r.period_label].filter(Boolean).join(' · ')}
                  </div>
                  <div className="row tight">
                    {/* Why it is held, so the desk knows it is not just waiting. */}
                    {r.status === 'ON_HOLD' ? <span className="chip t-crit">On hold</span> : null}
                    <span className={`chip ${BAND_TONE[r.risk_band] ?? 'plain'}`}>{r.risk_band} risk</span>
                    {r.open_flags ? <span className="chip t-warn">{r.open_flags} flag{r.open_flags === 1 ? '' : 's'}</span> : null}
                    {r.is_exception ? <span className="chip t-crit">Exception</span> : null}
                    {r.is_post_facto ? <span className="chip plain">After travel</span> : null}
                    {r.is_late ? <span className="chip t-warn">Late</span> : null}
                    {r.waiting_role ? <span className="chip plain">{r.waiting_role}</span> : null}
                  </div>
                </div>
                {/* THE TRIP, by its number, which is now its identity. */}
                {r.trip_id && onOpenTrip ? (
                  <button type="button" className="btn sm" title="Everything on this trip: the tickets, the stay, the food and every journey"
                    onClick={() => onOpenTrip(r.trip_id as string)}>
                    <TeIcon name="route" size="sm" />{r.trip_no}
                  </button>
                ) : null}
                <div className="amt">
                  <b>{rs(r.eligible_total)}</b>
                  <span className="small muted">eligible</span>
                  {r.claimed_total !== r.eligible_total ? <s>{rs(r.claimed_total)}</s> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null
      ))}

      {/* The Rejected list carries its own empty state, so this one is only
          for the verification queue. */}
      {showing === 'IN_VERIFICATION' && rows !== null && !list.length ? (
        <div className="card"><div className="empty"><b>Nothing to verify</b>Claims appear here once a manager has approved them, including the ones held for audit.</div></div>
      ) : null}
    </div>
  )
}
