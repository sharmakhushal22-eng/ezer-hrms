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

export default function TeVerification({ onToast }: { onToast: (message: string) => void }) {
  const [rows, setRows] = useState<ClaimSummaryRow[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let current = true
    te.finance.claims({ status: 'IN_VERIFICATION' })
      .then(p => { if (current) { setRows(p.rows ?? []); setError('') } })
      .catch(e => { if (current) { setRows([]); setError(errorText(e)) } })
    return () => { current = false }
  }, [tick])

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
  const attention = list.filter(r => r.risk_band === 'High' || r.is_exception || r.open_flags > 0)
  const routine = list.filter(r => !attention.includes(r))

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Verification</h1>
          <p>Claims a manager has approved, waiting on Finance. Check the bills and the flags, then verify, hold or send back.</p>
        </div>
      </div>

      {error ? (
        <div className="card"><p className="muted">{error}</p><button type="button" className="btn sm" onClick={reload}>Try again</button></div>
      ) : null}

      {[{ title: 'Needs a look', rows: attention }, { title: 'Routine', rows: routine }].map(group => (
        group.rows.length ? (
          <div key={group.title} className="card pad0">
            <div className="day"><span>{group.title}</span><span>{group.rows.length}</span></div>
            {group.rows.map(r => (
              <button key={r.id} type="button" className="li click" onClick={() => setOpen(r.id)}>
                <span className="ico"><TeIcon name="other" /></span>
                <div className="grow">
                  <div className="b">{r.claim_no} · {r.employee_name}</div>
                  <div className="small muted">
                    {[r.trip_name || 'Other expenses', r.grade, r.department, r.period_label].filter(Boolean).join(' · ')}
                  </div>
                  <div className="row tight">
                    <span className={`chip ${BAND_TONE[r.risk_band] ?? 'plain'}`}>{r.risk_band} risk</span>
                    {r.open_flags ? <span className="chip t-warn">{r.open_flags} flag{r.open_flags === 1 ? '' : 's'}</span> : null}
                    {r.is_exception ? <span className="chip t-crit">Exception</span> : null}
                    {r.is_post_facto ? <span className="chip plain">After travel</span> : null}
                    {r.is_late ? <span className="chip t-warn">Late</span> : null}
                    {r.waiting_role ? <span className="chip plain">{r.waiting_role}</span> : null}
                  </div>
                </div>
                <div className="amt">
                  <b>{rs(r.eligible_total)}</b>
                  <span className="small muted">eligible</span>
                  {r.claimed_total !== r.eligible_total ? <s>{rs(r.claimed_total)}</s> : null}
                </div>
              </button>
            ))}
          </div>
        ) : null
      ))}

      {rows !== null && !list.length ? (
        <div className="card"><div className="empty"><b>Nothing to verify</b>Claims appear here once a manager has approved them.</div></div>
      ) : null}
    </div>
  )
}
